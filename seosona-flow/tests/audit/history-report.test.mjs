// P1.T5 tests — positive, negative, boundary, regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoryReport, classifySubject, sanitizeSubject, versionRefs } from '../../scripts/audit/lib/history.mjs';

const r = buildHistoryReport();

test('positive: all current commits are classified', () => {
  // ĐỔI 2026-08-03: lịch sử 303 commit đã gộp thành MỘT theo yêu cầu chủ repo (bản đầy đủ
  // giữ ở nhánh backup + bundle cục bộ). Ngưỡng ">= 20 commit" là quan sát cũ, không phải
  // bất biến. Cái vẫn đáng khoá: mọi commit PHẢI phân loại được, và số dòng khớp tổng.
  assert.ok(r.totals.commits >= 1);
  assert.equal(r.commits.length, r.totals.commits);
  assert.equal(r.unclassified.length, 0, `unclassified: ${r.unclassified.join(',')}`);
});

// ĐỔI 2026-08-03: repo có tác giả thứ hai (landing page + cấu hình Vercel đẩy từ nơi khác).
// "Một tác giả" là quan sát cũ, không phải bất biến — khoá nó lại chỉ khiến gate đỏ mỗi khi
// có người đóng góp. Cái ĐÁNG khoá là lịch sử tuyến tính: không merge, không tag.
test('positive: baseline history shape (linear — no merges, no tags)', () => {
  assert.equal(r.totals.merges, 0, 'lịch sử phải tuyến tính; rebase chứ đừng merge');
  assert.equal(r.totals.tags, 0);
  assert.ok(r.totals.authors >= 1);
});

// Sau khi gộp, bảng phân loại chỉ còn 1 dòng nên không kiểm được "có đủ các loại" nữa.
// Giữ lại thứ vẫn đúng và vẫn có giá trị: đúng MỘT commit gốc, và tổng các loại khớp tổng
// số commit (bắt được lỗi đếm trùng/sót của bộ phân loại).
test('positive: taxonomy — đúng một commit gốc, tổng các loại khớp', () => {
  assert.equal(r.byCategory.bootstrap, 1, 'exactly one root commit');
  const sum = Object.values(r.byCategory).reduce((a, b) => a + b, 0);
  assert.equal(sum, r.totals.commits, 'tổng phân loại lệch tổng commit');
});

test('boundary: subject classifier is deterministic', () => {
  assert.equal(classifySubject('Fix: canvas rỗng', false), 'fix');
  assert.equal(classifySubject('Port external source 1.1.49 (batch 4)', false), 'source-import');
  assert.equal(classifySubject('Debrand: remove legacy identity', false), 'debrand');
  assert.equal(classifySubject('anything', true), 'bootstrap');
});

// Sau khi gộp lịch sử, không còn commit "Port external source 1.1.x" nào để mà trích số
// hiệu. Vẫn kiểm BỘ TRÍCH (đó mới là logic đáng khoá), bỏ phần đòi dữ liệu lịch sử cũ.
test('boundary: version references are extracted', () => {
  assert.deepEqual(versionRefs('Port external source 1.1.49 (batch 4)'), ['1.1.49']);
  assert.deepEqual(versionRefs('không có số hiệu nào ở đây'), []);
  assert.ok(Array.isArray(r.sourceVersions));
});

test('regression: exported history subjects remove legacy product identity', () => {
  const legacyBrand = ['toby', 'flow'].join('');
  const sanitized = sanitizeSubject(`Port ${legacyBrand} 1.1.49`);
  assert.equal(sanitized, 'Port external source 1.1.49');
  assert.equal(JSON.stringify(r).toLowerCase().includes(legacyBrand), false);
});

test('positive: hot files ranked by churn', () => {
  assert.ok(r.hotFiles.length >= 1);
  for (let i = 1; i < r.hotFiles.length; i++) {
    assert.ok(r.hotFiles[i - 1].touches >= r.hotFiles[i].touches);
  }
});

test('regression: historyHash is deterministic', () => {
  const again = buildHistoryReport();
  assert.equal(again.historyHash, r.historyHash);
});
