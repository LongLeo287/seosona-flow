// PngText tests — embed/read a tEXt chunk in a PNG (ComfyUI-style reproducibility metadata).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(PKG, 'src/core/PngText.js'), 'utf8');
const root = {};
new Function('self', src)(root);
const PT = root.PngText;

// A real 1x1 transparent PNG.
const PNG1x1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
));

test('isPng detects the signature', () => {
  assert.equal(PT.isPng(PNG1x1), true);
  assert.equal(PT.isPng(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), false);
});

test('insertText + readText round-trip', () => {
  const spec = JSON.stringify({ model: 'Nano Banana Pro', ratio: '9:16', prompt: 'xin chào' });
  const out = PT.insertText(PNG1x1, PT.SPEC_KEY, spec);
  assert.ok(out.length > PNG1x1.length, 'output grew by the chunk');
  assert.equal(PT.readText(out, PT.SPEC_KEY), spec);
  assert.equal(PT.isPng(out), true, 'still a valid PNG (signature intact)');
});

test('IEND stays last after insert', () => {
  const out = PT.insertText(PNG1x1, 'k', 'v');
  const tail = out.subarray(out.length - 8); // IEND chunk = len(4)0 + "IEND" + crc(4) → last 8 bytes are "IEND"+crc
  assert.equal(String.fromCharCode(tail[0], tail[1], tail[2], tail[3]), 'IEND');
});

test('readText returns null for missing keyword', () => {
  assert.equal(PT.readText(PNG1x1, 'nope'), null);
});

test('multiple keys via readAll', () => {
  let out = PT.insertText(PNG1x1, 'a', '1');
  out = PT.insertText(out, 'b', '2');
  const all = PT.readAll(out);
  assert.equal(all.a, '1');
  assert.equal(all.b, '2');
});

test('non-PNG input is returned unchanged', () => {
  const junk = Uint8Array.from([1, 2, 3]);
  assert.deepEqual(PT.insertText(junk, 'k', 'v'), junk);
});

test('Vietnamese text round-trips losslessly (UTF-8)', () => {
  const spec = JSON.stringify({ text: 'GIẢM 50% — Ưu đãi Tết', model: 'Nano Banana Pro' });
  const out = PT.insertText(PNG1x1, PT.SPEC_KEY, spec);
  assert.equal(PT.readText(out, PT.SPEC_KEY), spec);
  assert.deepEqual(JSON.parse(PT.readText(out, PT.SPEC_KEY)).text, 'GIẢM 50% — Ưu đãi Tết');
});

test('CRC32 matches known value ("123456789" = 0xCBF43926)', () => {
  const bytes = Uint8Array.from('123456789'.split('').map((c) => c.charCodeAt(0)));
  assert.equal(PT.crc32(bytes) >>> 0, 0xcbf43926);
});
