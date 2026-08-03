---
name: mllm-judge
description: >-
  Quality-gate ảnh/clip AI cho SEOSONA Flow bằng MLLM-as-judge — chấm theo rubric (bám prompt / chất
  lượng motion & temporal / thẩm mỹ / artifact-vật-lý) với pre-filter rẻ bằng JS trước khi tốn model.
  Dùng khi cần cổng chất lượng tự động trong pipeline gen (accept/reject + điểm), so nhiều output để
  chọn cái tốt nhất, hoặc đánh giá 1 clip/ảnh có đạt brief không. Học VideoGen-Eval (agent-judge, không
  metric cứng).
---

# SEOSONA Flow — MLLM-as-Judge (quality-gate)

Chấm chất lượng output gen bằng **vision model làm giám khảo** theo rubric — KHÔNG dùng metric cứng
(FVD/CLIP) vì lệch cảm nhận người. Nguyên tắc (VideoGen-Eval): agent chấm theo tiêu chí, có bằng chứng.
**Tiết kiệm:** pre-filter rẻ trước, chỉ gọi model cho phần cần phán xét.

## Quy trình

### 1. PRE-FILTER (rẻ, JS — làm TRƯỚC khi gọi model)
Loại nhanh output hỏng rõ, khỏi tốn model:
- Ảnh: black/blank frame, blur toàn cục, 0-byte / lỗi tải, trùng-lặp (dup của lần trước).
- Clip: 0 frame, đứng hình, độ dài sai.
Fail pre-filter → REJECT ngay (không cần model).

### 2. RUBRIC (MLLM chấm mỗi trục 0-5 + 1 dòng lý do)
Qua MessageBridge/pa:generate gửi ảnh/frame + rubric tới ChatGPT/Gemini:
- **Prompt-adherence**: đúng subject/action/setting/style yêu cầu?
- **Motion & temporal** (clip): chuyển động mượt, không giật/nhấp nháy, nhất quán qua frame?
- **Aesthetic**: bố cục, ánh sáng, màu — chuyên nghiệp?
- **Artifact / physics**: tay-thừa, mặt-méo, chữ-rác (→ skill image-qa/text-qa), vật lý sai (bóng/phản chiếu vô lý)?
- (Tuỳ chọn) **Brand-fit**: đúng brand/persona {brand}?

### 3. VERDICT + hành động
- Tổng điểm / ngưỡng {pass_threshold=3.5} → **ACCEPT / REJECT**.
- REJECT: nêu trục yếu nhất + 1 sửa cho lần regenerate (thêm vào prompt) — hoặc chuyển skill chuyên (chữ→text-in-image, nhân vật→character-consistency).
- **So nhiều output**: chấm từng cái → chọn điểm cao nhất (best-of-N).

## Output contract
1. **Pre-filter**: pass/fail + lý do (nếu fail, dừng ở đây).
2. **Rubric table**: | trục | 0-5 | lý do |.
3. **VERDICT**: ACCEPT | REJECT + tổng điểm.
4. (Nếu reject) **1 fix** cụ thể cho regenerate.
5. (Nếu best-of-N) bảng điểm + cái được chọn.

## Nguyên tắc
- Pre-filter rẻ TRƯỚC — đừng tốn vision-call cho ảnh đen.
- Chấm có BẰNG CHỨNG (chỉ ra chỗ lỗi), không khen suông.
- Chữ-rác / nhân-vật-trôi → giao skill chuyên (text-qa / character-consistency), đừng chấm chung chung.
- Mặc định nghi ngờ; điểm mơ hồ → REJECT + nêu cần kiểm gì.
