// Ghép ảnh: dán ảnh GỐC đè lên kết quả outpaint.
// Lý do tồn tại: prompt "absolutely do not modify the original center image" là bất khả thi —
// model khuếch tán tái sinh toàn khung. Khoá pixel là việc của code, không phải của chữ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const root = {};
new Function('window', read('src/core/ImageComposite.js'))(root);
const IC = root.ImageComposite;

test('căn giữa ngang: 1024 vào 1820 → lề 398 mỗi bên', () => {
  const r = IC.centerRect({ w: 1820, h: 1024 }, { w: 1024, h: 1024 });
  assert.equal(r.x, 398);
  assert.equal(r.y, 0);
  assert.equal(r.w, 1024);
  assert.equal(r.h, 1024);
  assert.equal(r.scaled, false, 'KHÔNG được scale — scale là đã nội suy, mất pixel gốc');
});

test('giữ NGUYÊN kích thước gốc, không co giãn theo khung', () => {
  const r = IC.centerRect({ w: 3840, h: 2160 }, { w: 1024, h: 1024 });
  assert.equal(r.w, 1024);
  assert.equal(r.h, 1024, 'ép cao 2160 là nội suy → hỏng mục đích của cả bước này');
});

test('ảnh gốc LỚN hơn khung nền → trả null (không phải bài toán outpaint)', () => {
  assert.equal(IC.centerRect({ w: 800, h: 600 }, { w: 1024, h: 1024 }), null);
  assert.equal(IC.centerRect({ w: 1024, h: 500 }, { w: 1024, h: 1024 }), null, 'chỉ cần lệch 1 chiều là đã sai');
});

test('mode center-scale mới cho phép thu nhỏ, và ĐÁNH DẤU là đã scale', () => {
  const r = IC.centerRect({ w: 512, h: 512 }, { w: 1024, h: 1024 }, { mode: 'center-scale' });
  assert.equal(r.w, 512);
  assert.equal(r.scaled, true, 'phải nói rõ pixel không còn nguyên');
});

test('đầu vào rác → null, không ném lỗi', () => {
  assert.equal(IC.centerRect(null, { w: 1, h: 1 }), null);
  assert.equal(IC.centerRect({ w: 0, h: 0 }, { w: 1, h: 1 }), null);
  assert.equal(IC.centerRect({ w: 100, h: 100 }, { w: -5, h: 10 }), null);
});

// ── Cảnh báo trước khi ghép ──────────────────────────────────────────────────

test('outpaint chuẩn (chỉ nới ngang) → không cảnh báo gì', () => {
  assert.deepEqual(IC.check({ w: 1820, h: 1024 }, { w: 1024, h: 1024 }), []);
});

test('bắt được outpaint đụng cả trên/dưới chứ không chỉ hai bên', () => {
  const w = IC.check({ w: 1820, h: 1200 }, { w: 1024, h: 1024 });
  assert.ok(w.some((x) => /Chiều cao lệch/.test(x)));
});

test('bắt được "chưa mở rộng được gì"', () => {
  const w = IC.check({ w: 1024, h: 1024 }, { w: 1024, h: 1024 });
  assert.ok(w.some((x) => /không rộng hơn/.test(x)));
});

test('bắt được chênh bề rộng LẺ → mép dán lệch nửa pixel', () => {
  const w = IC.check({ w: 1025, h: 1024 }, { w: 1024, h: 1024 });
  assert.ok(w.some((x) => /lẻ/.test(x)), 'lệch nửa pixel tạo viền mảnh rất khó thấy lúc xem nhỏ');
});

test('nhầm thứ tự 2 đầu vào → báo ĐÚNG nguyên nhân, không báo chung chung', () => {
  const w = IC.check({ w: 800, h: 600 }, { w: 1024, h: 1024 });
  assert.equal(w.length, 1);
  assert.match(w[0], /thứ tự 2 đầu vào/);
});

test('center-scale có cảnh báo mất pixel gốc', () => {
  const w = IC.check({ w: 512, h: 512 }, { w: 1024, h: 1024 }, { mode: 'center-scale' });
  assert.ok(w.some((x) => /KHÔNG còn nguyên pixel/.test(x)));
});

test('thiếu ảnh → nói rõ thiếu, không trả mảng rỗng (rỗng nghĩa là "ổn")', () => {
  assert.deepEqual(IC.check(null, null), ['Thiếu ảnh nền hoặc ảnh gốc.']);
});

// ── Hợp đồng môi trường ──────────────────────────────────────────────────────

test('paste() nêu rõ cần Canvas thay vì lỗi khó hiểu', async () => {
  await assert.rejects(() => IC.paste('a', 'b'), /cần môi trường browser/);
});

test('feather mặc định = 0 (giữ pixel gốc là mục đích chính)', () => {
  const src = read('src/core/ImageComposite.js');
  assert.match(src, /var feather = Math\.max\(0, Number\(opts\.feather\) \|\| 0\)/);
  assert.match(src, /if \(!feather\) \{\s*ctx\.drawImage\(orig, rect\.x, rect\.y, rect\.w, rect\.h\);/,
    'không feather thì phải vẽ thẳng, không đi qua mask');
});

// ── Đăng ký node + preset prompt ─────────────────────────────────────────────

test('node image_composite: đủ NodeTemplates + catalog + 2 cổng vào PHÂN BIỆT', () => {
  const src = read('src/workflow/NodeTemplates.js');
  assert.match(src, /image_composite: `<svg/, 'thiếu icon');
  assert.match(src, /portCompBase/, 'thiếu cổng ảnh nền');
  assert.match(src, /portCompOverlay/, 'thiếu cổng ảnh gốc');
  const cat = JSON.parse(read('src/workflow/framework/node-catalog.json'));
  assert.equal(cat.image_composite.inputs, 2);
  assert.equal(cat.image_composite.ports_in[0].name, 'base');
  assert.equal(cat.image_composite.ports_in[1].name, 'overlay');
});

test('executor: dispatch + handler + lấy ảnh theo ĐÚNG CỔNG', () => {
  const src = read('src/core/WorkflowExecutor.js');
  assert.match(src, /node_type === 'image_composite'/);
  assert.match(src, /_executeImageCompositeNode\(node, workflow, nodeLog\)/);
  // Lấy nhầm cổng thì dán ngược: ảnh gốc thành nền, mất sạch phần mở rộng.
  assert.match(src, /pick\('base'\) \|\| pick\('input_1'\)/);
  assert.match(src, /pick\('overlay'\) \|\| pick\('input_2'\)/);
  assert.match(src, /_resolveUpstreamThumb\(node, workflow, port\)/, 'resolver phải nhận tham số cổng');
});

test('resolver cũ KHÔNG đổi hành vi khi không truyền cổng', () => {
  const src = read('src/core/WorkflowExecutor.js');
  assert.match(src, /if \(port\) edges = edges\.filter/, 'lọc phải có điều kiện, không thì mọi nơi gọi cũ đều hỏng');
});

test('form: 2 trường có ô nhập + đường lưu, feather bị kẹp 0–64', () => {
  const form = read('src/workflow/WorkflowEditorNodeForm.js');
  for (const [id, f] of [['nodeCompMode', 'composite_mode'], ['nodeCompFeather', 'composite_feather']]) {
    assert.ok(form.includes(`id="${id}"`), `thiếu ô ${id}`);
    assert.ok(form.includes(`data.${f} =`), `không lưu ${f}`);
  }
  assert.match(form, /Math\.min\(64, Math\.max\(0, f\)\)/);
});

test('preset prompt outpaint: gọn, không có NEGATIVE PROMPT, không có 8K', () => {
  const src = read('src/prompts/BundledPrompts.js');
  const i = src.indexOf('"img_outpaint_expand"');
  assert.ok(i > 0, 'thiếu preset');
  const block = src.slice(i, i + 1600);
  assert.ok(!/NEGATIVE PROMPT/i.test(block), 'Flow chỉ có 1 ô text — negative prompt là vô hiệu');
  assert.ok(!/\b8K\b|7680/.test(block.split('LƯU Ý')[0]), 'phần prompt không được ghi 8K');
  assert.match(block, /4K \(4096px\)/, 'phải nói rõ trần thật của Flow');
});

test('preset title card: KHÔNG để AI vẽ chữ + có câu chặn nhạc nền', () => {
  const src = read('src/prompts/BundledPrompts.js');
  const i = src.indexOf('"vid_title_plate_black"');
  assert.ok(i > 0, 'thiếu preset');
  const block = src.slice(i, i + 2200);
  assert.match(block, /NO TEXT, NO LETTERS/, 'chữ tiếng Việt có dấu do AI vẽ là hỏng');
  assert.match(block, /no background music, keep natural sound effects/, 'phải khớp PromptHygiene');
});

test('template 1044 nối ĐÚNG cổng: gen→base, ảnh gốc→overlay', () => {
  const src = read('src/workflow/BundledWorkflowsExtra.js');
  assert.match(src, /E\(p \+ 'gen', p \+ 'comp', 'output_1', 'base'\)/);
  assert.match(src, /E\(p \+ 'src', p \+ 'comp', 'output_1', 'overlay'\)/);
});
