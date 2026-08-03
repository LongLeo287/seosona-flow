// Chấm trạng thái kết nối Flow ở header.
// Học ý tưởng "status dot" từ dòng 1.2.x của sản phẩm cùng ngách — nhưng bản của họ báo
// trạng thái của một extension phụ (bridge). Bản này báo trạng thái THẬT của phiên Flow,
// dùng chung bộ dò với tab Bác sĩ. Không có extension phụ nào.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const src = read('src/core/ConnectorHealthDot.js');

test('4 trạng thái, mỗi cái có nhãn nói người dùng LÀM GÌ', () => {
  const root = {}; root.addEventListener = () => {};
  // eslint-disable-next-line no-new-func
  new Function('window', src)(root);
  const S = root.ConnectorHealthDot.STATES;
  assert.deepEqual(Object.keys(S).sort(), ['checking', 'off', 'ready', 'warn']);
  assert.match(S.off.label, /bấm/i, 'trạng thái hỏng phải chỉ đường, không chỉ báo hỏng');
  assert.match(S.warn.label, /bấm/i);
});

test('KHÔNG poll định kỳ — chỉ dò theo sự kiện', () => {
  // Poll mỗi vài giây tốn pin và tạo request thừa tới Flow, mà request thừa đúng là thứ
  // phần giới hạn tốc độ đang cố tránh.
  assert.ok(!/setInterval\s*\(/.test(src), 'không được đặt setInterval');
  assert.match(src, /addEventListener\?\.\('focus'/, 'phải dò lại khi cửa sổ được focus');
  assert.match(src, /flow:error_classified/, 'phải dò lại khi có lỗi Flow');
});

test('có chống dò dồn dập khi nhiều sự kiện bắn cùng lúc', () => {
  assert.match(src, /MIN_GAP_MS/);
  assert.match(src, /now - lastAt < MIN_GAP_MS/);
});

test('dùng CHUNG bộ dò với tab Bác sĩ (hai nơi lệch nhau là mất tin cả hai)', () => {
  assert.match(src, /FlowDoctor\.selfCheck|FD\.selfCheck/);
  for (const k of ['flowTab', 'loggedIn', 'contentScript', 'credits']) {
    assert.ok(src.includes(k + ':'), `thiếu mục dò ${k}`);
  }
});

test('phân biệt "chưa kết nối" với "có vấn đề" — hai cách xử lý khác nhau', () => {
  assert.match(src, /c\.id === 'flowTab' && !c\.ok/, 'không có tab Flow là off, không phải warn');
  assert.match(src, /noTab \? 'off' : 'warn'/);
});

test('chưa đọc được số dư KHÔNG bị coi là hỏng', () => {
  // Nhiều lúc chỉ là chưa quét lần nào — báo đỏ ở đây là báo sai và người dùng sẽ bỏ qua chấm.
  assert.match(src, /if \(n == null\) return \{ ok: true/);
});

test('đọc chrome.runtime.lastError (không thì Chrome log rác mỗi lần dò)', () => {
  assert.match(src, /void chrome\.runtime\.lastError/);
});

test('bấm vào thì mở tab Bác sĩ — chấm chỉ BÁO, nơi hướng dẫn sửa là Bác sĩ', () => {
  assert.match(src, /data-subtab="logs-doctor"/);
});

test('có aria-label + tooltip (chấm màu đơn thuần thì người mù màu không đọc được)', () => {
  assert.match(src, /setAttribute\('aria-label'/);
  assert.match(src, /setAttribute\('data-tooltip'/);
});

test('CSS: 4 trạng thái có màu riêng và tôn trọng prefers-reduced-motion', () => {
  const css = read('styles/sidebar.css');
  for (const c of ['chd-ready', 'chd-warn', 'chd-off', 'chd-checking']) {
    assert.ok(css.includes('.' + c), `CSS thiếu ${c}`);
  }
  const block = css.slice(css.indexOf('.chd {'));
  assert.match(block, /prefers-reduced-motion/, 'nhấp nháy phải tắt được cho người chỉnh giảm chuyển động');
});

test('được nạp và gắn vào header lúc khởi động', () => {
  const cfg = JSON.parse(read('config/page-scripts.json'));
  assert.ok(cfg.pages['pages/sidebar.html'].some((s) => s.endsWith('core/ConnectorHealthDot.js')));
  assert.match(read('src/app.js'), /ConnectorHealthDot\.mount\(hdr\)/);
});

test('KHÔNG phụ thuộc extension phụ nào', () => {
  // Bản của họ hỏi trạng thái một extension khác qua ID. Bản này chỉ hỏi background của
  // chính mình — không có ID lạ, không có runtime.connect ra ngoài.
  assert.ok(!/runtime\.connect\(/.test(src));
  assert.ok(!/sendMessage\(\s*['"][a-p]{32}['"]/.test(src), 'không gửi message tới extension ID lạ');
});
