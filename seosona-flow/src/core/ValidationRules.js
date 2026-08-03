/**
 * ValidationRules — Initiative 4 (Group B)
 *
 * Fetch + cache global validation rules từ backend.
 * Endpoint: GET /api/v1/validation-rules → flat { key: value } map.
 *
 * Pattern reference: SystemConfig.js (cache 5m, getters typed, SSE invalidate).
 *
 * Backend `SystemSetting group='validation'` (verified rev6 — 4 keys):
 *   - prompt_max_length (int, 5000)
 *   - quantity_min (int, 1)
 *   - quantity_max (int, 4)
 *   - workflow_max_run_duration_sec (int, 3600)
 *
 * Provider-specific (ratios per mode) → ProviderConfigManager.getRatios().
 * KHÔNG nằm ở ValidationRules vì rev6 architecture decision.
 */
class ValidationRules {
  static _cache = null;
  static _cacheTime = 0;
  static _cacheTTL = 60 * 60 * 1000; // [Phase 5 2026-05-24] 1h — ConfigVersionPoller + SSE invalidate
  static _lastVersion = null;        // [Phase 5] cached version từ response.meta.version
  static _GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24h - Phase 3: offline grace period
  static _fetchPromise = null;

  // Phase 3: Server-Only — _DEFAULTS REMOVED
  // All validation rules must come from server via /api/v1/validation-rules

  // ───────────────────────────────────────────────────────────────────────
  // LOCAL MODE (offline) — bundled validation defaults (4 keys như doc rev6)
  // ───────────────────────────────────────────────────────────────────────
  static _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  static _LOCAL_DEFAULTS = {
    prompt_max_length: 5000,
    quantity_min: 1,
    quantity_max: 4,
    workflow_max_run_duration_sec: 3600,
  };

  /** LOCAL: populate cache với defaults (idempotent). */
  static _primeLocalDefaults() {
    if (!this._cache) {
      this._cache = { ...this._LOCAL_DEFAULTS };
      this._cacheTime = Date.now();
    }
    return this._cache;
  }

  // ───────────────────────────────────────────────────────────────────────
  // FETCH
  // ───────────────────────────────────────────────────────────────────────

  static async fetch(forceRefresh = false) {
    // LOCAL: KHÔNG fetch server — trả bundled defaults.
    if (this._isLocal()) return this._primeLocalDefaults();
    if (!forceRefresh && this._cache && Date.now() - this._cacheTime < this._cacheTTL) {
      return this._cache;
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
      const apiBaseUrl = window.ApiBaseConfig.get();
      // Timeout 8s — tránh sidebar đứng hình trên mạng chậm.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      // Anti-clone: X-Extension-Id để pass VerifyExtensionId middleware khi toggle ON
      const headers = { 'Accept': 'application/json' };
      try { if (chrome?.runtime?.id) headers['X-Extension-Id'] = chrome.runtime.id; } catch (_) { globalThis.SEOSONA_swallow?.('ValidationRules', _); }
      // Sprint 3 HMAC: ký để pass VerifySignature enforce mode (đồng bộ background.js)
      try { Object.assign(headers, await (window.RequestSigner?.headers?.('GET', new URL(`${apiBaseUrl}/validation-rules`).pathname, '') || {})); } catch (_) { globalThis.SEOSONA_swallow?.('ValidationRules', _); }
      let resp;
      try {
        resp = await fetch(`${apiBaseUrl}/validation-rules`, { cache: 'no-store', signal: controller.signal, headers });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (json.success && json.data) {
        this._cache = json.data;
        this._cacheTime = Date.now();
        // [Phase 5] Persist version từ meta cho ConfigVersionPoller diff
        if (json.meta && typeof json.meta.version !== 'undefined') {
          this._lastVersion = json.meta.version;
        }
        this._persistToStorage(this._cache);
        return this._cache;
      }
      throw new Error('Invalid response shape');
    } catch (e) {
      console.error('[ValidationRules] Fetch failed, Server-Only requires online:', e.message);
      // Phase 3: Server-Only — no fallback, throw error
      throw new Error('CONFIG_REQUIRED: validation_rules data unavailable');
    }
  }

  /**
   * [Phase 5 2026-05-24] Called by ConfigVersionPoller khi version mismatch.
   * Force fetch fresh, bypass cache TTL.
   */
  static async _updateFromVersion(remoteVersion) {
    if (this._lastVersion === remoteVersion) return; // No-op (Polish 3 defensive)
    console.log('[ValidationRules] Version mismatch:', this._lastVersion, '→', remoteVersion);
    await this.fetch(true); // force=true bypass cache TTL
  }

  /** Force refresh cache */
  static clearCache() {
    this._cache = null;
    this._cacheTime = 0;
  }

  /**
   * Phase 3: Fetch validation rules với mandatory check.
   * @throws {ConfigRequiredError} nếu server unavailable và cache expired (> 24h)
   */
  static async fetchMandatory() {
    // LOCAL: bundled defaults luôn "mandatory-satisfied".
    if (this._isLocal()) return this._primeLocalDefaults();
    const ConfigRequiredError = window.ConfigRequiredError;

    // 1. Try server first
    try {
      const data = await this._doFetch();
      if (data && Object.keys(data).length > 0) {
        return data;
      }
    } catch (e) {
      console.warn('[ValidationRules] fetchMandatory server fail:', e.message);
    }

    // 2. Try existing cache with grace period
    if (this._cache) {
      const cacheAge = Date.now() - (this._cacheTime || 0);

      // Within grace period (24h) - use cache
      if (cacheAge < this._GRACE_PERIOD_MS) {
        console.log(`[ValidationRules] Using cached rules (age: ${Math.round(cacheAge / 1000 / 60)}m)`);
        return this._cache;
      }

      console.warn('[ValidationRules] Cache expired, grace period exceeded');
    }

    // 3. No data available - throw error
    if (ConfigRequiredError) {
      throw new ConfigRequiredError('validation_rules', 'server_unavailable_cache_expired');
    }

    // Fallback if ConfigRequiredError not loaded — still throw
    console.error('[ValidationRules] CRITICAL: No data, ConfigRequiredError not available');
    throw new Error('CONFIG_REQUIRED: validation_rules data unavailable');
  }

  /** Background fetch (fire-and-forget) */
  static fetchInBackground() {
    this.fetch().catch(function (_e) { globalThis.SEOSONA_swallow?.('ValidationRules', _e); });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Phase 3: Server-Only GETTERS (throws if cache empty)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * @throws {ConfigRequiredError} nếu cache rỗng
   */
  static get(key, defaultValue = null) {
    // Check cache exists
    if (!this._cache) {
      this.fetch().catch(function (_e) { globalThis.SEOSONA_swallow?.('ValidationRules', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`validation_${key}`, 'cache_empty');
      }
      return defaultValue;
    }
    const val = this._cache[key];
    if (val !== undefined && val !== null) return val;
    // Key không tồn tại trong cache - có thể là optional
    return defaultValue;
  }

  /**
   * @throws {ConfigRequiredError} nếu cache rỗng
   */
  static getInt(key, defaultValue = 0) {
    // Check cache exists
    if (!this._cache) {
      this.fetch().catch(function (_e) { globalThis.SEOSONA_swallow?.('ValidationRules', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`validation_${key}`, 'cache_empty');
      }
      return defaultValue;
    }
    const val = this._cache[key];
    if (val === undefined || val === null || val === '') return defaultValue;
    const parsed = parseInt(val, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * @throws {ConfigRequiredError} nếu cache rỗng
   */
  static getList(key, defaultValue = []) {
    // Check cache exists
    if (!this._cache) {
      this.fetch().catch(function (_e) { globalThis.SEOSONA_swallow?.('ValidationRules', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`validation_${key}`, 'cache_empty');
      }
      return defaultValue;
    }
    const val = this._cache[key];
    if (val === undefined || val === null || val === '') return defaultValue;
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      return val.split(',').map(s => s.trim()).filter(Boolean);
    }
    return defaultValue;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Phase 3: SAFE GETTERS (catch ConfigRequiredError, return fallback)
  // Use these in UI components for graceful degradation
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Safe version of get - returns defaultValue if data unavailable.
   */
  static safeGet(key, defaultValue = null) {
    try {
      return this.get(key, defaultValue);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        console.warn(`[ValidationRules] safeGet: ${err.message}`);
        return defaultValue;
      }
      throw err;
    }
  }

  /**
   * Safe version of getInt - returns defaultValue if data unavailable.
   */
  static safeGetInt(key, defaultValue = 0) {
    try {
      return this.getInt(key, defaultValue);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        console.warn(`[ValidationRules] safeGetInt: ${err.message}`);
        return defaultValue;
      }
      throw err;
    }
  }

  /**
   * Safe version of getList - returns defaultValue if data unavailable.
   */
  static safeGetList(key, defaultValue = []) {
    try {
      return this.getList(key, defaultValue);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        return defaultValue;
      }
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // SSE invalidation (Initiative 4)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Bug fix (2026-05-14): Emit event SAU KHI fetch xong để getSync() có data mới.
   * Cùng pattern với ModelRegistry.handleSseUpdate.
   */
  static async handleSseUpdate(data) {
    console.log('[ValidationRules] SSE validation_rules_updated:', data);
    this.clearCache();

    // Await fetch xong mới emit event để UI có data mới khi re-render
    try {
      await this.fetch();
    } catch (err) {
      console.warn('[ValidationRules] SSE fetch failed, stale cache may be used:', err.message);
    }

    if (window.eventBus) {
      window.eventBus.emit('validation_rules:updated', data);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Storage helpers
  // ───────────────────────────────────────────────────────────────────────

  static _persistToStorage(data) {
    try {
      chrome.storage?.local?.set({ af_validation_rules: data });
    } catch { /* ignore */ }
  }

  static async hydrateFromStorage() {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.get(['af_validation_rules'], res => {
        if (res.af_validation_rules) {
          this._cache = res.af_validation_rules;
          this._cacheTime = Date.now();
        }
        resolve();
      });
    });
  }
}

// Export + warm-up
if (typeof window !== 'undefined') {
  window.ValidationRules = ValidationRules;
  if (ValidationRules._isLocal()) {
    // LOCAL: prime cache ngay — sync getters (get/getInt/getList) không throw.
    ValidationRules._primeLocalDefaults();
  } else {
    // Hydrate cache từ storage trước, sau đó background fetch
    ValidationRules.hydrateFromStorage().then(() => {
      setTimeout(() => ValidationRules.fetchInBackground(), 200);
    });
  }
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ValidationRules;
}
