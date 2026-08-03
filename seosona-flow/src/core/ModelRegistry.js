/**
 * ModelRegistry — Initiative 1 (Group B)
 *
 * Fetch + cache danh sách AI models từ backend (GET /api/v1/provider-models).
 * Replace 11+ vị trí hardcode `Nano Banana`, `Veo 3.1` rải rác trong extension.
 *
 * Pattern reference: ProviderConfigManager (same caching + SSE invalidate strategy).
 *
 * API response format (verified từ Api/V1/ProviderModelController):
 *   [
 *     {
 *       "id": 1,
 *       "provider": "flow",          // slug, đã flatten từ relationship
 *       "media_type": "image",
 *       "name": "Nano Banana Pro",
 *       "value": "Nano Banana Pro",
 *       "is_default": false,
 *       "is_premium": false,
 *       "required_feature_key": null,
 *       "min_extension_version": null,
 *       "sort_order": 1,
 *       "config": null,
 *       ...
 *     }
 *   ]
 *
 * Defaults inline để extension hoạt động offline / first-install trước khi fetch.
 * Verified từ extension code:
 *   - src/workflow/WorkflowEditor.js (legacy VIDEO_MODELS, IMAGE_MODELS)
 *   - src/settings/StorageSettings.js (defaultImageModel, defaultVideoModel)
 */
class ModelRegistry {
  static _CACHE_KEY = 'seosona_provider_models';
  static _CACHE_TTL_MS = 4 * 60 * 60 * 1000; // [Phase 5 2026-05-24] 4h — ConfigVersionPoller detect provider_models version mismatch
  static _lastVersion = null;               // [Phase 5] cached version từ response.meta.version
  static _GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24h - Phase 3: offline grace period
  static _cache = null;
  static _fetchPromise = null;

  // Phase 3: Server-Only — _DEFAULTS REMOVED
  // All model data must come from server via /api/v1/provider-models

  // ───────────────────────────────────────────────────────────────────────
  // LOCAL MODE (offline) — bundled model defaults
  // Khi self.SEOSONA_LOCAL_MODE !== false, KHÔNG fetch server; populate _cache
  // với list dưới đây để getModels/getModelsSync/getDefault/safeGet* hoạt động
  // (không throw ConfigRequiredError).
  // Field shape khớp API: id, provider, media_type, name, value, is_default,
  // is_premium, sort_order, config.
  // ───────────────────────────────────────────────────────────────────────
  static _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  static _LOCAL_MODELS = [
    { id: 1, provider: 'flow',    media_type: 'video', name: 'Omni Flash', value: 'Omni Flash', is_default: true,  is_premium: false, sort_order: 1, config: { duration_tier: 'advanced' } },
    { id: 2, provider: 'flow',    media_type: 'video', name: 'Veo 3.1 Lite', value: 'Veo 3.1 Lite', is_default: false,  is_premium: false, sort_order: 2, config: { duration_tier: 'default' } },
    { id: 3, provider: 'flow',    media_type: 'video', name: 'Veo 3.1 Fast', value: 'Veo 3.1 Fast', is_default: false,  is_premium: false, sort_order: 3, config: { duration_tier: 'default' } },
    { id: 4, provider: 'flow',    media_type: 'video', name: 'Veo 3.1 Quality', value: 'Veo 3.1 Quality', is_default: false,  is_premium: true, sort_order: 4, config: { duration_tier: 'default' } },
    { id: 5, provider: 'flow',    media_type: 'video', name: 'Veo 3.1 Lite [Lower Priority]', value: 'Veo 3.1 Lite [Lower Priority]', is_default: false,  is_premium: false, sort_order: 5, config: { duration_tier: 'default' } },
    { id: 2, provider: 'flow',    media_type: 'image', name: '🍌 Nano Banana Pro', value: 'Nano Banana Pro', is_default: true,  is_premium: false, sort_order: 1, config: { supports_character: true } },
    { id: 25,provider: 'flow',    media_type: 'image', name: '🍌 Nano Banana 2',   value: 'Nano Banana 2',   is_default: false, is_premium: false, sort_order: 2, config: { supports_character: true } },
    { id: 3, provider: 'chatgpt', media_type: 'chat',  name: 'Instant',         value: 'Instant',         is_default: true,  is_premium: false, sort_order: 1, config: null },
    { id: 4, provider: 'grok',    media_type: 'chat',  name: 'Grok',            value: 'grok',            is_default: true,  is_premium: false, sort_order: 1, config: null },
    { id: 99, provider: 'claude',  media_type: 'chat',  name: 'Sonnet 5', value: 'sonnet-5', is_default: true,  is_premium: false, sort_order: 1, config: null },
    { id: 100, provider: 'claude', media_type: 'chat',  name: '👑 Opus 4.8 (Premium)', value: 'opus-4.8', is_default: false, is_premium: true,  sort_order: 2, config: null },
    { id: 101, provider: 'claude', media_type: 'chat',  name: '👑 Fable 5 (Premium)', value: 'fable-5', is_default: false, is_premium: true,  sort_order: 3, config: null },
    { id: 102, provider: 'claude', media_type: 'chat',  name: 'Haiku 4.5', value: 'haiku-4.5', is_default: false, is_premium: false,  sort_order: 4, config: null },
    { id: 5, provider: 'gemini',  media_type: 'chat',  name: 'Gemini',          value: 'gemini',          is_default: true,  is_premium: false, sort_order: 1, config: null },
  ];

  /** LOCAL: populate in-memory cache (idempotent). */
  static _primeLocalDefaults() {
    if (!this._cache?.data) {
      this._cache = {
        data: this._LOCAL_MODELS,
        expiresAt: Date.now() + this._CACHE_TTL_MS,
        fetchedAt: Date.now(),
      };
    }
    return this._cache.data;
  }

  // ───────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Phase 3: Server-Only — Get list models cho 1 provider + media_type.
   * @returns {Array<{name, value, is_default, is_premium, ...}>}
   * @throws {ConfigRequiredError} nếu không có data
   */
  static async getModels(providerSlug, mediaType) {
    const all = await this.fetch();
    const filtered = (all || []).filter(m => m.provider === providerSlug && m.media_type === mediaType);
    if (filtered.length > 0) return filtered;
    // Server-Only: throw instead of fallback
    if (window.ConfigRequiredError) {
      throw new window.ConfigRequiredError(`models_${providerSlug}_${mediaType}`, 'data_missing');
    }
    return [];
  }

  /**
   * Phase 3: Server-Only — SYNC version, throws if cache empty.
   * @throws {ConfigRequiredError} nếu cache rỗng
   */
  static getModelsSync(providerSlug, mediaType) {
    // Check cache exists
    if (!this._cache?.data) {
      // Trigger background fetch
      this.fetch().catch(function (_e) { globalThis.SEOSONA_swallow?.('ModelRegistry', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`models_${providerSlug}_${mediaType}`, 'cache_empty');
      }
      return [];
    }
    const filtered = this._cache.data.filter(m => m.provider === providerSlug && m.media_type === mediaType);
    if (filtered.length > 0) return filtered;
    // Server-Only: throw instead of fallback
    if (window.ConfigRequiredError) {
      throw new window.ConfigRequiredError(`models_${providerSlug}_${mediaType}`, 'data_missing');
    }
    return [];
  }

  /**
   * Phase 3: Server-Only — Get default model value.
   * Returns m.value (not m.name) to match UI dropdown option values.
   * @returns {string|null}
   * @throws {ConfigRequiredError} nếu không có models
   */
  static getDefault(providerSlug, mediaType) {
    const models = this.getModelsSync(providerSlug, mediaType); // May throw
    const def = models.find(m => m.is_default) || models[0];
    return def?.value || null;
  }

  /**
   * Async version — await fetch nếu chưa cache.
   * Returns m.value (not m.name) to match UI dropdown option values.
   */
  static async getDefaultAsync(providerSlug, mediaType) {
    const models = await this.getModels(providerSlug, mediaType);
    const def = models.find(m => m.is_default) || models[0];
    return def?.value || null;
  }

  /**
   * Get list values only (cho compatibility với existing arrays như IMAGE_MODELS).
   * UI dropdowns store m.value (not m.name), so return values for .includes() checks.
   * @returns {string[]}
   */
  static getValuesList(providerSlug, mediaType) {
    return this.getModelsSync(providerSlug, mediaType).map(m => m.value);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Phase 3: SAFE GETTERS (catch ConfigRequiredError, return fallback)
  // Use these in UI components for graceful degradation
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Safe version of getModelsSync - returns empty array if data unavailable.
   * Use in UI templates where throwing would crash rendering.
   */
  static safeGetModelsSync(providerSlug, mediaType) {
    try {
      return this.getModelsSync(providerSlug, mediaType);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        console.warn(`[ModelRegistry] safeGetModelsSync: ${err.message}`);
        return [];
      }
      throw err;
    }
  }

  /**
   * Safe version of getDefault - returns null if data unavailable.
   */
  static safeGetDefault(providerSlug, mediaType) {
    try {
      return this.getDefault(providerSlug, mediaType);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        console.warn(`[ModelRegistry] safeGetDefault: ${err.message}`);
        return null;
      }
      throw err;
    }
  }

  /**
   * Safe version of getValuesList - returns empty array if data unavailable.
   */
  static safeGetValuesList(providerSlug, mediaType) {
    try {
      return this.getValuesList(providerSlug, mediaType);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        return [];
      }
      throw err;
    }
  }

  /**
   * Tìm 1 model theo (providerSlug, modelValue) — return full model object hoặc null.
   * Dùng để đọc model.config (vd duration_overrides, constraints, ...). Server-Only:
   * cache rỗng → return null (caller handle graceful — không throw).
   *
   * @param {string} providerSlug — 'flow' | 'chatgpt' | 'grok' | 'gemini'
   * @param {string} modelValue — Backend `provider_models.value` (vd 'veo-3.1-fast', 'nano-banana-2')
   * @returns {Object|null} { id, provider, value, name, media_type, config, ... } or null
   */
  static findModel(providerSlug, modelValue) {
    if (!this._cache?.data || !providerSlug || !modelValue) return null;
    return this._cache.data.find(m =>
      m.provider === providerSlug && m.value === modelValue
    ) || null;
  }

  // ───────────────────────────────────────────────────────────────────────
  // FETCH + CACHE
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Fetch từ API với cache. Promise deduplication (multiple awaiters share 1 fetch).
   */
  static async fetch() {
    // LOCAL: KHÔNG fetch server — trả bundled defaults.
    if (this._isLocal()) return this._primeLocalDefaults();
    if (this._cache && Date.now() < this._cache.expiresAt) {
      return this._cache.data;
    }
    if (this._fetchPromise) return this._fetchPromise;

    this._fetchPromise = this._doFetch();
    try {
      return await this._fetchPromise;
    } finally {
      this._fetchPromise = null;
    }
  }

  static async _doFetch() {
    // LOCAL: KHÔNG fetch server — trả bundled defaults.
    if (this._isLocal()) return this._primeLocalDefaults();
    try {
      // Try load disk cache first (warm start)
      const cached = await this._readCache();
      if (cached && Date.now() < cached.expiresAt) {
        this._cache = cached;
        if (window.eventBus) {
          window.eventBus.emit('provider:models_updated', { source: 'disk_cache' });
        }
        return cached.data;
      }

      const baseUrl = await this._getApiBaseUrl();
      const headers = { Accept: 'application/json' };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const providerModelsUrl = `${baseUrl}/provider-models`;
      
      let resp;
      try {
        resp = await fetch(providerModelsUrl, {
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
        // Parse config field if it's a JSON string (Laravel cast issue / cache serialization)
        const processedData = json.data.map(m => {
          if (m.config && typeof m.config === 'string') {
            try { m.config = JSON.parse(m.config); } catch (_) { globalThis.SEOSONA_swallow?.('ModelRegistry', _); }
          }
          return m;
        });
        const cacheData = {
          data: processedData,
          expiresAt: Date.now() + this._CACHE_TTL_MS,
          fetchedAt: Date.now(),
        };
        this._cache = cacheData;
        // [Phase 5] Persist version từ meta cho ConfigVersionPoller diff
        if (json.meta && typeof json.meta.version !== 'undefined') {
          this._lastVersion = json.meta.version;
        }
        await this._writeCache(cacheData);

        // Fix (2026-05-14): Emit event để UI re-render với server data sau initial fetch
        if (window.eventBus) {
          window.eventBus.emit('provider:models_updated', { source: 'initial_fetch' });
        }
        return json.data;
      }

      throw new Error('Invalid response shape');
    } catch (e) {
      console.warn('[ModelRegistry] Fetch failed, using cache/defaults:', e.message);

      // Fallback: stale cache nếu có
      const staleCache = await this._readCache();
      if (staleCache?.data) {
        this._cache = { ...staleCache, expiresAt: Date.now() + 5 * 60 * 1000 };
        return staleCache.data;
      }

      // Phase 3: Server-Only — no fallback, throw error
      console.error('[ModelRegistry] No cache, no server data — Server-Only requires online');
      throw new Error('CONFIG_REQUIRED: models data unavailable');
    }
  }

  /** Force refresh cache */
  static async refresh() {
    this._cache = null;
    await this._clearCache();
    return this.fetch();
  }

  /**
   * [Phase 5 2026-05-24] Called by ConfigVersionPoller khi version mismatch.
   * Force fetch fresh, bypass cache TTL.
   */
  static async _updateFromVersion(remoteVersion) {
    if (this._lastVersion === remoteVersion) return; // No-op (Polish 3 defensive)
    console.log('[ModelRegistry] Version mismatch:', this._lastVersion, '→', remoteVersion);
    await this.refresh();
    // Emit để UI re-render (mirror handleSseUpdate pattern)
    if (window.eventBus) {
      window.eventBus.emit('provider:models_updated', { source: 'version_poller' });
    }
  }

  /**
   * Phase 3: Fetch models với mandatory check.
   * @throws {ConfigRequiredError} nếu server unavailable và cache expired (> 24h)
   */
  static async fetchMandatory() {
    // LOCAL: bundled defaults luôn "mandatory-satisfied".
    if (this._isLocal()) return this._primeLocalDefaults();
    const ConfigRequiredError = window.ConfigRequiredError;

    // 1. Try server first
    try {
      const data = await this._doFetch();
      if (data && data.length > 0) {
        return data;
      }
    } catch (e) {
      console.warn('[ModelRegistry] fetchMandatory server fail:', e.message);
    }

    // 2. Try cache with grace period
    const cached = await this._readCache();
    if (cached?.data) {
      const cacheAge = Date.now() - (cached.fetchedAt || cached.expiresAt - this._CACHE_TTL_MS || 0);

      // Within grace period (24h) - use cache
      if (cacheAge < this._GRACE_PERIOD_MS) {
        console.log(`[ModelRegistry] Using cached models (age: ${Math.round(cacheAge / 1000 / 60)}m)`);
        this._cache = cached;
        return cached.data;
      }

      console.warn('[ModelRegistry] Cache expired, grace period exceeded');
    }

    // 3. No data available - throw error
    if (ConfigRequiredError) {
      throw new ConfigRequiredError('models', 'server_unavailable_cache_expired');
    }

    // Fallback if ConfigRequiredError not loaded — still throw
    console.error('[ModelRegistry] CRITICAL: No data, ConfigRequiredError not available');
    throw new Error('CONFIG_REQUIRED: models data unavailable');
  }

  /** Background fetch (fire-and-forget) */
  static fetchInBackground() {
    this.fetch().catch(function (_e) { globalThis.SEOSONA_swallow?.('ModelRegistry', _e); });
  }

  // ───────────────────────────────────────────────────────────────────────
  // SSE invalidation (Initiative 1)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Handle SSE 'provider_models_updated' event.
   * Force refetch + emit eventBus để UI re-render dropdown.
   *
   * Bug fix (2026-05-14): Emit event SAU KHI fetch xong để getModelsSync() có data mới.
   * Trước đây emit ngay → GenTab gọi getModelsSync() → cache rỗng → throw ConfigRequiredError.
   * Phase 3.5 (2026-05-17): _DEFAULTS đã xóa, giờ throw ConfigRequiredError thay vì fallback.
   */
  static async handleSseUpdate(data) {
    console.log('[ModelRegistry] SSE provider_models_updated:', data);
    // Clear cache → next getModels() sẽ trigger fetch
    this._cache = null;
    this._clearCache().catch(function (_e) { globalThis.SEOSONA_swallow?.('ModelRegistry', _e); });

    // Await fetch xong mới emit event để UI có data mới khi re-render
    try {
      await this.fetch();
    } catch (err) {
      console.warn('[ModelRegistry] SSE fetch failed, UI getModelsSync sẽ throw ConfigRequiredError:', err.message);
    }

    if (window.eventBus) {
      window.eventBus.emit('provider:models_updated', data);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Storage helpers (chrome.storage.local với localStorage fallback)
  // ───────────────────────────────────────────────────────────────────────

  static async _readCache() {
    return new Promise(resolve => {
      const processCache = (cached) => {
        if (!cached?.data) return cached;
        // Parse config field if it's a JSON string (Laravel cast issue / cache serialization)
        cached.data = cached.data.map(m => {
          if (m.config && typeof m.config === 'string') {
            try { m.config = JSON.parse(m.config); } catch (_) { globalThis.SEOSONA_swallow?.('ModelRegistry#processCache', _); }
          }
          return m;
        });
        return cached;
      };
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get([this._CACHE_KEY], res => {
          resolve(processCache(res[this._CACHE_KEY] || null));
        });
      } else {
        try {
          const cached = localStorage.getItem(this._CACHE_KEY);
          resolve(processCache(cached ? JSON.parse(cached) : null));
        } catch {
          resolve(null);
        }
      }
    });
  }

  static async _writeCache(data) {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [this._CACHE_KEY]: data }, resolve);
      } else {
        try {
          localStorage.setItem(this._CACHE_KEY, JSON.stringify(data));
        } catch { /* quota? noop */ }
        resolve();
      }
    });
  }

  static async _clearCache() {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove([this._CACHE_KEY], resolve);
      } else {
        try {
          localStorage.removeItem(this._CACHE_KEY);
        } catch { /* noop */ }
        resolve();
      }
    });
  }

  static async _getApiBaseUrl() {
    // Strict Server-Only: ApiBaseConfig là single source of truth (DEFAULT đã có).
    return new Promise(resolve => {
      const webBase = window.ApiBaseConfig?.getWebBase?.();
      if (!webBase) console.debug('[Tier3] ModelRegistry._getApiBaseUrl: ApiBaseConfig not loaded');
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['af_api_url'], res => {
          resolve(res.af_api_url || webBase);
        });
      } else {
        resolve(webBase);
      }
    });
  }
}

// Export
if (typeof window !== 'undefined') {
  window.ModelRegistry = ModelRegistry;
  // LOCAL: prime cache ngay khi load để sync getters có data ở lần gọi đầu.
  if (ModelRegistry._isLocal()) {
    ModelRegistry._primeLocalDefaults();
  } else {
    // Warm up cache trên load (fire-and-forget, không block)
    setTimeout(() => ModelRegistry.fetchInBackground(), 100);
  }
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModelRegistry;
}
