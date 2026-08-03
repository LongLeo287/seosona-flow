#!/usr/bin/env node
// SEOSONA Flow — Provider fixture sanitizer + safety gate (Phase 6 / P6.T2).
//
// Provider DOM fixtures must NEVER carry authenticated or private data: no
// emails/identities, no tokens/secrets/cookies, and no live third-party origins
// that a test could accidentally fetch. This module both:
//   - scanForPrivateData(html)  → findings[] (the gate; zero = safe)
//   - sanitize(html)            → redacted html (for cleaning a raw capture)
// and a CLI that manages a deterministic hash manifest of the fixture corpus.
//
// Only reserved/synthetic origins are allowed in fixtures: hosts under
// .test / .example / .invalid / .localhost, or example.com|org|net. Anything
// else is treated as a live origin and rejected.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { repoRoot, sha256, stableJson } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const FIXTURE_DIR = join(ROOT, 'seosona-flow/tests/fixtures/providers');
const MANIFEST = join(ROOT, 'seosona-flow/artifacts/providers/phase-06/fixtures-manifest.json');

// ---- Detection rules --------------------------------------------------------
const RULES = [
  { code: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, redact: '<redacted-email>' },
  { code: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, redact: '<redacted-jwt>' },
  { code: 'OPENAI_KEY', re: /\bsk-[A-Za-z0-9]{20,}/g, redact: '<redacted-key>' },
  { code: 'GITHUB_TOKEN', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, redact: '<redacted-token>' },
  { code: 'GOOGLE_KEY', re: /\bAIza[0-9A-Za-z_-]{20,}/g, redact: '<redacted-key>' },
  { code: 'BEARER', re: /\bBearer\s+[A-Za-z0-9._-]{10,}/gi, redact: 'Bearer <redacted>' },
  { code: 'COOKIE', re: /(?:Set-Cookie:|__Secure-|__Host-)[^\s"']*/gi, redact: '<redacted-cookie>' },
  { code: 'SECRET_ASSIGN', re: /\b(token|secret|password|api[_-]?key|authorization|session[_-]?id|csrf[_-]?token)\b\s*[=:]\s*["']?[A-Za-z0-9._-]{16,}["']?/gi, redact: '$1=<redacted>' },
  { code: 'PRIVATE_ATTR', re: /\bdata-(?:email|phone|user-email|full-name|account-email)\s*=\s*["'][^"']+["']/gi, redact: 'data-redacted="1"' },
];

const ORIGIN_RE = /\bhttps?:\/\/([A-Za-z0-9.-]+)(?::\d+)?/g;
function isAllowedHost(host) {
  const h = host.toLowerCase();
  if (h === 'localhost') return true;
  if (/\.(test|example|invalid|localhost)$/.test(h)) return true;
  if (/^(www\.)?example\.(com|org|net)$/.test(h)) return true;
  return false;
}

// Line/col for a character index (diagnostics only).
function locOf(text, index) {
  let line = 1, col = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) { line++; col = 1; } else col++;
  }
  return { line, col };
}

export function scanForPrivateData(html) {
  const findings = [];
  const text = String(html);
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const { line } = locOf(text, m.index);
      findings.push({ code: rule.code, line, sample: m[0].slice(0, 24) });
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++; // zero-width guard
    }
  }
  ORIGIN_RE.lastIndex = 0;
  let o;
  while ((o = ORIGIN_RE.exec(text)) !== null) {
    if (!isAllowedHost(o[1])) {
      const { line } = locOf(text, o.index);
      findings.push({ code: 'EXTERNAL_ORIGIN', line, sample: o[0].slice(0, 40) });
    }
  }
  return findings;
}

export function sanitize(html) {
  let out = String(html);
  for (const rule of RULES) out = out.replace(rule.re, rule.redact);
  out = out.replace(ORIGIN_RE, (full, host) => (isAllowedHost(host) ? full : 'https://redacted.invalid'));
  return out;
}

// ---- Fixture corpus ---------------------------------------------------------
function listFixtures() {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries.sort()) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.html')) out.push(p);
    }
  }
  walk(FIXTURE_DIR);
  return out;
}

export function buildManifest() {
  const files = listFixtures();
  const entries = files.map((abs) => {
    const buf = readFileSync(abs);
    return {
      path: relative(ROOT, abs).split('\\').join('/'),
      bytes: buf.length,
      sha256: sha256(buf),
      findings: scanForPrivateData(buf.toString('utf8')).length,
    };
  });
  return { schema: 'seosona.providers.fixtures.v1', count: entries.length, fixtures: entries };
}

function scanAll() {
  const problems = [];
  for (const abs of listFixtures()) {
    const rel = relative(ROOT, abs).split('\\').join('/');
    const findings = scanForPrivateData(readFileSync(abs, 'utf8'));
    if (findings.length) problems.push({ file: rel, findings });
  }
  return problems;
}

function main() {
  const mode = process.argv[2];

  // Sanitize a single raw capture into a clean fixture.
  if (mode && !mode.startsWith('--')) {
    const input = mode;
    const output = process.argv[3] || input;
    const cleaned = sanitize(readFileSync(input, 'utf8'));
    const left = scanForPrivateData(cleaned);
    if (left.length) {
      console.error(`[fixture] sanitize could not fully clean ${input}:`, left);
      process.exit(1);
    }
    writeFileSync(output, cleaned);
    console.log(`[fixture] sanitized ${input} -> ${output}`);
    return;
  }

  const problems = scanAll();
  if (problems.length) {
    console.error('[fixture] PRIVATE DATA detected in fixtures:');
    for (const p of problems) console.error(`  ${p.file}: ${p.findings.map((f) => `${f.code}@L${f.line}`).join(', ')}`);
    process.exit(1);
  }

  const manifest = buildManifest();
  if (mode === '--check') {
    let current;
    try { current = readFileSync(MANIFEST, 'utf8'); } catch { current = null; }
    const next = stableJson(manifest);
    if (current !== next) {
      console.error('[fixture] manifest drift — run `node scripts/test/sanitize-provider-fixture.mjs --manifest`');
      process.exit(1);
    }
    console.log(`[fixture] OK — ${manifest.count} fixtures clean, manifest reconciled.`);
    return;
  }

  // Default / --manifest: (re)write the manifest.
  writeFileSync(MANIFEST, stableJson(manifest));
  console.log(`[fixture] wrote manifest for ${manifest.count} clean fixtures.`);
}

// Run as CLI only (not when imported by tests).
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
