/**
 * ConfigErrorHandler - UI handling cho ConfigRequiredError.
 *
 * Phase 3: Server-Only Migration.
 * Hiển thị overlay khi extension không thể kết nối server và cache hết hạn.
 */
class ConfigErrorHandler {
  static _overlayVisible = false;
  static _handledConfigs = new Set();
  static _locale = 'en'; // updated by _initLocale() async

  // Local i18n fallback cho 6 overlay keys khi (a) window.I18n chưa load, (b) backend i18n
  // chưa seed keys `config.*`. Match pattern Phase 6 Bug Q content script overlays.
  static _LOCAL_I18N = {
    vi: {
      'config.required': 'Cần kết nối server',
      'config.offline': 'Không thể tải cấu hình. Vui lòng kiểm tra kết nối mạng và thử lại.',
      'config.retry_failed': 'Không thể kết nối',
      'config.check_network': 'Vui lòng kiểm tra kết nối mạng và thử lại.',
      'common.retry': 'Thử lại',
      'common.loading': 'Đang tải...',
    },
    en: {
      'config.required': 'Server connection required',
      'config.offline': 'Cannot load configuration. Please check your network and try again.',
      'config.retry_failed': 'Cannot connect',
      'config.check_network': 'Please check your network and try again.',
      'common.retry': 'Retry',
      'common.loading': 'Loading...',
    },


  };

  /**
   * Init locale từ chrome.storage.local.af_locale. Chạy 1 lần khi class load.
   */
  static _initLocale() {
    try {
      chrome.storage.local.get(['af_locale'], (r) => {
        if (r && r.af_locale) ConfigErrorHandler._locale = r.af_locale;
      });
    } catch (e) { /* ignore */ }
  }

  /**
   * Translate key — try window.I18n first (backend translations), fallback to local map.
   * Avoid hardcoded VN strings ở caller site.
   */
  static _t(key) {
    const i18nResult = window.I18n?.t?.(key);
    // I18n.t returns key literal khi missing translation, undefined khi chưa load.
    if (i18nResult && i18nResult !== key && typeof i18nResult === 'string') {
      return i18nResult;
    }
    const locale = this._locale || 'en';
    return (this._LOCAL_I18N[locale] || this._LOCAL_I18N.en)[key] || key;
  }

  /**
   * Handle ConfigRequiredError - log và show overlay.
   * @param {Error} error - ConfigRequiredError instance
   * @param {string} context - Nơi phát sinh lỗi (vd: 'GenTab ratios')
   */
  static handle(error, context = '') {
    if (!window.ConfigRequiredError?.is?.(error) && error?.name !== 'ConfigRequiredError') {
      throw error;
    }

    const configKey = error.configKey || 'unknown';
    console.warn(`[ConfigErrorHandler] Missing config: ${configKey}`, context);

    // Debounce: chỉ show 1 overlay dù nhiều config fail
    if (this._overlayVisible) return;

    // Track để analytics
    this._handledConfigs.add(configKey);

    this.showOverlay({
      title: this._t('config.required'),
      message: this._t('config.offline'),
      configKey,
    });
  }

  /**
   * Show config error overlay.
   * @param {object} options
   */
  static showOverlay(options) {
    if (this._overlayVisible) return;
    this._overlayVisible = true;

    // Remove existing
    document.querySelector('.config-error-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'config-error-overlay';
    overlay.innerHTML = `
      <div class="config-error-content">
        <div class="config-error-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <h3>${options.title || 'Lỗi kết nối'}</h3>
        <p>${options.message || 'Không thể tải cấu hình từ server.'}</p>
        <div class="config-error-actions">
          <button class="config-error-retry btn-primary" onclick="ConfigErrorHandler.retry()">
            ${this._t('common.retry')}
          </button>
        </div>
      </div>
    `;

    // Inject CSS nếu chưa có
    if (!document.getElementById('config-error-styles')) {
      const style = document.createElement('style');
      style.id = 'config-error-styles';
      style.textContent = `
        .config-error-overlay {
          position: fixed;
          inset: 0;
          background: rgba(26, 26, 26, 0.92);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 99999;
          animation: fadeIn 0.2s ease-out;
        }
        .config-error-content {
          text-align: center;
          padding: 32px;
          max-width: 400px;
        }
        .config-error-icon {
          color: var(--warning-color, #f59e0b);
          margin-bottom: 16px;
        }
        .config-error-content h3 {
          color: var(--text-primary, #fff);
          margin: 0 0 8px 0;
          font-size: 20px;
        }
        .config-error-content p {
          color: var(--text-secondary, #9ca3af);
          margin: 0 0 24px 0;
          font-size: 14px;
          line-height: 1.5;
        }
        .config-error-retry {
          background: var(--primary-color, #3b82f6);
          color: white;
          border: none;
          padding: 10px 24px;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .config-error-retry:hover {
          background: var(--primary-hover, #2563eb);
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(overlay);
  }

  /**
   * Hide overlay.
   */
  static hideOverlay() {
    this._overlayVisible = false;
    document.querySelector('.config-error-overlay')?.remove();
  }

  /**
   * Retry button handler.
   */
  static async retry() {
    this.hideOverlay();
    this._handledConfigs.clear();

    // Show loading
    if (window.showGlobalLoading) {
      window.showGlobalLoading(this._t('common.loading'));
    }

    try {
      // Retry fetch all configs
      const promises = [];

      if (window.ProviderConfigManager?.fetchMandatory) {
        promises.push(
          window.ProviderConfigManager.fetchMandatory('api_configs'),
          window.ProviderConfigManager.fetchMandatory('dom_selectors')
        );
      } else if (window.ProviderConfigManager?.fetch) {
        // Fallback to regular fetch
        promises.push(
          window.ProviderConfigManager.fetch(),
          window.ProviderConfigManager._fetchApiConfigs?.()
        );
      }

      if (window.ModelRegistry?.fetchMandatory) {
        promises.push(window.ModelRegistry.fetchMandatory());
      } else if (window.ModelRegistry?.fetch) {
        promises.push(window.ModelRegistry.fetch());
      }

      if (window.ValidationRules?.fetch) {
        promises.push(window.ValidationRules.fetch());
      }

      await Promise.all(promises.filter(Boolean));

      // Hide loading
      if (window.hideGlobalLoading) {
        window.hideGlobalLoading();
      }

      // Reload page để reinit UI
      location.reload();

    } catch (e) {
      console.error('[ConfigErrorHandler] Retry failed:', e);
      if (window.hideGlobalLoading) {
        window.hideGlobalLoading();
      }
      // Show overlay again
      this.showOverlay({
        title: this._t('config.retry_failed'),
        message: this._t('config.check_network'),
      });
    }
  }

  /**
   * Get list of configs that failed.
   * @returns {string[]}
   */
  static getFailedConfigs() {
    return Array.from(this._handledConfigs);
  }
}

// Init locale from chrome.storage at class load (sync — fire-and-forget).
// Default `_locale = 'en'` đảm bảo overlay có text hợp lý ngay cả khi storage callback chưa fire.
ConfigErrorHandler._initLocale();

// Listen for locale changes (vd: user đổi language trong settings).
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.af_locale) {
      ConfigErrorHandler._locale = changes.af_locale.newValue || 'en';
    }
  });
} catch (e) { /* ignore in non-extension context */ }

// Export
if (typeof window !== 'undefined') {
  window.ConfigErrorHandler = ConfigErrorHandler;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConfigErrorHandler;
}
