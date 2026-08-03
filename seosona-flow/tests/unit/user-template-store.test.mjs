// UserTemplateStore tests — CRUD kho template user + fork từ bundled (không đụng gốc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { createChromeMock } from '../../tests/helpers/chrome-mock.mjs';

const UTS = loadClassic('src/workflow/UserTemplateStore.js').SEOSONA_UserTemplateStore;

function mk(seedBundled) {
  const chrome = createChromeMock();
  const area = chrome.storage.local;
  let n = 0;
  const svc = UTS.create({
    area,
    getBundled: () => seedBundled || [],
    now: () => '2026-07-22T00:00:00Z',
    genId: () => 'utpl_test_' + (n++),
  });
  return { svc, area };
}

test('saveNew: cấp id utpl_, set _userTemplate, đọc lại được', async () => {
  const { svc, area } = mk();
  const rec = await svc.saveNew({ name: 'X', nodes: [{ id: 'n1' }], edges: [] });
  assert.ok(rec.id.startsWith('utpl_'));
  assert.equal(rec._userTemplate, true);
  assert.equal(rec.name, 'X');
  const list = await svc.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, rec.id);
  assert.ok(Array.isArray(area._dump().af_user_templates));
});

test('get: lấy đúng theo id, id lạ → null', async () => {
  const { svc } = mk();
  const rec = await svc.saveNew({ name: 'A' });
  assert.equal((await svc.get(rec.id)).name, 'A');
  assert.equal(await svc.get('utpl_khong_co'), null);
});

test('update: ghi đè field, giữ id + created_at, đổi updated_at', async () => {
  const { svc } = mk();
  const rec = await svc.saveNew({ name: 'A', description: 'd0' });
  const created = rec.created_at;
  const up = await svc.update(rec.id, { description: 'd1', name: 'A2' });
  assert.equal(up.id, rec.id);
  assert.equal(up.description, 'd1');
  assert.equal(up.name, 'A2');
  assert.equal(up.created_at, created);
  assert.equal((await svc.list()).length, 1); // không nhân đôi
});

test('update: id không tồn tại → null', async () => {
  const { svc } = mk();
  assert.equal(await svc.update('utpl_nope', { name: 'x' }), null);
});

test('remove: xóa đúng, id lạ → false', async () => {
  const { svc } = mk();
  const r = await svc.saveNew({ name: 'A' });
  assert.equal(await svc.remove('utpl_khac'), false);
  assert.equal(await svc.remove(r.id), true);
  assert.equal((await svc.list()).length, 0);
});

test('forkFromBundled: sao chép sâu vào kho user, KHÔNG đụng bản gốc', async () => {
  const bundled = [{ id: 1001, name: 'Mặc định', nodes: [{ id: 'n1', data: { prompt: 'P' } }], edges: [{ id: 'e1' }] }];
  const { svc } = mk(bundled);
  const fork = await svc.forkFromBundled(1001);
  assert.ok(fork.id.startsWith('utpl_'));
  assert.equal(fork._forkedFrom, 1001);
  assert.match(fork.name, /bản của tôi/);
  assert.equal(fork.nodes.length, 1);
  // Sửa fork KHÔNG ảnh hưởng bundled (deep clone)
  fork.nodes[0].data.prompt = 'ĐỔI';
  assert.equal(bundled[0].nodes[0].data.prompt, 'P');
  // bản gốc KHÔNG bị thêm vào kho user
  const list = await svc.list();
  assert.equal(list.length, 1);
  assert.ok(list.every(t => t.id.startsWith('utpl_')));
});

test('forkFromBundled: id gốc không tồn tại → reject', async () => {
  const { svc } = mk([{ id: 1 }]);
  await assert.rejects(() => svc.forkFromBundled(999), /Không tìm thấy/);
});

test('isUserTemplateId: phân biệt id user vs bundled', () => {
  assert.equal(UTS.isUserTemplateId('utpl_abc'), true);
  assert.equal(UTS.isUserTemplateId('1001'), false);
  assert.equal(UTS.isUserTemplateId(1001), false);
});
