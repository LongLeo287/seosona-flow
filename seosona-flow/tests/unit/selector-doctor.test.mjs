// SelectorDoctor tests — chẩn đoán selector gãy khi upstream đổi UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(PKG, 'src/core/SelectorDoctor.js'), 'utf8');

function fresh() {
  const root = {};
  new Function('self', src)(root);
  return root.SelectorDoctor;
}

test('not_found + chưa từng ok → xếp vào BROKEN (nghi upstream đổi UI)', () => {
  const SD = fresh();
  SD.record('flow', 'submit_button', 'not_found', { selectors: ['button.submit'], version: 39 });
  SD.record('flow', 'submit_button', 'not_found', { selectors: ['button.submit'], version: 39 });
  const r = SD.report();
  assert.equal(r.broken.length, 1);
  assert.equal(r.broken[0].key, 'submit_button');
  assert.equal(r.broken[0].notFound, 2);
  assert.equal(r.broken[0].version, 39);
  assert.equal(r.flaky.length, 0);
});

test('có ok lẫn not_found → FLAKY, không phải broken (tránh báo động giả do timing)', () => {
  const SD = fresh();
  SD.record('flow', 'tile', 'ok', { selectors: ['.tile'] });
  SD.record('flow', 'tile', 'not_found', { selectors: ['.tile'] });
  const r = SD.report();
  assert.equal(r.broken.length, 0);
  assert.equal(r.flaky.length, 1);
  assert.equal(r.flaky[0].key, 'tile');
});

test('no_config → nhóm riêng THIẾU CẤU HÌNH', () => {
  const SD = fresh();
  SD.record('grok', 'cdn_image', 'no_config');
  const r = SD.report();
  assert.equal(r.noConfig.length, 1);
  assert.equal(r.broken.length, 0);
  assert.equal(r.noConfig[0].provider, 'grok');
});

test('toàn ok → không có gì để sửa', () => {
  const SD = fresh();
  SD.record('flow', 'a', 'ok'); SD.record('flow', 'a', 'ok'); SD.record('flow', 'b', 'ok');
  const r = SD.report();
  assert.equal(r.broken.length + r.flaky.length + r.noConfig.length, 0);
  assert.equal(r.okCount, 3);
  assert.match(SD.reportText(), /Selector OK/);
});

test('reportText nêu ĐÚNG key + selector đang dùng (để sửa 1 dòng config)', () => {
  const SD = fresh();
  SD.record('flow', 'prompt_input', 'not_found', { selectors: ['textarea#p', '.p-input'], version: 84 });
  const t = SD.reportText();
  assert.match(t, /GÃY/);
  assert.match(t, /prompt_input/);
  assert.match(t, /config_version 84/);
  assert.match(t, /textarea#p/, 'phải in ra selector đang dùng để biết sửa gì');
});

test('sắp xếp: hỏng nhiều nhất lên đầu', () => {
  const SD = fresh();
  SD.record('flow', 'ít', 'not_found', { selectors: ['x'] });
  for (let i = 0; i < 5; i++) SD.record('flow', 'nhiều', 'not_found', { selectors: ['y'] });
  assert.equal(SD.report().broken[0].key, 'nhiều');
});

test('chống phình: giới hạn số key theo dõi', () => {
  const SD = fresh();
  for (let i = 0; i < 400; i++) SD.record('flow', 'k' + i, 'not_found');
  assert.ok(SD.report().tracked <= 200, 'phải chặn ở MAX_ENTRIES');
});

test('không bao giờ throw dù input rác (chẩn đoán không được phá luồng chính)', () => {
  const SD = fresh();
  assert.doesNotThrow(() => {
    SD.record(null, undefined, 'not_found');
    SD.record('flow', 'k', 'outcome-lạ');
    SD.record('flow', 'k', 'not_found', { selectors: 'a, b, c', version: null });
    SD.reportText();
  });
});

test('selectors dạng chuỗi được tách thành mảng', () => {
  const SD = fresh();
  SD.record('flow', 'k', 'not_found', { selectors: '.a, .b' });
  assert.deepEqual(SD.report().broken[0].selectors, ['.a', '.b']);
});

test('reset xoá sạch', () => {
  const SD = fresh();
  SD.record('flow', 'k', 'not_found');
  SD.reset();
  assert.equal(SD.report().tracked, 0);
});
