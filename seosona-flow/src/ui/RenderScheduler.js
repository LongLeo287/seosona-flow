// SEOSONA Flow — Render Scheduler (Phase 8 / P8.T7, AUD-025).
// Classic script, headless core for the workflow canvas performance work.
// Coalesces many mutation requests into ONE batched flush per animation frame,
// deduplicates work by key (so pan/zoom spam collapses to the latest state), and
// cancels stale work. The frame scheduler is injected (requestAnimationFrame in
// the browser; a fake in tests) so batching is deterministic and testable.
(function (global) {
  'use strict';

  function create(cfg) {
    cfg = cfg || {};
    // schedule(fn) -> token ; cancel(token). Defaults to a microtask-ish shim.
    var schedule = cfg.schedule;
    var cancel = cfg.cancel || function () {};
    if (typeof schedule !== 'function') {
      schedule = function (fn) { return setTimeout(fn, 0); };
      cancel = function (t) { clearTimeout(t); };
    }

    var pending = new Map(); // key -> latest task (dedupe: last write wins)
    var frameToken = null;
    var stats = { scheduled: 0, flushed: 0, coalesced: 0, frames: 0 };

    function flush() {
      frameToken = null;
      stats.frames++;
      var tasks = Array.from(pending.values());
      pending.clear();
      for (var i = 0; i < tasks.length; i++) {
        stats.flushed++;
        try { tasks[i](); } catch (_) { /* one task's failure must not drop the batch */ }
      }
    }

    // Enqueue work under a key. Re-enqueuing the same key before the next frame
    // replaces the prior task (coalescing) — only the latest state renders.
    function enqueue(key, task) {
      if (typeof task !== 'function') throw new Error('RenderScheduler: task must be a function');
      stats.scheduled++;
      if (pending.has(key)) stats.coalesced++;
      pending.set(key, task);
      if (frameToken == null) frameToken = schedule(flush);
      return key;
    }

    // Cancel pending work for a key (stale-work cancellation).
    function cancelKey(key) { return pending.delete(key); }

    function flushNow() { if (frameToken != null) { cancel(frameToken); } flush(); }

    function clear() {
      if (frameToken != null) { cancel(frameToken); frameToken = null; }
      pending.clear();
    }

    return {
      enqueue: enqueue,
      cancelKey: cancelKey,
      flushNow: flushNow,
      clear: clear,
      pendingCount: function () { return pending.size; },
      stats: function () { return Object.assign({}, stats); },
    };
  }

  global.SEOSONA_RenderScheduler = { create: create };
})(typeof self !== 'undefined' ? self : this);
