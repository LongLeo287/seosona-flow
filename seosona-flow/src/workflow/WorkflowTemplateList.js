/**
 * WorkflowTemplateList - Browse and import workflow templates from server
 */
class WorkflowTemplateList {
  constructor(container) {
    this.container = container;
    this.templates = [];
    this.categories = [];
    this.selectedCategory = null;
    this.searchQuery = '';
    this.currentPage = 1;
    this.lastPage = 1;
    this.loading = false;
    this._searchTimeout = null;
    this._i18nHandler = null;
    this._isCopyingTemplate = false; // Lock để tránh duplicate click

    this.render();
    this._bindEvents();
    this._loadCategories();
    this._loadTemplates();

    // Listen for import-from-preview-window message (Option A flow)
    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.action === 'workflowTemplateImportRequested' && message.template) {
          this._handleImport(message.template).catch((err) => {
            console.warn('[WorkflowTemplateList] Import from preview failed:', err);
          });
        }
        // Listen for template editor window closed -> refresh list
        if (message?.action === 'templateEditorClosed') {
          console.log('[WorkflowTemplateList] Template editor closed, refreshing list...');
          this._loadTemplates(false);
        }
      });
    }
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} str
   * @returns {string}
   */
  _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Quote-safe media URL for src="..." / background-image:url('...').
   * Validates scheme (http/https/data:image) and drops anything else,
   * then HTML-escapes. Server template data is untrusted.
   */
  _safeMediaUrl(url) {
    const s = String(url || '');
    if (!/^(https?:\/\/|data:image\/|chrome-extension:\/\/|\.\.\/|\.\/|\/)/i.test(s)) return '';
    return this._escapeHtml(s);
  }


  /**
   * Render main UI structure
   */
  render() {
    const t = (key, params) => window.I18n?.t(key, params) || key;

    // EWT-10: Chỉ admin mới có quyền tạo/quản lý template
    // 2026-05-25: Đồng nhất với check ở _createNewTemplate (line 2290) + _editTemplate +
    // _saveTemplateChanges → dùng canonical canManageWorkflowTemplates() (isLoggedIn AND isAdmin).
    // Trước: isAdmin() raw không guard isLoggedIn → có thể show button khi user.is_admin=true
    // nhưng chưa login. Sau: cùng source of truth với click handler.
    const canManageTemplates = window.featureGate?.canManageWorkflowTemplates?.()
      || (window.authManager?.canManageTemplates?.() ?? false);

    // Track quyền đã render — featuregate:refreshed handler dùng để chỉ re-render khi đổi
    this._renderedCanManage = canManageTemplates;

    this.container.innerHTML = `
      <div class="wf-template-list">
        <div class="sf-toolbar">
          <div class="sf-search-box">
            <svg class="sf-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.3-4.3"/>
            </svg>
            <input type="text" class="sf-search-input" placeholder="${t('workflow.searchTemplate')}" />
          </div>
          <button class="btn btn-secondary btn-sm btn-toolbar-icon sf-reload-btn" data-i18n-title="workflow.reload" title="Tải lại">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          </button>
          <select class="sf-filter-select compact-select">
            <option value="">${t('workflow.allCategories')}</option>
          </select>
          <div class="sf-spacer"></div>
          <div class="wf-template-count-badge"></div>
        </div>

        <div class="wf-template-empty hidden">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          <p>${t('workflow.noTemplates')}</p>
        </div>

        <div class="wf-template-grid">
          ${this._renderSkeletons()}
        </div>

        <button class="wf-load-more hidden">
          ${t('workflow.loadMore')}
        </button>
      </div>
    `;
  }

  /**
   * Render loading skeletons
   */
  /**
   * [API SPAM FIX — Phase 2.2] Banner cảnh báo rate-limited + auto-retry sau cooldown.
   * Tránh xóa danh sách templates khiến user thấy empty UI khi backend rate limit.
   */
  _showRateLimitBanner(retryAfter) {
    let banner = this.container.querySelector('.wf-rate-limit-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'wf-rate-limit-banner';
      this.container.prepend(banner);
    }
    banner.style.display = 'flex';

    const clockIcon = `<svg class="wf-rate-limit-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const tBase = window.I18n?.t?.('workflow.rateLimitedBanner') || 'Gói của bạn đang bị giới hạn. Tự động thử lại sau {seconds}s...';
    let remaining = retryAfter;
    const update = () => {
      const text = tBase.replace('{seconds}', `<span class="wf-rate-limit-countdown">${remaining}</span>`);
      banner.innerHTML = `${clockIcon}<span class="wf-rate-limit-text">${text}</span>`;
    };
    update();

    if (this._rateLimitTimer) clearInterval(this._rateLimitTimer);
    if (this._rateLimitRetryTimer) clearTimeout(this._rateLimitRetryTimer);

    this._rateLimitTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(this._rateLimitTimer);
        this._rateLimitTimer = null;
        banner.style.display = 'none';
      } else { update(); }
    }, 1000);

    this._rateLimitRetryTimer = setTimeout(() => {
      this._rateLimitRetryTimer = null;
      this._loadTemplates(false);
    }, retryAfter * 1000);
  }

  _renderSkeletons() {
    return `
      <div class="wf-template-card skeleton">
        <div class="wf-template-thumb skeleton-thumb"></div>
        <div class="wf-template-info">
          <div class="skeleton-text"></div>
          <div class="skeleton-text short"></div>
        </div>
      </div>
      <div class="wf-template-card skeleton">
        <div class="wf-template-thumb skeleton-thumb"></div>
        <div class="wf-template-info">
          <div class="skeleton-text"></div>
          <div class="skeleton-text short"></div>
        </div>
      </div>
      <div class="wf-template-card skeleton">
        <div class="wf-template-thumb skeleton-thumb"></div>
        <div class="wf-template-info">
          <div class="skeleton-text"></div>
          <div class="skeleton-text short"></div>
        </div>
      </div>
      <div class="wf-template-card skeleton">
        <div class="wf-template-thumb skeleton-thumb"></div>
        <div class="wf-template-info">
          <div class="skeleton-text"></div>
          <div class="skeleton-text short"></div>
        </div>
      </div>
    `;
  }

  /**
   * Bind DOM events
   */
  _bindEvents() {
    // Search input with debounce
    const searchInput = this.container.querySelector('.sf-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this._handleSearch(e.target.value);
      });
    }

    // Category select dropdown
    const categorySelect = this.container.querySelector('.sf-filter-select');
    if (categorySelect) {
      categorySelect.addEventListener('change', (e) => {
        const categoryId = e.target.value || null;
        this._handleCategoryFilter(categoryId);
      });
    }

    const reloadBtn = this.container.querySelector('.sf-reload-btn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        this.loadTemplates();
      });
    }
  
    // EWT-10: Nút tạo template mới (chỉ admin) - Gắn vào nút gom chung
    const optCreateTemplate = document.getElementById('optCreateTemplate');
    if (optCreateTemplate) {
      if (this._renderedCanManage) {
        optCreateTemplate.classList.remove('hidden');
        optCreateTemplate.addEventListener('click', (e) => {
          e.stopPropagation();
          const createDropdown = document.getElementById('wfCreateDropdown');
          if (createDropdown) createDropdown.classList.add('hidden');
          this._createNewTemplate();
        });
      } else {
        optCreateTemplate.classList.add('hidden');
      }
    }

    // Template cards - use event delegation
    const gridContainer = this.container.querySelector('.wf-template-grid');
    if (gridContainer) {
      gridContainer.addEventListener('click', async (e) => {
        const card = e.target.closest('.wf-template-card');
        if (!card) return;

        const templateId = card.dataset.templateId;
        if (!templateId) return;

        const template = this.templates.find(t => String(t.id) === String(templateId));
        if (!template) return;

        // 2026-06-04: Bỏ card-level isLocked gate — free user vẫn preview được template
        // premium. Click "Use" mới chặn (qua _copyTemplateToWorkflow line ~2172). Chỉ giữ
        // click vào upgrade button cụ thể (nếu còn) → upgrade modal.
        const upgradeBtn = e.target.closest('.wf-template-upgrade-btn');
        if (upgradeBtn) {
          this._showUpgradePrompt(template);
          return;
        }

        // [GỠ] Cơ chế "Chỉnh sửa"/fork template đã bỏ — Templates là kho mẫu read-only.
        // Nút Sửa + Xóa (chỉ dành cho template fork của user) đã gỡ khỏi card render.

        // [GỠ] Nút share template (.wf-template-share-btn) không còn render → handler dead.

        // Đã bỏ nút preview riêng lẻ. Người dùng có thể click vào card để xem chi tiết.

        // Kiểm tra nút "Sử dụng" được click (cho user đã đăng nhập - clone qua API)
        const useBtn = e.target.closest('.wf-template-use-btn');
        if (useBtn) {
          // Clone template qua API (EWT-8)
          this._copyTemplateToWorkflow(template.id);
          return;
        }

        // Click vào card info (không phải thumbnail buttons) -> hiển thị chi tiết
        const cardInfo = e.target.closest('.wf-template-info');
        if (cardInfo) {
          this._showTemplateDetail(template);
          return;
        }

        // Click vào thumbnail (không phải buttons trên thumbnail) -> hiển thị chi tiết
        const thumb = e.target.closest('.wf-template-thumb');
        if (thumb && !e.target.closest('button')) {
          this._showTemplateDetail(template);
          return;
        }
      });
    }

    // Load more button
    const loadMoreBtn = this.container.querySelector('.wf-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        if (!this.loading && this.currentPage < this.lastPage) {
          this._loadTemplates(true);
        }
      });
    }

    // Listen for i18n changes — store handler reference for cleanup
    if (window.eventBus) {
      this._i18nHandler = () => {
        this.render();
        this._bindEvents();
        this._renderCategories();
        this._renderTemplates();
      };
      window.eventBus.on('i18n:changed', this._i18nHandler);

      // EWT-10: Listen for template created/updated events to refresh list
      this._templateCreatedHandler = () => {
        console.log('[WorkflowTemplateList] Template created, refreshing list...');
        this._loadTemplates(false);
      };
      this._templateUpdatedHandler = () => {
        console.log('[WorkflowTemplateList] Template updated, refreshing list...');
        this._loadTemplates(false);
      };
      window.eventBus.on('template:created', this._templateCreatedHandler);
      window.eventBus.on('template:updated', this._templateUpdatedHandler);

      // Reload templates khi user login (có thể có premium templates)
      // 2026-05-25 BUG FIX: PHẢI call `_bindEvents()` sau mỗi `render()` vì innerHTML replace
      // wipe toàn bộ DOM bao gồm `.wf-template-grid` → click listener gắn trên grid cũ bị mất.
      // Trước fix: user login/logout → render() → click vào template card không có tác dụng
      // (không mở detail modal) cho đến khi loadTemplates() finish + re-bind.
      this._authLoginHandler = () => {
        console.log('[WorkflowTemplateList] User logged in, refreshing templates...');
        try { this.render(); this._bindEvents(); } catch (e) { /* ignore */ }
        this._loadTemplates(false);
      };
      window.eventBus.on('auth:login', this._authLoginHandler);

      // Reload templates khi user logout (ẩn premium templates)
      this._authLogoutHandler = () => {
        console.log('[WorkflowTemplateList] User logged out, refreshing templates...');
        try { this.render(); this._bindEvents(); } catch (e) { /* ignore */ }
        this._loadTemplates(false);
      };
      window.eventBus.on('auth:logout', this._authLogoutHandler);

      // 2026-05-25: Re-render khi entitlements/user info update (vd: user promote → admin via SSE).
      // Đảm bảo button "Tạo Template" visibility đồng bộ với canManageWorkflowTemplates().
      //
      // 2026-05-26 BUG FIX (SSE → template kẹt loading): featuregate:refreshed fire trên MỌI
      // entitlements_changed SSE + config version bump. render() reset grid về skeleton nhưng
      // handler cũ KHÔNG gọi _loadTemplates() → skeleton kẹt mãi phải refresh. Đồng thời reload
      // thừa mỗi SSE. Fix: chỉ re-render khi quyền quản lý đổi, và khi re-render PHẢI reload lại
      // (giống _authLoginHandler/_authLogoutHandler). Quyền không đổi → no-op (giữ nguyên grid).
      this._featuregateRefreshHandler = () => {
        const canManage = window.featureGate?.canManageWorkflowTemplates?.()
          || (window.authManager?.canManageTemplates?.() ?? false);
        if (canManage === this._renderedCanManage) return; // quyền không đổi → bỏ qua, tránh reload/flash thừa
        try { this.render(); this._bindEvents(); } catch (e) { /* ignore */ }
        this._loadTemplates(false);
      };
      window.eventBus.on('featuregate:refreshed', this._featuregateRefreshHandler);
    }
  }

  /**
   * API call helper - works for both anonymous and logged-in users
   */
  /**
   * Nạp 1,4 MB workflow mẫu — CHỈ khi thật sự cần.
   *
   * Trước đây hai file này nằm trong sidebar.html nên mở sidebar là tải và phân tích cả 30
   * mẫu, dù người dùng chỉ mở một cái hoặc không mở cái nào. Nay chèn thẻ script lúc cần.
   *
   * Nhớ lời hứa (promise) chứ không nhớ cờ boolean: hai chỗ gọi cùng lúc thì cùng chờ MỘT
   * lượt tải, không tải hai lần. Tải hỏng thì xoá lời hứa để lần sau thử lại được.
   */
  static async ensureBundledTemplates() {
    if (Array.isArray(window.BUNDLED_TEMPLATES) && window.BUNDLED_TEMPLATES.length) return;
    if (WorkflowTemplateList._loadingBundled) return WorkflowTemplateList._loadingBundled;
    const one = (src) => new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = chrome.runtime.getURL(src);
      el.onload = res;
      el.onerror = () => rej(new Error('không nạp được ' + src));
      document.head.appendChild(el);
    });
    WorkflowTemplateList._loadingBundled = (async () => {
      try {
        // THỨ TỰ quan trọng: file Extra append vào mảng do file đầu tạo ra.
        await one('src/workflow/BundledTemplates.js');
        await one('src/workflow/BundledWorkflowsExtra.js');
      } catch (e) {
        WorkflowTemplateList._loadingBundled = null;   // cho phép thử lại
        console.warn('[WorkflowTemplateList] nạp workflow mẫu thất bại:', e && e.message);
        if (!Array.isArray(window.BUNDLED_TEMPLATES)) window.BUNDLED_TEMPLATES = [];
      }
    })();
    return WorkflowTemplateList._loadingBundled;
  }

  async _apiCall(endpoint, method = 'GET', data = null) {
    await WorkflowTemplateList.ensureBundledTemplates();
    // === 14 TEMPLATES BYPASS ===
    if (method === 'GET' && endpoint.includes('workflow-templates') && !endpoint.includes('/rate')) {
      // If fetching categories
      if (endpoint === 'workflow-templates/categories') {
        const seosonaflowCategories = [
          { id: 1, name: 'Ảnh & Visual', slug: 'image-visual' },
          { id: 2, name: 'Video & Motion', slug: 'video-motion' },
          { id: 3, name: 'Sản phẩm & TMĐT', slug: 'product-ecommerce' },
          { id: 4, name: 'Thời trang & Nhân vật', slug: 'fashion-character' },
          { id: 5, name: 'Marketing & Social', slug: 'marketing-social' },
          { id: 6, name: 'Prompt & Tiện ích', slug: 'prompt-utility' }
        ];
        return { data: seosonaflowCategories };
      }

      // If fetching a specific template by ID
      const match = endpoint.match(/^workflow-templates\/([^/?]+)/);
      if (match) {
        const id = match[1];
        // Template của USER (kho riêng af_user_templates) — id prefix utpl_
        if (window.UserTemplateStore?.isUserTemplateId?.(id)) {
          const ut = await window.UserTemplateStore.get(id);
          if (ut) return { data: ut };
          throw new Error('Template not found locally');
        }
        const template = window.BUNDLED_TEMPLATES.find(t => String(t.id) === String(id));
        if (template) return { data: template };
        throw new Error('Template not found locally');
      }

      // If fetching the list
      let filtered = window.BUNDLED_TEMPLATES;
      const params = new URLSearchParams(endpoint.split('?')[1] || '');
      const search = params.get('search');
      if (search) {
        filtered = filtered.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || (t.description && t.description.toLowerCase().includes(search.toLowerCase())));
      }

      const categoryId = params.get('category_id');
      if (categoryId) {
        filtered = filtered.filter(t => String(t.category_id) === String(categoryId));
      }

      // Templates = kho mẫu READ-ONLY. Đã GỠ cơ chế fork-on-edit + hiển thị template cá nhân
      // (af_user_templates) trong gallery: template chỉ để "Sử dụng" (clone → workflow ở Flows),
      // không sửa. Không còn nạp UserTemplateStore vào đây.
      return { data: filtered, meta: { current_page: 1, last_page: 1 } };
    }
    // ===========================

    // Use authManager if logged in
    if (window.authManager?.isLoggedIn()) {
      return window.authManager._apiCall(method, endpoint, data);
    }

    // Anonymous: call via background.js với 20s timeout (tránh promise hang forever
    // khi MV3 service worker sleep hoặc network stuck → loading flag stuck → user phải reload).
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Request timeout (20s) - background unresponsive'));
      }, 20000);

      try {
        chrome.runtime.sendMessage({
          action: 'apiRequest',
          method,
          endpoint,
          data
        }, (resp) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);

          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (resp?.success) {
            // Handle pagination
            if (resp.meta) {
              resolve({ data: resp.data, meta: resp.meta });
            } else {
              resolve(resp.data);
            }
          } else {
            reject(new Error(resp?.error?.message || 'API Error'));
          }
        });
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(err);
      }
    });
  }

  /**
   * Load categories from API
   */
  async _loadCategories() {
    try {
      const result = await this._apiCall('workflow-templates/categories');
      this.categories = Array.isArray(result) ? result : (result?.data || []);
      this._renderCategories();
    } catch (err) {
      console.error('[WorkflowTemplateList] Failed to load categories:', err);
    }
  }

  /**
   * Render category select options
   */
  _renderCategories() {
    const t = (key) => window.I18n?.t(key) || key;
    const selectEl = this.container.querySelector('.sf-filter-select');
    if (!selectEl) return;

    let html = `<option value="">${t('workflow.allCategories')}</option>`;

    for (const cat of this.categories) {
      const isSelected = String(this.selectedCategory) === String(cat.id);
      html += `<option value="${cat.id}" ${isSelected ? 'selected' : ''}>${cat.name || cat.title}</option>`;
    }

    selectEl.innerHTML = html;
  }

  /**
   * Public method to reload templates (for external refresh calls)
   */
  loadTemplates() {
    return this._loadTemplates(false);
  }

  /**
   * Load templates from API
   * @param {boolean} append - true for load more / infinite scroll
   */
  async _loadTemplates(append = false) {
    // 2026-05-25 BUG FIX: stuck loading flag. Nếu lần fetch trước hang (MV3 service worker
    // sleep, network timeout, ...) và finally chưa fire, this.loading=true mãi → mọi
    // _loadTemplates() sau early-return → skeleton stuck. Force reset sau 30s timeout.
    if (this.loading) {
      const since = this._loadingStartedAt || 0;
      if (Date.now() - since < 30000) return; // legitimate concurrent call
      console.warn('[WorkflowTemplateList] Loading flag stuck > 30s, force reset');
      this.loading = false;
    }
    this.loading = true;
    this._loadingStartedAt = Date.now();
    const grid = this.container.querySelector('.wf-template-grid');
    const loadMoreBtn = this.container.querySelector('.wf-load-more');
    const emptyState = this.container.querySelector('.wf-template-empty');

    // Show skeletons if not appending
    if (!append && grid) {
      grid.innerHTML = this._renderSkeletons();
    }

    // Hide empty state
    if (emptyState) {
      emptyState.classList.add('hidden');
    }

    try {
      const page = append ? this.currentPage + 1 : 1;
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('per_page', '20');

      if (this.selectedCategory) {
        params.set('category_id', this.selectedCategory);
      }

      if (this.searchQuery) {
        params.set('search', this.searchQuery);
      }

      const endpoint = `workflow-templates?${params.toString()}`;
      const result = await this._apiCall(endpoint);

      // Handle both paginated and non-paginated responses
      let newTemplates = [];
      if (Array.isArray(result)) {
        newTemplates = result;
        this.lastPage = 1;
        this.currentPage = 1;
      } else if (result?.data) {
        newTemplates = result.data;
        this.lastPage = result.meta?.last_page || 1;
        this.currentPage = result.meta?.current_page || page;
      }

      if (append) {
        this.templates = [...this.templates, ...newTemplates];
      } else {
        this.templates = newTemplates;
      }

      this._renderTemplates();

      // Show/hide load more button
      if (loadMoreBtn) {
        if (this.currentPage < this.lastPage && this.templates.length > 0) {
          loadMoreBtn.classList.remove('hidden');
        } else {
          loadMoreBtn.classList.add('hidden');
        }
      }

      // Show empty state if no templates
      if (this.templates.length === 0 && emptyState) {
        emptyState.classList.remove('hidden');
      }

    } catch (err) {
      // [API SPAM FIX — Phase 2.2] 429 → giữ data cũ + show banner + auto-retry.
      // Tránh xóa danh sách khiến user thấy empty UI.
      if (err?.code === 'RATE_LIMITED' || err?.httpStatus === 429) {
        const retryAfter = Number(err.retryAfter) || 60;
        console.warn('[WorkflowTemplateList] Rate limited, giữ data cũ, retry sau', retryAfter, 's');
        this._showRateLimitBanner(retryAfter);
        // Re-render data cũ (nếu skeleton đang show, replace lại)
        if (this.templates.length > 0) {
          this._renderTemplates();
        }
      } else {
        console.error('[WorkflowTemplateList] Failed to load templates:', err);
        if (grid && !append) {
          grid.innerHTML = '';
        }
        if (emptyState) {
          emptyState.classList.remove('hidden');
        }
      }
    } finally {
      this.loading = false;
      this._loadingStartedAt = 0;
    }
  }

  /**
   * Render template cards
   */
  _renderTemplates() {
    const grid = this.container.querySelector('.wf-template-grid');
    if (!grid) return;

    const countBadge = this.container.querySelector('.wf-template-count-badge');
    if (countBadge) {
      const count = this.templates.length;
      countBadge.innerHTML = `<strong style="color:var(--text-primary)">${count}</strong> <span style="opacity:0.7">templates</span>`;
    }

    if (this.templates.length === 0) {
      grid.innerHTML = '';
      return;
    }

    let html = '';
    for (const template of this.templates) {
      html += this._renderTemplateCard(template);
    }

    grid.innerHTML = html;
  }

  _getTemplateMediaType(template) {
    if (template?.media_type === 'Video' || template?.media_type === 'Image') return template.media_type;
    const hasVideoNode = (template?.nodes || []).some(node => node?.data?.media_type === 'Video');
    return hasVideoNode ? 'Video' : 'Image';
  }

  _getTemplateCoverTone(template) {
    const id = Number(template?.category_id) || 0;
    if (id === 2) return 'video';
    if (id === 3) return 'product';
    if (id === 4) return 'fashion';
    if (id === 5) return 'marketing';
    if (id === 6) return 'utility';
    return this._getTemplateMediaType(template) === 'Video' ? 'video' : 'image';
  }

  _renderGeneratedCover(template, variant = 'card') {
    const mediaType = this._getTemplateMediaType(template);
    const mediaLabel = mediaType === 'Video' ? 'VIDEO' : 'ẢNH';
    const name = template?.name || 'Workflow';
    const categoryName = template?.category?.name || template?.category_name || (mediaType === 'Video' ? 'Video workflow' : 'Image workflow');
    const tone = this._getTemplateCoverTone(template);
    const icon = mediaType === 'Video'
      ? '<path d="M7 5.8c0-.8.9-1.2 1.5-.8l7.2 4.2c.6.4.6 1.3 0 1.7l-7.2 4.2c-.6.4-1.5 0-1.5-.8V5.8Z"/>'
      : '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-11Zm3 8 2.6-2.8 2.2 2.1 2.8-3.5L18 15H7Z"/>';

    return `
      <div class="wf-template-generated-cover wf-template-generated-cover--${variant} wf-template-generated-cover--${tone}">
        <div class="wf-generated-cover-glow"></div>
        <div class="wf-generated-cover-top">
          <span class="wf-generated-cover-badge">${mediaLabel}</span>
          <span class="wf-generated-cover-dot"></span>
        </div>
        <div class="wf-generated-cover-icon" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor">${icon}</svg>
        </div>
        <div class="wf-generated-cover-title">${this._escapeHtml(name)}</div>
        <div class="wf-generated-cover-subtitle">${this._escapeHtml(categoryName)}</div>
      </div>
    `;
  }

  _renderTemplateThumbnail(template, imageClass, fallbackVariant = 'card') {
    const thumbnail = template?.thumbnail_url || template?.thumbnail || template?.preview_image || '';
    return thumbnail
      ? `<img src="${this._safeMediaUrl(thumbnail)}" class="${imageClass}" alt="${this._escapeHtml(template?.name || '')}" loading="lazy" />`
      : this._renderGeneratedCover(template, fallbackVariant);
  }

  _getDisplayTemplateTags(template) {
    const blockedTags = new Set([
      'workflow',
      'tai xuong',
      'tải xuống',
      'download',
      'co download',
      'có download',
      'co prompt ai',
      'có prompt ai',
      'co anh tham chieu',
      'có ảnh tham chiếu',
      'tao video',
      'tạo video',
      'tao anh',
      'tạo ảnh'
    ]);
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    const tags = [];

    (template?.tags || []).forEach(tag => {
      const label = String(tag || '').trim();
      const key = normalize(label);
      if (!label || blockedTags.has(key) || /\b(node|buoc tao|bước tạo)\b/i.test(key)) return;
      if (!tags.some(item => normalize(item) === key)) tags.push(label);
    });

    if (!tags.length) {
      tags.push(this._getTemplateMediaType(template) === 'Video' ? 'video' : 'ảnh');
    }

    return tags.slice(0, 6);
  }

  _renderTemplateTags(template) {
    const tags = this._getDisplayTemplateTags(template);
    if (!tags.length) return '';

    return `
      <div class="wf-detail-tags" aria-label="Template tags">
        ${tags.map(label => `<span class="wf-detail-tag">${this._escapeHtml(label)}</span>`).join('')}
      </div>
    `;
  }

  /**
   * Render a single template card
   * @param {Object} template
   */
  _renderTemplateCard(template) {
    const t = (key) => window.I18n?.t(key) || key;

    const thumbInner = this._renderTemplateThumbnail(template, 'wf-template-thumb-image', 'card');

    // Category badge
    const categoryName = template.category?.name || template.category_name || '';

    // Use count
    const useCount = template.use_count || template.uses || 0;

    // EWT-12.1: Kiểm tra template có phải premium không
    const isPremiumTemplate = template.is_premium || false;

    // EWT-12.2: Kiểm tra user có quyền truy cập premium templates không
    const canAccessPremium = window.featureGate?.canAccessPremiumTemplates() || false;

    // EWT-12.3: Template bị khóa nếu là premium và user không có quyền
    const isLocked = isPremiumTemplate && !canAccessPremium;

    // Kiểm tra user đã đăng nhập để hiển thị button phù hợp
    // - Đã đăng nhập: hiển thị nút "Sử dụng" (clone qua API)
    // - Chưa đăng nhập: hiển thị nút "Nhập" (import local)
    const isLoggedIn = window.authManager?.isLoggedIn() || false;

    // [GỠ] Cơ chế fork-on-edit + template cá nhân đã bỏ → Templates read-only.
    // Không còn nút Sửa/Xóa hay badge "Của tôi" trên card.

    // Re-added accidentally removed variables
    const premiumBadge = isPremiumTemplate ? `
      <div class="wf-template-premium-badge" title="${t('workflow.premiumTemplate') || 'Template Premium'}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"/>
        </svg>
        <span>Premium</span>
      </div>
    ` : '';
    const lockOverlay = '';

    // Removed videoButton and shareButton based on user request
    const shareButton = '';
    const videoButton = '';

    // Hover overlay với preview + use buttons (giống prompt template design)
    // 2026-06-04: Hiển thị LUÔN — kể cả template premium. Preview button work cho mọi user;
    // Use button click → _copyTemplateToWorkflow gate premium → upgrade modal nếu chưa premium.
    const hoverOverlay = `
      <div class="wf-template-hover-overlay">
        <button class="wf-template-use-btn">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z"></path><path d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z"></path></svg>
          ${t('workflow.useTemplate') || 'Sử dụng'}
        </button>
      </div>
    `;

    // EWT-12.4: Upgrade overlay cho template bị khóa
    const upgradeOverlay = isLocked ? `
      <div class="wf-template-hover-overlay wf-template-hover-overlay--locked">
        <button class="wf-template-upgrade-btn" title="${t('common.upgrade') || 'Upgrade'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"/>
          </svg>
          ${t('common.upgrade') || 'Upgrade'}
        </button>
      </div>
    ` : '';

    return `
      <div class="wf-template-card${isLocked ? ' wf-template-locked' : ''}${isPremiumTemplate ? ' wf-template-premium' : ''}" data-template-id="${template.id}" data-is-premium="${isPremiumTemplate}" data-is-locked="${isLocked}">
        <div class="wf-template-thumb">
          ${thumbInner}
          ${premiumBadge}
          ${lockOverlay}
          ${hoverOverlay}
          ${upgradeOverlay}
          ${videoButton}
          ${shareButton}
        </div>
        <div class="wf-template-info">
          <div class="wf-template-name" title="${this._escapeHtml(template.name)}">${this._escapeHtml(template.name) || t('workflow.unnamed')}</div>
          <div class="wf-template-meta">
            ${categoryName ? `<span class="wf-template-category">${this._escapeHtml(categoryName)}</span>` : ''}
            <span class="wf-template-nodes-count" title="${t('workflow.nodesInWorkflow') || 'Số node'}">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.17 3.646a.5.5 0 0 1 .707 0l5.477 5.477a.5.5 0 0 1 0 .707l-1.366 1.366a4.373 4.373 0 1 1-6.184-6.184L6.17 3.646Zm.353 1.061L5.508 5.723 5.5 5.73a3.373 3.373 0 1 0 4.77 4.77l.006-.008 1.016-1.015-4.77-4.77Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M5.354 10.646a.5.5 0 0 1 0 .707L3.02 13.688a.5.5 0 1 1-.707-.707l2.334-2.334a.5.5 0 0 1 .707 0ZM10.354 2.313a.5.5 0 0 1 0 .707L8.02 5.354a.5.5 0 0 1-.707-.708l2.334-2.333a.5.5 0 0 1 .707 0ZM13.687 5.646a.5.5 0 0 1 0 .708l-2.333 2.333a.5.5 0 1 1-.707-.707l2.333-2.334a.5.5 0 0 1 .707 0Z" fill="currentColor"/></svg>
              ${(template.nodes || []).length} ${t('workflow.nodes') || 'nodes'}
            </span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Handle template import
   * @param {Object} template
   */
  async _handleImport(template) {
    console.log('[WorkflowTemplateList] Import template:', template?.id, template?.name);

    const t = (key, params) => window.I18n?.t(key, params) || key;

    // Show importing indicator
    const importBtns = this.container.querySelectorAll('.wf-template-import-btn');
    importBtns.forEach(btn => btn.disabled = true);

    try {
      // [DÙNG CHUNG] Mọi tính năng workflow BẮT BUỘC login (FeatureGate.canCreateWorkflowAsync
      // chặn anonymous) → import = backend clone (cloneToWorkflow) giống nút "Use", cho CẢ community
      // lẫn official. Bỏ client _importTemplate/_convertNodesForImport/_saveImportedWorkflow (local
      // mode đã vô hiệu). _copyTemplateToWorkflow self-contained (confirm + gate + clone + notif).
      if (!window.authManager?.isLoggedIn()) {
        window.featureGate?.showLoginPrompt?.(
          t('workflow.requireLoginToImport') || 'Import template yêu cầu đăng nhập'
        );
        return;
      }
      if (!template?.id) {
        window.customDialog?.alert(t('workflow.templateNotFound') || 'Không tìm thấy template', { type: 'error' });
        return;
      }
      // templateObj truyền vào cho community (KHÔNG nằm trong this.templates).
      await this._copyTemplateToWorkflow(template.id, template);
    } catch (err) {
      console.error('[WorkflowTemplateList] Import failed:', err);
      if (window.customDialog) {
        window.customDialog.alert(t('workflow.importFailed') + ': ' + (err?.message || ''), { type: 'error' });
      }
    } finally {
      importBtns.forEach(btn => btn.disabled = false);
    }
  }


  /**
   * Show template detail modal (WT-13.1-13.2)
   * @param {Object} template
   */
  _showTemplateDetail(template) {
    const t = (key, params) => window.I18n?.t(key, params) || key;

    console.log('[WorkflowTemplateList] Showing template detail:', {
      id: template.id,
      name: template.name,
      thumbnail_url: template.thumbnail_url,
      description: template.description
    });

    const thumbnailHtml = this._renderTemplateThumbnail(template, 'wf-detail-thumb-img', 'detail');

    // Category badge
    const categoryName = template.category?.name || template.category_name || '';

    // Use count
    const useCount = template.use_count || template.uses || 0;

    const templateTags = this._renderTemplateTags(template);

    // Kiểm tra user đã đăng nhập để hiển thị button phù hợp trong modal
    const isLoggedIn = window.authManager?.isLoggedIn() || false;

    // Button action chính: "Sử dụng" (clone qua API) nếu đã đăng nhập, "Nhập" (import local) nếu chưa
    const primaryActionBtn = isLoggedIn
      ? `<button class="wf-detail-use-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14"/>
            <path d="M5 12h14"/>
          </svg>
          ${t('workflow.useTemplate') || 'Sử dụng'}
        </button>`
      : `<button class="wf-detail-import-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          ${t('workflow.importTemplate')}
        </button>`;

    // Create modal HTML
    const modalHtml = `
      <div class="wf-detail-modal-overlay">
        <div class="wf-detail-modal">
          <div class="wf-detail-header">
            <h3 class="wf-detail-title">${this._escapeHtml(template.name) || t('workflow.unnamed')}</h3>
              <button class="wf-detail-close-btn" title="${t('common.close')}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
          </div>
          <div class="wf-detail-body">
            <div class="wf-detail-thumb">
              ${thumbnailHtml}
            </div>
            <div class="wf-detail-info">
              ${template.description ? `<p class="wf-detail-desc">${this._escapeHtml(template.description)}</p>` : ''}
              <div class="wf-detail-meta">
                <div class="wf-detail-meta-left">
                  ${categoryName ? `<span class="wf-detail-category">${this._escapeHtml(categoryName)}</span>` : ''}
                  <span class="wf-detail-nodes-count" title="${t('workflow.nodesInWorkflow') || 'Số node trong workflow'}">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.17 3.646a.5.5 0 0 1 .707 0l5.477 5.477a.5.5 0 0 1 0 .707l-1.366 1.366a4.373 4.373 0 1 1-6.184-6.184L6.17 3.646Zm.353 1.061L5.508 5.723 5.5 5.73a3.373 3.373 0 1 0 4.77 4.77l.006-.008 1.016-1.015-4.77-4.77Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M5.354 10.646a.5.5 0 0 1 0 .707L3.02 13.688a.5.5 0 1 1-.707-.707l2.334-2.334a.5.5 0 0 1 .707 0ZM10.354 2.313a.5.5 0 0 1 0 .707L8.02 5.354a.5.5 0 0 1-.707-.708l2.334-2.333a.5.5 0 0 1 .707 0ZM13.687 5.646a.5.5 0 0 1 0 .708l-2.333 2.333a.5.5 0 1 1-.707-.707l2.333-2.334a.5.5 0 0 1 .707 0Z" fill="currentColor"/></svg>
                    ${(template.nodes || []).length} ${t('workflow.nodes') || 'nodes'}
                  </span>
                </div>
              </div>
            </div>
            ${templateTags}
          </div>
          <div class="wf-detail-footer">
            <button class="wf-detail-preview-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              ${t('workflow.previewBtn') || 'Xem trước'}
            </button>
            ${primaryActionBtn}
          </div>
        </div>
      </div>
    `;

    // Remove existing modal if any
    const existingModal = document.querySelector('.wf-detail-modal-overlay');
    if (existingModal) existingModal.remove();

    // Insert modal
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modalOverlay = document.querySelector('.wf-detail-modal-overlay');
    const closeBtn = modalOverlay.querySelector('.wf-detail-close-btn');
    const importBtn = modalOverlay.querySelector('.wf-detail-import-btn');
    const useBtn = modalOverlay.querySelector('.wf-detail-use-btn');
    const previewBtn = modalOverlay.querySelector('.wf-detail-preview-btn');

    // Close handlers
    const closeModal = () => {
      modalOverlay.remove();
    };

    closeBtn.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });

    // [GỠ] Cơ chế rating template đã bỏ (modal không render sao nào) → không bind rating nữa.

    // Preview handler — mở template trong workflow editor read-only (Option B)
    // Cùng UX với shared workflow — popup editor + diagram đầy đủ + flag read-only
    if (previewBtn) {
      previewBtn.addEventListener('click', () => {
        closeModal();
        this._openTemplateInEditor(template);
      });
    }

    // Use handler (clone qua API - cho user đã đăng nhập)
    if (useBtn) {
      useBtn.addEventListener('click', async () => {
        closeModal();
        await this._copyTemplateToWorkflow(template.id);
      });
    }

    // Import handler (import local - cho user chưa đăng nhập)
    if (importBtn) {
      importBtn.addEventListener('click', async () => {
        closeModal();
        await this._handleImport(template);
      });
    }

    // ESC to close — move removeEventListener into closeModal
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };
    document.addEventListener('keydown', escHandler);

    // Override closeModal to include ESC handler cleanup
    const originalCloseModal = closeModal;
    const closeModalWithCleanup = () => {
      document.removeEventListener('keydown', escHandler);
      originalCloseModal();
    };

    // Rebind close handlers to use cleanup version
    closeBtn.removeEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModalWithCleanup);
    modalOverlay.removeEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModalWithCleanup();
    });

    // Rebind use handler (clone qua API - cho user đã đăng nhập)
    if (useBtn) {
      useBtn.removeEventListener('click', useBtn._handler);
      useBtn._handler = async () => {
        closeModalWithCleanup();
        await this._copyTemplateToWorkflow(template.id);
      };
      useBtn.addEventListener('click', useBtn._handler);
    }

    // Rebind import handler (import local - cho user chưa đăng nhập)
    if (importBtn) {
      importBtn.removeEventListener('click', importBtn._handler);
      importBtn._handler = async () => {
        closeModalWithCleanup();
        await this._handleImport(template);
      };
      importBtn.addEventListener('click', importBtn._handler);
    }
  }


  /**
   * Mở template trong workflow editor (popup window) với mode read-only.
   * UX nhất quán với shared workflow — dùng cùng editor, cùng cơ chế read-only.
   * Data template KHÔNG bị ghi đè vì:
   *   - Flag _is_template_preview → editor.isReadOnly() = true → ẩn mọi action save/run/delete
   *   - wf_id giả `tpl_preview_{id}` → backend reject mọi update (workflow không tồn tại với wf_id này)
   *   - Backend ownership check (user_id) chặn mọi modify endpoint
   *
   * @param {Object} template
   */
  async _openTemplateInEditor(template) {
    const t = (key, params) => window.I18n?.t(key, params) || key;
    const dialog = window.customDialog;

    // 2026-06-04: Bỏ premium gate ở preview path — free user vẫn được xem template premium
    // trong editor (read-only). Clone/Use action mới block qua `_copyTemplateToWorkflow`
    // (line ~2172). Backend show endpoint nên cho phép GET cho mọi user (gated chỉ ở clone API).

    // Fetch fresh template data to get latest node positions after save
    let freshTemplate = template;
    try {
      const fetched = await this._fetchTemplateById(template.id);
      if (fetched) {
        freshTemplate = fetched;
      }
    } catch (err) {
      console.warn('[WorkflowTemplateList] Failed to fetch fresh template, using cached:', err);
    }

    // [Lite preview] Route sang cửa sổ template-preview.html SIÊU NHẸ (KHÔNG load workflow-editor.html
    // 82 script / execution / SSE) → tránh GPU/memory tích lũy khi mở preview nhiều lần. Dùng CHUNG
    // community + official. Lite page tự adapt template → render diagram read-only + nút "Use".
    console.log('[WorkflowTemplateList] Opening template in LITE preview:', freshTemplate.id);
    try {
      chrome.runtime.sendMessage({ action: 'openWorkflowTemplatePreview', template: freshTemplate }, () => void chrome.runtime.lastError);
    } catch (e) {
      console.error('[WorkflowTemplateList] open lite preview failed:', e?.message);
    }
  }

  // [Clean] Bỏ _convertTemplateToWorkflowFormat + _convertRefImgUrlsToThumbnails — chỉ dùng cho preview
  // template TRONG editor (đã thay bằng template-preview.html lite, tự adapt). Không còn caller.



  /**
   * EWT-13: Hiển thị modal xác nhận trước khi sử dụng template
   * @param {Object} template - Template object
   * @returns {Promise<boolean>} - true nếu user xác nhận, false nếu cancel
   */
  async _showUseTemplateConfirmation(template) {
    const t = (key, params) => window.I18n?.t(key, params) || key;

    return new Promise((resolve) => {
      const thumbnailHtml = this._renderTemplateThumbnail(template, 'wf-confirm-thumb-img', 'confirm');

      // Node count
      const nodeCount = (template.nodes || []).length;

      // Modal HTML
      const modalHtml = `
        <div class="wf-confirm-modal-overlay" id="useTemplateConfirmModal">
          <div class="wf-confirm-modal">
            <div class="wf-confirm-header">
              <h3 class="wf-confirm-title">${t('workflow.useTemplateConfirmTitle') || 'Sử dụng Template'}</h3>
              <button class="wf-confirm-close-btn" data-action="cancel" title="${t('common.close') || 'Close'}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div class="wf-confirm-body">
              <div class="wf-confirm-template-info">
                <div class="wf-confirm-thumb">${thumbnailHtml}</div>
                <div class="wf-confirm-details">
                  <h4 class="wf-confirm-name">${this._escapeHtml(template.name) || t('workflow.unnamed')}</h4>
                  ${template.description ? `<p class="wf-confirm-desc">${this._escapeHtml(template.description)}</p>` : ''}
                  <div class="wf-confirm-meta">
                    <span class="wf-confirm-nodes">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="6" cy="6" r="3"/>
                        <circle cx="18" cy="18" r="3"/>
                        <path d="M9 6h6a3 3 0 0 1 3 3v6"/>
                      </svg>
                      ${nodeCount} ${t('workflow.nodes') || 'nodes'}
                    </span>
                  </div>
                </div>
              </div>
              <div class="wf-confirm-message">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="16" x2="12" y2="12"/>
                  <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                <span>${t('workflow.useTemplateConfirmMessage') || 'Một bản sao của template này sẽ được tạo trong tài khoản của bạn. Bạn có thể tự do tuỳ chỉnh mà không làm thay đổi bản gốc.'}</span>
              </div>
            </div>
            <div class="wf-confirm-footer">
              <button class="wf-confirm-use-btn" data-action="confirm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 5v14"/>
                  <path d="M5 12h14"/>
                </svg>
                ${t('workflow.useTemplate') || 'Sử dụng'}
              </button>
            </div>
          </div>
        </div>
      `;

      // 2026-05-25: Defensive cleanup — remove ANY stale modal với cùng ID trước khi tạo mới.
      // Tránh duplicate ID conflict (vd race condition mở 2 lần) → getElementById trả về OLD instance
      // → addEventListener attach trên OLD (hidden) → user click NEW → no listener → "Cancel ko đc".
      document.querySelectorAll('#useTemplateConfirmModal').forEach(el => {
        // Cleanup wrapper div nếu có
        const wrapper = el.parentElement?.children.length === 1 ? el.parentElement : null;
        el.remove();
        if (wrapper && wrapper.parentElement === document.body) wrapper.remove();
      });

      // Add modal to DOM
      const modalContainer = document.createElement('div');
      modalContainer.innerHTML = modalHtml;
      document.body.appendChild(modalContainer);

      // Query trong modalContainer (đảm bảo đúng instance) thay vì document.getElementById.
      // getElementById có thể trả về OLD instance nếu ID conflict.
      const modal = modalContainer.querySelector('#useTemplateConfirmModal');

      // Handle actions
      const handleAction = (action) => {
        document.removeEventListener('keydown', handleKeyDown);
        modal?.remove();
        modalContainer?.remove();
        resolve(action === 'confirm');
      };

      // ESC key to cancel (declared trước để handleAction reference)
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          handleAction('cancel');
        }
      };

      if (!modal) {
        // Defensive: nếu modal null (HTML render fail) → resolve false ngay, tránh hang
        console.warn('[WorkflowTemplateList] useTemplateConfirmModal element not found after render');
        modalContainer?.remove();
        resolve(false);
        return;
      }

      // Event listeners
      modal.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]')?.dataset?.action;
        if (action) {
          handleAction(action);
          return;
        }
        // Click outside modal content = cancel
        if (e.target === modal) {
          handleAction('cancel');
        }
      });

      document.addEventListener('keydown', handleKeyDown);

      // Focus confirm button
      setTimeout(() => {
        modal?.querySelector('.wf-confirm-use-btn')?.focus();
      }, 100);
    });
  }

  /**
   * EWT-8.1: Copy template về workflow cá nhân thông qua API clone
   * Thay vì import local, gọi API backend để clone template thành workflow mới.
   * [Affiliate Creator Page] templateObj: template KHÔNG nằm trong this.templates (vd community
   * deep-link) → truyền thẳng object để confirm modal + gate đọc field (node_count, name...).
   * Backend /clone vẫn resolve theo templateId nên community (đã approve+public) clone được.
   * @param {number|string} templateId - ID của template cần copy
   * @param {Object|null} templateObj - Template object (nếu không có trong this.templates)
   */
  async _copyTemplateToWorkflow(templateId, templateObj = null) {
    const t = (key, params) => window.I18n?.t(key, params) || key;
    const dialog = window.customDialog || window.CustomDialog;
    console.log('[CloneDebug] _copyTemplateToWorkflow START id=', templateId, 'hasObj=', !!templateObj, 'isCopying=', this._isCopyingTemplate);

    // Lock để tránh duplicate click
    if (this._isCopyingTemplate) {
      console.log('[CloneDebug] EARLY RETURN: _isCopyingTemplate lock đang bật → no modal');
      return;
    }

    // Rate limit protection: tối thiểu 30 giây giữa các lần clone
    const now = Date.now();
    const cooldownMs = 30000;
    if (this._lastCloneTime && (now - this._lastCloneTime) < cooldownMs) {
      console.log('[CloneDebug] EARLY RETURN: cooldown 3s → no modal');
      const waitSec = Math.ceil((cooldownMs - (now - this._lastCloneTime)) / 1000);
      window.showNotification?.(
        t('workflow.pleaseWaitBeforeClone', { seconds: waitSec }) || `Vui lòng đợi ${waitSec} giây trước khi sao chép template tiếp theo`,
        'warning'
      );
      return;
    }

    // EWT-13: Lấy template info để hiện confirmation modal (ưu tiên object truyền vào — community)
    const template = templateObj || this.templates.find(tpl => String(tpl.id) === String(templateId));
    if (!template) {
      console.warn('[CloneDebug] _copyTemplateToWorkflow: template NOT FOUND (id=' + templateId + ', hasObj=' + !!templateObj + ') → return, no modal');
      window.showNotification?.(
        t('workflow.templateNotFound') || 'Không tìm thấy template',
        'error'
      );
      return;
    }
    console.log('[CloneDebug] _copyTemplateToWorkflow: template OK (name=' + (template.name || '?') + ', nodes=' + (template.nodes?.length ?? 'n/a') + ') → mở modal xác nhận');

    // Fix B: chặn Use/Import template khi chưa có Flow project sẵn sàng (chưa mở Flow / homepage /
    // project lỗi) → tránh tạo workflow "chết" không chạy được. Hiện modal hướng dẫn mở Flow + tạo
    // project. Đặt TRƯỚC lock _isCopyingTemplate → return sạch, không leak lock.
    if (window.ProjectHelper && !(await window.ProjectHelper.ensureProjectOrGuide())) {
      return;
    }

    // 2026-05-25: Set lock TRƯỚC khi show modal — tránh race mở duplicate confirm modal.
    // Trước fix: lock set ở line ~1971 (sau confirmation) → user click nhanh 2 lần → 2 confirm
    // modals stack với cùng ID → listener attach trên modal đầu → click cancel trên modal sau
    // không có listener → "Cancel ko đc".
    this._isCopyingTemplate = true;

    // EWT-13: Hiện confirmation modal
    let confirmed = false;
    try {
      confirmed = await this._showUseTemplateConfirmation(template);
    } catch (e) {
      this._isCopyingTemplate = false;
      throw e;
    }
    if (!confirmed) {
      console.log('[WorkflowTemplateList] User cancelled use template confirmation');
      this._isCopyingTemplate = false;
      return;
    }

    try {

      // Local/offline: clone template = tạo workflow ngay bằng LocalStorage (xem nhánh dưới,
      // ~line 1830). KHÔNG có server/auth/quota → bỏ qua toàn bộ cổng login + featureGate,
      // nếu không isLoggedIn()=false sẽ return sớm và template không bao giờ được áp dụng.
      const _isLocal = self.SEOSONA_LOCAL_MODE !== false;

      // Kiểm tra đăng nhập trước khi gọi API clone
      if (!_isLocal && !window.authManager?.isLoggedIn()) {
        window.showNotification?.(
          t('workflow.loginRequiredToCopy') || 'Vui lòng đăng nhập để sao chép template',
          'warning'
        );
        // Hiển thị login prompt nếu có
        if (window.featureGate?.showLoginPrompt) {
          window.featureGate.showLoginPrompt(
            t('workflow.loginToCloneTemplate') || 'Login to clone this template to your workflows'
          );
        }
        return;
      }

      // Pre-check workflows_enabled — user xem template OK nhưng tạo workflow yêu cầu quyền riêng.
      // Guest → modal Login; Logged-in plan thấp → modal Upgrade.
      if (!_isLocal && window.featureGate && !window.featureGate.canUse('workflows_enabled')) {
        const isLoggedIn = window.authManager?.isLoggedIn?.();
        const ctaText = isLoggedIn ? (t('common.upgrade') || 'Upgrade') : (t('auth.login') || 'Login');
        const titleText = isLoggedIn
          ? (t('featuregate.featureLockedTitle') || 'Tính năng bị khóa')
          : (t('featuregate.loginRequiredTitle') || 'Yêu cầu đăng nhập');
        const msgText = isLoggedIn
          ? (t('workflow.useTemplateRequiresUpgrade') || 'Tính năng tạo workflow chưa được kích hoạt cho gói của bạn. Nâng cấp để sao chép template về tài khoản.')
          : (t('workflow.useTemplateRequiresLogin') || 'Bạn cần đăng nhập để sao chép template về tài khoản của mình.');

        const ok = await dialog?.confirm(msgText, {
          title: titleText,
          type: 'warning',
          confirmText: ctaText,
          cancelText: t('common.later') || 'Later',
        });
        if (ok) {
          if (isLoggedIn) {
            try { chrome.runtime.sendMessage({ action: 'showUpgradeModal' }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowTemplateList#t', e); }
          }
          // not-logged-in branch removed — loginOverlay no longer exists (local-first)
        }
        return;
      }

      // EWT-12.4: Kiểm tra premium template access trước khi clone (ưu tiên object — community)
      const template = templateObj || this.templates.find(tpl => String(tpl.id) === String(templateId));
      if (!_isLocal && template?.is_premium && !window.featureGate?.canAccessPremiumTemplates()) {
        const shouldUpgrade = await dialog?.confirm(
          t('workflow.premiumTemplateRequired') ||
          'Bạn cần nâng cấp gói để sử dụng template premium này.',
          {
            title: t('workflow.premiumRequired') || 'Yêu cầu Premium',
            type: 'warning',
            confirmText: t('common.upgrade') || 'Upgrade',
            cancelText: t('common.later') || 'Later'
          }
        );
        if (shouldUpgrade) {
          try { chrome.runtime.sendMessage({ action: 'showUpgradeModal' }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowTemplateList#t', e); }
        }
        return;
      }

      // EWT-8.4: Kiểm tra quota workflows_max trước khi clone
      if (!_isLocal && window.featureGate) {
        // Force refresh: backend trả usage_today = workflows()->count() động.
        // Cache local có thể stale sau khi user xóa workflow ở tab khác hoặc trước đó
        // (refresh() thường bị guard SSE skip — xem FeatureGate.refresh:205).
        try { await window.featureGate.refresh({ force: true }); } catch (e) { /* ignore, dùng cache */ }
        const quota = window.featureGate.checkQuota('workflows_max');
        if (quota.limit !== 'unlimited' && quota.limit > 0 && quota.used >= quota.limit) {
          const shouldUpgrade = await dialog?.confirm(
            t('workflow.quotaLimitReached', { limit: quota.limit, used: quota.used }) ||
            `Gói của bạn giới hạn tối đa ${quota.limit} workflow. Bạn đã có ${quota.used} workflow. Nâng cấp Premium để tạo không giới hạn.`,
            {
              title: t('workflow.quotaLimitTitle') || 'Limit reached',
              type: 'warning',
              confirmText: t('common.upgrade') || 'Upgrade',
              cancelText: t('common.later') || 'Later'
            }
          );
          if (shouldUpgrade) {
            try { chrome.runtime.sendMessage({ action: 'showUpgradeModal' }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowTemplateList#t', e); }
          }
          return;
        }

        // [Affiliate Creator Page] Node-limit gate (workflows_nodes_max) — chặn clone template
        // vượt số node gói cho phép → upsell. Dùng template.node_count (community có sẵn; official
        // node_count=0 → bỏ qua, giữ behavior cũ).
        const nodeCount = Number(template?.node_count) || 0;
        if (nodeCount > 0) {
          const nodeQuota = window.featureGate.checkQuota('workflows_nodes_max');
          const limit = nodeQuota?.limit;
          if (limit !== 'unlimited' && limit !== '-1' && limit > 0 && nodeCount > limit) {
            const shouldUpgrade = await dialog?.confirm(
              t('workflow.templateNodeQuotaExceeded', { count: nodeCount, limit }) ||
              `Template "${template.name}" có ${nodeCount} node nhưng gói của bạn chỉ cho phép tối đa ${limit} node/workflow. Vui lòng nâng cấp lên gói cao hơn.`,
              {
                title: t('workflow.limitReached') || 'Vượt giới hạn nodes',
                type: 'warning',
                confirmText: t('common.upgrade') || 'Upgrade',
                cancelText: t('common.later') || 'Later',
              }
            );
            if (shouldUpgrade) {
              try { chrome.runtime.sendMessage({ action: 'showUpgradeModal' }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowTemplateList#t', e); }
            }
            return;
          }
        }
      }

      // Hiển thị loading notification
      window.showNotification?.(
        t('workflow.copyingTemplate') || 'Copying template...',
        'info',
        2000
      );

      // Gọi API clone template, gán vào project hiện tại nếu có
      let response = null;
      const tpl = templateObj || this.templates.find(t => String(t.id) === String(templateId)) || (window.BUNDLED_TEMPLATES && window.BUNDLED_TEMPLATES.find(t => String(t.id) === String(templateId)));
      
      if (tpl) {
        // Create workflow locally
        const wf_id = 'wf_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newWorkflow = {
          wf_id,
          wf_name: tpl.name || 'Untitled Template',
          wf_desc: tpl.description || '',
          project_id: window._currentProjectId || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: 'idle',
          platform: 'flow'
        };
        // FIX (2026-07-12): bundled template ở shape LỒNG ({id,type,position,data}) nhưng
        // DiagramCanvas.loadWorkflow đọc shape PHẲNG (node_type/pos_x/node_id, edge source_node_id).
        // Converter _convertTemplateToWorkflowFormat từng bị xoá ("không còn caller") NHƯNG path này vẫn
        // cần → template truyền raw → mọi node rơi về 'generate' (mất data), dồn (100,100), edge mất hết.
        // Flatten tại đây, defensive cho cả 2 shape (mirror scripts/workflow-editor-init.js).
        const _ts = Date.now();
        const nodes = (tpl.nodes || []).map((n, i) => ({
          ...(n.data || {}),
          node_id: n.node_id || n.id || `node_${_ts}_${i}`,
          node_type: n.node_type || n.type,
          node_name: n.node_name || (n.data && n.data.node_name) || n.name || n.type,
          pos_x: n.pos_x ?? (n.position && n.position.x) ?? 100,
          pos_y: n.pos_y ?? (n.position && n.position.y) ?? 100,
        }));
        const edges = (tpl.edges || []).map((e, i) => ({
          edge_id: e.edge_id || e.id || `edge_${_ts}_${i}`,
          source_node_id: e.source_node_id || e.source,
          target_node_id: e.target_node_id || e.target,
          source_handle: e.source_handle || e.sourceHandle || 'output_1',
          target_handle: e.target_handle || e.targetHandle || 'input_1',
          source_port: e.source_port || 'default',
          target_port: e.target_port || 'default',
        }));

        // Luôn lưu bằng LocalStorage để bypass hoàn toàn API, tránh lỗi 403 do auth.
        const LocalStorage = window.LocalStorage;
        if (LocalStorage) {
          const local = new LocalStorage();
          await local.saveWorkflowFull(newWorkflow, nodes, edges);
        } else {
          console.error('[WorkflowTemplateList] LocalStorage is missing!');
          throw new Error('LocalStorage is missing');
        }
        
        response = { workflow: newWorkflow };
      } else if (window.authManager?._apiCall) {
        response = await window.authManager._apiCall(
          'POST',
          `workflow-templates/${templateId}/clone`,
          { project_id: window._currentProjectId || null }
        );
      } else {
        // Fix crash '_apiCall of undefined': template không có trong BUNDLED_TEMPLATES + local mode
        // (không backend) → không clone được. Báo rõ thay vì đọc _apiCall trên undefined.
        throw new Error('Không tìm thấy template (id ' + templateId + ') trong bộ cục bộ và không có backend để clone.');
      }

      if (response?.workflow) {
        const newWorkflow = response.workflow;
        console.log('[WorkflowTemplateList] Template cloned successfully:', newWorkflow.wf_id);

        // EWT-8.2: Refresh workflow list sau khi copy
        // Đợi một chút để backend sync xong
        await new Promise(resolve => setTimeout(resolve, 200));

        // Refresh workflow list
        if (window.workflowList?.loadWorkflows) {
          await window.workflowList.loadWorkflows();
        }

        // Refresh featureGate để cập nhật số lượng workflow
        if (window.featureGate) {
          window.featureGate.refresh({ force: true }).catch(e =>
            console.warn('[WorkflowTemplateList] FeatureGate refresh failed:', e)
          );
        }

        // Chuyển sang tab Workflows
        const workflowsTab = document.querySelector('[data-subtab="workflows"]');
        if (workflowsTab) {
          workflowsTab.click();
        } else if (window.eventBus) {
          // Fallback: emit event để chuyển tab
          window.eventBus.emit('workflow:subtab_changed', { subtab: 'workflows' });
        }

        // EWT-8.3: Auto-open workflow editor với workflow mới
        // Delay một chút để tab switch hoàn tất
        setTimeout(() => {
          if (window.workflowList?._openWorkflow) {
            window.workflowList._openWorkflow(newWorkflow.wf_id);
          } else if (window.eventBus) {
            // Fallback: emit event để mở editor
            window.eventBus.emit('workflow:open_editor', {
              mode: 'edit',
              workflow: newWorkflow
            });
          }
        }, 300);

        // Hiển thị thông báo thành công
        window.showNotification?.(
          t('workflow.copyTemplateSuccess') || 'Template copied successfully',
          'success'
        );

      } else {
        throw new Error(t('workflow.copyTemplateNoData') || 'Không nhận được dữ liệu workflow từ server');
      }

    } catch (err) {
      console.error('[WorkflowTemplateList] Copy template to workflow failed:', err);

      // EWT-8.4: Handle errors - phân loại lỗi cụ thể
      let errorMessage = err.message || (t('workflow.copyTemplateFailed') || 'Không thể sao chép template');

      // Xử lý các loại lỗi cụ thể
      if (err.code === 'QUOTA_EXCEEDED' || err.code === 'FEATURE_DISABLED'
          || err.message?.includes('giới hạn') || err.message?.includes('quota')
          || err.message?.includes('node/workflow') || err.message?.includes('node nhưng gói')) {
        // Lỗi vượt quota / feature locked → modal upgrade
        // Trích xuất số node từ backend message nếu có, dùng frontend i18n để format message chuẩn
        let dialogMsg = t('workflow.quotaExceededOnClone') || 'Bạn đã đạt giới hạn của gói. Nâng cấp gói để tiếp tục.';

        // Parse node count và limit từ backend message nếu có (vd: "Template có 7 node... tối đa 5 node")
        const nodeMatch = err.message?.match(/có\s+(\d+)\s+node.*tối đa\s+(\d+)/i);
        if (nodeMatch) {
          const count = parseInt(nodeMatch[1], 10);
          const limit = parseInt(nodeMatch[2], 10);
          dialogMsg = t('workflow.templateNodeQuotaExceeded', { count, limit })
            || `Template có ${count} node nhưng gói của bạn chỉ cho phép tối đa ${limit} node/workflow. Vui lòng chọn Template có ${limit} node hoặc nâng cấp lên gói Pro.`;
        }
        const shouldUpgrade = await dialog?.confirm(dialogMsg, {
          title: t('workflow.quotaLimitTitle') || 'Limit reached',
          type: 'warning',
          confirmText: t('common.upgrade') || 'Upgrade',
          cancelText: t('common.later') || 'Later'
        });
        if (shouldUpgrade) {
          try { chrome.runtime.sendMessage({ action: 'showUpgradeModal' }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowTemplateList#t', e); }
        }
        return;
      }

      if (err.httpStatus === 401 || err.code === 'UNAUTHENTICATED') {
        // Lỗi xác thực - session hết hạn
        errorMessage = t('auth.sessionExpired') || 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
      } else if (err.httpStatus === 403 || err.code === 'FORBIDDEN') {
        // Lỗi quyền truy cập
        errorMessage = t('workflow.copyTemplateForbidden') || 'Bạn không có quyền sao chép template này';
      } else if (err.httpStatus === 404) {
        // Template không tồn tại
        errorMessage = t('workflow.templateNotFound') || 'Template không tồn tại hoặc đã bị xóa';
      } else if (err.httpStatus >= 500) {
        // Lỗi server
        errorMessage = t('common.serverError') || 'Lỗi máy chủ. Vui lòng thử lại sau.';
      }

      // Hiển thị thông báo lỗi
      window.showNotification?.(errorMessage, 'error');

      // Log chi tiết để debug
      if (err.serverData) {
        console.error('[WorkflowTemplateList] Server error data:', err.serverData);
      }
    } finally {
      this._isCopyingTemplate = false;
      this._lastCloneTime = Date.now();
    }
  }

  /**
   * EWT-6.5: Mở template trong editor để chỉnh sửa (admin only)
   * Mở window riêng với workflow-template-editor.html
   * @param {number|string} templateId - ID của template cần chỉnh sửa
   */
  async _openTemplateForEdit(templateId) {
    const t = (key, params) => window.I18n?.t(key, params) || key;

    try {
      const isLocal = (self.SEOSONA_LOCAL_MODE !== false);
      const UTS = window.UserTemplateStore;

      // LOCAL: sửa template LUÔN thao tác trên KHO USER (bản mặc định gốc không bao giờ bị đụng).
      //  - id user (utpl_) → sửa tại chỗ.
      //  - id mặc định (bundled) → fork thành bản của user rồi sửa bản fork.
      if (isLocal && UTS) {
        let editable;
        if (UTS.isUserTemplateId(templateId)) {
          editable = await UTS.get(templateId)
            || this.templates.find(tpl => String(tpl.id) === String(templateId));
          if (!editable) throw new Error(t('workflow.templateNotFound') || 'Không tìm thấy template');
        } else {
          editable = await UTS.forkFromBundled(templateId);
          window.showNotification?.(
            t('workflow.forkedForEdit') || 'Đã tạo bản của bạn để chỉnh sửa. Bản mặc định giữ nguyên.',
            'info', 3000
          );
          this._loadTemplates(false); // refresh để bản fork hiện ở nhóm "Của tôi"
        }
        await chrome.storage.local.set({ '_pendingTemplate': editable });
        this._openTemplateEditorWindow(editable.id, 'edit');
        return;
      }

      // ONLINE (giữ nguyên hành vi cũ — sửa template server)
      window.showNotification?.(t('workflow.loadingTemplate') || 'Loading template...', 'info', 2000);
      const template = this.templates.find(tpl => String(tpl.id) === String(templateId))
        || (window.BUNDLED_TEMPLATES && window.BUNDLED_TEMPLATES.find(tpl => String(tpl.id) === String(templateId)));
      if (!template) throw new Error(t('workflow.templateNotFound') || 'Không tìm thấy template');
      await chrome.storage.local.set({ '_pendingTemplate': template });
      this._openTemplateEditorWindow(template.id, 'edit');

    } catch (err) {
      console.error('[WorkflowTemplateList] Lỗi khi mở template để chỉnh sửa:', err);
      let errorMessage = err.message || (t('workflow.loadTemplateFailed') || 'Không thể tải template');
      window.showNotification?.(errorMessage, 'error');
    }
  }


  /**
   * Mở window riêng cho template editor
   * Sử dụng chrome.runtime.sendMessage để mở qua background.js
   * với smart sizing giống workflow editor (1440x900 hoặc 90% Flow window)
   * @param {string|number|null} templateId - ID của template (null nếu tạo mới)
   * @param {string} mode - 'create' hoặc 'edit'
   */
  _openTemplateEditorWindow(templateId = null, mode = 'create') {
    // Gọi background.js để mở window với smart sizing
    chrome.runtime.sendMessage({
      action: 'openTemplateEditor',
      data: {
        mode,
        templateId: templateId || null
      }
    }, (response) => {
      if (response?.ok) {
        console.log('[WorkflowTemplateList] Đã gửi yêu cầu mở template editor window');
      } else {
        console.error('[WorkflowTemplateList] Lỗi mở template editor:', response?.error);
        window.showNotification?.(
          window.I18n?.t('workflow.popupBlocked') || 'Không thể mở cửa sổ template editor.',
          'warning'
        );
      }
    });
  }

  /**
   * Fetch template đầy đủ từ API theo ID
   * @param {number|string} templateId
   * @returns {Promise<Object>}
   */
  async _fetchTemplateById(templateId) {
    const result = await this._apiCall(`workflow-templates/${templateId}`);
    // API có thể trả về { data: template } hoặc trực tiếp template object
    return result?.data || result;
  }

  /**
   * EWT-10: Tạo template mới từ đầu (admin only)
   * Mở window riêng với workflow-template-editor.html
   */
  _createNewTemplate() {
    const t = (key, params) => window.I18n?.t(key, params) || key;

    // Kiểm tra quyền admin
    if (!window.featureGate?.canManageWorkflowTemplates()) {
      window.showNotification?.(
        t('workflow.adminRequired') || 'Bạn cần quyền admin để tạo template',
        'error'
      );
      return;
    }

    console.log('[WorkflowTemplateList] Tạo template mới - mở window riêng');

    // Clear pending template data (để window mở ở create mode)
    chrome.storage.local.remove('_pendingTemplate');

    // Mở window riêng
    this._openTemplateEditorWindow(null, 'create');

    window.showNotification?.(
      t('workflow.openingTemplateEditor') || 'Opening template editor...',
      'info'
    );
  }

  /**
   * Handle search with debounce (400ms)
   * @param {string} query
   */
  _handleSearch(query) {
    if (this._searchTimeout) {
      clearTimeout(this._searchTimeout);
    }

    this._searchTimeout = setTimeout(() => {
      this.searchQuery = query.trim();
      this.currentPage = 1;
      this._loadTemplates(false);
    }, 400);
  }

  /**
   * Handle category filter
   * @param {string|null} categoryId
   */
  _handleCategoryFilter(categoryId) {
    if (this.selectedCategory === categoryId) return;

    this.selectedCategory = categoryId || null;
    this.currentPage = 1;

    this._loadTemplates(false);
  }

  /**
   * EWT-12.4: Hiển thị upgrade prompt modal khi user cố truy cập premium template
   * @param {Object} template - Template premium bị khóa
   */
  async _showUpgradePrompt(template) {
    const t = (key, params) => window.I18n?.t(key, params) || key;
    const dialog = window.customDialog || window.CustomDialog;
    const isLoggedIn = window.authManager?.isLoggedIn() || false;

    // Tạo message tùy theo trạng thái đăng nhập
    let message = '';
    let confirmText = '';

    if (!isLoggedIn) {
      // User chưa đăng nhập: khuyến khích đăng nhập + nâng cấp
      message = t('workflow.premiumTemplateLoginRequired', { name: template.name }) ||
        `Template "${template.name}" là template Premium.\n\nĐăng nhập và nâng cấp lên gói Premium để sử dụng template này và nhiều template độc quyền khác.`;
      confirmText = t('auth.login') || 'Login';
    } else {
      // User đã đăng nhập nhưng không có premium plan
      message = t('workflow.premiumTemplateUpgradeRequired', { name: template.name }) ||
        `Template "${template.name}" là template Premium.\n\nNâng cấp lên gói Premium để sử dụng template này và truy cập đầy đủ các tính năng cao cấp.`;
      confirmText = t('common.upgrade') || 'Upgrade';
    }

    // Hiển thị dialog xác nhận
    const confirmed = await dialog?.confirm(message, {
      title: t('workflow.premiumTemplateTitle') || 'Template Premium',
      type: 'warning',
      confirmText: confirmText,
      cancelText: t('common.later') || 'Later'
    });

    if (confirmed) {
      if (!isLoggedIn) {
        // loginOverlay removed (local-first) → fallback: mở settings page
        chrome.runtime.sendMessage({ action: 'openSettings' });
      } else {
        // Mở upgrade modal (relay tới sidebar)
        try { chrome.runtime.sendMessage({ action: 'showUpgradeModal' }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowTemplateList#t', e); }
      }
    }
  }


  /**
   * Destroy / cleanup
   */
  destroy() {
    if (this._searchTimeout) {
      clearTimeout(this._searchTimeout);
    }

    // Remove i18n event listener
    if (this._i18nHandler && window.eventBus) {
      window.eventBus.off('i18n:changed', this._i18nHandler);
      this._i18nHandler = null;
    }

    // EWT-10: Remove template event listeners
    if (window.eventBus) {
      if (this._templateCreatedHandler) {
        window.eventBus.off('template:created', this._templateCreatedHandler);
        this._templateCreatedHandler = null;
      }
      if (this._templateUpdatedHandler) {
        window.eventBus.off('template:updated', this._templateUpdatedHandler);
        this._templateUpdatedHandler = null;
      }
      if (this._authLoginHandler) {
        window.eventBus.off('auth:login', this._authLoginHandler);
        this._authLoginHandler = null;
      }
      if (this._authLogoutHandler) {
        window.eventBus.off('auth:logout', this._authLogoutHandler);
        this._authLogoutHandler = null;
      }
      if (this._featuregateRefreshHandler) {
        window.eventBus.off('featuregate:refreshed', this._featuregateRefreshHandler);
        this._featuregateRefreshHandler = null;
      }
    }
  }
}

// Export
window.WorkflowTemplateList = WorkflowTemplateList;
