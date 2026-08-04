// SF-014 — tầng "ux" trước đây KHÔNG có file test nào, runner in "skipping" rồi exit 0, nên
// `npm run verify` báo xanh cho một tầng chưa từng kiểm gì. Đây là bộ test đầu tiên của tầng đó.
//
// Chọn những bất biến kiểm được TĨNH (không cần trình duyệt), và chọn đúng loại lỗi đã thực sự
// xảy ra với dự án này: id trùng làm getElementById trả nhầm phần tử, ô nhập không nhãn thì
// người dùng trình đọc màn hình không biết nó là gì, và thẻ đóng/mở lệch làm vỡ bố cục.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PAGES = readdirSync(join(root, 'pages')).filter((f) => f.endsWith('.html'));
const readPage = (f) => readFileSync(join(root, 'pages', f), 'utf8');

// Bỏ qua nội dung trong <script> và <!-- --> để không đếm nhầm chuỗi trong mã.
function stripNonMarkup(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

test('positive: có trang để kiểm và trang nào cũng có <title>', () => {
  assert.ok(PAGES.length >= 10, `phải có ít nhất 10 trang, thấy ${PAGES.length}`);
  for (const f of PAGES) {
    assert.match(readPage(f), /<title[^>]*>[^<]+<\/title>/i, `${f} phải có <title> không rỗng`);
  }
});

// id trùng: getElementById trả phần tử ĐẦU TIÊN, nên phần tử thứ hai im lặng không hoạt động.
test('negative: không trang nào có id trùng', () => {
  const problems = [];
  for (const f of PAGES) {
    const html = stripNonMarkup(readPage(f));
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const seen = new Set();
    const dup = new Set();
    for (const id of ids) { if (seen.has(id)) dup.add(id); else seen.add(id); }
    if (dup.size) problems.push(`${f}: ${[...dup].join(', ')}`);
  }
  assert.deepEqual(problems, [], `id trùng:\n  ${problems.join('\n  ')}`);
});

// Đã cháy thật một lần: một thẻ </div> thừa đẩy nguyên danh sách ra ngoài tab-pane, và
// check:html KHÔNG bắt được vì nó chỉ kiểm tài nguyên khai báo, không kiểm cân bằng thẻ.
test('negative: thẻ <div> mở và đóng phải cân bằng', () => {
  const problems = [];
  for (const f of PAGES) {
    const html = stripNonMarkup(readPage(f));
    const open = (html.match(/<div\b/gi) || []).length;
    const close = (html.match(/<\/div>/gi) || []).length;
    if (open !== close) problems.push(`${f}: mở ${open} / đóng ${close} (lệch ${open - close})`);
  }
  assert.deepEqual(problems, [], `div lệch:\n  ${problems.join('\n  ')}`);
});

test('boundary: ô nhập nào cũng phải có nhãn đọc được', () => {
  const problems = [];
  for (const f of PAGES) {
    const html = stripNonMarkup(readPage(f));
    const labelFor = new Set([...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]));
    const fields = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)];
    for (const [, tag, attrs] of fields) {
      const type = (attrs.match(/\stype="([^"]+)"/) || [])[1] || '';
      if (/^(hidden|submit|button)$/i.test(type)) continue;
      const id = (attrs.match(/\sid="([^"]+)"/) || [])[1];
      const labelled = (id && labelFor.has(id)) ||
        /aria-label(?:ledby)?=/.test(attrs) || /placeholder=/.test(attrs) || /title=/.test(attrs);
      if (!labelled) problems.push(`${f}: <${tag}${id ? ` id="${id}"` : ''}> chưa có nhãn`);
    }
  }
  assert.deepEqual(problems, [], `thiếu nhãn:\n  ${problems.join('\n  ')}`);
});

// CSP của extension page chặn inline script; nhúng script ngoài cũng bị chặn. Bắt sớm ở đây
// rẻ hơn là mở trang lên mới thấy trắng.
test('regression: không trang nào nạp script từ máy chủ ngoài', () => {
  const problems = [];
  for (const f of PAGES) {
    const html = readPage(f);
    for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/gi)) {
      if (/^https?:|^\/\//i.test(m[1])) problems.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(problems, [], `script ngoài:\n  ${problems.join('\n  ')}`);
});
