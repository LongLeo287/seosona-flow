# Tier-2 — Kế hoạch tái cấu trúc UX (design, CHƯA code)

> Dựa trên audit `docs/AUDIT-structure-2026-07-23.md`. Mục tiêu: gỡ chồng chéo chức năng +
> nhãn khó hiểu. **Mọi phần implement là JS/HTML → không runtime-verify được ở preview →
> cần smoke-test extension thật sau khi code.** Doc này để CHỐT QUYẾT ĐỊNH trước.

## Vấn đề cốt lõi (từ audit)
1. **"Lấy prompt" ở 3 nơi** cùng đổ vào `#promptsArea`: tab Prompts + modal Prompt Assistant + 4 nút trong Gen.
2. **3 hệ tạo-hàng-loạt** trùng vai: Gen multi-prompt · Tasks · Spaces/workflow.
3. **My Spaces ≈ Flows**: gần trùng, chỉ khác cờ `flow_kind` vô hình.
4. **"Templates" = 2 tab khác nhau** (Prompts→Templates vs Spaces→Templates).
5. **Xem kết quả ở 3 nơi**: History · Photos→Flow Images · Gen→Failed.
6. **Phân cấp lệch**: Tools = lưới launcher ở top-level; Prompts thực chất là feeder của Gen; History/Photos bị đẩy vào ⋮ còn Tasks (hẹp hơn) ở nav chính.
7. **Nhãn ≠ id**: `tab-templates`="Prompts", `tab-workflow`="Spaces"; "Spaces" mơ hồ.

---

## Các quyết định cần chốt (mỗi cái kèm khuyến nghị)

### QĐ-1 — "Lấy prompt": gom về đâu?
- **A (khuyến nghị)**: Biến **Prompts thành drawer/panel trong Gen** (trượt ra cạnh ô prompt). Bỏ 1 tab top-level; thư viện prompt nằm ngay chỗ gõ. Prompt Assistant + 4 nút Gen giữ nguyên (đều là công cụ trong Gen).
- **B**: Giữ Prompts top-level nhưng làm rõ "thư viện → gửi sang Gen" (nhãn/onboarding).
- **C**: Giữ nguyên.
- *Rủi ro impl*: A = di chuyển DOM tab-templates vào Gen + rewire subtab → JS vừa, cần test.

### QĐ-2 — 3 hệ tạo-hàng-loạt: gom hay chú thích?
- Gen multi-prompt = "nhiều prompt 1 lần" (nhanh). Tasks = "job đã lưu tái dùng". Spaces = "workflow node-graph".
- **A**: Gộp **Tasks vào Gen** thành lớp "lưu/nạp job" (bỏ tab Tasks).
- **B (khuyến nghị bước đầu)**: Giữ cả 3 nhưng **thêm biển chỉ dẫn** (nhãn/tooltip/empty-state giải thích khi nào dùng cái nào). Rẻ, ít rủi ro.
- **C**: Giữ nguyên.
- *Ghi chú*: A rủi ro cao (Tasks engine ~2000 dòng trong app.js — đã cờ đỏ không move). B an toàn.

### QĐ-3 — My Spaces vs Flows: gộp?
- **A (khuyến nghị)**: Gộp **1 danh sách** + chip lọc (Tất cả / Của tôi / Flow) hoặc toggle run/edit. Bỏ phân đôi vô hình.
- **B**: Giữ 2 sub-tab nhưng đổi tên cho rõ khác biệt.
- **C**: Giữ nguyên.
- *Rủi ro impl*: A = sửa WorkflowTab render + filter theo `flow_kind` → JS vừa, cần test.

### QĐ-4 — Đặt tên: đồng bộ nhãn↔id↔class?
- **A**: Đổi id/class nội bộ khớp nhãn (`tab-workflow`→`tab-spaces`...). **Churn RẤT lớn + rủi ro** (hàng trăm ref code/CSS/JS). **KHÔNG khuyến nghị.**
- **B (khuyến nghị)**: **Giữ id nội bộ**, chỉ (a) tài liệu hóa map id↔nhãn, (b) cân nhắc đổi **nhãn user-facing** cho rõ: "Spaces"→"Workflow"/"Tự động"? "Prompts" giữ (đúng nghĩa). Chỉ đổi text nhãn = rất ít rủi ro.
- **C**: Giữ nguyên.

### QĐ-5 — Phân cấp nav chính vs ⋮
- Nếu QĐ-1(A) + QĐ-2(A): nav chính rút còn **Gen · Spaces** — rất gọn. Nếu chỉ QĐ-1(A): **Gen · Spaces · Tasks**.
- Cân nhắc đưa **History** lên gần hơn (người dùng hay xem lại kết quả), Tools giữ trong ⋮ (đúng vai launcher).
- Quyết định này **phụ thuộc QĐ-1/QĐ-2** → chốt sau.

---

## Thứ tự thực thi đề xuất (khi đã chốt + có smoke-test)
1. **Rẻ + an toàn trước**: QĐ-4(B) đổi nhãn text + QĐ-2(B) thêm biển chỉ dẫn. (CSS/text/i18n — preview-verify được phần lớn.)
2. **JS vừa**: QĐ-3(A) gộp My Spaces+Flows (1 file WorkflowTab, dễ khoanh vùng). Smoke-test.
3. **JS lớn hơn**: QĐ-1(A) Prompts→drawer Gen. Smoke-test kỹ.
4. QĐ-5 chỉnh nav theo kết quả 1-3.

## Ràng buộc
- Giữ khoá nội bộ (id/data-subtab) — chỉ đổi nhãn hiển thị (theo memory [workflow-tab-restructure]).
- Không move Tasks engine (cờ đỏ). QĐ-2(A) vì thế xếp sau cùng / có thể bỏ.
- Mỗi bước JS: commit riêng + smoke-test extension thật (preview không chạy JS).

---

## ✅ QUYẾT ĐỊNH ĐÃ CHỐT (2026-07-24)
- **QĐ-1 = B**: Giữ Prompts top-level, **làm rõ nhãn/hint** "thư viện → gửi sang Gen". (i18n/HTML/CSS — an toàn, verify được phần text.)
- **QĐ-2 = B**: Giữ cả 3 hệ batch, **thêm biển chỉ dẫn** (tooltip/empty-state phân biệt Gen-multi / Tasks / Spaces). (i18n/HTML — an toàn.)
- **QĐ-3 = A**: **Gộp My Spaces + Flows → 1 list + chip lọc**. (JS vừa, 1 file WorkflowTab — CẦN smoke-test.)
- **QĐ-4 = A**: **Đổi id nội bộ khớp nhãn** (`tab-workflow`→`tab-spaces`, `tab-templates`→`tab-prompts`). ⚠️ **CHURN LỚN + RỦI RO CAO + KHÔNG runtime-verify được ở preview** → làm CUỐI CÙNG, chỉ khi có smoke-test; grep xác nhận 0 ref sót + migrate storage key `af_active_sidebar_tab`.

## Thứ tự thực thi đã chốt
1. **QĐ-1(B) + QĐ-2(B)** — i18n/text/hint (an toàn, làm được ngay, verify text trong preview).
2. **QĐ-3(A)** — gộp Spaces/Flows (JS vừa) → **smoke-test**.
3. **QĐ-4(A)** — rename id (rủi ro cao) → grep-verify + **smoke-test kỹ**. LÀM CUỐI.

> ⚠️ Bước 2-3 là JS → tôi KHÔNG runtime-verify được ở preview (snapshot tĩnh). Bắt buộc smoke-test extension thật sau mỗi bước.
---

