/**
 * MyPromptsTab — Quản lý sub-tab "My Prompt" trong tab Prompts
 * Hiển thị danh sách prompt cá nhân, CRUD, tìm kiếm, sử dụng prompt
 */
class MyPromptsTab {
  static _prompts = [];
  static _filteredPrompts = [];
  static _selectedCategory = null;
  static _searchQuery = '';

  static init() {
    this._bindSubtabs();
    this._bindEvents();
    this._loadPrompts();

    // Re-render khi đổi ngôn ngữ
    window.eventBus?.on('i18n:changed', () => {
      this._filterAndRender();
    });
  }

  // Sub-tab switching for Templates/My Prompt
  static _bindSubtabs() {
    const subtabs = document.querySelectorAll('.prompts-subtab');
    subtabs.forEach(tab => {
      tab.addEventListener('click', () => {
        subtabs.forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.prompts-subtab-pane').forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        const paneId = tab.dataset.subtab;
        const pane = document.getElementById(paneId);
        if (pane) pane.classList.add('active');

        if (paneId === 'subtab-myprompts') {
          this._loadPrompts();
        }
      });
    });
  }

  static _bindEvents() {
    // Add new prompt — gate trước khi mở dialog: anonymous → modal login,
    // logged-in nhưng quota hết → modal upgrade.
    document.getElementById('addMyPromptBtn')?.addEventListener('click', async () => {
      if (window.featureGate) {
        const canCreate = await window.featureGate.canCreateSnippetAsync();
        if (!canCreate) {
          const isLoggedIn = true;
          if (!isLoggedIn) {
            window.featureGate.showLoginPrompt(
              window.I18n?.t('templates.requireLoginToSave') || 'Lưu prompt yêu cầu đăng nhập'
            );
          } else {
            // Hiển thị dialog với nút upgrade
            const snippetsMax = window.featureGate.entitlements?.snippets_max ?? 3;
            await window.customDialog?.confirm(
              window.I18n?.t('snippets.quotaReachedDetail', { max: snippetsMax }) ||
                `Bạn đã đạt giới hạn ${snippetsMax} prompt cho gói hiện tại. Nâng cấp để lưu không giới hạn.`,
              {
                title: window.I18n?.t('featuregate.featureLockedTitle') || 'Tính năng bị khóa',
                type: 'warning',
                confirmText: window.I18n?.t('common.upgrade') || 'Nâng cấp',
                cancelText: window.I18n?.t('common.close') || 'Đóng',
                onConfirm: () => {
                  window.eventBus?.emit('open:upgrade_modal');
                }
              }
            );
          }
          return;
        }
      }
      this._showSaveDialog();
    });

    // Search input (always visible)
    const searchInput = document.getElementById('myPromptsSearch');
    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this._searchQuery = searchInput.value.trim().toLowerCase();
          this._filterAndRender();
        }, 300);
      });
    }

    const reloadBtn = document.getElementById('reloadMyPromptsBtn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        this.loadPrompts();
      });
    }

    // Category select
    const categorySelect = document.getElementById('myPromptsCategoryFilter');
    if (categorySelect) {
      categorySelect.addEventListener('change', () => {
        this._selectedCategory = categorySelect.value || null;
        this._filterAndRender();
      });
    }
  }

  static async _loadPrompts() {
    if (!window.userPromptsManager) {
      console.warn('[MyPromptsTab] userPromptsManager chưa sẵn sàng');
      return;
    }

    // Show skeleton while loading
    this._showLoadingSkeletons();

    try {
      await window.userPromptsManager.loadPrompts();
      const result = window.userPromptsManager.getPrompts();
      this._prompts = Array.isArray(result) ? result : [];
      console.log('[MyPromptsTab] Đã tải', this._prompts.length, 'prompts');
      this._filterAndRender();
    } catch (err) {
      console.warn('[MyPromptsTab] Lỗi tải prompts:', err.message);
      this._prompts = [];
      this._filterAndRender();
    }
  }

  static _showLoadingSkeletons() {
    const container = document.getElementById('myPromptsList');
    if (!container) return;
    const skeletons = [];
    for (let i = 0; i < 4; i++) {
      skeletons.push(`
        <div class="myprompt-card skeleton">
          <div class="myprompt-card-top">
            <div class="myprompt-card-info">
              <div class="myprompt-card-header">
                <div class="skeleton-title"></div>
                <div class="skeleton-category"></div>
              </div>
              <div class="skeleton-content"></div>
              <div class="skeleton-content-2"></div>
            </div>
            <div class="myprompt-card-actions">
              <div class="skeleton-btn"></div>
            </div>
          </div>
        </div>
      `);
    }
    container.innerHTML = skeletons.join('');
  }

  static _filterAndRender(opts = {}) {
    var filtered = this._prompts.slice();

    if (this._selectedCategory) {
      filtered = filtered.filter(function(p) { return p.category === MyPromptsTab._selectedCategory; });
    }

    if (this._searchQuery) {
      var q = this._searchQuery;
      filtered = filtered.filter(function(p) {
        return (p.title || '').toLowerCase().indexOf(q) !== -1 ||
          (p.content || '').toLowerCase().indexOf(q) !== -1;
      });
    }

    this._filteredPrompts = filtered;
    this._renderCategories();
    this._renderList();
  }

  static _renderCategories() {
    const select = document.getElementById('myPromptsCategoryFilter');
    if (!select) return;

    const categories = window.userPromptsManager?.getCategories() || [];
    const filterRow = select.closest('.myprompts-filter-row');

    // Hide filter row if no categories
    if (categories.length === 0) {
      if (filterRow) filterRow.style.display = 'none';
      return;
    }
    if (filterRow) filterRow.style.display = '';

    // Preserve selection
    const currentVal = this._selectedCategory || '';
    select.innerHTML =
      '<option value="">' + (window.I18n?.t('templates.category') || 'Danh mục') + '</option>' +
      categories.map(cat =>
        '<option value="' + this._escapeAttr(cat) + '"' + (currentVal === cat ? ' selected' : '') + '>' + this._escapeHtml(cat) + '</option>'
      ).join('');
  }

  static _renderList() {
    const container = document.getElementById('myPromptsList');
    if (!container) return;

    if (this._filteredPrompts.length === 0) {
      const isFiltering = this._searchQuery || this._selectedCategory;
      if (isFiltering) {
        container.innerHTML =
          '<div class="myprompts-empty">' +
            '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>' +
            '<span>' + (window.I18n?.t('templates.noMatchingPrompts') || 'Không tìm thấy prompt phù hợp.') + '</span>' +
          '</div>';
      } else {
        container.innerHTML =
          '<div class="myprompts-empty-hero">' +
            '<div class="wf-empty-hero-icon">' +
              '<div class="wf-empty-glow"></div>' +
              '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>' +
            '</div>' +
            '<h3 class="workflow-empty-title">Kho Prompt Cá Nhân Của Bạn</h3>' +
            '<p class="workflow-empty-subtitle">Lưu trữ, quản lý và tái sử dụng các Prompt AI yêu thích một cách thông minh & nhanh chóng.</p>' +
            '<div class="wf-empty-pills">' +
              '<span class="wf-empty-pill">⭐ Lưu Prompt Yêu Thích</span>' +
              '<span class="wf-empty-pill">⚡ Dùng Lại 1-Click</span>' +
              '<span class="wf-empty-pill">📁 Quản Lý Danh Mục</span>' +
            '</div>' +
            '<div class="workflow-empty-actions">' +
              '<button class="wf-empty-primary-btn" id="addMyPromptBtnHero">' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
                '<span>Tạo Prompt Mới</span>' +
              '</button>' +
              '<button class="wf-empty-secondary-btn" id="goToTemplatesSubtabBtn">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>' +
                '<span>Khám Phá Thư Viện Mẫu</span>' +
              '</button>' +
            '</div>' +
          '</div>';
        
        var self = this;
        var btnAdd = container.querySelector('#addMyPromptBtnHero');
        if (btnAdd) btnAdd.addEventListener('click', function() { self._showAddModal(); });
        var btnTpl = container.querySelector('#goToTemplatesSubtabBtn');
        if (btnTpl) btnTpl.addEventListener('click', function() {
          var tplTab = document.querySelector('.prompts-subtab[data-subtab="subtab-templates"]');
          if (tplTab) tplTab.click();
        });
      }
      return;
    }

    // Server-side pagination — hiển thị tất cả prompts đã load
    var visiblePrompts = this._filteredPrompts;
    var paginationInfo = window.userPromptsManager?.getPaginationInfo?.() || {};
    var hasMore = window.userPromptsManager?.hasMore?.() || false;
    var remaining = (paginationInfo.total || 0) - (paginationInfo.loaded || 0);

    var cardsHtml = visiblePrompts.map(function(p) {
      return '<div class="myprompt-card" data-prompt-id="' + MyPromptsTab._escapeAttr(p.id) + '">' +
        '<div class="myprompt-card-top">' +
          '<div class="myprompt-card-info">' +
            '<div class="myprompt-card-header">' +
              '<span class="myprompt-card-title">' + MyPromptsTab._escapeHtml(p.title || (window.I18n?.t('templates.noTitle') || 'Không có tiêu đề')) + '</span>' +
              (p.category ? '<span class="myprompt-card-category">' + MyPromptsTab._escapeHtml(p.category) + '</span>' : '') +
            '</div>' +
            '<div class="myprompt-card-content">' + MyPromptsTab._escapeHtml(p.content || '') + '</div>' +
          '</div>' +
          '<div class="myprompt-card-actions">' +
            '<button class="btn btn-secondary btn-sm myprompt-card-use" data-action="use" data-id="' + MyPromptsTab._escapeAttr(p.id) + '">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>' +
              (window.I18n?.t('templates.useTemplate') || 'Dùng') +
            '</button>' +
            '<div class="myprompt-menu-wrapper">' +
              '<button class="btn btn-secondary btn-sm btn-icon myprompt-menu-btn" title="Menu">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                  '<circle cx="12" cy="5" r="1"></circle>' +
                  '<circle cx="12" cy="12" r="1"></circle>' +
                  '<circle cx="12" cy="19" r="1"></circle>' +
                '</svg>' +
              '</button>' +
              '<div class="myprompt-menu-dropdown hidden">' +
                '<button class="myprompt-menu-item" data-action="edit" data-id="' + MyPromptsTab._escapeAttr(p.id) + '">' +
                  '<svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 15.7502H9.75002M1.875 16.1252L6.03695 14.5245C6.30316 14.4221 6.43626 14.3709 6.56079 14.3041C6.6714 14.2447 6.77685 14.1761 6.87603 14.0992C6.98769 14.0125 7.08853 13.9117 7.29021 13.71L15.75 5.25023C16.5784 4.4218 16.5784 3.07865 15.75 2.25023C14.9216 1.4218 13.5784 1.4218 12.75 2.25022L4.29021 10.71C4.08853 10.9117 3.98769 11.0125 3.90104 11.1242C3.82408 11.2234 3.75555 11.3288 3.69618 11.4394C3.62933 11.564 3.57814 11.6971 3.47575 11.9633L1.875 16.1252ZM1.875 16.1252L3.41859 12.1119C3.52905 11.8248 3.58428 11.6812 3.67901 11.6154C3.76179 11.5579 3.86423 11.5362 3.96322 11.5551C4.0765 11.5767 4.18529 11.6855 4.40286 11.9031L6.09718 13.5974C6.31475 13.815 6.42354 13.9237 6.44517 14.037C6.46408 14.136 6.44234 14.2385 6.38486 14.3212C6.31908 14.416 6.17549 14.4712 5.8883 14.5817L1.875 16.1252Z"/></svg>' +
                  (window.I18n?.t('common.edit') || 'Chỉnh sửa') +
                '</button>' +
                '<button class="myprompt-menu-item" data-action="copy" data-id="' + MyPromptsTab._escapeAttr(p.id) + '">' +
                  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>' +
                  (window.I18n?.t('common.copy') || 'Copy') +
                '</button>' +
                '<button class="myprompt-menu-item myprompt-menu-item--danger" data-action="delete" data-id="' + MyPromptsTab._escapeAttr(p.id) + '">' +
                  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
                  (window.I18n?.t('common.delete') || 'Xóa') +
                '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Append load-more button HTML nếu còn pages chưa load
    if (hasMore) {
      var loadMoreLabel = window.I18n?.t('common.loadMore') || 'Tải thêm';
      cardsHtml += '<div class="seosonaflow-load-more-row">' +
        '<button class="seosonaflow-load-more-btn" id="myPromptsLoadMoreBtn">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
          loadMoreLabel +
          '<span class="seosonaflow-load-more-count">' + (paginationInfo.loaded || 0) + ' / ' + (paginationInfo.total || 0) + '</span>' +
        '</button>' +
      '</div>';
    }

    container.innerHTML = cardsHtml;

    // Bind load-more click - fetch next page from server
    container.querySelector('#myPromptsLoadMoreBtn')?.addEventListener('click', async () => {
      if (window.userPromptsManager?._loading) return;
      await window.userPromptsManager.loadPrompts(true); // append = true
      MyPromptsTab._prompts = window.userPromptsManager.getPrompts() || [];
      MyPromptsTab._filterAndRender();
    });

    // Bind "Dùng" button
    container.querySelectorAll('[data-action="use"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._usePrompt(btn.dataset.id);
      });
    });

    // Bind 3-dot menu
    container.querySelectorAll('.myprompt-menu-wrapper').forEach(wrapper => {
      const menuBtn = wrapper.querySelector('.myprompt-menu-btn');
      const dropdown = wrapper.querySelector('.myprompt-menu-dropdown');
      menuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasHidden = dropdown?.classList.contains('hidden');
        this._closeAllDropdowns(container);
        if (dropdown && wasHidden) {
          dropdown.classList.remove('hidden');
          // Position dropdown to avoid overflow
          this._positionDropdown(wrapper, dropdown);
        }
      });
    });

    // Bind dropdown items
    container.querySelectorAll('.myprompt-menu-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(container);
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'edit') this._editPrompt(id);
        else if (action === 'copy') this._copyPrompt(id);
        else if (action === 'delete') this._deletePrompt(id);
      });
    });

    // Close dropdowns on outside click
    // Audit fix (memory leak): _renderList can run repeatedly before any outside
    // click fires, stacking { once:true } document listeners. Keep a single stable
    // handler and remove it before re-adding so only one exists at a time.
    if (this._outsideClickHandler) {
      document.removeEventListener('click', this._outsideClickHandler);
    }
    this._outsideClickHandler = () => this._closeAllDropdowns(container);
    document.addEventListener('click', this._outsideClickHandler, { once: true });
  }

  static _closeAllDropdowns(container) {
    container?.querySelectorAll('.myprompt-menu-dropdown').forEach(d => d.classList.add('hidden'));
  }

  static _positionDropdown(wrapper, dropdown) {
    const rect = wrapper.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;

    dropdown.style.position = 'absolute';
    dropdown.style.right = '0';

    if (spaceBelow < 120) {
      dropdown.style.bottom = '100%';
      dropdown.style.top = 'auto';
      dropdown.style.marginBottom = '4px';
      dropdown.style.marginTop = '0';
    } else {
      dropdown.style.top = '100%';
      dropdown.style.bottom = 'auto';
      dropdown.style.marginTop = '4px';
      dropdown.style.marginBottom = '0';
    }
  }

  static _usePrompt(id) {
    const prompt = this._prompts.find(function(p) { return String(p.id) === String(id); });
    if (!prompt) return;

    var content = prompt.content || '';
    var variables = content.match(/\{\{(\w+)\}\}/g);
    if (variables && variables.length > 0) {
      this._showVariableDialog(prompt);
      return;
    }

    this._fillPromptAndSwitch(content);
  }

  static _fillPromptAndSwitch(content) {
    const textarea = document.getElementById('promptsArea');
    if (textarea) {
      textarea.value = content;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const genTab = document.querySelector('[data-tab="tab-gen"]');
    if (genTab) genTab.click();
  }

  static _showVariableDialog(prompt) {
    var varMatches = (prompt.content || '').match(/\{\{(\w+)\}\}/g) || [];
    var seen = {};
    var uniqueVars = [];
    varMatches.forEach(function(v) {
      var name = v.replace(/[{}]/g, '');
      if (!seen[name]) { seen[name] = true; uniqueVars.push(name); }
    });

    var dialogOverlay = document.createElement('div');
    dialogOverlay.className = 'cdialog-overlay';
    dialogOverlay.innerHTML =
      '<div class="cdialog-box" style="max-width:400px;">' +
        '<div class="cdialog-header">' +
          '<div class="cdialog-icon cdialog-info">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
              '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>' +
            '</svg>' +
          '</div>' +
          '<div class="cdialog-title">' + (window.I18n?.t('templates.fillVariables') || 'Điền biến') + '</div>' +
        '</div>' +
        '<div class="cdialog-body" style="text-align:left;">' +
          '<p style="margin-bottom:12px;font-size:12px;color:var(--muted-foreground);">' + this._escapeHtml(prompt.title) + '</p>' +
          uniqueVars.map(function(v) {
            return '<div style="margin-bottom:8px;">' +
              '<label style="display:block;font-size:11px;font-weight:600;margin-bottom:2px;color:var(--foreground);">{{' + v + '}}</label>' +
              '<input type="text" data-var="' + v + '" style="width:100%;padding:6px 8px;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--foreground);" placeholder="' + (window.I18n?.t('templates.enterValuePlaceholder') || 'Nhập giá trị...') + '" />' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="cdialog-footer">' +
          '<button class="cdialog-btn cdialog-btn-secondary" data-action="cancel">' + (window.I18n?.t('common.cancel') || 'Hủy') + '</button>' +
          '<button class="cdialog-btn cdialog-btn-primary" data-action="confirm">' + (window.I18n?.t('templates.useTemplate') || 'Sử dụng') + '</button>' +
        '</div>' +
      '</div>';

    var self = this;
    dialogOverlay.querySelector('[data-action="cancel"]').addEventListener('click', function() { dialogOverlay.remove(); });
    dialogOverlay.querySelector('[data-action="confirm"]').addEventListener('click', function() {
      var filledContent = prompt.content;
      dialogOverlay.querySelectorAll('[data-var]').forEach(function(input) {
        var varName = input.dataset.var;
        var value = input.value || varName;
        filledContent = filledContent.replace(new RegExp('\\{\\{' + varName + '\\}\\}', 'g'), value);
      });
      dialogOverlay.remove();
      self._fillPromptAndSwitch(filledContent);
    });

    document.body.appendChild(dialogOverlay);
    dialogOverlay.querySelector('input')?.focus();
  }

  static async _editPrompt(id) {
    const prompt = this._prompts.find(function(p) { return String(p.id) === String(id); });
    if (!prompt) return;
    this._showSaveDialog(prompt);
  }

  static async _copyPrompt(id) {
    const prompt = this._prompts.find(function(p) { return String(p.id) === String(id); });
    if (!prompt) return;
    const text = prompt.content || '';
    if (!text) {
      window.showNotification?.(window.I18n?.t('common.copyEmpty') || 'Prompt trống', 'warning');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback execCommand
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      window.showNotification?.(window.I18n?.t('common.copied') || 'Đã copy prompt', 'success');
    } catch (err) {
      console.error('[MyPromptsTab] Copy failed:', err);
      window.showNotification?.(window.I18n?.t('common.copyFailed') || 'Không copy được', 'error');
    }
  }

  static async _deletePrompt(id) {
    if (!window.customDialog) return;

    const confirmed = await window.customDialog.confirm(
      window.I18n?.t('templates.deletePromptConfirm') || 'Bạn có chắc muốn xóa prompt này?',
      {
        title: window.I18n?.t('templates.deletePromptTitle') || 'Xóa prompt',
        confirmText: window.I18n?.t('common.delete') || 'Xóa',
        cancelText: window.I18n?.t('common.cancel') || 'Hủy'
      }
    );
    if (!confirmed) return;

    try {
      if (window.userPromptsManager) {
        await window.userPromptsManager.deletePrompt(id);
      }
      await this._loadPrompts();
      window.showNotification?.(window.I18n?.t('templates.promptDeleted') || 'Prompt đã xóa', 'success');
    } catch (err) {
      console.error('[MyPromptsTab] Lỗi xóa prompt:', err.message);
    }
  }

  static async _showSaveDialog(existing) {
    var isEdit = !!existing?.id;

    // Double-check quota cho new prompt (không phải edit)
    if (!isEdit && window.featureGate) {
      const canCreate = await window.featureGate.canCreateSnippetAsync();
      if (!canCreate) {
        const isLoggedIn = true;
        if (!isLoggedIn) {
          window.featureGate.showLoginPrompt(
            window.I18n?.t('templates.requireLoginToSave') || 'Lưu prompt yêu cầu đăng nhập'
          );
        } else {
          const snippetsMax = window.featureGate.entitlements?.snippets_max ?? 3;
          await window.customDialog?.confirm(
            window.I18n?.t('snippets.quotaReachedDetail', { max: snippetsMax }) ||
              `Bạn đã đạt giới hạn ${snippetsMax} prompt cho gói hiện tại. Nâng cấp để lưu không giới hạn.`,
            {
              title: window.I18n?.t('featuregate.featureLockedTitle') || 'Tính năng bị khóa',
              type: 'warning',
              confirmText: window.I18n?.t('common.upgrade') || 'Nâng cấp',
              cancelText: window.I18n?.t('common.close') || 'Đóng',
              onConfirm: () => {
                window.eventBus?.emit('open:upgrade_modal');
              }
            }
          );
        }
        return;
      }
    }

    var dialogOverlay = document.createElement('div');
    dialogOverlay.className = 'cdialog-overlay';
    dialogOverlay.innerHTML =
      '<div class="cdialog-box" style="max-width:440px;">' +
        '<div class="cdialog-header">' +
          '<div class="cdialog-icon cdialog-info">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
              '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>' +
              '<path d="M14 2v4a2 2 0 0 0 2 2h4"/>' +
            '</svg>' +
          '</div>' +
          '<div class="cdialog-title">' + (isEdit ? (window.I18n?.t('templates.editPromptTitle') || 'Sửa prompt') : (window.I18n?.t('templates.addPromptTitle') || 'Thêm prompt mới')) + '</div>' +
        '</div>' +
        '<div class="cdialog-body" style="text-align:left;">' +
          '<div style="margin-bottom:8px;">' +
            '<label style="display:block;font-size:11px;font-weight:600;margin-bottom:2px;color:var(--foreground);">' + (window.I18n?.t('templates.promptTitle') || 'Tiêu đề') + '</label>' +
            '<input type="text" id="myPromptTitle" value="' + this._escapeAttr(existing?.title || '') + '" style="width:100%;padding:6px 8px;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--foreground);" placeholder="' + (window.I18n?.t('templates.promptNamePlaceholder') || 'Tên prompt...') + '" />' +
          '</div>' +
          '<div style="margin-bottom:8px;">' +
            '<label style="display:block;font-size:11px;font-weight:600;margin-bottom:2px;color:var(--foreground);">' + (window.I18n?.t('templates.categoryLabel') || 'Danh mục') + '</label>' +
            '<input type="text" id="myPromptCategory" value="' + this._escapeAttr(existing?.category || '') + '" style="width:100%;padding:6px 8px;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--foreground);" placeholder="' + (window.I18n?.t('templates.categoryPlaceholder') || 'VD: Chân dung, Phong cảnh...') + '" />' +
          '</div>' +
          '<div style="margin-bottom:4px;">' +
            '<label style="display:block;font-size:11px;font-weight:600;margin-bottom:2px;color:var(--foreground);">' + (window.I18n?.t('templates.contentLabel') || 'Nội dung') + '</label>' +
            '<textarea id="myPromptContent" rows="5" style="width:100%;padding:6px 8px;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--foreground);resize:vertical;" placeholder="' + (window.I18n?.t('templates.contentPlaceholder') || 'Nhập prompt...') + '">' + this._escapeHtml(existing?.content || '') + '</textarea>' +
          '</div>' +
        '</div>' +
        '<div class="cdialog-footer">' +
          '<button class="cdialog-btn cdialog-btn-secondary" data-action="cancel">' + (window.I18n?.t('common.cancel') || 'Hủy') + '</button>' +
          '<button class="cdialog-btn cdialog-btn-primary" data-action="save">' + (window.I18n?.t('common.save') || 'Lưu') + '</button>' +
        '</div>' +
      '</div>';

    var self = this;
    dialogOverlay.querySelector('[data-action="cancel"]').addEventListener('click', function() { dialogOverlay.remove(); });
    dialogOverlay.querySelector('[data-action="save"]').addEventListener('click', async function() {
      var title = dialogOverlay.querySelector('#myPromptTitle').value.trim();
      var category = dialogOverlay.querySelector('#myPromptCategory').value.trim();
      var content = dialogOverlay.querySelector('#myPromptContent').value.trim();

      if (!title || !content) {
        window.customDialog?.alert(window.I18n?.t('templates.titleContentRequired') || 'Vui lòng nhập tiêu đề và nội dung.', { type: 'warning' });
        return;
      }

      var varMatches = content.match(/\{\{(\w+)\}\}/g) || [];
      var seen = {};
      var uniqueVars = [];
      varMatches.forEach(function(v) {
        var name = v.replace(/[{}]/g, '');
        if (!seen[name]) { seen[name] = true; uniqueVars.push(name); }
      });

      var data = { title: title, content: content, category: category || null, variables: uniqueVars };

      try {
        if (window.userPromptsManager) {
          if (isEdit && existing.id) {
            await window.userPromptsManager.updatePrompt(existing.id, data);
          } else {
            await window.userPromptsManager.savePrompt(data);
          }
        }
        dialogOverlay.remove();
        await self._loadPrompts();
        window.showNotification?.(isEdit ? (window.I18n?.t('templates.promptUpdated') || 'Prompt đã cập nhật') : (window.I18n?.t('templates.promptSaved') || 'Prompt đã lưu'), 'success');
      } catch (err) {
        console.error('[MyPromptsTab] Lỗi lưu prompt:', err.message, err.code);
        // Hiển thị upgrade modal cho quota errors
        if (err.code === 'QUOTA_EXCEEDED' || err.status === 403) {
          const snippetsMax = window.featureGate?.entitlements?.snippets_max ?? 3;
          await window.customDialog?.confirm(
            window.I18n?.t('snippets.quotaReachedDetail', { max: snippetsMax }) ||
              `Bạn đã đạt giới hạn ${snippetsMax} snippets theo gói hiện tại. Nâng cấp để lưu thêm.`,
            {
              title: window.I18n?.t('snippets.quotaReached') || 'Đã đạt giới hạn',
              confirmText: window.I18n?.t('common.upgrade') || 'Nâng cấp',
              cancelText: window.I18n?.t('common.close') || 'Đóng',
              type: 'warning',
              onConfirm: () => window.eventBus?.emit('open:upgrade_modal')
            }
          );
        } else {
          window.customDialog?.alert((window.I18n?.t('promptsNotify.saveFailedPrefix') || 'Không thể lưu prompt:') + ' ' + err.message, { type: 'error' });
        }
      }
    });

    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(function(evt) {
      dialogOverlay.addEventListener(evt, function(e) { e.stopPropagation(); });
    });

    document.body.appendChild(dialogOverlay);
    dialogOverlay.querySelector('#myPromptTitle')?.focus();
  }

  static _escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  static _escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

window.MyPromptsTab = MyPromptsTab;
