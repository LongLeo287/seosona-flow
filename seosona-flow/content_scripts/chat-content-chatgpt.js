(function() {
  // Flag để background.js nhận biết script đã load (idempotent)
  window.__seosonaflowChatGPTLoaded__ = true;

  // Guard against double injection
  if (window._chatAIInjected) return;
  window._chatAIInjected = true;

  // Nuốt "Extension context invalidated" khi extension reload (content script cũ, vô hại).
  (function () {
    var RE = /context (was )?invalidated|Extension context/i;
    try {
      window.addEventListener('error', function (e) {
        var m = (e && (e.message || (e.error && e.error.message))) || '';
        if (RE.test(String(m))) { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); return false; }
      }, true);
      window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason; var m = (r && (r.message || r)) || '';
        if (RE.test(String(m))) { e.preventDefault(); }
      });
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt', _); }
  })();

  // Abort flag — timestamp-guarded để tránh race condition
  let __chatgptAbort = false;
  let __chatgptAbortAt = 0;
  let __chatgptCallStartAt = 0;

  function isAbortActive() {
    return __chatgptAbort && __chatgptAbortAt >= __chatgptCallStartAt;
  }

  // Helper: sleep
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Interruptible sleep — break sớm khi user abort
  async function interruptibleSleep(totalMs, stage = 'sleep') {
    const POLL = 200;
    const start = Date.now();
    while (Date.now() - start < totalMs) {
      if (isAbortActive()) {
        console.log('[ChatGPT-abort] Interruptible sleep aborted at stage:', stage);
        throw new Error('ABORTED:' + stage);
      }
      const remaining = totalMs - (Date.now() - start);
      await sleep(Math.min(POLL, remaining));
    }
  }

  // ============ i18n for FloatingTracker (content script lightweight i18n) ============
  const _i18n = {
    _lang: 'vi',
    _strings: {
      vi: {
        preparing: 'Đang chuẩn bị',
        waitingVerification: 'Chờ xác minh...',
        waitingResult: 'Đang chờ kết quả...',
      },
      en: {
        preparing: 'Preparing',
        waitingVerification: 'Waiting for verification...',
        waitingResult: 'Waiting for result...',
      },


    },
    t(key) {
      return this._strings[this._lang]?.[key] || this._strings.vi[key] || key;
    },
  };

  // Load user language from storage (async, fallback to 'vi')
  chrome.storage.local.get(['af_settings', 'af_locale'], (res) => {
    _i18n._lang = res.af_locale || res.af_settings?.language || 'vi';
    console.log(`[ChatGPT-i18n] Language loaded: ${_i18n._lang}`);
  });

  // ============ Dynamic Selector System (DOM Resilience) ============
  // Server-Only: Strict Server-Only — NO hardcoded _FALLBACK_SELECTORS.
  const PROVIDER = 'chatgpt';
  let _selectorConfig = null;
  let _selectorConfigTime = 0;
  const _SELECTOR_CACHE_TTL = 30000; // 30s

  // Server-Only: Wait/retry/overlay pattern
  const _SELECTOR_WAIT_MAX_MS = 10000;
  const _SELECTOR_WAIT_INTERVAL_MS = 200;

  // Overlay i18n (4 locales)
  const _OVERLAY_I18N = {
    vi: { title: 'Mất kết nối server', desc: 'Không thể kết nối tới máy chủ SEOSONA. Vui lòng kiểm tra lại sau.', retry: 'Thử lại' },
    en: { title: 'Server Connection Lost', desc: 'Unable to connect to SEOSONA server. Please try again later.', retry: 'Retry' },


  };

  (function _ensureSelectorConfig() {
    const startTime = Date.now();
    let attempts = 0;
    let lastLogElapsed = 0;
    console.log(`[Selector:${PROVIDER}:ensure] ⏳ Waiting for server config in chrome.storage.local (timeout ${_SELECTOR_WAIT_MAX_MS}ms)...`);
    function checkStorage() {
      attempts++;
      chrome.storage.local.get(['seosona_provider_configs'], (res) => {
        if (res.seosona_provider_configs?.data?.[PROVIDER]) {
          _selectorConfig = res.seosona_provider_configs.data;
          _selectorConfigTime = Date.now();
          const keyCount = Object.keys(_selectorConfig[PROVIDER]?.selectors || {}).length;
          console.log(`[Selector:${PROVIDER}:ensure] ✅ Loaded ${keyCount} selectors after ${attempts} attempts (${Date.now() - startTime}ms)`);
          return;
        }
        try {
          chrome.runtime.sendMessage({ action: 'getProviderConfigs', provider: PROVIDER }, () => {
            if (chrome.runtime.lastError) { /* SW suspended — silent */ }
          });
        } catch (_) { /* SW disconnected — silent */ }
        const elapsed = Date.now() - startTime;
        if (elapsed - lastLogElapsed >= 1000) {
          lastLogElapsed = elapsed;
          console.log(`[Selector:${PROVIDER}:ensure] ⏳ Still waiting (${(elapsed / 1000).toFixed(1)}s/${_SELECTOR_WAIT_MAX_MS / 1000}s, attempt #${attempts}) — re-triggering background fetch`);
        }
        if (elapsed > _SELECTOR_WAIT_MAX_MS) {
          console.error(`[Selector:${PROVIDER}:ensure] ❌ Timeout after ${attempts} attempts (${elapsed}ms). Server unreachable — showing overlay.`);
          _showConfigErrorOverlay();
          return;
        }
        setTimeout(checkStorage, _SELECTOR_WAIT_INTERVAL_MS);
      });
    }
    checkStorage();
  })();

  function _showConfigErrorOverlay() {
    if (document.getElementById('seosonaflow-config-error-overlay')) {
      console.log(`[Selector:${PROVIDER}:overlay] ↩ Overlay already mounted — skip`);
      return;
    }
    // Overlay "server unreachable" đã gỡ (local mode dùng config bundled — không timeout).
    // No-op an toàn: tránh ReferenceError do biến `overlay` không còn được khởi tạo.
    console.warn(`[Selector:${PROVIDER}:overlay] Config error (local mode) — bỏ qua overlay.`);
  }

  function _getDynamicSelector(key) {
    // Vá nóng: override (chrome.storage) THẮNG config gốc → sửa selector có hiệu lực ngay,
    // không cần sửa code / reload extension. Xoá override là quay lại config gốc.
    try {
      const _ov = (typeof self !== 'undefined' && self.SelectorOverride) || (typeof window !== 'undefined' && window.SelectorOverride);
      const _hit = _ov && _ov.getConfig && _ov.getConfig(PROVIDER, key);
      if (_hit) return _hit;
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#_getDynamicSelector', _); }

    const now = Date.now();
    if (_selectorConfig && (now - _selectorConfigTime) < _SELECTOR_CACHE_TTL) {
      return _selectorConfig?.[PROVIDER]?.selectors?.[key] || null;
    }
    chrome.storage.local.get(['seosona_provider_configs'], (res) => {
      if (res.seosona_provider_configs?.data) {
        _selectorConfig = res.seosona_provider_configs.data;
        _selectorConfigTime = Date.now();
      }
    });
    return _selectorConfig?.[PROVIDER]?.selectors?.[key] || null;
  }

  function _queryWithFallback(key, defaultSelectors = null, options = {}) {
    const config = _getDynamicSelector(key);
    const hardcoded = defaultSelectors || []; // Server-Only: _FALLBACK_SELECTORS removed
    const isDynamic = config?.selectors?.length > 0;
    const selectors = isDynamic ? config.selectors : hardcoded;
    const silent = options.silent || false;
    const scope = options.scope || document;

    if (!silent) console.log(`[Selector:${PROVIDER}:${key}] ${isDynamic ? '🌐 DYNAMIC' : '📦 HARDCODED'} | Trying ${selectors.length} selectors`);

    // Server-Only guard: config.exclude_if_aria_contains = mảng chuỗi → bỏ qua element có aria-label
    // chứa các chuỗi đó (vd submit_button loại nút "Chế độ thoại"/"đọc chính tả" dùng chung class với nút gửi).
    const excludeAria = (config?.exclude_if_aria_contains || []).map((s) => String(s).toLowerCase());
    const _isExcluded = (el) => {
      if (!excludeAria.length || !el) return false;
      const al = (el.getAttribute('aria-label') || '').toLowerCase();
      return excludeAria.some((x) => x && al.includes(x));
    };

    for (let i = 0; i < selectors.length; i++) {
      try {
        if (excludeAria.length) {
          // Có exclude rule → quét tất cả, trả element đầu tiên KHÔNG bị loại.
          const els = scope.querySelectorAll(selectors[i]);
          for (const el of els) {
            if (el && !_isExcluded(el)) {
              if (!silent) console.log(`[Selector:${PROVIDER}:${key}] ✅ Match #${i + 1}: ${selectors[i]}`);
              return el;
            }
          }
        } else {
          const el = scope.querySelector(selectors[i]);
          if (el) {
            if (!silent) console.log(`[Selector:${PROVIDER}:${key}] ✅ Match #${i + 1}: ${selectors[i]}`);
            return el;
          }
        }
      } catch (e) { /* invalid selector */ }
    }
    if (!silent) console.log(`[Selector:${PROVIDER}:${key}] ❌ No match`);
    return null;
  }

  function _queryAllWithFallback(key, defaultSelectors = null, scope = null) {
    const config = _getDynamicSelector(key);
    const hardcoded = defaultSelectors || []; // Server-Only: _FALLBACK_SELECTORS removed
    const selectors = config?.selectors?.length > 0 ? config.selectors : hardcoded;
    const root = scope || document;

    for (let i = 0; i < selectors.length; i++) {
      try {
        const els = root.querySelectorAll(selectors[i]);
        if (els.length > 0) return els;
      } catch (e) { /* invalid selector */ }
    }
    return [];
  }

  // Helper: Get selectors array for a key (dynamic only, no hardcoded fallback)
  function _getSelectorsForKey(key) {
    const config = _getDynamicSelector(key);
    const isDynamic = config?.selectors?.length > 0;
    const selectors = isDynamic ? config.selectors : []; // Server-Only: _FALLBACK_SELECTORS removed
    console.log(`[Selector:${PROVIDER}:${key}] ${isDynamic ? '🌐 DYNAMIC' : '⚠️ EMPTY'} | ${selectors.length} selectors`);
    // Ghi nhận cho SelectorDoctor: thiếu cấu hình = biết ngay key nào cần vá (không đổi hành vi).
    try {
      const _sd = (typeof self !== 'undefined' && self.SelectorDoctor) || (typeof window !== 'undefined' && window.SelectorDoctor);
      if (_sd && !isDynamic) _sd.record(PROVIDER, key, 'no_config', null);
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#_getSelectorsForKey', _); }
    return selectors;
  }

  // Helper: Check if generating indicator exists in element (or global document)
  // Server-Only: dynamic selectors
  function _hasGeneratingIndicator(el = document) {
    const selectors = _getSelectorsForKey('generating_indicator');
    for (const sel of selectors) {
      try {
        if (el.querySelector(sel)) return true;
      } catch (e) { /* invalid selector */ }
    }
    return false;
  }

  // Helper: Query all CDN images in scope (Server-Only: dynamic cdn_image selectors)
  // ChatGPT CDN có thể là: estuary/content, oaiusercontent, sandboxed.openai, backend-api
  function _queryCdnImages(scope = document) {
    const selectors = _getSelectorsForKey('cdn_image');
    if (selectors.length === 0) return [];
    // Build combined selector for efficiency
    const combined = selectors.join(', ');
    try {
      return scope.querySelectorAll(combined);
    } catch (e) {
      // Fallback: query each selector individually
      const results = [];
      for (const sel of selectors) {
        try {
          results.push(...scope.querySelectorAll(sel));
        } catch (_) { /* invalid selector */ }
      }
      return results;
    }
  }

  // Phương án A: còn ref image ĐANG upload? (overlay/.cursor-wait trên file-tile chưa tan).
  // Server-Only: đọc key 'ref_upload_pending' từ config. Key chưa seed → trả false (graceful
  // degrade về gate nút-disabled cũ). Dùng để chờ upload XONG trước khi input prompt + submit.
  function _isRefUploading() {
    return !!_queryWithFallback('ref_upload_pending', null, { silent: true });
  }

  // ============ Macro-delay giữa các BƯỚC CHÍNH — sync với Flow's inputTimeout setting ============
  //
  // CHIẾN LƯỢC:
  //   - Micro-delay (sleep nhỏ trong sub-step như focus, dispatch event, wait React render)
  //     → GIỮ HARDCODE — vì có lý do kỹ thuật cụ thể, không scale theo user setting.
  //   - Macro-delay (gap GIỮA các bước chính: upload → activate → clear → insert → submit)
  //     → DÙNG getMacroDelay() = inputTimeout × 0.7. User control tốc độ tổng qua setting này.
  //
  // FLOW PIPELINE ChatGPT:
  //   removeRefs + uploadRefs
  //     ↓ sleep(getMacroDelay())   ← 840ms khi inputTimeout=1200
  //   activateImageMode
  //     ↓ sleep(getMacroDelay())
  //   injectTextAndSubmit (clear + insert + submit)
  //
  // 2 biến tracking:
  //   __chatgptInputTimeoutMs: GIÁ TRỊ user setting (lấy từ payload, default 1200ms)
  //   __chatgptMacroDelayMs:   BIẾN TRUNG GIAN = 70% inputTimeoutMs
  let __chatgptInputTimeoutMs = 1200;
  let __chatgptMacroDelayMs = Math.round(1200 * 0.7);  // 840ms

  function getMacroDelay() {
    return __chatgptMacroDelayMs;
  }

  // Helper: checkAbort — throw 'ABORTED:<stage>' để break early ở mọi phase, KHÔNG chỉ wait loops.
  // Bug fix 2026-05-09: trước đây flag chỉ check trong waitForResult → user bấm forceStop ở phase
  // upload/insert/submit thì code vẫn tiếp tục chạy tới khi vào wait loop → delay > 1 phút.
  // Giờ throw ngay khi flag set → catch trong handleSubmitAndWait + click Stop button của ChatGPT.
  function checkAbort(stage) {
    if (isAbortActive()) {
      console.log('[ChatGPT-abort] Aborted at stage:', stage);
      throw new Error('ABORTED:' + stage);
    }
  }

  // Helper: click "Stop generating" button của ChatGPT để halt backend gen.
  // Quan trọng vì kể cả khi extension abort wait loop, ChatGPT backend vẫn tiếp tục gen
  // → user thấy ảnh hiện ra dù đã bấm Stop. Click stop button = backend dừng ngay.
  async function clickChatGPTStopButton() {
    const stopBtn = _queryWithFallback('stop_button');
    if (stopBtn && !stopBtn.disabled) {
      console.log('[ChatGPT-abort] Clicking ChatGPT Stop button to halt backend gen');
      try { stopBtn.click(); } catch (e) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#clickChatGPTStopButton', e); }
      try { simulateClick(stopBtn); } catch (e) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#clickChatGPTStopButton', e); }
      await sleep(300);
      return true;
    }
    console.log('[ChatGPT-abort] Stop button not found or disabled');
    return false;
  }

  // ============ Delete last assistant message (2026-05-16) ============
  // Flow: Click "More actions" button on last assistant turn → Click "Delete" menu item → Confirm in modal
  // Used when setting `chatgpt_delete_after_gen` is enabled.
  async function deleteLastAssistantMessage(turnEl = null) {
    try {
      // Strategy: Click header "conversation options" button → Delete menu item
      // This is more reliable than finding "More actions" on individual messages
      // DOM refs: data/dom/chatgpt-dom/chatgpt-mess-header.md, chatgpt-mess-delete-menu.md

      // 1. Find conversation options button in header
      const headerSelectors = _getSelectorsForKey('conversation_options_button');
      let optionsBtn = null;
      for (const sel of headerSelectors) {
        optionsBtn = document.querySelector(sel);
        if (optionsBtn) break;
      }
      // Server-Only: không fallback inline, chỉ dùng server config
      if (!optionsBtn) {
        console.warn('[ChatGPT-delete] Không tìm thấy nút conversation options trong header');
        return false;
      }

      // 2. Click to open menu
      console.log('[ChatGPT-delete] Clicking conversation options button...');
      simulateClick(optionsBtn);
      await sleep(500);

      // 3. Wait for menu to open — Server-Only: dynamic open_menu selector
      let openMenu = null;
      const menuTimeout = Date.now() + 3000;
      while (Date.now() < menuTimeout) {
        openMenu = _queryWithFallback('open_menu', null, { silent: true });
        if (openMenu) break;
        await sleep(200);
      }

      if (!openMenu) {
        console.warn('[ChatGPT-delete] Menu không mở');
        return false;
      }

      // 4. Find and click "Delete" menu item — Server-Only: dynamic selectors
      let deleteMenuItem = _queryWithFallback('delete_chat_menu_item', null, { scope: openMenu, silent: true });
      if (!deleteMenuItem) {
        // Fallback: tìm qua text content
        const menuItems = _queryAllWithFallback('menu_items', null, openMenu);
        for (const item of menuItems) {
          const text = item.textContent?.trim().toLowerCase();
          if (text === 'delete' || text === 'xóa' || text.includes('delete')) {
            deleteMenuItem = item;
            break;
          }
        }
      }

      if (!deleteMenuItem) {
        console.warn('[ChatGPT-delete] Không tìm thấy menu item "Delete"');
        document.body.click();
        return false;
      }

      console.log('[ChatGPT-delete] Clicking "Delete" menu item...');
      simulateClick(deleteMenuItem);
      await sleep(500);

      // 5. Wait for confirm modal and click confirm button
      // Server-Only: dynamic selector (challenge_overlay covers dialog/alertdialog)
      const confirmTimeout = Date.now() + 3000;
      const confirmSelectors = _getSelectorsForKey('delete_confirm_button');
      let confirmBtn = null;
      while (Date.now() < confirmTimeout) {
        const dialog = _queryWithFallback('challenge_overlay', null, { silent: true });
        if (dialog) {
          for (const sel of confirmSelectors) {
            try {
              confirmBtn = dialog.querySelector(sel);
              if (confirmBtn) break;
            } catch (_) { /* invalid selector */ }
          }
          if (!confirmBtn) {
            const buttons = dialog.querySelectorAll('button');
            for (const btn of buttons) {
              const text = btn.textContent?.trim().toLowerCase();
              if (text === 'delete' || text === 'xóa') {
                confirmBtn = btn;
                break;
              }
            }
          }
        }
        if (confirmBtn) break;
        await sleep(200);
      }

      if (!confirmBtn) {
        console.warn('[ChatGPT-delete] Không tìm thấy nút xác nhận trong modal');
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return false;
      }

      console.log('[ChatGPT-delete] Clicking confirm button...');
      simulateClick(confirmBtn);
      await sleep(500);

      console.log('[ChatGPT-delete] ✅ Đã xóa conversation thành công');
      return true;
    } catch (err) {
      console.error('[ChatGPT-delete] Lỗi khi xóa conversation:', err);
      return false;
    }
  }

  // Helper: simulateClick (full pointer event chain for React compatibility)
  // 2026-06-02 defensive guard: catch regression khi selector match nhầm non-element hoặc null.
  function simulateClick(el) {
    if (!el || !(el instanceof Element)) {
      console.warn('[ChatGPT] simulateClick: invalid element type', el);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.warn('[ChatGPT] simulateClick: element zero-size (hidden/detached), skip', el);
      return;
    }
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  // Helper: waitForElement
  async function waitForElement(selector, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  // ============ FloatingTracker: Rich UI port từ Flow (jobs list + per-item state badges + pipeline stats) ============
  // Phase 1+2+3 2026-06-13: backed by shared floating-tracker-rich.js (loaded TRƯỚC qua manifest).
  // Backward compat: .show()/.update()/.hide() vẫn work với 1-prompt legacy data.
  // Rich mode: .updateFromQueue(queueData) accept full PromptQueue snapshot từ pq:trackerUpdate broadcast.
  const FloatingTracker = (typeof window.createFloatingTrackerRich === 'function')
    ? window.createFloatingTrackerRich({ id: 'seosonaflow-chatgpt-tracker', title: 'ChatGPT', onSkipBlocker: () => { try { ExecutionBlocker.hide(); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#onSkipBlocker', _); } } })
    : {
        // Fallback nếu helper chưa load (KHÔNG nên xảy ra vì manifest inject trước) — no-op stub.
        _el: null, show() {}, update() {}, hide() {}, updateFromQueue() {}
      };
  // Single source of truth = sidebar (rich pq:trackerUpdate). Khi rich đang chạy → legacy show/update/hide
  // no-op để không đè/ẩn rich multi-prompt view. Fallback legacy giữ nguyên khi KHÔNG có rich (path khác).
  let _ftRichActive = false;
  if (FloatingTracker && typeof FloatingTracker.show === 'function' && typeof window.createFloatingTrackerRich === 'function') {
    const _s = FloatingTracker.show.bind(FloatingTracker);
    const _u = FloatingTracker.update.bind(FloatingTracker);
    const _h = FloatingTracker.hide.bind(FloatingTracker);
    FloatingTracker.show = (a) => { if (!_ftRichActive) _s(a); };
    FloatingTracker.update = (a) => { if (!_ftRichActive) _u(a); };
    FloatingTracker.hide = () => { if (!_ftRichActive) _h(); };
  }

  // ============ ExecutionBlocker: Block user interaction khi đang gen ============
  const ExecutionBlocker = {
    _el: null,
    _styleEl: null,
    _blocking: false,
    _escapeCount: 0,
    _escapeTimer: null,
    _timeoutId: null,
    _MAX_BLOCK_TIME: 7 * 60 * 1000, // 7 phút — cao hơn detection timeout+grace (gen ảnh chậm) để overlay không tự ẩn giữa chừng

    _injectStyles() {
      if (this._styleEl) return;
      const style = document.createElement('style');
      style.id = 'seosonaflow-chatgpt-blocker-styles';
      style.textContent = `
        @keyframes seosonaflow-glow-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.7; }
        }
        #seosonaflow-chatgpt-blocker {
          position: fixed; inset: 0; z-index: 2147483646;
          /* [Port 1.1.59] Chỉ HIỂN THỊ glow, KHÔNG chặn click — ChatGPT không cần khóa trang (khác Flow) + tránh kẹt captcha. */
          pointer-events: none; background: transparent;
        }
        #seosonaflow-chatgpt-blocker::before {
          content: ''; position: absolute; inset: 0;
          border: 5px solid #3d6ff5;
          box-shadow:
            inset 0 0 0 2px rgba(61, 111, 245,0.5),
            inset 0 0 15px rgba(61, 111, 245,0.3),
            0 0 15px rgba(61, 111, 245,0.5),
            0 0 35px rgba(61, 111, 245,0.35),
            0 0 60px rgba(61, 111, 245,0.2),
            0 0 100px rgba(61, 111, 245,0.1);
          animation: seosonaflow-glow-pulse 1.8s ease-in-out infinite;
          will-change: opacity;
          pointer-events: none;
        }
      `;
      document.head.appendChild(style);
      this._styleEl = style;
    },

    _blockEvent(e) {
      if (!ExecutionBlocker._blocking) return;
      if (!e.isTrusted) return; // Allow programmatic events
      if (e.target?.closest?.('#seosonaflow-chatgpt-tracker')) return; // Allow tracker clicks

      // Escape hatch: 3x Escape to force hide
      if (e.type === 'keydown' && e.key === 'Escape') {
        ExecutionBlocker._escapeCount++;
        clearTimeout(ExecutionBlocker._escapeTimer);
        ExecutionBlocker._escapeTimer = setTimeout(() => { ExecutionBlocker._escapeCount = 0; }, 2000);
        if (ExecutionBlocker._escapeCount >= 3) {
          console.warn('[ChatGPT-ExecutionBlocker] Force hide via Escape x3');
          ExecutionBlocker._escapeCount = 0;
          ExecutionBlocker.hide();
          __chatgptAbort = true;
          __chatgptAbortAt = Date.now();
          return;
        }
      }
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
    },

    _attachBlockers() {
      if (this._blocking) return;
      this._blocking = true;
      const events = ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchend', 'keydown', 'keyup'];
      events.forEach(evt => document.addEventListener(evt, this._blockEvent, { capture: true, passive: false }));
    },

    _detachBlockers() {
      if (!this._blocking) return;
      this._blocking = false;
      const events = ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchend', 'keydown', 'keyup'];
      events.forEach(evt => document.removeEventListener(evt, this._blockEvent, { capture: true }));
    },

    show() {
      this._injectStyles();
      // [Port 1.1.59] KHÔNG _attachBlockers() — ChatGPT chỉ hiện glow, không chặn click (khác Flow).
      this._startTimeout();
      if (this._el) { this._el.style.display = 'block'; return; }
      const el = document.createElement('div');
      el.id = 'seosonaflow-chatgpt-blocker';
      document.body.appendChild(el);
      this._el = el;
    },

    _startTimeout() {
      this._stopTimeout();
      this._timeoutId = setTimeout(() => {
        // 2026-05-27: CHỈ ẩn overlay (unblock UI), KHÔNG set __chatgptAbort. Trước fix: auto-timeout
        // set abort → gen ảnh chậm (>_MAX_BLOCK_TIME) bị "User stopped during grace" dù ChatGPT vẫn
        // đang gen → node fail đỏ oan. Detection loop có timeout+grace riêng để kết thúc đúng cách.
        console.warn('[ChatGPT-ExecutionBlocker] Auto-timeout, force hiding (KHÔNG abort — detection tự xử lý)');
        this.hide();
      }, this._MAX_BLOCK_TIME);
    },

    _stopTimeout() {
      if (this._timeoutId) { clearTimeout(this._timeoutId); this._timeoutId = null; }
    },

    hide() {
      this._detachBlockers();
      this._stopTimeout();
      this._escapeCount = 0;
      clearTimeout(this._escapeTimer);
      if (this._el) this._el.style.display = 'none';
    }
  };

  // ============ HELPER: Remove ref images cũ trên ChatGPT composer ============
  // Server-Only: dynamic remove_ref_image_button selector
  // Click qua React onClick để bypass CSS opacity nếu có.
  async function removeExistingChatGPTRefImages() {
    const removeBtns = _queryAllWithFallback('remove_ref_image_button');
    let removedCount = 0;

    for (const btn of removeBtns) {
      const propsKey = Object.keys(btn).find(k => k.startsWith('__reactProps$'));
      if (propsKey && btn[propsKey]?.onClick) {
        try {
          btn[propsKey].onClick({
            preventDefault: function(){}, stopPropagation: function(){},
            nativeEvent: new MouseEvent('click', { bubbles: true }),
            type: 'click', target: btn, currentTarget: btn,
          });
        } catch (_) {
          simulateClick(btn);
        }
      } else {
        simulateClick(btn);
      }
      removedCount++;
      await sleep(250);
    }

    if (removedCount > 0) {
      console.log(`[ChatGPT] removeExistingRefImages: đã xóa ${removedCount} ref image(s) cũ`);
    }
    return removedCount;
  }

  // ============ Cloudflare/captcha challenge detection ============
  // ChatGPT đôi khi có verification challenge (Cloudflare turnstile hoặc OpenAI captcha).
  // Tab inactive → challenge có thể không tự complete → DOM operations bị block silent.
  // Pattern giống chat-content-grok.js.
  function detectChatGPTChallenge() {
    // Server-Only: dynamic cloudflare_iframe selector
    if (_queryWithFallback('cloudflare_iframe', null, { silent: true })) return true;
    // OpenAI specific: "Verify you are human" page
    // Server-Only: dynamic selectors + text_match from config
    const overlays = _queryAllWithFallback('challenge_overlay', null, { silent: true });
    const selectorConfig = _getDynamicSelector('challenge_overlay') || {};
    const textMatches = selectorConfig.text_match || [];
    for (const el of overlays) {
      const txt = (el.innerText || '').toLowerCase();
      const matchesServerPattern = textMatches.some(pattern => txt.includes(pattern.toLowerCase()));
      // Extra: Cloudflare specific detection (not in server config)
      const matchesCloudflare = txt.includes('verifying') && txt.includes('cloudflare');
      if (matchesServerPattern || matchesCloudflare) {
        const style = window.getComputedStyle(el);
        if (style.display !== 'none' && style.visibility !== 'hidden') return true;
      }
    }
    return false;
  }

  async function waitForChatGPTChallengeResolved(timeoutMs = 120000) {
    if (!detectChatGPTChallenge()) return true;
    console.warn('[ChatGPT] Challenge detected — request tab activate + chờ user verify');
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'chatgpt:ensureActive', focusWindow: true, reason: 'challenge' },
          () => resolve()
        );
      });
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#waitForChatGPTChallengeResolved', _); }
    const start = Date.now();
    let lastLog = 0;
    while (Date.now() - start < timeoutMs) {
      // Abort check — tránh block user khi đang chờ challenge
      if (isAbortActive()) {
        console.log('[ChatGPT] Challenge wait aborted by user');
        return false;
      }
      if (!detectChatGPTChallenge()) {
        console.log('[ChatGPT] Challenge resolved sau', Math.round((Date.now() - start) / 1000), 's');
        await sleep(800);
        return true;
      }
      const elapsed = Date.now() - start;
      if (elapsed - lastLog >= 10000) {
        console.log('[ChatGPT] Vẫn chờ challenge resolved...', Math.round(elapsed / 1000), 's');
        lastLog = elapsed;
      }
      await sleep(800);
    }
    console.error('[ChatGPT] Challenge timeout sau', timeoutMs / 1000, 's');
    return false;
  }

  // ============ Composer stability helpers ============
  // Đếm ref-image đang có trong composer form (dedup/stale-ref detection).
  function _countComposerRefImages() {
    const composer = _queryWithFallback('composer', null, { silent: true });
    const form = composer?.closest('form');
    if (!form) return 0;
    return _queryCdnImages(form).length;
  }

  // Chờ composer ỔN ĐỊNH: cùng element + top không đổi (±2px) trong REQUIRED lần liên tiếp.
  // Chống ChatGPT SPA yank-back về /c/xxx giữa chừng (composer stable nhưng SAI trang) → reset đếm.
  // Dùng thay `await sleep(300)` cứng để tránh upload ref lên composer đang transition → SPA wipe ref.
  async function _waitComposerStable(timeoutMs = 6000) {
    const REQUIRED = 5, STEP = 200;
    let prev = null, prevTop = -1, streak = 0;
    const dl = Date.now() + timeoutMs;
    while (Date.now() < dl) {
      const _path = window.location.pathname;
      if (_path !== '/' && _path !== '') {
        streak = 0; prev = null; prevTop = -1;
        await sleep(STEP);
        continue;
      }
      const el = _queryWithFallback('composer', null, { silent: true });
      if (el && el.isConnected && el === prev) {
        const top = Math.round(el.getBoundingClientRect().top);
        streak = Math.abs(top - prevTop) <= 2 ? streak + 1 : 0;
        prevTop = top;
      } else {
        streak = 0;
        prev = el;
        prevTop = el ? Math.round(el.getBoundingClientRect().top) : -1;
      }
      if (streak >= REQUIRED) return true;
      await sleep(STEP);
    }
    console.warn('[ChatGPT-newchat] Composer KHÔNG ổn định sau', timeoutMs, 'ms (còn transition)');
    return false;
  }

  // ============ HELPER: Click "New chat" và chờ editor ready ============
  // Lý do: ChatGPT có thể bị stuck state hoặc image mode bị hạn chế trong conversation cũ.
  // Tạo new chat đảm bảo clean state + đủ quota upload refs cho fresh conversation.
  // Port 1.1.58: ChatGPT (2026-07) thêm radio group Chat/Work ở composer. Extension LUÔN cần Chat mode
  // (Work → submit sai chế độ, hỏng gen ảnh). Neo bằng role=radio + index (radio[0]=Chat), KHÔNG text
  // i18n/class Tailwind. Degrade-graceful: <2 radio → skip, KHÔNG block submit.
  async function _ensureChatTabSelected() {
    try {
      const radios = _queryAllWithFallback('composer_mode_radio') || [];
      if (radios.length < 2) return; // DOM cũ / không có tab → không cần làm gì
      const chatRadio = radios[0];
      if (chatRadio.getAttribute('aria-checked') === 'true') return; // đã ở Chat
      console.log('[ChatGPT-newchat] Tab đang ở Work → ép chọn Chat');
      simulateClick(chatRadio);
      const dl = Date.now() + 1500;
      while (Date.now() < dl) {
        if (chatRadio.getAttribute('aria-checked') === 'true') return;
        await sleep(100);
      }
      console.warn('[ChatGPT-newchat] Click Chat tab nhưng aria-checked chưa =true sau 1.5s');
    } catch (e) {
      console.warn('[ChatGPT-newchat] _ensureChatTabSelected lỗi (non-blocking):', e.message);
    }
  }
  // Wrapper: composer stable → ép chọn tab Chat. Return đúng bool stable (tab selection best-effort).
  async function _readyWithChatTab(timeoutMs = 6000) {
    const stable = await _waitComposerStable(timeoutMs);
    if (stable) await _ensureChatTabSelected();
    return stable;
  }

  async function clickNewChatAndWaitReady(timeoutMs = 10000) {
    const log = (...args) => console.log('[ChatGPT-newchat]', ...args);

    // Helper: ở homepage VÀ conversation empty → không cần click gì.
    const isAtEmptyHome = () => {
      const path = window.location.pathname;
      if (path !== '/' && path !== '') return false;
      const _maCfg = _getDynamicSelector('message_author');
      const _maSelectors = _maCfg?.selectors || [];
      const messages = _maSelectors.length > 0
        ? document.querySelectorAll(_maSelectors.join(', '))
        : [];
      return messages.length === 0;
    };

    // FIX ref-lost: sau click "New chat", ChatGPT SPA đổi path='/' + composer sẵn sàng NHƯNG hội thoại
    // cũ có thể CHƯA unmount (baseline vẫn thấy turns cũ + refs — xem comment snapshotConversationState).
    // Return sớm → provider:textTask/submitAndWait upload ref lên composer đang transition → SPA clear
    // xong wipe ref → submit mất ref. Dùng CÙNG selector 'conversation_turn' với baseline để xác nhận
    // hội thoại cũ đã unmount hẳn (0 turns) trước khi coi là ready.
    const isConvCleared = () => (_queryAllWithFallback('conversation_turn') || []).length === 0;

    // Tier 0 (2026-06-19 fix mobile bug): early-exit khi đã ở homepage empty conv. Trước fix:
    // mobile ChatGPT (sidebar collapsed) → Tier 1 miss + Tier 2 miss → fall thẳng vào Tier 3 firing
    // synthetic anchor click "/" DÙ ĐANG Ở "/" → browser soft-reload (Next.js mobile bundle không có
    // Link delegate intercept) → page reload async fire giữa step paste → submit fail, kẹt chat
    // hiển thị reload.
    if (isAtEmptyHome()) {
      log('Đã ở homepage với empty conversation — skip click (tier 0), chờ composer ổn định');
      // Port 1.1.49: gate qua _waitComposerStable thay return true ngay → tránh upload ref/paste
      // khi ProseMirror composer còn transition (ref-lost / paste hụt). Đồng bộ tier 3 (dòng 811).
      return await _readyWithChatTab(6000);
    }

    // Mục tiêu: redirect về homepage "/" — chat mới auto-tạo khi submit tin đầu.
    // 3-tier fallback (lenient: ChatGPT đổi DOM thường xuyên):
    //   Tier 1: button "New chat" cụ thể (data-testid="create-new-chat-button")
    //   Tier 2: home link sidebar (chat_history_home_link, match đầu tiên — bỏ text filter "New chat"
    //           vì label thay đổi theo i18n + nesting, chỉ cần link href="/" trong sidebar là đủ)
    //   Tier 3: tạo anchor tạm <a href="/"> + click → Next.js Link global delegate intercept → SPA
    //           navigate (không dùng pushState vì App Router không re-render khi pushState manual)
    let newChatBtn = _queryWithFallback('new_chat_button');
    if (!newChatBtn) {
      const cfg = _getDynamicSelector('chat_history_home_link');
      const selectors = cfg?.selectors || []; // Server-Only: no hardcoded fallback
      if (selectors.length > 0) {
        newChatBtn = document.querySelector(selectors.join(', '));
        if (newChatBtn) log('Tier 2 fallback: home link via chat_history_home_link');
      }
    }

    if (!newChatBtn) {
      // Tier 3: SPA navigate qua synthetic anchor click (Next.js Link delegate intercept).
      // Lưu ý: Tier 0 ở trên đã loại bỏ case "đã ở homepage empty" — Tier 3 chỉ fire khi ở
      // conversation cũ cần escape. Synthetic click trên mobile có rủi ro hard-reload nếu
      // Next.js Link delegate không intercept (mobile bundle khác desktop) — accept risk vì
      // alternative duy nhất là kẹt ở conversation cũ.
      log('Tier 3 fallback: synthetic anchor click "/"');
      try {
        const a = document.createElement('a');
        a.href = '/';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e) {
        log('WARN: synthetic anchor navigate fail:', e.message);
        return false;
      }
      // Chờ navigation + editor ready (path "/" + composer interactive)
      const dl3 = Date.now() + timeoutMs;
      while (Date.now() < dl3) {
        const path3 = window.location.pathname;
        if (path3 === '/' || path3 === '') {
          const editor3 = _queryWithFallback('composer');
          if (editor3 && isConvCleared() && editor3.getAttribute('aria-disabled') !== 'true' &&
              !editor3.closest('[aria-busy="true"]')) {
            log('Homepage ready (tier 3) sau', timeoutMs - (dl3 - Date.now()), 'ms');
            // Port 1.1.40: chờ composer ổn định (streak) thay vì sleep(300) cứng → tránh upload ref
            // lên composer đang transition rồi bị SPA wipe (ref-lost bug).
            await _readyWithChatTab(6000);
            return true;
          }
        }
        await sleep(200);
      }
      log('WARN: Tier 3 timeout — không về được homepage');
      return false;
    }

    // Tier 1/2 found newChatBtn: vẫn re-check isAtEmptyHome (vd Tier 2 match home link nhưng ta đã
    // ở homepage cũ với empty conv — click cũng vô nghĩa và rủi ro reload).
    if (isAtEmptyHome()) {
      log('Tier 1/2 found button NHƯNG đã ở empty home — skip click, chờ composer ổn định');
      // Port 1.1.49: gate composer-stable (như tier 0/3) trước khi báo ready.
      return await _readyWithChatTab(6000);
    }

    // 3. Click button
    log('Click New chat button...');
    simulateClick(newChatBtn);

    // 4. Chờ navigation và editor ready
    //    - URL chuyển về "/"
    //    - ProseMirror editor xuất hiện và focusable
    const startTime = Date.now();
    let editorReady = false;

    while (Date.now() - startTime < timeoutMs) {
      // Check URL
      const path = window.location.pathname;
      if (path !== '/' && path !== '') {
        await sleep(200);
        continue;
      }

      // Check editor ready
      const editor = _queryWithFallback('composer');
      if (editor) {
        // Verify editor is interactive (not disabled/loading)
        const isDisabled = editor.getAttribute('aria-disabled') === 'true' ||
                          editor.closest('[aria-busy="true"]');
        // Chờ CẢ hội thoại cũ unmount (0 turns) — tránh upload ref lên composer đang transition.
        if (!isDisabled && isConvCleared()) {
          editorReady = true;
          break;
        }
      }

      await sleep(200);
    }

    if (editorReady) {
      log('New chat ready sau', Date.now() - startTime, 'ms');
      // Extra sleep để React hydrate hoàn toàn
      await sleep(300);
      return true;
    }

    log('WARN: Editor không ready sau', timeoutMs, 'ms');
    return false;
  }

  // ============ HELPER: Chờ trang interactive trước mọi flow submit (i2p/PA/gen) ============
  // Root cause "upload fail khi fresh tab/reload delay": content script inject ở document_idle
  // nhưng React composer + #upload-photos chưa render. Gate: DOM complete + composer mount +
  // composer KHÔNG aria-disabled/aria-busy + settle hydrate. Best-effort (timeout → vẫn thử tiếp).
  async function waitProviderReady(timeoutMs = 12000) {
    const dl = Date.now() + timeoutMs;
    while (Date.now() < dl) {
      if (document.readyState === 'complete') {
        const composer = _queryWithFallback('composer', null, { silent: true });
        if (composer && composer.getAttribute('aria-disabled') !== 'true' && !composer.closest('[aria-busy="true"]')) {
          await sleep(250); return true; // settle cho React hydrate
        }
      }
      await sleep(250);
    }
    return false;
  }

  // ============ HELPER: Deactivate image mode TRƯỚC khi submit text (Prompt enhance flow) ============
  // ChatGPT giữ image mode active xuyên session (sticky). Nếu Prompt node enhance gọi text-only mà
  // image mode vẫn ON → ChatGPT có thể trả về image hoặc reply mang context image-gen → response sai.
  // Giải pháp: detect image mode active (qua ratio button visible) → click composer plus → click
  // "Create image" item để toggle off → quay về plain chat.
  async function deactivateImageModeIfActive() {
    // UI 2026-08: detect active qua pill image_mode_pill (ratio_button đã gỡ); giữ ratio_button cho UI cũ.
    const active = _queryWithFallback('image_mode_pill') || _queryWithFallback('ratio_button');
    if (!active) return false; // Đã ở text mode

    console.log('[ChatGPT] Image mode đang active — deactivate trước khi submit text');

    // Click element qua cả PointerEvent chain + React onClick (Radix menuitemradio cần onSelect)
    const clickEl = (el) => {
      if (!el) return;
      try { simulateClick(el); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#clickEl', _); }
      const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
      const props = propsKey ? el[propsKey] : null;
      try {
        if (props && typeof props.onSelect === 'function') {
          props.onSelect({ preventDefault() {}, stopPropagation() {} });
        } else if (props && typeof props.onClick === 'function') {
          props.onClick({ preventDefault() {}, stopPropagation() {}, nativeEvent: new MouseEvent('click'), type: 'click', target: el, currentTarget: el });
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#clickEl', _); }
    };

    // 1. Đóng menu cũ nếu đang mở
    try {
      const openMenu = _queryWithFallback('open_menu');
      if (openMenu) {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(80);
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#clickEl', _); }

    // 2. Click composer plus
    const plusBtn = _queryWithFallback('plus_button');
    if (!plusBtn) {
      console.warn('[ChatGPT] deactivateImageMode: composer plus button không tìm thấy');
      return false;
    }
    clickEl(plusBtn);

    // 3. Chờ menu render — Server-Only: dynamic open_menu selector
    let menu = null;
    for (let i = 0; i < 6; i++) {
      await sleep(80);
      menu = _queryWithFallback('open_menu', null, { silent: true });
      if (menu) break;
    }
    if (!menu) {
      console.warn('[ChatGPT] deactivateImageMode: menu không render');
      return false;
    }

    // 4. Tìm "Create image" item và toggle off — match text từ api_config (đa ngôn ngữ)
    const createImgPatterns = await _getCreateImagePatterns();
    const items = _queryAllWithFallback('menu_items', null, menu);
    for (const item of items) {
      const text = (item.innerText || '').trim().toLowerCase();
      if (_matchesCreateImage(text, createImgPatterns)) {
        const checked = item.getAttribute('aria-checked') === 'true' || item.getAttribute('data-state') === 'checked';
        if (checked) {
          clickEl(item);
          console.log('[ChatGPT] deactivateImageMode: đã click toggle off');
        }
        break;
      }
    }

    // 5. Đóng menu (Escape) — phòng trường hợp menu không tự đóng
    await sleep(150);
    try {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#clickEl', _); }
    await sleep(150);

    // 6. Verify image mode OFF — UI 2026-08: qua pill image_mode_pill (ratio_button đã gỡ); giữ ratio_button UI cũ.
    const stillActive = !!_queryWithFallback('image_mode_pill') || !!_queryWithFallback('ratio_button');
    return !stillActive;
  }

  // ============ HELPER: đọc api_config chatgpt từ chrome.storage ============
  async function _getChatGPTApiConfig(key) {
    try {
      const result = await new Promise((r) => chrome.storage.local.get(['seosona_provider_api_configs'], r));
      return result?.seosona_provider_api_configs?.data?.chatgpt?.configs?.[key] ?? null;
    } catch (_) { return null; }
  }

  // ============ HELPER: match item text "Create image" theo api_config (đa ngôn ngữ) ============
  // Server-Only: đọc ui_text_patterns.create_image_menu_text (pipe-separated, vd
  // "create image|create an image|tạo hình ảnh") thay vì hardcode English. UI ChatGPT tiếng Việt
  // nhãn là "Tạo hình ảnh" → hardcode EN cũ trượt → fallback prefix. Fallback EN nếu config miss.
  async function _getCreateImagePatterns() {
    const cfg = await _getChatGPTApiConfig('ui_text_patterns');
    const raw = cfg?.create_image_menu_text || 'create image|create an image';
    return raw.split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  function _matchesCreateImage(text, patterns) {
    const t = (text || '').trim().toLowerCase();
    return (patterns || []).some((p) => t === p || t.startsWith(p));
  }

  // ============ selectChatGPTModel — chọn GPT-5.5 variant (Instant/Thinking) ============
  // Mở model switcher pill trong composer → click menuitemradio khớp text. Match by TEXT từ
  // api_config chatgpt_model_labels (đa ngôn ngữ) — KHÔNG dùng data-testid (chứa version gpt-5-5).
  async function selectChatGPTModel(modelValue) {
    if (!modelValue) return false;
    const labelCfg = await _getChatGPTApiConfig('chatgpt_model_labels');
    // Fallback: value chính là text menu (Instant/Thinking) khi config chưa load.
    const rawLabels = labelCfg?.[modelValue] ?? modelValue;
    const targetTexts = String(rawLabels).split('|').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (targetTexts.length === 0) return false;

    // Click qua PointerEvent + React onSelect (Radix menuitemradio cần onSelect).
    const clickEl = (el) => {
      if (!el) return;
      try { simulateClick(el); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#clickEl', _); }
      const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
      const props = propsKey ? el[propsKey] : null;
      try {
        if (props && typeof props.onSelect === 'function') {
          props.onSelect({ preventDefault() {}, stopPropagation() {} });
        } else if (props && typeof props.onClick === 'function') {
          props.onClick({ preventDefault() {}, stopPropagation() {}, nativeEvent: new MouseEvent('click'), type: 'click', target: el, currentTarget: el });
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#clickEl', _); }
    };
    const closeMenu = () => { try { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#closeMenu', _); } };

    const switcherBtn = _queryWithFallback('model_switcher_button', null, { silent: true });
    if (!switcherBtn) { console.warn('[ChatGPT] selectChatGPTModel: model_switcher_button không thấy'); return false; }

    // Pill đã hiển thị đúng model → skip (tránh mở menu thừa).
    const curText = (switcherBtn.innerText || switcherBtn.textContent || '').trim().toLowerCase();
    if (targetTexts.some(t => curText === t || curText.includes(t))) {
      console.log(`[ChatGPT] selectChatGPTModel: "${modelValue}" đã active`);
      return true;
    }

    clickEl(switcherBtn);

    // Chờ menu render (menuitemradio). Text-match tự scope đúng menu model (chỉ menu này có Instant/Thinking).
    let items = [];
    for (let i = 0; i < 10; i++) {
      await sleep(100);
      items = Array.from(_queryAllWithFallback('mode_menu_item'));
      if (items.length > 0) break;
    }
    if (items.length === 0) {
      console.warn('[ChatGPT] selectChatGPTModel: menu model không render');
      closeMenu();
      return false;
    }

    for (const item of items) {
      const txt = (item.innerText || item.textContent || '').trim().toLowerCase();
      if (targetTexts.some(t => txt === t || txt.includes(t))) {
        clickEl(item);
        console.log(`[ChatGPT] selectChatGPTModel: clicked "${(item.innerText || '').trim()}" cho "${modelValue}"`);
        await sleep(200);
        closeMenu();
        return true;
      }
    }
    console.warn(`[ChatGPT] selectChatGPTModel: KHÔNG match "${modelValue}". Items: [${items.map(i => (i.innerText || '').trim()).join(' | ')}]`);
    closeMenu();
    return false;
  }

  // ============ HELPER: Activate image mode VÀ chọn ratio TRƯỚC khi submit ============
  // Flow thực tế ChatGPT: Click plus → Create image → chọn ratio → upload refs → input text → submit
  // Ratio mapping: '1:1' | '16:9' | '9:16' (ChatGPT chỉ hỗ trợ 3 ratio này)
  // UI 2026-08: ChatGPT GỠ nút aspect ratio → nhúng ratio thành câu lệnh ở CUỐI prompt (ChatGPT đọc
  // instruction để gen đúng tỉ lệ). Nhận cả value gốc ('9:16') lẫn tên normalize ('story'/'widescreen').
  function ratioToPromptSuffix(ratio) {
    const map = {
      story: '9:16 (portrait)', '9:16': '9:16 (portrait)',
      portrait: '3:4 (portrait)', '3:4': '3:4 (portrait)',
      square: '1:1 (square)', '1:1': '1:1 (square)',
      landscape: '4:3 (landscape)', '4:3': '4:3 (landscape)',
      widescreen: '16:9 (widescreen)', '16:9': '16:9 (widescreen)',
    };
    const label = map[ratio];
    return label ? `\n\nGenerate the image in ${label} aspect ratio.` : '';
  }

  async function activateImageMode(ratio = '1:1') {
    const ratioBtn = _queryWithFallback('ratio_button');
    // UI 2026-08: ChatGPT GỠ nút ratio → detect image mode active qua pill "Create image"
    // (`image_mode_pill` = picture_v2 trong editor). ratio_button giữ cho UI cũ (fallback).
    const modeActive = !!_queryWithFallback('image_mode_pill') || !!ratioBtn;
    // Mode đã bật = pill/ratio_button hiện sẵn HOẶC click "Create image" thành công. Tách khỏi việc
    // chọn ratio/verify → tránh false-negative khiến caller thêm prefix dù mode ĐÃ active (bug 2026-06-22).
    let modeToggled = modeActive;

    // Click element qua cả PointerEvent chain + React onClick
    const clickEl = (el) => {
      if (!el) return;
      try { simulateClick(el); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#clickEl', _); }
      const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
      const props = propsKey ? el[propsKey] : null;
      try {
        if (props && typeof props.onSelect === 'function') {
          props.onSelect({ preventDefault() {}, stopPropagation() {} });
        } else if (props && typeof props.onClick === 'function') {
          props.onClick({ preventDefault() {}, stopPropagation() {}, nativeEvent: new MouseEvent('click'), type: 'click', target: el, currentTarget: el });
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#clickEl', _); }
    };

    // Port 1.1.49 TIER 1: activate image mode qua mention "@" (popover anchored composer, scoped
    // menu_items → KHÔNG quét document → không click nhầm link conversation sidebar). Ổn định hơn
    // plus-menu. Cần seed local-config key 'mention_menu'; chưa seed → return false → fallback TIER 2.
    const _activateViaMention = async () => {
      if (!_getDynamicSelector('mention_menu')?.selectors?.length) return false;
      const editor = _queryWithFallback('composer', null, { silent: true });
      if (!editor) return false;
      try {
        editor.focus();
        await sleep(120);
        document.execCommand('insertText', false, '@');
        let menuEl = null;
        for (let i = 0; i < 15; i++) {
          await sleep(150);
          menuEl = _queryWithFallback('mention_menu', null, { silent: true });
          if (menuEl) break;
        }
        if (!menuEl) throw new Error('mention menu không mở');
        const patterns = await _getCreateImagePatterns();
        const items = _queryAllWithFallback('menu_items', null, menuEl); // scoped → sidebar không lọt
        let target = null;
        for (const it of items) {
          if (_matchesCreateImage((it.innerText || '').trim().toLowerCase(), patterns)) { target = it; break; }
        }
        if (!target) throw new Error('không thấy item Tạo hình ảnh trong mention menu');
        clickEl(target);
        for (let i = 0; i < 15; i++) {
          await sleep(150);
          if (_queryWithFallback('image_mode_pill', null, { silent: true })) {
            console.log('[ChatGPT] activateImageMode: Tier 1 mention "@" OK — pill active');
            return true;
          }
        }
        throw new Error('pill không xuất hiện sau khi chọn');
      } catch (e) {
        console.warn('[ChatGPT] activateImageMode Tier 1 mention fail:', e.message, '— dọn "@" + fallback plus menu');
        try {
          document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(100);
          if (!_queryWithFallback('image_mode_pill', null, { silent: true, scope: editor })
              && (editor.textContent || '').trim().length > 0) {
            editor.focus();
            document.execCommand('selectAll', false, null);
            await sleep(50);
            document.execCommand('delete', false, null);
            await sleep(100);
          }
        } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#_activateViaMention', _); }
        return false;
      }
    };

    // Nếu image mode chưa active → activate
    if (!modeActive) {
      // TIER 1: mention "@" — thành công thì bỏ qua plus-menu (TIER 2 bên dưới).
      const _tier1Ok = await _activateViaMention();
      if (_tier1Ok) modeToggled = true;
      if (!_tier1Ok) {
      console.log('[ChatGPT] Image mode chưa active — đang activate...');

      // 1. Đóng menu cũ nếu đang mở
      try {
        const openMenu = _queryWithFallback('open_menu');
        if (openMenu) {
          document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(80);
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#_activateViaMention', _); }

      // 2. Click composer plus
      const plusBtn = _queryWithFallback('plus_button');
      if (!plusBtn) {
        console.warn('[ChatGPT] activateImageMode: composer plus button không tìm thấy');
        return false;
      }
      clickEl(plusBtn);

      // 3. Chờ menu render — Server-Only: dynamic open_menu selector. Tăng 6→10 (~800ms) cho
      // menu render chậm (tab throttle / ChatGPT UI mới).
      let menu = null;
      for (let i = 0; i < 10; i++) {
        await sleep(80);
        menu = _queryWithFallback('open_menu', null, { silent: true });
        if (menu) break;
      }
      // Fallback (ChatGPT đổi DOM menu — open_menu container selector stale): menu Radix render ở
      // portal, role có thể đổi → KHÔNG bail sớm. Quét item "Create image" trên TOÀN document
      // (menu_items lọc theo role + text vẫn match đúng item; nếu menu thật chưa mở → items rỗng → bail dưới).
      if (!menu) {
        console.warn('[ChatGPT] activateImageMode: open_menu không match — fallback quét toàn document tìm "Create image"');
        menu = document;
      }

      // 4. Click "Create image" để toggle on — match text từ api_config (đa ngôn ngữ)
      const createImgPatterns = await _getCreateImagePatterns();
      const items = _queryAllWithFallback('menu_items', null, menu);
      let found = false;
      for (const item of items) {
        // ROOT CAUSE "back chat cũ" (2026-07-09): fallback menu=document quét TOÀN trang —
        // sidebar chứa conversation gen ảnh cũ auto-title "Tạo hình ảnh..." → click nhầm LINK
        // conversation = navigate về chat cũ (không phải ChatGPT tự kéo). Loại mọi item thuộc
        // sidebar/nav/history/link conversation; menu item thật nằm trong popover, không có href.
        if (item.closest('nav, aside, [class*="sidebar"], a[href*="/c/"]')) continue;
        const text = (item.innerText || '').trim().toLowerCase();
        if (_matchesCreateImage(text, createImgPatterns)) {
          const checked = item.getAttribute('aria-checked') === 'true' || item.getAttribute('data-state') === 'checked';
          if (!checked) {
            clickEl(item);
            console.log('[ChatGPT] activateImageMode: đã click toggle on "Create image"');
          }
          found = true;
          modeToggled = true; // đã bật mode (click hoặc đã checked) → success bất kể ratio verify
          break;
        }
      }
      if (!found) {
        console.warn('[ChatGPT] activateImageMode: không tìm thấy "Create image" item');
        // Đóng menu
        try { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#_activateViaMention', _); }
        return false;
      }

      // 5. Chờ ratio button xuất hiện — UI 2026-08 ĐÃ GỠ ratio → break sớm khi pill xác nhận mode
      // active (khỏi chờ vô ích nút không bao giờ xuất hiện). Ratio set qua prompt (caller append).
      let newRatioBtn = null;
      for (let i = 0; i < 8; i++) {
        await sleep(100);
        newRatioBtn = _queryWithFallback('ratio_button', null, { silent: true });
        if (newRatioBtn || _queryWithFallback('image_mode_pill', null, { silent: true })) break;
      }
      if (!newRatioBtn) {
        console.log('[ChatGPT] activateImageMode: không có ratio button (UI mới) — bỏ qua chọn ratio, ratio đi qua prompt');
      }
      // Delay để ChatGPT UI stabilize trước khi click ratio
      await sleep(getMacroDelay());
      } // end TIER 2 (plus menu) — Port 1.1.49
    }

    // 6. Chọn ratio nếu được chỉ định VÀ UI còn nút ratio (UI mới: skip, ratio đã nhúng vào prompt)
    let ratioSelected = false;
    const _ratioBtnNow = _queryWithFallback('ratio_button', null, { silent: true });
    if (ratio && _ratioBtnNow) {
      // Retry tìm ratio button (có thể cần thời gian render)
      let newRatioBtn = null;
      for (let i = 0; i < 5; i++) {
        newRatioBtn = _queryWithFallback('ratio_button', null, { silent: i > 0 });
        if (newRatioBtn) break;
        await sleep(100);
      }
      if (newRatioBtn) {
        // Map ratio key → aria-label (sync với background.js ARIA_LABEL_MAP)
        const RATIO_ARIA_MAP = {
          story: 'Story 9:16',
          portrait: 'Portrait 3:4',
          square: 'Square 1:1',
          landscape: 'Landscape 4:3',
          widescreen: 'Widescreen 16:9',
          '9:16': 'Story 9:16',
          '3:4': 'Portrait 3:4',
          '1:1': 'Square 1:1',
          '4:3': 'Landscape 4:3',
          '16:9': 'Widescreen 16:9',
        };
        const targetAriaLabel = RATIO_ARIA_MAP[ratio] || null;

        // Delay trước khi click để UI stable (tăng từ 200 → 300ms)
        await sleep(300);
        // Click ratio button để mở dropdown
        clickEl(newRatioBtn);
        console.log('[ChatGPT] activateImageMode: đã click ratio button, waiting for dropdown...');

        // Chờ dropdown render với retry (tăng delay 80 → 120ms, retry 6 → 10)
        let ratioMenu = null;
        for (let i = 0; i < 10; i++) {
          await sleep(120);
          // Try open_menu first, then fallback to listbox (ChatGPT ratio picker uses listbox)
          ratioMenu = _queryWithFallback('open_menu', null, { silent: true });
          if (!ratioMenu) {
            ratioMenu = document.querySelector('[role="listbox"]');
          }
          if (ratioMenu) break;
        }

        // Collect ratio items từ menu hoặc fallback tìm trong document
        let ratioItems = [];
        if (ratioMenu) {
          console.log('[ChatGPT] activateImageMode: dropdown found, tagName:', ratioMenu.tagName, 'role:', ratioMenu.getAttribute('role'));
          ratioItems = _queryAllWithFallback('menu_items', null, ratioMenu);
          // Fallback: tìm options trong listbox
          if (ratioItems.length === 0) {
            ratioItems = ratioMenu.querySelectorAll('[role="option"], [role="menuitemradio"], [role="menuitem"]');
          }
          console.log('[ChatGPT] activateImageMode: found', ratioItems.length, 'items in dropdown');
          // Debug: log aria-labels of items
          if (ratioItems.length > 0) {
            const labels = Array.from(ratioItems).map(it => it.getAttribute('aria-label') || it.innerText?.substring(0, 30)).join(', ');
            console.log('[ChatGPT] activateImageMode: item labels:', labels);
          }
        } else {
          console.log('[ChatGPT] activateImageMode: dropdown NOT found after retries');
        }
        // Final fallback: tìm aria-label match trực tiếp trong document
        if (ratioItems.length === 0 && targetAriaLabel) {
          const directMatch = document.querySelector(`[aria-label="${targetAriaLabel}"]`);
          if (directMatch) {
            ratioItems = [directMatch];
            console.log('[ChatGPT] activateImageMode: found ratio via direct aria-label query');
          } else {
            console.log('[ChatGPT] activateImageMode: direct aria-label query failed for:', targetAriaLabel);
          }
        }

        let found = false;
        for (const item of ratioItems) {
          // Primary: match aria-label exact
          if (targetAriaLabel && item.getAttribute('aria-label') === targetAriaLabel) {
            clickEl(item);
            console.log('[ChatGPT] activateImageMode: đã chọn ratio via aria-label', ratio, targetAriaLabel);
            found = true;
            break;
          }
        }
        // Fallback: match text case-insensitive
        if (!found) {
          const ratioLower = ratio.toLowerCase();
          for (const item of ratioItems) {
            const text = (item.innerText || '').trim().toLowerCase();
            if (text === ratioLower || text.includes(ratioLower) || text.includes(ratio)) {
              clickEl(item);
              console.log('[ChatGPT] activateImageMode: đã chọn ratio via text fallback', ratio);
              found = true;
              break;
            }
          }
        }
        await sleep(150);
        // Đóng menu nếu còn mở
        try { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#_activateViaMention', _); }
        ratioSelected = found;
      }
    }

    // 7. Verify image mode đã active
    // Return true nếu ratio đã được chọn thành công, hoặc ratio_button còn visible
    await sleep(200);
    // UI 2026-08: verify qua pill image_mode_pill (ratio_button đã gỡ); giữ ratio_button cho UI cũ.
    const verified = !!_queryWithFallback('image_mode_pill') || !!_queryWithFallback('ratio_button');
    console.log('[ChatGPT] activateImageMode: modeToggled =', modeToggled, 'verified =', verified, 'ratioSelected =', ratioSelected);
    // [IMG_VERIFY] Kết quả activate: pill có xuất hiện không (= image mode thật sự ON) + ratio truyền vào.
    console.log('[IMG_VERIFY] activateImageMode DONE: pill=' + (!!_queryWithFallback('image_mode_pill', null, { silent: true }))
      + ' | ratioBtn=' + (!!_queryWithFallback('ratio_button', null, { silent: true }))
      + ' | result=' + (modeToggled || ratioSelected || verified) + ' | ratio="' + ratio + '"');
    // modeToggled (đã click Create image / mode sẵn active) là tín hiệu CHÍNH → tránh thêm prefix thừa.
    return modeToggled || ratioSelected || verified;
  }

  // AI Agent prefix — Server-Only (2026-05-30 refactor).
  // Đọc từ PCM cache `chrome.storage.local.seosona_provider_api_configs.data.chatgpt.configs.ai_agent_prefix.{locale}`.
  // Admin edit qua /admin/providers/chatgpt/api-configs → SSE broadcast → next submit dùng prefix mới.
  // Fallback: locale missing → EN. Config missing → '' (skip prefix wrap, submit raw prompt).
  async function getEnhancePrefix() {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['seosona_provider_api_configs', 'af_locale'], r => resolve(r));
      });
      const locale = result?.af_locale || 'en';
      const prefixMap = result?.seosona_provider_api_configs?.data?.chatgpt?.configs?.ai_agent_prefix;
      if (!prefixMap || typeof prefixMap !== 'object') {
        console.warn('[AI Agent] ai_agent_prefix config missing for chatgpt — skip prefix wrap (raw prompt)');
        return '';
      }
      return prefixMap[locale] || prefixMap.en || '';
    } catch (e) {
      console.warn('[AI Agent] getEnhancePrefix error:', e.message, '— skip prefix wrap');
      return '';
    }
  }

  // ============ HELPER: Inject ref images vào ChatGPT (extract từ Phase X) ============
  // Dùng chung cho cả listener `chatAI:execute` (Phase X) và `chatgpt:submitAndWait` (CG-3).
  async function injectRefImages(images) {
    if (!images || images.length === 0) return true;

    // CRITICAL — remove ref images cũ TRƯỚC upload mới.
    // Nếu user đã upload ref ở session trước (chưa clear), upload mới sẽ append → preview
    // có ref cũ + ref mới → submit context sai. Match Flow/Grok pattern.
    await removeExistingChatGPTRefImages();
    await sleep(300);

    // Convert base64 thành File objects
    const files = images.map(img => {
      const binary = atob(img.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new File([bytes], img.name || 'image.png', { type: img.type || 'image/png' });
    });

    // Tìm input file — RETRY trước khi fallback click plus (tránh mở menu reset image mode)
    // Input #upload-photos có class sr-only (hidden) nhưng LUÔN tồn tại trong DOM
    let fileInput = null;
    for (let retry = 0; retry < 15; retry++) { // ~6s: #upload-photos có thể mount trễ sau load/reload
      fileInput = _queryWithFallback('file_input');
      if (fileInput) break;
      await sleep(400);
    }

    // Server-Only: không fallback inline hardcode

    // LAST RESORT: Click plus button — có thể RESET IMAGE MODE!
    // Sau đó step 4 (ACTIVATE IMAGE MODE) trong chatgpt:submitAndWait — chạy SAU model (4a) +
    // upload → là thao tác composer cuối trước submit → re-activate image mode (survive mọi reset).
    if (!fileInput) {
      console.warn('[ChatGPT] #upload-photos không tìm thấy, fallback click plus button');
      const plusBtn = _queryWithFallback('plus_button');
      if (plusBtn) {
        simulateClick(plusBtn);
        await sleep(300);
        fileInput = _queryWithFallback('file_input');
        // Đóng menu ngay lập tức để giảm thiểu ảnh hưởng đến state
        try {
          document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#injectRefImages', _); }
        await sleep(100);
      }
    }

    if (!fileInput) {
      console.error('[ChatGPT] Không tìm thấy input file để upload ref image');
      return false;
    }

    // Inject files qua DataTransfer
    const dt = new DataTransfer();
    // Đếm img trong composer form TRƯỚC upload → phát hiện preview mới (ảnh attach).
    const _composerEl = _queryWithFallback('composer');
    const _scope = (_composerEl && _composerEl.closest('form')) || document.body;
    const _beforeImgs = _scope.querySelectorAll('img').length;
    files.forEach(f => dt.items.add(f));
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Poll chờ preview ảnh thật sự attach (img mới xuất hiện) thay vì chờ cố định 2s —
    // ảnh lớn (context-menu photo 1536) upload >2s sẽ bị submit text-only nếu chỉ chờ cứng.
    // Bug 57: interruptibleSleep để user forceStop break sớm. Fallback timeout ~9s → submit best-effort.
    let _attached = false;
    for (let i = 0; i < 30; i++) {
      await interruptibleSleep(300, 'await-upload-preview');
      if (__chatgptAbort) break;
      if (_scope.querySelectorAll('img').length > _beforeImgs) { _attached = true; break; }
    }
    await sleep(_attached ? 400 : 600); // settle sau khi preview xuất hiện

    // Phương án A: chờ ref upload XONG (overlay/.cursor-wait tan) — preview hiện sớm (blob) nhưng
    // upload server chưa xong; submit lúc này = ảnh chưa đính kèm. Cap ~15s, abort-aware.
    for (let i = 0; i < 50; i++) {
      if (__chatgptAbort) break;
      if (!_isRefUploading()) break;
      await interruptibleSleep(300, 'await-ref-upload-complete');
    }
    // Delay giữa upload ref_img & input prompt — tránh thao tác quá nhanh khi DOM chưa settle.
    await sleep(getMacroDelay());
    return true;
  }

  // ============ HELPER: Inject text + click submit (extract từ Phase X) ============
  // ============================================================================
  //  ChatGPT injectTextAndSubmit — pipeline 7 steps với fallback chain
  //  Test verified 2026-05-09 (chatgpt-submit-prompt-test.txt)
  // ============================================================================
  //
  //  ┌─ CLEAR (Step 1b) — chỉ chạy khi editor có stale text ─────────────────┐
  //  │ Tier 1 'selectAllDelete'   PRIMARY  ✅ verified work                   │
  //  │   → execCommand('selectAll') + execCommand('delete')                  │
  //  │ Tier 2 'innerHTMLReset'    FALLBACK ✅ verified work (Test 7 manual)   │
  //  │   → editor.innerHTML = '<p><br/></p>' + InputEvent('input')           │
  //  └────────────────────────────────────────────────────────────────────────┘
  //
  //  ┌─ INSERT (Step 2) ─────────────────────────────────────────────────────┐
  //  │ Tier 1 'pasteEvent'        PRIMARY  ✅ verified work (smoke test)      │
  //  │   → ClipboardEvent('paste') + DataTransfer text/plain                 │
  //  │ Tier 2 'execCommand'       FALLBACK ✅ verified work (Test 2)          │
  //  │   → document.execCommand('insertText', false, text)                   │
  //  │ Tier 3 'innerHTMLReplace'  LAST     ✅ verified work (Test 3)          │
  //  │   → editor.innerHTML = '<p>...</p>' + InputEvent('input')             │
  //  │ ❌ 'reactPropsBeforeInput'  DEAD     ❌ verified fail (Test 1)          │
  //  │   → editor #prompt-textarea KHÔNG có __reactProps$ key → ĐÃ BỎ        │
  //  └────────────────────────────────────────────────────────────────────────┘
  //
  //  ┌─ SUBMIT (Step 3-7) ───────────────────────────────────────────────────┐
  //  │ Tier 1 'enterKey'          PRIMARY  ✅ verified work (smoke test)      │
  //  │   → KeyboardEvent('keydown' + 'keypress' + 'keyup') trên editor       │
  //  │ Tier 2 'simulateClick'     FALLBACK ✅ verified work (Test 4)          │
  //  │   → PointerEvent + MouseEvent chain trên submit button                │
  //  │ Tier 3 'reactOnClick'      FALLBACK ✅ verified work (Test 5)          │
  //  │   → submitBtn.__reactProps.onClick (plain object, KHÔNG có isTrusted) │
  //  │ Tier 4 'formRequestSubmit' LAST     ✅ verified work (Test 6)          │
  //  │   → form.requestSubmit(submitBtn) — HTML standard, native trusted     │
  //  │   ⭐ Resilient nhất khi OpenAI siết trust check tương lai             │
  //  └────────────────────────────────────────────────────────────────────────┘
  //
  //  ┌─ Force test flag (cross-world dataset, set qua DevTools console) ─────┐
  //  │ document.documentElement.dataset.seosonaChatgptClearForce  = '...'        │
  //  │ document.documentElement.dataset.seosonaChatgptInsertForce = '...'        │
  //  │ document.documentElement.dataset.seosonaChatgptSubmitForce = '...'        │
  //  │ Reset: delete document.documentElement.dataset.seosonaChatgpt<X>Force     │
  //  └────────────────────────────────────────────────────────────────────────┘
  // ============================================================================
  // Auto-scroll conversation xuống đáy để user thấy ảnh/prompt đang gen (gọi sau submit + mỗi poll wait).
  // Cache container cuộn (tìm 1 lần) để gọi lặp rẻ. Server-Only: KHÔNG hardcode class — dò overflowY.
  let _chatScrollEl = null;
  let _chatScrollElFoundAt = 0;
  function _findChatScrollEl() {
    const root = document.querySelector('main') || document.body;
    let best = null, bestH = 0;
    root.querySelectorAll('*').forEach((e) => {
      const oy = getComputedStyle(e).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 80 && e.scrollHeight > bestH) { best = e; bestH = e.scrollHeight; }
    });
    return best;
  }
  function _scrollChatToBottom() {
    try {
      // Re-find định kỳ 5s: cache có thể pin nhầm element (code block overflow trong tin nhắn cũ)
      // hoặc scroller đổi sau SPA nav mà node cũ vẫn isConnected → scroll vào chỗ vô nghĩa mãi.
      if (!_chatScrollEl || !_chatScrollEl.isConnected || Date.now() - _chatScrollElFoundAt > 5000) {
        _chatScrollEl = _findChatScrollEl();
        _chatScrollElFoundAt = Date.now();
      }
      if (_chatScrollEl) _chatScrollEl.scrollTop = _chatScrollEl.scrollHeight;
      else window.scrollTo(0, document.documentElement.scrollHeight);
      // Tier 2: kéo turn cuối vào viewport — trúng scroller thật kể cả khi heuristic pin nhầm,
      // đồng thời ép ChatGPT render phần content lazy/virtualized mới nhất.
      const _turns = _queryAllWithFallback('conversation_turn');
      const _last = _turns && _turns[_turns.length - 1];
      if (_last) _last.scrollIntoView({ block: 'end' });
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#_scrollChatToBottom', _); }
  }

  async function injectTextAndSubmit(text) {
    const log = (...args) => console.log('[ChatGPT-submit]', ...args);

    // 1. Tìm editor — Server-Only: dynamic composer selector với retry
    let editor = null;
    const editorTimeout = Date.now() + 10000;
    while (Date.now() < editorTimeout) {
      editor = _queryWithFallback('composer', null, { silent: true });
      if (editor) break;
      await sleep(200);
    }
    if (!editor) {
      log('FAIL: EDITOR_NOT_FOUND');
      throw new Error('EDITOR_NOT_FOUND');
    }
    log('Step 1: Editor found', editor.id || editor.className);

    editor.focus();
    await sleep(150);

    // 1b. CLEAR editor — Force flag: document.documentElement.dataset.seosonaChatgptClearForce
    //     Tiers: 'selectAllDelete' (primary), 'innerHTMLReset' (fallback)
    //     CRITICAL: KHÔNG clear khi editor đã empty (sẽ phá ProseMirror state).
    const clearForce = document.documentElement.dataset.seosonaChatgptClearForce || null;
    if (clearForce) log('Step 1b [FORCE=' + clearForce + ']');
    // ChatGPT image mode mới (2026-08): "Create image" = inline pill <span contenteditable=false
    // data-inline-selection-pill data-id=picture_v2> NẰM TRONG editor. Clear (selectAll+delete /
    // innerHTML='') sẽ XÓA pill → mất image mode → submit thành text. Khi có pill → KHÔNG clear +
    // chèn text APPEND sau pill (paste). Mọi guard gate trên modePill → submit text thường KHÔNG đổi.
    // Server-Only: detect pill qua image_mode_pill selectors động (UI xoay giữa nhiều biến thể:
    // data-system-hint-type / data-inline-selection-pill) — scope editor vì logic dưới chỉ quan tâm
    // pill NẰM TRONG editor (clear/caret). Giữ fallback selector cũ cho config stale.
    const _findPillInEditor = (root) => _queryWithFallback('image_mode_pill', null, { scope: root || editor, silent: true })
      || (root || editor).querySelector('[data-inline-selection-pill]');
    const modePill = _findPillInEditor();
    if (modePill) {
      log('Step 1b: image mode pill present (' + (modePill.getAttribute('data-id') || modePill.getAttribute('data-system-hint-type') || '') + ') — SKIP full clear để giữ mode, sẽ append text sau pill');
      // Draft cũ persist trên homepage (cùng class bug ref_img) → stale text NGOÀI pill phải
      // xóa CHỌN LỌC bằng Range: xóa sau pill rồi trước pill, giữ nguyên pill.
      try {
        const _clone = editor.cloneNode(true);
        for (let _p = _findPillInEditor(_clone); _p; _p = _findPillInEditor(_clone)) _p.remove();
        const _stale = (_clone.textContent || '').trim();
        if (_stale.length > 0) {
          log('Step 1b: stale text ngoài pill (len=' + _stale.length + ', head="' + _stale.slice(0, 30) + '") — selective clear giữ pill');
          const _delRange = (setup) => {
            const r = document.createRange();
            r.selectNodeContents(editor);
            setup(r);
            if (r.collapsed) return;
            const s = window.getSelection();
            s.removeAllRanges(); s.addRange(r);
            document.execCommand('delete', false, null);
          };
          // Thứ tự: xóa TRƯỚC pill trước, SAU pill cuối → ProseMirror selection đọng NGAY SAU pill
          // (xóa before-pill cuối → PM selection trước pill → paste chèn TRƯỚC pill, prompt đè mode).
          let _pill = modePill;
          _delRange(r => r.setEndBefore(_pill));
          _pill = _findPillInEditor() || _pill; // ProseMirror có thể re-render
          _delRange(r => r.setStartAfter(_pill));
          _pill = _findPillInEditor();
          if (!_pill) {
            log('Step 1b WARN: pill biến mất sau selective clear — image mode có thể đã mất');
          } else {
            // Caret tường minh SAU pill + chờ PM sync selectionchange — paste ngay 2ms sau set caret
            // → PM dùng selection cũ → chèn sai vị trí (verified log 18:26).
            try {
              const rc = document.createRange(); rc.setStartAfter(_pill); rc.collapse(true);
              const sc = window.getSelection(); sc.removeAllRanges(); sc.addRange(rc);
            } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#_delRange', _); }
            log('Step 1b: selective clear xong, editor len=' + (editor.textContent || '').length);
          }
          await sleep(200);
        }
      } catch (e) {
        log('Step 1b selective clear failed (non-fatal):', e.message);
      }
      // Caret về CUỐI editor (sau pill) → paste/insertText append sau pill, không đụng pill.
      try {
        const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#_delRange', _); }
    }
    const editorTextBeforeClear = (editor.textContent || '').trim();
    if (!modePill && (editorTextBeforeClear.length > 0 || clearForce)) {
      log('Step 1b: Clearing editor (length=' + editorTextBeforeClear.length + ')');
      try {
        // Tier selectAllDelete (primary)
        if (!clearForce || clearForce === 'selectAllDelete') {
          log('Step 1b[selectAllDelete]: execCommand selectAll+delete');
          document.execCommand('selectAll', false, null);
          await sleep(50);
          document.execCommand('delete', false, null);
          await sleep(100);
        }
        // Tier innerHTMLReset (fallback nếu primary fail HOẶC force)
        const stillHasText = (editor.textContent || '').trim().length > 0;
        if (clearForce === 'innerHTMLReset' || (!clearForce && stillHasText)) {
          log('Step 1b[innerHTMLReset]: editor.innerHTML reset');
          editor.innerHTML = '<p><br class="ProseMirror-trailingBreak"></p>';
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
          await sleep(80);
        }
        log('Step 1b OK: editor cleared, current length=', editor.textContent.length);
      } catch (clearErr) {
        log('Step 1b clear failed (non-fatal):', clearErr.message);
      }
      editor.focus();
      await sleep(80);
    } else {
      log('Step 1b: Editor đã empty, skip clear (tránh phá ProseMirror state)');
    }

    // 2. INSERT — Force flag: document.documentElement.dataset.seosonaChatgptInsertForce
    //    Tiers: 'pasteEvent' (primary) | 'execCommand' | 'innerHTMLReplace'
    //    BỎ tier reactPropsBeforeInput: VERIFIED dead code (Test 1 2026-05-09)
    //      → ChatGPT ProseMirror editor #prompt-textarea KHÔNG có __reactProps$ key
    const insertForce = document.documentElement.dataset.seosonaChatgptInsertForce || null;
    if (insertForce) log('Step 2 [FORCE=' + insertForce + ']');
    // Bug fix 2026-06-13: trước check 20 chars đầu → text dài (>1000 chars) bị ProseMirror trim
    // tail vẫn pass `inserted()` → KHÔNG fallback tier → submit prompt thiếu.
    // Fix: length ≥95% + head 20 + tail 20 (catch case truncate giữa chừng).
    // [Long-prompt fix] ChatGPT auto-đóng prompt DÀI (>4-5K) thành file .txt → editor rỗng. Baseline số
    // file-tile text TRƯỚC khi chèn → phát hiện file MỚI (ảnh ref KHÔNG có expand-file-tile nên ko nhiễu).
    const _fileTileCount = () => { try { return _queryAllWithFallback('text_file_tile', null).length; } catch (_) { return 0; } };
    const _fileTileBaseline = _fileTileCount();

    const inserted = () => {
      // (b) Prompt đã được đóng thành file .txt mới (file-tile tăng) → coi như chèn xong (dù editor rỗng).
      if (_fileTileCount() > _fileTileBaseline) return true;
      // (a) Editor đủ chữ. XÓA HẾT whitespace 2 vế trước so sánh — ProseMirror nối các block <p>
      // KHÔNG chèn '\n' ở ranh giới, còn `text` GIỮ '\n' (prompt nhiều dòng) → length/head/tail
      // false-fail → rơi xuống execCommand → CHÈN LẠI = DOUBLE. (Đồng bộ fix Grok verifyInserted.)
      if (text.length === 0) return true;
      const norm = (s) => String(s || '').replace(/\s+/g, '');
      const txt = norm(editor.textContent); // gồm cả nhãn pill "Create image" — không ảnh hưởng head/tail của text
      const san = norm(text);
      const expected = san.length;
      if (expected === 0) return true;
      if (txt.length < Math.floor(expected * 0.95)) return false;
      const head = san.substring(0, Math.min(20, expected));
      if (!txt.includes(head)) return false;
      if (expected > 40) {
        const tail = san.substring(expected - 20);
        if (!txt.includes(tail)) return false;
      }
      return true;
    };

    // Tier pasteEvent (primary)
    if (!insertForce || insertForce === 'pasteEvent') {
      log('Step 2[pasteEvent]: ClipboardEvent paste, length=', text.length);
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        await sleep(300);
        // Poll ngắn chờ commit: editor đủ chữ HOẶC ChatGPT đóng file .txt xong (prompt dài, mất thời gian).
        // Tránh chạy thừa execCommand/innerHTMLReplace khi paste THÀNH CÔNG nhưng render/file chậm → 2 tier
        // sau lại chèn lại → ChatGPT đóng THÊM file trùng. Hỏng thật → hết poll vẫn !inserted → fallback.
        if (!insertForce) {
          for (let i = 0; i < 8 && !inserted(); i++) { await sleep(150); }
        }
      } catch (e) { log('Step 2[pasteEvent] fail:', e.message); }
    }

    // Tier execCommand — CLEAR editor trước retry để tránh duplicate text với tier pasteEvent (cursor-append)
    if (insertForce === 'execCommand' || (!insertForce && !inserted())) {
      log('Step 2[execCommand]: clear editor + document.execCommand insertText');
      // [IMG_VERIFY] execCommand CHẠY = paste chưa thoả inserted() → đây là nhánh từng gây DOUBLE.
      // Nếu modePill: đã xoá text-sau-pill ở dưới nên KHÔNG double. Log để theo dõi tần suất nhánh này.
      log('[IMG_VERIFY] execCommand tier RAN (paste !inserted) | modePill=' + (modePill ? 'yes' : 'no'));
      if (modePill) {
        // Image mode: KHÔNG innerHTML='' (xóa pill). XÓA text SAU pill trước (nếu paste đã chèn 1
        // phần) → insertText không bị DOUBLE; rồi caret cuối → insertText sạch sau pill.
        try {
          const range = document.createRange();
          range.setStartAfter(modePill);
          range.setEnd(editor, editor.childNodes.length);
          range.deleteContents();
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' })); // ProseMirror sync state sau khi xoá DOM trực tiếp
        } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#norm', _); }
        try { const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#norm', _); }
      } else {
        editor.innerHTML = '';
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      }
      editor.focus();
      await sleep(100);
      document.execCommand('insertText', false, text);
      await sleep(200);
    }

    // Tier innerHTMLReplace (last resort) — innerHTML assign tự replace nên KHÔNG cần clear.
    // Skip khi modePill: innerHTML=<p>text</p> sẽ XÓA pill → mất image mode. Paste/execCommand đã append.
    if (!modePill && (insertForce === 'innerHTMLReplace' || (!insertForce && !inserted()))) {
      log('Step 2[innerHTMLReplace]: editor.innerHTML + InputEvent (last resort)');
      editor.innerHTML = `<p>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      await sleep(200);
    }

    // [B] Fix force silent fail: nếu force mode nhưng tier skip (no-op) → editor empty → submit empty
    // Verify sau insert, nếu force mode + insert fail → throw rõ ràng thay vì silent submit empty.
    if (insertForce && !inserted()) {
      log('Step 2 [FORCE=' + insertForce + '] FAILED: tier không insert được text. Editor length=' + editor.textContent.length);
      throw new Error('FORCE_INSERT_TIER_FAILED:' + insertForce);
    }

    // CRITICAL: Dispatch input event SAU paste để React's ProseMirror onChange handler chạy.
    // ClipboardEvent paste cập nhật DOM nhưng đôi khi React state không sync → submit button
    // visually enabled nhưng React internal state still empty → click không submit.
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true,
      inputType: 'insertFromPaste', data: text,
    }));
    await sleep(150);

    log('Step 2 OK: editor.textContent length=', editor.textContent.length);
    // [IMG_VERIFY] Chẩn đoán double/inject — grep '[IMG_VERIFY]'. Cho thấy nội dung editor CUỐI cùng
    // (head+tail) để mắt thường phát hiện 2 dòng prompt lặp, + cảnh báo heuristic khi nghi double.
    try {
      const _ec = editor.textContent || '';
      const _ecNoWs = _ec.replace(/\s+/g, '').length;
      const _txNoWs = (text || '').replace(/\s+/g, '').length;
      log('[IMG_VERIFY] FINAL editor len=' + _ec.length
        + ' | modePill=' + (modePill ? (modePill.getAttribute('data-id') || 'yes') : 'no')
        + ' | inserted=' + inserted()
        + ' | head="' + _ec.slice(0, 70).replace(/\s+/g, '·') + '"'
        + ' | tail="' + _ec.slice(-70).replace(/\s+/g, '·') + '"');
      if (_txNoWs > 15 && _ecNoWs > Math.floor(_txNoWs * 1.7)) {
        log('[IMG_VERIFY] ⚠️ NGHI DOUBLE INSERT: editor(no-ws)=' + _ecNoWs + ' >> text(no-ws)=' + _txNoWs);
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#norm', _); }

    // Guard SPA re-render: editor reference detached (router yank-back / conversation swap giữa
    // insert và submit) → mọi tier submit thao tác trên node chết, fail chắc chắn → abort sớm.
    if (!editor.isConnected) {
      log('Editor DETACHED khỏi DOM (SPA re-render) — abort submit');
      return false;
    }

    // 3-7. SUBMIT — Force flag: document.documentElement.dataset.seosonaChatgptSubmitForce
    //      Tiers: 'enterKey' (primary) | 'simulateClick' | 'reactOnClick' | 'formRequestSubmit'
    const submitForce = document.documentElement.dataset.seosonaChatgptSubmitForce || null;
    if (submitForce) log('Step 3-7 [FORCE=' + submitForce + ']');
    const submitted = () => (editor.textContent || '').trim().length < 5;

    // [Fix premature/double submit 2026] GATE: đợi submit button hết disabled (= ref ảnh upload XONG +
    // React sync text) TRƯỚC mọi tier submit. Trước fix: tier enterKey (Step 3) bắn ngay sau insert (80ms)
    // khi ảnh còn đang upload (button disabled, thumbnail còn spinner) → submit text-only HOẶC Enter bị
    // nuốt rồi Step 5 click lại → DOUBLE submit. Editor đã có text ở đây nên disabled = đang upload, KHÔNG
    // phải empty. Không thấy button / timeout 30s → fall through (tier sau tự xử lý, không treo).
    if (!submitForce) {
      const gateStart = Date.now();
      let gateBtnSeen = false;
      while (Date.now() - gateStart < 30000) {
        if (__chatgptAbort) break;
        // Phương án A: còn ref đang upload → CHỜ (ưu tiên cao nhất), KHÔNG break sớm dù nút mất/transient
        // (composer re-render lúc attach ảnh có thể làm submit_button null thoáng → tránh lọt submit).
        if (_isRefUploading()) { await sleep(200); continue; }
        const b = _queryWithFallback('submit_button', null, { silent: true });
        if (b) { gateBtnSeen = true; if (!b.disabled) { log('Step 2c: submit button enabled (upload xong) → submit'); break; } }
        else if (gateBtnSeen) break; // từng thấy rồi mất → để tier sau xử lý
        await sleep(200);
      }
      // Delay settle chờ React sync sau khi nút hết disabled — tránh submit sát mép (Enter bị nuốt).
      await sleep(300);
    }

    // Tier enterKey (primary)
    if (!submitForce || submitForce === 'enterKey') {
      log('Step 3[enterKey]: KeyboardEvent keydown+keypress+keyup');
      editor.focus();
      await sleep(80);
      const enterOpts = {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true, composed: true,
      };
      try {
        editor.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
        editor.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
        editor.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
      } catch (e) { log('Step 3[enterKey] dispatch fail:', e.message); }
      await sleep(1500);
      if (submitted()) {
        log('Step 4 OK: editor cleared → submit thành công via enterKey');
        return true;
      }
      // Force mode: don't fall through (chỉ test 1 tier)
      if (submitForce === 'enterKey') {
        log('Step 4 [FORCE=enterKey] DONE: editor still has text');
        return true;
      }
    }

    // Tier simulateClick + reactOnClick (Step 5 — share logic find button)
    let sendBtn = null;
    if (submitForce === 'simulateClick' || submitForce === 'reactOnClick' || (!submitForce && !submitted())) {
      log('Step 5: tìm submit button cho simulateClick/reactOnClick fallback');
      // 2026-05-31: bump timeout 3s → 30s + detect file-tile upload state.
      // Long prompt (>4-5K chars) → ChatGPT auto-convert thành .txt file attachment →
      // submit button disabled trong upload. File tile có button[name="expand-file-tile"]
      // ("Show in text field") + spinner. Đợi spinner clear + button enabled.
      const start = Date.now();
      const POLL_TIMEOUT = 30000; // 30s max — đủ upload file lớn
      let lastDiag = 0;
      while (Date.now() - start < POLL_TIMEOUT) {
        const candidate = _queryWithFallback('submit_button');
        if (candidate && !candidate.disabled) { sendBtn = candidate; break; }
        // Diagnostic mỗi 3s để debug stuck state
        if (Date.now() - lastDiag > 3000) {
          const fileTile = _queryWithFallback('text_file_tile', null, { silent: true });
          const fileSpinner = document.querySelector('.composer-attach .animate-spin, [name="expand-file-tile"] ~ * .animate-spin');
          log(`Step 5 polling: btn=${!!candidate} disabled=${candidate?.disabled} fileTile=${!!fileTile} spinner=${!!fileSpinner}`);
          lastDiag = Date.now();
        }
        await sleep(200);
      }
      if (!sendBtn) {
        log('FAIL: SEND_BUTTON_NOT_FOUND_OR_DISABLED. Editor content:', editor.textContent.substring(0, 50));
        if (submitForce) return true; // Force mode tolerant
        throw new Error('SEND_BUTTON_NOT_FOUND');
      }

      // Tier simulateClick
      if (!submitForce || submitForce === 'simulateClick') {
        log('Step 5[simulateClick]: PointerEvent + MouseEvent chain');
        const rect = sendBtn.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, view: window,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
        try {
          sendBtn.dispatchEvent(new PointerEvent('pointerdown', opts));
          sendBtn.dispatchEvent(new MouseEvent('mousedown', opts));
          sendBtn.dispatchEvent(new PointerEvent('pointerup', opts));
          sendBtn.dispatchEvent(new MouseEvent('mouseup', opts));
          sendBtn.dispatchEvent(new MouseEvent('click', opts));
        } catch (e) { log('Step 5[simulateClick] fail:', e.message); }
      }

      // Tier reactOnClick (chạy sau simulateClick trong production, hoặc force isolated)
      if (submitForce === 'reactOnClick' || (!submitForce)) {
        const propsKey = Object.keys(sendBtn).find(k => k.startsWith('__reactProps$'));
        const props = propsKey ? sendBtn[propsKey] : null;
        if (props && typeof props.onClick === 'function') {
          log('Step 5[reactOnClick]: React props onClick (plain object, no isTrusted)');
          try {
            props.onClick({
              preventDefault() {}, stopPropagation() {},
              nativeEvent: new MouseEvent('click'),
              type: 'click', target: sendBtn, currentTarget: sendBtn,
            });
          } catch (e) { log('Step 5[reactOnClick] fail:', e.message); }
        } else if (submitForce === 'reactOnClick') {
          log('Step 5[reactOnClick] skip: __reactProps.onClick not found');
        }
      }

      // Verify (production mode only — force mode return ngay)
      if (!submitForce) {
        await sleep(1500);
        if (submitted()) {
          log('Step 6 OK: editor cleared sau click → submit thành công');
          return true;
        }
      } else if (submitForce === 'simulateClick' || submitForce === 'reactOnClick') {
        log('Step 6 [FORCE=' + submitForce + '] DONE');
        return true;
      }
    }

    // Tier formRequestSubmit (Step 7 — last resort hoặc force)
    if (submitForce === 'formRequestSubmit' || (!submitForce && !submitted())) {
      log('Step 7[formRequestSubmit]: form.requestSubmit() native HTML');
      try {
        const formBtn = sendBtn || _queryWithFallback('submit_button') || _queryWithFallback('submit_button');
        const form = (formBtn && formBtn.closest('form')) || editor.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
          form.requestSubmit(formBtn);
          await sleep(1000);
          if (submitted()) {
            log('Step 7[formRequestSubmit] OK: editor cleared');
            return true;
          }
          log('Step 7[formRequestSubmit] không clear editor');
        } else {
          log('Step 7[formRequestSubmit] skip: form không tồn tại hoặc không hỗ trợ requestSubmit');
        }
      } catch (e) {
        log('Step 7[formRequestSubmit] fail:', e.message);
      }
    }

    // Trả kết quả THẬT thay vì true vô điều kiện — trước fix, fail hết tier vẫn return true
    // → caller waitForImageResult chờ oan trên chat không có message (bug multi-prompt 2026-07-09).
    const _finalSubmitted = submitted();
    log('Step 7 DONE: All submit strategies đã thử — submitted=' + _finalSubmitted);
    return _finalSubmitted;
  }

  // ============ Wrapper Phase X: giữ tương thích listener `chatAI:execute` ============
  async function uploadImages(images) {
    try {
      const ok = await injectRefImages(images);
      // Port 1.1.40: verify số ref thực tế trong composer khớp số ảnh gửi (chẩn đoán ref-lost do SPA wipe).
      if (ok) {
        const got = _countComposerRefImages();
        const want = Array.isArray(images) ? images.length : 0;
        if (want > 0 && got < want) console.warn(`[ChatAI] Ref count mismatch sau upload: ${got}/${want} — có thể bị SPA wipe`);
      }
      return ok;
    } catch (err) {
      console.error('[ChatAI] uploadImages error:', err.message);
      return false;
    }
  }

  async function insertText(text) {
    // Server-Only: dynamic composer selector với retry
    let editor = null;
    const timeout = Date.now() + 5000;
    while (Date.now() < timeout) {
      editor = _queryWithFallback('composer', null, { silent: true });
      if (editor) break;
      await sleep(200);
    }
    if (!editor) {
      console.error('[ChatAI] Không tìm thấy ô nhập text trên ChatGPT');
      return false;
    }
    editor.focus();
    await sleep(200);
    document.execCommand('insertText', false, text);
    await sleep(200);
    // BUG FIX 2026-06-05: verify length-based thay vì 20-char-prefix.
    // Trước: `text.substring(0, 20)` check chỉ 20 chars đầu → execCommand truncate giữa chừng
    // (vd 200/5000 chars) vẫn pass → KHÔNG fallback → ChatGPT nhận prompt cụt.
    // Sau: check ratio inserted vs expected — < 90% → fallback innerHTML replace.
    const insertedLen = (editor.textContent || '').length;
    const expectedLen = text.length;
    const matchRatio = expectedLen > 0 ? insertedLen / expectedLen : 1;
    if (matchRatio < 0.9) {
      console.warn(`[ChatAI] ChatGPT: insertText truncated (${insertedLen}/${expectedLen} = ${(matchRatio*100).toFixed(0)}%) → fallback innerHTML`);
      // H10: escape &/</> trước khi nhồi innerHTML (khớp sibling ~1578 + Grok innerHTML tier).
      editor.innerHTML = `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    }
    return true;
  }

  async function clickSubmit() {
    await sleep(500);
    // Server-Only: dynamic submit_button selector (không fallback inline)
    let sendBtn = null;
    const start = Date.now();
    while (Date.now() - start < 5000) {
      sendBtn = _queryWithFallback('submit_button', null, { silent: true });
      if (sendBtn && !sendBtn.disabled) break;
      sendBtn = null;
      await sleep(300);
    }
    if (!sendBtn) {
      console.error('[ChatAI] Không tìm thấy nút gửi trên ChatGPT');
      return false;
    }
    simulateClick(sendBtn);
    return true;
  }

  // ============ CG-3.x: Check ChatGPT image creation limit alert (free plan) ============
  // ChatGPT free plan khi hết quota image gen sẽ hiện banner trên editor:
  // "You've reached your image creation limit. Upgrade to ChatGPT Plus or try again after H:MM AM/PM."
  // Detect TRƯỚC khi submit → tránh lãng phí thao tác.
  function checkImageLimitAlert() {
    // Normalize: chuyển ký tự đặc biệt về ASCII để match đa dạng quotes
    const normalize = (s) => (s || '')
      .replace(/[’‘]/g, "'")        // smart quotes → apostrophe
      .replace(/[  ]/g, ' ')        // narrow/non-break space → space
      .toLowerCase();

    // Tìm trong body.innerText (rẻ + reliable)
    const bodyText = normalize(document.body?.innerText || '');
    const limitPhrase = "reached your image creation limit";
    if (!bodyText.includes(limitPhrase)) return null;

    // Extract message gốc (trước normalize) để hiện cho user
    const fullText = document.body?.innerText || '';
    // Tìm câu chứa phrase (split theo "."  hoặc "\n")
    const sentences = fullText.split(/[\n]+/);
    let matchSentence = '';
    for (const sent of sentences) {
      if (normalize(sent).includes(limitPhrase)) {
        matchSentence = sent.trim();
        break;
      }
    }
    return {
      detected: true,
      message: matchSentence || "You've reached your image creation limit on the free plan.",
    };
  }

  // ============ CG-3.1: Snapshot conversation state ============
  // Lưu turnCount + 5 turn ID gần nhất + existing image file_ids để waitForImageResult so sánh.
  // CRITICAL: existingImageFileIds dùng để loại trừ ảnh CŨ trong chat history khi global fallback
  // detect → tránh bug "submit prompt trên chat có lịch sử → ext download ảnh cũ ngay".
  function snapshotConversationState() {
    const turns = _queryAllWithFallback('conversation_turn');

    // Capture file_ids của TẤT CẢ CDN images (generated + ref/uploaded) trên page TRƯỚC submit
    // Server-Only: dynamic cdn_image selectors
    const existingImageFileIds = new Set();
    const allCdnImgs = _queryCdnImages(document);
    for (const img of allCdnImgs) {
      if (!img.src) continue;
      const m = img.src.match(/[?&]id=(file_[a-z0-9]+)/i);
      if (m) existingImageFileIds.add(m[1]);
    }

    // Capture TOÀN BỘ turn IDs (Set) — dùng cho waitForTextResult detect new turn theo ID
    // thay vì theo count (count fail khi new chat ready nhưng DOM cũ chưa unmount → baseline
    // captures cả 2 turns chat cũ → submit chat mới có 2 turns → count === baseline → loop forever).
    const turnIds = new Set();
    for (const t of turns) {
      const id = t.dataset.turnId || t.dataset.testid;
      if (id) turnIds.add(id);
    }

    console.log('[ChatGPT-snapshot] 📸 Baseline:', turns.length, 'turns,', existingImageFileIds.size, 'existing file_ids (incl. refs)');

    return {
      turnCount: turns.length,
      turnIds, // Set<turn-id> — primary check cho new turn detection (robust với new-chat race)
      existingImageFileIds, // Set<file_xxx> — bao gồm cả generated + ref/uploaded
      lastTurnIds: Array.from(turns)
        .slice(-5)
        .map(t => t.dataset.turnId || t.dataset.testid),
      timestamp: Date.now(),
    };
  }

  // ============ CG-3.1: Streaming detection (multi-signal) ============
  // ChatGPT image gen DOM THẬT (verify từ chatgpt-Generating-dom.html):
  // - KHÔNG có [data-testid="stop-button"]
  // - Signal RELIABLE: element có aria-label="Generating image..." trong turn
  // - Send button có thể disabled hoặc không
  function isStreaming(turnEl) {
    // (A) PRIMARY signal cho image gen: generating indicator trong turn hoặc global
    if (_hasGeneratingIndicator(turnEl)) return true;
    if (_hasGeneratingIndicator()) return true;

    // (B) Stop button tồn tại global khi đang stream text (không phải image)
    if (_queryWithFallback('stop_button')) return true;

    // (C) Send button đang disabled (state trong khi assistant đang trả lời)
    const sendBtn = _queryWithFallback('submit_button');
    if (sendBtn?.disabled) return true;

    // (D) Có skeleton/shimmer/animate-pulse trong turn nhưng chưa có img generated
    const hasSkeleton = turnEl.querySelector(
      '[class*="skeleton"], [class*="shimmer"], [class*="animate-pulse"]'
    );
    const hasImg = !!_findGeneratedImg(turnEl);
    if (hasSkeleton && !hasImg) return true;

    return false;
  }

  // ============ CG-3.1 Helper: Tìm img đã generated trong turn ============
  // ChatGPT CDN có thể là: estuary/content?id=file_xxx, oaiusercontent.com,
  // sandboxed.openai.com, files.oaiusercontent.com... → match nhiều pattern.
  // Loại blur-2xl backdrop duplicate.
  // PRIORITY: alt-based TRƯỚC (signal mạnh nhất — chỉ image gen mới có alt^="Generated image")
  // → loại trừ ref/uploaded images (alt="Uploaded image") cùng có estuary URL.
  function _findGeneratedImg(turnEl) {
    // Priority 1: Server-Only dynamic generated_image selector
    const altMatch = _queryWithFallback('generated_image', null, { scope: turnEl, silent: true });
    if (altMatch && !altMatch.classList.contains('blur-2xl') && altMatch.src) return altMatch;

    // Priority 2: CDN URL (fallback nếu alt missing)
    // Server-Only: dynamic cdn_image selectors
    // FIX: INCLUSIVE filter — chỉ chấp nhận "Generated image..." hoặc "" (siblings)
    const candidates = _queryCdnImages(turnEl);
    for (const img of candidates) {
      if (img.classList.contains('blur-2xl')) continue;
      const alt = img.getAttribute('alt') || '';
      const isGenerated = alt.toLowerCase().startsWith('generated image');
      const isSibling = alt === '';
      if (!isGenerated && !isSibling) continue;
      if (img.src) return img;
    }

    // DEBUG: Log if we have img but no match (once per 5s to avoid spam)
    if (!_findGeneratedImg._lastDebug || Date.now() - _findGeneratedImg._lastDebug > 5000) {
      const allImgs = turnEl.querySelectorAll('img');
      if (allImgs.length > 0) {
        console.log('[ChatGPT-find] 🔍 No generated img found, turn has', allImgs.length, 'imgs');
        for (let i = 0; i < Math.min(allImgs.length, 3); i++) {
          const img = allImgs[i];
          console.log('  [' + i + '] src:', (img.src || '').slice(0, 80), '| alt:', (img.alt || '').slice(0, 40));
        }
        _findGeneratedImg._lastDebug = Date.now();
      }
    }
    return null;
  }

  // ============ CG-3.1: Error detection ============
  // Patterns từ /admin/providers/chatgpt → API Configs → provider_configs.api_config.error_patterns
  // ChatGPTConfig fetch + cache vào chrome.storage.local.af_chatgpt_config (TTL 1h).
  //
  // Strict Server-Only — NO hardcoded FALLBACK_PATTERNS.
  // Patterns đọc 100% từ `chrome.storage.local.af_chatgpt_config` (background.js preload).
  let _activePatterns = {
    rateLimit: [],
    contentBlocked: [],
    imageGenFailed: [],
    network: [],
    textOnly: [],
    cloudflare: [],
  };

  // Parse pipe-separated string thành array lowercase
  function _parsePatternString(str) {
    if (!str || typeof str !== 'string') return [];
    return str.split('|').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  /**
   * Load patterns từ chrome.storage.local.af_chatgpt_config.
   * @returns {Promise<boolean>} true nếu load có ít nhất 1 pattern
   */
  async function _loadPatternsFromStorage() {
    try {
      const result = await new Promise((r) => chrome.storage.local.get(['af_chatgpt_config'], r));
      const cfg = result?.af_chatgpt_config?.data;
      if (!cfg) return false;
      _activePatterns.rateLimit = _parsePatternString(cfg.rate_limit_error_text);
      _activePatterns.contentBlocked = _parsePatternString(cfg.content_blocked_text);
      _activePatterns.imageGenFailed = _parsePatternString(cfg.image_gen_failed_text);
      _activePatterns.network = _parsePatternString(cfg.network_error_text);
      _activePatterns.textOnly = _parsePatternString(cfg.text_only_pattern);
      _activePatterns.cloudflare = _parsePatternString(cfg.cloudflare_challenge_text);
      const total = Object.values(_activePatterns).reduce((s, a) => s + a.length, 0);
      return total > 0;
    } catch (e) {
      return false;
    }
  }

  // Server-Only: Wait/retry pattern (giống _ensureSelectorConfig). Khác selectors:
  // KHÔNG block UI overlay vì error detection degrade gracefully.
  const _PATTERNS_WAIT_MAX_MS = 10000;
  const _PATTERNS_WAIT_INTERVAL_MS = 500;

  (async function _ensurePatternsConfig() {
    const startTime = Date.now();
    let attempts = 0;
    let lastLogElapsed = 0;
    console.log(`[ChatGPT:patterns:ensure] ⏳ Waiting for error patterns in chrome.storage.local.af_chatgpt_config (timeout ${_PATTERNS_WAIT_MAX_MS}ms)...`);
    while (Date.now() - startTime < _PATTERNS_WAIT_MAX_MS) {
      attempts++;
      const ok = await _loadPatternsFromStorage();
      if (ok) {
        const total = Object.values(_activePatterns).reduce((s, a) => s + a.length, 0);
        console.log(`[ChatGPT:patterns:ensure] ✅ Loaded ${total} patterns across ${Object.keys(_activePatterns).length} categories after ${attempts} attempts (${Date.now() - startTime}ms)`);
        return;
      }
      try {
        chrome.runtime.sendMessage({ action: 'getProviderConfigs', provider: PROVIDER }, () => {
          if (chrome.runtime.lastError) { /* SW suspended — silent */ }
        });
      } catch (_) { /* SW disconnected — silent */ }
      const elapsed = Date.now() - startTime;
      if (elapsed - lastLogElapsed >= 2000) {
        lastLogElapsed = elapsed;
        console.log(`[ChatGPT:patterns:ensure] ⏳ Still waiting (${(elapsed / 1000).toFixed(1)}s/${_PATTERNS_WAIT_MAX_MS / 1000}s, attempt #${attempts})...`);
      }
      await new Promise(r => setTimeout(r, _PATTERNS_WAIT_INTERVAL_MS));
    }
    console.warn(`[ChatGPT:patterns:ensure] ⚠️ Timeout after ${attempts} attempts — error detection degraded. User vẫn submit được, chỉ là tracker hiển thị TIMEOUT thay vì error code chính xác.`);
  })();

  // Listen storage changes — khi sidebar refresh ChatGPTConfig, tab chatgpt.com cũng cập nhật
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.af_chatgpt_config) {
        _loadPatternsFromStorage();
      }
    });
  } catch (e) { /* ignore in non-extension context */ }

  function detectError(turnEl) {
    const text = (turnEl.innerText || '').toLowerCase();
    if (_activePatterns.rateLimit.some(p => text.includes(p))) return 'RATE_LIMIT';
    if (_activePatterns.contentBlocked.some(p => text.includes(p))) return 'CONTENT_BLOCKED';
    if (_activePatterns.imageGenFailed.some(p => text.includes(p))) return 'IMAGE_GEN_FAILED';
    if (_activePatterns.network.some(p => text.includes(p))) return 'NETWORK';
    return null;
  }

  // ============ CG-3.1: Extract image URLs từ turn ============
  // Server-Only: dynamic cdn_image selectors
  // Bỏ qua duplicate blur backdrop (class blur-2xl) và dedup theo FILE_ID (không phải full URL).
  // Reference DOM verified: 1 generated image render thành 3 <img> tags với cùng file_id
  // nhưng signature/timestamp khác nhau → full URL dedup KHÔNG dedup được.
  // FIX: extract `file_xxx` từ URL → dedup theo file_id để tránh download trùng N lần.
  function extractImageUrls(turnEl) {
    const images = _queryCdnImages(turnEl);
    // DEBUG: Dump ALL images in turn to diagnose selector mismatches
    const allImgs = turnEl.querySelectorAll('img');
    if (allImgs.length > 0 && images.length === 0) {
      console.log('[ChatGPT-extract] 🔍 DEBUG: CDN selector miss, dumping all', allImgs.length, 'imgs:');
      for (let i = 0; i < Math.min(allImgs.length, 5); i++) {
        const img = allImgs[i];
        console.log('  [' + i + '] src:', (img.src || '').slice(0, 100), '| alt:', (img.alt || '').slice(0, 50));
      }
    }
    // Map<fileId, url> — keep first occurrence per file_id (typically the highest-quality one with alt^="Generated image")
    const urlByFileId = new Map();
    const candidates = [];
    let debugInfo = { total: images.length, skippedBlur: 0, skippedRef: 0, skippedEmpty: 0 };
    for (const img of images) {
      if (img.classList.contains('blur-2xl')) { debugInfo.skippedBlur++; continue; }
      const src = img.src;
      if (!src) { debugInfo.skippedEmpty++; continue; }
      const alt = img.getAttribute('alt') || '';
      // FIX: INCLUSIVE filter — chỉ chấp nhận "Generated image..." hoặc "" (siblings)
      // ChatGPT đã đổi alt của ref images từ "Uploaded image" sang UUID (vd: "70bc7693-2579-4af8-...")
      // → filter cũ (exclude "Uploaded image") không còn hoạt động
      const isGenerated = alt.toLowerCase().startsWith('generated image');
      const isSibling = alt === '';
      if (!isGenerated && !isSibling) {
        console.log('[ChatGPT-extract] ⏭️ Skip non-generated:', alt.slice(0, 50), '| file_id:', src.match(/[?&]id=(file_[a-z0-9]+)/i)?.[1]);
        debugInfo.skippedRef++;
        continue;
      }
      candidates.push({ src, alt });
    }
    console.log('[ChatGPT-extract] 📊 Images in turn:', JSON.stringify(debugInfo), '| Candidates after filter:', candidates.length);

    // Sort: prioritize "Generated image: ..." alt first (chính), then "" alt (siblings)
    candidates.sort((a, b) => {
      const aGen = a.alt.toLowerCase().startsWith('generated image') ? 0 : 1;
      const bGen = b.alt.toLowerCase().startsWith('generated image') ? 0 : 1;
      return aGen - bGen;
    });

    for (const c of candidates) {
      const fileIdMatch = c.src.match(/[?&]id=(file_[a-z0-9]+)/i);
      const key = fileIdMatch ? fileIdMatch[1] : c.src; // fallback dedup by full URL nếu không có file_id
      if (!urlByFileId.has(key)) {
        urlByFileId.set(key, c.src);
      }
    }

    // Fallback: Server-Only dynamic generated_image selector
    if (urlByFileId.size === 0) {
      const altMatches = _queryAllWithFallback('generated_image', null, turnEl);
      for (const img of altMatches) {
        if (img.classList.contains('blur-2xl')) continue;
        if (!img.src) continue;
        // Bug fix 2026-05-27: loại ref images (alt=UUID) — selector generated_image có
        // img[src*="/backend-api/"] match cả ref. Chỉ nhận generated thật (alt^="Generated image" hoặc "").
        const a = img.getAttribute('alt') || '';
        if (!(a.toLowerCase().startsWith('generated image') || a === '')) continue;
        const fileIdMatch = img.src.match(/[?&]id=(file_[a-z0-9]+)/i);
        const key = fileIdMatch ? fileIdMatch[1] : img.src;
        if (!urlByFileId.has(key)) urlByFileId.set(key, img.src);
      }
    }
    return Array.from(urlByFileId.values());
  }

  // ============ CG-8: Poll conversation đợi TEXT result (Prompt node enhance) ============
  // Khác waitForImageResult: KHÔNG check img estuary, chỉ chờ assistant turn xong streaming
  // rồi extract innerText. Dùng cho Prompt node enhance qua ChatGPT (text-only).
  async function waitForTextResult(baseline, timeout = 60000) {
    const startTime = Date.now();
    const pollInterval = 500;
    // Gia hạn khi stream signal còn sống (stop button/indicator hiện = model VẪN đang viết):
    // deadline trượt theo cửa sổ 60s, hard cap timeout + STREAM_GRACE_MAX. Trước fix: hết
    // timeout cứng là TIMEOUT dù stopButton=true → PA meta-prompt dài >2' bị hủy oan giữa stream.
    const STREAM_GRACE_MAX = 300000;
    const hardCap = startTime + timeout + STREAM_GRACE_MAX;
    let deadline = startTime + timeout;
    let graceLogged = false;
    let lastDiag = 0;
    let lastTextLength = 0;
    let stableCount = 0;
    // 2026-05-31: Bump threshold 3 → 8 (~4s). Bug: long AI response (5000+ chars) thường
    // có pause 1-2s giữa các đoạn (model thinking / network) → stop_button vô hình tạm thời
    // → stability false positive ở 1.5s → capture partial. Vd user case: image_prompt_4
    // chỉ get 35 chars, video_prompt_4 marker không xuất hiện → text_extract fail cascade.
    const STABLE_THRESHOLD = 8; // Text phải stable qua 8 poll cycles (~4s) mới coi là xong

    while (Date.now() < deadline) {
      _scrollChatToBottom(); // theo dõi kết quả đang stream xuống đáy
      // Check abort flag
      if (isAbortActive()) {
        console.log('[ChatGPT-text] Aborted by user → clicking Stop button');
        await clickChatGPTStopButton();
        return { success: false, error: 'ABORTED', message: 'User stopped execution' };
      }

      // Server-Only: dynamic assistant_turn + conversation_turn selectors
      const allAssistantTurns = _queryAllWithFallback('assistant_turn');
      const allTurns = _queryAllWithFallback('conversation_turn');

      // New-turn detect by ID không count (robust khi baseline capture nhằm DOM cũ — vd sau click
      // new chat, React chưa unmount old conv kịp). Set primary; fallback count cho selectors cũ
      // không có turn-id (defensive — config hiện chỉ trả data-testid="conversation-turn-X").
      const baselineIds = baseline.turnIds || new Set();
      const newTurns = baselineIds.size > 0
        ? Array.from(allTurns).filter(t => {
            const id = t.dataset.turnId || t.dataset.testid;
            return id && !baselineIds.has(id);
          })
        : Array.from(allTurns).slice(baseline.turnCount); // legacy fallback
      const hasNewTurn = newTurns.length > 0;

      if (!hasNewTurn) {
        // SUBMIT_LOST early-exit: turn user echo hiện 1-3s sau submit thành công (kể cả prompt
        // dạng file .txt — nội dung file không verify được, turn mới là ground truth duy nhất).
        // 30s không có turn nào = prompt chưa được gửi (composer bị SPA wipe) → fail sớm
        // thay vì đợi hết timeout 300s+grace.
        if (Date.now() - startTime > 30000) {
          console.warn('[ChatGPT-text] SUBMIT_LOST — không có turn mới sau 30s (prompt có thể bị wipe trước khi gửi)');
          return { success: false, error: 'SUBMIT_LOST', message: 'Prompt chưa được gửi tới ChatGPT (không thấy tin nhắn mới sau 30s).' };
        }
        if (Date.now() - lastDiag > 5000) {
          console.log('[ChatGPT-text] Chưa có turn mới — turnCount:', allTurns.length, 'baseline:', baseline.turnCount, 'baselineIds:', baselineIds.size);
          lastDiag = Date.now();
        }
        await sleep(pollInterval);
        continue;
      }

      // Last assistant turn — ưu tiên trong các new turn (đề phòng assistant_turn selector match
      // cả turns cũ); fallback global last assistant turn nếu newTurns không chứa assistant role.
      let lastAssistantTurn = null;
      for (let i = newTurns.length - 1; i >= 0; i--) {
        const t = newTurns[i];
        if (t.matches && t.matches('[data-turn="assistant"]')) { lastAssistantTurn = t; break; }
      }
      if (!lastAssistantTurn) lastAssistantTurn = allAssistantTurns[allAssistantTurns.length - 1];
      if (!lastAssistantTurn) {
        await sleep(pollInterval);
        continue;
      }

      // 1. Detect error trước (ưu tiên RATE_LIMIT/CONTENT_BLOCKED/...)
      const error = detectError(lastAssistantTurn);
      if (error) {
        console.log('[ChatGPT-text] Error:', error);
        return {
          success: false,
          error,
          message: (lastAssistantTurn.innerText || '').slice(0, 500),
        };
      }

      // 2. Detect streaming qua nhiều signal:
      //    - aria-label="Stop generating" hoặc "Stop" button tồn tại
      //    - data-testid="stop-button" tồn tại
      //    - Có progress/loading indicators
      //    - Text vẫn đang thay đổi (stability check)
      const stopGenBtn = _queryWithFallback('stop_button');
      const stillGeneratingImg = _hasGeneratingIndicator(lastAssistantTurn);

      // Check thinking/loading indicators trong turn (Server-Only: dynamic selector)
      const hasThinkingIndicator = _queryWithFallback('thinking_indicator', null, { scope: lastAssistantTurn, silent: true });

      // Signal-based streaming detection
      const signalStreaming = !!stopGenBtn || !!stillGeneratingImg || !!hasThinkingIndicator;

      // 3. Extract current text để check stability (Server-Only: dynamic selectors)
      let currentText = '';
      const roleWrapper = _queryWithFallback('message_author', null, { scope: lastAssistantTurn, silent: true });
      const markdownEl = _queryWithFallback('response_text_content', null, { scope: roleWrapper || lastAssistantTurn, silent: true });
      if (markdownEl && typeof markdownEl.innerText === 'string') {
        currentText = markdownEl.innerText.trim();
      } else if (roleWrapper && typeof roleWrapper.innerText === 'string') {
        currentText = roleWrapper.innerText.trim();
      }
      if (!currentText) {
        currentText = (lastAssistantTurn.innerText || '').trim();
      }

      // Text stability check: text phải không đổi qua STABLE_THRESHOLD cycles
      const currentTextLength = currentText.length;
      if (currentTextLength === lastTextLength && currentTextLength > 0) {
        stableCount++;
      } else {
        stableCount = 0;
        lastTextLength = currentTextLength;
      }

      const isTextStable = stableCount >= STABLE_THRESHOLD;
      const stillStreaming = signalStreaming || (!isTextStable && currentTextLength > 0);

      if (stillStreaming) {
        // Signal thật (stop button/indicator) còn sống + deadline sắp cạn → trượt cửa sổ 60s (cap hardCap).
        // Chỉ gia hạn theo signalStreaming — text instability đơn thuần KHÔNG gia hạn (tránh treo vì re-render).
        if (signalStreaming && deadline - Date.now() < 60000) {
          const next = Math.min(Date.now() + 60000, hardCap);
          if (next > deadline) {
            deadline = next;
            if (!graceLogged) {
              console.warn('[ChatGPT-text] Quá timeout gốc nhưng stream còn sống → gia hạn (cap +', STREAM_GRACE_MAX / 1000, 's)');
              graceLogged = true;
            }
          }
        }
        if (Date.now() - lastDiag > 5000) {
          console.log('[ChatGPT-text] Streaming — signals:', !!stopGenBtn, 'textLen:', currentTextLength, 'stable:', stableCount);
          lastDiag = Date.now();
        }
        await sleep(pollInterval);
        continue;
      }

      // 4. Streaming xong + text stable → return
      if (!currentText || currentText.length < 1) {
        // Turn complete nhưng rỗng — chờ thêm một chút
        if (Date.now() - startTime < 5000) {
          await sleep(pollInterval);
          continue;
        }
        return { success: false, error: 'TEXT_EMPTY' };
      }

      const turnId =
        lastAssistantTurn.dataset.turnId ||
        lastAssistantTurn.dataset.testid ||
        null;

      console.log('[ChatGPT-text] DONE — text length:', currentText.length, 'stableCount:', stableCount);
      return { success: true, text: currentText, turnId };
    }

    console.warn('[ChatGPT-text] TIMEOUT sau', timeout, 'ms');
    // Diagnostic chốt nguyên nhân TIMEOUT (không đoán): turn-detection fail vs stream-never-ends.
    //   turnCount <= baselineTurnCount        → KHÔNG thấy turn mới (selector drift / baseline race)
    //   stopButton/thinkingIndicator = true   → stream KHÔNG được phát hiện kết thúc (signal kẹt)
    //   lastTextLen lớn nhưng lastStableCount thấp → text re-render liên tục (code-block) → never stable
    try {
      const _turns = _queryAllWithFallback('conversation_turn');
      const _aTurns = _queryAllWithFallback('assistant_turn');
      const _last = _aTurns[_aTurns.length - 1];
      const _mdEl = _last ? _queryWithFallback('response_text_content', null, { scope: _last, silent: true }) : null;
      const _txtLen = ((_mdEl && _mdEl.innerText) || (_last && _last.innerText) || '').trim().length;
      console.warn('[ChatGPT-text] TIMEOUT diag →', JSON.stringify({
        turnCount: _turns.length,
        baselineTurnCount: baseline.turnCount,
        assistantTurns: _aTurns.length,
        stopButton: !!_queryWithFallback('stop_button', null, { silent: true }),
        generatingImg: _last ? !!_hasGeneratingIndicator(_last) : false,
        thinkingIndicator: _last ? !!_queryWithFallback('thinking_indicator', null, { scope: _last, silent: true }) : false,
        lastTextLen: _txtLen,
        lastStableCount: stableCount,
      }));
    } catch (e) { console.warn('[ChatGPT-text] TIMEOUT diag failed:', e.message); }
    return { success: false, error: 'TIMEOUT' };
  }

  // ============ CG-3.1: Poll conversation đợi image result ============
  async function waitForImageResult(baseline, timeout = 120000) {
    const startTime = Date.now();
    const pollInterval = 1000;
    let lastDiag = 0;
    let textOnlyStreamStart = null;
    let postCompleteTextOnlyStart = null;
    const TEXT_ONLY_THRESHOLD_MS = 15000;
    const POST_COMPLETE_GRACE_MS = 5000;
    const MIN_WAIT_BEFORE_PATTERN_CHECK_MS = 5000;
    const MIN_WAIT_WITH_POSITIVE_MS = 10000;
    const MIN_TEXT_FOR_ERROR_CHECK = 80;

    // Positive indicators: ChatGPT có thể nói trước khi gen ảnh - KHÔNG trigger error sớm
    const POSITIVE_INDICATORS = [
      "i'll create", "i'll generate", "i'll make", "let me create", "let me generate",
      "creating", "generating", "here's", "here is", "sure", "absolutely", "of course",
    ];

    // Helper: check có positive indicator không (đang chuẩn bị gen)
    function hasPositiveIndicator(text) {
      if (!text) return false;
      const lower = text.toLowerCase();
      return POSITIVE_INDICATORS.some(p => lower.includes(p));
    }

    // Helper: check text có match pattern TEXT_ONLY không (ChatGPT trả text thay vì gen ảnh)
    function matchesTextOnlyPattern(text) {
      if (!text || text.length < 50) return false;
      const lower = text.toLowerCase();
      const patterns = _activePatterns.textOnly || []; // Server-Only: no hardcoded fallback
      return patterns.some(p => lower.includes(p));
    }

    // Helper: check tất cả error patterns và trả về error code nếu match
    function matchesAnyErrorPattern(text) {
      if (!text || text.length < MIN_TEXT_FOR_ERROR_CHECK) return null;
      const lower = text.toLowerCase();

      // Check từng loại error pattern
      const checks = [
        { key: 'rateLimit', error: 'RATE_LIMIT' },
        { key: 'contentBlocked', error: 'CONTENT_BLOCKED' },
        { key: 'imageGenFailed', error: 'IMAGE_GEN_FAILED' },
      ];

      for (const { key, error } of checks) {
        const patterns = _activePatterns[key] || []; // Server-Only: no hardcoded fallback
        if (patterns.some(p => lower.includes(p))) {
          return { error, text: text.slice(0, 500) };
        }
      }
      return null;
    }

    // Helper: tìm assistant turn MỚI (sau baseline) — ưu tiên turn có generating/result markers.
    // Server-Only: dynamic assistant_turn + image_action_buttons selectors
    function findNewAssistantTurn() {
      const allAssistantTurns = _queryAllWithFallback('assistant_turn');
      if (!allAssistantTurns.length) return null;

      // Get image_action_buttons selectors for fast-path check
      const actionBtnSelectors = _getSelectorsForKey('image_action_buttons');

      // Strategy 1: turn có dấu hiệu image generating/done — ưu tiên cao nhất
      for (let i = allAssistantTurns.length - 1; i >= 0; i--) {
        const turn = allAssistantTurns[i];
        // Check generating indicator
        if (_hasGeneratingIndicator(turn)) return turn;
        // Check image action buttons (Server-Only: dynamic)
        for (const sel of actionBtnSelectors) {
          if (turn.querySelector(sel)) return turn;
        }
        // Check generated image (Server-Only: dynamic)
        if (_queryWithFallback('generated_image', null, { scope: turn, silent: true })) return turn;
      }

      // Strategy 2: turn có testid number > baseline.turnCount (turn mới created sau submit)
      const newTurns = Array.from(allAssistantTurns).filter(turn => {
        const testid = turn.dataset.testid || turn.getAttribute('data-testid') || '';
        const m = testid.match(/conversation-turn-(\d+)/);
        if (!m) return false;
        return parseInt(m[1], 10) > baseline.turnCount;
      });
      if (newTurns.length > 0) return newTurns[newTurns.length - 1];

      // Strategy 3: fallback — last assistant turn (legacy)
      return allAssistantTurns[allAssistantTurns.length - 1];
    }

    // HEARTBEAT-based wait (bug fix 2026-05-27): KHÔNG timeout cứng. Còn indicator "Generating image"
    // = ChatGPT đang vẽ → chờ tiếp (reset đồng hồ). User báo gen nhiều ref chậm > timeout cũ →
    // timeout-oan dù gen thành công. `timeout` thành GIỚI HẠN cho case CHƯA bao giờ gen; MAX_WAIT là
    // trần an toàn tuyệt đối; HEARTBEAT_MS = ngưỡng coi stuck sau khi indicator tắt. (Mirror Grok.)
    const MAX_WAIT = Math.max(timeout, 600000);
    const HEARTBEAT_MS = 90000;
    let genSeenOnce = false;
    let lastGenActive = Date.now();
    while (Date.now() - startTime < MAX_WAIT) {
      _scrollChatToBottom(); // theo dõi ảnh đang gen xuống đáy
      // Check abort flag
      if (isAbortActive()) {
        console.log('[ChatGPT-image] Aborted by user → clicking Stop button');
        await clickChatGPTStopButton();
        return { success: false, error: 'ABORTED', message: 'User stopped execution' };
      }

      // Mid-flight challenge detect — bail sớm nếu session expire
      if (detectChatGPTChallenge()) {
        console.warn('[ChatGPT-image] Challenge re-emerged mid-stream → abort');
        return {
          success: false,
          error: 'CHALLENGE_TIMEOUT',
          message: 'ChatGPT yêu cầu xác minh trong khi gen — vui lòng verify thủ công và chạy lại.',
        };
      }

      const allTurns = _queryAllWithFallback('conversation_turn');

      // PRIORITY FALLBACK — Document-level detection nếu turn-based detection KHÔNG work.
      // Reference: chatgpt-Generating-dom.html cho fresh chat ChatGPT có thể dùng DOM markup
      // KHÁC `[data-testid^="conversation-turn-"]` (vd thread placeholder, redirect /c/{id}).
      // Detect qua selectors độc lập với turn structure:
      //   1. img[alt^="Generated image"] anywhere → image gen done globally
      //   2. button[aria-label="Like this image"] anywhere → post-action button visible
      // CRITICAL: Loại trừ ảnh có file_id trong baseline.existingImageFileIds → tránh bug
      // "submit trên chat có lịch sử → lấy ảnh cũ trước đó". Chỉ consider ảnh MỚI sau submit.
      const baselineFileIds = baseline.existingImageFileIds || new Set();
      // Bug false-positive TEXT_ONLY: ảnh gen đã render nhưng alt SET TRỄ (alt='' tạm thời) → 3 guard
      // TEXT_ONLY sớm dùng generated_image (alt^="Generated image") MISS dù ảnh ĐÃ có → báo oan. Check
      // src-based qua cdn_image + isRealGen (chấp nhận alt='', loại ref alt=UUID, loại ảnh trong baseline)
      // để CHẶN false-positive. Ref đều pre-submit → nằm trong baseline → đã loại.
      const _hasRealNewImage = () => {
        for (const img of _queryCdnImages(document)) {
          if (img.classList.contains('blur-2xl') || !img.src?.startsWith('http')) continue;
          const a = img.getAttribute('alt') || '';
          if (!(a.toLowerCase().startsWith('generated image') || a === '')) continue; // loại ref alt=UUID
          const m = img.src.match(/[?&]id=(file_[a-z0-9]+)/i);
          if (m && baselineFileIds.has(m[1])) continue; // loại ảnh cũ/ref pre-submit
          return true;
        }
        return false;
      };
      // Bug fix 2026-05-27: dùng cdn_image (match theo SRC: estuary/content, backend-api...) thay vì
      // generated_image (alt-only) — ChatGPT set alt="Generated image" TRỄ nên trong cửa sổ render
      // ảnh đã có src nhưng alt="" → generated_image alt-only miss → timeout. cdn_image bắt sớm theo src;
      // alt-filter bên dưới (isGenerated || isSibling) vẫn loại ref images (alt=UUID) + baseline loại ảnh cũ.
      const allGenImgs = _queryCdnImages(document);

      // Build map of NEW images only (file_id NOT in baseline)
      // FIX: alt filter — chỉ chấp nhận "Generated image..." hoặc "" (sibling), LOẠI ref images (alt=UUID).
      const urlByFileId = new Map();
      for (const img of allGenImgs) {
        if (img.closest('form')) continue; // ảnh trong composer (pill/ref) không phải kết quả gen
        if (img.classList.contains('blur-2xl') || !img.src) continue;
        const alt = img.getAttribute('alt') || '';
        const isGenerated = alt.toLowerCase().startsWith('generated image');
        const isSibling = alt === '';
        if (!isGenerated && !isSibling) continue; // skip ref images (UUID alt)
        const m = img.src.match(/[?&]id=(file_[a-z0-9]+)/i);
        if (!m) continue;
        const fileId = m[1];
        if (baselineFileIds.has(fileId)) continue; // skip CŨ
        if (!urlByFileId.has(fileId)) urlByFileId.set(fileId, img.src);
      }

      const newImageUrls = Array.from(urlByFileId.values());
      const globalGenerating = _hasGeneratingIndicator();

      // HEARTBEAT: còn đang vẽ → chờ tiếp (reset đồng hồ). Stuck khi indicator tắt > HEARTBEAT_MS mà
      // chưa có ảnh, HOẶC chưa từng thấy indicator sau `timeout` (TEXT_ONLY/error tự bắt sớm hơn).
      // Đặt TRƯỚC success-check; chỉ break khi newImageUrls===0 nên không cướp ảnh vừa render.
      if (globalGenerating) {
        genSeenOnce = true;
        lastGenActive = Date.now();
      } else if (newImageUrls.length === 0) {
        if (genSeenOnce) {
          if (Date.now() - lastGenActive > HEARTBEAT_MS) {
            console.warn(`[ChatGPT-detect] Heartbeat: indicator gen tắt > ${HEARTBEAT_MS / 1000}s + chưa có ảnh → stuck, dừng chờ`);
            break;
          }
        } else if (Date.now() - startTime > timeout) {
          console.warn('[ChatGPT-detect] Heartbeat: chưa từng thấy indicator gen sau', timeout, 'ms → dừng chờ');
          break;
        }
      }

      // Trust global fallback CHỈ KHI:
      //   - Có ảnh MỚI (file_id ngoài baseline)
      //   - VÀ KHÔNG còn "Generating image..." indicator (gen đã xong cho ảnh mới)
      //   - VÀ đã từng thấy indicator gen HOẶC đã chờ ≥10s — chặn false-positive DONE 4ms sau
      //     submit khi ảnh UI lọt filter mà gen chưa hề chạy (bug multi-prompt 2026-07-09).
      if (newImageUrls.length > 0 && !globalGenerating && (genSeenOnce || Date.now() - startTime > 10000)) {
        // Find first NEW Generated image alt (ưu tiên "Generated image..." alt)
        let altText = '';
        for (const img of allGenImgs) {
          if (img.classList.contains('blur-2xl') || !img.src) continue;
          const alt = img.getAttribute('alt') || '';
          // Chỉ lấy alt từ generated images, không phải ref (UUID alt)
          if (!alt.toLowerCase().startsWith('generated image')) continue;
          const m = img.src.match(/[?&]id=(file_[a-z0-9]+)/i);
          if (m && !baselineFileIds.has(m[1])) {
            altText = alt;
            break;
          }
        }
        console.log('[ChatGPT-detect] DONE (global fallback) — NEW urls:', newImageUrls.length, 'baseline cũ:', baselineFileIds.size, 'alt:', altText.slice(0, 60));
        return {
          success: true,
          imageUrls: newImageUrls,
          altPrompt: altText.replace(/^Generated image:\s*/i, ''),
          turnId: null,
        };
      }

      // Chưa có turn mới so với baseline → tiếp tục poll (NHƯNG cũng kiểm tra global Generating)
      if (allTurns.length <= baseline.turnCount) {
        if (Date.now() - lastDiag > 3000) { // throttle 3s (giảm từ 5s) cho debug responsive hơn
          const genState = globalGenerating ? 'GENERATING (global)' : 'idle';
          const url = window.location.pathname;
          // Log URL để detect SPA navigation (vd /c/{id} mới vs /c/{id} cũ)
          console.log('[ChatGPT-detect] Chưa có turn mới — turnCount:', allTurns.length, 'baseline:', baseline.turnCount, 'state:', genState, 'url:', url);
          lastDiag = Date.now();
        }
        await sleep(pollInterval);
        continue;
      }

      // Tìm assistant turn MỚI qua multi-strategy (avoid stale old turn)
      const lastAssistantTurn = findNewAssistantTurn();
      if (!lastAssistantTurn) {
        await sleep(pollInterval);
        continue;
      }

      // 1. Detect error trước (ưu tiên cao)
      const error = detectError(lastAssistantTurn);
      if (error) {
        console.log('[ChatGPT-detect] Error:', error);
        return { success: false, error, message: (lastAssistantTurn.innerText || '').slice(0, 500) };
      }

      // Paragen-multigen: 2 ảnh để user chọn, không có post-action buttons
      // Server-Only: dynamic selectors
      const paragenContainer = _queryWithFallback('paragen_container', null, { scope: lastAssistantTurn, silent: true }) ||
                               _queryWithFallback('paragen_container', null, { silent: true });
      if (paragenContainer) {
        const paragenImgs = Array.from(_queryAllWithFallback('generated_image', null, paragenContainer))
          .filter(img => !img.classList.contains('blur-2xl') && img.src && img.src.startsWith('http'));
        const stillLoadingInParagen = !!_queryWithFallback('generating_indicator', null, { scope: paragenContainer, silent: true });
        if (paragenImgs.length >= 2 && !stillLoadingInParagen) {
          // 2 ảnh đã render xong trong paragen → trust + return success
          const paragenUrls = paragenImgs.map(img => img.src);
          // Dedup by file_id
          const seen = new Set();
          const dedupedUrls = paragenUrls.filter(url => {
            const m = url.match(/[?&]id=(file_[a-z0-9]+)/i);
            const key = m ? m[1] : url;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          console.log('[ChatGPT-detect] DONE (paragen-multigen) —', dedupedUrls.length, 'ảnh sẵn sàng');
          return {
            success: true,
            imageUrls: dedupedUrls,
            altPrompt: paragenImgs[0]?.alt?.replace(/^Generated image:?\s*/i, '') || '',
            turnId: lastAssistantTurn.dataset.turnId || lastAssistantTurn.dataset.testid || null,
          };
        }
      }

      // 2. Check image đã generated chưa — dùng _findGeneratedImg (có fallback nhiều CDN + alt-based)
      const generatedImg = _findGeneratedImg(lastAssistantTurn);
      let imageUrls = extractImageUrls(lastAssistantTurn);

      // Bug fix: Filter out images that existed BEFORE submit (based on file_id in baseline)
      // This prevents returning old images when findNewAssistantTurn falls back to an old turn
      // Note: baselineFileIds đã khai báo ở đầu while loop (line ~960)
      const preFilterCount = imageUrls.length;
      if (baselineFileIds.size > 0) {
        imageUrls = imageUrls.filter((url) => {
          const m = url.match(/[?&]id=(file_[a-z0-9]+)/i);
          if (!m) return true; // No file_id → can't filter, assume new
          const isOld = baselineFileIds.has(m[1]);
          if (isOld) console.log('[ChatGPT-detect] ⏭️ Filter old/ref image:', m[1]);
          return !isOld;
        });
      }
      if (preFilterCount !== imageUrls.length) {
        console.log('[ChatGPT-detect] 🔍 Baseline filter:', preFilterCount, '→', imageUrls.length, '| baselineIds:', baselineFileIds.size);
      }

      // FAST-PATH: post-action buttons (Like/Edit/Dislike/More actions) chỉ render khi gen XONG.
      // Reference DOM verified (chatgpt-result-image.html). Không cần check streaming khi gặp markers này.
      // Server-Only: dynamic selector (image_action_buttons covers Like/Edit/Dislike)
      const postActionDone = !!_queryWithFallback('image_action_buttons', null, { scope: lastAssistantTurn, silent: true });

      if (generatedImg && imageUrls.length > 0) {
        // Verify alt text — KHÔNG strict (selector đã match alt^="Generated image" nếu fallback path)
        const altText = generatedImg.getAttribute('alt') || '';
        const isGeneratedAlt = altText.toLowerCase().startsWith('generated image');

        // Conditions to trust result:
        // - postActionDone (Like/Edit button present — strongest signal)
        // - HOẶC alt^="Generated image" (alt confirm)
        // - HOẶC URL match (estuary/oaiusercontent) + đã hết streaming
        if (postActionDone || isGeneratedAlt || !isStreaming(lastAssistantTurn)) {
          const turnId = lastAssistantTurn.dataset.turnId || lastAssistantTurn.dataset.testid || null;
          console.log('[ChatGPT-detect] DONE — urls:', imageUrls.length, 'alt:', altText.slice(0, 60), 'postAction:', postActionDone);
          return {
            success: true,
            imageUrls,
            altPrompt: isGeneratedAlt ? altText.replace(/^Generated image:\s*/i, '') : altText,
            turnId,
          };
        }
        // Có img nhưng vẫn streaming → wait tiếp
      }

      // 3. Check streaming còn chạy không
      if (isStreaming(lastAssistantTurn)) {
        // PROACTIVE TEXT_ONLY detection — Server-Only: dynamic selectors
        const hasImageMarker = _hasGeneratingIndicator(lastAssistantTurn) ||
                               !!_queryWithFallback('generated_image', null, { scope: lastAssistantTurn, silent: true }) ||
                               _hasGeneratingIndicator();
        const currentText = (lastAssistantTurn.innerText || '').trim();
        const textLen = currentText.length;

        if (!hasImageMarker && textLen > 50) {
          const elapsedMs = Date.now() - startTime;
          const hasPositive = hasPositiveIndicator(currentText);

          // SKIP pattern check nếu: có positive indicator + chưa đủ thời gian
          // (ChatGPT có thể nói "Sure, I'll create..." trước khi hiện Generating indicator)
          // Bug fix: Nếu có positive indicator, chờ lâu hơn (10s) vì ChatGPT placeholder
          // có thể dài >150 chars nhưng vẫn đang chuẩn bị gen ảnh.
          const waitThreshold = hasPositive ? MIN_WAIT_WITH_POSITIVE_MS : MIN_WAIT_BEFORE_PATTERN_CHECK_MS;
          const shouldCheckPatterns = elapsedMs > waitThreshold;

          if (shouldCheckPatterns) {
            // FAST DETECTION 1: Check error patterns (rateLimit, contentBlocked, imageGenFailed)
            const errorMatch = matchesAnyErrorPattern(currentText);
            if (errorMatch) {
              console.log('[ChatGPT-detect]', errorMatch.error, '(pattern match):', currentText.slice(0, 100));
              return { success: false, error: errorMatch.error, text: errorMatch.text };
            }

            // FAST DETECTION 2: Check TEXT_ONLY pattern
            if (matchesTextOnlyPattern(currentText)) {
              // Re-check generating indicator trước khi return (race condition)
              // Server-Only: dynamic selectors
              const recheckMarker = _hasGeneratingIndicator(lastAssistantTurn) ||
                                    !!_queryWithFallback('generated_image', null, { scope: lastAssistantTurn, silent: true }) ||
                                    _hasGeneratingIndicator();
              if (recheckMarker || _hasRealNewImage()) {
                console.log('[ChatGPT-detect] TEXT_ONLY avoided — generating indicator/ảnh mới (cdn) xuất hiện sau text');
                // Reset và tiếp tục poll
              } else {
                console.log('[ChatGPT-detect] TEXT_ONLY (pattern match):', currentText.slice(0, 100));
                return { success: false, error: 'TEXT_ONLY', text: currentText.slice(0, 500) };
              }
            }
          }

          // FALLBACK: Chờ threshold nếu pattern không match nhưng text dài + ko có image marker
          if (!textOnlyStreamStart) {
            textOnlyStreamStart = Date.now();
            console.log('[ChatGPT-detect] TEXT_ONLY tracking started — textLen:', textLen, 'hasPositive:', hasPositive);
          } else if (Date.now() - textOnlyStreamStart > TEXT_ONLY_THRESHOLD_MS) {
            // Final scan — image marker có thể vừa xuất hiện (race condition)
            // Server-Only: dynamic selectors
            const finalImg = _queryWithFallback('generated_image', null, { scope: lastAssistantTurn, silent: true }) ||
                             _queryWithFallback('generated_image', null, { silent: true }) ||
                             _queryWithFallback('generating_indicator', null, { scope: lastAssistantTurn, silent: true }) ||
                             _queryWithFallback('generating_indicator', null, { silent: true });
            if (finalImg || _hasRealNewImage()) {
              console.log('[ChatGPT-detect] TEXT_ONLY false positive avoided — image marker/cdn ảnh mới xuất hiện:', finalImg?.tagName || 'cdn');
              textOnlyStreamStart = null;
              await sleep(pollInterval);
              continue;
            }
            console.log('[ChatGPT-detect] TEXT_ONLY (timeout) — streaming text >' + (TEXT_ONLY_THRESHOLD_MS / 1000) + 's, no image marker:', currentText.slice(0, 100));
            return { success: false, error: 'TEXT_ONLY', text: currentText.slice(0, 500) };
          }
        } else if (hasImageMarker) {
          textOnlyStreamStart = null;
        }

        if (Date.now() - lastDiag > 5000) {
          console.log('[ChatGPT-detect] Streaming, hasImg:', !!generatedImg, 'textOnlyTracking:', !!textOnlyStreamStart);
          lastDiag = Date.now();
        }
        await sleep(pollInterval);
        continue;
      }

      // 4. Turn complete nhưng không có image → check pending img hoặc TEXT_ONLY
      // Server-Only: dynamic generated_image selector
      const pendingGenImg = _queryWithFallback('generated_image', null, { scope: lastAssistantTurn, silent: true }) ||
                            _queryWithFallback('generated_image', null, { silent: true });
      const imgPending = pendingGenImg && (!pendingGenImg.src || pendingGenImg.classList.contains('blur-2xl'));
      if (imgPending) {
        postCompleteTextOnlyStart = null; // Reset grace period — image đang load
        if (Date.now() - lastDiag > 3000) {
          const reason = !pendingGenImg.src ? 'src loading' : 'blur-2xl transition';
          console.log('[ChatGPT-detect] Pending img (' + reason + '):', pendingGenImg.alt?.slice(0, 40));
          lastDiag = Date.now();
        }
        await sleep(pollInterval);
        continue;
      }

      const text = (lastAssistantTurn.innerText || '').trim();
      if (text.length > 20) {
        // Check error patterns trước (rateLimit, contentBlocked, imageGenFailed)
        const errorMatch = matchesAnyErrorPattern(text);
        if (errorMatch) {
          console.log('[ChatGPT-detect]', errorMatch.error, '(post-complete):', text.slice(0, 100));
          return { success: false, error: errorMatch.error, text: errorMatch.text };
        }

        // Global fallback — check image render trước khi return TEXT_ONLY
        // Server-Only: dynamic generated_image selector
        const globalGenImg = _queryWithFallback('generated_image', null, { silent: true });
        if (globalGenImg && globalGenImg.src && !globalGenImg.classList.contains('blur-2xl')) {
          const fileIdMatch = globalGenImg.src.match(/[?&]id=(file_[a-z0-9]+)/i);
          const fileId = fileIdMatch?.[1];
          const isNewImage = !fileId || !baselineFileIds.has(fileId);
          if (isNewImage) {
            console.log('[ChatGPT-detect] TEXT_ONLY avoided via global fallback — found new image:', globalGenImg.alt?.slice(0, 50));
            postCompleteTextOnlyStart = null; // Reset grace period
            // Continue polling to let the normal success path handle extraction
            await sleep(pollInterval);
            continue;
          }
        }

        // Also check generating indicator globally — image still being generated
        if (_hasGeneratingIndicator()) {
          console.log('[ChatGPT-detect] TEXT_ONLY avoided — global generating indicator present');
          postCompleteTextOnlyStart = null; // Reset grace period
          await sleep(pollInterval);
          continue;
        }

        // Grace period — chờ DOM kịp update image render
        if (!postCompleteTextOnlyStart) {
          postCompleteTextOnlyStart = Date.now();
          console.log('[ChatGPT-detect] TEXT_ONLY grace period started — waiting for potential late image render');
        }

        if (Date.now() - postCompleteTextOnlyStart < POST_COMPLETE_GRACE_MS) {
          // Final comprehensive scan giống với global fallback ở đầu loop
          const allGenImgsGrace = _queryAllWithFallback('generated_image');
          let foundNewImageInGrace = false;
          for (const img of allGenImgsGrace) {
            if (img.classList.contains('blur-2xl') || !img.src) continue;
            const alt = img.getAttribute('alt') || '';
            const isGenerated = alt.toLowerCase().startsWith('generated image');
            const isSibling = alt === '';
            if (!isGenerated && !isSibling) continue;
            const m = img.src.match(/[?&]id=(file_[a-z0-9]+)/i);
            if (!m) continue;
            if (baselineFileIds.has(m[1])) continue;
            // Found new image during grace period!
            console.log('[ChatGPT-detect] TEXT_ONLY avoided during grace period — found new image:', alt.slice(0, 50));
            postCompleteTextOnlyStart = null;
            foundNewImageInGrace = true;
            break;
          }
          if (foundNewImageInGrace) {
            await sleep(pollInterval);
            continue;
          }
          // No image found yet, continue polling within grace period
          await sleep(pollInterval);
          continue;
        }

        // Final src-based guard: ảnh thật (alt có thể set TRỄ → alt='') vẫn coi là có ảnh, KHÔNG text-only.
        if (_hasRealNewImage()) {
          console.log('[ChatGPT-detect] TEXT_ONLY (post-complete) avoided — cdn ảnh mới hiện diện (alt set trễ)');
          postCompleteTextOnlyStart = null;
          await sleep(pollInterval);
          continue;
        }

        // Grace period exhausted, truly TEXT_ONLY
        console.log('[ChatGPT-detect] TEXT_ONLY (post-complete) after', POST_COMPLETE_GRACE_MS, 'ms grace:', text.slice(0, 100));
        return { success: false, error: 'TEXT_ONLY', text: text.slice(0, 500) };
      }

      await sleep(pollInterval);
    }

    // Timeout grace: nếu có image marker → extend chờ render xong.
    // Dùng cdn_image (src-based) để hasPendingImage=true cả khi alt chưa set (vào grace re-check).
    // Grace dùng isRealGen lọc ref nên vào grace vì ref cũng vô hại (sẽ bail nếu không có generated thật).
    const finalImg = _queryCdnImages(document).length > 0;
    const finalLoadingIndicator = _hasGeneratingIndicator();
    const hasPendingImage = !!(finalImg || finalLoadingIndicator);
    if (hasPendingImage) {
      console.warn('[ChatGPT-detect] TIMEOUT sau', timeout, 'ms — có image marker → extend grace động (cap 240s, gen ảnh chậm)');
      const graceMaxDeadline = Date.now() + 240000; // cap 240s — chờ ChatGPT gen ảnh chậm
      let postGenGraceStart = null; // mốc indicator tắt — chờ ảnh render trễ trước khi bail
      while (Date.now() < graceMaxDeadline) {
        if (isAbortActive()) {
          await clickChatGPTStopButton();
          return { success: false, error: 'ABORTED', message: 'User stopped during grace' };
        }
        // Re-check image — Server-Only: dynamic selector.
        // Bug fix 2026-05-27: selector generated_image có img[src*="/backend-api/"] match CẢ ref images
        // (ref cũng src backend-api, không aria-hidden) → grace cũ (chỉ lọc blur+http) trả NHẦM 2 ref
        // images của upstream image nodes thành "kết quả". Lọc: chỉ ảnh generated thật (alt^="Generated
        // image" hoặc alt="" sibling — LOẠI ref alt=UUID) + loại ảnh cũ trong baseline.
        const baseIds = baseline.existingImageFileIds || new Set();
        const isRealGen = (img) => {
          if (img.classList.contains('blur-2xl') || !img.src?.startsWith('http')) return false;
          const a = img.getAttribute('alt') || '';
          if (!(a.toLowerCase().startsWith('generated image') || a === '')) return false; // loại ref (alt=UUID)
          const m = img.src.match(/[?&]id=(file_[a-z0-9]+)/i);
          if (m && baseIds.has(m[1])) return false; // loại ảnh cũ / ref đã có trước submit
          return true;
        };
        const genImgs = Array.from(_queryCdnImages(document)).filter(isRealGen);
        if (genImgs.length > 0) {
          console.log('[ChatGPT-detect] Image rendered trong grace period:', genImgs[0].src.slice(0, 80));
          const dedup = [...new Map(genImgs.map(img => {
            const m = img.src.match(/[?&]id=(file_[a-z0-9]+)/i);
            return [m ? m[1] : img.src, img.src];
          })).values()];
          return {
            success: true,
            imageUrls: dedup,
            altPrompt: genImgs[0].alt?.replace(/^Generated image:\s*/i, '') || '',
            turnId: null,
          };
        }
        // Bug fix 2026-05-27: KHÔNG bail NGAY khi indicator tắt. ChatGPT gen xong (indicator tắt)
        // nhưng asset ảnh render vào DOM TRỄ vài giây → bail ngay → miss ảnh → timeout-oan dù gen OK
        // (xác nhận page-log: "ngừng generate, không có ảnh" rồi ảnh hiện sau). Chờ thêm 10s sau khi
        // indicator tắt cho ảnh render (genImgs re-check mỗi vòng 2s sẽ bắt được nếu ảnh kịp render).
        if (!_hasGeneratingIndicator()) {
          if (!postGenGraceStart) {
            postGenGraceStart = Date.now();
          } else if (Date.now() - postGenGraceStart > 10000) {
            console.warn('[ChatGPT-detect] Grace: indicator tắt + không có ảnh sau 10s → kết thúc');
            return { success: false, error: 'TIMEOUT', hasPendingImage: false };
          }
        } else {
          postGenGraceStart = null; // còn generating → reset đồng hồ chờ post-gen
        }
        await sleep(2000);
      }
      console.warn('[ChatGPT-detect] TIMEOUT sau grace 240s — image vẫn pending, return với hasPendingImage hint');
      return { success: false, error: 'TIMEOUT', hasPendingImage: true };
    }

    console.warn('[ChatGPT-detect] TIMEOUT sau', timeout, 'ms — không có image marker');
    return { success: false, error: 'TIMEOUT', hasPendingImage: false };
  }

  // Main handler — giữ NGUYÊN logic Phase X (ChatAIModal) + thêm các listener CG-2/CG-3.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // [2026-06-13] pq:trackerUpdate — sidepanel PromptQueue broadcast queue snapshot
    // → FloatingTracker rich UI hiển thị multi-prompt jobs/items giống Flow.
    if (message.action === 'pq:trackerUpdate') {
      const _d = message.data;
      // rich active khi còn job đang chạy → khoá legacy. isRunning=false (xong) → mở lại để auto-hide chạy.
      _ftRichActive = !!(_d && _d.jobs && _d.jobs.length && _d.isRunning !== false);
      try { FloatingTracker.updateFromQueue(_d); } catch (e) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#isRealGen', e); }
      sendResponse({ ok: true });
      return false;
    }

    // SSE invalidate: admin update DOM selector → clear cache để query fresh
    if (message.action === 'providerConfigUpdated') {
      _selectorConfig = null;
      _selectorConfigTime = 0;
      console.log('[ChatGPT] Provider config updated via SSE — selector cache invalidated');
      sendResponse({ success: true });
      return false;
    }

    // chatAI:execute — ChatAIModal flow
    if (message.action === 'chatAI:execute') {
      (async () => {
        try {
          // 1. Upload images first (if any)
          if (message.images && message.images.length > 0) {
            const uploaded = await uploadImages(message.images);
            if (!uploaded) {
              sendResponse({ success: false, error: 'Không thể upload ảnh lên ChatGPT' });
              return;
            }
          }

          // 2. Insert text
          const textInserted = await insertText(message.text);
          if (!textInserted) {
            sendResponse({ success: false, error: 'Không thể nhập text vào ChatGPT' });
            return;
          }

          // 3. Submit
          const submitted = await clickSubmit();
          if (!submitted) {
            sendResponse({ success: false, error: 'Không thể gửi tin nhắn trên ChatGPT' });
            return;
          }

          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message || 'Lỗi không xác định' });
        }
      })();

      return true; // async sendResponse
    }

    // chatgpt:submitAndWait — submit prompt + chờ kết quả (image/text mode)
    if (message.action === 'chatgpt:submitAndWait') {
      // Timestamp-guarded reset — chỉ wipe stale abort > 5s
      __chatgptCallStartAt = Date.now();
      if (__chatgptAbort && __chatgptAbortAt < __chatgptCallStartAt - 5000) {
        __chatgptAbort = false;
        __chatgptAbortAt = 0;
      }
      // Set inputTimeoutMs từ payload (Adapter pass từ user setting). Default 1200 nếu không có.
      // Macro delay giữa các bước chính = 70% inputTimeoutMs.
      __chatgptInputTimeoutMs = Number(message.inputTimeoutMs) || 1200;
      __chatgptMacroDelayMs = Math.round(__chatgptInputTimeoutMs * 0.7);
      console.log('[ChatGPT] Timing — inputTimeout:', __chatgptInputTimeoutMs, 'ms | macroDelay:', __chatgptMacroDelayMs, 'ms (70%)');

      const isTextMode =
        message.expectText === true || message.settings?.imageMode === false;
      console.log(
        '[ChatGPT-listener] chatgpt:submitAndWait nhận, mode:', isTextMode ? 'text' : 'image',
        'text len:', (message.text || '').length,
        'images:', (message.images || []).length,
      );

      // Show FloatingTracker và ExecutionBlocker
      const promptPreview = (message.text || '').substring(0, 50);
      FloatingTracker.show({ current: 0, total: 1, phase: _i18n.t('preparing'), prompt: promptPreview });
      ExecutionBlocker.show();

      (async () => {
        try {
          // PRE-CHECK: Cloudflare/OpenAI challenge — tab inactive → challenge stuck → DOM ops fail silent.
          if (detectChatGPTChallenge()) {
            FloatingTracker.update({ phase: _i18n.t('waitingVerification') });
            const resolved = await waitForChatGPTChallengeResolved(120000);
            if (!resolved) {
              FloatingTracker.hide();
              ExecutionBlocker.hide();
              sendResponse({
                success: false,
                error: 'CHALLENGE_TIMEOUT',
                message: 'ChatGPT yêu cầu xác minh. Vui lòng mở tab ChatGPT, hoàn thành verification, sau đó chạy lại.',
              });
              return;
            }
          }
          checkAbort('after-challenge-check');

          // NEW CHAT: Skip clickNewChatAndWaitReady — ensureTabActive đã navigate về homepage.
          // Homepage https://chatgpt.com/ = new chat + fresh UI state (fix ChatGPT bugs).
          // Chỉ cần verify đang ở homepage trước khi tiếp tục.
          const shouldNewChat = !isTextMode && (message.settings?.newChat !== false);
          // Path conversation CŨ trước khi tạo new chat — guard SPA yank-back trước submit
          let prevConvPath = null;
          if (shouldNewChat) {
            const currentPath = window.location.pathname;
            if (currentPath === '/' || currentPath === '') {
              // Đã ở homepage NHƯNG trang có thể đang transition (ensureTabActive vừa navigate /
              // new-chat nav 2 nhịp) — chờ composer ổn định TRƯỚC khi upload ref/submit, tránh
              // ref/prompt bị nhịp nav sau wipe. Best-effort: unstable vẫn tiếp tục.
              console.log('[ChatGPT] Already at homepage (new chat) — chờ composer ổn định trước upload ref/submit');
              const _stable = await _readyWithChatTab(6000);
              if (!_stable) console.warn('[ChatGPT] Composer chưa ổn định sau 6s — tiếp tục (best-effort)');
            } else {
              prevConvPath = currentPath;
              // Fallback: nếu chưa ở homepage, thử click new chat button
              console.log('[ChatGPT] Not at homepage, trying clickNewChatAndWaitReady...');
              const newChatReady = await clickNewChatAndWaitReady(8000);
              if (!newChatReady) {
                console.warn('[ChatGPT] New chat không ready — tiếp tục với conversation hiện tại');
              }
            }
            checkAbort('after-new-chat');
            await sleep(getMacroDelay());  // Macro gap → upload refs
          }

          // PRE-CHECK: Detect image creation limit alert — chỉ áp dụng khi đang ở image mode.
          // Text mode (Prompt node) không liên quan đến image quota → bỏ qua check.
          if (!isTextMode) {
            const limitAlert = checkImageLimitAlert();
            if (limitAlert?.detected) {
              console.warn('[ChatGPT-listener] LIMIT_ALERT detected — bỏ qua submit:', limitAlert.message);
              FloatingTracker.hide();
              ExecutionBlocker.hide();
              sendResponse({
                success: false,
                error: 'LIMIT_ALERT',
                message: limitAlert.message,
              });
              return;
            }
          }

          // 1. CRITICAL FIX: Chờ hoàn tất generation đang chạy (nếu có) TRƯỚC khi capture baseline.
          // Bug: Task A gen ảnh → Task B submit → baseline capture khi A đang gen → A xong trước B
          // → B's waitForImageResult thấy ảnh A là "mới" (không trong baseline) → trả về ảnh SAI!
          // Fix: Đợi generating indicator biến mất trước khi capture baseline.
          const existingGenIndicator = _hasGeneratingIndicator();
          if (existingGenIndicator) {
            console.log('[ChatGPT] Đang có image generation từ task trước — chờ hoàn tất...');
            const maxWaitGen = 120000; // 2 phút max
            const startWaitGen = Date.now();
            while (Date.now() - startWaitGen < maxWaitGen) {
              if (isAbortActive()) {
                FloatingTracker.hide();
                ExecutionBlocker.hide();
                sendResponse({ success: false, error: 'ABORTED', message: 'User stopped' });
                return;
              }
              const stillGen = _hasGeneratingIndicator();
              if (!stillGen) {
                console.log('[ChatGPT] Generation trước đã hoàn tất — tiếp tục submit task mới');
                break;
              }
              await sleep(1000);
            }
            // Sau khi gen trước xong, sleep thêm để DOM update file_id
            await sleep(500);
          }

          // 2. Snapshot baseline TRƯỚC khi submit (sau khi đã chờ gen cũ xong)
          const baseline = snapshotConversationState();
          // Path tại thời điểm baseline — mọi navigation sau đó tới trước submit = yank-back
          // (image mode không có navigation hợp lệ trong cửa sổ này).
          const expectedSubmitPath = window.location.pathname;

          // 3. Quyết định text submit + cleanup mode
          //    - Image mode: nếu image mode active thì giữ nguyên, ngược lại fallback prefix.
          //    - Text mode: deactivate image mode (sticky) + prepend prefix bắt LLM trả plain prompt.
          let textToSubmit = message.text || '';
          if (isTextMode) {
            // Bug fix: ChatGPT image mode sticky → Prompt enhance gọi text mà image mode vẫn ON
            // → response có thể trả về image hoặc reply dài dòng. Force toggle off TRƯỚC khi submit.
            try { await deactivateImageModeIfActive(); } catch (e) {
              console.warn('[ChatGPT] deactivateImageMode error:', e?.message);
            }
            // Prefix bắt LLM trả plain prompt text — theo ngôn ngữ user setting (fallback EN).
            const enhancePrefix = await getEnhancePrefix();
            textToSubmit = enhancePrefix + textToSubmit;
          }

          // 3b. Upload ref images TRƯỚC, activate image mode SAU.
          // Verified 2026-05-09 (user feedback): ChatGPT KHÔNG yêu cầu image mode active để upload.
          // Trước đây code activate 2 lần (trước upload + sau upload re-activate) — DƯ THỪA.
          // Flow tối ưu: upload trước (clean DOM) → activate 1 lần sau → submit.
          // Lý do: activate trước upload làm upload reset state → cần re-activate → tốn 2 cycle.
          //         Activate sau upload thì state stable, chỉ cần 1 cycle.
          //
          // CRITICAL: GỌI removeExistingChatGPTRefImages() ngay cả khi task không có refs —
          // bug fix: refs cũ từ session trước còn dính trong composer → submit kéo theo context sai.
          await removeExistingChatGPTRefImages();
          await sleep(200);

          // Verify composer sạch sau remove — selector remove_ref_image_button drift → remove
          // silent fail → ref cũ (draft restore trên homepage) đi kèm message mới.
          let staleRefs = _countComposerRefImages();
          if (staleRefs > 0) {
            // React remove tile trễ — poll ngắn trước khi kết luận
            for (let i = 0; i < 3 && staleRefs > 0; i++) {
              await sleep(300);
              staleRefs = _countComposerRefImages();
            }
            if (staleRefs > 0) {
              console.warn('[ChatGPT] Composer còn', staleRefs, 'ref cũ sau remove — retry remove');
              await removeExistingChatGPTRefImages();
              await sleep(500);
              staleRefs = _countComposerRefImages();
            }
          }
          if (staleRefs > 0) {
            console.error('[ChatGPT] COMPOSER_DIRTY — không gỡ được', staleRefs, 'ref cũ (selector remove_ref_image_button drift?)');
            FloatingTracker.hide();
            ExecutionBlocker.hide();
            sendResponse({
              success: false,
              error: 'COMPOSER_DIRTY',
              retryable: true,
              message: `Composer còn ${staleRefs} ref cũ không gỡ được — cần reload trang ChatGPT.`,
            });
            return;
          }
          checkAbort('after-remove-refs');

          // Draft text cũ persist trên homepage (cùng class bug ref rác) → clear TRƯỚC khi
          // activate image mode: lúc này CHƯA có pill nên selectAll+delete an toàn, không phá mode.
          const draftEditor = _queryWithFallback('composer', null, { silent: true });
          const draftText = (draftEditor?.textContent || '').trim();
          const draftPill = draftEditor
            ? (_queryWithFallback('image_mode_pill', null, { scope: draftEditor, silent: true })
              || draftEditor.querySelector('[data-inline-selection-pill]'))
            : null;
          if (draftEditor && draftText.length > 0 && !draftPill) {
            console.log('[ChatGPT] Draft cũ trong composer (len=' + draftText.length + ', head="' + draftText.slice(0, 30) + '") — clear trước activate image mode');
            try {
              draftEditor.focus();
              await sleep(100);
              document.execCommand('selectAll', false, null);
              await sleep(50);
              document.execCommand('delete', false, null);
              await sleep(100);
              if ((draftEditor.textContent || '').trim().length > 0) {
                draftEditor.innerHTML = '<p><br class="ProseMirror-trailingBreak"></p>';
                draftEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
                await sleep(80);
              }
              console.log('[ChatGPT] Draft clear xong, editor len=' + (draftEditor.textContent || '').trim().length);
            } catch (e) {
              console.warn('[ChatGPT] Draft clear lỗi (non-fatal):', e.message);
            }
          }

          if (Array.isArray(message.images) && message.images.length > 0) {
            const uploaded = await injectRefImages(message.images);
            if (!uploaded) {
              sendResponse({
                success: false,
                error: 'REF_UPLOAD_FAILED',
                message: 'Không thể upload ref image lên ChatGPT',
              });
              return;
            }
            checkAbort('after-upload-refs');
            // Giảm delay để click ratio trong lúc upload progress chưa hoàn toàn settle
            // (ChatGPT UI: click ratio khi có file uploading = open dropdown, sau khi settle = toggle off)
            await sleep(150);
          }

          // 4a. Chọn model GPT-5.5 (Instant/Thinking) TRƯỚC khi activate image mode.
          // CRITICAL (bug fix 2026-05-27): đổi model RESET tools composer (xóa "Create image") → nếu
          // chọn model SAU image mode → mất image mode → submit thành TEXT gen (log: total:0). Phải
          // chọn model trước → activateImageMode là bước CUỐI trước submit → image mode survive.
          if (!isTextMode && message.settings?.model) {
            await selectChatGPTModel(message.settings.model);
            checkAbort('after-select-model');
            await sleep(getMacroDelay());
          }

          // 4. ACTIVATE IMAGE MODE + RATIO (1 lần duy nhất, sau model + upload refs).
          if (!isTextMode && message.settings?.imageMode) {
            const ratio = message.settings?.ratio || '1:1';
            let activated = false;
            if (message.settings?.skipImageToggle) {
              // P1 né yank (2026-07-09): toggle "Create image" là điểm kích hoạt ChatGPT nhảy về
              // conversation image-gen gần nhất còn sống → retry sau YANKED không đụng toggle,
              // ép gen ảnh qua fallback prefix (đường fallback chính thức sẵn có).
              console.log('[ChatGPT] skipImageToggle — bỏ qua toggle Create image, dùng fallback prefix');
            } else {
              console.log('[ChatGPT] Activating image mode với ratio:', ratio);
              activated = await activateImageMode(ratio);
            }
            if (!activated) {
              if (!message.settings?.skipImageToggle) console.warn('[ChatGPT] Không thể activate image mode — sẽ dùng fallback prefix');
              if (message.settings?.fallbackPrefix) {
                textToSubmit = message.settings.fallbackPrefix + textToSubmit;
              }
            }
            // UI 2026-08: ChatGPT bỏ nút ratio → nhúng ratio vào CUỐI prompt (caller append sau cùng).
            const _ratioSuffix = ratioToPromptSuffix(ratio);
            if (_ratioSuffix) {
              textToSubmit = textToSubmit + _ratioSuffix;
              console.log('[ChatGPT] Ratio nhúng vào prompt:', _ratioSuffix.trim());
            }
            checkAbort('after-activate-image-mode');
            await sleep(getMacroDelay());  // Macro gap activate → injectTextAndSubmit (clear+insert+submit)
          }

          // 5. Guard SPA yank-back: conversation cũ còn ACTIVE STREAM → sau reload ChatGPT resume
          // stream, tương tác composer (toggle Create image) làm router kéo về /c/{old} → submit
          // rơi vào chat cũ + baseline (chụp trên homepage) lệch trang → detect lấy nhầm ảnh CŨ.
          // Check tổng quát theo expectedSubmitPath (không chỉ prevConvPath — sau reload
          // prevConvPath=null nhưng yank vẫn xảy ra).
          const _pathNow = window.location.pathname;
          const _yankedBack = (prevConvPath && _pathNow === prevConvPath)
            || (shouldNewChat && _pathNow !== expectedSubmitPath);
          if (_yankedBack) {
            console.error('[ChatGPT] SPA nhảy về conversation khác (' + _pathNow + ', expected ' + expectedSubmitPath + ') — chờ stream cũ (magnet) kết thúc rồi yêu cầu reload');
            // Chờ stream cũ xong (magnet chết) TRƯỚC khi trả retryable — nếu không, reload xong
            // stream vẫn chạy → yank lặp lại vô hạn. Abort-aware, cap 120s.
            const _t0 = Date.now();
            while (Date.now() - _t0 < 120000 && _hasGeneratingIndicator()) {
              if (isAbortActive()) {
                FloatingTracker.hide();
                ExecutionBlocker.hide();
                sendResponse({ success: false, error: 'ABORTED', message: 'User stopped' });
                return;
              }
              await sleep(1000);
            }
            FloatingTracker.hide();
            ExecutionBlocker.hide();
            sendResponse({
              success: false,
              error: 'SUBMIT_FAILED_NEED_RELOAD',
              reason: 'YANKED', // adapter đọc để retry với skipImageToggle (né điểm kích hoạt yank)
              retryable: true,
              message: 'ChatGPT nhảy về chat cũ (stream đang chạy) — đã chờ stream xong, cần reload + thử lại.',
            });
            return;
          }

          // 5b. Inject text + click submit
          const submitOk = await injectTextAndSubmit(textToSubmit);
          if (submitOk === false) {
            // Fail toàn bộ tier = page state hỏng (stale conversation / network flap) — text còn kẹt
            // trong composer, nếu tiếp tục sẽ dồn prompt sau vào cùng chat. Trả retryable để adapter
            // forceRefresh homepage + submit lại (cùng đường COMPOSER_DIRTY).
            console.error('[ChatGPT] Submit fail toàn bộ tier — yêu cầu reload trang để retry');
            FloatingTracker.hide();
            ExecutionBlocker.hide();
            sendResponse({
              success: false,
              error: 'SUBMIT_FAILED_NEED_RELOAD',
              retryable: true,
              message: 'Không gửi được prompt (trang ChatGPT lỗi trạng thái) — cần reload trang.',
            });
            return;
          }

          // 6. Chờ kết quả — branch theo mode.
          checkAbort('before-wait-result');
          FloatingTracker.update({ current: 1, total: 1, phase: _i18n.t('waitingResult'), prompt: promptPreview });
          const timeout = message.timeout || (isTextMode ? 60000 : 300000); // image fallback 120s→300s (gen nhiều ref chậm)
          const result = isTextMode
            ? await waitForTextResult(baseline, timeout)
            : await waitForImageResult(baseline, timeout);

          FloatingTracker.hide();
          ExecutionBlocker.hide();
          sendResponse(result);
        } catch (err) {
          FloatingTracker.hide();
          ExecutionBlocker.hide();
          // Bug fix 2026-05-09: catch ABORT throws → click ChatGPT Stop button để halt backend gen
          if (err.message && err.message.startsWith('ABORTED')) {
            const stage = err.message.replace('ABORTED:', '');
            console.log('[ChatGPT] Caught ABORT at stage:', stage, '→ clicking Stop button');
            await clickChatGPTStopButton();
            sendResponse({
              success: false,
              error: 'ABORTED',
              message: 'User stopped at ' + stage,
            });
            return;
          }
          sendResponse({
            success: false,
            error: 'EXCEPTION',
            message: err.message || 'Lỗi không xác định',
          });
        } finally {
          // Safety net: đảm bảo overlay LUÔN đóng dù path nào (kể cả early-return/throw bất ngờ).
          FloatingTracker.hide();
          ExecutionBlocker.hide();
        }
      })();

      return true; // async sendResponse
    }

    // provider:textTask (2026-06-15): action CHUNG cho i2p (Image→Prompt) + Prompt Assistant.
    // Upload ảnh (nếu có) + gửi text (template/meta-prompt) + đọc TEXT response.
    // Text mode (deactivate image mode để ChatGPT trả text, KHÔNG gen ảnh) + KHÔNG enhancePrefix.
    // Payload: { action, text, images:[{base64,name,type}], timeout, deleteAfter }
    if (message.action === 'provider:textTask') {
      __chatgptCallStartAt = Date.now();
      __chatgptAbort = false; __chatgptAbortAt = 0;
      ExecutionBlocker.show(); // chặn user can thiệp khi i2p/PA tự chat (ngay khi tab active)
      (async () => {
        try {
          if (typeof detectChatGPTChallenge === 'function' && detectChatGPTChallenge()) {
            const resolved = await waitForChatGPTChallengeResolved(120000);
            if (!resolved) { sendResponse({ success: false, error: 'CHALLENGE_TIMEOUT' }); return; }
          }
          // Chờ trang interactive trước mọi thao tác (fix upload fail khi fresh tab/reload delay).
          await waitProviderReady();
          // newChat: mở chat mới (SPA, không reload) → i2p/PA chạy biệt lập, không đụng hội thoại
          // user đang dùng. Capture kết quả để gate deleteAfter (symmetric với Gemini): nếu new-chat
          // fail (button miss) → đang ở hội thoại user → KHÔNG xóa để tránh đụng nội dung user.
          let isolated = !message.newChat;
          if (message.newChat) {
            try { isolated = await clickNewChatAndWaitReady(8000); } catch (_) { isolated = false; }
            // Race mất prompt (PA long-prompt → file .txt): lần 1 fail = click nav ĐÃ bắn nhưng SPA chưa
            // settle — paste lúc này sẽ bị editor mới mount wipe attachment đang upload. Retry lần 2.
            // Vẫn fail → trả lỗi retryable, KHÔNG paste mù.
            if (!isolated) {
              console.warn('[ChatGPT-i2p] New chat chưa settle sau 8s → chờ thêm 1 nhịp');
              try { isolated = await clickNewChatAndWaitReady(8000); } catch (_) { isolated = false; }
              if (!isolated) {
                sendResponse({ success: false, error: 'NEW_CHAT_NOT_READY', retryable: true, message: 'Trang ChatGPT chưa mở xong chat mới — thử lại.' });
                return;
              }
            }
          }
          const baseline = snapshotConversationState();
          try { await deactivateImageModeIfActive(); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#isRealGen', _); }
          await removeExistingChatGPTRefImages();
          await sleep(200);
          if (Array.isArray(message.images) && message.images.length > 0) {
            const up = await injectRefImages(message.images);
            if (!up) { sendResponse({ success: false, error: 'IMAGE_UPLOAD_FAILED' }); return; }
            await sleep(250);
          }
          // i2p/PA: chọn model ChatGPT nếu payload chỉ định (i2p mặc định 'Instant'). PA không set → giữ nguyên.
          if (message.model) { try { await selectChatGPTModel(message.model); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#isRealGen', _); } }
          // false = editor detached giữa insert→submit (SPA re-render) — fail ngay thay vì
          // waitForTextResult treo tới timeout chờ response không bao giờ tới.
          const submitOk = await injectTextAndSubmit(message.text || '');
          if (submitOk === false) {
            sendResponse({ success: false, error: 'SUBMIT_FAILED', retryable: true, message: 'Editor ChatGPT bị re-render giữa chừng — prompt chưa gửi được, thử lại.' });
            return;
          }
          const result = await waitForTextResult(baseline, message.timeout || 90000);
          // Auto-delete (opt-in i2p_delete_after) — CHỈ khi biệt lập (chat mới). Nếu không isolated
          // (đang ở hội thoại user) → KHÔNG xóa, tránh đụng nội dung user (symmetric với Gemini).
          if (message.deleteAfter && result?.success && isolated) {
            try { await deleteLastAssistantMessage(); } catch (e) { console.warn('[ChatGPT-i2p] delete after failed:', e.message); }
          } else if (message.deleteAfter && result?.success && !isolated) {
            console.warn('[ChatGPT-i2p] skip deleteAfter — chưa mở được chat mới (tránh đụng chat user)');
          }
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, error: 'EXCEPTION', message: err.message || String(err) });
        } finally {
          ExecutionBlocker.hide();
        }
      })();
      return true; // async sendResponse
    }

    // chatgpt:abort — Set abort flag để các hàm wait/poll exit sớm
    if (message.action === 'chatgpt:abort') {
      __chatgptAbort = true;
      __chatgptAbortAt = Date.now();
      console.log('[ChatGPT-listener] chatgpt:abort received → set abort flag at', __chatgptAbortAt);
      // Hide trackers immediately
      FloatingTracker.hide();
      ExecutionBlocker.hide();
      sendResponse({ success: true });
      return false;
    }

    // chatgpt:deleteLastMessage — Xóa tin nhắn assistant gần nhất (2026-05-16)
    // Triggered after successful generation when setting `chatgpt_delete_after_gen` is enabled.
    if (message.action === 'chatgpt:deleteLastMessage') {
      (async () => {
        try {
          const success = await deleteLastAssistantMessage();
          sendResponse({ success });
        } catch (err) {
          console.error('[ChatGPT-listener] deleteLastMessage error:', err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // async sendResponse
    }

    // Không xử lý các action khác trong listener này
    return false;
  });

  // Theo dõi navigate sang conversation mới (SPA pushState)
  let _lastUrl = location.href;
  const _notifyNavigate = () => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      try {
        chrome.runtime.sendMessage({ action: 'chatgpt:navigated', url: location.href }).catch(function (_e) { globalThis.SEOSONA_swallow?.('chat-content-chatgpt#replaceState', _e); });
      } catch (e) {
        // Bỏ qua nếu runtime mất kết nối
      }
    }
  };

  // Hook pushState/replaceState để bắt SPA navigation
  try {
    const _origPushState = history.pushState;
    const _origReplaceState = history.replaceState;
    history.pushState = function() {
      _origPushState.apply(this, arguments);
      _notifyNavigate();
    };
    history.replaceState = function() {
      _origReplaceState.apply(this, arguments);
      _notifyNavigate();
    };
    window.addEventListener('popstate', _notifyNavigate);
  } catch (e) {
    // Bỏ qua nếu không hook được
  }

  console.log('[ChatAI] Content script ChatGPT đã được inject (Phase X + CG-2 + CG-3)');
})();
