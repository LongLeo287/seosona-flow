// Hai lỗi tìm ra khi đối chiếu bản mới nhất của sản phẩm cùng ngách.
//
// ① Nhánh đổi tên SỚM trong onDeterminingFilename không có lớp chặn HTML nào — đây là chỗ file
//    .htm chui ra. bản đó VẪN dính lỗi này, ta thừa hưởng chứ không tự gây ra.
// ② Ta đổi zoom thật của tab (chrome.tabs.setZoom) mà không có đường trả lại khi tiến trình chết
//    giữa chừng. bản đó có cơ chế bảo hiểm zoom cho đúng việc này; ta thì chưa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const bg = read('background.js');
const ct = read('content_scripts/content.js');

// Bản sao của _resolveMediaExt để kiểm bảng quyết định mà không phải nạp cả service worker.
const MEDIA = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov', 'm4v'];
function resolveExt(name, mime, preferVideo) {
  const clean = String(name || '').split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  const ext = (dot >= 0 ? clean.slice(dot + 1) : '').toLowerCase();
  if (MEDIA.includes(ext)) return ext;
  const m = String(mime || '');
  if (m.startsWith('video/') || preferVideo) return 'mp4';
  if (m.startsWith('image/')) return m === 'image/jpeg' ? 'jpg' : (m.split('/')[1] || 'png');
  return 'png';
}

test('positive: đuôi media hợp lệ thì giữ nguyên', () => {
  assert.equal(resolveExt('anh.png', 'image/png', false), 'png');
  assert.equal(resolveExt('phim.mp4', 'video/mp4', false), 'mp4');
  assert.equal(resolveExt('anh.JPG', 'image/jpeg', false), 'jpg');
});

// Đúng ca người dùng báo: Chrome đưa tên .htm và ta lưu nguyên ra đĩa.
test('negative: .htm/.html KHÔNG bao giờ thành đuôi file', () => {
  for (const n of ['media.htm', 'media.html', 'media.html?x=1', 'x.html#a', 'media']) {
    const e = resolveExt(n, 'image/png', false);
    assert.ok(!['htm', 'html'].includes(e), `${n} → ${e}`);
  }
  assert.equal(resolveExt('media.htm', 'video/mp4', false), 'mp4', 'video vẫn ra mp4');
  assert.equal(resolveExt('media.html?x=1', '', false), 'png', 'không rõ mime → mặc định ảnh');
});

test('boundary: đuôi lạ và tên rỗng vẫn ra đuôi dùng được', () => {
  for (const n of ['', null, undefined, 'file.bin', 'a.exe']) {
    assert.ok(MEDIA.includes(resolveExt(n, 'image/png', false)), String(n));
  }
});

test('regression: CẢ HAI nhánh đổi tên đều dùng chung một bộ kiểm', () => {
  assert.match(bg, /function _resolveMediaExt\(/, 'có hàm chốt đuôi dùng chung');
  assert.match(bg, /function _hasMediaExt\(/, 'có hàm kiểm "đã có đuôi media"');
  // Nhánh sớm ("own extension") trước đây lấy split('.').pop() thô — không được còn nữa.
  assert.ok(!/const origExt = downloadItem\.filename\?\.split\('\.'\)\.pop\(\) \|\| 'png';/.test(bg),
    'nhánh sớm không còn lấy đuôi thô');
  assert.equal((bg.match(/_resolveMediaExt\(downloadItem\.filename/g) || []).length, 1,
    'nhánh sớm gọi hàm chung');
  assert.equal((bg.match(/_hasMediaExt\(rename\.filename\)/g) || []).length, 2,
    'cả hai nhánh dùng chung phép kiểm đuôi');
});

// isVideoDownload khai bằng const ở phía DƯỚI nhánh sớm → chạm vào là ReferenceError.
// node --check không bắt lỗi vùng chết tạm thời, nên phải khoá bằng test.
test('regression: nhánh sớm KHÔNG chạm biến khai sau nó', () => {
  const i = bg.indexOf('Download rename (own extension)');
  assert.ok(i > 0, 'tìm được nhánh sớm');
  const decl = bg.indexOf('const isVideoDownload =');
  assert.ok(decl > i, 'isVideoDownload thật sự khai SAU nhánh sớm');
  // Bỏ chú thích trước khi soát — đoạn giải thích có nhắc tên biến, đó không phải lời gọi.
  const early = bg.slice(bg.lastIndexOf('const rename =', i), i)
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/[^_]isVideoDownload/.test(early), 'nhánh sớm không dùng isVideoDownload');
  assert.match(early, /_earlyIsVideo/, 'nó tự tính lấy');
});

test('regression: zoomGuard có đủ ba mảnh — ghi, khôi phục, bỏ canh', () => {
  assert.match(bg, /function _zoomGuardArm\(/, 'ghi mức gốc');
  assert.match(bg, /function _zoomGuardTake\(/, 'lấy ra và xoá');
  assert.match(bg, /'zoomGuard:recover'/, 'có handler khôi phục');
  assert.match(bg, /'zoomGuard:disarm'/, 'có handler bỏ canh');
  assert.match(bg, /chrome\.tabs\.onRemoved\.addListener/, 'tab đóng thì dọn bản ghi');
  assert.match(ct, /_zoomGuardRecoverOnLoad/, 'content hỏi khôi phục lúc nạp');
  assert.ok((ct.match(/_zoomGuardDisarm\(\)/g) || []).length >= 2,
    'bỏ canh ở CẢ hai đường trả zoom (một lượt và cả session)');
});

test('boundary: ghi mức gốc chỉ MỘT lần, không bị mức đã zoom đè lên', () => {
  const i = bg.indexOf('async function _zoomGuardArm');
  const body = bg.slice(i, i + 600);
  assert.match(body, /if \(map\[tabId\] != null\) return;/,
    'đã có bản ghi thì giữ nguyên — nếu không, lần zoom thứ hai sẽ ghi đè mức gốc bằng mức đang thu nhỏ');
});
