---
description: Chạy 1 workflow SEOSONA Flow đã lưu (MCP)
argument-hint: [wf_id | từ khoá tên]
---
Chạy workflow qua MCP `seosona-flow-local`:

1. Gọi `list_workflows` → tìm workflow khớp "$ARGUMENTS" (theo `wf_id` hoặc gần đúng `name`). Nếu mơ hồ,
   liệt kê các ứng viên cho user chọn.
2. Gọi `run_workflow(wf_id)`. Nếu `WRONG_PROJECT` → HỎI user, rồi `open_project(expected_id)` → chạy lại.
3. Trả `assets[]`. Với video cần file, gọi `export_asset` cho từng `video_url`.
