// SEOSONA Flow — Sender Policy (Phase 3 / P3.T2, SEC-001).
// Classic worker script. Authorizes message senders to defend against
// confused-deputy abuse (forged origins, wrong context). Observe-only unless
// the shared SEOSONA_SECURITY_ENFORCE flag is on (mirrors the action registry).
(function (global) {
  'use strict';

  // Origins allowed to reach the extension via onMessageExternal.
  var EXTERNAL_ORIGIN_ALLOWLIST = [
    /^https:\/\/labs\.seosona\.vn([/:]|$)/,
  ];

  function originOf(sender) {
    return (sender && (sender.origin || sender.url)) || '';
  }

  function authorize(sender, opts) {
    opts = opts || {};
    var external = !!opts.external;
    var decision = { allowed: true, reason: null, external: external };

    if (external) {
      var origin = originOf(sender);
      var ok = EXTERNAL_ORIGIN_ALLOWLIST.some(function (re) { return re.test(origin); });
      if (!ok) { decision.allowed = false; decision.reason = 'UNTRUSTED_ORIGIN'; }
      return decision;
    }

    // Internal messages must originate from this extension. In Chrome, a
    // runtime message from our own pages/content scripts carries sender.id ===
    // runtime id. A missing id (test/mocked) is treated as trusted-internal.
    var id = sender && sender.id;
    if (id != null && opts.runtimeId != null && id !== opts.runtimeId) {
      decision.allowed = false;
      decision.reason = 'FOREIGN_SENDER';
    }
    return decision;
  }

  global.SEOSONA_SenderPolicy = {
    authorize: authorize,
    EXTERNAL_ORIGIN_ALLOWLIST: EXTERNAL_ORIGIN_ALLOWLIST,
    isTrustedExternalOrigin: function (origin) {
      return EXTERNAL_ORIGIN_ALLOWLIST.some(function (re) { return re.test(origin || ''); });
    },
  };
})(typeof self !== 'undefined' ? self : this);
