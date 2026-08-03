// SEOSONA Flow — Lifecycle Coordinator (Phase 4 / P4.T2, AUD-012).
// Classic worker script. Deterministic, ordered dispatch of service-worker
// lifecycle phases (install → startup → wake → alarm → focus). A compatibility
// seam: existing background listeners can migrate onto it incrementally without
// changing observed ordering. Handler errors are isolated (one bad handler does
// not abort the phase).
(function (global) {
  'use strict';

  var PHASES = ['install', 'startup', 'wake', 'alarm', 'focus', 'suspend'];
  var handlers = {};
  var trace = [];

  function on(phase, fn, order) {
    if (PHASES.indexOf(phase) === -1) throw new Error('unknown lifecycle phase: ' + phase);
    if (typeof fn !== 'function') throw new Error('handler must be a function');
    (handlers[phase] = handlers[phase] || []).push({ fn: fn, order: order || 0 });
    return function off() {
      handlers[phase] = (handlers[phase] || []).filter(function (h) { return h.fn !== fn; });
    };
  }

  async function run(phase, ctx) {
    var list = (handlers[phase] || []).slice().sort(function (a, b) { return a.order - b.order; });
    var ran = [];
    for (var i = 0; i < list.length; i++) {
      trace.push(phase);
      try { await list[i].fn(ctx); ran.push('ok'); }
      catch (e) { ran.push('error'); }
    }
    return ran;
  }

  global.SEOSONA_LifecycleCoordinator = {
    PHASES: PHASES,
    on: on,
    run: run,
    count: function (phase) { return (handlers[phase] || []).length; },
    trace: function () { return trace.slice(); },
    reset: function () { handlers = {}; trace = []; },
  };
})(typeof self !== 'undefined' ? self : this);
