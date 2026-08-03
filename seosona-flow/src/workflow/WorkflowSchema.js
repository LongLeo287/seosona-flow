// SEOSONA Flow — Workflow Schema (Phase 5 / P5.T1, AUD-015).
// Classic script. Strict, bounded validation of workflow documents with stable
// issue paths. Structural problems are errors; unknown node types are advisory
// (forward-compatible with new node kinds).
(function (global) {
  'use strict';

  var LIMITS = { maxNodes: 500, maxEdges: 2000, maxName: 200, maxIdLen: 200, maxDepth: 8 };
  var KNOWN_NODE_TYPES = ['image', 'generate', 'prompt', 'chatgpt', 'text', 'note'];
  var DANGEROUS_KEYS = ['__proto__', 'prototype', 'constructor'];

  function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function hasDangerousKey(obj, depth) {
    depth = depth || 0;
    if (depth > LIMITS.maxDepth || !obj || typeof obj !== 'object') return false;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (DANGEROUS_KEYS.indexOf(k) !== -1) return true;
      if (hasDangerousKey(obj[k], depth + 1)) return true;
    }
    return false;
  }

  function validate(wf, opts) {
    opts = opts || {};
    var issues = [];
    function err(path, code) { issues.push({ path: path, code: code, severity: 'error' }); }
    function warn(path, code) { issues.push({ path: path, code: code, severity: 'warn' }); }

    if (!isPlainObject(wf)) {
      return { valid: false, issues: [{ path: '', code: 'NOT_AN_OBJECT', severity: 'error' }], nodeCount: 0, edgeCount: 0 };
    }
    if (hasDangerousKey(wf)) err('', 'DANGEROUS_KEY');

    if (typeof wf.name !== 'string' || wf.name.length === 0) err('name', 'MISSING_NAME');
    else if (wf.name.length > LIMITS.maxName) err('name', 'NAME_TOO_LONG');

    var nodeIds = new Set();
    if (!Array.isArray(wf.nodes)) {
      err('nodes', 'MISSING_NODES');
    } else {
      if (wf.nodes.length > LIMITS.maxNodes) err('nodes', 'TOO_MANY_NODES');
      wf.nodes.forEach(function (n, i) {
        var p = 'nodes[' + i + ']';
        if (!isPlainObject(n)) { err(p, 'NODE_NOT_OBJECT'); return; }
        if (typeof n.id !== 'string' || n.id.length === 0) err(p + '.id', 'MISSING_NODE_ID');
        else if (n.id.length > LIMITS.maxIdLen) err(p + '.id', 'NODE_ID_TOO_LONG');
        else if (nodeIds.has(n.id)) err(p + '.id', 'DUPLICATE_NODE_ID');
        else nodeIds.add(n.id);
        if (typeof n.type !== 'string') err(p + '.type', 'MISSING_NODE_TYPE');
        else if (KNOWN_NODE_TYPES.indexOf(n.type) === -1) warn(p + '.type', 'UNKNOWN_NODE_TYPE');
        if (n.position != null && !(isPlainObject(n.position) && typeof n.position.x === 'number' && typeof n.position.y === 'number')) {
          err(p + '.position', 'INVALID_POSITION');
        }
        if (n.data != null && !isPlainObject(n.data)) err(p + '.data', 'INVALID_DATA');
      });
    }

    if (wf.edges != null) {
      if (!Array.isArray(wf.edges)) {
        err('edges', 'EDGES_NOT_ARRAY');
      } else {
        if (wf.edges.length > LIMITS.maxEdges) err('edges', 'TOO_MANY_EDGES');
        wf.edges.forEach(function (e, i) {
          var p = 'edges[' + i + ']';
          if (!isPlainObject(e)) { err(p, 'EDGE_NOT_OBJECT'); return; }
          if (typeof e.source !== 'string' || !nodeIds.has(e.source)) err(p + '.source', 'DANGLING_SOURCE');
          if (typeof e.target !== 'string' || !nodeIds.has(e.target)) err(p + '.target', 'DANGLING_TARGET');
        });
      }
    }

    var errors = issues.filter(function (x) { return x.severity === 'error'; });
    return {
      valid: errors.length === 0,
      issues: issues,
      errorCount: errors.length,
      warnCount: issues.length - errors.length,
      nodeCount: nodeIds.size,
      edgeCount: Array.isArray(wf.edges) ? wf.edges.length : 0,
    };
  }

  global.SEOSONA_WorkflowSchema = {
    LIMITS: LIMITS,
    KNOWN_NODE_TYPES: KNOWN_NODE_TYPES,
    validate: validate,
  };
})(typeof self !== 'undefined' ? self : this);
