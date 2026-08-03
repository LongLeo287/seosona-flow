/**
 * SystemConfig - Fetch and cache public system settings from backend
 * Phase SS-6.1: Extension integration for System Settings
 */
class SystemConfig {
  static _cache = null;
  static _cacheTime = 0;
  static _cacheTTL = 60 * 60 * 1000; // [Phase 5 2026-05-24] 1h — ConfigVersionPoller + SSE invalidate
  static _lastVersion = null;        // [Phase 5] cached version từ response.meta.version

  // Phase 3: Server-Only — _TIMEOUT_DEFAULTS REMOVED
  // Timeout data comes from server via /api/v1/system-settings/public

  /**
   * Fetch settings from backend (with cache)
   * @param {boolean|Object} forceRefresh - Force refresh from server (legacy bool hoặc {force: true} object)
   * @returns {Promise<Object>} Settings object
   */
  static _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  static async fetch(forceRefresh = false) {
    // LOCAL: KHÔNG fetch server — cache bundled defaults (getDefaults()) 1 lần.
    if (this._isLocal()) {
      if (!this._cache) {
        this._cache = this.getDefaults();
        this._cacheTime = Date.now();
        this._persistToStorage(this._cache);
      }
      return this._cache;
    }
    // [Phase 5 2026-05-24] Backward compat: accept cả bool legacy lẫn {force: true} object
    const force = typeof forceRefresh === 'object' ? !!forceRefresh.force : !!forceRefresh;
    if (!force && this._cache && Date.now() - this._cacheTime < this._cacheTTL) {
      return this._cache;
    }

    try {
      const apiBaseUrl = window.ApiBaseConfig.get();
      const headers = {};
      try { if (chrome?.runtime?.id) headers['X-Extension-Id'] = chrome.runtime.id; } catch (_) { globalThis.SEOSONA_swallow?.('SystemConfig', _); }
      // Sprint 3 HMAC: ký để pass VerifySignature enforce mode (đồng bộ background.js)
      try { Object.assign(headers, await (window.RequestSigner?.headers?.('GET', new URL(`${apiBaseUrl}/system-settings/public`).pathname, '') || {})); } catch (_) { globalThis.SEOSONA_swallow?.('SystemConfig', _); }
      // Timeout 8s — tránh sidebar đứng hình trên mạng chậm.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let resp;
      try {
        resp = await fetch(`${apiBaseUrl}/system-settings/public`, { headers, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!resp.ok) throw new Error('Failed to fetch system settings');

      const data = await resp.json();
      if (data.success) {
        this._cache = data.data;
        this._cacheTime = Date.now();
        // [Phase 5] Persist version từ meta cho ConfigVersionPoller diff
        if (data.meta && typeof data.meta.version !== 'undefined') {
          this._lastVersion = data.meta.version;
        }
        this._persistToStorage(this._cache);
        return this._cache;
      }
      throw new Error(data.error?.message || 'Unknown error');
    } catch (err) {
      console.warn('[SystemConfig] Fetch failed:', err.message);
      // Set cache to defaults when fetch fails so getBool/get work correctly
      this._cache = this.getDefaults();
      // [Fix offline] KHÔNG ghim defaults "tươi" 1h — set cacheTime=0 để lần fetch sau (mạng lại /
      // mở login modal) re-fetch ngay, lấy config thật → nút Google/UI hiện lại thay vì kẹt defaults.
      this._cacheTime = 0;
      return this._cache;
    }
  }

  /**
   * [Phase 5 2026-05-24] Called by ConfigVersionPoller khi version mismatch.
   * Force fetch fresh, bypass cache TTL.
   */
  static async _updateFromVersion(remoteVersion) {
    if (this._lastVersion === remoteVersion) return; // No-op (Polish 3 defensive)
    console.log('[SystemConfig] Version mismatch:', this._lastVersion, '→', remoteVersion);
    await this.fetch({ force: true });
    // Re-apply UI sau khi cache refreshed (admin có thể đã đổi app_name, maintenance, ...)
    try { this.applyToUI(); } catch (_) { globalThis.SEOSONA_swallow?.('SystemConfig', _); }
  }

  /**
   * Get default settings structure (for cache init when fetch fails).
   * Phase 3: Server-Only — only non-critical UI flags have defaults.
   * Critical timeouts MUST come from server.
   * @returns {Object} Minimal default settings
   */
  static getDefaults() {
    return {
      // Non-critical UI flags only — safe to have defaults
      // [Fix offline] fail-open: config chưa biết (offline) → vẫn HIỆN nút Google ở login modal
      // (login vốn cần mạng; offline bấm thì fail nhẹ nhàng). Online → config thật từ server override.
      google_enabled: true,
      show_upgrade_ui: true,
      show_tip_coffee: true,
      maintenance_mode: false,
      maintenance_message: '',
      // [Audit 2026-07-07] KHÔNG để workflow_web_mode trong defaults: nếu boot fetch fail → _cache=defaults
      // có key=false → getBoolReady tưởng "đã có giá trị server" → KHÔNG retry → kẹt extension mode.
      // Vắng key → getBoolReady tự force-fetch lại từ server. getBool vẫn trả false khi vắng (an toàn).
      app_name: 'SEOSONA Flow',
      // Phase 3: Server-Only — critical settings removed from defaults
      // Timeout values, verification flags, URLs must come from server
    };
  }

  /**
   * Handle SSE system_settings_changed event.
   * Updates cache and re-applies UI immediately.
   * @param {Object} data - Settings payload from SSE
   */
  static handleSseUpdate(data) {
    if (!data || typeof data !== 'object') return;
    this._cache = data;
    this._cacheTime = Date.now();
    this._persistToStorage(this._cache);
    this.applyToUI();
    console.log('[SystemConfig] Updated via SSE, maintenance_mode:', this.getBool('maintenance_mode'));
  }

  /**
   * Get a specific setting value
   * @param {string} key - Setting key
   * @param {*} defaultValue - Default value if key not found
   * @returns {*} Setting value
   */
  static get(key, defaultValue = null) {
    return this._cache?.[key] ?? defaultValue;
  }

  /**
   * Get a boolean setting value (handles '0', '1', true, false)
   * @param {string} key - Setting key
   * @returns {boolean} Boolean value
   */
  static getBool(key) {
    const val = this._cache?.[key];
    return val === true || val === '1' || val === 1;
  }

  /**
   * [Audit 2026-07-07] getBool async an toàn cold-start + stale-cache: đảm bảo có ĐÚNG key trước khi
   * đọc → fix "click 1 sai mode, click 2 đúng" (fetch boot chưa xong / storage cũ chưa có key).
   *   1. _cache CÓ key → dùng ngay.
   *   2. storage CÓ key → dùng (+ warm _cache).
   *   3. Cả 2 thiếu key → FETCH fresh từ server (server đã deploy key) → dùng.
   */
  static async getBoolReady(key) {
    const truthy = (v) => v === true || v === '1' || v === 1;
    const before = this._cache?.[key];
    // Gate mode-switch (click 1 lần) → LUÔN force-fetch giá trị server MỚI NHẤT, KHÔNG BAO GIỜ tin
    // _cache (có thể stale 'false' từ boot/tab-switch trước khi SSE cập nhật → click đầu sai mode).
    try { await this.fetch(true); } catch (_) { globalThis.SEOSONA_swallow?.('SystemConfig#truthy', _); }
    const after = this._cache?.[key];
    console.log(`[SystemConfig.getBoolReady] ${key}: cache_before=${before} → fetched=${after}`);
    return truthy(after);
  }

  /**
   * Get an integer setting value (Initiative 4 — validation rules).
   * Handles: number, numeric string ('5000'), null/undefined → defaultValue.
   * @param {string} key
   * @param {number} defaultValue
   * @returns {number}
   */
  static getInt(key, defaultValue = 0) {
    const val = this._cache?.[key];
    if (val === undefined || val === null || val === '') return defaultValue;
    const parsed = parseInt(val, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Get a list setting value (Initiative 4 — validation rules).
   * Handles: array, comma-separated string ('a,b,c'), null → defaultValue.
   * Empty strings sau split bị filter ra.
   * @param {string} key
   * @param {string[]} defaultValue
   * @returns {string[]}
   */
  static getList(key, defaultValue = []) {
    const val = this._cache?.[key];
    if (val === undefined || val === null || val === '') return defaultValue;
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      return val.split(',').map(s => s.trim()).filter(Boolean);
    }
    return defaultValue;
  }

  /**
   * Get a JSON-parsed setting value (Initiative 4).
   * Handles: object (already parsed), JSON string → parse, null → defaultValue.
   * @param {string} key
   * @param {*} defaultValue
   * @returns {*}
   */
  static getJSON(key, defaultValue = null) {
    const val = this._cache?.[key];
    if (val === undefined || val === null || val === '') return defaultValue;
    if (typeof val === 'object') return val;
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return defaultValue; }
    }
    return defaultValue;
  }

  /**
   * Phase 3: Server-Only — Get timeout value from server cache.
   * No fallback — throws if cache empty.
   *
   * Usage: SystemConfig.getTimeout('api_timeout_ms') // 60000
   *
   * @param {string} key - Timeout key (e.g., 'api_timeout_ms')
   * @returns {number} Timeout value in ms (or count for limits)
   * @throws {ConfigRequiredError} if cache empty
   */
  static getTimeout(key) {
    // Server cache (fetched from backend)
    const serverVal = this._cache?.[key];
    if (serverVal !== undefined && serverVal !== null && serverVal !== '') {
      const parsed = parseInt(serverVal, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
    // Phase 3: Server-Only — throw if no server data
    if (window.ConfigRequiredError && !this._cache) {
      this.fetch().catch(function (_e) { globalThis.SEOSONA_swallow?.('SystemConfig#truthy', _e); }); // Trigger background fetch
      throw new window.ConfigRequiredError(`timeout_${key}`, 'cache_empty');
    }
    // Key missing in cache — return 0 (optional key)
    return 0;
  }

  /**
   * Safe version of getTimeout — returns 0 if data unavailable.
   */
  static safeGetTimeout(key) {
    try {
      return this.getTimeout(key);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        console.debug(`[SystemConfig] safeGetTimeout: ${err.message}`);
        return 0;
      }
      throw err;
    }
  }

  /**
   * Debug helper: log all timeout values with source info.
   * Run in console: SystemConfig.debugTimeouts()
   */
  static debugTimeouts() {
    console.group('[SystemConfig] Timeout Values Debug');
    console.log('Cache loaded:', !!this._cache);
    console.log('Cache contents:', this._cache);
    console.groupEnd();
    return { cache: this._cache };
  }

  /**
   * Clear the cache (force next fetch to refresh)
   */
  static clearCache() {
    this._cache = null;
    this._cacheTime = 0;
  }

  /**
   * Persist settings to chrome.storage.local for cross-window access (settings popup)
   * @private
   */
  static _persistToStorage(data) {
    try {
      chrome.storage?.local?.set({ af_system_settings: data });
    } catch (_) { /* ignore */ }
  }

  /**
   * Restore settings from chrome.storage.local (for popup windows)
   * This is sync-first: immediately populate cache from storage before any API call
   * @returns {Promise<Object>} Settings object
   */
  static async restoreFromStorage() {
    return new Promise((resolve) => {
      try {
        chrome.storage?.local?.get(['af_system_settings'], (res) => {
          if (res?.af_system_settings) {
            this._cache = res.af_system_settings;
            this._cacheTime = Date.now() - (this._cacheTTL - 60000); // Consider slightly stale
          }
          resolve(this._cache || this.getDefaults());
        });
      } catch (_) {
        resolve(this.getDefaults());
      }
    });
  }

  /**
   * Apply system settings to UI elements
   * Should be called after fetch() completes
   */
  static applyToUI() {
    // SS-6.4: Hide Google buttons if disabled
    const googleEnabled = this.getBool('google_enabled');
    document.querySelectorAll('[data-requires-google]').forEach(el => {
      el.style.display = googleEnabled ? '' : 'none';
    });
    // Also hide dividers before Google buttons if Google is disabled
    if (!googleEnabled) {
      const googleLoginBtn = document.getElementById('googleLoginBtn');
      const googleRegisterBtn = document.getElementById('googleRegisterBtn');
      [googleLoginBtn, googleRegisterBtn].forEach(btn => {
        if (btn) {
          const prevDivider = btn.previousElementSibling;
          if (prevDivider?.classList?.contains('login-divider')) {
            prevDivider.style.display = 'none';
          }
        }
      });
    }

    // SS-6.5: Show maintenance overlay if enabled
    this._applyMaintenanceMode();

    // SS-6.6: Update app name in header
    const appName = this.get('app_name');
    if (appName) {
      const headerTitles = document.querySelectorAll('.seosonaflow-header-title');
      headerTitles.forEach(el => { el.textContent = appName; });
      const headerLogos = document.querySelectorAll('.seosonaflow-header-logo img');
      headerLogos.forEach(el => { el.alt = appName; });
    }

    // SS-6.7: Update app logo in header (sidebar + workflow brand zone + settings about)
    const logoUrl = this.get('app_logo_url');
    if (logoUrl) {
      const headerLogos = document.querySelectorAll('.seosonaflow-header-logo img, .seosonaflow-header-logo-img');
      headerLogos.forEach(el => {
        el.dataset.fallbackSrc = el.src;
        el.src = logoUrl;
        el.onerror = function() {
          if (this.dataset.fallbackSrc) {
            this.src = this.dataset.fallbackSrc;
          }
        };
      });
    }
  }

  /**
   * Apply maintenance mode overlay
   * @private
   */
  static _applyMaintenanceMode() {
    const isMaintenanceMode = this.getBool('maintenance_mode');
    let overlay = document.getElementById('seosonaflow-maintenance-overlay');

    if (isMaintenanceMode) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'seosonaflow-maintenance-overlay';
        overlay.className = 'maintenance-overlay';
        // H7: static markup via innerHTML is safe, but the server-controlled
        // maintenance_message must go through textContent (see update branch below).
        overlay.innerHTML = `
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v4"></path>
            <path d="m4.93 4.93 2.83 2.83"></path>
            <path d="M2 12h4"></path>
            <path d="m4.93 19.07 2.83-2.83"></path>
            <path d="M12 18v4"></path>
            <path d="m19.07 19.07-2.83-2.83"></path>
            <path d="M18 12h4"></path>
            <path d="m19.07 4.93-2.83 2.83"></path>
            <circle cx="12" cy="12" r="4"></circle>
          </svg>
          <h2></h2>
          <p></p>
        `;
        const titleEl = overlay.querySelector('h2');
        if (titleEl) titleEl.textContent = window.I18n?.t('msg.maintenanceTitle') || 'Bảo trì hệ thống';
        const pEl = overlay.querySelector('p');
        if (pEl) pEl.textContent = this.get('maintenance_message', window.I18n?.t('msg.maintenanceDefault') || 'Hệ thống đang được bảo trì. Vui lòng quay lại sau.');
        document.body.appendChild(overlay);
      } else {
        // Update message if already exists
        const msgEl = overlay.querySelector('p');
        if (msgEl) {
          msgEl.textContent = this.get('maintenance_message', window.I18n?.t('msg.maintenanceDefault') || 'Hệ thống đang được bảo trì. Vui lòng quay lại sau.');
        }
        overlay.style.display = '';
      }
    } else if (overlay) {
      overlay.style.display = 'none';
    }
  }
}

// Export to global scope
window.SystemConfig = SystemConfig;
// LOCAL: prime cache với bundled defaults để getBool/get/getInt hoạt động ngay
// (không phụ thuộc lần fetch đầu tiên).
if (SystemConfig._isLocal() && !SystemConfig._cache) {
  SystemConfig._cache = SystemConfig.getDefaults();
  SystemConfig._cacheTime = Date.now();
}
