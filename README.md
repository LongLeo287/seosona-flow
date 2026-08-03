**[▶ Xem trang giới thiệu dự án](https://seosona-flow.vercel.app)**

# SEOSONA Workflow

Repo chứa **SEOSONA Flow** — Chrome extension (Manifest V3) tự động hoá tạo ảnh/video bằng AI trên **Google Flow**, **ChatGPT**, **Gemini**, **Grok**, cộng tính năng **Image-to-Prompt**.

👉 **Extension nằm trong thư mục [`seosona-flow/`](seosona-flow/)** — đọc [README của extension](seosona-flow/README.md) để biết đầy đủ tính năng và cấu trúc.

## Cài nhanh

```
1. Clone / tải repo về máy
2. Mở chrome://extensions
3. Bật "Developer mode" (góc trên bên phải)
4. Bấm "Load unpacked"
5. Chọn thư mục  seosona-flow/   ← KHÔNG phải thư mục gốc repo
6. Bấm icon extension → Side Panel mở bên phải
```

## Yêu cầu

Chỉ có **hai** thứ:

1. **Google Chrome** (hoặc trình duyệt nhân Chromium hỗ trợ Manifest V3 + Side Panel).
2. **Tài khoản của chính bạn** trên các dịch vụ bạn định dùng — `labs.google/fx` (Flow), `chatgpt.com`, `gemini.google.com`, `grok.com`. Đăng nhập sẵn trong trình duyệt.

Ngoài ra **không cần gì thêm**:

| | |
|---|---|
| Backend / server | ❌ Không cần — extension chạy 100% offline |
| Tài khoản SEOSONA | ❌ Không cần — không có đăng nhập, không có giới hạn gói |
| `npm install` | ❌ Không cần — không có dependency, thư viện đã vendor sẵn trong `lib/` |
| API key trả phí | ❌ Không cần — extension điều khiển tab AI đã đăng nhập của bạn |
| Bước build | ❌ Không cần — mã nguồn nạp trực tiếp |

> ⚠️ Extension **không kèm tài khoản hay API key nào**. Nó điều khiển phiên đăng nhập sẵn có trong trình duyệt của bạn, nên mỗi lần chạy sẽ tiêu credit/quota của chính tài khoản đó. Nếu chưa đăng nhập các trang trên, tab Gen và Image-to-Prompt sẽ không hoạt động.

## Chế độ Local

Extension mặc định chạy **hoàn toàn offline** — xem `seosona-flow/src/core/RuntimeMode.js` (`DEFAULT_LOCAL = true`). Toàn bộ config, quota, lịch sử và lưu trữ dùng default cục bộ (`chrome.storage` + IndexedDB); `ApiClient` chặn mọi request ra backend.

Muốn bật online sau này: đặt `SEOSONA_LOCAL_MODE = false` rồi cấu hình `apiBaseUrl` trong Settings.

## Cấu trúc repo

| Đường dẫn | Vai trò |
|---|---|
| `seosona-flow/` | **Extension** — thứ bạn load vào Chrome |
| `AGENTS.md` · `seosona.project.json` | Quy ước dev + binding SEOSONA OS (không ảnh hưởng extension) |

## Quyền riêng tư

Extension yêu cầu quyền `<all_urls>` để phục vụ Image-to-Prompt (chuột phải ảnh trên bất kỳ trang nào) và auto-download. Không có dữ liệu nào rời khỏi máy bạn: không telemetry, không backend, không gọi API bên thứ ba nào ngoài chính các tab AI mà bạn đã đăng nhập.
