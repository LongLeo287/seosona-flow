# Plan nâng cấp SEOSONA Flow — rút từ phân tích `crisng95/flowkit`

Ngày: 2026-08-01 · Nguồn: https://github.com/crisng95/flowkit (MIT, 554★, code đứng từ 09/05/2026)

---

## 0. Nguyên tắc — cái KHÔNG làm, và vì sao

FlowKit gen bằng cách gọi thẳng `aisandbox-pa.googleapis.com` với bearer token bắt được,
tự giải reCAPTCHA, và bắn telemetry giả để né phát hiện.

**Không port ba thứ đó.** Ngoài chuyện tôi không dựng phần né phát hiện/vượt captcha, nó còn
là nợ kỹ thuật thấy rõ ngay trong repo của họ: có hẳn commit `handle PUBLIC_ERROR_UNUSUAL_ACTIVITY`
và mục "UNUSUAL_ACTIVITY recovery" với hướng dẫn *xoá cookie google.com, đăng nhập lại, đợi 1–6 giờ* —
tức người dùng đang bị Google gắn cờ. Lái UI hỏng thì sửa selector; khoá tài khoản thì không sửa được.

Cũng **không** port `real-people-bypass` (kỹ thuật lách bộ lọc an toàn để dựng người thật).

**Điều quan trọng cần biết:** SEOSONA *đã có sẵn* toàn bộ bản đồ API đó trong
`src/core/ProviderConfigManager.js` → `_LOCAL_API_CONFIGS.flow` — cùng endpoint, cùng
`site_key` captcha, cùng bảng model `NARWHAL`/`GEM_PIX_2`. Không dùng là **lựa chọn**, không phải
thiếu sót. Plan này giữ nguyên lựa chọn đó.

Giá trị thật của FlowKit nằm ở **tầng pipeline và kỷ luật vận hành**, không ở tầng API.

---

## Đòn 1 — Nối dây cấu hình rate-limit đang nằm chết  ⭐ ưu tiên cao nhất

**Hôm nay:** `_LOCAL_API_CONFIGS.flow.configs.api_rate_limits` khai đầy đủ

```
max_concurrent: 5 · cooldown_ms: 10000 · base_backoff_ms: 10000 · max_backoff_ms: 300000
max_retries: 5 · circuit_breaker_threshold: 5 · circuit_breaker_reset_ms: 60000
image_timeout_ms: 180000 · video_timeout_ms: 420000 · poll_interval_ms: 2000
```

nhưng **grep toàn repo: không nơi nào đọc nó**. Thực tế `BatchQueue` đang dùng
`autoRetryMax = 2`, `autoRetryDelay = 3000` — nghỉ 3 giây, thử 2 lần.

FlowKit dùng đúng bộ số trên và vẫn bị gắn cờ. Ta đang chạy gấp gáp hơn họ.

**Làm:**
1. `ProviderConfigManager` thêm getter `getRateLimits(provider)` (đọc config, có mặc định an toàn).
2. `WorkflowExecutor` + `BatchQueue` đọc từ đó thay vì hằng số cứng.
3. Backoff luỹ thừa thật: `min(base * 2^n, max)` — 10s → 20s → 40s … trần 300s.
4. **Circuit breaker**: 5 lỗi liên tiếp → mở mạch 60s, trong lúc đó không gửi request nào,
   hiện đếm ngược trên tracker nổi.
5. **Phân loại retry** (học đúng cây quyết định `processor.py:_handle_failure`):

   | Loại lỗi | Xử lý | Có tính vào `retry_count`? |
   |---|---|---|
   | `media_expired` (entity not found) | upload lại ref rồi xếp lại hàng | **Không** |
   | mất kết nối / đổi tab | xếp lại hàng | **Không** |
   | `bot_detected` (UNUSUAL_ACTIVITY) | **DỪNG HẲN** + hướng dẫn khôi phục | — (terminal) |
   | `quota_exceeded`, `tier_restricted`, `content_blocked` | terminal, không retry | — |
   | 5xx / mạng | backoff luỹ thừa | Có |

**Chạm:** `ProviderConfigManager.js` · `WorkflowExecutor.js` · `BatchQueue.js` · `floating-tracker-rich.js`

**Nghiệm thu:** test đơn vị cho từng nhánh cây quyết định · chạy 20 node liên tiếp không vượt
5 đồng thời · giả lập 5 lỗi liên tiếp thấy mạch mở đúng 60s.

---

## Đòn 2 — Vô hiệu hoá dây chuyền + cổng chặn ref  ⭐ ưu tiên cao

**Hôm nay:** executor **đã có** resume skip-completed (`WorkflowExecutor.js:1977`). Nhưng thiếu
hai mảnh khiến resume đôi khi sai:

- Sửa/gen lại một node ảnh **không** xoá kết quả video/upscale phía sau → workflow "xong" nhưng
  video vẫn là bản của ảnh cũ.
- Node gen cảnh vẫn chạy dù ảnh tham chiếu chưa có → ra ảnh sai nhân vật rồi mới biết.

FlowKit gọi hai cái này là *cascade clearing* và *reference blocking*, và cả hai đều bắt buộc.

**Làm:**
1. `_invalidateDownstream(nodeId)` — duyệt xuôi đồ thị, xoá `result` của mọi node hạ lưu khi node
   này chạy lại. Chạy trong `_runSingleNode` + khi sửa cấu hình node.
2. Mở rộng `_preflightCheck`: nếu node gen có ref (@mention hoặc cổng ảnh) mà nguồn chưa có kết quả
   → **chặn trước khi gửi**, báo rõ "thiếu ảnh tham chiếu từ node X", không đốt credit.

**Chạm:** `WorkflowEditorRun.js` (`_preflightCheck`, `_runSingleNode`) · `WorkflowExecutor.js`

**Nghiệm thu:** test — gen lại node ảnh giữa chuỗi thì node video hạ lưu mất `result`; chạy workflow
thiếu ref thì dừng ở preflight với 0 request gửi đi.

---

## Đòn 3 — Bảng nhân vật & ảnh tham chiếu (entity sheet)

**Hôm nay:** `CharacterRegistry` chỉ **scrape danh sách nhân vật có sẵn trong menu Flow** của user —
nó không phải hệ thực thể của workflow. Ref ảnh hiện đi qua @mention từng node, không có khái niệm
"một thực thể = một ảnh gốc dùng lại xuyên suốt".

Đây là chỗ FlowKit hơn hẳn, và là gốc của vấn đề *trôi mặt / đổi trang phục giữa các cảnh*.

**Làm:**
1. Node mới **`entity_ref`** (kho thực thể của workflow): danh sách `{ name, type, appearance, ref_result }`
   với `type ∈ character | location | creature | prop`.
2. Tự chọn tỉ lệ theo loại — đúng bảng FlowKit:

   | Loại | Tỉ lệ | Nội dung ảnh gốc |
   |---|---|---|
   | character / creature | dọc | toàn thân, chính diện, giữa khung |
   | location | ngang | cảnh thiết lập, đường chân trời phẳng |
   | prop / visual_asset | dọc | cận cảnh, rõ chất liệu |

3. Node xuất ra ref cho **mọi** node gen hạ lưu — không phải @mention thủ công từng cái.
4. **Luật viết prompt** (nhúng vào node + skill `character-consistency`):
   > Cảnh chỉ gọi thực thể **bằng TÊN**, tả **hành động**. **Cấm tả lại ngoại hình** — vì tả lại là
   > đá nhau với ảnh ref.
   > ✅ `Pippip đứng sau Fish Stall sắp hàng`
   > ❌ `Một con mèo vàng mặc tạp dề xanh đứng sau…`
5. Cổng chặn: chưa gen đủ ảnh gốc thì không cho chạy cảnh (nối vào Đòn 2).

**Chạm:** `NodeTemplates.js` · `WorkflowExecutor.js` (handler) · `WorkflowEditorNodeForm.js` (form) ·
`node-catalog.json` · skill `character-consistency`

**Nghiệm thu:** 1 workflow mẫu 5 cảnh dùng chung 2 thực thể, gen ra giữ nhận diện; test framework validate node.

---

## Đòn 4 — Nối cảnh bằng khung đầu/cuối

**Hôm nay:** hoàn toàn chưa có. Config đã biết endpoint `video_start_end`
(`batchAsyncGenerateVideoStartAndEndImage`) nhưng không ai dùng, và UI Flow cũng hỗ trợ khung đầu+cuối.

**Làm:**
1. Cảnh có `chain_type`: `ROOT` (cắt cứng) hoặc `CONTINUATION` (nối).
2. Với chuỗi nối: `khung đầu = ảnh cảnh N`, `khung cuối = ảnh cảnh N+1` → video chạy *từ* N *đến* N+1,
   nên khung cuối video N trùng khung đầu video N+1 → ghép liền mạch.
3. **Chép nguyên cảnh báo của họ:** chỗ nối bị **10–16 khung tĩnh trùng (~0,4–0,7s)**. Xử lý: cắt phần
   chồng khi ghép, và **đổi bối cảnh thì dùng ROOT (cắt cứng) chứ đừng nối tất**.

**Chạm:** `NodeTemplates.js` (trường `chain_type`, `end_frame_source`) · `WorkflowExecutor.js` ·
`BundledTemplates.js` (1 template mẫu)

**Nghiệm thu:** workflow 3 cảnh nối, kiểm bằng mắt chỗ chuyển; ghi rõ độ trùng khung trong log.

---

## Đòn 5 — Node cổng chất lượng (QA gate)

**Hôm nay:** đã có skill `image-qa` và `mllm-judge`, nhưng **chưa có node** để cắm vào workflow.

FlowKit chấm 6 trục — bám prompt · nhất quán nhân vật · chất lượng chuyển động · độ nét ·
mạch thời gian · bố cục — lấy mẫu 4 khung/giây (nhanh) hoặc 8 khung/giây (kỹ), và **bất kỳ lỗi
CRITICAL nào là trượt bất kể điểm khác**.

Thang điểm của họ, dùng luôn:

| Điểm | Kết luận | Hành động |
|---|---|---|
| 9,0–10 | Xuất sắc | dùng luôn |
| 7,5–8,9 | Tốt | dùng được |
| 6,0–7,4 | Tạm | cắt đoạn dùng được, gen lại phần yếu |
| 4,0–5,9 | Kém | gen lại **ảnh** rồi mới gen video |
| 0–3,9 | Hỏng | viết lại prompt, làm lại từ đầu |

**Làm:** node `quality_gate` — cổng vào nhận ảnh/video, 2 cổng ra (đạt / trượt), nối vào nhánh gen lại.
Bọc `image-qa` + `mllm-judge` sẵn có. Có bộ lọc rẻ bằng JS trước khi tốn model (đúng như skill đã ghi).

**Chạm:** `NodeTemplates.js` · `WorkflowExecutor.js` · `node-catalog.json`

**Nghiệm thu:** workflow gen → QA → nhánh trượt tự gen lại tối đa N lần rồi báo người dùng.

---

## Đòn 6 — Bảng "Bác sĩ" tự chẩn

**Hôm nay:** đã phân loại được 6 mã lỗi Flow thành `content_blocked / bot_detected / quota_exceeded /
tier_restricted / captcha_failed / media_expired` và đổ ra toast tiếng Việt. Nhưng chỉ dừng ở *báo*,
không có *quy trình khôi phục*.

**Làm:** panel `Bác sĩ` trong Logs — mỗi mã lỗi kèm các bước xử lý cụ thể. Ví dụ `bot_detected`
(bản đã lược phần né phát hiện, chỉ giữ phần khôi phục hợp lệ):

> 1. Dừng mọi việc đang chạy
> 2. Xoá cookie `google.com` + `labs.google`
> 3. Vào lại `labs.google/fx/tools/flow`, đăng nhập **thủ công**, tự giải captcha nếu có
> 4. Chạy lại chậm hơn — Đòn 1 đã ép sẵn giãn cách
> 5. Vẫn chặn → đổi mạng hoặc nghỉ 1–6 giờ

Cộng thêm nút **tự kiểm** (có tab Flow chưa · đã đăng nhập chưa · content script còn sống không ·
số dư credit) — đúng vai `curl /health` của họ nhưng nằm trong UI.

Với `content_blocked`: gợi ý viết lại prompt theo hướng **chủ thể gốc/chung chung** (nhân vật tự
nghĩ thay vì người thật). Đây là hướng dẫn tạo nội dung hợp lệ — **không** phải thang lách bộ lọc
để dựng người thật như `real-people-bypass` của họ.

**Chạm:** `WorkflowResultsTab.js` (thêm tab) · `content.js` (bảng mã lỗi) · `docs/runbooks/`

**Nghiệm thu:** mỗi mã trong `api_error_codes` có đúng 1 mục xử lý; nút tự kiểm chạy được ở cả 4 trạng thái.

---

## Đòn 7 — Mấy thứ nhỏ, gần như miễn phí

1. **Chuẩn hoá âm thanh prompt video** — tự chèn `"no background music, keep natural sound effects"`
   vào mọi prompt video. Một dòng, hợp đúng hướng "video câm để Video AI V2 lồng tiếng".
2. **Model tầng thấp** — bổ sung `veo_3_1_i2v_lite_low_priority` / `veo_3_1_i2v_s_fast` /
   `veo_3_1_upsampler_4k` vào `ModelRegistry` **nếu** UI Flow phơi ra. `low_priority` = chờ lâu hơn,
   rẻ hơn — hợp chạy lô qua đêm.
3. **Sửa `media_id` hỏng** — nhận `CAMS…` và tách UUID (đúng việc `/fk-fix-uuids` làm).
4. **Làm mới URL hết hạn** — link GCS có ký hết hạn ~1 giờ; thêm nút refresh cho kết quả cũ.
5. **Ghi nhớ giọng nhân vật** — `voice_description` của thực thể tự chèn vào prompt video.

---

## Thứ tự đề nghị

```
Đòn 1 (rate-limit + circuit breaker)   ← làm trước, bảo vệ tài khoản
   └→ Đòn 2 (cascade + cổng ref)       ← đúng đắn dữ liệu, tiết kiệm credit
        └→ Đòn 3 (entity sheet)        ← đòn chất lượng lớn nhất
             ├→ Đòn 4 (nối cảnh)
             └→ Đòn 5 (QA gate)
Đòn 6 + 7 xen kẽ, độc lập
```

Đòn 1 và 2 nên đi cùng nhau: cả hai đều là "đừng đốt credit vào việc sai".

## Bảng đối chiếu nhanh

| Năng lực | FlowKit | SEOSONA hôm nay | Sau plan |
|---|---|---|---|
| Giới hạn tốc độ / circuit breaker | có, dùng thật | **config có, nằm chết** | Đòn 1 |
| Phân loại retry theo loại lỗi | có | một mức chung | Đòn 1 |
| Vô hiệu hoá dây chuyền | có | không | Đòn 2 |
| Resume bỏ qua node xong | có | **đã có** | giữ |
| Thực thể + ảnh gốc dùng lại | có | ref rời từng node | Đòn 3 |
| Nối cảnh khung đầu/cuối | có | không | Đòn 4 |
| Cổng chất lượng | có (Claude Vision) | có skill, **chưa có node** | Đòn 5 |
| Bảng chẩn lỗi | có (`/fk-doctor`) | phân loại + toast | Đòn 6 |
| Nhận diện mã lỗi Flow | có | **đã có đủ 6 mã** | giữ |
| Gọi thẳng API + giải captcha | có | không (cố ý) | **giữ nguyên không** |
| Cài đặt | venv + ffmpeg + agent | load extension là chạy | **lợi thế của ta** |
