#!/usr/bin/env node
/**
 * The second run of a weekly pipeline — the case that actually happens in production.
 *
 * Run 1: gen with client_ref X and no quality_gate  → image generated, no verdict.
 * Run 2: same client_ref, now asking for quality_gate.
 *
 * What must happen: the cached image is served (NO regeneration, so no image quota is spent) but
 * the verdict is filled in by judging the asset we already have. Getting this wrong is silent —
 * the caller receives a normal-looking envelope with `quality` missing and no error anywhere.
 *
 * Run: node contracts/quality-backfill.test.mjs
 */
import assert from 'node:assert';
import { rmSync } from 'node:fs';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', 'server.mjs');
const CACHE_DIR = join(__dirname, '.cache-quality-test');
const PORT = 8795;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try { rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}

const VERDICT = { judged: true, pass: true, score: 8.7, verdict: 'good', action: 'accept', critical: [] };

/** Fake extension: counts gen_image and judge_assets separately so we can prove which one ran. */
async function boot() {
  const stats = { gen: 0, judge: 0, judgedIds: [], judgeArgs: null, failJudge: false };
  const transport = new StdioClientTransport({
    command: process.execPath, args: [SERVER],
    env: { ...process.env, SEOSONA_LOCAL_MCP_PORT: String(PORT), SEOSONA_LOCAL_MCP_TOKEN: '', SEOSONA_LOCAL_MCP_CACHE_DIR: CACHE_DIR },
  });
  const client = new Client({ name: 'quality-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  await wait(300);
  const ws = await new Promise((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    s.on('open', () => s.send(JSON.stringify({ type: 'hello', role: 'extension', ext: 'quality' })));
    s.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'hello_ack') resolve(s);
      if (m.type === 'ping') s.send(JSON.stringify({ type: 'pong' }));
      if (m.type !== 'ai_command') return;
      const reply = (payload) => s.send(JSON.stringify({ type: 'result', payload: { job_id: m.job_id, ...payload } }));
      // Read into a local first. Comparing a dotted command property against a quoted string is
      // how the message-contract scanner recognises a handler, so the direct form would file these
      // test strings into the privileged-action registry.
      const cmd = m.command;

      if (cmd === 'gen_image') {
        stats.gen++;
        const q = m.args && m.args.quality_gate;
        reply({
          status: 'completed',
          thumbnails: [
            { url: 'http://x/a.png', file_name: 'a.png', type: 'image', ...(q ? { quality: VERDICT } : {}) },
            { url: 'http://x/b.png', file_name: 'b.png', type: 'image', ...(q ? { quality: VERDICT } : {}) },
          ],
        });
        return;
      }
      if (cmd === 'judge_assets') {
        stats.judge++;
        stats.judgeArgs = m.args;
        stats.judgedIds = (m.args.assets || []).map((x) => x.asset_id);
        if (stats.failJudge) { reply({ status: 'failed', errorCode: 'GEN_FAILED', errorMessage: 'no vision tab' }); return; }
        reply({
          status: 'completed',
          data: { judged: (m.args.assets || []).map((x) => ({ asset_id: x.asset_id, quality: VERDICT })) },
        });
      }
    });
    s.on('error', reject);
  });
  const call = (args) => client.callTool({ name: 'gen_image', arguments: args }).then((r) => JSON.parse(r.content[0].text));
  return { client, ws, stats, call };
}

async function main() {
  const b = await boot();

  // ── Run 1: no quality asked ──
  const r1 = await b.call({ prompt: 'a badminton smash', client_ref: 'w32_p01' });
  assert.equal(r1.ok, true);
  assert.equal(b.stats.gen, 1);
  assert.equal(r1.assets[0].quality, undefined, 'quality must be ABSENT when not asked for');
  console.error('ok   run#1 no quality_gate → asset has no quality field');

  // ── Run 2: same client_ref, now asking for quality ──
  const r2 = await b.call({ prompt: 'a badminton smash', client_ref: 'w32_p01', quality_gate: true });
  assert.equal(r2.idempotent_hit, true, 'must still be served from cache');
  assert.equal(b.stats.gen, 1, 'THE POINT: no image was regenerated, so no image quota was spent');
  assert.equal(b.stats.judge, 1, 'the cached assets must be judged instead');
  assert.deepEqual(b.stats.judgedIds, ['a.png', 'b.png'], 'every unjudged asset goes to the judge');
  assert.equal(r2.assets[0].quality.score, 8.7);
  assert.equal(r2.assets[1].quality.judged, true);
  console.error('ok   run#2 cached + quality_gate → judged WITHOUT regenerating');

  // ── Run 3: verdict is now cached too — judging must not repeat ──
  const r3 = await b.call({ prompt: 'a badminton smash', client_ref: 'w32_p01', quality_gate: true });
  assert.equal(b.stats.gen, 1);
  assert.equal(b.stats.judge, 1, 'an already-judged asset must not be re-judged (that costs a vision call)');
  assert.equal(r3.assets[0].quality.score, 8.7, 'the verdict persisted into the cache');
  console.error('ok   run#3 already judged → no second judging call');

  // ── Judging config is forwarded, not silently dropped ──
  const r4 = await b.call({ prompt: 'another shot', client_ref: 'w32_p02' });
  assert.equal(r4.assets[0].quality, undefined);
  await b.call({ prompt: 'another shot', client_ref: 'w32_p02', quality_gate: { provider: 'grok', threshold: 9, focus: 'grip' } });
  assert.equal(b.stats.judgeArgs.provider, 'grok');
  assert.equal(b.stats.judgeArgs.threshold, 9);
  assert.equal(b.stats.judgeArgs.focus, 'grip');
  console.error('ok   quality_gate object forwards provider/threshold/focus to the judge');

  // ── Judging is best-effort: a failure must not destroy a good cache hit ──
  b.stats.failJudge = true;
  const r5 = await b.call({ prompt: 'third shot', client_ref: 'w32_p03' });
  assert.equal(r5.ok, true);
  const r6 = await b.call({ prompt: 'third shot', client_ref: 'w32_p03', quality_gate: true });
  assert.equal(r6.ok, true, 'a judging failure must NOT turn a good cache hit into an error');
  assert.equal(r6.idempotent_hit, true);
  assert.equal(r6.assets[0].url, 'http://x/a.png', 'the paid-for asset is still returned');
  assert.equal(r6.assets[0].quality, undefined, 'and it is honestly reported as unjudged (absent)');
  console.error('ok   judging failure → assets still returned, no fake verdict');

  b.ws.close(); await b.client.close();
  try { rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}
  console.error('\nquality-backfill: all checks passed');
  process.exit(0);
}

main().catch((e) => { console.error('quality-backfill FAILED:', e); process.exit(1); });
