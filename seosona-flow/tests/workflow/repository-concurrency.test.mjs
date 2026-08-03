// P5.T4 tests — atomic revision-checked persistence (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { createChromeMock } from '../../tests/helpers/chrome-mock.mjs';

const Repo = loadClassic('src/storage/WorkflowRepository.js').SEOSONA_WorkflowRepository;

function repo() {
  const chrome = createChromeMock();
  return { chrome, r: Repo.create(chrome.storage.local) };
}

test('positive: save bumps revision and load reflects it', async () => {
  const { r } = repo();
  const first = await r.save([{ id: 'w1' }], 0);
  assert.equal(first.ok, true);
  assert.equal(first.revision, 1);
  const loaded = await r.load();
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.list.length, 1);
});

test('negative: a stale-revision write is rejected as a conflict', async () => {
  const { r } = repo();
  await r.save([{ id: 'w1' }], 0); // now rev 1
  const stale = await r.save([{ id: 'evil' }], 0); // writer still thinks rev 0
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict, true);
  const loaded = await r.load();
  assert.equal(loaded.list[0].id, 'w1', 'stale write did not overwrite');
});

test('boundary: two concurrent writers — exactly one wins', async () => {
  const { r } = repo();
  const [a, b] = await Promise.all([
    r.save([{ id: 'A' }], 0),
    r.save([{ id: 'B' }], 0),
  ]);
  const winners = [a, b].filter((x) => x.ok);
  const conflicts = [a, b].filter((x) => !x.ok && x.conflict);
  assert.equal(winners.length, 1, 'one writer succeeds');
  assert.equal(conflicts.length, 1, 'the other conflicts');
});

test('boundary: upsert applies optimistic concurrency', async () => {
  const { r } = repo();
  await r.upsert({ id: 'x', v: 1 });
  await r.upsert({ id: 'x', v: 2 }); // update in place
  const loaded = await r.load();
  assert.equal(loaded.list.length, 1);
  assert.equal(loaded.list[0].v, 2);
});

test('negative: upsert without id rejects', async () => {
  const { r } = repo();
  await assert.rejects(() => r.upsert({ v: 1 }), /id required/);
});

test('regression: unconditional save (no expected revision) always applies', async () => {
  const { r } = repo();
  await r.save([{ id: 'a' }], 0);
  const forced = await r.save([{ id: 'b' }]); // no expectedRevision
  assert.equal(forced.ok, true);
  assert.equal(forced.revision, 2);
});
