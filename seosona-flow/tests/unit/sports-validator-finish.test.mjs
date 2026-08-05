// Lát 1, phần hai — SportsValidator (chương 10) và PhotoFinish (chương 9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const scope = {};
for (const f of ['src/sports-image/CompareDiff.js', 'src/sports-image/SportsValidator.js',
  'src/sports-image/PhotoFinish.js']) {
  new Function('self', 'window', readFileSync(join(root, f), 'utf8'))(scope, scope);
}
const SV = scope.SEOSONA_SportsValidator;
const PF = scope.SEOSONA_PhotoFinish;
const CD = scope.SEOSONA_CompareDiff;

function img(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = fill;
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

// Bộ quan sát đầy đủ, mọi luật đều đạt.
const GOOD = {
  identityDistance: 0.03, outsideDriftRatio: 0.004, leakedPixels: 0,
  racketCount: 1, shuttleCount: 1, gripValid: true, stringBedIntact: true,
  overlayCount: 0, width: 4320, height: 7680, mechanicsPass: true,
};

test('positive: đủ quan sát và mọi luật đạt → PASS', () => {
  const r = SV.validate('badminton.v1', GOOD);
  assert.equal(r.gate, 'PASS');
  assert.equal(r.summary.fail, 0);
  assert.equal(r.summary.skip, 0, 'không được có luật nào bị bỏ qua');
  assert.equal(r.schema, 'seosona.sports.validator.v1');
});

// Đây là điểm quan trọng nhất của module: THIẾU quan sát KHÔNG được trông giống ĐÃ ĐẠT.
test('negative: thiếu quan sát → SKIP và cổng WARN, KHÔNG phải PASS', () => {
  const partial = { ...GOOD };
  delete partial.gripValid;
  delete partial.mechanicsPass;
  const r = SV.validate('badminton.v1', partial);
  assert.equal(r.summary.skip, 2);
  assert.equal(r.gate, 'WARN', 'chưa kiểm thì không được báo xanh');
  const skipped = r.checks.filter((c) => c.status === 'SKIP').map((c) => c.id);
  assert.deepEqual(skipped.sort(), ['mechanics', 'racket_grip']);
  assert.match(r.checks.find((c) => c.id === 'racket_grip').detail, /thiếu quan sát/);
});

test('negative: hỏng luật CRITICAL → FAIL', () => {
  const r = SV.validate('badminton.v1', { ...GOOD, racketCount: 2 });
  assert.equal(r.gate, 'FAIL');
  const c = r.checks.find((x) => x.id === 'single_racket');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /vẽ thừa/);
});

test('negative: chỉ hỏng luật MAJOR → WARN, không FAIL', () => {
  const r = SV.validate('badminton.v1', { ...GOOD, gripValid: false });
  assert.equal(r.gate, 'WARN');
  assert.equal(r.checks.find((x) => x.id === 'racket_grip').status, 'FAIL');
});

test('boundary: ngưỡng nhận dạng đúng ở mép 0.08', () => {
  assert.equal(SV.validate('badminton.v1', { ...GOOD, identityDistance: 0.08 }).gate, 'PASS');
  assert.equal(SV.validate('badminton.v1', { ...GOOD, identityDistance: 0.081 }).gate, 'FAIL');
});

test('boundary: môn chưa có luật → FAIL rõ ràng, không im lặng cho qua', () => {
  const r = SV.validate('bongban.v9', GOOD);
  assert.equal(r.gate, 'FAIL');
  assert.equal(r.checks[0].id, 'unknown_sport');
});

test('boundary: preset đặt ngưỡng độ phân giải riêng', () => {
  const small = { ...GOOD, width: 1024, height: 1024 };
  assert.equal(SV.validate('badminton.v1', small).gate, 'PASS', 'không cấu hình thì chỉ cần > 0');
  const r = SV.validate('badminton.v1', small, { minWidth: 4320, minHeight: 7680 });
  assert.equal(r.checks.find((c) => c.id === 'resolution').status, 'FAIL');
});

// Hai lớp phải NỐI được với nhau, nếu không thì tách lớp chỉ tạo thêm việc.
test('regression: quan sát rút thẳng từ kết quả compare diff', () => {
  const w = 8, h = 8;
  const before = img(w, h, [40, 40, 40]);
  const after = img(w, h, [40, 40, 40]);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < 10; i++) mask[i] = 255;
  for (let i = 0; i < 10; i++) { const o = i * 4; after.data[o] = 220; after.data[o + 1] = 220; after.data[o + 2] = 220; }

  const diff = CD.evaluate(before, after, { mask });
  const obs = SV.observationsFromDiff(diff);
  assert.equal(obs.leakedPixels, 0);
  assert.equal(obs.width, 8);
  assert.ok(typeof obs.outsideDriftRatio === 'number');

  // Ghép với quan sát của con người/mô hình rồi mới chấm.
  const r = SV.validate('badminton.v1', { ...obs, ...GOOD, ...obs });
  assert.equal(r.gate, 'PASS');
});

test('regression: đăng ký được môn mới mà không sửa module', () => {
  SV.register('tennis.v1', [{ id: 'one_ball', severity: 'critical', needs: ['ballCount'], check: (o) => o.ballCount <= 1, detail: 'một quả bóng' }]);
  assert.ok(SV.listSports().includes('tennis.v1'));
  assert.equal(SV.validate('tennis.v1', { ballCount: 2 }).gate, 'FAIL');
  assert.equal(SV.validate('tennis.v1', { ballCount: 1 }).gate, 'PASS');
});

// ── PhotoFinish ─────────────────────────────────────────────────────────────────────────
test('PhotoFinish: KHÔNG sửa tại chỗ — ảnh gốc phải nguyên vẹn', () => {
  const src = img(6, 6, [100, 100, 100]);
  const snapshot = Array.from(src.data);
  const out = PF.apply(src, 'indoor_sport');
  assert.deepEqual(Array.from(src.data), snapshot,
    'ảnh gốc có thể đang bị SourceLock canh giữ — sửa tại chỗ là làm sai băm một cách âm thầm');
  assert.notEqual(out, src);
});

test('PhotoFinish: preset none không đổi gì', () => {
  const src = img(5, 5, [77, 88, 99]);
  const out = PF.apply(src, 'none');
  assert.deepEqual(Array.from(out.data), Array.from(src.data));
});

test('PhotoFinish: tất định — chạy hai lần ra đúng một kết quả', () => {
  const src = img(7, 7, [60, 90, 120]);
  const a = PF.apply(src, 'editorial');
  const b = PF.apply(src, 'editorial');
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
});

test('PhotoFinish: tăng phơi sáng thì ảnh sáng lên, không tràn quá 255', () => {
  const src = img(4, 4, [200, 200, 200]);
  const out = PF.apply(src, { exposure: 0.5 });
  assert.ok(out.data[0] > 200, 'phải sáng hơn');
  for (let i = 0; i < out.data.length; i++) assert.ok(out.data[i] <= 255, 'không tràn');
});

test('PhotoFinish: ảnh hỏng thì ném rõ ràng', () => {
  assert.throws(() => PF.apply(null, 'none'), /ảnh không hợp lệ/);
});

test('PhotoFinish: có đủ preset cho trong nhà và ngoài trời', () => {
  const p = PF.listPresets();
  for (const need of ['none', 'indoor_sport', 'outdoor_sport', 'editorial']) {
    assert.ok(p.includes(need), `thiếu preset ${need}`);
  }
});
