// Badminton_SourcePreserving_Edit_8K — bản thiết kế workflow chương 11.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const scope = {};
new Function('self', 'window', readFileSync(join(root, 'src/sports-image/BadmintonWorkflow.js'), 'utf8'))(scope, scope);
const W = scope.SEOSONA_BadmintonWorkflow;

test('positive: đủ 13 bước theo đúng thứ tự đặc tả', () => {
  assert.equal(W.name, 'Badminton_SourcePreserving_Edit_8K');
  assert.equal(W.STEPS.length, 13);
  const order = W.STEPS.map((s) => s.node);
  assert.equal(order[0], 'image_input');
  assert.equal(order[1], 'source_lock', 'khoá nguồn phải đứng ngay sau ảnh vào');
  assert.equal(order[order.length - 1], 'sports_validator', 'chấm cuối cùng');
  assert.equal(order[order.length - 2], 'compare_diff', 'đo pixel trước khi phán xét');
});

test('positive: đồ thị phụ thuộc hợp lệ — không bước nào cần thứ chưa có', () => {
  const v = W.validateGraph();
  assert.equal(v.ok, true, v.problems.join('; '));
});

test('positive: 5 bước chạy được ngay tính từ đầu', () => {
  const p = W.runnablePrefix();
  assert.deepEqual(p, ['src', 'lock', 'preset', 'reframe', 'ref'],
    'chạy được tới ref; dừng ở mask — bước đầu tiên cần engine cục bộ');
});

test('negative: nêu ĐÚNG bước nào chờ engine, không mập mờ', () => {
  const blocked = W.blockedByEngine();
  assert.deepEqual(blocked.sort(), ['bind', 'face', 'inpaint', 'mask', 'upscale']);
  for (const id of blocked) {
    const s = W.STEPS.find((x) => x.id === id);
    assert.equal(s.impl, null, `${id} chưa có impl — không được giả vờ có`);
  }
});

test('positive: bước làm được ngay mà chưa viết được liệt kê riêng', () => {
  // reframe đã xây xong → không còn bước nào 'làm được ngay mà chưa viết'.
  assert.deepEqual(W.todoNoEngine(), [], 'Lát 1 đã hết việc không cần engine');
});

test('regression: 5 bước ready phải trỏ tới impl CÓ THẬT', () => {
  const ready = W.STEPS.filter((s) => s.ready && s.impl);
  assert.ok(ready.length >= 4);
  for (const s of ready) {
    if (!s.impl.startsWith('SEOSONA_')) continue;
    const mod = s.impl.split('.')[0].replace('SEOSONA_', '');
    const file = join(root, `src/sports-image/${mod}.js`);
    assert.doesNotThrow(() => readFileSync(file), `${s.id} trỏ tới ${mod}.js phải tồn tại`);
  }
});

test('regression: node upscale mang cảnh báo tín dụng', () => {
  const s = W.STEPS.find((x) => x.id === 'upscale');
  assert.match(s.note, /TỐN TÍN DỤNG/, 'phải nói rõ, không để ai chạy lại rồi mất tiền');
  assert.match(s.note, /KHÔNG mượn Flow/);
});

test('regression: localized_inpaint nói rõ vì sao Flow không làm được', () => {
  const s = W.STEPS.find((x) => x.id === 'inpaint');
  assert.match(s.note, /KHÔNG nhận mask/);
  assert.deepEqual(s.params.denoise, [0.18, 0.25], 'ngưỡng đúng §8.3');
});

test('regression: reference chỉ áp TRONG mask', () => {
  const s = W.STEPS.find((x) => x.id === 'ref');
  assert.equal(s.params.referenceRole, 'equipment');
  assert.equal(s.params.applyReferenceOnlyInsideMask, true);
});

test('regression: giữ đủ danh sách "fail ngay" của §11', () => {
  assert.equal(W.HARD_FAILS.length, 5);
  assert.ok(W.HARD_FAILS.some((x) => /thay mặt/.test(x)));
  assert.ok(W.HARD_FAILS.some((x) => /thêm vợt|cầu/.test(x)));
});
