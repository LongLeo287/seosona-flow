// SEOSONA Flow — Data Classification (Phase 7 / P7.T4, AUD-022).
// Classic script, pure/headless. Assigns every stored key a data CLASS, a
// PURPOSE, and a RETENTION so no stored field is unjustified. Classes drive the
// export/deletion policies (a `token`/`session` field is never exported; a
// `cache` field is safe to purge). Built to run over the Phase 1 storage
// inventory (224 keys) so classification is complete and reconciled.
(function (global) {
  'use strict';

  // class -> default purpose + retention. `sensitive` gates export/redaction.
  var CLASS_META = {
    prompt:    { purpose: 'user-authored generation input', retention: 'until user deletes', sensitive: true },
    workflow:  { purpose: 'saved automation graphs', retention: 'until user deletes', sensitive: false },
    media:     { purpose: 'generated/reference media metadata', retention: 'until user deletes', sensitive: false },
    setting:   { purpose: 'user preferences + UI state', retention: 'until changed', sensitive: false },
    session:   { purpose: 'provider tab/session linkage', retention: 'session lifetime', sensitive: true },
    token:     { purpose: 'credentials / license / HMAC', retention: 'until revoked', sensitive: true },
    log:       { purpose: 'diagnostic + tracker events', retention: 'bounded ring buffer', sensitive: true },
    cache:     { purpose: 'recomputable derived data', retention: 'evictable', sensitive: false },
    transient: { purpose: 'short-lived handoff between pages', retention: 'cleared on use', sensitive: false },
    other:     { purpose: 'uncategorized', retention: 'review required', sensitive: true },
  };

  // Ordered key-pattern rules (first match wins). Tuned to the real key corpus.
  var RULES = [
    { cls: 'token', re: /(token|secret|license|hmac|apikey|api_key|credential|password|auth|bearer|fingerprint|entitlement|telegram.*(token|chat)|mcp.*key)/i },
    { cls: 'session', re: /(session|active.?tab|provider.?tab|tabid|window.?id|login|account|heartbeat|active_sidebar)/i },
    { cls: 'prompt', re: /(prompt|angles|instruction|message|caption|script|text.?template)/i },
    { cls: 'workflow', re: /(workflow|drawflow|nodes?|edge|graph|template|pipeline|project|tasks?|running_wf|stopped_wf|execution)/i },
    { cls: 'media', re: /(image|video|media|thumbnail|ref.?image|upload|asset|gallery|download|results?|effects?)/i },
    // `health`: af_selector_health là số liệu chẩn đoán của SelectorDoctor (tỉ lệ hỏng
    // của từng selector), đúng bản chất log/diagnostic — phải đứng TRƯỚC cache.
    { cls: 'log', re: /(log|tracker|history|event|diagnos|telemetry|error|trace|stats?|usage|daily|health)/i },
    // `credits`: af_flow_credits là số dư Flow ĐƯỢC CACHE để mở sidebar thấy ngay
    // (CreditsPanel.js) — quét lại là có, nên evictable chứ không phải dữ liệu gốc.
    { cls: 'cache', re: /(cache|_cached|configs?$|selector.?config|api.?config|voices?|models?|sse|last.?event|fetched|refreshed|credits?)/i },
    { cls: 'transient', re: /^_pending|pending|temp|tmp|handoff|draft|resync/i },
    // `override`: af_selector_overrides là selector do người dùng/dev tự đặt đè lên
    // mặc định (SelectorOverride.js) — đó là tuỳ chọn, giữ đến khi đổi.
    { cls: 'setting', re: /(setting|option|pref|config|mode|enabled|toggle|theme|watermark|cooldown|language|locale|i18n|currency|onboarding|validation|api.?url|api.?base|owner|touched|rules|system|override|flow$)/i },
  ];

  function classify(key, meta) {
    meta = meta || {};
    var cls = 'other';
    for (var i = 0; i < RULES.length; i++) { if (RULES[i].re.test(String(key))) { cls = RULES[i].cls; break; } }
    var base = CLASS_META[cls];
    // The inventory's own sensitivity signal can only ESCALATE, never relax.
    var sensitive = base.sensitive || meta.sensitivity === 'sensitive' || meta.sensitivity === 'secret';
    return { key: key, class: cls, purpose: base.purpose, retention: base.retention, sensitive: sensitive };
  }

  function justified(record) {
    return !!(record && record.class && record.class !== 'other' && record.purpose && record.retention);
  }

  // Classify a whole inventory; returns rows + a summary + the unjustified set.
  function classifyAll(keys) {
    var rows = [].concat(keys || []).map(function (k) {
      return typeof k === 'string' ? classify(k, {}) : classify(k.key, k);
    });
    var byClass = {};
    rows.forEach(function (r) { byClass[r.class] = (byClass[r.class] || 0) + 1; });
    var unjustified = rows.filter(function (r) { return !justified(r); });
    return { total: rows.length, byClass: byClass, unjustified: unjustified, rows: rows };
  }

  global.SEOSONA_DataClassification = {
    CLASS_META: CLASS_META,
    classify: classify,
    justified: justified,
    classifyAll: classifyAll,
    classes: function () { return Object.keys(CLASS_META); },
  };
})(typeof self !== 'undefined' ? self : this);
