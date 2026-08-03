// P3.T3 tests — redirect-safe network policy (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const np = loadClassic('src/core/NetworkPolicy.js').SEOSONA_NetworkPolicy;

test('positive: public https target is allowed', () => {
  assert.equal(np.validateTarget('https://storage.googleapis.com/x.png').allowed, true);
  assert.equal(np.validateTarget('https://labs.google/fx/').allowed, true);
});

test('negative: loopback and private addresses are blocked', () => {
  for (const u of [
    'http://127.0.0.1/', 'http://localhost:8080/api', 'http://10.0.0.5/',
    'http://192.168.1.1/', 'http://172.16.0.1/', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]/', 'http://something.internal/',
  ]) {
    const d = np.validateTarget(u);
    assert.equal(d.allowed, false, `${u} must be blocked`);
    assert.equal(d.reason, 'PRIVATE_ADDRESS');
  }
});

test('negative: disallowed schemes and invalid URLs are rejected', () => {
  assert.equal(np.validateTarget('ftp://example.com/').reason, 'DISALLOWED_SCHEME');
  assert.equal(np.validateTarget('file:///etc/passwd').reason, 'DISALLOWED_SCHEME');
  assert.equal(np.validateTarget('not a url').reason, 'INVALID_URL');
});

test('boundary: isPrivateHost handles IPv6 and edge hosts', () => {
  assert.equal(np.isPrivateHost('fc00::1'), true);
  assert.equal(np.isPrivateHost('fe80::1'), true);
  assert.equal(np.isPrivateHost('8.8.8.8'), false);
  assert.equal(np.isPrivateHost(''), true);
});

test('safeFetch: a redirect to a private address fails on the next hop', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('start')) {
      return { status: 302, headers: { get: (h) => (h.toLowerCase() === 'location' ? 'http://169.254.169.254/' : null) } };
    }
    return { status: 200, headers: { get: () => null } };
  };
  const safeFetch = np.createSafeFetch(fakeFetch);
  await assert.rejects(
    () => safeFetch('https://public.example.com/start'),
    (e) => e.reason === 'PRIVATE_ADDRESS',
  );
  assert.equal(calls.length, 1, 'never actually fetched the private hop');
});

test('safeFetch: oversized content-length is rejected', async () => {
  const fakeFetch = async () => ({ status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-length' ? String(100 * 1024 * 1024) : null) } });
  const safeFetch = np.createSafeFetch(fakeFetch, { maxBytes: 1024 });
  await assert.rejects(() => safeFetch('https://public.example.com/big'), (e) => e.reason === 'RESPONSE_TOO_LARGE');
});

test('safeFetch: too many redirects is bounded', async () => {
  const fakeFetch = async () => ({ status: 302, headers: { get: (h) => (h.toLowerCase() === 'location' ? 'https://public.example.com/next' : null) } });
  const safeFetch = np.createSafeFetch(fakeFetch, { maxRedirects: 3 });
  await assert.rejects(() => safeFetch('https://public.example.com/loop'), (e) => e.reason === 'TOO_MANY_REDIRECTS');
});

test('regression: public request passes through safeFetch', async () => {
  const fakeFetch = async () => ({ status: 200, headers: { get: () => null }, ok: true });
  const safeFetch = np.createSafeFetch(fakeFetch);
  const r = await safeFetch('https://storage.googleapis.com/x.png');
  assert.equal(r.status, 200);
});
