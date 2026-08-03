/**
 * ExecutionConfig - Server-controlled execution settings.
 *
 * Phase 2 Migration: Business params (workflow, queue, FAR) moved to server.
 * Extension fetches from GET /api/v1/system-config/execution.
 *
 * Server-Only Architecture: Extension BẮT BUỘC online.
 * Cache 5 phút, SSE invalidate khi admin update.
 *
 * Settings groups:
 * - workflow: delay_nodes_sec, max_retries, timeout_sec, on_error
 * - queue: batch_size, max_monitor, rest_min_sec, rest_max_sec
 * - flow_recovery: session_refresh_*, auto_recovery_*, backoff_*
 * - timing: delay_between_prompts_sec
 */
class ExecutionConfig {
  static _cache = null;
  static _cacheTime = 0;
  static _CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  static _fetching = false;
  static _fetchPromise = null;

  /**
   * Get execution config from server.
   * Cache 5 phút, SSE invalidate.
   *
   * @param {boolean} forceRefresh - bypass cache
   * @returns {Promise<object>} Execution config
   */
  // 2026-05-25: Debug logging tắt mặc định production. Bật manual qua DevTools nếu cần.
  static _DEBUG = false;

  // ───────────────────────────────────────────────────────────────────────
  // LOCAL MODE (offline) — bundled execution defaults (4 groups)
  // Khi self.SEOSONA_LOCAL_MODE !== false, KHÔNG fetch server. Getters
  // (getWorkflowConfig/getQueueConfig/...) trả data hợp lệ thay vì throw.
  // ───────────────────────────────────────────────────────────────────────
  static _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  static _LOCAL_DEFAULTS = {
    workflow: { delay_nodes_sec: 2, max_retries: 3, timeout_sec: 300, on_error: 'continue' },
    queue: { batch_size: 3, max_monitor: 10, rest_min_sec: 5, rest_max_sec: 15 },
    flow_recovery: {
      session_refresh_enabled: true,
      auto_recovery_enabled: true,
      backoff_base_sec: 5,
      backoff_max_sec: 120,
      backoff_jitter_percent: 20,
      chunk_mode_enabled: true,
      chunk_size: 20,
    },
    timing: { delay_between_prompts_sec: 5 },
  };

  /** LOCAL: populate cache với defaults (idempotent). */
  static _primeLocalDefaults() {
    if (!this._cache) {
      this._cache = JSON.parse(JSON.stringify(this._LOCAL_DEFAULTS));
      this._cacheTime = Date.now();
    }
    return this._cache;
  }

  static async getConfig(forceRefresh = false) {
    // LOCAL: KHÔNG fetch server — trả bundled defaults.
    if (this._isLocal()) return this._primeLocalDefaults();
    // Check cache
    if (!forceRefresh && this._cache && Date.now() - this._cacheTime < this._CACHE_TTL_MS) {
      if (this._DEBUG) console.log('[ExecutionConfig] ✓ Using cached config', Object.keys(this._cache));
      return this._cache;
    }
    // Removed "Cache miss" log — confusing (storage tier is also cache), next outcome log đủ rõ.

    // Dedupe concurrent fetches
    if (this._fetching) {
      return this._fetchPromise;
    }

    this._fetching = true;
    this._fetchPromise = this._fetchFromServer();

    try {
      const result = await this._fetchPromise;
      return result;
    } finally {
      this._fetching = false;
      this._fetchPromise = null;
    }
  }

  static async _fetchFromServer() {
    // Phase 3.5 Bug G: Server-Only — không return empty config fallback.
    // Nếu fetch fail và cache empty → throw ConfigRequiredError để UI block features.
    // Cache cũ (grace period) vẫn return được.
    // Phase 3.5 Bug I: dùng authManager._apiCall thay raw fetch để consistent với PCM/ModelRegistry

    // PERF FIX (2026-05-17): Đọc chrome.storage.local.af_execution_config TRƯỚC HTTP fetch.
    // Background.js đã write storage này khi fetch — sidebar có thể reuse để skip duplicate
    // HTTP request đến VPS server (1.9GB RAM bị áp lực boot extension).
    try {
      const stored = await new Promise(resolve => {
        chrome.storage.local.get(['af_execution_config'], res => resolve(res.af_execution_config));
      });
      if (stored && typeof stored === 'object' && (stored.workflow || stored.queue || stored.timing || stored.flow_recovery)) {
        this._cache = stored;
        this._cacheTime = Date.now();
        if (this._DEBUG) console.log('[ExecutionConfig] ✓ Loaded from chrome.storage (background preload), SKIP HTTP fetch');
        return this._cache;
      }
    } catch (_) { /* storage read failed — fall through to HTTP */ }

    try {
      if (window.authManager?._apiCall) {
        // NOTE: _apiCall đã unwrap response 2 lần (background apiRequest handler + _apiCall
        // line 655 `resolve(response.data)`), nên `data` đã là object {workflow, queue, ...}
        // trực tiếp, KHÔNG có .success/.data wrapper.
        const data = await ApiClient.request('GET', 'system-config/execution');
        if (data && typeof data === 'object' && (data.workflow || data.queue || data.timing || data.flow_recovery)) {
          this._cache = data;
          this._cacheTime = Date.now();

          if (this._DEBUG) {
            console.log('[ExecutionConfig] ✓ Loaded from server (via authManager):');
            console.log('  workflow:', JSON.stringify(data.workflow || {}));
            console.log('  queue:', JSON.stringify(data.queue || {}));
            console.log('  timing:', JSON.stringify(data.timing || {}));
            console.log('  flow_recovery:', JSON.stringify(data.flow_recovery || {}));
          }

          // Persist to chrome.storage.local for background.js access
          try {
            chrome.storage.local.set({ af_execution_config: data });
          } catch (_) { /* ignore in non-extension context */ }

          return this._cache;
        }
        // data shape invalid (empty or missing keys)
        if (this._cache) return this._cache;
        throw new window.ConfigRequiredError('execution_config', 'response_invalid');
      }
    } catch (e) {
      if (window.ConfigRequiredError?.is?.(e)) {
        if (this._cache) return this._cache;
        throw e;
      }
      // authManager._apiCall might not be available yet — fall through to raw fetch
      console.warn('[ExecutionConfig] authManager._apiCall failed or missing, trying raw fetch:', e.message);
    }

    // Fallback: raw fetch (early boot, before authManager init)
    const baseUrl = window.ApiBaseConfig.get();

    try {
      const headers = {};
      try { if (chrome?.runtime?.id) headers['X-Extension-Id'] = chrome.runtime.id; } catch (_) { globalThis.SEOSONA_swallow?.('ExecutionConfig', _); }
      // Sprint 3 HMAC: ký để pass VerifySignature enforce mode (đồng bộ background.js)
      try { Object.assign(headers, await (window.RequestSigner?.headers?.('GET', new URL(`${baseUrl}/system-config/execution`).pathname, '') || {})); } catch (_) { globalThis.SEOSONA_swallow?.('ExecutionConfig', _); }
      // Timeout 8s — tránh sidebar đứng hình trên mạng chậm.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let response;
      try {
        response = await fetch(`${baseUrl}/system-config/execution`, {
          cache: 'no-store',
          headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        console.warn('[ExecutionConfig] Server returned non-OK:', response.status);
        if (this._cache) return this._cache; // grace period
        if (window.ConfigRequiredError) {
          throw new window.ConfigRequiredError('execution_config', `http_${response.status}`);
        }
        throw new Error(`ExecutionConfig fetch HTTP ${response.status}`);
      }

      const json = await response.json();
      if (json.success && json.data) {
        this._cache = json.data;
        this._cacheTime = Date.now();

        if (this._DEBUG) {
          console.log('[ExecutionConfig] ✓ Loaded from server:');
          console.log('  workflow:', JSON.stringify(json.data.workflow || {}));
          console.log('  queue:', JSON.stringify(json.data.queue || {}));
          console.log('  timing:', JSON.stringify(json.data.timing || {}));
          console.log('  flow_recovery:', JSON.stringify(json.data.flow_recovery || {}));
        }

        // Phase 2c: Persist to chrome.storage.local for background.js access
        try {
          chrome.storage.local.set({ af_execution_config: json.data });
          if (this._DEBUG) console.log('[ExecutionConfig] ✓ Persisted to chrome.storage.local');
        } catch (_) { /* ignore in non-extension context */ }

        return this._cache;
      }

      // success=false response
      console.warn('[ExecutionConfig] Server returned success=false');
      if (this._cache) return this._cache; // grace period
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError('execution_config', 'response_invalid');
      }
      throw new Error('ExecutionConfig: server returned success=false');
    } catch (e) {
      console.warn('[ExecutionConfig] Fetch failed:', e.message);
      // Re-throw ConfigRequiredError as-is
      if (window.ConfigRequiredError?.is?.(e)) throw e;
      // Network/parse error: try cache as grace period
      if (this._cache) return this._cache;
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError('execution_config', 'fetch_failed');
      }
      throw e;
    }
  }

  // Phase 3.5 Bug G: _getEmptyConfig REMOVED — Server-Only architecture không cho phép empty fallback.
  // Khi server fail và cache empty → throw ConfigRequiredError ở _fetchFromServer.

  // ═══════════════════════════════════════════════════════════
  // Phase 3: Server-Only SYNC GETTERS
  // Throws ConfigRequiredError if cache empty
  // ═══════════════════════════════════════════════════════════

  /**
   * @throws {ConfigRequiredError} nếu cache rỗng
   */
  static getWorkflowConfig() {
    if (!this._cache) {
      this.getConfig().catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionConfig', _e); }); // Trigger background fetch
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError('execution_workflow', 'cache_empty');
      }
      return {}; // Fallback if ConfigRequiredError not loaded
    }
    return this._cache.workflow || {};
  }

  /**
   * @throws {ConfigRequiredError} nếu cache rỗng
   */
  static getQueueConfig() {
    if (!this._cache) {
      this.getConfig().catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionConfig', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError('execution_queue', 'cache_empty');
      }
      return {};
    }
    return this._cache.queue || {};
  }

  /**
   * @throws {ConfigRequiredError} nếu cache rỗng
   */
  static getFlowRecoveryConfig() {
    if (!this._cache) {
      this.getConfig().catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionConfig', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError('execution_flow_recovery', 'cache_empty');
      }
      return {};
    }
    return this._cache.flow_recovery || {};
  }

  /**
   * @throws {ConfigRequiredError} nếu cache rỗng
   */
  static getTimingConfig() {
    if (!this._cache) {
      this.getConfig().catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionConfig', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError('execution_timing', 'cache_empty');
      }
      return {};
    }
    return this._cache.timing || {};
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 3: Server-Only INDIVIDUAL GETTERS
  // Returns value from config, throws if cache empty
  // ═══════════════════════════════════════════════════════════

  static getDelayBetweenNodesSec() {
    const cfg = this.getWorkflowConfig(); // May throw
    return cfg.delay_nodes_sec ?? 0;
  }

  static getMaxRetries() {
    const cfg = this.getWorkflowConfig();
    return cfg.max_retries ?? 0;
  }

  static getTimeoutSec() {
    const cfg = this.getWorkflowConfig();
    return cfg.timeout_sec ?? 0;
  }

  static getQueueBatchSize() {
    const cfg = this.getQueueConfig();
    return cfg.batch_size ?? 0;
  }

  static getQueueMaxMonitor() {
    const cfg = this.getQueueConfig();
    return cfg.max_monitor ?? 0;
  }

  static getBackoffBaseSec() {
    const cfg = this.getFlowRecoveryConfig();
    return cfg.backoff_base_sec ?? 0;
  }

  static getBackoffMaxSec() {
    const cfg = this.getFlowRecoveryConfig();
    return cfg.backoff_max_sec ?? 0;
  }

  static getBackoffJitterPercent() {
    const cfg = this.getFlowRecoveryConfig();
    return cfg.backoff_jitter_percent ?? 0;
  }

  static getDelayBetweenPromptsSec() {
    const cfg = this.getTimingConfig();
    return cfg.delay_between_prompts_sec ?? 0;
  }

  /**
   * Chunk Mode config (2026-07-26) — proactive reload Flow để chống DOM staleness.
   * Sits inside flow_recovery group cùng auto_recovery, backoff.
   * @returns {{enabled: boolean, size: number}}
   * @throws {ConfigRequiredError} nếu cache rỗng
   */
  static getFlowChunkConfig() {
    const cfg = this.getFlowRecoveryConfig(); // may throw
    return {
      enabled: !!cfg.chunk_mode_enabled,
      size: parseInt(cfg.chunk_size, 10) || 20,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 3: SAFE GETTERS (catch ConfigRequiredError, return fallback)
  // Use these in components where throwing would break execution
  // ═══════════════════════════════════════════════════════════

  /**
   * Safe version of getWorkflowConfig - returns empty object if unavailable.
   * P1 (2026-05-17): log Tier 3 hits với prefix `[Tier3]` để monitor race condition cold-start.
   */
  static safeGetWorkflowConfig() {
    try {
      return this.getWorkflowConfig();
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        console.debug(`[Tier3] ExecutionConfig.safeGetWorkflowConfig fallback: ${err.message}`);
        return {};
      }
      throw err;
    }
  }

  /**
   * Safe version of getQueueConfig - returns empty object if unavailable.
   * P1 (2026-05-17): log Tier 3 hits với prefix `[Tier3]` để monitor.
   */
  static safeGetQueueConfig() {
    try {
      return this.getQueueConfig();
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        console.debug(`[Tier3] ExecutionConfig.safeGetQueueConfig fallback: ${err.message}`);
        return {};
      }
      throw err;
    }
  }

  /**
   * Safe version of getTimingConfig - returns empty object if unavailable.
   * P1 (2026-05-17): log Tier 3 hits với prefix `[Tier3]` để monitor.
   */
  static safeGetTimingConfig() {
    try {
      return this.getTimingConfig();
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        console.debug(`[Tier3] ExecutionConfig.safeGetTimingConfig fallback: ${err.message}`);
        return {};
      }
      throw err;
    }
  }

  /**
   * Safe version of getFlowChunkConfig — returns safe defaults if cache empty.
   * Fallback: enabled=true, size=20 (matches backend defaults).
   */
  static safeGetFlowChunkConfig() {
    try {
      return this.getFlowChunkConfig();
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        console.debug(`[Tier3] ExecutionConfig.safeGetFlowChunkConfig fallback: ${err.message}`);
        return { enabled: true, size: 20 };
      }
      throw err;
    }
  }

  /**
   * Safe version of getFlowRecoveryConfig - returns empty object if unavailable.
   * P1 (2026-05-17): added warn log (trước silent) để monitor.
   */
  static safeGetFlowRecoveryConfig() {
    try {
      return this.getFlowRecoveryConfig();
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        console.debug(`[Tier3] ExecutionConfig.safeGetFlowRecoveryConfig fallback: ${err.message}`);
        return {};
      }
      throw err;
    }
  }

  /**
   * Safe version of getDelayBetweenPromptsSec - returns null if cache empty.
   * Caller pattern (Phase 2c+ Server-Only): `safeGetDelayBetweenPromptsSec() ?? 5`.
   * Throw (in strict getter) is broken by optional-chaining `?.()` — safe version trả null để
   * `??` fallback hardcoded hoạt động đúng trong cold-start window.
   * P1 (2026-05-17): added warn log khi null để monitor Tier 3 hits.
   */
  static safeGetDelayBetweenPromptsSec() {
    const cfg = this.safeGetTimingConfig();
    const val = cfg.delay_between_prompts_sec;
    if (val === undefined || val === null) {
      console.debug('[Tier3] ExecutionConfig.safeGetDelayBetweenPromptsSec returned null — caller will fallback hardcoded');
      return null;
    }
    return val;
  }

  // ═══════════════════════════════════════════════════════════
  // CACHE MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  /**
   * Invalidate cache - called on SSE system_settings_changed.
   *
   * Bug fix (2026-05-17): cũng clear chrome.storage để tránh đọc data cũ.
   * Trước fix: SSE invalidate chỉ clear in-memory _cache → next _fetchFromServer()
   * đọc storage cache cũ (background preload từ onStartup) → trả data CŨ.
   * Sau fix: clear cả storage → buộc HTTP fetch fresh khi admin save.
   */
  static invalidate() {
    this._cache = null;
    this._cacheTime = 0;
    try { chrome.storage.local.remove('af_execution_config'); } catch (_) { /* ignore */ }
    console.log('[ExecutionConfig] Cache invalidated (in-memory + chrome.storage)');
  }

  /**
   * Check if cache is warm.
   */
  static isCacheWarm() {
    return this._cache !== null && Date.now() - this._cacheTime < this._CACHE_TTL_MS;
  }
}

// SSE listener - invalidate cache khi admin update execution settings
window.eventBus?.on('sse:system_settings_changed', (data) => {
  if (data?.group === 'execution' || data?.section === 'execution') {
    ExecutionConfig.invalidate();
    ExecutionConfig.getConfig(true); // Pre-fetch
  }
});

// LOCAL: prime cache ngay khi load để sync getters không throw ConfigRequiredError.
if (ExecutionConfig._isLocal()) {
  ExecutionConfig._primeLocalDefaults();
}

// Export
window.ExecutionConfig = ExecutionConfig;
