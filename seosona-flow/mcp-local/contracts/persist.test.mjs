#!/usr/bin/env node
/**
 * Proves persistence (#4) + idempotency (#1) survive a SERVER RESTART.
 * Boot 1: gen with client_ref X (extension hit once) → state.json written.
 * Boot 2 (same cache dir, fresh process): gen with client_ref X → served from the restored cache,
 * the fake extension is NOT hit. Run: node contracts/persist.test.mjs
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
const CACHE_DIR = join(__dirname, '.cache-persist-test');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try { rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}

// One boot cycle: returns how many times the fake extension was asked to gen_image.
async function boot(port) {
  const stats = { gen: 0 };
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, SEOSONA_LOCAL_MCP_PORT: String(port), SEOSONA_LOCAL_MCP_TOKEN: '', SEOSONA_LOCAL_MCP_CACHE_DIR: CACHE_DIR } });
  const client = new Client({ name: 'persist-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  await wait(300);
  const ws = await new Promise((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${port}/`);
    s.on('open', () => s.send(JSON.stringify({ type: 'hello', role: 'extension', ext: 'persist' })));
    s.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'hello_ack') resolve(s);
      if (m.type === 'ping') s.send(JSON.stringify({ type: 'pong' }));
      if (m.type === 'ai_command' && m.command === 'gen_image') {
        stats.gen++;
        s.send(JSON.stringify({ type: 'result', payload: { job_id: m.job_id, status: 'completed', thumbnails: [{ url: 'http://x/a.png', file_name: 'a.png', type: 'image' }] } }));
      }
    });
    s.on('error', reject);
  });
  const call = (args) => client.callTool({ name: 'gen_image', arguments: args }).then((r) => JSON.parse(r.content[0].text));
  return { client, ws, stats, call };
}

async function main() {
  // Boot 1 — generate with a client_ref; extension is hit once; state persists.
  const b1 = await boot(8793);
  const r1 = await b1.call({ prompt: 'a cat', client_ref: 'persistme' });
  assert.equal(r1.ok, true);
  assert.equal(b1.stats.gen, 1);
  console.error('ok   boot#1 gen_image → extension hit once');
  await wait(800); // let the debounced save flush
  b1.ws.close(); await b1.client.close();

  // Boot 2 — fresh process, SAME cache dir: the client_ref is restored from disk.
  const b2 = await boot(8794);
  const r2 = await b2.call({ prompt: 'a cat', client_ref: 'persistme' });
  assert.equal(r2.idempotent_hit, true, 'restart should restore the client_ref cache');
  assert.equal(r2.assets[0].asset_id, 'a.png');
  assert.equal(b2.stats.gen, 0, 'after restart the cached client_ref must NOT re-invoke the extension');
  console.error('ok   boot#2 same client_ref → served from restored cache, extension NOT hit');
  b2.ws.close(); await b2.client.close();

  try { rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}
  console.error('\npersist: all checks passed');
  process.exit(0);
}

main().catch((e) => { console.error('persist FAILED:', e); try { rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {} process.exit(1); });
