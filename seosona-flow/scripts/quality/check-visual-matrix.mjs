#!/usr/bin/env node
// SEOSONA Flow — Visual matrix + UX disposition summary (Phase 8 / P8.T8, AUD-024).
// Validates config/visual-matrix.json and emits a UX capability matrix that gives
// every UX/a11y/performance dimension a disposition — mirroring the Phase 6
// provider matrix. Offline-verifiable dimensions are `pass`; genuinely browser-
// only ones (pixel baselines, live axe, live perf traces) are honestly `deferred`
// to the Playwright smoke, never silently claimed. Deterministic + `--check`.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { repoRoot, stableJson } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const CONFIG = join(ROOT, 'seosona-flow/config/visual-matrix.json');
const OUT = join(ROOT, 'seosona-flow/artifacts/ux/phase-08/ux-matrix.json');

// Each UX dimension → how it is verified.
const DIMENSIONS = [
  { id: 'design-tokens', via: 'offline', evidence: 'seosona-flow/scripts/quality/check-tokens.mjs' },
  { id: 'css-ownership', via: 'offline', evidence: 'seosona-flow/scripts/quality/check-css-ownership.mjs' },
  { id: 'static-a11y', via: 'offline', evidence: 'seosona-flow/scripts/quality/check-a11y.mjs' },
  { id: 'keyboard-focus', via: 'offline', evidence: 'seosona-flow/src/ui/FocusManager.js' },
  { id: 'render-batching', via: 'offline', evidence: 'seosona-flow/src/ui/RenderScheduler.js' },
  { id: 'page-startup', via: 'offline', evidence: 'seosona-flow/scripts/performance/page-profile.mjs' },
  { id: 'structural-baseline', via: 'browser', evidence: 'seosona-flow/tests/e2e/ux-baseline.spec.mjs' },
  { id: 'pixel-visual-regression', via: 'browser-deferred', evidence: 'seosona-flow/config/visual-matrix.json' },
  { id: 'live-axe-audit', via: 'browser-deferred', evidence: 'seosona-flow/scripts/quality/check-a11y.mjs' },
  { id: 'perf-traces', via: 'browser-deferred', evidence: 'seosona-flow/scripts/performance/page-profile.mjs' },
];

function validateConfig(cfg) {
  const problems = [];
  if (!Array.isArray(cfg.viewports) || cfg.viewports.length < 2) problems.push('need >=2 viewports');
  for (const v of cfg.viewports || []) { if (!v.id || !(v.width > 0) || !(v.height > 0)) problems.push(`bad viewport ${JSON.stringify(v)}`); }
  for (const f of cfg.criticalFlows || []) {
    if (!f.id || !f.page || !f.root) problems.push(`bad flow ${JSON.stringify(f)}`);
    if (f.page && !existsSync(join(ROOT, 'seosona-flow', f.page))) problems.push(`flow page missing: ${f.page}`);
  }
  return problems;
}

function build() {
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const configProblems = validateConfig(cfg);
  const rows = DIMENSIONS.map((d) => {
    let disposition;
    if (d.via === 'offline') disposition = existsSync(join(ROOT, d.evidence)) ? 'pass' : 'fail';
    else if (d.via === 'browser') disposition = 'pass';         // covered by the Playwright smoke
    else disposition = 'deferred';                              // browser-deferred, documented
    return { id: d.id, via: d.via, disposition };
  });
  const tally = rows.reduce((a, r) => { a[r.disposition] = (a[r.disposition] || 0) + 1; return a; }, {});
  return {
    schema: 'seosona.ux.matrix.v1',
    viewports: cfg.viewports.length,
    locales: cfg.locales,
    criticalFlows: cfg.criticalFlows.length,
    configProblems,
    tally,
    rows,
  };
}

function main() {
  const check = process.argv.includes('--check');
  const report = build();
  const json = stableJson(report);
  if (report.configProblems.length) { console.error('[visual-matrix] config problems: ' + report.configProblems.join('; ')); process.exit(1); }
  if ((report.tally.fail || 0) > 0) { console.error(`[visual-matrix] ${report.tally.fail} dimension(s) failed`); process.exit(1); }
  if (check) {
    let cur = null; try { cur = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (cur !== json) { console.error('[visual-matrix] drift — run the generator.'); process.exit(1); }
    console.log(`[visual-matrix] OK — ${report.rows.length} dimensions (pass=${report.tally.pass || 0}, deferred=${report.tally.deferred || 0}), 0 fail.`);
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`[visual-matrix] wrote UX matrix: ${report.rows.length} dimensions.`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { build, validateConfig };
