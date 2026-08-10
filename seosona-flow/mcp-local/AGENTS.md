# Rules for agents driving the SEOSONA Flow MCP server

This server (`seosona-flow-local`) lets an agent generate images/videos on Google Flow through the
user's own logged-in extension. Read these before calling tools.

## Scope
- **Flow makes silent visual assets only** (images, videos, b-roll). It does **not** do audio/voice/edit.
- If you are **SEOSONA Video AI V2** (or building a video): you own the script + voiceover. Generate
  **silent** b-roll here (`gen_video` **without** `voice`), then mux + narrate on your side so the
  content and the voice stay aligned. Only pass `voice` when you deliberately want Veo to bake a
  voiceover into the clip.
- The link is **optional**: if this server is unreachable, degrade gracefully — never hard-crash.

## Workflow
1. Call **`health`** — confirm `extension_connected` and that `contract_version` matches what you built
   against. Then **`list_capabilities`** — the available models (and which bake voice), ratios, voices.
   Plan the gen from these; don't guess a `model`/`voice` string.
2. Ensure Flow is ready: `get_provider_status` (or handle the error). The extension side panel must be
   open on a logged-in `labs.google/fx` project tab.
3. Generate: `gen_image` / `gen_video` (silent) / `run_workflow`. **Pass `client_ref` (a scene id)** so a
   retry/resume returns the cached result instead of re-generating and re-spending quota. Read `assets[]`
   from the envelope (also available as `structuredContent`). Add `quality_gate: true` to have Flow
   judge each asset — then **check `asset.quality.judged` before `asset.quality.pass`**: `judged:false`
   means nobody looked at the pixels, so `pass` is `null` and a human has to. Flow reports `action` and
   never regenerates on a fail; re-gen is your call and your quota.
4. **Get the file to edit**: images come back as inline base64; for **videos call `export_asset(video_url)`**
   and read the file from `Downloads/<folder>/<file_name>` (`path_hint`) — the video URL needs the Google
   session, so only the extension can fetch it.
5. Reuse: pass an earlier asset's public URL to `refs[]`, or `upload_ref` first. `cancel_job` to abort.

## Every result is a FlowResult envelope
`{ ok, tool, status, assets?[], data?, batch?, error_code?, error_message? }`. Check `ok`. On failure,
branch on `error_code` — **do not blindly retry**:

| error_code | do |
|---|---|
| `PROVIDER_NOT_LOGGED_IN`, `PROVIDER_TAB_NOT_READY` | ask the user to open/log in the provider tab; stop |
| `WRONG_PROJECT` | ask the user, then `open_project(expected_id)` and re-run |
| `DAILY_QUOTA_EXCEEDED` | the user's Google Flow quota is spent; stop and wait for reset |
| `EXTENSION_BUSY` | another job is running; wait, then retry |
| `VALIDATION_ERROR` | fix the `model`/`voice` using `list_capabilities` / `list_voices` |

## Progress
Long `gen_*` / `run_workflow` calls stream `notifications/progress` — pass an `onprogress` callback (the
SDK adds the `progressToken`) to show the user live progress instead of a frozen wait.

## Contract
The `seosona://contract` resource defines `FlowAsset` / `FlowResult` / `SceneInput` / `script.json`.
Validate with `node contracts/validate.mjs script|result <file>`.

## Don't
- Don't pass secrets/tokens in prompts. Don't fetch arbitrary non-provider URLs as refs.
- Don't assume voice: default b-roll is silent. Don't retry quota/login errors in a loop.
