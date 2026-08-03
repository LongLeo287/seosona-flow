/**
 * VoiceRegistry — Flow Voice Selector
 *
 * Hybrid storage:
 *   - BASE catalog (server): GET /api/v1/provider-voices?provider=flow
 *     Lưu cache local key `seosona_provider_voices_base`. Admin curate qua /admin/provider-voices.
 *   - SCRAPED list (local-only): user click "Resync Voices" → scrape menu Flow lấy TẤT CẢ
 *     voices user thấy (base + custom của Google account). Lưu key `seosona_provider_voices_scraped`.
 *     KHÔNG sync server (custom voices = per-user personal data tied to Google account trên Flow).
 *
 * Render dropdown UI:
 *   - Nếu có scraped list → render từ đó (chứa cả base + custom với flag is_custom)
 *   - Nếu chưa scrape → fallback render base catalog (mọi user thấy được tối thiểu)
 *
 * Pattern reference: ModelRegistry — same fetch/cache/SSE strategy cho BASE catalog.
 */
class VoiceRegistry {
  // Cache keys
  static _CACHE_KEY_BASE = 'seosona_provider_voices_base';
  static _CACHE_KEY_SCRAPED = 'seosona_provider_voices_scraped';
  static _CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4h
  static _GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24h

  // In-memory cache
  static _baseCache = null;        // { data: [...], expiresAt, fetchedAt }
  static _scrapedCache = null;     // { data: [...], scrapedAt }
  static _lastVersion = null;
  static _fetchPromise = null;
  static _storageListenerRegistered = false;

  // ───────────────────────────────────────────────────────────────────────
  // LOCAL MODE (offline) — bundled base catalog default
  // Khi self.SEOSONA_LOCAL_MODE !== false, KHÔNG fetch server. Base catalog
  // trả list nhỏ dưới đây (hoặc []) để getRenderList*/getBaseCatalog* không
  // throw. Scraped-voices local path (user Resync menu Flow) vẫn hoạt động
  // bình thường và được ưu tiên khi có.
  // ───────────────────────────────────────────────────────────────────────
  static _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  // Base catalog default (fallback offline trước khi user Resync) — PHẢI đủ shape pipeline đọc:
  // provider (filter theo providerSlug), slug/display_name/search_value (VoicePicker render). Thiếu →
  // filter .provider==='flow' trả [] → dropdown voice RỖNG offline (CONFIG_MISSING-class).
  static _LOCAL_BASE_CATALOG = [
    { id: 1, provider: 'flow', slug: 'achernar',   display_name: 'Achernar',   search_value: 'Achernar',   name: 'Achernar',   description: 'Female, soft, high pitch' },
    { id: 2, provider: 'flow', slug: 'achird',     display_name: 'Achird',     search_value: 'Achird',     name: 'Achird',     description: 'Male, friendly, mid pitch' },
    { id: 3, provider: 'flow', slug: 'algenib',    display_name: 'Algenib',    search_value: 'Algenib',    name: 'Algenib',    description: 'Male, gravelly, low pitch' },
    { id: 4, provider: 'flow', slug: 'algieba',    display_name: 'Algieba',    search_value: 'Algieba',    name: 'Algieba',    description: 'Male, easy-going, mid-low pitch' },
    { id: 5, provider: 'flow', slug: 'alnilam',    display_name: 'Alnilam',    search_value: 'Alnilam',    name: 'Alnilam',    description: 'Male, firm, mid-low pitch' },
    { id: 6, provider: 'flow', slug: 'aoede',      display_name: 'Aoede',      search_value: 'Aoede',      name: 'Aoede',      description: 'Female, breezy, mid pitch' },
    { id: 7, provider: 'flow', slug: 'autonoe',    display_name: 'Autonoe',    search_value: 'Autonoe',    name: 'Autonoe',    description: 'Female, bright, mid pitch' },
    { id: 8, provider: 'flow', slug: 'callirrhoe', display_name: 'Callirrhoe', search_value: 'Callirrhoe', name: 'Callirrhoe', description: 'Female, easy-going, mid pitch' }
  ];

  /** LOCAL: populate base cache với default list (idempotent). */
  static _primeLocalBase() {
    if (!this._baseCache?.data) {
      this._baseCache = {
        data: this._LOCAL_BASE_CATALOG,
        expiresAt: Date.now() + this._CACHE_TTL_MS,
        fetchedAt: Date.now(),
      };
    }
    return this._baseCache.data;
  }

  /**
   * Init cross-context sync — chrome.storage.onChanged broadcast tự động giữa
   * sidebar/settings.html. Khi settings page click Resync → write storage →
   * sidebar instance VoiceRegistry tự reload cache + emit eventBus.
   * Call 1 lần lúc bootstrap (idempotent).
   */
  static initCrossContextSync() {
    if (this._storageListenerRegistered) return;
    if (typeof chrome === 'undefined' || !chrome?.storage?.onChanged) return;

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[this._CACHE_KEY_SCRAPED]) {
        // Reset in-memory cache → force re-read từ storage lần next
        this._scrapedCache = null;
        // Re-read + emit để UI re-render
        this.getScrapedList().then(() => {
          if (window.eventBus) {
            window.eventBus.emit('voices:refreshed', { source: 'cross_context_sync' });
          }
        });
      }
      if (changes[this._CACHE_KEY_BASE]) {
        this._baseCache = null;
        if (window.eventBus) {
          window.eventBus.emit('voices:base_catalog_updated', { source: 'cross_context_sync' });
        }
      }
    });

    this._storageListenerRegistered = true;
  }

  // ───────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Fetch base catalog từ server (cached).
   * @returns {Array<{slug, display_name, search_value, description, thumbnail_url, ...}>}
   */
  static async getBaseCatalog(providerSlug = 'flow') {
    if (this._baseCache && Date.now() < this._baseCache.expiresAt) {
      return this._baseCache.data.filter(v => v.provider === providerSlug);
    }
    if (this._fetchPromise) return this._fetchPromise;

    this._fetchPromise = this._doFetchBase(providerSlug);
    try {
      return await this._fetchPromise;
    } finally {
      this._fetchPromise = null;
    }
  }

  /**
   * SYNC version — return base catalog từ memory cache, null nếu chưa load.
   */
  static getBaseCatalogSync(providerSlug = 'flow') {
    if (!this._baseCache?.data) return null;
    return this._baseCache.data.filter(v => v.provider === providerSlug);
  }

  /**
   * Get scraped list (local-only). Trả null nếu user chưa Resync lần nào.
   */
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

  /**
   * Get render list cho UI dropdown.
   * Priority: scraped list (có custom voices) > base catalog (fallback fresh install).
   * @returns {Array} với mỗi item có flag `is_custom`
   */
  static async getRenderList(providerSlug = 'flow') {
    const scraped = await this.getScrapedList();
    if (scraped && scraped.length > 0) {
      return scraped;
    }
    const base = await this.getBaseCatalog(providerSlug);
    return (base || []).map(v => ({ ...v, is_custom: false }));
  }

  /**
   * SYNC version cho UI render — trả từ in-memory cache.
   * Nếu cache empty → trigger background fetch (giống ModelRegistry pattern).
   */
  static getRenderListSync(providerSlug = 'flow') {
    const scraped = this.getScrapedListSync();
    if (scraped && scraped.length > 0) return scraped;
    const base = this.getBaseCatalogSync(providerSlug);
    if (base && base.length > 0) {
      return base.map(v => ({ ...v, is_custom: false }));
    }
    // Cache empty → trigger background fetch để render dropdown khi data về
    // (caller render với [] → empty placeholder, sau khi fetch xong eventBus.emit('voices:base_catalog_updated') re-render)
    this.getBaseCatalog(providerSlug).catch(function (_e) { globalThis.SEOSONA_swallow?.('VoiceRegistry', _e); });
    return [];
  }

  /**
   * Tìm voice theo slug. Ưu tiên scraped list (có custom) > base catalog.
   * @returns {Object|null} { slug, display_name, search_value, ... }
   */
  static findBySlug(slug) {
    if (!slug) return null;
    const scraped = this.getScrapedListSync();
    if (scraped) {
      const hit = scraped.find(v => v.slug === slug);
      if (hit) return hit;
    }
    const base = this.getBaseCatalogSync();
    if (base) {
      return base.find(v => v.slug === slug) || null;
    }
    return null;
  }

  /**
   * Lưu scraped list (gọi từ MessageBridge.syncFlowVoices sau khi scrape xong).
   * Merge với base catalog để flag is_custom.
   */
  static async saveScrapedList(scrapedVoices, providerSlug = 'flow') {
    const base = await this.getBaseCatalog(providerSlug);
    const baseSearchValues = new Set((base || []).map(v => (v.search_value || '').toLowerCase()));
    const baseBySearchValue = new Map((base || []).map(v => [(v.search_value || '').toLowerCase(), v]));

    const merged = scrapedVoices.map(scraped => {
      const searchValue = scraped.name; // tên hiển thị trong menu Flow = search_value
      const key = searchValue.toLowerCase();
      const isCustom = !baseSearchValues.has(key);

      if (!isCustom) {
        // Voice đã có trong base catalog → dùng metadata từ base (slug, display_name, thumbnail, ...)
        const baseVoice = baseBySearchValue.get(key);
        return {
          slug: baseVoice.slug,
          provider: baseVoice.provider,
          display_name: baseVoice.display_name,
          search_value: baseVoice.search_value,
          description: baseVoice.description || scraped.description,
          thumbnail_url: baseVoice.thumbnail_url,
          thumbnail_full_url: baseVoice.thumbnail_full_url,
          sample_url: baseVoice.sample_url || null,   // 2026-05-30: audio preview .wav/.mp3
          gender: baseVoice.gender,
          pitch_tier: baseVoice.pitch_tier,
          is_premium: baseVoice.is_premium || false,
          is_custom: false,
          scraped_at: Date.now(),
        };
      }

      // Custom voice — slug = slugify(name) local-only, KHÔNG match server slug
      return {
        slug: this._slugify(searchValue),
        provider: providerSlug,
        display_name: searchValue,
        search_value: searchValue,
        description: scraped.description || null,
        thumbnail_url: null,
        thumbnail_full_url: null,
        sample_url: null,   // Custom voice không có sample (chưa upload server)
        gender: null,
        pitch_tier: null,
        is_premium: false,
        is_custom: true,
        scraped_at: Date.now(),
      };
    });

    const cacheData = { data: merged, scrapedAt: Date.now() };
    this._scrapedCache = cacheData;
    await this._writeScrapedCache(cacheData);

    if (window.eventBus) {
      window.eventBus.emit('voices:refreshed', { count: merged.length, provider: providerSlug });
    }

    return merged;
  }

  /**
   * Re-merge scraped list với base catalog mới (gọi sau SSE update base catalog).
   * Cập nhật flag is_custom + metadata từ base (vd thumbnail mới upload).
   */
  static async reMergeScrapedWithBase(providerSlug = 'flow') {
    // BUG FIX: phải load scraped từ chrome.storage nếu memory null — trước đây early-return
    // khiến scraped trên disk giữ data CŨ sau SSE update → modal sau khi mở lấy stale scraped.
    if (!this._scrapedCache?.data) {
      await this.getScrapedList();   // populate memory từ disk
      if (!this._scrapedCache?.data) {
        console.log('[VoiceRegistry] reMergeScrapedWithBase: no scraped cache (user chưa Resync), skip');
        return;
      }
    }
    const base = await this.getBaseCatalog(providerSlug);
    const baseBySearchValue = new Map((base || []).map(v => [(v.search_value || '').toLowerCase(), v]));

    const remerged = this._scrapedCache.data.map(v => {
      const key = (v.search_value || '').toLowerCase();
      const baseVoice = baseBySearchValue.get(key);
      if (baseVoice) {
        // Carry tất cả field admin có thể update (đồng bộ với fingerprint VoiceSelectModal).
        return {
          ...v,
          slug: baseVoice.slug,
          display_name: baseVoice.display_name,
          search_value: baseVoice.search_value || v.search_value,
          description: baseVoice.description || v.description,
          thumbnail_url: baseVoice.thumbnail_url,
          thumbnail_full_url: baseVoice.thumbnail_full_url,
          sample_url: baseVoice.sample_url || null,   // re-merge audio preview URL
          gender: baseVoice.gender || v.gender,
          pitch_tier: baseVoice.pitch_tier || v.pitch_tier,
          sort_order: baseVoice.sort_order ?? v.sort_order,
          is_premium: baseVoice.is_premium || false,
          is_custom: false,
        };
      }
      return { ...v, is_custom: true };
    });

    const cacheData = { data: remerged, scrapedAt: this._scrapedCache.scrapedAt };
    this._scrapedCache = cacheData;
    await this._writeScrapedCache(cacheData);

    if (window.eventBus) {
      window.eventBus.emit('voices:refreshed', { count: remerged.length, source: 'sse_remerge' });
    }
  }

  /**
   * Handle SSE 'provider_voices_updated' event.
   * Invalidate base cache + refetch + re-merge scraped (nếu có).
   */
  static async handleSseUpdate(data) {
    console.log('[VoiceRegistry] SSE provider_voices_updated:', data);
    // Provider field bắt buộc — defensive nếu backend gửi event không đúng shape
    const provider = data?.provider || 'flow';
    if (!data?.provider) {
      console.warn('[VoiceRegistry] SSE event missing provider field — fallback "flow" (verify backend MercurePublisher)');
    }

    // Bust _fetchPromise nếu đang inflight — đảm bảo fresh fetch sau clear cache.
    this._fetchPromise = null;
    this._baseCache = null;
    await this._clearBaseCache();
    console.log('[VoiceRegistry] SSE: cache cleared, starting refetch...');

    try {
      const base = await this.getBaseCatalog(provider);
      // Tìm voice theo slug đã update (data.slug) để verify display_name MỚI có về tới extension
      const targetSlug = data?.slug;
      const targetInBase = targetSlug ? base?.find(v => v.slug === targetSlug) : base?.[0];
      console.log('[VoiceRegistry] SSE: getBaseCatalog returned count=' + (Array.isArray(base) ? base.length : 'N/A')
        + ' target=' + (targetSlug || 'first')
        + ' display_name=' + (targetInBase?.display_name || 'MISSING')
        + ' sample_url=' + (targetInBase?.sample_url || 'null'));
      await this.reMergeScrapedWithBase(provider);
      // Sau re-merge, verify scraped có chứa data mới chưa
      const scraped = this._scrapedCache?.data;
      const targetInScraped = targetSlug && Array.isArray(scraped) ? scraped.find(v => v.slug === targetSlug) : null;
      console.log('[VoiceRegistry] SSE: reMergeScrapedWithBase done. scraped target='
        + (targetInScraped ? ('display_name=' + targetInScraped.display_name + ' sample_url=' + targetInScraped.sample_url) : 'NOT_FOUND_OR_NO_SCRAPED'));
    } catch (err) {
      console.warn('[VoiceRegistry] SSE refetch failed:', err.message, err.stack);
    }

    if (window.eventBus) {
      console.log('[VoiceRegistry] SSE: emit voices:base_catalog_updated to eventBus');
      window.eventBus.emit('voices:base_catalog_updated', data);
    } else {
      console.warn('[VoiceRegistry] SSE: window.eventBus missing — modal listener will NOT fire');
    }
  }

  /**
   * Stats summary cho Settings UI.
   * @returns {{ total, base, custom, scrapedAt }}
   */
  static getStats() {
    const scraped = this.getScrapedListSync();
    if (scraped) {
      const custom = scraped.filter(v => v.is_custom).length;
      return {
        total: scraped.length,
        base: scraped.length - custom,
        custom,
        scrapedAt: this._scrapedCache?.scrapedAt || null,
      };
    }
    const base = this.getBaseCatalogSync();
    return {
      total: base?.length || 0,
      base: base?.length || 0,
      custom: 0,
      scrapedAt: null,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // INTERNAL — Fetch base catalog
  // ───────────────────────────────────────────────────────────────────────

  static async _doFetchBase(providerSlug) {
    // LOCAL: KHÔNG fetch server — trả bundled base catalog (filter theo provider).
    if (this._isLocal()) {
      this._primeLocalBase();
      return (this._baseCache.data || []).filter(v => v.provider === providerSlug);
    }
    try {
      const baseUrl = await this._getApiBaseUrl();
      const url = `${baseUrl}/voices/base-catalog`;
      const headers = { Accept: 'application/json' };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      let resp;
      try {
        resp = await fetch(url, {
          method: 'GET',
          headers: headers,
          cache: 'no-store',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();

      if (json.success && Array.isArray(json.data)) {
        const processed = json.data.map(v => {
          if (v.config && typeof v.config === 'string') {
            try { v.config = JSON.parse(v.config); } catch (_) { globalThis.SEOSONA_swallow?.('VoiceRegistry', _); }
          }
          return v;
        });
        const cacheData = {
          data: processed,
          expiresAt: Date.now() + this._CACHE_TTL_MS,
          fetchedAt: Date.now(),
        };
        this._baseCache = cacheData;
        if (json.meta && typeof json.meta.version !== 'undefined') {
          this._lastVersion = json.meta.version;
        }
        await this._writeBaseCache(cacheData);

        if (window.eventBus) {
          window.eventBus.emit('voices:base_catalog_updated', { source: 'initial_fetch' });
        }
        return processed.filter(v => v.provider === providerSlug);
      }

      throw new Error('Invalid response shape');
    } catch (e) {
      console.warn('[VoiceRegistry] Fetch base catalog failed:', e.message);

      // Fallback: stale cache
      const stale = await this._readBaseCache();
      if (stale?.data) {
        this._baseCache = { ...stale, expiresAt: Date.now() + 5 * 60 * 1000 };
        return stale.data.filter(v => v.provider === providerSlug);
      }

      return [];
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────

  static _slugify(text) {
    // Unicode-safe: strip combining diacritical marks (U+0300..U+036F)
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 100) || 'unknown';
  }

  static async _getApiBaseUrl() {
    return new Promise(resolve => {
      const webBase = window.ApiBaseConfig?.getWebBase?.();
      if (webBase) {
        resolve(webBase);
        return;
      }
      resolve('http://localhost:8080');
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Storage helpers
  // ───────────────────────────────────────────────────────────────────────

  static async _readBaseCache() {
    return this._readKey(this._CACHE_KEY_BASE);
  }
  static async _writeBaseCache(data) {
    return this._writeKey(this._CACHE_KEY_BASE, data);
  }
  static async _clearBaseCache() {
    return this._removeKey(this._CACHE_KEY_BASE);
  }
  static async _readScrapedCache() {
    return this._readKey(this._CACHE_KEY_SCRAPED);
  }
  static async _writeScrapedCache(data) {
    return this._writeKey(this._CACHE_KEY_SCRAPED, data);
  }
  static async _clearScrapedCache() {
    return this._removeKey(this._CACHE_KEY_SCRAPED);
  }

  static async _readKey(key) {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get([key], res => {
          resolve(res[key] || null);
        });
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
        try { localStorage.setItem(key, JSON.stringify(data)); } catch (_) { globalThis.SEOSONA_swallow?.('VoiceRegistry', _); }
        resolve();
      }
    });
  }

  static async _removeKey(key) {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove([key], resolve);
      } else {
        try { localStorage.removeItem(key); } catch (_) { globalThis.SEOSONA_swallow?.('VoiceRegistry', _); }
        resolve();
      }
    });
  }
}

// Export to window for sidebar + content script access
if (typeof window !== 'undefined') {
  window.VoiceRegistry = VoiceRegistry;
  // LOCAL: prime base cache để getBaseCatalogSync/getRenderListSync có data ngay.
  if (VoiceRegistry._isLocal()) {
    VoiceRegistry._primeLocalBase();
  }
}
