/**
 * motion-preview.js — duyệt + xem trước + copy CSS thư viện MotionRecipes (standalone page).
 * Dùng MotionRecipes.all/find/css/byTrigger. Offline, client-side.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var MR = self.MotionRecipes;
  var TRIGGERS = ['all', 'entrance', 'emphasis', 'attention', 'exit'];
  var LABEL = { all: 'Tất cả', entrance: 'Vào', emphasis: 'Nhấn', attention: 'Thu hút', exit: 'Ra' };
  var current = 'all';
  var styleEl;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function ensureStyle(id) {
    if (!styleEl) { styleEl = document.createElement('style'); document.head.appendChild(styleEl); }
    // gộp css của mọi recipe đang hiển thị (idempotent)
    var css = MR.cssBundle ? MR.cssBundle(currentIds()) : (MR.css ? currentIds().map(MR.css).join('\n') : '');
    styleEl.textContent = css;
  }
  function currentIds() { return list().map(function (r) { return r.id; }); }
  function list() { return current === 'all' ? MR.all() : MR.byTrigger(current); }

  function play(el, id) {
    el.classList.remove('sf-motion-' + id);
    void el.offsetWidth; // reflow → replay
    el.classList.add('sf-motion-' + id);
  }

  function render() {
    var recipes = list();
    $('count').textContent = recipes.length + ' recipe';
    ensureStyle();
    var grid = $('grid');
    grid.innerHTML = '';
    recipes.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'rc';
      card.innerHTML =
        '<div class="stage"><div class="box sf-motion-' + r.id + '"></div></div>' +
        '<div class="name">' + esc(r.name) + '</div>' +
        '<div class="meta">' + esc(r.trigger) + ' · ' + esc(r.duration) + '</div>' +
        '<div class="foot"><button data-a="play">▶ Chạy lại</button><button data-a="copy">Copy CSS</button></div>';
      var box = card.querySelector('.box');
      card.querySelector('[data-a="play"]').addEventListener('click', function () { play(box, r.id); });
      card.querySelector('[data-a="copy"]').addEventListener('click', function () { try { navigator.clipboard.writeText(MR.css(r.id)); } catch (_) { globalThis.SEOSONA_swallow?.('motion-preview#render', _); } });
      grid.appendChild(card);
    });
  }

  function renderFilters() {
    var f = $('filters');
    f.innerHTML = '';
    TRIGGERS.forEach(function (t) {
      var b = document.createElement('button');
      b.textContent = LABEL[t] || t;
      if (t === current) b.className = 'on';
      b.addEventListener('click', function () { current = t; renderFilters(); render(); });
      f.appendChild(b);
    });
  }

  function init() {
    if (!MR) { $('grid').innerHTML = '<div style="color:#9498a1">MotionRecipes chưa load.</div>'; return; }
    renderFilters();
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
