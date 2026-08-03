// SEOSONA Flow — Redacting Logger (Phase 3 / P3.T6, AUD-010).
// Classic worker script. Wraps a console-like sink and strips credential-shaped
// substrings before they reach logs/diagnostics.
(function (global) {
  'use strict';

  var PATTERNS = [
    /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,        // Authorization bearer
    /eyJ[A-Za-z0-9._-]{10,}/g,                // JWT
    /(?:sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9]{16,}/g, // provider API keys
    /\b[0-9a-f]{40,}\b/gi,                    // long hex secrets/HMAC
  ];

  function redactString(s) {
    var out = String(s);
    for (var i = 0; i < PATTERNS.length; i++) out = out.replace(PATTERNS[i], '[REDACTED]');
    return out;
  }

  function redactArg(a) {
    if (typeof a === 'string') return redactString(a);
    if (a && typeof a === 'object') {
      try {
        var vault = global.SEOSONA_SecretVault;
        var cleaned = vault ? vault.redact(a) : a;
        return JSON.parse(redactString(JSON.stringify(cleaned)));
      } catch (_) { return '[UNSERIALIZABLE]'; }
    }
    return a;
  }

  function create(sink) {
    sink = sink || (typeof console !== 'undefined' ? console : { log: function () {} });
    function wrap(level) {
      return function () {
        var args = Array.prototype.slice.call(arguments).map(redactArg);
        if (typeof sink[level] === 'function') sink[level].apply(sink, args);
      };
    }
    return { log: wrap('log'), info: wrap('info'), warn: wrap('warn'), error: wrap('error'), debug: wrap('debug') };
  }

  global.SEOSONA_RedactingLogger = {
    create: create,
    redactString: redactString,
    PATTERNS: PATTERNS,
  };
})(typeof self !== 'undefined' ? self : this);
