// Công tắc "Siết bảo mật" trong Settings — bật/tắt default-deny cho message action.
// Cờ nằm ở chrome.storage.local key SEOSONA_SECURITY_ENFORCE; background lắng nghe
// onChanged nên đổi là ăn ngay. Test khoá đủ chuỗi: HTML -> JS -> background -> i18n.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');

const html = read('pages/settings.html');
const js = read('scripts/settings-page.js');

test('UI: section + checkbox có mặt và label trỏ đúng input', () => {
  assert.match(html, /id="securityHardeningSection"/, 'thiếu section');
  assert.match(html, /<input type="checkbox" id="securityEnforceToggle"/, 'thiếu checkbox');
  assert.match(html, /<label for="securityEnforceToggle"/, 'label không gắn với input');
  assert.match(html, /id="securityEnforceState"/, 'thiếu dòng trạng thái');
});

test('nhóm: section nằm ở sub-menu Advanced (không lẫn vào General)', () => {
  assert.match(js, /securityHardeningSection:\s*'advanced'/);
});

test('JS: đọc + ghi ĐÚNG key mà background đang nghe', () => {
  assert.match(js, /_initSecurityEnforceToggle\(\);/, 'không được gọi lúc init');
  assert.match(js, /const KEY = 'SEOSONA_SECURITY_ENFORCE'/, 'sai/thiếu key');
  assert.match(js, /chrome\.storage\.local\.set\(\{ \[KEY\]: on \}/, 'không ghi vào storage.local');
  const bg = read('background.js');
  assert.match(bg, /changes\.SEOSONA_SECURITY_ENFORCE/, 'background không nghe onChanged key này');
  assert.match(bg, /setEnforce\(!!changes\.SEOSONA_SECURITY_ENFORCE\.newValue\)/, 'background không áp dụng ngay');
});

test('an toàn: ghi hỏng thì trả checkbox về trạng thái thật (không hiển thị sai)', () => {
  assert.match(js, /cb\.checked = !on;/, 'thiếu rollback khi lastError');
});

test('mặc định giờ BẬT; chỉ tắt TƯỜNG MINH mới là tắt', () => {
  const bg = read('background.js');
  // Điểm tinh: phải so `=== false`, KHÔNG phải `=== true`. undefined nghĩa là người dùng
  // chưa từng đụng tới công tắc — đó là ca phổ biến nhất và phải rơi vào mặc định BẬT.
  assert.match(bg, /SEOSONA_SECURITY_ENFORCE === false/);
  assert.match(bg, /setEnforce\(!off\)/);
  assert.ok(!/d\.SEOSONA_SECURITY_ENFORCE\s*\)\s*\{[\s\S]{0,80}setEnforce\(true\)/.test(bg),
    'còn sót nhánh cũ "chỉ bật khi cờ === truthy"');
});

test('tắt tường minh được TÔN TRỌNG — không ép bật lại ở lần khởi động sau', () => {
  const bg = read('background.js');
  assert.match(bg, /const off = d && d\.SEOSONA_SECURITY_ENFORCE === false/);
  // UI phải khớp mặc định mới, nếu không người dùng thấy ô chưa tick trong khi đang chặn thật.
  assert.match(js, /cb\.checked = !\(d && d\[KEY\] === false\)/);
});

test('i18n: 3 khoá mới có ở CẢ vi và en (không rơi ra chuỗi trống)', () => {
  const load = (f, name) => {
    const sb = {}; sb.window = sb; vm.createContext(sb);
    vm.runInContext(read(f), sb);
    return sb[name];
  };
  const vi = load('src/i18n/vi.js', 'I18N_VI');
  const en = load('src/i18n/en.js', 'I18N_EN');
  for (const k of ['settings.securityHardening', 'settings.securityHardeningDesc', 'settings.securityEnforce']) {
    assert.ok(vi[k] && vi[k].trim(), `vi thiếu ${k}`);
    assert.ok(en[k] && en[k].trim(), `en thiếu ${k}`);
  }
});
