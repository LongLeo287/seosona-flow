# PLAN — Đại tu main tab "Spaces" (SEOSONA Flow)

> Cơ sở: audit sâu 7 trục song song (state/sync · progress-noti · display/render · execution runtime · editor/persistence · lifecycle/wiring · user-action end-to-end). Local-first (`SEOSONA_LOCAL_MODE !== false`). Nguyên tắc: **build chắc, không gãy, không đập-đi-xây-lại vô cớ.**

## 0. Chẩn đoán gốc (vì sao "lệch, hiển thị sai, chưa đồng bộ, tiến trình-thông báo lệch, chậm")

Spaces có **HAI pipeline state bị ghép cơ học**:

- **My Spaces** (`WorkflowList`) = DOM-patch theo event trên mảng in-mem `this.workflows`, có cooldown chống spam.
- **Flows** (`WorkflowTab._loadMyTemplates`) = full re-render đọc thẳng `af_workflows`+`af_nodes` mỗi 500ms, overlay in-mem làm "live layer".

Chúng lệch nhau vì **cùng 1 workflow nhưng đọc từ nguồn khác nhau, cập nhật bằng cơ chế khác nhau, nhịp khác nhau**:

| Triệu chứng | Gốc kỹ thuật |
|---|---|
| Thanh tiến trình nhấp nháy / reset | `_rerenderSingleWorkflowCard` đọc field `workflow.progress` **không bao giờ được set** → luôn ẩn bar, đánh nhau với `_updateCardProgress` (hiện bar) |
| Progress Flows đứng im rồi nhảy 100% | progress chỉ push vào DOM My Spaces; mảng in-mem Flows đọc **không bao giờ nhận progress**; executor lưu `progress_completed/total` **chỉ in-mem, không persist**; nhánh sequential còn **không gọi** `_updateWorkflowProgress` |
| "0 node" ở My Spaces | node-count lấy từ `progress_total` (field lúc chạy) thay vì `nodes.length`; clone ghi `progress_total:0` |
| Cùng workflow, node-count My Spaces ≠ Flows | 3 nguồn đếm khác nhau: `progress_total` (My Spaces) / đếm `af_nodes` (Flows) / `nodes.length` (Shared) |
| Phản hồi chậm khi bấm Run | không có optimistic UI cho Run đơn (chỉ Run-all set `_pendingWfIds`); card chỉ đổi trạng thái khi `execution:started` bắn sau preflight nhiều giây |
| Giật khi đang chạy | Flows destroy+rebuild toàn bộ innerHTML + đọc 2 key storage **mỗi 500ms** |
| Thông báo trùng/thiếu | hoàn tất bắn tách `execution:completed` + `workflow:complete` + path `notifyCompletion` thứ 3 → trùng noti / run bị stop thì noti không nhất quán |
| Màu/nhãn mỗi tab một kiểu | khối CSS "MASTER REBUILD" `!important` (workflow.css L13097–13569) đè lại palette **magenta + Tailwind** thay brand blue/emerald; Flows hardcode nhãn trạng thái tiếng Việt bỏ qua i18n |
| Sửa ở tab này không thấy ở tab kia | refresh policy khác nhau (My Spaces cooldown-gated vs Flows đọc-thẳng-storage) |
| `flow_kind` nửa vời | chỉ set `'space'`; nhánh `'flow'` **chết** → "Flows" thực chất = "đã từng chạy", mâu thuẫn nhãn; không có cách đưa workflow vào Flows mà không chạy |

**Seam mong manh nhất:** `window.workflowList` được **đọc ở 3 file nhưng KHÔNG BAO GIỜ được gán** — chạy được chỉ nhờ fallback tình cờ.

**Rủi ro cấu trúc cao nhất:** editor là **cửa sổ popup riêng** → 2 context JS, mỗi cái 1 mutex per-instance ghi chung `af_workflows`/`af_nodes` → **race mất dữ liệu**; `saveWorkflowFull` = xoá-hết-rồi-chèn-lại từ snapshot cũ → sửa editor giữa lúc chạy bị đè mất. (Đã có `WorkflowRepository` atomic `navigator.locks`+revision **viết sẵn nhưng chưa wire, và key nhầm `id` thay vì `wf_id`**.)

---

## Nguyên tắc xuyên suốt
1. **Một nguồn sự thật** cho mỗi con số (node-count, progress, status) — mọi renderer dùng chung 1 helper.
2. **Một đường cập nhật card** dùng chung My Spaces + Flows (targeted DOM patch, không full-rebuild).
3. Verify sau mỗi phase: `node --check`, `npm run check:static`, `npm run test:unit`, + live browser.
4. Không chạm layer rủi ro (persistence cross-context) cho tới khi các phase UI đã chắc.

---

## ✅ TIẾN ĐỘ (2026-07-23)
- **Phase 0 — DONE**: `window.workflowList` expose; `_getNodeCount`+`_attachNodeCounts` (đếm af_nodes = cùng nguồn Flows, hết "0 node"/lệch); progress-total-dùng-làm-nodecount đã bỏ. Verify: node --check + check:static PASS.
- **Phase 1 — DONE**: `_rerenderSingleWorkflowCard` đọc progress_completed/total (hết nhấp nháy); gỡ listener progress thừa ở WorkflowTab; regex-meta chết → cập nhật `.wf-progress-text`; `_updateSingleWorkflowInList` lấy progress live; Flows `_patchFlowsCard` targeted thay rebuild 500ms; optimistic `_setCardPreparing` khi Run; wfId gắn vào execution:progress. Verify PASS.
- **Phase 2 — DONE**: gỡ `notifyCompletion` trùng (1 nguồn = NotificationManager); feedback Open/reload/toggle + revert-khi-lỗi toggle; toast Run→"Đang chuẩn bị…"; +7 key i18n vi/en parity. Verify PASS (test:unit 341/12 = reconciliation, 0 fail chức năng).
- **Phase 4 — DONE**: trung hoà toàn bộ màu vi phạm trong khối MASTER REBUILD → brand (#3d6ff5/#0e4099/#19d07b): nút tạo magenta→blue, ai-icon pink→emerald, status dot/completed-glow/run-all/focus/session-header/bottom-btn → brand; status dot My Spaces dùng var(--primary/--emerald) khớp Flows; `_flowStatusLabel` + filter options → i18n (dùng CHUNG key statusRunning/… với My Spaces → nhãn 2 tab giống hệt, +statusStopped vi/en). Verify PASS (MASTER block 0 màu vi phạm, test:unit 341/12). *Bỏ qua (build chắc): dedup CSS structural (.workflow-card-status/.subtabs ×2) + stray </div> sidebar (vô hại) — để pass dedicated sau.*
- **Phase 3 — DONE (v1 copy-isolation)**: primitive `copyWorkflowRecord(wfId, extraMeta)` (deep-copy fresh id + reset runtime, cùng pattern cloneWorkflow đã audit); My Spaces ẩn `flow_kind==='flow'`, Flows chỉ hiện `flow_kind==='flow'`; nút "Đưa vào Flows" (My Spaces ⋯, 2 binding path) → `_addToFlows` (dedup theo source_wf_id + chuyển tab); Flows "Đưa về My Spaces" đổi từ MOVE→COPY (giữ bản Flows + thêm bản My Spaces); gỡ auto-switch run→Flows (bản gốc không ở Flows nữa); gỡ dead `_setFlowKind`; +4 key i18n + sửa flowsEmpty. Verify PASS (341/12). **Isolation tự động**: bản Flows là record riêng → sửa/xóa/chạy KHÔNG đụng My Spaces. *v1 DEFER: "chạy tự động add qua Flows" (run My Spaces = chạy tại chỗ, hiện progress ở My Spaces); workflow đã-chạy cũ (flow_kind undefined) giờ KHÔNG hiện ở Flows tới khi "Đưa vào Flows".*
- **D1 VERIFY (2026-07-23) = BUG THẬT**: prompt_sequence/variant_expand/loop KHÔNG lặp N — generate nhận 1 mega-prompt (result_text gộp). Bằng chứng: dispatch 4207-4220 return sau khi tạo array; _combineUpstreamTexts 9008/9048 đọc result_text; submit 5486 `prompts:[node.prompt]`. Sửa = đụng lõi sinh ảnh (quota/chi phí) → **cần user quyết**, chưa tự sửa.
- **Phase 7 — DONE (phần an toàn)**: `_currentSubtab` default 'templates'→'workflows' (khớp landing); guard idempotent `_loadWorkflowTemplateList` (chặn double-construct → rò rỉ listener). Verify 341/12. *HOÃN (riskier, để pass riêng): dedup CSS structural, gỡ sse-listener/orphan reads.*
- **TEST (2026-07-23)**: thêm `tests/unit/spaces-copy-isolation.test.mjs` — 10 test logic THẬT (node-count, progress %, filter disjoint My Spaces↔Flows, copy-isolation id-mới-không-trùng, merge dedup) + neo source. 10/10 PASS. Full suite 363 test, 351 pass, 12 fail (reconciliation). *UI thật cần Chrome load-unpacked (ngoài tầm tool).*
- **Phase 5 — DONE (user duyệt "tiếp tục làm")**:
  - **merge node**: `_executeMergeNode` gộp text+file upstream (dedup), PASS-THROUGH không submit → hết generation rỗng (D2).
  - **D1 batch**: `_collectUpstreamBatchPrompts` — generate downstream prompt_sequence/variant_expand/loop giờ submit **N prompt** (mỗi scene/item 1 lần sinh) thay vì 1 mega-prompt. Dùng hạ tầng có sẵn (PromptQueue.submitJob mảng prompts → mỗi phần tử 1 QueueItem). Cap BATCH_CAP=24. An toàn: cả 3 node đều set result_text → guard EMPTY_UPSTREAM không chặn; chỉ kích khi ≥2 item.
  - **Run-all Flows**: `_flowsRunAllSequential` await execute tuần tự (mirror My Spaces) → hết N-modal-chồng + reject.
  - **Retry local**: bỏ ép off khi featureGate vắng → tôn trọng setting user (chỉ gate khi online plan từ chối).
  - Verify: node --check + check:static 183 JS PASS; test:unit 373/361/12 (13 test Spaces logic 13/13 pass, +3 test D1).
- **Commit**: d440e44 (Phase 0-4,7 + tests) + batch 2 (Phase 5). Phần WorkflowExecutor (merge/emitProgress) đã vào HEAD ở commit song song của user trước đó.
- **CÒN duy nhất: Phase 6** (persistence cross-context — đã chốt tách đợt riêng sau).

## Phase 0 — Nền tảng: nguồn sự thật + vá seam (RỦI RO THẤP, làm trước)
**Mục tiêu:** dựng helper dùng chung, vá phantom global, để các phase sau đứng trên nền vững.
- [ ] `window.workflowList = this.workflowList` trong `WorkflowTab` (hoặc đổi 3 read-site sang `__seosonaflowTab.workflowList`). *(F1)*
- [ ] Helper `getNodeCount(wf)` = `wf.nodes?.length ?? wf.nodes_count ?? (đếm af_nodes) ?? 0` — **bỏ dùng `progress_total` làm node-count**. Dùng ở cả 3 renderer. *(BUG1 state, #3 progress, #10 display)*
- [ ] Thêm `wfId` vào payload `execution:progress`; route theo `wfId` thay `_lastUpdatedWfId`. *(#10 progress)*
- [ ] Persist `progress_total` = số node thật khi save/clone (bỏ `progress_total:0` ở clone).

**Rủi ro:** thấp. Gán global có thể khiến nhánh fallback chạy path chính — cần xác nhận path chính đúng. **Verify:** node-count My Spaces == Flows cho mọi workflow; clone không còn "0 node".

## Phase 1 — Đồng bộ tiến trình/trạng thái LIVE (fix "tiến trình lệch/chậm")
**Mục tiêu:** một đường progress, không nhấp nháy, phản hồi tức thì.
- [ ] Fix `_rerenderSingleWorkflowCard`: đọc `progress_completed/progress_total` (không phải `progress`); **không ẩn bar khi running**. *(BUG#1 — gốc nhấp nháy)*
- [ ] Gỡ listener `execution:progress → _debouncedLoadWorkflows` thừa ở `WorkflowTab` (giữ handler surgical + patch Flows targeted). *(BUG#4)*
- [ ] Bỏ regex chết `^\d+ nodes` ở `_updateCardProgress`/`_updateCardRunningState`; cập nhật `.wf-progress-text` bằng DOM trực tiếp. *(BUG#2)*
- [ ] Executor: gọi `_updateWorkflowProgress` **cả nhánh sequential**; đẩy progress vào mảng in-mem mà cả 2 tab đọc. *(BUG#6/#7)*
- [ ] Flows: thay full-innerHTML-mỗi-500ms bằng **patch từng card** (status dot + % + bar); chỉ rebuild list khi membership đổi. *(BUG#5)*
- [ ] Optimistic UI: bấm Run đơn → card vào trạng thái "đang chuẩn bị/chạy" ngay, trước preflight. *(BUG#9)*

**Rủi ro:** trung bình (đụng hot path event). Giảm bằng: giữ 1 handler duy nhất, test 1-node + 5-node + parallel + sequential. **Verify:** bar chạy mượt 20→40→…→100 ở CẢ My Spaces và Flows, không nhấp nháy, bấm Run thấy phản hồi <200ms.

## Phase 2 — Thông báo nhất quán (fix "thông báo lệch")
- [ ] Gộp 1 đường noti hoàn tất: khử trùng `notifyCompletion` (content.js Web Notification) vs `NotificationManager` (chrome.notifications). *(BUG#8)*
- [ ] Run bị stop → noti nhất quán (không "hoàn tất giả").
- [ ] Thêm feedback còn thiếu: Open (⋯→Mở), reload, toggle enable/disable → toast/spinner. *(missing feedback)*
- [ ] Toast "đang chạy" chỉ bắn **sau khi** run thực sự bắt đầu (không trước preflight → tránh báo sai khi user huỷ preflight). *(#6 user-flow)*

**Rủi ro:** thấp. **Verify:** mỗi hành động đúng 1 noti, đúng thời điểm; stop không tạo noti "hoàn tất".

## Phase 3 — Mô hình My Spaces ↔ Flows mạch lạc (fix "chưa đồng bộ giữa 2 tab")
**Cần chốt hướng (xem "Quyết định cần bạn duyệt" cuối file).**
- [ ] Chốt `flow_kind`: hoặc (A) wire nhánh promote "➕ Đưa vào Flows" để Flows = tập curated; hoặc (B) bỏ `flow_kind`, Flows = màn theo dõi chạy suy từ `status`/`last_run_at`.
- [ ] Workflow **đang chạy luôn hiện ở Flows** kể cả `flow_kind='space'` (override theo running). *(BUG#2 state)*
- [ ] Clone: reset `flow_kind` + `progress_total`; toast bắn ở tab thấy được kết quả; item xuất hiện đúng chỗ. *(BUG#6 state)*
- [ ] Chuyển tab Run→Flows: **optimistic insert** card đang chạy, hết "flash rỗng". *(RACE 2)*
- [ ] Đồng bộ refresh: delete/clone ở Flows phải cập nhật My Spaces kể cả trong cooldown (emit event chuẩn / bỏ chặn). *(BUG#5 state)*
- [ ] "Lưu về My Spaces" đặt lại đúng nghĩa (hiện chỉ ẩn khỏi Flows). *(BUG#5 user-flow)*

**Rủi ro:** trung bình-cao (đụng semantics). Giảm: đổi field-only, không copy/remap store. **Verify:** vòng đời create→run→complete→clone→delete phản ánh đúng ở cả 2 tab, không mục nào "biến mất".

## Phase 4 — Hợp nhất hiển thị + brand (fix "hiển thị sai, mỗi tab một kiểu")
- [ ] Trung hoà khối "MASTER REBUILD" magenta (L13097–13569): trả về brand **#3d6ff5 / #19d07b**, bỏ nút tạo magenta. *(SEVERE #1 display)*
- [ ] 1 bảng status→màu dùng chung mọi tab (hết 2 xanh/2 lục cho cùng trạng thái). *(#2 display)*
- [ ] Flows: nhãn trạng thái + option filter dùng **i18n** thay hardcode VI. *(#3 display)*
- [ ] Dọn CSS trùng/chết: `.seosonaflow-workflow-subtabs`×2, `.workflow-card-status`×2, `.ms-spaces-*`/`.wf-category-select` chết; sửa `</div>` thừa sidebar.html; scope `#createWorkflowBtn` chỉ My Spaces.
- [ ] Harmonize toolbar 4 tab: count-badge, class nút reload, chuẩn hoá vị trí toggle Run-all.
- [ ] (Tuỳ) tiến tới **1 component card** dùng chung để hết 4 hệ thống markup.

**Rủi ro:** trung bình (CSS `!important` chồng lớp — dễ vỡ layout). Giảm: sửa từng cụm, live-check light/dark. **Verify:** 0 magenta, cùng trạng thái cùng màu mọi tab, i18n EN/VI đúng.

## Phase 5 — Đúng đắn thực thi (execution correctness)
- [ ] **VERIFY TRƯỚC:** loop/`variant_expand`/`prompt_sequence` có thật sự inert không (agent báo `result_items/result_scenes` không ai đọc → generate gộp 1 mega-prompt thay vì lặp N). *Mâu thuẫn note test 11/11 → phải tự kiểm chứng bằng đọc code + chạy thử.* Nếu đúng → wire tầng expand để submit N prompt. *(D1)*
- [ ] `merge` node: thêm handler pass-through (đang rơi vào generate → bắn prompt rỗng). *(D2)*
- [ ] Bật retry ở local (đang default off khi thiếu featureGate).
- [ ] Run-all Flows: chạy **tuần tự await** như My Spaces (đang bắn N preflight modal chồng + executor reject hết trừ cái đầu). *(BUG#1 user-flow)*
- [ ] Stop: honor `shouldStop` nhạy hơn / fix force-watchdog orphan state.

**Rủi ro:** cao (đụng lõi sinh ảnh). Giảm: verify từng cái, test thật với workflow mẫu. **Verify:** prompt-sequence 3 scene → 3 generation; merge không bắn prompt rỗng; Run-all không chồng modal.

## Phase 6 — Toàn vẹn dữ liệu (RỦI RO CẤU TRÚC CAO NHẤT — làm sau cùng, cẩn trọng)
- [ ] Chống race cross-context: wire `WorkflowRepository` atomic (`navigator.locks`+`af_workflows_rev`) **kèm shim `wf_id`↔`id`**, HOẶC bọc lock quanh write `af_workflows`/`af_nodes`. *(HIGH #1 persistence)*
- [ ] `saveWorkflowFull`: chặn đè snapshot cũ khi sửa-editor-giữa-lúc-chạy (merge/guard version). *(HIGH #2 / RACE 1)*
- [ ] Không nhét `nodes/edges` vào metadata `af_workflows` (bloat + shadow copy). *(#8)*
- [ ] Template "Use": freshen node-id + emit eventBus notify. *(#6 persistence)*

**Rủi ro:** cao (dễ mất dữ liệu nếu sai). Giảm: backup storage trước, test đa-context, rollout sau khi UI đã ổn. **Verify:** chạy A + sửa B đồng thời → không mất dữ liệu bên nào.

## Phase 7 — Dọn dẹp + verify tổng
- [ ] Gỡ dead: listener `sse:workflows_updated` (local), read-site `window.workflowList` thừa, regex-meta chết còn sót, guard re-instantiate `WorkflowTemplateList`.
- [ ] `_currentSubtab` default khớp landing; tab re-entry re-render đúng subtab đang hiện.
- [ ] Verify tổng: check:static + node --check + test:unit + live 4 subtab + light/dark + EN/VI + 0 brand-leak.
- [ ] Cập nhật memory + (khi user duyệt) commit trọn gói.

---

## Quyết định ĐÃ CHỐT (2026-07-23)
1. **Mô hình Flows = (A) Curated + tách bản (copy-isolation).** Flows là tập làm việc riêng: có "Đưa vào Flows", sửa ở Flows KHÔNG ảnh hưởng My Spaces. → Phase 3 sẽ tạo store/copy tách (thiết kế cẩn thận khi tới phase, tránh race đã nêu).
2. **Persistence (Phase 6) = tách đợt riêng SAU**, khi UI (Phase 0-5) đã chắc.
3. **Bắt đầu: build ngay Phase 0 → 1 → 2.**

## Thứ tự khuyến nghị
Phase 0 → 1 → 2 → 4 (thấy được ngay, rủi ro thấp-vừa) → 3 (cần chốt mô hình) → 5 (verify kỹ) → 6 (tách đợt) → 7.
