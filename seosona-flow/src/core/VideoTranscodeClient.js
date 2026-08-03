// Lớp gọi bộ chuyển mã video. Dùng CHUNG cho cả hai đường:
//   · tự động  — content_scripts/watermark-inject.js (nút nổi + chặn download)
//   · công cụ  — scripts/watermark-tool.js (tab Tools, người dùng tự upload)
// Một lớp gọi thì sửa một chỗ là cả hai cùng được sửa — bài học từ lỗi MP4 chỉ vá nửa đường.
//
// Ba tầng, tụt dần chứ không gãy:
//   1. Worker  → UI mượt, việc nặng chạy nền
//   2. chạy thẳng trên trang → Worker hỏng thì vẫn ra MP4, chỉ là UI đơ một lúc
//   3. trả null → nơi gọi tự rơi về MediaRecorder (WebM đã vá Duration nên vẫn xem được)
(function (root) {
  'use strict';

  var _worker = null, _broken = false, _seq = 0;
  var _pending = Object.create(null);

  function _spawn() {
    if (_worker || _broken) return _worker;
    try {
      var url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('src/core/video-transcode-worker.js')
        : '../src/core/video-transcode-worker.js';
      _worker = new Worker(url);
      _worker.onmessage = function (e) {
        var m = e.data || {}, job = _pending[m.id];
        if (!job) return;
        if (m.op === 'progress') { job.onProgress(m); return; }
        delete _pending[m.id];
        if (m.op === 'done') job.resolve(m);
        else job.reject(Object.assign(new Error(m.message || m.code), { code: m.code }));
      };
      _worker.onerror = function (err) {
        // Worker chết giữa chừng: đánh dấu hỏng vĩnh viễn rồi cho MỌI việc đang chờ rơi
        // xuống tầng dưới. Bỏ qua là chúng treo mãi mãi.
        console.warn('[VideoTranscode] Worker lỗi → chuyển sang chạy trên trang:', (err && err.message) || err);
        _broken = true;
        try { _worker.terminate(); } catch (_e) { /* đã chết */ }
        _worker = null;
        Object.keys(_pending).forEach(function (k) { var j = _pending[k]; delete _pending[k]; j.fallback(); });
      };
    } catch (e) {
      console.warn('[VideoTranscode] không tạo được Worker:', e && e.message);
      _broken = true; _worker = null;
    }
    return _worker;
  }

  function _inPage(blob, opt) {
    if (!root.VideoTranscoder || !root.VideoTranscoder.canRun()) return null;
    return root.VideoTranscoder.process(blob, opt);
  }

  /**
   * @returns {Promise<{blob:Blob, applied:boolean, reason?:string, stats:object}|null>}
   *          null = máy này không chạy được WebCodecs → nơi gọi tự lo đường lùi.
   */
  async function process(blob, opt) {
    opt = opt || {};
    var onProgress = typeof opt.onProgress === 'function' ? opt.onProgress : function () {};
    var w = _spawn();
    if (!w) return _inPage(blob, opt);

    var id = ++_seq, sentCancel = false;
    var pump = setInterval(function () {
      if (!sentCancel && opt.isCancelled && opt.isCancelled()) {
        sentCancel = true;
        try { w.postMessage({ op: 'cancel', id: id }); } catch (_e) { /* worker đã chết */ }
      }
    }, 250);

    try {
      return await new Promise(function (resolve, reject) {
        _pending[id] = {
          onProgress: onProgress, resolve: resolve, reject: reject,
          // Worker chết → chạy lại trên trang. Người dùng không mất việc, chỉ chờ lâu hơn.
          fallback: function () {
            var p = _inPage(blob, opt);
            if (p) p.then(resolve, reject); else resolve(null);
          },
        };
        try { w.postMessage({ op: 'process', id: id, blob: blob, quality: opt.quality }); }
        catch (e) { delete _pending[id]; reject(e); }
      });
    } finally { clearInterval(pump); }
  }

  /** Máy này có chạy được đường WebCodecs không? Nơi gọi hỏi trước để chọn đường. */
  function available() {
    return !!(root.VideoTranscoder && root.VideoTranscoder.canRun());
  }

  root.VideoTranscodeClient = { process: process, available: available };
})(typeof self !== 'undefined' ? self : this);
