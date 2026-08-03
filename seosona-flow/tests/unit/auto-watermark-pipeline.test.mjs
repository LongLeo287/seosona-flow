// Đường ống: Flow tải video → CHẶN → xoá watermark → giao bản sạch.
// Rủi ro lớn nhất KHÔNG phải chất lượng xoá, mà là MẤT FILE: đã huỷ bản gốc rồi mà bản
// sạch không giao được thì người dùng trắng tay. Test này khoá thứ tự và các đường lùi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');

const bg = read('background.js');
const content = read('content_scripts/content.js');
const inject = read('content_scripts/watermark-inject.js');
const remover = read('src/core/WatermarkRemover.js');

// ── Thứ tự: NHỜ trước, HUỶ sau ───────────────────────────────────────────────

test('KHÔNG huỷ bản gốc trước khi tab xác nhận đã cầm bytes', () => {
  const blk = bg.slice(bg.indexOf('if (isVideoDownload && !rename.wmDone'), bg.indexOf('function _shouldAutoRemoveWm'));
  const iSend = blk.indexOf('chrome.tabs.sendMessage');
  const iCancel = blk.indexOf('chrome.downloads.cancel');
  assert.ok(iSend > -1 && iCancel > -1, 'thiếu bước gửi hoặc huỷ');
  assert.ok(iSend < iCancel, 'huỷ trước khi nhờ = mất file khi tab hỏng');
  // Huỷ phải nằm TRONG nhánh đã kiểm tra resp.ok, không phải chạy vô điều kiện.
  const afterOkGuard = blk.indexOf('resp?.ok');
  assert.ok(afterOkGuard > -1 && afterOkGuard < iCancel, 'huỷ mà không kiểm tra tab đã sẵn sàng');
});

test('tab câm / từ chối / quá hạn → bản gốc vẫn đi qua', () => {
  const blk = bg.slice(bg.indexOf('if (isVideoDownload && !rename.wmDone'), bg.indexOf('function _shouldAutoRemoveWm'));
  assert.match(blk, /setTimeout\(\(\) => passThrough\('TAB_KHÔNG_TRẢ_LỜI'\), \d+\)/, 'thiếu hạn chờ → treo download vĩnh viễn');
  assert.match(blk, /chrome\.runtime\.lastError \|\| !resp\?\.ok/, 'không xử lý tab lỗi');
  assert.match(blk, /catch \(e\) \{ clearTimeout\(timer\); passThrough\(/, 'ném lỗi lúc gửi cũng phải cho qua');
  // passThrough phải gọi suggest với tên THẬT, không phải tên tạm.
  assert.match(blk, /passThrough = \(why\) => \{[\s\S]*?suggest\(\{ filename: fullPath/);
});

test('hoãn suggest phải trả về true, nếu không Chrome tự đặt tên rồi tải luôn', () => {
  const blk = bg.slice(bg.indexOf('if (isVideoDownload && !rename.wmDone'), bg.indexOf('function _shouldAutoRemoveWm'));
  assert.match(blk, /return true;/, 'thiếu return true → suggest bất đồng bộ vô hiệu');
});

// ── Chống lặp ────────────────────────────────────────────────────────────────

test('bản ĐÃ xử lý không bị chặn lại — nếu không là lặp vô tận', () => {
  // Bản sạch cũng tải bằng <a download> nên sẽ chạy qua onDeterminingFilename lần nữa.
  assert.match(bg, /wmDone: !!message\.wmDone/, 'entry không mang cờ đã-xử-lý');
  assert.match(bg, /isVideoDownload && !rename\.wmDone/, 'điều kiện chặn không loại bản đã xử lý');
  assert.match(content, /wmDone: true/, 'phía tab không đánh dấu khi giao bản sạch');
});

// ── Phía tab: đã trả lời là PHẢI giao được file ──────────────────────────────

test('chỉ trả lời ok SAU khi đã cầm chắc bytes', () => {
  const fn = content.slice(content.indexOf('async function _wmAutoProcess'), content.indexOf('chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {\n  if (message.action === \'wm:autoProcess\''));
  const iBlob = fn.indexOf('srcBlob = await r.blob()');
  const iOk = fn.indexOf('sendResponse({ ok: true');
  assert.ok(iBlob > -1 && iOk > -1);
  assert.ok(iBlob < iOk, 'báo ok trước khi có bytes = bên kia huỷ bản gốc trong khi ta tay không');
  assert.match(fn, /if \(!srcBlob\.size\) return fail\('EMPTY_BLOB'\)/, 'blob rỗng vẫn báo ok là mất file');
});

test('xoá watermark hỏng → VẪN giao file (bản gốc đã bị huỷ, không được im lặng)', () => {
  const fn = content.slice(content.indexOf('async function _wmAutoProcess'));
  const cat = fn.slice(fn.indexOf('} catch (e) {', fn.indexOf('SEOSONA_removeVideoWatermark(')));
  assert.match(cat, /deliver\(srcBlob/, 'thất bại mà không giao gì = người dùng trắng tay');
  assert.match(cat, /CÒN watermark/, 'phải nói rõ file này chưa xoá được watermark');
});

test('engine chưa nạp → từ chối NGAY, để bản gốc đi qua', () => {
  const fn = content.slice(content.indexOf('async function _wmAutoProcess'));
  const head = fn.slice(0, fn.indexOf('let srcBlob'));
  assert.match(head, /SEOSONA_removeVideoWatermark !== 'function'.*ENGINE_MISSING/s);
});

test('giao file bằng <a download>, không đẩy blob của trang cho service worker', () => {
  // Blob do TRANG tạo mang origin của trang — service worker không phân giải được,
  // chrome.downloads.download sẽ hỏng câm.
  const fn = content.slice(content.indexOf('async function _wmAutoProcess'), content.indexOf('chrome.runtime.onMessage.addListener((message, sender'));
  assert.ok(!/action: 'chromeDownload'/.test(fn), 'blob của trang không đi qua chromeDownload được');
  assert.match(fn, /a\.download = /, 'thiếu đường giao file');
  assert.match(fn, /revokeObjectURL/, 'rò blob URL');
});

// ── Định dạng ra ─────────────────────────────────────────────────────────────

test('ưu tiên MP4, WebM chỉ là đường lùi — TikTok không nhận WebM', () => {
  const fn = remover.slice(remover.indexOf('function pickRecorderMime'), remover.indexOf('root.WatermarkRemover = {'));
  assert.ok(fn.indexOf("'video/mp4;codecs=avc1.42E01E,mp4a.40.2'") < fn.indexOf("'video/webm;codecs=vp9,opus'"), 'thứ tự sai');
  assert.match(fn, /isTypeSupported/, 'phải DÒ NĂNG LỰC, không dò số hiệu phiên bản trình duyệt');
  assert.match(fn, /catch \(_e\) \{ return false; \}/, 'isTypeSupported ném thì coi như không hỗ trợ');
  assert.match(fn, /prefer !== 'webm'/, 'phải cho phép ép WebM');
});

test('đuôi file khớp thứ VỪA GHI, không đoán', () => {
  assert.match(inject, /out\.seosonaExt = fmt\.ext/, 'không mang đuôi thật ra ngoài');
  assert.match(inject, /cleaned\.seosonaExt \|\| 'webm'/, 'nút bấm tay vẫn ghi cứng đuôi');
  assert.match(content, /cleaned\.seosonaExt \|\| 'webm'/, 'đường tự động ghi cứng đuôi');
  // Ghi MP4 mà đặt tên .webm thì trình phát và nền tảng đều hiểu sai file.
  assert.ok(!/'nowatermark_' \+ Date\.now\(\) \+ '\.webm'/.test(inject));
});

test('rơi về WebM thì PHẢI nói ra — người dùng đang chờ MP4', () => {
  assert.match(inject, /seosonaFellBack/, 'không đánh dấu ca rơi về');
  assert.match(inject, /chưa ghi được MP4/, 'rơi về mà im lặng thì người dùng tưởng có MP4');
});

// ── Công tắc ─────────────────────────────────────────────────────────────────

test('công tắc mặc định BẬT, và tắt được thật', () => {
  // `!== false`: thiếu key nghĩa là BẬT — người dùng chọn "mặc định BẬT".
  assert.match(bg, /autoRemoveVideoWatermark !== false/);
  const st = read('scripts/settings-page.js');
  assert.match(st, /els\.autoWmVideo = \$\('#autoWmVideoToggle'\)/);
  assert.match(st, /s\.autoRemoveVideoWatermark !== false/);
  assert.match(st, /autoRemoveVideoWatermark: els\.autoWmVideo \? els\.autoWmVideo\.checked : true/);
  assert.match(read('pages/settings.html'), /id="autoWmVideoToggle"/);
});

test('video tải về mặc định 1080p', () => {
  assert.match(read('pages/sidebar.html'), /<option value="1080p" selected>/);
  for (const [f, re] of [
    ['src/prompts/GenTab.js', /genTabVideoDownloadResolution'\)\?\.value \|\| '1080p'/],
    ['src/core/PromptQueue.js', /videoResEl\?\.value \|\| '1080p'/],
  ]) assert.match(read(f), re, `${f} còn mặc định cũ`);
});

test('engine dùng CHUNG một pipeline, không nhân bản', () => {
  // Nút bấm tay và đường tự động phải cùng một hàm: sửa một chỗ là sửa cả hai.
  assert.match(inject, /window\.SEOSONA_removeVideoWatermark = removeVideoWatermark/);
  assert.match(content, /window\.SEOSONA_removeVideoWatermark\(srcBlob/);
  assert.equal((content.match(/new MediaRecorder\(/g) || []).length, 0, 'content.js không được tự dựng pipeline riêng');
});
