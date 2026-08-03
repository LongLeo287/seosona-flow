# PLAN — Sửa "ngõ cụt" khi Chỉnh sửa Template ở bản Local

**Ngày:** 2026-07-22
**Trạng thái:** PLAN (chưa thực thi — chờ chọn hướng)
**Triệu chứng người dùng thấy:**
> "Local mode: không sửa được template gốc (không có server). Hãy clone template thành workflow rồi sửa, hoặc dùng 'Lưu thành Template'."

---

## 1. Đây là gì? (không phải bug)

Đó là **thông báo chặn** đã thêm để thay cho crash cũ
`Cannot read properties of undefined (reading '_apiCall')`.

Diễn biến:
1. Bấm **"Chỉnh sửa"** trên 1 template (tab Templates)
   → `WorkflowTemplateList._openTemplateForEdit()` (dòng 2018)
   → mở **cửa sổ template-editor riêng** ở mode `edit`.
2. Sửa xong bấm **"Cập nhật Template"**
   → `WorkflowEditor._updateTemplate()` (dòng 13047)
   → gọi `PUT admin/workflow-templates/{id}` = **cập nhật template master TRÊN SERVER**.
3. Bản này **100% local, không có server** → không cập nhật được → hiện thông báo.

## 2. Gốc rễ

- 56 template là **hằng số cứng trong code** (`BUNDLED_TEMPLATES` trong
  `src/workflow/BundledWorkflowsExtra.js`), phục vụ qua **local bypass** ở
  `WorkflowTemplateList._apiCall()` (dòng 616) khi GET. → Về bản chất **không thể
  "update" chúng** vì chúng nằm trong file JS, không nằm trong storage.
- Nút "Chỉnh sửa" template được mở cho **mọi user** (comment `WorkflowTemplateList:915`:
  "user edit trực tiếp template") — nhưng **cả 2 đường lưu đều cần server:**
  - "Cập nhật Template" → `PUT admin/...` → **chặn** (thông báo bạn thấy)
  - "Lưu thành Template" → `SaveTemplateModal.show()` → **chặn** ở local
    (`SaveTemplateModal.js:32` báo "cần tài khoản online")
- ⇒ Ở local, bấm "Chỉnh sửa" template xong **không có chỗ nào lưu được** = UX cụt đường.

## 3. Cái gì ĐÃ chạy tốt ở local (quan trọng)

**"Dùng template"** = `WorkflowTemplateList._copyTemplateToWorkflow()` (dòng 1625):
- Flatten template (shape lồng `{id,type,position,data}` → phẳng `node_type/pos_x/...`)
- `LocalStorage.saveWorkflowFull(newWorkflow, nodes, edges)` → lưu vào **My Workflows**
- Chuyển sang tab Workflows + **tự mở editor** workflow mới
→ Đây chính là **luồng "clone để sửa" — đã hoạt động, đã test**.

Nghĩa là: người dùng **đã có thể** tùy biến template (qua bản sao trong My Workflows).
Chỉ là nút "Chỉnh sửa" riêng lẻ dẫn tới cửa sổ cụt, gây hiểu lầm.

---

## 4. Ba hướng xử lý

### Hướng 1 — Đổi "Chỉnh sửa" → Clone-để-sửa  ⭐ KHUYẾN NGHỊ
Ở local mode, nút "Chỉnh sửa" template gọi thẳng `_copyTemplateToWorkflow()`
(thay vì mở cửa sổ template-editor cụt). User sửa **bản sao của mình** trong
My Workflows — nơi lưu/sửa tự do đã chạy ổn.

- **Công sức:** rất nhỏ (route lại 1 nút + đổi nhãn/tooltip cho rõ, vd "Dùng & sửa").
- **Rủi ro:** tối thiểu (tái dùng code clone đã test).
- **Hạn chế:** bản sửa nằm ở My Workflows; template trong gallery **giữ nguyên gốc**
  (không sửa được tên/ảnh/nội dung template hiển thị trong tab Templates).
- **Chuẩn ngành:** giống n8n — template là điểm khởi đầu, bạn tùy biến bản copy.

### Hướng 2 — Kho template LOCAL (sửa thật trong gallery)
Thêm kho lưu local để **sửa/tạo template hiển thị ngay trong gallery Templates**.
- Storage mới:
  - `af_template_overrides` (map `id → template đã sửa`) cho template bundled bị chỉnh
  - `af_local_templates` (mảng) cho template **mới do user tạo**
- Sửa `_apiCall` local bypass (dòng 616): **merge** override + local templates
  **đè lên** `BUNDLED_TEMPLATES` khi trả list và khi get 1 template.
- Thêm nhánh local cho `_updateTemplate()`: ghi vào `af_template_overrides`
  (không gọi server).
- Thêm nhánh local cho `SaveTemplateModal`/`_saveAsTemplate`: ghi `af_local_templates`.
- Thêm nút **"Khôi phục gốc"** (xóa override) + xóa template local.
- **Công sức:** trung bình–lớn.
- **Rủi ro:** trung bình (schema storage, merge, migration, reset, phân biệt
  bundled-đã-sửa vs template-mới).
- **Lợi:** bạn có **thư viện template riêng** chỉnh sửa được toàn diện.

### Hướng 3 — Ẩn nút "Chỉnh sửa" ở local (nhỏ nhất)
Ẩn nút "Chỉnh sửa" (và "Lưu thành Template" vốn đã chặn) khi local mode,
chỉ giữ "Dùng template".
- **Công sức:** rất nhỏ.
- **Rủi ro:** tối thiểu.
- **Hạn chế:** mất khả năng tùy biến template trong gallery; đơn thuần dọn ngõ cụt.

---

## 5. Khuyến nghị

**Làm Hướng 1 ngay** (mở khóa hôm nay, gần như zero rủi ro, tái dùng code đã chạy).
→ Nút "Chỉnh sửa" ở local trở thành "Dùng & sửa": clone vào My Workflows rồi mở sửa.

**Sau đó (tùy chọn) cân nhắc Hướng 2** nếu bạn thực sự muốn một **thư viện
template riêng chỉnh sửa được ngay trong tab Templates** (tên/ảnh/nội dung),
kèm khôi-phục-gốc.

Không nên chọn Hướng 3 đơn độc vì nó bỏ hẳn nhu cầu "sửa template" thay vì đáp ứng.

---

## 6. Các bước thực thi (khi bạn duyệt Hướng 1)

1. `WorkflowTemplateList._openTemplateForEdit()` (dòng 2018): đầu hàm, nếu
   `self.SEOSONA_LOCAL_MODE !== false` → gọi `this._copyTemplateToWorkflow(templateId)`
   và `return` (không mở cửa sổ template-editor).
2. Nút "Chỉnh sửa" trên card template (dòng ~915 / handler ~487): ở local mode
   đổi nhãn/tooltip thành "Dùng & sửa" (hoặc gộp vào nút "Dùng template" luôn) để
   không gây kỳ vọng sai.
3. (Dọn) Không cần đụng `_updateTemplate` — thông báo chặn hiện tại vẫn là lưới an
   toàn nếu có đường nào khác lọt vào template-editor mode.
4. Kiểm thử: local mode → tab Templates → "Chỉnh sửa" 1 template → phải nhảy sang
   My Workflows + mở editor bản sao; sửa + lưu OK; gallery template gốc không đổi.

**File chạm (Hướng 1):** `src/workflow/WorkflowTemplateList.js` (chỉ 1 file).

## 7. Phác thảo thực thi (nếu sau này chọn Hướng 2)

**File chạm:** `WorkflowTemplateList.js` (_apiCall merge, nút khôi phục),
`WorkflowEditor.js` (_updateTemplate nhánh local), `SaveTemplateModal.js` (nhánh local),
+ schema storage + migration. Sẽ tách plan chi tiết riêng khi cần.

---

# CHỐT THIẾT KẾ (2026-07-22) — supersede mục 4-5

Người dùng chốt: **kho template = MẶC ĐỊNH (read-only)**. Bấm **Lưu** hoặc **Chỉnh sửa**
→ lưu thành **bản RIÊNG của user** trong **1 folder riêng**, **KHÔNG đụng bản gốc**.
Muốn sửa **gốc** (BUNDLED_TEMPLATES trong code) → **chỉ khi user bảo Claude sửa code**.

Đây là Hướng 2 rút gọn: **không override/merge phức tạp** — chỉ **thêm 1 kho user
tách biệt**. Bản gốc không bao giờ bị runtime chạm vào ⇒ không cần "khôi phục gốc".

## A. Mô hình dữ liệu

- `BUNDLED_TEMPLATES` (56, trong `BundledWorkflowsExtra.js`) = **mặc định, read-only**.
  Runtime KHÔNG bao giờ ghi đè. Chỉ Claude sửa file khi user yêu cầu.
- Kho mới: `chrome.storage.local['af_user_templates']` = **mảng template của user**.
  Mỗi item:
  ```
  {
    id: 'utpl_<ts>_<rand>',        // prefix 'utpl_' → phân biệt với id bundled (số)
    name, description,
    category_name, tags, media_type,
    nodes, edges,                  // cùng shape bundled
    _userTemplate: true,
    _forkedFrom: <bundledId|null>, // nếu tạo từ 1 template mặc định (để tham chiếu)
    created_at, updated_at
  }
  ```

## B. Hiển thị trong tab Templates

- Gallery hiện **cả 2 nhóm**, tách rõ:
  - **"Của tôi"** (af_user_templates) — hiện trước, có badge + nút Xóa/Sửa.
  - **"Mặc định"** (BUNDLED_TEMPLATES) — chỉ có nút Dùng / "Sửa (tạo bản riêng)".
- Filter/section header để user phân biệt. Bundled không có nút Xóa.

## C. Các luồng

1. **Chỉnh sửa template MẶC ĐỊNH** → tạo **fork** vào `af_user_templates`
   (`_forkedFrom = bundledId`) → mở editor sửa bản fork → Lưu = ghi lại vào
   `af_user_templates`. **Bản mặc định giữ nguyên.**
2. **Chỉnh sửa template CỦA TÔI** → sửa tại chỗ → Lưu = ghi đè item đó trong
   `af_user_templates`.
3. **"Lưu thành Template"** (từ workflow) → tạo item mới trong `af_user_templates`.
4. **Xóa** → chỉ xóa được template "Của tôi"; mặc định không xóa.
5. **Sửa GỐC** = chỉ Claude sửa `BundledWorkflowsExtra.js` khi user yêu cầu.

## D. Điểm chạm code

- **Mới:** `src/workflow/UserTemplateStore.js` — CRUD trên `af_user_templates`
  (`list()`, `get(id)`, `saveNew(tpl)`, `update(id, tpl)`, `remove(id)`,
  `forkFromBundled(bundledId)`). Load trong 2 HTML: sidebar + template-editor.
- `WorkflowTemplateList._apiCall()` (dòng ~616) — local bypass: **gộp**
  `af_user_templates` vào kết quả list; get theo id: nếu prefix `utpl_` → đọc
  từ store, ngược lại đọc BUNDLED. (search/filter áp cho cả 2.)
- `WorkflowTemplateList._loadTemplates()` / `_renderTemplates()` — thêm nhóm
  "Của tôi", badge, nút Xóa cho user template.
- `WorkflowTemplateList._openTemplateForEdit()` (dòng 2018):
  - id mặc định → `UserTemplateStore.forkFromBundled(id)` → set `_pendingTemplate`
    = bản fork → mở template-editor với id `utpl_...`.
  - id `utpl_` → set `_pendingTemplate` = item store → mở template-editor.
- `WorkflowEditor._updateTemplate()` (dòng 13047) — **nhánh local**: nếu
  `SEOSONA_LOCAL_MODE` và templateId prefix `utpl_` → `UserTemplateStore.update()`
  (KHÔNG gọi server PUT). Bỏ/skip thông báo chặn cũ cho nhánh này.
- `SaveTemplateModal` (dòng 32) / `_saveAsTemplate` — **nhánh local**: lưu thẳng
  `UserTemplateStore.saveNew()` thay vì chặn "cần online". (Có thể giữ 1 modal
  local nhẹ chỉ hỏi tên/category, bỏ phần upload ảnh/community.)
- Handler nút Xóa template (local) → `UserTemplateStore.remove()` + reload.

## E. Ước lượng & rủi ro

- **Công sức:** trung bình (1 module mới + ~4 điểm chạm; không có migration vì kho
  mới, không đụng dữ liệu cũ).
- **Rủi ro:** thấp–trung bình. An toàn vì **không đụng BUNDLED gốc**; kho user là
  storage riêng, sai sót chỉ ảnh hưởng template user tự tạo.
- **Verify:** cần user reload extension + thao tác thực (không verify UI ở môi
  trường dev). Có thể viết harness kiểm CRUD store + merge list.

## F. Thứ tự triển khai đề xuất (từng bước an toàn)

1. `UserTemplateStore.js` + harness CRUD (không đụng UI) → commit.
2. Gộp store vào `_apiCall` list/get + render nhóm "Của tôi" (đọc, chưa ghi) → commit.
3. Luồng "Lưu thành Template" → `saveNew` (đường tạo mới, ít rủi ro nhất) → commit.
4. Luồng "Chỉnh sửa" (fork bundled / sửa user) + `_updateTemplate` local → commit.
5. Nút Xóa user template → commit.
Mỗi bước reload kiểm trước khi qua bước sau.
