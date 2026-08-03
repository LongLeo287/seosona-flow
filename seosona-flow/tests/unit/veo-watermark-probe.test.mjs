// VeoWatermarkProbe — tự dò watermark video bằng phương sai theo thời gian.
// Dựng video TỔNG HỢP nên biết trước ĐÁP ÁN (vị trí + α thật) ⇒ đo được sai số thực,
// không phải chỉ "chạy không lỗi".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const g = {};
new Function('self', readFileSync(join(PKG, 'src/core/VeoWatermarkProbe.js'), 'utf8'))(g);
const P = g.VeoWatermarkProbe;

/** PRNG cố định — test phải cho cùng kết quả mọi lần chạy. */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/**
 * Dựng n khung hình: nội dung ĐỘNG + watermark ĐỨNG YÊN pha theo alpha thật.
 * watermarked = α·255 + (1−α)·original  — đúng công thức Veo/Gemini dùng.
 */
function makeFrames({ w = 160, h = 120, n = 12, box = null, alpha = 0.55, seed = 7, staticScene = false } = {}) {
  const r = rng(seed);
  const frames = [];
  for (let f = 0; f < n; f++) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      // Nội dung đổi theo khung (trừ khi cố ý dựng cảnh tĩnh)
      const base = staticScene ? 90 : 40 + r() * 170;
      d[i * 4] = base; d[i * 4 + 1] = base; d[i * 4 + 2] = base; d[i * 4 + 3] = 255;
    }
    if (box) {
      for (let y = box.y; y < box.y + box.height; y++) {
        for (let x = box.x; x < box.x + box.width; x++) {
          const i = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) d[i + c] = alpha * 255 + (1 - alpha) * d[i + c];
        }
      }
    }
    frames.push(d);
  }
  return { frames, w, h };
}

test('⭐ dò ĐÚNG vị trí watermark ở góc dưới-phải', () => {
  const W = 160, H = 120;
  const truth = { x: 130, y: 92, width: 22, height: 20 };
  const { frames } = makeFrames({ w: W, h: H, box: truth, alpha: 0.55 });
  const st = P.temporalStats(frames, W, H);
  const hit = P.findBox(st, W, H);

  assert.ok(hit, 'phải tìm thấy');
  assert.equal(hit.corner, 'br');
  // Cho lệch ±3px (biên watermark mờ dần ở rìa là chuyện bình thường)
  assert.ok(Math.abs(hit.box.x - truth.x) <= 3, 'x lệch ' + Math.abs(hit.box.x - truth.x) + 'px');
  assert.ok(Math.abs(hit.box.y - truth.y) <= 3, 'y lệch ' + Math.abs(hit.box.y - truth.y) + 'px');
  assert.ok(hit.confidence > 0.3, 'độ tin cậy phải khá: ' + hit.confidence.toFixed(2));
});

test('⭐ ước lượng α sát giá trị THẬT, và hai cách tính phải ĐỒNG Ý', () => {
  const W = 160, H = 120, ALPHA = 0.5;
  const truth = { x: 128, y: 90, width: 24, height: 22 };
  const { frames } = makeFrames({ w: W, h: H, box: truth, alpha: ALPHA, seed: 11 });
  const st = P.temporalStats(frames, W, H);
  const est = P.estimateAlpha(st, truth, W);

  assert.ok(est, 'phải ước lượng được');
  assert.equal(est.agree, true, 'hai cách phải đồng ý — lệch ' +
    Math.abs(est.alphaFromVariance - est.alphaFromMean).toFixed(3));
  const err = Math.abs(est.alphaFromVariance - ALPHA);
  assert.ok(err < 0.12, 'α ước lượng ' + est.alphaFromVariance.toFixed(3) + ' vs thật ' + ALPHA + ' (lệch ' + err.toFixed(3) + ')');
  assert.ok(est.confidence > 0.3, 'độ tin cậy ' + est.confidence.toFixed(2));
});

test('α cao (watermark đậm) vẫn ước lượng đúng hướng', () => {
  const W = 160, H = 120, ALPHA = 0.8;
  const truth = { x: 130, y: 92, width: 22, height: 20 };
  const { frames } = makeFrames({ w: W, h: H, box: truth, alpha: ALPHA, seed: 23 });
  const est = P.estimateAlpha(P.temporalStats(frames, W, H), truth, W);
  assert.ok(est.alphaFromVariance > 0.6, 'phải nhận ra là đậm: ' + est.alphaFromVariance.toFixed(2));
});

test('⭐ KHÔNG có watermark → không được bịa ra hộp', () => {
  const W = 160, H = 120;
  const { frames } = makeFrames({ w: W, h: H, box: null });
  const hit = P.findBox(P.temporalStats(frames, W, H), W, H);
  assert.ok(!hit || hit.confidence < 0.25,
    'video sạch mà báo tìm thấy với độ tin cậy ' + (hit && hit.confidence.toFixed(2)) + ' → sẽ phá ảnh oan');
});

test('⭐ CẢNH TĨNH → trả null, KHÔNG đoán (phương sai tham chiếu quá thấp)', () => {
  const W = 160, H = 120;
  const truth = { x: 130, y: 92, width: 22, height: 20 };
  const { frames } = makeFrames({ w: W, h: H, box: truth, alpha: 0.55, staticScene: true });
  const hit = P.findBox(P.temporalStats(frames, W, H), W, H);
  assert.equal(hit, null, 'cảnh không động thì không suy ra được gì — phải nói không biết');
});

test('dò được cả góc khác (Google dời watermark thì vẫn bắt được)', () => {
  const W = 160, H = 120;
  const truth = { x: 6, y: 6, width: 22, height: 20 };     // góc TRÊN-TRÁI
  const { frames } = makeFrames({ w: W, h: H, box: truth, alpha: 0.6, seed: 31 });
  const hit = P.findBox(P.temporalStats(frames, W, H), W, H);
  assert.ok(hit, 'phải tìm thấy dù không nằm góc dưới-phải');
  assert.equal(hit.corner, 'tl', 'phải báo đúng góc — đây là điểm mà bảng toạ độ cứng sẽ trượt');
});

test('temporalStats: trung bình + phương sai tính đúng', () => {
  const W = 2, H = 1;
  const mk = (v) => { const d = new Uint8ClampedArray(8); for (let i = 0; i < 2; i++) { d[i*4]=v; d[i*4+1]=v; d[i*4+2]=v; d[i*4+3]=255; } return d; };
  const st = P.temporalStats([mk(100), mk(200)], W, H);
  assert.ok(Math.abs(st.mean[0] - 150) < 0.6, 'mean ' + st.mean[0]);
  assert.ok(Math.abs(st.variance[0] - 5000) < 60, 'variance ' + st.variance[0]); // var mẫu của {100,200}
});

test('nền gần trắng → trả null (mẫu số ~0, chia ra vô nghĩa)', () => {
  const W = 100, H = 80;
  const box = { x: 70, y: 55, width: 20, height: 18 };
  const frames = [];
  const r = rng(5);
  for (let f = 0; f < 10; f++) {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { const v = 246 + r() * 9; d[i*4]=v; d[i*4+1]=v; d[i*4+2]=v; d[i*4+3]=255; }
    frames.push(d);
  }
  const est = P.estimateAlpha(P.temporalStats(frames, W, H), box, W);
  assert.equal(est, null, 'nền trắng thì không được chia — phải từ chối');
});
