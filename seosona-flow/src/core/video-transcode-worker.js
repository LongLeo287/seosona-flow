// Worker CỔ ĐIỂN (không phải module worker) — vì phải importScripts() được các module IIFE
// của ta; module worker thì KHÔNG có importScripts.
//
// mediabunny đóng gói kiểu CommonJS nên cần shim `module`/`exports` trước khi nạp, rồi gán
// vào self để VideoTranscoder tìm thấy. Nạp trong Worker để UI không đơ suốt lúc encode.
self.module = { exports: {} };
self.exports = self.module.exports;
importScripts('../../lib/mediabunny.min.cjs');
self.Mediabunny = self.module.exports;

importScripts('FlowWatermarkProfiles.js', 'WatermarkRemover.js', 'VideoTranscoder.js');

var _cancelled = Object.create(null);

self.onmessage = async function (e) {
  var m = e.data || {};
  if (m.op === 'cancel') { _cancelled[m.id] = true; return; }
  if (m.op !== 'process') return;
  var id = m.id;
  try {
    var r = await self.VideoTranscoder.process(m.blob, {
      quality: m.quality,
      isCancelled: function () { return !!_cancelled[id]; },
      onProgress: function (p) { self.postMessage({ op: 'progress', id: id, phase: p.phase, ratio: p.ratio, done: p.done }); },
    });
    self.postMessage({ op: 'done', id: id, blob: r.blob, applied: r.applied, reason: r.reason, stats: r.stats });
  } catch (err) {
    // Gửi MÃ lỗi ra ngoài, không chỉ câu chữ — mỗi mã một hướng xử lý khác nhau ở phía gọi.
    self.postMessage({ op: 'error', id: id, code: (err && err.code) || 'UNKNOWN', message: (err && err.message) || String(err) });
  } finally { delete _cancelled[id]; }
};
