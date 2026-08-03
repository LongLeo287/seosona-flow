/**
 * RetryHelper - Cơ chế retry thống nhất cho toàn bộ extension
 * Dùng chung cho: Tab 1 (Prompts), Tab 3 (Multi Task), Tab 4 (Workflow)
 *
 * Settings đọc từ af_settings (StorageSettings sync):
 *   execMaxRetries    - Số lần thử lại (0-5, mặc định 2)
 *   execRetryDelay    - Delay giữa các lần retry (giây, mặc định 3)
 *   execTileTimeout   - Timeout chờ kết quả tile (giây, mặc định 180)
 */
class RetryHelper {
  /**
   * Lấy retry config hiện tại từ settings
   * Ưu tiên: workflowExecutor.settings > defaults
   */
  static getConfig() {
    const s = window.workflowExecutor?.settings || {};
    return {
      maxRetries: s.maxRetries ?? 2,
      retryDelay: s.retryDelay ?? 3000,       // ms
      tileTimeout: s.tileTimeout ?? 180000,    // ms
      stopOnError: s.stopOnError ?? false
    };
  }

  // ── Backoff & rate-limit awareness (2026-07-09) ──────────────────────────
  static BACKOFF_FACTOR = 2;
  static MAX_DELAY_MS = 60000;        // trần 60s cho 1 lần chờ
  static RATE_LIMIT_MIN_MS = 15000;   // 429 → chờ tối thiểu 15s

  /**
   * Nhận diện lỗi rate-limit (429 / "too many requests" / cFlow FLOW_RECAPTCHA / quota).
   * Đọc httpStatus, code, isRateLimit, hoặc message.
   */
  static isRateLimit(error) {
    if (!error) return false;
    if (error.httpStatus === 429 || error.status === 429) return true;
    if (error.isRateLimit === true || error.code === 'RATE_LIMITED') return true;
    const m = String(error.message || error).toLowerCase();
    return /\b429\b|too many request|rate.?limit|quota exceeded|resource.?exhausted/.test(m);
  }

  /**
   * Delay cho lần retry thứ `attempt` (1-based: lần retry đầu = 1).
   * Exponential: base * factor^(attempt-1), + jitter ±25%, trần MAX_DELAY_MS.
   * Rate-limit: honor error.retryAfter (giây) nếu có, else base >= RATE_LIMIT_MIN_MS.
   */
  static _computeDelay(baseDelay, attempt, error, opts = {}) {
    if (opts.backoff === false) return baseDelay; // opt-out → hành vi cũ (delay cố định)
    const factor = opts.backoffFactor ?? this.BACKOFF_FACTOR;
    const cap = opts.maxDelay ?? this.MAX_DELAY_MS;
    let base = baseDelay;
    if (this.isRateLimit(error)) {
      const ra = Number(error?.retryAfter);
      if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, cap);
      base = Math.max(base, this.RATE_LIMIT_MIN_MS);
    }
    let delay = base * Math.pow(factor, Math.max(0, attempt - 1));
    delay = Math.min(delay, cap);
    if (opts.jitter !== false) {
      // jitter ±25% để tránh thundering-herd khi nhiều job cùng retry
      const j = delay * 0.25;
      delay = delay - j + Math.random() * 2 * j;
    }
    return Math.max(250, Math.round(delay));
  }

  /**
   * Thực thi một hàm với retry
   *
   * @param {Function} fn - Async function cần thực thi, nhận { attempt, maxRetries }
   * @param {Object} options
   * @param {Function} options.shouldStop - Trả về true nếu nên dừng
   * @param {Function} options.onRetry - Callback khi retry (attempt, maxRetries, error)
   * @param {Function} options.onFail - Callback khi thất bại hoàn toàn (error, attempts)
   * @param {string} options.label - Tên hiển thị cho log
   * @param {number} options.maxRetries - Override maxRetries từ config
   * @param {number} options.retryDelay - Override retryDelay từ config (ms)
   * @returns {Promise<*>} Kết quả từ fn
   */
  static async execute(fn, options = {}) {
    const config = this.getConfig();
    const maxRetries = options.maxRetries ?? config.maxRetries;
    const retryDelay = options.retryDelay ?? config.retryDelay;
    const shouldStop = options.shouldStop || (() => false);
    const onRetry = options.onRetry || (() => {});
    const onFail = options.onFail || (() => {});
    const label = options.label || 'action';

    // maxRetries = số lần THỬ LẠI (không tính lần chạy đầu)
    // Tổng số lần chạy = 1 (lần đầu) + maxRetries (retry)
    const totalAttempts = 1 + maxRetries;
    let attempt = 0;
    let lastError = null;

    while (attempt < totalAttempts) {
      if (shouldStop()) {
        throw new Error(`${label}: Đã dừng bởi người dùng`);
      }

      try {
        attempt++;
        const result = await fn({ attempt, totalAttempts });
        return result;
      } catch (error) {
        if (shouldStop()) throw error;

        lastError = error;
        console.warn(`[RetryHelper] ${label} attempt ${attempt}/${totalAttempts} failed:`, error.message);

        // Skip retry nếu error đánh dấu noRetry (vd: CONTENT_BLOCKED sau 1 lần retry)
        if (error.noRetry) {
          console.warn(`[RetryHelper] ${label}: error.noRetry=true — không retry thêm`);
          break;
        }

        if (attempt < totalAttempts) {
          // Exponential backoff + jitter + 429-aware (attempt=1 cho lần retry đầu tiên).
          const waitMs = this._computeDelay(retryDelay, attempt, error, options);
          if (this.isRateLimit(error)) {
            console.warn(`[RetryHelper] ${label}: rate-limit detected → chờ ${Math.round(waitMs / 1000)}s trước retry`);
          }
          onRetry(attempt, totalAttempts, error, waitMs);
          // Interruptible delay: chia thành chunks 500ms
          await this._interruptibleDelay(waitMs, shouldStop);
        }
      }
    }

    onFail(lastError, attempt);
    throw lastError;
  }

  /**
   * Delay có thể ngắt khi shouldStop() trả về true
   */
  static async _interruptibleDelay(ms, shouldStop) {
    const chunkSize = 500;
    let elapsed = 0;
    while (elapsed < ms) {
      if (shouldStop()) throw new Error('Đã dừng bởi người dùng');
      const wait = Math.min(chunkSize, ms - elapsed);
      await new Promise(r => setTimeout(r, wait));
      elapsed += wait;
    }
  }
}

// Export
window.RetryHelper = RetryHelper;
