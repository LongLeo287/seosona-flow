/**
 * ChatGPTSession — Singleton quản lý tab ChatGPT, login state, image mode + ratio
 *
 * Phase CG-2 (Extension Session Manager) cho ChatGPT integration.
 *
 * Trách nhiệm chính:
 *  - Tìm hoặc tạo tab chatgpt.com (qua background.js).
 *  - Đảm bảo tab active trước khi DOM interaction (Chrome throttle inactive tabs).
 *  - Inject content script chat-content-chatgpt.js theo dạng on-demand
 *    (tương tự pattern Phase X — không add vào content_scripts static).
 *  - Kiểm tra login + cache trạng thái 60 giây.
 *  - Bật image mode (Create image) + chọn ratio (story/portrait/square/landscape/widescreen).
 *  - Phát các event qua window.eventBus để các caller phía sidePanel xử lý UX.
 *
 * Design notes:
 *  - Không phá vỡ Phase X (ChatAIModal). Tất cả tương tác mới đều đi qua action prefix
 *    `chatgpt:*` riêng — KHÔNG đụng `chatAI:send`.
 *  - Cache state suốt session để tránh inject + check nhiều lần. Invalidation qua:
 *      + chrome.tabs.onRemoved (background.js forward `chatgpt:tabClosed`).
 *      + Navigate sang conversation mới (content script gửi `chatgpt:navigated`,
 *        background relay thành `chatgpt:navigatedBroadcast` để tránh re-broadcast loop).
 *      + User đổi ratio sang giá trị khác.
 *  - Sau 2 lần fail liên tiếp activateImageMode → bật fallback prefix mode trong 5 phút
 *    (caller dùng prompt prefix "Generate an image of: ...").
 */

class ChatGPTSession {
  // Tab + readiness
  static _tabId = null;
  static _ready = false;
  static _lastCheck = 0;
  static _readyTtlMs = 60 * 1000; // Cache trạng thái sẵn sàng 60 giây

  // Image mode + ratio (cache suốt session, invalidate qua event)
  static _imageModeActive = false;
  static _currentRatio = null;

  // Fallback mode khi activateImageMode fail liên tiếp
  static _activateFailCount = 0;
  static _fallbackPrefixMode = false;
  static _fallbackUntil = 0;
  static _fallbackWindowMs = 5 * 60 * 1000; // 5 phút

  // Đăng ký listener tab-closed/navigated (chỉ 1 lần)
  static _listenersBound = false;

  // Danh sách ratio hợp lệ (khớp với ARIA_LABEL_MAP trong background.js)
  static VALID_RATIOS = ['story', 'portrait', 'square', 'landscape', 'widescreen'];

  /**
   * Đăng ký listener nhận tín hiệu tab đóng / navigate từ background.js.
   * Bảo đảm chỉ chạy 1 lần — gọi lazy ở các method public.
   */
  static _bindRuntimeListeners() {
    if (this._listenersBound) return;
    this._listenersBound = true;

    if (!chrome?.runtime?.onMessage) return;

    chrome.runtime.onMessage.addListener((message) => {
      if (!message || typeof message.action !== 'string') return;

      if (message.action === 'chatgpt:tabClosed') {
        // Tab ChatGPT đã bị đóng → reset toàn bộ cache
        if (!this._tabId || message.tabId === this._tabId) {
          this._resetCache();
          this._emit('chatgpt:error', { error: 'TAB_CLOSED' });
        }
      } else if (message.action === 'chatgpt:navigatedBroadcast') {
        // Background đã relay từ content script — conversation đổi, image mode có thể đã reset
        if (this._tabId && message.tabId === this._tabId) {
          this._imageModeActive = false;
          this._currentRatio = null;
          // Giữ _ready vì login state không đổi
        }
      }
    });
  }

  /** Reset toàn bộ cache (khi tab đóng / lỗi nghiêm trọng). */
  static _resetCache() {
    this._tabId = null;
    this._ready = false;
    this._lastCheck = 0;
    this._imageModeActive = false;
    this._currentRatio = null;
  }

  /** Phát event qua eventBus nếu có. */
  static _emit(eventName, data) {
    try {
      if (window.eventBus && typeof window.eventBus.emit === 'function') {
        window.eventBus.emit(eventName, data || {});
      }
    } catch (err) {
      // EventBus chưa load — bỏ qua, không vỡ flow
    }
  }

  /**
   * Gửi message tới background.js, trả về Promise.
   * Tự động xử lý chrome.runtime.lastError + response thiếu.
   */
  static _sendToBackground(action, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ action, ...payload }, (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'Lỗi runtime'));
            return;
          }
          if (!resp) {
            reject(new Error('Không nhận được phản hồi từ background'));
            return;
          }
          resolve(resp);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Đảm bảo tab ChatGPT đã sẵn sàng:
   *  1. Tìm hoặc tạo tab.
   *  2. Activate tab (Chrome cần tab active để React không throttle).
   *  3. Inject script (nếu chưa có flag __seosonaflowChatGPTLoaded__).
   *  4. Kiểm tra login (#prompt-textarea + login button).
   *
   * Trả về cache 60 giây nếu lần check trước thành công.
   *
   * @param {{ createIfMissing?: boolean, activate?: boolean, focusWindow?: boolean, silent?: boolean }} options
   *   - silent: true → KHÔNG emit chatgpt:login_required event khi NOT_LOGGED_IN.
   *     Dùng cho polling status check (reconfirm modal) — UI badge đã hiện trạng thái,
   *     không cần dialog "Mở tab" pop up spam mỗi 3s polling.
   * @returns {Promise<{ ready: boolean, error?: string, tabId?: number }>}
   */
  static async ensureReady(options = {}) {
    this._bindRuntimeListeners();

    // focusWindow: false mặc định để không gây gián đoạn workflow.
    // Chỉ cần focus khi user cần interact (vd: challenge verification).
    const { createIfMissing = true, activate = true, focusWindow = false, silent = false } = options;

    // Cache hit — đã sẵn sàng trong 60 giây gần đây
    if (this._ready && this._tabId && (Date.now() - this._lastCheck) < this._readyTtlMs) {
      // Vẫn cần activate tab nếu được yêu cầu (user có thể đã chuyển tab)
      if (activate) {
        // focusWindow (MCP): AWAIT để cửa sổ focus XONG trước khi caller submit. Repeat gen <60s rơi
        // cache-hit; nếu fire-and-forget thì submit có thể chạy khi cửa sổ còn nền → anomaly.
        // focusWindow=false (GenTab — user đã ở Chrome) giữ fire-and-forget cho nhanh, không đổi hành vi.
        if (focusWindow) {
          await this._sendToBackground('chatgpt:ensureActive', { tabId: this._tabId, focusWindow }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ChatGPTSession', _e); });
        } else {
          this._sendToBackground('chatgpt:ensureActive', { tabId: this._tabId, focusWindow }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ChatGPTSession', _e); });
        }
      }
      return { ready: true, tabId: this._tabId };
    }

    try {
      // 1. Tìm hoặc tạo tab
      const findResp = await this._sendToBackground('chatgpt:findOrCreateTab', {
        createIfMissing,
        activate,
      });
      if (!findResp.success || !findResp.tabId) {
        const error = findResp.error || 'NO_TAB';
        this._emit('chatgpt:error', { error });
        return { ready: false, error };
      }
      this._tabId = findResp.tabId;

      // 2. Activate tab (+ focus window nếu yêu cầu)
      // focusWindow chỉ cần khi user cần interact (challenge) — không cần cho check login
      if (activate) {
        const activeResp = await this._sendToBackground('chatgpt:ensureActive', {
          tabId: this._tabId,
          focusWindow,
        });
        if (!activeResp.success) {
          // Không quá nghiêm trọng — log và tiếp tục, có thể tab vừa được tạo và đang load
          console.warn('[ChatGPTSession] Không activate được tab:', activeResp.error);
        }
      }

      // 3. Inject script nếu chưa có
      const injectResp = await this._sendToBackground('chatgpt:injectScript', {
        tabId: this._tabId,
      });
      if (!injectResp.success) {
        const error = injectResp.error || 'INJECT_FAILED';
        this._emit('chatgpt:error', { error });
        return { ready: false, error, tabId: this._tabId };
      }

      // 4. Kiểm tra login
      const loginResp = await this._sendToBackground('chatgpt:checkLogin', {
        tabId: this._tabId,
      });
      if (!loginResp.success || !loginResp.ready) {
        const error = loginResp.error || 'NOT_LOGGED_IN';
        // [Bug 62 fix 2026-05-24] silent: true skip emit event — reconfirm modal polling
        // hiển thị badge trực tiếp, KHÔNG cần dialog "Mở tab" pop spam mỗi 3s.
        if (!silent) {
          if (error === 'NOT_LOGGED_IN') {
            this._emit('chatgpt:login_required', { tabId: this._tabId });
          } else {
            this._emit('chatgpt:error', { error });
          }
        }
        return { ready: false, error, tabId: this._tabId };
      }

      // Cập nhật cache
      this._ready = true;
      this._lastCheck = Date.now();
      this._emit('chatgpt:ready', { tabId: this._tabId });

      return { ready: true, tabId: this._tabId };
    } catch (err) {
      console.error('[ChatGPTSession] ensureReady lỗi:', err.message);
      this._emit('chatgpt:error', { error: err.message });
      return { ready: false, error: err.message };
    }
  }

  /**
   * Bật chế độ Create image trên ChatGPT (composer plus → menu → "Create image").
   * Cache `_imageModeActive` suốt session, invalidate qua tab-closed / navigate event.
   *
   * Sau 2 lần fail liên tiếp → bật fallback prefix mode trong 5 phút.
   *
   * @returns {Promise<{ activated: boolean, ratioControlAvailable?: boolean, error?: string }>}
   */
  static async activateImageMode() {
    this._bindRuntimeListeners();

    // Trong cửa sổ fallback → caller nên dùng prefix mode, không gọi tới đây
    if (this._fallbackPrefixMode && Date.now() < this._fallbackUntil) {
      return {
        activated: false,
        ratioControlAvailable: false,
        error: 'FALLBACK_PREFIX_ACTIVE',
      };
    }

    // Cache hit — đã active rồi, không cần activate lại
    if (this._imageModeActive && this._tabId) {
      return { activated: true, ratioControlAvailable: true };
    }

    if (!this._tabId) {
      return { activated: false, error: 'NO_TAB' };
    }

    try {
      const resp = await this._sendToBackground('chatgpt:activateImageMode', {
        tabId: this._tabId,
      });

      if (!resp.success) {
        this._activateFailCount++;
        if (this._activateFailCount >= 2) {
          // Bật fallback prefix mode trong 5 phút
          this._fallbackPrefixMode = true;
          this._fallbackUntil = Date.now() + this._fallbackWindowMs;
          this._showFallbackToast();
        }
        const error = resp.error || 'ACTIVATE_FAILED';
        this._emit('chatgpt:error', { error });
        return { activated: false, error };
      }

      // Reset fail counter khi thành công
      this._activateFailCount = 0;
      this._fallbackPrefixMode = false;
      this._fallbackUntil = 0;

      this._imageModeActive = !!resp.activated;
      const ratioAvailable = !!resp.ratioControlAvailable;

      if (this._imageModeActive) {
        this._emit('chatgpt:image_mode_activated', {
          ratioControlAvailable: ratioAvailable,
        });
      }

      return {
        activated: this._imageModeActive,
        ratioControlAvailable: ratioAvailable,
        error: resp.error || null,
      };
    } catch (err) {
      console.error('[ChatGPTSession] activateImageMode lỗi:', err.message);
      this._activateFailCount++;
      if (this._activateFailCount >= 2) {
        this._fallbackPrefixMode = true;
        this._fallbackUntil = Date.now() + this._fallbackWindowMs;
        this._showFallbackToast();
      }
      this._emit('chatgpt:error', { error: err.message });
      return { activated: false, error: err.message };
    }
  }

  /** Hiện toast cảnh báo đang dùng fallback prefix (chỉ khi NotificationManager có sẵn). */
  static _showFallbackToast() {
    try {
      const msg = 'ChatGPT image mode không khả dụng, đang dùng fallback prefix';
      if (window.NotificationManager && typeof window.NotificationManager.showToast === 'function') {
        window.NotificationManager.showToast(msg, 'warning');
      } else {
        console.warn('[ChatGPTSession]', msg);
      }
    } catch (err) {
      // Bỏ qua nếu NotificationManager chưa có
    }
  }

  /**
   * Chọn ratio cho ảnh tạo từ ChatGPT image mode.
   * Chỉ gọi SAU activateImageMode() thành công.
   *
   * @param {string} ratio — 'story' | 'portrait' | 'square' | 'landscape' | 'widescreen'
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  static async setRatio(ratio) {
    this._bindRuntimeListeners();

    if (!this.VALID_RATIOS.includes(ratio)) {
      return { success: false, error: 'INVALID_RATIO_KEY' };
    }

    // Cache hit — ratio đã đúng
    if (this._currentRatio === ratio && this._imageModeActive) {
      return { success: true };
    }

    if (!this._tabId) {
      return { success: false, error: 'NO_TAB' };
    }

    try {
      // Truyền aria-label map từ ChatGPTAdapter.capabilities (single source of truth).
      // Background không có access ProviderRegistry nên cần pass qua message.
      const adapter = window.ProviderRegistry?.get?.('chatgpt');
      const ariaLabelMap = adapter?.capabilities?.ratioAriaLabels || null;
      const resp = await this._sendToBackground('chatgpt:setRatio', {
        tabId: this._tabId,
        ratio,
        ariaLabelMap,
      });

      if (!resp.success) {
        const error = resp.error || 'SET_RATIO_FAILED';
        this._emit('chatgpt:error', { error });
        return { success: false, error };
      }

      // Cập nhật cache (override ratio mới)
      this._currentRatio = ratio;
      return { success: true };
    } catch (err) {
      console.error('[ChatGPTSession] setRatio lỗi:', err.message);
      this._emit('chatgpt:error', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Đảm bảo tab ChatGPT active + navigate về homepage.
   * Navigate về https://chatgpt.com/ để:
   *   1. Reset UI state (fix ChatGPT bugs như ratio button biến mất)
   *   2. Tạo new chat (thay thế clickNewChatAndWaitReady)
   */
  static async ensureTabActive({ forceRefresh = false } = {}) {
    this._bindRuntimeListeners();
    if (!this._tabId) return;
    try {
      await this._sendToBackground('chatgpt:ensureActive', {
        tabId: this._tabId,
        focusWindow: false,  // Test: chỉ navigate + active, không focus window
        navigateToHome: true,
        forceRefresh,  // Force navigate/refresh ngay cả khi đã ở homepage (fix stale React state)
      });
    } catch (err) {
      console.warn('[ChatGPTSession] ensureTabActive lỗi:', err.message);
    }
  }

  /**
   * Lấy thông tin tab hiện tại.
   * @returns {Promise<{ tabId: number|null, url: string|null, active: boolean, imageModeActive: boolean }>}
   */
  static async getTabInfo() {
    this._bindRuntimeListeners();

    if (!this._tabId) {
      return {
        tabId: null,
        url: null,
        active: false,
        imageModeActive: this._imageModeActive,
      };
    }

    try {
      const resp = await this._sendToBackground('chatgpt:getTabInfo', {
        tabId: this._tabId,
      });
      return {
        tabId: this._tabId,
        url: resp?.url || null,
        active: !!resp?.active,
        imageModeActive: this._imageModeActive,
      };
    } catch (err) {
      return {
        tabId: this._tabId,
        url: null,
        active: false,
        imageModeActive: this._imageModeActive,
      };
    }
  }

  /** Đóng tab ChatGPT + clear cache. */
  static async closeTab() {
    this._bindRuntimeListeners();

    if (!this._tabId) return;

    try {
      await this._sendToBackground('chatgpt:closeTab', { tabId: this._tabId });
    } catch (err) {
      console.warn('[ChatGPTSession] closeTab lỗi:', err.message);
    } finally {
      this._resetCache();
    }
  }

  /**
   * Xóa tin nhắn assistant gần nhất (2026-05-16).
   * Gửi message tới content script để thực hiện:
   *   Click "More actions" → Click "Delete" → Confirm modal.
   */
  static async deleteLastMessage() {
    this._bindRuntimeListeners();

    if (!this._tabId) {
      console.warn('[ChatGPTSession] deleteLastMessage: không có tabId');
      return { success: false, error: 'No tab' };
    }

    try {
      const resp = await new Promise((resolve) => {
        chrome.tabs.sendMessage(
          this._tabId,
          { action: 'chatgpt:deleteLastMessage' },
          (r) => resolve(r || { success: false, error: 'No response' })
        );
      });
      return resp;
    } catch (err) {
      console.warn('[ChatGPTSession] deleteLastMessage lỗi:', err.message);
      return { success: false, error: err.message };
    }
  }

  /** Trạng thái fallback prefix mode (caller dùng để quyết định prepend prefix vào prompt). */
  static isFallbackPrefixActive() {
    return this._fallbackPrefixMode && Date.now() < this._fallbackUntil;
  }
}

// Expose globally cho các caller (sidePanel, popup windows)
if (typeof window !== 'undefined') {
  window.ChatGPTSession = ChatGPTSession;
}
