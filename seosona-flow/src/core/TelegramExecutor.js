/**
 * TelegramExecutor -- Nhận lệnh từ Telegram qua SSE, thực hiện trên multi-provider
 * Trả kết quả về backend để gửi lại Telegram
 *
 * Phase 3: Multi-provider support (Flow, ChatGPT, Grok)
 * - _getDefaultProvider(): Lấy provider mặc định từ settings
 * - _getProviderSettings(provider): Lấy settings theo từng provider
 * - _executeGenerate(): Dynamic route theo provider
 * - _executeFlowGenerate(): Google Flow (legacy, wrapped)
 * - _executeChatGPTGenerate(): ChatGPT via ChatGPTSession
 * - _executeGrokGenerate(): Grok via GrokSession
 */
class TelegramExecutor {
  static _currentQueueId = null;
  static _isExecuting = false;
  static _initialized = false;

  /**
   * Khởi tạo -- đăng ký lắng nghe SSE events
   */
  static init() {
    if (this._initialized) return;
    this._initialized = true;

    // Lắng nghe lệnh từ Telegram qua SSE
    // Phase 3: TelegramExecutor xử lý TẤT CẢ providers (flow, chatgpt, grok)
    // Backend gửi provider trong args.provider, TelegramExecutor route động
    window.eventBus?.on('sse:telegram_command', (data) => {
      const command = data.command || '';
      const provider = data.args?.provider || data.target || 'flow';
      console.log(`[TelegramExecutor] SSE command received: ${command}, provider: ${provider}`);
      this._execute(data);
    });
    // Lắng nghe hủy lệnh
    window.eventBus?.on('sse:telegram_cancel', (data) => this._handleCancel(data));
    // Lắng nghe dừng lệnh (từ /stop command)
    window.eventBus?.on('sse:telegram_stop', (data) => this._handleStop(data));
    console.log('[TelegramExecutor] Đã khởi tạo');
  }

  /**
   * Thực hiện lệnh từ Telegram
   */
  static async _execute(data) {
    // L15: /stop must be reachable while busy — it is the escape hatch. Handle it
    // before the busy-guard so a stuck/long-running command can still be cancelled.
    const _cmd = data?.command;
    if (_cmd === '/stop' || _cmd === 'stop') {
      const { queue_id } = data;
      try {
        const result = await this._executeStop();
        await this._sendResult(queue_id, 'completed', result?.thumbnails || []);
      } catch (e) {
        await this._sendResult(queue_id, 'failed', null, e?.message || 'stop failed');
      }
      return;
    }

    if (this._isExecuting) {
      const { queue_id } = data;
      await this._sendResult(queue_id, 'failed', null, window.I18n?.t('telegram.busyProcessing') || 'Extension đang bận xử lý lệnh khác');
      return;
    }

    console.log('=== [TelegramExecutor] RECEIVED SSE EVENT ===');
    console.log('[TelegramExecutor] Full data:', JSON.stringify(data, null, 2));
    const { command, args, queue_id } = data;
    console.log('[TelegramExecutor] command:', command);
    console.log('[TelegramExecutor] args:', JSON.stringify(args, null, 2));
    console.log('[TelegramExecutor] args.frames:', args?.frames, '(type:', typeof args?.frames, ')');
    console.log('=== END SSE EVENT DATA ===');
    this._currentQueueId = queue_id;
    this._isExecuting = true;

    try {
      // Kiểm tra ExecutionLock
      if (window.ExecutionLock?.isBlockedBy('telegram')) {
        await this._sendResult(queue_id, 'failed', null, window.I18n?.t('telegram.busyOtherTask') || 'Extension đang bận thực hiện tác vụ khác');
        return;
      }
      window.ExecutionLock?.acquire('telegram', `Telegram: ${command}`);

      // CRITICAL: Active Flow tab trước khi execute (user có thể đang ở tab khác)
      try {
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => resolve());
        });
        await new Promise(r => setTimeout(r, 500)); // Chờ tab active + React unthrottle
      } catch (e) {
        console.warn('[TelegramExecutor] ensureFlowTabActive failed:', e.message);
      }

      // Hiển thị thông báo trên UI
      if (typeof window.sidebarLog === 'function') {
        window.sidebarLog(`[Telegram] Đang xử lý: ${command}`, 'info');
      }

      // SP: ExecutionGate — xin phép server trước khi chạy (extension là nơi DUY NHẤT trừ quota)
      const provider = args?.provider || data.target || 'flow';
      const execAction = this._mapCommandToAction(command, provider);
      this._currentExecutionToken = null;
      if (execAction && window.ExecutionGate) {
        try {
          const promptCount = Math.min(args?.count || 1, 4);
          const gate = await ExecutionGate.request(execAction, promptCount, { owner: 'telegram', label: `Telegram: ${command}`, provider });
          if (!gate.allowed) {
            const limit = gate.limit ?? '?';
            const used = gate.used ?? '?';
            const msg = gate.reason === 'QUOTA_EXCEEDED'
              ? (window.I18n?.t('telegram.quotaExhaustedUpsale', { limit, used }) || `📊 Đã hết lượt sử dụng hôm nay.\nGiới hạn: ${limit} lượt/ngày | Đã dùng: ${used} lượt\n\n💡 Nâng cấp gói Premium để tăng giới hạn!\nGõ /quota để xem chi tiết.`)
              : (window.I18n?.t('telegram.featureLockedUpsale') || '🔒 Tính năng bị khóa cho gói hiện tại.\n\n💡 Nâng cấp gói Premium để mở khóa!\nGõ /plan để xem thông tin.');
            await this._sendResult(queue_id, 'failed', null, msg);
            return;
          }
          this._currentExecutionToken = gate.token;
        } catch (e) {
          if (window.QuotaErrorHandler?.isQuotaError(e)) {
            console.warn('[TelegramExecutor] ExecutionGate denied:', e.code || e.reason);
            const limit = e.serverData?.limit ?? e.serverData?.global?.limit ?? '?';
            const used = e.serverData?.used ?? e.serverData?.global?.used ?? '?';
            const isQuota = e.code === 'QUOTA_EXCEEDED' || e.code === 'GLOBAL_QUOTA_EXCEEDED';
            const msg = isQuota
              ? (window.I18n?.t('telegram.quotaExhaustedUpsale', { limit, used }) || `📊 Đã hết lượt sử dụng hôm nay.\nGiới hạn: ${limit} lượt/ngày | Đã dùng: ${used} lượt\n\n💡 Nâng cấp gói Premium để tăng giới hạn!\nGõ /quota để xem chi tiết.`)
              : (window.I18n?.t('telegram.featureLockedUpsale') || '🔒 Tính năng bị khóa cho gói hiện tại.\n\n💡 Nâng cấp gói Premium để mở khóa!\nGõ /plan để xem thông tin.');
            await this._sendResult(queue_id, 'failed', null, msg);
            return;
          }
          console.warn('[TelegramExecutor] ExecutionGate request failed, proceeding:', e.message);
        }
      }

      let result;
      switch (command) {
        case '/image':
        case 'image':
          result = await this._executeGenerate(args);
          break;
        case '/video':
        case 'video':
          result = await this._executeVideo(args);
          break;
        case '/workflow':
        case 'workflow':
          result = await this._executeWorkflow(args);
          break;
        case '/stop':
        case 'stop':
          result = await this._executeStop();
          break;
        default:
          await this._sendResult(queue_id, 'failed', null, window.I18n?.t('telegram.unsupportedCommand', { command }) || `Lệnh không hỗ trợ: ${command}`);
          return;
      }

      await this._sendResult(queue_id, 'completed', result?.thumbnails || []);

      // SP: ExecutionGate complete (success)
      if (window.ExecutionGate && this._currentExecutionToken) {
        ExecutionGate.complete(this._currentExecutionToken, 'success');
        this._currentExecutionToken = null;
      }

      if (typeof window.sidebarLog === 'function') {
        window.sidebarLog(`[Telegram] Hoàn thành: ${command}`, 'success');
      }
    } catch (err) {
      console.error('[TelegramExecutor] Lỗi:', err.message);
      await this._sendResult(queue_id, 'failed', null, err.message);
      // SP: ExecutionGate complete (failed)
      if (window.ExecutionGate && this._currentExecutionToken) {
        ExecutionGate.complete(this._currentExecutionToken, 'failed', { error: err.message });
        this._currentExecutionToken = null;
      }
      if (typeof window.sidebarLog === 'function') {
        window.sidebarLog(`[Telegram] Lỗi: ${err.message}`, 'error');
      }
    } finally {
      window.ExecutionLock?.release('telegram');
      this._currentQueueId = null;
      this._isExecuting = false;
    }
  }

  /**
   * Lấy provider mặc định từ settings
   * @returns {Promise<string>} 'flow' | 'chatgpt' | 'grok'
   */
  static async _getDefaultProvider() {
    const settings = await window.storageSettings?.getSettings();
    return settings?.telegramDefaultProvider || 'flow';
  }

  /**
   * Lấy settings theo từng provider cho Telegram
   * @param {string} provider - 'flow' | 'chatgpt' | 'grok'
   * @returns {Promise<Object>} Provider-specific settings
   */
  static async _getProviderSettings(provider) {
    const settings = await window.storageSettings?.getSettings();
    switch (provider) {
      case 'flow':
        return {
          ratio: settings?.telegramFlowRatio || '16:9',
          // Strict Server-Only: user pref → ModelRegistry → null (caller xử lý).
          model: settings?.telegramFlowModel || window.ModelRegistry?.safeGetDefault('flow', 'image') || null,
        };
      case 'chatgpt':
        return {
          ratio: settings?.telegramChatgptRatio || 'square',
        };
      case 'grok':
        return {
          mode: settings?.telegramGrokMode || 'image',
          ratio: settings?.telegramGrokRatio || 'widescreen',
          duration: settings?.telegramGrokDuration || '6s',
          resolution: settings?.telegramGrokResolution || '720p',
          imageQuality: settings?.telegramGrokImageQuality || 'speed',
        };
      default:
        return {};
    }
  }

  /**
   * Tạo ảnh/video từ prompt - Dynamic provider routing
   * @param {Object} args - { prompt, ratio, model, count, genType, provider, ref_image_url, ref_image_base64, ref_images_base64 }
   * genType: 'Image' (default) hoặc 'Video'
   * provider: 'flow' | 'chatgpt' | 'grok' (từ SSE command data hoặc default)
   * ref_images_base64: array of base64 strings (multi-image support)
   */
  static async _executeGenerate(args) {
    console.log('[TelegramExecutor] _executeGenerate called with args:', JSON.stringify(args));
    console.log('[TelegramExecutor] args.frames =', args.frames, ', typeof =', typeof args.frames);

    // Lấy provider từ args hoặc default
    const provider = args.provider || await this._getDefaultProvider();
    console.log('[TelegramExecutor] Using provider:', provider);

    // Route theo provider
    switch (provider) {
      case 'chatgpt':
        return this._executeChatGPTGenerate(args);
      case 'grok':
        return this._executeGrokGenerate(args);
      case 'flow':
      default:
        return this._executeFlowGenerate(args);
    }
  }

  /**
   * Tạo ảnh/video từ prompt - Google Flow provider
   * @param {Object} args - { prompt, ratio, model, count, genType, ref_image_url, ref_image_base64, ref_images_base64, video_duration }
   * genType: 'Image' (default) hoặc 'Video'
   * ref_images_base64: array of base64 strings (multi-image support)
   * video_duration: '4s'|'6s'|'8s'|'10s' (chỉ dùng cho video mode)
   */
  static async _executeFlowGenerate(args) {
    console.log('[TelegramExecutor] _executeFlowGenerate (Flow provider)');
    const { prompt, ratio, model, count, ref_image_url, ref_image_base64, ref_images_base64, genType = 'Image', video_duration } = args;

    // Upload ảnh ref nếu có (hỗ trợ cả single và multiple)
    let refFileIds = [];

    // Ưu tiên ref_images_base64 (array) nếu có
    if (ref_images_base64 && Array.isArray(ref_images_base64) && ref_images_base64.length > 0) {
      console.log(`[TelegramExecutor] Uploading ${ref_images_base64.length} ref images...`);
      for (const base64 of ref_images_base64) {
        const tileId = await this._uploadRefFromBase64(base64);
        if (tileId) {
          refFileIds.push(tileId);
        }
      }
      console.log(`[TelegramExecutor] Uploaded ${refFileIds.length} ref images successfully`);
    } else if (ref_image_base64) {
      // Fallback: single image (backward compatible)
      const tileId = await this._uploadRefFromBase64(ref_image_base64);
      if (tileId) refFileIds.push(tileId);
    } else if (ref_image_url) {
      const tileId = await this._uploadRefFromUrl(ref_image_url);
      if (tileId) refFileIds.push(tileId);
    }

    // Chuyển sang pipeline PromptQueue nếu bật
    if (window.PromptQueue && PromptQueue.isEnabled()) {
      // Video không hỗ trợ quantity > 1, Image hỗ trợ 1-4
      const isVideo = genType === 'Video';
      const quantity = isVideo ? 1 : Math.min(count || 1, 4);
      // Port 1.1.49: video → clamp ratio về 16:9/9:16 (Flow video không nhận ratio ảnh).
      const aspectRatio = this._mapRatio(isVideo ? this._clampFlowVideoRatio(ratio) : ratio);
      // Video mode: isFrames từ --frames flag (args.frames), không phải từ có ref hay không
      const isFrames = isVideo && !!args.frames;
      console.log(`[TelegramExecutor] Pipeline video settings: isVideo=${isVideo}, isFrames=${isFrames}, args.frames=${args.frames}`);

      // FIX: Đọc download settings từ user settings (không hardcode)
      const downloadSettings = await this._getDownloadSettings();
      // CRITICAL: Check feature gate trước khi enable auto_download
      const canAutoDownload = window.featureGate ? window.featureGate.canUse('auto_download') : true;
      // args.autoDownload từ Telegram menu override default (nếu được set)
      const autoDownloadOverride = args.autoDownload;
      const autoDownload = autoDownloadOverride !== undefined
        ? (autoDownloadOverride === true || autoDownloadOverride === 'true') && canAutoDownload
        : downloadSettings.autoDownload && canAutoDownload;
      console.log(`[TelegramExecutor] Download settings: autoDownload=${autoDownload}, override=${autoDownloadOverride}, canAutoDownload=${canAutoDownload}, image=${downloadSettings.downloadResolution}, video=${downloadSettings.videoDownloadResolution}`);

      // Build refFileNames map từ MediaRegistry sau upload — fileName UUID Flow persistent
      // giúp tier2 fallback addFileToPrompt resolve tile_id mới sau reload Flow.
      const _telegramRefFileNames = {};
      for (const fid of refFileIds) {
        const fn = window.MediaRegistry?.getFileName?.(fid) || window.GenTab?.fileNameCache?.[fid];
        if (fn) _telegramRefFileNames[fid] = fn;
      }

      const result = await PromptQueue.getInstance().submitJob({
        owner: 'telegram',
        label: isVideo ? 'Telegram Video' : 'Telegram Generate',
        // Forward token đã xin ở _execute → PromptQueue KHÔNG xin token mới (tránh trừ quota 2 lần).
        _executionToken: this._currentExecutionToken,
        prompts: [prompt],  // 1 prompt duy nhất
        settings: {
          genType: genType,
          ratio: aspectRatio || 'Dọc',
          model: model || null,
          quantity: quantity,  // quantity = count (click chọn x1/x2/x3/x4)
          isFrames: isFrames,  // Video: Frames vs Ingredients mode
          flowVideoDuration: isVideo ? (video_duration || null) : null,
        },
        refFileIds: refFileIds,
        refFileNames: _telegramRefFileNames,
        // FIX: Truyền download settings từ user preferences
        autoDownload: autoDownload,
        // Truyền cả 2 fields riêng — PromptQueue isVideo tự chọn _videoDownloadResolution.
        downloadResolution: downloadSettings.downloadResolution || null,
        videoDownloadResolution: downloadSettings.videoDownloadResolution || null,
        taskName: downloadSettings.downloadFolder,  // Subfolder từ telegramDownloadFolder setting
      });
      console.log(`[TelegramExecutor] Pipeline hoàn tất: ${result.completed} thành công, ${result.failed} thất bại`);
      console.log('[TelegramExecutor] Pipeline result:', JSON.stringify(result, null, 2));
      // Thu thập thumbnails từ result (PromptQueue trả về resultThumbnails)
      const thumbnails = [];
      if (result.resultThumbnails) {
        for (const [tileId, info] of Object.entries(result.resultThumbnails)) {
          // Chỉ thêm nếu có URL hoặc video_url hợp lệ (tránh 422 validation error)
          if (info.thumbnail || info.video_url) {
            thumbnails.push({
              url: info.thumbnail || '',
              file_name: info.file_name || '',
              type: info.type || 'image',
              video_url: info.video_url || '',  // Video URL nếu có
            });
          }
        }
      }
      console.log('[TelegramExecutor] Thumbnails to send:', JSON.stringify(thumbnails));
      return { thumbnails };
    }

    // 1. Áp dụng settings (Video không hỗ trợ quantity > 1)
    const isVideo = genType === 'Video';
    const quantity = isVideo ? 1 : Math.min(count || 1, 4);
    // Video mode: isFrames từ --frames flag (args.frames), không phải từ có ref hay không
    const isFrames = isVideo && !!args.frames;

    if (typeof applySettings === 'function') {
      // Port 1.1.49: video → clamp ratio về 16:9/9:16 (Flow video không nhận ratio ảnh).
      const aspectRatio = this._mapRatio(isVideo ? this._clampFlowVideoRatio(ratio) : ratio);
      // applySettings(genType, aspectRatio, modelName, isFrames, quantity)
      await applySettings(genType, aspectRatio, model || null, isFrames, quantity);
    }

    // 2. Thực hiện generate (1 lần duy nhất với quantity)
    // Đọc timing settings từ content.js (đồng bộ với Gen tab flow)
    const clearEditorDelay = typeof getClearEditorDelay === 'function' ? getClearEditorDelay() : 480;
    const submitDelay = typeof getSubmitDelay === 'function' ? getSubmitDelay() : 600;
    const afterSubmitDelay = typeof getAfterSubmitDelay === 'function' ? getAfterSubmitDelay() : 960;

    let editor = typeof getEditor === 'function' ? getEditor() : null;
    if (!editor) throw new Error(window.I18n?.t('telegram.editorNotFound') || 'Không tìm thấy editor trên Google Flow');

    // 2a. Xóa ref images cũ (đồng bộ với Gen tab)
    if (typeof removeExistingRefImages === 'function') {
      await removeExistingRefImages();
    }

    // 2b. Clear editor (PHẢI await - async bridge call)
    if (typeof clearEditor === 'function') {
      await clearEditor(editor);
    }
    await new Promise(r => setTimeout(r, clearEditorDelay));

    // 2c. Thêm tất cả ảnh ref nếu có (hỗ trợ nhiều ảnh) — truyền fileName để fallback
    // file_name lookup trong addFileToPrompt hoạt động sau reload Flow (tile_id stale).
    if (refFileIds.length > 0 && typeof addFileToPrompt === 'function') {
      for (const refId of refFileIds) {
        const _fn = window.MediaRegistry?.getFileName?.(refId) || window.GenTab?.fileNameCache?.[refId] || null;
        await addFileToPrompt(refId, _fn);
        await new Promise(r => setTimeout(r, 300)); // Delay giữa các ảnh
      }
    }

    // 2d. Re-query editor sau clear/addFile (React có thể re-render DOM element)
    editor = typeof getEditor === 'function' ? getEditor() : editor;
    if (typeof insertText === 'function') await insertText(editor, prompt);
    await new Promise(r => setTimeout(r, submitDelay));

    // 2e. Verify Slate model có text (đồng bộ với Gen tab)
    const hasPlaceholder = () => {
      const ed = typeof getEditor === 'function' ? getEditor() : null;
      return ed && ed.querySelector && ed.querySelector('[data-slate-placeholder]') !== null;
    };
    if (hasPlaceholder()) {
      console.log('[TelegramExecutor] Slate placeholder vẫn còn, chờ...');
      let waitSlate = 0;
      while (hasPlaceholder() && waitSlate < 2000) {
        await new Promise(r => setTimeout(r, 200));
        waitSlate += 200;
      }
    }

    // 2f. Capture baseline TRƯỚC submit
    const preTileIds = typeof getUniqueTileIds === 'function' ? getUniqueTileIds() : [];
    const preFileNames = typeof getExistingFileNames === 'function' ? getExistingFileNames() : null;

    // 2g. Chờ submit button enabled (đồng bộ với Gen tab)
    let submitBtn = typeof getSubmitButton === 'function' ? getSubmitButton() : null;
    if (!submitBtn) throw new Error(window.I18n?.t('telegram.submitNotFound') || 'Không tìm thấy nút submit');

    let waitSubmit = 0;
    while (submitBtn.disabled && waitSubmit < 15000) {
      await new Promise(r => setTimeout(r, 300));
      waitSubmit += 300;
      submitBtn = (typeof getSubmitButton === 'function' ? getSubmitButton() : null) || submitBtn;
    }

    // 2h. Submit - ưu tiên bridge (đồng bộ với Gen tab)
    if (typeof _slateBridgeCall === 'function') {
      const submitResult = await _slateBridgeCall('submit', {});
      if (!submitResult.success) {
        console.log('[TelegramExecutor] Bridge submit failed, fallback simulateClick');
        if (typeof simulateClick === 'function') {
          simulateClick(submitBtn);
        } else {
          submitBtn.click();
        }
      }
    } else if (typeof simulateClick === 'function') {
      simulateClick(submitBtn);
    } else {
      submitBtn.click();
    }
    await new Promise(r => setTimeout(r, afterSubmitDelay));

    // Chờ kết quả (có thể trả về nhiều tiles nếu quantity > 1)
    const results = [];
    const successTileIds = [];
    if (typeof waitForNewTiles === 'function') {
      const tileResult = await waitForNewTiles(preTileIds, 120000, preFileNames);
      if (tileResult?.thumbnails) {
        for (const [tileId, info] of Object.entries(tileResult.thumbnails)) {
          // Chỉ thêm nếu có URL hoặc video_url hợp lệ (tránh 422 validation error)
          if (info.thumbnail || info.video_url) {
            results.push({
              url: info.thumbnail || '',
              file_name: info.file_name || '',
              type: info.type || 'image',
              video_url: info.video_url || '',  // Video URL nếu có
            });
            successTileIds.push({ tileId, info });
          }
        }
      }
    }

    // Legacy path: Auto-download nếu settings bật (đồng bộ với pipeline path)
    if (successTileIds.length > 0) {
      const downloadSettings = await this._getDownloadSettings();
      const canAutoDownload = window.featureGate ? window.featureGate.canUse('auto_download') : true;
      // args.autoDownload từ Telegram menu override default (nếu được set)
      const autoDownloadOverride = args.autoDownload;
      const shouldAutoDownload = autoDownloadOverride !== undefined
        ? (autoDownloadOverride === true || autoDownloadOverride === 'true') && canAutoDownload
        : downloadSettings.autoDownload && canAutoDownload;

      if (shouldAutoDownload) {
        console.log(`[TelegramExecutor] Legacy path: Auto-downloading ${successTileIds.length} files...`);
        const downloadResolution = isVideo
          ? (downloadSettings.videoDownloadResolution || '720p')
          : (downloadSettings.downloadResolution || '1k');
        const downloadFolder = downloadSettings.downloadFolder || 'seosonaflow_bot';

        for (const { tileId, info } of successTileIds) {
          try {
            if (typeof downloadTileMedia === 'function') {
              // Content script context
              await downloadTileMedia(tileId, prompt, downloadFolder, info.file_name || null, downloadResolution, null);
            } else if (window.MessageBridge?.downloadTileMedia) {
              // SidePanel context
              await window.MessageBridge.downloadTileMedia(tileId, prompt, downloadFolder, info.file_name || null, downloadResolution, null);
            }
            await new Promise(r => setTimeout(r, 200)); // Delay giữa các downloads
          } catch (dlErr) {
            console.warn('[TelegramExecutor] Download failed:', tileId, dlErr.message);
          }
        }
        console.log('[TelegramExecutor] Auto-download completed');
      }
    }

    return { thumbnails: results };
  }

  /**
   * Tạo ảnh từ prompt - ChatGPT provider
   * @param {Object} args - { prompt, ratio, count, ref_images_base64 }
   */
  static async _executeChatGPTGenerate(args) {
    console.log('[TelegramExecutor] _executeChatGPTGenerate (ChatGPT provider)');
    const { prompt, ratio, ref_images_base64, genType } = args;

    // Port 1.1.49: ChatGPT không hỗ trợ tạo video → fail sớm rõ ràng thay vì submit im lặng.
    if (genType === 'Video') {
      throw new Error(window.I18n?.t('telegram.chatgptNoVideo') || 'ChatGPT không hỗ trợ tạo video. Vui lòng dùng Flow hoặc Grok.');
    }

    // Kiểm tra ChatGPTSession có sẵn không
    if (!window.ChatGPTSession) {
      throw new Error('ChatGPT session không khả dụng. Vui lòng mở tab ChatGPT và đăng nhập.');
    }

    // Đảm bảo tab ChatGPT sẵn sàng
    const readyResult = await window.ChatGPTSession.ensureReady({ createIfMissing: true, activate: true });
    if (!readyResult.ready) {
      const errorMsg = readyResult.error === 'NOT_LOGGED_IN'
        ? 'Vui lòng đăng nhập vào ChatGPT trước khi sử dụng.'
        : `ChatGPT không sẵn sàng: ${readyResult.error}`;
      throw new Error(errorMsg);
    }

    // Lấy settings cho ChatGPT
    const providerSettings = await this._getProviderSettings('chatgpt');
    const chatgptRatio = this._mapRatioToChatGPT(ratio || providerSettings.ratio);

    // NOTE: KHÔNG gọi activateImageMode/setRatio ở đây vì:
    // 1. Content script sẽ tạo New Chat (reset state)
    // 2. Content script tự activate image mode SAU new chat
    // Luôn pass imageMode: true để content script xử lý

    // Chuẩn bị ref images
    let images = [];
    if (ref_images_base64 && Array.isArray(ref_images_base64) && ref_images_base64.length > 0) {
      images = ref_images_base64.slice(0, 4).map((base64, i) => ({
        base64,
        name: `telegram_ref_${i}.jpg`,
        type: 'image/jpeg',
      }));
    }

    // Submit qua MessageBridge
    if (!window.MessageBridge || typeof window.MessageBridge.chatGPTSubmitAndWait !== 'function') {
      throw new Error('MessageBridge.chatGPTSubmitAndWait không khả dụng.');
    }

    // Lấy fallback prefix từ settings (content script dùng nếu activate fail)
    const settings = await window.storageSettings?.getSettings();
    const fallbackPrefix = settings?.chatgptFallbackPrefix || 'Generate an image of: ';

    console.log('[TelegramExecutor] Submitting to ChatGPT...');
    const result = await window.MessageBridge.chatGPTSubmitAndWait({
      text: prompt,
      images,
      settings: {
        imageMode: true, // Luôn true - content script sẽ activate sau new chat
        ratio: chatgptRatio,
        fallbackPrefix, // Luôn pass - content script dùng nếu cần
      },
      // Phase L: Centralized timeout
      timeout: window.SystemConfig?.getTimeout('chatgpt_timeout_ms') || 120000,
      tabId: readyResult.tabId,
      taskName: 'Telegram ChatGPT',
    });

    if (!result || !result.success) {
      // BUG FIX: Track chatgpt_fail (TelegramExecutor bypass ChatGPTAdapter)
      try {
        if (window.EditorExecutor?._incrementDailyStat) {
          window.EditorExecutor._incrementDailyStat('chatgpt_fail');
        }
      } catch (_) { /* noop */ }
      throw new Error(result?.message || result?.error || 'ChatGPT không trả về kết quả.');
    }

    // Convert image URLs sang base64 để gửi về Telegram
    const thumbnails = [];
    if (result.imageUrls && result.imageUrls.length > 0) {
      for (const url of result.imageUrls) {
        try {
          // Fetch image từ ChatGPT (cần credentials vì là internal URL)
          const base64 = await this._fetchImageAsBase64(url, readyResult.tabId);
          if (base64) {
            thumbnails.push({
              url: url,
              type: 'image',
              file_name: `chatgpt_${Date.now()}.png`,
              base64: base64,
            });
          }
        } catch (err) {
          console.warn('[TelegramExecutor] Failed to fetch ChatGPT image:', err.message);
        }
      }
    }

    // BUG FIX: Track chatgpt_prompt_total (was missing - TelegramExecutor bypass ChatGPTAdapter)
    try {
      if (window.EditorExecutor?._incrementDailyStat) {
        window.EditorExecutor._incrementDailyStat('chatgpt_prompt_total');
      }
    } catch (_) { /* noop */ }

    console.log(`[TelegramExecutor] ChatGPT generate hoàn tất: ${thumbnails.length} ảnh`);
    await this._autoDownloadThumbnails(thumbnails, args); // Port 1.1.49: auto-download nếu bật
    return { thumbnails };
  }

  /**
   * Tạo ảnh/video từ prompt - Grok provider
   * @param {Object} args - { prompt, ratio, genType, ref_images_base64, duration, resolution, imageQuality }
   */
  static async _executeGrokGenerate(args) {
    console.log('[TelegramExecutor] _executeGrokGenerate (Grok provider)');
    const { prompt, ratio, genType = 'Image', ref_images_base64, duration, resolution, imageQuality } = args;

    // Kiểm tra GrokSession có sẵn không
    if (!window.GrokSession) {
      throw new Error('Grok session không khả dụng. Vui lòng mở tab Grok và đăng nhập.');
    }

    // Đảm bảo tab Grok sẵn sàng
    const readyResult = await window.GrokSession.ensureReady({ createIfMissing: true, activate: true });
    if (!readyResult.ready) {
      const errorMsg = readyResult.error === 'NOT_LOGGED_IN'
        ? 'Vui lòng đăng nhập vào Grok trước khi sử dụng.'
        : `Grok không sẵn sàng: ${readyResult.error}`;
      throw new Error(errorMsg);
    }

    // Lấy settings cho Grok - args override providerSettings (từ Telegram menu)
    const providerSettings = await this._getProviderSettings('grok');
    const isVideo = genType === 'Video';
    const mode = isVideo ? 'video' : (providerSettings.mode || 'image');
    const grokRatio = this._mapRatioToGrok(ratio || providerSettings.ratio);
    // Use args values if provided, fallback to providerSettings
    const grokDuration = duration || providerSettings.duration || '6s';
    const grokResolution = resolution || providerSettings.resolution || '720p';
    const grokImageQuality = imageQuality || providerSettings.imageQuality || 'speed';

    // setMode = CONNECTIVITY PROBE (ensureReady cache có thể stale → script chết sau navigate).
    // Mode idempotent (content script áp lại đúng sau ref-clear).
    const modeResult = await window.GrokSession.setMode(mode);
    if (!modeResult.success) {
      console.warn('[TelegramExecutor] Grok setMode probe failed:', modeResult.error);
    }

    // KHÔNG áp ratio/duration/resolution/imageQuality ở đây — tránh double-application + sai state
    // (áp TRƯỚC ref-clear → ratio button ẩn → fail). Settings được pass xuống grokSubmitAndWait
    // bên dưới → content script `applyGrokSettings` áp 1 lần duy nhất SAU removeExistingRefImages
    // (đúng thứ tự). Đồng bộ với GrokAdapter.submit.

    // Chuẩn bị ref images
    let images = [];
    if (ref_images_base64 && Array.isArray(ref_images_base64) && ref_images_base64.length > 0) {
      images = ref_images_base64.slice(0, 4).map((base64, i) => ({
        base64,
        name: `telegram_ref_${i}.jpg`,
        type: 'image/jpeg',
      }));
    }

    // Submit qua MessageBridge
    if (!window.MessageBridge || typeof window.MessageBridge.grokSubmitAndWait !== 'function') {
      throw new Error('MessageBridge.grokSubmitAndWait không khả dụng.');
    }

    console.log('[TelegramExecutor] Submitting to Grok, mode:', mode, 'duration:', grokDuration, 'resolution:', grokResolution, 'imageQuality:', grokImageQuality);
    const result = await window.MessageBridge.grokSubmitAndWait({
      text: prompt,
      images,
      settings: {
        mode,
        ratio: grokRatio,
        duration: grokDuration,
        resolution: grokResolution,
        imageQuality: grokImageQuality,
      },
      // Phase L: Centralized timeout — video needs longer
      timeout: mode === 'video'
        ? (window.SystemConfig?.getTimeout('video_timeout_ms') || 600000)
        : (window.SystemConfig?.getTimeout('image_timeout_ms') || 300000),
      tabId: readyResult.tabId,
      taskName: 'Telegram Grok',
    });

    if (!result || !result.success) {
      // BUG FIX: Track grok_fail (TelegramExecutor bypass GrokAdapter)
      try {
        if (window.EditorExecutor?._incrementDailyStat) {
          window.EditorExecutor._incrementDailyStat('grok_fail');
        }
      } catch (_) { /* noop */ }
      throw new Error(result?.message || result?.error || 'Grok không trả về kết quả.');
    }

    // Convert media URLs sang base64 để gửi về Telegram
    const thumbnails = [];
    const mediaUrls = result.mediaUrls || result.imageUrls || [];
    const mediaType = result.mediaType || (mode === 'video' ? 'video' : 'image');

    for (const url of mediaUrls) {
      try {
        // Tier 1: fetchedMedia từ content script (Option C 2026-06-03 — pre-fetched in-page,
        // tránh race redirect /saved). Cookie session 100% valid trong context handler.
        let base64Data = null;
        const fetched = result.fetchedMedia?.find(f => f.url === url);
        if (fetched?.base64) {
          base64Data = fetched.base64;
        }
        // Tier 2: fallback grokFetchImage (legacy, race với redirect)
        if (!base64Data && window.MessageBridge?.grokFetchImage) {
          const fetchResult = await window.MessageBridge.grokFetchImage(url, readyResult.tabId);
          if (fetchResult?.success && fetchResult?.base64) {
            base64Data = fetchResult.base64;
          }
        }
        // Tier 3: direct fetch trong sidebar context (no cookie session)
        if (!base64Data) {
          base64Data = await this._fetchImageAsBase64(url, readyResult.tabId);
        }
        if (base64Data) {
          thumbnails.push({
            url: url,
            type: mediaType,
            file_name: `grok_${Date.now()}.${mediaType === 'video' ? 'mp4' : 'png'}`,
            base64: base64Data,
            video_url: mediaType === 'video' ? url : '',
          });
        }
      } catch (err) {
        console.warn('[TelegramExecutor] Failed to fetch Grok media:', err.message);
      }
    }

    // BUG FIX: Track grok_prompt_total (was missing - TelegramExecutor bypass GrokAdapter)
    try {
      if (window.EditorExecutor?._incrementDailyStat) {
        window.EditorExecutor._incrementDailyStat('grok_prompt_total');
      }
    } catch (_) { /* noop */ }

    console.log(`[TelegramExecutor] Grok generate hoàn tất: ${thumbnails.length} ${mediaType}(s)`);
    await this._autoDownloadThumbnails(thumbnails, args); // Port 1.1.49: auto-download nếu bật
    return { thumbnails };
  }

  /**
   * Fetch image URL và convert sang base64
   * @param {string} url - Image URL
   * @param {number} tabId - Tab ID để fetch với credentials
   * @returns {Promise<string|null>} Base64 string hoặc null nếu fail
   */
  static async _fetchImageAsBase64(url, tabId) {
    try {
      // Thử fetch qua MessageBridge nếu có (có thể handle CORS tốt hơn)
      if (window.MessageBridge?.chatGPTFetchImage && tabId) {
        const result = await window.MessageBridge.chatGPTFetchImage(url, tabId);
        if (result?.success && result?.base64) {
          return result.base64;
        }
      }

      // Fallback: fetch trực tiếp KHÔNG credentials (tránh CORS block khi URL Flow
      // redirect sang flow-content.google trả Allow-Origin: '*')
      const response = await fetch(url);
      if (!response.ok) {
        console.warn('[TelegramExecutor] Fetch failed:', url, response.status);
        return null;
      }

      const blob = await response.blob();
      return await this._blobToBase64(blob);
    } catch (err) {
      console.warn('[TelegramExecutor] _fetchImageAsBase64 error:', err.message);
      return null;
    }
  }

  /**
   * Reverse ratio UI map: { ui_name: value } → { value: ui_name }
   * @param {object} uiMap - { story: '9:16', widescreen: '16:9', ... }
   * @returns {object} - { '9:16': 'story', '16:9': 'widescreen', ... }
   */
  static _reverseRatioMap(uiMap) {
    if (!uiMap || typeof uiMap !== 'object') return {};
    const reversed = {};
    for (const [uiName, value] of Object.entries(uiMap)) {
      reversed[value] = uiName;
    }
    return reversed;
  }

  /**
   * Map ratio từ Telegram format sang ChatGPT format
   * Server-First: dùng PCM.getRatioUiMapSync('chatgpt') với fallback
   */
  static _mapRatioToChatGPT(ratio) {
    if (!ratio) return 'widescreen';
    const r = String(ratio).toLowerCase().trim();

    // Tier 1-2: PCM server data / cache
    const uiMap = window.ProviderConfigManager?.getRatioUiMapSync?.('chatgpt') || {};
    const reversed = this._reverseRatioMap(uiMap);

    // Tier 3: Inline fallback
    const fallback = { '16:9': 'widescreen', '9:16': 'story', '1:1': 'square', '4:3': 'landscape', '3:4': 'portrait' };
    const valueToUi = { ...fallback, ...reversed };

    // VN aliases (user input convenience)
    const vnAliases = {
      'ngang': 'widescreen', 'dọc': 'story', 'doc': 'story', 'vuông': 'square', 'vuong': 'square',
    };

    // Check VN aliases first, then valueToUi map, then pass-through ui_name
    if (vnAliases[r]) return vnAliases[r];
    if (valueToUi[r]) return valueToUi[r];
    if (uiMap[r]) return r; // Already a valid ui_name
    return 'widescreen';
  }

  /**
   * Map ratio từ Telegram format sang Grok format
   * Server-First: dùng PCM.getRatioUiMapSync('grok') với fallback
   */
  static _mapRatioToGrok(ratio) {
    if (!ratio) return 'widescreen';
    const r = String(ratio).toLowerCase().trim();

    // Tier 1-2: PCM server data / cache
    const uiMap = window.ProviderConfigManager?.getRatioUiMapSync?.('grok') || {};
    const reversed = this._reverseRatioMap(uiMap);

    // Tier 3: Inline fallback (Grok uses 2:3/3:2 for portrait/landscape)
    const fallback = { '16:9': 'widescreen', '9:16': 'story', '1:1': 'square', '3:2': 'landscape', '2:3': 'portrait', '4:3': 'landscape', '3:4': 'portrait' };
    const valueToUi = { ...fallback, ...reversed };

    // VN aliases (user input convenience)
    const vnAliases = {
      'ngang': 'widescreen', 'dọc': 'story', 'doc': 'story', 'vuông': 'square', 'vuong': 'square',
    };

    // Check VN aliases first, then valueToUi map, then pass-through ui_name
    if (vnAliases[r]) return vnAliases[r];
    if (valueToUi[r]) return valueToUi[r];
    if (uiMap[r]) return r; // Already a valid ui_name
    return 'widescreen';
  }

  /**
   * Tạo video từ prompt
   * Video hỗ trợ ratio: 16:9, 9:16
   */
  static async _executeVideo(args) {
    // Delegate sang _executeGenerate với genType: 'Video'
    // Video luôn count=1 (Flow không hỗ trợ batch video)
    return await this._executeGenerate({
      ...args,
      count: 1,
      genType: 'Video'
    });
  }

  /**
   * Chạy workflow theo tên
   */
  static async _executeWorkflow(args) {
    // Backend gửi workflow name qua args.prompt (parseGenerateArgs), fallback args.workflow_name
    const workflow_name = args.workflow_name || args.prompt;
    if (!workflow_name) throw new Error(window.I18n?.t('telegram.missingWorkflowName') || 'Thiếu tên workflow');

    // Tìm workflow theo wf_name (không phải name)
    const workflows = await window.storageManager?.getWorkflows() || [];
    const wf = workflows.find(w =>
      w.wf_name?.toLowerCase().includes(workflow_name.toLowerCase())
    );
    if (!wf) throw new Error(window.I18n?.t('telegram.workflowNotFound', { name: workflow_name }) || `Không tìm thấy workflow: ${workflow_name}`);

    // Kiểm tra WorkflowExecutor có sẵn không
    if (!window.workflowExecutor) {
      throw new Error('WorkflowExecutor chưa được khởi tạo');
    }

    // Thu thập thumbnails từ node:completed events
    const collectedThumbnails = [];
    const nodeCompletedHandler = (data) => {
      if (data.result?.thumbnails) {
        for (const [tileId, info] of Object.entries(data.result.thumbnails)) {
          if (info.thumbnail || info.thumbnailUrl) {
            collectedThumbnails.push({
              url: info.thumbnail || info.thumbnailUrl,
              type: info.type || 'image',
              file_name: info.file_name || '',
              video_url: info.video_url || ''
            });
          }
        }
      }
    };

    // Đăng ký listener
    window.eventBus?.on('node:completed', nodeCompletedHandler);

    try {
      // Chạy workflow
      console.log(`[TelegramExecutor] Chạy workflow: ${wf.wf_name} (${wf.wf_id})`);
      const success = await window.workflowExecutor.execute(wf.wf_id);

      if (!success) {
        throw new Error('Workflow thực thi không thành công');
      }

      console.log(`[TelegramExecutor] Workflow hoàn thành, thu thập được ${collectedThumbnails.length} thumbnails`);

      // Nếu không collect được thumbnails từ events (workflow đã chạy trước đó, nodes bị skip)
      // → Thu thập từ cached result_thumbnails của các nodes
      if (collectedThumbnails.length === 0) {
        console.log('[TelegramExecutor] Không có thumbnails từ events, thu thập từ cached results...');
        const fullWorkflow = await window.storageManager?.getWorkflow(wf.wf_id);
        if (fullWorkflow?.nodes) {
          for (const node of fullWorkflow.nodes) {
            // Chỉ lấy từ generate nodes (nodes tạo output)
            if (!['generate'].includes(node.node_type)) continue;
            if (!node.result_thumbnails) continue;

            for (const [tileId, info] of Object.entries(node.result_thumbnails)) {
              const thumbUrl = typeof info === 'string' ? info : (info.thumbnail || info.thumbnailUrl || info);
              if (thumbUrl && typeof thumbUrl === 'string' && thumbUrl.startsWith('http')) {
                collectedThumbnails.push({
                  url: thumbUrl,
                  type: info?.type || 'image',
                  file_name: node.result_file_names?.[tileId] || info?.file_name || '',
                  video_url: info?.video_url || ''
                });
              }
            }
          }
          console.log(`[TelegramExecutor] Thu thập được ${collectedThumbnails.length} thumbnails từ cached results`);
        }
      }

      // Nếu vẫn không có thumbnails → thông báo workflow đã hoàn thành nhưng không có ảnh
      if (collectedThumbnails.length === 0) {
        throw new Error('Workflow đã hoàn thành nhưng không có ảnh kết quả. Vui lòng reset workflow trong extension và chạy lại.');
      }

      return { thumbnails: collectedThumbnails };
    } finally {
      // Gỡ listener
      window.eventBus?.off('node:completed', nodeCompletedHandler);
    }
  }

  /**
   * Dừng lệnh đang chạy
   */
  static async _executeStop() {
    // Cancel execution token nếu đang active
    if (window.ExecutionGate && this._currentExecutionToken) {
      ExecutionGate.cancel(this._currentExecutionToken);
      this._currentExecutionToken = null;
    }
    if (window.ExecutionLock?.stopCurrent) {
      window.ExecutionLock.stopCurrent();
    }
    return { thumbnails: [] };
  }

  /**
   * Xử lý hủy lệnh từ Telegram
   */
  static _handleCancel(data) {
    const { queue_id } = data;
    if (this._currentQueueId === queue_id) {
      this._executeStop();
    }
  }

  /**
   * Xử lý dừng lệnh từ Telegram (từ /stop command)
   */
  static _handleStop(data) {
    console.log('[TelegramExecutor] Nhận lệnh /stop từ Telegram', data);
    const { queue_id } = data;
    // Dừng nếu queue_id khớp hoặc đang có lệnh chạy
    if (this._currentQueueId === queue_id || this._isExecuting) {
      this._executeStop();
      if (typeof window.sidebarLog === 'function') {
        window.sidebarLog('[Telegram] Đã dừng lệnh theo yêu cầu', 'info');
      }
    }
  }

  /**
   * Upload ảnh ref từ base64 (backend đã download sẵn từ Telegram)
   */
  static async _uploadRefFromBase64(base64Data) {
    if (!base64Data) return null;

    if (!window.MessageBridge?.uploadFilesToFlow) {
      console.warn('[TelegramExecutor] MessageBridge chưa sẵn sàng');
      return null;
    }

    // Ensure Flow tab active trước khi upload
    if (window.ImmediateUploader) {
      try {
        const activation = await window.ImmediateUploader._ensureFlowTabReady();
        if (!activation?.isOpen) {
          console.warn('[TelegramExecutor] Flow tab không mở, không thể upload ref image');
          return null;
        }
      } catch (e) {
        console.warn('[TelegramExecutor] Không thể kiểm tra Flow tab:', e.message);
      }
    }

    try {
      const result = await window.MessageBridge.uploadFilesToFlow([{
        name: 'telegram_ref.jpg',
        type: 'image/jpeg',
        base64: base64Data,
      }]);

      const tileId = result?.orderedTileIds?.[0] || result?.tileIds?.[0] || null;
      if (tileId) {
        console.log('[TelegramExecutor] Upload ref image (base64) thành công, tileId:', tileId);
      }
      return tileId;
    } catch (err) {
      console.error('[TelegramExecutor] Upload ref image (base64) lỗi:', err.message);
      return null;
    }
  }

  /**
   * Upload ảnh ref từ URL (qua background.js để bypass CORS → MessageBridge upload to Flow)
   */
  static async _uploadRefFromUrl(imageUrl) {
    // 1. Tải ảnh qua background.js (bypass CORS)
    const fetchResp = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        // L15: expectImage:true so an HTML error page (status 200) is not accepted as an image.
        { action: 'fetchBlob', url: imageUrl, expectImage: true },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(resp);
        }
      );
    });

    if (!fetchResp?.success || !fetchResp.base64) {
      console.warn('[TelegramExecutor] Không tải được ảnh ref từ Telegram');
      return null;
    }

    // 2. Upload to Flow qua MessageBridge
    if (!window.MessageBridge?.uploadFilesToFlow) {
      console.warn('[TelegramExecutor] MessageBridge chưa sẵn sàng');
      return null;
    }

    // Ensure Flow tab active trước khi upload (Chrome throttle inactive tabs)
    let telegramFlowActivation = null;
    if (window.ImmediateUploader) {
      try {
        telegramFlowActivation = await window.ImmediateUploader._ensureFlowTabReady();
        if (!telegramFlowActivation?.isOpen) {
          console.warn('[TelegramExecutor] Flow tab không mở, không thể upload ref image');
          return null;
        }
      } catch (e) {
        console.warn('[TelegramExecutor] Không thể kiểm tra Flow tab:', e.message);
      }
    }

    try {
      const result = await window.MessageBridge.uploadFilesToFlow([{
        name: 'telegram_ref.jpg',
        type: 'image/jpeg',
        base64: fetchResp.base64,
      }]);

      // Lấy tile ID đầu tiên từ kết quả upload
      const tileId = result?.orderedTileIds?.[0] || result?.tileIds?.[0] || null;
      if (tileId) {
        console.log('[TelegramExecutor] Upload ref image thành công, tileId:', tileId);
      } else {
        console.warn('[TelegramExecutor] Upload xong nhưng không nhận được tileId');
      }
      return tileId;
    } catch (err) {
      console.error('[TelegramExecutor] Upload ref image lỗi:', err.message);
      return null;
    }
    // Không restore tab — giữ Flow tab active
  }

  /**
   * Map command sang ExecutionGate action
   */
  static _mapCommandToAction(command, provider = 'flow') {
    const cmd = command?.replace('/', '') || '';
    // image + video đều là generation — action theo provider để trừ đúng quota:
    // grok→grok_run, chatgpt→chatgpt_run, flow→generate (gen_run_max).
    if (cmd === 'image' || cmd === 'video') {
      return provider === 'grok' ? 'grok_run'
        : provider === 'chatgpt' ? 'chatgpt_run'
        : 'generate';
    }
    if (cmd === 'workflow') return 'workflow_run';
    return null;
  }

  /**
   * Map ratio text từ Telegram sang giá trị Flow
   * Flow API dùng tiếng Việt: 'Dọc', 'Ngang', 'Vuông'
   */
  // Port 1.1.49: Flow VIDEO chỉ chấp nhận 16:9 / 9:16. Ratio ảnh (4:3/1:1/3:4) truyền vào job video
  // → ratio invalid. Clamp: portrait → 9:16, còn lại → 16:9. Chỉ dùng cho video path.
  static _clampFlowVideoRatio(ratio) {
    if (!ratio) return '16:9';
    const r = String(ratio).toLowerCase().trim();
    const portrait = ['9:16', 'doc', 'dọc', 'portrait', 'tall', 'p', 'story'];
    return portrait.includes(r) ? '9:16' : '16:9';
  }

  static _mapRatio(ratio) {
    if (!ratio) return null;
    const r = ratio.toLowerCase().trim();
    const map = {
      // Numeric formats (5 ratios: Image hỗ trợ tất cả, Video chỉ 16:9 và 9:16)
      '16:9': 'Ngang',
      '4:3': '4:3',       // Image only, no Vietnamese name
      '1:1': 'Vuông',
      '3:4': '3:4',       // Image only, no Vietnamese name
      '9:16': 'Dọc',
      // Vietnamese
      'ngang': 'Ngang',
      'doc': 'Dọc',
      'dọc': 'Dọc',
      'vuong': 'Vuông',
      'vuông': 'Vuông',
      // English
      'landscape': 'Ngang',     // 16:9
      'portrait': 'Dọc',        // 9:16
      'square': 'Vuông',        // 1:1
      'wide': 'Ngang',          // 16:9
      'tall': 'Dọc',            // 9:16
      // Short forms
      'l': 'Ngang',             // landscape
      'p': 'Dọc',               // portrait
      's': 'Vuông',             // square
      'w': 'Ngang',             // wide
      't': 'Dọc',               // tall
    };
    return map[r] || null;
  }

  /**
   * Đọc download settings từ chrome.storage (af_settings)
   * Telegram có settings riêng: telegramAutoDownload, telegramDownloadFolder,
   * telegramDownloadResolution, telegramVideoDownloadResolution
   *
   * @returns {Promise<{autoDownload: boolean, downloadResolution: string, videoDownloadResolution: string, downloadFolder: string}>}
   */
  // Port 1.1.49: auto-download cho kết quả Grok/ChatGPT (URL/base64, không qua Flow downloadTileMedia
  // nên autoDownload bị bỏ qua). base64 → blob → chromeDownload. Respect setting + override args.autoDownload.
  static async _autoDownloadThumbnails(thumbnails, args) {
    try {
      if (!Array.isArray(thumbnails) || thumbnails.length === 0) return;
      const downloadSettings = await this._getDownloadSettings();
      const canAutoDownload = window.featureGate ? window.featureGate.canUse('auto_download') : true;
      const override = args?.autoDownload;
      const shouldAutoDownload = override !== undefined
        ? (override === true || override === 'true') && canAutoDownload
        : downloadSettings.autoDownload && canAutoDownload;
      if (!shouldAutoDownload) return;
      const folder = downloadSettings.downloadFolder || 'seosonaflow_bot';
      for (const thumb of thumbnails) {
        if (!thumb?.base64) continue;
        const mime = thumb.type === 'video' ? 'video/mp4' : 'image/png';
        const blob = await (await fetch(`data:${mime};base64,${thumb.base64}`)).blob();
        const blobUrl = URL.createObjectURL(blob);
        const filename = `${folder}/${thumb.file_name}`;
        const _dlUrl = await (globalThis.scrubbedDownloadUrl?.(blobUrl) ?? blobUrl);
        await new Promise(res => chrome.runtime.sendMessage({ action: 'chromeDownload', url: _dlUrl, filename }, () => { void chrome.runtime.lastError; res(); }));
        setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch (_) { globalThis.SEOSONA_swallow?.('TelegramExecutor#nodeCompletedHandler', _); } }, 60000);
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (e) { console.warn('[TelegramExecutor] _autoDownloadThumbnails error:', e.message); }
  }

  static async _getDownloadSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get(['af_settings'], res => {
        const settings = res.af_settings || {};
        // Telegram dùng settings riêng
        const telegramAutoDownload = settings.telegramAutoDownload;
        resolve({
          // telegramAutoDownload có thể là undefined (dùng default true), true, false, '1', '0'
          autoDownload: telegramAutoDownload === undefined ? true :
            (telegramAutoDownload === true || telegramAutoDownload === '1' || telegramAutoDownload === 1),
          // Resolution riêng cho Telegram
          downloadResolution: settings.telegramDownloadResolution || '1k',
          videoDownloadResolution: settings.telegramVideoDownloadResolution || '720p',
          // Folder riêng cho Telegram
          downloadFolder: settings.telegramDownloadFolder || 'seosonaflow_bot',
        });
      });
    });
  }

  /**
   * Gửi kết quả về backend
   * Thumbnails sẽ được convert sang base64 trước khi gửi (vì URL internal cần login Flow)
   */
  static async _sendResult(queueId, status, thumbnails, errorMessage = null) {
    console.log('[TelegramExecutor] _sendResult:', { queueId, status, thumbnails, errorMessage });
    try {
      // Convert URLs sang base64 (vì backend không thể access URL internal của Flow)
      let processedThumbnails = [];
      if (thumbnails && thumbnails.length > 0) {
        processedThumbnails = await this._convertThumbnailsToBase64(thumbnails);
      }

      const response = await ApiClient.request('POST', 'telegram/result', {
        queue_id: queueId,
        status,
        thumbnails: processedThumbnails,
        error_message: errorMessage,
      });
      console.log('[TelegramExecutor] _sendResult response:', response);
    } catch (err) {
      console.error('[TelegramExecutor] Lỗi gửi kết quả:', err.message);
    }
  }

  /**
   * Convert thumbnail URLs sang base64 (cho cả image và video)
   * Extension có session Flow nên có thể download được - backend thì không
   */
  static async _convertThumbnailsToBase64(thumbnails) {
    const results = [];
    for (const thumb of thumbnails) {
      try {
        const mediaType = thumb.type || 'image';

        // VIDEO: Download video và convert sang base64
        // Backend không có Google Flow session nên không download được URL trực tiếp
        if (mediaType === 'video' && thumb.video_url) {
          console.log('[TelegramExecutor] Downloading video for Telegram:', thumb.video_url);
          try {
            // KHÔNG credentials: 'include' — Flow CDN trả Allow-Origin: '*' → CORS block
            // M7: timeout so a hung CDN doesn't wedge the executor.
            const response = await this._fetchWithTimeout(thumb.video_url, {}, 30000);
            if (!response.ok) {
              console.warn('[TelegramExecutor] Failed to fetch video:', thumb.video_url, response.status);
              continue;
            }

            const blob = await response.blob();
            console.log('[TelegramExecutor] Video downloaded, size:', blob.size, 'type:', blob.type);

            // Video quá lớn (>5MB) thì skip gửi base64, thông báo user check trên Flow
            // Base64 encoding tăng ~33% size, JSON overhead thêm nữa -> dễ vượt API limit
            if (blob.size > 5 * 1024 * 1024) {
              console.warn('[TelegramExecutor] Video too large to send via API (>5MB):', blob.size);
              // Thêm thông báo text thay vì skip hoàn toàn
              results.push({
                type: 'text_only',
                message: `Video đã tạo thành công (${(blob.size / 1024 / 1024).toFixed(1)}MB) nhưng quá lớn để gửi qua Telegram. Vui lòng kiểm tra trên Google Flow.`,
              });
              continue;
            }

            const base64 = await this._blobToBase64(blob);

            results.push({
              type: 'video',
              base64: base64,
              file_name: thumb.file_name || '',
              mime_type: blob.type || 'video/mp4',
            });
          } catch (videoErr) {
            console.error('[TelegramExecutor] Error downloading video:', videoErr.message);
          }
          continue;
        }

        // IMAGE: Convert sang base64
        if (!thumb.url) continue;

        // Fetch image từ Flow (signed URL đã có Expires+Signature, không cần cookies;
        // credentials: 'include' sẽ bị CORS block do CDN trả Allow-Origin: '*')
        // M7: timeout so a hung CDN doesn't wedge the executor.
        const response = await this._fetchWithTimeout(thumb.url, {}, 30000);
        if (!response.ok) {
          console.warn('[TelegramExecutor] Failed to fetch thumbnail:', thumb.url, response.status);
          continue;
        }

        const blob = await response.blob();
        const base64 = await this._blobToBase64(blob);

        results.push({
          type: 'image',
          base64: base64,
          file_name: thumb.file_name || '',
          mime_type: blob.type || 'image/png',
        });
      } catch (err) {
        console.warn('[TelegramExecutor] Error converting thumbnail:', thumb.url, err.message);
      }
    }
    return results;
  }

  /**
   * M7: fetch with an AbortController timeout so a hung CDN cannot wedge the
   * executor in its critical section (finally never runs → _isExecuting stuck).
   */
  static async _fetchWithTimeout(url, opts = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Convert Blob sang base64 string (không có prefix data:...)
   */
  static _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // Loại bỏ prefix "data:image/png;base64,"
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

window.TelegramExecutor = TelegramExecutor;
