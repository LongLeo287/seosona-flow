/**
 * CreatorTemplatePublish — modal affiliate "Xuất bản Template" (community).
 * Plan: AFFILIATE_CREATOR_PAGE_PLAN.md (§5.5b, §7.1). Fork từ SaveTemplateModal:
 *  - Gate: affiliate active + can_publish_templates (fetch creator-profile, KHÔNG admin gate).
 *  - Endpoint: creator-templates/media (upload) + creator-templates (store).
 *  - Provider routing: Flow + ChatGPT + Grok → background 'creator:fetchImage' (cookie-gated CDN).
 *  - Persist thêm result_thumbnails (poster video) — DROP video_url (không host video).
 *
 * Dùng chung 2 entry point: WorkflowTab menu + WorkflowEditor toolbar.
 *   CreatorTemplatePublish.show(workflowData).then(res => res?.success ? ... : null)
 */
class CreatorTemplatePublish {
  static _instance = null;
  static _selectedThumbnail = null;
  static _profile = null;
  static _editTemplateId = null;
  static _SKIP_VIDEO = '__skip_video__'; // sentinel: asset video → skip upload (không tính fail)

  /**
   * [Edit] Sửa METADATA template đã xuất bản (tên/mô tả/thumbnail) — KHÔNG đổi nodes → giữ approved.
   * Gọi PUT creator-templates/{id}. Trả {success, template} hoặc null.
   */
  static async showEditMetadata(template) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    const profile = await this._fetchProfile();
    if (!profile?.is_active) {
      window.showNotification?.(t('creator.notActive', 'Bạn cần là cộng tác viên đã được duyệt.'), 'error');
      return null;
    }
    this._close();
    this._editTemplateId = template.id;
    this._selectedThumbnail = template.thumbnail_url || null;
    return new Promise((resolve) => {
      const modal = this._createModal(
        { wf_name: template.name, description: template.description || '' },
        { isEdit: true, thumbnail: template.thumbnail_url }
      );
      document.body.appendChild(modal);
      this._instance = modal;
      this._bindEvents(modal, null, resolve, { isEdit: true });
      requestAnimationFrame(() => { modal.classList.add('visible'); modal.querySelector('#creatorTplName')?.focus(); });
    });
  }

  static async show(workflowData) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;

    // Gate: lấy creator profile (authoritative) — active + can_publish_templates.
    const profile = await this._fetchProfile();
    if (!profile?.is_active) {
      window.showNotification?.(t('creator.notActive', 'Bạn cần là cộng tác viên đã được duyệt để xuất bản template.'), 'error');
      return null;
    }
    if (!profile.can_publish_templates) {
      window.showNotification?.(t('creator.publishRevoked', 'Quyền xuất bản template của bạn đã bị tạm khoá.'), 'error');
      return null;
    }
    this._profile = profile;

    // Chưa có slug → vẫn cho gửi duyệt (slug KHÔNG bắt buộc lúc publish). Sau khi duyệt, affiliate
    // cấu hình slug ở Dashboard → Tài khoản (dashboard/account) để template hiện ở /seosonaflow/@{slug}.
    if (!profile.slug) {
      window.showNotification?.(t('creator.publish.noSlugHint', 'Mẹo: cấu hình slug trang cá nhân ở Dashboard → Tài khoản để template hiển thị công khai.'), 'info', 4000);
    }

    this._close();
    this._selectedThumbnail = null;
    this._editTemplateId = null; // publish mode → KHÔNG phải edit (tránh dùng nhầm _submitUpdate)

    return new Promise((resolve) => {
      const modal = this._createModal(workflowData);
      document.body.appendChild(modal);
      this._instance = modal;
      this._bindEvents(modal, workflowData, resolve);
      requestAnimationFrame(() => {
        modal.classList.add('visible');
        modal.querySelector('#creatorTplName')?.focus();
      });
    });
  }

  /** Xoá cache eligibility → buộc isEligible() fetch lại (gọi sau login / duyệt affiliate). */
  static invalidateEligible() {
    this._eligibleCache = null;
    this._eligiblePromise = null;
  }

  /**
   * Eligible khi affiliate active + can_publish_templates. Cache 60s để gate nút editor/menu
   * mà không spam request. Trả boolean.
   */
  static async isEligible() {
    const now = Date.now();
    if (this._eligibleCache && (now - this._eligibleCache.at) < 60000) {
      return this._eligibleCache.value;
    }
    // Dedupe concurrent calls (mỗi workflow card gọi 1 lần) — share 1 promise in-flight,
    // tránh N request creator-profile đồng thời lúc render list.
    if (this._eligiblePromise) return this._eligiblePromise;
    this._eligiblePromise = (async () => {
      try {
        const profile = await this._fetchProfile();
        const value = !!(profile?.is_active && profile?.can_publish_templates);
        this._eligibleCache = { at: Date.now(), value };
        return value;
      } catch (e) {
        return false;
      } finally {
        this._eligiblePromise = null;
      }
    })();
    return this._eligiblePromise;
  }

  static async _fetchProfile() {
    try {
      const resp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'apiRequest', method: 'GET', endpoint: 'affiliate/creator-profile',
          token: window.authManager?.getToken(),
        }, (r) => {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          resolve(r);
        });
      });
      return resp?.success ? resp.data : null;
    } catch (e) {
      console.warn('[CreatorTemplatePublish] fetch profile fail:', e.message);
      return null;
    }
  }

  static _close() {
    if (this._instance) {
      this._instance.classList.remove('visible');
      const el = this._instance;
      setTimeout(() => { el?.remove(); }, 200);
      this._instance = null;
    }
  }

  static _countRefs(workflowData) {
    let refs = 0;
    for (const node of (workflowData.nodes || [])) {
      if (node.ref_thumbnails && typeof node.ref_thumbnails === 'object') {
        refs += Object.keys(node.ref_thumbnails).length;
      } else if (Array.isArray(node.ref_img_urls)) {
        refs += node.ref_img_urls.length;
      }
    }
    return refs;
  }

  static _createModal(workflowData, opts = {}) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    const isEdit = !!opts.isEdit;
    const defaultName = workflowData.wf_name || 'Workflow Template';
    const defaultDesc = workflowData.description || '';
    const nodeCount = (workflowData.nodes || []).length;
    const refCount = this._countRefs(workflowData);

    const modal = document.createElement('div');
    modal.className = 'save-template-modal creator-publish-modal';
    modal.innerHTML = `
      <div class="save-template-backdrop"></div>
      <div class="save-template-content">
        <div class="save-template-header">
          <h3>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
            </svg>
            ${isEdit ? t('creator.edit.title', 'Sửa thông tin Template') : t('creator.publish.title', 'Xuất bản Workflow Template')}
          </h3>
          <button class="save-template-close" type="button" aria-label="${t('common.close', 'Đóng')}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="save-template-body">
          <div class="save-template-field">
            <label for="creatorTplName">${t('creator.publish.nameLabel', 'Tên Template')} <span class="required">*</span></label>
            <input type="text" id="creatorTplName" value="${this._escapeAttr(defaultName)}"
                   placeholder="${t('creator.publish.namePlaceholder', 'Nhập tên template...')}" required maxlength="100" />
          </div>
          <div class="save-template-field">
            <label for="creatorTplDesc">${t('creator.publish.descLabel', 'Mô tả ngắn')}</label>
            <textarea id="creatorTplDesc" rows="3" maxlength="500"
                      placeholder="${t('creator.publish.descPlaceholder', 'Mô tả ngắn về template này...')}">${this._escapeHtml(defaultDesc)}</textarea>
          </div>
          <div class="save-template-field">
            <label>${t('creator.publish.thumbnailLabel', 'Ảnh thumbnail')}</label>
            <div class="save-template-thumbnail-picker" id="creatorTplThumbPicker">
              <div class="thumbnail-preview${opts.thumbnail ? ' has-image' : ''}" id="creatorTplThumbPreview">
                ${opts.thumbnail
                  ? `<img src="${this._escapeAttr(opts.thumbnail)}" alt="Thumbnail" />`
                  : `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>${t('creator.publish.clickToSelect', 'Click để chọn ảnh (không bắt buộc)')}</span>`}
              </div>
              <button type="button" class="thumbnail-remove ${opts.thumbnail ? '' : 'hidden'}" id="creatorTplThumbRemove" title="${t('common.remove', 'Xoá')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <span class="save-template-hint">${t('creator.publish.thumbnailSizeHint', 'Khuyến nghị: 640×360px hoặc 1280×720px (tỉ lệ 16:9)')}</span>
          </div>
          ${isEdit ? `
          <div class="creator-publish-note">
            ${t('creator.edit.metaNote', 'Chỉ sửa thông tin hiển thị (không đổi nội dung workflow) → giữ nguyên trạng thái đã duyệt.')}
          </div>` : `
          <div class="creator-publish-info">
            <span><strong>${nodeCount}</strong> ${t('creator.publish.nodes', 'node')}</span>
            <span>·</span>
            <span><strong>${refCount}</strong> ${t('creator.publish.refImages', 'ảnh tham chiếu (lưu lên server)')}</span>
          </div>
          <div class="creator-publish-note">
            ${t('creator.publish.reviewNote', 'Template sẽ được gửi duyệt. Sau khi admin duyệt sẽ hiển thị tại trang cá nhân của bạn.')}
          </div>`}
          <div class="save-template-error hidden" id="creatorTplError">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span id="creatorTplErrorText"></span>
          </div>
        </div>
        <div class="save-template-footer">
          <button class="btn btn-secondary" type="button" id="creatorTplCancel">${t('common.cancel', 'Huỷ')}</button>
          <button class="btn btn-primary" type="button" id="creatorTplSubmit">${isEdit ? t('creator.edit.save', 'Lưu thay đổi') : t('creator.publish.submit', 'Gửi duyệt')}</button>
        </div>
      </div>
    `;
    return modal;
  }

  static _bindEvents(modal, workflowData, resolve, opts = {}) {
    const close = () => { this._close(); resolve(null); };
    modal.querySelector('.save-template-close')?.addEventListener('click', close);
    modal.querySelector('#creatorTplCancel')?.addEventListener('click', close);
    modal.querySelector('.save-template-backdrop')?.addEventListener('click', close);

    const handleKeydown = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', handleKeydown); } };
    document.addEventListener('keydown', handleKeydown);

    const thumbPicker = modal.querySelector('#creatorTplThumbPicker');
    thumbPicker?.addEventListener('click', async (e) => {
      if (e.target.closest('.thumbnail-remove')) return;
      // Affiliate KHÔNG có quyền admin/media → upload qua sandbox creator-templates/media.
      const url = await this._pickAndUpload('thumbnail');
      if (url) { this._selectedThumbnail = url; this._updateThumb(modal, url); }
    });
    modal.querySelector('#creatorTplThumbRemove')?.addEventListener('click', (e) => {
      e.stopPropagation(); this._selectedThumbnail = null; this._updateThumb(modal, null);
    });

    modal.querySelector('#creatorTplSubmit')?.addEventListener('click', () =>
      opts.isEdit ? this._handleEditSubmit(modal, resolve) : this._handleSubmit(modal, workflowData, resolve));
  }

  /** [Edit] Submit sửa metadata → PUT update (KHÔNG nodes → backend giữ approved). */
  static async _handleEditSubmit(modal, resolve) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    const nameInput = modal.querySelector('#creatorTplName');
    const descInput = modal.querySelector('#creatorTplDesc');
    const submitBtn = modal.querySelector('#creatorTplSubmit');
    const name = nameInput?.value?.trim();
    if (!name) { this._showError(modal, t('creator.publish.nameRequired', 'Vui lòng nhập tên template')); nameInput?.focus(); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = t('creator.edit.saving', 'Đang lưu...');
    try {
      const result = await this._submitUpdate(this._editTemplateId, {
        name,
        description: descInput?.value?.trim() || '',
        thumbnail_url: this._selectedThumbnail || null,
      });
      this._close();
      window.showNotification?.(t('creator.edit.success', 'Đã cập nhật template.'), 'success', 3000);
      window.eventBus?.emit('creator:template-updated', result);
      resolve({ success: true, template: result });
    } catch (err) {
      this._showError(modal, err.message || t('creator.edit.error', 'Không thể cập nhật template'));
      submitBtn.disabled = false;
      submitBtn.textContent = t('creator.edit.save', 'Lưu thay đổi');
    }
  }

  /** PUT creator-templates/{id} (metadata-only payload). */
  static _submitUpdate(id, data) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest', method: 'PUT', endpoint: `creator-templates/${id}`,
        token: window.authManager?.getToken(), data,
      }, (response) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message || 'Lỗi kết nối')); return; }
        if (!response) { reject(new Error('Không nhận được phản hồi từ server')); return; }
        if (response.success) resolve(response.data);
        else reject(new Error(response.error?.message || 'Lỗi cập nhật template'));
      });
    });
  }

  static _updateThumb(modal, url) {
    const preview = modal.querySelector('#creatorTplThumbPreview');
    const removeBtn = modal.querySelector('#creatorTplThumbRemove');
    if (url) {
      preview.innerHTML = `<img src="${this._escapeAttr(url)}" alt="Thumbnail" />`;
      preview.classList.add('has-image');
      removeBtn?.classList.remove('hidden');
    } else {
      preview.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>${window.I18n?.t('creator.publish.clickToSelect') || 'Click để chọn ảnh'}</span>`;
      preview.classList.remove('has-image');
      removeBtn?.classList.add('hidden');
    }
  }

  static async _handleSubmit(modal, workflowData, resolve) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    const nameInput = modal.querySelector('#creatorTplName');
    const descInput = modal.querySelector('#creatorTplDesc');
    const submitBtn = modal.querySelector('#creatorTplSubmit');

    const name = nameInput?.value?.trim();
    if (!name) { this._showError(modal, t('creator.publish.nameRequired', 'Vui lòng nhập tên template')); nameInput?.focus(); return; }

    submitBtn.disabled = true;
    const progress = (txt) => { submitBtn.textContent = txt; };
    progress(t('creator.publish.uploading', 'Đang tải ảnh...'));

    try {
      const { urlMapping, failed } = await this._uploadImages(workflowData, (c, total) => progress(`${t('creator.publish.uploading', 'Đang tải ảnh')} ${c}/${total}...`));
      // Cảnh báo nếu có ảnh tải thất bại → template sẽ THIẾU ảnh tham chiếu. Cho user quyết định.
      if (failed > 0) {
        const msg = (t('creator.publish.uploadFailedConfirm', '{n} ảnh tải lên thất bại — template sẽ thiếu ảnh tham chiếu. Vẫn tiếp tục gửi duyệt?')).replace('{n}', failed);
        if (!confirm(msg)) {
          submitBtn.disabled = false;
          submitBtn.textContent = t('creator.publish.submit', 'Gửi duyệt');
          return;
        }
      }
      progress(t('creator.publish.submitting', 'Đang gửi...'));

      const templateData = this._convertToTemplateFormat(workflowData, {
        name,
        description: descInput?.value?.trim() || '',
        thumbnail_url: this._selectedThumbnail || null,
      }, urlMapping);

      const result = await this._submit(templateData);
      this._close();
      window.showNotification?.(t('creator.publish.success', 'Đã gửi duyệt template. Admin sẽ xem xét sớm.'), 'success', 4000);
      window.eventBus?.emit('creator:template-submitted', result);
      resolve({ success: true, template: result });
    } catch (err) {
      console.error('[CreatorTemplatePublish] submit error:', err);
      this._showError(modal, err.message || t('creator.publish.error', 'Không thể gửi duyệt template'));
      submitBtn.disabled = false;
      submitBtn.textContent = t('creator.publish.submit', 'Gửi duyệt');
    }
  }

  // ---- Image upload (provider-aware) ----

  static _isLocalUrl(url) {
    return typeof url === 'string' && (url.startsWith('blob:') || url.startsWith('data:'));
  }

  /** Flow CDN — fetch KHÔNG credentials (signed URL, CORS ACAO:*). Đồng bộ handler fetchImageAsBase64. */
  static _isFlowUrl(url) {
    if (typeof url !== 'string') return false;
    return ['labs.google', 'flow.google', 'flow-content.google', 'uxlfoundation.org'].some(d => url.includes(d));
  }

  /** ChatGPT/Grok CDN — cookie-gated, fetch credentials:include trong tab provider. */
  static _isChatGPTOrGrokUrl(url) {
    if (typeof url !== 'string') return false;
    return ['chatgpt.com', 'oaiusercontent.com', 'sandboxed.openai.com', 'grok.com', 'x.ai'].some(d => url.includes(d));
  }

  /** URL CDN provider cần re-upload (cookie-gated / signed → user khác không xem được). */
  static _isProviderUrl(url) {
    return this._isFlowUrl(url) || this._isChatGPTOrGrokUrl(url);
  }

  static _needsUpload(url) {
    return this._isLocalUrl(url) || this._isProviderUrl(url);
  }

  static async _uploadImages(workflowData, onProgress) {
    const urlMapping = new Map();
    const localUrls = new Set();

    for (const node of (workflowData.nodes || [])) {
      // ref thumbnails
      if (node.ref_thumbnails && typeof node.ref_thumbnails === 'object') {
        for (const url of Object.values(node.ref_thumbnails)) {
          if (this._needsUpload(url)) localUrls.add(url);
        }
      }
      if (Array.isArray(node.ref_img_urls)) {
        for (const url of node.ref_img_urls) { if (this._needsUpload(url)) localUrls.add(url); }
      }
      // result image (single)
      if (node.result_img_url && this._needsUpload(node.result_img_url)) localUrls.add(node.result_img_url);
      // frame thumbnails
      if (node.frame_1_thumbnail && this._needsUpload(node.frame_1_thumbnail)) localUrls.add(node.frame_1_thumbnail);
      if (node.frame_2_thumbnail && this._needsUpload(node.frame_2_thumbnail)) localUrls.add(node.frame_2_thumbnail);
      // result_thumbnails posters (video node) — CHỈ poster, KHÔNG video_url
      if (node.result_thumbnails && typeof node.result_thumbnails === 'object') {
        for (const entry of Object.values(node.result_thumbnails)) {
          const poster = entry?.thumbnail;
          if (poster && this._needsUpload(poster)) localUrls.add(poster);
        }
      }
    }

    if (localUrls.size === 0) return { urlMapping, failed: 0 };
    let current = 0;
    let failed = 0;
    const total = localUrls.size;
    for (const localUrl of localUrls) {
      current++;
      onProgress?.(current, total);
      try {
        const serverUrl = await this._uploadOne(localUrl);
        if (serverUrl === this._SKIP_VIDEO) continue; // video → skip, không tính fail
        if (serverUrl) urlMapping.set(localUrl, serverUrl);
        else failed++; // upload trả null → ảnh sẽ bị drop khỏi template
      } catch (e) {
        failed++;
        console.warn('[CreatorTemplatePublish] upload fail:', localUrl?.substring(0, 60), e.message);
      }
    }
    return { urlMapping, failed };
  }

  static async _uploadOne(localUrl) {
    let base64, mimeType, fileName;

    if (localUrl.startsWith('data:')) {
      const m = localUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return null;
      mimeType = m[1]; base64 = m[2];
      fileName = `upload_${Date.now()}.${(mimeType.split('/')[1] || 'png')}`;
    } else if (localUrl.startsWith('blob:')) {
      const resp = await window.MessageBridge?.sendToContentScript('fetchImageAsBase64', { url: localUrl });
      if (resp?.success && resp.base64) {
        base64 = resp.base64; mimeType = resp.mimeType || resp.contentType || 'image/png';
      } else {
        const direct = await this._fetchBlobDirect(localUrl);
        if (!direct) return null;
        base64 = direct.base64; mimeType = direct.mimeType;
      }
      fileName = `upload_${Date.now()}.${(mimeType?.split('/')[1] || 'png')}`;
    } else if (this._isFlowUrl(localUrl)) {
      // Flow: signed CDN flow-content.google trả ACAO:* → credentialed fetch bị CORS chặn.
      // Dùng fetchImageAsBase64 (content script Flow, KHÔNG credentials) — proven path SaveTemplateModal.
      const resp = await window.MessageBridge?.sendToContentScript('fetchImageAsBase64', { url: localUrl });
      if (resp?.success && resp.base64) {
        base64 = resp.base64; mimeType = resp.mimeType || resp.contentType || 'image/jpeg';
      } else {
        const bg = await new Promise((r) => {
          chrome.runtime.sendMessage({ action: 'fetchImageAsBase64', url: localUrl }, (resp2) => {
            if (chrome.runtime.lastError) { r(null); return; } r(resp2);
          });
        });
        if (bg?.success && bg.base64) { base64 = bg.base64; mimeType = bg.contentType || 'image/jpeg'; }
        else return null;
      }
      fileName = `flow_${Date.now()}.${(mimeType?.split('/')[1] || 'jpg')}`;
    } else if (this._isChatGPTOrGrokUrl(localUrl)) {
      // ChatGPT/Grok: cookie-gated → creator:fetchImage (credentials:include trong tab provider).
      const resp = await this._fetchProviderImage(localUrl);
      if (!resp) return null;
      base64 = resp.base64; mimeType = resp.mimeType;
      fileName = `provider_${Date.now()}.${(mimeType?.split('/')[1] || 'jpg')}`;
    } else {
      return null;
    }

    if (!base64) return null;
    // Endpoint creator-templates/media CHỈ nhận ảnh. Asset video (vd poster/result của Veo node fetch
    // ra video/mp4) → skip GRACEFUL (KHÔNG tính fail → tránh báo "upload thất bại" oan ở node video).
    if (mimeType && mimeType.startsWith('video/')) {
      return CreatorTemplatePublish._SKIP_VIDEO;
    }
    // base64 có thể là data URL đầy đủ (provider handler) — strip prefix nếu có.
    if (base64.startsWith('data:')) {
      const idx = base64.indexOf(',');
      if (idx !== -1) base64 = base64.substring(idx + 1);
    }

    return this._postMediaWithRetry({ name: fileName, type: mimeType, base64 });
  }

  /**
   * POST 1 ảnh lên creator-templates/media, RETRY khi gặp 429 (rate-limit).
   * 429 set global cooldown (retry_after giây) chặn mọi request → đợi đúng retry_after rồi thử lại
   * (KHÔNG drop ảnh → template lớn không mất ref). Tối đa 4 lần, cap chờ 65s/lần.
   */
  static async _postMediaWithRetry(fileFields, attempt = 0) {
    const MAX_RETRY = 4;
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest', method: 'POST', endpoint: 'creator-templates/media',
        token: window.authManager?.getToken(), isFormData: true,
        formDataFields: { file: fileFields, type: 'ref_image' },
      }, (r) => { if (chrome.runtime.lastError) { resolve(null); return; } resolve(r); });
    });

    if (resp?.success && resp.data?.url) return resp.data.url;

    const is429 = resp?.httpStatus === 429
      || resp?.error?.code === 'RATE_LIMITED'
      || /too many|rate limit/i.test(resp?.error?.message || '');
    if (is429 && attempt < MAX_RETRY) {
      const retryAfter = Number(resp?.retry_after || resp?.data?.retry_after) || 5;
      const waitMs = Math.min(retryAfter, 65) * 1000 + Math.floor(Math.random() * 400); // jitter tránh đồng loạt
      console.warn(`[CreatorTemplatePublish] media upload 429 → đợi ${Math.round(waitMs / 1000)}s rồi retry (${attempt + 1}/${MAX_RETRY})`);
      await new Promise((r) => setTimeout(r, waitMs));
      return this._postMediaWithRetry(fileFields, attempt + 1);
    }

    console.warn('[CreatorTemplatePublish] media upload failed:', resp?.error);
    return null;
  }

  /**
   * Chọn 1 ảnh từ máy + upload qua sandbox creator-templates/media (gate affiliate active).
   * Trả public URL hoặc null. Dùng cho thumbnail/avatar (affiliate KHÔNG có quyền admin/media).
   */
  static _pickAndUpload(type = 'thumbnail') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/gif,image/webp';
      // Offscreen thay vì display:none — vài context Chrome chặn .click() trên input display:none.
      input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px;';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) { resolve(null); return; }
        if (file.size > 10 * 1024 * 1024) {
          window.showNotification?.(window.I18n?.t('creator.publish.imageTooLarge') || 'Ảnh vượt quá 10MB.', 'error');
          resolve(null); return;
        }
        try {
          const dataUrl = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result);
            reader.onerror = () => rej(new Error('READ_ERROR'));
            reader.readAsDataURL(file);
          });
          const base64 = String(dataUrl).split(',')[1];
          chrome.runtime.sendMessage({
            action: 'apiRequest', method: 'POST', endpoint: 'creator-templates/media',
            token: window.authManager?.getToken(), isFormData: true,
            formDataFields: { file: { name: file.name || 'image', type: file.type || 'image/png', base64 }, type },
          }, (response) => {
            if (response?.success && response.data?.url) resolve(response.data.url);
            else { window.showNotification?.(response?.error?.message || (window.I18n?.t('creator.publish.uploadFailed') || 'Tải ảnh thất bại.'), 'error'); resolve(null); }
          });
        } catch (e) { resolve(null); }
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  static async _fetchProviderImage(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'creator:fetchImage', url }, (resp) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        if (resp?.success && resp.base64) resolve({ base64: resp.base64, mimeType: resp.mime || resp.mimeType || 'image/jpeg' });
        else resolve(null);
      });
    });
  }

  static async _fetchBlobDirect(blobUrl) {
    try {
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      const mimeType = blob.type || 'image/png';
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ base64: reader.result.split(',')[1], mimeType });
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  }

  // ---- Convert workflow → template format ----

  static _convertToTemplateFormat(workflowData, options, urlMapping = new Map()) {
    const resolveUrl = (url) => {
      if (!url || typeof url !== 'string') return null;
      if (urlMapping.has(url)) return urlMapping.get(url);
      if (url.startsWith('http://') || url.startsWith('https://')) {
        // Provider URL không upload được (vd tab đã đóng) → drop để tránh user khác không xem được.
        if (this._isProviderUrl(url)) return null;
        return url;
      }
      return null; // blob:/data: chưa upload
    };

    const nodes = (workflowData.nodes || []).map(node => {
      let refImgUrls = [];
      if (Array.isArray(node.ref_img_urls) && node.ref_img_urls.length > 0) {
        refImgUrls = node.ref_img_urls.map(resolveUrl).filter(Boolean);
      } else if (node.ref_thumbnails && typeof node.ref_thumbnails === 'object') {
        refImgUrls = Object.values(node.ref_thumbnails).map(resolveUrl).filter(Boolean);
      }

      const extraData = this._extractNodeData(node);

      const resultImgUrl = resolveUrl(node.result_img_url);
      if (resultImgUrl) extraData.result_img_url = resultImgUrl; else delete extraData.result_img_url;

      const f1 = resolveUrl(node.frame_1_thumbnail);
      if (f1) extraData.frame_1_thumbnail = f1; else delete extraData.frame_1_thumbnail;
      const f2 = resolveUrl(node.frame_2_thumbnail);
      if (f2) extraData.frame_2_thumbnail = f2; else delete extraData.frame_2_thumbnail;

      // result_thumbnails: video node → giữ poster (thumbnail) public, DROP video_url.
      if (node.result_thumbnails && typeof node.result_thumbnails === 'object') {
        const rebuilt = {};
        for (const [fid, entry] of Object.entries(node.result_thumbnails)) {
          if (!entry || typeof entry !== 'object') continue;
          const poster = resolveUrl(entry.thumbnail);
          if (poster) rebuilt[fid] = { thumbnail: poster, type: entry.type || 'image' };
        }
        if (Object.keys(rebuilt).length > 0) extraData.result_thumbnails = rebuilt;
        else delete extraData.result_thumbnails;
      }

      return {
        id: node.node_id,
        type: node.node_type,
        position: { x: node.pos_x || 0, y: node.pos_y || 0 },
        data: {
          node_name: node.node_name || '',
          label: node.node_name || node.node_type || '',
          prompt: node.prompt || '',
          model: node.model || '',
          ratio: node.ratio || '1:1',
          quantity: node.quantity || 1,
          enabled: node.enabled !== false,
          media_type: node.media_type || 'Image',
          gen_type: node.gen_type || 'flow',
          ref_img_urls: refImgUrls,
          delay_seconds: node.delay_seconds || 5,
          download_resolution: node.download_resolution || 'original',
          note_text: node.note_text || '',
          telegram_chat_id: node.telegram_chat_id || '',
          telegram_caption: node.telegram_caption || '',
          ...extraData,
        },
      };
    });

    const edges = (workflowData.edges || []).map(edge => ({
      id: edge.edge_id || (window.IdGenerator ? window.IdGenerator.next('edge') : `edge_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`),
      source: edge.source_node_id,
      target: edge.target_node_id,
      sourceHandle: edge.source_handle || 'output_1',
      targetHandle: edge.target_handle || 'input_1',
      sourcePort: edge.source_port || null,
      targetPort: edge.target_port || null,
      dataType: edge.data_type || 'image',
    }));

    return {
      name: options.name,
      description: options.description,
      thumbnail_url: options.thumbnail_url,
      nodes,
      edges,
      settings: workflowData.settings || {},
    };
  }

  static _extractNodeData(node) {
    const extra = {};
    const copyFields = [
      'auto_download', 'retry_on_fail', 'style_weight', 'quality',
      'negative_prompt', 'seed', 'cfg_scale', 'steps',
      'video_duration', 'video_fps', 'aspect_ratio',
      'system_prompt', 'temperature', 'max_tokens',
      'slug', 'slug_auto', 'prompt_mode', 'ref_mode',
      'ref_file_names',
      'angle_preset_id', 'angle_preset_name', 'angle_preset_json',
      'angle_rotation', 'angle_tilt', 'angle_zoom', 'angle_ratio', 'angle_built_prompt',
      'download_resolution', 'video_download_resolution', 'download_folder',
      'download_file_template', 'download_collect_all',
      'telegram_send_mode', 'telegram_message',
      'provider', 'prompt_source', 'multi_prompt',
      'timeout_sec', 'timeout_ms', 'use_fallback_prefix', 'max_ref_images',
      'use_ai', 'ai_fallback', 'ai_delete_after_run',
      'voice_slug', 'voice_search_value',
      'result_img_url',
      'grok_mode', 'grok_duration', 'grok_resolution', 'grok_image_quality',
      'video_input_type', 'frame_1_source', 'frame_1_file_name', 'frame_1_thumbnail',
      'frame_2_source', 'frame_2_file_name', 'frame_2_thumbnail',
      'prompts_json',
      'extract_mode', 'extract_marker', 'extract_regex', 'extract_strict',
      'extract_multi_match', 'extract_on_fail',
    ];
    copyFields.forEach(f => { if (node[f] !== undefined) extra[f] = node[f]; });
    return extra;
  }

  static async _submit(templateData) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest', method: 'POST', endpoint: 'creator-templates',
        token: window.authManager?.getToken(), data: templateData,
      }, (response) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message || 'Lỗi kết nối')); return; }
        if (!response) { reject(new Error('Không nhận được phản hồi từ server')); return; }
        if (response.success) resolve(response.data);
        else reject(new Error(response.error?.message || 'Lỗi gửi duyệt template'));
      });
    });
  }

  static _showError(modal, message) {
    const errorEl = modal.querySelector('#creatorTplError');
    const textEl = modal.querySelector('#creatorTplErrorText');
    if (errorEl && textEl) {
      textEl.textContent = message;
      errorEl.classList.remove('hidden');
      setTimeout(() => errorEl.classList.add('hidden'), 5000);
    }
  }

  static _escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  static _escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

window.CreatorTemplatePublish = CreatorTemplatePublish;
