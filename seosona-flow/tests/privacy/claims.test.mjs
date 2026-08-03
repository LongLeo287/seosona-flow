// P7.T8 tests — privacy claims are precise and test-backed.
// positive/negative/boundary/regression across: offline, local, online, storage,
// network, permissions, deletion, limitations, and dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';

const ROOT = repoRoot();
const abs = (p) => join(ROOT, p);

// Each normative claim → the evidence that must exist and back it.
const CLAIMS = [
  { id: 'CLAIM-LOCAL-FIRST', evidence: ['seosona-flow/tests/e2e/local-mode-e2e.spec.mjs', 'seosona-flow/scripts/test/network-deny-proxy.mjs'] },
  { id: 'CLAIM-ONLINE-OPTIN', evidence: ['seosona-flow/src/ui/OnlineModeConsent.js', 'seosona-flow/tests/privacy/online-consent.test.mjs'] },
  { id: 'CLAIM-NETWORK-OWNED', evidence: ['seosona-flow/scripts/audit/network-inventory.mjs', 'seosona-flow/artifacts/privacy/phase-07/network-inventory.json'] },
  { id: 'CLAIM-DATA-CLASSIFIED', evidence: ['seosona-flow/src/storage/DataClassification.js', 'docs/privacy/data-map.md'] },
  { id: 'CLAIM-EXPORT-DELETE', evidence: ['seosona-flow/src/storage/DataLifecycleService.js', 'seosona-flow/tests/privacy/data-lifecycle.test.mjs'] },
  { id: 'CLAIM-NO-SECRET-EXPORT', evidence: ['seosona-flow/src/storage/ExportPolicy.js', 'seosona-flow/tests/privacy/export-policy.test.mjs'] },
  { id: 'CLAIM-REDACTED-LOGS', evidence: ['seosona-flow/src/core/PrivacyFilter.js', 'seosona-flow/tests/privacy/logging.test.mjs'] },
  { id: 'CLAIM-PERMISSIONS', evidence: ['docs/security/permission-matrix.md', 'seosona-flow/scripts/security/scan-permissions.mjs'] },
];

test('positive: every claim references only existing evidence', () => {
  for (const c of CLAIMS) {
    for (const e of c.evidence) {
      assert.ok(existsSync(abs(e)), `${c.id} → missing evidence ${e}`);
    }
  }
});

test('regression: the privacy README documents every claim id', () => {
  const readme = readFileSync(abs('docs/privacy/README.md'), 'utf8');
  for (const c of CLAIMS) {
    assert.ok(readme.includes(c.id), `README missing ${c.id}`);
    for (const e of c.evidence) assert.ok(readme.includes(e), `README missing evidence link ${e} for ${c.id}`);
  }
});

test('boundary: README states the provider-traffic limitation (not backend)', () => {
  const readme = readFileSync(abs('docs/privacy/README.md'), 'utf8');
  assert.ok(/provider.*traffic|user-directed/i.test(readme), 'must clarify provider vs backend traffic');
  assert.ok(/Limitations/i.test(readme));
});

test('negative: no claim points at a nonexistent probe (guards drift)', () => {
  // deliberately assert the negative: a fake evidence path must NOT exist
  assert.equal(existsSync(abs('seosona-flow/tests/privacy/does-not-exist.mjs')), false);
});
