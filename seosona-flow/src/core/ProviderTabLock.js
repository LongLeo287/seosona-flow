/**
 * ProviderTabLock — Phase CG-8b
 *
 * Mutex serialize tab activation cho mixed-provider workflows.
 *
 * Vấn đề: workflow có cả Flow + ChatGPT (hoặc Gemini) → 2 node chạy parallel
 * sẽ tranh tab focus → context menu Flow + Radix menu ChatGPT đều fail.
 *
 * Strategy: mỗi provider có lock riêng. acquire() switch tab + chờ stable
 * rồi return release function. Caller phải release sau khi xong.
 */
class ProviderTabLock {
  static _locks = new Map();          // provider → Promise queue
  static _currentActiveTab = null;    // 'flow' | 'chatgpt' | 'gemini' | 'grok' | null
  static _switchSettleMs = 300;       // sleep sau khi activate tab — chờ React/Radix render

  /**
   * Acquire lock cho provider. Auto activate tab tương ứng.
   * @param {string} provider - 'flow' | 'chatgpt' | 'gemini' | 'grok'
   * @param {string} [opLabel=''] - Tên operation (cho log)
   * @returns {Promise<Function>} release function (idempotent)
   */
  static async acquire(provider, opLabel = '') {
    if (!provider) throw new Error('ProviderTabLock.acquire: provider required');

    // Wait existing lock cho provider (queue)
    while (this._locks.has(provider)) {
      try {
        await this._locks.get(provider);
      } catch (e) { /* swallow */ }
    }

    let releaseFn;
    const lockPromise = new Promise(resolve => { releaseFn = resolve; });
    this._locks.set(provider, lockPromise);

    try {
      // Activate tab tương ứng nếu cần
      if (this._currentActiveTab !== provider) {
        console.log(`[ProviderTabLock] Switching tab → ${provider} (${opLabel})`);
        await this._activateProviderTab(provider);
        this._currentActiveTab = provider;
        await this._sleep(this._switchSettleMs);
      }
    } catch (err) {
      this._locks.delete(provider);
      releaseFn();
      throw err;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._locks.delete(provider);
      releaseFn();
    };
  }

  /**
   * Re-activate tab provider mà không tạo lock mới (defensive — user có thể
   * switch tab trong lúc operation đang chạy). Caller đã giữ lock từ trước.
   */
  static async ensureActiveSilent(provider) {
    if (!provider) return;
    if (this._currentActiveTab !== provider) {
      console.warn(`[ProviderTabLock] Tab drift → re-activate ${provider}`);
      await this._activateProviderTab(provider);
      this._currentActiveTab = provider;
      await this._sleep(this._switchSettleMs);
    }
  }

  static _activateProviderTab(provider) {
    return new Promise((resolve) => {
      let action;
      if (provider === 'flow') action = 'ensureFlowTabActive';
      else if (provider === 'chatgpt') action = 'chatgpt:ensureActive';
      else if (provider === 'gemini') action = 'gemini:ensureActive';
      else if (provider === 'grok') action = 'grok:ensureActive';
      else if (provider === 'claude') action = 'claude:ensureActive';
      else {
        console.warn('[ProviderTabLock] Unknown provider:', provider);
        return resolve();
      }

      try {
        chrome.runtime.sendMessage({ action }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[ProviderTabLock] activate err:', chrome.runtime.lastError.message);
          }
          resolve();
        });
      } catch (err) {
        console.warn('[ProviderTabLock] sendMessage exception:', err.message);
        resolve(); // soft fail — operation tiếp tục với best effort
      }
    });
  }

  /**
   * Reset state — gọi khi workflow stop hoặc user click outside.
   */
  static reset() {
    this._locks.clear();
    this._currentActiveTab = null;
  }

  static _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  static getState() {
    return {
      currentActiveTab: this._currentActiveTab,
      lockedProviders: Array.from(this._locks.keys()),
    };
  }
}

window.ProviderTabLock = ProviderTabLock;
