#!/usr/bin/env node
/**
 * SEOSONA Flow — Local MCP server (fully local, no login / no premium / no SEOSONA backend).
 *
 * Two roles in one process:
 *   1) MCP server over stdio  → Claude Code / Cursor spawn this and call its tools.
 *   2) WebSocket server on 127.0.0.1 → the SEOSONA Flow extension sidebar connects as a client
 *      (scripts/local-mcp-bridge.js). This process plays the "backend" role that the extension's
 *      SSE transport used to play; the extension plays the executor.
 *
 * Flow of one gen_image / gen_video call:
 *   tool call → build job_id + args → WS send {type:'ai_command', ...} to the extension
 *   → extension runs McpExecutor on the user's logged-in labs.google/fx tab (their own Google Flow
 *      quota, no SEOSONA account) → WS reply {type:'result', payload:{job_id,status,thumbnails|error}}
 *   → returned to the agent as the tool result.
 *
 * Security: WS binds to loopback only (127.0.0.1). Defenses:
 *   - Origin check: web-page origins (http/https) are rejected at handshake — a page the user
 *     merely visits cannot open ws://127.0.0.1:8765 and hijack the executor. Only the extension
 *     (chrome-extension://) or a native client (no Origin) may connect.
 *   - No-displace: once an extension is bound, a second client is refused (no slot stealing).
 *   - Optional shared secret via env SEOSONA_LOCAL_MCP_TOKEN. When set, the extension must send a
 *     matching token AND the server proves it holds the token (HMAC over the client nonce) so the
 *     client can trust the server too. STRONGLY RECOMMENDED — closes the local-rogue-process gap.
 *   Default (no token) = no-auth on localhost, but web pages are still blocked by the Origin check.
 *
 * Env:
 *   SEOSONA_LOCAL_MCP_PORT   (default 8765)
 *   SEOSONA_LOCAL_MCP_TOKEN  (default '' = no-auth)
 *   SEOSONA_LOCAL_MCP_TIMEOUT_MS (default 300000 — max wait for a gen result)
 *
 * NOTE: all human-facing logging goes to stderr; stdout is reserved for the MCP stdio protocol.
 */

import { WebSocketServer } from 'ws';
import { randomUUID, createHmac } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.SEOSONA_LOCAL_MCP_PORT) || 8765;
const TOKEN = process.env.SEOSONA_LOCAL_MCP_TOKEN || '';
const GEN_TIMEOUT_MS = Number(process.env.SEOSONA_LOCAL_MCP_TIMEOUT_MS) || 300000;

const SERVER_VERSION = '0.6.0';
const CONTRACT_VERSION = '1.1.0';   // bump when flow-asset.schema.json shape changes (see seosona://contract)

const log = (...a) => console.error('[seosona-local-mcp]', ...a);

// ─────────────────────────── WebSocket bridge (extension side) ───────────────────────────

/** @type {import('ws').WebSocket | null} */
let extension = null;               // the single connected extension client
let connectedSince = null;          // epoch ms when the extension bound (for health)
const pending = new Map();          // job_id → { resolve, reject, timer }
const results = [];                 // rolling cache of completed results (for list_results)
const RESULTS_MAX = 50;

// ── Idempotency (#1) + persistence (#4): dedup gens by client_ref, survive server restarts ──
const byClientRef = new Map();      // client_ref → normalized FlowResult envelope (successful gens)
const CLIENTREF_MAX = 500;
const CACHE_DIR = process.env.SEOSONA_LOCAL_MCP_CACHE_DIR || join(__dirname, '.cache');
const STATE_PATH = join(CACHE_DIR, 'state.json');
let _saveTimer = null;

function loadState() {
  try {
    if (!existsSync(STATE_PATH)) return;
    const s = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    if (Array.isArray(s.results)) { results.push(...s.results); while (results.length > RESULTS_MAX) results.shift(); }
    if (s.byClientRef && typeof s.byClientRef === 'object') for (const [k, v] of Object.entries(s.byClientRef)) byClientRef.set(k, v);
    log(`state restored: ${results.length} results, ${byClientRef.size} client_refs`);
  } catch (e) { log('state load skipped:', e && e.message); }
}

function saveStateSoon() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(STATE_PATH, JSON.stringify({ results, byClientRef: Object.fromEntries(byClientRef) }));
    } catch (e) { log('state save failed:', e && e.message); }
  }, 500);
}

function rememberClientRef(ref, env) {
  if (!ref || !env || !env.ok) return;
  byClientRef.set(ref, env);
  while (byClientRef.size > CLIENTREF_MAX) byClientRef.delete(byClientRef.keys().next().value);
  saveStateSoon();
}

/** Drop the per-response marker so it never gets written back into the cache as if it were data. */
function stripHit(env) {
  const { idempotent_hit, ...rest } = env;
  void idempotent_hit;
  return rest;
}

/**
 * Judge the assets of an already-cached envelope, without regenerating anything.
 *
 * Returns null when there is nothing to do (quality not requested, no assets, or every asset
 * already carries a verdict) so the caller can serve the cache untouched.
 *
 * Judging is best-effort by design: it needs a logged-in vision tab, and the assets in hand are
 * already paid for. A failure here must never turn a good cache hit into an error.
 */
async function backfillQuality(cachedEnv, a, progressToken) {
  if (!a || !a.quality_gate) return null;
  const assets = Array.isArray(cachedEnv.assets) ? cachedEnv.assets : [];
  if (!assets.length) return null;
  const missing = assets.filter((x) => x && x.quality == null);
  if (!missing.length) return null;

  const cfg = (typeof a.quality_gate === 'object' && a.quality_gate) || {};
  let judged;
  try {
    const body = await runCommand('judge_assets', {
      assets: missing.map((x) => ({ asset_id: x.asset_id, url: x.url, kind: x.kind })),
      provider: cfg.provider, threshold: cfg.threshold, focus: cfg.focus,
    }, progressToken);
    judged = body && body.data && Array.isArray(body.data.judged) ? body.data.judged : null;
  } catch (e) {
    log(`backfillQuality failed (serving cache unjudged): ${e && e.message}`);
    return null;
  }
  if (!judged) return null;

  const byId = new Map(judged.map((j) => [j.asset_id, j.quality]));
  return {
    ...cachedEnv,
    assets: assets.map((x) => {
      if (x.quality != null) return x;
      const q = toQuality(byId.get(x.asset_id));
      return q ? { ...x, quality: q } : x;
    }),
  };
}

loadState();

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });

wss.on('listening', () => {
  log(`WS bridge listening on ws://127.0.0.1:${PORT}  (${TOKEN ? 'token required' : 'no-auth localhost'})`);
  if (!TOKEN) log('SECURITY: no token set. Web pages are rejected by Origin check, but any LOCAL process can drive commands. Set SEOSONA_LOCAL_MCP_TOKEN (shared with the extension) to require mutual auth.');
});
wss.on('error', (e) => log('WS server error:', e && e.message));

wss.on('connection', (ws, req) => {
  // Origin defense: browsers ALWAYS send an Origin header on a WebSocket handshake, and any web
  // page can open ws://127.0.0.1:8765. Only the extension page (chrome-extension://) — or a
  // non-browser native client (no Origin) — may drive the executor. Reject all http(s) web origins
  // so a page the user merely visits cannot hijack the command channel.
  const origin = (req && req.headers && req.headers.origin) || '';
  if (/^https?:\/\//i.test(origin)) {
    log('rejected connection from web origin:', origin);
    try { ws.close(4003, 'origin not allowed'); } catch {}
    return;
  }

  let authed = TOKEN ? false : true;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'hello') {
      if (TOKEN && msg.token !== TOKEN) { log('extension rejected: bad token'); try { ws.close(4001, 'bad token'); } catch {} return; }
      // No-displace: if a live extension is already bound, refuse the newcomer instead of
      // silently reassigning the executor slot (prevents a second client stealing the channel).
      if (extension && extension !== ws && extension.readyState === 1) {
        log('rejected extra client: executor slot already occupied');
        try { ws.close(4002, 'slot busy'); } catch {}
        return;
      }
      authed = true;
      extension = ws;
      connectedSince = Date.now();
      // Mutual auth: when a shared token is configured, prove WE hold it so the client can trust
      // this server (defends the client against a rogue local server that grabbed the port first).
      try {
        if (TOKEN && msg.nonce != null) {
          const proof = createHmac('sha256', TOKEN).update(String(msg.nonce)).digest('hex');
          ws.send(JSON.stringify({ type: 'hello_ack', proof }));
        } else {
          ws.send(JSON.stringify({ type: 'hello_ack' }));
        }
      } catch { /* best-effort ack */ }
      log('extension connected' + (msg.ext ? ` (${msg.ext})` : ''));
      return;
    }
    if (!authed) return;

    if (msg.type === 'pong') return;

    if (msg.type === 'result') {
      const body = msg.payload || {};
      const jobId = body.job_id;
      if (!jobId) return;
      // cache completed results for list_results
      if (body.status === 'completed') {
        results.push({ at: Date.now(), ...body });
        while (results.length > RESULTS_MAX) results.shift();
        saveStateSoon();
      }
      const p = pending.get(jobId);
      if (p) { clearTimeout(p.timer); pending.delete(jobId); p.resolve(body); }
    }

    if (msg.type === 'progress') {
      // Forward an in-flight job's progress to the MCP client as notifications/progress (#6).
      const body = msg.payload || {};
      const p = pending.get(body.job_id);
      if (p && p.progressToken != null) {
        mcp.notification({
          method: 'notifications/progress',
          params: {
            progressToken: p.progressToken,
            progress: Number(body.progress) || 0,
            ...(body.total != null ? { total: Number(body.total) } : {}),
            ...(body.message ? { message: String(body.message) } : {}),
          },
        }).catch(() => {});
      }
      return;
    }
  });

  ws.on('close', () => { if (extension === ws) { extension = null; connectedSince = null; log('extension disconnected'); } });
  ws.on('error', () => {});
});

/** Send an ai_command to the extension and await its result. progressToken → stream notifications/progress. */
function runCommand(command, args, progressToken) {
  return new Promise((resolve, reject) => {
    if (!extension || extension.readyState !== 1) {
      return reject(new Error(
        'Extension not connected. Open Chrome, make sure SEOSONA Flow is loaded, open its side panel ' +
        'on a labs.google/fx project tab (logged in), then retry.'));
    }
    const job_id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(job_id);
      reject(new Error(`Timed out after ${GEN_TIMEOUT_MS} ms waiting for the extension to finish job ${job_id}.`));
    }, GEN_TIMEOUT_MS);
    pending.set(job_id, { resolve, reject, timer, progressToken });
    try {
      extension.send(JSON.stringify({ type: 'ai_command', job_id, command, args: args || {} }));
    } catch (e) {
      clearTimeout(timer); pending.delete(job_id); reject(e);
    }
  });
}

// ─────────────────────────── MCP server (agent side) ───────────────────────────

// Ratio enum shared by gen tools.
const RATIO_DESC = '16:9 | 9:16 | 1:1 | 4:3 | 3:4 | landscape | portrait | square. Default 9:16.';

// Shared by gen_image / gen_video. Judging is opt-in because it costs one extra vision call per
// asset, and it never regenerates on a fail — the verdict comes back and the caller decides,
// so a retry is always the caller knowingly spending their own quota.
const QUALITY_GATE_PARAM = {
  type: ['boolean', 'object'],
  description:
    'Opt-in: have Flow judge each generated asset and return `quality` on every FlowAsset '
    + '(see resource seosona://contract). `true` uses defaults; an object accepts '
    + '{provider, threshold, focus}. Costs ONE extra vision call per asset and needs a logged-in '
    + 'vision tab (ChatGPT by default). Flow reports the verdict and NEVER auto-regenerates. '
    + 'ALWAYS check `quality.judged` before trusting `quality.pass` — judged=false means judging '
    + 'was unavailable and nobody looked at the pixels.',
  properties: {
    provider: { type: 'string', description: 'Vision provider used to judge (default "chatgpt").' },
    threshold: { type: 'number', minimum: 0, maximum: 10, description: 'Pass mark, default 7.5.' },
    focus: { type: 'string', description: 'Extra instruction for the judge, e.g. "check the racket grip".' },
  },
};

const TOOLS = [
  // ── Generation ────────────────────────────────────────────────────────────
  {
    name: 'gen_image',
    description:
      'Generate image(s) on Google Flow via the user\'s logged-in SEOSONA Flow extension (their own account/quota). ' +
      'Returns FlowAsset[] (see resource seosona://contract). Requires the extension side panel open on a labs.google/fx project tab.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Image prompt. (Use `prompts` for a batch.)' },
        prompts: { type: 'array', items: { type: 'string' }, description: 'Optional batch of prompts (each → its own result).' },
        model: { type: 'string', description: 'Flow model value, e.g. "Nano Banana Pro". Omit = current UI selection. See list_models.' },
        ratio: { type: 'string', description: RATIO_DESC },
        count: { type: 'integer', minimum: 1, maximum: 4, description: 'Images per prompt (1..4). Default 1.' },
        refs: { type: 'array', items: { type: 'string' }, description: 'Optional reference images: public image URLs (open without login).' },
        client_ref: { type: 'string', description: 'Idempotency key (e.g. scene id). A repeat call with the same client_ref returns the cached result WITHOUT regenerating or re-spending quota — safe for resumable pipelines.' },
        quality_gate: { ...QUALITY_GATE_PARAM },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'gen_video',
    description:
      'Generate video on Google Flow (b-roll) via the user\'s logged-in extension. For the SEOSONA Video AI V2 pipeline, ' +
      'generate SILENT b-roll (omit voice) and let V2 own the voiceover so content↔voice stay aligned. Passing `voice` makes ' +
      'Veo bake a voiceover INTO the clip (only on voice-capable models — see list_capabilities). Returns FlowAsset[].',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Video prompt. (Use `prompts` for a batch.)' },
        prompts: { type: 'array', items: { type: 'string' } },
        model: { type: 'string', description: 'Flow video model value. Omit = current UI selection. See list_models.' },
        ratio: { type: 'string', description: RATIO_DESC },
        duration: { type: ['integer', 'null'], description: 'Seconds (model-dependent). Omit = default.' },
        voice: { type: 'string', description: 'OPTIONAL voice slug (see list_voices). Bakes voiceover into the clip via Veo. Omit for silent b-roll (recommended for V2).' },
        refs: { type: 'array', items: { type: 'string' }, description: 'Optional reference images: public image URLs.' },
        client_ref: { type: 'string', description: 'Idempotency key (e.g. scene id) — a repeat returns the cached result without regenerating. See gen_image.' },
        quality_gate: { ...QUALITY_GATE_PARAM },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'run_workflow',
    description:
      'Run a saved SEOSONA Flow workflow by wf_id (multi-node graph → images/videos). Use list_workflows to discover ids. ' +
      'The extension must be on the workflow\'s Flow project (else returns WRONG_PROJECT — then call open_project). Returns FlowAsset[].',
    inputSchema: {
      type: 'object',
      properties: {
        wf_id: { type: 'string', description: 'Workflow id (from list_workflows).' },
        client_ref: { type: 'string', description: 'Idempotency key — a repeat returns the cached result without re-running. See gen_image.' },
      },
      required: ['wf_id'],
    },
  },
  {
    name: 'upload_ref',
    description: 'Upload a reference image into the current Flow project so later gens can reuse it as a ref. Accepts a public image URL or a data: URL.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Public image URL or data: URL to upload as a Flow reference.' } },
      required: ['url'],
    },
  },
  {
    name: 'export_asset',
    description:
      'Download a generated asset to the user\'s local disk (Downloads/<folder>/<file_name>) so an external app (e.g. Video AI V2) can read the file to mux. ' +
      'REQUIRED for VIDEO: gen_video returns a provider URL that needs the Google session; the extension fetches it with cookies. ' +
      'Images already arrive as inline base64, so export is only needed for higher-res re-download. Returns {download:{folder,file_name,path_hint}}.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Asset url (from a FlowAsset). Use video_url for videos.' },
        video_url: { type: 'string', description: 'Video url (alias of url; marks kind=video for the default extension).' },
        file_name: { type: 'string', description: 'Target file name (sanitized). Omit = auto (asset_<ts>.mp4|png).' },
        folder: { type: 'string', description: 'Subfolder under Downloads. Default "seosonaflow_mcp".' },
        kind: { type: 'string', enum: ['image', 'video'], description: 'Optional hint for the default extension.' },
      },
    },
  },
  // ── Discovery (read-only; safe to call anytime, even mid-gen) ──────────────
  {
    name: 'list_capabilities',
    description: 'What Flow can do right now: image/video models (which bake voice), supported ratios, and available voices. Call this first to plan a gen.',
    inputSchema: { type: 'object', properties: { provider: { type: 'string', description: 'Default "flow".' } } },
  },
  {
    name: 'list_models',
    description: 'List Flow image + video models (value, label, is_default, is_premium, supports_voice).',
    inputSchema: { type: 'object', properties: { provider: { type: 'string', description: 'Default "flow".' } } },
  },
  {
    name: 'list_voices',
    description: 'List Flow voices (base catalog + the user\'s custom Google-account voices). Returns slug/display_name/description/is_custom.',
    inputSchema: { type: 'object', properties: { provider: { type: 'string', description: 'Default "flow".' } } },
  },
  {
    name: 'list_workflows',
    description: 'List saved SEOSONA Flow workflows the agent can run (wf_id, name, flow_kind, project_id).',
    inputSchema: { type: 'object', properties: { flow_kind: { type: 'string', description: 'Optional filter, e.g. "flow".' } } },
  },
  {
    name: 'list_projects',
    description: 'List the user\'s known Google Flow projects (id, name) so you can open_project without asking for an id. Reads the extension\'s scanned project list.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_prompts',
    description: 'Search SEOSONA\'s bundled prompt library (curated image/video prompts) by keyword/tags. Returns {id,title,text,tags} — use the text as a gen prompt or a starting point.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to match title/text/tags. Omit = top entries.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag filter.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results (default 15).' },
      },
    },
  },
  {
    name: 'get_context',
    description: 'Current Flow project the extension side panel is attached to ({project:{project_id,project_name}}).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_provider_status',
    description: 'Check provider readiness (logged-in + tab open) WITHOUT generating. Omit provider = check flow+chatgpt+grok.',
    inputSchema: { type: 'object', properties: { provider: { type: 'string', description: 'flow | chatgpt | grok. Omit = all.' } } },
  },
  {
    name: 'list_results',
    description: 'Recently completed local generation results cached by THIS server (survives across tool calls).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  // ── Project management ────────────────────────────────────────────────────
  {
    name: 'create_project',
    description: 'Create a new Google Flow project and open it in the extension.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Project name. Omit = Flow default.' } } },
  },
  {
    name: 'open_project',
    description: 'Open an existing Flow project by id (use before run_workflow when it belongs to another project).',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string', description: 'Flow project id.' } },
      required: ['project_id'],
    },
  },
  // ── Memory (shared 3-tier MemoryStore) ────────────────────────────────────
  {
    name: 'memory_search',
    description: 'Search the extension\'s local 3-tier memory (project/style/preference notes) → ranked hits.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
      required: ['query'],
    },
  },
  {
    name: 'memory_add',
    description: 'Add a note to the extension\'s local memory (persists across sessions).',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
      required: ['text'],
    },
  },
  // ── Session / control (answered by THIS server; no extension round-trip needed) ────────────
  {
    name: 'health',
    description:
      'Liveness + version handshake. Call before starting a pipeline: reports whether the extension executor is connected, the server + contract versions, and pending jobs. Never blocks.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'cancel_job',
    description: 'Cancel a running generation. Pass job_id to cancel one, or omit to cancel all pending jobs.',
    inputSchema: { type: 'object', properties: { job_id: { type: 'string', description: 'Job id to cancel. Omit = cancel all pending.' } } },
  },
];

// Result-normalization lives in a side-effect-free module so it can be unit-tested without booting
// this WebSocket server (see contracts/normalize.test.mjs).
import { normalizeResult, toQuality } from './contracts/normalize.mjs';

// #2 — every tool declares the FlowResult output schema + returns structuredContent, so an MCP client
// (Video AI V2) can validate responses natively instead of parsing free text. Permissive on purpose.
const FLOWRESULT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    tool: { type: 'string' },
    status: { type: 'string' },
    assets: { type: 'array' },
    data: { type: 'object' },
    batch: { type: 'object' },
    error_code: { type: 'string' },
    error_message: { type: 'string' },
  },
  required: ['ok', 'tool', 'status'],
  additionalProperties: true,
};
for (const t of TOOLS) t.outputSchema = FLOWRESULT_OUTPUT_SCHEMA;

/** Build a CallTool result carrying BOTH text and structuredContent (the FlowResult envelope). */
function toolResult(env) {
  return { isError: !env.ok, content: [{ type: 'text', text: JSON.stringify(env, null, 2) }], structuredContent: env };
}

const mcp = new Server(
  { name: 'seosona-flow-local', version: SERVER_VERSION },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);

/** Cancel pending job(s): tell the extension to stop, and reject the awaiting tool call(s). */
function cancelJob(jobId) {
  const ids = jobId ? [jobId] : [...pending.keys()];
  for (const id of ids) {
    try { if (extension && extension.readyState === 1) extension.send(JSON.stringify({ type: 'ai_cancel', job_id: id })); } catch {}
    const p = pending.get(id);
    if (p) { clearTimeout(p.timer); pending.delete(id); p.reject(new Error(`Cancelled job ${id}`)); }
  }
  return ids;
}

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
const IDEMPOTENT_TOOLS = new Set(['gen_image', 'gen_video', 'run_workflow']);

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = args || {};
  const progressToken = req.params && req.params._meta && req.params._meta.progressToken;
  try {
    if (!TOOL_NAMES.has(name)) {
      return toolResult(normalizeResult(name, { status: 'failed', error_code: 'UNKNOWN_TOOL', error_message: `Unknown tool: ${name}` }));
    }
    // list_results / health / cancel_job — answered by THIS server (no extension round-trip → never blocks).
    if (name === 'list_results') {
      return toolResult(normalizeResult('list_results', { status: 'completed', data: { count: results.length, results } }));
    }
    if (name === 'health') {
      const connected = !!(extension && extension.readyState === 1);
      return toolResult(normalizeResult('health', { status: 'completed', data: {
        server_version: SERVER_VERSION, contract_version: CONTRACT_VERSION,
        extension_connected: connected, connected_since: connectedSince,
        pending_jobs: pending.size, cached_client_refs: byClientRef.size,
        port: PORT, auth: TOKEN ? 'token' : 'none',
      } }));
    }
    if (name === 'cancel_job') {
      const cancelled = cancelJob(a.job_id);
      return toolResult(normalizeResult('cancel_job', { status: 'completed', data: { cancelled, count: cancelled.length } }));
    }
    // Idempotency (#1): a repeat gen with the same client_ref returns the cached envelope — no re-gen, no quota.
    if (IDEMPOTENT_TOOLS.has(name) && a.client_ref && byClientRef.has(a.client_ref)) {
      log(`idempotent hit: ${name} client_ref=${a.client_ref}`);
      const cached = { ...byClientRef.get(a.client_ref), idempotent_hit: true };
      // A first run without quality_gate followed by a run with it would otherwise return the
      // cached envelope silently missing `quality` — and that second run is the normal case for a
      // resumable weekly pipeline. Judge the assets we already have instead: no image is
      // regenerated, so the whole point of client_ref (never re-spend image quota) still holds.
      const judged = await backfillQuality(cached, a, progressToken);
      if (judged) rememberClientRef(a.client_ref, stripHit(judged));
      return toolResult(judged || cached);
    }
    // Everything else maps 1:1 to an extension command over the WS bridge, wrapped into the FlowResult envelope.
    const body = await runCommand(name, a, progressToken);
    const env = normalizeResult(name, body);
    if (IDEMPOTENT_TOOLS.has(name) && a.client_ref) rememberClientRef(a.client_ref, env);
    return toolResult(env);
  } catch (e) {
    return toolResult(normalizeResult(name, { status: 'failed', error_code: 'GEN_FAILED', error_message: e && e.message ? e.message : String(e) }));
  }
});

// ─────────────────── MCP resources: the Flow↔V2 contract + live capabilities ───────────────────
const CONTRACT_PATH = join(__dirname, 'contracts', 'flow-asset.schema.json');

mcp.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: 'seosona://contract', name: 'Flow↔V2 asset/result contract', mimeType: 'application/json',
      description: 'FlowAsset / FlowResult / SceneInput / script.json schema exchanged between SEOSONA Flow and Video AI V2.' },
    { uri: 'seosona://capabilities', name: 'Live Flow capabilities', mimeType: 'application/json',
      description: 'Current models/voices/ratios (needs the extension connected).' },
  ],
}));

mcp.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const uri = req.params.uri;
  if (uri === 'seosona://contract') {
    let text;
    try { text = readFileSync(CONTRACT_PATH, 'utf8'); }
    catch (e) { text = JSON.stringify({ error: 'contract file missing', detail: String(e && e.message) }); }
    return { contents: [{ uri, mimeType: 'application/json', text }] };
  }
  if (uri === 'seosona://capabilities') {
    try {
      const body = await runCommand('list_capabilities', {});
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(normalizeResult('list_capabilities', body).data, null, 2) }] };
    } catch (e) {
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ error: String(e && e.message) }) }] };
    }
  }
  throw new Error(`Unknown resource: ${uri}`);
});

// ─────────────────── MCP prompts: SEOSONA's bundled prompt library (#5) ───────────────────
// Backed by the extension's search_prompts command, cached briefly. Empty if no extension connected.
let _promptCache = { at: 0, list: [] };
async function fetchPrompts(limit = 50) {
  const now = Date.now();
  if (now - _promptCache.at < 60000 && _promptCache.list.length) return _promptCache.list;
  try {
    const body = await runCommand('search_prompts', { limit });
    const list = (normalizeResult('search_prompts', body).data && normalizeResult('search_prompts', body).data.prompts) || [];
    _promptCache = { at: now, list };
    return list;
  } catch { return _promptCache.list; }
}

mcp.setRequestHandler(ListPromptsRequestSchema, async () => {
  const list = await fetchPrompts(50);
  return {
    prompts: list.map((p) => ({
      name: String(p.id),
      description: (p.title || '') + (Array.isArray(p.tags) && p.tags.length ? ` [${p.tags.join(', ')}]` : ''),
    })),
  };
});

mcp.setRequestHandler(GetPromptRequestSchema, async (req) => {
  const id = req.params.name;
  let body;
  try { body = await runCommand('search_prompts', { id }); }
  catch (e) { throw new Error(`prompt fetch failed: ${e && e.message}`); }
  const list = (normalizeResult('search_prompts', body).data && normalizeResult('search_prompts', body).data.prompts) || [];
  const p = list.find((x) => String(x.id) === String(id)) || list[0];
  if (!p) throw new Error(`Unknown prompt: ${id}`);
  return {
    description: p.title || '',
    messages: [{ role: 'user', content: { type: 'text', text: p.text || '' } }],
  };
});

// heartbeat to keep the extension link healthy
setInterval(() => { if (extension && extension.readyState === 1) { try { extension.send(JSON.stringify({ type: 'ping' })); } catch {} } }, 25000);

const transport = new StdioServerTransport();
await mcp.connect(transport);
log('MCP stdio server ready. Waiting for the extension to connect and for tool calls.');
