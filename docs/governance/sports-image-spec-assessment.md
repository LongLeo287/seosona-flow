# Đánh giá bản đặc tả Sports Image Workflow + kế hoạch nâng cấp năng lực

Đọc ngày 2026-08-04, đối chiếu với **mã thật** tại commit `5107c0b`, không đọc lướt theo mục lục.

Hai tài liệu:

- `SEOSONA_Flow_Sports_Image_Workflow_System_Technical_Spec_v1.0.docx` (02/08, 710 dòng, 18 chương)
- `docs/superpowers/plans/2026-08-04-seosona-flow-competitive-capability-upgrade.md` (04/08, 73 KB)

---

## 1. Kết luận ngắn

Bản đặc tả **viết tốt và kiến trúc đúng**. Nó không phải bản vẽ mơ hồ: có port contract, JSON
schema, node catalog, acceptance test cụ thể (cầu lông), rollout theo lát mỏng.

Nhưng nó đòi **một lớp năng lực mà sản phẩm hiện tại không có**: sửa ảnh CỤC BỘ bằng engine chạy
trên máy (ComfyUI, PIL/OpenCV, upscaler, pose analyzer). Sản phẩm hiện tại là **điều khiển tài
khoản AI của người dùng qua trình duyệt** — nó không xử lý pixel ngoài xoá watermark (canvas) và
dọn metadata.

Đó không phải lý do để từ chối. Đó là lý do để **tách đôi**: nửa không cần engine làm được ngay
và có giá trị thật; nửa cần engine thì phải quyết trước khi viết dòng nào.

---

## 2. Hai tài liệu MÂU THUẪN nhau về ComfyUI

| | Nói gì về ComfyUI |
|---|---|
| Đặc tả (02/08) | "engine **đề xuất** cho txt2img/img2img/inpaint/outpaint/reference conditioning/upscale" — chương 13 dành hẳn cho nó |
| Kế hoạch (04/08, mới hơn) | "Local ComfyUI adapter **để ở backlog sau chương trình**, chỉ được mở khi core đạt Phase 9 gate và có threat model riêng" |

Bản mới hơn hoãn đúng thứ bản cũ dựa vào. Phải chốt cái nào thắng trước khi bắt đầu, nếu không
sẽ xây nửa chừng rồi phải bỏ.

---

## 3. Cái ta ĐÃ CÓ mà bản đặc tả tưởng phải xây mới

Đây là phần đáng giá nhất của việc đối chiếu — **nguyên tắc lõi của đặc tả đã hiện diện một phần
trong mã**:

| Đặc tả gọi là | Ta đã có | Mức khớp |
|---|---|---|
| `image_reference` (ref có **vai trò**) | node `entity_ref` — có sẵn `ROLES = {identity, motion, environment}`, sinh khối "mỗi tham chiếu chỉ đóng ĐÚNG vai đã ghi" | **cao** |
| `source_lock` (ảnh nguồn là authority) | node `image_composite` — outpaint rồi **dán lại pixel gốc**, đúng nguyên tắc "nguồn không bị mô hình vẽ đè" | **cao về nguyên tắc**, thiếu phần lock/hash/receipt |
| `sports_validator` | node `quality_gate` — khung chấm + accept/reject đã có | trung bình, thiếu luật riêng môn thể thao |
| `sport_preset` | node `style_anchor` — neo phong cách dùng chung cho cả loạt | trung bình |
| `compare_diff` | hàm so sánh pixel đã viết cho xoá watermark (`markContrast`, khung phóng góc, 3 chỉ số) | trung bình, cần đóng gói thành node |
| prompt packs + negative prompt | kho 450 prompt + skill `anti-slop-visual` + `text-in-image` | **cao** |

Nghĩa là: đặc tả không bắt đầu từ số không. Nó bắt đầu từ khoảng 40% với những mảnh đã kiểm chứng.

---

## 4. Cái BẮT BUỘC phải có engine — không lách được

| Node | Vì sao không làm bằng trình duyệt được |
|---|---|
| `mask_editor` + `localized_inpaint` | Đây là **giá trị lõi** của cả đặc tả. Sửa trong vùng mask mà giữ nguyên ngoài vùng — Google Flow không nhận mask từ ngoài. |
| `face_cleanup` | Retouch không đổi cấu trúc; cần model chuyên hoặc thao tác ảnh cục bộ. |
| `photo_finish` | Non-generative grade — cái này **làm bằng canvas được**, không cần engine. |
| `upscale` | Đã xác lập hôm nay: trên Flow đây là **thao tác bất đồng bộ và TỐN TÍN DỤNG** (video 4K = 50 tín dụng). Không phải một nút tải. |

Chú ý `upscale`: đặc tả coi nó là một node bình thường. Thực tế trên Flow nó là thao tác chạy nền
có tính phí — bài học vừa trả giá ở đường tải. Node đó phải mang cảnh báo tín dụng, không được
chạy im lặng.

---

## 5. Đề xuất: chia ba lát, chỉ lát 1 bắt đầu được ngay

### Lát 1 — Không cần engine, làm được ngay (ước lượng: vài ngày)

1. `sport_preset` — preset có phiên bản, dữ liệu thuần. Tận dụng `style_anchor`.
2. `source_lock` — băm ảnh nguồn + baseline + receipt. JS thuần, không phụ thuộc gì.
3. `compare_diff` — đóng gói lại phần so sánh pixel đã viết cho watermark thành node.
4. `sports_validator` — luật kiểm cho môn thể thao, cắm lên `quality_gate` sẵn có.
5. `photo_finish` — grade bằng canvas (không sinh ảnh), tất định, test snapshot được.
6. Prompt pack thể thao + negative prompt — đúng thế mạnh sẵn có.

Lát này **tự nó có giá trị**: người dùng gen ảnh thể thao trên Flow, rồi khoá nguồn, chấm chất
lượng theo luật môn, so sánh trước/sau, và finish bằng grade. Không cần cài gì thêm.

### Lát 2 — Cần quyết định, chưa viết mã

`mask_editor` + `localized_inpaint`. Ba đường:

| Đường | Được | Mất |
|---|---|---|
| ComfyUI cục bộ | đúng đặc tả, mạnh nhất | người dùng phải tự cài + chạy server; mở một cổng mạng nội bộ — kế hoạch 04/08 đòi threat model riêng trước |
| Dùng khả năng edit sẵn của Flow | không cài gì | Flow **không nhận mask ngoài** → không phải inpaint cục bộ thật |
| Canvas + mô hình nhỏ trong trình duyệt | không cài gì, không mở cổng | chất lượng thấp hơn hẳn cho vùng phức tạp |

Không tự chọn hộ. Đây là quyết định sản phẩm.

### Lát 3 — Sau, và chỉ khi lát 2 đã chốt

`face_cleanup`, `object_region_bind`, ComfyUI adapter đầy đủ, badminton acceptance test.

---

## 6. Về kế hoạch nâng cấp năng lực (04/08)

12 hạng mục, Phase 0→9. Trạng thái thật:

- `VisualPickerCore` (120 dòng) và `BatchCollectorCore` (106 dòng) — **mã thật, không phải khung rỗng**, nhưng **0 nơi dùng**. Task P1.T1 của kế hoạch chính là nối chúng vào service worker.
- `ConnectorStatus`, `MessageSchemas` — cùng bộ, cũng chưa nối.

**Cảnh báo từ sai lầm của chính tôi:** hôm nay tôi đã xoá `ConnectorStatus` và `MessageSchemas` vì
"0 nơi tham chiếu", rồi phải khôi phục. Phép đo đó không phân biệt **chưa-nối-dây** với
**đã-lỗi-thời**. Ai dọn dẹp repo này về sau phải đọc thư mục kế hoạch trước.

Kế hoạch này **không chồng lấn** bản đặc tả thể thao: nó làm capture/extract/rows/results, còn
đặc tả làm ảnh thể thao. Chạy song song được, nhưng **không nên** — cả hai đều lớn.

---

## 7. Khuyến nghị thứ tự

1. **Chốt ComfyUI: có hay không.** Câu này chặn lát 2 của đặc tả và Phase 9 của kế hoạch.
2. **Làm Lát 1 của đặc tả thể thao** — 6 node không cần engine, tự nó dùng được.
3. **Rồi mới** chọn giữa lát 2 và kế hoạch nâng cấp. Làm một cái cho xong, không làm song song.

Trước khi bắt đầu bất cứ cái nào: hai việc treo cần bạn xác nhận —
lỗi tải ra `.htm`, và tỉ lệ dung lượng video sau khi xoá watermark.
