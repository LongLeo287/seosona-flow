#!/usr/bin/env node
// P1.T2 — Generate architecture and script-load graph.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot, stableJson } from './lib/repo.mjs';
import { buildArchitectureGraph } from './lib/graph.mjs';

const ARTIFACT_REL = 'seosona-flow/artifacts/audit/phase-01/architecture-graph.json';

function main() {
  const check = process.argv.includes('--check');
  const root = repoRoot();
  const graph = buildArchitectureGraph(root);
  const serialized = stableJson(graph);
  const artifactPath = join(root, ARTIFACT_REL);

  if (check) {
    if (graph.missingResources.length > 0) {
      console.error(`[architecture] MISSING ${graph.missingResources.length} declared resource(s):`);
      for (const m of graph.missingResources) console.error(`  - ${JSON.stringify(m)}`);
      process.exit(1);
    }
    if (!existsSync(artifactPath)) {
      console.error(`[architecture] MISSING artifact: ${ARTIFACT_REL}`);
      process.exit(1);
    }
    if (readFileSync(artifactPath, 'utf8') !== serialized) {
      console.error('[architecture] DRIFT: regenerated graph differs from committed artifact.');
      process.exit(1);
    }
    console.log(`[architecture] OK pages=${graph.nodes.pages} groups=${graph.nodes.contentScriptGroups} pageScripts=${graph.totals.pageScripts}`);
    console.log(`  every declared resource exists; receiptHash=${graph.receiptHash}`);
    return;
  }

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized);
  console.log(`[architecture] wrote ${ARTIFACT_REL}`);
  console.log(`  pages=${graph.nodes.pages} groups=${graph.nodes.contentScriptGroups} pageScripts=${graph.totals.pageScripts} missing=${graph.totals.missingResources}`);
}

main();
