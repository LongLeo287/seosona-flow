#!/usr/bin/env node
// P4.T8 — verify every reproducible generated artifact byte-reproduces from its
// registered generator, and report explicit deferrals. `--check` fails on drift.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../audit/lib/repo.mjs';

const REGISTRY_REL = 'seosona-flow/config/generated-artifacts.json';

const root = repoRoot();
const registry = JSON.parse(readFileSync(join(root, REGISTRY_REL), 'utf8'));
const cwd = join(root, 'seosona-flow');

let failures = 0;
for (const entry of registry.reproducible) {
  const [cmd, ...args] = entry.checkCommand.split(' ');
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  const ok = res.status === 0;
  console.log(`  [${ok ? 'OK ' : 'FAIL'}] ${entry.artifact}`);
  if (!ok) { failures++; if (res.stderr) console.error(`        ${res.stderr.trim().split('\n')[0]}`); }
}
console.log(`[build:generated] ${registry.reproducible.length} reproducible, ${registry.deferred.length} deferred (owned).`);

if (failures > 0) {
  console.error(`[build:generated] ${failures} generated artifact(s) failed to reproduce.`);
  process.exit(1);
}
console.log('[build:generated] OK every reproducible artifact byte-reproduces.');
