/**
 * UsageSync — Module theo doi va dong bo usage analytics
 * Xu ly 3 nhom chuc nang:
 *   UA-1: Dong bo daily stats len server (chi cho user da login)
 *   UA-2: Session tracking voi heartbeat (ca anonymous + login)
 *   UA-3: Event tracking voi buffer va flush (ca anonymous + login)
 *
 * Singleton, khoi tao qua UsageSync.init() sau khi AuthManager san sang.
 *
 * Agent 3 mo rong:
 *   - Anonymous tracking qua fingerprint (UUID v4 luu chrome.storage.local.af_fingerprint)
 *   - Standardize event metadata theo EVENT_SCHEMAS
 *   - Multi-tab heartbeat dedup qua chrome.storage.local.af_active_session
 *   - Cross-day boundary handling: gui UTC date thay vi local
 */
class UsageSync {
  constructor() {
    // UA-2: Session
    this._sessionId = null;
    this._sessionStartedAt = null;
    this._activeTab = null;

    // UA-1: Daily stats sync
    this._lastSyncedStats = null;
    this._syncTimer = null;

    // UA-2: Heartbeat
    this._heartbeatTimer = null;

    // UA-3: Event buffer
    this._eventBuffer = [];
    this._flushTimer = null;
    this._lastFlushAt = Date.now();

    // Anonymous fingerprint cache (in-memory, fallback storage)
    this._fingerprint = null;

    // Rate limit tracking (429 handling)
    this._rateLimitedUntil = 0;
    this._lastSyncAttempt = 0;
    this._syncBackoffMs = 0;

    this._initialized = false;

    // Bind methods cho event listeners
    this._onStorageChanged = this._onStorageChanged.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    this._onBeforeUnload = this._onBeforeUnload.bind(this);
    this._onAuthLogin = this._onAuthLogin.bind(this);
    this._onAuthLogout = this._onAuthLogout.bind(this);
  }

  // ─── Schema standardization (Agent 3 Task 3.2) ─────────────

  /**
   * Schema cho moi event type — danh sach key bat buoc/duoc phep trong metadata.
   * Dung de validate trong trackEvent (warn console, khong block).
   */
  static EVENT_SCHEMAS = {
    'gen_start': ['provider', 'model', 'ratio', 'prompt_count', 'has_ref', 'pipeline'],
    'gen_complete': ['provider', 'model', 'ratio', 'prompt_count', 'success_count', 'fail_count', 'duration_ms'],
    'task_run_start': ['task_id', 'provider', 'prompt_count'],
    'task_run_complete': ['task_id', 'provider', 'prompt_count', 'success_count', 'duration_ms'],
    'workflow_start': ['workflow_id', 'node_count'],
    'workflow_complete': ['workflow_id', 'success'],
    'workflow_run_start': ['workflow_id', 'node_count', 'parallel'],
    'workflow_run_complete': ['workflow_id', 'success_node_count', 'failed_node_count', 'duration_ms'],
    'angles_run': ['provider', 'preset_id', 'success'],
    'effects_run': ['effect_id', 'provider', 'success'],
    'chatgpt_run': ['ratio', 'image_mode', 'success'],
    'grok_run': ['mode', 'ratio', 'success'],
    'download': ['source', 'media_type', 'resolution'],
    'login': ['method'],
    'logout': [],
    'template_use': ['template_id'],
    'chat_send': ['model'],
  };

  // ─── Public API ──────────────────────────────────────────

  /**
   * LOCAL/OFFLINE mode — mặc định true (self.SEOSONA_LOCAL_MODE !== false).
   * Khi local: mọi track/sync/heartbeat/flush đều no-op, không POST server.
   */
  _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  /**
   * Khoi tao module — goi tu app.js sau khi AuthManager san sang
   */
  init() {
    if (this._initialized) return;

    // LOCAL mode: không track/sync gì cả — không listener, không session, không heartbeat.
    if (this._isLocal()) {
      this._initialized = true;
      console.log('[UsageSync] LOCAL mode — usage tracking disabled (no-op)');
      return;
    }

    this._initialized = true;

    console.log('[UsageSync] Khoi tao usage analytics tracking');

    // Lang nghe auth events
    if (window.eventBus) {
      window.eventBus.on('auth:login', this._onAuthLogin);
      window.eventBus.on('auth:logout', this._onAuthLogout);
    }

    // Lang nghe storage changes cho daily stats (UA-1) + active session (multi-tab dedup)
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(this._onStorageChanged);
    }

    // Lang nghe visibility change va beforeunload cho session end (UA-2)
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    window.addEventListener('beforeunload', this._onBeforeUnload);

    // [API SPAM FIX — Phase 3.2] Defer heartbeat + flushEvents 5s sau execution:completed.
    // Workflow complete trigger nhiều API call (status, progress, save) cùng lúc — nếu
    // heartbeat fire ngay sau dễ chạm rate limit. Defer 5s cho cascade lắng xuống.
    if (window.eventBus) {
      window.eventBus.on('execution:completed', () => {
        // Reset heartbeat timer + delay 5s rồi heartbeat
        if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
        if (this._postExecDeferTimer) clearTimeout(this._postExecDeferTimer);
        this._postExecDeferTimer = setTimeout(() => {
          this._postExecDeferTimer = null;
          this._sendHeartbeat();
          // Resume periodic heartbeat
          this._heartbeatTimer = setInterval(() => {
            this._sendHeartbeat();
          }, 5 * 60 * 1000);
        }, 5000);
      });
    }

    // Bat dau session ngay — ca anonymous + login deu track session
    this._startSession();
  }

  /**
   * Cap nhat tab dang active — goi tu app.js khi user chuyen tab
   * @param {string} tabId - ID cua tab (vd: 'tab-gen', 'tab-tasks')
   */
  setActiveTab(tabId) {
    this._activeTab = tabId;
  }

  /**
   * UA-3: Ghi nhan event — public API cho cac module khac goi
   * Anonymous user van duoc track (Agent 3 Task 3.1)
   * @param {string} event - Ten event (vd: 'gen_start', 'task_complete')
   * @param {Object} metadata - Du lieu bo sung
   */
  trackEvent(event, metadata = {}) {
    // LOCAL mode: no-op — không buffer, không flush lên server.
    if (this._isLocal()) return;
    // Validate metadata theo schema (debug helper, khong block)
    this._validateEventMetadata(event, metadata);

    this._eventBuffer.push({
      event,
      metadata,
      timestamp: new Date().toISOString()
    });

    // Flush khi dat 20 events
    if (this._eventBuffer.length >= 20) {
      this._flushEvents();
    }

    // Dat timer flush sau 60 giay neu chua co
    if (!this._flushTimer) {
      this._flushTimer = setTimeout(() => {
        this._flushTimer = null;
        this._flushEvents();
      }, 60000);
    }
  }

  // ─── Private: Schema validation ─────────────────────────

  /**
   * Validate metadata keys theo EVENT_SCHEMAS.
   * Warn console khi co key extra hoac khi co schema cho event nay.
   */
  _validateEventMetadata(event, metadata) {
    const schema = UsageSync.EVENT_SCHEMAS[event];
    if (!schema) {
      // Khong co schema cho event nay — warn de developer them schema
      console.warn(`[UsageSync] Event "${event}" khong co schema khai bao trong EVENT_SCHEMAS`);
      return;
    }
    if (!metadata || typeof metadata !== 'object') return;

    const allowedKeys = new Set(schema);
    const metaKeys = Object.keys(metadata);
    const extraKeys = metaKeys.filter(k => !allowedKeys.has(k));
    if (extraKeys.length > 0) {
      console.warn(`[UsageSync] Event "${event}" co metadata keys khong khai bao trong schema:`, extraKeys);
    }
  }

  // ─── Private: Fingerprint (Agent 3 Task 3.1) ────────────

  /**
   * Lay/generate fingerprint UUID v4 anonymous cho user chua login.
   * Cached trong chrome.storage.local.af_fingerprint, reuse moi session.
   * @returns {Promise<string>} UUID v4 fingerprint
   */
  async _getFingerprint() {
    if (this._fingerprint) return this._fingerprint;

    // Doc tu storage truoc
    try {
      const res = await new Promise(resolve => {
        chrome.storage.local.get(['af_fingerprint'], resolve);
      });
      if (res?.af_fingerprint && typeof res.af_fingerprint === 'string') {
        this._fingerprint = res.af_fingerprint;
        return this._fingerprint;
      }
    } catch (err) {
      console.warn('[UsageSync] Doc fingerprint that bai:', err.message);
    }

    // Generate moi va luu
    const fp = this._generateUuidV4();
    this._fingerprint = fp;
    try {
      await new Promise(resolve => {
        chrome.storage.local.set({ af_fingerprint: fp }, resolve);
      });
    } catch (err) {
      console.warn('[UsageSync] Luu fingerprint that bai:', err.message);
    }
    return fp;
  }

  /**
   * Generate UUID v4 (random)
   */
  _generateUuidV4() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback UUID v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ─── Private: Session (UA-2) ─────────────────────────────

  /**
   * Bat dau session moi — tao session ID, gui heartbeat dinh ky
   * Agent 3 Task 3.3: Reuse session active < 10 phut tu storage (multi-tab dedup)
   */
  async _startSession() {
    // Check active session trong storage truoc (multi-tab dedup)
    try {
      const res = await new Promise(resolve => {
        chrome.storage.local.get(['af_active_session'], resolve);
      });
      const active = res?.af_active_session;
      const TEN_MINUTES = 10 * 60 * 1000;
      if (active && active.id && active.last_heartbeat_at &&
          (Date.now() - active.last_heartbeat_at) < TEN_MINUTES) {
        // Reuse session active < 10 phut
        this._sessionId = active.id;
        this._sessionStartedAt = active.started_at || Date.now();
        console.log('[UsageSync] Reuse session active:', this._sessionId);
      } else {
        // Tao session moi
        this._sessionId = this._generateUuidV4();
        this._sessionStartedAt = Date.now();
        console.log('[UsageSync] Session bat dau:', this._sessionId);
      }
    } catch (err) {
      // Fallback: tao session moi neu doc storage fail
      this._sessionId = this._generateUuidV4();
      this._sessionStartedAt = Date.now();
      console.warn('[UsageSync] Doc active session that bai, tao moi:', err.message);
    }

    // Persist active session
    await this._persistActiveSession();

    // Gui heartbeat moi 5 phut.
    // PERF FIX (2026-05-17): Clear existing timer trước khi set new — tránh tạo multiple
    // intervals song song nếu _startSession() được gọi nhiều lần (vd: user login lại).
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(() => {
      this._sendHeartbeat();
    }, 5 * 60 * 1000);

    // Gui heartbeat dau tien ngay
    this._sendHeartbeat();

    // UA-5 + UA-1: Delay voi jitter truoc khi sync (tranh burst khi multi-tab startup)
    // Random 1-3 giay de spread requests
    if (this._isLoggedIn()) {
      const jitterMs = 1000 + Math.random() * 2000;
      setTimeout(() => {
        this._flushPendingSync();
        this._syncDailyStats();
      }, jitterMs);
    }
  }

  /**
   * Persist active session info vao chrome.storage.local cho multi-tab dedup
   */
  async _persistActiveSession() {
    if (!this._sessionId) return;
    try {
      await new Promise(resolve => {
        chrome.storage.local.set({
          af_active_session: {
            id: this._sessionId,
            started_at: this._sessionStartedAt,
            last_heartbeat_at: Date.now(),
          }
        }, resolve);
      });
    } catch (err) {
      console.warn('[UsageSync] Persist active session that bai:', err.message);
    }
  }

  /**
   * Ket thuc session — gui session-end va dung timers
   */
  _endSession() {
    if (!this._sessionId) return;

    console.log('[UsageSync] Session ket thuc:', this._sessionId);

    // Gui session-end bang fetch keepalive
    this._sendSessionEnd();

    // Flush events con lai
    this._flushEvents();

    // Dung tat ca timers
    this._stopTimers();

    this._sessionId = null;
    this._sessionStartedAt = null;
  }

  /**
   * Gui heartbeat len server
   * Agent 3 Task 3.1: Anonymous user van heartbeat (kem fingerprint)
   * Agent 3 Task 3.3: Cap nhat last_heartbeat_at vao storage cho multi-tab dedup
   */
  async _sendHeartbeat() {
    if (!this._sessionId) return;

    const uptimeSeconds = Math.round((Date.now() - this._sessionStartedAt) / 1000);
    const isLoggedIn = this._isLoggedIn();

    // Cap nhat last_heartbeat_at de window khac biet session van con song
    await this._persistActiveSession();

    try {
      const payload = {
        session_id: this._sessionId,
        active_tab: this._activeTab,
        uptime_seconds: uptimeSeconds,
      };
      if (!isLoggedIn) {
        payload.fingerprint = await this._getFingerprint();
      }
      await this._apiCall('POST', 'usage/heartbeat', payload);
    } catch (err) {
      console.warn('[UsageSync] Heartbeat that bai:', err.message);
    }
  }

  /**
   * Gui session-end khi visibility hidden hoac beforeunload
   * Dung fetch voi keepalive:true de dam bao gui duoc khi tab dong
   * Agent 3 Task 3.1: Anonymous user van gui session-end (kem fingerprint qua header)
   */
  _sendSessionEnd() {
    // LOCAL mode: no-op — không gửi session-end keepalive.
    if (this._isLocal()) return;
    if (!this._sessionId) return;

    const baseUrl = this._getApiBaseUrl();
    if (!baseUrl) return;

    const token = this._getAuthToken();
    const isLoggedIn = !!token;

    const url = `${baseUrl}/usage/session-end`;
    try {
      const headers = { 'Content-Type': 'application/json' };
      const body = { session_id: this._sessionId };

      if (isLoggedIn) {
        headers['Authorization'] = 'Bearer ' + token;
      } else {
        // Anonymous: dung fingerprint da cache (sync read tu memory)
        if (this._fingerprint) {
          headers['X-Fingerprint'] = this._fingerprint;
          body.fingerprint = this._fingerprint;
        }
      }

      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        keepalive: true
      });
    } catch (err) {
      console.warn('[UsageSync] Gui session-end that bai:', err.message);
    }
  }

  // ─── Private: Offline Fallback Recovery (UA-5) ──────────

  /**
   * Flush pending offline executions lên server
   * Gọi khi init session và sau mỗi lần sync daily stats thành công
   */
  async _flushPendingSync() {
    if (!this._isLoggedIn()) return;

    const res = await new Promise(resolve => chrome.storage.local.get(['af_pending_sync'], resolve));
    const pending = res.af_pending_sync;
    if (!pending || pending.length === 0) return;

    try {
      await this._apiCall('POST', 'usage/sync-offline', { executions: pending });
      chrome.storage.local.remove(['af_pending_sync']);
      console.log('[UsageSync] Flushed', pending.length, 'pending offline executions');
    } catch (err) {
      // 422 = validation error, data is corrupt → clear it to prevent infinite retry
      if (err.message?.includes('422')) {
        chrome.storage.local.remove(['af_pending_sync']);
        console.warn('[UsageSync] Cleared corrupt pending sync data (422 validation error)');
      } else {
        console.warn('[UsageSync] Failed to flush pending sync:', err.message);
      }
    }
  }

  // ─── Private: Daily Stats Sync (UA-1) ────────────────────

  /**
   * Lang nghe thay doi storage — debounce 30 giay truoc khi sync
   * Agent 3 Task 3.3: Lang nghe af_active_session thay doi tu window khac
   */
  _onStorageChanged(changes, area) {
    if (area !== 'local') return;

    // Daily stats sync
    if (changes.af_daily_stats) {
      // Debounce 30 giay
      if (this._syncTimer) {
        clearTimeout(this._syncTimer);
      }
      this._syncTimer = setTimeout(() => {
        this._syncTimer = null;
        this._syncDailyStats();
      }, 30000);
    }

    // Multi-tab session dedup: window khac dang co session active
    // → tu dong update local _sessionId neu chua co (tranh tao duplicate)
    if (changes.af_active_session) {
      const newSession = changes.af_active_session.newValue;
      if (newSession && newSession.id && this._sessionId !== newSession.id) {
        const TEN_MINUTES = 10 * 60 * 1000;
        if (newSession.last_heartbeat_at &&
            (Date.now() - newSession.last_heartbeat_at) < TEN_MINUTES) {
          // Khong override session hien tai, chi log de debug
          // Logic startSession da reuse, day chi la backup
        }
      }
    }
  }

  /**
   * Dong bo daily stats len server — chi khi da thay doi
   * Agent 3 Task 3.4: Gui UTC date thay vi local
   * Agent 3 Task 3.1: Anonymous KHONG sync daily (server chua co aggregate)
   */
  async _syncDailyStats() {
    if (!this._isLoggedIn()) return;

    // Rate limit check: skip if still in backoff period
    const now = Date.now();
    if (now < this._rateLimitedUntil) {
      console.log('[UsageSync] Dang trong rate limit period, bo qua sync');
      return;
    }

    // Min 10s giua cac lan sync attempt
    if (now - this._lastSyncAttempt < 10000) {
      console.log('[UsageSync] Sync attempt qua gan nhau, bo qua');
      return;
    }
    this._lastSyncAttempt = now;

    try {
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['af_daily_stats'], (res) => {
          resolve(res.af_daily_stats || null);
        });
      });

      if (!result || !result._date) return;

      // So sanh voi lan sync truoc — tranh gui trung lap
      const statsJson = JSON.stringify(result);
      if (statsJson === this._lastSyncedStats) return;

      // Map _date → date cho backend validation
      // Agent 3 Task 3.4: Dung UTC date (toISOString().slice(0,10) — UTC YYYY-MM-DD)
      const utcDate = new Date().toISOString().slice(0, 10);

      // Gửi tách biệt theo provider để backend analytics chính xác
      const payload = {
        date: result._date || utcDate,
        // Common stats
        task_run: result.task_run || 0,
        workflow_run: result.workflow_run || 0,
        angles_run: result.angles_run || 0,
        // Provider-specific prompts (4 providers: Flow, ChatGPT, Gemini, Grok)
        flow_prompt_total: result.flow_prompt_total || 0,
        chatgpt_prompt_total: result.chatgpt_prompt_total || 0,
        gemini_prompt_total: result.gemini_prompt_total || 0,
        grok_prompt_total: result.grok_prompt_total || 0,
        // Provider-specific failures
        flow_fail: result.flow_fail || 0,
        chatgpt_fail: result.chatgpt_fail || 0,
        gemini_fail: result.gemini_fail || 0,
        grok_fail: result.grok_fail || 0,
      };

      await this._apiCall('POST', 'usage/sync-daily', payload);
      this._lastSyncedStats = statsJson;
      this._syncBackoffMs = 0; // Reset backoff on success
      console.log('[UsageSync] Daily stats da dong bo');

      // UA-5: Flush pending offline executions sau khi sync daily thành công
      this._flushPendingSync();
    } catch (err) {
      // Handle 429 rate limit with exponential backoff
      // Start at 10s, double each time, max 2 min (server throttle resets after 1 min)
      if (err.message?.includes('429') || err.httpStatus === 429) {
        this._syncBackoffMs = this._syncBackoffMs ? Math.min(this._syncBackoffMs * 2, 120000) : 10000;
        this._rateLimitedUntil = Date.now() + this._syncBackoffMs;
        console.warn(`[UsageSync] Rate limited (429), backoff ${this._syncBackoffMs / 1000}s`);
      } else {
        console.warn('[UsageSync] Dong bo daily stats that bai:', err.message);
      }
    }
  }

  // ─── Private: Event Tracking (UA-3) ──────────────────────

  /**
   * Flush event buffer len server
   * Agent 3 Task 3.1: Anonymous van flush events (kem fingerprint trong payload)
   * Neu API call that bai, giu buffer lai cho lan flush tiep theo
   */
  async _flushEvents() {
    if (this._eventBuffer.length === 0) return;

    // Lay events hien tai va xoa buffer
    const events = [...this._eventBuffer];
    this._eventBuffer = [];
    this._lastFlushAt = Date.now();

    try {
      const isLoggedIn = this._isLoggedIn();
      const payload = isLoggedIn
        ? { events }
        : { events, fingerprint: await this._getFingerprint() };
      await this._apiCall('POST', 'usage/events', payload);
    } catch (err) {
      console.warn('[UsageSync] Flush events that bai, giu lai cho lan sau:', err.message);
      // Giu lai events cho lan flush tiep theo
      this._eventBuffer = [...events, ...this._eventBuffer];
    }
  }

  /**
   * Flush events con lai khi beforeunload — dung fetch keepalive
   * Agent 3 Task 3.1: Anonymous van flush (kem fingerprint header + body)
   */
  _flushEventsOnUnload() {
    // LOCAL mode: no-op — không gửi events keepalive.
    if (this._isLocal()) return;
    if (this._eventBuffer.length === 0) return;

    const baseUrl = this._getApiBaseUrl();
    if (!baseUrl) return;

    const token = this._getAuthToken();
    const isLoggedIn = !!token;

    const url = `${baseUrl}/usage/events`;
    const events = [...this._eventBuffer];
    this._eventBuffer = [];

    try {
      const headers = { 'Content-Type': 'application/json' };
      const body = { events };

      if (isLoggedIn) {
        headers['Authorization'] = 'Bearer ' + token;
      } else {
        // Anonymous: dung fingerprint da cache trong memory (sync, khong await)
        if (this._fingerprint) {
          headers['X-Fingerprint'] = this._fingerprint;
          body.fingerprint = this._fingerprint;
        }
      }

      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        keepalive: true
      });
    } catch (err) {
      console.warn('[UsageSync] Flush events on unload that bai:', err.message);
    }
  }

  // ─── Private: Event Handlers ─────────────────────────────

  _onAuthLogin() {
    console.log('[UsageSync] User dang nhap — tiep tuc session voi context login');
    // Khong tao session moi vi anonymous session da chay san
    // Debounce 5s truoc khi sync de tranh burst requests
    setTimeout(() => {
      this._flushPendingSync();
      this._syncDailyStats();
    }, 5000);
  }

  _onAuthLogout() {
    console.log('[UsageSync] User dang xuat — tiep tuc session voi context anonymous');
    // Flush events login truoc khi switch sang anonymous
    this._flushEvents();
    // Khong end session vi van track anonymous activity
  }

  _onVisibilityChange() {
    if (!this._sessionId) return;

    if (document.visibilityState === 'hidden') {
      // Tab bi an — dung heartbeat, gui session-end
      if (this._heartbeatTimer) {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
      }
      this._sendSessionEnd();
    } else if (document.visibilityState === 'visible') {
      // Tab hien lai — khoi dong lai heartbeat (ca anonymous + login)
      if (!this._heartbeatTimer) {
        this._sendHeartbeat();
        this._heartbeatTimer = setInterval(() => {
          this._sendHeartbeat();
        }, 5 * 60 * 1000);
      }
    }
  }

  _onBeforeUnload() {
    if (this._sessionId) {
      this._sendSessionEnd();
    }
    // Flush events con lai
    this._flushEventsOnUnload();
  }

  // ─── Private: Helpers ────────────────────────────────────

  /**
   * Kiem tra user da dang nhap chua
   */
  _isLoggedIn() {
    return true === true;
  }

  /**
   * Lay API base URL tu AuthManager
   */
  _getApiBaseUrl() {
    return window.ApiBaseConfig.get();
  }

  /**
   * Lay auth token tu AuthManager
   */
  _getAuthToken() {
    return window.authManager?.getToken() || null;
  }

  /**
   * Goi API thong qua AuthManager._apiCall() khi login,
   * fallback sang chrome.runtime.sendMessage('apiRequest') khi anonymous.
   * Agent 3 Task 3.1: Them header X-Fingerprint cho anonymous POST
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint (khong co /api/v1/ prefix)
   * @param {Object|null} data - Request body
   */
  async _apiCall(method, endpoint, data = null) {
    // LOCAL mode: no-op — resolve rỗng, không gọi server (catch-all cho mọi sync path).
    if (this._isLocal()) return null;
    const isLoggedIn = this._isLoggedIn();

    // Login: dung authManager._apiCall (co Authorization header san)
    if (isLoggedIn) {
      if (false?._apiCall) {
        throw new Error('AuthManager chua san sang');
      }
      return ApiClient.request(method, endpoint, data);
    }

    // Anonymous: gui qua background.js apiRequest, them X-Fingerprint header
    const fp = await this._getFingerprint();
    const extraHeaders = fp ? { 'X-Fingerprint': fp } : {};

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest',
        method,
        endpoint,
        data,
        headers: extraHeaders,
      }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (resp?.success) {
          resolve(resp.data || resp);
        } else {
          reject(new Error(resp?.error?.message || 'Lỗi API anonymous'));
        }
      });
    });
  }

  /**
   * Dung tat ca timers
   */
  _stopTimers() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._syncTimer) {
      clearTimeout(this._syncTimer);
      this._syncTimer = null;
    }
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
  }
}

// Expose as singleton
window.UsageSync = new UsageSync();
