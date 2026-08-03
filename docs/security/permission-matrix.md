# SEOSONA Flow — Permission Matrix (Phase 3 / P3.T7, AUD-011)

Least-privilege justification for every manifest permission. Drift is enforced by
`npm run security:permissions` (baseline: `seosona-flow/artifacts/security/permissions-baseline.json`)
and `tests/security/manifest-permissions.test.mjs`.

## API permissions

| Permission | Justification | Least-privilege note |
|---|---|---|
| `activeTab` | Act on the tab the user invoked from | Gesture-scoped |
| `storage` | Persist workflows, settings, prompts locally | Local-first |
| `unlimitedStorage` | Large local media/workflow corpora | Local only |
| `sidePanel` | Primary UI surface | — |
| `scripting` | Inject provider automation into granted hosts | Bounded by host grants |
| `tabs` | Find/activate provider tabs for workflows | — |
| `downloads` | Save generated media | User-initiated |
| `notifications` | Workflow completion/error signals | — |
| `alarms` | Service-worker wake / scheduling | — |
| `contextMenus` | Right-click actions | — |
| `clipboardWrite` | Copy prompts/results | Write-only |

## Host permissions

**Required** — core automation targets and their media CDNs, needed at install for
background cross-origin fetch and programmatic injection:

- `https://labs.google/*` (Google Flow)
- `*://chatgpt.com/*`, `*://gemini.google.com/*`, `*://claude.ai/*`
- `https://grok.com/*`, `https://*.grok.com/*`, `*://x.com/*`, `*://*.x.com/*`, `*://*.x.ai/*`
- `*://storage.googleapis.com/*`, `*://flow-content.google/*` (Flow output media)
- `*://*.googleusercontent.com/*` — CDN ảnh Flow/Google. Cần để tải & resolve tile
  kết quả: `TileResolver`, `FileUploader`, `AlbumList`, `ProviderConfigManager`
  (12 file tham chiếu). Không có quyền này thì fetch ảnh kết quả bị CORS chặn.
- `*://*.googlevideo.com/*` — CDN video Flow (Veo). Dùng ở `background.js` gate tải
  media: chỉ chấp nhận khi request có **referrer Flow** (cùng luật với
  `googleusercontent`/`storage.googleapis`) → không mở rộng bề mặt ngoài Flow.
- `*://www.google.com/*` (Flow/labs auth surface)

**Optional** (`optional_host_permissions`) — requested at runtime only when the user
uses the corresponding feature:

- `<all_urls>` — arbitrary-host image/reference fetch (image-to-prompt on any site)
- `*://www.pinterest.com/*`, `*://www.youtube.com/*`, `*://www.tiktok.com/*`,
  `*://www.facebook.com/*`, `*://unsplash.com/*`, `*://www.etsy.com/*`,
  `*://pixabay.com/*`, `*://www.amazon.com/*` — reference-image gathering sources

## Residual risk

Moving `<all_urls>` to optional means background **cross-origin fetch to an
arbitrary, non-listed host** now requires a runtime `chrome.permissions.request`
grant. The `i2p-content.js` content script still injects on all pages (its
`matches` are self-authorizing), so on-page image reading is unaffected; only
background fetch of an arbitrary remote image URL needs the grant. Callers that
fetch from optional hosts must request the permission first — tracked for the
Phase 4 network service and Phase 7 privacy work.

## Changing permissions

1. Edit `manifest.json`.
2. Update this matrix.
3. `npm run security:permissions -- --update` to re-baseline (justify in the commit).
4. `npm run test:integration` — the manifest-permissions test must pass.
5. `npm run test:e2e` — prove the extension still loads.
