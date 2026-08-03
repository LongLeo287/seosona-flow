// Phase 0/1/3 Spaces overhaul — logic tests.
// Verifies the ALGORITHMS of the copy-isolation + node-count + progress fixes, and anchors them to
// the real source (predicate-presence regression guards). A full UI test needs Chrome load-unpacked;
// this covers the pure logic that the risky fixes depend on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// seosona-flow package root = two levels up from tests/unit/.
const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const listSrc = readFileSync(join(PKG, 'src/workflow/WorkflowList.js'), 'utf8');
const tabSrc = readFileSync(join(PKG, 'src/workflow/WorkflowTab.js'), 'utf8');
const execSrc = readFileSync(join(PKG, 'src/core/WorkflowExecutor.js'), 'utf8');

// ---------- Phase 0: node-count resolver (never progress_total) ----------
// Faithful reproduction of WorkflowList._getNodeCount priority.
function getNodeCount(wf) {
  if (!wf) return 0;
  if (typeof wf._nodeCount === 'number') return wf._nodeCount;
  return (wf.nodes?.length ?? wf.nodes_count ?? 0);
}

test('Phase0: node-count prefers _nodeCount (af_nodes count), never progress_total', () => {
  // Clone/never-run: progress_total=0 but 5 real nodes → must show 5, not 0.
  assert.equal(getNodeCount({ _nodeCount: 5, progress_total: 0 }), 5);
  assert.equal(getNodeCount({ nodes_count: 3, progress_total: 0 }), 3);
  assert.equal(getNodeCount({ nodes: [{}, {}], progress_total: 0 }), 2);
  assert.equal(getNodeCount({ progress_total: 9 }), 0); // no real source → 0, NOT progress_total
});

test('Phase0: source uses _getNodeCount and dropped progress_total-as-nodecount', () => {
  assert.match(listSrc, /_getNodeCount\s*\(workflow\)/);
  assert.match(listSrc, /const nodeCount = this\._getNodeCount\(workflow\)/);
  // The old bug line must be gone.
  assert.doesNotMatch(listSrc, /const nodeCount = workflow\.progress_total \|\| 0/);
});

// ---------- Phase 1: progress % from completed/total (not undefined `progress`) ----------
function progressPct(wf) {
  if (wf.status !== 'running') return null; // hidden
  return wf.progress_total > 0
    ? Math.round((wf.progress_completed || 0) / wf.progress_total * 100)
    : 0;
}

test('Phase1: running card computes % from progress_completed/total', () => {
  assert.equal(progressPct({ status: 'running', progress_completed: 2, progress_total: 5 }), 40);
  assert.equal(progressPct({ status: 'running', progress_completed: 0, progress_total: 0 }), 0);
  assert.equal(progressPct({ status: 'idle', progress_completed: 2, progress_total: 5 }), null);
});

test('Phase1: source no longer reads the never-set workflow.progress field for the bar', () => {
  // The flicker root: `workflow.progress !== undefined`. Must be gone from the rerender path.
  assert.doesNotMatch(listSrc, /workflow\.progress !== undefined/);
  // execution:progress must push progress into the in-mem array (Flows overlay source).
  assert.match(listSrc, /wf\.progress_completed = completed/);
  assert.match(listSrc, /wf\.progress_total = total/);
});

// ---------- Phase 3: My Spaces / Flows membership filters ----------
// NOTE (Tier-2 QĐ-3): đợt UX sau đã "gộp Flows vào My Spaces + ẩn subtab Flows". Hệ quả: My Spaces
// KHÔNG còn lọc bỏ flow_kind='flow' (exclusion cũ bị gỡ → copy hiện cả ở My Spaces). Copy-isolation
// giờ dựa vào (a) DATA layer: copyWorkflowRecord tạo id mới không trùng (test bên dưới), (b) Flows
// LAUNCHER vẫn lọc flow_kind==='flow'. Test cập nhật theo thực tại này.
const flowsLauncherVisible = (w) => w.flow_kind === 'flow';

test('Phase3: Flows launcher filter chỉ nhận bản copy (flow_kind==="flow")', () => {
  assert.equal(flowsLauncherVisible({ wf_id: 'a', flow_kind: undefined }), false); // gốc
  assert.equal(flowsLauncherVisible({ wf_id: 'b', flow_kind: 'space' }), false);   // saved-back
  assert.equal(flowsLauncherVisible({ wf_id: 'c', flow_kind: 'flow' }), true);     // copy
});

test('Phase3: source — Flows launcher filter còn; My Spaces exclusion đã gỡ (Tier-2 merge)', () => {
  assert.match(tabSrc, /const okKind = w\.flow_kind === 'flow'/); // Flows launcher: còn
  // My Spaces exclusion cũ (filter flow_kind!=='flow') đã bị Tier-2 gỡ → KHÔNG còn ở dạng .filter().
  assert.doesNotMatch(listSrc, /this\.workflows\.filter\(w => w\.flow_kind !== 'flow'\)/);
});

// ---------- Phase 3: copy-isolation — deep copy produces fresh, non-overlapping ids ----------
// Faithful reproduction of copyWorkflowRecord id-remap.
let idc = 0;
const nextId = (p) => `${p}_${++idc}`;
function copyWorkflowRecord(src, extraMeta = {}) {
  const newWfId = nextId('wf');
  const nodeIdMap = {};
  const newNodes = (src.nodes || []).map((node) => {
    const nid = nextId('node');
    nodeIdMap[node.node_id] = nid;
    return {
      ...node, node_id: nid, wf_id: newWfId, status: 'pending',
      result_text: '', result_file_ids: '', error_message: '', executed_at: null,
    };
  });
  for (const c of newNodes) {
    if (c.frame_1_source && c.frame_1_source !== 'manual' && c.frame_1_source !== '') c.frame_1_source = nodeIdMap[c.frame_1_source] || c.frame_1_source;
  }
  const newEdges = (src.edges || []).map((e) => ({
    ...e, edge_id: nextId('edge'), wf_id: newWfId,
    source_node_id: nodeIdMap[e.source_node_id] || e.source_node_id,
    target_node_id: nodeIdMap[e.target_node_id] || e.target_node_id,
  }));
  const meta = { ...src, wf_id: newWfId, status: 'idle', progress_completed: 0, progress_total: 0, current_node_id: null, ...extraMeta };
  delete meta.nodes; delete meta.edges;
  return { meta, nodes: newNodes, edges: newEdges };
}

test('Phase3: copy has fresh wf_id + fresh node_ids (no overlap → editing copy cannot touch source)', () => {
  const src = {
    wf_id: 'wf_src', wf_name: 'Orig', flow_kind: undefined,
    nodes: [{ node_id: 'n1', prompt: 'a' }, { node_id: 'n2', frame_1_source: 'n1' }],
    edges: [{ edge_id: 'e1', source_node_id: 'n1', target_node_id: 'n2' }],
  };
  const { meta, nodes, edges } = copyWorkflowRecord(src, { flow_kind: 'flow', source_wf_id: src.wf_id });

  assert.notEqual(meta.wf_id, src.wf_id);
  const srcNodeIds = new Set(src.nodes.map((n) => n.node_id));
  for (const n of nodes) {
    assert.ok(!srcNodeIds.has(n.node_id), 'copied node id must be fresh');
    assert.equal(n.wf_id, meta.wf_id);
  }
  // frame + edge references remapped to the NEW node ids (internal consistency).
  assert.equal(nodes[1].frame_1_source, nodes[0].node_id);
  assert.equal(edges[0].source_node_id, nodes[0].node_id);
  assert.equal(edges[0].target_node_id, nodes[1].node_id);
  // Count preserved, runtime reset, tag applied.
  assert.equal(nodes.length, src.nodes.length);
  assert.equal(meta.flow_kind, 'flow');
  assert.equal(meta.source_wf_id, 'wf_src');
  assert.equal(meta.status, 'idle');
  assert.equal(nodes[0].result_text, '');
});

test('Phase3: source exposes copyWorkflowRecord + _addToFlows (dedup) + copy-back handler', () => {
  assert.match(listSrc, /async copyWorkflowRecord\(wfId, extraMeta = \{\}\)/);
  assert.match(listSrc, /async _addToFlows\(wfId\)/);
  assert.match(listSrc, /w\.flow_kind === 'flow' && w\.source_wf_id === wfId/); // dedup
  assert.match(tabSrc, /copyWorkflowRecord\(id, \{ flow_kind: 'space'/); // Flows→My Spaces = COPY
});

// ---------- Phase 5 (safe subset): merge node = pass-through, dedups upstream file ids ----------
// Faithful reproduction of _executeMergeNode's file-gather + dedup.
function mergeFileIds(inEdges, nodesById) {
  const fileIds = [];
  const push = (id) => { const s = String(id).trim(); if (s && !fileIds.includes(s)) fileIds.push(s); };
  for (const e of inEdges) {
    const raw = nodesById[e.source_node_id]?.result_file_ids;
    if (typeof raw === 'string' && raw.trim()) raw.split(',').forEach(push);
    else if (Array.isArray(raw)) raw.forEach(push);
  }
  return fileIds.join(', ');
}

test('Phase5: merge gathers + dedups upstream file ids (string & array), order-preserving', () => {
  const nodesById = {
    a: { result_file_ids: 'f1, f2' },
    b: { result_file_ids: ['f2', 'f3'] }, // f2 duplicate → dropped
    c: { result_file_ids: '' },
  };
  const edges = [{ source_node_id: 'a' }, { source_node_id: 'b' }, { source_node_id: 'c' }];
  assert.equal(mergeFileIds(edges, nodesById), 'f1, f2, f3');
});

test('Phase5: merge has a real handler (no longer falls through to an empty generation)', () => {
  assert.match(execSrc, /node\.node_type === 'merge'/);       // dispatch case exists
  assert.match(execSrc, /_executeMergeNode\(node, workflow/); // method wired
  assert.match(execSrc, /node\.result_source = 'merge'/);     // sets pass-through result
});

// ---------- Phase 5 (D1): batch-expand — generate submits N prompts from upstream scenes ----------
// Faithful reproduction of _collectUpstreamBatchPrompts.
function collectBatch(node, workflow) {
  const edges = (workflow.edges || []).filter((e) => {
    if (e.target_node_id !== node.node_id) return false;
    const p = e.target_port;
    return !p || p === 'default' || p === 'text' || p === 'in';
  });
  const items = [];
  for (const e of edges) {
    const src = (workflow.nodes || []).find((n) => n.node_id === e.source_node_id);
    if (!src) continue;
    const arr = (Array.isArray(src.result_scenes) && src.result_scenes.length) ? src.result_scenes
      : ((Array.isArray(src.result_items) && src.result_items.length) ? src.result_items : null);
    if (!arr) continue;
    for (const it of arr) {
      const s = (typeof it === 'string' ? it : (it && (it.text || it.prompt || it.content) || '')).trim();
      if (s) items.push(s);
    }
  }
  return items.length >= 2 ? items : null;
}

test('Phase5-D1: generate downstream of a 3-scene prompt_sequence yields 3 prompts (not 1)', () => {
  const wf = {
    nodes: [
      { node_id: 'ps', node_type: 'prompt_sequence', result_scenes: ['scene A', 'scene B', 'scene C'] },
      { node_id: 'gen', node_type: 'generate' },
    ],
    edges: [{ source_node_id: 'ps', target_node_id: 'gen', target_port: 'text' }],
  };
  const prompts = collectBatch(wf.nodes[1], wf);
  assert.deepEqual(prompts, ['scene A', 'scene B', 'scene C']);
});

test('Phase5-D1: a normal generate (no upstream batch, or single item) is NOT expanded', () => {
  const single = {
    nodes: [{ node_id: 't', node_type: 'text', result_text: 'hi' }, { node_id: 'g', node_type: 'generate' }],
    edges: [{ source_node_id: 't', target_node_id: 'g', target_port: 'text' }],
  };
  assert.equal(collectBatch(single.nodes[1], single), null); // text node has no scenes → no batch

  const oneScene = {
    nodes: [{ node_id: 'ps', result_items: ['only one'] }, { node_id: 'g', node_type: 'generate' }],
    edges: [{ source_node_id: 'ps', target_node_id: 'g', target_port: 'text' }],
  };
  assert.equal(collectBatch(oneScene.nodes[1], oneScene), null); // < 2 items → run normally
});

test('Phase5-D1: source wires batch into the submit path with a safety cap', () => {
  assert.match(execSrc, /_collectUpstreamBatchPrompts\(node, workflow\)/);
  assert.match(execSrc, /prompts: _promptsToSubmit/);
  assert.match(execSrc, /BATCH_CAP/);
});
