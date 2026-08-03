// P4.T3 tests — privileged network service (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { loadServiceWorker } from '../../tests/helpers/load-service-worker.mjs';

function makeService(fetchImpl) {
  const ctx = loadClassic(['src/core/NetworkPolicy.js', 'src/background/NetworkService.js'], { fetch: fetchImpl });
  return ctx.SEOSONA_NetworkService;
}

test('positive: public request returns an ok envelope with enforced policy', async () => {
  const svc = makeService(async () => ({ ok: true, status: 200, headers: { get: () => null } }));
  const env = await svc.fetchSafe('https://storage.googleapis.com/x.png');
  assert.equal(env.ok, true);
  assert.equal(env.status, 200);
  assert.equal(env.policy, 'enforced');
});

test('negative: private target is denied (typed reason, no throw)', async () => {
  const svc = makeService(async () => ({ ok: true, status: 200, headers: { get: () => null } }));
  const env = await svc.fetchSafe('http://169.254.169.254/latest/meta-data');
  assert.equal(env.ok, false);
  assert.equal(env.reason, 'PRIVATE_ADDRESS');
});

test('negative: redirect to private address is denied on the next hop', async () => {
  const svc = makeService(async (url) => {
    if (url.includes('start')) return { status: 302, headers: { get: (h) => (h.toLowerCase() === 'location' ? 'http://127.0.0.1/' : null) } };
    return { ok: true, status: 200, headers: { get: () => null } };
  });
  const env = await svc.fetchSafe('https://public.example.com/start');
  assert.equal(env.ok, false);
  assert.equal(env.reason, 'PRIVATE_ADDRESS');
});

test('boundary: inspect() validates without fetching', () => {
  const svc = makeService(async () => { throw new Error('should not fetch'); });
  assert.equal(svc.inspect('https://labs.google/fx/').allowed, true);
  assert.equal(svc.inspect('http://localhost/').reason, 'PRIVATE_ADDRESS');
});

test('regression: worker boots with the network service imported', () => {
  const sw = loadServiceWorker();
  assert.deepEqual(sw.errors.map((e) => e.message), []);
  assert.ok(sw.imported.includes('src/background/NetworkService.js'));
  assert.ok(sw.context.SEOSONA_NetworkService, 'service attached');
});
