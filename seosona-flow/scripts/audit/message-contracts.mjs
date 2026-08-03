#!/usr/bin/env node
// P1.T3 — Inventory privileged message contracts.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot, stableJson } from './lib/repo.mjs';
import { buildMessageContracts } from './lib/messages.mjs';

const ARTIFACT_REL = 'seosona-flow/artifacts/audit/phase-01/message-contracts.json';

function main() {
  const check = process.argv.includes('--check');
  const root = repoRoot();
  const contracts = buildMessageContracts(root);
  const serialized = stableJson(contracts);
  const artifactPath = join(root, ARTIFACT_REL);

  if (check) {
    // Every action must resolve to exactly one classified registry row.
    const seen = new Set();
    for (const r of contracts.registry) {
      if (seen.has(r.action)) {
        console.error(`[messages] DUPLICATE registry row: ${r.action}`);
        process.exit(1);
      }
      seen.add(r.action);
    }
    if (!existsSync(artifactPath) || readFileSync(artifactPath, 'utf8') !== serialized) {
      console.error('[messages] DRIFT or MISSING artifact.');
      process.exit(1);
    }
    console.log(`[messages] OK actions=${contracts.summary.totalActions} handled=${contracts.summary.handledActions} privileged=${contracts.summary.privilegedActions} external=${contracts.summary.externallyReachable.length}`);
    console.log(`  registryHash=${contracts.registryHash}`);
    return;
  }

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized);
  console.log(`[messages] wrote ${ARTIFACT_REL}`);
  console.log(`  actions=${contracts.summary.totalActions} handled=${contracts.summary.handledActions} privileged=${contracts.summary.privilegedActions} externallyReachable=${contracts.summary.externallyReachable.length}`);
}

main();
