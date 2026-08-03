/**
 * [Phase 5 2026-05-24] ConfigVersionPoller — lightweight version check fallback cho SSE drop.
 *
 * Fetch GET /config/versions (~200B) định kỳ, diff với cached versions, trigger refresh
 * cho modules có version mismatch. Replace focus-driven full refresh + 2-phút interval.
 *
 * Architecture:
 *   - Leader-only polling (multi-tab dedup qua SseBroadcastManager)
 *   - First-init = baseline only (NO refresh storm cold start)
 *   - SSE connected → poll 30 phút (safety net)
 *   - SSE disconnected → poll 5 phút (no realtime fallback)
 *   - SSE event `config_versions_bumped` → instant trigger checkAndRefresh
 *
 * Pattern reference: LocationCache.js (singleton + chrome.storage cache + window bind).
 *
 * Plan: data/plans/SSE_OPTIMIZATION_ARCHITECTURE_PLAN.md Phase 5.2
 */
class ConfigVersionPoller {
  static CACHE_KEY = 'seosona_config_versions';
  static ENDPOINT = 'config/versions';

  // Polling cadence
  static POLL_INTERVAL_SSE_CONNECTED = 30 * 60 * 1000;   // 30 phút — safety net
  static POLL_INTERVAL_SSE_DISCONNECTED = 5 * 60 * 1000; // 5 phút — fallback no realtime

  // Module → handler mapping (resolved at runtime để tránh load-order issues)
  static MODULE_HANDLERS = {
    system_settings: (v) => window.SystemConfig?._updateFromVersion?.(v),
    providers: (v) => window.ProviderConfigManager?._updateFromVersion?.(v),
    provider_models: (v) => window.ModelRegistry?._updateFromVersion?.(v),
    node_types: (v) => window.NodeTemplates?._updateFromVersion?.(v),
    validation_rules: (v) => window.ValidationRules?._updateFromVersion?.(v),
    default_settings: (v) => window.storageSettings?._updateFromVersion?.(v),
    i18n: (v) => window.I18n?._updateFromVersion?.(v),
    user_entitlements: (v) => window.featureGate?._updateFromVersion?.(v),
    // announcement: không có module riêng — AnnouncementManager fetch lazy theo SSE event
  };

  // ───────────────────── State ─────────────────────
  static _versions = null;             // Last known versions {system_settings: N, providers: {flow: M}, ...}
  static _pollingTimer = null;
  static _pollingInterval = ConfigVersionPoller.POLL_INTERVAL_SSE_DISCONNECTED;
  static _isFirstInit = true;          // Polish 4: first call → baseline only
  static _initialized = false;
  static _checkInFlight = false;       // Dedupe concurrent checkAndRefresh
  static _backwardCompatWarned = false;

  // ───────────────────── Public API ─────────────────────

  /**
   * Init: load cached versions, subscribe events, start polling nếu leader.
   * Gọi 1 lần lúc app boot sau StorageSettings.init() + FeatureGate.init().
   */
  static async init() {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend */ return; }
    if (this._initialized) return;
    this._initialized = true;

    try {
      // 1. Load cached versions (nếu có → _isFirstInit = false, behave như subsequent call)
      const cached = await new Promise(resolve => {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return resolve(null);
        chrome.storage.local.get([this.CACHE_KEY], res => resolve(res[this.CACHE_KEY] || null));
      });
      if (cached && typeof cached === 'object' && Object.keys(cached).length > 0) {
        this._versions = cached;
        this._isFirstInit = false;
        console.log('[ConfigVersionPoller] Loaded cached versions', Object.keys(cached).length, 'modules');
      }

      // 2. Subscribe SSE/role events
      this._subscribeEvents();

      // 3. Adjust polling cadence theo SSE state
      this._adjustPollingCadence();

      // 4. Start polling timer nếu là leader (hoặc fallback mode)
      if (this._shouldPoll()) {
        this._startPollingTimer();
        // Cold start: 1 immediate check (catch-up cho version diff trong khi extension offline)
        // Defer 2s để đợi Mercure connect (tránh duplicate refresh khi SSE handle realtime)
        setTimeout(() => this.checkAndRefresh({ trigger: 'init' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ConfigVersionPoller#user_entitlements', _e); }), 2000);
      }
    } catch (e) {
      console.warn('[ConfigVersionPoller] init error:', e.message);
    }
  }

  /**
   * Fetch /config/versions + diff cached → trigger module refresh nếu mismatch.
   * @param {Object} options
   * @param {string} options.trigger — 'init' | 'timer' | 'sse_bumped' | 'sse_connected' | 'focus' | 'manual'
   * @returns {Promise<{baseline?, skipped?, checked?, updated?}>}
   */
  static async checkAndRefresh({ trigger = 'timer' } = {}) {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend */ return { skipped: 'local_mode' }; }
    // Polish 1: skip nếu không phải leader (follower nhận update qua module SSE events)
    if (window.SseBroadcastManager?.isInitialized?.() && !window.SseBroadcastManager.isLeader?.()) {
      return { skipped: 'not_leader' };
    }

    // Dedupe concurrent calls
    if (this._checkInFlight) {
      return { skipped: 'in_flight' };
    }
    this._checkInFlight = true;

    try {
      const remoteVersions = await this._fetchVersions();
      if (!remoteVersions) {
        return { skipped: 'fetch_failed' };
      }

      // Polish 4: first call → save baseline ONLY, NO refresh (tránh refresh storm cold start)
      if (this._isFirstInit && !this._versions) {
        this._versions = remoteVersions;
        await this._persistVersions(remoteVersions);
        this._isFirstInit = false;
        console.log('[ConfigVersionPoller] Baseline saved (first init)', { trigger, modules: Object.keys(remoteVersions).length });
        return { baseline: true, checked: Object.keys(remoteVersions).length };
      }

      // Diff + trigger refresh per module
      const updated = [];
      for (const [module, remoteVersion] of Object.entries(remoteVersions)) {
        const cachedVersion = this._versions?.[module];
        if (this._isVersionMismatch(cachedVersion, remoteVersion)) {
          updated.push(module);
          try {
            await this._dispatchUpdate(module, remoteVersion);
          } catch (e) {
            console.warn(`[ConfigVersionPoller] dispatch ${module} failed:`, e.message);
          }
        }
      }

      // Persist new versions sau khi dispatch xong (module handlers tự update _lastVersion qua meta.version)
      this._versions = remoteVersions;
      await this._persistVersions(remoteVersions);

      if (updated.length > 0) {
        console.log(`[ConfigVersionPoller] ${trigger} → updated:`, updated);
      }

      return { checked: Object.keys(remoteVersions).length, updated };
    } catch (e) {
      console.warn('[ConfigVersionPoller] checkAndRefresh error:', e.message);
      return { skipped: 'error', error: e.message };
    } finally {
      this._checkInFlight = false;
    }
  }

  /**
   * Admin override polling interval (vd qua /admin/system-settings).
   */
  static setPollingInterval(ms) {
    this._pollingInterval = ms;
    if (this._pollingTimer) {
      this._startPollingTimer(); // Restart với interval mới
    }
  }

  // ───────────────────── Internals ─────────────────────

  /**
   * Fetch /config/versions qua background.js apiRequest channel (inherit HMAC + X-Ext-Version).
   * Backward compat: 404 (endpoint chưa deploy) → log warn + return null.
   */
  static async _fetchVersions() {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend */ return null; }
    return new Promise((resolve) => {
      let settled = false;
      const TIMEOUT_MS = 8000;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        console.warn('[ConfigVersionPoller] fetch timeout');
        resolve(null);
      }, TIMEOUT_MS);

      try {
        chrome.runtime.sendMessage({
          action: 'apiRequest',
          method: 'GET',
          endpoint: this.ENDPOINT,
        }, (resp) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);

          if (chrome.runtime.lastError) {
            console.warn('[ConfigVersionPoller] runtime error:', chrome.runtime.lastError.message);
            return resolve(null);
          }
          // 404 backward compat: backend chưa deploy /config/versions
          if (resp?.error?.httpStatus === 404 || resp?.httpStatus === 404) {
            if (!this._backwardCompatWarned) {
              console.warn('[ConfigVersionPoller] /config/versions 404 — backend chưa deploy Phase 5.1, skip polling (backward compat)');
              this._backwardCompatWarned = true;
            }
            return resolve(null);
          }
          if (resp?.success && resp?.data && typeof resp.data === 'object') {
            return resolve(resp.data);
          }
          console.warn('[ConfigVersionPoller] invalid response:', resp?.error?.message || 'no data');
          resolve(null);
        });
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.warn('[ConfigVersionPoller] fetch error:', e.message);
        resolve(null);
      }
    });
  }

  /**
   * Diff version. Support cả scalar (number) lẫn object (providers/i18n per-key map).
   */
  static _isVersionMismatch(cached, remote) {
    if (cached === undefined || cached === null) return true; // First time seeing module → trigger
    if (typeof cached !== typeof remote) return true;

    if (typeof remote === 'object' && remote !== null) {
      // Per-key map (vd providers: {flow: 158, chatgpt: 89}, i18n: {vi: 567, en: 543})
      const keys = new Set([...Object.keys(cached || {}), ...Object.keys(remote || {})]);
      for (const k of keys) {
        if (cached?.[k] !== remote?.[k]) return true;
      }
      return false;
    }
    return cached !== remote;
  }

  /**
   * Dispatch update tới module handler. Handler tự fetch fresh với {force: true}.
   */
  static async _dispatchUpdate(module, remoteVersion) {
    const handler = this.MODULE_HANDLERS[module];
    if (!handler) {
      // Unknown module (vd announcement) — skip silently
      return;
    }
    await handler(remoteVersion);
  }

  /**
   * Subscribe SSE + role events.
   */
  static _subscribeEvents() {
    if (!window.eventBus) return;

    // SSE connected → 1 immediate check (catch-up sau reconnect, leader-only)
    window.eventBus.on('sse:connected', () => {
      if (!this._shouldPoll()) return;
      console.log('[ConfigVersionPoller] sse:connected → catch-up check');
      this._adjustPollingCadence();
      this.checkAndRefresh({ trigger: 'sse_connected' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ConfigVersionPoller#user_entitlements', _e); });
    });

    window.eventBus.on('sse:disconnected', () => {
      this._adjustPollingCadence();
    });

    // SSE event config_versions_bumped → instant trigger (Phase 5.1.4 push)
    window.eventBus.on('sse:config_versions_bumped', (data) => {
      if (!this._shouldPoll()) return;
      console.log('[ConfigVersionPoller] sse:config_versions_bumped:', data);
      this.checkAndRefresh({ trigger: 'sse_bumped' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ConfigVersionPoller#user_entitlements', _e); });
    });

    // Role changes — start/stop polling theo leader state
    window.eventBus.on('broadcast:became_leader', () => {
      console.log('[ConfigVersionPoller] Became leader → start polling');
      this._startPollingTimer();
      // Immediate check sau khi take over leader (tránh miss event window)
      this.checkAndRefresh({ trigger: 'became_leader' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ConfigVersionPoller#user_entitlements', _e); });
    });

    window.eventBus.on('broadcast:became_follower', () => {
      console.log('[ConfigVersionPoller] Became follower → stop polling');
      this._stopPollingTimer();
    });
  }

  /**
   * Adjust polling cadence theo SSE state.
   */
  static _adjustPollingCadence() {
    const sseConnected = !!window.SseClient?.isConnected?.();
    const newInterval = sseConnected
      ? this.POLL_INTERVAL_SSE_CONNECTED
      : this.POLL_INTERVAL_SSE_DISCONNECTED;

    if (newInterval !== this._pollingInterval) {
      this._pollingInterval = newInterval;
      console.log(`[ConfigVersionPoller] Adjusted polling interval: ${Math.round(newInterval / 60000)}m (SSE ${sseConnected ? 'connected' : 'disconnected'})`);
      if (this._pollingTimer) this._startPollingTimer(); // Restart với interval mới
    }
  }

  /**
   * Check leader role + initialized state.
   */
  static _shouldPoll() {
    // Nếu SseBroadcastManager chưa init → fallback poll (single-tab mode)
    if (!window.SseBroadcastManager?.isInitialized?.()) return true;
    return window.SseBroadcastManager.isLeader?.() === true;
  }

  static _startPollingTimer() {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend, no polling timer */ return; }
    this._stopPollingTimer();
    this._pollingTimer = setInterval(() => {
      if (!this._shouldPoll()) {
        this._stopPollingTimer();
        return;
      }
      this.checkAndRefresh({ trigger: 'timer' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ConfigVersionPoller#user_entitlements', _e); });
    }, this._pollingInterval);
  }

  static _stopPollingTimer() {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
  }

  static async _persistVersions(versions) {
    return new Promise(resolve => {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return resolve();
        chrome.storage.local.set({ [this.CACHE_KEY]: versions }, resolve);
      } catch (_) {
        resolve();
      }
    });
  }
}

// Singleton + bind to window
window.ConfigVersionPoller = ConfigVersionPoller;
