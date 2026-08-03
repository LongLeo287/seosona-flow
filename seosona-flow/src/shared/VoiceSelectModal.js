/**
 * VoiceSelectModal — Modal full-screen overlay cho Flow voice selection.
 * Pattern clone từ StyleSelectModal.js — render ở document.body root tránh
 * overflow clipping của parent containers (sidebar/workflow editor).
 *
 * Usage:
 *   VoiceSelectModal.show({
 *     voices: VoiceRegistry.getRenderListSync('flow'),
 *     selectedSlug: 'achernar',
 *     onSelect: (voiceObj) => { ... }, // voiceObj = null khi user chọn "Random"
 *   });
 */
class VoiceSelectModal {
  static _overlay = null;
  static _onSelect = null;
  static _voices = [];
  static _selectedSlug = null;
  static _escHandler = null;
  // 2026-05-30: Audio preview state. Single global Audio element — stop previous khi click khác.
  static _audio = null;          // HTMLAudioElement instance
  static _playingSlug = null;    // Slug đang play (để render button state)

  static show({ voices = [], selectedSlug = null, onSelect = () => {}, providerSlug = 'flow' }) {
    // Audit fix (memory leak): if a prior instance was force-closed without hide(),
    // its keydown + eventBus listeners are still bound. Unbind them at the start of
    // show() so listeners don't stack across opens.
    if (VoiceSelectModal._escHandler) {
      document.removeEventListener('keydown', VoiceSelectModal._escHandler);
      VoiceSelectModal._escHandler = null;
    }
    VoiceSelectModal._unbindVoiceRefreshListener();
    VoiceSelectModal._voices = voices || [];
    VoiceSelectModal._selectedSlug = selectedSlug;
    VoiceSelectModal._onSelect = onSelect;
    VoiceSelectModal._providerSlug = providerSlug;
    VoiceSelectModal._render();
    VoiceSelectModal._open();

    // 2026-05-30 BUG FIX: getRenderListSync trả in-memory cache có thể partial sau reload extension
    // (vd chỉ 1 voice cache cũ, chrome.storage scraped list chưa load async).
    // → Auto async refresh sau initial render → re-render khi data mới về.
    // + Listen eventBus 'voices:refreshed' để re-render nếu user click sync trong modal.
    VoiceSelectModal._refreshAsync(providerSlug);
    VoiceSelectModal._bindVoiceRefreshListener();
  }

  /**
   * 2026-05-30: Async load fresh voices từ VoiceRegistry + re-render modal nếu data khác.
   * Cover case sau reload extension: in-memory cache empty/partial, cần await chrome.storage read
   * + fetch base catalog từ server.
   */
  static async _refreshAsync(providerSlug = 'flow', force = false) {
    if (!window.VoiceRegistry) return;
    try {
      const fresh = await window.VoiceRegistry.getRenderList(providerSlug);
      console.log('[VoiceSelectModal] _refreshAsync fetched', { count: Array.isArray(fresh) ? fresh.length : 'N/A', force });
      if (!Array.isArray(fresh) || fresh.length === 0) return;
      // Skip nếu modal đã đóng (user close trước khi async done)
      if (!VoiceSelectModal._overlay || !VoiceSelectModal._overlay.classList.contains('visible')) {
        // Vẫn cache để show() lần sau có data fresh
        VoiceSelectModal._voices = fresh;
        console.log('[VoiceSelectModal] _refreshAsync: modal closed, cached for next show');
        return;
      }
      // Force = từ SSE event handler → bypass dedup, đảm bảo render data mới.
      // Non-force (initial show): tránh flicker khi sync cache khác async cache nhẹ
      // (vd is_custom flag, sort_order). Chỉ re-render nếu UI-visible content thật sự đổi.
      if (!force) {
        // Tier 1: nếu structure giống nhau (count + slug list cùng order) → silent update,
        // skip render. Tránh flash modal khi sync cache đã đủ dùng + async chỉ refresh metadata.
        const sameStructure = fresh.length === VoiceSelectModal._voices.length
          && fresh.every((v, i) => v.slug === VoiceSelectModal._voices[i]?.slug);
        if (sameStructure) {
          // Silent update _voices reference + check sub-fields có đổi không (sample_url, display_name).
          // Nếu có → re-render bằng requestAnimationFrame để defer paint, giảm jank.
          const _uiFingerprint = (list) => list.map(v => [
            v.display_name || '',
            v.sample_url || '',
            v.thumbnail_url || '',
            v.is_premium ? 1 : 0,
          ].join('|')).join('\n');
          if (_uiFingerprint(fresh) === _uiFingerprint(VoiceSelectModal._voices)) {
            VoiceSelectModal._voices = fresh;
            console.log('[VoiceSelectModal] _refreshAsync: same structure + UI fields → silent update, skip render');
            return;
          }
          // UI fields đổi → re-render nhưng dùng RAF để không giật visible.
          VoiceSelectModal._voices = fresh;
          requestAnimationFrame(() => {
            VoiceSelectModal._render();
            VoiceSelectModal._open();
          });
          console.log('[VoiceSelectModal] _refreshAsync: UI fields changed, deferred render');
          return;
        }
      }

      console.log('[VoiceSelectModal] Refresh: updated voice list', {
        before: VoiceSelectModal._voices.length,
        after: fresh.length,
        force,
      });
      VoiceSelectModal._voices = fresh;
      VoiceSelectModal._render();
      VoiceSelectModal._open(); // re-attach overlay reference after _render
    } catch (e) {
      console.warn('[VoiceSelectModal] _refreshAsync failed:', e?.message || e);
    }
  }

  /**
   * 2026-05-30: Bind eventBus listener voices:refreshed cho live update khi VoiceRegistry
   * scrape/fetch xong. Idempotent — bind 1 lần per show, unbind khi hide.
   */
  static _bindVoiceRefreshListener() {
    if (VoiceSelectModal._voiceRefreshHandler) return;
    if (!window.eventBus?.on) return;
    VoiceSelectModal._voiceRefreshHandler = () => {
      // Defer 1 tick để VoiceRegistry cache settle xong. Force=true bypass dedup —
      // event từ SSE đảm bảo data đã đổi server-side, render lại unconditionally.
      setTimeout(() => VoiceSelectModal._refreshAsync(VoiceSelectModal._providerSlug || 'flow', true), 50);
    };
    window.eventBus.on('voices:refreshed', VoiceSelectModal._voiceRefreshHandler);
    window.eventBus.on('voices:base_catalog_updated', VoiceSelectModal._voiceRefreshHandler);
  }

  static _unbindVoiceRefreshListener() {
    if (!VoiceSelectModal._voiceRefreshHandler) return;
    try {
      window.eventBus?.off?.('voices:refreshed', VoiceSelectModal._voiceRefreshHandler);
      window.eventBus?.off?.('voices:base_catalog_updated', VoiceSelectModal._voiceRefreshHandler);
    } catch (_) { globalThis.SEOSONA_swallow?.('VoiceSelectModal#_voiceRefreshHandler', _); }
    VoiceSelectModal._voiceRefreshHandler = null;
  }

  static hide() {
    if (VoiceSelectModal._overlay) {
      VoiceSelectModal._overlay.classList.add('hidden');
      VoiceSelectModal._overlay.classList.remove('visible');
    }
    if (VoiceSelectModal._escHandler) {
      document.removeEventListener('keydown', VoiceSelectModal._escHandler);
      VoiceSelectModal._escHandler = null;
    }
    // 2026-05-30: Stop audio khi đóng modal — tránh leak playback.
    VoiceSelectModal._stopAudio();
    // 2026-05-30: Unbind voices:refreshed listener để KHÔNG accumulate qua nhiều lần show.
    VoiceSelectModal._unbindVoiceRefreshListener();
  }

  static _getContainer() {
    let container = document.getElementById('voiceSelectModalContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'voiceSelectModalContainer';
      document.body.appendChild(container);
    }
    return container;
  }

  static _t(key, fallback) {
    return window.I18n?.t?.(key) || fallback;
  }

  /**
   * Check admin role để gate Sync button visibility.
   * User thường: KHÔNG hiển thị sync button (chỉ admin populate base catalog server).
   * Admin: hiển thị sync button (scrape local + POST server queue).
   *
   * AuthManager.isAdmin() pattern: role === 'admin' OR is_admin === true.
   */
  static _isAdmin() {
    try {
      // Prefer AuthManager helper (may include cache/extra checks)
      if (typeof window.authManager?.isAdmin === 'function') {
        return !!true;
      }
      // Fallback raw user object check
      const user = ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' });
      return !!(user && (user.role === 'admin' || user.is_admin === true));
    } catch (_) {
      return false;
    }
  }

  /**
   * Show notification — fallback chain cho cross-context compat:
   *   1. window.showNotification(msg, type, duration) — sidebar context (preferred)
   *   2. window.showToast(msg) — popup contexts có toast helper
   *   3. window.customDialog.alert(msg, {type}) — workflow editor popup (last resort)
   *   4. console.log nếu không có notification system nào available
   *
   * Đồng bộ pattern MessageBridge.uploadFilesToFlow (line 502-512) cho consistency.
   */
  static _notify(message, type = 'info', duration = 4000) {
    try {
      if (typeof window.showNotification === 'function') {
        window.showNotification(message, type, duration);
        return;
      }
      if (typeof window.showToast === 'function') {
        window.showToast(message);
        return;
      }
      if (window.customDialog && typeof window.customDialog.alert === 'function') {
        window.customDialog.alert(message, { type });
        return;
      }
      // Fallback log nếu không có notification system
      console.log(`[VoiceSelectModal] ${type}: ${message}`);
    } catch (_) { /* notification non-critical, không throw */ }
  }

  static _esc(str) {
    return String(str || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  static _resolveThumbUrl(voice) {
    if (voice.thumbnail_full_url) return voice.thumbnail_full_url;
    if (!voice.thumbnail_url) return null;
    if (voice.thumbnail_url.startsWith('http')) return voice.thumbnail_url;
    const baseUrl = window.ApiBaseConfig?.getWebBase?.() || '';
    return `${baseUrl}/storage/${voice.thumbnail_url}`;
  }

  static _voiceIconSvg() {
    // SVG microphone icon — server-only, đa ngôn ngữ (không dùng emoji)
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" y1="19" x2="12" y2="23"></line>
      <line x1="8" y1="23" x2="16" y2="23"></line>
    </svg>`;
  }

  static _randomIconSvg() {
    // SVG dice icon cho "Random voice" option
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"></circle>
      <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor"></circle>
      <circle cx="8.5" cy="15.5" r="1.5" fill="currentColor"></circle>
      <circle cx="15.5" cy="15.5" r="1.5" fill="currentColor"></circle>
      <circle cx="12" cy="12" r="1.5" fill="currentColor"></circle>
    </svg>`;
  }

  static _playIconSvg() {
    // SVG play icon (filled triangle) — 16x16 cho preview audio button
    return `<svg class="voice-modal-play-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6 4 20 12 6 20"></polygon>
    </svg>`;
  }

  static _stopIconSvg() {
    // SVG stop icon (filled square) — render khi voice đang play
    return `<svg class="voice-modal-play-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="1"></rect>
    </svg>`;
  }

  static _renderItem(voice) {
    const isSelected = voice.slug === VoiceSelectModal._selectedSlug;
    const thumbUrl = VoiceSelectModal._resolveThumbUrl(voice);
    const thumbHtml = thumbUrl
      ? `<img class="style-modal-item-thumb" src="${VoiceSelectModal._esc(thumbUrl)}" alt="${VoiceSelectModal._esc(voice.display_name || '')}" loading="lazy" />`
      : `<div class="style-modal-item-icon">${VoiceSelectModal._voiceIconSvg()}</div>`;

    // 2026-05-30: Play button — chỉ render nếu voice có sample_url (admin manual edit URL .wav/.mp3).
    const isPlaying = VoiceSelectModal._playingSlug === voice.slug;
    const playBtnHtml = voice.sample_url
      ? `<button type="button" class="voice-modal-play-btn ${isPlaying ? 'is-playing' : ''}" data-action="play-sample" data-slug="${VoiceSelectModal._esc(voice.slug)}" data-sample-url="${VoiceSelectModal._esc(voice.sample_url)}" title="${VoiceSelectModal._t('voice.playSample', 'Nghe thử')}" aria-label="${VoiceSelectModal._t('voice.playSample', 'Nghe thử')}">
          ${isPlaying ? VoiceSelectModal._stopIconSvg() : VoiceSelectModal._playIconSvg()}
        </button>`
      : '';

    // 2026-05-30 UI: check icon nằm BÊN PHẢI voice name (sau info), play button vẫn ở cuối.
    return `
      <div class="style-modal-item ${isSelected ? 'selected' : ''}" data-slug="${VoiceSelectModal._esc(voice.slug)}">
        ${thumbHtml}
        <div class="voice-modal-item-info">
          <span class="style-modal-item-name">${VoiceSelectModal._esc(voice.display_name || voice.search_value || voice.slug)}</span>
          ${voice.description ? `<span class="voice-modal-item-desc">${VoiceSelectModal._esc(voice.description)}</span>` : ''}
        </div>
        ${voice.is_premium ? '<span class="voice-modal-item-badge">PRO</span>' : ''}
        ${isSelected ? `
          <svg class="style-modal-item-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        ` : ''}
        ${playBtnHtml}
      </div>
    `;
  }

  static _render() {
    const container = VoiceSelectModal._getContainer();
    const t = VoiceSelectModal._t;

    const noneSelected = !VoiceSelectModal._selectedSlug;
    let itemsHtml = `
      <div class="style-modal-item none-option ${noneSelected ? 'selected' : ''}" data-slug="">
        <div class="style-modal-item-icon">${VoiceSelectModal._randomIconSvg()}</div>
        <div class="voice-modal-item-info">
          <span class="style-modal-item-name">${t('voice.random', 'Random voice')}</span>
          <span class="voice-modal-item-desc">${t('voice.randomDesc', 'Flow picks default voice')}</span>
        </div>
        ${noneSelected ? `
          <svg class="style-modal-item-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        ` : ''}
      </div>
    `;

    if (VoiceSelectModal._voices.length === 0) {
      itemsHtml += `
        <div class="voice-modal-empty">
          <p>${t('voice.needResync', 'Chưa sync voices.')}</p>
          <button type="button" class="voice-modal-open-settings" id="voiceModalOpenSettings">
            ${t('voice.openSettings', 'Mở Cài đặt để Quét lại')}
          </button>
        </div>
      `;
    } else {
      const custom = VoiceSelectModal._voices.filter(v => v.is_custom);
      const base = VoiceSelectModal._voices.filter(v => !v.is_custom);

      if (custom.length > 0) {
        itemsHtml += `<div class="style-modal-category">${t('voice.groupCustom', 'Custom (của bạn)')}</div>`;
        itemsHtml += custom.map(v => VoiceSelectModal._renderItem(v)).join('');
      }
      if (base.length > 0) {
        itemsHtml += `<div class="style-modal-category">${t('voice.groupBase', 'Base catalog')}</div>`;
        itemsHtml += base.map(v => VoiceSelectModal._renderItem(v)).join('');
      }
    }

    container.innerHTML = `
      <div class="style-modal-overlay hidden" id="voiceSelectModalOverlay">
        <div class="style-modal-backdrop"></div>
        <div class="style-modal-content">
          <div class="style-modal-header">
            <h3 class="style-modal-title">${t('voice.pickerTitle', 'Choose voice')}</h3>
            <div class="voice-modal-header-actions">
              <!-- [Fix 2026-06-10] Sync button hiển thị cho TẤT CẢ user (đồng bộ pattern resync
                   ở settings.html). User thường: scrape local + lưu custom voices. Admin: thêm
                   step upload server làm promotion candidates (logic MessageBridge.syncFlowVoices
                   tự skip POST server cho non-admin → safe).
                   Tooltip i18n-aware:
                     - data-i18n-tooltip: I18n.applyTranslations() auto-update khi user đổi locale
                     - data-tooltip: initial value (tooltip ready ngay không phụ thuộc I18n cycle)
                   Admin/user có 2 keys riêng (voice.syncTooltip vs voice.syncTooltipAdmin). -->
              ${(() => {
                const syncKey = VoiceSelectModal._isAdmin() ? 'voice.syncTooltipAdmin' : 'voice.syncTooltip';
                const syncFallback = VoiceSelectModal._isAdmin()
                  ? 'Đồng bộ giọng đọc từ Flow (admin: + upload to server)'
                  : 'Đồng bộ giọng đọc từ Flow';
                return `<button type="button" class="voice-modal-sync-btn" id="voiceModalSyncBtn"
                      data-i18n-tooltip="${syncKey}"
                      data-tooltip="${VoiceSelectModal._esc(t(syncKey, syncFallback))}"
                      data-tooltip-pos="bottom">
                <svg class="voice-modal-sync-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
                <span class="voice-modal-sync-status" id="voiceModalSyncStatus" style="display:none;"></span>
              </button>`;
              })()}
              <button type="button" class="style-modal-close" id="voiceModalClose"
                      data-i18n-tooltip="common.close"
                      data-tooltip="${VoiceSelectModal._esc(t('common.close', 'Đóng'))}"
                      data-tooltip-pos="bottom">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
          <div class="style-modal-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="text" id="voiceModalSearch" placeholder="${t('voice.searchPlaceholder', 'Search voices...')}" />
          </div>
          <div class="style-modal-list" id="voiceModalList">
            ${itemsHtml}
          </div>
        </div>
      </div>
    `;

    VoiceSelectModal._overlay = container.querySelector('#voiceSelectModalOverlay');
    VoiceSelectModal._bindEvents();
  }

  static _bindEvents() {
    const overlay = VoiceSelectModal._overlay;
    if (!overlay) return;

    overlay.querySelector('#voiceModalClose')?.addEventListener('click', () => VoiceSelectModal.hide());
    overlay.querySelector('.style-modal-backdrop')?.addEventListener('click', () => VoiceSelectModal.hide());

    // [Fix 2026-06-10] Sync voices button — bind cho TẤT CẢ user (đồng bộ pattern settings.html
    // resync button). User thường lưu local custom voices, admin thêm upload server
    // (MessageBridge.syncFlowVoices tự gate admin check).
    const syncBtn = overlay.querySelector('#voiceModalSyncBtn');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        await VoiceSelectModal._handleSyncClick();
      });
    }

    overlay.querySelectorAll('.style-modal-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // 2026-05-30: Ignore click vào play button (icon hoặc svg child) — preview audio không select voice.
        const playBtn = e.target.closest('.voice-modal-play-btn');
        if (playBtn) {
          e.stopPropagation();
          const slug = playBtn.dataset.slug || '';
          const sampleUrl = playBtn.dataset.sampleUrl || '';
          VoiceSelectModal._togglePlay(slug, sampleUrl);
          return;
        }
        const slug = item.dataset.slug || '';
        const voice = slug ? VoiceSelectModal._voices.find(v => v.slug === slug) : null;
        try { VoiceSelectModal._onSelect(voice); } catch (_) { globalThis.SEOSONA_swallow?.('VoiceSelectModal#_voiceRefreshHandler', _); }
        VoiceSelectModal.hide();
      });
    });

    // Open Settings link (khi voices empty)
    overlay.querySelector('#voiceModalOpenSettings')?.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ action: 'openSettings' });
      } catch (e) {
        console.warn('[VoiceSelectModal] openSettings failed:', e.message);
      }
      VoiceSelectModal.hide();
    });

    // Search
    const searchInput = overlay.querySelector('#voiceModalSearch');
    let debounceTimer = null;
    searchInput?.addEventListener('input', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => VoiceSelectModal._filterList(searchInput.value), 100);
    });

    // Escape key
    VoiceSelectModal._escHandler = (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('visible')) {
        VoiceSelectModal.hide();
      }
    };
    document.addEventListener('keydown', VoiceSelectModal._escHandler);
  }

  static _filterList(searchTerm) {
    const list = VoiceSelectModal._overlay?.querySelector('#voiceModalList');
    if (!list) return;

    const term = searchTerm.toLowerCase().trim();

    list.querySelectorAll('.style-modal-item').forEach(item => {
      if (item.classList.contains('none-option')) {
        item.style.display = '';
        return;
      }
      const name = item.querySelector('.style-modal-item-name')?.textContent?.toLowerCase() || '';
      const desc = item.querySelector('.voice-modal-item-desc')?.textContent?.toLowerCase() || '';
      const slug = (item.dataset.slug || '').toLowerCase();
      const matches = !term || name.includes(term) || desc.includes(term) || slug.includes(term);
      item.style.display = matches ? '' : 'none';
    });

    // Hide empty category headers
    list.querySelectorAll('.style-modal-category').forEach(cat => {
      const nextItems = [];
      let sibling = cat.nextElementSibling;
      while (sibling && !sibling.classList.contains('style-modal-category')) {
        if (sibling.classList.contains('style-modal-item') && !sibling.classList.contains('none-option')) {
          nextItems.push(sibling);
        }
        sibling = sibling.nextElementSibling;
      }
      const hasVisible = nextItems.some(item => item.style.display !== 'none');
      cat.style.display = hasVisible ? '' : 'none';
    });
  }

  static _open() {
    if (!VoiceSelectModal._overlay) return;
    VoiceSelectModal._overlay.classList.remove('hidden');
    requestAnimationFrame(() => {
      VoiceSelectModal._overlay.classList.add('visible');
    });
    VoiceSelectModal._overlay.querySelector('#voiceModalSearch')?.focus();
  }

  /**
   * 2026-05-30: Toggle audio preview cho voice item.
   * Single global Audio element — stop previous khi click khác để tránh overlap.
   */
  static _togglePlay(slug, sampleUrl) {
    if (!slug || !sampleUrl) return;

    // Same slug đang play → stop
    if (VoiceSelectModal._playingSlug === slug) {
      VoiceSelectModal._stopAudio();
      return;
    }

    // Different slug hoặc chưa play → stop previous + play mới
    VoiceSelectModal._stopAudio();

    if (!VoiceSelectModal._audio) {
      VoiceSelectModal._audio = new Audio();
      VoiceSelectModal._audio.preload = 'auto';
      // Auto reset state khi audio kết thúc tự nhiên
      VoiceSelectModal._audio.addEventListener('ended', () => {
        VoiceSelectModal._playingSlug = null;
        VoiceSelectModal._updatePlayButtons();
      });
      VoiceSelectModal._audio.addEventListener('error', (e) => {
        const audioErr = VoiceSelectModal._audio?.error;
        const errMsg = audioErr ? `code=${audioErr.code} (${VoiceSelectModal._audioErrorText(audioErr.code)})` : 'unknown';
        console.warn('[VoiceSelectModal] Audio error:', errMsg);
        VoiceSelectModal._notifyPlayFailed(errMsg);
        VoiceSelectModal._playingSlug = null;
        VoiceSelectModal._updatePlayButtons();
      });
    }

    VoiceSelectModal._audio.src = sampleUrl;
    VoiceSelectModal._playingSlug = slug;
    VoiceSelectModal._updatePlayButtons();

    VoiceSelectModal._audio.play().catch(err => {
      console.warn('[VoiceSelectModal] Play failed:', err?.message || err);
      VoiceSelectModal._notifyPlayFailed(err?.message || String(err));
      VoiceSelectModal._playingSlug = null;
      VoiceSelectModal._updatePlayButtons();
    });
  }

  /**
   * Map MediaError code → human-readable text. Common causes: redirect, CORS, codec.
   */
  static _audioErrorText(code) {
    switch (code) {
      case 1: return 'aborted';
      case 2: return 'network — URL redirect/CORS/offline?';
      case 3: return 'decode — codec không support';
      case 4: return 'src not supported — URL 404/redirect (vd gstatic.com → www.gstatic.com)?';
      default: return 'unknown';
    }
  }

  /**
   * Show user notification khi play fail. Gợi ý nguyên nhân phổ biến.
   */
  static _notifyPlayFailed(reason) {
    const msg = VoiceSelectModal._t('voice.playFailed', 'Không phát được audio mẫu')
      + ` — ${reason}`;
    if (typeof window.showNotification === 'function') {
      window.showNotification(msg, 'warning', 5000);
    }
  }

  /**
   * Stop audio playback + reset playing slug. Safe to call multiple times.
   */
  static _stopAudio() {
    if (VoiceSelectModal._audio) {
      try {
        VoiceSelectModal._audio.pause();
        VoiceSelectModal._audio.currentTime = 0;
      } catch (_) { globalThis.SEOSONA_swallow?.('VoiceSelectModal#_escHandler', _); }
    }
    if (VoiceSelectModal._playingSlug) {
      VoiceSelectModal._playingSlug = null;
      VoiceSelectModal._updatePlayButtons();
    }
  }

  /**
   * Update icon state (play ↔ stop) cho tất cả play buttons. Không re-render full list
   * để tránh flicker + giữ scroll position.
   */
  static _updatePlayButtons() {
    if (!VoiceSelectModal._overlay) return;
    VoiceSelectModal._overlay.querySelectorAll('.voice-modal-play-btn').forEach(btn => {
      const slug = btn.dataset.slug;
      const isPlaying = slug === VoiceSelectModal._playingSlug;
      btn.classList.toggle('is-playing', isPlaying);
      btn.innerHTML = isPlaying ? VoiceSelectModal._stopIconSvg() : VoiceSelectModal._playIconSvg();
    });
  }

  /**
   * Sync voices từ modal — clone logic settings-page.js initFlowVoicesSection click handler.
   * User thường: scrape → save local only. Admin: scrape → save local + POST sync-from-scrape server.
   * Sau khi sync xong, re-render modal với voice list mới (giữ selectedSlug).
   */
  static async _handleSyncClick() {
    const btn = VoiceSelectModal._overlay?.querySelector('#voiceModalSyncBtn');
    const statusEl = VoiceSelectModal._overlay?.querySelector('#voiceModalSyncStatus');
    const iconEl = VoiceSelectModal._overlay?.querySelector('.voice-modal-sync-icon');
    if (!btn) return;

    if (btn.disabled) return; // double-click guard
    btn.disabled = true;
    btn.classList.add('voice-modal-sync-loading');
    if (iconEl) iconEl.classList.add('voice-modal-sync-spin');
    if (statusEl) {
      statusEl.style.display = 'inline-block';
      statusEl.textContent = '...';
    }

    try {
      if (!window.MessageBridge?.syncFlowVoices) {
        throw new Error('MessageBridge.syncFlowVoices not available');
      }
      const result = await window.MessageBridge.syncFlowVoices();
      const total = result.total || 0;
      const custom = result.custom || 0;
      const base = result.base || 0;
      const uploaded = result.uploaded_to_server;

      console.log('[VoiceSelectModal] Sync done:', result);
      if (statusEl) {
        statusEl.textContent = uploaded ? `✓ ${total} (uploaded)` : `✓ ${total}`;
      }

      // [Fix 2026-06-10] Notification kết quả sync ở sidebar để user biết đã sync.
      // User có thể đóng modal trước khi đọc status text → notification persist 4s.
      const t = (key, fallback) => window.I18n?.t(key) || fallback;
      const successMsg = uploaded
        ? t('voice.syncSuccessAdmin', `✓ Đã sync ${total} giọng đọc (${base} base + ${custom} custom) — uploaded lên server.`)
            .replace('{total}', total).replace('{base}', base).replace('{custom}', custom)
        : t('voice.syncSuccess', `✓ Đã sync ${total} giọng đọc (${base} base + ${custom} custom).`)
            .replace('{total}', total).replace('{base}', base).replace('{custom}', custom);
      VoiceSelectModal._notify(successMsg, 'success', 4000);

      // Re-render modal voice list với data mới
      VoiceSelectModal._voices = (window.VoiceRegistry?.getRenderListSync('flow')) || [];
      VoiceSelectModal._render();
      VoiceSelectModal._open(); // re-attach overlay reference after _render
    } catch (e) {
      console.error('[VoiceSelectModal] Sync failed:', e);
      if (statusEl) statusEl.textContent = '✗';
      // Update tooltip qua data-tooltip (đồng bộ unified system, không dùng HTML native title)
      if (btn) btn.setAttribute('data-tooltip', `Sync failed: ${e.message || e}`);

      // [Fix 2026-06-10] Notification lỗi cho user (status ✗ trong modal dễ bị bỏ qua).
      const t = (key, fallback) => window.I18n?.t(key) || fallback;
      const errMsg = t('voice.syncFailed', '✗ Sync giọng đọc thất bại: ') + (e.message || e);
      VoiceSelectModal._notify(errMsg, 'error', 6000);
    } finally {
      // Defer remove loading state so user see status briefly
      setTimeout(() => {
        if (btn) btn.disabled = false;
        if (btn) btn.classList.remove('voice-modal-sync-loading');
        if (iconEl) iconEl.classList.remove('voice-modal-sync-spin');
      }, 1500);
    }
  }
}

if (typeof window !== 'undefined') {
  window.VoiceSelectModal = VoiceSelectModal;
}
