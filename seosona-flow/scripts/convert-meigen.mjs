#!/usr/bin/env node
/**
 * Convert MeiGen-AI-Design-MCP (MIT) trending-prompts.json → Flow dataset.
 * - [BRACKET] placeholder → {brace} (PromptSlots-compatible).
 * - MeiGen category → Flow tags; giữ attribution (author + source_url) theo MIT.
 * - Ảnh: CHỈ giữ 1 preview URL tham chiếu (images.meigen.ai) — KHÔNG tải file (bản quyền tác giả).
 * Xuất: data/meigen-prompts.json (full) + data/meigen-curated.json (top theo score mỗi category).
 *
 * Usage: node scripts/convert-meigen.mjs <raw-trending.json>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = process.argv[2];
if (!RAW) { console.error('cần đường dẫn raw trending-prompts.json'); process.exit(2); }

const CAT_MAP = {
  'Photography': 'meigen-photo',
  'Illustration & 3D': 'meigen-illustration',
  'Product & Brand': 'meigen-product',
  'Food & Drink': 'meigen-food',
  'Poster Design': 'meigen-poster',
  'UI & Graphic': 'meigen-ui',
};

// [OBJECT] / [SCENE 1] → {object} / {scene_1}
function convertPlaceholders(s) {
  return String(s || '').replace(/\[([A-Za-z][A-Za-z0-9_ /-]{0,40})\]/g, (m, g) =>
    '{' + g.trim().toLowerCase().replace(/[ /-]+/g, '_').replace(/[^a-z0-9_]/g, '') + '}');
}

function title(p) {
  const first = String(p.prompt || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const t = convertPlaceholders(first).replace(/\s+/g, ' ').slice(0, 64);
  return t || ('MeiGen #' + (p.rank || p.id));
}

function toFlow(p) {
  const cats = Array.isArray(p.categories) ? p.categories : [];
  const tags = cats.map((c) => (c || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean);
  const previews = [].concat(p.images || [], p.image || []).filter(Boolean);
  const cat0 = cats[0] || '';
  return {
    id: 'mg_' + p.id,
    title: title(p),
    content: String(p.prompt || ''),          // VERBATIM — giữ nguyên gốc (thông tin phải đúng)
    content_slots: convertPlaceholders(p.prompt), // bản {brace} phái sinh cho PromptSlots (tuỳ dùng)
    has_brackets: /\[[A-Za-z][A-Za-z0-9_ /-]*\]/.test(p.prompt || ''),
    category: CAT_MAP[cat0] || 'meigen',
    category_label: cat0,                      // nhãn gốc MeiGen (đúng type/nhóm)
    tags: ['meigen'].concat(tags).slice(0, 6),
    model_hint: p.model || '',
    preview_url: previews[0] || '',            // ảnh đại diện (đúng hình cho prompt này)
    image_count: previews.length,
    attribution: { author: p.author_name || p.author || '', source_url: p.source_url || '', license: 'MIT (MeiGen-AI-Design-MCP)' },
    score: Number(p.score) || 0,
    likes: Number(p.likes) || 0,
    tier: 'A', kind: 'prompt', source_repo: 'jau123/MeiGen-AI-Design-MCP',
  };
}

const raw = JSON.parse(readFileSync(RAW, 'utf8'));
const full = raw.map(toFlow);

// Curated: top N theo score mỗi category (đa dạng, không thiên 1 nhóm).
const PER_CAT = Number(process.argv[3]) || 20;
const byCat = {};
for (const p of full) (byCat[p.category] = byCat[p.category] || []).push(p);
const curated = [];
for (const c of Object.keys(byCat)) {
  curated.push(...byCat[c].sort((a, b) => (b.score - a.score) || (b.likes - a.likes)).slice(0, PER_CAT));
}

const OUT = join(PKG, 'data');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'meigen-prompts.json'), JSON.stringify(full));
writeFileSync(join(OUT, 'meigen-curated.json'), JSON.stringify(curated, null, 2));

console.error(`full: ${full.length} · curated: ${curated.length} (${PER_CAT}/category × ${Object.keys(byCat).length})`);
console.error('placeholders converted, images kept as reference URLs only (not downloaded).');
console.error('sample curated:', JSON.stringify(curated[0]).slice(0, 400));
