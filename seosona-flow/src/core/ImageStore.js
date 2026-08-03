/**
 * ImageStore - Quản lý album images và blobs trong IndexedDB
 * Lưu trữ metadata trong album_images, blobs trong image_blobs
 */
class ImageStore {
  static DB_NAME = 'seosonaflow_pro';
  static STORE_IMAGES = 'album_images';
  static STORE_BLOBS = 'image_blobs';
  static DB_VERSION = 4;  // Must match PendingUploadStore & AlbumStore (v4 = paste image feature)
  static MAX_THUMBNAIL_SIZE = 50 * 1024;  // 50KB
  static MEDIUM_MAX_SIZE = 1200;  // 1200px max dimension for medium quality
  static MEDIUM_QUALITY = 0.85;  // WebP quality for medium
  static BLOB_DEFAULT_MAX_AGE_DAYS = 7;  // Default, actual value from user settings

  static _db = null;

  /**
   * Mở IndexedDB (sử dụng chung với AlbumStore)
   */
  static async _getDB() {
    // Dùng chung DB connection với AlbumStore nếu đã mở
    if (window.AlbumStore?._db) {
      this._db = window.AlbumStore._db;
      return this._db;
    }

    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Stores cũ
        if (!db.objectStoreNames.contains('pending_uploads')) {
          db.createObjectStore('pending_uploads', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('uploaded_cache')) {
          db.createObjectStore('uploaded_cache', { keyPath: 'key' });
        }

        // Stores mới
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
        if (!db.objectStoreNames.contains('lightweight_pending')) {
          const lwStore = db.createObjectStore('lightweight_pending', { keyPath: 'key' });
          lwStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // === Version 4 stores (Paste image feature) ===
        // Idempotent: PendingUploadStore.onupgradeneeded cũng tạo store này nếu chưa có.
        // Cần định nghĩa ở ALL 3 classes (ImageStore/AlbumStore/PendingUploadStore) vì class
        // nào mở DB trước (fresh install) sẽ fire onupgradeneeded duy nhất → phải tạo đủ.
        if (!db.objectStoreNames.contains('workflow_paste_blobs')) {
          const pasteStore = db.createObjectStore('workflow_paste_blobs', { keyPath: 'id' });
          pasteStore.createIndex('workflow_id', 'workflow_id', { unique: false });
          pasteStore.createIndex('upload_status', 'upload_status', { unique: false });
          pasteStore.createIndex('created_at', 'created_at', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => {
        console.error('[ImageStore] IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Nén thumbnail xuống kích thước nhỏ (WebP)
   * @param {Blob} blob - Ảnh gốc
   * @param {number} maxSize - Kích thước tối đa (bytes)
   * @returns {Blob} Thumbnail đã nén
   */
  static async compressThumbnail(blob, maxSize = this.MAX_THUMBNAIL_SIZE) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Scale xuống max 200px
        const scale = Math.min(200 / img.width, 200 / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Export WebP với quality thấp
        canvas.toBlob(
          (compressedBlob) => {
            if (compressedBlob) {
              resolve(compressedBlob);
            } else {
              reject(new Error('Không thể nén thumbnail'));
            }
          },
          'image/webp',
          0.7
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Không thể load ảnh'));
      };

      img.src = url;
    });
  }

  /**
   * Nén ảnh xuống medium quality (1200px WebP 0.85)
   * Dùng cho local uploads để đảm bảo chất lượng sau reload
   * @param {Blob} blob - Ảnh gốc
   * @returns {Blob} Medium quality blob
   */
  static async compressMedium(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Scale xuống max 1200px (giữ aspect ratio)
        const maxDim = this.MEDIUM_MAX_SIZE;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (compressedBlob) => {
            if (compressedBlob) {
              console.log(`[ImageStore] Medium: ${img.width}x${img.height} → ${width}x${height}, ${(compressedBlob.size / 1024).toFixed(1)}KB`);
              resolve(compressedBlob);
            } else {
              reject(new Error('Không thể nén medium'));
            }
          },
          'image/webp',
          this.MEDIUM_QUALITY
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Không thể load ảnh'));
      };

      img.src = url;
    });
  }

  /**
   * Thêm image vào album
   * 2-Tier Storage:
   * - Thumbnail (200px): Hiển thị grid
   * - Medium (1200px): Upload/sử dụng thực tế (chỉ cho local uploads)
   *
   * @param {string} albumId - ID của album
   * @param {Object} imageData - { name, type, file_id?, file_name?, thumbnail_url?, original_name?, pending_upload_key? }
   * @param {Blob} thumbnailBlob - Thumbnail blob
   * @param {Blob} fullBlob - Full size blob (nén thành medium cho local uploads)
   * @returns {Object} Image object
   */
  static async addImage(albumId, imageData, thumbnailBlob, fullBlob = null) {
    const db = await this._getDB();
    const imageId = crypto.randomUUID();
    const blobKey = `blob_${imageId}`;

    // Nén thumbnail (200px) — Tier 1: compress từ raw input
    let compressedThumb = thumbnailBlob;
    try {
      if (thumbnailBlob && thumbnailBlob.size > this.MAX_THUMBNAIL_SIZE) {
        compressedThumb = await this.compressThumbnail(thumbnailBlob);
      }
    } catch (err) {
      console.warn('[ImageStore] Thumbnail compression failed (tier 1):', err.message);
      compressedThumb = null;
    }

    // Nén medium (1200px) cho local uploads
    // Flow images có CDN backup nên không cần lưu medium
    const isLocalUpload = imageData.type === 'upload' || imageData.type === 'capture';
    let mediumBlob = null;

    if (isLocalUpload && fullBlob && fullBlob instanceof Blob) {
      try {
        mediumBlob = await this.compressMedium(fullBlob);
      } catch (err) {
        console.warn('[ImageStore] Medium compression failed:', err.message);
      }
    }

    // Tier 2: nếu thumbnail null, retry compress từ mediumBlob (đã WebP, browser-safe)
    if (!compressedThumb && mediumBlob) {
      try {
        compressedThumb = await this.compressThumbnail(mediumBlob);
      } catch (err) {
        console.warn('[ImageStore] Thumbnail compression failed (tier 2 from medium):', err.message);
      }
    }
    // Tier 3: vẫn fail → dùng mediumBlob trực tiếp làm thumbnail (nặng hơn nhưng tránh mất ảnh)
    if (!compressedThumb && mediumBlob) {
      compressedThumb = mediumBlob;
    }
    // Tier 4: không có medium (ảnh Flow CDN không lưu medium) → dùng raw blob nếu có
    if (!compressedThumb && fullBlob instanceof Blob) {
      compressedThumb = fullBlob;
    }

    // Tạo image metadata
    const image = {
      id: imageId,
      album_id: albumId,
      name: imageData.name || 'Untitled',
      type: imageData.type || 'image',
      file_id: imageData.file_id || null,
      file_name: imageData.file_name || null,  // UUID persistent
      thumbnail_url: imageData.thumbnail_url || null,  // Backup identifier
      original_name: imageData.original_name || null,
      pending_upload_key: imageData.pending_upload_key || null,  // Ref to lightweight_pending
      blob_key: blobKey,
      thumbnail_blob_key: `thumb_${blobKey}`,
      has_medium_blob: !!mediumBlob,  // Track if medium blob exists
      created_at: Date.now()
    };

    // Tạo blob entry
    const blobEntry = {
      id: blobKey,
      thumbnail_blob: compressedThumb,
      medium_blob: mediumBlob,  // 1200px WebP cho local uploads
      created_at: Date.now()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction([this.STORE_IMAGES, this.STORE_BLOBS], 'readwrite');
      const imageStore = tx.objectStore(this.STORE_IMAGES);
      const blobStore = tx.objectStore(this.STORE_BLOBS);

      imageStore.put(image);
      blobStore.put(blobEntry);

      const self = this;
      tx.oncomplete = async () => {
        // Thêm vào album
        try {
          await window.AlbumStore?.addImageToAlbum(albumId, imageId);
        } catch (e) {
          // Rollback: delete the image and blob we just created.
          // [FIX 2026-07-09] AWAIT rollback trước khi resolve — trước đây fire-and-forget → tx rollback
          // chạy ĐỒNG THỜI với resolve(image) → caller đọc/dùng record đang bị xoá → count drift.
          console.error('[ImageStore] Failed to add image to album, rolling back:', e);
          try {
            await new Promise((rb) => {
              const rollbackTx = db.transaction([self.STORE_IMAGES, self.STORE_BLOBS], 'readwrite');
              rollbackTx.objectStore(self.STORE_IMAGES).delete(imageId);
              if (blobKey) rollbackTx.objectStore(self.STORE_BLOBS).delete(blobKey);
              rollbackTx.oncomplete = rb; rollbackTx.onerror = rb; rollbackTx.onabort = rb;
            });
          } catch (rollbackErr) {
            console.error('[ImageStore] Rollback failed:', rollbackErr);
          }
        }

        console.log('[ImageStore] Image added:', imageId);
        resolve(image);
      };
      tx.onerror = () => {
        const err = tx.error;
        // L13: on quota exceeded, run cleanup then reject with a UI-showable error.
        if (err && err.name === 'QuotaExceededError') {
          console.warn('[ImageStore] addImage quota exceeded → cleaning up old blobs');
          Promise.resolve()
            .then(() => this.cleanupOldBlobs())
            .catch(function (_e) { globalThis.SEOSONA_swallow?.('ImageStore#onerror', _e); })
            .finally(() => {
              const e = new Error('Bộ nhớ cục bộ đã đầy (quota). Đã dọn bớt ảnh cũ — vui lòng thử lại.');
              e.name = 'QuotaExceededError';
              reject(e);
            });
          return;
        }
        reject(err);
      };
    });
  }

  /**
   * Lấy image metadata theo ID
   * @param {string} imageId
   * @returns {Object|null}
   */
  static async getImage(imageId) {
    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_IMAGES, 'readonly');
      const store = tx.objectStore(this.STORE_IMAGES);
      const request = store.get(imageId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Lấy tất cả images của album
   * @param {string} albumId
   * @returns {Object[]}
   */
  static async getAlbumImages(albumId) {
    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_IMAGES, 'readonly');
      const store = tx.objectStore(this.STORE_IMAGES);
      const index = store.index('album_id');
      const request = index.getAll(albumId);

      request.onsuccess = () => {
        const images = request.result || [];
        // Sắp xếp theo created_at mới nhất
        images.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        resolve(images);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Cập nhật tên image
   * @param {string} imageId
   * @param {string} name
   * @returns {Object|null}
   */
  static async updateImageName(imageId, name) {
    const image = await this.getImage(imageId);
    if (!image) return null;

    const db = await this._getDB();
    image.name = name;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_IMAGES, 'readwrite');
      const store = tx.objectStore(this.STORE_IMAGES);
      store.put(image);

      tx.oncomplete = () => resolve(image);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Xóa image và blobs
   * @param {string} imageId
   * @returns {boolean}
   */
  static async deleteImage(imageId) {
    const image = await this.getImage(imageId);
    if (!image) return false;

    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([this.STORE_IMAGES, this.STORE_BLOBS], 'readwrite');
      const imageStore = tx.objectStore(this.STORE_IMAGES);
      const blobStore = tx.objectStore(this.STORE_BLOBS);

      imageStore.delete(imageId);
      if (image.blob_key) {
        blobStore.delete(image.blob_key);
      }

      tx.oncomplete = async () => {
        // Xóa khỏi album
        try {
          await window.AlbumStore?.removeImageFromAlbum(image.album_id, imageId);
        } catch (e) {
          // Rollback: re-add the image and blob we just deleted
          console.error('[ImageStore] Failed to remove image from album, rolling back:', e);
          try {
            const rollbackTx = db.transaction([this.STORE_IMAGES, this.STORE_BLOBS], 'readwrite');
            rollbackTx.objectStore(this.STORE_IMAGES).put(image);
            // Note: blob data is already deleted, cannot fully restore
          } catch (rollbackErr) {
            console.error('[ImageStore] Rollback failed:', rollbackErr);
          }
        }

        // Revoke cached URLs
        window.ThumbnailCache?.delete(imageId);

        console.log('[ImageStore] Image deleted:', imageId);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Lấy thumbnail blob URL (với caching)
   * @param {string} imageId
   * @returns {string|null} Blob URL
   */
  static async getThumbnail(imageId) {
    // Check cache first
    const cached = window.ThumbnailCache?.get(imageId);
    if (cached) return cached;

    const image = await this.getImage(imageId);
    if (!image || !image.blob_key) return null;

    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_BLOBS, 'readonly');
      const store = tx.objectStore(this.STORE_BLOBS);
      const request = store.get(image.blob_key);

      request.onsuccess = () => {
        const blobEntry = request.result;
        // Fallback chain: thumbnail_blob → medium_blob (khi tier 1 compress fail trước đó)
        const sourceBlob = blobEntry?.thumbnail_blob || blobEntry?.medium_blob;
        if (sourceBlob) {
          let url;
          // Handle cả Blob và data URL string (từ ScreenCapture)
          if (typeof sourceBlob === 'string') {
            // Đã là data URL hoặc blob URL → dùng trực tiếp
            url = sourceBlob;
          } else {
            // Blob → tạo URL
            url = window.BlobUrlManager?.create(sourceBlob, imageId)
              || URL.createObjectURL(sourceBlob);
          }

          // Cache URL
          window.ThumbnailCache?.set(imageId, url);

          resolve(url);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Lấy full image blob URL (ưu tiên medium_blob)
   * @param {string} imageId
   * @returns {string|null} Blob URL
   */
  static async getFullImage(imageId) {
    const image = await this.getImage(imageId);
    if (!image || !image.blob_key) return null;

    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_BLOBS, 'readonly');
      const store = tx.objectStore(this.STORE_BLOBS);
      const request = store.get(image.blob_key);

      request.onsuccess = () => {
        const blobEntry = request.result;
        // Ưu tiên: medium_blob > thumbnail_blob
        const blob = blobEntry?.medium_blob || blobEntry?.thumbnail_blob;
        if (blob) {
          let url;
          if (typeof blob === 'string') {
            url = blob;
          } else {
            url = window.BlobUrlManager?.create(blob, imageId)
              || URL.createObjectURL(blob);
          }
          resolve(url);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Lấy full blob (không tạo URL) - ưu tiên medium_blob
   * @param {string} imageId
   * @returns {Blob|null}
   */
  static async getFullBlob(imageId) {
    const image = await this.getImage(imageId);
    if (!image || !image.blob_key) return null;

    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_BLOBS, 'readonly');
      const store = tx.objectStore(this.STORE_BLOBS);
      const request = store.get(image.blob_key);

      request.onsuccess = () => {
        const blobEntry = request.result;
        // Ưu tiên: medium_blob > thumbnail_blob
        let blob = blobEntry?.medium_blob || null;
        if (!blob && blobEntry?.thumbnail_blob) {
          if (typeof blobEntry.thumbnail_blob !== 'string') {
            blob = blobEntry.thumbnail_blob;
          }
        }
        resolve(blob);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Check blob entry existence cho image — KHÔNG decompress, chỉ check tồn tại
   * Dùng cho status check (alive/stale/dead) — robust hơn getThumbnail() vì
   * không phụ thuộc thumbnail compress success.
   * @param {string} imageId
   * @returns {boolean} true nếu có blob entry (thumbnail OR medium) trong DB
   */
  static async hasBlob(imageId) {
    const image = await this.getImage(imageId);
    if (!image || !image.blob_key) return false;

    const db = await this._getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(this.STORE_BLOBS, 'readonly');
      const store = tx.objectStore(this.STORE_BLOBS);
      const request = store.get(image.blob_key);
      request.onsuccess = () => {
        const entry = request.result;
        resolve(!!(entry?.thumbnail_blob || entry?.medium_blob));
      };
      request.onerror = () => resolve(false);
    });
  }

  /**
   * Cleanup blobs cũ (TTL) — skip blobs still referenced by album_images
   * @param {number} maxAgeDays - Số ngày tối đa (from user settings)
   */
  static async cleanupOldBlobs(maxAgeDays = this.BLOB_DEFAULT_MAX_AGE_DAYS) {
    const db = await this._getDB();
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

    // First: collect all blob_keys referenced by album_images
    const referencedBlobKeys = new Set();
    try {
      const imgTx = db.transaction(this.STORE_IMAGES, 'readonly');
      const imgStore = imgTx.objectStore(this.STORE_IMAGES);
      const allImages = await new Promise((resolve, reject) => {
        const req = imgStore.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      for (const img of allImages) {
        if (img.blob_key) referencedBlobKeys.add(img.blob_key);
      }
    } catch (err) {
      console.warn('[ImageStore] Failed to collect referenced blob keys, skipping cleanup:', err.message);
      return 0;  // KHÔNG cleanup nếu không biết blobs nào đang được sử dụng
    }

    // Then: cleanup blobs that are OLD and NOT referenced
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_BLOBS, 'readwrite');
      const store = tx.objectStore(this.STORE_BLOBS);
      const request = store.openCursor();
      let cleaned = 0;
      let skippedReferenced = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const entry = cursor.value;
          if (entry.created_at && entry.created_at < cutoff) {
            // Skip if still referenced by an album image
            if (referencedBlobKeys.has(entry.id)) {
              skippedReferenced++;
            } else {
              cursor.delete();
              cleaned++;
            }
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        if (cleaned > 0 || skippedReferenced > 0) {
          console.log(`[ImageStore] Cleaned ${cleaned} old blobs, skipped ${skippedReferenced} referenced`);
        }
        resolve(cleaned);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Đếm tổng số images
   * @returns {number}
   */
  static async count() {
    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_IMAGES, 'readonly');
      const store = tx.objectStore(this.STORE_IMAGES);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Tính tổng dung lượng blobs (bytes)
   * @returns {number}
   */
  static async getTotalBlobSize() {
    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_BLOBS, 'readonly');
      const store = tx.objectStore(this.STORE_BLOBS);
      const request = store.openCursor();
      let totalSize = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const entry = cursor.value;
          if (entry.thumbnail_blob?.size) totalSize += entry.thumbnail_blob.size;
          if (entry.medium_blob?.size) totalSize += entry.medium_blob.size;
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(totalSize);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ===== Phase S2.5: Album Storage Optimization =====

  /**
   * Update image với file_name và thumbnail_url (sau khi upload thành công)
   * @param {string} imageId
   * @param {Object} updates - { file_name?, thumbnail_url?, file_id?, pending_upload_key? }
   * @returns {Object|null}
   */
  static async updateImage(imageId, updates) {
    const image = await this.getImage(imageId);
    if (!image) return null;

    const db = await this._getDB();

    // Merge updates
    if (updates.file_name !== undefined) image.file_name = updates.file_name;
    if (updates.thumbnail_url !== undefined) image.thumbnail_url = updates.thumbnail_url;
    if (updates.file_id !== undefined) image.file_id = updates.file_id;
    if (updates.pending_upload_key !== undefined) image.pending_upload_key = updates.pending_upload_key;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_IMAGES, 'readwrite');
      const store = tx.objectStore(this.STORE_IMAGES);
      store.put(image);

      tx.oncomplete = () => {
        console.log('[ImageStore] Image updated:', imageId, updates);
        resolve(image);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Migration: Xóa full_blob khỏi tất cả entries để giảm storage
   * Phase S2.5.4
   * @returns {{cleaned: number, freedBytes: number}}
   */
  static async migrateToLightweight() {
    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_BLOBS, 'readwrite');
      const store = tx.objectStore(this.STORE_BLOBS);
      const request = store.openCursor();
      let cleaned = 0;
      let freedBytes = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const entry = cursor.value;

          // Nếu có full_blob, xóa đi và cập nhật
          if (entry.full_blob) {
            freedBytes += entry.full_blob.size || 0;
            entry.full_blob = null;
            cursor.update(entry);
            cleaned++;
          }

          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        if (cleaned > 0) {
          console.log(`[ImageStore] Migration: cleaned ${cleaned} full_blobs, freed ${(freedBytes / 1024 / 1024).toFixed(2)} MB`);
        }
        resolve({ cleaned, freedBytes });
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get ALL album images (batch load để tránh N+1 query)
   * @returns {Object[]}
   */
  static async getAllImages() {
    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_IMAGES, 'readonly');
      const store = tx.objectStore(this.STORE_IMAGES);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all images cần resolve (có pending_upload_key hoặc không có file_name)
   * @returns {Object[]}
   */
  static async getImagesNeedingResolution() {
    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_IMAGES, 'readonly');
      const store = tx.objectStore(this.STORE_IMAGES);
      const request = store.getAll();

      request.onsuccess = () => {
        const images = request.result || [];
        const needResolution = images.filter(img =>
          // Ảnh chưa có file_name (cần resolve từ thumbnail_url) hoặc còn pending
          (!img.file_name && img.thumbnail_url) ||
          img.pending_upload_key
        );
        resolve(needResolution);
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// Export
window.ImageStore = ImageStore;
