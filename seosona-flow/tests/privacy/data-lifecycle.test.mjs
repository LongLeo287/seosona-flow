// P7.T5 tests — data lifecycle (export / delete / round-trip).
// positive/negative/boundary/regression across: target delete, delete all,
// export round-trip, partial failure, restart (idempotent), and backups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { createChromeMock } from '../../tests/helpers/chrome-mock.mjs';

const DLS = loadClassic('src/storage/DataLifecycleService.js').SEOSONA_DataLifecycleService;

function seeded() {
  const chrome = createChromeMock();
  const area = chrome.storage.local;
  area.set({ a: 1, b: { x: 2 }, c: [3, 4] });
  return { area, chrome };
}

test('positive: export captures all keys with a versioned schema', async () => {
  const { area } = seeded();
  const svc = DLS.create({ area, now: () => 100 });
  const bundle = await svc.exportAll();
  assert.equal(bundle.schema, DLS.EXPORT_SCHEMA);
  assert.equal(bundle.version, DLS.EXPORT_VERSION);
  assert.equal(bundle.keyCount, 3);
  assert.deepEqual({ ...bundle.entries.b }, { x: 2 });
});

test('positive: export → delete-all → import round-trips exactly', async () => {
  const { area } = seeded();
  const svc = DLS.create({ area });
  const bundle = await svc.exportAll();
  const wiped = await svc.deleteAll();
  assert.equal(wiped.deleted, 3);
  assert.deepEqual(area._dump(), {});
  const imported = await svc.importBundle(bundle);
  assert.equal(imported.imported, 3);
  assert.equal(area._dump().a, 1);
  assert.deepEqual({ ...area._dump().b }, { x: 2 });
});

test('target delete: receipt distinguishes deleted vs missing', async () => {
  const { area } = seeded();
  const svc = DLS.create({ area });
  const receipt = await svc.deleteKeys(['a', 'ghost']);
  assert.deepEqual([...receipt.deleted], ['a']);
  assert.deepEqual([...receipt.missing], ['ghost']);
  assert.equal('a' in area._dump(), false);
});

test('restart-safe: deleting the same keys twice is idempotent', async () => {
  const { area } = seeded();
  const svc = DLS.create({ area });
  await svc.deleteKeys(['a']);
  const second = await svc.deleteKeys(['a']);
  assert.deepEqual([...second.deleted], []);
  assert.deepEqual([...second.missing], ['a']);
});

test('negative: importing an unrecognized bundle is rejected', async () => {
  const { area } = seeded();
  const svc = DLS.create({ area });
  await assert.rejects(() => svc.importBundle({ schema: 'nope', entries: { z: 1 } }));
});

test('boundary: prototype-polluting keys are ignored on import', async () => {
  const { area } = seeded();
  const svc = DLS.create({ area });
  const bundle = { schema: DLS.EXPORT_SCHEMA, version: 1, entries: JSON.parse('{"__proto__":{"polluted":1},"safe":9}') };
  const res = await svc.importBundle(bundle);
  assert.equal(res.imported, 1);
  assert.equal(({}).polluted, undefined);
  assert.equal(area._dump().safe, 9);
});

test('regression: export excludes secrets when an export policy is supplied', async () => {
  const { area } = seeded();
  area.set({ telegram_bot_token: 'sk-ABCDEFGHIJKLMNOPQRSTUV', workflow_x: { ok: 1 } });
  const DC = loadClassic('src/storage/DataClassification.js').SEOSONA_DataClassification;
  const EP = loadClassic('src/storage/ExportPolicy.js').SEOSONA_ExportPolicy;
  const svc = DLS.create({ area });
  const bundle = await svc.exportAll({ exportPolicy: EP, classify: (k) => DC.classify(k) });
  assert.equal('telegram_bot_token' in bundle.entries, false, 'token dropped');
  assert.ok(bundle.removed.some((r) => r.key === 'telegram_bot_token'));
});
