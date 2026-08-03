// SEOSONA Flow — Network Service (Phase 4 / P4.T3, AUD-013).
// Classic worker script. The single sanctioned entry for privileged background
// fetches: routes through NetworkPolicy (scheme/private-address/redirect/size
// guards) and returns a typed envelope. Callers migrate onto this incrementally;
// the raw fetch remains until each call site is moved.
(function (global) {
  'use strict';

  function envelope(ok, extra) {
    return Object.assign({ ok: ok }, extra || {});
  }

  function getSafeFetch() {
    var np = global.SEOSONA_NetworkPolicy;
    if (!np || typeof global.fetch !== 'function') return null;
    return np.createSafeFetch(global.fetch);
  }

  // fetchSafe(url, options, ctx) -> Promise<envelope>
  // Never throws for policy denials; returns { ok:false, reason }.
  async function fetchSafe(url, options, ctx) {
    var safeFetch = getSafeFetch();
    if (!safeFetch) {
      // Fail-open to legacy fetch when policy is unavailable (compat).
      if (typeof global.fetch === 'function') {
        try {
          var raw = await global.fetch(url, options);
          return envelope(!!(raw && raw.ok), { status: raw && raw.status, response: raw, policy: 'bypassed' });
        } catch (e) { return envelope(false, { reason: 'FETCH_ERROR', message: e && e.message }); }
      }
      return envelope(false, { reason: 'NO_FETCH' });
    }
    try {
      var resp = await safeFetch(url, options, ctx);
      return envelope(!!(resp && resp.ok), { status: resp && resp.status, response: resp, policy: 'enforced' });
    } catch (e) {
      return envelope(false, { reason: (e && e.reason) || 'FETCH_ERROR', message: e && e.message, policy: 'enforced' });
    }
  }

  // Classify + validate a URL without fetching (for pre-flight checks).
  function inspect(url, ctx) {
    var np = global.SEOSONA_NetworkPolicy;
    if (!np) return { allowed: true, reason: null };
    return np.validateTarget(url, ctx || {});
  }

  global.SEOSONA_NetworkService = {
    fetchSafe: fetchSafe,
    inspect: inspect,
  };
})(typeof self !== 'undefined' ? self : this);
