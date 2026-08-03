// Gate ĐỘC LẬP — giữ ranh giới "học hỏi ≠ sao chép".
//
// Hai sản phẩm cùng ngách đạt tốc độ bằng cách bắt OAuth bearer, giả Origin/Referer để
// endpoint riêng của Google chấp nhận request, và tự giải reCAPTCHA. Nhanh hơn thật —
// đổi lại người dùng bị gắn cờ phiên, mà đó là thứ không sửa được bằng code.
// SEOSONA chọn lái giao diện; gate này chống việc lựa chọn đó bị xói mòn từng chút một.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, RULES } from '../../scripts/security/scan-independence.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');

test('mã sản phẩm hiện tại: 0 vi phạm', () => {
  const hits = scan();
  assert.deepEqual(hits, [], hits.map((h) => `${h.file}:${h.line} [${h.rule}]`).join('\n'));
});

test('phủ đủ 6 nhóm rủi ro, mỗi luật đều GIẢI THÍCH vì sao', () => {
  const ids = RULES.map((r) => r.id).sort();
  assert.deepEqual(ids, [
    'bearer-interception', 'captcha-solving', 'comparator-extension-id',
    'comparator-protocol', 'origin-spoof', 'private-gen-endpoint',
  ]);
  // Luật không kèm lý do thì người sau sẽ tưởng là quy định tuỳ tiện rồi tự bỏ.
  for (const r of RULES) assert.ok(r.why && r.why.length > 40, `${r.id} thiếu lý do`);
});

// Từng luật phải BẮT được mẫu vi phạm thật (lấy từ gói comparator đã đọc).
const VIOLATIONS = {
  'bearer-interception': "chrome.webRequest.onBeforeSendHeaders.addListener(fn, {urls:['<all_urls>']}, ['requestHeaders'])",
  'origin-spoof': '{ "header": "Referer", "operation": "set", "value": "https://labs.google/" }',
  'captcha-solving': 'const tok = await grecaptcha.enterprise.execute(SITE_KEY, { action: a });',
  'private-gen-endpoint': "fetch('https://aisandbox-pa.googleapis.com/v1/flowMedia:batchGenerateImages', o)",
  // Ghép từ mảnh: tests/governance/product-independence.test.mjs CẤM các literal này xuất
  // hiện ở bất kỳ đâu trong cây sản phẩm, kể cả trong test.
  'comparator-extension-id': 'externallyConnectable: ["' + ['iicjfgdnngmpfocf', 'anpiammedafmomin'].join('') + '"]',
  'comparator-protocol': "window.dispatchEvent(new CustomEvent('" + ['TOBY', 'BRIDGE_GET_CAPTCHA'].join('') + "'))",
};

for (const [id, sample] of Object.entries(VIOLATIONS)) {
  test(`luật "${id}" bắt được mẫu vi phạm thật`, () => {
    const rule = RULES.find((r) => r.id === id);
    assert.ok(rule.re.test(sample), `không bắt: ${sample}`);
  });
}

test('KHÔNG bắt nhầm: đọc số dư credit là hợp lệ (chỉ GET, không sinh gì)', () => {
  const rule = RULES.find((r) => r.id === 'private-gen-endpoint');
  assert.equal(rule.re.test("fetch('https://aisandbox-pa.googleapis.com/v1/credits')"), false,
    'đọc số dư khác hẳn gọi endpoint sinh nội dung');
});

test('KHÔNG bắt nhầm dòng chú thích', () => {
  const dir = mkdtempSync(join(tmpdir(), 'indep-'));
  const f = join(dir, 'x.js');
  writeFileSync(f, '// Gen đi qua aisandbox-pa.googleapis.com/.../flowMedia:batchGenerateImages (chỉ quan sát)\n');
  // Chặn cả chú thích thì người ta sẽ xoá lời giải thích chứ không xoá code — phản tác dụng.
  const rule = RULES.find((r) => r.id === 'private-gen-endpoint');
  const line = readFileSync(f, 'utf8').split('\n')[0];
  assert.ok(rule.re.test(line), 'regex vẫn khớp nội dung...');
  assert.match(read('scripts/security/scan-independence.mjs'), /\^\\s\*\(\\\/\\\/\|\\\*\|\\\/\\\*\)/,
    '...nhưng scan phải bỏ qua dòng chú thích thuần');
});

test('có lối miễn trừ tường minh cho ca hợp lệ hiếm', () => {
  assert.match(read('scripts/security/scan-independence.mjs'), /independence-scan:allow/);
});

test('KHÔNG quét tests/scripts/docs — nơi được phép mô tả pattern để phân tích', () => {
  const src = read('scripts/security/scan-independence.mjs');
  for (const d of ['tests/', 'scripts/', 'docs/']) {
    assert.ok(src.includes(`}${d}\``) || src.includes(`${d}\``), `chưa loại trừ ${d}`);
  }
  // Chính file test này chứa đầy mẫu vi phạm — nếu quét cả tests/ thì gate tự bắn vào chân.
  assert.deepEqual(scan(), []);
});

test('gate nằm trong security:verify (không phải script mồ côi)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['security:verify'], /security:independence/);
  assert.ok(pkg.scripts['security:independence']);
});
