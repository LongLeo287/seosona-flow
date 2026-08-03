---
description: Tạo ảnh qua SEOSONA Flow (MCP)
argument-hint: <mô tả ảnh>
---
Tạo ảnh qua MCP `seosona-flow-local`:

1. Rà prompt "$ARGUMENTS" theo skill **anti-slop-visual** — bỏ cụm sáo rỗng (8k/masterpiece/trending on
   artstation/tính từ cảm thán), ép danh từ·chất liệu·ánh sáng·ống kính cụ thể.
2. (nếu cần) gọi `list_capabilities` chọn model/ratio hợp lý.
3. Gọi `gen_image` với prompt đã tinh. Nếu là 1 phần pipeline nhiều cảnh, truyền `client_ref` (scene id) để
   idempotent (chạy lại không tốn quota).
4. Trả `assets[]` (url + thumbnail). Nếu lỗi, xử theo `error_code` (PROVIDER_NOT_LOGGED_IN / DAILY_QUOTA_
   EXCEEDED / EXTENSION_BUSY / WRONG_PROJECT) — KHÔNG retry mù.
