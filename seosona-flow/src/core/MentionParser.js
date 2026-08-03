/**
 * MentionParser - Parser cho @mention syntax trong prompts
 * Hỗ trợ reference ảnh bằng tên: @nhan_vat, @background_1
 */
class MentionParser {
  // Regex: @followed by unicode letters/numbers/underscore (L6: support Vietnamese mentions e.g. @cô_gái)
  static MENTION_REGEX = /@([\p{L}\p{N}_]+)/gu;

  /**
   * Parse prompt để extract mentions
   * @param {string} prompt
   * @returns {Array<{fullMatch, imageName, index}>}
   */
  static parseMentions(prompt) {
    if (!prompt || typeof prompt !== 'string') return [];

    const mentions = [];
    let match;
    const regex = new RegExp(this.MENTION_REGEX.source, 'g');

    while ((match = regex.exec(prompt)) !== null) {
      mentions.push({
        fullMatch: match[0],      // "@nhan_vat"
        imageName: match[1],      // "nhan_vat"
        index: match.index
      });
    }

    return mentions;
  }

  /**
   * Clean prompt - remove @mentions, normalize whitespace
   * @param {string} prompt
   * @returns {string}
   */
  static cleanPrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') return '';
    return prompt
      .replace(this.MENTION_REGEX, '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Resolve mentions - lookup registry và trả về image data
   * @param {Array} mentions - Từ parseMentions()
   * @returns {Array<{mention, imageData, found}>}
   */
  static resolveMentions(mentions) {
    if (!window.imageNameRegistry) {
      console.warn('[MentionParser] ImageNameRegistry chưa khởi tạo');
      return mentions.map(m => ({ mention: m, imageData: null, found: false }));
    }

    return mentions.map(mention => {
      const imageData = window.imageNameRegistry.lookup(mention.imageName);
      return {
        mention,
        imageData,
        found: !!imageData
      };
    });
  }

  /**
   * Process multi-prompt với @mention
   * @param {string[]} prompts - Array of prompts
   * @returns {Array<{originalPrompt, cleanedPrompt, mentions, refImages}>}
   */
  static processMultiPrompts(prompts) {
    if (!prompts || !Array.isArray(prompts)) return [];

    return prompts.map(prompt => {
      const mentions = this.parseMentions(prompt);
      const resolved = this.resolveMentions(mentions);
      const cleanedPrompt = this.cleanPrompt(prompt);

      // Lấy ref images từ resolved mentions
      const refImages = resolved
        .filter(r => r.found)
        .map(r => r.imageData);

      return {
        originalPrompt: prompt,
        cleanedPrompt,
        mentions: resolved,
        refImages,
        hasUnresolvedMentions: resolved.some(r => !r.found)
      };
    });
  }

  /**
   * Process single prompt với @mention
   * @param {string} prompt
   * @returns {{originalPrompt, cleanedPrompt, mentions, refImages, hasUnresolvedMentions}}
   */
  static processPrompt(prompt) {
    const results = this.processMultiPrompts([prompt]);
    return results[0] || {
      originalPrompt: prompt || '',
      cleanedPrompt: '',
      mentions: [],
      refImages: [],
      hasUnresolvedMentions: false
    };
  }

  /**
   * Upload pending images từ mentions (local/capture)
   * Cần chạy trước khi submit prompts
   * @param {Array} processedPrompts - Từ processMultiPrompts()
   * @returns {Promise<Array>} - Updated processed prompts với file_ids
   */
  static async uploadPendingImages(processedPrompts) {
    if (!processedPrompts || !Array.isArray(processedPrompts)) {
      return processedPrompts;
    }

    // Collect all unique images cần upload (tránh upload trùng)
    const imagesToUpload = new Map();  // blob_key → { ref, imageData }

    // Collect pending refs (upload_xxx without blob_key) separately
    const pendingRefs = [];

    for (const pp of processedPrompts) {
      if (!pp.refImages || !Array.isArray(pp.refImages)) continue;

      for (const ref of pp.refImages) {
        // Case 1: Album images có blob_key - cần upload blob từ IndexedDB
        if ((ref.type === 'upload' || ref.type === 'capture' || ref.source === 'album') &&
            ref.blob_key && (!ref.file_id || ref.file_id.startsWith('upload_'))) {
          if (!imagesToUpload.has(ref.blob_key)) {
            imagesToUpload.set(ref.blob_key, { ref, imageData: ref });
          }
        }
        // Case 2: Pending uploads (file_id = "upload_xxx") - file nằm trong pendingUploadFiles Map
        else if (ref.file_id && ref.file_id.startsWith('upload_') && !ref.blob_key) {
          // Mark để xử lý riêng - sẽ upload qua uploadPendingFiles
          if (!ref._pendingUploadKey) {
            ref._pendingUploadKey = ref.file_id;
          }
          pendingRefs.push(ref);
        }
      }
    }

    // Return early only if BOTH album uploads AND pending uploads are empty
    if (imagesToUpload.size === 0 && pendingRefs.length === 0) {
      console.log('[MentionParser] uploadPendingImages: No images to upload');
      return processedPrompts;
    }

    // Upload tất cả ảnh song song (Phase 1: album images)
    const uploadResults = new Map();  // blob_key → { tileId, file_name, thumbnail_url }
    const uploadPromises = [];

    // Ensure Flow tab active trước khi upload album images
    // (Google Flow cần tab active để process file injection)
    let mentionFlowActivation = null;
    if (imagesToUpload.size > 0) {
      console.log(`[MentionParser] Chuẩn bị upload ${imagesToUpload.size} ảnh từ album...`);
      if (window.ImmediateUploader) {
        try {
          mentionFlowActivation = await window.ImmediateUploader._ensureFlowTabReady();
          if (!mentionFlowActivation?.isOpen) {
            console.warn('[MentionParser] Flow tab không mở, skip album image upload');
            imagesToUpload.clear(); // Skip upload phase
          }
        } catch (e) {
          console.warn('[MentionParser] Không thể kiểm tra Flow tab:', e.message);
        }
      }
    }

    for (const [blobKey, { ref, imageData }] of imagesToUpload) {
      uploadPromises.push(
        this._uploadImage(imageData).then(fileId => {
          if (fileId) {
            // Capture file_name + thumbnail_url từ imageData (populated by _uploadImage)
            uploadResults.set(blobKey, {
              tileId: fileId,
              file_name: imageData._uploadedFileName || null,
              thumbnail_url: imageData._uploadedThumbnailUrl || null
            });
            console.log(`[MentionParser] Đã upload: ${imageData.name} → ${fileId}` +
              (imageData._uploadedFileName ? ` (file_name: ${imageData._uploadedFileName.substring(0, 12)}...)` : ''));
          }
        }).catch(err => {
          console.error(`[MentionParser] Lỗi upload ${imageData.name}:`, err.message || err);
        })
      );
    }

    await Promise.all(uploadPromises);

    // Không restore tab — giữ Flow tab active để user thấy kết quả

    // Cập nhật file_id + file_name cho tất cả refs dùng chung blob_key
    if (uploadResults.size > 0) {
      for (const pp of processedPrompts) {
        if (!pp.refImages) continue;
        for (const ref of pp.refImages) {
          if (ref.blob_key && uploadResults.has(ref.blob_key)) {
            const uploadResult = uploadResults.get(ref.blob_key);
            ref.file_id = uploadResult.tileId;
            // CRITICAL: Transfer file_name từ upload result để cross-project validation hoạt động
            if (uploadResult.file_name) ref.file_name = uploadResult.file_name;
            if (uploadResult.thumbnail_url) ref.thumbnail_url = uploadResult.thumbnail_url;
          }
        }
      }

      // Cập nhật ImageNameRegistry với file_ids + file_names mới (cho lần sử dụng sau)
      if (window.imageNameRegistry) {
        for (const pp of processedPrompts) {
          if (!pp.refImages) continue;
          for (const ref of pp.refImages) {
            if (ref.name && ref.file_id && window.imageNameRegistry.has(ref.name)) {
              const existing = window.imageNameRegistry.lookup(ref.name);
              if (existing) {
                if (!existing.file_id) existing.file_id = ref.file_id;
                if (ref.file_name && !existing.file_name) existing.file_name = ref.file_name;
              }
            }
          }
        }
      }

      console.log(`[MentionParser] Upload hoàn tất: ${uploadResults.size}/${imagesToUpload.size} thành công`);
    }

    // Phase 2: Handle pending uploads (file_id = "upload_xxx", no blob_key)
    // pendingRefs already collected above
    // Filter refs that still need upload (file_id still starts with upload_)
    const pendingRefsToUpload = pendingRefs.filter(ref => ref.file_id?.startsWith('upload_'));

    if (pendingRefsToUpload.length > 0 && typeof window.uploadPendingFiles === 'function') {
      console.log(`[MentionParser] Uploading ${pendingRefsToUpload.length} pending files...`);

      // Collect unique pending keys in order
      const pendingKeys = [];
      const seenKeys = new Set();
      for (const ref of pendingRefsToUpload) {
        if (!seenKeys.has(ref._pendingUploadKey)) {
          pendingKeys.push(ref._pendingUploadKey);
          seenKeys.add(ref._pendingUploadKey);
        }
      }
      const pendingIdsStr = pendingKeys.join(', ');

      try {
        const uploadedStr = await window.uploadPendingFiles(pendingIdsStr);
        console.log(`[MentionParser] uploadPendingFiles returned: "${uploadedStr}"`);
        const uploadedIds = uploadedStr.split(',').map(s => s.trim()).filter(Boolean);

        // Map old keys to new IDs (matching by order)
        const keyToNewId = new Map();
        for (let i = 0; i < pendingKeys.length && i < uploadedIds.length; i++) {
          const newId = uploadedIds[i];
          if (newId && !newId.startsWith('upload_')) {
            keyToNewId.set(pendingKeys[i], newId);
            console.log(`[MentionParser] Mapped: ${pendingKeys[i]} → ${newId.substring(0, 25)}...`);
          }
        }

        // Update refs with new file_ids
        for (const ref of pendingRefsToUpload) {
          const newId = keyToNewId.get(ref._pendingUploadKey);
          if (newId) {
            ref.file_id = newId;
            console.log(`[MentionParser] Updated ref "${ref.name}": file_id = ${newId.substring(0, 25)}...`);
          } else {
            console.warn(`[MentionParser] No mapping found for ref "${ref.name}" (${ref._pendingUploadKey})`);
          }
        }
      } catch (err) {
        console.error('[MentionParser] Pending upload failed:', err.message || err);
      }
    }

    return processedPrompts;
  }

  /**
   * Upload single image to Flow (với retry cho network errors)
   * @private
   * @param {Object} imageData - { name, type, blob_key, ... }
   * @param {number} maxRetries - Số lần retry tối đa (default: 2)
   * @returns {Promise<string|null>} - Flow tile ID hoặc null
   */
  static async _uploadImage(imageData, maxRetries = 2) {
    if (!imageData.blob_key) {
      console.warn('[MentionParser] Không có blob_key:', imageData.name);
      return null;
    }

    // 1. Lấy blob từ ImageStore (chỉ làm 1 lần)
    let blob = null;
    if (window.ImageStore) {
      blob = await window.ImageStore.getFullBlob(imageData.blob_key);
    }

    if (!blob) {
      console.warn('[MentionParser] Không tìm thấy blob:', imageData.blob_key);
      return null;
    }

    // 2. Tạo File object từ Blob
    const fileName = imageData.original_name || imageData.name || 'album_image.png';
    const file = new File([blob], fileName, { type: blob.type || 'image/png' });

    // 3. Upload với retry logic
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const tileId = await this._doUpload(file, imageData);
        if (tileId) return tileId;

        // Upload trả về null nhưng không throw — không retry
        return null;
      } catch (err) {
        lastError = err;

        // Chỉ retry cho network errors, không retry HTTP errors
        const isNetworkError = !err.httpStatus &&
          (err.message?.includes('network') ||
           err.message?.includes('Failed to fetch') ||
           err.message?.includes('Network') ||
           err.message?.includes('timeout') ||
           err.name === 'TypeError');

        if (!isNetworkError || attempt >= maxRetries) {
          console.error(`[MentionParser] Lỗi upload ảnh (attempt ${attempt + 1}/${maxRetries + 1}):`, err.message || err);
          return null;
        }

        // Exponential backoff: 500ms, 1000ms, 2000ms
        const delay = Math.min(500 * Math.pow(2, attempt), 2000);
        console.warn(`[MentionParser] Upload failed, retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return null;
  }

  /**
   * Thực hiện upload (helper cho _uploadImage)
   * @private
   */
  static async _doUpload(file, imageData) {
    // Upload qua MessageBridge (nếu trong sidePanel context)
    if (window.MessageBridge) {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = this._arrayBufferToBase64(arrayBuffer);

      const result = await window.MessageBridge.uploadFilesToFlow([{
        name: file.name,
        type: file.type,
        base64
      }]);

      if (result?.tileIds?.length > 0) {
        const tileId = result.tileIds[0];

        // Capture file_name + thumbnail_url từ tileDetails
        // CRITICAL: Dùng data MỚI từ Flow, không dùng album CDN URL cũ
        const detail = result.tileDetails?.[0];
        if (detail) {
          if (detail.file_name) imageData._uploadedFileName = detail.file_name;
          if (detail.thumbnailUrl) imageData._uploadedThumbnailUrl = detail.thumbnailUrl;
        }

        // Cache file cho re-upload nếu tile biến mất
        if (window.PendingUploadStore) {
          await window.PendingUploadStore.cacheUploaded(tileId, file);
        } else if (window.uploadedFileCache) {
          window.uploadedFileCache.set(tileId, { file });
        }

        // (Optional) Cập nhật ImageStore với file_id mới
        if (window.ImageStore && imageData.id) {
          try {
            const image = await window.ImageStore.getImage(imageData.id);
            if (image) {
              image.file_id = tileId;
              const db = await window.ImageStore._getDB();
              await new Promise((resolve, reject) => {
                const tx = db.transaction('album_images', 'readwrite');
                tx.objectStore('album_images').put(image);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
              });
            }
          } catch (e) {
            console.warn('[MentionParser] Không thể cập nhật ImageStore:', e.message);
          }
        }

        return tileId;
      }

      if (result?.warning) {
        console.warn('[MentionParser] Upload warning:', result.warning);
      }

      return null;
    }

    // Content script context: direct DOM upload
    const uploadFn = typeof performFlowImageUpload === 'function'
      ? performFlowImageUpload
      : window.performFlowImageUpload;

    if (uploadFn) {
      const dummyBtn = document.createElement('button');
      dummyBtn.style.display = 'none';
      document.body.appendChild(dummyBtn);

      try {
        const uploadedIds = await uploadFn([file], dummyBtn);
        if (uploadedIds?.length > 0) {
          return uploadedIds[0];
        }
      } finally {
        dummyBtn.remove();
      }
    } else {
      console.warn('[MentionParser] Không có phương thức upload khả dụng');
    }

    return null;
  }

  /**
   * Helper: Convert ArrayBuffer to Base64 (chunked để tránh stack overflow)
   * @private
   */
  static _arrayBufferToBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  /**
   * Check if prompt has any mentions
   * @param {string} prompt
   * @returns {boolean}
   */
  static hasMentions(prompt) {
    if (!prompt || typeof prompt !== 'string') return false;
    // Reset regex lastIndex
    const regex = new RegExp(this.MENTION_REGEX.source, 'g');
    return regex.test(prompt);
  }

  /**
   * Get list of unresolved mentions (không tìm thấy trong registry)
   * @param {string} prompt
   * @returns {string[]} Array of image names không tìm thấy
   */
  static getUnresolvedMentions(prompt) {
    const mentions = this.parseMentions(prompt);
    const resolved = this.resolveMentions(mentions);
    return resolved
      .filter(r => !r.found)
      .map(r => r.mention.imageName);
  }

  /**
   * Get list of resolved mentions (tìm thấy trong registry)
   * @param {string} prompt
   * @returns {Array} Array of imageData objects
   */
  static getResolvedImages(prompt) {
    const mentions = this.parseMentions(prompt);
    const resolved = this.resolveMentions(mentions);
    return resolved
      .filter(r => r.found)
      .map(r => r.imageData);
  }

  /**
   * Highlight mentions trong prompt (cho UI preview)
   * @param {string} prompt
   * @returns {string} HTML với mentions được highlight
   */
  static highlightMentions(prompt) {
    if (!prompt || typeof prompt !== 'string') return '';

    // H10: HTML-escape non-mention text so callers assigning to innerHTML are safe.
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const regex = new RegExp(this.MENTION_REGEX.source, 'gu');
    let out = '';
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(prompt)) !== null) {
      out += esc(prompt.slice(lastIndex, match.index));
      const name = match[1];
      const found = window.imageNameRegistry?.has(name);
      const className = found ? 'mention mention-found' : 'mention mention-not-found';
      out += `<span class="${className}">${esc(match[0])}</span>`;
      lastIndex = match.index + match[0].length;
    }
    out += esc(prompt.slice(lastIndex));
    return out;
  }

  /**
   * Extract unique image names từ prompt
   * @param {string} prompt
   * @returns {string[]} Unique image names
   */
  static extractUniqueNames(prompt) {
    const mentions = this.parseMentions(prompt);
    const names = mentions.map(m => m.imageName.toLowerCase());
    return [...new Set(names)];
  }

  /**
   * Count số mentions trong prompt
   * @param {string} prompt
   * @returns {number}
   */
  static countMentions(prompt) {
    const mentions = this.parseMentions(prompt);
    return mentions.length;
  }

  // ===== Phase S2.6: Batch Resolution Integration =====

  /**
   * Batch resolve file_ids cho tất cả ref images (sử dụng TileResolver)
   * Scan DOM 1 lần để resolve nhiều ảnh
   *
   * @param {Array} processedPrompts - Từ processMultiPrompts()
   * @returns {Promise<{resolved: number, unresolved: Array}>}
   */
  static async batchResolveFileIds(processedPrompts) {
    if (!processedPrompts || !Array.isArray(processedPrompts)) {
      return { resolved: 0, unresolved: [] };
    }

    // 1. Collect all unique images cần resolve
    const imagesToResolve = [];
    const seenIds = new Set();

    for (const pp of processedPrompts) {
      if (!pp.refImages) continue;

      for (const ref of pp.refImages) {
        // Skip nếu đã có file_id
        if (ref.file_id) continue;

        // Cần có identifier để resolve
        if (!ref.file_name && !ref.thumbnail_url) continue;

        // Dedupe
        const key = ref.id || ref.blob_key || `${ref.file_name}_${ref.thumbnail_url}`;
        if (seenIds.has(key)) continue;
        seenIds.add(key);

        imagesToResolve.push({
          id: key,
          file_name: ref.file_name,
          thumbnail_url: ref.thumbnail_url,
          _ref: ref  // Keep reference để update
        });
      }
    }

    if (imagesToResolve.length === 0) {
      return { resolved: 0, unresolved: [] };
    }

    console.log(`[MentionParser] Batch resolving ${imagesToResolve.length} images...`);

    // 2. Use TileResolver.batchResolve
    if (!window.TileResolver) {
      console.warn('[MentionParser] TileResolver not available');
      return { resolved: 0, unresolved: imagesToResolve.map(i => i._ref) };
    }

    const { results, unresolved } = window.TileResolver.batchResolve(imagesToResolve);

    // 3. Update refs với resolved tile_ids
    for (const img of imagesToResolve) {
      const tileId = results.get(img.id);
      if (tileId && img._ref) {
        img._ref.file_id = tileId;
      }
    }

    // 4. Handle unresolved - try lazy load + retry
    if (unresolved.length > 0) {
      console.log(`[MentionParser] ${unresolved.length} images unresolved, trying lazy load...`);

      // Trigger lazy load
      if (typeof ensureFlowTilesLoaded === 'function') {
        await ensureFlowTilesLoaded();
      }

      // Clear failed cache và retry
      window.TileCache?.clearFailed();

      const retry = window.TileResolver.batchResolve(unresolved);

      // Update từ retry
      for (const img of unresolved) {
        const tileId = retry.results.get(img.id);
        if (tileId && img._ref) {
          img._ref.file_id = tileId;
        }
      }

      const finalUnresolved = retry.unresolved.map(i => i._ref);

      console.log(`[MentionParser] After retry: ${retry.results.size} more resolved, ${finalUnresolved.length} still unresolved`);

      return {
        resolved: results.size + retry.results.size,
        unresolved: finalUnresolved
      };
    }

    console.log(`[MentionParser] Batch resolved: ${results.size}/${imagesToResolve.length}`);

    return {
      resolved: results.size,
      unresolved: []
    };
  }

  /**
   * Upload pending images với batch resolution
   * Phase S2.6: Tích hợp ImmediateUploader
   *
   * @param {Array} processedPrompts
   * @returns {Promise<Array>}
   */
  static async uploadPendingImagesBatch(processedPrompts) {
    if (!processedPrompts || !Array.isArray(processedPrompts)) {
      return processedPrompts;
    }

    // 1. Try batch resolve first (cho ảnh đã upload nhưng cần refresh tile_id)
    try {
      await this.batchResolveFileIds(processedPrompts);
    } catch (err) {
      console.warn('[MentionParser] batchResolveFileIds failed:', err.message);
    }

    // 2. Check if có refs cần upload (file_id bắt đầu bằng "upload_")
    let hasLocalUploads = false;
    for (const pp of processedPrompts) {
      if (!pp.refImages) continue;
      for (const ref of pp.refImages) {
        if (ref.file_id?.startsWith('upload_')) {
          hasLocalUploads = true;
          break;
        }
      }
      if (hasLocalUploads) break;
    }

    if (!hasLocalUploads) {
      console.log('[MentionParser] uploadPendingImagesBatch: No local uploads need processing');
      return processedPrompts;
    }

    // 3. Luôn dùng uploadPendingImages (legacy) vì nó ổn định hơn
    console.log('[MentionParser] uploadPendingImagesBatch: Using uploadPendingImages for local uploads');
    return this.uploadPendingImages(processedPrompts);
  }
}

// Export
window.MentionParser = MentionParser;
