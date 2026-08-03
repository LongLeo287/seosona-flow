#!/usr/bin/env node
// Single verification entrypoint — runs every verify tier in order and reports
// a machine-readable summary. `--list` prints the tiers only.
import { spawnSync } from 'node:child_process';
import { VERIFY_TIERS } from './lib/tiers.mjs';

function run(cmd) {
  const res = spawnSync(cmd, { stdio: 'inherit', shell: true });
  return res.status ?? 1;
}

function main() {
  if (process.argv.includes('--list')) {
    for (const t of VERIFY_TIERS) console.log(`${t.id}\t${t.cmd}`);
    return;
  }
  const results = [];
  for (const t of VERIFY_TIERS) {
    process.stdout.write(`\n=== verify: ${t.id} ===\n`);
    const code = run(t.cmd);
    results.push({ id: t.id, cmd: t.cmd, code });
    if (code !== 0) {
      console.error(`\n[verify] FAILED at tier "${t.id}" (exit ${code}).`);
      console.error(`[verify] summary: ${JSON.stringify(results)}`);
      process.exit(code);
    }
  }
  console.log(`\n[verify] OK all ${results.length} tiers passed.`);
  console.log(`[verify] summary: ${JSON.stringify(results)}`);
}

main();
