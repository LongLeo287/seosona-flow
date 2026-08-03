// P5.T7 tests — workflow limits (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const WL = loadClassic('src/workflow/WorkflowLimits.js').SEOSONA_WorkflowLimits;

const dag = {
  name: 'ok',
  nodes: [{ id: 'a', type: 'image', data: {} }, { id: 'b', type: 'generate', data: {} }],
  edges: [{ id: 'e', source: 'a', target: 'b' }],
};

test('positive: a valid DAG passes', () => {
  const r = WL.check(dag);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test('negative: a cyclic graph is rejected', () => {
  const cyclic = {
    name: 'loop',
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'a' }],
  };
  const r = WL.check(cyclic);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((x) => x.code === 'CYCLE'));
  assert.equal(WL.hasCycle(cyclic.nodes, cyclic.edges), true);
});

test('negative: too many nodes fails fast', () => {
  const big = { name: 'big', nodes: Array.from({ length: 301 }, (_, i) => ({ id: 'n' + i })), edges: [] };
  const r = WL.check(big);
  assert.ok(r.violations.some((x) => x.code === 'TOO_MANY_NODES'));
});

test('boundary: oversized prompt and too many ref images are flagged', () => {
  const wf = {
    name: 'x',
    nodes: [{ id: 'a', data: { prompt: 'p'.repeat(9000), ref_img_urls: new Array(20).fill('u') } }],
    edges: [],
  };
  const r = WL.check(wf);
  assert.ok(r.violations.some((x) => x.code === 'PROMPT_TOO_LONG'));
  assert.ok(r.violations.some((x) => x.code === 'TOO_MANY_REF_IMAGES'));
});

test('boundary: total media outputs are capped', () => {
  const wf = {
    name: 'x',
    nodes: [{ id: 'a', data: { quantity: 600 } }],
    edges: [],
  };
  const r = WL.check(wf);
  assert.equal(r.totalOutputs, 600);
  assert.ok(r.violations.some((x) => x.code === 'TOO_MANY_OUTPUTS'));
});

test('regression: excessive depth is rejected', () => {
  const n = 70;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: 'n' + i }));
  const edges = [];
  for (let i = 0; i < n - 1; i++) edges.push({ id: 'e' + i, source: 'n' + i, target: 'n' + (i + 1) });
  const r = WL.check({ name: 'chain', nodes, edges }, { limits: { maxNodes: 1000 } });
  assert.ok(r.violations.some((x) => x.code === 'TOO_DEEP'));
});
