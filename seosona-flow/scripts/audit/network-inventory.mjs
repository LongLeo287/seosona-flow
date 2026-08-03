#!/usr/bin/env node
// SEOSONA Flow — Network initiator inventory (Phase 7 / P7.T1, AUD-021).
// Scans tracked runtime source for every network initiator and assigns each a
// traffic CLASS and the POLICY that must own it, so no call site is unaccounted
// for. Deterministic artifact + `--check` reconciliation gate.
//
// Traffic classes:
//   backend  — SEOSONA/first-party backend (must be gated; blocked in local mode)
//   provider — user-directed AI provider traffic (ChatGPT/Gemini/Grok/Flow/Claude)
//   asset    — same-origin/extension/local resource load
//   download — chrome.downloads (user-initiated save)
//   dynamic  — URL resolved at runtime (variable/template); owned by the
//              NetworkPolicy boundary, still enumerated
//   unknown  — no initiator context at all (FAILS the gate — never expected)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { repoRoot, trackedFiles, stableJson, sha256 } from './lib/repo.mjs';

const ROOT = repoRoot();
const OUT = join(ROOT, 'seosona-flow/artifacts/privacy/phase-07/network-inventory.json');

// Initiator patterns. Each yields call sites we then classify by nearby context.
const INITIATORS = [
  { kind: 'fetch', re: /\bfetch\s*\(/g, policy: 'NetworkPolicy+RuntimeNetworkGate' },
  { kind: 'xhr', re: /\bnew\s+XMLHttpRequest\b/g, policy: 'NetworkPolicy' },
  { kind: 'sse', re: /\bnew\s+EventSource\b/g, policy: 'RuntimeNetworkGate' },
  { kind: 'websocket', re: /\bnew\s+WebSocket\b/g, policy: 'RuntimeNetworkGate' },
  { kind: 'beacon', re: /\bnavigator\s*\.\s*sendBeacon\s*\(/g, policy: 'forbidden' },
  { kind: 'download', re: /\bchrome\s*\.\s*downloads\s*\.\s*download\s*\(/g, policy: 'chrome.downloads' },
];

// Provider/backend origin hints used for classification.
const PROVIDER_HOSTS = /labs\.google|chatgpt\.com|openai\.com|gemini\.google|grok\.com|x\.ai|claude\.ai|anthropic|aisandbox|googleusercontent|storage\.googleapis|flow-content|oaiusercontent/i;
const BACKEND_HOSTS = /seosona|\/api\/|api\.|backend|supabase|firebase|\/enroll|license|telemetry|analytics/i;

// Files that are runtime network surfaces worth scanning. Skip tests/scripts/vendored.
function isScannable(path) {
  if (!path.startsWith('seosona-flow/')) return false;
  if (!/\.js$/.test(path)) return false;
  if (/\/(tests|scripts|node_modules)\//.test(path)) return false;
  if (/\/vendor\//.test(path)) return false;
  return true;
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function classify(context) {
  if (!context) return 'unknown';
  if (BACKEND_HOSTS.test(context)) return 'backend';
  if (PROVIDER_HOSTS.test(context)) return 'provider';
  if (/chrome\.downloads/.test(context)) return 'download';
  if (/chrome-extension:|chrome\.runtime\.getURL|location\.origin|import(?:Scripts)?|\/assets\/|\.css|\.png|\.woff|self\.location|blob:|data:/.test(context)) return 'asset';
  // A runtime-resolved URL (variable or template) — governed at the NetworkPolicy
  // boundary, not statically pinnable to an origin here.
  return 'dynamic';
}

function build() {
  const sites = [];
  for (const path of trackedFiles(ROOT)) {
    if (!isScannable(path)) continue;
    const text = readFileSync(join(ROOT, path), 'utf8');
    for (const initiator of INITIATORS) {
      initiator.re.lastIndex = 0;
      let m;
      while ((m = initiator.re.exec(text)) !== null) {
        const line = lineAt(text, m.index);
        // Context window around the call for classification.
        const ctx = text.slice(Math.max(0, m.index - 320), Math.min(text.length, m.index + 320));
        sites.push({ path, line, kind: initiator.kind, policy: initiator.policy, class: classify(ctx) });
      }
    }
  }
  sites.sort((a, b) => (a.path === b.path ? (a.line - b.line || a.kind.localeCompare(b.kind)) : a.path.localeCompare(b.path)));

  const byClass = {}, byKind = {};
  for (const s of sites) { byClass[s.class] = (byClass[s.class] || 0) + 1; byKind[s.kind] = (byKind[s.kind] || 0) + 1; }
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

  return {
    schema: 'seosona.privacy.network-inventory.v1',
    totals: { sites: sites.length, files: new Set(sites.map((s) => s.path)).size },
    byClass: sortObj(byClass),
    byKind: sortObj(byKind),
    unknownClass: byClass.unknown || 0,
    backendClass: byClass.backend || 0,
    sitesHash: sha256(sites.map((s) => `${s.path}:${s.line}:${s.kind}:${s.class}`).join('\n')),
    sites,
  };
}

function main() {
  const check = process.argv.includes('--check');
  const inv = build();
  const json = stableJson(inv);
  if (check) {
    let cur = null;
    try { cur = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (cur !== json) {
      console.error('[network-inventory] DRIFT — run `node scripts/audit/network-inventory.mjs`');
      process.exit(1);
    }
    if (inv.unknownClass > 0) {
      console.error(`[network-inventory] ${inv.unknownClass} UNCLASSIFIED initiator(s) — every site must be owned.`);
      process.exit(1);
    }
    console.log(`[network-inventory] OK — ${inv.totals.sites} initiators across ${inv.totals.files} files, 0 unknown.`);
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`[network-inventory] wrote ${inv.totals.sites} initiators (unknown=${inv.unknownClass}).`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { build };
