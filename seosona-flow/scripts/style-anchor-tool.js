/**
 * style-anchor-tool.js — UI quản lý & áp Style/Character anchor (standalone page).
 * Dùng StyleAnchor (create/list/remove qua chrome.storage khi ở extension context; inject/strip pure).
 * Offline, client-side.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SA = self.StyleAnchor;
  var state = { selected: null }; // {name, block, kind}

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  async function refreshList() {
    var list = $('aList');
    var items = SA && SA.list ? await SA.list() : [];
    if (!items || !items.length) { list.innerHTML = '<div class="empty">Chưa có anchor (lưu ở extension; trang test đơn lẻ không lưu được).</div>'; return; }
    list.innerHTML = '';
    items.forEach(function (a) {
      var div = document.createElement('div');
      div.className = 'anchor-item' + (state.selected && state.selected.name === a.name ? ' sel' : '');
      div.innerHTML = '<span>' + esc(a.name) + '</span><span class="kind">' + esc(a.kind || 'style') + '</span><button class="rm" title="Xoá">×</button>';
      div.addEventListener('click', function (e) { if (e.target.classList.contains('rm')) return; state.selected = a; refreshList(); });
      div.querySelector('.rm').addEventListener('click', async function (e) { e.stopPropagation(); if (SA && SA.remove) await SA.remove(a.name); if (state.selected && state.selected.name === a.name) state.selected = null; refreshList(); });
      list.appendChild(div);
    });
  }

  async function save() {
    var name = ($('aName').value || '').trim();
    var block = ($('aBlock').value || '').trim();
    var kind = $('aKind').value || 'style';
    if (!name || !block) { alert('Nhập tên + khối'); return; }
    if (SA && SA.create) await SA.create(name, block, { kind: kind });
    state.selected = { name: name, block: block, kind: kind };
    refreshList();
  }

  // Khối để chèn: anchor đã chọn > nội dung textarea (fallback cho test đơn lẻ).
  function currentBlock() {
    if (state.selected && state.selected.block) return state.selected.block;
    return ($('aBlock').value || '').trim();
  }

  function inject() {
    if (!SA || !SA.inject) return;
    var block = currentBlock();
    if (!block) { $('pOut').textContent = '(chưa có khối — chọn anchor hoặc nhập vào ô "Khối" bên trái)'; return; }
    $('pOut').textContent = SA.inject($('pIn').value || '', block, { label: $('pLabel').value || 'STYLE' });
  }

  function copy() {
    var t = $('pOut').textContent || '';
    try { navigator.clipboard.writeText(t); } catch (_) { globalThis.SEOSONA_swallow?.('style-anchor-tool#copy', _); }
  }

  function init() {
    $('aSave').addEventListener('click', save);
    $('pInject').addEventListener('click', inject);
    $('pCopy').addEventListener('click', copy);
    refreshList();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
