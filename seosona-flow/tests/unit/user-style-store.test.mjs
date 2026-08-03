// Kho STYLE cục bộ — học ý tưởng CRUD style từ sản phẩm cùng ngách, nhưng lưu ở MÁY thay vì server.
// Style là văn bản của người dùng; không có lý do gì phải rời máy họ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const root = {};
new Function('window', read('src/storage/UserStyleStore.js'))(root);
const S = root.UserStyleStore;

const NOW = '2026-08-01T00:00:00.000Z';
const mk = (name, content) => ({ name, content });

test('validate: tên và nội dung đều bắt buộc, lỗi là câu tiếng Việt đọc được', () => {
  assert.equal(S.validate({ name: '', content: 'x' }).error, 'Chưa đặt tên style.');
  assert.equal(S.validate({ name: 'A', content: '  ' }).error, 'Chưa nhập nội dung style.');
  assert.equal(S.validate({ name: ' A ', content: ' x ' }).ok, true);
});

test('validate: cắt khoảng trắng thừa ở tên và nội dung', () => {
  const v = S.validate({ name: '  Phim 35mm  ', content: '  hạt phim nhẹ  ' });
  assert.equal(v.style.name, 'Phim 35mm');
  assert.equal(v.style.content, 'hạt phim nhẹ');
});

test('validate: chặn quá dài, nói rõ giới hạn', () => {
  assert.match(S.validate({ name: 'a'.repeat(61), content: 'x' }).error, /60 ký tự/);
  assert.match(S.validate({ name: 'a', content: 'x'.repeat(4001) }).error, /4000 ký tự/);
});

test('thêm mới: có id, có mốc thời gian, đánh dấu created', () => {
  const r = S.upsert([], mk('Phim 35mm', 'hạt phim nhẹ'), { now: NOW, seed: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.match(r.style.id, /^ust_/);
  assert.equal(r.style.createdAt, NOW);
  assert.equal(r.style.source, 'user');
  assert.equal(r.list.length, 1);
});

test('KHÔNG sửa mảng đầu vào (UI đang render từ chính mảng đó)', () => {
  const list = [];
  S.upsert(list, mk('A', 'x'), { now: NOW });
  assert.equal(list.length, 0, 'sửa tại chỗ là UI lệch state');
});

test('trùng tên bị chặn, KHÔNG phân biệt hoa thường', () => {
  const a = S.upsert([], mk('Phim 35mm', 'x'), { now: NOW }).list;
  const r = S.upsert(a, mk('phim 35MM', 'y'), { now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.error, /Đã có style tên/);
});

test('sửa: giữ nguyên createdAt, chỉ đổi updatedAt', () => {
  const a = S.upsert([], mk('A', 'x'), { now: NOW }).list;
  const id = a[0].id;
  const r = S.upsert(a, { id, name: 'A', content: 'y' }, { now: '2026-09-09T00:00:00.000Z' });
  assert.equal(r.ok, true);
  assert.equal(r.created, false);
  assert.equal(r.style.createdAt, NOW, 'sửa nội dung không phải là tạo mới');
  assert.equal(r.style.updatedAt, '2026-09-09T00:00:00.000Z');
  assert.equal(r.style.content, 'y');
});

test('sửa: giữ NGUYÊN tên của chính nó không bị báo trùng', () => {
  const a = S.upsert([], mk('A', 'x'), { now: NOW }).list;
  const r = S.upsert(a, { id: a[0].id, name: 'A', content: 'z' }, { now: NOW });
  assert.equal(r.ok, true, 'tự trùng với chính mình là bình thường');
});

test('sửa mục đã bị xoá → báo rõ, không lặng lẽ tạo mới', () => {
  const r = S.upsert([], { id: 'ust_khongcothat', name: 'A', content: 'x' }, { now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.error, /đã bị xoá/);
});

test('xoá: trả danh sách mới + mục vừa xoá; xoá cái không có thì báo', () => {
  const a = S.upsert([], mk('A', 'x'), { now: NOW }).list;
  const r = S.remove(a, a[0].id);
  assert.equal(r.ok, true);
  assert.equal(r.list.length, 0);
  assert.equal(a.length, 1, 'không đụng mảng gốc');
  assert.equal(S.remove([], 'x').ok, false);
});

test('gộp hiển thị: style NGƯỜI DÙNG thắng khi trùng tên style hệ thống', () => {
  const builtin = [{ name: 'Phim 35mm', content: 'mặc định' }, { name: 'Anime', content: 'a' }];
  const user = [{ id: 'u1', name: 'phim 35mm', content: 'bản của tôi', source: 'user' }];
  const out = S.mergeForDisplay(builtin, user);
  assert.equal(out.length, 2, 'không nhân đôi');
  assert.equal(out[0].content, 'bản của tôi', 'họ tạo ra nó là để THAY cái mặc định');
  assert.ok(out.some((s) => s.name === 'Anime'), 'style hệ thống khác vẫn còn');
});

test('gộp hiển thị: đầu vào rỗng/null không làm vỡ', () => {
  assert.deepEqual(S.mergeForDisplay(null, null), []);
  assert.equal(S.mergeForDisplay([{ name: 'A' }], []).length, 1);
});

test('id ổn định theo tên + seed (test tất định, không đọc đồng hồ)', () => {
  assert.equal(S.makeId('A', 1), S.makeId('A', 1));
  assert.notEqual(S.makeId('A', 1), S.makeId('B', 1));
  assert.ok(!/Date\.now\(\)/.test(read('src/storage/UserStyleStore.js').split('// ── Lớp lưu trữ')[0]),
    'phần thuần không được đọc đồng hồ');
});

test('khoá lưu trữ theo đúng quy ước af_* của các kho khác', () => {
  assert.equal(S.KEY, 'af_user_styles');
});

// ── Nối vào modal chọn phong cách ────────────────────────────────────────────

test('modal có đủ 6 method CRUD (trước đây chỉ có chọn)', () => {
  const src = read('src/shared/StyleSelectModal.js');
  for (const m of ['_showForm', '_hideForm', '_isFormOpen', '_saveForm', '_deleteForm', '_updateCharCount']) {
    assert.ok(src.includes(`static ${m}(`) || src.includes(`static async ${m}(`), `thiếu ${m}`);
  }
});

test('nạp style cục bộ BẤT ĐỒNG BỘ — không chặn lúc mở modal', () => {
  const src = read('src/shared/StyleSelectModal.js');
  assert.match(src, /StyleSelectModal\._open\(\);\s*\n[\s\S]{0,220}_loadUserStyles\(\)/,
    'phải mở modal trước rồi mới nạp; chờ storage là người dùng thấy trễ vô cớ');
});

test('chỉ style CỦA NGƯỜI DÙNG mới có nút sửa', () => {
  const src = read('src/shared/StyleSelectModal.js');
  assert.match(src, /_isMine\(addon\.id\)/);
  assert.match(src, /static _isMine\(id\)/);
});

test('bấm nút sửa KHÔNG lan thành "chọn style rồi đóng modal"', () => {
  const src = read('src/shared/StyleSelectModal.js');
  assert.match(src, /e\.stopPropagation\(\)/);
});

test('form đang mở thì click danh sách không đóng modal mất nội dung đang gõ', () => {
  const src = read('src/shared/StyleSelectModal.js');
  assert.match(src, /if \(StyleSelectModal\._isFormOpen\(\)\) return;/);
});

test('xoá style đang được chọn thì bỏ chọn (không trỏ vào thứ không còn)', () => {
  const src = read('src/shared/StyleSelectModal.js');
  assert.match(src, /_selectedId === box\.dataset\.editing.*_selectedId = null/s);
});

test('xoá có hỏi xác nhận', () => {
  assert.match(read('src/shared/StyleSelectModal.js'), /customDialog\?\.confirm/);
});

test('lỗi từ store hiện THẲNG lên form, không dịch lại', () => {
  const src = read('src/shared/StyleSelectModal.js');
  assert.match(src, /_showFormError\(r\.error\)/);
});

test('nút sửa có aria-label (icon trần thì trình đọc màn hình không hiểu)', () => {
  assert.match(read('src/shared/StyleSelectModal.js'), /aria-label="Sửa style/);
});

test('CSS dùng token, không màu literal', () => {
  const css = read('styles/sidebar.css');
  const block = css.slice(css.indexOf('.style-modal-foot'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block.slice(0, 1400)), 'còn màu literal trong khối style-modal');
  assert.match(block, /var\(--destructive\)/);
});
