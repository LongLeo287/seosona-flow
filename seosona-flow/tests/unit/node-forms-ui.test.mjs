// Form cấu hình cho 2 node mới + tab Bác sĩ trong Logs.
// Hợp đồng cần khoá: mỗi trường có Ô NHẬP và có ĐƯỜNG LƯU — thiếu một trong hai thì
// người dùng gõ xong, đóng form, và mất trắng (lỗi im lặng, rất khó phát hiện).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const form = read('src/workflow/WorkflowEditorNodeForm.js');

test('entity_ref: 2 trường đều có ô nhập VÀ có đường lưu', () => {
  assert.match(form, /nodeType === 'entity_ref'/, 'thiếu nhánh render');
  for (const [id, field] of [['nodeEntities', 'entities'], ['nodeEntityLabel', 'entity_label']]) {
    assert.ok(form.includes(`id="${id}"`), `form thiếu ô ${id}`);
    assert.ok(form.includes(`'#${id}'`), `save chain thiếu ${id}`);
    assert.ok(form.includes(`data.${field} =`), `không lưu ${field}`);
  }
});

test('entity_ref: hướng dẫn nêu ĐỦ 4 loại và nhắc thứ tự ảnh', () => {
  const block = form.slice(form.indexOf("nodeType === 'entity_ref'"), form.indexOf("nodeType === 'quality_gate'"));
  for (const t of ['character', 'creature', 'location', 'prop']) {
    assert.ok(block.includes(t), `hướng dẫn thiếu loại ${t}`);
  }
  assert.match(block, /đúng thứ tự/i, 'ảnh ghép theo thứ tự — không nói thì người dùng nối lệch');
});

test('entity_ref: nhãn CAST mặc định và không cho rỗng', () => {
  assert.match(form, /data\.entity_label = \(q\('#nodeEntityLabel'\)\?\.value \|\| 'CAST'\)\.trim\(\) \|\| 'CAST'/);
});

test('quality_gate: 3 trường đều có ô nhập VÀ có đường lưu', () => {
  assert.match(form, /nodeType === 'quality_gate'/, 'thiếu nhánh render');
  for (const [id, field] of [['nodeQaThreshold', 'qa_threshold'], ['nodeQaSampling', 'qa_sampling'], ['nodeQaFocus', 'qa_focus']]) {
    assert.ok(form.includes(`id="${id}"`), `form thiếu ô ${id}`);
    assert.ok(form.includes(`'#${id}'`), `save chain thiếu ${id}`);
    assert.ok(form.includes(`data.${field} =`), `không lưu ${field}`);
  }
});

test('quality_gate: ngưỡng bị KẸP về 0–10, giá trị hỏng rơi về mặc định', () => {
  assert.match(form, /Math\.min\(10, Math\.max\(0, th\)\)/, 'ngưỡng ngoài thang là vô nghĩa');
  assert.match(form, /isFinite\(th\) \? .* : 7\.5/, 'nhập rác phải về mặc định chứ không lưu NaN');
});

test('quality_gate: mức lấy mẫu chỉ nhận light|deep', () => {
  assert.match(form, /data\.qa_sampling = q\('#nodeQaSampling'\)\?\.value === 'deep' \? 'deep' : 'light'/);
});

test('quality_gate: form nói rõ lỗi nghiêm trọng luôn trượt bất kể điểm', () => {
  const block = form.slice(form.indexOf("nodeType === 'quality_gate'"), form.indexOf("nodeType === 'text_overlay'"));
  assert.match(block, /nghiêm trọng/, 'không nói thì người dùng tưởng chỉ cần đủ điểm là qua');
});

// ── Tab Bác sĩ ───────────────────────────────────────────────────────────────

test('sidebar có nút tab và vùng chứa cho Bác sĩ', () => {
  const html = read('pages/sidebar.html');
  assert.match(html, /data-subtab="logs-doctor"/, 'thiếu nút tab');
  assert.match(html, /id="logsDoctorContent"/, 'thiếu vùng chứa');
  assert.match(html, /id="flowDoctorContent"/, 'thiếu chỗ render');
});

test('app.js: mở tab Bác sĩ thì ẩn 3 tab kia + khởi tạo LƯỜI', () => {
  const app = read('src/app.js');
  assert.match(app, /doctorContent\?\.classList\.add\(HIDE\)/, 'không ẩn khi chuyển sang tab khác');
  assert.match(app, /target === 'logs-doctor'/, 'không có nhánh xử lý');
  assert.match(app, /FlowDoctorTab\.getInstance\(\) \|\| FlowDoctorTab\.init\(host\)/, 'không khởi tạo lười');
});

test('FlowDoctorTab: escape HTML (nội dung tra cứu đổ thẳng vào innerHTML)', () => {
  const tab = read('src/workflow/FlowDoctorTab.js');
  assert.match(tab, /_esc\(s\)/, 'thiếu hàm escape');
  assert.ok(!/innerHTML = `[^`]*\$\{(?:entry|c)\.(?:title|cause|label)\}/.test(tab),
    'chèn thẳng dữ liệu vào innerHTML mà không escape');
});

test('FlowDoctorTab: đọc chrome.runtime.lastError (không thì Chrome log rác)', () => {
  assert.match(read('src/workflow/FlowDoctorTab.js'), /chrome\.runtime\.lastError/);
});

test('FlowDoctorTab: mở sẵn mục của lỗi vừa xảy ra', () => {
  const tab = read('src/workflow/FlowDoctorTab.js');
  assert.match(tab, /flow:error_classified/, 'không nghe lỗi gần nhất');
  assert.match(tab, /recent && recent\.key === e\.key/, 'không làm nổi mục liên quan');
});

test('FlowDoctorTab được nạp trong sidebar', () => {
  const cfg = JSON.parse(read('config/page-scripts.json'));
  assert.ok(cfg.pages['pages/sidebar.html'].some((s) => s.endsWith('workflow/FlowDoctorTab.js')));
});
