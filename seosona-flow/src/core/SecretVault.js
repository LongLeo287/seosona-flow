// SEOSONA Flow — Secret Vault (Phase 3 / P3.T6, AUD-010).
// Classic worker script. Central registry of credential storage keys and
// redaction/clearing helpers, so secrets are not exported and are cleared on
// logout/revoke.
(function (global) {
  'use strict';

  // Storage keys that hold credentials/secrets.
  var SECRET_KEYS = [
    'af_active_session', 'af_auth', 'af_bearer', 'af_entitlements',
    'af_fingerprint', 'entitlements', 'local_mcp_tokens', 'mcp_bearer',
    'seosona_client_enrollment', 'seosona_device_fp', 'seosonaflow_extension_not_authorized', 'telegram_bot_token',
    'token',
  ];
  var SECRET_FIELD_RE = /(token|secret|bearer|password|passwd|apikey|api_key|hmac|signature|client_secret|authorization|credential|private_key)/i;

  function isSecretKey(k) { return SECRET_KEYS.indexOf(k) !== -1; }
  function isSecretField(name) { return SECRET_FIELD_RE.test(String(name || '')); }

  function redact(value, depth) {
    depth = depth || 0;
    if (depth > 8 || value == null) return value;
    if (Array.isArray(value)) return value.map(function (v) { return redact(v, depth + 1); });
    if (typeof value === 'object') {
      var out = {};
      for (var k in value) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
        out[k] = (isSecretField(k) || isSecretKey(k)) ? '[REDACTED]' : redact(value[k], depth + 1);
      }
      return out;
    }
    return value;
  }

  // Scan an export payload for secret markers. { safe, offending:[paths] }
  function auditExport(value, path, acc) {
    acc = acc || [];
    path = path || '';
    if (value == null) return { safe: acc.length === 0, offending: acc };
    if (Array.isArray(value)) {
      value.forEach(function (v, i) { auditExport(v, path + '[' + i + ']', acc); });
    } else if (typeof value === 'object') {
      for (var k in value) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
        if (isSecretField(k) || isSecretKey(k)) acc.push(path ? path + '.' + k : k);
        else auditExport(value[k], path ? path + '.' + k : k, acc);
      }
    }
    return { safe: acc.length === 0, offending: acc };
  }

  // Remove every secret key from a storage area (logout/revoke). Returns a promise.
  function clearAll(storageArea) {
    if (!storageArea || !storageArea.remove) return Promise.resolve(false);
    try {
      var r = storageArea.remove(SECRET_KEYS);
      return r && typeof r.then === 'function' ? r : Promise.resolve(true);
    } catch (_) { return Promise.resolve(false); }
  }

  global.SEOSONA_SecretVault = {
    SECRET_KEYS: SECRET_KEYS,
    isSecretKey: isSecretKey,
    isSecretField: isSecretField,
    redact: redact,
    auditExport: auditExport,
    clearAll: clearAll,
  };
})(typeof self !== 'undefined' ? self : this);
