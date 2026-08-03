/**
 * GeminiSession — Singleton quản lý tab Gemini, login state.
 *
 * Phase CG-8 (Prompt Node + Gemini Adapter) — minimal session manager.
 *
 * Trách nhiệm chính:
 *  - Tìm hoặc tạo tab gemini.google.com (qua background.js).
 *  - Đảm bảo tab active trước khi DOM interaction.
 *  - Inject content script chat-content-gemini.js (nếu chưa load).
 *  - Kiểm tra login + cache trạng thái 60 giây.
 *  - Phát các event qua window.eventBus tương tự ChatGPTSession.
 *
 * Khác ChatGPTSession:
 *  - KHÔNG có image mode / ratio — Gemini chỉ dùng cho text enhance ở Prompt node.
 *  - Background actions có thể chưa wire đầy đủ (CG-8b sẽ bổ sung) — ở đây
 *    gọi `gemini:findOrCreateTab` / `gemini:checkLogin` / `gemini:injectScript` /
 *    `gemini:ensureActive` theo cùng convention với ChatGPT.
 */

class GeminiSession {
  // Tab + readiness
  static _tabId = null;
  static _ready = false;
  static _lastCheck = 0;
  static _readyTtlMs = 60 * 1000;

  // Đăng ký listener tab-closed/navigated 1 lần
  static _listenersBound = false;

  static _bindRuntimeListeners() {
    if (this._listenersBound) return;
    this._listenersBound = true;

    if (!chrome?.runtime?.onMessage) return;

    chrome.runtime.onMessage.addListener((message) => {
      if (!message || typeof message.action !== 'string') return;

      if (message.action === 'gemini:tabClosed') {
        if (!this._tabId || message.tabId === this._tabId) {
          this._resetCache();
          this._emit('gemini:error', { error: 'TAB_CLOSED' });
        }
      } else if (message.action === 'gemini:navigatedBroadcast') {
        if (this._tabId && message.tabId === this._tabId) {
          // Gemini không có image mode để invalidate; vẫn giữ ready.
        }
      }
    });
  }

  static _resetCache() {
    this._tabId = null;
    this._ready = false;
    this._lastCheck = 0;
  }

  static _emit(eventName, data) {
    try {
      if (window.eventBus && typeof window.eventBus.emit === 'function') {
        window.eventBus.emit(eventName, data || {});
      }
    } catch (err) {
      // EventBus chưa load — bỏ qua
    }
  }

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
   * Đảm bảo tab Gemini đã sẵn sàng:
   *  1. Tìm hoặc tạo tab gemini.google.com.
   *  2. Activate tab.
   *  3. Inject script chat-content-gemini.js (nếu chưa).
   *  4. Kiểm tra login.
   */
  static async ensureReady(options = {}) {
    this._bindRuntimeListeners();

    const { createIfMissing = true, activate = true } = options;

    // Cache hit
    if (this._ready && this._tabId && (Date.now() - this._lastCheck) < this._readyTtlMs) {
      return { ready: true, tabId: this._tabId };
    }

    try {
      // 1. Find or create tab
      const findResp = await this._sendToBackground('gemini:findOrCreateTab', {
        createIfMissing,
        activate,
      });
      if (!findResp.success || !findResp.tabId) {
        const error = findResp.error || 'NO_TAB';
        this._emit('gemini:error', { error });
        return { ready: false, error };
      }
      this._tabId = findResp.tabId;

      // 2. Activate tab
      if (activate) {
        const activeResp = await this._sendToBackground('gemini:ensureActive', {
          tabId: this._tabId,
        });
        if (!activeResp.success) {
          console.warn('[GeminiSession] Không activate được tab:', activeResp.error);
        }
      }

      // 3. Inject script (nếu chưa)
      const injectResp = await this._sendToBackground('gemini:injectScript', {
        tabId: this._tabId,
      });
      if (!injectResp.success) {
        const error = injectResp.error || 'INJECT_FAILED';
        this._emit('gemini:error', { error });
        return { ready: false, error, tabId: this._tabId };
      }

      // 4. Check login
      const loginResp = await this._sendToBackground('gemini:checkLogin', {
        tabId: this._tabId,
      });
      if (!loginResp.success || !loginResp.ready) {
        const error = loginResp.error || 'NOT_LOGGED_IN';
        if (error === 'NOT_LOGGED_IN') {
          this._emit('gemini:login_required', { tabId: this._tabId });
        } else {
          this._emit('gemini:error', { error });
        }
        return { ready: false, error, tabId: this._tabId };
      }

      this._ready = true;
      this._lastCheck = Date.now();
      this._emit('gemini:ready', { tabId: this._tabId });

      return { ready: true, tabId: this._tabId };
    } catch (err) {
      console.error('[GeminiSession] ensureReady lỗi:', err.message);
      this._emit('gemini:error', { error: err.message });
      return { ready: false, error: err.message };
    }
  }

  static async ensureTabActive() {
    this._bindRuntimeListeners();
    if (!this._tabId) return;
    try {
      // Bug 2026-05-30: focusWindow=true gây Chrome auto steal focus mỗi enhance call —
      // user khó chịu (đang dùng app khác). Đổi sang false (giống ChatGPT pattern line 380).
      // Chỉ activate tab trong cùng window — không steal focus toàn OS.
      await this._sendToBackground('gemini:ensureActive', { tabId: this._tabId, focusWindow: false });
    } catch (err) {
      console.warn('[GeminiSession] ensureTabActive lỗi:', err.message);
    }
  }

  static async getTabInfo() {
    this._bindRuntimeListeners();

    if (!this._tabId) {
      return { tabId: null, url: null, active: false };
    }

    try {
      const resp = await this._sendToBackground('gemini:getTabInfo', {
        tabId: this._tabId,
      });
      return {
        tabId: this._tabId,
        url: resp?.url || null,
        active: !!resp?.active,
      };
    } catch (err) {
      return { tabId: this._tabId, url: null, active: false };
    }
  }

  static async closeTab() {
    this._bindRuntimeListeners();

    if (!this._tabId) return;

    try {
      await this._sendToBackground('gemini:closeTab', { tabId: this._tabId });
    } catch (err) {
      console.warn('[GeminiSession] closeTab lỗi:', err.message);
    } finally {
      this._resetCache();
    }
  }

  /**
   * Xóa conversation hiện tại (2026-05-29). Trigger từ WorkflowExecutor khi
   * node Prompt có setting `delete_after_enhance=true` + provider=gemini.
   * Content script (chat-content-gemini.js): click conversation actions menu
   * → Delete → confirm "Xoá" trong mat-dialog.
   */
  static async deleteCurrentConversation() {
    this._bindRuntimeListeners();

    if (!this._tabId) {
      console.warn('[GeminiSession] deleteCurrentConversation: không có tabId');
      return { success: false, error: 'No tab' };
    }

    try {
      const resp = await new Promise((resolve) => {
        chrome.tabs.sendMessage(
          this._tabId,
          { action: 'gemini:deleteCurrentConversation' },
          (r) => resolve(r || { success: false, error: 'No response' })
        );
      });
      return resp;
    } catch (err) {
      console.warn('[GeminiSession] deleteCurrentConversation lỗi:', err.message);
      return { success: false, error: err.message };
    }
  }
}

if (typeof window !== 'undefined') {
  window.GeminiSession = GeminiSession;
}
