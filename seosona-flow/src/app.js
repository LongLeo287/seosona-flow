/**
 * SEOSONA Flow - App Entry Point
 * Khởi tạo tất cả components và modules
 */

(function() {
  'use strict';

  const DEBUG = true;

  // Audit fix: holds the single active project-dropdown outside-click handler so
  // re-rendering the dropdown doesn't stack duplicate document listeners.
  let _projectDropdownCloseHandler = null;

  // Note: Đã remove SW keep-alive port + heartbeat sau khi xác định root cause thực sự
  // là Chrome HTTP cache (fix bằng cache: 'no-store' trong background.js apiRequest handler).
  // SW lifecycle không phải nguyên nhân bug login/logout refresh quyền.

  // ─── Shared Bank Name Mapping ──────────────────────────
  

  function log(...args) {
    if (DEBUG) console.log('[SEOSONA Flow]', ...args);
  }

  /**
   * Audit fix: escape HTML special chars (& < > " ') before interpolating
   * server/AI/user strings into innerHTML. CSP blocks script exec, but this
   * prevents markup/phishing/CSS-beacon injection into the extension page.
   */
  function _escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * sidePanel-compatible sendLog — writes to logContainer DOM directly
   * (content.js sendLog không available trong sidePanel context)
   */
  function sidebarLog(msg, level = 'info') {
    console.log(`[SEOSONA Flow] ${msg}`);
    const logContainer = document.getElementById('logContainer');
    if (logContainer) {
      const div = document.createElement('div');
      div.className = `log-entry ${level}`;
      div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      logContainer.appendChild(div);
      logContainer.scrollTop = logContainer.scrollHeight;
    }
    const logTabBtn = document.querySelector('.seosonaflow-tab[data-tab="tab-logs"]');
    if (logTabBtn && !logTabBtn.classList.contains('active')) {
      logTabBtn.classList.add('has-new');
    }
  }
  window.sidebarLog = sidebarLog;

  /**
   * Global notification toast — top center, auto dismiss
   * @param {string} message
   * @param {'success'|'error'|'info'|'warning'} type
   * @param {number} duration ms (default 2500)
   */
  const _notifIcons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
  };
  let _notifTimer = null;
  // 2026-05-31: dedup — skip toast trùng (message+type) trong 3s.
  // Tránh spam khi workflow nhiều nodes cùng trigger 1 loại warning.
  let _lastNotif = { key: '', timestamp: 0 };
  window.showNotification = function(message, type = 'success', duration) {
    // K.9 (2026-05-29): error mặc định 5000ms (user cần đọc kỹ), success/info 2500ms.
    const ms = typeof duration === 'number' ? duration : (type === 'error' ? 5000 : 2500);
    const dedupKey = `${type}::${message}`;
    const now = Date.now();
    if (_lastNotif.key === dedupKey && (now - _lastNotif.timestamp) < 3000) {
      return; // Skip duplicate within 3s
    }
    _lastNotif = { key: dedupKey, timestamp: now };
    // Remove existing
    const existing = document.querySelector('.seosonaflow-notification');
    if (existing) {
      clearTimeout(_notifTimer);
      existing.remove();
    }
    const el = document.createElement('div');
    el.className = `seosonaflow-notification ${type}`;
    // Audit fix: icon markup is static/trusted; message is user/AI/server text →
    // inject icon via innerHTML but set the message via textContent to avoid markup injection.
    el.innerHTML = `${_notifIcons[type] || _notifIcons.info}<span></span>`;
    el.querySelector('span').textContent = message;
    document.body.appendChild(el);

    // K.8 (2026-05-29): Hover-pause UX — user hover chuột → giữ toast hiển thị
    // (clear auto-dismiss timer). Bỏ chuột ra → restart timer ngắn hơn (1500ms)
    // để toast biến mất nhanh sau khi user đã đọc xong.
    const RESUME_DURATION = 1500;
    const startDismissTimer = (delay) => {
      _notifTimer = setTimeout(() => {
        el.classList.add('seosonaflow-notif-out');
        setTimeout(() => el.remove(), 300);
      }, delay);
    };
    startDismissTimer(ms);
    el.addEventListener('mouseenter', () => {
      if (_notifTimer) {
        clearTimeout(_notifTimer);
        _notifTimer = null;
      }
    });
    el.addEventListener('mouseleave', () => {
      // Chỉ restart nếu toast chưa fade-out (mouseleave fire khi removing animation).
      if (!el.classList.contains('seosonaflow-notif-out')) {
        startDismissTimer(RESUME_DURATION);
      }
    });
  };

  // showToast = alias của showNotification. Nhiều module có nhánh fallback
  // `typeof window.showToast === 'function'` (trước đây chết vì showToast chưa từng định nghĩa) → nay hoạt động.
  window.showToast = window.showNotification;

  // Bug 49 fix (2026-05-13): Cloudflare challenge notification — persistent toast
  // user phải click vào tab Grok để verify captcha. Update mỗi 10s với elapsed time.
  // Auto-dismiss khi resolved, escalate styling sau 30s nếu chưa pass.
  function _showCloudflareToast(msg) {
    const existing = document.getElementById('seosonaflow-cloudflare-toast');
    const ELAPSED_URGENT_SEC = 30;
    const provider = msg.provider || 'grok';
    const providerLabel = provider === 'grok' ? 'Grok' : provider.charAt(0).toUpperCase() + provider.slice(1);

    // Helper: I18n.t() trả về key string khi không tìm thấy → check và dùng fallback
    const _t = (key, params, fallback) => {
      const result = window.I18n?.t(key, params);
      return (result && result !== key && !result.startsWith('cloudflare.')) ? result : fallback;
    };

    if (msg.phase === 'resolved') {
      // Hide + show success briefly
      if (existing) {
        existing.classList.add('seosonaflow-notif-out');
        setTimeout(() => existing.remove(), 300);
      }
      window.showNotification?.(
        _t('cloudflare.resolved', { provider: providerLabel, sec: msg.elapsedSec },
          `✓ Cloudflare ${providerLabel} đã verify (${msg.elapsedSec}s)`),
        'success',
        3000
      );
      return;
    }

    if (msg.phase === 'timeout') {
      if (existing) existing.remove();
      window.showNotification?.(
        _t('cloudflare.timeout', { provider: providerLabel },
          `⚠️ Cloudflare ${providerLabel} verify timeout — vui lòng thử lại`),
        'error',
        5000
      );
      return;
    }

    // detected | waiting → persistent toast
    const elapsed = msg.elapsedSec || 0;
    const isUrgent = elapsed >= ELAPSED_URGENT_SEC;
    const titleText = isUrgent
      ? _t('cloudflare.urgent', { provider: providerLabel },
          `🛡️ Cloudflare ${providerLabel} — cần bạn click verify!`)
      : _t('cloudflare.detected', { provider: providerLabel },
          `🛡️ Cloudflare ${providerLabel} challenge — đang chờ verify…`);
    const subtitleText = _t('cloudflare.subtitle', { sec: elapsed },
      `Đã chờ ${elapsed}s. Nếu lâu không pass, hãy click vào tab ${providerLabel} để verify thủ công.`);
    const openTabText = _t('cloudflare.openTab', { provider: providerLabel }, `Mở ${providerLabel}`);

    let el = existing;
    if (!el) {
      el = document.createElement('div');
      el.id = 'seosonaflow-cloudflare-toast';
      el.className = 'seosonaflow-cloudflare-toast';
      document.body.appendChild(el);
    }
    el.classList.toggle('is-urgent', isUrgent);
    el.innerHTML = `
      <div class="seosonaflow-cf-toast-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
      </div>
      <div class="seosonaflow-cf-toast-body">
        <div class="seosonaflow-cf-toast-title">${titleText}</div>
        <div class="seosonaflow-cf-toast-subtitle">${subtitleText}</div>
      </div>
      <button type="button" class="seosonaflow-cf-toast-btn" data-action="focus-tab">
        ${openTabText}
      </button>
    `;
    // Click action → send focus tab message back tới background
    el.querySelector('[data-action="focus-tab"]')?.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ action: 'grok:ensureActive', focusWindow: true, reason: 'user_click_toast' });
      } catch (_) { globalThis.SEOSONA_swallow?.('app#_t', _); }
    });
  }

  // Listen cloudflare:challenge broadcasts từ background
  try {
    chrome.runtime?.onMessage?.addListener((msg) => {
      if (msg?.action === 'cloudflare:challenge') {
        try { _showCloudflareToast(msg); } catch (e) { console.warn('[CloudflareToast] error:', e?.message); }
      }
    });
  } catch (_) { globalThis.SEOSONA_swallow?.('app#_t', _); }

  // U-1.5: Project context
  window._currentProjectId = null;
  window._currentProjectName = null;
  window._targetFlowTabId = null; // Tab ID mà sidePanel đang làm việc (tránh gửi message đến tab sai)
  let _projectNavigating = false;
  let _projectContextResolved = false; // Flag: đã nhận được response từ _requestProjectContext
  let _isInitialRetrying = false; // Flag: đang trong quá trình retry ban đầu (chưa show overlay)

  // Connecting overlay: hiển thị khi đang kết nối Flow page
  function _showConnectingOverlay() {
    const overlay = document.getElementById('seosonaflow-connecting-overlay');
    if (overlay) {
      overlay.classList.remove('hidden');
    }
  }

  function _hideConnectingOverlay() {
    const overlay = document.getElementById('seosonaflow-connecting-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }

  // Provider login polling state
  const _loginPollingState = {
    chatgpt: { active: false, intervalId: null },
    grok: { active: false, intervalId: null },
  };

  /**
   * Poll login status cho provider (ChatGPT/Grok) sau khi user mở tab login.
   * Khi phát hiện đã login → show toast thông báo + emit event để UI có thể retry.
   * Timeout 3 phút, poll mỗi 3 giây.
   *
   * @param {'chatgpt'|'grok'} provider
   * @param {number} tabId
   */
  async function _pollProviderLogin(provider, tabId) {
    if (!tabId || !provider) return;
    const state = _loginPollingState[provider];
    if (!state) return;

    // Nếu đang poll provider này → skip
    if (state.active) {
      console.log(`[SEOSONA Flow] Already polling ${provider} login`);
      return;
    }

    state.active = true;
    const POLL_INTERVAL = 3000; // 3s
    const TIMEOUT = 180000; // 3 phút
    const startTime = Date.now();

    const providerName = provider === 'chatgpt' ? 'ChatGPT' : 'Grok';
    const checkAction = `${provider}:checkLogin`;

    console.log(`[SEOSONA Flow] Start polling ${provider} login status, tabId=${tabId}`);

    const poll = async () => {
      // Timeout check
      if (Date.now() - startTime > TIMEOUT) {
        console.log(`[SEOSONA Flow] ${provider} login polling timeout`);
        _stopLoginPolling(provider);
        return;
      }

      try {
        // Check if tab still exists
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
          console.log(`[SEOSONA Flow] ${provider} tab closed, stop polling`);
          _stopLoginPolling(provider);
          return;
        }

        // Send check login request
        const resp = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: checkAction, tabId }, resolve);
        });

        if (resp?.success && resp?.ready) {
          console.log(`[SEOSONA Flow] ${provider} login detected!`);
          _stopLoginPolling(provider);

          // Show success toast
          window.showNotification?.(
            window.I18n?.t(`${provider}.loginSuccess`) || `Đã đăng nhập ${providerName}. Bạn có thể chạy lại task.`,
            'success',
            4000
          );

          // Emit event để UI có thể handle (vd: auto-retry)
          window.eventBus?.emit(`${provider}:login_success`, { tabId });
        }
      } catch (err) {
        console.warn(`[SEOSONA Flow] ${provider} login poll error:`, err.message);
      }
    };

    // Start polling
    state.intervalId = setInterval(poll, POLL_INTERVAL);
    // First poll immediately
    poll();
  }

  function _stopLoginPolling(provider) {
    const state = _loginPollingState[provider];
    if (!state) return;
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
    }
    state.active = false;
  }

  /**
   * Check queue trống và reload Flow page nếu cần trước khi run workflow/task.
   * Giúp đảm bảo Flow page ở trạng thái fresh, tránh stuck/stale state.
   *
   * Chỉ reload khi:
   * - Pipeline queue hoàn toàn trống (không có active jobs, pending items, downloads)
   * - Không đang trong quá trình reload khác
   *
   * @param {string} caller - Tên caller để log ('workflow' | 'task')
   * @returns {Promise<boolean>} true nếu đã reload hoặc không cần reload, false nếu lỗi
   */
  async function _checkQueueAndReloadIfEmpty(caller = 'workflow') {
    try {
      // Kiểm tra PromptQueue có tồn tại và có thể access không
      const queue = window.PromptQueue?.getInstance?.();
      if (!queue) {
        console.log(`[SEOSONA Flow] _checkQueueAndReloadIfEmpty(${caller}): PromptQueue not available, skip`);
        return true; // Không có queue → không cần reload
      }

      // Kiểm tra queue status
      const activeJobs = queue.activeJobCount || 0;
      const pendingItems = queue.pendingCount || 0;
      const isRunning = queue.isRunning || false;

      console.log(`[SEOSONA Flow] _checkQueueAndReloadIfEmpty(${caller}): activeJobs=${activeJobs}, pendingItems=${pendingItems}, isRunning=${isRunning}`);

      // Nếu queue đang có tác vụ → không reload, để tiếp tục bình thường
      if (activeJobs > 0 || pendingItems > 0 || isRunning) {
        console.log(`[SEOSONA Flow] _checkQueueAndReloadIfEmpty(${caller}): queue not empty, skip reload`);
        return true;
      }

      // Queue trống → reload Flow page
      console.log(`[SEOSONA Flow] _checkQueueAndReloadIfEmpty(${caller}): queue empty, reloading Flow page...`);

      // Hiện thông báo cho user biết đang reload (duration dài hơn để user thấy)
      window.showNotification?.(
        window.I18n?.t('common.refreshingFlow') || 'Đang làm mới trang Flow...',
        'info',
        5000
      );

      // Gửi reload message
      if (window.MessageBridge) {
        // Snapshot thời điểm trước reload để verify sau
        const reloadTimestamp = Date.now();

        try {
          await window.MessageBridge.sendToContentScript('autoReloadFlow', {});
        } catch (e) {
          console.warn(`[SEOSONA Flow] _checkQueueAndReloadIfEmpty(${caller}): reload message failed:`, e.message);
          return true; // Vẫn cho phép tiếp tục nếu reload fail
        }

        // Chờ content script mất kết nối (reload thật) rồi mới poll ready
        // Timeout ngắn để detect reload đã xảy ra
        await new Promise(r => setTimeout(r, 500));

        // Chờ editor ready (max 15s)
        const ready = await _waitForFlowEditorReady(15000);
        const reloadDuration = Date.now() - reloadTimestamp;

        // Chỉ hiện notification khi:
        // 1. Editor ready
        // 2. Đã có thời gian reload hợp lý (> 1s) - tránh false positive khi editor đã ready từ trước
        if (!ready) {
          console.warn(`[SEOSONA Flow] _checkQueueAndReloadIfEmpty(${caller}): editor not ready after reload`);
          window.showNotification?.(
            window.I18n?.t('common.flowReloadFailed') || 'Không thể làm mới trang Flow',
            'warning',
            3000
          );
        } else if (reloadDuration > 1000) {
          // Thông báo reload thành công - chỉ khi thực sự có reload (> 1s)
          console.log(`[SEOSONA Flow] _checkQueueAndReloadIfEmpty(${caller}): reload done in ${reloadDuration}ms`);
          window.showNotification?.(
            window.I18n?.t('common.flowReady') || 'Trang Flow đã sẵn sàng',
            'success',
            2000
          );
        } else {
          // Editor ready quá nhanh → có thể không thực sự reload, skip notification
          console.log(`[SEOSONA Flow] _checkQueueAndReloadIfEmpty(${caller}): ready too fast (${reloadDuration}ms), skip notification`);
        }

        // Extra settle delay cho React render
        await new Promise(r => setTimeout(r, 1500));

        console.log(`[SEOSONA Flow] _checkQueueAndReloadIfEmpty(${caller}): reload complete`);
      }

      return true;
    } catch (err) {
      console.error(`[SEOSONA Flow] _checkQueueAndReloadIfEmpty(${caller}) error:`, err.message);
      return true; // Vẫn cho phép tiếp tục nếu có lỗi
    }
  }

  /**
   * Chờ Flow editor ready sau reload.
   * Sử dụng checkContentScriptAlive handler (trả về { alive, hasEditor }).
   * @param {number} timeout - Max time to wait (ms)
   * @returns {Promise<boolean>}
   */
  async function _waitForFlowEditorReady(timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const resp = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), 3000);
          if (window.MessageBridge) {
            window.MessageBridge.sendToContentScript('checkContentScriptAlive', {})
              .then(r => { clearTimeout(timer); resolve(r); })
              .catch(e => { clearTimeout(timer); reject(e); });
          } else {
            clearTimeout(timer);
            reject(new Error('no MessageBridge'));
          }
        });
        // checkContentScriptAlive trả về { alive: true, hasEditor: boolean }
        if (resp?.alive && resp?.hasEditor) return true;
      } catch (_) {
        // Ignore và retry
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  // Expose để workflow/task có thể gọi
  window._checkQueueAndReloadIfEmpty = _checkQueueAndReloadIfEmpty;

  // Extract project name từ tab/document title (fallback khi DOM extraction fail)
  // Flow title format: "ProjectName - Flow - Labs" hoặc "ProjectName — Google Labs"
  function _extractProjectNameFromTitle(title) {
    if (!title) return null;
    // Format: "Flow - Project Name" hoặc "Project Name - Flow - Labs"
    const parts = title.split(/\s*[-–—|]\s*/);
    // Tìm phần KHÔNG phải generic text (Flow, Labs, Google...)
    for (const part of parts) {
      const candidate = part.trim();
      if (!candidate || candidate.length === 0 || candidate.length >= 100) continue;
      const lower = candidate.toLowerCase();
      if (lower === 'flow' || lower === 'labs' || lower.includes('labs.google')
        || lower.includes('google')) continue;
      return candidate;
    }
    return null;
  }

  // U-1.6: Lưu project vào danh sách đã truy cập + sync lên backend
  async function _saveProjectToList(projectId, projectName) {
    if (!projectId) return;
    try {
      const result = await chrome.storage.local.get('af_projects');
      const projects = result.af_projects || {};
      projects[projectId] = {
        name: projectName || projects[projectId]?.name || projectId.substring(0, 8),
        last_accessed: Date.now()
      };
      await chrome.storage.local.set({ af_projects: projects });

      // Sync lên backend (fire and forget)
      if (window.ProjectHelper?.syncCurrentProject && projectName) {
        window.ProjectHelper.syncCurrentProject().catch(function (_e) { globalThis.SEOSONA_swallow?.('app#_saveProjectToList', _e); });
      }
    } catch (e) {
      console.warn('[SEOSONA Flow] _saveProjectToList error:', e.message);
    }
  }

  // Xóa project khỏi danh sách
  async function _removeProjectFromList(projectId) {
    if (!projectId) return;
    try {
      const result = await chrome.storage.local.get('af_projects');
      const projects = result.af_projects || {};
      delete projects[projectId];
      await chrome.storage.local.set({ af_projects: projects });
    } catch (e) {
      console.warn('[SEOSONA Flow] _removeProjectFromList error:', e.message);
    }
  }

  // Auto-cleanup projects quá cũ (>30 ngày không access)
  async function _cleanupStaleProjects() {
    try {
      const result = await chrome.storage.local.get('af_projects');
      const projects = result.af_projects || {};
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 ngày
      let changed = false;
      for (const [id, data] of Object.entries(projects)) {
        if (data.last_accessed && data.last_accessed < cutoff && id !== window._currentProjectId) {
          delete projects[id];
          changed = true;
        }
      }
      if (changed) {
        await chrome.storage.local.set({ af_projects: projects });
        console.log('[SEOSONA Flow] Đã dọn projects cũ (>30 ngày)');
      }
    } catch (e) {
      console.warn('[SEOSONA Flow] _cleanupStaleProjects error:', e.message);
    }
  }

  // Sync danh sách projects từ Flow DOM (scan home page) + tab titles
  async function _syncProjectsFromFlow() {
    try {
      const tabs = await chrome.tabs.query({ url: window.ProviderConfigManager?.getTabQuery('flow') });
      if (tabs.length === 0) return;

      // Phase 1: Sync tên project từ các tab đang mở trong project (via tab.title + getProjectContext)
      const projectTabs = tabs.filter(t => t.url && t.url.match(/\/project\/[a-f0-9-]+/));
      if (projectTabs.length > 0) {
        const result0 = await chrome.storage.local.get('af_projects');
        const projects0 = result0.af_projects || {};
        let changed0 = false;
        for (const pt of projectTabs) {
          const pidMatch = pt.url.match(/\/project\/([a-f0-9-]+)/);
          if (!pidMatch) continue;
          const pid = pidMatch[1];

          // Lấy tên từ content.js (extractProjectName)
          let pName = null;
          try {
            const ctxResp = await new Promise((resolve) => {
              chrome.tabs.sendMessage(pt.id, { action: 'getProjectContext' }, (r) => {
                if (chrome.runtime.lastError) resolve(null);
                else resolve(r);
              });
            });
            pName = ctxResp?.projectName || null;
          } catch (e) { globalThis.SEOSONA_swallow?.('app#_syncProjectsFromFlow', e); }

          // Fallback: tab title
          if (!pName && pt.title) {
            pName = _extractProjectNameFromTitle(pt.title);
          }

          if (pName && projects0[pid] && projects0[pid].name !== pName) {
            projects0[pid].name = pName;
            changed0 = true;
          }
          if (pName && !projects0[pid]) {
            projects0[pid] = { name: pName, last_accessed: 0 };
            changed0 = true;
          }
        }
        if (changed0) {
          await chrome.storage.local.set({ af_projects: projects0 });
        }
      }

      // Phase 2: Scan home page cho project list (nếu có tab ở homepage)
      const homeTab = tabs.find(t => t.url && !t.url.match(/\/project\/[a-f0-9-]+/));
      const targetTab = homeTab || tabs[0];

      const resp = await new Promise((resolve) => {
        chrome.tabs.sendMessage(targetTab.id, { action: 'scanFlowProjects' }, (r) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r);
        });
      });

      if (!resp?.projects?.length) return;

      const result = await chrome.storage.local.get('af_projects');
      const projects = result.af_projects || {};
      let changed = false;

      // Tập hợp project IDs thực sự còn tồn tại trên Flow
      const flowProjectIds = new Set(resp.projects.map(p => p.id));

      // Cập nhật tên project từ Flow DOM (rename detection)
      for (const fp of resp.projects) {
        if (fp.name && projects[fp.id] && projects[fp.id].name !== fp.name) {
          projects[fp.id].name = fp.name;
          changed = true;
        }
        // Nếu project trên Flow mà extension chưa biết → thêm vào
        if (!projects[fp.id]) {
          projects[fp.id] = {
            name: fp.name || fp.id.substring(0, 8),
            last_accessed: 0 // Chưa access qua extension
          };
          changed = true;
        }
      }

      // Đánh dấu projects không còn trên Flow (chỉ khi scan được từ home page)
      if (resp.isHomePage) {
        for (const [id, data] of Object.entries(projects)) {
          if (!flowProjectIds.has(id) && id !== window._currentProjectId) {
            // Không xóa ngay — đánh dấu _notOnFlow để xử lý sau
            if (!data._notOnFlow) {
              projects[id]._notOnFlow = Date.now();
              changed = true;
            } else if (Date.now() - data._notOnFlow > 7 * 24 * 60 * 60 * 1000) {
              // Đã 7 ngày không thấy trên Flow → xóa
              delete projects[id];
              changed = true;
            }
          } else if (data._notOnFlow && flowProjectIds.has(id)) {
            // Project xuất hiện lại → xóa flag
            delete data._notOnFlow;
            changed = true;
          }
        }
      }

      if (changed) {
        await chrome.storage.local.set({ af_projects: projects });
      }
    } catch (e) {
      // sidePanel có thể không có chrome.tabs
      console.warn('[SEOSONA Flow] _syncProjectsFromFlow error:', e.message);
    }
  }

  // U-4.6: Cap nhat project indicator tren sidebar
  function _updateProjectIndicator() {
    const indicator = document.getElementById('project-indicator');
    const nameEl = document.getElementById('project-indicator-name');
    if (!indicator || !nameEl) return;

    if (window._currentProjectId && window._currentProjectName) {
      indicator.style.display = '';
      nameEl.textContent = window._currentProjectName;
    } else if (window._currentProjectId) {
      indicator.style.display = '';
      nameEl.textContent = window._currentProjectId.substring(0, 12) + '...';
    } else {
      indicator.style.display = 'none';
    }
  }

  function _setProjectNavigating(active) {
    _projectNavigating = active;
    const indicator = document.getElementById('project-indicator');
    const overlay = document.querySelector('.project-select-overlay');
    if (indicator) {
      indicator.classList.toggle('project-navigating', active);
    }
    if (overlay) {
      overlay.classList.toggle('project-navigating', active);
    }
  }

  // U-4.6: Toggle project dropdown
  async function _toggleProjectDropdown() {
    if (_projectNavigating) return;
    const dropdown = document.getElementById('project-indicator-dropdown');
    if (!dropdown) return;

    if (dropdown.style.display !== 'none') {
      dropdown.style.display = 'none';
      return;
    }

    const result = await chrome.storage.local.get('af_projects');
    const projects = result.af_projects || {};
    const sorted = Object.entries(projects)
      .sort(([, a], [, b]) => (b.last_accessed || 0) - (a.last_accessed || 0));

    if (sorted.length === 0) {
      dropdown.innerHTML = `<div class="project-indicator-item" style="color: rgba(255,255,255,0.4); cursor: default;">${window.I18n?.t('project.noProjects') || 'Chưa có project'}</div>`;
    } else {
      dropdown.innerHTML = sorted.map(([id, data]) => {
        const isActive = id === window._currentProjectId;
        const name = data.name || id.substring(0, 12);
        const date = data.last_accessed ? window.I18n?.formatDate?.(data.last_accessed) || new Date(data.last_accessed).toLocaleDateString() : '';
        const staleClass = data._notOnFlow ? ' project-indicator-item--stale' : '';
        return `<div class="project-indicator-item${isActive ? ' active' : ''}${staleClass}" data-project-id="${id}">
          <div class="project-indicator-item-info">
            <span class="project-indicator-item-name">${name}</span>
            <span class="project-indicator-item-date">${date}</span>
          </div>
          ${!isActive ? `<button class="project-indicator-item-delete" data-delete-id="${id}" title="Xóa khỏi danh sách">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>` : ''}
        </div>`;
      }).join('');
    }

    dropdown.style.display = '';

    // Delete handler
    dropdown.querySelectorAll('.project-indicator-item-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const deleteId = btn.dataset.deleteId;
        await _removeProjectFromList(deleteId);
        btn.closest('.project-indicator-item').remove();
        // Nếu list rỗng, cập nhật
        if (!dropdown.querySelector('.project-indicator-item[data-project-id]')) {
          dropdown.innerHTML = `<div class="project-indicator-item" style="color: rgba(255,255,255,0.4); cursor: default;">${window.I18n?.t('project.noProjects') || 'Chưa có project'}</div>`;
        }
      });
    });

    // Click handler for items
    dropdown.querySelectorAll('.project-indicator-item[data-project-id]').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.project-indicator-item-delete')) return;
        if (_projectNavigating) return;
        const projectId = item.dataset.projectId;
        if (projectId === window._currentProjectId) {
          dropdown.style.display = 'none';
          return;
        }

        // Disable select trong khi redirect
        _setProjectNavigating(true);

        // Cập nhật project state + UI + emit event để reload data
        const projectData = projects[projectId];
        const projectName = projectData?.name || projectId.substring(0, 12);
        const oldId = window._currentProjectId;
        window._currentProjectId = projectId;
        window._currentProjectName = projectName;
        _updateProjectIndicator();
        _saveProjectToList(projectId, projectName);

        // Emit project:changed để các tab reload data
        if (oldId !== projectId) {
          window.eventBus?.emit('project:changed', { projectId, projectName });
        }

        // Group C/Initiative 7: base URL từ ProviderConfigManager (server-driven).
        // Pattern '/vi/' locale strip — Google auto-redirect theo browser locale.
        const _flowBase = window.ProviderConfigManager?.getBaseUrlSync('flow');
        chrome.runtime.sendMessage({
          action: 'navigateToProject',
          url: `${_flowBase}/project/${projectId}`,
          projectId
        });
        dropdown.style.display = 'none';

        // After navigation, confirm project context with retry
        _requestProjectContextWithRetry(3, 1500);
      });
    });

    // Close on click outside
    // Audit fix (memory leak): the dropdown can be re-rendered while open, which
    // previously stacked a new document click listener each time. Remove any
    // previously-bound handler before binding a fresh one so only one exists.
    if (_projectDropdownCloseHandler) {
      document.removeEventListener('click', _projectDropdownCloseHandler);
      _projectDropdownCloseHandler = null;
    }
    const closeHandler = (e) => {
      if (!dropdown.contains(e.target) && e.target.id !== 'project-indicator-btn') {
        dropdown.style.display = 'none';
        document.removeEventListener('click', closeHandler);
        if (_projectDropdownCloseHandler === closeHandler) _projectDropdownCloseHandler = null;
      }
    };
    _projectDropdownCloseHandler = closeHandler;
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  // Regex chuẩn cho Flow URL — locale prefix có thể là vi/en/ja/th/ko/zh/.../không có
  // Examples: https://labs.google/fx/tools/flow, /fx/vi/tools/flow, /fx/en/tools/flow
  const FLOW_HOMEPAGE_REGEX = /^https:\/\/labs\.google\/fx(\/[a-z]{2,5})?\/tools\/flow\/?(\?.*)?$/;
  const FLOW_PROJECT_REGEX = /\/project\/[a-f0-9-]+/;
  const _isFlowHomepageTab = (tab) => !!(tab?.url && FLOW_HOMEPAGE_REGEX.test(tab.url));
  const _isFlowProjectTab = (tab) => !!(tab?.url && FLOW_PROJECT_REGEX.test(tab.url));

  // Tạo dự án mới — smart: nếu đã có Flow homepage tab → click trực tiếp, không reload.
  // Nếu chưa có → navigate tới Flow home rồi mới click.
  async function _createNewProject() {
    if (_projectNavigating) return;
    _setProjectNavigating(true);

    // Check Flow tabs sẵn có
    let homepageTab = null;
    try {
      const tabs = await chrome.tabs.query({ url: window.ProviderConfigManager?.getTabQuery('flow') });
      homepageTab = tabs.find(_isFlowHomepageTab);
    } catch (e) { /* ignore */ }

    // Xóa trắng ô prompt khi tạo project mới
    if (window.GenTab && window.GenTab.promptsArea) {
      window.GenTab.promptsArea.value = '';
      window.GenTab.promptsArea.dispatchEvent(new Event('input', { bubbles: true }));
      window.GenTab.saveState();
    }

    const handleClickResp = (resp) => {
      if (resp?.success) {
        _requestProjectContextWithRetry(5, 2000);
      } else {
        console.warn('[SEOSONA Flow] Không tìm thấy nút tạo dự án:', resp?.result?.error || resp?.error);
        _setProjectNavigating(false);
      }
    };

    if (homepageTab) {
      // Có Flow homepage tab → activate + click trực tiếp (không reload, nhanh hơn)
      try {
        await chrome.tabs.update(homepageTab.id, { active: true });
        await chrome.windows?.update?.(homepageTab.windowId, { focused: true });
      } catch (e) { /* ignore */ }
      // Delay 300ms cho tab active settle, sau đó click
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'clickCreateNewProject' }, handleClickResp);
      }, 300);
    } else {
      // Không có Flow tab → navigate tới Flow home + click
      // Group C/Initiative 7: base URL từ ProviderConfigManager
      const _flowHome = window.ProviderConfigManager?.getBaseUrlSync('flow');
      chrome.runtime.sendMessage({
        action: 'navigateToProject',
        url: _flowHome
      }, () => {
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'clickCreateNewProject' }, handleClickResp);
        }, 1000);
      });
    }
  }
  // Expose để MCP (McpExecutor.create_project) dùng ĐÚNG flow nút sidebar (smart homepage detect
  // → activate/navigate → click). Tránh duplicate logic + đảm bảo hành vi giống hệt nút "Tạo dự án".
  window._createNewProject = _createNewProject;

  // Debounce duplicate calls — tab activation event + flowTabActivated message
  // có thể fire trong vòng <500ms gây 2 lần init duplicate
  let _requestProjectContextTimer = null;
  let _requestProjectContextInflight = null;
  async function _requestProjectContext() {
    // Nếu đang in-flight → return same promise (dedup concurrent)
    if (_requestProjectContextInflight) return _requestProjectContextInflight;
    // Nếu vừa fire trong 500ms gần đây → reject duplicate
    if (_requestProjectContextTimer) return;
    _requestProjectContextTimer = setTimeout(() => { _requestProjectContextTimer = null; }, 500);

    _requestProjectContextInflight = (async () => {
      try {
        return await _requestProjectContextImpl();
      } finally {
        _requestProjectContextInflight = null;
      }
    })();
    return _requestProjectContextInflight;
  }

  // U-1.5: Yêu cầu project context từ content.js
  async function _requestProjectContextImpl() {
    // Helper: xử lý response từ content.js
    // tabId: ID của tab mà response đến từ (để track target tab)
    function _handleProjectResponse(resp, tabId = null, tabTitle = null) {
      const isSubsequentUpdate = _projectContextResolved;
      const oldProjectId = window._currentProjectId;
      _projectContextResolved = true;
      _hideConnectingOverlay();
      // projectError=true → project lỗi/đã xoá (URL còn /project/ nhưng trang "Đã xảy ra lỗi")
      // → coi như CHƯA có project hợp lệ → rơi vào nhánh else (show overlay chọn project).
      if (resp?.projectId && resp.projectError !== true) {
        // KIỂM TRA CHUYỂN PROJECT: Xóa trắng prompt để tránh ám cache sang project khác
        if (isSubsequentUpdate && oldProjectId !== resp.projectId) {
          if (window.GenTab && window.GenTab.promptsArea) {
            window.GenTab.promptsArea.value = '';
            window.GenTab.promptsArea.dispatchEvent(new Event('input', { bubbles: true }));
            window.GenTab.saveState?.();
          }
        }
        window._currentProjectId = resp.projectId;
        // Project name resolution chain:
        // 1. extractProjectName() từ DOM header input
        // 2. document.title parsing (từ content.js)
        // 3. Chrome tab.title parsing (từ caller)
        // 4. null (sẽ fallback trong _saveProjectToList)
        let projectName = resp.projectName || null;
        if (!projectName) {
          projectName = _extractProjectNameFromTitle(resp.documentTitle || tabTitle);
        }
        window._currentProjectName = projectName;
        // CRITICAL: Lưu tabId để MessageBridge gửi message đến đúng tab
        if (tabId) {
          window._targetFlowTabId = tabId;
          window.MessageBridge?.setTargetTabId?.(tabId);
          console.log('[SEOSONA Flow] Target Flow tab set:', tabId, 'Project:', resp.projectId, 'Name:', projectName);
          // Apply Flow page settings sớm (Grid view + show tile details) — 1-time per tab session
          window.MessageBridge?.sendToContentScript?.('applyFlowPageSettings', {}).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#_handleProjectResponse', _e); });
        }
        _saveProjectToList(resp.projectId, projectName);
        _hideProjectSelectOverlay();
        _updateProjectIndicator();
        _setProjectNavigating(false);
      } else {
        // Home page hoặc không có project → show overlay (trừ khi đang retry)
        window._currentProjectId = null;
        window._currentProjectName = null;
        // Vẫn track tab active để có thể gửi message (dù không có project)
        if (tabId) {
          window._targetFlowTabId = tabId;
          window.MessageBridge?.setTargetTabId?.(tabId);
          // Apply Flow page settings sớm — 1-time per tab session
          window.MessageBridge?.sendToContentScript?.('applyFlowPageSettings', {}).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#_handleProjectResponse', _e); });
        }
        _updateProjectIndicator();
        // CRITICAL: Chỉ show overlay nếu KHÔNG đang trong quá trình retry
        // (để tránh show overlay khi content.js chưa sẵn sàng)
        if (!_isInitialRetrying) {
          _showProjectSelectOverlay();
        }
      }
    }

    try {
      // Gửi message tới tất cả Flow tabs — tìm tab có project
      const tabs = await chrome.tabs.query({ url: window.ProviderConfigManager?.getTabQuery('flow') });
      if (tabs.length === 0) {
        window._targetFlowTabId = null;
        _handleProjectResponse(null);
        return;
      }

      // Tìm active Flow tab trước, sau đó fallback các tab khác
      const activeTab = tabs.find(t => t.active) || tabs[0];
      const orderedTabs = [activeTab, ...tabs.filter(t => t.id !== activeTab.id)];

      let foundProject = false;
      for (const tab of orderedTabs) {
        try {
          const resp = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { action: 'getProjectContext' }, (r) => {
              if (chrome.runtime.lastError) resolve(null);
              else resolve(r);
            });
          });
          // Bỏ qua tab có project LỖI/ĐÃ XOÁ (projectError) → tiếp tục quét tab khác (có thể có project hợp lệ)
          if (resp?.projectId && !resp.projectError) {
            _handleProjectResponse(resp, tab.id, tab.title); // Truyền tabId + title fallback
            foundProject = true;
            break;
          }
        } catch (e) { globalThis.SEOSONA_swallow?.('app#_handleProjectResponse', e); }
      }

      // Không tab nào có project → dùng active tab
      if (!foundProject) {
        window._targetFlowTabId = activeTab.id;
        _handleProjectResponse(null, activeTab.id);
      }
    } catch (e) {
      // sidePanel context might not have chrome.tabs — use background.js
      try {
        chrome.runtime.sendMessage({ action: 'getFlowProjectContext' }, (resp) => {
          if (chrome.runtime.lastError) {
            _handleProjectResponse(null);
            return;
          }
          // background.js trả về cả tabId + tabTitle
          _handleProjectResponse(resp, resp?.tabId || null, resp?.tabTitle || null);
        });
      } catch (e2) {
        _handleProjectResponse(null);
      }
    }
  }

  // Retry _requestProjectContext after navigation to confirm sidebar state
  // CRITICAL: Chỉ retry nếu chưa có currentProjectId (content.js có thể chưa sẵn sàng)
  // firstCallImmediate: gọi ngay lần đầu (không delay), chỉ delay cho retry sau
  // suppressOverlay: true → không show overlay cho đến khi hết retry (dùng cho init)
  function _requestProjectContextWithRetry(maxRetries = 3, delayMs = 1500, firstCallImmediate = false, suppressOverlay = false) {
    let attempt = 0;
    // Nếu suppressOverlay, đặt flag để _handleProjectResponse không show overlay
    if (suppressOverlay) {
      _isInitialRetrying = true;
    }
    const tryRequest = async () => {
      attempt++;
      await _requestProjectContext();
      // Chỉ retry nếu vẫn chưa có project (content.js có thể chưa ready)
      if (!window._currentProjectId && attempt < maxRetries) {
        setTimeout(() => tryRequest(), delayMs);
      } else {
        // Hết retry hoặc đã tìm thấy project
        if (suppressOverlay) {
          _isInitialRetrying = false;
          _hideConnectingOverlay();
          // Nếu vẫn không có project sau khi hết retry → show overlay ngay
          if (!window._currentProjectId) {
            _showProjectSelectOverlay();
          }
        }
        // Safety: clear navigating state sau khi hết retries
        _setProjectNavigating(false);
      }
    };
    if (firstCallImmediate) {
      tryRequest();
    } else {
      setTimeout(() => tryRequest(), delayMs);
    }
  }

  // U-4.5: Project select overlay
  // guideIfNoTab: chỉ khi user THAO TÁC workflow (openEditor) mới hiện guidance modal lúc no-tab.
  // Init callers (retry/safety-net) truyền false → silent như cũ, tránh nag mỗi lần mở sidebar.
  async function _showProjectSelectOverlay(guideIfNoTab = false) {
    const container = document.getElementById('sidebar-content') || document.body;
    // Kiểm tra đã có overlay chưa
    if (container.querySelector('.project-select-overlay')) return;

    // [Layer 1] DEFENSIVE GUARD + check Flow tab availability
    // 3 case:
    //   1. CÓ Flow project tab → sync state silent + ABORT show modal
    //   2. CÓ Flow homepage tab (no project) → render modal Select project bình thường
    //   3. KHÔNG có Flow tab nào → ABORT show modal (overlay "Chưa mở Google Flow" sẽ handle)
    try {
      if (chrome.tabs?.query) {
        const tabs = await chrome.tabs.query({ url: window.ProviderConfigManager?.getTabQuery('flow') });
        // Case 3: không có Flow tab.
        //   - guideIfNoTab=true (user bấm mở workflow editor): HƯỚNG DẪN mở Flow + tạo project
        //     (trước đây abort im lặng → user không được guide → có thể tạo workflow rồi kẹt vì không có project).
        //   - guideIfNoTab=false (init retry/safety-net): silent abort như cũ, tránh nag mỗi lần mở sidebar.
        if (tabs.length === 0) {
          if (guideIfNoTab) {
            console.log('[SEOSONA Flow] _showProjectSelectOverlay: no Flow tab → guide user to open Flow + create project');
            window.ProjectHelper?.warnNoProjectForUpload?.(null,
              window.I18n?.t('workflow.noProjectForWorkflow')
              || 'Bạn chưa mở Google Flow hoặc chưa vào 1 project. Hãy mở Flow rồi tạo/chọn 1 project để dùng workflow.');
          }
          return;
        }
        // Case 1: có project HỢP LỆ (không error) → sync + abort. Hỏi getProjectContext THẬT để
        // biết projectError (project đã xoá vẫn còn /project/{id} trong URL nhưng render trang lỗi)
        // → KHÔNG abort cho project lỗi → render modal chọn project.
        for (const tab of tabs) {
          const ctx = await new Promise(r => {
            try { chrome.tabs.sendMessage(tab.id, { action: 'getProjectContext' }, resp => r(chrome.runtime.lastError ? null : resp)); }
            catch (_) { r(null); }
          });
          if (ctx?.projectId && ctx.projectError !== true) {
            if (window._currentProjectId !== ctx.projectId) {
              console.log('[SEOSONA Flow] _showProjectSelectOverlay aborted: defensive guard found project', ctx.projectId);
              window._currentProjectId = ctx.projectId;
              window._targetFlowTabId = tab.id;
              window.MessageBridge?.setTargetTabId?.(tab.id);
              _updateProjectIndicator();
            }
            return;  // Skip show overlay — có project hợp lệ
          }
          // project lỗi/đã xoá (ctx.projectError) HOẶC homepage (no projectId) → tiếp tục render modal
        }
        // Case 2: không tab nào có project hợp lệ (homepage / đã xoá) → render modal
      }
    } catch (e) { /* fail open — tiếp tục show */ }

    const result = await chrome.storage.local.get('af_projects');
    let projects = result.af_projects || {};

    // Sync project list từ Flow homepage tab — chạy 1 lần khi modal mở.
    // Helper show/hide loading indicator trong modal header.
    const _setSyncingUI = (overlayEl, isSyncing) => {
      if (!overlayEl || !overlayEl.isConnected) return;
      const indicator = overlayEl.querySelector('.project-select-syncing');
      if (indicator) indicator.style.display = isSyncing ? 'inline-flex' : 'none';
    };
    const _asyncScanFlowProjects = window._asyncScanFlowProjects = async (overlayEl, force = false) => {
      // [ANTI-LOOP] 3 lớp guard:
      //   1. _modalScanInProgress: block concurrent — modal mở/đóng nhanh không spawn 2 scan
      //   2. _lastModalScanTime: cooldown 10s — modal mở/đóng/mở liên tục không re-scan
      //      (force=true bypass cooldown — user explicit click resync button)
      //   3. abort khi overlay disconnected (modal đóng giữa chừng → skip update)
      if (window._modalScanInProgress) {
        console.log('[SEOSONA Flow] scanFlowProjects SKIP: already in progress');
        _setSyncingUI(overlayEl, false);
        return;
      }
      const now = Date.now();
      const MODAL_SCAN_COOLDOWN_MS = 10000;
      if (!force && window._lastModalScanTime && (now - window._lastModalScanTime < MODAL_SCAN_COOLDOWN_MS)) {
        const remainSec = Math.ceil((MODAL_SCAN_COOLDOWN_MS - (now - window._lastModalScanTime)) / 1000);
        console.log('[SEOSONA Flow] scanFlowProjects SKIP: cooldown', remainSec + 's remaining (use resync button to force)');
        _setSyncingUI(overlayEl, false);
        return;
      }
      window._modalScanInProgress = true;
      window._lastModalScanTime = now;
      if (force) console.log('[SEOSONA Flow] scanFlowProjects FORCE: resync button clicked');
      try {
        if (!chrome.tabs?.query) return;
        const flowTabs = await chrome.tabs.query({ url: window.ProviderConfigManager?.getTabQuery('flow') });
        if (flowTabs.length === 0) return;
        const homeTab = flowTabs.find(t => t.url && !t.url.match(/\/project\/[a-f0-9-]+/));
        const scanTab = homeTab || flowTabs[0];
        // Show loading indicator
        _setSyncingUI(overlayEl, true);
        const scanResult = await Promise.race([
          new Promise((resolve) => {
            chrome.tabs.sendMessage(scanTab.id, { action: 'scanFlowProjects' }, (r) => {
              if (chrome.runtime.lastError) resolve(null);
              else resolve(r);
            });
          }),
          new Promise((resolve) => setTimeout(() => resolve(null), 12000)) // scroll lazy-load ~8s worst-case
        ]);
        if (!scanResult?.projects?.length) {
          _setSyncingUI(overlayEl, false);
          return;
        }

        // Re-read storage (có thể đã thay đổi)
        const freshResult = await chrome.storage.local.get('af_projects');
        const freshProjects = freshResult.af_projects || {};
        const flowProjectIds = new Set(scanResult.projects.map(p => p.id));
        let changed = false;

        if (scanResult.isHomePage) {
          for (const [id, data] of Object.entries(freshProjects)) {
            if (!flowProjectIds.has(id)) {
              if (!data._notOnFlow) { freshProjects[id] = { ...data, _notOnFlow: true }; changed = true; }
            } else if (data._notOnFlow) {
              delete freshProjects[id]._notOnFlow; changed = true;
            }
          }
        }
        for (const proj of scanResult.projects) {
          if (!freshProjects[proj.id]) {
            freshProjects[proj.id] = {
              name: proj.name || proj.id.substring(0, 8),
              last_accessed: Date.now(),
              flowOrder: proj.flowOrder,  // DOM order trên Flow homepage
            };
            changed = true;
          } else {
            // Update name nếu Flow đã rename
            if (proj.name && freshProjects[proj.id].name !== proj.name) {
              freshProjects[proj.id].name = proj.name;
              changed = true;
            }
            // ALWAYS update flowOrder mỗi lần scan (Flow re-sort khi modify project)
            if (typeof proj.flowOrder === 'number' && freshProjects[proj.id].flowOrder !== proj.flowOrder) {
              freshProjects[proj.id].flowOrder = proj.flowOrder;
              changed = true;
            }
          }
        }
        if (!changed) {
          _setSyncingUI(overlayEl, false);
          return;
        }
        await chrome.storage.local.set({ af_projects: freshProjects });

        // Update overlay list nếu vẫn còn trên DOM
        if (!overlayEl || !overlayEl.isConnected) {
          _setSyncingUI(overlayEl, false);
          return;
        }
        const listEl = overlayEl.querySelector('.project-select-list');
        const countEl = overlayEl.querySelector('.project-select-search-count');
        if (!listEl) {
          _setSyncingUI(overlayEl, false);
          return;
        }

        // Sort theo flowOrder ASC (preserve thứ tự Flow homepage), fallback last_accessed DESC
        const updatedSorted = Object.entries(freshProjects)
          .sort(([, a], [, b]) => {
            const aHasOrder = typeof a.flowOrder === 'number';
            const bHasOrder = typeof b.flowOrder === 'number';
            if (aHasOrder && bHasOrder) return a.flowOrder - b.flowOrder;
            if (aHasOrder) return -1;  // có flowOrder → ưu tiên lên đầu
            if (bHasOrder) return 1;
            return (b.last_accessed || 0) - (a.last_accessed || 0);  // fallback
          });
        listEl.innerHTML = updatedSorted.map(([id, data]) => _buildProjectItemHTML(id, data)).join('');
        if (countEl) countEl.textContent = `${updatedSorted.length}`;
        // Hide loading + show synced indicator briefly
        const indicator = overlayEl.querySelector('.project-select-syncing');
        if (indicator) {
          indicator.innerHTML = '<span style="color: #19d07b;">✓</span> ' + (window.I18n?.t('project.synced') || 'Đã đồng bộ');
          setTimeout(() => _setSyncingUI(overlayEl, false), 1500);
        }
      } catch (err) {
        console.warn('[SEOSONA Flow] async scanFlowProjects failed:', err.message);
        _setSyncingUI(overlayEl, false);
      } finally {
        // [ANTI-LOOP] release flag dù success hay fail — đảm bảo modal sau có thể scan
        window._modalScanInProgress = false;
      }
    };

    // Sort theo flowOrder ASC (preserve Flow homepage order), fallback last_accessed DESC
    const sorted = Object.entries(projects)
      .sort(([, a], [, b]) => {
        const aHasOrder = typeof a.flowOrder === 'number';
        const bHasOrder = typeof b.flowOrder === 'number';
        if (aHasOrder && bHasOrder) return a.flowOrder - b.flowOrder;
        if (aHasOrder) return -1;
        if (bHasOrder) return 1;
        return (b.last_accessed || 0) - (a.last_accessed || 0);
      });

    const overlay = document.createElement('div');
    overlay.className = 'project-select-overlay';

    // Build compact project item HTML (single row: name + date inline)
    function _buildProjectItemHTML(id, data) {
      const date = data.last_accessed ? window.I18n?.formatDate?.(data.last_accessed) || new Date(data.last_accessed).toLocaleDateString() : '';
      const name = data.name || id.substring(0, 8);
      const staleClass = data._notOnFlow ? ' project-select-item--stale' : '';
      const staleSuffix = data._notOnFlow ? ` · ${I18n.t('project.maybeDeleted')}` : '';
      return `<div class="project-select-item${staleClass}" data-project-id="${id}" data-project-name="${(name || '').toLowerCase()}" title="${name}${date ? ' — ' + date : ''}">
        <div class="project-select-item-info">
          <span class="project-select-name">${name}</span>
          ${date ? `<span class="project-select-date">${date}${staleSuffix}</span>` : ''}
        </div>
        <button class="project-select-item-delete" data-delete-id="${id}" title="${I18n.t('common.delete')}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>`;
    }

    const hasProjects = sorted.length > 0;

    overlay.innerHTML = `
      <div class="project-select-content">
        <div class="project-select-header" style="display: flex; align-items: flex-start; gap: 10px;">
          <svg class="project-select-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <div class="project-select-header-text" style="flex: 1; min-width: 0;">
            <div class="project-select-title">
              ${I18n.t('project.selectTitle')}
              <span class="project-select-syncing" style="display: none; margin-left: 8px; font-size: 11px; font-weight: 400; color: rgba(255,255,255,0.6); align-items: center; gap: 4px;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite;">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                ${I18n.t('project.syncing') || 'Đang đồng bộ...'}
              </span>
            </div>
            <div class="project-select-desc">${I18n.t('project.selectDesc')}</div>
          </div>
          <button class="project-select-resync" type="button"
                  title="${I18n.t('project.resync') || 'Đồng bộ lại'}"
                  style="flex-shrink: 0; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
                         background: transparent; border: 1px solid rgba(255,255,255,0.12); border-radius: 6px;
                         color: rgba(255,255,255,0.65); cursor: pointer; transition: all 0.15s;">
            <svg class="project-select-resync-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </div>
        <div class="project-select-search-wrap">
          <svg class="project-select-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" class="project-select-search" placeholder="${I18n.t('project.searchPlaceholder')}" autocomplete="off" spellcheck="false" />
          ${hasProjects ? `<span class="project-select-search-count">${sorted.length}</span>` : ''}
        </div>
        <div class="project-select-list">
          ${hasProjects
            ? sorted.map(([id, data]) => _buildProjectItemHTML(id, data)).join('')
            : `<div class="project-select-empty">
                <p>${I18n.t('project.emptyMsg')}</p>
              </div>`}
        </div>
        <div class="project-select-actions">
          <button class="project-select-create-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            ${I18n.t('project.createNew')}
          </button>
        </div>
      </div>`;

    // Search filter — always active
    {
      const searchInput = overlay.querySelector('.project-select-search');
      const countEl = overlay.querySelector('.project-select-search-count');
      const listEl = overlay.querySelector('.project-select-list');
      let _searchTimeout = null;

      // Virtual scroll: render items in batches for large lists
      const BATCH_SIZE = 30;
      let _renderedCount = Math.min(sorted.length, BATCH_SIZE);
      let _currentQuery = '';

      // Lazy render more items on scroll
      if (sorted.length > BATCH_SIZE) {
        // Initially render only first batch
        const items = listEl.querySelectorAll('.project-select-item[data-project-id]');
        items.forEach((item, idx) => {
          if (idx >= BATCH_SIZE) item.style.display = 'none';
        });

        listEl.addEventListener('scroll', () => {
          if (_currentQuery) return; // Search active — all items managed by filter
          const { scrollTop, scrollHeight, clientHeight } = listEl;
          if (scrollTop + clientHeight >= scrollHeight - 40 && _renderedCount < sorted.length) {
            const items = listEl.querySelectorAll('.project-select-item[data-project-id]');
            const nextBatch = Math.min(_renderedCount + BATCH_SIZE, sorted.length);
            for (let i = _renderedCount; i < nextBatch; i++) {
              if (items[i]) items[i].style.display = '';
            }
            _renderedCount = nextBatch;
          }
        }, { passive: true });
      }

      searchInput?.addEventListener('input', () => {
        clearTimeout(_searchTimeout);
        _searchTimeout = setTimeout(() => {
          const query = (searchInput.value || '').toLowerCase().trim();
          _currentQuery = query;
          const items = listEl.querySelectorAll('.project-select-item[data-project-id]');
          let visibleCount = 0;
          items.forEach(item => {
            const name = item.dataset.projectName || '';
            const match = !query || name.includes(query);
            item.style.display = match ? '' : 'none';
            if (match) visibleCount++;
          });
          if (countEl) countEl.textContent = query ? `${visibleCount}/${sorted.length}` : `${sorted.length}`;
          // Reset virtual scroll when search cleared
          if (!query && sorted.length > BATCH_SIZE) {
            _renderedCount = BATCH_SIZE;
            items.forEach((item, idx) => {
              item.style.display = idx < BATCH_SIZE ? '' : 'none';
            });
          }
          // Show/hide empty state
          let emptyEl = listEl.querySelector('.project-select-empty');
          if (visibleCount === 0 && query) {
            if (!emptyEl) {
              emptyEl = document.createElement('div');
              emptyEl.className = 'project-select-empty';
              emptyEl.innerHTML = `<p>${I18n.t('project.noMatch')}</p>`;
              listEl.appendChild(emptyEl);
            }
            emptyEl.style.display = '';
          } else if (emptyEl) {
            emptyEl.style.display = visibleCount > 0 ? 'none' : '';
          }
        }, 150);
      });
    }

    // Delete handlers (event delegation)
    const listContainer = overlay.querySelector('.project-select-list');
    listContainer?.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('.project-select-item-delete');
      if (delBtn) {
        e.stopPropagation();
        const deleteId = delBtn.dataset.deleteId;
        await _removeProjectFromList(deleteId);
        delBtn.closest('.project-select-item').remove();
        // Update count
        const countEl = overlay.querySelector('.project-select-search-count');
        const remainingItems = listContainer.querySelectorAll('.project-select-item[data-project-id]');
        if (countEl) countEl.textContent = `${remainingItems.length}`;
        // Nếu list rỗng, update
        if (remainingItems.length === 0) {
          listContainer.innerHTML = `<div class="project-select-empty"><p>${I18n.t('project.emptyMsg')}</p></div>`;
        }
        return;
      }

      // Project click handler
      const item = e.target.closest('.project-select-item[data-project-id]');
      if (!item || _projectNavigating) return;
      _setProjectNavigating(true);
      const projectId = item.dataset.projectId;
      const projectData = projects[projectId];
      const projectName = projectData?.name || projectId.substring(0, 8);

      // Cập nhật state + ẩn overlay ngay
      const oldId = window._currentProjectId;
      window._currentProjectId = projectId;
      window._currentProjectName = projectName;
      _updateProjectIndicator();
      _saveProjectToList(projectId, projectName);
      _hideProjectSelectOverlay();

      // Emit event để các tab reload data
      if (oldId !== projectId) {
        window.eventBus?.emit('project:changed', { projectId, projectName });
      }

      // Group C/Initiative 7: base URL từ ProviderConfigManager
      const _flowBase2 = window.ProviderConfigManager?.getBaseUrlSync('flow');
      chrome.runtime.sendMessage({
        action: 'navigateToProject',
        url: `${_flowBase2}/project/${projectId}`,
        projectId
      });

      // Retry xác nhận context sau navigation
      _requestProjectContextWithRetry(3, 1500);
    });

    const createOverlayBtn = overlay.querySelector('.project-select-create-btn');
    if (createOverlayBtn) {
      createOverlayBtn.addEventListener('click', () => {
        _hideProjectSelectOverlay();
        _createNewProject();
      });
    }

    // Bỏ button "Open Flow" — modal chỉ show khi đã có Flow tab (xem Layer 1 guard ở đầu function)

    // Resync button — bypass cooldown, force scan ngay khi user click
    const resyncBtn = overlay.querySelector('.project-select-resync');
    if (resyncBtn) {
      resyncBtn.addEventListener('mouseenter', () => {
        resyncBtn.style.background = 'rgba(255,255,255,0.05)';
        resyncBtn.style.color = 'rgba(255,255,255,0.9)';
      });
      resyncBtn.addEventListener('mouseleave', () => {
        resyncBtn.style.background = 'transparent';
        resyncBtn.style.color = 'rgba(255,255,255,0.65)';
      });
      resyncBtn.addEventListener('click', () => {
        // Spin icon khi đang sync
        const icon = resyncBtn.querySelector('.project-select-resync-icon');
        if (icon) icon.style.animation = 'spin 0.8s linear infinite';
        resyncBtn.disabled = true;
        // Force bypass cooldown — user explicit request
        _asyncScanFlowProjects(overlay, /*force=*/true).finally(() => {
          if (icon) icon.style.animation = '';
          resyncBtn.disabled = false;
        });
      });
    }

    container.appendChild(overlay);

    // Auto-focus search
    setTimeout(() => overlay.querySelector('.project-select-search')?.focus(), 100);

    // Fire-and-forget: scan Flow homepage để sync project list (auto khi modal mở)
    _asyncScanFlowProjects(overlay);
  }

  function _hideProjectSelectOverlay() {
    const overlay = document.querySelector('.project-select-overlay');
    if (overlay) overlay.remove();
  }

  // Export for other modules
  window._showProjectSelectOverlay = _showProjectSelectOverlay;
  window._hideProjectSelectOverlay = _hideProjectSelectOverlay;
  window._requestProjectContext = _requestProjectContext;

  // Helper: scan Flow projects từ homepage tab + update af_projects storage.
  // Standalone version (không update overlay UI). Dùng cho Layer 2 periodic poll khi
  // detect homepage tab. Cooldown để tránh spam scan.
  // Anti-loop: trả false nếu skip do cooldown; chỉ update storage khi data CHANGED.
  let _scanFlowProjectsCooldown = 0;
  const SCAN_FLOW_PROJECTS_COOLDOWN_MS = 30000;  // 30s giữa 2 lần scan
  async function _scanAndUpdateFlowProjects(scanTabId, force = false) {
    const now = Date.now();
    if (!force && now < _scanFlowProjectsCooldown) return false;
    _scanFlowProjectsCooldown = now + SCAN_FLOW_PROJECTS_COOLDOWN_MS;

    try {
      const scanResult = await Promise.race([
        new Promise((resolve) => {
          chrome.tabs.sendMessage(scanTabId, { action: 'scanFlowProjects' }, (r) => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(r);
          });
        }),
        new Promise((resolve) => setTimeout(() => resolve(null), 12000)) // scroll lazy-load ~8s worst-case
      ]);
      if (!scanResult?.projects) return false;

      const freshResult = await chrome.storage.local.get('af_projects');
      const freshProjects = freshResult.af_projects || {};
      const flowProjectIds = new Set(scanResult.projects.map(p => p.id));
      let changed = false;

      // Mark _notOnFlow cho projects KHÔNG còn trong Flow homepage list
      // Restore khi xuất hiện trở lại
      if (scanResult.isHomePage) {
        for (const [id, data] of Object.entries(freshProjects)) {
          if (!flowProjectIds.has(id) && id !== window._currentProjectId) {
            if (!data._notOnFlow) {
              freshProjects[id] = { ...data, _notOnFlow: Date.now() };
              changed = true;
            }
          } else if (data._notOnFlow && flowProjectIds.has(id)) {
            delete freshProjects[id]._notOnFlow;
            changed = true;
          }
        }
      }
      // Add/update projects có trên Flow
      for (const proj of scanResult.projects) {
        if (!freshProjects[proj.id]) {
          freshProjects[proj.id] = {
            name: proj.name || proj.id.substring(0, 8),
            last_accessed: Date.now(),
          };
          changed = true;
        } else if (proj.name && freshProjects[proj.id].name !== proj.name) {
          freshProjects[proj.id].name = proj.name;
          changed = true;
        }
      }
      if (changed) {
        await chrome.storage.local.set({ af_projects: freshProjects });
        console.log('[SEOSONA Flow] Auto-scan Flow projects: updated storage with', scanResult.projects.length, 'projects');
        _updateProjectIndicator();
      }
      return true;
    } catch (e) {
      console.warn('[SEOSONA Flow] Auto-scan Flow projects failed:', e?.message);
      return false;
    }
  }
  window._scanAndUpdateFlowProjects = _scanAndUpdateFlowProjects;

  // [Layer 2] Periodic re-sync project context với Flow tab URL realtime.
  // Self-heal khi state lệch (event miss, race condition, sidepanel suspended).
  // Anti-loop: chỉ trigger update khi state ACTUAL ≠ EXPECTED.
  // Cooldown 1s giữa 2 lần thực sự run (poll mỗi 3s nhưng skip nếu < 1s từ lần trước).
  let _projectSyncCooldown = 0;
  const PROJECT_SYNC_INTERVAL_MS = 3000;
  setInterval(async () => {
    if (!chrome.tabs?.query) return;
    const now = Date.now();
    if (now < _projectSyncCooldown) return;
    _projectSyncCooldown = now + 1000;
    try {
      const tabs = await chrome.tabs.query({ url: window.ProviderConfigManager?.getTabQuery('flow') });
      let projectFound = null;
      for (const tab of tabs) {
        const m = tab.url?.match(/\/project\/([a-f0-9-]+)/);
        if (m) { projectFound = { id: m[1], tab }; break; }
      }
      const overlayVisible = !!document.querySelector('.project-select-overlay');

      // URL có /project/{id} CHƯA chắc project hợp lệ — trang lỗi/đã xoá URL vẫn còn /project/{id}.
      // Verify DOM (getProjectContext.projectError) trước khi coi là project hợp lệ.
      let hadErrorProject = false;
      if (projectFound) {
        const ctx = await new Promise(r => {
          try { chrome.tabs.sendMessage(projectFound.tab.id, { action: 'getProjectContext' }, resp => r(chrome.runtime.lastError ? null : resp)); }
          catch (_) { r(null); }
        });
        if (ctx?.projectError === true) { projectFound = null; hadErrorProject = true; } // project lỗi/đã xoá
      }

      if (projectFound && overlayVisible) {
        console.log('[SEOSONA Flow] Periodic re-sync: hide stale overlay, project=', projectFound.id);
        if (window._currentProjectId !== projectFound.id) {
          window._currentProjectId = projectFound.id;
          window._targetFlowTabId = projectFound.tab.id;
          window.MessageBridge?.setTargetTabId?.(projectFound.tab.id);
        }
        _hideProjectSelectOverlay();
        _updateProjectIndicator();
      } else if (hadErrorProject) {
        // Trang project lỗi/đã xoá → clear state + đảm bảo overlay hiện (self-heal nếu bị ẩn nhầm).
        if (window._currentProjectId) { window._currentProjectId = null; window._currentProjectName = null; _updateProjectIndicator(); }
        if (!overlayVisible) _showProjectSelectOverlay();
      } else if (!projectFound && tabs.length === 0 && window._currentProjectId) {
        console.log('[SEOSONA Flow] Periodic re-sync: no Flow tab, clear stale project state');
        window._currentProjectId = null;
        window._currentProjectName = null;
        _updateProjectIndicator();
      } else if (projectFound && window._currentProjectId !== projectFound.id) {
        console.log('[SEOSONA Flow] Periodic re-sync: state out of sync, update to', projectFound.id);
        window._currentProjectId = projectFound.id;
        window._targetFlowTabId = projectFound.tab.id;
        window.MessageBridge?.setTargetTabId?.(projectFound.tab.id);
        _updateProjectIndicator();
      }
    } catch (e) { /* ignore */ }
  }, PROJECT_SYNC_INTERVAL_MS);

  // Global pending upload cache (fallback nếu PendingUploadStore chưa restore)
  if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
  if (!window.uploadedFileCache) window.uploadedFileCache = new Map();

  // uploadPendingFiles & reuploadMissingFiles: đã chuyển sang FileUploader.js (shared giữa sidebar + workflow popup)

  /**
   * [2026-06-13] Intercept `window._targetFlowTabId` set → auto-persist vào chrome.storage.session
   * để popup workflow editor đọc qua ImmediateUploader._ensureFlowTabReady().
   *
   * Trước fix: code đọc storage.session nhưng KHÔNG ai set → popup luôn pass targetTabId=null →
   * background query Flow tabs blindly → trên non-Chrome (CocCoc) có thể chọn sai tab hoặc
   * fail tab activation. 12 sites trong app.js gán `window._targetFlowTabId = ...` → wrap qua
   * defineProperty 1 lần thay vì sửa 12 chỗ.
   *
   * Cross-browser: chrome.storage.session API có từ Chromium 102. Nếu browser cũ không support
   * → silent no-op (popup vẫn fallback null như trước, không regression).
   */
  (function _installTargetFlowTabIdPersist() {
    let _val = null;
    const persist = (tabId) => {
      try {
        if (!chrome.storage?.session) return;
        if (tabId) chrome.storage.session.set({ targetFlowTabId: tabId }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#persist', _e); });
        else chrome.storage.session.remove('targetFlowTabId').catch(function (_e) { globalThis.SEOSONA_swallow?.('app#set', _e); });
      } catch (_) { globalThis.SEOSONA_swallow?.('app#persist', _); }
    };
    try {
      Object.defineProperty(window, '_targetFlowTabId', {
        configurable: true,
        get() { return _val; },
        set(v) { _val = v; persist(v); },
      });
    } catch (_) {
      // Fallback nếu environment không cho redefine — bỏ qua, sidebar vẫn work qua window._targetFlowTabId
    }
  })();

  /**
   * [2026-06-13] Detect browser. Extension chỉ test + support trên Chrome.
   * Returns: 'chrome' | 'edge' | 'brave' | 'opera' | 'vivaldi' | 'coccoc' | 'unknown'.
   */
  async function _detectBrowser() {
    const ua = navigator.userAgent || '';
    try { if (navigator.brave && await navigator.brave.isBrave()) return 'brave'; } catch (_) { globalThis.SEOSONA_swallow?.('app#_detectBrowser', _); }
    if (/coc_coc_browser/i.test(ua)) return 'coccoc';
    if (/\bEdg\//.test(ua))     return 'edge';
    if (/\bOPR\//.test(ua))     return 'opera';
    if (/\bVivaldi\//.test(ua)) return 'vivaldi';
    if (/Chrome\//.test(ua))    return 'chrome';
    return 'unknown';
  }

  /**
   * [2026-06-13] Cảnh báo user nếu browser != Chrome (extension chỉ test full trên Chrome).
   * Lưu dismiss flag vào chrome.storage.local để không spam mỗi lần mở sidebar.
   * Bump _v key khi có change UI/text major để show lại cho user cũ.
   */
  async function _checkBrowserCompat() {
    try {
      const browser = await _detectBrowser();
      if (browser === 'chrome') return;

      const STORAGE_KEY = 'seosonaflow_browser_warning_dismissed_v1';
      const stored = await new Promise(r => chrome.storage.local.get([STORAGE_KEY], r));
      if (stored?.[STORAGE_KEY] === browser) return; // user đã dismiss cho browser này

      const I = window.I18n;
      const labels = {
        coccoc: 'Cốc Cốc', edge: 'Microsoft Edge', brave: 'Brave',
        opera: 'Opera', vivaldi: 'Vivaldi', unknown: 'browser của bạn',
      };
      const browserLabel = labels[browser] || browser;

      const title = (I?.t('browserWarning.title') || 'Trình duyệt không được hỗ trợ chính thức');
      const heading = (I?.t('browserWarning.heading', { browser: browserLabel }) ||
        `Bạn đang dùng <strong>${browserLabel}</strong>`);
      const body = (I?.t('browserWarning.body') ||
        'SEOSONA Flow chỉ test + support đầy đủ trên <strong>Google Chrome</strong>. Một số tính năng (upload local, sidePanel, service worker) có thể không hoạt động đúng trên trình duyệt khác.');
      const recommend = (I?.t('browserWarning.recommend') ||
        'Để có trải nghiệm tốt nhất, vui lòng dùng Google Chrome.');
      const downloadBtn = (I?.t('browserWarning.downloadChrome') || 'Tải Chrome');
      const continueBtn = (I?.t('browserWarning.continueAnyway') || 'Tiếp tục dùng');

      const html =
        `<div style="text-align:left;line-height:1.55;font-size:14px;">` +
        `  <p style="margin:0 0 10px;font-size:15px;">${heading}</p>` +
        `  <p style="margin:0 0 10px;color:rgba(255,255,255,0.75);">${body}</p>` +
        `  <p style="margin:0;color:rgba(255,255,255,0.85);">${recommend}</p>` +
        `</div>`;

      await window.customDialog?.alert(html, {
        title,
        type: 'warning',
        html: true,
        buttons: [
          {
            label: downloadBtn, primary: false, action: () => {
              try { chrome.tabs.create({ url: 'https://www.google.com/chrome/' }); } catch (_) { globalThis.SEOSONA_swallow?.('app#action', _); }
            }
          },
          {
            label: continueBtn, primary: true, action: () => {
              chrome.storage.local.set({ [STORAGE_KEY]: browser }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#init', _e); });
            }
          },
        ],
      });
    } catch (e) {
      console.warn('[BrowserCompat] check failed:', e?.message);
    }
  }

  // Khởi tạo khi DOM ready - with loading state management (I-2)
  async function init() {
    log('Initializing...');
    
    // Initialize custom select UI to replace native dropdowns
    if (window.CustomSelect) {
      window.CustomSelect.initAll('.select-group select, .premium-select-wrapper select, .dl-res-select-wrap select');
    }

    // LOCAL/OFFLINE mode: khi self.SEOSONA_LOCAL_MODE !== false (mặc định true),
    // extension chạy hoàn toàn cục bộ — KHÔNG gọi backend. Các bước bootstrap phụ
    // thuộc server (mandatory config prefetch, offline/maintenance overlay, plans/
    // active providers, announcement) được coi như đã thỏa/bỏ qua, không hiện overlay.
    const _IS_LOCAL = (function () {
      try {
        if (window.RuntimeMode?.isLocal) return window.RuntimeMode.isLocal();
        return self.SEOSONA_LOCAL_MODE !== false;
      } catch (_) { return true; }
    })();
    if (_IS_LOCAL) log('LOCAL mode active — skipping server-dependent bootstrap gates');

    // Phase 2: Run storage migration (remove deprecated keys, cleanup)
    try { window.StorageMigration?.run?.(); } catch (e) { console.warn('[init] StorageMigration error:', e.message); }

    // Phase 2: Pre-fetch ExecutionConfig from server (background, không block init)
    try { window.ExecutionConfig?.getConfig?.(); } catch (e) { /* ignore */ }

    // ─────────────────────────────────────────────────────────────────────────
    // Fix 429 Race Condition (Option C Enhanced):
    // Background.js fetches configs on install/startup và signal `_seosonaConfigsReady`.
    // Sidebar check signal trước khi gọi PCM fetch → nếu fresh (<30s) skip fetch,
    // PCM sẽ đọc từ chrome.storage cache (đã được background warm).
    // Nếu stale/missing → delegate fetch cho background qua message.
    // ─────────────────────────────────────────────────────────────────────────
    const _CONFIGS_READY_KEY = '_seosonaConfigsReady';
    const _CONFIGS_READY_TTL_MS = 30000; // 30s
    let _skipPcmFetch = false;
    try {
      const stored = await new Promise(r => chrome.storage.local.get([_CONFIGS_READY_KEY], r));
      const readyAt = stored?.[_CONFIGS_READY_KEY] || 0;
      if (Date.now() - readyAt < _CONFIGS_READY_TTL_MS) {
        _skipPcmFetch = true;
        log('Configs warm from background (skip sidebar fetch)');
      } else {
        // Delegate fetch to background (centralized, avoid duplicate)
        try {
          await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'FETCH_CONFIGS_IF_NEEDED' }, (resp) => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve(resp);
            });
          });
          _skipPcmFetch = true;
          log('Configs fetched via background delegation');
        } catch (e) {
          log('Background fetch delegation failed, sidebar will fetch:', e.message);
        }
      }
    } catch (e) { /* ignore — sidebar will fetch as fallback */ }

    // Fetch ChatGPT + Grok error patterns from admin (background, không block init).
    // Cache 1h vào chrome.storage.local.af_chatgpt_config + af_grok_config →
    // content script chatgpt.com / grok.com đọc patterns runtime.
    try { window.ChatGPTConfig?.fetchInBackground?.(); } catch (e) { /* ignore */ }
    try { window.GrokConfig?.fetchInBackground?.(); } catch (e) { /* ignore */ }
    // PCM fetch: skip nếu background đã warm cache
    if (!_skipPcmFetch) {
      try { window.ProviderConfigManager?.fetchInBackground?.(); } catch (e) { /* ignore */ }
      try { window.ProviderConfigManager?._fetchApiConfigs?.().catch(function (_e) { globalThis.SEOSONA_swallow?.('app#init', _e); }); } catch (e) { /* ignore */ }
    }
    // ProviderMeta: fetch data here (warm cache), but init() with SSE listener later after eventBus is created
    try { window.ProviderMeta?.fetch?.(); } catch (e) { /* ignore */ }

    // Phase 3: Bridge URLs cache to background.js sau khi api_configs fetch xong.
    // Background.js (service worker) không import PCM nên cần bridge qua chrome.storage.session.
    try {
      const pcm = window.ProviderConfigManager;
      if (pcm?._apiConfigsCache?.data) {
        const urlsCache = {};
        for (const [slug, cfg] of Object.entries(pcm._apiConfigsCache.data)) {
          if (cfg?.configs?.urls) {
            urlsCache[slug] = cfg.configs.urls;
          }
        }
        if (Object.keys(urlsCache).length > 0) {
          chrome.runtime?.sendMessage?.({ action: 'updateProviderUrlsCache', data: urlsCache }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#init', _e); });
        }
      }
    } catch (e) { /* ignore */ }

    // Phase 3: Mandatory config prefetch với error handling.
    // Nếu tất cả configs fetch thành công → tiếp tục init.
    // Nếu fail và cache expired → ConfigErrorHandler sẽ hiện overlay.
    // LOCAL: bỏ qua toàn bộ mandatory prefetch — coi như đã thỏa, dùng default cục bộ.
    // (VoiceRegistry cross-context sync vẫn init để đọc cache local, không fetch server.)
    if (_IS_LOCAL) {
      try {
        window.VoiceRegistry?.initCrossContextSync?.();
        window.CharacterRegistry?.initCrossContextSync?.();
        window.CharacterRegistry?.getScrapedList?.().catch(function (_e) { globalThis.SEOSONA_swallow?.('app#init', _e); });
      } catch (e) { /* ignore */ }
    } else
    try {
      await Promise.all([
        window.ProviderConfigManager?.fetchMandatory?.('api_configs').catch(e => {
          if (window.ConfigRequiredError?.is?.(e)) {
            console.warn('[init] Phase 3: api_configs mandatory fetch failed');
          }
          return null;
        }),
        window.ModelRegistry?.fetchMandatory?.().catch(e => {
          if (window.ConfigRequiredError?.is?.(e)) {
            console.warn('[init] Phase 3: models mandatory fetch failed');
          }
          return null;
        }),
        // Flow Voice Selector — fetch base catalog (graceful: empty array nếu fail) +
        // init cross-context sync (chrome.storage.onChanged listener) để nhận update
        // realtime khi settings.html click Resync trong window/tab khác.
        (() => {
          window.VoiceRegistry?.initCrossContextSync?.();
          window.CharacterRegistry?.initCrossContextSync?.();
          window.CharacterRegistry?.getScrapedList?.().catch(function (_e) { globalThis.SEOSONA_swallow?.('app#init', _e); }); // hydrate cache từ disk → findBySlug works lúc submit cold start
          return window.VoiceRegistry?.getBaseCatalog?.('flow').catch(e => {
            console.warn('[init] VoiceRegistry base catalog fetch failed:', e.message);
            return null;
          });
        })(),
      ]);
    } catch (e) { /* ignore aggregate error */ }

    const overlay = document.getElementById('seosonaflow-loading-overlay');
    const loadingText = document.getElementById('seosonaflow-loading-text');

    // Helper: update loading text
    function setLoadingText(text) {
      if (loadingText) loadingText.textContent = text;
    }

    // Helper: hide loading overlay with fade
    function hideLoadingOverlay() {
      if (overlay) {
        overlay.classList.add('seosonaflow-loading-overlay--hidden');
        setTimeout(() => overlay.remove(), 300);
      }
    }

    // Check offline state (I-2) - Show full overlay when offline
    const offlineOverlay = document.getElementById('seosonaflow-offline-overlay');
    const offlineRetryBtn = document.getElementById('seosonaflow-offline-retry-btn');

    // Fix 2026-05-17: Auto-hide khi server up lại (không cần user click Retry).
    // Trước fix: `online` event chỉ fire khi BROWSER mất/có Internet → server down mà Internet OK
    // → overlay show mãi cho đến khi user click Retry manually.
    // Sau fix: khi overlay show, start polling ServerHealthCheck mỗi 10s; server reachable → tự hide.
    let _offlineHealthPollInterval = null;
    const _OFFLINE_HEALTH_POLL_MS = 10000; // 10s

    function showOfflineOverlay() {
      // LOCAL: không có backend → không hiện overlay offline/maintenance, không poll health.
      if (_IS_LOCAL) { hideOfflineOverlay(); return; }
      if (offlineOverlay) {
        offlineOverlay.classList.remove('hidden');
      }
      // Start polling server health — auto hide khi server up lại
      if (_offlineHealthPollInterval) return; // already polling
      _offlineHealthPollInterval = setInterval(async () => {
        if (!navigator.onLine) return; // skip nếu browser offline (online event sẽ trigger sau)
        try {
          window.ServerHealthCheck?.reset(); // bypass 30s cache để check fresh
          const isHealthy = await checkServerConnection();
          if (isHealthy) {
            console.log('[App] Server reachable lại → auto hide offline overlay');
            hideOfflineOverlay();
            // Refresh entitlements + configs để UI sync state mới
            try { await window.featureGate?.refresh?.(); } catch (_) { globalThis.SEOSONA_swallow?.('app#showOfflineOverlay', _); }
          }
        } catch (_) { /* silent — next poll sẽ retry */ }
      }, _OFFLINE_HEALTH_POLL_MS);
      console.log('[App] Offline overlay shown — started health polling every', _OFFLINE_HEALTH_POLL_MS, 'ms');
    }

    function hideOfflineOverlay() {
      if (offlineOverlay) {
        offlineOverlay.classList.add('hidden');
      }
      // Stop polling khi overlay đã ẩn
      if (_offlineHealthPollInterval) {
        clearInterval(_offlineHealthPollInterval);
        _offlineHealthPollInterval = null;
        console.log('[App] Offline overlay hidden — stopped health polling');
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Anti-clone overlay: hiển thị khi background detect 403 EXTENSION_NOT_AUTHORIZED.
    // Text i18n do clone-detected-i18n.js (early) + I18n class (sau, data-i18n) handle —
    // không hardcode labels ở đây. Storage flag persist qua reload.
    // ─────────────────────────────────────────────────────────────────────
    const cloneDetectedOverlay = document.getElementById('seosonaflow-clone-detected-overlay');
    function _showCloneDetectedOverlay() {
      if (!cloneDetectedOverlay) return;
      cloneDetectedOverlay.classList.remove('hidden');
      // Set store URL từ system config (extension_url) hoặc fallback Chrome Web Store.
      // KHÔNG hiển thị chrome.runtime.id — tránh gợi ý attacker biết ID hợp lệ để giả.
      const storeBtn = document.getElementById('seosonaflow-clone-detected-store-btn');
      if (storeBtn && !storeBtn.href) {
        try {
          const cfg = window.SystemConfig?.getAppConfig?.() || {};
          storeBtn.href = cfg.extension_url || 'https://chromewebstore.google.com/';
        } catch (_) {
          storeBtn.href = 'https://chromewebstore.google.com/';
        }
      }
      console.error('[App] 🛡️ Clone-detected overlay shown — extension not authorized');
    }
    function _hideCloneDetectedOverlay() {
      if (cloneDetectedOverlay) cloneDetectedOverlay.classList.add('hidden');
    }

    // 1. Check sau 800ms — đợi background self-heal probe chạy trước (immediate on load).
    // Nếu admin vừa tắt toggle → probe sẽ clear flag trong < 500ms → tránh flicker overlay.
    // Sau 800ms vẫn còn flag = thực sự bị reject → show overlay.
    setTimeout(() => {
      try {
        chrome.storage.local.get(['seosonaflow_extension_not_authorized', 'seosonaflow_device_banned'], (res) => {
          if (res?.seosonaflow_extension_not_authorized || res?.seosonaflow_device_banned) _showCloneDetectedOverlay();
        });
      } catch (_) { globalThis.SEOSONA_swallow?.('app#_hideCloneDetectedOverlay', _); }
    }, 800);

    // Khi user trigger user action (click) → request manual retry probe
    try {
      const retryHandler = () => {
        chrome.runtime.sendMessage({ type: 'EXTENSION_AUTH_RETRY' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#retryHandler', _e); });
      };
      cloneDetectedOverlay?.addEventListener('click', retryHandler);
    } catch (_) { globalThis.SEOSONA_swallow?.('app#retryHandler', _); }

    // 2. Listen storage change (background detect → set flag)
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        // Clone-detected (extension_id whitelist) HOẶC device-ban (per-device hard block)
        // dùng chung overlay. Recompute từ storage để hide đúng khi CẢ HAI flag đã clear.
        if (changes.seosonaflow_extension_not_authorized || changes.seosonaflow_device_banned) {
          chrome.storage.local.get(['seosonaflow_extension_not_authorized', 'seosonaflow_device_banned'], (res) => {
            if (res?.seosonaflow_extension_not_authorized || res?.seosonaflow_device_banned) _showCloneDetectedOverlay();
            else _hideCloneDetectedOverlay();
          });
        }
      });
    } catch (_) { globalThis.SEOSONA_swallow?.('app#retryHandler', _); }

    // 3. Listen runtime message (faster trong cùng context)
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === 'EXTENSION_NOT_AUTHORIZED' || msg?.type === 'DEVICE_BANNED') _showCloneDetectedOverlay();
        else if (msg?.type === 'EXTENSION_AUTHORIZED' || msg?.type === 'DEVICE_UNBANNED') {
          _hideCloneDetectedOverlay();
          // Reset AuthManager session-invalid flag (có thể đã bị set sai do 403 cascade).
          try { if (window.authManager) window.authManager._sessionInvalid = false; } catch (_) { globalThis.SEOSONA_swallow?.('app#retryHandler', _); }
          // Re-fetch SystemConfig + entitlements khi authorize lại — đảm bảo
          // Google login button + entitlements không bị stuck ở defaults sau recovery.
          (async () => {
            try { await window.SystemConfig?.fetch?.(true); window.SystemConfig?.applyToUI?.(); } catch (_) { globalThis.SEOSONA_swallow?.('app#retryHandler', _); }
            try { await window.featureGate?.refresh?.(); } catch (_) { globalThis.SEOSONA_swallow?.('app#retryHandler', _); }
          })();
        }
      });
    } catch (_) { globalThis.SEOSONA_swallow?.('app#retryHandler', _); }

    // Check connection with SEOSONA server (Server-Only Architecture - Phase 0)
    // Uses ServerHealthCheck.js to verify server connectivity, not just internet.
    async function checkServerConnection() {
      // First check if browser is online
      if (!navigator.onLine) return false;
      // Then verify SEOSONA server is reachable
      return await window.ServerHealthCheck?.check(true) ?? false;
    }

    async function handleOnlineStatusChange() {
      if (!navigator.onLine) {
        showOfflineOverlay();
        return;
      }

      // Server-Only: check SEOSONA server, not just internet
      const isConnected = await checkServerConnection();
      if (!isConnected) {
        showOfflineOverlay();
      } else {
        hideOfflineOverlay();
      }
    }

    // Initial check - Server-Only Architecture
    // Check both internet AND SEOSONA server connectivity
    // LOCAL: bỏ qua health check + online/offline listeners + config:offline (không có backend).
    if (!_IS_LOCAL) {
      if (!navigator.onLine) {
        setLoadingText(window.I18n?.t('dialog.offline') || 'Mất kết nối server');
        showOfflineOverlay();
      } else {
        // Check server health asynchronously
        checkServerConnection().then(isHealthy => {
          if (!isHealthy) {
            setLoadingText(window.I18n?.t('dialog.serverUnavailable') || 'Không thể kết nối đến máy chủ');
            showOfflineOverlay();
          }
        });
      }

      // Listen for online/offline changes
      window.addEventListener('online', handleOnlineStatusChange);
      window.addEventListener('offline', handleOnlineStatusChange);

      // [Audit Bug 8 fix] Listen `config:offline` từ StorageSettings._loadServerDefaults
      // (emit khi 3 retry attempts hết → server unreachable). Show overlay + start health
      // polling — auto hide khi server up lại, không cần user click Retry.
      window.eventBus?.on?.('config:offline', ({ source, error }) => {
        console.warn(`[App] config:offline received (source=${source}, error=${error}) → show overlay`);
        showOfflineOverlay();
      });
    }

    // Retry button handler
    if (offlineRetryBtn) {
      offlineRetryBtn.addEventListener('click', async () => {
        offlineRetryBtn.disabled = true;
        offlineRetryBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="seosonaflow-spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
          </svg>
          ${window.I18n?.t('app.checking') || 'Đang kiểm tra...'}
        `;

        // Server-Only: reset cache and check SEOSONA server
        window.ServerHealthCheck?.reset();
        const isConnected = await checkServerConnection();

        if (isConnected) {
          hideOfflineOverlay();
          // Refresh data from server
          if (window.featureGate) {
            await window.featureGate.refresh();
          }
          // Also refresh provider configs — refresh() clear cache + refetch (public API).
          // Fix: invalidateCache()/fetchApiConfigs() không tồn tại → TypeError trên click Retry.
          if (window.ProviderConfigManager?.refresh) {
            await window.ProviderConfigManager.refresh();
          }
        } else {
          offlineRetryBtn.disabled = false;
          offlineRetryBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 2v6h-6"></path>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
              <path d="M3 22v-6h6"></path>
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
            </svg>
            ${window.I18n?.t('common.retry') || 'Thử lại'}
          `;
        }
      });
    }

    // U-1.5: Lắng nghe project context từ content.js hoặc background.js
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      // [NEW] Flow homepage projects count changed (lazy load qua scroll)
      // → re-scan modal nếu đang mở. Anti-loop: cooldown trong _asyncScanFlowProjects (10s).
      if (msg.action === 'flowHomepageProjectsChanged') {
        const overlay = document.querySelector('.project-select-overlay');
        if (overlay) {
          console.log('[SEOSONA Flow] Flow homepage projects changed (count=' + msg.count + ') → re-scan modal');
          // Trigger re-scan (sẽ bị cooldown skip nếu < 10s từ lần scan trước).
          // Force=true để bypass cooldown — user thấy list cập nhật theo Flow scroll realtime.
          if (typeof window._asyncScanFlowProjects === 'function') {
            window._asyncScanFlowProjects(overlay, /*force=*/true);
          }
        }
        if (sendResponse) sendResponse({ ok: true });
        return;
      }

      if (msg.action === 'projectContext') {
        // Mark as resolved and hide connecting overlay
        _projectContextResolved = true;
        _hideConnectingOverlay();

        const oldId = window._currentProjectId;
        // projectError=true (content.js verify DOM) → project lỗi/đã xoá → coi như KHÔNG có project hợp lệ.
        const isErrorProject = msg.projectError === true;
        // Msg suy ra từ URL (fromTabUpdate/fromSPANavigate) CHƯA verify DOM → chưa chắc project hợp lệ
        // (trang lỗi/đã xoá URL vẫn còn /project/{id}). Để msg verified (kèm projectError) quyết định ẩn.
        const isUnverified = msg.fromTabUpdate === true || msg.fromSPANavigate === true;
        const newId = (msg.projectId && !isErrorProject) ? msg.projectId : null;

        // CRITICAL: Update target tab từ sender (content.js gửi từ tab nào)
        // Chỉ set target khi đây là project tab (có projectId)
        // Homepage (projectId=null) không có editor/tiles → giữ target cũ
        if (newId) {
          if (sender?.tab?.id) {
            window._targetFlowTabId = sender.tab.id;
            window.MessageBridge?.setTargetTabId?.(sender.tab.id);
          } else if (msg.tabId) {
            window._targetFlowTabId = msg.tabId;
            window.MessageBridge?.setTargetTabId?.(msg.tabId);
          }
        } else if (!window._targetFlowTabId) {
          // Lần đầu init chưa có target → set tạm để không bị null
          if (sender?.tab?.id) {
            window._targetFlowTabId = sender.tab.id;
            window.MessageBridge?.setTargetTabId?.(sender.tab.id);
          } else if (msg.tabId) {
            window._targetFlowTabId = msg.tabId;
            window.MessageBridge?.setTargetTabId?.(msg.tabId);
          }
        }

        // Nếu fromTabUpdate và chỉ là null → chỉ cập nhật khi projectName cũng null
        // (tránh xóa projectName khi background.js chưa có projectName)
        if (msg.fromTabUpdate && newId && !msg.projectName && window._currentProjectName) {
          // Chỉ cập nhật projectId, giữ projectName cũ cho tới khi content.js gửi đầy đủ
          window._currentProjectId = newId;
        } else if (newId || !isUnverified) {
          // Cập nhật (kể cả VERIFIED-null). NHƯNG KHÔNG ghi đè khi UNVERIFIED-null:
          // [FIX 2026-07-09] SPA navigate tạm tới URL không-phải-/project/ lúc GENERATE gửi
          // projectId=null,fromSPANavigate=true → trước đây wipe _currentProjectId + bung picker
          // "Chọn project" → user bị OUT giữa lúc chạy. Giữ project hiện tại, chờ message verified.
          window._currentProjectId = newId;
          window._currentProjectName = msg.projectName || null;
        }

        if (newId && !isUnverified) {
          _saveProjectToList(newId, msg.projectName);
        }
        _updateProjectIndicator();

        // Update overlay state khi project context thay đổi.
        // CHỈ ẩn overlay khi có project hợp lệ ĐÃ verify DOM (không phải URL-only) — tránh ẩn nhầm
        // trang project lỗi/đã xoá. Msg URL-only (unverified) giữ nguyên overlay, chờ msg verified quyết định.
        if (newId && !isUnverified) {
          _hideProjectSelectOverlay();
        } else if (!newId && !isUnverified) {
          // [FIX 2026-07-09] CHỈ bung picker khi VERIFIED không có project (DOM đã confirm).
          // UNVERIFIED-null (SPA navigate / tab update tạm lúc generate) → BỎ QUA, không kick user
          // ra "Chọn project" giữa lúc đang chạy. Message verified (background getProjectContext)
          // sẽ tới ngay sau và quyết định show/hide đúng.
          _showProjectSelectOverlay();
        }

        if (oldId !== newId) {
          window.eventBus?.emit('project:changed', { projectId: newId, projectName: msg.projectName });
        }
        if (sendResponse) sendResponse({ ok: true });
      }
    });

    // Listen for tab activated events để update _targetFlowTabId khi user switch tab
    // CRITICAL: Đảm bảo gửi message đến đúng tab khi user có nhiều Flow tabs
    if (chrome.tabs?.onActivated) {
      chrome.tabs.onActivated.addListener(async (activeInfo) => {
        try {
          const tab = await chrome.tabs.get(activeInfo.tabId);
          if (tab?.url?.startsWith('https://labs.google/fx/')) {
            // Chỉ set target tab khi đây là project tab (có /project/ trong URL)
            // Homepage tab không có editor/tiles → gửi message sẽ fail
            const isProjectTab = tab.url.match(/\/project\/[a-f0-9-]+/);
            if (isProjectTab) {
              window._targetFlowTabId = activeInfo.tabId;
              window.MessageBridge?.setTargetTabId?.(activeInfo.tabId);
              console.log('[SEOSONA Flow] Tab activated, target Flow tab updated:', activeInfo.tabId);
              // Apply Flow page settings sớm khi switch tab — 1-time per tab session
              window.MessageBridge?.sendToContentScript?.('applyFlowPageSettings', {}).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#handleOnlineStatusChange', _e); });
            } else {
              console.log('[SEOSONA Flow] Tab activated is Flow homepage, keeping existing target tab');
            }
            // Request project context từ tab mới (cả homepage lẫn project)
            _requestProjectContext();
          }
        } catch (e) {
          // Tab might be closed or inaccessible
        }
      });
    }

    // U-1.5: Yêu cầu project context từ content.js khi khởi tạo
    // CRITICAL: Dùng retry vì content.js có thể chưa sẵn sàng khi sidePanel mở
    // firstCallImmediate=true: gọi ngay lần đầu, retry sau 1s nếu fail
    // suppressOverlay=true: không show overlay cho đến khi hết retry
    _requestProjectContextWithRetry(3, 1000, true, true);

    try {
      // 1. Initialize EventBus
      if (!window.eventBus) {
        window.eventBus = new EventBus();
      }
      log('EventBus ready');

      // 1a. ProviderMeta: init SSE listener now that eventBus exists
      // (fetch() was called earlier in _warmServerConfigs to warm cache)
      try { window.ProviderMeta?.init?.(); } catch (e) { /* ignore */ }

      // 1a2. Initialize I18n (load saved locale + apply translations)
      if (window.I18n) {
        await I18n.init();
        // Apply translations after locale is loaded from storage
        I18n.applyTranslations(document.body);
        log('I18n ready, locale:', I18n.getLocale());

        // [2026-06-13] Cảnh báo non-Chrome browser (1 lần, dismissible). Run sau I18n ready để có
        // text dịch đúng locale; non-blocking — không await để không chặn các init step sau.
        _checkBrowserCompat();

        // Listen for locale changes and re-apply translations
        window.eventBus.on('i18n:changed', ({ locale }) => {
          I18n.applyTranslations(document.body);
          log('I18n locale changed to:', locale);
        });

        // Group E: Listen for server reload (SSE i18n_updated → I18n.reload → emit 'i18n:reloaded')
        // → re-apply translations vào DOM ngay khi server data về (không cần user reload extension).
        window.eventBus.on('i18n:reloaded', ({ locale }) => {
          I18n.applyTranslations(document.body);
          log('I18n reloaded from server for locale:', locale);
        });

        // Phase CG-2: ChatGPT chưa đăng nhập → mở dialog + polling login status
        window.eventBus.on('chatgpt:login_required', async () => {
          const dialog = window.customDialog || window.CustomDialog;
          if (!dialog?.confirm) return;
          const ok = await dialog.confirm(
            window.I18n?.t('chatgpt.loginRequiredMsg') || 'Bạn chưa đăng nhập ChatGPT. Mở tab để đăng nhập?',
            {
              title: window.I18n?.t('chatgpt.loginRequiredTitle') || 'Cần đăng nhập ChatGPT',
              type: 'warning',
              confirmText: window.I18n?.t('chatgpt.openTab') || 'Mở tab',
              cancelText: window.I18n?.t('common.cancel') || 'Hủy',
            }
          );
          if (ok) {
            try {
              // [Fix] Reuse existing ChatGPT tab instead of opening new one
              const response = await chrome.runtime.sendMessage({
                action: 'openOrActivateTab',
                urlPattern: window.ProviderConfigManager?.getTabQuery('chatgpt'),
                createUrl: window.ProviderConfigManager?.getCreateUrl('chatgpt'),
                activate: true
              });
              if (response?.tabId) {
                // Start polling login status sau khi mở/activate tab
                _pollProviderLogin('chatgpt', response.tabId);
              }
            } catch (err) {
              console.error('[SEOSONA Flow] Không mở được tab ChatGPT:', err);
            }
          }
        });

        // G-5.9: Grok chưa đăng nhập → mở dialog + polling login status (mirror ChatGPT)
        window.eventBus.on('grok:login_required', async () => {
          const dialog = window.customDialog || window.CustomDialog;
          if (!dialog?.confirm) return;
          const ok = await dialog.confirm(
            window.I18n?.t('grok.loginRequiredMsg') || 'Bạn chưa đăng nhập Grok. Mở tab để đăng nhập?',
            {
              title: window.I18n?.t('grok.loginRequiredTitle') || 'Cần đăng nhập Grok',
              type: 'warning',
              confirmText: window.I18n?.t('grok.openTab') || window.I18n?.t('chatgpt.openTab') || 'Mở tab',
              cancelText: window.I18n?.t('common.cancel') || 'Hủy',
            }
          );
          if (ok) {
            try {
              // [Fix] Reuse existing Grok tab instead of opening new one
              const response = await chrome.runtime.sendMessage({
                action: 'openOrActivateTab',
                urlPattern: window.ProviderConfigManager?.getTabQuery('grok'),
                createUrl: window.ProviderConfigManager?.getProviderUrl('grok', 'imagine') || window.ProviderConfigManager?.getCreateUrl('grok'),
                activate: true
              });
              if (response?.tabId) {
                // Start polling login status sau khi mở/activate tab
                _pollProviderLogin('grok', response.tabId);
              }
            } catch (err) {
              console.error('[SEOSONA Flow] Không mở được tab Grok:', err);
            }
          }
        });
      }

      // 1b. Initialize AuthManager
      if (!window.authManager) {
        window.authManager = {
          init: async () => {},
          fetchUser: async () => ({ id: 'local_user', name: 'Local User', plan_slug: 'unlimited' }),
          isLoggedIn: () => true,
          isAdmin: () => true,
          canManageTemplates: () => true,
          getToken: async () => 'dummy_token',
          getUser: () => ({ id: 'local_user', name: 'Local User', plan_slug: 'unlimited' }),
          user: { id: 'local_user', name: 'Local User', plan_slug: 'unlimited' },
          token: 'dummy_token',
          apiBaseUrl: 'https://api.seosona.com/api/v1',
          _apiCall: async () => ({}),
          logout: async () => {},
          showLoginModal: () => {},
          _clearAuth: async () => {},
          _sessionInvalid: false
        };
      }
      setLoadingText(window.I18n?.t('app.checkingLogin') || 'Đang kiểm tra đăng nhập...');
      if (window.authManager) {
        await window.authManager.init();
        log('AuthManager ready, logged in:', true);

        // [Feature: IP Geolocation 2026-05-23] Init LocationCache (fetch /location/me nếu cache empty/expired).
        // [Perf 2026-05-23] Bỏ refetch on auth:login/auth:restored — IP user hiếm đổi.
        // Cache TTL 24h tự handle. User travel quốc tế → đợi 24h hoặc clear chrome.storage manual.
        if (window.LocationCache) {
          window.LocationCache.init().catch(e => console.warn('[App] LocationCache init failed:', e.message));
        }

        // Initialize RequestCoalescer for popup window coordination
        // Popup windows delegate GET requests to sidePanel to avoid duplicate API calls
        if (window.RequestCoalescer) {
          window.RequestCoalescer.init();
          log('RequestCoalescer ready, isLeader:', window.RequestCoalescer.isLeader());
        }

        // Setup login/logout UI handlers
        setupAuthUI();
        setupQuickControlsFooter();
        setupTipCoffee();
        setupReplayOnboardingBtn();
        setupExtensionLink();
        setupUsageStatsModal();
        setupLanguageModal();
      }

      // 1c. Initialize FeatureGate (for both logged-in users and anonymous trial limits)
      if (window.featureGate) {
        await window.featureGate.init();
        log('FeatureGate ready, plan:', window.featureGate.getPlan()?.slug || 'trial');
      }

      // SS-6: Fetch system settings and apply to UI
      if (window.SystemConfig) {
        setLoadingText(window.I18n?.t('app.loadingSystemConfig') || 'Đang tải cấu hình hệ thống...');
        await window.SystemConfig.fetch();
        window.SystemConfig.applyToUI();
        log('SystemConfig ready, maintenance_mode:', window.SystemConfig.getBool('maintenance_mode'));
      }

      // 1d+1e. If logged in, fetch data in parallel
      if (true) {
        setLoadingText(window.I18n?.t('app.loadingConfig') || 'Đang tải cấu hình...');
        await window.featureGate?.init?.();
        log('FeatureGate ready');

        // LOCAL-FIRST: KHÔNG có module gating (featureGate allow-all). Gỡ `module-pending` khỏi
        // MỌI tab-pane + ẩn .module-blocked-overlay ngay — nếu không, các tab hardcode
        // module-pending (vd #tab-spaces) sẽ bị .module-blocked-overlay (lớp đen mờ rgba(10,10,14,.85))
        // CHE nội dung khi refreshModuleOverlays chưa chạy / featureGate chưa sẵn sàng.
        try {
          document.querySelectorAll('.tab-pane.module-pending').forEach((p) => p.classList.remove('module-pending'));
          document.querySelectorAll('.module-blocked-overlay').forEach((o) => o.classList.add('hidden'));
        } catch (_) { /* best-effort */ }

        // R-2.2: SSE connect khi khởi tạo nếu đã đăng nhập
        // LOCAL: không có backend → không mở SSE/Mercure.
        if (window.SseClient && !_IS_LOCAL) {
          console.log('[SSE] Đã đăng nhập → kết nối SSE ban đầu');
          window.SseClient.connect();
        }
      }

      // [Phase 5 2026-05-24] ConfigVersionPoller — lightweight version check fallback cho SSE drop.
      // Replace 2-phút interval + focus-driven full refresh. Fetch /config/versions (~200B)
      // định kỳ, diff cached versions, trigger module refresh nếu mismatch.
      // Backward compat: 404 endpoint chưa deploy → log warn + skip (graceful degrade).
      if (window.ConfigVersionPoller) {
        await window.ConfigVersionPoller.init();
        log('ConfigVersionPoller ready');
      }

      // Helper function to add image to GenTab (used by message listener and pending queue)
      function _addImageToGenTabInternal(tileId, fileName, thumbnail) {
        if (!tileId) {
          return { success: false, error: 'Missing tileId' };
        }
        // Check GenTab available
        if (!window.GenTab?.fileIdsInput) {
          return { success: false, error: 'GenTab not ready' };
        }
        // Check duplicate
        const existingIds = (window.GenTab.fileIdsInput.value || '').split(',').map(s => s.trim()).filter(Boolean);
        if (existingIds.includes(tileId)) {
          return { success: true, alreadyExists: true };
        }
        // Cache thumbnail và fileName
        if (thumbnail) {
          window.GenTab.thumbnailCache = window.GenTab.thumbnailCache || {};
          window.GenTab.thumbnailCache[tileId] = thumbnail;
        }
        if (fileName) {
          window.GenTab.fileNameCache = window.GenTab.fileNameCache || {};
          window.GenTab.fileNameCache[tileId] = fileName;
        }
        // Add to fileIdsInput
        const newIds = [...existingIds, tileId];
        window.GenTab.fileIdsInput.value = newIds.join(', ');
        window.GenTab.fileIdsInput.dispatchEvent(new Event('input', { bubbles: true }));
        // Re-render thumbnails
        if (typeof window.GenTab.renderFileIdThumbnails === 'function') {
          window.GenTab.renderFileIdThumbnails();
        }
        return { success: true, alreadyExists: false };
      }

      // Process pending images from background.js queue (when sidePanel was closed)
      async function _processPendingAddToGenTab() {
        try {
          const storage = await chrome.storage.local.get(['_pendingAddToGenTab']);
          const pending = storage._pendingAddToGenTab || [];
          if (pending.length === 0) return;

          console.log(`[SEOSONA Flow] Processing ${pending.length} pending addImageToGenTab`);
          let addedCount = 0;
          for (const item of pending) {
            const result = _addImageToGenTabInternal(item.tileId, item.fileName, item.thumbnail);
            if (result.success && !result.alreadyExists) {
              addedCount++;
            }
          }

          // Clear pending queue
          await chrome.storage.local.remove('_pendingAddToGenTab');

          if (addedCount > 0) {
            sidebarLog(`Đã thêm ${addedCount} ảnh vào Tab 1 (từ Flow page)`, 'success');
          }
        } catch (e) {
          console.warn('[SEOSONA Flow] Error processing pending addToGenTab:', e);
        }
      }

      // 1.1.47 port: thêm ảnh dạng upload local (lazy) vào GenTab từ base64 (context menu "Gửi ảnh → Tạo"
      // / nút trên i2p card). Tạo File từ base64 → GenTab.addUploadRefImages (mirror nhánh upload picker).
      // Flow upload thực khi submit gen.
      function _addLocalImageToGenTabInternal({ base64, name, type } = {}) {
        if (!base64 || !window.GenTab?.addUploadRefImages) return { success: false, error: 'GenTab not ready' };
        try {
          const bin = atob(base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const t = type || 'image/jpeg';
          const file = new File([bytes], name || `gen_ref_${Date.now()}.jpg`, { type: t });
          const thumbnail = `data:${t};base64,${base64}`;
          const added = window.GenTab.addUploadRefImages([{ file, thumbnail, type: t }]);
          return { success: added > 0, added };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }

      // Drain pending local images (context menu / i2p card → background lưu pending + signal drain).
      // Busy guard: init-drain + signal-drain có thể trigger gần nhau → tránh double add.
      let _localDrainBusy = false;
      async function _resolvePendingLocalImageItem(item) {
        if (item?.base64) return item;
        const embedded = item?.sourceImport?.embeddedImage;
        if (embedded?.base64) {
          return {
            base64: embedded.base64,
            name: embedded.name || item.name,
            type: embedded.mimeType || item.type,
          };
        }
        const stagingRef = item?.stagingRef || item?.sourceImport?.stagingRef;
        if (!stagingRef) return item;
        try {
          const resp = await chrome.runtime.sendMessage({ action: 'sourceImport:get', stagingRef });
          if (!resp?.ok || !resp.record?.base64) return item;
          return {
            base64: resp.record.base64,
            name: resp.record.name || item.name,
            type: resp.record.mimeType || item.type,
          };
        } catch (_) {
          return item;
        }
      }
      async function _processPendingLocalToGenTab() {
        if (_localDrainBusy) return;
        _localDrainBusy = true;
        try {
          const storage = await chrome.storage.local.get(['_pendingLocalToGenTab']);
          const pending = storage._pendingLocalToGenTab || [];
          if (pending.length === 0) return;
          await chrome.storage.local.remove('_pendingLocalToGenTab'); // clear TRƯỚC → tránh double add do re-init
          let addedCount = 0;
          for (const item of pending) {
            const resolvedItem = await _resolvePendingLocalImageItem(item);
            const r = _addLocalImageToGenTabInternal(resolvedItem);
            if (r.success) addedCount += (r.added || 1);
          }
          if (addedCount > 0) {
            try { window.SidebarManager?.switchTo?.('tab-gen'); } catch (_) { globalThis.SEOSONA_swallow?.('app#_processPendingLocalToGenTab', _); }
            const _msg = window.I18n?.t('gen.refImageAddedCount', { count: addedCount })
              || `Đã thêm ${addedCount} ảnh tham chiếu vào tab Tạo`;
            window.showNotification?.(_msg, 'success', 2500);
          }
        } catch (e) {
          console.warn('[SEOSONA Flow] Error processing pending localToGenTab:', e);
        } finally {
          _localDrainBusy = false;
        }
      }
      window._processPendingLocalToGenTab = _processPendingLocalToGenTab;

      // Toast i18n theo locale hiện tại (không phụ thuộc DB i18n — fix VN-only).
      function _i2pToastText() {
        const loc = (window.I18n && (window.I18n.getLocale?.() || window.I18n._currentLocale)) || 'vi';
        const m = {
          vi: 'Đã đưa prompt vào SEOSONA Flow',
          en: 'Prompt added to SEOSONA Flow',


        };
        return m[loc] || m.en;
      }
      // Image-to-Prompt closed-loop: đổ prompt (từ card I2P) vào GenTab + chuyển sang Tab Gen.
      function _setGenPromptInternal(text) {
        if (!text || !window.GenTab?.promptsArea) return { success: false, error: 'GenTab not ready' };
        window.GenTab.promptsArea.value = text;
        window.GenTab.promptsArea.dispatchEvent(new Event('input', { bubbles: true }));
        // Nhiều prompt (cách nhau dòng trống) → bật multi-prompt để GenTab tách đúng N (split /\n\s*\n/).
        // Single prompt (i2p) không có dòng trống → giữ nguyên trạng thái checkbox.
        try {
          const blocks = String(text).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
          const mpc = document.getElementById('multiPromptCheck');
          if (mpc && blocks.length > 1 && !mpc.checked) {
            mpc.checked = true;
            mpc.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } catch (_) { globalThis.SEOSONA_swallow?.('app#_setGenPromptInternal', _); }
        try { window.SidebarManager?.switchTo?.('tab-gen'); } catch (_) { globalThis.SEOSONA_swallow?.('app#_setGenPromptInternal', _); }
        try { window.GenTab.promptsArea.focus(); } catch (_) { globalThis.SEOSONA_swallow?.('app#_setGenPromptInternal', _); }
        return { success: true };
      }
      async function _processPendingI2pPrompt() {
        try {
          const st = await chrome.storage.local.get(['i2p_pending_prompt']);
          const p = st.i2p_pending_prompt;
          if (p && p.text) {
            const r = _setGenPromptInternal(p.text);
            if (r.success) {
              await chrome.storage.local.remove('i2p_pending_prompt');
              window.showNotification?.(_i2pToastText(), 'success', 3000);
            }
          }
        } catch (e) { console.warn('[I2P] process pending prompt:', e); }
      }
      window._processPendingI2pPrompt = _processPendingI2pPrompt;
      window._setGenPromptInternal = _setGenPromptInternal; // Prompt Assistant đổ kết quả vào Gen

      // Listen for log messages forwarded from content.js
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'contentLog') {
          sidebarLog(msg.msg, msg.level || 'info');
        }
        if (msg.action === 'promptExecutionComplete') {
          sidebarLog(window.I18n?.t('app.executionComplete', { completed: msg.completedCount, total: msg.totalCount }) || `Execution hoàn tất: ${msg.completedCount}/${msg.totalCount} thành công`, msg.failedCount > 0 ? 'warn' : 'info');
        }
        // Settings saved từ settings popup window
        if (msg.action === 'settingsSaved') {
          window.showNotification?.(msg.message || window.I18n?.t('settings.saved') || 'Cài đặt đã được cập nhật', 'success', 3000);
        }
        // PQ: Pipeline control từ FloatingTracker trong Flow page
        if (msg.action === 'queue:stop_all') {
          if (window.PromptQueue) {
            PromptQueue.getInstance()?.stopAll();
          }
          // ChatGPT/Grok gen chạy NGOÀI PromptQueue (loop GenTab) → set stop flag để loop dừng trước prompt kế.
          // Reset về false ở đầu mỗi run nên để true sau khi dừng là an toàn.
          if (window.GenTab) { GenTab._chatgptStopRequested = true; GenTab._grokStopRequested = true; }
        }
        if (msg.action === 'queue:stop_job' && msg.jobId) {
          window.eventBus?.emit('queue:stop_job', { jobId: msg.jobId });
          // job 'chat-gen' = ChatGPT/Grok direct loop (chỉ 1 provider chạy/lúc) → set cả 2 flag, run đang chạy sẽ dừng.
          if (window.GenTab && msg.jobId === 'chat-gen') { GenTab._chatgptStopRequested = true; GenTab._grokStopRequested = true; }
        }
        if (msg.action === 'queue:pause_job' && msg.jobId) {
          window.eventBus?.emit('queue:pause_job', { jobId: msg.jobId });
        }
        if (msg.action === 'queue:resume_job' && msg.jobId) {
          window.eventBus?.emit('queue:resume_job', { jobId: msg.jobId });
        }
        // Captcha overlay trên Flow tab (content.js) → user bấm "Tiếp tục"/"Dừng".
        // content.js gửi chrome.runtime.sendMessage; PromptQueue nghe qua eventBus
        // (PromptQueue.js:75 → _onCaptchaUserAction). Bridge runtime → eventBus tại đây,
        // nếu thiếu thì click Resume/Abort không bao giờ tới PromptQueue → job kẹt vĩnh viễn.
        if (msg.action === 'captcha:userAction') {
          window.eventBus?.emit('captcha:userAction', { decision: msg.decision });
        }
        // Flow tab trở lại active → auto-upload pending local files + re-sync project context
        if (msg.action === 'flowTabActivated') {
          if (window.ImmediateUploader) {
            window.ImmediateUploader.uploadAllPending().then((result) => {
              if (result.uploaded > 0) {
                console.log(`[SEOSONA Flow] Auto-uploaded ${result.uploaded} pending file(s) khi Flow tab active`);
              }
            }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#_processPendingI2pPrompt', _e); });
          }
          // Re-sync project context khi user switch Flow tab (mỗi Flow tab có thể ở project khác)
          _requestProjectContext();
        }
        // Thêm ảnh từ Flow page vào GenTab ref images (click overlay "+" button trên tile)
        if (msg.action === 'addImageToGenTab') {
          const result = _addImageToGenTabInternal(msg.tileId, msg.fileName, msg.thumbnail);
          // Switch sidebar sang GenTab (tab-gen) khi thêm ref image (kể cả khi ảnh đã có sẵn) → user
          // thấy ngay ref vừa add. Dùng cùng cách với xử lý pending (click tab element).
          if (result?.success) {
            try { window.SidebarManager?.switchTo?.('tab-gen'); } catch (_) { globalThis.SEOSONA_swallow?.('app#_processPendingI2pPrompt', _); }
          }
          sendResponse(result);
          return true;
        }
        // Image-to-Prompt: đổ prompt vào GenTab (sidebar đang mở). Nếu chưa mở → background đã
        // lưu i2p_pending_prompt, drain khi sidebar init (_processPendingI2pPrompt).
        if (msg.action === 'i2p:setGenPrompt') {
          const result = _setGenPromptInternal(msg.text);
          if (result.success) {
            try { chrome.storage.local.remove('i2p_pending_prompt'); } catch (_) { globalThis.SEOSONA_swallow?.('app#_processPendingI2pPrompt', _); }
            window.showNotification?.(_i2pToastText(), 'success', 3000);
          }
          sendResponse(result);
          return true;
        }
        // 1.1.47 port: ảnh upload local (context menu / i2p card) → background lưu pending + signal
        // → drain vào GenTab + notify. (init-drain xử lý case sidebar từng đóng.)
        if (msg.action === 'drainLocalToGenTab') {
          _processPendingLocalToGenTab();
          sendResponse({ ok: true });
          return true;
        }
        // Không giữ message port
        return false;
      });

      // Forward execution:log events vào sidebar log tab
      window.eventBus.on('execution:log', (data) => {
        const nodeId = data.nodeId;
        let prefix = '';
        if (nodeId && window.workflowEditor) {
          const name = window.workflowEditor._getNodeNameById?.(nodeId);
          if (name) prefix = `[${name}] `;
        }
        const level = data.type === 'success' ? 'info' : data.type || 'info';
        sidebarLog(`${prefix}${data.message}`, level);
      });

      // 1f. Restore pending uploads from IndexedDB
      if (window.PendingUploadStore) {
        await PendingUploadStore.restore();
        await PendingUploadStore.restoreCache();
        await PendingUploadStore.restoreLightweight();
        log('PendingUploadStore ready');

        // Cleanup stale upload refs that are no longer in IndexedDB (expired or cleared)
        if (window.GenTab?.cleanupUnavailableUploads) {
          window.GenTab.cleanupUnavailableUploads();
        }

        // S2: Schedule periodic cleanup cho IndexedDB (dọn entries hết hạn)
        PendingUploadStore._scheduleCleanup();

        // Re-render thumbnails vì GenTab.init() chạy trước PendingUploadStore.restore()
        // → lúc đó pendingUploadFiles còn rỗng, thumbnail upload_ không hiển thị
        if (window.pendingUploadFiles?.size > 0 && window.GenTab?.renderFileIdThumbnails) {
          window.GenTab.renderFileIdThumbnails();
        }

        // Process pending images from Flow page "+" button (added while sidePanel was closed)
        _processPendingAddToGenTab();
        // Process pending prompt from Image-to-Prompt card (Gen trên Flow khi sidebar đóng)
        _processPendingI2pPrompt();
        // 1.1.47 port: process pending local images (context menu "Gửi ảnh → Tạo" khi sidebar đóng)
        _processPendingLocalToGenTab();
      }

      // 2. Initialize StorageManager
      setLoadingText(window.I18n?.t('msg.loadingData') || 'Đang tải dữ liệu...');
      if (!window.storageManager) {
        window.storageManager = new StorageManager();
      }
      await window.storageManager.init();
      log('StorageManager ready, mode:', window.storageManager.getMode());

      // 2b. Apply saved settings (theme, position, executor)
      if (window.StorageSettings && !window.storageSettings) {
        window.storageSettings = new StorageSettings();
      }

      // 2b0. Re-apply StorageSettings to GenTab (GenTab.init runs before storageSettings exists)
      // This ensures ratio/genType/model from Settings popup are applied correctly
      if (window.GenTab?._applyStorageSettings) {
        window.GenTab._applyStorageSettings();
      }

      // 2b1. Warm cache cho 3 Group B managers (fire-and-forget)
      // PERF FIX (2026-05-17): bỏ duplicate PCM fetch ở đây — đã fire ở init() Block 1 (line 1512+1516).
      // Trước fix: cùng endpoints `/providers/dom-selectors` + `/providers/api-configs` fetch 2 lần
      // (Block 1 + Block 2) trong cùng init session → server VPS 1.9GB RAM bị áp lực (PHP-FPM
      // mỗi request ~40MB). Block 1 đã fire sớm hơn → data sẵn sàng khi Block 2 reach.
      try {
        window.ModelRegistry?.fetchInBackground?.();
        window.ValidationRules?.fetchInBackground?.();
        // PCM fetches đã được trigger ở line 1512 + 1516 — không cần duplicate ở đây.
        // Nếu Block 1 còn pending → dedup qua `_fetchPromise` (chấp nhận concurrent call).
      } catch (_) { /* ignore — managers chưa load thì skip */ }

      // 2b2. Initialize GenerationHistory (auto-save hooks)
      if (window.generationHistory) {
        await window.generationHistory.init();
        log('GenerationHistory ready');
      }

      // 2b3. Initialize UserPromptsManager
      if (window.userPromptsManager) {
        await window.userPromptsManager.init();
        log('UserPromptsManager ready');
      }

      // 2b4. SnippetsPanel removed from Tab Gen (prompt search modal replaces it)

      // 2b4c. Initialize NotificationManager
      if (window.NotificationManager) {
        await NotificationManager.init();
        log('NotificationManager ready');
      }

      // 2c. Initialize ImagePickerModal (shared singleton)
      if (window.ImagePickerModal && !window.imagePickerModal) {
        window.imagePickerModal = new ImagePickerModal();
        log('ImagePickerModal ready');
      }

      // 2d. Initialize TaskModal early (singleton, listens on eventBus)
      if (window.TaskModal && !window.taskModal) {
        window.taskModal = new TaskModal();
        log('TaskModal ready');
      }

      // 2e. Setup task executor listener for Tab 2
      setupTaskExecutor();

      // 2f. [tracker-unified] QĐ user: BỎ HẲN tracker trong sidebar — chỉ giữ tracker NỔI ngoài
      // trang (FloatingTracker Flow / floating-tracker-rich chat). Tránh trùng "2 cái" + user thích
      // cái nổi hơn. → KHÔNG init ExecutionTracker/PipelineFooter nữa (cái nổi phủ cả 2 mode:
      // FloatingTracker.update=pipeline, .updateLegacy=legacy).
      log('SidePanel tracker disabled (unified → chỉ dùng tracker nổi ngoài trang)');

      // 2f.1. Relay execution:tracker_update → FloatingTracker trên Flow page (legacy mode)
      // Cho phép task/workflow/angles owners hiển thị progress trên FloatingTracker
      if (window.eventBus && typeof MessageBridge !== 'undefined') {
        let _trackerStartedAt = null;
        window.eventBus.on('execution:tracker_update', (data) => {
          // Pipeline mode: FloatingTracker đã nhận data qua pq:trackerUpdate riêng
          if (window.PromptQueue && PromptQueue.isEnabled()) return;
          // prompts owner: content.js tự gọi FloatingTracker.updateLegacy() trực tiếp
          if (data.owner === 'prompts') return;

          if (data.phase === 'started') _trackerStartedAt = Date.now();
          const status = data.phase === 'completed' ? 'completed'
            : data.phase === 'error' ? 'stopped'
            : data.phase === 'paused' ? 'paused' : 'running';

          MessageBridge.sendToContentScript('legacyTrackerUpdate', {
            data: {
              owner: data.owner,
              label: data.label || data.owner,
              status: status,
              current: data.current || 0,
              total: data.total || 0,
              failed: data.errorCount || 0,
              startedAt: _trackerStartedAt
            }
          }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#sync', _e); });
        });
      }

      // 2f.2. [tracker-unified] Nút "Dừng" ở footer sidebar — thay stop control đã mất khi bỏ tracker
      // sidebar. Chạy trong context sidebar (ExecutionStop.forceStopAll) nên dừng được DÙ tab Flow
      // stale/đóng/không focus. Ẩn mặc định, hiện khi có tác vụ chạy.
      (function setupSidebarStopBtn() {
        const btn = document.getElementById('qcStopAll');
        if (!btn) return;
        const isRunning = () => {
          try {
            if (window.workflowExecutor && window.workflowExecutor.isRunning) return true;
            const ls = window.ExecutionLock && ExecutionLock.getState && ExecutionLock.getState();
            if (ls && ls.locked) return true;
            const pq = window.PromptQueue && PromptQueue.getInstance && PromptQueue.getInstance();
            if (pq && pq.isRunning) return true;
          } catch (_) { globalThis.SEOSONA_swallow?.('app#isRunning', _); }
          return false;
        };
        const sync = () => { btn.hidden = !isRunning(); };
        btn.addEventListener('click', () => {
          const pipeline = !!(window.PromptQueue && PromptQueue.isEnabled && PromptQueue.isEnabled());
          if (window.ExecutionStop) window.ExecutionStop.forceStopAll({ pipelineMode: pipeline });
          btn.hidden = true;
        });
        if (window.eventBus) {
          eventBus.on('execution:lock_changed', sync);
          eventBus.on('queue:state_changed', sync);
          eventBus.on('queue:external_state', sync);
          eventBus.on('execution:completed', () => setTimeout(sync, 0));
          eventBus.on('execution:force_stopped', () => { btn.hidden = true; });
          eventBus.on('execution:tracker_update', (d) => {
            if (d && (d.phase === 'completed' || d.phase === 'error')) return;
            btn.hidden = false;
          });
        }
        log('Sidebar stop button ready');
      })();

      // 2g. Initialize QueueMonitor sub-tab in logs
      if (window.QueueMonitor) {
        QueueMonitor.init();
        log('QueueMonitor ready');
      }

      // 2h. Setup logs sub-tab switching
      _setupLogsSubtabs();
      // Chấm trạng thái kết nối Flow ở header. Lỗi hay gặp nhất không phải lỗi logic mà là
      // quên mở tab Flow / chưa đăng nhập / tab cũ mất kết nối sau khi tải lại tiện ích —
      // trước đây chỉ lộ ra SAU KHI bấm chạy. Dùng chung bộ dò với tab Bác sĩ.
      try {
        const hdr = document.querySelector('.seosonaflow-header-actions');
        if (hdr && window.ConnectorHealthDot) ConnectorHealthDot.mount(hdr);
      } catch (e) { console.warn('[app] Gắn chấm kết nối lỗi:', e?.message); }

      // 2i. Setup prompts sub-tab switching (Templates / My Prompts)
      _setupPromptsSubtabs();

      // NOTE: Workflow subtabs được xử lý bởi WorkflowTab.js (có sẵn overlay logic)

      // 3. Tab switching: SidebarManager._bindCoreEvents là single owner (toggle .active + save
      // storage + gọi window.initializeTab). Listener init trùng lặp ở đây đã gỡ (Tier-1 Part B).
      setLoadingText(window.I18n?.t('app.initializingUI') || 'Đang khởi tạo giao diện...');

      // 3b. Angles button opens separate window (not a tab)
      const anglesBtn = document.getElementById('anglesToolbarBtn');
      if (anglesBtn) {
        anglesBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          // Check angles_enabled trước khi mở
          if (window.featureGate) {
            const isEnabled = await window.featureGate.isModuleEnabledAsync('angles');
            if (!isEnabled) {
              await window.featureGate.showModuleBlockedDialog('angles');
              return;
            }
          }
          chrome.runtime.sendMessage({
            action: 'openAnglesEditor',
            projectId: window._currentProjectId || null,
            projectName: window._currentProjectName || null
          });
        });
      }

      // 3c. Effects button opens separate window
      const effectsBtn = document.getElementById('effectsToolbarBtn');
      if (effectsBtn) {
        effectsBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          // Check effects_enabled trước khi mở (fallback to angles_enabled if not defined)
          if (window.featureGate) {
            const isEnabled = await window.featureGate.isModuleEnabledAsync('effects');
            if (!isEnabled) {
              await window.featureGate.showModuleBlockedDialog('effects');
              return;
            }
          }
          chrome.runtime.sendMessage({
            action: 'openEffectsEditor',
            projectId: window._currentProjectId || null,
            projectName: window._currentProjectName || null
          });
        });
      }

      // 3d. Telegram button opens settings popup at telegram tab
      const telegramBtn = document.getElementById('telegramToolbarBtn');
      if (telegramBtn) {
        telegramBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          chrome.runtime.sendMessage({ action: 'openSettings', tab: 'telegram' });
        });
      }

      // AI Agent (MCP) toolbar → mở settings tab AI / sub-tab MCP (hash #mcp)
      const aiAgentBtn = document.getElementById('aiAgentToolbarBtn');
      if (aiAgentBtn) {
        aiAgentBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          chrome.runtime.sendMessage({ action: 'openSettings', tab: 'mcp' });
        });
      }

      // Umbrella agent_bot_enabled: ẩn tools Telegram + AI Agent (MCP) khi plan tắt. CHỈ ẩn khi
      // EXPLICIT off (undefined/null → hiện — khớp backend default-allow). Gọi lại on entitlement change.
      window._gateAgentBotTools = async function () {
        let off = false;
        try {
          const r = await chrome.storage.local.get(['af_entitlements']);
          const ent = r.af_entitlements?.entitlements || {};
          const v = ent.agent_bot_enabled?.value ?? ent.agent_bot_enabled;
          off = (v === '0' || v === 0 || v === false);
        } catch (_) { globalThis.SEOSONA_swallow?.('app#_gateAgentBotTools', _); }
        ['telegramToolbarBtn', 'aiAgentToolbarBtn'].forEach((id) => {
          document.getElementById(id)?.classList.toggle('hidden', off);
        });
      };
      window._gateAgentBotTools();

      // U-4.6: Project indicator click handler
      const projBtn = document.getElementById('project-indicator-btn');
      if (projBtn) {
        projBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          _toggleProjectDropdown();
        });
      }

      // Nút tạo dự án mới
      const createBtn = document.getElementById('project-create-btn');
      if (createBtn) {
        createBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          _createNewProject();
        });
      }

      // 4. Initialize first active tab (restore from local storage)
      let activeTabId = null;
      try {
        const localData = await chrome.storage.local.get('af_active_sidebar_tab');
        // Migration (Tier-2 QĐ-4): remap id pane cũ → mới (tab-workflow→tab-spaces, tab-templates→tab-prompts).
        const _raw = localData?.af_active_sidebar_tab;
        activeTabId = ({ 'tab-workflow': 'tab-spaces', 'tab-templates': 'tab-prompts' })[_raw] || _raw || null;
      } catch (e) { /* storage unavailable */ }

      // Nếu có saved tab → switch sang tab đó
      if (activeTabId && document.getElementById(activeTabId)) {
        const tabBtns = document.querySelectorAll('.seosonaflow-tab');
        const tabPanes = document.querySelectorAll('.tab-pane');
        tabBtns.forEach(b => {
          b.classList.toggle('active', b.dataset.tab === activeTabId);
        });
        tabPanes.forEach(p => {
          p.classList.toggle('active', p.id === activeTabId);
        });
      }

      const activeTab = document.querySelector('.tab-pane.active');
      if (activeTab) {
        // Gating đã gỡ (Tier-1 Part A): local-first init thẳng. module-pending đã được
        // scrub ở bước init sớm (≈ dòng 2396).
        await initializeTab(activeTab.id);
      }

      log('App initialized successfully');

      // 5. Background thumbnail recovery: scan Flow DOM and refresh stale CDN URLs
      refreshAllThumbnails();

      // 6. Background project list maintenance
      // Auto-cleanup projects quá cũ (>30 ngày)
      _cleanupStaleProjects();
      // Sync danh sách projects từ Flow DOM (rename detection + xóa detection)
      setTimeout(() => _syncProjectsFromFlow(), 3000);

    } catch (error) {
      console.error('[SEOSONA Flow] Init failed:', error);

      // Show error state with retry button (I-2)
      setLoadingText(window.I18n?.t('app.loadError') || 'Lỗi tải dữ liệu. Thử lại...');
      const loadingContent = overlay?.querySelector('.seosonaflow-loading-content');
      if (loadingContent && !loadingContent.querySelector('.seosonaflow-loading-retry')) {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn btn-primary seosonaflow-loading-retry';
        retryBtn.textContent = window.I18n?.t('common.retry') || 'Thử lại';
        retryBtn.style.marginTop = '12px';
        retryBtn.addEventListener('click', () => {
          retryBtn.remove();
          overlay?.classList.remove('seosonaflow-loading-overlay--hidden');
          init();
        });
        loadingContent.appendChild(retryBtn);
      }
      return; // Don't hide overlay on error
    }

    // Hide loading overlay on success
    hideLoadingOverlay();

    // Show connecting overlay if still waiting for project context
    if (!_projectContextResolved && _isInitialRetrying) {
      _showConnectingOverlay();
    }

    // U-4.5: Hiển thị project select overlay nếu chưa có project
    // Chỉ show overlay nếu _requestProjectContext chưa resolve sau 3 giây (safety net)
    // CRITICAL: Cũng check _isInitialRetrying để tránh conflict với retry logic
    setTimeout(() => {
      if (!_projectContextResolved && !window._currentProjectId && !_isInitialRetrying) {
        _hideConnectingOverlay();
        _showProjectSelectOverlay();
      }
    }, 3000);
  }

  /**
   * Scan Flow DOM and refresh stale/expired thumbnail URLs across all stored data.
   * Runs in background after init — non-blocking, fire-and-forget.
   */
  async function refreshAllThumbnails() {
    // Delay to let content.js fully connect
    await new Promise(r => setTimeout(r, 2000));

    try {
      if (!window.MessageBridge) return;
      // silent=true: scan nền lúc init — không hiện modal "Không có Flow tab" nếu user chưa mở Flow.
      const scan = await MessageBridge.scanFlowImages(false, true);
      const images = scan?.images || [];
      if (images.length === 0) return;

      // Build fileId → thumbnail map from Flow DOM
      const flowThumbMap = {};
      for (const img of images) {
        if (img.fileId && img.thumbnail) {
          flowThumbMap[img.fileId] = img.thumbnail;
        }
      }

      log('Thumbnail recovery: scanned', images.length, 'tiles from Flow');

      let updatedCount = 0;

      // 1. Refresh task thumbnails (ref + result)
      try {
        const tasksRaw = await new Promise(resolve => {
          chrome.storage.local.get(['af_tasks'], r => resolve(r.af_tasks || []));
        });
        let tasksChanged = false;
        for (const task of tasksRaw) {
          // Refresh ref_thumbnails
          if (task.ref_thumbnails && task.ref_file_ids) {
            const refIds = task.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean);
            for (const id of refIds) {
              if (flowThumbMap[id] && task.ref_thumbnails[id] !== flowThumbMap[id]) {
                task.ref_thumbnails[id] = flowThumbMap[id];
                tasksChanged = true;
                updatedCount++;
              }
            }
          }
          // Refresh result_thumbnails
          if (task.result_thumbnails && task.result_file_ids) {
            const resultIds = task.result_file_ids.split(',').map(s => s.trim()).filter(Boolean);
            for (const id of resultIds) {
              if (flowThumbMap[id]) {
                const existing = task.result_thumbnails[id];
                const existingThumb = typeof existing === 'object' ? existing?.thumbnail : existing;
                if (existingThumb !== flowThumbMap[id]) {
                  // Preserve type field if exists
                  if (typeof existing === 'object' && existing?.type === 'video') {
                    task.result_thumbnails[id] = { ...existing, thumbnail: flowThumbMap[id] };
                  } else {
                    task.result_thumbnails[id] = flowThumbMap[id];
                  }
                  tasksChanged = true;
                  updatedCount++;
                }
              }
            }
          }
        }
        if (tasksChanged) {
          await new Promise(resolve => {
            chrome.storage.local.set({ af_tasks: tasksRaw }, resolve);
          });
          // Re-render task list if visible
          const autoTab = document.getElementById('tab-tasks');
          if (autoTab?.__multiTaskTab?.taskList) {
            autoTab.__multiTaskTab.taskList.loadTasks();
          }
        }
      } catch (e) {
        console.warn('[ThumbnailRecovery] Tasks refresh failed:', e.message);
      }

      // 2. Refresh angles results
      try {
        const anglesResults = await new Promise(resolve => {
          chrome.storage.local.get(['af_angles_results'], r => resolve(r.af_angles_results || []));
        });
        let anglesChanged = false;
        for (const entry of anglesResults) {
          if (entry.file_id && flowThumbMap[entry.file_id]) {
            if (entry.thumbnail_url !== flowThumbMap[entry.file_id]) {
              entry.thumbnail_url = flowThumbMap[entry.file_id];
              anglesChanged = true;
              updatedCount++;
            }
          }
        }
        if (anglesChanged) {
          await new Promise(resolve => {
            chrome.storage.local.set({ af_angles_results: anglesResults }, resolve);
          });
        }
      } catch (e) {
        console.warn('[ThumbnailRecovery] Angles refresh failed:', e.message);
      }

      // 3. Refresh workflow node thumbnails (ref + result)
      try {
        const nodesRaw = await new Promise(resolve => {
          chrome.storage.local.get(['af_nodes'], r => resolve(r.af_nodes || []));
        });
        let nodesChanged = false;
        for (const node of nodesRaw) {
          // Refresh ref_thumbnails
          if (node.ref_thumbnails) {
            for (const [fileId, url] of Object.entries(node.ref_thumbnails)) {
              if (flowThumbMap[fileId] && url !== flowThumbMap[fileId]) {
                node.ref_thumbnails[fileId] = flowThumbMap[fileId];
                nodesChanged = true;
                updatedCount++;
              }
            }
          }
          // Refresh result_thumbnails
          if (node.result_thumbnails) {
            for (const [fileId, url] of Object.entries(node.result_thumbnails)) {
              if (flowThumbMap[fileId] && url !== flowThumbMap[fileId]) {
                node.result_thumbnails[fileId] = flowThumbMap[fileId];
                nodesChanged = true;
                updatedCount++;
              }
            }
          }
        }
        if (nodesChanged) {
          await new Promise(resolve => {
            chrome.storage.local.set({ af_nodes: nodesRaw }, resolve);
          });
        }
      } catch (e) {
        console.warn('[ThumbnailRecovery] Nodes refresh failed:', e.message);
      }

      if (updatedCount > 0) {
        log('Thumbnail recovery: updated', updatedCount, 'thumbnails');
      }
    } catch (e) {
      // Silent fail — Flow tab may not be available. Mất kết nối (không có Flow tab / content script
      // chưa sẵn sàng) là BÌNH THƯỜNG khi init → chỉ log, không warn (tránh rác panel Lỗi).
      const _m = String(e?.message || '').toLowerCase();
      const _expected = _m.includes('could not establish connection') ||
        _m.includes('receiving end does not exist') ||
        _m.includes('không tìm thấy tab') ||
        _m.includes('no flow tab');
      if (_expected) {
        console.log('[ThumbnailRecovery] Bỏ qua scan: chưa có Flow tab sẵn sàng');
      } else {
        console.warn('[ThumbnailRecovery] Scan failed:', e.message);
      }
    }
  }

  /**
   * Hiển thị overlay khi module bị khóa
   * @param {HTMLElement} pane - Tab pane element
   * @param {string} module - Tên module (gen, tasks, workflows, angles)
   */
  function showModuleBlockedOverlay(pane, module) {
    // Xóa overlay cũ nếu có
    hideModuleBlockedOverlay(pane);

    const moduleNames = {
      gen: 'Generate',
      prompt_templates: 'Prompt Templates',
      tasks: 'Tasks',
      workflows: 'Workflows',
      angles: 'Angles'
    };
    const moduleName = moduleNames[module] || module;
    const isLoggedIn = true;

    // SS: Kiểm tra show_upgrade_ui để quyết định hiển thị nút nâng cấp hay liên hệ
    const showUpgrade = window.SystemConfig?.getBool('show_upgrade_ui') !== false;
    const contactUrl = window.SystemConfig?.get('upgrade_contact_url', '');

    let actionBtnLabel, actionBtnClass;
    if (!isLoggedIn) {
      actionBtnLabel = window.I18n?.t('auth.login') || 'Đăng nhập';
      actionBtnClass = 'module-blocked-btn';
    } else if (showUpgrade) {
      actionBtnLabel = window.I18n?.t('common.upgrade') || 'Nâng cấp';
      actionBtnClass = 'module-blocked-btn module-blocked-btn-upgrade';
    } else if (contactUrl) {
      actionBtnLabel = window.I18n?.t('overlay.contact') || 'Liên hệ';
      actionBtnClass = 'module-blocked-btn';
    } else {
      actionBtnLabel = '';
      actionBtnClass = '';
    }

    const overlay = document.createElement('div');
    overlay.className = 'module-blocked-overlay';
    overlay.innerHTML = `
      <div class="module-blocked-content">
        <div class="module-blocked-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h3 class="module-blocked-title">${isLoggedIn ? (window.I18n?.t('overlay.moduleBlocked') || 'Tính năng bị khóa') : (window.I18n?.t('overlay.requiresLogin') || 'Yêu cầu đăng nhập')}</h3>
        <p class="module-blocked-desc">${isLoggedIn
          ? `${window.I18n?.t('overlay.descriptionUpgrade', { module: moduleName }) || `Gói hiện tại không bao gồm tính năng <strong>${moduleName}</strong>`}.<br>${showUpgrade ? (window.I18n?.t('app.upgradeToUse') || 'Nâng cấp để sử dụng.') : (window.I18n?.t('app.contactAdmin') || 'Liên hệ admin để được hỗ trợ.')}`
          : `${window.I18n?.t('overlay.description', { module: moduleName }) || `Tính năng <strong>${moduleName}</strong> yêu cầu đăng nhập`}.<br>${window.I18n?.t('app.loginToUse') || 'Đăng nhập để sử dụng đầy đủ.'}`
        }</p>
        ${actionBtnLabel ? `<button class="${actionBtnClass}">${actionBtnLabel}</button>` : ''}
      </div>
    `;

    // Handle button click
    const actionBtn = overlay.querySelector('.module-blocked-btn');
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        if (!isLoggedIn) {
          // Mở login overlay
          const loginOverlay = document.getElementById('loginOverlay');
          if (loginOverlay) {
            loginOverlay.classList.remove('hidden');
          } else {
            chrome.runtime.sendMessage({ action: 'openSettings' });
          }
        } else if (showUpgrade) {
          // Mở upgrade modal (fetch plans + render)
          if (typeof window.openUpgradeModal === 'function') {
            window.openUpgradeModal();
          }
        } else if (contactUrl) {
          // Mở link liên hệ
          window.open(contactUrl, '_blank');
        }
      });
    }

    pane.style.position = 'relative';
    pane.appendChild(overlay);
  }

  /**
   * Ẩn overlay module blocked
   * @param {HTMLElement} pane - Tab pane element
   */
  function hideModuleBlockedOverlay(pane) {
    const existing = pane.querySelector('.module-blocked-overlay');
    if (existing) existing.remove();
  }

  /**
   * Refresh tất cả module overlays khi entitlements thay đổi
   * Gọi khi: featuregate:refreshed, auth:login, auth:logout
   * TỐI ƯU: Sử dụng sync check (không await) vì data đã có trong cache
   */
  function refreshModuleOverlays() {
    if (!window.featureGate) return;

    // NOTE: tab-prompts và tab-spaces sử dụng subtab overlays
    // nên không cần module overlay ở parent level
    // NOTE: tab-gen giờ check theo provider_status thay vì gen_enabled global
    const tabModuleMap = {
      'tab-tasks': 'tasks'
    };

    for (const [tabId, module] of Object.entries(tabModuleMap)) {
      const pane = document.getElementById(tabId);
      if (!pane) continue;

      pane.classList.remove('module-pending');

      const isEnabled = window.featureGate.isModuleEnabled(module);
      if (!isEnabled) {
        showModuleBlockedOverlay(pane, module);
      } else {
        hideModuleBlockedOverlay(pane);
      }
    }

    // tab-gen: check theo provider_status - hiện overlay chỉ khi TẤT CẢ providers đều bị khóa
    const genPane = document.getElementById('tab-gen');
    if (genPane) {
      genPane.classList.remove('module-pending');
      const fg = window.featureGate;
      const anyProviderEnabled = fg.canUse?.('gen_enabled') || fg.canUse?.('chatgpt_enabled') || fg.canUse?.('grok_enabled');
      if (!anyProviderEnabled) {
        showModuleBlockedOverlay(genPane, 'gen');
      } else {
        hideModuleBlockedOverlay(genPane);
      }
    }

    // Xóa module-pending cho tab-prompts (dùng prompts subtab overlays)
    const templatesPane = document.getElementById('tab-prompts');
    if (templatesPane) {
      templatesPane.classList.remove('module-pending');
      hideModuleBlockedOverlay(templatesPane);
    }

    // Xóa module-pending cho tab-spaces (WorkflowTab tự xử lý overlays)
    const workflowPane = document.getElementById('tab-spaces');
    if (workflowPane) {
      workflowPane.classList.remove('module-pending');
      hideModuleBlockedOverlay(workflowPane);
    }

    // Refresh subtab overlays
    refreshSubtabOverlays();
  }

  // Expose để có thể gọi từ nơi khác
  window.refreshModuleOverlays = refreshModuleOverlays;

  // checkModuleAccess() đã gỡ (Tier-1 Part A): local-first → featureGate cho phép mọi module,
  // hàm này luôn trả { allowed:true } nên đã xóa cùng caller.

  // Expose initializeTab để SidebarManager (single switch owner — Tier-1 Part B) gọi được.
  // Function declaration được hoist nên gán được ở đây; SidebarManager gọi lúc CLICK (sau khi
  // SeosonaFlowApp.init chạy) nên window.initializeTab luôn sẵn sàng.
  window.initializeTab = initializeTab;

  // Initialize specific tab
  async function initializeTab(tabId) {
    log('Initializing tab:', tabId);

    switch (tabId) {
      case 'tab-prompts': {
        const subtabContainer = document.getElementById('subtab-templates');
        // UX (2026-07-21): LOCAL mode → sub-tab "Templates" hiện GALLERY prompt mẫu (BundledPromptGallery)
        // để user bấm "Thêm vào My Prompt" mới copy — KHÔNG auto-nhét. Online → TemplatesTab (server) như cũ.
        if (self.SEOSONA_LOCAL_MODE !== false && window.BundledPromptGallery) {
          if (subtabContainer && !subtabContainer.__promptGallery) {
            subtabContainer.__promptGallery = new BundledPromptGallery(subtabContainer);
            subtabContainer.__promptGallery.init();
          }
        } else if (window.TemplatesTab) {
          // Templates Tab — render into subtab-templates pane
          if (subtabContainer && !subtabContainer.__templatesTab) {
            subtabContainer.__templatesTab = new TemplatesTab(subtabContainer);
            await subtabContainer.__templatesTab.init();
          } else if (subtabContainer?.__templatesTab) {
            subtabContainer.__templatesTab.reload();
          }
        }
        // MyPromptsTab — sub-tab switching + My Prompt management
        if (window.MyPromptsTab && !window.MyPromptsTab._initialized) {
          MyPromptsTab.init();
          window.MyPromptsTab._initialized = true;
        }
        break;
      }

      case 'tab-tasks':
        // Multi Task Tab
        if (window.MultiTaskTab) {
          const container = document.getElementById('tab-tasks');
          if (container && !container.__multiTaskTab) {
            container.__multiTaskTab = new MultiTaskTab(container);
            await container.__multiTaskTab.init();
          } else if (container?.__multiTaskTab?.taskList) {
            container.__multiTaskTab.taskList.loadTasks();
          }
        }
        break;

      case 'tab-spaces':
        // SEOSONA Flow Tab
        if (window.WorkflowTab) {
          const container = document.getElementById('tab-spaces');
          if (container && !container.__seosonaflowTab) {
            container.__seosonaflowTab = new WorkflowTab(container);
            await container.__seosonaflowTab.init();
          } else if (container?.__seosonaflowTab?.workflowList) {
            container.__seosonaflowTab.workflowList.loadWorkflows();
            // Cũng load shared workflows để section "Được chia sẻ với tôi"
            // refresh khi user chuyển vào tab (vd sau khi accept share ở tab khác)
            container.__seosonaflowTab.workflowList.loadSharedWorkflows();
          }
        }
        break;

      case 'tab-history':
        // History Tab
        if (window.HistoryTab) {
          const container = document.getElementById('tab-history');
          if (container && !container.__historyTab) {
            container.__historyTab = new HistoryTab(container);
            await container.__historyTab.init();
          } else if (container?.__historyTab) {
            container.__historyTab.reload();
          }
        }
        break;

      case 'tab-photos':
        // Photos Tab with sub-tabs
        if (window.PhotosTab) {
          await window.PhotosTab.init();
        }
        break;

      default:
        // Tab 1 (Prompts) - handled by existing content.js
        break;
    }
  }

  // Load CSS dynamically
  function loadCSS(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  // Load JS dynamically
  function loadJS(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Logs sub-tab switching (Nhật ký / Hàng đợi)
  function _setupLogsSubtabs() {
    const subtabs = document.querySelectorAll('.seosonaflow-logs-subtab');
    const mainContent = document.getElementById('logsMainContent');
    const queueContent = document.getElementById('logsQueueContent');
    // Tab "Kết quả" (tuỳ chọn — không có thì 2 tab cũ vẫn chạy như trước).
    const resultsContent = document.getElementById('logsResultsContent');
    // Tab "Bác sĩ" — cũng tuỳ chọn, cùng lý do.
    const doctorContent = document.getElementById('logsDoctorContent');

    if (!subtabs.length || !mainContent || !queueContent) return;

    subtabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.subtab;

        // Update active pill
        subtabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Toggle content visibility — ẩn hết rồi hiện đúng 1 cái (thêm tab thứ 3 không phá 2 tab cũ).
        const HIDE = 'seosonaflow-logs-subtab-content--hidden';
        mainContent.classList.add(HIDE);
        queueContent.classList.add(HIDE);
        resultsContent?.classList.add(HIDE);
        doctorContent?.classList.add(HIDE);
        const queueVisible = target === 'logs-queue';
        if (window.QueueMonitor) QueueMonitor.getInstance()?.setVisible(queueVisible);

        if (target === 'logs-main') {
          mainContent.classList.remove(HIDE);
        } else if (target === 'logs-queue') {
          queueContent.classList.remove(HIDE);
        } else if (target === 'logs-results' && resultsContent) {
          resultsContent.classList.remove(HIDE);
          // Khởi tạo lười: chỉ dựng khi user mở tab (không tốn gì lúc load panel).
          try {
            const host = document.getElementById('workflowResultsContent');
            if (window.WorkflowResultsTab && host) {
              const inst = WorkflowResultsTab.getInstance() || WorkflowResultsTab.init(host);
              inst.setVisible(true);
            }
          } catch (e) { console.warn('[app] Mở tab Kết quả lỗi:', e?.message); }
        } else if (target === 'logs-doctor' && doctorContent) {
          doctorContent.classList.remove(HIDE);
          // Cũng khởi tạo lười. Nội dung tra cứu là dữ liệu tĩnh → mở tab KHÔNG gọi mạng.
          try {
            const host = document.getElementById('flowDoctorContent');
            if (window.FlowDoctorTab && host) {
              const inst = FlowDoctorTab.getInstance() || FlowDoctorTab.init(host);
              inst.setVisible(true);
            }
          } catch (e) { console.warn('[app] Mở tab Bác sĩ lỗi:', e?.message); }
        }
      });
    });
  }

  // Prompts sub-tab switching with permission check
  function _setupPromptsSubtabs() {
    const subtabs = document.querySelectorAll('.prompts-subtab');
    const panes = {
      'subtab-templates': document.getElementById('subtab-templates'),
      'subtab-myprompts': document.getElementById('subtab-myprompts')
    };

    if (!subtabs.length) return;

    subtabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.subtab;

        // Update active pill
        subtabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Toggle pane visibility
        Object.entries(panes).forEach(([id, pane]) => {
          if (!pane) return;
          if (id === target) {
            pane.classList.add('active');
          } else {
            pane.classList.remove('active');
          }
        });

        // Check permission and show overlay if needed
        _checkSubtabPermission(target, panes[target]);
      });
    });

    // Initial check for default active subtab
    const activeSubtab = document.querySelector('.prompts-subtab.active');
    if (activeSubtab) {
      const target = activeSubtab.dataset.subtab;
      _checkSubtabPermission(target, panes[target]);
    }
  }

  // NOTE: Workflow subtabs được xử lý bởi WorkflowTab.js với _applySubtabFeatureGate()

  /**
   * Check permission for prompts subtab and show/hide overlay
   * @param {string} subtabId - ID của subtab (subtab-templates, subtab-myprompts)
   * @param {HTMLElement} pane - Subtab pane element
   */
  function _checkSubtabPermission(subtabId, pane) {
    if (!pane || !window.featureGate) return;

    // Map subtab ID -> feature key to check (chỉ prompts subtabs)
    const subtabFeatureMap = {
      'subtab-templates': { key: 'prompt_templates_enabled', type: 'boolean', name: 'Prompt Templates' },
      'subtab-myprompts': { key: 'snippets_max', type: 'quota', name: 'My Prompts' }
    };

    const featureConfig = subtabFeatureMap[subtabId];
    if (!featureConfig) return;

    const isLoggedIn = true;
    let isAllowed = false;

    if (featureConfig.type === 'boolean') {
      isAllowed = window.featureGate.canUse(featureConfig.key);
    } else if (featureConfig.type === 'quota') {
      // Sử dụng checkQuota để kiểm tra quota
      const quotaInfo = window.featureGate.checkQuota(featureConfig.key);
      // Cho phép nếu limit > 0 hoặc unlimited (có quyền dùng feature)
      isAllowed = quotaInfo.limit === 'unlimited' || quotaInfo.limit > 0;
    }

    if (!isAllowed) {
      _showSubtabBlockedOverlay(pane, featureConfig.name, isLoggedIn);
    } else {
      _hideSubtabBlockedOverlay(pane);
    }
  }

  /**
   * Show overlay khi subtab bị khóa
   * @param {HTMLElement} pane - Subtab pane element
   * @param {string} featureName - Tên feature để hiển thị
   * @param {boolean} isLoggedIn - User đã login chưa
   */
  function _showSubtabBlockedOverlay(pane, featureName, isLoggedIn) {
    // Xóa overlay cũ nếu có
    _hideSubtabBlockedOverlay(pane);

    const showUpgrade = window.SystemConfig?.getBool('show_upgrade_ui') !== false;
    const contactUrl = window.SystemConfig?.get('upgrade_contact_url', '');

    let actionBtnLabel, actionBtnClass;
    if (!isLoggedIn) {
      actionBtnLabel = window.I18n?.t('auth.login') || 'Đăng nhập';
      actionBtnClass = 'subtab-blocked-btn';
    } else if (showUpgrade) {
      actionBtnLabel = window.I18n?.t('common.upgrade') || 'Nâng cấp';
      actionBtnClass = 'subtab-blocked-btn subtab-blocked-btn-upgrade';
    } else if (contactUrl) {
      actionBtnLabel = window.I18n?.t('overlay.contact') || 'Liên hệ';
      actionBtnClass = 'subtab-blocked-btn';
    } else {
      actionBtnLabel = '';
      actionBtnClass = '';
    }

    const overlay = document.createElement('div');
    overlay.className = 'subtab-blocked-overlay';
    overlay.innerHTML = `
      <div class="subtab-blocked-content">
        <div class="subtab-blocked-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h3 class="subtab-blocked-title">${isLoggedIn ? (window.I18n?.t('overlay.moduleBlocked') || 'Tính năng bị khóa') : (window.I18n?.t('overlay.requiresLogin') || 'Yêu cầu đăng nhập')}</h3>
        <p class="subtab-blocked-desc">${isLoggedIn
          ? `${window.I18n?.t('overlay.descriptionUpgrade', { module: featureName }) || `Gói hiện tại không bao gồm tính năng <strong>${featureName}</strong>`}.<br>${showUpgrade ? (window.I18n?.t('app.upgradeToUse') || 'Nâng cấp để sử dụng.') : (window.I18n?.t('app.contactAdmin') || 'Liên hệ admin để được hỗ trợ.')}`
          : `${window.I18n?.t('overlay.description', { module: featureName }) || `Tính năng <strong>${featureName}</strong> yêu cầu đăng nhập`}.<br>${window.I18n?.t('app.loginToUse') || 'Đăng nhập để sử dụng đầy đủ.'}`
        }</p>
        ${actionBtnLabel ? `<button class="${actionBtnClass}">${actionBtnLabel}</button>` : ''}
      </div>
    `;

    // Handle button click
    const actionBtn = overlay.querySelector('.subtab-blocked-btn');
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        if (!isLoggedIn) {
          const loginOverlay = document.getElementById('loginOverlay');
          if (loginOverlay) {
            loginOverlay.classList.remove('hidden');
          } else {
            chrome.runtime.sendMessage({ action: 'openSettings' });
          }
        } else if (showUpgrade) {
          if (typeof window.openUpgradeModal === 'function') {
            window.openUpgradeModal();
          }
        } else if (contactUrl) {
          window.open(contactUrl, '_blank');
        }
      });
    }

    pane.style.position = 'relative';
    pane.appendChild(overlay);
  }

  /**
   * Ẩn overlay subtab blocked
   * @param {HTMLElement} pane - Subtab pane element
   */
  function _hideSubtabBlockedOverlay(pane) {
    const existing = pane.querySelector('.subtab-blocked-overlay');
    if (existing) existing.remove();
  }

  /**
   * Refresh prompts subtab overlays khi entitlements thay đổi
   * NOTE: Workflow subtabs được xử lý bởi WorkflowTab._applySubtabFeatureGate()
   */
  function refreshSubtabOverlays() {
    // Prompts subtabs
    const promptsActiveSubtab = document.querySelector('.prompts-subtab.active');
    if (promptsActiveSubtab) {
      const target = promptsActiveSubtab.dataset.subtab;
      const pane = document.getElementById(target);
      if (pane) _checkSubtabPermission(target, pane);
    }

    // Workflow subtabs - trigger WorkflowTab refresh
    const workflowTab = document.getElementById('tab-spaces');
    if (workflowTab?.__seosonaflowTab?._applySubtabFeatureGate) {
      const currentSubtab = workflowTab.__seosonaflowTab._currentSubtab || 'templates';
      workflowTab.__seosonaflowTab._applySubtabFeatureGate(currentSubtab);
    }
  }

  // Expose để có thể gọi từ nơi khác
  window.refreshSubtabOverlays = refreshSubtabOverlays;

  // Task executor for Tab 2 (Multi Task)
  function setupTaskExecutor() {
    if (!window.eventBus) return;

    window.eventBus.on('task:run', async (data) => {
      const { task } = data;

      // ExecutionLock: kiểm tra trước khi chạy
      if (window.ExecutionLock && ExecutionLock.isBlockedBy('task')) {
        const shouldStop = await ExecutionLock.showBlockedDialog('task');
        if (!shouldStop) return;
        await ExecutionLock.stopCurrent();
      }
      if (window.ExecutionLock) ExecutionLock.acquire('task', `Task: ${task.task_name || task.task_id}`);

      // Activate provider tab when execution starts.
      // CRITICAL: Chỉ activate Flow tab cho task provider=flow. ChatGPT/Grok tasks BYPASS Flow
      // editor — activate Flow tab sẽ steal focus + làm lệch context (chatgpt/grok.com tab bị
      // mất active state → React throttle → submit fails). Match GenTab pattern.
      const _taskProvider = task?.provider || 'flow';
      try {
        if (_taskProvider === 'chatgpt' && window.ChatGPTSession?.ensureReady) {
          window.ChatGPTSession.ensureReady({ createIfMissing: true, activate: true })
            .then(() => window.ChatGPTSession.ensureTabActive?.())
            .catch(err => console.warn('[Task] ChatGPT activate failed:', err?.message || err));
        } else if (_taskProvider === 'grok' && window.GrokSession?.ensureReady) {
          window.GrokSession.ensureReady({ createIfMissing: true, activate: true })
            .then(() => window.GrokSession.ensureTabActive?.())
            .catch(err => console.warn('[Task] Grok activate failed:', err?.message || err));
        } else {
          chrome.runtime.sendMessage({ action: 'activateFlowTabForExecution' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#setupTaskExecutor', _e); });
        }
      } catch (e) {
        console.warn('[executeSingleTask] Error activating provider tab:', e);
      }

      // SP-2.4: ExecutionGate - xin phep server truoc khi chay task
      let _taskExecutionToken = null;
      // Calculate prompt count for quota check and tracking
      const taskPrompts = (task.multi_prompt && task.prompts?.length > 1) ? task.prompts : [task.prompt];
      const taskPromptCount = taskPrompts.length;
      if (window.ExecutionGate) {
        try {
          // Bug fix 2026-05-22: pass provider để backend ALSO deduct chatgpt/grok/gemini_run_max.
          const gate = await ExecutionGate.request('task_run', taskPromptCount, { owner: 'task', label: task.task_name || task.task_id, provider: task.provider || 'flow' });
          if (!gate.allowed) {
            ExecutionGate.showDeniedDialog(gate, 'Task');
            if (window.ExecutionLock) ExecutionLock.release('task');
            return;
          }
          _taskExecutionToken = gate.token;
          window._currentTaskExecutionToken = _taskExecutionToken;
        } catch (e) {
          if (window.QuotaErrorHandler?.handleIfQuotaError(e, 'Task')) {
            console.warn('[Task] ExecutionGate denied:', e.code || e.reason);
            if (window.ExecutionLock) ExecutionLock.release('task');
            return;
          }
          console.error('[Task] ExecutionGate request failed, proceeding:', e.message);
        }
      }

      log('Executing task:', task.task_id, task.task_name);
      // Emit tracker started
      if (window.eventBus) {
        window.eventBus.emit('execution:tracker_update', {
          owner: 'task', label: `Task: ${task.task_name || task.task_id}`,
          phase: 'started', current: 0, total: 1
        });
      }
      const isPipeline = window.PromptQueue && PromptQueue.isEnabled();
      try {
        const taskResult = await executeSingleTask(task, { _executionToken: isPipeline ? _taskExecutionToken : null });

        // Bug 1+3 fix (2026-05-17): đọc actual counts từ taskResult (ChatGPT/Grok inner return
        // { success, failed, results, stopped }). Flow path return undefined → fallback taskPromptCount.
        const actualSuccess = taskResult?.success ?? taskPromptCount;
        const actualFailed = taskResult?.failed ?? 0;
        const wasStopped = taskResult?.stopped ?? false;

        // SP-2.4: ExecutionGate complete (chỉ direct mode — pipeline tự handle qua PromptQueue)
        if (!isPipeline && window.ExecutionGate && _taskExecutionToken) {
          // Bug 2+3 fix: status reflect actual outcome (kể cả stopped case).
          // ExecutionTracker._handleStop CHỈ set flag, KHÔNG cancel/complete token →
          // outer caller có scope đúng (single-task successCount) để gọi partial complete.
          let status;
          if (wasStopped) {
            // User stop giữa chừng: partial nếu đã có ≥1 success, failed nếu 0 success.
            // Server backend: partial refund = (promptCount - successful_count); failed refund = promptCount.
            status = actualSuccess > 0 ? 'partial' : 'failed';
          } else if (actualSuccess === 0) {
            status = 'failed';
          } else if (actualFailed > 0) {
            status = 'partial';
          } else {
            status = 'success';
          }
          const extraData = status === 'partial' ? { successful_count: actualSuccess } : {};
          ExecutionGate.complete(_taskExecutionToken, status, extraData);
        }
        // Bug 1 fix: track actual successful prompts thay vì task definition total.
        // Trước fix: recordPromptSubmit(taskPromptCount) → over-count khi user stop hoặc partial fail.
        if (window.featureGate && actualSuccess > 0) {
          window.featureGate.recordTaskRun(); // 1 task run
          window.featureGate.recordGenRun();
          window.featureGate.recordPromptSubmit(actualSuccess, 'task');
        }
        window._currentTaskExecutionToken = null;
      } catch (err) {
        // SP-2.4: ExecutionGate complete (chỉ direct mode)
        if (!isPipeline && window.ExecutionGate && _taskExecutionToken) {
          ExecutionGate.complete(_taskExecutionToken, 'failed', { error: err.message || String(err) });
        }
        window._currentTaskExecutionToken = null;
      }
      // Emit tracker completed
      if (window.eventBus) {
        window.eventBus.emit('execution:tracker_update', {
          owner: 'task', phase: 'completed', current: 1, total: 1
        });
      }

      if (window.ExecutionLock) ExecutionLock.release('task');
    });

    window.eventBus.on('tasks:run_batch', async (data) => {
      const { tasks, mode } = data;
      const isParallel = mode === 'parallel';

      // ExecutionLock: kiểm tra trước khi chạy batch
      if (window.ExecutionLock && ExecutionLock.isBlockedBy('task')) {
        const shouldStop = await ExecutionLock.showBlockedDialog('task');
        if (!shouldStop) return;
        await ExecutionLock.stopCurrent();
      }
      if (window.ExecutionLock) ExecutionLock.acquire('task', `Task batch (${tasks.length})`);

      // Activate provider tab when batch execution starts.
      // CRITICAL: Multi-provider batch (mixed Flow+ChatGPT+Grok) → activate FIRST task's provider.
      // executeSingleTask sẽ tự switch tab cho từng task khác provider trong vòng lặp.
      // Trước fix: always activate Flow → ChatGPT/Grok tasks fail submit.
      const _firstTask = tasks[0] || {};
      const _firstProvider = _firstTask.provider || 'flow';
      try {
        if (_firstProvider === 'chatgpt' && window.ChatGPTSession?.ensureReady) {
          window.ChatGPTSession.ensureReady({ createIfMissing: true, activate: true })
            .then(() => window.ChatGPTSession.ensureTabActive?.())
            .catch(err => console.warn('[runAllTasks] ChatGPT activate failed:', err?.message || err));
        } else if (_firstProvider === 'grok' && window.GrokSession?.ensureReady) {
          window.GrokSession.ensureReady({ createIfMissing: true, activate: true })
            .then(() => window.GrokSession.ensureTabActive?.())
            .catch(err => console.warn('[runAllTasks] Grok activate failed:', err?.message || err));
        } else {
          chrome.runtime.sendMessage({ action: 'activateFlowTabForExecution' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#setupTaskExecutor', _e); });
        }
      } catch (e) {
        console.warn('[runAllTasks] Error activating provider tab:', e);
      }

      // SP-2.4: ExecutionGate - xin phep server truoc khi chay batch
      let _batchExecutionToken = null;
      if (window.ExecutionGate) {
        try {
          const totalPrompts = tasks.reduce((sum, t) => {
            return sum + ((t.multi_prompt && t.prompts?.length > 1) ? t.prompts.length : 1);
          }, 0);
          // Bug fix 2026-05-22: pass provider nếu batch dùng đồng nhất 1 provider.
          // Mixed batch → skip provider deduct (acceptable: batch là power user feature, ít dùng).
          const _uniqueProviders = new Set(tasks.map(t => t.provider || 'flow'));
          const _batchProvider = _uniqueProviders.size === 1 ? [..._uniqueProviders][0] : null;
          const gate = await ExecutionGate.request('task_run', totalPrompts, { owner: 'task', label: 'Task batch', provider: _batchProvider });
          if (!gate.allowed) {
            ExecutionGate.showDeniedDialog(gate, 'Task');
            if (window.ExecutionLock) ExecutionLock.release('task');
            if (window.eventBus) window.eventBus.emit('tasks:batch_complete');
            return;
          }
          _batchExecutionToken = gate.token;
          window._currentTaskExecutionToken = _batchExecutionToken;
        } catch (e) {
          if (window.QuotaErrorHandler?.handleIfQuotaError(e, 'Task')) {
            console.warn('[Task] ExecutionGate batch denied:', e.code || e.reason);
            if (window.ExecutionLock) ExecutionLock.release('task');
            if (window.eventBus) window.eventBus.emit('tasks:batch_complete');
            return;
          }
          console.error('[Task] ExecutionGate batch request failed, proceeding:', e.message);
        }
      }

      log('Executing batch:', tasks.length, 'tasks, mode:', mode || 'sequential');

      // CG-6.4 + G-5.7 BUG FIX: Pipeline (PromptQueue) Flow-only.
      // Nếu batch có task provider!='flow' (chatgpt/grok) → BYPASS pipeline,
      // dùng path direct (line 2317+) để executeSingleTask route đúng adapter.
      const _hasNonFlowProvider = tasks.some(t => t.provider && t.provider !== 'flow');

      // Chuyển sang pipeline PromptQueue nếu bật VÀ batch chỉ có Flow tasks
      if (window.PromptQueue && PromptQueue.isEnabled() && !_hasNonFlowProvider) {
        const afS = window._afSettings || {};
        const settingsPerTask = tasks.map(t => {
          const gt = t.media_type || afS.defaultGenType || 'Image';
          const isVid = gt === 'Video';
          // Group C: Model defaults từ ModelRegistry (server-driven)
          // Phase 6 Bug N.1: strict Server-Only — không fallback hardcoded model name
          const _defVid = window.ModelRegistry?.safeGetDefault('flow', 'video');
          const _defImg = window.ModelRegistry?.safeGetDefault('flow', 'image');
          return {
            genType: gt,
            ratio: t.ratio || afS.defaultRatio || '9:16',
            model: t.model || (isVid ? (afS.defaultVideoModel || _defVid) : (afS.defaultImageModel || _defImg)),
            isFrames: isVid && t.video_input_type === 'Frames',
            quantity: t.quantity || 1,
          };
        });
        const effectiveMode = isParallel ? 'parallel' : 'sequential';
        const result = await PromptQueue.getInstance().submitTaskBatch(
          tasks, effectiveMode, settingsPerTask, { _executionToken: _batchExecutionToken }
        );
        log(`Pipeline batch hoàn tất: ${result.completed} thành công, ${result.failed} thất bại`);
        // ExecutionGate complete/cancel đã được PromptQueue handle — không double-complete
        window._currentTaskExecutionToken = null;
        // Track usage: pipeline batch completed - BUG FIX: only count COMPLETED tasks/prompts
        // (was counting ALL tasks even when stopped mid-execution)
        if (window.featureGate && result.completed > 0) {
          // Track tasks_run_max: 1 per COMPLETED task (not all tasks)
          for (let i = 0; i < result.completed; i++) {
            window.featureGate.recordTaskRun();
          }
          window.featureGate.recordGenRun();
          // Calculate prompts for COMPLETED tasks only (using completion ratio for estimation)
          const totalPlannedPrompts = tasks.reduce((sum, t) => {
            return sum + ((t.multi_prompt && t.prompts?.length > 1) ? t.prompts.length : 1);
          }, 0);
          const completedPrompts = Math.round(totalPlannedPrompts * (result.completed / tasks.length));
          window.featureGate.recordPromptSubmit(completedPrompts || 1, 'task_pipeline');
        }
        // Emit tracker completed
        if (window.eventBus) {
          window.eventBus.emit('execution:tracker_update', {
            owner: 'task', phase: 'completed', current: tasks.length, total: tasks.length
          });
          window.eventBus.emit('tasks:batch_complete');
        }
        if (window.ExecutionLock) ExecutionLock.release('task');
        return;
      }

      // Emit tracker started for batch
      if (window.eventBus) {
        window.eventBus.emit('execution:tracker_update', {
          owner: 'task', label: 'Run All Tasks',
          phase: 'started', current: 0, total: tasks.length,
          taskBatch: { current: 1, total: tasks.length, taskName: tasks[0]?.task_name || '' }
        });
      }

      if (isParallel) {
        // Song song: stagger tasks — chờ submit xong + delay → start task tiếp
        const delayMs = (window.workflowExecutor?.settings?.delayBetweenNodes || 3000);
        const taskPromises = [];

        for (let i = 0; i < tasks.length; i++) {
          if (window._taskBatchStopped) break;
          const task = tasks[i];

          // Emit tracker progress for parallel batch
          if (window.eventBus) {
            window.eventBus.emit('execution:tracker_update', {
              owner: 'task', label: 'Run All Tasks',
              phase: 'prompt_submitting', current: i + 1, total: tasks.length,
              taskBatch: { current: i + 1, total: tasks.length, taskName: task.task_name || '' }
            });
          }

          // Tạo signal cho "đã submit xong"
          let markSubmitted;
          const submittedPromise = new Promise(r => { markSubmitted = r; });

          // Fire-and-forget: task chạy độc lập (chờ tiles + retry riêng)
          const p = executeSingleTask(task, {
            isParallel: true,
            onSubmitted: markSubmitted
          }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#setupTaskExecutor', _e); });
          taskPromises.push(p);

          // Chờ task này submit xong
          await submittedPromise;

          // Delay giữa các task (theo setting)
          if (i < tasks.length - 1 && !window._taskBatchStopped) {
            await new Promise(r => setTimeout(r, delayMs));
          }
        }

        // Tất cả tasks đã submit xong → re-enable button sớm (không chờ tiles/download)
        if (window.eventBus) {
          window.eventBus.emit('tasks:all_submitted');
        }

        // Chờ tất cả tasks hoàn thành (tiles + retry)
        await Promise.allSettled(taskPromises);
      } else {
        // Tuần tự: chờ task hoàn thành rồi mới chạy task tiếp
        for (let i = 0; i < tasks.length; i++) {
          if (window._taskBatchStopped) break;
          const task = tasks[i];
          // Emit tracker task batch progress
          if (window.eventBus) {
            window.eventBus.emit('execution:tracker_update', {
              owner: 'task', label: 'Run All Tasks',
              phase: 'prompt_submitting', current: i + 1, total: tasks.length,
              taskBatch: { current: i + 1, total: tasks.length, taskName: task.task_name || '' }
            });
          }
          await executeSingleTask(task);
        }
      }

      window._taskBatchStopped = false;
      // Emit tracker batch completed
      if (window.eventBus) {
        window.eventBus.emit('execution:tracker_update', {
          owner: 'task', phase: 'completed', current: tasks.length, total: tasks.length
        });
      }
      // SP-2.4: ExecutionGate complete (batch — chỉ direct mode, pipeline tự handle)
      // Bug 2 fix: khi batch stop, partial complete cần `successful_count` để server refund đúng.
      // Note: best-effort estimate — batch không track per-prompt success count cross-tasks,
      // dùng (tasks.length - currentTaskIndex) làm approximation cho tasks chưa chạy.
      // Tracking chính xác cần Phase 7 refactor batch result aggregation.
      if (window.ExecutionGate && _batchExecutionToken) {
        const batchStatus = window._taskBatchStopped ? 'partial' : 'success';
        // Best-effort: nếu stop mid-batch, ước lượng successful_count = sum of completed tasks' prompts.
        // Hiện chưa track, dùng 0 fallback → server treat như cancel-equivalent (refund tất cả còn lại).
        const batchExtra = batchStatus === 'partial' ? { successful_count: 0 } : {};
        ExecutionGate.complete(_batchExecutionToken, batchStatus, batchExtra);
        window._currentTaskExecutionToken = null;
      }
      // Track usage: calculate total prompts from all tasks in batch
      // Bug 1 note: batch path dùng tổng prompts từ task definitions. Chính xác hơn cần aggregate
      // từng task's executeSingleTask return value — defer Phase 7. Hiện chấp nhận over-count
      // local stats khi batch stop (server-side tracking riêng qua ExecutionService).
      const batchTotalPrompts = tasks.reduce((sum, t) => {
        return sum + ((t.multi_prompt && t.prompts?.length > 1) ? t.prompts.length : 1);
      }, 0);
      if (window.featureGate && batchTotalPrompts > 0) {
        // Track tasks_run_max: 1 per task in batch
        for (let i = 0; i < tasks.length; i++) {
          window.featureGate.recordTaskRun();
        }
        window.featureGate.recordGenRun();
        window.featureGate.recordPromptSubmit(batchTotalPrompts, 'task_batch');
      }
      if (typeof notifyCompletion === 'function') {
        notifyCompletion('SEOSONA Flow', window.I18n?.t('app.batchComplete', { count: tasks.length }) || `Đã hoàn tất batch ${tasks.length} tasks!`);
      }
      if (window.eventBus) {
        window.eventBus.emit('tasks:batch_complete');
      }
      if (window.ExecutionLock) ExecutionLock.release('task');
    });
  }

  /**
   * CG-6.3: Thực thi task qua ChatGPT provider.
   *
   * Khác Flow path:
   *  - Đi qua window.ChatGPTAdapter (qua ProviderRegistry).
   *  - Không dùng PromptQueue (Pipeline mode hiện chỉ wire Flow). ChatGPT đi
   *    direct call qua MessageBridge.chatGPTSubmitAndWait bên trong adapter.
   *  - Ref images: ChatGPT chỉ accept pre-resolved object array (base64). Tile
   *    ID resolution defer sang CG-7 — hiện tại pass [] và để adapter warn.
   *  - Sequential prompts: gửi tuần tự, không parallel (1 tab / 1 editor).
   *  - ExecutionGate dùng action 'chatgpt_run' (đã được map trong adapter).
   *
   * Trả về { success, failed, results } theo convention executeSingleTask.
   */
  /**
   * Fix 10: Resolve task ref_file_ids → base64 objects cho ChatGPT.
   * Port logic từ GenTab._submitViaChatGPT.
   * - task.ref_file_ids: comma-separated string (tile IDs)
   * - task.ref_thumbnails: { tile_id: 'cdn_url' } — có thể là map object
   * - task.ref_file_names: { tile_id: 'uuid.png' }
   * - Cap maxRefImages (default 4 cho ChatGPT)
   * - Fetch URL → base64 qua background.js (bypass CORS)
   *
   * @param {object} task
   * @param {object} adapter - ChatGPTAdapter
   * @returns {Promise<Array<{base64,name,type}>>}
   */
  async function _resolveChatGPTTaskRefs(task, adapter) {
    const idsRaw = task?.ref_file_ids || '';
    const ids = (idsRaw || '').split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return { resolved: [], fids: [] };

    const maxRef = adapter?.capabilities?.maxRefImages || 4;
    // Mention mode: resolve TẤT CẢ refs (no pre-cap) vì filter @mention per-prompt sẽ tự bound dưới maxRef.
    // Sequential mode: resolve TẤT CẢ refs (mỗi prompt chỉ dùng 1 ref → per-prompt luôn < maxRef,
    // tổng refs có thể > maxRef nhưng OK). [Fix Tasks sequential 2026-06-11 — đồng bộ GenTab line 3717]
    // None mode: skip resolve refs entirely. [Fix Tasks none 2026-06-11 — đồng bộ Flow GenTab line 1781]
    const isMentionMode = task?.ref_image_mode === 'mention';
    const isSequentialMode = task?.ref_image_mode === 'sequential';
    const isNoneMode = task?.ref_image_mode === 'none';
    const idsToResolve = isNoneMode ? []
      : (isMentionMode || isSequentialMode) ? ids
      : ids.slice(0, maxRef);
    if (!isMentionMode && !isSequentialMode && !isNoneMode && ids.length > maxRef) {
      console.warn(`[executeTaskViaChatGPT] Vượt giới hạn ref ${maxRef} — chỉ gửi ${maxRef} ảnh đầu`);
    }

    // Lấy thumbnail map: ref_thumbnails có thể là object map { tile_id: url }
    const thumbMap = task?.ref_thumbnails || {};
    const fnMap = task?.ref_file_names || {};

    const resolved = [];
    const fids = [];
    for (const tid of idsToResolve) {
      // Ưu tiên thumbnail từ task data, fallback GenTab.thumbnailCache
      let thumbUrl = null;
      if (typeof thumbMap === 'object' && thumbMap[tid]) {
        // ref_thumbnails có thể là string URL hoặc object {thumbnail, type, file_name}
        const entry = thumbMap[tid];
        thumbUrl = (typeof entry === 'string') ? entry : (entry?.thumbnail || null);
      }
      if (!thumbUrl && window.GenTab?.thumbnailCache?.[tid]) {
        thumbUrl = window.GenTab.thumbnailCache[tid];
      }
      const fileName = fnMap[tid] || window.GenTab?.fileNameCache?.[tid] || `${tid}.png`;
      if (!thumbUrl) {
        console.warn('[executeTaskViaChatGPT] ref skipped — không có thumbnail URL:', tid);
        continue;
      }

      try {
        const fetchResp = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'fetchBlob', url: thumbUrl }, (r) => resolve(r));
        });
        if (fetchResp?.success && fetchResp.base64) {
          const m = fetchResp.base64.match(/^data:(.+?);base64,(.+)$/);
          if (m) {
            resolved.push({ base64: m[2], name: fileName, type: m[1] });
          } else {
            resolved.push({ base64: fetchResp.base64, name: fileName, type: 'image/png' });
          }
          fids.push(tid);
        }
      } catch (err) {
        console.warn('[executeTaskViaChatGPT] fetch ref blob error:', tid, err.message);
      }
    }
    return { resolved, fids };
  }

  async function _executeTaskViaChatGPT(task, ctx = {}) {
    const { signalSubmitted } = ctx;
    if (!window.ProviderRegistry) {
      throw new Error('ProviderRegistry not loaded');
    }
    const adapter = window.ProviderRegistry.get('chatgpt');
    if (!adapter) {
      throw new Error('ChatGPT adapter not available');
    }

    // CRITICAL — Update task.status='running' để TaskList card hiện running UI (giống Flow path).
    if (window.storageManager) {
      try { await window.storageManager.updateTaskStatus(task.task_id, 'running'); } catch (_) { globalThis.SEOSONA_swallow?.('app#_executeTaskViaChatGPT', _); }
    }
    if (window.eventBus) {
      window.eventBus.emit('task:status_changed', { taskId: task.task_id, status: 'running' });
    }

    // 1. Đảm bảo session sẵn sàng (tab + login + composer ready).
    const ready = await adapter.ensureReady();
    if (!ready || !ready.ready) {
      // Phát event để app.js dialog "Cần đăng nhập ChatGPT" bắt
      if (ready?.error === 'NOT_LOGGED_IN') {
        window.eventBus?.emit('chatgpt:login_required');
      }
      throw new Error(ready?.error || 'CHATGPT_NOT_READY');
    }

    // 2. Multi-prompt support: tách prompts giống Flow path.
    const prompts = (task.multi_prompt && task.prompts && task.prompts.length > 1)
      ? task.prompts
      : [task.prompt];
    const promptCount = prompts.length;

    // 3. ExecutionGate: SKIP nội bộ — task:run handler đã request 'task_run' token (outer gate).
    // Trước fix: request thêm 'chatgpt_run' ở đây gây DOUBLE QUOTA → backend có thể fail →
    // fallback client deny → throw → task completed instantly.
    // Outer task_run đã cover quota check; feature gate `chatgpt_enabled` đã verify permission.
    let gate = null;

    // 4. Submit tuần tự từng prompt (ChatGPT chỉ có 1 editor / tab).
    const results = [];
    let successCount = 0;
    let failedCount = 0;
    // Bug fix: collectedIds/collectedThumbs PHẢI declare NGOÀI try block để finalize logic
    // (Tier 1/1.5/2) truy cập được. Trước fix block-scoped const trong try → ReferenceError
    // "collectedIds is not defined" trong finalize → result_thumbnails không persist.
    const collectedIds = [];
    const collectedThumbs = {};
    let thumbCounter = 0;
    try {
      // Báo signal submitted ngay sau khi qua quota check (UI unlock)
      try { signalSubmitted?.(); } catch (_) { globalThis.SEOSONA_swallow?.('app#_executeTaskViaChatGPT', _); }

      // Fix 10: Resolve task ref_file_ids → base64 (port logic từ GenTab._submitViaChatGPT)
      const { resolved: refImagesResolved, fids: refResolvedFids } = await _resolveChatGPTTaskRefs(task, adapter);

      // Mention mode: pre-build map slug → fid để filter refs per-prompt
      const taskIsMentionMode = task?.ref_image_mode === 'mention';
      // [Fix Tasks sequential 2026-06-11] đồng bộ GenTab line 3717.
      const taskIsSequentialMode = task?.ref_image_mode === 'sequential';
      const taskMaxRef = adapter?.capabilities?.maxRefImages || 4;
      let taskMentionNameToFid = null;
      if (taskIsMentionMode) {
        const slugMap = task?.ref_image_names || {};
        taskMentionNameToFid = {};
        for (const fid of refResolvedFids) {
          const slug = slugMap[fid];
          if (slug) taskMentionNameToFid[String(slug).toLowerCase()] = fid;
        }
      }

      // Fix 7: Auto-download settings cho task path
      const taskAutoDownload = !!(task.auto_download) && !!(window.featureGate?.canUse?.('auto_download'));

      // Delete after gen setting — đọc từ task config (saved by TaskModal)
      const deleteAfterGen = !!task.chatgpt_delete_after_gen;

      // Single source of truth qua DownloadHelper.getSettings() — tránh bug mismatch key
      // (fileNameTemplate vs legacy `downloadTemplate`). Fix 2026-05-22.
      const _cgTaskDl = await window.DownloadHelper.getSettings();
      const _cgTaskDownloadFolder = _cgTaskDl.folder;
      const _cgTaskDownloadTemplate = _cgTaskDl.template;

      // Đọc af_settings cho chatgptFallbackPrefix — Adapter Option B ưu tiên explicit prefix,
      // nếu undefined → adapter tự đọc storage qua `_getFallbackPrefix()`. Pass-through tránh
      // adapter mỗi prompt phải re-read storage. Bug fix: trước đây dùng `_cgTaskSettings`
      // chưa declared → ReferenceError "is not defined" khi run ChatGPT task.
      const _cgTaskSettings = await new Promise(resolve =>
        chrome.storage.local.get(['af_settings'], r => resolve(r.af_settings || {}))
      );

      // collectedIds/collectedThumbs/thumbCounter — đã declare NGOÀI try block để finalize
      // (Tier 1/1.5/2) truy cập được. Loop dưới push synthetic ID 'cg_{timestamp}_{idx}'.

      for (let i = 0; i < prompts.length; i++) {
        if (window._taskShouldStop || window._taskBatchStopped) {
          console.log('[executeTaskViaChatGPT] Stopped by user');
          break;
        }
        const prompt = prompts[i];

        // Mention mode: filter refs theo @mention trong prompt hiện tại + cap maxRef.
        // Sequential mode: prompt[i] dùng ref[i % refs.length] (cycle nếu prompts > refs).
        // [Fix Tasks sequential 2026-06-11] đồng bộ GenTab line 3866-3886.
        let refsForThisPrompt = refImagesResolved;
        if (taskIsMentionMode && taskMentionNameToFid) {
          const mentions = prompt.match(/@([\p{L}\p{N}_]+)/gu) || [];
          const matchedFids = new Set();
          for (const m of mentions) {
            const name = m.substring(1).toLowerCase();
            const fid = taskMentionNameToFid[name];
            if (fid) matchedFids.add(fid);
          }
          refsForThisPrompt = refImagesResolved.filter((_, idx) => matchedFids.has(refResolvedFids[idx]));
          if (refsForThisPrompt.length > taskMaxRef) {
            console.warn(`[executeTaskViaChatGPT] prompt ${i + 1}: ${refsForThisPrompt.length} mention vượt cap ${taskMaxRef} — chỉ gửi ${taskMaxRef} đầu`);
            refsForThisPrompt = refsForThisPrompt.slice(0, taskMaxRef);
          }
        } else if (taskIsSequentialMode && refImagesResolved.length > 0) {
          // Sequential: prompt[i] dùng ref[i % refs.length] (cycle).
          // Vd 3 refs + 5 prompts → prompt 1=ref1, 2=ref2, 3=ref3, 4=ref1, 5=ref2.
          const refIdx = i % refImagesResolved.length;
          refsForThisPrompt = [refImagesResolved[refIdx]];
          console.log(`[executeTaskViaChatGPT] sequential: prompt ${i + 1}/${prompts.length} → ref index ${refIdx} (cycle modulo)`);
        }

        try {
          const result = await adapter.submit({
            prompt,
            // Fix 10: pass resolved refs (base64 objects)
            refFileIds: refsForThisPrompt,
            settings: {
              ratio: task.ratio || 'story',
              model: task.model || _cgTaskSettings.chatgptModel || null, // Instant | Thinking (GPT-5.5)
              // Đồng bộ với GenTab pattern: truyền explicit fallbackPrefix từ user settings.
              // ChatGPTAdapter Option B sẽ ưu tiên giá trị này; nếu undefined → tự đọc storage qua _getFallbackPrefix().
              fallbackPrefix: _cgTaskSettings.chatgptFallbackPrefix || 'Generate an image of: ',
            },
            taskName: task.task_name || null,
          });
          if (result && result.success) {
            successCount++;
            // Bug 2 fix: expose live successCount để ExecutionTracker._handleStop
            // có thể `complete('partial', { successful_count })` chính xác khi user stop.
            window._currentTaskSuccessCount = successCount;
            if (Array.isArray(result.imageUrls)) {
              results.push(...result.imageUrls);
              // Capture each URL với synthetic ID để TaskList/TaskModal render thumbnails.
              const _ts = Date.now();
              for (const url of result.imageUrls) {
                if (!url) continue;
                const synthId = `cg_${_ts}_${thumbCounter++}`;
                collectedIds.push(synthId);
                collectedThumbs[synthId] = {
                  thumbnail: url,
                  type: 'image',
                  file_name: '',
                };
              }
            }

            // Fix 7: Auto-download cho task path — fetch CDN URL → blob → chrome.downloads
            if (taskAutoDownload && result.tabId && Array.isArray(result.imageUrls)) {
              for (let urlIdx = 0; urlIdx < result.imageUrls.length; urlIdx++) {
                const url = result.imageUrls[urlIdx];
                try {
                  const fetchResp = await window.MessageBridge?.chatGPTFetchImage?.(url, result.tabId);
                  if (fetchResp?.success && fetchResp.base64) {
                    const blob = await (await fetch(fetchResp.base64)).blob();
                    const blobUrl = URL.createObjectURL(blob);
                    // Tái dùng GenTab helper — pass downloadFolder + downloadTemplate từ user settings.
                    const filename = window.GenTab?._buildChatGPTFilename?.(
                      _cgTaskDownloadTemplate,
                      window._currentProjectName || 'flow',
                      prompt,
                      i + 1,
                      urlIdx + 1,
                      '',
                      task.task_name,
                      _cgTaskDownloadFolder // ← root folder từ user settings
                    ) || `${_cgTaskDownloadFolder}/${task.task_name}/chatgpt_${Date.now()}.png`;
                    const _dlUrl = await (window.scrubbedDownloadUrl?.(blobUrl) ?? blobUrl);
                    await new Promise((resolve) => {
                      chrome.runtime.sendMessage(
                        { action: 'chromeDownload', url: _dlUrl, filename, waitForComplete: deleteAfterGen },
                        () => resolve()
                      );
                    });
                    setTimeout(() => URL.revokeObjectURL(blobUrl), deleteAfterGen ? 5000 : 30000);
                  }
                } catch (dlErr) {
                  console.warn('[executeTaskViaChatGPT] auto-download error:', dlErr);
                }
              }
            }

            // Delete after gen: xóa tin nhắn khỏi ChatGPT sau khi download xong
            if (deleteAfterGen && window.ChatGPTSession) {
              try {
                const deleteResp = await window.ChatGPTSession.deleteLastMessage();
                if (deleteResp?.success) {
                  console.log('[executeTaskViaChatGPT] deleteAfterGen: deleted message');
                } else {
                  console.warn('[executeTaskViaChatGPT] deleteAfterGen failed:', deleteResp?.error);
                }
              } catch (delErr) {
                console.warn('[executeTaskViaChatGPT] deleteAfterGen error:', delErr.message);
              }
            }

            // Incremental persist: lưu results ngay sau mỗi prompt thành công
            // Giúp bảo toàn kết quả khi user stop giữa chừng
            if (collectedIds.length > 0 && window.storageManager) {
              try {
                const partialTask = await window.storageManager.getTask(task.task_id);
                if (partialTask) {
                  const existingIds = (partialTask.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
                  const mergedIds = [...new Set([...existingIds, ...collectedIds])];
                  partialTask.result_file_ids = mergedIds.join(', ');
                  partialTask.result_thumbnails = { ...(partialTask.result_thumbnails || {}), ...collectedThumbs };
                  await window.storageManager.saveTask(partialTask);
                  console.log('[executeTaskViaChatGPT] Incremental save:', collectedIds.length, 'results');
                }
              } catch (partialErr) {
                console.warn('[executeTaskViaChatGPT] Incremental save failed:', partialErr.message);
              }
            }
          } else {
            failedCount++;
            console.warn('[executeTaskViaChatGPT] Submit failed:', result?.error, result?.message);

            // LIMIT_ALERT: ChatGPT free plan đã hết quota → break loop, cảnh báo user
            if (result?.error === 'LIMIT_ALERT') {
              console.warn('[executeTaskViaChatGPT] LIMIT_ALERT — dừng task');
              failedCount += (prompts.length - i - 1);  // các prompt còn lại đều fail
              if (window.customDialog?.alert) {
                const msg = result.message
                  || "ChatGPT đã hết lượt tạo ảnh trên gói Free. Vui lòng nâng cấp ChatGPT Plus hoặc thử lại sau.";
                window.customDialog.alert(msg, {
                  title: 'ChatGPT — Hết lượt tạo ảnh',
                  type: 'warning',
                });
              }
              break;
            }
          }
        } catch (e) {
          failedCount++;
          console.error('[executeTaskViaChatGPT] Submit exception:', e?.message || e);
        }
        // Anti rate-limit: nghỉ 2s giữa các prompts (chỉ khi còn prompt tiếp theo).
        if (i < prompts.length - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      // 5. ExecutionGate complete: success nếu có ít nhất 1 prompt thành công.
      if (gate && gate.token && window.ExecutionGate) {
        await window.ExecutionGate.complete(gate.token, successCount > 0 ? 'success' : 'failed');
      }
    } catch (err) {
      if (gate && gate.token && window.ExecutionGate) {
        try { await window.ExecutionGate.complete(gate.token, 'failed'); } catch (_) { globalThis.SEOSONA_swallow?.('app#_executeTaskViaChatGPT', _); }
      }
      // Update task status → failed (cho TaskList UI)
      if (window.storageManager) {
        try { await window.storageManager.updateTaskStatus(task.task_id, 'failed'); } catch (_) { globalThis.SEOSONA_swallow?.('app#_executeTaskViaChatGPT', _); }
      }
      if (window.eventBus) {
        window.eventBus.emit('task:status_changed', { taskId: task.task_id, status: 'failed' });
      }
      throw err;
    }

    // ATOMIC persist — combine result_thumbnails + status vào 1 saveTask để tránh
    // race condition. Stopped path → status='pending' để task có thể run lại.
    const wasStopped = window._taskShouldStop || window._taskBatchStopped;
    const finalStatus = wasStopped
      ? 'pending'
      : (successCount > 0 ? 'completed' : 'failed');

    if (window.storageManager) {
      let persisted = false;
      try {
        const freshTask = await window.storageManager.getTask(task.task_id);
        if (freshTask) {
          if (collectedIds.length > 0) {
            // Merge results for multi-prompt tasks — dùng Set để deduplicate (incremental save đã lưu trước đó)
            const existingIds = (freshTask.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
            const mergedIds = [...new Set([...existingIds, ...collectedIds])];
            freshTask.result_file_ids = mergedIds.join(', ');
            freshTask.result_thumbnails = { ...(freshTask.result_thumbnails || {}), ...collectedThumbs };
          }
          freshTask.status = finalStatus;
          if (finalStatus === 'completed' || finalStatus === 'failed') {
            freshTask.executed_at = Date.now();
          }
          await window.storageManager.saveTask(freshTask);
          task.result_file_ids = freshTask.result_file_ids;
          task.result_thumbnails = freshTask.result_thumbnails;
          task.status = freshTask.status;
          persisted = true;
        }
      } catch (e) {
        console.warn('[executeTaskViaChatGPT] Persist final task failed:', e.message);
      }

      // Bug fix: nếu getTask/saveTask fail, dùng 3-tier fallback để persist result data + status.
      // Tier 1.5: saveTask với cleaned payload — strip Grok fields có thể chưa migrate (defensive).
      // Tier 2: PATCH với result data — cần backend TaskController fix.
      // Tier 3: PATCH chỉ status — đảm bảo UI clear running.
      if (!persisted) {
        const mergedResultIds = collectedIds.length > 0
          ? [...((task.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean)), ...collectedIds].join(', ')
          : (task.result_file_ids || '');
        const mergedThumbs = collectedIds.length > 0
          ? { ...(task.result_thumbnails || {}), ...collectedThumbs }
          : (task.result_thumbnails || null);

        // Tier 1.5: saveTask với cleaned payload
        try {
          const freshTaskRetry = await window.storageManager.getTask(task.task_id);
          if (freshTaskRetry) {
            const cleanedTask = { ...freshTaskRetry };
            delete cleanedTask.grok_mode;
            delete cleanedTask.grok_duration;
            delete cleanedTask.grok_resolution;
            delete cleanedTask.grok_image_quality;
            cleanedTask.result_file_ids = mergedResultIds;
            cleanedTask.result_thumbnails = mergedThumbs;
            cleanedTask.status = finalStatus;
            cleanedTask.executed_at = Date.now();
            await window.storageManager.saveTask(cleanedTask);
            task.result_file_ids = mergedResultIds;
            task.result_thumbnails = mergedThumbs;
            task.status = finalStatus;
            persisted = true;
            console.log('[executeTaskViaChatGPT] Tier 1.5 saveTask cleaned OK');
          }
        } catch (e) {
          console.warn('[executeTaskViaChatGPT] Tier 1.5 saveTask cleaned failed:', e.message);
        }

        // Tier 2: PATCH với result data
        if (!persisted) {
          try {
            await window.storageManager.updateTaskStatus(task.task_id, finalStatus, mergedResultIds, {
              result_thumbnails: mergedThumbs,
              executed_at: new Date().toISOString(),
            });
            task.status = finalStatus;
            if (collectedIds.length > 0) {
              task.result_file_ids = mergedResultIds;
              task.result_thumbnails = mergedThumbs;
            }
            persisted = true;
          } catch (e) {
            console.warn('[executeTaskViaChatGPT] Tier 2 PATCH với result data failed:', e.message);
          }
        }

        // Tier 3: Last resort - status only
        if (!persisted) {
          try {
            await window.storageManager.updateTaskStatus(task.task_id, finalStatus);
            task.status = finalStatus;
            console.warn('[executeTaskViaChatGPT] Tier 3 status-only OK (result data lost)');
          } catch (e) {
            console.error('[executeTaskViaChatGPT] Tier 3 updateTaskStatus failed:', e.message);
            task.status = finalStatus;
          }
        }
      }
    }

    if (window.eventBus) {
      window.eventBus.emit('task:status_changed', {
        taskId: task.task_id,
        taskName: task.task_name,
        mediaType: task.media_type,
        status: finalStatus,
        prompt: task.prompt || '',
        media_type: task.media_type || 'image',
        model: '',
        ratio: task.ratio || '',
        // Phase Analytics-3: ChatGPT task — N prompt (multi_prompt) × 1 ảnh/prompt
        prompt_count: (task.multi_prompt && task.prompts?.length) ? task.prompts.length : 1,
        quantity: 1,
        ref_file_ids: task.ref_file_ids || '',
        result_file_ids: task.result_file_ids || '',
        result_thumbnails: task.result_thumbnails ? Object.values(task.result_thumbnails) : [],
        result_file_names: {},
        task_id: task.task_id,
        provider: 'chatgpt', // SS-Phase G: _executeTaskViaChatGPT path
        project_id: task.project_id || null,
        auto_download: !!task.auto_download
      });
      if (finalStatus === 'completed') {
        window.eventBus.emit('task:complete', {
          taskId: task.task_id,
          taskName: task.task_name,
          resultCount: collectedIds.length
        });
      }
    }

    return { success: successCount, failed: failedCount, results, stopped: wasStopped };
  }

  /**
   * G-5.9: Resolve task ref images cho Grok task path.
   * Mirror `_resolveChatGPTTaskRefs` nhưng dùng GrokAdapter capabilities (maxRefImages=4).
   *
   * - Input: `task.ref_file_ids` (comma-separated tile IDs Flow), `task.ref_thumbnails`
   *   (object map, có thể là string URL hoặc {thumbnail, type, file_name}).
   * - Cap maxRefImages (default 4 cho Grok)
   * - Fetch URL → base64 qua background.js (bypass CORS)
   *
   * @param {object} task
   * @param {object} adapter - GrokAdapter
   * @returns {Promise<Array<{base64,name,type}>>}
   */
  async function _resolveGrokTaskRefs(task, adapter) {
    const idsRaw = task?.ref_file_ids || '';
    const ids = (idsRaw || '').split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return { resolved: [], fids: [] };

    const maxRef = adapter?.capabilities?.maxRefImages || 4;
    // Mention mode: resolve TẤT CẢ refs (no pre-cap) vì filter @mention per-prompt sẽ tự bound dưới maxRef.
    // Sequential mode: resolve TẤT CẢ refs (mỗi prompt chỉ dùng 1 ref → per-prompt luôn < maxRef).
    // [Fix Tasks sequential 2026-06-11 — đồng bộ GenTab line 3717]
    // None mode: skip resolve refs entirely. [Fix Tasks none 2026-06-11 — đồng bộ Flow GenTab line 1781]
    const isMentionMode = task?.ref_image_mode === 'mention';
    const isSequentialMode = task?.ref_image_mode === 'sequential';
    const isNoneMode = task?.ref_image_mode === 'none';
    const idsToResolve = isNoneMode ? []
      : (isMentionMode || isSequentialMode) ? ids
      : ids.slice(0, maxRef);
    if (!isMentionMode && !isSequentialMode && !isNoneMode && ids.length > maxRef) {
      console.warn(`[executeTaskViaGrok] Vượt giới hạn ref ${maxRef} — chỉ gửi ${maxRef} ảnh đầu`);
    }

    const thumbMap = task?.ref_thumbnails || {};
    const fnMap = task?.ref_file_names || {};

    const resolved = [];
    const fids = [];
    for (const tid of idsToResolve) {
      // Ưu tiên thumbnail từ task data, fallback GenTab.thumbnailCache
      let thumbUrl = null;
      if (typeof thumbMap === 'object' && thumbMap[tid]) {
        const entry = thumbMap[tid];
        thumbUrl = (typeof entry === 'string') ? entry : (entry?.thumbnail || null);
      }
      if (!thumbUrl && window.GenTab?.thumbnailCache?.[tid]) {
        thumbUrl = window.GenTab.thumbnailCache[tid];
      }
      const fileName = fnMap[tid] || window.GenTab?.fileNameCache?.[tid] || `${tid}.png`;
      if (!thumbUrl) {
        console.warn('[executeTaskViaGrok] ref skipped — không có thumbnail URL:', tid);
        continue;
      }

      try {
        const fetchResp = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'fetchBlob', url: thumbUrl }, (r) => resolve(r));
        });
        if (fetchResp?.success && fetchResp.base64) {
          const m = fetchResp.base64.match(/^data:(.+?);base64,(.+)$/);
          if (m) {
            resolved.push({ base64: m[2], name: fileName, type: m[1] });
          } else {
            resolved.push({ base64: fetchResp.base64, name: fileName, type: 'image/png' });
          }
          fids.push(tid);
        }
      } catch (err) {
        console.warn('[executeTaskViaGrok] fetch ref blob error:', tid, err.message);
      }
    }
    return { resolved, fids };
  }

  /**
   * G-5.9: Execute task via Grok provider (mirror _executeTaskViaChatGPT).
   *
   * Pipeline mode: ChatGPT/Grok tasks BYPASS PromptQueue (Pipeline path Flow-only).
   * Note rõ trong comment để future devs không nhầm — nếu cần Pipeline support cho
   * Grok, tách Phase G-9 (low priority — Grok sequential tự nhiên rồi, không hưởng
   * lợi từ Pipeline).
   *
   * @param {object} task
   * @param {object} ctx - { signalSubmitted }
   * @returns {Promise<{success, failed, results}>}
   */
  async function _executeTaskViaGrok(task, ctx = {}) {
    const { signalSubmitted } = ctx;
    if (!window.ProviderRegistry) {
      throw new Error('ProviderRegistry not loaded');
    }
    const adapter = window.ProviderRegistry.get('grok');
    if (!adapter) {
      throw new Error('GROK_ADAPTER_NOT_LOADED');
    }

    // CRITICAL — Update task.status='running' để TaskList card hiện running UI (giống Flow path).
    // Trước fix: chỉ Flow path update status (line 3145+), ChatGPT/Grok bypass → card không hiện.
    if (window.storageManager) {
      try { await window.storageManager.updateTaskStatus(task.task_id, 'running'); } catch (_) { globalThis.SEOSONA_swallow?.('app#_executeTaskViaGrok', _); }
    }
    if (window.eventBus) {
      window.eventBus.emit('task:status_changed', { taskId: task.task_id, status: 'running' });
    }

    // 1. Đảm bảo session sẵn sàng (tab + login + content script ready).
    const ready = await adapter.ensureReady();
    if (!ready || !ready.ready) {
      // Phát event để app.js dialog "Cần đăng nhập Grok" bắt
      if (ready?.error === 'NOT_LOGGED_IN') {
        window.eventBus?.emit('grok:login_required');
      }
      throw new Error(ready?.error || 'GROK_NOT_READY');
    }

    // 2. Multi-prompt support: tách prompts giống Flow path.
    const prompts = (task.multi_prompt && task.prompts && task.prompts.length > 1)
      ? task.prompts
      : [task.prompt];
    const promptCount = prompts.length;

    // 3. ExecutionGate: SKIP nội bộ — task:run handler đã request 'task_run' token (outer gate).
    // Trước fix: request thêm 'grok_run' ở đây gây DOUBLE QUOTA → backend 500 → fallback client deny
    // → throw QUOTA_EXHAUSTED → task completed instantly.
    // Outer task_run đã cover quota check; feature gate `grok_enabled` (line 2477+ caller path)
    // đã verify permission. Không cần inner gate.
    let gate = null;

    // 4. Submit tuần tự từng prompt (Grok chỉ có 1 editor / tab + redirect flow).
    const results = [];
    let successCount = 0;
    let failedCount = 0;
    // Bug fix: collectedIds/collectedThumbs PHẢI declare NGOÀI try block để finalize logic
    // (Tier 1/1.5/2 trong if (window.storageManager) block) truy cập được. Trước fix block-scoped
    // const trong try → ReferenceError "collectedIds is not defined" trong finalize → mất result data.
    const collectedIds = [];
    const collectedThumbs = {};
    let thumbCounter = 0;
    try {
      // Báo signal submitted ngay sau khi qua quota check (UI unlock)
      try { signalSubmitted?.(); } catch (_) { globalThis.SEOSONA_swallow?.('app#_executeTaskViaGrok', _); }

      // Resolve task ref_file_ids → base64 (port logic từ ChatGPT path)
      const { resolved: refImagesResolved, fids: refResolvedFids } = await _resolveGrokTaskRefs(task, adapter);

      // Mention mode: pre-build map slug → fid để filter refs per-prompt
      const taskIsMentionMode = task?.ref_image_mode === 'mention';
      // [Fix Tasks sequential 2026-06-11] đồng bộ GenTab line 3717.
      const taskIsSequentialMode = task?.ref_image_mode === 'sequential';
      const taskMaxRef = adapter?.capabilities?.maxRefImages || 4;
      let taskMentionNameToFid = null;
      if (taskIsMentionMode) {
        const slugMap = task?.ref_image_names || {};
        taskMentionNameToFid = {};
        for (const fid of refResolvedFids) {
          const slug = slugMap[fid];
          if (slug) taskMentionNameToFid[String(slug).toLowerCase()] = fid;
        }
      }

      // Auto-download settings cho task path
      const taskAutoDownload = !!(task.auto_download) && !!(window.featureGate?.canUse?.('auto_download'));

      // Single source of truth qua DownloadHelper.getSettings() — tránh bug mismatch key. Fix 2026-05-22.
      const _grokTaskDl = await window.DownloadHelper.getSettings();
      const _grokTaskDownloadFolder = _grokTaskDl.folder;
      const _grokTaskDownloadTemplate = _grokTaskDl.template;

      // collectedIds/collectedThumbs/thumbCounter — đã declare NGOÀI try block (line ~2918) để
      // finalize block (Tier 1/1.5/2 phía sau) truy cập được. Loop dưới push vào.
      // Format result_thumbnails giống Flow: { tileId: { thumbnail, type, file_name } }.

      // Watchdog: poll _taskShouldStop mỗi 500ms, gửi grok:abort tới content script khi detect.
      // adapter.submit có thể block lâu (gen video 5 phút) → cần signal abort qua message.
      let _grokWatchdogTimer = null;
      const _startWatchdog = (tabIdToAbort) => {
        if (_grokWatchdogTimer) return;
        _grokWatchdogTimer = setInterval(() => {
          if (window._taskShouldStop || window._taskBatchStopped) {
            console.log('[executeTaskViaGrok] Stop detected → abort content script');
            if (tabIdToAbort && window.MessageBridge?.grokAbort) {
              window.MessageBridge.grokAbort(tabIdToAbort).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#_stopWatchdog', _e); });
            }
            clearInterval(_grokWatchdogTimer);
            _grokWatchdogTimer = null;
          }
        }, 500);
      };
      const _stopWatchdog = () => {
        if (_grokWatchdogTimer) {
          clearInterval(_grokWatchdogTimer);
          _grokWatchdogTimer = null;
        }
      };

      // Get tabId early để watchdog có sẵn target ngay.
      const _grokTabInfo = await window.GrokSession?.getTabInfo?.();
      const _grokTabId = _grokTabInfo?.tabId;

      for (let i = 0; i < prompts.length; i++) {
        if (window._taskShouldStop || window._taskBatchStopped) {
          console.log('[executeTaskViaGrok] Stopped by user');
          break;
        }
        const prompt = prompts[i];

        // Mention mode: filter refs theo @mention trong prompt hiện tại + cap maxRef.
        // Sequential mode: prompt[i] dùng ref[i % refs.length] (cycle nếu prompts > refs).
        // [Fix Tasks sequential 2026-06-11] đồng bộ GenTab line 3866-3886.
        let refsForThisPrompt = refImagesResolved;
        if (taskIsMentionMode && taskMentionNameToFid) {
          const mentions = prompt.match(/@([\p{L}\p{N}_]+)/gu) || [];
          const matchedFids = new Set();
          for (const m of mentions) {
            const name = m.substring(1).toLowerCase();
            const fid = taskMentionNameToFid[name];
            if (fid) matchedFids.add(fid);
          }
          refsForThisPrompt = refImagesResolved.filter((_, idx) => matchedFids.has(refResolvedFids[idx]));
          if (refsForThisPrompt.length > taskMaxRef) {
            console.warn(`[executeTaskViaGrok] prompt ${i + 1}: ${refsForThisPrompt.length} mention vượt cap ${taskMaxRef} — chỉ gửi ${taskMaxRef} đầu`);
            refsForThisPrompt = refsForThisPrompt.slice(0, taskMaxRef);
          }
        } else if (taskIsSequentialMode && refImagesResolved.length > 0) {
          // Sequential: prompt[i] dùng ref[i % refs.length] (cycle).
          // Vd 3 refs + 5 prompts → prompt 1=ref1, 2=ref2, 3=ref3, 4=ref1, 5=ref2.
          const refIdx = i % refImagesResolved.length;
          refsForThisPrompt = [refImagesResolved[refIdx]];
          console.log(`[executeTaskViaGrok] sequential: prompt ${i + 1}/${prompts.length} → ref index ${refIdx} (cycle modulo)`);
        }

        _startWatchdog(_grokTabId);
        try {
          const result = await adapter.submit({
            prompt,
            refFileIds: refsForThisPrompt,
            settings: {
              mode: task.grok_mode || 'image',
              ratio: task.ratio || 'widescreen',
              quantity: task.quantity || 1,
              duration: task.grok_duration || '6s',
              resolution: task.grok_resolution || '720p',
              imageQuality: task.grok_image_quality || 'speed',
              timeout: 180000,
            },
            taskName: task.task_name || null,
          });
          _stopWatchdog();
          // Abort path — adapter.submit return với error='ABORTED' khi user click stop.
          if (result?.error === 'ABORTED') {
            console.log('[executeTaskViaGrok] Adapter returned ABORTED → break loop');
            break;
          }
          if (result && result.success) {
            successCount++;
            // Bug 2 fix: expose live successCount để ExecutionTracker._handleStop
            // có thể `complete('partial', { successful_count })` chính xác khi user stop.
            window._currentTaskSuccessCount = successCount;
            if (Array.isArray(result.mediaUrls)) {
              results.push(...result.mediaUrls);
              // Capture each URL với synthetic ID để TaskList/TaskModal render thumbnails.
              // Grok có thể trả video → set type='video' để TaskList render <video> tag.
              const _ts = Date.now();
              const isVideo = result.mediaType === 'video' || (task.grok_mode === 'video');
              for (const url of result.mediaUrls) {
                if (!url) continue;
                const synthId = `grok_${_ts}_${thumbCounter++}`;
                collectedIds.push(synthId);
                collectedThumbs[synthId] = {
                  thumbnail: url,
                  type: isVideo ? 'video' : 'image',
                  file_name: '',
                };
              }
            }

            // Auto-download cho task path — ưu tiên fetchedMedia (Option C 2026-06-03 pre-fetched
            // trong content script, tránh race redirect /saved). Fallback grokFetchImage cho
            // backward-compat nếu handler cũ không trả fetchedMedia.
            if (taskAutoDownload && Array.isArray(result.mediaUrls)) {
              for (let urlIdx = 0; urlIdx < result.mediaUrls.length; urlIdx++) {
                // Bug fix: check stop flag trước mỗi download → break sớm khi user click Stop
                if (window._taskShouldStop || window._taskBatchStopped) {
                  console.log('[executeTaskViaGrok] Stop detected during auto-download → break');
                  break;
                }
                const url = result.mediaUrls[urlIdx];
                try {
                  // Determine extension: video MP4, else PNG. Filename build TRƯỚC (dùng chung mọi tier).
                  const isVideo = result.mediaType === 'video' || (task.grok_mode === 'video');
                  const ext = isVideo ? 'mp4' : 'png';
                  let filename = window.GenTab?._buildChatGPTFilename?.(
                    _grokTaskDownloadTemplate,
                    window._currentProjectName || 'flow',
                    prompt,
                    i + 1,
                    urlIdx + 1,
                    '',
                    task.task_name,
                    _grokTaskDownloadFolder // ← root folder từ user settings
                  ) || `${_grokTaskDownloadFolder}/${task.task_name || 'grok'}/grok_${Date.now()}.${ext}`;
                  if (isVideo && filename.endsWith('.png')) {
                    filename = filename.replace(/\.png$/i, '.mp4');
                  }
                  // 3-tier download (helper chung): Tier 1 prefetch → Tier 2 grokFetchImage → Tier 3 direct URL.
                  const _pre = result.fetchedMedia?.find(f => f.url === url)?.base64 || null;
                  const dl = (await window.MessageBridge?.grokDownloadMedia?.(url, result.tabId, filename, _pre))
                    || { success: false, tier: 0, error: 'MessageBridge unavailable' };
                  if (!dl.success) console.warn(`[executeTaskViaGrok] download fail (Tier ${dl.tier}): ${dl.error || 'unknown'} | URL: ${(url || '').substring(0, 80)}`);
                } catch (dlErr) {
                  console.warn('[executeTaskViaGrok] auto-download error:', dlErr);
                }
              }
            }

            // Incremental persist: lưu results ngay sau mỗi prompt thành công
            // Giúp bảo toàn kết quả khi user stop giữa chừng
            if (collectedIds.length > 0 && window.storageManager) {
              try {
                const partialTask = await window.storageManager.getTask(task.task_id);
                if (partialTask) {
                  const existingIds = (partialTask.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
                  const mergedIds = [...new Set([...existingIds, ...collectedIds])];
                  partialTask.result_file_ids = mergedIds.join(', ');
                  partialTask.result_thumbnails = { ...(partialTask.result_thumbnails || {}), ...collectedThumbs };
                  await window.storageManager.saveTask(partialTask);
                  console.log('[executeTaskViaGrok] Incremental save:', collectedIds.length, 'results');
                }
              } catch (partialErr) {
                console.warn('[executeTaskViaGrok] Incremental save failed:', partialErr.message);
              }
            }
          } else {
            failedCount++;
            console.warn('[executeTaskViaGrok] Submit failed:', result?.error, result?.message);

            // LIMIT_ALERT: Grok đã hết quota → break loop, cảnh báo user
            if (result?.error === 'LIMIT_ALERT' || result?.error === 'RATE_LIMIT') {
              console.warn('[executeTaskViaGrok] LIMIT_ALERT — dừng task');
              failedCount += (prompts.length - i - 1);
              if (window.customDialog?.alert) {
                const msg = result.message
                  || 'Grok đã hết lượt tạo. Vui lòng thử lại sau hoặc nâng cấp gói.';
                window.customDialog.alert(msg, {
                  title: 'Grok — Hết lượt tạo',
                  type: 'warning',
                });
              }
              break;
            }
          }
        } catch (e) {
          _stopWatchdog();
          failedCount++;
          console.error('[executeTaskViaGrok] Submit exception:', e?.message || e);
        }
        // Anti rate-limit: nghỉ 2s giữa các prompts (chỉ khi còn prompt tiếp theo).
        if (i < prompts.length - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      // Cleanup watchdog (nếu chưa cleared trong loop).
      _stopWatchdog();

      // 5. ExecutionGate complete: success nếu có ít nhất 1 prompt thành công.
      if (gate && gate.token && window.ExecutionGate) {
        await window.ExecutionGate.complete(gate.token, successCount > 0 ? 'success' : 'failed');
      }
    } catch (err) {
      _stopWatchdog();
      if (gate && gate.token && window.ExecutionGate) {
        try { await window.ExecutionGate.complete(gate.token, 'failed'); } catch (_) { globalThis.SEOSONA_swallow?.('app#_stopWatchdog', _); }
      }
      // Update task status → failed (cho TaskList UI)
      if (window.storageManager) {
        try { await window.storageManager.updateTaskStatus(task.task_id, 'failed'); } catch (_) { globalThis.SEOSONA_swallow?.('app#_stopWatchdog', _); }
      }
      if (window.eventBus) {
        window.eventBus.emit('task:status_changed', { taskId: task.task_id, status: 'failed' });
      }
      throw err;
    }

    // ATOMIC persist — combine result_thumbnails + status vào 1 saveTask để tránh
    // race condition (TaskList loadTasks giữa 2 saveTask thấy status='running' với
    // result_thumbnails đã có nhưng card không render thumb vì check status==='completed').
    // Stopped path → status='pending' để task có thể run lại.
    const wasStopped = window._taskShouldStop || window._taskBatchStopped;
    const finalStatus = wasStopped
      ? 'pending'
      : (successCount > 0 ? 'completed' : 'failed');

    if (window.storageManager) {
      let persisted = false;
      try {
        const freshTask = await window.storageManager.getTask(task.task_id);
        if (freshTask) {
          // Merge result thumbnails (nếu có)
          if (collectedIds.length > 0) {
            // Merge results for multi-prompt tasks — dùng Set để deduplicate (incremental save đã lưu trước đó)
            const existingIds = (freshTask.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
            const mergedIds = [...new Set([...existingIds, ...collectedIds])];
            freshTask.result_file_ids = mergedIds.join(', ');
            freshTask.result_thumbnails = { ...(freshTask.result_thumbnails || {}), ...collectedThumbs };
          }
          // Set status + executed_at trong CÙNG saveTask
          freshTask.status = finalStatus;
          if (finalStatus === 'completed' || finalStatus === 'failed') {
            freshTask.executed_at = Date.now();
          }
          await window.storageManager.saveTask(freshTask);
          // Update local reference cho event payload.
          task.result_file_ids = freshTask.result_file_ids;
          task.result_thumbnails = freshTask.result_thumbnails;
          task.status = freshTask.status;
          persisted = true;
        }
      } catch (e) {
        console.warn('[executeTaskViaGrok] Persist final task failed:', e.message);
      }

      // Bug fix: nếu getTask/saveTask fail (race condition / API timeout / SQL schema mismatch),
      // vẫn PHẢI update status + result data để UI clear "running" + tab Result hiện thumbnails.
      //
      // Tier 1.5 (NEW): Retry saveTask với CLEANED payload — loại Grok-specific fields có thể
      //   gây SQL error nếu user's backend chưa migrate (grok_mode, grok_duration, etc.).
      //   UpdateTaskRequest validation có sẵn rule cho result_thumbnails từ lâu → PUT path
      //   đáng tin cậy hơn PATCH (PATCH endpoint mới được fix gần đây, có thể user chưa deploy).
      //
      // Tier 2: PATCH /tasks/{id}/status với result data — chỉ work nếu backend đã có fix
      //   thêm result_thumbnails vào $request->only() trong TaskController.updateStatus.
      //
      // Tier 3: PATCH chỉ status — đảm bảo UI clear "running" badge dù backend reject result.
      if (!persisted) {
        const mergedResultIds = collectedIds.length > 0
          ? [...((task.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean)), ...collectedIds].join(', ')
          : (task.result_file_ids || '');
        const mergedThumbs = collectedIds.length > 0
          ? { ...(task.result_thumbnails || {}), ...collectedThumbs }
          : (task.result_thumbnails || null);

        // Tier 1.5: saveTask với cleaned payload (strip Grok config fields có thể chưa migrate)
        try {
          const freshTaskRetry = await window.storageManager.getTask(task.task_id);
          if (freshTaskRetry) {
            const cleanedTask = { ...freshTaskRetry };
            // Strip Grok-specific fields có thể gây SQL "Unknown column" nếu backend chưa migrate
            delete cleanedTask.grok_mode;
            delete cleanedTask.grok_duration;
            delete cleanedTask.grok_resolution;
            delete cleanedTask.grok_image_quality;
            cleanedTask.result_file_ids = mergedResultIds;
            cleanedTask.result_thumbnails = mergedThumbs;
            cleanedTask.status = finalStatus;
            cleanedTask.executed_at = Date.now();
            await window.storageManager.saveTask(cleanedTask);
            task.result_file_ids = mergedResultIds;
            task.result_thumbnails = mergedThumbs;
            task.status = finalStatus;
            persisted = true;
            console.log('[executeTaskViaGrok] Tier 1.5 saveTask cleaned payload OK');
          }
        } catch (e) {
          console.warn('[executeTaskViaGrok] Tier 1.5 saveTask cleaned failed:', e.message);
        }
      }

      // Tier 2: PATCH với result data (cần backend fix mới)
      if (!persisted) {
        const mergedResultIds = collectedIds.length > 0
          ? [...((task.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean)), ...collectedIds].join(', ')
          : (task.result_file_ids || '');
        const mergedThumbs = collectedIds.length > 0
          ? { ...(task.result_thumbnails || {}), ...collectedThumbs }
          : (task.result_thumbnails || null);
        try {
          await window.storageManager.updateTaskStatus(task.task_id, finalStatus, mergedResultIds, {
            result_thumbnails: mergedThumbs,
            executed_at: new Date().toISOString(),
          });
          task.status = finalStatus;
          if (collectedIds.length > 0) {
            task.result_file_ids = mergedResultIds;
            task.result_thumbnails = mergedThumbs;
          }
          persisted = true;
        } catch (e) {
          console.warn('[executeTaskViaGrok] Tier 2 PATCH với result data failed:', e.message);
        }
      }

      // Tier 3: Last resort - PATCH chỉ với status để UI clear "running" badge.
      if (!persisted) {
        try {
          await window.storageManager.updateTaskStatus(task.task_id, finalStatus);
          task.status = finalStatus;
          console.warn('[executeTaskViaGrok] Tier 3 status-only update OK (result data lost)');
        } catch (e) {
          console.error('[executeTaskViaGrok] Tier 3 updateTaskStatus failed:', e.message);
          task.status = finalStatus;
        }
      }
    }

    if (window.eventBus) {
      window.eventBus.emit('task:status_changed', {
        taskId: task.task_id,
        taskName: task.task_name,
        mediaType: task.media_type,
        status: finalStatus,
        prompt: task.prompt || '',
        media_type: task.grok_mode === 'video' ? 'Video' : (task.media_type || 'image'),
        model: '',
        ratio: task.ratio || '',
        // Phase Analytics-3: Grok task — N prompt × Grok quantity (image: 1/2/4, video: 1)
        prompt_count: (task.multi_prompt && task.prompts?.length) ? task.prompts.length : 1,
        quantity: parseInt(task.quantity) || 1,
        ref_file_ids: task.ref_file_ids || '',
        result_file_ids: task.result_file_ids || '',
        result_thumbnails: task.result_thumbnails ? Object.values(task.result_thumbnails) : [],
        result_file_names: {},
        task_id: task.task_id,
        provider: 'grok', // SS-Phase G: _executeTaskViaGrok path
        project_id: task.project_id || null,
        auto_download: !!task.auto_download
      });
      // Emit task:complete cho NotificationManager (giống Flow path).
      if (finalStatus === 'completed') {
        window.eventBus.emit('task:complete', {
          taskId: task.task_id,
          taskName: task.task_name,
          resultCount: collectedIds.length
        });
      }
    }

    return { success: successCount, failed: failedCount, results, stopped: wasStopped };
  }

  async function executeSingleTask(task, options = {}) {
    const { isParallel = false, onSubmitted } = options;
    let submittedSignaled = false;

    // Helper: signal submitted (chỉ gọi 1 lần)
    const signalSubmitted = () => {
      if (!submittedSignaled) {
        submittedSignaled = true;
        onSubmitted?.();
      }
    };

    // Reset stop flag (chỉ reset nếu chưa bị stop từ batch)
    if (!window._taskBatchStopped) {
      window._taskShouldStop = false;
    }

    // Bug 2 fix: reset success counter cho task mới (ChatGPT/Grok inner sẽ update).
    // ExecutionTracker._handleStop đọc counter này để complete('partial') với đúng số.
    window._currentTaskSuccessCount = 0;

    // CG-6.3 + G-5.8: Provider routing — nếu task được tạo cho ChatGPT/Grok thì đi qua adapter
    // riêng, không qua Flow editor. Default 'flow' để task cũ giữ behavior cũ.
    const providerKey = task.provider || 'flow';
    if (providerKey === 'grok') {
      // G-5.10: Pipeline mode bypass — Grok tasks BYPASS PromptQueue (Pipeline Flow-only).
      // Note rõ trong _executeTaskViaGrok comment để future devs không nhầm.
      return await _executeTaskViaGrok(task, { signalSubmitted });
    }
    if (providerKey === 'chatgpt') {
      return await _executeTaskViaChatGPT(task, { signalSubmitted });
    }
    // Flow path bên dưới giữ nguyên — KHÔNG xóa logic existing.

    // Smart Clone: reconstruct ref_file_ids từ ref_file_names/ref_thumbnails khi clone cross-project
    // Clone giữ metadata (file_names + thumbnails) nhưng xóa tile_ids → cần rebuild ref_file_ids
    if (!task.ref_file_ids && task.ref_file_names && Object.keys(task.ref_file_names).length > 0) {
      const reconstructedIds = Object.keys(task.ref_file_names);
      task.ref_file_ids = reconstructedIds.join(', ');
      log('Smart Clone: reconstructed ref_file_ids from ref_file_names:', task.ref_file_ids);
    } else if (!task.ref_file_ids && task.ref_thumbnails && Object.keys(task.ref_thumbnails).length > 0) {
      const reconstructedIds = Object.keys(task.ref_thumbnails);
      task.ref_file_ids = reconstructedIds.join(', ');
      log('Smart Clone: reconstructed ref_file_ids from ref_thumbnails:', task.ref_file_ids);
    }

    // Upload pending local files trước khi chạy
    log('Task ref_file_ids BEFORE upload:', task.ref_file_ids);
    if (task.ref_file_ids && task.ref_file_ids.includes('upload_')) {
      const beforeUpload = task.ref_file_ids;
      task.ref_file_ids = await window.uploadPendingFiles(task.ref_file_ids);
      log('Task ref_file_ids AFTER upload:', beforeUpload, '->', task.ref_file_ids);
      sidebarLog(`Ref IDs sau upload: ${task.ref_file_ids}`, 'info');

      // Defensive: drop orphan upload_xxx keys nếu uploadPendingFiles không resolve được
      // (memory pendingUploadFiles lost / upload thất bại). Trước fix: orphan placeholder leak
      // vào content.js → addFileToPrompt(upload_xxx) fail silently → user thấy "thiếu 1 ref".
      if (task.ref_file_ids && task.ref_file_ids.includes('upload_')) {
        const beforeFilter = task.ref_file_ids;
        const filteredIds = beforeFilter.split(',').map(s => s.trim()).filter(id => id && !id.startsWith('upload_'));
        const droppedCount = beforeFilter.split(',').map(s => s.trim()).filter(id => id.startsWith('upload_')).length;
        task.ref_file_ids = filteredIds.join(', ');
        if (droppedCount > 0) {
          log(`Dropped ${droppedCount} orphan upload_* key(s):`, beforeFilter, '->', task.ref_file_ids);
          sidebarLog(`Cảnh báo: ${droppedCount} ảnh upload local không khôi phục được — task chạy với ${filteredIds.length} ảnh còn lại`, 'warn');
        }
      }

      // Cập nhật ref_thumbnails + ref_file_names keys: upload_xxx → real tile_id
      // BUG-T1 FIX: Thêm || '' để tránh crash khi ref_file_ids undefined/null
      if (beforeUpload !== task.ref_file_ids) {
        const oldIds = (beforeUpload || '').split(',').map(s => s.trim()).filter(Boolean);
        const newIds = (task.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);

        // Transfer thumbnails
        if (task.ref_thumbnails) {
          const updatedThumbs = {};
          for (let i = 0; i < oldIds.length; i++) {
            const oldId = oldIds[i];
            const newId = newIds[i] || oldId;
            const thumb = task.ref_thumbnails[oldId];
            if (thumb) updatedThumbs[newId] = thumb;
          }
          // Giữ lại thumbnails của IDs không thay đổi
          for (const [id, thumb] of Object.entries(task.ref_thumbnails)) {
            if (!updatedThumbs[id] && !oldIds.includes(id)) updatedThumbs[id] = thumb;
          }
          // Override bằng thumbnail MỚI từ Flow (từ MediaRegistry populated by FileUploader)
          for (const newId of newIds) {
            if (MediaRegistry.getThumb(newId)) {
              updatedThumbs[newId] = MediaRegistry.getThumb(newId);
            }
          }
          task.ref_thumbnails = updatedThumbs;
        }

        // CRITICAL: Transfer ref_file_names (UUIDs) từ MediaRegistry
        // FileUploader.uploadPendingFiles đã populate cache này với data MỚI từ tileDetails
        const updatedFileNames = { ...(task.ref_file_names || {}) };
        for (let i = 0; i < oldIds.length; i++) {
          const oldId = oldIds[i];
          const newId = newIds[i] || oldId;
          // Transfer existing file_name nếu có
          if (updatedFileNames[oldId] && oldId !== newId) {
            updatedFileNames[newId] = updatedFileNames[oldId];
            delete updatedFileNames[oldId];
          }
        }
        // Override bằng file_name MỚI từ Flow
        for (const newId of newIds) {
          if (MediaRegistry.getFileName(newId)) {
            updatedFileNames[newId] = MediaRegistry.getFileName(newId);
          }
        }
        if (Object.keys(updatedFileNames).length > 0) {
          task.ref_file_names = updatedFileNames;
        }

        // CRITICAL: Transfer ref_image_names (mention name map) — cùng logic với ref_file_names
        // Nếu không transfer, mention resolve sẽ fail cho IDs đã thay đổi
        if (task.ref_image_names) {
          const updatedImageNames = { ...(task.ref_image_names) };
          for (let i = 0; i < oldIds.length; i++) {
            const oldId = oldIds[i];
            const newId = newIds[i] || oldId;
            if (updatedImageNames[oldId] && oldId !== newId) {
              updatedImageNames[newId] = updatedImageNames[oldId];
              delete updatedImageNames[oldId];
            }
          }
          task.ref_image_names = updatedImageNames;
        }
      }

      if (window.storageManager) {
        await window.storageManager.saveTask(task);
        const saved = await window.storageManager.getTask(task.task_id);
        log('Task ref_file_ids IN STORAGE after save:', saved?.ref_file_ids);
        if (saved?.ref_file_ids !== task.ref_file_ids) {
          log('WARNING: Storage mismatch! task:', task.ref_file_ids, 'stored:', saved?.ref_file_ids);
        }
      }
    }
    // Smart Clone frames: reconstruct frame_file_id từ file_name khi clone cross-project
    // Frame reupload sẽ được xử lý bởi correctFileIds + reuploadMissingFiles trong content.js
    if (!task.frame_1_file_id && task.frame_1_file_name) {
      task.frame_1_file_id = task.frame_1_file_name; // Dùng file_name làm placeholder → correctFileIds sẽ tìm tile
      log('Smart Clone: reconstructed frame_1_file_id from file_name:', task.frame_1_file_name);
    }
    if (!task.frame_2_file_id && task.frame_2_file_name) {
      task.frame_2_file_id = task.frame_2_file_name;
      log('Smart Clone: reconstructed frame_2_file_id from file_name:', task.frame_2_file_name);
    }

    if (task.frame_1_file_id && task.frame_1_file_id.startsWith('upload_')) {
      try {
        const result = await window.uploadPendingFiles(task.frame_1_file_id);
        if (!result || result.includes('upload_')) {
          throw new Error('Frame 1 upload failed');
        }
        task.frame_1_file_id = result;
        // Capture file_name từ MediaRegistry (populated by FileUploader.uploadPendingFiles)
        if (MediaRegistry.getFileName(result)) {
          task.frame_1_file_name = MediaRegistry.getFileName(result);
        }
        if (window.storageManager) await window.storageManager.saveTask(task);
      } catch (e) {
        console.error('[executeSingleTask] Frame 1 upload error:', e.message);
        sidebarLog?.('Frame upload thất bại: ' + e.message, 'error');
      }
    }
    if (task.frame_2_file_id && task.frame_2_file_id.startsWith('upload_')) {
      try {
        const result = await window.uploadPendingFiles(task.frame_2_file_id);
        if (!result || result.includes('upload_')) {
          throw new Error('Frame 2 upload failed');
        }
        task.frame_2_file_id = result;
        // Capture file_name từ MediaRegistry (populated by FileUploader.uploadPendingFiles)
        if (MediaRegistry.getFileName(result)) {
          task.frame_2_file_name = MediaRegistry.getFileName(result);
        }
        if (window.storageManager) await window.storageManager.saveTask(task);
      } catch (e) {
        console.error('[executeSingleTask] Frame 2 upload error:', e.message);
        sidebarLog?.('Frame upload thất bại: ' + e.message, 'error');
      }
    }

    // Upload pending per-prompt frame pairs
    if (task.frame_pairs && Array.isArray(task.frame_pairs)) {
      let framePairsChanged = false;
      for (const fp of task.frame_pairs) {
        if (fp.frame1 && fp.frame1.startsWith('upload_')) {
          const result = await window.uploadPendingFiles(fp.frame1);
          fp.frame1 = result;
          if (MediaRegistry.getFileName(result)) fp.frame1FileName = MediaRegistry.getFileName(result);
          framePairsChanged = true;
        }
        if (fp.frame2 && fp.frame2.startsWith('upload_')) {
          const result = await window.uploadPendingFiles(fp.frame2);
          fp.frame2 = result;
          if (MediaRegistry.getFileName(result)) fp.frame2FileName = MediaRegistry.getFileName(result);
          framePairsChanged = true;
        }
      }
      if (framePairsChanged && window.storageManager) {
        await window.storageManager.saveTask(task);
      }
    }

    // Fix flicker zoom 2026-06-22: arm zoom session 0.3 (transient, KHÔNG hold) TRƯỚC task ref-prep
    // (correctFileIds + reuploadMissingFiles scan) → in-session 0.3, bỏ multi-pass zoom in/out. KHÔNG end
    // ở đây (submit async qua PromptQueue) → PromptQueue _checkAllDone (non-force, refs==0) restore khi
    // task xong. providerKey='flow' đã chắc (grok/chatgpt return sớm phía trên). Await để armed trước scan.
    if (window.MessageBridge?.sendToContentScript) {
      try { await window.MessageBridge.sendToContentScript('beginFlowZoomSession', { factor: 0.3 }); } catch (e) { /* non-blocking */ }
    }

    // Re-upload ref files nếu tile không còn trên page
    if (task.ref_file_ids && !task.ref_file_ids.includes('upload_')) {
      // Note: correctStaleFileIds tự wait selector config + gọi ensureFlowTilesLoaded (Tầng 3) nếu cần
      // Lưu original IDs trước correctFileIds để reupload cache lookup đúng key
      const originalRefFileIds = task.ref_file_ids;

      // 5-tầng: correct stale IDs bằng file_name + thumbnail URL matching
      // Phase R fix: dùng ref_file_names (không phải result_file_names)
      const thumbMap = task.ref_thumbnails || {};
      const fnMap = task.ref_file_names || {};
      if (typeof window.correctFileIds === 'function' && (Object.keys(thumbMap).length > 0 || Object.keys(fnMap).length > 0)) {
        const beforeCorrectIds = (task.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
        const { correctedIds, changed } = await window.correctFileIds(task.ref_file_ids, thumbMap, fnMap);
        if (changed) {
          log('Ref IDs corrected via file_name/thumbnail matching:', task.ref_file_ids, '->', correctedIds);
          const afterCorrectIds = correctedIds.split(',').map(s => s.trim()).filter(Boolean);
          // Transfer ref_image_names keys: old corrected → new corrected
          if (task.ref_image_names) {
            const updatedNames = { ...(task.ref_image_names) };
            for (let ci = 0; ci < beforeCorrectIds.length; ci++) {
              const oldId = beforeCorrectIds[ci];
              const newId = afterCorrectIds[ci] || oldId;
              if (updatedNames[oldId] && oldId !== newId) {
                updatedNames[newId] = updatedNames[oldId];
                delete updatedNames[oldId];
              }
            }
            task.ref_image_names = updatedNames;
          }
          task.ref_file_ids = correctedIds;
        }
      }
      // Tầng 5: re-upload nếu vẫn còn missing
      log('Checking tiles for ref_file_ids:', task.ref_file_ids);
      const beforeIds = (task.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      const updated = await window.reuploadMissingFiles(task.ref_file_ids, task.ref_thumbnails || {}, originalRefFileIds, task.ref_file_names || {});
      if (updated !== task.ref_file_ids) {
        log('Ref IDs changed after reupload:', task.ref_file_ids, '->', updated);
        // Transfer ref_image_names keys: old → reuploaded
        const beforeReupIds = beforeIds;
        const afterReupIds = (updated || '').split(',').map(s => s.trim()).filter(Boolean);
        if (task.ref_image_names) {
          const updatedNames = { ...(task.ref_image_names) };
          for (let ri = 0; ri < beforeReupIds.length; ri++) {
            const oldId = beforeReupIds[ri];
            const newId = afterReupIds[ri] || oldId;
            if (updatedNames[oldId] && oldId !== newId) {
              updatedNames[newId] = updatedNames[oldId];
              delete updatedNames[oldId];
            }
          }
          task.ref_image_names = updatedNames;
        }
        // Fix B: Transfer ref_file_names + ref_thumbnails (oldId → newId) +
        // augment với MediaRegistry data MỚI từ reupload (FileUploader.reuploadMissingFiles
        // ghi vào MediaRegistry sau khi upload tile mới). Trước fix: chỉ transfer ref_image_names
        // → fileNameMap truyền xuống content.js thiếu entry cho new tile_id → addFileToPrompt
        // fallback by file_name fail.
        const updatedFileNames = { ...(task.ref_file_names || {}) };
        const updatedThumbs = { ...(task.ref_thumbnails || {}) };
        for (let ri = 0; ri < beforeReupIds.length; ri++) {
          const oldId = beforeReupIds[ri];
          const newId = afterReupIds[ri] || oldId;
          if (oldId !== newId) {
            if (updatedFileNames[oldId]) {
              updatedFileNames[newId] = updatedFileNames[oldId];
              delete updatedFileNames[oldId];
            }
            if (updatedThumbs[oldId]) {
              updatedThumbs[newId] = updatedThumbs[oldId];
              delete updatedThumbs[oldId];
            }
          }
        }
        for (const newId of afterReupIds) {
          if (MediaRegistry.getFileName(newId)) updatedFileNames[newId] = MediaRegistry.getFileName(newId);
          if (MediaRegistry.getThumb(newId)) updatedThumbs[newId] = MediaRegistry.getThumb(newId);
        }
        task.ref_file_names = updatedFileNames;
        task.ref_thumbnails = updatedThumbs;
        task.ref_file_ids = updated;
        if (window.storageManager) await window.storageManager.saveTask(task);
      }
      // Warning khi có ảnh tham chiếu bị mất
      const afterIds = (updated || '').split(',').map(s => s.trim()).filter(Boolean);
      const droppedCount = beforeIds.length - afterIds.length;
      if (droppedCount > 0) {
        const warnMsg = window.I18n?.t('app.refDropped', { dropped: droppedCount, remaining: afterIds.length }) || `${droppedCount} ảnh tham chiếu không tìm thấy và đã bị bỏ qua. Task chạy với ${afterIds.length} ảnh còn lại.`;
        if (typeof sendLog === 'function') sendLog(warnMsg, 'warn');
        log(warnMsg);
        // Nếu TẤT CẢ ref bị mất → hỏi user
        if (afterIds.length === 0 && beforeIds.length > 0) {
          const shouldContinue = await window.customDialog?.confirm?.(
            window.I18n?.t('app.allRefsLost') || 'Tất cả ảnh tham chiếu không tìm thấy và không thể khôi phục. Tiếp tục chạy task không có ảnh tham chiếu?',
            { title: window.I18n?.t('app.missingRefs') || 'Thiếu ảnh tham chiếu', type: 'warning' }
          );
          if (!shouldContinue) {
            if (typeof sendLog === 'function') sendLog(window.I18n?.t('app.taskCancelledMissingRef') || 'Task bị hủy do thiếu ảnh tham chiếu.', 'warn');
            return;
          }
        }
      }
    }

    // Update status to running
    if (window.storageManager) {
      await window.storageManager.updateTaskStatus(task.task_id, 'running');
    }
    if (window.eventBus) {
      window.eventBus.emit('task:status_changed', { taskId: task.task_id, status: 'running' });
    }

    const tileTimeout = (window.RetryHelper?.getConfig()?.tileTimeout) || 180000;

    sidebarLog(window.I18n?.t('app.startingTask', { name: task.task_name }) || `Bắt đầu task "${task.task_name}"...`, 'info');

    // UA-3.4: Theo doi bat dau task
    window.UsageSync?.trackEvent('task_start', { task_id: task.task_id, multi_prompt: !!task.multi_prompt });

    try {
      // Check user stop
      if (window._taskShouldStop || window._taskBatchStopped) {
        if (window.storageManager) {
          await window.storageManager.updateTaskStatus(task.task_id, 'pending');
        }
        if (window.eventBus) {
          window.eventBus.emit('task:status_changed', { taskId: task.task_id, status: 'pending' });
        }
        signalSubmitted();
        throw new Error('TASK_STOPPED');
      }

      const afS = window._afSettings || {};
      const genType = task.media_type || afS.defaultGenType || 'Image';
      const ratio = task.ratio || afS.defaultRatio || '9:16';
      const isVideo = genType === 'Video';
      // Phase 6 Bug N.1: strict Server-Only — không fallback hardcoded model name
      const _defImg = window.ModelRegistry?.safeGetDefault('flow', 'image');
      const _defVid = window.ModelRegistry?.safeGetDefault('flow', 'video');
      const model = task.model || (isVideo ? (afS.defaultVideoModel || _defVid) : (afS.defaultImageModel || _defImg));
      const isVideoFrames = isVideo && task.video_input_type === 'Frames';

      // Multi-prompt: dùng task.prompts (đã split) nếu có, fallback task.prompt (raw text)
      const rawPrompts = (task.multi_prompt && task.prompts?.length > 1)
        ? task.prompts
        : [task.prompt];
      const quantity = task.quantity || 1;

      // Mention mode: GIỮ NGUYÊN @mention_name trong prompt khi submit đến Flow
      // (trước đây strip @mentions, nhưng theo yêu cầu mới giữ nguyên prompt có @mention)
      // rawPrompts vẫn được dùng cho regex matching bên dưới (build mentionData)
      const refMode = task.ref_image_mode || 'all';
      const prompts = rawPrompts;

      let fileIds = [];
      let frameFileIds = null;
      if (isVideoFrames) {
        // Per-prompt frame pairs (multi-prompt) or global pair (single)
        if (task.frame_pairs && Array.isArray(task.frame_pairs) && task.frame_pairs.length > 0) {
          frameFileIds = task.frame_pairs.map(fp => ({
            frame1: fp.frame1 || '',
            frame2: fp.frame2 || ''
          }));
        } else {
          frameFileIds = {
            frame1: task.frame_1_file_id || '',
            frame2: task.frame_2_file_id || ''
          };
        }
      } else if (task.ref_file_ids) {
        fileIds = task.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean);
      }

      // [Fix Tasks Flow none mode 2026-06-11] Override fileIds=[] khi user chọn 'none'.
      // Áp dụng cho cả 3 downstream paths (pipeline PromptQueue + 2 legacy runAutoPrompt).
      // Đồng bộ Flow GenTab line 1781 (`payloadFileIds = []`).
      // Note: KHÔNG đụng frameFileIds — frames cho Video genType là concept khác, không phải ref_images.
      if (refMode === 'none') {
        fileIds = [];
      }

      // Fix C: Augment task.ref_file_names + task.ref_thumbnails từ MediaRegistry
      // (populated bởi FileUploader sau upload + ImmediateUploader-via-TaskModal sau Fix A).
      // Đảm bảo fileNameMap truyền xuống content.js đầy đủ cho cross-project fallback —
      // nếu thiếu file_name, addFileToPrompt fallback by file_name fail → ref bị bỏ qua.
      if (window.MediaRegistry && fileIds.length > 0) {
        if (!task.ref_file_names) task.ref_file_names = {};
        if (!task.ref_thumbnails) task.ref_thumbnails = {};
        for (const fid of fileIds) {
          if (!task.ref_file_names[fid]) {
            const fn = MediaRegistry.getFileName(fid);
            if (fn) task.ref_file_names[fid] = fn;
          }
          if (!task.ref_thumbnails[fid]) {
            const tu = MediaRegistry.getThumb(fid);
            if (tu) task.ref_thumbnails[fid] = tu;
          }
        }
      }

      log(`--- Task: "${task.task_name}" ---`);
      log(window.I18n?.t('app.taskSettings', { genType, ratio, model }) || `Cài đặt: ${genType}, ${ratio}, ${model}`);
      if (prompts.length > 1) log(`Multi-prompt: ${prompts.length} prompts`);
      if (fileIds.length > 0) log(`Ref images: ${fileIds.length} file(s)`);

      // Chuyển sang pipeline PromptQueue nếu bật
      if (window.PromptQueue && PromptQueue.isEnabled()) {
        signalSubmitted();

        // Build pipelineRefFileIds: include frame IDs for video frames mode
        let pipelineRefFileIds = fileIds;
        let refImageMode = refMode;
        if (isVideoFrames && frameFileIds) {
          if (Array.isArray(frameFileIds)) {
            // Per-prompt frame pairs: collect unique frame IDs + build sequential ref
            const frameIdSet = new Set();
            frameFileIds.forEach(fp => {
              if (fp?.frame1) frameIdSet.add(fp.frame1);
              if (fp?.frame2) frameIdSet.add(fp.frame2);
            });
            pipelineRefFileIds = [...frameIdSet];
            refImageMode = 'sequential';
          } else {
            // Legacy single pair
            const frameIds = [];
            if (frameFileIds.frame1) frameIds.push(frameFileIds.frame1);
            if (frameFileIds.frame2) frameIds.push(frameFileIds.frame2);
            pipelineRefFileIds = frameIds;
          }
        }

        // Build refFileIdsPerPrompt for per-prompt frame pairs (Video+Frames multi-prompt)
        let refFileIdsPerPrompt = null;
        let taskMentionData = null;
        if (isVideoFrames && Array.isArray(frameFileIds)) {
          // Per-prompt frames: each prompt gets its own frame1+frame2
          refFileIdsPerPrompt = frameFileIds.map(fp => {
            const ids = [];
            if (fp?.frame1) ids.push(fp.frame1);
            if (fp?.frame2) ids.push(fp.frame2);
            return ids;
          });
        } else if (refMode === 'sequential' && fileIds.length > 0) {
          // Sequential: mỗi prompt nhận 1 ref image theo thứ tự
          refFileIdsPerPrompt = rawPrompts.map((_, idx) =>
            [fileIds[idx % fileIds.length]] // [Fix Tasks Flow sequential 2026-06-11] cycle modulo — đồng bộ GenTab line 2007-2012
          );
        } else if (refMode === 'mention' && fileIds.length > 0 && task.ref_image_names) {
          // Mention mode: resolve @mentions trong từng rawPrompt → chỉ ref matching
          const nameToFileId = {};
          for (const fid of fileIds) {
            const name = task.ref_image_names[fid];
            // Index lower-case để case-insensitive match (autocomplete cũng case-insensitive)
            if (name) nameToFileId[name.toLowerCase()] = fid;
          }
          // Regex unicode (\p{L} = letter, \p{N} = number) — accept Vietnamese, emoji, accent
          refFileIdsPerPrompt = rawPrompts.map(prompt => {
            const mentions = prompt.match(/@([\p{L}\p{N}_]+)/gu) || [];
            const ids = [];
            for (const m of mentions) {
              const name = m.substring(1).toLowerCase(); // bỏ @ + lower
              if (nameToFileId[name] && !ids.includes(nameToFileId[name])) {
                ids.push(nameToFileId[name]);
              }
            }
            return ids;
          });
          // Build mentionData per prompt cho EditorExecutor fileNameMap
          const fileNameMap = task.ref_file_names || {};
          taskMentionData = rawPrompts.map((_, i) => ({
            refImages: (refFileIdsPerPrompt[i] || []).map(fid => ({
              file_id: fid,
              file_name: fileNameMap[fid] || null,
            })),
          }));
        }

        // 2026-05-27: apply model duration override cho TASK (has_ref → vd 8s, has_ref_video → 10s).
        // Trước đây task KHÔNG áp duration override (chỉ GenTab + Workflow) → gap. Giờ đồng bộ.
        let _taskFlowDuration = isVideo ? (task.video_duration || null) : null;
        if (isVideo && _taskFlowDuration && Array.isArray(pipelineRefFileIds) && pipelineRefFileIds.length > 0) {
          const _taskFlowAdapter = window.ProviderRegistry?.get?.('flow');
          const _taskRefThumbs = task.ref_thumbnails || {};
          const _taskHasRefVideo = pipelineRefFileIds.some(id => {
            const rt = _taskRefThumbs[id];
            return !!(rt && typeof rt === 'object' && rt.type === 'video');
          });
          const _taskForced = _taskFlowAdapter?.getDurationOverride?.({
            modelValue: model,
            hasRef: true,
            hasRefVideo: _taskHasRefVideo,
            inputType: task.video_input_type || 'Ingredients',
          });
          if (_taskForced) _taskFlowDuration = _taskForced;
        }

        // Build refFileNames map cho TẤT CẢ ref ids (gồm cả per-prompt frames).
        // Cần thiết cho tier2 fallback addFileToPrompt sau reload Flow — fileName UUID Flow persistent.
        // Source: task.ref_file_names (chính) + GenTab.fileNameCache (fallback từ upload session).
        const _taskRefFileNames = { ...(task.ref_file_names || {}) };
        for (const fid of (pipelineRefFileIds || [])) {
          if (!_taskRefFileNames[fid] && window.GenTab?.fileNameCache?.[fid]) {
            _taskRefFileNames[fid] = window.GenTab.fileNameCache[fid];
          }
        }
        if (Array.isArray(refFileIdsPerPrompt)) {
          for (const arr of refFileIdsPerPrompt) {
            for (const fid of (arr || [])) {
              if (!_taskRefFileNames[fid] && window.GenTab?.fileNameCache?.[fid]) {
                _taskRefFileNames[fid] = window.GenTab.fileNameCache[fid];
              }
            }
          }
        }

        // Video download resolution: 720p/1080p (vs image 1k/2k)
        const result = await PromptQueue.getInstance().submitJob({
          owner: 'task',
          label: `Task: ${task.task_name || task.task_id}`,
          prompts,
          settings: {
            genType,
            ratio,
            model,
            isFrames: !!frameFileIds,
            quantity,
            flowVideoDuration: _taskFlowDuration,
          },
          refFileIds: pipelineRefFileIds,
          refFileNames: _taskRefFileNames,
          refImageMode: isVideoFrames ? (Array.isArray(frameFileIds) ? 'sequential' : 'all') : refMode,
          refFileIdsPerPrompt,
          mentionData: taskMentionData,
          autoDownload: (window.featureGate?.canUse('auto_download') ?? false) && !!task.auto_download,
          // Truyền cả 2 fields riêng — PromptQueue isVideo tự chọn _videoDownloadResolution.
          // Trước smart map vào 1 field → PromptQueue line 659 đọc _videoDownloadResolution
          // → undefined → fallback DOM/720p → bug 1080p config nhưng download 720p.
          downloadResolution: task.download_resolution || null,
          videoDownloadResolution: task.video_download_resolution || null,
          taskName: task.task_name || null, // Subfolder cho auto-download
          taskId: task.task_id || task.id, // CRITICAL: Pass taskId để PromptQueue persist result
          _executionToken: options._executionToken || null, // Pass token to PromptQueue
        });
        // Cập nhật trạng thái task
        if (window.storageManager) {
          await window.storageManager.updateTaskStatus(task.task_id, result.stopped ? 'pending' : 'completed');
        }
        if (window.eventBus) {
          const pipelineStatus = result.stopped ? 'pending' : 'completed';
          // Fetch fresh task from storage to get updated result data from PromptQueue
          let freshResultData = {};
          if (pipelineStatus === 'completed' && window.storageManager) {
            try {
              const freshTask = await window.storageManager.getTask(task.task_id);
              if (freshTask) {
                freshResultData = {
                  result_thumbnails: freshTask.result_thumbnails ? Object.values(freshTask.result_thumbnails) : [],
                  result_file_ids: freshTask.result_file_ids || '',
                  result_file_names: freshTask.result_file_names || {},
                };
              }
            } catch (e) {
              console.warn('[executeSingleTask] Failed to fetch fresh task for result:', e.message);
            }
          }
          window.eventBus.emit('task:status_changed', {
            taskId: task.task_id,
            status: pipelineStatus,
            // History fields (only when completed)
            ...(pipelineStatus === 'completed' ? {
              prompt: task.prompt || '',
              media_type: task.media_type || 'image',
              model: model || '',
              ratio: ratio || '',
              // Phase Analytics-3: Pipeline Flow task — N prompt × Flow quantity (1-4)
              prompt_count: (task.multi_prompt && task.prompts?.length) ? task.prompts.length : 1,
              quantity: parseInt(task.quantity) || 1,
              ref_file_ids: task.ref_file_ids || '',
              ...freshResultData,
              task_id: task.task_id,
              provider: task.provider || 'flow', // SS-Phase G: pipeline Flow task path (ChatGPT/Grok đã return sớm ở dòng trên)
              project_id: task.project_id || window._currentProjectId || null,
              auto_download: !!task.auto_download
            } : {})
          });
        }
        return result;
      }

      // Capture preTileIds as fallback (khi content.js không trả resultTileIds)
      let preTileIds = [];
      if (window.MessageBridge) {
        try {
          const resp = await window.MessageBridge.getCurrentTileIds();
          preTileIds = resp?.tileIds || [];
        } catch (e) { globalThis.SEOSONA_swallow?.('app#signalSubmitted', e); }
      }

      let runResult = null;
      if (window.MessageBridge) {
        // Check if content.js is stuck in isRunning state → force reset
        try {
          const state = await window.MessageBridge.getRunningState();
          sidebarLog(`Content script state: isRunning=${state?.isRunning}, shouldStop=${state?.shouldStop}`, 'info');
          if (state?.isRunning) {
            sidebarLog('Content script stuck, forcing stop...', 'warn');
            await window.MessageBridge.stopExecution();
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (e) {
          sidebarLog(window.I18n?.t('app.cannotConnectContent', { message: e.message }) || `Không thể kết nối content script: ${e.message}`, 'error');
          sidebarLog(window.I18n?.t('app.refreshFlowTab') || 'Hãy thử refresh tab Google Flow rồi chạy lại.', 'warn');
          signalSubmitted();
          throw e;
        }

        sidebarLog(window.I18n?.t('app.sendingPrompts', { count: prompts.length, genType, ratio, model }) || `Gửi ${prompts.length} prompt(s) đến Google Flow... (${genType}, ${ratio}, ${model})`, 'info');
        // Build refImageMode + refFileIdsPerPrompt cho legacy path
        let refPerPrompt = refMode === 'sequential' && prompts.length > 1;
        let refFileIdsPerPrompt = null;
        let legacyMentionData = null;
        let legacyRefMode = refMode;
        // Per-prompt frame pairs for legacy path
        if (isVideoFrames && Array.isArray(frameFileIds)) {
          refPerPrompt = true;
          legacyRefMode = 'sequential';
          refFileIdsPerPrompt = frameFileIds.map(fp => {
            const ids = [];
            if (fp?.frame1) ids.push(fp.frame1);
            if (fp?.frame2) ids.push(fp.frame2);
            return ids;
          });
        } else if (refMode === 'sequential' && fileIds.length > 0) {
          refFileIdsPerPrompt = rawPrompts.map((_, idx) =>
            [fileIds[idx % fileIds.length]] // [Fix Tasks Flow sequential 2026-06-11] cycle modulo — đồng bộ GenTab line 2007-2012
          );
        } else if (refMode === 'mention' && fileIds.length > 0 && task.ref_image_names) {
          // Build mentionData cho content.js legacy mention handling (dùng rawPrompts để regex match @mentions)
          const nameToFileId = {};
          for (const fid of fileIds) {
            const name = task.ref_image_names[fid];
            if (name) nameToFileId[name] = fid;
          }
          const fileNameMap2 = task.ref_file_names || {};
          legacyMentionData = rawPrompts.map(prompt => {
            const mentions = prompt.match(/@([a-zA-Z0-9_]+)/g) || [];
            const refImages = [];
            const seen = new Set();
            for (const m of mentions) {
              const name = m.substring(1);
              const fid = nameToFileId[name];
              if (fid && !seen.has(fid)) {
                seen.add(fid);
                refImages.push({ file_id: fid, file_name: fileNameMap2[fid] || null, name });
              }
            }
            return { refImages };
          });
        }
        runResult = await window.MessageBridge.runAutoPrompt({
          prompts,
          // Phase 2c+: Server-Only — ExecutionConfig source of truth. inputTimeout vẫn là user setting hợp lệ.
          delayBetweenMs: (window.ExecutionConfig?.safeGetDelayBetweenPromptsSec?.() ?? 5) * 1000,
          inputTimeoutMs: window.storageSettings?.getSettings()?.inputTimeout || 1200,
          fileIds,
          fileNameMap: task.ref_file_names || {},
          genType,
          aspectRatio: ratio,
          modelName: model,
          frameFileIds,
          noTileWait: isParallel,
          quantity,
          // Check feature gate: nếu không có quyền, force autoDownload = false
          autoDownload: (window.featureGate?.canUse('auto_download') ?? false) && !!task.auto_download,
          // Truyền 2 fields riêng — content.js downloadTileMedia line 1369 dùng videoDownloadResolution
          // override khi tile có <video>. Trước smart map vào 1 field → videoDownloadResolution mặc định '720p'
          // → override 1080p → 720p sai. Phải truyền cả 2 cho cả image + video task.
          downloadResolution: task.download_resolution || '1k',
          videoDownloadResolution: task.video_download_resolution || '720p',
          refImageMode: legacyRefMode,
          refPerPrompt,
          refFileIdsPerPrompt,
          mentionData: legacyMentionData,
          taskName: task.task_name || null,
          // Flow Voice Selector — pass voice nếu task có (chỉ flow + Video + supports_voice)
          voice: (task.voice_slug && task.voice_search_value)
            ? { slug: task.voice_slug, search_value: task.voice_search_value }
            : null,
          // Flow Character Selector — pass character nếu task có (chỉ flow, cả image+video)
          character: (task.character_slug && task.character_search_value)
            ? { slug: task.character_slug, search_value: task.character_search_value }
            : null,
        });

        sidebarLog(`runAutoPrompt kết quả: ${JSON.stringify(runResult || 'undefined')}`, 'info');

        if (runResult?.blocked) {
          signalSubmitted();
          throw new Error(window.I18n?.t('app.flowBusyRetry') || 'Google Flow đang bận xử lý. Hãy thử dừng và chạy lại.');
        }
      } else if (typeof applySettings === 'function' && typeof runAutoPrompt === 'function') {
        let refFileIdsPerPrompt2 = null;
        let legacyMentionData2 = null;
        let legacyRefMode2 = refMode;
        let legacyRefPerPrompt2 = refMode === 'sequential' && prompts.length > 1;
        // Per-prompt frame pairs
        if (isVideoFrames && Array.isArray(frameFileIds)) {
          legacyRefPerPrompt2 = true;
          legacyRefMode2 = 'sequential';
          refFileIdsPerPrompt2 = frameFileIds.map(fp => {
            const ids = [];
            if (fp?.frame1) ids.push(fp.frame1);
            if (fp?.frame2) ids.push(fp.frame2);
            return ids;
          });
        } else if (refMode === 'sequential' && fileIds.length > 0) {
          refFileIdsPerPrompt2 = rawPrompts.map((_, idx) =>
            [fileIds[idx % fileIds.length]] // [Fix Tasks Flow sequential 2026-06-11] cycle modulo — đồng bộ GenTab line 2007-2012
          );
        } else if (refMode === 'mention' && fileIds.length > 0 && task.ref_image_names) {
          // Build mentionData cho content.js mention handling (dùng rawPrompts để regex match)
          const nameToFid2 = {};
          for (const fid of fileIds) {
            const name = task.ref_image_names[fid];
            if (name) nameToFid2[name] = fid;
          }
          const fnMap2 = task.ref_file_names || {};
          legacyMentionData2 = rawPrompts.map(prompt => {
            const mentions = prompt.match(/@([a-zA-Z0-9_]+)/g) || [];
            const refImages = [];
            const seen = new Set();
            for (const m of mentions) {
              const name = m.substring(1);
              const fid = nameToFid2[name];
              if (fid && !seen.has(fid)) {
                seen.add(fid);
                refImages.push({ file_id: fid, file_name: fnMap2[fid] || null, name });
              }
            }
            return { refImages };
          });
        }
        runResult = await runAutoPrompt({
          prompts,
          // Phase 2c+: Server-Only — ExecutionConfig source of truth. inputTimeout vẫn là user setting hợp lệ.
          delayBetweenMs: (window.ExecutionConfig?.safeGetDelayBetweenPromptsSec?.() ?? 5) * 1000,
          inputTimeoutMs: window.storageSettings?.getSettings()?.inputTimeout || 1200,
          fileIds,
          fileNameMap: task.ref_file_names || {},
          genType,
          aspectRatio: ratio,
          modelName: model,
          frameFileIds,
          noTileWait: isParallel,
          quantity,
          // Check feature gate: nếu không có quyền, force autoDownload = false
          autoDownload: (window.featureGate?.canUse('auto_download') ?? false) && !!task.auto_download,
          // Truyền 2 fields riêng — đồng nhất với MessageBridge.runAutoPrompt path ở trên.
          downloadResolution: task.download_resolution || '1k',
          videoDownloadResolution: task.video_download_resolution || '720p',
          refImageMode: legacyRefMode2,
          refPerPrompt: legacyRefPerPrompt2,
          refFileIdsPerPrompt: refFileIdsPerPrompt2,
          mentionData: legacyMentionData2,
          taskName: task.task_name || null,
          // Flow Voice Selector
          voice: (task.voice_slug && task.voice_search_value)
            ? { slug: task.voice_slug, search_value: task.voice_search_value }
            : null,
          // Flow Character Selector — pass character nếu task có (chỉ flow, cả image+video)
          character: (task.character_slug && task.character_search_value)
            ? { slug: task.character_slug, search_value: task.character_search_value }
            : null,
        });
      } else {
        signalSubmitted();
        throw new Error(window.I18n?.t('app.cannotExecuteTask') || 'Không thể thực thi task: thiếu kết nối tới Google Flow');
      }

      log('runAutoPrompt hoàn tất.');

      // Signal submitted (cho parallel mode: unblock task tiếp theo)
      signalSubmitted();

      // Nếu đã bị stop, lưu partial results (nếu có) rồi skip tile wait
      if (window._taskShouldStop || window._taskBatchStopped) {
        // Save partial results từ content.js (nếu có)
        const partialTiles = runResult?.resultTileIds || [];
        if (partialTiles.length > 0 && window.storageManager) {
          try {
            const freshTask = await window.storageManager.getTask(task.task_id);
            if (freshTask) {
              const existingIds = (freshTask.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
              const mergedIds = [...new Set([...existingIds, ...partialTiles])];
              freshTask.result_file_ids = mergedIds.join(', ');
              freshTask.status = 'pending';
              await window.storageManager.saveTask(freshTask);
              console.log('[executeSingleTask] Flow partial save:', partialTiles.length, 'results');
            }
          } catch (partialErr) {
            console.warn('[executeSingleTask] Flow partial save failed:', partialErr.message);
          }
        } else if (window.storageManager) {
          await window.storageManager.updateTaskStatus(task.task_id, 'pending');
        }
        if (window.eventBus) {
          window.eventBus.emit('task:status_changed', { taskId: task.task_id, status: 'pending' });
        }
        throw new Error('TASK_STOPPED');
      }

      // Lấy kết quả tiles — ưu tiên resultTileIds từ content.js (chính xác per-prompt)
      let pureNewTiles = runResult?.resultTileIds || [];
      let capturedThumbnails = {};

      if (pureNewTiles.length === 0 && window.MessageBridge) {
        const baselineTileIds = runResult?.preTileIds || preTileIds;
        const baselineFileNames = runResult?.preFileNames || null;

        if (isParallel) {
          sidebarLog(`Task "${task.task_name}": chờ kết quả tiles (baseline: ${baselineTileIds.length} tiles)...`, 'info');
          try {
            const tileResult = await window.MessageBridge.waitForNewTiles(
              baselineTileIds, tileTimeout, { captureFileNames: true, preFileNames: baselineFileNames }
            );
            const newTiles = tileResult?.tiles || [];
            capturedThumbnails = tileResult?.thumbnails || {};
            if (newTiles.length > 0) {
              const actualRefIds = runResult?.uploadedFileIds || fileIds;
              const refIdSet = new Set(actualRefIds);
              let candidates = newTiles.filter(id => !refIdSet.has(id));

              if (tileResult?.failed && candidates.length > 0 && window.MessageBridge) {
                const successOnly = [];
                for (const tid of candidates) {
                  const info = capturedThumbnails[tid];
                  if (info?.thumbnail || info?.file_name) {
                    successOnly.push(tid);
                  }
                }
                if (successOnly.length < candidates.length) {
                  const failCount = candidates.length - successOnly.length;
                  sidebarLog(window.I18n?.t('app.taskPartialFail', { name: task.task_name, failed: failCount, success: successOnly.length }) || `Task "${task.task_name}": ${failCount} ảnh thất bại, ${successOnly.length} thành công`, 'warn');
                }
                candidates = successOnly;
              }

              pureNewTiles = candidates;
              if (pureNewTiles.length > 0) {
                sidebarLog(window.I18n?.t('app.taskNewResults', { name: task.task_name, count: pureNewTiles.length }) || `Task "${task.task_name}": ${pureNewTiles.length} kết quả mới`, 'success');
              }
            }
          } catch (e) { globalThis.SEOSONA_swallow?.('app#signalSubmitted', e); }
        } else {
          try {
            const tileResult = await window.MessageBridge.waitForNewTiles(
              baselineTileIds, 10000, { captureFileNames: true, preFileNames: baselineFileNames }
            );
            const newTiles = tileResult?.tiles || [];
            capturedThumbnails = tileResult?.thumbnails || {};
            if (newTiles.length > 0) {
              const actualRefIds = runResult?.uploadedFileIds || fileIds;
              const refIdSet = new Set(actualRefIds);
              pureNewTiles = newTiles.filter(id => !refIdSet.has(id));
            }
          } catch (e) { globalThis.SEOSONA_swallow?.('app#signalSubmitted', e); }
        }
      }

      // Check stop lần nữa sau wait — lưu partial results nếu có
      if (window._taskShouldStop || window._taskBatchStopped) {
        if (pureNewTiles.length > 0 && window.storageManager) {
          try {
            const freshTask = await window.storageManager.getTask(task.task_id);
            if (freshTask) {
              const existingIds = (freshTask.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
              const mergedIds = [...new Set([...existingIds, ...pureNewTiles])];
              freshTask.result_file_ids = mergedIds.join(', ');
              // Capture thumbnails cho partial results
              if (Object.keys(capturedThumbnails).length > 0) {
                const thumbs = {};
                for (const tileId of pureNewTiles) {
                  const info = capturedThumbnails[tileId];
                  if (info?.thumbnail) {
                    thumbs[tileId] = info.type === 'video'
                      ? { thumbnail: info.thumbnail, type: 'video', file_name: info.file_name || '' }
                      : info.thumbnail;
                  }
                }
                if (Object.keys(thumbs).length > 0) {
                  freshTask.result_thumbnails = { ...(freshTask.result_thumbnails || {}), ...thumbs };
                }
              }
              freshTask.status = 'pending';
              await window.storageManager.saveTask(freshTask);
              console.log('[executeSingleTask] Flow partial save (post-wait):', pureNewTiles.length, 'results');
            }
          } catch (partialErr) {
            console.warn('[executeSingleTask] Flow partial save failed:', partialErr.message);
          }
        } else if (window.storageManager) {
          await window.storageManager.updateTaskStatus(task.task_id, 'pending');
        }
        if (window.eventBus) {
          window.eventBus.emit('task:status_changed', { taskId: task.task_id, status: 'pending' });
        }
        throw new Error('TASK_STOPPED');
      }

      // Update task ref_file_ids if upload_xxx were replaced with real IDs
      const actualRefIds = runResult?.uploadedFileIds || fileIds;
      if (runResult?.uploadedFileIds && actualRefIds.join(',') !== fileIds.join(',')) {
        const oldRefIds = task.ref_file_ids;
        task.ref_file_ids = actualRefIds.join(', ');

        if (task.ref_thumbnails) {
          const oldArr = oldRefIds ? oldRefIds.split(',').map(s => s.trim()).filter(Boolean) : fileIds;
          const newArr = actualRefIds;
          const migrated = {};
          for (let i = 0; i < oldArr.length; i++) {
            const thumb = task.ref_thumbnails[oldArr[i]];
            if (thumb && newArr[i]) migrated[newArr[i]] = thumb;
          }
          for (const [id, thumb] of Object.entries(task.ref_thumbnails)) {
            if (!migrated[id] && !oldArr.includes(id)) migrated[id] = thumb;
          }
          task.ref_thumbnails = migrated;
        }

        if (window.storageManager) {
          const freshTask = await window.storageManager.getTask(task.task_id);
          if (freshTask) {
            freshTask.ref_file_ids = task.ref_file_ids;
            freshTask.ref_thumbnails = task.ref_thumbnails;
            await window.storageManager.saveTask(freshTask);
          }
        }
      }

      if (pureNewTiles.length === 0 && !window._taskShouldStop) {
        sidebarLog(window.I18n?.t('app.taskFailedNoResults', { name: task.task_name }) || `Task "${task.task_name}" thất bại: không có kết quả mới`, 'error');
        throw new Error(window.I18n?.t('app.noNewResultsError') || 'Không có kết quả mới sau khi submit - có thể Google Flow bị lỗi');
      }

      const resultFileIds = pureNewTiles.join(', ');

      if (window.storageManager) {
        await window.storageManager.updateTaskStatus(task.task_id, 'completed', resultFileIds);
      }

      // UA-3.4: Theo doi hoan thanh task
      window.UsageSync?.trackEvent('task_complete', { task_id: task.task_id, success: true });
      // NOTE: KHÔNG track flow_prompt_total ở đây vì:
      // - Flow tasks qua Pipeline (PromptQueue) → EditorExecutor đã track khi submit
      // - ChatGPT/Grok adapter tự increment chatgpt_prompt_total/grok_prompt_total
      // Trước đây có bug DOUBLE COUNT: EditorExecutor track khi submit + app.js track khi complete

      // Persist result thumbnails + file_names
      if (pureNewTiles.length > 0) {
        try {
          const thumbs = {};
          const fileNames = {};

          for (const tileId of pureNewTiles) {
            const info = capturedThumbnails[tileId];
            if (info?.thumbnail) {
              // Persist type field for video detection in UI rendering
              if (info.type === 'video') {
                thumbs[tileId] = { thumbnail: info.thumbnail, type: 'video', file_name: info.file_name || '' };
              } else {
                thumbs[tileId] = info.thumbnail;
              }
            }
            if (info?.file_name) fileNames[tileId] = info.file_name;
          }

          const missingTiles = pureNewTiles.filter(id => !thumbs[id] && !fileNames[id]);
          if (missingTiles.length > 0 && window.MessageBridge) {
            const scanResult = await MessageBridge.getThumbnailsByIds(missingTiles);
            const results = scanResult?.results || {};
            for (const tileId of missingTiles) {
              const scanInfo = results[tileId];
              if (scanInfo?.thumbnail && !thumbs[tileId]) {
                if (scanInfo.type === 'video') {
                  thumbs[tileId] = { thumbnail: scanInfo.thumbnail, type: 'video', file_name: scanInfo.file_name || '' };
                } else {
                  thumbs[tileId] = scanInfo.thumbnail;
                }
              }
              if (scanInfo?.file_name && !fileNames[tileId]) fileNames[tileId] = scanInfo.file_name;
            }
          }

          if ((Object.keys(thumbs).length > 0 || Object.keys(fileNames).length > 0) && window.storageManager) {
            const freshTask = await window.storageManager.getTask(task.task_id);
            if (freshTask) {
              freshTask.result_thumbnails = { ...(freshTask.result_thumbnails || {}), ...thumbs };
              if (Object.keys(fileNames).length > 0) {
                freshTask.result_file_names = { ...(freshTask.result_file_names || {}), ...fileNames };
              }
              await window.storageManager.saveTask(freshTask);
            }
          }
        } catch (e) {
          console.warn('[Task] Persist result thumbnails failed:', e.message);
        }
      }

      if (window.eventBus) {
        window.eventBus.emit('task:status_changed', {
          taskId: task.task_id,
          taskName: task.task_name,
          mediaType: task.media_type,
          status: 'completed',
          resultFileIds,
          // History fields
          prompt: task.prompt || '',
          media_type: task.media_type || 'image',
          model: model || '',
          ratio: ratio || '',
          // Phase Analytics-3: Legacy Flow task — N prompt × Flow quantity (1-4)
          prompt_count: (task.multi_prompt && task.prompts?.length) ? task.prompts.length : 1,
          quantity: parseInt(task.quantity) || 1,
          ref_file_ids: task.ref_file_ids || '',
          result_file_ids: resultFileIds || '',
          result_thumbnails: task.result_thumbnails ? Object.values(task.result_thumbnails) : [],
          result_file_names: task.result_file_names || {},
          task_id: task.task_id,
          provider: task.provider || 'flow', // SS-Phase G: legacy task path (Flow default)
          project_id: task.project_id || window._currentProjectId || null,
          auto_download: !!task.auto_download
        });
        // Emit task:complete for NotificationManager
        window.eventBus.emit('task:complete', {
          taskId: task.task_id,
          taskName: task.task_name,
          resultCount: pureNewTiles.length
        });
      }
    } catch (error) {
      // Đảm bảo submitted signal luôn được gọi (unblock parallel loop)
      signalSubmitted();

      if (error.message === 'TASK_STOPPED') {
        sidebarLog(window.I18n?.t('app.taskStopped', { name: task.task_name }) || `Task "${task.task_name}" đã dừng.`, 'warn');
        return;
      }

      console.error('[TaskExecutor] Task failed:', task.task_id, error);
      sidebarLog(window.I18n?.t('app.taskFailed', { name: task.task_name, error: error?.message }) || `Task "${task.task_name}" thất bại: ${error?.message}`, 'error');
      // UA-3.4: Theo doi task that bai
      window.UsageSync?.trackEvent('task_complete', { task_id: task.task_id, success: false });
      if (window.storageManager) {
        await window.storageManager.updateTaskStatus(task.task_id, 'failed');
      }
      if (window.eventBus) {
        window.eventBus.emit('task:status_changed', { taskId: task.task_id, status: 'failed', error: error?.message });
      }
    }
  }

  // ─── Auth UI ──────────────────────────────────────────────
  function setupAuthUI() {
    const loginBtn = document.getElementById('loginBtn');
    const userMenu = document.getElementById('userMenu');
    const userMenuBtn = document.getElementById('userMenuBtn');
    const loginOverlay = document.getElementById('loginOverlay');
    const loginCloseBtn = document.getElementById('loginCloseBtn');
    const loginSubmitBtn = document.getElementById('loginSubmitBtn');
    const registerSubmitBtn = document.getElementById('registerSubmitBtn');
    const switchToRegister = document.getElementById('switchToRegister');
    const switchToLogin = document.getElementById('switchToLogin');
    const logoutBtn = document.getElementById('logoutBtn');
    const userDropdown = document.getElementById('userDropdown');

    function updateAuthUI() {
      /* removed (P1 cleanup): render footer/plan cu — local-first khong con footer account. Giu signature cho callers. */
    }

    // Update footer based on user state (guest/free/premium)
    function updateFooterUI() {
      /* removed (P1 cleanup): render footer/plan cu — local-first khong con footer account. Giu signature cho callers. */
    }

    // Update Premium footer features + quotas based on entitlements
    function updatePremiumFooterFeatures() {
      /* removed (P1 cleanup): render footer/plan cu — local-first khong con footer account. Giu signature cho callers. */
    }

    /**
     * Update footer feature status (icon)
     * @param {string} elementId - Element ID
     * @param {boolean} enabled - Feature enabled state
     */
    function updateFooterFeatureStatus(elementId, enabled) {
      /* removed (P1 cleanup): render footer/plan cu — local-first khong con footer account. Giu signature cho callers. */
    }

    // Update usage values in footer for trial (not logged in) users
    // Counts ACTUAL items from storage, not cumulative create actions
    async function updateTrialFooterBars() {
      /* removed (P1 cleanup): render footer/plan cu — local-first khong con footer account. Giu signature cho callers. */
    }

    // Update usage values in footer for free users (compact inline)
    async function updateFooterUsageBars() {
      /* removed (P1 cleanup): render footer/plan cu — local-first khong con footer account. Giu signature cho callers. */
    }

    /**
     * Update tất cả auto_download toggles dựa trên entitlements
     * Disable toggle nếu feature không được phép trong plan
     */
    function updateAutoDownloadToggles() {
      const canUseAutoDownload = window.featureGate?.canUse('auto_download') ?? false;

      // Tab Gen toggle
      const genTabToggle = document.getElementById('genTabAutoDownload');
      if (genTabToggle) {
        _applyFeatureToggleState(genTabToggle, canUseAutoDownload, 'auto_download');
      }

      // Toolbar toggle
      const toolbarToggle = document.getElementById('autoDownloadToggle');
      if (toolbarToggle) {
        _applyFeatureToggleState(toolbarToggle, canUseAutoDownload, 'auto_download');
      }

      // Sync download fields visibility after toggle state change
      // (programmatic .checked change does NOT fire 'change' event)
      if (window.GenTab?._syncDownloadVisibility) {
        window.GenTab._syncDownloadVisibility();
      }
    }

    /**
     * Update tất cả feature-gated toggles (pipeline_queue_enabled, retry_on_fail, etc.)
     * Gọi khi featuregate:refreshed
     */
    function updateFeatureGatedToggles() {
      // Queue toggle
      const canUseQueue = window.featureGate?.canUse('pipeline_queue_enabled') ?? false;
      const queueToggle = document.getElementById('queueEnabled');
      if (queueToggle) {
        _applyFeatureToggleState(queueToggle, canUseQueue, 'pipeline_queue_enabled');
      }
    }

    /**
     * Helper: apply feature gate state to a toggle
     * disable + uncheck + add crown icon khi không có quyền
     */
    function _applyFeatureToggleState(toggle, canUse, featureKey) {
      const label = toggle.closest('label') || toggle.closest('.toolbar-toggle');
      if (!label) return;

      if (canUse) {
        toggle.disabled = false;
        label.classList.remove('feature-disabled');
        label.removeAttribute('title');
        // Remove crown icon nếu có
        (label.querySelector('.premium-crown') || label.parentElement?.querySelector('.premium-crown'))?.remove();
      } else {
        toggle.disabled = true;
        toggle.checked = false;
        label.classList.add('feature-disabled');
        label.setAttribute('title', window.I18n?.t('app.requiresPremium') || 'Tính năng này yêu cầu gói Premium');
        // Add crown icon nếu chưa có — pass featureKey để label đúng theo plan
        _ensurePremiumCrown(label, featureKey);
      }
    }

    /**
     * Thêm icon crown vàng inline bên phải toggle label để user biết cần nâng cấp plan
     */
    function _ensurePremiumCrown(label, featureKey) {
      /* removed (P1 cleanup): render footer/plan cu — local-first khong con footer account. Giu signature cho callers. */
    }

    // Expose để các module khác có thể gọi
    window.updateAutoDownloadToggles = updateAutoDownloadToggles;
    window.updateFeatureGatedToggles = updateFeatureGatedToggles;
    window._applyFeatureToggleState = _applyFeatureToggleState;
    window._ensurePremiumCrown = _ensurePremiumCrown;

    // Update premium crown badge in header
    function updatePremiumBadge() {
      /* removed (P1 cleanup): render footer/plan cu — local-first khong con footer account. Giu signature cho callers. */
    }

    // Login button -> show overlay
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        if (loginOverlay) loginOverlay.classList.remove('hidden');
      });
    }

    // Close overlay
    if (loginCloseBtn) {
      loginCloseBtn.addEventListener('click', () => {
        if (loginOverlay) loginOverlay.classList.add('hidden');
      });
    }

    // Switch forms
    if (switchToRegister) {
      switchToRegister.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('loginForm')?.classList.add('hidden');
        document.getElementById('registerForm')?.classList.remove('hidden');
        document.getElementById('loginModalTitle').textContent = window.I18n?.t('auth.register') || 'Đăng ký';
      });
    }
    if (switchToLogin) {
      switchToLogin.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('registerForm')?.classList.add('hidden');
        document.getElementById('loginForm')?.classList.remove('hidden');
        document.getElementById('loginModalTitle').textContent = window.I18n?.t('auth.login') || 'Đăng nhập';
      });
    }

    // 2026-06-05: 4-action dialog cho EMAIL_NOT_VERIFIED. Tách function để
    // reusable nếu sau này muốn gọi từ chỗ khác (vd Telegram link flow).
    async function _showUnverifiedEmailDialog(email, password, errorEl) {
      const t = (key, fallback) => window.I18n?.t?.(key) || fallback;

      const ACTION = await new Promise(resolve => {
        const buttons = [
          { label: t('common.cancel', 'Đóng'), primary: false, action: () => resolve('cancel') },
          { label: t('auth.deleteAccount', 'Xoá tài khoản'), primary: false, action: () => resolve('delete') },
          { label: t('auth.changeEmail', 'Đổi email'), primary: false, action: () => resolve('change') },
          { label: t('auth.resendVerify', 'Gửi lại'), primary: true, action: () => resolve('resend') },
        ];
        window.customDialog?.alert?.(
          t('auth.emailNotVerifiedMsg', 'Email chưa xác minh. Kiểm tra hộp thư (cả spam) hoặc chọn thao tác bên dưới.'),
          {
            title: t('auth.emailNotVerifiedTitle', 'Email chưa xác minh'),
            type: 'warning',
            buttons,
          }
        );
      });

      if (ACTION === 'cancel') return;

      if (ACTION === 'resend') {
        await window.authManager.resendVerificationByEmail(email);
        if (errorEl) {
          errorEl.textContent = t('auth.verifyResent', 'Email xác minh đã được gửi lại. Kiểm tra hộp thư rồi đăng nhập lại.');
          errorEl.classList.remove('hidden');
        }
        return;
      }

      if (ACTION === 'change') {
        const newEmail = await window.customDialog?.prompt?.(
          t('auth.changeEmailPrompt', 'Nhập email mới (sẽ gửi link xác minh tới email này):'),
          {
            title: t('auth.changeEmail', 'Đổi email'),
            placeholder: t('auth.emailPlaceholder', 'email@example.com'),
            confirmText: t('common.confirm', 'Xác nhận'),
            cancelText: t('common.cancel', 'Hủy'),
          }
        );
        if (!newEmail || !newEmail.trim()) return;
        await window.authManager.changeUnverifiedEmail(email, password, newEmail.trim());
        if (errorEl) {
          errorEl.textContent = t('auth.changeEmailSuccess', 'Email đã được đổi. Kiểm tra hộp thư email mới để xác minh.');
          errorEl.classList.remove('hidden');
        }
        // Auto-fill input với email mới để user login lại sau khi verify
        const loginEmailInput = document.getElementById('loginEmail');
        if (loginEmailInput) loginEmailInput.value = newEmail.trim();
        return;
      }

      if (ACTION === 'delete') {
        const confirmed = await window.customDialog?.confirmDangerous?.(
          t('auth.deleteAccountConfirm', 'Xoá vĩnh viễn tài khoản này. Email sẽ được giải phóng để register lại. Không thể hoàn tác.'),
          {
            title: t('auth.deleteAccountTitle', 'Xoá tài khoản'),
            itemName: email,
            confirmText: t('auth.deleteAccount', 'Xoá tài khoản'),
            cancelText: t('common.cancel', 'Hủy'),
          }
        );
        if (!confirmed) return;
        await window.authManager.deleteUnverifiedAccount(email, password);
        if (errorEl) {
          errorEl.textContent = t('auth.deleteAccountSuccess', 'Đã xoá tài khoản. Anh có thể register lại với email khác.');
          errorEl.classList.remove('hidden');
        }
        // Reset login form để user nhập email khác
        const loginEmailInput = document.getElementById('loginEmail');
        const loginPasswordInput = document.getElementById('loginPassword');
        if (loginEmailInput) loginEmailInput.value = '';
        if (loginPasswordInput) loginPasswordInput.value = '';
      }
    }

    // [Strict Email Verification 2026-06-06] Modal success sau register khi verification required.
    // Reuse customDialog.alert qua type='success' (mail sent) hoặc 'warning' (mail tắt). I18n key
    // có placeholder {email} — thay manual vì no template engine trong I18n.
    async function _showRegisterVerifySentModal(email, mailSent) {
      const t = (key, fallback) => window.I18n?.t?.(key) || fallback;
      const messageKey = mailSent ? 'auth.registerVerifySent' : 'auth.registerVerifyMailDisabled';
      const messageFallback = mailSent
        ? `Email xác minh đã gửi tới ${email}. Vui lòng kiểm tra hộp thư (cả spam) và click link verify để kích hoạt tài khoản.`
        : `Tài khoản đã tạo nhưng hệ thống gửi mail đang tạm tắt. Liên hệ admin để xác minh.`;
      const message = t(messageKey, messageFallback).replace('{email}', email);
      await window.customDialog?.alert?.(message, {
        title: t('auth.registerSuccess', 'Đăng ký thành công'),
        type: mailSent ? 'success' : 'warning',
      });
    }

    // [Strict Email Verification 2026-06-06] Switch Register tab → Login tab với email pre-fill.
    // Pattern reuse từ existing switchToLogin handler (line 6397-6402).
    function _switchToLoginTab(emailPrefill) {
      // Reset register form
      ['registerName', 'registerEmail', 'registerPassword', 'registerPasswordConfirm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      // Hide register, show login (đồng nhất switchToLogin handler line 6399-6400)
      document.getElementById('registerForm')?.classList.add('hidden');
      document.getElementById('loginForm')?.classList.remove('hidden');
      const titleEl = document.getElementById('loginModalTitle');
      if (titleEl) titleEl.textContent = window.I18n?.t?.('auth.login') || 'Đăng nhập';
      // Pre-fill email + clear password + focus password
      const loginEmailInput = document.getElementById('loginEmail');
      const loginPassInput = document.getElementById('loginPassword');
      if (loginEmailInput) loginEmailInput.value = emailPrefill || '';
      if (loginPassInput) loginPassInput.value = '';
      setTimeout(() => loginPassInput?.focus(), 100);
    }

    // Login submit
    if (loginSubmitBtn) {
      loginSubmitBtn.addEventListener('click', async () => {
        const email = document.getElementById('loginEmail')?.value?.trim();
        const password = document.getElementById('loginPassword')?.value;
        const errorEl = document.getElementById('loginError');

        if (!email || !password) {
          if (errorEl) { errorEl.textContent = window.I18n?.t('auth.enterEmailPassword') || 'Vui lòng nhập email và mật khẩu'; errorEl.classList.remove('hidden'); }
          return;
        }

        loginSubmitBtn.disabled = true;
        loginSubmitBtn.textContent = window.I18n?.t('msg.loggingIn') || 'Đang đăng nhập...';

        try {
          await window.authManager.login(email, password);
          if (loginOverlay) loginOverlay.classList.add('hidden');
          updateAuthUI();
          setupOnboarding();
          // Re-init storage with API mode
          if (window.storageManager) {
            await window.storageManager.switchToApi();
          }
        } catch (e) {
          // SS-Phase B + 2026-06-05: EMAIL_NOT_VERIFIED — 4-action dialog cho user
          // thoát kẹt: Resend / Change email / Delete account / Close. Pattern cho user
          // typo email không vào được vì không nhận được verify mail.
          if (e.code === 'EMAIL_NOT_VERIFIED') {
            const emailVerificationRequired = window.SystemConfig?.getBool('email_verification_required') !== false;

            if (!emailVerificationRequired) {
              // Setting tắt nhưng server vẫn block (race khi admin vừa đổi) → thông báo info
              if (errorEl) {
                errorEl.textContent = window.I18n?.t('auth.emailVerifyDisabledButBlocked') ||
                  'Email chưa xác minh. Vui lòng liên hệ admin hoặc kiểm tra hộp thư để xác minh.';
                errorEl.classList.remove('hidden');
              }
            } else {
              try {
                await _showUnverifiedEmailDialog(email, password, errorEl);
              } catch (dialogErr) {
                if (errorEl) { errorEl.textContent = dialogErr.message || 'Thao tác thất bại'; errorEl.classList.remove('hidden'); }
              }
            }
          } else {
            if (errorEl) { errorEl.textContent = e.message || window.I18n?.t('auth.loginFailed') || 'Đăng nhập thất bại'; errorEl.classList.remove('hidden'); }
          }
        } finally {
          loginSubmitBtn.disabled = false;
          loginSubmitBtn.textContent = window.I18n?.t('auth.login') || 'Đăng nhập';
        }
      });
    }

    // Register submit
    if (registerSubmitBtn) {
      registerSubmitBtn.addEventListener('click', async () => {
        const name = document.getElementById('registerName')?.value?.trim();
        const email = document.getElementById('registerEmail')?.value?.trim();
        const password = document.getElementById('registerPassword')?.value;
        const passwordConfirm = document.getElementById('registerPasswordConfirm')?.value;
        const errorEl = document.getElementById('registerError');

        if (!name || !email || !password || !passwordConfirm) {
          if (errorEl) { errorEl.textContent = window.I18n?.t('auth.fillAllFields') || 'Vui lòng điền đầy đủ thông tin'; errorEl.classList.remove('hidden'); }
          return;
        }
        if (password !== passwordConfirm) {
          if (errorEl) { errorEl.textContent = window.I18n?.t('auth.passwordMismatch') || 'Mật khẩu xác nhận không khớp'; errorEl.classList.remove('hidden'); }
          return;
        }

        registerSubmitBtn.disabled = true;
        registerSubmitBtn.textContent = window.I18n?.t('auth.registering') || 'Đang đăng ký...';

        try {
          const result = await window.authManager.register(name, email, password, passwordConfirm);

          // [Strict Email Verification 2026-06-06] Backend trả verification_required → KHÔNG login,
          // hiện modal "check email" + switch tab Register → Login với email pre-fill.
          // AuthManager.register() line 191 đã skip save auth khi response.token=null → no race.
          if (result?.verification_required) {
            await _showRegisterVerifySentModal(email, result.verification_sent === true);
            _switchToLoginTab(email);
            return;
          }

          // Path cũ: có token → login luôn (setting OFF hoặc SMTP hỏng — lockout-fix)
          if (loginOverlay) loginOverlay.classList.add('hidden');
          updateAuthUI();
          setupOnboarding();
          if (window.storageManager) {
            await window.storageManager.switchToApi();
          }
        } catch (e) {
          if (errorEl) { errorEl.textContent = e.message || window.I18n?.t('auth.registerFailed') || 'Đăng ký thất bại'; errorEl.classList.remove('hidden'); }
        } finally {
          registerSubmitBtn.disabled = false;
          registerSubmitBtn.textContent = window.I18n?.t('auth.register') || 'Đăng ký';
        }
      });
    }

    // AU-2.7: Forgot password link
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    if (forgotPasswordLink) {
      forgotPasswordLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail')?.value?.trim();
        if (!email) {
          if (window.customDialog) {
            window.customDialog.alert(window.I18n?.t('auth.enterEmailFirst') || 'Vui lòng nhập email trước khi yêu cầu khôi phục mật khẩu.', { title: window.I18n?.t('auth.enterEmail') || 'Nhập email' });
          }
          document.getElementById('loginEmail')?.focus();
          return;
        }

        forgotPasswordLink.style.pointerEvents = 'none';
        forgotPasswordLink.textContent = window.I18n?.t('app.sending') || 'Đang gửi...';

        try {
          await window.authManager.forgotPassword(email);
          if (window.customDialog) {
            window.customDialog.alert(window.I18n?.t('auth.resetEmailSent') || 'Đã gửi email khôi phục mật khẩu. Vui lòng kiểm tra hộp thư của bạn.', { title: window.I18n?.t('common.success') || 'Thành công', type: 'success' });
          }
        } catch (err) {
          if (window.customDialog) {
            window.customDialog.alert(err.message || window.I18n?.t('auth.resetEmailFailed') || 'Không thể gửi email khôi phục. Vui lòng thử lại sau.', { title: window.I18n?.t('common.error') || 'Lỗi', type: 'error' });
          }
        } finally {
          forgotPasswordLink.style.pointerEvents = '';
          forgotPasswordLink.textContent = window.I18n?.t('auth.forgotPassword') || 'Quên mật khẩu?';
        }
      });
    }

    // AU-4.10 + AU-4.11: Google login/register buttons
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    const googleRegisterBtn = document.getElementById('googleRegisterBtn');

    let _googleAuthPending = false;
    async function handleGoogleAuth(e) {
      // Debounce: tránh click nhiều lần gây 429
      if (_googleAuthPending) return;
      _googleAuthPending = true;

      const btn = e?.currentTarget;
      const originalText = btn?.textContent;
      if (btn) {
        btn.disabled = true;
        btn.textContent = window.I18n?.t('auth.connecting') || 'Connecting...';
      }

      try {
        await console.log('Login bypassed');
        // OAuth flow continues in new tab → background.js handles token
      } catch (err) {
        // Rate-limit (429): KHÔNG hiện modal đỏ "Error" gây hoảng — chỉ toast warning mềm + số
        // giây THẬT (err.retryAfter). Lỗi khác mới hiện modal error.
        const isRateLimit = err?.code === 'RATE_LIMITED' || err?.httpStatus === 429;
        if (isRateLimit) {
          const secs = Number(err?.retryAfter) || 30;
          const msg = window.I18n?.t?.('auth.rateLimitedToast', { seconds: secs })
            || `Quá nhiều yêu cầu, vui lòng thử lại sau ${secs}s`;
          if (window.showNotification) {
            window.showNotification(msg, 'warning', Math.min(secs * 1000, 6000));
          } else if (window.customDialog) {
            window.customDialog.alert(msg, { title: window.I18n?.t('common.notice') || 'Thông báo', type: 'warning' });
          }
        } else if (window.customDialog) {
          window.customDialog.alert(err.message || window.I18n?.t('app.googleConnectError') || 'Không thể kết nối với Google. Vui lòng thử lại.', { title: window.I18n?.t('common.error') || 'Lỗi', type: 'error' });
        }
      } finally {
        // Reset sau 3 giây (cho phép thử lại nếu tab không mở được)
        setTimeout(() => {
          _googleAuthPending = false;
          if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
          }
        }, 3000);
      }
    }

    if (googleLoginBtn) {
      googleLoginBtn.addEventListener('click', handleGoogleAuth);
    }
    if (googleRegisterBtn) {
      googleRegisterBtn.addEventListener('click', handleGoogleAuth);
    }

    // AU-4.13: Listen for OAuth success from background.js
    // CRITICAL: KHÔNG dùng `async` listener — Chrome MV3 sẽ treat returned Promise
    // như async response intent → giữ message channel mở → caller nhận `null` cho TẤT CẢ
    // chrome.runtime.sendMessage khác (kể cả từ popup window). Wrap async work trong IIFE.
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action !== 'auth:oauthLogin' || !msg.token) return;
      (async () => {
        // Check nếu storage handler đã xử lý login này (token đã được set)
        if (window.authManager?.token === msg.token) {
          console.log('[SEOSONA Flow] OAuth: Skip message handler, storage handler đã xử lý');
          return;
        }

        // Set flag để storage handler không xử lý duplicate
        window._oauthLoginProcessing = true;

        // Update AuthManager state — LOCAL: user cục bộ, không set từ msg (no-op an toàn).
        void (msg.user || null);
        // [Fix re-login] Reset cascade-block flags được set bởi logout/refresh-fail trước đó.
        // Nếu không reset, mọi _apiCall non-auth sẽ bị short-circuit với UNAUTHENTICATED →
        // login OAuth thành công nhưng extension vẫn báo chưa login.
        window.authManager._sessionInvalid = false;

        // Close login overlay
        if (loginOverlay) loginOverlay.classList.add('hidden');

        // Update UI
        updateAuthUI();
        setupOnboarding();

        // Refresh FeatureGate TRƯỚC khi emit auth:login để có data mới nhất
        if (window.featureGate) {
          try {
            await window.featureGate.resetForLogin();
            console.log('[SEOSONA Flow] OAuth: Entitlements refreshed');
          } catch (e) {
            console.warn('[SEOSONA Flow] OAuth: Không thể refresh entitlements', e);
          }
        }

        // Switch to API storage (await để clear local trước khi emit auth:login)
        if (window.storageManager) {
          await window.storageManager.switchToApi();
        }

        // Fetch full user info
        window.authManager.fetchUser().then(() => {
          updateAuthUI();
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#handleGoogleAuth', _e); });

        // Emit auth event
        if (window.eventBus) {
          window.eventBus.emit('auth:login', { user: msg.user });
        }

        // Clear flag sau khi xử lý xong
        window._oauthLoginProcessing = false;
      })();
    });

    // Note: Đã remove auth drift polling (setInterval 3s + chrome.alarms listener) sau khi
    // xác định root cause là Chrome HTTP cache. storage.onChanged + runtime.onMessage
    // listener đã handle đủ login/logout sync, không cần polling tốn CPU.

    // F36: Handle payment completion from checkout page
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'payment:completed') {
        // Close upgrade modal if open
        const upgradeOverlay = document.getElementById('upgradeOverlay');
        if (upgradeOverlay && !upgradeOverlay.classList.contains('hidden')) {
          upgradeOverlay.classList.add('hidden');
        }

        // Refresh entitlements (plan may have changed)
        if (window.featureGate) {
          window.featureGate.refreshAsync();
        }

        // Show success toast
        if (typeof showToast === 'function') {
          showToast(window.I18n?.t('paymentNotify.successActivated') || 'Thanh toán thành công! Gói đã được kích hoạt.');
        }

        // Log
        if (typeof sendLog === 'function') {
          sendLog('[Payment] Thanh toán thành công, order: ' + (msg.orderId || ''), 'info');
        }
      }

      if (msg.action === 'payment:cancelled') {
        if (typeof showToast === 'function') {
          showToast(window.I18n?.t('paymentNotify.cancelled') || 'Thanh toán đã bị hủy.');
        }
      }
    });

    // Multi-tab warning banner
    const multiTabBanner = document.getElementById('multiTabBanner');
    const multiTabCount = document.getElementById('multiTabCount');
    const multiTabCloseBtn = document.getElementById('multiTabCloseBtn');
    const multiTabDismissBtn = document.getElementById('multiTabDismissBtn');
    let _multiTabDismissed = false;

    async function checkMultiFlowTabs() {
      if (!multiTabBanner || _multiTabDismissed) return;
      try {
        const tabs = await chrome.tabs.query({ url: window.ProviderConfigManager?.getTabQuery('flow') });
        if (tabs.length > 1) {
          if (multiTabCount) multiTabCount.textContent = tabs.length;
          multiTabBanner.classList.remove('hidden');
        } else {
          multiTabBanner.classList.add('hidden');
        }
      } catch (e) {
        // Silently ignore — tabs API may not be available
      }
    }

    if (multiTabCloseBtn) {
      multiTabCloseBtn.addEventListener('click', async () => {
        try {
          const targetTabId = window._targetFlowTabId || null;
          const tabs = await chrome.tabs.query({ url: window.ProviderConfigManager?.getTabQuery('flow') });
          const otherTabs = tabs.filter(t => t.id !== targetTabId);
          if (otherTabs.length === 0 && tabs.length > 1) {
            // No target set — keep active tab, close others
            const activeTabs = tabs.filter(t => t.active);
            const keepId = activeTabs.length > 0 ? activeTabs[0].id : tabs[0].id;
            const toClose = tabs.filter(t => t.id !== keepId);
            for (const t of toClose) {
              await chrome.tabs.remove(t.id);
            }
          } else {
            for (const t of otherTabs) {
              await chrome.tabs.remove(t.id);
            }
          }
          multiTabBanner.classList.add('hidden');
        } catch (e) {
          console.warn('[SEOSONA Flow] Failed to close other tabs:', e.message);
        }
      });
    }

    if (multiTabDismissBtn) {
      multiTabDismissBtn.addEventListener('click', () => {
        _multiTabDismissed = true;
        multiTabBanner?.classList.add('hidden');
      });
    }

    // Listen for tab changes to re-check
    try {
      chrome.tabs.onCreated.addListener(() => {
        _multiTabDismissed = false;
        setTimeout(checkMultiFlowTabs, 500);
      });
      chrome.tabs.onRemoved.addListener(() => {
        setTimeout(checkMultiFlowTabs, 500);
      });
      chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
        if (changeInfo.url && changeInfo.url.includes('labs.google/fx')) {
          _multiTabDismissed = false;
          setTimeout(checkMultiFlowTabs, 500);
        }
      });
    } catch (e) {
      // Tab events may not be available in all contexts
    }

    // Initial check
    checkMultiFlowTabs();

    // User menu toggle
    if (userMenuBtn) {
      userMenuBtn.addEventListener('click', () => {
        if (userDropdown) userDropdown.classList.toggle('hidden');
      });
      // Close dropdown on outside click
      document.addEventListener('click', (e) => {
        if (userDropdown && !userDropdown.classList.contains('hidden') && !userMenuBtn.contains(e.target) && !userDropdown.contains(e.target)) {
          userDropdown.classList.add('hidden');
        }
      });
    }

    // Logout
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        if (userDropdown) userDropdown.classList.add('hidden');
        await window.authManager.logout();
        updateAuthUI();
        // Switch back to local storage
        if (window.storageManager) {
          window.storageManager.switchToLocal();
        }
      });
    }

    // ─── Module Overlays (thay thế Auth Gate Overlays cũ) ──────────────────────────────
    // Module-blocked-overlay giờ được quản lý bởi refreshModuleOverlays()
    // Không còn sử dụng các auth-gate-overlay riêng lẻ trong HTML

    // Listen for auth events
    if (window.eventBus) {
      window.eventBus.on('auth:login', updateAuthUI);
      window.eventBus.on('auth:logout', updateAuthUI);
      window.eventBus.on('auth:login', refreshModuleOverlays);
      window.eventBus.on('auth:login', refreshSubtabOverlays);
      // NOTE: auth:logout refreshModuleOverlays đã được xử lý trong handler riêng
      // (sau resetForLogout) để đảm bảo FeatureGate đã reset trước khi refresh overlays

      // Auto-init tab-tasks khi login nếu module được enabled
      // (TaskList chưa init nếu trước đó module bị block)
      window.eventBus.on('auth:login', async () => {
        const tasksPane = document.getElementById('tab-tasks');
        if (!tasksPane) return;
        // Đợi featureGate refresh xong
        await new Promise(r => setTimeout(r, 500));
        const isAllowed = window.featureGate?.isModuleEnabled?.('tasks') === true;
        if (isAllowed) {
          hideModuleBlockedOverlay(tasksPane);
          // Init hoặc reload TaskList
          if (tasksPane.__multiTaskTab?.taskList) {
            tasksPane.__multiTaskTab.taskList.loadTasks();
          } else {
            initializeTab('tab-tasks').catch(e => console.warn('[SEOSONA Flow] tab-tasks init error:', e));
          }
        }
      });

      // R-2.2: SSE lifecycle — connect khi login, disconnect khi logout
      window.eventBus.on('auth:login', () => {
        if (window.SseClient) {
          console.log('[SSE] Auth login → kết nối SSE');
          window.SseClient.connect();
        }
      });
      window.eventBus.on('auth:logout', () => {
        if (window.SseClient) {
          console.log('[SSE] Auth logout → ngắt kết nối SSE');
          window.SseClient.disconnect();
        }
      });

      // Clear & reload UI lists khi logout (server-synced data đã bị xóa bởi _clearAuth)
      // NOTE: FeatureGate.resetForLogout() đã được gọi trong AuthManager.logout() TRƯỚC khi emit event
      window.eventBus.on('auth:logout', () => {
        console.log('[SEOSONA Flow] Auth logout → reload UI lists (data cleared)');

        // Emit storage events → TaskList & WorkflowList sẽ tự reload (đọc từ local → empty)
        window.eventBus.emit('storage:task_deleted');
        window.eventBus.emit('storage:workflow_deleted');
        // Reload UserPromptsManager (clear in-memory, sẽ fallback sang _loadLocal → empty)
        if (window.userPromptsManager) {
          window.userPromptsManager.prompts = [];
          window.userPromptsManager.isInitialized = false;
        }
        // Refresh subtab overlays after logout
        refreshSubtabOverlays();
      });

      // Handle API auth errors (401/403) from ApiStorage - switch to local mode
      window.eventBus.on('api:auth_error', () => {
        console.warn('[SEOSONA Flow] API auth error → switching to local mode');
        if (window.storageManager?.mode === 'api') {
          window.storageManager.switchToLocal();
        }
        // Emit logout để UI update
        if (true) {
          window.authManager._clearAuth?.().then(() => {
            window.eventBus.emit('auth:logout', { reason: 'api_auth_error' });
          }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#checkMultiFlowTabs', _e); });
        }
      });

      // Listen for trial usage changes (anonymous users)
      window.eventBus.on('trialgate:usage_changed', () => {
        refreshModuleOverlays();
        refreshSubtabOverlays();
        updateTrialFooterBars();
      });

      // Listen for storage changes (task/workflow create/delete) to update footer counts
      // Dùng updateFooterUI() thay vì gọi riêng trial/free — đảm bảo premium footer cũng được update
      window.eventBus.on('storage:task_saved', () => {
        updateFooterUI();
        refreshModuleOverlays();
      });
      window.eventBus.on('storage:task_deleted', () => {
        updateFooterUI();
        refreshModuleOverlays();
      });
      window.eventBus.on('storage:workflow_saved', () => {
        updateFooterUI();
        refreshModuleOverlays();
      });
      window.eventBus.on('storage:workflow_deleted', () => {
        updateFooterUI();
        refreshModuleOverlays();
      });
      window.eventBus.on('storage:workflow_full_saved', () => {
        updateFooterUI();
        refreshModuleOverlays();
      });

      // === R-2.3: SSE Event Handlers ===

      // Entitlements thay đổi từ server (plan upgrade/downgrade/admin change)
      window.eventBus.on('sse:entitlements_changed', async (data) => {
        console.log('[SSE] Entitlements thay đổi, plan:', data?.plan?.slug);
        // Relay tới popup windows (settings, workflow editor) để chúng refresh featureGate/UI
        try { chrome.runtime.sendMessage({ action: 'sseRelay:entitlements_changed', data }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#checkMultiFlowTabs', _e); }); } catch (e) { /* ignore */ }
        if (data?.features && data?.plan) {
          // E3.1: Delegate to FeatureGate.handleSseEntitlementsChanged()
          // Method này sẽ:
          // - Update entitlements + plan
          // - Set _lastSseRefresh timestamp (cho conditional refresh)
          // - Save cache
          // - Emit featuregate:refreshed event
          if (window.featureGate?.handleSseEntitlementsChanged) {
            window.featureGate.handleSseEntitlementsChanged(data);
          }

          // Update authManager.user.plan_slug để footer UI đúng.
          // LOCAL: user là stub cục bộ (không có auth server) → cập nhật no-op an toàn.
          const _localUser = { id: "local_user", name: "Local User", plan_slug: "unlimited" };
          if (_localUser && data.plan?.slug) {
            _localUser.plan_slug = data.plan.slug;
            if (data.plan.name) {
              _localUser.plan_name = data.plan.name;
            }
            // Persist to storage
            const stored = await chrome.storage.local.get('af_auth');
            if (stored.af_auth) {
              stored.af_auth.user = _localUser;
              await chrome.storage.local.set({ af_auth: stored.af_auth });
            }
          }

          // Refresh UI components (bổ sung cho event listener)
          if (typeof updateFooterUI === 'function') updateFooterUI();
          if (typeof updateAuthUI === 'function') updateAuthUI();
        }
      });

      // Plan activated - hiện overlay chúc mừng (chỉ 1 lần per order)
      window.eventBus.on('sse:plan_activated', async (data) => {
        console.log('[SSE] Plan activated:', data?.plan_slug, data?.is_upgrade ? '(upgrade)' : '');
        if (!data?.order_id) return;

        // [Upgrade Prorated 2026-05-31] Refresh user data sau plan_activated để extension
        // có plan_expires_at + plan_billing_cycle MỚI (entitlements_changed event chỉ update
        // plan_slug + plan_name). Nếu không refresh → lần mở upgrade modal kế tiếp tính credit
        // sai vì dùng expires_at cũ. Best-effort, không block overlay show.
        try { await window.authManager?.fetchUser?.(); } catch (_) { globalThis.SEOSONA_swallow?.('app#checkMultiFlowTabs', _); }

        // Check đã show overlay cho order này chưa
        const storageKey = 'af_shown_plan_activated';
        const stored = await chrome.storage.local.get(storageKey);
        const shownOrders = stored[storageKey] || [];

        if (shownOrders.includes(data.order_id)) {
          console.log('[SSE] Đã show overlay cho order này rồi:', data.order_id);
          return;
        }

        // Đánh dấu đã show
        shownOrders.push(data.order_id);
        // Giữ tối đa 50 order IDs gần nhất
        if (shownOrders.length > 50) shownOrders.shift();
        await chrome.storage.local.set({ [storageKey]: shownOrders });

        // Hiện overlay chúc mừng
        showPlanActivatedOverlay(data);
      });

      // Force logout từ admin
      window.eventBus.on('sse:force_logout', (data) => {
        console.log('[SSE] Force logout:', data?.reason);
        // Relay tới popup windows để chúng đóng window (tránh user thao tác trên session đã bị revoke)
        try { chrome.runtime.sendMessage({ action: 'sseRelay:force_logout', data }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#checkMultiFlowTabs', _e); }); } catch (e) { /* ignore */ }
        if (window.SseClient) window.SseClient.disconnect();
        window.authManager?.logout(data?.reason || 'admin_revoked');
      });

      // Session bị thay thế bởi thiết bị khác — chỉ disconnect, không hiện modal
      // Trạng thái SSE đã thể hiện qua icon status ở header
      window.eventBus.on('sse:session_replaced', (data) => {
        console.log('[SSE] Phiên bị thay thế:', data?.device_info);
        if (window.SseClient) window.SseClient.disconnect();
      });

      // Thông báo từ hệ thống
      window.eventBus.on('sse:announcement', (data) => {
        if (window.customDialog && data?.message) {
          window.customDialog.alert(
            data.message,
            { title: data?.title || window.I18n?.t('app.systemNotification') || 'Thông báo hệ thống', type: data?.type || 'info' }
          );
        }
      });

      // SS: System settings thay đổi từ admin (show/hide upgrade, maintenance, etc.)
      window.eventBus.on('sse:system_settings_changed', (data) => {
        console.log('[SSE] System settings thay đổi', data?.section || 'all');
        if (window.SystemConfig) {
          window.SystemConfig.handleSseUpdate(data);
        }
      });

      // Refresh ChatGPT/Grok error_patterns khi admin update qua
      // /admin/providers → API Configs (event provider:api_config_updated).
      window.eventBus.on('provider:api_config_updated', ({ provider, key }) => {
        if (key === 'error_patterns' || key === 'ui_text_patterns') {
          if (provider === 'chatgpt') {
            console.log('[SSE] Provider API config updated — refresh ChatGPTConfig');
            window.ChatGPTConfig?.refresh?.();
          } else if (provider === 'grok') {
            console.log('[SSE] Provider API config updated — refresh GrokConfig');
            window.GrokConfig?.refresh?.();
          }
        }
      });

      // Telegram command (Phase V) -- TelegramExecutor xu ly
      if (window.TelegramExecutor) {
        window.TelegramExecutor.init();
      }

      // MCP AI agent (MCP plan Phase 2) -- McpExecutor xu ly lenh ai_command qua SSE
      if (window.McpExecutor) {
        window.McpExecutor.init();
      }

      // UA: Khoi tao usage analytics tracking
      if (window.UsageSync) {
        window.UsageSync.init();
      }


      // Listen for album:use event - add album images to tab_gen ref images
      // async handler: STALE images get uploaded immediately (like local file uploads)
      window.eventBus.on('album:use', async (data) => {
        const { images } = data;
        if (!images || images.length === 0) return;

        // Add images to GenTab ref images
        if (window.GenTab && window.GenTab.fileIdsInput && window.AlbumList) {
          const existingIds = (window.GenTab.fileIdsInput.value || '').split(',')
            .map(s => s.trim()).filter(Boolean);

          const newIds = [];
          for (const img of images) {
            const fileId = img.file_id || img.fileId;
            // Skip duplicate (by file_id if exists)
            if (fileId && existingIds.includes(fileId)) continue;

            // Check image status for STALE detection
            const status = await window.AlbumList._checkImageStatus(img);

            // Prepare image — STALE/no-file-id gets upload_xxx key, ALIVE gets file_id
            const useKey = await window.AlbumList._prepareImageForGenTab(img, status);
            if (useKey && !existingIds.includes(useKey)) {
              newIds.push(useKey);
            }
          }

          if (newIds.length > 0) {
            const mergedIds = [...existingIds, ...newIds];
            window.GenTab.fileIdsInput.value = mergedIds.join(', ');
            window.GenTab.fileIdsInput.dispatchEvent(new Event('input', { bubbles: true }));
            window.GenTab.renderFileIdThumbnails();
            window.GenTab._refreshMentionHelper();
            window.GenTab.saveState();

            // Switch to gen tab
            window.SidebarManager?.switchTo?.('tab-gen');
          }
        }
      });

      // Listen for capture:start event - trigger screen capture, optionally add to album
      window.eventBus.on('capture:start', async (data) => {
        if (!window.ScreenCapture) {
          console.warn('[SEOSONA Flow] ScreenCapture not available');
          return;
        }
        const result = await ScreenCapture.startCapture();
        if (!result.success || !result.uploadId) return;

        // Emit capture:complete cho AlbumCreateModal và các listeners khác
        window.eventBus.emit('capture:complete', {
          uploadId: result.uploadId,
          captureName: result.captureName,
          thumbnail: window.pendingUploadFiles?.get(result.uploadId)?.thumbnail || null
        });

        // Nếu có targetAlbumId → thêm ảnh vào album
        if (data?.targetAlbumId && window.ImageStore) {
          try {
            const pending = window.pendingUploadFiles?.get(result.uploadId);
            const thumbBlob = pending?.thumbnail || null;
            const imageData = {
              name: result.captureName || ('capture_' + Date.now().toString(36)),
              type: 'capture',
              original_name: result.captureName,
              pending_upload_key: result.uploadId  // Track upload key for later resolution
            };
            await window.ImageStore.addImage(data.targetAlbumId, imageData, thumbBlob, pending?.file || null);
            console.log('[SEOSONA Flow] Capture added to album:', data.targetAlbumId);
            // Refresh album list
            window.eventBus.emit('album:refresh');
          } catch (e) {
            console.error('[SEOSONA Flow] Failed to add capture to album:', e);
          }
        }
      });

      // Listen for upload:completed to update album images with file_id
      // (Capture images added to albums have pending_upload_key but no file_id)
      window.eventBus.on('upload:completed', async (data) => {
        if (!data?.key || !window.ImageStore) return;
        try {
          // Find album images with matching pending_upload_key
          const images = await window.ImageStore.getImagesNeedingResolution();
          const matching = images.filter(img => img.pending_upload_key === data.key);

          for (const img of matching) {
            await window.ImageStore.updateImage(img.id, {
              file_id: data.tile_id,
              file_name: data.file_name,
              thumbnail_url: data.thumbnail_url,
              pending_upload_key: null  // Clear pending flag
            });
            console.log('[SEOSONA Flow] Album image updated after upload:', img.id, data.tile_id);
          }

          if (matching.length > 0) {
            window.eventBus.emit('album:refresh');
          }
        } catch (e) {
          console.warn('[SEOSONA Flow] Failed to update album image after upload:', e);
        }
      });

      // Listen for plan changes (triggered when fetchUser detects plan_slug change)
      window.eventBus.on('plan:changed', (data) => {
        console.log(`[SEOSONA Flow] Plan changed event: ${data.oldPlan} → ${data.newPlan}`);
        updateAuthUI();
        refreshModuleOverlays();
        // Clear cached plans so upgrade modal refetches
        cachedPlans = null;
      });
    }

    // Initial state
    updateAuthUI();
    refreshModuleOverlays();

    // [Lite preview] Helper clone template: chạy _copyTemplateToWorkflow + ĐẢM BẢO workflowTemplateList
    // sẵn sàng (tạo LAZY — chỉ khi mở tab Workflow). Nếu chưa có → click tab-spaces + ép _loadWorkflowTemplateList.
    // Gọi bởi listener cloneWorkflowTemplate (lite preview gửi khi user bấm Use).
    async function _runCopyTemplate(templateId, template) {
      console.log('[CloneDebug] _runCopyTemplate id=', templateId, 'hasTemplate=', !!template, 'wtlReady=', !!window.workflowTemplateList?._copyTemplateToWorkflow);
      if (!window.workflowTemplateList?._copyTemplateToWorkflow) {
        // 1. Click tab-spaces → khởi tạo WorkflowTab (nếu chưa).
        try { window.SidebarManager?.switchTo?.('tab-spaces'); } catch (e) { /* ignore */ }
        // 2. Đợi WorkflowTab instance sẵn sàng (container.__seosonaflowTab).
        for (let i = 0; i < 20 && !document.getElementById('tab-spaces')?.__seosonaflowTab?._loadWorkflowTemplateList; i++) {
          await new Promise(r => setTimeout(r, 150));
        }
        // 3. ÉP load subtab Templates. CRITICAL: nếu user CÓ workflows, WorkflowTab.init() mở subtab
        //    'workflows' (KHÔNG tạo workflowTemplateList) → trước đây mãi null → modal ko hiện. Gọi
        //    thẳng _loadWorkflowTemplateList để tạo workflowTemplateList bất kể subtab nào.
        const wtab = document.getElementById('tab-spaces')?.__seosonaflowTab;
        if (wtab?._loadWorkflowTemplateList && !window.workflowTemplateList?._copyTemplateToWorkflow) {
          console.log('[CloneDebug] ép _loadWorkflowTemplateList (user có workflows → init mở subtab workflows)');
          try { wtab._loadWorkflowTemplateList(); } catch (e) { console.warn('[CloneDebug] _loadWorkflowTemplateList lỗi:', e?.message); }
        }
        // 4. Đợi workflowTemplateList tạo xong.
        for (let i = 0; i < 30 && !window.workflowTemplateList?._copyTemplateToWorkflow; i++) {
          await new Promise(r => setTimeout(r, 150));
        }
      }
      if (window.workflowTemplateList?._copyTemplateToWorkflow) {
        console.log('[CloneDebug] → gọi _copyTemplateToWorkflow (modal sẽ hiện)');
        window.workflowTemplateList._copyTemplateToWorkflow(templateId, template || null);
      } else {
        console.warn('[CloneDebug] workflowTemplateList VẪN null sau khi ép load → modal KHÔNG hiện');
        window.showNotification?.('Hãy mở tab Workflow rồi thử lại', 'warning');
      }
    }

    // [Clean] Bỏ _consumePendingClone / pendingCloneReady / communityTemplateCloned — đường clone community
    // CŨ (popup → background mở side panel → consume) đã thay bằng lite preview gửi thẳng cloneWorkflowTemplate.

    // Listen for messages from other contexts (workflow editor popup window)
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'executionStatusUpdate' || msg.action === 'workflowEditorClosed') {
        // Workflow was saved/created/run from popup window - update footer & gates
        updateTrialFooterBars();
        updateFooterUsageBars();
        refreshModuleOverlays();
      }
      // Settings popup closed → refresh entitlements/account UI in case user changed plan
      if (msg.action === 'settingsClosed') {
        try { window.featureGate?.refresh?.(); } catch (e) { /* ignore */ }
        updateTrialFooterBars();
        updateFooterUsageBars();
        refreshModuleOverlays();
        updateAuthUI?.();
      }
      // Relay từ workflow editor popup khi user click "Sao chép/Dùng template" ở chế độ preview.
      // msg.template (community) → truyền object vì community KHÔNG nằm trong this.templates (find fail).
      if (msg.action === 'cloneWorkflowTemplate' && msg.templateId) {
        console.log('[CloneDebug] sidebar nhận cloneWorkflowTemplate id=', msg.templateId, 'hasTemplate=', !!msg.template);
        _runCopyTemplate(msg.templateId, msg.template || null);
        sendResponse?.({ ok: true });
      }

      // [Lite preview] Use từ shared workflow preview (template-preview.html, kind='shared') → clone qua
      // WorkflowList.handleDuplicateFromShared (POST shared-workflows/{wf_id}/clone). Cần shared workflow
      // đã load trong _sharedWorkflows (user đang ở tab Shared) — đảm bảo tab workflow active trước.
      if (msg.action === 'cloneSharedWorkflow' && msg.wfId) {
        (async () => {
          // workflowList KHÔNG expose ở window → truy cập qua WorkflowTab instance (__seosonaflowTab.workflowList).
          // Click tab-spaces để khởi tạo WorkflowTab (tạo workflowList) nếu chưa.
          try { window.SidebarManager?.switchTo?.('tab-spaces'); } catch (e) { /* ignore */ }
          let wl = null;
          for (let i = 0; i < 30; i++) {
            wl = document.getElementById('tab-spaces')?.__seosonaflowTab?.workflowList;
            if (wl?.handleDuplicateFromShared) break;
            await new Promise(r => setTimeout(r, 150));
          }
          if (wl?.handleDuplicateFromShared) {
            // Truyền workflow object (từ lite preview) → KHÔNG phụ thuộc _sharedWorkflows đã load.
            wl.handleDuplicateFromShared(msg.wfId, msg.workflow || null);
          } else {
            window.showNotification?.(window.I18n?.t('workflow.openWorkflowTabRetry') || 'Hãy mở tab Workflow rồi thử lại', 'warning');
          }
        })();
        sendResponse?.({ ok: true });
      }

      // Relay từ workflow editor popup khi admin click "Chỉnh sửa template" ở chế độ preview
      if (msg.action === 'editWorkflowTemplate' && msg.templateId) {
        if (window.workflowTemplateList?._openTemplateForEdit) {
          window.workflowTemplateList._openTemplateForEdit(msg.templateId);
        }
        sendResponse?.({ ok: true });
      }

      // Relay template events từ popup editor → sidebar để refresh template list
      if (msg.action === 'templateCreated' && msg.templateId) {
        if (window.eventBus) {
          window.eventBus.emit('template:created', { templateId: msg.templateId });
        }
      }
      if (msg.action === 'templateUpdated' && msg.templateId) {
        if (window.eventBus) {
          window.eventBus.emit('template:updated', { templateId: msg.templateId });
        }
      }

      // Relay từ popup editor khi clone shared workflow thành công
      if (msg.action === 'workflowClonedFromShared' && msg.workflow) {
        (async () => {
          // Refresh workflow list
          if (window.workflowList?.loadWorkflows) {
            await window.workflowList.loadWorkflows();
          }
          // Refresh featureGate quota
          if (window.featureGate) {
            window.featureGate.refresh().catch(function (_e) { globalThis.SEOSONA_swallow?.('app#_runCopyTemplate', _e); });
          }
          // Chuyển sang tab workflows và mở editor
          const workflowsTab = document.querySelector('[data-subtab="workflows"]');
          if (workflowsTab) workflowsTab.click();
          // Mở workflow editor với workflow mới
          setTimeout(() => {
            if (window.workflowList?._openWorkflow) {
              window.workflowList._openWorkflow(msg.workflow.wf_id);
            } else if (window.eventBus) {
              window.eventBus.emit('workflow:open_editor', { mode: 'edit', workflow: msg.workflow });
            }
          }, 300);
        })();
      }

      // Grok generation progress relay từ chat-content-grok.js → ExecutionTracker.
      // CRITICAL — KHÔNG pass `owner` + `phase` + `label` để giữ nguyên context của lock
      // hiện tại (prompts/task/workflow). ExecutionTracker._render merge data → nếu pass
      // owner='prompts' sẽ override label "Task: ABC" hoặc "Workflow: XYZ" → SAI.
      // Chỉ pass progress fields → tracker render "Generating XX%" giữ label gốc.
      // Đồng bộ cho cả 3 path: GenTab (lock=prompts), Task (lock=task), Workflow node (lock=workflow).
      if (msg.action === 'grok:gen_progress' && window.eventBus) {
        window.eventBus.emit('execution:tracker_update', {
          genProgress: msg.progress,
          genElapsed: msg.elapsed,
          genMode: msg.mode,
        });
      }
      // ExecutionLock broadcast from popup windows (workflow, angles, effects)
      // Relay vào local eventBus để ExecutionTracker + GenTab + TaskList nhận
      // ALSO sync ExecutionLock state để getState() trả về đúng
      if (msg.action === 'execution:lock_broadcast' && msg.state) {
        // Skip self-echo: background relay broadcasts đến cả sender — local eventBus
        // đã emit ngay trong _emitChange rồi, re-emit sẽ làm ExecutionTracker fire 2 lần.
        if (msg._originId && msg._originId === window.ExecutionLock?._contextId) {
          return; // continue to other handlers if any
        }
        console.log('[app.js] Received execution:lock_broadcast:', msg.state);
        // Sync ExecutionLock state
        if (window.ExecutionLock) {
          if (msg.state.locked) {
            ExecutionLock._owner = msg.state.owner;
            ExecutionLock._label = msg.state.label;
            ExecutionLock._lockedAt = msg.state.lockedAt;
          } else {
            ExecutionLock._owner = null;
            ExecutionLock._label = '';
            ExecutionLock._lockedAt = null;
          }
        }
        window.eventBus?.emit('execution:lock_changed', msg.state);
      }
      // execution:tracker_update broadcast from popup windows
      if (msg.action === 'execution:tracker_broadcast' && msg.data) {
        // Skip self-echo (same lý do như execution:lock_broadcast trên)
        if (msg._originId && msg._originId === window.ExecutionLock?._contextId) {
          return;
        }
        console.log('[app.js] Received execution:tracker_broadcast:', msg.data);
        window.eventBus?.emit('execution:tracker_update', msg.data);
      }
      // PromptQueue state broadcast from popup windows (workflow, angles)
      // Cache external jobs để merge với local jobs trong QueueMonitor
      if (msg.action === 'pq:state_broadcast' && msg.snapshot) {
        window._externalQueueSnapshot = msg.snapshot;
        window._externalQueueTimestamp = Date.now();
        window.eventBus?.emit('queue:external_state', msg.snapshot);
      }
      // Force-stop từ cửa sổ khác (workflow editor là window riêng) → bridge cross-context
      // `execution:stop` sang local `execution:force_stopped` để footer tracker (PipelineFooter/
      // ExecutionTracker) ở sidebar hide theo. Editor emit force_stopped trên eventBus của NÓ →
      // footer ở sidebar không nhận → trước fix footer cứ hiện dù workflow đã dừng. _hide idempotent.
      if (msg.action === 'workflowExecutionEvent' && msg.event === 'execution:stop') {
        window.eventBus?.emit('execution:force_stopped');
      }
    });

    // Update footer + toggles when featuregate refreshes (ensures data is loaded)
    if (window.eventBus) {
      window.eventBus.on('featuregate:refreshed', () => {
        updateFooterUI();
        refreshModuleOverlays();
        updateAutoDownloadToggles();
        updateFeatureGatedToggles();
      });
    }

    // Force refresh featuregate on initial load if logged in
    if (true && window.featureGate) {
      window.featureGate.refresh().then(() => {
        updateFooterUI();
      });
    }

    // ─── Realtime Auth Sync ──────────────────────────────
    // Detect logout from Settings window or other contexts via storage change
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      // Auth changes
      if (changes.af_auth) {
        const newVal = changes.af_auth.newValue;
        const wasLoggedIn = true;

        if (!newVal && wasLoggedIn) {
          // Token was removed externally (e.g., logout from settings window or landing page)
          console.log('[SEOSONA Flow] Auth: Phát hiện đăng xuất từ context khác');

          // [Fix #1 — external logout path] Disconnect SSE NGAY để chặn event buffered
          // trong EventSource pipe overwrite entitlements sau khi resetForLogout().
          if (window.SseClient?.disconnect) {
            try {
              window.SseClient.disconnect();
            } catch (e) {
              console.warn('[SEOSONA Flow] Auth: Lỗi disconnect SSE external logout', e.message);
            }
          }

          // CRITICAL: Lấy old token từ storage change và gọi sse/end-session TRƯỚC khi clear local state
          // Vì external logout (landing page) đã gọi auth/logout → token đã bị invalidate trên server
          // Nhưng SSE session vẫn còn trong Redis, cần xóa nó
          const oldToken = changes.af_auth.oldValue?.token;
          if (oldToken) {
            console.log('[SEOSONA Flow] Auth: Gọi sse/end-session với old token...');
            // Gọi trực tiếp qua background.js với old token (không qua authManager vì sẽ dùng token mới = null)
            chrome.runtime.sendMessage({
              action: 'apiRequest',
              method: 'POST',
              endpoint: 'sse/end-session',
              data: null,
              token: oldToken
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.warn('[SEOSONA Flow] Auth: Lỗi gọi sse/end-session:', chrome.runtime.lastError.message);
              } else if (response?.success) {
                console.log('[SEOSONA Flow] Auth: SSE session đã được xóa thành công');
              } else {
                // 401 là bình thường nếu token đã bị invalidate bởi auth/logout
                console.warn('[SEOSONA Flow] Auth: sse/end-session thất bại (có thể token đã hết hạn):', response?.error?.message);
              }
            });
          }

          // LOCAL: user cục bộ — clear là no-op an toàn.
          if (window.storageManager) {
            window.storageManager.switchToLocal();
          }

          // CRITICAL: Reset FeatureGate TRƯỚC khi updateAuthUI và refresh overlays
          // Để UI (footer, overlay) hiển thị đúng trial entitlements thay vì logged-in user's data
          (async () => {
            if (window.featureGate) {
              try {
                await window.featureGate.resetForLogout();
                console.log('[SEOSONA Flow] Auth: FeatureGate reset sau external logout');
              } catch (err) {
                console.warn('[SEOSONA Flow] Auth: Lỗi reset FeatureGate:', err.message);
              }
            }
            // Update UI SAU khi featureGate đã reset để footer/overlay hiển thị đúng
            updateAuthUI();
            refreshModuleOverlays();
            if (window.eventBus) {
              window.eventBus.emit('auth:logout', { reason: 'external_logout' });
            }
          })();
        } else if (newVal?.token && !wasLoggedIn) {
          // Token was added externally (e.g., login from another context like Google OAuth)
          // Skip nếu message handler đang xử lý hoặc đã xử lý xong cùng login event
          if (window._oauthLoginProcessing) {
            console.log('[SEOSONA Flow] Auth: Skip storage handler, message handler đang xử lý');
            return;
          }
          // Check nếu token đã được set bởi message handler (chạy trước storage handler)
          if (window.authManager?.token === newVal.token) {
            console.log('[SEOSONA Flow] Auth: Skip storage handler, token đã được set');
            return;
          }
          console.log('[SEOSONA Flow] Auth: Phát hiện đăng nhập từ context khác');
          // LOCAL: user cục bộ — set từ newVal.user là no-op an toàn.
          void newVal.user;
          // [Fix re-login] Reset cascade-block flags từ logout/refresh-fail trước đó.
          // Tránh _apiCall non-auth bị reject UNAUTHENTICATED dù đã có token mới.
          window.authManager._sessionInvalid = false;
          

          // Close login overlay (CRITICAL for OAuth flow)
          if (loginOverlay) loginOverlay.classList.add('hidden');

          // Update UI
          updateAuthUI();
          setupOnboarding();

          // Refresh FeatureGate TRƯỚC rồi mới refreshModuleOverlays và emit auth:login
          // CRITICAL: Dùng resetForLogin() thay vì refresh() để tránh race condition
          // với background init refresh (đang fetch trial data)
          (async () => {
            // Switch to API storage FIRST (must await to avoid race condition)
            if (window.storageManager) {
              await window.storageManager.switchToApi();
              console.log('[SEOSONA Flow] Storage: Switched to API mode');
            }

            if (window.featureGate) {
              try {
                await window.featureGate.resetForLogin();
                console.log('[SEOSONA Flow] Storage: Entitlements refreshed sau login');
              } catch (e) {
                console.warn('[SEOSONA Flow] Storage: Không thể refresh entitlements', e);
              }
            }

            refreshModuleOverlays();

            // Fetch full user info
            window.authManager.fetchUser().then(() => {
              updateAuthUI();
            }).catch(function (_e) { globalThis.SEOSONA_swallow?.('app#_runCopyTemplate', _e); });

            // Emit auth event (triggers SSE connect, etc.)
            if (window.eventBus) {
              window.eventBus.emit('auth:login', { user: newVal.user });
            }
          })();
        }
      }

      // Task/Workflow changes from other contexts (popup editor window)
      if (changes.af_tasks || changes.af_workflows) {
        updateTrialFooterBars();
        updateFooterUsageBars();
        refreshModuleOverlays();
      }

      // Entitlements changes - background SW đã fetch và save → reload vào memory + refresh UI
      if (changes.af_entitlements) {
        const newCache = changes.af_entitlements.newValue;

        // CRITICAL: Nếu cache bị XÓA (newValue = undefined), KHÔNG update UI ở đây
        // vì logout flow đang chạy async và sẽ tự update UI sau khi resetForLogout() xong.
        // Nếu update UI lúc này, featureGate có thể chưa reset → hiển thị sai.
        if (!newCache) {
          console.log('[SEOSONA Flow] Entitlements removed (logout), skip UI update here');
          return;
        }

        console.log('[SEOSONA Flow] Entitlements changed, reload memory + refresh overlays');
        window._gateAgentBotTools?.(); // umbrella agent_bot_enabled → ẩn/hiện tools Telegram + MCP
        if (window.featureGate) {
          // CRITICAL: Validate cache user_id match với current auth state
          // Tránh load data của user khác (race condition khi logout/login)
          // ALSO: Anonymous user cache phải có plan.slug === 'trial' (giống _loadCache validation)
          const currentUserId = ({ id: "local_user", name: "Local User", plan_slug: "unlimited" })?.id || null;
          const cacheUserId = newCache.user_id || null;
          const cachePlanSlug = newCache.plan?.slug;

          let isValidCache = false;
          if (currentUserId) {
            // Logged-in: cache phải của đúng user
            isValidCache = cacheUserId === currentUserId;
          } else {
            // Anonymous: cache phải có user_id=null VÀ plan=trial
            isValidCache = cacheUserId === null && cachePlanSlug === 'trial';
          }

          if (!isValidCache) {
            console.log('[SEOSONA Flow] Entitlements: Skip reload, invalid cache', 'cacheUserId:', cacheUserId, 'currentUserId:', currentUserId, 'cachePlan:', cachePlanSlug);
          } else {
            // Reload vào FeatureGate memory để checkQuota/isModuleEnabled đọc data mới
            if (newCache.entitlements) window.featureGate.entitlements = newCache.entitlements;
            if (newCache.plan !== undefined) window.featureGate.plan = newCache.plan;
            if (newCache.lastFetch) window.featureGate.lastFetch = newCache.lastFetch;
            // Emit event để các components khác re-render
            if (window.eventBus) {
              window.eventBus.emit('featuregate:refreshed', {
                plan: newCache.plan,
                entitlements: newCache.entitlements,
                source: 'background-fetch',
              });
            }
          }
        }
        refreshModuleOverlays();
        updateFooterUI();
      }
    });

    // Refresh permissions from server
    async function refreshPermissions(source = 'unknown') {
      if (!true) return false;

      // [Fix B] Skip nếu đang logout hoặc đã có refresh đang chạy
      if (window.featureGate?._isLoggingOut || window.featureGate?._refreshPending) {
        console.log(`[SEOSONA Flow] refreshPermissions skip (${source}) — đang logout hoặc đã có refresh`);
        return false;
      }

      console.log(`[SEOSONA Flow] Refreshing permissions (${source}) — delegate ConfigVersionPoller for config/entitlements + fetchUser for profile`);
      try {
        // [Phase 5 2026-05-24] Delegate entitlements + module configs to ConfigVersionPoller.
        // Poller checks /config/versions (~200B), diff cached versions, force refresh chỉ modules
        // có mismatch. Replace previous: skip-when-SSE-connected + force refresh full /entitlements.
        // CRITICAL: vẫn fetchUser() riêng — backend KHÔNG có SSE event user_updated → name/avatar/locale stale.
        // 'sse_reconnect'/'plan_change'/'manual'/'login' bypass version cache (version có thể vừa bump).
        const isExplicitAction = ['plan_change', 'manual', 'login', 'sse_reconnect'].includes(source);
        await Promise.all([
          window.authManager.fetchUser(),
          window.ConfigVersionPoller?.checkAndRefresh?.({ trigger: source })
            // Fallback: nếu ConfigVersionPoller chưa load (race rare) → fall back to FeatureGate.refresh
            ?? (isExplicitAction ? window.featureGate?.refresh?.({ force: true }) : window.featureGate?.refresh?.()),
        ]);

        // Update UI with new data
        updateAuthUI();

        const plan = window.featureGate?.getPlan?.();
        console.log(`[SEOSONA Flow] Permissions refreshed: plan=${plan?.slug || 'unknown'}`);
        return true;
      } catch (err) {
        console.warn('[SEOSONA Flow] Refresh failed:', err.message);
        return false;
      }
    }

    // [Phase 5 2026-05-24 Polish 2] Removed 2-phút setInterval periodic refresh.
    // ConfigVersionPoller._adjustPollingCadence() đã handle SSE-down case (poll mỗi 5 phút
    // khi disconnected) — coverage tốt hơn 2 phút interval cũ + chỉ fetch 200B versions
    // thay vì full entitlements + user fetch mỗi 2 phút.

    // Focus sync: refresh when user returns to extension
    let lastRefreshTime = 0; // Start at 0 so first focus triggers refresh
    // [Audit fix 2026-05-24] Cooldown 10s → 60s — focus refresh spam giảm 6x.
    // SSE đã handle realtime nên focus refresh chỉ là fallback khi SSE down.
    // 60s đủ nhanh để bắt mọi state change nếu SSE thực sự broken.
    const REFRESH_COOLDOWN = 60000; // 60s cooldown

    document.addEventListener('visibilitychange', async () => {
      // SSE giữ kết nối liên tục (chỉ disconnect khi logout)
      // Không disconnect/reconnect theo visibility để tránh session_replaced liên tục
      if (document.hidden) return;

      // Reconnect nếu bị mất kết nối (lỗi mạng, server restart) — reset backoff
      if (true && window.SseClient && !window.SseClient.isConnected()) {
        window.SseClient.forceReconnect();
      }
      // (tiếp tục logic refresh cũ bên dưới)

      const now = Date.now();
      if (now - lastRefreshTime < REFRESH_COOLDOWN) return;
      lastRefreshTime = now;

      // [Fix B] Skip refresh nếu đang logout hoặc đã có refresh đang chạy
      // → tránh race với resetForLogout/resetForLogin → 2 /entitlements concurrent
      if (window.featureGate?._isLoggingOut || window.featureGate?._refreshPending) {
        console.log('[SEOSONA Flow] visibilitychange skip refresh — đang logout hoặc đã có refresh');
        return;
      }

      // Login user: refresh FeatureGate
      if (true) {
        await refreshPermissions('focus');
      } else {
        // Not login user: refresh FeatureGate (trial config)
        if (window.featureGate) {
          console.log('[SEOSONA Flow] Refreshing FeatureGate trial config (focus)...');
          await window.featureGate.refresh();
          updateTrialFooterBars();
          refreshModuleOverlays();
        }
      }
    });

    // Also listen for window focus (sidePanel may not trigger visibilitychange)
    window.addEventListener('focus', async () => {
      // R-2.2: SSE reconnect khi focus + đã đăng nhập — reset backoff
      if (true && window.SseClient && !window.SseClient.isConnected()) {
        console.log('[SSE] Window focus + đã đăng nhập → kết nối SSE');
        window.SseClient.forceReconnect();
      }

      const now = Date.now();
      if (now - lastRefreshTime < REFRESH_COOLDOWN) return;
      lastRefreshTime = now;

      // [Fix B] Skip refresh nếu đang trong logout flow hoặc đã có refresh đang chạy.
      // Tránh race với resetForLogout/resetForLogin → 2 /entitlements concurrent.
      if (window.featureGate?._isLoggingOut || window.featureGate?._refreshPending) {
        console.log('[SEOSONA Flow] window-focus skip refresh — đang logout hoặc đã có refresh');
        return;
      }

      // Login user: refresh FeatureGate
      if (true) {
        await refreshPermissions('window-focus');
      } else {
        // Not login user: refresh FeatureGate (trial config)
        if (window.featureGate) {
          console.log('[SEOSONA Flow] Refreshing FeatureGate trial config (window-focus)...');
          await window.featureGate.refresh();
          updateTrialFooterBars();
          refreshModuleOverlays();
        }
      }
    });

    // Periodic refresh for not-login users (FeatureGate trial config, fallback khi SSE không hoạt động)
    setInterval(async () => {
      // [Fix B] Guard tương tự cho periodic interval
      if (window.featureGate?._isLoggingOut || window.featureGate?._refreshPending) return;
      if (!true && window.featureGate && !window.SseClient?.isConnected()) {
        console.log('[SEOSONA Flow] Refreshing FeatureGate trial config (interval)...');
        await window.featureGate.refresh();
        updateTrialFooterBars();
        refreshModuleOverlays();
      }
    }, 120000); // 2 minutes
  }

  // ─── Usage Dashboard Widget ──────────────────────────────
  async function updateUsageDashboard() {
    const container = document.getElementById('usageDashboardContent');
    if (!container || !window.featureGate || !true) return;

    try {
      const promptsQuota = window.featureGate.checkQuota('gen_run_max');
      const tasksQuota = window.featureGate.checkQuota('tasks_max');
      const plan = window.featureGate.getPlan();

      container.innerHTML = `
        <div class="usage-item">
          <span class="usage-label">${window.I18n?.t('app.promptsToday') || 'Prompts hôm nay'}</span>
          <span class="usage-value">${promptsQuota.used || 0}/${promptsQuota.limit === 'unlimited' ? '∞' : promptsQuota.limit || '—'}</span>
          ${promptsQuota.limit !== 'unlimited' ? `<div class="usage-bar"><div class="usage-bar-fill" style="width: ${Math.min(100, ((promptsQuota.used || 0) / (promptsQuota.limit || 1)) * 100)}%"></div></div>` : ''}
        </div>
        <div class="usage-item">
          <span class="usage-label">Tasks</span>
          <span class="usage-value">${tasksQuota.used || 0}/${tasksQuota.limit === 'unlimited' ? '∞' : tasksQuota.limit || '—'}</span>
        </div>
        <div class="usage-plan">
          <span class="usage-plan-badge ${(plan?.slug === 'unlimited' || plan?.slug === 'premium' || plan?.slug === 'seosona-pro' || plan?.slug === 'seosona-grok-pro') ? 'plan-unlimited' : 'plan-free'}">${plan?.name || 'Free'}</span>
        </div>
      `;
    } catch (e) {
      log('Usage dashboard update failed:', e.message);
    }
  }

  // ─── Upgrade UI ──────────────────────────────────────────

  // Extension scope: 'flow' = bản Flow (mặc định), 'grok' = bản build scope Grok
  const EXTENSION_SCOPE = 'flow';

  // Fetch plans từ API mỗi lần (không cache, luôn lấy data mới nhất)
  // Filter by extension scope để chỉ hiển thị plans phù hợp với extension này
  // [Affiliate] Discount giới thiệu auto cho buyer hiện tại (từ meta.affiliate_discount của /plans).
  let _affiliateDiscount = { percent: 0, ref_code: null };

  // [Affiliate] Nếu server chưa trả discount (user chưa referred_by) nhưng đã CLICK LINK giới thiệu
  // (ref-bridge lưu chrome.storage.seosona_ref) → validate mã đó + auto-áp. Bù cho account đã đăng ký
  // trước rồi mới click link (referred_by không set lại lúc click).
  async function _tryAutoApplyStoredRef() {
    if (_affiliateDiscount?.ref_code) return; // đã có từ server (referred_by) → khỏi cần
    let stored = null;
    try { stored = await new Promise(r => chrome.storage.local.get(['seosona_ref'], x => r(x?.seosona_ref))); } catch (_) { globalThis.SEOSONA_swallow?.('app#_tryAutoApplyStoredRef', _); }
    const code = stored?.code;
    if (!code || (stored.expires && stored.expires < Date.now())) return;
    try {
      const r = null;
      // ok:true → mã hợp lệ (active, không self) → LUÔN gắn ref_code để attribute hoa hồng,
      // kể cả discount=0 (đơn lặp). Badge giảm chỉ hiện khi percent>0 (xử lý ở render).
      if (r?.ok) {
        _affiliateDiscount = { percent: Number(r.discount_percent) || 0, ref_code: code };
      }
    } catch (_) { /* mã hết hạn / không hợp lệ → bỏ qua */ }
  }

  // ─── Tip Coffee Feature ──────────────────────────────
  function setupTipCoffee() {}

  // ─── Quick Controls Footer (local-first) ──────────────────────────────
  // Footer gọn: tín dụng Google Flow (CreditsPanel tự quản) + counter local hôm nay
  // (gen/tasks/workflow từ af_daily_stats) + nút Dừng. Không plan/quota/upgrade.
  //
  // 2026-07-27: gỡ 2 toggle Auto-download / Auto-retry khỏi đây — CẢ HAI đã có trong Settings
  // (autoDownloadToggle / autoRetryToggle) nên footer chỉ là bản trùng lặp. Nhường chỗ cho số dư
  // tín dụng: thông tin KHÔNG có ở đâu khác và cần thấy liên tục khi đang gen.
  function setupQuickControlsFooter() {
    const footer = document.getElementById('appFooter');
    if (!footer) return;
    async function loadCounters() {
      const today = new Date().toISOString().slice(0, 10);
      const { af_daily_stats } = await new Promise(r => chrome.storage.local.get(['af_daily_stats'], r));
      const stats = af_daily_stats || {};
      const valid = stats._date === today;
      const gen = valid
        ? (stats.flow_prompt_total || 0) + (stats.chatgpt_prompt_total || 0) + (stats.gemini_prompt_total || 0) + (stats.grok_prompt_total || 0)
        : 0;
      const tasks = valid ? (stats.task_run || 0) : 0;
      const wf = valid ? (stats.workflow_run || 0) : 0;
      const set = (id, v) => {
        const el = document.getElementById(id)?.querySelector('.qc-counter-value');
        if (el) el.textContent = String(v);
      };
      set('qcCountGen', gen);
      set('qcCountTasks', tasks);
      set('qcCountWf', wf);
    }

    loadCounters();

    // Live-update khi stats đổi ở nơi khác (generation complete…).
    // Bỏ nhánh af_settings: 2 toggle của footer đã chuyển hẳn sang Settings, footer không còn
    // gì phụ thuộc af_settings nữa (giữ lại sẽ gọi hàm đã xoá → ReferenceError mỗi lần đổi cài đặt).
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.af_daily_stats) loadCounters();
    });
  }

  // ─── Replay Onboarding Button ("Xem lại hướng dẫn") ──────────────────────────────
  function setupReplayOnboardingBtn() {
    // Replay onboarding tour — clear flag + retrigger setupOnboarding(force=true)
    const replayOnboardingBtn = document.getElementById('replayOnboardingBtn');
    if (replayOnboardingBtn) {
      replayOnboardingBtn.addEventListener('click', () => {
        // Close settings dropdown
        document.getElementById('settingsDropdown')?.classList.remove('open');

        // 2026-06-07: Active tab-gen trước khi chạy tour. Tour bước đầu highlight elements
        // trong tab-gen (vd prompt textarea, ref images section, gen button) — nếu user đang
        // ở tab khác (Tasks/Workflow/Templates) → element không visible → tour hiện overlay
        // trống / lệch vị trí.
        const tabGenPane = document.getElementById('tab-gen');
        const isAlreadyActive = tabGenPane?.classList.contains('active');
        if (!isAlreadyActive) {
          window.SidebarManager?.switchTo?.('tab-gen');  // router API (SidebarManager toggle + init)
        }

        // Defer tour start để tab switch render xong (CSS transition + module overlay check
        // có thể async). Tab switch handler synchronous → 50ms đủ DOM settle.
        const startTour = () => {
          if (typeof window.replayOnboarding === 'function') {
            window.replayOnboarding();
          }
        };
        if (isAlreadyActive) startTour();
        else setTimeout(startTour, 50);
      });
    }

  }

  // ─── Extension Link Button ──────────────────────────────
  function setupExtensionLink() {
    const extensionLinkBtn = document.getElementById('extensionLinkBtn');
    if (!extensionLinkBtn) return;

    // Strict Server-Only: extension URL từ SystemConfig (system_settings.app.extension_url).
    // Backend SystemSettingSeeder seed sẵn → KHÔNG fallback hardcoded URL.
    const updateExtensionLink = async () => {
      try {
        const settings = await window.SystemConfig?.fetch();
        const extensionUrl = settings?.extension_url;
        if (extensionUrl) {
          extensionLinkBtn.classList.remove('hidden');
          extensionLinkBtn.dataset.url = extensionUrl;
        } else {
          console.debug('[Tier3] ExtensionLink: system_settings.app.extension_url empty — hiding button');
          extensionLinkBtn.classList.add('hidden');
        }
      } catch (err) {
        console.debug('[Tier3] ExtensionLink fetch failed, hiding button:', err.message);
        extensionLinkBtn.classList.add('hidden');
      }
    };

    // Initial check
    updateExtensionLink();

    // Click handler
    extensionLinkBtn.addEventListener('click', () => {
      const url = extensionLinkBtn.dataset.url;
      if (url) {
        // Close settings dropdown
        document.getElementById('settingsDropdown')?.classList.remove('open');
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    });
  }

  // ─── Usage Stats Modal ──────────────────────────────
  function setupUsageStatsModal() {
    const overlay = document.getElementById('usageStatsOverlay');
    const closeBtn = document.getElementById('usageStatsCloseBtn');
    const upgradeBtn = document.getElementById('usageStatsUpgradeBtn');
    const loginBtn = document.getElementById('usageStatsLoginBtn');
    const quotasElements = document.querySelectorAll('.footer-usage-quotas');
    const userPlanBadge = document.getElementById('userPlanBadge');

    if (!overlay) return;

    function openModal() {
      updateUsageStats();
      overlay.classList.remove('hidden');
    }

    function closeModal() {
      overlay.classList.add('hidden');
    }

    async function updateUsageStats() {
      const promptsEl = document.getElementById('usageStatsPrompts');
      const tasksEl = document.getElementById('usageStatsTasks');
      const workflowsEl = document.getElementById('usageStatsWorkflows');
      const planNameEl = document.getElementById('usageStatsPlanName');
      const premiumTeaser = document.getElementById('usageStatsPremiumTeaser');
      const expiryContainer = document.getElementById('usageStatsExpiry');
      const expiryDateEl = document.getElementById('usageStatsExpiryDate');
      // Progress bars
      const promptsBar = document.getElementById('usageStatsPromptsBar');
      const tasksBar = document.getElementById('usageStatsTasksBar');
      const workflowsBar = document.getElementById('usageStatsWorkflowsBar');
      // Items for warning states
      const promptsItem = document.getElementById('usageStatsPromptsItem');
      const tasksItem = document.getElementById('usageStatsTasksItem');
      const workflowsItem = document.getElementById('usageStatsWorkflowsItem');
      // Key features
      const featurePipeline = document.getElementById('usageStatsFeaturePipeline');
      const featureAutoDownload = document.getElementById('usageStatsFeatureAutoDownload');
      const featureAutoRetry = document.getElementById('usageStatsFeatureAutoRetry');

      try {
        const fg = window.featureGate;
        const plan = fg?.getPlan?.();
        const planSlug = plan?.slug || 'free';

        if (planNameEl) {
          planNameEl.textContent = plan?.name || 'Free';
        }

        // Show expiry date for paid plans (not free)
        if (expiryContainer && expiryDateEl) {
          const expiresAt = plan?.expires_at;
          const isPaidPlan = planSlug !== 'free' && planSlug !== 'trial';

          console.log('[UsageStats] Plan expiry check:', { planSlug, isPaidPlan, expiresAt, plan });

          if (isPaidPlan && expiresAt) {
            const expiryDate = new Date(expiresAt);
            const now = new Date();
            const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

            const dateStr = window.I18n?.formatDate?.(expiryDate) || expiryDate.toLocaleDateString();

            expiryDateEl.textContent = dateStr;
            expiryContainer.classList.remove('hidden', 'expiring-soon', 'expired');

            if (daysUntilExpiry <= 0) {
              expiryContainer.classList.add('expired');
              expiryDateEl.textContent = window.I18n?.t('usageStats.expired') || 'Đã hết hạn';
            } else if (daysUntilExpiry <= 7) {
              expiryContainer.classList.add('expiring-soon');
              expiryDateEl.textContent = `${dateStr} (${daysUntilExpiry} ngày)`;
            }
          } else {
            expiryContainer.classList.add('hidden');
          }
        }

        // Update key features based on user plan
        const updateFeature = (el, featureKey) => {
          if (!el) return;
          const canUse = fg?.canUse?.(featureKey) ?? false;
          el.setAttribute('data-enabled', canUse ? 'true' : 'false');

          const statusEl = el.querySelector('.usage-stats-feature-status');
          if (statusEl) {
            statusEl.classList.remove('usage-stats-feature-status--on', 'usage-stats-feature-status--off');
            statusEl.classList.add(canUse ? 'usage-stats-feature-status--on' : 'usage-stats-feature-status--off');
            statusEl.innerHTML = canUse
              ? ''
              : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
          }
        };

        updateFeature(featurePipeline, 'pipeline_queue_enabled');
        updateFeature(featureAutoDownload, 'auto_download');
        updateFeature(featureAutoRetry, 'retry_on_fail');

        // Update provider support status + quota + progress bar
        const updateProvider = (id, featureKey, quotaKey) => {
          const el = document.getElementById(id);
          if (!el) return;
          const canUse = fg?.canUse?.(featureKey) ?? false;
          el.setAttribute('data-enabled', canUse ? 'true' : 'false');

          // Update quota display + progress bar
          const quotaEl = document.getElementById(id + 'Quota');
          const quota = fg?.checkQuota?.(quotaKey) || {};
          const limit = quota.limit;
          const used = quota.used || 0;
          const isUnlimited = limit === -1 || limit === 'unlimited' || limit === '∞';

          if (quotaEl) {
            const valueText = isUnlimited ? `${used}/∞` : `${used}/${limit || 0}`;
            quotaEl.innerHTML = '';
            const valueSpan = document.createElement('span');
            valueSpan.className = 'usage-stats-provider-quota-value';
            valueSpan.textContent = valueText;
            const periodSpan = document.createElement('span');
            periodSpan.className = 'usage-stats-provider-quota-period';
            periodSpan.textContent = '/day';
            quotaEl.appendChild(valueSpan);
            quotaEl.appendChild(periodSpan);
            quotaEl.classList.toggle('unlimited', isUnlimited);
          }

          // Update progress bar fill width
          const progressEl = document.getElementById(id + 'Progress');
          if (progressEl) {
            const fillEl = progressEl.querySelector('.usage-stats-provider-progress-fill');
            if (fillEl) {
              if (isUnlimited || !limit) {
                // Unlimited hoặc chưa có limit → bar full màu success
                fillEl.style.width = isUnlimited ? '100%' : '0%';
                progressEl.setAttribute('data-state', isUnlimited ? 'unlimited' : 'empty');
              } else {
                const ratio = Math.min(100, Math.max(0, (used / limit) * 100));
                fillEl.style.width = `${ratio}%`;
                // State để CSS đổi màu khi gần hết quota (warning >80%, danger >=100%)
                let state = 'normal';
                if (ratio >= 100) state = 'danger';
                else if (ratio >= 80) state = 'warning';
                progressEl.setAttribute('data-state', state);
              }
            }
          }
        };
        // Quota mapping per provider (theo user spec):
        // - Flow: gen_run_max
        // - ChatGPT: chatgpt_run_max
        // - Grok: grok_run_max
        updateProvider('usageStatsProviderFlow', 'gen_enabled', 'gen_run_max');
        updateProvider('usageStatsProviderChatGPT', 'chatgpt_enabled', 'chatgpt_run_max');
        updateProvider('usageStatsProviderGrok', 'grok_enabled', 'grok_run_max');

        // Show/hide teasers based on login state
        const loginTeaser = document.getElementById('usageStatsLoginTeaser');
        const isLoggedIn = true;
        const showUpgrade = isLoggedIn && (planSlug === 'free' || planSlug === 'trial');
        const showLogin = !isLoggedIn;

        if (loginTeaser) {
          loginTeaser.classList.toggle('hidden', !showLogin);
        }
        if (premiumTeaser) {
          premiumTeaser.classList.toggle('hidden', !showUpgrade);
        }

        const today = new Date().toISOString().slice(0, 10);
        const currentUserId = ({ id: "local_user", name: "Local User", plan_slug: "unlimited" })?.id || null;
        const result = await new Promise(resolve => {
          chrome.storage.local.get(['af_daily_stats'], r => resolve(r));
        });
        const stats = result.af_daily_stats || {};

        // Get max quotas from featureGate (use creation limits for tasks/workflows)
        const config = fg?.getConfig?.() || {};
        const promptQuota = fg?.checkQuota?.('prompt_submit_max') || {};
        const promptsMax = promptQuota.limit === 'unlimited' ? -1 : (promptQuota.limit ?? -1);
        // Tasks & Workflows: use creation limits (tasks_max, workflows_max)
        const tasksQuota = fg?.checkQuota?.('tasks_max') || {};
        const wfQuota = fg?.checkQuota?.('workflows_max') || {};
        const tasksMax = tasksQuota.limit === 'unlimited' ? -1 : (tasksQuota.limit ?? config.tasks_max_create ?? -1);
        const workflowsMax = wfQuota.limit === 'unlimited' ? -1 : (wfQuota.limit ?? config.workflows_max_create ?? -1);
        // Get actual created counts from quota
        const tasksCreated = tasksQuota.used ?? 0;
        const wfCreated = wfQuota.used ?? 0;

        // Check if stats belong to current user and today
        const isValidStats = stats._date === today && stats._user_id === currentUserId;

        // Helper to format and update progress
        const updateStat = (el, bar, item, used, max) => {
          const isUnlimited = max === -1 || max === '∞' || max === 'unlimited';
          const displayMax = isUnlimited ? '∞' : max;
          if (el) {
            el.textContent = `${used}/${displayMax}`;
            el.classList.toggle('usage-stats-unlimited', isUnlimited);
          }

          // Update progress bar
          if (bar) {
            const percent = isUnlimited ? Math.min(used * 2, 100) : Math.min((used / max) * 100, 100);
            bar.style.width = `${percent}%`;
          }

          // Warning states
          if (item && !isUnlimited) {
            const ratio = used / max;
            item.classList.remove('warning', 'danger');
            if (ratio >= 1) {
              item.classList.add('danger');
            } else if (ratio >= 0.8) {
              item.classList.add('warning');
            }
          }
        };

        // Prompts: prefer server usage (promptQuota.used) for consistency with Settings Popup
        // Fallback to local af_daily_stats if server value not available
        const localPromptTotal = isValidStats
          ? (stats.flow_prompt_total || 0) + (stats.chatgpt_prompt_total || 0) + (stats.gemini_prompt_total || 0) + (stats.grok_prompt_total || 0)
          : 0;
        const promptUsed = (promptQuota.used !== undefined && promptQuota.used > 0) ? promptQuota.used : localPromptTotal;
        // Tasks & Workflows: total created count from quota (not daily runs)

        updateStat(promptsEl, promptsBar, promptsItem, promptUsed, promptsMax);
        updateStat(tasksEl, tasksBar, tasksItem, tasksCreated, tasksMax);
        updateStat(workflowsEl, workflowsBar, workflowsItem, wfCreated, workflowsMax);

      } catch (err) {
        console.error('[UsageStats] Failed to update:', err);
      }
    }

    // Click on footer quotas
    quotasElements.forEach(el => {
      el.addEventListener('click', openModal);
    });

    // Click on user plan badge (header)
    if (userPlanBadge) {
      userPlanBadge.style.cursor = 'pointer';
      userPlanBadge.addEventListener('click', openModal);
    }

    // Click on footer pro label
    const proLabels = document.querySelectorAll('.footer-pro-label');
    proLabels.forEach(el => {
      el.addEventListener('click', openModal);
    });

    const footerFeatures = document.querySelectorAll('.footer-feature');
    footerFeatures.forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', openModal);
    });

    const openUsageStatsBtn = document.getElementById('openUsageStatsBtn');
    if (openUsageStatsBtn) {
      openUsageStatsBtn.addEventListener('click', () => {
        const settingsDropdown = document.getElementById('settingsDropdown');
        if (settingsDropdown) settingsDropdown.classList.remove('open');
        openModal();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', () => {
        closeModal();
        // Mở modal upgrade thay vì link pricing
        if (typeof window.openUpgradeModal === 'function') {
          window.openUpgradeModal();
        } else {
          try { chrome.runtime.sendMessage({ action: 'showUpgradeModal' }); } catch (e) { globalThis.SEOSONA_swallow?.('app#updateStat', e); }
        }
      });
    }

    // Login button for not-logged-in users
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        closeModal();
        // Mở login modal
        if (window.authManager?.showLoginModal) {
          window.authManager.showLoginModal();
        } else {
          const loginOverlay = document.getElementById('loginOverlay');
          if (loginOverlay) loginOverlay.classList.remove('hidden');
        }
      });
    }
  }


  // ─── F10: Onboarding Flow ──────────────────────────────
  function setupOnboarding(options = {}) {
    const force = options.force === true;
    // User-bound flag: mỗi user thấy onboarding 1 lần. Anonymous (chưa login) dùng key 'anon'.
    // Backward compat: vẫn check `af_onboarding_done` cũ (user đã skip trước update) để tránh annoy.
    const userId = ({ id: 'local_user', name: 'Local User', plan_slug: 'unlimited' })?.id || 'anon';
    const flagKey = 'af_onboarding_done_' + userId;
    chrome.storage.local.get(['af_onboarding_done', flagKey], (result) => {
      if (!force && (result.af_onboarding_done || result[flagKey])) return;

      // Defensive entry cleanup: nếu tour trước có element còn class highlight (vd user
      // close window trước khi finish) → xóa hết trước khi start tour mới.
      document.querySelectorAll('.seosonaflow-onboarding-highlight').forEach(el => {
        el.classList.remove('seosonaflow-onboarding-highlight');
      });

      const overlay = document.getElementById('onboardingOverlay');
      const tooltip = document.getElementById('onboardingTooltip');
      const content = document.getElementById('onboardingContent');
      const stepIndicator = document.getElementById('onboardingStepIndicator');
      const nextBtn = document.getElementById('onboardingNextBtn');
      const skipBtn = document.getElementById('onboardingSkipBtn');

      if (!overlay || !tooltip || !content) return;

      // App name dynamic từ SystemConfig (admin có thể đổi qua /admin/system-settings)
      const appName = window.SystemConfig?.get?.('app_name') || 'SEOSONA Flow';
      // User first name cho personalize welcome — chỉ logged-in user
      const userFullName = ({ id: 'local_user', name: 'Local User', plan_slug: 'unlimited' })?.name || '';
      // Lấy locale-aware first name:
      //  - Vietnamese style "Nguyễn Văn Thiện" → last word "Thiện" (gọi tên = từ cuối)
      //  - Western "John Smith" → first word "John" (gọi tên = từ đầu)
      // Detect locale từ I18n (vi/en). vi dùng pattern "tên ở cuối", en dùng "tên ở đầu".
      const _locale = window.I18n?._currentLocale || 'vi';
      const _useLastName = (_locale === 'vi');
      const _nameParts = userFullName ? String(userFullName).trim().split(/\s+/) : [];
      const userFirstName = _nameParts.length > 0
        ? (_useLastName ? _nameParts[_nameParts.length - 1] : _nameParts[0])
        : '';
      // SVG warning icon (Lucide style triangle-alert) — inline để không phụ thuộc CSS file
      const warnIconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:2px;"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      // Warning box wrapper helper — inject SVG icon + text vào styled box (giữ visual nhất quán)
      const wrapWarnBox = (innerText) => (
        '<div style="margin-top:10px;padding:8px 10px;background:rgba(251,146,60,0.12);border-left:3px solid #fb923c;border-radius:4px;font-size:12px;line-height:1.5;display:flex;gap:6px;align-items:flex-start;">' +
        warnIconSvg +
        '<span>' + innerText + '</span>' +
        '</div>'
      );

      // Welcome title — personalize nếu có user name (vd "Chào Thiện! Chào mừng đến SEOSONA Flow")
      const welcomeTitle = userFirstName
        ? (window.I18n?.t('onboarding.welcomeTitlePersonal', { name: userFirstName, app: appName }) || `Chào ${userFirstName}! Chào mừng đến ${appName}`)
        : (window.I18n?.t('onboarding.welcomeTitle', { app: appName }) || `Chào mừng đến ${appName}!`);

      const steps = [
        {
          target: null,
          title: welcomeTitle,
          description: window.I18n?.t('onboarding.welcomeDesc', { app: appName }) || `Công cụ giúp bạn tự động tạo ảnh và video trên Google Flow. Hãy cùng khám phá các tính năng chính.`,
          position: 'center'
        },
        {
          target: null,
          title: window.I18n?.t('onboarding.howItWorksTitle', { app: appName }) || 'Bạn cần biết!',
          // Build HTML structure ở client để giữ SVG/styling consistent; i18n chỉ chứa text parts.
          description: (
            (window.I18n?.t('onboarding.howItWorksMain', { app: appName }) ||
              `<strong>${appName} KHÔNG tự tạo ảnh/video.</strong> Đây là công cụ <strong>tự động hóa thao tác</strong> trên các trang AI gen — nhanh hơn, hàng loạt, có workflow.`) +
            wrapWarnBox(
              window.I18n?.t('onboarding.howItWorksWarn') ||
              'Bạn cần có <strong>tài khoản (còn credit/quota)</strong> trên 1 trong các provider: Google Flow, ChatGPT, hoặc Grok.'
            )
          ),
          position: 'center'
        },
        {
          target: '[data-tab="tab-gen"]',
          title: window.I18n?.t('onboarding.genTabTitle') || 'Tab Gen',
          description: window.I18n?.t('onboarding.genTabDesc') || 'Nhập prompt và generate ảnh/video. Đây là nơi bạn bắt đầu mọi tác vụ.',
          position: 'bottom'
        },
        {
          target: '#startBtn',
          title: window.I18n?.t('onboarding.generateBtnTitle') || 'Nút Generate',
          description: window.I18n?.t('onboarding.generateBtnDesc') || 'Click để bắt đầu tạo ảnh/video từ prompt của bạn.',
          position: 'top'
        },
        {
          target: '[data-tab="tab-spaces"]',
          title: window.I18n?.t('onboarding.workflowTabTitle') || 'Tab Workflow',
          description: window.I18n?.t('onboarding.workflowTabDesc') || 'Thiết kế quy trình tự động hóa nhiều bước (gen + download + Telegram + ...) như một flowchart.',
          position: 'bottom'
        },
        {
          target: '[data-tab="tab-prompts"]',
          title: window.I18n?.t('onboarding.templatesTabTitle') || 'Tab Templates',
          description: window.I18n?.t('onboarding.templatesTabDesc') || 'Kho mẫu workflow + prompt sẵn dùng. Click "Sao chép" để có ngay workflow chạy được.',
          position: 'bottom'
        },
        {
          target: '[data-tab="tab-tasks"]',
          title: window.I18n?.t('onboarding.tasksTabTitle') || 'Tab Multi Task',
          description: window.I18n?.t('onboarding.tasksTabDesc') || 'Gen hàng loạt nhiều prompt cùng lúc — mỗi task chạy độc lập, có thể bật/tắt.',
          position: 'bottom'
        },
        {
          target: null,
          title: window.I18n?.t('onboarding.readyTitle') || 'Bạn đã sẵn sàng!',
          description: window.I18n?.t('onboarding.readyDesc') || 'Chúc bạn sáng tạo vui vẻ! Có thể xem lại hướng dẫn này từ menu Cài đặt bất kỳ lúc nào.',
          position: 'center'
        }
      ];

      let currentStep = 0;
      let highlightedEl = null;

      // Defensive cleanup: xóa class highlight trên TẤT CẢ elements (không chỉ track variable).
      // Lý do: highlightedEl variable theo closure → nhiều tour runs khác nhau hoặc transition
      // lỗi có thể để lại class CSS trên element ngoài track → multiple elements highlighted
      // cùng lúc (vd step 4 "Generate Button" hiển thị border cả startBtn + tab workflow).
      function _cleanupAllHighlights() {
        document.querySelectorAll('.seosonaflow-onboarding-highlight').forEach(el => {
          el.classList.remove('seosonaflow-onboarding-highlight');
        });
        highlightedEl = null;
      }

      function finishOnboarding() {
        _cleanupAllHighlights();
        overlay.classList.add('hidden');
        // User-bound flag + giữ flag legacy = true để tránh re-show (idempotent)
        chrome.storage.local.set({ af_onboarding_done: true, [flagKey]: true });
      }

      function showStep(index) {
        // Defensive cleanup ALL highlights mỗi lần transition step — tránh stale class
        _cleanupAllHighlights();

        // Reset transform/position before repositioning
        tooltip.style.transform = '';
        tooltip.style.top = '';
        tooltip.style.left = '';

        const step = steps[index];
        content.innerHTML = `<h3>${step.title}</h3><p>${step.description}</p>`;
        stepIndicator.textContent = `${index + 1} / ${steps.length}`;

        const isLast = index === steps.length - 1;
        nextBtn.textContent = isLast ? (window.I18n?.t('onboarding.done') || 'Hoàn thành') : (window.I18n?.t('onboarding.next') || 'Tiếp theo');

        if (step.target) {
          const targetEl = document.querySelector(step.target);
          if (targetEl) {
            highlightedEl = targetEl;
            targetEl.classList.add('seosonaflow-onboarding-highlight');

            // Position tooltip relative to target
            const rect = targetEl.getBoundingClientRect();
            const sidebarRoot = document.getElementById('flow-auto-sidebar-root');
            const sidebarRect = sidebarRoot ? sidebarRoot.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 800 };

            tooltip.style.position = 'absolute';

            const relLeft = rect.left - sidebarRect.left;
            const relTop = rect.top - sidebarRect.top;
            const tooltipH = tooltip.offsetHeight;
            const margin = 12;

            let top;
            if (step.position === 'bottom') {
              top = relTop + rect.height + margin;
            } else {
              top = relTop - tooltipH - margin;
            }

            // Clamp: if tooltip would go off-screen, flip or center
            if (top < 8) {
              top = relTop + rect.height + margin;
            }
            if (top + tooltipH > sidebarRect.height - 8) {
              top = Math.max(8, relTop - tooltipH - margin);
            }

            tooltip.style.top = top + 'px';
            tooltip.style.left = Math.max(8, Math.min(relLeft, sidebarRect.width - 328)) + 'px';
          } else {
            centerTooltip();
          }
        } else {
          centerTooltip();
        }
      }

      function centerTooltip() {
        tooltip.style.top = '50%';
        tooltip.style.left = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
      }

      // Bug fix 2026-06-03: dùng `onclick` thay `addEventListener` để TRÁNH stale listener
      // accumulate qua replay tour. Trước fix: mỗi lần setupOnboarding() chạy (initial +
      // replay) addEventListener bind THÊM 1 handler mới — listener cũ với closure stale
      // (currentStep=last index của tour trước) vẫn fire → check `currentStep < steps.length-1`
      // = false → call finishOnboarding() → modal biến mất ngay khi user click Next ở replay.
      // `onclick = handler` overwrite single handler slot, không accumulate.
      nextBtn.onclick = () => {
        if (currentStep < steps.length - 1) {
          currentStep++;
          showStep(currentStep);
        } else {
          finishOnboarding();
        }
      };

      skipBtn.onclick = finishOnboarding;

      // Start onboarding
      overlay.classList.remove('hidden');
      showStep(0);
    });
  }

  // Expose global cho settings page / replay button call → trigger với force=true.
  // Reset cả 2 flag (user-bound + legacy) để đảm bảo hiển thị sạch.
  window.replayOnboarding = function () {
    const userId = ({ id: 'local_user', name: 'Local User', plan_slug: 'unlimited' })?.id || 'anon';
    const flagKey = 'af_onboarding_done_' + userId;
    chrome.storage.local.remove(['af_onboarding_done', flagKey], () => {
      setupOnboarding({ force: true });
    });
  };

  // ─── F11: Conversion Triggers ──────────────────────────

  // ─── Language Modal ──────────────────────────────────────
  function setupLanguageModal() {
    const languageBtn = document.getElementById('languageBtn');
    const langFlagIcon = document.getElementById('langFlagIcon');

    const flags = {
      vi: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='600' viewBox='0 0 900 600'%3E%3Crect width='900' height='600' fill='%23da251d'/%3E%3Cpolygon points='450,114 551,424 287,232 613,232 349,424' fill='%23ffff00'/%3E%3C/svg%3E",
      en: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 30'%3E%3CclipPath id='s'%3E%3Cpath d='M0,0 v30 h60 v-30 z'/%3E%3C/clipPath%3E%3CclipPath id='t'%3E%3Cpath d='M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z'/%3E%3C/clipPath%3E%3Cg clip-path='url(%23s)'%3E%3Cpath d='M0,0 v30 h60 v-30 z' fill='%23012169'/%3E%3Cpath d='M0,0 L60,30 M60,0 L0,30' stroke='%23fff' stroke-width='6'/%3E%3Cpath d='M0,0 L60,30 M60,0 L0,30' clip-path='url(%23t)' stroke='%23C8102E' stroke-width='4'/%3E%3Cpath d='M30,0 v30 M0,15 h60' stroke='%23fff' stroke-width='10'/%3E%3Cpath d='M30,0 v30 M0,15 h60' stroke='%23C8102E' stroke-width='6'/%3E%3C/g%3E%3C/svg%3E"
    };

    if (languageBtn) {
      languageBtn.addEventListener('click', () => {
        const currentLang = window.I18n?.getLocale?.() || 'vi';
        const nextLang = currentLang === 'vi' ? 'en' : 'vi';
        if (window.I18n) {
          I18n.setLocale(nextLang, true);
        }
        console.log('[SEOSONA Flow] Language toggled to:', nextLang);
      });
    }

    const syncActiveLang = () => {
      const currentLang = window.I18n?.getLocale?.() || 'vi';
      if (langFlagIcon) {
        langFlagIcon.src = flags[currentLang] || flags.vi;
        langFlagIcon.alt = currentLang.toUpperCase();
      }
    };
    syncActiveLang();
    window.eventBus?.on('i18n:changed', syncActiveLang);
  }

  // ===== Referral UI (G6) =====
  

  

  // Export for external access
  window.SeosonaFlowApp = {
    init,
    initializeTab,
    loadCSS,
    loadJS
  };

  // Do NOT auto-init here - content.js will call SeosonaFlowApp.init()
  // after sidebar HTML is injected into the page

})();
