// Luật chọn dòng trong submenu "Tải xuống" của Flow.
//
// Dữ liệu lấy từ ảnh chụp menu THẬT trên tài khoản Ultra (2026-08-04) — giao diện tiếng Việt,
// 4K đã mở khoá nên KHÔNG còn chữ "Upgrade" để lọc; thứ phải nhận ra là "Đã tăng độ phân giải"
// và "· 50 tín dụng".
//
// Ba hàm dưới đây phản chiếu logic trong content_scripts/content.js. Chúng được nhân bản ở đây
// vì content.js là một file content-script khổng lồ không import được; test này khoá LUẬT, còn
// test regression cuối file khoá việc content.js vẫn mang đúng các hàm đó.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const FULL_SIZE_TEXTS = ['original size', 'original', 'kích thước gốc', 'bản gốc', 'gốc'];
const isUpscaled = (t) => {
  const s = String(t || '').toLowerCase();
  return s.includes('upscal') || s.includes('tăng độ phân giải') || s.includes('đã tăng');
};
const costsCredits = (t) => /\d+\s*(tín dụng|credits?)/.test(String(t || '').toLowerCase());
const isOriginal = (t) => FULL_SIZE_TEXTS.some((x) => String(t || '').toLowerCase().includes(x));

// Menu THẬT, tài khoản Ultra, tiếng Việt.
const VIDEO_MENU = [
  '270p Ảnh GIF động',
  '720p Kích thước gốc',
  '1080p Đã tăng độ phân giải',
  '4K Đã tăng độ phân giải · 50 tín dụng',
];
const IMAGE_MENU = [
  '1K Kích thước gốc',
  '2K Đã tăng độ phân giải',
  '4K Đã tăng độ phân giải',
];

function pick(menu, requested) {
  const pickable = menu.filter((t) => !t.toLowerCase().includes('gif') &&
    !t.toLowerCase().includes('upgrade') && !t.toLowerCase().includes('nâng cấp'));
  const free = pickable.filter((t) => !costsCredits(t));
  const original = free.filter(isOriginal);
  let target = free.find((t) => t.toLowerCase().startsWith(String(requested).toLowerCase())) || null;
  if (target && isUpscaled(target) && original.length) target = original[0];
  if (!target) target = original[0] || free[free.length - 1] || null;
  return target;
}

test('positive: xin đúng bản gốc thì lấy đúng dòng đó', () => {
  assert.equal(pick(IMAGE_MENU, '1k'), '1K Kích thước gốc');
  assert.equal(pick(VIDEO_MENU, '720p'), '720p Kích thước gốc');
});

// Đây là ca đã làm hỏng thật: cài đặt để 1080p, mà 1080p trên tài khoản này là bản PHÓNG TO —
// bấm vào không ra file, ta chờ tải rồi nhận về trang thông báo và lưu ra .htm.
test('negative: xin mức phóng to thì lùi về bản gốc, không bấm vào nó', () => {
  assert.equal(pick(VIDEO_MENU, '1080p'), '720p Kích thước gốc');
  assert.equal(pick(IMAGE_MENU, '2k'), '1K Kích thước gốc');
  assert.equal(pick(IMAGE_MENU, '4k'), '1K Kích thước gốc');
});

test('boundary: không bao giờ chạm dòng tốn tín dụng', () => {
  for (const req of ['4k', '1080p', '720p', 'khong-ton-tai']) {
    const got = pick(VIDEO_MENU, req);
    assert.ok(!costsCredits(got), `"${got}" không tốn tín dụng (xin ${req})`);
  }
});

test('boundary: không bao giờ chọn dòng GIF', () => {
  for (const req of ['270p', '720p', '1080p', '4k']) {
    assert.ok(!pick(VIDEO_MENU, req).toLowerCase().includes('gif'));
  }
});

// Nhãn lưu trong cài đặt là chữ thường ('1k'), menu ghi chữ hoa ('1K').
test('regression: so khớp không phân biệt hoa thường', () => {
  assert.equal(pick(IMAGE_MENU, '1K'), pick(IMAGE_MENU, '1k'));
  assert.equal(pick(VIDEO_MENU, '720P'), '720p Kích thước gốc');
});

test('regression: nhãn lạ thì vẫn ra bản gốc, không leo lên mức cao nhất', () => {
  assert.equal(pick(IMAGE_MENU, '8k'), '1K Kích thước gốc');
  assert.equal(pick(VIDEO_MENU, ''), '720p Kích thước gốc');
});

// FULL_SIZE_TEXTS từng là const CỤC BỘ trong downloadViaFullSizeMenu; dùng nó ở
// downloadViaFlowMenu là ReferenceError lúc chạy, mà `node --check` không bắt được.
test('regression: content.js có hàm dùng chung, không phải const cục bộ', () => {
  const src = readFileSync(join(root, 'content_scripts/content.js'), 'utf8');
  assert.match(src, /function _fullSizeTexts\(\)/, 'có _fullSizeTexts() dùng chung');
  assert.match(src, /function _isUpscaledItem\(/, 'có _isUpscaledItem()');
  assert.match(src, /function _costsCredits\(/, 'có _costsCredits()');
  assert.ok(!/const FULL_SIZE_TEXTS = \(cfgItem/.test(src), 'không còn bản const cục bộ cũ');
  assert.ok(src.includes('tăng độ phân giải'), 'nhận diện được nhãn phóng to tiếng Việt');
  assert.ok(/tín dụng\|credits/.test(src), 'nhận diện được nhãn tốn tín dụng');
});
