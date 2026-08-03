// P6.T6 tests — media result normalization.
// positive / negative / boundary / regression across: URLs, blobs, MIME,
// dimensions, names, auth, expiry, placeholders, duplicates, and size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const MR = loadClassic('src/providers/MediaResult.js').SEOSONA_MediaResult;
const R = MR.REASONS;

test('positive: a clean https image normalizes with canonical filename', () => {
  const r = MR.normalize({ url: 'https://cdn.host/asset/xyz', mime: 'image/png', width: 1024, height: 768, bytes: 20000, name: 'My Cat!.PNG' });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'image');
  assert.equal(r.mime, 'image/png');
  assert.equal(r.filename, 'MyCat.png');
  assert.equal(r.width, 1024);
});

test('positive: mp4 blob normalizes as video', () => {
  const r = MR.normalize({ url: 'blob:https://host/abc-123', mime: 'video/mp4', bytes: 500000 });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'video');
  assert.ok(r.filename.endsWith('.mp4'));
});

test('negative: cleartext http is rejected by scheme policy', () => {
  assert.equal(MR.normalize({ url: 'http://host/x', mime: 'image/png' }).reason, R.BAD_SCHEME);
});

test('negative: url carrying an access token is rejected', () => {
  const r = MR.normalize({ url: 'https://host/x?access_token=abc123', mime: 'image/png' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, R.AUTH_IN_URL);
});

test('negative: unknown / disallowed MIME fails early', () => {
  assert.equal(MR.normalize({ url: 'https://host/x', mime: 'image/svg+xml' }).reason, R.BAD_MIME);
  assert.equal(MR.normalize({ url: 'https://host/x', mime: 'application/pdf' }).reason, R.BAD_MIME);
});

test('negative: missing url fails', () => {
  assert.equal(MR.normalize({ mime: 'image/png' }).reason, R.NO_URL);
});

test('boundary: tiny dimensions treated as placeholder', () => {
  assert.equal(MR.normalize({ url: 'https://host/x', mime: 'image/png', width: 1, height: 1 }).reason, R.TINY);
});

test('boundary: oversize is rejected', () => {
  assert.equal(MR.normalize({ url: 'https://host/x', mime: 'image/png', bytes: 200 * 1024 * 1024 }).reason, R.TOO_LARGE);
});

test('boundary: expired media (expiresAt <= now) fails', () => {
  assert.equal(MR.normalize({ url: 'https://host/x', mime: 'image/png', expiresAt: 1000 }, { now: 2000 }).reason, R.EXPIRED);
  // not expired
  assert.equal(MR.normalize({ url: 'https://host/x', mime: 'image/png', expiresAt: 5000 }, { now: 2000 }).ok, true);
});

test('boundary: short data URI is a placeholder', () => {
  assert.equal(MR.normalize({ url: 'data:image/gif;base64,R0lGOD', mime: 'image/gif' }).reason, R.PLACEHOLDER);
});

test('boundary: filename cannot traverse or hide', () => {
  const r = MR.normalize({ url: 'https://host/x', mime: 'image/png', name: '../../etc/passwd' });
  assert.ok(!r.filename.includes('/'));
  assert.ok(!r.filename.includes('\\'));
  assert.ok(!r.filename.startsWith('.'));
  assert.ok(r.filename.endsWith('.png'));
});

test('regression: collect dedupes signed URLs pointing at the same asset', () => {
  const list = [
    { url: 'https://cdn/asset/1?sig=aaaaaaaaaaaaaaaaaaaaaaaa', mime: 'image/png', width: 100, height: 100 },
    { url: 'https://cdn/asset/1?sig=bbbbbbbbbbbbbbbbbbbbbbbb', mime: 'image/png', width: 100, height: 100 },
    { url: 'https://cdn/asset/2', mime: 'image/png', width: 100, height: 100 },
    { url: 'http://bad/x', mime: 'image/png' },
  ];
  const { items, rejected, seen } = MR.collect(list);
  assert.equal(seen, 4);
  assert.equal(items.length, 2, 'two unique assets');
  assert.equal(rejected.length, 1, 'one rejected (cleartext)');
});

test('regression: dedupeKey prefers a content hash when given', () => {
  const a = MR.dedupeKey('https://cdn/1?sig=x', 'deadbeef');
  const b = MR.dedupeKey('https://cdn/2?sig=y', 'deadbeef');
  assert.equal(a, b, 'same hash → same key regardless of url');
});
