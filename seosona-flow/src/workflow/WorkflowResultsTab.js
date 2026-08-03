/**
 * WorkflowResultsTab — xem KẾT QUẢ các lần chạy workflow (nửa sau của WorkflowResultsStore).
 *
 * Dữ liệu do background ghi khi workflow chạy (execution:started / node:completed / execution:completed),
 * lưu ở IndexedDB qua WorkflowResultsStore. Tab này CHỈ ĐỌC: liệt kê run → xem bảng dòng → tải CSV.
 *
 * Mọi truy cập đi qua message 'workflowResults:*' (background kiểm _isTrustedSender) — sidebar KHÔNG
 * mở IndexedDB trực tiếp để chỉ có 1 nguồn ghi/đọc.
 */
(function (root) {
  'use strict';

  const esc = (s) => {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  };

  function bg(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
          resolve(resp || { ok: false, error: 'NO_RESPONSE' });
        });
      } catch (e) { resolve({ ok: false, error: e && e.message }); }
    });
  }

  function fmtTime(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return String(ts); }
  }

  const STATUS_LABEL = { running: 'Đang chạy', completed: 'Hoàn tất', failed: 'Lỗi' };

  class WorkflowResultsTab {
    static _instance = null;

    static init(container) {
      if (!this._instance) this._instance = new WorkflowResultsTab(container);
      return this._instance;
    }
    static getInstance() { return this._instance; }

    constructor(container) {
      this.el = container;
      this._currentRunId = null;
      this._bind();
      this.refresh();
    }

    _bind() {
      if (!this.el || this.el._wfrBound) return;
      this.el._wfrBound = true;
      // 1 listener uỷ quyền cho cả tab → không leak khi render lại.
      this.el.addEventListener('click', (e) => {
        const t = e.target.closest('[data-wfr-act]');
        if (!t) return;
        e.stopPropagation();
        const act = t.dataset.wfrAct;
        if (act === 'refresh') this.refresh();
        else if (act === 'open') this.openRun(t.dataset.runId);
        else if (act === 'back') this.refresh();
        else if (act === 'csv') this.exportCsv(t.dataset.runId);
      });
    }

    setVisible(v) { if (v) this.refresh(); }

    async refresh() {
      this._currentRunId = null;
      if (!this.el) return;
      this.el.innerHTML = '<div class="wfr-loading">Đang tải…</div>';
      const r = await bg({ action: 'workflowResults:listRuns', limit: 50 });
      if (!r || !r.ok) { this._renderError(r && r.error); return; }
      this._renderList(r.runs || []);
    }

    _renderError(msg) {
      this.el.innerHTML =
        '<div class="wfr-empty">' +
          '<div class="wfr-empty-title">Không đọc được kết quả</div>' +
          '<div class="wfr-empty-sub">' + esc(msg || 'lỗi không rõ') + '</div>' +
          '<button class="btn btn-secondary btn-sm" data-wfr-act="refresh">Thử lại</button>' +
        '</div>';
    }

    _renderList(runs) {
      if (!runs.length) {
        this.el.innerHTML =
          '<div class="wfr-empty">' +
            '<div class="wfr-empty-title">Chưa có lần chạy nào được lưu</div>' +
            '<div class="wfr-empty-sub">Chạy một workflow — mỗi node xong sẽ được ghi lại ở đây.</div>' +
            '<button class="btn btn-secondary btn-sm" data-wfr-act="refresh">Tải lại</button>' +
          '</div>';
        return;
      }
      const rows = runs.map((r) =>
        '<div class="wfr-run" data-wfr-act="open" data-run-id="' + esc(r.id) + '">' +
          '<span class="wfr-dot wfr-' + esc(r.status || 'running') + '"></span>' +
          '<span class="wfr-run-name">' + esc(r.workflowName || r.workflowId || '(không tên)') + '</span>' +
          '<span class="wfr-run-meta">' + esc(STATUS_LABEL[r.status] || r.status || '') + ' · ' + (r.rowCount || 0) + ' node · ' + esc(fmtTime(r.createdAt)) + '</span>' +
        '</div>').join('');
      this.el.innerHTML =
        '<div class="wfr-head">' +
          '<span class="wfr-title">' + runs.length + ' lần chạy gần nhất</span>' +
          '<button class="btn btn-secondary btn-sm" data-wfr-act="refresh">Tải lại</button>' +
        '</div><div class="wfr-list">' + rows + '</div>';
    }

    async openRun(runId) {
      if (!runId) return;
      this._currentRunId = runId;
      this.el.innerHTML = '<div class="wfr-loading">Đang mở…</div>';
      const r = await bg({ action: 'workflowResults:getRun', runId });
      if (!r || !r.ok) { this._renderError(r && r.error); return; }
      const run = r.run || {};
      const cols = (run.columns || []).map((c) => c.field);
      const head = cols.map((c) => '<th>' + esc(c) + '</th>').join('');
      const body = (run.rows || []).map((row) =>
        '<tr>' + cols.map((c) => '<td>' + esc(row[c]) + '</td>').join('') + '</tr>').join('');
      this.el.innerHTML =
        '<div class="wfr-head">' +
          '<button class="btn btn-secondary btn-sm" data-wfr-act="back">← Danh sách</button>' +
          '<span class="wfr-title">' + esc(run.workflowName || run.workflowId || '') + '</span>' +
          '<button class="btn btn-secondary btn-sm" data-wfr-act="csv" data-run-id="' + esc(runId) + '">Tải CSV</button>' +
        '</div>' +
        '<div class="wfr-run-meta wfr-detail-meta">' + esc(STATUS_LABEL[run.status] || run.status || '') + ' · ' +
          (run.rows || []).length + ' dòng · ' + esc(fmtTime(run.createdAt)) + '</div>' +
        (cols.length
          ? '<div class="wfr-table-wrap"><table class="wfr-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>'
          : '<div class="wfr-empty"><div class="wfr-empty-sub">Run này chưa có dòng nào.</div></div>');
    }

    async exportCsv(runId) {
      const r = await bg({ action: 'workflowResults:exportCsv', runId: runId || this._currentRunId });
      if (!r || !r.ok) { root.showNotification?.('Không tạo được CSV: ' + ((r && r.error) || ''), 'error', 2500); return; }
      try {
        // Tải trong trang extension: Blob + <a download> (không cần quyền downloads).
        const blob = new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' }); // BOM để Excel đọc đúng tiếng Việt
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'workflow-run-' + String(runId || 'export').slice(-8) + '.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        root.showNotification?.('Đã tải CSV (' + (r.rowCount || 0) + ' dòng)', 'success', 2000);
      } catch (e) {
        root.showNotification?.('Tải CSV lỗi: ' + (e && e.message), 'error', 2500);
      }
    }
  }

  root.WorkflowResultsTab = WorkflowResultsTab;
})(typeof window !== 'undefined' ? window : this);
