// P5.T2 tests — workflow migrations (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';

const root = repoRoot();
const ctx = loadClassic(['src/workflow/WorkflowSchema.js', 'src/workflow/WorkflowMigrator.js']);
const M = ctx.SEOSONA_WorkflowMigrator;
const load = (f) => JSON.parse(readFileSync(join(root, 'seosona-flow/tests/fixtures/workflows', f), 'utf8'));

test('positive: legacy drawflow map migrates to array + edges', () => {
  const original = load('legacy-drawflow.json');
  const r = M.migrate(original);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(Array.isArray(r.workflow.nodes));
  assert.equal(r.workflow.nodes.length, 2);
  assert.ok(Array.isArray(r.workflow.edges));
  assert.equal(r.workflow.edges.length, 1); // from legacy "connections"
  assert.equal(r.workflow.schemaVersion, M.CURRENT_VERSION);
  assert.equal(typeof r.workflow.nodes[0].id, 'string', 'ids coerced');
});

test('positive: original document is never mutated (backup preserved)', () => {
  const original = load('legacy-drawflow.json');
  const before = JSON.stringify(original);
  const r = M.migrate(original);
  assert.equal(JSON.stringify(original), before, 'input untouched');
  assert.equal(r.backup, original);
});

test('boundary: migrating an already-current workflow is idempotent', () => {
  const current = load('valid-connected.json');
  current.schemaVersion = M.CURRENT_VERSION;
  const r1 = M.migrate(current);
  const r2 = M.migrate(r1.workflow);
  assert.equal(r1.ok && r2.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(r1.workflow)), JSON.parse(JSON.stringify(r2.workflow)));
});

test('negative: future schema version is refused, original preserved', () => {
  const future = { name: 'x', nodes: [], schemaVersion: 999 };
  const r = M.migrate(future);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'FUTURE_VERSION');
  assert.equal(r.backup, future);
});

test('negative: a document invalid after migration fails safely', () => {
  const bad = { nodes: [], edges: [] }; // no name
  const r = M.migrate(bad);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INVALID_AFTER_MIGRATION');
  assert.ok(r.issues.some((i) => i.code === 'MISSING_NAME'));
  assert.equal(r.backup, bad);
});

test('boundary: prototype-pollution keys are stripped during migration', () => {
  const evil = JSON.parse('{"name":"x","nodes":[],"edges":[],"__proto__":{"admin":true}}');
  const r = M.migrate(evil);
  assert.equal(r.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(r.workflow, '__proto__'), false);
});

test('regression: non-objects fail without throwing', () => {
  for (const v of [null, 42, 'x', [1, 2]]) {
    const r = M.migrate(v);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'NOT_AN_OBJECT');
  }
});
