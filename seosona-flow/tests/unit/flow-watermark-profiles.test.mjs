// Hồ sơ watermark Flow ĐO TỪ 624 KHUNG VIDEO THẬT. Test này khoá hai thứ:
//   ① dữ liệu đo được không bị hỏng/lệch khi đóng gói,
//   ② mã xoá chỉ đụng đúng ô watermark — phần còn lại của khung hình không suy suyển một byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const g = { atob: (s) => Buffer.from(s, 'base64').toString('binary') };
g.self = g;
new Function('self', 'atob', read('src/core/FlowWatermarkProfiles.js'))(g, g.atob);
const FP = g.FlowWatermarkProfiles;

test('có đủ hai hồ sơ, mỗi cái một CÁCH XOÁ riêng', () => {
  assert.deepEqual(Object.keys(FP.PROFILES).sort(), ['flow_omni', 'flow_veo']);
  // Đây là kết luận trung tâm của cả đợt đo: Omni trừ ngược được, Veo thì không.
  assert.equal(FP.PROFILES.flow_omni.method, 'unblend');
  assert.equal(FP.PROFILES.flow_veo.method, 'inpaint');
});

test('kích thước dữ liệu khớp hình học đã khai', () => {
  const o = FP.PROFILES.flow_omni;
  assert.equal(FP.bytes(o.alpha).length, o.w * o.h, 'alpha map sai cỡ');
  assert.equal(FP.bytes(o.color).length, o.w * o.h * 3, 'color map sai cỡ');
  const v = FP.PROFILES.flow_veo;
  assert.equal(FP.bytes(v.mask).length, Math.ceil((v.w * v.h) / 8), 'mặt nạ sai cỡ');
});

test('alpha Omni KHÔNG chạm 1 — đó là lý do trừ ngược khôi phục được nền', () => {
  // Đo được max 0.682. Nếu có ngày nó chạm 1 thì pixel đó mất sạch thông tin nền và
  // phép chia (out - a·C)/(1-a) sẽ nổ — lúc đó phải chuyển sang vá như Veo.
  const a = FP.bytes(FP.PROFILES.flow_omni.alpha);
  const max = Math.max(...a) / 255;
  assert.ok(max > 0.6 && max < 0.75, `alpha max = ${max.toFixed(3)}, ngoài khoảng đo được`);
});

test('hình sao nằm GIỮA ô, không dính mép — nếu dính là đo lệch vị trí', () => {
  const p = FP.PROFILES.flow_omni, a = FP.bytes(p.alpha);
  const at = (x, y) => a[y * p.w + x];
  for (let i = 0; i < p.w; i++) {
    assert.ok(at(i, 0) < 20 && at(i, p.h - 1) < 20, `hàng biên ${i} có alpha — hộp quá chật`);
    assert.ok(at(0, i) < 20 && at(p.w - 1, i) < 20, `cột biên ${i} có alpha — hộp quá chật`);
  }
  // Ruột sao đo được ~0.30 (77/255); viền cao hơn vì hình có nét bao. Đừng kỳ vọng ruột đặc.
  assert.ok(at(p.w >> 1, p.h >> 1) > 50, 'tâm ô phải là ruột hình sao');
  assert.ok(Math.max(...a) > at(p.w >> 1, p.h >> 1) * 1.5, 'viền phải đậm hơn ruột');
});

test('Omni: RÌA phải vá, không chỉ trừ — nếu không sẽ còn đường viền', () => {
  // Trừ ngược làm sạch ruột nhưng để lại viền: alpha ở biên bị đo hụt nên rìa trừ lệch, và
  // MẮT bắt cấu trúc dù sai số trung bình đã đạt sàn nhiễu. Đo được 5.66 → 2.91 sau khi vá rìa.
  const o = FP.PROFILES.flow_omni;
  assert.ok(o.band, 'thiếu mặt nạ rìa');
  const b = FP.bytes(o.band);
  let n = 0;
  for (let i = 0; i < o.w * o.h; i++) n += (b[i >> 3] >> (7 - (i & 7))) & 1;
  assert.ok(n > 1800 && n < 2800, `rìa ${n} px — cấu hình thắng đo được 2302`);
  // Ruột KHÔNG được nằm trong mặt nạ: chi tiết thật dưới hình phải giữ bằng trừ ngược,
  // vá cả hình là bôi mất nền thật.
  const mid = ((o.h >> 1) * o.w + (o.w >> 1));
  assert.equal((b[mid >> 3] >> (7 - (mid & 7))) & 1, 0, 'tâm hình bị vá — sẽ mất nền thật');
  const src = read('src/core/WatermarkRemover.js');
  assert.match(src, /if \(p\.band\) _diffuse/, 'chưa nối vá rìa vào nhánh trừ ngược');
  assert.match(src, /function _diffuse\(/, 'phần khuếch tán phải dùng chung 2 nhánh');
});

test('mặt nạ Veo phủ vài trăm px, không phải cả ô', () => {
  const v = FP.PROFILES.flow_veo, m = FP.bytes(v.mask);
  let n = 0;
  for (let i = 0; i < v.w * v.h; i++) n += (m[i >> 3] >> (7 - (i & 7))) & 1;
  assert.ok(n > 300 && n < 900, `phủ ${n} px — chữ "Veo" đo được 618 px`);
  assert.ok(n / (v.w * v.h) < 0.5, 'vá quá nửa ô thì thành bôi nhoè cả góc');
});

test('hình học neo ở góc dưới-phải và co giãn theo cạnh ngắn', () => {
  for (const p of Object.values(FP.PROFILES)) {
    assert.equal(p.ref, 1080, 'phải ghi độ phân giải tham chiếu để runtime nhân tỉ lệ');
    assert.ok(p.right >= 0 && p.bottom >= 0);
    assert.ok(p.w > 0 && p.h > 0);
  }
  // Omni thụt sâu vào trong, Veo sát góc — nhầm hai cái này là xoá trượt hoàn toàn.
  assert.ok(FP.PROFILES.flow_omni.right > 100, 'Omni đo được cách phải 136');
  assert.ok(FP.PROFILES.flow_veo.right < 30, 'Veo đo được cách phải 14');
});

test('giải mã có nhớ — mỗi khung video gọi lại mà decode lại thì thành nghẽn', () => {
  const a = FP.bytes('A_OMNI'), b = FP.bytes('A_OMNI');
  assert.equal(a, b, 'trả về mảng mới mỗi lần = decode lại 24 lần/giây');
});

// ── Mã xoá ───────────────────────────────────────────────────────────────────

test('chỉ đụng đúng ô watermark, phần còn lại nguyên vẹn', () => {
  const src = read('src/core/WatermarkRemover.js');
  const fn = src.slice(src.indexOf('function removeFlowMark('), src.indexOf('function detectFlowMark('));
  // getImageData/putImageData phải giới hạn ở ô, không phải cả khung.
  assert.match(fn, /getImageData\(bx, by, bw, bh\)/, 'đọc cả khung là thừa và chậm');
  assert.match(fn, /putImageData\(img, bx, by\)/, 'ghi lại cả khung sẽ đụng pixel ngoài ô');
  assert.ok(!/getImageData\(0, 0/.test(fn), 'không được đọc toàn khung');
  assert.match(fn, /if \(!pl\) pl = _place/, 'phải dùng được vị trí do bộ dò tìm ra');
  assert.match(fn, /if \(a <= 0\.02\) continue;/, 'phải bỏ qua pixel ngoài hình');
});

test('có DÒ trước khi xoá — áp nhầm hồ sơ là phá vùng sạch', () => {
  const src = read('src/core/WatermarkRemover.js');
  assert.match(src, /function detectFlowMark/, 'thiếu bộ dò');
  assert.match(src, /best\.score >= 0\.35/, 'thiếu ngưỡng tin cậy → luôn xoá dù không có dấu');
  const inj = read('content_scripts/watermark-inject.js');
  // Watermark hiện dần ở đầu clip: dò trượt khung đầu mà kết luận luôn là bỏ sót cả video
  // (đo được: khung 1 của một mẫu Veo không dò ra, khung sau thì ra).
  assert.match(inj, /flowMark === undefined && flowTries < 48/, 'phải thử lại vài khung');
  assert.match(inj, /else if \(flowTries >= 48\) flowMark = null;/, 'hết lượt mới được kết luận không có dấu');
  assert.match(inj, /removeFlowMark\(ctx, cw, ch, flowMark, flowPlace\)/, 'chưa nối vào vòng lặp khung');
  assert.ok(/detectFlowMark[\s\S]{0,400}?removeFlowMark/.test(inj), 'dò phải chạy TRƯỚC xoá');
});

test('hồ sơ được nạp TRƯỚC engine ở mọi nơi dùng', () => {
  const m = JSON.parse(read('manifest.json'));
  for (const cs of m.content_scripts) {
    const js = cs.js || [];
    if (!js.includes('src/core/WatermarkRemover.js')) continue;
    assert.ok(js.includes('src/core/FlowWatermarkProfiles.js'), 'content script thiếu hồ sơ');
    assert.ok(js.indexOf('src/core/FlowWatermarkProfiles.js') < js.indexOf('src/core/WatermarkRemover.js'));
  }
  const html = read('pages/watermark-tool.html');
  assert.ok(html.indexOf('FlowWatermarkProfiles.js') < html.indexOf('WatermarkRemover.js'));
});

test('bộ dò TỰ tìm tỉ lệ — không bắt người dùng thử video 720p rồi báo lại', () => {
  // Mẫu đo đều ở 1080 nên không biết chắc Flow vẽ dấu cỡ cố định hay co theo khung.
  // Máy thử được cả hai giả thiết thì đừng đẩy việc kiểm tra sang người dùng.
  const src = read('src/core/WatermarkRemover.js');
  const fn = src.slice(src.indexOf('function detectFlowMark('));
  assert.match(fn, /var SCALES = \[prop, 1,/, 'thiếu tìm kiếm theo tỉ lệ');
  assert.match(fn, /score: r, place: pl/, 'bộ dò phải trả về CHỖ ĐẶT, không chỉ điểm khớp');
  assert.match(src, /function _place\(/, 'thiếu hàm tính chỗ đặt dùng chung');
  // Ở 1080 thì prop = 1 nên các ứng viên trùng nhau — không đổi hành vi đã kiểm chứng.
  assert.match(src, /prop = Math\.min\(w, h\) \/ p0ref/);
});

test('file hồ sơ GHI LẠI cách đo và số liệu kiểm chứng', () => {
  // Không ghi thì lần sau không ai biết mấy con số này ở đâu ra, có đáng tin không.
  const src = read('src/core/FlowWatermarkProfiles.js');
  assert.match(src, /624 khung/, 'thiếu cỡ mẫu');
  assert.match(src, /SÀN NHIỄU|sàn nhiễu/, 'thiếu mốc kiểm chứng');
  assert.match(src, /H\.264/, 'thiếu lý do vì sao Veo phải vá thay vì trừ');
});
