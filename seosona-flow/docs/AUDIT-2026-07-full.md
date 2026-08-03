# SEOSONA Flow — Báo cáo Audit toàn diện (4 phase)

_Ngày: 2026-07-22 · Bản: 1.1.37 (code ~1.1.59 sau các port upstream) · Chế độ: 100% offline (local-first)_

Rà soát **từng tab, từng chức năng, từng module, từng luồng** của extension qua 6 lăng kính:
hoạt động · offline-safe · wiring · error/edge · liên kết · debrand.
16 agent song song (5+4+3+2) đọc code thật + verify tĩnh + harness Node.

**Kết quả:** 209 file `node --check` **0 lỗi** sau mọi fix · 20/20 fix then chốt verify còn nguyên · 14/14 bundled template validate · 0 debrand residue · 0 external dep chết trong data shipped.

---

## Phạm vi (26 khu vực)

| Phase | Khu vực |
|---|---|
| **1 — 8 tab** | gen · workflow · templates · tasks · photos · tools · history · logs |
| **2 — 7 cửa sổ** | angles-editor · effects-editor · settings · workflow-editor · workflow-template-editor · watermark-tool · template-preview |
| **3 — engine (99 file)** | providers/sessions · executors · storage · MessageBridge+contracts · selector bundle · gates |
| **4 — 5 luồng** | flow-gen · workflow-run · PA/i2p · watermark · WorkflowAgent |

---

## Đã fix — 1 CRITICAL

- **Template-editor window 404** — `background.js openTemplateEditorWindow` mở `getURL('workflow-template-editor.html')` thiếu prefix `pages/` → editor không load. → `pages/workflow-template-editor.html`.

## Đã fix — 7 HIGH

1. **Prompt gallery sửa/xóa im lặng thất bại** — `UserPromptsManager.update/deletePrompt` gate chết `startsWith('local_')||!true` loại prompt `tpl_` → gọi ApiClient throw LOCAL_MODE, UI vẫn báo "thành công". → gate `SEOSONA_LOCAL_MODE!==false||local_`.
2. **Photos scan domain chết** — `PhotosTab._activateFlowTab` query `aistudio.google.com` (fork dùng `labs.google/fx`) → tab không activate → throttle → scan 0 ảnh. → `labs.google` + activate trước scan + 600ms wait + fix Refresh.
3. **WorkflowAgentModal lưu nested-shape** (code phiên này) → run-from-list `_buildLocalPlan` đọc `node_id` undefined → CYCLE giả. → flatten trước `saveWorkflowFull` (mirror WorkflowTemplateList).
4. **WorkflowAgentModal `root.workflowList` undefined** → list không refresh. → resolve qua `document.getElementById('tab-workflow').__seosonaflowTab.workflowList`.
5. **Settings `defaultVideoModel` blank fresh-install** — `'Veo 3.1 - Fast'` (có dash) ≠ bundled → dropdown blank + phantom value. → `'Omni Flash'` (is_default); image → `'Nano Banana Pro'`.
6. **Editor Share + Lưu-Template lộ offline** → fail generic. → gate tại `ShareWorkflowModal.show()` + `SaveTemplateModal.show()` (1 điểm chặn mọi lối vào).
7. **Flow character bị bỏ âm thầm ở gen path mặc định** — `content.js runAutoPrompt` áp `payload.voice` nhưng KHÔNG `payload.character` (chỉ pipeline/workflow gọi selectFlowCharacter); queue mặc định OFF → legacy path mặc định. → thêm block `selectFlowCharacter(payload.character)` (mirror voice).

## Đã fix — ~27 MEDIUM (chọn lọc)

- **Debrand màu** lime/gold `#b6f200`/`#c2f542`/`#d3b525`/`rgba(182,242,0)` ×6 file → SEOSONA blue `#3d6ff5`/emerald `#19d07b`.
- **History id trùng** `local_${Date.now()}` (xóa 1 xóa nhầm cụm cùng ms) → thêm suffix random.
- **VoiceRegistry `_LOCAL_BASE_CATALOG` sai shape** (thiếu provider/slug/display_name) → dropdown voice rỗng offline → reshape 8 voice.
- **background `_fetchProviderConfigs`/`_fetchApiConfigs` thiếu LOCAL gate** → cold-start request tới API chết → gate sau cache-check.
- **media_type casing** producer 'Video' vs HistoryTab `==='video'` → video hiện icon ảnh → lowercase 1 lần.
- **PA nói "dùng ảnh tham chiếu" cho Claude/Grok** (text-only, bỏ ảnh âm thầm) → model output sai → gate meta-prompt theo provider.
- style/template **thumbnails host chết** → null (placeholder); login button ẩn offline; share gate; EffectsEditor pre-gate…

## Engine (Phase 3) — SẠCH, 0 CRITICAL/HIGH

Gen thuần DOM automation (0 backend call ở mọi adapter/session) · `_buildLocalPlan` Kahn topo-sort + `_userSkipped` cascade order đúng + node routing 16 type · storage 100% local · registries prime bundled defaults · gates allow-all · SSE/poll/sync 0-timer inert · 190 message action đều có handler · manifest đủ file · selector khớp request (flow 53/chatgpt 33/gemini 20/grok 36).

## 3 mục defer — đã tự xử

1. **Telegram sub-tab dead offline** → ẩn qua hide-list `settings.css` (`[data-subtab="telegram"]`).
2. **Theme không re-theme cửa sổ settings** → chấp nhận dark-only (sidebar theme đúng; light-theme cho settings.css 2000-dòng rủi ro cao/giá trị thấp).
3. **Bundled template 99 external dep chết `labs.seosona.vn`** → dọn: `diagram_url`×14 null · `ref_img_urls`×36 (trên node `image`=input, user tự thả ảnh) → `[]` · `result_img_url`×49 (display-only) → null · `thumbnail_url` GIỮ (đều `../../assets/` local). Còn 0 external dep, 14/14 validate PASS.

## LOW để lại (harmless / by-design)

Dead stub `if(false?._apiCall)` unreachable · ModelRegistry dup id (lookup theo value) · chat-provider-tab không inject RuntimeMode (first-run gap lý thuyết) · keyboard 'command' chỉ Flow tab · cross-window node:status chỉ phase · second-captcha one-shot · PA status-dot claude/grok không sáng · WM button vắng chatgpt/grok · WorkflowAgent model-lạ = warning (soft).

## Chưa làm

**Runtime-verify LIVE** trên tab Flow thật (cần load extension + đăng nhập provider). Mọi kiểm chứng là static (`node --check`, đọc code, trace seam) + harness Node (`_buildLocalPlan`, WorkflowAgent flatten, framework validator).
