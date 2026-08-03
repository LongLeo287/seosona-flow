// SEOSONA Flow — Execution Cancellation (Phase 5 / P5.T5, AUD-016).
// Classic script. Propagates AbortSignal + deadlines and runs idempotent
// cleanup so a cancelled workflow settles with no live work. Cleanup handlers
// run exactly once even if cancel() is called multiple times.
(function (global) {
  'use strict';

  var AbortCtor = (typeof AbortController !== 'undefined') ? AbortController : null;

  function create(opts) {
    opts = opts || {};
    var controller = AbortCtor ? new AbortCtor() : { signal: { aborted: false }, abort: function () { this.signal.aborted = true; } };
    var cleanups = [];
    var cleaned = false;
    var cancelled = false;
    var reason = null;
    var deadlineTimer = null;

    function onCleanup(fn) {
      if (typeof fn === 'function') cleanups.push(fn);
      return function off() { cleanups = cleanups.filter(function (f) { return f !== fn; }); };
    }

    function runCleanup() {
      if (cleaned) return Promise.resolve();
      cleaned = true;
      var list = cleanups.slice();
      cleanups = [];
      return list.reduce(function (p, fn) {
        return p.then(function () { return Promise.resolve().then(fn).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionCancellation#runCleanup', _e); }); });
      }, Promise.resolve());
    }

    function cancel(r) {
      if (cancelled) return Promise.resolve();
      cancelled = true;
      reason = r || 'CANCELLED';
      if (deadlineTimer != null) { clearTimeout(deadlineTimer); deadlineTimer = null; }
      try { controller.abort(); } catch (_) { /* already aborted */ }
      return runCleanup();
    }

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      deadlineTimer = setTimeout(function () { cancel('DEADLINE'); }, opts.timeoutMs);
    }

    return {
      signal: controller.signal,
      onCleanup: onCleanup,
      runCleanup: runCleanup,
      cancel: cancel,
      isCancelled: function () { return cancelled; },
      reason: function () { return reason; },
      throwIfCancelled: function () { if (cancelled) { var e = new Error('cancelled: ' + reason); e.cancelled = true; throw e; } },
    };
  }

  global.SEOSONA_ExecutionCancellation = { create: create };
})(typeof self !== 'undefined' ? self : this);
