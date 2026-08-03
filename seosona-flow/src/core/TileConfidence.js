/**
 * TileConfidence — chấm "tile đã sinh xong / sẵn sàng" bằng MULTI-SIGNAL weighted → verdict 3-state
 * (found / maybe / none) thay 1 selector giòn. Học pattern Aliens_eye (logistic-ish confidence).
 *
 * Vì sao: DOM web-UI (Flow/ChatGPT/Grok) đổi luôn → 1 selector cứng dễ false-negative. Gộp nhiều tín
 * hiệu (có element, có ảnh src, status=complete, không spinner, có tile-id...) mỗi cái 1 trọng số →
 * điểm 0-1 → verdict. Pure + testable; TileMonitor cấp signals thật từ DOM.
 *
 * API (thuần):
 *   TileConfidence.score(signals, weights, opts) -> { score, verdict }
 *   TileConfidence.tileReady(signals, opts) -> { score, verdict }   // weights mặc định cho tile-ready
 */
(function (root) {
  'use strict';

  // Trọng số mặc định cho "tile sẵn sàng". Dương = tín hiệu tốt; âm = tín hiệu xấu (spinner/lỗi).
  var DEFAULT_WEIGHTS = {
    hasElement: 1.5,      // có phần tử tile trong DOM
    hasImageSrc: 2.5,     // <img> có src thật (không placeholder)
    statusComplete: 2.0,  // status/aria = complete/done
    hasTileId: 1.0,       // có data-tile-id
    notLoading: 1.5,      // KHÔNG còn spinner/skeleton
    notError: 1.0,        // KHÔNG có dấu lỗi
    hasDownloadBtn: 1.0,  // nút tải xuất hiện (thường sau khi xong)
  };

  // signals: { name: bool | 0..1 }. Bỏ qua signal không có trong weights.
  function score(signals, weights, opts) {
    signals = signals || {};
    weights = weights || DEFAULT_WEIGHTS;
    opts = opts || {};
    var totalPos = 0, sum = 0;
    for (var k in weights) {
      if (!Object.prototype.hasOwnProperty.call(weights, k)) continue;
      var w = weights[k];
      if (w > 0) totalPos += w; // chuẩn hoá theo tổng trọng số DƯƠNG
      var v = signals[k];
      if (v === undefined || v === null || v === false) continue;
      var val = v === true ? 1 : Number(v) || 0;
      sum += w * val; // signal xấu (w<0) trừ điểm
    }
    var s = totalPos > 0 ? sum / totalPos : 0;
    s = Math.max(0, Math.min(1, s));
    var foundAt = opts.foundAt != null ? opts.foundAt : 0.7;
    var maybeAt = opts.maybeAt != null ? opts.maybeAt : 0.4;
    var verdict = s >= foundAt ? 'found' : (s >= maybeAt ? 'maybe' : 'none');
    return { score: Math.round(s * 1000) / 1000, verdict: verdict };
  }

  function tileReady(signals, opts) { return score(signals, DEFAULT_WEIGHTS, opts); }

  root.TileConfidence = { score: score, tileReady: tileReady, DEFAULT_WEIGHTS: DEFAULT_WEIGHTS };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
