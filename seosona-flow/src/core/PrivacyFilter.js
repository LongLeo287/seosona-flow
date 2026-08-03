// SEOSONA Flow — Privacy Filter (Phase 7 / P7.T7, AUD-021).
// Classic script, pure/headless. The single redaction pass for anything headed
// to logs, diagnostics, or exports. Defaults to METADATA: prompts/responses/DOM
// are dropped to shape descriptors; URLs lose their query; emails/handles/tokens
// are redacted; identifiers are hashed to stable opaque ids. Canary values must
// never survive a filter pass.
(function (global) {
  'use strict';

  var TOKEN_RE = [
    /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    /eyJ[A-Za-z0-9._-]{10,}/g,
    /(?:sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9]{16,}/g,
    /\b[0-9a-f]{40,}\b/gi,
  ];
  var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  var HANDLE_RE = /(^|\s)@[A-Za-z0-9_]{2,}/g;

  // Fields whose VALUES are free-form user content — reduced to a shape descriptor.
  var CONTENT_KEYS = /^(prompt|response|message|text|caption|content|html|dom|instruction|body|answer|reply)$/i;

  function scrubString(s) {
    var out = String(s);
    for (var i = 0; i < TOKEN_RE.length; i++) out = out.replace(TOKEN_RE[i], '[REDACTED]');
    out = out.replace(EMAIL_RE, '<email>');
    out = out.replace(HANDLE_RE, '$1<handle>');
    // Strip URL query/fragment (tokens ride there); keep origin+path shape.
    out = out.replace(/(https?:\/\/[^\s"'?#]+)[?#]\S*/gi, '$1?<redacted>');
    return out;
  }

  // Stable non-reversible id — FNV-1a hash, prefixed. No secret input survives.
  function hashId(s) {
    var str = String(s);
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return 'id_' + ('00000000' + h.toString(16)).slice(-8);
  }

  function describeContent(v) {
    if (typeof v === 'string') return { kind: 'text', length: v.length };
    if (Array.isArray(v)) return { kind: 'array', length: v.length };
    if (v && typeof v === 'object') return { kind: 'object', keys: Object.keys(v).length };
    return { kind: typeof v };
  }

  // Depth-bounded filter. Content-keys become descriptors; everything else scrubbed.
  function filter(value, opts) {
    opts = opts || {};
    var depth = opts.depth == null ? 6 : opts.depth;
    function walk(v, d, keyName) {
      if (keyName && CONTENT_KEYS.test(keyName) && opts.keepContent !== true) return describeContent(v);
      if (v == null) return v;
      if (typeof v === 'string') return scrubString(v);
      if (typeof v === 'number' || typeof v === 'boolean') return v;
      if (d <= 0) return '[DEPTH]';
      if (Array.isArray(v)) return v.slice(0, 100).map(function (x) { return walk(x, d - 1, null); });
      if (typeof v === 'object') {
        var out = {};
        for (var k in v) {
          if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
          if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
          out[k] = walk(v[k], d - 1, k);
        }
        return out;
      }
      return '[UNSERIALIZABLE]';
    }
    return walk(value, depth, opts.rootKey || null);
  }

  global.SEOSONA_PrivacyFilter = {
    filter: filter,
    scrubString: scrubString,
    hashId: hashId,
    describeContent: describeContent,
    CONTENT_KEYS: CONTENT_KEYS,
  };
})(typeof self !== 'undefined' ? self : this);
