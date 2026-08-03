import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../helpers/load-classic.mjs';

function loadStaging() {
  try {
    return loadClassic('src/storage/SourceImportStaging.js').SEOSONA_SourceImportStaging || null;
  } catch (_) {
    return null;
  }
}

const PNG_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
]).toString('base64');

const HTML_AS_IMAGE_BASE64 = Buffer.from('<html></html>').toString('base64');

test('positive: a small valid image import embeds inline and carries source metadata', async () => {
  const S = loadStaging();
  assert.ok(S, 'SourceImportStaging module is available');
  const store = S.createMemoryStore();

  const result = await S.createImagePackage({
    base64: PNG_BASE64,
    mimeType: 'image/png',
    name: 'hero.png',
    sourceUrl: 'https://example.test/hero.png',
    pageUrl: 'https://example.test/page',
  }, {
    id: 'import_inline',
    now: 1000,
    ttlMs: 60000,
    inlineLimitChars: 1000,
    store,
  });

  assert.equal(result.ok, true);
  assert.equal(result.package.importId, 'import_inline');
  assert.equal(result.package.sourceType, 'image');
  assert.equal(result.package.sourceUrl, 'https://example.test/hero.png');
  assert.equal(result.package.pageUrl, 'https://example.test/page');
  assert.equal(result.package.embeddedImage.base64, PNG_BASE64);
  assert.equal(result.package.stagingRef, null);
  assert.equal(result.package.createdAt, 1000);
  assert.equal(result.package.expiresAt, 61000);
  assert.equal((await store.get('import_inline')), null, 'inline imports are not duplicated into staging storage');
});

test('positive: a large image import stores payload behind a seosona staging ref', async () => {
  const S = loadStaging();
  assert.ok(S, 'SourceImportStaging module is available');
  const store = S.createMemoryStore();
  const largeBase64 = PNG_BASE64 + 'a'.repeat(128);

  const result = await S.createImagePackage({
    base64: largeBase64,
    mimeType: 'image/png',
    name: 'large.png',
    sourceUrl: 'https://example.test/large.png',
  }, {
    id: 'import_large',
    now: 2000,
    ttlMs: 60000,
    inlineLimitChars: 16,
    store,
  });

  assert.equal(result.ok, true);
  assert.equal(result.package.embeddedImage, null);
  assert.equal(result.package.stagingRef, 'seosona-staging://import_large');
  const parsed = S.parseStagingRef(result.package.stagingRef);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.id, 'import_large');

  const stored = await store.get('import_large');
  assert.equal(stored.base64, largeBase64);
  assert.equal(stored.mimeType, 'image/png');
  assert.equal(stored.expiresAt, 62000);
});

test('negative: an image MIME with non-image bytes is rejected before staging', async () => {
  const S = loadStaging();
  assert.ok(S, 'SourceImportStaging module is available');
  const store = S.createMemoryStore();

  const result = await S.createImagePackage({
    base64: HTML_AS_IMAGE_BASE64,
    mimeType: 'image/png',
    name: 'fake.png',
  }, {
    id: 'import_fake',
    now: 3000,
    store,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_IMAGE_SIGNATURE');
  assert.equal((await store.get('import_fake')), null);
});

test('boundary: cleanupExpired removes only expired staged payloads', async () => {
  const S = loadStaging();
  assert.ok(S, 'SourceImportStaging module is available');
  const store = S.createMemoryStore();
  await store.put({ id: 'old', expiresAt: 99, base64: 'x' });
  await store.put({ id: 'fresh', expiresAt: 101, base64: 'y' });

  const removed = await S.cleanupExpired(store, 100);

  assert.equal(removed, 1);
  assert.equal((await store.get('old')), null);
  assert.equal((await store.get('fresh')).base64, 'y');
});

test('positive: message handler creates an image import package through the provided store', async () => {
  const S = loadStaging();
  assert.ok(S, 'SourceImportStaging module is available');
  const store = S.createMemoryStore();

  const response = await S.handleMessage({
    action: 'sourceImport:createImage',
    image: {
      base64: PNG_BASE64 + 'a'.repeat(64),
      type: 'image/png',
      name: 'picked.png',
      sourceUrl: 'https://example.test/picked.png',
    },
  }, {
    trusted: true,
    id: 'msg_import',
    now: 5000,
    inlineLimitChars: 8,
    store,
  });

  assert.equal(response.ok, true);
  assert.equal(response.package.stagingRef, 'seosona-staging://msg_import');
  assert.equal((await store.get('msg_import')).name, 'picked.png');
});

test('negative: message handler rejects source import requests from untrusted senders', async () => {
  const S = loadStaging();
  assert.ok(S, 'SourceImportStaging module is available');

  const response = await S.handleMessage({
    action: 'sourceImport:createImage',
    image: { base64: PNG_BASE64, type: 'image/png' },
  }, {
    trusted: false,
    store: S.createMemoryStore(),
  });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'UNTRUSTED_SENDER');
});
