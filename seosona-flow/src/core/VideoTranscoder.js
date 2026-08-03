// SEOSONA Flow — xử lý video bằng WebCodecs: giải mã → sửa từng khung → mã hoá → đóng gói MP4.
//
// VÌ SAO KHÔNG DÙNG MediaRecorder (đường cũ, nay chỉ còn là đường lùi):
//   · định dạng ra do trình duyệt quyết — KHÔNG ép được MP4, mà TikTok/CapCut không nhận WebM
//   · thiếu `Duration` → file không xem được ngoài Chrome (đã phải viết WebmDuration.js để vá)
//   · chạy THỜI GIAN THỰC: video 10 giây mất đúng 10 giây, vì nó phải PHÁT rồi mới ghi
//   · qua `captureStream` là mất chất lượng thêm một lần
//   · encode lại CẢ TIẾNG — thứ mất mát mà không ai để ý
//
// Ở đây ta đọc gói dữ liệu thẳng từ file, nên nhanh hơn nhiều, không mất chất lượng thừa,
// và ÂM THANH ĐƯỢC CHÉP NGUYÊN GÓI chứ không mã hoá lại.
//
// Chạy được ở CẢ HAI ngữ cảnh — trong Worker (UI không đơ) lẫn ngay trên trang (khi Worker
// hỏng). Vì vậy file này KHÔNG đụng tới DOM: chỉ dùng OffscreenCanvas.
(function (root) {
  'use strict';

  var MAX_INPUT_BYTES = 300 * 1024 * 1024;   // đọc cả file vào RAM; quá cỡ thì báo, đừng treo tab
  var SAMPLE_FRAMES = 12;                    // số khung lấy mẫu để dò vị trí watermark

  function VideoError(code, message) {
    var e = new Error(message || code);
    e.code = code;
    return e;
  }

  function canRun() {
    return typeof root.VideoEncoder === 'function'
      && typeof root.VideoDecoder === 'function'
      && typeof root.OffscreenCanvas === 'function'
      && !!root.Mediabunny;
  }

  /**
   * @param {Blob} blob video đầu vào
   * @param {{onProgress?:Function, isCancelled?:Function, quality?:string}} opt
   * @returns {Promise<{blob:Blob, applied:boolean, reason?:string, stats:object}>}
   */
  async function process(blob, opt) {
    opt = opt || {};
    var onProgress = typeof opt.onProgress === 'function' ? opt.onProgress : function () {};
    var cancelled = typeof opt.isCancelled === 'function' ? opt.isCancelled : function () { return false; };
    var t0 = Date.now();
    var stats = { frames: 0, sampled: 0, ms: 0, mark: null, score: null };

    if (!root.Mediabunny) throw VideoError('NO_MEDIABUNNY', 'lib/mediabunny.min.cjs chưa được nạp');
    if (!root.WatermarkRemover) throw VideoError('NO_CORE', 'WatermarkRemover.js chưa được nạp');
    if (!blob) throw VideoError('NO_INPUT');
    if (blob.size > MAX_INPUT_BYTES) {
      throw VideoError('TOO_LARGE', 'clip ' + (blob.size / 1048576).toFixed(0)
        + ' MB vượt trần ' + (MAX_INPUT_BYTES / 1048576 | 0) + ' MB');
    }

    var MB = root.Mediabunny;
    var input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    var output = null;

    try {
      var vTrack = await input.getPrimaryVideoTrack();
      if (!vTrack) return { blob: blob, applied: false, reason: 'no_video_track', stats: stats };
      if (!await vTrack.canDecode()) throw VideoError('CANNOT_DECODE', 'codec không giải mã được');

      // displayWidth TRƯỚC codedWidth: video có pixel không vuông thì hai số này khác nhau,
      // lấy nhầm là xoá trượt vị trí watermark.
      var W = vTrack.displayWidth != null ? vTrack.displayWidth : vTrack.codedWidth;
      var H = vTrack.displayHeight != null ? vTrack.displayHeight : vTrack.codedHeight;
      var duration = await input.computeDuration();
      if (!(W > 0 && H > 0)) throw VideoError('NO_DIMENSIONS');

      var cv = new root.OffscreenCanvas(W, H);
      var ctx = cv.getContext('2d', { willReadFrequently: true });

      // ── Dò MỘT LẦN trên khung lấy mẫu ────────────────────────────────────
      // Rải đều theo (i+0.5)/N để né CẢ HAI đầu clip: watermark HIỆN DẦN vào đầu (đo được:
      // khung 1 của mẫu Veo 9:16 không dò ra dấu, khung 20 mới ra), và khung cuối cũng mờ đi.
      onProgress({ phase: 'sampling' });
      var sink = new MB.VideoSampleSink(vTrack);
      var stamps = [];
      for (var i = 0; i < SAMPLE_FRAMES; i++) stamps.push(duration * (i + 0.5) / SAMPLE_FRAMES);

      var hit = null;
      for await (var s of sink.samplesAtTimestamps(stamps)) {
        if (!s) continue;
        s.draw(ctx, 0, 0, W, H);
        s.close();                                  // BẮT BUỘC — không đóng là rò bộ nhớ GPU
        stats.sampled++;
        if (!hit) {
          var h = root.WatermarkRemover.detectFlowMark(ctx, W, H);
          if (h) { hit = h; stats.mark = h.id; stats.score = h.score; }
        }
        if (cancelled()) throw VideoError('CANCELLED');
      }
      if (!stats.sampled) throw VideoError('NO_FRAMES', 'không đọc được khung nào');
      if (!hit) {
        stats.ms = Date.now() - t0;
        return { blob: blob, applied: false, reason: 'not_found', stats: stats };
      }

      // ── Xử lý toàn bộ khung rồi đóng gói MP4 ─────────────────────────────
      output = new MB.Output({ format: new MB.Mp4OutputFormat(), target: new MB.BufferTarget() });
      // Codec phải HỎI, không đoán: nguồn HEVC mà ép 'avc' là encoder từ chối cả track.
      var vCodec = await vTrack.getCodec();
      var vSource = new MB.VideoSampleSource({
        codec: vCodec === 'hevc' ? 'hevc' : 'avc',
        bitrate: _bitrate(W, H, opt.quality),
      });
      output.addVideoTrack(vSource);

      // ÂM THANH: chép NGUYÊN GÓI, không mã hoá lại. Đây là điểm hơn hẳn MediaRecorder —
      // nó luôn encode lại cả tiếng, mất chất lượng ở thứ ta không hề cần đụng vào.
      var aTrack = await input.getPrimaryAudioTrack();
      var aSource = null, aSink = null;
      if (aTrack) {
        var aCodec = await aTrack.getCodec();
        if (aCodec) {
          aSource = new MB.EncodedAudioPacketSource(aCodec);
          output.addAudioTrack(aSource);
          aSink = new MB.EncodedPacketSink(aTrack);
        } else {
          console.warn('[VideoTranscoder] không nhận ra codec audio → clip ra sẽ KHÔNG có tiếng');
        }
      }

      await output.start();

      // Mốc thời gian ÂM: MP4 có edit-list hoặc khung B thì khung đầu có thể mang mốc âm.
      // Đưa thẳng vào muxer là nó LẶNG LẼ BỎ hết khung hình — file ra chỉ còn tiếng. Đây
      // đúng lỗi đã gặp. Dịch cả track lên cho mốc nhỏ nhất về 0.
      var tsShift = await _firstShift(vTrack);
      var aShift = await _firstShift(aTrack);

      // Sink lấy mẫu ở trên ĐÃ ĐỌC HẾT — dùng lại là không ra khung nào. Phải tạo sink MỚI.
      var runSink = new MB.VideoSampleSink(vTrack);
      var total = Math.max(1, Math.round(duration * 30));
      for await (var f of runSink.samples()) {
        if (cancelled()) throw VideoError('CANCELLED');
        f.draw(ctx, 0, 0, W, H);
        root.WatermarkRemover.removeFlowMark(ctx, W, H, hit.id, hit.place);
        if (f.timestamp + tsShift < 0) tsShift = -f.timestamp;
        var out = new MB.VideoSample(cv, { timestamp: f.timestamp + tsShift, duration: f.duration });
        await vSource.add(out);
        out.close(); f.close();
        stats.frames++;
        if (stats.frames % 10 === 0) onProgress({ phase: 'encoding', done: stats.frames, ratio: Math.min(1, stats.frames / Math.max(1, total)) });
      }
      if (!stats.frames) throw VideoError('NO_FRAMES_ENCODED', 'không ghi được khung hình nào');

      if (aSink && aSource) {
        for await (var pkt of aSink.packets()) {
          if (cancelled()) throw VideoError('CANCELLED');
          if (aShift) pkt.timestamp += aShift;      // dịch cùng chiều với hình, không lệch tiếng
          await aSource.add(pkt);
        }
      }

      await output.finalize();
      var buf = output.target.buffer;
      if (!buf) throw VideoError('NO_OUTPUT', 'đóng gói xong nhưng không có dữ liệu');
      stats.ms = Date.now() - t0;
      return { blob: new Blob([buf], { type: 'video/mp4' }), applied: true, stats: stats };
    } finally {
      // Dọn kể cả khi ném — bỏ qua là rò bộ nhớ, và với video vài trăm MB thì thấy ngay.
      try { if (output && output.state !== 'finalized') await output.cancel(); } catch (_e) { /* đã đóng */ }
      try { await input.dispose?.(); } catch (_e) { /* không có dispose */ }
    }
  }

  /** Mốc đầu tiên của track; âm thì trả số bù để dịch về 0. Đọc hỏng → 0, không chặn cả việc. */
  async function _firstShift(track) {
    try {
      if (!track || typeof track.getFirstTimestamp !== 'function') return 0;
      var f = await track.getFirstTimestamp();
      return (isFinite(f) && f < 0) ? -f : 0;
    } catch (e) {
      console.warn('[VideoTranscoder] không đọc được mốc đầu:', e && e.message);
      return 0;
    }
  }

  /** Bitrate theo diện tích khung, chặn hai đầu. Quá thấp thì vỡ, quá cao thì file phình vô ích. */
  function _bitrate(w, h, quality) {
    var per = quality === 'high' ? 0.22 : quality === 'low' ? 0.09 : 0.15;
    return Math.min(20000000, Math.max(2500000, Math.round(w * h * 30 * per)));
  }

  root.VideoTranscoder = { process: process, canRun: canRun, MAX_INPUT_BYTES: MAX_INPUT_BYTES, SAMPLE_FRAMES: SAMPLE_FRAMES };
})(typeof self !== 'undefined' ? self : this);
