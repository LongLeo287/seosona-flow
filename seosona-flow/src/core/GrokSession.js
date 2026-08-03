/**
 * GrokSession — Singleton quản lý tab Grok (grok.com), login state, mode + ratio.
 *
 * Phase G-2 (Extension Session Manager) cho Grok integration. Mirror pattern
 * ChatGPTSession.js (Phase CG-2) để đồng bộ infrastructure giữa các provider.
 *
 * Trách nhiệm chính:
 *  - Tìm hoặc tạo tab grok.com/imagine (qua background.js).
 *  - Đảm bảo tab active trước khi DOM interaction (Chrome throttle inactive tabs).
 *  - Inject content script chat-content-grok.js theo dạng on-demand (KHÔNG vào content_scripts static).
 *  - Kiểm tra login + cache trạng thái 60 giây.
 *  - Cache mode (image/video) + ratio + video duration/resolution suốt session.
 *  - Phát các event qua window.eventBus để các caller phía sidePanel xử lý UX.
 *
 * Design notes:
 *  - KHÔNG đụng `chatAI:send` (Phase X) hay `chatgpt:*` (Phase CG). Tất cả tương tác
 *    Grok đều đi qua action prefix `grok:*` riêng.
 *  - Cache state suốt session để tránh inject + check nhiều lần. Invalidation qua:
 *      + chrome.tabs.onRemoved (background.js forward `grok:tabClosed`).
 *      + Navigate sang URL khác (content script gửi `grok:navigated`,
 *        background relay thành `grok:navigatedBroadcast` để tránh re-broadcast loop).
 *      + User đổi mode/ratio/quantity sang giá trị khác.
 *  - Sau 2 lần fail liên tiếp setMode → bật fallback prefix mode trong 5 phút
 *    (caller dùng prompt prefix tương tự ChatGPT).
 */

class GrokSession {
  // Tab + readiness
  static _tabId = null;
  static _ready = false;
  static _lastCheck = 0;
  static _readyTtlMs = 60 * 1000; // Cache trạng thái sẵn sàng 60 giây

  // Mode + ratio + quantity (cache suốt session, invalidate qua event)
  static _currentMode = null;       // 'image' | 'video'
  static _currentRatio = null;      // 'portrait' | 'landscape' | 'square' | 'story' | 'widescreen'
  static _currentQuantity = null;   // 1 | 2 | 4
  static _currentDuration = null;   // '6s' | '10s' (video only)
  static _currentResolution = null; // '480p' | '720p' (video only)
  static _currentImageQuality = null; // 'speed' | 'quality' (image only) — Grok update 2026-04

  // Fallback prefix mode khi setMode fail liên tiếp
  static _setModeFailCount = 0;
  static _fallbackPrefixMode = false;
  static _fallbackUntil = 0;
  static _fallbackWindowMs = 5 * 60 * 1000; // 5 phút

  // Đăng ký listener tab-closed/navigated (chỉ 1 lần)
  static _listenersBound = false;

  // Danh sách giá trị hợp lệ (khớp với GrokAdapter capabilities)
  static VALID_MODES = ['image', 'video'];
  static VALID_RATIOS = ['portrait', 'landscape', 'square', 'story', 'widescreen'];
  static VALID_QUANTITIES = [1, 2, 4];
  static VALID_DURATIONS = ['6s', '10s'];
  static VALID_RESOLUTIONS = ['480p', '720p'];
  static VALID_IMAGE_QUALITIES = ['speed', 'quality'];

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

      if (message.action === 'grok:tabClosed') {
        // Tab grok.com đã bị đóng → reset toàn bộ cache
        if (!this._tabId || message.tabId === this._tabId) {
          this._resetCache();
          this._emit('grok:error', { error: 'TAB_CLOSED' });
        }
      } else if (message.action === 'grok:navigatedBroadcast') {
        // Background đã relay từ content script — URL đổi.
        // CRITICAL: chat-content-grok.js inject qua chrome.scripting.executeScript (NOT static
        // content_scripts manifest) → khi page reload / full navigation → content script bị
        // destroy. Cache `_ready=true` stale → tabs.sendMessage fail "Receiving end does not exist".
        // FIX: Invalidate _ready trên MỌI navigation → buộc ensureReady re-inject script.
        if (this._tabId && message.tabId === this._tabId) {
          const url = message.url || '';
          const inImagine = url.includes('/imagine');

          // Reset UI state nếu rời khỏi /imagine
          if (!inImagine) {
            this._currentMode = null;
            this._currentRatio = null;
            this._currentQuantity = null;
            this._currentDuration = null;
            this._currentResolution = null;
            this._currentImageQuality = null;
          }

          // Invalidate _ready cache → next ensureReady() sẽ re-inject script.
          // KHÔNG reset _tabId vì cùng tab, chỉ navigate.
          this._ready = false;
          this._lastCheck = 0;
        }
      }
    });
  }

  /** Reset toàn bộ cache (khi tab đóng / lỗi nghiêm trọng). */
  static _resetCache() {
    this._tabId = null;
    this._ready = false;
    this._lastCheck = 0;
    this._currentMode = null;
    this._currentRatio = null;
    this._currentQuantity = null;
    this._currentDuration = null;
    this._currentResolution = null;
    this._currentImageQuality = null;
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
   * Đảm bảo tab Grok đã sẵn sàng:
   *  1. Tìm hoặc tạo tab grok.com/imagine.
   *  2. Activate tab (Chrome cần tab active để React không throttle).
   *  3. Inject script (nếu chưa có flag __seosonaflowGrokLoaded__).
   *  4. Kiểm tra login (form editor + login link).
   *
   * Trả về cache 60 giây nếu lần check trước thành công.
   *
   * @param {{ createIfMissing?: boolean, activate?: boolean, focusWindow?: boolean, silent?: boolean }} options
   *   - silent: true → KHÔNG emit grok:login_required / grok:error event.
   *     Dùng cho polling status check (reconfirm modal, tooltip) — UI hiển thị trực tiếp,
   *     KHÔNG cần dialog "Mở tab" pop spam mỗi 3s polling.
   * @returns {Promise<{ ready: boolean, error?: string, tabId?: number }>}
   */
  static async ensureReady(options = {}) {
    this._bindRuntimeListeners();

    // focusWindow: false mặc định để không gây gián đoạn workflow.
    const { createIfMissing = true, activate = true, focusWindow = false, silent = false } = options;

    // Cache hit — đã sẵn sàng trong 60 giây gần đây
    if (this._ready && this._tabId && (Date.now() - this._lastCheck) < this._readyTtlMs) {
      // Vẫn cần activate tab nếu được yêu cầu (user có thể đã chuyển tab)
      if (activate) {
        // focusWindow (MCP): AWAIT để cửa sổ focus XONG trước khi caller submit. Repeat gen <60s rơi
        // cache-hit; nếu fire-and-forget thì submit có thể chạy khi cửa sổ còn nền → anomaly.
        // focusWindow=false (GenTab — user đã ở Chrome) giữ fire-and-forget cho nhanh, không đổi hành vi.
        if (focusWindow) {
          await this._sendToBackground('grok:ensureActive', { tabId: this._tabId, focusWindow }).catch(function (_e) { globalThis.SEOSONA_swallow?.('GrokSession', _e); });
        } else {
          this._sendToBackground('grok:ensureActive', { tabId: this._tabId, focusWindow }).catch(function (_e) { globalThis.SEOSONA_swallow?.('GrokSession', _e); });
        }
      }
      return { ready: true, tabId: this._tabId };
    }

    try {
      // 1. Tìm hoặc tạo tab
      const findResp = await this._sendToBackground('grok:findOrCreateTab', {
        createIfMissing,
        activate,
      });
      if (!findResp.success || !findResp.tabId) {
        const error = findResp.error || 'NO_TAB';
        this._emit('grok:error', { error });
        return { ready: false, error };
      }
      this._tabId = findResp.tabId;

      // 2. Activate tab (+ focus window nếu yêu cầu)
      if (activate) {
        const activeResp = await this._sendToBackground('grok:ensureActive', {
          tabId: this._tabId,
          focusWindow,
        });
        if (!activeResp.success) {
          // Không quá nghiêm trọng — log và tiếp tục
          console.warn('[GrokSession] Không activate được tab:', activeResp.error);
        }
      }

      // 3. Inject script nếu chưa có
      const injectResp = await this._sendToBackground('grok:injectScript', {
        tabId: this._tabId,
      });
      if (!injectResp.success) {
        const error = injectResp.error || 'INJECT_FAILED';
        this._emit('grok:error', { error });
        return { ready: false, error, tabId: this._tabId };
      }

      // 4. Kiểm tra login
      const loginResp = await this._sendToBackground('grok:checkLogin', {
        tabId: this._tabId,
      });
      if (!loginResp.success || !loginResp.ready) {
        const error = loginResp.error || 'NOT_LOGGED_IN';
        // [Bug 62 fix 2026-05-24] silent: true skip emit event — reconfirm modal polling
        // hiển thị badge trực tiếp, KHÔNG cần dialog "Mở tab" pop spam.
        if (!silent) {
          if (error === 'NOT_LOGGED_IN') {
            this._emit('grok:login_required', { tabId: this._tabId });
          } else {
            this._emit('grok:error', { error });
          }
        }
        return { ready: false, error, tabId: this._tabId };
      }

      // Cập nhật cache
      this._ready = true;
      this._lastCheck = Date.now();
      this._emit('grok:ready', { tabId: this._tabId });

      return { ready: true, tabId: this._tabId };
    } catch (err) {
      console.error('[GrokSession] ensureReady lỗi:', err.message);
      this._emit('grok:error', { error: err.message });
      return { ready: false, error: err.message };
    }
  }

  /**
   * Đặt generation mode trên Grok UI ('image' | 'video').
   * Cache `_currentMode` suốt session.
   *
   * Sau 2 lần fail liên tiếp → bật fallback prefix mode trong 5 phút.
   *
   * @param {string} mode — 'image' | 'video'
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  static async setMode(mode) {
    this._bindRuntimeListeners();

    if (!this.VALID_MODES.includes(mode)) {
      return { success: false, error: 'INVALID_MODE_KEY' };
    }

    // Cache hit — mode đã đúng
    if (this._currentMode === mode) {
      return { success: true };
    }

    if (!this._tabId) {
      return { success: false, error: 'NO_TAB' };
    }

    try {
      const resp = await this._sendToBackground('grok:applySettings', {
        tabId: this._tabId,
        settings: { mode },
      });

      if (!resp.success) {
        this._setModeFailCount++;
        if (this._setModeFailCount >= 2) {
          this._fallbackPrefixMode = true;
          this._fallbackUntil = Date.now() + this._fallbackWindowMs;
          this._showFallbackToast();
        }
        const error = resp.error || 'SET_MODE_FAILED';
        this._emit('grok:error', { error });
        return { success: false, error };
      }

      // Reset fail counter khi thành công
      this._setModeFailCount = 0;
      this._fallbackPrefixMode = false;
      this._fallbackUntil = 0;

      this._currentMode = mode;
      this._emit('grok:mode_set', { mode });
      return { success: true };
    } catch (err) {
      console.error('[GrokSession] setMode lỗi:', err.message);
      this._setModeFailCount++;
      if (this._setModeFailCount >= 2) {
        this._fallbackPrefixMode = true;
        this._fallbackUntil = Date.now() + this._fallbackWindowMs;
        this._showFallbackToast();
      }
      this._emit('grok:error', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /** Hiện toast cảnh báo đang dùng fallback prefix (chỉ khi NotificationManager có sẵn). */
  static _showFallbackToast() {
    try {
      const msg = 'Grok mode không khả dụng, đang dùng fallback prefix';
      if (window.NotificationManager && typeof window.NotificationManager.showToast === 'function') {
        window.NotificationManager.showToast(msg, 'warning');
      } else {
        console.warn('[GrokSession]', msg);
      }
    } catch (err) {
      // Bỏ qua nếu NotificationManager chưa có
    }
  }

  /**
   * Chọn ratio cho generation trên Grok.
   * Áp dụng cho cả image lẫn video (Grok cùng dropdown ratio cho 2 mode).
   *
   * @param {string} ratio — 'portrait' | 'landscape' | 'square' | 'story' | 'widescreen'
   *                         hoặc giá trị Grok display ('2:3' | '3:2' | '1:1' | '9:16' | '16:9').
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  static async setRatio(ratio) {
    this._bindRuntimeListeners();

    // Chấp nhận key chuẩn hoặc Grok display string
    const ratioKey = this._normalizeRatioKey(ratio);
    if (!ratioKey) {
      return { success: false, error: 'INVALID_RATIO_KEY' };
    }

    // Cache hit — ratio đã đúng
    if (this._currentRatio === ratioKey) {
      return { success: true };
    }

    if (!this._tabId) {
      return { success: false, error: 'NO_TAB' };
    }

    try {
      const resp = await this._sendToBackground('grok:setRatio', {
        tabId: this._tabId,
        ratio: ratioKey,
      });

      if (!resp.success) {
        const error = resp.error || 'SET_RATIO_FAILED';
        this._emit('grok:error', { error });
        return { success: false, error };
      }

      this._currentRatio = ratioKey;
      this._emit('grok:ratio_set', { ratio: ratioKey });
      return { success: true };
    } catch (err) {
      console.error('[GrokSession] setRatio lỗi:', err.message);
      this._emit('grok:error', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Chuẩn hoá ratio input về key chuẩn ('portrait'/'landscape'/'square'/'story'/'widescreen').
   * Trả null nếu không match.
   */
  static _normalizeRatioKey(input) {
    if (!input) return null;
    const lower = String(input).trim().toLowerCase();
    if (this.VALID_RATIOS.includes(lower)) return lower;
    // Map display string → key
    const displayMap = {
      '2:3': 'portrait',
      '3:2': 'landscape',
      '1:1': 'square',
      '9:16': 'story',
      '16:9': 'widescreen',
    };
    return displayMap[lower] || null;
  }

  /**
   * Đặt video duration ('6s' | '10s'). Chỉ có ý nghĩa khi mode=video.
   * @param {string} duration
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  static async setVideoDuration(duration) {
    this._bindRuntimeListeners();

    if (!this.VALID_DURATIONS.includes(duration)) {
      return { success: false, error: 'INVALID_DURATION' };
    }

    if (this._currentDuration === duration) {
      return { success: true };
    }

    if (!this._tabId) {
      return { success: false, error: 'NO_TAB' };
    }

    try {
      const resp = await this._sendToBackground('grok:applySettings', {
        tabId: this._tabId,
        settings: { duration },
      });

      if (!resp.success) {
        const error = resp.error || 'SET_DURATION_FAILED';
        this._emit('grok:error', { error });
        return { success: false, error };
      }

      this._currentDuration = duration;
      return { success: true };
    } catch (err) {
      console.error('[GrokSession] setVideoDuration lỗi:', err.message);
      this._emit('grok:error', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Đặt video resolution ('480p' | '720p'). Chỉ có ý nghĩa khi mode=video.
   * @param {string} resolution
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  static async setVideoResolution(resolution) {
    this._bindRuntimeListeners();

    if (!this.VALID_RESOLUTIONS.includes(resolution)) {
      return { success: false, error: 'INVALID_RESOLUTION' };
    }

    if (this._currentResolution === resolution) {
      return { success: true };
    }

    if (!this._tabId) {
      return { success: false, error: 'NO_TAB' };
    }

    try {
      const resp = await this._sendToBackground('grok:applySettings', {
        tabId: this._tabId,
        settings: { resolution },
      });

      if (!resp.success) {
        const error = resp.error || 'SET_RESOLUTION_FAILED';
        this._emit('grok:error', { error });
        return { success: false, error };
      }

      this._currentResolution = resolution;
      return { success: true };
    } catch (err) {
      console.error('[GrokSession] setVideoResolution lỗi:', err.message);
      this._emit('grok:error', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Đặt image quality ('speed' | 'quality'). Chỉ có ý nghĩa khi mode=image.
   * Grok update 2026-04: thêm radiogroup [aria-label="Image generation speed"] với 2 option
   * Speed (nhanh, low quality) và Quality (chậm, high quality).
   * @param {string} quality - 'speed' | 'quality'
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  static async setImageQuality(quality) {
    this._bindRuntimeListeners();

    const lower = String(quality || '').toLowerCase();
    if (!this.VALID_IMAGE_QUALITIES.includes(lower)) {
      return { success: false, error: 'INVALID_IMAGE_QUALITY' };
    }

    if (this._currentImageQuality === lower) {
      return { success: true };
    }

    if (!this._tabId) {
      return { success: false, error: 'NO_TAB' };
    }

    try {
      const resp = await this._sendToBackground('grok:applySettings', {
        tabId: this._tabId,
        settings: { imageQuality: lower, mode: 'image' },
      });

      if (!resp.success) {
        const error = resp.error || 'SET_IMAGE_QUALITY_FAILED';
        this._emit('grok:error', { error });
        return { success: false, error };
      }

      this._currentImageQuality = lower;
      return { success: true };
    } catch (err) {
      console.error('[GrokSession] setImageQuality lỗi:', err.message);
      this._emit('grok:error', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Đảm bảo tab Grok active. Options:
   *  - focusWindow=true (default — GenTab/Tasks): bring window grok lên trước (user xem gen trực tiếp).
   *  - focusWindow=false (WORKFLOW-EDITOR run, 2026-05-28): CHỈ activate tab (đủ un-throttle vì tab
   *    active = visible), KHÔNG cướp focus khỏi popup workflow-editor. Cloudflare challenge vẫn tự
   *    focus (waitForCloudflareResolved → focusWindow:true) rồi trả focus về popup sau resolved
   *    (grok:restoreFocus).
   *  - forceRefresh: vestigial (preflight tự invalidate _ready) — accept để không vỡ caller cũ.
   * @param {{ focusWindow?: boolean, forceRefresh?: boolean }} [options]
   */
  static async ensureTabActive(options = {}) {
    this._bindRuntimeListeners();
    if (!this._tabId) return;
    const focusWindow = options.focusWindow !== false; // default true; chỉ false khi truyền tường minh
    try {
      await this._sendToBackground('grok:ensureActive', { tabId: this._tabId, focusWindow });
    } catch (err) {
      console.warn('[GrokSession] ensureTabActive lỗi:', err.message);
    }
  }

  /**
   * Kiểm tra trạng thái Grok: login + Cloudflare challenge.
   * Dùng cho confirm modal để hiện status chi tiết.
   * @returns {Promise<{ loggedIn: boolean, cloudflareChallenge: boolean, error?: string }>}
   */
  static async checkStatus() {
    this._bindRuntimeListeners();

    if (!this._tabId) {
      return { loggedIn: false, cloudflareChallenge: false, error: 'NO_TAB' };
    }

    try {
      const resp = await new Promise((resolve) => {
        chrome.tabs.sendMessage(this._tabId, { action: 'grok:checkStatus' }, (r) => {
          if (chrome.runtime.lastError) {
            resolve({ loggedIn: false, cloudflareChallenge: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(r || { loggedIn: false, cloudflareChallenge: false });
          }
        });
      });
      return resp;
    } catch (err) {
      console.warn('[GrokSession] checkStatus error:', err.message);
      return { loggedIn: false, cloudflareChallenge: false, error: err.message };
    }
  }

  /**
   * Lấy thông tin tab hiện tại.
   * @returns {Promise<{ tabId: number|null, url: string|null, active: boolean, mode: string|null }>}
   */
  static async getTabInfo() {
    this._bindRuntimeListeners();

    if (!this._tabId) {
      return {
        tabId: null,
        url: null,
        active: false,
        mode: this._currentMode,
      };
    }

    try {
      const resp = await this._sendToBackground('grok:getTabInfo', {
        tabId: this._tabId,
      });
      return {
        tabId: this._tabId,
        url: resp?.url || null,
        active: !!resp?.active,
        mode: this._currentMode,
      };
    } catch (err) {
      return {
        tabId: this._tabId,
        url: null,
        active: false,
        mode: this._currentMode,
      };
    }
  }

  /** Đóng tab Grok + clear cache. */
  static async closeTab() {
    this._bindRuntimeListeners();

    if (!this._tabId) return;

    try {
      await this._sendToBackground('grok:closeTab', { tabId: this._tabId });
    } catch (err) {
      console.warn('[GrokSession] closeTab lỗi:', err.message);
    } finally {
      this._resetCache();
    }
  }

  /** Trạng thái fallback prefix mode (caller dùng để quyết định prepend prefix vào prompt). */
  static isFallbackPrefixActive() {
    return this._fallbackPrefixMode && Date.now() < this._fallbackUntil;
  }
}

// Expose globally cho các caller (sidePanel, popup windows)
if (typeof window !== 'undefined') {
  window.GrokSession = GrokSession;
}
