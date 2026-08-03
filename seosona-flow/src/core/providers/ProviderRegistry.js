/**
 * ProviderRegistry - Static registry quản lý mọi AIProviderAdapter.
 *
 * Mục đích:
 * - Đăng ký các adapter (Flow, ChatGPT, ...) tại 1 nơi tập trung.
 * - Cho phép code generic lookup adapter theo key (vd: 'flow', 'chatgpt').
 * - Filter adapters theo FeatureGate (chỉ trả về provider user có quyền).
 * - Bootstrap idempotent — gọi nhiều lần KHÔNG bị duplicate.
 *
 * Auto-bootstrap: chạy 1 tick sau khi script load để đảm bảo
 * AIProviderAdapter, FlowAdapter, ChatGPTAdapter đã hiện diện trên window.
 */
class ProviderRegistry {
  static _adapters = new Map();
  static _initialized = false;

  /**
   * Đăng ký 1 adapter instance. Bỏ qua nếu thiếu key.
   * Re-register cùng key sẽ override entry cũ.
   */
  static register(adapter) {
    if (!adapter || !adapter.key) {
      console.warn('[ProviderRegistry] adapter missing key, skip register');
      return;
    }
    this._adapters.set(adapter.key, adapter);
  }

  /**
   * Lấy adapter theo key. Fallback về 'flow' nếu không tìm thấy
   * (giữ behavior cũ — Flow là default provider).
   */
  static get(key) {
    return this._adapters.get(key) || this._adapters.get('flow');
  }

  /**
   * Trả về toàn bộ adapter đã đăng ký (không filter feature gate).
   */
  static getAll() {
    return Array.from(this._adapters.values());
  }

  /**
   * Trả về các adapter user có quyền dùng (qua featureGate.canUse).
   * Adapter throw trong isEnabled() sẽ bị loại an toàn.
   */
  static getAvailable() {
    return this.getAll().filter((a) => {
      try {
        return a.isEnabled();
      } catch (e) {
        console.warn('[ProviderRegistry] isEnabled throw for', a?.key, e?.message || e);
        return false;
      }
    });
  }

  /**
   * Bootstrap idempotent — auto register Flow + ChatGPT adapters.
   * Gọi nhiều lần OK; chỉ chạy effect 1 lần.
   */
  static bootstrap() {
    if (this._initialized) return;
    if (window.FlowAdapter) {
      try {
        this.register(new window.FlowAdapter());
      } catch (e) {
        console.warn('[ProviderRegistry] FlowAdapter init error:', e?.message || e);
      }
    }
    if (window.ChatGPTAdapter) {
      try {
        this.register(new window.ChatGPTAdapter());
      } catch (e) {
        console.warn('[ProviderRegistry] ChatGPTAdapter init error:', e?.message || e);
      }
    }
    // Phase G-3: Register GrokAdapter (idempotent, try/catch fallback)
    if (window.GrokAdapter) {
      try {
        if (!this._adapters.has('grok')) {
          this.register(new window.GrokAdapter());
        }
      } catch (e) {
        console.warn('[ProviderRegistry] GrokAdapter init error:', e?.message || e);
      }
    }
    // Phase CG-8: Gemini adapter (text-only enhance cho Prompt node)
    if (window.GeminiAdapter) {
      try {
        this.register(new window.GeminiAdapter());
      } catch (e) {
        console.warn('[ProviderRegistry] GeminiAdapter init error:', e?.message || e);
      }
    }
    this._initialized = true;
    console.log(
      '[ProviderRegistry] Bootstrap done, adapters:',
      this.getAll().map((a) => a.key),
    );
  }
}

window.ProviderRegistry = ProviderRegistry;

// Auto-bootstrap: chờ DOM ready (hoặc 1 tick) để các adapter classes load xong.
if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => ProviderRegistry.bootstrap(),
    { once: true },
  );
} else {
  setTimeout(() => ProviderRegistry.bootstrap(), 0);
}
