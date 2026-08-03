#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const seosonaRoot = process.env.SEOSONA_ROOT || join(homedir(), '.seosona');
const connector = join(seosonaRoot, '1_CORE', 'scripts', 'project_connector.js');
const args = process.argv.slice(2);

// Degrade gracefully when SEOSONA OS isn't reachable (e.g. a clean CI runner with no
// ~/.seosona): skip the OS-side checks and exit 0 so a chained `&& node scripts/doctor.js`
// (the project's own local checks) still runs, instead of failing the whole CI step.
if (!existsSync(connector)) {
  console.log(`[seosona] OS connector not found at ${connector} — skipping OS checks (set SEOSONA_ROOT to enable).`);
  process.exit(0);
}

const result = spawnSync(process.execPath, [connector, ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
