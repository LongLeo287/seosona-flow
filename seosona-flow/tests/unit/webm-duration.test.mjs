// MediaRecorder ghi WebM KHÔNG có Duration → Windows Media Player / CapCut / Premiere hiện
// 0:00, không tua được, hoặc từ chối mở. Đây là bộ vá, và test dựng file WebM tổng hợp đúng
// cấu trúc EBML để kiểm — vì viết sai một byte kích thước là hỏng cả file người dùng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const root = {};
new Function('self', readFileSync(join(PKG, 'src/core/WebmDuration.js'), 'utf8'))(root);
const WD = root.WebmDuration;

const str = (s) => [...s].map((c) => c.charCodeAt(0));
const size1 = (n) => [0x80 | n];
const el = (id, payload) => [...id, ...size1(payload.length), ...payload];

/** WebM tối thiểu nhưng ĐÚNG cấu trúc: EBML header + Segment{ Info{...}, Cluster }. */
function makeWebm({ duration = false, scale = null, cues = false } = {}) {
  const infoKids = [];
  if (scale) infoKids.push(...el([0x2A, 0xD7, 0xB1], scale));
  infoKids.push(...el([0x4D, 0x80], str('SEOSONA')));                 // MuxingApp
  if (duration) infoKids.push(...el([0x44, 0x89], new Array(8).fill(0)));
  const segKids = [...el([0x15, 0x49, 0xA9, 0x66], infoKids)];
  if (cues) segKids.push(...el([0x1C, 0x53, 0xBB, 0x6B], [1, 2, 3]));
  segKids.push(...el([0x1F, 0x43, 0xB6, 0x75], [0xCA, 0xFE, 0xBA, 0xBE]));  // Cluster
  return new Uint8Array([
    0x1A, 0x45, 0xDF, 0xA3, 0x84, 1, 2, 3, 4,                          // EBML header
    ...el([0x18, 0x53, 0x80, 0x67], segKids),
    ...new Array(40).fill(7),                                          // đệm cho đủ dài
  ]);
}

/** Đọc lại Duration từ file đã vá — kiểm bằng cách PHÂN TÍCH LẠI, không tin vào biến trung gian. */
function readDuration(b) {
  for (let i = 0; i + 11 <= b.length; i++) {
    if (b[i] === 0x44 && b[i + 1] === 0x89 && b[i + 2] === 0x88) {
      return new DataView(b.buffer, b.byteOffset + i + 3, 8).getFloat64(0, false);
    }
  }
  return null;
}

test('chèn Duration khi file chưa có', () => {
  const src = makeWebm();
  assert.equal(readDuration(src), null, 'file mẫu phải CHƯA có Duration để test có nghĩa');
  const r = WD.patch(src, 3700);
  assert.equal(r.patched, true, r.why);
  assert.equal(readDuration(r.bytes), 3700, 'TimecodeScale mặc định 1e6 → tick = ms');
});

test('kích thước Info được viết lại đúng — sai một byte là hỏng cả file', () => {
  const r = WD.patch(makeWebm(), 5000);
  const b = r.bytes;
  // Tìm ID Info (4 byte) rồi đọc vint kích thước ngay sau.
  let i = 0;
  while (i < b.length && !(b[i] === 0x15 && b[i + 1] === 0x49 && b[i + 2] === 0xA9 && b[i + 3] === 0x66)) i++;
  assert.ok(i < b.length, 'mất khối Info');
  const first = b[i + 4];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { mask >>= 1; len++; }
  let declared = first & (mask - 1);
  for (let k = 1; k < len; k++) declared = declared * 256 + b[i + 4 + k];
  // Nội dung Info phải nằm trọn trong file và khớp đúng số đã khai.
  const dataAt = i + 4 + len;
  assert.ok(dataAt + declared <= b.length, 'Info khai dài hơn file → trình phát đọc lệch');
  // Duration mới nằm ngay đầu Info.
  assert.equal(b[dataAt], 0x44);
  assert.equal(b[dataAt + 1], 0x89);
});

test('đã có Duration → GHI ĐÈ tại chỗ, độ dài file không đổi', () => {
  // Đường an toàn nhất: không dịch byte nào thì không thể làm lệch gì.
  const src = makeWebm({ duration: true });
  const r = WD.patch(src, 1234);
  assert.equal(r.patched, true, r.why);
  assert.equal(r.bytes.length, src.length, 'ghi đè mà đổi độ dài là đã chèn nhầm');
  assert.equal(readDuration(r.bytes), 1234);
});

test('TimecodeScale khác mặc định → quy đổi tick, không dùng thẳng ms', () => {
  // scale = 500000 ns/tick (0,5ms) → 2000ms = 4000 tick. Dùng thẳng ms là video sai gấp đôi.
  const src = makeWebm({ scale: [0x00, 0x07, 0xA1, 0x20] });   // 500000
  const r = WD.patch(src, 2000);
  assert.equal(r.patched, true, r.why);
  assert.equal(readDuration(r.bytes), 4000);
});

test('có Cues → TRẢ NGUYÊN, không dám dịch byte', () => {
  // Cues giữ vị trí TUYỆT ĐỐI. Chèn byte mà không sửa Cues là phá luôn khả năng tua —
  // tệ hơn tình trạng ban đầu. File MediaRecorder không có Cues nên không mất gì.
  const src = makeWebm({ cues: true });
  const r = WD.patch(src, 3000);
  assert.equal(r.patched, false);
  assert.equal(r.why, 'CÓ_CUES_KHÔNG_DÁM_DỊCH');
  assert.deepEqual([...r.bytes], [...src]);
});

test('đầu vào hỏng / không phải WebM → trả nguyên, không ném', () => {
  for (const [inp, ms, why] of [
    [new Uint8Array(10), 1000, 'FILE_QUÁ_NGẮN'],
    [new Uint8Array(100), 1000, 'KHÔNG_PHẢI_WEBM'],
    [makeWebm(), 0, 'THỜI_LƯỢNG_KHÔNG_HỢP_LỆ'],
    [makeWebm(), NaN, 'THỜI_LƯỢNG_KHÔNG_HỢP_LỆ'],
  ]) {
    const r = WD.patch(inp, ms);
    assert.equal(r.patched, false);
    assert.equal(r.why, why);
    assert.deepEqual([...r.bytes], [...inp], 'không vá được thì phải TRẢ NGUYÊN');
  }
});

test('KHÔNG đụng vào mảng của người gọi', () => {
  const src = makeWebm();
  const before = [...src];
  WD.patch(src, 9000);
  assert.deepEqual([...src], before, 'đã ghi đè lên chính mảng đầu vào');
});

test('mã hoá vint kích thước: chọn độ dài ngắn nhất chứa được', () => {
  assert.deepEqual([...WD._encodeSize(0)], [0x80]);
  assert.deepEqual([...WD._encodeSize(126)], [0xFE]);
  // 127 = all-ones ở 1 byte, nghĩa là "không xác định" → phải nhảy lên 2 byte.
  assert.equal(WD._encodeSize(127).length, 2);
  assert.equal(WD._encodeSize(300).length, 2);
  assert.equal(WD._encodeSize(20000).length, 3);
});

test('dữ liệu ảnh/tiếng còn nguyên sau khi vá', () => {
  const r = WD.patch(makeWebm(), 4200);
  assert.ok([...r.bytes].join(',').includes('202,254,186,190'), 'Cluster bị đụng vào');
});

// ── Nối dây ──────────────────────────────────────────────────────────────────

test('MỌI nơi xuất WebM đều vá Duration — không sót đường nào', () => {
  // Bài học vừa rồi: sửa MP4 ở một file, quên file kia, người dùng nhận file hỏng.
  // Test theo NƠI GỌI để thêm chỗ ghi video mới mà quên là gãy ngay.
  const files = ['scripts/watermark-tool.js', 'content_scripts/watermark-inject.js'];
  for (const f of files) {
    const src = readFileSync(join(PKG, f), 'utf8');
    if (!/new MediaRecorder\(/.test(src)) continue;
    assert.match(src, /WebmDuration\.patchBlob\(/, `${f}: xuất WebM mà không vá Duration`);
    assert.match(src, /fmt\.ext === 'webm'/, `${f}: phải chỉ vá khi thật sự ra WebM`);
    assert.match(src, /v\.duration \* 1000/, `${f}: thiếu thời lượng thật để vá`);
  }
});

test('module được nạp TRƯỚC nơi dùng, ở cả hai ngữ cảnh', () => {
  const m = JSON.parse(readFileSync(join(PKG, 'manifest.json'), 'utf8'));
  for (const cs of m.content_scripts) {
    const js = cs.js || [];
    if (!js.includes('content_scripts/watermark-inject.js')) continue;
    assert.ok(js.includes('src/core/WebmDuration.js'), 'content script thiếu WebmDuration');
    assert.ok(js.indexOf('src/core/WebmDuration.js') < js.indexOf('content_scripts/watermark-inject.js'));
  }
  const html = readFileSync(join(PKG, 'pages/watermark-tool.html'), 'utf8');
  assert.ok(html.indexOf('WebmDuration.js') < html.indexOf('watermark-tool.js'));
});
