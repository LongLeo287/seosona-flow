# SEOSONA Flow — Local MCP (no login, no premium, no backend)

Drive the SEOSONA Flow Chrome extension's image/video generation from Claude Code / Cursor **fully
locally**. No SEOSONA account, no Premium, no SEOSONA backend. Generation runs on **your own,
already-logged-in `labs.google/fx` tab** (your Google Flow quota).

## How it works

```
Claude Code / Cursor ──stdio(MCP)──> mcp-local/server.mjs ──ws://127.0.0.1:8765──> SEOSONA Flow extension
                                          (this folder)                              (sidebar → McpExecutor)
                                                                                         │
                                                                          drives your labs.google/fx tab
```

An MV3 extension can't host a socket, so this tiny Node process does. It is BOTH an MCP stdio server
(the agent spawns it) AND a localhost WebSocket server. The extension's sidebar (`scripts/local-mcp-bridge.js`)
connects to it as a client and feeds each command into the exact same `McpExecutor` pipeline the online
SSE path used — so all the existing validation/queueing still applies. Results come back over the same WS.

## Tools

**Generation** (return `FlowAsset[]`):

| Tool | Args | Notes |
|------|------|-------|
| `gen_image` | `prompt` (req), `prompts[]`, `model`, `ratio`, `count` (1..4), `refs[]` (public URLs), `quality_gate?` | Google Flow image gen |
| `gen_video` | `prompt` (req), `prompts[]`, `model`, `ratio`, `duration`, `voice?`, `refs[]`, `quality_gate?` | Flow video / b-roll. **Omit `voice` for silent b-roll** (recommended for V2). `voice` bakes a Veo voiceover in. |
| `run_workflow` | `wf_id` (req) | Run a saved workflow graph → collected assets |
| `upload_ref` | `url` (req) | Upload a public/`data:` image into the current project as a reusable ref |
| `export_asset` | `url`\|`video_url`, `file_name?`, `folder?`, `kind?` | **Download an asset to disk** so an external app can read the file. **Required for VIDEO** (URL needs the Google session). Returns `{download:{folder,file_name,path_hint}}`. |

**Discovery** (read-only, safe anytime — even mid-gen):

| Tool | Args | Returns |
|------|------|---------|
| `list_capabilities` | `provider?` | models (which bake voice) + ratios + voices — **call first to plan** |
| `list_models` | `provider?` | image + video models (`value`, `label`, `supports_voice`, …) |
| `list_voices` | `provider?` | Flow voices incl. the user's custom Google voices (`slug`, `is_custom`) |
| `list_workflows` | `flow_kind?` | saved workflows (`wf_id`, `name`, `project_id`) |
| `list_projects` | — | known Flow projects (`project_id`, `project_name`) → feed `open_project` |
| `search_prompts` | `query?`, `tags?`, `limit?` | search the bundled prompt library (`id`, `title`, `text`, `tags`) |
| `get_context` | — | current Flow project |
| `get_provider_status` | `provider?` | provider readiness (login + tab) without generating |
| `list_results` | — | results cached by THIS server (survives across calls) |

**Project + memory**: `create_project` (`name?`), `open_project` (`project_id`), `memory_search` (`query`, `limit?`), `memory_add` (`text`, `tags?`).

**Session / control** (answered by the server — never block, work even with no extension):

| Tool | Args | Returns |
|------|------|---------|
| `health` | — | `{ extension_connected, server_version, contract_version, pending_jobs, port }` — call before a pipeline |
| `cancel_job` | `job_id?` | cancel one job, or all pending if omitted |

`ratio`: `16:9 | 9:16 | 1:1 | 4:3 | 3:4 | landscape | portrait | square` (default `9:16`).

Every tool returns the stable **`FlowResult`** envelope: `{ ok, tool, status, assets?[], data?, batch?, error_code?, error_message?, idempotent_hit? }` — delivered **both** as text and as `structuredContent` (each tool declares an `outputSchema`, so an MCP client can validate responses natively).

**Idempotency** (resumable pipelines): pass `client_ref` (e.g. a scene id) to `gen_image` / `gen_video` / `run_workflow`. A repeat with the same `client_ref` returns the cached result (`idempotent_hit: true`) **without regenerating or spending quota**. The cache **survives a server restart** (persisted under `.cache/`; relocate with `SEOSONA_LOCAL_MCP_CACHE_DIR`).

**MCP prompts**: the bundled prompt library is also exposed via the standard `prompts/list` + `prompts/get` (backed by `search_prompts`).

**Progress streaming**: pass a `progressToken` on a `gen_*` / `run_workflow` call and the server emits `notifications/progress` while it runs — multi-image gens report `completed/total`, `run_workflow` ticks once per finished node. (SDK clients: pass an `onprogress` callback to `callTool`.)

## Data contract & resources (Flow ↔ Video AI V2)

The server exposes two MCP **resources**:

| URI | What |
|-----|------|
| `seosona://contract` | `FlowAsset` / `FlowResult` / `SceneInput` / `script.json` schema — one source of truth (`contracts/flow-asset.schema.json`). |
| `seosona://capabilities` | Live models/voices/ratios (round-trips through the connected extension). |

**Boundary:** SEOSONA **Flow** produces *silent* visual assets; **SEOSONA Video AI V2** owns the script + voiceover and muxes Flow assets into the final video (keeps content↔voice aligned). Validate either side with:

```bash
node contracts/validate.mjs script <your-script.json>   # V2 render script
node contracts/validate.mjs result <a-flowresult.json>  # an MCP envelope
node contracts/validate.mjs --self-test                 # fixtures
```

## Use from SEOSONA Video AI V2 (handoff)

V2 is a **separate product**. The MCP link is optional — **have it → V2 pulls b-roll from Flow; not → both run independently.** Handoff sequence:

1. **`health`** → confirm `extension_connected` + matching `contract_version` before starting.
2. **`list_capabilities`** → pick a model/ratio (and which models bake voice — usually you don't want that).
3. For each `SceneInput`: `gen_image` / `gen_video` (**silent** — omit `voice`) / `run_workflow` → read `assets[]`.
4. **Get the file**: images arrive as inline base64; for **videos call `export_asset(video_url)`** → read the file from `Downloads/<folder>/<file_name>` (`path_hint`).
5. Fill `scene.asset`; V2 does TTS + caption + **mux** locally. `cancel_job` if the user aborts.

**Error handling — branch on `error_code`, don't blind-retry:**

| error_code | meaning → action |
|---|---|
| `PROVIDER_NOT_LOGGED_IN` / `PROVIDER_TAB_NOT_READY` | user must open/log in the Flow tab → stop and ask |
| `WRONG_PROJECT` | workflow belongs to another project → `open_project(id)` then retry |
| `DAILY_QUOTA_EXCEEDED` | Google Flow quota spent → stop, wait for reset |
| `EXTENSION_BUSY` | another job running → wait, retry |
| `VALIDATION_ERROR` | bad model/voice → fix via `list_capabilities` / `list_voices` |

Register this server as an MCP server in V2 exactly like Claude Code / Cursor below.

## One-time setup

1. **Install deps** (already done if you ran it):
   ```bash
   cd "D:\SEOSONA AI\SEOSONA Workflow\seosona-flow\mcp-local"
   npm install
   ```

2. **Load / reload the extension** so the new bridge script is picked up:
   - `chrome://extensions` → enable Developer mode → the SEOSONA Flow extension → **Reload**.
   - (The bridge only activates in LOCAL mode, which is the default — no login/premium needed.)

3. **Open the side panel on a Flow project**: open `https://labs.google/fx` (Google Flow), sign in to
   **your own Google account**, open a project, and open the SEOSONA Flow side panel. Keep this tab +
   panel open while generating (this is the executor context). When connected, the panel logs
   `[LocalMcpBridge] đã nối Local MCP server`.

4. **Register the MCP server with your agent** (see below). The server auto-starts when the agent spawns it.

### security & the (recommended) local token
The WS server binds to loopback only and **rejects every web-page origin** (`http(s)://…`) at the
handshake, so a website you visit cannot open `ws://127.0.0.1:8765` and hijack the command channel.
Once the extension is connected, a second client is also refused (no slot-stealing).

The remaining gap is a **local rogue process** that grabs the port. Close it with a shared secret —
**recommended**:
- Start the server with `SEOSONA_LOCAL_MCP_TOKEN=<secret>` (see env below), **and**
- In the extension, set the matching token once (DevTools console on the side panel, or background):
  ```js
  chrome.storage.local.set({ seosonaLocalMcp: { enabled: true, port: 8765, token: '<secret>' } });
  ```
When a token is set, the two sides authenticate **mutually**: the extension sends the token *and* a
nonce, and only accepts commands after the server proves it holds the token (`HMAC(token, nonce)`).
(Omit `token` for no-auth — web pages are still blocked by the Origin check. Set `enabled: false` to
disable the bridge entirely.)

### (optional) auto-download to a local folder
The extension already supports auto-saving MCP results to disk. In `af_settings`:
`mcpAutoDownload: true`, `mcpDownloadFolder: 'seosonaflow_mcp'` (relative to your Downloads folder),
`mcpDownloadResolution` (`1k|2k|4k`), `mcpVideoDownloadResolution` (`720p|1080p|4k`). Default OFF —
results are returned to the agent regardless.

## Register with Claude Code

```bash
claude mcp add seosona-flow-local -- node "D:\SEOSONA AI\SEOSONA Workflow\seosona-flow\mcp-local\server.mjs"
```
With a custom port / token:
```bash
claude mcp add seosona-flow-local \
  --env SEOSONA_LOCAL_MCP_PORT=8765 \
  --env SEOSONA_LOCAL_MCP_TOKEN=my-secret \
  -- node "D:\SEOSONA AI\SEOSONA Workflow\seosona-flow\mcp-local\server.mjs"
```
Verify: `claude mcp list` → `seosona-flow-local` connected; `tools/list` shows the full surface (`gen_image`, `gen_video`, `run_workflow`, `list_capabilities`, …).

## Register with Cursor / generic (`.mcp.json`, `~/.cursor/mcp.json`, Claude Desktop)

```json
{
  "mcpServers": {
    "seosona-flow-local": {
      "command": "node",
      "args": ["D:\\SEOSONA AI\\SEOSONA Workflow\\seosona-flow\\mcp-local\\server.mjs"],
      "env": { "SEOSONA_LOCAL_MCP_PORT": "8765" }
    }
  }
}
```

## Env vars

| Var | Default | Meaning |
|-----|---------|---------|
| `SEOSONA_LOCAL_MCP_PORT` | `8765` | WS bridge port (loopback) |
| `SEOSONA_LOCAL_MCP_TOKEN` | `''` | shared secret; empty = no-auth on localhost |
| `SEOSONA_LOCAL_MCP_TIMEOUT_MS` | `300000` | max wait for one generation result |
| `SEOSONA_LOCAL_MCP_CACHE_DIR` | `./.cache` | where idempotency + results state persists |

## Honest preconditions / limits

- **The extension side panel must be open** on a logged-in `labs.google/fx` project tab — that's the
  executor. If it isn't connected, tool calls fail with a clear "Extension not connected" message.
- Every generation spends **your own Google Flow quota** (there is no API key here — it drives the UI).
- One job at a time (the extension serializes MCP with any UI job; you may get `EXTENSION_BUSY`).
- `refs` supports **public image URLs** (must open without login). Local file refs are not wired in this
  local bridge.
- `video_url` results normally get uploaded to R2 by the online build; in LOCAL mode the server returns the
  provider URL / base64 image inline instead. Use auto-download (above) to also save to disk.
