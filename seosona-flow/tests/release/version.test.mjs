// P9.T5 tests — version source of truth.
// positive/negative/boundary/regression across: manifest, package, generated,
// schema and adapter versions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build } from '../../scripts/release/sync-version.mjs';

const ROOT = repoRoot();

test('positive: all consumers reconcile with version.json', () => {
  const r = build();
  assert.deepEqual([...r.problems], []);
  for (const row of r.rows) assert.equal(row.ok, true, `${row.file}.${row.path}`);
});

test('boundary: manifest.json version matches version.json', () => {
  const version = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/config/version.json'), 'utf8')).version;
  const manifest = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/manifest.json'), 'utf8')).version;
  assert.equal(manifest, version);
});

test('boundary: schema versions are recorded and numeric', () => {
  const r = build();
  assert.ok(r.schemaVersions.workflow >= 1);
  assert.ok(r.schemaVersions.export >= 1);
  assert.ok(r.schemaVersions.providerContract >= 1);
});

test('regression: version is valid semver', () => {
  assert.match(build().version, /^\d+\.\d+\.\d+$/);
});
