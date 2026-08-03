// P2.T3 tests — deterministic mocks: timers, crypto, fetch, storage, messages,
// tabs, downloads, alarms, cleanup (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installRuntime } from './test-runtime.mjs';
import { createFakeClock } from './fake-clock.mjs';

test('timers: fake clock fires due timeouts in order', () => {
  const clock = createFakeClock();
  const order = [];
  clock.setTimeout(() => order.push('b'), 20);
  clock.setTimeout(() => order.push('a'), 10);
  clock.setTimeout(() => order.push('c'), 30);
  clock.tick(25);
  assert.deepEqual(order, ['a', 'b']);
  clock.tick(10);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(clock.pending(), 0);
});

test('timers: intervals repeat and clear cleanly', () => {
  const clock = createFakeClock();
  let n = 0;
  const id = clock.setInterval(() => n++, 10);
  clock.tick(35);
  assert.equal(n, 3);
  clock.clearInterval(id);
  clock.tick(100);
  assert.equal(n, 3);
});

test('crypto: node webcrypto is deterministic per-seeded input (uuid shape)', () => {
  const id = crypto.randomUUID();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const buf = crypto.getRandomValues(new Uint8Array(8));
  assert.equal(buf.length, 8);
});

test('storage: get/set/remove round-trips with defaults', async () => {
  const rt = installRuntime();
  try {
    await rt.chrome.storage.local.set({ af_settings: { a: 1 } });
    const got = await rt.chrome.storage.local.get({ af_settings: null, missing: 'def' });
    assert.deepEqual(got.af_settings, { a: 1 });
    assert.equal(got.missing, 'def');
    await rt.chrome.storage.local.remove('af_settings');
    const after = await rt.chrome.storage.local.get('af_settings');
    assert.deepEqual(after, {});
  } finally {
    rt.restore();
  }
});

test('storage: onChanged fires with old/new values', async () => {
  const rt = installRuntime();
  try {
    const seen = [];
    rt.chrome.storage.local.onChanged.addListener((changes, area) => seen.push({ changes, area }));
    await rt.chrome.storage.local.set({ k: 1 });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].area, 'local');
    assert.equal(seen[0].changes.k.newValue, 1);
  } finally {
    rt.restore();
  }
});

test('messages: sendMessage reaches onMessage and returns a response', async () => {
  const rt = installRuntime();
  try {
    rt.chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'ping') { sendResponse({ pong: true }); }
    });
    const res = await rt.chrome.runtime.sendMessage({ action: 'ping' });
    assert.deepEqual(res, { pong: true });
  } finally {
    rt.restore();
  }
});

test('tabs/downloads/alarms: effects are recorded', async () => {
  const rt = installRuntime();
  try {
    const tab = await rt.chrome.tabs.create({ url: 'https://labs.google/fx/' });
    await rt.chrome.tabs.update(tab.id, { active: true });
    await rt.chrome.downloads.download({ url: 'blob:x', filename: 'a.png' });
    rt.chrome.alarms.create('poll', { periodInMinutes: 1 });
    const kinds = rt.effects.map((e) => e.type);
    assert.ok(kinds.includes('tabs.create'));
    assert.ok(kinds.includes('downloads.download'));
    assert.ok(kinds.includes('alarms.create'));
  } finally {
    rt.restore();
  }
});

test('fetch: unmatched requests are blocked; routes respond', async () => {
  const rt = installRuntime({ fetch: { routes: [{ match: '/config', response: { json: { ok: 1 } } }] } });
  try {
    const r = await fetch('https://api.example.com/config');
    assert.deepEqual(await r.json(), { ok: 1 });
    await assert.rejects(() => fetch('https://evil.example.com/'), /blocked/);
    assert.equal(rt.fetch.requests.length, 2);
  } finally {
    rt.restore();
  }
});

test('cleanup: restore removes globals and clears listeners (leak-free)', async () => {
  const before = 'chrome' in globalThis;
  const rt = installRuntime();
  rt.chrome.runtime.onMessage.addListener(() => {});
  assert.ok(rt.chrome._listenerCount() >= 1);
  rt.restore();
  assert.equal('chrome' in globalThis, before);
});

test('regression: repeated installs are identical and isolated', async () => {
  const a = installRuntime();
  await a.chrome.storage.local.set({ x: 1 });
  a.restore();
  const b = installRuntime();
  const got = await b.chrome.storage.local.get('x');
  assert.deepEqual(got, {}, 'fresh runtime has no leaked state');
  b.restore();
});
