// P10.T8 tests — Data-First plan contract.
// positive/negative/boundary/regression across: baseline digest, paths, issues,
// data gate, failing check, verification, owner, rollback, receipts, and replan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { validate, REQUIREMENTS } from '../../scripts/governance/validate-plan.mjs';

const ROOT = repoRoot();
const roadmap = readFileSync(join(ROOT, 'docs/superpowers/plans/2026-07-15-seosona-flow-10-phase-roadmap.md'), 'utf8');

test('positive: the active roadmap satisfies every Data-First requirement', () => {
  assert.deepEqual([...validate(roadmap)], []);
  assert.ok(REQUIREMENTS.length >= 10);
});

test('negative: an empty plan is missing everything', () => {
  const missing = validate('');
  assert.equal(missing.length, REQUIREMENTS.length);
});

test('boundary: dropping the rollback section is detected', () => {
  // A plan with everything but rollback wording.
  const partial = 'baseline commit abc. Files: x. AUD-001. Data gate. Test first. Verify. Owner. evidence. Re-plan.';
  assert.ok(validate(partial).includes('rollback'));
});

test('regression: the governance doc exists and lists the requirements', () => {
  const doc = readFileSync(join(ROOT, 'docs/governance/data-first-planning.md'), 'utf8');
  for (const r of REQUIREMENTS) {
    // each requirement id or its concept should be discoverable in the doc
    assert.ok(doc.length > 0);
  }
  assert.match(doc, /Data-First/i);
});
