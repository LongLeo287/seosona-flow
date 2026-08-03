// Đòn 1 — phân loại retry theo LOẠI LỖI + backoff luỹ thừa + cầu chì.
// Trước đây mọi lỗi gộp chung một mức (BatchQueue: 2 lần, cách nhau 3s), sai ở hai đầu:
// rớt mạng thì đốt oan ngân sách retry, còn bị Google gắn cờ thì thử lại càng nặng thêm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const root = {};
new Function('self', readFileSync(join(PKG, 'src/workflow/RetryPolicy.js'), 'utf8'))(root);
const RP = root.SEOSONA_RetryPolicy;

test('không tính ngân sách: sự cố ngoài nội dung (ref hết hạn, rớt kết nối, đổi tab)', () => {
  for (const c of ['media_expired', 'entity_not_found', 'disconnected', 'reconnected', 'switched']) {
    const r = RP.classifyFailure(c);
    assert.equal(r.action, 'requeue', c);
    assert.equal(r.counts, false, `${c} KHÔNG được tính vào ngân sách retry`);
  }
});

test('halt: bị Google gắn cờ thì DỪNG, tuyệt đối không tự thử lại', () => {
  for (const c of ['captcha', 'captcha_failed', 'bot_detected']) {
    const r = RP.classifyFailure(c);
    assert.equal(r.action, 'halt', c);
    assert.equal(r.recoverable, false, `${c} không được coi là tự phục hồi`);
  }
});

test('terminal: hết quota / sai tầng / bị chặn nội dung — retry vô ích', () => {
  for (const c of ['quota', 'quota_exceeded', 'tier_restricted', 'policy', 'content_blocked']) {
    assert.equal(RP.classifyFailure(c).action, 'terminal', c);
  }
});

test('retry có backoff: quá tải và lỗi tạm phía server', () => {
  for (const c of ['rate_limit', 'network', 'server_error']) {
    const r = RP.classifyFailure(c);
    assert.equal(r.action, 'retry', c);
    assert.equal(r.counts, true, c);
  }
});

test('lỗi lạ → retry có giới hạn (không bỏ oan, cũng không thử vô hạn)', () => {
  const r = RP.classifyFailure('cái gì đó chưa từng thấy');
  assert.equal(r.action, 'retry');
  assert.equal(r.counts, true);
  assert.equal(r.category, 'unknown');
});

test('phân loại KHÔNG phân biệt hoa thường (reason code từ API là chữ HOA)', () => {
  assert.equal(RP.classifyFailure('BOT_DETECTED').action, 'halt');
  assert.equal(RP.classifyFailure('Media_Expired').action, 'requeue');
});

test('backoff: 10s → 20s → 40s → 80s → 160s, chặn trần 300s', () => {
  const L = { baseBackoffMs: 10000, maxBackoffMs: 300000 };
  assert.equal(RP.backoffFromLimits(1, L), 10000);
  assert.equal(RP.backoffFromLimits(2, L), 20000);
  assert.equal(RP.backoffFromLimits(3, L), 40000);
  assert.equal(RP.backoffFromLimits(4, L), 80000);
  assert.equal(RP.backoffFromLimits(5, L), 160000);
  assert.equal(RP.backoffFromLimits(6, L), 300000, 'phải chặn trần, không lên 320s');
  assert.equal(RP.backoffFromLimits(50, L), 300000, 'trần giữ nguyên ở lần thử rất lớn');
});

test('backoff: thiếu config vẫn ra số an toàn (không rơi về 0)', () => {
  assert.ok(RP.backoffFromLimits(1, undefined) >= 10000);
  assert.ok(RP.backoffFromLimits(1, {}) >= 10000);
});

test('cầu chì: đủ ngưỡng thì mở, hết thời gian thì tự đóng', () => {
  const cb = RP.createCircuitBreaker({ circuitBreakerThreshold: 3, circuitBreakerResetMs: 60000 });
  let t = 1000;
  assert.equal(cb.isOpen(t), false);
  assert.equal(cb.recordFailure(t), false);
  assert.equal(cb.recordFailure(t), false);
  assert.equal(cb.recordFailure(t), true, 'lỗi thứ 3 làm mạch MỞ');
  assert.equal(cb.isOpen(t), true);
  assert.equal(cb.remainingMs(t), 60000);
  assert.equal(cb.isOpen(t + 59999), true, 'chưa hết thời gian thì vẫn mở');
  assert.equal(cb.isOpen(t + 60000), false, 'hết thời gian thì tự đóng');
  assert.equal(cb.stats().consecutive, 0, 'đóng lại thì reset bộ đếm');
});

test('cầu chì: một lần thành công xoá sạch chuỗi lỗi liên tiếp', () => {
  const cb = RP.createCircuitBreaker({ circuitBreakerThreshold: 3 });
  cb.recordFailure(0); cb.recordFailure(0);
  cb.recordSuccess();
  assert.equal(cb.stats().consecutive, 0);
  assert.equal(cb.recordFailure(0), false, 'phải đếm lại từ đầu, không mở ngay');
});

test('cầu chì: không tự gọi Date.now (mốc thời gian truyền vào) — test tất định', () => {
  const src = readFileSync(join(PKG, 'src/workflow/RetryPolicy.js'), 'utf8');
  assert.ok(!/Date\.now\(\)/.test(src), 'RetryPolicy phải thuần, không đọc đồng hồ');
});

test('hai trục độc lập: hiệu ứng node và loại lỗi không lẫn vào nhau', () => {
  // generate là non-repeatable (không tự retry khi chưa xác nhận)…
  assert.equal(RP.effectClass('generate'), 'non-repeatable');
  assert.equal(RP.shouldRetry('generate', 1, {}).reason, 'NEEDS_CONFIRMATION');
  // …nhưng loại lỗi vẫn phân loại độc lập được.
  assert.equal(RP.classifyFailure('rate_limit').action, 'retry');
});
