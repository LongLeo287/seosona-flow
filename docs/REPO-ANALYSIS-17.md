# Phân tích 17 nguồn — mức bổ trợ cho SEOSONA Flow

Đọc thật từng repo, không đoán theo tên. Xếp theo **việc nó giải quyết cho ta**, không theo
độ nổi tiếng.

## Bối cảnh để đọc bảng này

SEOSONA Flow = **sinh PIXEL** (ảnh/video AI qua Flow · ChatGPT · Gemini · Grok), chạy trong
trình duyệt, 100% offline. Nó **không** dựng phim, không lồng tiếng, không render motion
graphics. Phần đó thuộc SEOSONA Video AI V2 — sản phẩm riêng.

Nên nhiều repo dưới đây **rất tốt nhưng không thuộc về Flow**. Nhét vào là làm Flow phình ra
thành thứ nó không phải.

---

## Nhóm A — ADOPT: lấy được ngay vào Flow

### `mattpocock/skills` — kỷ luật làm việc với agent
Ba pattern: **grill trước khi build** (agent phải hỏi tới khi đủ thông tin mới viết), **ngôn
ngữ miền chung** để giảm dài dòng, và **vòng phản hồi chặt** (TDD + kỷ luật kiến trúc).

Đáng lấy vì đúng chỗ ta vừa trả giá: ba vòng sửa pipeline video vì đọc lướt rồi viết theo trí
nhớ. "Grill trước khi build" chính là thuốc cho bệnh đó. Ta đã có skill `interview-to-spec`
cho prompt ảnh — mở rộng nguyên tắc đó sang việc VIẾT MÃ.

### `virgiliojr94/book-to-skill` — nén tài liệu thành skill tra-khi-cần
Trích khung sườn + tóm tắt theo chương thay vì nhồi cả file vào ngữ cảnh; họ đo được **giảm
24–51 lần** token.

Áp thẳng được: kho prompt 323 mẫu + 30 workflow của ta hiện nạp kiểu khối lớn. Chuyển sang
mục lục mỏng + nạp theo yêu cầu là tiết kiệm thật, và đây là bài toán ta ĐANG gặp — phiên này
cạn ngữ cảnh nhiều lần.

### `crisng95/flowkit` — đối thủ trực tiếp, bản mới
Đã phân tích ở đợt trước và **từ chối** phần chặn bearer/giả mạo Origin (có gate
`security:independence` 6 luật chặn). Bản mới thêm: **frame-chaining `i2v_fl`** nối cảnh mượt,
**hệ material** điều phối phong cách, và **phân biệt lỗi tạm thời với lỗi hạn mức**.

Ta đã có `chain_type` (khung đầu/cuối) và phân loại lỗi. Cái đáng học còn lại là **hệ
material** — một khối phong cách dùng chung cho cả loạt, gần với `Neo phong cách` ta đã có
nhưng chặt chẽ hơn.

---

## Nhóm B — ADAPT: ý tưởng tốt, phải đổi hình dạng

### `Vincentwei1021/video-shotcraft` — 104 thẻ công thức cú máy
Skill biến agent thành xưởng motion design với Remotion. **104 shot recipe + 161 xem trước
chuyển động.**

Phần Remotion không dùng được (React/Node, ta chạy trong trình duyệt). Nhưng **kho công thức
cú máy** thì chuyển thành prompt-pack được ngay — ta đã có `video-prompt-scaffold` 7 phần, bổ
sung 104 công thức là làm dày hẳn.

### `Emily2040/seedance-2.0` — đạo diễn theo Ý ĐỒ, không trang trí khung hình
Đọc **chức năng kịch** của cảnh (bước ngoặt, điểm nhìn, quyền lực, hàm ý), chốt **một ý đồ**,
rồi mới suy ra máy quay/ánh sáng/diễn xuất/âm thanh. Tách tài sản tham chiếu theo **vai trò**:
danh tính · chuyển động · bối cảnh.

Đây là tư duy ta thiếu. Prompt của ta mô tả *cái nhìn thấy*; họ mô tả *vì sao cảnh này tồn
tại* rồi để hình ảnh tự suy ra. Tách tham chiếu theo vai trò thì áp thẳng được vào node
`entity_ref`.

### `Alisa0808/vox-director` — mỗi nhịp là một poster hoàn chỉnh
Sinh cấu trúc kể chuyện → keyframe kiểu **cắt dán giấy** → AI làm chuyển động → lồng tiếng →
ghép. Điểm hay: **mỗi nhịp là một poster đã xong**, không phải khung hình dở dang.

Ta đã ghi nguyên tắc này trong skill `video-production` (style-anchor frame). Repo này là bản
hiện thực đầy đủ để đối chiếu.

### `yakhyo/uniface` — phân tích khuôn mặt (MIT, ONNX)
Nhận diện, landmark, hướng nhìn, tư thế đầu, chống giả mạo.

Không vào Flow (Python/ONNX). Nhưng nó giải đúng bài toán ta **đã biết là khó**: giữ nhân vật
nhất quán qua nhiều ảnh. Hiện `character-consistency` của ta làm bằng prompt; có đo khuôn mặt
thì cổng chất lượng mới **kiểm được** thay vì tin lời.
Lưu ý giấy phép: thư viện MIT nhưng **model có giấy phép riêng, có cái GPL-3.0**.

---

## Nhóm C — SKIP với Flow, nhưng thuộc về Video AI V2

Sáu repo cùng một hình dạng: **URL/chủ đề → kịch bản → TTS → render → MP4 dọc**.

| Repo | Vai trò |
|---|---|
| `heygen-com/hyperframes` | **lõi render** — HTML/CSS → MP4 tất định, Chrome headless tua từng khung + FFmpeg. Apache-2.0 |
| `Cuongyd196/auto-video-gen` | URL → video 9:16 trong ~5 phút, TTS tiếng Việt |
| `hoquanghai/Auto-Create-Video` | bài báo Việt → TikTok 1080×1920 |
| `Cuongyd196/auto-compare-video` | video so sánh cặp khái niệm, bố cục 3 vùng |
| `Cuongyd196/remotion-cuongit-template` | mẫu Remotion |
| `Emily2040`, `Alisa0808` | (đã nêu ở nhóm B) |

**HyperFrames là phát hiện đáng giá nhất nhóm này.** Nó tất định — cùng đầu vào cho ra cùng
kết quả — đúng thứ V2 cần để dựng caption, lower-third, chuyển cảnh. Apache-2.0, dùng được.

Ba repo Việt Nam cho thấy **công thức đã chín**: Claude sinh kịch bản JSON → Zod kiểm →
template → TTS → FFmpeg. V2 không cần phát minh lại luồng này.

Nhưng **tất cả đều Node + FFmpeg + Chrome headless** — không nhét vào extension MV3 được. Đây
là lý do V2 phải là sidecar riêng, đúng như kế hoạch đã có.

---

## Nhóm D — không liên quan

- `mrdoob/three.js` — 3D cho web. Chỉ chạm tới nếu làm `img-to-3d`, mà đó là nhánh phụ.
- `toeverything/affine` — thay thế Notion. Không dính.
- `wanshuiyin/Auto-claude-code-research-in-sleep` — agent tự nghiên cứu qua đêm. Hay, nhưng
  là quy trình làm việc cá nhân, không phải tính năng sản phẩm.
- `thaofvn-coca06/2026`, `claude-phong-ban.vercel.app` — chưa đọc được nội dung đủ để xếp.

---

## Đề xuất thứ tự

1. **`book-to-skill`** — nạp prompt/workflow theo yêu cầu. Giải bài toán ta đang gặp thật.
2. **`seedance-2.0`** — tách tham chiếu theo VAI TRÒ, áp vào `entity_ref`. Nhỏ mà đổi chất.
3. **`video-shotcraft`** — 104 công thức cú máy vào prompt-pack. Cơ học, ít rủi ro.
4. **`mattpocock/skills`** — kỷ luật grill-trước-khi-build. Không ra tính năng, nhưng ngăn
   đúng loại lỗi đã tốn ba vòng sửa trong phiên này.

**Không làm** nhóm C trong Flow. Ghi vào kế hoạch V2 và để đó — nhét vào Flow là phá ranh
giới "Flow sinh pixel, V2 dựng phim" mà chính ta đặt ra.
