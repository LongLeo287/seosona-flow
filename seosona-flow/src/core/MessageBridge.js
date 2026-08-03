/**
 * MessageBridge - Communication between sidePanel and content script
 *
 * sidePanel chạy trong extension context, không truy cập được DOM của labs.google/fx.
 * MessageBridge gửi message qua chrome.tabs.sendMessage đến content script
 * để thực hiện các thao tác DOM (getEditor, insertText, applySettings, v.v.).
 *
 * CRITICAL: Khi user có nhiều Flow tabs (khác project), phải gửi đến đúng tab.
 * Ưu tiên: window._targetFlowTabId (sidePanel) > storage session > active tab
 */
class MessageBridge {
  // Cache inputTimeoutMs để tránh đọc storage liên tục
  static _cachedInputTimeout = null;

  // Mutex queue cho uploadFilesToFlow — serialize concurrent calls để tránh race condition
  // khi 2+ image nodes chạy parallel cùng poll DOM tile mới (Bug 59: 2 image upload → cùng fe_id)
  static _uploadFlowQueue = Promise.resolve();

  // [Audit fix Finding 3] Default caller-side timeout cho request-response bridge. Content script
  // handler trả `return true` (async) nhưng không bao giờ gọi sendResponse → promise treo mãi mãi
  // (và _uploadFlowQueue deadlock mọi upload). Wrap sendMessage trong Promise.race để đảm bảo settle.
  static _BRIDGE_TIMEOUT_MS = 120000;

  /**
   * [Audit fix Finding 3] Wrap 1 chrome.tabs.sendMessage promise trong Promise.race với timeout.
   * Nếu content script không phản hồi trong timeoutMs → reject với error BRIDGE_TIMEOUT để caller
   * (và promise-chain queue) settle thay vì treo mãi.
   * @param {Promise<any>} sendPromise - promise từ chrome.tabs.sendMessage(...)
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  static _raceBridgeTimeout(sendPromise, timeoutMs) {
    const ms = (typeof timeoutMs === 'number' && timeoutMs > 0)
      ? timeoutMs
      : this._BRIDGE_TIMEOUT_MS;
    let timer;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        const err = new Error('BRIDGE_TIMEOUT');
        err.code = 'BRIDGE_TIMEOUT';
        reject(err);
      }, ms);
    });
    return Promise.race([sendPromise, timeoutPromise]).finally(() => clearTimeout(timer));
  }

  /**
   * Lấy inputTimeoutMs từ storage để dùng cho retry delays
   * @returns {Promise<number>} inputTimeoutMs (default 1200)
   */
  static async _getInputTimeout() {
    if (this._cachedInputTimeout !== null) return this._cachedInputTimeout;
    try {
      const result = await chrome.storage.local.get(['af_settings']);
      this._cachedInputTimeout = result?.af_settings?.inputTimeout || 1200;
    } catch (e) {
      this._cachedInputTimeout = 1200;
    }
    return this._cachedInputTimeout;
  }
  /**
   * Lấy target Flow tab ID - ưu tiên tracked tab, fallback active tab
   * @returns {Promise<number|null>}
   */
  static async _getTargetTabId() {
    // 1. Ưu tiên window._targetFlowTabId (set bởi app.js trong sidePanel)
    if (window._targetFlowTabId) {
      // Verify tab vẫn tồn tại và là Flow tab
      try {
        const tab = await chrome.tabs.get(window._targetFlowTabId);
        const flowBase = window.ProviderConfigManager?._DEFAULT_URLS?.flow?.base || 'https://labs.google/fx';
        if (tab?.url?.startsWith(flowBase)) {
          return window._targetFlowTabId;
        }
      } catch (e) {
        // Tab không tồn tại nữa
        window._targetFlowTabId = null;
      }
    }

    // 2. Fallback: lấy từ chrome.storage.session (shared giữa contexts)
    try {
      const result = await chrome.storage?.session?.get('targetFlowTabId');
      if (result?.targetFlowTabId) {
        const tab = await chrome.tabs.get(result.targetFlowTabId).catch(() => null);
        const flowBase2 = window.ProviderConfigManager?._DEFAULT_URLS?.flow?.base || 'https://labs.google/fx';
        if (tab?.url?.startsWith(flowBase2)) {
          return result.targetFlowTabId;
        }
      }
    } catch (e) {
      // chrome.storage.session không available hoặc lỗi
    }

    // 3. Final fallback: query tabs và chọn active hoặc đầu tiên
    return null;
  }

  /**
   * Lưu target tab ID vào session storage (để popup windows có thể access)
   */
  static async setTargetTabId(tabId) {
    window._targetFlowTabId = tabId;
    try {
      await chrome.storage?.session?.set({ targetFlowTabId: tabId });
    } catch (e) {
      // chrome.storage.session không available
    }
  }

  /**
   * Gửi message đến content script trên tab labs.google/fx
   * CRITICAL: Ưu tiên _targetFlowTabId để tránh gửi đến tab sai khi có nhiều Flow tabs
   */
  static async sendToContentScript(action, data = {}, timeout, opts = {}) {
    try {
      // Tìm bất kỳ tab labs.google/fx nào (không giới hạn currentWindow
      // vì có thể gọi từ popup window như workflow editor)
      const tabs = await chrome.tabs.query({ url: window.ProviderConfigManager?.getTabQuery('flow') || 'https://labs.google/fx/*' });
      if (tabs.length === 0) {
        // Show warning modal once (debounce) — TRỪ khi caller yêu cầu silent (vd scan nền lúc init).
        if (!opts.silent) this._showNoFlowTabWarning();
        throw new Error(window.I18n?.t('msg.noFlowTab') || 'Không tìm thấy tab Google Flow');
      }

      // CRITICAL: Ưu tiên target tab (tracked), fallback active tab
      const targetTabId = await this._getTargetTabId();
      let targetTab = null;

      if (targetTabId) {
        // Tìm target tab trong danh sách
        targetTab = tabs.find(t => t.id === targetTabId);
      }

      // Fallback: active tab hoặc tab đầu tiên
      if (!targetTab) {
        targetTab = tabs.find(t => t.active) || tabs[0];
        // Nếu không có tracked tab, update để các lần sau dùng
        if (targetTab && !window._targetFlowTabId) {
          this.setTargetTabId(targetTab.id);
        }
      }

      try {
        // [Audit fix Finding 3] Race timeout — content script handler có thể `return true` (async)
        // mà không bao giờ sendResponse → treo mãi. BRIDGE_TIMEOUT → settle graceful (queue drain).
        const response = await this._raceBridgeTimeout(
          chrome.tabs.sendMessage(targetTab.id, { action, ...data }),
          timeout
        );
        // Check for error-only response from content.js handler .catch()
        // (error-only response = object chỉ có field "error", không có success/images/tiles/etc.)
        if (response?.error && !response?.success && Object.keys(response).length <= 1) {
          throw new Error(response.error);
        }
        return response;
      } catch (sendErr) {
        // BRIDGE_TIMEOUT: handler treo (không sendResponse) — KHÔNG inject/retry (script vẫn sống,
        // chỉ chậm/kẹt). Return error object để caller + _uploadFlowQueue drain thay vì deadlock.
        if (sendErr?.code === 'BRIDGE_TIMEOUT') {
          console.warn('[MessageBridge] sendToContentScript timeout:', action);
          return { success: false, error: 'BRIDGE_TIMEOUT' };
        }
        // Content script chưa inject hoặc bị disconnect → tự động inject lại
        // Skip warning log for "fire-and-forget" actions that are expected to fail when Flow tab closed
        const _emsg = String(sendErr.message || '').toLowerCase();
        const isExpectedDisconnect = _emsg.includes('could not establish connection') ||
            _emsg.includes('receiving end does not exist') ||
            _emsg.includes('message channel closed') ||
            _emsg.includes('message port closed') ||
            // Bug fix 2026-06-06: Chrome bfcache message — "...message channel is closed."
            _emsg.includes('message channel is closed') ||
            _emsg.includes('back/forward cache') ||
            _emsg.includes('extension port');
        const isFireAndForgetAction = action === 'pq:trackerUpdate' || action === 'correctStaleFileIds' || action === 'applyFlowPageSettings';

        if (isExpectedDisconnect) {
          if (!isFireAndForgetAction) {
            // Chưa phải lỗi cuối — sắp re-inject + retry. Dùng log (không phải warn) để không rác
            // panel Lỗi khi retry thành công. Thất bại thật sự vẫn báo ở catch ngoài (line ~220).
            console.log('[MessageBridge] Content script chưa sẵn sàng, đang inject lại...', action);
            await this._injectContentScript(targetTab.id);
            // Chờ content script khởi tạo xong (dùng inputTimeoutMs từ settings)
            const retryDelay = await this._getInputTimeout();
            await new Promise(r => setTimeout(r, retryDelay));
            // Retry sau khi inject - với retry loop nếu vẫn chưa sẵn sàng
            let retryResponse = null;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                // [Audit fix Finding 3] Race timeout trên retry path cũng — tránh treo sau re-inject.
                retryResponse = await this._raceBridgeTimeout(
                  chrome.tabs.sendMessage(targetTab.id, { action, ...data }),
                  timeout
                );
                break; // Success
              } catch (retryErr) {
                if (attempt < 2 && retryErr.message?.includes('Could not establish connection')) {
                  console.log(`[MessageBridge] Retry ${attempt + 1} failed, waiting ${retryDelay}ms...`);
                  await new Promise(r => setTimeout(r, retryDelay));
                } else {
                  throw retryErr;
                }
              }
            }
            if (retryResponse?.error && !retryResponse?.success && Object.keys(retryResponse).length <= 1) {
              throw new Error(retryResponse.error);
            }
            return retryResponse;
          }
          // Fire-and-forget actions: just throw without logging (caller handles gracefully)
          // Mark error to skip outer catch logging
          sendErr._isFireAndForget = true;
          throw sendErr;
        }
        console.warn('[MessageBridge] sendMessage failed:', action, sendErr.message);
        throw sendErr;
      }
    } catch (err) {
      // Skip logging for fire-and-forget actions (expected to fail when Flow tab closed).
      // Scan nền (opts.silent) mất kết nối cũng là kỳ vọng → log nhẹ, không đỏ panel.
      const _em = String(err?.message || '').toLowerCase();
      const _expectedDisc = _em.includes('could not establish connection') ||
        _em.includes('receiving end does not exist') || _em.includes('không tìm thấy tab');
      if (!err._isFireAndForget) {
        // Disconnect THẬT (tab có nhưng content script chết) — KHÔNG tính case "không tìm thấy tab"
        // (đã có _showNoFlowTabWarning riêng ở trên).
        const _isDisconnect = _em.includes('could not establish connection') || _em.includes('receiving end does not exist');
        if (opts.silent && _expectedDisc) {
          console.log('[MessageBridge] Bỏ qua (scan nền, chưa có content script):', action);
        } else {
          console.error('[MessageBridge] Lỗi gửi message:', err.message);
          // [tracker-unified] Content script stale (reload extension mà tab Flow chưa F5) → toast rõ
          // ràng thay vì fail câm (đúng cái làm user hoang mang "workflow không chạy, tracking chết").
          if (_isDisconnect) this._showStaleContentScriptWarning();
        }
      }
      throw err;
    }
  }

  /**
   * Inject content script vào tab khi kết nối bị mất
   * (xảy ra sau khi extension reload/update mà tab không refresh)
   */
  static async _injectContentScript(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      // Verify tab is a Flow page before inject
      const flowBaseUrl = window.ProviderConfigManager?._DEFAULT_URLS?.flow?.base || 'https://labs.google/fx';
      if (!tab || !tab.url?.startsWith(flowBaseUrl)) {
        throw new Error(`Tab ${tabId} không phải Google Flow (url: ${tab?.url || 'N/A'})`);
      }

      // Thử inject trực tiếp
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content_scripts/content.js']
        });
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content_scripts/slate-bridge.js'],
            world: 'MAIN'
          });
        } catch (slateErr) {
          console.warn('[MessageBridge] Slate bridge inject failed:', slateErr.message);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log('[MessageBridge] Content script + slate bridge injected vào tab', tabId);
        return;
      } catch (injectErr) {
        console.warn('[MessageBridge] Direct inject failed:', injectErr.message);
      }

      // Fallback: reload tab để manifest content_scripts tự inject
      console.log('[MessageBridge] Reloading tab để re-inject content script...');
      await chrome.tabs.reload(tabId);

      // Chờ tab load xong
      await new Promise((resolve) => {
        const listener = (updatedTabId, info) => {
          if (updatedTabId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Timeout fallback
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 10000);
      });

      // Chờ thêm cho content script init
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('[MessageBridge] Tab reloaded, content script should be active');
    } catch (err) {
      console.error('[MessageBridge] Không thể inject content script:', err.message);
      throw new Error(`Không thể kết nối với Google Flow: ${err.message}`);
    }
  }

  /**
   * Hiển thị cảnh báo khi không có tab Google Flow
   * Debounce để tránh hiện nhiều modal liên tục
   */
  static _showNoFlowTabWarning() {
    if (this._warningShown) return;
    this._warningShown = true;
    setTimeout(() => { this._warningShown = false; }, 3000);

    if (window.customDialog) {
      window.customDialog.alert(
        window.I18n?.t('msg.openFlowTabDesc') || 'Vui lòng mở tab Google Flow (labs.google/fx) trước khi thực hiện thao tác này.\n\nExtension cần kết nối với trang Google Flow để hoạt động.',
        { title: window.I18n?.t('msg.noFlowTabTitle') || 'Không tìm thấy Google Flow', type: 'warning' }
      ).then(() => {
        // [Fix] Reuse existing Flow tab instead of opening new one
        chrome.runtime.sendMessage({
          action: 'openOrActivateTab',
          urlPattern: window.ProviderConfigManager?.getTabQuery('flow') || 'https://labs.google/fx/*',
          createUrl: window.ProviderConfigManager?.getCreateUrl('flow') || 'https://labs.google/fx/tools/flow',
          activate: true
        });
      });
    }
  }

  /**
   * [tracker-unified] Cảnh báo khi tab Flow CÓ nhưng content script đã chết (stale) — thường do
   * reload/cập nhật extension mà tab chưa F5. Trước đây fail câm → user tưởng "workflow không chạy".
   * Debounce 5s + đưa user sang tab Flow để F5.
   */
  static _showStaleContentScriptWarning() {
    if (this._staleWarnShown) return;
    this._staleWarnShown = true;
    setTimeout(() => { this._staleWarnShown = false; }, 5000);

    if (window.customDialog) {
      window.customDialog.alert(
        window.I18n?.t('msg.staleContentDesc') || 'Trang Google Flow cần được tải lại (F5) sau khi cập nhật hoặc reload extension.\n\nHãy sang tab Google Flow, nhấn F5, rồi chạy lại. (Extension mất kết nối với trang cũ.)',
        { title: window.I18n?.t('msg.staleContentTitle') || 'Trang Flow cần tải lại (F5)', type: 'warning' }
      ).then(() => {
        chrome.runtime.sendMessage({
          action: 'openOrActivateTab',
          urlPattern: window.ProviderConfigManager?.getTabQuery('flow') || 'https://labs.google/fx/*',
          createUrl: window.ProviderConfigManager?.getCreateUrl('flow') || 'https://labs.google/fx/tools/flow',
          activate: true
        });
      });
    }
  }

  /**
   * Chạy auto prompt trên content script
   * CRITICAL: Ensure Flow tab active trước khi submit để tránh Chrome throttle
   * gây detect tile status sai (tiles thành công nhưng báo fail)
   */
  static async runAutoPrompt(payload) {
    // Ensure Flow tab active để tránh Chrome throttle inactive tabs
    // Không restore tab cũ vì user đang chạy generation → nên xem Flow tab
    await this._ensureFlowTabActive();
    return this.sendToContentScript('runAutoPrompt', { payload });
  }

  /**
   * Ensure Flow tab is active (tránh Chrome throttle inactive tabs)
   * @returns {Promise<{isOpen: boolean, wasActivated?: boolean}>}
   */
  static async _ensureFlowTabActive() {
    // Lấy targetTabId từ app.js (sidePanel) hoặc storage session (popup windows)
    let targetTabId = window._targetFlowTabId || null;

    // Popup windows không có _targetFlowTabId → fallback từ storage session
    if (!targetTabId) {
      try {
        const res = await chrome.storage?.session?.get('targetFlowTabId');
        targetTabId = res?.targetFlowTabId || null;
      } catch (e) {
        // storage session không khả dụng
      }
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'ensureFlowTabReady', targetTabId }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ isOpen: false });
          return;
        }
        resolve(response || { isOpen: false });
      });
    });
  }

  /**
   * Heartbeat re-activate Flow tab — gọi trong vòng poll TileMonitor (chờ tile) + DownloadExecutor.
   * Tab nền bị Chrome throttle timers/DOM → detect tile-xong + download chậm/kẹt. Re-activate giữ
   * tab un-throttled. THROTTLE 8s/lần (shared) để không spam mỗi poll; background handler
   * `activateFlowTabForExecution` tự no-op nếu tab đã active (không churn focus). Fire-and-forget
   * (không block cadence poll). 2026-06-25.
   */
  static heartbeatActivateFlowTab() {
    const now = Date.now();
    if (this._lastHeartbeatActivateAt && now - this._lastHeartbeatActivateAt < 8000) return;
    this._lastHeartbeatActivateAt = now;
    try {
      chrome.runtime.sendMessage(
        { action: 'activateFlowTabForExecution', tabId: window._targetFlowTabId || null },
        () => { void chrome.runtime.lastError; });
    } catch (_) { globalThis.SEOSONA_swallow?.('MessageBridge#listener', _); }
  }

  /**
   * Áp dụng cài đặt Google Flow (genType, ratio, model, duration)
   */
  static async applySettings(genType, ratio, model, isFrames, quantity = 1, flowVideoDuration = null) {
    return this.sendToContentScript('applySettings', { genType, ratio, model, isFrames, quantity, flowVideoDuration });
  }

  /**
   * Kiểm tra editor có tồn tại không
   */
  static async getEditor() {
    return this.sendToContentScript('getEditor');
  }

  /**
   * Chèn text vào editor
   */
  static async insertText(text) {
    return this.sendToContentScript('insertText', { text });
  }

  /**
   * Xóa nội dung editor
   */
  static async clearEditor() {
    return this.sendToContentScript('clearEditor');
  }

  /**
   * Click nút submit
   */
  static async clickSubmit() {
    return this.sendToContentScript('clickSubmit');
  }

  /**
   * Thêm file reference vào prompt
   * @param {string} fileId - tile_id (session-specific)
   * @param {string} [fileName] - file_name UUID (persistent, for fallback matching)
   * @param {string} [flowFileId] - persistent file_id from /edit/{file_id} (Phase U)
   */
  static async addFileToPrompt(fileId, fileName, flowFileId) {
    return this.sendToContentScript('addFileToPrompt', { fileId, fileName, flowFileId: flowFileId || null });
  }

  /**
   * Lấy danh sách tile IDs hiện tại
   */
  static async getCurrentTileIds() {
    return this.sendToContentScript('getCurrentTileIds');
  }

  /**
   * Chờ tile mới xuất hiện
   */
  static async waitForNewTiles(preTileIds, timeout, options = {}) {
    return this.sendToContentScript('waitForNewTiles', {
      preTileIds,
      timeout,
      captureFileNames: options.captureFileNames || false,
      preFileNames: options.preFileNames || null,
      maxQuantity: options.maxQuantity || 0,
    });
  }

  /**
   * Dừng quá trình đang chạy
   */
  static async stopExecution() {
    return this.sendToContentScript('stopExecution');
  }

  /**
   * Tạm dừng
   */
  static async pauseExecution() {
    return this.sendToContentScript('pauseExecution');
  }

  /**
   * Tiếp tục sau khi tạm dừng
   */
  static async resumeExecution() {
    return this.sendToContentScript('resumeExecution');
  }

  /**
   * Lấy trạng thái isRunning
   */
  static async getRunningState() {
    return this.sendToContentScript('getRunningState');
  }

  /**
   * Lấy danh sách prompts bị lỗi
   */
  static async getFailedPrompts() {
    return this.sendToContentScript('getFailedPrompts');
  }

  /**
   * Xóa danh sách prompts bị lỗi
   */
  static async clearFailedPrompts() {
    return this.sendToContentScript('clearFailedPrompts');
  }

  /**
   * Quét ảnh trên Google Flow page
   */
  static async scanFlowImages(deep = false, silent = false) {
    // deep=true → content script scroll Flow page + tích luỹ toàn bộ tile (Fix D on-demand)
    // silent=true → không hiện modal "Không có Flow tab" (dùng cho scan nền lúc init).
    return this.sendToContentScript('scanFlowImages', { deep }, undefined, { silent });
  }

  /**
   * Lấy thumbnail trực tiếp theo file IDs từ Flow DOM
   * @param {string[]} fileIds - Mảng file IDs cần lấy thumbnail
   * @returns {Promise<{results: Object.<string, {thumbnail: string, type: string}>}>}
   */
  static async getThumbnailsByIds(fileIds) {
    return this.sendToContentScript('getThumbnailsByIds', { fileIds });
  }

  /**
   * Chuẩn bị Flow page: setup Grid view, bật hiển thị chi tiết, zoom 50% để load tất cả tiles
   * Gọi trước correctStaleFileIds hoặc getThumbnailsByIds khi tiles không hiển thị trên DOM
   */
  static async prepareFlowForScan() {
    return this.sendToContentScript('prepareFlowForScan');
  }

  /**
   * Sửa tile IDs cũ (session-specific) thành IDs mới bằng cách match thumbnail URL
   * Tự động gọi prepareFlowForScan nếu lần scan đầu không tìm đủ
   * @param {Object} idToUrlMap - { "old_fe_id": "https://lh3..." }
   * @returns {Promise<{corrections: Object.<string, string>}>} - { "old_fe_id": "new_fe_id" }
   */
  /**
   * Tìm tile trên DOM bằng file_name (UUID từ getMediaUrlRedirect)
   * @param {string} fileName - UUID persistent
   * @returns {Promise<{tileId: string|null}>}
   */
  static async findTileByFileName(fileName) {
    return this.sendToContentScript('findTileByFileName', { fileName });
  }

  /**
   * @param {Object} idToUrlMap - { oldTileId: thumbnailUrl }
   * @param {Object} [fileNameMap] - { oldTileId: fileName UUID }
   * @param {Object} [fileIdMap] - { oldTileId: flowFileId } persistent file_id (Phase U)
   */
  static async correctStaleFileIds(idToUrlMap, fileNameMap = {}, fileIdMap = {}, options = {}) {
    return this.sendToContentScript('correctStaleFileIds', { idToUrlMap, fileNameMap, fileIdMap, skipZoomScan: options.skipZoomScan === true });
  }

  /**
   * Upload files lên Google Flow (inject vào input[type=file])
   * Gửi files dưới dạng base64 vì chrome message không hỗ trợ File objects
   * @param {Array<{name: string, type: string, base64: string}>} filesData
   * @returns {Promise<string[]>} - Mảng tile IDs mới
   */
  static async uploadFilesToFlow(filesData) {
    // Serialize concurrent calls qua promise-chain queue. Race condition Bug 59:
    // 2 image nodes parallel ở Level 0 cùng gọi → content script handler chạy 2 instance song song,
    // share DOM polling — cả 2 thấy tile mới đầu tiên xuất hiện → cùng claim 1 tile_id, tile thứ 2 orphan.
    const prev = MessageBridge._uploadFlowQueue;
    let release;
    MessageBridge._uploadFlowQueue = new Promise((resolve) => { release = resolve; });
    try {
      // Đợi call trước xong (kể cả khi throw) trước khi vào critical section
      await prev.catch(function (_e) { globalThis.SEOSONA_swallow?.('MessageBridge#listener', _e); });

      // CRITICAL: Ensure Flow tab active TRƯỚC khi upload.
      // Bug fix: cross-provider bridge (chatGPTBridgeToFlow / grokBridgeToFlow) call uploadFilesToFlow
      // mà không activate Flow tab. Flow tab có thể inactive (workflow đang chạy node ChatGPT/Grok →
      // user đang nhìn tab provider) → Chrome throttle inactive tab → upload fail/slow → bridge stuck
      // → fallback synthetic tile → result preview broken.
      // Fix: activate Flow tab giống pattern runAutoPrompt + ImmediateUploader.
      await this._ensureFlowTabActive();
      // Chunk filesData theo tổng size base64 để KHÔNG vượt Chrome tabs.sendMessage limit (64MiB/message).
      // Bug thật (log user): 9 ảnh HD base64 gộp 1 message > 64MiB → sendMessage fail TOÀN BỘ → 0 ảnh
      // upload ("Upload ref thất bại"). Chia batch < 40MiB, gửi tuần tự, merge kết quả. Content handler
      // capture existingTiles baseline PER-FILE nên batch sau không re-detect tile batch trước.
      // [Port từ upstream 1.1.58 — 2026-07]
      const batches = MessageBridge._chunkFilesBySize(filesData);
      if (batches.length > 1) {
        console.log(`[MessageBridge] uploadFilesToFlow → ${filesData.length} file(s) chia ${batches.length} batch (tránh 64MiB IPC limit)`);
      }
      const merged = { tileIds: [], orderedTileIds: [], tileDetails: [], keyMapping: {} };
      for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        console.log('[MessageBridge] uploadFilesToFlow → batch', (bi + 1) + '/' + batches.length, ':', batch.length, 'file(s)');
        let bres;
        try {
          bres = await this.sendToContentScript('uploadFilesToFlow', { filesData: batch });
        } catch (e) {
          // 1 batch fail (file đơn > 64MiB / content script rớt) → KHÔNG abort batch còn lại: giữ kết quả, tiếp tục.
          console.warn(`[MessageBridge] uploadFilesToFlow batch ${bi + 1}/${batches.length} lỗi (${batch.length} file):`, e && e.message || e);
          continue;
        }
        if (Array.isArray(bres?.tileIds)) merged.tileIds.push(...bres.tileIds);
        if (Array.isArray(bres?.orderedTileIds)) merged.orderedTileIds.push(...bres.orderedTileIds);
        if (Array.isArray(bres?.tileDetails)) merged.tileDetails.push(...bres.tileDetails);
        if (bres?.keyMapping && typeof bres.keyMapping === 'object') Object.assign(merged.keyMapping, bres.keyMapping);
        if (bres?.warning) merged.warning = bres.warning;
        if (bres?.errorCode) merged.errorCode = bres.errorCode;
        if (bres && bres.error === 'UPLOAD_BLOCKED') {
          merged.error = bres.error; merged.errorMessage = bres.errorMessage; merged.blockedFile = bres.blockedFile;
          break; // Flow chặn 1 batch → dừng sớm, GIỮ kết quả batch trước + trả error.
        }
      }
      const result = merged;
      console.log('[MessageBridge] uploadFilesToFlow merged result:', merged);
      // 2026-05-27: Flow từ chối ảnh vi phạm content policy (detect qua flow.error_patterns.
      // upload_blocked_text trong content.js). Notify lý do nguyên văn ĐÚNG context gọi — áp cho MỌI
      // đường auto-upload result trên workflow (ref pick, cross-provider, mention, telegram...):
      //   • Sidebar (app.js): window.showNotification / showToast
      //   • Workflow editor (window riêng, không có toast system): window.customDialog.alert
      if (result && result.error === 'UPLOAD_BLOCKED') {
        const reason = result.errorMessage || window.I18n?.t('workflow.uploadBlockedReason') || 'Flow từ chối ảnh (vi phạm chính sách nội dung).';
        console.warn('[MessageBridge] Flow blocked upload:', reason);
        try {
          if (typeof window.showNotification === 'function') {
            window.showNotification(reason, 'error', 6000);
          } else if (typeof window.showToast === 'function') {
            window.showToast(reason);
          } else if (window.customDialog && typeof window.customDialog.alert === 'function') {
            window.customDialog.alert(reason, {
              type: 'error',
              title: window.I18n?.t('workflow.uploadBlocked') || 'Ảnh bị từ chối',
            });
          }
        } catch (_) { globalThis.SEOSONA_swallow?.('MessageBridge#listener', _); }
      }
      return result;
    } finally {
      release();
    }
  }

  /**
   * Chia filesData thành các batch có tổng size base64 < maxBytes (mặc định 40MiB) để không vượt
   * giới hạn 64MiB/message của chrome.tabs.sendMessage. [Port từ upstream 1.1.58]
   * @param {Array<{name,type,base64}>} filesData
   * @param {number} [maxBytes]
   * @returns {Array<Array>} mảng batch
   */
  static _chunkFilesBySize(filesData, maxBytes = 40 * 1024 * 1024) {
    if (!Array.isArray(filesData) || filesData.length <= 1) return [filesData || []];
    const batches = [];
    let cur = [], curSize = 0;
    for (const fd of filesData) {
      const size = (fd && typeof fd.base64 === 'string') ? fd.base64.length : 0;
      if (cur.length > 0 && (curSize + size) > maxBytes) { batches.push(cur); cur = []; curSize = 0; }
      cur.push(fd); curSize += size;
    }
    if (cur.length > 0) batches.push(cur);
    return batches.length > 0 ? batches : [filesData];
  }

  /**
   * Kiểm tra tile IDs có tồn tại trên page không
   * @param {string[]} tileIds
   * @returns {Promise<{existing: string[], missing: string[]}>}
   */
  static async checkTilesExist(tileIds) {
    return this.sendToContentScript('checkTilesExist', { tileIds });
  }

  /**
   * Check file_names (persistent UUIDs) exist on Flow DOM
   * More reliable than checkTilesExist because file_name persists across sessions
   * @param {string[]} fileNames
   * @returns {Promise<{existing: string[], missing: string[]}>}
   */
  static async checkFilesExist(fileNames) {
    return this.sendToContentScript('checkFilesExist', { fileNames });
  }

  /**
   * @param {string} tileId - session-specific tile ID
   * @param {string} promptText - for filename generation
   * @param {string} [taskName]
   * @param {string} [fileName] - file_name UUID (persistent)
   * @param {string} [resolution] - '1k' | '2k'
   * @param {string} [flowFileId] - persistent file_id from /edit/{file_id} (Phase U)
   */
  static async downloadTileMedia(tileId, promptText, taskName, fileName, resolution, flowFileId) {
    return this.sendToContentScript('downloadTileMedia', { tileId, promptText, taskName, fileName, resolution, flowFileId: flowFileId || null });
  }

  /**
   * Q2.3: Bắt đầu chế độ chọn vùng crop trên Google Flow page
   * @returns {Promise<{success: boolean, cropRect?: {x,y,width,height}, cancelled?: boolean, error?: string}>}
   */
  static async startCropSelection() {
    return this.sendToContentScript('startCropSelection');
  }

  /**
   * Q2.3: Hủy chế độ chọn vùng crop (nếu đang hiển thị)
   */
  static async cancelCropSelection() {
    return this.sendToContentScript('cancelCropSelection');
  }

  // === PQ: PromptQueue Pipeline methods ===

  /**
   * Lấy snapshot tile IDs và file names trước khi submit
   * @returns {Promise<{success: boolean, preTileIds: string[], preFileNames: string[]}>}
   */
  static async getPreTileSnapshot() {
    return this.sendToContentScript('pq:getPreTileSnapshot');
  }

  /**
   * Thêm ref images vào editor
   * @param {string[]} fileIds - Mảng tile IDs cần thêm
   * @param {Object} [fileNameMap] - Map tile_id → file_name UUID cho fallback matching
   */
  static async addRefImages(fileIds, fileNameMap) {
    return this.sendToContentScript('pq:addRefImages', { fileIds, fileNameMap });
  }

  /**
   * Xóa ref images hiện có trong editor
   */
  static async removeExistingRefImages() {
    return this.sendToContentScript('pq:removeExistingRefImages');
  }

  /**
   * 2026-06-02: prepareFlowForGen — đóng chat panel + Agent OFF + wait editor ready TRƯỚC khi
   * add ref images. Tránh add_ref khi panel/Agent UI vẫn chiếm composer area → ref add sai chỗ.
   * @returns {Promise<{success: boolean, actioned: boolean, editorReadyMs: number}>}
   */
  static async prepareFlowForGen() {
    await this._ensureFlowTabActive();
    return this.sendToContentScript('prepareFlowForGen');
  }

  /**
   * Kiểm tra Slate model đã có nội dung chưa (placeholder đã biến mất)
   * @returns {Promise<{success: boolean, hasContent: boolean}>}
   */
  static async verifySlateModel() {
    return this.sendToContentScript('pq:verifySlateModel');
  }

  // === Flow Voice Selector ===

  /**
   * Đảm bảo Flow tab tồn tại + active + content script ready. Khác `_ensureFlowTabActive`
   * (chỉ activate tab có sẵn), method này tạo Flow tab MỚI nếu chưa có (cần thiết khi
   * user click Resync từ settings.html mà chưa mở Flow tab).
   */
  static async _ensureFlowTabReadyForScrape() {
    const flowUrlPattern = window.ProviderConfigManager?.getTabQuery?.('flow') || 'https://labs.google/fx/*';
    const flowCreateUrl = 'https://labs.google/fx/tools/flow';

    // 1. Check Flow tab exists
    let tabs;
    try {
      tabs = await chrome.tabs.query({ url: flowUrlPattern });
    } catch (e) {
      throw new Error('Không truy cập được chrome.tabs (permission thiếu hoặc context invalid)');
    }

    let flowTab = tabs && tabs[0];

    // 2. Nếu chưa có → mở Flow tab mới + wait load
    if (!flowTab) {
      flowTab = await new Promise((resolve, reject) => {
        chrome.tabs.create({ url: flowCreateUrl, active: true }, (tab) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(tab);
        });
      });

      // Đợi tab load complete (max 30s)
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 30000;
        const listener = (tabId, changeInfo) => {
          if (tabId === flowTab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Polling fallback nếu listener miss
        const poll = setInterval(async () => {
          // [Audit fix Finding 4] Deadline check TRƯỚC try — nếu chrome.tabs.get throw (tab closed),
          // empty catch nuốt lỗi + deadline check (cũ nằm sau get trong try) unreachable → interval
          // leak vĩnh viễn + promise không bao giờ settle. Đặt trước để luôn chạy.
          if (Date.now() > deadline) {
            clearInterval(poll);
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Flow tab load timeout (30s)'));
            return;
          }
          try {
            const t = await chrome.tabs.get(flowTab.id);
            if (t.status === 'complete') {
              clearInterval(poll);
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          } catch (_) { /* tab tạm không truy cập được — deadline check ở trên sẽ finalize */ }
        }, 500);
      });

      // Đợi thêm 2s cho content script inject + Flow React mount
      await new Promise(r => setTimeout(r, 2000));
    } else {
      // Tab có sẵn → activate (focus window + tab) để menu mở được
      try {
        await chrome.tabs.update(flowTab.id, { active: true });
        if (flowTab.windowId) {
          await chrome.windows.update(flowTab.windowId, { focused: true });
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('MessageBridge#listener', _); }
    }

    // 3. Set target tab ID để sendToContentScript dùng đúng tab
    try {
      window._targetFlowTabId = flowTab.id;
      await chrome.storage?.session?.set?.({ targetFlowTabId: flowTab.id });
    } catch (_) { globalThis.SEOSONA_swallow?.('MessageBridge#listener', _); }

    return flowTab;
  }

  /**
   * Scrape Flow advanced menu → Voices tab → lưu local + (admin only) POST sync server.
   * Pattern: chỉ admin role POST lên server (sync-from-scrape endpoint check role:admin).
   * User thường: lưu local-only để cá nhân hóa dropdown voice picker.
   *
   * @returns {Promise<{total, base, custom, uploaded_to_server}>}
   */
  static async syncFlowVoices() {
    // 1. Ensure Flow tab exists + active + content script ready
    await this._ensureFlowTabReadyForScrape();

    // 2. Send scrape message tới content script
    const res = await this.sendToContentScript('scrapeFlowVoices');
    if (!res?.success || !Array.isArray(res.voices)) {
      throw new Error(res?.error || 'Scrape failed');
    }

    // 3. Lưu local qua VoiceRegistry (merge với base catalog)
    const merged = await window.VoiceRegistry.saveScrapedList(res.voices, 'flow');
    const customCount = merged.filter(v => v.is_custom).length;
    const baseCount = merged.length - customCount;

    // 4. POST sync server — CHỈ ADMIN
    let uploadedToServer = false;
    try {
      const user = ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' });
      const isAdmin = !!(user?.role === 'admin' || user?.is_admin === true);
      console.log('[MessageBridge] Voice sync admin check:', {
        hasAuthManager: !false,
        hasUser: !!user,
        userEmail: user?.email,
        userRole: user?.role,
        isAdmin,
      });
      // Offline: bỏ nhánh scrape-sync voice lên backend (raw fetch KHÔNG qua ApiClient nên LOCAL_MODE
      // không chặn được). Gate điều kiện (KHÔNG return) để func vẫn trả {total,base,custom} cho nút Resync.
      // Voice offline: _LOCAL_BASE_CATALOG + saveScrapedList (bước 3 ở trên) đã lưu local xong.
      if (self.SEOSONA_LOCAL_MODE === false && isAdmin) {
        const baseUrl = window.ApiBaseConfig?.getWebBase?.() || 'http://localhost:8080';
        const token = window.authManager?.token;
        const headers = {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        try {
          if (chrome?.runtime?.id) headers['X-Extension-Id'] = chrome.runtime.id;
        } catch (_) { globalThis.SEOSONA_swallow?.('MessageBridge#listener', _); }
        try {
          const v = chrome?.runtime?.getManifest?.()?.version;
          if (v) headers['X-Ext-Version'] = v;
        } catch (_) { globalThis.SEOSONA_swallow?.('MessageBridge#listener', _); }

        const url = `${baseUrl}/api/v1/provider-voices/sync-from-scrape`;
        const body = JSON.stringify({
          provider: 'flow',
          scraped_voices: res.voices.map(v => ({ name: v.name, description: v.description || null })),
          extension_version: chrome?.runtime?.getManifest?.()?.version || null,
        });
        const sigHeaders = (typeof window.RequestSigner !== 'undefined')
          ? await window.RequestSigner.headers('POST', new URL(url).pathname, body)
          : {};

        const resp = await fetch(url, {
          method: 'POST',
          headers: { ...headers, ...sigHeaders },
          body,
        });
        if (resp.ok) {
          const json = await resp.json();
          uploadedToServer = true;
          console.log('[MessageBridge] ✓ Voice sync uploaded:', json.data);
        } else if (resp.status === 403) {
          const txt = await resp.text().catch(() => '');
          console.warn('[MessageBridge] ✗ Voice sync 403 — admin role required:', txt);
        } else if (resp.status === 429) {
          const retryAfter = resp.headers.get('Retry-After') || resp.headers.get('X-RateLimit-Reset') || '?';
          console.warn(`[MessageBridge] ✗ Voice sync 429 — rate limited. Retry after ${retryAfter}s`);
          throw new Error(`Server rate limit (429). Đợi ${retryAfter}s rồi thử lại.`);
        } else {
          console.warn('[MessageBridge] Voice sync failed:', resp.status);
        }
      }
    } catch (e) {
      console.warn('[MessageBridge] Voice sync POST error (non-blocking):', e.message);
    }

    return {
      total: merged.length,
      base: baseCount,
      custom: customCount,
      uploaded_to_server: uploadedToServer,
    };
  }

  /**
   * Select voice trong menu Flow (submit pipeline). Content script tự open menu →
   * search → click → close.
   * @param {{slug, search_value}} voice
   */
  static async selectFlowVoice(voice) {
    if (!voice || !voice.search_value) return { success: true, skipped: true };
    return this.sendToContentScript('selectFlowVoice', { voice });
  }

  /**
   * Flow Character Selector — scrape tab Nhân vật → lưu LOCAL (KHÔNG sync server,
   * nhân vật là data riêng mỗi user). Clone syncFlowVoices bỏ phần POST admin.
   * @returns {Promise<{total}>}
   */
  static async syncFlowCharacters() {
    await this._ensureFlowTabReadyForScrape();

    const res = await this.sendToContentScript('scrapeFlowCharacters');
    if (!res?.success || !Array.isArray(res.characters)) {
      throw new Error(res?.error || 'Scrape failed');
    }

    const merged = await window.CharacterRegistry.saveScrapedList(res.characters);
    return { total: merged.length };
  }

  /**
   * Select character trong menu Flow (submit pipeline). Content script tự open menu →
   * tab Nhân vật → scroll-match → click → "Thêm vào câu lệnh".
   * @param {{slug, search_value}} character
   */
  static async selectFlowCharacter(character) {
    if (!character || !character.search_value) return { success: true, skipped: true };
    return this.sendToContentScript('selectFlowCharacter', { character });
  }

  // === Phase CG-3.5: Cross-provider bridge cho ChatGPT ===

  /**
   * Submit prompt + chờ kết quả image qua content script ChatGPT.
   * Caller PHẢI ensure tab ChatGPT đã inject script + login + (nếu cần) activate
   * image mode/setRatio TRƯỚC khi gọi method này (qua ChatGPTSession).
   *
   * @param {Object} opts
   * @param {string} opts.text - Prompt text (đã clean, KHÔNG kèm prefix)
   * @param {Array<{base64,name,type}>} [opts.images] - Ref images (optional)
   * @param {Object} [opts.settings] - { imageMode, ratio, fallbackPrefix }
   * @param {number} [opts.timeout] - Timeout ms (default 120000)
   * @param {number} opts.tabId - Tab ID của ChatGPT (bắt buộc)
   * @param {string} [opts.taskName] - Tên task/workflow để route subfolder download (CG-5/CG-7 sẽ dùng)
   * @returns {Promise<{success:boolean, imageUrls?:string[], altPrompt?:string, turnId?:string, error?:string, message?:string}>}
   */
  static async chatGPTSubmitAndWait({ text, images, settings, timeout, tabId, taskName }) {
    if (!tabId) {
      return { success: false, error: 'MISSING_TAB_ID' };
    }
    console.log('[MessageBridge] chatGPTSubmitAndWait → tab', tabId, 'text len:', (text||'').length, 'images:', (images||[]).length);
    const effTimeout = timeout || 120000;
    return new Promise((resolve) => {
      // [Audit fix Finding 3] Caller-side watchdog — handler `return true` mà không sendResponse
      // → callback không fire → treo. Margin +30s trên timeout để content script tự settle trước.
      let settled = false;
      const done = (v) => { if (settled) return; settled = true; clearTimeout(watchdog); resolve(v); };
      const watchdog = setTimeout(() => done({ success: false, error: 'BRIDGE_TIMEOUT' }), effTimeout + 30000);
      try {
        chrome.tabs.sendMessage(
          tabId,
          {
            action: 'chatgpt:submitAndWait',
            text: text || '',
            images: images || [],
            settings: settings || {},
            timeout: effTimeout,
            taskName: taskName || null,
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              done({
                success: false,
                error: 'SEND_FAILED',
                message: chrome.runtime.lastError.message,
              });
              return;
            }
            done(resp || { success: false, error: 'NO_RESPONSE' });
          }
        );
      } catch (err) {
        done({ success: false, error: 'EXCEPTION', message: err.message });
      }
    });
  }

  /**
   * Fetch ảnh CDN của ChatGPT (cần cookie session) qua background.js executeScript.
   * URL có signature TTL ~vài giờ — phải fetch ngay sau khi detect.
   *
   * @param {string} url - URL CDN (https://chatgpt.com/backend-api/estuary/content?id=file_xxx...)
   * @param {number} tabId - Tab ID của ChatGPT (cần cookie session)
   * @returns {Promise<{success:boolean, base64?:string, mime?:string, size?:number, error?:string}>}
   */
  static async chatGPTFetchImage(url, tabId) {
    return new Promise((resolve) => {
      // [Audit fix Finding 3] Watchdog — background handler treo → callback không fire → treo.
      let settled = false;
      const done = (v) => { if (settled) return; settled = true; clearTimeout(watchdog); resolve(v); };
      const watchdog = setTimeout(() => done({ success: false, error: 'BRIDGE_TIMEOUT' }), this._BRIDGE_TIMEOUT_MS);
      try {
        chrome.runtime.sendMessage(
          { action: 'chatgpt:fetchImage', url, tabId },
          (resp) => {
            if (chrome.runtime.lastError) {
              done({
                success: false,
                error: 'SEND_FAILED',
                message: chrome.runtime.lastError.message,
              });
              return;
            }
            done(resp || { success: false, error: 'NO_RESPONSE' });
          }
        );
      } catch (err) {
        done({ success: false, error: 'EXCEPTION', message: err.message });
      }
    });
  }

  /**
   * Phase CG-8: Submit prompt text-only tới Gemini, chờ text response.
   * Caller (GeminiAdapter) đã ensureReady → có tabId.
   *
   * @param {Object} opts
   * @param {string} opts.text - Prompt text
   * @param {number} [opts.timeout=60000]
   * @param {number} opts.tabId - Tab ID Gemini
   * @returns {Promise<{success:boolean, text?:string, turnId?:string, error?:string, message?:string}>}
   */
  static async geminiSubmitAndWait({ text, images, timeout, tabId }) {
    if (!tabId) {
      return { success: false, error: 'MISSING_TAB_ID' };
    }
    const imgArr = Array.isArray(images) ? images : [];
    console.log('[MessageBridge] geminiSubmitAndWait → tab', tabId, 'text len:', (text || '').length, 'images:', imgArr.length);
    const effTimeout = timeout || window.SystemConfig?.getTimeout('api_timeout_ms') || 60000;
    return new Promise((resolve) => {
      // [Audit fix Finding 3] Watchdog — handler `return true` mà không sendResponse → treo.
      let settled = false;
      const done = (v) => { if (settled) return; settled = true; clearTimeout(watchdog); resolve(v); };
      const watchdog = setTimeout(() => done({ success: false, error: 'BRIDGE_TIMEOUT' }), effTimeout + 30000);
      try {
        chrome.tabs.sendMessage(
          tabId,
          {
            action: 'gemini:submitAndWait',
            text: text || '',
            images: imgArr,
            timeout: effTimeout,
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              done({
                success: false,
                error: 'SEND_FAILED',
                message: chrome.runtime.lastError.message,
              });
              return;
            }
            done(resp || { success: false, error: 'NO_RESPONSE' });
          }
        );
      } catch (err) {
        done({ success: false, error: 'EXCEPTION', message: err.message });
      }
    });
  }

  /**
   * Cross-provider helper: ChatGPT image URL → Flow tile.
   * Flow:
   *   1. Fetch ChatGPT CDN image qua cookie session → base64 data URL
   *   2. Tách base64 body khỏi header data:mime;base64,...
   *   3. Upload vào Google Flow qua uploadFilesToFlow → tileDetails
   *
   * Helper này chưa wire vào workflow executor (CG-7 sẽ làm).
   *
   * @param {string} url - ChatGPT CDN URL
   * @param {number} tabId - Tab ID ChatGPT
   * @param {string} [fileName='chatgpt-result.png']
   * @returns {Promise<{success:boolean, tileDetails?:Array, error?:string}>}
   */
  static async chatGPTBridgeToFlow(url, tabId, fileName = 'chatgpt-result.png') {
    // 1. Fetch ChatGPT CDN
    const fetchResult = await this.chatGPTFetchImage(url, tabId);
    if (!fetchResult?.success) {
      return { success: false, error: fetchResult?.error || 'FETCH_FAILED' };
    }

    // 2. Tách header data:mime;base64,body
    const matches = (fetchResult.base64 || '').match(/^data:(.+?);base64,(.+)$/);
    if (!matches) {
      return { success: false, error: 'INVALID_BASE64' };
    }
    const mime = matches[1] || fetchResult.mime || 'image/png';
    const base64Body = matches[2];

    // 3. Upload vào Flow qua existing helper (uploadFilesToFlow nhận filesData = [{name,type,base64}])
    try {
      const uploadResult = await this.uploadFilesToFlow([
        { name: fileName, type: mime, base64: base64Body },
      ]);
      // uploadFilesToFlow trả object merged {tileIds,orderedTileIds,tileDetails,keyMapping,error} —
      // KHÔNG có field `success`. Check đúng = có tileDetails + không error (parity grokBridgeToFlow).
      // Check cũ `uploadResult.success===false` luôn false → upload fail/UPLOAD_BLOCKED lọt thành success.
      if (!uploadResult || uploadResult.error || !(uploadResult.tileDetails?.length || uploadResult.orderedTileIds?.length)) {
        return {
          success: false,
          error: uploadResult?.error || 'UPLOAD_FAILED',
        };
      }
      return {
        success: true,
        tileDetails: uploadResult.tileDetails || uploadResult,
      };
    } catch (err) {
      return { success: false, error: 'UPLOAD_EXCEPTION', message: err.message };
    }
  }

  // === Phase G-3.3: Cross-provider bridge cho Grok ===

  /**
   * Submit prompt qua Grok content script + chờ kết quả.
   * Caller (GrokAdapter) PHẢI ensureReady() + apply settings (mode/ratio/quantity)
   * trước khi gọi method này.
   *
   * @param {Object} opts
   * @param {string} opts.text - Prompt text
   * @param {Array<{base64,name,type}>} [opts.images] - Ref images (base64 pre-resolved)
   * @param {Object} [opts.settings] - { mode, ratio, quantity, duration, resolution, timeout }
   * @param {number} [opts.timeout=180000]
   * @param {number} opts.tabId - Tab ID Grok (bắt buộc)
   * @param {string} [opts.taskName] - Subfolder cho download
   * @returns {Promise<{success:boolean, mediaUrls?:string[], mediaType?:string, postId?:string, url?:string, error?:string, message?:string}>}
   */
  static async grokSubmitAndWait({ text, images, settings, timeout, tabId, taskName }) {
    if (!tabId) {
      return { success: false, error: 'MISSING_TAB_ID' };
    }
    console.log('[MessageBridge] grokSubmitAndWait → tab', tabId, 'text len:', (text || '').length, 'images:', (images || []).length);
    const effTimeout = timeout || window.SystemConfig?.getTimeout('image_timeout_ms') || 180000;
    return new Promise((resolve) => {
      // [Audit fix Finding 3] Watchdog — background handler treo → callback không fire → treo.
      let settled = false;
      const done = (v) => { if (settled) return; settled = true; clearTimeout(watchdog); resolve(v); };
      const watchdog = setTimeout(() => done({ success: false, error: 'BRIDGE_TIMEOUT' }), effTimeout + 30000);
      try {
        chrome.runtime.sendMessage(
          {
            action: 'grok:submitAndWait',
            tabId,
            payload: {
              text: text || '',
              images: images || [],
              settings: settings || {},
              timeout: effTimeout,
              taskName: taskName || null,
            },
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              done({
                success: false,
                error: 'BRIDGE_ERROR',
                message: chrome.runtime.lastError.message,
              });
              return;
            }
            done(resp || { success: false, error: 'NO_RESPONSE' });
          }
        );
      } catch (err) {
        done({ success: false, error: 'EXCEPTION', message: err.message });
      }
    });
  }

  /**
   * Abort signal — gửi tới Grok content script để break các loop polling sớm.
   * Set flag __grokAbort=true trong content script. handleSubmitAndWait check flag
   * trong waitForResultPage + extract loop → return error 'ABORTED' ngay.
   *
   * @param {number} tabId - Tab ID Grok
   * @returns {Promise<{success:boolean}>}
   */
  static async grokAbort(tabId) {
    if (!tabId) return { success: false, error: 'MISSING_TAB_ID' };
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, { action: 'grok:abort' }, (resp) => {
          if (chrome.runtime.lastError) {
            // Tab có thể đã đóng / content script chưa load → coi như success
            resolve({ success: true, message: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp || { success: true });
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  }

  /**
   * Abort signal — gửi tới ChatGPT content script để break các loop polling sớm.
   * Set flag __chatgptAbort=true trong content script. waitForTextResult/waitForImageResult
   * check flag → return error 'ABORTED' ngay.
   *
   * @param {number} tabId - Tab ID ChatGPT
   * @returns {Promise<{success:boolean}>}
   */
  static async chatgptAbort(tabId) {
    if (!tabId) return { success: false, error: 'MISSING_TAB_ID' };
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, { action: 'chatgpt:abort' }, (resp) => {
          if (chrome.runtime.lastError) {
            // Tab có thể đã đóng / content script chưa load → coi như success
            resolve({ success: true, message: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp || { success: true });
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  }

  /**
   * Fetch CDN image/video URL từ Grok với cookie session (qua background executeScript).
   * URL có signature TTL — phải fetch ngay khi detect.
   *
   * @param {string} url - URL CDN (assets.grok.com / grok.x.ai / grok.com)
   * @param {number} tabId - Tab ID Grok (cần cookie session)
   * @returns {Promise<{success:boolean, base64?:string, mime?:string, size?:number, error?:string}>}
   */
  static async grokFetchImage(url, tabId) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { action: 'grok:fetchImage', url, tabId },
          (resp) => {
            if (chrome.runtime.lastError) {
              resolve({
                success: false,
                error: 'SEND_FAILED',
                message: chrome.runtime.lastError.message,
              });
              return;
            }
            resolve(resp || { success: false, error: 'NO_RESPONSE' });
          }
        );
      } catch (err) {
        resolve({ success: false, error: 'EXCEPTION', message: err.message });
      }
    });
  }

  /**
   * Download 1 media Grok ra disk với 3-tier fallback (dùng CHUNG cho mọi path: GenTab/Task/
   * Workflow/app.js — tránh drift khi fix riêng lẻ).
   *   Tier 1: prefetchedBase64 (content-script `fetchedMedia`, Option C) → blob download.
   *   Tier 2: grokFetchImage(url, tabId) → base64 → blob download.
   *   Tier 3: chromeDownload({ url }) TRỰC TIẾP — browser download manager fetch native (gửi cookie
   *           grok + bypass CORS/HTTP2). Cần cho VIDEO mp4 mà Tier 1/2 fail (CORS net::ERR_FAILED).
   *           onDeterminingFilename vẫn apply rename vì byExtensionId === chrome.runtime.id.
   * @param {string} url        Grok CDN media URL (assets.grok.com / *.x.ai)
   * @param {number} tabId      Tab Grok (cho grokFetchImage cookie session)
   * @param {string} filename   Path đầy đủ (folder/name.ext) — caller build sẵn
   * @param {string|null} prefetchedBase64  base64 data-URL đã pre-fetch (nếu có)
   * @returns {Promise<{success:boolean, tier:number, error?:string}>}
   */
  static async grokDownloadMedia(url, tabId, filename, prefetchedBase64 = null) {
    const _chromeDl = async (rawUrl) => {
      // Dọn TRƯỚC, ngoài Promise: `new Promise(async …)` mà await ném thì không ai resolve → treo.
      const dlUrl = await (globalThis.scrubbedDownloadUrl?.(rawUrl) ?? rawUrl);
      return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { action: 'chromeDownload', url: dlUrl, filename },
          (r) => resolve(r || { success: false, error: 'NO_RESPONSE' })
        );
      } catch (e) { resolve({ success: false, error: e.message }); }
      });
    };

    // Tier 1/2: lấy base64
    let base64 = prefetchedBase64 || null;
    let fetchErr = null;
    if (!base64 && tabId) {
      const r = await this.grokFetchImage(url, tabId).catch(() => null);
      if (r?.success && r.base64) base64 = r.base64;
      else fetchErr = r?.error || 'FETCH_FAILED';
    }

    if (base64) {
      try {
        const blob = await (await fetch(base64)).blob();
        const blobUrl = URL.createObjectURL(blob);
        const dl = await _chromeDl(blobUrl);
        setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch (_) { globalThis.SEOSONA_swallow?.('MessageBridge#_chromeDl', _); } }, 60000);
        if (dl?.success) return { success: true, tier: prefetchedBase64 ? 1 : 2 };
        fetchErr = dl?.error || 'CHROME_DL_FAILED'; // fall through Tier 3
      } catch (e) {
        fetchErr = e.message; // blob build fail → Tier 3
      }
    }

    // Tier 3: direct URL download (browser manager — cookie + bypass CORS)
    const dl = await _chromeDl(url);
    return { success: !!dl?.success, tier: 3, error: dl?.success ? undefined : (dl?.error || fetchErr) };
  }

  /**
   * Cross-provider bridge: Grok result URL → upload sang Flow → trả về tile ID mới.
   * Dùng cho workflow node grok cần feed kết quả xuống Flow downstream nodes.
   *
   * Flow:
   *   1. Fetch Grok CDN qua cookie session → base64 data URL.
   *   2. Tách header data:mime;base64,body.
   *   3. Upload vào Google Flow qua uploadFilesToFlow → tileDetails.
   *
   * @param {string} url - Grok CDN URL
   * @param {number} tabId - Tab ID Grok
   * @param {string} [fileName='grok-result.png'] - Tên file (auto append ext nếu thiếu)
   * @returns {Promise<{success:boolean, tileId?:string, fileName?:string, thumbnailUrl?:string, error?:string, message?:string}>}
   */
  static async grokBridgeToFlow(url, tabId, fileName = 'grok-result.png') {
    try {
      // 1. Fetch Grok CDN
      const fetchResp = await this.grokFetchImage(url, tabId);
      if (!fetchResp?.success || !fetchResp.base64) {
        return { success: false, error: fetchResp?.error || 'FETCH_FAILED' };
      }

      // 2. Tách header data:mime;base64,body
      const base64Match = (fetchResp.base64 || '').match(/^data:([^;]+);base64,(.+)$/);
      if (!base64Match) {
        return { success: false, error: 'INVALID_DATA_URL' };
      }
      const mime = base64Match[1];
      const base64Data = base64Match[2];
      const ext = mime.includes('video') ? 'mp4' : (mime.split('/')[1] || 'png');
      const finalName = fileName.includes('.') ? fileName : `${fileName}.${ext}`;

      // 3. Upload sang Flow qua existing uploadFilesToFlow handler
      const uploadResp = await this.uploadFilesToFlow([
        { name: finalName, type: mime, base64: base64Data },
      ]);
      const tileDetails = uploadResp?.tileDetails?.[0];
      if (!tileDetails?.id) {
        return { success: false, error: 'UPLOAD_FAILED' };
      }

      // BUG FIX 2026-05-11: Không fallback về finalName (generated name như grok-1234.png)
      // vì nó không phải Flow file_name (UUID). Nếu tileDetails.file_name rỗng,
      // caller (WorkflowExecutor) sẽ extract từ thumbnailUrl.
      return {
        success: true,
        tileId: tileDetails.id,
        fileName: tileDetails.file_name || '',
        thumbnailUrl: tileDetails.thumbnailUrl || '',
      };
    } catch (err) {
      return { success: false, error: 'BRIDGE_ERROR', message: err?.message };
    }
  }
}

window.MessageBridge = MessageBridge;
