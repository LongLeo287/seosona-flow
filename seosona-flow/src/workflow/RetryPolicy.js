// SEOSONA Flow — Retry Policy (Phase 5 / P5.T6, AUD-017).
// Classic script. Bounded backoff + effect classification so retries never
// silently duplicate non-repeatable effects (media generation, external sends).
// Non-repeatable nodes require explicit user confirmation to replay.
(function (global) {
  'use strict';

  // Effect class per node type.
  //  pure           — deterministic, free to retry
  //  idempotent     — safe to retry WITH an idempotency key
  //  non-repeatable — each run creates a new external effect; unsafe to auto-retry
  var EFFECT_CLASS = {
    prompt: 'pure',
    text: 'pure',
    note: 'pure',
    image: 'non-repeatable',
    generate: 'non-repeatable',
    chatgpt: 'non-repeatable',
  };

  var DEFAULTS = { maxAttempts: 3, baseMs: 500, factor: 2, maxMs: 30000 };

  function effectClass(nodeType) {
    return EFFECT_CLASS[nodeType] || 'non-repeatable'; // unknown -> conservative
  }

  function requiresConfirmation(nodeType) {
    return effectClass(nodeType) === 'non-repeatable';
  }

  // shouldRetry(nodeType, attempt, opts) -> { retry, reason }
  function shouldRetry(nodeType, attempt, opts) {
    opts = opts || {};
    var max = opts.maxAttempts || DEFAULTS.maxAttempts;
    if (attempt >= max) return { retry: false, reason: 'MAX_ATTEMPTS' };
    var cls = effectClass(nodeType);
    if (cls === 'non-repeatable' && !opts.userConfirmed) {
      return { retry: false, reason: 'NEEDS_CONFIRMATION' };
    }
    return { retry: true, reason: null };
  }

  // Deterministic exponential backoff (no jitter unless a seed is provided).
  function backoff(attempt, opts) {
    opts = opts || {};
    var base = opts.baseMs || DEFAULTS.baseMs;
    var factor = opts.factor || DEFAULTS.factor;
    var maxMs = opts.maxMs || DEFAULTS.maxMs;
    var delay = base * Math.pow(factor, Math.max(0, attempt - 1));
    if (typeof opts.seed === 'number') {
      // deterministic pseudo-jitter in [0.5,1.0] from the seed+attempt
      var frac = ((Math.sin(opts.seed + attempt) + 1) / 2) * 0.5 + 0.5;
      delay = delay * frac;
    }
    return Math.min(Math.round(delay), maxMs);
  }

  // Stable idempotency key from node id + normalized input.
  function idempotencyKey(node, input) {
    var id = (node && node.id) || 'node';
    var payload;
    try { payload = JSON.stringify(input || (node && node.data) || {}); } catch (_) { payload = ''; }
    var h = 5381;
    for (var i = 0; i < payload.length; i++) h = ((h << 5) + h + payload.charCodeAt(i)) >>> 0;
    return id + ':' + h.toString(16);
  }

  // ── Trục thứ hai: phân loại theo LOẠI LỖI ──────────────────────────────────
  // EFFECT_CLASS ở trên trả lời "node này retry có an toàn không".
  // Phần dưới trả lời "lỗi này thì nên làm gì" — hai câu hỏi khác nhau, cần cả hai.
  //
  // Bài học lấy từ cây quyết định _handle_failure của flowkit: gộp mọi lỗi vào một
  // mức retry chung là sai ở hai đầu — mất kết nối mà tính vào ngân sách retry thì
  // đốt sạch lượt cho một sự cố không phải lỗi nội dung; còn bị Google gắn cờ mà cứ
  // thử lại thì càng bị gắn nặng hơn.
  //
  // action:
  //   'requeue'  — xếp lại hàng, KHÔNG tính vào ngân sách retry (sự cố ngoài nội dung)
  //   'retry'    — thử lại có backoff, CÓ tính vào ngân sách
  //   'halt'     — dừng cả workflow, hỏi người dùng (không tự thử lại)
  //   'terminal' — hỏng dứt điểm, thử lại vô ích (hết quota, sai tầng, bị chặn nội dung)
  var FAILURE_CLASS = {
    // Ref/media hết hạn (~1 giờ) — nạp lại rồi chạy tiếp, không phải lỗi của người dùng.
    media_expired:   { action: 'requeue',  counts: false, recoverable: true },
    entity_not_found:{ action: 'requeue',  counts: false, recoverable: true },
    // Sự cố vận chuyển: rớt kết nối, đổi tab provider, service worker ngủ.
    disconnected:    { action: 'requeue',  counts: false, recoverable: true },
    reconnected:     { action: 'requeue',  counts: false, recoverable: true },
    switched:        { action: 'requeue',  counts: false, recoverable: true },
    // Google gắn cờ phiên — thử lại chỉ làm nặng thêm. Dừng và để người dùng xử lý.
    captcha:         { action: 'halt',     counts: false, recoverable: false },
    captcha_failed:  { action: 'halt',     counts: false, recoverable: false },
    bot_detected:    { action: 'halt',     counts: false, recoverable: false },
    // Hỏng dứt điểm — retry không bao giờ đổi kết quả.
    quota:           { action: 'terminal', counts: false, recoverable: false },
    quota_exceeded:  { action: 'terminal', counts: false, recoverable: false },
    tier_restricted: { action: 'terminal', counts: false, recoverable: false },
    policy:          { action: 'terminal', counts: false, recoverable: false },
    content_blocked: { action: 'terminal', counts: false, recoverable: false },
    // Quá tải / lỗi tạm phía Google — đúng chỗ dùng backoff luỹ thừa.
    rate_limit:      { action: 'retry',    counts: true,  recoverable: true },
    network:         { action: 'retry',    counts: true,  recoverable: true },
    server_error:    { action: 'retry',    counts: true,  recoverable: true },
  };

  /**
   * classifyFailure(category) -> { action, counts, recoverable, category }
   * Không rõ loại thì coi là 'network' (thử lại có giới hạn) — an toàn hơn 'terminal'
   * (bỏ oan việc chạy được) và an toàn hơn 'requeue' (thử lại vô hạn).
   */
  function classifyFailure(category) {
    var key = String(category || '').toLowerCase();
    var hit = FAILURE_CLASS[key];
    if (!hit) return { action: 'retry', counts: true, recoverable: true, category: 'unknown' };
    return { action: hit.action, counts: hit.counts, recoverable: hit.recoverable, category: key };
  }

  /**
   * Backoff luỹ thừa lấy tham số từ getRateLimitsSync: base * 2^(n-1), chặn trần.
   * Với mặc định Flow: 10s → 20s → 40s → 80s → 160s, trần 300s.
   */
  function backoffFromLimits(attempt, limits) {
    limits = limits || {};
    return backoff(attempt, {
      baseMs: limits.baseBackoffMs || 10000,
      factor: 2,
      maxMs: limits.maxBackoffMs || 300000,
    });
  }

  /** Cầu chì: đếm lỗi liên tiếp, đủ ngưỡng thì mở mạch trong circuitBreakerResetMs. */
  function createCircuitBreaker(limits, now) {
    limits = limits || {};
    var threshold = limits.circuitBreakerThreshold || 5;
    var resetMs = limits.circuitBreakerResetMs || 60000;
    var consecutive = 0;
    var openedAt = null;
    return {
      /** @param {number} t mốc thời gian (ms) — truyền vào để test được, không tự gọi Date.now */
      isOpen: function (t) {
        if (openedAt === null) return false;
        if (t - openedAt >= resetMs) { openedAt = null; consecutive = 0; return false; }
        return true;
      },
      remainingMs: function (t) { return openedAt === null ? 0 : Math.max(0, resetMs - (t - openedAt)); },
      recordSuccess: function () { consecutive = 0; openedAt = null; },
      /** @returns {boolean} true nếu lần lỗi này làm mạch MỞ */
      recordFailure: function (t) {
        consecutive += 1;
        if (consecutive >= threshold && openedAt === null) { openedAt = t; return true; }
        return false;
      },
      stats: function () { return { consecutive: consecutive, open: openedAt !== null, threshold: threshold }; },
    };
  }

  global.SEOSONA_RetryPolicy = {
    EFFECT_CLASS: EFFECT_CLASS,
    FAILURE_CLASS: FAILURE_CLASS,
    DEFAULTS: DEFAULTS,
    effectClass: effectClass,
    requiresConfirmation: requiresConfirmation,
    shouldRetry: shouldRetry,
    backoff: backoff,
    backoffFromLimits: backoffFromLimits,
    classifyFailure: classifyFailure,
    createCircuitBreaker: createCircuitBreaker,
    idempotencyKey: idempotencyKey,
  };
})(typeof self !== 'undefined' ? self : this);
