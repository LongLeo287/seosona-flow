// Ý tưởng TÁCH LỚP làm được ngay: prompt vẽ trên nền phẳng → cắt nền ở máy → xếp chồng.
// Không mô hình nào ta điều khiển xuất được RGBA, nên đây là cách lấy lớp mà không cài engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const scope = {};
for (const f of ['src/layers/LayerCutout.js', 'src/layers/LayerStack.js', 'src/layers/LayerPrompt.js']) {
  new Function('self', 'window', readFileSync(join(root, f), 'utf8'))(scope, scope);
}
const CO = scope.SEOSONA_LayerCutout;
const ST = scope.SEOSONA_LayerStack;
const LP = scope.SEOSONA_LayerPrompt;

// Ảnh: nền magenta + một ô vuông đặc ở giữa. Thêm nhiễu để giống ảnh mô hình trả về thật.
function onMagenta(w, h, box, color, jitter = 0) {
  const d = new Uint8ClampedArray(w * h * 4);
  const j = () => (jitter ? Math.round((Math.random() - 0.5) * jitter) : 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const inside = box && x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
      const c = inside ? color : [255 + j(), Math.abs(j()), 255 + j()];
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: d };
}

function solid(w, h, rgba) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = rgba[0]; d[i * 4 + 1] = rgba[1]; d[i * 4 + 2] = rgba[2]; d[i * 4 + 3] = rgba[3];
  }
  return { width: w, height: h, data: d };
}

// ── Cắt nền ─────────────────────────────────────────────────────────────────────────────
test('positive: đo được màu nền thật, không cần tin màu đã hẹn', () => {
  const img = onMagenta(40, 40, { x: 10, y: 10, width: 20, height: 20 }, [20, 120, 200], 12);
  const det = CO.detectBackdrop(img);
  assert.ok(det.flat, 'bốn góc phải giống nhau → nền phẳng');
  assert.ok(det.key[0] > 200 && det.key[2] > 200 && det.key[1] < 60, `đo ra ${det.key}`);
});

test('positive: cắt ra đúng vật, nền thành trong suốt', () => {
  const img = onMagenta(40, 40, { x: 10, y: 10, width: 20, height: 20 }, [20, 120, 200], 10);
  const r = CO.cutout(img);
  const at = (x, y) => r.image.data[(y * 40 + x) * 4 + 3];
  assert.equal(at(2, 2), 0, 'góc là nền → alpha 0');
  assert.equal(at(20, 20), 255, 'giữa vật → alpha đầy');
  assert.ok(r.keptRatio > 0.15 && r.keptRatio < 0.45, `giữ ${(r.keptRatio * 100).toFixed(0)}%, cần khoảng 25%`);
  assert.deepEqual(r.warnings, []);
});

// Nếu tin màu hẹn trước thay vì đo, ảnh lệch màu sẽ cắt hụt cả mảng nền.
test('regression: nền lệch màu vẫn cắt được nhờ ĐO', () => {
  const img = onMagenta(30, 30, { x: 8, y: 8, width: 14, height: 14 }, [30, 200, 60], 0);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 1] < 100) { img.data[i] = 228; img.data[i + 1] = 18; img.data[i + 2] = 236; }
  }
  const r = CO.cutout(img);
  assert.equal(r.image.data[3], 0, 'vẫn nhận ra nền dù lệch màu');
  assert.deepEqual(r.warnings, []);
});

test('negative: ảnh có bối cảnh thật → CẢNH BÁO, không cắt liều', () => {
  const w = 30, h = 30;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      d[o] = x * 8; d[o + 1] = y * 8; d[o + 2] = 128; d[o + 3] = 255;
    }
  }
  const r = CO.cutout({ width: w, height: h, data: d });
  assert.ok(r.warnings.some((x) => /nền không phẳng/.test(x)), 'phải nói ra, không im lặng cắt bậy');
});

test('negative: nền và vật cùng màu → báo cắt mất gần hết', () => {
  const img = onMagenta(20, 20, { x: 5, y: 5, width: 10, height: 10 }, [252, 3, 250], 0);
  const r = CO.cutout(img);
  assert.ok(r.warnings.some((x) => /cắt mất gần hết/.test(x)));
});

test('boundary: hộp bao lấy đúng phần còn lại', () => {
  const img = onMagenta(40, 40, { x: 12, y: 6, width: 10, height: 18 }, [10, 10, 10], 0);
  const r = CO.cutout(img);
  const b = CO.boundsOf(r.image);
  assert.ok(Math.abs(b.x - 12) <= 1 && Math.abs(b.y - 6) <= 1, `ra ${JSON.stringify(b)}`);
  assert.ok(Math.abs(b.width - 10) <= 2 && Math.abs(b.height - 18) <= 2);
});

// ── Xếp chồng ───────────────────────────────────────────────────────────────────────────
test('positive: z lớn hơn nằm TRÊN', () => {
  const layers = [
    { id: 'duoi', image: solid(10, 10, [255, 0, 0, 255]), x: 0, y: 0, z: 0 },
    { id: 'tren', image: solid(10, 10, [0, 0, 255, 255]), x: 0, y: 0, z: 1 },
  ];
  const out = ST.composite(layers, { width: 10, height: 10 });
  assert.equal(out.data[2], 255, 'thấy màu xanh của lớp trên');
  assert.equal(out.data[0], 0);
});

// Đây là điều mask+inpaint KHÔNG cho: sửa một vật mà vật khác chắc chắn nguyên vẹn.
test('positive: sửa MỘT lớp không đụng lớp khác — theo cấu trúc, không nhờ đo', () => {
  const base = [
    { id: 'a', image: solid(6, 6, [200, 0, 0, 255]), x: 0, y: 0, z: 0 },
    { id: 'b', image: solid(6, 6, [0, 200, 0, 255]), x: 20, y: 0, z: 1 },
  ];
  const moved = ST.update(base, 'b', { x: 30, scale: 2 });
  assert.equal(base[1].x, 20, 'danh sách gốc KHÔNG bị sửa tại chỗ');
  assert.equal(moved[1].x, 30);
  assert.equal(moved[0].image, base[0].image, 'lớp kia dùng lại đúng ảnh cũ, không sao chép hay biến đổi');
});

test('positive: ghép lại nhiều lần KHÔNG tích luỹ sai số', () => {
  const layers = [{ id: 'x', image: solid(8, 8, [123, 45, 67, 255]), x: 1, y: 1, z: 0 }];
  const a = ST.composite(layers, { width: 12, height: 12 });
  const b = ST.composite(layers, { width: 12, height: 12 });
  assert.deepEqual(Array.from(a.data), Array.from(b.data),
    'khác hẳn vòng lặp inpaint: mỗi lần ghép đều từ lớp GỐC');
});

test('boundary: lớp bán trong suốt chồng nhau ra màu đúng', () => {
  const layers = [
    { id: 'd', image: solid(4, 4, [255, 0, 0, 255]), x: 0, y: 0, z: 0 },
    { id: 't', image: solid(4, 4, [0, 0, 255, 128]), x: 0, y: 0, z: 1 },
  ];
  const out = ST.composite(layers, { width: 4, height: 4 });
  assert.ok(out.data[0] > 100 && out.data[0] < 145, `đỏ còn lại ${out.data[0]}, cần khoảng 127`);
  assert.ok(out.data[2] > 100 && out.data[2] < 145, `xanh ${out.data[2]}, cần khoảng 128`);
  assert.equal(out.data[3], 255);
});

test('boundary: lớp ẩn hoặc opacity 0 thì bỏ qua', () => {
  const out = ST.composite([
    { id: 'a', image: solid(4, 4, [255, 255, 255, 255]), z: 0, visible: false },
    { id: 'b', image: solid(4, 4, [255, 255, 255, 255]), z: 1, opacity: 0 },
  ], { width: 4, height: 4 });
  assert.equal(out.data[3], 0, 'khung phải trống');
});

test('boundary: lớp nằm ngoài khung không làm vỡ', () => {
  assert.doesNotThrow(() => ST.composite(
    [{ id: 'x', image: solid(5, 5, [1, 2, 3, 255]), x: -99, y: 999, z: 0 }],
    { width: 10, height: 10 }));
});

test('regression: đổi thứ tự chồng chuẩn hoá lại z, không trôi số', () => {
  const l = [
    { id: 'a', image: solid(2, 2, [0, 0, 0, 255]), z: 0 },
    { id: 'b', image: solid(2, 2, [0, 0, 0, 255]), z: 5 },
    { id: 'c', image: solid(2, 2, [0, 0, 0, 255]), z: 9 },
  ];
  const r = ST.reorder(l, 'c', 0);
  assert.deepEqual(r.map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(r.map((x) => x.z), [0, 1, 2]);
});

test('regression: sửa lớp không tồn tại thì ném, không im lặng bỏ qua', () => {
  assert.throws(() => ST.update([], 'khong-co', { x: 1 }), /không có lớp/);
  assert.throws(() => ST.reorder([], 'khong-co', 0), /không có lớp/);
});

// ── Prompt ──────────────────────────────────────────────────────────────────────────────
test('positive: prompt nêu rõ nền phẳng và cấm những thứ phá phép cắt', () => {
  const p = LP.build('a badminton racket');
  assert.match(p.positive, /exactly one isolated object/);
  assert.match(p.positive, /magenta/);
  assert.match(p.positive, /must not touch the frame edges/);
  for (const kill of ['drop shadow', 'reflection', 'gradient', 'border', 'watermark']) {
    assert.ok(p.negative.includes(kill), `phải cấm: ${kill}`);
  }
});

test('regression: bộ lớp giữ thứ tự z và chặn id trùng', () => {
  const set = LP.buildSet([
    { id: 'san', subject: 'an indoor badminton court floor', z: 0 },
    { id: 'vdv', subject: 'a badminton player lunging', z: 1 },
    { id: 'vot', subject: 'a badminton racket', z: 2 },
  ]);
  assert.deepEqual(set.map((s) => s.id), ['san', 'vdv', 'vot']);
  assert.throws(() => LP.buildSet([{ id: 'x', subject: 'a' }, { id: 'x', subject: 'b' }]), /id trùng/);
  assert.throws(() => LP.buildSet([]), /rỗng/);
});
