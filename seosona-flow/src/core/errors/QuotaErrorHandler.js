/**
 * QuotaErrorHandler — Centralized check + handle quota/feature errors.
 *
 * Backend trả 4 error codes liên quan quota:
 *   - QUOTA_EXCEEDED: Per-module quota hết (vd workflow_run_max)
 *   - GLOBAL_QUOTA_EXCEEDED: Global daily prompt quota hết
 *   - MODULE_DISABLED: Plan không bao gồm module này
 *   - FEATURE_LOCKED: Feature gate fail (vd grok_enabled=false)
 *
 * Pattern dùng:
 *   try {
 *     await someApiCall();
 *   } catch (e) {
 *     if (QuotaErrorHandler.handleIfQuotaError(e, 'Workflow')) {
 *       // Dialog đã hiện, caller cleanup + return/throw
 *       return false;
 *     }
 *     throw e; // not quota error → propagate
 *   }
 *
 * Phase 6.1 (CODE_DEDUP_PLAN): Centralize 14+ scattered error check sites.
 */
class QuotaErrorHandler {
  /**
   * Tất cả error codes coi là "quota-related" (block execution).
   * Source of truth — thêm code mới chỉ cần update array này.
   */
  static QUOTA_ERROR_CODES = Object.freeze([
    'QUOTA_EXCEEDED',
    'GLOBAL_QUOTA_EXCEEDED',
    'MODULE_DISABLED',
    'FEATURE_LOCKED',
  ]);

  /**
   * Check if error là quota-related.
   * @param {Error|object} err - Error thrown từ API hoặc gate.request()
   * @returns {boolean}
   */
  static isQuotaError(err) {
    if (!err) return false;
    const code = err.code || err.reason;
    return code && this.QUOTA_ERROR_CODES.includes(code);
  }

  /**
   * Show denied dialog cho user.
   * Wrap ExecutionGate.showDeniedDialog (đã centralize UI).
   * @param {object} err - Error object hoặc gate response
   * @param {string} moduleName - 'Generate', 'Workflow', 'Task', 'Telegram', etc.
   */
  static showDialog(err, moduleName = '') {
    if (!window.ExecutionGate?.showDeniedDialog) {
      console.warn('[QuotaErrorHandler] ExecutionGate not available, dialog skipped');
      return;
    }
    const gate = {
      reason: err.code || err.reason,
      limit: err.serverData?.limit ?? err.limit,
      used: err.serverData?.used ?? err.used,
      global_limit: err.serverData?.global_limit ?? err.global_limit,
      global_used: err.serverData?.global_used ?? err.global_used,
      prompt_count: err.serverData?.prompt_count ?? err.prompt_count,
    };
    window.ExecutionGate.showDeniedDialog(gate, moduleName);
  }

  /**
   * Combined: check + show dialog. Trả true nếu là quota error (caller nên stop).
   * @param {Error|object} err - Error to check
   * @param {string} moduleName - Module name for dialog
   * @returns {boolean} true = quota error (handled), false = not quota error
   */
  static handleIfQuotaError(err, moduleName = '') {
    if (!this.isQuotaError(err)) return false;
    this.showDialog(err, moduleName);
    return true;
  }

  /**
   * Check + show dialog + rethrow. Dùng khi caller muốn vẫn throw để cleanup chạy.
   * @param {Error|object} err - Error to check and rethrow
   * @param {string} moduleName - Module name for dialog
   * @throws {Error} Always rethrows the error after showing dialog if quota error
   */
  static handleAndThrow(err, moduleName = '') {
    if (this.isQuotaError(err)) {
      this.showDialog(err, moduleName);
    }
    throw err;
  }

  /**
   * Get localized message for quota error code.
   * @param {string} code - Error code
   * @param {object} data - Optional data for interpolation (limit, used, etc.)
   * @returns {string}
   */
  static getMessage(code, data = {}) {
    const t = window.I18n?.t?.bind(window.I18n) || (k => k);

    switch (code) {
      case 'QUOTA_EXCEEDED':
        return data.limit
          ? t('errors.quotaExceeded', `Bạn đã dùng hết ${data.used || 0}/${data.limit} lượt cho module này.`)
          : t('errors.quotaExceededGeneric', 'Bạn đã dùng hết quota cho module này.');

      case 'GLOBAL_QUOTA_EXCEEDED':
        return data.global_limit
          ? t('errors.globalQuotaExceeded', `Bạn đã dùng hết ${data.global_used || 0}/${data.global_limit} prompt hôm nay.`)
          : t('errors.globalQuotaExceededGeneric', 'Bạn đã dùng hết quota prompt hôm nay.');

      case 'MODULE_DISABLED':
        return t('errors.moduleDisabled', 'Module này không có trong gói của bạn.');

      case 'FEATURE_LOCKED':
        return t('errors.featureLocked', 'Tính năng này chưa được mở khóa.');

      default:
        return t('errors.unknownQuotaError', 'Không thể thực hiện do giới hạn quota.');
    }
  }
}

window.QuotaErrorHandler = QuotaErrorHandler;
