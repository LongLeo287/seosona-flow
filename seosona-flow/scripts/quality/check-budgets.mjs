#!/usr/bin/env node
// P2.T7 — quality budgets. Counts known debt across PRODUCT code (tracked JS,
// excluding vendored lib/ and my own tooling) and ratchets: any regression
// above the committed baseline fails. `--update` rewrites the baseline.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot, trackedFiles } from '../audit/lib/repo.mjs';

const EXT_PREFIX = 'seosona-flow/';
const BASELINE_REL = 'seosona-flow/artifacts/quality/budgets-baseline.json';
const OVERSIZE_LINES = 5000;

function productJsFiles(root) {
  return trackedFiles(root)
    .filter((p) => p.startsWith(EXT_PREFIX) && p.endsWith('.js'))
    .filter((p) => !p.startsWith(`${EXT_PREFIX}lib/`)) // vendored excluded
    .map((p) => p.slice(EXT_PREFIX.length));
}

function countMatches(text, re) {
  return (text.match(re) || []).length;
}

export function computeBudgets(root = repoRoot()) {
  const files = productJsFiles(root);
  const metrics = { emptyCatch: 0, consoleCalls: 0, globalWrites: 0, eslintDisables: 0, oversizedFiles: 0 };
  const oversized = [];
  for (const rel of files) {
    const text = readFileSync(join(root, EXT_PREFIX, rel), 'utf8');
    metrics.emptyCatch += countMatches(text, /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g);
    metrics.consoleCalls += countMatches(text, /\bconsole\.\w+\s*\(/g);
    // `self.X =` is only a global write when `self` is the real global; files that
    // alias `var self = this` are writing instance properties, so exclude self there.
    const selfIsLocal = /\b(?:var|let|const)\s+self\s*=\s*this\b/.test(text);
    const globalWriteRe = selfIsLocal
      ? /\b(?:window|globalThis)\.\w+\s*=(?!=)/g
      : /\b(?:window|globalThis|self)\.\w+\s*=(?!=)/g;
    metrics.globalWrites += countMatches(text, globalWriteRe);
    metrics.eslintDisables += countMatches(text, /eslint-disable/g);
    const lines = text.split('\n').length;
    if (lines > OVERSIZE_LINES) {
      metrics.oversizedFiles += 1;
      oversized.push({ path: rel, lines });
    }
  }
  return {
    schema: 'seosona.quality.budgets.v1',
    fileCount: files.length,
    oversizeThreshold: OVERSIZE_LINES,
    metrics,
    oversized: oversized.sort((a, b) => b.lines - a.lines),
  };
}

function main() {
  const root = repoRoot();
  const update = process.argv.includes('--update');
  const current = computeBudgets(root);
  const baselinePath = join(root, BASELINE_REL);

  if (update || !existsSync(baselinePath)) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
    console.log(`[budgets] ${update ? 'updated' : 'initialized'} baseline: ${JSON.stringify(current.metrics)}`);
    return;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const regressions = [];
  for (const [k, v] of Object.entries(current.metrics)) {
    if (v > baseline.metrics[k]) regressions.push(`${k}: ${baseline.metrics[k]} -> ${v}`);
  }
  if (regressions.length > 0) {
    console.error('[budgets] REGRESSION — a quality budget increased:');
    for (const r of regressions) console.error(`  - ${r}`);
    console.error('  Reduce the debt, or run check-budgets.mjs --update with justification.');
    process.exit(1);
  }
  const improvements = Object.entries(current.metrics).filter(([k, v]) => v < baseline.metrics[k]);
  console.log(`[budgets] OK no regression across ${current.fileCount} product files.`);
  if (improvements.length) console.log(`  improved: ${improvements.map(([k, v]) => `${k}:${baseline.metrics[k]}->${v}`).join(', ')}`);
}

main();
