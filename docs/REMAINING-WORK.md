# SEOSONA Flow — TOÀN BỘ việc CÒN LẠI (review 2026-07-24)

> Đối chiếu roadmap 6 trục (SEOSONA-UPGRADE-ROADMAP.md) + WIRING-SPEC + những gì đã build.
> Ký hiệu: ✅ xong · ◐ một phần · ✗ chưa · 🚫 ngoài-scope-Flow (là Video AI V2).
> Ước lượng: 🟢 nhanh (framework/additive) · 🟡 vừa (map hệ editor/agent) · 🔴 nặng/rủi ro (đợt riêng).

---

## A. TRÙNG với 7 item bạn hỏi
| # | Item | Trạng thái | Ghi chú |
|---|---|---|---|
| 1 | text_overlay **config-UI** | ✗ 🟡 | Node chạy = default + text upstream. Chưa map hệ node-settings editor để user chỉnh overlay_text/pos/color/size trong panel. |
| 2 | **text_qa node** | ✗ 🟡 | OCR ảnh qua pa:generate (vision) → TextIntegrity.compare → verdict → loop regen. Cần provider-call + parse. |
| 3 | **StyleAnchor UI** | ◐ 🟡 | Module + helper (inject/strip/applyToMany) xong. Thiếu: UI lưu/áp anchor + wire vào gen flow/PromptAssistant. |
| 4 | **Motion→editor** | ◐ 🟡 | Module (32 recipe + find/css/cssBundle/byTrigger) xong. Thiếu: nút/panel chèn motion trong editor/landing node. |
| 5 | **Feature workflow try-on/landing/img3D/virality** | ✗ (try-on/landing/virality 🟢, img3D 🔴) | Mới thêm 3 workflow KHÁC (Reserve→Overlay/batch/variant). 4 cái này chưa. img3D=Three.js ngoài luồng gen. |
| 6 | **Persistence Phase 6** | ✗ 🔴 | Race cross-context (editor popup ↔ sidebar ghi chung af_workflows/af_nodes) → mất dữ liệu. Có WorkflowRepository sẵn nhưng chưa wire + shim wf_id↔id. RỦI RO CAO. |
| 7 | **TileMonitor multi-signal** | ✗ 🟡 | Detect "gen xong/tile sẵn sàng" bằng multi-signal weighted → 3-state (Found/Maybe/No) thay 1 selector giòn. Cần browser-test tile thật. |

## B. CÒN THÊM (ngoài 7 cái) — bạn chưa liệt kê

### Trục PROMPTS
- ✗ 🟡 **Schema arcads template-format cho CẢ pack**: restructure mỗi entry → when-to-use/aspect+why/ref-image/variables{type}/model-notes (giờ mới vài entry theo kiểu này).

### Trục SKILLS (`.claude/skills/*` thật)
- ✅ **5 skill invocable ĐÃ TẠO** (2026-07-24): `image-qa` · `character-consistency` · `prompt-optimize` · `spec-gate-build` · `text-in-image`.
- ✗ 🟢 video-production (VO-first) skill — borderline Video-AI-V2; skill-authoring từ build-your-own-x.

### ✅ FEATURE WORKFLOWS ĐÃ THÊM (framework-validated, id 37-45) — 2026-07-24
Reserve→Overlay · batch(storyboard) · variant · try-on · character-sheet · before/after · thumbnail-CTR · comic · logo-variants. (**36 template.**)

### Trục AGENTS
- ◐ 🟡 **WorkflowAgent nâng SÂU**: mới thêm rule text-safe/nhất-quán/chi-phí + memory wiring. CHƯA: spec→gate→build đầy đủ + **Workforce decomposition** (planner phân rã → node chuyên trách).
- ✗ 🔴 **critic/refiner sub-agent**: loop optimize→evaluate→iterate (prompt-optimizer) tự tinh chỉnh prompt/workflow.
- ✗ 🔴 **MLLM-as-judge quality-gate agent**: chấm ảnh/clip theo rubric qua MessageBridge + pre-filter JS.

### Trục TOOLS
- ◐ 🟡 **Motion library đầy đủ**: mới 32 recipe (bộ khởi đầu). Import 403 recipe gốc motion-anything nếu muốn.
- 🚫 **audio sidecar** (audio.cpp/whisperX/TTS/ASR) — **Video AI V2, ngoài scope Flow**.
- 🚫 **reframe/clipper sidecar** (openshorts 9:16/ASS-sub) — **Video AI V2**.

### Trục FUNCTIONS
- ✗ 🟡 **Feature node thật** (khác workflow-template): highlight/virality node · landing-page node (recon→spec→build→visual-diff + text-wrap).
- ✗ 🟢 **Thêm workflow validated**: ad-archetype variants, before/after+label, e-com PDP nâng cấp (đường framework như 37-39).

### Trục SYSTEM
- ◐ 🟡 **Memory expose qua MCP**: MemoryStore + seedDefaults + WorkflowAgent wiring xong. CHƯA: expose `memory_search/memory_add` qua local-mcp-bridge cho agent runtime.
- ✗ 🟡 **Schema hợp đồng**: `script.json` (video) + `recipe.motion.yaml` (node-catalog) làm contract chuẩn.
- 🚫 **Sidecar mcp/CLI local** (heavy stuff) — Video AI V2.

## C. HOUSEKEEPING / KỸ THUẬT (dễ quên nhưng quan trọng)
- ✗ **COMMIT + PUSH đống uncommitted** (viên 8-14 helper · 9 prompt edit · 3 workflow 37-39 · framework catalog text_overlay) — đang chờ session chung ngưng.
- ✗ **Regenerate baseline artifacts** để test:unit hết 14 fail reconciliation (inventory/budgets/CHANGELOG/config-covers-pages — page tool mới chưa vào build inventory).
- ✗ **Đăng ký page text-overlay-tool.html vào build inventory** (render-page-scripts list cố định 8 page — page mới chưa vào → 2 test config fail).
- ✗ **i18n cho node/tool mới** (hiện dùng fallback — nhất quán convention nhưng chưa có key vi/en).
- ✗ **LIVE test** trong Chrome: nút "Overlay chữ" header · node text_overlay editor · 3 template mới · Spaces (browser tools vừa kết nối lại).

## D. TỒN ĐỌNG CŨ (từ memory, ngoài roadmap này)
- ✗ **Spaces**: M5 My-Spaces Run-All toggle · dead-code A3/D2 · (nhỏ).
- ✗ **TobyFlow 1.1.58 sync** — BLOCKED (no pristine base, ~4.4k dòng tangled) — đợt riêng.
- ✗ **2 agent audit cũ** (lifecycle/wiring · editor/persistence) chưa báo findings — có thể đọc transcript nếu cần.

---

## TÓM TẮT ƯU TIÊN
- **🟢 Làm nhanh (framework/additive, in-app, ~0 rủi ro):** feature workflow try-on/landing/virality/ad · thêm prompt · build-your-own-x skill-ref · thêm motion recipe.
- **🟡 Vừa (map hệ editor/agent/MCP):** text_overlay config-UI · text_qa node · StyleAnchor UI · Motion→editor · memory→MCP · WorkflowAgent spec-gate-build · TileMonitor · skill packages · schema contracts · virality/landing node.
- **🔴 Nặng/rủi ro (đợt riêng, cẩn thận + test):** Persistence Phase 6 · critic/refiner agent · MLLM-judge agent · img→3D.
- **🚫 Ngoài scope Flow (Video AI V2, sản phẩm khác):** audio sidecar · reframe/clipper · mcp/CLI heavy sidecar.
- **⚙️ Housekeeping (khi git rảnh):** commit+push · regenerate artifacts · đăng ký page · i18n · live-test.
