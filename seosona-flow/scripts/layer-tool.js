/**
 * layer-tool.js — công cụ TÁCH LỚP: một ảnh có sẵn → nhiều PNG nền trong suốt.
 *
 * Luồng:
 *   1. thả một ảnh
 *   2. "Xem trong ảnh có gì" → hỏi mô hình liệt kê các vật (một lượt vision, TỰ ĐỘNG)
 *   3. "Đưa sang tab Gen" → đẩy ảnh gốc làm tham chiếu + N prompt tách, bấm Bắt đầu ở đó
 *   4. thả các ảnh đã gen về → cắt nền ở máy → tải từng lớp .png
 *
 * Vì sao bước 3 KHÔNG tự chạy luôn: sinh ảnh trên Flow là một luồng dài (gửi prompt → chờ ô
 * hiện → tải về) do GenTab/WorkflowExecutor lo, không phải một lời gọi. Bàn giao đúng chỗ có
 * sẵn máy móc thay vì viết lại từ đầu ở đây.
 *
 * Phép toán nằm ở src/layers/ (LayerDecompose, LayerCutout, LayerStack) và đã có 27 test.
 * File này nối chúng với DOM và với đường gọi provider của extension.
 *
 * Nói thẳng giới hạn ngay trên giao diện: mỗi lớp tốn một lượt gen, và các lớp ghép lại KHÔNG
 * khớp pixel với ảnh gốc — mô hình vẽ lại chứ không cắt ra.
 */
(function () {
  'use strict';

  var LD = window.SEOSONA_LayerDecompose;
  var CO = window.SEOSONA_LayerCutout;
  var ST = window.SEOSONA_LayerStack;

  var $ = function (id) { return document.getElementById(id); };
  var sourceImage = null;     // ImageData của ảnh nguồn
  var sourceDataUrl = null;   // để gửi cho provider
  var objects = [];           // kết quả liệt kê
  var layers = [];
  var selected = null;
  var busy = false;

  function note(msg, kind) {
    var el = $('planNote');
    el.textContent = msg || '';
    el.style.color = kind === 'warn' ? 'var(--warn)' : (kind === 'ok' ? 'var(--ok)' : 'var(--mut)');
  }

  // ── nạp ảnh nguồn ─────────────────────────────────────────────────────────────────────
  function readImage(file) {
    return new Promise(function (res, rej) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        try {
          res({ data: ctx.getImageData(0, 0, c.width, c.height), dataUrl: c.toDataURL('image/png') });
        } catch (e) { rej(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('không đọc được ảnh')); };
      img.src = url;
    });
  }

  async function loadSource(file) {
    try {
      var r = await readImage(file);
      sourceImage = r.data;
      sourceDataUrl = r.dataUrl;
      var pv = $('srcPrev');
      pv.width = r.data.width; pv.height = r.data.height;
      pv.getContext('2d').putImageData(new ImageData(r.data.data, r.data.width, r.data.height), 0, 0);
      pv.style.display = 'block';
      objects = []; layers = []; selected = null;
      $('scan').disabled = false;
      $('runAll').disabled = true;
      note('Ảnh ' + r.data.width + '×' + r.data.height + '. Bấm "Xem trong ảnh có gì".');
      render();
    } catch (e) {
      note('Không đọc được ảnh: ' + (e && e.message), 'warn');
    }
  }

  // ── gọi provider ──────────────────────────────────────────────────────────────────────
  /** data:image/png;base64,XXXX → XXXX. Handler đòi base64 trần, không phải cả data URL. */
  function _b64(dataUrl) {
    var i = String(dataUrl || '').indexOf(',');
    return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  }

  function bg(msg) {
    return new Promise(function (res) {
      try {
        chrome.runtime.sendMessage(msg, function (r) {
          if (chrome.runtime.lastError) { res({ ok: false, error: chrome.runtime.lastError.message }); return; }
          res(r || { ok: false, error: 'không có phản hồi' });
        });
      } catch (e) { res({ ok: false, error: e && e.message }); }
    });
  }

  /** Hỏi mô hình: trong ảnh này có những gì. Một lượt vision. */
  async function scan() {
    if (busy || !sourceDataUrl) return;
    busy = true; $('scan').disabled = true;
    note('Đang hỏi mô hình xem trong ảnh có gì…');
    var max = Math.max(2, Math.min(12, +$('maxObj').value || 6));
    // Hợp đồng THẬT của pa:generate (xem PromptAssistantModal — bên gọi đang chạy được):
    //   images: [{base64, name, type}]  — KHÔNG phải mảng data URL
    //   trả về: {success, text}         — KHÔNG phải {ok, result}
    var r = await bg({
      action: 'pa:generate',
      provider: 'chatgpt',
      metaPrompt: LD.listObjectsPrompt({ max: max }),
      images: [{ base64: _b64(sourceDataUrl), name: 'source.png', type: 'image/png' }],
      timeout: 180000,
    });
    busy = false;
    var text = r && r.text;
    if (!r || !r.success || !text) {
      $('scan').disabled = false;
      note('Không hỏi được mô hình: ' + ((r && r.error) || 'không rõ')
        + '. Kiểm tra tab provider đã mở và đăng nhập chưa.', 'warn');
      return;
    }
    var parsed = LD.parseObjects(text);
    if (!parsed.ok) {
      $('scan').disabled = false;
      note('Mô hình trả về không đọc được (' + parsed.reason + '). Thử lại hoặc đổi provider.', 'warn');
      return;
    }
    objects = parsed.objects.slice(0, max);
    var plan = LD.plan(objects, { backdrop: $('backdrop').value });
    $('scan').disabled = false;
    $('runAll').disabled = false;
    note('Thấy ' + plan.layerCount + ' lớp: ' + objects.map(function (o) { return o.label; }).join(' · ')
      + ' — tách sẽ tốn ' + plan.generations + ' lượt gen.', 'ok');
    render();
  }

  /**
   * Đẩy sang tab Gen: ảnh gốc làm THAM CHIẾU + toàn bộ prompt tách dạng nhiều-prompt.
   *
   * Vì sao KHÔNG tự gen luôn ở đây: pa:generate đi qua provider:textTask — nó trả về CHỮ, không
   * trả ảnh. Sinh ảnh trên Flow là một luồng dài (gửi prompt → chờ ô hiện → tải về) do GenTab và
   * WorkflowExecutor lo, không phải một lời gọi. Bản trước tôi gọi pa:generate rồi mong nhận ảnh
   * — sai từ gốc, và đó là lý do nó báo EXCEPTION.
   *
   * Nên: bàn giao đúng chỗ có sẵn máy móc. Tab Gen đã hỗ trợ nhiều prompt một lượt và tự tải về.
   */
  async function sendToGen() {
    if (busy || !objects.length || !sourceDataUrl) return;
    busy = true; $('runAll').disabled = true;
    var plan = LD.plan(objects, { backdrop: $('backdrop').value });

    // Mỗi prompt cách nhau một dòng trống — đúng cách GenTab tách nhiều prompt.
    var text = plan.steps.map(function (st) {
      return st.positive + ' NEGATIVE: ' + st.negative;
    }).join('\n\n');

    var a = await bg({
      action: 'i2p:sendImageToGen',
      base64: _b64(sourceDataUrl), type: 'image/png',
      name: 'layer_source_' + Date.now() + '.png',
    });
    var b = await bg({ action: 'i2p:setGenPrompt', text: text });
    busy = false; $('runAll').disabled = false;

    var okA = a && (a.ok === true || a.success === true);
    var okB = b && (b.ok === true || b.success === true);
    if (!okA && !okB) {
      note('Không đẩy sang tab Gen được: ' + ((a && a.error) || (b && b.error) || 'không rõ')
        + '. Mở bảng bên rồi thử lại.', 'warn');
      return;
    }
    note('Đã đưa ' + plan.steps.length + ' prompt + ảnh gốc (làm tham chiếu) sang tab Gen. '
      + 'Bấm Bắt đầu ở đó — ' + plan.steps.length + ' lượt gen. Xong thì thả các ảnh về ô dưới để cắt nền.', 'ok');
    $('backFromGen').style.display = '';
  }

  /** Ảnh đã gen ở tab Gen, tải về rồi thả lại đây → cắt nền thành lớp. */
  async function addCutFiles(files) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!/^image\//.test(f.type)) continue;
      try {
        var r = await readImage(f);
        var cut = CO.cutout(r.data, cutOpts());
        // Ghép tên file với vật đã liệt kê, nếu khớp — để lớp mang đúng tên thay vì tên file.
        var base = f.name.replace(/\.[^.]+$/, '').toLowerCase();
        var hit = objects.find(function (o) { return base.indexOf(o.id) >= 0; });
        layers.push({
          id: (hit && hit.id) || ('f' + layers.length),
          name: (hit && hit.label) || f.name.replace(/\.[^.]+$/, ''),
          source: r.data, image: cut.image, cut: cut,
          x: 0, y: 0, scale: 1, z: layers.length, visible: true,
        });
      } catch (e) {
        note('Bỏ qua ' + f.name + ': ' + (e && e.message), 'warn');
      }
    }
    render();
  }

  function readImageFromUrl(url) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        try { res(c.getContext('2d').getImageData(0, 0, c.width, c.height)); }
        catch (e) { rej(e); }
      };
      img.onerror = function () { rej(new Error('không tải được ảnh trả về')); };
      img.src = url;
    });
  }

  // ── cắt nền ───────────────────────────────────────────────────────────────────────────
  function cutOpts() {
    return {
      tolerance: +$('tol').value,
      softness: +$('soft').value,
      despill: (+$('spill').value) / 100,
    };
  }

  function recutAll() {
    var o = cutOpts();
    layers = layers.map(function (l) {
      // Cắt lại từ ẢNH GỐC của lớp, không cắt chồng lên bản đã cắt — cắt chồng cắt là mất
      // chi tiết biên vĩnh viễn.
      var cut = CO.cutout(l.source, o);
      var c = {}; for (var k in l) c[k] = l[k];
      c.image = cut.image; c.cut = cut;
      return c;
    });
    render();
  }

  // ── danh sách lớp ─────────────────────────────────────────────────────────────────────
  function thumb(rgba) {
    var s = 44;
    var c = document.createElement('canvas'); c.width = s; c.height = s;
    var tmp = document.createElement('canvas');
    tmp.width = rgba.width; tmp.height = rgba.height;
    tmp.getContext('2d').putImageData(new ImageData(rgba.data, rgba.width, rgba.height), 0, 0);
    var r = Math.min(s / rgba.width, s / rgba.height);
    var ctx = c.getContext('2d');
    ctx.drawImage(tmp, (s - rgba.width * r) / 2, (s - rgba.height * r) / 2, rgba.width * r, rgba.height * r);
    return c;
  }

  function renderLayers() {
    var box = $('layers');
    box.textContent = '';
    if (!layers.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.textContent = objects.length ? 'Đã thấy vật — bấm "Tách tất cả".' : 'Chưa có lớp nào.';
      box.appendChild(e);
      return;
    }
    layers.slice().sort(function (a, b) { return b.z - a.z; }).forEach(function (l) {
      var row = document.createElement('div');
      row.className = 'layer' + (selected === l.id ? ' sel' : '');
      var th = document.createElement('div'); th.className = 'th'; th.appendChild(thumb(l.image));
      row.appendChild(th);

      var info = document.createElement('div'); info.className = 'info';
      var nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = l.name;
      info.appendChild(nm);
      var meta = document.createElement('div'); meta.className = 'meta';
      meta.textContent = l.image.width + '×' + l.image.height
        + ' · giữ ' + Math.round(l.cut.keptRatio * 100) + '% · z' + l.z;
      info.appendChild(meta);
      (l.cut.warnings || []).forEach(function (w) {
        var wd = document.createElement('div'); wd.className = 'warn'; wd.textContent = '⚠ ' + w;
        info.appendChild(wd);
      });
      row.appendChild(info);

      [['⬇', function () { saveLayer(l); }], ['▲', function () { move(l.id, 1); }],
       ['▼', function () { move(l.id, -1); }], [l.visible ? '👁' : '🚫', function () { toggle(l.id); }],
       ['✕', function () { remove(l.id); }]].forEach(function (pr) {
        var b = document.createElement('button'); b.className = 'mini'; b.textContent = pr[0];
        b.addEventListener('click', function (ev) { ev.stopPropagation(); pr[1](); });
        row.appendChild(b);
      });
      row.addEventListener('click', function () { selected = l.id; render(); });
      box.appendChild(row);
    });
  }

  function move(id, dir) {
    var sorted = layers.slice().sort(function (a, b) { return a.z - b.z; });
    var i = sorted.findIndex(function (l) { return l.id === id; });
    if (i < 0) return;
    layers = ST.reorder(layers, id, Math.max(0, Math.min(sorted.length - 1, i + dir)));
    render();
  }
  function toggle(id) {
    var l = layers.find(function (x) { return x.id === id; });
    layers = ST.update(layers, id, { visible: !(l.visible !== false) });
    render();
  }
  function remove(id) {
    layers = layers.filter(function (l) { return l.id !== id; })
      .map(function (l, i) { var c = {}; for (var k in l) c[k] = l[k]; c.z = i; return c; });
    if (selected === id) selected = null;
    render();
  }

  // ── xuất ──────────────────────────────────────────────────────────────────────────────
  function toBlobUrl(rgba) {
    var c = document.createElement('canvas');
    c.width = rgba.width; c.height = rgba.height;
    c.getContext('2d').putImageData(new ImageData(rgba.data, rgba.width, rgba.height), 0, 0);
    return new Promise(function (res) { c.toBlob(function (b) { res(b); }, 'image/png'); });
  }

  async function saveLayer(l) {
    var b = await toBlobUrl(l.image);
    if (!b) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'layer_' + l.id + '.png';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  async function saveAll() {
    // Tải lần lượt, cách nhau một nhịp — bắn cùng lúc thì Chrome chặn bớt.
    for (var i = 0; i < layers.length; i++) {
      await saveLayer(layers[i]);
      await new Promise(function (r) { setTimeout(r, 350); });
    }
    note('Đã tải ' + layers.length + ' lớp.', 'ok');
  }

  function renderStage() {
    var W = Math.max(16, +$('outW').value || 1024);
    var H = Math.max(16, +$('outH').value || 1024);
    var cv = $('stage'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (!layers.length) return;
    var out = ST.composite(layers, { width: W, height: H });
    ctx.putImageData(new ImageData(out.data, W, H), 0, 0);
  }

  function fitAll() {
    if (!layers.length) return;
    var w = 0, h = 0;
    layers.forEach(function (l) {
      w = Math.max(w, (l.x || 0) + Math.round(l.image.width * (l.scale || 1)));
      h = Math.max(h, (l.y || 0) + Math.round(l.image.height * (l.scale || 1)));
    });
    $('outW').value = Math.max(16, w); $('outH').value = Math.max(16, h);
    render();
  }

  function render() {
    renderLayers();
    renderStage();
    var has = layers.length > 0;
    $('downloadAll').disabled = !has;
    $('download').disabled = !has;
    $('recut').disabled = !has;
  }

  function bindDrag() {
    var cv = $('stage');
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    cv.addEventListener('mousedown', function (e) {
      if (!selected) return;
      var l = layers.find(function (x) { return x.id === selected; });
      if (!l) return;
      dragging = true;
      var r = cv.getBoundingClientRect(), k = cv.width / r.width;
      sx = (e.clientX - r.left) * k; sy = (e.clientY - r.top) * k;
      ox = l.x || 0; oy = l.y || 0;
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging || !selected) return;
      var r = cv.getBoundingClientRect(), k = cv.width / r.width;
      layers = ST.update(layers, selected, {
        x: Math.round(ox + (e.clientX - r.left) * k - sx),
        y: Math.round(oy + (e.clientY - r.top) * k - sy),
      });
      renderStage();
    });
    window.addEventListener('mouseup', function () { if (dragging) { dragging = false; render(); } });
    cv.addEventListener('wheel', function (e) {
      if (!selected) return;
      e.preventDefault();
      var l = layers.find(function (x) { return x.id === selected; });
      if (!l) return;
      layers = ST.update(layers, selected,
        { scale: Math.max(0.05, Math.min(8, (l.scale || 1) * (e.deltaY < 0 ? 1.08 : 1 / 1.08))) });
      render();
    }, { passive: false });
  }

  function init() {
    if (!LD || !CO || !ST) {
      document.body.textContent = 'Thiếu module tách lớp — kiểm tra thứ tự script trong layer-tool.html.';
      return;
    }
    $('pick').addEventListener('click', function () { $('file').click(); });
    $('file').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) loadSource(e.target.files[0]);
      e.target.value = '';
    });
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) loadSource(e.dataTransfer.files[0]);
    });

    $('scan').addEventListener('click', scan);
    // Nhận các ảnh đã gen ở tab Gen về — mỗi ảnh thành một lớp, cắt nền ngay.
    $('pick2').addEventListener('click', function () { $('file2').click(); });
    $('file2').addEventListener('change', function (e) { addCutFiles(e.target.files); e.target.value = ''; });
    var d2 = $('drop2');
    ['dragenter', 'dragover'].forEach(function (ev) {
      d2.addEventListener(ev, function (e) { e.preventDefault(); d2.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      d2.addEventListener(ev, function (e) { e.preventDefault(); d2.classList.remove('over'); });
    });
    d2.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addCutFiles(e.dataTransfer.files);
    });
    $('runAll').addEventListener('click', sendToGen);
    $('recut').addEventListener('click', recutAll);
    $('fit').addEventListener('click', fitAll);
    $('downloadAll').addEventListener('click', saveAll);
    $('download').addEventListener('click', function () {
      $('stage').toBlob(function (b) {
        if (!b) return;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = 'seosona-ghep.png'; a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      }, 'image/png');
    });
    [['tol', 'tolV'], ['soft', 'softV'], ['spill', 'spillV']].forEach(function (p) {
      $(p[0]).addEventListener('input', function () { $(p[1]).textContent = $(p[0]).value; });
    });
    ['outW', 'outH'].forEach(function (id) { $(id).addEventListener('change', renderStage); });

    bindDrag();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
