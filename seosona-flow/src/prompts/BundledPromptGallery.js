/**
 * BundledPromptGallery — gallery các prompt đóng gói (SEOSONA_BUNDLED_PROMPTS) hiển thị trong
 * sub-tab "Templates" của tab Prompts (LOCAL mode). KHÔNG auto-nhét vào My Prompts; user bấm
 * "＋ Thêm vào My Prompt" mới copy 1 cái vào kho (af_user_prompts). Tự-chứa, offline.
 */
(function (root) {
  'use strict';

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function toast(msg, kind) {
    try {
      var t = document.createElement('div');
      t.className = 'bpg-toast' + (kind === 'warn' ? ' warn' : '');
      t.textContent = msg;
      document.body.appendChild(t);
      requestAnimationFrame(function () { t.classList.add('show'); });
      setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); }, 2200);
    } catch (_) { globalThis.SEOSONA_swallow?.('BundledPromptGallery#setTimeout', _); }
  }

  var STYLE_ID = 'bpg-style';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.bpg{padding:8px 12px}',
      '.bpg-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px}',
      '.bpg-search{flex:1;min-width:160px;display:flex;align-items:center;gap:6px;background:var(--surface-elevated,#2a2a30);border:1px solid transparent;border-radius:var(--sf-radius-pill, 999px);padding:8px 14px}',
      '.bpg-search:focus-within{border-color:var(--sf-color-accent,#3d6ff5);}',
      '.bpg-search input{border:0;background:transparent;color:var(--foreground,#e8e8ea);font-size:13px;width:100%;outline:none;font-family:inherit}',
      '.bpg-cat{background:var(--surface-elevated,#2a2a30);border:1px solid transparent;color:var(--foreground,#e8e8ea);border-radius:var(--sf-radius-pill, 999px);padding:8px 14px;font-size:13px;font-family:inherit;outline:none;cursor:pointer}',
      '.bpg-cat:hover{background:rgba(255,255,255,.08)}',
      '.bpg-count{color:var(--muted-foreground,#9a9aa2);font-size:12px;font-variant-numeric:tabular-nums;margin-left:auto}',
      '.bpg-grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:10px}',
      '.bpg-card{background:#1c1d24;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 12px;transition:transform 0.2s,box-shadow 0.2s,border-color 0.2s;display:flex;flex-direction:column;gap:6px}',
      '.bpg-card:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,0,0,.3);border-color:rgba(255,255,255,.18)}',
      '.bpg-card.hide{display:none}',
      '.bpg-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}',
      '.bpg-top h4{margin:0;font-size:13px;font-weight:600;color:var(--foreground,#fff);line-height:1.35}',
      '.bpg-kind{font-size:9px;font-weight:600;padding:2px 6px;border-radius:4px;text-transform:uppercase;letter-spacing:.02em;background:rgba(255,255,255,.08);color:var(--foreground,#fff);white-space:nowrap}',
      '.bpg-kind.skill{background:rgba(168,85,247,.16);color:#c99bf5}',
      '.bpg-kind.reference{background:rgba(25,208,123,.15);color:#4fd39b}',
      '.bpg-desc{color:#d4d4d8;font-size:12px;line-height:1.45;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.bpg-slots{display:flex;flex-wrap:wrap;gap:4px;margin:0}',
      '.bpg-slot-pill{font-size:10.5px;color:#93c5fd;background:rgba(59,130,246,.12);padding:2px 6px;border-radius:4px;font-family:monospace;border:1px solid rgba(59,130,246,.25)}',
      '.bpg-thumb{width:100%;aspect-ratio:16/9;height:auto;object-fit:cover;border-radius:6px;background:#111;display:block}',
      '.bpg-meta{display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:auto}',
      '.bpg-tier{font-size:9px;font-weight:800;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px}',
      '.bpg-tier.S{background:#f5c518;color:#3a2c00}.bpg-tier.A{background:rgba(61,111,245,.22);color:#7aa0ff}.bpg-tier.B{background:rgba(255,255,255,.1);color:#aeb8d0}.bpg-tier.C{background:rgba(255,255,255,.06);color:#9a9aa2}',
      '.bpg-tag{font-size:10px;color:var(--muted-foreground,#a1a1aa);background:var(--background,#09090b);border:1px solid var(--border,rgba(255,255,255,.1));padding:2px 6px;border-radius:4px;cursor:pointer;transition:all 0.2s}',
      '.bpg-tag:hover{background:var(--sf-color-accent,#3d6ff5);color:#fff;border-color:transparent}',
      '.bpg-actions{display:flex;align-items:center;gap:6px;margin-top:2px}',
      '.bpg-add{flex:1;height:28px;border:1px solid var(--sf-color-accent,#3d6ff5);border-radius:6px;background:transparent;color:var(--sf-color-accent,#3d6ff5);font-weight:500;font-size:12px;padding:0 10px;cursor:pointer;font-family:inherit;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:4px;box-sizing:border-box}',
      '.bpg-add:hover{background:var(--sf-color-accent,#3d6ff5);color:#fff}',
      '.bpg-add.added{border:1px solid rgba(34,197,94,.25);background:rgba(34,197,94,.12);color:#4ade80;cursor:default;font-weight:500}',
      '.bpg-add.added:hover{background:rgba(34,197,94,.12);color:#4ade80}',
      '.bpg-copy{width:28px;height:28px;flex-shrink:0;border:1px solid rgba(255,255,255,.1);background:transparent;color:#e4e4e7;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;box-sizing:border-box}',
      '.bpg-copy:hover{background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.2)}',
      '.bpg-empty{color:var(--muted-foreground,#9a9aa2);text-align:center;padding:30px 16px;font-size:12px}',
      '.bpg-toast{position:fixed;left:50%;bottom:20px;transform:translate(-50%,12px);background:#1c1c22;color:#fff;border:1px solid rgba(255,255,255,.14);padding:8px 14px;border-radius:8px;font-size:12px;z-index:9999;opacity:0;transition:opacity .2s,transform .2s;box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:90vw}',
      '.bpg-toast.show{opacity:1;transform:translate(-50%,0)}',
      '.bpg-toast.warn{border-color:rgba(245,197,24,.4)}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function BundledPromptGallery(container) {
    this.container = container;
    this.data = (root.SEOSONA_BUNDLED_PROMPTS || []).slice();
    this.q = '';
    this.cat = '';
    this.tier = '';
    this.kind = '';
    this._addedIds = {};
  }

  BundledPromptGallery.prototype.init = function () {
    injectStyle();
    var self = this;
    this._refreshAdded(function () { self.render(); });
  };

  // Đọc af_user_prompts → biết prompt nào đã thêm (id = 'tpl_'+origId).
  BundledPromptGallery.prototype._refreshAdded = function (cb) {
    var self = this;
    try {
      chrome.storage.local.get(['af_user_prompts'], function (st) {
        var arr = Array.isArray(st.af_user_prompts) ? st.af_user_prompts : [];
        var m = {}; arr.forEach(function (p) { if (p && p.id != null) m[String(p.id)] = 1; });
        self._addedIds = m; cb && cb();
      });
    } catch (_) { cb && cb(); }
  };

  BundledPromptGallery.prototype.render = function () {
    var cats = ['', '🎬 Video Prompting', '🎨 Ảnh mẫu', 'Image/Video Prompting', 'Content Creation', 'Agent Skills / Prompt Ops', 'SEO / Marketing'];
    var catOpts = cats.map(function (c) {
      var label = c || ('Tất cả danh mục');
      return '<option value="' + esc(c) + '"' + (c === this.cat ? ' selected' : '') + '>' + esc(label) + '</option>';
    }, this).join('');
    this.container.innerHTML =
      '<div class="bpg">' +
      '<div class="sf-toolbar" style="flex-wrap: wrap; overflow: visible; gap: 10px 8px;">' +
      '<label class="sf-search-box"><svg class="sf-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
      '<input id="bpgSearch" type="search" class="sf-search-input" placeholder="Tìm prompt mẫu…" autocomplete="off"></label>' +
      '<button class="btn btn-secondary btn-sm btn-toolbar-icon sf-reload-btn" title="Tải lại">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>' +
      '</button>' +
      '<select id="bpgCat" class="sf-filter-select" style="max-width: fit-content !important;">' + catOpts + '</select>' +
      '<select id="bpgKind" class="sf-filter-select" style="max-width: fit-content !important;">' +
        ['', 'prompt', 'skill', 'reference', 'template'].map(function (k) {
          var label = k ? (k === 'prompt' ? 'Prompt' : k === 'skill' ? 'Skill' : k === 'reference' ? 'Reference' : 'Template') : 'Mọi loại';
          return '<option value="' + k + '"' + (k === this.kind ? ' selected' : '') + '>' + label + '</option>';
        }, this).join('') +
      '</select>' +
      '<select id="bpgTier" class="sf-filter-select" style="max-width: fit-content !important;">' +
        ['', 'S', 'A', 'B', 'C'].map(function (tr) {
          return '<option value="' + tr + '"' + (tr === this.tier ? ' selected' : '') + '>' + (tr ? 'Tier ' + tr : 'Mọi tier') + '</option>';
        }, this).join('') +
      '</select>' +
      '<div class="sf-spacer"></div>' +
      '<span class="bpg-count" id="bpgCount"></span>' +
      '</div>' +
      '<div class="bpg-grid" id="bpgGrid"></div>' +
      '<div class="bpg-empty" id="bpgEmpty" style="display:none">Không có prompt mẫu khớp.</div>' +
      '</div>';
    var self = this;
    this.container.querySelector('#bpgSearch').addEventListener('input', function (e) { self.q = e.target.value.toLowerCase().trim(); self._renderGrid(); });
    this.container.querySelector('#bpgCat').addEventListener('change', function (e) { self.cat = e.target.value; self._renderGrid(); });
    this.container.querySelector('#bpgKind').addEventListener('change', function (e) { self.kind = e.target.value; self._renderGrid(); });
    this.container.querySelector('#bpgTier').addEventListener('change', function (e) { self.tier = e.target.value; self._renderGrid(); });
    var reloadBtn = this.container.querySelector('.sf-reload-btn');
    if (reloadBtn) reloadBtn.addEventListener('click', function () { self._refreshAdded(function () { self.render(); }); });
    this.container.querySelector('#bpgGrid').addEventListener('click', function (e) {
      var addBtn = e.target.closest('.bpg-add'); var copyBtn = e.target.closest('.bpg-copy'); var tagEl = e.target.closest('.bpg-tag');
      if (addBtn && !addBtn.classList.contains('added')) self._add(addBtn.dataset.id, addBtn);
      else if (copyBtn) self._copy(copyBtn.dataset.id);
      else if (tagEl && tagEl.dataset.tag) { // click tag → lọc theo tag đó (reset các filter khác để không ra rỗng khó hiểu)
        self.q = tagEl.dataset.tag.toLowerCase();
        self.cat = ''; self.kind = ''; self.tier = '';
        var si = self.container.querySelector('#bpgSearch'); if (si) si.value = tagEl.dataset.tag;
        var cs = self.container.querySelector('#bpgCat'); if (cs) cs.value = '';
        var ks = self.container.querySelector('#bpgKind'); if (ks) ks.value = '';
        var ts = self.container.querySelector('#bpgTier'); if (ts) ts.value = '';
        self._renderGrid();
      }
    });
    this._renderGrid();
    this._loadMeigen(); // lazy: nạp kho ảnh mẫu (2.4MB JSON) SAU khi render, không chặn khởi động
  };

  // Nạp data/meigen.json 1 lần (lazy) → merge vào this.data → render lại grid. Không parse JS lúc boot.
  BundledPromptGallery.prototype._loadMeigen = function () {
    if (this._meigenLoaded) return;
    this._meigenLoaded = true;
    var self = this;
    try {
      var url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('data/meigen.json') : 'data/meigen.json';
      fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (arr) {
        if (!Array.isArray(arr) || !arr.length) return;
        var have = {}; self.data.forEach(function (p) { have[p.id] = 1; });
        for (var i = 0; i < arr.length; i++) if (!have[arr[i].id]) self.data.push(arr[i]);
        self._renderGrid();
      }).catch(function (_e) { globalThis.SEOSONA_swallow?.('BundledPromptGallery#_loadMeigen', _e); });
    } catch (_) { globalThis.SEOSONA_swallow?.('BundledPromptGallery#_loadMeigen', _); }
  };

  BundledPromptGallery.prototype._filtered = function () {
    var q = this.q, cat = this.cat, tier = this.tier, kind = this.kind;
    return this.data.filter(function (p) {
      if (cat && p.category !== cat) return false;
      if (tier && p.tier !== tier) return false;
      if (kind && (p.kind || 'prompt') !== kind) return false;
      if (!q) return true;
      var hay = (p.title + ' ' + p.content + ' ' + (p.tags || []).join(' ')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  };

  BundledPromptGallery.prototype._card = function (p) {
    var added = !!this._addedIds['tpl_' + p.id];
    var kind = p.kind || 'prompt';
    var tier = p.tier ? '<span class="bpg-tier ' + p.tier + '">' + p.tier + '</span>' : '';
    var tags = (p.tags || []).slice(0, 3).map(function (t) { return '<span class="bpg-tag" data-tag="' + esc(t) + '" title="Lọc theo tag này">' + esc(t) + '</span>'; }).join('');
    // Gợi ví dụ điền cho các {placeholder} (pattern slot+example của prompt-library) — tính live, guarded.
    var slotsHint = '';
    try {
      var PS = (typeof self !== 'undefined' && self.PromptSlots) || (typeof window !== 'undefined' && window.PromptSlots);
      if (PS && PS.hint) {
         var h = PS.hint(p.content);
         if (h) {
            slotsHint = '<div class="bpg-slots" title="Ví dụ điền cho các {placeholder}">' +
               h.split(' · ').map(function(s) { return '<span class="bpg-slot-pill">' + esc(s) + '</span>'; }).join('') +
               '</div>';
         }
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('BundledPromptGallery#_card', _); }
    // Ảnh cover mẫu (data/meigen-images) qua getURL — nhỏ gọn, không attribution. Guarded.
    var img = '';
    try {
      if (p.image_local && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        img = '<img class="bpg-thumb" src="' + esc(chrome.runtime.getURL(p.image_local)) + '" loading="lazy" alt="">';
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('BundledPromptGallery#_card', _); }
    // Remove the separate variables row to match modern compact layout where vars are highlighted in text.
    return '<div class="bpg-card' + (img ? ' has-thumb' : '') + '">' +
      img +
      '<div class="bpg-top"><h4>' + esc(p.title) + '</h4><span class="bpg-kind ' + kind + '">' + esc(kind) + '</span></div>' +
      '<p class="bpg-desc">' + esc(p.content) + '</p>' +
      slotsHint +
      '<div class="bpg-meta">' + tier + tags + '</div>' +
      '<div class="bpg-actions">' +
      '<button class="bpg-add' + (added ? ' added' : '') + '" data-id="' + esc(p.id) + '">' + (added ? '✓ Đã thêm' : '+ Thêm vào My Prompt') + '</button>' +
      '<button class="bpg-copy" data-id="' + esc(p.id) + '" title="Sao chép prompt"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>' +
      '</div></div>';
  };

  BundledPromptGallery.prototype._renderGrid = function () {
    var list = this._filtered();
    var grid = this.container.querySelector('#bpgGrid');
    var empty = this.container.querySelector('#bpgEmpty');
    var count = this.container.querySelector('#bpgCount');
    if (count) count.textContent = list.length + ' / ' + this.data.length + ' prompt';
    if (!list.length) { grid.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
    if (empty) empty.style.display = 'none';
    grid.innerHTML = list.map(this._card, this).join('');
  };

  BundledPromptGallery.prototype._find = function (id) {
    for (var i = 0; i < this.data.length; i++) if (String(this.data[i].id) === String(id)) return this.data[i];
    return null;
  };

  BundledPromptGallery.prototype._add = function (id, btn) {
    var e = this._find(id); if (!e) return;
    var self = this; var newId = 'tpl_' + e.id;
    try {
      chrome.storage.local.get(['af_user_prompts'], function (st) {
        var arr = Array.isArray(st.af_user_prompts) ? st.af_user_prompts : [];
        if (arr.some(function (p) { return String(p.id) === newId; })) {
          toast('"' + e.title + '" đã có trong My Prompt', 'warn');
          self._addedIds[newId] = 1; if (btn) { btn.classList.add('added'); btn.textContent = '✓ Đã thêm'; }
          return;
        }
        arr.push(root.normalizeBundledPrompt(e, { newId: newId, created_at: new Date().toISOString() }));
        chrome.storage.local.set({ af_user_prompts: arr }, function () {
          self._addedIds[newId] = 1;
          if (btn) { btn.classList.add('added'); btn.textContent = '✓ Đã thêm'; }
          toast('Đã thêm "' + e.title + '" vào My Prompt');
          // refresh danh sách My Prompt nếu đang mở
          try { if (root.MyPromptsTab && root.MyPromptsTab._loadPrompts) root.MyPromptsTab._loadPrompts(); } catch (_) { globalThis.SEOSONA_swallow?.('BundledPromptGallery#_add', _); }
          try { if (root.UserPromptsManager && root.UserPromptsManager.invalidate) root.UserPromptsManager.invalidate(); } catch (_) { globalThis.SEOSONA_swallow?.('BundledPromptGallery#_add', _); }
        });
      });
    } catch (_) { toast('Không thêm được, thử lại.', 'warn'); }
  };

  BundledPromptGallery.prototype._copy = function (id) {
    var e = this._find(id); if (!e) return;
    try {
      navigator.clipboard.writeText(e.content).then(function () { toast('Đã sao chép nội dung prompt'); },
        function () { toast('Không sao chép được', 'warn'); });
    } catch (_) { toast('Không sao chép được', 'warn'); }
  };

  root.BundledPromptGallery = BundledPromptGallery;
})(typeof window !== 'undefined' ? window : this);
