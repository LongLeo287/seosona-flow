/**
 * CharacterRegistry — Flow Character Selector (Nhân vật)
 *
 * LOCAL-ONLY storage (KHÁC VoiceRegistry hybrid): nhân vật là data riêng mỗi user trên Flow
 * (tied Google account) → KHÔNG có server catalog, KHÔNG fetch /api/v1, KHÔNG SSE.
 *   - SCRAPED list: user bấm "Đồng bộ nhân vật" → scrape menu Flow tab "Nhân vật" lấy TẤT CẢ
 *     nhân vật user thấy. Lưu key `seosona_provider_characters_scraped`. KHÔNG sync server.
 *
 * Item shape: { slug, name, search_value, thumbnail_url }
 *   - search_value === name (tên hiển thị trong menu Flow — content script match để locate option)
 *   - thumbnail_url = full URL Google media (https://labs.google/fx/api/...) — sidebar load trực tiếp
 *
 * Pattern reference: VoiceRegistry (lược bỏ tầng server/base catalog).
 */
class CharacterRegistry {
  static _CACHE_KEY_SCRAPED = 'seosona_provider_characters_scraped';

  // In-memory cache
  static _scrapedCache = null;     // { data: [...], scrapedAt }
  static _storageListenerRegistered = false;

  /**
   * Init cross-context sync — chrome.storage.onChanged broadcast giữa sidebar/editor.
   * Khi 1 context bấm Đồng bộ → write storage → context khác tự reload cache + emit eventBus.
   * Call 1 lần lúc bootstrap (idempotent).
   */
  static initCrossContextSync() {
    if (this._storageListenerRegistered) return;
    if (typeof chrome === 'undefined' || !chrome?.storage?.onChanged) return;

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[this._CACHE_KEY_SCRAPED]) {
        this._scrapedCache = null;
        this.getScrapedList().then(() => {
          if (window.eventBus) {
            window.eventBus.emit('characters:refreshed', { source: 'cross_context_sync' });
          }
        });
      }
    });

    this._storageListenerRegistered = true;
  }

  // ───────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ───────────────────────────────────────────────────────────────────────

  /** Get scraped list (local-only). Trả null nếu user chưa Đồng bộ lần nào. */
  static async getScrapedList() {
    if (this._scrapedCache?.data) return this._scrapedCache.data;
    const stored = await this._readScrapedCache();
    if (stored?.data) {
      this._scrapedCache = stored;
      return stored.data;
    }
    return null;
  }

  static getScrapedListSync() {
    return this._scrapedCache?.data || null;
  }

  /** Get render list cho UI dropdown/modal. */
  static async getRenderList() {
    const scraped = await this.getScrapedList();
    return scraped && scraped.length > 0 ? scraped : [];
  }

  /** SYNC version cho UI render — trả từ in-memory cache (trigger read background nếu empty). */
  static getRenderListSync() {
    const scraped = this.getScrapedListSync();
    if (scraped && scraped.length > 0) return scraped;
    // Cache empty → trigger background read từ disk (sau khi xong emit characters:refreshed re-render)
    this.getScrapedList().then(d => {
      if (d && d.length > 0 && window.eventBus) {
        window.eventBus.emit('characters:refreshed', { source: 'disk_read' });
      }
    }).catch(function (_e) { globalThis.SEOSONA_swallow?.('CharacterRegistry', _e); });
    return [];
  }

  /** Tìm character theo slug. */
  static findBySlug(slug) {
    if (!slug) return null;
    const scraped = this.getScrapedListSync();
    if (scraped) {
      return scraped.find(c => c.slug === slug) || null;
    }
    return null;
  }

  /** Tìm character theo name (search_value). */
  static findByName(name) {
    if (!name) return null;
    const scraped = this.getScrapedListSync();
    if (scraped) {
      const key = String(name).toLowerCase();
      return scraped.find(c => (c.search_value || c.name || '').toLowerCase() === key) || null;
    }
    return null;
  }

  /**
   * Lưu scraped list (gọi từ MessageBridge.syncFlowCharacters sau khi scrape xong).
   * @param {Array<{name, thumbnail}>} scrapedCharacters — từ content.js scrapeFlowCharacters
   */
  static async saveScrapedList(scrapedCharacters) {
    const list = Array.isArray(scrapedCharacters) ? scrapedCharacters : [];
    const seen = new Set();
    const merged = [];
    for (const c of list) {
      const name = (c?.name || '').trim();
      if (!name) continue;
      const slug = this._slugify(name);
      if (seen.has(slug)) continue; // dedup theo slug
      seen.add(slug);
      merged.push({
        slug,
        name,
        search_value: name,
        thumbnail_url: c?.thumbnail || c?.thumbnail_url || null,
        scraped_at: Date.now(),
      });
    }

    const cacheData = { data: merged, scrapedAt: Date.now() };
    this._scrapedCache = cacheData;
    await this._writeScrapedCache(cacheData);

    if (window.eventBus) {
      window.eventBus.emit('characters:refreshed', { count: merged.length });
    }
    return merged;
  }

  /** Stats summary. @returns {{ total, scrapedAt }} */
  static getStats() {
    const scraped = this.getScrapedListSync();
    return {
      total: scraped?.length || 0,
      scrapedAt: this._scrapedCache?.scrapedAt || null,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────

  static _slugify(text) {
    let s = String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!s) return 'unknown';
    // Backend slug regex ^[a-z][a-z0-9_]{0,99}$ — PHẢI bắt đầu bằng chữ cái.
    // Tên nhân vật bắt đầu bằng số (vd "3D Hero" → "3d_hero") → prepend 'c_' tránh reject save.
    if (!/^[a-z]/.test(s)) s = 'c_' + s;
    return s.slice(0, 100);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Storage helpers
  // ───────────────────────────────────────────────────────────────────────

  static async _readScrapedCache() {
    return this._readKey(this._CACHE_KEY_SCRAPED);
  }
  static async _writeScrapedCache(data) {
    return this._writeKey(this._CACHE_KEY_SCRAPED, data);
  }

  static async _readKey(key) {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get([key], res => resolve(res[key] || null));
      } else {
        try {
          const cached = localStorage.getItem(key);
          resolve(cached ? JSON.parse(cached) : null);
        } catch { resolve(null); }
      }
    });
  }

  static async _writeKey(key, data) {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [key]: data }, resolve);
      } else {
        try { localStorage.setItem(key, JSON.stringify(data)); } catch (_) { globalThis.SEOSONA_swallow?.('CharacterRegistry', _); }
        resolve();
      }
    });
  }
}

// Export to window for sidebar + content script access
if (typeof window !== 'undefined') {
  window.CharacterRegistry = CharacterRegistry;
}
