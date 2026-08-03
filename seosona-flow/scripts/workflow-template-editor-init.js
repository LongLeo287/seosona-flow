/**
 * workflow-template-editor-init.js
 * Boot template editor in standalone window mode
 * Khởi tạo WorkflowEditor với isTemplateMode = true
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Mark body context để CSS scope đúng
  document.body.classList.add('wf-popup', 'wf-template-editor');

  // Initialize EventBus
  if (window.EventBus) {
    window.eventBus = new EventBus();
  }

  // Initialize i18n
  if (window.I18n) {
    await window.I18n.init();
    window.I18n.applyTranslations(document.body);
  }

  // Listen for i18n changes from storage (cross-window sync)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.af_locale && window.I18n) {
      window.I18n.setLocale(changes.af_locale.newValue, false);
      window.I18n.applyTranslations(document.body);
    }
  });

  // Wait for StorageSettings to load settings
  if (window.storageSettings) {
    await window.storageSettings.loadAndApply();
    console.log('[TemplateEditorInit] StorageSettings ready');
  }

  // Background fetch ChatGPT + Grok error patterns
  try { window.ChatGPTConfig?.fetchInBackground?.(); } catch (e) { /* ignore */ }
  try { window.GrokConfig?.fetchInBackground?.(); } catch (e) { /* ignore */ }

  // Initialize AuthManager first
  if (window.authManager) {
    await window.authManager.init();
    console.log('[TemplateEditorInit] AuthManager ready, logged in:', window.authManager.isLoggedIn());
  }

  // Bug 20+21 fix: Connect SSE in follower mode để nhận admin update events
  if (window.SseClient && window.authManager?.isLoggedIn()) {
    try {
      await window.SseClient.connect();
      console.log('[TemplateEditorInit] SseClient connected (follower mode expected)');
    } catch (e) {
      console.warn('[TemplateEditorInit] SseClient connect failed:', e?.message);
    }
  }

  // Initialize RequestCoalescer for popup window coordination
  if (window.RequestCoalescer) {
    window.RequestCoalescer.init();
    console.log('[TemplateEditorInit] RequestCoalescer ready, isLeader:', window.RequestCoalescer.isLeader());
  }

  // Initialize StorageManager
  if (window.storageManager) {
    await window.storageManager.init();
    console.log('[TemplateEditorInit] StorageManager mode:', window.storageManager.getMode());
  }

  // Initialize FeatureGate
  if (window.featureGate) {
    await window.featureGate.init();
    try {
      if (!window.featureGate._isCacheValid?.() && window.featureGate.refresh) {
        await window.featureGate.refresh();
      }
    } catch (err) {
      console.warn('[TemplateEditorInit] FeatureGate refresh failed, dùng cache:', err.message);
    }
    console.log('[TemplateEditorInit] FeatureGate ready, canManageTemplates:', window.featureGate.canManageWorkflowTemplates?.());
  }

  // Pre-fetch plans — BỎ QUA ở local mode (không có backend → tránh spam "plans fetch failed").
  if (self.SEOSONA_LOCAL_MODE !== false) {
    window._cachedPlans = Array.isArray(window._cachedPlans) ? window._cachedPlans : [];
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
      console.warn('[TemplateEditorInit] Fetch plans failed:', err.message);
    }
  }

  // Apply SystemConfig
  if (window.SystemConfig) {
    await SystemConfig.restoreFromStorage();
    SystemConfig.applyToUI();
  }

  // Initialize PendingUploadStore
  try {
    if (window.PendingUploadStore) {
      await PendingUploadStore.restore();
      await PendingUploadStore.restoreCache();
      await PendingUploadStore.restoreLightweight();
      console.log('[TemplateEditorInit] PendingUploadStore restored');
    }
  } catch (e) {
    console.error('[TemplateEditorInit] PendingUploadStore error:', e);
  }

  // Bug 38 fix (2026-05-19): Fetch PCM api_configs trước khi render node settings.
  try {
    if (window.ProviderConfigManager?._fetchApiConfigs) {
      await window.ProviderConfigManager._fetchApiConfigs();
      console.log('[TemplateEditorInit] PCM api_configs fetched');
    }
  } catch (e) {
    console.warn('[TemplateEditorInit] PCM api_configs fetch failed:', e?.message);
  }

  // Fetch workflow node types from server
  try {
    if (window.NodeTemplates?.fetchFromServer) {
      window.NodeTemplates.clearServerCache?.();
      await window.NodeTemplates.fetchFromServer().catch((err) => {
        console.warn('[TemplateEditorInit] NodeTemplates.fetchFromServer failed:', err?.message);
      });
    }
  } catch (e) {
    console.warn('[TemplateEditorInit] NodeTemplates fetch error:', e);
  }

  // Create WorkflowEditor instance
  console.log('[TemplateEditorInit] Creating WorkflowEditor for template mode...');
  let editor;
  try {
    editor = new WorkflowEditor();
    window.workflowEditor = editor;
    console.log('[TemplateEditorInit] WorkflowEditor created');
  } catch (e) {
    console.error('[TemplateEditorInit] WorkflowEditor constructor error:', e);
    return;
  }

  // Override _hideSidebar/_showSidebar for standalone mode
  editor._hideSidebar = () => {};
  editor._showSidebar = () => {};

  // Override close: in standalone mode, close browser window on explicit user action
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

  // Notify sidebar when window is about to close
  window.addEventListener('unload', () => {
    chrome.runtime.sendMessage({ action: 'templateEditorClosed' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('workflow-template-editor-init#render', _e); });
  });

  // Parse URL params to determine mode
  const urlParams = new URLSearchParams(window.location.search);
  const templateId = urlParams.get('templateId');
  const mode = urlParams.get('mode') || (templateId ? 'edit' : 'create');

  console.log('[TemplateEditorInit] Mode:', mode, 'TemplateId:', templateId);

  // Check for pending template data in storage (passed from sidebar)
  let pendingData = null;
  try {
    const stored = await new Promise(resolve => {
      chrome.storage.local.get(['_pendingTemplate'], result => resolve(result));
    });
    if (stored._pendingTemplate) {
      pendingData = stored._pendingTemplate;
      // Clear pending data
      chrome.storage.local.remove('_pendingTemplate');
      console.log('[TemplateEditorInit] Loaded pending template data:', pendingData.name || pendingData.id);
    }
  } catch (e) {
    console.error('[TemplateEditorInit] Error loading pending template:', e);
  }

  // Set template mode
  editor.isTemplateMode = true;

  if (mode === 'edit' && (pendingData || templateId)) {
    // Edit existing template
    try {
      let template = null;

      // Race condition fix: pendingData có thể bị overwrite nếu user click nhanh trên nhiều templates.
      // Chỉ dùng pendingData nếu ID khớp với templateId trong URL.
      if (pendingData && templateId && String(pendingData.id) === String(templateId)) {
        template = pendingData;
        console.log('[TemplateEditorInit] Using cached pendingData for template:', templateId);
      } else if (templateId) {
        // Fetch from API nếu không có pendingData hoặc ID không khớp
        console.log('[TemplateEditorInit] Fetching template from API:', templateId);
        template = await fetchTemplateById(templateId);
      } else if (pendingData) {
        // Fallback: dùng pendingData nếu không có templateId (edge case)
        template = pendingData;
        console.log('[TemplateEditorInit] Using pendingData (no templateId in URL)');
      }

      if (!template) {
        throw new Error(window.I18n?.t('workflow.templateNotFound') || 'Không tìm thấy template');
      }

      console.log('[TemplateEditorInit] Opening template for edit:', template.id, template.name);
      // [Creator Page] Cờ _creator_edit (affiliate sửa community template) → route creator path
      // (gate affiliate + save → creator endpoint), KHÔNG dùng openTemplateForEdit (gate admin).
      if (template._creator_edit && editor.openCreatorTemplateForEdit) {
        editor.openCreatorTemplateForEdit(template);
      } else {
        editor.openTemplateForEdit(template);
      }

    } catch (err) {
      console.error('[TemplateEditorInit] Error loading template:', err);
      window.showNotification?.(
        err.message || (window.I18n?.t('workflow.loadTemplateFailed') || 'Không thể tải template'),
        'error'
      );
      // Fallback to create mode
      openCreateMode(editor);
    }
  } else {
    // Create new template
    openCreateMode(editor);
  }

  console.log('[TemplateEditorInit] Template editor ready');

  // Listen for template reload messages from sidebar
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'loadTemplateInEditor' && message.data) {
      const d = message.data;
      if (d.mode === 'edit' && d.template) {
        if (d.template._creator_edit && editor.openCreatorTemplateForEdit) {
          editor.openCreatorTemplateForEdit(d.template);
        } else {
          editor.openTemplateForEdit(d.template);
        }
      } else {
        openCreateMode(editor);
      }
    }
  });

  // ===== Entitlements sync =====
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.af_entitlements && window.featureGate) {
      const newData = changes.af_entitlements.newValue;
      if (newData?.entitlements) {
        window.featureGate.entitlements = newData.entitlements;
        window.featureGate.plan = newData.plan || window.featureGate.plan;
      }
      window.eventBus?.emit('featuregate:refreshed', {
        plan: newData?.plan,
        entitlements: newData?.entitlements
      });
    }
  });
});

/**
 * Fetch template by ID from API
 * @param {string|number} templateId
 * @returns {Promise<Object>}
 */
async function fetchTemplateById(templateId) {
  return new Promise((resolve, reject) => {
    if (window.authManager?.isLoggedIn()) {
      window.authManager._apiCall('GET', `workflow-templates/${templateId}`)
        .then(result => resolve(result?.data || result))
        .catch(reject);
    } else {
      chrome.runtime.sendMessage({
        action: 'apiRequest',
        method: 'GET',
        endpoint: `workflow-templates/${templateId}`
      }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (resp?.success) {
          resolve(resp.data);
        } else {
          reject(new Error(resp?.error?.message || 'API Error'));
        }
      });
    }
  });
}

/**
 * Open editor in create mode for new template
 * @param {WorkflowEditor} editor
 */
function openCreateMode(editor) {
  const t = (key) => window.I18n?.t(key) || key;

  editor.templateId = null;
  editor.templateData = {
    name: t('workflow.newTemplateName') || 'Template mới',
    description: '',
    category_id: null,
    thumbnail_url: null,
    is_premium: false,
    is_featured: false,
    is_published: true, // Frontend uses is_published, convert to is_active when saving
  };
  editor.mode = 'create';
  editor.workflow = {
    wf_id: 'template_new_' + Date.now(),
    wf_name: t('workflow.newTemplateName') || 'Template mới',
    description: '',
    status: 'idle',
    enabled: true,
    settings: {},
    settings_json: {},
    nodes: [],
    edges: [],
  };
  editor.selectedNodeId = null;
  editor.render();
  editor.initComponents();
  editor.bindEvents();
  editor._updateQuotaDisplay?.();
  editor._hasUnsavedChanges = false;

  console.log('[TemplateEditorInit] Opened in create mode');
}
