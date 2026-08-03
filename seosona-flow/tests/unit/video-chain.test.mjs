// Đòn 4 — nối cảnh: cảnh N lấy ảnh cảnh N+1 làm khung cuối để ghép liền mạch.
// Quan trọng ngang tính năng: CẢNH BÁO đúng cái giá phải trả (khung tĩnh trùng ở chỗ nối).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const root = {};
new Function('self', readFileSync(join(PKG, 'src/core/VideoChain.js'), 'utf8'))(root);
const VC = root.VideoChain;

const S = (id, image, chain_type, location) => ({ id, image, chain_type, location });

test('CONTINUATION lấy ảnh cảnh KẾ TIẾP làm khung cuối', () => {
  const p = VC.plan([S('a', 'i1', 'CONTINUATION'), S('b', 'i2', 'CONTINUATION'), S('c', 'i3')]);
  assert.equal(p.steps[0].mode, 'chain');
  assert.equal(p.steps[0].startImage, 'i1');
  assert.equal(p.steps[0].endImage, 'i2', 'khung cuối phải là ảnh của cảnh SAU');
  assert.equal(p.steps[1].endImage, 'i3');
  assert.equal(p.steps[2].mode, 'single', 'ROOT thì không nối');
});

test('ROOT là mặc định — không khai gì thì cắt cứng, không tự nối', () => {
  const p = VC.plan([S('a', 'i1'), S('b', 'i2')]);
  assert.equal(p.chains, 0);
  assert.equal(p.steps[0].mode, 'single');
  assert.equal(VC.chainTypeOf({}), 'ROOT');
  assert.equal(VC.chainTypeOf({ chain_type: 'continuation' }), 'CONTINUATION', 'không phân biệt hoa thường');
  assert.equal(VC.chainTypeOf({ chain_type: 'lung tung' }), 'ROOT', 'giá trị lạ → ROOT cho an toàn');
});

test('cảnh CUỐI đặt CONTINUATION → hạ về cắt cứng + cảnh báo, KHÔNG ném lỗi', () => {
  const p = VC.plan([S('a', 'i1', 'CONTINUATION')]);
  assert.equal(p.steps[0].mode, 'single');
  assert.equal(p.chains, 0);
  assert.match(p.warnings.join('\n'), /không có cảnh sau/);
});

test('thiếu ảnh (của chính nó hoặc của cảnh sau) → không nối + nói rõ thiếu ở đâu', () => {
  const a = VC.plan([S('a', 'i1', 'CONTINUATION'), S('b', null)]);
  assert.equal(a.steps[0].mode, 'single');
  assert.match(a.warnings.join('\n'), /cảnh sau chưa có ảnh/);

  const b = VC.plan([S('a', null, 'CONTINUATION'), S('b', 'i2')]);
  assert.equal(b.steps[0].mode, 'single');
  assert.match(b.warnings.join('\n'), /chính nó chưa có ảnh/);
});

test('nối qua ranh giới BỐI CẢNH thì cảnh báo (đây là lúc khung trùng lộ rõ nhất)', () => {
  const p = VC.plan([
    S('a', 'i1', 'CONTINUATION', 'quán cà phê'),
    S('b', 'i2', 'ROOT', 'bãi biển'),
  ]);
  assert.equal(p.steps[0].mode, 'chain');
  assert.match(p.warnings.join('\n'), /nối sang bối cảnh khác/);
  assert.match(p.warnings.join('\n'), /nên để ROOT/);
});

test('cùng bối cảnh thì KHÔNG cảnh báo lung tung', () => {
  const p = VC.plan([
    S('a', 'i1', 'CONTINUATION', 'quán cà phê'),
    S('b', 'i2', 'ROOT', 'quán cà phê'),
  ]);
  assert.ok(!p.warnings.some((w) => /bối cảnh khác/.test(w)));
});

test('LUÔN nói ra cái giá: khung tĩnh trùng ở mỗi chỗ nối', () => {
  const p = VC.plan([S('a', 'i1', 'CONTINUATION'), S('b', 'i2', 'CONTINUATION'), S('c', 'i3')]);
  assert.equal(p.chains, 2);
  const w = p.warnings.join('\n');
  assert.match(w, /10–16 khung/);
  assert.match(w, /Cắt bớt phần chồng/);
});

test('không nối thì không cảnh báo thừa', () => {
  assert.deepEqual(VC.plan([S('a', 'i1'), S('b', 'i2')]).warnings, []);
});

test('tính tổng thời lượng dôi — để trừ khi khớp video với giọng đọc', () => {
  const t = VC.totalOverlapSeconds(3);
  assert.ok(t.min > 1.2 && t.min < 1.3, 'khoảng 3 × 0,42s');
  assert.ok(t.max > 1.9 && t.max < 2.1, 'khoảng 3 × 0,67s');
  assert.deepEqual(VC.totalOverlapSeconds(0), { min: 0, max: 0 });
  assert.deepEqual(VC.totalOverlapSeconds(-5), { min: 0, max: 0 }, 'số âm không làm âm kết quả');
});

test('fps khác thì thời lượng dôi đổi theo', () => {
  assert.ok(VC.overlapSeconds(30).max < VC.overlapSeconds(24).max);
});

test('danh sách rỗng / không phải mảng → trả kế hoạch rỗng, không ném', () => {
  assert.deepEqual(VC.plan([]).steps, []);
  assert.deepEqual(VC.plan(null).steps, []);
  assert.equal(VC.plan(undefined).chains, 0);
});

test('phần tử null trong danh sách không làm gãy', () => {
  const p = VC.plan([null, S('b', 'i2')]);
  assert.equal(p.steps.length, 2);
});
