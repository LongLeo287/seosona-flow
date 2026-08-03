#!/usr/bin/env node
// P3.T8 — vendored-library drift scanner. Baselines lib/ hashes; later runs fail
// on unregistered vendored code changes. `--update` to re-baseline.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot } from '../audit/lib/repo.mjs';
import { vendoredSnapshot, diffSnapshot } from './lib/scanners.mjs';

const BASELINE_REL = 'seosona-flow/artifacts/security/vendored-baseline.json';

const root = repoRoot();
const current = vendoredSnapshot(root);
const baselinePath = join(root, BASELINE_REL);
const update = process.argv.includes('--update');

if (update || !existsSync(baselinePath)) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
  console.log(`[security:vendored] ${update ? 'updated' : 'initialized'} baseline (${current.length} files).`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const { added, removed, changed } = diffSnapshot(baseline, current);
if (added.length || removed.length || changed.length) {
  console.error('[security:vendored] DRIFT in vendored libraries:');
  for (const a of added) console.error(`  + added: ${a}`);
  for (const r of removed) console.error(`  - removed: ${r}`);
  for (const c of changed) console.error(`  ~ changed: ${c}`);
  console.error('  Review provenance and re-baseline with --update.');
  process.exit(1);
}
console.log(`[security:vendored] OK ${current.length} vendored files match baseline.`);
