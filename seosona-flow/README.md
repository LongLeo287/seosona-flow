# SEOSONA Flow

**Chrome extension (Manifest V3)** tự động hoá tạo **ảnh/video bằng AI** trên các nền tảng bạn đã đăng nhập — **Google Flow** (labs.google/fx), **ChatGPT**, **Grok**, **Gemini**. Gõ prompt hàng loạt, chạy workflow, tự tải kết quả 2K/4K. Không dùng API trả phí — extension điều khiển chính tab AI của bạn qua content script.

> `short_name`: **SEOSONA Flow** · `version`: 1.1.37 · Ngôn ngữ UI: Việt/Anh.
>
> **Chạy 100% offline.** Không cần backend, không cần tài khoản SEOSONA, không cần `npm install`. Tải về là dùng được ngay.

## Làm được gì

- **Batch prompt** — nhập nhiều prompt, chạy tuần tự/hàng loạt trên provider đã chọn (image hoặc video, kèm model / tỉ lệ / số lượng).
- **Workflow automation** — dựng chuỗi bước tạo nội dung và chạy tự động; side panel theo dõi tiến độ realtime + queue.
- **Auto-download** — kết quả ảnh/video tự lưu qua `chrome.downloads` với template tên file (1K/2K/4K).
- **Image-to-Prompt** — chuột phải ảnh bất kỳ trên web, **chọn vùng màn hình**, hoặc **tải ảnh từ máy** → Gemini/ChatGPT phân tích thành prompt; xuất 3 tab **JSON / English / Tiếng Việt**, đưa thẳng vào tab Gen.
- **Đa provider** — adapter riêng cho Google Flow / ChatGPT / Grok / Gemini; tự mở & nhận diện tab provider đang đăng nhập.
- **Tuỳ chọn nâng cao** (trong `src/`): executor MCP + Telegram, selector override, humanized delay/concurrency/retry.

## Cài đặt (Load unpacked)

1. Tải/clone repo về máy.
2. `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn **thư mục `seosona-flow`** (không phải thư mục gốc của repo — `manifest.json` nằm trong đó).
3. Chrome sẽ hỏi quyền truy cập mọi trang (`<all_urls>`) — cần cho Image-to-Prompt và auto-download.
4. Đăng nhập sẵn các trang bạn sẽ dùng: `labs.google/fx` (Flow), `chatgpt.com`, `gemini.google.com`, `grok.com`.
5. Bấm icon extension → **Side Panel** mở bên phải (`pages/sidebar.html`).

> ⚠️ Automation thao tác trên **tài khoản AI của chính bạn** — extension không kèm theo tài khoản hay API key nào, nó chỉ điều khiển phiên đăng nhập sẵn có trong trình duyệt của bạn. Mỗi prompt tiêu credit/quota của chính tài khoản đó. Giữ tab provider mở + đã đăng nhập khi chạy.

**Không đăng nhập các trang trên thì tab Gen và Image-to-Prompt sẽ không chạy** — đó là yêu cầu bắt buộc duy nhất ngoài Chrome.

## Cấu trúc thực tế

| Đường dẫn | Vai trò |
|---|---|
| `manifest.json` | MV3: service worker, side panel, content scripts, host permissions |
| `background.js` | Service worker: router job → tab provider, SSRF-guarded fetch proxy, retry, auto-download |
| `content_scripts/content.js` | Content script chính trên `labs.google/fx` (điều khiển Google Flow) |
| `content_scripts/*` | Adapter cho chatgpt.com / grok.com / gemini.google.com + `i2p` (right-click ảnh → prompt) trên mọi trang |
| `src/` | Engine: WorkflowExecutor, PromptQueue, ExecutionLock, SseClient, ProviderConfigManager, McpExecutor, TelegramExecutor, adapter provider, i18n VI/EN |
| `pages/sidebar.html` | UI side panel |
| `lib/` · `styles/` · `icons/` | Thư viện dùng chung · CSS · icon |
| `scripts/seosona-project.mjs` | Cầu nối SEOSONA OS (doctor/log) |

## Trạng thái & giới hạn (trung thực)

- Automation bám **DOM thật của 4 trang AI** — khi các trang đó đổi giao diện, capture có thể hỏng; có hệ thống selector override để sửa không cần đụng code.
- **Local mode là mặc định** (`src/core/RuntimeMode.js`, `DEFAULT_LOCAL = true`): mọi config/quota/history/storage dùng default cục bộ, `ApiClient` chặn mọi request ra backend. Muốn bật online sau này thì đặt `SEOSONA_LOCAL_MODE = false` và cấu hình `apiBaseUrl`.
- **Image-to-Prompt** chỉ dùng **Gemini** và **ChatGPT** — hai provider duy nhất upload được ảnh qua content script. Claude/Grok không dùng cho i2p.
- Mã nguồn nạp trực tiếp (không cần build/bundle để chạy). Nay **đã có test tự động + CI** — xem `npm run verify` và [docs/development/testing.md](../docs/development/testing.md).
- Extension ID thay đổi theo từng máy khi load unpacked — không có gì trong code phụ thuộc vào ID cố định.

## Kết nối SEOSONA OS

Dự án bind vào SEOSONA OS qua `seosona.project.json` (`name: seosona-flow`, `memoryNamespace: seosona-flow`, `osRoot: ~/.seosona`). Publish/deploy cần bạn xác nhận rõ ràng.

```bash
npm run seosona:doctor   # kiểm tra kết nối OS + tình trạng dự án
```

> Đây là **script dev nội bộ**, cần thư mục `~/.seosona` trên máy. Người tải extension về **không cần chạy** — extension hoạt động độc lập hoàn toàn với nó.

## Chất lượng & tài liệu (dev)

- **Verify toàn bộ:** `npm run verify` (nhiều tier: static, budgets, lint, security, architecture, workflows, providers, privacy, ux, release, readiness + unit/integration/E2E).
- **Tài liệu:** [Getting started](../docs/user/getting-started.md) · [Testing](../docs/development/testing.md) · [Privacy](../docs/privacy/README.md) · [Runbooks](../docs/runbooks/) · [Data-First planning](../docs/governance/data-first-planning.md).
