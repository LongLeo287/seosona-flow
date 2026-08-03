/**
 * ImageNameRegistry - Registry quản lý mapping: name → image metadata
 * Dùng cho @mention trong prompts
 */
class ImageNameRegistry {
  constructor() {
    this._registry = new Map();  // name → imageData
  }

  /**
   * Register một image với name
   * @param {string} name - Tên dùng cho @mention (alphanumeric + underscore)
   * @param {Object} imageData - { type, source, file_id, file_name, thumbnail_url, blob_url }
   */
  register(name, imageData) {
    if (!this._validateName(name)) {
      console.warn('[ImageNameRegistry] Tên không hợp lệ:', name);
      return false;
    }
    this._registry.set(name.toLowerCase(), {
      name: name.toLowerCase(),
      ...imageData,
      registeredAt: Date.now()
    });
    return true;
  }

  /**
   * Unregister một name
   */
  unregister(name) {
    return this._registry.delete(name.toLowerCase());
  }

  /**
   * Lookup image data by name
   * @returns {Object|null} Image data hoặc null nếu không tìm thấy
   */
  lookup(name) {
    return this._registry.get(name.toLowerCase()) || null;
  }

  /**
   * Lấy tất cả names available (cho autocomplete)
   * @returns {string[]}
   */
  getAvailableNames() {
    return Array.from(this._registry.keys());
  }

  /**
   * Lấy tất cả entries
   * @returns {Array<{name, ...imageData}>}
   */
  getAll() {
    return Array.from(this._registry.values());
  }

  /**
   * Clear registry
   */
  clear() {
    this._registry.clear();
  }

  /**
   * Refresh từ các sources (albums, current ref_images)
   * Tối ưu: batch load tất cả images 1 lần thay vì N+1 query per album
   */
  async refreshFromSources() {
    // Clear current
    this._registry.clear();

    // 1. Batch load tất cả album images (tránh N+1 query)
    if (window.ImageStore) {
      try {
        const allImages = await window.ImageStore.getAllImages();
        for (const img of allImages) {
          // Skip if name is empty, null, or invalid
          if (img.name && this._validateName(img.name)) {
            this.register(img.name, {
              type: img.type,
              source: 'album',
              albumId: img.album_id,
              file_id: img.file_id,
              file_name: img.file_name,
              thumbnail_url: img.thumbnail_url,
              blob_key: img.blob_key
            });
          }
        }
      } catch (e) {
        console.error('[ImageNameRegistry] Lỗi load từ albums:', e);
      }
    }

    // 2. Load từ current ref_images (nếu có)
    // Sẽ được gọi từ GenTab khi ref_images thay đổi

    console.log('[ImageNameRegistry] Đã refresh, có', this._registry.size, 'tên');
  }

  /**
   * Register từ current ref_images trong Tab Gen
   * @param {Array} refImages - [{name, type, file_id, file_name, thumbnail_url, blob_url}]
   */
  registerFromRefImages(refImages) {
    if (!refImages || !Array.isArray(refImages)) return;

    for (const img of refImages) {
      if (img.name) {
        this.register(img.name, {
          type: img.type || 'flow',
          source: 'ref_list',
          file_id: img.file_id,
          file_name: img.file_name,
          thumbnail_url: img.thumbnail_url,
          blob_url: img.blob_url
        });
      }
    }
  }

  /**
   * Validate name (alphanumeric + underscore, 1-50 chars)
   */
  _validateName(name) {
    if (!name || typeof name !== 'string') return false;
    return /^[a-zA-Z0-9_]{1,50}$/.test(name);
  }

  /**
   * Generate unique name từ base name
   */
  generateUniqueName(baseName) {
    if (!baseName || typeof baseName !== 'string') {
      baseName = 'image';
    }
    let name = baseName.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
    if (!name) name = 'image';

    if (!this._registry.has(name)) return name;

    let counter = 1;
    while (this._registry.has(`${name}_${counter}`)) {
      counter++;
    }
    return `${name}_${counter}`;
  }

  /**
   * Kiểm tra name đã tồn tại chưa
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    if (!name || typeof name !== 'string') return false;
    return this._registry.has(name.toLowerCase());
  }

  /**
   * Đếm số lượng entries
   * @returns {number}
   */
  get size() {
    return this._registry.size;
  }
}

// Export singleton
window.imageNameRegistry = new ImageNameRegistry();
