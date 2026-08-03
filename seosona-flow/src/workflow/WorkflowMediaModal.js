/**
 * WorkflowMediaModal - Modal upload và browse ảnh cho workflow templates
 *
 * Cho phép admin:
 * 1. Upload ảnh mới lên server (tab "Tải lên")
 * 2. Browse và chọn ảnh đã upload (tab "Thư viện")
 *
 * Khác với ImmediateUploader (upload lên Flow), modal này upload lên backend storage.
 *
 * Sử dụng:
 * WorkflowMediaModal.show({
 *   type: 'ref_image', // hoặc 'thumbnail'
 *   multiple: true,    // cho phép chọn nhiều ảnh
 *   onSelect: (urls) => { ... }
 * });
 */
class WorkflowMediaModal {
  static _instance = null;
  static _uploadedUrls = [];
  static _selectedUrls = [];
  static _libraryImages = [];
  static _libraryPage = 1;
  static _libraryHasMore = false;
  static _libraryLoading = false;
  static _activeTab = 'upload'; // 'upload' hoặc 'library'
  static _isUploading = false; // Lock để tránh race condition

  /**
   * Hiển thị modal upload media
   * @param {Object} options - Cấu hình modal
   * @param {string} options.type - Loại media: 'thumbnail' hoặc 'ref_image'
   * @param {boolean} options.multiple - Cho phép chọn nhiều ảnh
   * @param {Function} options.onSelect - Callback khi chọn xong
   * @param {Function} options.onCancel - Callback khi hủy
   */
  static show(options = {}) {
    const { type = 'ref_image', multiple = false, onSelect = null, onCancel = null, preselected = [] } = options;
    // [Creator Page] Affiliate sửa community template → upload + list qua sandbox creator-templates
    // (không có quyền admin/media). Default admin endpoint.
    this._uploadEndpoint = options.uploadEndpoint || 'admin/media/upload';
    this._listEndpoint = options.listEndpoint || 'admin/media/list'; // list ảnh của chính affiliate

    // Đóng modal cũ nếu có
    this._close();

    // Reset state
    this._uploadedUrls = [];
    // Khởi tạo với preselected URLs nếu có
    this._selectedUrls = Array.isArray(preselected) ? [...preselected] : [];
    this._libraryImages = [];
    this._libraryPage = 1;
    this._libraryHasMore = false;
    this._libraryLoading = false;
    this._activeTab = 'upload';

    // Tạo modal
    const modal = this._createModal(type, multiple);
    document.body.appendChild(modal);
    this._instance = modal;

    // Bind events
    this._bindEvents(modal, { type, multiple, onSelect, onCancel });

    // Cập nhật nút confirm nếu có preselected items
    this._updateConfirmButton(modal);

    // Focus vào modal
    requestAnimationFrame(() => {
      modal.classList.add('visible');
    });
  }

  /**
   * Đóng modal
   */
  static _close() {
    if (this._instance) {
      this._instance.classList.remove('visible');
      setTimeout(() => {
        this._instance?.remove();
        this._instance = null;
      }, 200);
    }
  }

  /**
   * Tạo HTML cho modal
   */
  static _createModal(type, multiple) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;

    // Title dựa theo loại media
    let title;
    if (type === 'thumbnail') {
      title = t('workflow.mediaModal.selectThumbnail', 'Chọn Ảnh Thumbnail');
    } else if (type === 'result_image') {
      title = t('workflow.mediaModal.selectResultImage', 'Chọn Ảnh Kết Quả Mẫu');
    } else {
      title = t('workflow.mediaModal.selectRefImage', 'Chọn Ảnh Tham Chiếu');
    }

    const modal = document.createElement('div');
    modal.className = 'wf-media-modal';
    modal.innerHTML = `
      <div class="wf-media-modal-backdrop"></div>
      <div class="wf-media-modal-content wf-media-modal-with-tabs">
        <div class="wf-media-modal-header">
          <h3>${title}</h3>
          <button class="wf-media-modal-close" type="button" aria-label="${t('workflow.mediaModal.close', 'Đóng')}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <!-- Tabs -->
        <div class="wf-media-tabs">
          <button class="wf-media-tab active" data-tab="upload" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            ${t('workflow.mediaModal.tabUpload', 'Tải lên')}
          </button>
          <button class="wf-media-tab" data-tab="library" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </svg>
            ${t('workflow.mediaModal.tabLibrary', 'Thư viện')}
          </button>
        </div>

        <div class="wf-media-modal-body">
          <!-- Tab: Upload -->
          <div class="wf-media-tab-content" data-tab-content="upload">
            <!-- Vùng kéo thả upload -->
            <div class="wf-media-upload-zone" id="wfMediaDropZone">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 8h.01"></path>
                <path d="M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5"></path>
                <path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l3.5 3.5"></path>
                <path d="M14 14l1 -1c.679 -.653 1.473 -.829 2.214 -.526"></path>
                <path d="M19 22v-6"></path>
                <path d="M22 19l-3 -3l-3 3"></path>
              </svg>
              <p class="wf-media-upload-hint">${t('workflow.mediaModal.dragDrop', 'Kéo thả ảnh vào đây')}</p>
              <span class="wf-media-upload-or">${t('workflow.mediaModal.or', 'hoặc')}</span>
              <label class="wf-media-upload-btn">
                <input type="file"
                       accept="image/jpeg,image/png,image/gif,image/webp"
                       ${multiple ? 'multiple' : ''}
                       id="wfMediaFileInput" />
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
                ${t('workflow.mediaModal.selectFromComputer', 'Chọn từ máy tính')}
              </label>
              <p class="wf-media-upload-info">${t('workflow.mediaModal.supportedFormats', 'Hỗ trợ JPG, PNG, GIF, WebP. Tối đa 10MB mỗi ảnh.')}</p>
            </div>

            <!-- Thanh tiến trình upload -->
            <div class="wf-media-upload-progress hidden" id="wfMediaProgress">
              <div class="wf-media-progress-bar">
                <div class="wf-media-progress-fill" id="wfMediaProgressFill"></div>
              </div>
              <span class="wf-media-progress-text" id="wfMediaProgressText">${t('workflow.mediaModal.uploading', 'Đang tải lên...')}</span>
            </div>

            <!-- Thông báo lỗi -->
            <div class="wf-media-error hidden" id="wfMediaError">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span id="wfMediaErrorText"></span>
            </div>

            <!-- Grid preview ảnh đã upload -->
            <div class="wf-media-preview-section hidden" id="wfMediaPreviewSection">
              <div class="wf-media-preview-header">
                <span class="wf-media-preview-title">${t('workflow.mediaModal.uploadedImages', 'Ảnh đã tải lên')}</span>
                <span class="wf-media-preview-count" id="wfMediaPreviewCount">${t('workflow.mediaModal.imageCount', '0 ảnh').replace('{count}', '0')}</span>
              </div>
              <div class="wf-media-preview-grid" id="wfMediaPreviewGrid"></div>
            </div>
          </div>

          <!-- Tab: Library -->
          <div class="wf-media-tab-content hidden" data-tab-content="library">
            <!-- Loading state -->
            <div class="wf-media-library-loading" id="wfMediaLibraryLoading">
              <div class="wf-media-library-spinner"></div>
              <span>${t('workflow.mediaModal.loadingMedia', 'Đang tải...')}</span>
            </div>

            <!-- Empty state -->
            <div class="wf-media-library-empty hidden" id="wfMediaLibraryEmpty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <p>${t('workflow.mediaModal.noMediaYet', 'Chưa có ảnh nào')}</p>
            </div>

            <!-- Library grid -->
            <div class="wf-media-library-grid hidden" id="wfMediaLibraryGrid"></div>

            <!-- Load more button -->
            <div class="wf-media-library-loadmore hidden" id="wfMediaLibraryLoadMore">
              <button class="wf-media-loadmore-btn" type="button" id="wfMediaLoadMoreBtn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                ${t('workflow.mediaModal.loadMore', 'Tải thêm')}
              </button>
            </div>
          </div>
        </div>

        <div class="wf-media-modal-footer">
          <button class="btn btn-secondary wf-media-cancel" type="button">${t('workflow.mediaModal.cancel', 'Hủy')}</button>
          <button class="btn btn-primary wf-media-confirm" type="button" disabled id="wfMediaConfirmBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            ${multiple ? t('workflow.mediaModal.selectSelectedImages', 'Chọn ảnh đã chọn') : t('workflow.mediaModal.select', 'Chọn')}
          </button>
        </div>
      </div>
    `;

    return modal;
  }

  /**
   * Bind các sự kiện cho modal
   */
  static _bindEvents(modal, options) {
    const { type, multiple, onSelect, onCancel } = options;
    const dropZone = modal.querySelector('#wfMediaDropZone');
    const fileInput = modal.querySelector('#wfMediaFileInput');
    const closeBtn = modal.querySelector('.wf-media-modal-close');
    const cancelBtn = modal.querySelector('.wf-media-cancel');
    const confirmBtn = modal.querySelector('#wfMediaConfirmBtn');
    const backdrop = modal.querySelector('.wf-media-modal-backdrop');
    const loadMoreBtn = modal.querySelector('#wfMediaLoadMoreBtn');

    // Đóng modal
    const handleClose = () => {
      onCancel?.();
      this._close();
    };

    closeBtn?.addEventListener('click', handleClose);
    cancelBtn?.addEventListener('click', handleClose);
    backdrop?.addEventListener('click', handleClose);

    // ESC để đóng
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        handleClose();
        document.removeEventListener('keydown', handleKeydown);
      }
    };
    document.addEventListener('keydown', handleKeydown);

    // Tab switching
    const tabs = modal.querySelectorAll('.wf-media-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        this._switchTab(modal, tabName, type, multiple);
      });
    });

    // Drag & drop events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone?.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone?.addEventListener(eventName, () => {
        dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone?.addEventListener(eventName, () => {
        dropZone.classList.remove('drag-over');
      });
    });

    // Handle drop
    dropZone?.addEventListener('drop', async (e) => {
      const files = e.dataTransfer?.files;
      if (files?.length > 0) {
        await this._handleFiles(Array.from(files), type, multiple, modal);
      }
    });

    // Handle file input change
    fileInput?.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (files?.length > 0) {
        await this._handleFiles(Array.from(files), type, multiple, modal);
      }
      // Reset input để có thể chọn lại cùng file
      fileInput.value = '';
    });

    // Confirm button
    confirmBtn?.addEventListener('click', () => {
      if (this._selectedUrls.length > 0) {
        onSelect?.(multiple ? this._selectedUrls : this._selectedUrls[0]);
        this._close();
      }
    });

    // Preview grid click (chọn/bỏ chọn ảnh - tab Upload)
    const previewGrid = modal.querySelector('#wfMediaPreviewGrid');
    previewGrid?.addEventListener('click', (e) => {
      const item = e.target.closest('.wf-media-preview-item');
      if (!item) return;

      const url = item.dataset.url;
      if (!url) return;

      // Xử lý nút xóa
      if (e.target.closest('.wf-media-preview-remove')) {
        this._removeUploadedImage(url, modal);
        return;
      }

      // Toggle selection
      this._toggleImageSelection(url, item, multiple, modal);
    });

    // Library grid click (chọn/bỏ chọn ảnh - tab Library)
    const libraryGrid = modal.querySelector('#wfMediaLibraryGrid');
    libraryGrid?.addEventListener('click', (e) => {
      const item = e.target.closest('.wf-media-library-item');
      if (!item) return;

      const url = item.dataset.url;
      if (!url) return;

      // Toggle selection
      this._toggleImageSelection(url, item, multiple, modal);
    });

    // Load more button
    loadMoreBtn?.addEventListener('click', () => {
      this._loadMoreLibrary(modal, type, multiple);
    });
  }

  /**
   * Chuyển tab
   */
  static _switchTab(modal, tabName, type, multiple) {
    if (this._activeTab === tabName) return;

    this._activeTab = tabName;

    // Update tab buttons
    const tabs = modal.querySelectorAll('.wf-media-tab');
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab contents
    const contents = modal.querySelectorAll('.wf-media-tab-content');
    contents.forEach(content => {
      content.classList.toggle('hidden', content.dataset.tabContent !== tabName);
    });

    // Load library nếu chuyển sang tab library lần đầu
    if (tabName === 'library' && this._libraryImages.length === 0 && !this._libraryLoading) {
      this._loadLibrary(modal, type, multiple);
    }
  }

  /**
   * Toggle chọn/bỏ chọn ảnh
   */
  static _toggleImageSelection(url, item, multiple, modal) {
    if (multiple) {
      const index = this._selectedUrls.indexOf(url);
      if (index > -1) {
        this._selectedUrls.splice(index, 1);
        item.classList.remove('selected');
      } else {
        this._selectedUrls.push(url);
        item.classList.add('selected');
      }
    } else {
      // Single select: bỏ chọn tất cả, chỉ chọn ảnh này
      this._selectedUrls = [url];

      // Update cả upload preview và library grid
      modal.querySelectorAll('.wf-media-preview-item, .wf-media-library-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.url === url);
      });
    }

    this._updateConfirmButton(modal);
  }

  /**
   * Load thư viện ảnh từ server
   */
  static async _loadLibrary(modal, type, multiple) {
    if (this._libraryLoading) return;

    this._libraryLoading = true;
    this._libraryPage = 1;

    const loadingEl = modal.querySelector('#wfMediaLibraryLoading');
    const emptyEl = modal.querySelector('#wfMediaLibraryEmpty');
    const gridEl = modal.querySelector('#wfMediaLibraryGrid');
    const loadMoreEl = modal.querySelector('#wfMediaLibraryLoadMore');

    // Show loading
    loadingEl?.classList.remove('hidden');
    emptyEl?.classList.add('hidden');
    gridEl?.classList.add('hidden');
    loadMoreEl?.classList.add('hidden');

    try {
      const result = await this._fetchLibrary(type, 1);
      console.log('[WorkflowMediaModal] Library fetch result:', result);

      this._libraryImages = result.items || [];
      this._libraryHasMore = result.pagination?.has_more || false;

      // Hide loading
      loadingEl?.classList.add('hidden');

      if (this._libraryImages.length === 0) {
        // Show empty state
        console.log('[WorkflowMediaModal] Library empty - no items found');
        emptyEl?.classList.remove('hidden');
      } else {
        // Render grid
        gridEl?.classList.remove('hidden');
        this._renderLibraryGrid(modal, multiple);

        if (this._libraryHasMore) {
          loadMoreEl?.classList.remove('hidden');
        }
      }
    } catch (error) {
      console.error('[WorkflowMediaModal] Lỗi tải thư viện:', error);
      loadingEl?.classList.add('hidden');
      emptyEl?.classList.remove('hidden');
    } finally {
      this._libraryLoading = false;
    }
  }

  /**
   * Load thêm ảnh từ thư viện
   */
  static async _loadMoreLibrary(modal, type, multiple) {
    if (this._libraryLoading || !this._libraryHasMore) return;

    this._libraryLoading = true;
    this._libraryPage++;

    const loadMoreBtn = modal.querySelector('#wfMediaLoadMoreBtn');
    const t = (key, fallback) => window.I18n?.t(key) || fallback;

    // Show loading state on button
    if (loadMoreBtn) {
      loadMoreBtn.disabled = true;
      loadMoreBtn.innerHTML = `
        <div class="wf-media-library-spinner small"></div>
        ${t('workflow.mediaModal.loadingMedia', 'Đang tải...')}
      `;
    }

    try {
      const result = await this._fetchLibrary(type, this._libraryPage);

      const newItems = result.items || [];
      this._libraryImages = [...this._libraryImages, ...newItems];
      this._libraryHasMore = result.pagination?.has_more || false;

      // Re-render grid
      this._renderLibraryGrid(modal, multiple);

      // Update load more button
      if (!this._libraryHasMore) {
        modal.querySelector('#wfMediaLibraryLoadMore')?.classList.add('hidden');
      }
    } catch (error) {
      console.error('[WorkflowMediaModal] Lỗi tải thêm:', error);
      this._libraryPage--; // Rollback page number
    } finally {
      this._libraryLoading = false;

      // Restore button
      if (loadMoreBtn) {
        loadMoreBtn.disabled = false;
        loadMoreBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          ${t('workflow.mediaModal.loadMore', 'Tải thêm')}
        `;
      }
    }
  }

  /**
   * Fetch library từ API
   */
  static async _fetchLibrary(type, page) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    // Đồng bộ: result_image dùng chung folder với thumbnail
    const apiType = (type === 'result_image') ? 'thumbnail' : type;
    const token = window.authManager?.getToken();

    console.log('[WorkflowMediaModal] Fetching library:', { type: apiType, page, hasToken: !!token });

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest',
        method: 'GET',
        endpoint: `${this._listEndpoint || 'admin/media/list'}?type=${apiType}&page=${page}&per_page=20`,
        token: token
      }, response => {
        console.log('[WorkflowMediaModal] API response:', response);

        if (chrome.runtime.lastError) {
          console.error('[WorkflowMediaModal] Chrome runtime error:', chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message || t('workflow.mediaModal.connectionError', 'Lỗi kết nối')));
          return;
        }

        if (!response) {
          console.error('[WorkflowMediaModal] No response received');
          reject(new Error(t('workflow.mediaModal.noResponse', 'Không nhận được phản hồi từ server')));
          return;
        }

        if (response.success) {
          console.log('[WorkflowMediaModal] Success, items count:', response.data?.items?.length || 0);
          resolve(response.data || { items: [], pagination: {} });
        } else {
          console.error('[WorkflowMediaModal] API error:', response.error);
          reject(new Error(response.error?.message || t('workflow.mediaModal.loadError', 'Lỗi tải thư viện')));
        }
      });
    });
  }

  /**
   * Render library grid
   */
  static _renderLibraryGrid(modal, multiple) {
    const grid = modal.querySelector('#wfMediaLibraryGrid');
    if (!grid) return;

    grid.innerHTML = this._libraryImages.map(img => {
      const isSelected = this._selectedUrls.includes(img.url);
      return `
        <div class="wf-media-library-item ${isSelected ? 'selected' : ''}" data-url="${this._escapeHtml(img.url)}">
          <img src="${this._escapeHtml(img.url)}" alt="Library image" loading="lazy" />
          <div class="wf-media-library-overlay">
            <div class="wf-media-library-check">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Xử lý files đã chọn
   */
  static async _handleFiles(files, type, multiple, modal) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;

    // Prevent race condition - không cho upload khi đang upload
    if (this._isUploading) {
      return;
    }

    // Lọc chỉ lấy ảnh
    const imageFiles = files.filter(f => f.type.startsWith('image/'));

    if (imageFiles.length === 0) {
      this._showError(modal, t('workflow.mediaModal.invalidFileType', 'Vui lòng chọn file ảnh (JPG, PNG, GIF, WebP)'));
      return;
    }

    // Nếu không multiple, chỉ lấy file đầu tiên
    const filesToUpload = multiple ? imageFiles : [imageFiles[0]];

    // Kiểm tra kích thước (max 10MB mỗi file)
    const maxSize = 10 * 1024 * 1024;
    const oversizedFiles = filesToUpload.filter(f => f.size > maxSize);
    if (oversizedFiles.length > 0) {
      const fileNames = oversizedFiles.map(f => f.name).join(', ');
      const errorMsg = (t('workflow.mediaModal.fileTooLarge', 'Các file sau vượt quá 10MB: {files}')).replace('{files}', fileNames);
      this._showError(modal, errorMsg);
      return;
    }

    // Ẩn lỗi cũ
    this._hideError(modal);

    // Set upload lock và disable controls
    this._isUploading = true;
    this._setUploadControlsDisabled(modal, true);

    // Hiển thị progress
    const progressText = (t('workflow.mediaModal.uploadingProgress', 'Đang tải lên {current}/{total}...')).replace('{current}', '0').replace('{total}', filesToUpload.length);
    this._showProgress(modal, 0, progressText);

    let uploadedCount = 0;
    const errors = [];

    try {
      for (const file of filesToUpload) {
        try {
          const url = await this._uploadFile(file, type);
          this._uploadedUrls.push(url);

          // Tự động chọn ảnh vừa upload
          this._selectedUrls.push(url);

          uploadedCount++;
          const progress = (uploadedCount / filesToUpload.length) * 100;
          const progressMsg = (t('workflow.mediaModal.uploadingProgress', 'Đang tải lên {current}/{total}...')).replace('{current}', uploadedCount).replace('{total}', filesToUpload.length);
          this._showProgress(modal, progress, progressMsg);
        } catch (err) {
          console.error('[WorkflowMediaModal] Lỗi upload:', err);
          errors.push(`${file.name}: ${err.message}`);
        }
      }
    } finally {
      // Release upload lock và enable controls
      this._isUploading = false;
      this._setUploadControlsDisabled(modal, false);
    }

    // Ẩn progress
    this._hideProgress(modal);

    // Hiển thị lỗi nếu có
    if (errors.length > 0) {
      const errorMsg = (t('workflow.mediaModal.uploadError', 'Lỗi upload: {error}')).replace('{error}', errors.join(', '));
      this._showError(modal, errorMsg);
    }

    // Render preview grid
    this._renderPreviewGrid(modal);
    this._updateConfirmButton(modal);
  }

  /**
   * Enable/disable upload controls khi đang upload
   */
  static _setUploadControlsDisabled(modal, disabled) {
    const dropZone = modal.querySelector('.wf-media-dropzone');
    const fileInput = modal.querySelector('#wfMediaFileInput');
    const uploadLabel = modal.querySelector('.wf-media-upload-btn');

    if (dropZone) {
      dropZone.classList.toggle('disabled', disabled);
      dropZone.style.pointerEvents = disabled ? 'none' : '';
      dropZone.style.opacity = disabled ? '0.5' : '';
    }
    if (fileInput) {
      fileInput.disabled = disabled;
    }
    if (uploadLabel) {
      uploadLabel.classList.toggle('disabled', disabled);
      uploadLabel.style.pointerEvents = disabled ? 'none' : '';
      uploadLabel.style.opacity = disabled ? '0.5' : '';
    }
  }

  /**
   * Upload file lên server
   */
  static async _uploadFile(file, type) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;

    // Kiểm tra quyền admin
    if (!window.authManager?.canManageTemplates()) {
      throw new Error(t('workflow.mediaModal.adminRequired', 'Bạn cần quyền admin để upload ảnh'));
    }

    // Convert file sang base64 để gửi qua chrome.runtime.sendMessage
    // (FormData không serialize được qua message passing)
    const base64 = await this._fileToBase64(file);

    // Đồng bộ: result_image dùng chung folder với thumbnail
    const apiType = (type === 'result_image') ? 'thumbnail' : type;

    // Gọi API qua background.js (tránh CORS)
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest',
        method: 'POST',
        endpoint: this._uploadEndpoint || 'admin/media/upload',
        token: window.authManager?.getToken(),
        isFormData: true,
        formDataFields: {
          file: {
            name: file.name,
            type: file.type,
            base64: base64
          },
          type: apiType
        }
      }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || t('workflow.mediaModal.connectionError', 'Lỗi kết nối')));
          return;
        }

        if (!response) {
          reject(new Error(t('workflow.mediaModal.noResponse', 'Không nhận được phản hồi từ server')));
          return;
        }

        if (response.success) {
          const url = response.data?.url;
          if (url) {
            resolve(url);
          } else {
            reject(new Error(t('workflow.mediaModal.noUrlReturned', 'Server không trả về URL')));
          }
        } else {
          reject(new Error(response.error?.message || t('workflow.mediaModal.uploadError', 'Lỗi upload').replace('{error}', '')));
        }
      });
    });
  }

  /**
   * Convert File sang base64 string
   */
  static _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // reader.result là "data:image/png;base64,xxxxx"
        // Chỉ lấy phần base64 sau dấu phẩy
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(new Error(window.I18n?.t('workflow.mediaModal.cannotReadFile') || 'Không thể đọc file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Render preview grid
   */
  static _renderPreviewGrid(modal) {
    const section = modal.querySelector('#wfMediaPreviewSection');
    const grid = modal.querySelector('#wfMediaPreviewGrid');
    const countEl = modal.querySelector('#wfMediaPreviewCount');

    if (!section || !grid) return;

    if (this._uploadedUrls.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    const imageCountText = (window.I18n?.t('workflow.mediaModal.imageCount') || '{count} ảnh').replace('{count}', this._uploadedUrls.length);
    countEl.textContent = imageCountText;

    grid.innerHTML = this._uploadedUrls.map(url => {
      const isSelected = this._selectedUrls.includes(url);
      return `
        <div class="wf-media-preview-item ${isSelected ? 'selected' : ''}" data-url="${this._escapeHtml(url)}">
          <img src="${this._escapeHtml(url)}" alt="Preview" loading="lazy" />
          <div class="wf-media-preview-overlay">
            <div class="wf-media-preview-check">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
          </div>
          <button class="wf-media-preview-remove" type="button" title="${window.I18n?.t('workflow.mediaModal.removeImage') || 'Xóa ảnh'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `;
    }).join('');
  }

  /**
   * Xóa ảnh đã upload khỏi danh sách
   */
  static _removeUploadedImage(url, modal) {
    const uploadedIndex = this._uploadedUrls.indexOf(url);
    if (uploadedIndex > -1) {
      this._uploadedUrls.splice(uploadedIndex, 1);
    }

    const selectedIndex = this._selectedUrls.indexOf(url);
    if (selectedIndex > -1) {
      this._selectedUrls.splice(selectedIndex, 1);
    }

    this._renderPreviewGrid(modal);
    this._updateConfirmButton(modal);
  }

  /**
   * Cập nhật trạng thái nút confirm
   */
  static _updateConfirmButton(modal) {
    const confirmBtn = modal.querySelector('#wfMediaConfirmBtn');
    if (confirmBtn) {
      confirmBtn.disabled = this._selectedUrls.length === 0;

      const count = this._selectedUrls.length;
      const t = (key, fallback) => window.I18n?.t(key) || fallback;
      if (count > 0) {
        const selectCountText = (t('workflow.mediaModal.selectCount', 'Chọn ({count})')).replace('{count}', count);
        confirmBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          ${selectCountText}
        `;
      } else {
        confirmBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          ${t('workflow.mediaModal.select', 'Chọn')}
        `;
      }
    }
  }

  /**
   * Hiển thị thanh tiến trình
   */
  static _showProgress(modal, percent, text) {
    const progressEl = modal.querySelector('#wfMediaProgress');
    const fillEl = modal.querySelector('#wfMediaProgressFill');
    const textEl = modal.querySelector('#wfMediaProgressText');

    if (progressEl) {
      progressEl.classList.remove('hidden');
    }
    if (fillEl) {
      fillEl.style.width = `${percent}%`;
    }
    if (textEl) {
      textEl.textContent = text;
    }
  }

  /**
   * Ẩn thanh tiến trình
   */
  static _hideProgress(modal) {
    const progressEl = modal.querySelector('#wfMediaProgress');
    if (progressEl) {
      progressEl.classList.add('hidden');
    }
  }

  /**
   * Hiển thị thông báo lỗi
   * Không tự động ẩn - user cần click dismiss hoặc bắt đầu action mới
   */
  static _showError(modal, message) {
    const errorEl = modal.querySelector('#wfMediaError');
    const textEl = modal.querySelector('#wfMediaErrorText');

    if (errorEl) {
      errorEl.classList.remove('hidden');
    }
    if (textEl) {
      textEl.textContent = message;
    }
  }

  /**
   * Ẩn thông báo lỗi
   */
  static _hideError(modal) {
    const errorEl = modal.querySelector('#wfMediaError');
    if (errorEl) {
      errorEl.classList.add('hidden');
    }
  }

  /**
   * Escape HTML để tránh XSS
   */
  static _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Export để dùng global
window.WorkflowMediaModal = WorkflowMediaModal;
