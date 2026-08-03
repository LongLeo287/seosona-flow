// P4.T5 tests — headless service boundaries (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { createChromeMock } from '../../tests/helpers/chrome-mock.mjs';

const ctx = loadClassic(['src/services/StorageService.js', 'src/services/WorkflowStore.js']);
const StorageService = ctx.SEOSONA_StorageService;
const WorkflowStore = ctx.SEOSONA_WorkflowStore;

function freshStore() {
  const chrome = createChromeMock();
  const storage = StorageService.create(chrome.storage.local);
  return { chrome, storage, store: WorkflowStore.create(storage) };
}

test('positive: storage service round-trips without any DOM', async () => {
  assert.equal(typeof globalThis.document, 'undefined', 'no DOM in this runtime');
  const { storage } = freshStore();
  await storage.set('af_settings', { theme: 'dark' });
  assert.deepEqual(await storage.get('af_settings'), { theme: 'dark' });
  assert.equal(await storage.get('missing', 'def'), 'def');
});

test('positive: workflow store CRUD is headless', async () => {
  const { store } = freshStore();
  await store.save({ id: 'w1', name: 'A' });
  await store.save({ id: 'w2', name: 'B' });
  assert.equal((await store.list()).length, 2);
  await store.save({ id: 'w1', name: 'A2' }); // update in place
  assert.equal((await store.getById('w1')).name, 'A2');
  const removed = await store.remove('w2');
  assert.equal(removed, 1);
  assert.equal((await store.list()).length, 1);
});

test('negative: services reject missing dependencies', () => {
  assert.throws(() => StorageService.create(null), /requires a storage area/);
  assert.throws(() => WorkflowStore.create({}), /requires a StorageService/);
});

test('negative: saving a workflow without id rejects', async () => {
  const { store } = freshStore();
  await assert.rejects(() => store.save({ name: 'no id' }), /id required/);
});

test('boundary: update() applies a transform atomically', async () => {
  const { storage } = freshStore();
  await storage.set('counter', 1);
  await storage.update('counter', (n) => n + 5, 0);
  assert.equal(await storage.get('counter'), 6);
});

test('regression: two stores over the same area see the same data', async () => {
  const { chrome, storage, store } = freshStore();
  await store.save({ id: 'shared', name: 'X' });
  const store2 = WorkflowStore.create(StorageService.create(chrome.storage.local));
  assert.equal((await store2.getById('shared')).name, 'X');
});
