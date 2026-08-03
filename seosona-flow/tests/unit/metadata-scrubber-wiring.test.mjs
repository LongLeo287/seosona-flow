// Engine dọn metadata có tồn tại là một chuyện; có ĐƯỢC GỌI ở đường tải về hay không lại
// là chuyện khác. Đây đúng kiểu lỗi tôi từng mắc: đăng ký node ở 4 chỗ, quên chỗ thứ 5,
// nên node hiện ra trong UI mà chạy thì không làm gì. Test này khoá phần NỐI DÂY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');

// Bản ĐẦU của test này chỉ quét WorkflowExecutor.js trong khi tên nói "MỌI đường tải" —
// nên nó xanh trong lúc 11/15 điểm tải khác chưa hề được nối. Test có phạm vi hẹp hơn tên
// của nó thì tệ hơn không có test: nó phát chứng nhận sai. Giờ quét TOÀN REPO.
const SAFE_URL_VARS = new Set([
  'dlUrl', '_dlUrl', '_t3Url',   // đã qua bộ dọn
  'dataUrl',                     // bản xuất TEXT (JSON/CSV) — không có metadata để dọn
]);

function allDownloadSites() {
  const files = execSync('git ls-files "*.js"', { cwd: PKG, encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.startsWith('tests/') && !f.startsWith('scripts/'));
  const out = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/action: 'chromeDownload',\s*(?:\n\s*)?url: ([\w.]+)/g)) {
      out.push({ file: f, v: m[1] });
    }
  }
  return out;
}

test('MỌI đường tải media trong TOÀN REPO đều đi qua bộ dọn', () => {
  const sites = allDownloadSites();
  assert.ok(sites.length >= 15, `chỉ thấy ${sites.length} điểm tải — regex hỏng?`);
  const bad = sites.filter((s) => !SAFE_URL_VARS.has(s.v));
  assert.deepEqual(bad, [], `chưa nối: ${bad.map((b) => `${b.file}(${b.v})`).join(', ')}`);
});

test('bộ dọn là MỘT hàm dùng chung, không copy-paste ở từng chỗ', () => {
  // 15 chỗ tự viết logic dọn = chắc chắn có chỗ lệch, và chỗ lệch đó im lặng.
  const src = read('src/core/MetadataScrubber.js');
  assert.match(src, /root\.scrubbedDownloadUrl = scrubbedDownloadUrl/, 'chưa phơi ra global');
  const callers = new Set(allDownloadSites().map((s) => s.file));
  for (const f of callers) {
    if (read(f).includes("url: dataUrl")) continue;   // chỉ xuất text
    assert.match(read(f), /scrubbedDownloadUrl\?\.\(/, `${f}: gọi thẳng, không qua hàm chung`);
  }
});

test('module có mặt ở content script — nếu không thì nút tải trên trang Flow câm', () => {
  const m = JSON.parse(read('manifest.json'));
  const entry = m.content_scripts.find((c) => (c.js || []).some((j) => j.endsWith('content_scripts/content.js')));
  assert.ok(entry, 'không tìm thấy khai báo content.js');
  const js = entry.js;
  assert.ok(js.includes('src/core/MetadataScrubber.js'), 'content.js dùng scrubbedDownloadUrl nhưng module không được nạp');
  assert.ok(js.indexOf('src/core/MetadataScrubber.js') < js.indexOf('content_scripts/content.js'), 'phải nạp TRƯỚC');
});

test('hỏng ở bất kỳ khâu nào thì trả URL GỐC — người dùng vẫn nhận được file', () => {
  const src = read('src/core/MetadataScrubber.js');
  const body = src.slice(src.indexOf('async function scrubbedDownloadUrl('));
  assert.match(body, /if \(_off\) return url;/, 'tắt công tắc → URL gốc');
  assert.match(body, /if \(!r\.changed\) \{ _report\([\s\S]*?return url; \}/, 'không đổi gì → báo lý do rồi trả URL gốc');
  assert.match(body, /catch[\s\S]*?return url;/, 'ném lỗi → vẫn phải trả URL gốc');
  // scrubUrl tự nó cũng phải fail-safe cho từng ca hỏng, có ghi lý do (không im lặng).
  const su = src.slice(src.indexOf('async function scrubUrl('), src.indexOf('function summarize('));
  for (const why of ['MÔI_TRƯỜNG_THIẾU', 'TẢI_KHÔNG_ĐƯỢC', 'ĐỊNH_DẠNG_LẠ', 'QUÁ_LỚN']) {
    assert.ok(su.includes(why), `thiếu ca hỏng "${why}" — hỏng mà không nói lý do là im lặng`);
  }
  // Nơi gọi phải dùng `?.() ?? url`: thiếu module thì không được ném ReferenceError.
  assert.match(read('src/prompts/GenTab.js'), /window\.scrubbedDownloadUrl\?\.\(blobUrl\) \?\? blobUrl/);
});

test('công tắc tắt được, và MẶC ĐỊNH là BẬT', () => {
  // `=== false` chứ không phải `!== true`: thiếu key thì phải coi là BẬT.
  assert.match(read('src/core/MetadataScrubber.js'), /af_settings\.scrubMetadata === false/);
  const st = read('scripts/settings-page.js');
  assert.match(st, /els\.scrubMeta = \$\('#scrubMetaToggle'\)/, 'chưa lấy phần tử');
  assert.match(st, /s\.scrubMetadata !== false/, 'ô tick phải mặc định BẬT');
  assert.match(st, /scrubMetadata: els\.scrubMeta \? els\.scrubMeta\.checked : true/, 'chưa lưu');
  assert.match(read('pages/settings.html'), /id="scrubMetaToggle"/, 'chưa có ô tick');
});

test('module được nạp ở MỌI trang chạy executor', () => {
  for (const p of ['pages/sidebar.html', 'pages/workflow-editor.html', 'pages/workflow-template-editor.html']) {
    const h = read(p);
    const iMS = h.indexOf('MetadataScrubber.js');
    const iWE = h.indexOf('core/WorkflowExecutor.js');
    assert.ok(iMS > -1, `${p}: chưa nạp MetadataScrubber`);
    assert.ok(iMS < iWE, `${p}: phải nạp TRƯỚC executor`);
  }
});

test('công cụ watermark: BÁO CÁO file gốc, không dọn thừa', () => {
  const js = read('scripts/watermark-tool.js');
  assert.match(js, /reportMeta\(f\)/, 'chưa gọi ở onFile');
  assert.match(js, /MS\.inspect\(/, 'phải dùng inspect (chỉ soi, không sửa)');
  // Cả 2 đường đều encode lại (canvas PNG / MediaRecorder WebM) nên đầu ra vốn đã sạch.
  // Gọi scrub lên đó là code chết — khoá lại để sau này không ai "tiện tay" thêm vào.
  assert.ok(!/MS\.scrub\(|scrubUrl\(/.test(js), 'đầu ra đã encode lại — scrub thêm là thừa');
  assert.match(read('pages/watermark-tool.html'), /id="metaMsg"/);
});

// ĐỔI: bản đầu bỏ qua video hoàn toàn và test này khoá đúng hành vi đó. Nay video ĐƯỢC
// xử lý bằng cách ghi đè tại chỗ, nên cái đáng khoá là: KHÔNG bao giờ cắt bớt byte của
// video (cắt là lệch bảng offset stco/Cues → video không tua được).
test('video: ghi đè tại chỗ, TUYỆT ĐỐI không cắt byte', () => {
  const src = read('src/core/MetadataScrubber.js');
  assert.match(src, /function _mp4Void/, 'thiếu đường ghi đè MP4');
  assert.match(src, /function _webmVoid/, 'thiếu đường ghi đè WebM');
  assert.match(src, /inPlace/, 'scrub phải rẽ nhánh riêng cho video');
  // Nhánh video phải trả saved:0 — nếu có ngày ai đó đổi sang cắt thật, dòng này gãy.
  const vb = src.slice(src.indexOf('if (info.inPlace)'), src.indexOf('var keepRanges = []'));
  assert.match(vb, /saved: 0/, 'video mà saved != 0 nghĩa là đã cắt byte — hỏng offset');
  assert.match(vb, /new Uint8Array\(bytes\)/, 'phải copy, không ghi đè mảng của người gọi');
});

test('hỏng thì PHẢI nói ra — mỗi lý do một lần, không spam khi chạy loạt', () => {
  const src = read('src/core/MetadataScrubber.js');
  // Ca đáng làm phiền phải có câu tiếng Việt nói rõ HỆ QUẢ, không phải mã kỹ thuật trần.
  for (const why of ['TẢI_KHÔNG_ĐƯỢC', 'ĐỊNH_DẠNG_LẠ', 'QUÁ_LỚN', 'MÔI_TRƯỜNG_THIẾU']) {
    const m = src.match(new RegExp(`'${why}': '([^']+)'`));
    assert.ok(m, `${why} không có câu giải thích cho người dùng`);
    assert.ok(m[1].length > 30, `${why}: câu quá cụt để hiểu`);
  }
  // "Không có gì để dọn" là kết quả TỐT — báo động ở đây là dạy người dùng bỏ qua cảnh báo.
  assert.ok(!/'KHÔNG_CÓ_GÌ_ĐỂ_DỌN':/.test(src.slice(src.indexOf('var WHY ='), src.indexOf('function _report'))));
  assert.match(src, /if \(_warned\[why\]\) return;/, 'thiếu chặn lặp → chạy 50 ảnh là 50 lần báo');
  assert.match(src, /console\.warn\('\[MetadataScrubber\]'/, 'kênh dev phải luôn ghi để còn lần ra');
});
