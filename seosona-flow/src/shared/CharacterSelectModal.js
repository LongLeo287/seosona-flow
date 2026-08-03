/**
 * CharacterSelectModal — modal full-screen chọn nhân vật Flow.
 * Clone VoiceSelectModal (lược bỏ audio sample + admin gate + base/custom grouping).
 * Tái dùng CSS `.style-modal-*` (đã có sẵn từ voice/style modal).
 *
 * Usage:
 *   CharacterSelectModal.show({
 *     characters: [...],
 *     selectedSlug: 'seosona',
 *     onSelect: (charObj) => { ... },  // charObj = null khi chọn "Không dùng"
 *   });
 */
class CharacterSelectModal {
  static _overlay = null;
  static _onSelect = null;
  static _characters = [];
  static _selectedSlug = null;
  static _escHandler = null;

  static show({ characters = [], selectedSlug = null, onSelect = () => {} }) {
    // Audit fix (memory leak): if a prior instance was force-closed without hide(),
    // its keydown listener is still bound and _bindEvents() would add another.
    // Unbind at the start of show() so handlers don't stack across opens.
    if (CharacterSelectModal._escHandler) {
      document.removeEventListener('keydown', CharacterSelectModal._escHandler);
      CharacterSelectModal._escHandler = null;
    }
    CharacterSelectModal._characters = characters || [];
    CharacterSelectModal._selectedSlug = selectedSlug;
    CharacterSelectModal._onSelect = onSelect;
    CharacterSelectModal._render();
    CharacterSelectModal._open();
    CharacterSelectModal._refreshAsync();
  }

  /** Async load fresh từ CharacterRegistry (local) + re-render nếu khác. */
  static async _refreshAsync() {
    try {
      const fresh = await window.CharacterRegistry?.getRenderList?.();
      if (!Array.isArray(fresh)) return;
      if (!CharacterSelectModal._overlay || !document.body.contains(CharacterSelectModal._overlay)) {
        CharacterSelectModal._characters = fresh;
        return;
      }
      const before = JSON.stringify(CharacterSelectModal._characters.map(c => c.slug));
      const after = JSON.stringify(fresh.map(c => c.slug));
      if (before === after) return; // không đổi → skip render tránh flicker
      CharacterSelectModal._characters = fresh;
      CharacterSelectModal._render();
      CharacterSelectModal._open();
    } catch (e) {
      console.warn('[CharacterSelectModal] _refreshAsync failed:', e?.message || e);
    }
  }

  static hide() {
    if (CharacterSelectModal._overlay) {
      CharacterSelectModal._overlay.classList.remove('visible');
      setTimeout(() => CharacterSelectModal._overlay?.classList.add('hidden'), 200);
    }
    if (CharacterSelectModal._escHandler) {
      document.removeEventListener('keydown', CharacterSelectModal._escHandler);
      CharacterSelectModal._escHandler = null;
    }
  }

  static _getContainer() {
    let container = document.getElementById('characterSelectModalContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'characterSelectModalContainer';
      document.body.appendChild(container);
    }
    return container;
  }

  static _t(key, fallback) {
    return window.I18n?.t?.(key) || fallback;
  }

  static _esc(str) {
    return String(str || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  static _notify(message, type = 'info', duration = 4000) {
    try {
      if (typeof window.showNotification === 'function') { window.showNotification(message, type, duration); return; }
      if (typeof window.showToast === 'function') { window.showToast(message); return; }
      if (window.customDialog?.alert) { window.customDialog.alert(message, { type }); return; }
      console.log(`[CharacterSelectModal] ${type}: ${message}`);
    } catch (_) { globalThis.SEOSONA_swallow?.('CharacterSelectModal#onSelect', _); }
  }

  static _characterIconSvg() {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="8" r="4"></circle>
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"></path>
    </svg>`;
  }

  static _renderItem(c) {
    const isSelected = c.slug === CharacterSelectModal._selectedSlug;
    const thumbUrl = c.thumbnail_url || null; // full URL Google media (sidebar có cookies)
    const thumbHtml = thumbUrl
      ? `<img class="style-modal-item-thumb" src="${CharacterSelectModal._esc(thumbUrl)}" alt="${CharacterSelectModal._esc(c.name || '')}" loading="lazy" referrerpolicy="no-referrer" />`
      : `<div class="style-modal-item-icon">${CharacterSelectModal._characterIconSvg()}</div>`;

    return `
      <div class="style-modal-item ${isSelected ? 'selected' : ''}" data-slug="${CharacterSelectModal._esc(c.slug)}">
        ${thumbHtml}
        <div class="voice-modal-item-info">
          <span class="style-modal-item-name">${CharacterSelectModal._esc(c.name || c.search_value || c.slug)}</span>
        </div>
        ${isSelected ? `
          <svg class="style-modal-item-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        ` : ''}
      </div>
    `;
  }

  static _render() {
    const container = CharacterSelectModal._getContainer();
    const t = CharacterSelectModal._t;

    const noneSelected = !CharacterSelectModal._selectedSlug;
    let itemsHtml = `
      <div class="style-modal-item none-option ${noneSelected ? 'selected' : ''}" data-slug="">
        <div class="style-modal-item-icon">${CharacterSelectModal._characterIconSvg()}</div>
        <div class="voice-modal-item-info">
          <span class="style-modal-item-name">${t('character.none', 'Không dùng nhân vật')}</span>
          <span class="voice-modal-item-desc">${t('character.noneDesc', 'Gen không kèm nhân vật')}</span>
        </div>
        ${noneSelected ? `
          <svg class="style-modal-item-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        ` : ''}
      </div>
    `;

    if (CharacterSelectModal._characters.length === 0) {
      itemsHtml += `
        <div class="voice-modal-empty">
          <p>${t('character.empty', 'Chưa có nhân vật — bấm Đồng bộ để quét từ Flow.')}</p>
        </div>
      `;
    } else {
      itemsHtml += CharacterSelectModal._characters.map(c => CharacterSelectModal._renderItem(c)).join('');
    }

    container.innerHTML = `
      <div class="style-modal-overlay hidden" id="characterSelectModalOverlay">
        <div class="style-modal-backdrop"></div>
        <div class="style-modal-content">
          <div class="style-modal-header">
            <h3 class="style-modal-title">${t('character.pickerTitle', 'Chọn nhân vật')}</h3>
            <div class="voice-modal-header-actions">
              <button type="button" class="voice-modal-sync-btn" id="characterModalSyncBtn"
                      data-i18n-tooltip="character.syncTooltip"
                      data-tooltip="${CharacterSelectModal._esc(t('character.syncTooltip', 'Đồng bộ nhân vật từ Flow'))}"
                      data-tooltip-pos="bottom">
                <svg class="voice-modal-sync-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
                <span class="voice-modal-sync-status" id="characterModalSyncStatus" style="display:none;"></span>
              </button>
              <button type="button" class="style-modal-close" id="characterModalClose"
                      data-i18n-tooltip="common.close"
                      data-tooltip="${CharacterSelectModal._esc(t('common.close', 'Đóng'))}"
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
            <input type="text" id="characterModalSearch" placeholder="${t('character.searchPlaceholder', 'Tìm nhân vật...')}" />
          </div>
          <div class="style-modal-list" id="characterModalList">
            ${itemsHtml}
          </div>
        </div>
      </div>
    `;

    CharacterSelectModal._overlay = container.querySelector('#characterSelectModalOverlay');
    CharacterSelectModal._bindEvents();
  }

  static _bindEvents() {
    const overlay = CharacterSelectModal._overlay;
    if (!overlay) return;

    overlay.querySelector('#characterModalClose')?.addEventListener('click', () => CharacterSelectModal.hide());
    overlay.querySelector('.style-modal-backdrop')?.addEventListener('click', () => CharacterSelectModal.hide());

    overlay.querySelector('#characterModalSyncBtn')?.addEventListener('click', async () => {
      await CharacterSelectModal._handleSyncClick();
    });

    overlay.querySelectorAll('.style-modal-item').forEach(item => {
      item.addEventListener('click', () => {
        const slug = item.dataset.slug || '';
        const character = slug ? CharacterSelectModal._characters.find(c => c.slug === slug) : null;
        try { CharacterSelectModal._onSelect(character); } catch (_) { globalThis.SEOSONA_swallow?.('CharacterSelectModal#onSelect', _); }
        CharacterSelectModal.hide();
      });
    });

    const searchInput = overlay.querySelector('#characterModalSearch');
    let debounceTimer = null;
    searchInput?.addEventListener('input', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => CharacterSelectModal._filterList(searchInput.value), 100);
    });

    CharacterSelectModal._escHandler = (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('visible')) {
        CharacterSelectModal.hide();
      }
    };
    document.addEventListener('keydown', CharacterSelectModal._escHandler);
  }

  static _filterList(searchTerm) {
    const list = CharacterSelectModal._overlay?.querySelector('#characterModalList');
    if (!list) return;
    const term = searchTerm.toLowerCase().trim();
    list.querySelectorAll('.style-modal-item').forEach(item => {
      if (item.classList.contains('none-option')) { item.style.display = ''; return; }
      const name = item.querySelector('.style-modal-item-name')?.textContent?.toLowerCase() || '';
      const slug = (item.dataset.slug || '').toLowerCase();
      const matches = !term || name.includes(term) || slug.includes(term);
      item.style.display = matches ? '' : 'none';
    });
  }

  static _open() {
    if (!CharacterSelectModal._overlay) return;
    CharacterSelectModal._overlay.classList.remove('hidden');
    requestAnimationFrame(() => CharacterSelectModal._overlay.classList.add('visible'));
    CharacterSelectModal._overlay.querySelector('#characterModalSearch')?.focus();
  }

  static async _handleSyncClick() {
    const btn = CharacterSelectModal._overlay?.querySelector('#characterModalSyncBtn');
    const statusEl = CharacterSelectModal._overlay?.querySelector('#characterModalSyncStatus');
    const iconEl = CharacterSelectModal._overlay?.querySelector('.voice-modal-sync-icon');
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    btn.classList.add('voice-modal-sync-loading');
    if (iconEl) iconEl.classList.add('voice-modal-sync-spin');
    if (statusEl) { statusEl.style.display = 'inline-block'; statusEl.textContent = '...'; }

    try {
      if (!window.MessageBridge?.syncFlowCharacters) {
        throw new Error('MessageBridge.syncFlowCharacters not available');
      }
      const result = await window.MessageBridge.syncFlowCharacters();
      const total = result.total || 0;
      if (statusEl) statusEl.textContent = `✓ ${total}`;
      const t = (key, fallback) => window.I18n?.t(key) || fallback;
      CharacterSelectModal._notify(
        t('character.syncSuccess', `✓ Đã đồng bộ ${total} nhân vật.`).replace('{total}', total),
        'success', 4000);

      // Dùng await getRenderList() (đọc lại disk) thay getRenderListSync — tránh race với
      // cross-context storage listener reset _scrapedCache=null → list rỗng → modal không update.
      CharacterSelectModal._characters = (await window.CharacterRegistry?.getRenderList?.()) || [];
      CharacterSelectModal._render();
      CharacterSelectModal._open();
    } catch (e) {
      console.error('[CharacterSelectModal] Sync failed:', e);
      if (statusEl) statusEl.textContent = '✗';
      const t = (key, fallback) => window.I18n?.t(key) || fallback;
      CharacterSelectModal._notify(t('character.syncFailed', '✗ Đồng bộ nhân vật thất bại: ') + (e.message || e), 'error', 6000);
    } finally {
      setTimeout(() => {
        if (btn) { btn.disabled = false; btn.classList.remove('voice-modal-sync-loading'); }
        if (iconEl) iconEl.classList.remove('voice-modal-sync-spin');
      }, 1500);
    }
  }
}

if (typeof window !== 'undefined') {
  window.CharacterSelectModal = CharacterSelectModal;
}
