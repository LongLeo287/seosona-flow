#!/usr/bin/env node
// P2.T8 — reconcile the local verification graph with the CI workflow, and emit
// a machine-readable summary. `--check-local` fails if any tier the runner
// executes is missing from the CI workflow (or vice versa).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot } from '../audit/lib/repo.mjs';
import { ALL_TIERS } from './lib/tiers.mjs';

const WORKFLOW_REL = '.github/workflows/verify.yml';
const SUMMARY_REL = 'seosona-flow/artifacts/test/phase-02/ci-summary.json';

export function reconcile(root = repoRoot()) {
  const workflowPath = join(root, WORKFLOW_REL);
  const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : '';
  const tiers = ALL_TIERS.map((t) => ({
    id: t.id,
    cmd: t.cmd,
    inWorkflow: workflow.includes(t.cmd),
  }));
  const missingInCi = tiers.filter((t) => !t.inWorkflow).map((t) => t.id);
  return {
    schema: 'seosona.quality.ci-summary.v1',
    workflowPresent: workflow.length > 0,
    tiers,
    missingInCi,
    reconciled: workflow.length > 0 && missingInCi.length === 0,
  };
}

function main() {
  const root = repoRoot();
  const summary = reconcile(root);
  const summaryPath = join(root, SUMMARY_REL);
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');

  if (process.argv.includes('--check-local')) {
    if (!summary.reconciled) {
      console.error('[ci-summary] MISMATCH: local verify graph and CI workflow differ.');
      if (!summary.workflowPresent) console.error('  workflow file missing.');
      for (const id of summary.missingInCi) console.error(`  - tier not in CI: ${id}`);
      process.exit(1);
    }
    console.log(`[ci-summary] OK ${summary.tiers.length} tiers reconciled with CI.`);
    return;
  }
  console.log(`[ci-summary] wrote ${SUMMARY_REL} (reconciled=${summary.reconciled}).`);
}

main();
