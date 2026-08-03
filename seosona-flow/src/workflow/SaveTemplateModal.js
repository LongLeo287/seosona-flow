/**
 * SaveTemplateModal - Modal lưu workflow thành template
 *
 * Chỉ dành cho admin users. Cho phép:
 * - Đặt tên, mô tả template
 * - Chọn danh mục
 * - Chọn ảnh thumbnail (dùng WorkflowMediaModal)
 * - Bật/tắt Premium, Featured
 * - Gọi API POST /admin/workflow-templates
 *
 * Sử dụng:
 * SaveTemplateModal.show(workflowData).then(result => {
 *   // result = { success: true, template: {...} } hoặc null nếu hủy
 * });
 */
class SaveTemplateModal {
  static _instance = null;
  static _categories = [];
  static _selectedThumbnail = null;

  /**
   * Hiển thị modal lưu template
   * @param {Object} workflowData - Dữ liệu workflow cần convert
   * @returns {Promise<Object|null>} Template đã tạo hoặc null nếu hủy
   */
  static async show(workflowData) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;

    // Offline: "Lưu thành Template" đẩy lên backend (submit/media/list đều apiRequest) → không có
    // server thì fail. Chặn tại show() với thông báo rõ. (FeatureGate.canManageWorkflowTemplates
    // trả true offline nên không chặn được ở đó.)
    if (self.SEOSONA_LOCAL_MODE !== false) {
      window.showNotification?.(t('workflow.saveTemplateRequiresOnline', 'Lưu thành Template (chia sẻ cộng đồng) cần tài khoản online — bản local hãy dùng Export/Clone.'), 'info', 4500);
      return null;
    }

    // Kiểm tra quyền admin
    if (!window.featureGate?.canManageWorkflowTemplates()) {
      window.showNotification?.(t('workflow.adminRequired', 'Bạn cần quyền admin để lưu template'), 'error');
      return null;
    }

    // Đóng modal cũ nếu có
    this._close();

    // Reset state
    this._selectedThumbnail = null;

    // Fetch danh mục từ API
    await this._fetchCategories();

    return new Promise((resolve) => {
      // Tạo modal
      const modal = this._createModal(workflowData);
      document.body.appendChild(modal);
      this._instance = modal;

      // Bind events
      this._bindEvents(modal, workflowData, resolve);

      // Hiển thị modal với animation
      requestAnimationFrame(() => {
        modal.classList.add('visible');
        // Focus vào input tên
        const nameInput = modal.querySelector('#saveTemplateName');
        nameInput?.focus();
      });
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
   * Fetch danh mục từ API
   */
  static async _fetchCategories() {
    try {
      // Gọi API qua background.js
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'apiRequest',
          method: 'GET',
          endpoint: 'workflow-templates/categories'
        }, (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (resp?.success && resp?.data) {
            resolve(resp.data);
          } else {
            reject(new Error(resp?.error?.message || 'Không lấy được danh mục'));
          }
        });
      });

      this._categories = response.categories || response || [];
    } catch (err) {
      console.warn('[SaveTemplateModal] Lỗi fetch categories:', err.message);
      this._categories = [];
    }
  }

  /**
   * Tạo HTML cho modal
   */
  static _createModal(workflowData) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    const defaultName = workflowData.wf_name || 'Workflow Template';
    const defaultDesc = workflowData.description || '';

    // Tạo options cho select danh mục
    const categoryOptions = this._categories.map(cat =>
      `<option value="${cat.id}">${this._escapeHtml(cat.name)}</option>`
    ).join('');

    const modal = document.createElement('div');
    modal.className = 'save-template-modal';
    modal.innerHTML = `
      <div class="save-template-backdrop"></div>
      <div class="save-template-content">
        <div class="save-template-header">
          <h3>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            ${t('workflow.saveTemplate.title', 'Lưu Workflow Template')}
          </h3>
          <button class="save-template-close" type="button" aria-label="${t('common.close', 'Đóng')}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="save-template-body">
          <!-- Tên template -->
          <div class="save-template-field">
            <label for="saveTemplateName">${t('workflow.saveTemplate.nameLabel', 'Tên Template')} <span class="required">*</span></label>
            <input type="text"
                   id="saveTemplateName"
                   value="${this._escapeAttr(defaultName)}"
                   placeholder="${t('workflow.saveTemplate.namePlaceholder', 'Nhập tên template...')}"
                   required
                   maxlength="100" />
          </div>

          <!-- Mô tả -->
          <div class="save-template-field">
            <label for="saveTemplateDesc">${t('workflow.saveTemplate.descriptionLabel', 'Mô tả')}</label>
            <textarea id="saveTemplateDesc"
                      rows="3"
                      placeholder="${t('workflow.saveTemplate.descriptionPlaceholder', 'Mô tả ngắn về template này...')}"
                      maxlength="500">${this._escapeHtml(defaultDesc)}</textarea>
          </div>

          <!-- Danh mục -->
          <div class="save-template-field">
            <label for="saveTemplateCategory">${t('workflow.saveTemplate.categoryLabel', 'Danh mục')}</label>
            <select id="saveTemplateCategory">
              <option value="">${t('workflow.saveTemplate.selectCategory', '-- Chọn danh mục --')}</option>
              ${categoryOptions}
            </select>
          </div>

          <!-- Thumbnail -->
          <div class="save-template-field">
            <label>${t('workflow.saveTemplate.thumbnailLabel', 'Ảnh Thumbnail')}</label>
            <div class="save-template-thumbnail-picker" id="saveTemplateThumbnailPicker">
              <div class="thumbnail-preview" id="saveTemplateThumbnailPreview">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span>${t('workflow.saveTemplate.clickToSelect', 'Click để chọn ảnh')}</span>
              </div>
              <button type="button" class="thumbnail-remove hidden" id="saveTemplateThumbnailRemove" title="${t('workflow.saveTemplate.removeThumbnail', 'Xóa ảnh')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <span class="save-template-hint">${t('workflow.saveTemplate.thumbnailSizeHint', 'Khuyến nghị: 640×360px hoặc 1280×720px (tỉ lệ 16:9)')}</span>
          </div>

          <!-- Active, Premium & Featured -->
          <div class="save-template-toggles">
            <label class="save-template-toggle">
              <input type="checkbox" id="saveTemplateActive" checked />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="9 12 12 15 16 10"/>
                </svg>
                ${t('workflow.saveTemplate.publishNow', 'Publish ngay')}
              </span>
            </label>

            <label class="save-template-toggle">
              <input type="checkbox" id="saveTemplatePremium" />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"/>
                </svg>
                ${t('workflow.saveTemplate.premiumTemplate', 'Premium Template')}
              </span>
            </label>

            <label class="save-template-toggle">
              <input type="checkbox" id="saveTemplateFeatured" />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
                ${t('workflow.saveTemplate.featured', 'Featured (Nổi bật)')}
              </span>
            </label>
          </div>

          <!-- Thông báo lỗi -->
          <div class="save-template-error hidden" id="saveTemplateError">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span id="saveTemplateErrorText"></span>
          </div>
        </div>

        <div class="save-template-footer">
          <button class="btn btn-secondary" type="button" id="saveTemplateCancelBtn">${t('common.cancel', 'Hủy')}</button>
          <button class="btn btn-primary" type="button" id="saveTemplateSaveBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            ${t('workflow.saveTemplate.save', 'Lưu Template')}
          </button>
        </div>
      </div>
    `;

    return modal;
  }

  /**
   * Bind các sự kiện cho modal
   */
  static _bindEvents(modal, workflowData, resolve) {
    const closeBtn = modal.querySelector('.save-template-close');
    const cancelBtn = modal.querySelector('#saveTemplateCancelBtn');
    const saveBtn = modal.querySelector('#saveTemplateSaveBtn');
    const backdrop = modal.querySelector('.save-template-backdrop');
    const thumbnailPicker = modal.querySelector('#saveTemplateThumbnailPicker');
    const thumbnailRemove = modal.querySelector('#saveTemplateThumbnailRemove');

    // Đóng modal
    const handleClose = () => {
      this._close();
      resolve(null);
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

    // Click thumbnail picker để mở WorkflowMediaModal
    thumbnailPicker?.addEventListener('click', (e) => {
      if (e.target.closest('.thumbnail-remove')) return;

      if (window.WorkflowMediaModal) {
        window.WorkflowMediaModal.show({
          type: 'thumbnail',
          multiple: false,
          preselected: this._selectedThumbnail ? [this._selectedThumbnail] : [],
          onSelect: (url) => {
            this._selectedThumbnail = url;
            this._updateThumbnailPreview(modal, url);
          }
        });
      } else {
        console.warn('[SaveTemplateModal] WorkflowMediaModal chưa sẵn sàng');
      }
    });

    // Xóa thumbnail
    thumbnailRemove?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._selectedThumbnail = null;
      this._updateThumbnailPreview(modal, null);
    });

    // Lưu template
    saveBtn?.addEventListener('click', async () => {
      await this._handleSave(modal, workflowData, resolve);
    });

    // Enter trong input name để submit
    const nameInput = modal.querySelector('#saveTemplateName');
    nameInput?.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await this._handleSave(modal, workflowData, resolve);
      }
    });
  }

  /**
   * Cập nhật preview thumbnail
   */
  static _updateThumbnailPreview(modal, url) {
    const preview = modal.querySelector('#saveTemplateThumbnailPreview');
    const removeBtn = modal.querySelector('#saveTemplateThumbnailRemove');

    if (url) {
      preview.innerHTML = `<img src="${this._escapeAttr(url)}" alt="Thumbnail" />`;
      preview.classList.add('has-image');
      removeBtn?.classList.remove('hidden');
    } else {
      const clickToSelectText = window.I18n?.t('workflow.saveTemplate.clickToSelect') || 'Click để chọn ảnh';
      preview.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <span>${clickToSelectText}</span>
      `;
      preview.classList.remove('has-image');
      removeBtn?.classList.add('hidden');
    }
  }

  /**
   * Xử lý lưu template
   */
  static async _handleSave(modal, workflowData, resolve) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    const nameInput = modal.querySelector('#saveTemplateName');
    const descInput = modal.querySelector('#saveTemplateDesc');
    const categorySelect = modal.querySelector('#saveTemplateCategory');
    const activeCheckbox = modal.querySelector('#saveTemplateActive');
    const premiumCheckbox = modal.querySelector('#saveTemplatePremium');
    const featuredCheckbox = modal.querySelector('#saveTemplateFeatured');
    const saveBtn = modal.querySelector('#saveTemplateSaveBtn');

    // Validate
    const name = nameInput?.value?.trim();
    if (!name) {
      this._showError(modal, t('workflow.saveTemplate.nameRequired', 'Vui lòng nhập tên template'));
      nameInput?.focus();
      return;
    }

    // Disable button và hiện loading
    saveBtn.disabled = true;
    const updateProgress = (text) => {
      saveBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
        </svg>
        ${text}
      `;
    };
    updateProgress(t('workflow.saveTemplate.saving', 'Đang lưu...'));

    try {
      // Step 1: Upload local images (blob:, data:) lên server
      updateProgress(t('workflow.saveTemplate.uploadingImages', 'Đang tải ảnh lên...'));
      const urlMapping = await this._uploadLocalImages(workflowData, (current, total) => {
        updateProgress(`${t('workflow.saveTemplate.uploadingImages', 'Đang tải ảnh')} ${current}/${total}...`);
      });

      // Step 2: Convert workflow → template format với URL mapping
      updateProgress(t('workflow.saveTemplate.saving', 'Đang lưu...'));

      // Debug: log checkbox states
      console.log('[SaveTemplateModal] Checkbox states:', {
        activeCheckbox_found: !!activeCheckbox,
        activeCheckbox_checked: activeCheckbox?.checked,
        premiumCheckbox_checked: premiumCheckbox?.checked,
        featuredCheckbox_checked: featuredCheckbox?.checked
      });

      const templateData = this._convertToTemplateFormat(workflowData, {
        name,
        description: descInput?.value?.trim() || '',
        category_id: categorySelect?.value ? parseInt(categorySelect.value, 10) : null,
        thumbnail_url: this._selectedThumbnail || null,
        is_active: activeCheckbox?.checked || false,
        is_premium: premiumCheckbox?.checked || false,
        is_featured: featuredCheckbox?.checked || false
      }, urlMapping);

      console.log('[SaveTemplateModal] Template data to send:', {
        name: templateData.name,
        is_active: templateData.is_active,
        is_premium: templateData.is_premium,
        nodes_count: templateData.nodes?.length
      });

      // Step 3: Gọi API tạo template
      const result = await this._saveTemplate(templateData);
      console.log('[SaveTemplateModal] API result:', result);

      // Thành công
      this._close();

      // Show notification - include info about activation if template is not active
      const isActive = result?.is_active || false;
      const successMsg = isActive
        ? t('workflow.saveTemplate.success', 'Đã lưu template thành công')
        : t('workflow.saveTemplate.successInactive', 'Đã lưu template. Bật Active trong Admin để hiển thị.');

      // Always log to console for debugging
      console.log('[SaveTemplateModal] ✓ Template saved:', result?.id || result?.name, isActive ? '(active)' : '(inactive)');

      // Show notification - try multiple methods
      if (typeof window.showNotification === 'function') {
        window.showNotification(successMsg, 'success', 4000);
      }
      // Also try workflow editor's notification if available
      if (typeof window.WorkflowEditor?._showToast === 'function') {
        window.WorkflowEditor._showToast(successMsg, 'success');
      }
      // Fallback: alert for debugging (comment out in production)
      // alert(successMsg);

      // Refresh template list via eventBus (WorkflowTemplateList listens for this)
      // Note: Only active templates will appear in the public list
      window.eventBus?.emit('template:created', result);

      resolve({ success: true, template: result });

    } catch (err) {
      console.error('[SaveTemplateModal] Lỗi lưu template:', err);
      this._showError(modal, err.message || t('workflow.saveTemplate.error', 'Không thể lưu template'));

      // Restore button
      saveBtn.disabled = false;
      saveBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        ${t('workflow.saveTemplate.save', 'Lưu Template')}
      `;
    }
  }

  /**
   * Upload tất cả local images (blob:, data:) lên server
   * @param {Object} workflowData - Workflow data chứa nodes
   * @param {Function} onProgress - Callback (current, total)
   * @returns {Map<string, string>} Mapping oldUrl → newUrl
   */
  static async _uploadLocalImages(workflowData, onProgress) {
    const urlMapping = new Map();
    const localUrls = new Set();
    const allRefUrls = []; // Debug: collect all ref URLs

    // Collect tất cả URLs cần upload (local + Flow URLs)
    for (const node of (workflowData.nodes || [])) {
      // ref_thumbnails
      if (node.ref_thumbnails && typeof node.ref_thumbnails === 'object') {
        for (const url of Object.values(node.ref_thumbnails)) {
          allRefUrls.push({ node_id: node.node_id, url, type: 'ref_thumbnail' });
          if (this._needsUpload(url)) {
            localUrls.add(url);
          }
        }
      }
      // result_img_url
      if (node.result_img_url && this._needsUpload(node.result_img_url)) {
        localUrls.add(node.result_img_url);
      }
      // frame thumbnails
      if (node.frame_1_thumbnail && this._needsUpload(node.frame_1_thumbnail)) {
        localUrls.add(node.frame_1_thumbnail);
      }
      if (node.frame_2_thumbnail && this._needsUpload(node.frame_2_thumbnail)) {
        localUrls.add(node.frame_2_thumbnail);
      }
    }

    // Debug: log all ref URLs found
    console.log('[SaveTemplateModal] All ref URLs found:', allRefUrls.length, allRefUrls);
    console.log('[SaveTemplateModal] All ref URLs found in nodes:', allRefUrls);
    console.log('[SaveTemplateModal] URLs to upload (local + Flow):', localUrls.size, [...localUrls].map(u => u.substring(0, 80)));

    if (localUrls.size === 0) {
      console.log('[SaveTemplateModal] No URLs need upload - all are public CDN URLs or no ref images found');
      return urlMapping;
    }

    console.log('[SaveTemplateModal] Starting upload for', localUrls.size, 'images...');

    let current = 0;
    const total = localUrls.size;

    for (const localUrl of localUrls) {
      current++;
      onProgress?.(current, total);

      try {
        const serverUrl = await this._uploadLocalUrl(localUrl);
        if (serverUrl) {
          urlMapping.set(localUrl, serverUrl);
          console.log('[SaveTemplateModal] Uploaded:', localUrl.substring(0, 50), '→', serverUrl);
        }
      } catch (err) {
        console.warn('[SaveTemplateModal] Failed to upload:', localUrl.substring(0, 50), err.message);
        // Continue với các ảnh khác, không throw
      }
    }

    return urlMapping;
  }

  /**
   * Check if URL is local (blob: hoặc data:)
   */
  static _isLocalUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return url.startsWith('blob:') || url.startsWith('data:');
  }

  /**
   * Check if URL is Flow CDN URL (cần re-upload vì requires auth).
   * Thêm flow-content.google (signed CDN sau redirect labs.google) — fetch KHÔNG credentials.
   */
  static _isFlowUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const flowDomains = ['labs.google', 'flow.google', 'flow-content.google', 'uxlfoundation.org'];
    return flowDomains.some(domain => url.includes(domain));
  }

  /**
   * Check if URL is ChatGPT/Grok CDN (cookie-gated → fetch credentials:include trong tab provider).
   * Trước fix: 2 domain này lọt _needsUpload=false → template lưu URL cookie-gated → user khác
   * KHÔNG xem được ref/result image. Fix: detect + upload qua creator:fetchImage.
   */
  static _isChatGPTOrGrokUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const domains = ['chatgpt.com', 'oaiusercontent.com', 'sandboxed.openai.com', 'grok.com', 'x.ai'];
    return domains.some(domain => url.includes(domain));
  }

  /**
   * Check if URL needs to be uploaded (local OR Flow OR ChatGPT/Grok URLs)
   */
  static _needsUpload(url) {
    return this._isLocalUrl(url) || this._isFlowUrl(url) || this._isChatGPTOrGrokUrl(url);
  }

  /**
   * Upload một URL (blob:, data:, hoặc Flow CDN) lên server
   * @returns {string|null} Server URL hoặc null nếu fail
   */
  static async _uploadLocalUrl(localUrl) {
    let base64, mimeType, fileName;

    if (localUrl.startsWith('data:')) {
      // data:image/png;base64,xxxxx
      const match = localUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      mimeType = match[1];
      base64 = match[2];
      const ext = mimeType.split('/')[1] || 'png';
      fileName = `upload_${Date.now()}.${ext}`;
    } else if (localUrl.startsWith('blob:')) {
      // Fetch blob via MessageBridge (content script context)
      try {
        const resp = await window.MessageBridge?.sendToContentScript('fetchImageAsBase64', { url: localUrl });
        if (!resp?.success || !resp.base64) {
          // Fallback: try fetch directly (may fail due to CORS)
          const directResult = await this._fetchBlobDirect(localUrl);
          if (!directResult) return null;
          base64 = directResult.base64;
          mimeType = directResult.mimeType;
        } else {
          base64 = resp.base64;
          mimeType = resp.mimeType || 'image/png';
        }
      } catch (err) {
        console.warn('[SaveTemplateModal] MessageBridge fetch failed:', err.message);
        // Try direct fetch
        const directResult = await this._fetchBlobDirect(localUrl);
        if (!directResult) return null;
        base64 = directResult.base64;
        mimeType = directResult.mimeType;
      }
      const ext = mimeType?.split('/')[1] || 'png';
      fileName = `upload_${Date.now()}.${ext}`;
    } else if (this._isFlowUrl(localUrl)) {
      // Flow CDN URL - fetch via content script (has cookies) or background
      console.log('[SaveTemplateModal] Fetching Flow URL:', localUrl.substring(0, 80));
      try {
        // Try via MessageBridge first (content script có cookies của Flow)
        const resp = await window.MessageBridge?.sendToContentScript('fetchImageAsBase64', { url: localUrl });
        if (resp?.success && resp.base64) {
          base64 = resp.base64;
          mimeType = resp.mimeType || 'image/jpeg';
        } else {
          // Fallback: fetch via background script
          const bgResult = await this._fetchFlowUrlViaBackground(localUrl);
          if (!bgResult) {
            console.warn('[SaveTemplateModal] Failed to fetch Flow URL:', localUrl.substring(0, 80));
            return null;
          }
          base64 = bgResult.base64;
          mimeType = bgResult.mimeType;
        }
      } catch (err) {
        console.warn('[SaveTemplateModal] Flow URL fetch failed:', err.message);
        return null;
      }
      const ext = mimeType?.split('/')[1] || 'jpg';
      fileName = `flow_${Date.now()}.${ext}`;
    } else if (this._isChatGPTOrGrokUrl(localUrl)) {
      // ChatGPT/Grok CDN — cookie-gated. Fetch credentials:include trong tab provider qua
      // background creator:fetchImage (cần tab chatgpt.com/grok.com đang mở). Trả data URL.
      console.log('[SaveTemplateModal] Fetching ChatGPT/Grok URL:', localUrl.substring(0, 80));
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'creator:fetchImage', url: localUrl }, (r) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(r);
        });
      });
      if (!resp?.success || !resp.base64) {
        console.warn('[SaveTemplateModal] Failed to fetch ChatGPT/Grok URL (tab provider còn mở?):', localUrl.substring(0, 80));
        return null;
      }
      base64 = resp.base64;
      mimeType = resp.mime || resp.mimeType || 'image/jpeg';
      const ext = mimeType?.split('/')[1] || 'jpg';
      fileName = `provider_${Date.now()}.${ext}`;
    } else {
      return null;
    }

    if (!base64) return null;
    // base64 từ creator:fetchImage là data URL đầy đủ — strip prefix để gửi raw base64.
    if (typeof base64 === 'string' && base64.startsWith('data:')) {
      const idx = base64.indexOf(',');
      if (idx !== -1) base64 = base64.substring(idx + 1);
    }

    // Upload via API
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest',
        method: 'POST',
        endpoint: 'admin/media/upload',
        token: window.authManager?.getToken(),
        isFormData: true,
        formDataFields: {
          file: {
            name: fileName,
            type: mimeType,
            base64: base64
          },
          type: 'ref_image'
        }
      }, response => {
        if (response?.success && response.data?.url) {
          resolve(response.data.url);
        } else {
          console.warn('[SaveTemplateModal] Upload API failed:', response?.error);
          resolve(null);
        }
      });
    });
  }

  /**
   * Fallback: fetch blob URL directly (may fail due to CORS)
   */
  static async _fetchBlobDirect(blobUrl) {
    try {
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      const mimeType = blob.type || 'image/png';

      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result.split(',')[1];
          resolve({ base64, mimeType });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      return null;
    }
  }

  /**
   * Fetch Flow URL via background script (can make cross-origin requests)
   */
  static async _fetchFlowUrlViaBackground(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'fetchImageAsBase64',
        url: url
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[SaveTemplateModal] Background fetch error:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        if (response?.success && response.base64) {
          resolve({
            base64: response.base64,
            mimeType: response.contentType || 'image/jpeg'
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Convert workflow data sang template format
   * @param {Object} workflowData - Workflow data
   * @param {Object} options - Template options (name, description, etc.)
   * @param {Map<string, string>} urlMapping - Mapping local URLs → server URLs
   */
  static _convertToTemplateFormat(workflowData, options, urlMapping = new Map()) {
    // Helper: resolve URL (local → server nếu có mapping)
    const resolveUrl = (url) => {
      if (!url || typeof url !== 'string') return null;
      // Check mapping trước
      if (urlMapping.has(url)) {
        return urlMapping.get(url);
      }
      // ChatGPT/Grok URL không upload được (vd tab provider đã đóng) → DROP. Backend
      // convertExternalUrlsToPublic CHỈ catch Flow domain → giữ lại = ảnh cookie-gated chết
      // với user khác. Flow URL vẫn giữ (backend có fallback convert).
      if (this._isChatGPTOrGrokUrl(url)) {
        return null;
      }
      // Chỉ giữ http/https URLs (Flow → backend fallback convert; public CDN → giữ nguyên)
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      // Bỏ blob:, data: chưa được upload
      return null;
    };

    // Convert nodes
    const nodes = (workflowData.nodes || []).map(node => {
      // Lấy ref_img_urls: ưu tiên ref_img_urls (template mode), fallback ref_thumbnails (normal mode)
      // Sử dụng urlMapping để convert local → server URLs
      let refImgUrls = [];
      if (Array.isArray(node.ref_img_urls) && node.ref_img_urls.length > 0) {
        // Template mode: ref_img_urls đã có sẵn
        refImgUrls = node.ref_img_urls
          .map(url => resolveUrl(url))
          .filter(Boolean);
      } else if (node.ref_thumbnails && typeof node.ref_thumbnails === 'object') {
        // Normal mode: convert từ ref_thumbnails
        refImgUrls = Object.values(node.ref_thumbnails)
          .map(url => resolveUrl(url))
          .filter(Boolean);
      }

      // Resolve result_img_url
      const resultImgUrl = resolveUrl(node.result_img_url);

      // Resolve frame thumbnails
      const frame1Thumbnail = resolveUrl(node.frame_1_thumbnail);
      const frame2Thumbnail = resolveUrl(node.frame_2_thumbnail);

      // Debug log
      console.log('[SaveTemplateModal] Node ref extraction:', {
        node_id: node.node_id,
        node_type: node.node_type,
        ref_thumbnails_count: node.ref_thumbnails ? Object.keys(node.ref_thumbnails).length : 0,
        ref_thumbnails_urls: node.ref_thumbnails ? Object.values(node.ref_thumbnails).map(u => u?.substring(0, 80)) : [],
        resolved_urls: refImgUrls.length,
        resolved_urls_list: refImgUrls.map(u => u?.substring(0, 80)),
        result_img_url: resultImgUrl ? 'resolved' : 'none'
      });

      // Extract extra data first
      const extraData = this._extractNodeData(node);

      // Override với resolved URLs
      if (resultImgUrl) {
        extraData.result_img_url = resultImgUrl;
      } else {
        delete extraData.result_img_url;
      }
      if (frame1Thumbnail) {
        extraData.frame_1_thumbnail = frame1Thumbnail;
      } else {
        delete extraData.frame_1_thumbnail;
      }
      if (frame2Thumbnail) {
        extraData.frame_2_thumbnail = frame2Thumbnail;
      } else {
        delete extraData.frame_2_thumbnail;
      }

      return {
        id: node.node_id,
        type: node.node_type,
        position: {
          x: node.pos_x || 0,
          y: node.pos_y || 0
        },
        data: {
          // Node name/label for display
          node_name: node.node_name || '',
          label: node.node_name || node.node_type || '',
          // Core fields
          prompt: node.prompt || '',
          model: node.model || '',
          ratio: node.ratio || '1:1',
          quantity: node.quantity || 1,
          enabled: node.enabled !== false,
          media_type: node.media_type || 'Image',
          gen_type: node.gen_type || 'flow',
          // Ref images dưới dạng URL (đã resolved)
          ref_img_urls: refImgUrls,
          // Các field khác tùy theo node type
          delay_seconds: node.delay_seconds || 5,
          download_resolution: node.download_resolution || 'original',
          note_text: node.note_text || '',
          // Telegram
          telegram_chat_id: node.telegram_chat_id || '',
          telegram_caption: node.telegram_caption || '',
          // Các field bổ sung (với URLs đã resolved)
          ...extraData
        }
      };
    });

    // Convert edges
    // Backend expects BOTH sourceHandle/targetHandle (Drawflow class) AND sourcePort/targetPort (port names)
    // GAP BUG #4 FIX: Don't use source_port as fallback for sourceHandle - they are different things:
    // - sourceHandle/targetHandle: Drawflow output/input class (e.g., 'output_1', 'input_1')
    // - sourcePort/targetPort: Human-readable port names (e.g., 'text', 'image', 'frame_1')
    const edges = (workflowData.edges || []).map(edge => ({
      id: edge.edge_id || (window.IdGenerator ? window.IdGenerator.next('edge') : `edge_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`),
      source: edge.source_node_id,
      target: edge.target_node_id,
      sourceHandle: edge.source_handle || 'output_1',
      targetHandle: edge.target_handle || 'input_1',
      // Include port names for cloneToWorkflow to populate Edge.source_port/target_port
      sourcePort: edge.source_port || null,
      targetPort: edge.target_port || null,
      dataType: edge.data_type || 'image',
    }));

    return {
      name: options.name,
      description: options.description,
      category_id: options.category_id,
      thumbnail_url: options.thumbnail_url,
      is_active: options.is_active,
      is_premium: options.is_premium,
      is_featured: options.is_featured,
      nodes: nodes,
      edges: edges,
      settings: workflowData.settings || {}
    };
  }

  /**
   * Trích xuất dữ liệu node bổ sung (từ drawflow data nếu có)
   * Đảm bảo đồng bộ với các fields mà backend cloneToWorkflow xử lý
   */
  static _extractNodeData(node) {
    const extra = {};

    // Copy các field có thể có trong node (sync với backend AdminWorkflowTemplateController::cloneToWorkflow)
    const copyFields = [
      // Core settings
      'auto_download', 'retry_on_fail', 'style_weight', 'quality',
      'negative_prompt', 'seed', 'cfg_scale', 'steps',
      'video_duration', 'video_fps', 'aspect_ratio', 'node_zoom',
      'system_prompt', 'temperature', 'max_tokens',
      // Phase 1 — Node Reference System: slug + mention modes
      'slug', 'slug_auto', 'prompt_mode', 'ref_mode',
      // Ref file names
      'ref_file_names',
      // Angle preset fields
      'angle_preset_id', 'angle_preset_name', 'angle_preset_json',
      'angle_rotation', 'angle_tilt', 'angle_zoom', 'angle_ratio', 'angle_built_prompt',
      // Download settings
      'download_resolution', 'video_download_resolution', 'download_folder',
      'download_file_template', 'download_collect_all',
      // Telegram settings
      'telegram_send_mode', 'telegram_message',
      // Provider settings (ChatGPT/Grok)
      'provider', 'prompt_source', 'multi_prompt',
      'timeout_sec', 'timeout_ms', 'use_fallback_prefix', 'max_ref_images',
      // AI Agent rename (2026-05-30): use_ai/ai_fallback/ai_delete_after_run.
      // Legacy enhance/enhance_fallback BỎ — backend Node observer auto mirror khi save
      // (pair 1: enhance↔use_ai, pair 2: enhance_fallback↔ai_fallback).
      'use_ai', 'ai_fallback', 'ai_delete_after_run',
      // Flow Voice Selector (2026-05-30): preserve voice khi save as template
      'voice_slug', 'voice_search_value',
      // EWT-12: Template result preview image
      'result_img_url',
      // Grok specific
      'grok_mode', 'grok_duration', 'grok_resolution', 'grok_image_quality',
      // Video specific
      'video_input_type', 'frame_1_source', 'frame_1_file_name', 'frame_1_thumbnail',
      'frame_2_source', 'frame_2_file_name', 'frame_2_thumbnail',
      // Prompts JSON (for multi-prompt nodes)
      'prompts_json',
      // Text Extract Node (2026-05-31): preserve extract config khi save as template
      'extract_mode', 'extract_marker', 'extract_regex', 'extract_strict',
      'extract_multi_match', 'extract_on_fail',
    ];

    copyFields.forEach(field => {
      if (node[field] !== undefined) {
        extra[field] = node[field];
      }
    });

    return extra;
  }

  /**
   * Gọi API tạo template
   */
  static async _saveTemplate(templateData) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest',
        method: 'POST',
        endpoint: 'admin/workflow-templates',
        token: window.authManager?.getToken(),
        data: templateData
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Lỗi kết nối'));
          return;
        }

        if (!response) {
          reject(new Error('Không nhận được phản hồi từ server'));
          return;
        }

        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error?.message || 'Lỗi lưu template'));
        }
      });
    });
  }

  /**
   * Hiển thị thông báo lỗi
   */
  static _showError(modal, message) {
    const errorEl = modal.querySelector('#saveTemplateError');
    const textEl = modal.querySelector('#saveTemplateErrorText');

    if (errorEl && textEl) {
      textEl.textContent = message;
      errorEl.classList.remove('hidden');

      // Tự động ẩn sau 5 giây
      setTimeout(() => {
        errorEl.classList.add('hidden');
      }, 5000);
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

  /**
   * Escape cho attribute
   */
  static _escapeAttr(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

// Export để dùng global
window.SaveTemplateModal = SaveTemplateModal;
