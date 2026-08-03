/**
 * RequestCoalescer - Coordinate API requests across popup windows via BroadcastChannel
 *
 * Problem: Multiple popup windows (workflow-editor, angles-editor, effects-editor)
 * can make independent API calls simultaneously → server overload.
 *
 * Solution:
 * - SidePanel acts as LEADER (handles actual API calls)
 * - Popup windows delegate requests to leader via BroadcastChannel
 * - Requests are deduplicated (same endpoint within 500ms = 1 call)
 * - If leader not available, popup falls back to direct call
 *
 * Usage:
 *   const result = await RequestCoalescer.request('GET', 'tasks');
 *   // Instead of: await authManager._apiCall('GET', 'tasks');
 */
(function() {
  'use strict';

  class RequestCoalescer {
    static CHANNEL_NAME = 'seosonaflow-request-coalescer';
    static MSG_REQUEST = 'api_request';
    static MSG_RESPONSE = 'api_response';
    static MSG_LEADER_PING = 'leader_ping';
    static MSG_LEADER_PONG = 'leader_pong';

    static LEADER_TIMEOUT = 500;      // 500ms wait for leader response
    static DEDUP_WINDOW = 500;        // 500ms window for request deduplication
    static get REQUEST_TIMEOUT() { return window.SystemConfig?.getTimeout('api_timeout_ms') || 30000; }

    // State
    static _channel = null;
    static _isLeader = false;
    static _initialized = false;
    static _pendingRequests = new Map();  // requestId -> { resolve, reject, timeout }
    static _recentRequests = new Map();   // cacheKey -> { promise, timestamp }
    static _requestIdCounter = 0;
    // [Audit fix Finding 8] Per-window random id captured once — ngăn requestId collide giữa các
    // window (counter + ms-timestamp có thể trùng). Đưa vào requestId để leader phản hồi đúng window.
    static _windowId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `w_${Math.random().toString(36).slice(2)}_${Date.now()}`;

    /**
     * Initialize the coalescer
     * Call from app.js/sidebar.js (leader) and popup windows (followers)
     */
    static init() {
      if (this._initialized) return;

      // Check BroadcastChannel support
      if (typeof BroadcastChannel === 'undefined') {
        console.warn('[RequestCoalescer] BroadcastChannel not supported, using direct mode');
        this._initialized = true;
        return;
      }

      // Determine if this is leader (sidePanel) or follower (popup)
      this._isLeader = this._detectIsLeader();

      try {
        this._channel = new BroadcastChannel(this.CHANNEL_NAME);
        this._channel.onmessage = (e) => this._handleMessage(e.data);
        this._initialized = true;

        if (this._isLeader) {
          console.log('[RequestCoalescer] Initialized as LEADER (sidePanel)');
        } else {
          console.log('[RequestCoalescer] Initialized as FOLLOWER (popup)');
        }

        // Cleanup on unload
        window.addEventListener('beforeunload', () => this._cleanup());

        // Clear cache on auth events (login/logout) to avoid stale data
        this._setupAuthListeners();
      } catch (err) {
        console.warn('[RequestCoalescer] Failed to create channel:', err.message);
        this._initialized = true;
      }
    }

    /**
     * Setup listeners for auth events to clear cache
     * This prevents stale data after switching accounts
     */
    static _setupAuthListeners() {
      if (!window.eventBus) return;

      window.eventBus.on('auth:login', () => {
        console.log('[RequestCoalescer] Auth login - clearing cache');
        this.clearCache();
      });

      window.eventBus.on('auth:logout', () => {
        console.log('[RequestCoalescer] Auth logout - clearing cache');
        this.clearCache();
      });
    }

    /**
     * Clear all cached data (call on login/logout)
     */
    static clearCache() {
      this._recentRequests.clear();
      // Cancel pending requests
      for (const [id, pending] of this._pendingRequests) {
        clearTimeout(pending.timeout);
      }
      this._pendingRequests.clear();
    }

    /**
     * Bug 59 fix (2026-05-13): Invalidate cache entries match endpoint pattern.
     * Gọi sau khi mutation (POST/PUT/DELETE) thành công để tránh stale read trong
     * dedup window 500ms (e.g. save workflow → executeSingleNode getWorkflow ngay
     * sau → return cached OLD data thay vì fresh từ server).
     *
     * @param {string} endpointPattern - substring match endpoint (e.g. 'workflows/wf_123')
     * @returns {number} count of cache entries invalidated
     */
    static invalidate(endpointPattern) {
      if (!endpointPattern) return 0;
      let count = 0;
      for (const key of Array.from(this._recentRequests.keys())) {
        if (key.includes(endpointPattern)) {
          this._recentRequests.delete(key);
          count++;
        }
      }
      if (count > 0) {
        console.log('[RequestCoalescer] Invalidated', count, 'cache entries for', endpointPattern);
      }
      return count;
    }

    /**
     * Detect if current window is leader (sidePanel) or follower (popup)
     */
    static _detectIsLeader() {
      const path = window.location.pathname;
      // Popups are followers
      const isPopup = path.endsWith('workflow-editor.html') ||
                      path.endsWith('angles-editor.html') ||
                      path.endsWith('effects-editor.html') ||
                      path.endsWith('settings.html');
      return !isPopup;
    }

    /**
     * Make an API request with coalescing
     * @param {string} method - HTTP method
     * @param {string} endpoint - API endpoint
     * @param {Object} data - Request body (optional)
     * @param {Object} options - { skipCoalesce: boolean, extraHeaders: Object }
     * @returns {Promise<any>}
     */
    static async request(method, endpoint, data = null, options = {}) {
      if (!this._initialized) this.init();

      // Skip coalescing for certain requests (mutations that shouldn't be deduplicated)
      const skipCoalesce = options.skipCoalesce ||
                          method !== 'GET' ||
                          endpoint.includes('execution/') ||
                          endpoint.includes('auth/');

      if (skipCoalesce) {
        return this._directRequest(method, endpoint, data, options.extraHeaders);
      }

      // Check dedup cache first (same request within DEDUP_WINDOW)
      const cacheKey = this._getCacheKey(method, endpoint, data);
      const cached = this._recentRequests.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.DEDUP_WINDOW) {
        console.log('[RequestCoalescer] Dedup hit:', cacheKey);
        return cached.promise;
      }

      // Leader: execute directly
      if (this._isLeader || !this._channel) {
        const promise = this._executeAndBroadcast(method, endpoint, data, options.extraHeaders);
        // [Finding 9] Evict cache ngay khi reject → không serve rejected promise cho callers khác
        // trong dedup window.
        promise.catch(() => { this._recentRequests.delete(cacheKey); });
        this._recentRequests.set(cacheKey, { promise, timestamp: Date.now() });
        this._cleanupCache();
        return promise;
      }

      // Follower: delegate to leader
      const promise = this._delegateToLeader(method, endpoint, data, options.extraHeaders);
      // [Finding 9] Evict trên reject (xem trên).
      promise.catch(() => { this._recentRequests.delete(cacheKey); });
      this._recentRequests.set(cacheKey, { promise, timestamp: Date.now() });
      this._cleanupCache();
      return promise;
    }

    /**
     * Generate cache key for deduplication
     */
    static _getCacheKey(method, endpoint, data) {
      return `${method}:${endpoint}:${data ? JSON.stringify(data) : ''}`;
    }

    /**
     * Direct request without coalescing
     */
    static async _directRequest(method, endpoint, data, extraHeaders) {
      if (false?._apiCall) {
        throw new Error('AuthManager not available');
      }
      return ApiClient.request(method, endpoint, data, false, extraHeaders);
    }

    /**
     * Leader: execute request and broadcast response to followers
     */
    static async _executeAndBroadcast(method, endpoint, data, extraHeaders) {
      // [Finding 8] cacheKey (method+endpoint+data) trong broadcast → follower fallback match đúng
      // request thay vì chỉ endpoint+method.
      const cacheKey = this._getCacheKey(method, endpoint, data);
      try {
        const result = await this._directRequest(method, endpoint, data, extraHeaders);
        // Broadcast success to followers (fire-and-forget)
        this._broadcast({
          type: this.MSG_RESPONSE,
          endpoint,
          method,
          cacheKey,
          success: true,
          data: result,
          timestamp: Date.now()
        });
        return result;
      } catch (err) {
        // Broadcast error to followers
        this._broadcast({
          type: this.MSG_RESPONSE,
          endpoint,
          method,
          cacheKey,
          success: false,
          error: { message: err.message, code: err.code, httpStatus: err.httpStatus },
          timestamp: Date.now()
        });
        throw err;
      }
    }

    /**
     * Follower: delegate request to leader
     */
    static async _delegateToLeader(method, endpoint, data, extraHeaders) {
      // First check if leader is alive
      const leaderAlive = await this._pingLeader();
      if (!leaderAlive) {
        console.log('[RequestCoalescer] No leader response, falling back to direct call');
        return this._directRequest(method, endpoint, data, extraHeaders);
      }

      // Send request to leader — [Finding 8] include _windowId để tránh collide cross-window.
      const requestId = `req_${this._windowId}_${++this._requestIdCounter}_${Date.now()}`;
      // [Finding 8] Lưu full cacheKey để fallback match chính xác (method+endpoint+data) thay vì
      // chỉ endpoint+method → tránh resolve nhầm request của window/payload khác.
      const cacheKey = this._getCacheKey(method, endpoint, data);

      return new Promise((resolve, reject) => {
        // Set timeout
        const timeout = setTimeout(() => {
          this._pendingRequests.delete(requestId);
          console.warn('[RequestCoalescer] Request timeout, falling back to direct call');
          // Fallback to direct call
          this._directRequest(method, endpoint, data, extraHeaders)
            .then(resolve)
            .catch(reject);
        }, this.REQUEST_TIMEOUT);

        this._pendingRequests.set(requestId, { resolve, reject, timeout, endpoint, method, cacheKey });

        // Send request to leader
        this._broadcast({
          type: this.MSG_REQUEST,
          requestId,
          method,
          endpoint,
          data,
          extraHeaders,
          timestamp: Date.now()
        });
      });
    }

    /**
     * Ping leader to check if alive
     */
    static _pingLeader() {
      return new Promise((resolve) => {
        if (!this._channel) {
          resolve(false);
          return;
        }

        const pingId = `ping_${Date.now()}`;
        let responded = false;

        const handler = (e) => {
          if (e.data?.type === this.MSG_LEADER_PONG && e.data?.pingId === pingId) {
            responded = true;
            this._channel.removeEventListener('message', handler);
            resolve(true);
          }
        };

        this._channel.addEventListener('message', handler);
        this._broadcast({ type: this.MSG_LEADER_PING, pingId });

        setTimeout(() => {
          if (!responded) {
            this._channel.removeEventListener('message', handler);
            resolve(false);
          }
        }, this.LEADER_TIMEOUT);
      });
    }

    /**
     * Handle incoming broadcast messages
     */
    static _handleMessage(msg) {
      if (!msg?.type) return;

      switch (msg.type) {
        case this.MSG_LEADER_PING:
          // Leader responds to ping
          if (this._isLeader) {
            this._broadcast({ type: this.MSG_LEADER_PONG, pingId: msg.pingId });
          }
          break;

        case this.MSG_REQUEST:
          // Leader handles request from follower
          if (this._isLeader) {
            this._handleFollowerRequest(msg);
          }
          break;

        case this.MSG_RESPONSE:
          // Follower receives response from leader
          if (!this._isLeader) {
            this._handleLeaderResponse(msg);
          }
          break;
      }
    }

    /**
     * Leader: handle request from follower
     * Uses dedup cache to avoid duplicate requests when multiple followers ask for same data
     */
    static async _handleFollowerRequest(msg) {
      const { requestId, method, endpoint, data, extraHeaders } = msg;
      // [Finding 8] cacheKey dùng cả trong dedup lẫn broadcast (fallback match chính xác).
      const cacheKey = this._getCacheKey(method, endpoint, data);

      try {
        // Check dedup cache first to avoid duplicate requests
        const cached = this._recentRequests.get(cacheKey);

        let result;
        if (cached && (Date.now() - cached.timestamp) < this.DEDUP_WINDOW) {
          // Use cached promise - wait for it to resolve
          console.log('[RequestCoalescer] Leader dedup hit for follower request:', cacheKey);
          result = await cached.promise;
        } else {
          // Execute and cache the promise
          const promise = this._directRequest(method, endpoint, data, extraHeaders);
          // [Finding 9] Evict trên reject → không serve rejected promise cho followers khác.
          promise.catch(() => { this._recentRequests.delete(cacheKey); });
          this._recentRequests.set(cacheKey, { promise, timestamp: Date.now() });
          this._cleanupCache();
          result = await promise;
        }

        this._broadcast({
          type: this.MSG_RESPONSE,
          requestId,
          endpoint,
          method,
          cacheKey,
          success: true,
          data: result,
          timestamp: Date.now()
        });
      } catch (err) {
        this._broadcast({
          type: this.MSG_RESPONSE,
          requestId,
          endpoint,
          method,
          cacheKey,
          success: false,
          error: { message: err.message, code: err.code, httpStatus: err.httpStatus },
          timestamp: Date.now()
        });
      }
    }

    /**
     * Follower: handle response from leader
     */
    static _handleLeaderResponse(msg) {
      const { requestId, success, data, error } = msg;

      // Find pending request by requestId
      const pending = this._pendingRequests.get(requestId);
      if (!pending) {
        // May be a broadcast response (not specific to this follower)
        // [Finding 8] Match trên FULL cacheKey (method+endpoint+data) thay vì chỉ endpoint+method →
        // tránh resolve nhầm request khác data cùng endpoint. Fallback endpoint+method nếu broadcast
        // cũ không kèm cacheKey (window chưa update).
        for (const [id, req] of this._pendingRequests) {
          const keyMatch = msg.cacheKey
            ? req.cacheKey === msg.cacheKey
            : (req.endpoint === msg.endpoint && req.method === msg.method);
          if (keyMatch) {
            clearTimeout(req.timeout);
            this._pendingRequests.delete(id);
            if (success) {
              req.resolve(data);
            } else {
              const err = new Error(error?.message || 'Request failed');
              err.code = error?.code;
              err.httpStatus = error?.httpStatus;
              req.reject(err);
            }
            return;
          }
        }
        return;
      }

      clearTimeout(pending.timeout);
      this._pendingRequests.delete(requestId);

      if (success) {
        pending.resolve(data);
      } else {
        const err = new Error(error?.message || 'Request failed');
        err.code = error?.code;
        err.httpStatus = error?.httpStatus;
        pending.reject(err);
      }
    }

    /**
     * Broadcast message to channel
     */
    static _broadcast(msg) {
      if (this._channel) {
        try {
          this._channel.postMessage(msg);
        } catch (err) {
          console.warn('[RequestCoalescer] Broadcast failed:', err.message);
        }
      }
    }

    /**
     * Cleanup old cache entries
     */
    static _cleanupCache() {
      const now = Date.now();
      for (const [key, entry] of this._recentRequests) {
        if (now - entry.timestamp > this.DEDUP_WINDOW * 2) {
          this._recentRequests.delete(key);
        }
      }
    }

    /**
     * Cleanup on unload
     */
    static _cleanup() {
      // Clear pending requests
      for (const [id, pending] of this._pendingRequests) {
        clearTimeout(pending.timeout);
      }
      this._pendingRequests.clear();
      this._recentRequests.clear();

      // Close channel
      if (this._channel) {
        try {
          this._channel.close();
        } catch (_) { globalThis.SEOSONA_swallow?.('RequestCoalescer#handler', _); }
        this._channel = null;
      }
    }

    /**
     * Check if coalescer is ready
     */
    static isReady() {
      return this._initialized;
    }

    /**
     * Check if current window is leader
     */
    static isLeader() {
      return this._isLeader;
    }
  }

  // Export
  window.RequestCoalescer = RequestCoalescer;
})();
