// Ba lỗi runtime thật người dùng báo (ảnh chụp bảng Lỗi, 2026-08-04):
//   [MetadataScrubber] TẢI_KHÔNG_ĐƯỢC  ·  Unchecked runtime.lastError: No SW  ·  Uncaught (in promise) Error: No SW
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(join(root, f), 'utf8');

// ── Lỗi 1: dọn metadata không chạy được ở đường tải chính ────────────────────────────────
//
// scrubUrl gọi fetch() trong CONTENT SCRIPT. Content script không có host permission — nó mang
// quyền của TRANG. URL media của Flow là cross-origin có chữ ký nên fetch thẳng luôn hỏng →
// 'TẢI_KHÔNG_ĐƯỢC' → trả về URL gốc. Tức tính năng dọn metadata im lặng KHÔNG hoạt động.
test('MetadataScrubber: nhờ service worker tải hộ khi ở content script', () => {
  const src = read('src/core/MetadataScrubber.js');
  assert.match(src, /function _inContentScript\(/, 'phải biết mình đang ở ngữ cảnh nào');
  assert.match(src, /function _fetchViaWorker\(/, 'phải có đường nhờ worker');
  assert.match(src, /action: 'fetchBlob'/, 'dùng đúng action đã có sẵn (đi qua _safeFetch)');

  const i = src.indexOf('async function scrubUrl');
  const body = src.slice(i, i + 1600);
  assert.ok(body.indexOf('_fetchViaWorker') < body.indexOf('await fetch(url)'),
    'phải THỬ worker TRƯỚC, fetch thẳng chỉ là đường lùi');
});

test('MetadataScrubber: đường nhờ worker có hạn giờ và đọc lastError', () => {
  const src = read('src/core/MetadataScrubber.js');
  const i = src.indexOf('function _fetchViaWorker');
  const body = src.slice(i, i + 1200);
  assert.match(body, /setTimeout\(/, 'worker MV3 hay ngủ — không được chờ mãi');
  assert.match(body, /chrome\.runtime\.lastError/,
    'không đọc lastError là Chrome ném "Unchecked runtime.lastError: No SW"');
  assert.match(body, /finish\(null\)/, 'hỏng thì trả null để rơi về fetch thẳng, không ném');
});

// ── Lỗi 2: cảnh báo lặp mỗi lượt tải ─────────────────────────────────────────────────────
test('MetadataScrubber: mỗi lý do chỉ ghi console MỘT lần mỗi phiên', () => {
  const src = read('src/core/MetadataScrubber.js');
  const i = src.indexOf('function _report(');
  const body = src.slice(i, i + 900);
  assert.match(body, /if \(!_warned\[why\] && typeof console/,
    'ghi vô điều kiện thì tải 20 ảnh ra 20 dòng đỏ y hệt, che mất lỗi thật');
  assert.ok(!/\/\/ Kênh dev: luôn ghi/.test(body), 'chú thích cũ đã sửa theo');
});

// ── Lỗi 3: Uncaught (in promise) Error: No SW ────────────────────────────────────────────
//
// sendMessage KHÔNG có callback trả Promise, và Promise đó TỪ CHỐI khi worker ngủ. Hơn 60 chỗ
// gọi kiểu đó bọc trong try/catch — mà try/catch không bắt được từ chối bất đồng bộ.
test('RuntimeMode: bọc sendMessage ở MỘT chỗ, không vá 60 chỗ gọi', () => {
  const src = read('src/core/RuntimeMode.js');
  assert.match(src, /__seosonaWrapped/, 'có cờ chống bọc hai lần');
  const i = src.indexOf('Chặn TẬN GỐC');
  assert.ok(i > 0, 'có khối bọc');
  const body = src.slice(i, i + 1800);
  assert.match(body, /var hasCb = typeof args\[args\.length - 1\] === 'function'/,
    'phải phân biệt dạng callback với dạng Promise');
  assert.match(body, /if \(hasCb \|\| !out \|\| typeof out\.then !== 'function'\) return out;/,
    'dạng callback giữ NGUYÊN, không đụng vào');
  assert.match(body, /throw err;/, 'lỗi THẬT vẫn phải ném — chỉ nuốt nhóm worker-ngủ');
});

test('RuntimeMode: mẫu nhận diện nhiễu bao đúng nhóm lỗi worker ngủ', () => {
  const src = read('src/core/RuntimeMode.js');
  const m = src.match(/var _NRE = (\/[^\n]+\/i);/);
  assert.ok(m, 'tìm được mẫu');
  const re = new RegExp(m[1].slice(1, -2), 'i');
  for (const msg of ['No SW', 'Extension context invalidated', 'Could not establish connection',
    'The message port closed before a response was received',
    'An unknown error occurred when fetching the script']) {
    assert.ok(re.test(msg), `phải nhận ra là nhiễu: ${msg}`);
  }
  for (const real of ['TypeError: x is not a function', 'HTTP 500', 'Quota exceeded']) {
    assert.ok(!re.test(real), `KHÔNG được nuốt lỗi thật: ${real}`);
  }
});

// Hành vi thật của lớp bọc, chạy trên chrome giả.
test('RuntimeMode: dạng Promise nuốt No SW, giữ lỗi thật, callback không đổi', async () => {
  const g = {
    window: {}, document: {}, location: { protocol: 'https:' },
    chrome: { runtime: { id: 'abc', sendMessage: null } },
  };
  g.window.addEventListener = function () {};
  g.self = g;

  let mode = 'nosw';
  g.chrome.runtime.sendMessage = function () {
    const cb = arguments[arguments.length - 1];
    if (typeof cb === 'function') { cb({ viaCallback: true }); return undefined; }
    if (mode === 'nosw') return Promise.reject(new Error('No SW'));
    if (mode === 'real') return Promise.reject(new TypeError('x is not a function'));
    return Promise.resolve({ ok: true });
  };

  new Function('self', 'window', 'chrome', 'location', 'document', read('src/core/RuntimeMode.js'))(
    g, g.window, g.chrome, g.location, g.document);

  assert.equal(g.chrome.runtime.sendMessage.__seosonaWrapped, true, 'đã bọc');

  assert.equal(await g.chrome.runtime.sendMessage({ a: 1 }), undefined, 'No SW → im lặng, trả undefined');

  mode = 'real';
  await assert.rejects(() => g.chrome.runtime.sendMessage({ a: 1 }), /is not a function/,
    'lỗi thật vẫn phải ném ra');

  mode = 'ok';
  assert.deepEqual(await g.chrome.runtime.sendMessage({ a: 1 }), { ok: true }, 'ca bình thường không đổi');

  let got = null;
  g.chrome.runtime.sendMessage({ a: 1 }, function (r) { got = r; });
  assert.deepEqual(got, { viaCallback: true }, 'dạng callback chạy y như cũ');
});

test('RuntimeMode: bọc hai lần không chồng lớp', () => {
  const g = { window: { addEventListener() {} }, document: {}, location: { protocol: 'https:' },
    chrome: { runtime: { id: 'x', sendMessage: function () { return Promise.resolve(1); } } } };
  g.self = g;
  const code = read('src/core/RuntimeMode.js');
  new Function('self', 'window', 'chrome', 'location', 'document', code)(g, g.window, g.chrome, g.location, g.document);
  const first = g.chrome.runtime.sendMessage;
  g.__seosonaNoiseGuard = false;
  new Function('self', 'window', 'chrome', 'location', 'document', code)(g, g.window, g.chrome, g.location, g.document);
  assert.equal(g.chrome.runtime.sendMessage, first, 'lần hai phải nhận ra đã bọc rồi');
});
