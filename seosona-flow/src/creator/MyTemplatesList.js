/**
 * MyTemplatesList — "Template của tôi" cho affiliate quản lý community template.
 * Plan: AFFILIATE_CREATOR_PAGE_PLAN.md (§7.1). RENDER INLINE vào tab Workflow (không modal).
 * UI dạng CARD GRID giống Workflow Template (reuse class wf-template-*) + skeleton loading.
 * Mỗi card: thumbnail + tên + node + lượt clone + badge trạng thái duyệt + actions (ẩn/hiện/xoá).
 * Cấu hình slug/avatar → icon setting (gear) ở header → link dashboard/account.
 *
 * MyTemplatesList.renderInto(containerEl)
 */
class MyTemplatesList {
  /** Render vào container (pane tab Workflow): toolbar + grid (skeleton → cards). */
  static async renderInto(container) {
    if (!container) return;
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    const accountUrl = (window.ApiBaseConfig?.getWebBase?.() || '') + '/dashboard/account';
    const cfgTitle = t('creator.myTemplates.configProfile', 'Cấu hình trang /@slug & ảnh đại diện ở Dashboard');
    container.innerHTML = `
      <div class="my-templates-inline">
        <div class="my-templates-toolbar">
          <span class="my-templates-title" id="mtSlugLeft">${t('creator.myTemplates.title', 'Template của tôi')}</span>
          <a href="${accountUrl}" target="_blank" rel="noreferrer" class="my-templates-settings-btn" data-tooltip="${cfgTitle}" data-tooltip-pos="left" aria-label="${cfgTitle}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </a>
        </div>
        <div class="wf-template-grid my-templates-grid" id="myTemplatesBody">${this._renderSkeletons()}</div>
        <div style="margin-top:10px;"><button class="btn btn-secondary wf-load-more hidden" id="mtLoadMore">${t('workflow.loadMore', 'Tải thêm')}</button></div>
      </div>
    `;
    this._page = 1; this._lastPage = 1; // reset pagination mỗi lần render (đổi account / mở lại tab)
    // Bind nút "Tải thêm" → load trang kế (append).
    const grid = container.querySelector('#myTemplatesBody');
    const loadMore = container.querySelector('#mtLoadMore');
    if (loadMore) loadMore.addEventListener('click', () => this._loadListInto(grid, true));
    // Song song: cập nhật link @slug bên trái + load danh sách (skeleton hiện ngay).
    this._loadProfileLink(container.querySelector('#mtSlugLeft'));
    await this._loadListInto(grid);
  }

  /** Lấy slug + page_url → render @slug bên trái (click ra trang profile). Chưa có slug → giữ tiêu đề. */
  static async _loadProfileLink(el) {
    if (!el) return;
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    try {
      const resp = await this._api('GET', 'affiliate/creator-profile');
      const p = resp?.success ? resp.data : null;
      this._pageUrl = p?.page_url || null; // dùng cho copy-link template approved+public
      if (p?.slug && p?.page_url) {
        const name = (p.display_name || p.slug || '').trim();
        const initial = this._escapeHtml((name || '?').charAt(0).toUpperCase());
        const avatar = p.avatar_url
          ? `<img class="mt-slug-avatar" src="${this._escapeHtml(p.avatar_url)}" alt="" referrerpolicy="no-referrer">`
          : `<span class="mt-slug-avatar mt-slug-avatar--text">${initial}</span>`;
        el.outerHTML = `<a href="${this._escapeHtml(p.page_url)}" target="_blank" rel="noreferrer"
          class="my-templates-slug-link" id="mtSlugLeft"
          data-tooltip="${t('creator.myTemplates.viewPage', 'Xem trang công khai của bạn')}" data-tooltip-pos="right">${avatar}<span>@${this._escapeHtml(p.slug)}</span></a>`;
      }
    } catch (e) { /* giữ tiêu đề mặc định */ }
  }

  /** Skeleton cards (giống WorkflowTemplateList) — hiển thị khi đang tải. */
  static _renderSkeletons() {
    const one = `
      <div class="wf-template-card skeleton">
        <div class="wf-template-thumb skeleton-thumb"></div>
        <div class="wf-template-info">
          <div class="skeleton-text"></div>
          <div class="skeleton-text short"></div>
        </div>
      </div>`;
    return one.repeat(4);
  }

  static async _loadListInto(grid, append = false) {
    if (!grid) return;
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    const loadMoreBtn = grid.parentElement?.querySelector('#mtLoadMore');
    if (append && loadMoreBtn) { loadMoreBtn.disabled = true; loadMoreBtn.textContent = t('workflow.loading', 'Đang tải...'); }
    try {
      const page = append ? (this._page || 1) + 1 : 1;
      const resp = await this._api('GET', `creator-templates?page=${page}&per_page=20`);
      const items = (resp?.success && Array.isArray(resp.data)) ? resp.data : [];
      const meta = resp?.meta || {};
      this._page = meta.current_page || page;
      this._lastPage = meta.last_page || 1;

      if (append) {
        this._items = (this._items || []).concat(items); // lookup khi edit metadata
        grid.insertAdjacentHTML('beforeend', items.map(it => this._renderCard(it)).join(''));
      } else {
        this._items = items;
        if (!items.length) {
          grid.innerHTML = `<div class="my-templates-empty">${t('creator.myTemplates.empty', 'Bạn chưa xuất bản template nào. Mở một workflow và chọn "Xuất bản Template".')}</div>`;
          if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
          return;
        }
        grid.innerHTML = items.map(it => this._renderCard(it)).join('');
      }
      this._bindRows(grid); // data-bound guard → chỉ bind card mới (append an toàn)
      if (loadMoreBtn) {
        loadMoreBtn.classList.toggle('hidden', this._page >= this._lastPage);
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = t('workflow.loadMore', 'Tải thêm');
      }
    } catch (e) {
      if (append) {
        if (loadMoreBtn) { loadMoreBtn.disabled = false; loadMoreBtn.textContent = t('workflow.loadMore', 'Tải thêm'); }
      } else {
        grid.innerHTML = `<div class="my-templates-empty">${t('creator.myTemplates.loadError', 'Không tải được danh sách.')}</div>`;
      }
    }
  }

  static _statusBadge(it) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    if (it.review_status === 'approved') return `<span class="mt-badge mt-badge-ok">${t('creator.status.approved', 'Đã duyệt')}</span>`;
    if (it.review_status === 'rejected') return `<span class="mt-badge mt-badge-rejected">${t('creator.status.rejected', 'Từ chối')}</span>`;
    return `<span class="mt-badge mt-badge-pending">${t('creator.status.pending', 'Chờ duyệt')}</span>`;
  }

  /** Card 1 template — reuse layout wf-template-card. */
  static _renderCard(it) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    const esc = (s) => this._escapeHtml(s);
    const thumb = it.thumbnail_url || it.diagram_url || '';
    const thumbStyle = thumb
      ? `background-image: url('${esc(thumb)}')`
      : 'background: linear-gradient(135deg, var(--muted) 0%, var(--surface) 100%)';
    const isApproved = it.review_status === 'approved';
    const publicBadge = (isApproved && it.is_public)
      ? `<span class="mt-card-public" title="public">●</span>` : '';
    const rejectReason = it.review_status === 'rejected' && it.reject_reason
      ? `<div class="mt-card-reject" title="${esc(it.reject_reason)}">${t('creator.myTemplates.reason', 'Lý do')}: ${esc(it.reject_reason)}</div>` : '';
    const toggleBtn = isApproved
      ? (it.is_public
          ? `<button class="btn btn-sm btn-secondary mt-icon-btn" data-act="unpublish" data-id="${it.id}" data-tooltip="${t('creator.myTemplates.hide', 'Ẩn')}" data-tooltip-pos="top">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
            </button>`
          : `<button class="btn btn-sm btn-secondary mt-icon-btn" data-act="republish" data-id="${it.id}" data-tooltip="${t('creator.myTemplates.showPublic', 'Hiện')}" data-tooltip-pos="top">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>`)
      : '';
    // Copy link công khai — chỉ template ĐÃ DUYỆT + đang public (mới có URL khách xem được).
    const copyBtn = (isApproved && it.is_public)
      ? `<button class="btn btn-sm btn-secondary mt-icon-btn" data-act="copy-link" data-id="${it.id}" data-slug="${esc(it.slug || '')}" data-tooltip="${t('creator.myTemplates.copyLink', 'Copy link công khai')}" data-tooltip-pos="top">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>`
      : '';
    return `
      <div class="wf-template-card mt-card" data-row="${it.id}">
        <div class="wf-template-thumb" style="${thumbStyle}">
          ${!thumb ? `<svg class="wf-template-placeholder" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>` : ''}
          <button class="mt-thumb-view" data-act="preview" data-id="${it.id}" title="${t('creator.myTemplates.preview', 'Xem trước')}" aria-label="${t('creator.myTemplates.preview', 'Xem trước')}">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <div class="mt-card-status">${this._statusBadge(it)} ${publicBadge}</div>
        </div>
        <div class="wf-template-info">
          <div class="wf-template-name" title="${esc(it.name)}">${esc(it.name) || t('workflow.unnamed', 'Không tên')}</div>
          <div class="wf-template-meta">
            <span class="wf-template-nodes-count">${it.node_count || 0} ${t('workflow.nodes', 'nodes')}</span>
          </div>
          ${rejectReason}
          <div class="wf-template-footer mt-card-footer">
            <span class="wf-template-use-count" title="${t('creator.myTemplates.uses', 'lượt clone')}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
              ${it.use_count || 0}
            </span>
            <div class="mt-card-actions">
              <button class="btn btn-sm btn-secondary mt-icon-btn" data-act="edit-meta" data-id="${it.id}" data-tooltip="${t('creator.edit.metaTooltip', 'Sửa thông tin (tên/ảnh/mô tả)')}" data-tooltip-pos="top">
                <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 15.7502H9.75002M1.875 16.1252L6.03695 14.5245C6.30316 14.4221 6.43626 14.3709 6.56079 14.3041C6.6714 14.2447 6.77685 14.1761 6.87603 14.0992C6.98769 14.0125 7.08853 13.9117 7.29021 13.71L15.75 5.25023C16.5784 4.4218 16.5784 3.07865 15.75 2.25023C14.9216 1.4218 13.5784 1.4218 12.75 2.25022L4.29021 10.71C4.08853 10.9117 3.98769 11.0125 3.90104 11.1242C3.82408 11.2234 3.75555 11.3288 3.69618 11.4394C3.62933 11.564 3.57814 11.6971 3.47575 11.9633L1.875 16.1252ZM1.875 16.1252L3.41859 12.1119C3.52905 11.8248 3.58428 11.6812 3.67901 11.6154C3.76179 11.5579 3.86423 11.5362 3.96322 11.5551C4.0765 11.5767 4.18529 11.6855 4.40286 11.9031L6.09718 13.5974C6.31475 13.815 6.42354 13.9237 6.44517 14.037C6.46408 14.136 6.44234 14.2385 6.38486 14.3212C6.31908 14.416 6.17549 14.4712 5.8883 14.5817L1.875 16.1252Z"/></svg>
              </button>
              <button class="btn btn-sm btn-secondary mt-icon-btn" data-act="edit-content" data-id="${it.id}" data-tooltip="${t('creator.edit.contentTooltip', 'Sửa nội dung workflow (gửi duyệt lại)')}" data-tooltip-pos="top">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><path fill-rule="evenodd" d="M12.123 15.292c-.587-1.927 1.198-3.775 3.158-3.155l5.955 1.848.003.001c2.33.733 2.35 4.024.04 4.801v.001l-1.63.55h-.004a.5.5 0 0 0-.325.322l-.003.01-.55 1.63c-.782 2.339-4.067 2.273-4.792-.052l-1.85-5.95zm2.555-1.248a.52.52 0 0 0-.642.665l1.849 5.943.034.087a.516.516 0 0 0 .952-.075l.001-.003.55-1.63c.237-.718.78-1.27 1.454-1.539l.138-.05 1.626-.55h.002c.487-.163.467-.85-.002-.997l-5.956-1.85z" clip-rule="evenodd"></path><path d="M15 1c2.599 0 4.678.514 6.082 1.918S23 6.401 23 9v3a1 1 0 1 1-2 0V9c0-2.401-.486-3.822-1.332-4.668S17.401 3 15 3H9c-2.401 0-3.822.486-4.668 1.332S3 6.599 3 9v6c0 2.401.486 3.822 1.332 4.668S6.599 21 9 21h3a1 1 0 1 1 0 2H9c-2.599 0-4.678-.514-6.082-1.918S1 17.599 1 15V9c0-2.599.514-4.678 1.918-6.082S6.401 1 9 1z"></path></g></svg>
              </button>
              ${copyBtn}
              ${toggleBtn}
              <button class="btn btn-sm btn-danger mt-icon-btn" data-act="delete" data-id="${it.id}" data-tooltip="${t('common.delete', 'Xoá')}" data-tooltip-pos="top">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }

  static _bindRows(grid) {
    grid.querySelectorAll('[data-act]').forEach(btn => {
      if (btn.dataset.bound) return; // tránh bind trùng khi append (load-more) re-gọi _bindRows
      btn.dataset.bound = '1';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const act = btn.getAttribute('data-act');
        const id = btn.getAttribute('data-id');
        // Sửa metadata (modal, giữ approved) — KHÔNG đụng nodes.
        if (act === 'edit-meta') {
          const item = (this._items || []).find(x => String(x.id) === String(id));
          if (item && window.CreatorTemplatePublish?.showEditMetadata) {
            const res = await window.CreatorTemplatePublish.showEditMetadata(item);
            if (res?.success) await this._loadListInto(grid);
          }
          return;
        }
        // Xem trước (readonly) — fetch full (owner) → mở preview popup giống deep-link web.
        if (act === 'preview') {
          this._previewWorkflow(id);
          return;
        }
        // Sửa nội dung workflow → mở editor (gửi duyệt lại). Không reload list ở đây.
        if (act === 'edit-content') {
          this._editWorkflowContent(id);
          return;
        }
        // Copy link công khai (trang /seosonaflow/@slug + ?t=template-slug).
        if (act === 'copy-link') {
          const t = (k, f) => window.I18n?.t(k) || f;
          if (!this._pageUrl) {
            window.showNotification?.(t('creator.myTemplates.noPageUrl', 'Hãy cấu hình slug trang cá nhân ở Dashboard trước.'), 'info', 4000);
            return;
          }
          const slug = btn.getAttribute('data-slug');
          // Link tới trang detail riêng của template (/seosonaflow/@slug/workflows/{template-slug}).
          const url = this._pageUrl + (slug ? `/workflows/${encodeURIComponent(slug)}` : '');
          navigator.clipboard?.writeText(url).then(() => {
            window.showNotification?.(t('creator.myTemplates.linkCopied', 'Đã copy link') + ': ' + url, 'success', 3000);
          }).catch(() => window.showNotification?.(t('creator.myTemplates.copyFailed', 'Không thể copy link'), 'error'));
          return;
        }
        if (act === 'delete') {
          const _msg = window.I18n?.t('creator.myTemplates.confirmDelete') || 'Xoá template này?';
          const _ok = window.customDialog
            ? await window.customDialog.confirmDangerous(_msg)
            : confirm(_msg);
          if (!_ok) return;
          await this._api('DELETE', `creator-templates/${id}`);
        } else if (act === 'unpublish') {
          await this._api('POST', `creator-templates/${id}/unpublish`);
        } else if (act === 'republish') {
          await this._api('POST', `creator-templates/${id}/republish`);
        }
        await this._loadListInto(grid);
      });
    });
  }

  /**
   * [Preview] Xem trước template (readonly) — fetch full (owner, kể cả pending) → openWorkflowTemplatePreview
   * → popup workflow-editor readonly (giống deep-link "Use" từ web).
   */
  static async _previewWorkflow(id) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    try {
      const resp = await this._api('GET', `creator-templates/${id}/edit`);
      if (!resp?.success || !resp.data) {
        window.showNotification?.(t('creator.edit.loadError', 'Không tải được template để xem trước.'), 'error');
        return;
      }
      chrome.runtime.sendMessage({ action: 'openWorkflowTemplatePreview', template: resp.data }, (r) => {
        if (!r?.ok) window.showNotification?.(window.I18n?.t('workflow.popupBlocked') || 'Không thể mở cửa sổ xem trước.', 'warning');
      });
    } catch (e) {
      window.showNotification?.(t('creator.edit.loadError', 'Không tải được template để xem trước.'), 'error');
    }
  }

  /**
   * [Edit content] Mở community template trong CỬA SỔ TEMPLATE-EDITOR (giống admin sửa template) —
   * KHÔNG dùng workflow-editor (vốn gate Flow project). Mirror admin `_openTemplateForEdit`:
   * fetch full (owner) → lưu _pendingTemplate (gắn cờ _creator_edit) → mở window template editor.
   * Init đọc pending → editor.openCreatorTemplateForEdit → save → PUT creator update + re-review.
   */
  static async _editWorkflowContent(id) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    try {
      const resp = await this._api('GET', `creator-templates/${id}/edit`);
      if (!resp?.success || !resp.data) {
        window.showNotification?.(t('creator.edit.loadError', 'Không tải được template để sửa.'), 'error');
        return;
      }
      const template = resp.data;
      template._creator_edit = true; // cờ để template-editor-init route sang openCreatorTemplateForEdit
      await new Promise((res) => chrome.storage.local.set({ _pendingTemplate: template }, () => res()));
      // Truyền CẢ template trong message → nếu cửa sổ editor đang mở (reuse), loadTemplateInEditor
      // có d.template để route đúng (tránh openCreateMode trống). New window vẫn đọc _pendingTemplate.
      chrome.runtime.sendMessage({ action: 'openTemplateEditor', data: { mode: 'edit', templateId: template.id, template } }, (r) => {
        if (!r?.ok) window.showNotification?.(window.I18n?.t('workflow.popupBlocked') || 'Không thể mở cửa sổ editor.', 'warning');
      });
    } catch (e) {
      window.showNotification?.(t('creator.edit.loadError', 'Không tải được template để sửa.'), 'error');
    }
  }

  static _api(method, endpoint, data) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest', method, endpoint,
        token: window.authManager?.getToken(), data: data || undefined,
      }, (r) => { if (chrome.runtime.lastError) { resolve(null); return; } resolve(r); });
    });
  }

  static _escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
}

window.MyTemplatesList = MyTemplatesList;
