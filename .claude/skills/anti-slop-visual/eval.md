# Eval — anti-slop-visual

Bộ ca kiểm tra rule bắn đúng. Checker máy: `src/core/PromptLint.js` (`PromptLint.check(text)` → findings).
Chạy test: `node --test tests/unit/prompt-lint.test.mjs` (hoặc `npm run test:unit`).

## Ca PHẢI bị cờ (slop)

| # | Prompt bẩn | Cụm phải bắt |
|---|---|---|
| 1 | `a beautiful woman, 8k, masterpiece, hyper-detailed, trending on artstation` | `8k`, `masterpiece`, `hyper-detailed`, `trending on artstation`, `beautiful` |
| 2 | `stunning landscape, cinematic lighting, highly detailed, photorealistic` | `stunning`, `cinematic lighting`, `highly detailed`, `photorealistic` |
| 3 | `perfect face, flawless skin, ultra realistic, best quality` | `perfect face`, `flawless skin`, `ultra realistic`, `best quality` |
| 4 | `chân dung tuyệt đẹp, 4k, siêu chi tiết` | `tuyệt đẹp`, `4k`, `siêu chi tiết` (tell tiếng Việt) |

## Ca PHẢI SẠCH (không cờ)

| # | Prompt tốt | Vì sao sạch |
|---|---|---|
| 5 | `chân dung studio, ống 85mm f/1.8, 1 đèn key mềm + rim light viền tóc, da có lỗ chân lông, nền xám seamless, 9:16` | toàn thông số/chất liệu cụ thể |
| 6 | `tranh gouache trên giấy ráp, 2 nhân vật, bảng màu đất, KHÔNG bóng nhựa` | phong cách neo + phủ định lỗi |

## Tiêu chí PASS
- Ca 1–4: `check()` trả ≥1 finding cho MỖI cụm liệt kê (severity `slop`).
- Ca 5–6: `check()` trả **0** finding.
- Không false-positive: "detailed" nằm trong "highly detailed" bị cấm, nhưng "chi tiết ren tay áo" (chi tiết + danh từ) KHÔNG bị cấm.
