// Đòn 3 — Bảng thực thể: mỗi nhân vật/bối cảnh/đạo cụ MỘT ảnh gốc, dùng lại cho mọi cảnh.
// Đây là cách chống trôi nhận diện; @mention ref thủ công từng node vừa dễ sót vừa
// không có chỗ nào kiểm được "đã đủ ref chưa".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const root = {};
new Function('self', read('src/core/EntitySheet.js'))(root);
const ES = root.EntitySheet;

test('parse: nhận JSON', () => {
  const e = ES.parse('[{"name":"Pippip","type":"character","appearance":"mèo vàng"}]');
  assert.equal(e.length, 1);
  assert.equal(e[0].name, 'Pippip');
  assert.equal(e[0].type, 'character');
});

test('parse: nhận dạng gõ nhanh "Tên | loại | mô tả" (không bắt viết JSON)', () => {
  const e = ES.parse('Pippip | character | mèo vàng tạp dề xanh\nChợ Cá | location | bến cảng sớm');
  assert.equal(e.length, 2);
  assert.equal(e[1].name, 'Chợ Cá');
  assert.equal(e[1].type, 'location');
  assert.equal(e[1].appearance, 'bến cảng sớm');
});

test('parse: thiếu cột loại → mặc định character, không văng lỗi', () => {
  const e = ES.parse('Pippip');
  assert.equal(e[0].type, 'character');
});

test('parse: loại lạ → về mặc định thay vì tạo loại rác', () => {
  assert.equal(ES.parse('X | rồng-lửa | y')[0].type, 'character');
});

test('parse: bỏ dòng trống / mục không tên (không sinh thực thể ma)', () => {
  assert.equal(ES.parse('\n\n  \nPippip | character\n').length, 1);
  assert.equal(ES.parse('[{"type":"character"}]').length, 0);
  assert.deepEqual(ES.parse(''), []);
  assert.deepEqual(ES.parse(null), []);
});

test('trùng tên bị BÁO chứ không tự đổi (prompt gọi tên sẽ nhập nhằng)', () => {
  const e = ES.parse('Pippip | character\npippip | creature');
  assert.deepEqual(ES.duplicateNames(e), ['pippip'], 'so tên không phân biệt hoa thường');
  assert.deepEqual(ES.duplicateNames(ES.parse('A | character\nB | character')), []);
});

test('mỗi loại có hướng khung riêng — nhân vật dọc, bối cảnh ngang', () => {
  assert.equal(ES.typeInfo('character').orient, 'portrait');
  assert.equal(ES.typeInfo('creature').orient, 'portrait');
  assert.equal(ES.typeInfo('prop').orient, 'portrait');
  assert.equal(ES.typeInfo('location').orient, 'landscape');
  assert.equal(ES.typeInfo('location').ratio, '16:9');
});

test('prompt ảnh gốc: đúng kiểu khung + cấm chữ/watermark', () => {
  const p = ES.refSheetPrompt({ name: 'Pippip', type: 'character', appearance: 'mèo vàng' });
  assert.match(p, /Pippip/);
  assert.match(p, /toàn thân/);
  assert.match(p, /mèo vàng/);
  assert.match(p, /không chữ/);
  // Bối cảnh phải là cảnh thiết lập, KHÔNG có nhân vật (nếu không ảnh ref mang theo người thừa).
  assert.match(ES.refSheetPrompt({ name: 'Chợ', type: 'location' }), /không có nhân vật/);
});

test('khối CAST liệt kê tên và ÉP luật "tả hành động, cấm tả ngoại hình"', () => {
  const block = ES.castBlock(ES.parse('Pippip | character | mèo vàng\nChợ | location | bến cảng'));
  assert.match(block, /^\[CAST\]/);
  assert.match(block, /\[\/CAST\]$/);
  assert.match(block, /Pippip \(character\)/);
  assert.match(block, /KHÔNG tả lại ngoại hình/);
});

test('khối CAST KHÔNG nhét mô tả ngoại hình vào (đá nhau với ảnh ref)', () => {
  const block = ES.castBlock(ES.parse('Pippip | character | mèo vàng tạp dề xanh'));
  assert.ok(!block.includes('mèo vàng'), 'ngoại hình phải do ẢNH quy định, không phải chữ');
});

test('khối CAST rỗng khi chưa có thực thể (không chèn rác vào prompt)', () => {
  assert.equal(ES.castBlock([]), '');
  assert.equal(ES.castBlock(null), '');
});

test('cổng chặn: thiếu ảnh gốc thì báo ĐÍCH DANH thực thể nào thiếu', () => {
  const e = ES.parse('A | character\nB | character\nC | location');
  const cov = ES.checkCoverage(e, 1);
  assert.equal(cov.ok, false);
  assert.deepEqual(cov.missing, ['B', 'C']);
  assert.equal(cov.covered, 1);
  assert.equal(cov.total, 3);
});

test('cổng chặn: đủ ảnh thì thông; thừa ảnh cũng thông (không chặn oan)', () => {
  const e = ES.parse('A | character\nB | character');
  assert.equal(ES.checkCoverage(e, 2).ok, true);
  assert.equal(ES.checkCoverage(e, 5).ok, true);
  assert.equal(ES.checkCoverage(e, 5).covered, 2, 'covered không vượt quá số thực thể');
});

test('cổng chặn: không có thực thể nào thì KHÔNG coi là "đủ"', () => {
  assert.equal(ES.checkCoverage([], 0).ok, false);
});

test('bind: ghép ảnh theo THỨ TỰ, thiếu thì để null chứ không lệch hàng', () => {
  const e = ES.parse('A | character\nB | location');
  const b = ES.bind(e, ['file1']);
  assert.equal(b[0].ref, 'file1');
  assert.equal(b[1].ref, null);
  assert.equal(b[1].name, 'B', 'không được dồn ảnh sai thực thể');
});

// ── Đăng ký vào hệ thống node ────────────────────────────────────────────────

test('node entity_ref có trong NodeTemplates (icon + cổng)', () => {
  const src = read('src/workflow/NodeTemplates.js');
  assert.match(src, /entity_ref: `<svg/, 'thiếu icon');
  assert.match(src, /entity_ref: \{/, 'thiếu định nghĩa node');
  assert.match(src, /portEntityRefs/, 'thiếu cổng ra');
});

test('node entity_ref có trong node-catalog (framework validate được)', () => {
  const cat = JSON.parse(read('src/workflow/framework/node-catalog.json'));
  assert.ok(cat.entity_ref, 'catalog thiếu entity_ref');
  assert.equal(cat.entity_ref.outputs, 1);
  assert.equal(cat.entity_ref.ports_out[0].type, 'image');
});

test('executor có dispatch + handler + 4 lỗi rõ ràng', () => {
  const src = read('src/core/WorkflowExecutor.js');
  assert.match(src, /node_type === 'entity_ref'/, 'thiếu dispatch');
  assert.match(src, /_executeEntityRefNode\(node, workflow, nodeLog\)/, 'thiếu handler');
  for (const code of ['ENTITY_SHEET_UNAVAILABLE', 'ENTITY_REF_EMPTY', 'ENTITY_REF_DUPLICATE', 'ENTITY_REF_INCOMPLETE']) {
    assert.ok(src.includes(code), `thiếu mã lỗi ${code}`);
  }
  assert.match(src, /err\.noRetry = true; node\.last_error = 'ENTITY_REF_INCOMPLETE'/,
    'thiếu ref là lỗi cấu hình — thử lại vô ích, phải đánh dấu noRetry');
});

test('picker: entity_ref nằm nhóm Ảnh và tìm được bằng từ khoá', () => {
  const src = read('src/workflow/WorkflowEditorPickers.js');
  assert.match(src, /entity_ref: \['Ảnh', 1\]/);
  assert.match(src, /entity_ref: \['Ảnh', 'Bảng thực thể'/);
});

test('EntitySheet được nạp ở CẢ 3 trang chạy được workflow', () => {
  const cfg = JSON.parse(read('config/page-scripts.json'));
  for (const p of ['pages/sidebar.html', 'pages/workflow-editor.html', 'pages/workflow-template-editor.html']) {
    assert.ok(cfg.pages[p].some((s) => s.endsWith('core/EntitySheet.js')), `${p} thiếu EntitySheet`);
  }
});

test('trang sửa template nạp ĐỦ bộ module mà executor cần (lỗ hổng cũ)', () => {
  // workflow-template-editor.html cũng chạy WorkflowExecutor nhưng trước đây thiếu cả
  // 5 module StyleAnchor/PngText/TextOverlay/TextIntegrity/VietnameseLint → mọi node
  // dùng chúng đều ném *_UNAVAILABLE. Cùng loại lỗ hổng đã vá cho workflow-editor.html.
  const cfg = JSON.parse(read('config/page-scripts.json'));
  const list = cfg.pages['pages/workflow-template-editor.html'];
  for (const m of ['StyleAnchor', 'PngText', 'TextOverlay', 'TextIntegrity', 'VietnameseLint', 'EntitySheet']) {
    assert.ok(list.some((s) => s.endsWith(`core/${m}.js`)), `template editor thiếu ${m}`);
  }
});
