---
description: Tạo b-roll VIDEO CÂM qua SEOSONA Flow (để Video AI V2 lồng tiếng)
argument-hint: <mô tả cảnh>
---
Tạo b-roll **câm** qua MCP `seosona-flow-local` (KHÔNG voice — để SEOSONA Video AI V2 lồng giọng khớp kịch
bản, tránh lệch nội dung↔voice):

1. Rà mô tả "$ARGUMENTS" theo skill **anti-slop-visual**.
2. Gọi `gen_video` với prompt đã tinh, **KHÔNG truyền `voice`**, ratio mặc định `9:16`. Truyền `client_ref`
   (scene id) nếu là pipeline nhiều cảnh.
3. Với video, gọi `export_asset(video_url)` → tải file về `Downloads/<folder>/<file>` (V2 đọc để mux).
4. Báo `path_hint` + trạng thái. Lỗi → xử theo `error_code`.
