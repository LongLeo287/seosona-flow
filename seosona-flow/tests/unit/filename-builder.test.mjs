// FilenameBuilder — lõi dựng tên file, dùng chung cho content.js · DownloadHelper · GenTab.
// Trước khi gom, ba nơi mỗi nơi một bản chép và ĐÃ LỆCH thật ở thư mục mặc định.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const scope = {};
new Function('self', 'window', readFileSync(join(root, 'src/core/FilenameBuilder.js'), 'utf8'))(scope, scope);
const FB = scope.FilenameBuilder;

const NOW = new Date('2026-08-04T09:30:25Z');

test('positive: thay đủ biến trong mẫu', () => {
  const n = FB.applyTemplate({
    template: '[Date]_[Project]_[Prompt]_[Index]',
    project: 'CuteCats', prompt: 'a cat', index: 7, now: NOW,
  });
  assert.equal(n, '2026-08-04_CuteCats_a_cat_007');
});

test('positive: tiếng Việt có dấu → ASCII, không thành gạch dưới', () => {
  assert.equal(FB.toAscii('Mỹ phẩm đẹp'), 'My pham dep');
  // Đây là lý do phải bỏ dấu TRƯỚC khi lọc ký tự: lọc thẳng thì "Mỹ phẩm" thành "M__ph_m".
  assert.equal(FB.safeSegment('Mỹ phẩm', 30), 'My_pham');
});

test('positive: đường dẫn đầy đủ có thư mục con', () => {
  const p = FB.buildPath({
    template: '[Date]_[Prompt]', prompt: 'cat', taskName: 'Task A',
    folder: 'out', ext: 'mp4', now: NOW,
  });
  assert.equal(p, 'out/Task_A/2026-08-04_cat.mp4');
});

// Cả ba bản cũ đều tự vá riêng lỗi này — đúng dấu hiệu của mã chép.
test('negative: thư mục con trùng thư mục gốc thì KHÔNG lồng thêm tầng', () => {
  assert.equal(FB.joinFolder('seosonaflow_output', 'seosonaflow_output'), 'seosonaflow_output');
  assert.equal(FB.joinFolder('seosonaflow_output', 'SEOSONAFLOW_OUTPUT'), 'seosonaflow_output',
    'so sánh không phân biệt hoa thường — cùng một thư mục vật lý');
  // So với TẦNG CUỐI, vì thư mục gốc có thể đã lồng sẵn.
  assert.equal(FB.joinFolder('a/b', 'b'), 'a/b');
  assert.equal(FB.joinFolder('a/b', 'c'), 'a/b/c');
});

test('boundary: mẫu rỗng hoặc chỉ toàn gạch dưới vẫn ra tên dùng được', () => {
  const n = FB.applyTemplate({ template: '[Project]_[Index]', now: NOW });
  assert.ok(n.length > 0, 'không được ra chuỗi rỗng');
  assert.ok(!n.startsWith('_') && !n.endsWith('_'), 'không còn gạch dưới thừa hai đầu');
  assert.ok(!/__/.test(n), 'không còn gạch dưới đôi');
});

test('boundary: không có thư mục thì dùng mặc định chung', () => {
  assert.equal(FB.DEFAULT_FOLDER, 'seosonaflow_output');
  assert.ok(FB.buildPath({ prompt: 'x', now: NOW }).startsWith('seosonaflow_output/'));
});

// Đây là lỗi thật đã tìm ra: ảnh từ Flow rơi vào seosonaflow_output, ảnh từ ChatGPT/Grok rơi
// vào flow-output — hai thư mục khác nhau mà không vì lý do gì.
test('regression: KHÔNG nơi nào còn dự phòng thư mục "flow-output"', () => {
  const files = ['src/prompts/GenTab.js', 'src/core/WorkflowExecutor.js',
    'src/shared/DownloadHelper.js', 'content_scripts/content.js'];
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    // Bỏ dòng chú thích rồi mới soát — chú thích có nhắc tên cũ để giải thích lịch sử.
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    assert.ok(!code.includes("'flow-output'"), `${f} không còn dự phòng 'flow-output'`);
  }
});

test('regression: ba nơi dựng tên đều ỦY QUYỀN, không còn bản chép', () => {
  const ct = readFileSync(join(root, 'content_scripts/content.js'), 'utf8');
  assert.ok(ct.includes('FilenameBuilder.toAscii'), 'content.js ủy quyền toAscii');
  assert.ok(ct.includes('FB.buildPath(options)'), 'content.js ủy quyền buildPath');
  const dh = readFileSync(join(root, 'src/shared/DownloadHelper.js'), 'utf8');
  assert.ok(dh.includes('FB.buildPath({'), 'DownloadHelper ủy quyền');
  const gt = readFileSync(join(root, 'src/prompts/GenTab.js'), 'utf8');
  assert.ok(gt.includes('FilenameBuilder.toAscii'), 'GenTab ủy quyền toAscii');
  // Bản chép cũ nhận ra qua đoạn thay biến — chỉ được còn ĐÚNG MỘT nơi có nó.
  const fb = readFileSync(join(root, 'src/core/FilenameBuilder.js'), 'utf8');
  const marker = 'replace(/\\[Prompt\\]/gi';
  assert.ok(fb.includes(marker), 'lõi nằm ở FilenameBuilder');
  assert.ok(!ct.includes(marker), 'content.js không còn tự thay biến');
  assert.ok(!dh.includes(marker), 'DownloadHelper không còn tự thay biến');
});

test('regression: FilenameBuilder nạp ở CẢ hai phía, trước nơi dùng', () => {
  const mf = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const cs = mf.content_scripts.find((c) => (c.js || []).includes('content_scripts/content.js'));
  assert.ok(cs.js.includes('src/core/FilenameBuilder.js'));
  assert.ok(cs.js.indexOf('src/core/FilenameBuilder.js') < cs.js.indexOf('content_scripts/content.js'));
  const html = readFileSync(join(root, 'pages/sidebar.html'), 'utf8');
  assert.ok(html.includes('src/core/FilenameBuilder.js'));
});

// Không caller nào truyền videoResolution → video tải từ sidebar chạy bằng mức của ẢNH.
test('regression: ô video tự đọc thiết lập video, không phụ thuộc caller', () => {
  const ct = readFileSync(join(root, 'content_scripts/content.js'), 'utf8');
  assert.match(ct, /res = videoResolution \|\| \(await getDownloadSettings\(\)\)\.videoResolution/);
  assert.match(ct, /videoResolution: s\.videoDownloadResolution/, 'getDownloadSettings có trả mức video');
});
