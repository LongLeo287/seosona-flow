// Gemini sinh ảnh — nối dây phần đã có bộ chọn nhưng chưa có mã.
//
// Bộ chọn generated_image / tools_image_gen_item / tools_button / image_preview đã nằm trong
// config từ trước, chỉ chưa ai gọi tới. Đây là việc nối, không phải dò DOM từ đầu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const gem = read('content_scripts/chat-content-gemini.js');

// Lấy ĐÚNG thân handler. Cắt theo số ký tự cố định thì ăn sang handler kế bên và test nói dối.
function handlerBody() {
  const i = gem.indexOf("message.action === 'gemini:generateImage'");
  const j = gem.indexOf('      return true;', i);
  return gem.slice(i, j);
}

test('positive: có handler gemini:generateImage', () => {
  assert.match(gem, /message\.action === 'gemini:generateImage'/);
  assert.match(gem, /function _enableGeminiImageMode/);
  assert.match(gem, /function _waitForGeminiImages/);
  assert.match(gem, /function _collectNewGeminiImages/);
});

// Bỏ bước bật chế độ là Gemini trả CHỮ mô tả ảnh — hỏng mà rất khó nhận ra.
test('positive: BẬT chế độ tạo ảnh TRƯỚC khi gửi prompt', () => {
  const body = handlerBody();
  assert.ok(body.indexOf('_enableGeminiImageMode') < body.indexOf('insertText'),
    'bật chế độ phải đứng trước lúc chèn prompt');
  assert.match(body, /IMAGE_MODE_NOT_FOUND/, 'không bật được thì báo rõ, không gửi bừa');
  assert.match(body, /Chẩn đoán selector/, 'chỉ đúng công cụ để sửa khi Gemini đổi giao diện');
});

// Đã bật rồi mà bấm nữa là TẮT — và Gemini vẫn trả lời bình thường nên rất khó thấy.
test('regression: đã bật sẵn thì KHÔNG bấm lại', () => {
  const i = gem.indexOf('function _enableGeminiImageMode');
  const body = gem.slice(i, i + 1200);
  assert.match(body, /aria-pressed.*true|is-selected/,
    'phải kiểm trạng thái trước; bấm lần nữa là tắt mất');
  assert.match(body, /return true;/);
});

// Không chụp mốc thì lần chạy thứ hai nhặt lại ảnh của lần một.
test('regression: chụp mốc ảnh CŨ trước khi gửi', () => {
  const body = handlerBody();
  const iBefore = body.indexOf('const before = new Set()');
  assert.ok(iBefore > 0, 'phải có mốc ảnh cũ');
  assert.ok(iBefore < body.indexOf('clickSubmit'), 'mốc phải chụp TRƯỚC khi gửi');
});

test('regression: KHÔNG chèn enhancePrefix — nó bắt model trả chữ', () => {
  const body = handlerBody();
  assert.ok(!/getEnhancePrefix/.test(body),
    'prefix đó dùng cho đường sinh CHỮ; ở đây nó phá đúng thứ ta cần');
  assert.match(body, /insertText\(message\.text \|\| ''\)/, 'gửi prompt nguyên văn');
});

// Hai bẫy thật khi chờ ảnh.
test('regression: bỏ qua ảnh mờ tạm thời và chờ thêm nhịp yên tĩnh', () => {
  const i = gem.indexOf('function _collectNewGeminiImages');
  const body = gem.slice(i, i + 700);
  assert.match(body, /naturalWidth && im\.naturalWidth < 64/,
    'Gemini hiện ảnh mờ trước — phải đòi kích thước thật');

  const j = gem.indexOf('function _waitForGeminiImages');
  const wait = gem.slice(j, j + 1400);
  assert.match(wait, /stableSince/, 'ảnh hiện dần từng cái — dừng ở cái đầu là mất các cái sau');
  assert.match(wait, /isGeminiAbort\(\)/, 'phải tôn trọng lệnh dừng');
});

test('regression: cờ năng lực và action đã đăng ký', () => {
  const cfg = read('src/core/ProviderConfigManager.js');
  const i = cfg.indexOf('"gemini":{"config_version"');
  const blk = cfg.slice(i, i + 4000);
  const j = blk.indexOf('"supports":{');
  const sup = blk.slice(j, blk.indexOf('}', j) + 1);
  assert.match(sup, /"image_mode":true/, 'Gemini nay sinh ảnh được');
  assert.match(sup, /"auto_download":true/, 'và tải về được');

  const scope = {};
  new Function('self', read('src/core/PrivilegedActionRegistry.js'))(scope);
  assert.equal(scope.SEOSONA_PrivilegedActionRegistry.isKnown('gemini:generateImage'), true,
    'chưa đăng ký thì cổng bảo mật chặn ngay — registry nay mặc định enforce');
});

test('boundary: mọi nhánh hỏng đều trả mã lỗi riêng, không im lặng', () => {
  const body = handlerBody();
  for (const code of ['CHALLENGE_TIMEOUT', 'IMAGE_MODE_NOT_FOUND', 'REF_UPLOAD_FAILED',
    'INSERT_FAILED', 'SEND_BUTTON_NOT_FOUND', 'NO_IMAGE', 'EXCEPTION']) {
    assert.ok(body.includes(code), `thiếu mã lỗi ${code}`);
  }
});
