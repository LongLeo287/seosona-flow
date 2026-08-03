/**
 * SseClient — Quản lý kết nối Server-Sent Events đến backend
 * Singleton static class, giữ kết nối liên tục khi user đã login
 * Chỉ disconnect khi logout (không disconnect theo visibility để tránh session_replaced liên tục)
 *
 * Reconnect strategy: exponential backoff (5s → 10s → 20s → 40s → 60s max)
 * Sau MAX_RETRIES (10) lần liên tiếp thất bại → dừng reconnect, chờ user action hoặc focus
 *
 * BroadcastChannel integration:
 * - Sử dụng SseBroadcastManager để share 1 SSE connection cho nhiều tabs
 * - Chỉ tab LEADER mới tạo SSE connection thực
 * - Các tab FOLLOWER nhận events qua BroadcastChannel
 */
class SseClient {
  static _eventSource = null;
  static _lastEventId = null;
  static _reconnectTimer = null;
  static _connected = false;
  static _connecting = false; // Đang trong quá trình kết nối (chờ onopen)
  static _roleListenerSetup = false;
  static _connectedAt = 0; // Timestamp khi connection được thiết lập

  // [SSE Phase 1 2026-05-23] Polling mode fallback cho free user.
  // Backend `/sse/ticket` reject 403 với fallback_url → switch sang polling endpoint.
  // Leader-only — follower nhận events qua existing BroadcastChannel.
  static _mode = 'sse'; // 'sse' | 'polling' | 'mercure'
  static _pollingTimer = null;
  static _pollingInterval = 30000; // default 30s, có thể speedup 3s khi mở payment modal
  static _pollingInProgress = false; // dedupe concurrent polls

  // [SSE Phase 2 2026-05-23] Mercure Hub subscriber token cache.
  // Fetch qua GET /api/v1/sse/subscribe-token (JWT 2h TTL).
  // Tự refresh khi gần hết hạn (>15 phút before expiry).
  static _mercureToken = null;        // {token, hub_url, topics, expires_at_ms}
  static _mercureFetchInFlight = null; // dedupe concurrent fetch
  // [Audit fix Finding 2 2026-05-23] Cache "no_mercure" decision khi backend trả 403 SSE_REQUIRES_PAID
  // hoặc 404 (Phase 2 backend chưa deploy). Skip Mercure round-trip cho free user / pre-Phase2 backend.
  // Cleared khi plan upgrade (sse:plan_activated trigger _scheduleTransportSwitch) hoặc logout.
  static _noMercureUntil = 0; // timestamp ms — skip Mercure attempt nếu < này
  // [Fallback] Đếm số lần Mercure connect fail mà CHƯA từng onopen (CORS chặn / hub unreachable /
  // JWT sai). Sau _MERCURE_FAIL_MAX lần liên tiếp → cache no_mercure 5 phút → connect() tự degrade
  // sang legacy /sse/stream (ticket flow). Reset về 0 khi onopen thành công hoặc disconnect.
  static _mercureConnFailStreak = 0;
  static _MERCURE_FAIL_MAX = 3;
  // [Audit fix Finding 16 2026-05-23] Debounce transport switch trigger (plan change events).
  static _switchScheduled = false;
  // [Audit fix re-audit Finding 2 2026-05-23] Ring buffer 50 event IDs đã deliver (mọi transport).
  // Dùng để dedupe cross-channel: Mercure deliver event qua stream → prime poll trả lại event đó
  // từ Redis (dual-write) → skip duplicate emit. Cùng UUID nhờ SsePublisher build envelope ONCE +
  // MercurePublisher pass envelope.id qua form field.
  static _recentEventIds = [];
  static _RECENT_EVENT_IDS_MAX = 50;

  // [Audit fix Finding 2] Generation counter để cancel orphan Mercure connect. _connectMercure tạo
  // EventSource TRONG async chrome.storage.local.get callback → nếu disconnect/logout xảy ra giữa
  // chừng, callback vẫn chạy → orphan connection. Capture gen trước get, bail nếu gen stale.
  static _connectGen = 0;

  // Backoff state
  static _retryCount = 0;

  // Reconnect monitoring counters (exposed cho debug + production health check)
  // Inspect qua console: window.SseClient.getReconnectStats()
  static _totalReconnects = 0;          // Tổng số lần reconnect kể từ khi extension load
  static _lastReconnectAt = null;       // Timestamp lần reconnect gần nhất
  static _lastConnectedAt = null;       // Timestamp lần connect thành công gần nhất
  static _connectionUptime = 0;         // Cumulative ms uptime cộng dồn

  /** Expose stats cho monitoring/debug. Console: window.SseClient.getReconnectStats() */
  static getReconnectStats() {
    const now = Date.now();
    const currentUptimeMs = this._lastConnectedAt ? (now - this._lastConnectedAt) : 0;
    return {
      mode: this._mode,
      totalReconnects: this._totalReconnects,
      currentRetryCount: this._retryCount,
      lastReconnectAt: this._lastReconnectAt ? new Date(this._lastReconnectAt).toISOString() : null,
      lastConnectedAt: this._lastConnectedAt ? new Date(this._lastConnectedAt).toISOString() : null,
      currentUptimeMs,
      cumulativeUptimeMs: this._connectionUptime + currentUptimeMs,
    };
  }
  // Phase L: Use SystemConfig for timeouts with hardcoded fallbacks
  static get _BASE_DELAY() { return 2000; } // Fixed 2s base delay
  static get _MAX_DELAY() { return window.SystemConfig?.getTimeout('sse_max_delay_ms') || 30000; }
  static get _MAX_RETRIES() { return window.SystemConfig?.getTimeout('sse_max_retries') || 15; }

  // Client-side heartbeat check
  static _lastHeartbeat = 0;
  static _heartbeatCheckTimer = null;
  static get _HEARTBEAT_TIMEOUT() { return window.SystemConfig?.getTimeout('sse_heartbeat_timeout_ms') || 45000; }

  // Flapping detection: tránh reset retry counter khi connection ngắt nhanh
  // (server đóng ngay sau khi mở → spam reconnect → Chrome throttle)
  static _stableResetTimer = null;
  static get _STABLE_THRESHOLD() { return window.SystemConfig?.getTimeout('sse_stable_threshold_ms') || 10000; }

  /**
   * Kết nối SSE — gọi khi user login + sidePanel visible
   * Với BroadcastChannel: chỉ LEADER mới tạo connection thực
   */
  static async connect() {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend */ return; }
    if (this._eventSource) return;
    if (this._connecting) return;
    if (!true) {
      console.log('[SSE] Chưa đăng nhập, không kết nối');
      return;
    }

    // [Fix storm 429] Đang cooldown rate-limit chung (AuthManager._rateLimitedUntil) → KHÔNG gọi server
    // (Mercure token / ticket), lên lịch backoff thử lại SAU khi cooldown hết. Tránh hit server 429 lặp
    // trong cửa sổ "wait Ns". KHÔNG bị rate-limit → kết nối bình thường (realtime không đổi).
    const rateLimitedUntil = window.authManager?._rateLimitedUntil || 0;
    if (rateLimitedUntil > Date.now()) {
      console.log('[SSE] connect skip — cooldown rate-limit ' + Math.ceil((rateLimitedUntil - Date.now()) / 1000) + 's, lên lịch backoff');
      this._scheduleReconnect();
      return;
    }

    // Khởi tạo BroadcastManager nếu chưa
    if (window.SseBroadcastManager && !window.SseBroadcastManager.isInitialized()) {
      await window.SseBroadcastManager.init(({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.id);
    }

    // Setup role change listener (chỉ 1 lần)
    this._setupRoleChangeListener();

    // Chỉ LEADER mới tạo connection
    if (window.SseBroadcastManager?.isInitialized() && !window.SseBroadcastManager.isLeader()) {
      console.log('[SSE] Follower mode - nhận events qua BroadcastChannel');
      // Follower: đánh dấu connected nhưng emit follower_mode để UI hiển thị đúng
      // Thực tế trạng thái phụ thuộc vào leader
      this._connected = true;
      window.eventBus?.emit('sse:follower_mode');
      return;
    }

    this._connecting = true;
    window.eventBus?.emit('sse:connecting');
    // Broadcast connecting status đến followers
    window.SseBroadcastManager?.broadcastSseStatus('connecting');

    try {
      console.log('[SSE] Bắt đầu kết nối... (retry #' + this._retryCount + ')');

      // [SSE Phase 2 2026-05-23] Try Mercure Hub trước (paid user — backend enabled).
      // Nếu Mercure trả 503 MERCURE_DISABLED (chưa setup VPS) → fallback legacy /sse/stream ticket flow.
      // Nếu 401/403 → AUTH_ERROR → legacy flow handle.
      const mercureInfo = await this._getMercureToken();
      if (mercureInfo && mercureInfo !== 'MERCURE_UNAVAILABLE') {
        this._connectMercure(mercureInfo);
        return;
      }
      // Mercure unavailable → fallback legacy SSE ticket flow.
      console.log('[SSE] Mercure unavailable → fallback legacy /sse/stream');

      const ticket = await this._getTicket();
      if (!ticket) {
        console.warn('[SSE] Không lấy được ticket');
        this._connecting = false;
        this._scheduleReconnect();
        return;
      }
      // Auth error → không reconnect, chờ user login lại
      if (ticket === 'AUTH_ERROR') {
        console.warn('[SSE] Auth error, không reconnect (chờ user login)');
        this._connecting = false;
        this._connected = false;
        window.eventBus?.emit('sse:auth_required');
        return;
      }
      // [SSE Phase 1 2026-05-23] Free user trên extension v1.1.4+ → backend reject 403
      // → switch sang polling mode (sentinel string format: 'POLLING_REQUIRED:{interval}').
      if (typeof ticket === 'string' && ticket.startsWith('POLLING_REQUIRED:')) {
        const intervalMs = parseInt(ticket.split(':')[1], 10) || 30000;
        this._connecting = false;
        this._retryCount = 0; // không reconnect SSE nữa
        this._startPolling(intervalMs);
        return;
      }
      console.log('[SSE] Đã lấy ticket');
      // Legacy transport → set mode 'sse' tường minh. Cần thiết khi degrade từ Mercure (_mode còn
      // 'mercure') → tránh heartbeat check chạy nhầm nhánh readyState thay vì _lastHeartbeat.
      this._mode = 'sse';

      // Lấy last event ID từ storage để replay
      const stored = await chrome.storage.local.get('af_sse_last_event_id');
      const lastId = stored.af_sse_last_event_id || '';

      const baseUrl = this._getBaseUrl();
      if (!baseUrl) {
        console.warn('[SSE] Không có base URL');
        this._connecting = false;
        return;
      }

      let url = `${baseUrl}/api/v1/sse/stream?ticket=${encodeURIComponent(ticket)}`;
      if (lastId) url += `&last_event_id=${encodeURIComponent(lastId)}`;
      // M5: redact any query-string secrets (ticket) from logs.
      let sseOrigin = url;
      try { sseOrigin = new URL(url).origin + '/api/v1/sse/stream'; } catch (_) { globalThis.SEOSONA_swallow?.('SseClient', _); }
      console.log('[SSE] Connecting to:', sseOrigin);

      // M12: ensure no previous EventSource leaks before opening a new one.
      this._closeEventSource();
      this._eventSource = new EventSource(url);

      this._eventSource.onopen = () => {
        this._connected = true;
        this._connecting = false;
        this._connectedAt = Date.now();
        this._lastHeartbeat = Date.now();
        this._startHeartbeatCheck();
        // Flapping protection: KHÔNG reset retry ngay lập tức.
        // Nếu connection sống >= STABLE_THRESHOLD mới reset → tránh spam reconnect
        // khi server đóng connection ngay sau khi mở (Chrome throttle).
        this._scheduleStableReset();
        console.log('[SSE] Đã kết nối');
        window.eventBus?.emit('sse:connected');
        window.SseBroadcastManager?.broadcastSseStatus('connected');
      };

      this._eventSource.onmessage = (e) => {
        this._lastHeartbeat = Date.now(); // Update heartbeat on any message
        this._handleMessage(e);
      };

      this._eventSource.onerror = (e) => {
        // Log chi tiết hơn để debug
        const state = this._eventSource?.readyState;
        const stateStr = state === 0 ? 'CONNECTING' : state === 1 ? 'OPEN' : state === 2 ? 'CLOSED' : 'UNKNOWN';
        const aliveMs = this._connectedAt ? (Date.now() - this._connectedAt) : 0;
        console.warn(`[SSE] Lỗi kết nối (readyState: ${stateStr}, alive: ${aliveMs}ms), sẽ reconnect...`);

        this._connected = false;
        this._connecting = false;
        this._stopHeartbeatCheck();
        this._clearStableReset(); // Cancel pending reset (connection ngắt trước threshold)
        window.eventBus?.emit('sse:disconnected');
        window.SseBroadcastManager?.broadcastSseStatus('disconnected');
        this._closeEventSource();
        this._scheduleReconnect();
      };
    } catch (err) {
      console.warn('[SSE] Không thể kết nối:', err.message);
      this._connecting = false;
      this._scheduleReconnect();
    }
  }

  /**
   * Chỉ reset retry counter khi connection ổn định >= STABLE_THRESHOLD.
   * Nếu connection ngắt trước → giữ retry count → backoff tăng dần.
   */
  static _scheduleStableReset() {
    if (this._stableResetTimer) clearTimeout(this._stableResetTimer);
    this._stableResetTimer = setTimeout(() => {
      this._stableResetTimer = null;
      if (this._connected) {
        const wasRetrying = this._retryCount > 0;
        this._retryCount = 0;
        if (wasRetrying) {
          console.log('[SSE] Connection stable, reset retry counter');
        }
      }
    }, this._STABLE_THRESHOLD);
  }

  static _clearStableReset() {
    if (this._stableResetTimer) {
      clearTimeout(this._stableResetTimer);
      this._stableResetTimer = null;
    }
  }

  /**
   * Schedule reconnect với exponential backoff + jitter
   * Jitter tránh thundering herd khi server restart (tất cả clients reconnect cùng lúc)
   */
  static _scheduleReconnect() {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend, no reconnect */ return; }
    if (this._reconnectTimer) return; // Đã có timer

    this._retryCount++;
    if (this._retryCount > this._MAX_RETRIES) {
      console.warn('[SSE] Đã vượt quá ' + this._MAX_RETRIES + ' lần retry liên tiếp, dừng reconnect. Sẽ thử lại khi focus/visibility.');
      window.eventBus?.emit('sse:gave_up');
      return;
    }

    // Exponential backoff: 2s, 4s, 8s, 16s, 30s, 30s...
    const baseDelay = Math.min(this._BASE_DELAY * Math.pow(2, this._retryCount - 1), this._MAX_DELAY);
    // Random jitter 0-2s để tránh thundering herd khi server restart
    const jitter = Math.random() * 2000;
    const delay = baseDelay + jitter;
    // Track reconnect event for monitoring (getReconnectStats)
    this._totalReconnects++;
    this._lastReconnectAt = Date.now();
    // Cộng dồn uptime của session trước khi reconnect
    if (this._lastConnectedAt) {
      this._connectionUptime += (Date.now() - this._lastConnectedAt);
      this._lastConnectedAt = null;
    }
    console.log('[SSE] Reconnect sau ' + (delay / 1000).toFixed(1) + 's (base: ' + (baseDelay / 1000) + 's + jitter: ' + (jitter / 1000).toFixed(1) + 's, retry #' + this._retryCount + ', total reconnects: ' + this._totalReconnects + ')');

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Start client-side heartbeat check
   * Nếu không nhận được message/heartbeat trong HEARTBEAT_TIMEOUT → force reconnect
   */
  static _startHeartbeatCheck() {
    this._stopHeartbeatCheck();
    this._heartbeatCheckTimer = setInterval(() => {
      if (!this._connected) return;

      // [Audit fix 2026-05-23] Mercure mode: heartbeat là SSE comment `:` → EventSource.onmessage
      // KHÔNG fire → _lastHeartbeat không update → false positive timeout. TCP connection tự
      // maintain qua Caddy `heartbeat` directive (15s) + EventSource native auto-reconnect khi drop.
      // Trust EventSource.readyState thay vì _lastHeartbeat timer.
      if (this._mode === 'mercure') {
        const rs = this._eventSource?.readyState;
        if (rs === 2 /* CLOSED */) {
          console.warn('[Mercure] EventSource CLOSED, schedule reconnect...');
          this._connected = false;
          window.eventBus?.emit('sse:disconnected');
          window.SseBroadcastManager?.broadcastSseStatus('disconnected');
          this._scheduleReconnect();
        }
        return;
      }

      const elapsed = Date.now() - this._lastHeartbeat;
      if (elapsed > this._HEARTBEAT_TIMEOUT) {
        console.warn('[SSE] Heartbeat timeout (' + (elapsed / 1000) + 's), force reconnect...');
        window.eventBus?.emit('sse:heartbeat_timeout');
        this._closeEventSource();
        this._connected = false;
        window.eventBus?.emit('sse:disconnected');
        window.SseBroadcastManager?.broadcastSseStatus('disconnected');
        this._scheduleReconnect();
      }
    }, 10000); // Check mỗi 10s
  }

  /**
   * Stop heartbeat check timer
   */
  static _stopHeartbeatCheck() {
    if (this._heartbeatCheckTimer) {
      clearInterval(this._heartbeatCheckTimer);
      this._heartbeatCheckTimer = null;
    }
  }

  /**
   * Ngắt kết nối SSE — chỉ gọi khi logout hoặc force_logout
   * Gọi API end-session để xóa session Redis ngay lập tức,
   * không đợi server detect connection_aborted (có thể mất 15s+ do BLPOP).
   */
  static disconnect() {
    // Chỉ leader mới cần gọi end-session
    if (!window.SseBroadcastManager?.isInitialized() || window.SseBroadcastManager.isLeader()) {
      // Gọi API end-session để xóa Redis session ngay lập tức
      // Fire-and-forget, không cần chờ response
      this._endSessionOnServer();
    }

    // Destroy BroadcastManager
    window.SseBroadcastManager?.destroy();

    this._closeEventSource();
    this._stopHeartbeatCheck();
    this._clearStableReset();
    // [SSE Phase 1] Cleanup polling timer nếu đang polling mode
    this._stopPolling();
    // [SSE Phase 2] Clear Mercure token cache (user logout → JWT invalid cho next login)
    this._mercureToken = null;
    this._mercureFetchInFlight = null;
    // [Audit fix Finding 2 2026-05-23] Reset no_mercure cache — user mới login có thể là paid plan
    this._noMercureUntil = 0;
    // [Audit fix Finding 16 2026-05-23] Reset transport switch debounce
    this._switchScheduled = false;
    // [Audit fix re-audit Finding 2 2026-05-23] Clear ring buffer event IDs — user mới relevant
    this._recentEventIds = [];
    // [Audit fix 2026-05-23] Reset _mode về 'sse' default để getMode() chính xác sau disconnect/relogin.
    // Trước fix: _connectMercure set _mode='mercure' nhưng disconnect() KHÔNG reset → getMode() trả stale.
    this._mode = 'sse';
    this._mercureConnFailStreak = 0; // [Fallback] reset streak khi disconnect chủ ý
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._connecting = false;
    this._retryCount = 0; // Reset backoff khi disconnect chủ ý
    // [Audit fix Finding 2] Bump generation → cancel bất kỳ _connectMercure async callback đang chờ
    // (orphan connection prevention).
    this._connectGen++;
    // [Audit fix Finding 5] Gỡ eventBus listeners TRƯỚC khi reset flag → tránh leak accumulate.
    // Reset flag để lần connect() kế tiếp re-register cleanly (không double-register vì đã off()).
    this._teardownRoleChangeListener();
    this._roleListenerSetup = false;
    if (this._connected) {
      this._connected = false;
      console.log('[SSE] Đã ngắt kết nối');
      window.eventBus?.emit('sse:disconnected');
    }
  }

  /**
   * Gọi API end-session để xóa SSE session trên server
   * Fire-and-forget, không block disconnect flow
   *
   * LƯU Ý: AuthManager.logout() đã gọi end-session TRƯỚC khi xóa token,
   * nên method này chủ yếu là backup cho các case khác (force_logout từ server, etc.)
   *
   * CRITICAL: KHÔNG dùng authManager._apiCall() vì nó có auto-retry logic khi gặp 401
   * → retry gọi refreshToken() → fail → emit auth:logout → gọi disconnect() lại → infinite loop!
   * Thay vào đó dùng chrome.runtime.sendMessage trực tiếp.
   */
  static _endSessionOnServer() {
    const token = window.authManager?.token;
    // Nếu không có token, skip - AuthManager.logout() hoặc external logout đã xử lý
    if (!token) {
      console.log('[SSE] Skip _endSessionOnServer: không có token');
      return;
    }

    // Fire-and-forget, dùng chrome.runtime.sendMessage trực tiếp để tránh retry loop
    chrome.runtime.sendMessage({
      action: 'apiRequest',
      method: 'POST',
      endpoint: 'sse/end-session',
      data: null,
      token: token
    }, (response) => {
      if (chrome.runtime.lastError) {
        // Silent fail
        return;
      }
      if (response?.success) {
        console.log('[SSE] end-session backup thành công');
      }
      // Silent fail nếu 401 - đã được xử lý bởi caller
    });
  }

  /**
   * Đóng EventSource mà không emit event
   */
  static _closeEventSource() {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
  }

  /**
   * Kiểm tra đang kết nối hay không
   * Follower mode: connected qua BroadcastChannel (không có eventSource)
   * Leader mode: connected trực tiếp qua SSE
   */
  static isConnected() {
    // Follower mode: dựa vào _connected flag (nhận events qua BroadcastChannel)
    if (window.SseBroadcastManager?.isInitialized() && !window.SseBroadcastManager.isLeader()) {
      return this._connected;
    }
    // [Audit fix Finding 7] Active polling leader (_eventSource===null) vẫn "connected" — nhận events
    // qua GET /events/poll. Trước fix: return false → focus/visibility forceReconnect() fire POST
    // sse/ticket → 403 (free user) → feed 429 cooldown. Coi polling leader là connected.
    if (this._mode === 'polling' && this._pollingTimer) {
      return this._connected;
    }
    // Leader mode hoặc không có BroadcastManager: kiểm tra eventSource
    return this._connected && this._eventSource?.readyState === EventSource.OPEN;
  }

  /**
   * Force reconnect — gọi khi user focus hoặc visibility change
   * Reset retry count để thử lại từ đầu
   */
  static forceReconnect() {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend */ return; }
    if (this.isConnected()) return;
    if (this._connecting) return;
    if (!true) return;

    // [Fix storm 429] Tôn trọng cooldown rate-limit CHUNG của AuthManager (_rateLimitedUntil) — cùng
    // cooldown mà upload template / mọi request 429 set. Nếu đang trong cửa sổ "wait Ns": KHÔNG reset
    // backoff + thử lại (focus-spam phớt lờ "wait" → storm 429 → đơ). Để backoff exponential tự
    // reconnect khi cooldown hết. KHÔNG bị rate-limit → chạy y như cũ (realtime không đổi).
    const rateLimitedUntil = window.authManager?._rateLimitedUntil || 0;
    if (rateLimitedUntil > Date.now()) {
      console.log('[SSE] forceReconnect skip — đang cooldown rate-limit ' + Math.ceil((rateLimitedUntil - Date.now()) / 1000) + 's');
      return;
    }

    // Reset backoff để thử ngay
    this._retryCount = 0;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._closeEventSource();
    this.connect();
  }

  /**
   * Xử lý message từ SSE
   */
  /**
   * [Audit fix re-audit Finding 2 2026-05-23] Track event ID đã deliver vào ring buffer.
   * Dùng để dedupe cross-channel (Mercure stream + prime poll Redis drain).
   */
  static _trackEventId(eventId) {
    if (!eventId) return;
    if (this._recentEventIds.includes(eventId)) return;
    this._recentEventIds.push(eventId);
    if (this._recentEventIds.length > this._RECENT_EVENT_IDS_MAX) {
      this._recentEventIds.shift();
    }
  }

  static _handleMessage(e) {
    // Lưu last event ID
    if (e.lastEventId) {
      this._lastEventId = e.lastEventId;
      chrome.storage.local.set({ af_sse_last_event_id: e.lastEventId });
      this._trackEventId(e.lastEventId);
    }

    // Skip empty data
    if (!e.data || e.data.trim() === '') {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(e.data);
    } catch (err) {
      console.warn('[SSE] Lỗi parse JSON:', err.message, '| Raw:', e.data);
      return;
    }

    // [Audit fix Finding 6] Dedupe TRƯỚC khi emit — sau Mercure reconnect, prime-poll + Last-Event-ID
    // replay có thể deliver lại event đã xử lý (cùng envelope UUID). Nếu đã thấy id này → skip emit
    // (vẫn track new ids bên dưới). Tránh double-emit handler (vd double notification / config reload).
    if (payload?.id && this._recentEventIds.includes(payload.id)) {
      return;
    }
    // Track payload.id ngoài e.lastEventId — envelope UUID (cùng Redis path)
    if (payload?.id) this._trackEventId(payload.id);

    const eventName = payload.event || 'unknown';

    // Heartbeat events - chỉ để keep connection alive, không cần xử lý
    if (eventName === 'heartbeat') {
      // _lastHeartbeat đã được update ở onmessage handler
      return;
    }

    console.log('[SSE] Event:', eventName, payload.data);

    // SAFEGUARD: Ignore session_replaced nếu nhận trong 3s đầu sau connect
    // Đây là stale event từ replay queue, không phải session thực sự bị replace
    if (eventName === 'session_replaced') {
      const timeSinceConnect = Date.now() - this._connectedAt;
      if (timeSinceConnect < 3000) {
        console.log('[SSE] Bỏ qua stale session_replaced event (received ' + timeSinceConnect + 'ms sau connect)');
        return;
      }
    }

    // Forward event đến followers qua BroadcastChannel (leader only)
    window.SseBroadcastManager?.forwardSseEvent(eventName, payload.data);

    // Emit event - wrap trong try/catch riêng để lỗi handler không crash SSE
    try {
      window.eventBus?.emit(`sse:${eventName}`, payload.data);
    } catch (err) {
      console.warn('[SSE] Lỗi trong event handler:', eventName, err.message);
    }

    // Handle notification events
    this._handleNotificationEvents(eventName, payload.data);

    // Handle provider config events
    this._handleProviderConfigEvents(eventName, payload.data);

    // Group B (Initiative 1, 2, 3, 4, 6): Handle config events từ admin updates
    this._handleConfigEvents(eventName, payload.data);
  }

  /**
   * Handle provider config SSE events (DOM Resilience Plan)
   * - provider_config_updated: Admin updated selector hoặc provider status
   */
  static _handleProviderConfigEvents(eventName, data) {
    if (eventName === 'provider_config_updated' || eventName === 'config.updated') {
      if (window.ProviderConfigManager) {
        window.ProviderConfigManager.handleSseUpdate(data);
      }
    }
    // Handle provider metadata update (name, icon, status, sort_order)
    if (eventName === 'provider_updated') {
      console.log('[SSE] provider_updated event received:', data);
      // Refetch ProviderMeta first, then emit event (so listeners get fresh data)
      (async () => {
        try {
          if (window.ProviderMeta?.handleSseUpdate) {
            await window.ProviderMeta.handleSseUpdate(data);
          } else if (window.ProviderMeta?.fetch) {
            // Fallback: just refetch if handleSseUpdate not available
            window.ProviderMeta._cache = null;
            await window.ProviderMeta.fetch();
          }
        } catch (e) {
          console.warn('[SSE] ProviderMeta refetch failed:', e?.message);
        }
        // Emit event AFTER refetch completes
        console.log('[SSE] Emitting provider:updated after refetch');
        window.eventBus?.emit('provider:updated', data);
      })();
    }
  }

  /**
   * Group B: Handle config events từ admin updates → invalidate extension caches.
   *
   * Wired từ backend admin controllers:
   *   - Initiative 1: provider_models_updated (Admin/ProviderModelController)
   *   - Initiative 2: node_types_updated (Admin/WorkflowNodeTypeController)
   *   - Initiative 3: i18n_updated (Group E sẽ wire — placeholder)
   *   - Initiative 4: validation_rules_updated (Admin/SystemSettingsController)
   *   - Initiative 6: default_settings_updated (Admin/DefaultSettingsController)
   */
  static _handleConfigEvents(eventName, data) {
    try {
      switch (eventName) {
        case 'provider_models_updated':
          // Initiative 1: AI models list changed
          if (window.ModelRegistry) {
            window.ModelRegistry.handleSseUpdate(data);
          }
          break;

        case 'provider_voices_updated':
          // Flow Voice Selector: base catalog admin curate → invalidate + re-merge scraped
          if (window.VoiceRegistry) {
            window.VoiceRegistry.handleSseUpdate(data);
          }
          break;

        case 'node_types_updated':
          // Initiative 2: Workflow node types changed — invalidate NodeTemplates cache
          console.log('[SseClient] node_types_updated → invalidate NodeTemplates cache + emit node_types:refreshed', data);
          if (window.NodeTemplates) {
            window.NodeTemplates._serverTypes = null;
            window.NodeTemplates._serverTypesFetchedAt = 0;
          }
          window.eventBus?.emit('node_types:refreshed', data);
          break;

        case 'pa_content_formats_updated':
          // Prompt Assistant content formats changed (admin add/edit/toggle/premium).
          // Reset background cache + báo modal re-render (re-eval is_premium + locked state).
          try { chrome.runtime.sendMessage({ action: 'pa:invalidateFormats' }); } catch (_) { globalThis.SEOSONA_swallow?.('SseClient#onerror', _); }
          window.eventBus?.emit('pa:formats_updated', data);
          break;

        case 'validation_rules_updated':
          // Initiative 4: Global validation rules changed
          if (window.ValidationRules) {
            window.ValidationRules.handleSseUpdate(data);
          }
          break;

        case 'entitlements_changed':
        case 'plan_activated':
          // AI Agent rename (2026-05-30) + entitlements live reload (2026-05-30):
          // Backend Migration B broadcast entitlements_changed khi rename feature key.
          // Refresh FeatureGate để pick up keys mới (ai_agent_enabled) + value change.
          // Note: line 1123 listener cũng handle transport switch (free↔paid) qua _scheduleTransportSwitch.
          if (window.featureGate?.refresh) {
            console.log(`[SseClient] ${eventName} → FeatureGate.refresh()`, data);
            window.featureGate.refresh().catch(err =>
              console.warn('[SseClient] FeatureGate refresh failed:', err?.message)
            );
          }
          // [Creator Page] Affiliate status/can_publish có thể đổi → clear cache eligibility
          // (tránh nút "Xuất bản Template" hiện stale tới 60s sau revoke). Render kế tiếp re-eval.
          if (window.CreatorTemplatePublish) window.CreatorTemplatePublish._eligibleCache = null;
          // [PA] Đổi quyền premium → server ẩn/hiện structure_prompt khác → invalidate formats cache để re-fetch.
          try { chrome.runtime.sendMessage({ action: 'pa:invalidateFormats' }); } catch (_) { globalThis.SEOSONA_swallow?.('SseClient#onerror', _); }
          break;

        case 'default_settings_updated':
          // Initiative 6: Admin defaults changed — reload server defaults cho StorageSettings
          if (window.storageSettings?._loadServerDefaults) {
            window.storageSettings._loadServerDefaults();
          }
          // Image-to-Prompt + Prompt Assistant: xoá cache config ở background (cùng endpoint
          // default-settings). Handler i2p:invalidateConfig clear cả _i2pConfigCache + _paConfigCache.
          try { chrome.runtime?.sendMessage?.({ action: 'i2p:invalidateConfig' }, () => void chrome.runtime?.lastError); } catch (_) { globalThis.SEOSONA_swallow?.('SseClient#onerror', _); }
          window.eventBus?.emit('default_settings:refreshed', data);
          break;

        case 'i18n_updated':
          // Initiative 3: Translations changed (Group E sẽ wire dynamic load)
          // 2026-05-25: Debounce reload — coalesce burst events (vd Mercure prime poll
          // drain 20 missed events → 20 reload spam → 60+ HTTP calls + cascade log).
          // Invalidate vẫn fire mỗi event (lightweight cache clear), chỉ debounce reload.
          if (window.I18n?.invalidate && data?.locale) {
            window.I18n.invalidate(data.locale);
            if (this._i18nReloadTimer) clearTimeout(this._i18nReloadTimer);
            this._i18nReloadTimer = setTimeout(() => {
              this._i18nReloadTimer = null;
              window.I18n.reload?.();
            }, 500);
          }
          break;
      }
    } catch (err) {
      console.warn('[SseClient] _handleConfigEvents error:', err.message);
    }
  }

  /**
   * Handle notification-related SSE events
   * - notification.new: New notification received, show overlay if workflow_shared
   * - notification.count_updated: Badge count changed
   * - workflow.share_accepted/rejected/revoked: Share status changes
   */
  static _handleNotificationEvents(eventName, data) {
    try {
      switch (eventName) {
        case 'notification.new':
          // Show overlay for workflow_shared notifications (chuông thông báo đã gỡ →
          // bỏ emit notification:new; giữ show_shared_overlay vì SharedWorkflowOverlay còn nghe).
          if (data?.type === 'workflow_shared') {
            window.eventBus?.emit('notification:show_shared_overlay', data);
          }
          break;

        // (notification.count_updated đã gỡ — badge chuông không còn subscriber)

        case 'workflow.share_accepted':
          // Share request was accepted
          window.eventBus?.emit('workflow:share_accepted', data);
          break;

        case 'workflow.share_rejected':
          // Share request was rejected
          window.eventBus?.emit('workflow:share_rejected', data);
          break;

        case 'workflow.share_revoked':
          // Share access was revoked
          window.eventBus?.emit('workflow:share_revoked', data);
          break;
      }
    } catch (err) {
      console.warn('[SSE] Error in notification handler:', eventName, err.message);
    }
  }

  /**
   * Lấy one-time ticket từ backend
   * [SSE Phase 1 2026-05-23] Detect 403 SSE_REQUIRES_PAID → switch sang polling mode.
   */
  static async _getTicket() {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend */ return null; }
    try {
      console.log('[SSE] Đang lấy ticket...');
      const resp = await ApiClient.request('POST', 'sse/ticket');
      if (resp?.ticket) {
        console.log('[SSE] Đã lấy được ticket');
        return resp.ticket;
      }
      console.warn('[SSE] Response không có ticket:', (() => { try { return JSON.stringify(resp); } catch { return String(resp); } })());
      return null;
    } catch (err) {
      console.warn('[SSE] Lấy ticket thất bại:', err.message, err);
      // [SSE Phase 1] Free user + extension version mới (1.1.4+) → backend reject 403
      // với code SSE_REQUIRES_PAID + data.fallback_url. Switch sang polling mode.
      const serverData = err.serverData || {};
      const isSseRequiresPaid = err.code === 'SSE_REQUIRES_PAID' ||
                                serverData.fallback_url === '/api/v1/events/poll';
      if (err.httpStatus === 403 && isSseRequiresPaid) {
        const interval = serverData.fallback_interval_ms || 30000;
        console.log('[SSE] Free user — switch sang polling mode, interval:', interval, 'ms');
        return 'POLLING_REQUIRED:' + interval;
      }
      // Auth error (401/403 thông thường) → return special value to stop reconnect
      if (err.httpStatus === 401 || err.httpStatus === 403 || err.code === 'UNAUTHENTICATED') {
        return 'AUTH_ERROR';
      }
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // [SSE Phase 2 2026-05-23] Mercure Hub subscriber methods
  // Backend GET /api/v1/sse/subscribe-token → JWT 2h TTL → connect EventSource Mercure.
  // Mercure URL: http://localhost:8080/.well-known/mercure?topic=users/{id}/*&topic=broadcast/*&authorization={jwt}
  // Mercure SSE protocol giống native SSE → reuse `_handleMessage` + heartbeat + reconnect logic.
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Fetch Mercure subscriber JWT từ backend. Cache trong memory + refresh khi gần hết hạn.
   * @returns {Promise<object|'MERCURE_UNAVAILABLE'|null>}
   *   - object {token, hub_url, topics, expires_at_ms}: Mercure enabled, có token valid
   *   - 'MERCURE_UNAVAILABLE': backend trả 503 MERCURE_DISABLED → fallback legacy SSE
   *   - null: lỗi network/unknown → caller decide retry
   */
  static async _getMercureToken() {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend */ return 'MERCURE_UNAVAILABLE'; }
    // [Audit fix Finding 2 2026-05-23] Skip nếu đã cache "no_mercure" decision (free user / pre-Phase2 backend).
    // Cache cleared khi plan upgrade (sse:plan_activated → _scheduleTransportSwitch) hoặc logout.
    if (this._noMercureUntil > Date.now()) {
      return 'MERCURE_UNAVAILABLE';
    }

    // Cache hit — token còn valid (refresh trước 15 phút expiry)
    if (this._mercureToken && this._mercureToken.expires_at_ms - Date.now() > 15 * 60 * 1000) {
      return this._mercureToken;
    }

    // Dedupe concurrent fetch
    if (this._mercureFetchInFlight) {
      return this._mercureFetchInFlight;
    }

    this._mercureFetchInFlight = (async () => {
      try {
        const resp = await ApiClient.request('GET', 'sse/subscribe-token');
        if (!resp?.token || !resp?.hub_url) {
          console.warn('[Mercure] Response không có token/hub_url:', (() => { try { return JSON.stringify(resp); } catch { return String(resp); } })());
          return null;
        }
        const expiresInSec = resp.expires_in || 7200;
        this._mercureToken = {
          token: resp.token,
          hub_url: resp.hub_url,
          topics: resp.topics || [],
          expires_at_ms: Date.now() + (expiresInSec * 1000),
        };
        console.log('[Mercure] Subscriber token cached, expires in', expiresInSec, 's');
        return this._mercureToken;
      } catch (err) {
        // [Audit fix Finding 14 2026-05-23] 404 = backend Phase 2 chưa deploy (route absent)
        // → coexist với rollout phase. Cache 5 phút để skip noisy retry.
        if (err.httpStatus === 404) {
          console.log('[Mercure] Endpoint 404 (backend Phase 2 chưa deploy) → fallback legacy SSE');
          this._noMercureUntil = Date.now() + 5 * 60 * 1000; // 5 phút
          return 'MERCURE_UNAVAILABLE';
        }
        // 503 MERCURE_DISABLED → Mercure chưa setup VPS → fallback legacy SSE
        const isDisabled = err.httpStatus === 503 ||
                           err.code === 'MERCURE_DISABLED' ||
                           err.serverData?.code === 'MERCURE_DISABLED';
        if (isDisabled) {
          console.log('[Mercure] Hub chưa enable trên VPS → fallback legacy SSE');
          this._noMercureUntil = Date.now() + 5 * 60 * 1000; // 5 phút
          return 'MERCURE_UNAVAILABLE';
        }
        // [Audit fix Finding 2 2026-05-23] 403 SSE_REQUIRES_PAID = free user — cache 15 phút.
        // Cleared khi plan_activated → _scheduleTransportSwitch reset _noMercureUntil=0.
        const isRequiresPaid = err.httpStatus === 403 &&
                               (err.code === 'SSE_REQUIRES_PAID' ||
                                err.serverData?.code === 'SSE_REQUIRES_PAID');
        if (isRequiresPaid) {
          console.log('[Mercure] Free user — cache no_mercure, fallback /sse/ticket sẽ trigger polling');
          this._noMercureUntil = Date.now() + 15 * 60 * 1000; // 15 phút
          return 'MERCURE_UNAVAILABLE';
        }
        // 401/Auth error → caller fallback legacy (_getTicket cũng sẽ return AUTH_ERROR)
        console.warn('[Mercure] Fetch token failed:', err.message);
        return null;
      } finally {
        this._mercureFetchInFlight = null;
      }
    })();

    return this._mercureFetchInFlight;
  }

  /**
   * Connect EventSource đến Mercure Hub. Reuse existing `_handleMessage` + heartbeat.
   * Subscribe topics: users/{userId}/{event} + broadcast/{event} — URI Template RFC 6570.
   * Mercure KHÔNG support `*` wildcard (literal match) — phải dùng `{var}` để match mọi value segment.
   */
  static _connectMercure(tokenInfo) {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend */ return; }
    this._mode = 'mercure';

    // Build URL với topics + authorization query param.
    // Lưu ý: EventSource KHÔNG support custom header → phải dùng query param `authorization` (Mercure spec).
    // M5 TODO: query-param JWT leaks into proxy/history/logs. Prefer setting the
    // `mercureAuthorization` cookie (Mercure supports cookie auth) and drop the
    // `authorization` query param once the cookie flow is wired server-side.
    const url = new URL(tokenInfo.hub_url);
    (tokenInfo.topics || []).forEach((t) => url.searchParams.append('topic', t));
    url.searchParams.append('authorization', tokenInfo.token);

    // [Audit fix Finding 2] Capture generation TRƯỚC async get — disconnect()/became_follower tăng
    // _connectGen → callback dưới đây bail thay vì tạo orphan EventSource.
    const gen = ++this._connectGen;

    // Last event ID replay support (Mercure native)
    chrome.storage.local.get('af_sse_last_event_id', (stored) => {
      // Bail nếu generation stale (disconnect/logout giữa chừng) hoặc không còn logged-in.
      if (gen !== this._connectGen || !true) {
        console.log('[Mercure] Connect canceled (stale gen / disconnected) — skip EventSource');
        return;
      }
      const lastId = stored.af_sse_last_event_id;
      // [Audit fix 2026-05-23] Mercure Hub doc dùng `Last-Event-ID` (kebab) — camelCase có thể bị ignore.
      if (lastId) url.searchParams.append('Last-Event-ID', lastId);

      // M5: log origin + topics only — never the full URL (contains authorization JWT).
      let hubOrigin = '(invalid)';
      try { hubOrigin = new URL(tokenInfo.hub_url).origin; } catch (_) { globalThis.SEOSONA_swallow?.('SseClient#_mercureFetchInFlight', _); }
      console.log('[Mercure] Connecting to hub:', hubOrigin, 'topics:', tokenInfo.topics);
      // Per-attempt flag: phân biệt "chưa từng open" (CORS/unreachable) vs "drop sau khi open"
      // (network blip). Mỗi _connectMercure = 1 closure mới nên flag không leak giữa các lần retry.
      let opened = false;
      // M12: ensure no previous EventSource leaks before opening a new one.
      this._closeEventSource();
      this._eventSource = new EventSource(url.toString());

      this._eventSource.onopen = () => {
        opened = true;
        this._mercureConnFailStreak = 0; // connect thành công → reset streak fallback
        this._connected = true;
        this._connecting = false;
        this._connectedAt = Date.now();
        this._lastConnectedAt = Date.now();    // Monitoring: track current session start
        this._lastHeartbeat = Date.now();
        this._startHeartbeatCheck();
        this._scheduleStableReset();
        console.log('[Mercure] Connected ✓');
        window.eventBus?.emit('sse:connected');
        window.SseBroadcastManager?.broadcastSseStatus('connected');

        // [Audit fix Finding 7 2026-05-23] Prime poll sau khi Mercure connected để drain
        // events miss trong window disconnect (Mercure history config không bắt buộc setup ở VPS).
        // Backend EventPollController LPOP `sse:events:user:{id}` + getReplayEvents từ sorted set.
        // Dual-write Phase 2 đảm bảo events có cả ở Redis (cho replay) + Mercure (cho realtime).
        this._primePollAfterMercureReconnect().catch((e) => {
          console.warn('[Mercure] Prime poll failed (non-fatal):', e?.message || e);
        });
      };

      this._eventSource.onmessage = (e) => {
        this._lastHeartbeat = Date.now();
        this._handleMessage(e); // reuse existing — Mercure event format = SSE chuẩn
      };

      this._eventSource.onerror = () => {
        const state = this._eventSource?.readyState;
        const stateStr = state === 0 ? 'CONNECTING' : state === 1 ? 'OPEN' : state === 2 ? 'CLOSED' : 'UNKNOWN';
        const aliveMs = this._connectedAt ? (Date.now() - this._connectedAt) : 0;
        console.warn(`[Mercure] Error (readyState: ${stateStr}, alive: ${aliveMs}ms), reconnect...`);

        // [Audit fix 2026-05-23] Clear JWT cache trong 2 case:
        //   1. Token gần hết hạn (<60s) → refresh trước expiry
        //   2. Connection drop ngay sau onopen (<5s alive) → likely auth/secret mismatch → tránh reconnect loop với token broken
        const nearExpiry = this._mercureToken?.expires_at_ms - Date.now() < 60000;
        const earlyDrop = aliveMs > 0 && aliveMs < 5000;
        if (nearExpiry || earlyDrop) {
          this._mercureToken = null;
          console.log('[Mercure] Clear JWT cache:', { nearExpiry, earlyDrop, aliveMs });
        }

        // [Fallback] Fail mà CHƯA từng onopen → CORS chặn / hub unreachable / JWT sai. Đếm streak;
        // sau _MERCURE_FAIL_MAX lần liên tiếp → cache no_mercure 5 phút + clear token → connect()
        // kế tiếp degrade sang legacy /sse/stream (ticket flow, thuộc api/* → Laravel CORS cho phép).
        // Nếu ĐÃ open (drop sau đó) → network blip, reset streak, giữ Mercure.
        if (!opened) {
          this._mercureConnFailStreak++;
          if (this._mercureConnFailStreak >= this._MERCURE_FAIL_MAX) {
            console.warn(`[Mercure] ${this._mercureConnFailStreak} lần connect fail (chưa từng open) → degrade legacy SSE 5 phút`);
            this._noMercureUntil = Date.now() + 5 * 60 * 1000;
            this._mercureToken = null;
            this._mercureConnFailStreak = 0;
          }
        } else {
          this._mercureConnFailStreak = 0;
        }

        this._connected = false;
        this._connecting = false;
        this._stopHeartbeatCheck();
        this._clearStableReset();
        window.eventBus?.emit('sse:disconnected');
        window.SseBroadcastManager?.broadcastSseStatus('disconnected');
        this._closeEventSource();
        this._scheduleReconnect();
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // [SSE Phase 1 2026-05-23] Polling fallback methods
  // Leader-only — follower nhận events qua existing BroadcastChannel.
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Switch sang polling mode (fallback khi backend reject SSE cho free user).
   * Chỉ leader tab actually poll, follower vẫn nhận events qua BroadcastChannel.
   */
  static _startPolling(intervalMs = 30000) {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend */ return; }
    if (this._mode === 'polling' && this._pollingTimer) {
      // Đã đang polling — chỉ update interval nếu khác
      this.setPollingInterval(intervalMs);
      return;
    }
    this._mode = 'polling';
    this._pollingInterval = intervalMs;

    // Leader-only polling — follower không cần poll (nhận events qua BroadcastChannel)
    if (window.SseBroadcastManager?.isInitialized() && !window.SseBroadcastManager.isLeader()) {
      console.log('[Polling] Skip — follower tab, leader sẽ poll + forward events');
      this._connected = true;
      window.eventBus?.emit('sse:follower_mode');
      return;
    }

    console.log(`[Polling] Start polling mode, interval ${intervalMs}ms`);
    this._connected = true;
    window.eventBus?.emit('sse:connected');
    window.SseBroadcastManager?.broadcastSseStatus('connected');

    // Poll ngay lập tức + setInterval
    this._pollOnce();
    this._pollingTimer = setInterval(() => this._pollOnce(), this._pollingInterval);
  }

  /**
   * Poll 1 lần — gọi GET /api/v1/events/poll qua apiRequest channel
   * (đi qua background.js → có HMAC + X-Client-Id + X-Ext-Version + rate-limit cooldown).
   */
  static async _pollOnce() {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend */ return; }
    if (this._pollingInProgress) return; // dedupe concurrent
    if (!true) {
      this._stopPolling();
      return;
    }
    // [Audit fix Finding 13] Skip nếu đang trong rate-limit cooldown để tránh log spam + waste
    if (window.authManager?._rateLimitedUntil > Date.now()) {
      console.log('[Polling] Skip — rate limited cooldown active');
      return;
    }
    this._pollingInProgress = true;
    try {
      const since = this._lastEventId || '';
      const endpoint = since ? `events/poll?since=${encodeURIComponent(since)}` : 'events/poll';
      const resp = await ApiClient.request('GET', endpoint);
      const events = resp?.events || resp?.data?.events || [];
      const lastId = resp?.last_event_id || resp?.data?.last_event_id;

      if (events.length > 0) {
        console.log(`[Polling] Received ${events.length} events`);
        events.forEach((ev) => {
          const eventName = ev.event || 'unknown';
          // [Audit fix re-audit Finding 2 2026-05-23] Dedupe — skip event đã deliver qua channel khác
          if (ev.id && this._recentEventIds.includes(ev.id)) return;
          if (ev.id) {
            this._lastEventId = ev.id;
            chrome.storage.local.set({ af_sse_last_event_id: ev.id });
            this._trackEventId(ev.id);
          }
          // Forward đến followers qua BroadcastChannel (leader only)
          window.SseBroadcastManager?.forwardSseEvent(eventName, ev.data);
          // Emit eventBus với prefix sse: (cùng format SSE để consumer không phải đổi)
          try {
            window.eventBus?.emit(`sse:${eventName}`, ev.data);
          } catch (handlerErr) {
            console.warn('[Polling] Handler error:', eventName, handlerErr.message);
          }
          // Re-use existing handlers cho notification + config
          this._handleNotificationEvents(eventName, ev.data);
          this._handleProviderConfigEvents(eventName, ev.data);
          this._handleConfigEvents(eventName, ev.data);
        });
      }
      if (lastId) this._lastEventId = lastId;
    } catch (err) {
      console.warn('[Polling] Fetch failed:', err.message);
      // Nếu 401 → logout, không retry
      if (err.httpStatus === 401) {
        this._stopPolling();
        window.eventBus?.emit('sse:auth_required');
      }
    } finally {
      this._pollingInProgress = false;
    }
  }

  /**
   * [Audit fix Finding 7 2026-05-23] Prime poll sau khi Mercure (re)connect.
   *
   * Mercure native replay yêu cầu Caddy `transport_url=bolt://` + `history_size` config — không
   * bắt buộc setup ở VPS. Để đảm bảo correctness, sau khi Mercure connected, fire 1 poll
   * `/events/poll?since={lastEventId}` để drain events Redis miss trong window disconnect.
   *
   * Dual-write (Phase 2) đảm bảo CẢ Redis + Mercure đều có event → poll drain Redis cho catchup.
   * Dedupe: events Mercure đã deliver thì poll trả về cùng UUID → skip qua check _lastEventId.
   */
  static async _primePollAfterMercureReconnect() {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend */ return; }
    // Đợi 500ms cho Mercure connection stable + lastEventId persist từ first events
    await new Promise((r) => setTimeout(r, 500));
    if (this._mode !== 'mercure') return; // disconnected hoặc switched transport
    if (!true) return;
    if (window.authManager?._rateLimitedUntil > Date.now()) return; // skip nếu đang rate-limited

    try {
      const since = this._lastEventId || '';
      // [Audit fix re-audit Finding 1] prime=1 flag → backend skip registerSession overwrite Mercure marker
      const sincePart = since ? `&since=${encodeURIComponent(since)}` : '';
      const endpoint = `events/poll?prime=1${sincePart}`;
      const resp = await ApiClient.request('GET', endpoint);
      const events = resp?.events || resp?.data?.events || [];
      if (events.length === 0) return;
      let drainedCount = 0;
      events.forEach((ev) => {
        const eventName = ev.event || 'unknown';
        // [Audit fix re-audit Finding 2] Dedupe via ring buffer — Mercure deliver SAME UUID
        // (nhờ SsePublisher build envelope ONCE + MercurePublisher pass envelope.id form field) →
        // _trackEventId đã add khi Mercure stream nhận → prime poll skip duplicate.
        if (ev.id && this._recentEventIds.includes(ev.id)) return;
        if (ev.id) {
          this._lastEventId = ev.id;
          chrome.storage.local.set({ af_sse_last_event_id: ev.id });
          this._trackEventId(ev.id);
        }
        drainedCount++;
        window.SseBroadcastManager?.forwardSseEvent(eventName, ev.data);
        try {
          window.eventBus?.emit(`sse:${eventName}`, ev.data);
        } catch (handlerErr) {
          console.warn('[Mercure] Prime handler error:', eventName, handlerErr.message);
        }
        this._handleNotificationEvents(eventName, ev.data);
        this._handleProviderConfigEvents(eventName, ev.data);
        this._handleConfigEvents(eventName, ev.data);
      });
      if (drainedCount > 0) {
        console.log(`[Mercure] Prime poll: drained ${drainedCount}/${events.length} missed events (rest dedupe'd)`);
      }
    } catch (err) {
      // Non-fatal — Mercure stream vẫn hoạt động, chỉ mất missed events trong window
      console.warn('[Mercure] Prime poll fetch failed:', err.message);
    }
  }

  /**
   * Update polling interval — speedup khi user mở payment modal (3s thay 30s).
   * Restore 30s khi nhận sse:plan_activated hoặc modal đóng.
   * Public API cho consumer (vd app.js payment flow).
   */
  static setPollingInterval(ms) {
    if (this._mode !== 'polling') {
      console.log('[Polling] Not in polling mode, ignore setPollingInterval');
      return;
    }
    if (this._pollingInterval === ms) return;
    this._pollingInterval = ms;
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = setInterval(() => this._pollOnce(), ms);
    }
    console.log(`[Polling] Interval changed to ${ms}ms`);
  }

  /**
   * Stop polling — gọi khi logout hoặc disconnect.
   */
  static _stopPolling() {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
    this._mode = 'sse';
    this._pollingInProgress = false;
  }

  /**
   * Getter — caller check mode để biết extension đang dùng SSE hay polling.
   */
  static getMode() {
    return this._mode; // 'sse' | 'polling'
  }

  /**
   * Lấy base URL từ AuthManager
   * AuthManager lưu apiBaseUrl = 'http://localhost:8080/api/v1'
   * SSE cần base URL không có '/api/v1' để build đúng endpoint
   */
  static _getBaseUrl() {
    // Đọc trực tiếp từ authManager (đã init khi connect được gọi)
    const apiBaseUrl = window.ApiBaseConfig.get();
    // Strip '/api/v1' suffix để lấy base
    return apiBaseUrl.replace(/\/api\/v\d+$/, '');
  }

  /**
   * Setup listener cho role changes từ BroadcastManager
   * Khi role thay đổi (leader ↔ follower), cần connect/disconnect SSE tương ứng
   */
  static _setupRoleChangeListener() {
    if (this._roleListenerSetup) return;
    this._roleListenerSetup = true;

    // [Audit fix Finding 5] Register listeners ONCE với handler refs stored → disconnect() có thể
    // eventBus.off() chúng. Trước fix: disconnect() reset _roleListenerSetup=false nhưng KHÔNG off()
    // → mỗi logout/login cycle accumulate thêm 1 bộ listener (leak → duplicate connect triggers).

    // Khi trở thành leader → connect SSE hoặc resume polling.
    // Bug 29 fix (2026-05-19): Skip nếu đã có EventSource active hoặc đang connecting,
    // tránh duplicate connect khi `became_leader` fire trùng (storage path + BroadcastChannel
    // path race). Backend kill duplicate session bằng `session_replaced` → SSE disconnect cascade.
    this._onBecameLeader = () => {
      if (this._eventSource || this._connecting || this._pollingTimer) {
        console.log('[SSE] Đã connected/connecting/polling, skip duplicate became_leader trigger');
        return;
      }
      // [SSE Phase 1] Nếu đã từng trong polling mode (free user) → resume polling
      // thay vì cố connect SSE (sẽ bị reject 403 lại). Mode preserved trong _mode static.
      if (this._mode === 'polling') {
        console.log('[Polling] Trở thành leader, resume polling...');
        this._startPolling(this._pollingInterval);
        return;
      }
      console.log('[SSE] Trở thành leader, kết nối SSE...');
      this._closeEventSource();
      this._connected = false;
      this.connect();
    };
    window.eventBus?.on('broadcast:became_leader', this._onBecameLeader);

    // [Audit fix Finding 16 2026-05-23] Plan upgrade/downgrade mid-session — switch transport.
    // Free → paid: cần switch polling → Mercure/SSE để nhận realtime.
    // Paid → free (downgrade): cần switch SSE/Mercure → polling.
    // Cả 2 event listen vì plan_activated chỉ fire khi paid, entitlements_changed fire cho mọi đổi.
    this._onPlanActivated = () => this._scheduleTransportSwitch('plan_activated');
    this._onEntitlementsChanged = () => this._scheduleTransportSwitch('entitlements_changed');
    window.eventBus?.on('sse:plan_activated', this._onPlanActivated);
    window.eventBus?.on('sse:entitlements_changed', this._onEntitlementsChanged);

    // Khi trở thành follower → disconnect SSE + stop polling (nếu có)
    this._onBecameFollower = () => {
      console.log('[SSE] Trở thành follower, ngắt SSE/polling...');
      this._closeEventSource();
      // [SSE Phase 1] Stop polling khi trở thành follower — leader mới sẽ poll thay
      // (tránh 2 tab cùng poll race drain events từ Redis list).
      if (this._pollingTimer) {
        clearInterval(this._pollingTimer);
        this._pollingTimer = null;
        this._pollingInProgress = false;
        console.log('[Polling] Stopped — follower mode');
      }
      this._connecting = false;
      // Vẫn coi như connected vì nhận events qua BroadcastChannel
      this._connected = true;
      window.eventBus?.emit('sse:connected');
      window.eventBus?.emit('sse:follower_mode');
    };
    window.eventBus?.on('broadcast:became_follower', this._onBecameFollower);
  }

  /**
   * [Audit fix Finding 5] Gỡ eventBus listeners đã đăng ký ở _setupRoleChangeListener.
   * Gọi trong disconnect() để tránh accumulate listener qua logout/login cycles.
   */
  static _teardownRoleChangeListener() {
    if (this._onBecameLeader) window.eventBus?.off('broadcast:became_leader', this._onBecameLeader);
    if (this._onPlanActivated) window.eventBus?.off('sse:plan_activated', this._onPlanActivated);
    if (this._onEntitlementsChanged) window.eventBus?.off('sse:entitlements_changed', this._onEntitlementsChanged);
    if (this._onBecameFollower) window.eventBus?.off('broadcast:became_follower', this._onBecameFollower);
    this._onBecameLeader = null;
    this._onPlanActivated = null;
    this._onEntitlementsChanged = null;
    this._onBecameFollower = null;
  }

  /**
   * [Audit fix Finding 16 2026-05-23] Schedule reconnect khi plan thay đổi để switch transport.
   *
   * Khi user upgrade free → paid: polling user cần switch sang Mercure/SSE.
   * Khi user downgrade paid → free: SSE/Mercure user cần switch sang polling.
   *
   * Debounce 2s để batch nhiều event (plan_activated + entitlements_changed thường fire cùng lúc).
   * Chỉ leader execute switch — follower nhận status qua BroadcastChannel.
   */
  static _scheduleTransportSwitch(reason) {
    if (this._switchScheduled) {
      console.log(`[SSE] Transport switch đã schedule, skip duplicate trigger (${reason})`);
      return;
    }
    this._switchScheduled = true;
    setTimeout(() => {
      this._switchScheduled = false;
      // Chỉ leader execute switch — follower auto adapt qua BroadcastChannel status update
      if (window.SseBroadcastManager?.isInitialized() && !window.SseBroadcastManager.isLeader()) {
        console.log('[SSE] Skip transport switch — not leader');
        return;
      }
      console.log(`[SSE] Plan changed (${reason}) → switch transport`);
      // Cleanup current connection
      this._closeEventSource();
      this._stopPolling();
      // Clear cached "no_mercure" decision — user có thể đã upgrade
      this._mercureToken = null;
      this._mercureFetchInFlight = null;
      this._noMercureUntil = 0;
      // Reset mode để re-detect (connect() sẽ thử Mercure → SSE → polling đúng order)
      this._mode = 'sse';
      this._connected = false;
      this._connecting = false;
      // Reconnect — connect() flow tự detect transport phù hợp với plan mới
      this.connect();
    }, 2000);
  }
}

window.SseClient = SseClient;
