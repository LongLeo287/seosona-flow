// TextOverlay layout logic tests — the deterministic word-wrap/balance/nbsp rules that kill
// AI "rớt chữ / rớt dòng". Pure functions tested with a char-count measure (no canvas needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
// Load the IIFE module by evaluating it with a fake `self` root.
const src = readFileSync(join(PKG, 'src/core/TextOverlay.js'), 'utf8');
const root = {};
new Function('self', src)(root);
const TO = root.TextOverlay;
const charMeasure = (s) => s.length; // 1 unit per char

test('TextOverlay module exposes the API', () => {
  assert.equal(typeof TO.wrapLines, 'function');
  assert.equal(typeof TO.balanceLines, 'function');
  assert.equal(typeof TO.bindPairs, 'function');
});

test('wrapLines: greedy wraps at maxWidth (char measure)', () => {
  const lines = TO.wrapLines('the quick brown fox jumps', 9, charMeasure, { pretty: false });
  // "the quick"(9) | "brown fox"(9) | "jumps"
  assert.deepEqual(lines, ['the quick', 'brown fox', 'jumps']);
});

test('wrapLines: pretty avoids a single-word last line (runt)', () => {
  // greedy "one two three" @7 → ["one two","three"] — last line is a lone word (runt).
  const greedy = TO.wrapLines('one two three', 7, charMeasure, { pretty: false });
  assert.deepEqual(greedy, ['one two', 'three']);
  assert.equal(greedy[greedy.length - 1].split(' ').length, 1);
  // pretty pulls "two" down → ["one","two three"] so the last line has >= 2 words.
  const pretty = TO.wrapLines('one two three', 7, charMeasure, { pretty: true });
  assert.ok(pretty[pretty.length - 1].split(' ').length >= 2, 'last line should not be a lone word');
  assert.deepEqual(pretty, ['one', 'two three']);
});

test('wrapLines: empty/whitespace input is safe', () => {
  assert.deepEqual(TO.wrapLines('', 10, charMeasure), ['']);
  assert.deepEqual(TO.wrapLines('   ', 10, charMeasure), ['']);
});

test('bindPairs: number+unit stays glued via nbsp (no line break between)', () => {
  const bound = TO.bindPairs('Chỉ 50 triệu đồng', [['50', 'triệu']]);
  assert.ok(bound.includes('50' + TO.NBSP + 'triệu'));
  // and wrapping treats "50 triệu" as one token (never splits there)
  const lines = TO.wrapLines(bound, 8, charMeasure, { pretty: false });
  assert.ok(lines.every((l) => !/50$/.test(l) || l.includes('50' + TO.NBSP)), 'never end a line right after 50');
});

test('balanceLines: keeps the same line count but evens line lengths', () => {
  const text = 'alpha beta gamma delta epsilon';
  const greedy = TO.wrapLines(text, 18, charMeasure, { pretty: false });
  const balanced = TO.balanceLines(text, 18, charMeasure);
  assert.equal(balanced.length, greedy.length, 'same number of lines');
  // balanced max-line-length should be <= greedy max-line-length (more even / tighter)
  const maxLen = (arr) => Math.max(...arr.map((l) => l.length));
  assert.ok(maxLen(balanced) <= maxLen(greedy));
});

test('balanceLines: single word or short text returns one line', () => {
  assert.deepEqual(TO.balanceLines('Hello', 20, charMeasure), ['Hello']);
});

test('zoneFor: computes a padded band per position preset', () => {
  const c = TO.zoneFor('center', 1000, 500);
  assert.equal(c.x, 80); // 8% of 1000
  assert.equal(c.w, 840);
  const top = TO.zoneFor('top', 1000, 500);
  assert.ok(top.y < c.y); // top band higher
  const bot = TO.zoneFor('bottom', 1000, 500);
  assert.ok(bot.y > c.y); // bottom band lower
});
