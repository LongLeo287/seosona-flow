// Dọn metadata RIÊNG TƯ khỏi ảnh — cắt segment ở tầng container, KHÔNG nén lại pixel.
// Đi qua canvas là ảnh xuống chất lượng, mà mục đích chỉ là bỏ vài khối byte mô tả.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const root = {};
new Function('window', read('src/core/MetadataScrubber.js'))(root);
const MS = root.MetadataScrubber;

const U8 = (...n) => new Uint8Array(n.flat());
const str = (s) => [...s].map((c) => c.charCodeAt(0));

// ── Dựng file giả tối thiểu nhưng ĐÚNG cấu trúc ──────────────────────────────
function jpegSeg(marker, payload) {
  const len = payload.length + 2;
  return [0xFF, marker, (len >> 8) & 0xFF, len & 0xFF, ...payload];
}
function makeJpeg({ exif = true, xmp = true, comment = true, jfif = true } = {}) {
  const parts = [0xFF, 0xD8];
  if (jfif) parts.push(...jpegSeg(0xE0, [...str('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  if (exif) parts.push(...jpegSeg(0xE1, [...str('Exif\0\0'), ...new Array(40).fill(7)]));
  if (xmp) parts.push(...jpegSeg(0xE1, [...str('http://ns.adobe.com/xap/1.0/\0'), ...str('<x:xmpmeta/>')]));
  if (comment) parts.push(...jpegSeg(0xFE, str('prompt: a cat on a table')));
  parts.push(0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0x3F, 0x00);   // SOS
  parts.push(0xAA, 0xBB, 0xCC, 0xDD, 0xEE);                      // dữ liệu quét
  parts.push(0xFF, 0xD9);
  return new Uint8Array(parts);
}
function pngChunk(type, data = []) {
  const len = data.length;
  return [(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...str(type), ...data, 0, 0, 0, 0];
}
function makePng({ text = true, exif = true } = {}) {
  const p = [0x89, ...str('PNG'), 0x0D, 0x0A, 0x1A, 0x0A];
  p.push(...pngChunk('IHDR', new Array(13).fill(1)));
  if (text) p.push(...pngChunk('tEXt', str('parameters\0a cat, 35mm')));
  if (exif) p.push(...pngChunk('eXIf', new Array(20).fill(3)));
  p.push(...pngChunk('IDAT', [9, 9, 9, 9, 9, 9]));
  p.push(...pngChunk('IEND'));
  return new Uint8Array(p);
}
function webpChunk(type, data = []) {
  const len = data.length;
  const pad = len % 2 ? [0] : [];
  return [...str(type), len & 255, (len >>> 8) & 255, (len >>> 16) & 255, (len >>> 24) & 255, ...data, ...pad];
}
function makeWebp({ exif = true, xmp = true } = {}) {
  const body = [];
  body.push(...webpChunk('VP8 ', new Array(10).fill(5)));
  if (exif) body.push(...webpChunk('EXIF', new Array(16).fill(2)));
  if (xmp) body.push(...webpChunk('XMP ', str('<x:xmpmeta/>')));
  const size = 4 + body.length;
  return new Uint8Array([...str('RIFF'), size & 255, (size >>> 8) & 255, (size >>> 16) & 255, (size >>> 24) & 255, ...str('WEBP'), ...body]);
}

// ── Nhận dạng định dạng ──────────────────────────────────────────────────────

test('nhận đúng JPEG / PNG / WebP', () => {
  assert.equal(MS.detectFormat(makeJpeg()), 'jpeg');
  assert.equal(MS.detectFormat(makePng()), 'png');
  assert.equal(MS.detectFormat(makeWebp()), 'webp');
});

test('định dạng lạ → null, và scrub TRẢ NGUYÊN file', () => {
  const weird = U8(str('NOTANIMAGE'), [1, 2, 3, 4]);
  assert.equal(MS.detectFormat(weird), null);
  const r = MS.scrub(weird);
  assert.equal(r.ok, false);
  assert.deepEqual([...r.bytes], [...weird], 'sửa mù container lạ là hỏng file');
  assert.match(r.report.note, /không sửa mù/);
});

// ── JPEG ─────────────────────────────────────────────────────────────────────

test('JPEG: bỏ EXIF + XMP + COMMENT, GIỮ JFIF', () => {
  const r = MS.scrub(makeJpeg());
  assert.equal(r.ok, true);
  const gone = r.report.removed.map((x) => x.kind).sort();
  assert.deepEqual(gone, ['COMMENT', 'EXIF', 'XMP']);
  // JFIF mô tả mật độ điểm ảnh — bỏ đi là ảnh hiển thị sai tỉ lệ ở vài trình xem.
  assert.ok(r.report.kept.some((x) => x.kind === 'JFIF'));
});

test('JPEG: DỮ LIỆU QUÉT giữ nguyên từng byte (đây là toàn bộ mục đích)', () => {
  const src = makeJpeg();
  const r = MS.scrub(src);
  // 5 byte quét + EOI phải còn nguyên ở cuối.
  const tail = [...r.bytes].slice(-7);
  assert.deepEqual(tail, [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0xD9]);
  assert.ok(r.bytes.length < src.length, 'phải nhỏ đi vì đã bỏ metadata');
});

test('JPEG: vẫn là JPEG hợp lệ sau khi dọn (SOI + EOI)', () => {
  const r = MS.scrub(makeJpeg());
  assert.equal(r.bytes[0], 0xFF);
  assert.equal(r.bytes[1], 0xD8);
  assert.equal(MS.detectFormat(r.bytes), 'jpeg');
});

test('JPEG không có metadata → không đổi gì, không hỏng', () => {
  const clean = makeJpeg({ exif: false, xmp: false, comment: false });
  const r = MS.scrub(clean);
  assert.equal(r.report.removed.length, 0);
  assert.deepEqual([...r.bytes], [...clean]);
});

test('JPEG: chọn nhóm — chỉ bỏ prompt thì EXIF vẫn còn', () => {
  const r = MS.scrub(makeJpeg(), { remove: ['prompt'] });
  const gone = r.report.removed.map((x) => x.kind);
  assert.ok(gone.includes('COMMENT'));
  assert.ok(!gone.includes('EXIF'), 'EXIF không thuộc nhóm prompt');
  assert.ok(r.report.kept.some((x) => x.kind === 'EXIF'));
});

test('JPEG: chỉ bỏ GPS thì EXIF bị bỏ (GPS nằm TRONG EXIF)', () => {
  // Điểm dễ hiểu nhầm: GPS không phải segment riêng, nó nằm trong khối EXIF.
  const r = MS.scrub(makeJpeg(), { remove: ['gps'] });
  assert.ok(r.report.removed.some((x) => x.kind === 'EXIF'));
});

// ── PNG ──────────────────────────────────────────────────────────────────────

test('PNG: bỏ tEXt (prompt) + eXIf, GIỮ IHDR/IDAT/IEND', () => {
  const r = MS.scrub(makePng());
  const gone = r.report.removed.map((x) => x.kind).sort();
  assert.deepEqual(gone, ['eXIf', 'tEXt']);
  const keep = r.report.kept.map((x) => x.kind);
  for (const k of ['IHDR', 'IDAT', 'IEND']) assert.ok(keep.includes(k), `mất chunk sống còn ${k}`);
});

test('PNG: vẫn là PNG hợp lệ và IDAT nguyên vẹn', () => {
  const r = MS.scrub(makePng());
  assert.equal(MS.detectFormat(r.bytes), 'png');
  const s = [...r.bytes].join(',');
  assert.ok(s.includes('9,9,9,9,9,9'), 'dữ liệu ảnh phải còn nguyên');
});

// ── WebP ─────────────────────────────────────────────────────────────────────

test('WebP: bỏ EXIF + XMP, GIỮ VP8', () => {
  const r = MS.scrub(makeWebp());
  const gone = r.report.removed.map((x) => x.kind).sort();
  assert.deepEqual(gone, ['EXIF', 'XMP']);
  assert.ok(r.report.kept.some((x) => x.kind === 'VP8'));
});

test('WebP: SỬA LẠI kích thước RIFF ở header — quên là file hỏng', () => {
  const r = MS.scrub(makeWebp());
  const b = r.bytes;
  const riff = b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24);
  assert.equal(riff, b.length - 8, 'header phải khớp độ dài thật sau khi cắt');
  assert.equal(MS.detectFormat(b), 'webp');
});

// ── Báo cáo ──────────────────────────────────────────────────────────────────

test('báo cáo nêu ĐỦ: bỏ gì, giữ gì, tiết kiệm bao nhiêu', () => {
  const r = MS.scrub(makeJpeg());
  assert.ok(r.report.removed.length > 0);
  assert.ok(r.report.kept.length > 0);
  assert.equal(r.report.saved, r.report.bytesBefore - r.report.bytesAfter);
  assert.ok(r.report.saved > 0);
});

test('báo cáo NÓI THẲNG giới hạn: watermark trong pixel không xoá được', () => {
  // Không nói ra thì người dùng tưởng đã "sạch hoàn toàn" và tin nhầm.
  const r = MS.scrub(makeJpeg());
  assert.match(r.report.cannotRemove.join(' '), /SynthID|PIXEL/i);
});

test('mỗi nhóm có LÝ DO đọc được, không phải mã kỹ thuật trần', () => {
  for (const [k, v] of Object.entries(MS.CATEGORIES)) {
    assert.ok(v.label && v.label.length > 3, `${k} thiếu nhãn`);
    assert.ok(v.why && v.why.length > 25, `${k} thiếu lý do — người dùng phải tự quyết được`);
  }
});

test('phạm vi: KHÔNG có nhóm nào nhằm gỡ dấu hiệu nội dung-do-AI', () => {
  // Engine này dọn thứ lộ về NGƯỜI DÙNG. Gỡ nhãn AI là việc khác, và với ảnh từ Flow
  // thì bất khả thi vì SynthID nằm trong pixel.
  const keys = Object.keys(MS.CATEGORIES);
  for (const bad of ['c2pa', 'provenance', 'ai', 'aiLabel', 'contentCredentials']) {
    assert.ok(!keys.includes(bad), `nhóm "${bad}" nằm ngoài phạm vi engine này`);
  }
  const src = read('src/core/MetadataScrubber.js');
  assert.match(src, /SynthID vào PIXEL/, 'phải ghi rõ giới hạn ngay trong file');
});

test('inspect: xem có gì mà KHÔNG sửa (để hiện báo cáo trước/sau)', () => {
  const src = makeJpeg();
  const info = MS.inspect(src);
  assert.equal(info.format, 'jpeg');
  assert.ok(info.found.gps && info.found.gps.includes('EXIF'));
  assert.ok(info.found.prompt && info.found.prompt.length > 0);
  assert.equal(src.length, makeJpeg().length, 'inspect không được đụng vào file');
});

test('file cụt / rỗng → không ném, không treo', () => {
  assert.equal(MS.detectFormat(new Uint8Array(0)), null);
  assert.equal(MS.detectFormat(U8([0xFF, 0xD8])), null, 'quá ngắn để chắc chắn');
  const cut = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x40, 1, 2]);  // khai dài hơn thực tế
  const r = MS.scrub(cut);
  assert.ok(r.bytes.length > 0);
});
