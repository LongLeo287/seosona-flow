// SEOSONA Flow — Provider Error normalization (Phase 6 / P6.T7, AUD-020).
// Classic worker script, pure/headless. Maps heterogeneous provider signals
// (thrown errors, DOM states, HTTP-ish statuses, adapter codes) onto a small
// set of STABLE, provider-independent error codes so the workflow engine never
// branches on provider-specific strings. Every normalized error carries:
//   - code:        stable machine code (never localized, never provider-named)
//   - retryable:   boolean — safe to retry the SAME operation as-is?
//   - action:      what the operator/UI should do next (stable enum)
//   - evidence:    REDACTED short diagnostic (no prompts, no PII, no secrets)
//   - provider:    which provider surfaced it (label only)
// Redaction is mandatory: raw messages are truncated + scrubbed so prompts,
// URLs with tokens, emails, and long opaque strings never reach logs/telemetry.
(function (global) {
  'use strict';

  // Stable codes. Additive only — never renumber or repurpose.
  var CODES = {
    AUTH: 'E_PROV_AUTH',           // logged out / session invalid
    RATE: 'E_PROV_RATE',           // throttled / quota
    CHALLENGE: 'E_PROV_CHALLENGE', // captcha / human check
    SELECTOR: 'E_PROV_SELECTOR',   // DOM drift — adapter can't find element
    REJECTED: 'E_PROV_REJECTED',   // provider refused the request (policy/content)
    NETWORK: 'E_PROV_NETWORK',     // transport failure
    TIMEOUT: 'E_PROV_TIMEOUT',     // deadline exceeded
    CANCELLED: 'E_PROV_CANCELLED', // caller/user aborted
    UNKNOWN: 'E_PROV_UNKNOWN',     // unmapped
  };

  // Recommended next action per code. Stable enum consumed by UI/workflow.
  var ACTIONS = {
    E_PROV_AUTH: 'reauthenticate',
    E_PROV_RATE: 'wait_and_retry',
    E_PROV_CHALLENGE: 'solve_challenge',
    E_PROV_SELECTOR: 'update_adapter',
    E_PROV_REJECTED: 'revise_request',
    E_PROV_NETWORK: 'retry',
    E_PROV_TIMEOUT: 'retry',
    E_PROV_CANCELLED: 'none',
    E_PROV_UNKNOWN: 'inspect',
  };

  // Retryability: is retrying the identical operation safe AND potentially useful?
  // AUTH/CHALLENGE/REJECTED need human/side-effect intervention first → not auto.
  // SELECTOR needs a code change → not auto. CANCELLED is terminal by intent.
  var RETRYABLE = {
    E_PROV_AUTH: false,
    E_PROV_RATE: true,
    E_PROV_CHALLENGE: false,
    E_PROV_SELECTOR: false,
    E_PROV_REJECTED: false,
    E_PROV_NETWORK: true,
    E_PROV_TIMEOUT: true,
    E_PROV_CANCELLED: false,
    E_PROV_UNKNOWN: false,
  };

  var CODE_SET = Object.keys(ACTIONS).reduce(function (s, k) { s[k] = true; return s; }, {});

  // ---- Redaction -----------------------------------------------------------
  // Scrub anything that could carry user content or secrets, then bound length.
  var MAX_EVIDENCE = 160;
  function redact(raw) {
    if (raw == null) return '';
    var s = String(raw);
    // Strip query strings / fragments (tokens ride there).
    s = s.replace(/([?#])\S+/g, '$1<redacted>');
    // Emails.
    s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
    // Bearer/JWT-ish and long opaque tokens.
    s = s.replace(/\b[A-Za-z0-9_-]{24,}\b/g, '<token>');
    // Data URIs.
    s = s.replace(/data:[^\s'"]+/gi, 'data:<redacted>');
    // Collapse whitespace.
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > MAX_EVIDENCE) s = s.slice(0, MAX_EVIDENCE - 1) + '…';
    return s;
  }

  // ---- Signal → code mapping ----------------------------------------------
  // Order matters: check explicit codes, then HTTP status, then keyword hints.
  function classify(signal) {
    if (!signal) return CODES.UNKNOWN;

    // 1) Already a normalized/adapter code.
    var explicit = signal.code || signal.errorCode;
    if (explicit && CODE_SET[explicit]) return explicit;

    // 2) Explicit named kinds an adapter may hand us.
    var kind = (signal.kind || signal.type || '').toLowerCase();
    var kindMap = {
      auth: CODES.AUTH, unauthorized: CODES.AUTH, loggedout: CODES.AUTH,
      rate: CODES.RATE, ratelimit: CODES.RATE, quota: CODES.RATE,
      captcha: CODES.CHALLENGE, challenge: CODES.CHALLENGE,
      selector: CODES.SELECTOR, drift: CODES.SELECTOR,
      rejected: CODES.REJECTED, policy: CODES.REJECTED, moderation: CODES.REJECTED,
      network: CODES.NETWORK, offline: CODES.NETWORK,
      timeout: CODES.TIMEOUT, deadline: CODES.TIMEOUT,
      cancel: CODES.CANCELLED, cancelled: CODES.CANCELLED, abort: CODES.CANCELLED, aborted: CODES.CANCELLED,
    };
    if (kindMap[kind]) return kindMap[kind];

    // 3) AbortError (DOM/AbortController) → cancelled.
    if (signal.name === 'AbortError') return CODES.CANCELLED;

    // 4) HTTP-ish status.
    var status = typeof signal.status === 'number' ? signal.status
      : (typeof signal.httpStatus === 'number' ? signal.httpStatus : null);
    if (status != null) {
      if (status === 401 || status === 403) return CODES.AUTH;
      if (status === 429) return CODES.RATE;
      if (status === 408 || status === 504) return CODES.TIMEOUT;
      if (status >= 500) return CODES.NETWORK;
      if (status === 400 || status === 422) return CODES.REJECTED;
    }

    // 5) Keyword sniff on the message (last resort, redaction still applies).
    var msg = String(signal.message || signal.reason || signal || '').toLowerCase();
    if (/\bcaptcha|are you (a )?human|verify you|challenge\b/.test(msg)) return CODES.CHALLENGE;
    if (/\b(log ?in|sign ?in|logged ?out|unauthori[sz]ed|session expired)\b/.test(msg)) return CODES.AUTH;
    if (/\b(rate ?limit|too many requests|quota|throttl)\b/.test(msg)) return CODES.RATE;
    if (/\b(timed? ?out|timeout|deadline)\b/.test(msg)) return CODES.TIMEOUT;
    if (/\b(abort|cancel)\b/.test(msg)) return CODES.CANCELLED;
    if (/\b(selector|not found in dom|no matching element|element .* gone)\b/.test(msg)) return CODES.SELECTOR;
    if (/\b(reject|refus|not allowed|content policy|violat|moderat)\b/.test(msg)) return CODES.REJECTED;
    if (/\b(network|fetch failed|connection|offline|econn|dns)\b/.test(msg)) return CODES.NETWORK;

    return CODES.UNKNOWN;
  }

  // Public: normalize any signal into a stable, redacted ProviderError object.
  function normalize(signal, opts) {
    opts = opts || {};
    var code = classify(signal);
    var provider = String(opts.provider || (signal && signal.provider) || 'unknown');
    var rawMsg = signal && (signal.message || signal.reason) ? (signal.message || signal.reason) : signal;
    return {
      code: code,
      retryable: !!RETRYABLE[code],
      action: ACTIONS[code],
      provider: provider,
      evidence: redact(rawMsg),
      at: typeof opts.at === 'number' ? opts.at : null, // caller stamps time; no Date.now() here
    };
  }

  function isRetryable(err) { return !!(err && RETRYABLE[err.code]); }

  global.SEOSONA_ProviderError = {
    CODES: CODES,
    ACTIONS: ACTIONS,
    normalize: normalize,
    classify: classify,
    redact: redact,
    isRetryable: isRetryable,
  };
})(typeof self !== 'undefined' ? self : this);
