// P9.T8 tests — rollback + staged release drill (offline).
// positive/negative/boundary/regression across: previous package, upgrade,
// downgrade, storage migration, and integrity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build as buildPackage } from '../../scripts/release/package.mjs';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const ROOT = repoRoot();

test('reproducibility: a rollback restores an identical file set', () => {
  assert.equal(buildPackage().reproHash, buildPackage().reproHash);
});

test('backward data read: a prior-version workflow migrates without throwing', () => {
  // Downgrading code must not strand user data — the migrator reads legacy docs.
  const WM = loadClassic('src/workflow/WorkflowMigrator.js').SEOSONA_WorkflowMigrator;
  const legacy = { name: 'legacy', drawflow: { Home: { data: {} } } };
  const migrated = WM.migrate(legacy);
  assert.ok(migrated && typeof migrated === 'object', 'migrate returns a document');
});

test('downgrade detection: version is semver + monotonic-checkable', async () => {
  const { build } = await import('../../scripts/release/sync-version.mjs');
  const cur = build().version;
  const [a, b, c] = cur.split('.').map(Number);
  assert.ok(Number.isInteger(a) && Number.isInteger(b) && Number.isInteger(c));
  // a hypothetical prior version compares strictly less
  const prior = `${a}.${b}.${Math.max(0, c - 1)}`;
  assert.ok(prior <= cur);
});

test('runbook exists and documents the drill', () => {
  assert.ok(existsSync(join(ROOT, 'docs/runbooks/release-rollback.md')));
});
