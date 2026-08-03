#!/usr/bin/env node
// P4.T1 — baseline global dependency graph; ratchet on owned-global growth.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot, stableJson } from './lib/repo.mjs';
import { buildGlobalGraph } from './lib/globals.mjs';

const ARTIFACT_REL = 'seosona-flow/artifacts/architecture/phase-04/globals.json';

const root = repoRoot();
const graph = buildGlobalGraph(root);
const serialized = stableJson(graph);
const artifactPath = join(root, ARTIFACT_REL);
const check = process.argv.includes('--check');
const update = process.argv.includes('--update');

if (check) {
  if (!existsSync(artifactPath)) { console.error(`[globals] MISSING artifact`); process.exit(1); }
  const prev = JSON.parse(readFileSync(artifactPath, 'utf8'));
  // Ratchet: owned globals must not grow.
  if (graph.summary.ownedGlobals > prev.summary.ownedGlobals) {
    console.error(`[globals] REGRESSION: owned globals ${prev.summary.ownedGlobals} -> ${graph.summary.ownedGlobals}`);
    process.exit(1);
  }
  console.log(`[globals] OK owned=${graph.summary.ownedGlobals} (baseline ${prev.summary.ownedGlobals}) conflicted=${graph.summary.conflictedGlobals}`);
  process.exit(0);
}

if (update || !existsSync(artifactPath)) {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized);
  console.log(`[globals] ${update ? 'updated' : 'wrote'} ${ARTIFACT_REL}`);
  console.log(`  owned=${graph.summary.ownedGlobals} external=${graph.summary.externalGlobals} conflicted=${graph.summary.conflictedGlobals}`);
}
