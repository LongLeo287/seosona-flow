// P6.T2 tests — provider fixture safety.
// positive / negative / boundary / regression across: logged out, ready,
// generating, complete, failure, challenge, drift, secrets, and identities.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, sha256 } from '../../scripts/audit/lib/repo.mjs';
import { scanForPrivateData, sanitize, buildManifest } from '../../scripts/test/sanitize-provider-fixture.mjs';

const ROOT = repoRoot();
const FIX = join(ROOT, 'seosona-flow/tests/fixtures/providers');

function allFixtures() {
  const out = [];
  (function walk(d) {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.html')) out.push(p);
    }
  })(FIX);
  return out;
}

test('positive: every on-disk fixture is free of private data', () => {
  const files = allFixtures();
  assert.ok(files.length >= 15, `expected a real corpus, got ${files.length}`);
  for (const f of files) {
    const findings = scanForPrivateData(readFileSync(f, 'utf8'));
    assert.equal(findings.length, 0, `${f}: ${JSON.stringify(findings)}`);
  }
});

test('positive: the corpus covers the required provider states', () => {
  const names = allFixtures().map((f) => f.split(/[\\/]/).slice(-2).join('/'));
  const joined = names.join(' ');
  for (const state of ['logged-out', 'ready', 'generating', 'complete', 'failure', 'challenge', 'drift']) {
    assert.ok(joined.includes(state), `no fixture for state "${state}"`);
  }
  // All five providers represented.
  for (const p of ['chatgpt/', 'gemini/', 'grok/', 'claude/', 'flow/']) {
    assert.ok(joined.includes(p), `no fixtures for provider "${p}"`);
  }
});

test('negative: scanner catches an email identity', () => {
  const f = scanForPrivateData('<div data-user="real.person@gmail.com">hi</div>');
  assert.ok(f.some((x) => x.code === 'EMAIL'));
});

test('negative: scanner catches tokens/secrets (JWT, sk-, Bearer, assignment)', () => {
  assert.ok(scanForPrivateData('token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcd').some((x) => x.code === 'JWT'));
  assert.ok(scanForPrivateData('key=sk-ABCDEFGHIJKLMNOPQRSTUVWX').some((x) => x.code === 'OPENAI_KEY'));
  assert.ok(scanForPrivateData('authorization: Bearer abcdef0123456789xyz').some((x) => x.code === 'BEARER'));
  assert.ok(scanForPrivateData('session_id="0123456789abcdef0123"').some((x) => x.code === 'SECRET_ASSIGN'));
});

test('negative: scanner catches a live third-party origin', () => {
  const f = scanForPrivateData('<img src="https://lh3.googleusercontent.com/private/abc">');
  assert.ok(f.some((x) => x.code === 'EXTERNAL_ORIGIN'));
});

test('negative: scanner catches a session cookie', () => {
  assert.ok(scanForPrivateData('Set-Cookie: __Secure-session=abc123').some((x) => x.code === 'COOKIE'));
});

test('boundary: reserved synthetic origins are allowed', () => {
  for (const ok of [
    '<img src="https://cdn.example.test/x.png">',
    '<a href="https://auth.example.test/login">',
    '<iframe src="https://challenges.cloudflare.test/turnstile">',
    '<img src="https://example.com/x">',
  ]) {
    assert.equal(scanForPrivateData(ok).length, 0, ok);
  }
});

test('boundary: sanitize() renders a dirty capture clean', () => {
  const dirty = '<div data-user="a@b.com">Bearer sk-ABCDEFGHIJKLMNOPQRSTUVWX at https://real.googleusercontent.com/x</div>';
  assert.ok(scanForPrivateData(dirty).length > 0);
  const clean = sanitize(dirty);
  assert.equal(scanForPrivateData(clean).length, 0, clean);
});

test('regression: manifest reconciles with on-disk hashes (no drift)', () => {
  const manifest = buildManifest();
  const onDisk = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/providers/phase-06/fixtures-manifest.json'), 'utf8'));
  assert.equal(manifest.count, onDisk.count);
  for (const entry of manifest.fixtures) {
    const match = onDisk.fixtures.find((e) => e.path === entry.path);
    assert.ok(match, `manifest missing ${entry.path}`);
    assert.equal(entry.sha256, match.sha256, `hash drift on ${entry.path}`);
    assert.equal(entry.findings, 0);
  }
  // recompute one hash independently
  const first = manifest.fixtures[0];
  assert.equal(first.sha256, sha256(readFileSync(join(ROOT, first.path))));
});
