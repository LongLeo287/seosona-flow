// SelectorHealth tests — preflight tự kiểm selector, mã hoá "gãy 1 chỗ ≠ chết toàn bộ".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const load = (p, root) => { new Function('self', readFileSync(join(PKG, p), 'utf8'))(root); return root; };

function fresh() {
  const root = {};
  load('src/core/SelectorDoctor.js', root);
  load('src/core/SelectorHealth.js', root);
  return root;
}

// DOM giả: khai báo selector nào "có phần tử".
function fakeDoc(presentSelectors) {
  return {
    querySelector(sel) {
      const parts = String(sel).split(',').map((s) => s.trim());
      return parts.some((p) => presentSelectors.includes(p)) ? { tag: 'el' } : null;
    },
  };
}

const RESOLVE = {
  slate_editor: '.slate',
  submit_button: 'button.go',
  tile_video: '.tv',
  tile_image: '.ti',
  tile_container: '.tc',
  project_link: '.pl',
  settings_button: '.sb',
  menu_item: '.mi',
};
const resolve = (k) => RESOLVE[k] || null;
const KEYS = {
  slate_editor: 'blocking', submit_button: 'blocking',
  tile_video: 'critical', tile_image: 'critical', tile_container: 'critical', project_link: 'critical',
  settings_button: 'degraded', menu_item: 'degraded',
};
const ALL = Object.values(RESOLVE);

test('mọi selector khớp → ok, cho chạy', () => {
  const { SelectorHealth: H } = fresh();
  const r = H.check({ resolve, keys: KEYS, doc: fakeDoc(ALL) });
  assert.equal(r.ok, true);
  assert.equal(r.canRun, true);
  assert.equal(r.missing.length, 0);
  assert.equal(r.checked, 8);
  assert.match(r.summary, /đều OK/);
});

test('gãy selector BLOCKING → chặn chạy (không phí quota)', () => {
  const { SelectorHealth: H } = fresh();
  const r = H.check({ resolve, keys: KEYS, doc: fakeDoc(ALL.filter((s) => s !== 'button.go')) });
  assert.equal(r.ok, false);
  assert.equal(r.canRun, false, 'thiếu nút submit thì KHÔNG được chạy');
  assert.equal(r.missing[0].key, 'submit_button');
  assert.match(r.summary, /CHẶN CHẠY/);
});

test('⭐ gãy selector DEGRADED → VẪN CHẠY (gãy 1 chỗ không giết toàn bộ)', () => {
  const { SelectorHealth: H } = fresh();
  const r = H.check({ resolve, keys: KEYS, doc: fakeDoc(ALL.filter((s) => s !== '.sb' && s !== '.mi')) });
  assert.equal(r.ok, false, 'có phát hiện hỏng');
  assert.equal(r.canRun, true, 'nhưng KHÔNG chặn chạy');
  assert.equal(r.missing.length, 2);
  assert.match(r.summary, /vẫn chạy/);
});

test('gãy CRITICAL → vẫn cho chạy nhưng cảnh báo mạnh', () => {
  const { SelectorHealth: H } = fresh();
  const r = H.check({ resolve, keys: KEYS, doc: fakeDoc(ALL.filter((s) => s !== '.tv')) });
  assert.equal(r.canRun, true);
  assert.match(r.summary, /không lấy được kết quả/);
});

test('sắp xếp: blocking lên trước critical, rồi degraded', () => {
  const { SelectorHealth: H } = fresh();
  const r = H.check({ resolve, keys: KEYS, doc: fakeDoc([]) });
  const sevs = r.missing.map((m) => m.severity);
  assert.equal(sevs[0], 'blocking');
  assert.equal(sevs.indexOf('degraded') > sevs.lastIndexOf('critical'), true, 'degraded phải nằm cuối');
});

test('thiếu config (resolve trả null) → tính là hỏng, nêu lý do no_config', () => {
  const { SelectorHealth: H } = fresh();
  const r = H.check({ resolve: (k) => (k === 'submit_button' ? null : RESOLVE[k]), keys: KEYS, doc: fakeDoc(ALL) });
  const m = r.missing.find((x) => x.key === 'submit_button');
  assert.equal(m.reason, 'no_config');
  assert.equal(r.canRun, false);
});

test('kết quả được đẩy sang SelectorDoctor để có lịch sử', () => {
  const root = fresh();
  root.SelectorHealth.check({ resolve, keys: KEYS, doc: fakeDoc(ALL.filter((s) => s !== 'button.go')) });
  const rep = root.SelectorDoctor.report();
  assert.ok(rep.broken.some((b) => b.key === 'submit_button'), 'selector hỏng phải vào báo cáo Doctor');
  assert.ok(rep.okCount > 0, 'selector khớp cũng được ghi nhận');
});

test('selector lỗi cú pháp → không throw, đánh dấu bad_selector', () => {
  const { SelectorHealth: H } = fresh();
  const doc = { querySelector() { throw new Error('bad selector'); } };
  const r = H.check({ resolve, keys: { slate_editor: 'blocking' }, doc });
  assert.equal(r.missing[0].reason, 'bad_selector');
  assert.equal(r.canRun, false);
});

test('thiếu DOM/bộ tra → không chặn chạy (không tự gây kẹt)', () => {
  const { SelectorHealth: H } = fresh();
  const r = H.check({ resolve: null, doc: null });
  assert.equal(r.canRun, true, 'không kiểm được thì KHÔNG được tự chặn người dùng');
  assert.equal(r.checked, 0);
});

test('map mặc định phủ đúng các key ở đường chạy thật', () => {
  const { SelectorHealth: H } = fresh();
  for (const k of ['slate_editor', 'submit_button', 'tile_video', 'tile_image', 'project_link']) {
    assert.ok(H.CRITICAL_MAP[k], 'thiếu key quan trọng: ' + k);
  }
  assert.equal(H.CRITICAL_MAP.slate_editor.severity, 'blocking');
  assert.equal(H.CRITICAL_MAP.settings_button.severity, 'degraded');
});

test('⭐ KHÔNG báo động giả: key theo-trạng-thái bị bỏ qua khi kiểm tĩnh', () => {
  const { SelectorHealth: H } = fresh();
  // menu/dialog/tile chỉ tồn tại ở trạng thái nhất định → kiểm trên trang tĩnh phải BỎ QUA
  for (const k of ['menu_item', 'flow_modal_dialog', 'grid_size_small_button', 'tile_video']) {
    assert.equal(H.CRITICAL_MAP[k].presence, 'conditional', k + ' phải là conditional');
  }
  // còn 2 key blocking phải luôn được kiểm
  assert.equal(H.CRITICAL_MAP.slate_editor.presence, 'always');
  assert.equal(H.CRITICAL_MAP.submit_button.presence, 'always');

  const keys = { a: { severity: 'degraded', presence: 'always' }, b: { severity: 'degraded', presence: 'conditional' } };
  const doc = { querySelector: () => null };
  const r = H.check({ resolve: () => '.x', keys, doc });
  assert.equal(r.checked, 1, 'chỉ kiểm key always');
  assert.equal(r.skipped, 1, 'key conditional bị bỏ qua');
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].key, 'a');
});

test('includeConditional=true → kiểm cả key theo-trạng-thái', () => {
  const { SelectorHealth: H } = fresh();
  const keys = { a: { severity: 'degraded', presence: 'always' }, b: { severity: 'degraded', presence: 'conditional' } };
  const r = H.check({ resolve: () => '.x', keys, doc: { querySelector: () => null }, includeConditional: true });
  assert.equal(r.checked, 2);
  assert.equal(r.skipped, 0);
});

test('shape cũ (severity phẳng) vẫn chạy — tương thích ngược', () => {
  const { SelectorHealth: H } = fresh();
  const r = H.check({ resolve: () => '.x', keys: { a: 'blocking' }, doc: { querySelector: () => null } });
  assert.equal(r.missing[0].severity, 'blocking');
  assert.equal(r.canRun, false);
});

test('⭐ AUTO gợi ý selector thay thế từ role/aria của selector cũ', () => {
  const { SelectorHealth: H } = fresh();
  const btn = { tagName: 'BUTTON', attributes: [], getAttribute: (n) => (n === 'role' ? 'button' : n === 'aria-label' ? 'Gửi prompt' : null), textContent: 'Gửi' };
  const doc = {
    querySelectorAll(q) {
      if (q === '[role="button"]') return [btn];
      if (q === 'button[role="button"][aria-label="Gửi prompt"]') return [btn]; // đếm độ đặc trưng
      return [];
    },
  };
  const s = H.suggest('button[role="button"][aria-label="Gửi"]', { doc });
  assert.ok(s.length >= 1, 'phải gợi ý được ít nhất 1 ứng viên');
  assert.match(s[0].selector, /aria-label="Gửi prompt"/, 'ưu tiên thuộc tính ngữ nghĩa');
  assert.equal(s[0].matches, 1, 'kèm số phần tử khớp để biết có đặc trưng không');
});

test('describe: bỏ qua id có số dài (do build sinh, dễ vỡ)', () => {
  const { SelectorHealth: H } = fresh();
  const el = { tagName: 'DIV', attributes: [], getAttribute: (n) => (n === 'id' ? 'x-12345678' : null) };
  assert.equal(H.describe(el), null, 'thà không gợi ý còn hơn gợi ý selector dễ vỡ');
});

test('suggest: ứng viên khớp quá nhiều phần tử thì loại (không đặc trưng)', () => {
  const { SelectorHealth: H } = fresh();
  const el = { tagName: 'DIV', attributes: [], getAttribute: (n) => (n === 'role' ? 'listitem' : null), textContent: '' };
  const doc = {
    querySelectorAll(q) {
      if (q === '[role="listitem"]') return [el];
      if (q === 'div[role="listitem"]') return new Array(50).fill(el); // 50 phần tử → quá chung
      return [];
    },
  };
  assert.equal(H.suggest('[role="listitem"]', { doc }).length, 0);
});
