// SEOSONA Flow — Health Panel view-model (Phase 10 / P10.T3, AUD-030).
// Classic script, pure. Transforms a HealthService result into a render-ready
// view-model (no DOM). The page binds this to elements; the logic is testable.
(function (global) {
  'use strict';
  var BADGE = { ok: '✓', degraded: '!', error: '✕' };
  function toViewModel(health) {
    health = health || { overall: 'error', checks: [], actions: [] };
    return {
      badge: BADGE[health.overall] || '?',
      overall: health.overall,
      summary: (health.okCount || 0) + '/' + (health.checks ? health.checks.length : 0) + ' healthy',
      rows: (health.checks || []).map(function (c) { return { id: c.id, status: c.status, code: c.code, action: c.action || '—' }; }),
      actionable: (health.actions || []).length,
    };
  }
  global.SEOSONA_HealthPanel = { toViewModel: toViewModel };
})(typeof self !== 'undefined' ? self : this);
