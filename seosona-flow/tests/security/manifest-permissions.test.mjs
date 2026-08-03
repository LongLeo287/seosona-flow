// P3.T7 tests — least-privilege manifest (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { permissionSnapshot } from '../../scripts/security/lib/scanners.mjs';

const root = repoRoot();
const manifest = JSON.parse(readFileSync(join(root, 'seosona-flow/manifest.json'), 'utf8'));

const CORE_REQUIRED = [
  'https://labs.google/*', '*://chatgpt.com/*', '*://gemini.google.com/*',
  '*://claude.ai/*', 'https://grok.com/*', '*://storage.googleapis.com/*',
];
const OPTIONAL_EXPECTED = [
  '<all_urls>', '*://www.pinterest.com/*', '*://unsplash.com/*',
  '*://www.etsy.com/*', '*://pixabay.com/*', '*://www.amazon.com/*',
];

test('positive: core provider hosts remain required', () => {
  for (const h of CORE_REQUIRED) {
    assert.ok(manifest.host_permissions.includes(h), `required host: ${h}`);
  }
});

test('negative: <all_urls> is NOT a required host permission', () => {
  assert.ok(!manifest.host_permissions.includes('<all_urls>'), '<all_urls> must not be install-time');
  assert.ok((manifest.optional_host_permissions || []).includes('<all_urls>'), '<all_urls> is optional');
});

test('boundary: image-gathering sites are optional, not required', () => {
  for (const h of OPTIONAL_EXPECTED) {
    assert.ok(manifest.optional_host_permissions.includes(h), `optional host: ${h}`);
    assert.ok(!manifest.host_permissions.includes(h), `${h} must not be required`);
  }
});

test('boundary: API permissions stay within the documented least-privilege set', () => {
  const ALLOWED = new Set([
    'activeTab', 'storage', 'unlimitedStorage', 'sidePanel', 'scripting',
    'tabs', 'downloads', 'notifications', 'alarms', 'contextMenus', 'clipboardWrite',
  ]);
  for (const p of manifest.permissions) {
    assert.ok(ALLOWED.has(p), `permission ${p} is documented in the matrix`);
  }
});

test('regression: snapshot matches the committed permission baseline', () => {
  const baseline = JSON.parse(readFileSync(join(root, 'seosona-flow/artifacts/security/permissions-baseline.json'), 'utf8'));
  assert.deepEqual(permissionSnapshot(root), baseline, 'manifest matches baseline (re-baseline on intended change)');
});
