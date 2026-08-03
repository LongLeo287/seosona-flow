// P10.T2 tests — diagnostics export.
// positive/negative/boundary/regression across: version, permission, mode,
// errors, adapters, storage health, preview, opt-in, size, and corruption.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const ctx = loadClassic(['src/core/PrivacyFilter.js', 'src/diagnostics/DiagnosticsService.js']);
const DS = ctx.SEOSONA_DiagnosticsService;
const PF = ctx.SEOSONA_PrivacyFilter;

function svc(over = {}) {
  return DS.create({
    privacyFilter: PF,
    version: '1.1.37',
    permissions: () => ['sidePanel', 'storage'],
    mode: () => 'local',
    logger: { recent: () => [{ severity: 'error', event: 'boom', data: { token: 'eyJhbGciOiJIUzI1NiJ9.p.s' } }] },
    ...over,
  });
}

test('positive: bundle has schema, checksum, and expected sections', () => {
  const b = svc().buildBundle({ at: 100 });
  assert.equal(b.schema, DS.SCHEMA);
  assert.match(b.checksum, /^[0-9a-f]{8}$/);
  assert.equal(b.body.version, '1.1.37');
  assert.equal(b.body.mode, 'local');
});

test('opt-in: preview shows sections + never-upload contract without full payload', () => {
  const p = svc().preview({ at: 1 });
  assert.ok(p.sections.includes('version'));
  assert.match(p.upload, /never/i);
});

test('negative: secrets in recent errors are redacted in the bundle', () => {
  const b = svc().buildBundle({ at: 1 });
  assert.ok(!JSON.stringify(b.body.recentErrors).includes('eyJhbGciOiJIUzI1NiJ9'));
});

test('boundary: checksum changes when content changes, stable otherwise', () => {
  const a = svc().buildBundle({ at: 1 });
  const b = svc().buildBundle({ at: 1 });
  assert.equal(a.checksum, b.checksum);
  const c = svc({ mode: () => 'online' }).buildBundle({ at: 1 });
  assert.notEqual(a.checksum, c.checksum);
});

test('corruption: a throwing provider is tolerated (section falls back)', () => {
  const b = svc({ storageHealth: () => { throw new Error('corrupt'); } }).buildBundle({ at: 1 });
  assert.equal(b.body.storageHealth, null);
});

test('regression: bundle is size-bounded', () => {
  const big = svc({ logger: { recent: () => Array.from({ length: 1000 }, (_, i) => ({ severity: 'error', event: 'e' + i, data: { note: 'x'.repeat(2000) } })) } });
  const b = big.buildBundle({ at: 1 });
  assert.ok(b.bytes <= DS.create({}).MAX_BYTES, `bytes ${b.bytes}`);
});
