#!/usr/bin/env node
// P3.T8 — manifest permission drift scanner. First run writes a baseline;
// later runs fail on any undocumented permission/host change. `--update` to
// re-baseline (with justification in the commit).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot } from '../audit/lib/repo.mjs';
import { permissionSnapshot } from './lib/scanners.mjs';

const BASELINE_REL = 'seosona-flow/artifacts/security/permissions-baseline.json';

const root = repoRoot();
const current = permissionSnapshot(root);
const baselinePath = join(root, BASELINE_REL);
const update = process.argv.includes('--update');

if (update || !existsSync(baselinePath)) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
  console.log(`[security:permissions] ${update ? 'updated' : 'initialized'} baseline.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const drift = [];
for (const cat of ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions']) {
  const b = new Set(baseline[cat] || []);
  const c = new Set(current[cat] || []);
  for (const p of c) if (!b.has(p)) drift.push(`+ ${cat}: ${p}`);
  for (const p of b) if (!c.has(p)) drift.push(`- ${cat}: ${p}`);
}
if (drift.length > 0) {
  console.error('[security:permissions] DRIFT vs baseline:');
  for (const d of drift) console.error(`  ${d}`);
  console.error('  Update docs/security/permission-matrix.md and re-baseline with --update.');
  process.exit(1);
}
console.log('[security:permissions] OK manifest permissions match baseline.');
