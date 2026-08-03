/**
 * AlbumCreateModal - Modal tạo album mới
 * S9.2: ImagePickerModal integration
 * S9.3: Batch select multiple images
 * S9.5: Compress thumbnails trước khi lưu
 */
(function() {
  'use strict';

  class AlbumCreateModal {
    constructor() {
      this._overlay = null;
      this._onSuccess = null;
      this._selectedImages = [];  // S9.3: Batch selected images
    }

    /**
     * Hiển thị modal tạo album
     * @param {Function} onSuccess - Callback khi tạo thành công
     */
    show(onSuccess = null) {
      this._onSuccess = onSuccess;
      this._selectedImages = [];  // Reset selected images
      this._render();
      this._bindEvents();
    }

    close() {
      if (this._overlay) {
        this._overlay.remove();
        this._overlay = null;
      }
      if (this._escHandler) {
        document.removeEventListener('keydown', this._escHandler);
        this._escHandler = null;
      }
      this._selectedImages = [];
    }

    _render() {
      this.close();

      this._overlay = document.createElement('div');
      this._overlay.className = 'album-modal-overlay';
      this._overlay.innerHTML = `
        <div class="album-modal">
          <div class="album-modal-header">
            <div class="album-modal-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              ${window.I18n?.t('albums.createAlbum') || 'Tạo album mới'}
            </div>
            <button class="album-modal-close" id="albumModalClose">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <div class="album-modal-body">
            <div class="album-form-group">
              <label class="album-form-label" for="albumNameInput">${window.I18n?.t('albums.albumName') || 'Tên album'}</label>
              <input type="text" id="albumNameInput" class="album-form-input"
                placeholder="${window.I18n?.t('albums.namePlaceholder') || 'Nhập tên album...'}" maxlength="100" autofocus />
              <p class="album-form-hint">${window.I18n?.t('albums.nameHint') || 'Đặt tên để dễ dàng tìm kiếm và quản lý.'}</p>
            </div>

            <!-- S9.2: Image selection section -->
            <div class="album-form-group">
              <label class="album-form-label">${window.I18n?.t('albums.addImages') || 'Thêm ảnh (tùy chọn)'}</label>
              <!-- Action buttons row - similar to tab_gen style -->
              <div class="album-create-action-row">
                <button class="btn-album-upload" id="albumUploadBtn" title="${window.I18n?.t('albums.uploadTooltip') || 'Chọn ảnh từ thư viện hoặc kéo thả file'}">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  <span>${window.I18n?.t('albums.uploadBtn') || 'Tải ảnh lên'}</span>
                </button>
                <button class="btn-album-capture" id="albumCaptureBtn" title="${window.I18n?.t('albums.captureTooltip') || 'Chụp màn hình'}">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                </button>
              </div>
              <!-- Images preview -->
              <div class="album-create-images-zone" id="albumCreateImagesZone">
                <div class="album-create-images-empty" id="albumCreateImagesEmpty">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                  </svg>
                  <span>${window.I18n?.t('albums.noImagesSelected') || 'Chưa chọn ảnh nào'}</span>
                </div>
                <div class="album-create-images-grid" id="albumCreateImagesGrid" style="display: none;"></div>
              </div>
              <p class="album-form-hint">${window.I18n?.t('albums.canAddLater') || 'Bạn có thể thêm ảnh sau khi tạo album.'}</p>
            </div>
          </div>

          <div class="album-modal-footer">
            <button class="btn btn-secondary" id="albumCancelBtn">${window.I18n?.t('common.cancel') || 'Hủy'}</button>
            <button class="btn btn-primary" id="albumCreateSubmitBtn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              ${window.I18n?.t('albums.createBtn') || 'Tạo album'}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(this._overlay);

      // Focus input
      setTimeout(() => {
        const input = this._overlay.querySelector('#albumNameInput');
        input?.focus();
      }, 100);
    }

    _bindEvents() {
      if (!this._overlay) return;

      // Close buttons
      this._overlay.querySelector('#albumModalClose')?.addEventListener('click', () => this.close());
      this._overlay.querySelector('#albumCancelBtn')?.addEventListener('click', () => this.close());

      // Click overlay để đóng
      this._overlay.addEventListener('click', (e) => {
        if (e.target === this._overlay) this.close();
      });

      // ESC để đóng
      this._escHandler = (e) => {
        if (e.key === 'Escape') {
          this.close();
        }
      };
      document.addEventListener('keydown', this._escHandler);

      // Submit button
      const submitBtn = this._overlay.querySelector('#albumCreateSubmitBtn');
      const nameInput = this._overlay.querySelector('#albumNameInput');

      submitBtn?.addEventListener('click', () => this._handleSubmit());

      // Enter để submit
      nameInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this._handleSubmit();
        }
      });

      // Chan mouse events leak
      ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(evt => {
        this._overlay.addEventListener(evt, (e) => e.stopPropagation());
      });

      // S9.2: Upload images button
      const uploadBtn = this._overlay.querySelector('#albumUploadBtn');
      uploadBtn?.addEventListener('click', () => this._openImagePicker());

      // Capture button
      const captureBtn = this._overlay.querySelector('#albumCaptureBtn');
      captureBtn?.addEventListener('click', () => this._startCapture());
    }

    /**
     * Start screen capture for album
     */
    _startCapture() {
      // Close modal temporarily
      const modalContent = this._overlay?.querySelector('.album-modal');
      if (modalContent) {
        modalContent.style.display = 'none';
      }

      // Trigger screen capture
      if (window.eventBus) {
        // Listen for capture result
        const handler = (data) => {
          window.eventBus.off('capture:complete', handler);
          // Show modal again
          if (modalContent) {
            modalContent.style.display = '';
          }

          if (data?.fileId && data?.thumbnail) {
            this._addSelectedImages([{
              fileId: data.fileId,
              thumbnail: data.thumbnail,
              name: `capture_${Date.now()}`,
              fileName: null
            }]);
          }
        };
        window.eventBus.on('capture:complete', handler);

        // Start capture (will hide sidebar automatically)
        window.eventBus.emit('capture:start', { source: 'album_create' });
      }
    }

    /**
     * S9.2: Mở ImagePickerModal để chọn ảnh
     */
    _openImagePicker() {
      if (!window.ImagePickerModal) {
        console.warn('[AlbumCreateModal] ImagePickerModal not available');
        return;
      }

      const modal = new window.ImagePickerModal();
      modal.open({
        multiple: true,  // S9.3: Batch select
        onConfirm: (selectedImages) => {
          this._addSelectedImages(selectedImages);
        }
      });
    }

    /**
     * S9.3: Thêm các ảnh đã chọn vào danh sách
     */
    _addSelectedImages(images) {
      if (!images || !Array.isArray(images)) return;

      for (const img of images) {
        // Kiểm tra đã có trong list chưa (theo fileId)
        const exists = this._selectedImages.some(i => i.fileId === img.fileId);
        if (!exists && img.fileId) {
          this._selectedImages.push({
            fileId: img.fileId,
            thumbnail: img.thumbnail || img.thumbnailUrl || null,
            name: img.name || null,
            file_name: img.file_name || img.fileName || null,
            source: img.source || 'flow',  // Track source: 'upload' or 'flow'
            file: img.file || null  // Store blob for local uploads
          });
        }
      }

      this._renderSelectedImages();
    }

    /**
     * Hiển thị grid ảnh đã chọn
     */
    _renderSelectedImages() {
      const emptyEl = this._overlay?.querySelector('#albumCreateImagesEmpty');
      const gridEl = this._overlay?.querySelector('#albumCreateImagesGrid');
      if (!emptyEl || !gridEl) return;

      if (this._selectedImages.length === 0) {
        emptyEl.style.display = 'flex';
        gridEl.style.display = 'none';
        return;
      }

      emptyEl.style.display = 'none';
      gridEl.style.display = 'grid';

      gridEl.innerHTML = this._selectedImages.map((img, idx) => `
        <div class="album-create-image-item" data-index="${idx}">
          <img src="${img.thumbnail || ''}" alt="" class="album-create-image-thumb" />
          <button class="album-create-image-remove" data-index="${idx}" title="${window.I18n?.t('common.delete') || 'Xóa'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `).join('');

      // Bind remove buttons
      gridEl.querySelectorAll('.album-create-image-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.index, 10);
          this._selectedImages.splice(idx, 1);
          this._renderSelectedImages();
        });
      });
    }

    async _handleSubmit() {
      const nameInput = this._overlay?.querySelector('#albumNameInput');
      const name = nameInput?.value?.trim();

      if (!name) {
        nameInput?.focus();
        this._showError(nameInput, window.I18n?.t('albums.pleaseEnterName') || 'Vui lòng nhập tên album');
        return;
      }

      // Kiểm tra trùng tên
      if (window.AlbumStore) {
        const albums = await window.AlbumStore.getAlbums();
        const exists = albums.some(a => a.name.toLowerCase() === name.toLowerCase());
        if (exists) {
          this._showError(nameInput, window.I18n?.t('albums.nameExists') || 'Tên album đã tồn tại');
          return;
        }
      }

      // Tạo album
      try {
        const submitBtn = this._overlay?.querySelector('#albumCreateSubmitBtn');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 6v6l4 2"></path>
            </svg>
            ${window.I18n?.t('albums.creating') || 'Đang tạo...'}
          `;
        }

        // Tạo album trước
        const album = await window.AlbumStore?.createAlbum(name);

        // S9.2-S9.5: Thêm ảnh đã chọn vào album với thumbnail compression
        if (album && this._selectedImages.length > 0 && window.ImageStore) {
          const usedNames = new Set();
          for (const img of this._selectedImages) {
            try {
              const isLocalUpload = img.source === 'upload';

              // S9.5: Compress thumbnail
              let thumbnailBlob = null;
              let fullBlob = null;

              if (isLocalUpload && img.file instanceof Blob) {
                // Local upload: nén thumbnail từ file gốc
                fullBlob = img.file;  // Truyền để ImageStore nén thành medium
                try {
                  thumbnailBlob = await window.ImageStore.compressThumbnail(img.file);
                } catch (e) {
                  console.warn('[AlbumCreateModal] Thumbnail compression failed:', e.message);
                }
              } else if (img.thumbnail) {
                // Flow image: fetch thumbnail từ URL
                const thumbResponse = await fetch(img.thumbnail);
                const thumbBlob = await thumbResponse.blob();
                thumbnailBlob = await window.ImageStore.compressThumbnail(thumbBlob);
              }

              // Sanitize tên: lowercase, chỉ giữ a-z, 0-9, _
              let baseName = (img.name || this._generateImageName(img)).toLowerCase().replace(/[^a-z0-9_]/g, '_');
              // Check trùng tên → thêm suffix
              let finalName = baseName;
              let counter = 1;
              while (usedNames.has(finalName)) {
                finalName = `${baseName}_${counter}`;
                counter++;
              }
              usedNames.add(finalName);

              // Tạo image entry
              const imageData = {
                name: finalName,
                type: isLocalUpload ? 'upload' : 'flow',
                file_id: img.fileId,
                file_name: img.fileName || null,
                thumbnail_url: img.thumbnail || null
              };

              await window.ImageStore.addImage(album.id, imageData, thumbnailBlob, fullBlob);
            } catch (imgErr) {
              console.warn('[AlbumCreateModal] Lỗi thêm ảnh:', imgErr.message);
            }
          }
        }

        this.close();

        if (this._onSuccess) {
          this._onSuccess();
        }

        // Thông báo thành công
        const message = window.I18n?.t('albums.successMsg', { name }) || `Album "${name}" đã được tạo thành công.`;
        const successTitle = window.I18n?.t('albums.successTitle') || 'Thành công';

        if (window.customDialog) {
          window.customDialog.alert(message, { title: successTitle, type: 'success' });
        }
      } catch (err) {
        console.error('[AlbumCreateModal] Create error:', err);
        this._showError(nameInput, window.I18n?.t('albums.errorMsg') || 'Không thể tạo album. Vui lòng thử lại.');

        const submitBtn = this._overlay?.querySelector('#albumCreateSubmitBtn');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            ${window.I18n?.t('albums.createBtn') || 'Tạo album'}
          `;
        }
      }
    }

    /**
     * Tạo tên mặc định cho ảnh từ fileId
     */
    _generateImageName(img) {
      if (img.name) return img.name;
      if (img.file_name) return img.file_name.replace(/\.[^.]+$/, '').slice(0, 30);
      return 'image_' + Date.now().toString(36);
    }

    _showError(inputEl, message) {
      // Xóa error cũ
      const existingError = this._overlay?.querySelector('.album-form-error');
      existingError?.remove();

      // Hiện error mới
      const errorEl = document.createElement('p');
      errorEl.className = 'album-form-error';
      errorEl.textContent = message;

      inputEl?.parentElement?.appendChild(errorEl);
      inputEl?.classList.add('album-input-error');

      // Xóa error khi input
      inputEl?.addEventListener('input', () => {
        errorEl.remove();
        inputEl.classList.remove('album-input-error');
      }, { once: true });
    }
  }

  // Export singleton
  window.AlbumCreateModal = new AlbumCreateModal();
})();
