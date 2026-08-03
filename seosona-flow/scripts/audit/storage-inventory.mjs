#!/usr/bin/env node
// P1.T4 — Inventory persisted data and storage keys.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot, stableJson } from './lib/repo.mjs';
import { buildStorageInventory } from './lib/storage.mjs';

const ARTIFACT_REL = 'seosona-flow/artifacts/audit/phase-01/storage-inventory.json';

function main() {
  const check = process.argv.includes('--check');
  const root = repoRoot();
  const inv = buildStorageInventory(root);
  const serialized = stableJson(inv);
  const artifactPath = join(root, ARTIFACT_REL);

  if (check) {
    // Every concrete key must carry an owner and a lifecycle decision.
    for (const r of inv.keys) {
      if (!r.owner || !r.lifecycle || !r.sensitivity) {
        console.error(`[storage] UNCLASSIFIED key: ${r.key}`);
        process.exit(1);
      }
    }
    if (!existsSync(artifactPath) || readFileSync(artifactPath, 'utf8') !== serialized) {
      console.error('[storage] DRIFT or MISSING artifact.');
      process.exit(1);
    }
    console.log(`[storage] OK keys=${inv.summary.totalKeys} sensitive=${inv.summary.sensitiveKeys.length} callSites=${inv.summary.callSites}`);
    console.log(`  every key has owner+lifecycle; keysHash=${inv.keysHash}`);
    return;
  }

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized);
  console.log(`[storage] wrote ${ARTIFACT_REL}`);
  console.log(`  keys=${inv.summary.totalKeys} sensitive=${inv.summary.sensitiveKeys.length} callSites=${inv.summary.callSites}`);
}

main();
