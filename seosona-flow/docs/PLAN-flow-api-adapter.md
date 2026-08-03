# PLAN — Flow API adapter (local-first, tự dựng)

_Trạng thái: PLAN (chưa build). Nguồn cảm hứng: external Flow automation reference 1.2.5 "Flow API mode" — nhưng **kiến trúc khác hẳn**._

## 1. Vì sao muốn có

Hiện SEOSONA lái Google Flow bằng **DOM automation** (click/gõ vào UI). Hạn chế cố hữu:

| Vấn đề DOM | Hệ quả |
|---|---|
| Phải **activate tab Flow** khi chạy | Cướp focus của user, không chạy nền được |
| Phụ thuộc **selector UI** | Google đổi giao diện → gãy (đã phải maintain `_LOCAL_DOM_SELECTORS`) |
| Chờ **render + animation** | Chậm; mỗi prompt tốn giây chờ UI |
| Đọc kết quả qua **scan tile DOM** | TileMonitor phức tạp, race, lazy-load, stale |

Gọi thẳng API mà UI Flow đang dùng → nhanh hơn, chạy nền, không vỡ vì đổi giao diện.

## 2. Khác external Flow automation reference ở đâu (vì sao ta KHÔNG copy được họ)

| | external Flow automation reference 1.2.5 | SEOSONA (plan này) |
|---|---|---|
| Nguồn endpoint/param | **Server** `/api/v1/providers` (họ giấu, tự cập nhật) | **File spec LOCAL** `config/flow-api.json` |
| Gate | `FeatureGate.canUse('flow_api_enabled')` (premium) | Không gate — setting opt-in |
| Transport | **Extension bridge riêng** `external bridge reference` + `externally_connectable` | **Content script same-origin** (đã có sẵn) |
| Fallback | DOM | DOM (bắt buộc, luôn bật) |

**Điểm mấu chốt:** ta **không cần extension thứ hai**. Mọi thứ external bridge reference làm đều làm được **bên trong chính extension SEOSONA** (host permission riêng + script MAIN world + fetch từ service worker của mình). external Flow automation reference tách bridge vì kiến trúc thương mại của họ, không phải vì kỹ thuật bắt buộc.

> ⚠️ **ĐÍNH CHÍNH (2026-07-27) — bản đầu của plan này SAI ở giả định kỹ thuật.**
> Đối chiếu `external-bridge-reference-v1.1.1` (manifest + `bridge-sw.js` + `flow-token-capture.js` + `flow-main.js`):
>
> | Giả định ban đầu (SAI) | Thực tế đã verify |
> |---|---|
> | API gen nằm trên `labs.google` → **same-origin** | API gen ở **`aisandbox-pa.googleapis.com`** → **CROSS-ORIGIN** |
> | Auth bằng **cookie** sẵn có của session | Auth bằng **`Authorization: Bearer`** → phải **bắt token** từ ngữ cảnh trang |
> | *(bỏ sót)* | Cần **`grecaptcha.enterprise.execute`** → bắt buộc có script **MAIN world** |
>
> **Hệ quả:** đường "fetch same-origin nhẹ nhàng" **không tồn tại**. Muốn gọi API thật thì cần:
> `host_permissions: ["https://aisandbox-pa.googleapis.com/*"]` + fetch từ **service worker** (content script MV3 không được ưu tiên cross-origin) + cơ chế lấy Bearer token + xử lý captcha.
> Đây là **mở rộng bề mặt bảo mật đáng kể**, không phải "đường nhanh tuỳ chọn" như bản đầu mô tả.
> Phần vẫn đúng: không cần extension thứ hai · spec để local · DOM fallback vĩnh viễn · chia phase có cổng dừng.
> Xem thêm: `docs/REPORT-flow-api-bridge-upgrade-2026-07-27.md` (6 package + guardrail).

## 3. Kiến trúc

```
sidebar (PromptQueue.submitJob)
   │  genMode='api'?
   ├─ YES ─▶ FlowApiAdapter ──chrome.tabs.sendMessage──▶ content.js @labs.google/fx
   │                                                        │ fetch('/api/…', same-origin + cookie)
   │                                                        ▼
   │         ◀── {resultTileIds, resultThumbnails} ◀── map theo flow-api.json
   │
   └─ NO / lỗi / spec stale ─▶ EditorExecutor (DOM, đường hiện tại) ← LUÔN là fallback
```

**Bất biến:** adapter trả **đúng shape** downstream đang dùng (`resultTileIds` / `resultThumbnails{url,video_url,file_name}`) → PromptQueue · WorkflowExecutor · history · download **không phải sửa**.

## 4. Các mảnh cần build

| # | Thành phần | Việc |
|---|---|---|
| 1 | `config/flow-api.json` | Spec local: endpoint, method, headers cần, payload template, đường map response. **Không hardcode trong JS** → sửa spec là fix được, không cần release code. |
| 2 | `src/core/FlowApiSpec.js` | Load + validate spec, versioning, `isUsable()`. |
| 3 | `src/core/FlowApiAdapter.js` | Build payload từ spec + prompt/settings → gửi content script → map kết quả → shape chuẩn. Semaphore concurrency (tái dùng `queue_max_monitor`). Retry 1 tầng. |
| 4 | `content_scripts/content.js` (thêm handler) | Nhận `{action:'flowApi:request', method, path, body}` → `fetch` same-origin → trả `{ok,status,data}`. **Chỉ cho path thuộc origin Flow** (chặn SSRF qua chính session user). |
| 5 | Job polling | Gen là async: submit → nhận operation id → poll tới khi xong. Thay TileMonitor cho nhánh API (DOM path giữ nguyên). |
| 6 | Setting + UI | `flowGenMode: 'dom' \| 'api' \| 'auto'` (default **`dom`**). Chấm trạng thái: spec OK / chưa cấu hình / lỗi → rơi về DOM. |

## 5. Giai đoạn

**P0 — Discovery (bạn làm, 1 lần).** Mở DevTools → Network trên `labs.google/fx`, tự gen 1 ảnh + 1 video như bình thường → **Export HAR**. Đây là traffic tài khoản của chính bạn, không cào ai. Tôi parse HAR → sinh `flow-api.json` nháp (endpoint, payload shape, response shape).

**P1 — Read-only probe.** Chỉ gọi endpoint **đọc** (list project/tiles). Không gen. Mục tiêu: chứng minh same-origin fetch + auth chạy được, spec map đúng. Rủi ro ~0.

**P2 — Shadow mode.** Gen bằng **DOM như thường**, đồng thời gọi API **song song chỉ để so sánh** kết quả, ghi log lệch. Không đổi hành vi user. Đây là cổng chất lượng trước khi tin API.

**P3 — Opt-in API path.** Bật `flowGenMode='api'` → gen thật qua API, **fallback DOM tự động** khi: spec thiếu, HTTP lỗi, shape lạ, timeout. Mặc định vẫn `dom`.

**P4 — Auto mode.** `auto` = thử API, hỏng thì DOM, và **tự hạ về DOM** sau N lần lỗi liên tiếp (circuit breaker) + báo user "spec cần cập nhật".

## 6. Rủi ro (nói thẳng)

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| **Google đổi API** → gãy | 🔴 Cao (đây là internal API, không có cam kết ổn định) | Spec tách file + circuit breaker + **DOM fallback luôn sống**. Hỏng = chậm lại, không chết. |
| **Phải bắt `Authorization: Bearer`** từ trang | 🔴 Cao | **DỪNG chờ security review trước khi làm.** Không lưu token thô, không log. Nếu không có đường sạch → dừng ở P1, giữ DOM. |
| **Cần captcha `grecaptcha.enterprise`** (script MAIN world) | 🟡 Vừa | Chỉ chạy MAIN world trong chính extension SEOSONA; không persist token captcha. |
| **Phải thêm `host_permissions` cho `aisandbox-pa.googleapis.com`** | 🟡 Vừa | Quyền hẹp đúng 1 host; tuyệt đối không import `<all_urls>`. Có ghi chú lý do khi review. |
| Anti-abuse: API dễ bị đếm nhịp hơn người thật | 🟡 Vừa | Giữ concurrency = mức hiện tại, có delay; **không** tăng tốc độ chỉ vì làm được. |
| Công sức lớn, lợi ích chỉ là tốc độ | 🟡 Vừa | Dừng được sau P2 nếu thấy không đáng — P0–P2 vẫn có giá trị (hiểu API, so sánh). |
| Tự lái session của mình qua API nội bộ | 🟢 Thấp | Cùng bản chất với DOM automation đang làm (đều dùng session của chính bạn, quota của chính bạn). Không vượt rào nào mới. |

## 7. Cổng dừng

Sau **P2 (shadow)**, xem log lệch:
- Khớp ≥95% + nhanh hơn rõ → đi tiếp P3.
- Lệch nhiều / endpoint đổi trong lúc thử → **dừng, giữ DOM**. Coi P0–P2 là nghiên cứu, không lỗ.

## 8. Không làm

- ❌ Không lấy `api_config` từ backend external Flow automation reference (kể cả có tài khoản premium) — đó là tài sản của họ.
- ❌ Không cài/đòi bridge extension bên thứ ba.
- ❌ Không gửi gì ra server nào — toàn bộ trong máy, đúng local-first.
- ❌ Không bỏ đường DOM. API là **đường nhanh tuỳ chọn**, không phải đường thay thế.
