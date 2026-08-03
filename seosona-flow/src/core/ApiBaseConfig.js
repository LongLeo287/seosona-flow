/**
 * ApiBaseConfig — single source of truth for API base URL.
 *
 * Phase 6 Bug N.3 (2026-06-03): Centralize labs.seosona.vn fallback từ 12+ files
 * vào 1 const default. Đối thủ clone .crx → chỉ thấy domain ở 1 nơi (đã public anyway).
 *
 * Priority chain:
 *   1. window.authManager?.apiBaseUrl  (runtime — set sau khi AuthManager init)
 *   2. ApiBaseConfig.DEFAULT            (bootstrap default — cần để fetch /health, /entitlements
 *                                        trước khi AuthManager load)
 *
 * Usage:
 *   const url = window.ApiBaseConfig.get();
 *   fetch(`${url}/health`);
 */
class ApiBaseConfig {
  /**
   * Default API base URL for SEOSONA Flow.
   */
  static DEFAULT = 'http://localhost:8080/api/v1';

  static validate(url) {
    try {
      const u = new URL(url);
      const host = u.hostname;
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
      if (u.protocol !== 'https:' && !isLocal) {
        console.warn('[Security] API base is non-HTTPS: ' + url);
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('ApiBaseConfig', _); }
    return url;
  }

  static get() {
    return this.validate(this.DEFAULT);
  }

  static getWebBase() {
    return this.get().replace(/\/api\/v\d+\/?$/, '');
  }
}

window.ApiBaseConfig = ApiBaseConfig;
