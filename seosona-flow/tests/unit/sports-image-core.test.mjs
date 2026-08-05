// Lát 1 của bản đặc tả Sports Image Workflow — hai lõi KHÔNG cần engine ngoài.
//
// SourceLock (chương 8.1): "ảnh nguồn là authority" — chốt bằng BĂM chứ không bằng lời dặn
// trong prompt. CompareDiff (chương 10): đo pixel trôi, tách hẳn khỏi phán xét thể thao.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const scope = {};
for (const f of ['src/sports-image/SourceLock.js', 'src/sports-image/CompareDiff.js']) {
  new Function('self', 'window', readFileSync(join(root, f), 'utf8'))(scope, scope);
}
const SL = scope.SEOSONA_SourceLock;
const CD = scope.SEOSONA_CompareDiff;

// ImageData giả — Node không có canvas, mà hai module này cố ý không phụ thuộc DOM.
function img(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = typeof fill === 'function' ? fill(i % w, Math.floor(i / w)) : fill;
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

// ── SourceLock ──────────────────────────────────────────────────────────────────────────
test('SourceLock: cùng pixel → cùng băm; khác một pixel → khác băm', () => {
  const a = img(8, 8, [10, 20, 30]);
  const b = img(8, 8, [10, 20, 30]);
  assert.equal(SL.hashImage(a), SL.hashImage(b), 'tất định');
  b.data[4 * 20] = 11;
  assert.notEqual(SL.hashImage(a), SL.hashImage(b), 'đổi 1 pixel phải đổi băm');
});

// Chỉ băm pixel thôi thì hai ảnh 8x2 và 2x8 cùng nội dung sẽ trùng băm — sai.
test('SourceLock: kích thước nằm TRONG băm', () => {
  const a = img(8, 2, [1, 2, 3]);
  const b = img(2, 8, [1, 2, 3]);
  assert.equal(SL.hashPixels(a), SL.hashPixels(b), 'pixel giống nhau thật');
  assert.notEqual(SL.hashImage(a), SL.hashImage(b), 'nhưng băm ảnh phải khác vì kích thước khác');
});

test('SourceLock: lock giữ chính sách mặc định, chỉ nhận khoá đã biết', () => {
  const rec = SL.lock(img(4, 4, [0, 0, 0]), { preserveOutsideMask: false, khoaLa: 123 }, { at: 1 });
  assert.equal(rec.policy.preserveOutsideMask, false, 'ghi đè khoá hợp lệ');
  assert.equal(rec.policy.lockIdentity, true, 'khoá không ghi đè giữ mặc định');
  assert.ok(!('khoaLa' in rec.policy), 'khoá lạ bị bỏ, không lọt vào chính sách');
  assert.equal(rec.at, 1, 'thời điểm do caller đưa — module không đọc đồng hồ');
  assert.equal(rec.width, 4);
});

test('SourceLock: verify bắt được nguồn bị đổi giữa chừng', () => {
  const src = img(6, 6, [50, 60, 70]);
  const rec = SL.lock(src);
  assert.deepEqual(SL.verify(rec, src), { ok: true, reason: null });

  const tampered = img(6, 6, [50, 60, 70]);
  tampered.data[0] = 99;
  const v = SL.verify(rec, tampered);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'SOURCE_CHANGED');
});

test('SourceLock: biên nhận ghi đủ phạm vi sửa để phát lại được', () => {
  const src = img(4, 4, [1, 1, 1]);
  const rec = SL.lock(src);
  const r = SL.receipt(rec, {
    name: 'localized_inpaint', engine: 'x', maskDilation: 3, feather: 8,
    cropRect: { x: 1, y: 1, w: 2, h: 2 }, result: img(4, 4, [2, 2, 2]), at: 7,
  });
  assert.equal(r.sourceHash, rec.sourceHash, 'nối được về bản đã chốt');
  assert.equal(r.scope.maskDilation, 3);
  assert.equal(r.scope.feather, 8);
  assert.deepEqual(r.scope.cropRect, { x: 1, y: 1, w: 2, h: 2 });
  assert.ok(r.resultHash && r.resultHash !== rec.sourceHash, 'kết quả có băm riêng');
});

test('SourceLock: ảnh hỏng thì ném rõ ràng, không trả băm rác', () => {
  assert.throws(() => SL.lock(null), /ảnh không hợp lệ/);
  assert.equal(SL.hashImage({}), null);
});

// ── CompareDiff ─────────────────────────────────────────────────────────────────────────
test('CompareDiff: ảnh y hệt → không trôi', () => {
  const a = img(10, 10, [100, 100, 100]);
  const r = CD.changedRatio(a, img(10, 10, [100, 100, 100]));
  assert.equal(r.changed, 0);
  assert.equal(r.ratio, 0);
});

// Không có ngưỡng nhiễu thì một lần nén lại cũng ra "100% đổi" — phép đo thành vô dụng.
test('CompareDiff: lệch nhỏ do nén KHÔNG bị tính là thay đổi', () => {
  const a = img(10, 10, [100, 100, 100]);
  const b = img(10, 10, [103, 98, 101]);
  assert.equal(CD.changedRatio(a, b).changed, 0, 'trong ngưỡng mặc định thì bỏ qua');
  assert.ok(CD.changedRatio(a, b, { tolerance: 0 }).changed > 0, 'ngưỡng 0 thì đếm hết');
});

test('CompareDiff: mask integrity bắt được rò rỉ ra ngoài vùng', () => {
  const w = 8, h = 8;
  const before = img(w, h, [50, 50, 50]);
  const after = img(w, h, [50, 50, 50]);
  const mask = new Uint8Array(w * h);
  for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) mask[y * w + x] = 255;

  // sửa TRONG mask → hợp lệ
  for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) {
    const o = (y * w + x) * 4; after.data[o] = 200; after.data[o + 1] = 200; after.data[o + 2] = 200;
  }
  let mi = CD.maskIntegrity(before, after, mask);
  assert.equal(mi.leakedPixels, 0);
  assert.equal(mi.accounted, true);
  assert.equal(mi.noOpInsideMask, false);

  // rò ra NGOÀI mask → phải bắt được, dù chỉ một pixel
  const o = (0 * w + 0) * 4;
  after.data[o] = 250;
  mi = CD.maskIntegrity(before, after, mask);
  assert.equal(mi.leakedPixels, 1, 'một pixel rò cũng phải đếm ra');
  assert.equal(mi.accounted, false);
});

test('CompareDiff: sửa mà KHÔNG đổi gì trong mask cũng là bất thường', () => {
  const w = 6, h = 6;
  const before = img(w, h, [10, 10, 10]);
  const after = img(w, h, [10, 10, 10]);
  const mask = new Uint8Array(w * h); mask[0] = 255; mask[1] = 255;
  const mi = CD.maskIntegrity(before, after, mask);
  assert.equal(mi.noOpInsideMask, true, 'mô hình đã bỏ qua yêu cầu — phải nói ra');
});

test('CompareDiff: evaluate ra đúng hình dạng hợp đồng chương 10', () => {
  const w = 8, h = 8;
  const before = img(w, h, [40, 40, 40]);
  const after = img(w, h, [40, 40, 40]);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < 12; i++) mask[i] = 255;
  for (let i = 0; i < 12; i++) { const o = i * 4; after.data[o] = 220; after.data[o + 1] = 220; after.data[o + 2] = 220; }

  const res = CD.evaluate(before, after, { mask });
  assert.equal(res.schema, 'seosona.sports.compareDiff.v1');
  assert.equal(res.gate, 'PASS');
  const ids = res.checks.map((c) => c.id);
  for (const need of ['resolution', 'mask_integrity', 'edit_applied', 'outside_mask_drift']) {
    assert.ok(ids.includes(need), `thiếu phép kiểm ${need}`);
  }
});

test('CompareDiff: khác kích thước là FAIL ngay, không cố so', () => {
  const res = CD.evaluate(img(4, 4, [0, 0, 0]), img(5, 5, [0, 0, 0]));
  assert.equal(res.gate, 'FAIL');
  assert.equal(res.checks[0].id, 'resolution');
});

test('CompareDiff: rò ra ngoài mask → gate FAIL, không phải WARN', () => {
  const w = 8, h = 8;
  const before = img(w, h, [40, 40, 40]);
  const after = img(w, h, [40, 40, 40]);
  const mask = new Uint8Array(w * h); mask[0] = 255;
  const o = (7 * w + 7) * 4;
  after.data[o] = 250; after.data[o + 1] = 250; after.data[o + 2] = 250;
  const res = CD.evaluate(before, after, { mask });
  assert.equal(res.gate, 'FAIL', 'sửa lén ngoài vùng là hỏng, không phải cảnh báo');
});
