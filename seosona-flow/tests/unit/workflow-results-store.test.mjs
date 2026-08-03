import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../helpers/load-classic.mjs';

function loadResults() {
  try {
    return loadClassic('src/storage/WorkflowResultsStore.js').SEOSONA_WorkflowResultsStore || null;
  } catch (_) {
    return null;
  }
}

test('positive: createRun records workflow metadata and starts with an empty dataset', async () => {
  const R = loadResults();
  assert.ok(R, 'WorkflowResultsStore module is available');
  const store = R.createMemoryStore();

  const run = await R.createRun({
    workflowId: 'wf_1',
    workflowName: 'Product review',
  }, {
    id: 'run_1',
    now: 1000,
    store,
  });

  assert.equal(run.ok, true);
  assert.equal(run.run.id, 'run_1');
  assert.equal(run.run.workflowId, 'wf_1');
  assert.equal(run.run.status, 'running');
  assert.equal(JSON.stringify(run.run.rows), JSON.stringify([]));
});

test('positive: appendRows infers stable columns and preserves row order', async () => {
  const R = loadResults();
  assert.ok(R, 'WorkflowResultsStore module is available');
  const store = R.createMemoryStore();
  await R.createRun({ workflowId: 'wf_1' }, { id: 'run_1', now: 1000, store });

  const result = await R.appendRows('run_1', [
    { title: 'A', price: 19, image: 'https://example.test/a.png' },
    { title: 'B', price: 29, image: 'https://example.test/b.png' },
  ], {
    now: 2000,
    store,
  });

  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result.run.columns.map((c) => [c.field, c.type])), JSON.stringify([
    ['title', 'text'],
    ['price', 'number'],
    ['image', 'image'],
  ]));
  assert.equal(JSON.stringify(result.run.rows.map((r) => r.title)), JSON.stringify(['A', 'B']));
});

test('boundary: CSV export escapes commas, quotes and newlines', async () => {
  const R = loadResults();
  assert.ok(R, 'WorkflowResultsStore module is available');
  const store = R.createMemoryStore();
  await R.createRun({ workflowId: 'wf_1' }, { id: 'run_1', now: 1000, store });
  await R.appendRows('run_1', [
    { title: 'A, "quoted"', note: 'line1\nline2' },
  ], { store });

  const csv = await R.exportCsv('run_1', { store });

  assert.equal(csv.ok, true);
  assert.equal(csv.csv, 'title,note\n"A, ""quoted""","line1\nline2"');
});

test('negative: appending rows to a missing run fails safely', async () => {
  const R = loadResults();
  assert.ok(R, 'WorkflowResultsStore module is available');

  const result = await R.appendRows('missing', [{ title: 'A' }], {
    store: R.createMemoryStore(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'RUN_NOT_FOUND');
});
