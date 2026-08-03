#!/usr/bin/env node
// SEOSONA Flow — Design token linter (Phase 8 / P8.T4, AUD-024).
// Validates styles/tokens.css declares every required token CATEGORY, and counts
// raw color literals across component CSS as a migration budget (ratchet down as
// components adopt tokens). Deterministic report + `--check`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { repoRoot, trackedFiles, stableJson } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const TOKENS = join(ROOT, 'seosona-flow/styles/tokens.css');
const OUT = join(ROOT, 'seosona-flow/artifacts/ux/phase-08/tokens-report.json');

const REQUIRED = [
  { category: 'color', re: /--sf-color-/ },
  { category: 'spacing', re: /--sf-space-/ },
  { category: 'radius', re: /--sf-radius-/ },
  { category: 'shadow', re: /--sf-shadow-/ },
  { category: 'zindex', re: /--sf-z-/ },
  { category: 'typography', re: /--sf-font-/ },
  { category: 'focus', re: /--sf-focus-/ },
];

function countLiterals(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const hex = (noComments.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
  const rgb = (noComments.match(/\brgba?\(/g) || []).length;
  return hex + rgb;
}

function build() {
  const tokensCss = readFileSync(TOKENS, 'utf8');
  const missing = REQUIRED.filter((r) => !r.re.test(tokensCss)).map((r) => r.category);
  const cssFiles = trackedFiles(ROOT).filter((p) => p.endsWith('.css') && p.startsWith('seosona-flow/styles/') && !p.endsWith('tokens.css'));
  let literals = 0;
  const perFile = cssFiles.map((rel) => {
    const n = countLiterals(readFileSync(join(ROOT, rel), 'utf8'));
    literals += n;
    return { file: rel, colorLiterals: n };
  });
  perFile.sort((a, b) => a.file.localeCompare(b.file));
  return { schema: 'seosona.ux.tokens.v1', categoriesRequired: REQUIRED.length, missingCategories: missing, componentColorLiterals: literals, perFile };
}

function main() {
  const check = process.argv.includes('--check');
  const report = build();
  const json = stableJson(report);
  if (report.missingCategories.length) {
    console.error(`[tokens] tokens.css missing categories: ${report.missingCategories.join(', ')}`);
    if (check) process.exit(1);
  }
  if (check) {
    let cur = null; try { cur = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (cur == null) { console.error('[tokens] no baseline — run the generator.'); process.exit(1); }
    const base = JSON.parse(cur);
    if (report.componentColorLiterals > base.componentColorLiterals) { console.error(`[tokens] REGRESSION: color literals ${report.componentColorLiterals} > ${base.componentColorLiterals}`); process.exit(1); }
    console.log(`[tokens] OK — all ${report.categoriesRequired} categories present, ${report.componentColorLiterals} literals <= baseline (ratcheted).`);
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`[tokens] wrote report: ${report.missingCategories.length} missing categories, ${report.componentColorLiterals} literals.`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { build };
