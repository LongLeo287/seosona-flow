// Nút chuyển ngôn ngữ (VI ⇄ EN) trong header bảng bên.
//
// Hạ tầng i18n đã có đủ từ trước: I18n.setLocale phát 'i18n:changed', app.js nghe rồi gọi
// applyTranslations. Nhưng "có đủ mảnh" không chứng minh "chạy được" — chuỗi này đi qua bốn
// chỗ và chỉ cần một mắt xích im lặng là bấm nút xong chữ vẫn nguyên. Bài này bấm thật.
import { test, expect } from '@playwright/test';
import { launchExtension } from '../../scripts/test/launch-extension.mjs';

let ext;

test.beforeAll(async () => { ext = await launchExtension(); });
test.afterAll(async () => { await ext?.close(); });

async function openSidebar() {
  const page = await ext.context.newPage();
  await page.goto(ext.extensionUrl('pages/sidebar.html'), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#flow-auto-sidebar-root')).toHaveCount(1);
  await page.waitForTimeout(1200); // chờ I18n.init + applyTranslations lần đầu
  return page;
}

test('nút ngôn ngữ tồn tại và hiện cờ', async () => {
  const page = await openSidebar();
  await expect(page.locator('#languageBtn')).toHaveCount(1);
  const alt = await page.locator('#langFlagIcon').getAttribute('alt');
  expect(['VI', 'EN', 'VN']).toContain(alt);
  await page.close();
});

test('bấm nút thì CHỮ đổi thật, không phải chỉ đổi cờ', async () => {
  const page = await openSidebar();

  // Gom mọi chữ có gắn data-i18n — đây là thứ phải đổi.
  const readAll = () => page.$$eval('[data-i18n]', (els) => els.map((e) => e.textContent.trim()).join('|'));

  const before = await readAll();
  const langBefore = await page.evaluate(() => window.I18n?.getLocale?.());

  await page.locator('#languageBtn').click();
  await page.waitForTimeout(700); // setLocale nạp bảng dịch rồi mới phát sự kiện

  const langAfter = await page.evaluate(() => window.I18n?.getLocale?.());
  const after = await readAll();

  expect(langAfter, 'locale phải đổi').not.toBe(langBefore);
  expect(['vi', 'en']).toContain(langAfter);
  expect(after, 'chữ trên giao diện phải đổi theo — nếu bằng nhau là applyTranslations không chạy')
    .not.toBe(before);

  await page.close();
});

test('cờ đổi theo ngôn ngữ', async () => {
  const page = await openSidebar();
  const src0 = await page.locator('#langFlagIcon').getAttribute('src');
  await page.locator('#languageBtn').click();
  await page.waitForTimeout(700);
  const src1 = await page.locator('#langFlagIcon').getAttribute('src');
  expect(src1, 'ảnh cờ phải đổi').not.toBe(src0);
  await page.close();
});

test('lựa chọn được NHỚ sau khi mở lại', async () => {
  const page = await openSidebar();
  const start = await page.evaluate(() => window.I18n?.getLocale?.());
  await page.locator('#languageBtn').click();
  await page.waitForTimeout(700);
  const picked = await page.evaluate(() => window.I18n?.getLocale?.());
  await page.close();

  const again = await openSidebar();
  const restored = await again.evaluate(() => window.I18n?.getLocale?.());
  expect(restored, `mở lại phải giữ ${picked}, không quay về ${start}`).toBe(picked);

  // Trả về mức ban đầu để bài khác không bị ảnh hưởng.
  if (restored !== start) {
    await again.locator('#languageBtn').click();
    await again.waitForTimeout(700);
  }
  await again.close();
});
