/* watermark-worker — chạy engine xoá watermark (GWR) trong Web Worker → UI không đơ dù ảnh nền phẳng
   (pipeline có thể mất vài giây). Nhận {imageData, opts} → trả {ok, imageData, meta}. */
/* eslint-disable no-restricted-globals */
try {
  importScripts('../src/core/watermark-alpha-data.js', '../src/core/gwr-bundle.js');
} catch (e) {
  self.postMessage({ ok: false, error: 'IMPORT_FAILED: ' + ((e && e.message) || e) });
}

self.onmessage = function (e) {
  var d = e.data || {};
  if (d.type !== 'process') return;
  try {
    if (!self.GWR || typeof self.GWR.removeWatermarkFromImageDataSync !== 'function') {
      self.postMessage({ ok: false, id: d.id, error: 'ENGINE_UNAVAILABLE' });
      return;
    }
    var gopts = {};
    if (d.opts && d.opts.alphaGain) gopts.alphaGainCandidates = [d.opts.alphaGain];
    var res = self.GWR.removeWatermarkFromImageDataSync(d.imageData, gopts);
    var out = (res && res.imageData) || d.imageData;
    // Trả kèm transfer buffer (tránh copy lần 2).
    // meta || {} (KHÔNG null) — auto mode kiểm truthy meta để quyết GWR-ok vs fallback inpaint;
    // null làm auto fallback nhầm dù GWR alpha đã thành công.
    self.postMessage({ ok: true, id: d.id, imageData: out, meta: (res && res.meta) || {} }, [out.data.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, id: d.id, error: (err && err.message) || String(err) });
  }
};
