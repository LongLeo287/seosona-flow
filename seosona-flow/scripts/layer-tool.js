/**
 * layer-tool.js — giao diện cho công cụ Tách lớp.
 *
 * Toàn bộ phép toán nằm ở src/layers/ (LayerPrompt, LayerCutout, LayerStack) và đã có 16 test.
 * File này chỉ nối chúng với DOM: đọc ảnh, gọi cắt nền, vẽ xem trước, xuất PNG.
 *
 * Nguyên tắc giữ suốt file: LỚP GỐC không bao giờ bị sửa. Mọi thao tác (di chuyển, phóng to,
 * đổi thứ tự) chỉ đổi CON SỐ trong danh sách, rồi ghép lại từ đầu. Nhờ vậy hoàn tác chỉ là
 * khôi phục vài con số, và ghép bao nhiêu lần cũng không tích luỹ sai số.
 */
(function () {
  'use strict';

  var LP = window.SEOSONA_LayerPrompt;
  var CO = window.SEOSONA_LayerCutout;
  var ST = window.SEOSONA_LayerStack;

  var $ = function (id) { return document.getElementById(id); };
  var layers = [];      // [{id, name, image (RGBA đã cắt), source (ảnh gốc), x, y, scale, z, visible, cut}]
  var selected = null;
  var seq = 0;

  // ── phần 1: prompt ────────────────────────────────────────────────────────────────────
  function buildPrompt() {
    var subject = $('subject').value.trim();
    var note = $('promptNote');
    if (!subject) {
      $('promptOut').value = '';
      $('copyPrompt').disabled = true;
      note.textContent = 'Nhập tên vật trước — mỗi lớp một vật.';
      return;
    }
    try {
      var p = LP.build(subject, { backdrop: $('backdrop').value });
      $('promptOut').value = p.positive + '\n\nNEGATIVE: ' + p.negative;
      $('copyPrompt').disabled = false;
      note.textContent = 'Chép sang Flow/ChatGPT, gen xong tải ảnh về rồi thả vào bước 2.';
    } catch (e) {
      $('promptOut').value = '';
      $('copyPrompt').disabled = true;
      note.textContent = 'Lỗi: ' + (e && e.message);
    }
  }

  // ── phần 2: nạp ảnh + cắt nền ─────────────────────────────────────────────────────────
  function readImage(file) {
    return new Promise(function (res, rej) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        try { res(c.getContext('2d').getImageData(0, 0, c.width, c.height)); }
        catch (e) { rej(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('không đọc được ảnh')); };
      img.src = url;
    });
  }

  function cutOpts() {
    return {
      tolerance: +$('tol').value,
      softness: +$('soft').value,
      despill: (+$('spill').value) / 100,
    };
  }

  async function addFiles(files) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!/^image\//.test(f.type)) continue;
      try {
        var src = await readImage(f);
        var cut = CO.cutout(src, cutOpts());
        layers.push({
          id: 'L' + (++seq),
          name: f.name.replace(/\.[^.]+$/, ''),
          source: src,            // GIỮ ảnh gốc để cắt lại với thông số khác mà không mất chất
          image: cut.image,
          cut: cut,
          x: 0, y: 0, scale: 1, z: layers.length, visible: true,
        });
      } catch (e) {
        console.warn('[layer-tool] bỏ qua', f.name, e && e.message);
      }
    }
    render();
  }

  function recutAll() {
    var o = cutOpts();
    layers = layers.map(function (l) {
      // Cắt lại từ ẢNH GỐC, không phải từ bản đã cắt — cắt chồng cắt là mất chi tiết biên.
      var cut = CO.cutout(l.source, o);
      var copy = {}; for (var k in l) copy[k] = l[k];
      copy.image = cut.image; copy.cut = cut;
      return copy;
    });
    render();
  }

  // ── phần 3: danh sách lớp ─────────────────────────────────────────────────────────────
  function thumb(rgba) {
    var c = document.createElement('canvas');
    var s = 44, r = Math.min(s / rgba.width, s / rgba.height);
    c.width = s; c.height = s;
    var tmp = document.createElement('canvas');
    tmp.width = rgba.width; tmp.height = rgba.height;
    tmp.getContext('2d').putImageData(new ImageData(rgba.data, rgba.width, rgba.height), 0, 0);
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    var w = rgba.width * r, h = rgba.height * r;
    ctx.drawImage(tmp, (s - w) / 2, (s - h) / 2, w, h);
    return c;
  }

  function renderLayers() {
    var box = $('layers');
    box.textContent = '';
    if (!layers.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'Chưa có lớp nào.';
      box.appendChild(e);
      return;
    }
    var sorted = layers.slice().sort(function (a, b) { return b.z - a.z; });  // trên cùng hiện trước
    sorted.forEach(function (l) {
      var row = document.createElement('div');
      row.className = 'layer' + (selected === l.id ? ' sel' : '');

      var th = document.createElement('div');
      th.className = 'th';
      th.appendChild(thumb(l.image));
      row.appendChild(th);

      var info = document.createElement('div');
      info.className = 'info';
      var nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = l.name;
      info.appendChild(nm);
      var meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = l.image.width + '×' + l.image.height
        + ' · giữ ' + Math.round(l.cut.keptRatio * 100) + '%'
        + ' · z' + l.z + ' · ' + Math.round(l.scale * 100) + '%';
      info.appendChild(meta);
      // Cảnh báo của LayerCutout hiện THẲNG ở đây — người dùng cần biết ảnh nào không hợp
      // để tách lớp, chứ không phải tự đoán khi thấy kết quả xấu.
      (l.cut.warnings || []).forEach(function (w) {
        var wd = document.createElement('div');
        wd.className = 'warn';
        wd.textContent = '⚠ ' + w;
        info.appendChild(wd);
      });
      row.appendChild(info);

      [['▲', function () { move(l.id, +1); }], ['▼', function () { move(l.id, -1); }],
       [l.visible ? '👁' : '🚫', function () { toggle(l.id); }], ['✕', function () { remove(l.id); }]]
        .forEach(function (pair) {
          var b = document.createElement('button');
          b.className = 'mini';
          b.textContent = pair[0];
          b.addEventListener('click', function (ev) { ev.stopPropagation(); pair[1](); });
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

  // ── phần 4: ghép + xuất ───────────────────────────────────────────────────────────────
  function renderStage() {
    var W = Math.max(16, +$('outW').value || 1024);
    var H = Math.max(16, +$('outH').value || 1024);
    var cv = $('stage');
    cv.width = W; cv.height = H;
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
    $('outW').value = Math.max(16, w);
    $('outH').value = Math.max(16, h);
    render();
  }

  function download() {
    $('stage').toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'seosona-layers.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }, 'image/png');
  }

  function render() {
    renderLayers();
    renderStage();
    var has = layers.length > 0;
    $('download').disabled = !has;
    $('recut').disabled = !has;
  }

  // ── kéo lớp đang chọn trên khung xem trước ────────────────────────────────────────────
  function bindDrag() {
    var cv = $('stage');
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    cv.addEventListener('mousedown', function (e) {
      if (!selected) return;
      var l = layers.find(function (x) { return x.id === selected; });
      if (!l) return;
      dragging = true;
      var r = cv.getBoundingClientRect();
      var k = cv.width / r.width;
      sx = (e.clientX - r.left) * k; sy = (e.clientY - r.top) * k;
      ox = l.x || 0; oy = l.y || 0;
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging || !selected) return;
      var r = cv.getBoundingClientRect();
      var k = cv.width / r.width;
      var dx = (e.clientX - r.left) * k - sx;
      var dy = (e.clientY - r.top) * k - sy;
      layers = ST.update(layers, selected, { x: Math.round(ox + dx), y: Math.round(oy + dy) });
      renderStage();
    });
    window.addEventListener('mouseup', function () {
      if (dragging) { dragging = false; render(); }
    });
    // Lăn chuột = phóng to/thu nhỏ lớp đang chọn.
    cv.addEventListener('wheel', function (e) {
      if (!selected) return;
      e.preventDefault();
      var l = layers.find(function (x) { return x.id === selected; });
      if (!l) return;
      var s = Math.max(0.05, Math.min(8, (l.scale || 1) * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
      layers = ST.update(layers, selected, { scale: s });
      render();
    }, { passive: false });
  }

  function init() {
    if (!LP || !CO || !ST) {
      document.body.textContent = 'Thiếu module tách lớp — kiểm tra thứ tự script trong layer-tool.html.';
      return;
    }
    $('genPrompt').addEventListener('click', buildPrompt);
    $('subject').addEventListener('keydown', function (e) { if (e.key === 'Enter') buildPrompt(); });
    $('backdrop').addEventListener('change', function () { if ($('subject').value.trim()) buildPrompt(); });
    $('copyPrompt').addEventListener('click', function () {
      navigator.clipboard.writeText($('promptOut').value).then(function () {
        $('promptNote').textContent = 'Đã chép.';
      }).catch(function (e) { globalThis.SEOSONA_swallow?.('layer-tool#copy', e); });
    });

    $('pick').addEventListener('click', function () { $('file').click(); });
    $('file').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });

    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });

    [['tol', 'tolV'], ['soft', 'softV'], ['spill', 'spillV']].forEach(function (p) {
      $(p[0]).addEventListener('input', function () { $(p[1]).textContent = $(p[0]).value; });
    });
    $('recut').addEventListener('click', recutAll);
    $('fit').addEventListener('click', fitAll);
    $('download').addEventListener('click', download);
    ['outW', 'outH'].forEach(function (id) { $(id).addEventListener('change', renderStage); });

    bindDrag();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
