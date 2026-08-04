#!/usr/bin/env node
// Single verification entrypoint — runs every verify tier in order and reports
// a machine-readable summary. `--list` prints the tiers only.
import { spawnSync } from 'node:child_process';
import { VERIFY_TIERS, RELEASE_TIERS } from './lib/tiers.mjs';

function run(cmd) {
  const res = spawnSync(cmd, { stdio: 'inherit', shell: true });
  return res.status ?? 1;
}

function main() {
  // SF-005 — hai chế độ tách bạch. `verify` là vòng nhanh khi đang code (15 tầng, không cần
  // trình duyệt). `verify:release` mới là cổng phát hành: thêm E2E, và bật SEOSONA_RELEASE để
  // tầng nào KHÔNG có file test sẽ đỏ thay vì lặng lẽ "skipping" rồi được tính là đạt.
  const release = process.argv.includes('--release');
  const tiers = release ? RELEASE_TIERS : VERIFY_TIERS;
  if (release) process.env.SEOSONA_RELEASE = '1';

  if (process.argv.includes('--list')) {
    for (const t of tiers) console.log(`${t.id}	${t.cmd}`);
    return;
  }
  const results = [];
  for (const t of tiers) {
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
