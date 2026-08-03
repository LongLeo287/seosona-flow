/**
 * ThumbnailCache - LRU cache cho thumbnail blob URLs
 * Giới hạn số lượng URLs trong memory để tránh memory leak
 */
class ThumbnailCache {
  /**
   * @param {number} maxSize - Số lượng tối đa thumbnails trong cache
   */
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
    this.cache = new Map();  // imageId → { blobUrl, lastAccess }
  }

  /**
   * Lấy thumbnail URL từ cache
   * @param {string} imageId
   * @returns {string|null} Blob URL hoặc null nếu không có
   */
  get(imageId) {
    const item = this.cache.get(imageId);
    if (item) {
      // Cập nhật thời gian truy cập (LRU)
      item.lastAccess = Date.now();
      return item.blobUrl;
    }
    return null;
  }

  /**
   * Kiểm tra thumbnail có trong cache không
   * @param {string} imageId
   * @returns {boolean}
   */
  has(imageId) {
    return this.cache.has(imageId);
  }

  /**
   * Thêm thumbnail vào cache
   * @param {string} imageId
   * @param {string} blobUrl
   */
  set(imageId, blobUrl) {
    // Nếu đã đạt giới hạn, xóa item cũ nhất
    if (this.cache.size >= this.maxSize && !this.cache.has(imageId)) {
      this._evictOldest();
    }

    this.cache.set(imageId, {
      blobUrl,
      lastAccess: Date.now()
    });
  }

  /**
   * Xóa thumbnail khỏi cache
   * @param {string} imageId
   */
  delete(imageId) {
    const item = this.cache.get(imageId);
    if (item) {
      window.BlobUrlManager?.revoke(item.blobUrl);
      this.cache.delete(imageId);
    }
  }

  /**
   * Xóa item ít được truy cập nhất (LRU)
   * @private
   */
  _evictOldest() {
    let oldest = { key: null, time: Infinity };

    for (const [key, value] of this.cache) {
      if (value.lastAccess < oldest.time) {
        oldest = { key, time: value.lastAccess };
      }
    }

    if (oldest.key) {
      const item = this.cache.get(oldest.key);
      if (item) {
        window.BlobUrlManager?.revoke(item.blobUrl);
      }
      this.cache.delete(oldest.key);
    }
  }

  /**
   * Xóa tất cả thumbnails trong cache
   */
  clear() {
    for (const [, value] of this.cache) {
      window.BlobUrlManager?.revoke(value.blobUrl);
    }
    this.cache.clear();
    console.log('[ThumbnailCache] Cache cleared');
  }

  /**
   * Số lượng items trong cache
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Lấy danh sách tất cả imageIds trong cache
   */
  keys() {
    return Array.from(this.cache.keys());
  }
}

// Export singleton với maxSize = 50
window.ThumbnailCache = new ThumbnailCache(50);
