// P3.T6 tests — secret lifecycle: redaction, export-block, clear-on-exit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { createChromeMock } from '../../tests/helpers/chrome-mock.mjs';

const ctx = loadClassic(['src/core/SecretVault.js', 'src/core/RedactingLogger.js']);
const vault = ctx.SEOSONA_SecretVault;
const logger = ctx.SEOSONA_RedactingLogger;

test('positive: redact hides secret fields but keeps structure', () => {
  const input = { user: 'alice', af_auth: { token: 'abc123', bearer: 'xyz' }, settings: { theme: 'dark' } };
  const out = vault.redact(input);
  assert.equal(out.user, 'alice');
  assert.equal(out.af_auth, '[REDACTED]'); // known secret key
  assert.equal(out.settings.theme, 'dark');
});

test('positive: nested secret fields are redacted by name', () => {
  const out = vault.redact({ profile: { name: 'bob', apiKey: 'k-123', session_token: 't' } });
  assert.equal(out.profile.name, 'bob');
  assert.equal(out.profile.apiKey, '[REDACTED]');
  assert.equal(out.profile.session_token, '[REDACTED]');
});

test('negative: auditExport flags secret-bearing payloads', () => {
  const bad = vault.auditExport({ workflows: [], af_auth: { token: 'x' }, meta: { bearer: 'y' } });
  assert.equal(bad.safe, false);
  assert.ok(bad.offending.includes('af_auth'));
  const good = vault.auditExport({ workflows: [{ id: 1 }], settings: { theme: 'dark' } });
  assert.equal(good.safe, true);
});

test('boundary: clearAll removes every registered secret key (logout)', async () => {
  const chrome = createChromeMock();
  await chrome.storage.local.set({ af_auth: { t: 1 }, seosona_client_enrollment: { c: 2 }, af_workflows: [{ id: 1 }] });
  await vault.clearAll(chrome.storage.local);
  const after = await chrome.storage.local.get(['af_auth', 'seosona_client_enrollment', 'af_workflows']);
  assert.equal('af_auth' in after, false, 'secret cleared');
  assert.equal('seosona_client_enrollment' in after, false, 'enrollment cleared');
  assert.deepEqual(after.af_workflows, [{ id: 1 }], 'non-secret data preserved');
});

test('logger: bearer tokens, JWTs and long hex are redacted', () => {
  const captured = [];
  const log = logger.create({ log: (...a) => captured.push(a) });
  log.log('auth: Bearer sk-abcdef0123456789ABCDEF token done');
  // secret-scan:allow — JWT giả, là VECTOR KIỂM TRA cho bộ che log; không phải secret thật.
  log.log('jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payloadpart.signaturepart');
  log.log('hmac ' + 'a'.repeat(40));
  const joined = captured.map((a) => a.join(' ')).join('\n');
  assert.ok(!joined.includes('sk-abcdef0123456789'), 'bearer redacted');
  assert.ok(!joined.includes('eyJhbGci'), 'jwt redacted');
  assert.ok(joined.includes('[REDACTED]'));
});

test('logger: object arguments are deep-redacted', () => {
  const captured = [];
  const log = logger.create({ warn: (...a) => captured.push(a) });
  log.warn('state', { af_auth: { token: 'secret-token-value' }, ok: true });
  const serialized = JSON.stringify(captured);
  assert.ok(!serialized.includes('secret-token-value'));
  assert.ok(serialized.includes('[REDACTED]'));
});

test('regression: canary secret round-trips then is cleared', async () => {
  const chrome = createChromeMock();
  const canary = 'CANARY-' + 'deadbeef'.repeat(5);
  await chrome.storage.local.set({ af_auth: { token: canary } });
  const read = await chrome.storage.local.get('af_auth');
  assert.equal(read.af_auth.token, canary, 'authorized read works');
  assert.equal(vault.auditExport(read).safe, false, 'export would be blocked');
  await vault.clearAll(chrome.storage.local);
  assert.deepEqual(await chrome.storage.local.get('af_auth'), {}, 'cleared on exit');
});
