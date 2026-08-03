// Backup & Portability (Tier 1) tests — export/import chrome.storage.local ↔ file bundle.
// Bao phủ: loại secret/runtime khi export, merge theo id, replace mirror, legacy schema,
// reject schema lạ, chống prototype pollution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { createChromeMock } from '../../tests/helpers/chrome-mock.mjs';

const BS = loadClassic('src/storage/BackupService.js').SEOSONA_BackupService;

function areaWith(seed) {
  const chrome = createChromeMock();
  const area = chrome.storage.local;
  area.set(seed || {});
  return area;
}

const SEED = {
  af_user_prompts: [{ id: 'p1', title: 'A' }, { id: 'p2', title: 'B' }],
  af_workflows: [{ wf_id: 'w1', wf_name: 'WF1' }],
  af_settings: { theme: 'dark' },
  af_auth: { token: 'SECRET' },
  local_mcp_tokens: ['t'],
  af_running_workflow: { wf_id: 'w1' },
  SEOSONA_LOCAL_MODE: true,
  seosona_i18n_vi: { a: 1 },
};

test('export: loại secret + runtime, giữ user data + cache thường', async () => {
  const svc = BS.create({ area: areaWith(SEED), now: () => '2026-07-22T00:00:00Z' });
  const b = await svc.buildExport();
  assert.equal(b.schema, 'seosona.backup.v1');
  assert.ok(b.storage.af_user_prompts);
  assert.ok(b.storage.af_settings);
  assert.ok(b.storage.seosona_i18n_vi);
  assert.ok(!('af_auth' in b.storage));
  assert.ok(!('local_mcp_tokens' in b.storage));
  assert.ok(!('af_running_workflow' in b.storage));
  assert.ok(!('SEOSONA_LOCAL_MODE' in b.storage));
  assert.equal(b.createdAt, '2026-07-22T00:00:00Z');
});

test('export: includeSecrets giữ secret nhưng vẫn loại runtime', async () => {
  const svc = BS.create({ area: areaWith(SEED), now: () => null });
  const b = await svc.buildExport({ includeSecrets: true });
  assert.ok('af_auth' in b.storage);
  assert.ok(!('af_running_workflow' in b.storage));
});

test('import merge: gộp mảng theo id (ghi đè trùng, thêm mới, không nhân đôi)', async () => {
  const area = areaWith({
    af_user_prompts: [{ id: 'p2', title: 'B-cũ' }, { id: 'p3', title: 'C' }],
    af_settings: { theme: 'light' },
  });
  const svc = BS.create({ area, now: () => null });
  await svc.applyImport({ schema: 'seosona.backup.v1', storage: {
    af_user_prompts: [{ id: 'p1', title: 'A' }, { id: 'p2', title: 'B-mới' }],
    af_settings: { theme: 'dark' },
  }}, { mode: 'merge' });
  const d = area._dump();
  assert.ok(d.af_user_prompts.some(p => p.id === 'p3'));
  assert.ok(d.af_user_prompts.some(p => p.id === 'p1'));
  assert.equal(d.af_user_prompts.find(p => p.id === 'p2').title, 'B-mới');
  assert.equal(d.af_user_prompts.filter(p => p.id === 'p2').length, 1);
  assert.equal(d.af_settings.theme, 'dark');
});

test('import replace: mirror backup, xóa key thừa, giữ secret', async () => {
  const area = areaWith({
    af_user_prompts: [{ id: 'pX' }],
    af_history: [{ id: 'h1' }],
    af_auth: { token: 'GIỮ' },
  });
  const svc = BS.create({ area, now: () => null });
  const r = await svc.applyImport({ schema: 'seosona.backup.v1', storage: {
    af_user_prompts: [{ id: 'p1' }],
  }}, { mode: 'replace' });
  const d = area._dump();
  assert.equal(d.af_user_prompts.length, 1);
  assert.equal(d.af_user_prompts[0].id, 'p1');
  assert.ok(!('af_history' in d));
  assert.equal(d.af_auth.token, 'GIỮ');
  assert.equal(r.removed, 1);
});

test('import: nhận bundle legacy privacy.export.v1', async () => {
  const area = areaWith({});
  const svc = BS.create({ area, now: () => null });
  await svc.applyImport({ schema: 'seosona.privacy.export.v1', entries: { af_settings: { theme: 'x' } } });
  assert.equal(area._dump().af_settings.theme, 'x');
});

test('import: schema lạ → reject', async () => {
  const svc = BS.create({ area: areaWith({}), now: () => null });
  await assert.rejects(() => svc.applyImport({ schema: 'bogus', storage: {} }), /không hợp lệ/);
});

test('import: chống prototype pollution', async () => {
  const area = areaWith({});
  const svc = BS.create({ area, now: () => null });
  await svc.applyImport({ schema: 'seosona.backup.v1', storage: {
    ['__proto__']: { polluted: true }, af_settings: { ok: 1 },
  }}, { mode: 'merge' });
  assert.equal(({}).polluted, undefined);
  assert.equal(area._dump().af_settings.ok, 1);
});
