# Phân tích 27 repo — mức bổ trợ cho SEOSONA (Flow + Video AI V2)

> Nguồn: 5 agent research song song (2026-07-23). Tiêu chí: bổ trợ SEOSONA (Flow = extension MV3 vanilla-JS local-first gen ảnh/video; Video AI V2 = pipeline video local + mcp/CLI sidecar) mà KHÔNG trùng, ưu tiên chạy-local + license dễ dùng. **AGPL = chỉ học pattern, KHÔNG copy code vào extension.**

## Tổng quan: 5 ADOPT · ~16 ADAPT · 3 SKIP

## ⭐ TOP ADOPT (tái dùng code trực tiếp — license thoáng, đúng stack)
| Repo | License | Vì sao | Lấy gì cụ thể |
|---|---|---|---|
| **GargantuaX/gemini-watermark-remover** | MIT, vanilla JS | Cùng stack (Canvas/TypedArray), MV3/userscript, offline, GPU-free. Khép vòng **add/remove** watermark (SEOSONA đang chỉ add). | Công thức reverse-alpha-blend `original=(wm−α·logo)/(1−α)` + size-catalog detect → nhét thẳng `watermark-worker.js`. |
| **nexu-io/motion-anything** | Apache-2.0, vanilla JS **zero-dep** | Stack trùng khít SEOSONA, license patent-friendly, most-maintained. | **403 motion recipe CSS/web** (dùng ngay) + schema `recipe.motion.yaml` (`intent_keywords`/`avoid_when`/`restraint`) → template cho node-catalog + fill gap "over-animation". CLI `motion.js` single-file → mẫu sidecar. |
| **m-bain/whisperX** | BSD-2, chạy CPU | Word-level timestamp = đúng thứ caption/karaoke cần; local, permissive. Vượt sherpa-ASR cho caption. | Whisper + wav2vec2 forced-align → SRT/VTT `--highlight_words`. Diarization off = offline hẳn. Bọc CLI/HTTP sidecar. |
| **huytranvan2010/AI-auto-generate-video** | MIT, Node/TS ESM | **Khớp kiến trúc V2 nhất**: local-first, Claude-skill, tách "AI=nội dung / code=pixel". | Schema `script.json` (dùng gần nguyên) + SFX chọn theo hash (reproducible) + render idempotent (regen 1 scene). |
| **krusemediallc/arcads-claude-code** | MIT | Khớp nhất mảng prompt-pack + skill + ad-gen (AI-actor). | Schema `template-format.md` (tag/when-to-use/aspect/ref-image/variables/template/model-notes) → nâng cấp BUNDLED_TEMPLATES; convention **ref-image đa-góc mỗi actor** (giữ nhất quán); `safety-suffixes.md`. |

## ADAPT (mượn pattern/prompt/thuật toán — KHÔNG copy code)
| Repo | License | Lấy gì |
|---|---|---|
| **Alisa0808/vox-director** | MIT | **Nguồn prompt Vox CHÍNH** (bỏ trùng #vox-motion/#vox-explainer/#collage-broll về mảng thẩm mỹ): 9 theme × 14 arc + scaffold prompt 5-section (style-block cố định → nhất quán khung). |
| **CK42BB/vox-explainer-skill** | MIT | Kỷ luật executor: **VO-first master-clock** (đo giọng trước → làm nhịp), **resumable per-beat state**, **style-anchor frame**. |
| **tandpfun/wardrobe** | MIT, vanilla JS | Try-on/product: chuỗi `garment_extract → product_cutout → model_composite` + trick ref-model-PNG. Swap OpenAI→transport web-UI của SEOSONA. |
| **linshenkx/prompt-optimizer** | AGPL (pattern-only) | Taxonomy template `optimize/user-optimize/iterate/evaluation/structured-compare` + `variable-extraction/value-generation` → biến prompt-pack thành **self-improving** (reimplement trên `pa:generate`). |
| **SamurAIGPT/AI-Youtube-Shorts-Generator** | MIT | Prompt **virality-scoring** (hook/emotion/conflict/quotable → 0-100) + chunk 20min/overlap 60s + dedup >50% → node "tìm khoảnh khắc viral". |
| **mutonby/openshorts** | MIT core | Reframe 9:16 **TRACK (MediaPipe+YOLOv8) vs GENERAL (blur bg)** + composite ASS-subtitle/Ken-Burns + PySceneDetect → tham chiếu clipper sidecar. |
| **AILab-CVC/VideoGen-Eval** | MIT | **MLLM-as-judge rubric** (prompt-adherence/motion/temporal/aesthetic/physics) → quality-gate ảnh/clip qua MessageBridge (+pre-filter blur/black-frame bằng JS). |
| **JCodesMore/ai-website-cloner-template** | MIT | Pattern **recon→spec-file→parallel-builder→visual-diff QA** → node tạo landing-page. Extract computed-CSS-token. |
| **hoainho/img2threejs** | MIT | Pattern spec-JSON→gate→build-passes→visual-diff + nguyên tắc "tốn token chỉ cho phần nhìn". 3D adjacent generator. |
| **Bomx/super-video-maker-skill** | *no license → concept-only* | **Cost/asset-preview gate** trước call gen trả phí + node QC layout (caption/PiP đè) + QC kỹ thuật (codec/duration). |
| **MegaTroll222/VOX-COLLAGE-BROLL** | MIT | Checklist **self-QA ảnh** (first-frame purity, anti-fake-lettering, contact-sheet) → node QC (SEOSONA hiện chưa có check chữ-rác). |
| **camel-ai/camel** | Apache (concept) | Pattern **Workforce**: coordinator phân rã → worker chuyên trách; role-prompt pair cho bước critic/refiner. |
| **msitarzewski/agency-agents** | MIT (concept) | Skeleton markdown persona (identity/expertise/process/voice) → chuẩn hoá cách viết skill/sub-agent. |
| **lcy362/agnes-video-generator** | MIT (concept) | Trick **character-ref-image** (tạo sheet nhân vật trước, reuse mọi scene) + taxonomy scene-chaining (keyframe/transition/independent) làm param node. |
| **YILS-LIN/short-video-factory** | *AGPL → concept-only* | Pattern **edge-tts** (neural TTS free không cần key) — reimplement độc lập. |
| **DeusData/codebase-memory-mcp** | MIT | **Dev-sidecar riêng** (không phải runtime, không trùng file-memory): index code→graph cho agent code SEOSONA. Học vocab node/edge cho "workflow-graph memory". |
| **anil-matcha/open-generative-ai** | MIT (narrow) | `sd.cpp` (1 binary, CPU-able) làm **fallback ảnh offline** tương lai; list 9 lip-sync model. |
| **lidge-jun/ima2-gen** | MIT (study-only) | Trùng vai SEOSONA (orchestrate web-UI gen). Chỉ học pattern SSE-multiplex + schema SQLite-history cho TileMonitor/History. |

## ✗ SKIP
- **302ai/302_video_generator** — AGPL, khoá cứng cloud 302.ai (paid), wrapper dịch vụ đóng.
- **boona13/mykonos-island-voxels** — Canvas-2D asset sandbox (KHÔNG phải 3D, không gen gì). Chỉ có pattern dirty-flag canvas (đã có tương đương).
- **every-app/open-seo** — SEO *analytics* (Semrush-alt) qua DataForSEO trả phí, không phải content-gen, không local.

## 🔑 Insight xuyên suốt (giá trị nhất — không nằm ở 1 repo nào)
**Nhiều repo hội tụ về CÙNG 1 pattern agent thắng:** *author spec (JSON) → quality-gate → build từng pass deterministic → validate bằng visual/LLM-diff, chỉ tốn token cho phần phán xét.* (website-cloner, img2threejs, vox-explainer, super-video-maker, prompt-optimizer, VideoGen-Eval đều quy về đây.) Cộng nguyên tắc **"AI quyết nội dung / code deterministic dựng pixel"** (huytranvan) = **kim chỉ nam kiến trúc cho SEOSONA Video AI V2** + nâng cấp WorkflowAgent hiện có.

## Đề xuất hành động (ưu tiên)
1. **Watermark remove** (gemini-watermark-remover) — nhanh, cùng stack, khép vòng ngay.
2. **Prompt-pack v10**: nhập schema arcads `template-format.md` + Vox 9×14 (vox-director) + virality-scoring → mở rộng thư viện prompt hiện có.
3. **Motion library**: import 403 recipe motion-anything (Apache) + schema recipe làm chuẩn node-catalog.
4. **Video AI V2 backbone**: khung `script.json` (huytranvan) + caption sidecar whisperX + quality-gate MLLM (VideoGen-Eval rubric) + reframe/clipper (openshorts) — tất cả là sidecar local, không đụng extension core.
5. **WorkflowAgent self-improve**: reimplement loop optimize/iterate/evaluate (prompt-optimizer taxonomy) + QC nodes (super-video/collage-broll self-QA) trên `pa:generate`.

*Lưu ý license: mọi thứ từ AGPL (short-video-factory, 302, prompt-optimizer) và no-license (super-video-maker) = CHỈ học ý tưởng, KHÔNG copy code vào sản phẩm.*
