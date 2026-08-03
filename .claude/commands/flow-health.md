---
description: Kiểm tra Flow-MCP sống + năng lực (models/voices/ratios)
---
Dùng MCP server `seosona-flow-local` (SEOSONA Flow — xem skill flow-mcp):

1. Gọi tool `health` → báo `extension_connected`, `server_version`, `contract_version`, `pending_jobs`.
2. Nếu `extension_connected` = true, gọi `list_capabilities` → tóm tắt: image models, video models (cái nào
   bake voice), ratios, số voices.
3. Nếu chưa nối, hướng dẫn user: mở side panel SEOSONA Flow trên tab `labs.google/fx` (đã đăng nhập Google),
   và đảm bảo Local MCP server đang chạy (`claude mcp add seosona-flow-local -- node …/mcp-local/server.mjs`).
