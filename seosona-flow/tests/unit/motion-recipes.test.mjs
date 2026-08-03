// MotionRecipes tests — the intent-match + avoid_when(context) + css-emit logic (motion-anything style).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(PKG, 'src/core/MotionRecipes.js'), 'utf8');
const root = {};
new Function('self', src)(root);
const MR = root.MotionRecipes;

test('all recipes have the required schema fields', () => {
  const rs = MR.all();
  assert.ok(rs.length >= 10);
  for (const r of rs) {
    for (const f of ['id', 'name', 'trigger', 'intent_keywords', 'avoid_when', 'restraint', 'keyframes', 'duration', 'easing']) {
      assert.ok(f in r, `${r.id} missing ${f}`);
    }
    assert.ok(Array.isArray(r.intent_keywords) && r.intent_keywords.length);
    assert.ok(['entrance', 'emphasis', 'attention', 'exit'].includes(r.trigger));
  }
});

test('find: matches by intent keywords, ranked by hits', () => {
  const r = MR.find('fade soft reveal', { limit: 3 });
  assert.ok(r.length >= 1);
  assert.equal(r[0].id, 'fade-in'); // best keyword overlap
  assert.ok(r.every((x) => x._score > 0));
});

test('find: avoid_when excludes recipes for the given context', () => {
  const withCtx = MR.find('slide up enter', { context: ['reduced-motion'] });
  assert.ok(!withCtx.some((x) => x.id === 'slide-up-in'), 'reduced-motion must exclude slide-up-in');
  const noCtx = MR.find('slide up enter', {});
  assert.ok(noCtx.some((x) => x.id === 'slide-up-in'), 'without context it is available');
});

test('find: shake matches error intent but is excluded for text-block context', () => {
  assert.ok(MR.find('error invalid', {}).some((x) => x.id === 'shake'));
  assert.ok(!MR.find('error invalid', { context: ['text-block'] }).some((x) => x.id === 'shake'));
});

test('css: emits keyframes + class + reduced-motion guard', () => {
  const c = MR.css('fade-in');
  assert.match(c, /@keyframes sf-kf-fade-in/);
  assert.match(c, /\.sf-motion-fade-in\{animation:/);
  assert.match(c, /prefers-reduced-motion: reduce/);
  assert.equal(MR.css('nope'), '');
});

test('css: looping triggers (pulse) get infinite, one-shot (fade-in) do not', () => {
  assert.match(MR.css('pulse'), /infinite/);
  assert.ok(!/infinite/.test(MR.css('fade-in')));
});

test('byTrigger: filters recipes by trigger group', () => {
  const ent = MR.byTrigger('entrance');
  assert.ok(ent.length >= 3);
  assert.ok(ent.every((r) => r.trigger === 'entrance'));
  assert.equal(MR.byTrigger('nope').length, 0);
});

test('cssBundle: concatenates CSS for multiple ids, dedups, skips unknown', () => {
  const b = MR.cssBundle(['fade-in', 'pulse', 'fade-in', 'nope']);
  assert.match(b, /sf-kf-fade-in/);
  assert.match(b, /sf-kf-pulse/);
  // fade-in only once despite duplicate
  assert.equal((b.match(/@keyframes sf-kf-fade-in/g) || []).length, 1);
  assert.equal(MR.cssBundle('not-array'), '');
});
