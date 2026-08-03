// P1.T1 tests — positive, negative, boundary, regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  repoRoot,
  trackedFiles,
  fileType,
  scopeOf,
  areaOf,
  buildInventory,
  sha256,
  stableJson,
} from '../../scripts/audit/lib/repo.mjs';

const inv = buildInventory();

// 2 test này từng chốt cứng ảnh chụp Phase-01 (232 file, 167 js, 8 html). Repo giờ
// 2.000+ file tracked nên chúng hỏng âm thầm từ lâu. Số tuyệt đối vô nghĩa ở đây —
// cái đáng bảo vệ là inventory TỰ NHẤT QUÁN: mọi hàng phải được đếm đúng một lần
// trong byScope và một lần trong byType. Sai lệch ở đó mới là lỗi thật của công cụ
// (bỏ sót file, đếm trùng, phân loại rơi vào 'undefined'). Drift so với baseline đã
// có check:architecture lo.
test('positive: tổng số hàng khớp tổng theo scope (không sót, không đếm trùng)', () => {
  const byScope = Object.values(inv.byScope).reduce((a, n) => a + n, 0);
  assert.equal(byScope, inv.totals.files, 'byScope phải cộng đúng bằng totals.files');
  assert.ok(inv.totals.files > 0);
  assert.equal(inv.files.length, inv.totals.files, 'số hàng thật phải bằng totals.files');
});

test('positive: phân loại theo type phủ hết, không có nhóm rác', () => {
  const byType = Object.values(inv.byType).reduce((a, n) => a + n, 0);
  assert.equal(byType, inv.totals.files, 'byType phải cộng đúng bằng totals.files');
  for (const k of Object.keys(inv.byType)) {
    assert.ok(k && k !== 'undefined' && k !== 'null', `type rác: ${k}`);
  }
  // Vẫn phải nhận diện được các loại cốt lõi của một extension.
  for (const k of ['javascript', 'css', 'html', 'json']) {
    assert.ok(inv.byType[k] > 0, `thiếu type ${k}`);
  }
});

test('positive: every row has scope, area, type, bytes and a content hash', () => {
  for (const f of inv.files) {
    assert.ok(f.path && !f.path.includes('\\'), `normalized path: ${f.path}`);
    assert.ok(['root', 'seosona-flow'].includes(f.scope));
    assert.ok(f.area.length > 0);
    assert.ok(f.type.length > 0);
    assert.ok(Number.isInteger(f.bytes) && f.bytes >= 0);
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
  }
});

test('negative: junction/symlink is excluded from tracked scope', () => {
  const paths = trackedFiles();
  assert.ok(
    !paths.includes('seosona-ux-ui'),
    'external junction must not appear in tracked inventory',
  );
});

test('boundary: text files carry line counts, binaries do not', () => {
  const bg = inv.files.find((f) => f.path === 'seosona-flow/background.js');
  assert.ok(bg, 'background.js present');
  assert.ok(Number.isInteger(bg.lines) && bg.lines > 0);
  const icon = inv.files.find((f) => f.type === 'binary');
  assert.ok(icon, 'at least one binary tracked');
  assert.equal(icon.lines, null, 'binary rows have null line count');
});

test('boundary: classifiers are deterministic and closed', () => {
  assert.equal(fileType('a/b.js'), 'javascript');
  assert.equal(fileType('a/b.mjs'), 'javascript');
  assert.equal(fileType('a/b.css'), 'css');
  assert.equal(fileType('a/b.png'), 'binary');
  assert.equal(fileType('a/b.unknownext'), 'other');
  assert.equal(scopeOf('seosona-flow/background.js'), 'seosona-flow');
  assert.equal(scopeOf('README.md'), 'root');
  assert.equal(areaOf('seosona-flow/src/core/RuntimeMode.js'), 'seosona-flow/src/core');
  assert.equal(areaOf('seosona-flow/content_scripts/content.js'), 'seosona-flow/content_scripts');
});

test('regression: scopeHash is stable across repeated builds', () => {
  const again = buildInventory();
  assert.equal(again.scopeHash, inv.scopeHash, 'scopeHash must be deterministic');
  assert.equal(stableJson(again), stableJson(inv), 'serialized artifact is byte-stable');
});

test('regression: scopeHash derives only from tracked content', () => {
  const expected = sha256(
    inv.files.map((f) => `${f.path}:${f.bytes}:${f.sha256}`).join('\n'),
  );
  assert.equal(inv.scopeHash, expected);
});

test('sanity: repoRoot resolves and contains seosona-flow', () => {
  const root = repoRoot();
  assert.ok(root.length > 0);
  assert.ok(trackedFiles(root).some((p) => p.startsWith('seosona-flow/')));
});
