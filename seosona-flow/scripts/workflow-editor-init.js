// K.9 (2026-05-29): Define `window.showNotification` cho popup workflow editor.
// `app.js` (define showNotification gốc) KHÔNG load trong popup → tất cả
// `window.showNotification?.()` calls trong WorkflowEditor no-op → user không
// thấy toast lỗi. Inline define ở đây (KHÔNG add app.js để tránh side effect
// sidebar tab init). Pattern: top center, hover-pause, auto-dismiss.
(function () {
  if (typeof window.showNotification === 'function') return; // sidebar context đã có
  const _icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
  };
  let _timer = null;
  // 2026-05-31: dedup state — skip toast giống hệt (message+type) trong 3s.
  // Tránh spam khi workflow nhiều nodes cùng trigger 1 type warning (vd 5 prompt nodes
  // cùng "không có quyền AI Agent" → 5 toasts liên tục).
  let _lastNotif = { key: '', timestamp: 0 };
  // Error mặc định 5000ms (longer) — user cần đọc kỹ; success/info 2500ms như cũ.
  window.showNotification = function (message, type = 'success', duration) {
    const ms = typeof duration === 'number' ? duration : (type === 'error' ? 5000 : 2500);
    const dedupKey = `${type}::${message}`;
    const now = Date.now();
    if (_lastNotif.key === dedupKey && (now - _lastNotif.timestamp) < 3000) {
      return; // Skip duplicate within 3s window
    }
    _lastNotif = { key: dedupKey, timestamp: now };
    const existing = document.querySelector('.seosonaflow-notification');
    if (existing) {
      clearTimeout(_timer);
      existing.remove();
    }
    const el = document.createElement('div');
    el.className = `seosonaflow-notification ${type}`;
    el.innerHTML = `${_icons[type] || _icons.info}<span>${message}</span>`;
    // Override pointer-events:none từ sidebar.css để mouseenter hover-pause work.
    el.style.pointerEvents = 'auto';
    document.body.appendChild(el);

    const RESUME_DURATION = 1500;
    const startDismiss = (delay) => {
      _timer = setTimeout(() => {
        el.classList.add('seosonaflow-notif-out');
        setTimeout(() => el.remove(), 300);
      }, delay);
    };
    startDismiss(ms);
    el.addEventListener('mouseenter', () => {
      if (_timer) { clearTimeout(_timer); _timer = null; }
    });
    el.addEventListener('mouseleave', () => {
      if (!el.classList.contains('seosonaflow-notif-out')) startDismiss(RESUME_DURATION);
    });
  };
})();

// Boot workflow editor in standalone window mode
document.addEventListener('DOMContentLoaded', async () => {
  // Mark body context để CSS scope đúng (vd .imgpicker-modal width khác giữa
  // workflow popup vs sidebar — xem image-picker.css + workflow.css)
  document.body.classList.add('wf-popup');

  // Loading overlay (markup ở workflow-editor.html) — gỡ sau khi editor.open() render diagram.
  // Idempotent: gọi nhiều lần an toàn. Safety timeout đảm bảo không kẹt overlay nếu init throw
  // sớm (mạng chậm/lỗi) → user vẫn thấy canvas/lỗi thật thay vì spinner vĩnh viễn.
  const hideWfLoading = () => {
    clearTimeout(_wfLoadingSafety);
    const el = document.getElementById('wfEditorLoading');
    if (!el || el.classList.contains('wf-editor-loading-out')) return;
    el.classList.add('wf-editor-loading-out');
    setTimeout(() => el.remove(), 320);
  };
  const _wfLoadingSafety = setTimeout(hideWfLoading, 20000);

  // Initialize EventBus
  if (window.EventBus) {
    window.eventBus = new EventBus();
  }

  // Initialize i18n
  if (window.I18n) {
    await window.I18n.init();
    window.I18n.applyTranslations(document.body);
    // Localize loading text sau khi biết locale (default trong HTML là tiếng Việt).
    const _lt = document.getElementById('wfEditorLoadingText');
    if (_lt) _lt.textContent = window.I18n.t('workflow.loadingEditor') || _lt.textContent;
  }

  // Listen for i18n changes from storage (cross-window sync)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.af_locale && window.I18n) {
      window.I18n.setLocale(changes.af_locale.newValue, false);
      window.I18n.applyTranslations(document.body);
    }
  });

  // Wait for StorageSettings to load settings (auto-init runs on script load)
  // Cần cho PromptQueue.isEnabled() hoạt động đúng
  if (window.storageSettings) {
    // Chờ loadAndApply() hoàn tất (init() gọi nó async trong constructor)
    await window.storageSettings.loadAndApply();
    console.log('[WorkflowEditorInit] StorageSettings ready, queueEnabled:', window.storageSettings.getSettings()?.queueEnabled);
  }

  // Background fetch ChatGPT + Grok error patterns (admin-tunable) — không block init
  try { window.ChatGPTConfig?.fetchInBackground?.(); } catch (e) { /* ignore */ }
  try { window.GrokConfig?.fetchInBackground?.(); } catch (e) { /* ignore */ }

  // Initialize AuthManager first (must be before StorageManager to detect mode correctly)
  if (window.authManager) {
    await window.authManager.init();
    console.log('[WorkflowEditorInit] AuthManager ready, logged in:', window.authManager.isLoggedIn());
  }

  // Bug 20+21 fix: Connect SSE in follower mode để nhận admin update events qua BroadcastChannel
  // từ sidebar leader (provider config, node types, etc.). Without this, editor window stays
  // isolated and misses realtime config updates.
  if (window.SseClient && window.authManager?.isLoggedIn()) {
    try {
      await window.SseClient.connect();
      console.log('[WorkflowEditorInit] SseClient connected (follower mode expected)');
    } catch (e) {
      console.warn('[WorkflowEditorInit] SseClient connect failed:', e?.message);
    }
  }

  // Initialize RequestCoalescer for popup window coordination
  // Popup windows delegate GET requests to sidePanel to avoid duplicate API calls
  if (window.RequestCoalescer) {
    window.RequestCoalescer.init();
    console.log('[WorkflowEditorInit] RequestCoalescer ready, isLeader:', window.RequestCoalescer.isLeader());
  }

  // Initialize StorageManager (instance-based, not static)
  if (window.storageManager) {
    await window.storageManager.init();
    console.log('[WorkflowEditorInit] StorageManager mode:', window.storageManager.getMode());
  }

  // Initialize FeatureGate (load entitlements from cache/API)
  if (window.featureGate) {
    await window.featureGate.init();
    // [Fix workflow popup logout] KHÔNG force refresh vì nếu token expired,
    // _apiCall sẽ retry refreshToken() → fail → _clearAuth() remove af_auth →
    // sidePanel storage listener detect → trigger logout cascade.
    // Popup chỉ cần cached entitlements (đã load trong init()). SidePanel chịu
    // trách nhiệm refresh entitlements định kỳ.
    try {
      if (!window.featureGate._isCacheValid?.() && window.featureGate.refresh) {
        await window.featureGate.refresh();
      }
    } catch (err) {
      // Swallow — popup không nên gây logout cascade. Sử dụng cached data.
      console.warn('[WorkflowEditorInit] FeatureGate refresh failed, dùng cache:', err.message);
    }
    console.log('[WorkflowEditorInit] FeatureGate ready, plan:', window.featureGate.plan?.slug || 'unknown', ', auto_download:', window.featureGate.canUse('auto_download'), ', workflows_nodes_max:', window.featureGate.checkQuota('workflows_nodes_max')?.limit);
  }

  // Pre-fetch plans → window._cachedPlans (cần cho crown label "Yêu cầu login" vs "Premium").
  // /api/v1/plans là public endpoint → fetch cả khi anonymous user.
  // Fix (log audit): LOCAL mode KHÔNG có backend → fetch luôn fail ("plans fetch failed") = noise +
  // gọi backend thừa (vi phạm 100% local). Skip, set rỗng (đồng bộ settings-page.js:1450). UI
  // monetization đã bị ẩn ở local nên không cần nhãn gói.
  if (self.SEOSONA_LOCAL_MODE !== false) {
    window._cachedPlans = [];
  } else if (!Array.isArray(window._cachedPlans) || window._cachedPlans.length === 0) {
    try {
      const plansResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'apiRequest',
          method: 'GET',
          endpoint: 'plans?extension=flow&include_internal=1',
        }, (r) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (r?.success && r?.data) resolve(r.data);
          else reject(new Error('plans fetch failed'));
        });
      });
      if (Array.isArray(plansResp)) window._cachedPlans = plansResp;
    } catch (err) {
      console.warn('[WorkflowEditorInit] Fetch plans failed:', err.message);
    }
  }

  // Apply hide-upgrade-ui from system settings via SystemConfig
  if (window.SystemConfig) {
    await SystemConfig.restoreFromStorage();
    SystemConfig.applyToUI();
    console.log('[WorkflowEditorInit] SystemConfig restored, show_upgrade_ui:', SystemConfig.getBool('show_upgrade_ui'));
  }

  // Initialize PendingUploadStore (restore cached uploads from IndexedDB)
  try {
    if (window.PendingUploadStore) {
      await PendingUploadStore.restore();
      await PendingUploadStore.restoreCache();
      await PendingUploadStore.restoreLightweight();
      console.log('[WorkflowEditorInit] PendingUploadStore restored');
    }
  } catch (e) {
    console.error('[WorkflowEditorInit] PendingUploadStore error:', e);
  }

  // Bug 38 fix (2026-05-19): Fetch PCM api_configs (ratios, download_resolutions, error_patterns)
  // trước khi render bất kỳ node settings nào. Nếu skip, Download/Generate node dropdown
  // hiển thị inline fallback labels KHÁC backend → user confused (Bug 37 + 38 báo cáo).
  try {
    if (window.ProviderConfigManager?._fetchApiConfigs) {
      await window.ProviderConfigManager._fetchApiConfigs();
      console.log('[WorkflowEditorInit] PCM api_configs fetched');
    }
  } catch (e) {
    console.warn('[WorkflowEditorInit] PCM api_configs fetch failed (using inline fallback):', e?.message);
  }

  // Flow Voice Selector — init cross-context sync (chrome.storage.onChanged listener) +
  // load scraped list từ storage để voice picker modal hiển thị custom voices user đã sync
  // ở sidebar/settings (workflow-editor là window riêng, cần explicit hydrate).
  try {
    window.CharacterRegistry?.initCrossContextSync?.();
    window.CharacterRegistry?.getScrapedList?.().catch(function (_e) { globalThis.SEOSONA_swallow?.('workflow-editor-init#hideWfLoading', _e); }); // hydrate cache → findBySlug works lúc node save/submit
    if (window.VoiceRegistry) {
      window.VoiceRegistry.initCrossContextSync?.();
      // Hydrate cả base catalog + scraped list từ storage warm
      await Promise.all([
        window.VoiceRegistry.getBaseCatalog?.('flow').catch(() => null),
        window.VoiceRegistry.getScrapedList?.().catch(() => null),
      ]);
      console.log('[WorkflowEditorInit] VoiceRegistry hydrated (scraped + base)');
    }
  } catch (e) {
    console.warn('[WorkflowEditorInit] VoiceRegistry init failed:', e?.message);
  }

  // Fetch ProviderMeta (provider names, icons, status) for node brand labels
  try {
    if (window.ProviderMeta?.fetch) {
      await window.ProviderMeta.fetch();
      console.log('[WorkflowEditorInit] ProviderMeta fetched');
    }
    if (window.ProviderMeta?.init) {
      window.ProviderMeta.init();
      console.log('[WorkflowEditorInit] ProviderMeta initialized');
    }
  } catch (e) {
    console.warn('[WorkflowEditorInit] ProviderMeta fetch failed:', e?.message);
  }

  // Initialize WorkflowExecutor for standalone window (self-instantiation only runs in sidePanel context)
  try {
    if (window.WorkflowExecutor && !window.workflowExecutor) {
      window.workflowExecutor = new WorkflowExecutor();
      console.log('[WorkflowEditorInit] WorkflowExecutor created');
    }
  } catch (e) {
    console.error('[WorkflowEditorInit] WorkflowExecutor error:', e);
  }

  // Saver lịch sử cho cửa sổ editor riêng: bắt prompt:completed do workflowExecutor emit cục bộ
  // → POST /history. Thiếu init này thì record workflow chạy từ editor không lên admin.
  try {
    window.generationHistory?.init();
  } catch (e) {
    console.warn('[WorkflowEditorInit] GenerationHistory init failed:', e?.message);
  }

  // Fetch workflow node types from server (filter theo X-Ext-Version + is_active + plan).
  // Non-blocking: nếu fail → palette fallback dùng local types như cũ.
  try {
    if (window.NodeTemplates?.fetchFromServer) {
      // Invalidate cache để mỗi lần mở editor đều fetch lại config mới nhất từ admin
      window.NodeTemplates.clearServerCache?.();
      await window.NodeTemplates.fetchFromServer().catch((err) => {
        console.warn('[WorkflowEditorInit] NodeTemplates.fetchFromServer failed, dùng local fallback:', err?.message);
      });
      console.log('[WorkflowEditorInit] NodeTemplates server types loaded:',
        Object.keys(window.NodeTemplates._serverTypes || {}).length);
    }
  } catch (e) {
    console.warn('[WorkflowEditorInit] NodeTemplates fetch error:', e);
  }

  // Create WorkflowEditor instance
  console.log('[WorkflowEditorInit] Creating WorkflowEditor...');
  let editor;
  try {
    editor = new WorkflowEditor();
    window.workflowEditor = editor; // Expose cho debug + line 319-320 reference
    console.log('[WorkflowEditorInit] WorkflowEditor created');
  } catch (e) {
    console.error('[WorkflowEditorInit] WorkflowEditor constructor error:', e);
    return;
  }

  // Override _hideSidebar/_showSidebar for standalone mode (no sidebar to hide)
  editor._hideSidebar = () => {};
  editor._showSidebar = () => {};

  // Override close: in standalone mode, only close browser window on explicit user action
  // render() calls close() internally for DOM cleanup — must NOT close the window then
  let _suppressWindowClose = false;
  const originalClose = editor.close.bind(editor);
  editor.close = () => {
    const hadOverlay = !!editor.overlay;
    originalClose();
    if (hadOverlay && !_suppressWindowClose) window.close();
  };

  // Wrap render() to suppress window.close during its internal close() call
  const originalRender = editor.render.bind(editor);
  editor.render = () => {
    _suppressWindowClose = true;
    originalRender();
    _suppressWindowClose = false;
  };

  // Notify sidebar when window is about to close (handles Leave app? scenario)
  window.addEventListener('unload', () => {
    // Send notification to sidebar to refresh - use sendMessage (async) even though window is closing
    // This helps sidebar update faster when user clicks "Leave" in beforeunload dialog
    chrome.runtime.sendMessage({ action: 'workflowEditorClosed' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('workflow-editor-init#render', _e); });
  });

  // Check for pending workflow data + template preview flag
  console.log('[WorkflowEditorInit] Checking pending workflow data...');
  let stored;
  try {
    stored = await new Promise(resolve => {
      // KHÔNG đọc _pendingTemplatePreview nữa — preview template giờ chạy ở template-preview.html
      // (cửa sổ siêu nhẹ riêng). Block "Template Preview Mode" bên dưới thành DEAD (ko bao giờ vào)
      // → tránh stale _pendingTemplatePreview HIJACK editor thật khi mở workflow để sửa.
      chrome.storage.local.get(['_pendingWorkflow'], result => resolve(result));
    });
    console.log('[WorkflowEditorInit] Pending data:', stored._pendingWorkflow ? 'workflow' : '');
  } catch (e) {
    console.error('[WorkflowEditorInit] Storage get error:', e);
    stored = {};
  }

  // === Template Preview Mode (Option A) ===
  // Nếu có _pendingTemplatePreview → render template readonly, KHÔNG load user workflow
  if (stored._pendingTemplatePreview?.template) {
    chrome.storage.local.remove('_pendingTemplatePreview');
    const tpl = stored._pendingTemplatePreview.template;
    try {
      // Convert template format → workflow format FLAT (node_id/node_type/pos_x/pos_y/...) — KHỚP
      // WorkflowTemplateList._convertTemplateToWorkflowFormat để diagram render ĐÚNG vị trí (trước
      // giữ nested {id,type,position,data} → editor đọc sai → node chồng nhau).
      const ts = Date.now();
      const nodes = (Array.isArray(tpl.nodes) ? tpl.nodes : []).map((node, idx) => {
        const data = node.data || {};
        const refImgUrls = (Array.isArray(node.ref_img_urls) && node.ref_img_urls.length)
          ? node.ref_img_urls : (Array.isArray(data.ref_img_urls) ? data.ref_img_urls : []);
        const refThumbnails = {};
        refImgUrls.forEach((url, i) => { refThumbnails[`template_ref_${ts}_${idx}_${i}`] = url; });
        const existingResultThumbs = node.result_thumbnails || data.result_thumbnails || {};
        const resultImgUrl = node.result_img_url || data.result_img_url || '';
        const resultThumbnails = (Object.keys(existingResultThumbs).length || resultImgUrl)
          ? { ...existingResultThumbs, ...(resultImgUrl ? { [`result_${ts}_${idx}`]: resultImgUrl } : {}) }
          : null;
        return {
          ...data,
          node_id: node.node_id || node.id || `node_${ts}_${idx}`,
          node_type: node.node_type || node.type,
          node_name: node.node_name || data.node_name || node.name || node.type,
          pos_x: node.pos_x ?? node.position?.x ?? 100,
          pos_y: node.pos_y ?? node.position?.y ?? 100,
          prompt: node.prompt || data.prompt || '',
          model: node.model || data.model || '',
          ratio: node.ratio || data.ratio || '1:1',
          quantity: node.quantity || data.quantity || 1,
          ref_img_urls: refImgUrls,
          ref_thumbnails: { ...(node.ref_thumbnails || data.ref_thumbnails || {}), ...refThumbnails },
          result_thumbnails: resultThumbnails,
          enabled: node.enabled !== false,
        };
      });
      const edges = (Array.isArray(tpl.edges) ? tpl.edges : []).map((edge, idx) => ({
        edge_id: edge.edge_id || edge.id || `edge_${ts}_${idx}`,
        source_node_id: edge.source_node_id || edge.source,
        target_node_id: edge.target_node_id || edge.target,
        source_handle: edge.source_handle || edge.output_class || 'output_1',
        target_handle: edge.target_handle || edge.input_class || 'input_1',
        source_port: edge.source_port || 'default',
        target_port: edge.target_port || 'default',
      }));
      const adapted = {
        wf_id: `preview_${tpl.id || 'tpl'}`,
        wf_name: tpl.name || 'Template', // KHÔNG prefix "[Xem trước]"
        nodes, edges,
        enabled: false,
        status: 'pending',
        // _is_template_preview + mode 'view' → editor.isReadOnly() = true BỀN VỮNG (mode ko bị xóa,
        // khác _isPreview bị delete lúc open) → tự ẩn save/run/publish/share/toolbar + KHÔNG beforeunload.
        _is_template_preview: true,
        _template_id: tpl.id,
        // Template gốc (full) để nút "Use" → sidebar _copyTemplateToWorkflow hiện ĐÚNG modal official
        // (cần name/description/thumbnail_url/node_count/nodes). Community KHÔNG nằm trong this.templates
        // nên phải truyền object. 6 node ~ vài KB, ko phải bloat.
        _original_template: tpl,
        _is_community_template: true,
      };
      editor.open('view', adapted);
      hideWfLoading();

      // KHÔNG tự thêm nút Import nữa — editor view mode đã có nút "Use" (duplicateSharedHeaderBtn) native.
      setTimeout(() => {
        try {
          const overlay = editor.overlay;
          // wf-community-preview: scope ẩn toolbar/publish/share CHỈ cho community (ko đụng official preview).
          if (overlay) overlay.classList.add('wf-preview-mode', 'wf-community-preview');
          // [Bisect treo community] BỎ wf-canvas-readonly — official preview KHÔNG dùng class này (chỉ
          // wf-preview-mode) mà vẫn read-only + mượt. Class này thêm ::before gradient overlay (position
          // absolute, z-index 10) → nghi GPU compositing layer tích lũy mỗi lần mở → treo. isReadOnly()
          // vẫn chặn edit nên bỏ an toàn.
          console.log('[WorkflowEditorInit] Template preview (view mode) activated');
        } catch (err) {
          console.warn('[WorkflowEditorInit] preview lock fail:', err);
        }
      }, 200);
    } catch (e) {
      console.error('[WorkflowEditorInit] Template preview error:', e);
      editor.open('create');
    }
    hideWfLoading();
    return; // skip rest of init
  }

  try {
    if (stored._pendingWorkflow) {
      const data = stored._pendingWorkflow;
      // Clear pending data
      chrome.storage.local.remove('_pendingWorkflow');

      // Khôi phục project context từ sidePanel
      if (data.projectId) {
        window._currentProjectId = data.projectId;
        window._currentProjectName = data.projectName || null;
      }

      if ((data.mode === 'edit' || data.mode === 'view' || data.mode === 'admin_preview') && data.workflow) {
        let workflowToOpen = data.workflow;

        // VIEW/ADMIN_PREVIEW mode (shared/admin workflow read-only): dùng nodes/edges đã được backend
        // eager load. KHÔNG fetch fresh từ storageManager.getWorkflow() vì workflow thuộc user khác.
        // EDIT mode: refresh data từ server để đảm bảo node name/status mới nhất.
        if (data.mode === 'edit') {
          const smMode = window.storageManager?.getMode();
          const isLoggedIn = window.authManager?.isLoggedIn();
          console.log('[WorkflowEditorInit] Refresh check - storageManager mode:', smMode, ', authManager logged in:', isLoggedIn, ', wf_id:', data.workflow.wf_id);

          // [API SPAM FIX — Phase 5.10] Check và recover buffer checkpoint từ crash trước đó
          // Gọi TRƯỚC fetch fresh workflow để server có data mới nhất
          if (data.workflow.wf_id && window.WorkflowExecutor?.recoverBufferCheckpoint) {
            try {
              const recovered = await window.WorkflowExecutor.recoverBufferCheckpoint(data.workflow.wf_id);
              if (recovered) {
                console.log('[WorkflowEditorInit] Buffer checkpoint recovered for:', data.workflow.wf_id);
              }
            } catch (recoverErr) {
              console.warn('[WorkflowEditorInit] Buffer recovery failed:', recoverErr.message);
            }
          }

          if (smMode === 'api' && data.workflow.wf_id) {
            try {
              console.log('[WorkflowEditorInit] Fetching latest workflow data from server...');
              const freshWorkflow = await window.storageManager.getWorkflow(data.workflow.wf_id);
              if (freshWorkflow && freshWorkflow.nodes) {
                console.log('[WorkflowEditorInit] Using fresh data from server, nodes:', freshWorkflow.nodes?.length);
                workflowToOpen = freshWorkflow;
              } else {
                console.warn('[WorkflowEditorInit] Server returned no data, using passed workflow');
              }
            } catch (fetchErr) {
              console.warn('[WorkflowEditorInit] Failed to fetch fresh data, using passed workflow:', fetchErr.message);
            }
          } else if (isLoggedIn && smMode !== 'api') {
            // User is logged in but storageManager not in API mode - try to switch
            console.log('[WorkflowEditorInit] Attempting to switch storageManager to API mode...');
            try {
              await window.storageManager.switchToApi();
              const freshWorkflow = await window.storageManager.getWorkflow(data.workflow.wf_id);
              if (freshWorkflow && freshWorkflow.nodes) {
                console.log('[WorkflowEditorInit] Using fresh data after mode switch, nodes:', freshWorkflow.nodes?.length);
                workflowToOpen = freshWorkflow;
              }
            } catch (switchErr) {
              console.warn('[WorkflowEditorInit] Mode switch failed:', switchErr.message);
            }
          } else if (data.workflow.wf_id && !Array.isArray(data.workflow.nodes)) {
            // LOCAL MODE recovery (2026-07): the sidebar passes only workflow METADATA.
            // In local mode the server fetch above is skipped, so nodes stay undefined
            // → empty canvas ("workflow biến mất / không thêm được node"). StorageManager
            // local mode stores workflow+nodes+edges together, so getWorkflow() returns
            // the full graph. Load it explicitly here.
            try {
              const localWf = await window.storageManager?.getWorkflow(data.workflow.wf_id);
              if (localWf && Array.isArray(localWf.nodes)) {
                console.log('[WorkflowEditorInit] Loaded full workflow from LOCAL storage, nodes:', localWf.nodes.length);
                workflowToOpen = localWf;
              } else {
                console.warn('[WorkflowEditorInit] LOCAL storage has no nodes for wf_id:', data.workflow.wf_id);
              }
            } catch (localErr) {
              console.warn('[WorkflowEditorInit] LOCAL workflow load failed:', localErr?.message);
            }
          }

          // [Fix cloned workflow] Clear shared/preview flags for edit mode
          // Workflow cloned từ shared không nên có flag read-only
          delete workflowToOpen._is_shared_view;
          delete workflowToOpen._is_template_preview;
        } else {
          // VIEW/ADMIN_PREVIEW mode — đảm bảo có flag read-only để editor.isReadOnly() = true.
          // Ba loại:
          //   - shared workflow → _is_shared_view = true
          //   - template preview → _is_template_preview = true
          //   - admin preview → _is_admin_view = true
          if (data.mode === 'admin_preview') {
            workflowToOpen = { ...workflowToOpen, _is_admin_view: true };
            console.log('[WorkflowEditorInit] Opening in ADMIN_PREVIEW (read-only) mode, nodes:', workflowToOpen.nodes?.length);
          } else {
            const hasReadOnlyFlag = workflowToOpen._is_shared_view === true
                                || workflowToOpen._is_template_preview === true;
            if (!hasReadOnlyFlag) {
              workflowToOpen = { ...workflowToOpen, _is_shared_view: true };
            }
            const previewType = workflowToOpen._is_template_preview ? 'template preview' : 'shared workflow';
            console.log(`[WorkflowEditorInit] Opening ${previewType} in VIEW (read-only) mode, nodes:`, workflowToOpen.nodes?.length);
          }
        }

        console.log('[WorkflowEditorInit] Loading workflow nodes:', workflowToOpen.nodes?.map(n => ({ id: n.node_id, name: n.node_name, status: n.status })));
        editor.open(data.mode, workflowToOpen);
      } else {
        console.log('[WorkflowEditorInit] Opening in create mode (no workflow data)');
        editor.open('create');
      }
    } else {
      console.log('[WorkflowEditorInit] Opening in create mode (no pending)');
      editor.open('create');
    }
    console.log('[WorkflowEditorInit] Editor opened successfully');
    hideWfLoading();

    // Update canvas plan badge after editor is ready
    setTimeout(() => {
      if (window._updateCanvasPlanBadge) window._updateCanvasPlanBadge();
      // Apply SystemConfig (logo + app name) to workflow canvas brand zone
      if (window.SystemConfig) SystemConfig.applyToUI();
    }, 100);

    // WS-6: Check if any workflow is currently running and sync UI.
    // Gap 2 fix: dùng helper TTL-aware (tự auto-clear stale flag >30 phút thay vì
    // sync UI cho workflow ảo).
    try {
      const running = await window.WorkflowExecutor?.getCrossContextRunning?.();
      if (running) {
        if (running.wf_id === editor.workflow?.wf_id) {
          // This workflow is running - sync UI regardless of cached status
          // (af_running_workflow is source of truth for execution state)
          console.log('[WorkflowEditorInit] This workflow is running, syncing UI...');
          // Mark: editor được mở để xem workflow đang chạy (không phải run từ editor)
          // → skip unsaved warning khi đóng
          editor._openedToViewRunning = true;
          if (typeof editor._onExecutionStarted === 'function') {
            editor._onExecutionStarted();
          }
          if (window.workflowExecutor) {
            window.workflowExecutor.isRunning = true;
            window.workflowExecutor.currentWorkflow = editor.workflow;
          }
          // Update local workflow status to match reality
          if (editor.workflow) {
            editor.workflow.status = 'running';
          }
          // Fetch fresh node statuses from storage and update canvas
          try {
            const freshWorkflow = await window.storageManager?.getWorkflow(running.wf_id);
            if (freshWorkflow?.nodes) {
              for (const node of freshWorkflow.nodes) {
                if (node.status && node.status !== 'pending') {
                  editor._syncDrawflowNodeData?.(node.node_id, { status: node.status });
                  editor._updateNodeStatusUI?.(node.node_id, node.status);
                  if (node.status === 'completed' && node.result_file_ids) {
                    const fileIds = node.result_file_ids.split(',').filter(Boolean);
                    if (fileIds.length > 0) {
                      editor._showNodePreview?.(node.node_id, fileIds);
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[WorkflowEditorInit] Failed to sync node statuses:', e.message);
          }
          // Fix: sync currently running node UI from af_running_workflow.current_node_id
          if (running.current_node_id) {
            console.log('[WorkflowEditorInit] Syncing running node UI:', running.current_node_id);
            editor._updateNodeStatusUI?.(running.current_node_id, 'running');
            // Also sync executor's currentNode for _syncRunningNodeFromExecutor
            if (window.workflowExecutor) {
              window.workflowExecutor.currentNode = { node_id: running.current_node_id };
            }
          }
        } else {
          // A different workflow is running - sync global isRunning state
          console.log('[WorkflowEditorInit] Another workflow is running:', running.wf_name);
          if (window.workflowExecutor) {
            window.workflowExecutor.isRunning = true;
            window.workflowExecutor._runningOtherWfId = running.wf_id;
          }
        }
      }
    } catch (e) {
      console.error('[WorkflowEditorInit] Error checking running state:', e);
    }
  } catch (e) {
    console.error('[WorkflowEditorInit] editor.open() error:', e);
  } finally {
    hideWfLoading(); // luôn gỡ overlay dù open lỗi — không để spinner kẹt
  }

  // Captcha overlay (Flow tab content.js) → bridge runtime message vào eventBus cục bộ.
  // Workflow editor page tự host PromptQueue + WorkflowExecutor → khi chạy workflow từ
  // editor mà Flow bung captcha, click "Tiếp tục"/"Dừng" phải tới PromptQueue._onCaptchaUserAction.
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.action === 'captcha:userAction') {
      window.eventBus?.emit('captcha:userAction', { decision: message.decision });
    }
  });

  // Listen for workflow load messages from sidePanel
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'loadWorkflowInEditor' && message.data) {
      const d = message.data;
      // Cập nhật project context nếu có
      if (d.projectId) {
        window._currentProjectId = d.projectId;
        window._currentProjectName = d.projectName || null;
      }

      // Guard: nếu editor đang có unsaved changes và load workflow KHÁC (hoặc create mode) → confirm trước
      const currentWfId = editor?.workflow?.wf_id || null;
      const targetWfId = d.workflow?.wf_id || null;
      const hasUnsaved = !!editor?._hasUnsavedChanges;
      const targetIsCreate = d.mode !== 'edit';
      const isSameWorkflowReload = currentWfId && targetWfId && targetWfId === currentWfId;
      const isDifferentWorkflow = (targetWfId && currentWfId && targetWfId !== currentWfId) || (targetIsCreate && currentWfId);

      // Guard chống mất unsaved edits: nếu user click cùng workflow đang mở (vd: từ sidebar)
      // → KHÔNG reload (giữ state local). Tránh ghi đè edits chưa save.
      if (hasUnsaved && isSameWorkflowReload) {
        console.log('[WorkflowEditorInit] Same wf_id + unsaved → skip reload to preserve edits');
        return;
      }

      const proceed = async () => {
        if (d.mode === 'edit' && d.workflow) {
          let workflowToOpen = d.workflow;
          const smMode = window.storageManager?.getMode();
          const isLoggedIn = window.authManager?.isLoggedIn();

          // Force fetch from server to ensure latest data
          if (smMode === 'api' && d.workflow.wf_id) {
            try {
              console.log('[WorkflowEditorInit] Message: Fetching latest workflow data...');
              const freshWorkflow = await window.storageManager.getWorkflow(d.workflow.wf_id);
              if (freshWorkflow && freshWorkflow.nodes) {
                workflowToOpen = freshWorkflow;
              }
            } catch (e) {
              console.warn('[WorkflowEditorInit] Message: Failed to fetch fresh data:', e.message);
            }
          } else if (isLoggedIn && smMode !== 'api' && d.workflow.wf_id) {
            try {
              await window.storageManager.switchToApi();
              const freshWorkflow = await window.storageManager.getWorkflow(d.workflow.wf_id);
              if (freshWorkflow && freshWorkflow.nodes) {
                workflowToOpen = freshWorkflow;
              }
            } catch (e) {
              console.warn('[WorkflowEditorInit] Message: Mode switch/fetch failed:', e.message);
            }
          } else if (d.workflow.wf_id && !Array.isArray(d.workflow.nodes)) {
            // LOCAL MODE recovery (2026-07): message carries metadata only → load the
            // full graph (nodes + edges) from local storage so the canvas isn't empty.
            try {
              const localWf = await window.storageManager?.getWorkflow(d.workflow.wf_id);
              if (localWf && Array.isArray(localWf.nodes)) workflowToOpen = localWf;
            } catch (e) {
              console.warn('[WorkflowEditorInit] Message: LOCAL workflow load failed:', e.message);
            }
          }
          editor.open('edit', workflowToOpen);
        } else {
          editor.open('create');
        }
      };

      if (hasUnsaved && isDifferentWorkflow) {
        const I = window.I18n;
        (async () => {
          const confirmed = await window.customDialog?.confirm(
            I?.t('workflow.unsavedSwitchMsg') || 'Current workflow has unsaved changes. Switch to another workflow without saving?',
            {
              title: I?.t('workflow.unsavedTitle') || 'Unsaved changes',
              type: 'warning',
              confirmText: I?.t('workflow.switchWithoutSave') || 'Switch without saving',
              cancelText: I?.t('workflow.goBack') || 'Go back',
            }
          );
          if (confirmed) {
            await proceed();
          }
        })();
      } else {
        proceed();
      }
    }

    // SSE relay: entitlements changed → refresh featureGate để unlock/lock Pro nodes/features
    if (message.action === 'sseRelay:entitlements_changed') {
      console.log('[WorkflowEditorInit] SSE entitlements changed, refreshing featureGate');
      try {
        if (message.data?.features && message.data?.plan && window.featureGate?.handleSseEntitlementsChanged) {
          window.featureGate.handleSseEntitlementsChanged(message.data);
        } else {
          window.featureGate?.refresh?.();
        }
        // Update authManager.user.plan_slug để gates evaluate đúng
        if (message.data?.plan?.slug && window.authManager?.user) {
          window.authManager.user.plan_slug = message.data.plan.slug;
          if (message.data.plan.name) window.authManager.user.plan_name = message.data.plan.name;
        }
      } catch (e) {
        console.warn('[WorkflowEditorInit] sseRelay:entitlements_changed handler error:', e);
      }
    }

    // SSE relay: force logout từ admin → đóng workflow popup ngay
    if (message.action === 'sseRelay:force_logout') {
      console.log('[WorkflowEditorInit] SSE force_logout, closing window');
      try { window.close(); } catch (e) { /* ignore */ }
    }

    // Gap 3 fix: Workflow bị xóa từ sidebar → nếu editor đang mở wf_id đó thì
    // warn user + đóng. Trước đây editor không biết → user save tạo lại / 404.
    if (message.action === 'workflowDeleted' && message.wfId) {
      const currentWfId = editor?.workflow?.wf_id || null;
      if (currentWfId && currentWfId === message.wfId) {
        console.log('[WorkflowEditorInit] Current workflow deleted from another context, closing editor');
        // Mark unsaved=false để bypass beforeunload dialog
        if (editor) editor._hasUnsavedChanges = false;
        try {
          window.customDialog?.alert(
            window.I18n?.t('workflow.deletedFromOtherContext') ||
            'Workflow này đã bị xóa từ cửa sổ khác. Editor sẽ đóng.',
            { type: 'warning' }
          );
        } catch (e) { /* ignore */ }
        // Đóng sau 1.5s để user kịp đọc
        setTimeout(() => { try { window.close(); } catch (e) { globalThis.SEOSONA_swallow?.('workflow-editor-init#proceed', e); } }, 1500);
      }
    }

    // Relay execution events from sidePanel into local eventBus
    if (message.action === 'workflowExecutionEvent' && window.eventBus) {
      const { event, data } = message;

      // Anti-loopback: skip nếu message do background relay (gắn `_bg_relayed: true`).
      // Bug fix 2026-05-25: Chrome auto-broadcast tới mọi extension context, sidebar+popup
      // đã nhận BẢN GỐC. Background re-send để probe receiver duplicates event → listener
      // fire 2 lần. Tag `_bg_relayed` để skip duplicate.
      if (message._bg_relayed) {
        return;
      }

      // Bug 55 fix: Skip re-emit cho node events khi local executor đang chạy.
      // WorkflowExecutor trong cùng context đã emit trực tiếp → broadcast quay về
      // sẽ tạo duplicate event (lần 2 thiếu node_type → undefined).
      const executor = window.workflowExecutor;
      const isLocallyRunning = executor?.isRunning && !executor?._runningOtherWfId;
      const isNodeEvent = ['node:started', 'node:completed', 'node:failed', 'node:warning', 'node:phase'].includes(event);
      if (isLocallyRunning && isNodeEvent) {
        // Skip — local executor đã emit trực tiếp, không cần relay lại
        return;
      }

      window.eventBus.emit(event, data);

      // WS-6: Sync local executor state when execution starts/stops from sidePanel.
      // CRITICAL: Background relay broadcast về CHÍNH popup → nếu popup đang chạy execute()
      // (isRunning=true), broadcast 'execution:completed' từ chính nó sẽ mid-flight reset
      // currentWorkflow=null → node 2 throw `Cannot read properties of null (reading 'wf_id')`.
      // → Skip state update khi local executor đang chạy (execute()'s finally sẽ tự cleanup).
      // Note: executor + isLocallyRunning đã declare ở trên (Bug 55 fix)

      if (event === 'execution:started' && executor && data?.workflow) {
        // Track workflow running from another context
        if (!isLocallyRunning) {
          console.log('[WorkflowEditorInit] Tracking remote workflow:', data.workflow.wf_id);
          executor.isRunning = true;
          executor._runningOtherWfId = data.workflow.wf_id;
          executor.currentWorkflow = data.workflow;
        }
      } else if (event === 'execution:completed' && executor) {
        // Cross-context completion: clear state if not locally running
        const completedWfId = data?.workflow?.wf_id || data?.wfId;
        if (!isLocallyRunning) {
          // Not running locally → safe to clear
          console.log('[WorkflowEditorInit] Remote workflow completed, clearing state');
          executor.isRunning = false;
          executor._runningOtherWfId = null;
          executor.currentWorkflow = null;
        } else if (completedWfId && executor._runningOtherWfId === completedWfId) {
          // Completed workflow matches tracked other workflow
          console.log('[WorkflowEditorInit] Tracked other workflow completed');
          executor._runningOtherWfId = null;
        }
      } else if (event === 'workflow:reset' && executor) {
        // Reset luôn được phép (user click Reset từ bất kỳ context nào → cancel local execution).
        executor.isRunning = false;
        executor.shouldStop = true;
        executor._runningOtherWfId = null;
        executor.currentWorkflow = null;
        if (window.workflowEditor) {
          window.workflowEditor._syncExecutionUI?.();
        }
      } else if (event === 'execution:stop' && executor) {
        // Stop broadcast from other context (sidebar/other popup)
        const stopWfId = data?.wf_id || data?.workflow?.wf_id;
        console.log('[WorkflowEditorInit] Remote stop received, wfId:', stopWfId);

        if (!isLocallyRunning) {
          // Not running locally → clear state immediately
          console.log('[WorkflowEditorInit] Not locally running, clearing state');
          executor.isRunning = false;
          executor.shouldStop = true;
          executor._runningOtherWfId = null;
          executor.currentWorkflow = null;
        } else {
          // Locally running → let handleRemoteStop() set shouldStop, execute() will cleanup
          executor.handleRemoteStop?.();
        }
        if (window.workflowEditor) {
          window.workflowEditor._syncExecutionUI?.();
        }
      }
    }
  });

  // ===== Canvas Plan Badge Update =====
  function updateCanvasPlanBadge() {
    const planBadge = document.getElementById('canvasPlanBadge');
    if (!planBadge) return;

    const isLoggedIn = window.authManager?.isLoggedIn();
    const user = window.authManager?.getUser();
    const planSlug = user?.plan_slug || window.featureGate?.plan?.slug;
    const isPremium = planSlug === 'unlimited' || planSlug === 'premium' ||
                      planSlug === 'seosona-pro' || planSlug === 'seosona-grok-pro' ||
                      planSlug === 'seosona-ultra';

    if (!isLoggedIn) {
      planBadge.classList.add('hidden');
    } else {
      planBadge.classList.remove('hidden');
      if (planSlug === 'seosona-ultra') {
        planBadge.textContent = 'Ultra';
        planBadge.setAttribute('data-plan', 'seosona-ultra');
      } else if (isPremium) {
        const planName = (planSlug === 'seosona-pro' || planSlug === 'seosona-grok-pro') ? 'Pro' : 'Premium';
        planBadge.textContent = planName;
        planBadge.setAttribute('data-plan', 'seosona-pro');
      } else {
        planBadge.textContent = 'Free';
        planBadge.setAttribute('data-plan', 'free');
      }
    }
  }
  window._updateCanvasPlanBadge = updateCanvasPlanBadge;

  // ===== Entitlements sync (cross-window via storage) =====
  // Popup window có eventBus riêng, không nhận featuregate:refreshed từ sidePanel
  // Lắng nghe af_entitlements thay đổi trong storage → reload FeatureGate → emit local event
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.af_entitlements && window.featureGate) {
      const newData = changes.af_entitlements.newValue;
      if (newData?.entitlements) {
        window.featureGate.entitlements = newData.entitlements;
        window.featureGate.plan = newData.plan || window.featureGate.plan;
      }
      // Emit trên local eventBus → WorkflowEditor._updateNodeFeatureToggles() lắng nghe
      window.eventBus?.emit('featuregate:refreshed', {
        plan: newData?.plan,
        entitlements: newData?.entitlements
      });
      // Update canvas plan badge
      updateCanvasPlanBadge();
      console.log('[WorkflowEditorInit] Entitlements updated from storage, plan:', newData?.plan?.slug);
    }
  });

  // ===== Global Quota Events (GP-6) =====
  // Popup window có eventBus riêng, cần listen quota:warning và quota:exhausted
  if (window.eventBus) {
    // GP-6.3: Toast warning khi global quota còn <10%
    window.eventBus.on('quota:warning', (data) => {
      const remaining = data?.remaining ?? 0;
      const limit = data?.limit ?? 0;
      console.log('[WorkflowEditorInit] Quota warning:', remaining, '/', limit, 'remaining');
      // Show simple alert for popup window (no toast system)
      window.customDialog?.alert(
        window.I18n?.t('gate.quotaWarningMsg', { remaining, limit }) || `Còn ${remaining}/${limit} lượt prompt hôm nay. Nâng cấp để không giới hạn.`,
        { title: window.I18n?.t('gate.quotaWarningTitle') || 'Sắp hết lượt prompt', type: 'warning' }
      );
    });

    // GP-6.4: Dialog khi global quota đã hết (exhausted)
    window.eventBus.on('quota:exhausted', (data) => {
      const limit = data?.limit ?? 0;
      const module = data?.module || 'Workflow';
      console.log('[WorkflowEditorInit] Quota exhausted:', limit, 'limit for', module);

      if (window.customDialog) {
        // SS: Check show_upgrade_ui để quyết định hiển thị nút nào
        const showUpgrade = window.SystemConfig?.getBool('show_upgrade_ui') !== false;
        const contactUrl = window.SystemConfig?.get('upgrade_contact_url', '');

        // Build buttons based on show_upgrade_ui setting
        const buttons = [
          { label: window.I18n?.t('gate.close') || 'Đóng', primary: false, action: () => {} }
        ];

        if (showUpgrade) {
          buttons.push({
            label: window.I18n?.t('gate.upgradeNow') || 'Nâng cấp ngay',
            primary: true,
            action: () => {
              // Popup context: send message to sidebar to show upgrade modal
              chrome.runtime.sendMessage({ action: 'showUpgradeModal' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('workflow-editor-init#action', _e); });
            }
          });
        } else if (contactUrl) {
          buttons.push({
            label: window.I18n?.t('gate.contact') || 'Liên hệ',
            primary: true,
            action: () => { window.open(contactUrl, '_blank'); }
          });
        }

        const exhaustedMsg = window.I18n?.t('gate.quotaExhaustedMsg', { limit }) || `Bạn đã sử dụng hết <strong>${limit} lượt prompt</strong> hôm nay.`;
        const upgradeDesc = showUpgrade
          ? (window.I18n?.t('gate.upgradeForUnlimited') || 'Nâng cấp lên gói Premium để nhận không giới hạn lượt prompt mỗi ngày và nhiều tính năng khác.')
          : (window.I18n?.t('gate.contactAdminUpgrade') || 'Vui lòng liên hệ admin để nâng cấp gói.');

        window.customDialog.alert(
          `<div style="line-height:1.6">
            <p>${exhaustedMsg}</p>
            <p style="margin-top:12px;color:var(--muted-foreground)">${upgradeDesc}</p>
          </div>`,
          { title: window.I18n?.t('gate.quotaExhaustedTitle') || 'Đã hết lượt prompt hôm nay', type: 'warning', html: true, buttons }
        );
      }
    });
  }

  // ===== Event-driven sync (primary) =====
  // Listen for execution events to update UI in real-time
  if (window.eventBus) {
    // Node completed: update UI and show preview
    window.eventBus.on('node:completed', async (data) => {
      if (!data?.node?.node_id) return;
      const nodeId = data.node.node_id;
      const currentNode = editor.workflow?.nodes?.find(n => n.node_id === nodeId);
      if (currentNode) {
        currentNode.status = 'completed';
        currentNode.result_file_ids = data.result?.fileIds?.join(',') || '';
        editor._updateNodeStatusUI(nodeId, 'completed');
        editor._syncDrawflowNodeData(nodeId, { status: 'completed', result_file_ids: currentNode.result_file_ids });
        if (data.result?.fileIds?.length > 0) {
          editor._showNodePreview(nodeId, data.result.fileIds);
        }
      }
    });

    // Node started: update status
    window.eventBus.on('node:started', (data) => {
      if (!data?.node?.node_id) return;
      const nodeId = data.node.node_id;
      const currentNode = editor.workflow?.nodes?.find(n => n.node_id === nodeId);
      if (currentNode) {
        currentNode.status = 'running';
        editor._updateNodeStatusUI(nodeId, 'running');
        editor._syncDrawflowNodeData(nodeId, { status: 'running' });
      }
    });

    // Node failed: update status
    window.eventBus.on('node:failed', (data) => {
      if (!data?.node?.node_id) return;
      const nodeId = data.node.node_id;
      const currentNode = editor.workflow?.nodes?.find(n => n.node_id === nodeId);
      if (currentNode) {
        currentNode.status = 'failed';
        editor._updateNodeStatusUI(nodeId, 'failed');
        editor._syncDrawflowNodeData(nodeId, { status: 'failed' });
      }
    });

    // Execution completed: save workflow to persist final state
    window.eventBus.on('execution:completed', async (data) => {
      if (editor.workflow?.wf_id && window.storageManager) {
        try {
          // Reload fresh data from storage (may have been updated by executor)
          const fresh = await window.storageManager.getWorkflow(editor.workflow.wf_id);
          if (fresh?.nodes) {
            editor.workflow.nodes = fresh.nodes;
            editor.workflow.edges = fresh.edges || editor.workflow.edges;
          }
          // Check if all completed → show reset button
          const allCompleted = editor.workflow.nodes?.length > 0 &&
            editor.workflow.nodes.every(n => n.status === 'completed');
          if (allCompleted) {
            editor._showResetButton();
          }
        } catch (e) {
          console.error('[WorkflowEditorInit] Failed to refresh on completion:', e);
        }
      }
    });

    // Workflow reset: clear all node statuses and results
    window.eventBus.on('workflow:reset', async (data) => {
      if (data?.workflowId !== editor.workflow?.wf_id) return;
      // Reload fresh data from storage
      if (window.storageManager) {
        try {
          const fresh = await window.storageManager.getWorkflow(data.workflowId);
          if (fresh?.nodes) {
            editor.workflow.nodes = fresh.nodes;
            // Update UI for each node
            for (const node of fresh.nodes) {
              editor._updateNodeStatusUI(node.node_id, node.status || 'pending');
              editor._syncDrawflowNodeData(node.node_id, {
                status: node.status || 'pending',
                result_file_ids: ''
              });
              // Clear any previews
              editor._clearNodePreview?.(node.node_id);
            }
            // Show run button (hides reset button) since we just reset
            editor._showRunButton?.();
          }
        } catch (e) {
          console.error('[WorkflowEditorInit] Failed to sync reset:', e);
        }
      }
    });
  }

  // ===== Polling sync (fallback for missed events) =====
  // Only poll when execution is active AND no recent event received
  let _syncTimer = null;
  let _lastEventTime = 0;
  const EVENT_GRACE_PERIOD = 5000; // Don't poll within 5s of last event

  if (window.eventBus) {
    // Track when we receive events to avoid redundant polling
    ['node:started', 'node:completed', 'node:failed', 'execution:completed'].forEach(evt => {
      window.eventBus.on(evt, () => { _lastEventTime = Date.now(); });
    });
  }

  let _syncBackoffUntil = 0;
  const startSyncPolling = () => {
    if (_syncTimer) return;
    _syncTimer = setInterval(async () => {
      // Skip polling if we received an event recently (event-driven sync is working)
      if (Date.now() - _lastEventTime < EVENT_GRACE_PERIOD) return;
      // Only poll when execution is running
      if (!window.workflowExecutor?.isRunning) return;
      if (!editor.workflow?.wf_id || !window.storageManager) return;
      // Bug 53 fix: Backoff khi gặp rate limit — tránh spam log "rate-limited"
      if (Date.now() < _syncBackoffUntil) return;

      try {
        const fresh = await window.storageManager.getWorkflow(editor.workflow.wf_id);
        if (!fresh?.nodes) return;
        _syncBackoffUntil = 0;
        for (const node of fresh.nodes) {
          const currentNode = editor.workflow.nodes?.find(n => n.node_id === node.node_id);
          if (!currentNode) continue;
          // [API SPAM FIX — Phase 5] Skip sync nếu local status tiến bộ hơn server.
          // Phase 5 skip persist 'running' status → server vẫn ở status cũ.
          // Bug fix 2026-05-25: thêm 'idle'/null/undefined/'' vào "server-behind" set.
          // Trước fix: clone template tạo nodes server status='idle' default.
          // Polling check `completed != idle` → false localIsAhead → sync ghi đè local
          // 'completed' (kèm result_file_ids='fe_id_...') bằng server 'idle' + clear
          // result_file_ids → reload mất preview generate node.
          // Status order: idle/null/'' < pending < running < completed/failed/skipped
          const SERVER_BEHIND = new Set(['idle', 'pending', '', null, undefined]);
          const LOCAL_AHEAD = new Set(['running', 'completed', 'failed', 'skipped']);
          let localIsAhead = false;
          if (LOCAL_AHEAD.has(currentNode.status)) {
            if (SERVER_BEHIND.has(node.status)) {
              localIsAhead = true;
            } else if (currentNode.status !== 'running' && node.status === 'running') {
              // completed/failed/skipped > running
              localIsAhead = true;
            }
          }
          if (localIsAhead) {
            continue; // Keep local state, don't regress
          }
          if (currentNode.status !== node.status) {
            currentNode.status = node.status;
            currentNode.result_file_ids = node.result_file_ids || '';
            editor._updateNodeStatusUI(node.node_id, node.status);
            editor._syncDrawflowNodeData(node.node_id, { status: node.status, result_file_ids: node.result_file_ids || '' });
            if (node.status === 'completed' && node.result_file_ids) {
              const fileIds = node.result_file_ids.split(',').map(s => s.trim()).filter(Boolean);
              if (fileIds.length > 0) editor._showNodePreview(node.node_id, fileIds);
            }
          }
        }
        const allCompleted = fresh.nodes.length > 0 && fresh.nodes.every(n => n.status === 'completed');
        if (allCompleted) {
          editor._showResetButton();
        }
      } catch (e) {
        // Bug 53 fix: Backoff 10s khi gặp rate limit error
        if (e?.message?.includes('rate-limit') || e?.code === 'RATE_LIMITED') {
          _syncBackoffUntil = Date.now() + 10000;
        }
      }
    }, 3000);
  };

  const stopSyncPolling = () => {
    if (_syncTimer) {
      clearInterval(_syncTimer);
      _syncTimer = null;
    }
  };

  // Gap 7 fix: chỉ start polling khi execution thực sự bắt đầu (cũ start ngay
  // sau init → setInterval chạy mãi mãi dù user không run gì). Stop khi completed
  // hoặc workflow:reset.
  if (window.eventBus) {
    window.eventBus.on('execution:started', startSyncPolling);
    window.eventBus.on('execution:completed', stopSyncPolling);
    window.eventBus.on('workflow:reset', stopSyncPolling);
  }

  // Đề phòng: nếu af_running_workflow đã set sẵn lúc editor mở (vd resume sau
  // reload extension), start polling ngay để sync state.
  try {
    const runningCheck = await window.WorkflowExecutor?.getCrossContextRunning?.();
    if (runningCheck?.wf_id && editor.workflow?.wf_id === runningCheck.wf_id) {
      startSyncPolling();
    }
  } catch (e) { /* ignore */ }

  // ========================================================================
  // [Fix 2026-06-13] Upload safety-net subscribers cho popup workflow editor.
  //
  // Trước fix: sidebar có upload:failed listener (app.js:10536) toast lỗi cho user.
  // Popup workflow editor KHÔNG load app.js → ZERO listener cho upload events →
  // upload silent fail (đặc biệt path _saveLightweightPending khi Flow tab missing
  // → emit upload:pending mà KHÔNG ai listen → user không biết upload chưa OK).
  //
  // Add 2 listener: upload:failed (toast lỗi) + upload:pending (toast warning)
  // → user thấy feedback ngay thay vì click submit và đợi mãi.
  // ========================================================================
  if (window.eventBus && typeof window.showNotification === 'function') {
    window.eventBus.on('upload:failed', (data) => {
      const err = data?.error || 'Unknown error';
      // Lỗi 'no tile ID returned' thường do KHÔNG có Flow project active (đang ở homepage) →
      // live-check + modal rõ ràng (đi tới project / mở Flow) thay vì toast khó hiểu.
      const maybeNoProject = /no tile id|tile id returned|no project|chưa có project/i.test(err);
      if (maybeNoProject && window.ProjectHelper?.hasActiveProject) {
        window.ProjectHelper.hasActiveProject().then((has) => {
          if (has) {
            window.showNotification((window.I18n?.t('msg.uploadFailed', { error: err }) || `Upload thất bại: ${err}`), 'error');
          } else {
            window.ProjectHelper.warnNoProjectForUpload(window.workflowEditor?.workflow?.project_id || null);
          }
        });
        return;
      }
      const msg = (window.I18n?.t('msg.uploadFailed', { error: err }) || `Upload thất bại: ${err}`);
      window.showNotification(msg, 'error');
    });
    window.eventBus.on('upload:pending', (data) => {
      // reason = 'NO_FLOW_TAB' → Flow tab chưa mở hoặc chưa sẵn sàng → user cần action
      if (data?.reason === 'NO_FLOW_TAB') {
        const msg = (window.I18n?.t('msg.uploadPendingNoFlowTab')
          || 'Upload đang chờ — vui lòng mở tab Google Flow rồi thử lại.');
        window.showNotification(msg, 'warning');
      }
    });
  }

  // Cleanup timer khi window đóng
  window.addEventListener('unload', stopSyncPolling);

  // ========================================================================
  // [2026-06-13] Cảnh báo khi user mở > 1 tab Google Flow trong workflow editor.
  // Mục đích: tránh upload/gen vào sai project. User click "Đóng" trên tab thừa.
  // Chạy 1 lần per workflow editor session (không spam khi user mở/đóng editor).
  // ========================================================================
  setTimeout(_warnMultipleFlowTabs, 600);

  async function _warnMultipleFlowTabs() {
    console.log('[FlowMultiTabWarning] check start');
    try {
      if (!chrome.tabs?.query) { console.warn('[FlowMultiTabWarning] chrome.tabs.query unavailable'); return; }
      // Query rộng hơn để catch tất cả Flow URLs (homepage / project / tools)
      const tabs = await chrome.tabs.query({ url: ['https://labs.google/fx/*', 'https://labs.google/fx'] });
      console.log('[FlowMultiTabWarning] Found Flow tabs:', tabs?.map(t => ({ id: t.id, url: t.url, title: t.title })));
      if (!tabs || tabs.length <= 1) { console.log('[FlowMultiTabWarning] Skip — ≤1 tab'); return; }

      // Get current target tab ID — popup đọc từ storage.session (set bởi sidebar)
      let currentId = null;
      try {
        const stored = await chrome.storage?.session?.get('targetFlowTabId');
        currentId = stored?.targetFlowTabId || null;
      } catch (_) { globalThis.SEOSONA_swallow?.('workflow-editor-init#_warnMultipleFlowTabs', _); }

      // Build overlay
      const I = window.I18n;
      const title = (I?.t('flowMultiTab.title') || 'Phát hiện nhiều tab Google Flow');
      const desc = (I?.t('flowMultiTab.desc', { count: tabs.length }) ||
        `Bạn đang mở <strong>${tabs.length}</strong> tab Google Flow. Để tránh upload/gen vào sai project, vui lòng đóng các tab không cần thiết.`);
      const currentLabel = (I?.t('flowMultiTab.current') || 'Đang dùng');
      const closeLabel = (I?.t('flowMultiTab.close') || 'Đóng');
      const dismissLabel = (I?.t('flowMultiTab.dismiss') || 'Đã hiểu');

      const escHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      const buildRows = (tabList) => tabList.map(t => {
        const isCurrent = t.id === currentId;
        const fullTitle = t.title || `Flow Tab #${t.id}`;
        const shortTitle = fullTitle.length > 60 ? fullTitle.substring(0, 60) + '...' : fullTitle;
        return `
          <div class="tbwf-row" data-tab-row="${t.id}">
            <span class="tbwf-row-title" title="${escHtml(fullTitle)}">${escHtml(shortTitle)}</span>
            ${isCurrent
              ? `<span class="tbwf-current-badge">${escHtml(currentLabel)}</span>`
              : `<button type="button" class="tbwf-close-btn" data-close-tab="${t.id}">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" style="margin-right:4px;vertical-align:-1px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>${escHtml(closeLabel)}
                </button>`}
          </div>`;
      }).join('');

      // Inject style tag 1 lần — CSS class cho phép :hover / transition (inline style không support)
      if (!document.getElementById('tbwf-multi-tab-styles')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'tbwf-multi-tab-styles';
        styleEl.textContent = `
          #tbwf-multi-tab-overlay { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.6); }
          .tbwf-row { display:flex; align-items:center; gap:8px; padding:8px 10px; background:rgba(255,255,255,0.04); border-radius:6px; margin-bottom:6px; transition:background 0.15s ease; }
          .tbwf-row:hover { background:rgba(255,255,255,0.07); }
          .tbwf-row-title { flex:1; font-size:13px; color:rgba(255,255,255,0.85); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .tbwf-current-badge { font-size:10px; padding:2px 6px; border-radius:3px; background:rgba(25, 208, 123,0.2); color:#4be3a0; font-weight:600; }
          .tbwf-close-btn { display:inline-flex; align-items:center; font-size:11px; padding:5px 12px; border:1px solid transparent; border-radius:4px; background:rgba(239,68,68,0.15); color:#ef4444; cursor:pointer; font-weight:500; transition:background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.05s ease; font-family:inherit; }
          .tbwf-close-btn:hover { background:rgba(239,68,68,0.32); border-color:rgba(239,68,68,0.5); color:#fff; }
          .tbwf-close-btn:active { transform:scale(0.96); }
          .tbwf-close-btn:focus-visible { outline:2px solid rgba(239,68,68,0.7); outline-offset:1px; }
          #tbwf-dismiss { padding:8px 18px; border:none; border-radius:6px; background:#4f46e5; color:#fff; font-size:13px; font-weight:600; cursor:pointer; transition:background 0.15s ease, transform 0.05s ease; font-family:inherit; }
          #tbwf-dismiss:hover { background:#6366f1; }
          #tbwf-dismiss:active { transform:scale(0.97); }
          #tbwf-dismiss:focus-visible { outline:2px solid rgba(99,102,241,0.7); outline-offset:1px; }
        `;
        document.head.appendChild(styleEl);
      }

      const overlay = document.createElement('div');
      overlay.id = 'tbwf-multi-tab-overlay';
      overlay.innerHTML = `
        <div style="width:min(480px,90vw);background:#1a1a24;border:1px solid rgba(255,255,255,0.1);border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,0.6);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fff;">
          <div style="padding:14px 18px;background:rgba(251,191,36,0.12);border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span style="font-weight:600;font-size:14px;">${escHtml(title)}</span>
          </div>
          <div style="padding:16px 18px;font-size:13px;line-height:1.55;color:rgba(255,255,255,0.8);">
            <p style="margin:0 0 12px;">${desc}</p>
            <div id="tbwf-tab-list" style="max-height:240px;overflow-y:auto;">${buildRows(tabs)}</div>
          </div>
          <div style="padding:12px 18px;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:flex-end;">
            <button type="button" id="tbwf-dismiss">${escHtml(dismissLabel)}</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const closeOverlay = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
      const escHandler = (e) => { if (e.key === 'Escape') closeOverlay(); };
      document.addEventListener('keydown', escHandler);

      overlay.querySelector('#tbwf-dismiss')?.addEventListener('click', closeOverlay);

      // Event delegation cho close-tab buttons
      overlay.querySelector('#tbwf-tab-list')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-close-tab]');
        if (!btn) return;
        const tabId = parseInt(btn.getAttribute('data-close-tab'), 10);
        if (!tabId) return;
        try {
          await chrome.tabs.remove(tabId);
          // Remove row + check còn lại
          const row = overlay.querySelector(`[data-tab-row="${tabId}"]`);
          row?.remove();
          // Re-query để verify count thật + auto-close khi ≤1
          const remaining = await chrome.tabs.query({ url: 'https://labs.google/fx/*' });
          if (!remaining || remaining.length <= 1) closeOverlay();
        } catch (err) {
          console.warn('[FlowMultiTabWarning] Close tab failed:', err?.message);
        }
      });
    } catch (e) {
      console.warn('[FlowMultiTabWarning] check failed:', e?.message);
    }
  }
});
