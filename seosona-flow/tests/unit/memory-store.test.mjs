// MemoryStore ranker tests — the pure "rank-then-load" logic (keyword overlap + recency + tier weight).
// Storage wrappers (chrome.storage) are not tested here; only the deterministic ranking core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(PKG, 'src/core/MemoryStore.js'), 'utf8');
const root = {};
new Function('self', src)(root);
const M = root.MemoryStore;

test('tokens: lowercases, keeps Vietnamese, drops 1-char noise', () => {
  assert.deepEqual(M.tokens('Brand màu Blue #3d6ff5'), ['brand', 'màu', 'blue', '3d6ff5']);
  assert.deepEqual(M.tokens(''), []);
});

test('rank: returns only items overlapping the query, most relevant first', () => {
  const items = [
    { text: 'brand color is blue', tags: ['brand'], ts: 0, tier: 'profile' },
    { text: 'user likes cinematic video prompts', tags: ['video'], ts: 0, tier: 'episodic' },
    { text: 'completely unrelated note about weather', tags: [], ts: 0, tier: 'episodic' },
  ];
  const r = M.rank('brand blue color', items, { now: 0, limit: 5 });
  assert.ok(r.length >= 1);
  assert.match(r[0].text, /brand color is blue/); // best overlap first
  assert.ok(r.every((x) => x._score > 0)); // no zero-overlap items
  assert.ok(!r.some((x) => /weather/.test(x.text))); // unrelated excluded
});

test('rank: profile tier outranks episodic when overlap is equal (tier weight)', () => {
  const items = [
    { text: 'video style prefs', tags: [], ts: 0, tier: 'episodic' },
    { text: 'video style prefs', tags: [], ts: 0, tier: 'profile' },
  ];
  const r = M.rank('video style', items, { now: 0 });
  assert.equal(r[0].tier, 'profile'); // durable profile weighted higher
});

test('rank: recency breaks ties — newer item ranks above older with same overlap', () => {
  const now = 1000 * 60 * 60 * 24 * 30; // 30 days
  const items = [
    { text: 'chose flow provider', tags: [], ts: 0, tier: 'episodic' },        // old
    { text: 'chose flow provider', tags: [], ts: now, tier: 'episodic' },      // fresh
  ];
  const r = M.rank('flow provider', items, { now });
  assert.equal(r[0].ts, now); // newer first
});

test('rank: limit caps the result set', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ text: 'prompt idea ' + i, tags: [], ts: i, tier: 'episodic' }));
  const r = M.rank('prompt idea', items, { now: 100, limit: 3 });
  assert.equal(r.length, 3);
});

test('formatHits: bullets non-empty hit texts; empty for none', () => {
  assert.equal(M.formatHits([{ text: 'brand blue' }, { text: 'flow provider' }]), '- brand blue\n- flow provider');
  assert.equal(M.formatHits([]), '');
  assert.equal(M.formatHits('bad'), '');
});

test('scoreItem: zero when no query-term overlap', () => {
  assert.equal(M.scoreItem(M.tokens('apple banana'), { text: 'car engine', tags: [], ts: 0, tier: 'episodic' }, 0), 0);
});
