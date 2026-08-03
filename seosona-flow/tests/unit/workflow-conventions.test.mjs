// WorkflowConventions — khai thác quy ước THẬT từ template đang chạy để nạp cho agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');

// nạp template thật + module
const g = {}; g.window = g;
new Function('window', 'self', read('src/workflow/BundledTemplates.js'))(g, g);
new Function('self', read('src/workflow/framework/WorkflowConventions.js'))(g);
const C = g.WorkflowConventions;

test('mine: đọc được template thật (không rỗng)', () => {
  const m = C.mine();
  assert.ok(m.total >= 30, 'phải có ít nhất 30 template, got ' + m.total);
  assert.ok(Object.keys(m.nodes).length >= 8);
  assert.ok(Object.keys(m.edges).length >= 8);
});

test('⭐ bắt được quy ước nối cổng THẬT mà prompt viết tay từng ghi sai', () => {
  const e = C.mine().edges;
  const k = Object.keys(e);
  // ảnh làm reference: media -> image_ref (KHÔNG phải input_1 như mô tả tay cũ)
  assert.ok(k.some((x) => /image -> generate \[media -> image_ref\]/.test(x)), 'thiếu quy ước ref ảnh');
  // ảnh→video dùng cổng frame_1/frame_2 (mô tả tay cũ ghi input_1 — SAI)
  assert.ok(k.some((x) => /\[media -> frame_1\]/.test(x)), 'thiếu quy ước frame_1 cho ảnh→video');
  // luôn kết thúc bằng download
  assert.ok(k.some((x) => /generate -> download/.test(x)), 'thiếu quy ước kết bằng download');
});

test('⭐ bắt được giá trị ratio THẬT (dạng số áp đảo dạng chữ)', () => {
  const r = C.mine().values.ratio;
  const num = (r['16:9'] || 0) + (r['9:16'] || 0);
  const word = (r['Ngang'] || 0) + (r['Dọc'] || 0) + (r['Vuông'] || 0);
  assert.ok(num > word, 'thực tế dạng số phải nhiều hơn dạng chữ (num=' + num + ' word=' + word + ')');
});

test('mine: model thật tách theo image/video', () => {
  const v = C.mine().values;
  assert.ok(Object.keys(v.modelImage).length >= 1);
  assert.ok(Object.keys(v.modelVideo).length >= 1);
  assert.ok(v.modelImage['Nano Banana 2'] || v.modelImage['Nano Banana Pro'], 'thiếu model ảnh thật');
});

test('mine: bỏ field khung sườn, chỉ giữ field mang quy ước', () => {
  const f = C.mine().nodes.generate.fields;
  ['slug', 'slug_auto', 'node_name', 'label', 'enabled'].forEach((k) => {
    assert.equal(f[k], undefined, 'field khung sườn "' + k + '" không được tính là quy ước');
  });
  assert.ok(f.media_type && f.model && f.ratio, 'phải giữ field thật sự mang quy ước');
});

test('summary: sinh text tiếng Anh, có số lần dùng làm bằng chứng', () => {
  const s = C.summary();
  assert.match(s, /LEARNED CONVENTIONS \(mined from \d+ working workflows/);
  assert.match(s, /ground truth/);
  assert.match(s, /\(x\d+\)/, 'phải kèm số lần dùng để model biết cái nào phổ biến');
  assert.match(s, /prefer the most-used form/);
  assert.ok(s.length > 800 && s.length < 6000, 'độ dài hợp lý cho prompt, got ' + s.length);
});

test('summary: nêu cả node phổ biến mà prompt tay từng bỏ sót (text_extract)', () => {
  assert.match(C.summary(), /text_extract/);
});

test('không có template → trả rỗng, KHÔNG throw (agent vẫn chạy)', () => {
  const empty = {};
  new Function('self', read('src/workflow/framework/WorkflowConventions.js'))(empty);
  assert.equal(empty.WorkflowConventions.summary(), '');
  assert.equal(empty.WorkflowConventions.mine().total, 0);
});

test('agent có nạp quy ước vào metaPrompt (guarded)', () => {
  const src = read('src/workflow/framework/WorkflowAgent.js');
  assert.match(src, /root\.WorkflowConventions/, 'agent chưa dùng WorkflowConventions');
  assert.match(src, /conventions\(\)/, 'metaPrompt chưa chèn quy ước');
});

test('sidebar nạp WorkflowConventions TRƯỚC WorkflowAgent', () => {
  const html = read('pages/sidebar.html');
  const iC = html.indexOf('WorkflowConventions.js');
  const iA = html.indexOf('framework/WorkflowAgent.js');
  assert.ok(iC > 0 && iA > 0, 'thiếu script include');
  assert.ok(iC < iA, 'WorkflowConventions phải nạp trước WorkflowAgent');
});
