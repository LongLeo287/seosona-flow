// P4.T1 tests — global dependency graph (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGlobalGraph } from '../../scripts/audit/lib/globals.mjs';

const graph = buildGlobalGraph();
const byName = new Map(graph.globals.map((g) => [g.name, g]));

test('positive: known owned globals have a writer', () => {
  for (const name of ['ApiClient', 'SEOSONA_LOCAL_MODE']) {
    const g = byName.get(name);
    if (g) assert.ok(g.writerCount >= 1, `${name} owned`);
  }
  assert.ok(graph.summary.ownedGlobals > 0, 'app owns globals');
});

test('positive: every owned global lists at least one writer file', () => {
  for (const g of graph.globals.filter((x) => x.owned)) {
    assert.ok(g.writers.length >= 1);
    assert.ok(g.writers.every((w) => w.endsWith('.js')));
  }
});

test('boundary: external browser globals have readers but no in-repo writer', () => {
  for (const g of graph.globals.filter((x) => !x.owned)) {
    assert.equal(g.writerCount, 0);
    assert.ok(g.readerCount >= 1);
  }
});

test('boundary: conflicted globals (multiple writers) are surfaced', () => {
  assert.equal(typeof graph.summary.conflictedGlobals, 'number');
  for (const g of graph.globals.filter((x) => x.conflicted)) {
    assert.ok(g.writers.length > 1);
  }
});

test('negative: an invented global is absent', () => {
  assert.equal(byName.has('__totally_made_up_global__'), false);
});

test('regression: graph hash and owned count are deterministic', () => {
  const again = buildGlobalGraph();
  assert.equal(again.graphHash, graph.graphHash);
  assert.equal(again.summary.ownedGlobals, graph.summary.ownedGlobals);
});
