// SEOSONA Flow — API Origin Policy (Phase 3 / P3.T5, AUD-010).
// Classic worker script. Ensures credentialed API calls only reach approved
// HTTPS origins (or dev localhost). Cleartext-remote and unapproved origins are
// rejected, and secrets are never allowed to leave over an unsafe channel.
(function (global) {
  'use strict';

  var APPROVED_HOST_RE = [/(^|\.)seosona\.vn$/];
  var LOCALHOST = ['localhost', '127.0.0.1', '::1'];

  function isLocalhost(host) { return LOCALHOST.indexOf((host || '').toLowerCase()) !== -1; }
  function isApprovedHost(host) {
    return APPROVED_HOST_RE.some(function (re) { return re.test((host || '').toLowerCase()); });
  }

  // decision: { allowed, reason, secretSafe }
  function validate(urlString, opts) {
    opts = opts || {};
    var allowDevLocalhost = opts.allowDevLocalhost !== false; // default allow in dev
    var url;
    try { url = new URL(urlString); } catch (_) { return { allowed: false, reason: 'INVALID_URL', secretSafe: false }; }
    var host = url.hostname;
    var https = url.protocol === 'https:';
    var http = url.protocol === 'http:';

    if (isLocalhost(host)) {
      if (http && !allowDevLocalhost) return { allowed: false, reason: 'DEV_LOCALHOST_DISABLED', secretSafe: false };
      // localhost dev is trusted-local; secrets permitted for dev backend.
      return { allowed: true, reason: null, secretSafe: true };
    }
    if (!isApprovedHost(host)) return { allowed: false, reason: 'UNAPPROVED_ORIGIN', secretSafe: false };
    if (http) return { allowed: false, reason: 'CLEARTEXT_REMOTE', secretSafe: false };
    if (!https) return { allowed: false, reason: 'DISALLOWED_SCHEME', secretSafe: false };
    return { allowed: true, reason: null, secretSafe: true };
  }

  function canCarrySecret(urlString, opts) {
    return validate(urlString, opts).secretSafe === true;
  }

  // Strict headers for credentialed requests (no third-party leakage).
  function secureHeaders(base) {
    return Object.assign({ 'X-Requested-With': 'SEOSONA-Flow' }, base || {});
  }

  global.SEOSONA_ApiOriginPolicy = {
    validate: validate,
    canCarrySecret: canCarrySecret,
    secureHeaders: secureHeaders,
    isApprovedHost: isApprovedHost,
    isLocalhost: isLocalhost,
  };
})(typeof self !== 'undefined' ? self : this);
