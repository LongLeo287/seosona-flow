// P3.T1 tests — default-deny privileged action gate (positive, negative,
// boundary, regression). Feature-flagged: observe by default, enforce on flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { loadServiceWorker } from '../../tests/helpers/load-service-worker.mjs';

const root = repoRoot();

function emitMessage(sw, msg) {
  let response;
  sw.emit('runtime.onMessage', msg, { id: 'seosona-flow-mock' }, (r) => { response = r; });
  return response;
}

test('wiring: worker imports the registry with zero load errors', () => {
  const sw = loadServiceWorker();
  assert.deepEqual(sw.errors.map((e) => e.message), []);
  assert.ok(sw.imported.includes('src/core/PrivilegedActionRegistry.js'), 'registry imported');
  const reg = sw.context.SEOSONA_PrivilegedActionRegistry;
  assert.ok(reg, 'registry attached to worker global');
});

// ĐỔI 2026-08-02: mặc định từ observe-only → ENFORCE.
// Lý do: một lớp bảo vệ opt-in mà không ai bật thì bằng không có. Bật được là nhờ
// KNOWN_ACTIONS đã phủ 100% action có handler + gate `security:actions` giữ nó khớp
// bằng chứng, nên "chặn nhầm" bị bắt ở CI chứ không rơi vào người dùng.
test('mặc định: chặn action lạ (fail-closed ngay từ đầu)', () => {
  const sw = loadServiceWorker();
  const res = emitMessage(sw, { action: '__unknown_probe__' });
  assert.equal(res?.error, 'BLOCKED_BY_POLICY', 'không bật sẵn thì lớp bảo vệ vô nghĩa');
  assert.equal(res?.reason, 'UNKNOWN_ACTION');
  assert.deepEqual(sw.errors.map((e) => e.message), []);
});

test('mặc định: action HỢP LỆ vẫn đi qua bình thường', async () => {
  // Bật sẵn mà chặn nhầm việc thật thì tệ hơn không bật. Đây là vế phải kiểm.
  const sw = loadServiceWorker();
  const known = [...sw.context.SEOSONA_PrivilegedActionRegistry.KNOWN_ACTIONS][0];
  const res = emitMessage(sw, { action: known });
  assert.notEqual(res?.error, 'BLOCKED_BY_POLICY', `action hợp lệ "${known}" bị chặn oan`);
});

test('tắt TƯỜNG MINH (=false) thì tôn trọng, không ép bật lại', async () => {
  const sw = loadServiceWorker();
  await sw.chrome.storage.local.set({ SEOSONA_SECURITY_ENFORCE: false });
  assert.equal(sw.context.SEOSONA_PrivilegedActionRegistry.isEnforcing(), false);
  const res = emitMessage(sw, { action: '__unknown_probe__' });
  assert.notEqual(res?.error, 'BLOCKED_BY_POLICY');
});

test('enforce via storage flag: unknown action fails closed', async () => {
  const sw = loadServiceWorker();
  await sw.chrome.storage.local.set({ SEOSONA_SECURITY_ENFORCE: true });
  assert.equal(sw.context.SEOSONA_PrivilegedActionRegistry.isEnforcing(), true, 'flag flips enforcement');
  const res = emitMessage(sw, { action: '__unknown_probe__' });
  assert.equal(res?.error, 'BLOCKED_BY_POLICY');
  assert.equal(res?.reason, 'UNKNOWN_ACTION');
});

test('enforce: a known action is allowed through', async () => {
  const sw = loadServiceWorker();
  await sw.chrome.storage.local.set({ SEOSONA_SECURITY_ENFORCE: true });
  const res = emitMessage(sw, { action: 'ping' });
  // ping is a known action; the gate must not block it.
  assert.notEqual(res?.error, 'BLOCKED_BY_POLICY');
});

test('boundary: a message with no action is blocked when enforcing', async () => {
  const sw = loadServiceWorker();
  await sw.chrome.storage.local.set({ SEOSONA_SECURITY_ENFORCE: true });
  const res = emitMessage(sw, { data: 1 });
  assert.equal(res?.error, 'BLOCKED_BY_POLICY');
  assert.equal(res?.reason, 'NO_ACTION');
});

test('regression: registry allowlist matches the message-contracts inventory', () => {
  const contracts = JSON.parse(readFileSync(join(root, 'seosona-flow/artifacts/audit/phase-01/message-contracts.json'), 'utf8'));
  const handled = contracts.registry.filter((r) => r.handled).map((r) => r.action).sort();
  const sw = loadServiceWorker();
  const known = [...sw.context.SEOSONA_PrivilegedActionRegistry.KNOWN_ACTIONS].sort();
  assert.deepEqual(known, handled, 'registry stays in sync with evidence');
});
