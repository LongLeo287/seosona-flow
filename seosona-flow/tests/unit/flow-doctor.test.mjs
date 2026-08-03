// Đòn 6 — Bác sĩ: mỗi mã lỗi Flow phải có QUY TRÌNH KHÔI PHỤC, không chỉ câu thông báo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const root = {};
new Function('self', read('src/core/FlowDoctor.js'))(root);
const FD = root.FlowDoctor;

test('PHỦ ĐỦ mọi mã lỗi mà config Flow khai (không sót mã nào không có cách xử)', () => {
  // api_error_codes trong ProviderConfigManager ánh xạ mã API → tên nội bộ.
  const src = read('src/core/ProviderConfigManager.js');
  const block = src.slice(src.indexOf('"api_error_codes"'), src.indexOf('"api_model_mapping"'));
  const names = [...block.matchAll(/:"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 6, `chỉ đọc ra ${names.length} mã — regex hỏng?`);
  for (const n of names) {
    assert.ok(FD.lookup(n), `Bác sĩ thiếu mục cho "${n}"`);
  }
});

test('mỗi mục đều đủ 4 phần: tiêu đề, nguyên nhân, các bước, mức độ', () => {
  for (const k of FD.categories()) {
    const e = FD.lookup(k);
    assert.ok(e.title && e.title.length > 5, `${k}: tiêu đề quá sơ sài`);
    assert.ok(e.cause && e.cause.length > 10, `${k}: thiếu nguyên nhân`);
    assert.ok(Array.isArray(e.steps) && e.steps.length >= 2, `${k}: phải có ít nhất 2 bước`);
    assert.ok(['stop', 'wait', 'fix'].includes(e.severity), `${k}: mức độ lạ`);
  }
});

test('bí danh: tên nội bộ và tên theo mã API cùng trỏ một mục', () => {
  assert.equal(FD.lookup('policy').key, 'content_blocked');
  assert.equal(FD.lookup('quota').key, 'quota_exceeded');
  assert.equal(FD.lookup('entity_not_found').key, 'media_expired');
  assert.equal(FD.lookup('POLICY').key, 'content_blocked', 'không phân biệt hoa thường');
});

test('mã lạ → null (không bịa hướng dẫn)', () => {
  assert.equal(FD.lookup('khong-co-that'), null);
  assert.equal(FD.lookup(''), null);
  assert.equal(FD.lookup(null), null);
});

test('bị gắn cờ: bước ĐẦU TIÊN phải là DỪNG, không phải thử lại', () => {
  const e = FD.lookup('bot_detected');
  assert.equal(e.severity, 'stop');
  assert.match(e.steps[0], /Dừng/, 'phản xạ sai nhất là bấm chạy lại ngay');
  assert.match(e.steps.join('\n'), /cookie/i);
  assert.match(e.steps.join('\n'), /THỦ CÔNG/);
});

test('nội dung bị chặn: hướng sang chủ thể TỰ NGHĨ — KHÔNG phải mẹo lách bộ lọc', () => {
  const e = FD.lookup('content_blocked');
  assert.match(e.steps.join('\n'), /TỰ NGHĨ|tự nghĩ/);
  const all = JSON.stringify(FD.BOOK).toLowerCase();
  for (const bad of ['bypass', 'lách', 'né bộ lọc', 'qua mặt', 'giả lập hành vi', 'three-quarter profile']) {
    assert.ok(!all.includes(bad), `Bác sĩ không được chứa mẹo lách: "${bad}"`);
  }
});

test('trả về BẢN SAO — sửa kết quả không làm hỏng bảng gốc', () => {
  const a = FD.lookup('captcha');
  a.steps.push('rác');
  assert.ok(!FD.lookup('captcha').steps.includes('rác'));
});

// ── Tự kiểm ──────────────────────────────────────────────────────────────────

test('tự kiểm: tất cả đạt → ok=true', async () => {
  const r = await FD.selfCheck({
    flowTab: () => true, loggedIn: () => true, contentScript: () => true, credits: () => true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.checks.length, 4);
  assert.ok(r.checks.every((c) => c.fix === null), 'đạt rồi thì không gợi ý sửa');
});

test('tự kiểm: mục hỏng phải kèm CÁCH SỬA cụ thể', async () => {
  const r = await FD.selfCheck({ flowTab: () => false, loggedIn: () => true, contentScript: () => true, credits: () => true });
  assert.equal(r.ok, false);
  const bad = r.checks.find((c) => c.id === 'flowTab');
  assert.match(bad.fix, /labs\.google/);
});

test('tự kiểm: mất kết nối content script gợi ý ĐÚNG cách (F5 tab Flow)', async () => {
  const r = await FD.selfCheck({ contentScript: () => false });
  const c = r.checks.find((x) => x.id === 'contentScript');
  assert.match(c.fix, /F5/, 'tải lại tiện ích làm tab cũ mất kết nối — đây là lỗi hay gặp nhất');
});

test('tự kiểm: hàm dò ném lỗi → coi là KHÔNG đạt, không làm sập cả bảng', async () => {
  const r = await FD.selfCheck({ flowTab: () => { throw new Error('tắt tịt'); } });
  assert.equal(r.ok, false);
  assert.equal(r.checks.find((c) => c.id === 'flowTab').detail, 'tắt tịt');
  assert.equal(r.checks.length, 4, 'các mục còn lại vẫn phải được kiểm');
});

test('tự kiểm: thiếu hàm dò → mục đó không đạt thay vì văng lỗi', async () => {
  const r = await FD.selfCheck({});
  assert.equal(r.ok, false);
  assert.equal(r.checks.length, 4);
});

test('tự kiểm: hàm dò trả {ok, detail} thì giữ được detail', async () => {
  const r = await FD.selfCheck({ credits: () => ({ ok: false, detail: 'còn 0 credit' }) });
  assert.equal(r.checks.find((c) => c.id === 'credits').detail, 'còn 0 credit');
});
