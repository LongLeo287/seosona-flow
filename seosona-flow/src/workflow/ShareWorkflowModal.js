/**
 * ShareWorkflowModal - Modal để nhập email và share workflow
 *
 * Singleton với static show() method.
 * Gọi API POST /v1/workflows/{wf_id}/shares để chia sẻ workflow với user khác.
 *
 * Sử dụng:
 * const result = await ShareWorkflowModal.show(workflowId);
 * // result = true nếu share thành công, false nếu hủy
 */
class ShareWorkflowModal {
  static _instance = null;

  /**
   * Hiển thị modal chia sẻ workflow
   * @param {string|number} wfId - ID của workflow cần share
   * @returns {Promise<boolean>} - true nếu share thành công, false nếu hủy
   */
  static async show(wfId) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;

    // Offline: chia sẻ workflow cần backend + tài khoản người nhận → chặn tại 1 điểm (mọi lối vào:
    // sidebar handleShare + editor _shareWorkflow). Thông báo rõ thay vì mở modal rồi fail generic.
    if (self.SEOSONA_LOCAL_MODE !== false) {
      window.showNotification?.(t('workflow.shareRequiresOnline', 'Chia sẻ workflow cần tài khoản online — không khả dụng ở chế độ local.'), 'info', 4000);
      return false;
    }

    // Đóng modal cũ nếu có
    this._close();

    return new Promise((resolve) => {
      // Tạo modal
      const modal = this._createModal();
      document.body.appendChild(modal);
      this._instance = modal;

      // Bind events
      this._bindEvents(modal, wfId, resolve);

      // Hiển thị modal với animation
      requestAnimationFrame(() => {
        modal.classList.add('visible');
        // Focus vào input email
        const emailInput = modal.querySelector('#shareWorkflowEmail');
        emailInput?.focus();
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
   * Kiểm tra email hợp lệ
   * @param {string} email
   * @returns {boolean}
   */
  static isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  /**
   * Tạo HTML cho modal
   */
  static _createModal() {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;

    const modal = document.createElement('div');
    modal.className = 'share-workflow-modal';
    modal.innerHTML = `
      <div class="share-workflow-backdrop"></div>
      <div class="share-workflow-content">
        <div class="share-workflow-header">
          <h3>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3"/>
              <circle cx="6" cy="12" r="3"/>
              <circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            ${t('workflow.share.title', 'Chia sẻ Workflow')}
          </h3>
          <button class="share-workflow-close" type="button" aria-label="${t('common.close', 'Đóng')}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="share-workflow-body">
          <!-- Email -->
          <div class="share-workflow-field">
            <label for="shareWorkflowEmail">${t('workflow.share.emailLabel', 'Email người nhận')} <span class="required">*</span></label>
            <input type="email"
                   id="shareWorkflowEmail"
                   placeholder="${t('workflow.share.emailPlaceholder', 'Nhập email của người bạn muốn chia sẻ...')}"
                   required
                   maxlength="255"
                   autocomplete="email" />
          </div>

          <!-- Note -->
          <div class="share-workflow-field">
            <label for="shareWorkflowNote">
              ${t('workflow.share.noteLabel', 'Ghi chú')}
              <span class="char-count"><span id="shareWorkflowNoteCount">0</span>/500</span>
            </label>
            <textarea id="shareWorkflowNote"
                      rows="3"
                      placeholder="${t('workflow.share.notePlaceholder', 'Thêm ghi chú cho người nhận (tùy chọn)...')}"
                      maxlength="500"></textarea>
          </div>

          <!-- Thông báo lỗi inline -->
          <div class="share-workflow-error hidden" id="shareWorkflowError">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span id="shareWorkflowErrorText"></span>
          </div>
        </div>

        <div class="share-workflow-footer">
          <button class="btn btn-secondary" type="button" id="shareWorkflowCancelBtn">${t('common.cancel', 'Hủy')}</button>
          <button class="btn btn-primary" type="button" id="shareWorkflowSubmitBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="5" r="3"/>
              <circle cx="6" cy="12" r="3"/>
              <circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            ${t('workflow.share.submit', 'Chia sẻ')}
          </button>
        </div>
      </div>

      <style>
        /* ShareWorkflowModal - sync với imgpicker-modal pattern */
        .share-workflow-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000010;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s ease, visibility 0.2s ease;
        }

        .share-workflow-modal.visible {
          opacity: 1;
          visibility: visible;
        }

        .share-workflow-backdrop {
          position: absolute;
          inset: 0;
        }

        .share-workflow-content {
          position: relative;
          width: 92%;
          max-width: 420px;
          max-height: 85vh;
          background: var(--card, #1c1c1f);
          border-radius: 12px;
          border: 1px solid var(--border, #1e3050);
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          overflow: hidden;
        }

        .share-workflow-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border, #1e3050);
        }

        .share-workflow-header h3 {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          color: var(--foreground, #f8fafc);
        }

        .share-workflow-header h3 svg {
          color: var(--primary);
        }

        .share-workflow-close {
          background: none;
          border: none;
          color: var(--muted-foreground, #8b8b92);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          transition: all 150ms;
        }

        .share-workflow-close:hover {
          color: var(--foreground, #f8fafc);
          background: var(--surface, #252529);
        }

        .share-workflow-body {
          padding: 20px;
          overflow-y: auto;
          flex: 1;
        }

        .share-workflow-field {
          margin-bottom: 16px;
        }

        .share-workflow-field:last-child {
          margin-bottom: 0;
        }

        .share-workflow-field label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 6px;
          font-size: 13px;
          font-weight: 500;
          color: var(--foreground, #f8fafc);
        }

        .share-workflow-field label .required {
          color: var(--destructive, #ef4444);
        }

        .share-workflow-field label .char-count {
          font-weight: 400;
          font-size: 11px;
          color: var(--muted-foreground, #8b8b92);
        }

        .share-workflow-field input,
        .share-workflow-field textarea {
          width: 100%;
          padding: 10px 12px;
          font-size: 13px;
          line-height: 1.5;
          color: var(--foreground, #f8fafc);
          background: var(--surface, #252529);
          border: 1px solid var(--border, #1e3050);
          border-radius: 8px;
          outline: none;
          transition: border-color 150ms, box-shadow 150ms;
        }

        .share-workflow-field input:focus,
        .share-workflow-field textarea:focus {
          border-color: var(--primary);
          box-shadow: 0 0 0 2px rgba(61, 111, 245, 0.15);
        }

        .share-workflow-field input.error,
        .share-workflow-field textarea.error {
          border-color: var(--destructive, #ef4444);
        }

        .share-workflow-field input::placeholder,
        .share-workflow-field textarea::placeholder {
          color: var(--muted-foreground, #8b8b92);
        }

        .share-workflow-field textarea {
          resize: vertical;
          min-height: 80px;
        }

        .share-workflow-error {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 12px;
          margin-top: 16px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 8px;
          color: var(--destructive, #ef4444);
          font-size: 12px;
          line-height: 1.4;
        }

        .share-workflow-error.hidden {
          display: none;
        }

        .share-workflow-error svg {
          flex-shrink: 0;
          margin-top: 1px;
        }

        .share-workflow-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          padding: 16px 20px;
          border-top: 1px solid var(--border, #1e3050);
        }

        .share-workflow-footer .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 500;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 150ms;
        }

        .share-workflow-footer .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .share-workflow-footer .btn-secondary {
          background: var(--surface, #252529);
          color: var(--foreground, #f8fafc);
        }

        .share-workflow-footer .btn-secondary:hover:not(:disabled) {
          background: var(--muted, #2e2e33);
        }

        .share-workflow-footer .btn-primary {
          background: var(--primary);
          color: var(--primary-foreground);
        }

        .share-workflow-footer .btn-primary:hover:not(:disabled) {
          filter: brightness(1.1);
        }

        .share-workflow-footer .btn .spin {
          animation: share-spin 1s linear infinite;
        }

        @keyframes share-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      </style>
    `;

    return modal;
  }

  /**
   * Bind các sự kiện cho modal
   */
  static _bindEvents(modal, wfId, resolve) {
    const closeBtn = modal.querySelector('.share-workflow-close');
    const cancelBtn = modal.querySelector('#shareWorkflowCancelBtn');
    const submitBtn = modal.querySelector('#shareWorkflowSubmitBtn');
    const backdrop = modal.querySelector('.share-workflow-backdrop');
    const emailInput = modal.querySelector('#shareWorkflowEmail');
    const noteTextarea = modal.querySelector('#shareWorkflowNote');
    const noteCount = modal.querySelector('#shareWorkflowNoteCount');

    // Đóng modal
    const handleClose = () => {
      this._close();
      resolve(false);
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

    // Đếm ký tự note
    noteTextarea?.addEventListener('input', () => {
      const count = noteTextarea.value.length;
      if (noteCount) {
        noteCount.textContent = count;
      }
    });

    // Clear error khi user bắt đầu nhập
    emailInput?.addEventListener('input', () => {
      emailInput.classList.remove('error');
      this._hideError(modal);
    });

    // Submit khi nhấn Enter trong input email
    emailInput?.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await this._handleSubmit(modal, wfId, resolve);
      }
    });

    // Click nút Chia sẻ
    submitBtn?.addEventListener('click', async () => {
      await this._handleSubmit(modal, wfId, resolve);
    });
  }

  /**
   * Xử lý submit form
   */
  static async _handleSubmit(modal, wfId, resolve) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    const emailInput = modal.querySelector('#shareWorkflowEmail');
    const noteTextarea = modal.querySelector('#shareWorkflowNote');
    const submitBtn = modal.querySelector('#shareWorkflowSubmitBtn');

    const email = emailInput?.value?.trim();
    const note = noteTextarea?.value?.trim() || '';

    // Validate email
    if (!email) {
      this._showError(modal, t('workflow.share.emailRequired', 'Vui lòng nhập email người nhận'));
      emailInput?.classList.add('error');
      emailInput?.focus();
      return;
    }

    if (!this.isValidEmail(email)) {
      this._showError(modal, t('workflow.share.emailInvalid', 'Email không hợp lệ'));
      emailInput?.classList.add('error');
      emailInput?.focus();
      return;
    }

    // Disable button và hiện loading
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
        <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
      </svg>
      ${t('workflow.share.submitting', 'Đang chia sẻ...')}
    `;

    try {
      // Gọi API share workflow
      const result = await this._submitShare(wfId, email, note);

      // Thành công — toast khác biệt nếu là re-share (auto-revoked share cũ)
      this._close();
      const successMsg = result?.replaced
        ? (result.message || t('workflow.share.successResend', 'Đã gửi lại lời mời chia sẻ workflow'))
        : (result?.message || t('workflow.share.success', 'Đã gửi lời mời chia sẻ workflow thành công'));
      window.showNotification?.(successMsg, 'success');
      resolve(true);

    } catch (err) {
      console.error('[ShareWorkflowModal] Lỗi chia sẻ:', err);

      const httpStatus = err.httpStatus;
      const errorCode = err.code;
      let errorMessage = err.message;

      // Xử lý các lỗi cụ thể — chỉ match theo error code, KHÔNG match theo text
      // (text match sai cho mọi error message tiếng Việt có từ "email")
      if (httpStatus === 422) {
        if (errorCode === 'INVALID_RECIPIENT' || errorCode === 'SHARE_SELF') {
          errorMessage = t('workflow.share.errorShareSelf', 'Bạn không thể chia sẻ workflow với chính mình');
        } else if (errorCode === 'EMAIL_INVALID') {
          errorMessage = t('workflow.share.errorEmailInvalid', 'Email không hợp lệ hoặc người dùng không tồn tại');
        } else if (errorCode === 'SHARE_EXISTS' || errorCode === 'ALREADY_SHARED') {
          errorMessage = t('workflow.share.errorAlreadyShared', 'Workflow đã được chia sẻ với người này');
        } else {
          // Default: hiển thị message thẳng từ backend
          errorMessage = err.message || t('workflow.share.errorValidation', 'Dữ liệu không hợp lệ');
        }
        this._showError(modal, errorMessage);
        emailInput?.classList.add('error');
      } else if (httpStatus === 403) {
        // Feature lock / email not verified
        if (errorCode === 'FEATURE_DISABLED') {
          errorMessage = err.message || t('workflow.share.errorFeatureDisabled', 'Tính năng chia sẻ workflow chưa được kích hoạt cho gói của bạn.');
        } else if (errorCode === 'EMAIL_NOT_VERIFIED') {
          errorMessage = err.message || t('workflow.share.errorEmailNotVerified', 'Bạn cần xác thực email trước khi chia sẻ workflow.');
        } else {
          errorMessage = err.message || t('workflow.share.error', 'Không thể chia sẻ workflow');
        }
        this._showError(modal, errorMessage);
      } else if (httpStatus === 429) {
        // Rate limit
        errorMessage = t('workflow.share.errorRateLimit', 'Bạn đã gửi quá nhiều lời mời. Vui lòng thử lại sau.');
        this._showError(modal, errorMessage);
      } else {
        // Các lỗi khác - hiện toast
        window.showNotification?.(
          err.message || t('workflow.share.error', 'Không thể chia sẻ workflow'),
          'error'
        );
      }

      // Restore button
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="18" cy="5" r="3"/>
          <circle cx="6" cy="12" r="3"/>
          <circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        ${t('workflow.share.submit', 'Chia sẻ')}
      `;
    }
  }

  /**
   * Gọi API share workflow
   */
  static async _submitShare(wfId, email, note) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest',
        method: 'POST',
        endpoint: `workflows/${wfId}/shares`,
        token: window.authManager?.getToken(),
        data: {
          recipient_email: email,
          note: note || null
        }
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
          // Resolve full response để caller lấy được flag `replaced` + `message`
          resolve({
            data: response.data,
            replaced: response.replaced || false,
            replacedPreviousStatus: response.replaced_previous_status || null,
            message: response.message || null,
          });
        } else {
          const error = new Error(response.error?.message || 'Lỗi chia sẻ workflow');
          error.code = response.error?.code;
          error.httpStatus = response.httpStatus;
          reject(error);
        }
      });
    });
  }

  /**
   * Hiển thị thông báo lỗi inline
   */
  static _showError(modal, message) {
    const errorEl = modal.querySelector('#shareWorkflowError');
    const textEl = modal.querySelector('#shareWorkflowErrorText');

    if (errorEl && textEl) {
      textEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
  }

  /**
   * Ẩn thông báo lỗi inline
   */
  static _hideError(modal) {
    const errorEl = modal.querySelector('#shareWorkflowError');
    if (errorEl) {
      errorEl.classList.add('hidden');
    }
  }
}

// Export để dùng global
window.ShareWorkflowModal = ShareWorkflowModal;
