#!/usr/bin/env node
// SEOSONA Flow — Release notes / changelog evidence (Phase 9 / P9.T7, AUD-029).
// Generates evidence-linked release notes from the committed history report
// (Phase 1 taxonomy) + the current version. `--check` reconciles CHANGELOG.md's
// generated block against the regenerated notes so they can never drift from
// history. Human-authored prose can live outside the generated markers.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const HISTORY = join(ROOT, 'seosona-flow/artifacts/audit/phase-01/history-report.json');
const VERSION = join(ROOT, 'seosona-flow/config/version.json');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');

const BEGIN = '<!-- BEGIN GENERATED NOTES -->';
const END = '<!-- END GENERATED NOTES -->';

function generateBlock() {
  const history = JSON.parse(readFileSync(HISTORY, 'utf8'));
  const version = JSON.parse(readFileSync(VERSION, 'utf8')).version;
  // history-report.json fields: totals.commits (count) and byCategory (map).
  // `commits` is the raw commit ARRAY — never interpolate it directly (renders [object Object]).
  const cats = history.byCategory || history.categories || {};
  const commitCount = (history.totals && history.totals.commits)
    ?? (Array.isArray(history.commits) ? history.commits.length : history.commits)
    ?? 'n/a';
  const lines = [BEGIN, `## ${version}`, ''];
  lines.push(`- Commits analyzed: **${commitCount}**`);
  const catNames = Object.keys(cats).sort();
  if (catNames.length) {
    lines.push('- Change categories:');
    for (const c of catNames) lines.push(`  - ${c}: ${cats[c]}`);
  }
  lines.push('- Evidence: `artifacts/audit/phase-01/history-report.json`, `artifacts/release/phase-09/package-manifest.json`, `artifacts/release/phase-09/sbom.json`.');
  lines.push('', END);
  return lines.join('\n');
}

function assemble() {
  const block = generateBlock();
  let existing = '';
  try { existing = readFileSync(CHANGELOG, 'utf8'); } catch { /* new */ }
  if (existing.includes(BEGIN) && existing.includes(END)) {
    return existing.replace(new RegExp(BEGIN + '[\\s\\S]*?' + END), block);
  }
  const header = '# Changelog\n\n> The block between the generated markers is produced by `scripts/release/release-notes.mjs` from git history + release artifacts. Do not edit it by hand.\n\n';
  return header + block + '\n';
}

function main() {
  const check = process.argv.includes('--check');
  const next = assemble();
  if (check) {
    let cur = null; try { cur = readFileSync(CHANGELOG, 'utf8'); } catch { /* missing */ }
    if (cur !== next) { console.error('[release-notes] CHANGELOG drift — run `node scripts/release/release-notes.mjs`'); process.exit(1); }
    console.log('[release-notes] OK — CHANGELOG reconciles with history + version.');
    return;
  }
  writeFileSync(CHANGELOG, next);
  console.log('[release-notes] wrote CHANGELOG.md generated block.');
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { generateBlock };
