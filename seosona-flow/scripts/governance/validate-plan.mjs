#!/usr/bin/env node
// SEOSONA Flow — Data-First plan validator (Phase 10 / P10.T8, AUD-032).
// Blocks implementation from starting without a repository-derived, accepted
// brief + plan. Validates a plan document contains every Data-First element:
// baseline digest/commit, changed paths, issues, a data gate, a failing check,
// independent verification, an owner, rollback, receipts, and a re-plan rule.
// Default target is the active roadmap; `--plan <file>` validates any plan.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const DEFAULT_PLAN = join(ROOT, 'docs/superpowers/plans/2026-07-15-seosona-flow-10-phase-roadmap.md');

// Each requirement: an id + a regex that must appear in the plan text.
const REQUIREMENTS = [
  { id: 'baseline', re: /baseline\s+(commit|digest|date)/i },
  { id: 'paths', re: /(tracked (files|scope)|changed paths|Files:)/i },
  { id: 'issues', re: /(issue|AUD-\d|SEC-\d)/i },
  { id: 'data-gate', re: /Data gate|Data First|Data Evidence/i },
  { id: 'failing-check', re: /(Test first|failing (check|test)|reproducible negative)/i },
  { id: 'verification', re: /(Verify|Independent Verifier|verification)/i },
  { id: 'owner', re: /(Owner|Primary owner|owns)/i },
  { id: 'rollback', re: /[Rr]ollback/ },
  { id: 'receipts', re: /(receipt|evidence|artifact)/i },
  { id: 'replan', re: /(Re-?plan|Re-plan on Contradiction|update data when)/i },
];

function validate(text) {
  return REQUIREMENTS.filter((r) => !r.re.test(text)).map((r) => r.id);
}

function main() {
  const argv = process.argv.slice(2);
  const pIdx = argv.indexOf('--plan');
  const target = pIdx !== -1 ? (argv[pIdx + 1].startsWith('/') || /^[A-Za-z]:/.test(argv[pIdx + 1]) ? argv[pIdx + 1] : join(ROOT, argv[pIdx + 1])) : DEFAULT_PLAN;
  if (!existsSync(target)) { console.error(`[governance] plan not found: ${target}`); process.exit(1); }
  const missing = validate(readFileSync(target, 'utf8'));
  if (missing.length) {
    console.error('[governance] plan is NOT Data-First — missing: ' + missing.join(', '));
    process.exit(1);
  }
  console.log(`[governance] OK — plan satisfies all ${REQUIREMENTS.length} Data-First requirements.`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { validate, REQUIREMENTS };
