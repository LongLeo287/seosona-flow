// SEOSONA Flow — Execution State Machine (Phase 5 / P5.T3, AUD-016).
// Classic script. Pure reducer over an append-only event log. Hard-terminal
// states (completed/cancelled/skipped) can never transition again; failed is
// retryable. Illegal transitions are rejected without mutating state.
(function (global) {
  'use strict';

  var STATES = ['idle', 'running', 'paused', 'failed', 'completed', 'cancelled', 'skipped'];
  var HARD_TERMINAL = ['completed', 'cancelled', 'skipped'];

  var TRANSITIONS = {
    idle: { START: 'running', CANCEL: 'cancelled', SKIP: 'skipped' },
    running: { PAUSE: 'paused', COMPLETE: 'completed', FAIL: 'failed', CANCEL: 'cancelled' },
    paused: { RESUME: 'running', CANCEL: 'cancelled', FAIL: 'failed' },
    failed: { RETRY: 'running', CANCEL: 'cancelled' },
    completed: {},
    cancelled: {},
    skipped: {},
  };

  function isTerminal(status) { return HARD_TERMINAL.indexOf(status) !== -1; }

  // Pure: (status, event) -> { status, changed, reason }
  function reduce(status, event) {
    var table = TRANSITIONS[status];
    if (!table) return { status: status, changed: false, reason: 'UNKNOWN_STATE' };
    var next = table[event];
    if (!next) {
      return { status: status, changed: false, reason: isTerminal(status) ? 'TERMINAL' : 'ILLEGAL_TRANSITION' };
    }
    return { status: next, changed: true, reason: null };
  }

  // Stateful wrapper with an append-only history.
  function create(initial) {
    var status = initial || 'idle';
    if (STATES.indexOf(status) === -1) throw new Error('invalid initial state: ' + status);
    var history = [];
    var seq = 0;

    function dispatch(event, meta) {
      var r = reduce(status, event);
      var entry = { seq: ++seq, event: event, from: status, to: r.status, applied: r.changed, reason: r.reason, meta: meta || null };
      history.push(entry);
      if (r.changed) status = r.status;
      return { status: status, applied: r.changed, reason: r.reason };
    }

    return {
      dispatch: dispatch,
      status: function () { return status; },
      isTerminal: function () { return isTerminal(status); },
      history: function () { return history.slice(); },
    };
  }

  global.SEOSONA_ExecutionStateMachine = {
    STATES: STATES,
    HARD_TERMINAL: HARD_TERMINAL,
    TRANSITIONS: TRANSITIONS,
    isTerminal: isTerminal,
    reduce: reduce,
    create: create,
  };
})(typeof self !== 'undefined' ? self : this);
