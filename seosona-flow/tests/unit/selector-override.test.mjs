// SelectorOverride tests — vá selector nóng, không reload extension.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(PKG, 'src/core/SelectorOverride.js'), 'utf8');

// chrome.storage.local giả + phát onChanged như Chrome thật.
function fakeChrome() {
  const store = {};
  const listeners = [];
  return {
    store,
    api: {
      storage: {
        local: {
          get(keys, cb) { const out = {}; (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; }); cb(out); },
          set(obj, cb) {
            const changes = {};
            for (const k of Object.keys(obj)) { changes[k] = { oldValue: store[k], newValue: obj[k] }; store[k] = obj[k]; }
            listeners.forEach((l) => l(changes, 'local'));
            cb && cb();
          },
        },
        onChanged: { addListener(fn) { listeners.push(fn); } },
      },
    },
    fire(changes, area) { listeners.forEach((l) => l(changes, area)); },
  };
}

function fresh(seed) {
  const c = fakeChrome();
  if (seed) c.store.af_selector_overrides = seed;
  const root = { chrome: c.api };
  // module dùng `chrome` global → gán vào globalThis cho lần load này
  const prev = globalThis.chrome;
  globalThis.chrome = c.api;
  new Function('self', src)(root);
  globalThis.chrome = prev;
  return { SO: root.SelectorOverride, c, root };
}

test('chưa có override → get trả null (không can thiệp config gốc)', () => {
  const { SO } = fresh();
  assert.equal(SO.get('flow', 'submit_button'), null);
  assert.equal(SO.getConfig('flow', 'submit_button'), null);
});

test('set → get trả selector mới, shape khớp config gốc', async () => {
  const { SO } = fresh();
  await SO.set('flow', 'submit_button', ['button.new']);
  assert.deepEqual(SO.get('flow', 'submit_button'), ['button.new']);
  const cfg = SO.getConfig('flow', 'submit_button');
  assert.deepEqual(cfg.selectors, ['button.new']);
  assert.equal(cfg._override, true, 'đánh dấu là override để debug');
});

test('nhận chuỗi "a, b" → tách thành mảng', async () => {
  const { SO } = fresh();
  await SO.set('flow', 'k', '.a, .b , .c');
  assert.deepEqual(SO.get('flow', 'k'), ['.a', '.b', '.c']);
});

test('remove → quay lại config gốc (không còn override)', async () => {
  const { SO } = fresh();
  await SO.set('flow', 'k', ['.x']);
  await SO.remove('flow', 'k');
  assert.equal(SO.get('flow', 'k'), null);
});

test('clear xoá sạch mọi override', async () => {
  const { SO } = fresh();
  await SO.set('flow', 'a', ['.a']);
  await SO.set('chatgpt', 'b', ['.b']);
  assert.equal(SO.list().length, 2);
  await SO.clear();
  assert.equal(SO.list().length, 0);
});

test('⭐ CẬP NHẬT NÓNG — storage đổi từ ngữ cảnh khác → có hiệu lực NGAY, không reload', () => {
  const { SO, c } = fresh();
  assert.equal(SO.get('flow', 'submit_button'), null);
  // giả lập: sidebar ghi override, content script nhận onChanged
  c.fire({ af_selector_overrides: { newValue: { flow: { submit_button: ['button.hotfix'] } } } }, 'local');
  assert.deepEqual(SO.get('flow', 'submit_button'), ['button.hotfix'], 'phải thấy ngay mà không cần load lại');
});

test('onChanged ở area khác (sync) → bỏ qua', () => {
  const { SO, c } = fresh({ flow: { k: ['.keep'] } });
  c.fire({ af_selector_overrides: { newValue: { flow: { k: ['.changed'] } } } }, 'sync');
  assert.deepEqual(SO.get('flow', 'k'), ['.keep'], 'chỉ nghe local');
});

test('load từ storage có sẵn khi khởi động', async () => {
  const { SO } = fresh({ flow: { tile_video: ['.tv2'] } });
  await SO.load();
  assert.deepEqual(SO.get('flow', 'tile_video'), ['.tv2']);
});

test('list liệt kê đủ provider + key', async () => {
  const { SO } = fresh();
  await SO.set('flow', 'a', ['.a']);
  await SO.set('grok', 'b', ['.b']);
  const l = SO.list().sort((x, y) => x.provider.localeCompare(y.provider));
  assert.deepEqual(l.map((x) => x.provider), ['flow', 'grok']);
});

test('input rác → không throw, không tạo override rỗng', async () => {
  const { SO } = fresh();
  assert.equal(await SO.set('', 'k', ['.a']), false);
  assert.equal(await SO.set('flow', '', ['.a']), false);
  await SO.set('flow', 'k', ['   ', '']);
  assert.equal(SO.get('flow', 'k'), null, 'selector rỗng không được lưu');
});

test('hint gợi đúng lệnh vá để copy', () => {
  const { SO } = fresh();
  const h = SO.hint('flow', 'submit_button');
  assert.match(h, /SelectorOverride\.set/);
  assert.match(h, /flow/);
  assert.match(h, /submit_button/);
});
