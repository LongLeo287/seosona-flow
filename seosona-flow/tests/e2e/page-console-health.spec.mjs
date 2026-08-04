// Sức khoẻ lúc CHẠY THẬT của mọi trang extension.
//
// Quét tĩnh không thấy được lỗi runtime: biến chưa khai, gọi hàm không tồn tại, tài nguyên 404,
// promise bị từ chối không ai bắt. Bài này mở từng trang bằng trình duyệt thật rồi đọc console.
//
// Đây là lưới an toàn RỘNG chứ không nhắm một lỗi cụ thể — nó bắt loại lỗi "trang vẫn hiện
// nhưng một nửa tính năng chết im" mà người dùng chỉ phát hiện khi bấm vào mới thấy không chạy.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtension } from '../../scripts/test/launch-extension.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PAGES = readdirSync(join(root, 'pages')).filter((f) => f.endsWith('.html')).sort();

let ext;
test.beforeAll(async () => { ext = await launchExtension(); });
test.afterAll(async () => { await ext?.close(); });

// Tiếng ồn đã biết, KHÔNG phải lỗi của ta:
//  · Chrome kêu ca về favicon khi trang extension không khai icon.
//  · Vài API chỉ có khi trang được mở đúng ngữ cảnh side-panel.
const KNOWN_NOISE = /favicon|net::ERR_FILE_NOT_FOUND.*favicon|sidePanel|Extension context invalidated/i;

for (const page of PAGES) {
  test(`trang ${page} mở được, không lỗi console`, async () => {
    const p = await ext.context.newPage();
    const errors = [];
    const rejections = [];

    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (KNOWN_NOISE.test(t)) return;
      errors.push(t.slice(0, 220));
    });
    p.on('pageerror', (e) => rejections.push(String(e.message).slice(0, 220)));

    await p.goto(ext.extensionUrl(`pages/${page}`), { waitUntil: 'domcontentloaded' });
    await expect(p.locator('body')).toBeVisible();
    await p.waitForTimeout(1800); // để việc khởi động hoãn lại kịp chạy và kịp nổ

    await p.close();

    // Lỗi KHÔNG BẮT ĐƯỢC (pageerror) nặng hơn console.error: nó cắt ngang luồng đang chạy.
    expect(rejections, `${page} — lỗi không bắt được:\n  ${rejections.join('\n  ')}`).toEqual([]);
    expect(errors, `${page} — console.error:\n  ${errors.join('\n  ')}`).toEqual([]);
  });
}
