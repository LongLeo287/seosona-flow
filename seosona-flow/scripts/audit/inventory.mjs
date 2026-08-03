#!/usr/bin/env node
// P1.T1 — Freeze tracked repository inventory.
// Writes a deterministic inventory artifact; --check fails on drift.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot, buildInventory, stableJson } from './lib/repo.mjs';

const ARTIFACT_REL = 'seosona-flow/artifacts/audit/phase-01/repository-inventory.json';

function dirtyState(root) {
  const out = execFileSync('git', ['-C', root, 'status', '--porcelain'], {
    encoding: 'utf8',
  });
  return out.trim().length > 0 ? 'dirty' : 'clean';
}

function currentCommit(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

function main() {
  const check = process.argv.includes('--check');
  const root = repoRoot();
  const inv = buildInventory(root);
  const serialized = stableJson(inv);
  const artifactPath = join(root, ARTIFACT_REL);

  if (check) {
    if (!existsSync(artifactPath)) {
      console.error(`[inventory] MISSING artifact: ${ARTIFACT_REL}`);
      process.exit(1);
    }
    const onDisk = readFileSync(artifactPath, 'utf8');
    if (onDisk !== serialized) {
      console.error('[inventory] DRIFT: regenerated inventory differs from committed artifact.');
      console.error(`  files=${inv.totals.files} scopeHash=${inv.scopeHash}`);
      process.exit(1);
    }
    console.log(`[inventory] OK ${inv.totals.files} files reconcile; scopeHash=${inv.scopeHash}`);
    console.log(`  commit=${currentCommit(root)} worktree=${dirtyState(root)}`);
    return;
  }

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized);
  console.log(`[inventory] wrote ${ARTIFACT_REL}`);
  console.log(`  files=${inv.totals.files} bytes=${inv.totals.bytes} textLines=${inv.totals.textLines}`);
  console.log(`  scopeHash=${inv.scopeHash} commit=${currentCommit(root)} worktree=${dirtyState(root)}`);
}

main();
