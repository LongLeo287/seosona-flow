// DownloadPrefs — nguồn chân lý cho mức tải về của Flow.
// Khoá đúng ranh giới bản-gốc / bản-phóng-to, và khoá việc KHÔNG nơi nào còn viết tay mặc định.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const scope = {};
new Function('self', 'window', readFileSync(join(root, 'src/core/DownloadPrefs.js'), 'utf8'))(scope, scope);
const DP = scope.DownloadPrefs;

test('positive: bản gốc của mỗi loại là mức tải thẳng được', () => {
  assert.equal(DP.original(false), '1k');
  assert.equal(DP.original(true), '720p');
  assert.equal(DP.isUpscale('1k', false), false);
  assert.equal(DP.isUpscale('720p', true), false);
});

test('positive: mọi mức cao hơn đều là phóng to', () => {
  for (const r of ['2k', '4k']) assert.equal(DP.isUpscale(r, false), true, `ảnh ${r}`);
  for (const r of ['1080p', '4k']) assert.equal(DP.isUpscale(r, true), true, `video ${r}`);
});

test('negative: xin mức phóng to thì trả bản gốc và báo đã hạ', () => {
  const a = DP.resolve('4k', false);
  assert.equal(a.resolution, '1k');
  assert.equal(a.downgraded, true);
  const b = DP.resolve('1080p', true);
  assert.equal(b.resolution, '720p');
  assert.equal(b.downgraded, true);
});

test('boundary: rỗng/null thì lấy mặc định, không coi là phóng to', () => {
  for (const v of ['', null, undefined]) {
    assert.equal(DP.resolve(v, false).resolution, '1k');
    assert.equal(DP.resolve(v, true).resolution, '720p');
    assert.equal(DP.resolve(v, false).downgraded, false);
  }
  assert.equal(DP.isUpscale('', false), false);
});

test('boundary: thang ảnh và thang video không lẫn nhau', () => {
  // '720p' là bản gốc của VIDEO nhưng với ảnh thì là nhãn lạ → phải coi là phóng to, không nhận bừa.
  assert.equal(DP.isUpscale('720p', false), true);
  assert.equal(DP.isUpscale('1k', true), true);
});

test('regression: câu giải thích nêu rõ tín dụng đúng ca video 4K', () => {
  assert.match(DP.downgradeReason('4k', true), /tín dụng/);
  assert.ok(!/tín dụng/.test(DP.downgradeReason('4k', false)), 'ảnh 4K không nói chuyện tín dụng');
  assert.match(DP.downgradeReason('2k', false), /PHÓNG TO/);
});

// Người dùng chọn "ảnh 2K, video 1080p" — cả hai là mức phóng to, nên phải BẬT mới đi đường đó.
test('positive: bật cho phép phóng to thì tôn trọng đúng mức đã chọn', () => {
  const a = DP.resolve('2k', false, true);
  assert.equal(a.resolution, '2k');
  assert.equal(a.downgraded, false);
  assert.equal(a.upscale, true);
  const b = DP.resolve('1080p', true, true);
  assert.equal(b.resolution, '1080p');
  assert.equal(b.upscale, true);
});

test('negative: bật phóng to KHÔNG đụng tới mức vốn đã tải thẳng được', () => {
  const a = DP.resolve('1k', false, true);
  assert.equal(a.resolution, '1k');
  assert.equal(a.upscale, false, 'bản gốc thì không cần phóng to');
  assert.equal(DP.resolve('720p', true, true).upscale, false);
});

test('boundary: câu báo trước chỉ cảnh báo tín dụng đúng ca video 4K', () => {
  assert.match(DP.upscaleNotice('4k', true), /TỐN TÍN DỤNG/);
  assert.ok(!/TÍN DỤNG/.test(DP.upscaleNotice('1080p', true)), 'video 1080p không tốn tín dụng');
  assert.ok(!/TÍN DỤNG/.test(DP.upscaleNotice('2k', false)), 'ảnh 2K không tốn tín dụng');
});

test('regression: cờ cho phép phóng to mặc định TẮT ở mọi nơi', () => {
  assert.equal(DP.resolve('2k', false).downgraded, true, 'không truyền cờ = tắt');
  assert.equal(DP.resolve('2k', false, false).downgraded, true);
  const html = readFileSync(join(root, 'pages/settings.html'), 'utf8');
  assert.ok(html.includes('id="downloadAllowUpscale"'), 'có ô tick trong Cài đặt');
  assert.ok(!/id="downloadAllowUpscale"[^>]*checked/.test(html), 'ô tick không tự bật sẵn');
  const sp = readFileSync(join(root, 'scripts/settings-page.js'), 'utf8');
  assert.ok(sp.includes('downloadAllowUpscale: false'), 'mặc định trong settings-page là false');
  assert.ok(sp.includes("els.downloadAllowUpscale = $('#downloadAllowUpscale')"), 'có nối phần tử');
  assert.ok(sp.includes('downloadAllowUpscale: els.downloadAllowUpscale?.checked'), 'có lưu lại');
});

// Mặc định từng bị chép tay ở 11 chỗ trong 6 file; sót một chỗ là hai đường tải chạy hai luật.
test('regression: không file nào còn viết tay mặc định', () => {
  const files = ['src/core/WorkflowExecutor.js', 'src/workflow/WorkflowEditor.js',
    'src/multi-task/TaskModal.js', 'src/app.js',
    'src/workflow/WorkflowEditorNodeForm.js', 'src/multi-task/TaskList.js'];
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    assert.ok(!src.includes("download_resolution || '1k'"), `${f} không chép tay '1k'`);
    assert.ok(!src.includes("video_download_resolution || '720p'"), `${f} không chép tay '720p'`);
  }
});

// index + videoResolution từng bị bỏ quên ở MessageBridge → tải từ sidebar mất cấu hình video.
test('regression: MessageBridge gửi đủ index và videoResolution', () => {
  const src = readFileSync(join(root, 'src/core/MessageBridge.js'), 'utf8');
  const i = src.indexOf('static async downloadTileMedia');
  const body = src.slice(i, i + 900);
  assert.match(body, /index,\s*videoResolution\)/, 'chữ ký có đủ 8 tham số');
  assert.ok(body.includes('videoResolution:'), 'thân hàm có gửi videoResolution');
  assert.ok(body.includes('index:'), 'thân hàm có gửi index');
});

test('regression: DownloadPrefs được nạp ở CẢ hai phía', () => {
  const mf = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const flowCs = mf.content_scripts.find((c) => (c.js || []).includes('content_scripts/content.js'));
  assert.ok(flowCs.js.includes('src/core/DownloadPrefs.js'), 'content script Flow có nạp');
  assert.ok(flowCs.js.indexOf('src/core/DownloadPrefs.js') < flowCs.js.indexOf('content_scripts/content.js'),
    'phải nạp TRƯỚC content.js');
  const html = readFileSync(join(root, 'pages/sidebar.html'), 'utf8');
  assert.ok(html.includes('src/core/DownloadPrefs.js'), 'sidebar có nạp');
});
