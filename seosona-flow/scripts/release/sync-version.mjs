#!/usr/bin/env node
// SEOSONA Flow — Version source of truth (Phase 9 / P9.T5, AUD-027).
// config/version.json is the ONE place the product version lives. This reconciles
// every declared consumer (currently the manifest) against it and validates
// semantic progression. `--check` fails on any mismatch; default writes consumers.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const VERSION = join(ROOT, 'seosona-flow/config/version.json');

function isSemverish(v) { return /^\d+\.\d+\.\d+$/.test(String(v)); }

function readConsumer(file) {
  const abs = join(ROOT, 'seosona-flow', file);
  return { abs, json: JSON.parse(readFileSync(abs, 'utf8')) };
}

function build() {
  const cfg = JSON.parse(readFileSync(VERSION, 'utf8'));
  const problems = [];
  if (!isSemverish(cfg.version)) problems.push(`version.json version not semver: ${cfg.version}`);
  const rows = [];
  for (const c of cfg.consumers || []) {
    const { json } = readConsumer(c.file);
    const actual = json[c.path];
    const ok = actual === cfg.version;
    if (!ok) problems.push(`${c.file}.${c.path} = ${actual} != ${cfg.version}`);
    rows.push({ file: c.file, path: c.path, actual, expected: cfg.version, ok });
  }
  return { version: cfg.version, schemaVersions: cfg.schemaVersions, rows, problems };
}

function main() {
  const check = process.argv.includes('--check');
  const result = build();
  if (check) {
    if (result.problems.length) { console.error('[version] mismatch:\n  ' + result.problems.join('\n  ')); process.exit(1); }
    console.log(`[version] OK — ${result.version} reconciled across ${result.rows.length} consumer(s).`);
    return;
  }
  // Write mode: push version.json's version into each consumer.
  const cfg = JSON.parse(readFileSync(VERSION, 'utf8'));
  for (const c of cfg.consumers || []) {
    const { abs, json } = readConsumer(c.file);
    if (json[c.path] !== cfg.version) {
      json[c.path] = cfg.version;
      writeFileSync(abs, JSON.stringify(json, null, 2) + '\n');
      console.log(`[version] set ${c.file}.${c.path} = ${cfg.version}`);
    }
  }
  console.log('[version] consumers synced.');
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { build };
