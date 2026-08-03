// Bộ nhớ đệm media bắt tại nguồn — lời giải cho link ký HẾT HẠN (~1 giờ).
// Đừng giữ LINK, giữ BYTES: trang đã tải media về để hiển thị, bắt lại đúng lúc đó là
// có bản sao không bao giờ hết hạn. Cái giá là bộ nhớ → phải có trần cứng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const root = {};
new Function('window', read('src/core/MediaCache.js'))(root);
const MC = root.MediaCache;

const MB = 1024 * 1024;

test('lưu và lấy lại được', () => {
  const c = MC.create();
  const r = c.put('a', 'blob:1', 5 * MB, 'video/mp4', 1000);
  assert.equal(r.stored, true);
  assert.deepEqual(r.dropped, []);
  assert.equal(c.get('a', 1000).url, 'blob:1');
  assert.equal(c.bytes(), 5 * MB);
});

test('lấy ra thì ĐÁNH DẤU vừa dùng — đồ đang dùng không bị LRU loại', () => {
  const c = MC.create({ maxItems: 2 });
  c.put('a', 'b1', 1, '', 1000);
  c.put('b', 'b2', 1, '', 2000);
  c.get('a', 3000);                     // 'a' vừa dùng → 'b' mới là cũ nhất
  const r = c.put('c', 'b3', 1, '', 4000);
  assert.deepEqual(r.dropped.map((d) => d.id), ['b']);
  assert.ok(c.has('a'), 'không được loại thứ vừa dùng');
});

test('vượt trần SỐ LƯỢNG → loại cũ nhất và TRẢ VỀ để revoke', () => {
  const c = MC.create({ maxItems: 2 });
  c.put('a', 'b1', 1, '', 1000);
  c.put('b', 'b2', 1, '', 2000);
  const r = c.put('c', 'b3', 1, '', 3000);
  assert.equal(c.size(), 2);
  assert.deepEqual(r.dropped.map((d) => d.url), ['b1'], 'giữ blob mà quên revoke là rò bộ nhớ');
});

test('vượt trần BYTE → loại cho tới khi lọt', () => {
  const c = MC.create({ maxItems: 99, maxBytes: 10 * MB });
  c.put('a', 'b1', 6 * MB, '', 1000);
  c.put('b', 'b2', 3 * MB, '', 2000);
  const r = c.put('c', 'b3', 5 * MB, '', 3000);
  assert.ok(c.bytes() <= 10 * MB, 'tổng byte phải lọt trần');
  assert.ok(r.dropped.length >= 1);
});

test('file to hơn cả trần → TỪ CHỐI, không nhận rồi đẩy hết thứ khác ra', () => {
  const c = MC.create({ maxBytes: 10 * MB });
  c.put('a', 'b1', 5 * MB, '', 1000);
  const r = c.put('big', 'b2', 50 * MB, '', 2000);
  assert.equal(r.stored, false);
  assert.equal(r.reason, 'QUÁ_LỚN');
  assert.ok(c.has('a'), 'đồ cũ phải còn nguyên');
});

test('hết hạn: quá TTL thì coi như không có, và tự trừ byte', () => {
  const c = MC.create({ ttlMs: 1000 });
  c.put('a', 'b1', 5 * MB, '', 0);
  assert.equal(c.get('a', 500)?.url, 'b1');
  assert.equal(c.get('a', 2000), null, 'quá hạn phải trả null');
  assert.equal(c.bytes(), 0, 'byte phải được trừ, không thì trần tính sai mãi');
});

test('loại đồ HẾT HẠN trước rồi mới tới LRU', () => {
  // Cả 'a' và 'b' cùng quá hạn tại thời điểm put('c') → TTL dọn cả hai, LRU không phải
  // ra tay. Nếu làm ngược thứ tự (LRU trước) thì chỉ 1 cái bị bỏ và cái hết hạn còn lại
  // vẫn chiếm chỗ + chiếm byte.
  const c = MC.create({ maxItems: 2, ttlMs: 1000 });
  c.put('a', 'b1', 1, '', 0);
  c.put('b', 'b2', 1, '', 100);
  const r = c.put('c', 'b3', 1, '', 5000);
  assert.deepEqual(r.dropped.map((d) => d.id).sort(), ['a', 'b']);
  assert.equal(c.size(), 1);
  assert.ok(c.has('c'));
});

test('dọn hết hạn xảy ra NGAY ở lần put kế tiếp, không đợi đầy trần', () => {
  const c = MC.create({ maxItems: 99, ttlMs: 1000 });
  c.put('cu', 'b1', 7, '', 0);
  const r = c.put('moi', 'b2', 1, '', 5000);
  assert.deepEqual(r.dropped.map((d) => d.id), ['cu'], 'còn chỗ không có nghĩa là giữ rác');
  assert.equal(c.bytes(), 1);
});

test('ghi đè cùng id → trả bản cũ để revoke, không cộng dồn byte', () => {
  const c = MC.create();
  c.put('a', 'b1', 5 * MB, '', 1000);
  const r = c.put('a', 'b2', 3 * MB, '', 2000);
  assert.deepEqual(r.dropped.map((d) => d.url), ['b1']);
  assert.equal(c.bytes(), 3 * MB, 'byte cũ phải được trừ');
  assert.equal(c.size(), 1);
});

test('thiếu id hoặc url → từ chối, nêu lý do', () => {
  const c = MC.create();
  assert.equal(c.put('', 'b', 1, '', 0).reason, 'THIẾU_ID_HOẶC_URL');
  assert.equal(c.put('a', '', 1, '', 0).reason, 'THIẾU_ID_HOẶC_URL');
});

test('clear trả TOÀN BỘ để revoke', () => {
  const c = MC.create();
  c.put('a', 'b1', 1, '', 0); c.put('b', 'b2', 1, '', 0);
  const all = c.clear();
  assert.equal(all.length, 2);
  assert.equal(c.size(), 0);
  assert.equal(c.bytes(), 0);
});

// ── Quy URL về MỘT id ────────────────────────────────────────────────────────

const UUID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

test('cùng một media qua NHIỀU url khác nhau phải ra CÙNG id', () => {
  // Không quy về một id thì cùng một video bị lưu nhiều lần và tự đá nhau ra khỏi bộ đệm.
  const a = MC.idFromUrl(`https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${UUID}`);
  const b = MC.idFromUrl(`https://storage.googleapis.com/ai-sandbox-videofx/${UUID}.mp4?X-Goog-Signature=abc`);
  assert.equal(a, UUID);
  assert.equal(b, UUID);
});

test('link ký đổi query mỗi lần vẫn ra cùng id', () => {
  const u1 = 'https://storage.googleapis.com/ai-sandbox/clip_77.mp4?X-Goog-Expires=3600&sig=aaa';
  const u2 = 'https://storage.googleapis.com/ai-sandbox/clip_77.mp4?X-Goog-Expires=3600&sig=zzz';
  assert.equal(MC.idFromUrl(u1), MC.idFromUrl(u2));
  assert.equal(MC.idFromUrl(u1), 'clip_77.mp4');
});

test('id không phân biệt hoa thường; url rác → null', () => {
  assert.equal(MC.idFromUrl(`x/${UUID.toUpperCase()}.mp4`), UUID);
  assert.equal(MC.idFromUrl(''), null);
  assert.equal(MC.idFromUrl(null), null);
});

// ── Nhận diện url media ──────────────────────────────────────────────────────

test('nhận đúng media của Flow', () => {
  assert.equal(MC.isMediaUrl('https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=x'), true);
  assert.equal(MC.isMediaUrl('https://storage.googleapis.com/ai-sandbox-videofx/a.mp4'), true);
  assert.equal(MC.isMediaUrl('https://lh3.googleusercontent.com/x/a.png'), true);
});

test('KHÔNG bắt nhầm thứ không phải media (bắt bừa là ngốn bộ nhớ vô cớ)', () => {
  assert.equal(MC.isMediaUrl('https://labs.google/fx/api/trpc/project.createProject'), false);
  assert.equal(MC.isMediaUrl('https://aisandbox-pa.googleapis.com/v1/credits'), false);
  assert.equal(MC.isMediaUrl('https://example.com/photo.png'), false, 'ảnh ngoài Google không liên quan');
  assert.equal(MC.isMediaUrl(''), false);
});

test('trần mặc định đủ dùng nhưng không làm nặng tab', () => {
  assert.ok(MC.DEFAULTS.maxBytes <= 128 * MB, 'giữ quá nhiều là tab Flow ì');
  assert.ok(MC.DEFAULTS.ttlMs > 60 * 60 * 1000, 'TTL phải dài hơn hạn 1 giờ của chữ ký');
});

// ── Nối dây: interceptor MAIN world + sổ tra ISOLATED ────────────────────────

test('mở rộng interceptor CÓ SẴN, không vá fetch lần hai', () => {
  const src = read('content_scripts/slate-bridge.js');
  // Vá fetch hai lần là hai lớp bọc chồng nhau: response bị clone thừa, và gỡ một lớp
  // thì lớp kia hỏng theo.
  assert.equal((src.match(/window\.fetch = function/g) || []).length, 1);
  assert.match(src, /source: 'flow-media-captured'/);
});

test('CHỈ ĐỌC: không sửa request/response/header', () => {
  const src = read('content_scripts/slate-bridge.js');
  // Neo bằng lastIndexOf: '__flowAutoSlateBridgeCleanup' còn xuất hiện ở ĐẦU file
  // (đoạn gỡ bản cũ), nên indexOf sẽ cho lát cắt rỗng và test đậu/rớt vì lý do sai.
  const fn = src.slice(src.indexOf('__flowGenFetchPatched'), src.lastIndexOf('__flowAutoSlateBridgeCleanup'));
  assert.ok(fn.length > 500, 'lát cắt phải trúng thân interceptor');
  assert.match(fn, /resp\.clone\(\)\.blob\(\)/, 'phải clone, không đọc trực tiếp body của trang');
  assert.ok(!/headers\.set|headers\.append|new Request\(/.test(fn), 'không được đụng vào request');
});

test('thiếu MediaCache thì phần báo lỗi CŨ vẫn chạy', () => {
  const src = read('content_scripts/slate-bridge.js');
  assert.match(src, /var _mediaCapEnabled = !!_MC;/,
    'một tính năng mới không được làm hỏng tính năng cũ khi thiếu module');
});

test('mọi mục bị loại đều được revokeObjectURL', () => {
  const src = read('content_scripts/slate-bridge.js');
  assert.match(src, /r\.dropped\.forEach\(function \(d\) \{ try \{ URL\.revokeObjectURL\(d\.url\)/);
  assert.match(src, /if \(!r\.stored\) \{ URL\.revokeObjectURL\(burl\); return; \}/,
    'từ chối lưu mà không revoke là rò ngay tại chỗ');
});

test('rời trang thì trả lại bộ nhớ ngay', () => {
  assert.match(read('content_scripts/slate-bridge.js'), /'pagehide'[\s\S]{0,160}revokeObjectURL/);
});

test('đã bắt rồi thì không bắt lại (khỏi tốn bộ nhớ lần nữa)', () => {
  assert.match(read('content_scripts/slate-bridge.js'), /_mediaCache\.has\(id\)\) return;/);
});

test('phía nhận: kiểm origin + source trước khi tin message', () => {
  const src = read('content_scripts/content.js');
  const fn = src.slice(src.indexOf('_installMediaCaptureListener'));
  assert.match(fn.slice(0, 700), /e\.source !== window \|\| e\.origin !== location\.origin/,
    'postMessage là kênh CÔNG KHAI — trang khác cũng gửi được');
  assert.match(fn.slice(0, 700), /d\.source !== 'flow-media-captured'/);
});

test('sổ tra có trần riêng, không phình vô hạn', () => {
  const src = read('content_scripts/content.js');
  assert.match(src, /_CAPTURED_MAX/);
  assert.match(src, /while \(_capturedMedia\.size > _CAPTURED_MAX\)/);
});

test('MediaCache được nạp ở CẢ hai world', () => {
  const mf = JSON.parse(read('manifest.json'));
  const withMC = mf.content_scripts.filter((c) => (c.js || []).includes('src/core/MediaCache.js'));
  assert.ok(withMC.length >= 2, 'MAIN world để bắt, ISOLATED để tra sổ');
  const main = withMC.find((c) => c.world === 'MAIN');
  assert.ok(main, 'thiếu bản MAIN world thì không vá fetch được');
  // Phải nạp TRƯỚC file dùng nó.
  assert.ok(main.js.indexOf('src/core/MediaCache.js') < main.js.indexOf('content_scripts/slate-bridge.js'));
});
