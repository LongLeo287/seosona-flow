// Style Anchor node — chèn khối phong cách vào MỌI prompt đi qua (đăng ký + logic + hợp đồng UI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');

const root = {};
new Function('self', read('src/core/StyleAnchor.js'))(root);
const SA = root.StyleAnchor;

test('inject: khối anchor được bọc nhãn và đặt trước prompt', () => {
  const out = SA.inject('a cat on a table', 'film 35mm\nbảng màu đất', { label: 'STYLE' });
  assert.match(out, /^\[STYLE\]/);
  assert.match(out, /\[\/STYLE\]/);
  assert.ok(out.indexOf('film 35mm') < out.indexOf('a cat'), 'anchor phải đứng trước prompt');
});

test('inject: position=append đặt anchor sau prompt', () => {
  const out = SA.inject('a cat', 'film 35mm', { label: 'STYLE', position: 'append' });
  assert.ok(out.indexOf('a cat') < out.indexOf('film 35mm'));
});

test('applyToMany: MỌI prompt đều được neo (đúng mục đích loạt ảnh nhất quán)', () => {
  const prompts = ['cảnh 1', 'cảnh 2', 'cảnh 3'];
  const out = SA.applyToMany(prompts, 'bảng màu đất', { label: 'STYLE' });
  assert.equal(out.length, 3);
  out.forEach((p, i) => {
    assert.match(p, /bảng màu đất/, 'prompt ' + i + ' thiếu anchor');
    assert.match(p, new RegExp('cảnh ' + (i + 1)), 'prompt ' + i + ' mất nội dung gốc');
  });
});

test('check: phát hiện anchor bị thiếu dòng (coverage < 1)', () => {
  const block = 'dòng A\ndòng B';
  const full = SA.inject('x', block);
  assert.equal(SA.check(full, block).coverage, 1);
  assert.ok(SA.check('chỉ có dòng A thôi', block).coverage < 1);
});

test('inject: khối rỗng → giữ nguyên prompt (không chèn rác)', () => {
  assert.equal(SA.inject('a cat', '   '), 'a cat');
});

// ── Đăng ký vào hệ thống node ───────────────────────────────────────────────
test('node style_anchor có trong NodeTemplates (icon + cấu hình cổng)', () => {
  const src = read('src/workflow/NodeTemplates.js');
  assert.match(src, /style_anchor: `<svg/, 'thiếu icon');
  assert.match(src, /style_anchor: \{/, 'thiếu định nghĩa node');
  assert.match(src, /portPromptsAnchored/, 'thiếu cổng ra');
});

test('node style_anchor có trong node-catalog (framework validate được)', () => {
  const cat = JSON.parse(read('src/workflow/framework/node-catalog.json'));
  assert.ok(cat.style_anchor, 'catalog thiếu style_anchor');
  assert.equal(cat.style_anchor.inputs, 1);
  assert.equal(cat.style_anchor.outputs, 1);
  assert.equal(cat.style_anchor.ports_in[0].type, 'text');
});

test('executor có dispatch + handler cho style_anchor', () => {
  const src = read('src/core/WorkflowExecutor.js');
  assert.match(src, /node_type === 'style_anchor'/, 'thiếu dispatch');
  assert.match(src, /_executeStyleAnchorNode\(node, workflow, emitLog\)/, 'thiếu handler');
  assert.match(src, /STYLE_ANCHOR_NO_BLOCK/, 'thiếu lỗi rõ khi chưa nhập khối');
  assert.match(src, /STYLE_ANCHOR_NO_INPUT/, 'thiếu lỗi rõ khi không có prompt upstream');
});

test('picker: style_anchor nằm nhóm Prompt (dùng TRƯỚC node gen)', () => {
  const src = read('src/workflow/WorkflowEditor.js') + read('src/workflow/WorkflowEditorPickers.js');
  assert.match(src, /style_anchor: \['Prompt', 2\]/, 'thiếu nhóm trong picker');
  assert.match(src, /style_anchor: \['Prompt', 'Neo style'/, 'thiếu tag tìm kiếm');
});

test('config-UI: 3 trường có form VÀ được lưu (hợp đồng id)', () => {
  // Form cấu hình node đã tách sang WorkflowEditorNodeForm.js (augment prototype) — hợp đồng
  // vẫn là "có form + có save chain", chỉ nằm ở 2 file thay vì 1.
  const src = read('src/workflow/WorkflowEditor.js') + read('src/workflow/WorkflowEditorNodeForm.js');
  for (const id of ['nodeAnchorBlock', 'nodeAnchorLabel', 'nodeAnchorPos']) {
    assert.ok(src.includes('id="' + id + '"'), 'form thiếu ' + id);
    assert.ok(src.includes("'#" + id + "'"), 'save chain thiếu ' + id);
  }
  assert.match(src, /data\.anchor_block =/, 'không lưu anchor_block');
  assert.match(src, /data\.anchor_position = .*append.*prepend/, 'không lưu vị trí chèn');
});

test('nút Motion Recipes đã gỡ khỏi header (hết trùng lặp với video-prompt scaffold)', () => {
  assert.ok(!read('pages/sidebar.html').includes('headerMotionBtn'), 'sidebar còn nút Motion');
  assert.ok(!/headerMotionBtn'\)/.test(read('src/prompts/GenTab.js')), 'GenTab còn handler Motion');
});
