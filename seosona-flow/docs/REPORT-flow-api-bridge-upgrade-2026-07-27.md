# SEOSONA Flow API Bridge Upgrade Report

**Date:** 2026-07-27

**Scope:** Consolidate the six proposed upgrade directions into one build report for SEOSONA Flow.

**External reference input:** `${SEOSONA_WORKFLOW_ROOT}/external-bridge-reference-v1.1.1`

**Current product:** `seosona-flow/`

## Executive Decision

SEOSONA Flow should upgrade toward a local-first Flow API path, but it should not copy or depend on the external bridge package as-is.

The external bridge package proves a useful technical pattern:

- A dedicated Manifest V3 service worker can execute Flow API requests.
- A MAIN-world script can access page-side `grecaptcha.enterprise`.
- An isolated content script can relay between MAIN-world page APIs and extension APIs.
- A background worker can expose capabilities such as API request, captcha solve, generation, polling, upload, upscale, project creation, and tier resolution.
- A status popup can make "ready versus waiting" visible to the user.

For SEOSONA Flow, the better target is still the architecture already described in `docs/PLAN-flow-api-adapter.md`: keep the product local-first, keep DOM automation as the default fallback, and implement API mode as an opt-in path. Do not introduce external bridge branding, external extension dependency, backend dependency, or broad new host permissions.

## Hard Guardrails

- Product code must not refer to upstream product names or external bridge branding.
- Do not add `external reference domain`, external extension IDs, or bridge-specific names to SEOSONA Flow.
- Do not import `<all_urls>` from upstream manifest changes.
- Do not require users to install a second sideloaded bridge extension.
- Default execution remains DOM mode until API mode is proven.
- DOM fallback remains permanent, not a temporary migration path.
- All API request paths must be allowlisted to Flow-owned origins and paths.
- No secret, bearer token, captcha token, request body, or media URL should be logged raw.
- Use repo-relative paths and portable anchors in docs and implementation artifacts.

## What The External Bridge Adds

The external bridge package is a separate connector extension. Its manifest declares:

- `externally_connectable.ids` for selected caller extensions.
- Host permissions for `https://labs.google/*`, `https://aisandbox-pa.googleapis.com/*`, and `https://www.google.com/recaptcha/*`.
- Permissions including `webRequest`, `cookies`, `alarms`, `scripting`, and `declarativeNetRequest`.
- `flow-token-capture.js` in isolated world at `document_start`.
- `flow-main.js` in MAIN world at `document_start`.
- `bridge-sw.js` as the service worker executor.
- Header modification rules for `aisandbox-pa.googleapis.com` requests.

Its service worker exposes capability-style commands:

- `api_request`
- `trpc_request`
- `solve_captcha`
- `get_status`
- `flow_generate`
- `flow_poll_video`
- `flow_upload_ref`
- `flow_upscale_image`
- `flow_upscale_video`
- `flow_create_project`
- `flow_resolve_tier`

This is valuable as a behavior map, but too broad and too coupled for SEOSONA Flow to embed directly.

## Current SEOSONA Flow Gap

SEOSONA Flow already has a plan for Flow API mode, but not a complete implementation.

Evidence in the current repository:

- `docs/PLAN-flow-api-adapter.md` describes a local-first API architecture and explicitly rejects copying the external bridge model.
- `manifest.json` already runs `content_scripts/content.js` on `https://labs.google/fx/*`, which gives SEOSONA a same-origin place to add controlled Flow API probing.
- `pages/sidebar.html` does not currently include a Flow API status dot or API settings button.
- `src/core/ProviderConfigManager.js` has early API mapping traces, but not the full Flow API config surface used by the new upstream API mode.
- `src/core/PromptQueue.js`, `src/core/WorkflowExecutor.js`, and `src/prompts/GenTab.js` still primarily assume DOM/bridge-to-tab execution flows.

## Consolidated Upgrade Packages

### Package 1: Flow API Spec And Adapter

**Goal:** Add a local, versioned Flow API spec and an adapter that returns the same result shape downstream already expects.

**Build direction:**

- Create `config/flow-api.json` as the local source of endpoints, methods, payload templates, poll behavior, response mapping, and feature support.
- Create `src/core/FlowApiSpec.js` to load, validate, and expose the spec.
- Create `src/core/FlowApiAdapter.js` to submit generate/upload/upscale/poll requests through the content-script gateway.
- Return the existing normalized shape: `resultTileIds`, `resultThumbnails`, `result_file_ids`, provider URLs, media type, and file names.
- Keep an explicit `apiUnavailable -> DOM fallback` branch.

**Do not copy from external bridge:**

- No external extension messaging.
- No external extension IDs.
- No bridge branding.
- No persistent bearer-token store unless same-origin fetch proves insufficient and the user approves a separate security review.

**Acceptance checks:**

- `FlowApiSpec.isUsable()` returns false with a clear reason when the spec is missing or stale.
- API adapter failure never breaks existing DOM mode.
- Unit tests cover valid spec, invalid spec, request mapping, response mapping, timeout, and fallback.

### Package 2: Secure Content-Script API Gateway

**Goal:** Add a minimal, same-origin request relay inside `content_scripts/content.js`.

**Build direction:**

- Add a handler such as `flowApi:request`.
- Accept only exact allowlisted Flow API paths and methods from `config/flow-api.json`.
- Execute requests from the `https://labs.google/fx/*` content-script context where user session cookies are already available.
- Return `{ ok, status, headersSummary, data }` with sensitive fields redacted.
- Block cross-origin URLs, protocol-relative URLs, arbitrary absolute URLs, and path traversal-like inputs.

**Optional fallback study:**

- If same-origin fetch cannot access required `aisandbox-pa.googleapis.com` calls, evaluate an internal SEOSONA-only bridge mode separately.
- That evaluation must go through security review before implementation because it touches authorization and captcha flows.

**Acceptance checks:**

- Rejected URL attempts cannot reach network.
- Request and response logs redact authorization, captcha tokens, cookies, and media signatures.
- Existing content-script actions keep working.

### Package 3: Settings And Runtime UI

**Goal:** Let users choose the generation path without changing current default behavior.

**Build direction:**

- Add `flowGenMode: "dom" | "api" | "auto"` to storage settings.
- Default to `"dom"`.
- Add a compact provider status indicator in `pages/sidebar.html`.
- Add an API settings entry point that opens Flow mode settings.
- Display states: `DOM`, `API ready`, `API unavailable`, `falling back to DOM`, and `spec needs update`.
- Use SEOSONA naming only.

**Acceptance checks:**

- Changing settings persists across sidebar reloads.
- API mode off means no API probe runs.
- Auto mode downgrades to DOM after repeated API failures.
- UI never asks the user to install or connect an external bridge package.

### Package 4: Flow Tracker API States

**Goal:** Upgrade tracker UX so API-mode jobs are observable without depending on DOM tile scanning.

**Build direction:**

- Extend `content_scripts/floating-tracker-rich.js` with API-specific states inspired by the external tracker behavior.
- Add states for queued API job, submitting, polling, chunk draining, page reload, completed, partial fail, failed, manual fallback, and download-ready.
- Add result grid support for API-returned media.
- Preserve existing tracker behavior for DOM mode, ChatGPT, Grok, Gemini, Claude, and workflow execution.

**Acceptance checks:**

- DOM queue tracker output is unchanged.
- API-mode tracker updates are driven by adapter lifecycle events, not by scanning DOM tiles.
- User can distinguish API completion from DOM completion.
- Failed API jobs show fallback reason without exposing raw API response.

### Package 5: Provider And Model Mapping Audit

**Goal:** Confirm whether SEOSONA already covers the new provider/model marketing claims before implementing redundant code.

**Build direction:**

- Audit `src/core/ProviderConfigManager.js`, `src/core/ModelRegistry.js`, `src/core/providers/FlowAdapter.js`, `src/core/providers/ChatGPTAdapter.js`, `src/core/providers/GrokAdapter.js`, and `src/workflow/NodeTemplates.js`.
- Compare declared model labels and behavior for GPT Image 2, Veo 3.1, Nano Banana Pro, Grok Imagine, Aurora, image/video ratio mapping, duration, resolution, reference-image limits, and quality options.
- Update labels and mappings only where the behavior is missing or stale.
- Do not treat upstream marketing text as proof of capability. Capability must map to an actual UI/API control.

**Acceptance checks:**

- Model labels match actual selectable behavior.
- Unsupported upstream labels do not appear in SEOSONA UI.
- Existing Claude, watermark, Meigen, and SEOSONA-specific features are preserved.

### Package 6: Validation, Rollout, And Safety Gates

**Goal:** Ship API mode as a reversible, observable upgrade.

**Build direction:**

- Add unit tests for spec validation, request allowlisting, response mapping, and fallback.
- Add integration tests for DOM default mode and API-unavailable fallback.
- Add diagnostics panel entries for Flow API spec status, last API failure class, and current fallback status.
- Add a security check for sensitive-token redaction.
- Add a release note that API mode is opt-in.
- Keep `npm run seosona:doctor` passing after each package.

**Acceptance checks:**

- `npm run seosona:doctor` passes.
- Existing DOM generation smoke test passes.
- API mode can be disabled instantly by setting `flowGenMode` back to `"dom"`.
- No new broad manifest permission is added without a written justification and review.

## Recommended Build Phases

### Phase 0: Evidence Capture

Run a controlled local capture of one image generation and one video generation from Google Flow, using the user's own session. Produce a redacted HAR-derived schema draft for `config/flow-api.json`.

Output:

- `config/flow-api.json`
- `docs/evidence/flow-api-redacted-schema-notes.md`

### Phase 1: Read-Only Probe

Implement `FlowApiSpec` and the content-script request gateway. Probe only read/list/status endpoints. Do not generate media.

Output:

- Proven same-origin auth path, or a documented blocker.
- Allowlist and redaction tests.

### Phase 2: Shadow Mode

Keep DOM generation as the real path. Run API probes or dry-run comparisons beside it when safe. Record whether API response mapping matches DOM-observed output.

Output:

- Accuracy and stability evidence.
- Decision to continue, revise spec, or stop.

### Phase 3: Opt-In API Mode

Enable real API generation only when `flowGenMode` is `"api"`. Fallback to DOM on spec failure, HTTP failure, auth failure, captcha failure, timeout, or unknown response shape.

Output:

- Working opt-in path.
- Tracker states for API jobs.
- Fallback behavior validated.

### Phase 4: Auto Mode

Enable `"auto"` mode: try API first, downgrade to DOM after repeated failures, and surface "spec needs update" to the user.

Output:

- Circuit breaker.
- Diagnostics.
- Rollback-safe release.

## Key Risks

| Risk | Severity | Mitigation |
|---|---:|---|
| Google changes private API shape | High | Local spec, version checks, circuit breaker, DOM fallback |
| Captcha token is required outside page context | Medium | Prefer MAIN-world relay only inside SEOSONA extension; do not persist raw tokens |
| Authorization header capture is required | High | Stop for security review before implementing any token capture |
| API mode increases automation rate | Medium | Reuse existing queue limits and delays; do not speed up by default |
| Broad permissions creep into manifest | High | Keep manifest minimal; reject `<all_urls>` import |
| Product accidentally references external branding | Medium | Namespace scan before release |

## Final Recommendation

Build Package 1 and Package 2 first, but only through Phase 1 read-only probing. This gives SEOSONA Flow the most learning with the lowest blast radius.

Do not port the external bridge package as a dependency. Use it only as a reference for capability decomposition, status reporting, captcha boundary awareness, and failure-class mapping.

After Phase 1, decide between:

1. Continue same-origin content-script API mode.
2. Stop and keep DOM automation.
3. Open a separate security-reviewed design for an internal SEOSONA-only bridge.

The most valuable upgrade is not "faster generation" by itself. The valuable upgrade is a controlled execution abstraction where API mode, DOM mode, tracker state, fallback, diagnostics, and provider mapping all share one stable SEOSONA contract.
