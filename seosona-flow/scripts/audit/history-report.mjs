#!/usr/bin/env node
// P1.T5 — Classify project history.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot, stableJson } from './lib/repo.mjs';
import { buildHistoryReport } from './lib/history.mjs';

const ARTIFACT_REL = 'seosona-flow/artifacts/audit/phase-01/history-report.json';

function main() {
  const check = process.argv.includes('--check');
  const root = repoRoot();
  const report = buildHistoryReport(root);
  const serialized = stableJson(report);
  const artifactPath = join(root, ARTIFACT_REL);

  if (check) {
    if (report.commits.length !== report.totals.commits) {
      console.error('[history] commit count mismatch.');
      process.exit(1);
    }
    if (report.unclassified.length > 0) {
      console.error(`[history] UNCLASSIFIED commits: ${report.unclassified.join(', ')}`);
      process.exit(1);
    }
    if (!existsSync(artifactPath) || readFileSync(artifactPath, 'utf8') !== serialized) {
      console.error('[history] DRIFT or MISSING artifact.');
      process.exit(1);
    }
    console.log(`[history] OK ${report.totals.commits} commits classified; merges=${report.totals.merges} tags=${report.totals.tags} authors=${report.totals.authors}`);
    console.log(`  categories=${JSON.stringify(report.byCategory)} historyHash=${report.historyHash}`);
    return;
  }

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, serialized);
  console.log(`[history] wrote ${ARTIFACT_REL}`);
  console.log(`  commits=${report.totals.commits} categories=${JSON.stringify(report.byCategory)} versions=${report.sourceVersions.join(',')}`);
}

main();
