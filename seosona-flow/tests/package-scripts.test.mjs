// P2.T1 tests — package & command surface (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));

const REQUIRED_SCRIPTS = [
  'check:syntax', 'check:json', 'check:html', 'check:static', 'check:budgets',
  'lint', 'test:audit', 'test:unit', 'test:integration', 'test:e2e', 'verify',
  'seosona:doctor',
];

test('positive: every required command exists', () => {
  for (const s of REQUIRED_SCRIPTS) {
    assert.ok(pkg.scripts[s], `script "${s}" is declared`);
  }
});

test('positive: verify orchestrates static, security, and test tiers', () => {
  assert.equal(pkg.scripts.verify, 'node scripts/quality/verify.mjs');
  assert.ok(existsSync(join(pkgRoot, 'scripts/quality/verify.mjs')));
});

test('boundary: Node engine is pinned to a supported major', () => {
  assert.ok(pkg.engines && pkg.engines.node, 'engines.node declared');
  assert.match(pkg.engines.node, />=22/);
});

test('boundary: dev tools are exact-pinned (no range drift)', () => {
  for (const [name, ver] of Object.entries(pkg.devDependencies || {})) {
    assert.match(ver, /^\d+\.\d+\.\d+$/, `${name} is exact-pinned, got ${ver}`);
  }
  assert.ok(pkg.devDependencies['@playwright/test']);
  assert.ok(pkg.devDependencies.eslint);
});

test('regression: a reproducible lockfile is committed', () => {
  const lock = join(pkgRoot, 'package-lock.json');
  assert.ok(existsSync(lock), 'package-lock.json exists');
  const parsed = JSON.parse(readFileSync(lock, 'utf8'));
  assert.equal(parsed.lockfileVersion >= 2, true, 'modern lockfile');
});

test('negative: package does not force ESM onto classic extension scripts', () => {
  assert.notEqual(pkg.type, 'module', 'classic .js scripts must not be parsed as ESM');
});
