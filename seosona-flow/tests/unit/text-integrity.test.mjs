// TextIntegrity tests — deterministic OCR-vs-expected comparison for the Reserve→Overlay QA loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(PKG, 'src/core/TextIntegrity.js'), 'utf8');
const root = {};
new Function('self', src)(root);
const TI = root.TextIntegrity;

test('levenshtein + similarity basics', () => {
  assert.equal(TI.levenshtein('kitten', 'sitting'), 3);
  assert.equal(TI.levenshtein('same', 'same'), 0);
  assert.equal(TI.similarity('', ''), 1);
  assert.ok(TI.similarity('SALE', 'SALE') === 1);
});

test('normalize: case + diacritics + whitespace', () => {
  assert.equal(TI.normalize('  Xin  Chào  '), 'xin chào');
  assert.equal(TI.normalize('Xin Chào', { stripDiacritics: true }), 'xin chao');
  assert.equal(TI.normalize('Đặt Hàng', { stripDiacritics: true }), 'dat hang');
});

test('compare: exact match → pass', () => {
  const r = TI.compare('SALE', 'SALE');
  assert.equal(r.verdict, 'pass');
  assert.equal(r.match, true);
  assert.deepEqual(r.issues, []);
});

test('compare: dropped character → fail/warn with dropped_characters issue', () => {
  const r = TI.compare('SUMMER SALE', 'SUMER SALE'); // dropped one M
  assert.ok(r.issues.includes('dropped_characters'));
  assert.ok(r.similarity < 1);
  assert.ok(['warn', 'fail'].includes(r.verdict));
});

test('compare: garbled → fail', () => {
  const r = TI.compare('SALE', 'S4LE#');
  assert.equal(r.verdict, 'fail');
});

test('compare: unwanted diacritics flagged when expected has none', () => {
  const r = TI.compare('XIN CHAO', 'XIN CHÀO', { expectNoDiacritics: true, stripDiacritics: false });
  assert.ok(r.issues.includes('unwanted_diacritics'));
});

test('compare: wrong_case detected when only case differs', () => {
  const r = TI.compare('Sale', 'SALE', { caseInsensitive: false });
  assert.ok(r.issues.includes('wrong_case'));
});

test('summary: readable message per verdict', () => {
  assert.match(TI.summary(TI.compare('SALE', 'SALE')), /khớp chính xác/);
  const warn = TI.summary(TI.compare('SUMMER SALE', 'SUMER SALE'));
  assert.match(warn, /%\)/);
  assert.match(TI.summary(TI.compare('SALE', 'S4LE#')), /Lệch nhiều/);
  assert.equal(TI.summary(null), '');
});

test('isPass: boolean shorthand for exact match', () => {
  assert.equal(TI.isPass('SALE', 'SALE'), true);
  assert.equal(TI.isPass('SALE', 'S4LE'), false);
});

test('hasDiacritics', () => {
  assert.equal(TI.hasDiacritics('chào'), true);
  assert.equal(TI.hasDiacritics('chao'), false);
  assert.equal(TI.hasDiacritics('Đông'), true);
});
