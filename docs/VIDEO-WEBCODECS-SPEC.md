# Đặc tả: chuyển pipeline video sang WebCodecs

Rút từ việc đọc mã sản phẩm cùng ngách bản 1.2.16 (`src/core/VideoWatermarkRemover.js`,
7,8 KB) — không phải suy đoán. Mục đích: phiên sau viết thẳng, không phải khảo sát lại.

## Vì sao bỏ MediaRecorder

`MediaRecorder` sinh ra để **ghi màn hình/webcam trực tiếp**, không phải chuyển mã. Hệ quả
ta đã gặp đủ: định dạng do trình duyệt quyết (không ép được MP4), thiếu `Duration` nên file
không xem được ngoài Chrome, chạy **thời gian thực** (video 10 giây mất 10 giây), và mất
chất lượng thêm một lần qua `captureStream`.

Đối thủ dùng `MediaRecorder` **0 lần** trong toàn bộ extension.

## Chuỗi gọi mediabunny

```js
const { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget,
        VideoSampleSource, EncodedAudioPacketSource, EncodedPacketSink,
        VideoSampleSink } = Mediabunny;

const input  = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
const vTrack = await input.getPrimaryVideoTrack();
if (!vTrack)               → { applied: false, reason: 'no_video_track' }
if (!await vTrack.canDecode()) → lỗi CANNOT_DECODE

const W = vTrack.displayWidth  ?? vTrack.codedWidth;    // displayWidth trước:
const H = vTrack.displayHeight ?? vTrack.codedHeight;   // video có pixel không vuông
const duration = await input.computeDuration();
```

**Dò trước, xử lý sau.** Lấy mẫu 12 khung rải đều rồi mới quyết định, thay vì dò lại từng khung:

```js
const sink = new VideoSampleSink(vTrack);
const stamps = [];
for (let i = 0; i < 12; i++) stamps.push(duration * (i + 0.5) / 12);   // (i+.5) → tránh khung đầu/cuối
for await (const s of sink.samplesAtTimestamps(stamps)) {
  if (!s) continue;
  s.draw(ctx, 0, 0, W, H);
  samples.push(ctx.getImageData(0, 0, W, H));
  s.close();                       // BẮT BUỘC — không đóng là rò bộ nhớ GPU
}
```

Cách `(i + 0.5) / 12` né cả hai đầu clip — trùng phát hiện của ta: watermark **hiện dần**
vào đầu clip, khung 1 của mẫu Veo 9:16 không dò ra dấu mà khung 20 mới ra.

**Xuất:**

```js
const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
// hình: VideoSampleSource — ta vẽ từng khung đã xử lý vào
// tiếng: EncodedAudioPacketSource + EncodedPacketSink → CHÉP THẲNG gói audio, KHÔNG mã hoá lại
```

Chi tiết đáng giá nhất: **audio được sao chép nguyên gói**, không encode lại. Giữ nguyên chất
lượng tiếng và nhanh hơn hẳn. `MediaRecorder` thì luôn encode lại cả tiếng.

## Những quyết định nên bê nguyên

| | Giá trị | Vì sao |
|---|---|---|
| Trần đầu vào | 300 MB | đọc cả file vào RAM; quá cỡ thì báo `TOO_LARGE` chứ đừng làm treo tab |
| Số khung lấy mẫu | 12 | đủ để chọn vị trí neo, không tốn |
| Cảnh báo dò lại | >25% số khung | Flow đổi cách đặt watermark thì biết ngay, không im lặng xoá trượt |
| Mã lỗi | `TOO_LARGE` · `CANNOT_DECODE` · `NO_FRAMES` · `CANCELLED` · `NO_MEDIABUNNY` | mỗi ca một hướng xử lý khác nhau; gộp làm một là mất thông tin |
| Huỷ giữa chừng | kiểm `isCancelled()` trong vòng lặp | video dài chạy vài phút, không cho huỷ là bắt người dùng đóng tab |

Họ còn `estimateGain` mỗi clip và làm mượt biên (`edge_cleanup`) — **ta đã có** thứ tương
đương: hồ sơ alpha đo thật + vá dải biên.

## Kiến trúc phía ta

**Worker CỔ ĐIỂN, không phải module worker.** Worker phải `importScripts()` được
`WatermarkRemover.js` và `FlowWatermarkProfiles.js` — cả hai là IIFE gán vào `self`, không
phải ESM. Module worker thì không có `importScripts`. Nên nạp bản `.cjs` của mediabunny kèm
shim: `var module = { exports: {} }, exports = module.exports;` rồi gán `self.Mediabunny`.

Worker tạo bằng `new Worker(chrome.runtime.getURL(...))` → phải khai vào
`web_accessible_resources`.

Đối thủ có thêm lớp client (`VideoWmClient.js`) với **đường lùi chạy-trên-trang** khi Worker
hỏng. Nên bê: Worker chết thì vẫn xử lý được, chỉ là UI đơ một lúc.

## Phải nối vào CẢ HAI đường

Yêu cầu rõ của chủ dự án: *"vừa auto được vừa là 1 tool rời"*.

- tự động — `content_scripts/watermark-inject.js` (nút nổi + đường chặn download)
- công cụ rời — `scripts/watermark-tool.js` (tab Tools, tự upload)

Test phải kiểm theo **nơi gọi**, không theo một file — đã có bài học: sửa MP4 ở một file,
quên file kia, người dùng nhận file hỏng.

## Giữ MediaRecorder làm đường lùi

Máy không có WebCodecs thì vẫn phải chạy được. Bản vá `src/core/WebmDuration.js` (11 test)
làm đường lùi đó ra file xem và tua được, nên không còn là đường cụt.

## Giấy phép

mediabunny là **MPL-2.0**, không phải MIT. Copyleft mức file: dùng trong sản phẩm lớn hơn
thì được, nhưng sửa file của thư viện thì phải công bố phần sửa, và phải kèm thông báo giấy
phép. Repo public nên phải làm đúng — giữ nguyên file, chép `LICENSE`, khai vào SBOM và
baseline `security:vendored` (đang khoá đúng 3 file).

Bản dựng: `node_modules/mediabunny/dist/bundles/mediabunny.min.cjs` (635 KB) — đã cài sẵn.
