// SEOSONA Flow — Selector Resolver (Phase 6 / P6.T3, AUD-019).
// Classic worker script, DOM-agnostic. Formalizes the copy-pasted
// `_queryWithFallback` / `_getDynamicSelector` block that ChatGPT, Gemini, Grok,
// and Flow each reimplement: read an ordered list of candidate CSS selectors
// from a versioned "selector pack", try them in order, keep only elements that
// pass semantic checks (visible, connected, optionally enabled), and fail with
// a DIAGNOSTIC reason (absent vs hidden vs stale vs ambiguous) instead of
// silently returning null.
//
// The DOM is injected via `opts.query(css) -> element[]` and elements expose
// plain booleans (`visible`, `connected`, `disabled`) so this is fully unit
// testable without a browser. Polling is driven by an injected clock
// (`{ now(), setTimeout() }`) so timeouts are deterministic.
(function (global) {
  'use strict';

  var REASONS = {
    NO_CONFIG: 'no_config',       // selector pack has no entry for the key
    CONFIG_STALE: 'config_stale', // pack older than caller's required version
    ABSENT: 'absent',             // nothing matched any candidate
    HIDDEN: 'hidden',             // matched but not visible
    STALE: 'stale',               // matched but detached from the document
    DISABLED: 'disabled',         // matched + visible but disabled (mustBeEnabled)
    AMBIGUOUS: 'ambiguous',       // multiple usable matches where one expected
    POLL_TIMEOUT: 'poll_timeout', // bounded polling exhausted
  };

  function isConnected(el) { return el && el.connected !== false && el.isConnected !== false; }
  function isVisible(el) {
    if (!el) return false;
    if (el.hidden === true) return false;
    if (el.visible === false) return false;
    return true;
  }
  function isUsable(el, opts) {
    if (!isConnected(el)) return false;
    if (!isVisible(el)) return false;
    if (opts && opts.mustBeEnabled && el.disabled === true) return false;
    return true;
  }

  function create(pack, defaults) {
    pack = pack || { version: 0, selectors: {} };
    defaults = defaults || {};

    function candidates(key) {
      var sel = (pack.selectors || {})[key];
      if (!sel) return [];
      return [].concat(sel).filter(function (s) { return typeof s === 'string' && s; });
    }

    // One resolution pass against the CURRENT DOM snapshot.
    function resolve(key, opts) {
      opts = Object.assign({}, defaults, opts || {});
      var version = pack.version || 0;

      if (opts.minVersion != null && version < opts.minVersion) {
        return { ok: false, reason: REASONS.CONFIG_STALE, key: key, configVersion: version, needVersion: opts.minVersion };
      }
      var list = candidates(key);
      if (list.length === 0) {
        return { ok: false, reason: REASONS.NO_CONFIG, key: key, configVersion: version };
      }
      if (typeof opts.query !== 'function') throw new Error('SelectorResolver: opts.query(css) is required');

      var expect = opts.expect || 'one'; // 'one' | 'first' | 'many'
      var sawHidden = false, sawStale = false, sawDisabled = false;

      for (var i = 0; i < list.length; i++) {
        var selector = list[i];
        var matches = opts.query(selector) || [];
        matches = [].concat(matches);
        if (matches.length === 0) continue;

        var usable = [];
        for (var m = 0; m < matches.length; m++) {
          var el = matches[m];
          if (isUsable(el, opts)) { usable.push(el); continue; }
          if (!isConnected(el)) sawStale = true;
          else if (!isVisible(el)) sawHidden = true;
          else if (opts.mustBeEnabled && el.disabled === true) sawDisabled = true;
        }
        if (usable.length === 0) continue;

        var matched = i === 0 ? 'primary' : 'fallback';
        if (expect === 'many') {
          return { ok: true, elements: usable, selector: selector, index: i, matched: matched, configVersion: version };
        }
        if (usable.length > 1 && expect === 'one') {
          return { ok: false, reason: REASONS.AMBIGUOUS, key: key, selector: selector, count: usable.length, configVersion: version };
        }
        return { ok: true, element: usable[0], selector: selector, index: i, matched: matched, configVersion: version };
      }

      var reason = sawStale ? REASONS.STALE
        : sawDisabled ? REASONS.DISABLED
        : sawHidden ? REASONS.HIDDEN
        : REASONS.ABSENT;
      return { ok: false, reason: reason, key: key, configVersion: version };
    }

    // Bounded polling: re-resolve every intervalMs until success or timeoutMs.
    // `opts.query` is re-invoked each attempt, so it should read live DOM state.
    // Clock is injected: { now(): number, setTimeout(fn, ms): id }.
    function resolvePolling(key, opts) {
      opts = Object.assign({}, defaults, opts || {});
      var clock = opts.clock;
      if (!clock || typeof clock.now !== 'function' || typeof clock.setTimeout !== 'function') {
        throw new Error('SelectorResolver: opts.clock {now,setTimeout} is required for polling');
      }
      var interval = opts.intervalMs > 0 ? opts.intervalMs : 100;
      var timeout = opts.timeoutMs > 0 ? opts.timeoutMs : 1000;
      var deadline = clock.now() + timeout;
      var attempts = 0;

      return new Promise(function (resolveP) {
        function attempt() {
          attempts++;
          var r = resolve(key, opts);
          if (r.ok) { r.attempts = attempts; resolveP(r); return; }
          // CONFIG_STALE / NO_CONFIG are not fixable by waiting — fail fast.
          if (r.reason === REASONS.NO_CONFIG || r.reason === REASONS.CONFIG_STALE) {
            r.attempts = attempts; resolveP(r); return;
          }
          if (clock.now() + interval > deadline) {
            resolveP({ ok: false, reason: REASONS.POLL_TIMEOUT, key: key, attempts: attempts,
              lastReason: r.reason, configVersion: pack.version || 0 });
            return;
          }
          clock.setTimeout(attempt, interval);
        }
        attempt();
      });
    }

    return {
      version: pack.version || 0,
      keys: function () { return Object.keys(pack.selectors || {}); },
      resolve: resolve,
      resolvePolling: resolvePolling,
    };
  }

  global.SEOSONA_SelectorResolver = {
    REASONS: REASONS,
    create: create,
    isUsable: isUsable,
  };
})(typeof self !== 'undefined' ? self : this);
