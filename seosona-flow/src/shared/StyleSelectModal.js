/**
 * StyleSelectModal - Modal for selecting addon prompts/styles
 * Renders at root level to avoid overflow clipping issues
 */
class StyleSelectModal {
  static _instance = null;
  static _overlay = null;
  static _onSelect = null;
  static _addons = [];
  static _selectedId = null;

  /**
   * Show the style select modal
   * @param {Object} options
   * @param {Array} options.addons - Array of addon objects with id, name, thumbnail_url, category
   * @param {string|null} options.selectedId - Currently selected addon ID
   * @param {Function} options.onSelect - Callback when addon is selected, receives addon object or null
   */
  static show({ addons = [], selectedId = null, onSelect = () => {} }) {
    StyleSelectModal._builtin = addons;
    StyleSelectModal._addons = addons;
    StyleSelectModal._selectedId = selectedId;
    StyleSelectModal._onSelect = onSelect;
    StyleSelectModal._render();
    StyleSelectModal._open();
    // Style của người dùng nạp BẤT ĐỒNG BỘ rồi vẽ lại — chờ storage xong mới mở modal
    // thì người dùng thấy độ trễ vô cớ, mà 99% thời gian danh sách chẳng đổi mấy.
    StyleSelectModal._loadUserStyles();
  }

  /** Nạp style cục bộ rồi gộp với style hệ thống. Lỗi thì im lặng giữ danh sách gốc. */
  static async _loadUserStyles() {
    const St = window.UserStyleStore;
    if (!St) return;
    try {
      const mine = await St.load();
      StyleSelectModal._user = mine;
      StyleSelectModal._addons = St.mergeForDisplay(StyleSelectModal._builtin || [], mine);
      if (StyleSelectModal._overlay && !StyleSelectModal._overlay.classList.contains('hidden')) {
        const open = StyleSelectModal._overlay.classList.contains('visible');
        StyleSelectModal._render();
        if (open) StyleSelectModal._open();
      }
    } catch (e) { console.warn('[StyleSelectModal] nạp style cục bộ lỗi:', e?.message); }
  }

  static _isMine(id) {
    return (StyleSelectModal._user || []).some((s) => s && s.id === id);
  }

  /** Mở form tạo mới / sửa. `id` rỗng = tạo mới. */
  static _showForm(id) {
    const box = StyleSelectModal._overlay?.querySelector('#styleModalForm');
    if (!box) return;
    const cur = (StyleSelectModal._user || []).find((s) => s.id === id) || null;
    box.dataset.editing = cur ? cur.id : '';
    box.querySelector('#styleFormName').value = cur ? cur.name : '';
    box.querySelector('#styleFormContent').value = cur ? cur.content : '';
    box.querySelector('#styleFormErr').textContent = '';
    box.querySelector('#styleFormDelete').style.display = cur ? '' : 'none';
    box.classList.remove('hidden');
    box.querySelector('#styleFormName').focus();
    StyleSelectModal._updateCharCount();
  }

  static _hideForm() {
    StyleSelectModal._overlay?.querySelector('#styleModalForm')?.classList.add('hidden');
  }

  static _isFormOpen() {
    const b = StyleSelectModal._overlay?.querySelector('#styleModalForm');
    return !!(b && !b.classList.contains('hidden'));
  }

  static _updateCharCount() {
    const St = window.UserStyleStore;
    const box = StyleSelectModal._overlay?.querySelector('#styleModalForm');
    if (!box || !St) return;
    const n = (box.querySelector('#styleFormContent')?.value || '').length;
    const el = box.querySelector('#styleFormCount');
    if (el) el.textContent = `${n}/${St.MAX_CONTENT}`;
  }

  static _showFormError(msg) {
    const el = StyleSelectModal._overlay?.querySelector('#styleFormErr');
    if (el) el.textContent = msg || '';
  }

  static async _saveForm() {
    const St = window.UserStyleStore;
    const box = StyleSelectModal._overlay?.querySelector('#styleModalForm');
    if (!St || !box) return;
    const id = box.dataset.editing || null;
    const r = St.upsert(StyleSelectModal._user || [], {
      id,
      name: box.querySelector('#styleFormName').value,
      content: box.querySelector('#styleFormContent').value,
    });
    // Lỗi từ store đã là câu tiếng Việt — hiện thẳng, không dịch lại.
    if (!r.ok) { StyleSelectModal._showFormError(r.error); return; }
    await St.save(r.list);
    StyleSelectModal._user = r.list;
    StyleSelectModal._addons = St.mergeForDisplay(StyleSelectModal._builtin || [], r.list);
    StyleSelectModal._hideForm();
    StyleSelectModal._render();
    StyleSelectModal._open();
  }

  static async _deleteForm() {
    const St = window.UserStyleStore;
    const box = StyleSelectModal._overlay?.querySelector('#styleModalForm');
    if (!St || !box?.dataset.editing) return;
    const cur = (StyleSelectModal._user || []).find((s) => s.id === box.dataset.editing);
    const ok = window.customDialog?.confirm
      ? await window.customDialog.confirm(`Xoá style "${cur?.name || ''}"? Không khôi phục được.`, 'Xoá style')
      : true;
    if (!ok) return;
    const r = St.remove(StyleSelectModal._user || [], box.dataset.editing);
    if (!r.ok) { StyleSelectModal._showFormError(r.error); return; }
    await St.save(r.list);
    StyleSelectModal._user = r.list;
    StyleSelectModal._addons = St.mergeForDisplay(StyleSelectModal._builtin || [], r.list);
    // Đang chọn đúng style vừa xoá thì bỏ chọn, không để trỏ vào thứ không còn tồn tại.
    if (StyleSelectModal._selectedId === box.dataset.editing) StyleSelectModal._selectedId = null;
    StyleSelectModal._hideForm();
    StyleSelectModal._render();
    StyleSelectModal._open();
  }

  static hide() {
    if (StyleSelectModal._overlay) {
      StyleSelectModal._overlay.classList.add('hidden');
      StyleSelectModal._overlay.classList.remove('visible');
    }
  }

  static _getContainer() {
    let container = document.getElementById('styleSelectModalContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'styleSelectModalContainer';
      document.body.appendChild(container);
    }
    return container;
  }

  static _render() {
    const container = StyleSelectModal._getContainer();
    const t = (key) => window.I18n?.t(key) || key;

    // Group addons by category
    const grouped = {};
    const uncategorized = [];

    for (const addon of StyleSelectModal._addons) {
      if (addon.category) {
        if (!grouped[addon.category]) grouped[addon.category] = [];
        grouped[addon.category].push(addon);
      } else {
        uncategorized.push(addon);
      }
    }

    const categories = Object.keys(grouped).sort();

    let itemsHtml = `
      <div class="style-modal-item none-option ${!StyleSelectModal._selectedId ? 'selected' : ''}" data-id="">
        <div class="style-modal-item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
        </div>
        <span class="style-modal-item-name">${t('gen.noStyle') || 'Không chọn phong cách'}</span>
      </div>
    `;

    // Render by category
    for (const category of categories) {
      itemsHtml += `<div class="style-modal-category">${StyleSelectModal._esc(category)}</div>`;
      for (const addon of grouped[category]) {
        itemsHtml += StyleSelectModal._renderItem(addon);
      }
    }

    // Render uncategorized
    if (uncategorized.length > 0) {
      if (categories.length > 0) {
        itemsHtml += `<div class="style-modal-category">${t('gen.otherStyles') || 'Khác'}</div>`;
      }
      for (const addon of uncategorized) {
        itemsHtml += StyleSelectModal._renderItem(addon);
      }
    }

    container.innerHTML = `
      <div class="style-modal-overlay hidden" id="styleSelectModalOverlay">
        <div class="style-modal-backdrop"></div>
        <div class="style-modal-content">
          <div class="style-modal-header">
            <h3 class="style-modal-title">${t('gen.selectStyle') || 'Chọn phong cách'}</h3>
            <button type="button" class="style-modal-close" id="styleModalClose">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="style-modal-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="text" id="styleModalSearch" placeholder="${t('gen.styleSearch') || 'Tìm phong cách...'}" />
          </div>
          <div class="style-modal-list" id="styleModalList">
            ${itemsHtml}
          </div>
          <div class="style-modal-foot">
            <button type="button" class="s-btn s-btn-secondary" id="styleModalNew">+ Tạo style của tôi</button>
          </div>
          <div class="style-modal-form hidden" id="styleModalForm" data-editing="">
            <input type="text" id="styleFormName" maxlength="${window.UserStyleStore?.MAX_NAME || 60}" placeholder="Tên style (VD: Phim 35mm)" />
            <textarea id="styleFormContent" maxlength="${window.UserStyleStore?.MAX_CONTENT || 4000}" placeholder="Nội dung style — mỗi dòng 1 đặc điểm cụ thể:&#10;film 35mm, hạt phim nhẹ&#10;bảng màu đất: nâu, cam cháy, kem&#10;ánh sáng cửa sổ mềm, bóng đổ dài"></textarea>
            <div class="style-modal-form-row">
              <span class="style-modal-form-count" id="styleFormCount"></span>
              <span class="style-modal-form-err" id="styleFormErr"></span>
            </div>
            <div class="style-modal-form-actions">
              <button type="button" class="s-btn s-btn-secondary" id="styleFormDelete">Xoá</button>
              <span style="flex:1"></span>
              <button type="button" class="s-btn s-btn-secondary" id="styleFormCancel">Huỷ</button>
              <button type="button" class="s-btn" id="styleFormSave">Lưu</button>
            </div>
          </div>
        </div>
      </div>
    `;

    StyleSelectModal._overlay = container.querySelector('#styleSelectModalOverlay');
    StyleSelectModal._bindEvents();
  }

  // Port 1.1.58: XSS-escape cho addon name / thumbnail_url / category (data có thể chứa ký tự HTML).
  static _esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  static _renderItem(addon) {
    const isSelected = String(addon.id) === String(StyleSelectModal._selectedId);
    const thumbHtml = addon.thumbnail_url
      ? `<img class="style-modal-item-thumb" src="${StyleSelectModal._esc(addon.thumbnail_url)}" alt="${StyleSelectModal._esc(addon.name)}" loading="lazy" />`
      : `<div class="style-modal-item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"></path>
            <path d="M17 4a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2"></path>
          </svg>
        </div>`;

    // Chỉ style CỦA NGƯỜI DÙNG mới sửa được — style hệ thống không có nút bút chì.
    const editHtml = StyleSelectModal._isMine(addon.id)
      ? `<button type="button" class="style-modal-edit" data-edit-id="${StyleSelectModal._esc(addon.id)}" title="Sửa style của tôi" aria-label="Sửa style ${StyleSelectModal._esc(addon.name)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        </button>`
      : '';

    return `
      <div class="style-modal-item ${isSelected ? 'selected' : ''}" data-id="${addon.id}">
        ${thumbHtml}
        <span class="style-modal-item-name">${StyleSelectModal._esc(addon.name) || (window.I18n?.t('common.untitled') || 'Không tên')}</span>
        ${editHtml}
        ${isSelected ? `
          <svg class="style-modal-item-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        ` : ''}
      </div>
    `;
  }

  static _bindEvents() {
    const overlay = StyleSelectModal._overlay;
    if (!overlay) return;

    // Close button
    overlay.querySelector('#styleModalClose')?.addEventListener('click', () => {
      StyleSelectModal.hide();
    });

    // Backdrop click
    overlay.querySelector('.style-modal-backdrop')?.addEventListener('click', () => {
      StyleSelectModal.hide();
    });

    // ── Style của người dùng: tạo / sửa / xoá ───────────────────────────────
    overlay.querySelector('#styleModalNew')?.addEventListener('click', () => StyleSelectModal._showForm(''));
    overlay.querySelector('#styleFormCancel')?.addEventListener('click', () => StyleSelectModal._hideForm());
    overlay.querySelector('#styleFormSave')?.addEventListener('click', () => StyleSelectModal._saveForm());
    overlay.querySelector('#styleFormDelete')?.addEventListener('click', () => StyleSelectModal._deleteForm());
    overlay.querySelector('#styleFormContent')?.addEventListener('input', () => StyleSelectModal._updateCharCount());
    // Nút bút chì chỉ hiện trên style CỦA NGƯỜI DÙNG — style hệ thống không sửa được.
    overlay.querySelectorAll('.style-modal-edit').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();   // không để click lan ra ngoài thành "chọn style rồi đóng modal"
        StyleSelectModal._showForm(b.dataset.editId);
      });
    });

    // Item selection
    overlay.querySelectorAll('.style-modal-item').forEach(item => {
      item.addEventListener('click', () => {
        // Form đang mở thì click ngoài danh sách không được đóng modal mất nội dung đang gõ.
        if (StyleSelectModal._isFormOpen()) return;
        const id = item.dataset.id;
        const addon = id ? StyleSelectModal._addons.find(a => String(a.id) === String(id)) : null;
        StyleSelectModal._onSelect(addon);
        StyleSelectModal.hide();
      });
    });

    // Search
    const searchInput = overlay.querySelector('#styleModalSearch');
    searchInput?.addEventListener('input', () => {
      StyleSelectModal._filterList(searchInput.value);
    });

    // Escape key
    const escHandler = (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('visible')) {
        StyleSelectModal.hide();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  static _filterList(searchTerm) {
    const list = StyleSelectModal._overlay?.querySelector('#styleModalList');
    if (!list) return;

    const term = searchTerm.toLowerCase().trim();

    list.querySelectorAll('.style-modal-item').forEach(item => {
      const name = item.querySelector('.style-modal-item-name')?.textContent?.toLowerCase() || '';
      const matches = !term || name.includes(term) || item.classList.contains('none-option');
      item.style.display = matches ? '' : 'none';
    });

    // Hide empty categories
    list.querySelectorAll('.style-modal-category').forEach(cat => {
      const nextItems = [];
      let sibling = cat.nextElementSibling;
      while (sibling && !sibling.classList.contains('style-modal-category')) {
        if (sibling.classList.contains('style-modal-item')) {
          nextItems.push(sibling);
        }
        sibling = sibling.nextElementSibling;
      }
      const hasVisible = nextItems.some(item => item.style.display !== 'none');
      cat.style.display = hasVisible ? '' : 'none';
    });
  }

  static _open() {
    if (StyleSelectModal._overlay) {
      StyleSelectModal._overlay.classList.remove('hidden');
      // Trigger animation
      requestAnimationFrame(() => {
        StyleSelectModal._overlay.classList.add('visible');
      });
      // Focus search
      StyleSelectModal._overlay.querySelector('#styleModalSearch')?.focus();
    }
  }
}

// Export for use
window.StyleSelectModal = StyleSelectModal;
