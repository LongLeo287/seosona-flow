(function() {
  // Guard against double injection
  if (window._chatAIGeminiInjected) return;
  window._chatAIGeminiInjected = true;

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
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-gemini', _); }
  })();

  // Helper: sleep
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ============ Abort (C1 2026-06-16) ============
  // Trước đây Gemini KHÔNG có cơ chế abort → i2p:cancel gửi 'gemini:abort' bị drop, bấm Hủy vô tác
  // dụng (poll chạy hết timeout). Mirror pattern ChatGPT (__chatgptAbort + isAbortActive scope theo
  // call-start để abort cũ không kill call mới).
  let __geminiAbort = false;
  let __geminiAbortAt = 0;
  let __geminiCallStartAt = 0;
  function isGeminiAbort() { return __geminiAbort && __geminiAbortAt >= __geminiCallStartAt; }

  // ============ ExecutionBlocker: chặn user can thiệp khi i2p/PA tự chat trên Gemini ============
  // Port từ ChatGPT (Gemini trước đây KHÔNG có) → hiện overlay viền glow + chặn click/keys ngay khi tab
  // active để tự động hoá. Escape x3 = thoát cứng (set abort). Auto-timeout 7' chỉ ẩn (không abort).
  const ExecutionBlocker = {
    _el: null, _styleEl: null, _blocking: false, _escapeCount: 0, _escapeTimer: null, _timeoutId: null,
    _MAX_BLOCK_TIME: 7 * 60 * 1000,
    _injectStyles() {
      if (this._styleEl) return;
      const style = document.createElement('style');
      style.id = 'seosonaflow-gemini-blocker-styles';
      style.textContent = '@keyframes seosonaflow-glow-pulse{0%,100%{opacity:0.4}50%{opacity:0.7}}' +
        '#seosonaflow-gemini-blocker{position:fixed;inset:0;z-index:2147483646;pointer-events:all;cursor:not-allowed;background:transparent;}' +
        '#seosonaflow-gemini-blocker::before{content:\'\';position:absolute;inset:0;border:5px solid #3d6ff5;box-shadow:inset 0 0 0 2px rgba(61, 111, 245,0.5),inset 0 0 15px rgba(61, 111, 245,0.3),0 0 15px rgba(61, 111, 245,0.5),0 0 35px rgba(61, 111, 245,0.35),0 0 60px rgba(61, 111, 245,0.2),0 0 100px rgba(61, 111, 245,0.1);animation:seosonaflow-glow-pulse 1.8s ease-in-out infinite;will-change:opacity;pointer-events:none;}';
      document.head.appendChild(style); this._styleEl = style;
    },
    _blockEvent(e) {
      if (!ExecutionBlocker._blocking) return;
      if (!e.isTrusted) return;
      if (e.target?.closest?.('#seosonaflow-gemini-tracker')) return;
      if (e.type === 'keydown' && e.key === 'Escape') {
        ExecutionBlocker._escapeCount++;
        clearTimeout(ExecutionBlocker._escapeTimer);
        ExecutionBlocker._escapeTimer = setTimeout(() => { ExecutionBlocker._escapeCount = 0; }, 2000);
        if (ExecutionBlocker._escapeCount >= 3) {
          console.warn('[Gemini-ExecutionBlocker] Force hide via Escape x3');
          ExecutionBlocker._escapeCount = 0; ExecutionBlocker.hide();
          __geminiAbort = true; __geminiAbortAt = Date.now();
          return;
        }
      }
      e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
    },
    _attachBlockers() {
      if (this._blocking) return; this._blocking = true;
      ['mousedown','mouseup','click','dblclick','contextmenu','wheel','touchstart','touchend','keydown','keyup']
        .forEach(evt => document.addEventListener(evt, this._blockEvent, { capture: true, passive: false }));
    },
    _detachBlockers() {
      if (!this._blocking) return; this._blocking = false;
      ['mousedown','mouseup','click','dblclick','contextmenu','wheel','touchstart','touchend','keydown','keyup']
        .forEach(evt => document.removeEventListener(evt, this._blockEvent, { capture: true }));
    },
    show() {
      this._injectStyles(); this._attachBlockers(); this._startTimeout();
      if (this._el) { this._el.style.display = 'block'; return; }
      const el = document.createElement('div'); el.id = 'seosonaflow-gemini-blocker';
      document.body.appendChild(el); this._el = el;
    },
    _startTimeout() {
      this._stopTimeout();
      this._timeoutId = setTimeout(() => { console.warn('[Gemini-ExecutionBlocker] Auto-timeout, force hiding'); this.hide(); }, this._MAX_BLOCK_TIME);
    },
    _stopTimeout() { if (this._timeoutId) { clearTimeout(this._timeoutId); this._timeoutId = null; } },
    hide() {
      this._detachBlockers(); this._stopTimeout(); this._escapeCount = 0; clearTimeout(this._escapeTimer);
      if (this._el) this._el.style.display = 'none';
    }
  };

  // ============ Dynamic Selector System (DOM Resilience) ============
  // Priority: Backend config only (Server-Only)
  const PROVIDER = 'gemini';
  let _selectorConfig = null;
  let _selectorConfigTime = 0;
  const _SELECTOR_CACHE_TTL = 30000; // 30s

  // Phase 6 Bug P (2026-06-03): Strict Server-Only — NO hardcoded _FALLBACK_SELECTORS.
  const _SELECTOR_WAIT_MAX_MS = 10000;
  const _SELECTOR_WAIT_INTERVAL_MS = 200;

  // Overlay i18n (4 locales — reuse sidebar wording `dialog.offline` family).
  const _OVERLAY_I18N = {
    vi: { title: 'Mất kết nối server', desc: 'Không thể kết nối tới máy chủ SEOSONA. Vui lòng kiểm tra lại sau.', retry: 'Thử lại' },
    en: { title: 'Server Connection Lost', desc: 'Unable to connect to SEOSONA server. Please try again later.', retry: 'Retry' },


  };
  let _overlayLocale = 'vi';
  chrome.storage.local.get(['af_locale', 'af_settings'], (r) => {
    _overlayLocale = r.af_locale || (r.af_settings && r.af_settings.language) || 'vi';
  });

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
    // [FIX 2026-07-09] `overlay` không còn được khởi tạo (debrand xoá block) → THROW ReferenceError.
    // No-op giống bản đã sửa ở grok/chatgpt. Local mode config bundled → overlay vô nghĩa.
    console.warn(`[Selector:${PROVIDER}:overlay] Config selector chưa sẵn sàng (local mode) — bỏ qua overlay.`);
  }

  // Anti-clone overlay — hiển thị khi background broadcast EXTENSION_NOT_AUTHORIZED.
  function _showCloneDetectedOverlay() {
    // Local mode: không có backend anti-clone → không bao giờ gọi. No-op sạch (giữ signature cho listener).
    console.warn(`[Auth:${PROVIDER}] clone-detected flag set — bỏ qua (local mode).`);
  }

  function _hideCloneDetectedOverlay() {
    const el = document.getElementById('seosonaflow-clone-detected-overlay');
    if (el) el.remove();
  }

  (function _initCloneDetectedListener() {
    try {
      // Delay 800ms — đợi background self-heal probe chạy trước (tránh flicker).
      setTimeout(() => {
        chrome.storage.local.get('seosonaflow_extension_not_authorized', (res) => {
          if (res && res.seosonaflow_extension_not_authorized) _showCloneDetectedOverlay();
        });
      }, 800);
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.seosonaflow_extension_not_authorized) {
          if (changes.seosonaflow_extension_not_authorized.newValue) _showCloneDetectedOverlay();
          else _hideCloneDetectedOverlay();
        }
      });
      if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg && msg.type === 'EXTENSION_NOT_AUTHORIZED') _showCloneDetectedOverlay();
          else if (msg && msg.type === 'EXTENSION_AUTHORIZED') _hideCloneDetectedOverlay();
        });
      }
      // Manual retry: click overlay → trigger background probe.
      document.addEventListener('click', (e) => {
        if (e.target?.closest?.('#seosonaflow-clone-detected-overlay')) {
          try { chrome.runtime.sendMessage({ type: 'EXTENSION_AUTH_RETRY' }); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-gemini#_initCloneDetectedListener', _); }
        }
      }, true);
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-gemini#_initCloneDetectedListener', _); }
  })();

  function _getDynamicSelector(key) {
    // Vá nóng: override (chrome.storage) THẮNG config gốc → sửa selector có hiệu lực ngay,
    // không cần sửa code / reload extension. Xoá override là quay lại config gốc.
    try {
      const _ov = (typeof self !== 'undefined' && self.SelectorOverride) || (typeof window !== 'undefined' && window.SelectorOverride);
      const _hit = _ov && _ov.getConfig && _ov.getConfig(PROVIDER, key);
      if (_hit) return _hit;
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-gemini#_getDynamicSelector', _); }

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

  function _queryWithFallback(key, defaultSelectors = null) {
    const config = _getDynamicSelector(key);
    const hardcoded = defaultSelectors || []; // Phase 6 Bug P: _FALLBACK_SELECTORS removed
    const isDynamic = config?.selectors?.length > 0;
    const selectors = isDynamic ? config.selectors : hardcoded;

    console.log(`[Selector:${PROVIDER}:${key}] ${isDynamic ? '🌐 DYNAMIC' : '📦 HARDCODED'} | Trying ${selectors.length} selectors`);

    for (let i = 0; i < selectors.length; i++) {
      try {
        const el = document.querySelector(selectors[i]);
        if (el) {
          console.log(`[Selector:${PROVIDER}:${key}] ✅ Match #${i + 1}: ${selectors[i]}`);
          return el;
        }
      } catch (e) { /* invalid selector */ }
    }
    console.log(`[Selector:${PROVIDER}:${key}] ❌ No match`);
    return null;
  }

  function _queryAllWithFallback(key, defaultSelectors = null) {
    const config = _getDynamicSelector(key);
    const hardcoded = defaultSelectors || []; // Phase 6 Bug P: _FALLBACK_SELECTORS removed
    const selectors = config?.selectors?.length > 0 ? config.selectors : hardcoded;

    for (let i = 0; i < selectors.length; i++) {
      try {
        const els = document.querySelectorAll(selectors[i]);
        if (els.length > 0) return els;
      } catch (e) { /* invalid selector */ }
    }
    return [];
  }

  // AI Agent prefix — Server-Only (2026-05-30 refactor).
  // Đọc từ PCM cache `chrome.storage.local.seosona_provider_api_configs.data.gemini.configs.ai_agent_prefix.{locale}`.
  // Admin edit qua /admin/providers/gemini/api-configs → SSE broadcast → next submit dùng prefix mới.
  // Fallback: locale missing → EN. Config missing → '' (skip prefix wrap, submit raw prompt).
  async function getEnhancePrefix() {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['seosona_provider_api_configs', 'af_locale'], r => resolve(r));
      });
      const locale = result?.af_locale || 'en';
      const prefixMap = result?.seosona_provider_api_configs?.data?.gemini?.configs?.ai_agent_prefix;
      if (!prefixMap || typeof prefixMap !== 'object') {
        console.warn('[AI Agent] ai_agent_prefix config missing for gemini — skip prefix wrap (raw prompt)');
        return '';
      }
      return prefixMap[locale] || prefixMap.en || '';
    } catch (e) {
      console.warn('[AI Agent] getEnhancePrefix error:', e.message, '— skip prefix wrap');
      return '';
    }
  }

  // ============ Cloudflare/Google challenge detection ============
  // Defensive — Gemini hiếm khi có turnstile nhưng thêm để an toàn khi tab inactive.
  function detectGeminiChallenge() {
    // Dùng dynamic selector cho cloudflare iframe
    if (_queryWithFallback('cloudflare_iframe')) return true;
    if (_queryWithFallback('cloudflare_iframe', null)) return true;
    const overlays = document.querySelectorAll('div[role="dialog"], body > div');
    for (const el of overlays) {
      const txt = (el.innerText || '').toLowerCase();
      if (txt.includes("making sure you're human") ||
          txt.includes('verify you are human') ||
          (txt.includes('verifying') && txt.includes('cloudflare'))) {
        const style = window.getComputedStyle(el);
        if (style.display !== 'none' && style.visibility !== 'hidden') return true;
      }
    }
    return false;
  }

  async function waitForGeminiChallengeResolved(timeoutMs = 120000) {
    if (!detectGeminiChallenge()) return true;
    console.warn('[Gemini] Challenge detected — request tab activate + chờ user verify');
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'gemini:ensureActive', focusWindow: true, reason: 'challenge' },
          () => resolve()
        );
      });
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-gemini#waitForGeminiChallengeResolved', _); }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!detectGeminiChallenge()) {
        await sleep(800);
        return true;
      }
      await sleep(800);
    }
    return false;
  }

  // Helper: simulateClick (full pointer event chain for Angular compatibility)
  function simulateClick(el) {
    const rect = el.getBoundingClientRect();
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

  // ============ HELPER: Chờ trang interactive trước mọi flow submit (i2p/PA) ============
  // Đối xứng với ChatGPT.waitProviderReady — fix thao tác chạy khi composer chưa hydrate (fresh
  // tab/reload). Gate: DOM complete + composer mount + KHÔNG aria-disabled/aria-busy + settle.
  // (_queryWithFallback của Gemini chỉ nhận 2 args — không có option silent.)
  async function waitProviderReady(timeoutMs = 12000) {
    const dl = Date.now() + timeoutMs;
    while (Date.now() < dl) {
      if (isGeminiAbort()) return false;
      if (document.readyState === 'complete') {
        const composer = _queryWithFallback('composer');
        if (composer && composer.getAttribute('aria-disabled') !== 'true' && !composer.closest('[aria-busy="true"]')) {
          await sleep(250); return true;
        }
      }
      await sleep(250);
    }
    return false;
  }

  // ============ Delete current conversation (2026-05-29) ============
  // Mở hội thoại mới kiểu SPA (KHÔNG reload) cho i2p/PA chạy biệt lập. Server-Only: cần key
  // `new_chat_button` trong provider_configs.dom_selector của gemini (chưa seed → trả false, caller
  // fallback submit vào chat hiện tại + KHÔNG xóa). Click button → chờ composer rỗng sẵn sàng.
  async function tryGeminiNewChat(timeoutMs = 6000) {
    const btn = _queryWithFallback('new_chat_button');
    if (!btn) { console.warn('[Gemini-newchat] new_chat_button chưa seed — submit vào chat hiện tại'); return false; }
    try { simulateClick(btn); } catch (_) { return false; }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(250);
      const composer = _queryWithFallback('composer');
      const empty = !_queryWithFallback('image_preview');
      if (composer && empty) return true;
    }
    return false;
  }

  // Flow: Click conversation actions menu → Click Delete → Confirm "Xoá" in mat-dialog
  // DOM ref: data/dom/gemini-delete-message-com.html
  // Strict Server-Only: TẤT CẢ selectors đọc từ provider_configs.dom_selector qua _queryWithFallback.
  // 4 keys (seeded migration 2026_07_06_100002):
  //   conversation_actions_menu, delete_menu_item, delete_confirm_dialog, delete_confirm_button
  async function deleteCurrentConversation() {
    try {
      // 1. Find conversation actions menu button
      const actionsBtn = _queryWithFallback('conversation_actions_menu');
      if (!actionsBtn) {
        console.warn('[Gemini-delete] conversation_actions_menu selector không match — sidebar collapsed hoặc DOM changed');
        return false;
      }

      // 2. Click để mở context menu
      console.log('[Gemini-delete] Clicking actions menu button...');
      simulateClick(actionsBtn);
      await sleep(500);

      // 3. Wait for menu panel + tìm Delete item
      let deleteItem = null;
      const menuTimeout = Date.now() + 3000;
      while (Date.now() < menuTimeout) {
        deleteItem = _queryWithFallback('delete_menu_item');
        if (deleteItem) break;
        await sleep(200);
      }

      if (!deleteItem) {
        console.warn('[Gemini-delete] delete_menu_item selector không match');
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return false;
      }

      console.log('[Gemini-delete] Clicking Delete menu item...');
      simulateClick(deleteItem);
      await sleep(500);

      // 4. Confirm dialog: tìm dialog container + button "Xoá"/"Delete" qua text match
      // (text match là pattern chuẩn cho confirm buttons — không phải CSS selector,
      // dialog selector từ server xác định container, button text match trong container).
      const confirmTimeout = Date.now() + 3000;
      let confirmBtn = null;
      while (Date.now() < confirmTimeout) {
        const dialog = _queryWithFallback('delete_confirm_dialog');
        if (dialog) {
          // Ưu tiên CSS selector từ delete_confirm_button trước
          const btnViaSelector = _queryWithFallback('delete_confirm_button', null);
          if (btnViaSelector && dialog.contains(btnViaSelector)) {
            const text = (btnViaSelector.textContent || '').trim().toLowerCase();
            if (text === 'xoá' || text === 'xóa' || text === 'delete' || text === 'remove') {
              confirmBtn = btnViaSelector;
              break;
            }
          }
          // Fallback: scan all buttons trong dialog, match text Xoá/Delete
          const buttons = dialog.querySelectorAll('button');
          for (const btn of buttons) {
            const text = (btn.textContent || '').trim().toLowerCase();
            if (text === 'xoá' || text === 'xóa' || text === 'delete' || text === 'remove') {
              confirmBtn = btn;
              break;
            }
          }
        }
        if (confirmBtn) break;
        await sleep(200);
      }

      if (!confirmBtn) {
        console.warn('[Gemini-delete] delete_confirm_dialog/button không match hoặc không có button text Xoá/Delete');
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return false;
      }

      console.log('[Gemini-delete] Clicking confirm button...');
      simulateClick(confirmBtn);
      await sleep(500);

      console.log('[Gemini-delete] ✅ Đã xóa conversation thành công');
      return true;
    } catch (err) {
      console.error('[Gemini-delete] Lỗi khi xóa conversation:', err);
      return false;
    }
  }

  // Upload images via file input (Gemini 2025 UI)
  // Đợi Gemini xử lý upload xong (chip <uploader-file-preview> chuyển .loading → .clickable).
  // Pattern y hệt Grok upload_loading_indicator — poll selector `upload_in_progress`, null = done.
  // Bug fix 2026-06-19: trước fix `image_preview` match cả 2 state → submit lúc còn loading →
  // Gemini strip ảnh, gửi text-only, ảnh kẹt trong preview area.
  async function waitGeminiUploadDone(timeoutMs = 20000) {
    const cfg = _getDynamicSelector('upload_in_progress');
    if (!cfg?.selectors?.length) {
      console.warn('[Gemini-upload] upload_in_progress config miss → fallback wait 2s');
      await sleep(2000);
      return true;
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (isGeminiAbort()) return false;
      const loading = _queryWithFallback('upload_in_progress', null, { silent: true });
      if (!loading) {
        // Double-check tránh race (chip vừa khởi tạo, .loading class chưa mount kịp)
        await sleep(200);
        const recheck = _queryWithFallback('upload_in_progress', null, { silent: true });
        if (!recheck) {
          console.log('[Gemini-upload] ✅ done sau', Date.now() - start, 'ms');
          return true;
        }
      }
      await sleep(300);
    }
    console.warn('[Gemini-upload] waitGeminiUploadDone timeout sau', timeoutMs, 'ms (chip vẫn .loading) → submit anyway');
    return false;
  }

  async function uploadImages(images) {
    if (!images || images.length === 0) return true;

    // Convert base64 to File objects
    const files = images.map(img => {
      const binary = atob(img.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new File([bytes], img.name || 'image.png', { type: img.type || 'image/png' });
    });

    console.log('[ChatAI] Gemini: Bắt đầu upload', files.length, 'ảnh');

    // Poll chờ preview ảnh attach (thay check 1 lần sau 2s) — ảnh lớn (context-menu photo 1536)
    // render preview >2s → trước đây miss → submit text-only. Region nhỏ thì kịp 2s.
    const waitPreview = async (ms) => {
      const n = Math.max(1, Math.ceil(ms / 300));
      for (let i = 0; i < n; i++) { await sleep(300); if (isGeminiAbort()) return false; if (_queryWithFallback('image_preview')) return true; }
      return false;
    };

    // Gemini KHÔNG có <input type="file"> trong DOM (verified 2026-05-17). Upload flow chính:
    //   - Click `add_button` (.upload-card-button) → menu hiện
    //   - Click menu item "Tải hình ảnh lên" → browser file dialog (cần user gesture, ext KHÔNG tự động được)
    // → Extension dùng paste (Method 1) hoặc drag & drop event (Method 2) làm path chính.
    //
    // Method 0: hidden <input type=file> — deterministic (như ChatGPT), đáng tin hơn paste/drag
    // (ClipboardEvent/DragEvent tự tạo thường bị Chrome chặn page đọc dataTransfer.files).
    const setFileInput = (inp) => {
      const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    };
    let fileInput = document.querySelector('input[type="file"]');
    const attachBtn = _queryWithFallback('add_button');
    if (!fileInput && attachBtn) {
      // Click add_button → có thể mount input[type=file] vào DOM → query lại rồi đóng menu.
      console.log('[ChatAI] Gemini: Click add_button tìm file input');
      simulateClick(attachBtn);
      await sleep(500);
      fileInput = document.querySelector('input[type="file"]');
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(200);
    }
    if (fileInput) {
      console.log('[ChatAI] Gemini: Upload qua file input');
      setFileInput(fileInput);
      if (await waitPreview(7000)) {
        console.log('[ChatAI] Gemini: Upload thành công via file input');
        await waitGeminiUploadDone(20000);
        return true;
      }
    }

    // Method 1: Fallback - paste qua clipboard (dùng dynamic selector cho composer)
    console.log('[ChatAI] Gemini: Thử paste qua clipboard');
    const editor = _queryWithFallback('composer') || document.activeElement;

    if (editor) {
      editor.focus();
      await sleep(200);

      // Tạo ClipboardEvent với files
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });

      editor.dispatchEvent(pasteEvent);
      // Poll preview tới ~9s — ảnh lớn (context-menu 1536) render preview chậm; 5s trước đây
      // premature fall-through sang drag (UI nháy rồi mất). Đồng bộ với ChatGPT injectRefImages ~9s.
      if (await waitPreview(9000)) {
        console.log('[ChatAI] Gemini: Upload thành công via paste');
        await waitGeminiUploadDone(20000);
        return true;
      }
    }

    // Method 2: Drag & drop (Strict Server-Only: composer → input_area_container → body) — primary path.
    console.log('[ChatAI] Gemini: Thử drag & drop');
    const dropTarget = _queryWithFallback('composer') ||
                       _queryWithFallback('input_area_container') ||
                       document.body;

    if (dropTarget) {
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));

      dropTarget.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
      await sleep(100);
      dropTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await sleep(100);
      dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      // Poll preview tới ~9s (ảnh lớn render chậm).
      if (await waitPreview(9000)) {
        console.log('[ChatAI] Gemini: Upload thành công via drag & drop');
        await waitGeminiUploadDone(20000);
        return true;
      }
    }

    console.error('[ChatAI] Không thể upload ảnh lên Gemini - vui lòng upload thủ công');
    // Trả về true để tiếp tục gửi text (user có thể tự paste ảnh)
    return true;
  }

  // Insert text into Gemini editor
  // IMPORTANT: Không được xóa content hiện có (ảnh upload) và không dispatch InputEvent với insertText
  // để tránh trigger Gemini auto-submit
  async function insertText(text) {
    console.log('[ChatAI] Gemini: Nhập text');

    // Tìm editor với dynamic selector (có fallback)
    let editor = _queryWithFallback('composer');

    // Nếu không tìm thấy ngay, chờ thêm
    if (!editor) {
      await sleep(500);
      editor = _queryWithFallback('composer');
    }

    if (!editor) {
      console.error('[ChatAI] Không tìm thấy ô nhập text trên Gemini');
      return false;
    }

    editor.focus();
    await sleep(200);

    // Clear existing content
    if (editor.tagName === 'TEXTAREA') {
      editor.value = text;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Contenteditable div
      // KHÔNG dùng innerHTML = ... vì sẽ xóa ảnh đã upload
      // Thay vào đó dùng execCommand để APPEND text

      // Đưa cursor về cuối editor (sau ảnh nếu có)
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false); // collapse to end
      selection.removeAllRanges();
      selection.addRange(range);

      // Insert text bằng execCommand (không trigger auto-submit)
      // CRITICAL: KHÔNG dispatch input event vì sẽ trigger Gemini auto-submit
      const inserted = document.execCommand('insertText', false, text);

      if (!inserted) {
        console.log('[ChatAI] Gemini: execCommand failed, fallback to append');
        // Fallback: append text node
        const textNode = document.createTextNode(text);
        editor.appendChild(textNode);
      }

      // BUG FIX 2026-06-05: verify length-based thay vì 20-char-prefix.
      // Trước: `editor.textContent.includes(text.substring(0, 20))` chỉ check 20 chars đầu →
      // execCommand truncate (insert 200/5000 chars) vẫn pass → Gemini nhận prompt CỤT.
      // Sau: 2 ngưỡng:
      //   - Critical (< 10%): COMPLETE fail (giống intent code cũ) → fallback append full text.
      //     Risk duplicate nếu có partial insert nhưng acceptable vì 10% còn lại có thể trống.
      //   - Partial truncate (10-90%): execCommand inserted phần lớn nhưng cut giữa chừng.
      //     KHÔNG fallback append (sẽ DUPLICATE text với image preservation constraint —
      //     line 549-550 comment "KHÔNG dùng innerHTML vì sẽ xóa ảnh"). Log warn để debug.
      await sleep(200);
      const insertedLen = (editor.textContent || '').length;
      const expectedLen = text.length;
      const matchRatio = expectedLen > 0 ? insertedLen / expectedLen : 1;
      if (matchRatio < 0.1) {
        console.warn(`[ChatAI] Gemini: insertText FAILED (${insertedLen}/${expectedLen}) → fallback append`);
        // Direct append với paragraph
        const p = document.createElement('p');
        p.textContent = text;
        editor.appendChild(p);
        // Chỉ dispatch input trong fallback path, không phải main path
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (matchRatio < 0.9) {
        // Partial truncate — không safe để append (duplicate risk với image preservation).
        // Log warn để user/dev debug. Submit prompt có thể không complete.
        console.warn(`[ChatAI] Gemini: insertText TRUNCATED (${insertedLen}/${expectedLen} = ${(matchRatio*100).toFixed(0)}%) — submit có thể missing content. Cần short prompt hoặc retry.`);
      }
    }

    await sleep(300);
    console.log('[ChatAI] Gemini: Text đã nhập:', editor.textContent.substring(0, 50));
    return true;
  }

  // Click submit button
  async function clickSubmit() {
    console.log('[ChatAI] Gemini: Tìm nút gửi');
    await sleep(500);

    let sendBtn = null;
    const start = Date.now();
    while (Date.now() - start < 8000) {
      // Dùng dynamic selector cho submit button
      sendBtn = _queryWithFallback('submit_button');

      // Fallback: tìm button với icon arrow/send
      if (!sendBtn) {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const svg = btn.querySelector('svg');
          if (svg) {
            // Check for send/arrow icon patterns
            const paths = svg.querySelectorAll('path');
            for (const path of paths) {
              const d = path.getAttribute('d') || '';
              // Common send icon patterns
              if (d.includes('M2.01 21L23 12') || // Send arrow
                  d.includes('M2 21l21-9') ||
                  d.includes('m4 4 16 8-16 8') ||
                  d.match(/M\d+.*L.*\d+.*12/)) {
                sendBtn = btn;
                break;
              }
            }
          }
          if (sendBtn) break;
        }
      }

      if (sendBtn && !sendBtn.disabled) {
        console.log('[ChatAI] Gemini: Tìm thấy nút gửi');
        break;
      }
      sendBtn = null;
      await sleep(300);
    }

    if (!sendBtn) {
      // Last resort: tìm button cuối cùng trong input area.
      // Strict Server-Only: input_area_container từ backend (migration 2026_06_04_100001).
      const inputArea = _queryWithFallback('input_area_container');
      if (inputArea) {
        const buttons = inputArea.querySelectorAll('button:not([disabled])');
        sendBtn = buttons[buttons.length - 1]; // Thường nút send ở cuối
      } else {
        console.debug('[Tier3] Gemini sendPrompt: input_area_container config miss');
      }
    }

    if (!sendBtn) {
      console.error('[ChatAI] Không tìm thấy nút gửi trên Gemini');
      return false;
    }

    console.log('[ChatAI] Gemini: Click nút gửi');
    simulateClick(sendBtn);

    // Fallback: nếu click không work, thử React onClick
    await sleep(500);
    const reactKey = Object.keys(sendBtn).find(k => k.startsWith('__reactProps$'));
    if (reactKey && sendBtn[reactKey]?.onClick) {
      sendBtn[reactKey].onClick({ preventDefault: () => {}, stopPropagation: () => {} });
    }

    return true;
  }

  // ============ CG-8: Snapshot Gemini conversation state ============
  // Gemini DOM dùng <user-query> + <model-response> elements để phân tách turns.
  function snapshotGeminiState() {
    // Dùng dynamic selector cho response container
    const responses = _queryAllWithFallback('response_container');
    return {
      turnCount: responses.length,
      lastIds: Array.from(responses)
        .slice(-5)
        .map((r, i) => r.dataset?.turnId || r.id || `idx-${i}`),
      timestamp: Date.now(),
    };
  }

  // ============ CG-8: Detect Gemini đang generate ============
  // Signals:
  //  - Nút stop hiển thị (aria-label="Stop response", "Dừng phản hồi", v.v.)
  //  - aria-busy="true" trên markdown container (streaming indicator)
  //  - Có phần tử với class chứa "loading" / "generating" / progress spinner
  // NOTE: KHÔNG dùng send button disabled vì nó disabled khi input rỗng (không phải khi generating)
  function isGeminiGenerating() {
    // Stop button với dynamic selector
    const stopBtn = _queryWithFallback('stop_button');
    if (stopBtn) return true;

    // Check aria-busy="true" trên markdown container - streaming indicator chính xác nhất
    const busyMarkdown = document.querySelector('.markdown[aria-busy="true"]');
    if (busyMarkdown) return true;

    // Check aria-busy="true" trên message-content container
    const busyMessageContent = document.querySelector('message-content[aria-busy="true"]');
    if (busyMessageContent) return true;

    // Spinner generic
    if (document.querySelector('mat-progress-bar:not([hidden])')) return true;

    return false;
  }

  // ============ Detection: Gemini tạo ảnh thay vì trả prompt text ============
  // Gemini hay hiểu sai yêu cầu enhance prompt → tự generate image thay vì return prompt text.
  // Detect patterns này để fallback về plain text thay vì dùng response sai.
  const IMAGE_GENERATION_PATTERNS = [
    // Vietnamese patterns
    /đang tạo (hình ảnh|ảnh|image)/i,
    /tôi sẽ tạo (hình ảnh|ảnh|một bức ảnh)/i,
    /để tôi tạo (hình ảnh|ảnh)/i,
    /tôi đang tạo/i,
    /hình ảnh (của bạn|cho bạn)/i,
    /tạo hình ảnh theo yêu cầu/i,
    /đây là (hình ảnh|ảnh)/i,
    // English patterns
    /creating (your |an |the )?image/i,
    /generating (your |an |the )?image/i,
    /i('m| am| will) (create|generate|make) (an |the |your )?image/i,
    /i('ll| will) (create|generate|make)/i,
    /i('ve| have) (created|generated|made)/i,
    /here('s| is) (the |your |an )?image/i,
    /let me (create|generate|make)/i,
    /working on (your |the |an )?image/i,
    /processing (your |the |an )?image/i,
    // Gemini announcement patterns — thường bắt đầu bằng OK/Sure rồi nói về tạo ảnh
    /^(ok|okay|sure|alright)[,.]?\s*(i('ll| will)|let me|here)/i,
  ];

  /**
   * Strip screen-reader announcement prefix mà Gemini render trong `.cdk-visually-hidden`.
   * VD: "Gemini đã nói\nĐể có được dấu tick xanh..." → "Để có được dấu tick xanh..."
   * Multi-locale + handle leading/trailing whitespace.
   */
  function stripScreenReaderPrefix(text) {
    if (!text) return '';
    const prefixes = [
      /^Gemini đã nói[\s\n]*/i,
      /^Gemini said[\s\n]*/i,
      /^G[ée]mini ha dicho[\s\n]*/i,
      /^Geminiが答えました[\s\n]*/i,
      /^Gemini พูดว่า[\s\n]*/i,
    ];
    let stripped = text;
    for (const re of prefixes) {
      stripped = stripped.replace(re, '');
    }
    return stripped.trim();
  }

  function isImageGenerationResponse(text) {
    if (!text || text.length < 5) return false;
    // Chỉ check 300 chars đầu — announcement thường ở đầu response
    const checkText = text.substring(0, 300).toLowerCase();
    for (const pattern of IMAGE_GENERATION_PATTERNS) {
      if (pattern.test(checkText)) {
        console.log('[Gemini-text] IMAGE_GENERATION detected:', pattern.toString(), '| text preview:', checkText.substring(0, 100));
        return true;
      }
    }
    return false;
  }

  // ============ CG-8: Poll đợi Gemini response xong ============
  // Auto-scroll xuống đáy để user thấy kết quả đang gen (gọi mỗi poll wait). Cache container (tìm 1 lần).
  // Server-Only: KHÔNG hardcode class — dò overflowY.
  let _gemScrollEl = null;
  let _gemScrollElFoundAt = 0;
  function _scrollGeminiToBottom() {
    try {
      // Re-find định kỳ 5s (mirror ChatGPT): cache có thể pin nhầm element hoặc scroller đổi sau nav.
      if (!_gemScrollEl || !_gemScrollEl.isConnected || Date.now() - _gemScrollElFoundAt > 5000) {
        const root = document.querySelector('main') || document.body;
        let best = null, bestH = 0;
        root.querySelectorAll('*').forEach((e) => {
          const oy = getComputedStyle(e).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 80 && e.scrollHeight > bestH) { best = e; bestH = e.scrollHeight; }
        });
        _gemScrollEl = best;
        _gemScrollElFoundAt = Date.now();
      }
      if (_gemScrollEl) _gemScrollEl.scrollTop = _gemScrollEl.scrollHeight;
      else window.scrollTo(0, document.documentElement.scrollHeight);
      // Tier 2: kéo response cuối vào viewport — trúng scroller thật + ép render content lazy mới nhất.
      const _resps = _queryAllWithFallback('response_container');
      const _last = _resps && _resps[_resps.length - 1];
      if (_last) _last.scrollIntoView({ block: 'end' });
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-gemini#_scrollGeminiToBottom', _); }
  }

  async function waitForGeminiTextResult(baseline, timeout = 60000) {
    const startTime = Date.now();
    const pollInterval = 500;
    // Mirror ChatGPT fix: gia hạn khi stream signal còn sống (model VẪN đang viết) —
    // deadline trượt cửa sổ 60s, hard cap timeout + STREAM_GRACE_MAX. Tránh PA meta-prompt dài bị hủy oan.
    const STREAM_GRACE_MAX = 300000;
    const hardCap = startTime + timeout + STREAM_GRACE_MAX;
    let deadline = startTime + timeout;
    let graceLogged = false;
    let lastDiag = 0;
    let lastTextLength = 0;
    let stableCount = 0;
    // BUG FIX 2026-06-05: Bump threshold 3 → 8 (~4s) học từ ChatGPT (chat-content-chatgpt.js:1944).
    // Bug: long AI response (5000+ chars) thường có pause 1-2s giữa các đoạn (model thinking /
    // network) → stop_button vô hình tạm thời → stability false positive ở 1.5s → capture
    // partial text. ChatGPT đã fix 2026-05-31, Gemini bị bỏ quên.
    const STABLE_THRESHOLD = 8; // Text phải stable qua 8 poll cycles (~4s) mới coi là xong

    while (Date.now() < deadline) {
      _scrollGeminiToBottom(); // theo dõi kết quả đang stream xuống đáy
      if (isGeminiAbort()) { console.log('[Gemini-text] Aborted by user'); return { success: false, error: 'ABORTED' }; }
      // Dùng dynamic selector cho response container
      const responses = _queryAllWithFallback('response_container');

      // Chưa có response mới so với baseline → poll tiếp
      if (responses.length <= baseline.turnCount) {
        if (Date.now() - lastDiag > 5000) {
          console.log('[Gemini-text] Chưa có response mới — current:', responses.length, 'baseline:', baseline.turnCount);
          lastDiag = Date.now();
        }
        await sleep(pollInterval);
        continue;
      }

      const lastResponse = responses[responses.length - 1];
      if (!lastResponse) {
        await sleep(pollInterval);
        continue;
      }

      // Check streaming còn chạy không (signal-based)
      const signalGenerating = isGeminiGenerating();

      // Extract current text — ƯU TIÊN markdown content, EXCLUDE screen-reader prefix
      // (Gemini render <h2 class="cdk-visually-hidden screen-reader-model-response-label">Gemini đã nói</h2>
      // bên ngoài markdown container → fallback innerText sẽ capture cả prefix gây bug).
      let currentText = '';
      const markdownEl = lastResponse.querySelector('.markdown-main-panel') || lastResponse.querySelector('.markdown');
      const messageContentEl = lastResponse.querySelector('message-content .markdown') || lastResponse.querySelector('message-content');
      const contentEl = markdownEl || messageContentEl;

      if (contentEl && typeof contentEl.innerText === 'string') {
        currentText = contentEl.innerText.trim();
      }

      // Strip screen-reader prefix nếu lỡ capture (defensive)
      currentText = stripScreenReaderPrefix(currentText);

      // Text stability check: text phải không đổi qua STABLE_THRESHOLD cycles
      // Min length 20 chars — text < 20 thường là screen-reader prefix hoặc early stream
      const MIN_TEXT_LENGTH = 20;
      const currentTextLength = currentText.length;
      if (currentTextLength === lastTextLength && currentTextLength >= MIN_TEXT_LENGTH) {
        stableCount++;
      } else {
        stableCount = 0;
        lastTextLength = currentTextLength;
      }

      const isTextStable = stableCount >= STABLE_THRESHOLD;
      // Generating nếu: signal still streaming, HOẶC text quá ngắn (chưa load xong), HOẶC chưa stable
      const stillGenerating = signalGenerating
        || currentTextLength < MIN_TEXT_LENGTH
        || (!isTextStable && currentTextLength > 0);

      if (stillGenerating) {
        // Chỉ gia hạn theo signal thật — text instability đơn thuần KHÔNG gia hạn (tránh treo vì re-render).
        if (signalGenerating && deadline - Date.now() < 60000) {
          const next = Math.min(Date.now() + 60000, hardCap);
          if (next > deadline) {
            deadline = next;
            if (!graceLogged) {
              console.warn('[Gemini-text] Quá timeout gốc nhưng stream còn sống → gia hạn (cap +', STREAM_GRACE_MAX / 1000, 's)');
              graceLogged = true;
            }
          }
        }
        if (Date.now() - lastDiag > 5000) {
          console.log('[Gemini-text] Đang generate — signal:', signalGenerating, 'textLen:', currentTextLength, 'stable:', stableCount);
          lastDiag = Date.now();
        }
        await sleep(pollInterval);
        continue;
      }

      // Streaming xong + text stable → extract final text
      console.log('[Gemini-text] Extract từ:', markdownEl ? '.markdown' : (messageContentEl ? 'message-content' : 'model-response'), '| text length:', currentText.length);

      if (!currentText || currentText.length < MIN_TEXT_LENGTH) {
        // Defensive fallback: lastResponse.innerText nhưng strip screen-reader prefix
        const fallbackRaw = lastResponse.innerText?.trim() || '';
        const fallbackText = stripScreenReaderPrefix(fallbackRaw);
        if (fallbackText && fallbackText.length >= MIN_TEXT_LENGTH) {
          console.log('[Gemini-text] Fallback extract from model-response (stripped prefix) | text length:', fallbackText.length);
          currentText = fallbackText;
        } else {
          // Chờ thêm nếu mới bắt đầu (chưa hết timeout)
          if (Date.now() - startTime < 8000) {
            await sleep(pollInterval);
            continue;
          }
          return { success: false, error: 'TEXT_EMPTY_OR_TOO_SHORT', text: fallbackRaw };
        }
      }

      const turnId = lastResponse.dataset?.turnId || lastResponse.id || null;
      console.log('[Gemini-text] DONE — text length:', currentText.length, 'stableCount:', stableCount);

      // Check: Gemini tạo ảnh thay vì trả prompt text → coi như fail để fallback
      if (isImageGenerationResponse(currentText)) {
        console.warn('[Gemini-text] Gemini đang tạo ảnh thay vì trả prompt — trigger fallback');
        return { success: false, error: 'IMAGE_GENERATION_DETECTED', text: currentText };
      }

      return { success: true, text: currentText, turnId };
    }

    console.warn('[Gemini-text] TIMEOUT sau', timeout, 'ms');
    return { success: false, error: 'TIMEOUT' };
  }

  // Main handler
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // SSE invalidate: admin update DOM selector → reload config ngay để tránh race condition
    if (message.action === 'providerConfigUpdated') {
      chrome.storage.local.get(['seosona_provider_configs'], (res) => {
        if (res.seosona_provider_configs?.data) {
          _selectorConfig = res.seosona_provider_configs.data;
          _selectorConfigTime = Date.now();
          const keyCount = Object.keys(_selectorConfig[PROVIDER]?.selectors || {}).length;
          console.log(`[Gemini] Provider config updated via SSE — reloaded ${keyCount} selectors`);
        } else {
          _selectorConfig = null;
          _selectorConfigTime = 0;
          console.warn('[Gemini] Provider config updated via SSE — storage empty, cache cleared');
        }
        sendResponse({ success: true });
      });
      return true; // async response
    }

    // Phase X: chatAI:execute — ChatAIModal flow (giữ nguyên)
    if (message.action === 'chatAI:execute') {
      // C1: reset abort scope cho call mới (uploadImages dùng chung isGeminiAbort).
      __geminiCallStartAt = Date.now();
      __geminiAbort = false; __geminiAbortAt = 0;
      (async () => {
        try {
          // 1. Upload images first (if any)
          if (message.images && message.images.length > 0) {
            const uploaded = await uploadImages(message.images);
            if (!uploaded) {
              sendResponse({ success: false, error: 'Không thể upload ảnh lên Gemini' });
              return;
            }
          }

          // 2. Insert text
          const textInserted = await insertText(message.text);
          if (!textInserted) {
            sendResponse({ success: false, error: 'Không thể nhập text vào Gemini' });
            return;
          }

          // 3. Chờ Gemini UI settle trước khi submit
          await sleep(800);

          // 4. Submit
          const submitted = await clickSubmit();
          if (!submitted) {
            sendResponse({ success: false, error: 'Không thể gửi tin nhắn trên Gemini' });
            return;
          }

          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message || 'Lỗi không xác định' });
        }
      })();

      return true; // async sendResponse
    }

    // Phase CG-8: gemini:submitAndWait — submit prompt + chờ text response
    // Payload: { action, text, images?, timeout }
    if (message.action === 'gemini:submitAndWait') {
      console.log(
        '[Gemini-listener] gemini:submitAndWait nhận, text len:', (message.text || '').length,
        'images:', (message.images || []).length
      );
      // C1: reset abort scope cho call mới — tránh abort cũ (từ i2p cancel) rò sang gen flow vì
      // uploadImages/waitForGeminiTextResult dùng chung isGeminiAbort().
      __geminiCallStartAt = Date.now();
      __geminiAbort = false; __geminiAbortAt = 0;
      (async () => {
        try {
          // PRE-CHECK: Cloudflare/Google challenge detection (defensive — Gemini hiếm khi có
          // nhưng thêm để an toàn khi tab inactive). Pattern giống ChatGPT/Grok.
          if (detectGeminiChallenge()) {
            const resolved = await waitForGeminiChallengeResolved(120000);
            if (!resolved) {
              sendResponse({
                success: false,
                error: 'CHALLENGE_TIMEOUT',
                message: 'Gemini yêu cầu xác minh. Vui lòng mở tab Gemini, hoàn thành verification, sau đó chạy lại.',
              });
              return;
            }
          }

          // 1. Snapshot baseline TRƯỚC khi submit
          const baseline = snapshotGeminiState();

          // 2. Phase CG-8 ext: Upload ref images (nếu có) TRƯỚC khi insert text
          //    Reuse `uploadImages` đã có (Phase X) — Gemini cho phép ảnh đầu vào.
          if (Array.isArray(message.images) && message.images.length > 0) {
            const uploaded = await uploadImages(message.images);
            if (!uploaded) {
              sendResponse({ success: false, error: 'REF_UPLOAD_FAILED', message: 'Không thể upload ảnh ref lên Gemini' });
              return;
            }
            await sleep(500); // chờ Gemini UI settle sau upload
          }

          // 3. Insert text vào Quill editor — prefix bắt LLM trả plain prompt (Prompt enhance flow).
          //    Gemini cũng có thể trả markdown/giải thích dài dòng nếu không có constraint.
          const enhancePrefix = await getEnhancePrefix();
          const promptText = enhancePrefix + (message.text || '');
          const textInserted = await insertText(promptText);
          if (!textInserted) {
            sendResponse({ success: false, error: 'INSERT_FAILED' });
            return;
          }

          // 4. Wait UI settle + click submit
          await sleep(500);
          const submitted = await clickSubmit();
          if (!submitted) {
            sendResponse({ success: false, error: 'SEND_BUTTON_NOT_FOUND' });
            return;
          }

          // 5. Chờ kết quả text
          const timeout = message.timeout || 60000;
          const result = await waitForGeminiTextResult(baseline, timeout);
          sendResponse(result);
        } catch (err) {
          sendResponse({
            success: false,
            error: 'EXCEPTION',
            message: err.message || 'Lỗi không xác định',
          });
        }
      })();

      return true; // async sendResponse
    }

  /**
   * Bật chế độ Tạo ảnh: Công cụ → Tạo ảnh.
   *
   * Đã bật sẵn thì thôi — bấm lần nữa là TẮT, và lỗi đó rất khó nhận ra vì Gemini vẫn trả lời
   * bình thường, chỉ là trả chữ thay vì ảnh.
   */
  async function _enableGeminiImageMode() {
    try {
      const already = _queryWithFallback('tools_image_gen_item');
      if (already && (already.getAttribute('aria-pressed') === 'true'
        || (already.className || '').indexOf('is-selected') >= 0)) return true;

      const toolsBtn = _queryWithFallback('tools_button');
      if (toolsBtn) { toolsBtn.click(); await sleep(400); }

      const item = _queryWithFallback('tools_image_gen_item');
      if (!item) {
        // Menu có thể đã mở sẵn từ trước → đóng lại rồi thử một lần nữa.
        if (toolsBtn) { toolsBtn.click(); await sleep(300); toolsBtn.click(); await sleep(400); }
        const retry = _queryWithFallback('tools_image_gen_item');
        if (!retry) return false;
        retry.click(); await sleep(500);
        return true;
      }
      item.click();
      await sleep(500);
      return true;
    } catch (_e) {
      globalThis.SEOSONA_swallow?.('gemini#_enableImageMode', _e);
      return false;
    }
  }

  /**
   * Chờ ảnh MỚI hiện ra, so với mốc chụp trước khi gửi.
   *
   * Hai cái bẫy đã tính tới:
   *   · Gemini hiện ảnh mờ (placeholder) trước rồi mới thay bằng ảnh thật — nên đòi ảnh phải
   *     có kích thước thật (naturalWidth) chứ không chỉ có src.
   *   · Ảnh xuất hiện dần từng cái. Thấy cái đầu tiên là dừng thì mất các cái sau, nên chờ
   *     thêm một nhịp yên tĩnh rồi mới chốt.
   */
  function _waitForGeminiImages(before, timeout) {
    return new Promise(function (resolve) {
      const t0 = Date.now();
      let lastCount = 0;
      let stableSince = 0;
      const timer = setInterval(function () {
        if (isGeminiAbort() || Date.now() - t0 > timeout) {
          clearInterval(timer);
          resolve(_collectNewGeminiImages(before));
          return;
        }
        const found = _collectNewGeminiImages(before);
        if (found.length && found.length === lastCount) {
          // Không thêm ảnh nào trong 2,5 giây → coi như xong.
          if (stableSince && Date.now() - stableSince > 2500) {
            clearInterval(timer);
            resolve(found);
            return;
          }
          if (!stableSince) stableSince = Date.now();
        } else {
          lastCount = found.length;
          stableSince = found.length ? Date.now() : 0;
        }
      }, 700);
    });
  }

  function _collectNewGeminiImages(before) {
    const out = [];
    try {
      _queryAllWithFallback('generated_image').forEach(function (im) {
        const u = im.currentSrc || im.src || im.getAttribute('data-src');
        if (!u || before.has(u)) return;
        // Ảnh mờ tạm thời chưa có kích thước thật — bỏ qua, chờ bản thật.
        if (im.naturalWidth && im.naturalWidth < 64) return;
        if (out.indexOf(u) < 0) out.push(u);
      });
    } catch (_e) { globalThis.SEOSONA_swallow?.('gemini#_collectNewImages', _e); }
    return out;
  }

    // ── gemini:generateImage — SINH ẢNH trên Gemini ────────────────────────────────────
    //
    // Bộ chọn DOM cho việc này ĐÃ CÓ SẴN trong config từ trước (generated_image,
    // tools_image_gen_item, tools_button, image_preview) — chỉ chưa có mã dùng tới. Nên đây là
    // nối dây, không phải dò DOM từ đầu.
    //
    // Khác gemini:submitAndWait ở hai điểm:
    //   · phải BẬT chế độ tạo ảnh trước (Công cụ → Tạo ảnh), nếu không Gemini trả chữ;
    //   · chờ ẢNH hiện chứ không chờ chữ.
    // Payload: { action, text, images?, timeout }
    if (message.action === 'gemini:generateImage') {
      __geminiCallStartAt = Date.now();
      __geminiAbort = false; __geminiAbortAt = 0;
      (async () => {
        try {
          if (detectGeminiChallenge()) {
            const resolved = await waitForGeminiChallengeResolved(120000);
            if (!resolved) {
              sendResponse({ success: false, error: 'CHALLENGE_TIMEOUT',
                message: 'Gemini yêu cầu xác minh. Mở tab Gemini, xác minh xong rồi chạy lại.' });
              return;
            }
          }

          // Ảnh ĐÃ CÓ trước khi gửi — để sau còn biết cái nào là mới.
          // Không chụp mốc này thì lần chạy thứ hai sẽ nhặt lại ảnh của lần một.
          const before = new Set();
          _queryAllWithFallback('generated_image').forEach(function (im) {
            const u = im.currentSrc || im.src || im.getAttribute('data-src');
            if (u) before.add(u);
          });

          // 1. Bật chế độ tạo ảnh. Bỏ bước này là Gemini trả CHỮ mô tả ảnh, không phải ảnh.
          const enabled = await _enableGeminiImageMode();
          if (!enabled) {
            sendResponse({ success: false, error: 'IMAGE_MODE_NOT_FOUND',
              message: 'Không tìm thấy nút Công cụ → Tạo ảnh. Giao diện Gemini có thể đã đổi — chạy Chẩn đoán selector.' });
            return;
          }

          // 2. Ảnh tham chiếu (nếu có) — dùng lại đường upload đã chạy được.
          if (Array.isArray(message.images) && message.images.length > 0) {
            const uploaded = await uploadImages(message.images);
            if (!uploaded) {
              sendResponse({ success: false, error: 'REF_UPLOAD_FAILED' });
              return;
            }
            await sleep(500);
          }

          // 3. Chèn prompt NGUYÊN VĂN — KHÔNG thêm enhancePrefix.
          //    Prefix đó bắt model trả prompt dạng chữ, đúng thứ ta không muốn ở đây.
          const inserted = await insertText(message.text || '');
          if (!inserted) { sendResponse({ success: false, error: 'INSERT_FAILED' }); return; }

          await sleep(500);
          const submitted = await clickSubmit();
          if (!submitted) { sendResponse({ success: false, error: 'SEND_BUTTON_NOT_FOUND' }); return; }

          // 4. Chờ ảnh MỚI xuất hiện.
          const urls = await _waitForGeminiImages(before, message.timeout || 180000);
          if (!urls.length) {
            sendResponse({ success: false, error: 'NO_IMAGE',
              message: 'Gemini không trả ảnh trong thời gian chờ. Có thể nó đã trả chữ — kiểm tra chế độ Tạo ảnh.' });
            return;
          }
          sendResponse({ success: true, images: urls, count: urls.length });
        } catch (err) {
          sendResponse({ success: false, error: 'EXCEPTION', message: err.message || 'Lỗi không xác định' });
        }
      })();
      return true;
    }

    // Image-to-Prompt (2026-06-15): upload ảnh + gửi template phân tích + đọc text response.
    // KHÁC gemini:submitAndWait: KHÔNG chèn getEnhancePrefix — gửi ĐÚNG message.text (template I2P).
    // Payload: { action, text, images:[{base64,name,type}], timeout, deleteAfter }
    // provider:textTask = action CHUNG cho i2p (Image→Prompt) + Prompt Assistant.
    // C1: gemini:abort — set flag để waitProviderReady/uploadImages/waitForGeminiTextResult exit sớm.
    if (message.action === 'gemini:abort') {
      __geminiAbort = true;
      __geminiAbortAt = Date.now();
      console.log('[Gemini-listener] gemini:abort received at', __geminiAbortAt);
      ExecutionBlocker.hide();
      sendResponse({ success: true });
      return false;
    }

    if (message.action === 'provider:textTask') {
      __geminiCallStartAt = Date.now();
      __geminiAbort = false; __geminiAbortAt = 0;
      ExecutionBlocker.show(); // chặn user can thiệp khi i2p/PA tự chat (ngay khi tab active)
      (async () => {
        try {
          if (typeof detectGeminiChallenge === 'function' && detectGeminiChallenge()) {
            const resolved = await waitForGeminiChallengeResolved(120000);
            if (!resolved) { sendResponse({ success: false, error: 'CHALLENGE_TIMEOUT' }); return; }
          }
          if (isGeminiAbort()) { sendResponse({ success: false, error: 'ABORTED' }); return; }
          // Chờ trang interactive trước mọi thao tác (fix thao tác khi composer chưa hydrate).
          await waitProviderReady();
          // Biệt lập: tab vừa tạo = hội thoại mới sẵn. Nếu reuse tab cũ, thử mở chat mới kiểu SPA
          // (KHÔNG reload — reload làm composer chưa hydrate → upload fail). Gemini chưa seed selector
          // new-chat nên thường không mở được → khi đó submit vào chat hiện tại (KHÔNG xóa, xem dưới).
          let isolated = !!message.tabFreshlyCreated;
          if (message.newChat && !isolated) { try { isolated = await tryGeminiNewChat(); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-gemini#waitForGeminiTextResult', _); } }
          const baseline = snapshotGeminiState();
          if (isGeminiAbort()) { sendResponse({ success: false, error: 'ABORTED' }); return; }
          if (Array.isArray(message.images) && message.images.length > 0) {
            await uploadImages(message.images);
            if (isGeminiAbort()) { sendResponse({ success: false, error: 'ABORTED' }); return; }
            // uploadImages trả true cả khi fail (fallback gửi text) — nhưng i2p/PA BẮT BUỘC có ảnh.
            // Verify preview thật sự attach trước khi submit, tránh "phân tích ảnh không tồn tại".
            if (!_queryWithFallback('image_preview')) { sendResponse({ success: false, error: 'IMAGE_UPLOAD_FAILED' }); return; }
            await sleep(350); // chờ Gemini settle sau upload (trim từ 600)
          }
          const inserted = await insertText(message.text || '');
          if (!inserted) { sendResponse({ success: false, error: 'INSERT_FAILED' }); return; }
          if (isGeminiAbort()) { sendResponse({ success: false, error: 'ABORTED' }); return; }
          await sleep(300); // trim từ 500
          const submitted = await clickSubmit();
          if (!submitted) { sendResponse({ success: false, error: 'SEND_BUTTON_NOT_FOUND' }); return; }
          const result = await waitForGeminiTextResult(baseline, message.timeout || 90000);
          // Auto-delete (opt-in i2p_delete_after) — CHỈ khi biệt lập (tab mới / new-chat ok). KHÔNG xóa
          // khi submit vào hội thoại user đang dùng → tránh deleteCurrentConversation xóa nhầm chat user.
          if (message.deleteAfter && result?.success && isolated) {
            try { await deleteCurrentConversation(); } catch (e) { console.warn('[Gemini-i2p] delete after failed:', e.message); }
          } else if (message.deleteAfter && result?.success && !isolated) {
            console.warn('[Gemini-i2p] skip deleteAfter — không biệt lập được hội thoại (tránh xóa nhầm chat user)');
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

    // 2026-05-29: gemini:deleteCurrentConversation — xóa conversation hiện tại sau enhance.
    // Triggered từ WorkflowExecutor khi node Prompt có setting `delete_after_enhance=true`.
    if (message.action === 'gemini:deleteCurrentConversation') {
      (async () => {
        try {
          const success = await deleteCurrentConversation();
          sendResponse({ success });
        } catch (err) {
          console.error('[Gemini-listener] deleteCurrentConversation error:', err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // async sendResponse
    }

    return false;
  });

  console.log('[ChatAI] Content script Gemini đã được inject (Phase X + CG-8)');
})();
