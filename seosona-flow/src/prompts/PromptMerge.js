/**
 * PromptMerge — Sinh prompt hàng loạt từ bảng (CSV/TSV) + template mail-merge.
 * (Pillar B, 2026-07-09) 100% local: parse bảng trong browser, ghép cột {ten_cot} vào template,
 * đổ N prompt (phân tách bằng dòng trống) vào #promptsArea → luồng "Tạo" sẵn có xử lý batch.
 *
 * Không phụ thuộc lib ngoài: parser CSV/TSV tự viết (RFC4180-ish: field có dấu ", xuống dòng trong
 * ngoặc kép, "" escape). XLSX chưa hỗ trợ (user export .csv từ Excel/Sheets). MV3-safe (no eval).
 */
(function () {
  'use strict';

  const PromptMerge = {
    _rows: [],       // [{col: value}]
    _columns: [],    // tên cột theo thứ tự
    _overlay: null,

    open() {
      if (this._overlay) this.close();
      this._rows = [];
      this._columns = [];
      this._render();
    },

    close() {
      if (this._escHandler) { document.removeEventListener('keydown', this._escHandler); this._escHandler = null; }
      if (this._overlay) { this._overlay.remove(); this._overlay = null; }
    },

    // ── CSV/TSV parser ──────────────────────────────────────────────────────
    // Trả { columns:[], rows:[{}] }. Tự nhận diện dấu phân tách (tab nếu có nhiều tab hơn phẩy).
    parse(text) {
      text = String(text || '').replace(/^﻿/, ''); // strip BOM
      if (!text.trim()) return { columns: [], rows: [] };
      // Đoán delimiter từ dòng đầu.
      const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length);
      const delim = (firstLine.split('\t').length > firstLine.split(',').length) ? '\t' : ',';

      const records = [];
      let field = '', row = [], inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
          if (c === '"') {
            if (text[i + 1] === '"') { field += '"'; i++; }
            else inQuotes = false;
          } else field += c;
        } else {
          if (c === '"') inQuotes = true;
          else if (c === delim) { row.push(field); field = ''; }
          else if (c === '\n') { row.push(field); records.push(row); field = ''; row = []; }
          else if (c === '\r') { /* bỏ, chờ \n */ }
          else field += c;
        }
      }
      // record cuối (nếu không có newline cuối file)
      if (field.length || row.length) { row.push(field); records.push(row); }
      if (!records.length) return { columns: [], rows: [] };

      // Dòng 0 = header. Cột trùng tên → thêm hậu tố.
      const rawHeader = records[0].map(h => h.trim());
      const seen = {};
      const columns = rawHeader.map((h, idx) => {
        let name = h || ('col' + (idx + 1));
        if (seen[name] != null) { seen[name]++; name = name + '_' + seen[name]; }
        else seen[name] = 0;
        return name;
      });
      const rows = [];
      for (let r = 1; r < records.length; r++) {
        const rec = records[r];
        if (rec.length === 1 && rec[0].trim() === '') continue; // dòng trống
        const obj = {};
        columns.forEach((col, idx) => { obj[col] = (rec[idx] != null ? rec[idx] : '').trim(); });
        rows.push(obj);
      }
      return { columns, rows };
    },

    // Thay {col} trong template bằng giá trị hàng. {col} không tồn tại → giữ nguyên (để user thấy sai).
    applyTemplate(template, rowObj) {
      return String(template || '').replace(/\{([^{}]+)\}/g, (m, key) => {
        const k = key.trim();
        return Object.prototype.hasOwnProperty.call(rowObj, k) ? (rowObj[k] || '') : m;
      });
    },

    // Sinh toàn bộ prompt từ template + rows (bỏ dòng ra chuỗi rỗng).
    buildPrompts(template) {
      return this._rows
        .map(r => this.applyTemplate(template, r).trim())
        .filter(Boolean);
    },

    _loadTable(text) {
      const { columns, rows } = this.parse(text);
      this._columns = columns;
      this._rows = rows;
      this._refreshColumns();
      this._refreshPreview();
    },

    // ── UI ──────────────────────────────────────────────────────────────────
    _render() {
      const t = (k, d) => (window.I18n?.t?.(k)) || d;
      const ov = document.createElement('div');
      ov.className = 'pmerge-overlay';
      ov.innerHTML = `
        <div class="pmerge-modal">
          <div class="pmerge-header">
            <div class="pmerge-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M3 9h18M3 15h18M9 3v18M15 3v18"></path></svg>
              <span>${t('pmerge.title', 'Tạo hàng loạt từ bảng')}</span>
            </div>
            <button class="pmerge-close" id="pmergeClose" aria-label="close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          <div class="pmerge-body">
            <div class="pmerge-step">
              <div class="pmerge-step-head">
                <span class="pmerge-step-num">1</span>
                <span>${t('pmerge.step1', 'Dán CSV/TSV hoặc chọn file (.csv)')}</span>
                <button class="btn btn-secondary btn-xs" id="pmergeFileBtn" style="margin-left:auto;">${t('pmerge.chooseFile', 'Chọn file')}</button>
                <input type="file" id="pmergeFile" accept=".csv,.tsv,.txt" class="hidden" />
              </div>
              <textarea id="pmergeData" class="pmerge-data" placeholder="${t('pmerge.dataPlaceholder', 'san_pham,phong_cach\nÁo thun trắng,tối giản studio\nGiày sneaker,đường phố năng động')}"></textarea>
              <div class="pmerge-columns" id="pmergeColumns"></div>
            </div>
            <div class="pmerge-step">
              <div class="pmerge-step-head">
                <span class="pmerge-step-num">2</span>
                <span>${t('pmerge.step2', 'Template — bấm cột để chèn {cột}')}</span>
              </div>
              <textarea id="pmergeTemplate" class="pmerge-template" placeholder="${t('pmerge.tplPlaceholder', 'Ảnh sản phẩm {san_pham}, phong cách {phong_cach}, ánh sáng studio, 4k')}"></textarea>
            </div>
            <div class="pmerge-step">
              <div class="pmerge-step-head">
                <span class="pmerge-step-num">3</span>
                <span>${t('pmerge.step3', 'Xem trước')}</span>
                <span class="pmerge-count" id="pmergeCount" style="margin-left:auto;"></span>
              </div>
              <div class="pmerge-preview" id="pmergePreview"></div>
            </div>
          </div>
          <div class="pmerge-footer">
            <button class="btn btn-secondary btn-sm" id="pmergeCancel">${t('common.cancel', 'Hủy')}</button>
            <button class="btn btn-primary btn-sm" id="pmergeInsert">${t('pmerge.insert', 'Chèn vào ô prompt')}</button>
          </div>
        </div>`;

      // chặn event rò ra ngoài (sidebar có nhiều global listener)
      ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click'].forEach(e =>
        ov.addEventListener(e, ev => ev.stopPropagation()));
      document.body.appendChild(ov);
      this._overlay = ov;

      const $ = s => ov.querySelector(s);
      $('#pmergeClose').addEventListener('click', () => this.close());
      $('#pmergeCancel').addEventListener('click', () => this.close());
      ov.addEventListener('click', (e) => { if (e.target === ov) this.close(); });
      // [FIX 2026-07-09] Bỏ {once:true} (bị gỡ sau phím ĐẦU TIÊN bất kỳ → gõ vào textarea là Esc chết);
      // gỡ listener trong close() thay vì once.
      this._escHandler = (e) => { if (e.key === 'Escape') this.close(); };
      document.addEventListener('keydown', this._escHandler);

      $('#pmergeData').addEventListener('input', (e) => this._loadTable(e.target.value));
      $('#pmergeTemplate').addEventListener('input', () => this._refreshPreview());
      $('#pmergeFileBtn').addEventListener('click', () => $('#pmergeFile').click());
      $('#pmergeFile').addEventListener('change', async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        const text = await f.text();
        $('#pmergeData').value = text;
        this._loadTable(text);
        e.target.value = '';
      });
      $('#pmergeInsert').addEventListener('click', () => this._insert());
    },

    _refreshColumns() {
      const wrap = this._overlay?.querySelector('#pmergeColumns');
      if (!wrap) return;
      if (!this._columns.length) { wrap.innerHTML = ''; return; }
      const label = (window.I18n?.t?.('pmerge.detectedCols')) || 'Cột';
      wrap.innerHTML = `<span class="pmerge-cols-label">${label}:</span>` +
        this._columns.map(c => `<button class="pmerge-col-chip" data-col="${this._escAttr(c)}">${this._esc(c)}</button>`).join('');
      wrap.querySelectorAll('.pmerge-col-chip').forEach(chip => {
        chip.addEventListener('click', () => this._insertColToken(chip.dataset.col));
      });
    },

    _insertColToken(col) {
      const ta = this._overlay?.querySelector('#pmergeTemplate');
      if (!ta) return;
      const token = '{' + col + '}';
      const s = ta.selectionStart ?? ta.value.length;
      const eN = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, s) + token + ta.value.slice(eN);
      const pos = s + token.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      this._refreshPreview();
    },

    _refreshPreview() {
      const ov = this._overlay; if (!ov) return;
      const tpl = ov.querySelector('#pmergeTemplate').value;
      const previewEl = ov.querySelector('#pmergePreview');
      const countEl = ov.querySelector('#pmergeCount');
      const prompts = this.buildPrompts(tpl);
      countEl.textContent = this._rows.length
        ? ((window.I18n?.t?.('pmerge.willCreate', { count: prompts.length })) || `${prompts.length} prompt`)
        : '';
      if (!prompts.length) {
        previewEl.innerHTML = `<div class="pmerge-preview-empty">${(window.I18n?.t?.('pmerge.previewEmpty')) || 'Nhập bảng + template để xem trước'}</div>`;
        return;
      }
      const show = prompts.slice(0, 3);
      previewEl.innerHTML = show.map((p, i) => `<div class="pmerge-preview-item"><span class="pmerge-preview-idx">${i + 1}</span>${this._esc(p)}</div>`).join('')
        + (prompts.length > 3 ? `<div class="pmerge-preview-more">… +${prompts.length - 3}</div>` : '');
    },

    _insert() {
      const tpl = this._overlay?.querySelector('#pmergeTemplate')?.value || '';
      const prompts = this.buildPrompts(tpl);
      if (!prompts.length) {
        window.showNotification?.((window.I18n?.t?.('pmerge.nothingToInsert')) || 'Chưa có prompt nào để chèn', 'warning', 2500);
        return;
      }
      const area = document.getElementById('promptsArea');
      if (!area) { window.showNotification?.('promptsArea not found', 'error', 2000); return; }
      const block = prompts.join('\n\n'); // dòng trống = ranh giới batch
      area.value = area.value.trim() ? (area.value.trim() + '\n\n' + block) : block;
      area.dispatchEvent(new Event('input', { bubbles: true }));
      area.focus();
      this.close();
      window.showNotification?.(
        (window.I18n?.t?.('pmerge.inserted', { count: prompts.length })) || `Đã chèn ${prompts.length} prompt vào ô. Bấm "Tạo" để chạy.`,
        'success', 3500);
    },

    _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; },
    _escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
  };

  window.PromptMerge = PromptMerge;
})();
