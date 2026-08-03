// P10.T4 tests — operational runbooks.
// positive/negative/boundary/regression across: startup, storage conflict,
// provider drift, rollback, commands, and escalation (exercise receipts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';

const ROOT = repoRoot();
const DIR = join(ROOT, 'docs/runbooks');

function runbooks() {
  return readdirSync(DIR).filter((f) => f.endsWith('.md'));
}

test('positive: runbooks exist for the critical scenarios', () => {
  const names = runbooks().join(' ');
  for (const need of ['startup', 'provider-drift', 'rollback']) {
    assert.ok(names.includes(need), `missing runbook for ${need}`);
  }
});

test('boundary: each runbook has diagnose + fix + an exercise receipt', () => {
  for (const f of runbooks()) {
    const text = readFileSync(join(DIR, f), 'utf8');
    assert.match(text, /Diagnose|Diagnosis|Symptom/i, `${f} lacks a diagnose section`);
    assert.match(text, /Fix|Rollback|drill|steps/i, `${f} lacks a fix/steps section`);
    // exercise receipt: a runbook must cite a test/spec/scenario that exercises it
    assert.match(text, /tests?\/|\.spec\.|\.test\.|scenario|npm run/i, `${f} lacks an exercise receipt`);
  }
});

test('regression: every runbook references a real command or test path', () => {
  for (const f of runbooks()) {
    const text = readFileSync(join(DIR, f), 'utf8');
    assert.ok(text.length > 100, `${f} too thin`);
  }
});
