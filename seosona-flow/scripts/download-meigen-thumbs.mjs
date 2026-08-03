#!/usr/bin/env node
/**
 * Tải + THUMBNAIL (ffmpeg 384px) ảnh đại diện cho TOÀN BỘ prompt MeiGen → data/meigen-images/<id>.jpg,
 * cập nhật image_local. Fetch → ffmpeg (pipe, không temp) → save. Integrity: id↔file↔tweet-id.
 * Usage: node scripts/download-meigen-thumbs.mjs [json=data/meigen-prompts.json] [size=384] [conc=5]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = process.argv[2] || join(PKG, 'data/meigen-prompts.json');
const SIZE = Number(process.argv[3]) || 384;
const CONC = Number(process.argv[4]) || 5;
const IMG_DIR = join(PKG, 'data/meigen-images');
if (!existsSync(IMG_DIR)) mkdirSync(IMG_DIR, { recursive: true });

// resize buffer → jpeg thumbnail qua ffmpeg (stdin→stdout, không đụng đĩa tạm)
function thumbnail(buf) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-i', 'pipe:0', '-vf', `scale='min(${SIZE},iw)':-2`, '-q:v', '4', '-f', 'mjpeg', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.on('close', (code) => code === 0 && chunks.length ? resolve(Buffer.concat(chunks)) : reject(new Error('ffmpeg exit ' + code)));
    ff.on('error', reject);
    ff.stdin.on('error', () => {});
    ff.stdin.write(buf); ff.stdin.end();
  });
}

const data = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const res = { ok: 0, fail: 0, bytes: 0, fails: [], mismatch: 0 };

async function one(entry) {
  const url = entry.preview_url;
  const tweetId = String(entry.id).replace(/^mg_/, '');
  if (!url) { res.fail++; res.fails.push([entry.id, 'no url']); return; }
  if (url.indexOf(tweetId) < 0) res.mismatch++;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.meigen.ai/' } });
    if (!r.ok) { res.fail++; res.fails.push([entry.id, 'HTTP ' + r.status]); return; }
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) { res.fail++; res.fails.push([entry.id, 'not image ' + ct]); return; }
    const src = Buffer.from(await r.arrayBuffer());
    if (src.length < 512) { res.fail++; res.fails.push([entry.id, 'tiny']); return; }
    const thumb = await thumbnail(src);
    const fname = entry.id + '.jpg';
    writeFileSync(join(IMG_DIR, fname), thumb);
    entry.image_local = 'data/meigen-images/' + fname;
    entry.image_thumb_px = SIZE;
    entry.image_bytes = thumb.length;
    delete entry.image_type;
    res.ok++; res.bytes += thumb.length;
  } catch (e) { res.fail++; res.fails.push([entry.id, String(e.message).slice(0, 40)]); }
}

async function run() {
  const q = data.slice();
  let done = 0;
  const workers = Array.from({ length: CONC }, async () => {
    while (q.length) { await one(q.shift()); if (++done % 150 === 0) console.error(`… ${done}/${data.length}`); }
  });
  await Promise.all(workers);
  writeFileSync(JSON_PATH, JSON.stringify(data));
  console.error(`THUMBS: ${res.ok}/${data.length} OK · ${res.fail} fail · ${(res.bytes / 1048576).toFixed(1)} MB · ${res.mismatch} url-id mismatch`);
  if (res.fails.length) console.error('fails(10):', JSON.stringify(res.fails.slice(0, 10)));
}
run();
