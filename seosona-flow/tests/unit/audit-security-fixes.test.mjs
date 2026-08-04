// SF-002 / SF-011 / SF-018 — ba vá bảo mật từ báo cáo audit 2026-08-04.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(join(root, f), 'utf8');

// SF-002 — shadow root mở + base64 ảnh gốc trong DOM của MỌI website.
test('SF-002: shadow root ĐÓNG, trang chủ không đọc được', () => {
  const i2p = read('content_scripts/i2p-content.js');
  assert.ok(i2p.includes("attachShadow({ mode: 'closed' })"), 'shadow root phải đóng');
  assert.ok(!i2p.includes("attachShadow({ mode: 'open' })"), 'không còn mode open');
  // Với mode 'closed', host.shadowRoot là null → đoạn tái dùng cũ không còn đúng, phải giữ _shadow.
  assert.ok(!/if \(host && host\.shadowRoot\) \{ _shadow = host\.shadowRoot/.test(i2p),
    'không còn lấy lại shadow qua host.shadowRoot (luôn null khi closed)');
});

test('SF-002: chỉ bản thu nhỏ vào DOM, không bao giờ là ảnh gốc', () => {
  const i2p = read('content_scripts/i2p-content.js');
  // Đoạn dựng thumbnail cho thẻ <img> không được nội suy base64 ảnh gốc nữa.
  assert.ok(!/const thumb = _state\?\.image \? `data:\$\{_state\.image\.type/.test(i2p),
    'không nhét _state.image.base64 vào src');
  assert.match(i2p, /const thumb = _state\?\.thumb \|\| '';/, 'chỉ dùng _state.thumb');
  // Và thumb phải thực sự được tạo, nếu không ô xem trước trống trơn.
  const thumbAssigns = (i2p.match(/_state\.thumb = /g) || []).length;
  assert.ok(thumbAssigns >= 3, `phải đặt _state.thumb ở cả các đường vào ảnh, thấy ${thumbAssigns}`);
  assert.match(i2p, /makeThumb\(img\.base64, img\.type\)/, 'đường upload có dựng thumb');
});

// SF-011 — registry khởi tạo fail-open rồi mới đọc storage bất đồng bộ để bật.
test('SF-011: registry mặc định ĐANG enforce, không fail-open lúc khởi động', () => {
  const scope = {};
  new Function('self', read('src/core/PrivilegedActionRegistry.js'))(scope);
  const R = scope.SEOSONA_PrivilegedActionRegistry;
  assert.equal(R.isEnforcing(), true, 'mặc định phải BẬT');
  assert.equal(R.guard({ action: '__khong_ton_tai__' }, {}).block, true, 'action lạ bị chặn ngay');
  assert.equal(R.guard({ action: 'prepareDownloadRename' }, {}).block, false, 'action thật vẫn qua');
});

test('SF-011: tắt tường minh vẫn được tôn trọng', () => {
  const scope = {};
  new Function('self', read('src/core/PrivilegedActionRegistry.js'))(scope);
  const R = scope.SEOSONA_PrivilegedActionRegistry;
  R.setEnforce(false);
  assert.equal(R.isEnforcing(), false);
  assert.equal(R.guard({ action: '__khong_ton_tai__' }, {}).block, false,
    'người dùng tắt ở Settings thì không chặn — đường đọc storage chỉ còn có thể TẮT');
});

// SF-018 — hai danh sách khoá nhạy cảm lệch nhau cả hai chiều.
test('SF-018: SecretVault khớp đúng config/sensitive-keys.json', () => {
  const cfg = JSON.parse(read('config/sensitive-keys.json'));
  const vault = read('src/core/SecretVault.js');
  assert.ok(cfg.keys.length >= 13, 'config phải gom đủ khoá của cả hai nguồn cũ');
  for (const k of cfg.keys) {
    assert.ok(vault.includes(`'${k}'`), `SecretVault phải biết '${k}' — chạy sync-secret-keys.mjs`);
  }
});

test('SF-018: những khoá từng bị bỏ sót nay đều được đánh dấu', () => {
  const cfg = JSON.parse(read('config/sensitive-keys.json'));
  // Chính xác các khoá báo cáo nêu là bị sót ở một trong hai nguồn.
  for (const k of ['seosona_client_enrollment', 'seosona_device_fp', 'telegram_bot_token', 'local_mcp_tokens']) {
    assert.ok(cfg.keys.includes(k), `'${k}' phải nằm trong nguồn chung`);
  }
  // Regex cũ bỏ sót 'device_fp' và 'enroll' — mẫu mới phải bắt được.
  const re = new RegExp(cfg.pattern, 'i');
  assert.ok(re.test('seosona_device_fp'), 'mẫu bắt được device_fp');
  assert.ok(re.test('seosona_client_enrollment'), 'mẫu bắt được enrollment');
});

test('SF-018: storage inventory đã đánh dấu khoá enrollment', () => {
  const inv = JSON.parse(read('artifacts/audit/phase-01/storage-inventory.json'));
  const sensitive = inv.keys.filter((k) => k.sensitivity === 'sensitive').map((k) => k.key);
  assert.ok(sensitive.includes('seosona_client_enrollment'),
    'khoá enrollment từng lọt khỏi inventory dù SecretVault biết nó là bí mật');
});
