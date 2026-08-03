# SPEC — Main tab "Spaces" (định nghĩa · cấu trúc · cơ chế · liên kết · hoạt động)

**Ngày:** 2026-07-22 · **Trạng thái:** SPEC (chờ chốt trước khi align code)

Main tab **Spaces** = trung tâm quản lý & chạy workflow. **4 sub-tab CÙNG một cấu trúc**
(lưới card giống nhau), khác ở **nguồn data + vai trò + hành động chính + liên kết**.

---

## 1. Cấu trúc chung (mọi sub-tab giống nhau)

- **Layout:** lưới card + thanh trên (search + filter category) + empty-state (glow brand) + toolbar.
- **Card:** thumbnail · tên · badge category · "N node" · nút hành động chính (theo tab).
- **Component nền:** dùng chung grid/search/empty-state (đồng bộ CSS token + glass đã làm).

---

## 2. Định nghĩa từng sub-tab (theo bạn chốt)

| Sub-tab | Nội dung (data) | Vai trò | Hành động chính | Liên kết |
|---|---|---|---|---|
| **Templates** | Kho mẫu: `BUNDLED_TEMPLATES` (56) + `af_user_templates` (fork/user) | Thư viện **mẫu** read-only, điểm bắt đầu | **Dùng** → clone vào My Spaces · **Chỉnh sửa** → fork thành template user · Xóa (chỉ user) | → **My Spaces** |
| **My Spaces** | `af_workflows` (workflow user: từ template hoặc custom) | **Quản lý + tùy chỉnh** (build/edit) — "nhà" của workflow | **Mở** (edit canvas) · Nhân bản · Đổi tên · Xóa · **Chạy** → đẩy sang Flows | ← Templates/Shared · → **Flows** (khi Chạy) · → Canvas editor |
| **Flows** | Workflow **đang/sẵn sàng chạy** + trạng thái chạy | **Nơi CHẠY** + theo dõi tiến độ + kết quả | **Chạy/Dừng** · Run All · xem tiến độ/kết quả · Mở | ← My Spaces (được đẩy sang khi Chạy) · → History/Tasks (kết quả) |
| **Shared** | Workflow được chia sẻ (link/cộng đồng) | Nhập workflow người khác | **Nhập** → My Spaces | → My Spaces |

---

## 3. Cơ chế & luồng dữ liệu (linkage)

```
Templates ──(Dùng/clone)──▶ My Spaces ──(Chạy)──▶ Flows ──(kết quả)──▶ History/Tasks
Shared   ──(Nhập)────────▶ My Spaces
```

- **Templates → My Spaces:** clone template (bundled/user) thành workflow trong `af_workflows`.
- **My Spaces → Flows:** bấm "Chạy" 1 space → workflow được đưa sang Flows để thực thi (đang chạy /
  hàng đợi). My Spaces = định nghĩa; Flows = thực thi.
- **Flows → History/Tasks:** kết quả gen đổ về lịch sử / hàng đợi task.
- **Shared → My Spaces:** nhập bản chia sẻ về kho của mình.

---

## 4. Hiện trạng code (để align) — CÓ INVERSION

Khoá nội bộ `data-subtab` (giữ nguyên, ~26+ tham chiếu):

| Khoá | Nhãn hiện tại | Render hiện tại | ĐÚNG vai theo spec? |
|---|---|---|---|
| `templates` | Templates | `WorkflowTemplateList` (bundled + user, search+category, Dùng/Sửa/Xóa) | ✅ ĐÚNG = **Templates** |
| `workflows` | **Flows** | `WorkflowList` (danh sách đầy đủ: Mở/Sửa/Nhân bản/Xóa/Run/Import) | ❌ đây là **quản lý** → phải là **My Spaces** |
| `mytemplates` | **My Spaces** | launcher `.ms-space-card` (đọc af_workflows, chỉ Mở + Chạy) | ❌ đây là **chạy** → phải là **Flows** |
| `shared` | Shared | `WorkflowList.renderSharedTab` | ✅ ĐÚNG = **Shared** |

→ **My Spaces ↔ Flows đang NGƯỢC vai.** Cả 2 đọc cùng `af_workflows` (trùng data).

---

## 5. Đề xuất align (giữ khoá nội bộ, chỉ đổi nhãn + vai + hành động)

**KHÔNG đổi `data-subtab` keys** (tránh gãy 26+ ref). Chỉ hoán **nhãn + vai trò render**:

- **`workflows`** (WorkflowList quản lý đầy đủ) → gắn nhãn **"My Spaces"** + vai *quản lý/tùy chỉnh*.
  Hành động card: Mở/Sửa/Nhân bản/Xóa + **"Chạy"** (Chạy → chuyển sang tab Flows).
- **`mytemplates`** (launcher chạy) → gắn nhãn **"Flows"** + vai *nơi chạy*.
  Hiển thị workflow + trạng thái chạy + Run/Dừng + tiến độ. (Có thể lọc chỉ workflow "đã/đang chạy".)
- **`templates`** giữ nguyên = **Templates**.
- **`shared`** giữ nguyên = **Shared**.
- **Reorder** hiển thị: **My Spaces · Flows · Templates · Shared** (hoặc thứ tự bạn muốn).
- **Đồng bộ toolbar:** thêm search + filter cho cả 4 (Templates & Flows/workflows đã có; My Spaces
  launcher & Shared cần thêm) → "toàn bộ giống nhau".

**CROSS-LINK "Chạy → Flows":** nút Chạy ở My Spaces (workflows) → `runWorkflow` + `_switchSubtab('mytemplates')`
(tab Flows) để user thấy nó đang chạy.

---

## 6. Câu cần bạn chốt trước khi code

1. **Flows = gì?** (a) *danh sách workflow ở chế độ chạy* (cùng af_workflows, khác hành động) —
   hay (b) *chỉ những workflow đang/đã chạy* (lọc theo trạng thái, như dashboard runs)?
2. **Landing** khi mở tab Spaces: **My Spaces** hay **Templates**?
3. **Thứ tự sub-tab** mong muốn?
4. Có giữ **hoán vai** như mục 5 (nhãn theo đúng semantics) không, hay bạn muốn cách map khác?
