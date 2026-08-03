// Cổng an toàn cho đường xoá watermark ẢNH.
//
// VÌ SAO CÓ CỔNG: engine GWR tự nhận "applied" quá dễ dãi. Đo trên 33 ảnh THƯỜNG (không phải
// Gemini): 12/33 bị nó sửa oan, có ảnh mất 2.716 pixel. Ảnh chụp/thiết kế của user bị hỏng mà
// không ai biết — tệ hơn nhiều so với bỏ sót watermark (bỏ sót thì NHÌN THẤY và bấm lại được).
//
// originalGradientScore tách hai nhóm rất tốt (ảnh Gemini thật đo được 0.812):
//   0.20 → lọt 2 ảnh oan  ·  0.25–0.30 → LỌT 0  ·  0.40 → mất thêm ca thật
// Chọn 0.30: giữ 21/27 ca thật mà không để lọt ảnh nào.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(join(PKG, 'src/core/WatermarkRemover.js'), 'utf8');

/**
 * Nạp module với GWR giả để điều khiển được điểm nhận diện.
 * @param {number} gradient điểm mà engine trả về
 */
function load(gradient, { applied = true } = {}) {
  const state = { putCount: 0, lastPut: null };
  const g = {
    GWR: {
      removeWatermarkFromImageDataSync(img) {
        // Trả ảnh "đã xoá" khác hẳn ảnh vào, để phân biệt được có ghi đè hay không.
        const out = { data: new Uint8ClampedArray(img.data.length).fill(7), width: img.width, height: img.height };
        return { imageData: out, meta: { applied, detection: { originalGradientScore: gradient, originalSpatialScore: gradient } } };
      },
    },
  };
  // makeCanvas()/createImageBitmap() trong module dùng ĐỊNH DANH TOÀN CỤC, không đi qua `self`
  // → phải gắn lên globalThis thì stub mới có tác dụng.
  globalThis.createImageBitmap = async () => ({ width: 64, height: 64, close() {} });
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() {
      return {
        drawImage() {},
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(200), width: w, height: h }),
        putImageData: (im) => { state.putCount++; state.lastPut = im; },
      };
    }
    convertToBlob() { return Promise.resolve({ size: 1, type: 'image/png' }); }
  };
  new Function('self', SRC)(g);
  return { WR: g.WatermarkRemover, state };
}

const FAKE_BLOB = { size: 10, type: 'image/png' };

test('⭐ nhận diện YẾU → CHẶN, không đụng ảnh, báo LOW_CONFIDENCE', async () => {
  const { WR, state } = load(0.12);        // dưới ngưỡng 0.30
  await assert.rejects(
    () => WR.removeFromBlob(FAKE_BLOB, {}),
    (e) => e.code === 'LOW_CONFIDENCE' && typeof e.gradient === 'number',
    'phải ném LOW_CONFIDENCE kèm điểm để UI giải thích được',
  );
  assert.equal(state.putCount, 0, '⭐ TUYỆT ĐỐI không được ghi đè ảnh khi chưa chắc');
});

test('⭐ nhận diện MẠNH → xoá bình thường (ảnh Gemini thật đo được 0.812)', async () => {
  const { WR, state } = load(0.812);
  const out = await WR.removeFromBlob(FAKE_BLOB, {});
  assert.ok(out, 'phải trả về ảnh đã xử lý');
  assert.equal(state.putCount, 1, 'phải ghi kết quả xoá');
});

test('ngưỡng đúng ở 0.30 — ngay dưới thì chặn, ngay trên thì cho qua', async () => {
  await assert.rejects(() => load(0.29).WR.removeFromBlob(FAKE_BLOB, {}), (e) => e.code === 'LOW_CONFIDENCE');
  const hi = load(0.31);
  await assert.doesNotReject(() => hi.WR.removeFromBlob(FAKE_BLOB, {}));
});

test('⭐ opts.force → bỏ qua cổng (user bấm lần 2 để xoá cưỡng bức)', async () => {
  const { WR, state } = load(0.05);        // điểm rất thấp
  const out = await WR.removeFromBlob(FAKE_BLOB, { force: true });
  assert.ok(out);
  assert.equal(state.putCount, 1, 'có force thì phải xoá dù điểm thấp');
});

test('engine tự báo KHÔNG có watermark → cổng không xen vào (không ném lỗi oan)', async () => {
  const { WR } = load(0.05, { applied: false });
  await assert.doesNotReject(() => WR.removeFromBlob(FAKE_BLOB, {}),
    'applied:false nghĩa là engine đã tự bỏ qua — cổng không cần chặn thêm');
});

test('điểm thiếu/không phải số → không chặn (thà cho qua còn hơn chặn oan vì thiếu dữ liệu)', async () => {
  const { WR } = load(undefined);
  await assert.doesNotReject(() => WR.removeFromBlob(FAKE_BLOB, {}));
});
