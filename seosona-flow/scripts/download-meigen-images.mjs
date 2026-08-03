#!/usr/bin/env node
/**
 * Tải ảnh đại diện cho bộ curated MeiGen → data/meigen-images/<id>.<ext>, cập nhật image_local vào JSON.
 * Kiểm INTEGRITY (thông tin phải đúng): id ↔ tên file ↔ tweet-id trong URL khớp; content-type đúng ảnh.
 * Usage: node scripts/download-meigen-images.mjs [curated.json]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = process.argv[2] || join(PKG, 'data/meigen-curated.json');
const IMG_DIR = join(PKG, 'data/meigen-images');
if (!existsSync(IMG_DIR)) mkdirSync(IMG_DIR, { recursive: true });

const extFor = (ct, url) => ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif'
  : /\.png(\?|$)/i.test(url) ? 'png' : 'jpg';

const data = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const results = { ok: 0, fail: 0, bytes: 0, failures: [], mismatch: [] };

async function one(entry) {
  const url = entry.preview_url;
  const tweetId = String(entry.id).replace(/^mg_/, '');
  if (!url) { results.fail++; results.failures.push([entry.id, 'no url']); return; }
  // INTEGRITY 1: URL phải chứa đúng tweet-id của entry (đúng hình cho đúng prompt).
  if (url.indexOf(tweetId) < 0) { results.mismatch.push([entry.id, url]); }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.meigen.ai/' } });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!r.ok) { results.fail++; results.failures.push([entry.id, 'HTTP ' + r.status]); return; }
    // INTEGRITY 2: đúng type — phải là ảnh.
    if (!ct.startsWith('image/')) { results.fail++; results.failures.push([entry.id, 'not image: ' + ct]); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 512) { results.fail++; results.failures.push([entry.id, 'too small ' + buf.length]); return; }
    const ext = extFor(ct, url);
    const fname = entry.id + '.' + ext;              // INTEGRITY 3: tên file = id (khớp entry)
    writeFileSync(join(IMG_DIR, fname), buf);
    entry.image_local = 'data/meigen-images/' + fname;
    entry.image_type = ct;
    entry.image_bytes = buf.length;
    results.ok++; results.bytes += buf.length;
  } catch (e) { results.fail++; results.failures.push([entry.id, String(e.message)]); }
}

// concurrency pool = 6 (lịch sự với CDN)
async function run() {
  const q = data.slice();
  const workers = Array.from({ length: 6 }, async () => { while (q.length) await one(q.shift()); });
  await Promise.all(workers);
  writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
  console.error(`tải: ${results.ok}/${data.length} OK · ${results.fail} fail · ${(results.bytes / 1048576).toFixed(1)} MB`);
  console.error(`integrity: id↔file↔url khớp; ${results.mismatch.length} URL-id mismatch`);
  if (results.failures.length) console.error('failures:', JSON.stringify(results.failures.slice(0, 10)));
  if (results.mismatch.length) console.error('mismatch:', JSON.stringify(results.mismatch.slice(0, 5)));
}
run();
