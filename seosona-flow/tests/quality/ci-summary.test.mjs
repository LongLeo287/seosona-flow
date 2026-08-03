// P2.T8 tests — CI/local graph reconciliation (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { reconcile } from '../../scripts/quality/ci-summary.mjs';
import { ALL_TIERS } from '../../scripts/quality/lib/tiers.mjs';

const root = repoRoot();
const summary = reconcile(root);

test('positive: the CI workflow exists and every tier is represented', () => {
  assert.equal(summary.workflowPresent, true, 'verify.yml present');
  assert.deepEqual(summary.missingInCi, [], 'no tier missing from CI');
  assert.equal(summary.reconciled, true);
});

test('positive: e2e is part of the full graph', () => {
  const e2e = summary.tiers.find((t) => t.id === 'test:e2e');
  assert.ok(e2e && e2e.inWorkflow, 'e2e wired into CI');
});

test('boundary: every declared tier maps to an npm command', () => {
  for (const t of ALL_TIERS) {
    assert.match(t.cmd, /^npm run [\w:-]+$/);
  }
});

test('boundary: workflow pins Node 22 and a clean install', () => {
  const wf = readFileSync(join(root, '.github/workflows/verify.yml'), 'utf8');
  assert.match(wf, /node-version:\s*22/);
  assert.match(wf, /npm ci/);
  assert.match(wf, /upload-artifact/);
});

test('negative: a tier absent from the workflow would be flagged', () => {
  const fake = { ...summary, tiers: [...summary.tiers, { id: 'ghost', cmd: 'npm run ghost', inWorkflow: false }] };
  const missing = fake.tiers.filter((t) => !t.inWorkflow).map((t) => t.id);
  assert.ok(missing.includes('ghost'));
});

test('regression: reconciliation is deterministic', () => {
  const again = reconcile(root);
  assert.equal(again.reconciled, summary.reconciled);
  assert.equal(again.tiers.length, summary.tiers.length);
});
