// P3.T2 tests — sender authorization / confused-deputy defense.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceWorker } from '../../tests/helpers/load-service-worker.mjs';

function emit(sw, msg, sender) {
  let res;
  sw.emit('runtime.onMessage', msg, sender || { id: 'seosona-flow-mock' }, (r) => { res = r; });
  return res;
}

test('wiring: sender policy is imported', () => {
  const sw = loadServiceWorker();
  assert.ok(sw.imported.includes('src/core/SenderPolicy.js'));
  assert.ok(sw.context.SEOSONA_SenderPolicy, 'attached to global');
});

test('positive: trusted external origin is accepted', () => {
  const sw = loadServiceWorker();
  const sp = sw.context.SEOSONA_SenderPolicy;
  assert.equal(sp.isTrustedExternalOrigin('https://labs.seosona.vn/creator'), true);
  assert.equal(sp.authorize({ origin: 'https://labs.seosona.vn' }, { external: true }).allowed, true);
});

test('negative: forged external origin is rejected', () => {
  const sw = loadServiceWorker();
  const sp = sw.context.SEOSONA_SenderPolicy;
  const d = sp.authorize({ origin: 'https://evil.example.com' }, { external: true });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'UNTRUSTED_ORIGIN');
  assert.equal(sp.isTrustedExternalOrigin('https://labs.seosona.vn.evil.com'), false);
});

test('boundary: internal message from a foreign extension id is flagged', () => {
  const sw = loadServiceWorker();
  const sp = sw.context.SEOSONA_SenderPolicy;
  const foreign = sp.authorize({ id: 'some-other-extension' }, { external: false, runtimeId: 'seosona-flow-mock' });
  assert.equal(foreign.allowed, false);
  assert.equal(foreign.reason, 'FOREIGN_SENDER');
  const own = sp.authorize({ id: 'seosona-flow-mock' }, { external: false, runtimeId: 'seosona-flow-mock' });
  assert.equal(own.allowed, true);
});

test('integration: enforcing gate blocks a foreign-sender known action', async () => {
  const sw = loadServiceWorker();
  await sw.chrome.storage.local.set({ SEOSONA_SECURITY_ENFORCE: true });
  const res = emit(sw, { action: 'ping' }, { id: 'attacker-extension' });
  assert.equal(res?.error, 'BLOCKED_BY_POLICY');
  assert.equal(res?.reason, 'FOREIGN_SENDER');
});

// ĐỔI 2026-08-02: mặc định từ observe-only → ENFORCE (xem PrivilegedActionRegistry).
// Test cũ khoá hành vi "observe không bao giờ chặn"; nay mặc định là CHẶN, và cái đáng
// khoá là chiều ngược lại: tắt tường minh thì phải thật sự tắt.
test('mặc định: sender lạ bị chặn ngay, không cần bật gì', () => {
  const sw = loadServiceWorker();
  const res = emit(sw, { action: 'ping' }, { id: 'attacker-extension' });
  assert.equal(res?.error, 'BLOCKED_BY_POLICY');
  assert.equal(res?.reason, 'FOREIGN_SENDER');
});

test('tắt tường minh (=false): sender lạ KHÔNG bị chặn — công tắc phải thật sự tắt', async () => {
  const sw = loadServiceWorker();
  await sw.chrome.storage.local.set({ SEOSONA_SECURITY_ENFORCE: false });
  const res = emit(sw, { action: 'ping' }, { id: 'attacker-extension' });
  assert.notEqual(res?.error, 'BLOCKED_BY_POLICY');
});
