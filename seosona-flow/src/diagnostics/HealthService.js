// SEOSONA Flow — Health Service (Phase 10 / P10.T3, AUD-030).
// Classic script, pure/headless. Computes LOCAL health from injected probe
// results with stable codes and a recovery action per check. Deterministic:
// same input → same output. No network, no Date. The UI (HealthPanel) renders
// the result; nothing is uploaded.
(function (global) {
  'use strict';

  var STATUS = { OK: 'ok', DEGRADED: 'degraded', ERROR: 'error' };

  // Ordered checks with stable codes + recovery actions.
  var CHECKS = [
    { id: 'storage', code: 'H_STORAGE', action: 'clear cache or free quota' },
    { id: 'workflows', code: 'H_WORKFLOWS', action: 'validate or repair saved workflows' },
    { id: 'providers', code: 'H_PROVIDERS', action: 'reopen provider tab / re-login' },
    { id: 'permissions', code: 'H_PERMISSIONS', action: 'grant required host permission' },
    { id: 'mode', code: 'H_MODE', action: 'confirm local/online mode' },
    { id: 'network', code: 'H_NETWORK', action: 'check connectivity (online mode only)' },
    { id: 'assets', code: 'H_ASSETS', action: 'reinstall extension assets' },
    { id: 'version', code: 'H_VERSION', action: 'reconcile version + run migration' },
    { id: 'migration', code: 'H_MIGRATION', action: 'complete pending data migration' },
  ];

  function normStatus(v) {
    if (v === true || v === STATUS.OK) return STATUS.OK;
    if (v === STATUS.DEGRADED) return STATUS.DEGRADED;
    return STATUS.ERROR;
  }

  // probes: { checkId: true|false|'ok'|'degraded'|'error' } (missing → degraded/unknown).
  function evaluate(probes) {
    probes = probes || {};
    var rows = CHECKS.map(function (c) {
      var raw = Object.prototype.hasOwnProperty.call(probes, c.id) ? probes[c.id] : 'degraded';
      var status = normStatus(raw);
      return { id: c.id, status: status, code: c.code, action: status === STATUS.OK ? null : c.action };
    });
    var worst = STATUS.OK;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].status === STATUS.ERROR) { worst = STATUS.ERROR; break; }
      if (rows[i].status === STATUS.DEGRADED) worst = STATUS.DEGRADED;
    }
    return {
      overall: worst,
      okCount: rows.filter(function (r) { return r.status === STATUS.OK; }).length,
      checks: rows,
      actions: rows.filter(function (r) { return r.action; }).map(function (r) { return { id: r.id, code: r.code, action: r.action }; }),
    };
  }

  global.SEOSONA_HealthService = { STATUS: STATUS, CHECKS: CHECKS, evaluate: evaluate };
})(typeof self !== 'undefined' ? self : this);
