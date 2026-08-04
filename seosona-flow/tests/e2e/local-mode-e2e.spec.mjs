// P7.T2 — bằng chứng "local mode không gọi backend" (SEC-003).
//
// SỬA LẠI 2026-08-04 (SF-005). Bản cũ hỏng vì THIẾT KẾ, không phải vì sản phẩm sai:
//
//  1. `rec` tích luỹ suốt cả suite, nên bài thứ ba khẳng định trên traffic do hai bài đầu sinh
//     ra. Chạy lẻ thì XANH, chạy đủ ba bài thì ĐỎ — một bài test mà kết quả phụ thuộc thứ tự
//     thì không chứng minh được gì.
//  2. Extension TỰ MỞ tab Google Flow lúc cài. Trang đó kéo phông chữ, reCAPTCHA, thẻ đo của
//     Google — hơn 100 URL. Bản cũ xếp hết vào 'other' rồi bắt lỗi, tức bắt đúng cái nó không
//     nên bắt: đó là trang của nhà cung cấp đang tải tài nguyên của chính nó, không phải
//     extension gọi ra ngoài.
//  3. `installDenyProxy` gắn SAU `launchExtension`, nên giai đoạn cài đặt không được chặn.
//
// Nay mỗi bài tự xoá bộ đếm trước khi chạy, và khẳng định được tách theo NGUỒN GÂY RA:
//   · backend       — phải LUÔN rỗng. Đây là lời hứa thật của chế độ cục bộ.
//   · other         — phải rỗng cho các trang CỦA EXTENSION. Đây là bằng chứng mạnh nhất.
//   · providerAsset — tài nguyên phụ của trang nhà cung cấp; ghi nhận, không bắt lỗi.
import { test, expect } from '@playwright/test';
import { launchExtension } from '../../scripts/test/launch-extension.mjs';
import { installDenyProxy } from '../../scripts/test/network-deny-proxy.mjs';

let ext;
let rec;

test.beforeAll(async () => {
  ext = await launchExtension();
  rec = await installDenyProxy(ext.context);
});

test.afterAll(async () => {
  await ext?.close();
});

// Xoá bộ đếm TRƯỚC mỗi bài — không có dòng này thì thứ tự chạy quyết định kết quả.
test.beforeEach(() => rec.reset());

test('bảng bên: không một lần gọi backend, không traffic lạ', async () => {
  const page = await ext.context.newPage();
  // Ghi chú: khi route đang bật, goto() có thể trả response null cho chrome-extension://
  // dù trang vẫn nạp — nên khẳng định trên DOM đã dựng thay vì trên response.
  await page.goto(ext.extensionUrl('pages/sidebar.html'), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#flow-auto-sidebar-root')).toHaveCount(1);
  await page.waitForTimeout(1500); // chờ mọi việc khởi động hoãn lại kịp chạy
  await page.close();

  expect(rec.backend, `gọi backend ở chế độ cục bộ: ${rec.backend.join(', ')}`).toEqual([]);
  expect(rec.other, `traffic lạ từ trang extension: ${rec.other.join(', ')}`).toEqual([]);
});

test('trang cài đặt: không một lần gọi backend, không traffic lạ', async () => {
  const page = await ext.context.newPage();
  await page.goto(ext.extensionUrl('pages/settings.html'), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForTimeout(1000);
  await page.close();

  expect(rec.backend, `gọi backend: ${rec.backend.join(', ')}`).toEqual([]);
  expect(rec.other, `traffic lạ từ trang cài đặt: ${rec.other.join(', ')}`).toEqual([]);
});

test('trình sửa workflow: không một lần gọi backend', async () => {
  const page = await ext.context.newPage();
  await page.goto(ext.extensionUrl('pages/workflow-editor.html'), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForTimeout(1000);
  await page.close();

  expect(rec.backend, `gọi backend: ${rec.backend.join(', ')}`).toEqual([]);
  expect(rec.other, `traffic lạ: ${rec.other.join(', ')}`).toEqual([]);
});
