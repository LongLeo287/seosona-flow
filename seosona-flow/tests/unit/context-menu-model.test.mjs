import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { loadClassic } from '../helpers/load-classic.mjs';

function loadMenu() {
  try {
    return loadClassic('src/background/ContextMenuModel.js').SEOSONA_ContextMenuModel || null;
  } catch (_) {
    return null;
  }
}

test('positive: extension context title is always the short SEOSONA Flow name', () => {
  const M = loadMenu();
  assert.ok(M, 'ContextMenuModel module is available');

  assert.equal(M.extensionName(), 'SEOSONA Flow');
  assert.equal(M.parentTitle('vi'), 'SEOSONA Flow');
  assert.equal(M.parentTitle('en'), 'SEOSONA Flow');
});

test('positive: consolidated menu has one parent and no standalone duplicate region item', () => {
  const M = loadMenu();
  assert.ok(M, 'ContextMenuModel module is available');

  const items = M.buildItems('vi');
  const parentItems = items.filter((x) => !x.parentId);
  const regionItems = items.filter((x) => x.id === 'seosonaflow-i2p-region');
  const duplicateRegion = items.filter((x) => x.id === 'seosonaflow-i2p-region-page');

  assert.equal(parentItems.length, 1);
  assert.equal(parentItems[0].title, 'SEOSONA Flow');
  assert.equal(JSON.stringify(parentItems[0].contexts), JSON.stringify(['page', 'frame', 'selection', 'link', 'image']));
  assert.equal(regionItems.length, 1);
  assert.equal(regionItems[0].parentId, 'seosonaflow-i2p-parent');
  assert.equal(duplicateRegion.length, 0);
});

test('positive: image save-as submenu exposes PNG, JPEG and WEBP formats', () => {
  const M = loadMenu();
  assert.ok(M, 'ContextMenuModel module is available');

  const items = M.buildItems('vi');
  const saveParent = items.find((x) => x.id === 'seosonaflow-save-image-as');
  const saveChildren = items
    .filter((x) => x.parentId === 'seosonaflow-save-image-as')
    .map((x) => [x.id, x.title, x.format]);

  assert.equal(saveParent.parentId, 'seosonaflow-i2p-parent');
  assert.equal(JSON.stringify(saveChildren), JSON.stringify([
    ['seosonaflow-save-image-as-png', 'PNG', 'png'],
    ['seosonaflow-save-image-as-jpeg', 'JPEG', 'jpeg'],
    ['seosonaflow-save-image-as-webp', 'WEBP', 'webp'],
  ]));
});

test('boundary: download filename is sanitized and receives the requested extension', () => {
  const M = loadMenu();
  assert.ok(M, 'ContextMenuModel module is available');

  assert.equal(M.downloadFilename('https://example.test/path/my image.avif?x=1', 'webp'), 'SEOSONA Flow/my-image.webp');
  assert.equal(M.downloadFilename('https://example.test/', 'jpeg'), 'SEOSONA Flow/image.jpeg');
});

test('negative: unknown save-as menu id is not treated as a supported format', () => {
  const M = loadMenu();
  assert.ok(M, 'ContextMenuModel module is available');

  assert.equal(M.formatFromMenuId('seosonaflow-save-image-as-gif'), null);
});

// ĐẢO CHIỀU 2026-08-04. Bài này trước đây đòi PHẢI CÓ menu "Lưu ảnh" riêng cho magnific.com.
// Mã đó đã gỡ: nó nhắm vào MỘT trang bán ảnh thương mại, không liên quan việc tự động hoá sinh
// ảnh trên tài khoản AI của chính người dùng. Giữ bài test nhưng khoá chiều ngược lại, để không
// ai lặng lẽ thêm lại mã nhắm riêng một trang bên ngoài.
test('regression: KHÔNG còn mục menu nhắm riêng một trang bên ngoài', () => {
  const M = loadMenu();
  assert.ok(M, 'ContextMenuModel module is available');

  const items = M.buildItems('vi');
  const outside = items.filter((x) => JSON.stringify(x.documentUrlPatterns || [])
    .match(/magnific|shutterstock|freepik|pinterest/i));
  // So bằng SỐ LƯỢNG, không deepEqual: module được nạp trong sandbox nên mảng thuộc realm khác,
  // deepStrictEqual sẽ đỏ vì lệch prototype dù nội dung đều rỗng.
  assert.equal(outside.length, 0, `còn mục nhắm riêng trang ngoài: ${outside.map((x) => x.id).join(', ')}`);
  assert.equal(M.formatFromMenuId('seosonaflow-save-image-as-magnific-png'), null,
    'id cũ không còn phân giải ra định dạng nào');
});

test('regression: manifest uses the short SEOSONA Flow name', () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot(), 'seosona-flow/manifest.json'), 'utf8'));

  assert.equal(manifest.name, 'SEOSONA Flow');
  assert.equal(manifest.short_name, 'SEOSONA Flow');
  assert.ok(!manifest.name.includes('Auto Flow'));
});
