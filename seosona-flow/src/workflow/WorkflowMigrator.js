// SEOSONA Flow — Workflow Migrator (Phase 5 / P5.T2, AUD-015).
// Classic script. Normalizes untrusted imported workflow JSON and migrates it
// one schema version at a time. On any failure the ORIGINAL is preserved as a
// backup and never mutated. Idempotent for already-current documents.
(function (global) {
  'use strict';

  var CURRENT_VERSION = 1;
  var DANGEROUS_KEYS = ['__proto__', 'prototype', 'constructor'];

  // Deep clone that drops prototype-pollution keys.
  function sanitize(value, depth) {
    depth = depth || 0;
    if (depth > 12 || value == null) return value;
    if (Array.isArray(value)) return value.map(function (v) { return sanitize(v, depth + 1); });
    if (typeof value === 'object') {
      var out = {};
      for (var k in value) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
        if (DANGEROUS_KEYS.indexOf(k) !== -1) continue;
        out[k] = sanitize(value[k], depth + 1);
      }
      return out;
    }
    return value;
  }

  // Migration 0 -> 1: legacy drawflow node map -> array; ensure edges; coerce ids.
  function migrate_0_1(wf) {
    if (wf.nodes && !Array.isArray(wf.nodes) && typeof wf.nodes === 'object') {
      wf.nodes = Object.keys(wf.nodes).map(function (k) { return wf.nodes[k]; });
    }
    if (!Array.isArray(wf.edges)) {
      // accept legacy "connections" key or default empty
      wf.edges = Array.isArray(wf.connections) ? wf.connections : [];
    }
    if (Array.isArray(wf.nodes)) {
      wf.nodes.forEach(function (n) { if (n && n.id != null) n.id = String(n.id); });
    }
    return wf;
  }

  var STEPS = { 0: migrate_0_1 };

  function detectVersion(wf) {
    return typeof wf.schemaVersion === 'number' ? wf.schemaVersion : 0;
  }

  function migrate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'NOT_AN_OBJECT', backup: input };
    }
    var backup = input; // never mutated
    var from = detectVersion(input);
    if (from > CURRENT_VERSION) {
      return { ok: false, error: 'FUTURE_VERSION', from: from, to: CURRENT_VERSION, backup: backup };
    }
    var work = sanitize(input);
    var v = from;
    while (v < CURRENT_VERSION) {
      var step = STEPS[v];
      if (typeof step !== 'function') return { ok: false, error: 'NO_MIGRATION_STEP', from: v, backup: backup };
      try { work = step(work); }
      catch (e) { return { ok: false, error: 'MIGRATION_THREW', message: e && e.message, from: v, backup: backup }; }
      v++;
    }
    work.schemaVersion = CURRENT_VERSION;

    var schema = global.SEOSONA_WorkflowSchema;
    if (schema) {
      var res = schema.validate(work);
      if (!res.valid) {
        return { ok: false, error: 'INVALID_AFTER_MIGRATION', issues: res.issues, from: from, backup: backup };
      }
    }
    return { ok: true, workflow: work, from: from, to: CURRENT_VERSION, backup: backup };
  }

  global.SEOSONA_WorkflowMigrator = {
    CURRENT_VERSION: CURRENT_VERSION,
    migrate: migrate,
    sanitize: sanitize,
  };
})(typeof self !== 'undefined' ? self : this);
