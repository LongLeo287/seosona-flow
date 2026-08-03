/**
 * StorageSettings - Apply settings on page load + sync to API server
 * Settings UI is in a separate window (settings.html)
 * This module loads, applies, and syncs settings
 *
 * Sync strategy:
 * - Load: local first → merge with server (server wins on conflict)
 * - Save: local immediately → debounce 2s → PUT /settings to server
 * - Login: fetch server settings → merge → apply
 *
 * Phase 2b Migration Complete:
 * Business params (workflow, queue, FAR) đã migrate sang ExecutionConfig.
 * Deprecated fields đã XÓA. Chỉ còn user-controlled preferences.
 * Consumers dùng ExecutionConfig.getXxxConfig() cho server-controlled params.
 */
class StorageSettings {
  // LOCAL MODE: mặc định true (offline). Khi true → dùng bundled defaults + local
  // settings, KHÔNG fetch/push server (không retry loop, không "fetch FAILED").
  static _isLocalMode() {
    try { return self.SEOSONA_LOCAL_MODE !== false; } catch (_) { return true; }
  }

  constructor() {
    this.defaults = {
      // ═══════════════════════════════════════════════════════════
      // USER-CONTROLLED (local) - user tự chỉnh theo hardware/preference
      // ═══════════════════════════════════════════════════════════
      inputTimeout: 1200,     // ms - tốc độ thao tác trên Flow (các delay khác tính tỷ lệ từ đây)

      // Chống ban
      randomDelayMin: 3,      // giây - nghỉ random min giữa các đợt
      randomDelayMax: 10,     // giây - nghỉ random max giữa các đợt

      // Pipeline Queue (user toggle only)
      queueEnabled: false,    // bật/tắt pipeline queue

      // Manual Enter mode (Flow): SEOSONA Flow điền prompt + ref nhưng KHÔNG tự submit — user tự nhấn Enter.
      // Default TẮT. Server default override qua /api/v1/default-settings key manualSubmitMode.
      manualSubmitMode: false,

      // Auto-reload REMOVED 2026-07-26 — promoted to system_settings (Chunk Mode).
      // Đọc từ ExecutionConfig.safeGetFlowChunkConfig() (server-only).

      // ═══════════════════════════════════════════════════════════
      // Download/UI Preferences
      // ═══════════════════════════════════════════════════════════
      autoDownload: false,
      downloadFolder: 'seosonaflow_output',
      fileNameProject: '',
      fileNameTemplate: '[Date]_[Project]_[Prompt]_[Index]',
      downloadResolution: '1k',
      videoDownloadResolution: '720p',
      theme: 'dark',
      language: 'vi',
      notifyOnComplete: true,
      notifySound: false,
      notifyTelegram: false,
      telegramAutoDownload: true,
      telegramDownloadFolder: 'seosonaflow_bot',
      telegramDownloadResolution: '1k',       // resolution ảnh cho Telegram download
      telegramVideoDownloadResolution: '720p', // resolution video cho Telegram download
      mcpAutoDownload: false,                  // MCP lưu local — mặc định TẮT (opt-in)
      mcpDownloadFolder: 'seosonaflow_mcp',
      mcpDownloadResolution: '1k',
      mcpVideoDownloadResolution: '720p',
      // PHASE 3: Multi-provider Telegram settings
      telegramDefaultProvider: 'flow',        // 'flow' | 'chatgpt' | 'grok' — provider mặc định cho Telegram
      // Flow provider settings
      telegramFlowRatio: '16:9',              // tỷ lệ khung hình cho Flow
      // Phase 6 Bug N.2: telegramFlowModel populate lazy từ ModelRegistry sau init() — server-only
      telegramFlowModel: '',                  // populate qua _hydrateModelDefaults() khi ModelRegistry ready
      // ChatGPT provider settings
      telegramChatgptRatio: 'square',         // 'square' | 'landscape' | 'widescreen' | 'portrait' | 'story'
      // Grok provider settings
      telegramGrokMode: 'image',              // 'image' | 'video' — chế độ mặc định
      telegramGrokRatio: 'widescreen',        // 'widescreen' | 'landscape' | 'square' | 'portrait' | 'story'
      telegramGrokDuration: '6s',             // thời lượng video: '6s' | '10s'
      telegramGrokResolution: '720p',         // độ phân giải video: '480p' | '720p'
      telegramGrokImageQuality: 'speed',      // chất lượng ảnh: 'speed' | 'quality'
      blobMaxAgeDays: 7,      // ngày - thời gian lưu blob ảnh album (local/capture)
      humanizedMode: false,
      humanizedSpeed: 0.5,
      defaultGenType: 'Image',
      defaultRatio: '9:16',                   // numeric format khớp gen_tab; mapping VN→numeric vẫn còn cho user cũ đã save 'Dọc'
      defaultImageRatio: '16:9',              // numeric — đồng bộ với Settings popup
      defaultVideoRatio: '16:9',              // numeric
      // 2026-05-29: video_input_type default cho Flow video (Frames | Ingredients)
      // Server tune qua /admin/default-settings → key default_defaultVideoInputType
      defaultVideoInputType: 'Frames',        // 'Frames' (2 inputs interpolation) | 'Ingredients' (1+ ref images)
      // Phase 6 Bug N.2: model defaults populate lazy từ ModelRegistry — server-only
      defaultImageModel: '',                  // populate qua _hydrateModelDefaults()
      defaultVideoModel: '',                  // populate qua _hydrateModelDefaults()
      // CG-5.3 Part B: ChatGPT Provider defaults
      defaultProvider: 'flow',                       // 'flow' | 'chatgpt' | 'grok' — provider mặc định khi mở GenTab
      chatgptDefaultRatio: 'story',                  // 'story' | 'portrait' | 'square' | 'landscape' | 'widescreen'
      chatgptModel: 'Instant',                       // 'Instant' | 'Thinking' (GPT-5.5 variant — server default_chatgpt_model)
      chatgptFallbackPrefix: 'Generate an image of: ', // Prefix prepend khi image mode fail
      chatgptAutoClose: false,                       // Tự đóng tab ChatGPT sau khi generate xong
      chatgptDeleteAfterGen: false,                  // Xóa tin nhắn sau khi gen thành công (2026-05-16)
      // G-4.8: Grok Provider defaults
      grokDefaultMode: 'image',                      // 'image' | 'video'
      grokDefaultRatio: 'widescreen',                // 'story'|'portrait'|'square'|'landscape'|'widescreen'
      grokDefaultDuration: '6s',                     // '6s' | '10s' (chỉ video)
      grokDefaultResolution: '720p',                 // '480p' | '720p' (chỉ video)
      grokDefaultImageQuality: 'speed',              // 'speed' | 'quality' (chỉ image, Grok update 2026-04)
      grokAutoClose: false                           // Tự đóng tab Grok sau khi generate xong
    };

    this.settings = { ...this.defaults };
    this._syncTimer = null;
    this._syncing = false;
    this._fetchingFromServer = false;  // Flag to skip sync when fetching from server
    this.init();
  }

  async init() {
    // [Audit Bug 2 fix] Register listeners FIRST (sync) trước khi await.
    // Trước: await _loadServerDefaults (up to 8s) → register listener → mất auth:login/auth:restored event emit trong window đó.
    this._listenForChanges();
    this._listenForAuthEvents();

    // [Audit Bug 4 fix] Pre-load owner cache để _validateLocalOwner() inline check ra đúng owner.
    // [Audit Bug 5 fix] Pre-load touched cache cho _hasUserOverride() bổ sung explicit-set keys.
    await Promise.all([this._refreshOwnerCache(), this._refreshTouchedCache()]);

    // Initiative 6: Load server defaults để anonymous users nhận admin-tweaked defaults.
    // Endpoint /api/v1/default-settings public, không cần auth.
    await this._loadServerDefaults();
    // Phase 6 Bug N.2: hydrate model defaults từ ModelRegistry (server-only, no hardcoded)
    this._hydrateModelDefaults();
    await this.loadAndApply();

    // Phase 6 Bug N.2: Re-hydrate khi ModelRegistry refresh qua SSE 'provider_models_updated'
    window.eventBus?.on?.('provider:models_updated', () => {
      this._hydrateModelDefaults();
    });
  }

  /**
   * Phase 6 Bug N.2: Populate model defaults từ ModelRegistry sau khi ModelRegistry ready.
   * Trước Phase 6, các fields này hardcoded ('Nano Banana 2', 'Veo 3.1 - Fast') trong defaults.
   * Giờ đọc từ server (is_default=true) — strict Server-Only.
   *
   * Idempotent: chỉ set nếu defaults vẫn empty (chưa hydrate hoặc admin chưa override).
   */
  _hydrateModelDefaults() {
    try {
      const flowImage = window.ModelRegistry?.safeGetDefault?.('flow', 'image');
      const flowVideo = window.ModelRegistry?.safeGetDefault?.('flow', 'video');
      if (flowImage) {
        if (!this.defaults.defaultImageModel) this.defaults.defaultImageModel = flowImage;
        if (!this.defaults.telegramFlowModel) this.defaults.telegramFlowModel = flowImage;
      }
      if (flowVideo && !this.defaults.defaultVideoModel) {
        this.defaults.defaultVideoModel = flowVideo;
      }
    } catch (_) { /* ModelRegistry chưa load — sẽ retry qua SSE event */ }
  }

  /**
   * Initiative 6: Fetch admin defaults từ /api/v1/default-settings.
   * Merge vào this.defaults (chứa user preferences server-controlled, không phải offline fallback).
   *
   * Hoạt động cho cả anonymous + logged-in users (endpoint public).
   * Khi admin update qua /admin/default-settings → SSE 'default_settings_updated' invalidate.
   * Phase 2c (2026-05-17): 16 execution fields đã chuyển sang system_settings group='execution'.
   */
  async _loadServerDefaults() {
    // LOCAL MODE: dùng bundled defaults, KHÔNG fetch server (no retry loop, no "fetch FAILED").
    if (StorageSettings._isLocalMode()) {
      console.log('[StorageSettings] LOCAL MODE — using bundled defaults (skip server defaults fetch)');
      return;
    }
    // [Audit Bug 8 fix] Retry 3 attempts với backoff (0.5s, 1s) + giảm timeout per attempt
    // (4s → 6s → 8s) để tổng wait ≤ 19.5s khi offline. Server-Only spec yêu cầu block UI
    // khi server unreachable, không silent fallback hardcoded.
    const MAX_ATTEMPTS = 3;
    const TIMEOUTS_MS = [4000, 6000, 8000];
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const json = await this._fetchDefaultsOnce(TIMEOUTS_MS[attempt - 1]);
        if (json) return this._applyServerDefaults(json);
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_ATTEMPTS) {
          const delay = 500 * attempt; // 500ms, 1000ms
          console.warn(`[StorageSettings] Server defaults fetch attempt ${attempt}/${MAX_ATTEMPTS} failed (${err.message}), retry in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    // Hết retry — emit event để overlay layer hiển thị "Không có kết nối".
    console.error('[StorageSettings] Server defaults fetch FAILED after retries:', lastErr?.message);
    window.eventBus?.emit?.('config:offline', { source: 'default-settings', error: lastErr?.message });
  }

  async _fetchDefaultsOnce(timeoutMs = 8000) {
    const baseUrl = window.ApiBaseConfig.get();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    // Anti-clone: X-Extension-Id để pass VerifyExtensionId middleware khi toggle ON
    const headers = { 'Accept': 'application/json' };
    try { if (chrome?.runtime?.id) headers['X-Extension-Id'] = chrome.runtime.id; } catch (_) { globalThis.SEOSONA_swallow?.('StorageSettings#_fetchDefaultsOnce', _); }
    // Sprint 3 HMAC: ký để pass VerifySignature enforce mode (đồng bộ background.js)
    try { Object.assign(headers, await (window.RequestSigner?.headers?.('GET', new URL(`${baseUrl}/default-settings`).pathname, '') || {})); } catch (_) { globalThis.SEOSONA_swallow?.('StorageSettings#_fetchDefaultsOnce', _); }
    let resp;
    try {
      resp = await fetch(`${baseUrl}/default-settings`, { cache: 'no-store', signal: controller.signal, headers });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const json = await resp.json();
    return (json.success && json.data && typeof json.data === 'object') ? json : null;
  }

  _applyServerDefaults(json) {
    try {
      // Server defaults override hardcoded — server là source of truth khi available.
      const prevLanguage = this.defaults.language;
      this.defaults = { ...this.defaults, ...json.data };
      // [Phase 5] Persist version từ meta cho ConfigVersionPoller diff
      if (json.meta && typeof json.meta.version !== 'undefined') {
        this._lastVersion = json.meta.version;
      }
      console.log('[StorageSettings] Loaded server defaults (Initiative 6)');

      // Post-audit fix #1: persist server defaults vào af_settings storage nếu fresh install.
      // Đảm bảo I18n._getSavedLocale đọc af_settings.language ở lần init kế tiếp (reload).
      // Trước fix: anonymous user xóa+reinstall vẫn 'vi' vì af_settings trống → fallback hardcoded.
      chrome.storage?.local?.get(['af_settings'], (res) => {
        const existing = res.af_settings;
        const isFreshInstall = !existing || Object.keys(existing).length === 0;
        if (isFreshInstall) {
          chrome.storage.local.set({ af_settings: this.defaults }, () => {
            console.log('[StorageSettings] Persisted server defaults to af_settings (fresh install)');
          });
        }
      });

      // Post-audit fix #2: nếu language đổi (admin set 'en' lần đầu, anonymous user chưa
      // explicit chọn) → trigger I18n reload với locale mới NGAY trong session hiện tại.
      const newLanguage = json.data.language;
      if (newLanguage && newLanguage !== prevLanguage && window.I18n?.setLocale) {
        // Chỉ override nếu user CHƯA explicit chọn locale (af_locale chưa có).
        chrome.storage?.local?.get(['af_locale'], (res) => {
          if (!res.af_locale) {
            console.log(`[StorageSettings] Anonymous user: applying admin default_language=${newLanguage}`);
            window.I18n.setLocale(newLanguage);
          }
        });
      }
    } catch (e) {
      console.warn('[StorageSettings] _applyServerDefaults error:', e.message);
    }
  }

  /**
   * Load settings: local → merge server (if logged in)
   */
  async loadAndApply() {
    try {
      // 1. Load local settings
      const localSettings = await new Promise(resolve => {
        chrome.storage.local.get(['af_settings'], res => resolve(res.af_settings || {}));
      });

      // Bug fix 2026-05-22 v2: phân biệt "real user override" vs "defaults được persist".
      // _loadServerDefaults persist TOÀN BỘ defaults vào af_settings khi fresh install (cho I18n).
      // → Sau logout localSettings có 53 keys = defaults → Object.keys.length > 0 KHÔNG đủ để
      // detect real override. Cần DEEP COMPARE: chỉ count override khi value ≠ default.
      // [Audit Bug 4 fix] Validate ownership trước — discard stale data của user khác.
      const validLocal = this._validateLocalOwner(localSettings);
      const hasRealLocal = this._hasUserOverride(validLocal);
      this.settings = { ...this.defaults, ...validLocal };

      // 2. If logged in, fetch server settings and merge
      // Local wins CHỈ KHI có real override (user đã thay đổi). Post-logout localSettings = defaults → server wins.
      // [Re-Audit Issue 4] Skip duplicate fetch nếu auth:restored.onAuthIn vừa fetch (<3s) → tránh request thừa khi cold-start race.
      if (true && (!this._lastServerFetch || Date.now() - this._lastServerFetch > 3000)) {
        try {
          this._fetchingFromServer = true;  // Prevent sync back to server
          const serverData = await this._fetchServerSettings();
          if (serverData?.settings_json) {
            this.settings = hasRealLocal
              ? { ...this.defaults, ...serverData.settings_json, ...this._extractOverrides(validLocal) } // CHỈ override thật wins (tránh default-local đè server)
              : { ...this.defaults, ...serverData.settings_json };                  // server wins (post-logout)
            // Save merged settings back to local — đợi onChanged listener xử lý xong rồi mới reset flag (Bug 7).
            await this._saveLocalAndAwaitChange(this.settings);
          }
        } catch (err) {
          console.warn('[StorageSettings] Server sync failed, using local:', err.message);
        } finally {
          // [Audit Bug 7 fix] Reset ngay sau khi save promise resolved (onChanged đã trigger trong promise).
          this._fetchingFromServer = false;
        }
      }

      // 3. Apply settings
      this.applyTheme(this.settings.theme);
      this.syncExecutorSettings(this.settings);

      console.log('[StorageSettings] Settings applied');
      // Bug fix 2026-05-22: emit event để GenTab/TaskModal re-eval defaultProvider sau khi
      // server settings merged (race: GenTab init đọc empty af_settings → settings load sau).
      window.eventBus?.emit?.('storageSettings:loaded', { settings: this.settings });
    } catch (error) {
      console.error('[StorageSettings] Load failed:', error);
    }
  }

  getSettings() {
    return this.settings;
  }

  // K.7 (2026-05-29): Shorthand reader cho call sites cần 1 key cụ thể.
  // Trước fix: WorkflowEditor + NodeTemplates gọi `storageSettings?.get?.('defaultVideoInputType')`
  // → method không tồn tại → optional chain trả undefined → fallback hardcoded 'Frames' dù
  // admin tune 'Ingredients' qua /admin/default-settings. Hai sites thay vì refactor sang
  // `getSettings()?.[key]`, thêm method `get(key)` đơn giản hơn + chuẩn convention.
  get(key) {
    return this.settings?.[key];
  }

  /**
   * Persist 1 setting từ code sidebar (vd GenTab auto-persist submit mode).
   * Cập nhật in-memory NGAY + write af_settings → _listenForChanges auto track touched + debounce sync DB.
   */
  set(key, value) {
    this.settings = { ...this.settings, [key]: value };
    try {
      chrome.storage.local.get(['af_settings'], (r) => {
        const merged = { ...(r.af_settings || {}), [key]: value };
        chrome.storage.local.set({ af_settings: merged });
      });
    } catch (_) { /* storage unavailable */ }
  }

  /**
   * [Phase 5 2026-05-24] Called by ConfigVersionPoller khi version mismatch.
   * Force re-fetch admin defaults (admin có thể đã tweak qua /admin/default-settings).
   */
  async _updateFromVersion(remoteVersion) {
    if (this._lastVersion === remoteVersion) return; // No-op (Polish 3 defensive)
    console.log('[StorageSettings] Version mismatch:', this._lastVersion, '→', remoteVersion);
    await this._loadServerDefaults();
    // Re-apply settings sau khi defaults updated
    this.settings = { ...this.defaults, ...this.settings };
    window.eventBus?.emit?.('default_settings:refreshed', { source: 'version_poller' });
  }

  /**
   * Bug fix 2026-05-22: detect REAL user override vs defaults persisted.
   * `_loadServerDefaults` persist toàn bộ defaults vào af_settings khi fresh install
   * → localSettings.length > 0 KHÔNG đồng nghĩa user explicitly changed.
   * Deep compare từng key: true nếu CÓ ÍT NHẤT 1 key value ≠ default.
   *
   * [Audit Bug 5 fix] Bổ sung check af_settings_touched — track keys user EXPLICIT set.
   * Case: user chọn defaultProvider='flow' (đúng default) qua Settings popup → trước fix
   * _hasUserOverride returns false → server overwrite. Sau fix: touched set có key →
   * coi là override hợp lệ.
   */
  _hasUserOverride(localSettings) {
    if (!localSettings || typeof localSettings !== 'object') return false;
    // Touched keys luôn coi là override (user explicit set, kể cả value = default).
    if (this._cachedTouchedKeys && this._cachedTouchedKeys.size > 0) return true;
    for (const key of Object.keys(localSettings)) {
      const localVal = localSettings[key];
      const defaultVal = this.defaults[key];
      if (typeof localVal === 'object' && localVal !== null) {
        if (JSON.stringify(localVal) !== JSON.stringify(defaultVal)) return true;
      } else if (localVal !== defaultVal) {
        return true;
      }
    }
    return false;
  }

  /**
   * [Bug fix 2026-06-17] Chỉ lấy các key user THẬT SỰ override (touched HOẶC value != default).
   * GỐC BUG: af_settings được _loadServerDefaults seed ĐỦ ~50 key = default. Khi local-wins,
   * spread TOÀN BỘ validLocal → giá trị DEFAULT của key user-không-đụng (vd fileNameTemplate)
   * GHI ĐÈ giá trị user thật từ server. Fix: chỉ spread đúng key override → server giữ phần còn lại.
   */
  _extractOverrides(local) {
    if (!local || typeof local !== 'object') return {};
    const out = {};
    const touched = this._cachedTouchedKeys;
    for (const key of Object.keys(local)) {
      const lv = local[key];
      const dv = this.defaults[key];
      const isTouched = !!(touched && touched.has(key));
      const differs = (typeof lv === 'object' && lv !== null)
        ? JSON.stringify(lv) !== JSON.stringify(dv)
        : lv !== dv;
      if (isTouched || differs) out[key] = lv;
    }
    return out;
  }

  /**
   * [Audit Bug 5 fix] Track user explicit set của 1 key vào af_settings_touched.
   * Gọi từ settings popup hoặc consumer khi user thao tác (vd setting toggle, ratio change).
   * KHÔNG persist Date/timestamp — chỉ Set<string> để tiết kiệm storage.
   */
  async markUserTouched(key) {
    if (!key || typeof key !== 'string') return;
    if (!this._cachedTouchedKeys) this._cachedTouchedKeys = new Set();
    this._cachedTouchedKeys.add(key);
    return new Promise(resolve => {
      chrome.storage.local.set({
        af_settings_touched: Array.from(this._cachedTouchedKeys)
      }, resolve);
    });
  }

  async _refreshTouchedCache() {
    return new Promise(resolve => {
      chrome.storage.local.get(['af_settings_touched'], res => {
        const arr = Array.isArray(res.af_settings_touched) ? res.af_settings_touched : [];
        this._cachedTouchedKeys = new Set(arr);
        resolve();
      });
    });
  }

  /**
   * Lắng nghe thay đổi settings từ settings window
   * [Audit Bug 5 fix] Tự động mark touched keys khi user explicit save từ Settings popup.
   * Skip khi đang fetch from server (tránh mark merged settings là user-touched).
   */
  _listenForChanges() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes.af_settings) return;

      // af_settings bị REMOVE (logout _clearAuth) → KHÔNG track touched / KHÔNG schedule sync
      // (tránh đẩy defaults đè user settings trên server do race). Chỉ reset in-memory.
      if (changes.af_settings.newValue == null) { this.settings = { ...this.defaults }; return; }

      const oldSettings = changes.af_settings.oldValue || {};
      const newSettings = changes.af_settings.newValue || {};

      // [Audit Bug 5 fix] Auto-track explicit user changes (skip server-driven writes).
      if (!this._fetchingFromServer) {
        const changedKeys = [];
        for (const key of Object.keys(newSettings)) {
          if (JSON.stringify(newSettings[key]) !== JSON.stringify(oldSettings[key])) {
            changedKeys.push(key);
          }
        }
        if (changedKeys.length > 0) {
          if (!this._cachedTouchedKeys) this._cachedTouchedKeys = new Set();
          for (const k of changedKeys) this._cachedTouchedKeys.add(k);
          // Persist (fire-and-forget — chỉ cần atomic save, không block flow chính).
          chrome.storage.local.set({ af_settings_touched: Array.from(this._cachedTouchedKeys) });
        }
      }

      this.settings = { ...this.defaults, ...newSettings };

      // Apply immediately
      this.applyTheme(this.settings.theme);
      this.syncExecutorSettings(this.settings);
      // Bug fix 2026-05-22: emit để GenTab re-eval provider tab khi settings popup save từ window khác.
      window.eventBus?.emit?.('storageSettings:loaded', { settings: this.settings });

      // Debounce sync to server
      this._debounceSyncToServer();
    });
  }

  /**
   * Lắng nghe auth events: login/restored → fetch & merge, logout → stop sync
   * [Audit Bug 1+3] auth:restored = cold-start session restore (AuthManager.init() khôi phục token cũ).
   * auth:logout = clear pending timer + reset settings để tránh leak sang user mới.
   */
  _listenForAuthEvents() {
    if (!window.eventBus) return;

    // Bug 3 fix: clear timer + reset state khi logout để tránh stale settings push sang user kế.
    window.eventBus.on('auth:logout', () => {
      if (this._syncTimer) {
        clearTimeout(this._syncTimer);
        this._syncTimer = null;
      }
      // Reset in-memory settings về defaults — chrome.storage.local đã được AuthManager._clearAuth wipe.
      this.settings = { ...this.defaults };
      // [Audit Bug 5] Clear touched cache + storage (touched marks là per-user).
      this._cachedTouchedKeys = new Set();
      chrome.storage.local.remove(['af_settings_touched']);
      console.log('[StorageSettings] auth:logout — cleared sync timer + reset settings to defaults');
    });

    const onAuthIn = async (eventName) => {
      try {
        this._fetchingFromServer = true;  // Prevent sync back to server
        // [Audit Bug 4 fix] Refresh owner cache trước validate — đảm bảo so với current user.id.
        await this._refreshOwnerCache();
        // Bug fix 2026-05-22: phân biệt real local override vs defaults.
        // _clearAuth() đã xóa af_settings khi logout → load lại để check thật sự có local override hay không.
        const localSettings = await new Promise(resolve => {
          chrome.storage.local.get(['af_settings'], res => resolve(res.af_settings || {}));
        });
        // [Audit Bug 4 fix] Validate owner_id — discard local nếu thuộc user khác (crash recovery scenario).
        const validLocal = this._validateLocalOwner(localSettings);
        // [Audit Bug 9 fix] Recover pending snapshot từ logout/expire trước — merge vào validLocal.
        // Chỉ recover nếu snapshot thuộc CHÍNH user đang login (so user_id).
        const pending = await this._consumePendingResync(({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.id);
        if (pending) {
          console.log(`[StorageSettings] Recovered pending settings from previous session (${Object.keys(pending).length} keys)`);
          Object.assign(validLocal, pending);
        }
        const hasRealLocal = this._hasUserOverride(validLocal);
        const serverData = await this._fetchServerSettings();
        if (serverData?.settings_json) {
          this.settings = hasRealLocal
            ? { ...this.defaults, ...serverData.settings_json, ...this._extractOverrides(validLocal) } // CHỈ override thật wins (tránh default-local đè server)
            : { ...this.defaults, ...serverData.settings_json };                  // server wins (post-logout/fresh/cold-restore)
          await this._saveLocalAndAwaitChange(this.settings);
          // Push merged settings to server để sync local changes lên (chỉ khi có real local)
          if (hasRealLocal) await this._pushToServer(this.settings);
          this.applyTheme(this.settings.theme);
          this.syncExecutorSettings(this.settings);
          console.log(`[StorageSettings] Merged settings after ${eventName} (${hasRealLocal ? 'local wins' : 'server wins'})`);
          // Emit để GenTab re-eval defaultProvider sau khi server merge (bug fix 2026-05-22)
          window.eventBus?.emit?.('storageSettings:loaded', { settings: this.settings });
        } else {
          // Server chưa có settings → push current local settings lên (chỉ valid local)
          this.settings = { ...this.defaults, ...validLocal };
          await this._saveLocalAndAwaitChange(this.settings);
          await this._pushToServer(this.settings);
          console.log(`[StorageSettings] Pushed local settings to server after ${eventName} (new user or no server row)`);
          window.eventBus?.emit?.('storageSettings:loaded', { settings: this.settings });
        }
      } catch (err) {
        console.warn(`[StorageSettings] Post-${eventName} sync failed:`, err.message);
      } finally {
        // [Audit Bug 7 fix] Reset ngay — _saveLocalAndAwaitChange đã đợi onChanged xử lý xong.
        this._fetchingFromServer = false;
      }
    };

    window.eventBus.on('auth:login', async () => onAuthIn('login'));
    // [Audit Bug 1 fix] auth:restored emit từ AuthManager.init() khi cold-start restore session.
    window.eventBus.on('auth:restored', async () => onAuthIn('restored'));
  }

  /**
   * Debounce sync to server (2s delay)
   */
  _debounceSyncToServer() {
    // LOCAL MODE: không có server → không schedule sync.
    if (StorageSettings._isLocalMode()) return;
    if (!true) return;
    // Skip sync if we just fetched from server (avoid sync loop)
    if (this._fetchingFromServer) return;

    if (this._syncTimer) clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => {
      this._pushToServer(this.settings);
    }, 2000);
  }

  /**
   * Fetch settings từ server
   * [Re-Audit Issue 4] Track _lastServerFetch timestamp để caller deduplicate khi race:
   * cold-start init.loadAndApply() + auth:restored.onAuthIn() có thể cùng gọi.
   */
  async _fetchServerSettings() {
    // LOCAL MODE: không có server → không fetch.
    if (StorageSettings._isLocalMode()) return null;
    if (!true) return null;

    const response = await ApiClient.request('GET', 'settings');
    this._lastServerFetch = Date.now();
    return response?.data || response;
  }

  /**
   * Push settings lên server
   */
  async _pushToServer(settings) {
    // LOCAL MODE: không có server → không push.
    if (StorageSettings._isLocalMode()) return;
    if (!true || this._syncing) return;

    this._syncing = true;
    try {
      await ApiClient.request('PUT', 'settings', {
        settings_json: settings
      });
      console.log('[StorageSettings] Synced to server');
    } catch (err) {
      // Verbose log: kèm validation errors detail để debug 422 (field nào reject)
      const detail = err.errors || err.data?.errors || err.response?.data?.errors || null;
      console.warn('[StorageSettings] Push to server failed:', err.message,
        detail ? { errors: detail } : '(no validation detail)');
    } finally {
      this._syncing = false;
    }
  }

  /**
   * Save settings to chrome.storage.local
   * [Audit Bug 4 fix] Stamp owner_id qua separate key af_settings_owner để validate ownership
   * khi đọc — tránh cross-user contamination khi browser crash giữa logout/login user khác.
   */
  async _saveLocal(settings) {
    const ownerId = ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.id ?? null;
    return new Promise(resolve => {
      chrome.storage.local.set({
        af_settings: settings,
        af_settings_owner: { user_id: ownerId, saved_at: Date.now() }
      }, resolve);
    });
  }

  /**
   * [Audit Bug 7 fix] Save + đợi onChanged đã propagate trước khi resolve.
   * Trước fix dùng setTimeout 500ms hardcoded → có thể race với slow MV3 service worker wake.
   * Pattern: write 1 sentinel token, đợi listener riêng confirm token nhìn thấy.
   */
  async _saveLocalAndAwaitChange(settings) {
    await this._saveLocal(settings);
    // chrome.storage.local.set callback fire SAU khi write complete + onChanged dispatched.
    // Implementation hiện tại đã chờ callback → safe. Không cần extra sentinel.
    return;
  }

  /**
   * [Audit Bug 4 fix] Validate af_settings ownership trước khi merge.
   * Trả về localSettings nếu owner match (hoặc null = anonymous → cho phép migrate sang user mới),
   * trả về {} nếu owner thuộc user khác (discard stale data).
   */
  _validateLocalOwner(localSettings) {
    if (!localSettings || Object.keys(localSettings).length === 0) return {};
    try {
      // Read owner sync (chrome.storage.local API thực tế là async, nhưng cache layer khá nhanh).
      // Implementation note: caller có thể nhận về Promise nếu cần — hiện tại dùng inline check.
      const owner = this._cachedOwner; // populated bởi _refreshOwnerCache()
      const currentUserId = ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.id ?? null;
      if (!owner) return localSettings; // chưa có stamp (legacy data) → trust
      if (owner.user_id === null) return localSettings; // anonymous data → cho user mới adopt
      // So type-tolerant (id number/string tuỳ kiểu login) → KHÔNG discard nhầm local của chính user.
      if (String(owner.user_id) === String(currentUserId)) return localSettings; // same user
      console.warn(`[StorageSettings] Discarding local settings from stale owner (was=${owner.user_id}, current=${currentUserId})`);
      return {};
    } catch (_) {
      return localSettings;
    }
  }

  async _refreshOwnerCache() {
    return new Promise(resolve => {
      chrome.storage.local.get(['af_settings_owner'], res => {
        this._cachedOwner = res.af_settings_owner || null;
        resolve();
      });
    });
  }

  /**
   * [Audit Bug 9 fix] Đọc + xóa af_settings_pending_resync (snapshot lưu bởi AuthManager._clearAuth).
   * Chỉ trả về settings nếu snapshot thuộc currentUserId (cùng user đăng nhập lại).
   * Cross-user snapshot → discard (rare nhưng safe).
   */
  async _consumePendingResync(currentUserId) {
    if (!currentUserId) return null;
    return new Promise(resolve => {
      chrome.storage.local.get(['af_settings_pending_resync'], res => {
        const pending = res.af_settings_pending_resync;
        // So type-tolerant (id có thể number/string tuỳ kiểu login OAuth vs email) → tránh discard nhầm snapshot.
        if (!pending || String(pending.user_id) !== String(currentUserId)) {
          if (pending) {
            chrome.storage.local.remove(['af_settings_pending_resync']);
          }
          resolve(null);
          return;
        }
        // TTL 24h — snapshot cũ hơn coi như stale.
        const ageMs = Date.now() - (pending.saved_at || 0);
        chrome.storage.local.remove(['af_settings_pending_resync'], () => {
          if (ageMs > 86400000) {
            console.warn('[StorageSettings] Pending resync snapshot expired (>24h), discarded');
            resolve(null);
          } else {
            resolve(pending.settings || null);
          }
        });
      });
    });
  }

  syncExecutorSettings(settings) {
    if (window.workflowExecutor) {
      // Phase 2c+: Server-Only — ExecutionConfig là single source of truth.
      // Legacy af_settings.execX đã bị backend Phase 2c strip + StorageMigration clean → bỏ Tier 2 fallback.
      const wfConfig = window.ExecutionConfig?.safeGetWorkflowConfig() || {};
      const timingConfig = window.ExecutionConfig?.safeGetTimingConfig() || {};

      window.workflowExecutor.settings = {
        delayBetweenNodes: (wfConfig.delay_nodes_sec ?? 3) * 1000,
        retryOnFail: (wfConfig.max_retries ?? 0) > 0,
        maxRetries: wfConfig.max_retries ?? 2,
        retryDelay: (timingConfig.delay_between_prompts_sec ?? 5) * 1000,
        tileTimeout: (wfConfig.timeout_sec ?? 180) * 1000,
        timeout: (wfConfig.timeout_sec ?? 180) * 1000,
        stopOnError: (wfConfig.on_error) === 'stop'
      };
    }
  }

  applyTheme(theme) {
    const root = document.getElementById('flow-auto-sidebar-root');
    if (!root) return;

    root.classList.remove('theme-light', 'theme-dark');

    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(prefersDark ? 'theme-dark' : 'theme-light');
    } else if (theme === 'light') {
      root.classList.add('theme-light');
    } else {
      root.classList.add('theme-dark');
    }
  }

}

// Auto-init cho popup windows (workflow-editor, angles-editor)
// sidebar.html sẽ ghi đè trong app.js nếu cần
if (!window.storageSettings) {
  window.storageSettings = new StorageSettings();
}

// Export
window.StorageSettings = StorageSettings;
