/**
 * ExecutionGate -- Server-side execution permission & token management
 * Moi lan thuc thi (generate, task, workflow, angles) phai xin phep server truoc.
 * Server cap token 1 lan dung, het han sau 5 phut.
 *
 * Fallback: khi server khong kha dung, dung FeatureGate client-side check (nhu cu).
 */
class ExecutionGate {
  static _REQUEST_TIMEOUT = 5000; // 5s timeout cho server call
  static _activeTokens = new Map(); // Track active tokens for cleanup on unload

  /**
   * LOCAL/OFFLINE mode — mặc định true (self.SEOSONA_LOCAL_MODE !== false).
   * Khi local: cho phép tất cả, không gọi server, không track quota.
   */
  static _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  /**
   * Xin phep server truoc khi chay
   * @param {string} action - 'generate'|'task_run'|'workflow_run'|'angles_run'
   * @param {number} promptCount - so prompt can chay
   * @param {object} metadata - { owner, label }
   * @returns {Promise<{ allowed: boolean, token?: string, remaining?: number, reason?: string }>}
   */
  static async request(action, promptCount = 1, metadata = {}) {
    // LOCAL mode: cho phép ngay, không gọi server, không cấp token thật.
    if (this._isLocal()) {
      return {
        allowed: true,
        token: null,
        remaining: undefined,
        limit: undefined,
        used: undefined,
        prompt_count: promptCount,
        reason: 'LOCAL_MODE',
      };
    }
    try {
      const response = await this._apiCall('POST', 'execution/request', {
        action,
        prompt_count: promptCount,
        metadata,
      });

      // Server tra ve ket qua hop le
      // Backend response: { success: true, data: { execution_token, expires_in, remaining } }
      // Khi success=true va co execution_token => allowed
      const data = response?.data || response;
      const token = data.execution_token || data.token || null;
      const allowed = token ? true : (data.allowed === true || data.allowed === 1 || data.allowed === '1');

      // GP-4.2: Parse global quota từ response (nếu có)
      // Server trả về module quota trong remaining/limit/used
      // và global quota trong global.remaining/global.limit/global.used
      const moduleQuota = {
        remaining: typeof data.remaining === 'number' ? data.remaining : undefined,
        limit: typeof data.limit === 'number' ? data.limit : undefined,
        used: typeof data.used === 'number' ? data.used : undefined,
      };
      const globalQuota = data.global ? {
        remaining: typeof data.global.remaining === 'number' ? data.global.remaining : undefined,
        limit: typeof data.global.limit === 'number' ? data.global.limit : undefined,
        used: typeof data.global.used === 'number' ? data.global.used : undefined,
      } : null;

      console.log('[ExecutionGate] request:', action, '- allowed:', allowed, ', token:', token, ', module remaining:', moduleQuota.remaining, ', global remaining:', globalQuota?.remaining);

      // Track active token for cleanup on unload
      if (allowed && token) {
        this._activeTokens.set(token, { action, timestamp: Date.now() });
      }

      return {
        allowed,
        token,
        // Backward compatible: giữ remaining/limit/used cho module quota
        remaining: moduleQuota.remaining,
        limit: moduleQuota.limit,
        used: moduleQuota.used,
        // GP-4.2: Thêm global quota info
        global_remaining: globalQuota?.remaining,
        global_limit: globalQuota?.limit,
        global_used: globalQuota?.used,
        // GP-7.5: Truyền prompt_count để showDeniedDialog hiển thị thông báo rõ ràng
        prompt_count: promptCount,
        reason: data.reason || (allowed ? 'SERVER_APPROVED' : 'SERVER_DENIED'),
      };
    } catch (err) {
      // Kiem tra xem error co chua quota/permission info tu server khong
      // _apiCall reject voi error.code va error.serverData khi success=false
      if (window.QuotaErrorHandler?.isQuotaError(err)) {
        console.warn('[ExecutionGate] Server denied:', err.code, err.message);
        const serverData = err.serverData || {};
        // GP-8: Parse global quota từ flat keys (backend trả về global_limit, global_used, global_remaining ở top level)
        const globalQuota = (typeof serverData.global_limit === 'number' || typeof serverData.global_remaining === 'number') ? {
          remaining: typeof serverData.global_remaining === 'number' ? serverData.global_remaining : undefined,
          limit: typeof serverData.global_limit === 'number' ? serverData.global_limit : undefined,
          used: typeof serverData.global_used === 'number' ? serverData.global_used : undefined,
        } : null;
        return {
          allowed: false,
          token: null,
          remaining: typeof serverData.remaining === 'number' ? serverData.remaining : undefined,
          limit: typeof serverData.limit === 'number' ? serverData.limit : undefined,
          used: typeof serverData.used === 'number' ? serverData.used : undefined,
          // GP-4.2: Thêm global quota info
          global_remaining: globalQuota?.remaining,
          global_limit: globalQuota?.limit,
          global_used: globalQuota?.used,
          // GP-7.5: Truyền prompt_count để showDeniedDialog hiển thị thông báo rõ ràng
          prompt_count: promptCount,
          reason: err.code,
        };
      }

      // Server khong phan hoi hoac loi mang -> fallback client-side check
      console.error('[ExecutionGate] request failed, err.code:', err.code, ', falling back to client check:', err.message);
      return this._fallbackCheck(action, promptCount, metadata);
    }
  }

  /**
   * Bao ket qua sau khi chay xong.
   * Sau khi bao server, refresh FeatureGate de lay remaining chinh xac.
   *
   * @param {string} token - execution token from request()
   * @param {string} status - 'success'|'failed'|'partial'
   * @param {object} resultData - { tile_count, error }
   */
  static async complete(token, status = 'success', resultData = {}) {
    // LOCAL mode: no-op — không có token thật, không refresh/POST server.
    if (this._isLocal()) return;
    // Token null = caller chua xin token (e.g. anonymous user, hoac request() fail) —
    // van refresh FeatureGate de sync entitlements voi server.
    if (!token) {
      this._refreshFeatureGate();
      return;
    }

    // Bug 48 fix (2026-05-13): Idempotent — nếu token đã completed (e.g. adapter + executor
    // cùng catch error rồi call complete), bỏ qua call thứ 2 để tránh duplicate
    // POST /execution/complete + duplicate FeatureGate refresh.
    if (!this._activeTokens.has(token)) {
      console.log('[ExecutionGate] complete: token already completed, skip duplicate', token);
      return;
    }

    // Remove from active tracking
    this._activeTokens.delete(token);

    // Non-blocking: fire and forget, refresh FeatureGate sau khi hoan thanh
    this._apiCall('POST', 'execution/complete', {
      token,
      status,
      result_data: Object.keys(resultData).length > 0 ? resultData : undefined,
    }).then(() => {
      console.log('[ExecutionGate] complete:', token, status);
      this._refreshFeatureGate();
    }).catch((err) => {
      console.error('[ExecutionGate] complete failed (non-blocking):', err.message);
      // Van refresh de sync trang thai
      this._refreshFeatureGate();
    });
  }

  /**
   * Huy token khi user stop/cancel truoc khi chay xong.
   * Server se rollback quota, refresh FeatureGate de sync.
   *
   * @param {string} token
   */
  static async cancel(token) {
    // LOCAL mode: no-op — không có token thật, không POST server.
    if (this._isLocal()) return;
    // Token null = caller chua xin token, khong can bao server (no-op).
    if (!token) return;

    // Remove from active tracking
    this._activeTokens.delete(token);

    // Non-blocking: fire and forget, refresh FeatureGate sau khi cancel
    this._apiCall('POST', 'execution/cancel', {
      token,
    }).then(() => {
      console.log('[ExecutionGate] cancel:', token);
      // Server da rollback quota, refresh de sync remaining
      this._refreshFeatureGate();
    }).catch((err) => {
      console.error('[ExecutionGate] cancel failed (non-blocking):', err.message);
      this._refreshFeatureGate();
    });
  }

  /**
   * Bug 54 fix (2026-05-13): Cancel TẤT CẢ active tokens — dùng cho forceStop.
   * Trước fix: ExecutionTracker._handleStop chỉ cancel `_currentTaskExecutionToken`.
   * Workflow execution dùng per-node tokens (cgToken/grokToken local trong
   * WorkflowExecutor) → không cancel được → quota vẫn hold ở server.
   * Sau fix: clear hết Map _activeTokens, server rollback quota.
   *
   * @returns {number} count of tokens cancelled
   */
  static async cancelAll() {
    // LOCAL mode: no active tokens ever created — nothing to cancel.
    if (this._isLocal()) return 0;
    const tokens = Array.from(this._activeTokens.keys());
    if (tokens.length === 0) return 0;
    console.log('[ExecutionGate] cancelAll:', tokens.length, 'active tokens');
    for (const token of tokens) {
      // Fire-and-forget; cancel() đã handle non-blocking + remove từ Map
      this.cancel(token).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionGate', _e); });
    }
    return tokens.length;
  }

  /**
   * Fallback khi server khong kha dung
   * Dung FeatureGate client-side check (FAIL-CLOSED: deny if cache too stale)
   *
   * SECURITY: Fallback phải là fail-closed để tránh:
   * - User vượt quota khi server down
   * - Drift lớn giữa local vs server usage
   *
   * [Audit Bug 4 fix 2026-06-22] Strict Server-Only: TTL 60s thay vì 1h.
   * Trước fix: cache 1h cho phép user offline lâu → vượt quota thật + pending sync FIFO overflow.
   * Sau fix: chỉ allow trong jitter window 60s (server vừa blip ngắn) — khớp Server-Only spec.
   * CLAUDE.md anti-pattern #4: "Cho phép dùng feature khi offline → Block UI, hiện overlay".
   */
  static async _fallbackCheck(action, promptCount, metadata = {}) {
    const featureKeyMap = {
      generate: 'gen_run_max',           // Legacy: backward compatible
      generate_flow: 'gen_run_max',      // Flow provider
      generate_chatgpt: 'chatgpt_run_max', // ChatGPT provider
      generate_grok: 'grok_run_max',     // Grok provider
      task_run: 'tasks_run_max',
      workflow_run: 'workflows_run_max',
      angles_run: 'angles_run_max',
      effects_run: 'effects_run_max',
    };

    const featureKey = featureKeyMap[action];
    // [Audit Bug 4 fix] 60s = jitter window cho transient blip (DNS, single failed packet).
    // Trước fix: 1h → user offline cả tiếng vẫn pass → drift quota nghiêm trọng.
    const OFFLINE_CACHE_TTL = 60 * 1000; // 60s - chỉ cover jitter, không cover offline thật

    // FAIL-CLOSED: Kiểm tra cache có hợp lệ không
    const fg = window.featureGate;
    const cacheAge = fg?.lastFetch ? (Date.now() - fg.lastFetch) : Infinity;

    // [Fix C 2026-06-10] Auto-refresh featureGate trước khi DENY (Option B).
    // Cache stale ≠ offline thật — có thể chỉ sidebar mở lâu (>60s) không có activity refresh.
    // Trước DENY hard: thử refresh silent. Nếu OK → re-check với cache fresh (có thể PASS).
    // Nếu refresh fail/timeout → confirm offline thật → DENY với reason rõ ràng.
    // Server-Only strict vẫn giữ (refresh fail = fail-closed).
    if (cacheAge > OFFLINE_CACHE_TTL) {
      console.log('[ExecutionGate] cache stale (age ' + Math.round(cacheAge / 1000) + 's > 60s), attempting refresh before DENY...');
      let refreshed = false;
      try {
        if (fg && typeof fg.refresh === 'function') {
          // Race với 5s timeout — không await indefinite nếu server slow
          await Promise.race([
            fg.refresh({ force: true }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('refresh timeout')), 5000)),
          ]);
          const newCacheAge = fg.lastFetch ? (Date.now() - fg.lastFetch) : Infinity;
          if (newCacheAge < OFFLINE_CACHE_TTL) {
            console.log('[ExecutionGate] refresh OK (new cache age ' + Math.round(newCacheAge / 1000) + 's), continue with fresh quota check');
            refreshed = true;
            // Fall through xuống quota check phía dưới
          }
        }
      } catch (refreshErr) {
        console.warn('[ExecutionGate] featureGate refresh failed:', refreshErr?.message || refreshErr);
      }
      if (!refreshed) {
        console.warn('[ExecutionGate] fallback DENIED (strict server-only): refresh failed, confirm offline');
        return {
          allowed: false,
          token: null,
          reason: 'OFFLINE_CACHE_STALE',
          prompt_count: promptCount,
        };
      }
    }

    // FeatureGate có cache nhưng không có quota info → DENY
    const quota = fg?.checkQuota(featureKey);
    if (!quota) {
      console.warn('[ExecutionGate] fallback DENIED: no quota info for', featureKey, '- fail-closed');
      return {
        allowed: false,
        token: null,
        reason: 'OFFLINE_NO_QUOTA_INFO',
        prompt_count: promptCount,
      };
    }

    // Kiem tra quota co cho phep khong
    // quota.allowed co the la true/false/undefined
    const moduleAllowed = quota.allowed !== false;

    // GP-5: ALSO check global prompt_submit_max in fallback mode
    // Module quota OK but global quota exhausted → DENY
    const globalQuota = fg?.checkQuota?.('prompt_submit_max');
    if (globalQuota && globalQuota.allowed === false) {
      console.warn('[ExecutionGate] fallback DENIED: global prompt_submit_max exhausted');
      return {
        allowed: false,
        token: null,
        reason: 'GLOBAL_QUOTA_EXCEEDED',
        prompt_count: promptCount,
        global_remaining: globalQuota.remaining,
        global_limit: globalQuota.limit,
        global_used: globalQuota.used,
      };
    }

    const allowed = moduleAllowed;

    console.log('[ExecutionGate] fallback:', featureKey, '- allowed:', allowed, ', remaining:', quota.remaining);

    // UA-5: Khi fallback xảy ra và được phép, lưu execution để sync sau
    if (allowed) {
      // M1 fix: get→push→set KHÔNG atomic → 2 fallback đồng thời (2 tab/context) last-write-wins,
      // mất record khỏi pending sync → drift quota. Serialize appends qua module-level promise chain
      // (async mutex, local trong file). StorageManager agent dùng cùng approach chained-promise mutex.
      this._appendPendingSync({
        action,
        prompt_count: promptCount,
        timestamp: new Date().toISOString(),
        owner: metadata?.owner || null,
        label: metadata?.label || null,
      }).catch(() => { /* Ignore storage errors during fallback */ });
    }

    return {
      allowed,
      token: null,
      reason: allowed ? 'OFFLINE_FALLBACK' : 'QUOTA_EXCEEDED',
      remaining: typeof quota.remaining === 'number' ? quota.remaining : undefined,
      limit: typeof quota.limit === 'number' ? quota.limit : undefined,
      used: typeof quota.used === 'number' ? quota.used : undefined,
      // GP-7.5: Truyền prompt_count để showDeniedDialog hiển thị thông báo rõ ràng
      prompt_count: promptCount,
    };
  }

  /**
   * M1 fix: Append 1 record vào af_pending_sync một cách atomic.
   * Serialize read-modify-write qua module-level promise chain (_pendingSyncMutex) → 2 append
   * đồng thời không còn last-write-wins. Local trong file (không dùng navigator.locks để giữ đơn giản).
   * @param {object} record
   * @returns {Promise<void>}
   */
  static _appendPendingSync(record) {
    ExecutionGate._pendingSyncMutex = (ExecutionGate._pendingSyncMutex || Promise.resolve()).then(async () => {
      const res = await new Promise(resolve => chrome.storage.local.get(['af_pending_sync'], resolve));
      const pending = res.af_pending_sync || [];
      pending.push(record);
      // Max 100 items (FIFO)
      if (pending.length > 100) pending.splice(0, pending.length - 100);
      await new Promise(resolve => chrome.storage.local.set({ af_pending_sync: pending }, resolve));
    }).catch(err => {
      // Nuốt lỗi để chain không bị "poisoned" (append sau vẫn chạy được), nhưng vẫn reject cho caller.
      console.warn('[ExecutionGate] _appendPendingSync error:', err?.message || err);
      throw err;
    });
    return ExecutionGate._pendingSyncMutex.catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionGate', _e); });
  }

  /**
   * API call ho tro ca anonymous va logged-in
   * Boc trong Promise.race voi timeout de dam bao khong treo
   * M7 fix: thread AbortController vao HTTP call, abort khi timeout (khong orphan request server-side).
   */
  static _apiCall(method, endpoint, data) {
    return new Promise((resolve, reject) => {
      const abortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timeoutId = setTimeout(() => {
        // M7: abort HTTP call thuc su khi timeout → server khong con orphan granted token.
        if (abortController) { try { abortController.abort(); } catch (_) { globalThis.SEOSONA_swallow?.('ExecutionGate', _); } }
        reject(new Error('Request timeout after ' + this._REQUEST_TIMEOUT + 'ms'));
      }, this._REQUEST_TIMEOUT);

      const done = (fn, val) => {
        clearTimeout(timeoutId);
        fn(val);
      };

      if (true) {
        // Pass signal cho authManager._apiCall (backward-compat: bo qua neu khong support).
        ApiClient.request(method, endpoint, data, { signal: abortController?.signal })
          .then(res => done(resolve, res))
          .catch(err => done(reject, err));
        return;
      }

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'apiRequest',
          method,
          endpoint,
          data,
        }, (resp) => {
          if (chrome.runtime.lastError) {
            done(reject, new Error(chrome.runtime.lastError.message));
            return;
          }
          if (resp?.success) {
            if (resp.meta) {
              done(resolve, { data: resp.data, meta: resp.meta });
            } else {
              done(resolve, resp.data);
            }
          } else {
            // Tao error voi code va serverData de request() xu ly dung
            const err = new Error(resp?.error?.message || 'API request failed');
            err.code = resp?.error?.code || null;
            err.serverData = resp?.data || {};
            done(reject, err);
          }
        });
      } else {
        done(reject, new Error('No API transport available'));
      }
    });
  }

  /**
   * Hiển thị dialog khi server từ chối (QUOTA_EXCEEDED, GLOBAL_QUOTA_EXCEEDED, MODULE_DISABLED...)
   * Dùng chung cho tất cả callers để đảm bảo UI nhất quán.
   * @param {object} gate - kết quả từ request()
   * @param {string} moduleName - tên module hiển thị (vd: 'Generate', 'Task', 'Workflow')
   */
  /**
   * @param {object} gate - kết quả từ ExecutionGate.request() có {reason, ...}
   * @param {string} moduleName - tên module hiển thị trong dialog
   * @param {function|null} [onRetry] - [Fix C 2026-06-10] Optional callback re-trigger action.
   *        Chỉ render button "Thử lại" cho OFFLINE_CACHE_STALE / OFFLINE_NO_QUOTA_INFO.
   *        Backward compat: existing callers KHÔNG pass → undefined → no retry button.
   */
  static showDeniedDialog(gate, moduleName = '', onRetry = null) {
    const Dialog = window.customDialog;
    if (!Dialog) return;

    // SS: Check show_upgrade_ui để quyết định hiển thị nút nào
    const showUpgrade = window.SystemConfig?.getBool('show_upgrade_ui') !== false;
    const contactUrl = window.SystemConfig?.get('upgrade_contact_url', '');

    // Build upgrade action button based on settings
    const getUpgradeButton = () => {
      if (showUpgrade) {
        return {
          label: window.I18n?.t('gate.upgradeNow') || 'Nâng cấp ngay',
          primary: true,
          action: () => {
            // Send message to sidebar to show upgrade modal
            chrome.runtime.sendMessage({ action: 'showUpgradeModal' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionGate#action', _e); });
          }
        };
      } else if (contactUrl) {
        return {
          label: window.I18n?.t('gate.contact') || 'Liên hệ',
          primary: true,
          action: () => {
            window.open(contactUrl, '_blank');
          }
        };
      }
      return null;
    };

    const buildButtons = () => {
      const buttons = [{ label: window.I18n?.t('common.close') || 'Đóng', primary: false, action: () => {} }];
      const upgradeBtn = getUpgradeButton();
      if (upgradeBtn) buttons.push(upgradeBtn);
      return buttons;
    };

    // GP-4.3: Hiển thị thông báo riêng cho GLOBAL_QUOTA_EXCEEDED
    // GP-8: Global quota check promptCount, có thể "không đủ lượt" nếu remaining > 0 nhưng < promptCount
    if (gate.reason === 'GLOBAL_QUOTA_EXCEEDED') {
      const globalLimit = gate.global_limit ?? gate.limit ?? '?';
      const globalUsed = gate.global_used ?? gate.used ?? '?';
      const globalRemaining = (typeof globalLimit === 'number' && typeof globalUsed === 'number') ? (globalLimit - globalUsed) : null;
      const promptCount = gate.prompt_count ?? gate.promptCount ?? null;

      let message;
      let title;
      // GP-8: Phân biệt "hết prompt" vs "không đủ prompt cho batch"
      if (globalRemaining !== null && globalRemaining > 0 && promptCount !== null && promptCount > globalRemaining) {
        // Còn prompt nhưng không đủ cho số prompts yêu cầu
        title = window.I18n?.t('gate.insufficientQuotaTitle') || 'Không đủ quota prompt';
        message = (window.I18n?.t('gate.insufficientQuotaMsg', { promptCount, globalRemaining, globalLimit, globalUsed }) || `Tác vụ cần ${promptCount} prompt nhưng chỉ còn ${globalRemaining} prompt.\n\nGiới hạn: ${globalLimit} prompt/ngày\nĐã dùng: ${globalUsed} prompt\nCòn lại: ${globalRemaining} prompt`) + '\n\n' +
          (showUpgrade ? (window.I18n?.t('gate.insufficientQuotaUpgrade') || 'Giảm số prompt hoặc nâng cấp gói để tăng giới hạn.') : (window.I18n?.t('gate.insufficientQuotaContact') || 'Giảm số prompt hoặc liên hệ admin để tăng giới hạn.'));
      } else {
        // Hết prompt hoàn toàn
        title = window.I18n?.t('gate.dailyQuotaExhaustedTitle') || 'Hết quota prompt hàng ngày';
        message = (window.I18n?.t('gate.dailyQuotaExhaustedMsg', { globalLimit, globalUsed }) || `Bạn đã sử dụng hết ${globalLimit} prompt trong ngày.\n\nĐã dùng: ${globalUsed}/${globalLimit} prompt`) + '\n\n' +
          (window.I18n?.t('gate.dailyQuotaGlobalNote') || 'Global quota áp dụng cho tất cả tính năng (Generate, Task, Workflow, Angles, Effects).') + '\n\n' +
          (showUpgrade ? (window.I18n?.t('gate.dailyQuotaUpgrade') || 'Nâng cấp gói để có thêm quota.') : (window.I18n?.t('gate.dailyQuotaContact') || 'Vui lòng liên hệ admin để nâng cấp.'));
      }
      Dialog.alert(message, { title, type: 'warning', buttons: buildButtons() });
    } else if (gate.reason === 'QUOTA_EXCEEDED') {
      // GP-8: Module quota (*_run_max) chỉ đếm số lần RUN, không check promptCount
      // QUOTA_EXCEEDED cho module chỉ xảy ra khi remaining < 1 (hết lượt hoàn toàn)
      const limit = gate.limit ?? '?';
      const used = gate.used ?? '?';

      const title = window.I18n?.t('gate.usageLimitTitle') || 'Hết lượt sử dụng';
      const message = (window.I18n?.t('gate.usageLimitMsg', { moduleName: moduleName || '', limit, used }) || `Đã hết lượt sử dụng${moduleName ? ' ' + moduleName : ''} hôm nay.\n\nGiới hạn: ${limit} lượt/ngày\nĐã dùng: ${used} lượt`) + '\n\n' +
        (showUpgrade ? (window.I18n?.t('gate.usageLimitUpgrade') || 'Nâng cấp gói để tăng giới hạn.') : (window.I18n?.t('gate.usageLimitContact') || 'Vui lòng liên hệ admin để tăng giới hạn.'));
      Dialog.alert(message, { title, type: 'warning', buttons: buildButtons() });
    } else if (gate.reason === 'MODULE_DISABLED' || gate.reason === 'FEATURE_LOCKED') {
      Dialog.alert(
        (window.I18n?.t('gate.featureLockedMsg', { moduleName: moduleName || '' }) || `Tính năng${moduleName ? ' ' + moduleName : ''} bị khóa cho gói hiện tại.`) + '\n\n' +
        (showUpgrade ? (window.I18n?.t('gate.featureLockedUpgrade') || 'Nâng cấp gói để sử dụng tính năng này.') : (window.I18n?.t('gate.featureLockedContact') || 'Vui lòng liên hệ admin để mở khóa.')),
        { title: window.I18n?.t('gate.featureLockedTitle') || 'Tính năng bị khóa', type: 'warning', buttons: buildButtons() }
      );
    } else if (gate.reason === 'OFFLINE_CACHE_STALE' || gate.reason === 'OFFLINE_NO_QUOTA_INFO') {
      // [Fix C 2026-06-10] UX rõ ràng cho lỗi network/cache stale (không phải quota deny).
      // Server-Only architecture: cache TTL 60s — nếu /execution/request fail + cache > 60s →
      // DENY fail-closed. Show message hướng dẫn user + retry button nếu caller pass onRetry.
      const title = window.I18n?.t('gate.connectionErrorTitle') || 'Lỗi kết nối server';
      const message = window.I18n?.t('gate.connectionErrorMsg') ||
        'Mất kết nối tới server. Vui lòng kiểm tra mạng và thử lại sau vài giây.';
      const connButtons = [{ label: window.I18n?.t('common.close') || 'Đóng', primary: false, action: () => {} }];
      if (typeof onRetry === 'function') {
        connButtons.push({
          label: window.I18n?.t('common.retry') || 'Thử lại',
          primary: true,
          action: () => { try { onRetry(); } catch (e) { console.warn('[ExecutionGate] onRetry threw:', e?.message); } },
        });
      }
      Dialog.alert(message, { title, type: 'warning', buttons: connButtons });
    } else {
      Dialog.alert(
        (window.I18n?.t('gate.notAllowedMsg', { moduleName: moduleName || '' }) || `Không được phép chạy${moduleName ? ' ' + moduleName : ''}.`) + '\n' +
        (gate.reason || ''),
        { title: window.I18n?.t('gate.notAllowedTitle') || 'Không thể thực hiện', type: 'warning' }
      );
    }
  }

  /**
   * Refresh FeatureGate de lay remaining chinh xac tu server.
   * Non-blocking, goi sau khi execution hoan thanh hoac huy.
   *
   * [API SPAM FIX — Phase 3.3] Skip refresh nếu vừa refresh < 30s.
   * Lý do: chạy nhiều workflow liên tiếp (vd batch run) → mỗi workflow gọi
   * complete() → refresh FeatureGate → spam GET /quotas/current. Throttle 30s
   * đủ cho user thấy quota update kịp thời + giảm load backend.
   */
  static _refreshFeatureGate() {
    if (!window.featureGate || typeof window.featureGate.refresh !== 'function') return;
    const now = Date.now();
    const lastRefresh = ExecutionGate._lastFeatureGateRefreshAt || 0;
    if (now - lastRefresh < 30 * 1000) {
      console.log('[ExecutionGate] Skip FeatureGate refresh (vừa refresh ' + Math.round((now - lastRefresh) / 1000) + 's trước)');
      return;
    }
    ExecutionGate._lastFeatureGateRefreshAt = now;
    window.featureGate.refresh().catch((err) => {
      console.warn('[ExecutionGate] FeatureGate refresh failed:', err.message);
      // Reset timestamp on fail để cho lần sau có thể retry
      ExecutionGate._lastFeatureGateRefreshAt = 0;
    });
  }

  /**
   * Auto-cancel active tokens khi window unload (tab close, navigate away)
   * Goi 1 lan khi load file
   */
  static _initCleanup() {
    if (typeof window === 'undefined') return;
    window.addEventListener('unload', () => {
      for (const [token] of this._activeTokens) {
        try {
          const baseUrl = window.authManager?.apiBaseUrl;
          const authToken = window.authManager?.token;
          if (baseUrl && authToken) {
            const url = baseUrl + '/execution/cancel';
            const body = JSON.stringify({ token });
            try {
              fetch(url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + authToken,
                },
                body,
                keepalive: true,
              }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionGate#action', _e); });
            } catch (_fetchErr) {
              if (navigator.sendBeacon) {
                const blob = new Blob([body], { type: 'application/json' });
                navigator.sendBeacon(url, blob);
              }
            }
          } else if (navigator.sendBeacon && baseUrl) {
            const url = baseUrl + '/execution/cancel';
            const blob = new Blob(
              [JSON.stringify({ token })],
              { type: 'application/json' }
            );
            navigator.sendBeacon(url, blob);
          }
        } catch (e) {
          // Ignore errors during unload
        }
      }
      this._activeTokens.clear();
    });
  }
}

// Init cleanup listener
ExecutionGate._initCleanup();

window.ExecutionGate = ExecutionGate;
