// SEOSONA Flow — Focus Manager (Phase 8 / P8.T3, AUD-023).
// Classic script, DOM-agnostic core. Centralizes deterministic keyboard focus:
// tab-order computation, focus traps for modals, and focus restoration on close.
// The DOM is injected as an array of "focusable descriptors" so the ordering and
// trap logic are unit-testable without a browser; the thin DOM binding (querying
// real elements, calling .focus()) lives in the page and calls into this core.
(function (global) {
  'use strict';

  // A focusable is { id, tabindex?, visible?, disabled?, inCanvas? }.
  function isEligible(f) {
    if (!f) return false;
    if (f.visible === false) return false;
    if (f.disabled === true) return false;
    if (typeof f.tabindex === 'number' && f.tabindex < 0) return false; // -1 = programmatic only
    return true;
  }

  // Deterministic tab order: positive tabindex first (ascending, stable), then
  // DOM order for tabindex 0/undefined. Mirrors the browser's sequential nav.
  function order(focusables) {
    var list = [].concat(focusables || []).filter(isEligible);
    var positive = [], natural = [];
    list.forEach(function (f, i) {
      if (typeof f.tabindex === 'number' && f.tabindex > 0) positive.push({ f: f, i: i });
      else natural.push({ f: f, i: i });
    });
    positive.sort(function (a, b) { return a.f.tabindex - b.f.tabindex || a.i - b.i; });
    return positive.concat(natural).map(function (x) { return x.f; });
  }

  // Next/previous within a trap: wraps at the ends (the trap invariant).
  function step(focusables, currentId, dir) {
    var seq = order(focusables);
    if (seq.length === 0) return null;
    var idx = seq.findIndex(function (f) { return f.id === currentId; });
    if (idx === -1) return dir > 0 ? seq[0] : seq[seq.length - 1];
    var n = (idx + (dir > 0 ? 1 : -1) + seq.length) % seq.length;
    return seq[n];
  }

  // Create a modal focus trap. Records the previously-focused id for restoration.
  function createTrap(focusables, opts) {
    opts = opts || {};
    var seq = order(focusables);
    var previousFocusId = opts.previousFocusId || null;
    var active = true;
    var currentId = seq.length ? seq[0].id : null;

    function onTab(shiftKey) {
      if (!active) return null;
      var nextEl = step(focusables, currentId, shiftKey ? -1 : 1);
      currentId = nextEl ? nextEl.id : currentId;
      return currentId;
    }
    function onEscape() { return close(); }
    function close() {
      active = false;
      return { restoreFocusId: previousFocusId }; // caller focuses the opener
    }
    return {
      firstFocusId: currentId,
      onTab: onTab,
      onEscape: onEscape,
      close: close,
      isActive: function () { return active; },
      current: function () { return currentId; },
    };
  }

  global.SEOSONA_FocusManager = {
    isEligible: isEligible,
    order: order,
    step: step,
    createTrap: createTrap,
  };
})(typeof self !== 'undefined' ? self : this);
