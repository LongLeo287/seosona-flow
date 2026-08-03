/**
 * TileResolver - Batch resolution for file_id/file_name/thumbnail_url → tile_id
 * Scan DOM 1 lần để resolve nhiều ảnh (tối ưu performance)
 *
 * Phase S2.2: Persistent Identifier System
 * Phase S2.3: Batch Resolution
 * Phase U: Added file_id as highest priority lookup
 */
class TileResolver {

  /**
   * Extract identifiers từ DOM tile element
   * @param {Element} tile - DOM element có data-tile-id
   * @returns {{tileId: string, fileId: string|null, fileName: string|null, thumbnailUrl: string|null}}
   */
  static extractIdentifiers(tile) {
    // 1. tile_id (session-specific, dùng cho DOM interaction)
    const tileId = tile.dataset.tileId || '';

    // 2. file_id (persistent, từ /project/{project_id}/edit/{file_id})
    const link = tile.querySelector('a[href*="/project/"]');
    const linkMatch = link?.href?.match(/\/project\/[a-f0-9-]+\/edit\/([a-f0-9-]+)/);
    const fileId = linkMatch?.[1] || null;

    // 3. file_name (persistent UUID từ redirect URL)
    // URL format: /fx/api/trpc/media.getMediaUrlRedirect?name=UUID
    const redirectUrl = tile.dataset.redirectUrl || '';
    const fileNameMatch = redirectUrl.match(/name=([a-f0-9-]{36})/i);
    const fileName = fileNameMatch?.[1] || null;

    // 4. thumbnail_url (persistent, normalized - strip query params)
    const img = tile.querySelector('img');
    const rawThumbUrl = img?.src || '';
    const thumbnailUrl = this.normalizeUrl(rawThumbUrl);

    return { tileId, fileId, fileName, thumbnailUrl };
  }

  /**
   * Normalize thumbnail URL - strip query params để matching consistent
   * @param {string} url
   * @returns {string|null}
   */
  static normalizeUrl(url) {
    if (!url) return null;

    // Google CDN format: https://lh3.googleusercontent.com/xxx=w1024-h768
    // Chỉ giữ phần trước dấu = đầu tiên
    const baseUrl = url.split('=')[0];

    // Verify đây là Google CDN URL
    if (baseUrl.includes('googleusercontent.com') || baseUrl.includes('lh3.')) {
      return baseUrl;
    }

    return url;
  }

  /**
   * Get primary key từ image data để resolution
   * Ưu tiên: file_id > file_name > thumbnail_url
   * @param {Object} imageData
   * @returns {{type: string, value: string}|null}
   */
  static getPrimaryKey(imageData) {
    // Ưu tiên file_id (persistent, most accurate)
    if (imageData.file_id) {
      return { type: 'file_id', value: imageData.file_id };
    }

    // Ưu tiên file_name (UUID) nếu có
    if (imageData.file_name) {
      return { type: 'file_name', value: imageData.file_name };
    }

    // Fallback: thumbnail_url cho ảnh cũ không có file_name
    if (imageData.thumbnail_url) {
      return { type: 'thumbnail_url', value: this.normalizeUrl(imageData.thumbnail_url) };
    }

    return null;
  }

  /**
   * Batch resolve nhiều images từ DOM
   * Scan DOM MỘT LẦN, resolve tất cả images cùng lúc
   *
   * @param {Array<Object>} images - Array of {id, file_id?, file_name?, thumbnail_url?}
   * @returns {{results: Map<string, string>, unresolved: Array<Object>}}
   *          results: imageId → tileId
   *          unresolved: images không tìm thấy
   */
  static batchResolve(images) {
    if (!images || images.length === 0) {
      return { results: new Map(), unresolved: [] };
    }

    // 1. Check cache first
    const results = new Map();
    const needsResolve = [];

    for (const img of images) {
      // Priority 0: file_id cache lookup (persistent, most accurate)
      if (img.file_id) {
        const cachedByFileId = window.TileCache?.getByFileId(img.file_id);
        if (cachedByFileId) {
          results.set(img.id, cachedByFileId);
          continue;
        }
      }

      const key = this.getPrimaryKey(img);
      if (!key) {
        needsResolve.push(img);
        continue;
      }

      // Try cache (file_id handled above, so this covers file_name/thumbnail_url)
      const cachedTileId = (key.type === 'file_id')
        ? window.TileCache?.getByFileId(key.value)
        : window.TileCache?.get(key.value);
      if (cachedTileId) {
        results.set(img.id, cachedTileId);
      } else {
        needsResolve.push(img);
      }
    }

    // Nếu tất cả đã có trong cache
    if (needsResolve.length === 0) {
      return { results, unresolved: [] };
    }

    // Rate limiting check
    if (!window.TileCache?.shouldScan()) {
      console.log('[TileResolver] Skipping scan (rate limited)');
      return { results, unresolved: needsResolve };
    }

    // 2. Build lookup maps từ images cần resolve
    const byFileId = new Map();      // file_id → imageData
    const byFileName = new Map();    // file_name → imageData
    const byThumbUrl = new Map();    // normalized thumbnail_url → imageData

    for (const img of needsResolve) {
      if (img.file_id) {
        byFileId.set(img.file_id, img);
      }
      if (img.file_name) {
        byFileName.set(img.file_name, img);
      }
      if (img.thumbnail_url) {
        const normalizedUrl = this.normalizeUrl(img.thumbnail_url);
        if (normalizedUrl) {
          byThumbUrl.set(normalizedUrl, img);
        }
      }
    }

    // 3. Scan DOM MỘT LẦN — Strict Server-Only: tile selector từ content.js helper.
    const tileSelector = window._getTileSelectorString?.() || '[data-tile-id]';
    const tiles = document.querySelectorAll(tileSelector);

    for (const tile of tiles) {
      const { tileId, fileId, fileName, thumbnailUrl } = this.extractIdentifiers(tile);
      if (!tileId) continue;

      // Match by file_id (highest priority - persistent)
      if (fileId && byFileId.has(fileId)) {
        const img = byFileId.get(fileId);
        results.set(img.id, tileId);
        window.TileCache?.setByFileId(fileId, tileId);
        // Also cache by file_name/thumbnail if available
        if (fileName) window.TileCache?.set(fileName, tileId);
        if (thumbnailUrl) window.TileCache?.set(thumbnailUrl, tileId);
        byFileId.delete(fileId);
        // Remove from other maps if same image
        if (img.file_name) byFileName.delete(img.file_name);
        if (img.thumbnail_url) byThumbUrl.delete(this.normalizeUrl(img.thumbnail_url));
      }
      // Match by file_name (priority)
      else if (fileName && byFileName.has(fileName)) {
        const img = byFileName.get(fileName);
        results.set(img.id, tileId);
        window.TileCache?.set(fileName, tileId);
        // Also cache by file_id if available
        if (fileId) window.TileCache?.setByFileId(fileId, tileId);
        byFileName.delete(fileName);
      }
      // Match by thumbnail_url (fallback)
      else if (thumbnailUrl && byThumbUrl.has(thumbnailUrl)) {
        const img = byThumbUrl.get(thumbnailUrl);
        // Chỉ dùng nếu chưa resolve qua file_id/file_name
        if (!results.has(img.id)) {
          results.set(img.id, tileId);
          window.TileCache?.set(thumbnailUrl, tileId);
          if (fileId) window.TileCache?.setByFileId(fileId, tileId);
        }
        byThumbUrl.delete(thumbnailUrl);
      }

      // Also cache file_id → tileId for all tiles (populate cache for future lookups)
      if (fileId) {
        window.TileCache?.setByFileId(fileId, tileId);
      }

      // Early exit nếu đã resolve hết
      if (byFileId.size === 0 && byFileName.size === 0 && byThumbUrl.size === 0) {
        break;
      }
    }

    window.TileCache?.markScanned();

    // 4. Return results + unresolved list
    const unresolved = needsResolve.filter(img => !results.has(img.id));

    // Mark unresolved keys as failed (để tránh retry liên tục)
    for (const img of unresolved) {
      const key = this.getPrimaryKey(img);
      if (key) {
        window.TileCache?.markFailed(key.value);
      }
    }

    console.log(`[TileResolver] Batch resolved: ${results.size}/${images.length}, unresolved: ${unresolved.length}`);

    return { results, unresolved };
  }

  /**
   * Resolve single image (convenience wrapper)
   * @param {Object} imageData - {id, file_id?, file_name?, thumbnail_url?}
   * @returns {string|null} - tile_id hoặc null
   */
  static resolveOne(imageData) {
    const { results } = this.batchResolve([imageData]);
    return results.get(imageData.id) || null;
  }

  /**
   * Scan DOM và extract tất cả identifiers
   * Dùng để debug hoặc rebuild cache
   * @returns {Array<{tileId: string, fileId: string|null, fileName: string|null, thumbnailUrl: string|null}>}
   */
  static scanAll() {
    // Strict Server-Only: tile selector từ content.js helper.
    const tileSelector = window._getTileSelectorString?.() || '[data-tile-id]';
    const tiles = document.querySelectorAll(tileSelector);
    const results = [];

    for (const tile of tiles) {
      const identifiers = this.extractIdentifiers(tile);
      if (identifiers.tileId) {
        results.push(identifiers);
      }
    }

    window.TileCache?.markScanned();
    console.log(`[TileResolver] Full scan: ${results.length} tiles`);

    return results;
  }

  /**
   * Rebuild cache từ DOM scan
   * Dùng sau page load hoặc major DOM changes
   */
  static rebuildCache() {
    window.TileCache?.clear();

    const tiles = this.scanAll();

    for (const { tileId, fileId, fileName, thumbnailUrl } of tiles) {
      if (fileId) {
        window.TileCache?.setByFileId(fileId, tileId);
      }
      if (fileName) {
        window.TileCache?.set(fileName, tileId);
      }
      if (thumbnailUrl) {
        window.TileCache?.set(thumbnailUrl, tileId);
      }
    }

    console.log(`[TileResolver] Cache rebuilt: ${window.TileCache?.getStats().cached || 0} entries`);
  }

  /**
   * Extract file_name từ redirect URL
   * @param {string} redirectUrl
   * @returns {string|null}
   */
  static extractFileName(redirectUrl) {
    if (!redirectUrl) return null;
    const match = redirectUrl.match(/name=([a-f0-9-]{36})/i);
    return match?.[1] || null;
  }

  /**
   * Get tile element by file_name or thumbnail_url
   * @param {Object} imageData - {file_id?, file_name?, thumbnail_url?}
   * @returns {Element|null}
   */
  static getTileElement(imageData) {
    const tileId = this.resolveOne({ id: 'temp', ...imageData });
    if (!tileId) return null;

    return document.querySelector(`[data-tile-id="${tileId}"]`);
  }
}

// Export
window.TileResolver = TileResolver;
