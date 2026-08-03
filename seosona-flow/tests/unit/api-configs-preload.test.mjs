// Preload api-configs: content.js lấy thẳng ProviderConfigManager._LOCAL_API_CONFIGS khi
// storage chưa kịp prime (đua thời điểm giữa 2 file trong cùng content script).
//
// Rủi ro thật của bản vá đó là HÌNH DẠNG: nếu _LOCAL_API_CONFIGS không đúng shape mà
// _getApiConfigValue() mong đợi thì vá xong vẫn trả null — mà KHÔNG còn cảnh báo nào để biết.
// Các test dưới khoá đúng hợp đồng shape đó.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(join(PKG, 'src/core/ProviderConfigManager.js'), 'utf8');

/** Bóc _LOCAL_API_CONFIGS ra khỏi source mà không cần chạy cả module (nó cần chrome.*). */
function localApiConfigs() {
  const m = SRC.match(/static _LOCAL_API_CONFIGS = (\{[\s\S]*?\});\n/);
  assert.ok(m, 'phải tìm thấy _LOCAL_API_CONFIGS trong ProviderConfigManager.js');
  return JSON.parse(m[1]);
}

/** Bản sao ĐÚNG cách _getApiConfigValue() truy cập (content.js). */
const read = (cache, provider, key) => cache?.data?.[provider]?.configs?.[key] || null;

test('⭐ shape khớp đường đọc của _getApiConfigValue(): data[provider].configs[key]', () => {
  const cache = { data: localApiConfigs() };   // đúng cách content.js gán khi vá
  assert.ok(read(cache, 'flow', 'download_resolutions'), 'flow.download_resolutions phải đọc được');
  assert.ok(read(cache, 'flow', 'ratios'), 'flow.ratios phải đọc được');
  assert.ok(read(cache, 'flow', 'error_patterns'), 'flow.error_patterns phải đọc được');
  assert.equal(read(cache, 'flow', 'khong_ton_tai'), null, 'key lạ vẫn phải trả null');
});

test('đủ 4 provider, mỗi cái có khối configs', () => {
  const c = localApiConfigs();
  for (const p of ['flow', 'chatgpt', 'grok', 'gemini']) {
    assert.ok(c[p], p + ' phải có trong _LOCAL_API_CONFIGS');
    assert.equal(typeof c[p].configs, 'object', p + '.configs phải là object');
  }
});

test('⭐ endpoint credits có trong config — đúng cái flow-credits-bridge nghe ké', () => {
  const ep = localApiConfigs().flow.configs.api_endpoints;
  assert.equal(ep.credits, '/v1/credits');
  assert.equal(ep.base_url, 'https://aisandbox-pa.googleapis.com');
  // Cầu lọc theo /\/v1\/credits(\?|$)/ — nếu ai đổi đường dẫn ở đây mà quên sửa cầu thì
  // số dư sẽ im lặng ngừng cập nhật. Test này bắt được lệch đó.
  assert.match(ep.base_url + ep.credits, /\/v1\/credits$/);
});

test('download_resolutions của Flow có đủ chuỗi fallback (thứ Tier3 dùng)', () => {
  const dr = localApiConfigs().flow.configs.download_resolutions;
  assert.ok(Array.isArray(dr.image) && dr.image.length, 'image phải là mảng không rỗng');
  assert.ok(Array.isArray(dr.video_fallback_chain) && dr.video_fallback_chain.length);
});
