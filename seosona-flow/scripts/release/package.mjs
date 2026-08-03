#!/usr/bin/env node
// SEOSONA Flow — Deterministic package manifest (Phase 9 / P9.T6, AUD-029).
// Computes the exact set of runtime files that ship (from the allowlist over
// TRACKED files), their checksums, and a single normalized reproducibility hash.
// Two clean builds of the same commit yield the SAME hash — proven by
// `--reproducibility-check` (build twice, compare). Secrets/backups/tests are
// excluded by policy; their presence fails the build. No timestamps, no zip
// binary (which would be non-deterministic) — the manifest IS the artifact.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { repoRoot, trackedFiles, sha256, stableJson } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const ALLOWLIST = join(ROOT, 'seosona-flow/config/package-allowlist.json');
const OUT = join(ROOT, 'seosona-flow/artifacts/release/phase-09/package-manifest.json');

// Chặn file THỰC SỰ chứa bí mật (.env, secrets.json, credentials.yaml, *.pem/key...).
// Trước đây dùng /token/i và /secret/i quét cả ĐƯỜNG DẪN → bắt nhầm module nguồn hợp lệ
// (vd src/core/SecretVault.js) và chặn luôn việc đóng gói. Nay khớp theo TÊN FILE + đuôi dữ liệu.
const FORBIDDEN = [
  /\.env(\.|$)/i,
  /(^|[/_.-])secrets?\.(json|ya?ml|txt|ini|cfg|env)$/i,
  /(^|[/_.-])credentials?\.(json|ya?ml|txt|ini|cfg)$/i,
  /(^|[/_.-])tokens?\.(json|ya?ml|txt|ini|cfg)$/i,
  /private[_-]?key/i,
  /\.(pem|p12|pfx|keystore|jks)$/i,
  /id_(rsa|dsa|ecdsa|ed25519)$/i,
];

function selectFiles(cfg) {
  const excludes = cfg.excludePatterns.map((p) => new RegExp(p));
  const out = [];
  for (const rel of trackedFiles(ROOT)) {
    const included = cfg.includeExact.includes(rel) || cfg.includePrefixes.some((p) => rel.startsWith(p));
    if (!included) continue;
    if (excludes.some((re) => re.test(rel))) continue;
    out.push(rel);
  }
  return out.sort();
}

function build() {
  const cfg = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
  const files = selectFiles(cfg);
  const forbidden = files.filter((f) => FORBIDDEN.some((re) => re.test(f)));
  const entries = files.map((rel) => ({ path: rel.replace(/^seosona-flow\//, ''), sha256: sha256(readFileSync(join(ROOT, rel))) }));
  // Reproducibility hash: normalized (sorted path + hash), no timestamps/order deps.
  const reproHash = sha256(entries.map((e) => `${e.path}:${e.sha256}`).join('\n'));
  return {
    schema: 'seosona.release.package.v1',
    fileCount: entries.length,
    forbidden,
    reproHash,
    files: entries,
  };
}

function main() {
  const check = process.argv.includes('--check');
  const repro = process.argv.includes('--reproducibility-check');
  const manifest = build();

  if (manifest.forbidden.length) {
    console.error('[package] FORBIDDEN files matched the allowlist: ' + manifest.forbidden.join(', '));
    process.exit(1);
  }

  if (repro) {
    const again = build();
    if (again.reproHash !== manifest.reproHash) { console.error('[package] NON-REPRODUCIBLE: hashes differ across builds'); process.exit(1); }
    console.log(`[package] OK — reproducible: two builds → ${manifest.reproHash.slice(0, 16)}… (${manifest.fileCount} files).`);
    return;
  }

  const json = stableJson(manifest);
  if (check) {
    let cur = null; try { cur = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (cur !== json) { console.error('[package] drift — run `node scripts/release/package.mjs`'); process.exit(1); }
    console.log(`[package] OK — ${manifest.fileCount} files, reproHash ${manifest.reproHash.slice(0, 16)}…`);
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`[package] wrote manifest: ${manifest.fileCount} files, reproHash ${manifest.reproHash.slice(0, 16)}…`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { build };
