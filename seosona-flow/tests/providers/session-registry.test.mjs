// P6.T5 tests — provider session registry.
// positive / negative / boundary / regression across: tabs, windows,
// navigation, logout, close, cache, concurrency, and restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const SRG = loadClassic('src/providers/ProviderSessionRegistry.js').SEOSONA_ProviderSessionRegistry;
const R = SRG.REASONS;

function reg() {
  let t = 0;
  return SRG.create({ now: () => ++t });
}

test('positive: register then lease resolves to a live tab', () => {
  const r = reg();
  r.register({ tabId: 10, provider: 'chatgpt', windowId: 1, url: 'https://chatgpt.com/', version: 2 });
  const lease = r.lease({ provider: 'chatgpt' });
  assert.equal(lease.ok, true);
  assert.equal(lease.tabId, 10);
  assert.equal(r.resolveTarget(lease.leaseId).ok, true);
});

test('tabs: two tabs of a provider lease distinctly (oldest first)', () => {
  const r = reg();
  r.register({ tabId: 1, provider: 'grok', url: 'https://grok.com/' });
  r.register({ tabId: 2, provider: 'grok', url: 'https://grok.com/' });
  const a = r.lease({ provider: 'grok' });
  const b = r.lease({ provider: 'grok' });
  assert.equal(a.tabId, 1);
  assert.equal(b.tabId, 2);
  assert.notEqual(a.leaseId, b.leaseId);
});

test('windows: windowId filter targets the right window', () => {
  const r = reg();
  r.register({ tabId: 1, provider: 'gemini', windowId: 100, url: 'https://gemini.google.com/' });
  r.register({ tabId: 2, provider: 'gemini', windowId: 200, url: 'https://gemini.google.com/' });
  assert.equal(r.lease({ provider: 'gemini', windowId: 200 }).tabId, 2);
});

test('negative: no matching provider → NO_SESSION', () => {
  const r = reg();
  r.register({ tabId: 1, provider: 'grok', url: 'https://grok.com/' });
  assert.equal(r.lease({ provider: 'claude' }).reason, R.NO_SESSION);
});

test('concurrency: a leased tab cannot be leased twice until released', () => {
  const r = reg();
  r.register({ tabId: 1, provider: 'claude', url: 'https://claude.ai/' });
  const a = r.lease({ provider: 'claude' });
  assert.equal(a.ok, true);
  assert.equal(r.lease({ provider: 'claude' }).reason, R.NO_SESSION, 'exclusive while leased');
  assert.equal(r.release(a.leaseId), true);
  assert.equal(r.lease({ provider: 'claude' }).ok, true, 'available after release');
});

test('navigation: leaving the provider origin makes the tab stale + wrong', () => {
  const r = reg();
  r.register({ tabId: 5, provider: 'chatgpt', url: 'https://chatgpt.com/c/1' });
  const lease = r.lease({ provider: 'chatgpt' });
  r.onNavigated(5, 'https://evil.example/phish');
  const res = r.resolveTarget(lease.leaseId);
  assert.equal(res.ok, false);
  assert.equal(res.reason, R.STALE);
  assert.equal(res.staleReason, 'navigated');
});

test('navigation: same-origin SPA nav keeps the session valid', () => {
  const r = reg();
  r.register({ tabId: 5, provider: 'chatgpt', url: 'https://chatgpt.com/c/1' });
  const lease = r.lease({ provider: 'chatgpt' });
  r.onNavigated(5, 'https://chatgpt.com/c/2');
  assert.equal(r.resolveTarget(lease.leaseId).ok, true);
});

test('logout: onLoggedOut marks the session stale', () => {
  const r = reg();
  r.register({ tabId: 7, provider: 'grok', url: 'https://grok.com/' });
  const lease = r.lease({ provider: 'grok' });
  r.onLoggedOut(7);
  assert.equal(r.resolveTarget(lease.leaseId).staleReason, 'logged_out');
});

test('close: onClosed removes the session → GONE', () => {
  const r = reg();
  r.register({ tabId: 9, provider: 'gemini', url: 'https://gemini.google.com/' });
  const lease = r.lease({ provider: 'gemini' });
  r.onClosed(9);
  assert.equal(r.resolveTarget(lease.leaseId).reason, R.GONE);
  assert.equal(r.size(), 0);
});

test('boundary: minVersion excludes an out-of-date session', () => {
  const r = reg();
  r.register({ tabId: 1, provider: 'flow', url: 'https://labs.google/fx', version: 1 });
  assert.equal(r.lease({ provider: 'flow', minVersion: 2 }).reason, R.NO_SESSION);
  r.register({ tabId: 1, provider: 'flow', url: 'https://labs.google/fx', version: 2 });
  assert.equal(r.lease({ provider: 'flow', minVersion: 2 }).ok, true);
});

test('cache: an unknown / released lease resolves to NO_LEASE', () => {
  const r = reg();
  r.register({ tabId: 1, provider: 'grok', url: 'https://grok.com/' });
  const lease = r.lease({ provider: 'grok' });
  r.release(lease.leaseId);
  assert.equal(r.resolveTarget(lease.leaseId).reason, R.NO_LEASE);
  assert.equal(r.resolveTarget('never-issued').reason, R.NO_LEASE);
});

test('restart: rehydrate drops sessions whose tab is no longer live', () => {
  const r = reg();
  r.register({ tabId: 1, provider: 'grok', url: 'https://grok.com/' });
  r.register({ tabId: 2, provider: 'grok', url: 'https://grok.com/' });
  r.register({ tabId: 3, provider: 'grok', url: 'https://grok.com/' });
  const dropped = r.rehydrate([2]); // only tab 2 survived the SW restart
  assert.equal(dropped, 2);
  assert.equal(r.size(), 1);
  assert.equal(r.get(2).tabId, 2);
  assert.equal(r.get(1), null);
});

test('regression: register refresh preserves an active lease', () => {
  const r = reg();
  r.register({ tabId: 1, provider: 'chatgpt', url: 'https://chatgpt.com/' });
  const lease = r.lease({ provider: 'chatgpt' });
  r.register({ tabId: 1, provider: 'chatgpt', url: 'https://chatgpt.com/c/9' }); // heartbeat refresh
  assert.equal(r.resolveTarget(lease.leaseId).ok, true, 'lease survives a ready refresh');
});
