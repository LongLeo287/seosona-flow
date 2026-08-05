// SF-019 bước 1 — nối StructuredLogger vào phễu nuốt-lỗi-có-chủ-ý.
//
// StructuredLogger có từ Phase 10 nhưng KHÔNG một call site nào: một hạ tầng đầy đủ nằm không.
// `swallow()` là phễu DUY NHẤT của hơn một nghìn catch im-lặng-có-chủ-ý, nên cắm ở đó phủ hết
// trong một lần sửa thay vì đi vá từng chỗ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(join(root, f), 'utf8');

function boot({ withLogger = true } = {}) {
  const g = {};
  if (withLogger) new Function('self', read('src/core/StructuredLogger.js'))(g);
  new Function('self', read('src/core/ErrorCatalog.js'))(g);
  return g;
}

test('positive: mỗi lần nuốt lỗi sinh MỘT bản ghi có cấu trúc', () => {
  const g = boot();
  g.SEOSONA_swallow('WorkflowExecutor#runNode', new Error('mạng lỗi'));
  const recs = g.SEOSONA_ErrorCatalog.structured();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].component, 'WorkflowExecutor', 'tách được tên module');
  assert.equal(recs[0].event, 'owned-suppression:runNode', 'giữ tên hàm trong sự kiện');
  assert.equal(recs[0].severity, 'debug');
  assert.equal(recs[0].data.message, 'mạng lỗi');
});

test('positive: đếm được theo module — thứ mảng phẳng không làm được', () => {
  const g = boot();
  g.SEOSONA_swallow('WorkflowExecutor#a', new Error('1'));
  g.SEOSONA_swallow('WorkflowExecutor#b', new Error('2'));
  g.SEOSONA_swallow('GenTab#c', new Error('3'));
  const byMod = {};
  for (const r of g.SEOSONA_ErrorCatalog.structured()) byMod[r.component] = (byMod[r.component] || 0) + 1;
  assert.deepEqual(byMod, { WorkflowExecutor: 2, GenTab: 1 });
});

// Ngưỡng mặc định của logger là 'info'; nuốt lỗi ghi ở 'debug'. Quên hạ ngưỡng thì vòng đệm
// LUÔN RỖNG mà không báo gì — đúng lỗi tôi mắc ở lần nối đầu tiên.
test('regression: logger được tạo với ngưỡng debug, không thì mất sạch bản ghi', () => {
  const src = read('src/core/ErrorCatalog.js');
  assert.match(src, /SL\.create\(\{ level: 'debug'/, "phải tạo với level:'debug'");
  const g = boot();
  g.SEOSONA_swallow('X#y', new Error('z'));
  assert.ok(g.SEOSONA_ErrorCatalog.structured().length > 0, 'vòng đệm không được rỗng');
});

// ErrorCatalog là file nạp ĐẦU TIÊN ở mọi ngữ cảnh — không được phụ thuộc cứng vào ai.
test('negative: thiếu StructuredLogger thì vẫn chạy bình thường, không ném', () => {
  const g = boot({ withLogger: false });
  assert.doesNotThrow(() => g.SEOSONA_swallow('A#b', new Error('c')));
  assert.equal(g.SEOSONA_ErrorCatalog.suppressions().length, 1, 'mảng phẳng vẫn ghi');
  assert.deepEqual(g.SEOSONA_ErrorCatalog.structured(), [], 'bản có cấu trúc rỗng, không nổ');
});

test('boundary: nuốt lỗi không bao giờ được ném, kể cả khi err kỳ quặc', () => {
  const g = boot();
  for (const bad of [null, undefined, 'chuỗi', 0, { message: null }]) {
    assert.doesNotThrow(() => g.SEOSONA_swallow('M#f', bad), `err = ${JSON.stringify(bad)}`);
  }
  assert.doesNotThrow(() => g.SEOSONA_swallow(null, new Error('x')), 'reason rỗng');
});

test('boundary: vòng đệm hữu hạn — không rò bộ nhớ khi chạy dài', () => {
  const g = boot();
  for (let i = 0; i < 700; i++) g.SEOSONA_swallow(`M${i % 3}#f`, new Error(String(i)));
  assert.ok(g.SEOSONA_ErrorCatalog.structured().length <= 500, 'bản có cấu trúc bị chặn ở 500');
  assert.ok(g.SEOSONA_ErrorCatalog.suppressions().length <= 500, 'mảng phẳng cũng vậy');
});

// SỬA LẠI: lần đầu tôi gỡ 4 module vì "0 nơi tham chiếu", nhưng ConnectorStatus và
// MessageSchemas là GIÀN GIÁO cho kế hoạch đang chờ làm (docs/superpowers/plans/
// 2026-08-04-...upgrade.md nhắc mỗi cái 6 lần, cùng bộ với VisualPickerCore/BatchCollectorCore
// cũng đang 0 nơi dùng). Chưa-nối-dây KHÁC với đã-lỗi-thời. Đã khôi phục cả hai.
// Chỉ FlowApiGateway và DownloadExecutor là chết thật: không kế hoạch nào nhắc tới, và
// DownloadExecutor còn trùng lặp với đường tải đang chạy trong content.js.
test('regression: chỉ gỡ module chết THẬT, giữ giàn giáo của kế hoạch', () => {
  for (const m of ['FlowApiGateway', 'DownloadExecutor']) {
    assert.ok(!existsSync(join(root, `src/core/${m}.js`)), `${m}.js phải đã xoá`);
  }
  for (const m of ['ConnectorStatus', 'MessageSchemas']) {
    assert.ok(existsSync(join(root, `src/core/${m}.js`)),
      `${m}.js PHẢI CÒN — kế hoạch nâng cấp đang chờ nối dây nó`);
  }
});

test('regression: StructuredLogger nạp ngay sau ErrorCatalog ở mọi nơi', () => {
  const mf = JSON.parse(read('manifest.json'));
  for (const cs of mf.content_scripts) {
    const js = cs.js || [];
    if (!js.includes('src/core/ErrorCatalog.js')) continue;
    assert.ok(js.includes('src/core/StructuredLogger.js'), `content script thiếu logger: ${js[0]}`);
    assert.equal(js.indexOf('src/core/StructuredLogger.js'), js.indexOf('src/core/ErrorCatalog.js') + 1,
      'phải đứng NGAY SAU ErrorCatalog — nạp muộn hơn thì những lần nuốt lỗi sớm bị mất');
  }
  const cfg = JSON.parse(read('config/page-scripts.json'));
  for (const [page, list] of Object.entries(cfg.pages)) {
    if (!list.some((s) => s.includes('ErrorCatalog.js'))) continue;
    assert.ok(list.some((s) => s.includes('StructuredLogger.js')), `${page} thiếu logger`);
  }
});
