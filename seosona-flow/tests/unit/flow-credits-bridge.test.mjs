// flow-credits-bridge — nghe ké response /v1/credits của chính Flow.
// Hình dạng dữ liệu lấy từ request THẬT (labs.google/fx, 2026-07-27):
//   { credits: 21926, userPaygateTier: "PAYGATE_TIER_TWO", sku: "G1_TIER2",
//     serviceTier: "SERVICE_TIER_ADVANCED", subscriptionCredits: 21926 }
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../content_scripts/flow-credits-bridge.js'), 'utf8');

const BODY = JSON.stringify({
  credits: 21926, userPaygateTier: 'PAYGATE_TIER_TWO', sku: 'G1_TIER2',
  serviceTier: 'SERVICE_TIER_ADVANCED', subscriptionCredits: 21926,
});

/** Cửa sổ giả với fetch gốc trả về body tuỳ ca. */
function makeWindow({ body = BODY, cloneCount = { n: 0 } } = {}) {
  const posted = [];
  const win = {
    posted,
    postMessage: (m) => posted.push(m),
    fetch: async (url) => ({
      __url: url,
      __bodyUsed: false,
      clone() { cloneCount.n++; return { text: async () => body }; },
      text: async function () { this.__bodyUsed = true; return body; },
    }),
    XMLHttpRequest: function () {},
  };
  win.XMLHttpRequest.prototype = { open() {}, send() {} };
  return win;
}
function install(win) { new Function('window', SRC)(win); return win; }

test('⭐ đọc được số dư + gói từ response THẬT, không gọi thêm request nào', async () => {
  const win = install(makeWindow());
  const res = await win.fetch('https://aisandbox-pa.googleapis.com/v1/credits?key=AIza123');
  await new Promise((r) => setImmediate(r));
  assert.equal(win.posted.length, 1);
  const m = win.posted[0];
  assert.equal(m.type, 'AF_FLOW_CREDITS');
  assert.equal(m.credits, 21926);
  assert.equal(m.sku, 'G1_TIER2', 'giữ NGUYÊN VĂN mã gói — không tự dịch thành tên gói');
  assert.equal(m.paygateTier, 'PAYGATE_TIER_TWO');
  assert.ok(res, 'vẫn trả response cho trang như thường');
});

test('⭐ KHÔNG nuốt body của trang — phải đọc bản clone', async () => {
  const cloneCount = { n: 0 };
  const win = install(makeWindow({ cloneCount }));
  const res = await win.fetch('https://aisandbox-pa.googleapis.com/v1/credits?key=x');
  await new Promise((r) => setImmediate(r));
  assert.equal(cloneCount.n, 1, 'phải clone()');
  assert.equal(res.__bodyUsed, false, '⭐ body GỐC còn nguyên — nếu đọc trực tiếp thì Flow sẽ hỏng');
});

test('URL khác thì kệ — không chạm vào', async () => {
  const win = install(makeWindow());
  await win.fetch('https://labs.google/fx/api/trpc/general.fetchUserLocale');
  await win.fetch('https://aisandbox-pa.googleapis.com/v1:checkAppAvailability');
  await new Promise((r) => setImmediate(r));
  assert.equal(win.posted.length, 0);
});

test('response lạ / thiếu trường credits → im lặng, KHÔNG bịa', async () => {
  for (const body of ['{}', '{"credits":"nhiều"}', 'không phải json', '{"error":{"code":401}}']) {
    const win = install(makeWindow({ body }));
    await win.fetch('https://aisandbox-pa.googleapis.com/v1/credits?key=x');
    await new Promise((r) => setImmediate(r));
    assert.equal(win.posted.length, 0, 'body "' + body.slice(0, 20) + '" không được sinh message');
  }
});

test('vá 2 lần (điều hướng nội bộ) → không chồng lớp', async () => {
  const win = makeWindow();
  install(win);
  const after1 = win.fetch;
  install(win);
  assert.equal(win.fetch, after1, 'lần vá thứ 2 phải bỏ qua nhờ cờ __afCreditsBridge');
});

test('credits = 0 vẫn phải báo (hết credit là tin quan trọng)', async () => {
  const win = install(makeWindow({ body: JSON.stringify({ credits: 0, sku: 'FREE' }) }));
  await win.fetch('https://aisandbox-pa.googleapis.com/v1/credits');
  await new Promise((r) => setImmediate(r));
  assert.equal(win.posted.length, 1, '0 là số hợp lệ — đừng để rơi vào nhánh falsy');
  assert.equal(win.posted[0].credits, 0);
});
