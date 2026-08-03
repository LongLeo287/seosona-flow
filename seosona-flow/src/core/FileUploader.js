/**
 * FileUploader - Upload pending local files lên Google Flow
 * Shared giữa sidebar (app.js) và workflow editor popup
 * Sử dụng MessageBridge để gửi file qua content script
 */

(function() {
  'use strict';

  const DEBUG_FILE_UPLOADER = false;
  function log(...args) {
    if (DEBUG_FILE_UPLOADER) console.log('[SEOSONA Flow:FileUploader]', ...args);
  }

  /**
   * Helper: convert ArrayBuffer → base64 (chunked, tránh crash >64KB)
   */
  function arrayBufferToBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  /**
   * Helper: sha256 hex của ArrayBuffer — dùng cho content-hash dedup (chống reupload
   * cùng 1 ảnh nhiều lần trong session multi-prompt → duplicate trên Flow library).
   */
  async function _sha256HexBuf(arrayBuffer) {
    const buf = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Upload pending local files (upload_xxx) lên Google Flow
   * @param {string} fileIdsStr - Comma-separated file IDs (có thể chứa upload_xxx)
   * @returns {string} - File IDs đã thay thế upload_xxx bằng real IDs
   */
  async function uploadPendingFiles(fileIdsStr) {
    if (!fileIdsStr) return fileIdsStr;
    let ids = fileIdsStr.split(',').map(s => s.trim()).filter(Boolean);

    // Port 1.1.49: dedup key trùng (data cũ / chọn trùng có thể lặp 'upload_...' cùng key).
    // Trùng key → upload trùng + mapping index lệch → return thiếu ID. Giữ thứ tự xuất hiện đầu tiên.
    if (ids.length !== new Set(ids).size) {
      const _seen = new Set();
      ids = ids.filter(id => (_seen.has(id) ? false : (_seen.add(id), true)));
    }

    // S2.5: Check ImmediateUploader results — nếu đã upload xong thì dùng tile_id trực tiếp
    if (window.ImmediateUploader) {
      let changed = false;
      for (let i = 0; i < ids.length; i++) {
        if (ids[i].startsWith('upload_')) {
          const result = ImmediateUploader.getResult(ids[i]);
          if (result?.tile_id) {
            const oldKey = ids[i];
            log(`Đã upload trước đó: ${oldKey.substring(0, 20)}... → ${result.tile_id.substring(0, 20)}...`);
            ids[i] = result.tile_id;
            changed = true;
            // Transfer caches giống uploadPendingFiles mapping
            const cachedEntry = window.pendingUploadFiles?.get(oldKey);
            if (cachedEntry?.thumbnail) {
              if (!window._uploadedThumbnailCache) window._uploadedThumbnailCache = new Map();
              window._uploadedThumbnailCache.set(result.tile_id, cachedEntry.thumbnail);
            }
            // Tier-1 C-2: remap refImageNames qua API GenTab
            window.GenTab?.remapRefImageName(oldKey, result.tile_id);
            // Update thumbnailCache + fileNameCache with NEW data from ImmediateUploader result
            // CRITICAL: Dùng thumbnail_url/file_name mới từ Flow, không dùng album CDN URL cũ
            // MediaRegistry: centralized cache (works in all HTML contexts)
            // cachedEntry đã khai báo ở line 49, không cần khai báo lại
            if (result.thumbnail_url) {
              MediaRegistry.setThumb(result.tile_id, result.thumbnail_url);
              // BUG FIX: Cập nhật GenTab.thumbnailCache
              if (window.GenTab?.thumbnailCache) {
                window.GenTab.thumbnailCache[result.tile_id] = result.thumbnail_url;
                delete window.GenTab.thumbnailCache[oldKey];
              }
            } else if (cachedEntry?.thumbnail) {
              MediaRegistry.setThumb(result.tile_id, cachedEntry.thumbnail);
              if (window.GenTab?.thumbnailCache) {
                window.GenTab.thumbnailCache[result.tile_id] = cachedEntry.thumbnail;
                delete window.GenTab.thumbnailCache[oldKey];
              }
            } else if (MediaRegistry.getThumb(oldKey)) {
              MediaRegistry.setThumb(result.tile_id, MediaRegistry.getThumb(oldKey));
              if (window.GenTab?.thumbnailCache) {
                window.GenTab.thumbnailCache[result.tile_id] = MediaRegistry.getThumb(oldKey);
                delete window.GenTab.thumbnailCache[oldKey];
              }
            }
            MediaRegistry.deleteThumb(oldKey);
            if (result.file_name) {
              MediaRegistry.setFileName(result.tile_id, result.file_name);
            }
            MediaRegistry.deleteFileName(oldKey);
            // Cleanup
            window.pendingUploadFiles?.delete(oldKey);
            ImmediateUploader._results.delete(oldKey);
          }
        }
      }
      if (changed) {
        // Save state sau khi transfer names
        if (window.GenTab?.saveState) {
          window.GenTab.saveState();
        }
        // Re-check nếu còn pending IDs
        const stillPending = ids.filter(id => id.startsWith('upload_') && window.pendingUploadFiles?.has(id));
        if (stillPending.length === 0) {
          log('Tất cả upload_xxx đã được ImmediateUploader xử lý');
          return ids.filter(Boolean).join(', ');
        }
      }
    }

    let pendingIds = ids.filter(id => id.startsWith('upload_') && window.pendingUploadFiles?.has(id));

    // S2.5: Cho ImmediateUploader hoan thanh thay vi upload lai (tranh double upload)
    if (window.ImmediateUploader) {
      for (let i = pendingIds.length - 1; i >= 0; i--) {
        const pid = pendingIds[i];
        if (ImmediateUploader.isUploading(pid)) {
          log(`Cho ImmediateUploader hoan thanh: ${pid.substring(0, 20)}...`);
          try {
            const result = await ImmediateUploader._uploading.get(pid);
            if (result?.tile_id) {
              const idx = ids.indexOf(pid);
              if (idx !== -1) ids[idx] = result.tile_id;
              window.pendingUploadFiles?.delete(pid);
              pendingIds.splice(i, 1);
              log(`ImmediateUploader hoan thanh: ${pid.substring(0, 20)}... -> ${result.tile_id.substring(0, 20)}...`);
            }
          } catch (e) {
            log(`ImmediateUploader that bai: ${pid.substring(0, 20)}..., se upload lai`);
          }
        }
      }
      if (pendingIds.length === 0) {
        log('Tat ca uploads da hoan thanh qua ImmediateUploader');
        return ids.filter(Boolean).join(', ');
      }
    }

    // Fallback recovery: nếu pendingUploadFiles memory empty (sidebar reload, GC),
    // thử đọc file blob từ PendingUploadStore IndexedDB (saved bởi ImmediateUploader._saveLightweightPending
    // OR _uploadImmediate after success). Restore vào pendingUploadFiles để continue normal flow.
    const orphanUploadIds = ids.filter((id) => id.startsWith('upload_') && !window.pendingUploadFiles?.has(id));
    if (orphanUploadIds.length > 0 && window.PendingUploadStore) {
      if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
      for (const oid of orphanUploadIds) {
        try {
          const file = await window.PendingUploadStore.getCachedFile(oid);
          if (file) {
            // Lấy thumbnail từ lightweight store nếu có (best-effort)
            let thumbnail = null;
            try {
              const lw = await window.PendingUploadStore.getLightweight?.(oid);
              if (lw?.thumbnail) thumbnail = lw.thumbnail;
            } catch (_) { /* ignore */ }
            window.pendingUploadFiles.set(oid, { file, thumbnail });
            log(`[uploadPendingFiles] Restored orphan ${oid.substring(0, 20)}... from IndexedDB`);
          }
        } catch (e) {
          log(`[uploadPendingFiles] Restore orphan ${oid.substring(0, 20)}... failed:`, e?.message);
        }
      }
      // Re-build pendingIds sau khi restore
      pendingIds = ids.filter(id => id.startsWith('upload_') && window.pendingUploadFiles?.has(id));
    }

    if (pendingIds.length === 0) {
      log('Không có pending file nào trong memory hoặc IndexedDB');
      return ids.filter(Boolean).join(', ');
    }

    // Collect files cần upload
    const filesToUpload = [];
    for (const pid of pendingIds) {
      const cached = window.pendingUploadFiles.get(pid);
      if (cached?.file) filesToUpload.push({ key: pid, file: cached.file });
    }

    if (filesToUpload.length === 0) {
      log('Pending IDs có nhưng không tìm thấy file data');
      return fileIdsStr;
    }

    log(`Đang upload ${filesToUpload.length} ảnh lên Google Flow...`);
    log(`Upload order: ${filesToUpload.map(f => f.key + ' (' + f.file.name + ')').join(', ')}`);

    // Ensure Flow tab active trước khi upload (Google Flow cần tab active để process file injection)
    // Không có bước này → upload trên inactive tab → tile status=failed ngay lập tức
    let flowActivation = null;
    if (window.ImmediateUploader) {
      try {
        flowActivation = await ImmediateUploader._ensureFlowTabReady();
        if (!flowActivation?.isOpen) {
          log('Flow tab không mở, không thể upload pending files');
          return ids.filter(id => !id.startsWith('upload_')).join(', ');
        }
      } catch (e) {
        log('Không thể kiểm tra Flow tab:', e.message);
      }
    }

    try {
      let uploadedIds = null;

      let tileDetails = null; // file_name, thumbnailUrl, file_id from upload result
      let keyMapping = null; // BUG FIX: Map originalKey → newTileId
      if (window.MessageBridge) {
        const filesData = [];
        for (const f of filesToUpload) {
          const arrayBuffer = await f.file.arrayBuffer();
          const base64 = arrayBufferToBase64(arrayBuffer);
          filesData.push({ name: f.file.name, type: f.file.type, base64, key: f.key });
        }
        const result = await window.MessageBridge.uploadFilesToFlow(filesData);
        // Use orderedTileIds which matches upload order, fallback to tileIds
        uploadedIds = result?.orderedTileIds || result?.tileIds;
        tileDetails = result?.tileDetails || null;
        keyMapping = result?.keyMapping || null; // BUG FIX: Use keyMapping for correct oldKey → newTileId
        log(`Upload returned: ${JSON.stringify(uploadedIds)}`);
        if (keyMapping) log(`Upload keyMapping: ${JSON.stringify(keyMapping)}`);
        if (tileDetails) log(`Upload tileDetails: ${JSON.stringify(tileDetails)}`);
        if (result?.warning) log(`Upload warning: ${result.warning}`);
      } else {
        // content script context: direct DOM upload
        const uploadFn = typeof performFlowImageUpload === 'function' ? performFlowImageUpload : window.performFlowImageUpload;
        if (uploadFn) {
          const files = filesToUpload.map(f => f.file);
          const dummyBtn = document.createElement('button');
          dummyBtn.style.display = 'none';
          document.body.appendChild(dummyBtn);
          uploadedIds = await uploadFn(files, dummyBtn);
          dummyBtn.remove();
        } else {
          log('Không có phương thức upload nào khả dụng');
          return ids.filter(id => !id.startsWith('upload_')).join(', ');
        }
      }

      if (uploadedIds && uploadedIds.length > 0) {
        const resultIds = [...ids];
        log(`Mapping: ids=${JSON.stringify(ids)}, pendingIds=${JSON.stringify(pendingIds)}, uploadedIds=${JSON.stringify(uploadedIds)}, keyMapping=${JSON.stringify(keyMapping)}`);

        // Có keyMapping → dùng key-based mapping (chính xác)
        // Không có keyMapping → fallback về sequential mapping (legacy)
        const useKeyMapping = keyMapping && Object.keys(keyMapping).length > 0;
        let uploadIdx = 0; // Cho sequential fallback

        for (let i = 0; i < resultIds.length; i++) {
          const oldKey = resultIds[i];
          if (!pendingIds.includes(oldKey)) continue;

          let newId = null;

          if (useKeyMapping) {
            // Key-based mapping: chính xác, tránh lệch index khi upload fail
            if (keyMapping[oldKey]) {
              newId = keyMapping[oldKey];
              log(`Mapping via keyMapping: ${oldKey} → ${newId}`);
            } else {
              // Không có trong keyMapping → upload fail cho file này
              log(`No keyMapping for ${oldKey}, upload may have failed`);
              continue;
            }
          } else {
            // Sequential fallback: legacy behavior (có thể lệch nếu upload giữa chừng fail)
            if (uploadIdx < uploadedIds.length) {
              newId = uploadedIds[uploadIdx];
              log(`Mapping via sequential [${uploadIdx}]: ${oldKey} → ${newId}`);
              uploadIdx++;
            } else {
              log(`No more uploadedIds for ${oldKey}`);
              continue;
            }
          }

          // Có newId → thực hiện mapping
          const cachedEntry = window.pendingUploadFiles.get(oldKey);
          log(`Mapping [${i}]: ${oldKey} → ${newId}`);
          resultIds[i] = newId;
          // Transfer thumbnail from old upload_xxx to new flow tile ID
          if (cachedEntry?.thumbnail) {
            if (!window._uploadedThumbnailCache) window._uploadedThumbnailCache = new Map();
            window._uploadedThumbnailCache.set(newId, cachedEntry.thumbnail);
          }
          // Bug fix: Transfer refImageNames from old key to new tile ID
          // Tier-1 C-2: remap refImageNames qua API GenTab (giữ log)
          const _remappedName = window.GenTab?.remapRefImageName(oldKey, newId);
          if (_remappedName) log(`Transferred name "${_remappedName}" from ${oldKey.substring(0, 15)}... to ${newId.substring(0, 15)}...`);
          // Update thumbnailCache + fileNameCache with NEW data from upload result
          // CRITICAL: Dùng tileDetails (data mới từ Flow) thay vì album CDN URL cũ
          // Album CDN URL cũ → sau reload, correctFileIds match sai tile (cross-project)
          const detail = tileDetails?.find(d => d.id === newId);
          // MediaRegistry: centralized cache
          if (detail?.thumbnailUrl) {
            MediaRegistry.setThumb(newId, detail.thumbnailUrl);
            // BUG FIX: Cập nhật GenTab.thumbnailCache để renderFileIdThumbnails có thể đọc
            if (window.GenTab?.thumbnailCache) {
              window.GenTab.thumbnailCache[newId] = detail.thumbnailUrl;
              delete window.GenTab.thumbnailCache[oldKey];
            }
            log(`Updated thumbnailCache with new URL for ${newId.substring(0, 15)}...`);
          } else if (cachedEntry?.thumbnail) {
            // Fallback: dùng thumbnail từ pendingUploadFiles (local blob URL)
            MediaRegistry.setThumb(newId, cachedEntry.thumbnail);
            if (window.GenTab?.thumbnailCache) {
              window.GenTab.thumbnailCache[newId] = cachedEntry.thumbnail;
              delete window.GenTab.thumbnailCache[oldKey];
            }
          } else if (MediaRegistry.getThumb(oldKey)) {
            MediaRegistry.setThumb(newId, MediaRegistry.getThumb(oldKey));
            if (window.GenTab?.thumbnailCache) {
              window.GenTab.thumbnailCache[newId] = MediaRegistry.getThumb(oldKey);
              delete window.GenTab.thumbnailCache[oldKey];
            }
          }
          MediaRegistry.deleteThumb(oldKey);
          if (detail?.file_name) {
            MediaRegistry.setFileName(newId, detail.file_name);
            log(`Set fileNameCache[${newId.substring(0, 15)}...] = ${detail.file_name.substring(0, 15)}...`);
          }
          MediaRegistry.deleteFileName(oldKey);
          if (cachedEntry?.file) {
            if (window.PendingUploadStore) {
              PendingUploadStore.cacheUploaded(newId, cachedEntry.file);
              PendingUploadStore.remove(oldKey);
              // S2: cleanup lightweight store nếu có
              PendingUploadStore.removeLightweight(oldKey).catch(function (_e) { globalThis.SEOSONA_swallow?.('FileUploader#uploadPendingFiles', _e); });
            } else {
              window.uploadedFileCache.set(newId, { file: cachedEntry.file });
              window.pendingUploadFiles.delete(oldKey);
            }
          }
        }
        // Save state after transferring names
        if (window.GenTab?.saveState) {
          window.GenTab.saveState();
        }
        log(`Upload thành công: ${resultIds.filter(Boolean).length} files`);
        return resultIds.filter(Boolean).join(', ');
      } else {
        log('Upload không trả về tile ID nào');
      }
    } catch (err) {
      log('Lỗi upload ảnh:', err.message || err);
    }
    // Không restore tab — giữ Flow tab active

    return ids.filter(id => !id.startsWith('upload_')).join(', ');
  }

  /**
   * Sửa file IDs cũ thành IDs mới bằng 5-tầng correction.
   * Ưu tiên: file_id > file_name > data-tile-id > thumbnail_url > ensureFlowTilesLoaded > reupload
   * @param {string} fileIdsStr - Comma-separated file IDs
   * @param {Object} thumbnailMap - { fileId: thumbnailUrl } từ saved data
   * @param {Object} [fileNameMap] - { fileId: fileName } persistent UUIDs
   * @param {Object} [fileIdMap] - { tileId: flowFileId } persistent file_id from /edit/{file_id} (Phase U)
   * @returns {Promise<{correctedIds: string, changed: boolean}>}
   */
  async function correctFileIds(fileIdsStr, thumbnailMap, fileNameMap, fileIdMap) {
    if (!fileIdsStr) return { correctedIds: fileIdsStr, changed: false };
    const hasThumbs = thumbnailMap && Object.keys(thumbnailMap).length > 0;
    const hasFileNames = fileNameMap && Object.keys(fileNameMap).length > 0;
    const hasFileIds = fileIdMap && Object.keys(fileIdMap).length > 0;
    if (!hasThumbs && !hasFileNames && !hasFileIds) {
      return { correctedIds: fileIdsStr, changed: false };
    }
    const ids = fileIdsStr.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return { correctedIds: fileIdsStr, changed: false };

    // Build idToUrlMap + fileNameMap + fileIdMap cho các IDs cần check
    const idToUrlMap = {};
    const fnMap = {};
    const fiMap = {};
    for (const id of ids) {
      if (id.startsWith('upload_')) continue;
      if (thumbnailMap?.[id]) idToUrlMap[id] = thumbnailMap[id];
      if (fileNameMap?.[id]) fnMap[id] = fileNameMap[id];
      if (fileIdMap?.[id]) fiMap[id] = fileIdMap[id];
    }
    if (Object.keys(idToUrlMap).length === 0 && Object.keys(fnMap).length === 0 && Object.keys(fiMap).length === 0) {
      log('correctFileIds: không có thumbnail URL, file_name hoặc file_id nào để match');
      return { correctedIds: fileIdsStr, changed: false };
    }

    try {
      let result;
      if (window.MessageBridge) {
        log('correctFileIds: gửi', Object.keys(idToUrlMap).length, 'URLs +', Object.keys(fnMap).length, 'file_names +', Object.keys(fiMap).length, 'file_ids tới content script');
        result = await window.MessageBridge.correctStaleFileIds(idToUrlMap, fnMap, fiMap);
      } else {
        return { correctedIds: fileIdsStr, changed: false };
      }

      const corrections = result?.corrections || {};
      if (Object.keys(corrections).length === 0) {
        log('correctFileIds: tất cả IDs hợp lệ hoặc không match được');
        return { correctedIds: fileIdsStr, changed: false };
      }

      // Apply corrections
      const correctedIds = ids.map(id => corrections[id] || id);
      for (const [oldId, newId] of Object.entries(corrections)) {
        log(`correctFileIds: ${oldId.substring(0, 25)}... → ${newId.substring(0, 25)}...`);
      }
      return { correctedIds: correctedIds.join(', '), changed: true };
    } catch (err) {
      log('correctFileIds failed:', err.message);
      return { correctedIds: fileIdsStr, changed: false };
    }
  }

  /**
   * Kiểm tra ref file IDs có tồn tại trên page không.
   * Nếu không, thử re-upload từ uploadedFileCache.
   * @param {string} fileIdsStr - Comma-separated file IDs
   * @param {Object} thumbnailMap - Map tile_id → thumbnail URL
   * @param {string} originalIdsStr - Original IDs trước correctFileIds
   * @param {Object} fileNamesMap - Map tile_id → file_name UUID (optional, for better detection)
   * @returns {string} - File IDs đã cập nhật (tile IDs mới nếu re-upload)
   */
  async function reuploadMissingFiles(fileIdsStr, thumbnailMap, originalIdsStr, fileNamesMap) {
    if (!fileIdsStr) return fileIdsStr;
    const ids = fileIdsStr.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return fileIdsStr;

    log('[reuploadMissingFiles] Input IDs:', ids);
    console.log(`[REUPLOAD_AUDIT] reuploadMissingFiles ENTRY — ${ids.length} IDs: ${ids.map(id => id.substring(0, 18)).join(', ')}`);
    console.log(`[REUPLOAD_AUDIT] fileNamesMap FULL: ${JSON.stringify(fileNamesMap)}`);
    console.log(`[REUPLOAD_AUDIT] originalIdsStr: ${originalIdsStr || 'null'}`);

    // Map để track tile_id mới cho những file vẫn còn trên page (via file_name)
    const resolvedIds = {}; // oldId → newTileId

    // CRITICAL: Check bằng file_name trước (persistent UUID, reliable hơn tile_id)
    // tile_id session-specific, có thể thay đổi sau DOM re-render
    if (fileNamesMap && window.MessageBridge) {
      const fileNamesToCheck = [];
      const fnToTileId = {}; // file_name → original tile_id
      for (const id of ids) {
        if (id.startsWith('upload_')) continue;
        const fn = fileNamesMap[id];
        if (fn) {
          fileNamesToCheck.push(fn);
          fnToTileId[fn] = id;
        }
      }
      console.log(`[REUPLOAD_AUDIT] fileNamesToCheck (${fileNamesToCheck.length}): ${JSON.stringify(fileNamesToCheck)}`);

      if (fileNamesToCheck.length > 0) {
        try {
          let fnCheck = await window.MessageBridge.checkFilesExist(fileNamesToCheck);
          log('[reuploadMissingFiles] checkFilesExist result:', JSON.stringify(fnCheck));
          console.log(`[REUPLOAD_AUDIT] checkFilesExist RESULT: existing=${JSON.stringify(fnCheck?.existing)}, missing=${JSON.stringify(fnCheck?.missing)}`);

          // Bug fix 2026-06-07 / 2026-06-15: nếu có missing → force zoom+scroll Flow tab + recheck.
          // ensureFlowTilesLoaded mặc định skip zoom khi DOM có ≥50 tiles, nhưng heuristic
          // này false-negative cho refs nằm xa trong Flow library (>50 ảnh tổng) →
          // false-missing → reupload duplicate. force=true bỏ qua heuristic + truyền
          // targetFileNames để zoom multi-pass [0.5→0.33→0.25] + scroll quét đến khi thấy
          // ĐỦ ref (early-exit) — fix gốc cho user zoom màn hình to / library lớn.
          if (fnCheck?.missing?.length > 0 && window.MessageBridge?.sendToContentScript) {
            console.log(`[REUPLOAD_AUDIT] ${fnCheck.missing.length} file_name(s) missing → force ensureFlowTilesLoaded(targets) + capture`);
            try {
              const ftl = await window.MessageBridge.sendToContentScript('ensureFlowTilesLoaded', { force: true, targetFileNames: fnCheck.missing });
              console.log(`[REUPLOAD_AUDIT] force ensureFlowTilesLoaded DONE: ${JSON.stringify(ftl)}`);
              // CRITICAL: dùng ftl.found (capture-on-sight) thay vì checkFilesExist quét lại DOM.
              // Flow virtual-scroll gỡ tile khi cuộn → checkFilesExist sau đó sẽ false-missing.
              // found = { file_name → tile_id sống } → resolve trực tiếp, chặn reupload duplicate.
              const foundMap = ftl?.found || {};
              for (const fn of Object.keys(foundMap)) {
                const oldId = fnToTileId[fn];
                if (oldId && foundMap[fn]) {
                  resolvedIds[oldId] = foundMap[fn];
                  console.log(`[REUPLOAD_AUDIT] capture resolve: ${fn} → ${foundMap[fn].substring(0, 18)} (skip reupload)`);
                }
              }
              // recheck phần CÒN LẠI (target không capture được → có thể đã xoá thật) để quyết định
              const remaining = fileNamesToCheck.filter(fn => !(fn in foundMap));
              if (remaining.length > 0) {
                const rc = await window.MessageBridge.checkFilesExist(remaining);
                fnCheck = { existing: [...(fnCheck?.existing || []), ...(rc?.existing || [])], missing: rc?.missing || [] };
              } else {
                fnCheck = { existing: Object.keys(foundMap), missing: [] };
              }
              console.log(`[REUPLOAD_AUDIT] post-capture: existing=${JSON.stringify(fnCheck?.existing)}, missing=${JSON.stringify(fnCheck?.missing)}`);
            } catch (e) {
              log('[reuploadMissingFiles] force ensureFlowTilesLoaded + capture failed:', e.message);
            }
          }

          // Với những file_name còn tồn tại, tìm tile_id mới
          for (const fn of (fnCheck?.existing || [])) {
            const oldTileId = fnToTileId[fn];
            if (!oldTileId) continue;
            try {
              const found = await window.MessageBridge.findTileByFileName(fn);
              if (found?.tileId) {
                resolvedIds[oldTileId] = found.tileId;
                log(`[reuploadMissingFiles] Resolved via file_name: ${oldTileId} → ${found.tileId}`);
              }
            } catch (e) {
              log(`[reuploadMissingFiles] findTileByFileName failed for ${fn}:`, e.message);
            }
          }
        } catch (e) {
          log('[reuploadMissingFiles] checkFilesExist failed:', e.message);
        }
      }
    }

    // Check which tiles are missing (chỉ cho những ID chưa resolve được qua file_name)
    const unresolvedIds = ids.filter(id => !id.startsWith('upload_') && !resolvedIds[id]);
    let missingIds = [];

    if (unresolvedIds.length > 0 && window.MessageBridge) {
      try {
        const check = await window.MessageBridge.checkTilesExist(unresolvedIds);
        missingIds = check?.missing || [];
        log('[reuploadMissingFiles] checkTilesExist result:', JSON.stringify(check));
      } catch (e) {
        log('[reuploadMissingFiles] checkTilesExist failed:', e.message);
        missingIds = [];
      }
    } else if (unresolvedIds.length > 0) {
      missingIds = unresolvedIds.filter(id => {
        return document.querySelectorAll(`[data-tile-id="${id}"]`).length === 0;
      });
    }

    // CRITICAL: Import keys (upload_import_*) luôn missing vì không có trên DOM
    // Chúng cần Tầng 3 CDN fetch để re-upload
    const importKeys = ids.filter(id => id.startsWith('upload_import_'));
    if (importKeys.length > 0) {
      log('[reuploadMissingFiles] Found import keys (force add to missing):', importKeys);
      // Add import keys vào missingIds (dedupe)
      for (const ik of importKeys) {
        if (!missingIds.includes(ik)) missingIds.push(ik);
      }
    }

    log('[reuploadMissingFiles] Missing IDs:', missingIds);

    // Apply resolvedIds (từ file_name check) vào IDs trước khi tiếp tục
    // Những file đã tìm thấy qua file_name không cần reupload, chỉ cần update tile_id
    const applyResolvedIds = () => {
      if (Object.keys(resolvedIds).length === 0) return ids.join(', ');
      const updated = ids.map(id => resolvedIds[id] || id);
      log('[reuploadMissingFiles] Applied resolvedIds:', resolvedIds);
      return updated.join(', ');
    };

    if (missingIds.length === 0) {
      console.log(`[REUPLOAD_AUDIT] EXIT no-missing — ${ids.length} IDs valid (file_name resolved=${Object.keys(resolvedIds).length}, tile_exists check pass)`);
      return applyResolvedIds();
    }

    // Build map: corrected ID → original ID (trước correctFileIds)
    // Cache key = original tile_id, nhưng sau correctFileIds IDs có thể đã đổi
    const originalIds = originalIdsStr
      ? originalIdsStr.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const correctedToOriginal = {};
    if (originalIds.length === ids.length) {
      for (let i = 0; i < ids.length; i++) {
        if (ids[i] !== originalIds[i]) correctedToOriginal[ids[i]] = originalIds[i];
      }
    }

    // Tìm file trong uploadedFileCache (memory + IndexedDB fallback)
    if (!window.uploadedFileCache) window.uploadedFileCache = new Map();
    let reuploadable = missingIds.filter(id => window.uploadedFileCache.has(id));
    if (reuploadable.length < missingIds.length && window.PendingUploadStore) {
      const stillMissing = missingIds.filter(id => !reuploadable.includes(id));
      for (const id of stillMissing) {
        // Tìm bằng ID hiện tại
        let file = await PendingUploadStore.getCachedFile(id);
        // Fallback: tìm bằng original ID (trước correctFileIds đổi tile_id)
        if (!file && correctedToOriginal[id]) {
          file = await PendingUploadStore.getCachedFile(correctedToOriginal[id]);
          if (file) log(`[Tầng 2] Tìm thấy cache bằng original ID ${correctedToOriginal[id].substring(0, 20)}...`);
        }
        if (file) {
          window.uploadedFileCache.set(id, { file });
          reuploadable.push(id);
        }
      }
    }
    // Tầng 2.5: Tìm blob trong Album IndexedDB (image_blobs store — không có TTL)
    // Album lưu blob gốc vĩnh viễn, dùng khi upload cache (24h) đã hết hạn
    if (reuploadable.length < missingIds.length && window.ImageStore) {
      const stillMissing = missingIds.filter(id => !reuploadable.includes(id));
      try {
        // Lấy tất cả album images để match bằng file_id hoặc file_name
        const allImages = await window.ImageStore.getAllImages();
        for (const id of stillMissing) {
          // Trích xuất UUID từ fe_id_ prefix (nếu có)
          const uuid = id.startsWith('fe_id_') ? id.replace('fe_id_', '') : id;

          // Trích xuất file_name (media UUID) từ thumbnail URL của ref
          // ref_thumbnails['fe_id_xxx'] = '...getMediaUrlRedirect?name={file_name}'
          let mediaUuid = null;
          const refThumbUrl = thumbnailMap?.[id];
          if (refThumbUrl) {
            const nameMatch = refThumbUrl.match(/[?&]name=([a-f0-9-]+)/i);
            if (nameMatch) mediaUuid = nameMatch[1];
          }

          // Tìm album image match bằng nhiều tiêu chí
          const albumImg = allImages.find(img => {
            // Match trực tiếp bằng file_id hoặc ID
            if (img.file_id === id || img.file_id === uuid) return true;
            if (img.file_name === uuid || img.file_name === id) return true;
            if (img.id === uuid || img.id === id) return true;
            // Match bằng file_name từ thumbnail URL (quan trọng nhất cho fe_id_ case)
            if (mediaUuid && img.file_name === mediaUuid) return true;
            // Match bằng thumbnail_url của album chứa cùng file_name
            if (mediaUuid && img.thumbnail_url) {
              const imgNameMatch = img.thumbnail_url.match(/[?&]name=([a-f0-9-]+)/i);
              if (imgNameMatch && imgNameMatch[1] === mediaUuid) return true;
            }
            return false;
          });
          log(`[Tầng 2.5] ID ${id} → uuid ${uuid} → albumImg: ${albumImg ? albumImg.id : 'NOT FOUND'}, ${albumImg ? 'file_id=' + albumImg.file_id + ' file_name=' + albumImg.file_name : ''}`);
          if (albumImg) {
            const blob = await window.ImageStore.getFullBlob(albumImg.id);
            if (blob) {
              const file = new File([blob], `album_${uuid.substring(0, 8)}.png`, { type: blob.type || 'image/png' });
              window.uploadedFileCache.set(id, { file, thumbnail: albumImg.thumbnail_url });
              reuploadable.push(id);
              log(`[Tầng 2.5] Tìm thấy blob trong Album cho ${id}`);
            }
          }
        }
      } catch (e) {
        log('[Tầng 2.5] Lỗi tìm album blob:', e.message);
      }
    }

    // Tầng 3: Fetch từ thumbnail URL (Google CDN) — cho album images không có file cache
    if (reuploadable.length < missingIds.length) {
      const stillMissing = missingIds.filter(id => !reuploadable.includes(id));
      for (const id of stillMissing) {
        // Ưu tiên thumbnailMap truyền vào (workflow context), fallback GenTab cache (sidePanel context)
        const thumbUrl = thumbnailMap?.[id] || MediaRegistry.getThumb(id);
        if (!thumbUrl || typeof thumbUrl !== 'string' || !thumbUrl.startsWith('http')) continue;
        try {
          // Fetch full image — bỏ size params cho CDN URLs (lh3), giữ nguyên cho getMediaUrlRedirect
          const fetchUrl = thumbUrl.includes('lh3.') || thumbUrl.includes('googleusercontent.com')
            ? thumbUrl.split('=')[0]
            : thumbUrl;
          let resp;
          const _pat = window._getMediaUrlPattern?.() || 'getMediaUrlRedirect';
          if (fetchUrl.includes(_pat)) {
            log(`[Tầng 3] Fetching via content script for ${id}`);
            resp = await window.MessageBridge.sendToContentScript('fetchImageAsBase64', { url: fetchUrl });
            // Fallback: nếu content script fail (404/CORS khi image bị xóa), thử background.js fetchBlob
            if (!resp?.success) {
              log(`[Tầng 3] Content script failed (${resp?.error || 'unknown'}), trying background.js fetchBlob for ${id}`);
              try {
                resp = await new Promise((resolve, reject) => {
                  chrome.runtime.sendMessage({ action: 'fetchBlob', url: fetchUrl, expectImage: true }, (r) => {
                    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                    resolve(r);
                  });
                });
              } catch (bgErr) {
                log(`[Tầng 3] background.js fetchBlob also failed for ${id}: ${bgErr.message}`);
              }
            }
          } else {
            resp = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ action: 'fetchBlob', url: fetchUrl, expectImage: true }, (r) => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                resolve(r);
              });
            });
          }
          if (resp?.success && resp.base64) {
            const binary = atob(resp.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: 'image/png' });
            const file = new File([blob], `reupload_${id.substring(0, 8)}.png`, { type: 'image/png' });
            window.uploadedFileCache.set(id, { file });
            reuploadable.push(id);
            log(`[Tầng 3] Fetched image from thumbnail URL for ${id}`);
          } else {
            log(`[Tầng 3] fetchBlob/content failed for ${id}: ${resp?.error || 'unknown'}`);
          }
        } catch (err) {
          log(`[Tầng 3] Fetch thumbnail URL failed for ${id}:`, err.message);
        }
      }
    }

    // Fix 3 (2026-06-15) content-hash dedup: trước khi upload, hash nội dung từng file.
    // Nếu cùng hash đã upload trong session NÀY và tile đó VẪN còn trên DOM → reuse tile_id
    // thay vì upload lại. Chống duplicate khi multi-prompt dùng chung 1 ref qua nhiều lần
    // submit (mỗi lần reupload tạo file_name mới → checkFilesExist lần sau không match → lại
    // reupload). Hash index sống theo session (window scope).
    if (!window._reuploadHashIndex) window._reuploadHashIndex = new Map(); // sha256 → tileId
    if (reuploadable.length > 0) {
      try {
        const hashCandidates = []; // { id, tileId } các id có hash trùng tile đã biết
        for (const id of reuploadable) {
          const cached = window.uploadedFileCache.get(id);
          if (!cached?.file) continue;
          const hash = await _sha256HexBuf(await cached.file.arrayBuffer());
          cached._hash = hash; // lưu để store index sau khi upload thành công
          const known = window._reuploadHashIndex.get(hash);
          if (known) hashCandidates.push({ id, tileId: known });
        }
        if (hashCandidates.length > 0 && window.MessageBridge?.checkTilesExist) {
          const tileIds = [...new Set(hashCandidates.map(c => c.tileId))];
          let aliveSet = new Set(); // mặc định rỗng → KHÔNG reuse → upload lại (an toàn)
          try {
            const chk = await window.MessageBridge.checkTilesExist(tileIds);
            const miss = new Set(chk?.missing || []);
            aliveSet = new Set(tileIds.filter(t => !miss.has(t)));
          } catch (_) { /* lỗi check → giữ aliveSet rỗng → fallback upload bình thường */ }
          for (const c of hashCandidates) {
            if (aliveSet.has(c.tileId)) {
              resolvedIds[c.id] = c.tileId;
              log(`[anti-dup] hash reuse ${c.id.substring(0, 18)} → ${c.tileId.substring(0, 18)} (skip reupload)`);
            }
          }
          // Loại các id đã reuse khỏi danh sách cần upload
          reuploadable = reuploadable.filter(id => !resolvedIds[id]);
          missingIds = missingIds.filter(id => !resolvedIds[id]);
        }
      } catch (e) {
        log('[anti-dup] hash dedup skipped:', e.message);
      }
    }

    if (reuploadable.length === 0) {
      log(`${missingIds.length} ref image(s) missing, no cache to re-upload`);
      console.log(`[REUPLOAD_AUDIT] EXIT no-cache — ${missingIds.length} missing, no reuploadable cache (resolved=${Object.keys(resolvedIds).length})`);
      // Apply resolvedIds trước khi filter missing
      const base = ids.map(id => resolvedIds[id] || id);
      return base.filter(id => !missingIds.includes(id)).join(', ');
    }

    log(`Re-uploading ${reuploadable.length} missing ref images...`);
    console.log(`[REUPLOAD_AUDIT] !!! WILL UPLOAD ${reuploadable.length} files: ${reuploadable.map(id => id.substring(0, 18)).join(', ')}`);

    // Ensure Flow tab active trước khi re-upload (giống uploadPendingFiles)
    let reuploadFlowActivation = null;
    if (window.ImmediateUploader) {
      try {
        reuploadFlowActivation = await ImmediateUploader._ensureFlowTabReady();
        if (!reuploadFlowActivation?.isOpen) {
          log('[reuploadMissingFiles] Flow tab không mở, skip re-upload');
          // Apply resolvedIds trước khi filter missing
          const base = ids.map(id => resolvedIds[id] || id);
          return base.filter(id => !missingIds.includes(id)).join(', ');
        }
      } catch (e) {
        log('[reuploadMissingFiles] Không thể kiểm tra Flow tab:', e.message);
      }
    }

    try {
      let newIds = null;
      let reuploadTileDetails = null;

      if (window.MessageBridge) {
        const filesData = [];
        for (const id of reuploadable) {
          const cached = window.uploadedFileCache.get(id);
          if (!cached?.file) continue;
          const arrayBuffer = await cached.file.arrayBuffer();
          const base64 = arrayBufferToBase64(arrayBuffer);
          filesData.push({ name: cached.file.name, type: cached.file.type, base64 });
        }
        if (filesData.length > 0) {
          log(`[Tầng 3] Uploading ${filesData.length} files to Flow via MessageBridge...`);
          const result = await window.MessageBridge.uploadFilesToFlow(filesData);
          newIds = result?.orderedTileIds || result?.tileIds;
          // Capture tileDetails for NEW file_name + thumbnail_url
          reuploadTileDetails = result?.tileDetails || null;
          log(`[Tầng 3] uploadFilesToFlow result: tileIds=${JSON.stringify(newIds)}`);
          if (reuploadTileDetails) log(`[Tầng 3] tileDetails: ${JSON.stringify(reuploadTileDetails)}`);
        }
      } else {
        // content script context: direct DOM upload
        const uploadFn = typeof performFlowImageUpload === 'function' ? performFlowImageUpload : window.performFlowImageUpload;
        if (uploadFn) {
          const files = reuploadable.map(id => window.uploadedFileCache.get(id)?.file).filter(Boolean);
          const dummyBtn = document.createElement('button');
          dummyBtn.style.display = 'none';
          document.body.appendChild(dummyBtn);
          newIds = await uploadFn(files, dummyBtn);
          dummyBtn.remove();
        }
      }

      if (newIds && newIds.length > 0) {
        // Apply resolvedIds (file_name resolve + hash-dedup reuse) trước khi map reupload —
        // các id đã resolve trả về tile_id mới, KHÔNG còn nằm trong reuploadable nên không bị
        // thay nhầm ở vòng dưới (đồng bộ với các early-return path).
        const resultIds = ids.map(id => resolvedIds[id] || id);
        // Build tileDetails map cho callers không có GenTab (popup windows)
        const reuploadDetailsMap = {};
        let idx = 0;
        for (let i = 0; i < resultIds.length; i++) {
          if (reuploadable.includes(resultIds[i]) && idx < newIds.length) {
            const oldId = resultIds[i];
            const newId = newIds[idx];
            resultIds[i] = newId;
            const cached = window.uploadedFileCache.get(oldId);
            if (cached) {
              window.uploadedFileCache.delete(oldId);
              window.uploadedFileCache.set(newId, cached);
              // Fix 3: lưu hash → tile_id mới để lần reupload sau (cùng content) reuse, khỏi duplicate
              if (cached._hash) window._reuploadHashIndex.set(cached._hash, newId);
            }
            // Transfer refImageNames từ old → new key
            // Tier-1 C-2: remap refImageNames qua API GenTab
            window.GenTab?.remapRefImageName(oldId, newId);
            // CRITICAL: Dùng NEW data từ tileDetails thay vì OLD cache
            // tileDetails chứa file_name + thumbnailUrl MỚI từ Flow upload result
            const reupDetail = reuploadTileDetails?.find(d => d.id === newId);
            // MediaRegistry: centralized cache
            // Bug fix: Chỉ fallback về old thumbnail nếu đó là Flow URL (googleusercontent/labs.google)
            // KHÔNG fallback về server URL (labs.seosona.vn) vì đó là URL cũ từ import key
            const isFlowThumbnailUrl = (url) => url && (url.includes('googleusercontent.com') || url.includes('labs.google'));
            if (reupDetail?.thumbnailUrl && isFlowThumbnailUrl(reupDetail.thumbnailUrl)) {
              MediaRegistry.setThumb(newId, reupDetail.thumbnailUrl);
            } else {
              const oldThumb = MediaRegistry.getThumb(oldId);
              if (oldThumb && isFlowThumbnailUrl(oldThumb)) {
                MediaRegistry.setThumb(newId, oldThumb);
              }
              // Nếu không có valid Flow thumbnail, không set gì (để tránh dùng server URL sai)
            }
            MediaRegistry.deleteThumb(oldId);
            if (reupDetail?.file_name) {
              MediaRegistry.setFileName(newId, reupDetail.file_name);
            } else if (MediaRegistry.getFileName(oldId)) {
              MediaRegistry.setFileName(newId, MediaRegistry.getFileName(oldId));
            }
            MediaRegistry.deleteFileName(oldId);
            // Lưu vào details map cho callers không có GenTab
            // Bug fix: Chỉ lưu Flow thumbnail URL, không lưu server URL cũ
            const validThumbUrl = (reupDetail?.thumbnailUrl && isFlowThumbnailUrl(reupDetail.thumbnailUrl))
              ? reupDetail.thumbnailUrl
              : null;
            reuploadDetailsMap[newId] = {
              thumbnailUrl: validThumbUrl,
              file_name: reupDetail?.file_name || null
            };
            idx++;
          }
        }
        // Expose tileDetails cho callers (popup windows không có GenTab)
        window._lastReuploadTileDetails = reuploadDetailsMap;
        return resultIds.filter(Boolean).join(', ');
      }
    } catch (err) {
      log('Re-upload missing files failed:', err);
    }
    // Không restore tab — giữ Flow tab active

    // Apply resolvedIds trước khi filter missing
    const base = ids.map(id => resolvedIds[id] || id);
    return base.filter(id => !missingIds.includes(id)).join(', ');
  }

  // ===== Phase S2.6.2: Use TileResolver for batch resolution =====

  /**
   * Batch resolve file IDs using TileResolver
   * Ưu tiên file_name > thumbnail_url, scan DOM 1 lần
   *
   * @param {Array<{id: string, file_name?: string, thumbnail_url?: string}>} images
   * @returns {Promise<Map<string, string>>} Map of originalId → resolvedTileId
   */
  async function batchResolveRefImages(images) {
    if (!images || images.length === 0) {
      return new Map();
    }

    // Use TileResolver if available
    if (window.TileResolver) {
      log('Using TileResolver.batchResolve for', images.length, 'images');
      const { results, unresolved } = window.TileResolver.batchResolve(images);

      // Handle unresolved - try lazy load + retry
      if (unresolved.length > 0) {
        log(unresolved.length, 'images unresolved, trying lazy load...');

        // Trigger lazy load
        // Fix D2 2026-06-05: MessageBridge KHÔNG có method ensureFlowTilesLoaded direct,
        // dùng sendToContentScript với handler trong content.js.
        if (window.MessageBridge?.sendToContentScript) {
          try {
            await window.MessageBridge.sendToContentScript('ensureFlowTilesLoaded');
          } catch (e) {
            log('ensureFlowTilesLoaded failed:', e.message);
          }
        }

        // Clear failed cache và retry
        window.TileCache?.clearFailed();

        const retry = window.TileResolver.batchResolve(unresolved);

        // Merge results
        for (const [id, tileId] of retry.results) {
          results.set(id, tileId);
        }

        log('After retry:', retry.results.size, 'more resolved');
      }

      return results;
    }

    // Fallback to legacy correctFileIds
    log('TileResolver not available, using legacy correctFileIds');
    const idToUrlMap = {};
    const fileNameMap = {};

    for (const img of images) {
      if (img.thumbnail_url) idToUrlMap[img.id] = img.thumbnail_url;
      if (img.file_name) fileNameMap[img.id] = img.file_name;
    }

    const { correctedIds, changed } = await correctFileIds(
      images.map(i => i.id).join(', '),
      idToUrlMap,
      fileNameMap
    );

    if (!changed) {
      return new Map();
    }

    const correctedList = correctedIds.split(',').map(s => s.trim()).filter(Boolean);
    const results = new Map();

    for (let i = 0; i < images.length && i < correctedList.length; i++) {
      if (images[i].id !== correctedList[i]) {
        results.set(images[i].id, correctedList[i]);
      }
    }

    return results;
  }

  /**
   * Resolve và update file IDs string (dùng cho node.ref_file_ids)
   *
   * @param {string} fileIdsStr - Comma-separated file IDs
   * @param {Object} thumbnailMap - { fileId: thumbnailUrl }
   * @param {Object} fileNameMap - { fileId: fileName }
   * @returns {Promise<string>} - Resolved file IDs string
   */
  async function resolveFileIdsString(fileIdsStr, thumbnailMap, fileNameMap) {
    if (!fileIdsStr) return fileIdsStr;

    const ids = fileIdsStr.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return fileIdsStr;

    // Build images array for batch resolve
    const images = ids
      .filter(id => !id.startsWith('upload_'))
      .map(id => ({
        id,
        file_name: fileNameMap?.[id] || null,
        thumbnail_url: thumbnailMap?.[id] || null
      }))
      .filter(img => img.file_name || img.thumbnail_url);

    if (images.length === 0) {
      return fileIdsStr;
    }

    const results = await batchResolveRefImages(images);

    if (results.size === 0) {
      return fileIdsStr;
    }

    // Apply corrections
    const correctedIds = ids.map(id => results.get(id) || id);
    return correctedIds.join(', ');
  }

  // Expose globally
  window.uploadPendingFiles = uploadPendingFiles;
  window.correctFileIds = correctFileIds;
  window.reuploadMissingFiles = reuploadMissingFiles;
  window.batchResolveRefImages = batchResolveRefImages;
  window.resolveFileIdsString = resolveFileIdsString;
})();
