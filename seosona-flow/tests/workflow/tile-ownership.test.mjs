// SEOSONA regression coverage — TileMonitor upper-bound tile ownership filter.
// A queue item claims ONLY the tiles it positively created (snapshot delta right
// after submit). This narrows the candidate set BEFORE the existing per-item
// _claimedTileIds gate — it can only prevent MORE wrong claims, never cause new
// ones. A null/empty ownTileIds falls back to the existing behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';

const TM = loadClassic('src/core/TileMonitor.js', { window: {} }).self.TileMonitor;

test('positive: filters candidate tiles to only the item-owned set', () => {
  const tiles = ['t1', 't2', 't3', 't4'];
  const own = ['t2', 't4'];
  assert.deepEqual([...TM._filterToOwnTiles(tiles, own)], ['t2', 't4']);
});

test('boundary: null/empty ownTileIds is a no-op (keeps old logic)', () => {
  const tiles = ['t1', 't2'];
  assert.deepEqual([...TM._filterToOwnTiles(tiles, null)], ['t1', 't2']);
  assert.deepEqual([...TM._filterToOwnTiles(tiles, [])], ['t1', 't2']);
});

test('boundary: only narrows — never introduces a tile not already present', () => {
  const tiles = ['t1'];
  // own references a tile that is NOT in the current scan → result stays a subset of tiles
  const out = TM._filterToOwnTiles(tiles, ['t9']);
  assert.deepEqual([...out], []);
  for (const t of out) assert.ok(tiles.includes(t));
});

test('regression: supports tile objects ({tile_id}) as well as strings', () => {
  const tiles = [{ tile_id: 'a' }, { tile_id: 'b' }, 'c'];
  const out = TM._filterToOwnTiles(tiles, ['b', 'c']);
  assert.equal(out.length, 2);
  assert.ok(out.some((t) => (t.tile_id || t) === 'b'));
  assert.ok(out.some((t) => (t.tile_id || t) === 'c'));
});

test('regression: QueueItem initializes _ownTileIds to null in its constructor', () => {
  // QueueItem is a page-global class (bare name, many DOM deps) — assert the field
  // default via the source contract, alongside the other tile fields.
  const src = readFileSync(join(repoRoot(), 'seosona-flow/src/core/QueueItem.js'), 'utf8');
  assert.match(src, /this\._ownTileIds\s*=\s*null/);
  // it sits with the other post-submit tile fields, not stray
  assert.match(src, /this\.preTileIds[\s\S]{0,400}this\._ownTileIds/);
});

test('regression: EditorExecutor resets then re-captures _ownTileIds around submit', () => {
  const src = readFileSync(join(repoRoot(), 'seosona-flow/src/core/EditorExecutor.js'), 'utf8');
  // reset before the pre-snapshot, re-capture after submit (Step 8b)
  assert.match(src, /item\._ownTileIds = null;\s*\n\s*const snapshot = await MessageBridge\.getPreTileSnapshot/);
  // Step 8b re-captures the item-owned tiles from the post-submit snapshot delta.
  assert.match(src, /item\._ownTileIds = own\.length >= qty \? own : null/);
  assert.match(src, /const own = \(postSnap\?\.preTileIds \|\| \[\]\)\.filter\(id => !preSet\.has\(id\)\)/);
});
