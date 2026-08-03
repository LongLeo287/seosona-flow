// TileConfidence — multi-signal tile-ready scoring (Aliens_eye-style confidence, 3-state verdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(PKG, 'src/core/TileConfidence.js'), 'utf8');
const root = {};
new Function('self', src)(root);
const TC = root.TileConfidence;

test('tileReady: full positive signals → found (high score)', () => {
  const r = TC.tileReady({ hasElement: true, hasImageSrc: true, statusComplete: true, hasTileId: true, notLoading: true, notError: true, hasDownloadBtn: true });
  assert.equal(r.verdict, 'found');
  assert.ok(r.score >= 0.9);
});

test('tileReady: only element present → none/maybe (low score)', () => {
  const r = TC.tileReady({ hasElement: true });
  assert.ok(r.score < 0.4);
  assert.equal(r.verdict, 'none');
});

test('tileReady: partial (element + status, still loading) → maybe band', () => {
  const r = TC.tileReady({ hasElement: true, statusComplete: true, hasTileId: true });
  assert.ok(r.score >= 0.4 && r.score < 0.7, `score ${r.score} should be in maybe band`);
  assert.equal(r.verdict, 'maybe');
});

test('score: negative-weight signal (error) reduces confidence', () => {
  const good = TC.tileReady({ hasElement: true, hasImageSrc: true, statusComplete: true, notLoading: true });
  const withErr = TC.score(
    { hasElement: true, hasImageSrc: true, statusComplete: true, notLoading: true, isError: true },
    { ...TC.DEFAULT_WEIGHTS, isError: -3 },
  );
  assert.ok(withErr.score < good.score, 'error signal must lower the score');
});

test('score: numeric (0..1) signal weighted proportionally', () => {
  const full = TC.score({ a: 1 }, { a: 2 });
  const half = TC.score({ a: 0.5 }, { a: 2 });
  assert.ok(half.score < full.score);
  assert.equal(full.score, 1);
});

test('score: empty signals → none', () => {
  assert.equal(TC.tileReady({}).verdict, 'none');
  assert.equal(TC.tileReady({}).score, 0);
});
