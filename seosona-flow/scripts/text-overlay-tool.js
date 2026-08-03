/**
 * text-overlay-tool.js — UI cho tool overlay chữ lên ảnh (standalone page).
 * Dùng TextOverlay.render (canvas deterministic) + TextIntegrity (kiểm chính tả input↔expected).
 * Tự save canvas (không đụng tile/executor/download-node). Offline, client-side.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var TO = self.TextOverlay, TI = self.TextIntegrity;

  var state = { dataUrl: null, resultUrl: null };

  function _enable() {
    var ok = !!state.dataUrl && ($('text').value || '').trim().length > 0;
    $('render').disabled = !ok;
  }

  function _loadFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    var r = new FileReader();
    r.onload = function () {
      state.dataUrl = r.result;
      var pv = $('preview');
      pv.innerHTML = '';
      var img = new Image(); img.src = state.dataUrl; pv.appendChild(img);
      $('qa').className = 'qa'; $('download').disabled = true; state.resultUrl = null;
      _enable();
    };
    r.readAsDataURL(file);
  }

  // Zone theo vị trí — dùng TextOverlay.zoneFor (DRY, chung với node text_overlay); fallback nếu thiếu.
  function _zoneFor(pos, w, h) {
    if (TO && TO.zoneFor) return TO.zoneFor(pos, w, h);
    var pad = w * 0.08;
    if (pos === 'top') return { x: pad, y: h * 0.05, w: w - pad * 2, h: h * 0.25 };
    if (pos === 'bottom') return { x: pad, y: h * 0.70, w: w - pad * 2, h: h * 0.25 };
    return { x: pad, y: h * 0.35, w: w - pad * 2, h: h * 0.30 };
  }

  function _imgSize(dataUrl) {
    return new Promise(function (resolve) {
      var im = new Image(); im.onload = function () { resolve({ w: im.width, h: im.height }); };
      im.onerror = function () { resolve({ w: 1024, h: 1024 }); }; im.src = dataUrl;
    });
  }

  async function _render() {
    if (!TO || !TO.render || !state.dataUrl) return;
    var text = $('text').value || '';
    var dim = await _imgSize(state.dataUrl);
    var item = {
      text: text,
      zone: _zoneFor($('pos').value, dim.w, dim.h),
      mode: $('mode').value,
      align: $('align').value,
      color: $('color').value || '#ffffff',
      size: Math.max(8, parseInt($('size').value, 10) || Math.round(dim.h * 0.12)),
      valign: 'middle',
    };
    try {
      state.resultUrl = await TO.render(state.dataUrl, [item], {});
      var pv = $('preview'); pv.innerHTML = '';
      var img = new Image(); img.src = state.resultUrl; pv.appendChild(img);
      $('download').disabled = false;
      _runQA(text);
    } catch (e) {
      var pv2 = $('preview'); pv2.innerHTML = '<div class="ph">Lỗi render: ' + (e && e.message || e) + '</div>';
    }
  }

  // QA: so chữ ĐÃ nhập với chuỗi mong đợi (overlay là deterministic → render = input). Bắt lỗi gõ.
  function _runQA(text) {
    var qa = $('qa');
    var expected = ($('expected').value || '').trim();
    if (!expected || !TI || !TI.compare) { qa.className = 'qa'; return; }
    var r = TI.compare(expected, text, { expectNoDiacritics: false });
    qa.className = 'qa ' + r.verdict;
    qa.textContent = (TI.summary ? TI.summary(r) : (r.verdict === 'pass' ? '✓ Khớp' : '⚠ Lệch chuỗi mong đợi'));
  }

  function _download() {
    if (!state.resultUrl) return;
    var a = document.createElement('a');
    a.href = state.resultUrl;
    a.download = 'seosona-text-overlay.png';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function init() {
    var drop = $('drop'), file = $('file');
    drop.addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () { if (file.files && file.files[0]) _loadFile(file.files[0]); });
    ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) _loadFile(f); });
    $('text').addEventListener('input', _enable);
    $('color').addEventListener('input', function () { $('colorhex').textContent = $('color').value; });
    $('render').addEventListener('click', _render);
    $('download').addEventListener('click', _download);
    if (!TO) { $('render').title = 'TextOverlay.js chưa load'; }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
