/**
 * BaseModal — primitive overlay dùng chung cho modal/panel (local-first rebuild P6).
 *
 * Mục tiêu: thay cho việc mỗi modal tự dựng overlay/backdrop/close/z-index rời rạc.
 * Additive — KHÔNG đụng modal cũ đang chạy; modal mới (và các port sau này) dùng cái này
 * để có: backdrop, đóng bằng ESC / click nền, focus-trap, mount tại document.body (thoát
 * stacking context của sidebar), và z-index lấy từ token scale (--z-modal…).
 *
 * Cách dùng:
 *   const m = new BaseModal({ onClose: () => {...} });
 *   m.open(contentEl, { className: 'my-modal', tier: 'modal' });   // tier → --z-*
 *   m.close();
 */
(function () {
  'use strict';

  const TIER_VAR = {
    overlay: 'var(--z-overlay, 9000)',
    modal: 'var(--z-modal, 10000)',
    'modal-high': 'var(--z-modal-high, 100000)',
    'modal-top': 'var(--z-modal-top, 1000000)',
    'modal-nested': 'var(--z-modal-nested, 10000010)',
    critical: 'var(--z-critical, 2147483647)',
  };

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  class BaseModal {
    constructor(opts = {}) {
      this.opts = opts;            // { onClose }
      this._overlay = null;
      this._prevFocus = null;
      this._onKeydown = this._onKeydown.bind(this);
    }

    /**
     * @param {HTMLElement|string} content  Nội dung modal (element hoặc HTML string).
     * @param {object} [o]
     * @param {string} [o.className]         class thêm cho overlay.
     * @param {string} [o.tier]             tier z-index: overlay|modal|modal-high|modal-top|modal-nested|critical.
     * @param {boolean}[o.closeOnBackdrop]  đóng khi click nền (mặc định true).
     * @returns {HTMLElement} overlay element.
     */
    open(content, o = {}) {
      if (this._overlay) this.close();
      this._prevFocus = document.activeElement;

      const overlay = document.createElement('div');
      overlay.className = 'sf-base-overlay' + (o.className ? ' ' + o.className : '');
      const z = TIER_VAR[o.tier] || TIER_VAR.modal;
      overlay.style.cssText =
        'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(0,0,0,0.5);z-index:' + z + ';';

      const panel = document.createElement('div');
      panel.className = 'sf-base-modal';
      if (typeof content === 'string') panel.innerHTML = content;
      else if (content) panel.appendChild(content);
      overlay.appendChild(panel);

      if (o.closeOnBackdrop !== false) {
        overlay.addEventListener('mousedown', (e) => {
          if (e.target === overlay) this.close();
        });
      }

      document.body.appendChild(overlay);
      this._overlay = overlay;
      document.addEventListener('keydown', this._onKeydown, true);

      const first = panel.querySelector('[autofocus]') || panel.querySelector(FOCUSABLE);
      if (first) { try { first.focus(); } catch (_) { /* focus fail → bỏ qua */ } }
      return overlay;
    }

    _onKeydown(e) {
      if (!this._overlay) return;
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); return; }
      if (e.key === 'Tab') this._trapFocus(e);
    }

    _trapFocus(e) {
      const f = this._overlay.querySelectorAll(FOCUSABLE);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }

    close() {
      if (!this._overlay) return;
      document.removeEventListener('keydown', this._onKeydown, true);
      this._overlay.remove();
      this._overlay = null;
      if (this._prevFocus && this._prevFocus.focus) {
        try { this._prevFocus.focus(); } catch (_) { /* focus fail → bỏ qua */ }
      }
      if (typeof this.opts.onClose === 'function') this.opts.onClose();
    }

    isOpen() { return !!this._overlay; }
  }

  window.BaseModal = BaseModal;
})();
