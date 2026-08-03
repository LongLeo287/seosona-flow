// StyleAnchor tests — the pure inject/check/extract logic for cross-prompt consistency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(PKG, 'src/core/StyleAnchor.js'), 'utf8');
const root = {};
new Function('self', src)(root);
const SA = root.StyleAnchor;

const BLOCK = 'torn-paper collage\nhalftone shading\nswiss-modern palette';

test('inject: wraps the block verbatim and prepends by default', () => {
  const out = SA.inject('a cat on a roof', BLOCK, { label: 'STYLE' });
  assert.match(out, /^\[STYLE\]\ntorn-paper collage/);
  assert.match(out, /\[\/STYLE\]/);
  assert.match(out, /a cat on a roof$/);
});

test('inject: append position puts the block after the prompt', () => {
  const out = SA.inject('scene here', BLOCK, { position: 'append' });
  assert.match(out, /^scene here/);
  assert.match(out, /\[STYLE\][\s\S]*\[\/STYLE\]$/);
});

test('inject: empty block returns the prompt unchanged', () => {
  assert.equal(SA.inject('just this', ''), 'just this');
});

test('check: full presence → present true, coverage 1', () => {
  const p = SA.inject('a scene', BLOCK);
  const r = SA.check(p, BLOCK);
  assert.equal(r.present, true);
  assert.equal(r.coverage, 1);
});

test('check: partial presence → present false, coverage < 1', () => {
  const r = SA.check('only torn-paper collage here', BLOCK);
  assert.equal(r.present, false);
  assert.ok(r.coverage > 0 && r.coverage < 1);
});

test('applyToMany: injects the same block into every prompt (batch consistency)', () => {
  const out = SA.applyToMany(['scene A', 'scene B'], BLOCK, { label: 'STYLE' });
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => SA.check(p, BLOCK).present));
  assert.match(out[0], /scene A/);
  assert.match(out[1], /scene B/);
  assert.deepEqual(SA.applyToMany('not-array', BLOCK), []);
});

test('strip: removes the anchor block (inject then strip → original)', () => {
  const p = SA.inject('a scene here', BLOCK, { label: 'STYLE' });
  assert.equal(SA.strip(p, 'STYLE'), 'a scene here');
  assert.equal(SA.strip('no anchor', 'STYLE'), 'no anchor');
});

test('extract: pulls the block back out of a wrapped prompt', () => {
  const p = SA.inject('scene', BLOCK, { label: 'CHAR' });
  const got = SA.extract(p, 'CHAR');
  assert.equal(got, BLOCK);
  assert.equal(SA.extract('no anchor here', 'CHAR'), null);
});
