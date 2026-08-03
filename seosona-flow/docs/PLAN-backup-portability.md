# PLAN — Backup & Portability (mang data qua máy khác)

**Ngày:** 2026-07-22
**Trạng thái:** PLAN (chưa thực thi)
**Vấn đề:** Extension 100% local, không server. Data user chỉ nằm trên 1 máy →
reinstall / reset profile Chrome / đổi máy = **mất sạch data tự tạo**. Cần cơ chế
**export ra file** để máy khác **import** dùng tiếp, không cần setup.

---

## 1. Data user nằm ở đâu (theo map thực tế)

**2 nơi** (session storage chỉ là state tạm → bỏ qua):

### a) `chrome.storage.local` (JSON, quota ~10MB) — chứa GẦN HẾT, phần lớn NHẸ
Nguồn định danh: `settings-page.js:1851-1879` (`CHROME_STORAGE_DEFS`).
- **Data user cốt lõi:** `af_user_prompts` (My Prompts), `af_workflows` + `af_nodes`
  + `af_edges` (My Workflows — lưu tách 3 key), `af_tasks` (hàng đợi), `af_settings`,
  `af_history`, `af_angles_results`, `af_effects_results`, `af_projects`,
  `seosona_gentab_state`, `recent_mention_slugs`, `af_daily_stats`.
  → **Sau này:** `af_user_templates` (kho template user) sẽ **tự động** nằm ở đây.
- **Cache tái tạo được (nên loại khi export):** `seosona_i18n_*`, `af_system_settings`,
  `seosona_provider_*`, `af_chatgpt_config`, `af_grok_config`, `af_addon_prompts`,
  `af_entitlements`, `af_execution_config`.
- **Secret (PHẢI loại/cảnh báo):** `af_auth` (token), `local_mcp_tokens`,
  `seosonaLocalMcp`.

### b) IndexedDB `seosonaflow_pro` (v4) — phần ẢNH, NẶNG
3 store cần cho backup ảnh album:
- `albums` (nhẹ — tên + image_ids)
- `album_images` (nhẹ — metadata: name @mention, file_id, thumbnail_url, blob_key)
- `image_blobs` (**NẶNG** — `thumbnail_blob` ≤50KB WebP + `medium_blob` 1200px, chỉ
  cho ảnh upload/capture local; ảnh Flow không lưu medium vì có CDN backup)

**Bỏ qua (transient/TTL):** `pending_uploads`, `uploaded_cache`,
`lightweight_pending`, `workflow_paste_blobs` — tự re-upload hoặc hết hạn.

### Kết luận ảnh
- Thumbnail trong `af_tasks`/`af_nodes`/`af_history`/... **phần lớn là URL CDN Google
  Flow (nhẹ, tham chiếu)**. Có rủi ro thỉnh thoảng là `data:image/...base64` → **đo
  kích thước thực** bằng `estimateSize` (`settings-page.js:1898`) và cảnh báo nếu phình.
- Ảnh **thật sự nặng** chỉ ở IndexedDB `image_blobs` (ảnh album local).

---

## 2. Nền tảng ĐÃ CÓ trong code (tái dùng)

- **`src/storage/DataLifecycleService.js`** — service headless đã viết sẵn, đúng mục đích:
  - `exportAll(opts)` → bundle `{schema:'seosona.privacy.export.v1', version:1,
    entries: <chrome.storage.get(null)>}`, có `exportPolicy.sanitizeExport` để strip secret.
  - `importBundle(bundle)` → validate schema + chặn prototype pollution + `area.set(patch)`.
  - `deleteKeys/deleteAll/snapshot`. Global `self.SEOSONA_DataLifecycleService`.
  - **Hạn chế:** chỉ dùng trong tests, **chưa có caller UI**; chỉ xử `chrome.storage`,
    **KHÔNG đụng IndexedDB**.
- **`src/shared/WorkflowExportHelper.js:279` `downloadJson(data, filename)`** — tải file
  qua Blob + `<a download>`. Tái dùng để xuất file backup.
- **Settings page** đã có UI quét/xoá storage (`scanChromeStorage`/`scanIndexedDB`,
  `estimateSize`) nhưng **chưa có nút Export/Import**.

→ **Tier 1 gần như chỉ cần: nối `DataLifecycleService` vào 2 nút trong Settings.**

---

## 3. Hướng đi đề xuất — làm 2 TIER

### TIER 1 — Backup NHẸ (JSON storage.local) ⭐ làm trước, đủ ~90% nhu cầu
Export/Import toàn bộ `chrome.storage.local` (trừ secret + cache tái-tạo-được).
- Bao trọn: prompts, workflows, nodes, edges, tasks, settings, history, angles/effects,
  projects, và `af_user_templates` (tương lai — tự động vì quét `get(null)`).
- **1 file `.json`** gọn (thường vài trăm KB – vài MB). Không cần thư viện ngoài.
- **Công sức:** NHỎ (service đã có). **Rủi ro:** thấp.

### TIER 2 — Backup ĐẦY ĐỦ (kèm ảnh album) — tùy chọn, làm sau
Thêm export IndexedDB `albums` + `album_images` + `image_blobs` (blob → base64 nhúng
vào cùng file JSON để giữ **self-contained, không cần thư viện ZIP**).
- File nặng hơn (tùy số ảnh local). Có cảnh báo dung lượng trước khi xuất.
- **Công sức:** trung bình (serialize/restore blob, khớp `blob_key`). **Rủi ro:** trung bình.

### (Tương lai xa) Auto-backup ra thư mục
File System Access API `showDirectoryPicker` — user chọn folder 1 lần, extension tự
ghi backup định kỳ. Tiện nhất nhưng phức tạp + quyền folder. **Chưa làm giờ.**

---

## 4. Thiết kế kỹ thuật

### Format file backup (thống nhất cho cả 2 tier)
```
{
  schema: 'seosona.backup.v1',
  version: 1,
  createdAt: <ISO string>,          // stamp SAU khi tạo (script không có Date.now trong workflow; UI thì có)
  app: 'seosona-flow',
  storage: { <key>: <value>, ... }, // chrome.storage.local đã lọc
  indexeddb?: {                     // chỉ khi Tier 2 / includeImages
    albums: [...],
    album_images: [...],
    image_blobs: [{ id, thumbnail_blob_b64, medium_blob_b64? }]
  }
}
```
Tương thích ngược: import chấp nhận cả `seosona.privacy.export.v1` (chỉ storage) lẫn
`seosona.backup.v1`.

### Danh sách loại trừ khi export (constant, ở 1 chỗ)
- **Secret:** `af_auth`, `local_mcp_tokens`, `seosonaLocalMcp` (mặc định loại; có
  checkbox "kèm cả token đăng nhập" tắt sẵn).
- **Cache tái tạo:** `seosona_i18n_en/vi`, `af_system_settings`, `seosona_provider_*`,
  `af_chatgpt_config`, `af_grok_config`, `af_addon_prompts`, `af_entitlements`,
  `af_execution_config`, `af_pending_sync`, `af_running_workflow`, `af_stopped_wfids`.
- **Transient IndexedDB:** `pending_uploads`, `uploaded_cache`, `lightweight_pending`,
  `workflow_paste_blobs`.

### Import — chế độ hợp nhất
- **Mặc định "Hợp nhất" (merge):** với key dạng mảng theo id (workflows/nodes/edges/
  prompts/tasks/user_templates) → thêm mới + ghi đè trùng id, giữ cái đang có; với key
  đơn (settings/gentab_state) → ghi đè.
- **Tùy chọn "Thay thế toàn bộ" (replace):** xóa sạch rồi nạp (có xác nhận 2 lớp).
- Validate schema + version trước khi nạp; sai → báo lỗi rõ, không nạp nửa vời.
- IndexedDB: ghi lại qua `AlbumStore`/`ImageStore`, `blob_key` phải khớp `album_images`.

### UI (trong Settings page)
Thêm mục **"Sao lưu & Khôi phục"**:
- Nút **[Xuất backup]** + checkbox "Kèm ảnh album (nặng hơn)" + hiển thị **dung lượng
  ước tính** (dùng `estimateSize`).
- Nút **[Nhập backup]** (file picker `.json`) + chọn chế độ Hợp nhất / Thay thế.
- Ghi chú ngắn: "File này mang sang máy khác, cài extension rồi Nhập để dùng tiếp."

---

## 5. Điểm chạm code

**Tier 1:**
- `src/storage/DataLifecycleService.js` — dùng lại (có thể mở rộng: nhận danh sách
  loại-trừ; giữ nguyên API).
- **Mới:** `src/storage/BackupService.js` — gói: `exportBackup({includeImages})` +
  `importBackup(bundle, {mode})`; Tier 1 chỉ gọi storage.local (qua DataLifecycleService)
  + `downloadJson`.
- `scripts/settings-page.js` — thêm mục UI + handler 2 nút + estimate size.
- Reuse `src/shared/WorkflowExportHelper.js` `downloadJson`.

**Tier 2 (bổ sung sau):**
- `BackupService` mở rộng đọc/ghi IndexedDB qua `AlbumStore`/`ImageStore`
  (`src/core/AlbumStore.js`, `src/core/ImageStore.js`); blob ↔ base64.

**Harness/test:** `tests/privacy/data-lifecycle.test.mjs` đã có sẵn cho storage layer —
thêm test round-trip cho `BackupService` (export → import → so khớp).

---

## 6. Ước lượng & rủi ro
- **Tier 1:** nhỏ, rủi ro thấp (service + downloadJson đã có; chỉ nối UI + lọc key + import merge).
- **Tier 2:** trung bình, rủi ro trung bình (blob serialize/restore, dung lượng, khớp blob_key).
- **Verify:** cần user reload + thao tác thật (export → cài máy/profile khác → import).
  Round-trip test tự động cho storage layer chạy được ở harness.

---

## 7. Nên làm bây giờ hay để sau? — KHUYẾN NGHỊ

**Nên làm Tier 1 SỚM** (bảo hiểm rẻ cho data đang tích lũy; nền tảng đã có nên nhanh).
Thứ tự đề xuất tổng thể:
1. **Backup Tier 1** (JSON storage.local) — bảo vệ ngay mọi data hiện có.
2. **Kho template user** (`af_user_templates`) — backup Tier 1 tự gói vào, không phải sửa lại.
3. **Backup Tier 2** (kèm ảnh album) — khi cần mang cả ảnh local.
4. (Xa) Auto-backup ra thư mục.

> Lý do xếp Tier 1 trước kho template: chỉ ~1 module + nối UI, rủi ro thấp, và bảo vệ
> data ngay. Kho template không phụ thuộc backup và ngược lại → làm cái nào trước cũng được,
> nhưng Tier 1 "rẻ và cấp thiết" hơn.
