/**
 * FlowDoctorTab — mặt UI của src/core/FlowDoctor.js.
 *
 * Trước đây lỗi Flow chỉ hiện thành toast rồi biến mất. Người dùng đọc "Google phát
 * hiện hoạt động bất thường" xong vẫn không biết làm gì, và phản xạ sai nhất là bấm
 * chạy lại ngay — càng bị gắn cờ nặng. Tab này để tra lại bất cứ lúc nào.
 *
 * Toàn bộ phần tra cứu là dữ liệu tĩnh nên mở tab KHÔNG gọi mạng. Chỉ nút "Tự kiểm"
 * mới hỏi background/tab Flow.
 */
(function (root) {
  'use strict';

  const SEV = {
    stop: { label: 'Ngưng gửi ngay', color: '#ef4444' },
    wait: { label: 'Chờ rồi tự hết', color: '#f59e0b' },
    fix: { label: 'Sửa rồi chạy lại', color: '#3d6ff5' },
  };

  class FlowDoctorTab {
    constructor(host) {
      this.host = host;
      this.visible = false;
      this._lastCategory = null;
      // Ghi lại lỗi vừa xảy ra để mở tab là thấy ngay mục liên quan, khỏi phải tự đoán.
      root.eventBus?.on?.('flow:error_classified', (d) => {
        if (d?.category) { this._lastCategory = d.category; if (this.visible) this.render(); }
      });
    }

    static init(host) { return (FlowDoctorTab._inst = new FlowDoctorTab(host)); }
    static getInstance() { return FlowDoctorTab._inst || null; }

    setVisible(v) { this.visible = !!v; if (v) this.render(); }

    _esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    _card(entry, highlight) {
      const sev = SEV[entry.severity] || SEV.fix;
      const steps = entry.steps.map((s, i) => `<li>${this._esc(s)}</li>`).join('');
      return `
        <details class="wfd-card"${highlight ? ' open' : ''} style="border:1px solid var(--border,rgba(255,255,255,.1));border-radius:8px;margin-bottom:8px;${highlight ? 'outline:2px solid ' + sev.color + ';' : ''}">
          <summary style="padding:10px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${sev.color};flex:0 0 auto;"></span>
            <span style="font-weight:600;">${this._esc(entry.title)}</span>
            <span style="margin-left:auto;font-size:11px;opacity:.7;">${this._esc(sev.label)}</span>
          </summary>
          <div style="padding:0 12px 12px 28px;font-size:13px;line-height:1.6;">
            <p style="opacity:.8;margin:0 0 8px;"><b>Vì sao:</b> ${this._esc(entry.cause)}</p>
            <ol style="margin:0 0 8px;padding-left:18px;">${steps}</ol>
            ${entry.prevent ? `<p style="opacity:.7;margin:0;font-size:12px;"><b>Lần sau:</b> ${this._esc(entry.prevent)}</p>` : ''}
          </div>
        </details>`;
    }

    render() {
      if (!this.host) return;
      const FD = root.FlowDoctor;
      if (!FD) { this.host.innerHTML = '<p style="padding:12px;opacity:.7">Chưa nạp FlowDoctor.js.</p>'; return; }

      const recent = this._lastCategory ? FD.lookup(this._lastCategory) : null;
      const cards = FD.categories()
        .map((k) => FD.lookup(k))
        .map((e) => this._card(e, !!(recent && recent.key === e.key)))
        .join('');

      this.host.innerHTML = `
        <div style="padding:10px 12px;">
          ${recent ? `<p style="margin:0 0 10px;font-size:12px;opacity:.85;">Lỗi gần nhất: <b>${this._esc(recent.title)}</b> — mục tương ứng đã mở sẵn bên dưới.</p>` : ''}
          <button id="wfdSelfCheck" class="s-btn s-btn-secondary" style="margin-bottom:10px;">Tự kiểm</button>
          <div id="wfdSelfCheckOut" style="margin-bottom:12px;font-size:13px;"></div>
          ${cards}
        </div>`;
      this.host.querySelector('#wfdSelfCheck')?.addEventListener('click', () => this.runSelfCheck());
    }

    async runSelfCheck() {
      const out = this.host?.querySelector('#wfdSelfCheckOut');
      if (!out) return;
      out.innerHTML = '<span style="opacity:.7">Đang kiểm…</span>';
      const ask = (action, payload) => new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ action, ...(payload || {}) }, (r) => {
            // lastError phải đọc, nếu không Chrome ghi "Unchecked runtime.lastError".
            if (chrome.runtime.lastError) return resolve(null);
            resolve(r);
          });
        } catch (_e) { resolve(null); }
      });

      const res = await root.FlowDoctor.selfCheck({
        flowTab: async () => {
          const r = await ask('checkFlowTabOpen');
          return { ok: !!(r && (r.isOpen || r.open || r.tabId)), detail: r ? null : 'không hỏi được background' };
        },
        loggedIn: async () => {
          const r = await ask('checkFlowTabOpen');
          if (!r) return { ok: false, detail: 'chưa xác định được' };
          return { ok: r.loggedIn !== false, detail: r.loggedIn === false ? 'chưa đăng nhập' : null };
        },
        contentScript: async () => {
          const r = await ask('checkFlowTabOpen');
          return { ok: !!(r && r.contentScriptAlive !== false && (r.isOpen || r.open || r.tabId)) };
        },
        credits: async () => {
          const r = await ask('flowCreditsScan');
          const n = r && (r.credits ?? r.remaining);
          if (n == null) return { ok: true, detail: 'chưa đọc được số dư (không chặn)' };
          return { ok: Number(n) > 0, detail: 'còn ' + n };
        },
      });

      out.innerHTML = res.checks.map((c) => `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:3px 0;">
          <span style="flex:0 0 auto;">${c.ok ? '✅' : '⚠️'}</span>
          <span>${this._esc(c.label)}
            ${c.detail ? `<span style="opacity:.6"> — ${this._esc(c.detail)}</span>` : ''}
            ${c.fix ? `<br><span style="opacity:.75;font-size:12px;">→ ${this._esc(c.fix)}</span>` : ''}
          </span>
        </div>`).join('');
    }
  }

  root.FlowDoctorTab = FlowDoctorTab;
})(typeof window !== 'undefined' ? window : this);
