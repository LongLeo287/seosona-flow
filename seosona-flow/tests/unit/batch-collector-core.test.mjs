import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../helpers/load-classic.mjs';

function loadCollector() {
  try {
    return loadClassic('src/capture/BatchCollectorCore.js').SEOSONA_BatchCollectorCore || null;
  } catch (_) {
    return null;
  }
}

test('positive: collector keeps candidates intersecting the drag rectangle in reading order', () => {
  const C = loadCollector();
  assert.ok(C, 'BatchCollectorCore module is available');

  const result = C.collect([
    { kind: 'link', url: 'https://example.test/b', text: 'B', rect: { x: 20, y: 40, width: 10, height: 10 } },
    { kind: 'link', url: 'https://example.test/a', text: 'A', rect: { x: 10, y: 10, width: 10, height: 10 } },
    { kind: 'link', url: 'https://example.test/out', text: 'Out', rect: { x: 500, y: 500, width: 10, height: 10 } },
  ], {
    rect: { x: 0, y: 0, width: 100, height: 100 },
    mode: 'links',
  });

  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result.items.map((x) => x.text)), JSON.stringify(['A', 'B']));
});

test('positive: collector dedupes by URL or source key', () => {
  const C = loadCollector();
  assert.ok(C, 'BatchCollectorCore module is available');

  const result = C.collect([
    { kind: 'link', url: 'https://example.test/a', text: 'A1', rect: { x: 0, y: 0, width: 20, height: 20 } },
    { kind: 'link', url: 'https://example.test/a', text: 'A2', rect: { x: 0, y: 30, width: 20, height: 20 } },
    { kind: 'image', src: 'https://example.test/a.png', rect: { x: 0, y: 60, width: 20, height: 20 } },
    { kind: 'image', src: 'https://example.test/a.png', rect: { x: 0, y: 90, width: 20, height: 20 } },
  ], {
    rect: { x: 0, y: 0, width: 100, height: 120 },
    mode: 'mixed',
  });

  assert.equal(JSON.stringify(result.items.map((x) => x.text || x.src)), JSON.stringify(['A1', 'https://example.test/a.png']));
});

test('boundary: collector caps output and reports truncation', () => {
  const C = loadCollector();
  assert.ok(C, 'BatchCollectorCore module is available');

  const result = C.collect(Array.from({ length: 5 }, (_, i) => ({
    kind: 'link',
    url: `https://example.test/${i}`,
    rect: { x: 0, y: i * 10, width: 5, height: 5 },
  })), {
    rect: { x: 0, y: 0, width: 100, height: 100 },
    maxItems: 3,
  });

  assert.equal(result.items.length, 3);
  assert.equal(result.truncated, true);
});

test('negative: invalid drag rectangle is rejected without returning page items', () => {
  const C = loadCollector();
  assert.ok(C, 'BatchCollectorCore module is available');

  const result = C.collect([
    { kind: 'link', url: 'https://example.test/a', rect: { x: 0, y: 0, width: 20, height: 20 } },
  ], {
    rect: { x: 0, y: 0, width: 0, height: 20 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_RECT');
  assert.equal(result.items.length, 0);
});

test('positive: message handler collects batch candidates for extension callers', async () => {
  const C = loadCollector();
  assert.ok(C, 'BatchCollectorCore module is available');

  const response = await C.handleMessage({
    action: 'batchCollector:collect',
    candidates: [
      { kind: 'image', src: 'https://example.test/a.png', rect: { x: 5, y: 5, width: 20, height: 20 } },
    ],
    rect: { x: 0, y: 0, width: 100, height: 100 },
    mode: 'images',
  }, { trusted: true });

  assert.equal(response.ok, true);
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].src, 'https://example.test/a.png');
});

test('negative: message handler rejects untrusted batch collector calls', async () => {
  const C = loadCollector();
  assert.ok(C, 'BatchCollectorCore module is available');

  const response = await C.handleMessage({
    action: 'batchCollector:collect',
    candidates: [],
    rect: { x: 0, y: 0, width: 100, height: 100 },
  }, { trusted: false });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'UNTRUSTED_SENDER');
});
