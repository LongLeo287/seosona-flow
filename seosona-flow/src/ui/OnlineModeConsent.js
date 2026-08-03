// SEOSONA Flow — Online Mode Consent (Phase 7 / P7.T3, AUD-021).
// Classic script, pure/headless. Local-first is the default; going online is an
// explicit, VERSIONED, informed opt-in that is immediately reversible. This is
// the pure decision core (no DOM): the settings UI renders `transmittedSummary`
// and calls grant()/revoke(); the runtime asks canGoOnline() before any
// first-party backend traffic.
(function (global) {
  'use strict';

  // Bump when the set/purpose of transmitted data changes — invalidates prior consent.
  var POLICY_VERSION = 1;

  // Exactly what online mode may transmit — shown to the user before opt-in.
  var TRANSMITTED = [
    { field: 'license_key', purpose: 'validate a paid activation', direction: 'to-backend' },
    { field: 'extension_version', purpose: 'compatibility + update checks', direction: 'to-backend' },
    { field: 'provider_selector_configs', purpose: 'receive updated provider selectors', direction: 'from-backend' },
  ];

  var REASONS = {
    OK: 'ok',
    NO_CONSENT: 'no_consent',
    REVOKED: 'revoked',
    STALE_CONSENT: 'stale_consent', // policy changed since consent → re-consent required
  };

  function evaluate(consent, policyVersion) {
    var pv = policyVersion == null ? POLICY_VERSION : policyVersion;
    if (!consent || consent.granted !== true) return { online: false, reason: REASONS.NO_CONSENT };
    if (consent.revoked === true) return { online: false, reason: REASONS.REVOKED };
    if (consent.version !== pv) return { online: false, reason: REASONS.STALE_CONSENT };
    return { online: true, reason: REASONS.OK };
  }

  function canGoOnline(consent, policyVersion) { return evaluate(consent, policyVersion).online; }

  // Produce a fresh consent record. `at` is caller-supplied epoch (no Date here).
  function grant(policyVersion, at) {
    var pv = policyVersion == null ? POLICY_VERSION : policyVersion;
    return { granted: true, revoked: false, version: pv, grantedAt: typeof at === 'number' ? at : null };
  }

  // Immediate, reversible disable — the rollback posture.
  function revoke(consent) {
    var base = consent && typeof consent === 'object' ? consent : { granted: false, version: POLICY_VERSION };
    return { granted: base.granted === true, revoked: true, version: base.version, grantedAt: base.grantedAt || null };
  }

  function needsReconsent(consent, policyVersion) {
    var pv = policyVersion == null ? POLICY_VERSION : policyVersion;
    return !consent || consent.granted !== true || consent.revoked === true || consent.version !== pv;
  }

  function transmittedSummary() { return TRANSMITTED.map(function (t) { return { field: t.field, purpose: t.purpose, direction: t.direction }; }); }

  global.SEOSONA_OnlineModeConsent = {
    POLICY_VERSION: POLICY_VERSION,
    REASONS: REASONS,
    evaluate: evaluate,
    canGoOnline: canGoOnline,
    grant: grant,
    revoke: revoke,
    needsReconsent: needsReconsent,
    transmittedSummary: transmittedSummary,
  };
})(typeof self !== 'undefined' ? self : this);
