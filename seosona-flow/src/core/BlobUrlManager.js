/**
 * BlobUrlManager - Quản lý lifecycle của blob URLs
 * Tự động cleanup URLs cũ để tránh memory leak
 */
class BlobUrlManager {
  constructor() {
    this._urls = new Map();  // url → { imageId, createdAt }
    this._cleanupInterval = null;
    this._startCleanupInterval();
  }

  /**
   * Tạo blob URL mới và track
   * @param {Blob} blob
   * @param {string|null} imageId - ID để tracking
   * @returns {string} Blob URL
   */
  create(blob, imageId = null) {
    const url = URL.createObjectURL(blob);
    this._urls.set(url, {
      imageId,
      createdAt: Date.now()
    });
    return url;
  }

  /**
   * Thu hồi blob URL
   * @param {string} url
   */
  revoke(url) {
    if (this._urls.has(url)) {
      URL.revokeObjectURL(url);
      this._urls.delete(url);
    }
  }

  /**
   * Thu hồi tất cả URLs của một image
   * @param {string} imageId
   */
  revokeByImageId(imageId) {
    for (const [url, data] of this._urls) {
      if (data.imageId === imageId) {
        URL.revokeObjectURL(url);
        this._urls.delete(url);
      }
    }
  }

  /**
   * Cleanup URLs cũ hơn maxAge
   * @param {number} maxAgeMs - Mặc định 5 phút
   */
  cleanup(maxAgeMs = 5 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [url, data] of this._urls) {
      // [FIX 2026-07-09] BỎ QUA url có imageId — chúng do ThumbnailCache (LRU, không TTL) sở hữu và
      // revoke qua evict/delete/clear. Trước đây TTL 5' revoke cả url đang được ThumbnailCache giữ →
      // ThumbnailCache.get() trả url ĐÃ REVOKE → thumbnail/preview vỡ sau 5' và không tự sửa.
      // Chỉ TTL-clean url dùng-một-lần (imageId=null, không cache).
      if (data.imageId != null) continue;
      if (now - data.createdAt > maxAgeMs) {
        URL.revokeObjectURL(url);
        this._urls.delete(url);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[BlobUrlManager] Cleaned ${cleaned} expired URLs`);
    }
  }

  /**
   * Bắt đầu interval cleanup mỗi 5 phút
   * Interval 5 phút thay vì 1 phút để giảm overhead (E3.3)
   * - Blob URLs hiếm khi cần cleanup ngay lập tức
   * - maxAge đã là 5 phút nên cleanup thường xuyên hơn không cần thiết
   */
  _startCleanupInterval() {
    if (this._cleanupInterval) return;

    this._cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);  // Mỗi 5 phút (giảm overhead)
  }

  /**
   * Dừng interval cleanup
   */
  stopCleanup() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }

  /**
   * Thu hồi tất cả URLs
   */
  revokeAll() {
    for (const url of this._urls.keys()) {
      URL.revokeObjectURL(url);
    }
    this._urls.clear();
    console.log('[BlobUrlManager] All URLs revoked');
  }

  /**
   * Số lượng URLs đang track
   */
  get size() {
    return this._urls.size;
  }
}

// Export singleton
window.BlobUrlManager = new BlobUrlManager();

window.addEventListener('unload', () => {
  window.BlobUrlManager.stopCleanup();
  window.BlobUrlManager.revokeAll();
});
