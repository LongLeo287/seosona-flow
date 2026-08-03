#!/usr/bin/env node
/**
 * Sinh data/meigen.json (SLIM, lazy-load) từ data/meigen-prompts.json.
 * Chỉ entry CÓ image_local. BỎ source/author/source_url (ảnh AI không bản quyền → không cần attribution).
 * Category trung tính "🎨 Ảnh mẫu". Gallery fetch file này lazy (không parse JS 2.5MB lúc khởi động).
 * Usage: node scripts/gen-meigen-module.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(PKG, 'data/meigen-prompts.json'), 'utf8'));

const slim = data.filter((p) => p.image_local).map((p) => ({
  id: p.id,
  title: p.title,
  content: p.content,
  category: '🎨 Ảnh mẫu',
  tags: p.tags,
  tier: p.tier || 'A',
  kind: 'prompt',
  image_local: p.image_local,
}));

writeFileSync(join(PKG, 'data/meigen.json'), JSON.stringify(slim));
console.error(`data/meigen.json: ${slim.length} entry (có ảnh) · ${(JSON.stringify(slim).length / 1048576).toFixed(2)}MB · KHÔNG attribution`);
