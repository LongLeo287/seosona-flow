// VeoWatermarkProfile — alpha-map Veo đo thật + trừ ngược chính xác.
//
// Số liệu gốc: đo trên video Veo 1080x1920 thật (240 khung) ngày 2026-07-27.
//   tâm sao (900,1740) · α lõi 0.32 · logo ≈233 · R² 0.94
// Test dưới khoá cả HÌNH HỌC lẫn PHÉP TOÁN — sai một trong hai là watermark không sạch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const g = { atob: (b) => Buffer.from(b, 'base64').toString('binary') };
new Function('self', readFileSync(join(PKG, 'src/core/VeoWatermarkProfile.js'), 'utf8'))(g);
const P = g.VeoWatermarkProfile;

/** Canvas 2D giả — chỉ cần getImageData/putImageData. */
function makeCtx(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = typeof fill === 'function' ? fill(i % w, (i / w) | 0) : fill;
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  return {
    data, w, h,
    getImageData(sx, sy, sw, sh) {
      const d = new Uint8ClampedArray(sw * sh * 4);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++)
        for (let c = 0; c < 4; c++) d[(y * sw + x) * 4 + c] = data[((sy + y) * w + sx + x) * 4 + c];
      return { data: d, width: sw, height: sh };
    },
    putImageData(img, sx, sy) {
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
        for (let c = 0; c < 4; c++) data[((sy + y) * w + sx + x) * 4 + c] = img.data[(y * img.width + x) * 4 + c];
    },
  };
}

test('⭐ HÌNH HỌC khớp số đo thật trên video 1080x1920', () => {
  const geo = P.geometryFor(1080, 1920);
  assert.equal(geo.cx, 900, 'tâm x — đo được 900');
  assert.equal(geo.cy, 1740, 'tâm y — đo được 1740');
  assert.equal(geo.scale, 1, 'video đã hiệu chỉnh thì tỉ lệ = 1');
  assert.equal(1080 - geo.cx, 180, 'cách mép phải 180px = 1/6 cạnh ngắn');
  assert.equal(1920 - geo.cy, 180, 'cách đáy 180px');
});

test('⭐ ô mới KHÁC HẲN ô cũ — đây chính là lỗi đã sửa', () => {
  const geo = P.geometryFor(1080, 1920);
  // Ô cũ (boxFor): 96px ở lề 64 → x 920..1016, y 1760..1856
  const oldBox = { x: 1080 - 64 - 96, y: 1920 - 64 - 96, w: 96, h: 96 };
  const nb = geo.box;
  const ox = Math.max(0, Math.min(nb.x + nb.width, oldBox.x + oldBox.w) - Math.max(nb.x, oldBox.x));
  const oy = Math.max(0, Math.min(nb.y + nb.height, oldBox.y + oldBox.h) - Math.max(nb.y, oldBox.y));
  const overlap = (ox * oy) / (nb.width * nb.height);
  assert.ok(overlap < 0.15, 'ô cũ chỉ chồng ' + (overlap * 100).toFixed(0) + '% → trượt watermark');
});

test('⭐ TRỪ NGƯỢC tái tạo ĐÚNG pixel gốc (không vá, không làm mờ)', () => {
  const W = 300, H = 300, ORIG = 90, LOGO = P.LOGO;
  const map = P.alphaMap();
  const cx = 200, cy = 200, s = 1;
  // Dựng ảnh: nền phẳng ORIG, phủ watermark theo ĐÚNG alpha-map (mô phỏng Veo)
  const ctx = makeCtx(W, H, ORIG);
  for (let my = 0; my < P.MAP_H; my++) for (let mx = 0; mx < P.MAP_W; mx++) {
    const a = map[my * P.MAP_W + mx];
    if (a < 0.02) continue;
    const x = cx + P.OFF_X + mx, y = cy + P.OFF_Y + my;
    const o = (y * W + x) * 4;
    const blended = a * LOGO + (1 - a) * ORIG;
    for (let c = 0; c < 3; c++) ctx.data[o + c] = Math.round(blended);
  }
  // Trước khi xoá: có sai lệch rõ
  const probe = (x, y) => ctx.data[(y * W + x) * 4];
  const before = Math.abs(probe(cx, cy) - ORIG);
  assert.ok(before > 15, 'phải có watermark để xoá (lệch ' + before + ')');

  assert.equal(P.unblendContext(ctx, W, H, { cx, cy, scale: s }), true);

  // Sau khi xoá: mọi pixel trong vùng phải về ĐÚNG giá trị gốc
  let worst = 0;
  for (let my = 0; my < P.MAP_H; my++) for (let mx = 0; mx < P.MAP_W; mx++) {
    const x = cx + P.OFF_X + mx, y = cy + P.OFF_Y + my;
    worst = Math.max(worst, Math.abs(ctx.data[(y * W + x) * 4] - ORIG));
  }
  assert.ok(worst <= 2, 'sai số lớn nhất ' + worst + ' mức xám (chỉ do làm tròn 8-bit)');
});

test('tái tạo đúng trên NHIỀU mức nền khác nhau (sáng, tối, trung bình)', () => {
  const map = P.alphaMap();
  for (const ORIG of [20, 90, 160, 220]) {
    const W = 300, H = 300, cx = 200, cy = 200;
    const ctx = makeCtx(W, H, ORIG);
    for (let my = 0; my < P.MAP_H; my++) for (let mx = 0; mx < P.MAP_W; mx++) {
      const a = map[my * P.MAP_W + mx]; if (a < 0.02) continue;
      const o = ((cy + P.OFF_Y + my) * W + (cx + P.OFF_X + mx)) * 4;
      const v = Math.round(a * P.LOGO + (1 - a) * ORIG);
      for (let c = 0; c < 3; c++) ctx.data[o + c] = v;
    }
    P.unblendContext(ctx, W, H, { cx, cy, scale: 1 });
    const mid = ctx.data[(cy * W + cx) * 4];
    assert.ok(Math.abs(mid - ORIG) <= 2, 'nền ' + ORIG + ' → tái tạo ' + mid);
  }
});

test('KHÔNG đụng pixel ngoài vùng watermark', () => {
  const W = 300, H = 300, cx = 200, cy = 200;
  const ctx = makeCtx(W, H, (x, y) => (x * 7 + y * 13) % 200 + 20);
  const snapshot = Uint8ClampedArray.from(ctx.data);
  P.unblendContext(ctx, W, H, { cx, cy, scale: 1 });
  let touchedOutside = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const mx = x - (cx + P.OFF_X), my = y - (cy + P.OFF_Y);
    const inside = mx >= 0 && mx < P.MAP_W && my >= 0 && my < P.MAP_H;
    if (!inside && ctx.data[(y * W + x) * 4] !== snapshot[(y * W + x) * 4]) touchedOutside++;
  }
  assert.equal(touchedOutside, 0, 'chạm ' + touchedOutside + ' pixel ngoài vùng — phải là 0');
});

test('watermark sát mép khung → kẹp biên, không nổ', () => {
  const W = 200, H = 200;
  const ctx = makeCtx(W, H, 100);
  // tâm đặt sát góc dưới-phải, phần map tràn ra ngoài
  assert.doesNotThrow(() => P.unblendContext(ctx, W, H, { cx: W - 5, cy: H - 5, scale: 1 }));
});

test('alpha-map: kích thước + đỉnh khớp số đo', () => {
  assert.equal(P.MAP_W, 81); assert.equal(P.MAP_H, 75);
  const m = P.alphaMap();
  assert.equal(m.length, 81 * 75);
  let peak = 0; for (const v of m) if (v > peak) peak = v;
  assert.ok(Math.abs(peak - P.PEAK) < 0.01, 'α đỉnh ' + peak.toFixed(3));
  assert.ok(peak > 0.3 && peak < 0.5, 'α đỉnh phải quanh 0.32-0.39 như đo được');
});

// ── Hiệu chỉnh theo từng khung (chống nhấp nháy) ────────────────────────────
test('⭐ unblendAdaptive tự tìm gain đúng cho từng khung', () => {
  const map = P.alphaMap();
  const W = 300, H = 300, cx = 200, cy = 200, ORIG = 100;
  // Dựng khung mà watermark bị đặt với cường độ KHÁC chuẩn (mô phỏng nén làm lệch mỗi khung)
  for (const trueGain of [0.8, 1.0, 1.25]) {
    const ctx = makeCtx(W, H, ORIG);
    const geo = P.geometryFor(1080, 1920);
    const star = geo.starSize, s = star / P.MAP_W;
    const bx = Math.round(cx - star / 2), by = Math.round(cy - star / 2);
    for (let yy = 0; yy < star; yy++) for (let xx = 0; xx < star; xx++) {
      const mx = Math.round(xx / s), my = Math.round(yy / s);
      if (mx >= P.MAP_W || my >= P.MAP_H) continue;
      const a = Math.min(0.95, map[my * P.MAP_W + mx] * trueGain);
      if (a < 0.02) continue;
      const o = ((by + yy) * W + (bx + xx)) * 4;
      const v = Math.round(a * P.LOGO + (1 - a) * ORIG);
      for (let c = 0; c < 3; c++) ctx.data[o + c] = v;
    }
    const r = P.unblendAdaptive(ctx, W, H, { cx, cy, starSize: star });
    assert.ok(r && r.ok, 'phải xử lý được');
    // gain tìm được phải bám gain thật
    assert.ok(Math.abs(r.gain - trueGain) < 0.25,
      'gain thật ' + trueGain + ' → tìm được ' + r.gain.toFixed(2));
    const mid = ctx.data[(cy * W + cx) * 4];
    assert.ok(Math.abs(mid - ORIG) < 14, 'tâm tái tạo ' + mid + ' (gốc ' + ORIG + ')');
  }
});

test('geometryFor trả cỡ sao ĐO ĐƯỢC, co giãn theo cạnh ngắn', () => {
  assert.equal(P.geometryFor(1080, 1920).starSize, 72, 'đo lại bằng thước đo công bằng = 72px');
  assert.equal(P.geometryFor(1920, 1080).starSize, 72, 'xoay ngang vẫn theo cạnh ngắn');
  assert.ok(P.geometryFor(3840, 2160).starSize > 100, '4K phải to hơn — lỗi cũ giữ nguyên 96px');
});

test('LOGO = 255 (trắng tinh) — đã kiểm chứng bằng đối chứng L=233 vs 255', () => {
  assert.equal(P.LOGO, 255);
});
