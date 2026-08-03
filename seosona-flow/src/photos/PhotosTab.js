/**
 * PhotosTab - Tab Photos với 3 sub-tabs: Album, Flow Images, Tìm kiếm
 */
class PhotosTab {
  static _initialized = false;
  static _currentSubtab = 'photos-album';
  static _flowImages = [];
  static _flowImagesLoaded = false;
  static _flowImagesPage = 0;
  static _flowImagesPageSize = 20;
  static _currentPreviewIndex = -1;

  // Search channel URLs
    static SEARCH_CHANNELS = {
    // Current - Images
    'pinterest': 'https://www.pinterest.com/search/pins/?q=',
    'youtube': 'https://www.youtube.com/results?search_query=',
    'tiktok': 'https://www.tiktok.com/search?q=',
    'google-photos': 'https://www.google.com/search?tbm=isch&q=',
    'facebook': 'https://www.facebook.com/search/photos/?q=',
    'unsplash': 'https://unsplash.com/s/photos/',
    'etsy': 'https://www.etsy.com/search?q=',
    'pixabay': 'https://pixabay.com/images/search/',
    'amazon': 'https://www.amazon.com/s?ref=nb_sb_noss&k=',
    'behance': 'https://www.behance.net/search/projects?search=',
    'dribbble': 'https://dribbble.com/search/',
    'magnific': 'https://www.magnific.com/search?q=',
    'pexels': 'https://www.pexels.com/search/',
    'shutterstock': 'https://www.shutterstock.com/search/',
    'redbubble': 'https://www.redbubble.com/shop/?query=',
    'aliexpress': 'https://www.aliexpress.com/wholesale?SearchText=',
    'ebay': 'https://www.ebay.com/sch/i.html?_nkw=',
    'lexica': 'https://lexica.art/?q=',
    'prompthero': 'https://prompthero.com/search?q=',
    
    // Video
    'pexelsvideo': 'https://www.pexels.com/search/videos/',
    'pixabayvideo': 'https://pixabay.com/videos/search/',
    'mixkit': 'https://mixkit.co/free-stock-video/',
    'coverr': 'https://coverr.co/s?q=',
    
    // Audio
    'epidemic': 'https://www.epidemicsound.com/music/search/?term=',
    'freesound': 'https://freesound.org/search/?q=',
    'chosic': 'https://www.chosic.com/free-music/all/?keyword=',
    
    // Graphics
    'flaticon': 'https://www.flaticon.com/search?word=',
    'svgrepo': 'https://www.svgrepo.com/vectors/',
    'freepik': 'https://www.freepik.com/search?format=search&query=',
    'googlefonts': 'https://fonts.google.com/?query=',
    'dafont': 'https://www.dafont.com/search.php?q='  };

  static async init() {
    if (this._initialized) return;
    this._initialized = true;

    this._bindSubtabs();
    this._bindAlbumTab();
    this._bindFlowImagesTab();
    this._bindSearchTab();
    this._createImagePreviewModal();

    // Initialize first sub-tab (Album)
    await this._activateSubtab('photos-album');
  }

  // ═══════════════════════════════════════════════════════════════
  // Sub-tab Navigation
  // ═══════════════════════════════════════════════════════════════

  static _bindSubtabs() {
    const subtabs = document.querySelectorAll('.photos-subtab');
    subtabs.forEach(btn => {
      btn.addEventListener('click', async () => {
        const subtabId = btn.dataset.subtab;
        await this._activateSubtab(subtabId);
      });
    });
  }

  static async _activateSubtab(subtabId) {
    this._currentSubtab = subtabId;

    // Update active button
    document.querySelectorAll('.photos-subtab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtab === subtabId);
    });

    // Update active pane
    document.querySelectorAll('.photos-subtab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === subtabId);
    });

    // Initialize content based on subtab
    switch (subtabId) {
      case 'photos-album':
        await this._initAlbumSubtab();
        break;
      case 'photos-flow-images':
        // Activate Flow tab TRƯỚC khi scan — tab nền bị Chrome throttle → React (virtual-scroll)
        // chưa render tile → scan 0 ảnh. Activate + chờ rồi mới scan.
        await this._activateFlowTab();
        await this._initFlowImagesSubtab();
        break;
      case 'photos-search':
        // Search tab doesn't need async init
        break;
    }
  }

  static async _activateFlowTab() {
    try {
      // Flow tab của fork = labs.google/fx (KHÔNG phải aistudio.google.com — domain chết, debrand sót).
      // Activate + chờ 600ms cho React virtual-scroll render tile trước khi scan (parity 1.1.59 fix).
      const tabs = await chrome.tabs.query({ url: '*://labs.google/*' });
      if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
        await new Promise((r) => setTimeout(r, 600));
      }
    } catch (err) {
      console.log('[PhotosTab] Could not activate Flow tab:', err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Album Sub-tab
  // ═══════════════════════════════════════════════════════════════

  static _bindAlbumTab() {
    // AlbumList.js handles its own button binding
  }

  static async _initAlbumSubtab() {
    if (window.AlbumList) {
      const container = document.getElementById('albumListContainer');
      if (container && !container.__albumList) {
        container.__albumList = new AlbumList('albumListContainer');
        await container.__albumList.init();
      } else if (container?.__albumList) {
        container.__albumList.refresh();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Flow Images Sub-tab
  // ═══════════════════════════════════════════════════════════════

  static _bindFlowImagesTab() {
    const refreshBtn = document.getElementById('refreshFlowImagesBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        this._flowImagesLoaded = false;
        this._flowImages = [];
        this._flowImagesPage = 0;
        await this._activateFlowTab(); // activate + chờ React trước khi re-scan (tránh scan 0 ảnh)
        this._initFlowImagesSubtab();
      });
    }

    // Lazy load on scroll
    const grid = document.getElementById('photosFlowImagesGrid');
    if (grid) {
      grid.addEventListener('scroll', () => {
        if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 100) {
          this._loadMoreFlowImages();
        }
      });
    }
  }

  static async _initFlowImagesSubtab() {
    const grid = document.getElementById('photosFlowImagesGrid');
    if (!grid) return;

    if (this._flowImagesLoaded && this._flowImages.length > 0) {
      // Already loaded, just render
      return;
    }

    // Show skeleton grid (match real flow_images grid: square thumbs)
    const skeletonItems = [];
    for (let i = 0; i < 12; i++) {
      skeletonItems.push('<div class="photos-flow-images-item skeleton-base" style="aspect-ratio: 1; border-radius: 4px;"></div>');
    }
    grid.innerHTML = skeletonItems.join('');

    // Scan Flow images
    try {
      this._flowImages = await this._scanFlowImages();
      this._flowImagesLoaded = true;
      this._flowImagesPage = 0;
      this._renderFlowImages();
    } catch (err) {
      console.error('[PhotosTab] Flow Images scan error:', err);
      grid.innerHTML = `
        <div class="photos-flow-images-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>${window.I18n?.t('photos.loadError') || 'Không thể tải ảnh. Vui lòng thử lại.'}</span>
        </div>
      `;
    }
  }

  static async _scanFlowImages() {
    // Use MessageBridge (same as ImagePickerModal)
    try {
      if (window.MessageBridge) {
        const result = await window.MessageBridge.scanFlowImages();
        const images = result?.images || [];
        // Convert to gallery format
        return images.map(img => ({
          id: img.fileId,
          thumbnail: img.thumbnail,
          src: img.thumbnail,
          type: img.type || 'image',
          video_url: img.video_url || null,
          fileName: img.file_name || null,
          flowFileId: img.file_id || null
        }));
      }
    } catch (err) {
      console.error('[PhotosTab] MessageBridge scan failed:', err);
    }

    // Fallback: direct message to content script
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.id) {
          resolve([]);
          return;
        }

        chrome.tabs.sendMessage(tabs[0].id, { action: 'scanFlowTiles' }, (response) => {
          if (chrome.runtime.lastError || !response?.tiles) {
            console.log('[PhotosTab] scanFlowTiles response:', response, chrome.runtime.lastError);
            resolve([]);
            return;
          }
          resolve(response.tiles);
        });
      });
    });
  }

  static _renderFlowImages() {
    const grid = document.getElementById('photosFlowImagesGrid');
    if (!grid) return;

    if (this._flowImages.length === 0) {
      grid.innerHTML = `
        <div class="photos-flow-images-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span>${window.I18n?.t('photos.noPhotos') || 'Chưa có ảnh nào trong Flow'}</span>
        </div>
      `;
      return;
    }

    // Render first page
    grid.innerHTML = '';
    const endIndex = Math.min((this._flowImagesPage + 1) * this._flowImagesPageSize, this._flowImages.length);

    for (let i = 0; i < endIndex; i++) {
      grid.appendChild(this._createFlowImageItem(this._flowImages[i], i));
    }

    this._flowImagesPage = Math.floor(endIndex / this._flowImagesPageSize);

    // Add "Show more" button if there are more images
    this._updateShowMoreButton(grid);
  }

  static _updateShowMoreButton(grid) {
    // Remove existing button
    grid.querySelector('.photos-flow-images-show-more')?.remove();

    const currentCount = grid.querySelectorAll('.photos-flow-images-item').length;
    const totalCount = this._flowImages.length;

    if (currentCount < totalCount) {
      const showMoreBtn = document.createElement('button');
      showMoreBtn.className = 'photos-flow-images-show-more';
      showMoreBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        ${window.I18n?.t('imagePicker.viewMore', { count: totalCount - currentCount }) || `Xem thêm (${totalCount - currentCount} ảnh)`}
      `;
      showMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this._loadMoreFlowImages();
        this._updateShowMoreButton(grid);
      });
      grid.appendChild(showMoreBtn);
    }
  }

  static _loadMoreFlowImages() {
    const grid = document.getElementById('photosFlowImagesGrid');
    if (!grid || !this._flowImagesLoaded) return;

    const startIndex = this._flowImagesPage * this._flowImagesPageSize;
    if (startIndex >= this._flowImages.length) return;

    const endIndex = Math.min(startIndex + this._flowImagesPageSize, this._flowImages.length);

    for (let i = startIndex; i < endIndex; i++) {
      grid.appendChild(this._createFlowImageItem(this._flowImages[i], i));
    }

    this._flowImagesPage++;
  }

  static _createFlowImageItem(tile, index) {
    const item = document.createElement('div');
    item.className = 'photos-flow-images-item';
    item.dataset.tileId = tile.id;
    item.dataset.index = index;

    const isVideo = tile.type === 'video';
    const thumbSrc = tile.thumbnail || tile.src || '';
    // Video URL từ content.js scan — Flow URL `getMediaUrlRedirect` cùng pattern image+video,
    // KHÔNG detect được qua extension/keyword. Dùng video_url field explicit.
    const videoUrl = tile.video_url || '';

    let mediaEl;

    if (isVideo && videoUrl) {
      // Video tile → <video preload=metadata> để show first frame static
      mediaEl = document.createElement('video');
      mediaEl.src = videoUrl;
      mediaEl.muted = true;
      mediaEl.preload = 'metadata';
      mediaEl.playsInline = true;
      mediaEl.style.width = '100%';
      mediaEl.style.height = '100%';
      mediaEl.style.objectFit = 'cover';
      // Seek to first frame to show preview
      mediaEl.addEventListener('loadeddata', () => {
        mediaEl.currentTime = 0.1;
      }, { once: true });
      mediaEl.addEventListener('error', () => {
        mediaEl.style.display = 'none';
        if (!item.querySelector('.photos-flow-images-video-placeholder')) {
          const placeholder = document.createElement('div');
          placeholder.className = 'photos-flow-images-video-placeholder';
          placeholder.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
          item.insertBefore(placeholder, item.firstChild);
        }
      }, { once: true });
    } else {
      // Image thumbnail (or video with image poster)
      mediaEl = document.createElement('img');
      mediaEl.src = thumbSrc;
      mediaEl.alt = '';
      mediaEl.loading = 'lazy';
    }

    // Video: fallback placeholder if thumbnail is empty/broken
    if (isVideo) {
      item.classList.add('photos-flow-images-item--video');
      if (mediaEl.tagName === 'IMG') {
        const onImgError = () => {
          mediaEl.style.display = 'none';
          if (!item.querySelector('.photos-flow-images-video-placeholder')) {
            const placeholder = document.createElement('div');
            placeholder.className = 'photos-flow-images-video-placeholder';
            placeholder.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
            item.insertBefore(placeholder, item.firstChild);
          }
        };
        if (!mediaEl.src || mediaEl.src === location.href) {
          onImgError();
        } else {
          mediaEl.addEventListener('error', onImgError, { once: true });
        }
      }
    }

    // Actions overlay — hide "use" for videos
    const actions = document.createElement('div');
    actions.className = 'photos-flow-images-item-actions';

    let actionsHtml = '';
    if (!isVideo) {
      actionsHtml += `
        <button class="photos-flow-images-action" data-action="use" title="${window.I18n?.t('photos.use') || 'Sử dụng'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 11 12 14 22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
        </button>`;
    }
    actionsHtml += `
      <button class="photos-flow-images-action" data-action="download" title="${window.I18n?.t('photos.download') || 'Tải xuống'}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>`;
    actions.innerHTML = actionsHtml;

    // Video play icon overlay (always visible, not just on hover)
    if (isVideo) {
      const playOverlay = document.createElement('div');
      playOverlay.className = 'photos-flow-images-play-overlay';
      playOverlay.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      item.appendChild(playOverlay);
    }

    // Bind actions
    actions.querySelectorAll('.photos-flow-images-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'use') {
          this._useFlowImage(tile);
        } else if (action === 'download') {
          this._downloadFlowImage(tile, index);
        }
      });
    });

    // Click tile (image OR video) → open preview modal
    item.addEventListener('click', () => {
      this._openImagePreview(index);
    });
    item.style.cursor = 'pointer';

    item.appendChild(mediaEl);
    item.appendChild(actions);

    return item;
  }

  static _useFlowImage(tile) {
    // Add to ref images in GenTab
    if (!tile.id) return;

    // Access GenTab directly (same context)
    if (window.GenTab) {
      // Tier-1 C-2: gọi API GenTab thay vì thọc thẳng vào thumbnailCache/fileIdsInput
      // (body cũ đã bê nguyên văn vào GenTab.addRefTile → behavior-preserving).
      window.GenTab.addRefTile(tile);
      console.log('[PhotosTab] Added image to ref:', tile.id);
    }
  }

  static _downloadFlowImage(tile, index) {
    if (!tile.id) {
      console.warn('[PhotosTab] No tile ID to download');
      return;
    }
    // Use shared DownloadHelper modal for resolution selection
    if (window.DownloadHelper) {
      DownloadHelper.showModal({
        tileId: tile.id,
        fileName: tile.fileName || null,
        flowFileId: tile.flowFileId || null,
        promptText: window._currentProjectName || 'flow',
        index: typeof index === 'number' ? index + 1 : undefined,
        mediaType: tile.type === 'video' ? 'video' : 'image'
      });
    } else {
      console.warn('[PhotosTab] DownloadHelper not available');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Image Preview Modal
  // ═══════════════════════════════════════════════════════════════

  static _createImagePreviewModal() {
    // Check if modal already exists
    if (document.getElementById('flowImagePreviewModal')) return;

    const modal = document.createElement('div');
    modal.id = 'flowImagePreviewModal';
    modal.className = 'flow-image-preview-modal';
    modal.innerHTML = `
      <div class="flow-image-preview-backdrop"></div>
      <div class="flow-image-preview-container">
        <button class="flow-image-preview-close" title="${window.I18n?.t('common.close') || 'Đóng'}">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <button class="flow-image-preview-nav flow-image-preview-prev" title="${window.I18n?.t('common.previous') || 'Trước'}">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div class="flow-image-preview-content"></div>
        <button class="flow-image-preview-nav flow-image-preview-next" title="${window.I18n?.t('common.next') || 'Sau'}">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
        <div class="flow-image-preview-footer">
          <span class="flow-image-preview-counter"></span>
          <div class="flow-image-preview-actions">
            <button class="flow-image-preview-action" data-action="use" title="${window.I18n?.t('photos.use') || 'Sử dụng'}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
              <span>${window.I18n?.t('photos.use') || 'Sử dụng'}</span>
            </button>
            <button class="flow-image-preview-action" data-action="download" title="${window.I18n?.t('photos.download') || 'Tải xuống'}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>${window.I18n?.t('photos.download') || 'Tải xuống'}</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this._bindImagePreviewEvents(modal);
  }

  static _bindImagePreviewEvents(modal) {
    const backdrop = modal.querySelector('.flow-image-preview-backdrop');
    const container = modal.querySelector('.flow-image-preview-container');
    const closeBtn = modal.querySelector('.flow-image-preview-close');
    const prevBtn = modal.querySelector('.flow-image-preview-prev');
    const nextBtn = modal.querySelector('.flow-image-preview-next');
    const useBtn = modal.querySelector('.flow-image-preview-action[data-action="use"]');
    const downloadBtn = modal.querySelector('.flow-image-preview-action[data-action="download"]');

    backdrop.addEventListener('click', () => this._closeImagePreview());
    // Click vào container background (ngoài media/buttons) → close. Pattern giống
    // wf-media-viewer-overlay: `e.target === overlay` mới đóng, tránh trigger khi click
    // vào nội dung (img/video/buttons).
    container.addEventListener('click', (e) => {
      if (e.target === container) this._closeImagePreview();
    });
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); this._closeImagePreview(); });
    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); this._navigatePreview(-1); });
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this._navigatePreview(1); });

    useBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tile = this._flowImages[this._currentPreviewIndex];
      if (tile) this._useFlowImage(tile);
      this._closeImagePreview();
    });

    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tile = this._flowImages[this._currentPreviewIndex];
      if (tile) this._downloadFlowImage(tile, this._currentPreviewIndex);
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!modal.classList.contains('active')) return;
      if (e.key === 'Escape') this._closeImagePreview();
      if (e.key === 'ArrowLeft') this._navigatePreview(-1);
      if (e.key === 'ArrowRight') this._navigatePreview(1);
    });
  }

  static _openImagePreview(index) {
    const modal = document.getElementById('flowImagePreviewModal');
    if (!modal) return;
    if (index < 0 || index >= this._flowImages.length) return;

    this._currentPreviewIndex = index;
    this._updatePreviewContent();
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  static _closeImagePreview() {
    const modal = document.getElementById('flowImagePreviewModal');
    if (modal) {
      // Pause video trước khi đóng để tránh sound playing trong background
      const video = modal.querySelector('video');
      if (video) { try { video.pause(); video.src = ''; } catch (_) { globalThis.SEOSONA_swallow?.('PhotosTab#onImgError', _); } }
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
    this._currentPreviewIndex = -1;
  }

  static _navigatePreview(direction) {
    const total = this._flowImages.length;
    if (total === 0) return;
    let newIdx = this._currentPreviewIndex + direction;
    if (newIdx < 0) newIdx = total - 1;
    if (newIdx >= total) newIdx = 0;
    this._currentPreviewIndex = newIdx;
    this._updatePreviewContent();
  }

  static _updatePreviewContent() {
    const modal = document.getElementById('flowImagePreviewModal');
    if (!modal || this._currentPreviewIndex < 0) return;

    const tile = this._flowImages[this._currentPreviewIndex];
    if (!tile) return;

    const contentEl = modal.querySelector('.flow-image-preview-content');
    const counter = modal.querySelector('.flow-image-preview-counter');

    // Cleanup previous media — pause video để tránh sound chạy ngầm khi navigate
    const oldVideo = contentEl.querySelector('video');
    if (oldVideo) { try { oldVideo.pause(); oldVideo.src = ''; } catch (_) { globalThis.SEOSONA_swallow?.('PhotosTab#onImgError', _); } }
    contentEl.innerHTML = '';

    // Render <video controls autoplay> cho video tile, <img> cho image tile
    const isVideo = tile.type === 'video';
    const videoUrl = tile.video_url || '';
    if (isVideo && videoUrl) {
      const video = document.createElement('video');
      video.src = videoUrl;
      video.className = 'flow-image-preview-img';
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = false;
      if (tile.thumbnail) video.poster = tile.thumbnail;
      contentEl.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = tile.thumbnail || tile.src || '';
      img.alt = '';
      img.className = 'flow-image-preview-img';
      contentEl.appendChild(img);
    }

    counter.textContent = `${this._currentPreviewIndex + 1} / ${this._flowImages.length}`;

    const prevBtn = modal.querySelector('.flow-image-preview-prev');
    const nextBtn = modal.querySelector('.flow-image-preview-next');
    prevBtn.style.display = this._flowImages.length > 1 ? '' : 'none';
    nextBtn.style.display = this._flowImages.length > 1 ? '' : 'none';

    // Ẩn nút "Sử dụng" với video (chưa hỗ trợ ref video qua tab này)
    const useBtn = modal.querySelector('.flow-image-preview-action[data-action="use"]');
    if (useBtn) useBtn.style.display = isVideo ? 'none' : '';
  }

  // ═══════════════════════════════════════════════════════════════
  // Search Sub-tab
  // ═══════════════════════════════════════════════════════════════

  
  static _bindSearchTab() {
    const subtabBtns = document.querySelectorAll('.photos-subtab-btn');
    const searchPanels = document.querySelectorAll('.photos-search-panel');
    
    subtabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active from all subtabs
            subtabBtns.forEach(b => b.classList.remove('active'));
            // Add active to clicked
            btn.classList.add('active');
            
            // Hide all panels
            searchPanels.forEach(p => p.classList.add('hidden'));
            
            // Show target panel
            const targetId = 'searchPanel-' + btn.dataset.searchTab;
            const targetPanel = document.getElementById(targetId);
            if(targetPanel) {
                targetPanel.classList.remove('hidden');
            }
            
            // Clear selections when switching tab
            document.querySelectorAll('.photos-channel-btn').forEach(b => b.classList.remove('selected'));
            updateMultiSearchUI();
        });
    });

    const channelBtns = document.querySelectorAll('.photos-channel-btn');
    const multiSearchToggle = document.getElementById('photosMultiSearchToggle');
    const multiSearchBtn = document.getElementById('photosMultiSearchBtn');
    const actionContainer = document.querySelector('.photos-multisearch-action');

    const updateMultiSearchUI = () => {
        if (!multiSearchToggle) return;
        const isMulti = multiSearchToggle.checked;
        const selected = document.querySelectorAll('.photos-channel-btn.selected');
        
        if (isMulti) {
            actionContainer.style.display = 'block';
            multiSearchBtn.textContent = `Tìm trên ${selected.length} kênh đã chọn`;
            multiSearchBtn.disabled = selected.length === 0;
            if(selected.length === 0) {
               multiSearchBtn.style.opacity = '0.5';
               multiSearchBtn.style.cursor = 'not-allowed';
            } else {
               multiSearchBtn.style.opacity = '1';
               multiSearchBtn.style.cursor = 'pointer';
            }
        } else {
            actionContainer.style.display = 'none';
            channelBtns.forEach(b => b.classList.remove('selected'));
        }
    };

    if (multiSearchToggle) {
        multiSearchToggle.addEventListener('change', updateMultiSearchUI);
    }

    channelBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (multiSearchToggle && multiSearchToggle.checked) {
            btn.classList.toggle('selected');
            updateMultiSearchUI();
        } else {
            const channel = btn.dataset.channel;
            this._searchChannel(channel);
        }
      });
    });

    if (multiSearchBtn) {
        multiSearchBtn.addEventListener('click', () => {
            const selectedBtns = document.querySelectorAll('.photos-channel-btn.selected');
            if (selectedBtns.length === 0) return;
            
            const searchInput = document.getElementById('photosSearchInput');
            const keyword = searchInput?.value?.trim();

            if (!keyword) {
                if (window.customDialog) {
                    window.customDialog.alert(window.I18n?.t('photos.enterSearchKeyword') || 'Vui lòng nhập từ khóa tìm kiếm.', { type: 'warning' });
                }
                searchInput?.focus();
                return;
            }

            // Open selected channels with staggered delay to avoid anti-bot detection
            const openQueue = [];
            selectedBtns.forEach(btn => {
                const channel = btn.dataset.channel;
                const baseUrl = this.SEARCH_CHANNELS[channel];
                if (baseUrl) {
                    openQueue.push(baseUrl + encodeURIComponent(keyword));
                }
            });

            // Use chrome.tabs.create for cleaner navigation (avoids popup blocker)
            // Stagger at 800ms intervals to reduce anti-bot triggers
            const openNext = (index) => {
                if (index >= openQueue.length) return;
                if (typeof chrome !== 'undefined' && chrome.tabs) {
                    chrome.tabs.create({ url: openQueue[index], active: index === 0 });
                } else {
                    window.open(openQueue[index], '_blank');
                }
                if (index + 1 < openQueue.length) {
                    setTimeout(() => openNext(index + 1), 800);
                }
            };
            openNext(0);
        });
    }

    // Enter key to search
    const searchInput = document.getElementById('photosSearchInput');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (multiSearchToggle && multiSearchToggle.checked) {
                multiSearchBtn?.click();
            } else {
                this._searchChannel('pinterest');
            }
        }
      });
    }
  }

  static async _searchChannel(channel) {
    const searchInput = document.getElementById('photosSearchInput');
    const keyword = searchInput?.value?.trim();

    if (!keyword) {
      if (window.customDialog) {
        window.customDialog.alert(window.I18n?.t('photos.enterSearchKeyword') || 'Vui lòng nhập từ khóa tìm kiếm.', { type: 'warning' });
      }
      searchInput?.focus();
      return;
    }

    const baseUrl = this.SEARCH_CHANNELS[channel];
    if (!baseUrl) return;

    const searchUrl = baseUrl + encodeURIComponent(keyword);

    // Reuse existing tab of same channel in current window
    try {
      const currentWindow = await chrome.windows.getCurrent();
      const domain = new URL(baseUrl).hostname.replace('www.', '');
      const tabs = await chrome.tabs.query({ url: `*://*.${domain}/*`, windowId: currentWindow.id });
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { url: searchUrl, active: true });
        return;
      }
    } catch (e) {
      console.warn('[PhotosTab] Tab reuse check failed:', e.message);
    }

    chrome.tabs.create({ url: searchUrl });
  }
}

// Export
window.PhotosTab = PhotosTab;
