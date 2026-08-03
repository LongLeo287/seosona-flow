/**
 * ImmediateUploader - Upload ảnh ngay khi user chọn/chụp
 * Giảm storage footprint bằng cách upload trước, chỉ lưu metadata
 *
 * Phase S2.1: Immediate Upload Strategy
 */
class ImmediateUploader {
  // Pending uploads đang xử lý (key → Promise)
  static _uploading = new Map();

  // Upload results (key → {file_name, thumbnail_url, tile_id})
  static _results = new Map();

  // WeakRef để giữ File objects (cho re-upload nếu cần)
  static _fileRefs = new Map();

  // Keys đã bị cancel (upload hoàn thành sẽ skip caching/events)
  static _cancelled = new Set();

  // Serial queue — chỉ 1 upload chạy tại 1 thời điểm (tránh race condition tile_id)
  static _queue = Promise.resolve();

  // Batch activation tracking — defer tab restore đến khi queue drain
  // Tránh race: upload A restore tab → upload B chạy trên inactive tab → fail
  static _pendingCount = 0;
  static _activationState = null; // { previousTabId } — chỉ set từ lần activate đầu tiên

  // [Fix 2026-06-10 #1] Cache timestamp lần SW ping success cuối — tránh spam ping per upload.
  static _lastSwHealthCheckAt = 0;

  /**
   * [Fix 2026-06-10 #1] Ping background service worker với timeout.
   * Detect case SW dead/stuck (Chromium Issue 394523691 — per-profile SW registration fail).
   * Background.js đã có ping handler line 1537 trả {ok: true}.
   *
   * @param {number} timeoutMs - max wait (default 500ms — đủ cho SW wake up cold start ~150-300ms)
   * @returns {Promise<boolean>} true nếu SW alive, false nếu timeout/error
   */
  static async _pingServiceWorker(timeoutMs = 500) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      try {
        chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            console.warn('[ImmediateUploader] SW ping failed:', chrome.runtime.lastError.message);
            resolve(false);
            return;
          }
          resolve(!!response?.ok);
        });
      } catch (e) {
        clearTimeout(timer);
        console.warn('[ImmediateUploader] SW ping exception:', e?.message || e);
        resolve(false);
      }
    });
  }

  /**
   * Ensure Flow tab is ready for upload
   * Nếu tab inactive → tạm activate (Google Flow cần tab active để process upload)
   * CRITICAL: Truyền targetTabId để đảm bảo đúng tab khi có nhiều Flow tabs
   * @returns {Promise<{isOpen: boolean, previousTabId?: number}>}
   */
  static async _ensureFlowTabReady() {
    // TODO CG-8b.6: Khi workflow đang chạy mixed providers, respect ProviderTabLock
    // để không activate Flow tab trong lúc node ChatGPT/Gemini đang giữ tab khác.
    // Hiện tại: brief activation độc lập — có thể conflict nếu user upload trong
    // lúc workflow chạy. Workaround: kiểm tra window.ProviderTabLock?.getState()?.
    // currentActiveTab !== 'flow' → defer upload.
    // Lấy targetTabId từ app.js (sidePanel) hoặc storage session (popup windows)
    let targetTabId = window._targetFlowTabId || null;

    // Popup windows không có _targetFlowTabId → fallback từ storage session
    if (!targetTabId) {
      try {
        const res = await chrome.storage?.session?.get('targetFlowTabId');
        targetTabId = res?.targetFlowTabId || null;
      } catch (e) {
        // storage session không khả dụng
      }
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'ensureFlowTabReady', targetTabId }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[ImmediateUploader] _ensureFlowTabReady chrome.runtime.lastError:', chrome.runtime.lastError.message);
          resolve({ isOpen: false });
          return;
        }
        // [Log 2026-06-13] Echo full response để user diagnose — KHÔNG nuốt error field từ background.
        console.log('[ImmediateUploader] _ensureFlowTabReady response:', response);
        resolve(response || { isOpen: false });
      });
    });
  }

  /**
   * Restore tab cũ sau khi upload xong
   * @param {number|null} previousTabId
   */
  static _restorePreviousTab(previousTabId) {
    if (!previousTabId) return;
    chrome.runtime.sendMessage({ action: 'restorePreviousTab', previousTabId }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ImmediateUploader', _e); });
  }

  /**
   * Upload ảnh ngay lập tức (nếu Flow tab mở/có thể activate)
   * Nếu không, lưu lightweight pending
   *
   * @param {File} file - File object từ input hoặc capture
   * @param {Blob} thumbnail - Compressed thumbnail (≤50KB)
   * @param {Object} options - {name, albumId}
   * @returns {Promise<{success: boolean, key: string, file_name?: string, thumbnail_url?: string, pending?: boolean}>}
   */
  static async upload(file, thumbnail, options = {}) {
    const key = options.key || 'upload_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    // [Fix 2026-06-10 #2] Validate file.size === 0 sớm để tránh silent fail.
    // Root cause profile-corrupt: File object có thể arrive empty (size=0) qua drag/drop
    // hoặc paste khi browser profile data corrupt → arrayBuffer trả empty → base64 empty →
    // Flow nhận 0-byte file → upload accept nhưng tile broken.
    // Return failure object (KHÔNG throw — pattern existing: upload() luôn return object,
    // tránh unhandled rejection ở callers không có .catch như ScreenCapture line 73).
    // Emit `upload:failed` event → app.js global handler (line 10353) tự showToast + sendLog
    // → KHÔNG cần gọi showNotification inline (tránh double-notification).
    if (!file || typeof file.size !== 'number' || file.size === 0) {
      const errMsg = `File is empty or invalid (size=${file?.size}). Có thể do Chrome profile data corrupt — vui lòng thử lại hoặc reload extension.`;
      console.error('[ImmediateUploader] upload rejected — empty file', { key, name: file?.name, size: file?.size });
      window.eventBus?.emit('upload:failed', { key, error: errMsg, code: 'FILE_EMPTY' });
      return { success: false, key, error: errMsg, code: 'FILE_EMPTY' };
    }

    // [Fix 2026-06-10 #1] Service Worker health-check (Chromium Issue 394523691: SW stuck
    // per-profile). Ping background trước khi waste time convert file → catch case SW dead
    // ở profile corrupt → fail fast với clear error.
    // Cache 30s để không spam ping mỗi upload trong session ngắn (MV3 SW idle timeout = 30s).
    const SW_PING_CACHE_MS = 30000;
    const lastCheck = this._lastSwHealthCheckAt || 0;
    if (Date.now() - lastCheck > SW_PING_CACHE_MS) {
      const swAlive = await this._pingServiceWorker(500);
      if (!swAlive) {
        const errMsg = 'Extension service worker is not responding. Vui lòng tắt/bật lại extension trong chrome://extensions/ rồi thử lại.';
        console.error('[ImmediateUploader] upload rejected — SW dead', { key });
        window.eventBus?.emit('upload:failed', { key, error: errMsg, code: 'SW_NOT_RESPONDING' });
        return { success: false, key, error: errMsg, code: 'SW_NOT_RESPONDING' };
      }
      this._lastSwHealthCheckAt = Date.now();
    }

    // CRITICAL: Check duplicate - skip nếu key đã đang upload
    const existing = this._uploading.get(key);
    if (existing) {
      console.log(`[ImmediateUploader] Skip duplicate upload: ${key}`);
      // Nếu existing là Promise thì trả về, nếu là true thì return pending indicator
      if (existing !== true) {
        return existing;
      }
      // existing === true nghĩa là đang trong queue, return success để caller không retry
      return { success: true, key, pending: true, duplicate: true };
    }

    // Store WeakRef để re-upload nếu cần
    this._fileRefs.set(key, new WeakRef(file));

    // S2.5 fix: Set marker ngay để isUploading() = true từ đầu
    // (GenTab render ngay sau gọi upload, trước khi ensureFlowTabReady resolve)
    this._uploading.set(key, true);

    // Track pending count cho batch activation
    this._pendingCount++;

    // Ensure Flow tab ready (tự activate nếu inactive)
    const flowState = await this._ensureFlowTabReady();

    if (flowState.isOpen) {
      // Track activation state — chỉ lưu previousTabId từ lần activate ĐẦU TIÊN
      // Các lần sau thấy tab đã active (do lần đầu activate) → wasActivated=false
      if (flowState.wasActivated && !this._activationState) {
        this._activationState = { previousTabId: flowState.previousTabId };
      }

      // Serial queue: chỉ 1 upload chạy tại 1 thời điểm
      // Tránh race condition khi 2 upload cùng detect 1 new tile
      const uploadTask = this._queue.then(async () => {
        try {
          return await this._uploadImmediate(key, file, thumbnail, options);
        } finally {
          this._pendingCount--;
          // Không restore tab — giữ Flow tab active để user thấy kết quả
          if (this._pendingCount <= 0) {
            this._activationState = null;
            this._pendingCount = 0; // safety reset
          }
        }
      });
      this._queue = uploadTask.catch(function (_e) { globalThis.SEOSONA_swallow?.('ImmediateUploader', _e); }); // Prevent queue break on error
      return uploadTask;
    } else {
      // Flow tab không tồn tại → xóa counter + marker, lưu lightweight pending.
      // [Fix 2026-06-13] Pass reason để _saveLightweightPending emit upload:pending kèm context
      // → popup workflow editor có safety net toast (silent fail trước đây).
      console.warn('[ImmediateUploader] Flow tab NOT ready → fallback pending. flowState:', flowState);
      this._pendingCount--;
      this._uploading.delete(key);
      return this._saveLightweightPending(key, file, thumbnail, options, { reason: 'NO_FLOW_TAB' });
    }
  }

  /**
   * Upload ngay lập tức qua MessageBridge
   * @private
   */
  static async _uploadImmediate(key, file, thumbnail, options) {
    console.log(`[ImmediateUploader] Uploading: ${file.name}`);

    // Tránh duplicate upload (marker true từ upload(), promise từ lần gọi trước)
    const existing = this._uploading.get(key);
    if (existing && existing !== true) {
      return existing;
    }

    // Set marker TRƯỚC khi tạo IIFE — upload:started emit sync trong IIFE,
    // GenTab handler check hasAnyUploading() ngay lúc đó → phải thấy marker
    // (upload() path đã set marker, nhưng uploadPending() gọi trực tiếp → thiếu)
    this._uploading.set(key, true);

    const uploadPromise = (async () => {
      let emitEvent = null; // Defer emit đến sau _uploading.delete (tránh re-render khi isUploading vẫn true)
      let emitData = null;
      let returnResult = null;

      try {
        // Emit progress event (upload:started CẦN fire sớm để UI hiện gradient sweep)
        window.eventBus?.emit('upload:started', { key, fileName: file.name });

        // Convert File to base64 (MessageBridge expects {name, type, base64} format)
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        const base64 = btoa(binary);

        // Debug: check MessageBridge availability
        if (!window.MessageBridge) {
          console.error('[ImmediateUploader] MessageBridge not available!');
          throw new Error('MessageBridge not available');
        }

        console.log(`[ImmediateUploader] Calling MessageBridge.uploadFilesToFlow for ${file.name}`);

        // Upload qua MessageBridge
        const result = await window.MessageBridge.uploadFilesToFlow([{
          name: file.name,
          type: file.type,
          base64,
          key
        }]);

        console.log(`[ImmediateUploader] uploadFilesToFlow result:`, result);

        // 2026-05-27: Flow từ chối ảnh vi phạm — notify đã do MessageBridge.uploadFilesToFlow lo
        // (đúng context sidebar/editor). Ở đây chỉ fail rõ ràng để dừng node + báo error badge.
        if (result?.error === 'UPLOAD_BLOCKED') {
          const reason = result.errorMessage || window.I18n?.t('workflow.uploadBlockedReason') || 'Flow từ chối ảnh (vi phạm chính sách nội dung).';
          console.warn(`[ImmediateUploader] Flow blocked upload "${file.name}": ${reason}`);
          const err = new Error(`UPLOAD_BLOCKED: ${reason}`);
          err.code = 'UPLOAD_BLOCKED';
          throw err;
        }

        if (!result?.orderedTileIds?.[0] && !result?.tileIds?.[0]) {
          throw new Error('Upload failed - no tile ID returned');
        }
        const tileId = result.orderedTileIds?.[0] || result.tileIds[0];

        // Ưu tiên dùng tileDetails từ uploadFilesToFlow (đã extract và chờ thumbnail đúng)
        // Fallback về _extractIdentifiersFromTile nếu không có tileDetails
        const tileDetail = result.tileDetails?.[0];
        let fileName = tileDetail?.file_name || null;
        let thumbnailUrl = tileDetail?.thumbnailUrl || null;

        // Fallback: poll DOM nếu tileDetails không có thumbnail hợp lệ
        if (!thumbnailUrl || thumbnailUrl.startsWith('blob:') || thumbnailUrl.includes('placeholder')) {
          console.log(`[ImmediateUploader] tileDetails thumbnail invalid, falling back to DOM poll`);
          const identifiers = await this._extractIdentifiersFromTile(tileId);
          fileName = fileName || identifiers?.fileName || null;
          thumbnailUrl = identifiers?.thumbnailUrl || thumbnailUrl || null;
        }

        const uploadResult = {
          success: true,
          key,
          tile_id: tileId,
          file_name: fileName,
          thumbnail_url: thumbnailUrl,
          pending: false
        };

        // S2.5: Check nếu key đã bị cancel trong lúc upload
        if (this._cancelled.has(key)) {
          console.log(`[ImmediateUploader] Upload completed but cancelled, skipping: ${key}`);
          this._cancelled.delete(key);
          returnResult = { success: false, key, cancelled: true };
          return returnResult;
        }

        // Cache result
        this._results.set(key, uploadResult);

        // Cache trong TileCache (dùng fileName/thumbnailUrl đã extract ở trên)
        if (fileName) {
          window.TileCache?.set(fileName, tileId);
        }
        if (thumbnailUrl) {
          window.TileCache?.set(thumbnailUrl, tileId);
        }

        // Persist file blob vào IndexedDB cache với tile_id MỚI (key) để reuploadMissingFiles
        // Tầng 2 recover được khi tile mất khỏi Flow DOM (vd Flow page reloaded giữa save
        // task và run task). Trước fix: ImmediateUploader chỉ lưu memory WeakRef → memory lost
        // → run task drop ref orphan → user thấy thiếu ảnh upload local.
        if (window.PendingUploadStore) {
          try {
            await window.PendingUploadStore.cacheUploaded(tileId, file);
          } catch (cacheErr) {
            console.warn('[ImmediateUploader] cacheUploaded failed:', cacheErr?.message);
          }
        }

        console.log(`[ImmediateUploader] Upload success: ${key}`, uploadResult);

        // Defer emit — sẽ fire SAU _uploading.delete trong finally
        emitEvent = 'upload:completed';
        emitData = uploadResult;
        returnResult = uploadResult;
        return returnResult;

      } catch (err) {
        console.warn(`[ImmediateUploader] Upload deferred to pending: ${key}`, err.message);

        // Defer emit — sẽ fire SAU _uploading.delete trong finally
        emitEvent = 'upload:failed';
        emitData = { key, error: err.message };

        returnResult = await this._saveLightweightPending(key, file, thumbnail, options);
        return returnResult;

      } finally {
        // Xóa _uploading TRƯỚC khi emit → re-render sẽ thấy isUploading=false
        this._uploading.delete(key);
        if (emitEvent) {
          window.eventBus?.emit(emitEvent, emitData);
        }
      }
    })();

    // Cập nhật marker thành actual promise (cho FileUploader await)
    this._uploading.set(key, uploadPromise);
    return uploadPromise;
  }

  /**
   * Extract identifiers từ tile sau khi upload
   * Polling với retry thay vì fixed delay (tile có thể chưa complete trên mạng chậm)
   * @private
   */
  static async _extractIdentifiersFromTile(tileId) {
    // Tab inactive: Chrome throttle React rendering → tile có thể chưa complete
    // Tăng retry budget: 12 lần × 1s = tối đa 12s (đủ cho cả tab active & inactive)
    const maxAttempts = 12;
    const intervalMs = 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise(r => setTimeout(r, intervalMs));

      try {
        const result = await window.MessageBridge?.sendToContentScript('extractTileIdentifiers', { tileId });
        if (result?.fileName) {
          // file_name có = tile đã complete
          return { fileName: result.fileName, thumbnailUrl: result.thumbnailUrl };
        }
        if (result?.thumbnailUrl && attempt >= 4) {
          // Có thumbnail nhưng chưa có file_name — chấp nhận sau 4 lần thử
          return { fileName: null, thumbnailUrl: result.thumbnailUrl };
        }
      } catch (e) {
        console.warn(`[ImmediateUploader] extractTileIdentifiers attempt ${attempt} failed:`, e.message);
      }
    }

    // Fallback: trả về null identifiers — tile_id vẫn valid, file_name sẽ được resolve sau
    console.warn(`[ImmediateUploader] extractTileIdentifiers exhausted for ${tileId}, continuing with null identifiers`);
    return null;
  }

  /**
   * Lưu lightweight pending (chỉ thumbnail, không lưu full blob)
   * @private
   */
  static async _saveLightweightPending(key, file, thumbnail, options, meta = {}) {
    console.log(`[ImmediateUploader] Saving lightweight pending: ${key}`, meta.reason ? `(reason: ${meta.reason})` : '');

    try {
      // Lưu metadata thumbnail (cho UI render preview)
      await window.PendingUploadStore?.saveLightweight(key, {
        thumbnail,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        name: options.name,
        albumId: options.albumId
      });

      // Persist file blob luôn với upload_xxx key — cho phép run task sau (memory đã GC)
      // vẫn upload được qua uploadPendingFiles fallback. Trước fix: chỉ WeakRef trong memory
      // → reload sidebar → file blob mất → orphan upload_xxx bị drop khi run task.
      if (window.PendingUploadStore) {
        try {
          await window.PendingUploadStore.cacheUploaded(key, file);
        } catch (cacheErr) {
          console.warn('[ImmediateUploader] saveLightweightPending cacheUploaded failed:', cacheErr?.message);
        }
      }

      // Giữ WeakRef cho file (memory) — fast path khi cùng session
      this._fileRefs.set(key, new WeakRef(file));

      window.eventBus?.emit('upload:pending', { key, fileName: file.name, reason: meta.reason || null });

      return {
        success: true,
        key,
        pending: true,
        file_name: null,
        thumbnail_url: null
      };

    } catch (err) {
      console.error(`[ImmediateUploader] Save pending failed: ${key}`, err.message);
      return {
        success: false,
        key,
        error: err.message
      };
    }
  }

  /**
   * Upload pending file khi Flow tab mở
   * @param {string} key
   * @returns {Promise<Object>}
   */
  static async uploadPending(key) {
    // Try get file từ WeakRef (ImmediateUploader's internal storage)
    const ref = this._fileRefs.get(key);
    let file = ref?.deref?.();
    let thumbnail = null;
    let pendingData = null;

    // Fallback: check window.pendingUploadFiles (GenTab/ImagePickerModal uploads)
    if (!file && window.pendingUploadFiles?.has(key)) {
      const cached = window.pendingUploadFiles.get(key);
      file = cached?.file;
      thumbnail = cached?.thumbnail;
      console.log(`[ImmediateUploader] Found file in pendingUploadFiles: ${key}`);
    }

    if (!file) {
      console.log(`[ImmediateUploader] File GC'd, removing stale pending: ${key}`);
      // File bị GC → entry này sẽ không bao giờ upload được, cleanup luôn
      await window.PendingUploadStore?.removeLightweight(key).catch(function (_e) { globalThis.SEOSONA_swallow?.('ImmediateUploader#uploadPromise', _e); });
      this._fileRefs.delete(key);
      return {
        success: false,
        key,
        needReselect: true,
        error: 'File no longer available'
      };
    }

    // Get thumbnail từ pending store if not already set
    if (!thumbnail) {
      pendingData = await window.PendingUploadStore?.getLightweight(key);
      thumbnail = pendingData?.thumbnail;
    }

    // Upload
    const result = await this._uploadImmediate(key, file, thumbnail, {
      name: pendingData?.name || window.GenTab?.refImageNames?.[key],
      albumId: pendingData?.albumId
    });

    if (result.success && !result.pending) {
      // Cleanup pending entry
      await window.PendingUploadStore?.removeLightweight(key);
      // Also cleanup pendingUploadFiles
      window.pendingUploadFiles?.delete(key);

      // Transfer refImageNames to new tile_id
      // Tier-1 C-2: remap refImageNames qua API GenTab (giữ log)
      const _remappedName = window.GenTab?.remapRefImageName(key, result.tile_id);
      if (_remappedName) console.log(`[ImmediateUploader] Transferred name "${_remappedName}" to ${result.tile_id?.substring(0, 20)}...`);
    }

    return result;
  }

  /**
   * Upload tất cả pending files
   * @returns {Promise<{uploaded: number, failed: number, needReselect: string[]}>}
   */
  static async uploadAllPending() {
    const pendingKeys = await window.PendingUploadStore?.getAllLightweightKeys() || [];

    if (pendingKeys.length === 0) {
      return { uploaded: 0, failed: 0, needReselect: [] };
    }

    const flowState = await this._ensureFlowTabReady();
    if (!flowState.isOpen) {
      console.log('[ImmediateUploader] Flow tab not open, skipping batch upload');
      return { uploaded: 0, failed: 0, needReselect: [] };
    }

    let uploaded = 0;
    let failed = 0;
    const needReselect = [];

    try {
      for (const key of pendingKeys) {
        const result = await this.uploadPending(key);

        if (result.success && !result.pending) {
          uploaded++;
        } else if (result.needReselect) {
          needReselect.push(key);
        } else {
          failed++;
        }
      }
    } finally {
      // Không restore tab — giữ Flow tab active
      // Reset activation state
      this._activationState = null;
      this._pendingCount = 0;
    }

    console.log(`[ImmediateUploader] Batch upload: ${uploaded} success, ${failed} failed, ${needReselect.length} need re-select`);

    return { uploaded, failed, needReselect };
  }

  /**
   * Get upload result by key
   * @param {string} key
   * @returns {Object|null}
   */
  static getResult(key) {
    return this._results.get(key) || null;
  }

  /**
   * Check if file still available (not GC'd)
   * @param {string} key
   * @returns {boolean}
   */
  static isFileAvailable(key) {
    const ref = this._fileRefs.get(key);
    return ref?.deref?.() !== undefined;
  }

  /**
   * Cancel upload đang chạy — upload hoàn thành sẽ skip cache/events
   * Cleanup pendingUploadFiles + lightweight_pending
   * @param {string} key
   */
  static cancel(key) {
    if (!key) return;

    // Đánh dấu cancelled để _uploadImmediate skip khi hoàn thành
    if (this._uploading.has(key)) {
      this._cancelled.add(key);
      console.log(`[ImmediateUploader] Cancelled in-flight upload: ${key}`);
    }

    // Cleanup tất cả references
    this._fileRefs.delete(key);
    this._results.delete(key);
    window.pendingUploadFiles?.delete(key);
    window.PendingUploadStore?.removeLightweight(key).catch(function (_e) { globalThis.SEOSONA_swallow?.('ImmediateUploader#uploadPromise', _e); });

    window.eventBus?.emit('upload:cancelled', { key });
  }

  /**
   * Cancel nhiều keys cùng lúc
   * @param {Iterable<string>} keys
   */
  static cancelAll(keys) {
    for (const key of keys) {
      this.cancel(key);
    }
  }

  /**
   * Check xem key đang upload hay không
   * @param {string} key
   * @returns {boolean}
   */
  static isUploading(key) {
    return this._uploading.has(key);
  }

  /**
   * Check xem có bất kỳ upload nào đang chạy không
   * @returns {boolean}
   */
  static hasAnyUploading() {
    return this._uploading.size > 0;
  }

  /**
   * Cleanup old entries
   * @param {number} maxAgeMs
   */
  static cleanup(maxAgeMs = 2 * 60 * 60 * 1000) {
    // Cleanup fileRefs cho các entries không còn trong results
    for (const [key, ref] of this._fileRefs) {
      if (!ref.deref()) {
        this._fileRefs.delete(key);
      }
    }
  }
}

// Export
window.ImmediateUploader = ImmediateUploader;
