// FlowCredits — bảng giá tín dụng Flow lấy từ giao diện THẬT (ảnh chụp 2026-07-27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const g = {};
new Function('self', readFileSync(join(PKG, 'src/core/FlowCredits.js'), 'utf8'))(g);
const FC = g.FlowCredits;

// ── Bảng giá khớp ảnh chụp thật ────────────────────────────────────────────
test('⭐ giá 1x khớp đúng giao diện Flow', () => {
  assert.equal(FC.costOf('Nano Banana 2 Lite', 1), 0, 'ảnh Lite miễn phí');
  assert.equal(FC.costOf('Omni Flash', 1), 10);
  assert.equal(FC.costOf('Veo 3.1 - Lite', 1), 10);
  assert.equal(FC.costOf('Veo 3.1 - Fast', 1), 20);
  assert.equal(FC.costOf('Veo 3.1 - Quality', 1), 100);
});

test('⭐ MỌI model ảnh đều 0 tín dụng, kể cả x4', () => {
  ['Nano Banana Pro', 'Nano Banana 2', 'Nano Banana 2 Lite'].forEach((m) => {
    assert.equal(FC.costOf(m, 4), 0, m + ' x4 phải là 0');
  });
});

test('⭐ THỜI LƯỢNG đổi giá (Omni Flash) — bản đầu ghi sai là không đổi', () => {
  assert.equal(FC.costOf('Omni Flash', 1, '4s'), 7);
  assert.equal(FC.costOf('Omni Flash', 1, '6s'), 10);
  assert.equal(FC.costOf('Omni Flash', 1, '10s'), 15);
  // nhân số lượng vẫn tuyến tính trên giá theo thời lượng
  assert.equal(FC.costOf('Omni Flash', 4, '10s'), 60);
});

test('⭐ mốc thời lượng CHƯA có dữ liệu → null, KHÔNG nội suy', () => {
  assert.equal(FC.costOf('Omni Flash', 1, '8s'), null, '8s chưa chụp được → phải trả null');
  assert.deepEqual(FC.knownDurations('Omni Flash'), ['4s', '6s', '10s']);
  assert.equal(FC.knownDurations('Veo 3.1 - Fast'), null, 'Veo không phụ thuộc thời lượng');
});

test('Veo: nhân số lượng tuyến tính, không phụ thuộc thời lượng', () => {
  assert.equal(FC.costOf('Veo 3.1 - Lite', 4), 40);
  assert.equal(FC.costOf('Veo 3.1 - Fast', 4), 80);
  assert.equal(FC.costOf('Veo 3.1 - Quality', 4), 400);
});

test('⭐ NGOẠI LỆ GÓI: Ultra → Veo 3.1 Fast = 0 tín dụng', () => {
  assert.equal(FC.costOf('Veo 3.1 - Fast', 1), 20, 'không nêu gói → giá thường');
  assert.equal(FC.costOf('Veo 3.1 - Fast', 4, null, 'ultra'), 0, 'Ultra miễn phí, kể cả x4');
  assert.equal(FC.costOf('Veo 3.1 - Fast', 1, null, 'pro'), 20, 'Pro vẫn tính tiền');
  assert.equal(FC.costOf('Veo 3.1 - Quality', 1, null, 'ultra'), 100, 'chỉ Fast miễn phí, Quality thì không');
});

test('hạn mức theo gói khớp trang giá Flow (free tính theo NGÀY)', () => {
  assert.equal(FC.PLAN_QUOTA.free.credits, 50);
  assert.equal(FC.PLAN_QUOTA.free.period, 'day', 'free là 50/NGÀY chứ không phải /tháng');
  assert.equal(FC.PLAN_QUOTA.pro.credits, 1000);
  assert.equal(FC.PLAN_QUOTA.pro.period, 'month');
  assert.equal(FC.PLAN_QUOTA.ultra.credits, 10000);
});

test('planFor: đọc thời lượng từ node để tính đúng giá', () => {
  const p = FC.planFor(100, [{ node_type: 'generate', model: 'Omni Flash', quantity: 2, flowVideoDuration: '4s' }]);
  assert.equal(p.total, 14, '7 x 2 = 14');
  const q = FC.planFor(100, [{ node_type: 'generate', model: 'Omni Flash', quantity: 1, flowVideoDuration: '8s' }]);
  assert.equal(q.unknown, 1, '8s chưa rõ giá → đếm vào unknown');
  assert.equal(q.ok, true, 'chưa rõ thì không chặn');
});

test('⭐ chi phí NHÂN TUYẾN TÍNH theo số lượng (Omni Flash x4 = 40)', () => {
  assert.equal(FC.costOf('Omni Flash', 4), 40);
  assert.equal(FC.costOf('Veo 3.1 - Quality', 2), 200);
  assert.equal(FC.costOf('Nano Banana 2 Lite', 4), 0, 'ảnh Lite x4 vẫn 0');
});

test('tên model không phân biệt hoa/thường/khoảng trắng', () => {
  assert.equal(FC.costOf('omni  flash', 1), 10);
  assert.equal(FC.costOf('VEO 3.1 - QUALITY', 1), 100);
});

test('model lạ → null (KHÔNG đoán giá)', () => {
  assert.equal(FC.costOf('Model Chưa Biết', 1), null);
  assert.equal(FC.costOf('', 1), null);
});

// ── Đọc số từ giao diện ────────────────────────────────────────────────────
test('đọc được chi phí Flow tự hiển thị trên trang', () => {
  assert.equal(FC.parseCostText('Quá trình tạo sẽ tốn 40 tín dụng'), 40);
  assert.equal(FC.parseCostText('Quá trình tạo sẽ tốn 0 tín dụng'), 0);
  assert.equal(FC.parseCostText('will cost 100 credits'), 100);
  assert.equal(FC.parseCostText('không có số'), null);
});

test('đọc được số dư từ menu tài khoản', () => {
  assert.equal(FC.parseBalanceText('60 Tín dụng Google Flow'), 60);
  assert.equal(FC.parseBalanceText('1,250 tín dụng'), 1250);
});

// ── Kiểm đủ/thiếu ──────────────────────────────────────────────────────────
test('⭐ số dư 60: đủ Omni Flash nhưng KHÔNG đủ Veo Quality (đúng ca thật của user)', () => {
  const a = FC.check(60, 'Omni Flash', 1);
  assert.equal(a.ok, true);
  assert.equal(a.maxRuns, 6, '60/10 = 6 clip');

  const b = FC.check(60, 'Veo 3.1 - Quality', 1);
  assert.equal(b.ok, false);
  assert.equal(b.shortBy, 40, 'thiếu đúng 40 tín dụng');
});

test('x4 vượt số dư → báo thiếu đúng số', () => {
  const r = FC.check(60, 'Omni Flash', 4); // cần 40 → vẫn đủ
  assert.equal(r.ok, true);
  const r2 = FC.check(30, 'Omni Flash', 4); // cần 40, có 30
  assert.equal(r2.ok, false);
  assert.equal(r2.shortBy, 10);
});

test('model 0 tín dụng → luôn chạy được, đánh dấu free', () => {
  const r = FC.check(0, 'Nano Banana 2 Lite', 4);
  assert.equal(r.ok, true);
  assert.equal(r.free, true);
});

test('⭐ chưa biết số dư/giá → KHÔNG tự chặn (known:false)', () => {
  const a = FC.check(null, 'Omni Flash', 1);
  assert.equal(a.ok, true);
  assert.equal(a.known, false, 'thiếu dữ liệu thì không được kết luận');
  const b = FC.check(60, 'Model Lạ', 1);
  assert.equal(b.ok, true);
  assert.equal(b.known, false);
});

// ── Tính cho cả workflow ───────────────────────────────────────────────────
test('planFor: cộng dồn chi phí mọi node generate', () => {
  const nodes = [
    { node_type: 'generate', model: 'Omni Flash', quantity: 2 },   // 20
    { node_type: 'generate', model: 'Veo 3.1 - Fast', quantity: 1 }, // 20
    { node_type: 'prompt' },                                         // bỏ qua
    { node_type: 'download' },                                       // bỏ qua
  ];
  const p = FC.planFor(60, nodes);
  assert.equal(p.total, 40);
  assert.equal(p.items.length, 2, 'chỉ tính node sinh media');
  assert.equal(p.ok, true);
});

test('planFor: thiếu tín dụng → nêu rõ thiếu bao nhiêu', () => {
  const p = FC.planFor(60, [{ node_type: 'generate', model: 'Veo 3.1 - Quality', quantity: 1 }]);
  assert.equal(p.ok, false);
  assert.equal(p.shortBy, 40);
});

test('planFor: node chưa rõ giá được đếm riêng, không kết luận bừa', () => {
  const p = FC.planFor(60, [
    { node_type: 'generate', model: 'Omni Flash', quantity: 1 },
    { node_type: 'generate', model: 'Model Lạ', quantity: 1 },
  ]);
  assert.equal(p.unknown, 1);
  assert.equal(p.known, false);
  assert.equal(p.ok, true, 'còn node chưa rõ giá thì không được chặn');
});

test('planFor: đọc được node dạng data.* lẫn phẳng', () => {
  const p = FC.planFor(100, [{ type: 'generate', data: { model: 'Omni Flash', quantity: 3 } }]);
  assert.equal(p.total, 30);
});
