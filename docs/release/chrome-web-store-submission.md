# Hồ sơ nộp Chrome Web Store — SEOSONA Flow

Viết ngày 2026-08-04, đối chiếu manifest và mã thật tại thời điểm đó. Mục đích: nộp được, và
nộp mà không bị từ chối vì những thứ đáng lẽ biết trước.

---

## 1. Rủi ro LỚN NHẤT — phải quyết trước khi nộp

### Content script chạy trên MỌI trang web

`manifest.json` khai `http://*/*` và `https://*/*` cho `i2p-content.js` (Image-to-Prompt). Đây
là thứ người duyệt soi kỹ nhất, vì nó cho phép extension đọc DOM của mọi trang người dùng mở —
kể cả ngân hàng, email, hồ sơ y tế.

Google đòi **hai** thứ cho mức quyền này:

1. **Lý do hẹp và cụ thể.** "Để tiện" không được chấp nhận.
2. **Không có cách nào hẹp hơn.** Nếu `activeTab` làm được thì họ sẽ bắt dùng `activeTab`.

Với Image-to-Prompt, `activeTab` **làm được**: người dùng chủ động bấm chuột phải lên một ảnh
→ đó chính là cử chỉ mà `activeTab` cần. Nghĩa là ta đang xin rộng hơn mức cần thiết, và người
duyệt nhiều khả năng sẽ nói đúng như vậy.

**Ba lựa chọn, và hệ quả thật của từng cái:**

| Cách | Được | Mất |
|---|---|---|
| **A. Chuyển sang `activeTab` + `chrome.scripting`** | Khả năng được duyệt cao nhất; hộp quyền lúc cài đỡ đáng sợ | Phải viết lại đường tiêm script; menu chuột phải cần tiêm theo yêu cầu, chậm hơn ~200 ms lần đầu |
| **B. Giữ nguyên, viết giải trình thật kỹ** | Không phải sửa mã | Rủi ro bị từ chối cao; nếu bị hỏi thì mỗi vòng trả lời mất 3–7 ngày |
| **C. Bỏ Image-to-Prompt khỏi bản lên store** | Đơn giản nhất, quyền gọn nhất | Mất một tính năng người dùng đang có |

Khuyến nghị: **A**. Đây là việc kỹ thuật một buổi, và nó đổi hồ sơ từ "rủi ro cao" sang
"bình thường".

---

## 2. Giải trình từng quyền

Ô "Permission justification" trong Developer Dashboard bắt buộc điền cho **từng** quyền. Dưới
đây là bản viết sẵn — ngắn, nêu đúng tính năng, không vòng vo.

| Quyền | Giải trình |
|---|---|
| `activeTab` | Đọc ảnh người dùng vừa bấm chuột phải, để chuyển ảnh đó thành câu lệnh mô tả. |
| `storage` | Lưu câu lệnh mẫu, quy trình (workflow) và tuỳ chọn của người dùng trên máy họ. |
| `unlimitedStorage` | Thư viện quy trình và câu lệnh có thể vượt hạn mức 5 MB mặc định. |
| `sidePanel` | Toàn bộ giao diện của extension nằm ở bảng bên, không chèn vào trang. |
| `scripting` | Điền câu lệnh và bấm nút trên trang của nhà cung cấp AI thay cho người dùng. |
| `tabs` | Tìm đúng tab của nhà cung cấp đang mở để gửi lệnh tới; không đọc lịch sử duyệt. |
| `downloads` | Lưu ảnh/video do người dùng tạo ra, kèm đặt tên theo mẫu họ chọn. |
| `notifications` | Báo khi một loạt tạo ảnh chạy xong hoặc gặp lỗi. |
| `alarms` | Hẹn giờ cho các bước chờ trong quy trình (ví dụ node "Chờ"). |
| `contextMenus` | Thêm mục chuột phải trên ảnh để chuyển ảnh thành câu lệnh. |
| `clipboardWrite` | Chép câu lệnh đã dựng vào bộ nhớ tạm khi người dùng bấm "Sao chép". |

**Host permissions** (`labs.google`, `chatgpt.com`, `gemini.google.com`, `grok.com`,
`claude.ai` + CDN ảnh/video của Google): đây là các trang extension tự động hoá. Không có
quyền này thì không có sản phẩm.

**Data usage disclosure** — khai đúng như sau:

- KHÔNG thu thập gì. Không có máy chủ. Không phân tích hành vi. Không quảng cáo.
- Mọi dữ liệu (câu lệnh, quy trình, ảnh) nằm trong `chrome.storage.local` trên máy người dùng.
- Tuyên bố này **đúng với mã hiện tại**: đường ghi danh thiết bị (enrollment) đã bị chặn ở chế
  độ local, và có `RuntimeNetworkGate` chốt mọi request tới backend (xem SF-001/SF-003).

---

## 3. Việc phải làm trước khi bấm nộp

### Chỉ chủ dự án làm được

- [ ] Tài khoản Chrome Web Store Developer (phí một lần 5 USD).
- [ ] **Chính sách riêng tư đặt ở một URL công khai.** Có sẵn nội dung ở `docs/privacy/README.md`
      nhưng Google đòi đường dẫn web, không nhận file trong repo. Dựng GitHub Pages là đủ.
- [ ] **Ảnh chụp màn hình**: ít nhất 1, kích thước 1280×800 hoặc 640×400. Nên có 4–5:
      bảng bên đang chạy · trình dựng quy trình · kho câu lệnh · thư mục kết quả tải về.
- [ ] Ảnh bìa cửa hàng 440×280 (không bắt buộc nhưng thiếu thì trông nghiệp dư).
- [ ] Chọn hạng mục và ngôn ngữ chính cho trang cửa hàng.

### Việc kỹ thuật còn lại

- [ ] **Quyết SF-010** (mục 1 ở trên) — chặn nộp.
- [ ] **Quyết SF-004**: `onMessageExternal` mở 12 khả năng nhưng manifest không khai
      `externally_connectable` nên chưa từng chạy. Hoặc khai, hoặc gỡ. Để nguyên là mang một
      mặt điều khiển từ xa chết vào bản phát hành.
- [ ] Bỏ `default_locale` trống → thêm nếu muốn trang cửa hàng đa ngôn ngữ. Giao diện hiện
      trộn Việt–Anh; nên chốt một ngôn ngữ chính trước.
- [ ] Sửa bài E2E `local-mode-e2e` (hỏng do thiết kế test, xem mục 6.3 báo cáo audit) rồi đưa
      `npm run verify:release` thành cổng phát hành duy nhất.

---

## 4. Số liệu gói phát hành

| Chỉ số | Giá trị | Ghi chú |
|---|---:|---|
| Số file | 388 | theo `config/package-allowlist.json` |
| Dung lượng | 18,6 MB | dưới xa hạn mức của cửa hàng |
| File nặng nhất | 1,34 MB | `src/workflow/BundledTemplates.js` |
| Mã tải từ máy chủ ngoài | 0 | quan trọng — Google **cấm** remote code ở MV3 |
| Thư viện bên thứ ba | mediabunny (MPL-2.0) | đã kèm `LICENSE` + khai trong SBOM |

Không có remote code là điểm mạnh thật: rất nhiều extension bị từ chối vì nạp script từ CDN.

---

## 5. Vì sao một sản phẩm cùng ngách đã có người dùng còn ta thì chưa

Không phải vì chất lượng mã. Đối chiếu ngày 2026-08-04 cho thấy ở đường tải ta còn đi trước họ
(họ vẫn dính lỗi tự nhảy lên 4K, lỗi đuôi `.htm`, không lọc mục nâng cấp).

Khác biệt nằm ở ba thứ **ngoài mã**:

1. **Họ đã nộp.** Extension chỉ có người dùng khi nó nằm trên cửa hàng. Ta chưa nộp lần nào.
2. **Họ chốt một ngôn ngữ và một câu chuyện.** Trang cửa hàng nói rõ làm được gì cho ai.
3. **Họ có vòng phát hành đều.** Số hiệu bản của họ đi 1.1.x → 1.2.x; ta đứng ở 1.1.37 trong
   khi mã đã đi rất xa.

Việc cần làm để bắt kịp không phải viết thêm tính năng — mà là **đóng gói và nộp**.

---

## 6. Thứ tự đề nghị

1. Quyết SF-010 (quyền mọi trang) — chặn nộp, và quyết định này đổi cả hồ sơ.
2. Quyết SF-004 (gỡ hay khai cầu nối website).
3. Nâng số hiệu bản lên `1.2.0` — mã đã đi xa hơn `1.1.37` rất nhiều.
4. Dựng chính sách riêng tư lên URL công khai.
5. Chụp 4–5 ảnh màn hình.
6. Nộp bản đầu. Vòng duyệt đầu thường 1–3 ngày; bị hỏi lại là chuyện bình thường, không phải thất bại.
