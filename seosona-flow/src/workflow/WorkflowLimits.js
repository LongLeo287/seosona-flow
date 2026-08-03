// SEOSONA Flow — Workflow Limits (Phase 5 / P5.T7, AUD-017).
// Classic script. Rejects unsafe graphs BEFORE allocation/execution: node/edge
// counts, prompt/ref sizes, estimated media outputs, graph depth, and cycles
// (workflows must be a DAG). Fails fast and cleanly.
(function (global) {
  'use strict';

  var LIMITS = {
    maxNodes: 300,
    maxEdges: 1200,
    maxPromptLength: 8000,
    maxRefImages: 12,
    maxTotalOutputs: 500,
    maxDepth: 64,
  };

  function buildAdjacency(nodes, edges) {
    var ids = new Set(nodes.map(function (n) { return n && n.id; }));
    var adj = {};
    ids.forEach(function (id) { adj[id] = []; });
    (edges || []).forEach(function (e) {
      if (e && ids.has(e.source) && ids.has(e.target)) adj[e.source].push(e.target);
    });
    return adj;
  }

  // Iterative DFS cycle detection over a directed graph.
  function hasCycle(adj) {
    var WHITE = 0, GRAY = 1, BLACK = 2;
    var color = {};
    Object.keys(adj).forEach(function (k) { color[k] = WHITE; });
    for (var start in adj) {
      if (color[start] !== WHITE) continue;
      var stack = [[start, 0]];
      while (stack.length) {
        var top = stack[stack.length - 1];
        var node = top[0];
        color[node] = GRAY;
        if (top[1] < adj[node].length) {
          var next = adj[node][top[1]++];
          if (color[next] === GRAY) return true;
          if (color[next] === WHITE) stack.push([next, 0]);
        } else {
          color[node] = BLACK;
          stack.pop();
        }
      }
    }
    return false;
  }

  function longestPath(adj) {
    // Only meaningful for a DAG; returns 0 if a cycle is present.
    if (hasCycle(adj)) return Infinity;
    var memo = {};
    function dfs(node) {
      if (memo[node] != null) return memo[node];
      var best = 0;
      (adj[node] || []).forEach(function (n) { best = Math.max(best, 1 + dfs(n)); });
      return (memo[node] = best);
    }
    var max = 0;
    for (var k in adj) max = Math.max(max, dfs(k));
    return max;
  }

  function check(wf, opts) {
    opts = opts || {};
    var L = Object.assign({}, LIMITS, opts.limits || {});
    var violations = [];
    function v(code, detail) { violations.push({ code: code, detail: detail }); }

    var nodes = Array.isArray(wf && wf.nodes) ? wf.nodes : [];
    var edges = Array.isArray(wf && wf.edges) ? wf.edges : [];

    if (nodes.length > L.maxNodes) v('TOO_MANY_NODES', nodes.length);
    if (edges.length > L.maxEdges) v('TOO_MANY_EDGES', edges.length);

    var totalOutputs = 0;
    nodes.forEach(function (n, i) {
      var d = (n && n.data) || {};
      if (typeof d.prompt === 'string' && d.prompt.length > L.maxPromptLength) v('PROMPT_TOO_LONG', 'nodes[' + i + ']');
      if (Array.isArray(d.ref_img_urls) && d.ref_img_urls.length > L.maxRefImages) v('TOO_MANY_REF_IMAGES', 'nodes[' + i + ']');
      var qty = typeof d.quantity === 'number' ? d.quantity : 1;
      totalOutputs += Math.max(0, qty);
    });
    if (totalOutputs > L.maxTotalOutputs) v('TOO_MANY_OUTPUTS', totalOutputs);

    var adj = buildAdjacency(nodes, edges);
    if (hasCycle(adj)) v('CYCLE', 'workflow graph must be acyclic');
    else if (longestPath(adj) > L.maxDepth) v('TOO_DEEP', longestPath(adj));

    return { ok: violations.length === 0, violations: violations, totalOutputs: totalOutputs };
  }

  global.SEOSONA_WorkflowLimits = {
    LIMITS: LIMITS,
    check: check,
    hasCycle: function (nodes, edges) { return hasCycle(buildAdjacency(nodes || [], edges || [])); },
  };
})(typeof self !== 'undefined' ? self : this);
