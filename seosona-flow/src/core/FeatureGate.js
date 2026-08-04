/**
 * FeatureGate - Quản lý quyền truy cập tính năng theo plan
 * Load entitlements từ API, cache trong memory + chrome.storage.local
 * Kiểm tra quyền: FeatureGate.canUse('workflows_enabled')
 * Kiểm tra quota: FeatureGate.checkQuota('gen_run_max')
 *
 * THAY ĐỔI MỚI: Luôn fetch GET /api/v1/entitlements cho cả anonymous và logged-in
 * - Anonymous: Server trả về trial plan entitlements (không cần token)
 * - Logged-in: Server trả về user's plan entitlements (có token)
 * - Local usage tracking cho anonymous (server không track usage cho anonymous)
 */
class FeatureGate {
  constructor() {
    this.cacheKey = 'af_entitlements';
    this.cacheTTL = 30 * 60 * 1000; // [Phase 5 2026-05-24] 30 phút — ConfigVersionPoller detect entitlements_changed (Mercure SSE realtime + /config/versions safety net)
    this._lastEntitlementsVersion = null; // [Phase 5] cached version từ response.meta.version
    this.lastFetch = 0;
    this._refreshPending = false; // Prevent concurrent refresh calls
    this._refreshPromise = null;  // Promise deduplication cho refresh()
    this._initPromise = null;     // Promise deduplication cho init()
    this._initialized = false;    // Flag đánh dấu đã init xong

    // Local usage tracking cho anonymous users (server không track)
    this._localUsageKey = 'af_local_usage';
    this._localUsage = null;

    // Pending run flags (giống TrialGate) - ghi nhận SAU khi hoàn thành, không phải trước
    this._pendingGenRun = false;
    this._pendingTaskRun = false;
    this._pendingWorkflowRun = false;
    this._pendingAnglesRun = false;

    // E3.1: SSE-driven refresh tracking
    // Khi nhận SSE entitlements_changed event, cập nhật timestamp này
    this._lastSseRefresh = 0;

    // [Fix #2] Flag đánh dấu đang trong quá trình logout.
    // Dùng để chặn SSE 'entitlements_changed' arrive muộn (sau khi user bấm logout)
    // overwrite memory + cache với data user cũ → footer hiển thị sai "free user".
    this._isLoggingOut = false;

    // Flag: đã fetch entitlements từ server thành công ít nhất 1 lần.
    // Sau khi true → KHÔNG fallback về _freeDefaults nữa (server là source of truth).
    // Tránh bug: admin disable prompt_templates_enabled cho trial plan trong DB
    // nhưng client vẫn dùng default optimistic true → không hiện overlay block.
    this._serverFetched = false;

    // Flag: cache bị skip do user_id mismatch (cache từ user khác)
    // Khi true, _doInit() sẽ AWAIT fetch từ server thay vì background fetch
    this._cacheSkippedDueToMismatch = false;

    // Giá trị mặc định (khi không fetch được từ server)
    // Convention: {module}_enabled, {module}_max, {module}_run_max
    this._freeDefaults = {
      // === Gen Module ===
      gen_enabled: { type: 'boolean', value: true },
      gen_run_max: { type: 'quota', value: -1 },

      // === ChatGPT Provider ===
      // Default FALSE - requires premium plan, server returns actual value
      chatgpt_enabled: { type: 'boolean', value: true },
      chatgpt_run_max: { type: 'quota', value: 0 },

      // === Grok Provider ===
      // Default FALSE - requires premium plan, server returns actual value
      grok_enabled: { type: 'boolean', value: true },
      grok_run_max: { type: 'quota', value: 0 },

      // === Tasks Module ===
      // CRITICAL: Default FALSE để anonymous users thấy overlay yêu cầu login
      // Server trả về giá trị đúng nếu fetch thành công
      tasks_enabled: { type: 'boolean', value: true },
      tasks_max: { type: 'quota', value: 2 },
      tasks_run_max: { type: 'quota', value: 1 },

      // === Workflows Module ===
      // CRITICAL: Default FALSE để anonymous users thấy overlay yêu cầu login
      // Server trả về giá trị đúng nếu fetch thành công
      workflows_enabled: { type: 'boolean', value: true },
      workflows_max: { type: 'quota', value: 1 },
      workflows_run_max: { type: 'quota', value: 1 },
      workflows_nodes_max: { type: 'quota', value: 5 },
      workflow_share_enabled: { type: 'boolean', value: true },
      workflow_import: { type: 'boolean', value: true },
      workflow_export: { type: 'boolean', value: true },

      // === Angles Module ===
      angles_enabled: { type: 'boolean', value: true },
      angles_run_max: { type: 'quota', value: 1 },

      // === Effects Module ===
      effects_enabled: { type: 'boolean', value: true },
      effects_run_max: { type: 'quota', value: 1 },

      // === Shared Features ===
      auto_download: { type: 'boolean', value: false },
      retry_on_fail: { type: 'boolean', value: false },
      ref_images: { type: 'boolean', value: true },
      prompt_templates_enabled: { type: 'boolean', value: true },  // Default false, server trả về giá trị đúng
      workflow_templates_enabled: { type: 'boolean', value: false },  // Default false, server trả về giá trị đúng
      history_enabled: { type: 'boolean', value: true },
      snippets_max: { type: 'quota', value: -1 },
      priority_support: { type: 'boolean', value: false },
      pipeline_queue_enabled: { type: 'boolean', value: false },

      // === GP-5.1: Global Prompt Limit ===
      // Tổng số prompt có thể submit mỗi ngày từ tất cả modules
      // CRITICAL: Default restrictive (20) cho trial/anonymous users
      // Server trả về giá trị đúng nếu fetch thành công
      prompt_submit_max: { type: 'quota', value: 20 },

      // === Batch Limit: Max prompts per multi-prompt submission ===
      // Per-submission limit, NOT daily quota
      // Default 4 for trial/anonymous users
      prompts_per_batch: { type: 'quota', value: 4 },

      // === API Rate Limit ===
      // Maximum API requests per minute based on plan
      // Default 200 for trial/anonymous users
      api_rate_limit_per_minute: { type: 'quota', value: 200 }
    };

    // Pre-apply defaults ngay để có data ĐỒNG BỘ trước khi fetch
    this.entitlements = { ...this._freeDefaults };
    this.plan = null;
  }

  /**
   * LOCAL/OFFLINE mode — mặc định true (self.SEOSONA_LOCAL_MODE !== false).
   * Khi local: mở khoá tất cả feature, quota unlimited, KHÔNG gọi server.
   */
  _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  /**
   * Khởi tạo: load cache, load local usage, fetch nếu hết hạn
   * Sử dụng Promise deduplication - nhiều callers await cùng 1 Promise
   */
  async init() {
    // Nếu đã init xong, return ngay
    if (this._initialized) return;

    // Nếu đang init, return Promise đang chạy (deduplication)
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInit();
    return this._initPromise;
  }

  async _doInit() {
    // SEOSONA Flow: No server fetch needed (offline mode)
    this._initialized = true;
    console.log('[SEOSONA Flow] FeatureGate: Initialized (offline mode, all features unlocked)');
  }




  /**
   * Force fetch entitlements từ API
   * Luôn gọi GET /api/v1/entitlements cho cả anonymous và logged-in
   * Sử dụng Promise deduplication - nhiều callers await cùng 1 Promise
   *
   * E3.1: Nếu SSE connected và đã nhận refresh gần đây (trong cacheTTL) → skip API call
   * [Phase 5 2026-05-24] Polish 3: option {force: true} bypass SSE skip (cho ConfigVersionPoller)
   *
   * @param {Object} [options]
   * @param {boolean} [options.force=false] — bypass SSE-connected skip, force fetch fresh
   */
  async refresh(options = {}) {
    // SEOSONA Flow: No-op (offline mode, all features unlocked)
    return;
  }




  /**
   * [Phase 5 2026-05-24] Called by ConfigVersionPoller khi version mismatch.
   * Polish 3: bypass SSE-connected skip + force fetch fresh.
   * @param {number} remoteVersion — version từ /config/versions endpoint
   */
  async _updateFromVersion(remoteVersion) {
    if (this._lastEntitlementsVersion === remoteVersion) return; // No-op (Polish 3 defensive)
    console.log('[SEOSONA Flow] FeatureGate: Version mismatch', this._lastEntitlementsVersion, '→', remoteVersion);
    await this.refresh({ force: true });
  }

  /**
   * [Phase 5 Polish 5] Getter cached entitlements_version.
   */
  getEntitlementsVersion() {
    return this._lastEntitlementsVersion;
  }

  /**
   * E3.1: Method để SseClient gọi khi nhận SSE entitlements_changed event
   * Cập nhật entitlements từ SSE data và đánh dấu timestamp
   */
  handleSseEntitlementsChanged(data) {
    // [Fix #2] Bỏ qua nếu đang logout hoặc đã logout rồi.
    // EventSource có thể còn event buffered trong network pipe sau khi user click logout
    // — apply sẽ overwrite _freeDefaults vừa reset → footer flash quota user cũ.
    if (this._isLoggingOut || !this.isLoggedIn()) {
      console.log('[SEOSONA Flow] FeatureGate: Bỏ qua SSE entitlements_changed (đang logout hoặc đã logout)');
      return;
    }

    if (data?.features) {
      // Merge với defaults để các feature không có trong response vẫn có giá trị
      this.entitlements = { ...this._freeDefaults, ...data.features };
      this._serverFetched = true;
    }
    if (data?.plan) {
      this.plan = data.plan;
    }
    this._lastSseRefresh = Date.now();
    this.lastFetch = Date.now();

    // Lưu vào cache
    this._saveCache().catch(err => {
      console.warn('[SEOSONA Flow] FeatureGate: Lỗi lưu SSE data vào cache', err.message);
    });

    console.log('[SEOSONA Flow] FeatureGate: Updated from SSE push, plan:', this.plan?.slug || 'trial');

    // Emit event để UI cập nhật
    if (window.eventBus) {
      window.eventBus.emit('featuregate:refreshed', {
        plan: this.plan,
        entitlements: this.entitlements,
        source: 'sse'
      });
    }
  }

  async _doRefresh() {
    try {
      await this._fetchEntitlements();
    } catch (err) {
      console.error('[SEOSONA Flow] FeatureGate: Lỗi fetch entitlements', err.message);
      // Defaults đã được apply trong constructor, giữ nguyên
    } finally {
      this._refreshPending = false;
      this._refreshPromise = null;
    }
  }

  async refreshAsync() {
    return this.refresh();
  }

  /**
   * Reset FeatureGate khi user logout
   * Clear memory cache và force fetch trial entitlements từ server
   * CRITICAL: Phải gọi method này khi logout để UI hiển thị đúng
   */
  async resetForLogout() {
    console.log('[SEOSONA Flow] FeatureGate: Reset for logout...');

    // [Fix #2] Set flag TRƯỚC khi làm bất cứ việc gì để chặn SSE
    // 'entitlements_changed' arrive giữa chừng overwrite state vừa reset.
    // [Fix drift] Nếu caller (logout()) đã set flag trước → giữ nguyên.
    // Clear flag CŨNG BỊ DI CHUYỂN XUỐNG caller (AuthManager.logout finally block)
    // để flag giữ suốt cả logout() bao gồm _clearAuth(), tránh polling drift.
    const wasFlagExternallySet = this._isLoggingOut;
    this._isLoggingOut = true;

    // 1. CRITICAL: Chờ existing refresh hoàn thành (nếu có)
    // Tránh race condition với background refresh
    if (this._refreshPromise) {
      console.log('[SEOSONA Flow] FeatureGate: Chờ existing refresh hoàn thành trước logout...');
      try {
        await this._refreshPromise;
      } catch (e) {
        // Ignore error từ old refresh
      }
    }

    // 2. Reset memory cache về defaults
    this.entitlements = { ...this._freeDefaults };
    this.plan = null;
    this._cachedEntitlements = null;

    // 3. CRITICAL: Reset lastFetch = 0 TRƯỚC khi fetch
    // Điều này invalidate cache ngay lập tức, force TẤT CẢ concurrent calls
    // phải chờ fetch mới thay vì return cached user data
    this.lastFetch = 0;

    // 4. Reset SSE timestamp để không skip API call
    this._lastSseRefresh = 0;

    // 5. Reset init state để cho phép re-init
    this._initialized = false;
    this._initPromise = null;
    this._refreshPending = false;

    // 6. Reset _serverFetched — buộc dùng _freeDefaults tạm cho đến khi fetch lại
    this._serverFetched = false;

    // 6. Emit event để UI biết cần refresh (dùng defaults tạm)
    if (window.eventBus) {
      window.eventBus.emit('featuregate:refreshed', {
        plan: null,
        entitlements: this.entitlements
      });
    }

    // 7. CRITICAL: Wrap fetch trong _refreshPromise để concurrent calls có thể await
    this._refreshPromise = (async () => {
      try {
        await this._fetchEntitlements();
        console.log('[SEOSONA Flow] FeatureGate: Đã fetch trial entitlements sau logout');
      } catch (err) {
        console.warn('[SEOSONA Flow] FeatureGate: Lỗi fetch trial entitlements, dùng defaults', err.message);
        throw err;
      }
    })();

    try {
      await this._refreshPromise;
    } catch (e) {
      // Đã log ở trên, tiếp tục với defaults
    } finally {
      // 8. Clear promise sau khi xong
      this._refreshPromise = null;
    }

    // 9. Đánh dấu đã init lại
    this._initialized = true;

    // [Fix drift] CHỈ clear flag nếu ta là người set nó.
    // Nếu caller (AuthManager.logout) set trước → caller chịu trách nhiệm clear
    // để giữ flag suốt cả _clearAuth() — tránh race với polling drift detection.
    if (!wasFlagExternallySet) {
      this._isLoggingOut = false;
    }
  }

  /**
   * Reset FeatureGate khi user login
   * CRITICAL: Phải CHỜ existing refresh hoàn thành trước để tránh race condition
   * Sau đó force fetch user's plan entitlements từ server
   * CRITICAL: Phải gọi method này khi login để nhận đúng entitlements của user's plan
   */
  async resetForLogin() {
    console.log('[SEOSONA Flow] FeatureGate: Reset for login...');

    // 1. CRITICAL: Chờ existing refresh hoàn thành (nếu có)
    // Nếu có background refresh đang chạy (từ init), nó đang fetch trial data
    // PHẢI chờ nó xong để tránh race condition:
    // - resetForLogin fetch user data, save cache
    // - init refresh hoàn thành SAU, save trial data → override user data!
    if (this._refreshPromise) {
      console.log('[SEOSONA Flow] FeatureGate: Chờ existing refresh hoàn thành trước...');
      try {
        await this._refreshPromise;
      } catch (e) {
        // Ignore error từ old refresh, sẽ fetch mới
      }
    }

    // 2. Clear pending flags (bây giờ safe vì existing refresh đã xong)
    this._refreshPending = false;

    // 3. Reset SSE timestamp để không skip API call
    this._lastSseRefresh = 0;

    // 4. CRITICAL: Reset lastFetch = 0 TRƯỚC khi fetch
    // Điều này invalidate cache ngay lập tức, force TẤT CẢ concurrent calls
    // (như refreshModuleOverlays → isModuleEnabledAsync) phải chờ fetch mới
    // thay vì return cached trial data
    this.lastFetch = 0;

    // 5. CRITICAL: Wrap fetch trong _refreshPromise để concurrent calls có thể await
    // Thay vì gọi _fetchEntitlements() trực tiếp, tạo Promise cho others await
    this._refreshPromise = (async () => {
      try {
        await this._fetchEntitlements();
        console.log('[SEOSONA Flow] FeatureGate: Đã fetch user entitlements sau login, plan:', this.plan?.slug);
      } catch (err) {
        console.warn('[SEOSONA Flow] FeatureGate: Lỗi fetch user entitlements sau login', err.message);
        throw err;
      }
    })();

    try {
      await this._refreshPromise;
    } finally {
      // 6. Clear promise sau khi xong (dù success hay fail)
      this._refreshPromise = null;
    }

    // 7. Đảm bảo marked as initialized
    this._initialized = true;
  }

  /**
   * Fetch entitlements từ server
   * - Nếu logged in: gửi kèm Authorization header (qua authManager._apiCall)
   * - Nếu anonymous: gửi request public (qua background.js, không token)
   *
   * Cả 2 đều gọi GET /api/v1/entitlements - server tự detect và trả về phù hợp
   */
  async _fetchEntitlements() {
    // LOCAL mode: không fetch server, giữ defaults (đã bị _getFeature override thành unlocked).
    if (this._isLocal()) return;
    const TIMEOUT_MS = 15000;
    try {
      const baseUrl = await window.ApiBaseConfig?.get() || 'http://localhost:8080/api/v1';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const resp = await fetch(`${baseUrl}/entitlements`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      }).finally(() => clearTimeout(timer));

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      
      const payload = json.data || json;
      const meta = json.meta || null;

      this.entitlements = { ...this._freeDefaults, ...(payload.features || {}) };
      this.plan = payload.plan || { slug: 'trial', name: 'Trial' };
      this.lastFetch = Date.now();
      this._serverFetched = true;
      if (meta && typeof meta.version !== 'undefined') {
        this._lastEntitlementsVersion = meta.version;
      }

      await this._saveCache();
      console.log('[FeatureGate] Fetched entitlements, plan:', this.plan?.slug);
    } catch (e) {
      console.warn('[FeatureGate] _fetchEntitlements failed:', e.message);
    }

    if (window.eventBus) {
      window.eventBus.emit('featuregate:refreshed', {
        plan: this.plan,
        entitlements: this.entitlements
      });
    }
  }

  // ===== Check Methods =====

  /**
   * Kiểm tra quyền sử dụng tính năng
   * Boolean features: true/false
   * Quota features: true nếu chưa hết quota (merge server limit + local usage cho anonymous)
   */
  canUse(featureKey) {
    if (!featureKey) return true;
    // LOCAL mode: mọi feature đều mở khoá.
    if (this._isLocal()) return true;
    const feature = this._getFeature(featureKey);
    
    if (feature && feature.type === 'boolean') {
      return feature.value === true;
    }
    
    // Nếu là quota feature, kiểm tra > 0
    if (feature && feature.type === 'integer') {
      if (feature.value === 'unlimited' || feature.value === -1 || feature.value === '-1') return true;
      const limit = typeof feature.value === 'string' ? parseInt(feature.value, 10) : feature.value;
      if (limit > 0) {
        const usage = this._getUsageForFeature(featureKey, feature);
        return usage < limit;
      }
      return false;
    }
    
    return false;
  }

  /**
   * Kiểm tra chi tiết quota
   * @returns {{ allowed: boolean, used: number, limit: number|string }}
   */
  checkQuota(featureKey) {
    // LOCAL mode: quota unlimited, luôn allowed.
    if (this._isLocal()) {
      return { allowed: true, used: 0, limit: 'unlimited' };
    }
    const feature = this._getFeature(featureKey);
    if (!feature) {
      return { allowed: false, used: 0, limit: 0 };
    }
    if (feature.value === 'unlimited' || feature.value === -1 || feature.value === '-1') {
      return { allowed: true, used: 0, limit: 'unlimited' };
    }
    const limit = typeof feature.value === 'string' ? parseInt(feature.value, 10) : feature.value;
    const used = this._getUsageForFeature(featureKey, feature);
    return {
      allowed: used < limit,
      used,
      limit
    };
  }


  /**
   * Async version - đảm bảo data mới nhất trước khi check
   * Dùng cho critical actions (tạo task, chạy workflow, etc.)
   */
  async canUseAsync(featureKey) {
    if (!this._isCacheValid()) {
      await this.refresh();
    }
    return this.canUse(featureKey);
  }

  /**
   * AI Agent rename (2026-05-30) — Convenience helper cho extension v1.1.6+.
   *
   * Backend Migration B đảm bảo cả 2 keys (ai_agent_enabled + prompt_enhancer_enabled)
   * có cùng value (PlanController mirror khi admin update). Extension v1.1.6 chỉ check key mới.
   * Backward compat v1.1.3 client là backend responsibility (BulkSave accept both fields,
   * Node observer mirror enhance↔use_ai, Migration B clone features).
   *
   * Caller: WorkflowExecutor._executePromptNode, WorkflowEditor render toggle,
   *         WorkflowList/WorkflowTemplateList check trước run.
   *
   * @returns {boolean} true nếu user có quyền dùng AI Agent qua ChatGPT/Gemini
   */
  canUseAiAgent() {
    return this.canUse('ai_agent_enabled');
  }

  /**
   * Async version - đảm bảo data mới nhất trước khi check quota
   */
  async checkQuotaAsync(featureKey) {
    if (!this._isCacheValid()) {
      await this.refresh();
    }
    return this.checkQuota(featureKey);
  }

  // ===== Usage Tracking =====

  /**
   * Lấy usage cho feature
   * - Logged-in: dùng server usage (feature.usage_today)
   * - Anonymous: dùng local usage (chrome.storage.local)
   */
  _getUsageForFeature(featureKey, feature) {
    if (this.isLoggedIn()) {
      // Logged-in: server đã track usage
      return feature.usage_today || 0;
    }

    // Anonymous: dùng local usage
    return this._getLocalUsage(featureKey);
  }

  /**
   * Lấy local usage cho feature key (anonymous users)
   */
  _getLocalUsage(featureKey) {
    if (!this._localUsage) {
      this._localUsage = {};
    }
    this._resetLocalUsageIfNewDay();
    return this._localUsage[featureKey] || 0;
  }

  /**
   * Ghi nhận sử dụng tính năng
   * - Logged-in: POST usage/track + cập nhật cache local
   * - Anonymous: chỉ cập nhật local usage
   */
  async trackUsage(featureKey, action, quantity = 1) {
    // LOCAL mode: no-op — không track quota, không POST server.
    if (this._isLocal()) return;
    try {
      if (this.isLoggedIn()) {
        // Logged-in: cập nhật cache local trước
        if (this.entitlements && this.entitlements[featureKey]) {
          const feature = this.entitlements[featureKey];
          if (feature.type === 'quota') {
            feature.usage_today = (feature.usage_today || 0) + quantity;
          }
          await this._saveCache();
        }

        // Gửi lên server
        await ApiClient.request('POST', 'usage/track', {
          feature_key: featureKey,
          action,
          quantity
        });
        console.log('[SEOSONA Flow] FeatureGate: Đã ghi nhận sử dụng (server)', featureKey, '+' + quantity);
      } else {
        // Anonymous: chỉ cập nhật local usage
        await this._incrementLocalUsage(featureKey, quantity);
        console.log('[SEOSONA Flow] FeatureGate: Đã ghi nhận sử dụng (local)', featureKey, '+' + quantity);
      }
    } catch (err) {
      console.warn('[SEOSONA Flow] FeatureGate: Lỗi ghi nhận sử dụng', featureKey, err.message);
    }
  }

  /**
   * Tăng local usage cho feature (anonymous users)
   */
  _resetLocalUsageIfNewDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (this._localUsage && this._localUsage._usage_date && this._localUsage._usage_date !== today) {
      const oldDate = this._localUsage._usage_date;
      this._localUsage = { _usage_date: today };
      this._saveLocalUsage();
      console.log('[FeatureGate] Local usage reset: ngày cũ', oldDate, '→ ngày mới', today);
    }
    if (this._localUsage && !this._localUsage._usage_date) {
      this._localUsage._usage_date = today;
      this._saveLocalUsage();
    }
  }

  async _incrementLocalUsage(featureKey, quantity = 1) {
    if (!this._localUsage) {
      this._localUsage = {};
    }
    this._resetLocalUsageIfNewDay();
    this._localUsage[featureKey] = (this._localUsage[featureKey] || 0) + quantity;
    await this._saveLocalUsage();

    // Emit event để UI cập nhật
    if (window.eventBus) {
      window.eventBus.emit('featuregate:usage_changed', {
        featureKey,
        usage: this._localUsage[featureKey]
      });
    }
  }

  /**
   * Increment daily stat counter (for settings-popup display)
   * This tracks all usage locally regardless of plan for statistics display
   * Uses promise chain to serialize writes and avoid race conditions
   */
  async _incrementDailyStat(key, amount = 1) {
    FeatureGate._statQueue = (FeatureGate._statQueue || Promise.resolve()).then(async () => {
      const today = new Date().toISOString().slice(0, 10);
      const currentUserId = ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.id || null;
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['af_daily_stats'], r => resolve(r));
      });
      const stats = result.af_daily_stats || {};
      // Reset if new day OR different user
      if (stats._date !== today || stats._user_id !== currentUserId) {
        stats._date = today;
        stats._user_id = currentUserId;
        // Provider-specific prompts
        stats.flow_prompt_total = 0;
        stats.chatgpt_prompt_total = 0;
        stats.gemini_prompt_total = 0;
        stats.grok_prompt_total = 0;
        // Provider-specific failures
        stats.flow_fail = 0;
        stats.chatgpt_fail = 0;
        stats.gemini_fail = 0;
        stats.grok_fail = 0;
        // Common stats
        stats.task_run = 0;
        stats.workflow_run = 0;
        stats.angles_run = 0;
      }
      stats[key] = (stats[key] || 0) + amount;
      await new Promise(resolve => {
        chrome.storage.local.set({ af_daily_stats: stats }, resolve);
      });
    }).catch(err => {
      console.warn('[FeatureGate] _incrementDailyStat error:', err);
    });
  }

  // ===== Plan Info =====

  /**
   * Lấy thông tin plan hiện tại
   */
  getPlan() {
    return this.plan;
  }

  /**
   * Kiểm tra có phải plan miễn phí không
   */
  isFreePlan() {
    return this.plan?.slug === 'free' || this.plan?.slug === 'trial' || !this.plan;
  }

  /**
   * Kiểm tra user đã đăng nhập chưa
   */
  isLoggedIn() {
    return true || false;
  }

  /**
   * Kiểm tra user có quyền quản lý workflow templates không
   * Delegate sang AuthManager.canManageTemplates() để đảm bảo logic nhất quán
   * @returns {boolean}
   */
  canManageWorkflowTemplates() {
    // LOCAL mode: single-user, cho phép quản lý templates.
    if (this._isLocal()) return true;
    return window.authManager?.canManageTemplates() || false;
  }

  /**
   * EWT-12.2: Kiểm tra user có quyền truy cập premium templates không
   * - Admin: luôn có quyền
   * - User có entitlement premium_templates: có quyền
   * - User free / anonymous: không có quyền
   * @returns {boolean}
   */
  canAccessPremiumTemplates() {
    // LOCAL mode: mở khoá tất cả template premium.
    if (this._isLocal()) return true;
    // Admin luôn có quyền truy cập tất cả
    if (this.isAdmin()) {
      return true;
    }

    // Kiểm tra entitlement premium_templates (nhất quán với backend)
    if (this.canUse('premium_templates')) {
      return true;
    }

    return false;
  }

  /**
   * EWT-12.2: Kiểm tra user có phải admin không
   * @returns {boolean}
   */
  isAdmin() {
    // LOCAL mode: single-user chạy full quyền.
    if (this._isLocal()) return true;
    return true || false;
  }

  /**
   * EWT-12.2: Kiểm tra user có premium plan không
   * Premium plans: pro, premium, business, enterprise (không phải free hoặc trial)
   * @returns {boolean}
   */
  isPremium() {
    // LOCAL mode: coi như premium (mở khoá tất cả).
    if (this._isLocal()) return true;
    if (!this.isLoggedIn()) {
      return false;
    }

    const planSlug = this.plan?.slug?.toLowerCase();
    // Các plan không phải premium
    const nonPremiumPlans = ['free', 'trial', null, undefined, ''];

    return !nonPremiumPlans.includes(planSlug);
  }

  // ===== TrialGate Compatibility Layer =====
  // Các methods này tương thích ngược với TrialGate API cũ

  /**
   * Lấy config trial (tương thích TrialGate.getConfig())
   */
  getConfig() {
    const tasks = this._getFeature('tasks_max');
    const workflows = this._getFeature('workflows_max');
    const workflowNodes = this._getFeature('workflows_nodes_max');
    const tasksRun = this._getFeature('tasks_run_max');
    const workflowsRun = this._getFeature('workflows_run_max');
    const anglesRun = this._getFeature('angles_run_max');

    return {
      trial_enabled: !this.isLoggedIn(),
      tasks_max_create: tasks?.value ?? 10,
      tasks_max_run: tasksRun?.value ?? 1,
      workflows_max_create: workflows?.value ?? 1,
      workflows_max_node: workflowNodes?.value ?? 5,
      workflows_max_run: workflowsRun?.value ?? 1,
      angles_max_run: anglesRun?.value ?? 1
    };
  }

  /**
   * Lấy trạng thái trial (tương thích TrialGate.getTrialStatus())
   */
  getTrialStatus() {
    const config = this.getConfig();
    const usage = this._getUsage();

    return {
      isLoggedIn: this.isLoggedIn(),
      trialEnabled: config.trial_enabled,
      tasks: {
        created: usage.tasks_created,
        maxCreate: config.tasks_max_create,
        run: usage.tasks_run,
        maxRun: config.tasks_max_run
      },
      workflows: {
        created: usage.workflows_created,
        maxCreate: config.workflows_max_create,
        run: usage.workflows_run,
        maxRun: config.workflows_max_run,
        maxNode: config.workflows_max_node
      },
      angles: {
        run: usage.angles_run,
        maxRun: config.angles_max_run
      }
    };
  }

  /**
   * Lấy usage từ entitlements (logged-in) hoặc local storage (anonymous)
   */
  _getUsage() {
    if (this.isLoggedIn()) {
      return {
        tasks_created: this.entitlements?.tasks_max?.usage_today || 0,
        tasks_run: this.entitlements?.tasks_run_max?.usage_today || 0,
        workflows_created: this.entitlements?.workflows_max?.usage_today || 0,
        workflows_run: this.entitlements?.workflows_run_max?.usage_today || 0,
        angles_run: this.entitlements?.angles_run_max?.usage_today || 0
      };
    }

    // Anonymous: lấy từ local usage
    return {
      tasks_created: this._getLocalUsage('tasks_max'),
      tasks_run: this._getLocalUsage('tasks_run_max'),
      workflows_created: this._getLocalUsage('workflows_max'),
      workflows_run: this._getLocalUsage('workflows_run_max'),
      angles_run: this._getLocalUsage('angles_run_max')
    };
  }

  // ===== Task Methods =====

  /**
   * Kiểm tra có thể tạo task không (async, đếm từ storage)
   * Check quota cho cả logged-in và anonymous users
   */
  async canCreateTaskAsync() {
    // LOCAL mode: cho phép tạo không giới hạn (không yêu cầu login).
    if (this._isLocal()) return true;
    // [Option C] Task creation requires login - local storage chỉ là fallback sync
    // Anonymous users không được tạo task locally để tránh bypass quota
    if (!this.isLoggedIn()) {
      console.log('[FeatureGate] canCreateTaskAsync: false (requires login)');
      return false;
    }

    await this.refresh();

    // Check nếu unlimited (-1)
    const feature = this._getFeature('tasks_max');
    if (feature?.value === '-1' || feature?.value === -1) {
      return true;
    }

    // Đếm số task hiện tại từ SERVER (không đếm local)
    // Server là source of truth cho quota
    let currentCount = 0;
    try {
      if (window.storageManager?.mode === 'api') {
        const result = await window.storageManager.getTasks();
        currentCount = result?.meta?.total || result?.length || 0;
      }
    } catch (e) {
      console.warn('[FeatureGate] Error counting tasks from server:', e);
      // Nếu không lấy được count từ server, cho phép tạo
      // Server sẽ validate lại khi save
      return true;
    }

    const config = this.getConfig();
    const result = currentCount < config.tasks_max_create;
    console.log('[FeatureGate] canCreateTaskAsync:', currentCount, '<', config.tasks_max_create, '=', result);
    return result;
  }

  /**
   * Kiểm tra có thể chạy task không (async)
   * Check quota cho cả logged-in và anonymous users
   */
  async canRunTaskAsync() {
    await this.refresh();

    // Check nếu unlimited (-1)
    const feature = this._getFeature('tasks_run_max');
    if (feature?.value === '-1' || feature?.value === -1) {
      return true;
    }

    const usage = this._getUsage();
    const config = this.getConfig();
    const result = usage.tasks_run < config.tasks_max_run;
    console.log('[FeatureGate] canRunTaskAsync:', usage.tasks_run, '<', config.tasks_max_run, '=', result);
    return result;
  }

  /**
   * Ghi nhận đã tạo task
   */
  async recordTaskCreated() {
    await this.trackUsage('tasks_max', 'create');
  }

  /**
   * Ghi nhận đã chạy task.
   * Server đã trừ quota qua ExecutionService (optimistic deduction).
   * Chỉ cần refresh để lấy remaining chính xác.
   * Anonymous: vẫn track local vì server không lưu.
   */
  async recordTaskRun() {
    // Track daily stats for settings-popup display (all users)
    await this._incrementDailyStat('task_run');

    if (this.isLoggedIn()) {
      await this.refresh();
    } else {
      await this.trackUsage('tasks_run_max', 'run');
    }
  }

  // ===== Workflow Methods =====

  /**
   * Kiểm tra có thể tạo workflow không (async)
   * [Option C] Workflow creation requires login - local storage chỉ là fallback sync
   */
  async canCreateWorkflowAsync() {
    // LOCAL mode: cho phép tạo không giới hạn (không yêu cầu login).
    if (this._isLocal()) return true;
    // Anonymous users không được tạo workflow locally để tránh bypass quota
    if (!this.isLoggedIn()) {
      console.log('[FeatureGate] canCreateWorkflowAsync: false (requires login)');
      return false;
    }

    await this.refresh();

    // Check nếu unlimited (-1)
    const feature = this._getFeature('workflows_max');
    if (feature?.value === '-1' || feature?.value === -1) {
      return true;
    }

    // Đếm số workflow hiện tại từ SERVER (không đếm local)
    // Server là source of truth cho quota
    let currentCount = 0;
    try {
      if (window.storageManager?.mode === 'api') {
        const result = await window.storageManager.getWorkflows();
        currentCount = result?.meta?.total || result?.length || 0;
      }
    } catch (e) {
      console.warn('[FeatureGate] Error counting workflows from server:', e);
      // Nếu không lấy được count từ server, cho phép tạo
      // Server sẽ validate lại khi save
      return true;
    }

    const config = this.getConfig();
    const result = currentCount < config.workflows_max_create;
    console.log('[FeatureGate] canCreateWorkflowAsync:', currentCount, '<', config.workflows_max_create, '=', result);
    return result;
  }

  /**
   * Kiểm tra có thể chạy workflow không (async)
   * Check quota cho cả logged-in và anonymous users
   */
  async canRunWorkflowAsync() {
    await this.refresh();

    // Check nếu unlimited (-1)
    const feature = this._getFeature('workflows_run_max');
    if (feature?.value === '-1' || feature?.value === -1) {
      return true;
    }

    const usage = this._getUsage();
    const config = this.getConfig();
    const result = usage.workflows_run < config.workflows_max_run;
    console.log('[FeatureGate] canRunWorkflowAsync:', usage.workflows_run, '<', config.workflows_max_run, '=', result);
    return result;
  }

  /**
   * Kiểm tra có thể thêm node không (sync, dựa trên số node hiện tại)
   * Check quota cho cả logged-in và anonymous users
   */
  canAddNode(currentCount) {
    // Check nếu unlimited (-1)
    const feature = this._getFeature('workflows_nodes_max');
    if (feature?.value === '-1' || feature?.value === -1) {
      return true;
    }

    const config = this.getConfig();
    return currentCount < config.workflows_max_node;
  }

  /**
   * Ghi nhận đã tạo workflow
   */
  async recordWorkflowCreated() {
    await this.trackUsage('workflows_max', 'create');
  }

  /**
   * Ghi nhận đã chạy workflow.
   * Server đã trừ quota qua ExecutionService.
   * Chỉ cần refresh để lấy remaining chính xác.
   */
  async recordWorkflowRun() {
    // Track daily stats for settings-popup display (all users)
    await this._incrementDailyStat('workflow_run');

    if (this.isLoggedIn()) {
      await this.refresh();
    } else {
      await this.trackUsage('workflows_run_max', 'run');
    }
  }

  // ===== Angles Methods =====

  /**
   * Kiểm tra có thể chạy angles không (async)
   * Check quota cho cả logged-in và anonymous users
   */
  async canRunAnglesAsync() {
    await this.refresh();

    // Check nếu unlimited (-1)
    const feature = this._getFeature('angles_run_max');
    if (feature?.value === '-1' || feature?.value === -1) {
      return true;
    }

    const usage = this._getUsage();
    const config = this.getConfig();
    const result = usage.angles_run < config.angles_max_run;
    console.log('[FeatureGate] canRunAnglesAsync:', usage.angles_run, '<', config.angles_max_run, '=', result);
    return result;
  }

  /**
   * Ghi nhận đã chạy angles.
   * Server đã trừ quota qua ExecutionService.
   * Chỉ cần refresh để lấy remaining chính xác.
   */
  async recordAnglesRun() {
    // Track daily stats for settings-popup display (all users)
    await this._incrementDailyStat('angles_run');

    if (this.isLoggedIn()) {
      await this.refresh();
    } else {
      await this.trackUsage('angles_run_max', 'run');
    }
  }

  // ===== Gen Methods =====

  /**
   * Kiểm tra có thể chạy generate không (async)
   * Check quota gen_run_max
   */
  async canRunGenAsync() {
    await this.refresh();

    // Check nếu unlimited (-1)
    const feature = this._getFeature('gen_run_max');
    if (feature?.value === '-1' || feature?.value === -1) {
      return true;
    }

    const usage = this._getUsageForFeature('gen_run_max', feature);
    const limit = typeof feature.value === 'string' ? parseInt(feature.value, 10) : feature.value;
    const result = usage < limit;
    console.log('[FeatureGate] canRunGenAsync:', usage, '<', limit, '=', result);
    return result;
  }

  /**
   * Ghi nhận đã chạy generate.
   * Server đã trừ quota qua ExecutionService.
   * Chỉ cần refresh để lấy remaining chính xác.
   */
  async recordGenRun() {
    // Track daily stats for settings-popup display (all users)
    await this._incrementDailyStat('gen_run');

    if (this.isLoggedIn()) {
      await this.refresh();
    } else {
      await this.trackUsage('gen_run_max', 'run');
    }
  }

  /**
   * Record ChatGPT provider run (sau khi ExecutionGate.complete).
   * Server đã trừ quota qua ExecutionService.
   */
  async recordChatGPTRun(promptCount = 1) {
    await this._incrementDailyStat('chatgpt_run', promptCount);

    if (this.isLoggedIn()) {
      await this.refresh();
    } else {
      await this.trackUsage('chatgpt_run_max', 'run', promptCount);
    }
  }

  /**
   * Record Grok provider run (sau khi ExecutionGate.complete).
   * Server đã trừ quota qua ExecutionService.
   */
  async recordGrokRun(promptCount = 1) {
    await this._incrementDailyStat('grok_run', promptCount);

    if (this.isLoggedIn()) {
      await this.refresh();
    } else {
      await this.trackUsage('grok_run_max', 'run', promptCount);
    }
  }

  /**
   * Record global prompt submission (prompt_submit_max).
   * Gọi sau khi submit thành công bất kỳ provider nào.
   * @param {number} promptCount - Số prompts đã submit
   * @param {string} provider - 'flow'|'chatgpt'|'grok' (for logging)
   */
  async recordPromptSubmit(promptCount = 1, provider = 'flow') {
    console.log('[FeatureGate] recordPromptSubmit:', promptCount, 'prompts from', provider);
    await this._incrementDailyStat('prompt_submit', promptCount);

    if (this.isLoggedIn()) {
      // Server đã track qua ExecutionService, chỉ cần refresh
      await this.refresh();
    } else {
      // Anonymous: track local
      await this.trackUsage('prompt_submit_max', 'submit', promptCount);
    }
  }

  // ===== Rate Limit =====

  /**
   * Lấy API rate limit per minute cho user hiện tại.
   * Cached trong entitlements, không query DB mỗi request.
   *
   * @returns {number} Rate limit per minute (default 200 for trial)
   */
  getRateLimit() {
    const feature = this._getFeature('api_rate_limit_per_minute');
    if (!feature || !feature.value) {
      return 200; // Default trial limit
    }
    const limit = typeof feature.value === 'string' ? parseInt(feature.value, 10) : feature.value;
    return isNaN(limit) ? 200 : limit;
  }

  /**
   * Async version - đảm bảo entitlements đã được fetch trước khi lấy rate limit
   * @returns {Promise<number>}
   */
  async getRateLimitAsync() {
    await this.refresh();
    return this.getRateLimit();
  }

  /**
   * Lấy giới hạn số prompt trong 1 batch (multi-prompt).
   * Đây là per-submission limit, không phải daily quota.
   *
   * @returns {number} Max prompts per batch (-1 = unlimited, default 4 for trial)
   */
  getPromptBatchLimit() {
    // [FIX 2026-07-09] Local mode = không giới hạn. Thiếu guard này → trả 4 → "Run All" chặn oan
    // task đa-prompt >4. (canUse/checkQuota đã có _isLocal nhưng nhóm global-quota bị sót.)
    if (this._isLocal && this._isLocal()) return -1;
    const feature = this._getFeature('prompts_per_batch');
    if (!feature || !feature.value) {
      return 4; // Default trial limit
    }
    const limit = typeof feature.value === 'string' ? parseInt(feature.value, 10) : feature.value;
    if (isNaN(limit)) return 4;
    return limit; // -1 = unlimited, else positive number
  }

  /**
   * Kiểm tra số prompt có vượt quá batch limit không.
   *
   * @param {number} promptCount - Số prompt trong batch
   * @returns {{ allowed: boolean, limit: number }} - allowed=true nếu OK, limit=-1 là unlimited
   */
  checkPromptBatchLimit(promptCount) {
    const limit = this.getPromptBatchLimit();
    if (limit === -1) {
      return { allowed: true, limit: -1 };
    }
    return {
      allowed: promptCount <= limit,
      limit
    };
  }

  // ===== Shared Feature Methods =====

  /**
   * Kiểm tra có thể tạo snippet không (async)
   * Check quota snippets_max
   */
  async canCreateSnippetAsync() {
    await this.refresh();

    const feature = this._getFeature('snippets_max');
    if (feature?.value === '-1' || feature?.value === -1) {
      return true;
    }

    // Đếm số snippet hiện tại
    let currentCount = 0;
    if (this.isLoggedIn()) {
      // Logged-in: dùng usage từ server (usage_today = actual count từ DB)
      currentCount = feature?.usage_today || feature?.used_today || 0;
    } else {
      // Anonymous: đếm từ local storage
      try {
        const stored = await this._storageGet('af_user_prompts');
        currentCount = Array.isArray(stored) ? stored.length : 0;
      } catch (e) {
        console.warn('[FeatureGate] Error counting snippets:', e);
      }
    }

    const limit = typeof feature?.value === 'string' ? parseInt(feature.value, 10) : (feature?.value || 0);
    const result = currentCount < limit;
    console.log('[FeatureGate] canCreateSnippetAsync:', currentCount, '<', limit, '=', result);
    return result;
  }

  /**
   * Kiểm tra có thể dùng ref images không
   */
  canUseRefImages() {
    return this.canUse('ref_images');
  }

  /**
   * Kiểm tra có thể dùng auto download không
   */
  canUseAutoDownload() {
    return this.canUse('auto_download');
  }

  /**
   * Kiểm tra có thể dùng retry on fail không
   */
  canUseRetryOnFail() {
    return this.canUse('retry_on_fail');
  }

  /**
   * Kiểm tra có thể xem prompt templates không
   */
  canUsePromptTemplates() {
    return this.canUse('prompt_templates_enabled');
  }

  /**
   * Kiểm tra có thể xem history không
   */
  canUseHistory() {
    return this.canUse('history_enabled');
  }

  // ===== Crown / Lock Label Helpers =====

  /**
   * Kiểm tra free plan có quyền dùng feature không.
   * Đọc từ window._cachedPlans (đã fetch qua fetchPlans() → /api/v1/plans).
   * Backend response shape: features là ARRAY [{key, type, value}], KHÔNG phải object map.
   * @returns {boolean|null} true=free có, false=free không, null=chưa biết (cache chưa load)
   */
  canFreePlanUse(featureKey) {
    if (!featureKey) return null;
    const plans = window._cachedPlans;
    if (!Array.isArray(plans) || plans.length === 0) return null;
    const free = plans.find(p => p?.slug === 'free');
    if (!free || !Array.isArray(free.features)) return null;
    const f = free.features.find(x => x?.key === featureKey);
    if (!f) return false;
    const v = f.value;
    if (f.type === 'boolean') {
      return v === true || v === '1' || v === 1;
    }
    if (f.type === 'quota') {
      if (v === 'unlimited' || v === -1 || v === '-1') return true;
      const limit = typeof v === 'string' ? parseInt(v, 10) : v;
      return Number.isFinite(limit) && limit > 0;
    }
    // Fallback string truthy check
    return v !== null && v !== undefined && v !== '0' && v !== 0 && v !== false && v !== '';
  }

  /**
   * Trả label cho crown badge hiển thị bên cạnh feature gated.
   * - Anonymous + free plan có quyền → "Yêu cầu login"
   * - Else (free không có / logged-in không có) → "Premium"
   *
   * @param {string} featureKey — feature key check, vd 'auto_download'
   * @returns {string} localized label
   */
  getCrownLabel(featureKey) {
    const isLoggedIn = this.isLoggedIn();
    if (!isLoggedIn) {
      // Anonymous user: nếu free plan có quyền → khuyến khích login
      const freeHas = featureKey ? this.canFreePlanUse(featureKey) : null;
      if (freeHas === true) {
        return window.I18n?.t('common.requireLogin') || 'Yêu cầu login';
      }
    }
    return window.I18n?.t('common.premium') || 'Premium';
  }

  /**
   * Render inner HTML (SVG icon + label) — dùng cho innerHTML của <span class="premium-crown">.
   * @param {string} featureKey
   * @returns {string} '<svg ...></svg> Label'
   */
  renderCrownHTML(featureKey) {
    const label = this.getCrownLabel(featureKey);
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"></path></svg> ' + label;
  }

  /**
   * Render full <span class="premium-crown"> bao gồm title tooltip — dùng cho template literal
   * inline HTML. Title attr fallback cho trường hợp text bị truncate / ẩn ở narrow context.
   * @param {string} featureKey
   * @returns {string} '<span class="premium-crown" title="...">...</span>'
   */
  renderCrownSpan(featureKey) {
    const label = this.getCrownLabel(featureKey);
    const titleAttr = String(label).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<span class="premium-crown" title="${titleAttr}">${this.renderCrownHTML(featureKey)}</span>`;
  }

  // ===== GP-5: Global Prompt Quota Methods =====

  /**
   * GP-5.2: Kiểm tra có đủ global quota để submit prompts không
   * @param {number} count - Số prompt cần submit
   * @returns {boolean} true nếu còn đủ quota
   */
  canSubmitPrompts(count = 1) {
    const feature = this._getFeature('prompt_submit_max');
    if (!feature) return true;

    if (feature.value === 'unlimited' || feature.value === -1 || feature.value === '-1') {
      return true;
    }

    const limit = typeof feature.value === 'string' ? parseInt(feature.value, 10) : feature.value;
    const usage = this._getUsageForFeature('prompt_submit_max', feature);
    return (usage + count) <= limit;
  }

  /**
   * GP-5.2 async: Đảm bảo data mới nhất trước khi check
   * @param {number} count - Số prompt cần submit
   * @returns {Promise<boolean>}
   */
  async canSubmitPromptsAsync(count = 1) {
    if (!this._isCacheValid()) {
      await this.refresh();
    }
    return this.canSubmitPrompts(count);
  }

  /**
   * GP-5.3: Lấy số global prompt còn lại
   * @returns {number|string} Số remaining, 'unlimited', hoặc 0 nếu không có feature
   */
  getGlobalRemaining() {
    if (this._isLocal && this._isLocal()) return 'unlimited'; // [FIX 2026-07-09] local = unlimited
    const feature = this._getFeature('prompt_submit_max');
    if (!feature) return 'unlimited';

    // Unlimited quota
    if (feature.value === 'unlimited' || feature.value === -1 || feature.value === '-1') {
      return 'unlimited';
    }

    const limit = typeof feature.value === 'string' ? parseInt(feature.value, 10) : feature.value;
    const usage = this._getUsageForFeature('prompt_submit_max', feature);

    return Math.max(0, limit - usage);
  }

  /**
   * GP-5.3: Lấy global quota limit
   * @returns {number|string} Limit number, 'unlimited', hoặc 0 nếu không có feature
   */
  getGlobalLimit() {
    if (this._isLocal && this._isLocal()) return 'unlimited'; // [FIX 2026-07-09] local = unlimited
    const feature = this._getFeature('prompt_submit_max');
    if (!feature) return 'unlimited';

    // Unlimited quota
    if (feature.value === 'unlimited' || feature.value === -1 || feature.value === '-1') {
      return 'unlimited';
    }

    return typeof feature.value === 'string' ? parseInt(feature.value, 10) : feature.value;
  }

  /**
   * GP-5.3: Lấy global quota đã dùng
   * @returns {number} Số đã dùng
   */
  getGlobalUsed() {
    const feature = this._getFeature('prompt_submit_max');
    if (!feature) return 0;
    return this._getUsageForFeature('prompt_submit_max', feature);
  }

  /**
   * GP-6.3: Kiểm tra và emit warning khi global quota còn <10%
   * GP-6.4: Emit exhausted khi global quota đã hết (0 remaining)
   * @param {string} module - Tên module đang gọi (Gen, Task, Workflow, Angles, Effects)
   * @returns {{ shouldWarn: boolean, exhausted: boolean, remaining: number, limit: number|string }}
   */
  checkGlobalQuotaWarning(module = 'Generate') {
    const limit = this.getGlobalLimit();
    const remaining = this.getGlobalRemaining();

    // Unlimited quota - không cần warning
    if (limit === 'unlimited' || remaining === 'unlimited') {
      return { shouldWarn: false, exhausted: false, remaining: 'unlimited', limit: 'unlimited' };
    }

    const numLimit = typeof limit === 'number' ? limit : 0;
    const numRemaining = typeof remaining === 'number' ? remaining : 0;

    // GP-6.4: Exhausted (0 remaining)
    if (numRemaining <= 0) {
      if (window.eventBus) {
        window.eventBus.emit('quota:exhausted', { limit: numLimit, remaining: 0, module });
      }
      return { shouldWarn: false, exhausted: true, remaining: 0, limit: numLimit };
    }

    // GP-6.3: Warning when <10% remaining
    const warningThreshold = Math.ceil(numLimit * 0.1); // 10% of limit
    if (numRemaining <= warningThreshold) {
      if (window.eventBus) {
        window.eventBus.emit('quota:warning', { limit: numLimit, remaining: numRemaining, module });
      }
      return { shouldWarn: true, exhausted: false, remaining: numRemaining, limit: numLimit };
    }

    return { shouldWarn: false, exhausted: false, remaining: numRemaining, limit: numLimit };
  }

  // ===== Pending Run Flags (ghi nhận sau khi hoàn thành) =====

  /**
   * Đặt flag pending gen run (ghi nhận sau khi hoàn thành)
   */
  setPendingGenRun() {
    if (!this.isLoggedIn()) {
      this._pendingGenRun = true;
      console.log('[FeatureGate] setPendingGenRun: flag set');
    }
  }

  /**
   * Ghi nhận pending gen run nếu có flag.
   * Logged-in: server đã trừ, chỉ cần refresh.
   * Anonymous: track local nếu có pending flag.
   */
  async recordPendingGenRun() {
    if (this._pendingGenRun) {
      this._pendingGenRun = false;
      await this.recordGenRun();
      console.log('[FeatureGate] recordPendingGenRun: recorded');
    } else if (this.isLoggedIn()) {
      // Logged-in không dùng pending flag nhưng vẫn refresh để sync
      await this.refresh();
    }
  }

  /**
   * Đặt flag pending task run (ghi nhận sau khi hoàn thành)
   */
  setPendingTaskRun() {
    if (!this.isLoggedIn()) {
      this._pendingTaskRun = true;
      console.log('[FeatureGate] setPendingTaskRun: flag set');
    }
  }

  /**
   * Ghi nhận pending task run nếu có flag.
   * Logged-in: server đã trừ quota, nhưng vẫn cần track daily stats để sync lên server.
   */
  async recordPendingTaskRun() {
    // NOTE: Chỉ record nếu có pending flag (anonymous users).
    // Logged-in users đã được track trong app.js task:run handler (recordTaskRun).
    // Trước đây có else branch track cho logged-in → BUG DOUBLE COUNT!
    if (this._pendingTaskRun) {
      this._pendingTaskRun = false;
      await this.recordTaskRun();
      console.log('[FeatureGate] recordPendingTaskRun: recorded');
    }
  }

  /**
   * Đặt flag pending workflow run
   */
  setPendingWorkflowRun() {
    if (!this.isLoggedIn()) {
      this._pendingWorkflowRun = true;
      console.log('[FeatureGate] setPendingWorkflowRun: flag set');
    }
  }

  /**
   * Ghi nhận pending workflow run nếu có flag.
   * Logged-in: server đã trừ quota, nhưng vẫn cần track daily stats để sync lên server.
   */
  async recordPendingWorkflowRun() {
    // NOTE: Chỉ record nếu có pending flag (anonymous users).
    // Logged-in users đã được track trong WorkflowExecutor (recordWorkflowRun).
    // Trước đây có else branch track cho logged-in → BUG DOUBLE COUNT!
    if (this._pendingWorkflowRun) {
      this._pendingWorkflowRun = false;
      await this.recordWorkflowRun();
      console.log('[FeatureGate] recordPendingWorkflowRun: recorded');
    }
  }

  /**
   * Đặt flag pending angles run
   */
  setPendingAnglesRun() {
    if (!this.isLoggedIn()) {
      this._pendingAnglesRun = true;
      console.log('[FeatureGate] setPendingAnglesRun: flag set');
    }
  }

  /**
   * Ghi nhận pending angles run nếu có flag.
   * Logged-in: server đã trừ quota, nhưng vẫn cần track daily stats để sync lên server.
   */
  async recordPendingAnglesRun() {
    // NOTE: Chỉ record nếu có pending flag (anonymous users).
    // Logged-in users đã được track trong AngleExecution (recordAnglesRun).
    // Trước đây có else branch track cho logged-in → BUG DOUBLE COUNT!
    if (this._pendingAnglesRun) {
      this._pendingAnglesRun = false;
      await this.recordAnglesRun();
      console.log('[FeatureGate] recordPendingAnglesRun: recorded');
    }
  }

  /**
   * Clear tất cả pending flags (khi cancel hoặc lỗi)
   */
  clearAllPendingFlags() {
    this._pendingGenRun = false;
    this._pendingTaskRun = false;
    this._pendingWorkflowRun = false;
    this._pendingAnglesRun = false;
    console.log('[FeatureGate] clearAllPendingFlags: all flags cleared');
  }

  // ===== Module Access Control =====

  /**
   * Kiểm tra module có được bật không
   * @param {string} module - Tên module: 'gen', 'tasks', 'workflows', 'angles'
   * @returns {boolean}
   */
  isModuleEnabled(module) {
    // SF-006: trước đây viết `return true;` rồi để hai dòng kiểm tra entitlement nằm chết phía
    // sau — ESLint có báo no-unreachable nhưng warning không làm đỏ cổng nên nó sống sót.
    // Bản chất KHÔNG phải lỗi: SEOSONA Flow là local-first, mọi module đều mở. Nay viết đúng ý
    // định đó thay vì giấu nó sau mã không chạy được, để người đọc sau không tưởng là bỏ sót.
    if (this._isLocal ? this._isLocal() : true) return true;
    const key = `${module}_enabled`;
    return this.canUse(key);
  }

  /**
   * Async version - đảm bảo data mới nhất
   * STRATEGY:
   * - Nếu có cache hợp lệ → trả về ngay (optimistic)
   * - Nếu KHÔNG có cache hợp lệ → await refresh để đảm bảo data đúng
   * @param {string} module - Tên module
   * @returns {Promise<boolean>}
   */
  async isModuleEnabledAsync(module) {
    // Đảm bảo init đã chạy (dedup Promise)
    if (!this._initialized && this._initPromise) {
      await this._initPromise;
    }

    // Nếu cache KHÔNG hợp lệ → PHẢI await refresh để có data đúng
    // Điều này đảm bảo overlay hiện đúng cho trial/anonymous users
    if (!this._isCacheValid()) {
      // Await refresh (có Promise deduplication)
      await this.refresh();
    }

    return this.isModuleEnabled(module);
  }

  /**
   * Hiển thị dialog khi module bị khóa
   * @param {string} module - Tên module
   * @returns {Promise<void>}
   */
  async showModuleBlockedDialog(module) {
    if (!window.customDialog) {
      console.warn('[SEOSONA Flow] FeatureGate: customDialog chưa sẵn sàng');
      return;
    }

    const moduleNames = {
      gen: 'Generate',
      prompt_templates: 'Prompt Templates',
      workflow_templates: 'Workflow Templates',
      tasks: 'Tasks',
      workflows: 'Workflows',
      workflow_share: 'Chia sẻ Workflow',
      workflow_export: 'Xuất Workflow',
      workflow_import: 'Nhập Workflow',
      angles: 'Angles',
      effects: 'Effects'
    };
    const moduleName = moduleNames[module] || module;

    const isLoggedIn = this.isLoggedIn();

    if (isLoggedIn) {
      // Logged-in user nhưng plan không có quyền → show Upgrade button
      const shouldUpgrade = await window.customDialog.confirm(
        window.I18n?.t('featuregate.featureLockedPaid', { module: moduleName }) || `Gói hiện tại của bạn không bao gồm tính năng ${moduleName}.\n\nVui lòng nâng cấp để sử dụng.`,
        {
          title: window.I18n?.t('featuregate.featureLockedTitle') || 'Tính năng bị khóa',
          type: 'warning',
          confirmText: window.I18n?.t('common.upgrade') || 'Nâng cấp',
          cancelText: window.I18n?.t('common.later') || 'Để sau'
        }
      );

      if (shouldUpgrade) {
        if (typeof window.openUpgradeModal === 'function') {
          window.openUpgradeModal();
        } else {
          try { chrome.runtime.sendMessage({ action: 'showUpgradeModal' }); } catch (e) { globalThis.SEOSONA_swallow?.('FeatureGate#showModuleBlockedDialog', e); }
        }
      }
    } else {
      // Guest user
      const confirmed = await window.customDialog.confirm(
        window.I18n?.t('featuregate.loginRequiredFeature', { module: moduleName }) || `Tính năng ${moduleName} yêu cầu đăng nhập.\n\nĐăng nhập để sử dụng đầy đủ tính năng.`,
        {
          title: window.I18n?.t('featuregate.loginRequiredTitle') || 'Yêu cầu đăng nhập',
          type: 'warning',
          confirmText: window.I18n?.t('auth.login') || 'Đăng nhập',
          cancelText: window.I18n?.t('common.later') || 'Để sau'
        }
      );

      if (confirmed) {
        const loginOverlay = document.getElementById('loginOverlay');
        if (loginOverlay) {
          loginOverlay.classList.remove('hidden');
        } else {
          chrome.runtime.sendMessage({ action: 'openSettings' });
        }
      }
    }
  }

  // ===== Login Prompt =====

  /**
   * Hiển thị dialog khuyên đăng nhập khi hết lượt dùng thử
   * @param {string} reason - Lý do cụ thể
   */
  async showLoginPrompt(reason) {
    if (!window.customDialog) {
      console.warn('[SEOSONA Flow] FeatureGate: customDialog chưa sẵn sàng');
      return;
    }

    const confirmed = await window.customDialog.confirm(
      window.I18n?.t('featuregate.trialExhaustedPrompt', { reason }) || `${reason}\n\nĐăng nhập để tiếp tục sử dụng không giới hạn.`,
      {
        title: window.I18n?.t('featuregate.trialExhaustedTitle') || 'Đã hết lượt dùng thử',
        type: 'warning',
        confirmText: window.I18n?.t('auth.login') || 'Đăng nhập',
        cancelText: window.I18n?.t('common.later') || 'Để sau'
      }
    );

    if (confirmed) {
      const loginOverlay = document.getElementById('loginOverlay');
      if (loginOverlay) {
        loginOverlay.classList.remove('hidden');
      } else {
        chrome.runtime.sendMessage({ action: 'openSettings' });
      }
    }
  }

  // ===== Reset Methods (for testing/debugging) =====

  /**
   * Reset local usage (cho anonymous users)
   */
  async resetLocalUsage() {
    this._localUsage = {};
    await this._saveLocalUsage();
    console.log('[FeatureGate] resetLocalUsage: local usage reset');
  }

  /**
   * Lấy trạng thái usage đầy đủ (cho debugging)
   */
  getUsageStatus() {
    return {
      isLoggedIn: this.isLoggedIn(),
      plan: this.plan,
      localUsage: this._localUsage || {},
      entitlements: this.entitlements || {},
      usage: this._getUsage()
    };
  }

  // ===== Storage Helpers =====

  _storageGet(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || null);
      });
    });
  }

  // ===== Private Helpers =====

  /**
   * Lấy feature từ entitlements.
   *
   * Strategy:
   * - Đã fetch server thành công (_serverFetched=true) → SERVER LÀ NGUỒN SỰ THẬT.
   *   Key thiếu trong response → return null → canUse() = false (disabled).
   *   Lý do: admin có thể disable feature cho trial plan trong DB. Nếu fallback
   *   về _freeDefaults (optimistic true) → bypass admin setting, overlay block
   *   không hiện, footer quota sai.
   * - Chưa fetch (init hoặc fetch fail) → fallback _freeDefaults để UI không flash.
   */
  _getFeature(featureKey) {
    // LOCAL mode: mọi feature trả về unlocked/unlimited.
    // Boolean features → { type:'boolean', value:true }; quota features → { type:'quota', value:-1 (unlimited) }.
    // Suy ra type từ _freeDefaults (fallback 'quota' để getGlobal*/getRateLimit coi là unlimited).
    if (this._isLocal()) {
      const def = this._freeDefaults[featureKey];
      const type = def?.type === 'boolean' ? 'boolean' : 'quota';
      return type === 'boolean'
        ? { type: 'boolean', value: true }
        : { type: 'quota', value: -1, usage_today: 0 };
    }
    if (this.entitlements && this.entitlements[featureKey]) {
      return this.entitlements[featureKey];
    }
    if (this._serverFetched) {
      return null;
    }
    return this._freeDefaults[featureKey] || null;
  }

  /**
   * Load entitlements từ chrome.storage.local
   * CHỉ ghi đè nếu cache có data thực sự, không ghi đè defaults bằng null
   * CRITICAL: Validate cache user_id match với auth state để tránh dùng cache của user khác
   * @returns {Promise<boolean>} true nếu cache hợp lệ và được load, false nếu skip
   */
  async _loadCache() {
    return new Promise(resolve => {
      chrome.storage.local.get([this.cacheKey, 'af_auth'], result => {
        const cached = result[this.cacheKey];
        const auth = result.af_auth;
        const currentUserId = auth?.user?.id || null;

        if (cached) {
          // CRITICAL: Validate cache thuộc về user hiện tại
          // - Cache cũ (trước fix) không có user_id field → SKIP để force fetch cache mới
          // - Nếu có auth (logged in) → cache phải có cùng user_id
          // - Nếu không có auth (anonymous) → cache phải có user_id = null VÀ plan = trial
          const hasUserIdField = 'user_id' in cached;
          const cacheUserId = cached.user_id || null;
          const cachePlanSlug = cached.plan?.slug;

          let isValidCache = false;

          if (!hasUserIdField) {
            // Cache cũ (legacy) không có user_id → SKIP để migrate sang format mới
            console.log('[SEOSONA Flow] FeatureGate: Legacy cache without user_id, skip → will force fetch');
            isValidCache = false;
          } else if (currentUserId) {
            // User đang login → cache phải của đúng user
            isValidCache = cacheUserId === currentUserId;
          } else {
            // User không login (anonymous) → cache phải là trial cache (user_id = null VÀ plan = trial)
            isValidCache = cacheUserId === null && cachePlanSlug === 'trial';
          }

          if (!isValidCache) {
            console.log('[SEOSONA Flow] FeatureGate: Cache invalid, skip → will force fetch',
              'hasUserIdField:', hasUserIdField, 'cacheUserId:', cacheUserId,
              'currentUserId:', currentUserId, 'cachePlan:', cachePlanSlug);
            this._cacheSkippedDueToMismatch = true;
            resolve(false);
            return;
          }

          // CHỈ ghi đè nếu có data thực sự (không null/undefined/empty)
          // Merge với defaults để các feature không có trong cache vẫn có giá trị
          if (cached.entitlements && Object.keys(cached.entitlements).length > 0) {
            this.entitlements = { ...this._freeDefaults, ...cached.entitlements };
            // Cache có data từ server → set flag để _getFeature không fallback _freeDefaults
            this._serverFetched = true;
          }
          if (cached.plan) {
            this.plan = cached.plan;
          }
          this.lastFetch = cached.lastFetch || 0;
          resolve(true);
          return;
        }
        resolve(false);
      });
    });
  }

  /**
   * Lưu entitlements vào chrome.storage.local
   * Bao gồm user_id để validate khi load (tránh dùng cache của user khác)
   */
  async _saveCache() {
    const userId = ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.id || null;
    return new Promise(resolve => {
      chrome.storage.local.set({
        [this.cacheKey]: {
          entitlements: this.entitlements,
          plan: this.plan,
          lastFetch: this.lastFetch,
          user_id: userId
        }
      }, resolve);
    });
  }

  /**
   * Kiểm tra cache còn hiệu lực không
   */
  _isCacheValid() {
    if (!this.entitlements || !this.lastFetch) return false;
    return (Date.now() - this.lastFetch) < this.cacheTTL;
  }

  /**
   * Load local usage từ chrome.storage.local (cho anonymous users)
   */
  async _loadLocalUsage() {
    return new Promise(resolve => {
      chrome.storage.local.get([this._localUsageKey], result => {
        this._localUsage = result[this._localUsageKey] || {};
        console.log('[FeatureGate] _loadLocalUsage:', this._localUsage);
        resolve();
      });
    });
  }

  /**
   * Lưu local usage vào chrome.storage.local
   */
  async _saveLocalUsage() {
    return new Promise(resolve => {
      chrome.storage.local.set({
        [this._localUsageKey]: this._localUsage
      }, resolve);
    });
  }
}

// Static property for serializing daily stat writes
FeatureGate._statQueue = Promise.resolve();

// Singleton instance + class export
window.featureGate = new FeatureGate();
window.FeatureGate = FeatureGate;
