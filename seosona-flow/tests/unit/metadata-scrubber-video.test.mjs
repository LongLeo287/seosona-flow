// Video là chỗ dễ hỏng file nhất: bảng `stco` của MP4 giữ vị trí TUYỆT ĐỐI, `Cues` của
// WebM cũng vậy. Cắt bớt byte phía trước là mọi con số đó lệch → video không tua được.
// Nên cách làm ở đây là GHI ĐÈ TẠI CHỖ, và test phải khoá đúng điều đó: độ dài không đổi,
// cấu trúc còn duyệt được, dữ liệu hình/tiếng còn nguyên từng byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const root = {};
new Function('window', readFileSync(join(PKG, 'src/core/MetadataScrubber.js'), 'utf8'))(root);
const MS = root.MetadataScrubber;

const str = (s) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

// ── MP4 giả, đúng cấu trúc box ───────────────────────────────────────────────
function box(type, payload = []) { return [...u32(payload.length + 8), ...str(type), ...payload]; }

function makeMp4({ udta = true, meta = true, uuid = true } = {}) {
  const p = [];
  p.push(...box('ftyp', str('isom')));
  const moovKids = [];
  moovKids.push(...box('mvhd', new Array(20).fill(1)));
  const trakKids = [...box('tkhd', new Array(12).fill(2))];
  if (udta) trakKids.push(...box('udta', str('©xyz+10.7769+106.7009/')));   // toạ độ GPS thật
  moovKids.push(...box('trak', trakKids));
  if (udta) moovKids.push(...box('udta', str('©mak Apple©mod iPhone 15 Pro')));
  if (meta) moovKids.push(...box('meta', str('\0\0\0\0ilst-author: Nguyen Van A')));
  p.push(...box('moov', moovKids));
  if (uuid) p.push(...box('uuid', [...new Array(16).fill(9), ...str('<x:xmpmeta>prompt</x:xmpmeta>')]));
  p.push(...box('mdat', [0xDE, 0xAD, 0xBE, 0xEF, 0x11, 0x22, 0x33, 0x44]));  // "hình/tiếng"
  return new Uint8Array(p);
}

/** Duyệt lại box từ đầu — nếu tổng độ dài không khớp file thì cấu trúc đã hỏng. */
function mp4TopLevel(b) {
  const out = []; let i = 0;
  while (i + 8 <= b.length) {
    const size = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (size < 8 || i + size > b.length) throw new Error(`box hỏng tại ${i}: ${type} size=${size}`);
    out.push({ boxType: type, size, at: i }); i += size;
  }
  assert.equal(i, b.length, 'tổng box không phủ hết file — cấu trúc hỏng');
  return out;
}

test('MP4: nhận dạng theo NỘI DUNG (ftyp), không theo đuôi file', () => {
  assert.equal(MS.detectFormat(makeMp4()), 'mp4');
});

test('MP4: xoá udta/meta/uuid — GPS và tên máy không còn trong file', () => {
  const src = makeMp4();
  assert.ok(Buffer.from(src).includes('+10.7769'), 'file mẫu phải CÓ toạ độ để test có nghĩa');
  const r = MS.scrub(src);
  assert.equal(r.ok, true);
  const buf = Buffer.from(r.bytes);
  assert.ok(!buf.includes('+10.7769'), 'toạ độ GPS vẫn còn');
  assert.ok(!buf.includes('iPhone 15 Pro'), 'tên máy vẫn còn');
  assert.ok(!buf.includes('Nguyen Van A'), 'tên tác giả vẫn còn');
  assert.ok(!buf.includes('xmpmeta'), 'XMP vẫn còn');
});

test('MP4: ĐỘ DÀI KHÔNG ĐỔI — đây là điều giữ cho bảng offset còn đúng', () => {
  const src = makeMp4();
  const r = MS.scrub(src);
  assert.equal(r.bytes.length, src.length);
  assert.equal(r.report.saved, 0);
  assert.ok(r.report.removed.every((x) => x.voided), 'phải đánh dấu là ghi đè, không phải cắt');
});

test('MP4: dữ liệu mdat còn nguyên từng byte', () => {
  const r = MS.scrub(makeMp4());
  const s = [...r.bytes].join(',');
  assert.ok(s.includes('222,173,190,239,17,34,51,68'), 'luồng hình/tiếng bị đụng vào');
});

test('MP4: cấu trúc vẫn duyệt được, box bị xoá thành `free`', () => {
  const r = MS.scrub(makeMp4());
  const top = mp4TopLevel(r.bytes);
  const types = top.map((x) => x.boxType);
  assert.ok(types.includes('ftyp') && types.includes('moov') && types.includes('mdat'));
  assert.ok(!types.includes('uuid'), 'uuid phải đã thành free');
  assert.ok(types.includes('free'));
  // moov giữ nguyên kích thước → con cháu bên trong không dịch đi đâu cả.
  assert.equal(top.find((x) => x.boxType === 'moov').size, mp4TopLevel(makeMp4()).find((x) => x.boxType === 'moov').size);
});

test('MP4: udta lồng trong trak cũng bị xoá (đệ quy, không chỉ tầng đầu)', () => {
  const r = MS.scrub(makeMp4());
  assert.ok(!Buffer.from(r.bytes).includes('106.7009'), 'udta trong trak bị bỏ sót');
});

test('MP4 sạch sẵn → không đổi byte nào', () => {
  const clean = makeMp4({ udta: false, meta: false, uuid: false });
  const r = MS.scrub(clean);
  assert.equal(r.report.removed.length, 0);
  assert.deepEqual([...r.bytes], [...clean]);
});

// ── WebM giả, đúng cấu trúc EBML ─────────────────────────────────────────────
function vintSize(n) {                       // size descriptor 1 byte (đủ cho test)
  assert.ok(n <= 126, 'test dùng payload nhỏ');
  return [0x80 | n];
}
function el(idBytes, payload) { return [...idBytes, ...vintSize(payload.length), ...payload]; }

function makeWebm({ tags = true, date = true, app = true } = {}) {
  const p = [0x1A, 0x45, 0xDF, 0xA3, 0x84, 1, 2, 3, 4];        // EBML header
  const infoKids = [];
  if (date) infoKids.push(...el([0x44, 0x61], [0, 0, 0, 0, 0, 0, 0, 7]));       // DateUTC
  if (app) infoKids.push(...el([0x4D, 0x80], str('Lavf60.16.100')));            // MuxingApp
  if (app) infoKids.push(...el([0x57, 0x41], str('MyPhone Camera v3')));        // WritingApp
  const segKids = [...el([0x15, 0x49, 0xA9, 0x66], infoKids)];
  if (tags) segKids.push(...el([0x12, 0x54, 0xC3, 0x67], str('author=Nguyen Van A;prompt=a cat')));
  segKids.push(...el([0x1F, 0x43, 0xB6, 0x75], [0xCA, 0xFE, 0xBA, 0xBE]));      // Cluster
  return new Uint8Array([...p, ...el([0x18, 0x53, 0x80, 0x67], segKids)]);
}

test('WebM: nhận dạng theo chữ ký EBML', () => {
  assert.equal(MS.detectFormat(makeWebm()), 'webm');
});

test('WebM: xoá Tags, giữ Cluster — nội dung video không đụng tới', () => {
  const src = makeWebm();
  assert.ok(Buffer.from(src).includes('Nguyen Van A'));
  const r = MS.scrub(src);
  const buf = Buffer.from(r.bytes);
  assert.ok(!buf.includes('Nguyen Van A'), 'tên trong Tags vẫn còn');
  assert.ok(!buf.includes('prompt=a cat'), 'prompt trong Tags vẫn còn');
  assert.ok([...r.bytes].join(',').includes('202,254,186,190'), 'Cluster bị đụng vào');
});

test('WebM: element bị xoá trở thành Void (0xEC) đúng BẰNG độ dài cũ', () => {
  const src = makeWebm();
  const r = MS.scrub(src);
  assert.equal(r.bytes.length, src.length, 'độ dài đổi là Cues lệch hết');
  // Tags cũ bắt đầu ở đâu thì giờ ở đó phải là 0xEC.
  const tagStart = [...src].findIndex((_, i) =>
    src[i] === 0x12 && src[i + 1] === 0x54 && src[i + 2] === 0xC3 && src[i + 3] === 0x67);
  assert.ok(tagStart > 0);
  assert.equal(r.bytes[tagStart], 0xEC, 'chỗ Tags cũ phải là Void');
  // size của Void phải khai đúng phần còn lại, nếu không trình phát đọc lệch.
  const declared = r.bytes[tagStart + 1] & 0x7F;
  const oldTotal = 4 + 1 + (src[tagStart + 4] & 0x7F);
  assert.equal(declared, oldTotal - 2, 'Void khai sai độ dài → hỏng luồng đọc');
});

test('WebM: MuxingApp/WritingApp là element BẮT BUỘC — xoá ruột chứ không void', () => {
  // Void hai cái này là file sai chuẩn. Ghi đè bằng dấu cách thì tên phần mềm/máy mất
  // mà cấu trúc vẫn hợp lệ.
  const r = MS.scrub(makeWebm());
  const buf = Buffer.from(r.bytes);
  assert.ok(!buf.includes('MyPhone Camera'), 'tên máy quay vẫn còn');
  assert.ok(!buf.includes('Lavf60'), 'tên phần mềm mux vẫn còn');
  const at = [...r.bytes].findIndex((_, i) => r.bytes[i] === 0x4D && r.bytes[i + 1] === 0x80);
  assert.notEqual(at, -1, 'MuxingApp phải CÒN (bắt buộc theo chuẩn), chỉ ruột bị xoá');
  // ID 2 byte + size 1 byte → ruột bắt đầu ở at+3.
  assert.equal(r.bytes[at + 2] & 0x80, 0x80, 'byte size phải còn nguyên');
  assert.equal(r.bytes[at + 3], 0x20, 'ruột phải là dấu cách');
});

test('WebM sạch sẵn → không đổi byte nào', () => {
  const clean = makeWebm({ tags: false, date: false, app: false });
  const r = MS.scrub(clean);
  assert.equal(r.report.removed.length, 0);
  assert.deepEqual([...r.bytes], [...clean]);
});

// ── Chung ────────────────────────────────────────────────────────────────────

test('video: báo cáo NÊU RÕ cách làm và giới hạn còn lại', () => {
  const r = MS.scrub(makeMp4());
  assert.match(r.report.note, /ghi đè|độ dài/i);
  const limits = r.report.cannotRemove.join(' ');
  assert.match(limits, /PIXEL|SynthID/i, 'phải nói watermark trong pixel không xoá được');
  assert.match(limits, /encode lại/i, 'phải nói dữ liệu trong luồng nén cần encode lại');
});

test('scrub KHÔNG sửa mảng của người gọi (video đi đường ghi-đè, dễ quên copy)', () => {
  const src = makeMp4();
  const before = [...src];
  MS.scrub(src);
  assert.deepEqual([...src], before, 'đã ghi đè lên chính mảng đầu vào');
});

test('file cụt / box khai láo → không ném, không treo', () => {
  const cut = new Uint8Array([...u32(999), ...str('ftyp'), 1, 2]);          // khai 999 nhưng chỉ có 10
  assert.doesNotThrow(() => MS.scrub(cut));
  const webmCut = new Uint8Array([0x1A, 0x45, 0xDF, 0xA3, 0xFF, 1, 2, 3, 4, 5, 6, 7]);
  assert.doesNotThrow(() => MS.scrub(webmCut));
});
