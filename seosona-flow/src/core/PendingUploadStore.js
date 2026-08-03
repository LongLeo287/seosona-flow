/**
 * PendingUploadStore - Lưu trữ ảnh upload local vào IndexedDB
 * Giải quyết vấn đề mất dữ liệu khi reload extension
 * IndexedDB hỗ trợ Blob/File trực tiếp, không giới hạn dung lượng
 */
class PendingUploadStore {
  static DB_NAME = 'seosonaflow_pro';
  static STORE_NAME = 'pending_uploads';
  static CACHE_STORE = 'uploaded_cache';
  static LIGHTWEIGHT_STORE = 'lightweight_pending';  // Phase S2.4
  static WORKFLOW_PASTE_STORE = 'workflow_paste_blobs';  // v1.1 paste image feature (NO TTL)
  static DB_VERSION = 4;  // v4: add workflow_paste_blobs store (paste image feature)
  static MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2h (reduced from 24h)
  static CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h (reduced from 7d)
  static PASTE_BLOB_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days grace after upload success

  static _db = null;

  /**
   * Mở/tạo IndexedDB (version 2 với Album stores)
   */
  static _getDB() {
    if (this._db) return Promise.resolve(this._db);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // === Version 1 stores ===
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(this.CACHE_STORE)) {
          db.createObjectStore(this.CACHE_STORE, { keyPath: 'key' });
        }

        // === Version 2 stores (Album feature) ===
        if (!db.objectStoreNames.contains('albums')) {
          const albumStore = db.createObjectStore('albums', { keyPath: 'id' });
          albumStore.createIndex('name', 'name', { unique: false });
          albumStore.createIndex('updated_at', 'updated_at', { unique: false });
        }
        if (!db.objectStoreNames.contains('album_images')) {
          const imageStore = db.createObjectStore('album_images', { keyPath: 'id' });
          imageStore.createIndex('album_id', 'album_id', { unique: false });
          imageStore.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('image_blobs')) {
          db.createObjectStore('image_blobs', { keyPath: 'id' });
        }

        // === Version 3 stores (Phase S2: Lightweight storage) ===
        if (!db.objectStoreNames.contains(this.LIGHTWEIGHT_STORE)) {
          const lwStore = db.createObjectStore(this.LIGHTWEIGHT_STORE, { keyPath: 'key' });
          lwStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // === Version 4 stores (Paste image feature — NO TTL persistent) ===
        // Pattern reference: album_images store (no auto-cleanup, user-curated data lifecycle).
        // Cleanup chỉ khi: upload success + 3 ngày grace OR workflow deleted (cascade).
        if (!db.objectStoreNames.contains(this.WORKFLOW_PASTE_STORE)) {
          const pasteStore = db.createObjectStore(this.WORKFLOW_PASTE_STORE, { keyPath: 'id' });
          pasteStore.createIndex('workflow_id', 'workflow_id', { unique: false });
          pasteStore.createIndex('upload_status', 'upload_status', { unique: false });
          pasteStore.createIndex('created_at', 'created_at', { unique: false });
        }

        console.log('[PendingUploadStore] IndexedDB upgraded to version', this.DB_VERSION);
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => {
        console.error('[PendingUploadStore] IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Helper: thực hiện transaction trên store
   */
  static async _tx(storeName, mode, callback) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const result = callback(store);

      tx.oncomplete = () => resolve(result._result);
      tx.onerror = () => reject(tx.error);

      // Wrap IDBRequest
      if (result instanceof IDBRequest) {
        result._result = undefined;
        result.onsuccess = () => { result._result = result.result; };
      }
    });
  }

  // ===== PENDING UPLOADS =====

  /**
   * @deprecated Phase S2 — Dùng ImmediateUploader.upload() hoặc saveLightweight() thay thế.
   * Method này lưu full blob (~5MB/ảnh), gây phình storage.
   * Giữ lại để backward compatibility nhưng KHÔNG nên gọi.
   */
  static async save(key, file, thumbnail) {
    try {
      const db = await this._getDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        store.put({
          key,
          file,
          thumbnail,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          createdAt: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      // Đồng thời set vào memory
      if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
      window.pendingUploadFiles.set(key, { file, thumbnail });

      console.log('[PendingUploadStore] Saved:', key, file.name);
    } catch (err) {
      console.warn('[PendingUploadStore] Save failed:', key, err.message);
      // Fallback: chỉ lưu memory
      if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
      window.pendingUploadFiles.set(key, { file, thumbnail });
    }
  }

  /**
   * Khôi phục tất cả pending uploads từ IndexedDB vào memory
   * Gọi khi init app
   */
  static async restore() {
    try {
      const db = await this._getDB();
      const entries = await new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });

      if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();

      let restored = 0;
      let cleaned = 0;

      for (const entry of entries) {
        // Auto cleanup entries cũ hơn 24h
        if (Date.now() - entry.createdAt > this.MAX_AGE_MS) {
          await this.remove(entry.key);
          cleaned++;
          continue;
        }

        // Khôi phục vào memory
        if (entry.file) {
          window.pendingUploadFiles.set(entry.key, {
            file: entry.file,
            thumbnail: entry.thumbnail
          });
          restored++;
        }
      }

      if (restored > 0 || cleaned > 0) {
        console.log(`[PendingUploadStore] Restored: ${restored}, cleaned: ${cleaned}`);
      }
    } catch (err) {
      console.warn('[PendingUploadStore] Restore failed:', err.message);
    }
  }

  /**
   * Xóa entry sau khi upload thành công
   */
  static async remove(key) {
    try {
      const db = await this._getDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[PendingUploadStore] Remove failed:', key, err.message);
    }

    window.pendingUploadFiles?.delete(key);
  }

  // ===== UPLOADED CACHE (recovery) =====

  /**
   * Cache file đã upload thành công (để re-upload nếu tile biến mất)
   */
  static async cacheUploaded(realTileId, file) {
    try {
      const db = await this._getDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.CACHE_STORE, 'readwrite');
        const store = tx.objectStore(this.CACHE_STORE);
        store.put({
          key: realTileId,
          file,
          fileName: file.name,
          fileType: file.type,
          createdAt: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      // Đồng thời set vào memory
      if (!window.uploadedFileCache) window.uploadedFileCache = new Map();
      window.uploadedFileCache.set(realTileId, { file });
    } catch (err) {
      console.warn('[PendingUploadStore] Cache uploaded failed:', realTileId, err.message);
      if (!window.uploadedFileCache) window.uploadedFileCache = new Map();
      window.uploadedFileCache.set(realTileId, { file });
    }
  }

  /**
   * Khôi phục uploaded cache từ IndexedDB
   */
  static async restoreCache() {
    try {
      const db = await this._getDB();
      const entries = await new Promise((resolve, reject) => {
        const tx = db.transaction(this.CACHE_STORE, 'readonly');
        const store = tx.objectStore(this.CACHE_STORE);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });

      if (!window.uploadedFileCache) window.uploadedFileCache = new Map();

      let restored = 0;
      for (const entry of entries) {
        // Cleanup cũ hơn 14 giờ (7 × MAX_AGE_MS = 7 × 2h)
        if (Date.now() - entry.createdAt > 7 * this.MAX_AGE_MS) {
          await this._removeCache(entry.key);
          continue;
        }
        if (entry.file) {
          window.uploadedFileCache.set(entry.key, { file: entry.file });
          restored++;
        }
      }

      if (restored > 0) {
        console.log(`[PendingUploadStore] Restored uploaded cache: ${restored}`);
      }
    } catch (err) {
      console.warn('[PendingUploadStore] Restore cache failed:', err.message);
    }
  }

  /**
   * Xóa entry khỏi uploaded cache
   */
  static async _removeCache(key) {
    try {
      const db = await this._getDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.CACHE_STORE, 'readwrite');
        const store = tx.objectStore(this.CACHE_STORE);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      // Soft fail
    }
  }

  /**
   * Lấy file từ uploaded cache (memory first, fallback IndexedDB)
   */
  static async getCachedFile(realTileId) {
    // Memory first
    if (window.uploadedFileCache?.has(realTileId)) {
      return window.uploadedFileCache.get(realTileId).file;
    }

    // Fallback IndexedDB
    try {
      const db = await this._getDB();
      const entry = await new Promise((resolve, reject) => {
        const tx = db.transaction(this.CACHE_STORE, 'readonly');
        const store = tx.objectStore(this.CACHE_STORE);
        const request = store.get(realTileId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      if (entry?.file) {
        // Khôi phục vào memory
        if (!window.uploadedFileCache) window.uploadedFileCache = new Map();
        window.uploadedFileCache.set(realTileId, { file: entry.file });
        return entry.file;
      }
    } catch (err) {
      // Soft fail
    }

    return null;
  }

  // ===== LIGHTWEIGHT PENDING (Phase S2.4) =====

  /**
   * Lưu lightweight pending (chỉ thumbnail, không lưu full blob)
   * @param {string} key
   * @param {Object} data - {thumbnail, fileName, fileSize, fileType, name?, albumId?}
   */
  static async saveLightweight(key, data) {
    try {
      const db = await this._getDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.LIGHTWEIGHT_STORE, 'readwrite');
        const store = tx.objectStore(this.LIGHTWEIGHT_STORE);
        store.put({
          key,
          thumbnail: data.thumbnail,  // ≤50KB WebP
          // Không lưu full file blob
          fileName: data.fileName,
          fileType: data.fileType,
          fileSize: data.fileSize,
          name: data.name || null,       // @mention name
          albumId: data.albumId || null,
          createdAt: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      console.log('[PendingUploadStore] Saved lightweight:', key);
    } catch (err) {
      console.warn('[PendingUploadStore] Save lightweight failed:', key, err.message);
      throw err;
    }
  }

  /**
   * Get lightweight pending entry
   * @param {string} key
   * @returns {Promise<Object|null>}
   */
  static async getLightweight(key) {
    try {
      const db = await this._getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.LIGHTWEIGHT_STORE, 'readonly');
        const store = tx.objectStore(this.LIGHTWEIGHT_STORE);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('[PendingUploadStore] Get lightweight failed:', key, err.message);
      return null;
    }
  }

  /**
   * Get all lightweight pending keys
   * @returns {Promise<string[]>}
   */
  static async getAllLightweightKeys() {
    try {
      const db = await this._getDB();
      const entries = await new Promise((resolve, reject) => {
        const tx = db.transaction(this.LIGHTWEIGHT_STORE, 'readonly');
        const store = tx.objectStore(this.LIGHTWEIGHT_STORE);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });

      // Filter out expired entries
      const validKeys = [];
      for (const entry of entries) {
        if (Date.now() - entry.createdAt <= this.MAX_AGE_MS) {
          validKeys.push(entry.key);
        } else {
          // Cleanup expired
          await this.removeLightweight(entry.key);
        }
      }

      return validKeys;
    } catch (err) {
      console.warn('[PendingUploadStore] Get all lightweight keys failed:', err.message);
      return [];
    }
  }

  /**
   * Remove lightweight pending entry
   * @param {string} key
   */
  static async removeLightweight(key) {
    try {
      const db = await this._getDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.LIGHTWEIGHT_STORE, 'readwrite');
        const store = tx.objectStore(this.LIGHTWEIGHT_STORE);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[PendingUploadStore] Remove lightweight failed:', key, err.message);
    }
  }

  /**
   * Restore lightweight pending entries vào window.pendingUploadFiles
   * Bug fix: Trước đây chỉ restore() từ "pendingUploads" store (deprecated, empty)
   * Lightweight data (thumbnail) từ "lightweight_pending" store KHÔNG được restore
   * → Thumbnail mất khi đóng/mở lại workflow
   * @returns {Promise<number>} - Số entries đã restore
   */
  static async restoreLightweight() {
    try {
      const db = await this._getDB();
      const entries = await new Promise((resolve, reject) => {
        const tx = db.transaction(this.LIGHTWEIGHT_STORE, 'readonly');
        const store = tx.objectStore(this.LIGHTWEIGHT_STORE);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });

      if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();

      let restored = 0;
      let cleaned = 0;

      for (const entry of entries) {
        // Auto cleanup entries cũ hơn 24h
        if (Date.now() - entry.createdAt > this.MAX_AGE_MS) {
          await this.removeLightweight(entry.key);
          cleaned++;
          continue;
        }

        // Restore vào pendingUploadFiles với thumbnail
        // Lưu ý: lightweight KHÔNG có file blob, chỉ có metadata + thumbnail
        if (entry.thumbnail && !window.pendingUploadFiles.has(entry.key)) {
          window.pendingUploadFiles.set(entry.key, {
            file: null,  // Không có file blob trong lightweight storage
            thumbnail: entry.thumbnail,
            fileName: entry.fileName,
            fileType: entry.fileType,
            fileSize: entry.fileSize,
            _isLightweight: true  // Flag để biết cần re-fetch file nếu cần upload
          });
          restored++;
        }
      }

      if (restored > 0 || cleaned > 0) {
        console.log(`[PendingUploadStore] Restored lightweight: ${restored}, cleaned: ${cleaned}`);
      }

      return restored;
    } catch (err) {
      console.warn('[PendingUploadStore] Restore lightweight failed:', err.message);
      return 0;
    }
  }

  /**
   * Cleanup old entries (Phase S2.4)
   * @param {number} maxAgeMs - Max age in milliseconds
   */
  static async cleanupOldEntries(maxAgeMs = this.MAX_AGE_MS) {
    const cleaned = { pending: 0, lightweight: 0, cache: 0 };

    try {
      const db = await this._getDB();

      // Cleanup pending_uploads
      const pendingEntries = await new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });

      for (const entry of pendingEntries) {
        if (Date.now() - entry.createdAt > maxAgeMs) {
          await this.remove(entry.key);
          cleaned.pending++;
        }
      }

      // Cleanup lightweight_pending
      const lwEntries = await new Promise((resolve, reject) => {
        const tx = db.transaction(this.LIGHTWEIGHT_STORE, 'readonly');
        const store = tx.objectStore(this.LIGHTWEIGHT_STORE);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });

      for (const entry of lwEntries) {
        if (Date.now() - entry.createdAt > maxAgeMs) {
          await this.removeLightweight(entry.key);
          cleaned.lightweight++;
        }
      }

      if (cleaned.pending > 0 || cleaned.lightweight > 0) {
        console.log(`[PendingUploadStore] Cleaned: ${cleaned.pending} pending, ${cleaned.lightweight} lightweight`);
      }
    } catch (err) {
      console.warn('[PendingUploadStore] Cleanup failed:', err.message);
    }

    return cleaned;
  }

  /**
   * Cleanup old uploaded cache (Phase S2.4)
   * @param {number} maxAgeMs - Max age in milliseconds (default 24h)
   */
  static async cleanupOldCache(maxAgeMs = this.CACHE_MAX_AGE_MS) {
    let cleaned = 0;

    try {
      const db = await this._getDB();
      const entries = await new Promise((resolve, reject) => {
        const tx = db.transaction(this.CACHE_STORE, 'readonly');
        const store = tx.objectStore(this.CACHE_STORE);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });

      for (const entry of entries) {
        if (Date.now() - entry.createdAt > maxAgeMs) {
          await this._removeCache(entry.key);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`[PendingUploadStore] Cleaned cache: ${cleaned} entries`);
      }
    } catch (err) {
      console.warn('[PendingUploadStore] Cache cleanup failed:', err.message);
    }

    return cleaned;
  }

  // ============================================================================
  // === Workflow Paste Image Blobs (v1.1 paste image feature) ================
  // ============================================================================
  // Pattern: NO TTL persistent storage (giống album_images). Lưu File blob khi
  // user paste/drop ảnh vào workflow editor, đảm bảo blob không bị mất sau 2h
  // (gap của pending_uploads/lightweight_pending). Cleanup chỉ qua:
  //   - upload success + 3 ngày grace period (defensive vs race condition)
  //   - workflow deleted (cascade by workflow_id index)
  //   - manual user clear

  /**
   * Save paste blob to persistent IndexedDB (no TTL).
   * @param {object} entry — {id (tempId upload_xxx), blob (File), fileName, mimeType,
   *                          size_bytes, workflow_id, upload_status?, created_at?, upload_attempts?}
   */
  static async savePasteBlob(entry) {
    if (!entry?.id || !entry?.blob) {
      console.warn('[PendingUploadStore] savePasteBlob missing id/blob');
      return false;
    }
    try {
      const db = await this._getDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.WORKFLOW_PASTE_STORE, 'readwrite');
        const store = tx.objectStore(this.WORKFLOW_PASTE_STORE);
        store.put({
          id: entry.id,
          blob: entry.blob,
          fileName: entry.fileName || 'pasted-image.png',
          mimeType: entry.mimeType || entry.blob?.type || 'image/png',
          size_bytes: entry.size_bytes ?? entry.blob?.size ?? 0,
          workflow_id: entry.workflow_id || null,
          upload_status: entry.upload_status || 'pending',
          real_file_id: entry.real_file_id || null,
          created_at: entry.created_at || Date.now(),
          upload_attempts: entry.upload_attempts || 0,
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      // L13: on quota exceeded, sweep old blobs then surface a clear error the UI can show.
      if (err && err.name === 'QuotaExceededError') {
        console.warn('[PendingUploadStore] savePasteBlob quota exceeded → sweeping and cleaning up');
        try {
          await this.sweepUploadedPasteBlobs();
          await this.cleanupOldEntries();
          await this.cleanupOldCache();
        } catch (_) { globalThis.SEOSONA_swallow?.('PendingUploadStore#onerror', _); }
        const e = new Error('Bộ nhớ cục bộ đã đầy (quota). Vui lòng xoá bớt ảnh/workflow cũ rồi thử lại.');
        e.name = 'QuotaExceededError';
        throw e;
      }
      console.warn('[PendingUploadStore] savePasteBlob failed:', err?.message);
      return false;
    }
  }

  /**
   * Get paste blob by tempId.
   * @returns {Promise<object|null>}
   */
  static async getPasteBlob(tempId) {
    if (!tempId) return null;
    try {
      const db = await this._getDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(this.WORKFLOW_PASTE_STORE, 'readonly');
        const store = tx.objectStore(this.WORKFLOW_PASTE_STORE);
        const req = store.get(tempId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (err) {
      console.warn('[PendingUploadStore] getPasteBlob failed:', err?.message);
      return null;
    }
  }

  /**
   * Mark paste blob as uploaded → schedule delete sau PASTE_BLOB_GRACE_MS (3 ngày).
   * Grace period defensive vs race condition với re-render node hoặc undo action.
   */
  static async markPasteBlobUploaded(tempId, realFileId) {
    if (!tempId) return false;
    try {
      const existing = await this.getPasteBlob(tempId);
      if (!existing) return false;
      const db = await this._getDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.WORKFLOW_PASTE_STORE, 'readwrite');
        const store = tx.objectStore(this.WORKFLOW_PASTE_STORE);
        store.put({
          ...existing,
          upload_status: 'success',
          real_file_id: realFileId || existing.real_file_id || null,
          uploaded_at: Date.now(),
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
      // Schedule cleanup 3 ngày sau (defensive grace period)
      setTimeout(() => {
        this.deletePasteBlob(tempId).catch(function (_e) { globalThis.SEOSONA_swallow?.('PendingUploadStore#onerror', _e); });
      }, this.PASTE_BLOB_GRACE_MS);
      return true;
    } catch (err) {
      console.warn('[PendingUploadStore] markPasteBlobUploaded failed:', err?.message);
      return false;
    }
  }

  /**
   * Mark paste blob upload failed — increment attempts.
   */
  static async markPasteBlobFailed(tempId, errorMessage) {
    if (!tempId) return false;
    try {
      const existing = await this.getPasteBlob(tempId);
      if (!existing) return false;
      const db = await this._getDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.WORKFLOW_PASTE_STORE, 'readwrite');
        const store = tx.objectStore(this.WORKFLOW_PASTE_STORE);
        store.put({
          ...existing,
          upload_status: 'failed',
          upload_attempts: (existing.upload_attempts || 0) + 1,
          last_error: errorMessage || 'unknown',
          last_attempt_at: Date.now(),
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch (err) {
      console.warn('[PendingUploadStore] markPasteBlobFailed failed:', err?.message);
      return false;
    }
  }

  /**
   * Delete single paste blob (after upload success grace period OR user action).
   */
  static async deletePasteBlob(tempId) {
    if (!tempId) return false;
    try {
      const db = await this._getDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(this.WORKFLOW_PASTE_STORE, 'readwrite');
        const store = tx.objectStore(this.WORKFLOW_PASTE_STORE);
        store.delete(tempId);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (err) {
      console.warn('[PendingUploadStore] deletePasteBlob failed:', err?.message);
      return false;
    }
  }

  /**
   * Cascade delete tất cả paste blobs của 1 workflow (gọi khi workflow deleted).
   * @returns {Promise<number>} count deleted
   */
  static async deletePasteBlobsForWorkflow(workflowId) {
    if (!workflowId) return 0;
    try {
      const db = await this._getDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.WORKFLOW_PASTE_STORE, 'readwrite');
        const store = tx.objectStore(this.WORKFLOW_PASTE_STORE);
        const index = store.index('workflow_id');
        const req = index.openCursor(IDBKeyRange.only(workflowId));
        let deleted = 0;
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();
            deleted++;
            cursor.continue();
          } else {
            // wait tx.oncomplete
          }
        };
        tx.oncomplete = () => {
          if (deleted > 0) {
            console.log(`[PendingUploadStore] Cascade deleted ${deleted} paste blobs for workflow ${workflowId}`);
          }
          resolve(deleted);
        };
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[PendingUploadStore] deletePasteBlobsForWorkflow failed:', err?.message);
      return 0;
    }
  }

  /**
   * Get all pending paste blobs cho 1 workflow (cho retry on workflow load).
   * @param {string} workflowId
   * @returns {Promise<object[]>}
   */
  static async getPendingPasteBlobs(workflowId) {
    if (!workflowId) return [];
    try {
      const db = await this._getDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(this.WORKFLOW_PASTE_STORE, 'readonly');
        const store = tx.objectStore(this.WORKFLOW_PASTE_STORE);
        const index = store.index('workflow_id');
        const req = index.getAll(workflowId);
        req.onsuccess = () => {
          const all = req.result || [];
          // Pending OR failed (could retry)
          resolve(all.filter(r => r.upload_status === 'pending' || r.upload_status === 'failed'));
        };
        req.onerror = () => resolve([]);
      });
    } catch (err) {
      console.warn('[PendingUploadStore] getPendingPasteBlobs failed:', err?.message);
      return [];
    }
  }

  /**
   * M15: Startup sweep for successfully-uploaded paste blobs.
   * The per-blob 3-day delete is a live setTimeout that is lost when the MV3
   * service worker is suspended/reloaded → full-res blobs would leak forever in
   * IndexedDB. This sweep deletes `upload_status === 'success'` blobs whose
   * grace window (uploaded_at + PASTE_BLOB_GRACE_MS, falling back to created_at)
   * has elapsed. Idempotent and safe to call at init.
   * @returns {Promise<number>} count deleted
   */
  static async sweepUploadedPasteBlobs() {
    try {
      const db = await this._getDB();
      const now = Date.now();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.WORKFLOW_PASTE_STORE, 'readwrite');
        const store = tx.objectStore(this.WORKFLOW_PASTE_STORE);
        const index = store.index('upload_status');
        const req = index.openCursor(IDBKeyRange.only('success'));
        let deleted = 0;
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const rec = cursor.value || {};
            const uploadedAt = rec.uploaded_at || rec.created_at || 0;
            if (now - uploadedAt >= this.PASTE_BLOB_GRACE_MS) {
              cursor.delete();
              deleted++;
            }
            cursor.continue();
          }
        };
        tx.oncomplete = () => {
          if (deleted > 0) {
            console.log(`[PendingUploadStore] Startup sweep deleted ${deleted} uploaded paste blobs past grace`);
          }
          resolve(deleted);
        };
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[PendingUploadStore] sweepUploadedPasteBlobs failed:', err?.message);
      return 0;
    }
  }
}

/**
 * Scheduled cleanup — gọi định kỳ để dọn entries hết hạn
 * Tránh IndexedDB phình dần khi entries expired không được dọn
 */
PendingUploadStore._scheduleCleanup = function() {
  async function _runCleanup() {
    try {
      await PendingUploadStore.cleanupOldEntries();
      await PendingUploadStore.cleanupOldCache();
      // M15: sweep uploaded paste blobs past grace (timer may be lost on SW reload).
      await PendingUploadStore.sweepUploadedPasteBlobs();
      // Cleanup old album image blobs (đọc setting, fallback 7 ngày)
      if (window.ImageStore) {
        const maxDays = window.storageSettings?.getSettings?.()?.blobMaxAgeDays || 7;
        await window.ImageStore.cleanupOldBlobs(maxDays);
      }
    } catch (e) {
      // Soft fail
    }
  }

  // Chạy cleanup lần đầu sau 30s (để app init xong)
  setTimeout(async () => {
    await _runCleanup();
    console.log('[PendingUploadStore] Initial cleanup done');
  }, 30000);

  // Sau đó mỗi 2 giờ
  setInterval(_runCleanup, 2 * 60 * 60 * 1000);
};

// Export
window.PendingUploadStore = PendingUploadStore;
