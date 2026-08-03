// Công cụ Tools cho phép người dùng TỰ upload file để dùng riêng hai engine, không phụ thuộc
// đường tải tự động. Test khoá: dùng CHUNG engine (không chép đôi), và không hứa quá lời.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const js = read('scripts/metadata-tool.js');
const html = read('pages/metadata-tool.html');

test('dùng CHUNG MetadataScrubber, không tự viết lại logic cắt', () => {
  // Hai bản logic cắt container = chắc chắn lệch nhau, và bản lệch đó làm hỏng file người dùng.
  assert.match(js, /window\.MetadataScrubber/, 'chưa dùng engine chung');
  assert.match(js, /MS\.scrub\(buf, \{ remove: remove \}\)/, 'phải gọi thẳng engine');
  assert.ok(!/0xFF, 0xD8|tEXt|RIFF/.test(js), 'công cụ tự duyệt container = chép đôi logic');
});

test('nạp engine TRƯỚC script công cụ', () => {
  assert.ok(html.indexOf('MetadataScrubber.js') < html.indexOf('metadata-tool.js'),
    'nạp sau thì window.MetadataScrubber là undefined lúc script chạy');
});

test('cho chọn theo NHÓM, mỗi nhóm kèm lý do', () => {
  // Người dùng phải tự quyết được cái gì đáng giữ, nên phải thấy VÌ SAO nhóm đó riêng tư.
  assert.match(js, /Object\.keys\(MS\.CATEGORIES\)/, 'phải lấy nhóm từ engine, không ghi cứng');
  assert.match(js, /title="' \+ c\.why/, 'thiếu lý do trên ô tick');
  assert.match(js, /if \(items\.length\) run\(\);/, 'đổi lựa chọn phải xử lý lại ngay');
});

test('giữ NGUYÊN tên và đuôi file khi lưu', () => {
  // Vẫn là đúng file đó, chỉ bỏ phần mô tả — đổi tên/đuôi là gây nhầm cho người dùng.
  assert.match(js, /a\.download = it\.file\.name/, 'không được đổi tên file');
  assert.match(js, /revokeObjectURL/, 'rò blob URL');
});

test('định dạng lạ → BÁO RÕ là giữ nguyên, không lặng lẽ bỏ qua', () => {
  assert.match(js, /Định dạng không nhận dạng được → giữ nguyên file, không sửa mù/);
  assert.match(js, /badge skip/, 'phải có nhãn riêng cho ca này');
});

test('NÓI THẲNG giới hạn: không gỡ được dấu AI', () => {
  // Thiếu câu này thì người dùng tưởng file đã "sạch hoàn toàn" và tin nhầm khi đăng lên mạng.
  assert.match(html, /SynthID/, 'thiếu cảnh báo về watermark trong pixel');
  assert.match(html, /không.{0,40}gỡ được/is, 'phải nói rõ là KHÔNG gỡ được nhãn AI');
});

test('nói đúng về chất lượng: ảnh không nén lại, video không đổi độ dài', () => {
  assert.match(html, /không nén lại|không giảm chất lượng/, 'thiếu điểm mấu chốt của engine');
  assert.match(html, /độ dài file không đổi/, 'thiếu giải thích cách xử lý video');
});

test('có tile trong Tools và nút được nối cửa sổ', () => {
  assert.match(read('pages/sidebar.html'), /id="toolsMetadataBtn"/, 'thiếu tile');
  assert.match(read('src/prompts/GenTab.js'), /_bindTool\(\['toolsMetadataBtn'\], 'pages\/metadata-tool\.html'/, 'nút không mở gì');
});

test('công cụ watermark dùng được hồ sơ ĐO THẬT khi upload', () => {
  // Engine đo từ video thật mà chỉ chạy ở đường tự động thì người dùng không xoá tay được.
  const wt = read('scripts/watermark-tool.js');
  assert.match(wt, /SRC\.method === 'profile'/, 'chưa xử lý hồ sơ đo thật');
  assert.match(wt, /removeFlowMark\(ctx, cw, ch, SRC\.profile\)/, 'chọn nguồn thủ công không dùng hồ sơ');
  assert.match(wt, /detectFlowMark\(ctx, cw, ch\)/, 'chế độ Tự động phải thử hồ sơ Flow trước');
});

// ── Công tắc nổi trên thanh Gen (học UX từ sản phẩm cùng ngách) ───────────────

test('công tắc nằm NGAY trên thanh Gen, không chỉ chôn trong Settings', () => {
  // Chôn trong Settings thì người dùng không biết file vừa tải đã được xử lý hay chưa.
  const sb = read('pages/sidebar.html');
  assert.match(sb, /id="genTabWmVideo"/, 'thiếu công tắc watermark trên thanh Gen');
  assert.match(sb, /id="genTabScrubMeta"/, 'thiếu công tắc metadata trên thanh Gen');
  // Phải đặt cạnh chọn độ phân giải — cùng một chỗ người dùng đang nhìn khi gen.
  assert.ok(sb.indexOf('genTabVideoDownloadResolution') < sb.indexOf('genTabWmVideo'));
});

test('công tắc nổi và ô tick Settings dùng CHUNG khoá lưu', () => {
  // Hai nguồn sự thật thì chắc chắn lệch, và người dùng thấy hai chỗ nói khác nhau.
  const sm = read('src/core/SidebarManager.js');
  assert.match(sm, /'#genTabWmVideo': \{ key: 'autoRemoveVideoWatermark'/);
  assert.match(sm, /'#genTabScrubMeta': \{ key: 'scrubMetadata'/);
  assert.match(read('scripts/settings-page.js'), /autoRemoveVideoWatermark: els\.autoWmVideo/);
});

test('công tắc KHÔNG được nói dối khi chưa có khoá lưu', () => {
  // Nơi đọc dùng `!== false` (thiếu khoá = BẬT). Nếu đồng bộ dùng `!!undefined` thì công
  // tắc hiện TẮT trong khi tính năng đang chạy — tệ hơn không có công tắc.
  const sm = read('src/core/SidebarManager.js');
  assert.match(sm, /defaultOn: true/, 'thiếu cờ mặc-định-bật');
  assert.match(sm, /entry\.defaultOn \? settings\[entry\.key\] !== false : !!settings\[entry\.key\]/);
  assert.match(sm, /settings\[entry\.key\] === undefined && !entry\.defaultOn/, 'thiếu khoá vẫn phải áp mặc định');
});
