/* Công cụ dọn metadata — người dùng tự upload file để dùng riêng, không phụ thuộc đường tải tự động.
   Dùng CHUNG engine MetadataScrubber với đường tải về: sửa một chỗ là cả hai cùng được sửa.
   CSP-safe (file ngoài). 100% xử lý trên máy. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var MS = window.MetadataScrubber;
  var drop = $('drop'), fileInput = $('file'), listEl = $('list'), actions = $('actions'),
      saveBtn = $('save'), resetBtn = $('reset'), optsEl = $('opts');
  var items = [];   // { file, out:Uint8Array|null, report, ok }

  // Ô tick theo NHÓM, kèm lý do đọc được — người dùng phải tự quyết được cái gì đáng giữ.
  var picked = {};
  Object.keys(MS.CATEGORIES).forEach(function (k) { picked[k] = true; });
  optsEl.innerHTML = Object.keys(MS.CATEGORIES).map(function (k) {
    var c = MS.CATEGORIES[k];
    return '<label title="' + c.why.replace(/"/g, '&quot;') + '"><input type="checkbox" data-cat="' + k + '" checked> ' + c.label + '</label>';
  }).join('');
  optsEl.addEventListener('change', function (e) {
    var k = e.target && e.target.dataset && e.target.dataset.cat;
    if (!k) return;
    picked[k] = e.target.checked;
    if (items.length) run();          // đổi lựa chọn thì xử lý lại ngay, khỏi bấm thêm nút
  });

  function fmt(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function render() {
    listEl.style.display = items.length ? 'block' : 'none';
    actions.style.display = items.length ? 'flex' : 'none';
    listEl.innerHTML = items.map(function (it) {
      var r = it.report || {};
      var gone = (r.removed || []).length;
      var cats = {};
      (r.removed || []).forEach(function (x) { (x.cats || []).forEach(function (c) { cats[c] = 1; }); });
      var names = Object.keys(cats).map(function (c) { return (MS.CATEGORIES[c] || {}).label || c; });
      var badge = !it.ok ? '<span class="badge skip">Không nhận dạng được</span>'
        : gone ? '<span class="badge dirty">Đã gỡ ' + gone + ' khối</span>'
          : '<span class="badge clean">Vốn đã sạch</span>';
      var det = '';
      if (!it.ok) {
        // Không nhận dạng thì TRẢ NGUYÊN file — sửa mù một container lạ là hỏng file.
        det = 'Định dạng không nhận dạng được → giữ nguyên file, không sửa mù.';
      } else if (gone) {
        det = 'Đã gỡ: <b>' + esc(names.join(', ')) + '</b>'
          + (r.saved > 0 ? ' — nhỏ đi ' + fmt(r.saved) : ' — ghi đè tại chỗ, độ dài file không đổi')
          + '.<br>Giữ lại ' + (r.kept || []).length + ' khối cần cho hiển thị (màu sắc, mật độ điểm ảnh…).';
      } else {
        det = 'Không tìm thấy khối metadata riêng tư nào trong file này.';
      }
      return '<div class="row"><div class="top"><span class="fname">' + esc(it.file.name) + '</span>' + badge + '</div>'
        + '<div class="det">' + det + '</div></div>';
    }).join('');
  }

  async function run() {
    var remove = Object.keys(picked).filter(function (k) { return picked[k]; });
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      try {
        var buf = new Uint8Array(await it.file.arrayBuffer());
        var r = MS.scrub(buf, { remove: remove });
        it.ok = r.ok; it.out = r.bytes; it.report = r.report;
      } catch (e) {
        it.ok = false; it.out = null; it.report = { note: e && e.message };
      }
    }
    render();
  }

  function add(files) {
    items = Array.prototype.slice.call(files).map(function (f) { return { file: f, out: null, report: null, ok: false }; });
    if (items.length) run();
  }

  drop.addEventListener('click', function () { fileInput.click(); });
  // Bấm được bằng chuột thì cũng phải bấm được bằng bàn phím — vùng kéo-thả là <div> nên
  // trình duyệt không tự lo phần này.
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function (e) { add(e.target.files); });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); });
  });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) add(e.dataTransfer.files); });

  saveBtn.addEventListener('click', function () {
    items.forEach(function (it, i) {
      if (!it.out) return;
      // Giữ NGUYÊN tên và đuôi file: đây vẫn là đúng file đó, chỉ bỏ phần mô tả.
      var blob = new Blob([it.out], { type: it.file.type || 'application/octet-stream' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = it.file.name;
      document.body.appendChild(a);
      setTimeout(function () { a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 8000); }, i * 120);
    });
  });
  resetBtn.addEventListener('click', function () { items = []; fileInput.value = ''; render(); });
})();
