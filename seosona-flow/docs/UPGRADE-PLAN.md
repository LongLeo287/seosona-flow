# SEOSONA Flow — Kế hoạch nâng cấp 10 Phase (Data First)

> ⚠️ **SCOPE (đọc trước tiên — tránh nhầm sang SEOSONA Video AI):**
> **SEOSONA Flow** = Chrome MV3 extension tự-động-hoá **SINH ảnh/video trên web tool** (Google Flow,
> ChatGPT, Grok) qua workflow n8n. Job = **prompt → generate → capture → download**. **KẾT THÚC ở
> clip/ảnh RỜI đã tải về.** Nó KHÔNG dựng/edit video.
> **SEOSONA Video AI (dự án KHÁC)** = pipeline DỰNG video: TTS, timeline, caption burn, ghép, export
> CapCut, render MP4. → Mọi năng lực "edit/assemble video" trong SKILL TEMPLATE thuộc về **Video AI**,
> KHÔNG đưa vào Flow.
>
> Ràng buộc: Chrome MV3, JS thuần, 100% local, KHÔNG backend/Python, debrand. **Data First.**

---

## 0. RANH GIỚI — cái gì THUỘC Flow, cái gì KHÔNG (tránh nhầm)

**✅ THUỘC SEOSONA Flow** (mọi thứ output là PROMPT hoặc điều-phối GEN trên web tool):
- Prompt pack (skill sinh prompt), form biến, @tag reference, Style Prefix.
- Node biến ý-tưởng/SRT → **CHUỖI PROMPT** để batch-generate (srt→scene-prompt, shotlist, storyboard).
- Node điều-phối: loop/batch, condition, random_pick, merge kết quả gen.
- Continuity/character-consistency **ở tầng PROMPT** (visualBible → gen ảnh nhất quán).
- Canvas/workflow UX (minimap, palette, node graph).
- Download/quản lý media đã gen (đã có).

**❌ KHÔNG thuộc Flow → của SEOSONA Video AI** (đừng đưa vào, dù SKILL TEMPLATE có):
- Export CapCut/JianYing draft, ghép timeline, EDL/assemble.
- TTS voiceover / ASR auto-caption (VieNeu, sherpa).
- Caption karaoke burn, overlay/card render, collage compose, watermark AUTHORING.
- Render MP4 (Remotion/hyperframes/html-video), MuseTalk/LiveTalking lip-sync.
- IR "video plan.json" để re-render segment (đó là mô hình EDIT video).

**Điểm bàn giao (handoff):** Flow gen xong → xuất **clip rời + manifest (beats/prompt/order dạng JSON)** → **Video AI** nhận để dựng. Flow CHỈ tạo manifest handoff (nhẹ), KHÔNG tự dựng.

---

## 1. BASELINE THỰC TẾ (chốt trước khi lập kế hoạch)
**Tabs (8):** Gen · Workflow · Templates · Tasks · Photos · History · Tools · Logs.
**Node types (17):** `generate, image, text, text_template, text_extract, random_pick, condition` (mới build)`, prompt, chatgpt, grok, telegram, download, delay, note` + 3 stub `transform, merge, output`.
**Bundled:** **56 workflow template** (14 gốc + **42 SEOSONA mới**, gồm 8 concept video-gen + 5 ref-based product/model) · prompt pack **304 entry** (44 + v3-v8; v8=**14 Master Technique Reference**). Node picker n8n-style (5 nhóm).
**Core:** WorkflowExecutor (DAG topo), DiagramCanvas (drawflow+minimap+pan), PromptQueue/EditorExecutor/TileMonitor (submit→capture→download), slate-bridge (gõ prompt Flow), MultiTask/Queue.
**Vừa fix/build:** bug gen nonce · host_permissions media · minimap · condition/random_pick · SEOSONA reliability fixes.
**TIÊN QUYẾT:** gen phải chạy-ra-kết-quả (fix nonce) — node executor mới chỉ verify khi gen chạy thật.

**VISION đúng của Flow:** biến workflow từ "1 prompt/lần" thành **"1 ý tưởng → tự sinh CHUỖI prompt → batch-generate cả loạt clip/ảnh nhất quán trên Flow → tải về"**. Việc DỰNG các clip đó thành video là của Video AI.

---

## PHASE 1 — Nền tảng & Data model workflow
- [ ] **Xác nhận gen end-to-end** (reload + gen thử) — chốt bug nonce đã sửa.
- [ ] **Dọn 3 stub:** `merge` redundant (Download đã gom multi-upstream) → xoá; `transform`/`output` → xoá hoặc định nghĩa lại rõ.
- [ ] **Node I/O typing** (học execution-model ComfyUI, CHỈ pattern): port type rõ (`text/image/video/prompt_list/any`) + validate connect.
- [ ] Verify: 2 subagent review bám baseline.

## PHASE 2 — Prompt Pack v3 (tab Gen) — ROI cao nhất, rủi ro thấp, ĐÚNG scope Flow
- [x] **Bundle prompt entries** (`BundledPrompts.js`, SEED_FLAG v2→**v3**): ✅ **+58 prompt GEN ảnh/video** (nhiếp ảnh, đồ hoạ, cảnh, nhân vật nhất quán, video Veo/Flow, prompt-eng helper, chuỗi scene-prompt). Tổng **101 entry**.
- [ ] **Form biến `{VARIABLE}`** ở tab Gen: parse `{brand}/{title}` → input điền → substitute trước submit.
- [ ] **UI `@tag` reference:** gắn ảnh ref vào prompt → ref_file_ids.
- [ ] **Style Prefix preset:** chuỗi style prepend mọi prompt.
- [ ] Verify subagent.

## PHASE 3 — Node sinh CHUỖI PROMPT (lõi biến Flow thành pipeline) ⭐
> Output các node này là PROMPT → feed thẳng vào node `generate`/`image` hiện có. KHÔNG dựng video.
- [x] **Node `prompt_sequence`** ✅ (Scene Splitter, pure-data): tách 1 blob nhiều scene (từ AI Agent/paste) → danh sách scene-prompt đánh số; tự phát hiện visual-bible preamble → prepend mọi scene (nhất quán). Split modes auto/numbered/separator/lines. Lưu `result_scenes[]` (cho loop) + `result_text` (feed downstream ngay). NodeTemplates + form + executor + whitelist + card. **Harness 16/16 pass.** Template demo 1016.
- [ ] (tuỳ chọn thêm sau) Node `shotlist`/`storyboard` — hiện `prompt_sequence` + prompt-pack đã phủ; cân nhắc nếu cần form chuyên biệt.
- [ ] Port `prompt_list` type riêng — hiện dùng text (numbered join) + `result_scenes[]`; nâng khi build node loop (Phase 4).

## PHASE 4 — Node `loop` + batch generate (điều-phối GEN) ⭐
> Node n8n cuối. Nối chuỗi-prompt vào việc GEN THẬT trên Flow. Cần gen chạy để test.
- [ ] **Node `loop`**: lặp downstream theo `prompt_list`/`shots[]` → mỗi phần tử 1 lần generate trên Flow. Đụng DAG executor (gated như note-group-run).
- [ ] Tận dụng **PromptQueue/MultiTask/queue** sẵn có để batch không block.
- [ ] Harness test loop-expansion; runtime sau khi gen OK.
- [ ] Verify subagent (kỹ — đụng execution path core).

## PHASE 5 — Character/Continuity consistency (ở tầng PROMPT)
> Giải bài toán "nhân vật nhất quán qua nhiều lần gen" — điểm đau lớn nhất của AI image. Vẫn là PROMPT.
- [ ] **Node/tính năng `character_board`** (← Character Design Board KOC #7): ref → JSON prompt giữ identity (turnaround/expression/negative_prompt) → tái dùng cho mọi scene.
- [ ] **`visualBible` xuyên loop** (← promt_anhvideo): 1 bản mô tả nhân vật/bối cảnh nhất quán, chèn vào mọi scene prompt trong loop.
- [ ] Verify subagent.

## PHASE 6 — Canvas/Workflow UX trưởng thành
> Đã có minimap/pan/condition/palette-search. Hoàn thiện node graph.
- [ ] **Hoàn thiện dàn node hiện có:** finish condition badge, loop UI, prompt_list preview trên node.
- [ ] **Node-graph robustness** (học ComfyUI pattern): topological execution rõ, port typing validate, error surfacing trên node.
- [ ] **Group/frame + note-group-run** (đã có) → mở rộng: chạy subset, comment.
- [ ] Verify subagent.

## PHASE 7 — Multi-provider gen nâng cao
> Đúng job Flow: mở rộng khả năng GEN trên các web tool.
- [ ] **Node so-sánh model song song** (multi-model compare): 1 prompt → gen trên Flow + ChatGPT + Grok cùng lúc → gom kết quả cạnh nhau (dùng Download-merge sẵn có).
- [ ] **Ratio/quantity/model matrix**: 1 prompt → gen nhiều biến thể (ratio × model) tự động.
- [ ] Tận dụng provider adapter + condition/random_pick để đa dạng hoá.
- [ ] Verify subagent.

## PHASE 8 — Handoff sang SEOSONA Video AI (ranh giới sạch)
> Flow gen xong → xuất MANIFEST cho Video AI dựng. Flow KHÔNG tự dựng.
- [ ] **Export manifest JSON** (nhẹ): danh sách clip/ảnh đã gen (file path + order + beats/prompt + scene metadata) → 1 file `.seosona-handoff.json` để Video AI đọc.
- [ ] **KHÔNG** làm CapCut export/TTS/caption/timeline ở đây — chỉ đóng gói manifest + media.
- [ ] Verify subagent.

## PHASE 9 — Prompt-sequence từ SRT (input phổ biến) + marketing content
> Vẫn output PROMPT, không edit video.
- [ ] **Node `srt_to_prompts`** (← SRT Master #6, promtflow beat): SRT có sẵn → chuỗi scene prompt để re-generate hình minh hoạ. (Output prompt, KHÔNG cắt-ghép video.)
- [ ] **Prompt pack marketing** (← Content #13): repurpose 1 ý tưởng → 30 góc → hook → prompt ảnh.
- [ ] Verify subagent.

## PHASE 10 — Bundled workflow templates + verify
- [x] **Bundled workflows** (`BundledWorkflowsExtra.js` → append `BUNDLED_TEMPLATES`, tự-chứa 0 URL ngoài): ✅ **8 template mới**
  - [x] ⭐ **"Ý tưởng → chuỗi scene → batch generate"** (text→AI Agent→generate→download).
  - [x] "Storyboard 8-panel → batch generate" · "Character board KOC → 6 pose" · "Sản phẩm → 4 góc".
  - [x] "1 prompt → so sánh 3 model (Flow/ChatGPT/Grok)".
  - [x] "Random style" (random_pick+text_template) · "Text Template brand+sp" · "Condition rẽ nhánh".
  - [ ] (còn có thể thêm: "Repurpose 1 ý tưởng → 30 góc → prompt ảnh", template dùng loop khi có node loop.)
- [ ] i18n vi/en. Tài liệu Templates tab.
- [ ] **Verify cuối:** 2 subagent fresh-context review 10 phase đúng plan + không regression (đúng `plan skill.txt`).

---

## BẢNG ƯU TIÊN (giá trị × khả thi × ĐÚNG scope Flow)
| Hạng | Hạng mục | Phase | Rủi ro |
|---|---|---|---|
| 1 | Prompt Pack v3 + form biến + @tag | 2 | Rất thấp |
| 2 | Node prompt_sequence + shotlist + storyboard | 3 | Thấp (pure data) |
| 3 | Node loop + batch generate | 4 | Cao (cần gen chạy) |
| 4 | Template "Ý tưởng→chuỗi prompt→batch gen nhất quán" | 10 | Thấp |
| 5 | Character/visualBible continuity | 5 | Thấp |
| 6 | Multi-model compare + ratio/model matrix | 7 | Trung |
| 7 | Node-graph UX robustness | 6 | Thấp |
| 8 | srt_to_prompts + marketing pack | 9 | Thấp |
| 9 | Handoff manifest cho Video AI | 8 | Thấp |

## ❌ CHUYỂN SANG SEOSONA VIDEO AI (KHÔNG làm trong Flow)
Export CapCut/JianYing · TTS/ASR tiếng Việt · caption karaoke/overlay/collage burn · render MP4 (Remotion/hyperframes) · timeline edit · MuseTalk/LiveTalking lip-sync · IR video-plan re-render. → Các skill/repo này (capcut-cli, VieNeu, sherpa, MuseTalk, OpenCut, any2video caption...) dành cho **SEOSONA Video AI**, không phải Flow.

---
*Data-First: re-verify baseline trước mỗi Phase. Flow chỉ SINH+TẢI media; DỰNG video là Video AI.*
