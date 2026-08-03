// SEOSONA Flow — Export Policy (Phase 7 / P7.T6, AUD-022).
// Classic script, pure/headless. Decides what may leave the extension in a
// user export/backup. Default-deny for anything credential-shaped: an explicit
// allowlist of exportable classes PLUS structural secret markers strip nested
// canaries (tokens buried inside otherwise-exportable objects). No credential
// is ever written to an export bundle.
(function (global) {
  'use strict';

  // Classes that may be exported (everything else is dropped by policy).
  var EXPORTABLE_CLASSES = { prompt: true, workflow: true, media: true, setting: true, cache: true, transient: true };

  // Structural markers: object keys whose NAME implies a secret, stripped wherever nested.
  var SECRET_KEY_RE = /(token|secret|license|hmac|apikey|api_key|password|credential|bearer|auth[_-]?key|private[_-]?key|session[_-]?id|chat[_-]?id|refresh)/i;

  // Value-shaped secrets, redacted even under an innocuous key name.
  var SECRET_VALUE_RE = /(eyJ[A-Za-z0-9._-]{10,}|(?:sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9]{16,}|\bBearer\s+[A-Za-z0-9._-]{10,}|\b[0-9a-f]{40,}\b)/;

  function stripSecrets(value) {
    if (value == null) return value;
    if (typeof value === 'string') return SECRET_VALUE_RE.test(value) ? '[REDACTED]' : value;
    if (Array.isArray(value)) return value.map(stripSecrets);
    if (typeof value === 'object') {
      var out = {};
      for (var k in value) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        if (SECRET_KEY_RE.test(k)) continue; // drop the whole nested secret field
        out[k] = stripSecrets(value[k]);
      }
      return out;
    }
    return value;
  }

  // bundle: { key: value }. classifyFn(key) -> { class, sensitive }.
  function sanitizeExport(bundle, classifyFn) {
    bundle = bundle || {};
    var kept = {}, removed = [];
    for (var key in bundle) {
      if (!Object.prototype.hasOwnProperty.call(bundle, key)) continue;
      var info = classifyFn ? classifyFn(key) : { class: 'other', sensitive: true };
      if (!EXPORTABLE_CLASSES[info.class] || info.sensitive) { removed.push({ key: key, reason: info.sensitive ? 'sensitive' : 'non-exportable', class: info.class }); continue; }
      if (SECRET_KEY_RE.test(key)) { removed.push({ key: key, reason: 'secret_key', class: info.class }); continue; }
      kept[key] = stripSecrets(bundle[key]);
    }
    return { bundle: kept, removed: removed };
  }

  function isSecretKey(key) { return SECRET_KEY_RE.test(String(key)); }

  global.SEOSONA_ExportPolicy = {
    EXPORTABLE_CLASSES: EXPORTABLE_CLASSES,
    sanitizeExport: sanitizeExport,
    stripSecrets: stripSecrets,
    isSecretKey: isSecretKey,
  };
})(typeof self !== 'undefined' ? self : this);
