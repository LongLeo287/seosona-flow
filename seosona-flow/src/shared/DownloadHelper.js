/**
 * DownloadHelper - Shared download modal & filename builder
 *
 * Provides:
 * - buildFilename(options) - Build filename from template string
 * - getSettings() - Load download settings from chrome.storage.local
 * - showModal(options) - Show download resolution selection modal
 *
 * CSS: Reuses .download-res-* classes from history-tab.css
 * Vietnamese text: proper diacritics throughout
 */
// Chuyển tiếng Việt có dấu → ASCII (ả→a, đ→d, ê→e...)
function _toAscii(str) {
  // Lớp mỏng — bản thật ở src/core/FilenameBuilder.js.
  return globalThis.FilenameBuilder ? globalThis.FilenameBuilder.toAscii(str) : str;
}

class DownloadHelper {

  /**
   * Transliterate tiếng Việt → ASCII (đ→d, bỏ dấu combining) cho folder/filename an toàn.
   * Expose `_toAscii` để các site khác (WorkflowEditor/AngleExecution) reuse — tránh mangle
   * ký tự có dấu thành '_' (vd "Mỹ phẩm" → "My pham" thay vì "M__Ph_m"). Caller tự sanitize sau.
   */
  static toAscii(str) {
    return _toAscii(str);
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. Build Filename from Template
  // ═══════════════════════════════════════════════════════════════

  /**
   * Build filename from template
   * @param {Object} options
   * @param {string} options.template - Template string with variables, e.g. "[Date]_[Project]_[Prompt]_[Index]"
   * @param {string} [options.project] - Project name
   * @param {string} [options.prompt] - Prompt text
   * @param {number} [options.index] - File index (1-based)
   * @param {string} [options.taskName] - Task name for subfolder
   * @param {string} [options.folder] - Base download folder
   * @param {string} [options.ext] - File extension (default: 'png')
   * @returns {string} Full filename path like "flow-output/CuteCats/2026-03-12_CuteCats_cute_cat_001.png"
   */
  static buildFilename({ template, project, prompt, index, taskName, folder, ext }) {
    // Lõi nằm ở src/core/FilenameBuilder.js — dùng chung với content.js và GenTab.
    // Trước đây ba nơi mỗi nơi một bản chép, và đã LỆCH thật ở thư mục mặc định.
    const FB = globalThis.FilenameBuilder;
    if (!FB) throw new Error('FilenameBuilder chua duoc nap — kiem tra thu tu script trong sidebar.html');
    return FB.buildPath({ template, project, prompt, index, taskName, folder, ext });
  }


  // ═══════════════════════════════════════════════════════════════
  // 2. Load Download Settings
  // ═══════════════════════════════════════════════════════════════

  /**
   * Load download settings from chrome.storage.local.
   * Single source of truth — TẤT CẢ download paths phải dùng helper này thay vì
   * đọc af_settings trực tiếp (tránh bug mismatch key vd `downloadTemplate` vs `fileNameTemplate`).
   *
   * @returns {Promise<{folder, template, project, resolution, videoResolution, legacyFormat}>}
   */
  static async getSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get(['af_settings'], (res) => {
        const s = res.af_settings || {};
        resolve({
          folder: s.downloadFolder || 'seosonaflow_output',
          template: s.fileNameTemplate || '[Date]_[Project]_[Prompt]_[Index]',
          project: s.fileNameProject || '',
          resolution: s.downloadResolution || '1k',
          videoResolution: s.videoDownloadResolution || '720p',
          // Backward compatibility with old fileNameFormat
          legacyFormat: s.fileNameFormat || null
        });
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. Show Download Resolution Modal
  // ═══════════════════════════════════════════════════════════════

  /**
   * Show download resolution selection modal
   * @param {Object} options
   * @param {string} options.tileId - Required tile ID
   * @param {string} [options.fileName] - file_name UUID for cross-project validation
   * @param {string} [options.flowFileId] - Persistent file ID
   * @param {string} [options.promptText] - Prompt for filename building
   * @param {string} [options.taskName] - Task name for subfolder
   * @param {number} [options.index] - File index for batch
   * @param {string} [options.mediaType] - 'image' or 'video' (default: 'image')
   * @param {function} [options.onDownload] - Callback after download starts, receives {tileId, resolution, fileName, flowFileId}
   */
  static async showModal(options = {}) {
    const { tileId, fileName, flowFileId, promptText, taskName, index, onDownload, mediaType } = options;
    const isVideo = mediaType === 'video';

    if (!tileId && !flowFileId) {
      console.warn('[DownloadHelper] showModal: no tileId or flowFileId provided');
      return;
    }

    // Load default resolution from settings
    let defaultRes = isVideo ? '720p' : '1k';
    if (!isVideo) {
      try {
        const settings = await this.getSettings();
        defaultRes = settings.resolution || '1k';
      } catch (e) {
        console.warn('[DownloadHelper] Failed to load settings:', e.message);
      }
    }

    // Remove existing modal if any
    const existing = document.getElementById('downloadResModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'downloadResModal';
    overlay.className = 'download-res-overlay';
    overlay.innerHTML = `
      <div class="download-res-modal">
        <div class="download-res-header">
          <span>${window.I18n?.t('common.download') || 'Tải xuống'}</span>
          <button class="download-res-close" id="downloadResClose" title="${window.I18n?.t('common.close') || 'Đóng'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="download-res-body">
          <div class="download-res-field">
            <label>${window.I18n?.t('download.resolution') || 'Độ phân giải'}</label>
            <div class="download-res-options">
              ${(() => {
                const resList = (window.ProviderConfigManager?.getDownloadResolutionsSync?.('flow', isVideo ? 'video' : 'image')
                  || (isVideo
                    ? [{ value: '720p', label: '720p (HD)' }, { value: '1080p', label: '1080p (Full HD)' }, { value: '4k', label: '4K (Ultra HD)' }]
                    : [{ value: '1k', label: '1K (1024px)' }, { value: '2k', label: '2K (2048px)' }, { value: '4k', label: '4K (4096px)' }])).slice();
                // Full-size thật cho ảnh (native 4K, fallback fetch =s0). Không có trong config Flow.
                if (!isVideo && !resList.some(r => r.value === 'original')) {
                  resList.push({ value: 'original', label: window.I18n?.t('gen.resOriginal') || 'Gốc (Full size)' });
                }
                return resList.map(r => `<button class="download-res-option ${defaultRes === r.value ? 'active' : ''}" data-res="${r.value}">${r.label}</button>`).join('');
              })()}
            </div>
          </div>
          <div class="download-res-info" id="downloadResInfo"></div>
        </div>
        <div class="download-res-footer">
          <button class="download-res-btn" id="downloadResSubmit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            ${window.I18n?.t('common.download') || 'Tải xuống'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // State
    let selectedRes = defaultRes;

    // Bind resolution option clicks
    overlay.querySelectorAll('.download-res-option').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.download-res-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedRes = btn.dataset.res;
      });
    });

    // Close handlers
    const close = () => overlay.remove();
    overlay.querySelector('#downloadResClose').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // Submit handler
    overlay.querySelector('#downloadResSubmit').addEventListener('click', async () => {
      const submitBtn = overlay.querySelector('#downloadResSubmit');
      const infoEl = overlay.querySelector('#downloadResInfo');
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>
        ${window.I18n?.t('download.downloading') || 'Đang tải...'}
      `;
      infoEl.textContent = '';

      try {
        // UA-3.4: Theo doi download
        window.UsageSync?.trackEvent('download', { resolution: selectedRes, module: taskName || 'gen' });
        await this._sendToContentScript({
          action: 'downloadTileMedia',
          tileId: tileId || null,
          promptText: promptText || 'flow',
          taskName: taskName || null,
          fileName: fileName || null,
          resolution: selectedRes,
          flowFileId: flowFileId || null,
          index: index || null
        });

        infoEl.textContent = window.I18n?.t('download.success') || 'Đã tải thành công!';
        infoEl.className = 'download-res-info download-res-info--success';

        // Notify callback
        if (typeof onDownload === 'function') {
          onDownload({
            tileId,
            resolution: selectedRes,
            fileName,
            flowFileId
          });
        }

        setTimeout(close, 800);
      } catch (e) {
        infoEl.textContent = (window.I18n?.t('download.errorPrefix') || 'Lỗi:') + ' ' + (e.message || (window.I18n?.t('download.failed') || 'Tải xuống thất bại'));
        infoEl.className = 'download-res-info download-res-info--error';
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          ${window.I18n?.t('common.download') || 'Tải xuống'}
        `;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. Send Message to Content Script
  // ═══════════════════════════════════════════════════════════════

  /**
   * Send message to content script (Flow tab)
   * Tries MessageBridge first (sidePanel mode), falls back to chrome.tabs query
   * @param {Object} msg - Message object with action + params
   * @returns {Promise<Object>} Response from content script
   * @private
   */
  static async _sendToContentScript(msg) {
    // Try MessageBridge first (sidePanel mode)
    if (window.MessageBridge) {
      return await window.MessageBridge.sendToContentScript(msg.action, msg);
    }

    // Fallback: query Flow tab directly
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ url: '*://labs.google/fx/*' }, (tabs) => {
        const flowTab = tabs.find(t => t.url?.includes('labs.google/fx'));
        if (!flowTab?.id) return reject(new Error(window.I18n?.t('download.flowTabNotFound') || 'Không tìm thấy tab Flow'));
        chrome.tabs.sendMessage(flowTab.id, msg, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response?.success) {
            resolve(response);
          } else {
            reject(new Error(response?.error || (window.I18n?.t('download.failed') || 'Tải xuống thất bại')));
          }
        });
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. Batch Download Modal
  // ═══════════════════════════════════════════════════════════════

  /**
   * Show modal chọn resolution cho batch download (multiple files cùng resolution).
   * Khác với showModal (single file), method này:
   * - Hiển thị count files sẽ tải
   * - User chọn 1 resolution → apply cho tất cả files
   * - Loop downloadTileMedia cho từng file
   *
   * @param {Object} options
   * @param {string[]} options.tileIds - Array tile IDs để download
   * @param {Object} [options.fileNames] - Map tileId → filename
   * @param {string} [options.promptText] - Prompt text dùng cho filename template
   * @param {string} [options.taskName] - Task name dùng cho subfolder
   * @param {string} [options.mediaType] - 'image' | 'video' (default 'image')
   */
  static async showBatchModal(options = {}) {
    const { tileIds, fileNames = {}, promptText, taskName, mediaType } = options;
    const isVideo = mediaType === 'video';
    const I = window.I18n;

    if (!Array.isArray(tileIds) || tileIds.length === 0) {
      console.warn('[DownloadHelper] showBatchModal: empty tileIds');
      return;
    }

    let defaultRes = isVideo ? '720p' : '1k';
    if (!isVideo) {
      try {
        const settings = await this.getSettings();
        defaultRes = settings.resolution || '1k';
      } catch (e) { /* ignore */ }
    }

    const existing = document.getElementById('downloadResModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'downloadResModal';
    overlay.className = 'download-res-overlay';
    const titleText = I?.t('download.batchTitle', { count: tileIds.length })
      || `Tải xuống ${tileIds.length} file`;
    overlay.innerHTML = `
      <div class="download-res-modal">
        <div class="download-res-header">
          <span>${titleText}</span>
          <button class="download-res-close" id="downloadResClose" title="${I?.t('common.close') || 'Đóng'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="download-res-body">
          <div class="download-res-field">
            <label>${I?.t('download.resolution') || 'Độ phân giải'}</label>
            <div class="download-res-options">
              ${(() => {
                const resList = (window.ProviderConfigManager?.getDownloadResolutionsSync?.('flow', isVideo ? 'video' : 'image')
                  || (isVideo
                    ? [{ value: '720p', label: '720p (HD)' }, { value: '1080p', label: '1080p (Full HD)' }, { value: '4k', label: '4K (Ultra HD)' }]
                    : [{ value: '1k', label: '1K (1024px)' }, { value: '2k', label: '2K (2048px)' }, { value: '4k', label: '4K (4096px)' }])).slice();
                // Full-size thật cho ảnh (native 4K, fallback fetch =s0). Không có trong config Flow.
                if (!isVideo && !resList.some(r => r.value === 'original')) {
                  resList.push({ value: 'original', label: window.I18n?.t('gen.resOriginal') || 'Gốc (Full size)' });
                }
                return resList.map(r => `<button class="download-res-option ${defaultRes === r.value ? 'active' : ''}" data-res="${r.value}">${r.label}</button>`).join('');
              })()}
            </div>
          </div>
          <div class="download-res-info" id="downloadResInfo"></div>
        </div>
        <div class="download-res-footer">
          <button class="download-res-btn" id="downloadResSubmit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            ${I?.t('common.download') || 'Tải xuống'}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let selectedRes = defaultRes;
    overlay.querySelectorAll('.download-res-option').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.download-res-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedRes = btn.dataset.res;
      });
    });

    const close = () => overlay.remove();
    overlay.querySelector('#downloadResClose').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#downloadResSubmit').addEventListener('click', async () => {
      const submitBtn = overlay.querySelector('#downloadResSubmit');
      const infoEl = overlay.querySelector('#downloadResInfo');
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg> ${I?.t('download.downloading') || 'Đang tải...'}`;
      infoEl.textContent = '';

      // UA-3.4: Track download
      window.UsageSync?.trackEvent('download', { resolution: selectedRes, module: taskName || 'gen', batch: tileIds.length });

      // Loop download tất cả files với resolution đã chọn
      let okCount = 0, failCount = 0;
      for (const tileId of tileIds) {
        try {
          await this._sendToContentScript({
            action: 'downloadTileMedia',
            tileId: tileId,
            promptText: promptText || 'flow',
            taskName: taskName || null,
            fileName: fileNames[tileId] || null,
            resolution: selectedRes,
          });
          okCount++;
        } catch (e) {
          console.warn('[DownloadHelper] Batch download fail:', tileId, e.message);
          failCount++;
        }
      }

      if (failCount === 0) {
        infoEl.textContent = I?.t('download.batchSuccess', { count: okCount }) || `Đã tải ${okCount} file thành công!`;
        infoEl.className = 'download-res-info download-res-info--success';
      } else {
        infoEl.textContent = I?.t('download.batchPartial', { ok: okCount, fail: failCount }) || `Tải được ${okCount}, lỗi ${failCount} file`;
        infoEl.className = 'download-res-info download-res-info--' + (okCount > 0 ? 'success' : 'error');
      }
      setTimeout(close, 1500);
    });
  }
}

window.DownloadHelper = DownloadHelper;
