/**
 * MediaRegistry - Centralized media cache singleton
 * Replaces GenTab.thumbnailCache / GenTab.fileNameCache
 * Loadable in ALL HTML contexts (sidebar, workflow-editor, angles-editor, effects-editor)
 */
class MediaRegistry {

  // ─── Thumbnail Cache: { fileId → CDN URL } ─────────────────
  static _thumbnails = {};

  // ─── FileName Cache: { fileId → UUID } ─────────────────────
  static _fileNames = {};

  // ─── LRU: giới hạn tối đa 500 entries mỗi cache ───────────
  // Theo dõi thứ tự chèn để evict entries cũ nhất khi vượt ngưỡng
  static _LRU_MAX = 500;
  static _LRU_EVICT = 100;
  static _thumbOrder = [];
  static _fileNameOrder = [];

  /**
   * Evict entries cũ nhất khi cache vượt ngưỡng LRU_MAX
   * Xóa LRU_EVICT entries cũ nhất (đầu mảng = cũ nhất)
   * @param {object} cache - object cache cần evict
   * @param {string[]} order - mảng thứ tự chèn
   * @returns {string[]} mảng order đã cập nhật
   */
  static _evictIfNeeded(cache, order) {
    if (order.length <= this._LRU_MAX) return order;
    var toRemove = order.splice(0, this._LRU_EVICT);
    for (var i = 0; i < toRemove.length; i++) {
      delete cache[toRemove[i]];
    }
    return order;
  }

  /**
   * Thêm key vào cuối order (vị trí mới nhất).
   * Nếu key đã tồn tại, di chuyển về cuối (cập nhật LRU position).
   * @param {string[]} order
   * @param {string} key
   * @returns {string[]}
   */
  static _touchOrder(order, key) {
    var idx = order.indexOf(key);
    if (idx !== -1) order.splice(idx, 1);
    order.push(key);
    return order;
  }

  // ─── Thumbnail operations ──────────────────────────────────

  /**
   * Get thumbnail URL for a file ID
   * @param {string} id - file_id / tile_id / upload_xxx key
   * @returns {string|undefined}
   */
  static getThumb(id) {
    return this._thumbnails[id];
  }

  /**
   * Set thumbnail URL for a file ID
   * @param {string} id
   * @param {string} url - CDN URL or blob URL
   */
  static setThumb(id, url) {
    if (id && url) {
      this._thumbnails[id] = url;
      this._thumbOrder = this._touchOrder(this._thumbOrder, id);
      this._thumbOrder = this._evictIfNeeded(this._thumbnails, this._thumbOrder);
    }
  }

  /**
   * Delete thumbnail for a file ID
   * @param {string} id
   */
  static deleteThumb(id) {
    delete this._thumbnails[id];
    var idx = this._thumbOrder.indexOf(id);
    if (idx !== -1) this._thumbOrder.splice(idx, 1);
  }

  // ─── FileName operations ───────────────────────────────────

  /**
   * Get file_name UUID for a file ID
   * @param {string} id
   * @returns {string|undefined}
   */
  static getFileName(id) {
    return this._fileNames[id];
  }

  /**
   * Set file_name UUID for a file ID
   * @param {string} id
   * @param {string} fileName - UUID
   */
  static setFileName(id, fileName) {
    if (id && fileName) {
      this._fileNames[id] = fileName;
      this._fileNameOrder = this._touchOrder(this._fileNameOrder, id);
      this._fileNameOrder = this._evictIfNeeded(this._fileNames, this._fileNameOrder);
    }
  }

  /**
   * Delete file_name for a file ID
   * @param {string} id
   */
  static deleteFileName(id) {
    delete this._fileNames[id];
    var idx = this._fileNameOrder.indexOf(id);
    if (idx !== -1) this._fileNameOrder.splice(idx, 1);
  }

  // ─── Combined operations ───────────────────────────────────

  /**
   * Set both thumbnail and fileName for a file ID
   * @param {string} id
   * @param {string} thumbUrl
   * @param {string} fileName
   */
  static set(id, thumbUrl, fileName) {
    if (thumbUrl) this.setThumb(id, thumbUrl);
    if (fileName) this.setFileName(id, fileName);
  }

  /**
   * Delete both thumbnail and fileName for a file ID
   * @param {string} id
   */
  static delete(id) {
    this.deleteThumb(id);
    this.deleteFileName(id);
  }

  /**
   * Rename/transfer cache entries from oldId to newId
   * Used after upload completes (upload_xxx → tile_id)
   * @param {string} oldId
   * @param {string} newId
   * @param {object} [overrides] - Optional { thumbUrl, fileName } to override instead of transfer
   */
  static rename(oldId, newId, overrides) {
    // Thumbnail
    if (overrides?.thumbUrl) {
      this.setThumb(newId, overrides.thumbUrl);
    } else if (this._thumbnails[oldId]) {
      this.setThumb(newId, this._thumbnails[oldId]);
    }
    this.deleteThumb(oldId);

    // FileName
    if (overrides?.fileName) {
      this.setFileName(newId, overrides.fileName);
    } else if (this._fileNames[oldId]) {
      this.setFileName(newId, this._fileNames[oldId]);
    }
    this.deleteFileName(oldId);
  }

  // ─── Bulk operations ───────────────────────────────────────

  /**
   * Check if thumbnails cache has any entries
   * @returns {boolean}
   */
  static hasThumbnails() {
    return Object.keys(this._thumbnails).length > 0;
  }

  /**
   * Check if fileNames cache has any entries
   * @returns {boolean}
   */
  static hasFileNames() {
    return Object.keys(this._fileNames).length > 0;
  }

  /**
   * Get full thumbnails object (for state save/persistence)
   * @returns {object}
   */
  static getAllThumbnails() {
    return this._thumbnails;
  }

  /**
   * Get full fileNames object (for state save/persistence)
   * @returns {object}
   */
  static getAllFileNames() {
    return this._fileNames;
  }

  /**
   * Replace entire thumbnails cache (for state restore)
   * @param {object} data
   */
  static restoreThumbnails(data) {
    if (data && typeof data === 'object') {
      this._thumbnails = data;
      // Đồng bộ lại order từ keys hiện tại
      this._thumbOrder = Object.keys(data);
    }
  }

  /**
   * Replace entire fileNames cache (for state restore)
   * @param {object} data
   */
  static restoreFileNames(data) {
    if (data && typeof data === 'object') {
      this._fileNames = data;
      // Đồng bộ lại order từ keys hiện tại
      this._fileNameOrder = Object.keys(data);
    }
  }

  // ─── Backward compatibility ────────────────────────────────
  // Expose as plain objects for code that reads cache[key] directly
  // These getters allow `MediaRegistry.thumbnailCache[id]` syntax

  static get thumbnailCache() {
    return this._thumbnails;
  }

  static set thumbnailCache(val) {
    if (val && typeof val === 'object') {
      this._thumbnails = val;
      this._thumbOrder = Object.keys(val);
    }
  }

  static get fileNameCache() {
    return this._fileNames;
  }

  static set fileNameCache(val) {
    if (val && typeof val === 'object') {
      this._fileNames = val;
      this._fileNameOrder = Object.keys(val);
    }
  }
}

// Expose globally
window.MediaRegistry = MediaRegistry;
