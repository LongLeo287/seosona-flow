// CostEstimator tests — the pure cost-preview math (units, generations, most-expensive, notes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(PKG, 'src/core/CostEstimator.js'), 'utf8');
const root = {};
new Function('self', src)(root);
const CE = root.CostEstimator;

test('unitsFor: image=1×qty, video≈4×, non-gen=0', () => {
  assert.equal(CE.unitsFor({ type: 'generate', mediaType: 'image', quantity: 1 }), 1);
  assert.equal(CE.unitsFor({ type: 'generate', mediaType: 'image', quantity: 4 }), 4);
  assert.ok(CE.unitsFor({ type: 'generate', mediaType: 'video', quantity: 1 }) >= 4);
  assert.equal(CE.unitsFor({ type: 'merge' }), 0);       // logic node, no cost
  assert.equal(CE.unitsFor({ type: 'text_overlay' }), 0); // deterministic overlay, no gen
});

test('estimate: totals generations + units across gen steps only', () => {
  const plan = [
    { type: 'prompt', label: 'write' },                                  // no cost
    { type: 'generate', mediaType: 'image', quantity: 3, provider: 'flow', label: 'scenes' },
    { type: 'text_overlay', label: 'caption' },                          // no cost
  ];
  const r = CE.estimate(plan);
  assert.equal(r.totalGenerations, 3);
  assert.equal(r.totalUnits, 3);
  assert.equal(r.byProvider.flow, 3);
});

test('estimate: flags the most expensive step (video)', () => {
  const plan = [
    { type: 'generate', mediaType: 'image', quantity: 2, label: 'thumbs' },
    { type: 'generate', mediaType: 'video', durationSec: 8, quantity: 1, label: 'hero clip' },
  ];
  const r = CE.estimate(plan);
  assert.equal(r.mostExpensive.step, 'hero clip');
  assert.equal(r.mostExpensive.media, 'video');
  assert.ok(r.notes.some((n) => /VIDEO/.test(n)));
});

test('estimate: warns on a heavy plan', () => {
  const plan = [{ type: 'generate', mediaType: 'image', quantity: 50, label: 'batch' }];
  const r = CE.estimate(plan);
  assert.equal(r.totalUnits, 50);
  assert.ok(r.notes.some((n) => /NẶNG/.test(n)));
});

test('estimate: an all-logic plan has ~zero cost', () => {
  const r = CE.estimate([{ type: 'prompt' }, { type: 'condition' }, { type: 'merge' }]);
  assert.equal(r.totalGenerations, 0);
  assert.equal(r.totalUnits, 0);
  assert.ok(r.notes.some((n) => /~0/.test(n)));
});

test('estimate: estMinutes derived from estSeconds', () => {
  const r = CE.estimate([{ type: 'generate', mediaType: 'image', quantity: 4 }]);
  assert.equal(r.estSeconds, 60); // 4 × 15s
  assert.equal(r.estMinutes, 1);
});

test('planFromNodes: maps nodes → plan, skips disabled, detects video', () => {
  const plan = CE.planFromNodes([
    { node_type: 'prompt', node_name: 'p' },
    { node_type: 'generate', media_type: 'Image', quantity: 3, node_name: 'img' },
    { node_type: 'generate', media_type: 'Video', video_duration: '8', node_name: 'vid' },
    { node_type: 'generate', media_type: 'Image', quantity: 5, enabled: false, node_name: 'off' },
  ]);
  assert.equal(plan.length, 3); // disabled dropped
  const est = CE.estimate(plan);
  assert.equal(est.totalGenerations, 4); // 3 img + 1 vid (prompt = 0)
  assert.equal(est.byProvider.flow, 4);
  assert.ok(est.mostExpensive.media === 'video');
  assert.deepEqual(CE.planFromNodes('bad'), []);
});

test('format: human summary; heavy plan warns; empty plan ~0', () => {
  const light = CE.format(CE.estimate([{ type: 'generate', mediaType: 'image', quantity: 2, label: 'x' }]));
  assert.match(light, /Sắp sinh 2/);
  assert.ok(!/giảm số lượng/.test(light));
  const heavy = CE.format(CE.estimate([{ type: 'generate', mediaType: 'image', quantity: 50, label: 'batch' }]));
  assert.match(heavy, /giảm số lượng/);
  assert.match(CE.format(CE.estimate([{ type: 'merge' }])), /~0/);
});
