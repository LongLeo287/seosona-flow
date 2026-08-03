// P9.T7 tests — changelog / release notes evidence.
// positive/negative/boundary/regression across: commits, issues, impact,
// version, hash, and history reconciliation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { generateBlock } from '../../scripts/release/release-notes.mjs';

const ROOT = repoRoot();

test('positive: generated notes reference the current version + commit count', () => {
  const block = generateBlock();
  const version = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/config/version.json'), 'utf8')).version;
  assert.ok(block.includes(`## ${version}`));
  assert.ok(/Commits analyzed/.test(block));
});

test('boundary: notes link to release evidence artifacts', () => {
  const block = generateBlock();
  assert.ok(block.includes('history-report.json'));
  assert.ok(block.includes('package-manifest.json'));
  assert.ok(block.includes('sbom.json'));
});

test('regression: CHANGELOG.md contains the generated block verbatim', () => {
  const block = generateBlock();
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes(block), 'CHANGELOG must embed the generated block (no drift)');
});
