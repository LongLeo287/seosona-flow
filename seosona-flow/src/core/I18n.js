/**
 * I18n - Internationalization System
 * Supports: vi (Vietnamese - default), en (English)
 */
class I18n {
  static _translations = {};
  static _currentLocale = 'vi';
  static _fallbackLocale = 'vi';
  static _initialized = false;

  /**
   * LOCAL/OFFLINE mode: true khi self.SEOSONA_LOCAL_MODE !== false (mặc định).
   * Local → dùng bundled locale tables (hardcoded fallback + window.I18N_* nếu có),
   * KHÔNG fetch server (/i18n/{locale}, /default-settings).
   */
  static _isLocalMode() {
    try {
      const root = (typeof self !== 'undefined') ? self : window;
      if (root.RuntimeMode?.isLocal) return root.RuntimeMode.isLocal();
      return root.SEOSONA_LOCAL_MODE !== false;
    } catch (_) {
      return true;
    }
  }

  static SUPPORTED_LOCALES = [
    { code: 'vi', name: 'Tiếng Việt', flag: 'VI' },
    { code: 'en', name: 'English', flag: 'EN' }
  ];

  /**
   * Initialize i18n system
   */
  static async init(defaultLocale = null) {
    if (this._initialized) return;

    // Priority: param → storage (af_locale / af_settings.language) → server default → 'vi'
    const savedLocale = await this._getSavedLocale();

    // LOCAL: bỏ qua fetch admin default locale từ server → dùng 'vi' fallback.
    let serverDefaultLocale = null;
    if (!defaultLocale && !savedLocale && !this._isLocalMode()) {
      serverDefaultLocale = await this._fetchServerDefaultLocale();
    }

    let picked = defaultLocale || savedLocale || serverDefaultLocale || 'vi';
    // Chỉ chấp nhận locale được hỗ trợ (vi/en). Locale cũ đã bỏ (th/ja) → về 'vi'.
    if (!this.SUPPORTED_LOCALES.some(l => l.code === picked)) picked = 'vi';
    this._currentLocale = picked;

    // Persist nếu chưa lưu HOẶC saved locale không còn hợp lệ (dọn 'th'/'ja' cũ trong storage).
    if (!savedLocale || savedLocale !== this._currentLocale) {
      this._persistLocale(this._currentLocale);
    }

    await this._loadTranslations();
    this._initialized = true;

    const source = defaultLocale ? 'param' : savedLocale ? 'storage' : serverDefaultLocale ? 'server' : 'fallback';
    console.log('[I18n] Initialized:', this._currentLocale, `(${source})`);
  }

  /**
   * Post-audit fix: fetch admin default locale từ /api/v1/default-settings.
   * Timeout 2s để không block UI nếu backend slow.
   */
  static async _fetchServerDefaultLocale() {
    try {
      const baseUrl = window.ApiBaseConfig.get();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      // Anti-clone: X-Extension-Id để pass VerifyExtensionId middleware khi toggle ON
      const headers = {};
      try { if (chrome?.runtime?.id) headers['X-Extension-Id'] = chrome.runtime.id; } catch (_) { globalThis.SEOSONA_swallow?.('I18n', _); }
      // Sprint 3 HMAC: ký để pass VerifySignature enforce mode (đồng bộ background.js)
      try { Object.assign(headers, await (window.RequestSigner?.headers?.('GET', new URL(`${baseUrl}/default-settings`).pathname, '') || {})); } catch (_) { globalThis.SEOSONA_swallow?.('I18n', _); }
      const resp = await fetch(`${baseUrl}/default-settings`, {
        cache: 'no-store',
        signal: controller.signal,
        headers,
      });
      clearTimeout(timeoutId);
      if (!resp.ok) return null;
      const json = await resp.json();
      const lang = json?.data?.language;
      if (lang && this.SUPPORTED_LOCALES.some(l => l.code === lang)) {
        return lang;
      }
      return null;
    } catch (e) {
      console.warn('[I18n] Server default locale fetch failed:', e.message);
      return null;
    }
  }

  static _persistLocale(locale) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ af_locale: locale });
      } else {
        localStorage.setItem('af_locale', locale);
      }
    } catch (e) { /* ignore */ }
  }

  static async _getSavedLocale() {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        // Post-audit fix: đọc cả 2 keys với priority:
        //   1. af_locale  — explicit user choice (modal language picker)
        //   2. af_settings.language — admin default (synced từ /api/v1/default-settings)
        //   3. null → caller fallback hardcoded 'vi'
        // Trước fix: chỉ đọc af_locale → anonymous user thấy 'vi' dù admin set default_language='en'.
        chrome.storage.local.get(['af_locale', 'af_settings'], result => {
          const explicit = result.af_locale;
          const fromSettings = result.af_settings?.language;
          resolve(explicit || fromSettings || null);
        });
      } else {
        const explicit = localStorage.getItem('af_locale');
        let fromSettings = null;
        try {
          const raw = localStorage.getItem('af_settings');
          if (raw) fromSettings = JSON.parse(raw).language;
        } catch (_) { /* ignore */ }
        resolve(explicit || fromSettings || null);
      }
    });
  }

  static _detectBrowserLocale() {
    const browserLang = navigator.language?.split('-')[0] || 'vi';
    const supported = this.SUPPORTED_LOCALES.map(l => l.code);
    return supported.includes(browserLang) ? browserLang : 'vi';
  }

  static async _loadTranslations() {
    // SEOSONA Flow: Load hardcoded Vietnamese fallback first
    // so UI works even when server is unavailable
    const fallback = {
      'project.selectTitle': 'Chọn dự án',
      'project.selectDesc': 'Chọn dự án Google Flow để bắt đầu',
      'project.searchPlaceholder': 'Tìm dự án...',
      'project.createNew': 'Tạo dự án mới',
      'project.emptyMsg': 'Chưa có dự án nào',
      'project.noMatch': 'Không tìm thấy dự án',
      'project.maybeDeleted': 'Có thể đã xóa',
      'project.resync': 'Đồng bộ lại',
      'project.syncing': 'Đang đồng bộ...',
      'project.synced': 'Đã đồng bộ',
      'project.noProjects': 'Chưa có dự án',
      'common.delete': 'Xóa',
      'common.cancel': 'Hủy',
      'common.save': 'Lưu',
      'common.close': 'Đóng',
      'common.retry': 'Thử lại',
      'common.saved': 'Đã lưu',
      'common.confirm': 'Xác nhận',
      'common.loading': 'Đang tải...',
      'tab.gen': 'Gen',
      'tab.tasks': 'Tasks',
      'tab.workflow': 'Spaces',
      'tab.templates': 'Templates',
      'tab.history': 'Lịch sử',
      'tab.photos': 'Photos',
      'tab.tools': 'Tools',
      'tab.logs': 'Logs',
      'tab.prompts': 'Prompts',
      'header.capture': 'Chụp ảnh',
      'header.language': 'Ngôn ngữ',
      'header.settings': 'Cài đặt',
      'settings.title': 'Cài đặt',
      'settings.theme': 'Giao diện',
      'settings.extensionLink': 'Trang Extension',
      'dialog.offline': 'Mất kết nối',
      'dialog.offlineDescription': 'Không thể kết nối tới máy chủ',
      'app.checkingLogin': 'Đang kiểm tra...',
      'app.loadingConfig': 'Đang tải cấu hình...',
      'app.loadingSystemConfig': 'Đang tải cấu hình hệ thống...',
      'app.loadError': 'Lỗi tải dữ liệu',
      'gen.promptPlaceholder': 'Nhập prompt của bạn...',
      'gen.generate': 'Generate',
      'gen.promptSave': 'Lưu prompt',
      'gen.imageCountLabel': 'Số lượng',
      'gen.aspectRatioLabel': 'Tỉ lệ',
      'gen.modelLabel': 'Model',
      'gen.durationLabel': 'Thời lượng',
      'gen.autoDownload': 'Tự động tải',
      'gen.downloadResolution': 'Chất lượng tải',
      'msg.quotaExhausted': 'Đã hết lượt dùng',
      'msg.upgradeRequired': 'Cần nâng cấp',
      'overlay.moduleBlocked': 'Tính năng bị khóa',
      'overlay.requiresLogin': 'Yêu cầu đăng nhập',
      'workflow.createNew': 'Tạo workflow mới',
      'workflow.emptyTitle': 'Chưa có workflow',
      'workflow.search': 'Tìm kiếm',
      'workflow.searchPlaceholder': 'Tìm workflow...',
      'workflow.run': 'Chạy',
      'workflow.runAll': 'Chạy tất cả',
      'workflow.add': 'Thêm',
      'workflow.reload': 'Tải lại',
      'workflow.createFirst': 'Tạo workflow đầu tiên',
      'workflow.importFromFile': 'Import từ file',
      'workflow.filterByProject': 'Lọc theo dự án',
      'workflow.noProjectForWorkflow': 'Mở dự án Flow để tạo workflow',
      'workflow.openWorkflowTabRetry': 'Mở tab Workflow để thử lại',
      'templates.category': 'Danh mục',
      'templates.searchPrompt': 'Tìm template...',
      'templates.myPrompts': 'Prompt của tôi',
      'templates.add': 'Thêm',
      'templates.addPrompt': 'Thêm prompt',
      'tasks.addTask': 'Thêm task',
      'tasks.runAll': 'Chạy tất cả',
      'tasks.parallel': 'Song song',
      'tasks.taskName': 'Tên task',
      'tasks.add': 'Thêm',
      'tasks.runMode': 'Chế độ chạy',
      'tasks.runSingleConfirmTitle': 'Chạy task này?',
      'tasks.runSingleConfirmBtn': 'Chạy',
      'tools.angles': 'Angles',
      'tools.anglesDesc': 'Tạo góc chụp đa dạng',
      'tools.effects': 'Effects',
      'tools.effectsDesc': 'Thêm hiệu ứng video',
      'tools.telegram': 'Telegram Bot',
      'tools.telegramDesc': 'Tự động hóa qua Telegram',
      'tools.aiAgent': 'AI Agent (MCP)',
      'tools.aiAgentDesc': 'Kết nối AI Agent',
    };

    // Merge fallback into translations
    this._mergeTranslations('vi', fallback);

    // Merge bundled locale tables nếu được load qua window (window.I18N_VI/EN/TH/JA).
    // LOCAL mode dùng chúng làm nguồn chính; nếu chưa bundle thì fallback hardcoded ở trên
    // + cache local vẫn đủ để UI hoạt động offline.
    this._mergeBundledTranslations();

    // Step 1: Apply cached translations from chrome.storage (instant if available)
    try {
      const cached = await this._readStorageCache(this._currentLocale);
      if (cached?.data) {
        this._mergeTranslations(this._currentLocale, cached.data);
      }
    } catch (_) { /* ignore */ }

    // Step 2: Try fetch from server (non-blocking — won't crash if fails).
    // LOCAL: bỏ qua hoàn toàn — chỉ dùng bundled + cache, không gọi backend.
    if (!this._isLocalMode()) {
      this._fetchServerTranslations(this._currentLocale).catch(function (_e) { globalThis.SEOSONA_swallow?.('I18n', _e); });
    }
  }

  /**
   * Merge bundled locale tables exposed on the global (window/self) — hỗ trợ cả
   * flat map ("workflow.title": "...") lẫn nested object. Tên global theo convention
   * window.I18N_<UPPER_LOCALE> (VD window.I18N_VI, window.I18N_EN).
   */
  static _mergeBundledTranslations() {
    try {
      const root = (typeof self !== 'undefined') ? self : window;
      for (const { code } of this.SUPPORTED_LOCALES) {
        const table = root[`I18N_${code.toUpperCase()}`];
        if (!table || typeof table !== 'object') continue;
        this._mergeBundledTable(code, table);
      }
    } catch (_) { /* ignore — fallback + cache vẫn đủ */ }
  }

  /** Merge 1 bundled table (flat dot-keys hoặc nested) vào _translations[locale]. */
  static _mergeBundledTable(locale, table) {
    const isFlat = Object.keys(table).some(k => k.includes('.') && typeof table[k] !== 'object');
    if (isFlat) {
      this._mergeTranslations(locale, table);
    } else {
      if (!this._translations[locale]) this._translations[locale] = {};
      this._deepMerge(this._translations[locale], table);
    }
  }

  /** Deep-merge source object vào target (không ghi đè branch bằng primitive). */
  static _deepMerge(target, source) {
    for (const [k, v] of Object.entries(source)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (!target[k] || typeof target[k] !== 'object') target[k] = {};
        this._deepMerge(target[k], v);
      } else {
        target[k] = v;
      }
    }
  }


  /**
   * (Group E) Fetch translations từ server cho 1 locale.
   * Merge vào in-memory `_translations` + cache vào chrome.storage.
   */
  static async _fetchServerTranslations(locale) {
    // LOCAL: không gọi backend — bundled tables + cache đã đủ.
    if (this._isLocalMode()) return;
    try {
      const baseUrl = window.ApiBaseConfig.get();
      // Anti-clone: X-Extension-Id để pass VerifyExtensionId middleware khi toggle ON
      const headers = {};
      try { if (chrome?.runtime?.id) headers['X-Extension-Id'] = chrome.runtime.id; } catch (_) { globalThis.SEOSONA_swallow?.('I18n', _); }
      // Sprint 3 HMAC: ký để pass VerifySignature enforce mode (đồng bộ background.js)
      try { Object.assign(headers, await (window.RequestSigner?.headers?.('GET', new URL(`${baseUrl}/i18n/${locale}`).pathname, '') || {})); } catch (_) { globalThis.SEOSONA_swallow?.('I18n', _); }
      const resp = await fetch(`${baseUrl}/i18n/${locale}`, { cache: 'no-store', headers });
      if (!resp.ok) return;

      const json = await resp.json();
      if (!json.success || !json.data) return;

      this._mergeTranslations(locale, json.data);
      await this._writeStorageCache(locale, {
        version: json.version,
        data: json.data,
        fetchedAt: Date.now(),
      });

      if (window.eventBus) {
        window.eventBus.emit('i18n:reloaded', { locale });
      }
    } catch (e) {
      console.warn(`[I18n] Fetch ${locale} failed:`, e.message);
    }
  }

  /**
   * (Group E) Merge flat key→value map vào nested _translations[locale].
   * VD: { "workflow.title": "Workflow" } → this._translations[locale].workflow.title = "Workflow"
   */
  static _mergeTranslations(locale, flatKeyValueMap) {
    if (!this._translations[locale]) this._translations[locale] = {};
    for (const [key, value] of Object.entries(flatKeyValueMap)) {
      this._setNestedValue(this._translations[locale], key, value);
    }
  }

  /** Set nested object value bằng dot-notation key */
  static _setNestedValue(obj, key, value) {
    const parts = key.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  // (Group E) chrome.storage cache helpers
  static async _readStorageCache(locale) {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        resolve(null);
        return;
      }
      chrome.storage.local.get([`seosona_i18n_${locale}`], res => {
        resolve(res[`seosona_i18n_${locale}`] || null);
      });
    });
  }

  static async _writeStorageCache(locale, payload) {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.set({ [`seosona_i18n_${locale}`]: payload }, resolve);
    });
  }

  static getLocale() {
    return this._currentLocale;
  }

  static getSupportedLocales() {
    return this.SUPPORTED_LOCALES;
  }

  static async setLocale(locale, emitEvent = true) {
    if (!this.SUPPORTED_LOCALES.some(l => l.code === locale)) {
      console.warn('[I18n] Unsupported locale:', locale);
      return;
    }

    const previousLocale = this._currentLocale;
    this._currentLocale = locale;

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ af_locale: locale });
    } else {
      localStorage.setItem('af_locale', locale);
    }

    console.log('[I18n] Locale changed to:', locale);

    // 2026-05-25 BUG FIX: server-only i18n — locale mới chưa có translations trong memory.
    // Trước fix: chỉ flip _currentLocale flag + emit event → UI re-render với
    // `_translations[newLocale]=undefined` → t() return undefined → user thấy fallback strings
    // (English hardcoded) → user phải đóng extension reload để init() fetch translations.
    // Sau fix: load translations cho locale mới (cache hit instant, else fetch ~500ms blocking)
    // → emit i18n:changed SAU khi data ready → UI re-render thấy đúng strings.
    if (previousLocale !== locale) {
      try {
        await this._loadTranslations();
      } catch (e) {
        console.warn('[I18n] Failed to load translations for', locale, ':', e?.message);
      }
    }

    if (emitEvent && window.eventBus) {
      window.eventBus.emit('i18n:changed', { locale });
    }
  }

  static t(key, params = {}) {
    // Guard: nếu translations chưa load, return undefined để fallback hoạt động
    if (!this._translations || Object.keys(this._translations).length === 0) {
      return undefined;
    }

    let translation = this._getNestedValue(this._translations[this._currentLocale], key);

    if (translation === undefined && this._currentLocale !== this._fallbackLocale) {
      translation = this._getNestedValue(this._translations[this._fallbackLocale], key);
    }

    if (translation === undefined) {
      // Bug fix 2026-05-25: trước fix return `key` literal (truthy) → callers dùng
      // pattern `t(key) || fallback` không bao giờ fallback vì `"common.saved"` truthy →
      // user thấy raw key trong UI khi backend chưa seed key mới.
      // Now return undefined → `|| fallback` works. Dev miss-key vẫn track qua console.warn.
      if (!this._missingKeyWarned) this._missingKeyWarned = new Set();
      if (!this._missingKeyWarned.has(key)) {
        this._missingKeyWarned.add(key);
        console.debug(`[I18n] Missing key: "${key}" (locale=${this._currentLocale}, fallback=${this._fallbackLocale}) — using caller fallback`);
      }
      return undefined;
    }

    if (params && typeof translation === 'string') {
      // Audit fix: escape param values by default so callers that pipe t() output
      // into innerHTML (e.g. [data-i18n-html]) can't inject markup via param values.
      // Opt-out: pass a param key with `__raw` suffix — reserved for trusted markup.
      Object.keys(params).forEach(param => {
        const raw = params[param];
        const value = param.endsWith('__raw') ? String(raw ?? '') : I18n._escapeHtmlParam(raw);
        translation = translation.replace(new RegExp(`\\{${param}\\}`, 'g'), value);
      });
    }

    return translation;
  }

  /** Escape HTML special chars for i18n param substitution. */
  static _escapeHtmlParam(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Sanitize a translation HTML string before assigning to innerHTML.
   * Server-loaded translations are untrusted — strip script tags, inline
   * event handlers, and javascript:/data: URIs. CSP already blocks script
   * execution in the extension page; this is defense-in-depth against markup.
   */
  static _sanitizeI18nHtml(html) {
    if (html === null || html === undefined) return '';
    return String(html)
      .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
      .replace(/<\s*script[^>]*>/gi, '')
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/data:text\/html/gi, '');
  }

  static _getNestedValue(obj, key) {
    if (!obj || !key) return undefined;
    return key.split('.').reduce((o, k) => (o || {})[k], obj);
  }

  static scopedT(scope) {
    return (key, params) => this.t(`${scope}.${key}`, params);
  }

  static applyTranslations(container = document) {
    container.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const paramsStr = el.getAttribute('data-i18n-params');
      let params = {};
      if (paramsStr) { try { params = JSON.parse(paramsStr); } catch(e) { params = {}; } }
      const val = this.t(key, params);
      // Key thiếu (chưa seed) → t() trả undefined → GIỮ text mặc định trong HTML (fallback),
      // KHÔNG set "undefined"/rỗng. Nhất quán với pattern t(key) || fallback.
      if (val !== undefined) el.textContent = val;
    });

    container.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const ph = this.t(el.getAttribute('data-i18n-placeholder'));
      if (ph !== undefined) el.placeholder = ph;
    });

    container.querySelectorAll('[data-i18n-title]').forEach(el => {
      const text = this.t(el.getAttribute('data-i18n-title'));
      if (text === undefined) return; // key thiếu → giữ title/tooltip HTML sẵn có
      // Tab menu: skip tooltip — text label đã hiển thị inline, KHÔNG cần tooltip thêm
      const isTabButton = el.hasAttribute('data-tab') || el.classList.contains('seosonaflow-tab');
      if (!isTabButton) {
        el.setAttribute('data-tooltip', text);
      } else {
        // Vẫn xóa data-tooltip nếu set trước đó (idempotent khi i18n re-apply)
        if (el.hasAttribute('data-tooltip')) el.removeAttribute('data-tooltip');
      }
      if (!el.hasAttribute('aria-label')) {
        el.setAttribute('aria-label', text);
      }
      // Xóa native title (đã set bởi static HTML) để tránh duplicate tooltip
      if (el.hasAttribute('title')) el.removeAttribute('title');
    });

    container.querySelectorAll('[data-i18n-value]').forEach(el => {
      const v = this.t(el.getAttribute('data-i18n-value'));
      if (v !== undefined) el.value = v;
    });

    container.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const a = this.t(el.getAttribute('data-i18n-aria'));
      if (a !== undefined) el.setAttribute('aria-label', a);
    });

    container.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      const paramsStr = el.getAttribute('data-i18n-params');
      let params2 = {};
      if (paramsStr) { try { params2 = JSON.parse(paramsStr); } catch(e) { params2 = {}; } }
      // Audit fix: params are already escaped by t(); additionally sanitize the
      // full translation string (server-loaded, untrusted) before innerHTML.
      const rawHtml = this.t(key, params2);
      if (rawHtml !== undefined) el.innerHTML = this._sanitizeI18nHtml(rawHtml);
    });

    container.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
      const tip = this.t(el.getAttribute('data-i18n-tooltip'));
      if (tip !== undefined) el.setAttribute('data-tooltip', tip);
    });
  }

  static formatDate(date, options = {}) {
    const d = date instanceof Date ? date : new Date(date);
    const locale = this.getLocaleCode();
    return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', ...options }).format(d);
  }

  static formatTime(date, options = {}) {
    const d = date instanceof Date ? date : new Date(date);
    const locale = this.getLocaleCode();
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', ...options }).format(d);
  }

  static formatDateTime(date, options = {}) {
    const d = date instanceof Date ? date : new Date(date);
    const locale = this.getLocaleCode();
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', ...options
    }).format(d);
  }

  static getLocaleCode() {
    const localeMap = { vi: 'vi-VN', en: 'en-US' };
    return localeMap[this._currentLocale] || 'en-US';
  }

  static formatNumber(number, options = {}) {
    return new Intl.NumberFormat(this.getLocaleCode(), options).format(number);
  }

  static formatCurrency(amount, currency = null) {
    const currencyMap = { vi: 'VND', en: 'USD' };
    const curr = currency || currencyMap[this._currentLocale] || 'VND';
    return new Intl.NumberFormat(this.getLocaleCode(), {
      style: 'currency', currency: curr,
      minimumFractionDigits: curr === 'VND' ? 0 : 2
    }).format(amount);
  }

  static getCurrentLocaleInfo() {
    return this.SUPPORTED_LOCALES.find(l => l.code === this._currentLocale) || this.SUPPORTED_LOCALES[0];
  }

  /**
   * Initiative 3 (Group B prep): Invalidate cached translations cho 1 locale.
   * Clear in-memory + storage cache → next loadTranslations() sẽ re-fetch từ server.
   *
   * Group E (i18n dynamic loading) sẽ implement server fetch trong _loadTranslations.
   * Tạm thời (Group B): method này chỉ clear cache; behavior thực tế phụ thuộc loader version.
   *
   * @param {string} locale — 'vi' | 'en' (hoặc null để clear all)
   */
  static invalidate(locale = null) {
    if (locale) {
      delete this._translations[locale];
      // Clear storage cache key (sẽ dùng khi Group E implement dynamic load)
      try {
        chrome.storage?.local?.remove([`seosona_i18n_${locale}`]);
      } catch (_) { /* ignore */ }
      console.log(`[I18n] Invalidated locale: ${locale}`);
    } else {
      this._translations = {};
      try {
        chrome.storage?.local?.get(null, items => {
          const keysToRemove = Object.keys(items || {}).filter(k => k.startsWith('seosona_i18n_'));
          if (keysToRemove.length > 0) chrome.storage.local.remove(keysToRemove);
        });
      } catch (_) { /* ignore */ }
      console.log('[I18n] Invalidated all locales');
    }
  }

  /**
   * Initiative 3 (Group B prep): Force reload translations.
   * Re-run _loadTranslations() + emit 'i18n:reloaded' để UI re-render.
   *
   * Group E sẽ extend _loadTranslations để fetch từ /api/v1/i18n/{locale}.
   * Tạm thời (Group B): chỉ re-assign từ window.I18N_VI/EN/... inline data.
   */
  static async reload() {
    await this._loadTranslations();
    if (window.eventBus) {
      window.eventBus.emit('i18n:reloaded', { locale: this._currentLocale });
    }
    console.log('[I18n] Reloaded translations for locale:', this._currentLocale);
  }

  /**
   * [Phase 5 Polish 5 2026-05-24] Getter — return cached version từ storage cache.
   */
  static async getLocaleVersion(locale) {
    const cached = await this._readStorageCache(locale);
    return cached?.version ?? null;
  }

  /**
   * [Phase 5 2026-05-24] Called by ConfigVersionPoller khi locale version mismatch.
   * Input: localeVersionMap {vi: 567, en: 543}
   * Mismatch CURRENT locale → re-fetch + invalidate + emit reloaded.
   * Other locales: skip (lazy update khi user switch locale).
   */
  static async _updateFromVersion(localeVersionMap) {
    if (!localeVersionMap || typeof localeVersionMap !== 'object') return;

    const currentLocale = this._currentLocale;
    const remoteVersion = localeVersionMap[currentLocale];
    if (remoteVersion === undefined || remoteVersion === null) return;

    const cachedVersion = await this.getLocaleVersion(currentLocale);
    if (cachedVersion === remoteVersion) return; // No-op (Polish 3 defensive)

    console.log(`[I18n] Version mismatch ${currentLocale}: ${cachedVersion} → ${remoteVersion}`);
    // Re-fetch current locale (server response.version sẽ persist via _fetchServerTranslations)
    await this._fetchServerTranslations(currentLocale);
    // _fetchServerTranslations đã emit i18n:reloaded — không cần emit lại
  }
}

window.I18n = I18n;
