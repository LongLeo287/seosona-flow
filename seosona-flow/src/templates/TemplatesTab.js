/**
 * TemplatesTab - Tab thư viện template từ server
 * Grid view, lọc category/label/difficulty/media_type, tìm kiếm, phân trang
 * Hover overlay "Sử dụng", star rating, template guide
 */
class TemplatesTab {
  constructor(container) {
    this.container = container;
    this.templates = [];
    this.categories = [];
    this.filters = {
      category_id: '',
      label: '',
      difficulty: '',
      media_type: '',
      search: '',
      is_premium: ''
    };
    this.currentPage = 1;
    this.totalPages = 1;
    this.isLoading = false;
    this.initialized = false;
    this._searchTimer = null;
    this._cardCache = new Map();
    this._renderedCount = 0;
    this._renderBatchSize = 20;
    this._scrollThrottleTimer = null;
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    console.log('[SEOSONA Flow] TemplatesTab: Đang khởi tạo...');

    this.render();
    this.bindEvents();
    await this.loadCategories();
    await this.loadTemplates();

    // Reload data khi feature được bật (admin change plan)
    window.eventBus?.on('featuregate:refreshed', () => {
      if (window.featureGate?.canUsePromptTemplates() && this.templates.length === 0) {
        this._cardCache.clear();
        this.loadCategories();
        this.loadTemplates();
      }
    });

    // Reload templates khi user login (có thể có templates private/premium)
    window.eventBus?.on('auth:login', () => {
      this._cardCache.clear();
      this.loadTemplates();
    });
    // Clear premium templates cache khi user logout
    window.eventBus?.on('auth:logout', () => {
      this._cardCache.clear();
      this.loadTemplates();
    });

    // Re-render UI khi ngôn ngữ thay đổi
    window.eventBus?.on('i18n:changed', () => {
      this._cardCache.clear();
      this.render();
      this.bindEvents();
      this.loadCategories();
      this._renderGrid();
    });

    console.log('[SEOSONA Flow] TemplatesTab: Đã khởi tạo');
  }

  reload() {
    this.currentPage = 1;
    this._cardCache.clear();
    this.loadTemplates();
  }

  render() {
    // Preserve module-blocked-overlay (destroyed by innerHTML replacement)
    const moduleOverlay = this.container.querySelector('.module-blocked-overlay');
    this.container.innerHTML = `
      <div class="seosonaflow-templates-tab">
        <!-- Search + Filters compact -->
        <div class="section seosonaflow-templates-search">
          <div class="seosonaflow-templates-search-row">
            <div class="input-group seosonaflow-templates-search-box">
              <svg class="seosonaflow-templates-search__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" id="templateSearchInput" placeholder="${window.I18n?.t('templates.searchTemplate') || 'Tìm kiếm template...'}" />
            </div>
            <button class="btn btn-secondary btn-sm seosonaflow-refresh-btn" id="templateRefreshBtn" title="${window.I18n?.t('common.reload') || 'Tải lại'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </button>
          </div>
          <!-- Filters: 1 row, 3 columns -->
          <div class="seosonaflow-templates-filter-row">
            <div class="input-group select-group compact-select">
              <select id="templateCategoryFilter">
                <option value="">${window.I18n?.t('templates.category') || 'Danh mục'}</option>
              </select>
              <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            <div class="input-group select-group compact-select">
              <select id="templateMediaFilter">
                <option value="">${window.I18n?.t('templates.type') || 'Loại'}</option>
                <option value="Image">${window.I18n?.t('templates.typeImage') || 'Ảnh'}</option>
                <option value="Video">${window.I18n?.t('templates.typeVideo') || 'Video'}</option>
              </select>
              <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            <div class="input-group select-group compact-select">
              <select id="templateDifficultyFilter">
                <option value="">${window.I18n?.t('templates.difficulty') || 'Độ khó'}</option>
                <option value="easy">${window.I18n?.t('templates.difficultyEasy') || 'Dễ'}</option>
                <option value="medium">${window.I18n?.t('templates.difficultyMedium') || 'Trung bình'}</option>
                <option value="advanced">${window.I18n?.t('templates.difficultyAdvanced') || 'Nâng cao'}</option>
              </select>
              <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
          <!-- Label pills -->
          <div class="seosonaflow-templates-labels">
            <button class="seosonaflow-templates-label-btn" data-label="trending">${window.I18n?.t('templates.trending') || 'Xu hướng'}</button>
            <button class="seosonaflow-templates-label-btn" data-label="new">${window.I18n?.t('templates.new') || 'Mới'}</button>
            <button class="seosonaflow-templates-label-btn" data-label="featured">${window.I18n?.t('templates.featured') || 'Nổi bật'}</button>
            <div class="input-group select-group compact-select seosonaflow-templates-premium-filter">
              <select id="templatePremiumFilter">
                <option value="">${window.I18n?.t('common.all') || 'Tất cả'}</option>
                <option value="0">${window.I18n?.t('templates.free') || 'Miễn phí'}</option>
                <option value="1">${window.I18n?.t('templates.premium') || 'Premium'}</option>
              </select>
              <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
        </div>

        <!-- Grid template -->
        <div class="section seosonaflow-templates-grid" id="templatesGrid">
          <div class="seosonaflow-templates-loading">${window.I18n?.t('common.loading') || 'Đang tải...'}</div>
        </div>

        <!-- Tải thêm -->
        <div class="section seosonaflow-templates-load-more hidden" id="templatesLoadMore">
          <button class="btn btn-secondary btn-sm" id="loadMoreTemplatesBtn">${window.I18n?.t('templates.loadMore') || 'Tải thêm'}</button>
        </div>
      </div>
    `;
    if (moduleOverlay) this.container.prepend(moduleOverlay);
  }

  /**
   * Render SVG star icon (filled hoặc empty)
   */
  _renderStar(filled) {
    if (filled) {
      return `<svg class="seosonaflow-star seosonaflow-star--filled" width="12" height="12" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
    }
    return `<svg class="seosonaflow-star seosonaflow-star--empty" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
  }

  /**
   * Render rating display (read-only stars + avg + count)
   */
  _renderRatingDisplay(avgRating, ratingsCount) {
    if (!ratingsCount || ratingsCount === 0) {
      return `<span class="seosonaflow-template-rating seosonaflow-template-rating--empty">${window.I18n?.t('templates.noRating') || 'Chưa có đánh giá'}</span>`;
    }

    const roundedRating = Math.round(avgRating);
    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
      starsHtml += this._renderStar(i <= roundedRating);
    }

    return `
      <span class="seosonaflow-template-rating">
        <span class="seosonaflow-template-rating__stars">${starsHtml}</span>
        <span class="seosonaflow-template-rating__text">${avgRating} (${ratingsCount})</span>
      </span>
    `;
  }

  /**
   * Render interactive star rating (clickable)
   */
  _renderInteractiveRating(templateId) {
    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
      starsHtml += `<span class="seosonaflow-star-interactive" data-rating="${i}" data-template-id="${templateId}">${this._renderStar(false)}</span>`;
    }
    return `
      <div class="seosonaflow-template-rating-interactive" data-template-id="${templateId}">
        <span class="seosonaflow-template-rating-interactive__label">${window.I18n?.t('templates.rateLabel') || 'Đánh giá:'}</span>
        <span class="seosonaflow-template-rating-interactive__stars">${starsHtml}</span>
      </div>
    `;
  }

  /**
   * Render 1 template card HTML string
   */
  _renderCardHtml(template) {
    const labels = this._parseLabels(template);
    const labelsHtml = labels.map(l =>
      `<span class="seosonaflow-template-card__badge seosonaflow-template-card__badge--${l.key}">${l.text}</span>`
    ).join('');

    const categoryName = template.category?.name || '';
    const mediaTypeBadge = template.media_type
      ? `<span class="seosonaflow-template-card__media-badge">${template.media_type === 'Image' ? (window.I18n?.t('templates.typeImage') || 'Ảnh') : 'Video'}</span>`
      : '';

    const thumbnailHtml = template.thumbnail_url
      ? `<img src="${template.thumbnail_url}" alt="${this._escapeHtml(template.title)}" class="seosonaflow-template-card__img" loading="lazy" />`
      : `<div class="seosonaflow-template-card__placeholder">
           <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
         </div>`;

    const useCount = template.use_count || 0;
    const difficultyText = this._getDifficultyText(template.difficulty);
    const ratingHtml = this._renderRatingDisplay(template.avg_rating, template.ratings_count);

    const isPremium = !!template.is_premium;
    const isFreePlan = !window.featureGate || window.featureGate.isFreePlan();
    const isLocked = isPremium && isFreePlan;

    const premiumBadgeHtml = isPremium
      ? `<span class="seosonaflow-template-card__badge seosonaflow-template-card__badge--premium">
           <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M2.5 18.5l3-7.5L12 2l6.5 9 3 7.5H2.5z"/></svg>
           Premium
         </span>`
      : '';

    const overlayContent = isLocked
      ? `<div class="seosonaflow-template-overlay seosonaflow-template-overlay--locked">
           <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
           <span class="seosonaflow-template-locked-text">Premium</span>
         </div>`
      : `<div class="seosonaflow-template-overlay">
           <button class="seosonaflow-template-use-btn" data-template-id="${template.id}"><svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z"></path><path d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z"></path></svg> ${window.I18n?.t('templates.useTemplate') || 'Sử dụng'}</button>
         </div>`;

    return `
      <div class="seosonaflow-template-card${isLocked ? ' seosonaflow-template-card--locked' : ''}" data-template-id="${template.id}" data-is-premium="${isPremium ? '1' : '0'}">
        <div class="seosonaflow-template-card__thumb">
          ${thumbnailHtml}
          ${labelsHtml || premiumBadgeHtml ? `<div class="seosonaflow-template-card__badges">${labelsHtml}${premiumBadgeHtml}</div>` : ''}
          ${overlayContent}
        </div>
        <div class="seosonaflow-template-card__body">
          <div class="seosonaflow-template-card__title">${this._escapeHtml(template.title)}</div>
          <div class="seosonaflow-template-card__meta">
            ${categoryName ? `<span class="seosonaflow-template-card__category">${this._escapeHtml(categoryName)}</span>` : ''}
            ${mediaTypeBadge}
            ${difficultyText ? `<span class="seosonaflow-template-card__difficulty">${difficultyText}</span>` : ''}
          </div>
          <div class="seosonaflow-template-card__footer">
            <span class="seosonaflow-template-card__uses">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.5385 11.4899C17.7949 11.4899 19.641 9.65316 19.641 7.40826C19.641 5.16336 17.7949 3.32663 15.5385 3.32663C15.4359 3.32663 15.3334 3.32663 15.2308 3.32663C15.8462 4.34704 16.2564 5.57153 16.2564 6.79602C16.2564 8.53071 15.5385 10.1634 14.4103 11.3879C14.718 11.4899 15.1282 11.4899 15.5385 11.4899Z" fill="currentColor"/><path d="M17.2821 13.6326H16.2565C17.7949 14.9591 18.8206 17 18.8206 19.2448C18.8206 19.7551 18.718 20.1632 18.6154 20.5714C19.9488 20.3673 20.7693 20.0612 21.2821 19.7551C21.7949 19.4489 22.0001 18.9387 22.0001 18.3265C22.0001 15.7755 19.8462 13.6326 17.2821 13.6326Z" fill="currentColor"/><path d="M9.38459 11.4898C10.6154 11.4898 11.641 11.0817 12.5641 10.2654C13.5897 9.44903 14.1025 8.1225 14.1025 6.79597C14.1025 5.77556 13.7948 4.75515 13.1795 4.04087C12.3589 2.81638 11.0256 2.00005 9.38459 2.00005C6.82049 2.00005 4.66664 4.14291 4.66664 6.69393C4.66664 9.34699 6.82049 11.4898 9.38459 11.4898Z" fill="currentColor"/><path d="M12.1538 13.9389C11.8462 13.9389 11.641 13.8369 11.3333 13.8369H7.4359C4.46154 13.8369 2 16.2859 2 19.245C2 19.9593 2.30769 20.4695 2.82051 20.8777C3.64103 21.3879 5.58974 22.0001 9.38461 22.0001C13.1795 22.0001 15.0256 21.3879 15.9487 20.8777C15.9487 20.8777 16.0513 20.7757 16.1538 20.7757C16.5641 20.4695 16.8718 19.9593 16.8718 19.245C16.7692 16.592 14.8205 14.3471 12.1538 13.9389Z" fill="currentColor"/></svg>
              ${useCount}
            </span>
            ${ratingHtml}
          </div>
        </div>
      </div>
    `;
  }

  _getOrCreateCard(template) {
    const tid = String(template.id);
    if (this._cardCache.has(tid)) {
      return this._cardCache.get(tid);
    }
    const wrapper = document.createElement('div');
    wrapper.innerHTML = this._renderCardHtml(template).trim();
    const el = wrapper.firstElementChild;
    this._cardCache.set(tid, el);
    return el;
  }

  /**
   * Helper: Gọi API cho cả anonymous và logged-in users
   * Anonymous users dùng chrome.runtime.sendMessage trực tiếp
   * Logged-in users dùng authManager._apiCall
   */
  async _apiCall(method, endpoint, data = null) {
    if (true && true) {
      // Logged-in: dùng authManager._apiCall
      return ApiClient.request(method, endpoint, data);
    }

    // Anonymous: gọi trực tiếp qua background.js
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest',
        method,
        endpoint,
        data
        // Không gửi token - server trả về public data
      }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (resp?.success) {
          if (resp.meta) {
            resolve({ data: resp.data, meta: resp.meta });
          } else {
            resolve(resp.data);
          }
        } else {
          reject(new Error(resp?.error?.message || (window.I18n?.t('templates.apiError') || 'Lỗi API')));
        }
      });
    });
  }

  /**
   * Load danh sách categories từ API
   */
  async loadCategories() {
    // Local mode: server-only feature — render empty quietly, no API call, no error log.
    if (self.SEOSONA_LOCAL_MODE !== false) {
      this.categories = [];
      const select = this.container.querySelector('#templateCategoryFilter');
      if (select) {
        select.innerHTML = `<option value="">${window.I18n?.t('common.all') || 'Tất cả'}</option>`;
      }
      return;
    }
    try {
      // Kiểm tra feature có được bật không (từ plan hoặc trial)
      if (window.featureGate && !window.featureGate.canUsePromptTemplates()) {
        console.log('[SEOSONA Flow] TemplatesTab: Feature prompt_templates disabled, bỏ qua load categories');
        return;
      }

      const response = await this._apiCall('GET', 'templates/categories');
      this.categories = Array.isArray(response) ? response : (Array.isArray(response?.data) ? response.data : []);

      const select = this.container.querySelector('#templateCategoryFilter');
      if (select) {
        select.innerHTML = `<option value="">${window.I18n?.t('common.all') || 'Tất cả'}</option>`;
        this.categories.forEach(cat => {
          const option = document.createElement('option');
          option.value = cat.id;
          option.textContent = cat.name;
          select.appendChild(option);
        });
      }

      console.log('[SEOSONA Flow] TemplatesTab: Đã tải', this.categories.length, 'danh mục');
    } catch (err) {
      console.error('[SEOSONA Flow] TemplatesTab: Lỗi tải danh mục', err.message);
    }
  }

  /**
   * Load templates từ API với filters + phân trang
   */
  async loadTemplates(append = false) {
    if (this.isLoading) return;

    // Local mode: server-only feature — render empty quietly, no API call, no error log.
    if (self.SEOSONA_LOCAL_MODE !== false) {
      this.templates = [];
      this.totalPages = 1;
      this._renderGrid(false);
      const loadMoreLocal = this.container.querySelector('#templatesLoadMore');
      if (loadMoreLocal) loadMoreLocal.classList.add('hidden');
      return;
    }

    this.isLoading = true;

    const grid = this.container.querySelector('#templatesGrid');
    const loadMoreSection = this.container.querySelector('#templatesLoadMore');

    if (!append && grid) {
      grid.innerHTML = `<div class="seosonaflow-templates-loading">${window.I18n?.t('common.loading') || 'Đang tải...'}</div>`;
    }

    try {
      // Kiểm tra feature có được bật không (từ plan hoặc trial)
      if (window.featureGate && !window.featureGate.canUsePromptTemplates()) {
        // Module-blocked-overlay đã handle UI, chỉ cần không load data
        console.log('[SEOSONA Flow] TemplatesTab: Feature prompt_templates disabled');
        this.isLoading = false;
        return;
      }

      // Xây dựng query params
      const params = new URLSearchParams();
      params.append('page', this.currentPage);

      if (this.filters.category_id) params.append('category_id', this.filters.category_id);
      if (this.filters.label) params.append('label', this.filters.label);
      if (this.filters.difficulty) params.append('difficulty', this.filters.difficulty);
      if (this.filters.media_type) params.append('media_type', this.filters.media_type);
      if (this.filters.search) params.append('search', this.filters.search);
      if (this.filters.is_premium !== '') params.append('is_premium', this.filters.is_premium);

      const endpoint = 'templates?' + params.toString();
      const response = await this._apiCall('GET', endpoint);

      // _apiCall trả về { data, meta } khi có phân trang, hoặc array trực tiếp
      const newTemplates = Array.isArray(response) ? response : (Array.isArray(response?.data) ? response.data : []);
      this.totalPages = response.meta?.last_page || 1;

      if (append) {
        this.templates = this.templates.concat(newTemplates);
      } else {
        this.templates = newTemplates;
      }

      this._renderGrid(append);

      // Hiện/ẩn nút tải thêm
      if (loadMoreSection) {
        if (this.currentPage < this.totalPages) {
          loadMoreSection.classList.remove('hidden');
        } else {
          loadMoreSection.classList.add('hidden');
        }
      }

      console.log('[SEOSONA Flow] TemplatesTab: Đã tải', newTemplates.length, 'templates, trang', this.currentPage, '/', this.totalPages);
    } catch (err) {
      console.error('[SEOSONA Flow] TemplatesTab: Lỗi tải templates:', err.message);
      if (!append && grid) {
        const isAuthError = err.message?.includes('đăng nhập') || err.message?.includes('hết hạn');
        const isNetworkError = err.message?.includes('kết nối') || err.message?.includes('NETWORK') || err.message?.includes('Failed to fetch');
        let errorMsg = window.I18n?.t('templates.loadError') || 'Lỗi tải templates. Vui lòng thử lại.';
        if (isAuthError) {
          errorMsg = window.I18n?.t('templates.authError') || 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.';
        } else if (isNetworkError) {
          errorMsg = window.I18n?.t('templates.networkError') || 'Không thể kết nối đến server. Kiểm tra backend đang chạy (make up).';
        }
        grid.innerHTML = `<div class="seosonaflow-templates-empty">${errorMsg}<br><small style="opacity:0.5;margin-top:4px;display:block;">${err.message || ''}</small></div>`;
      }
    } finally {
      this.isLoading = false;
    }
  }

  _renderGrid(append = false) {
    const grid = this.container.querySelector('#templatesGrid');
    if (!grid) return;

    if (this.templates.length === 0) {
      grid.innerHTML = `<div class="seosonaflow-templates-empty">${window.I18n?.t('templates.noTemplatesFound') || 'Không tìm thấy template nào'}</div>`;
      this._renderedCount = 0;
      return;
    }

    if (!append) {
      const visibleIds = new Set(this.templates.map(t => String(t.id)));
      this._cardCache.forEach((el, tid) => {
        if (visibleIds.has(tid)) {
          el.style.display = '';
        } else {
          el.style.display = 'none';
        }
      });

      grid.innerHTML = '';
      this._renderedCount = 0;
    }

    this._renderNextBatch();
  }

  _renderNextBatch() {
    const grid = this.container.querySelector('#templatesGrid');
    if (!grid) return;

    const end = Math.min(this._renderedCount + this._renderBatchSize, this.templates.length);
    const fragment = document.createDocumentFragment();

    for (let i = this._renderedCount; i < end; i++) {
      const template = this.templates[i];
      const card = this._getOrCreateCard(template);
      card.style.display = '';
      if (!card.parentNode || card.parentNode !== grid) {
        fragment.appendChild(card);
      }
    }

    grid.appendChild(fragment);
    this._renderedCount = end;
  }

  _onGridScroll() {
    if (this._renderedCount >= this.templates.length) return;

    const grid = this.container.querySelector('#templatesGrid');
    if (!grid) return;

    const scrollParent = grid.closest('.seosonaflow-templates-tab') || grid.parentElement;
    if (!scrollParent) return;

    const threshold = 150;
    const nearBottom = scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight < threshold;

    if (nearBottom) {
      this._renderNextBatch();
    }
  }

  /**
   * Sử dụng template: load chi tiết rồi fill vào prompt editor
   */
  async _useTemplate(templateId) {
    try {
      // Endpoint POST /templates/{id}/use yêu cầu auth (auth:sanctum). Anonymous user
      // gọi sẽ nhận 401 Unauthenticated → show modal login thay vì lỗi silent.
      if (!true) {
        if (window.featureGate?.showLoginPrompt) {
          await window.featureGate.showLoginPrompt(
            window.I18n?.t('templates.requireLoginToUse') || 'Sử dụng prompt template yêu cầu đăng nhập'
          );
        } else {
          await window.customDialog?.alert(
            window.I18n?.t('templates.requireLoginToUse') || 'Sử dụng prompt template yêu cầu đăng nhập',
            { title: window.I18n?.t('featuregate.loginRequiredTitle') || 'Yêu cầu đăng nhập', type: 'warning' }
          );
        }
        return;
      }

      console.log('[SEOSONA Flow] TemplatesTab: Đang tải template', templateId);
      // UA-3.4: Theo doi su dung template
      window.UsageSync?.trackEvent('template_use', { template_id: templateId });

      const response = await this._apiCall('POST', `templates/${templateId}/use`);
      const template = response.data || response;

      // Fill prompt vào textarea — sử dụng content (DB field) thay vì prompt_content
      const promptsArea = document.getElementById('promptsArea');
      const promptContent = template.content || template.prompt_content || '';
      if (promptsArea && promptContent) {
        promptsArea.value = promptContent;
        promptsArea.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Áp dụng settings nếu có
      if (typeof applySettings === 'function') {
        const genType = template.media_type || null;
        const aspectRatio = template.ratio || template.aspect_ratio || null;
        const modelName = template.model || null;
        if (genType || aspectRatio || modelName) {
          await applySettings(genType, aspectRatio, modelName);
        }
      }

      // Hiển thị hướng dẫn template bên dưới textarea
      this._showTemplateGuide(template);

      // Load ref_image_urls nếu có
      if (template.ref_image_urls && Array.isArray(template.ref_image_urls) && template.ref_image_urls.length > 0) {
        await this._loadTemplateRefImages(template.ref_image_urls);
      } else if (template.ref_file_count && template.ref_file_count > 0) {
        if (typeof sendLog === 'function') {
          sendLog(window.I18n?.t('templates.refImageRequired', { count: template.ref_file_count }) || `Template cần ${template.ref_file_count} ảnh tham chiếu. Vui lòng thêm ảnh trước khi tạo.`, 'info');
        }
      }

      // Emit event để các module khác có thể phản ứng
      if (window.eventBus) {
        window.eventBus.emit('template:selected', { template, refImageUrls: template.ref_image_urls || [] });
      }

      console.log('[SEOSONA Flow] TemplatesTab: Đã áp dụng template', template.title);
      window.showNotification?.(window.I18n?.t('templates.templateApplied') || 'Template đã áp dụng', 'success');

      // Chuyển sang tab Gen (Tier-1 Part C: router API thay synthetic-click)
      window.SidebarManager?.switchTo?.('tab-gen');

      // Scroll đến prompt area
      if (promptsArea) {
        promptsArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (err) {
      console.error('[SEOSONA Flow] TemplatesTab: Lỗi sử dụng template', templateId, err.message);
      if (typeof sendLog === 'function') {
        sendLog((window.I18n?.t('templates.loadTemplateError') || 'Lỗi tải template: ') + err.message, 'error');
      }
    }
  }

  /**
   * Hiển thị hướng dẫn template bên dưới prompt textarea
   */
  _showTemplateGuide(template) {
    // Xóa guide cũ nếu có
    const existingGuide = document.getElementById('templateGuide');
    if (existingGuide) {
      existingGuide.remove();
    }

    // Build upload guide HTML (highlighted box) - nổi bật nhất
    let uploadGuideHtml = '';
    if (template.ref_file_count && template.ref_file_count > 0) {
      const uploadItems = this._parseRefFileDescription(template.ref_file_description, template.ref_file_count);
      const hasNumberPrefix = uploadItems.some(item => /^(Ảnh\s*\d+\s*:|^\d+[.):])/.test(item));

      uploadGuideHtml = `
        <div class="seosonaflow-template-guide__upload-box">
          <div class="seosonaflow-template-guide__upload-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            <span>${window.I18n?.t('templates.uploadRequired') || 'Cần upload'} <strong>${template.ref_file_count}</strong> ${window.I18n?.t('templates.refImages') || 'ảnh tham chiếu'}</span>
          </div>
          <div class="seosonaflow-template-guide__upload-list">
            ${uploadItems.map((item, idx) =>
              `<div class="seosonaflow-template-guide__upload-item">${hasNumberPrefix ? '' : `<span class="seosonaflow-template-guide__upload-num">${idx + 1}</span>`}<span>${this._escapeHtml(item)}</span></div>`
            ).join('')}
          </div>
        </div>
      `;
    }

    // Build difficulty badge HTML
    const diffConfig = template.difficulty ? this._getDifficultyConfig(template.difficulty) : null;
    let difficultyHtml = '';
    if (diffConfig) {
      difficultyHtml = `
        <span class="seosonaflow-template-guide__difficulty seosonaflow-template-guide__difficulty--${template.difficulty}">
          ${diffConfig.icon}
          <span>${diffConfig.label}</span>
        </span>
      `;
    }

    // Build description HTML (compact)
    let descriptionHtml = '';
    if (template.description) {
      descriptionHtml = `<p class="seosonaflow-template-guide__desc">${this._escapeHtml(template.description)}</p>`;
    }

    if (!template.description && !uploadGuideHtml && !diffConfig) return;

    // Tạo guide element
    const guideDiv = document.createElement('div');
    guideDiv.id = 'templateGuide';
    guideDiv.className = 'seosonaflow-template-guide';

    // Interactive rating
    const interactiveRatingHtml = this._renderInteractiveRating(template.id);

    guideDiv.innerHTML = `
      <div class="seosonaflow-template-guide__header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
        <span>${this._escapeHtml(template.title)}</span>
        <button class="seosonaflow-template-guide__close" id="templateGuideClose" title="${window.I18n?.t('common.close') || 'Đóng'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      ${uploadGuideHtml}
      ${descriptionHtml}
      <div class="seosonaflow-template-guide__footer">
        ${difficultyHtml}
        ${interactiveRatingHtml}
      </div>
    `;

    // Chèn sau promptsArea
    const promptsArea = document.getElementById('promptsArea');
    if (promptsArea && promptsArea.parentNode) {
      promptsArea.parentNode.insertBefore(guideDiv, promptsArea.nextSibling);
    }

    // Nút đóng guide
    const closeBtn = guideDiv.querySelector('#templateGuideClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => guideDiv.remove());
    }

    // Bind interactive rating events
    this._bindInteractiveRating(guideDiv, template.id);
  }

  /**
   * Bind interactive rating star events
   */
  _bindInteractiveRating(container, templateId) {
    const starsContainer = container.querySelector('.seosonaflow-template-rating-interactive__stars');
    if (!starsContainer) return;

    const starSpans = starsContainer.querySelectorAll('.seosonaflow-star-interactive');

    // Hover highlight
    starSpans.forEach((span, idx) => {
      span.addEventListener('mouseenter', () => {
        starSpans.forEach((s, i) => {
          const svgEl = s.querySelector('svg');
          if (i <= idx) {
            svgEl.setAttribute('fill', '#f59e0b');
            svgEl.setAttribute('stroke', '#f59e0b');
            svgEl.classList.add('seosonaflow-star--filled');
            svgEl.classList.remove('seosonaflow-star--empty');
          } else {
            svgEl.setAttribute('fill', 'none');
            svgEl.setAttribute('stroke', '#888');
            svgEl.classList.remove('seosonaflow-star--filled');
            svgEl.classList.add('seosonaflow-star--empty');
          }
        });
      });

      span.addEventListener('click', () => {
        const rating = parseInt(span.dataset.rating, 10);
        this._rateTemplate(templateId, rating, starsContainer);
      });
    });

    // Reset on mouse leave
    starsContainer.addEventListener('mouseleave', () => {
      starSpans.forEach(s => {
        const svgEl = s.querySelector('svg');
        if (!s.classList.contains('seosonaflow-star-interactive--selected')) {
          svgEl.setAttribute('fill', 'none');
          svgEl.setAttribute('stroke', '#888');
          svgEl.classList.remove('seosonaflow-star--filled');
          svgEl.classList.add('seosonaflow-star--empty');
        }
      });
    });
  }

  /**
   * Gửi đánh giá template lên server
   */
  async _rateTemplate(templateId, rating, starsContainer) {
    try {
      console.log('[SEOSONA Flow] TemplatesTab: Đánh giá template', templateId, 'sao', rating);

      const response = await this._apiCall('POST', `templates/${templateId}/rate`, { rating });
      const data = response.data || response;

      // Đánh dấu các sao đã chọn
      if (starsContainer) {
        const starSpans = starsContainer.querySelectorAll('.seosonaflow-star-interactive');
        starSpans.forEach((s, i) => {
          const svgEl = s.querySelector('svg');
          if (i < rating) {
            svgEl.setAttribute('fill', '#f59e0b');
            svgEl.setAttribute('stroke', '#f59e0b');
            svgEl.classList.add('seosonaflow-star--filled');
            svgEl.classList.remove('seosonaflow-star--empty');
            s.classList.add('seosonaflow-star-interactive--selected');
          } else {
            svgEl.setAttribute('fill', 'none');
            svgEl.setAttribute('stroke', '#888');
            svgEl.classList.remove('seosonaflow-star--filled');
            svgEl.classList.add('seosonaflow-star--empty');
            s.classList.remove('seosonaflow-star-interactive--selected');
          }
        });
      }

      const card = this.container.querySelector(`.seosonaflow-template-card[data-template-id="${templateId}"]`);
      if (card && data.avg_rating !== undefined) {
        const ratingEl = card.querySelector('.seosonaflow-template-rating');
        if (ratingEl) {
          ratingEl.outerHTML = this._renderRatingDisplay(data.avg_rating, data.ratings_count);
        }

        const tpl = this.templates.find(t => String(t.id) === String(templateId));
        if (tpl) {
          tpl.avg_rating = data.avg_rating;
          tpl.ratings_count = data.ratings_count;
          this._cardCache.delete(String(templateId));
        }
      }

      if (typeof sendLog === 'function') {
        sendLog(window.I18n?.t('templates.ratedTemplate', { rating }) || `Đã đánh giá ${rating} sao cho template`, 'info');
      }

      console.log('[SEOSONA Flow] TemplatesTab: Đã đánh giá template', templateId, '-> avg:', data.avg_rating);
    } catch (err) {
      console.error('[SEOSONA Flow] TemplatesTab: Lỗi đánh giá template', templateId, err.message);
      if (typeof sendLog === 'function') {
        sendLog((window.I18n?.t('templates.rateError') || 'Lỗi gửi đánh giá: ') + err.message, 'error');
      }
    }
  }

  bindEvents() {
    const refreshBtn = this.container.querySelector('#templateRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.reload());
    }

    const searchInput = this.container.querySelector('#templateSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
          this.filters.search = searchInput.value.trim();
          this.currentPage = 1;
          this._cardCache.clear();
          this.loadTemplates();
        }, 400);
      });
    }

    const categoryFilter = this.container.querySelector('#templateCategoryFilter');
    if (categoryFilter) {
      categoryFilter.addEventListener('change', () => {
        this.filters.category_id = categoryFilter.value;
        this.currentPage = 1;
        this._cardCache.clear();
        this.loadTemplates();
      });
    }

    const mediaFilter = this.container.querySelector('#templateMediaFilter');
    if (mediaFilter) {
      mediaFilter.addEventListener('change', () => {
        this.filters.media_type = mediaFilter.value;
        this.currentPage = 1;
        this._cardCache.clear();
        this.loadTemplates();
      });
    }

    const difficultyFilter = this.container.querySelector('#templateDifficultyFilter');
    if (difficultyFilter) {
      difficultyFilter.addEventListener('change', () => {
        this.filters.difficulty = difficultyFilter.value;
        this.currentPage = 1;
        this._cardCache.clear();
        this.loadTemplates();
      });
    }

    const labelBtns = this.container.querySelectorAll('.seosonaflow-templates-label-btn');
    labelBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const label = btn.dataset.label;

        if (this.filters.label === label) {
          this.filters.label = '';
          btn.classList.remove('active');
        } else {
          labelBtns.forEach(b => b.classList.remove('active'));
          this.filters.label = label;
          btn.classList.add('active');
        }

        this.currentPage = 1;
        this._cardCache.clear();
        this.loadTemplates();
      });
    });

    const premiumFilter = this.container.querySelector('#templatePremiumFilter');
    if (premiumFilter) {
      premiumFilter.addEventListener('change', () => {
        this.filters.is_premium = premiumFilter.value;
        this.currentPage = 1;
        this._cardCache.clear();
        this.loadTemplates();
      });
    }

    const grid = this.container.querySelector('#templatesGrid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        const useBtn = e.target.closest('.seosonaflow-template-use-btn');
        if (useBtn) {
          e.stopPropagation();
          const templateId = useBtn.dataset.templateId;
          if (templateId) {
            this._useTemplate(templateId);
          }
          return;
        }

        const card = e.target.closest('.seosonaflow-template-card');
        if (card) {
          if (card.classList.contains('seosonaflow-template-card--locked')) {
            if (typeof sendLog === 'function') {
              sendLog(window.I18n?.t('templates.premiumRequired') || 'Template này dành cho Premium. Nâng cấp để sử dụng.', 'warn');
            }
            return;
          }
          const templateId = card.dataset.templateId;
          if (templateId) {
            this._useTemplate(templateId);
          }
        }
      });
    }

    const scrollParent = this.container.querySelector('.seosonaflow-templates-tab') || this.container;
    if (scrollParent) {
      scrollParent.addEventListener('scroll', () => {
        if (this._scrollThrottleTimer) return;
        this._scrollThrottleTimer = setTimeout(() => {
          this._scrollThrottleTimer = null;
          this._onGridScroll();
        }, 100);
      }, { passive: true });
    }

    const loadMoreBtn = this.container.querySelector('#loadMoreTemplatesBtn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        this.currentPage++;
        this.loadTemplates(true);
      });
    }
  }

  // ===== Helpers =====

  /**
   * Parse labels từ template data
   */
  _parseLabels(template) {
    const labels = [];

    // Từ JSON labels field
    if (template.labels && Array.isArray(template.labels)) {
      template.labels.forEach(l => {
        const labelMap = {
          trending: window.I18n?.t('templates.trending') || 'Xu hướng',
          new: window.I18n?.t('templates.new') || 'Mới',
          featured: window.I18n?.t('templates.featured') || 'Nổi bật',
          popular: window.I18n?.t('templates.popular') || 'Phổ biến'
        };
        if (labelMap[l]) {
          labels.push({ key: l, text: labelMap[l] });
        }
      });
    }

    // Từ boolean fields
    if (template.is_trending && !labels.find(l => l.key === 'trending')) {
      labels.push({ key: 'trending', text: window.I18n?.t('templates.trending') || 'Xu hướng' });
    }
    if (template.is_new && !labels.find(l => l.key === 'new')) {
      labels.push({ key: 'new', text: window.I18n?.t('templates.new') || 'Mới' });
    }
    if (template.is_featured && !labels.find(l => l.key === 'featured')) {
      labels.push({ key: 'featured', text: window.I18n?.t('templates.featured') || 'Nổi bật' });
    }
    // Premium badge handled separately in _renderCardHtml

    return labels;
  }

  /**
   * Chuyển mã difficulty sang tiếng Việt
   */
  _getDifficultyText(difficulty) {
    const map = {
      easy: window.I18n?.t('templates.difficultyEasyShort') || 'Dễ',
      medium: window.I18n?.t('templates.difficultyMediumShort') || 'TB',
      advanced: window.I18n?.t('templates.difficultyAdvancedShort') || 'Nâng cao'
    };
    return map[difficulty] || '';
  }

  /**
   * Escape HTML để tránh XSS
   */
  _escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Parse ref_file_description thành list items
   * Input format: "Ảnh 1: mô tả 1 + Ảnh 2: mô tả 2" hoặc đơn giản "ảnh thumbnail"
   * Giữ nguyên text từ backend, chỉ split theo "+" để format đẹp hơn
   */
  _parseRefFileDescription(description, count) {
    if (!description) {
      const defaultItems = [];
      for (let i = 1; i <= count; i++) {
        defaultItems.push(`${window.I18n?.t('templates.refImage') || 'Ảnh tham chiếu'} ${i}`);
      }
      return defaultItems;
    }

    // Split theo "+" để tạo list (giữ nguyên text gốc)
    const parts = description.split(/\s*\+\s*/).map(p => p.trim()).filter(Boolean);

    if (parts.length > 0) {
      return parts;
    }

    // Fallback: single item
    return [description];
  }

  /**
   * Get difficulty badge config (label + icon)
   */
  _getDifficultyConfig(difficulty) {
    const configs = {
      easy: {
        label: window.I18n?.t('templates.difficultyEasy') || 'Dễ',
        icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>'
      },
      medium: {
        label: window.I18n?.t('templates.difficultyMedium') || 'Trung bình',
        icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>'
      },
      advanced: {
        label: window.I18n?.t('templates.difficultyAdvanced') || 'Nâng cao',
        icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 15,8 22,9 17,14 18,21 12,18 6,21 7,14 2,9 9,8"/></svg>'
      }
    };
    return configs[difficulty] || configs.easy;
  }

  /**
   * Load ref_image_urls từ template vào GenTab
   * Fetch từ CDN → store pendingUploadFiles → ImmediateUploader upload
   */
  async _loadTemplateRefImages(refImageUrls) {
    if (!refImageUrls || !Array.isArray(refImageUrls) || refImageUrls.length === 0) {
      return;
    }

    console.log('[SEOSONA Flow] TemplatesTab: Đang load', refImageUrls.length, 'ref images từ template');

    // Clear existing ref images từ GenTab trước khi load mới
    this._clearGenTabRefImages();

    // Ensure pendingUploadFiles Map exists
    if (!window.pendingUploadFiles) {
      window.pendingUploadFiles = new Map();
    }

    const timestamp = Date.now();
    const newFileIds = [];

    for (let i = 0; i < refImageUrls.length; i++) {
      const url = refImageUrls[i];
      if (!url || typeof url !== 'string') continue;

      try {
        // Generate unique key
        const key = `upload_template_${timestamp}_${i}`;

        // Fetch blob via background.js (bypass CORS)
        const blob = await this._fetchBlobViaBackground(url);
        if (!blob) {
          console.warn('[SEOSONA Flow] TemplatesTab: Không thể fetch blob từ', url);
          continue;
        }

        // Create File object
        const ext = this._getExtensionFromUrl(url) || 'jpg';
        const fileName = `template_ref_${i + 1}.${ext}`;
        const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });

        // Phase: Defer upload — store ở pendingUploadFiles dạng { file, thumbnail } để
        // - Provider Flow: uploadPendingFiles() upload lên Flow khi user click Generate
        // - Provider ChatGPT: _submitViaChatGPT fetch base64 từ thumbnail URL khi submit
        // → KHÔNG trigger ImmediateUploader ngay (tránh upload Flow không cần thiết khi user
        //   định submit ChatGPT — Use Template không biết user sẽ chọn provider nào)
        window.pendingUploadFiles.set(key, { file, thumbnail: url });

        // Cache thumbnail URL — dùng cho preview + ChatGPT fetchBlob khi submit (Tier-1 C-2: qua API)
        window.GenTab?.setRefImageMeta(key, { thumbnail: url });

        newFileIds.push(key);

        console.log('[SEOSONA Flow] TemplatesTab: Đã load ref image (deferred)', i + 1, 'với key', key);
      } catch (err) {
        console.error('[SEOSONA Flow] TemplatesTab: Lỗi load ref image', i, err.message);
      }
    }

    // Update GenTab.fileIdsInput nếu có
    if (newFileIds.length > 0) {
      const fileIdsInput = document.getElementById('fileIds');
      if (fileIdsInput) {
        // Set giá trị mới (không merge với cũ vì đã clear trước đó)
        fileIdsInput.value = newFileIds.join(', ');
        // GenTab listen 'input' event, không phải 'change'
        fileIdsInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Emit event để GenTab cập nhật preview
      if (window.eventBus) {
        window.eventBus.emit('template:refImagesLoaded', { keys: newFileIds });
      }

      if (typeof sendLog === 'function') {
        sendLog(window.I18n?.t('templates.refImagesLoaded', { count: newFileIds.length }) || `Đã load ${newFileIds.length} ảnh tham chiếu từ template (sẽ upload khi click Tạo)`, 'info');
      }
    }

    console.log('[SEOSONA Flow] TemplatesTab: Hoàn tất load (deferred upload)', newFileIds.length, 'ref images');
  }

  /**
   * Fetch blob qua background.js để bypass CORS
   */
  async _fetchBlobViaBackground(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'fetchBlob',
        url: url
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[SEOSONA Flow] TemplatesTab: fetchBlob error', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        if (response && response.success && response.base64) {
          // Convert base64 to Blob
          try {
            const byteChars = atob(response.base64);
            const byteNumbers = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
              byteNumbers[i] = byteChars.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: response.mimeType || 'image/jpeg' });
            resolve(blob);
          } catch (err) {
            console.error('[SEOSONA Flow] TemplatesTab: base64 decode error', err.message);
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Clear existing ref images từ GenTab trước khi load template
   */
  _clearGenTabRefImages() {
    // Clear fileIds input
    const fileIdsInput = document.getElementById('fileIds');
    if (fileIdsInput && fileIdsInput.value) {
      // Cancel any pending uploads
      const oldIds = (fileIdsInput.value || '').split(',').map(s => s.trim()).filter(Boolean);
      if (window.ImmediateUploader && oldIds.length > 0) {
        for (const id of oldIds) {
          if (id.startsWith('upload_')) {
            window.ImmediateUploader.cancel(id);
          }
        }
      }

      // Clear pendingUploadFiles
      if (window.pendingUploadFiles) {
        for (const id of oldIds) {
          if (window.pendingUploadFiles.has(id)) {
            window.pendingUploadFiles.delete(id);
          }
        }
      }

      // Clear GenTab caches (Tier-1 C-2: qua API — xoá thumbnail+fileName cho oldIds)
      window.GenTab?.clearRefImageMeta(oldIds);

      // Clear input value
      fileIdsInput.value = '';
      fileIdsInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    console.log('[SEOSONA Flow] TemplatesTab: Đã clear ref images cũ trong GenTab');
  }

  /**
   * Lấy extension từ URL
   */
  _getExtensionFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
      if (match) {
        return match[1].toLowerCase();
      }
    } catch (e) {
      // Ignore
    }
    return 'jpg';
  }

  /**
   * Tạo thumbnail blob từ image blob (resize to max 200x200)
   */
  async _createThumbnailBlob(blob) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        const maxSize = 200;
        let w = img.width;
        let h = img.height;

        if (w > maxSize || h > maxSize) {
          if (w > h) {
            h = Math.round(h * maxSize / w);
            w = maxSize;
          } else {
            w = Math.round(w * maxSize / h);
            h = maxSize;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        canvas.toBlob((thumbBlob) => {
          resolve(thumbBlob);
        }, 'image/jpeg', 0.8);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(blob); // Fallback: return original blob
      };

      img.src = url;
    });
  }
}

window.TemplatesTab = TemplatesTab;
