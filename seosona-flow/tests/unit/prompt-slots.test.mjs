// PromptSlots tests — live {placeholder} → example-fill hint (Claude prompt-library "slot+example" pattern).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(PKG, 'src/prompts/PromptSlots.js'), 'utf8');
const root = {};
new Function('self', src)(root);
const PS = root.PromptSlots;

test('placeholders: unique, ordered', () => {
  assert.deepEqual(PS.placeholders('portrait of {subject}, {ratio}, {subject} again'), ['subject', 'ratio']);
  assert.deepEqual(PS.placeholders('no slots here'), []);
});

test('examplesFor: known placeholders get curated Vietnamese fills', () => {
  const ex = PS.examplesFor('{subject} on {bg_color} background, {ratio}');
  const byName = Object.fromEntries(ex.map((e) => [e.name, e.example]));
  assert.equal(byName.ratio, '9:16');
  assert.ok(byName.subject.length > 3 && byName.subject !== '…');
  assert.ok(byName.bg_color.length > 1);
});

test('examplesFor: unknown placeholder → generic or ellipsis (never crash)', () => {
  const ex = PS.examplesFor('{weird_thing}');
  assert.equal(ex.length, 1);
  assert.equal(ex[0].name, 'weird_thing');
  assert.ok(typeof ex[0].example === 'string');
});

test('generic suffix heuristics', () => {
  const ex = Object.fromEntries(PS.examplesFor('{hair_color} {user_name} {item_count}').map((e) => [e.name, e.example]));
  assert.equal(ex.hair_color, 'xanh navy');
  assert.equal(ex.user_name, 'Minh');
  assert.equal(ex.item_count, '3');
});

test('hint: one-line for UI', () => {
  const h = PS.hint('portrait of {subject}, {ratio}');
  assert.ok(h.includes('subject ='));
  assert.ok(h.includes('ratio = 9:16'));
  assert.equal(PS.hint('no placeholders'), '');
});
