#!/usr/bin/env node
// SEOSONA Flow — Static page startup profile (Phase 8 / P8.T6, AUD-025).
// Offline static analysis of each extension page: how many scripts it loads,
// their total tracked byte weight, whether any are render-blocking (no defer/
// async/module in <head>), and duplicate includes. This is a startup-cost proxy
// that runs without a browser; the browser profile refines it. Deterministic
// report + `--check` reconciliation (budget ratchet).
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { globSync } from 'node:fs';
import { repoRoot, stableJson } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const EXT = join(ROOT, 'seosona-flow');
const PAGES_GLOB = join(EXT, 'pages/*.html');
const OUT = join(EXT, 'artifacts/ux/phase-08/page-profile.json');

function scriptsOf(html) {
  const out = [];
  const re = /<script\b([^>]*)>/gi; let m;
  const headEnd = (() => { const h = /<\/head>/i.exec(html); return h ? h.index : html.length; })();
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    out.push({
      src: src ? src[1] : null,
      inline: !src,
      defer: /\bdefer\b/i.test(attrs),
      async: /\basync\b/i.test(attrs),
      module: /type\s*=\s*["']module/i.test(attrs),
      inHead: m.index < headEnd,
    });
  }
  return out;
}

function resolveBytes(pageAbs, src) {
  if (!src || /^https?:|^chrome-extension:|^data:/.test(src)) return 0;
  const clean = src.split('?')[0].replace(/^\.\//, '');
  const candidates = [join(dirname(pageAbs), clean), join(EXT, clean.replace(/^\//, ''))];
  for (const c of candidates) { if (existsSync(c) && statSync(c).isFile()) return statSync(c).size; }
  return 0;
}

function build() {
  const files = globSync(PAGES_GLOB).sort();
  const pages = files.map((abs) => {
    const rel = relative(ROOT, abs).split('\\').join('/');
    const scripts = scriptsOf(readFileSync(abs, 'utf8'));
    const external = scripts.filter((s) => s.src);
    const seen = {}, duplicates = [];
    for (const s of external) { if (seen[s.src]) duplicates.push(s.src); else seen[s.src] = true; }
    const blocking = external.filter((s) => s.inHead && !s.defer && !s.async && !s.module).length;
    const bytes = external.reduce((sum, s) => sum + resolveBytes(abs, s.src), 0);
    return { page: rel, scripts: scripts.length, external: external.length, inline: scripts.length - external.length, blockingInHead: blocking, duplicates: duplicates.length, bytes };
  });
  const totals = pages.reduce((a, p) => ({ scripts: a.scripts + p.scripts, blockingInHead: a.blockingInHead + p.blockingInHead, duplicates: a.duplicates + p.duplicates, bytes: a.bytes + p.bytes }), { scripts: 0, blockingInHead: 0, duplicates: 0, bytes: 0 });
  return { schema: 'seosona.ux.page-profile.v1', pageCount: pages.length, totals, pages };
}

function main() {
  const check = process.argv.includes('--check');
  const report = build();
  const json = stableJson(report);
  if (check) {
    let cur = null; try { cur = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (cur == null) { console.error('[page-profile] no baseline — run the generator.'); process.exit(1); }
    const base = JSON.parse(cur);
    // Ratchet: script count, blocking scripts, and duplicates must not increase.
    for (const k of ['scripts', 'blockingInHead', 'duplicates']) {
      if (report.totals[k] > base.totals[k]) { console.error(`[page-profile] REGRESSION: ${k} ${report.totals[k]} > ${base.totals[k]}`); process.exit(1); }
    }
    console.log(`[page-profile] OK — ${report.pageCount} pages, ${report.totals.scripts} scripts, ${report.totals.blockingInHead} blocking (ratcheted).`);
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`[page-profile] wrote profile: ${report.totals.scripts} scripts across ${report.pageCount} pages.`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { build };
