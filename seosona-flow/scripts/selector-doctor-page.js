/**
 * selector-doctor-page.js — logic trang chẩn đoán selector (pages/selector-doctor.html).
 *
 * Đọc trực tiếp chrome.storage: af_selector_health (lịch sử SelectorDoctor) + af_selector_overrides
 * (bản vá). Nút "Kiểm tra ngay" gửi selector:healthCheck tới tab Flow đang mở.
 * Không cần DevTools, không cần reload extension.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };

  // ── Kiểm tra trực tiếp trên tab Flow ─────────────────────────────────────
  function findFlowTab() {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.query({ url: 'https://labs.google/fx/*' }, function (tabs) {
          void chrome.runtime.lastError;
          resolve(tabs && tabs.length ? tabs[0].id : null);
        });
      } catch (_) { resolve(null); }
    });
  }

  async function runCheck() {
    var box = $('health'), pill = $('healthPill');
    box.className = 'empty'; box.textContent = 'Đang kiểm tra…'; pill.style.display = 'none';

    var tabId = await findFlowTab();
    if (!tabId) { box.textContent = 'Không thấy tab Google Flow nào đang mở. Mở labs.google/fx rồi thử lại.'; return; }

    var res = await new Promise(function (resolve) {
      var done = false, finish = function (v) { if (!done) { done = true; resolve(v); } };
      setTimeout(function () { finish(null); }, 5000);
      try {
        chrome.tabs.sendMessage(tabId, { action: 'selector:healthCheck' }, function (r) { void chrome.runtime.lastError; finish(r || null); });
      } catch (_) { finish(null); }
    });

    if (!res || !res.checked) {
      box.textContent = 'Không nhận được kết quả. Thử tải lại (F5) tab Flow rồi kiểm tra lại.';
      return;
    }

    pill.style.display = '';
    if (res.ok) { pill.className = 'pill ok'; pill.textContent = 'Tất cả OK'; }
    else if (!res.canRun) { pill.className = 'pill blocking'; pill.textContent = 'Chặn chạy'; }
    else { pill.className = 'pill critical'; pill.textContent = 'Có cảnh báo'; }

    if (res.ok) {
      box.className = 'empty';
      box.textContent = 'Đã kiểm ' + res.checked + ' selector — tất cả đều khớp.';
      return;
    }
    box.className = '';
    box.innerHTML = renderTable(res.missing.map(function (m) {
      return {
        sev: m.severity, provider: 'flow', key: m.key, selectors: m.selectors,
        note: m.reason === 'no_config' ? 'thiếu cấu hình' : (m.reason === 'bad_selector' ? 'selector sai cú pháp' : 'không khớp phần tử nào'),
        suggestions: m.suggestions || [],
      };
    })) + '<div class="hint">' + esc(res.summary.split('\n')[0]) + ' · Đã kiểm ' + res.checked + ' selector'
      + (res.skipped ? ' · bỏ qua ' + res.skipped + ' key chỉ xuất hiện theo trạng thái (menu/hộp thoại/tile) để tránh báo nhầm' : '') + '.</div>';
  }

  // Gợi ý tự dò được → bấm 1 phát là áp dụng luôn, khỏi tự Inspect.
  function renderSuggestions(r) {
    var s = r.suggestions || [];
    if (!s.length) return '';
    return '<div class="sugg">Gợi ý thay thế:'
      + s.map(function (c) {
        return ' <button class="chip btn-apply" data-p="' + esc(r.provider) + '" data-k="' + esc(r.key) + '" data-s="' + esc(c.selector) + '" title="'
          + esc(c.matches + ' phần tử khớp' + (c.text ? ' · “' + c.text + '”' : '')) + '">' + esc(c.selector) + '</button>';
      }).join('') + '</div>';
  }

  function renderTable(rows) {
    return '<table><thead><tr><th>Mức</th><th>Provider</th><th>Key</th><th>Selector đang dùng</th><th>Tình trạng</th><th></th></tr></thead><tbody>'
      + rows.map(function (r) {
        return '<tr>'
          + '<td><span class="pill ' + esc(r.sev || 'degraded') + '">' + esc(r.sev || '—') + '</span></td>'
          + '<td>' + esc(r.provider) + '</td>'
          + '<td><code>' + esc(r.key) + '</code></td>'
          + '<td><code>' + esc(r.selectors ? [].concat(r.selectors).join(' , ') : '(không có)') + '</code></td>'
          + '<td>' + esc(r.note || '') + renderSuggestions(r) + '</td>'
          + '<td><button class="ghost btn-fill" data-p="' + esc(r.provider) + '" data-k="' + esc(r.key) + '">Vá</button></td>'
          + '</tr>';
      }).join('') + '</tbody></table>';
  }

  // ── Lịch sử SelectorDoctor ───────────────────────────────────────────────
  // Ngoài ngữ cảnh extension (mở bằng file/http) thì chrome.* không có → báo rõ, không trắng trang.
  function hasStorage() {
    try { return !!(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local); } catch (_) { return false; }
  }

  function loadDoctor() {
    if (!hasStorage()) { $('doctor').textContent = 'Cần mở trang này từ trong extension.'; return; }
    chrome.storage.local.get(['af_selector_health'], function (st) {
      var box = $('doctor');
      var stats = (st && st.af_selector_health && st.af_selector_health.stats) || {};
      var rows = Object.keys(stats).map(function (k) { return stats[k]; })
        .filter(function (e) { return (e.notFound || 0) + (e.noConfig || 0) > 0; })
        .sort(function (a, b) { return (b.notFound + b.noConfig) - (a.notFound + a.noConfig); });
      if (!rows.length) { box.className = 'empty'; box.textContent = 'Chưa ghi nhận selector nào gãy.'; return; }
      box.className = '';
      box.innerHTML = renderTable(rows.map(function (e) {
        return {
          sev: e.ok > 0 ? 'degraded' : 'critical', provider: e.provider, key: e.key, selectors: e.selectors,
          note: 'hỏng ' + (e.notFound + e.noConfig) + ' lần' + (e.ok ? ', từng OK ' + e.ok : '') + (e.version != null ? ' · v' + e.version : ''),
        };
      }));
    });
  }

  // ── Bản vá ───────────────────────────────────────────────────────────────
  function loadOverrides() {
    if (!hasStorage()) { $('overrides').textContent = 'Cần mở trang này từ trong extension.'; return; }
    chrome.storage.local.get(['af_selector_overrides'], function (st) {
      var box = $('overrides');
      var data = (st && st.af_selector_overrides) || {};
      var rows = [];
      Object.keys(data).forEach(function (p) { Object.keys(data[p] || {}).forEach(function (k) { rows.push({ provider: p, key: k, selectors: data[p][k] }); }); });
      if (!rows.length) { box.className = 'empty'; box.textContent = 'Chưa có bản vá nào.'; return; }
      box.className = '';
      box.innerHTML = '<table><thead><tr><th>Provider</th><th>Key</th><th>Selector thay thế</th><th></th></tr></thead><tbody>'
        + rows.map(function (r) {
          return '<tr><td>' + esc(r.provider) + '</td><td><code>' + esc(r.key) + '</code></td><td><code>' + esc([].concat(r.selectors).join(' , ')) + '</code></td>'
            + '<td><button class="danger btn-del" data-p="' + esc(r.provider) + '" data-k="' + esc(r.key) + '">Xoá</button></td></tr>';
        }).join('') + '</tbody></table>';
    });
  }

  function refresh() { loadDoctor(); loadOverrides(); }

  // ── Sự kiện ──────────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var fill = e.target.closest('.btn-fill');
    if (fill) {
      $('ovProvider').value = fill.dataset.p || 'flow';
      $('ovKey').value = fill.dataset.k || '';
      $('ovSel').focus();
      return;
    }
    var apply = e.target.closest('.btn-apply');
    if (apply && self.SelectorOverride) {
      // 1 cú bấm = vá xong, hiệu lực ngay ở mọi tab.
      self.SelectorOverride.set(apply.dataset.p, apply.dataset.k, apply.dataset.s).then(function () {
        apply.textContent = '✓ đã vá';
        refresh();
      });
      return;
    }
    var del = e.target.closest('.btn-del');
    if (del && self.SelectorOverride) {
      self.SelectorOverride.remove(del.dataset.p, del.dataset.k).then(refresh);
    }
  });

  $('btnAdd').addEventListener('click', function () {
    var p = $('ovProvider').value.trim(), k = $('ovKey').value.trim(), s = $('ovSel').value.trim();
    if (!p || !k || !s) { alert('Cần đủ provider, key và selector.'); return; }
    self.SelectorOverride.set(p, k, s).then(function () { $('ovKey').value = ''; $('ovSel').value = ''; refresh(); });
  });

  $('btnCheck').addEventListener('click', runCheck);
  $('btnReload').addEventListener('click', refresh);
  $('btnClearHist').addEventListener('click', function () {
    chrome.storage.local.remove('af_selector_health', function () { if (self.SelectorDoctor) self.SelectorDoctor.reset(); refresh(); });
  });

  refresh();
})();
