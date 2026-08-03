#!/usr/bin/env node
// SEOSONA Flow — Reliability drills (Phase 10 / P10.T6, AUD-032).
// Runs each failure-injection scenario against the real headless modules and
// records a REDACTED receipt: every critical scenario must recover or fail safe
// (never 'unhandled'). Deterministic artifact + `--check`.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { repoRoot, stableJson } from '../audit/lib/repo.mjs';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { SCENARIOS } from '../../tests/readiness/scenarios/index.mjs';

const ROOT = repoRoot();
const OUT = join(ROOT, 'seosona-flow/artifacts/readiness/phase-10/drills.json');

function helpers() {
  const ctx = loadClassic([
    'src/core/PrivacyFilter.js',
    'src/core/StructuredLogger.js',
    'src/providers/ProviderError.js',
    'src/providers/SelectorResolver.js',
    'src/workflow/WorkflowMigrator.js',
    'src/diagnostics/HealthService.js',
  ]);
  return {
    PrivacyFilter: ctx.SEOSONA_PrivacyFilter,
    StructuredLogger: ctx.SEOSONA_StructuredLogger,
    ProviderError: ctx.SEOSONA_ProviderError,
    SelectorResolver: ctx.SEOSONA_SelectorResolver,
    WorkflowMigrator: ctx.SEOSONA_WorkflowMigrator,
    HealthService: ctx.SEOSONA_HealthService,
  };
}

function build() {
  const h = helpers();
  const results = SCENARIOS.map((s) => {
    let outcome;
    try { outcome = s.run(h); } catch (e) { outcome = { disposition: 'unhandled', detail: String(e && e.message) }; }
    const met = outcome.disposition === s.expects || (s.expects === 'recovered' && outcome.disposition === 'failed-safe');
    return { id: s.id, expects: s.expects, disposition: outcome.disposition, met, detail: String(outcome.detail || '').slice(0, 60) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const unhandled = results.filter((r) => r.disposition === 'unhandled').length;
  const unmet = results.filter((r) => !r.met).length;
  return { schema: 'seosona.readiness.drills.v1', total: results.length, unhandled, unmet, results };
}

function main() {
  const check = process.argv.includes('--check');
  const report = build();
  const json = stableJson(report);
  if (report.unhandled > 0 || report.unmet > 0) {
    console.error(`[drills] ${report.unhandled} unhandled, ${report.unmet} unmet scenarios`);
    process.exit(1);
  }
  if (check) {
    let cur = null; try { cur = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (cur !== json) { console.error('[drills] drift — run `node scripts/readiness/run-drills.mjs`'); process.exit(1); }
    console.log(`[drills] OK — ${report.total} scenarios, all recovered/failed-safe.`);
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`[drills] wrote ${report.total} scenario receipts (0 unhandled).`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { build };
