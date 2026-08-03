/**
 * VideoFrameExtractor — VIDEO_NODE_LAST_FRAME_OUTPUT_PLAN Phase 4.
 *
 * Trích frame CUỐI của 1 video (URL CDN) → base64 JPEG, để làm output ảnh thứ 2 của node video
 * (nối tiếp video). Chạy ở PAGE context (sidebar.html / workflow-editor.html — cần document cho
 * <video>/<canvas>).
 *
 * Vì sao KHÔNG load thẳng CDN URL vào <video crossOrigin>:
 *   - Video Flow trên CDN Google KHÔNG gửi CORS header ổn định → canvas bị "tainted" → toBlob throw.
 *   - Giải pháp: background `fetchMedia` fetch bytes (bypass CORS qua host_permissions) → data URL →
 *     Blob → blob: URL (same-origin) → canvas KHÔNG taint → toBlob OK.
 *
 * v1: provider='flow' (fetchMedia chung). provider='grok' (v2) sẽ route qua grok:fetchMedia.
 */
(function () {
  'use strict';

  const DEFAULTS = {
    maxEdge: 1280,        // downscale cạnh dài → base64 nhỏ (< 12MB cap uploadToFlow)
    quality: 0.9,         // JPEG quality
    loadTimeoutMs: 20000, // chờ load metadata + seek + decode
    seekEpsilon: 0.04,    // seek `duration - epsilon` (seek đúng duration → Chrome trả frame đen/không bắn seeked)
  };

  class VideoFrameExtractor {
    /**
     * @param {string} videoUrl - URL video CDN
     * @param {{maxEdge?:number, quality?:number, provider?:string}} [opts]
     * @returns {Promise<{base64:string, width:number, height:number}>} — throw nếu fail.
     */
    static async extractLastFrame(videoUrl, opts = {}) {
      const cfg = { ...DEFAULTS, ...opts };
      if (!videoUrl || typeof videoUrl !== 'string') throw new Error('VideoFrameExtractor: videoUrl rỗng');

      // 1) Lấy video blob (same-origin blob: → canvas không taint).
      const blob = await this._fetchVideoBlob(videoUrl, cfg.provider || 'flow', cfg.tabId || null);
      if (!blob) throw new Error('VideoFrameExtractor: không tải được video (fetch page + SW đều fail)');
      if (!/^video\//.test(blob.type || '')) throw new Error('VideoFrameExtractor: blob không phải video (' + (blob.type || 'unknown') + ')');
      const objUrl = URL.createObjectURL(blob);

      try {
        return await this._grabLastFrame(objUrl, cfg);
      } finally {
        try { URL.revokeObjectURL(objUrl); } catch (_) { /* ignore */ }
      }
    }

    /**
     * Lấy video blob. Flow: fetch TRỰC TIẾP trong page (workflow-editor là chrome-extension:// page có
     * host_permissions cho labs.google → bypass CORS, KHÔNG giới hạn 25MB như SW fetchMedia + không qua
     * base64 message). Fallback SW fetchMedia. Grok: SW grok:fetchMedia (x.ai CORS gắt cần tab-inject).
     * @returns {Promise<Blob|null>}
     */
    static async _fetchVideoBlob(videoUrl, provider, tabId) {
      // Flow: page fetch trực tiếp (nhanh + không cap). Grok bỏ qua (URL x.ai cần SW credentials/tab-inject).
      if (provider !== 'grok') {
        try {
          const resp = await fetch(videoUrl, { credentials: 'include', cache: 'no-store' });
          if (resp.ok) {
            const blob = await resp.blob();
            if (blob && /^video\//.test(blob.type || '')) return blob;
          }
        } catch (_) { /* CORS/network fail → fallback SW */ }
      }
      // Fallback: SW fetch (base64 data URL, cap 25MB) → blob
      const dataUrl = await this._fetchVideoDataUrl(videoUrl, provider, tabId);
      if (!dataUrl || !dataUrl.startsWith('data:')) return null;
      try { return await (await fetch(dataUrl)).blob(); } catch (_) { return null; }
    }

    /** Gọi background fetchMedia (flow) hoặc grok:fetchMedia (grok). @returns {Promise<string|null>} data URL */
    static async _fetchVideoDataUrl(videoUrl, provider, tabId) {
      // Grok: grok:fetchMedia (SW fetch credentials:include + tab-inject fallback cho x.ai CORS gắt).
      // tabId (từ result_provider_urls[fid].tab_id) cần cho tab-inject fallback khi SW fetch fail.
      const message = provider === 'grok'
        ? { action: 'grok:fetchMedia', url: videoUrl, tabId: tabId || null }
        : { type: 'fetchMedia', urls: [videoUrl] };
      const resp = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(message, (r) => { void chrome.runtime.lastError; resolve(r || null); });
        } catch (_) { resolve(null); }
      });
      if (!resp) return null;
      // fetchMedia chung: { ok, results: { [url]: dataUrl } }
      if (resp.results && typeof resp.results === 'object') return resp.results[videoUrl] || null;
      // grok:fetchMedia: { success, base64: 'data:<mime>;base64,...', mime } — base64 ĐÃ là full data URL.
      if (resp.base64 && String(resp.base64).startsWith('data:')) return resp.base64;
      if (resp.dataUrl) return resp.dataUrl;
      return null;
    }

    /**
     * Nạp blob URL vào <video> ẩn → seek gần cuối → vẽ canvas → base64 JPEG.
     * @returns {Promise<{base64:string, width:number, height:number}>}
     */
    static _grabLastFrame(objUrl, cfg) {
      return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.crossOrigin = 'anonymous'; // blob: same-origin, không ảnh hưởng — giữ cho nhất quán
        // Append DOM (ẩn offscreen) — decode/seek off-DOM flaky ở 1 số Chrome; in-DOM ổn định hơn.
        // opacity:0 + offscreen fixed → không flash. cleanup() remove sau khi xong.
        video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';

        let done = false;
        const timer = setTimeout(() => finish(new Error('VideoFrameExtractor: timeout ' + cfg.loadTimeoutMs + 'ms (load/seek/decode)')), cfg.loadTimeoutMs);

        const cleanup = () => {
          clearTimeout(timer);
          try { video.removeAttribute('src'); video.load(); } catch (_) { /* ignore */ }
          try { if (video.parentNode) video.parentNode.removeChild(video); } catch (_) { /* ignore */ }
        };
        const finish = (err, out) => {
          if (done) return; done = true;
          cleanup();
          err ? reject(err) : resolve(out);
        };

        const draw = () => {
          try {
            const vw = video.videoWidth, vh = video.videoHeight;
            if (!vw || !vh) return finish(new Error('VideoFrameExtractor: videoWidth/Height = 0 (decode fail)'));
            const scale = Math.min(1, cfg.maxEdge / Math.max(vw, vh));
            const w = Math.max(1, Math.round(vw * scale));
            const h = Math.max(1, Math.round(vh * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, w, h);
            const base64 = canvas.toDataURL('image/jpeg', cfg.quality); // throw SecurityError nếu tainted (không xảy ra với blob:)
            if (!base64 || base64.length < 32) return finish(new Error('VideoFrameExtractor: toDataURL rỗng'));
            finish(null, { base64, width: w, height: h });
          } catch (e) {
            finish(new Error('VideoFrameExtractor: draw/toDataURL fail — ' + (e && e.message || e)));
          }
        };

        video.addEventListener('error', () => finish(new Error('VideoFrameExtractor: <video> error (' + (video.error?.code || '?') + ')')), { once: true });

        // Seek tới gần cuối sau khi biết duration, chờ 'seeked' rồi vẽ.
        let seeked = false;
        video.addEventListener('loadedmetadata', () => {
          const dur = Number(video.duration);
          if (!Number.isFinite(dur) || dur <= 0) {
            // Duration không xác định (stream) → thử vẽ frame hiện tại sau canplay
            return;
          }
          const target = Math.max(0, dur - cfg.seekEpsilon);
          try { video.currentTime = target; } catch (_) { /* seeked handler / canplay fallback */ }
        }, { once: true });

        video.addEventListener('seeked', () => { seeked = true; draw(); }, { once: true });

        // Fallback: video không seek được (duration NaN) → vẽ frame khi có đủ data.
        video.addEventListener('canplaythrough', () => { if (!seeked) draw(); }, { once: true });

        try { (document.body || document.documentElement).appendChild(video); } catch (_) { /* off-DOM fallback */ }
        video.src = objUrl;
        try { video.load(); } catch (_) { /* ignore */ }
      });
    }
  }

  window.VideoFrameExtractor = VideoFrameExtractor;
})();
