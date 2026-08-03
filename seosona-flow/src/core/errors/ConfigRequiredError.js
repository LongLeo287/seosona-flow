/**
 * ConfigRequiredError - Thrown khi config bắt buộc không có sẵn.
 *
 * Phase 3: Server-Only Migration.
 * Khi server unavailable VÀ cache expired/missing, extension throw error này
 * thay vì fallback về hardcode defaults.
 */
class ConfigRequiredError extends Error {
  // Phase 3 Test: Enable verbose logging
  static _DEBUG = true;

  constructor(configKey, context = '') {
    const message = context
      ? `CONFIG_REQUIRED: ${configKey} (${context})`
      : `CONFIG_REQUIRED: ${configKey}`;
    super(message);
    this.name = 'ConfigRequiredError';
    this.configKey = configKey;
    this.context = context;

    // Phase 3 Test: Log when error is created (will be caught by safe getters)
    if (ConfigRequiredError._DEBUG) {
      console.debug(`[ConfigRequiredError] ⚠ Created: ${configKey} (${context || 'no context'})`);
    }
  }

  /**
   * Check if error is ConfigRequiredError.
   * @param {Error} err
   * @returns {boolean}
   */
  static is(err) {
    return err instanceof ConfigRequiredError || err?.name === 'ConfigRequiredError';
  }
}

// Export
if (typeof window !== 'undefined') {
  window.ConfigRequiredError = ConfigRequiredError;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConfigRequiredError;
}
