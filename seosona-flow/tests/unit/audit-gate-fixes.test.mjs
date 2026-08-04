// SF-003 / SF-005 / SF-014 / SF-017 — bốn vá về cổng kiểm và tính trung thực của báo cáo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(join(root, f), 'utf8');

// SF-005 — verify ký ACCEPTED trên 15 tầng KHÔNG gồm E2E, còn README lại nói là có.
test('SF-005: có hai lệnh tách bạch, verify:release mới gồm E2E', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts['verify:release'], 'phải có lệnh verify:release');
  assert.match(pkg.scripts['verify:release'], /--release/, 'nó phải bật cờ release');

  const tiers = read('scripts/quality/lib/tiers.mjs');
  assert.match(tiers, /export const RELEASE_TIERS/, 'có RELEASE_TIERS');
  const verify = read('scripts/quality/verify.mjs');
  assert.match(verify, /RELEASE_TIERS/, 'verify.mjs dùng tới nó');
  assert.match(verify, /process\.env\.SEOSONA_RELEASE = '1'/, 'chế độ release bật biến môi trường');
});

test('SF-005: README không còn nói verify đã gồm E2E', () => {
  const readme = read('README.md');
  assert.ok(!/verify.*\+ unit\/integration\/E2E/.test(readme), 'câu sai cũ đã gỡ');
  assert.match(readme, /E2E chạy RIÊNG/, 'nói rõ E2E chạy riêng');
  assert.match(readme, /15 tier/, 'ghi đúng số tầng');
});

// SF-014 — tầng không có file test vẫn exit 0, nên verify báo xanh cho thứ chưa kiểm gì.
test('SF-014: tầng rỗng là LỖI ở chế độ phát hành', () => {
  const runner = read('scripts/test/run-tests.mjs');
  assert.match(runner, /SEOSONA_RELEASE === '1'/, 'runner biết chế độ phát hành');
  assert.match(runner, /process\.exit\(1\)/, 'tầng rỗng ở chế độ đó thì đỏ');
  // Và phải đỏ TRƯỚC nhánh exit(0), nếu không thì không bao giờ tới.
  // Tìm TỪ khối xử lý trở đi — dòng chú thích đầu file cũng chứa cụm chữ này.
  const blk = runner.indexOf('files.length === 0');
  const i = runner.indexOf('has no test files yet', blk);
  const strictIdx = runner.indexOf('strict', blk);
  assert.ok(strictIdx > 0 && strictIdx < i, 'kiểm strict đứng trước nhánh bỏ qua');
});

test('SF-014: tầng ux nay CÓ test thật', () => {
  const files = readdirSync(join(root, 'tests/ux')).filter((f) => f.endsWith('.test.mjs'));
  assert.ok(files.length >= 1, 'tests/ux phải có ít nhất một file');
});

// SF-003 — NetworkPolicy tồn tại không chứng minh mọi nơi đều dùng nó.
test('SF-003: có cổng chặn fetch trần và nó nằm trong security:verify', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts['security:rawfetch'], 'có lệnh riêng');
  assert.match(pkg.scripts['security:verify'], /security:rawfetch/, 'đã nối vào cổng bảo mật');
  const baseline = JSON.parse(read('config/raw-fetch-baseline.json'));
  assert.ok(typeof baseline.counts['background.js'] === 'number', 'có trần cho background.js');
  assert.ok(baseline.counts['background.js'] <= 20, 'trần không được nới lên');
});

// SF-017 — fallback tải bản gốc nhưng đặt đuôi theo định dạng người dùng CHỌN.
test('SF-017: fallback không đặt đuôi theo định dạng đã chọn, và có báo cho người dùng', () => {
  const bg = read('background.js');
  const i = bg.indexOf('async function _saveImageAsFormat');
  const body = bg.slice(i, i + 3000);
  assert.ok(!/const ext = m \? m\[1\]\.toLowerCase\(\)\.replace\('jpeg', 'jpg'\) : format;/.test(body),
    'không còn lấy `format` làm đuôi khi URL không có đuôi');
  assert.match(body, /: '';/, 'không xác định được thì để trống cho Chrome tự suy');
  assert.match(body, /đã lưu BẢN GỐC/, 'có thông báo nói rõ đã lưu bản gốc');
});
