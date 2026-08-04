// P1.T3 tests — positive, negative, boundary, regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessageContracts } from '../../scripts/audit/lib/messages.mjs';

const c = buildMessageContracts();
const byAction = new Map(c.registry.map((r) => [r.action, r]));

test('positive: every privileged handler has exactly one classified registry row', () => {
  const seen = new Set();
  for (const r of c.registry) {
    assert.ok(!seen.has(r.action), `duplicate row: ${r.action}`);
    seen.add(r.action);
    assert.ok(Array.isArray(r.sources));
    assert.equal(typeof r.privileged, 'boolean');
  }
});

test('positive: known privileged actions are present and classified', () => {
  for (const action of ['chromeDownload', 'fetchImageAsBase64', 'apiRequest']) {
    const r = byAction.get(action);
    assert.ok(r, `action ${action} present`);
    assert.equal(r.handled, true);
  }
});

// ĐẢO CHIỀU 2026-08-04 (SF-004). Bài này trước đây đòi PHẢI CÓ ít nhất một action gọi được từ
// website — hợp lý khi còn cầu nối labs.seosona.vn. Nay cầu nối đã gỡ (316 dòng mã chết mở 12
// khả năng điều khiển từ xa, chưa từng chạy vì manifest không khai externally_connectable).
// Với sản phẩm local-first, con số đúng là KHÔNG. Giữ bài test nhưng khoá chiều ngược lại, để
// ai đó mở lại cửa này thì cổng đỏ ngay chứ không lặng lẽ trôi qua.
test('negative: KHÔNG action nào gọi được từ website', () => {
  assert.equal(c.summary.externalListeners, 0, 'không còn onMessageExternal listener');
  assert.deepEqual(c.summary.externallyReachable, [],
    `mặt tấn công từ website phải bằng 0, đang có: ${c.summary.externallyReachable.join(', ')}`);
  for (const r of c.registry) {
    assert.notEqual(r.externallyReachable, true, `${r.action} không được đánh dấu gọi-từ-ngoài`);
  }
});

test('boundary: handled actions carry a source context', () => {
  for (const r of c.registry.filter((x) => x.handled)) {
    assert.ok(r.sources.length >= 1, `${r.action} has a source context`);
  }
});

test('negative: an unhandled invented action is absent', () => {
  assert.equal(byAction.has('__totally_made_up_action__'), false);
});

test('boundary: privileged rows list concrete sink families', () => {
  const priv = c.registry.filter((r) => r.privileged);
  assert.ok(priv.length >= 1);
  for (const r of priv) {
    assert.ok(r.privilegedSinks.length >= 1, `${r.action} lists sinks`);
  }
});

test('regression: registry hash and total are deterministic', () => {
  const again = buildMessageContracts();
  assert.equal(again.registryHash, c.registryHash);
  assert.equal(again.summary.totalActions, c.summary.totalActions);
});
