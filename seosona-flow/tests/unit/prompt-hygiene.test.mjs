// Đòn 7 — chuẩn hoá âm thanh prompt video + sửa media_id hỏng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const root = {};
new Function('self', readFileSync(join(PKG, 'src/core/PromptHygiene.js'), 'utf8'))(root);
const PH = root.PromptHygiene;

test('chèn câu chặn nhạc nền vào cuối prompt video', () => {
  const out = PH.normalizeVideoAudio('Cô gái đi bộ trên phố, máy quay lia ngang');
  assert.match(out, /no background music, keep natural sound effects\.$/);
});

test('không chèn hai lần khi chạy lại', () => {
  const once = PH.normalizeVideoAudio('Cảnh A');
  assert.equal(PH.normalizeVideoAudio(once), once);
});

test('TÔN TRỌNG ý người dùng: đã tự nói về âm thanh thì không chèn đè', () => {
  for (const p of [
    'Cảnh A, with upbeat background music',
    'Cảnh A, nhạc nền sôi động',
    'Cảnh A, có lồng tiếng nam',
    'Cảnh A, no music at all',
  ]) {
    assert.equal(PH.normalizeVideoAudio(p), p, `đã chèn đè: ${p}`);
  }
});

test('force=true thì chèn bất chấp (dùng khi workflow ép video câm)', () => {
  const p = 'Cảnh A, nhạc nền sôi động';
  assert.notEqual(PH.normalizeVideoAudio(p, { force: true }), p);
});

test('prompt rỗng / null → giữ nguyên, không sinh prompt rác', () => {
  assert.equal(PH.normalizeVideoAudio(''), '');
  assert.equal(PH.normalizeVideoAudio('   '), '   ');
  assert.equal(PH.normalizeVideoAudio(null), '');
});

test('nối câu gọn: prompt đã có dấu chấm thì không ra ".."', () => {
  assert.match(PH.normalizeVideoAudio('Cảnh A.'), /Cảnh A\. no background/);
  assert.ok(!PH.normalizeVideoAudio('Cảnh A.').includes('..'));
  assert.match(PH.normalizeVideoAudio('Cảnh A'), /Cảnh A\. no background/);
});

// ── media_id ─────────────────────────────────────────────────────────────────

const UUID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

test('UUID hợp lệ đi qua nguyên vẹn, không bị đánh dấu là đã sửa', () => {
  const r = PH.repairMediaId(UUID);
  assert.deepEqual(r, { ok: true, id: UUID, fixed: false, reason: null });
});

test('rút UUID khỏi chuỗi CAMS… (nguyên nhân thật của "entity was not found")', () => {
  const r = PH.repairMediaId('CAMS_abc123/' + UUID);
  assert.equal(r.ok, true);
  assert.equal(r.id, UUID);
  assert.equal(r.fixed, true);
  assert.match(r.reason, /^EXTRACTED_FROM_/);
});

test('chữ HOA trong UUID được chuẩn hoá về thường', () => {
  assert.equal(PH.repairMediaId(UUID.toUpperCase()).id, UUID);
});

test('không có UUID → trả null, KHÔNG lặng lẽ trả lại chuỗi hỏng', () => {
  const r = PH.repairMediaId('CAMS_khong_co_uuid');
  assert.equal(r.ok, false);
  assert.equal(r.id, null, 'trả lại chuỗi gốc sẽ khiến id hỏng đi tiếp xuống dưới');
  assert.equal(r.reason, 'NO_UUID_FOUND');
});

test('rỗng / null → EMPTY, phân biệt với NO_UUID_FOUND', () => {
  assert.equal(PH.repairMediaId('').reason, 'EMPTY');
  assert.equal(PH.repairMediaId(null).reason, 'EMPTY');
  assert.equal(PH.repairMediaId('   ').reason, 'EMPTY');
});

test('isUuid không nhận chuỗi CHỨA uuid nhưng dài hơn', () => {
  assert.equal(PH.isUuid(UUID), true);
  assert.equal(PH.isUuid('CAMS/' + UUID), false, 'chứa ≠ là');
  assert.equal(PH.isUuid('khong-phai-uuid'), false);
});

test('sửa cả loạt: đếm số đã sửa và báo ĐÍCH DANH cái hỏng', () => {
  const r = PH.repairMany([UUID, 'CAMS_x/' + UUID, 'rac', '']);
  assert.deepEqual(r.ids, [UUID, UUID]);
  assert.equal(r.fixed, 1);
  assert.deepEqual(r.broken, ['rac', ''], 'cái hỏng phải nêu ra, không im lặng bỏ');
});

// ── Nối dây ───────────────────────────────────────────────────────────────────

test('executor gọi _hygienicPrompt thay vì gõ thẳng node.prompt', () => {
  const src = readFileSync(join(PKG, 'src/core/WorkflowExecutor.js'), 'utf8');
  assert.match(src, /_insertPrompt\(this\._hygienicPrompt\(node, isVid, nodeLog\)\)/);
  assert.match(src, /_hygienicPrompt\(node, isVideo, nodeLog\)/, 'thiếu hàm');
});

test('chỉ áp cho VIDEO — prompt ảnh không bị đụng', () => {
  const src = readFileSync(join(PKG, 'src/core/WorkflowExecutor.js'), 'utf8');
  assert.match(src, /if \(!isVideo\) return raw;/);
});

test('có công tắc tắt ở cấp node (audio_normalize=false) và ép câm (force_silent)', () => {
  const src = readFileSync(join(PKG, 'src/core/WorkflowExecutor.js'), 'utf8');
  assert.match(src, /node\.audio_normalize === false/);
  assert.match(src, /force: node\.force_silent === true/);
});

test('3 module mới được nạp ở cả 3 trang', () => {
  const cfg = JSON.parse(readFileSync(join(PKG, 'config/page-scripts.json'), 'utf8'));
  for (const p of ['pages/sidebar.html', 'pages/workflow-editor.html', 'pages/workflow-template-editor.html']) {
    for (const m of ['EntitySheet', 'VideoChain', 'PromptHygiene']) {
      assert.ok(cfg.pages[p].some((s) => s.endsWith(`core/${m}.js`)), `${p} thiếu ${m}`);
    }
  }
});
