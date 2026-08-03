// P5.T8 tests — deterministic replay corpus (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { buildGolden } from '../../scripts/test/replay-workflows.mjs';

const root = repoRoot();
const golden = buildGolden(root);
const byName = new Map(golden.receipts.map((r) => [r.name, r]));

test('positive: every regression fixture produces a receipt', () => {
  assert.ok(golden.count >= 4);
  for (const r of golden.receipts) {
    assert.ok(r.name && r.finalState && Array.isArray(r.events));
  }
});

test('positive: a local workflow completes', () => {
  const r = byName.get('Local Complete');
  assert.equal(r.valid, true);
  assert.equal(r.finalState, 'completed');
  assert.deepEqual([...r.events], ['START', 'COMPLETE']);
});

test('boundary: fail-then-retry converges to completed', () => {
  const r = byName.get('Fail Then Retry');
  assert.equal(r.finalState, 'completed');
  assert.deepEqual([...r.events], ['START', 'FAIL', 'RETRY', 'COMPLETE']);
});

test('boundary: cancellation settles at cancelled', () => {
  const r = byName.get('Cancel Midway');
  assert.equal(r.finalState, 'cancelled');
});

test('boundary: a legacy import migrates and runs', () => {
  const r = byName.get('Legacy Import');
  assert.equal(r.migratedFrom, 0, 'migrated from legacy version 0');
  assert.equal(r.valid, true);
  assert.equal(r.finalState, 'completed');
});

test('regression: replay is deterministic and matches the committed golden', () => {
  const again = buildGolden(root);
  assert.equal(JSON.stringify(again.receipts), JSON.stringify(golden.receipts));
  const res = spawnSync('node', ['scripts/test/replay-workflows.mjs', '--check'], {
    cwd: join(root, 'seosona-flow'), encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
});
