#!/usr/bin/env node
// P4.T6 — page bootstrap manifest. Extracts each page's ordered, CSP-safe local
// <script src> list into config/page-scripts.json (one source of truth) and, in
// --check mode, verifies the HTML still matches it (drift detection). All
// scripts must be local (no external origins) to satisfy the extension CSP.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot, stableJson } from '../audit/lib/repo.mjs';
import { buildArchitectureGraph } from '../audit/lib/graph.mjs';

const CONFIG_REL = 'seosona-flow/config/page-scripts.json';

function buildConfig(root) {
  const graph = buildArchitectureGraph(root);
  const pages = {};
  let external = 0;
  for (const p of graph.pages) {
    pages[p.page] = p.scripts.map((s) => s.src);
    external += p.externalCount;
  }
  return {
    schema: 'seosona.build.page-scripts.v1',
    note: 'One source of truth for per-page local script order. All entries are CSP-safe (self).',
    externalScripts: external,
    pages,
  };
}

const root = repoRoot();
const config = buildConfig(root);
const serialized = stableJson(config);
const configPath = join(root, CONFIG_REL);
const check = process.argv.includes('--check');

if (config.externalScripts > 0) {
  console.error(`[build:pages] ${config.externalScripts} external script(s) — CSP would block these.`);
  process.exit(1);
}

if (check) {
  if (!existsSync(configPath)) { console.error('[build:pages] MISSING config'); process.exit(1); }
  if (readFileSync(configPath, 'utf8') !== serialized) {
    console.error('[build:pages] DRIFT: page script lists differ from config/page-scripts.json.');
    process.exit(1);
  }
  const pageCount = Object.keys(config.pages).length;
  console.log(`[build:pages] OK ${pageCount} pages match config; all scripts local.`);
} else {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, serialized);
  console.log(`[build:pages] wrote ${CONFIG_REL} (${Object.keys(config.pages).length} pages).`);
}
