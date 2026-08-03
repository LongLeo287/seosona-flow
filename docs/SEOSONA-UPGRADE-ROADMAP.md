# SEOSONA — Roadmap nâng cấp 6 TRỤC (từ 32 repo + blog)

> Nguồn: phân tích 27 repo (REPO-ANALYSIS-27.md) + 5 nguồn mới (MemMachine, build-your-own-x, Aliens_eye, audio.cpp, blog typography). License bỏ qua — học/adapt tự do. Nguyên tắc kiến trúc chủ đạo (hội tụ từ nhiều repo): **"AI quyết NỘI DUNG · code deterministic dựng PIXEL" + spec→gate→build→visual-diff**.

Ký hiệu: ✅ đã làm · 🔨 nên làm sớm (rủi ro thấp, in-app) · 🧩 vừa · 🏗️ lớn/sidecar.

---

## TRỤC 1 — PROMPTS (prompt pack, in-app, rẻ nhất)
- ✅ **Image Intelligence** (8 entry): phân tích ảnh (full/garment/token/QA) + ảnh→prompt (reverse/restyle/product-variants/char-block). [VideoGen-Eval, wardrobe, website-cloner, arcads]
- 🔨 **text-safe-image**: prompt render chữ đúng — Mode A reserve-space (chừa vùng trống cho overlay), Mode B bake-in (≤3 từ, ALL-CAPS, KHÔNG dấu tiếng Việt, quote literal). [typography blog]
- 🔨 **Vox collage 9×14**: 9 theme (retro/swiss/punk/soviet/wpa/70s/ink/atomic/newsprint) × 14 arc + scaffold 5-section style-block. [vox-director]
- 🔨 **Virality-scoring**: chấm khoảnh khắc viral (hook/emotion/conflict/quotable → 0-100). [AI-Youtube-Shorts]
- 🧩 **Schema prompt có cấu trúc** (nâng cả pack): mỗi entry kiểu arcads `template-format` — when-to-use / aspect+why / ref-image / variables{type} / template / example / model-notes. [arcads]

## TRỤC 2 — SKILLS (Claude-style skill packages)
- 🔨 **image-self-QA**: checklist tay/mặt/chữ-rác/watermark/style + **text-integrity** (OCR diff vs chuỗi đích, multi-scale). [vox-collage, typography]
- 🔨 **character-consistency**: sheet nhân vật 1 lần → reuse mọi scene + bộ góc chuẩn. [agnes, arcads]
- 🧩 **cost-preview gate**: xem trước provider/số lần/độ phân giải/chi phí TRƯỚC khi gọi gen trả phí. [super-video-maker]
- 🧩 **video-production**: VO-first master-clock + resumable per-beat state + style-anchor frame. [vox-explainer, huytranvan]
- 🧩 **spec→gate→build→visual-diff**: skill lõi (author spec JSON → quality-gate → build passes → visual/LLM-diff, token chỉ cho phán xét). [website-cloner, img2threejs, prompt-optimizer]
- 🧩 **skill-authoring từ build-your-own-x**: chưng cất CLI/interpreter/search/DB tutorial thành skill reference. [build-your-own-x]

## TRỤC 3 — AGENTS (WorkflowAgent + sub-agent)
- 🧩 **WorkflowAgent nâng system-prompt**: nhúng spec→gate→build + **Workforce decomposition** (planner phân rã → node chuyên trách) + awareness node-catalog đầy đủ. [camel, website-cloner]
- 🧩 **critic/refiner sub-agent**: loop optimize→evaluate→iterate (prompt-optimizer taxonomy) + role-pair inception (camel) → prompt/workflow tự tinh chỉnh.
- 🧩 **MLLM-as-judge quality-gate agent**: chấm ảnh/clip theo rubric (adherence/motion/temporal/aesthetic/artifact) qua MessageBridge + pre-filter JS (blur/black/dup). [VideoGen-Eval]
- 🔨 **persona schema chuẩn**: khung markdown identity/expertise/process/voice cho mọi skill/sub-agent. [agency-agents]

## TRỤC 4 — TOOLS (in-app + sidecar)
- 🔨 **watermark-REMOVE** (vanilla JS, drop-in): reverse-alpha-blend, khép vòng add/remove. [gemini-watermark-remover]
- 🔨 **text-overlay tool** (deterministic, canvas/SVG, font Be Vietnam Pro sẵn có): render chữ vector sắc nét lên ảnh AI → chính tả/dấu/kerning luôn đúng; auto-layout balance/pretty/nbsp/45-75char/no-justify. [typography]
- 🧩 **motion-recipe library**: import 403 recipe CSS/web + schema `recipe.motion.yaml` (intent_keywords/avoid_when/restraint). [motion-anything]
- 🏗️ **audio sidecar** (Video AI V2): 1 binary ggml offline = TTS+ASR+forced-align+mix+SFX+denoise, thay cloud edge-tts. Verify tiếng Việt, giữ whisperX fallback. [audio.cpp, whisperX]
- 🏗️ **reframe/clipper sidecar**: 9:16 TRACK/GENERAL + ASS-subtitle + scene-detect. [openshorts]

## TRỤC 5 — FUNCTIONS / FEATURES (node + luồng)
- ✅ **batch scene→N generation** (D1 đã wire: prompt_sequence/loop → N lần sinh).
- 🔨 **Reserve→Overlay text node**: image_gen (chừa vùng) → text_overlay (chữ thật) → text_qa (OCR). Chữ data-driven, đổi copy chỉ re-render overlay. [typography — đòn cao giá trị nhất]
- 🧩 **try-on / product-variant flow**: garment_extract → product_cutout → model_composite. [wardrobe]
- 🧩 **highlight/virality node** + **landing-page node** (recon→spec→build→visual-diff + text-wrap balance/pretty). [AI-Youtube-Shorts, website-cloner]
- 🏗️ **img→3D adjacent** (spec-JSON→gate→build Three.js). [img2threejs]

## TRỤC 6 — SYSTEM / KIẾN TRÚC
- 🧩 **Memory 3-tầng**: `profile.json` (fact bền: brand, provider prefs) + `memory/*.md` episodic + working ephemeral; **rank-then-load** (ranker keyword/recency JS) thay nạp cả index; expose `memory.search()` qua local-mcp-bridge cho WorkflowAgent. [MemMachine — KHÔNG lấy Neo4j/Postgres]
- 🧩 **Schema hợp đồng**: `script.json` (video output) + `recipe.motion.yaml` (node-catalog) làm contract chuẩn. [huytranvan, motion-anything]
- 🧩 **Sidecar mcp/CLI local**: mọi thứ nặng (audio/caption/reframe/3D) chạy ngoài extension qua bridge sẵn có.
- 🔧 **TileMonitor robustness**: multi-signal weighted → verdict 3-state (Found/Maybe/No) thay 1 selector giòn. [Aliens_eye — chỉ pattern]

---

## THỨ TỰ LÀM đề xuất (quick-win → chiến lược)
1. 🔨 **Prompts đợt 2**: text-safe-image + Vox 9×14 + virality + persona schema (in-app, rủi ro ~0).
2. 🔨 **watermark-REMOVE tool** (drop-in vanilla JS).
3. 🔨 **Text-overlay tool + Reserve→Overlay node + text-integrity QA** — *giải quyết triệt để chữ-rác, giá trị người dùng cao nhất*.
4. 🧩 **WorkflowAgent upgrade** (spec→gate→build + node-catalog + critic loop).
5. 🧩 **Memory 3-tầng** (profile.json + rank-then-load + expose mcp).
6. 🧩 **Motion-recipe library** import.
7. 🏗️ **Video AI V2 sidecar** (audio.cpp pilot + whisperX + reframe).
8. 🧩 **Skills library** mở rộng (self-QA, character, cost-gate, video-production) — song song.

---

## ✅ TIẾN ĐỘ BUILD (2026-07-23)
- **D1 batch** — committed 8956a44.
- **② watermark-REMOVE** — ✅ ĐÃ CÓ SẴN (`WatermarkRemover.js` committed a92c127, adopt gemini-watermark-remover). Không rebuild.
- **PROMPTS đợt 1-3** — ✅ **+19 entry** (342 tổng): image-intelligence (8) + text-safe/Vox/virality (5) + skills/agents pattern (6). Uncommitted.
- **③ TextOverlay CORE** — ✅ `src/core/TextOverlay.js` (canvas deterministic + layout engine wrap/balance/pretty/nbsp) + **7 test**. Còn: wire node `text_overlay` + editor UI (đợi file nóng ổn định).
- **⑥ Memory 3-tầng** — ✅ `src/core/MemoryStore.js` (profile/episodic/working + rank-then-load ranker) + **6 test**. Còn: wire vào WorkflowAgent + expose MCP.
- **④ Motion-recipe lib** — ✅ `src/core/MotionRecipes.js` (12 recipe CSS + schema intent_keywords/avoid_when/restraint + matcher) + **6 test**. Còn: import 403 recipe gốc + wire vào UI.
- **③ TextIntegrity** — ✅ `src/core/TextIntegrity.js` (OCR-diff QA: levenshtein/normalize/verdict + phát hiện dropped/extra/garbled/unwanted-diacritics/wrong-case) + **8 test**. Bộ ba diệt chữ-rác (render+QA+prompt) đủ.
- **PROMPTS đợt 4** — ✅ +6 (348 tổng): ad-gen UGC/Meta + claymation + hook-matrix + before/after + carousel (đều theo reserve-text discipline).
- **Tổng test module mới: 27/27 pass (TextOverlay 7 + TextIntegrity 8 + MemoryStore 6 + MotionRecipes 6). +25 prompt. Tất cả file mới, 0 conflict, uncommitted.**

**Còn (đợi song song ổn định vì đụng file nóng):** wire các node/UI (text_overlay node, memory→WorkflowAgent, motion→editor), sidecar Video-AI-V2 (audio.cpp/whisperX/reframe), WorkflowAgent system-prompt upgrade.
