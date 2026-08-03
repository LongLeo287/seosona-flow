// Đòn 1 — kiểm phần NỐI DÂY: config api_rate_limits phải thật sự được đọc và dùng.
// Bối cảnh: config này nằm trong _LOCAL_API_CONFIGS từ lâu nhưng KHÔNG nơi nào đọc;
// executor và BatchQueue tự đặt hằng số gấp gáp hơn (3s/2 lần thay vì 10s/5 lần).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');

function loadPCM() {
  const sb = { console };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.chrome = { storage: { local: { get() {}, set() {} }, onChanged: { addListener() {} } }, runtime: { id: 'x' } };
  sb.fetch = () => Promise.resolve({ ok: false });
  vm.createContext(sb);
  vm.runInContext(read('src/core/ProviderConfigManager.js'), sb, { timeout: 20000 });
  return sb.ProviderConfigManager;
}

test('getRateLimitsSync đọc ĐÚNG số trong config, không phải hằng số cũ', () => {
  const limits = loadPCM().getRateLimitsSync('flow');
  assert.equal(limits.maxConcurrent, 5);
  assert.equal(limits.cooldownMs, 10000);
  assert.equal(limits.baseBackoffMs, 10000);
  assert.equal(limits.maxBackoffMs, 300000);
  assert.equal(limits.maxRetries, 5);
  assert.equal(limits.circuitBreakerThreshold, 5);
  assert.equal(limits.circuitBreakerResetMs, 60000);
  assert.notEqual(limits.baseBackoffMs, 3000, 'không được rơi lại về 3s của BatchQueue cũ');
});

test('provider không có config → mặc định AN TOÀN (chậm), KHÔNG throw', () => {
  const PCM = loadPCM();
  const l = PCM.getRateLimitsSync('khong-ton-tai');
  assert.equal(typeof l.maxConcurrent, 'number');
  assert.ok(l.cooldownMs >= 10000, 'thiếu config thì phải chậm, không phải chạy tự do');
  assert.ok(l.maxConcurrent <= 5);
});

test('giá trị rác trong config bị bỏ qua, rơi về mặc định', () => {
  const PCM = loadPCM();
  PCM._apiConfigsCache = { data: { flow: { configs: { api_rate_limits: {
    max_concurrent: 0, cooldown_ms: -5, base_backoff_ms: 'x', max_retries: null,
  } } } } };
  const l = PCM.getRateLimitsSync('flow');
  assert.ok(l.maxConcurrent > 0, '0 là giá trị rác → phải bỏ');
  assert.ok(l.cooldownMs > 0, 'số âm là rác → phải bỏ');
  assert.equal(l.baseBackoffMs, 10000);
  assert.equal(l.maxRetries, 5);
});

// ── Nối dây phía tiêu thụ (kiểm bằng nguồn: 3 file này quá nặng để nạp thật) ──

test('BatchQueue lấy trần retry + độ giãn TỪ config, không hardcode', () => {
  const src = read('src/core/BatchQueue.js');
  assert.match(src, /getRateLimitsSync\?\.\('flow'\)/, 'không đọc config');
  assert.match(src, /this\.autoRetryMax = _lim\.maxRetries/, 'trần retry vẫn hardcode');
  assert.match(src, /this\.autoRetryDelay = _lim\.baseBackoffMs/, 'độ giãn vẫn hardcode');
  assert.ok(!/this\.autoRetryDelay = 3000/.test(src), 'còn sót hằng số 3s cũ');
});

test('BatchQueue phân loại lỗi rồi mới quyết định retry', () => {
  const src = read('src/core/BatchQueue.js');
  assert.match(src, /SEOSONA_RetryPolicy/, 'không dùng bộ phân loại');
  assert.match(src, /verdict\.action === 'halt'/, 'không xử lý halt');
  assert.match(src, /verdict\.action !== 'terminal'/, 'không chặn retry vô ích');
  assert.match(src, /!verdict\.counts \|\|/, 'requeue vẫn bị trần retry chặn');
  assert.match(src, /this\.pause\(\)/, 'halt phải PAUSE (giữ vị trí) chứ không stop');
});

test('BatchQueue chặn vòng lặp vô tận của nhánh requeue', () => {
  const src = read('src/core/BatchQueue.js');
  assert.match(src, /_requeueCount/, 'không đếm số lần xếp lại');
  assert.match(src, /_requeueCount > 10/, 'không có trần cho requeue → có thể lặp mãi');
});

test('BatchQueue lấy category từ eventBus và dùng MỘT LẦN trong 90s', () => {
  const src = read('src/core/BatchQueue.js');
  assert.match(src, /flow:error_classified/, 'không nghe sự kiện phân loại');
  assert.match(src, /90000/, 'thiếu hạn thời gian → lỗi cũ gắn nhầm cho item sau');
  assert.match(src, /this\._lastFlowErr = null; \/\/ consume-once/, 'thiếu consume-once');
});

test('WorkflowExecutor: gen node dùng backoff config + cầu chì + noRetry', () => {
  const src = read('src/core/WorkflowExecutor.js');
  assert.match(src, /_awaitCircuitBreaker/, 'không chờ cầu chì trước khi gửi');
  assert.match(src, /_noteGenFailure/, 'không ghi nhận lỗi vào cầu chì');
  assert.match(src, /err\.noRetry = true/, 'không đánh dấu noRetry cho lỗi terminal');
  assert.match(src, /isGen \? \(limits\.baseBackoffMs/, 'gen node không dùng backoff từ config');
  assert.match(src, /recordSuccess\(\)/, 'thành công không reset chuỗi lỗi');
});

test('WorkflowExecutor: requeue KHÔNG cộng vào cầu chì (là sự cố vận chuyển)', () => {
  const src = read('src/core/WorkflowExecutor.js');
  assert.match(src, /verdict\.action !== 'requeue'/, 'ref hết hạn/rớt mạng bị tính oan làm mở cầu chì');
});

test('WorkflowExecutor: cầu chì reset mỗi lần chạy', () => {
  const src = read('src/core/WorkflowExecutor.js');
  assert.match(src, /this\._circuitBreaker = null;/, 'không reset → lần chạy mới bị nghỉ oan');
});

test('nghỉ cầu chì phải NGẮT được bằng nút Dừng', () => {
  const src = read('src/core/WorkflowExecutor.js');
  const fn = src.slice(src.indexOf('_awaitCircuitBreaker(nodeLog)'));
  assert.match(fn.slice(0, 900), /!this\.shouldStop/, 'vòng chờ không kiểm shouldStop → Dừng không ăn');
});

test('RetryPolicy được nạp TRƯỚC WorkflowExecutor ở cả 3 trang', () => {
  const cfg = JSON.parse(read('config/page-scripts.json'));
  for (const page of ['pages/sidebar.html', 'pages/workflow-editor.html', 'pages/workflow-template-editor.html']) {
    const list = cfg.pages[page];
    const rp = list.findIndex((s) => s.endsWith('workflow/RetryPolicy.js'));
    const we = list.findIndex((s) => s.endsWith('core/WorkflowExecutor.js'));
    assert.ok(rp >= 0, `${page} thiếu RetryPolicy`);
    assert.ok(we >= 0, `${page} thiếu WorkflowExecutor`);
    assert.ok(rp < we, `${page}: RetryPolicy phải nạp TRƯỚC WorkflowExecutor`);
  }
});
