/**
 * i2p-content.js — Image-to-Prompt (Provider mode)
 * Chuột phải ảnh / hover nút / chọn vùng → capture → Shadow DOM card (glass, draggable) →
 * phân tích bằng ChatGPT/Gemini user đã login (qua background → provider tab) → prompt EN/VI/JSON.
 * Server-only: template + default provider từ background (i2p:getConfig). UI labels: local theo af_locale.
 */
(function () {
  'use strict';
  // L2: chỉ chạy ở top-frame — right-click-on-image hoạt động ở top frame, không cần sub-frame.
  if (window.top !== window) return;
  if (window.__seosonaflowI2pLoaded__) return;
  window.__seosonaflowI2pLoaded__ = true;

  // Nuốt "Extension context invalidated" khi extension reload (content script cũ, vô hại).
  (function () {
    var RE = /context (was )?invalidated|Extension context/i;
    try {
      window.addEventListener('error', function (e) {
        var m = (e && (e.message || (e.error && e.error.message))) || '';
        if (RE.test(String(m))) { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); return false; }
      }, true);
      window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason; var m = (r && (r.message || r)) || '';
        if (RE.test(String(m))) { e.preventDefault(); }
      });
    } catch (_) { globalThis.SEOSONA_swallow?.('i2p-content', _); }
  })();

  // Escape HTML trước khi nhồi vào innerHTML (khớp content.js:_escHtml / floating-tracker-rich.js:escHtml).
  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const ROOT_ID = 'seosonaflow-i2p-root';
  const GREEN = '#19d07b';
  const HIST_KEY = 'i2p_history';
  const HIST_MAX = 20;

  // ---- i18n (local theo af_locale) ----
  let _locale = 'vi';
  try { chrome.storage?.local?.get(['af_locale'], (r) => { if (r?.af_locale) _locale = r.af_locale; }); } catch (_) { globalThis.SEOSONA_swallow?.('i2p-content#escHtml', _); }
  const _T = {
    vi: { title: 'Prompt từ ảnh', analyzeBy: 'Phân tích bằng:', analyze: 'Phân tích', analyzing: 'AI đang đọc ảnh', note: 'có thể mất 10–30 giây',
      capturing: 'Đang lấy ảnh...', openTab: 'Mở tab đăng nhập', copy: 'Copy', copied: 'Đã copy', genFlow: 'Đưa vào SEOSONA Flow',
      sending: 'Đang gửi...', sentFlow: 'Đã đưa vào SEOSONA Flow', genNode: 'Gửi vào node', sentNode: 'Đã gửi — mở Workflow editor', cancel: 'Hủy', close: 'Đóng', reanalyze: 'Phân tích lại', history: 'Lịch sử', noHistory: 'Chưa có lịch sử', back: 'Quay lại', clearAll: 'Xoá tất cả', deleteOne: 'Xoá', sendGen: 'Gửi ảnh sang tab Tạo (ảnh tham chiếu)',
      tabVi: 'Tiếng Việt', tabEn: 'English', tabJson: 'JSON', notLogged: 'chưa đăng nhập', noTab: 'chưa mở tab', waitingLogin: '— đang chờ đăng nhập...',
      viReadHint: 'Bản tiếng Việt chi tiết để đọc hiểu — tiếng Việt gen ảnh kém, nên gen bằng tab JSON hoặc English.',
      errCapture: 'Không lấy được ảnh (CORS). Thử ảnh khác.', errConfig: 'Chưa tải được cấu hình từ server.',
      errProvider: 'Provider chưa sẵn sàng / chưa đăng nhập.', retry: 'Thử lại', regionHint: 'Kéo chọn vùng để phân tích · Esc để hủy',
      uploadImg: 'Tải ảnh từ máy', changeImg: 'Đổi ảnh', uploadHint: 'Tải một ảnh từ máy để phân tích thành prompt.', retrying: 'Lỗi tạm thời — đang thử lại...',
      errTimeout: 'AI trả lời quá lâu, đã hết thời gian chờ. Thử lại.', errUpload: 'Không tải được ảnh lên provider. Thử lại.', errNoResp: 'AI không phản hồi. Thử lại.',
      gateLogin: 'Đăng nhập SEOSONA Flow để dùng Prompt từ ảnh.', gateUpgrade: 'Nâng cấp gói để dùng Prompt từ ảnh.', login: 'Đăng nhập', upgrade: 'Nâng cấp' },
    en: { title: 'Prompt from image', analyzeBy: 'Analyze with:', analyze: 'Analyze', analyzing: 'AI is reading image', note: 'may take 10–30s',
      capturing: 'Capturing image...', openTab: 'Open login tab', copy: 'Copy', copied: 'Copied', genFlow: 'Send to SEOSONA Flow',
      sending: 'Sending...', sentFlow: 'Sent to SEOSONA Flow', genNode: 'Send to node', sentNode: 'Sent — open Workflow editor', cancel: 'Cancel', close: 'Close', reanalyze: 'Re-analyze', history: 'History', noHistory: 'No history yet', back: 'Back', clearAll: 'Clear all', deleteOne: 'Delete', sendGen: 'Send image → Generate (reference)',
      tabVi: 'Vietnamese', tabEn: 'English', tabJson: 'JSON', notLogged: 'not signed in', noTab: 'no tab open', waitingLogin: '— waiting for sign-in...',
      viReadHint: 'Detailed Vietnamese for reading — Vietnamese generates poorly, use the JSON or English tab to generate.',
      errCapture: 'Could not read image (CORS). Try another.', errConfig: 'Could not load server config.',
      errProvider: 'Provider not ready / not signed in.', retry: 'Retry', regionHint: 'Drag to select an area · Esc to cancel',
      uploadImg: 'Upload from device', changeImg: 'Change image', uploadHint: 'Upload an image from your device to turn into a prompt.', retrying: 'Transient error — retrying...',
      errTimeout: 'AI took too long to reply, timed out. Try again.', errUpload: 'Could not upload the image to the provider. Try again.', errNoResp: 'AI did not respond. Try again.',
      gateLogin: 'Sign in to SEOSONA Flow to use Image to Prompt.', gateUpgrade: 'Upgrade your plan to use Image to Prompt.', login: 'Sign in', upgrade: 'Upgrade' },


  };
  function t(k) { return (_T[_locale] && _T[_locale][k]) || _T.vi[k] || _T.en[k] || k; }

  function bg(msg) {
    return new Promise((resolve) => {
      try { chrome.runtime.sendMessage(msg, (r) => { resolve(chrome.runtime.lastError ? null : r); }); }
      catch (_) { resolve(null); }
    });
  }
  function stripFences(s) { return (s || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim(); }
  // JSON bị cắt giữa chừng (response model truncate) → JSON.parse fail. Salvage: trích các field string
  // best-effort qua regex để tab EN/VI vẫn dùng được thay vì hiện raw thô. Null nếu không vớt được gì.
  function salvageParse(raw) {
    if (!raw) return null;
    const out = {};
    const grab = (key) => {
      const m = raw.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)'));
      if (!m) return;
      let v = m[1].replace(/\\?"?$/, ''); // bỏ dấu " treo / backslash cụt ở cuối khi bị cắt
      try { v = JSON.parse('"' + v + '"'); } catch (_) { v = v.replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
      out[key] = v;
    };
    ['recreation_prompt_en', 'recreation_prompt_vi', 'subject'].forEach(grab);
    return out.recreation_prompt_en || out.recreation_prompt_vi ? out : null;
  }

  // ---- vị trí chuột phải (mở card bên phải con trỏ) + ảnh vừa phải-chuột (U5: lấy URL GỐC) ----
  let _lastCtx = null;
  let _lastImgEl = null;
  let _lastCtxImgUrl = null; // URL ảnh TẠI con trỏ (kể cả img bị <a>/overlay che, hoặc background-image)
  document.addEventListener('contextmenu', (e) => {
    _lastCtx = { x: e.clientX, y: e.clientY };
    _lastImgEl = null; _lastCtxImgUrl = null;
    try {
      const t = e.target;
      if (t && t.tagName === 'IMG') { _lastImgEl = t; _lastCtxImgUrl = t.currentSrc || t.src; }
      // Ảnh bị overlay/link che → quét stack element tại điểm chuột tìm <img> hoặc background-image.
      if (!_lastCtxImgUrl && document.elementsFromPoint) {
        const stack = document.elementsFromPoint(e.clientX, e.clientY) || [];
        for (const el of stack) {
          if (el.tagName === 'IMG' && (el.currentSrc || el.src)) { _lastImgEl = el; _lastCtxImgUrl = el.currentSrc || el.src; break; }
          const bg = getComputedStyle(el).backgroundImage || '';
          const m = /url\(["']?(https?:[^"')]+)["']?\)/i.exec(bg);
          if (m) { _lastCtxImgUrl = m[1]; break; }
        }
      }
      if (!_lastCtxImgUrl && t && t.querySelector) { const im = t.querySelector('img'); if (im) { _lastImgEl = im; _lastCtxImgUrl = im.currentSrc || im.src; } }
    } catch (_) { globalThis.SEOSONA_swallow?.('i2p-content#grab', _); }
  }, true);

  // [U5] Resolve URL ảnh gốc do BACKGROUND lo (executeScript, 1 nguồn duy nhất — tránh lệch logic).
  // Content script chỉ báo URL ảnh THÔ tại con trỏ (_lastCtxImgUrl).

  // ---- capture ảnh từ URL → {base64,name,type} | null ----
  async function captureImage(srcUrl, maxPx) {
    const draw = (imgLike) => {
      const w = imgLike.naturalWidth || imgLike.width, h = imgLike.naturalHeight || imgLike.height;
      if (!w || !h) return null;
      const scale = Math.min(1, maxPx / Math.max(w, h));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * scale)); cv.height = Math.max(1, Math.round(h * scale));
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); // nền trắng (JPEG không alpha)
      ctx.drawImage(imgLike, 0, 0, cv.width, cv.height);
      // JPEG thay PNG: ảnh photo PNG nặng → upload paste/file ChatGPT/Gemini attach không kịp → submit text-only.
      return cv.toDataURL('image/jpeg', 0.85).split(',')[1]; // throws nếu tainted
    };
    let b64 = await new Promise((resolve) => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => { try { resolve(draw(im)); } catch (_) { resolve(null); } };
      im.onerror = () => resolve(null); im.src = srcUrl;
      setTimeout(() => resolve(null), 8000);
    });
    if (!b64) {
      const el = Array.from(document.images).find(i => i.currentSrc === srcUrl || i.src === srcUrl);
      if (el && el.complete) { try { b64 = draw(el); } catch (_) { globalThis.SEOSONA_swallow?.('i2p-content#onerror', _); } }
    }
    if (!b64) {
      try {
        const resp = await fetch(srcUrl, { mode: 'cors' });
        if (resp.ok) { const blob = await resp.blob(); const url = URL.createObjectURL(blob);
          const im = await new Promise((res) => { const x = new Image(); x.onload = () => res(x); x.onerror = () => res(null); x.src = url; });
          if (im) { try { b64 = draw(im); } catch (_) { globalThis.SEOSONA_swallow?.('i2p-content#onerror', _); } } URL.revokeObjectURL(url); }
      } catch (_) { globalThis.SEOSONA_swallow?.('i2p-content#onerror', _); }
    }
    if (b64) return { base64: b64, name: 'i2p.jpg', type: 'image/jpeg' };
    const bgR = await bg({ action: 'i2p:fetchImage', srcUrl, maxPx }); // host <all_urls> bỏ qua CORS
    return (bgR?.ok && bgR.image?.base64) ? bgR.image : null;
  }

  // ---- local file (upload từ máy) → {base64,name,type} | null ----
  // Không CORS (file cùng origin blob), luôn vẽ được lên canvas → downscale + JPEG như captureImage.
  function fileToImage(file, maxPx) {
    return new Promise((resolve) => {
      if (!file || !/^image\//.test(file.type || '')) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const im = new Image();
        im.onload = () => {
          try {
            const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
            if (!w || !h) { resolve(null); return; }
            const scale = Math.min(1, maxPx / Math.max(w, h));
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(w * scale)); cv.height = Math.max(1, Math.round(h * scale));
            const ctx = cv.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.drawImage(im, 0, 0, cv.width, cv.height);
            resolve({ base64: cv.toDataURL('image/jpeg', 0.85).split(',')[1], name: file.name || 'upload.jpg', type: 'image/jpeg' });
          } catch (_) { resolve(null); }
        };
        im.onerror = () => resolve(null);
        im.src = reader.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }
  // Mở file picker (phải gọi trong user-gesture của click) → nạp ảnh vào state → tự phân tích nếu provider ready.
  function pickLocalFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; inp.remove();
      if (!f) return;
      const tok = _token;
      if (_state) { _state.phase = 'capturing'; const b = bodyEl(); if (b) paintBody(b); }
      const img = await fileToImage(f, (_state && _state.maxPx) || 1536);
      if (tok !== _token || !_state) return;
      if (!img) { _state.phase = 'error'; _state.error = t('errCapture'); render(); return; }
      _state.image = img; _state._retried = false; _state.phase = 'idle'; render();
      const cur = _state.status && _state.status[_state.provider];
      if (cur && cur.ready) doAnalyze(); // provider sẵn sàng → chạy luôn
    });
    document.documentElement.appendChild(inp); inp.click();
  }

  // Thumb nhỏ (~96px) để lưu history gọn (tránh nhồi ảnh 1536px × 20 vào storage).
  function makeThumb(base64, type) {
    return new Promise((resolve) => {
      try {
        const im = new Image();
        im.onload = () => {
          try {
            const sz = 96, scale = Math.min(1, sz / Math.max(im.width, im.height));
            const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(im.width * scale)); cv.height = Math.max(1, Math.round(im.height * scale));
            cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
            resolve(cv.toDataURL('image/jpeg', 0.7));
          } catch (_) { resolve(''); }
        };
        im.onerror = () => resolve('');
        im.src = 'data:' + (type || 'image/jpeg') + ';base64,' + base64;
      } catch (_) { resolve(''); }
    });
  }

  // ---- History (chrome.storage.local) ----
  async function histLoad() { try { const r = await chrome.storage.local.get([HIST_KEY]); return Array.isArray(r[HIST_KEY]) ? r[HIST_KEY] : []; } catch (_) { return []; } }
  async function histAdd(entry) {
    try { const list = await histLoad(); list.unshift(entry); if (list.length > HIST_MAX) list.length = HIST_MAX; await chrome.storage.local.set({ [HIST_KEY]: list }); } catch (_) { globalThis.SEOSONA_swallow?.('i2p-content#histAdd', _); }
  }
  async function histClear() { try { await chrome.storage.local.set({ [HIST_KEY]: [] }); } catch (_) { globalThis.SEOSONA_swallow?.('i2p-content#histClear', _); } }
  async function histRemove(ts) { try { const list = await histLoad(); await chrome.storage.local.set({ [HIST_KEY]: list.filter((x) => x.ts !== ts) }); } catch (_) { globalThis.SEOSONA_swallow?.('i2p-content#histRemove', _); } }

  // ---- state + Shadow DOM ----
  let _shadow = null, _state = null, _token = 0, _statusPoll = null;
  function stopStatusPoll() { if (_statusPoll) { clearInterval(_statusPoll); _statusPoll = null; } }

  function ensureRoot() {
    let host = document.getElementById(ROOT_ID);
    if (host && host.shadowRoot) { _shadow = host.shadowRoot; return _shadow; }
    if (host) host.remove();
    host = document.createElement('div'); host.id = ROOT_ID;
    document.documentElement.appendChild(host);
    _shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .card { position: fixed; top: 72px; left: 50%; transform: translateX(-50%); width: 384px; max-width: 92vw; max-height: 86vh; overflow: hidden; color:#fff; border-radius:18px;
        border:1px solid rgba(239,246,255,0.38);
        background: linear-gradient(180deg, rgba(18,22,30,0.38), rgba(4,7,12,0.47)), linear-gradient(180deg, rgba(255,255,255,0.136), rgba(255,255,255,0.036));
        box-shadow:0 26px 62px rgba(0,0,0,0.21), 0 11px 26px rgba(0,0,0,0.13), inset 0 1px 0 rgba(255,255,255,0.43), inset 0 -1px 0 rgba(255,255,255,0.07);
        -webkit-backdrop-filter: blur(22px) saturate(1.2) contrast(1.04); backdrop-filter: blur(22px) saturate(1.2) contrast(1.04);
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; display:flex; flex-direction:column; z-index:2147483647; }
      .hd { display:flex; align-items:flex-start; gap:10px; padding:14px 16px 8px; cursor:grab; user-select:none; }
      .hd:active { cursor:grabbing; }
      .hd .thumb { width:38px; height:38px; object-fit:cover; border-radius:8px; flex-shrink:0; border:1px solid rgba(255,255,255,0.2); }
      .hd .tt { flex:1; min-width:0; }
      .hd .lbl { font-size:10px; letter-spacing:0.09em; text-transform:uppercase; color:rgba(255,255,255,0.45); font-weight:600; }
      .hd .title { font-size:17px; font-weight:700; margin-top:2px; line-height:1.2; }
      .hd .acts { display:flex; gap:6px; flex-shrink:0; }
      .ic { cursor:pointer; width:26px; height:26px; border:none; background:rgba(255,255,255,0.1); color:#fff; border-radius:8px; font-size:14px; line-height:1; display:flex; align-items:center; justify-content:center; transition:background 0.12s; }
      .ic:hover { background:rgba(255,255,255,0.22); }
      .body { padding:6px 16px 16px; overflow:auto; font-size:13px; }
      .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
      .pv { display:flex; align-items:center; gap:6px; padding:6px 10px; border:1px solid rgba(255,255,255,0.15); border-radius:9px; cursor:pointer; background:rgba(255,255,255,0.06); transition:background 0.12s, border-color 0.12s; }
      .pv:hover { border-color:rgba(255,255,255,0.32); background:rgba(255,255,255,0.11); }
      .pv.sel { border-color:${GREEN}; background:rgba(25, 208, 123,0.16); color:#fff; }
      .dot { width:8px; height:8px; border-radius:50%; background:#888; flex-shrink:0; }
      .dot.on { background:${GREEN}; box-shadow:0 0 6px rgba(25, 208, 123,0.85); }
      .dot.warn { background:#f59e0b; box-shadow:0 0 6px rgba(245,158,11,0.7); }
      .muted { color:rgba(255,255,255,0.5); font-size:11px; }
      /* Base primary button — share bởi primary-btn + 2 nút action chuyên biệt (gen-prompt / send-flow). */
      .primary-btn, .gen-prompt-btn, .send-flow-btn { padding:6px 14px; border:none; border-radius:9px; background: linear-gradient(90deg, #3d6ff5 0%, #6b93f8 100%) !important; color: #292929; font-weight:600; cursor:pointer; font-size:13px; display:inline-flex; align-items:center; gap:6px; transition:filter 0.12s, box-shadow 0.12s; }
      .primary-btn:hover:not(:disabled), .gen-prompt-btn:hover:not(:disabled), .send-flow-btn:hover:not(:disabled) { filter:brightness(1.08); box-shadow:0 4px 14px rgba(61, 111, 245,0.35); }
      .primary-btn:active:not(:disabled), .gen-prompt-btn:active:not(:disabled), .send-flow-btn:active:not(:disabled) { filter:brightness(0.96); }
      .primary-btn:disabled, .gen-prompt-btn:disabled, .send-flow-btn:disabled { opacity:0.5; cursor:not-allowed; }
      /* Hook riêng để custom độc lập (override base ở đây nếu cần). */
      .gen-prompt-btn {}
      .send-flow-btn {}
      /* Login button (glass) — fallback --panel-ui-scale=1 vì biến này chỉ có ở sidebar, ko có trong Shadow DOM i2p card. */
      .login-btn { width:100%; min-width:0; min-height:calc(48px * var(--panel-ui-scale, 1)); padding-inline:calc(28px * var(--panel-ui-scale, 1)); color:rgba(14,18,24,0.94); background:linear-gradient(180deg, rgba(255,255,255,0.96), rgba(241,244,248,0.92)); border:1px solid rgba(255,255,255,0.68); box-shadow:inset 0 1px 0 rgba(255,255,255,0.78), inset 0 -1px 0 rgba(198,206,216,0.42), 0 8px 18px rgba(0,0,0,0.1); backdrop-filter:blur(18px) saturate(1.02); -webkit-backdrop-filter:blur(18px) saturate(1.02); flex-shrink:0; position:relative; overflow:hidden; font-weight:600; border-radius:30px; cursor:pointer; font-size:14px; display:inline-flex; align-items:center; justify-content:center; gap:6px; }
      .login-btn:hover:not(:disabled) { filter:brightness(1.03); }
      .login-btn:active:not(:disabled) { filter:brightness(0.97); }
      .login-btn:disabled { opacity:0.5; cursor:not-allowed; }
      .secondary-btn { padding:6px 12px; border:1px solid rgba(255,255,255,0.22); border-radius:9px; background:rgba(255,255,255,0.04); color:#fff; cursor:pointer; font-size:12px; transition:background 0.12s, border-color 0.12s; }
      .secondary-btn:hover { background:rgba(255,255,255,0.13); border-color:rgba(255,255,255,0.34); }
      .tabs { display:flex; gap:6px; margin:10px 0 8px; }
      .tab { padding:5px 10px; border-radius:8px; cursor:pointer; font-size:12px; background:rgba(255,255,255,0.08); transition:background 0.12s; }
      .tab:hover { background:rgba(255,255,255,0.15); }
      .tab.sel { background:#3d6ff5; color:#1d1d1d; }
      .out { white-space:pre-wrap; word-break:break-word; background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:11px; max-height:38vh; overflow:auto; font-size:12.5px; line-height:1.55; }
      .foot { display:flex; gap:8px; align-items:center; margin-top:12px; flex-wrap:wrap; }
      .err { color:#fca5a5; }
      .spin { width:16px; height:16px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:i2pspin 0.8s linear infinite; display:inline-block; vertical-align:middle; }
      @keyframes i2pspin { to { transform: rotate(360deg); } }
      .hist-list { max-height:52vh; overflow-y:auto; overflow-x:hidden; margin:0 -4px; padding:0 4px; }
      .hist-item { display:flex; gap:8px; align-items:center; padding:8px; border-radius:9px; cursor:pointer; background:rgba(255,255,255,0.04); margin-bottom:6px; transition:background 0.12s; }
      .hist-item:hover { background:rgba(255,255,255,0.1); }
      .hist-item img { width:34px; height:34px; object-fit:cover; border-radius:6px; flex-shrink:0; }
      .hist-item .ht { flex:1; min-width:0; font-size:12px; }
      .hist-item .ht .h1 { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .hist-item .ht .h2 { color:rgba(255,255,255,0.45); font-size:10px; }
      .i2p-logo { position:absolute; right:12px; bottom:10px; width:20px; height:20px; border-radius:5px; opacity:0.45; pointer-events:none; z-index:0; }
      .hist-del { flex-shrink:0; width:22px; height:22px; border:none; background:rgba(255,255,255,0.08); color:rgba(255,255,255,0.6); border-radius:6px; font-size:14px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.12s, color 0.12s; }
      .hist-del:hover { background:#ea4335; color:#fff; }
    `;
    _shadow.appendChild(style);
    return _shadow;
  }

  function close() {
    stopStatusPoll();
    const host = document.getElementById(ROOT_ID);
    if (host) host.remove();
    _shadow = null; _state = null; _token++; // invalidate async cũ
  }

  function positionCard(card) {
    if (!_lastCtx) return;
    const cw = card.offsetWidth || 384, ch = card.offsetHeight || 240, margin = 12;
    let x = _lastCtx.x + margin;
    if (x + cw > window.innerWidth - 8) x = Math.max(8, _lastCtx.x - cw - margin);
    const y = Math.max(8, Math.min(_lastCtx.y - 10, window.innerHeight - ch - 8));
    card.style.transform = 'none'; card.style.right = 'auto'; card.style.left = x + 'px'; card.style.top = y + 'px';
  }

  function makeDraggable(card, handle) {
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ic') || e.target.closest('button')) return;
      const r = card.getBoundingClientRect();
      card.style.left = r.left + 'px'; card.style.top = r.top + 'px'; card.style.transform = 'none'; card.style.right = 'auto';
      const sx = e.clientX, sy = e.clientY, ox = r.left, oy = r.top; e.preventDefault();
      const move = (ev) => {
        let nx = Math.max(0, Math.min(ox + (ev.clientX - sx), window.innerWidth - card.offsetWidth));
        let ny = Math.max(0, Math.min(oy + (ev.clientY - sy), window.innerHeight - card.offsetHeight));
        card.style.left = nx + 'px'; card.style.top = ny + 'px';
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  }

  function render() {
    const sh = ensureRoot();
    // Giữ vị trí card hiện tại qua re-render (history click / retry / re-analyze) → KHÔNG nhảy về cursor.
    const old = sh.querySelector('.card');
    const prevPos = (old && old.style.left) ? { left: old.style.left, top: old.style.top, right: old.style.right, transform: old.style.transform } : null;
    old?.remove();
    const card = document.createElement('div'); card.className = 'card';
    const hd = document.createElement('div'); hd.className = 'hd';
    const thumb = _state?.image ? `data:${_state.image.type || 'image/jpeg'};base64,${_state.image.base64}` : (_state?.thumb || '');
    hd.innerHTML = `${thumb ? `<img class="thumb" src="${thumb}">` : ''}<div class="tt"><div class="lbl">SEOSONA Flow · Image → Prompt</div><div class="title">${t('title')}</div></div>`;
    const acts = document.createElement('div'); acts.className = 'acts';
    // Gated → KHÔNG render History (chặn entry point xem/reuse kết quả cũ qua "Đưa vào SEOSONA Flow").
    if (_state?.phase !== 'gate') {
      const histBtn = document.createElement('button'); histBtn.className = 'ic'; histBtn.title = t('history');
      histBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"></path><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"></path><path d="M12 7v5l3 2"></path></svg>';
      histBtn.addEventListener('click', () => showHistory());
      acts.appendChild(histBtn);
    }
    // 1.1.47 port: gửi ảnh (đã capture/chọn) sang GenTab dạng ref-image upload local (lazy).
    if (_state?.image?.base64 && _state?.phase !== 'gate') {
      const sgBtn = document.createElement('button'); sgBtn.className = 'ic'; sgBtn.title = t('sendGen');
      const _sgIcon = '<svg width="16" height="16" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M6.25 1.5H3.9C3.05992 1.5 2.63988 1.5 2.31901 1.66349C2.03677 1.8073 1.8073 2.03677 1.66349 2.31901C1.5 2.63988 1.5 3.05992 1.5 3.9V8.1C1.5 8.94008 1.5 9.36012 1.66349 9.68099C1.8073 9.96323 2.03677 10.1927 2.31901 10.3365C2.63988 10.5 3.05992 10.5 3.9 10.5H8.5C8.96499 10.5 9.19748 10.5 9.38823 10.4489C9.90587 10.3102 10.3102 9.90587 10.4489 9.38823C10.5 9.19748 10.5 8.96499 10.5 8.5M9.5 4V1M8 2.5H11M5.25 4.25C5.25 4.80228 4.80228 5.25 4.25 5.25C3.69772 5.25 3.25 4.80228 3.25 4.25C3.25 3.69772 3.69772 3.25 4.25 3.25C4.80228 3.25 5.25 3.69772 5.25 4.25ZM7.49502 5.95907L3.26557 9.80402C3.02768 10.0203 2.90873 10.1284 2.89821 10.2221C2.88909 10.3033 2.92023 10.3838 2.98159 10.4378C3.05239 10.5 3.21314 10.5 3.53464 10.5H8.22799C8.94757 10.5 9.30736 10.5 9.58996 10.3791C9.94472 10.2274 10.2274 9.94472 10.3791 9.58996C10.5 9.30736 10.5 8.94757 10.5 8.22799C10.5 7.98587 10.5 7.86482 10.4735 7.75208C10.4403 7.61039 10.3765 7.47768 10.2866 7.3632C10.2151 7.2721 10.1206 7.19647 9.93154 7.04523L8.53291 5.92633C8.34369 5.77495 8.24908 5.69927 8.1449 5.67256C8.05307 5.64901 7.95643 5.65206 7.86627 5.68135C7.76397 5.71457 7.67432 5.79607 7.49502 5.95907Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
      sgBtn.innerHTML = _sgIcon;
      sgBtn.addEventListener('click', async () => {
        if (sgBtn.disabled) return;
        sgBtn.disabled = true;
        const img = _state?.image;
        const isPng = (img?.type || '').includes('png');
        const r = await bg({ action: 'i2p:sendImageToGen', base64: img?.base64, type: img?.type || 'image/jpeg', name: `gen_ref_${Date.now()}.${isPng ? 'png' : 'jpg'}` });
        // r.ok → icon đổi ✓ tại card. Notification success hiện ở SIDEBAR (app.js drain).
        sgBtn.innerHTML = r?.ok
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>'
          : _sgIcon;
        setTimeout(() => { try { sgBtn.innerHTML = _sgIcon; sgBtn.disabled = false; } catch (_) { globalThis.SEOSONA_swallow?.('i2p-content#render', _); } }, 1500);
      });
      acts.appendChild(sgBtn);
    }
    const xb = document.createElement('button'); xb.className = 'ic'; xb.textContent = '×'; xb.title = t('close'); xb.addEventListener('click', close);
    acts.appendChild(xb); hd.appendChild(acts);
    card.appendChild(hd);
    const body = document.createElement('div'); body.className = 'body'; card.appendChild(body);
    // Logo SEOSONA Flow watermark góc phải-dưới.
    try {
      const logo = document.createElement('img');
      logo.className = 'i2p-logo'; logo.alt = 'SEOSONA Flow';
      logo.src = chrome.runtime.getURL('icons/icon-48.png');
      card.appendChild(logo);
    } catch (_) { globalThis.SEOSONA_swallow?.('i2p-content#render', _); }
    sh.appendChild(card);
    makeDraggable(card, hd);
    paintBody(body);
    if (prevPos) { // re-render → khôi phục vị trí cũ (không reposition)
      card.style.left = prevPos.left; card.style.top = prevPos.top; card.style.right = prevPos.right; card.style.transform = prevPos.transform;
    } else {
      requestAnimationFrame(() => positionCard(card)); // lần đầu → đặt cạnh cursor
    }
  }

  const bodyEl = () => _shadow?.querySelector('.body');

  function paintBody(body) {
    body.innerHTML = '';
    const s = _state;
    if (s.view === 'history') { paintHistory(body); return; }

    // Feature gate: chưa login → login; login nhưng ko có quyền i2p_enabled → upgrade.
    if (s.phase === 'gate') {
      const wrap = document.createElement('div'); wrap.style.cssText = 'text-align:center;padding:10px 6px';
      const ic = document.createElement('div'); ic.style.cssText = 'margin-bottom:8px;display:flex;justify-content:center';
      ic.innerHTML = s.gateMode === 'login'
        ? '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
        : '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#3d6ff5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
      const m = document.createElement('div'); m.className = 'muted'; m.style.marginBottom = '12px';
      m.textContent = s.gateMode === 'login' ? t('gateLogin') : t('gateUpgrade');
      const b = document.createElement('button'); b.className = s.gateMode === 'login' ? 'login-btn' : 'primary-btn'; b.textContent = s.gateMode === 'login' ? t('login') : t('upgrade');
      b.addEventListener('click', () => { bg({ action: 'i2p:openApp', mode: s.gateMode }); close(); });
      wrap.appendChild(ic); wrap.appendChild(m); wrap.appendChild(b);
      body.appendChild(wrap); return;
    }

    // provider picker
    const row = document.createElement('div'); row.className = 'row';
    const lbl = document.createElement('span'); lbl.textContent = t('analyzeBy'); row.appendChild(lbl);
    ['chatgpt', 'gemini'].forEach((p) => {
      const st = s.status?.[p]; const ready = st?.ready;
      const pv = document.createElement('div'); pv.className = 'pv' + (s.provider === p ? ' sel' : '');
      pv.innerHTML = `<span class="dot ${ready ? 'on' : (st?.tabOpen ? 'warn' : '')}"></span><span>${p === 'gemini' ? 'Gemini' : 'ChatGPT'}</span>`;
      pv.addEventListener('click', () => { s.provider = p; stopStatusPoll(); paintBody(body); refreshStatus(true); });
      row.appendChild(pv);
    });
    body.appendChild(row);

    const cur = s.status?.[s.provider];
    if (s.status && !cur?.ready && s.phase !== 'analyzing') {
      const name = s.provider === 'gemini' ? 'Gemini' : 'ChatGPT';
      const hint = document.createElement('div'); hint.className = 'row';
      const m = document.createElement('span'); m.className = 'muted'; m.textContent = `${name} ${cur?.tabOpen ? t('notLogged') : t('noTab')}`;
      const ob = document.createElement('button'); ob.className = 'secondary-btn'; ob.textContent = t('openTab');
      ob.addEventListener('click', async () => { await bg({ action: 'i2p:openProviderLogin', provider: s.provider }); s.autoAnalyzeOnReady = true; m.textContent = `${name} ${t('waitingLogin')}`; startStatusPoll(); });
      hint.appendChild(m); hint.appendChild(ob); body.appendChild(hint);
    }

    if (s.phase === 'capturing' || s.phase === 'analyzing') {
      const p = document.createElement('div');
      p.innerHTML = s.phase === 'analyzing'
        ? `<span class="spin"></span> ${t('analyzing')} · ${s.provider === 'gemini' ? 'Gemini' : 'ChatGPT'} <div class="muted" style="margin-top:4px">${t('note')}</div>`
        : `<span class="spin"></span> ${t('capturing')}`;
      body.appendChild(p);
      if (s.phase === 'analyzing') {
        const cb = document.createElement('button'); cb.className = 'secondary-btn'; cb.textContent = t('cancel'); cb.style.marginTop = '10px';
        cb.addEventListener('click', () => { bg({ action: 'i2p:cancel', provider: s.provider }); close(); });
        body.appendChild(cb);
      }
    } else if (s.phase === 'error') {
      const e = document.createElement('div'); e.className = 'err'; e.textContent = s.error || 'Error'; body.appendChild(e);
      const row = document.createElement('div'); row.className = 'foot';
      if (s.image) { const rb = document.createElement('button'); rb.className = 'primary-btn'; rb.textContent = t('retry'); rb.addEventListener('click', () => doAnalyze()); row.appendChild(rb); }
      // Lấy ảnh thất bại (CORS) → fallback tải ảnh từ máy.
      const ub = document.createElement('button'); ub.className = 'secondary-btn'; ub.textContent = t('uploadImg');
      ub.addEventListener('click', () => pickLocalFile()); row.appendChild(ub);
      body.appendChild(row);
    } else if (s.phase === 'idle' && s.image) {
      const ab = document.createElement('button'); ab.className = 'gen-prompt-btn';
      ab.innerHTML = '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z"></path><path d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z"></path></svg><span>' + t('analyze') + '</span>';
      ab.addEventListener('click', () => doAnalyze());
      const ch = document.createElement('button'); ch.className = 'secondary-btn'; ch.textContent = t('changeImg'); ch.style.marginLeft = '8px';
      ch.addEventListener('click', () => pickLocalFile());
      const wrap = document.createElement('div'); wrap.className = 'foot'; wrap.appendChild(ab); wrap.appendChild(ch); body.appendChild(wrap);
    } else if (s.phase === 'idle' && !s.image) {
      // Upload mode: card mở rỗng (không right-click ảnh) → tải ảnh từ máy.
      const hint = document.createElement('div'); hint.className = 'muted'; hint.style.margin = '2px 0 10px'; hint.textContent = t('uploadHint'); body.appendChild(hint);
      const ub = document.createElement('button'); ub.className = 'gen-prompt-btn';
      ub.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg><span>' + t('uploadImg') + '</span>';
      ub.addEventListener('click', () => pickLocalFile()); body.appendChild(ub);
    } else if (s.phase === 'result') {
      renderResult(body);
    }
  }

  function renderResult(body) {
    const s = s2();
    const tabs = document.createElement('div'); tabs.className = 'tabs';
    [['json', t('tabJson')], ['en', t('tabEn')], ['vi', t('tabVi')]].forEach(([k, label]) => {
      const tb = document.createElement('div'); tb.className = 'tab' + (s.tab === k ? ' sel' : ''); tb.textContent = label;
      tb.addEventListener('click', () => { s.tab = k; renderResult(body); }); tabs.appendChild(tb);
    });
    body.querySelectorAll('.tabs,.out,.foot,.vi-hint').forEach(n => n.remove());
    body.appendChild(tabs);
    if (s.tab === 'vi') { const h = document.createElement('div'); h.className = 'vi-hint muted'; h.textContent = t('viReadHint'); h.style.margin = '6px 0'; body.appendChild(h); }
    const out = document.createElement('div'); out.className = 'out'; out.textContent = currentText(); body.appendChild(out);

    const foot = document.createElement('div'); foot.className = 'foot';
    const cp = document.createElement('button'); cp.className = 'secondary-btn'; cp.textContent = t('copy');
    cp.addEventListener('click', () => { try { navigator.clipboard.writeText(currentText()); } catch (_) { globalThis.SEOSONA_swallow?.('i2p-content#renderResult', _); } cp.textContent = t('copied'); setTimeout(() => { if (cp.isConnected) cp.textContent = t('copy'); }, 1500); });
    const gf = document.createElement('button'); gf.className = 'send-flow-btn';
    // Icon SVG + label trong span riêng (update text qua span để KHÔNG xoá icon).
    gf.innerHTML = '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z"></path><path d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z"></path></svg><span class="sf-label">' + t('genFlow') + '</span>';
    const gfLabel = gf.querySelector('.sf-label');
    gf.addEventListener('click', async () => { gf.disabled = true; gfLabel.textContent = t('sending'); const r = await bg({ action: 'i2p:genOnFlow', prompt: genText() }); gfLabel.textContent = r?.ok ? t('sentFlow') : t('genFlow'); setTimeout(() => { if (gf.isConnected) gfLabel.textContent = t('genFlow'); }, 2000); gf.disabled = false; });
    // [U2] Gửi prompt vào NODE workflow (tạo node Text) — khác genFlow (ô prompt GenTab).
    const gn = document.createElement('button'); gn.className = 'secondary-btn'; gn.textContent = t('genNode');
    gn.addEventListener('click', async () => { const _o = t('genNode'); gn.disabled = true; gn.textContent = t('sending'); const r = await bg({ action: 'i2p:genToNode', prompt: genText() }); gn.textContent = r?.ok ? t('sentNode') : _o; setTimeout(() => { if (gn.isConnected) gn.textContent = _o; }, 2500); gn.disabled = false; });
    const ra = document.createElement('button'); ra.className = 'secondary-btn'; ra.textContent = t('reanalyze');
    ra.addEventListener('click', () => doAnalyze());
    foot.appendChild(cp); foot.appendChild(gf); foot.appendChild(gn); foot.appendChild(ra);
    body.appendChild(foot);
  }

  function s2() { return _state; }
  function currentText() {
    const s = _state;
    if (s.tab === 'json') return JSON.stringify(s.parsed || { raw: s.raw }, null, 2);
    if (s.tab === 'en') return s.parsed?.recreation_prompt_en || s.raw || '';
    return s.parsed?.recreation_prompt_vi || s.parsed?.recreation_prompt_en || s.raw || '';
  }
  // Text sạch để gen (Đưa vào SEOSONA Flow / Copy prompt): KHÔNG bao giờ nhồi cả JSON blob vào ô prompt.
  // Ở tab JSON/VI vẫn ưu tiên prompt EN (gen ảnh tốt nhất); tab VI người dùng cố ý → tôn trọng VI.
  function genText() {
    const s = _state;
    if (s.tab === 'vi') return s.parsed?.recreation_prompt_vi || s.parsed?.recreation_prompt_en || s.raw || '';
    return s.parsed?.recreation_prompt_en || s.parsed?.recreation_prompt_vi || s.raw || '';
  }

  // ---- History view ----
  async function showHistory() { _state.view = 'history'; _state.histList = await histLoad(); const b = bodyEl(); if (b) paintBody(b); }
  function paintHistory(body) {
    const head = document.createElement('div'); head.className = 'row'; head.style.justifyContent = 'space-between'; head.style.marginBottom = '10px';
    const back = document.createElement('button'); back.className = 'secondary-btn'; back.textContent = '‹ ' + t('back');
    back.addEventListener('click', () => { _state.view = null; const b = bodyEl(); if (b) paintBody(b); });
    head.appendChild(back);
    const list = _state.histList || [];
    if (list.length) {
      const clr = document.createElement('button'); clr.className = 'secondary-btn'; clr.textContent = t('clearAll');
      clr.addEventListener('click', async () => { await histClear(); _state.histList = []; const b = bodyEl(); if (b) paintBody(b); });
      head.appendChild(clr);
    }
    body.appendChild(head);
    if (!list.length) { const m = document.createElement('div'); m.className = 'muted'; m.textContent = t('noHistory'); body.appendChild(m); return; }
    // Bound chiều cao + scroll-y cho list (tránh tràn card khi nhiều mục); header (back/clearAll) ở ngoài để luôn thấy.
    const listWrap = document.createElement('div'); listWrap.className = 'hist-list';
    list.forEach((h) => {
      const it = document.createElement('div'); it.className = 'hist-item';
      const preview = (h.parsed?.recreation_prompt_en || h.raw || '').slice(0, 80);
      // H8: escape mọi field AI/raw (preview) + provider trước khi nhồi innerHTML (chạy trên DOM trang host).
      it.innerHTML = `${h.thumb ? `<img src="${escHtml(h.thumb)}">` : ''}<div class="ht"><div class="h1">${escHtml(preview) || '—'}</div><div class="h2">${escHtml((h.provider || '').toUpperCase())}</div></div><button class="hist-del" title="${escHtml(t('deleteOne'))}">×</button>`;
      // Click item → xem result, KHÔNG reposition (render giữ vị trí); clear image để header dùng thumb history.
      it.addEventListener('click', () => { _state.view = null; _state.image = null; _state.raw = h.raw; _state.parsed = h.parsed; _state.thumb = h.thumb; _state.phase = 'result'; _state.tab = 'json'; render(); });
      it.querySelector('.hist-del')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await histRemove(h.ts);
        _state.histList = (_state.histList || []).filter((x) => x.ts !== h.ts);
        const b = bodyEl(); if (b) paintBody(b);
      });
      listWrap.appendChild(it);
    });
    body.appendChild(listWrap);
  }

  // ---- status ----
  async function refreshStatus(repaint) {
    const tok = _token; const stR = await bg({ action: 'i2p:checkProviders' });
    if (tok !== _token || !_state) return;
    if (stR?.ok) _state.status = stR.providers;
    if (repaint) { const b = bodyEl(); if (b) paintBody(b); }
  }
  function startStatusPoll() {
    stopStatusPoll(); let n = 0;
    _statusPoll = setInterval(async () => {
      n++; await refreshStatus(true);
      const cur = _state?.status?.[_state?.provider];
      if (!_state || cur?.ready || n >= 12) {
        stopStatusPoll();
        if (_state && cur?.ready && _state.autoAnalyzeOnReady && _state.phase === 'idle' && _state.image) { _state.autoAnalyzeOnReady = false; doAnalyze(); }
      }
    }, 3000);
  }

  // Map mã lỗi provider → thông báo tiếng người (fallback errProvider + kèm mã cho debug).
  function analyzeErrorMsg(code) {
    if (/TIMEOUT/i.test(code)) return t('errTimeout');
    if (/UPLOAD/i.test(code)) return t('errUpload');
    if (/NO_RESPONSE/i.test(code)) return t('errNoResp');
    return `${t('errProvider')}${code ? ` (${code})` : ''}`;
  }

  // ---- analyze ----
  async function doAnalyze() {
    const s = _state; const tok = _token;
    s.phase = 'analyzing'; { const b = bodyEl(); if (b) paintBody(b); }
    const resp = await bg({ action: 'i2p:analyze', provider: s.provider, image: s.image });
    if (tok !== _token || !_state) return; // card đã đóng / mở ảnh khác
    // Backstop gate (vd re-analyze từ history khi mất quyền) → chuyển sang card login/upgrade.
    if (resp && resp.error === 'FEATURE_LOCKED') {
      const acc = await bg({ action: 'i2p:checkAccess' });
      s.phase = 'gate'; s.gateMode = (acc && acc.loggedIn) ? 'upgrade' : 'login';
      const b = bodyEl(); if (b) paintBody(b); return;
    }
    if (!resp || !resp.success) {
      const code = (resp && resp.error) || '';
      // I7: lỗi tạm thời (timeout / provider vừa mở / upload lỡ nhịp) → tự thử lại 1 lần trước khi báo lỗi.
      const transient = /TIMEOUT|NOT_READY|UPLOAD|INSERT_FAILED|SEND_BUTTON|NO_RESPONSE/i.test(code);
      if (transient && !s._retried) {
        s._retried = true; s.error = t('retrying');
        { const b = bodyEl(); if (b) { const e = document.createElement('div'); e.className = 'muted'; e.textContent = t('retrying'); b.appendChild(e); } }
        await new Promise((r) => setTimeout(r, 1200));
        if (tok !== _token || !_state) return;
        return doAnalyze();
      }
      s.phase = 'error';
      s.error = analyzeErrorMsg(code);
      const b = bodyEl(); if (b) paintBody(b); return;
    }
    const raw = stripFences(resp.text || ''); s.raw = raw; s._retried = false;
    try { s.parsed = JSON.parse(raw); } catch (_) { s.parsed = salvageParse(raw); }
    s.phase = 'result'; s.tab = 'json'; // JSON mặc định — chất lượng gen tốt nhất (tách bạch từng yếu tố)
    const b = bodyEl(); if (b) paintBody(b);
    const thumb = s.image ? await makeThumb(s.image.base64, s.image.type) : '';
    histAdd({ ts: Date.now(), provider: s.provider, raw, parsed: s.parsed, thumb });
  }

  // ---- mở card cho 1 ảnh (srcUrl) hoặc image đã capture sẵn (region) ----
  async function openCard({ srcUrl, image, upload }) {
    const tok = ++_token;
    _state = { provider: 'chatgpt', status: null, image: image || null, maxPx: 1536, phase: 'capturing', raw: '', parsed: null, tab: 'json', error: '', view: null, autoAnalyzeOnReady: false, gateMode: null, _retried: false };
    render();
    // Feature gate trước tiên — chưa có quyền thì không capture/fetch gì thêm.
    const acc = await bg({ action: 'i2p:checkAccess' });
    if (tok !== _token || !_state) return;
    if (acc && acc.ok && !acc.allowed) {
      _state.phase = 'gate'; _state.gateMode = acc.loggedIn ? 'upgrade' : 'login';
      render(); return;
    }
    const [cfgR, stR] = await Promise.all([bg({ action: 'i2p:getConfig' }), bg({ action: 'i2p:checkProviders' })]);
    if (tok !== _token || !_state) return;
    if (cfgR?.ok && cfgR.config?.defaultProvider) _state.provider = cfgR.config.defaultProvider;
    _state.status = stR?.ok ? stR.providers : { gemini: { tabOpen: false }, chatgpt: { tabOpen: false } };
    // I9: provider mặc định chưa sẵn sàng nhưng provider kia đã ready → tự chọn cái ready (đỡ 1 lần click + mở tab).
    { const pref = _state.provider, other = pref === 'gemini' ? 'chatgpt' : 'gemini';
      if (!_state.status?.[pref]?.ready && _state.status?.[other]?.ready) _state.provider = other; }
    // promptTemplate thiếu (config lỗi) → báo ngay, không capture vô ích.
    if (cfgR?.ok && !cfgR.config?.promptTemplate) { _state.phase = 'error'; _state.error = t('errConfig'); render(); return; }
    const maxPx = cfgR?.config?.maxImagePx || 1536; _state.maxPx = maxPx;
    // Upload mode: mở card rỗng (không right-click ảnh) → idle không ảnh → hiện nút tải ảnh từ máy.
    if (upload && !_state.image && !srcUrl) { _state.phase = 'idle'; render(); return; }
    if (!_state.image) { _state.image = await captureImage(srcUrl, maxPx); }
    if (tok !== _token || !_state) return;
    // Capture thất bại (CORS) → error kèm fallback upload (nút trong paintBody error).
    if (!_state.image) { _state.phase = 'error'; _state.error = t('errCapture'); render(); return; }
    _state.phase = 'idle'; render(); // render lại để có thumbnail
  }

  // ---- entry: context menu (background) ----
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === 'i2p:showCard') { openCard({ srcUrl: message.srcUrl || _lastCtxImgUrl }); return; }
    if (message?.action === 'i2p:regionMode') { startRegionSelect(); return; }
    if (message?.action === 'i2p:uploadMode') { openCard({ upload: true }); return; }
    // [U5] URL ảnh THÔ tại con trỏ (link/overlay/background-image context — Chrome không cấp
    // info.srcUrl). Background sẽ tự resolve bản gốc (executeScript) → không trùng logic ở 2 nơi.
    if (message?.action === 'i2p:getCtxImageUrl') {
      sendResponse({ url: _lastCtxImgUrl || message.srcUrl || '' });
      return;
    }
  });

  // ---- Esc đóng card ----
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (_regionLayer) cancelRegion(); else if (_state) close(); } }, true);

  // [Clean] Bỏ hover button trên ảnh (seosonaflow-i2p-hover) — gây phiền user (icon đè mọi ảnh ≥128px khi
  // di chuột). Image → Prompt giờ CHỈ qua right-click (context menu 'Tools'). KHÔNG dùng hover nữa.

  // ---- Region screenshot (P4) ----
  let _regionLayer = null;
  function cancelRegion() { if (_regionLayer) { _regionLayer.remove(); _regionLayer = null; } }
  function startRegionSelect() {
    cancelRegion();
    const layer = document.createElement('div'); _regionLayer = layer;
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.18);';
    const hint = document.createElement('div');
    hint.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#19d07b;color:#fff;padding:8px 14px;border-radius:9px;font:600 13px -apple-system,sans-serif;';
    hint.textContent = t('regionHint'); layer.appendChild(hint);
    const sel = document.createElement('div');
    sel.style.cssText = 'position:fixed;border:2px solid #76ADFF;background:rgba(118,173,255,0.18);display:none;';
    layer.appendChild(sel);
    document.documentElement.appendChild(layer);
    let sx = 0, sy = 0, drag = false;
    layer.addEventListener('mousedown', (e) => { drag = true; sx = e.clientX; sy = e.clientY; sel.style.display = 'block'; sel.style.left = sx + 'px'; sel.style.top = sy + 'px'; sel.style.width = '0'; sel.style.height = '0'; });
    layer.addEventListener('mousemove', (e) => { if (!drag) return; const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY), w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy); sel.style.left = x + 'px'; sel.style.top = y + 'px'; sel.style.width = w + 'px'; sel.style.height = h + 'px'; });
    layer.addEventListener('mouseup', async (e) => {
      if (!drag) return; drag = false;
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY), w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      if (w < 8 || h < 8) { cancelRegion(); return; }
      // Ẩn overlay + đợi 2 frame để không dính tint/selection vào screenshot, rồi mới chụp.
      layer.style.display = 'none';
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      cancelRegion();
      _lastCtx = { x: x + w, y };
      const r = await bg({ action: 'i2p:captureRegion', rect: { x, y, w, h, dpr: window.devicePixelRatio || 1 } });
      if (r?.ok && r.image?.base64) openCard({ image: r.image });
    });
  }
})();
