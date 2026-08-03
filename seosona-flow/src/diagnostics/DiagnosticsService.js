// SEOSONA Flow — Diagnostics Service (Phase 10 / P10.T2, AUD-030).
// Classic script, headless. Builds a LOCAL, checksummed diagnostics bundle the
// user can save and share manually — NEVER auto-uploaded. Everything is
// privacy-filtered (no prompts, tokens, provider content), size-bounded, and
// corruption-tolerant. A `preview` shows what would be exported before the user
// opts in. No Date — the caller stamps time.
(function (global) {
  'use strict';

  var SCHEMA = 'seosona.diagnostics.bundle.v1';
  var MAX_BYTES = 512 * 1024; // 512 KiB hard cap

  function stableStringify(v) {
    return JSON.stringify(v, function (k, val) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        return Object.keys(val).sort().reduce(function (o, key) { o[key] = val[key]; return o; }, {});
      }
      return val;
    });
  }

  // FNV-1a checksum over the canonical body (integrity, not security).
  function checksum(str) {
    var s = String(str), h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function create(cfg) {
    cfg = cfg || {};
    var pf = cfg.privacyFilter || global.SEOSONA_PrivacyFilter || null;
    var scrub = function (v) { return pf ? pf.filter(v, { keepContent: false }) : v; };

    // Build the body from injected providers (all optional, corruption-tolerant).
    function sections(opts) {
      opts = opts || {};
      function safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }
      return {
        version: safe(function () { return String(cfg.version || (opts.version) || 'unknown'); }, 'unknown'),
        permissions: safe(function () { return scrub(cfg.permissions ? cfg.permissions() : opts.permissions || []); }, []),
        mode: safe(function () { return String(cfg.mode ? cfg.mode() : opts.mode || 'local'); }, 'local'),
        health: safe(function () { return cfg.health ? cfg.health() : (opts.health || null); }, null),
        recentErrors: safe(function () { return scrub((cfg.logger && cfg.logger.recent ? cfg.logger.recent(20) : opts.errors || []).filter(function (e) { return e && (e.severity === 'error' || e.severity === 'warn'); })); }, []),
        adapters: safe(function () { return scrub(cfg.adapters ? cfg.adapters() : opts.adapters || []); }, []),
        storageHealth: safe(function () { return scrub(cfg.storageHealth ? cfg.storageHealth() : opts.storageHealth || null); }, null),
      };
    }

    function buildBundle(opts) {
      var body = sections(opts);
      var canonical = stableStringify(body);
      var truncated = false;
      if (canonical.length > MAX_BYTES) { truncated = true; body.recentErrors = (body.recentErrors || []).slice(0, 5); canonical = stableStringify(body); }
      return {
        schema: SCHEMA,
        generatedAt: typeof (opts && opts.at) === 'number' ? opts.at : null,
        truncated: truncated,
        checksum: checksum(canonical),
        bytes: canonical.length,
        body: body,
      };
    }

    // A short preview: what sections + how big, WITHOUT the full payload — shown
    // before the user opts into exporting.
    function preview(opts) {
      var b = buildBundle(opts);
      return { schema: SCHEMA, sections: Object.keys(b.body), bytes: b.bytes, checksum: b.checksum, upload: 'never (local export only)' };
    }

    return { buildBundle: buildBundle, preview: preview, MAX_BYTES: MAX_BYTES };
  }

  global.SEOSONA_DiagnosticsService = { SCHEMA: SCHEMA, create: create, checksum: checksum };
})(typeof self !== 'undefined' ? self : this);
