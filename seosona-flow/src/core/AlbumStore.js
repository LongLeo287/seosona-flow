/**
 * AlbumStore - Quản lý albums trong IndexedDB
 * Mỗi album chứa danh sách image_ids reference tới album_images store
 */
class AlbumStore {
  static DB_NAME = 'seosonaflow_pro';
  static STORE_NAME = 'albums';
  static DB_VERSION = 4;  // Must match PendingUploadStore & ImageStore (v4 = paste image feature)

  static _db = null;

  /**
   * Mở/tạo IndexedDB với version 2 (thêm 3 stores cho Album feature)
   */
  static async _getDB() {
    // Check if cached DB is still valid
    if (this._db) {
      try {
        // Test if connection is still open
        const tx = this._db.transaction(this.STORE_NAME, 'readonly');
        tx.abort();
        return this._db;
      } catch (e) {
        console.log('[AlbumStore] Cached DB invalid, reopening...');
        this._db = null;
      }
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // === Stores cũ (version 1) ===
        if (!db.objectStoreNames.contains('pending_uploads')) {
          db.createObjectStore('pending_uploads', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('uploaded_cache')) {
          db.createObjectStore('uploaded_cache', { keyPath: 'key' });
        }

        // === Stores mới (version 2) ===
        // albums store
        if (!db.objectStoreNames.contains('albums')) {
          const albumStore = db.createObjectStore('albums', { keyPath: 'id' });
          albumStore.createIndex('name', 'name', { unique: false });
          albumStore.createIndex('updated_at', 'updated_at', { unique: false });
        }

        // album_images store
        if (!db.objectStoreNames.contains('album_images')) {
          const imageStore = db.createObjectStore('album_images', { keyPath: 'id' });
          imageStore.createIndex('album_id', 'album_id', { unique: false });
          imageStore.createIndex('name', 'name', { unique: false });
        }

        // image_blobs store
        if (!db.objectStoreNames.contains('image_blobs')) {
          db.createObjectStore('image_blobs', { keyPath: 'id' });
        }

        // === Version 3 stores (Phase S2: Lightweight storage) ===
        if (!db.objectStoreNames.contains('lightweight_pending')) {
          const lwStore = db.createObjectStore('lightweight_pending', { keyPath: 'key' });
          lwStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // === Version 4 stores (Paste image feature) ===
        // Idempotent: 3 classes (AlbumStore/ImageStore/PendingUploadStore) đều cần tạo store
        // này vì class nào mở DB trước (fresh install) sẽ fire onupgradeneeded duy nhất.
        if (!db.objectStoreNames.contains('workflow_paste_blobs')) {
          const pasteStore = db.createObjectStore('workflow_paste_blobs', { keyPath: 'id' });
          pasteStore.createIndex('workflow_id', 'workflow_id', { unique: false });
          pasteStore.createIndex('upload_status', 'upload_status', { unique: false });
          pasteStore.createIndex('created_at', 'created_at', { unique: false });
        }

        console.log('[AlbumStore] IndexedDB upgraded to version', this.DB_VERSION);
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => {
        console.error('[AlbumStore] IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };

      request.onblocked = () => {
        console.warn('[AlbumStore] IndexedDB blocked - close other tabs and reload');
      };
    });
  }

  /**
   * Tạo album mới
   * @param {string} name - Tên album
   * @param {string[]} imageIds - Danh sách image IDs (optional)
   * @returns {Object} Album object
   */
  static async createAlbum(name, imageIds = []) {
    const db = await this._getDB();
    const album = {
      id: crypto.randomUUID(),
      name,
      created_at: Date.now(),
      updated_at: Date.now(),
      image_ids: imageIds
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      store.put(album);

      tx.oncomplete = () => {
        console.log('[AlbumStore] Album created:', album.id, name);
        resolve(album);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Lấy tất cả albums
   * @returns {Object[]} Danh sách albums, sắp xếp theo updated_at desc
   */
  static async getAlbums() {
    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const albums = request.result || [];
        // Sắp xếp theo updated_at mới nhất
        albums.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
        resolve(albums);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Lấy album theo ID
   * @param {string} id
   * @returns {Object|null}
   */
  static async getAlbum(id) {
    try {
      const db = await this._getDB();
      console.log('[AlbumStore] getAlbum() looking for ID:', id, 'type:', typeof id);

      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          if (request.result) {
            console.log('[AlbumStore] getAlbum found via direct lookup:', request.result.name);
            resolve(request.result);
          } else {
            // Fallback: get all and find by ID (workaround for potential key issues)
            console.log('[AlbumStore] Direct lookup returned null, trying getAll fallback...');
            const allRequest = store.getAll();
            allRequest.onsuccess = () => {
              const albums = allRequest.result || [];
              console.log('[AlbumStore] getAll returned', albums.length, 'albums:', albums.map(a => ({ id: a.id, name: a.name })));

              // Try exact match first
              let found = albums.find(a => a.id === id);

              // If not found, try string comparison
              if (!found) {
                found = albums.find(a => String(a.id) === String(id));
                if (found) {
                  console.log('[AlbumStore] Found via string comparison');
                }
              }

              console.log('[AlbumStore] getAll fallback result:', found ? `found: ${found.name}` : 'not found');
              resolve(found || null);
            };
            allRequest.onerror = () => {
              console.error('[AlbumStore] getAll fallback error');
              resolve(null);
            };
          }
        };
        request.onerror = () => {
          console.error('[AlbumStore] getAlbum error:', request.error);
          reject(request.error);
        };
      });
    } catch (err) {
      console.error('[AlbumStore] getAlbum exception:', err);
      return null;
    }
  }

  /**
   * Cập nhật album
   * @param {string} id
   * @param {Object} data - { name?, image_ids? }
   * @returns {Object|null}
   */
  static async updateAlbum(id, data) {
    const album = await this.getAlbum(id);
    if (!album) return null;

    const db = await this._getDB();
    const updatedAlbum = {
      ...album,
      ...data,
      updated_at: Date.now()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      store.put(updatedAlbum);

      tx.oncomplete = () => {
        console.log('[AlbumStore] Album updated:', id);
        resolve(updatedAlbum);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Xóa album + album_images + image_blobs (cascade delete)
   * @param {string} id
   * @returns {boolean}
   */
  static async deleteAlbum(id) {
    const db = await this._getDB();

    // Get album first to find image_ids
    const album = await this.getAlbum(id);
    const imageIds = album?.image_ids || [];

    // Collect blob_keys from images
    const blobKeys = [];
    if (imageIds.length > 0) {
      const imgTx = db.transaction('album_images', 'readonly');
      const imgStore = imgTx.objectStore('album_images');
      for (const imgId of imageIds) {
        const img = await new Promise(r => {
          const req = imgStore.get(imgId);
          req.onsuccess = () => r(req.result);
          req.onerror = () => r(null);
        });
        if (img?.blob_key) blobKeys.push(img.blob_key);
      }
    }

    // Delete all in single transaction
    return new Promise((resolve, reject) => {
      const tx = db.transaction([this.STORE_NAME, 'album_images', 'image_blobs'], 'readwrite');

      // Delete album
      tx.objectStore(this.STORE_NAME).delete(id);

      // Delete images
      const imgStore = tx.objectStore('album_images');
      for (const imgId of imageIds) {
        imgStore.delete(imgId);
      }

      // Delete blobs
      const blobStore = tx.objectStore('image_blobs');
      for (const blobKey of blobKeys) {
        blobStore.delete(blobKey);
      }

      tx.oncomplete = () => {
        // Clean thumbnail cache
        for (const imgId of imageIds) {
          window.ThumbnailCache?.delete(imgId);
        }
        console.log('[AlbumStore] Album deleted (cascade):', id, '| images:', imageIds.length, '| blobs:', blobKeys.length);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Thêm image vào album
   * @param {string} albumId
   * @param {string} imageId
   */
  static async addImageToAlbum(albumId, imageId) {
    const album = await this.getAlbum(albumId);
    if (!album) {
      throw new Error('Album không tồn tại');
    }

    // Tránh duplicate
    if (!album.image_ids.includes(imageId)) {
      album.image_ids.push(imageId);
      await this.updateAlbum(albumId, { image_ids: album.image_ids });
    }

    return album;
  }

  /**
   * Xóa image khỏi album
   * @param {string} albumId
   * @param {string} imageId
   */
  static async removeImageFromAlbum(albumId, imageId) {
    const album = await this.getAlbum(albumId);
    if (!album) {
      throw new Error('Album không tồn tại');
    }

    album.image_ids = album.image_ids.filter(id => id !== imageId);
    await this.updateAlbum(albumId, { image_ids: album.image_ids });

    return album;
  }

  /**
   * Đếm số albums
   * @returns {number}
   */
  static async count() {
    const albums = await this.getAlbums();
    return albums.length;
  }

  /**
   * Tìm albums chứa image
   * @param {string} imageId
   * @returns {Object[]}
   */
  static async findAlbumsContaining(imageId) {
    const albums = await this.getAlbums();
    return albums.filter(album => album.image_ids.includes(imageId));
  }
}

// Export
window.AlbumStore = AlbumStore;
