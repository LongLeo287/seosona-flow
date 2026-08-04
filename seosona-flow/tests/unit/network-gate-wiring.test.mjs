// SF-001/SF-003 vòng hai — nối dây thật cho RuntimeNetworkGate và dồn fetch đặc quyền qua
// NetworkPolicy. Trước đó cổng chỉ được importScripts rồi không ai gọi, và 20 chỗ fetch trần
// đi vòng qua chính sách.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(join(root, f), 'utf8');

function loadGate() {
  const scope = {};
  new Function('self', read('src/core/RuntimeNetworkGate.js'))(scope);
  return scope.SEOSONA_RuntimeNetworkGate;
}

const G = loadGate();

test('positive: traffic provider luôn được đi, kể cả ở local mode', () => {
  for (const u of ['https://labs.google/fx/tools/flow', 'https://chatgpt.com/backend-api/x',
    'https://grok.com/imagine', 'https://claude.ai/chat']) {
    assert.equal(G.classifyTraffic(u), 'provider', u);
    assert.equal(G.guard(u, { localMode: true }).allowed, true, `${u} phải được đi`);
  }
});

test('negative: local mode CHẶN mọi traffic backend', () => {
  for (const u of ['http://localhost:8000/api/v1/enroll', 'https://labs.seosona.vn/api/v1/workflows']) {
    assert.equal(G.classifyTraffic(u), 'backend', u);
    const d = G.guard(u, { localMode: true, userInitiated: false });
    assert.equal(d.allowed, false, `${u} phải bị chặn`);
    assert.equal(d.reason, 'LOCAL_MODE_BACKEND_BLOCKED');
  }
});

test('boundary: tắt local mode thì backend đi được lại', () => {
  const u = 'http://localhost:8000/api/v1/enroll';
  assert.equal(G.guard(u, { localMode: false }).allowed, true);
});

test('boundary: cổng học được host backend do người dùng đặt', () => {
  const g = loadGate();
  const u = 'https://backend.vi-du.com/api/v1/me';
  assert.equal(g.classifyTraffic(u), 'backend', 'path /api/ đã đủ để nhận ra');
  g.setBackendHosts(['localhost', '127.0.0.1', 'backend.vi-du.com']);
  assert.equal(g.classifyTraffic('https://backend.vi-du.com/x'), 'backend',
    'sau khi học host thì không cần dựa vào path nữa');
});

// Đây là điểm mấu chốt: cổng phải được GỌI, không chỉ tồn tại.
test('regression: cổng được cắm vào _signedFetch — điểm nghẽn của mọi call backend', () => {
  const bg = read('background.js');
  const i = bg.indexOf('async function _signedFetch');
  assert.ok(i > 0);
  const body = bg.slice(i, i + 1400);
  assert.match(body, /SEOSONA_RuntimeNetworkGate/, 'có gọi cổng');
  assert.match(body, /_gate\.guard\(url/, 'gọi guard với đúng url');
  assert.match(body, /LOCAL_MODE/, 'trả lỗi rõ ràng khi bị chặn');
  // Chốt phải đứng TRƯỚC lúc dựng header ký, không thì đã ký xong mới quay ra.
  assert.ok(body.indexOf('_gate.guard') < body.indexOf('const headers ='),
    'chặn trước khi làm bất cứ việc gì khác');
  assert.match(bg, /_syncGateBackendHosts\(\)/, 'có đồng bộ host backend cho cổng');
});

test('regression: fetch đặc quyền đã dồn về _safeFetch, chỉ còn 2 chỗ có lý do', () => {
  const baseline = JSON.parse(read('config/raw-fetch-baseline.json'));
  assert.equal(baseline.counts['background.js'], 2, 'trần mới sau khi chuyển');

  const bg = read('background.js');
  assert.match(bg, /async function _safeFetch\(url, options\)/, 'có hàm bọc');
  assert.match(bg, /ns\.fetchSafe\(url, options, _NET_CTX/, 'đi qua NetworkService');
  // Đường lùi phải là fetch THẬT — gọi lại chính mình là đệ quy vô hạn (đã suýt mắc).
  assert.match(bg, /if \(!ns \|\| !ns\.fetchSafe\) return fetch\(url, options\);/,
    'đường lùi gọi fetch thật, không đệ quy');
});

test('regression: mỗi loại việc có trần riêng, backend mới được phép địa chỉ nội bộ', () => {
  const bg = read('background.js');
  const i = bg.indexOf('const _NET_CTX =');
  const blk = bg.slice(i, i + 400);
  assert.match(blk, /backend: \{ allowPrivate: true/, 'backend chạy localhost nên phải cho phép');
  assert.match(blk, /media: \{ allowPrivate: false/, 'media KHÔNG được phép địa chỉ nội bộ');
  assert.match(blk, /image: \{ allowPrivate: false/, 'image cũng vậy');
  // Video vài trăm MB — trần 25 MB mặc định của policy sẽ cắt mất.
  assert.match(blk, /media:[^}]*maxBytes: 512 \* 1024 \* 1024/, 'media có trần đủ cho video');
});
