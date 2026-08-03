// FlowCreditsScanner — đọc số dư mà KHÔNG đụng vào giao diện.
//
// Bối cảnh (kiểm trên DOM Flow THẬT 2026-07-27): extension MỞ được trình đơn tài khoản nhưng
// KHÔNG đóng lại được — Escape, .click(), và cả chuỗi pointer đầy đủ lên nút "Đóng cửa sổ phụ này"
// đều vô tác dụng; chỉ CLICK CHUỘT THẬT mới đóng. Content script không tạo được sự kiện trusted.
// Nên thiết kế là: quét thụ động + rình, TUYỆT ĐỐI không tự bấm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
function load() {
  const g = {};
  ['src/core/AccountPlan.js', 'src/core/FlowCreditsScanner.js']
    .forEach((f) => new Function('self', readFileSync(join(PKG, f), 'utf8'))(g));
  return g;
}

/** DOM giả. `clicks` đếm mọi cú bấm — phải LUÔN bằng 0. */
function makeDoc({ creditText = null } = {}) {
  const doc = { clicks: 0, body: {}, _listeners: [] };
  const avatar = {
    tagName: 'BUTTON', getAttribute: () => null,
    click: () => { doc.clicks++; },
  };
  const img = { tagName: 'IMG', getAttribute: (k) => (k === 'alt' ? 'Ảnh hồ sơ cá nhân của bạn' : null), parentElement: avatar };
  doc.querySelectorAll = (sel) => {
    if (sel === 'img[alt]') return [img];
    return creditText ? [{ textContent: creditText }] : [{ textContent: 'Đăng xuất' }];
  };
  doc.querySelector = () => null;
  doc.readyState = 'complete';
  return doc;
}

test('⭐ KHÔNG BAO GIỜ tự bấm — dù không đọc được số dư', () => {
  const g = load();
  const doc = makeDoc({ creditText: null });
  const r = g.FlowCreditsScanner.scanPassive({ document: doc, AccountPlan: g.AccountPlan });
  assert.equal(r.known, false);
  assert.equal(r.reason, 'NEED_USER_ACTION');
  assert.equal(doc.clicks, 0, '⭐ mở được nhưng KHÔNG đóng được → tuyệt đối không tự mở');
  assert.match(r.hint, /ảnh đại diện/i, 'phải chỉ user làm gì');
  assert.equal(r.credits, undefined, 'không bịa số');
});

test('trình đơn đang mở (hoặc đã mở trước đó) → đọc được, vẫn không bấm gì', () => {
  const g = load();
  const doc = makeDoc({ creditText: '21926 Tín dụng Google Flow' });
  const r = g.FlowCreditsScanner.scanPassive({ document: doc, AccountPlan: g.AccountPlan });
  assert.equal(r.known, true);
  assert.equal(r.credits, 21926, 'số thật đọc được từ tài khoản Ultra khi kiểm live');
  assert.equal(doc.clicks, 0);
});

// ── Rình: bắt số dư đúng lúc user tự mở trình đơn ──────────────────────────
function makeWatchDoc() {
  const doc = makeDoc({ creditText: null });
  let text = null;
  doc.querySelectorAll = (sel) => {
    if (sel === 'img[alt]') return [];
    return text ? [{ textContent: text }] : [{ textContent: 'Đăng xuất' }];
  };
  doc.setCredit = (t) => { text = t; };
  return doc;
}
function makeMO() {
  const inst = { cbs: [], disconnected: 0 };
  function MO(cb) { inst.cbs.push(cb); this.observe = () => {}; this.disconnect = () => { inst.disconnected++; }; }
  MO._inst = inst;
  return MO;
}

test('⭐ RÌNH: user tự mở trình đơn → bắt được số dư ngay, không cần bấm quét', async () => {
  const g = load();
  g.FlowCreditsScanner._reset();
  const doc = makeWatchDoc();
  const MO = makeMO();
  const seen = [];
  g.FlowCreditsScanner.watch((c) => seen.push(c), { document: doc, AccountPlan: g.AccountPlan, MutationObserver: MO, debounce: 1 });

  assert.deepEqual(seen, [], 'chưa mở thì chưa có gì');

  doc.setCredit('21926 Tín dụng Google Flow');       // user tự mở trình đơn
  MO._inst.cbs[0]();                                  // DOM đổi
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(seen, [21926], 'bắt được ngay khi xuất hiện');

  MO._inst.cbs[0]();                                  // DOM đổi tiếp, số KHÔNG đổi
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(seen, [21926], 'số không đổi thì KHÔNG báo lại — tránh ghi kho liên tục');

  doc.setCredit('21900 Tín dụng Google Flow');        // gen xong, trừ credit
  MO._inst.cbs[0]();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(seen, [21926, 21900], 'số đổi thì cập nhật');
});

test('watch() gọi lại thì ngắt bộ rình cũ — không chồng observer', () => {
  const g = load();
  const doc = makeWatchDoc();
  const MO = makeMO();
  g.FlowCreditsScanner.watch(() => {}, { document: doc, AccountPlan: g.AccountPlan, MutationObserver: MO, debounce: 1 });
  g.FlowCreditsScanner.watch(() => {}, { document: doc, AccountPlan: g.AccountPlan, MutationObserver: MO, debounce: 1 });
  assert.equal(MO._inst.disconnected, 1, 'lần watch thứ 2 phải disconnect lần 1');
});

test('thiếu MutationObserver / body → trả hàm rỗng, không nổ', () => {
  const g = load();
  const stop = g.FlowCreditsScanner.watch(() => {}, { document: { body: null }, AccountPlan: g.AccountPlan });
  assert.equal(typeof stop, 'function');
  stop();
});
