// Chống TRÔI config: GrokConfig/ChatGPTConfig._LOCAL_DEFAULTS từng thiếu pattern so với
// ProviderConfigManager._LOCAL_API_CONFIGS (cùng dữ liệu, 2 nơi). Test khoá để không tái diễn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');

function load() {
  const g = {}; g.self = g; g.window = g;
  for (const f of ['src/core/ProviderConfigManager.js', 'src/core/GrokConfig.js', 'src/core/ChatGPTConfig.js']) {
    new Function('self', 'window', read(f))(g, g);
  }
  return g;
}

test('⭐ Grok: pattern content script cần ĐỀU có (không còn "notLoggedIn empty")', () => {
  const p = load().GrokConfig._localPatterns();
  for (const k of ['not_logged_in_text', 'subscription_required_text', 'rate_limit_text', 'content_blocked_text', 'network_error_text', 'cloudflare_challenge_text']) {
    assert.ok(p[k], 'thiếu pattern: ' + k);
  }
});

test('⭐ ChatGPT: pattern content script cần ĐỀU có', () => {
  const p = load().ChatGPTConfig._localPatterns();
  for (const k of ['not_logged_in_text', 'text_only_pattern', 'content_blocked_text', 'network_error_text']) {
    assert.ok(p[k], 'thiếu pattern: ' + k);
  }
});

test('không TRÔI: mọi error_pattern trong PCM phải có mặt sau khi gộp', () => {
  const g = load();
  const pcm = g.ProviderConfigManager._LOCAL_API_CONFIGS;
  const pairs = [['grok', g.GrokConfig], ['chatgpt', g.ChatGPTConfig]];
  for (const [name, M] of pairs) {
    const src = pcm[name]?.configs?.error_patterns || {};
    const merged = M._localPatterns();
    for (const k of Object.keys(src)) {
      assert.ok(merged[k], name + ' thiếu "' + k + '" sau khi gộp — config đã trôi trở lại');
    }
  }
});

test('gộp chỉ BỔ SUNG, không xoá pattern chép tay sẵn có', () => {
  const g = load();
  for (const M of [g.GrokConfig, g.ChatGPTConfig]) {
    const before = Object.keys(M._LOCAL_DEFAULTS);
    const after = Object.keys(M._localPatterns());
    for (const k of before) assert.ok(after.includes(k), 'mất pattern gốc: ' + k);
    assert.ok(after.length >= before.length);
  }
});

test('thiếu ProviderConfigManager → vẫn trả bản chép tay, KHÔNG throw', () => {
  const g = {}; g.self = g; g.window = g;
  new Function('self', 'window', read('src/core/GrokConfig.js'))(g, g);
  assert.doesNotThrow(() => g.GrokConfig._localPatterns());
  assert.deepEqual(Object.keys(g.GrokConfig._localPatterns()).sort(), Object.keys(g.GrokConfig._LOCAL_DEFAULTS).sort());
});

test('pattern Grok khớp thực tế modal đòi Premium', () => {
  const p = load().GrokConfig._localPatterns();
  const re = new RegExp(p.subscription_required_text, 'i');
  assert.ok(re.test('Unlock your creativity with Imagine'), 'không bắt được modal Premium thật');
});

test('pattern not-logged-in bắt được cả tiếng Việt lẫn tiếng Anh', () => {
  const g = load();
  for (const M of [g.GrokConfig, g.ChatGPTConfig]) {
    const re = new RegExp(M._localPatterns().not_logged_in_text, 'i');
    assert.ok(re.test('Sign in to continue'), 'không bắt được "Sign in"');
    assert.ok(re.test('Vui lòng đăng nhập'), 'không bắt được "đăng nhập"');
  }
});
