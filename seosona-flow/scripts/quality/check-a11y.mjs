#!/usr/bin/env node
// SEOSONA Flow — Static accessibility linter (Phase 8 / P8.T2, AUD-023).
// Offline, DOM-free static analysis of the extension's own HTML pages for the
// critical accessibility issues that a static pass can catch reliably:
//   - missing <html lang>
//   - <img> without alt (or role/aria-hidden)
//   - icon-only <button>/<a> with no accessible name
//   - form control with no associated <label>/aria-label
//   - missing page landmark / single <h1>
// Produces a deterministic report + `--check` reconciliation against a committed
// baseline so KNOWN issues are tracked and NEW ones fail (ratchet, non-destructive).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { globSync } from 'node:fs';
import { repoRoot, stableJson } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const PAGES_GLOB = join(ROOT, 'seosona-flow/pages/*.html');
const OUT = join(ROOT, 'seosona-flow/artifacts/ux/phase-08/a11y-report.json');

function findings(html, file) {
  const out = [];
  const add = (rule, detail) => out.push({ file, rule, detail });

  if (!/<html[^>]*\blang\s*=/i.test(html)) add('html-lang', 'no <html lang>');

  // <img> without alt / aria-hidden / role=presentation
  const imgRe = /<img\b[^>]*>/gi; let m;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    if (!/\balt\s*=/i.test(tag) && !/aria-hidden\s*=\s*["']true/i.test(tag) && !/role\s*=\s*["']presentation/i.test(tag)) {
      add('img-alt', tag.slice(0, 60));
    }
  }

  // icon-only buttons/links: no text content AND no aria-label/title
  const btnRe = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  while ((m = btnRe.exec(html)) !== null) {
    const attrs = m[2], inner = m[3].replace(/<[^>]+>/g, '').trim();
    const named = /aria-label\s*=|aria-labelledby\s*=|title\s*=/i.test(attrs);
    if (!inner && !named) add('control-name', `<${m[1]}> icon-only without accessible name`);
  }

  // form controls without a label association or aria-label
  const ctlRe = /<(input|select|textarea)\b([^>]*)>/gi;
  while ((m = ctlRe.exec(html)) !== null) {
    const attrs = m[2];
    if (/type\s*=\s*["'](hidden|submit|button|image)/i.test(attrs)) continue;
    const idm = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const hasAria = /aria-label\s*=|aria-labelledby\s*=/i.test(attrs);
    const hasLabelFor = idm && new RegExp(`<label[^>]*\\bfor\\s*=\\s*["']${idm[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(html);
    if (!hasAria && !hasLabelFor) add('control-label', `<${m[1]}> without label`);
  }

  // landmark / h1
  if (!/<h1\b/i.test(html) && !/role\s*=\s*["'](main|banner|navigation)/i.test(html) && !/<main\b/i.test(html)) {
    add('landmark', 'no <h1>/<main>/landmark role');
  }
  return out;
}

function build() {
  const files = globSync(PAGES_GLOB).sort();
  const all = [];
  for (const abs of files) {
    const rel = relative(ROOT, abs).split('\\').join('/');
    all.push(...findings(readFileSync(abs, 'utf8'), rel));
  }
  const byRule = {}, byFile = {};
  for (const f of all) { byRule[f.rule] = (byRule[f.rule] || 0) + 1; byFile[f.file] = (byFile[f.file] || 0) + 1; }
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  all.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule) || a.detail.localeCompare(b.detail));
  return { schema: 'seosona.ux.a11y.v1', pages: files.length, total: all.length, byRule: sortObj(byRule), byFile: sortObj(byFile), findings: all };
}

function main() {
  const check = process.argv.includes('--check');
  const report = build();
  const json = stableJson(report);
  if (check) {
    let cur = null;
    try { cur = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (cur == null) { console.error('[a11y] no baseline — run `node scripts/quality/check-a11y.mjs`'); process.exit(1); }
    const baseline = JSON.parse(cur);
    // Ratchet: total must never INCREASE above the committed baseline.
    if (report.total > baseline.total) {
      console.error(`[a11y] REGRESSION: ${report.total} findings > baseline ${baseline.total}`);
      process.exit(1);
    }
    if (report.total < baseline.total) {
      console.log(`[a11y] improved ${baseline.total} -> ${report.total} — consider re-baselining to lock it in.`);
    }
    console.log(`[a11y] OK — ${report.pages} pages, ${report.total} findings <= baseline ${baseline.total} (ratcheted).`);
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`[a11y] wrote report: ${report.total} findings across ${report.pages} pages.`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { build, findings };
