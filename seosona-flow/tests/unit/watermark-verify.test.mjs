// HẬU KIỂM sau khi xoá watermark.
// Ta đã có TIỀN kiểm (LOW_CONFIDENCE: không chắc thì không đụng). Thiếu vế còn lại:
// xoá xong có sạch không. Không đo thì người dùng nhận ảnh còn vệt mà tưởng đã xong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const root = {};
new Function('window', read('src/core/WatermarkVerify.js'))(root);
const WV = root.WatermarkVerify;

// Hình dạng watermark giả: 16 điểm, logo nằm ở 4 điểm giữa.
const ALPHA = [0, 0, 0, 0, 0, 0.8, 0.9, 0, 0, 0.9, 0.8, 0, 0, 0, 0, 0];
const flat = (v = 100) => new Array(16).fill(v);

test('ncc: hai mảng giống hệt → 1', () => {
  assert.ok(Math.abs(WV.ncc([1, 2, 3, 4], [1, 2, 3, 4]) - 1) < 1e-9);
});

test('ncc: ngược pha → −1; không liên quan → gần 0', () => {
  assert.ok(Math.abs(WV.ncc([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-9);
  assert.ok(Math.abs(WV.ncc([1, 2, 1, 2], [1, 1, 2, 2])) < 0.5);
});

test('ncc MIỄN NHIỄM độ sáng/tương phản — nên một ngưỡng dùng được cho mọi ảnh', () => {
  const a = [10, 20, 30, 40];
  const sang = a.map((x) => x + 500);        // nền sáng hơn
  const tuongPhan = a.map((x) => x * 7);     // tương phản mạnh hơn
  assert.ok(Math.abs(WV.ncc(a, sang) - 1) < 1e-9);
  assert.ok(Math.abs(WV.ncc(a, tuongPhan) - 1) < 1e-9);
});

test('ncc: một bên PHẲNG → 0, không phải 1', () => {
  // Trả 1 ở đây sẽ biến mọi vùng đồng màu thành "còn watermark" — báo hỏng oan hàng loạt.
  assert.equal(WV.ncc([5, 5, 5, 5], [1, 2, 3, 4]), 0);
  assert.equal(WV.ncc([1, 2, 3, 4], [7, 7, 7, 7]), 0);
});

test('ncc: đầu vào lệch độ dài / rỗng → 0, không ném', () => {
  assert.equal(WV.ncc([1, 2], [1, 2, 3]), 0);
  assert.equal(WV.ncc([], []), 0);
  assert.equal(WV.ncc(null, null), 0);
});

test('residual: trừ trung bình để bỏ nền phẳng, chỉ giữ cấu trúc', () => {
  assert.deepEqual(WV.residual([1, 2, 3]), [-1, 0, 1]);
  assert.deepEqual(WV.residual([9, 9, 9]), [0, 0, 0], 'nền phẳng thì không còn cấu trúc');
  assert.deepEqual(WV.residual([]), []);
});

// ── Phán quyết ───────────────────────────────────────────────────────────────

test('xoá SẠCH (vùng phẳng) → clean', () => {
  const r = WV.check(flat(120), ALPHA);
  assert.equal(r.verdict, 'clean');
  assert.equal(r.ok, true);
  assert.ok(r.score < 0.2);
});

test('watermark CÒN NGUYÊN → failed, và nói rõ đừng dùng ảnh', () => {
  // Vùng sau khi "xoá" vẫn mang đúng hình dạng alpha.
  const after = ALPHA.map((a) => 120 + a * 100);
  const r = WV.check(after, ALPHA);
  assert.equal(r.verdict, 'failed');
  assert.equal(r.ok, false);
  assert.match(r.message, /đừng dùng ảnh này/);
  assert.ok(r.score > 0.9);
});

test('vệt MỜ → faint: vẫn ok nhưng bảo người dùng xem kỹ', () => {
  // Trộn hình dạng alpha rất nhạt vào nhiễu → tương quan ở khoảng giữa.
  const noise = [3, -7, 5, -2, 8, -4, 1, 6, -8, 2, -3, 7, -5, 4, -1, 0];
  const after = ALPHA.map((a, i) => 120 + a * 6 + noise[i]);
  const r = WV.check(after, ALPHA, { warnAbove: 0.15, failAbove: 0.85 });
  assert.equal(r.verdict, 'faint');
  assert.equal(r.ok, true, 'mờ thì vẫn cho dùng, chỉ cảnh báo');
});

test('vệt còn lại TỐI hơn nền cũng bị bắt (xoá hụt theo chiều ngược)', () => {
  const after = ALPHA.map((a) => 120 - a * 100);   // ngược dấu
  const r = WV.check(after, ALPHA);
  assert.equal(r.verdict, 'failed', 'dấu không quan trọng — vệt là vệt');
});

test('ngưỡng chỉnh được (nới ra thì cùng ảnh đó hết bị coi là hỏng)', () => {
  const after = ALPHA.map((a) => 120 + a * 100);   // tương quan ≈ 1.0
  assert.equal(WV.check(after, ALPHA).verdict, 'failed', 'ngưỡng mặc định: hỏng');
  // Nới trần lên trên 1.0 thì không còn ca nào vượt được → hạ xuống mức cảnh báo.
  assert.equal(WV.check(after, ALPHA, { failAbove: 1.1 }).verdict, 'faint');
  assert.equal(WV.check(after, ALPHA, { failAbove: 1.1, warnAbove: 1.05 }).verdict, 'clean');
  // Siết chặt thì đến vùng phẳng cũng bị coi là hỏng — chứng tỏ ngưỡng thật sự có tác dụng.
  assert.equal(WV.check(flat(120), ALPHA, { warnAbove: -1, failAbove: -1 }).verdict, 'failed');
});

test('thiếu dữ liệu → failed + nói rõ KHÔNG ĐO ĐƯỢC (khác với "còn watermark")', () => {
  const r = WV.check(null, ALPHA);
  assert.equal(r.verdict, 'failed');
  assert.match(r.message, /Không đo được/);
  assert.equal(WV.check([1, 2], ALPHA).verdict, 'failed');
});

test('mặc định thà báo oan còn hơn báo sạch nhầm', () => {
  // Người dùng xem lại ảnh là biết ngay báo oan; còn báo sạch nhầm thì họ đem đi dùng
  // rồi mới phát hiện — sửa lúc đó đắt hơn nhiều.
  assert.ok(WV.DEFAULTS.failAbove <= 0.5, 'ngưỡng hỏng không được nới quá tay');
  assert.ok(WV.DEFAULTS.warnAbove < WV.DEFAULTS.failAbove);
});

// ── So trước/sau ─────────────────────────────────────────────────────────────

test('compare: phân biệt "vốn không có watermark" với "có mà xoá không nổi"', () => {
  // Hai ca này nhìn kết quả CUỐI thì giống nhau nhưng xử lý khác hẳn.
  const co = ALPHA.map((a) => 120 + a * 100);
  const khong = flat(120);

  const xoaDuoc = WV.compare(co, khong, ALPHA);
  assert.equal(xoaDuoc.improved, true);
  assert.ok(xoaDuoc.drop > 0.5);

  const vonKhongCo = WV.compare(khong, khong, ALPHA);
  assert.equal(vonKhongCo.improved, false, 'không có gì để xoá thì không thể "cải thiện"');

  const xoaKhongNoi = WV.compare(co, co, ALPHA);
  assert.equal(xoaKhongNoi.improved, false);
  assert.ok(xoaKhongNoi.after > 0.9, 'sau vẫn cao = còn nguyên');
});

// ── Gom công cụ vào tab Tools + nối dây ──────────────────────────────────────

test('tab Tools có thẻ cho 3 công cụ trước đây nằm rải ở header', () => {
  const html = read('pages/sidebar.html');
  for (const id of ['toolsWatermarkBtn', 'toolsTextOverlayBtn', 'toolsStyleAnchorBtn']) {
    assert.ok(html.includes(`id="${id}"`), `lưới Tools thiếu ${id}`);
  }
});

test('mỗi công cụ có NHIỀU điểm vào và không nơi nào bị bỏ sót', () => {
  const src = read('src/prompts/GenTab.js');
  // Nút header cũ vẫn giữ để không phá thói quen người đang dùng.
  assert.match(src, /_bindTool\(\['headerWatermarkBtn', 'toolsWatermarkBtn'\]/);
  assert.match(src, /_bindTool\(\['toolsTextOverlayBtn'\]/);
  assert.match(src, /_bindTool\(\['toolsStyleAnchorBtn'\]/);
});

test('gom khối mở cửa sổ về MỘT chỗ (trước đây mỗi công cụ chép lại)', () => {
  const src = read('src/prompts/GenTab.js');
  assert.match(src, /const _openToolWindow = \(page, w, h\)/);
  // Chép lại khối try/catch 3 tầng ở mỗi công cụ là chỗ sinh lỗi khi sửa cách mở.
  const n = (src.match(/chrome\.windows\.create\(\{ url/g) || []).length;
  assert.ok(n <= 2, `còn ${n} chỗ tự gọi windows.create — nên đi qua _openToolWindow`);
});

test('thẻ Tools có nhãn + mô tả i18n ở CẢ vi và en', () => {
  const load = (f, name) => { const sb = {}; sb.window = sb; new Function('window', read(f))(sb); return sb[name]; };
  const vi = load('src/i18n/vi.js', 'I18N_VI');
  const en = load('src/i18n/en.js', 'I18N_EN');
  for (const k of ['tools.watermark', 'tools.watermarkDesc', 'tools.textOverlay', 'tools.styleAnchor']) {
    assert.ok(vi[k] && vi[k].trim(), `vi thiếu ${k}`);
    assert.ok(en[k] && en[k].trim(), `en thiếu ${k}`);
  }
});

test('trang công cụ nạp WatermarkVerify SAU WatermarkRemover', () => {
  const html = read('pages/watermark-tool.html');
  assert.ok(html.indexOf('WatermarkRemover.js') < html.indexOf('WatermarkVerify.js'));
});
