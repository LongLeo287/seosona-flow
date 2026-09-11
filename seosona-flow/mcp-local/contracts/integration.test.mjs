#!/usr/bin/env node
/**
 * End-to-end smoke test for the Flow MCP server WITHOUT the real Chrome extension.
 * Boots server.mjs, connects a FAKE extension over the loopback WS (canned ai_command replies),
 * then drives the server as an MCP client over stdio: initialize → tools/list → resources/list →
 * a discovery call (list_capabilities) and a gen call (gen_image) → asserts the Flow↔V2 envelope.
 *
 * Run: node contracts/integration.test.mjs   (exit 0 = pass)
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
const PORT = 8791; // avoid the default 8765 in case a real server is running
const TOKEN = 'integration-token-at-least-16-characters';
// Isolated, always-fresh cache so idempotency/persist state never leaks between runs.
const CACHE_DIR = join(__dirname, '.cache-test');
try { rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Counts how often the extension is actually asked to generate — proves idempotency skips it.
const stats = { genImage: 0 };

// Fake extension: connect as the WS client the bridge would be, answer ai_command with canned results.
function fakeExtension() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', role: 'extension', ext: 'fake-test', token: TOKEN, nonce: 'integration-nonce' })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'hello_ack') resolve(ws);
      if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      if (m.type === 'ai_command') {
        const { job_id, command } = m;
        let payload;
        if (command === 'list_capabilities') {
          payload = { data: { provider: 'flow', ratios: ['9:16'], video_models: [{ value: 'Veo 3.1 Quality', supports_voice: true }], voices: [{ slug: 'aoede' }], voice_supported_video_models: ['Veo 3.1 Quality'] } };
        } else if (command === 'gen_image') {
          stats.genImage++;
          // stream a progress tick before the final result (tests #6)
          ws.send(JSON.stringify({ type: 'progress', payload: { job_id, progress: 1, total: 2, message: 'generating' } }));
          payload = { thumbnails: [{ url: 'http://x/a.png', thumbnail: 'http://x/a_t.png', file_name: 'a.png', type: 'image', provider: 'flow' }] };
        } else if (command === 'export_asset') {
          payload = { data: { download: { folder: 'seosonaflow_mcp', file_name: 'clip.mp4', path_hint: 'Downloads/seosonaflow_mcp/clip.mp4', status: 'completed' } } };
        } else if (command === 'list_projects') {
          payload = { data: { projects: [{ project_id: 'p1', project_name: 'Proj 1', last_accessed: 2 }], count: 1 } };
        } else if (command === 'search_prompts') {
          const one = { id: 'img_x', title: 'Studio portrait', text: 'a studio portrait', tags: ['portrait'] };
          payload = { data: { prompts: [one], count: 1, total: 1 } };
        } else {
          payload = { data: { echo: command } };
        }
        ws.send(JSON.stringify({ type: 'result', payload: { job_id, status: 'completed', ...payload } }));
      }
    });
    ws.on('error', reject);
  });
}

async function main() {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, SEOSONA_LOCAL_MCP_PORT: String(PORT), SEOSONA_LOCAL_MCP_TOKEN: TOKEN, SEOSONA_LOCAL_MCP_CACHE_DIR: CACHE_DIR } });
  const client = new Client({ name: 'integration-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  // Give the WS server a beat to bind, then attach the fake extension.
  await wait(300);
  const extWs = await fakeExtension();

  // tools/list — expect the full surface (15 tools).
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.ok(tools.length >= 20, `expected >=20 tools, got ${tools.length}`);
  for (const need of ['gen_image', 'gen_video', 'run_workflow', 'upload_ref', 'export_asset', 'list_capabilities', 'list_voices', 'list_models', 'list_workflows', 'list_projects', 'search_prompts', 'get_context', 'get_provider_status', 'list_results', 'create_project', 'open_project', 'memory_search', 'memory_add', 'health', 'cancel_job']) {
    assert.ok(names.includes(need), `missing tool ${need}`);
  }
  // #2 — every tool must declare an outputSchema.
  assert.ok(tools.every((t) => t.outputSchema && t.outputSchema.type === 'object'), 'a tool is missing outputSchema');
  console.error(`ok   tools/list → ${tools.length} tools (all with outputSchema)`);

  // resources/list — contract + capabilities.
  const { resources } = await client.listResources();
  const uris = resources.map((r) => r.uri);
  assert.ok(uris.includes('seosona://contract'), 'missing contract resource');
  assert.ok(uris.includes('seosona://capabilities'), 'missing capabilities resource');
  console.error(`ok   resources/list → ${resources.length} resources`);

  // read the contract resource (served from disk).
  const contract = await client.readResource({ uri: 'seosona://contract' });
  const contractJson = JSON.parse(contract.contents[0].text);
  assert.equal(contractJson.$id, 'seosona://contract');
  console.error('ok   read seosona://contract');

  // discovery call → envelope.data preserved.
  const capRes = await client.callTool({ name: 'list_capabilities', arguments: {} });
  const capEnv = JSON.parse(capRes.content[0].text);
  assert.equal(capEnv.ok, true);
  assert.equal(capEnv.tool, 'list_capabilities');
  assert.deepEqual(capEnv.data.voice_supported_video_models, ['Veo 3.1 Quality']);
  console.error('ok   call list_capabilities → data preserved');

  // gen call → thumbnails become FlowAsset[] + structuredContent + streamed progress (#2, #6).
  const progressTicks = [];
  const genRes = await client.callTool(
    { name: 'gen_image', arguments: { prompt: 'a cat', client_ref: 'scene1' } },
    undefined,
    { onprogress: (p) => progressTicks.push(p) },
  );
  const genEnv = JSON.parse(genRes.content[0].text);
  assert.equal(genEnv.ok, true);
  assert.equal(genEnv.assets.length, 1);
  assert.equal(genEnv.assets[0].asset_id, 'a.png');
  assert.equal(genEnv.assets[0].kind, 'image');
  assert.ok(genRes.structuredContent && genRes.structuredContent.ok === true, 'missing structuredContent');
  assert.equal(stats.genImage, 1);
  assert.ok(progressTicks.length >= 1, 'expected a progress notification');
  assert.equal(progressTicks[0].progress, 1);
  assert.equal(progressTicks[0].total, 2);
  console.error('ok   call gen_image → FlowAsset[] + structuredContent + progress notification');

  // #1 idempotency — a repeat with the same client_ref returns the cache WITHOUT re-invoking the extension.
  const genRes2 = await client.callTool({ name: 'gen_image', arguments: { prompt: 'a cat', client_ref: 'scene1' } });
  const genEnv2 = JSON.parse(genRes2.content[0].text);
  assert.equal(genEnv2.idempotent_hit, true);
  assert.equal(genEnv2.assets[0].asset_id, 'a.png');
  assert.equal(stats.genImage, 1, 'idempotent call must NOT re-invoke the extension');
  console.error('ok   idempotent gen_image → cached, extension not re-hit');

  // health → server-answered, reports the connected fake extension + versions.
  const healthRes = await client.callTool({ name: 'health', arguments: {} });
  const health = JSON.parse(healthRes.content[0].text);
  assert.equal(health.ok, true);
  assert.equal(health.data.extension_connected, true);
  assert.equal(health.data.auth, 'token');
  assert.ok(health.data.server_version && health.data.contract_version, 'health missing versions');
  console.error('ok   call health → connected + versions');

  // export_asset → download descriptor round-trips through the fake extension.
  const expRes = await client.callTool({ name: 'export_asset', arguments: { video_url: 'http://x/clip.mp4', kind: 'video' } });
  const exp = JSON.parse(expRes.content[0].text);
  assert.equal(exp.ok, true);
  assert.equal(exp.data.download.file_name, 'clip.mp4');
  assert.ok(exp.data.download.path_hint.includes('clip.mp4'));
  console.error('ok   call export_asset → download path');

  // cancel_job (nothing pending) → server-answered, ok.
  const cancelRes = await client.callTool({ name: 'cancel_job', arguments: {} });
  const cancel = JSON.parse(cancelRes.content[0].text);
  assert.equal(cancel.ok, true);
  assert.ok(Array.isArray(cancel.data.cancelled));
  console.error('ok   call cancel_job → ok');

  // #3 list_projects → data.projects.
  const projRes = await client.callTool({ name: 'list_projects', arguments: {} });
  const proj = JSON.parse(projRes.content[0].text);
  assert.equal(proj.data.projects[0].project_id, 'p1');
  console.error('ok   call list_projects → projects');

  // #5 search_prompts → data.prompts.
  const spRes = await client.callTool({ name: 'search_prompts', arguments: { query: 'portrait' } });
  const sp = JSON.parse(spRes.content[0].text);
  assert.equal(sp.data.prompts[0].id, 'img_x');
  console.error('ok   call search_prompts → prompts');

  // #5 MCP prompts capability — list + get (backed by search_prompts).
  const { prompts } = await client.listPrompts();
  assert.ok(prompts.some((p) => p.name === 'img_x'), 'prompts/list missing img_x');
  const got = await client.getPrompt({ name: 'img_x' });
  assert.equal(got.messages[0].content.text, 'a studio portrait');
  console.error('ok   prompts/list + prompts/get → text');

  // live capabilities resource (round-trips through the fake extension).
  const capResource = await client.readResource({ uri: 'seosona://capabilities' });
  const live = JSON.parse(capResource.contents[0].text);
  assert.deepEqual(live.voice_supported_video_models, ['Veo 3.1 Quality']);
  console.error('ok   read seosona://capabilities (live via extension)');

  extWs.close();
  await client.close();
  try { rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}
  console.error('\nintegration: all checks passed');
  process.exit(0);
}

main().catch((e) => { console.error('integration FAILED:', e); process.exit(1); });
