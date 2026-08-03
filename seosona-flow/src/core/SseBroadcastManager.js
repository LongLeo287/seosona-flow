/**
 * SseBroadcastManager - Quản lý shared SSE connection qua BroadcastChannel
 *
 * Mục tiêu: Giảm số lượng SSE connections từ N (mỗi tab 1 connection) xuống còn 1
 * bằng cách sử dụng BroadcastChannel API để share events giữa các tabs.
 *
 * Roles:
 * - LEADER: Tab giữ SSE connection thực, broadcast events đến followers
 * - FOLLOWER: Tab chỉ listen từ BroadcastChannel, không tạo SSE connection
 *
 * Leader Election:
 * - Tab đầu tiên mở = leader
 * - Khi leader đóng, followers sẽ elect leader mới (tab có timestamp nhỏ nhất)
 */
(function() {
  'use strict';

  class SseBroadcastManager {
    // Constants
    static CHANNEL_PREFIX = 'seosonaflow-sse-';
    static ROLE_LEADER = 'leader';
    static ROLE_FOLLOWER = 'follower';

    // Message types
    static MSG_TAB_ANNOUNCE = 'tab_announce';
    static MSG_TAB_LEAVE = 'tab_leave';
    static MSG_LEADER_HEARTBEAT = 'leader_heartbeat';
    static MSG_LEADER_RESIGN = 'leader_resign';
    static MSG_SSE_EVENT = 'sse_event';
    static MSG_REQUEST_LEADER = 'request_leader';
    static MSG_LEADER_CLAIM = 'leader_claim';
    static MSG_SSE_STATUS = 'sse_status'; // Leader broadcast SSE connection status

    // Phase L: Timing constants via SystemConfig with fallbacks
    static get HEARTBEAT_INTERVAL() { return window.SystemConfig?.getTimeout('broadcast_heartbeat_ms') || 5000; }
    static get LEADER_TIMEOUT() { return window.SystemConfig?.getTimeout('broadcast_leader_timeout_ms') || 10000; }
    static get ELECTION_DELAY() { return window.SystemConfig?.getTimeout('broadcast_election_delay_ms') || 2000; }

    // State
    static _channel = null;
    static _role = null;
    static _tabId = null;
    static _userId = null;
    static _tabTimestamp = null;
    static _tabs = new Map();              // tabId -> { timestamp, role, lastSeen }
    static _heartbeatInterval = null;
    static _leaderCheckInterval = null;
    static _electionTimer = null;
    static _lastLeaderHeartbeat = null;    // Timestamp của heartbeat cuối từ leader
    static _initialized = false;
    static _useFallback = false;
    // Storage-based coordination for sidepanel
    static _storageHeartbeatInterval = null;
    static _storageLeaderCheckInterval = null;
    // [Audit fix Finding 11] Refs cho unload handlers → removeEventListener trong destroy() (tránh
    // leak listener qua init/destroy cycles). Và _storageKeys để destroy() cleanup storage leader keys.
    static _unloadHandler = null;
    static _cleanupStorageUnloadHandler = null;
    static _storageKeys = null;

    /**
     * Khởi tạo BroadcastManager
     * @param {string|number} userId - User ID để tạo channel riêng
     */
    static async init(userId) {
      if (this._initialized) return;
      if (!userId) {
        // 2026-05-25: Demote warn → debug. Race condition expected khi auth:login fire
        // trước user object load xong. Next SSE reconnect sẽ pass userId hợp lệ.
        // KHÔNG phải bug → tránh log noise gây nhầm lẫn.
        if (window.DEBUG) console.debug('[SseBroadcast] Skip init (no userId yet, will retry on next connect)');
        return;
      }

      // Detect sidepanel context - Chrome extension sidepanel sử dụng sidebar.html
      const isSidepanel = window.location?.href?.includes('sidebar.html');
      console.log('[SseBroadcast] Context detection:', {
        href: window.location?.href,
        isSidepanel,
        hasBroadcastChannel: typeof BroadcastChannel !== 'undefined'
      });

      // Chrome sidepanel BroadcastChannel không hoạt động tốt cho LEADER ELECTION giữa các tabs
      // (sidepanel có thể bị suspend khi không focus → election mismatch).
      // Dùng chrome.storage để coordinate leader election thay thế.
      // NHƯNG vẫn tạo BroadcastChannel để FORWARD events tới editor pop-out windows
      // (Bug 21 fix 2026-05-13: editor windows là follower cần nhận events qua BroadcastChannel).
      if (isSidepanel) {
        console.log('[SseBroadcast] Sidepanel detected, dùng chrome.storage cho leader election + BroadcastChannel cho event forwarding');
        this._userId = userId;
        this._tabId = this._generateTabId();
        this._tabTimestamp = Date.now();
        this._initialized = true;
        this._useFallback = true; // Election fallback = chrome.storage based

        // Tạo BroadcastChannel để forward events tới followers (editor pop-out windows)
        if (typeof BroadcastChannel !== 'undefined') {
          const channelName = `${this.CHANNEL_PREFIX}${userId}`;
          try {
            this._channel = new BroadcastChannel(channelName);
            this._channel.onmessage = (e) => this._handleMessage(e.data);
            console.log('[SseBroadcast] BroadcastChannel created for event forwarding (sidepanel leader)');
          } catch (err) {
            console.warn('[SseBroadcast] BroadcastChannel creation failed in sidepanel:', err.message);
          }
        }

        // Dùng chrome.storage để check/claim leader
        await this._initStorageBasedLeader(userId);
        return;
      }

      // Check BroadcastChannel support
      if (typeof BroadcastChannel === 'undefined') {
        console.warn('[SseBroadcast] BroadcastChannel không được hỗ trợ, sử dụng fallback mode');
        this._useFallback = true;
        this._role = this.ROLE_LEADER;
        this._initialized = true;
        return;
      }

      this._userId = userId;
      this._tabId = this._generateTabId();
      this._tabTimestamp = Date.now();

      // Tạo channel với userId để mỗi user có channel riêng (cho event forwarding)
      const channelName = `${this.CHANNEL_PREFIX}${userId}`;

      try {
        this._channel = new BroadcastChannel(channelName);
        this._channel.onmessage = (e) => this._handleMessage(e.data);
      } catch (err) {
        console.warn('[SseBroadcast] Không thể tạo BroadcastChannel, sử dụng fallback mode:', err.message);
        this._useFallback = true;
        this._role = this.ROLE_LEADER;
        this._initialized = true;
        return;
      }

      // Bug 24 fix (2026-05-19): Popup (non-sidepanel) cũng dùng STORAGE-BASED
      // leader election (giống sidepanel) thay vì BroadcastChannel-based election.
      //
      // Lý do: Trước fix popup `_startElection` chỉ chờ 2s setTimeout, trong khi
      // sidebar storage-based check 15s. Khi popup mở, sidebar đang follower của
      // leader cũ đã chết → `_handleTabAnnounce` không respond HEARTBEAT (vì role
      // !== LEADER) → popup tự `_becomeLeader` → connect SSE → sidebar 5s sau
      // detect leader expired → cũng connect SSE → backend `session_replaced`.
      //
      // Sau fix: Cả sidebar + popup dùng cùng storage-based source of truth
      // (`sse_leader_${userId}` + heartbeat). Đảm bảo CHỈ 1 leader tại 1 thời
      // điểm, mọi window khác là follower nhận events qua BroadcastChannel.
      this._initialized = true;
      this._useFallback = true; // Election fallback = storage based
      await this._initStorageBasedLeader(userId);

      // Setup cleanup khi tab đóng — [Finding 11] store ref để destroy() removeEventListener.
      this._unloadHandler = () => this._cleanup();
      window.addEventListener('beforeunload', this._unloadHandler);
      window.addEventListener('unload', this._unloadHandler);

      console.log(`[SseBroadcast] Initialized - tabId: ${this._tabId}, channel: ${channelName}, role: ${this._role}`);
    }

    /**
     * Chrome storage-based leader election cho sidepanel
     * Dùng chrome.storage.local với timestamp để coordinate leader
     * Có random delay để tránh race condition khi nhiều sidebars init cùng lúc
     */
    static async _initStorageBasedLeader(userId) {
      const leaderKey = `sse_leader_${userId}`;
      const heartbeatKey = `sse_leader_heartbeat_${userId}`;
      // [Finding 11] Lưu keys để destroy() có thể cleanup storage leader ngay (tránh re-login bị
      // demote FOLLOWER 15-20s vì stale leader key còn trong storage).
      this._storageKeys = { leaderKey, heartbeatKey };

      // Random delay 0-500ms để tránh race condition
      await new Promise(r => setTimeout(r, Math.random() * 500));

      try {
        const stored = await chrome.storage.local.get([leaderKey, heartbeatKey]);
        const currentLeader = stored[leaderKey];
        const lastHeartbeat = stored[heartbeatKey] || 0;
        const now = Date.now();

        // Leader expired nếu heartbeat > 15s ago
        const leaderExpired = !currentLeader || (now - lastHeartbeat > 15000);

        if (leaderExpired) {
          // Thử claim leader - nhưng check lại sau khi set
          await chrome.storage.local.set({
            [leaderKey]: this._tabId,
            [heartbeatKey]: now
          });

          // Chờ 100ms rồi verify mình vẫn là leader (tránh race)
          await new Promise(r => setTimeout(r, 100));
          const verify = await chrome.storage.local.get([leaderKey]);

          if (verify[leaderKey] === this._tabId) {
            this._role = this.ROLE_LEADER;
            console.log('[SseBroadcast] Storage-based: Claimed leader - tabId:', this._tabId);
            this._startStorageHeartbeat(leaderKey, heartbeatKey);
          } else {
            // Ai đó đã claim trước
            this._role = this.ROLE_FOLLOWER;
            console.log('[SseBroadcast] Storage-based: Lost race, follower mode');
            this._startStorageLeaderCheck(leaderKey, heartbeatKey);
          }
        } else if (currentLeader === this._tabId) {
          // Đã là leader
          this._role = this.ROLE_LEADER;
          this._startStorageHeartbeat(leaderKey, heartbeatKey);
        } else {
          // Follower
          this._role = this.ROLE_FOLLOWER;
          console.log('[SseBroadcast] Storage-based: Follower mode (leader: ' + currentLeader + ')');
          this._startStorageLeaderCheck(leaderKey, heartbeatKey);
        }
      } catch (err) {
        console.warn('[SseBroadcast] Storage-based leader election failed:', err.message);
        this._role = this.ROLE_LEADER; // Fallback to leader
      }

      // Cleanup on unload — [Finding 11] store ref để destroy() removeEventListener.
      this._cleanupStorageUnloadHandler = () => this._cleanupStorageLeader(leaderKey, heartbeatKey);
      window.addEventListener('beforeunload', this._cleanupStorageUnloadHandler);
    }

    static _startStorageHeartbeat(leaderKey, heartbeatKey) {
      if (this._storageHeartbeatInterval) clearInterval(this._storageHeartbeatInterval);

      this._storageHeartbeatInterval = setInterval(async () => {
        if (this._role !== this.ROLE_LEADER) return;
        try {
          await chrome.storage.local.set({
            [leaderKey]: this._tabId,
            [heartbeatKey]: Date.now()
          });
        } catch (e) { /* ignore */ }
      }, 5000);
    }

    static _startStorageLeaderCheck(leaderKey, heartbeatKey) {
      if (this._storageLeaderCheckInterval) clearInterval(this._storageLeaderCheckInterval);

      this._storageLeaderCheckInterval = setInterval(async () => {
        if (this._role === this.ROLE_LEADER) return;
        try {
          const stored = await chrome.storage.local.get([leaderKey, heartbeatKey]);
          const lastHeartbeat = stored[heartbeatKey] || 0;
          const now = Date.now();

          // Leader expired
          if (now - lastHeartbeat > 15000) {
            // Bug 25 fix (2026-05-19): Random delay 0-500ms + VERIFY-after-claim
            // để tránh race khi nhiều windows cùng detect leader expired tại setInterval
            // tick. Trước fix: cả popup + sidebar cùng `set role=LEADER` đồng thời →
            // 2 SSE connection → backend `session_replaced`. Pattern: giống
            // `_initStorageBasedLeader` (line 153-184) verify sau set.
            await new Promise(r => setTimeout(r, Math.random() * 500));

            // Re-check sau random delay — có thể window khác đã claim
            const recheck = await chrome.storage.local.get([leaderKey, heartbeatKey]);
            const recheckHeartbeat = recheck[heartbeatKey] || 0;
            if (Date.now() - recheckHeartbeat <= 15000) {
              // Window khác đã claim trong lúc random delay → skip claim
              return;
            }

            await chrome.storage.local.set({
              [leaderKey]: this._tabId,
              [heartbeatKey]: Date.now()
            });

            // Verify claim thành công (race với window khác cùng set)
            await new Promise(r => setTimeout(r, 100));
            const verify = await chrome.storage.local.get([leaderKey]);
            if (verify[leaderKey] !== this._tabId) {
              // Lost race — window khác là leader bây giờ, giữ vai trò follower
              console.log('[SseBroadcast] Leader claim race lost, staying follower (winner:', verify[leaderKey], ')');
              return;
            }

            console.log('[SseBroadcast] Leader expired, claimed leadership - tabId:', this._tabId);
            this._role = this.ROLE_LEADER;
            this._startStorageHeartbeat(leaderKey, heartbeatKey);

            // Trigger SSE reconnect as new leader
            window.SseClient?.connect();
          }
        } catch (e) { /* ignore */ }
      }, 5000);
    }

    static async _cleanupStorageLeader(leaderKey, heartbeatKey) {
      if (this._storageHeartbeatInterval) clearInterval(this._storageHeartbeatInterval);
      if (this._storageLeaderCheckInterval) clearInterval(this._storageLeaderCheckInterval);

      if (this._role === this.ROLE_LEADER) {
        try {
          const stored = await chrome.storage.local.get([leaderKey]);
          if (stored[leaderKey] === this._tabId) {
            await chrome.storage.local.remove([leaderKey, heartbeatKey]);
          }
        } catch (e) { /* ignore */ }
      }
    }

    /**
     * Kiểm tra đã init chưa
     */
    static isInitialized() {
      return this._initialized;
    }

    /**
     * Lấy role hiện tại
     */
    static getRole() {
      // Nếu đã có _role (từ storage-based election), ưu tiên dùng nó
      if (this._role) return this._role;
      // Fallback mode không có storage election → mặc định leader
      if (this._useFallback) return this.ROLE_LEADER;
      return this._role;
    }

    /**
     * Kiểm tra có phải leader không
     */
    static isLeader() {
      return this.getRole() === this.ROLE_LEADER;
    }

    /**
     * Forward SSE event đến followers (chỉ leader gọi)
     */
    static forwardSseEvent(eventName, data) {
      if (!this.isLeader()) return;
      if (!this._channel) return;

      this._channel.postMessage({
        type: this.MSG_SSE_EVENT,
        payload: { eventName, data },
        from: this._tabId,
        timestamp: Date.now()
      });
    }

    /**
     * Broadcast SSE connection status từ leader đến followers
     * @param {string} status - 'connected', 'disconnected', 'connecting'
     */
    static broadcastSseStatus(status) {
      if (!this.isLeader()) return;
      if (!this._channel) return;

      this._channel.postMessage({
        type: this.MSG_SSE_STATUS,
        payload: { status },
        from: this._tabId,
        timestamp: Date.now()
      });
    }

    /**
     * Cleanup khi user logout
     */
    static destroy() {
      this._cleanup();

      // [Finding 11] Nếu window này là leader → remove storage leader keys NGAY (không đợi 15s
      // heartbeat expire). Trước fix: re-login liền sau logout thấy stale `sse_leader_${userId}` còn
      // trong storage → demote về FOLLOWER 15-20s → SSE realtime chết trong khoảng đó.
      // _cleanupStorageLeader tự check role===LEADER + verify tabId khớp trước khi remove (an toàn).
      if (this._storageKeys) {
        const { leaderKey, heartbeatKey } = this._storageKeys;
        // Fire-and-forget (async) — remove trước khi clear _role/_tabId để check bên trong đúng.
        this._cleanupStorageLeader(leaderKey, heartbeatKey);
        this._storageKeys = null;
      }

      // [Finding 11] Remove unload listeners đã add ở init() / _initStorageBasedLeader.
      if (this._unloadHandler) {
        window.removeEventListener('beforeunload', this._unloadHandler);
        window.removeEventListener('unload', this._unloadHandler);
        this._unloadHandler = null;
      }
      if (this._cleanupStorageUnloadHandler) {
        window.removeEventListener('beforeunload', this._cleanupStorageUnloadHandler);
        this._cleanupStorageUnloadHandler = null;
      }

      this._channel?.close();
      this._channel = null;
      this._role = null;
      this._tabId = null;
      this._userId = null;
      this._tabs.clear();
      this._initialized = false;
      this._useFallback = false;
      console.log('[SseBroadcast] Destroyed');
    }

    // ==================== Private Methods ====================

    /**
     * Generate unique tab ID
     */
    static _generateTabId() {
      return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Bắt đầu election process.
     *
     * Race fix (2026-05-19): Chrome popup window có thể bị throttle setTimeout
     * vài chục giây khi unfocused → `await _startElection()` hang lâu → workflow
     * editor init chain bị block ở `await SseClient.connect()` → user thấy
     * "ko có data". Fix: short-circuit resolve khi `_becomeFollower()` chạy
     * trong lúc đang election (đã nhận LEADER_CLAIM/HEARTBEAT từ leader hiện tại).
     */
    static async _startElection() {
      // Announce presence
      this._broadcast({
        type: this.MSG_TAB_ANNOUNCE,
        tabId: this._tabId,
        timestamp: this._tabTimestamp
      });

      // Chờ xem có leader nào respond không
      return new Promise((resolve) => {
        // Store resolve để `_becomeFollower` short-circuit khi nhận leader claim
        this._electionResolve = resolve;
        this._electionTimer = setTimeout(() => {
          this._electionTimer = null;
          this._electionResolve = null;

          // Nếu chưa có role = không có leader nào respond
          if (!this._role) {
            this._becomeLeader();
          }
          resolve();
        }, this.ELECTION_DELAY);
      });
    }

    /**
     * Trở thành leader.
     *
     * Bug 29 fix (2026-05-19): Idempotent — nếu đã là leader, no-op. Tránh duplicate
     * `Became LEADER` log + duplicate `became_leader` event emit → 2× `SseClient.connect()`
     * → 2 SSE connections → backend `session_replaced`.
     *
     * Trigger duplicate trước fix:
     *   1. Popup unload → broadcast LEADER_RESIGN
     *   2. Sidebar `_handleLeaderResign` → `_requestNewLeader` → `_electLeader` → `_becomeLeader` (1st)
     *   3. Đồng thời `_startStorageLeaderCheck` interval phát hiện expired → claim qua storage path
     *   4. Sau election delay, `_electLeader` chạy lần 2 (tab vẫn match oldest) → `_becomeLeader` (2nd)
     */
    static _becomeLeader() {
      if (this._role === this.ROLE_LEADER) {
        // Already leader — refresh heartbeat broadcast nhưng KHÔNG re-emit became_leader
        // (tránh SseClient.connect() trùng gây session_replaced).
        return;
      }

      const wasFollower = this._role === this.ROLE_FOLLOWER;
      this._role = this.ROLE_LEADER;

      // Clear follower intervals
      if (this._leaderCheckInterval) {
        clearInterval(this._leaderCheckInterval);
        this._leaderCheckInterval = null;
      }

      // Start heartbeat
      this._startHeartbeat();

      // Broadcast claim
      this._broadcast({
        type: this.MSG_LEADER_CLAIM,
        tabId: this._tabId,
        timestamp: this._tabTimestamp
      });

      console.log('[SseBroadcast] Became LEADER');

      // Emit event để SseClient biết
      window.eventBus?.emit('broadcast:became_leader');

      // Nếu trước đó là follower, cần connect SSE
      if (wasFollower) {
        window.eventBus?.emit('broadcast:role_changed', { role: this.ROLE_LEADER });
      }
    }

    /**
     * Trở thành follower
     */
    static _becomeFollower() {
      const wasLeader = this._role === this.ROLE_LEADER;
      this._role = this.ROLE_FOLLOWER;

      // Clear leader intervals
      if (this._heartbeatInterval) {
        clearInterval(this._heartbeatInterval);
        this._heartbeatInterval = null;
      }

      // Race fix (2026-05-19): Short-circuit election nếu đang trong quá trình
      // election. Trước fix: `await _startElection()` chờ ELECTION_DELAY=2s qua
      // setTimeout — bị Chrome throttle khi popup unfocused → init hang vài chục
      // giây → workflow editor "ko có data". Sau fix: receive LEADER_CLAIM →
      // resolve ngay.
      if (this._electionTimer) {
        clearTimeout(this._electionTimer);
        this._electionTimer = null;
      }
      if (this._electionResolve) {
        const resolveFn = this._electionResolve;
        this._electionResolve = null;
        resolveFn();
      }

      // Start checking leader health
      this._startLeaderCheck();

      console.log('[SseBroadcast] Became FOLLOWER');

      // Emit event
      window.eventBus?.emit('broadcast:became_follower');

      // Nếu trước đó là leader, cần disconnect SSE
      if (wasLeader) {
        window.eventBus?.emit('broadcast:role_changed', { role: this.ROLE_FOLLOWER });
      }
    }

    /**
     * Start heartbeat (leader only)
     */
    static _startHeartbeat() {
      if (this._heartbeatInterval) return;

      this._heartbeatInterval = setInterval(() => {
        if (this._role !== this.ROLE_LEADER) return;

        this._broadcast({
          type: this.MSG_LEADER_HEARTBEAT,
          tabId: this._tabId,
          timestamp: Date.now()
        });
      }, this.HEARTBEAT_INTERVAL);

      // Send immediate heartbeat
      this._broadcast({
        type: this.MSG_LEADER_HEARTBEAT,
        tabId: this._tabId,
        timestamp: Date.now()
      });
    }

    /**
     * Start checking leader health (follower only)
     */
    static _startLeaderCheck() {
      if (this._leaderCheckInterval) return;

      this._lastLeaderHeartbeat = Date.now();

      this._leaderCheckInterval = setInterval(() => {
        if (this._role !== this.ROLE_FOLLOWER) return;

        const timeSinceHeartbeat = Date.now() - this._lastLeaderHeartbeat;
        if (timeSinceHeartbeat > this.LEADER_TIMEOUT) {
          console.log('[SseBroadcast] Leader timeout, starting re-election');
          this._requestNewLeader();
        }
      }, this.HEARTBEAT_INTERVAL);
    }

    /**
     * Request new leader election
     */
    static _requestNewLeader() {
      // Clear current leader check
      if (this._leaderCheckInterval) {
        clearInterval(this._leaderCheckInterval);
        this._leaderCheckInterval = null;
      }

      // Broadcast request
      this._broadcast({
        type: this.MSG_REQUEST_LEADER,
        tabId: this._tabId,
        timestamp: this._tabTimestamp
      });

      // Wait for responses, then elect based on timestamp
      setTimeout(() => {
        this._electLeader();
      }, this.ELECTION_DELAY);
    }

    /**
     * Elect leader based on oldest timestamp, tabId as tiebreaker
     */
    static _electLeader() {
      // Find tab with oldest timestamp (including self), tabId as tiebreaker
      let oldestTab = { tabId: this._tabId, timestamp: this._tabTimestamp };

      for (const [tabId, info] of this._tabs) {
        if (info.timestamp < oldestTab.timestamp ||
            (info.timestamp === oldestTab.timestamp && tabId < oldestTab.tabId)) {
          oldestTab = { tabId, timestamp: info.timestamp };
        }
      }

      // If this tab is oldest, become leader
      if (oldestTab.tabId === this._tabId) {
        this._becomeLeader();
      } else {
        // Otherwise wait for the winner to claim
        this._becomeFollower();
      }
    }

    /**
     * Handle incoming message
     */
    static _handleMessage(msg) {
      if (!msg || !msg.type) return;
      if (msg.from === this._tabId) return; // Ignore own messages

      switch (msg.type) {
        case this.MSG_TAB_ANNOUNCE:
          this._handleTabAnnounce(msg);
          break;

        case this.MSG_TAB_LEAVE:
          this._handleTabLeave(msg);
          break;

        case this.MSG_LEADER_HEARTBEAT:
          this._handleLeaderHeartbeat(msg);
          break;

        case this.MSG_LEADER_CLAIM:
          this._handleLeaderClaim(msg);
          break;

        case this.MSG_LEADER_RESIGN:
          this._handleLeaderResign(msg);
          break;

        case this.MSG_SSE_EVENT:
          this._handleSseEvent(msg);
          break;

        case this.MSG_REQUEST_LEADER:
          this._handleRequestLeader(msg);
          break;

        case this.MSG_SSE_STATUS:
          this._handleSseStatus(msg);
          break;
      }
    }

    /**
     * Handle tab announce
     */
    static _handleTabAnnounce(msg) {
      // Register tab
      this._tabs.set(msg.tabId, {
        timestamp: msg.timestamp,
        lastSeen: Date.now()
      });

      // If we're leader, send heartbeat to let new tab know
      if (this._role === this.ROLE_LEADER) {
        this._broadcast({
          type: this.MSG_LEADER_HEARTBEAT,
          tabId: this._tabId,
          timestamp: Date.now()
        });
      }
    }

    /**
     * Handle tab leave
     */
    static _handleTabLeave(msg) {
      this._tabs.delete(msg.tabId);
    }

    /**
     * Handle leader heartbeat
     */
    static _handleLeaderHeartbeat(msg) {
      this._lastLeaderHeartbeat = Date.now();

      // Cancel election if in progress
      if (this._electionTimer) {
        clearTimeout(this._electionTimer);
        this._electionTimer = null;
        this._becomeFollower();
      }

      // Update leader info
      this._tabs.set(msg.tabId, {
        timestamp: msg.timestamp,
        role: this.ROLE_LEADER,
        lastSeen: Date.now()
      });
    }

    /**
     * Handle leader claim
     */
    static _handleLeaderClaim(msg) {
      // Another tab claimed leadership
      if (this._role === this.ROLE_LEADER) {
        // Compare timestamps - older wins, tabId as tiebreaker
        if (msg.timestamp < this._tabTimestamp ||
            (msg.timestamp === this._tabTimestamp && msg.tabId < this._tabId)) {
          // They're older or have lower tabId, we resign
          this._becomeFollower();
        }
        // Otherwise ignore - we're the rightful leader
      } else {
        // We're not leader, just acknowledge
        this._lastLeaderHeartbeat = Date.now();
        if (!this._role) {
          this._becomeFollower();
        }
      }
    }

    /**
     * Handle leader resign
     */
    static _handleLeaderResign(msg) {
      this._tabs.delete(msg.tabId);

      // Start election
      if (this._role === this.ROLE_FOLLOWER) {
        this._requestNewLeader();
      }
    }

    /**
     * Handle SSE event from leader.
     *
     * Bug 26 fix (2026-05-19): Follower phải apply config invalidation giống leader.
     * Trước fix: chỉ emit `sse:${eventName}` raw + handle notification events.
     * → Popup windows (workflow editor, template editor, angles, effects) không
     *   bao giờ nhận admin config updates qua SSE forwarding:
     *   - provider_models_updated, node_types_updated, validation_rules_updated,
     *     default_settings_updated, i18n_updated, provider_config_updated,
     *     system_settings_changed đều skip
     * Sau fix: delegate sang SseClient._handleConfigEvents +
     *   _handleProviderConfigEvents (single source of truth) để invalidate cache
     *   + emit refresh events giống khi leader nhận trực tiếp.
     */
    static _handleSseEvent(msg) {
      if (this._role !== this.ROLE_FOLLOWER) return;

      const { eventName, data } = msg.payload || {};
      if (!eventName) return;

      console.log('[SseBroadcast] Received forwarded SSE event:', eventName);

      try {
        // Emit raw event như khi nhận trực tiếp từ SSE
        window.eventBus?.emit(`sse:${eventName}`, data);

        // Notification events (notification.*, workflow.share_*)
        this._handleForwardedNotificationEvents(eventName, data);

        // Config events (provider_models_updated, node_types_updated, ...)
        // Delegate sang SseClient để giữ single source of truth invalidation logic.
        if (window.SseClient?._handleConfigEvents) {
          window.SseClient._handleConfigEvents(eventName, data);
        }

        // Provider config events (provider_config_updated)
        if (window.SseClient?._handleProviderConfigEvents) {
          window.SseClient._handleProviderConfigEvents(eventName, data);
        }
      } catch (err) {
        console.warn('[SseBroadcast] Error emitting event:', eventName, err.message);
      }
    }

    /**
     * Handle forwarded notification events (same as SseClient._handleNotificationEvents)
     */
    static _handleForwardedNotificationEvents(eventName, data) {
      try {
        switch (eventName) {
          case 'notification.new':
            // Chuông thông báo đã gỡ → bỏ emit notification:new; giữ show_shared_overlay.
            if (data?.type === 'workflow_shared') {
              window.eventBus?.emit('notification:show_shared_overlay', data);
            }
            break;

          // (notification.count_updated đã gỡ — không còn subscriber)

          case 'workflow.share_accepted':
            window.eventBus?.emit('workflow:share_accepted', data);
            break;

          case 'workflow.share_rejected':
            window.eventBus?.emit('workflow:share_rejected', data);
            break;

          case 'workflow.share_revoked':
            window.eventBus?.emit('workflow:share_revoked', data);
            break;
        }
      } catch (err) {
        console.warn('[SseBroadcast] Error in notification handler:', eventName, err.message);
      }
    }

    /**
     * Handle request for new leader
     */
    static _handleRequestLeader(msg) {
      // Register requesting tab
      this._tabs.set(msg.tabId, {
        timestamp: msg.timestamp,
        lastSeen: Date.now()
      });

      // If we're leader, send heartbeat
      if (this._role === this.ROLE_LEADER) {
        this._broadcast({
          type: this.MSG_LEADER_HEARTBEAT,
          tabId: this._tabId,
          timestamp: Date.now()
        });
      }
    }

    /**
     * Handle SSE status broadcast từ leader
     */
    static _handleSseStatus(msg) {
      if (this._role !== this.ROLE_FOLLOWER) return;

      const { status } = msg.payload || {};
      if (!status) return;

      console.log('[SseBroadcast] Received SSE status from leader:', status);

      // Emit appropriate event for UI to handle
      if (status === 'connected') {
        window.eventBus?.emit('sse:connected');
      } else if (status === 'disconnected') {
        window.eventBus?.emit('sse:disconnected');
      } else if (status === 'connecting') {
        window.eventBus?.emit('sse:connecting');
      }
    }

    /**
     * Broadcast message
     */
    static _broadcast(msg) {
      if (!this._channel) return;

      try {
        this._channel.postMessage({
          ...msg,
          from: this._tabId
        });
      } catch (err) {
        console.warn('[SseBroadcast] Broadcast error:', err.message);
      }
    }

    /**
     * Cleanup khi tab đóng
     */
    static _cleanup() {
      // Clear intervals
      if (this._heartbeatInterval) {
        clearInterval(this._heartbeatInterval);
        this._heartbeatInterval = null;
      }
      if (this._leaderCheckInterval) {
        clearInterval(this._leaderCheckInterval);
        this._leaderCheckInterval = null;
      }
      if (this._electionTimer) {
        clearTimeout(this._electionTimer);
        this._electionTimer = null;
      }
      // Cleanup storage-based intervals (sidepanel mode)
      if (this._storageHeartbeatInterval) {
        clearInterval(this._storageHeartbeatInterval);
        this._storageHeartbeatInterval = null;
      }
      if (this._storageLeaderCheckInterval) {
        clearInterval(this._storageLeaderCheckInterval);
        this._storageLeaderCheckInterval = null;
      }

      // Broadcast leave/resign
      if (this._channel) {
        if (this._role === this.ROLE_LEADER) {
          this._broadcast({
            type: this.MSG_LEADER_RESIGN,
            tabId: this._tabId
          });
        } else {
          this._broadcast({
            type: this.MSG_TAB_LEAVE,
            tabId: this._tabId
          });
        }
      }
    }
  }

  window.SseBroadcastManager = SseBroadcastManager;
})();
