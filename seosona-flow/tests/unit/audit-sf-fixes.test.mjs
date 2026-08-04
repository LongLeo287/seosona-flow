// Khoá ba issue từ SEOSONA-FLOW-COMPLETE-TECHNICAL-AUDIT-2026-08-04.md đã sửa.
// Đây là loại lỗi lặng — không làm đỏ cổng nào, nên phải có test giữ chỗ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(join(root, f), 'utf8');

// SF-001 — local mode hứa 100% offline nhưng onInstalled/onStartup vẫn gửi vân tay thiết bị.
test('SF-001: enrollment bị chốt ở CẢ hai cửa vào khi local mode', () => {
  const bg = read('background.js');
  const guard = 'if (self.SEOSONA_LOCAL_MODE !== false) return null;';

  const iEnsure = bg.indexOf('async function _ensureEnrollment(');
  assert.ok(iEnsure > 0);
  assert.ok(bg.slice(iEnsure, iEnsure + 800).includes(guard), '_ensureEnrollment có chốt');

  const iDo = bg.indexOf('async function _doEnrollment(');
  assert.ok(iDo > 0);
  const body = bg.slice(iDo, iDo + 700);
  assert.ok(body.includes(guard), '_doEnrollment có chốt');
  // Chốt phải đứng TRƯỚC chỗ tạo vân tay, không thì đã lỡ tạo rồi mới quay ra.
  assert.ok(body.indexOf(guard) < body.indexOf('_getOrCreateDeviceFingerprint'),
    'chốt nằm trước khi tạo vân tay thiết bị');
});

// SF-021 — audit xếp P3 "khai báo trùng"; thực tế bản sau đè bản trước và không chống null.
test('SF-021: chỉ còn MỘT _escapeHtml, và nó chống null', () => {
  const gt = read('src/prompts/GenTab.js');
  const decls = gt.match(/static _escapeHtml\s*\(/g) || [];
  assert.equal(decls.length, 1, `phải còn đúng 1 bản, đang có ${decls.length}`);

  const i = gt.indexOf('static _escapeHtml(');
  const body = gt.slice(i, i + 200);
  assert.ok(body.includes("|| ''"), 'bản còn lại chống null — không ném khi error rỗng');
  assert.ok(!/static _escapeHtml\(str\)/.test(gt), 'bản str.replace() không chống null đã gỡ');
});

// Bản còn lại escape qua textContent nên KHÔNG escape dấu nháy kép — dùng trong thuộc tính là hở.
test('SF-021b: ngữ cảnh thuộc tính dùng _escapeAttr, không dùng _escapeHtml', () => {
  const gt = read('src/prompts/GenTab.js');
  // Bắt mọi chỗ nội suy _escapeHtml nằm ngay trong một thuộc tính có dấu nháy kép.
  const bad = gt.match(/="\$\{[^}]*_escapeHtml\([^}]*\}"/g) || [];
  assert.deepEqual(bad, [], `_escapeHtml bị dùng trong thuộc tính: ${bad.join(' | ')}`);
  assert.ok(gt.includes('_escapeAttr(preview)'), 'chỗ title đã đổi sang _escapeAttr');
  const i = gt.indexOf('static _escapeAttr(');
  assert.ok(gt.slice(i, i + 250).includes('&quot;'), '_escapeAttr có escape dấu nháy kép');
});

// SF-006 — `return true;` rồi để hai dòng nằm chết phía sau; ESLint báo nhưng warning không đỏ gate.
test('SF-006: isModuleEnabled không còn mã chết sau return', () => {
  const fg = read('src/core/FeatureGate.js');
  assert.ok(!/isModuleEnabled\(module\)\s*\{\s*return true;/.test(fg),
    'không còn `return true;` chặn phần thân phía sau');
  const i = fg.indexOf('isModuleEnabled(module)');
  const body = fg.slice(i, i + 700);
  assert.ok(body.includes('_isLocal'), 'ý định local-first được viết ra rõ ràng');
  assert.ok(body.includes('this.canUse(key)'), 'nhánh entitlement nay thực sự tới được');
  assert.ok(fg.includes('_isLocal()'), '_isLocal có tồn tại thật, không phải gọi hàm ma');
});
