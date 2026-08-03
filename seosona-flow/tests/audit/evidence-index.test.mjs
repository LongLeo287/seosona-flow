// P1.T8 tests — positive, negative, boundary, regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { buildEvidenceIndex } from '../../scripts/audit/evidence-index.mjs';

const root = repoRoot();
const index = buildEvidenceIndex(root);

test('positive: verdict is ACCEPTED and every artifact reconciles', () => {
  assert.equal(index.verdict, 'ACCEPTED');
  for (const e of index.artifacts) {
    assert.equal(e.reconciled, true, `${e.artifact} reconciles`);
    assert.match(e.sha256, /^[0-9a-f]{64}$/);
  }
});

test('positive: all six Phase 1 artifacts are indexed', () => {
  const ids = index.artifacts.map((e) => e.id).sort();
  assert.deepEqual(ids, [
    'architecture-graph',
    'history-report',
    'issues',
    'message-contracts',
    'repository-inventory',
    'storage-inventory',
  ]);
});

test('positive: on-disk index file matches the recomputed verdict', () => {
  const onDisk = JSON.parse(readFileSync(join(root, 'seosona-flow/artifacts/audit/phase-01/index.json'), 'utf8'));
  assert.equal(onDisk.verdict, 'ACCEPTED');
  assert.equal(onDisk.artifacts.length, index.artifacts.length);
});

test('boundary: each artifact carries a generator command', () => {
  for (const e of index.artifacts) {
    assert.match(e.generator, /^node scripts\/audit\/.+\.mjs$/);
  }
});

test('boundary: baseline doc records the verdict and every artifact', () => {
  const md = readFileSync(join(root, 'docs/audits/phase-01-baseline.md'), 'utf8');
  assert.ok(md.includes('ACCEPTED'));
  for (const e of index.artifacts) assert.ok(md.includes(e.artifact), `doc lists ${e.artifact}`);
});

test('regression: index is deterministic at a fixed commit', () => {
  const again = buildEvidenceIndex(root);
  assert.equal(again.baselineCommit, index.baselineCommit);
  assert.deepEqual(again.artifacts.map((e) => e.sha256), index.artifacts.map((e) => e.sha256));
});
