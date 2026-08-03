/**
 * loading-i18n.js — Mini-i18n cho loading + connecting overlay (hiển thị TRƯỚC khi I18n class load).
 *
 * Default render = English thay vì hardcode tiếng Việt. Khi storage callback fire (vài ms sau),
 * text update theo locale user (af_locale từ chrome.storage.local).
 *
 * Lý do file riêng (không inline trong sidebar.html): Chrome MV3 manifest mặc định block inline
 * scripts qua CSP `script-src 'self'`. File này load qua `<script src="loading-i18n.js">` sạch.
 *
 * Pattern tương tự content script Phase 6 Bug Q overlays.
 */
(function () {
  const labels = {
    vi: { loading: 'Đang tải...', connecting: 'Đang kết nối Flow...' },
    en: { loading: 'Loading...', connecting: 'Connecting to Flow...' },


  };
  try {
    chrome.storage.local.get(['af_locale'], function (r) {
      const locale = r.af_locale || 'en';
      const set = labels[locale] || labels.en;
      const loadingEl = document.getElementById('seosonaflow-loading-text');
      const connectingEl = document.querySelector('.seosonaflow-connecting-text');
      if (loadingEl) loadingEl.textContent = set.loading;
      if (connectingEl) connectingEl.textContent = set.connecting;
    });
  } catch (e) {
    /* extension context not ready — keep default English */
  }
})();
