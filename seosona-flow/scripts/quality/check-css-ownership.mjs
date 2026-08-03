#!/usr/bin/env node
// SEOSONA Flow — CSS ownership + duplication analysis (Phase 8 / P8.T5, AUD-024).
// NON-DESTRUCTIVE: measures the CSS graph (per-file selector counts, bytes, and
// selectors DUPLICATED across files) so ownership can be split incrementally
// with a budget that only moves down. Does not rewrite CSS — it produces the
// evidence that a later extraction reduces duplication. Deterministic report +
// `--check` ratchet (duplicates and total bytes must not increase).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { repoRoot, trackedFiles, stableJson } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const OUT = join(ROOT, 'seosona-flow/artifacts/ux/phase-08/css-ownership.json');

// Strip comments and extract top-level selectors (best-effort, deterministic).
function selectorsOf(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{[^{}]*\}/g; let m;
  while ((m = re.exec(noComments)) !== null) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@')) continue; // skip at-rules
    sel.split(',').forEach((s) => { const t = s.trim().replace(/\s+/g, ' '); if (t) out.push(t); });
  }
  return out;
}

function build() {
  const cssFiles = trackedFiles(ROOT).filter((p) => p.endsWith('.css') && p.startsWith('seosona-flow/') && !/\/lib\//.test(p) && !/\.min\.css$/.test(p));
  const seen = {}; // selector -> [files]
  const perFile = [];
  let totalBytes = 0;
  for (const rel of cssFiles) {
    const css = readFileSync(join(ROOT, rel), 'utf8');
    totalBytes += Buffer.byteLength(css, 'utf8');
    const sels = selectorsOf(css);
    perFile.push({ file: rel, selectors: sels.length, bytes: Buffer.byteLength(css, 'utf8') });
    for (const s of new Set(sels)) { (seen[s] = seen[s] || []).push(rel); }
  }
  const duplicated = Object.entries(seen).filter(([, files]) => files.length > 1);
  perFile.sort((a, b) => a.file.localeCompare(b.file));
  return {
    schema: 'seosona.ux.css-ownership.v1',
    files: cssFiles.length,
    totalBytes,
    totalSelectors: perFile.reduce((a, f) => a + f.selectors, 0),
    crossFileDuplicates: duplicated.length,
    topDuplicates: duplicated.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, 20).map(([sel, files]) => ({ selector: sel, count: files.length })),
    perFile,
  };
}

function main() {
  const check = process.argv.includes('--check');
  const report = build();
  const json = stableJson(report);
  if (check) {
    let cur = null; try { cur = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (cur == null) { console.error('[css-ownership] no baseline — run the generator.'); process.exit(1); }
    const base = JSON.parse(cur);
    if (report.crossFileDuplicates > base.crossFileDuplicates) { console.error(`[css-ownership] REGRESSION: duplicates ${report.crossFileDuplicates} > ${base.crossFileDuplicates}`); process.exit(1); }
    if (report.totalBytes > base.totalBytes) { console.error(`[css-ownership] REGRESSION: bytes ${report.totalBytes} > ${base.totalBytes}`); process.exit(1); }
    console.log(`[css-ownership] OK — ${report.files} files, ${report.crossFileDuplicates} cross-file dup selectors (ratcheted).`);
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`[css-ownership] wrote report: ${report.files} files, ${report.crossFileDuplicates} duplicate selectors.`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { build };
