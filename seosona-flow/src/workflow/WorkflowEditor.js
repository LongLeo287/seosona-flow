/**
 * WorkflowEditor - Modal editor cho workflow với DiagramCanvas và NodeForm
 *
 * Editor Modes:
 * - WORKFLOW_CREATE: Tạo workflow mới
 * - WORKFLOW_EDIT: Chỉnh sửa workflow đã có
 * - SHARED_PREVIEW: Xem workflow được chia sẻ (read-only)
 * - TEMPLATE_PREVIEW: Xem template (read-only)
 * - TEMPLATE_CREATE: Tạo template mới (admin)
 * - TEMPLATE_EDIT: Chỉnh sửa template (admin)
 */

// Editor Mode Enum
const EditorMode = {
  WORKFLOW_CREATE: 'workflow_create',
  WORKFLOW_EDIT: 'workflow_edit',
  SHARED_PREVIEW: 'shared_preview',
  ADMIN_PREVIEW: 'admin_preview',
  TEMPLATE_PREVIEW: 'template_preview',
  TEMPLATE_CREATE: 'template_create',
  TEMPLATE_EDIT: 'template_edit',
};

// Permission matrix for each mode
const EditorPermissions = {
  [EditorMode.WORKFLOW_CREATE]: {
    canEdit: true,
    canSave: true,
    canRun: false,      // Chưa có wf_id
    canShare: false,    // Chưa có wf_id
    canReset: false,    // Chưa có gì để reset
    canExport: false,   // Chưa có gì để export
    canDelete: false,
    showLog: false,
    showQuota: true,
    showToggle: false,  // Chưa có workflow
  },
  [EditorMode.WORKFLOW_EDIT]: {
    canEdit: true,
    canSave: true,
    canRun: true,
    canShare: true,     // Cần check featureGate
    canReset: true,
    canExport: true,
    canDelete: true,
    showLog: true,
    showQuota: true,
    showToggle: true,
  },
  [EditorMode.SHARED_PREVIEW]: {
    canEdit: false,
    canSave: false,
    canRun: false,
    canShare: false,
    canReset: false,
    canExport: true,    // Cho phép export để copy
    canDelete: false,
    showLog: false,
    showQuota: false,
    showToggle: false,
  },
  [EditorMode.ADMIN_PREVIEW]: {
    canEdit: false,
    canSave: false,
    canRun: false,
    canShare: false,
    canReset: false,
    canExport: true,    // Cho phép export để xem cấu trúc
    canDelete: false,
    showLog: true,      // Admin có thể xem log
    showQuota: false,
    showToggle: false,
  },
  [EditorMode.TEMPLATE_PREVIEW]: {
    canEdit: false,
    canSave: false,
    canRun: false,
    canShare: false,
    canReset: false,
    canExport: false,
    canDelete: false,
    showLog: false,
    showQuota: false,
    showToggle: false,
  },
  [EditorMode.TEMPLATE_CREATE]: {
    canEdit: true,
    canSave: true,
    canRun: false,      // Template không run
    canShare: false,
    canReset: false,
    canExport: false,
    canDelete: false,
    showLog: false,
    showQuota: false,   // Template không có quota
    showToggle: false,
  },
  [EditorMode.TEMPLATE_EDIT]: {
    canEdit: true,
    canSave: true,
    canRun: false,      // Template không run
    canShare: false,
    canReset: false,
    canExport: false,
    canDelete: true,
    showLog: false,
    showQuota: false,
    showToggle: false,
  },
};

class WorkflowEditor {
  static _TILE_CACHE_MAX = 100;
  static REF_LIMIT_VIDEO = 3;   // Video Ingredients: tối đa 3 ref images
  static REF_LIMIT_IMAGE = 10;  // Image: tối đa 10 ref images

  // Phase 1 — Node Reference System: Slug constants
  static RESERVED_SLUGS = [
    'all', 'none', 'self', 'this', 'null', 'undefined',
    'true', 'false', 'new', 'delete', 'default'
  ];
  // Phase 6: Migrated to server config (workflow_node_types.config.ui.supports_slug)
  // Fallback array for cold start before server config loads
  static _FALLBACK_MENTIONABLE_TYPES = ['image', 'text', 'text_extract', 'generate', 'chatgpt', 'grok', 'prompt', 'prompt_sequence', 'variant_expand', 'loop', 'text_template', 'random_pick']; // Fix audit #6
  static SLUG_MAX_LENGTH = 30;
  static SLUG_PATTERN = /^[a-z][a-z0-9_]{0,29}$/;
  // Phase 2 — Node Reference System: Max mentions limit per prompt
  static MAX_MENTIONS_PER_PROMPT = 20;

  constructor() {
    this.mode = 'create';           // Legacy: 'create' | 'edit' | 'view'
    this.editorMode = EditorMode.WORKFLOW_CREATE;  // New: EditorMode enum
    this.workflow = null;
    this.overlay = null;
    this.diagramCanvas = null;
    this.selectedNodeId = null;
    // [U2] Nhận prompt từ chuột phải "Phân tích → Gửi vào node" (staging qua storage). onChanged bắt
    // khi editor ĐANG mở; setTimeout drain 1 lần cho case đã stage TRƯỚC khi mở editor.
    try {
      this._i2pNodeDrain = (changes, area) => {
        if (area === 'local' && changes.i2p_pending_node_prompt && changes.i2p_pending_node_prompt.newValue) {
          this._drainPendingNodePrompt();
        }
      };
      chrome.storage.onChanged.addListener(this._i2pNodeDrain);
      setTimeout(() => { try { this._drainPendingNodePrompt(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_i2pNodeDrain', _); } }, 1500);
    } catch (_) { /* storage optional */ }
    // [P2.2] Alias shared cache (TileCache.js window.tileCache) — executor/run-host đọc chung,
    // hết coupling window.workflowEditor. Fallback Map riêng nếu module chưa load (backward-compat).
    this._tileCache = (window.tileCache instanceof Map) ? window.tileCache : new Map(); // fileId -> { thumbnail, type }
    this._hasUnsavedChanges = false;
    // Mouse position tracking for smart node placement
    this._lastMouseCanvasPos = null; // { x, y } - last known mouse position on diagram canvas
    // S2.5: Track upload keys tạo trong form editor để cleanup khi close/cancel
    this._formUploadKeys = new Set();
    // Reset guard: block node:completed/failed events during reset to prevent race condition
    this._resetInProgress = false;
    // Flag: bypass unsaved changes dialog when node is being deleted
    this._nodeBeingDeleted = false;

    // [Fix] Initialize saving state flags to prevent play button locked on first load
    this._isSaving = false;
    this._deferredSaveTimer = null;
    this._inlineSaveTimer = null; // Debounce for inline setting changes (800ms)
    this._skipDeferredSave = false;
    this._pendingSaveRequest = false;

    // v1.1 Node clipboard (Ctrl+C / Ctrl+V) — in-memory single slot, in-instance only.
    // Cross-workflow paste disabled by design (scope v1).
    this._nodeClipboard = null; // { data: {...} }

    // EWT-6: Template mode properties - cho phép admin edit workflow templates
    this.isTemplateMode = false;      // Legacy: Đang edit template hay workflow thông thường
    this.templateId = null;           // ID của template đang edit (nếu isTemplateMode = true)
    this.isCreatorTemplate = false;   // [Creator Page] true = affiliate sửa community template (save → creator endpoint)
    this.templateData = null;         // Metadata của template (name, category, description, etc.)

    this.bindGlobalEvents();
  }

  _tileCacheSet(key, value) {
    if (this._tileCache.has(key)) {
      this._tileCache.delete(key);
    }
    this._tileCache.set(key, value);
    if (this._tileCache.size > WorkflowEditor._TILE_CACHE_MAX) {
      const oldest = this._tileCache.keys().next().value;
      this._tileCache.delete(oldest);
    }
  }

  /**
   * 2026-06-03: Check `window.imagePickerModal` ready + show user-facing error nếu thiếu.
   * Bug report: 1-2 user cá biệt click button Add ref image nhưng modal không mở.
   * Root cause khả thi nhất: ImagePickerModal.js load fail (network/cache/browser) → silent skip.
   * Trước fix: `if (!window.imagePickerModal) return;` → silent fail, user không biết tại sao.
   * Sau fix: log chi tiết + show dialog/toast hướng dẫn user reload.
   *
   * @returns {boolean} true nếu modal ready, false nếu thiếu (đã hiện error cho user)
   */
  _ensureImagePickerReady() {
    if (window.imagePickerModal && typeof window.imagePickerModal.open === 'function') {
      return true;
    }
    // Log chi tiết cho diagnose user-cá-biệt
    console.error('[WorkflowEditor] ImagePickerModal chưa sẵn sàng:', {
      windowImagePickerModal: typeof window.imagePickerModal,
      windowImagePickerModalClass: typeof window.ImagePickerModal,
      hasOpenMethod: window.imagePickerModal && typeof window.imagePickerModal.open === 'function',
      documentReadyState: document.readyState,
    });
    const msg = window.I18n?.t('workflow.imagePickerNotReady')
      || 'Tính năng chọn ảnh chưa sẵn sàng. Vui lòng reload extension (chrome://extensions → Reload) hoặc đóng/mở lại cửa sổ này.';
    if (window.customDialog && typeof window.customDialog.alert === 'function') {
      window.customDialog.alert(msg, {
        type: 'error',
        title: window.I18n?.t('workflow.imagePickerNotReadyTitle') || 'Lỗi tải tài nguyên',
      });
    } else if (typeof window.showNotification === 'function') {
      window.showNotification(msg, 'error', 6000);
    } else {
      alert(msg);
    }
    return false;
  }

  /**
   * 2026-06-03: Hiển thị error rõ ràng khi ImmediateUploader.upload fail.
   * Trước fix: chỉ console.error → user thấy "loading mãi" không hiểu.
   * Sau fix: toast/dialog với reason + hint check Flow tab.
   *
   * @param {Error} err - Error từ catch
   * @param {string} source - Identifier ngắn (vd 'Prompt', 'ChatGPT', 'Grok', 'Image node')
   */
  _handleUploadError(err, source) {
    console.error(`[WorkflowEditor] ${source} upload failed:`, err);
    const reason = err?.message || (window.I18n?.t('common.unknownError') || 'Lỗi không xác định');
    const baseMsg = window.I18n?.t('workflow.uploadFailedDetail', { source, reason })
      || `Upload ảnh ${source} thất bại: ${reason}. Hãy đảm bảo tab Google Flow đang mở + login.`;
    if (typeof window.showNotification === 'function') {
      window.showNotification(baseMsg, 'error', 6000);
    } else if (window.customDialog && typeof window.customDialog.alert === 'function') {
      window.customDialog.alert(baseMsg, {
        type: 'error',
        title: window.I18n?.t('workflow.uploadFailedTitle') || 'Upload thất bại',
      });
    }
  }

  /**
   * Guard upload ref ảnh: upload lên Flow CẦN 1 project đang mở. Nếu Flow tab đang ở homepage
   * (no project active) → hiện modal rõ ràng + nút đi tới project (workflow.project_id) / mở Flow,
   * KHÔNG upload (tránh fail im lặng chỉ hiện ⚠️ trên node).
   * @returns {Promise<boolean>} true = có project (cho upload); false = đã chặn + cảnh báo.
   */
  async _ensureFlowProjectOrWarn() {
    // Live-check (KHÔNG tin window._currentProjectId — có thể stale khi tab sang homepage).
    if (await window.ProjectHelper?.hasActiveProject?.()) return true;
    await window.ProjectHelper?.warnNoProjectForUpload?.(this.workflow?.project_id || null);
    return false;
  }

  /**
   * 2026-05-31 Rescan Tier 2: rescan thumbnail của 1 ref bị broken.
   * Click handler từ rescan button trong _renderNodeRefPreviewInner.
   *
   * Flow:
   *  1. Disable button + show spinner state
   *  2. Activate Flow tab (nếu chưa mở)
   *  3. Call MessageBridge.getThumbnailsByIds([refId]) — probe backend/DOM
   *  4. Success: cập nhật cache + re-render preview
   *  5. Fail 2 lần: mark _permanently_broken trong cache → render warning icon
   */
  async _rescanRefThumbnail(refId, btnEl) {
    if (!refId) return;
    if (!btnEl) btnEl = this.overlay?.querySelector(`[data-ref-rescan-id="${CSS.escape(refId)}"]`);
    // Disable button + spinner state
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.classList.add('ref-thumb-rescan-btn--loading');
    }
    try {
      // Activate Flow tab nếu cần
      try {
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => resolve());
        });
      } catch (_) { /* non-blocking */ }
      // Probe thumbnails — MessageBridge gửi cmd 'getThumbnailsByIds' qua content script
      let scanResult = null;
      if (typeof MessageBridge !== 'undefined' && MessageBridge.getThumbnailsByIds) {
        scanResult = await MessageBridge.getThumbnailsByIds([refId]).catch(() => null);
      }
      const info = scanResult?.results?.[refId];
      if (info?.thumbnail) {
        // Success — cập nhật cache + re-render
        const existingCache = this._tileCache.get(refId);
        this._tileCacheSet(refId, {
          thumbnail: info.thumbnail,
          type: info.type || existingCache?.type || 'image',
          ...(info.file_name && { file_name: info.file_name }),
          ...(info.video_url && { video_url: info.video_url }),
        });
        // Re-render all ref previews (right sidebar + node card)
        const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds')
          || this.overlay?.querySelector('#promptNodeRefFileIds')
          || this.overlay?.querySelector('#chatgptImageRefFileIds')
          || this.overlay?.querySelector('#grokNodeRefFileIds')
          || this.overlay?.querySelector('#imageNodeRefFileIds');
        if (fileIdsInput?.value) {
          this._renderNodeRefPreview(fileIdsInput.value);
        }
        // Cũng update node card diagram
        if (this.selectedNodeId) {
          try { this._showNodeRefPreview(this.selectedNodeId, fileIdsInput?.value?.split(',').map(s => s.trim()).filter(Boolean) || []); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_rescanRefThumbnail', _); }
        }
        return;
      }
      // Fail — tăng counter, mark permanent broken sau 2 lần
      const existingCache = this._tileCache.get(refId) || {};
      const failCount = (existingCache._rescan_fail_count || 0) + 1;
      this._tileCacheSet(refId, {
        ...existingCache,
        _rescan_fail_count: failCount,
        _permanently_broken: failCount >= 2,
      });
      // Re-render để hiện warning icon nếu permanent
      const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds')
        || this.overlay?.querySelector('#promptNodeRefFileIds')
        || this.overlay?.querySelector('#chatgptImageRefFileIds')
        || this.overlay?.querySelector('#grokNodeRefFileIds')
        || this.overlay?.querySelector('#imageNodeRefFileIds');
      if (fileIdsInput?.value) {
        this._renderNodeRefPreview(fileIdsInput.value);
      }
      if (typeof window.showNotification === 'function') {
        window.showNotification(
          window.I18n?.t('workflow.thumbRescanFailed') || 'Rescan thất bại — tile có thể đã bị xóa khỏi Flow',
          failCount >= 2 ? 'error' : 'warning',
          3500
        );
      }
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.classList.remove('ref-thumb-rescan-btn--loading');
      }
    }
  }

  /**
   * 2026-05-31 Rescan Tier 1: auto-recover broken thumbnails khi Flow tab activate
   * hoặc khi workflow editor mở. Silent batch scan — không show notification.
   * Trigger:
   *  - tab activated (Flow tab) — listen background message
   *  - workflow editor open initial mount
   *  - SSE refresh event (workflow_changed)
   */
  async _autoRescanBrokenThumbs({ force = false } = {}) {
    if (!this.overlay || !this.diagramCanvas?.editor) return;
    // Throttle 3s (giảm từ 10s) — đủ tránh spam nhưng cho phép trigger nhanh khi user
    // mở sidebar ngay sau workflow load. force=true bypass (vd user explicit click).
    const now = Date.now();
    if (!force && this._lastAutoRescanAt && (now - this._lastAutoRescanAt) < 3000) return;
    this._lastAutoRescanAt = now;
    // Collect broken IDs từ TẤT CẢ nodes có ref_file_ids
    const homeData = this.diagramCanvas.editor.drawflow?.drawflow?.Home?.data || {};
    const brokenIds = new Set();
    for (const node of Object.values(homeData)) {
      const refStr = node?.data?.ref_file_ids || '';
      if (!refStr) continue;
      const ids = refStr.split(',').map(s => s.trim()).filter(Boolean);
      for (const id of ids) {
        if (id.startsWith('upload_')) continue; // pending uploads — skip
        const cached = this._tileCache.get(id);
        if (cached?._permanently_broken) continue;
        // Broken khi: không có thumbnail VÀ không có video_url VÀ không có DOM tile.
        // Video tile chỉ có video_url cũng đủ render → không cần rescan.
        const hasRenderableCache = cached?.thumbnail || cached?.video_url;
        if (!hasRenderableCache && !document.querySelector(`[data-tile-id="${CSS.escape(id)}"]`)) {
          brokenIds.add(id);
        }
      }
    }
    if (brokenIds.size === 0) return;
    console.log('[WorkflowEditor] Auto-rescan broken thumbs:', brokenIds.size);
    if (typeof MessageBridge === 'undefined' || !MessageBridge.getThumbnailsByIds) return;
    try {
      const result = await MessageBridge.getThumbnailsByIds([...brokenIds]).catch(() => null);
      const results = result?.results || {};
      let updatedCount = 0;
      for (const [fid, info] of Object.entries(results)) {
        // 2026-05-31 fix: KHÔNG skip nếu chỉ có video_url (video tile no poster).
        // Trước: `if (!info?.thumbnail) continue` → bỏ qua video tile → user vẫn thấy broken.
        if (!info || (!info.thumbnail && !info.video_url)) continue;
        const existing = this._tileCache.get(fid) || {};
        this._tileCacheSet(fid, {
          ...existing,
          thumbnail: info.thumbnail || existing.thumbnail || '',
          type: info.type || existing.type || 'image',
          ...(info.file_name && { file_name: info.file_name }),
          ...(info.video_url && { video_url: info.video_url }),
        });
        updatedCount++;
      }
      if (updatedCount > 0) {
        console.log(`[WorkflowEditor] Auto-rescan: ${updatedCount}/${brokenIds.size} broken thumbs recovered`);
        // 2026-05-31: re-render TẤT CẢ ref preview inputs (trước chỉ first match) — workflow
        // có thể có nhiều node types open form khác nhau.
        const refInputSelectors = ['#nodeRefFileIds', '#promptNodeRefFileIds',
          '#chatgptImageRefFileIds', '#grokNodeRefFileIds', '#imageNodeRefFileIds'];
        for (const sel of refInputSelectors) {
          const inp = this.overlay?.querySelector(sel);
          if (inp?.value) {
            try { this._renderNodeRefPreview(inp.value); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_autoRescanBrokenThumbs', _); }
          }
        }
        // Re-render all node cards trên canvas
        for (const node of Object.values(homeData)) {
          const refStr = node?.data?.ref_file_ids || '';
          if (refStr) {
            const ids = refStr.split(',').map(s => s.trim()).filter(Boolean);
            try { this._showNodeRefPreview(node.data.node_id, ids); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_autoRescanBrokenThumbs', _); }
          }
        }
      }
    } catch (e) {
      console.warn('[WorkflowEditor] Auto-rescan failed (non-blocking):', e?.message);
    }
  }

  /**
   * Rescan THỦ CÔNG toàn bộ thumbnail từ Flow (nút header data-action="rescan-thumbnails").
   * Use case: mở workflow lúc trang Flow chưa render đủ tiles → node thiếu preview_thumbnail.
   *
   * QUAN TRỌNG: phải gọi `_backgroundThumbnailScan` (quét CẢ result_file_ids preview chính LẪN
   * ref_file_ids) — đây là method chạy lúc mở workflow, nên tắt/mở lại mới load được. Trước chỉ
   * gọi `_autoRescanBrokenThumbs` (CHỈ ref images) → preview kết quả không refresh → nút vô tác dụng.
   */
  async _rescanAllThumbnails() {
    const btn = this.overlay?.querySelector('.seosonaflow-wf-tool-btn[data-action="rescan-thumbnails"]');
    if (btn?.classList.contains('seosonaflow-wf-tool-btn--spinning')) return;
    btn?.classList.add('seosonaflow-wf-tool-btn--spinning');
    try {
      // 1) Ensure Flow page render đủ tiles (scroll/load) — như flow lúc mở workflow.
      if (window.MessageBridge?.prepareFlowForScan) {
        try { await window.MessageBridge.prepareFlowForScan(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_rescanAllThumbnails', _); }
      } else {
        try { await window.MessageBridge?.sendToContentScript?.('ensureFlowTilesLoaded'); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_rescanAllThumbnails', _); }
      }
      // 2) Reset throttle để scan chạy ngay (tránh skip do _lastAutoRescanAt gần đây).
      this._lastAutoRescanAt = 0;
      // 3) Re-render NGAY từ cache cho mọi node — xử case tile đã cache nhưng DOM preview rỗng
      //    (_backgroundThumbnailScan return sớm khi missingIds=0 → không tự re-render).
      try { this._directRenderFromCache(this.workflow.nodes || []); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_rescanAllThumbnails', _); }
      // 4) Scan TOÀN DIỆN result + ref preview (đúng method chạy lúc mở workflow → reopen mới work).
      this._backgroundThumbnailScan();
      // 5) Bồi thêm broken-ref edge cases (force bypass throttle).
      await this._autoRescanBrokenThumbs({ force: true });
      window.showNotification?.(window.I18n?.t('workflow.rescanDone') || 'Đã quét lại ảnh từ Flow', 'success');
    } catch (e) {
      console.warn('[WorkflowEditor] _rescanAllThumbnails failed:', e?.message);
      window.showNotification?.(window.I18n?.t('workflow.rescanFailed') || 'Quét lại ảnh thất bại', 'error');
    } finally {
      // Spin lâu hơn vì _backgroundThumbnailScan có delay ~1500ms nội bộ.
      setTimeout(() => btn?.classList.remove('seosonaflow-wf-tool-btn--spinning'), 2200);
    }
  }


  /**
   * Update feature-gated toggles in currently open node form
   */
  _updateNodeFeatureToggles() {
    const canUse = window.featureGate?.canUse('auto_download') ?? false;

    // Generate/List node: auto_download toggle
    const nodeAutoDownload = this.overlay?.querySelector('#nodeAutoDownload');
    if (nodeAutoDownload) {
      const label = nodeAutoDownload.closest('.toolbar-toggle');
      if (label) {
        if (canUse) {
          nodeAutoDownload.disabled = false;
          label.classList.remove('feature-disabled');
          label.removeAttribute('title');
          (label.querySelector('.premium-crown') || label.parentElement?.querySelector('.premium-crown'))?.remove();
        } else {
          nodeAutoDownload.disabled = true;
          nodeAutoDownload.checked = false;
          label.classList.add('feature-disabled');
          label.setAttribute('title', window.I18n?.t('workflow.featureDisabled') || 'Tính năng này yêu cầu gói Premium');
          // Add crown icon
          if (typeof window._ensurePremiumCrown === 'function') {
            window._ensurePremiumCrown(label);
          }
          // Hide resolution wrappers
          this.overlay?.querySelector('#nodeDownloadResWrap')?.classList.add('hidden');
          this.overlay?.querySelector('#nodeVideoDownloadResWrap')?.classList.add('hidden');
        }
      }
    }

    // Download node: gate warning banner
    const downloadGate = this.overlay?.querySelector('#nodeDownloadGate');
    if (downloadGate) {
      downloadGate.classList.toggle('hidden', canUse);
    }

    // Telegram node: gate warning banner
    const telegramGate = this.overlay?.querySelector('#nodeTelegramGate');
    if (telegramGate) {
      const canUseTelegram = (window.featureGate?.canUse('telegram_enabled') ?? false) &&
        (window.featureGate?.canUse('telegram_workflow') ?? false);
      telegramGate.classList.toggle('hidden', canUseTelegram);
    }
  }

  /**
   * Bug 30 fix (2026-05-19): Update toolbar lock state cho share + export buttons khi
   * entitlements thay đổi (vd user upgrade plan qua admin push SSE).
   * Targeted DOM patch — KHÔNG re-render full toolbar.
   */
  _updateToolbarLockStates() {
    if (!this.overlay) return;

    // Map: button data-action → feature key + lock SVG + normal SVG
    const buttons = [
      {
        action: 'share-workflow',
        featureKey: 'workflow_share_enabled',
        normalSvg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
      },
      {
        action: 'export-workflow',
        featureKey: 'workflow_export',
        normalSvg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      },
    ];
    const lockSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warning, #f59e0b)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';

    for (const { action, featureKey, normalSvg } of buttons) {
      const btn = this.overlay.querySelector(`.seosonaflow-wf-tool-btn[data-action="${action}"]`);
      if (!btn) continue;
      const canUse = window.featureGate?.canUse(featureKey) ?? false;
      btn.classList.toggle('seosonaflow-wf-tool-btn--locked', !canUse);
      btn.innerHTML = canUse ? normalSvg : lockSvg;
    }
  }

  /**
   * Targeted DOM patch cho gate banner trong node form (chatgpt, prompt).
   * KHÔNG re-render full form → giữ nguyên user input chưa save (textarea/input).
   * Idempotent — gọi nhiều lần OK.
   */
  _patchNodeFormGateBanners(type) {
    const formPanel = this.overlay?.querySelector('#nodeFormPanel');
    if (!formPanel || formPanel.classList.contains('hidden')) return;

    if (type === 'chatgpt') {
      const banner = formPanel.querySelector('#chatgptImageGateBanner');
      const canUseChatGPT = !!(window.featureGate?.canUse?.('chatgpt_enabled'));
      if (banner) {
        banner.classList.toggle('hidden', canUseChatGPT);
      }
      // Nếu banner chưa tồn tại nhưng giờ cần show → skip (rare case, sẽ render đúng lần mở form sau)
    }

    if (type === 'prompt') {
      // AI Agent rename (2026-05-30): canUseAiAgent() check key 'ai_agent_enabled' duy nhất.
      const canEnhance = !!(window.featureGate?.canUseAiAgent?.());
      const canChatGPT = !!(window.featureGate?.canUse?.('chatgpt_enabled'));
      const canGemini = !!(window.featureGate?.canUse?.('gemini_enabled'));

      // Toggle use_ai checkbox + label crown
      const enhanceCb = formPanel.querySelector('#promptNodeUseAi');
      const enhanceLabel = enhanceCb?.closest('label.toolbar-toggle');
      if (enhanceCb && enhanceLabel) {
        enhanceCb.disabled = !canEnhance;
        enhanceLabel.classList.toggle('feature-disabled', !canEnhance);
        if (!canEnhance) {
          enhanceLabel.setAttribute(
            'title',
            window.I18n?.t?.('workflow.featureDisabled') || 'Tính năng này yêu cầu gói Premium'
          );
        } else {
          enhanceLabel.removeAttribute('title');
        }
        // Crown badge inject/remove — 2026-05-30: crown icon + premium-only label
        const crown = enhanceLabel.querySelector('.premium-crown');
        if (!canEnhance && !crown) {
          const span = document.createElement('span');
          span.className = 'premium-crown';
          span.style.marginLeft = '6px';
          const premiumLabel = window.I18n?.t?.('workflow.useAiPremiumOnly') || 'Chỉ hoạt động với tài khoản Premium';
          span.title = premiumLabel;
          span.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align: -2px; margin-right: 3px;"><path d="M5 16L3 7l5.5 4L12 4l3.5 7L21 7l-2 9H5zm0 2h14v2H5v-2z"/></svg>${premiumLabel}`;
          enhanceLabel.appendChild(span);
        } else if (canEnhance && crown) {
          crown.remove();
        }
      }

      // Toggle provider select options (chatgpt / gemini)
      const providerSel = formPanel.querySelector('#promptNodeProvider');
      if (providerSel) {
        const cgOpt = providerSel.querySelector('option[value="chatgpt"]');
        const gmOpt = providerSel.querySelector('option[value="gemini"]');
        if (cgOpt) {
          cgOpt.disabled = !canChatGPT;
          const cgName = window.ProviderMeta?.getName?.('chatgpt') || 'ChatGPT';
          cgOpt.textContent = canChatGPT ? cgName : `${cgName} (Pro)`;
        }
        if (gmOpt) {
          gmOpt.disabled = !canGemini;
          const gmName = window.ProviderMeta?.getName?.('gemini') || 'Gemini';
          gmOpt.textContent = canGemini ? gmName : `${gmName} (Pro)`;
        }
      }
    }
  }

  /**
   * Update provider labels throughout WorkflowEditor when ProviderMeta changes.
   * Called via SSE provider:updated event.
   */
  _updateProviderLabels() {
    const PM = window.ProviderMeta;
    if (!PM) return;

    console.log('[WorkflowEditor] _updateProviderLabels called');

    // Update provider select options in right sidebar (prompt node settings) - names only
    const providerSel = this.overlay?.querySelector('#promptNodeProvider');
    if (providerSel) {
      const cgOpt = providerSel.querySelector('option[value="chatgpt"]');
      const gmOpt = providerSel.querySelector('option[value="gemini"]');
      if (cgOpt) {
        const cgName = PM.getName('chatgpt');
        const canChatGPT = !cgOpt.disabled;
        cgOpt.textContent = canChatGPT ? cgName : `${cgName} (Pro)`;
      }
      if (gmOpt) {
        const gmName = PM.getName('gemini');
        const canGemini = !gmOpt.disabled;
        gmOpt.textContent = canGemini ? gmName : `${gmName} (Pro)`;
      }
    }

    // Update .node-brand-name in right sidebar form
    if (this.overlay) {
      const brandNames = this.overlay.querySelectorAll('.node-brand-name[data-provider]');
      console.log('[WorkflowEditor] _updateProviderLabels: found', brandNames.length, 'brand name elements');
      brandNames.forEach(el => {
        const provider = el.dataset.provider;
        if (provider) {
          const newName = PM.getName(provider);
          console.log(`[WorkflowEditor] Updating brand name ${provider}: ${el.textContent} → ${newName}`);
          el.textContent = newName;
        }
      });
    }

    // Update node headers in canvas (chatgpt/grok/prompt nodes show provider labels)
    const canvas = this.canvasContainer;
    if (canvas) {
      // ChatGPT nodes
      canvas.querySelectorAll('.workflow-node[data-type="chatgpt"] .node-header-title').forEach(el => {
        const node = el.closest('.workflow-node');
        const provider = node?.dataset?.provider || 'chatgpt';
        el.textContent = PM.getName(provider);
      });
      // Grok nodes
      canvas.querySelectorAll('.workflow-node[data-type="grok"] .node-header-title').forEach(el => {
        el.textContent = PM.getName('grok');
      });
      // Generate/Image nodes (Flow)
      canvas.querySelectorAll('.workflow-node[data-type="generate"] .node-header-title, .workflow-node[data-type="image"] .node-header-title').forEach(el => {
        el.textContent = PM.getName('flow');
      });
    }
  }

  /**
   * Check if current workflow is in read-only mode.
   * Read-only nếu:
   *   - Workflow là shared view (_is_shared_view flag)
   *   - Workflow là template preview (_is_template_preview flag hoặc _isPreview flag)
   *   - HOẶC mode = 'view' (defensive — flag có thể mất qua serialize)
   * @returns {boolean}
   */
  isReadOnly() {
    return this.workflow?._is_shared_view === true
        || this.workflow?._is_admin_view === true
        || this.workflow?._is_template_preview === true
        || this.workflow?._isPreview === true
        || this.mode === 'view'
        || this.mode === 'admin_preview';
  }

  /**
   * Check if current mode is a preview mode (shared, admin, or template preview)
   * @returns {boolean}
   */
  isPreviewMode() {
    return this.editorMode === EditorMode.SHARED_PREVIEW
        || this.editorMode === EditorMode.ADMIN_PREVIEW
        || this.editorMode === EditorMode.TEMPLATE_PREVIEW;
  }

  /**
   * Get current permissions based on editorMode
   * @returns {Object} Permission flags
   */
  getPermissions() {
    return EditorPermissions[this.editorMode] || EditorPermissions[EditorMode.WORKFLOW_CREATE];
  }

  /**
   * Check if user can edit (add/modify nodes, connections)
   * @returns {boolean}
   */
  canEdit() {
    return this.getPermissions().canEdit;
  }

  /**
   * Check if user can run workflow
   * Requires: canRun permission + featureGate check
   * @returns {boolean}
   */
  canRun() {
    if (!this.getPermissions().canRun) return false;
    // FeatureGate check: workflows_enabled
    if (window.featureGate && !window.featureGate.canUse('workflows_enabled')) return false;
    return true;
  }

  /**
   * Check if user can share workflow
   * Requires: canShare permission + featureGate check
   * @returns {boolean}
   */
  canShare() {
    if (!this.getPermissions().canShare) return false;
    // FeatureGate check: workflow_share_enabled
    if (window.featureGate && !window.featureGate.canUse('workflow_share_enabled')) return false;
    return true;
  }

  /**
   * Check if user can save workflow/template
   * Requires: canSave permission + featureGate check for workflow
   * @returns {boolean}
   */
  canSave() {
    if (!this.getPermissions().canSave) return false;
    // Template mode: check admin permission
    if (this.isTemplateMode) {
      // [Creator Page] Affiliate sửa community template CỦA MÌNH → cho save (route creator update).
      if (this.isCreatorTemplate) return true;
      return window.featureGate?.canManageWorkflowTemplates() === true;
    }
    // Workflow mode: check workflows_enabled
    if (window.featureGate && !window.featureGate.canUse('workflows_enabled')) return false;
    return true;
  }

  /**
   * Derive editorMode from legacy flags
   * Call this after setting mode, workflow, isTemplateMode
   */
  _syncEditorMode() {
    if (this.isTemplateMode) {
      this.editorMode = this.templateId ? EditorMode.TEMPLATE_EDIT : EditorMode.TEMPLATE_CREATE;
    } else if (this.workflow?._is_admin_view) {
      this.editorMode = EditorMode.ADMIN_PREVIEW;
    } else if (this.workflow?._is_shared_view) {
      this.editorMode = EditorMode.SHARED_PREVIEW;
    } else if (this.workflow?._is_template_preview || this.workflow?._isPreview) {
      this.editorMode = EditorMode.TEMPLATE_PREVIEW;
    } else if (this.mode === 'view' || this.mode === 'admin_preview') {
      this.editorMode = EditorMode.ADMIN_PREVIEW;
    } else if (this.mode === 'create') {
      this.editorMode = EditorMode.WORKFLOW_CREATE;
    } else {
      this.editorMode = EditorMode.WORKFLOW_EDIT;
    }
  }

  open(mode = 'create', workflow = null) {
    this.mode = mode;
    this.workflow = workflow || this.createNewWorkflow();
    // Guard (2026-07): a workflow loaded from a legacy/backend source may arrive with
    // nodes/edges undefined (e.g. a workflow saved when the extension had a backend,
    // opened later in local mode). Without normalizing, the canvas renders empty AND
    // downstream ops that assume arrays (add/save/export) misbehave. Always arrays.
    if (this.workflow && !Array.isArray(this.workflow.nodes)) this.workflow.nodes = [];
    if (this.workflow && !Array.isArray(this.workflow.edges)) this.workflow.edges = [];
    this.selectedNodeId = null;

    // [Fix cloned workflow] Clear shared/preview flags khi mở workflow edit mode
    // Tránh trường hợp workflow clone từ shared vẫn còn flag _is_shared_view
    if (mode === 'edit' && this.workflow) {
      // Log flags trước khi xóa để debug
      if (this.workflow._is_shared_view || this.workflow._is_template_preview || this.workflow._isPreview) {
        console.warn('[WorkflowEditor] open() clearing read-only flags:', {
          _is_shared_view: this.workflow._is_shared_view,
          _is_template_preview: this.workflow._is_template_preview,
          _isPreview: this.workflow._isPreview
        });
      }
      delete this.workflow._is_shared_view;
      delete this.workflow._is_template_preview;
      delete this.workflow._isPreview;
    }

    // Force reset mode to 'edit' nếu workflow không phải preview
    if (mode === 'edit') {
      this.mode = 'edit'; // Ensure mode is set correctly
    }

    // EWT-6: Reset template mode properties khi mở workflow thông thường
    this.isTemplateMode = false;
    this.templateId = null;
    this.isCreatorTemplate = false;
    this.templateData = null;

    // Sync editorMode từ legacy flags
    this._syncEditorMode();

    // [Fix cloned workflow] Reset saving state flags TRƯỚC khi render/init
    // Vì render/initComponents có thể trigger _deferredThumbnailSave() qua background scan
    this._isSaving = false;
    if (this._deferredSaveTimer) {
      clearTimeout(this._deferredSaveTimer);
      this._deferredSaveTimer = null;
    }
    if (this._inlineSaveTimer) {
      clearTimeout(this._inlineSaveTimer);
      this._inlineSaveTimer = null;
    }
    // Flag để skip deferred save trong quá trình init
    this._skipDeferredSave = true;

    // [DEBUG OPEN] Log state trước render — verify label đúng
    console.log('[OPEN_DEBUG] open() about to render:', {
      mode: this.mode,
      editorMode: this.editorMode,
      isTemplateMode: this.isTemplateMode,
      wf_id: this.workflow?.wf_id,
    });

    this._hideSidebar();
    this.render();

    // [DEBUG OPEN] Verify actual button text after render
    setTimeout(() => {
      var b = this.overlay?.querySelector('#saveWorkflowBtn');
      console.log('[OPEN_DEBUG] After render — button text:', JSON.stringify(b?.textContent), 'mode:', this.mode);
    }, 100);

    this.initComponents();
    this.bindEvents();
    this._updateQuotaDisplay();
    // Reset unsaved changes flag after loading - loading existing data is not a change
    // Drawflow events (edge:created, node:moved) may fire during init, but those are from loading not user action
    this._hasUnsavedChanges = false;

    // Cho phép deferred save sau khi init xong
    this._skipDeferredSave = false;

    // v1.1 paste image feature: retry pending/failed uploads cho workflow này
    // (blob persist trong workflow_paste_blobs, không TTL)
    this._retryPendingPasteUploads().catch(err => {
      console.warn('[WorkflowEditor] retry pending paste uploads failed:', err?.message);
    });

    // Reset saving flags lần nữa sau init (phòng trường hợp có async operation set lại)
    this._isSaving = false;
    if (this._deferredSaveTimer) {
      clearTimeout(this._deferredSaveTimer);
      this._deferredSaveTimer = null;
    }
    if (this._inlineSaveTimer) {
      clearTimeout(this._inlineSaveTimer);
      this._inlineSaveTimer = null;
    }

    // Reset execution UI state — ensure play/stop/reset buttons match actual state
    this._syncExecutionUI();

    // Update play button state (remove is-saving-locked if any)
    this._updatePlayButtonState();

    // [Fix] Ensure wf-preview-mode class matches isReadOnly() state after re-render
    // Cần vì có thể reuse popup window khi chuyển từ shared preview sang edit mode
    if (this.overlay) {
      if (this.isReadOnly()) {
        this.overlay.classList.add('wf-preview-mode');
      } else {
        this.overlay.classList.remove('wf-preview-mode');
      }
    }
  }

  /**
   * EWT-6.6: Mở template trong editor để chỉnh sửa (admin only)
   * @param {Object} template - Dữ liệu template từ API
   */
  openTemplateForEdit(template) {
    if (!template || !template.id) {
      console.error('[WorkflowEditor] openTemplateForEdit: template không hợp lệ');
      return;
    }

    // Kiểm tra quyền admin
    if (!window.featureGate?.canManageWorkflowTemplates()) {
      window.showNotification?.(
        window.I18n?.t('workflow.adminRequired') || 'Bạn cần quyền admin để chỉnh sửa template',
        'error'
      );
      return;
    }

    // Set template mode
    this.isTemplateMode = true;
    this.isCreatorTemplate = false; // admin official template (reset nếu window reuse sau creator edit)
    this.templateId = template.id;
    this.templateData = {
      name: template.name,
      description: template.description,
      category_id: template.category_id,
      thumbnail_url: template.thumbnail_url || template.thumbnail,
      video_url: template.video_url || null,
      is_premium: template.is_premium || false,
      is_featured: template.is_featured || false,
      // Backend returns is_active, frontend uses is_published internally
      // Simplify: prefer is_active from backend, fallback to is_published, default true
      is_published: template.is_active ?? template.is_published ?? true,
      use_count: template.use_count || 0,
    };

    // Chuyển đổi template thành workflow format để hiển thị trong editor
    this.mode = 'edit';
    this.workflow = this._convertTemplateToWorkflow(template);
    this.selectedNodeId = null;

    // Sync editorMode từ legacy flags
    this._syncEditorMode();

    this._hideSidebar();
    this.render();
    this.initComponents();
    this.bindEvents();
    this._updateQuotaDisplay();
    this._hasUnsavedChanges = false;
    this._syncExecutionUI();

    console.log('[WorkflowEditor] Đã mở template để chỉnh sửa:', template.id, template.name);
  }

  /**
   * [Creator Page] Affiliate sửa NỘI DUNG community template — mirror openTemplateForEdit.
   * Khác: gate affiliate (KHÔNG admin), set isCreatorTemplate → _updateTemplate route creator endpoint
   * + WorkflowMediaModal upload → creator-templates/media. Đổi nodes → backend tự re-review.
   */
  openCreatorTemplateForEdit(template) {
    if (!template || !template.id) {
      console.error('[WorkflowEditor] openCreatorTemplateForEdit: template không hợp lệ');
      return;
    }
    this.isCreatorTemplate = true;
    this.isTemplateMode = true;
    this.templateId = template.id;
    this.templateData = {
      name: template.name,
      description: template.description,
      thumbnail_url: template.thumbnail_url || template.thumbnail,
      video_url: template.video_url || null,
      review_status: template.review_status || 'pending',
      reject_reason: template.reject_reason || null,
      is_public: template.is_public || false,
    };

    this.mode = 'edit';
    this.workflow = this._convertTemplateToWorkflow(template);
    this.selectedNodeId = null;
    this._syncEditorMode();
    this._hideSidebar();
    this.render();
    this.initComponents();
    this.bindEvents();
    this._updateQuotaDisplay();
    this._hasUnsavedChanges = false;
    this._syncExecutionUI();
    console.log('[WorkflowEditor] Đã mở community template để sửa:', template.id, template.name);
  }

  /**
   * EWT-6.6: Chuyển đổi template format thành workflow format
   * @param {Object} template - Template từ API
   * @returns {Object} Workflow format
   */
  _convertTemplateToWorkflow(template) {
    const nodes = (template.nodes || []).map(node => {
      // Convert result_img_url (string) -> result_thumbnails (object) để DiagramCanvas hiển thị
      const resultImgUrl = node.result_img_url || node.data?.result_img_url || '';
      const resultThumbnails = resultImgUrl
        ? { [`result_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`]: resultImgUrl }
        : null;

      return {
        // Các field khác từ data (spread trước để các field quan trọng override sau)
        ...(node.data || {}),
        // Ưu tiên node_id trước để nhất quán với preview mode
        node_id: node.node_id || node.id || (window.IdGenerator ? window.IdGenerator.next('node') : ('node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5))),
        node_type: node.node_type || node.type,
        node_name: node.node_name || node.data?.node_name || node.name || node.type || 'Node',
        pos_x: node.pos_x ?? node.position?.x ?? 100,
        pos_y: node.pos_y ?? node.position?.y ?? 100,
        enabled: node.enabled !== false,
        status: null,
        // Data fields
        prompt: node.prompt || node.data?.prompt || '',
        model: node.model || node.data?.model || '',
        ratio: node.ratio || node.data?.ratio || '1:1',
        quantity: node.quantity || node.data?.quantity || 1,
        // Ref images - lưu cả ref_img_urls (cho form) và ref_thumbnails (cho preview)
        ref_file_ids: '',
        ref_img_urls: (() => {
          const urls = node.ref_img_urls || node.data?.ref_img_urls || [];
          if (urls.length > 0) console.log('[WorkflowEditor] _convertTemplateToWorkflow - node has ref_img_urls:', node.id || node.node_id, urls);
          return urls;
        })(),
        ref_thumbnails: this._convertRefImgUrlsToThumbnails(node.ref_img_urls || node.data?.ref_img_urls || []),
        // Result image - lưu cả result_img_url (cho form) và result_thumbnails (cho preview)
        result_img_url: resultImgUrl,
        result_thumbnails: resultThumbnails,
      };
    });

    const edges = (template.edges || []).map(edge => ({
      // DiagramCanvas expects source_node_id / target_node_id / source_handle / target_handle
      edge_id: edge.edge_id || edge.id || (window.IdGenerator ? window.IdGenerator.next('edge') : `edge_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`),
      source_node_id: edge.source_node_id || edge.source_node || edge.source,
      target_node_id: edge.target_node_id || edge.target_node || edge.target,
      source_handle: edge.source_handle || edge.output_class || edge.sourceHandle || 'output_1',
      target_handle: edge.target_handle || edge.input_class || edge.targetHandle || 'input_1',
      source_port: edge.source_port || edge.sourcePort || 'default', // Port 1.1.58: camelCase fallback
      target_port: edge.target_port || edge.targetPort || 'default',
    }));

    return {
      wf_id: `template_${template.id}`,
      wf_name: template.name || 'Template',
      description: template.description || '',
      status: 'idle',
      enabled: true,
      settings: template.settings || {},
      settings_json: template.settings || {},
      nodes,
      edges,
    };
  }

  /**
   * Chuyển đổi mảng ref_img_urls thành object ref_thumbnails
   * @param {Array} urls - Mảng URLs
   * @returns {Object} Map key -> url
   */
  _convertRefImgUrlsToThumbnails(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return {};
    const result = {};
    urls.forEach((url, idx) => {
      const key = `template_ref_${Date.now()}_${idx}`;
      result[key] = url;
    });
    return result;
  }

  _syncExecutionUI() {
    if (!this.overlay) return;

    // CRITICAL: KHÔNG dùng `this.workflow.status` để detect "stuck" — field này LÀ cached cũ,
    // chỉ update qua `getWorkflow()` reload. Khi execute() call _updateWorkflowStatus('running'),
    // backend lưu nhưng popup's `this.workflow.status` vẫn 'pending'/'idle'.
    // saveWorkflow() trigger _syncExecutionUI mid-execute → executor running + workflow.status cũ
    // → trigger force stop SAI → null currentWorkflow → execute() throw `Cannot read 'wf_id' of null`.
    // → Fix: chỉ trust `executor.isRunning` flag (executor tự manage qua execute()'s try/finally).
    const isRunning = window.workflowExecutor?.isRunning === true;

    const toolbarPlayBtn = this.overlay.querySelector('.seosonaflow-wf-tool-btn[data-action="run-workflow"]');
    const toolbarStopBtn = this.overlay.querySelector('.seosonaflow-wf-tool-btn[data-action="stop-workflow"]');
    const resetBtn = this.overlay.querySelector('#resetWorkflowInEditorBtn');
    // 2026-05-25: enabled toggle (on/off) — ẩn khi workflow đang chạy để tránh user toggle giữa execution.
    const enabledToggle = this.overlay.querySelector('#workflowEnabledToggle');

    // Read-only mode (shared/template preview): luôn ẩn play/stop/reset
    // bất kể workflow.status. Tránh logic show reset khi status=completed.
    if (this.isReadOnly()) {
      toolbarPlayBtn?.classList.add('hidden');
      toolbarStopBtn?.classList.add('hidden');
      resetBtn?.classList.add('hidden');
      this.overlay.classList.remove('wf-executing');
      return;
    }

    // EWT-6: Ẩn các nút thực thi khi đang ở template mode
    // Template chỉ để chỉnh sửa, không cần chạy
    if (this.isTemplateMode) {
      toolbarPlayBtn?.classList.add('hidden');
      toolbarStopBtn?.classList.add('hidden');
      resetBtn?.classList.add('hidden');
      this.overlay.classList.remove('wf-executing');
      return;
    }

    if (isRunning) {
      toolbarPlayBtn?.classList.add('hidden');
      toolbarStopBtn?.classList.remove('hidden');
      resetBtn?.classList.add('hidden');
      enabledToggle?.classList.add('hidden');
      this.overlay.classList.add('wf-executing');
    } else {
      // Phase: ẨN play button khi workflow chưa save (mode='create' chưa lưu lần đầu)
      // Lý do: chạy workflow chưa save → executor không có wf_id thật → fail.
      const isUnsaved = this.mode === 'create' && this._hasUnsavedChanges;
      if (isUnsaved) {
        toolbarPlayBtn?.classList.add('hidden');
      } else {
        toolbarPlayBtn?.classList.remove('hidden');
      }
      toolbarStopBtn?.classList.add('hidden');
      enabledToggle?.classList.remove('hidden');
      this.overlay.classList.remove('wf-executing');
      // Bug fix: thêm 'running' vào điều kiện hiện reset button.
      // Khi node bị stuck ở status='running' (do executor crash hoặc tab close giữa chừng)
      // nhưng executor.isRunning=false → user cần reset stuck state để chạy lại.
      const hasActivity = this.workflow?.status === 'completed' ||
        this.workflow?.status === 'failed' ||
        this.workflow?.status === 'running' ||
        (this.workflow?.nodes || []).some(n => n.status && n.status !== 'pending');
      if (resetBtn) {
        resetBtn.classList.toggle('hidden', !hasActivity);
      }
    }
    this._updatePlayButtonState();
  }

  async close() {
    // S2.5: Check uploads đang chạy → confirm trước khi đóng editor
    const activeCount = this._countActiveFormUploads();
    if (activeCount > 0) {
      const confirmed = await window.customDialog?.confirm(
        window.I18n?.t('workflow.uploadingCloseMsg', { count: activeCount }) || `Uploading ${activeCount} reference images. Closing editor will cancel the upload. Continue?`,
        { title: window.I18n?.t('workflow.uploadingTitle') || 'Images uploading', type: 'warning', confirmText: window.I18n?.t('workflow.closeAndCancel') || 'Close and cancel', cancelText: window.I18n?.t('workflow.continueUpload') || 'Continue upload' }
      );
      if (!confirmed) return;
    }
    // Check thay đổi chưa lưu
    // Skip nếu editor được mở để xem workflow đang chạy (từ sidebar, không có edits thật)
    if (this._hasUnsavedChanges && !this._openedToViewRunning) {
      const confirmed = await window.customDialog?.confirm(
        window.I18n?.t('workflow.unsavedMsg') || 'Workflow has unsaved changes. Close without saving?',
        { title: window.I18n?.t('workflow.unsavedTitle') || 'Unsaved changes', type: 'warning', confirmText: window.I18n?.t('workflow.closeWithoutSave') || 'Close without saving', cancelText: window.I18n?.t('workflow.goBack') || 'Go back' }
      );
      if (!confirmed) return;
    }
    // Cleanup all eventBus listeners registered in bindGlobalEvents()
    // (only on full close, not on re-render via _forceClose)
    if (this._ebHandlers && window.eventBus) {
      for (const [event, handler] of Object.entries(this._ebHandlers)) {
        window.eventBus.off(event, handler);
      }
      this._ebHandlers = null;
    }
    // Cleanup beforeunload listener
    if (this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
    // Cleanup history keyboard + event listeners
    if (this._historyKeyHandler) {
      document.removeEventListener('keydown', this._historyKeyHandler, true);
      this._historyKeyHandler = null;
    }
    if (this._historyEventHandlers && window.eventBus) {
      for (const [event, handler] of Object.entries(this._historyEventHandlers)) {
        window.eventBus.off(event, handler);
      }
      this._historyEventHandlers = null;
    }
    if (this._undoRedoDirtyTimer) {
      clearTimeout(this._undoRedoDirtyTimer);
      this._undoRedoDirtyTimer = null;
    }
    this.history?.reset();
    this._forceClose();
  }

  /**
   * Đóng editor không cần confirm (dùng nội bộ khi re-render)
   */
  _forceClose() {
    // S2.5: Cleanup upload event listeners
    if (this._uploadStartedHandler) {
      window.eventBus?.off('upload:started', this._uploadStartedHandler);
      this._uploadStartedHandler = null;
    }
    if (this._uploadCompletedHandler) {
      window.eventBus?.off('upload:completed', this._uploadCompletedHandler);
      this._uploadCompletedHandler = null;
    }
    if (this._uploadFailedHandler) {
      window.eventBus?.off('upload:failed', this._uploadFailedHandler);
      this._uploadFailedHandler = null;
    }

    // S2.5: Cancel tất cả form uploads khi đóng editor
    if (this._formUploadKeys?.size > 0) {
      if (window.ImmediateUploader) ImmediateUploader.cancelAll(this._formUploadKeys);
      this._formUploadKeys.clear();
    }

    this._clearBgScanTimers();
    this._hideNodePicker();
    this._hideCanvasContextMenu();
    this._cleanupNodeResizeObservers();
    this._hideInlineSettingDropdown?.();
    if (this._docPillBound) {
      try { document.removeEventListener('mousedown', this._docPillMouseDown, true); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_forceClose', e); }
      try { document.removeEventListener('click', this._docPillClick, true); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_forceClose', e); }
      this._docPillMouseDown = null;
      this._docPillClick = null;
      this._docPillBound = false;
    }
    // v1.1 paste image feature: cleanup document-level paste listener
    if (this._pasteHandler) {
      try { document.removeEventListener('paste', this._pasteHandler); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_forceClose', e); }
      this._pasteHandler = null;
    }
    // v1.1 paste image feature: cleanup workflow-wide upload listeners
    try { this._unbindWorkflowUploadListeners(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_forceClose', e); }
    this._unbindKeyboardShortcuts();
    this._unbindNodeFormResize();
    // 2026-05-25: clear pending debounced warning badge refresh (tránh fire sau close)
    if (this._warningBadgesRefreshTimer) {
      clearTimeout(this._warningBadgesRefreshTimer);
      this._warningBadgesRefreshTimer = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    // Tear down DiagramCanvas so its document-level click/mousedown/keydown
    // listeners are removed (else they leak across editor open/close cycles).
    try { this.diagramCanvas?.destroy?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_forceClose', e); }
    this.diagramCanvas = null;
    this.selectedNodeId = null;
    this._currentFormNodeType = null;
    this._showSidebar();
  }

  _hideSidebar() {
    // sidePanel mode: hide main app content, overlay takes full screen
    const flowApp = document.querySelector('.flow-app');
    if (flowApp) flowApp.style.display = 'none';
  }

  _showSidebar() {
    const flowApp = document.querySelector('.flow-app');
    if (flowApp) flowApp.style.display = '';
  }

  createNewWorkflow() {
    // Phase: workflow mới có default name kèm date d/m/y (vd: "Workflow mới - 25/4/2026")
    const now = new Date();
    const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
    const baseName = window.I18n?.t('workflow.newWorkflow') || 'Workflow mới';
    return {
      // UUID + timestamp tránh collision khi 2 user/tab tạo cùng millisecond.
      wf_id: window.IdGenerator ? window.IdGenerator.next('wf') : `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      wf_name: `${baseName} - ${dateStr}`,
      description: '',
      status: 'idle',
      settings: {
        delay_between_nodes: 5,
        retry_on_fail: true,
        max_retries: 2,
        parallel_execution: true
      },
      settings_json: {
        delay_between_nodes: 5,
        max_retries: 2,
        timeout: 180,
        stop_on_error: false,
        parallel_execution: true
      },
      progress_total: 0,
      progress_completed: 0,
      nodes: [],
      edges: []
    };
  }

  render() {
    this._forceClose();

    this.overlay = document.createElement('div');
    // EWT-11: Thêm class wf-template-mode để CSS ẩn các UI elements không cần thiết cho template editor
    // Preview mode: thêm wf-preview-mode để ẩn hover toolbar và quick action buttons
    // Admin preview: thêm wf-admin-preview để show node form panel (nhưng readonly)
    const isAdminPreview = this.workflow?._is_admin_view === true;
    this.overlay.className = 'workflow-editor-overlay'
      + (this.isTemplateMode ? ' wf-template-mode' : '')
      + (this.isReadOnly() ? ' wf-preview-mode' : '')
      + (isAdminPreview ? ' wf-admin-preview' : '');
    this.overlay.innerHTML = `
      <div class="workflow-editor">
        <div class="workflow-editor-header">
          <div class="workflow-editor-title">
            <input type="text" id="workflowName" value="${this.escapeAttr(this.workflow.wf_name)}" placeholder="${this.isTemplateMode ? (window.I18n?.t('workflow.templateNamePlaceholder') || 'Tên template') : (window.I18n?.t('workflow.workflowNamePlaceholder') || 'Tên workflow')}" ${this.isReadOnly() ? 'readonly' : ''} />
            ${this.isCreatorTemplate ? (() => {
              const rs = this.templateData?.review_status || 'pending';
              const label = rs === 'approved' ? (window.I18n?.t('creator.status.approved') || 'Đã duyệt')
                : rs === 'rejected' ? (window.I18n?.t('creator.status.rejected') || 'Từ chối')
                : (window.I18n?.t('creator.status.pending') || 'Chờ duyệt');
              const reason = (rs === 'rejected' && this.templateData?.reject_reason) ? this.escapeAttr(this.templateData.reject_reason) : '';
              return `<span class="wf-creator-status wf-creator-status--${rs}"${reason ? ` data-tooltip="${reason}" data-tooltip-pos="bottom"` : ''}>${label}</span>`;
            })() : ''}
            ${this.isTemplateMode && this.templateId ? `
            <div class="wf-template-stats">
              <span class="wf-template-stat" title="${window.I18n?.t('workflow.template.useCountTitle') || 'Số lượt sử dụng template này'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <span>${(this.templateData?.use_count || 0)} ${window.I18n?.t('workflow.useCount') || 'lượt dùng'}</span>
              </span>
            </div>
            ` : ''}
            ${(!this.isTemplateMode && !this.isReadOnly()) ? `<button class="wf-toggle-btn ${this.workflow.enabled !== false ? 'on' : 'off'}" id="workflowEnabledToggle" title="${this.workflow.enabled !== false ? (window.I18n?.t('workflow.enabledOn') || 'Workflow đang bật') : (window.I18n?.t('workflow.enabledOff') || 'Workflow đang tắt')}">
              <span class="wf-toggle-track"><span class="wf-toggle-thumb"></span></span>
            </button>` : ''}
          </div>
          <div class="workflow-editor-actions">
            ${(!this.isTemplateMode && !this.isReadOnly() && this.workflow?.wf_id) ? this._renderSharedUsersAvatars(this.workflow?.shares || []) : ''}
            ${!this.isTemplateMode ? `<div class="wf-quota-display" id="wfQuotaDisplay">
              <div class="wf-quota-item" id="wfQuotaRuns" title="${window.I18n?.t('workflow.runsToday') || 'Lượt chạy hôm nay'}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                <span class="wf-quota-label">${window.I18n?.t('workflow.quotaRuns') || 'Runs'}</span>
                <span class="wf-quota-value">--/--</span>
              </div>
              <span class="wf-quota-sep">&bull;</span>
              <div class="wf-quota-item" id="wfQuotaNodes" title="${window.I18n?.t('workflow.nodesInWorkflow') || 'Số node trong workflow'}">
                <svg width="20" height="20" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="none"><path fill="currentColor" fill-rule="evenodd" d="M4 6.25A2.25 2.25 0 016.25 4h3a2.25 2.25 0 012.25 2.25V7h3.25a.75.75 0 010 1.5H11.5v.75a2.25 2.25 0 01-2.25 2.25h-3A2.25 2.25 0 014 9.25V8.5H.75a.75.75 0 010-1.5H4v-.75zm6 0a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75v3c0 .414.336.75.75.75h3a.75.75 0 00.75-.75v-3z" clip-rule="evenodd"></path></svg>
                <span class="wf-quota-label">${window.I18n?.t('workflow.quotaNodes') || 'Nodes'}</span>
                <span class="wf-quota-value">--/--</span>
              </div>
              <button class="wf-upgrade-link hidden" id="wfUpgradeBtn" title="${window.I18n?.t('footer.upgrade') || 'Nâng cấp'}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"/></svg>
                <span>${window.I18n?.t('footer.upgrade') || 'Nâng cấp'}</span>
              </button>
            </div>` : ''}
            ${this.isTemplateMode && this.templateId && (window.featureGate?.canManageWorkflowTemplates() || this.isCreatorTemplate) ? `
            <button class="btn btn-secondary" id="wfCaptureDiagramBtn" style="white-space: nowrap; flex-shrink: 0;" title="${window.I18n?.t('workflow.captureDiagramTitle') || 'Chụp ảnh diagram → upload làm preview public của template'}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              <span>${window.I18n?.t('workflow.captureDiagram') || 'Capture'}</span>
            </button>
            ` : ''}
            <button class="btn btn-secondary ${(this.mode === 'create' || this.isTemplateMode || this.isReadOnly()) ? 'hidden' : ''}" id="resetWorkflowInEditorBtn" title="${window.I18n?.t('workflow.resetBtn') || 'Reset'} workflow">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="1 4 1 10 7 10"></polyline>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
              </svg>
              ${window.I18n?.t('workflow.resetBtn') || 'Reset'}
            </button>
            ${window.featureGate?.canManageWorkflowTemplates() && !this.isTemplateMode && this.mode !== 'create' && this.workflow?.wf_id && !this.isReadOnly() ? `
            <button class="btn btn-secondary btn-save-template" id="wfSaveAsTemplateBtn" title="${window.I18n?.t('workflow.saveAsTemplate') || 'Lưu thành Template'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              <span>${window.I18n?.t('workflow.saveAsTemplate') || 'Lưu Template'}</span>
            </button>
            ` : ''}
            ${!this.isTemplateMode && this.mode !== 'create' && this.workflow?.wf_id && !this.isReadOnly() ? `
            <button class="btn btn-secondary btn-publish-template hidden" id="wfPublishTemplateBtn" title="${window.I18n?.t('creator.publish.title') || 'Xuất bản Template'}">
              <svg fill="currentColor" width="18" height="18" viewBox="0 -1.5 35 35" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M29.426 15.535c0 0 0.649-8.743-7.361-9.74-6.865-0.701-8.955 5.679-8.955 5.679s-2.067-1.988-4.872-0.364c-2.511 1.55-2.067 4.388-2.067 4.388s-5.576 1.084-5.576 6.768c0.124 5.677 6.054 5.734 6.054 5.734h9.351v-6h-3l5-5 5 5h-3v6h8.467c0 0 5.52 0.006 6.295-5.395 0.369-5.906-5.336-7.070-5.336-7.070z"></path></svg>
              <span>${window.I18n?.t('creator.publish.btn') || 'Xuất bản Template'}</span>
            </button>
            ` : ''}
            ${window.featureGate?.canManageWorkflowTemplates() && this.workflow?._is_template_preview && this.workflow?._template_id ? `
            <button class="btn btn-secondary btn-edit-template" id="wfEditTemplateBtn" title="${window.I18n?.t('workflow.editTemplate') || 'Chỉnh sửa template'}">
              <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 15.7502H9.75002M1.875 16.1252L6.03695 14.5245C6.30316 14.4221 6.43626 14.3709 6.56079 14.3041C6.6714 14.2447 6.77685 14.1761 6.87603 14.0992C6.98769 14.0125 7.08853 13.9117 7.29021 13.71L15.75 5.25023C16.5784 4.4218 16.5784 3.07865 15.75 2.25023C14.9216 1.4218 13.5784 1.4218 12.75 2.25022L4.29021 10.71C4.08853 10.9117 3.98769 11.0125 3.90104 11.1242C3.82408 11.2234 3.75555 11.3288 3.69618 11.4394C3.62933 11.564 3.57814 11.6971 3.47575 11.9633L1.875 16.1252ZM1.875 16.1252L3.41859 12.1119C3.52905 11.8248 3.58428 11.6812 3.67901 11.6154C3.76179 11.5579 3.86423 11.5362 3.96322 11.5551C4.0765 11.5767 4.18529 11.6855 4.40286 11.9031L6.09718 13.5974C6.31475 13.815 6.42354 13.9237 6.44517 14.037C6.46408 14.136 6.44234 14.2385 6.38486 14.3212C6.31908 14.416 6.17549 14.4712 5.8883 14.5817L1.875 16.1252Z"/></svg>
              <span>${window.I18n?.t('workflow.editTemplate') || 'Chỉnh sửa template'}</span>
            </button>
            ` : ''}
            ${!this.isTemplateMode && this.mode !== 'create' && !this.isReadOnly() ? `
            <button class="btn btn-secondary btn-icon-only ${!window.featureGate?.canUse('workflow_share_enabled') ? 'btn--locked' : ''}" id="shareWorkflowHeaderBtn" title="${window.I18n?.t('workflow.shareBtn') || 'Chia sẻ'}" data-tooltip="${window.I18n?.t('workflow.shareBtn') || 'Chia sẻ'}">
              ${!window.featureGate?.canUse('workflow_share_enabled') ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning, #f59e0b)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>` : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`}
            </button>
            ` : ''}
            ${(this.isReadOnly() && !this.workflow?._is_admin_view) ? `
            <button class="btn btn-success wf-duplicate-header-btn" id="duplicateSharedHeaderBtn" title="${
              this.workflow?._is_template_preview
                ? (window.I18n?.t('workflow.copyTemplateBtn') || 'Sao chép template')
                : (window.I18n?.t('workflow.duplicateToUse') || 'Nhân bản để sử dụng')
            }">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>${
                this.workflow?._is_template_preview
                  ? (window.I18n?.t('workflow.copyTemplateBtn') || 'Sao chép template')
                  : (window.I18n?.t('workflow.duplicateBtn') || 'Nhân bản')
              }</span>
            </button>
            ` : ''}
            <button class="btn btn-primary ${this.isReadOnly() ? 'hidden' : ''}" id="saveWorkflowBtn" title="${window.I18n?.t('workflow.saveShortcut') || 'Lưu (Ctrl+S)'}" data-tooltip="${window.I18n?.t('workflow.saveShortcut') || 'Lưu (Ctrl+S)'}">${this.isTemplateMode ? (this.templateId ? (window.I18n?.t('workflow.updateTemplate') || 'Cập nhật Template') : (window.I18n?.t('workflow.saveTemplateBtn') || 'Lưu Template')) : (this.mode === 'create' ? (window.I18n?.t('workflow.createBtn') || 'Tạo mới') : (window.I18n?.t('workflow.saveBtn') || 'Lưu'))}</button>
            <button class="btn btn-secondary btn-icon-only" id="closeEditorBtn" title="${window.I18n?.t('workflow.closeBtn') || 'Đóng'}" data-tooltip="${window.I18n?.t('workflow.closeBtn') || 'Đóng'}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <div class="workflow-editor-body">
          <div class="workflow-editor-center">
            <div class="seosonaflow-wf-toolbar">
                <button class="seosonaflow-wf-tool-btn wf-mode-btn active" data-action="mode-select" title="${window.I18n?.t('workflow.selectMode') || 'Chế độ chọn'}" data-tooltip="${window.I18n?.t('workflow.selectMode') || 'Chế độ chọn'}" data-tooltip-pos="right">
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M2.14091 5.76624C1.40087 3.76355 3.34949 1.81493 5.35218 2.55498L16.5737 6.70211C18.8053 7.52683 18.7325 10.7081 16.4655 11.4295L12.3305 12.7446L11.0154 16.8795C10.294 19.1466 7.11276 19.2193 6.28805 16.9878L2.14091 5.76624ZM4.77438 4.11829C4.10688 3.87173 3.45767 4.52095 3.70423 5.18844L7.85136 16.41C8.12626 17.1538 9.18636 17.1297 9.42688 16.3741L11.004 11.4181L15.9601 9.84095C16.7157 9.60042 16.7397 8.54032 15.9959 8.26542L4.77438 4.11829Z"/></svg>
                </button>
                <button class="seosonaflow-wf-tool-btn wf-mode-btn" data-action="mode-pan" title="${window.I18n?.t('workflow.panMode') || 'Chế độ kéo (Space)'}" data-tooltip="${window.I18n?.t('workflow.panMode') || 'Chế độ kéo (Space)'}" data-tooltip-pos="right">
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M10.0013 1.66797C10.8851 1.66797 11.6379 2.21936 11.9406 2.99609C12.1191 2.94627 12.3069 2.91797 12.5013 2.91797C13.6519 2.91797 14.5846 3.85071 14.5846 5.0013V6.66797H14.5863V8.1027C15.639 7.72283 16.8886 8.00304 17.6592 8.96615L17.7373 9.0638L17.9692 9.35433L17.9082 9.72135C17.6117 11.5003 16.4054 13.3963 15.3504 15.0493C14.0985 17.011 11.921 18.3346 9.53906 18.3346C5.88242 18.3344 2.91817 15.3702 2.91797 11.7135V6.2513C2.91797 5.10071 3.85071 4.16797 5.0013 4.16797C5.14398 4.16797 5.28335 4.18215 5.41797 4.20947V4.16797C5.41797 3.01738 6.35071 2.08464 7.5013 2.08464C7.85561 2.08464 8.189 2.17357 8.48112 2.32959C8.8613 1.92325 9.40094 1.66797 10.0013 1.66797ZM10.0013 3.33464C9.77118 3.33464 9.58464 3.52118 9.58464 3.7513V7.91797H7.91797V4.16797C7.91797 3.93785 7.73142 3.7513 7.5013 3.7513C7.27118 3.7513 7.08464 3.93785 7.08464 4.16797V9.16797H5.41797V6.2513C5.41797 6.02118 5.23142 5.83464 5.0013 5.83464C4.77118 5.83464 4.58464 6.02118 4.58464 6.2513V11.7135C4.58484 14.4497 6.8029 16.6678 9.53906 16.668C11.2983 16.668 12.9699 15.6816 13.9458 14.1525C14.9561 12.5695 15.8522 11.1149 16.1805 9.83284C15.7118 9.46477 15.0048 9.54716 14.644 10.0623L14.395 10.418H12.9196V7.5013H12.918V5.0013C12.918 4.77118 12.7314 4.58464 12.5013 4.58464C12.2712 4.58464 12.0846 4.77118 12.0846 5.0013V7.91797H10.418V3.7513C10.418 3.52118 10.2314 3.33464 10.0013 3.33464Z"/></svg>
                </button>
                <div class="seosonaflow-wf-tool-divider"></div>
                <button class="seosonaflow-wf-tool-btn ${this.isReadOnly() ? 'hidden' : ''}" data-action="add-node" title="${window.I18n?.t('workflow.addNodeShortcut') || 'Thêm node (N)'}" data-tooltip="${window.I18n?.t('workflow.addNodeShortcut') || 'Thêm node (N)'}" data-tooltip-pos="right">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                <div class="seosonaflow-wf-tool-divider ${this.isReadOnly() ? 'hidden' : ''}"></div>
                <button class="seosonaflow-wf-tool-btn ${this.isReadOnly() ? 'hidden' : ''}" data-action="add-note-node" title="${window.I18n?.t('workflow.addNoteFrame') || 'Thêm ghi chú (khung nhóm)'}" data-tooltip="${window.I18n?.t('workflow.addNoteFrame') || 'Thêm ghi chú (khung nhóm)'}" data-tooltip-pos="right">
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.75 2.625V4.65C9.75 5.91012 9.75 6.54018 9.99524 7.02148C10.211 7.44484 10.5552 7.78905 10.9785 8.00476C11.4598 8.25 12.0899 8.25 13.35 8.25H15.375M15.75 9.74117V12.15C15.75 13.4101 15.75 14.0402 15.5048 14.5215C15.289 14.9448 14.9448 15.289 14.5215 15.5048C14.0402 15.75 13.4101 15.75 12.15 15.75H5.85C4.58988 15.75 3.95982 15.75 3.47852 15.5048C3.05516 15.289 2.71095 14.9448 2.49524 14.5215C2.25 14.0402 2.25 13.4101 2.25 12.15V5.85C2.25 4.58988 2.25 3.95982 2.49524 3.47852C2.71095 3.05516 3.05516 2.71095 3.47852 2.49524C3.95982 2.25 4.58988 2.25 5.85 2.25H8.25883C8.80916 2.25 9.08432 2.25 9.34327 2.31217C9.57285 2.36729 9.79233 2.4582 9.99364 2.58156C10.2207 2.7207 10.4153 2.91527 10.8044 3.30442L14.6956 7.19559C15.0847 7.58473 15.2793 7.7793 15.4184 8.00636C15.5418 8.20767 15.6327 8.42715 15.6878 8.65673C15.75 8.91568 15.75 9.19084 15.75 9.74117Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <button class="seosonaflow-wf-tool-btn ${(this.isTemplateMode || this.isReadOnly()) ? 'hidden' : ''}" data-action="add-media-images" title="${window.I18n?.t('workflow.addMediaImages') || 'Thêm ảnh từ thư viện (tạo node Image)'}" data-tooltip="${window.I18n?.t('workflow.addMediaImages') || 'Thêm ảnh từ thư viện (tạo node Image)'}" data-tooltip-pos="right">
                  <svg width="18" height="18" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.25 1.5H3.9C3.05992 1.5 2.63988 1.5 2.31901 1.66349C2.03677 1.8073 1.8073 2.03677 1.66349 2.31901C1.5 2.63988 1.5 3.05992 1.5 3.9V8.1C1.5 8.94008 1.5 9.36012 1.66349 9.68099C1.8073 9.96323 2.03677 10.1927 2.31901 10.3365C2.63988 10.5 3.05992 10.5 3.9 10.5H8.5C8.96499 10.5 9.19748 10.5 9.38823 10.4489C9.90587 10.3102 10.3102 9.90587 10.4489 9.38823C10.5 9.19748 10.5 8.96499 10.5 8.5M9.5 4V1M8 2.5H11M5.25 4.25C5.25 4.80228 4.80228 5.25 4.25 5.25C3.69772 5.25 3.25 4.80228 3.25 4.25C3.25 3.69772 3.69772 3.25 4.25 3.25C4.80228 3.25 5.25 3.69772 5.25 4.25ZM7.49502 5.95907L3.26557 9.80402C3.02768 10.0203 2.90873 10.1284 2.89821 10.2221C2.88909 10.3033 2.92023 10.3838 2.98159 10.4378C3.05239 10.5 3.21314 10.5 3.53464 10.5H8.22799C8.94757 10.5 9.30736 10.5 9.58996 10.3791C9.94472 10.2274 10.2274 9.94472 10.3791 9.58996C10.5 9.30736 10.5 8.94757 10.5 8.22799C10.5 7.98587 10.5 7.86482 10.4735 7.75208C10.4403 7.61039 10.3765 7.47768 10.2866 7.3632C10.2151 7.2721 10.1206 7.19647 9.93154 7.04523L8.53291 5.92633C8.34369 5.77495 8.24908 5.69927 8.1449 5.67256C8.05307 5.64901 7.95643 5.65206 7.86627 5.68135C7.76397 5.71457 7.67432 5.79607 7.49502 5.95907Z"/></svg>
                </button>
                <button class="seosonaflow-wf-tool-btn ${(this.mode === 'create' || this.isTemplateMode || this.isReadOnly()) ? 'hidden' : ''}" data-action="run-workflow" title="${window.I18n?.t('workflow.runShortcut') || 'Chạy (Ctrl+Enter)'}" data-tooltip="${window.I18n?.t('workflow.runShortcut') || 'Chạy (Ctrl+Enter)'}" data-tooltip-pos="right">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
                <button class="seosonaflow-wf-tool-btn hidden" data-action="stop-workflow" title="${window.I18n?.t('workflow.stopBtn') || 'Dừng'}" data-tooltip="${window.I18n?.t('workflow.stopBtn') || 'Dừng'}" data-tooltip-pos="right">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg>
                </button>
                <div class="seosonaflow-wf-tool-divider ${this.isReadOnly() ? 'hidden' : ''}"></div>
                <button class="seosonaflow-wf-tool-btn ${this.isReadOnly() ? 'hidden' : ''}" data-action="undo" id="wfUndoBtn" disabled title="${window.I18n?.t('workflow.undoShortcut') || 'Hoàn tác (Ctrl+Z)'}" data-tooltip="${window.I18n?.t('workflow.undoShortcut') || 'Hoàn tác (Ctrl+Z)'}" data-tooltip-pos="right">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>
                </button>
                <button class="seosonaflow-wf-tool-btn ${this.isReadOnly() ? 'hidden' : ''}" data-action="redo" id="wfRedoBtn" disabled title="${window.I18n?.t('workflow.redoShortcut') || 'Làm lại (Ctrl+Shift+Z)'}" data-tooltip="${window.I18n?.t('workflow.redoShortcut') || 'Làm lại (Ctrl+Shift+Z)'}" data-tooltip-pos="right">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>
                </button>
                <div class="seosonaflow-wf-tool-divider"></div>
                <button class="seosonaflow-wf-tool-btn" data-action="fit-screen" title="${window.I18n?.t('workflow.fitScreen') || 'Vừa màn hình (F)'}" data-tooltip="${window.I18n?.t('workflow.fitScreen') || 'Vừa màn hình (F)'}" data-tooltip-pos="right">
                  <svg width="18" height="18" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M64,496H184V464H64a16.019,16.019,0,0,1-16-16V328H16V448A48.054,48.054,0,0,0,64,496Z"></path><path fill="currentColor" d="M48,64A16.019,16.019,0,0,1,64,48H184V16H64A48.054,48.054,0,0,0,16,64V184H48Z"></path><path fill="currentColor" d="M448,16H328V48H448a16.019,16.019,0,0,1,16,16V184h32V64A48.054,48.054,0,0,0,448,16Z"></path><path fill="currentColor" d="M464,448a16.019,16.019,0,0,1-16,16H328v32H448a48.054,48.054,0,0,0,48-48V328H464Z"></path><path fill="currentColor" d="M400,256c0-79.4-64.6-144-144-144S112,176.6,112,256s64.6,144,144,144S400,335.4,400,256ZM256,368A112,112,0,1,1,368,256,112.127,112.127,0,0,1,256,368Z"></path></svg>
                </button>
                <button class="seosonaflow-wf-tool-btn ${this.isReadOnly() ? 'hidden' : ''}" data-action="rescan-thumbnails" title="${window.I18n?.t('workflow.rescanThumbs') || 'Quét lại ảnh từ Flow'}" data-tooltip="${window.I18n?.t('workflow.rescanThumbs') || 'Quét lại ảnh từ Flow'}" data-tooltip-pos="right">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                </button>
                <button class="seosonaflow-wf-tool-btn ${this.isReadOnly() ? 'hidden' : ''}" data-action="auto-layout" title="${window.I18n?.t('workflow.autoLayout') || 'Sắp xếp lại nodes'}" data-tooltip="${window.I18n?.t('workflow.autoLayout') || 'Sắp xếp lại nodes'}" data-tooltip-pos="right">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><line x1="9" y1="6" x2="15" y2="6"/><line x1="9" y1="18" x2="15" y2="18"/><line x1="6" y1="9" x2="6" y2="15"/><line x1="18" y1="9" x2="18" y2="15"/></svg>
                </button>
                <button class="seosonaflow-wf-tool-btn ${(this.isReadOnly() || this.isCreatorTemplate) ? 'hidden' : ''}" data-action="settings" title="${this.isTemplateMode ? (window.I18n?.t('workflow.templateSettings') || 'Cài đặt template') : (window.I18n?.t('workflow.settingsWorkflow') || 'Cài đặt workflow')}" data-tooltip="${this.isTemplateMode ? (window.I18n?.t('workflow.templateSettings') || 'Cài đặt template') : (window.I18n?.t('workflow.settingsWorkflow') || 'Cài đặt workflow')}" data-tooltip-pos="right">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
              </div>
            <div id="diagramContainer" style="flex: 1; position: relative;">
              <!-- Phase WK-1.5.2: Port legend (collapsed by default) -->
              <div class="wf-port-legend collapsed" id="wfPortLegend">
                <div class="wf-port-legend-toggle" id="wfPortLegendToggle" title="${window.I18n?.t('workflow.portTypes') || 'Loại port'}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                </div>
                <div class="wf-port-legend-content">
                  <div class="wf-port-legend-title">${window.I18n?.t('workflow.portTypes') || 'Loại port'}</div>
                  <div class="wf-port-legend-item"><span class="wf-port-dot wf-port-dot-text"></span>Text</div>
                  <div class="wf-port-legend-item"><span class="wf-port-dot wf-port-dot-image"></span>Image</div>
                  <div class="wf-port-legend-item"><span class="wf-port-dot wf-port-dot-video"></span>Video</div>
                  <div class="wf-port-legend-item"><span class="wf-port-dot wf-port-dot-frame"></span>Frame</div>
                  <div class="wf-port-legend-item"><span class="wf-port-dot wf-port-dot-any"></span>Any</div>
                </div>
              </div>
              ${this.isReadOnly() ? `
              <div class="wf-shared-banner" id="wfSharedBanner">
                <span class="wf-shared-banner-icon">👁️</span>
                <span class="wf-shared-banner-text">${
                  this.workflow?._is_admin_view
                    ? (window.I18n?.t('workflow.adminPreviewReadOnly', { owner: this.workflow?._owner_name || this.workflow?._owner_email || 'User' }) || `Đang xem workflow của ${this.workflow?._owner_name || this.workflow?._owner_email || 'User'} (chỉ xem)`)
                    : this.workflow?._is_template_preview
                      ? (window.I18n?.t('workflow.templatePreviewReadOnly') || 'This is a template (preview). Duplicate to use.')
                      : (window.I18n?.t('workflow.sharedReadOnly') || 'This is a shared workflow (view only).')
                }</span>
                ${!this.workflow?._is_admin_view ? `
                <button class="wf-shared-banner-btn" id="wfDuplicateSharedBtn">${
                  this.workflow?._is_template_preview
                    ? (window.I18n?.t('workflow.copyTemplateBtn') || 'Sao chép template')
                    : (window.I18n?.t('workflow.duplicateToUse') || 'Duplicate để sử dụng')
                }</button>
                ` : ''}
              </div>
              ` : ''}
              <!-- UI#1 (học Magnific 'Your space is ready'): overlay khi canvas trống → chọn node đầu tiên.
                   Backdrop pointer-events:none, chỉ cụm card bắt click → không chặn thao tác canvas. -->
              <div class="wf-canvas-empty" id="wfCanvasEmpty" aria-hidden="true">
                <div class="wf-canvas-empty-inner">
                  <h3 class="wf-canvas-empty-title">${window.I18n?.t('workflow.canvasEmptyTitle') || 'Bắt đầu workflow của bạn'}</h3>
                  <p class="wf-canvas-empty-sub">${window.I18n?.t('workflow.canvasEmptySub') || 'Chọn node đầu tiên để dựng luồng tạo ảnh/video tự động.'}</p>
                  <div class="wf-canvas-empty-cards">
                    <button class="wf-firstnode-card" data-node-type="prompt">
                      <span class="wf-firstnode-ic" data-k="prompt"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/><path d="M12 4v16"/></svg></span>
                      <span class="wf-firstnode-tt">${window.I18n?.t('node.promptName') || 'Prompt'}</span>
                      <span class="wf-firstnode-ds">${window.I18n?.t('workflow.firstnodePromptDesc') || 'Soạn & tinh chỉnh prompt'}</span>
                    </button>
                    <button class="wf-firstnode-card" data-node-type="image">
                      <span class="wf-firstnode-ic" data-k="image"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></span>
                      <span class="wf-firstnode-tt">${window.I18n?.t('node.imageName') || 'Ảnh tham chiếu'}</span>
                      <span class="wf-firstnode-ds">${window.I18n?.t('workflow.firstnodeImageDesc') || 'Thêm ảnh vào canvas'}</span>
                    </button>
                    <button class="wf-firstnode-card" data-node-type="generate">
                      <span class="wf-firstnode-ic" data-k="flow"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/></svg></span>
                      <span class="wf-firstnode-tt">${window.I18n?.t('workflow.firstnodeFlow') || 'Tạo ảnh/video (Flow)'}</span>
                      <span class="wf-firstnode-ds">${window.I18n?.t('workflow.firstnodeFlowDesc') || 'Sinh media trên Google Flow'}</span>
                    </button>
                    <button class="wf-firstnode-card" data-node-type="chatgpt">
                      <span class="wf-firstnode-ic" data-k="openai"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
                      <span class="wf-firstnode-tt">ChatGPT</span>
                      <span class="wf-firstnode-ds">${window.I18n?.t('workflow.firstnodeChatgptDesc') || 'Sinh ảnh qua ChatGPT'}</span>
                    </button>
                    <button class="wf-firstnode-card" data-node-type="grok">
                      <span class="wf-firstnode-ic" data-k="grok"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.09 6.26L20 11l-5.91 1.74L12 19l-2.09-6.26L4 11l5.91-1.74z"/></svg></span>
                      <span class="wf-firstnode-tt">Grok</span>
                      <span class="wf-firstnode-ds">${window.I18n?.t('workflow.firstnodeGrokDesc') || 'Sinh ảnh/video qua Grok'}</span>
                    </button>
                  </div>
                  <button class="wf-canvas-empty-more" id="wfCanvasEmptyMore">${window.I18n?.t('workflow.firstnodeMore') || '＋ Node khác…'}</button>
                </div>
              </div>
            </div>
            ${(!this.isTemplateMode && !this.isReadOnly()) ? `
            <div class="execution-log-panel hidden" id="executionLogPanel">
              <div class="execution-log-header">
                <span class="execution-log-title">${window.I18n?.t('workflow.executionProgress') || 'Tiến độ thực thi'}</span>
                <div class="execution-log-progress">
                  <span id="editorProgressText">0 / 0</span>
                  <div class="execution-log-progress-bar">
                    <div class="execution-log-progress-fill" id="editorProgressFill" style="width: 0%"></div>
                  </div>
                </div>
                <button class="execution-log-toggle" id="toggleLogPanelBtn" title="${window.I18n?.t('workflow.collapse') || 'Thu gọn'}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 15 12 9 18 15"></polyline>
                  </svg>
                </button>
              </div>
              <div class="execution-log-body" id="executionLogBody"></div>
            </div>
            ` : ''}
          </div>
          <div class="node-form-panel hidden" id="nodeFormPanel">
            <div class="node-form-resize-handle" id="nodeFormResizeHandle" title="${window.I18n?.t('workflow.resizeHandle') || 'Kéo để thay đổi kích thước'}"></div>
            <div class="node-form-header">
              <div class="node-form-tabs" id="nodeFormTabs">
                <button class="node-form-tab active" data-tab="config">${window.I18n?.t('workflow.configTab') || 'Cấu hình'}</button>
                <button class="node-form-tab ${this.isTemplateMode ? 'hidden' : ''}" data-tab="result">${window.I18n?.t('workflow.resultTab') || 'Kết quả'}</button>
                <button class="node-form-tab hidden" data-tab="help" id="nodeFormHelpTab" title="${window.I18n?.t('workflow.helpTab') || 'Hướng dẫn'}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                </button>
              </div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <button class="node-form-close ${(this.isTemplateMode || this.isReadOnly()) ? 'hidden' : ''}" id="runSingleNodeBtn" title="${window.I18n?.t('workflow.runThisNode') || 'Chạy node này'}" style="color: var(--success, #19d07b);">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </button>
                <button class="node-form-close hidden" id="downloadNodeBtn" title="${window.I18n?.t('workflow.downloadResults') || 'Tải file kết quả'}" style="color: var(--primary, #3d6ff5);">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button class="node-form-close ${(this.isTemplateMode || this.isReadOnly()) ? 'hidden' : ''}" id="resetSingleNodeBtn" title="${window.I18n?.t('workflow.resetThisNode') || 'Reset node này'}" style="color: var(--warning, #f59e0b);">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                </button>
                <button class="node-form-close node-form-toggle-enabled ${this.isReadOnly() ? 'hidden' : ''}" id="toggleEnabledBtn" title="${window.I18n?.t('workflow.enabledToggle') || 'Bật/Tắt node'}" data-enabled="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                </button>
                <button class="node-form-close ${this.isReadOnly() ? 'hidden' : ''}" id="deleteNodeBtn" title="${window.I18n?.t('workflow.deleteNodeBtn') || 'Xóa node'}" style="color: var(--destructive, #ef4444);">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
                <button class="node-form-close" id="closeNodeFormBtn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            </div>
            <div class="node-form-body" id="nodeFormBody">
              <!-- Config tab content -->
            </div>
            <div class="node-form-body hidden" id="nodeResultBody">
              <!-- Result tab content -->
            </div>
            <div class="node-form-body hidden" id="nodeHelpBody">
              <!-- Help tab content (per-node-type guide) -->
            </div>
            <div class="node-form-footer" id="nodeFormFooter">
              <button class="btn btn-secondary btn-sm" id="closeNodeFormBtn2">${window.I18n?.t('workflow.closeBtn') || 'Close'}</button>
              <button class="btn btn-warning btn-sm hidden ${this.isReadOnly() ? 'wf-readonly-hide' : ''}" id="resetNodeFooterBtn" title="${window.I18n?.t('workflow.resetThisNode') || 'Reset node này'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                Reset
              </button>
              <button class="btn btn-primary btn-sm ${this.isReadOnly() ? 'hidden' : ''}" id="saveNodeBtn">${window.I18n?.t('workflow.saveNode') || 'Lưu Node'}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
  }

  renderPalette() {
    const activeTypes = ['generate', 'download', 'telegram', 'delay', 'note'];
    return activeTypes.map(type =>
      NodeTemplates.createPaletteItem(type)
    ).join('');
  }

  initComponents() {
    // Initialize DiagramCanvas
    const diagramContainer = this.overlay.querySelector('#diagramContainer');
    if (diagramContainer) {
      // EWT-11: Truyền isTemplateMode vào DiagramCanvas để ẩn các UI execution-related
      // Truyền isReadOnly để disable drag-drop và connection creation
      // Admin preview: cho phép xem chi tiết node (gear icon vẫn clickable)
      const isAdminPreview = this.workflow?._is_admin_view === true;
      this.diagramCanvas = new DiagramCanvas(diagramContainer, {
        isTemplateMode: this.isTemplateMode,
        isReadOnly: this.isReadOnly(),
        isAdminPreview: isAdminPreview
      });

      // Nhét log/export/share vào zoom toolbar bottom-left có sẵn (.canvas-controls) — dùng chung, không tạo toolbar mới.
      try { this._injectCanvasToolButtons(diagramContainer); } catch (e) { console.warn('[WorkflowEditor] injectCanvasToolButtons failed:', e?.message); }

      // Initialize undo/redo history (Ctrl+Z / Ctrl+Shift+Z)
      this.history = window.WorkflowHistory ? new window.WorkflowHistory(this) : null;
      this._bindHistoryEvents();

      // Load existing workflow - delay to let DOM layout + Drawflow init complete
      // Cả 'edit', 'view' (shared workflow read-only), và 'admin_preview' đều cần load nodes/edges
      if ((this.mode === 'edit' || this.mode === 'view' || this.mode === 'admin_preview') && this.workflow.nodes?.length > 0) {
        // Double rAF + timeout ensures canvas has dimensions before adding nodes
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              this.diagramCanvas.loadWorkflow(this.workflow);
              this._restoreNodeStates();
              // Auto-generate slugs for mentionable nodes that don't have one (migration for old nodes)
              this._ensureSlugsForMentionableNodes();
              // 2026-05-31 Rescan Tier 1: auto-recover broken thumbnails sau khi workflow load.
              // Defer 800ms để Flow tab có thời gian render tiles (nếu vừa mở). Silent, no toast.
              setTimeout(() => { this._autoRescanBrokenThumbs?.(); }, 800);
              // Task 4.11: Cleanup stale recent mentions
              if (this.workflow?.id) {
                const allSlugs = (this.workflow.nodes || [])
                  .filter(n => this._isMentionableNodeType(n.node_type))
                  .map(n => n.slug)
                  .filter(Boolean);
                this._cleanupRecentMentions(this.workflow.id, allSlugs);
              }
              try { this._bindPortLegendToggle(); } catch (e) { /* ignore */ }
              try { this._bindEdgeHoverTooltips(); } catch (e) { /* ignore */ }
              try { this._bindEmptyPortClicks(); } catch (e) { /* ignore */ }
              try { this._bindInlineSettingPills(); } catch (e) { /* ignore */ }
              try { this._scheduleRefreshNodeWarningBadges(); } catch (e) { /* ignore */ }
              try { this._updatePortEmptyState(); } catch (e) { /* ignore */ }
              try { this._refreshAllPromptSourceBadges(); } catch (e) { /* ignore */ }
              try { this._bindCanvasEmptyState(); this._updateCanvasEmptyState(); } catch (e) { /* ignore */ }
              try { this._takeInitialHistorySnapshot(); } catch (e) { /* ignore */ }
              // Force re-route TẤT CẢ connections sau khi load — port positions
              // mới (input -32px, output -5px) khác với positions Drawflow lưu
              // lúc addConnection. Multi-retry để đảm bảo CSS/layout đã settle.
              // Bug fix: Thêm delays lớn hơn (2000, 3000ms) để đợi images load xong —
              // khi images load, node size thay đổi và connections cần được update lại.
              [50, 200, 500, 1000, 2000, 3000].forEach((delay) => {
                setTimeout(() => {
                  try { this.diagramCanvas?._forceUpdateAllConnections?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#initComponents', e); }
                }, delay);
              });
            }, 100);
          });
        });
      } else {
        // Create mode: bind ngay sau init
        setTimeout(() => {
          try { this._bindPortLegendToggle(); } catch (e) { /* ignore */ }
          try { this._bindEdgeHoverTooltips(); } catch (e) { /* ignore */ }
          try { this._bindEmptyPortClicks(); } catch (e) { /* ignore */ }
          try { this._bindInlineSettingPills(); } catch (e) { /* ignore */ }
          try { this._bindCanvasEmptyState(); this._updateCanvasEmptyState(); } catch (e) { /* ignore */ }
          try { this._takeInitialHistorySnapshot(); } catch (e) { /* ignore */ }
        }, 50);
      }
    }
  }

  /**
   * UI#1: Empty-state canvas — bind click card node-type (thêm node đầu tiên) + nút "Node khác".
   * Đăng ký eventBus node:created/removed để tự ẩn/hiện. Idempotent (guard cờ).
   */
  _bindCanvasEmptyState() {
    const el = this.overlay?.querySelector('#wfCanvasEmpty');
    if (!el) return;
    if (!el._wfBound) {
      el._wfBound = true;
      el.addEventListener('click', async (e) => {
        const more = e.target.closest('#wfCanvasEmptyMore');
        if (more) {
          e.stopPropagation();
          const rect = this.overlay?.querySelector('#diagramContainer')?.getBoundingClientRect();
          const px = rect ? rect.width / 2 : 400;
          const py = rect ? rect.height / 2 : 260;
          this._showNodePicker(px, py);
          return;
        }
        const card = e.target.closest('.wf-firstnode-card');
        if (!card) return;
        e.stopPropagation();
        const type = card.dataset.nodeType;
        if (!type) return;
        try { await this._createNodeFromPicker(type, 360, 220, null); } catch (err) { console.warn('[WorkflowEditor] first-node add failed:', err?.message); }
        this._updateCanvasEmptyState();
      });
    }
    if (!this._canvasEmptyHooked && window.eventBus) {
      this._canvasEmptyHooked = true;
      this._canvasEmptyUpd = () => { try { this._updateCanvasEmptyState(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_canvasEmptyUpd', _); } };
      window.eventBus.on('node:created', this._canvasEmptyUpd);
      window.eventBus.on('node:removed', this._canvasEmptyUpd);
      window.eventBus.on('nodes:delete_multi', this._canvasEmptyUpd);
    }
  }

  /**
   * [U2] Drain prompt từ "Phân tích ảnh → Gửi vào node" (chuột phải) → TẠO node Text chứa prompt
   * (giữa canvas). updateNodeData(id,{prompt}) là pattern set nội dung text-node có sẵn. Claim key
   * (remove) TRƯỚC khi tạo → chống drain 2 lần (onChanged + setTimeout). Busy-flag chống race.
   */
  async _drainPendingNodePrompt() {
    if (this._nodeDrainBusy) return;
    if (!this.diagramCanvas || (this.isReadOnly && this.isReadOnly())) return;
    this._nodeDrainBusy = true;
    try {
      const st = await chrome.storage.local.get(['i2p_pending_node_prompt']);
      const p = st.i2p_pending_node_prompt;
      if (!p || !p.text) return;
      if (p.at && Date.now() - p.at > 3600000) { await chrome.storage.local.remove('i2p_pending_node_prompt'); return; }
      await chrome.storage.local.remove('i2p_pending_node_prompt'); // claim trước → không drain lại
      const rect = this.overlay?.querySelector('#diagramContainer')?.getBoundingClientRect();
      const px = rect ? rect.width / 2 : 360, py = rect ? rect.height / 2 : 220;
      const newId = await this._createNodeFromPicker('text', px, py, null);
      if (newId != null && this.diagramCanvas.updateNodeData) {
        this.diagramCanvas.updateNodeData(newId, { prompt: p.text });
      }
      try { window.showNotification?.(window.I18n?.t('workflow.nodeFromImage') || 'Đã thêm node Text từ ảnh phân tích', 'success', 2200); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_drainPendingNodePrompt', _); }
    } catch (e) {
      console.warn('[WorkflowEditor] drain node prompt failed:', e?.message);
    } finally {
      this._nodeDrainBusy = false;
    }
  }

  /**
   * UI#1: Hiện overlay empty-state khi canvas 0 node (và không read-only). Lỗi → ẩn (an toàn).
   */
  _updateCanvasEmptyState() {
    const el = this.overlay?.querySelector('#wfCanvasEmpty');
    if (!el) return;
    if (this.isReadOnly && this.isReadOnly()) {
      el.classList.remove('is-visible');
      el.setAttribute('aria-hidden', 'true');
      return;
    }
    let count = 1;
    try {
      const data = this.diagramCanvas?.editor?.export?.();
      count = Object.keys(data?.drawflow?.Home?.data || {}).length;
    } catch (_) { count = 1; }
    const empty = count === 0;
    el.classList.toggle('is-visible', empty);
    el.setAttribute('aria-hidden', empty ? 'false' : 'true');
  }

  /**
   * Phase WK-1.5.2: Toggle port legend collapse/expand on canvas.
   */
  _bindPortLegendToggle() {
    const legend = this.overlay?.querySelector('#wfPortLegend');
    const toggle = this.overlay?.querySelector('#wfPortLegendToggle');
    if (!legend || !toggle || toggle._wfBound) return;
    toggle._wfBound = true;
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      legend.classList.toggle('collapsed');
    });
  }

  /**
   * Phase WK-1.5.4: Edge tooltip on hover — preview source/target ports.
   */
  _bindEdgeHoverTooltips() {
    const container = this.overlay?.querySelector('#diagramContainer');
    if (!container || container._wfEdgeTooltipBound) return;
    container._wfEdgeTooltipBound = true;

    let tooltip = document.getElementById('wfEdgeTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'wfEdgeTooltip';
      tooltip.className = 'wf-edge-tooltip hidden';
      document.body.appendChild(tooltip);
    }

    const showTooltip = (path) => {
      const svg = path.closest('svg.connection');
      if (!svg) return;
      const cls = svg.getAttribute('class') || '';
      const inMatch = cls.match(/node_in_node-(\d+)/);
      const outMatch = cls.match(/node_out_node-(\d+)/);
      const outClsMatch = cls.match(/(output_\d+)/);
      const inClsMatch = cls.match(/(input_\d+)/);
      if (!inMatch || !outMatch) return;

      const sourceId = outMatch[1];
      const targetId = inMatch[1];
      const editor = this.diagramCanvas?.editor;
      if (!editor) return;

      let sourceNode = null, targetNode = null;
      try { sourceNode = editor.getNodeFromId(sourceId); } catch (e) { /* ignore */ }
      try { targetNode = editor.getNodeFromId(targetId); } catch (e) { /* ignore */ }
      if (!sourceNode || !targetNode) return;

      const sourcePortName = sourceNode.data?._port_map?.[outClsMatch?.[1]] || 'default';
      const targetPortName = targetNode.data?._port_map?.[inClsMatch?.[1]] || 'default';
      const sourceLabel = sourceNode.data?.node_name || sourceNode.class || 'Source';
      const targetLabel = targetNode.data?.node_name || targetNode.class || 'Target';

      tooltip.innerHTML = `
        <div class="wf-edge-tooltip-title">${this.escapeHtml(sourceLabel)}</div>
        <div class="wf-edge-tooltip-flow">
          <span class="wf-edge-tooltip-port">${this.escapeHtml(sourcePortName)}</span>
          <span>&rarr;</span>
          <span class="wf-edge-tooltip-port">${this.escapeHtml(targetPortName)}</span>
        </div>
        <div class="wf-edge-tooltip-target">${this.escapeHtml(targetLabel)}</div>
      `;
      tooltip.classList.remove('hidden');
      const rect = path.getBoundingClientRect();
      const left = rect.left + rect.width / 2;
      const top = Math.max(8, rect.top - 60);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    container.addEventListener('mouseover', (e) => {
      const path = e.target.closest && e.target.closest('svg.connection .main-path, svg.connection path');
      if (!path) return;
      try { showTooltip(path); } catch (err) { /* ignore */ }
    });

    container.addEventListener('mouseout', (e) => {
      if (!e.target.closest || !e.target.closest('svg.connection')) {
        tooltip.classList.add('hidden');
      }
    });
  }

  /**
   * 2026-05-25: Debounced wrapper. Coalesce burst calls (paste workflow / multi-edit
   * trigger 10+ calls trong < 100ms → debounce 200ms last-wins → 1 lần scan).
   * Internal calls dùng wrapper này. Direct `_refreshAllNodeWarningBadges()` chỉ
   * giữ cho test/debug — production code phải qua schedule.
   */
  _scheduleRefreshNodeWarningBadges() {
    if (this._warningBadgesRefreshTimer) clearTimeout(this._warningBadgesRefreshTimer);
    this._warningBadgesRefreshTimer = setTimeout(() => {
      this._warningBadgesRefreshTimer = null;
      try { this._refreshAllNodeWarningBadges(); } catch (e) { /* ignore */ }
    }, 200);
  }

  /**
   * Phase WK-1.5.3: Quét tất cả nodes → cập nhật warning badges cho nodes có required port chưa connect.
   */
  _refreshAllNodeWarningBadges() {
    try {
      const editor = this.diagramCanvas?.editor;
      if (!editor) return;
      const data = editor.export();
      const nodes = data?.drawflow?.Home?.data || {};
      for (const [drawflowId, nodeInfo] of Object.entries(nodes)) {
        const type = nodeInfo.class;
        const ports = (typeof NodeTemplates?.getNodePorts === 'function')
          ? NodeTemplates.getNodePorts(type, nodeInfo.data) : null;
        if (!ports || !ports.in || ports.in.length === 0) {
          this._updateNodeWarningBadge(drawflowId, false);
          continue;
        }
        let hasUnfilled = false;
        ports.in.forEach((port, idx) => {
          if (!port.required) return;
          const inputClass = `input_${idx + 1}`;
          const conns = nodeInfo.inputs?.[inputClass]?.connections || [];
          if (conns.length === 0) hasUnfilled = true;
        });
        this._updateNodeWarningBadge(drawflowId, hasUnfilled);
      }
    } catch (e) { /* ignore */ }
  }

  /**
   * Re-validate edges connected vào/ra node sau khi data đổi.
   * Remove edges có port type incompatible (theo PORT_COMPAT) — vd toggle media_type Image→Video
   * khiến port out `media` chuyển từ 'image' → 'video', edge tới input 'image' của node khác
   * thành incompat → cần gỡ.
   *
   * Backward-compat: edges legacy (không có _port_map) skip validation, không gỡ.
   * Idempotent: gọi nhiều lần an toàn, chỉ gỡ edges thực sự incompat tại thời điểm gọi.
   *
   * @param {string|number} drawflowId Drawflow ID của node vừa thay đổi data
   * @returns {number} số edges đã remove
   */
  _revalidateNodeEdges(drawflowId) {
    const editor = this.diagramCanvas?.editor;
    if (!editor || !window.NodeTemplates) return 0;
    const PORT_COMPAT = window.NodeTemplates.PORT_COMPAT || {};
    const moduleKey = editor.module || 'Home';
    const moduleData = editor.drawflow?.drawflow?.[moduleKey]?.data;
    if (!moduleData || !moduleData[drawflowId]) return 0;

    let removedCount = 0;
    const allNodes = Object.values(moduleData);

    // Set suppress flag để gỡ edges KHÔNG trigger _syncFrameSourceOnDisconnect clear data
    // (giống pattern _resizeNodePorts trong DiagramCanvas)
    if (this.diagramCanvas) this.diagramCanvas._suppressFrameSyncOnResize = true;
    try {
      // Drawflow edge structure (per node):
      //   node.outputs[output_class] = { connections: [{ node: targetDfId, output: targetInputClass }] }
      //   node.inputs[input_class]   = { connections: [{ node: sourceDfId, input:  sourceOutputClass }] }
      // Để tìm edges chạm node này, scan TẤT CẢ outputs của TẤT CẢ nodes (mỗi edge có 1 entry duy nhất tại source).
      for (const node of allNodes) {
        const sourceDfId = node.id;
        for (const [outClass, outData] of Object.entries(node.outputs || {})) {
          const conns = outData?.connections || [];
          // Copy array vì có thể modify trong loop (removeSingleConnection mutates source)
          for (const conn of [...conns]) {
            const targetDfId = conn.node;
            const targetInputClass = conn.output; // Drawflow naming: trong outputs.connections, `output` field = input_class của target

            // Skip edges không liên quan node vừa đổi data
            if (String(sourceDfId) !== String(drawflowId) && String(targetDfId) !== String(drawflowId)) continue;

            const sourceNode = moduleData[sourceDfId];
            const targetNode = moduleData[targetDfId];
            if (!sourceNode || !targetNode) continue;

            // Backward-compat: legacy edge không có _port_map → skip (giống logic line 1031)
            const sourcePortName = sourceNode.data?._port_map?.[outClass];
            const targetPortName = targetNode.data?._port_map?.[targetInputClass];
            if (!sourcePortName || !targetPortName) continue;

            // Get port types từ NEW data (đã update qua updateNodeDataFromId)
            const sourceType = sourceNode.class || sourceNode.data?.node_type;
            const targetType = targetNode.class || targetNode.data?.node_type;
            // SAFETY: legacy data corrupt thiếu type → skip thay vì gỡ (tránh xoá nhầm hàng loạt edges)
            if (!sourceType || !targetType) continue;

            const sourcePorts = window.NodeTemplates.getNodePorts(sourceType, sourceNode.data || {});
            const targetPorts = window.NodeTemplates.getNodePorts(targetType, targetNode.data || {});
            const sourcePort = sourcePorts.out.find(p => p.name === sourcePortName);
            const targetPort = targetPorts.in.find(p => p.name === targetPortName);
            // Nếu port không còn (visibleWhen=false sau toggle, vd Video→Image làm frame_1/frame_2 disappear)
            // → gỡ edge này (intent: clean up edges đến ports đã ẩn)
            if (!sourcePort || !targetPort) {
              try {
                editor.removeSingleConnection(sourceDfId, targetDfId, outClass, targetInputClass);
                removedCount++;
                console.log(`[WorkflowEditor] Removed edge with missing port: ${sourcePortName} → ${targetPortName}`);
              } catch (e) {
                console.warn('[WorkflowEditor] Failed to remove edge with missing port:', e);
              }
              continue;
            }

            // Validate compat
            const compat = PORT_COMPAT[sourcePort.type] || [];
            if (!compat.includes(targetPort.type)) {
              try {
                editor.removeSingleConnection(sourceDfId, targetDfId, outClass, targetInputClass);
                removedCount++;
                console.log(`[WorkflowEditor] Removed incompatible edge: ${sourcePort.type} → ${targetPort.type} (${sourcePortName} → ${targetPortName})`);
              } catch (e) {
                console.warn('[WorkflowEditor] Failed to remove incompatible edge:', e);
              }
            }
          }
        }
      }
    } finally {
      if (this.diagramCanvas) this.diagramCanvas._suppressFrameSyncOnResize = false;
    }

    return removedCount;
  }

  /**
   * Phase WK-1.5.3: Update warning badge on node card khi có required port chưa connect.
   * @param {string|number} nodeId Drawflow node ID
   * @param {boolean} hasUnfilledRequired
   */
  _updateNodeWarningBadge(nodeId, hasUnfilledRequired) {
    const nodeEl = this.overlay?.querySelector(`#node-${nodeId} .df-node`);
    if (!nodeEl) return;
    let badge = nodeEl.querySelector('.df-node-warning-badge');
    if (hasUnfilledRequired) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'df-node-warning-badge';
        badge.title = window.I18n?.t('workflow.portWarning') || 'Node có port required chưa connect';
        badge.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 22h20L12 2zm0 6l7 12H5l7-12zm0 4v3h-1v-3h1zm0 5v1h-1v-1h1z"/></svg>';
        nodeEl.appendChild(badge);
      }
    } else {
      if (badge) badge.remove();
    }
  }

  /**
   * Refresh prompt source inline indicator trong right sidebar form.
   * Cập nhật indicator khi connections thay đổi (edge created/removed).
   */
  _refreshAllPromptSourceBadges() {
    if (!this.selectedNodeId) return;
    try {
      const editor = this.diagramCanvas?.editor;
      const overlay = this.overlay;
      if (!editor || !overlay) return;

      const drawflowId = this._findDrawflowId
        ? this._findDrawflowId(this.selectedNodeId)
        : this.selectedNodeId;
      const node = editor.getNodeFromId(drawflowId);
      if (!node) return;

      const NODE_TYPES = ['generate', 'chatgpt', 'grok'];
      const type = node.data?.node_type || node.class;
      if (!NODE_TYPES.includes(type)) return;

      const promptSourceRow = overlay.querySelector('.prompt-source-row');
      if (!promptSourceRow) return;

      // Remove old indicators
      promptSourceRow.querySelector('.prompt-source-inline-indicator')?.remove();
      promptSourceRow.querySelector('.prompt-source-inline-warning')?.remove();

      // Check toggle state - only show indicator when using upstream
      const toggle = overlay.querySelector('#promptSourceToggle');
      if (toggle?.checked) return; // Using own prompt, no indicator needed

      // Check tất cả inputs để tìm upstream Prompt node
      let upstreamNode = null;
      const allInputKeys = Object.keys(node.inputs || {});
      for (const inputKey of allInputKeys) {
        const conns = node.inputs?.[inputKey]?.connections || [];
        for (const conn of conns) {
          const srcNode = editor.getNodeFromId(conn.node);
          const srcType = srcNode?.data?.node_type || srcNode?.class;
          if (srcType === 'prompt') {
            upstreamNode = srcNode;
            break;
          }
        }
        if (upstreamNode) break;
      }

      const promptSourceIcon = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.17 3.646a.5.5 0 0 1 .707 0l5.477 5.477a.5.5 0 0 1 0 .707l-1.366 1.366a4.373 4.373 0 1 1-6.184-6.184L6.17 3.646Zm.353 1.061L5.508 5.723 5.5 5.73a3.373 3.373 0 1 0 4.77 4.77l.006-.008 1.016-1.015-4.77-4.77Z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M5.354 10.646a.5.5 0 0 1 0 .707L3.02 13.688a.5.5 0 1 1-.707-.707l2.334-2.334a.5.5 0 0 1 .707 0ZM10.354 2.313a.5.5 0 0 1 0 .707L8.02 5.354a.5.5 0 0 1-.707-.708l2.334-2.333a.5.5 0 0 1 .707 0ZM13.687 5.646a.5.5 0 0 1 0 .708l-2.333 2.333a.5.5 0 1 1-.707-.707l2.333-2.334a.5.5 0 0 1 .707 0Z" fill="currentColor"></path></svg>';

      if (upstreamNode) {
        const upstreamName = upstreamNode?.data?.node_name
          || upstreamNode?.data?.prompt?.substring(0, 30)
          || 'Prompt';
        const displayName = upstreamName.length > 15 ? upstreamName.substring(0, 15) + '…' : upstreamName;
        const indicator = document.createElement('span');
        indicator.className = 'prompt-source-inline-indicator';
        indicator.title = upstreamName;
        indicator.innerHTML = `${promptSourceIcon}<span>${this.escapeHtml(displayName)}</span>`;
        promptSourceRow.appendChild(indicator);
      } else {
        const warning = document.createElement('span');
        warning.className = 'prompt-source-inline-warning';
        warning.title = window.I18n?.t('workflow.noUpstreamPrompt') || 'Chưa connect upstream Prompt node';
        warning.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
        promptSourceRow.appendChild(warning);
      }
    } catch (e) { /* ignore */ }
  }

  /** @deprecated giữ để không break gọi cũ — no-op vì banner đã chuyển sang sidebar */
  _updatePromptSourceBadge(_nodeId, _upstreamName) { /* no-op */ }

  _restoreNodeStates() {
    if (!this.workflow?.nodes) return;

    let allCompleted = true;
    let hasAny = false;

    for (const node of this.workflow.nodes) {
      hasAny = true;

      // Pre-populate _tileCache from saved thumbnails (survives reload)
      if (node.result_thumbnails && typeof node.result_thumbnails === 'object') {
        console.log(`[WorkflowEditor] Pre-populate cache for node "${node.node_name}": result_thumbnails keys=`, Object.keys(node.result_thumbnails), 'result_file_ids=', node.result_file_ids);
        for (const [fileId, thumbVal] of Object.entries(node.result_thumbnails)) {
          if (fileId && thumbVal && !this._tileCache.has(fileId)) {
            // Handle both formats: string (URL) or object { thumbnail, type, video_url }
            if (typeof thumbVal === 'object' && thumbVal.thumbnail) {
              // Bug 51 fix: Include video_url for video playback after reload
              this._tileCacheSet(fileId, {
                thumbnail: thumbVal.thumbnail,
                type: thumbVal.type || 'image',
                ...(thumbVal.video_url && { video_url: thumbVal.video_url })
              });
            } else if (typeof thumbVal === 'string') {
              this._tileCacheSet(fileId, { thumbnail: thumbVal, type: 'image' });
            }
          }
        }
      }
      // Pre-populate _tileCache from saved ref thumbnails (survives reload)
      // Chỉ lấy entries có trong ref_file_ids hiện tại (tránh stale entries)
      console.log(`[WorkflowEditor] Pre-populate ref_thumbnails for node "${node.node_name}" (${node.node_type}): ref_thumbnails keys=${Object.keys(node.ref_thumbnails || {}).join(',') || '(none)'}, ref_file_ids="${node.ref_file_ids || ''}"`);
      if (node.ref_thumbnails && typeof node.ref_thumbnails === 'object') {
        const activeRefIds = node.ref_file_ids
          ? new Set(node.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean))
          : null;
        for (const [fileId, thumbVal] of Object.entries(node.ref_thumbnails)) {
          // 2026-05-27: thumbVal có thể là string (URL) hoặc object {thumbnail, type:'video', video_url}
          // 2026-05-31 fix: restore cả video_url + chấp nhận thumbnail empty cho video tile
          const isObj = thumbVal && typeof thumbVal === 'object';
          const thumbUrl = isObj ? (thumbVal.thumbnail || '') : (thumbVal || '');
          const videoUrl = isObj ? (thumbVal.video_url || '') : '';
          const refType = (isObj && thumbVal.type === 'video') ? 'video' : 'image';
          // Cache khi: có thumbnail HOẶC có video_url HOẶC là video type (cho placeholder)
          const hasAnyData = thumbUrl || videoUrl || refType === 'video';
          if (fileId && hasAnyData && !this._tileCache.has(fileId)) {
            if (!activeRefIds || activeRefIds.has(fileId)) {
              this._tileCacheSet(fileId, {
                thumbnail: thumbUrl,
                type: refType,
                ...(videoUrl && { video_url: videoUrl }),
              });
            }
          }
        }
      }
      // Restore result_file_names into _tileCache metadata (for correction lookups)
      if (node.result_file_names && typeof node.result_file_names === 'object') {
        for (const [fileId, fileName] of Object.entries(node.result_file_names)) {
          if (fileId && fileName) {
            const cached = this._tileCache.get(fileId);
            if (cached) {
              cached.file_name = fileName;
            }
          }
        }
      }
      // Restore ref_file_names into _tileCache metadata (for correction lookups) - Phase R
      // Chỉ lấy entries có trong ref_file_ids hiện tại
      if (node.ref_file_names && typeof node.ref_file_names === 'object') {
        const activeRefIds2 = node.ref_file_ids
          ? new Set(node.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean))
          : null;
        for (const [fileId, fileName] of Object.entries(node.ref_file_names)) {
          if (fileId && fileName && (!activeRefIds2 || activeRefIds2.has(fileId))) {
            const cached = this._tileCache.get(fileId);
            if (cached) {
              cached.file_name = fileName;
            } else {
              // Create cache entry with file_name for correction
              this._tileCacheSet(fileId, { file_name: fileName });
            }
          }
        }
      }

      // Restore status UI (completed, failed, etc.)
      // Luôn gọi kể cả pending để clear CSS classes cũ (node-completed, node-failed) sau reset
      if (node.status) {
        this._updateNodeStatusUI(node.node_id, node.status);
      }

      if (node.status !== 'completed') {
        allCompleted = false;
      }

      // Restore previews from _tileCache only (no MessageBridge scan here).
      // Missing thumbnails will be handled by _backgroundThumbnailScan later.
      if (node.status === 'completed' && node.result_file_ids) {
        const fileIds = node.result_file_ids.split(',').map(s => s.trim()).filter(Boolean);
        const cachedIds = fileIds.filter(id => this._tileCache.has(id));
        console.log(`[WorkflowEditor] Restore preview for node "${node.node_name}": fileIds=`, fileIds, 'cached=', cachedIds.length, '/', fileIds.length);
        if (fileIds.length > 0 && cachedIds.length > 0) {
          this._directRenderNodePreview(node.node_id, fileIds);
        }
      }

      // 2026-05-31 REVERTED: bỏ _showNodeRefPreview trigger ở đây — gây regression mất
      // result preview. _directRenderNodeRefFromCache ở dưới (line ~2537) đã handle ref
      // preview render cho image refs. Video refs sẽ hiển thị placeholder play icon (chấp
      // nhận) thay vì <video> element — better than data loss.

      // Template mode hoặc template preview: hiển thị ref images từ ref_img_urls hoặc ref_thumbnails trên node diagram
      const isTemplateContext = this.isTemplateMode || this.workflow?._is_template_preview || this.workflow?._isPreview;

      // Template mode: hiển thị result từ result_img_url hoặc result_thumbnails
      if (isTemplateContext) {
        if (node.result_img_url) {
          this._renderTemplateResultOnNode(node.node_id, node.result_img_url);
        } else if (node.result_thumbnails && Object.keys(node.result_thumbnails).length > 0) {
          // result_thumbnails là object {fileId: url} hoặc {fileId: {thumbnail: url}}
          const resultUrls = Object.values(node.result_thumbnails).map(v =>
            typeof v === 'string' ? v : (v?.thumbnail || '')
          ).filter(Boolean);
          if (resultUrls.length > 0) {
            this._renderTemplateResultOnNode(node.node_id, resultUrls[0]);
          }
        }
      }
      if (isTemplateContext && (node.ref_img_urls?.length > 0 || (node.ref_thumbnails && Object.keys(node.ref_thumbnails).length > 0))) {
        const refUrls = node.ref_img_urls || Object.values(node.ref_thumbnails || {});
        if (refUrls.length > 0) {
          this._renderTemplateRefOnNode(node.node_id, refUrls);
        }
      }

      // Image node: luôn hiển thị ref image làm preview (flow image hoặc local upload)
      if (!isTemplateContext && node.node_type === 'image' && node.ref_file_ids) {
        const refIds = node.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean);
        if (refIds.length > 0) {
          this._directRenderNodePreview(node.node_id, refIds);
        }
      }

      // Bug fix: trước fix chỉ 'generate' → load workflow lên, ChatGPT/Grok/Prompt có ref images
      // không hiện thumbnails ở phần dưới prompt. Mở rộng cho TẤT CẢ node accept image_ref.
      // 2026-05-31: bỏ điều kiện `cache.has(id)` — luôn call render (kể cả cache empty)
      // → render placeholder cho user thấy ref slot, auto-rescan sẽ populate cache sau.
      if (['generate', 'chatgpt', 'grok', 'prompt'].includes(node.node_type) && node.ref_file_ids) {
        const refIds = node.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean);
        if (refIds.length > 0) {
          this._directRenderNodeRefFromCache(node.node_id, refIds);
        }
      }
    }

    // Nếu tất cả node đã completed → hiện Reset, ẩn Chạy
    if (hasAny && allCompleted) {
      this._showResetButton();
    }

    // Correct stale file IDs (tile IDs thay đổi sau reload Flow page)
    this._correctStaleIds();

    // Background: scan Flow for any file IDs not yet in _tileCache
    this._backgroundThumbnailScan();

    // Sync running state từ executor nếu workflow đang chạy (editor mở sau khi start)
    this._syncRunningNodeFromExecutor();
  }

  /**
   * Sync running node UI từ executor khi editor mở sau khi workflow đã bắt đầu chạy.
   * Fix bug: mở editor khi workflow đang chạy từ sidebar → node không có UI running.
   */
  _syncRunningNodeFromExecutor() {
    const executor = window.workflowExecutor;
    if (!executor?.isRunning) return;
    if (!executor.currentWorkflow?.wf_id) return;
    if (executor.currentWorkflow.wf_id !== this.workflow?.wf_id) return;

    const runningNodeId = executor.currentNode?.node_id;
    if (runningNodeId) {
      this._updateNodeStatusUI(runningNodeId, 'running');
      this._disableFormIfSelectedNode(runningNodeId, true);
    }

    // Sync overlay executing class
    this.overlay?.classList.add('wf-executing');
  }

  /**
   * Scan Flow via MessageBridge to fill _tileCache for file IDs missing thumbnails.
   * Runs after _restoreNodeStates to recover thumbnails lost during extension reload.
   * Shows loading shimmer on nodes with missing previews.
   * Renders directly from _tileCache (no nested scans) to avoid cascade API calls.
   */
  _clearBgScanTimers() {
    if (this._bgScanTimers) {
      for (const t of this._bgScanTimers) clearTimeout(t);
      this._bgScanTimers = [];
    }
  }

  _backgroundThumbnailScan(retryCount = 0) {
    if (typeof MessageBridge === 'undefined' || !this.workflow?.nodes) return;
    // MỌI preview read-only (template / shared / admin / view): hiện ảnh từ ref_thumbnails/result_thumbnails
    // URL (ảnh server) trực tiếp → KHÔNG cần resolve Flow tile. Skip để tránh scan Flow (zoom session →
    // Flow page nhỏ + giật) khi data chứa ref_file_ids/result_file_ids (tile_id của NGƯỜI TẠO — vô nghĩa
    // với người xem). Edit mode (workflow của chính user) thì KHÔNG skip — cần scan để hiện thumbnail.
    if (this.isReadOnly()) return;
    const maxRetries = 0;
    if (!this._bgScanTimers) this._bgScanTimers = [];

    // Collect all file IDs that need thumbnails + nodes with missing previews
    const missingIds = new Set();
    const nodesMissingPreview = [];
    for (const node of this.workflow.nodes) {
      const resultIds = (node.result_file_ids || '').split(',').filter(Boolean);
      const refIds = (node.ref_file_ids || '').split(',').filter(Boolean);
      let hasMissing = false;
      for (const id of [...resultIds, ...refIds]) {
        if (!id.startsWith('upload_') && !this._tileCache.has(id)) {
          missingIds.add(id);
          hasMissing = true;
        }
      }
      if (hasMissing) nodesMissingPreview.push(node);
    }
    if (missingIds.size === 0) {
      this._hideBackgroundScanLoading();
      return;
    }

    // Show loading shimmer on first attempt only
    if (retryCount === 0) {
      this._showBackgroundScanLoading(nodesMissingPreview);
    }

    const missingArr = [...missingIds];
    console.log('[SEOSONA Flow] Background scan:', missingArr.length, 'missing thumbnails');
    const delay = retryCount === 0 ? 1500 : 2500;
    const timerId = setTimeout(() => {
      MessageBridge.getThumbnailsByIds(missingArr).then(result => {
        const results = result?.results || {};
        let found = 0;
        let fileNamesFound = false;
        for (const [fileId, info] of Object.entries(results)) {
          if (info?.thumbnail) {
            this._tileCacheSet(fileId, { thumbnail: info.thumbnail, type: info.type || 'image' });
            found++;
          }
          if (info?.file_name) {
            this._persistSingleFileName(fileId, info.file_name);
            fileNamesFound = true;
          }
        }

        if (found > 0) {
          console.log('[SEOSONA Flow] Background scan found', found, '/', missingArr.length, 'thumbnails');
          this._directRenderFromCache(nodesMissingPreview);
          this._deferredThumbnailSave();
        }
        if (fileNamesFound) {
          this._deferredThumbnailSave();
        }

        const stillMissing = missingArr.filter(id => !this._tileCache.has(id));
        if (stillMissing.length > 0 && retryCount === 0) {
          console.log('[SEOSONA Flow] Background scan: còn', stillMissing.length, 'missing, đang chuẩn bị Flow...');
          // 2026-05-25: Activate Flow tab trước khi retry scan — chỉ 1 lần per editor session.
          // Background Flow tab có thể bị browser suspend → lazy images không render → scan miss.
          const activateFlowTab = (!this._flowTabActivatedForScan)
            ? new Promise((resolve) => {
                this._flowTabActivatedForScan = true;
                try {
                  chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => resolve());
                } catch (e) { resolve(); }
              })
            : Promise.resolve();
          activateFlowTab.then(() => MessageBridge.prepareFlowForScan()).then(() => {
            return MessageBridge.getThumbnailsByIds(stillMissing);
          }).then(retryResult => {
            const retryResults = retryResult?.results || {};
            let retryFound = 0;
            for (const [fileId, info] of Object.entries(retryResults)) {
              if (info?.thumbnail) {
                this._tileCacheSet(fileId, { thumbnail: info.thumbnail, type: info.type || 'image' });
                retryFound++;
              }
              if (info?.file_name) {
                this._persistSingleFileName(fileId, info.file_name);
              }
            }
            if (retryFound > 0) {
              console.log('[SEOSONA Flow] Background scan retry found', retryFound, 'more thumbnails');
              this._directRenderFromCache(nodesMissingPreview);
              this._deferredThumbnailSave();
            }
            this._hideBackgroundScanLoading();
          }).catch(err => {
            console.warn('[SEOSONA Flow] Background scan retry failed:', err.message);
            this._hideBackgroundScanLoading();
          });
        } else {
          this._hideBackgroundScanLoading();
          if (stillMissing.length > 0) {
            console.log('[SEOSONA Flow] Background scan done,', stillMissing.length, 'thumbnails not found on Flow page');
          }
        }
      }).catch(err => {
        console.warn('[SEOSONA Flow] Background thumbnail scan failed:', err.message);
        this._hideBackgroundScanLoading();
      });
    }, delay);
    this._bgScanTimers.push(timerId);
  }

  /**
   * Correct stale tile IDs bằng thumbnail URL matching.
   * Gọi sau _restoreNodeStates để cập nhật file IDs nếu Flow đã reload.
   */
  _correctStaleIds() {
    if (typeof MessageBridge === 'undefined' || !this.workflow?.nodes) return;
    // MỌI preview read-only (template/shared/admin/view) → KHÔNG resolve Flow tile (xem _backgroundThumbnailScan).
    if (this.isReadOnly()) return;

    // Build idToUrlMap + fileNameMap từ tất cả nodes
    const idToUrlMap = {};
    const fileNameMap = {};
    for (const node of this.workflow.nodes) {
      const allThumbs = { ...(node.result_thumbnails || {}), ...(node.ref_thumbnails || {}) };
      for (const [fileId, urlOrObj] of Object.entries(allThumbs)) {
        // result_thumbnails có thể chứa object {thumbnail, type, file_name} hoặc string URL
        const url = typeof urlOrObj === 'object' ? (urlOrObj.thumbnail || urlOrObj.url) : urlOrObj;
        if (fileId && url && typeof url === 'string' && !fileId.startsWith('upload_')) {
          idToUrlMap[fileId] = url;
        }
      }
      // Collect file_names for Tầng 1 matching (both result AND ref)
      const allFileNames = { ...(node.result_file_names || {}), ...(node.ref_file_names || {}) };
      for (const [fileId, fn] of Object.entries(allFileNames)) {
        if (fileId && fn && !fileId.startsWith('upload_')) {
          fileNameMap[fileId] = fn;
        }
      }
    }
    if (Object.keys(idToUrlMap).length === 0 && Object.keys(fileNameMap).length === 0) return;

    // Bug 46 fix: Ensure Flow tiles are loaded BEFORE correction to avoid correcting
    // new valid IDs to old stale IDs (khi tile mới chưa lazy-load vào DOM)
    const doCorrection = () => {
      MessageBridge.correctStaleFileIds(idToUrlMap, fileNameMap, {}, { skipZoomScan: true }).then(result => {
      const corrections = result?.corrections || {};
      const crossProjectIds = result?.crossProjectIds || [];

      // Mark cross-project IDs in cache (for warning display)
      if (crossProjectIds.length > 0) {
        console.log('[SEOSONA Flow] Cross-project detected:', crossProjectIds.length, 'IDs');
        if (!this._crossProjectRefIds) this._crossProjectRefIds = [];
        this._crossProjectRefIds.push(...crossProjectIds);
        // Mark in _tileCache
        for (const id of crossProjectIds) {
          if (this._tileCache.has(id)) {
            const cached = this._tileCache.get(id);
            cached._crossProject = true;
            this._tileCacheSet(id, cached);
          } else {
            this._tileCacheSet(id, { _crossProject: true });
          }
        }

        // Trigger re-render of affected nodes in DiagramCanvas
        this._updateCrossProjectNodePreviews(crossProjectIds);
      }

      if (Object.keys(corrections).length === 0 && crossProjectIds.length === 0) return;

      console.log('[SEOSONA Flow] Corrected', Object.keys(corrections).length, 'stale tile IDs');

      // Update node data
      for (const node of this.workflow.nodes) {
        let changed = false;

        // Correct result_file_ids
        if (node.result_file_ids) {
          const ids = node.result_file_ids.split(',').map(s => s.trim()).filter(Boolean);
          const corrected = ids.map(id => corrections[id] || id);
          const newStr = corrected.join(',');
          if (newStr !== node.result_file_ids) {
            node.result_file_ids = newStr;
            this._syncDrawflowNodeData(node.node_id, { result_file_ids: newStr });
            changed = true;
          }
        }

        // Correct ref_file_ids
        if (node.ref_file_ids) {
          const ids = node.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean);
          const corrected = ids.map(id => corrections[id] || id);
          const newStr = corrected.join(',');
          if (newStr !== node.ref_file_ids) {
            node.ref_file_ids = newStr;
            this._syncDrawflowNodeData(node.node_id, { ref_file_ids: newStr });
            changed = true;
          }
        }

        // Update thumbnail keys
        if (node.result_thumbnails) {
          const updated = {};
          for (const [oldId, url] of Object.entries(node.result_thumbnails)) {
            updated[corrections[oldId] || oldId] = url;
          }
          node.result_thumbnails = updated;
        }
        if (node.ref_thumbnails) {
          const updated = {};
          for (const [oldId, url] of Object.entries(node.ref_thumbnails)) {
            updated[corrections[oldId] || oldId] = url;
          }
          node.ref_thumbnails = updated;
        }

        // Update result_file_names keys
        if (node.result_file_names) {
          const updated = {};
          for (const [oldId, fn] of Object.entries(node.result_file_names)) {
            updated[corrections[oldId] || oldId] = fn;
          }
          node.result_file_names = updated;
        }
        // Update ref_file_names keys - Phase R
        if (node.ref_file_names) {
          const updated = {};
          for (const [oldId, fn] of Object.entries(node.ref_file_names)) {
            updated[corrections[oldId] || oldId] = fn;
          }
          node.ref_file_names = updated;
        }

        // Update _tileCache keys
        for (const [oldId, newId] of Object.entries(corrections)) {
          if (this._tileCache.has(oldId)) {
            const cached = this._tileCache.get(oldId);
            this._tileCache.delete(oldId);
            this._tileCacheSet(newId, cached);
          }
        }
      }

      // Auto-save corrected IDs
      this._deferredThumbnailSave();
      }).catch(err => {
        console.warn('[SEOSONA Flow] correctStaleIds failed:', err.message);
      });
    };

    // Ensure tiles are loaded before correction (prepareFlowForScan calls ensureFlowTilesLoaded)
    if (MessageBridge.prepareFlowForScan) {
      MessageBridge.prepareFlowForScan().then(() => {
        doCorrection();
      }).catch(() => {
        // Fallback: run correction anyway if prepare fails
        doCorrection();
      });
    } else {
      doCorrection();
    }
  }

  /**
   * Show loading shimmer on node previews that are missing thumbnails
   */
  _showBackgroundScanLoading(nodes) {
    if (!this.overlay) return;
    for (const node of nodes) {
      // Skip pending nodes without results - chưa run và chưa có gì để load
      // Ngoại lệ:
      // - Image node: ref_file_ids là preview chính, cần load
      // - Node có result_file_ids: có kết quả cần load preview
      const isImageNode = node.node_type === 'image';
      const hasResults = (node.result_file_ids || '').trim().length > 0;
      if (node.status === 'pending' && !isImageNode && !hasResults) continue;

      const drawflowId = this._findDrawflowId(node.node_id);
      if (!drawflowId) continue;
      const nodeEl = this.overlay.querySelector(`#node-${drawflowId}`);
      const previewEl = nodeEl?.querySelector('.df-node-preview');
      if (!previewEl) continue;
      const hasContent = previewEl.querySelector('img, video');
      if (hasContent) continue;
      previewEl.classList.remove('hidden');
      previewEl.innerHTML = `
        <div class="df-node-loading-shimmer">
          <span class="df-node-loading-text">${window.I18n?.t('workflow.loadingImages') || 'Loading images...'}</span>
        </div>`;
    }
  }

  /**
   * Update node previews to show cross-project warning for affected IDs
   */
  _updateCrossProjectNodePreviews(crossProjectIds) {
    if (!crossProjectIds?.length || !this.workflow?.nodes) return;

    const crossSet = new Set(crossProjectIds);

    for (const node of this.workflow.nodes) {
      // Check ref_file_ids
      const refIds = (node.ref_file_ids || '').split(',').filter(Boolean);
      const hasRefCross = refIds.some(id => crossSet.has(id));

      // Check result_file_ids
      const resultIds = (node.result_file_ids || '').split(',').filter(Boolean);
      const hasResultCross = resultIds.some(id => crossSet.has(id));

      if (!hasRefCross && !hasResultCross) continue;

      const drawflowId = this._findDrawflowId(node.node_id);
      if (!drawflowId) continue;

      // Update DiagramCanvas node preview to show warning
      const nodeEl = this.overlay?.querySelector(`#node-${drawflowId}`);
      const previewEl = nodeEl?.querySelector('.df-node-preview');
      if (previewEl) {
        previewEl.classList.add('df-node-cross-project');
        const existing = previewEl.querySelector('.cross-project-badge');
        if (!existing) {
          previewEl.insertAdjacentHTML('beforeend', `
            <div class="cross-project-badge" title="${window.I18n?.t('workflow.crossProjectImage') || 'Image from another project'}" style="position:absolute;top:4px;right:4px;background:var(--destructive,#dc2626);color:#fff;font-size:8px;padding:2px 4px;border-radius:3px;z-index:10;">
              ${window.I18n?.t('workflow.wrongProject') || 'Sai project'}
            </div>`);
        }
      }

      console.log(`[SEOSONA Flow] Cross-project warning added to node ${node.node_id}: ref=${hasRefCross}, result=${hasResultCross}`);
    }
  }

  /**
   * Hide loading shimmer after background scan completes
   */
  _hideBackgroundScanLoading() {
    if (!this.overlay) return;
    this.overlay.querySelectorAll('.df-node-loading-shimmer').forEach(el => {
      const previewEl = el.closest('.df-node-preview');
      if (previewEl && !previewEl.querySelector('img, video')) {
        // Icon placeholder theo media type (grok video / generate video → icon VIDEO, không phải ảnh).
        // data-media-type set ở grok (grokModeLabel) + generate (mediaType). Trước: hardcode icon ảnh.
        const isVid = previewEl.closest('.df-node')?.getAttribute('data-media-type') === 'Video';
        const icon = isVid
          ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>'
          : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
        previewEl.innerHTML = `<div class="df-node-preview-placeholder">${icon}</div>`;
      }
    });
  }

  /**
   * Render node previews directly from _tileCache (no MessageBridge scan, no retry).
   * Used by _backgroundThumbnailScan to avoid nested scan cascades.
   */
  _directRenderFromCache(nodes) {
    for (const node of nodes) {
      // Result preview for completed nodes
      if (node.status === 'completed' && node.result_file_ids) {
        const fileIds = node.result_file_ids.split(',').filter(Boolean);
        if (fileIds.some(id => this._tileCache.has(id))) {
          this._directRenderNodePreview(node.node_id, fileIds);
        }
      }
      // Template mode: result_img_url (ảnh preview mẫu)
      // Template mode hoặc template preview (Option A: _isPreview, Option B: _is_template_preview)
      const isTemplateCtx = this.isTemplateMode || this.workflow?._is_template_preview || this.workflow?._isPreview;
      if (isTemplateCtx && node.result_img_url) {
        this._renderTemplateResultOnNode(node.node_id, node.result_img_url);
      }
      // Template mode/preview: ref images từ ref_img_urls
      if (isTemplateCtx && (node.ref_img_urls?.length > 0 || (node.ref_thumbnails && Object.keys(node.ref_thumbnails).length > 0))) {
        const refUrls = node.ref_img_urls || Object.values(node.ref_thumbnails || {});
        if (refUrls.length > 0) {
          this._renderTemplateRefOnNode(node.node_id, refUrls);
        }
      }
      // Image node: ref images as main preview (normal mode only)
      if (!isTemplateCtx && node.node_type === 'image' && node.ref_file_ids) {
        const refIds = node.ref_file_ids.split(',').filter(Boolean);
        if (refIds.some(id => this._tileCache.has(id))) {
          this._directRenderNodePreview(node.node_id, refIds);
        }
      }
      // Generate/ChatGPT/Grok/Prompt node: ref image thumbnails at bottom of node card.
      // Bug fix: thêm 'prompt' (enhance mode có ref images) + 'chatgpt' alias.
      if (['generate', 'chatgpt', 'grok', 'prompt'].includes(node.node_type) && node.ref_file_ids) {
        const refIds = node.ref_file_ids.split(',').filter(Boolean);
        if (refIds.some(id => this._tileCache.has(id))) {
          this._directRenderNodeRefFromCache(node.node_id, refIds);
        }
      }
    }
  }

  /**
   * Render main node preview directly from _tileCache (no scan, no retry)
   */
  _directRenderNodePreview(nodeId, fileIds) {
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;
    const nodeEl = this.overlay?.querySelector(`#node-${drawflowId}`);
    const previewContainer = nodeEl?.querySelector('.df-node-preview');
    if (!previewContainer) return;

    const isImageNode = nodeEl.querySelector('.df-node[data-node-type="image"]') !== null;
    previewContainer.classList.toggle('image-ref', isImageNode);
    // 2026-05-25: Image node default ratio-9-16 (portrait) khi chưa có ref.
    // Có ref → bỏ class default để ảnh tự fit theo kích thước thực tế (object-fit: contain).
    if (isImageNode) {
      const hasRefs = Array.isArray(fileIds) && fileIds.length > 0;
      previewContainer.classList.toggle('ratio-9-16', !hasRefs);
    }
    previewContainer._nodeId = nodeId;
    // Render directly — _renderNodePreviewInner uses _tileCache which is already populated
    this._renderNodePreviewInner(previewContainer, [...new Set(fileIds)], 5); // attempt=5 disables retry
  }

  /**
   * Render ref thumbnails at bottom of generate nodes from _tileCache
   */
  _directRenderNodeRefFromCache(nodeId, refIds) {
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;
    const nodeEl = this.overlay?.querySelector(`#node-${drawflowId}`);
    let refContainer = nodeEl?.querySelector('.df-node-ref-preview');

    if (!refContainer && refIds.length > 0) {
      const body = nodeEl?.querySelector('.df-node-body');
      if (!body) return;
      refContainer = document.createElement('div');
      refContainer.className = 'df-node-ref-preview';
      refContainer.setAttribute('data-ref-preview', '');
      body.appendChild(refContainer);
    }
    if (!refContainer) return;

    refContainer.innerHTML = '';
    for (const tileId of [...new Set(refIds)].slice(0, 6)) {
      const cached = this._tileCache.get(tileId);
      // 2026-05-31 v5: detect video CHỈ qua type='video' hoặc file extension.
      // BỎ getMediaUrlRedirect URL pattern — Flow dùng cùng URL cho image + video → ambiguous!
      const cachedThumb = cached?.thumbnail || '';
      const isVideo = cached?.type === 'video' ||
        /\.(mp4|webm|mov|m4v)$/i.test(cached?.file_name || '');
      const videoUrl = cached?.video_url || '';
      const useVideo = isVideo && !!videoUrl;
      const useImg = !useVideo && cachedThumb;
      // 2026-05-31 v4: bỏ `continue` skip — ALWAYS render something cho mỗi ref ID.
      // Trước: cache empty → skip → user thấy fewer thumbnails hơn ref_file_ids count.
      const thumb = document.createElement('div');
      thumb.className = 'df-ref-thumb';
      if (useImg) {
        const img = document.createElement('img');
        img.src = cachedThumb;
        img.alt = 'ref';
        // Reactive video detect: nếu URL trả mp4 bytes → <img> fail → swap sang <video>.
        // Flow URL `getMediaUrlRedirect` không phân biệt image/video qua URL pattern.
        img.addEventListener('error', () => {
          const video = document.createElement('video');
          video.src = cachedThumb;
          video.muted = true; video.playsInline = true; video.preload = 'metadata';
          video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;background:#0c1320;';
          video.addEventListener('loadedmetadata', () => { try { video.currentTime = 0.1; } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_directRenderNodeRefFromCache', _); } }, { once: true });
          img.parentNode?.replaceChild(video, img);
          // Heal cache để render sau dùng <video> trực tiếp
          this._tileCacheSet(tileId, { ...(this._tileCache.get(tileId) || {}), type: 'video', video_url: cachedThumb });
        }, { once: true });
        thumb.appendChild(img);
      } else if (useVideo) {
        thumb.innerHTML = `<video src="${this._safeMediaSrc(videoUrl)}" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block;background:#0c1320;"></video>`;
        const vEl = thumb.querySelector('video');
        if (vEl) vEl.addEventListener('loadedmetadata', () => { try { vEl.currentTime = 0.1; } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_directRenderNodeRefFromCache', _); } }, { once: true });
      } else if (isVideo) {
        // Video tile thiếu URL → play icon placeholder
        thumb.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(99,102,241,0.10);color:var(--primary,#6366f1);"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg></div>';
      } else {
        // Image ref thiếu cache (mới load workflow, chưa scan) → image broken icon placeholder
        // Auto-rescan sẽ populate cache sau, lúc đó render lại.
        thumb.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(245,158,11,0.06);color:var(--muted-foreground);" title="' + this.escapeAttr(tileId.substring(0, 12)) + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>';
      }
      refContainer.appendChild(thumb);
    }
  }

  /**
   * Render template result preview image trên node trong diagram
   * Dùng cho template mode khi node có result_img_url (ảnh mẫu kết quả)
   * @param {string} nodeId - Node ID
   * @param {string} resultImgUrl - URL của ảnh kết quả mẫu
   */
  _renderTemplateResultOnNode(nodeId, resultImgUrl) {
    if (!resultImgUrl) return;

    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;

    const nodeEl = this.overlay?.querySelector(`#node-${drawflowId}`);
    const previewContainer = nodeEl?.querySelector('.df-node-preview');
    if (!previewContainer) return;

    previewContainer.innerHTML = '';
    previewContainer.classList.remove('hidden', 'multi-result');
    previewContainer.classList.add('template-result-preview');

    const thumb = document.createElement('div');
    thumb.className = 'df-preview-thumb';
    // 2026-05-25: Template result image cũng clickable mở media viewer
    thumb.dataset.mediaType = 'image';
    thumb.dataset.mediaSrc = resultImgUrl;

    const img = document.createElement('img');
    img.src = resultImgUrl;
    img.alt = 'template result';
    img.onerror = () => {
      previewContainer.classList.add('hidden');
    };

    thumb.appendChild(img);
    this._attachThumbZoom(thumb);
    previewContainer.appendChild(thumb);
  }

  /**
   * Clear template result preview trên node (khi user xóa ảnh mẫu)
   * Restore placeholder thay vì ẩn hoàn toàn
   * @param {string} nodeId - Node ID
   */
  _clearTemplateResultOnNode(nodeId) {
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;

    const nodeEl = this.overlay?.querySelector(`#node-${drawflowId}`);
    const previewContainer = nodeEl?.querySelector('.df-node-preview');
    if (!previewContainer) return;

    // Restore placeholder thay vì xóa hoàn toàn — icon theo media type (video → icon VIDEO).
    const isVid = nodeEl?.getAttribute('data-media-type') === 'Video';
    const phIcon = isVid
      ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>'
      : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    previewContainer.innerHTML = `<div class="df-node-preview-placeholder">${phIcon}</div>`;
    previewContainer.classList.remove('hidden', 'template-result-preview', 'template-ref-preview', 'multi-result', 'image-ref');
  }

  /**
   * Render ref images (URLs) trên node diagram cho template mode
   * - Image node: render vào .df-node-preview (main preview)
   * - Generate/ChatGPT/Grok/Prompt nodes: render vào .df-node-ref-preview (thumbnails dưới cùng)
   * @param {string} nodeId - Node ID
   * @param {string[]} refUrls - Mảng URLs ảnh tham chiếu
   */
  _renderTemplateRefOnNode(nodeId, refUrls, retryCount = 0) {
    if (!refUrls || refUrls.length === 0) return;

    const drawflowId = this._findDrawflowId(nodeId);

    // Retry if drawflowId not found yet (DOM may not be ready)
    if (!drawflowId) {
      if (retryCount < 5) {
        setTimeout(() => this._renderTemplateRefOnNode(nodeId, refUrls, retryCount + 1), 100 * (retryCount + 1));
      }
      return;
    }

    const nodeEl = this.overlay?.querySelector(`#node-${drawflowId}`);
    if (!nodeEl) {
      if (retryCount < 5) {
        setTimeout(() => this._renderTemplateRefOnNode(nodeId, refUrls, retryCount + 1), 100 * (retryCount + 1));
      }
      return;
    }

    // Detect node type
    const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    const nodeType = node?.data?.node_type || node?.class;
    const isImageNode = nodeType === 'image';

    if (isImageNode) {
      // Image node: render vào .df-node-preview (main preview)
      const previewContainer = nodeEl.querySelector('.df-node-preview');
      if (!previewContainer) return;

      previewContainer.innerHTML = '';
      previewContainer.classList.remove('hidden', 'template-result-preview');
      previewContainer.classList.add('template-ref-preview', 'image-ref');
      previewContainer.classList.toggle('multi-result', refUrls.length > 1);

      refUrls.forEach((url, index) => {
        if (!url) return;
        const thumb = document.createElement('div');
        thumb.className = 'df-preview-thumb';
        // 2026-05-25: Template ref image clickable mở media viewer
        thumb.dataset.mediaType = 'image';
        thumb.dataset.mediaSrc = url;
        const img = document.createElement('img');
        img.src = url;
        img.alt = `ref image ${index + 1}`;
        thumb.appendChild(img);
        this._attachThumbZoom(thumb);
        previewContainer.appendChild(thumb);
      });
    } else {
      // Generate/ChatGPT/Grok/Prompt nodes: render vào .df-node-ref-preview (thumbnails dưới cùng)
      let refContainer = nodeEl.querySelector('.df-node-ref-preview');

      if (!refContainer && refUrls.length > 0) {
        const body = nodeEl.querySelector('.df-node-body');
        if (!body) return;
        refContainer = document.createElement('div');
        refContainer.className = 'df-node-ref-preview';
        refContainer.setAttribute('data-ref-preview', '');
        body.appendChild(refContainer);
      }
      if (!refContainer) return;

      refContainer.innerHTML = '';
      refUrls.slice(0, 6).forEach((url, index) => {
        if (!url) return;
        const thumb = document.createElement('div');
        thumb.className = 'df-ref-thumb';
        const img = document.createElement('img');
        img.src = url;
        img.alt = `ref ${index + 1}`;
        thumb.appendChild(img);
        refContainer.appendChild(thumb);
      });
    }
  }

  _showResetButton() {
    if (!this.overlay) return;
    if (this.isReadOnly()) return; // Không show reset ở read-only
    const resetBtn = this.overlay.querySelector('#resetWorkflowInEditorBtn');
    const toolbarPlayBtn = this.overlay.querySelector('.seosonaflow-wf-tool-btn[data-action="run-workflow"]');
    resetBtn?.classList.remove('hidden');
    toolbarPlayBtn?.classList.add('hidden');
  }

  _showRunButton() {
    if (!this.overlay) return;
    if (this.isReadOnly()) return; // Không show play ở read-only
    const resetBtn = this.overlay.querySelector('#resetWorkflowInEditorBtn');
    const toolbarPlayBtn = this.overlay.querySelector('.seosonaflow-wf-tool-btn[data-action="run-workflow"]');
    resetBtn?.classList.add('hidden');
    toolbarPlayBtn?.classList.remove('hidden');
  }

  /**
   * Update play button visibility based on saving status.
   * Lock (mờ + not-allowed) khi: _isSaving OR _deferredSaveTimer pending.
   * Lý do: trước fix ẩn nút (display:none) → các button khác dịch lên → click undo xong
   * vị trí redo trở thành undo → user click trúng undo lần 2. Giữ button visible + lock.
   *
   * Class `is-saving-locked` riêng biệt với `.hidden` (logic Run/Stop toggle) →
   * tránh đè state khi save xong (Run vẫn hidden vì đang Stop, hoặc ngược lại).
   */
  _updatePlayButtonState() {
    if (!this.overlay) return;
    const runSingleNodeBtn = this.overlay.querySelector('#runSingleNodeBtn');
    const toolbarRunBtn = this.overlay.querySelector('.seosonaflow-wf-tool-btn[data-action="run-workflow"]');

    const hasPendingSave = this._isSaving || this._deferredSaveTimer !== null;

    if (runSingleNodeBtn) {
      runSingleNodeBtn.disabled = hasPendingSave;
      runSingleNodeBtn.classList.toggle('is-saving-locked', hasPendingSave);
    }
    if (toolbarRunBtn) {
      toolbarRunBtn.disabled = hasPendingSave;
      toolbarRunBtn.classList.toggle('is-saving-locked', hasPendingSave);
    }
  }

  /**
   * Update quota display showing runs used/limit and nodes used/limit
   */
  async _updateQuotaDisplay() {
    if (!this.overlay) return;

    // EWT-6: Ẩn quota display khi ở template mode (không liên quan đến user quota)
    const quotaDisplay = this.overlay.querySelector('#wfQuotaDisplay');
    if (this.isTemplateMode && quotaDisplay) {
      quotaDisplay.classList.add('hidden');
      return;
    } else if (quotaDisplay) {
      quotaDisplay.classList.remove('hidden');
    }

    const runsEl = this.overlay.querySelector('#wfQuotaRuns .wf-quota-value');
    const nodesEl = this.overlay.querySelector('#wfQuotaNodes .wf-quota-value');

    // Get workflows_run_max quota
    if (window.featureGate && runsEl) {
      try {
        const runQuota = await this._safeCheckQuotaAsync('workflows_run_max');
        const isUnlimited = runQuota.limit === 'unlimited';
        const limitHtml = isUnlimited ? '<span class="wf-quota-unlimited">&infin;</span>' : runQuota.limit;
        runsEl.innerHTML = `${runQuota.used}/${limitHtml}`;
        // Add warning class if near limit
        const runsItem = this.overlay.querySelector('#wfQuotaRuns');
        if (!isUnlimited && runQuota.used >= runQuota.limit) {
          runsItem?.classList.add('wf-quota-exhausted');
          runsItem?.classList.remove('wf-quota-warning');
        } else if (!isUnlimited && runQuota.used >= runQuota.limit * 0.8) {
          runsItem?.classList.add('wf-quota-warning');
          runsItem?.classList.remove('wf-quota-exhausted');
        } else {
          runsItem?.classList.remove('wf-quota-warning', 'wf-quota-exhausted');
        }
      } catch (e) {
        console.warn('[WorkflowEditor] Failed to get run quota:', e.message);
      }
    }

    // Get workflows_nodes_max quota (current workflow node count vs limit)
    if (window.featureGate && nodesEl) {
      try {
        const nodeQuota = await this._safeCheckQuotaAsync('workflows_nodes_max');
        const currentNodes = this.workflow?.nodes?.length || 0;
        const isUnlimited = nodeQuota.limit === 'unlimited';
        const limitHtml = isUnlimited ? '<span class="wf-quota-unlimited">&infin;</span>' : nodeQuota.limit;
        nodesEl.innerHTML = `${currentNodes}/${limitHtml}`;
        // Add warning class if near limit
        const nodesItem = this.overlay.querySelector('#wfQuotaNodes');
        if (!isUnlimited && currentNodes >= nodeQuota.limit) {
          nodesItem?.classList.add('wf-quota-exhausted');
          nodesItem?.classList.remove('wf-quota-warning');
        } else if (!isUnlimited && currentNodes >= nodeQuota.limit * 0.8) {
          nodesItem?.classList.add('wf-quota-warning');
          nodesItem?.classList.remove('wf-quota-exhausted');
        } else {
          nodesItem?.classList.remove('wf-quota-warning', 'wf-quota-exhausted');
        }
      } catch (e) {
        console.warn('[WorkflowEditor] Failed to get node quota:', e.message);
      }
    }

    // Upgrade button — chỉ hiện cho free/trial user. CSS body.hide-upgrade-ui đã xử lý
    // riêng case admin tắt setting 'Hiển thị các gợi ý nâng cấp' (sidebar.css rule).
    const upgradeBtn = this.overlay.querySelector('#wfUpgradeBtn');
    if (upgradeBtn) {
      const isFree = !!(window.featureGate?.isFreePlan?.());
      upgradeBtn.classList.toggle('hidden', !isFree);
    }
  }


  /**
   * 2026-05-25 Option B: Live-sync form upload tempId vào Drawflow node.data.
   * Khi user upload ref image qua form picker → tempId emit `upload:started` →
   * inject tempId vào node.data.ref_file_ids + ref_thumbnails (placeholder) ngay →
   * diagram render với spinner thumbnail (existing _renderNodePreviewInner detect
   * `upload_xxx` prefix). Sau khi upload completed, `_syncUploadKeyToAllNodes`
   * replaces tempId với real tile_id + `_deferredThumbnailSave` persist backend.
   */
  _syncFormUploadToDrawflowNode(uploadKey) {
    if (!uploadKey || !uploadKey.startsWith('upload_')) return;
    // Chỉ sync nếu key thuộc form đang mở (tránh sync upload từ context khác)
    if (!this._formUploadKeys?.has(uploadKey)) return;
    if (!this._formNodeId || !this.diagramCanvas?.editor) return;

    const drawflowId = String(this._formNodeId);
    const node = this.diagramCanvas.editor.getNodeFromId(drawflowId);
    if (!node?.data) return;

    // Skip nếu key đã có trong ref_file_ids (idempotent)
    const currentIds = (node.data.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (currentIds.includes(uploadKey)) return;

    // Get thumbnail từ _tileCache (caller đã set qua _tileCacheSet) hoặc pendingUploadFiles
    const cached = this._tileCache.get(uploadKey);
    const thumbnail = cached?.thumbnail
      || window.pendingUploadFiles?.get(uploadKey)?.thumbnail
      || '';
    const fileName = cached?.file_name
      || window.pendingUploadFiles?.get(uploadKey)?.name
      || '';

    // Build new data — append tempId
    const newRefIds = [...currentIds, uploadKey].join(', ');
    const newRefThumbs = { ...(node.data.ref_thumbnails || {}), [uploadKey]: thumbnail };
    const newRefNames = fileName
      ? { ...(node.data.ref_file_names || {}), [uploadKey]: fileName }
      : node.data.ref_file_names;
    const newData = {
      ...node.data,
      ref_file_ids: newRefIds,
      ref_thumbnails: newRefThumbs,
      ...(fileName ? { ref_file_names: newRefNames } : {}),
    };

    try {
      this.diagramCanvas.editor.updateNodeDataFromId(drawflowId, newData);
    } catch (err) {
      console.warn('[WorkflowEditor] _syncFormUploadToDrawflowNode updateNodeData failed:', err?.message);
      return;
    }

    // Trigger diagram re-render (spinner thumbnail từ upload_ prefix detection)
    const nodeId = node.data.node_id || drawflowId;
    try {
      this._refreshNodesContainingKey(uploadKey);
    } catch (e) { /* ignore */ }
  }

  _unbindWorkflowUploadListeners() {
    if (!this._workflowUploadListenersBound) return;
    window.eventBus?.off('upload:started', this._wfUploadStartedHandler);
    window.eventBus?.off('upload:completed', this._wfUploadCompletedHandler);
    window.eventBus?.off('upload:failed', this._wfUploadFailedHandler);
    this._workflowUploadListenersBound = false;
  }

  /**
   * Re-render node diagram preview cho mọi node có ref_file_ids chứa key.
   * Dùng sau upload start/complete/fail để update spinner / replace tempId / show error.
   */
  _refreshNodesContainingKey(key) {
    if (!key || !this.diagramCanvas?.editor) return;
    try {
      const editor = this.diagramCanvas.editor;
      // Đọc trực tiếp từ live state — KHÔNG export() (deep clone, có thể stale nếu
      // call site khác đang mutate). Live read: editor.drawflow.drawflow.Home.data
      const homeData = editor.drawflow?.drawflow?.Home?.data || {};
      for (const [drawflowId, nodeInfo] of Object.entries(homeData)) {
        const nodeData = nodeInfo?.data;
        const refRaw = nodeData?.ref_file_ids;
        if (typeof refRaw !== 'string' || !refRaw) continue;
        const ids = refRaw.split(',').map(s => s.trim()).filter(Boolean);
        if (!ids.includes(key)) continue;

        const nodeId = nodeData?.node_id || drawflowId;
        const nodeType = nodeData?.node_type || nodeInfo?.class;

        try {
          if (nodeType === 'image') {
            // Image node: ref_file_ids hiển thị TRONG main preview (.df-node-preview)
            this._directRenderNodePreview(nodeId, ids);
          } else if (['generate', 'chatgpt', 'grok', 'prompt'].includes(nodeType)) {
            // Generate/ChatGPT/Grok/Prompt: ref ở bottom (.df-node-ref-preview)
            this._directRenderNodeRefFromCache(nodeId, ids);
          }
        } catch (innerErr) {
          console.warn('[WorkflowEditor] refresh node preview failed:', innerErr?.message);
        }
      }
    } catch (err) {
      console.warn('[WorkflowEditor] refreshNodesContainingKey failed:', err?.message);
    }
  }

  /**
   * v1.1 Node clipboard: copy selected node data → `_nodeClipboard` slot.
   * Single-node, in-memory only (lost when editor closes). Cross-workflow disabled.
   */
  _copyNodeToClipboard(nodeId) {
    if (!nodeId || !this.diagramCanvas?.editor) return false;
    const node = this.diagramCanvas.editor.getNodeFromId(nodeId);
    const data = node?.data;
    if (!data) return false;
    // Refuse copy cho start node (giống logic context menu)
    if (data.node_type === 'start') return false;

    // Clone data — getNodeFromId trả về deep clone, nhưng explicit clone để an toàn
    // và strip execution state (status/result) — paste node fresh giống duplicate.
    const cloned = JSON.parse(JSON.stringify(data));
    delete cloned.status;
    delete cloned.result_file_ids;
    delete cloned.result_file_names;
    delete cloned.result_thumbnails;
    delete cloned.result_text;
    delete cloned.error_message;
    // 2026-05-25: Normalize required defaults trên clipboard data — tránh propagate
    // empty video_input_type/grok_mode/use_fallback_prefix khi paste sau này.
    try { window.NodeTemplates?.normalizeNodeData?.(cloned); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_copyNodeToClipboard', _); }

    this._nodeClipboard = { data: cloned, copiedAt: Date.now() };

    const label = data.node_name || data.node_type || 'node';
    const msg = window.I18n?.t?.('workflow.nodeClipboard.copied', { name: label })
      || `Đã copy node "${label}"`;
    window.showNotification?.(msg, 'success', 1500);
    return true;
  }

  /**
   * v1.1 Node clipboard: paste node tại vị trí cursor (hoặc center fallback).
   * Uniquify name + slug để không trùng nodes hiện có.
   */
  _pasteNodeFromClipboard() {
    if (!this._nodeClipboard?.data || !this.diagramCanvas) return false;
    if (this.isReadOnly()) return false;

    const src = this._nodeClipboard.data;
    const nodeType = src.node_type;
    if (!nodeType) return false;

    // Build new data — clone + uniquify name/slug. Generate new node_id (unique).
    const newData = JSON.parse(JSON.stringify(src));
    // 2026-05-25: Normalize defaults defensive (clipboard data có thể đã normalize lúc copy,
    // nhưng cross-session paste hoặc cross-context có thể skip → normalize lại an toàn).
    try { window.NodeTemplates?.normalizeNodeData?.(newData); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_pasteNodeFromClipboard', _); }
    newData.node_id = window.IdGenerator
      ? window.IdGenerator.next('node')
      : `node_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    // Uniquify node_name dùng cùng pattern với palette drop / paste image
    newData.node_name = this._generateUniqueNodeName(nodeType);

    // Uniquify slug — preserve original semantic meaning (parity với `duplicateNode`).
    // Nếu source có slug user-defined (vd "my_main_prompt") → uniquify suffix → "my_main_prompt_2".
    // Nếu source không có slug → generate từ node_name mới.
    if (this._isMentionableNodeType(nodeType)) {
      if (src.slug) {
        const existingSlugs = this._getExistingSlugs();
        newData.slug = this._ensureUniqueSlug(src.slug, existingSlugs);
      } else {
        newData.slug = this._generateSlug(newData.node_name);
      }
      newData.slug_auto = true; // match `duplicateNode` behavior — force auto flag
    } else {
      delete newData.slug;
      delete newData.slug_auto;
    }

    // Bug fix (catalog 2026-05-20): paste single-node KHÔNG copy edges → new node KHÔNG có
    // upstream Prompt/Text. Nếu source có `prompt_source='upstream_node'` (vì connected upstream),
    // pasted node sẽ orphan: runtime đọc upstream rỗng → submit empty prompt → fail.
    // Fix: reset về 'textbox' (default an toàn) — user có thể connect upstream sau, hoặc edit
    // prompt textbox đã copy. Edge:created handler tự auto-switch lại 'upstream_node' nếu cần.
    if (newData.prompt_source === 'upstream_node') {
      newData.prompt_source = 'textbox';
    }

    // Position: mouse cursor → fallback center (parity với N=add node shortcut)
    const rect = this.overlay?.querySelector('#diagramContainer')?.getBoundingClientRect();
    const fallbackX = rect ? rect.width / 2 : 200;
    const fallbackY = rect ? rect.height / 2 : 200;
    const posX = this._lastMouseCanvasPos?.x ?? fallbackX;
    const posY = this._lastMouseCanvasPos?.y ?? fallbackY;

    const drawflowId = this.diagramCanvas.addNode(nodeType, posX, posY, newData);
    if (!drawflowId) return false; // quota fail / addNode rejected

    this._hasUnsavedChanges = true;
    try { this._scheduleRefreshNodeWarningBadges(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_pasteNodeFromClipboard', _); }
    // Render ref preview NGAY (không cần mở form + save) — ảnh ref copy theo node.
    try { this._renderNodeRefPreviewFromData(newData); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_pasteNodeFromClipboard', _); }
    requestAnimationFrame(() => {
      try { this._updatePortEmptyState(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_pasteNodeFromClipboard', _); }
      try { this._bindInlineSettingPills(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_pasteNodeFromClipboard', _); }
    });

    return true;
  }

  /**
   * Multi-node clipboard: copy TẤT CẢ node đang multi-select (Shift+drag zone) + edges NỘI BỘ
   * giữa chúng. Giữ layout tương đối (paste offset +40 giống duplicateNode). Strip execution state.
   * Clipboard shape multi: { multi:true, nodes:[{oldDfId,data,pos_x,pos_y}], edges:[{srcOld,srcOut,tgtOld,tgtIn}] }.
   * @param {string[]} drawflowIds - danh sách drawflow id đang chọn
   */
  _copySelectedNodesToClipboard(drawflowIds) {
    if (!this.diagramCanvas?.editor || !Array.isArray(drawflowIds) || !drawflowIds.length) return false;
    const editor = this.diagramCanvas.editor;
    const selectedSet = new Set(drawflowIds.map(String));
    const nodes = [];
    const validSet = new Set();
    for (const dfId of selectedSet) {
      const node = editor.getNodeFromId(dfId);
      const data = node?.data;
      if (!data || data.node_type === 'start') continue; // start node không copy (giống single)
      const cloned = JSON.parse(JSON.stringify(data));
      ['status', 'result_file_ids', 'result_file_names', 'result_thumbnails', 'result_text', 'error_message']
        .forEach(k => delete cloned[k]);
      try { window.NodeTemplates?.normalizeNodeData?.(cloned); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_copySelectedNodesToClipboard', _); }
      nodes.push({ oldDfId: String(dfId), data: cloned, pos_x: node.pos_x, pos_y: node.pos_y });
      validSet.add(String(dfId));
    }
    if (!nodes.length) return false;
    // Edges nội bộ: CHỈ giữ connection mà CẢ source + target đều nằm trong selection.
    const edges = [];
    for (const dfId of validSet) {
      const outputs = editor.getNodeFromId(dfId)?.outputs || {};
      for (const [outClass, o] of Object.entries(outputs)) {
        for (const c of (o?.connections || [])) {
          if (validSet.has(String(c.node))) {
            edges.push({ srcOld: String(dfId), srcOut: outClass, tgtOld: String(c.node), tgtIn: c.output });
          }
        }
      }
    }
    this._nodeClipboard = { multi: true, nodes, edges, copiedAt: Date.now() };
    const count = nodes.length;
    window.showNotification?.(
      window.I18n?.t?.('workflow.nodeClipboard.copiedMulti', { count }) || `Đã copy ${count} node`,
      'success', 1500
    );
    return true;
  }

  /**
   * Paste nhiều node từ clipboard multi (parity _pasteNodeFromClipboard nhưng giữ edges nội bộ +
   * layout tương đối). Uniquify name/slug PER node, remap edge theo old→new drawflow id.
   */
  _pasteNodesFromClipboard(anchor = null) {
    const clip = this._nodeClipboard;
    if (!clip?.nodes?.length || !this.diagramCanvas) return false;
    if (this.isReadOnly()) return false;
    const editor = this.diagramCanvas.editor;
    if (!editor) return false;

    // Node có edge upstream được paste cùng → giữ prompt_source='upstream_node'; else reset 'textbox'
    // (orphan protection — Bug 58: upstream rỗng → submit empty prompt).
    const incomingTargets = new Set((clip.edges || []).map(e => e.tgtOld));
    const idMap = new Map(); // oldDfId -> newDfId
    const newDfIds = [];

    // Anchor (right-click pos, canvas coords) → đặt top-left nhóm tại cursor, GIỮ layout tương đối.
    // Không anchor (Ctrl+V) → offset +40 giống duplicateNode.
    const hasAnchor = anchor && Number.isFinite(anchor.canvasX) && Number.isFinite(anchor.canvasY);
    let minX = Infinity, minY = Infinity;
    if (hasAnchor) {
      for (const e of clip.nodes) { minX = Math.min(minX, Number(e.pos_x) || 0); minY = Math.min(minY, Number(e.pos_y) || 0); }
    }

    for (const entry of clip.nodes) {
      const nodeType = entry.data?.node_type;
      if (!nodeType) continue;
      const newData = JSON.parse(JSON.stringify(entry.data));
      try { window.NodeTemplates?.normalizeNodeData?.(newData); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_pasteNodesFromClipboard', _); }
      newData.node_id = window.IdGenerator
        ? window.IdGenerator.next('node')
        : `node_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      newData.node_name = this._generateUniqueNodeName(nodeType);
      if (this._isMentionableNodeType(nodeType)) {
        // _getExistingSlugs gọi MỖI vòng → thấy node vừa paste ở vòng trước → tránh trùng trong batch.
        newData.slug = entry.data.slug
          ? this._ensureUniqueSlug(entry.data.slug, this._getExistingSlugs())
          : this._generateSlug(newData.node_name);
        newData.slug_auto = true;
      } else {
        delete newData.slug;
        delete newData.slug_auto;
      }
      if (newData.prompt_source === 'upstream_node' && !incomingTargets.has(entry.oldDfId)) {
        newData.prompt_source = 'textbox';
      }
      const ex = Number(entry.pos_x) || 0, ey = Number(entry.pos_y) || 0;
      const posX = hasAnchor ? anchor.canvasX + (ex - minX) : ex + 40;
      const posY = hasAnchor ? anchor.canvasY + (ey - minY) : ey + 40;
      const newDfId = this.diagramCanvas.addNode(nodeType, posX, posY, newData);
      if (newDfId) {
        idMap.set(entry.oldDfId, newDfId);
        newDfIds.push(String(newDfId));
        // Render ref preview NGAY cho từng node (ảnh ref copy theo).
        try { this._renderNodeRefPreviewFromData(newData); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_pasteNodesFromClipboard', _); }
      }
    }

    if (!idMap.size) return false;

    // Recreate edges nội bộ giữa các node vừa paste (remap drawflow id).
    for (const e of (clip.edges || [])) {
      const s = idMap.get(e.srcOld), t = idMap.get(e.tgtOld);
      if (!s || !t) continue;
      try { editor.addConnection(s, t, e.srcOut, e.tgtIn); }
      catch (err) { console.warn('[WorkflowEditor] paste edge failed:', err?.message || err); }
    }

    this._hasUnsavedChanges = true;
    try { this._scheduleRefreshNodeWarningBadges(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_pasteNodesFromClipboard', _); }
    // Select các node mới (multi) để user kéo/xóa tiếp ngay. Reset selectedNodeId (drawflow
    // last-clicked node CŨ) → tránh Delete sau đó merge nhầm node cũ vào batch xoá.
    try {
      this.diagramCanvas._clearMultiSelect?.();
      this.selectedNodeId = null;
      if (this.diagramCanvas._multiSelected) {
        newDfIds.forEach(id => {
          this.diagramCanvas._multiSelected.add(id);
          this.diagramCanvas.container?.querySelector(`#node-${id}`)?.classList.add('df-multi-selected');
        });
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_pasteNodesFromClipboard', _); }
    requestAnimationFrame(() => {
      try { this._updatePortEmptyState(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_pasteNodesFromClipboard', _); }
      try { this._bindInlineSettingPills(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_pasteNodesFromClipboard', _); }
      try { this.diagramCanvas._forceUpdateAllConnections?.(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_pasteNodesFromClipboard', _); }
    });
    return true;
  }

  /**
   * Render ref preview NGAY lên node card từ data (sau paste/duplicate) — trước đây preview chỉ
   * hiện sau khi mở form + save (logic render nằm trong saveNode). Branch ĐÚNG theo node_type:
   * image → `.df-node-preview` (preview chính), generate/chatgpt/grok → strip thumbnails dưới.
   * Bug cũ: node:duplicated dùng `_showNodeRefPreview` cho CẢ image → image vào sai container → trống.
   * Pre-populate _tileCache từ ref_thumbnails (same-session copy đã có, defensive cho chắc).
   */
  _renderNodeRefPreviewFromData(nodeData) {
    if (!nodeData?.node_id) return;
    const nodeType = nodeData.node_type;
    if (!['image', 'generate', 'chatgpt', 'grok'].includes(nodeType)) return;
    // Pre-populate tile cache từ ref_thumbnails (key = ref_file_ids) — giống loadWorkflow.
    try {
      const activeRefIds = nodeData.ref_file_ids
        ? new Set(String(nodeData.ref_file_ids).split(',').map(s => s.trim()).filter(Boolean))
        : null;
      if (nodeData.ref_thumbnails && typeof nodeData.ref_thumbnails === 'object') {
        for (const [fileId, thumbVal] of Object.entries(nodeData.ref_thumbnails)) {
          if (!fileId || this._tileCache?.has(fileId)) continue;
          if (activeRefIds && !activeRefIds.has(fileId)) continue;
          const isObj = thumbVal && typeof thumbVal === 'object';
          const thumbUrl = isObj ? (thumbVal.thumbnail || '') : (thumbVal || '');
          const videoUrl = isObj ? (thumbVal.video_url || '') : '';
          const refType = (isObj && thumbVal.type === 'video') ? 'video' : 'image';
          if (thumbUrl || videoUrl || refType === 'video') {
            this._tileCacheSet?.(fileId, { thumbnail: thumbUrl, type: refType, ...(videoUrl && { video_url: videoUrl }) });
          }
        }
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_renderNodeRefPreviewFromData', _); }

    try {
      if (this.isTemplateMode) {
        const refUrls = nodeData.ref_img_urls || Object.values(nodeData.ref_thumbnails || {});
        if (refUrls.length > 0) this._showNodeRefPreviewFromUrls(nodeData.node_id, refUrls);
        return;
      }
      const refIds = (nodeData.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!refIds.length) return;
      if (nodeType === 'image') this._showNodePreview(nodeData.node_id, refIds);
      else this._showNodeRefPreview(nodeData.node_id, refIds);
    } catch (e) { console.warn('[WorkflowEditor] render ref preview from data failed:', e?.message); }
  }

  /**
   * Xóa nhiều node (multi-select) — confirm dialog + cleanup form/upload + removeMultipleNodes.
   * Dùng chung cho phím Delete (keydown) lẫn context menu nhóm. ids = drawflow id list.
   */
  async _deleteMultiSelectedNodes(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    const count = ids.length;
    const ok = await window.customDialog?.confirm?.(
      window.I18n?.t('workflow.deleteMultipleConfirm', { count })
        || `Xóa ${count} node đang chọn? Thao tác này không thể hoàn tác.`,
      { title: window.I18n?.t('workflow.deleteNode') || 'Xóa node' }
    );
    if (!ok) return;
    // Cancel uploads của node đang mở form (nếu form node nằm trong batch delete)
    if (this._formNodeId && ids.includes(String(this._formNodeId))
        && this._formUploadKeys?.size > 0 && window.ImmediateUploader) {
      for (const key of this._formUploadKeys) {
        ImmediateUploader.cancel(key);
      }
      this._formUploadKeys.clear();
    }
    const result = this.diagramCanvas?.removeMultipleNodes?.(ids);
    // Đóng form nếu node đang mở thuộc batch deleted
    // [Gap H 2026-06-05] Node deleted → KHÔNG có gì để save → skipDirtySave defense
    if (this._formNodeId && ids.includes(String(this._formNodeId))) {
      await this.hideNodeForm({ skipUploadCheck: true, skipDirtySave: true });
    }
    if (result?.skippedStart > 0 && typeof window.showNotification === 'function') {
      window.showNotification(
        window.I18n?.t('workflow.deleteSkippedStart', { count: result.skippedStart })
          || `Đã bỏ qua ${result.skippedStart} node Start (không thể xóa)`,
        'warning', 2500
      );
    }
  }

  setupPaletteDragDrop() {
    const paletteItems = this.overlay.querySelectorAll('.node-palette-item');
    const diagramContainer = this.overlay.querySelector('#diagramContainer');

    paletteItems.forEach(item => {
      // Phase: block drag cho coming-soon nodes
      item.addEventListener('dragstart', (e) => {
        if (item.dataset.disabled === 'true') {
          e.preventDefault();
          if (typeof window.showNotification === 'function') {
            window.showNotification(
              window.I18n?.t('workflow.comingSoonHint') || 'Node này sắp ra mắt — chưa khả dụng',
              'info'
            );
          }
          return;
        }
        e.dataTransfer.setData('nodeType', item.dataset.nodeType);
      });
      // Click vào disabled cũng show toast
      item.addEventListener('click', (e) => {
        if (item.dataset.disabled === 'true') {
          e.preventDefault();
          if (typeof window.showNotification === 'function') {
            window.showNotification(
              window.I18n?.t('workflow.comingSoonHint') || 'Node này sắp ra mắt — chưa khả dụng',
              'info'
            );
          }
        }
      });
    });

    if (diagramContainer) {
      diagramContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
      });

      diagramContainer.addEventListener('drop', async (e) => {
        e.preventDefault();

        // v1.1 paste image feature: detect image file drop từ desktop TRƯỚC
        // KHÔNG override existing palette drop (image check fail → fall-through nodeType)
        const droppedFiles = Array.from(e.dataTransfer?.files || []);
        const imageFiles = droppedFiles.filter(f => f.type?.startsWith('image/'));
        if (imageFiles.length > 0) {
          const rect = diagramContainer.getBoundingClientRect();
          const dropX = e.clientX - rect.left;
          const dropY = e.clientY - rect.top;
          await this._handlePastedImages(imageFiles, dropX, dropY);
          return;
        }

        // Existing palette nodeType drop (unchanged)
        const nodeType = e.dataTransfer.getData('nodeType');
        if (nodeType && this.diagramCanvas) {
          const rect = diagramContainer.getBoundingClientRect();
          const posX = e.clientX - rect.left;
          const posY = e.clientY - rect.top;

          // Đọc user defaults từ af_settings để áp dụng vào node mới
          const afSettings = await new Promise(resolve => {
            chrome.storage.local.get(['af_settings'], r => resolve(r.af_settings || {}));
          });

          const nodeName = this._generateUniqueNodeName(nodeType);
          // Phase 1 — Node Reference System: Auto-generate slug for mentionable nodes
          const nodeData = {
            ...NodeTemplates.getDefaults(nodeType, afSettings),
            node_name: nodeName,
            node_type: nodeType
          };
          if (this._isMentionableNodeType(nodeType)) {
            nodeData.slug = this._generateSlug(nodeName);
            nodeData.slug_auto = true;
          }
          const nodeId = this.diagramCanvas.addNode(nodeType, posX, posY, nodeData);
          if (nodeId) {
            this._hasUnsavedChanges = true;
            // Phase WK-1.5.3: refresh warning badges sau khi thêm node mới
            try { this._scheduleRefreshNodeWarningBadges(); } catch (err) { globalThis.SEOSONA_swallow?.('WorkflowEditor#setupPaletteDragDrop', err); }
            // Phase enhancement: update data-port-empty cho empty-click handler
            requestAnimationFrame(() => {
              try { this._updatePortEmptyState(); } catch (err) { globalThis.SEOSONA_swallow?.('WorkflowEditor#setupPaletteDragDrop', err); }
              try { this._bindInlineSettingPills(); } catch (err) { globalThis.SEOSONA_swallow?.('WorkflowEditor#setupPaletteDragDrop', err); }
            });
          }

          // Node added to canvas
        }
      });

      // v1.1 paste image feature: Cmd+V trong canvas → auto-add image node
      this._bindCanvasPasteHandler(diagramContainer);
    }
  }

  /**
   * v1.1 paste image feature: listen Cmd+V trong canvas.
   * Skip nếu user đang focus input/textarea (default text paste OK).
   * Image clipboard → _handlePastedImages([files], centerX, centerY).
   */
  _bindCanvasPasteHandler(diagramContainer) {
    if (!diagramContainer || diagramContainer._pasteHandlerBound) return;
    diagramContainer._pasteHandlerBound = true;

    // Bind on document để bắt được paste khi canvas focused (canvas không phải focusable element by default)
    // Filter trong handler để chỉ react khi diagramContainer visible + active
    const handler = async (e) => {
      // Bỏ qua nếu workflow editor đang ẩn/đóng
      if (!this.overlay || this.overlay.style.display === 'none') return;
      // Skip nếu đang focus input/textarea/contenteditable → để default text paste OK
      const tgt = e.target;
      if (tgt?.matches?.('input, textarea, [contenteditable="true"], select')) return;

      // Most-recent-wins: paste ẢNH hay NODE theo cái nào COPY GẦN NHẤT.
      // Ảnh copy ngoài app (không có timestamp) → nhận diện qua id (size+type):
      //   - Ảnh MỚI (id khác lần trước) = vừa copy → ẢNH thắng.
      //   - Ảnh CŨ (id trùng) + node copy SAU lần cuối thấy ảnh đó → NODE thắng (ảnh đang kẹt clipboard).
      const items = Array.from(e.clipboardData?.items || []);
      const imageItems = items.filter(it => it.type?.startsWith('image/') && it.kind === 'file');
      const _files = imageItems.map(it => it.getAsFile()).filter(Boolean);
      const _nodeClip = this._nodeClipboard;
      const _hasNodeClip = !!(_nodeClip?.nodes?.length || _nodeClip?.data);

      const _pasteNodeNow = () => {
        e.preventDefault();
        this._pasteHandledAt = Date.now();
        if (_nodeClip.nodes?.length) this._pasteNodesFromClipboard();
        else this._pasteNodeFromClipboard();
      };

      if (_files.length > 0) {
        const f = _files[0];
        const imgId = (f.size || 0) + '_' + (f.type || '');
        const isNewImage = imgId !== this._lastClipImageId;
        const nodeIsFresher = _hasNodeClip && (_nodeClip.copiedAt || 0) > (this._lastClipImageSeenAt || 0);

        if (!isNewImage && nodeIsFresher) {
          // Ảnh cũ còn kẹt clipboard + node copy mới hơn → paste NODE.
          _pasteNodeNow();
          return;
        }
        // Ảnh mới HOẶC node không mới hơn → paste ẢNH + cập nhật id/mốc thời gian.
        e.preventDefault();
        this._pasteHandledAt = Date.now();
        this._lastClipImageId = imgId;
        this._lastClipImageSeenAt = Date.now();
        const rect = diagramContainer.getBoundingClientRect();
        await this._handlePastedImages(_files, rect.width / 2, rect.height / 2);
        return;
      }

      // Không có ảnh trong OS clipboard → paste node nếu có.
      if (_hasNodeClip) {
        _pasteNodeNow();
        return;
      }
      // Không ảnh, không node clipboard → để default paste behavior
    };

    document.addEventListener('paste', handler);
    // Track listener cho cleanup khi editor closed (xem destroy/onClose flow)
    this._pasteHandler = handler;
  }

  /**
   * v1.1 paste image feature: orchestrator tạo image nodes từ paste/drop files.
   * - Validate quota (delegated to DiagramCanvas.addNode built-in check)
   * - Persist blob vào IndexedDB workflow_paste_blobs (no TTL)
   * - Generate tempId upload_xxx
   * - Add image node với ref_file_ids = tempId, thumbnail dataURL, fileName
   * - Trigger background upload via ImmediateUploader
   * - Position offset 50px stacked diagonal cho multi-paste
   *
   * @param {File[]} files - Image files from clipboard hoặc dataTransfer
   * @param {number} basePosX - Starting position X (cursor cho drop, center cho paste)
   * @param {number} basePosY - Starting position Y
   */
  async _handlePastedImages(files, basePosX, basePosY) {
    if (!Array.isArray(files) || files.length === 0 || !this.diagramCanvas) return;

    // Template editor: BLOCK paste image — Flow CDN URL signature TTL gây ảnh missing
    // sau vài ngày khi user clone template. Admin nên dùng admin Template Settings
    // (server storage URL permanent) để thêm ref images cho template.
    if (this.isTemplateMode) {
      window.showNotification?.(
        window.I18n?.t?.('workflow.pasteImageBlockedTemplate')
          || 'Template không hỗ trợ paste ảnh trực tiếp. Dùng admin Template Settings → Ref Images URL để thêm ảnh permanent.',
        'warning', 4000
      );
      return;
    }

    // Read user defaults (parity với palette drop pattern)
    const afSettings = await new Promise(resolve => {
      chrome.storage.local.get(['af_settings'], r => resolve(r.af_settings || {}));
    });

    const workflowId = this.workflow?.wf_id || null;
    const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20MB warn threshold
    const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];
    const SUPPORTED_HINT = 'PNG, JPG, WEBP, GIF, BMP';

    let added = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      // Format check — HEIC/AVIF/etc not supported by canvas/Flow
      const mimeType = file.type || '';
      if (!ALLOWED_TYPES.includes(mimeType)) {
        const fileLabel = file.name || `image #${i + 1}`;
        const msg = (window.I18n?.t?.('workflow.pasteImage.formatUnsupported', { name: fileLabel, formats: SUPPORTED_HINT }))
          || `Định dạng "${fileLabel}" không hỗ trợ. Dùng ${SUPPORTED_HINT}.`;
        window.showNotification?.(msg, 'warning');
        continue;
      }

      // Size warn (nhưng vẫn cho phép upload)
      if (file.size > MAX_SIZE_BYTES) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        const msg = (window.I18n?.t?.('workflow.pasteImage.fileLarge', { name: file.name, size: sizeMB }))
          || `Ảnh "${file.name}" lớn (${sizeMB}MB) — có thể upload chậm.`;
        window.showNotification?.(msg, 'info');
      }

      // Read file as data URL for thumbnail preview
      let dataUrl;
      try {
        dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
          reader.readAsDataURL(file);
        });
      } catch (err) {
        console.warn('[Paste] FileReader failed for', file.name, err?.message);
        window.showNotification?.(
          (window.I18n?.t?.('workflow.pasteImage.readFailed', { name: file.name }))
            || `Không đọc được ảnh "${file.name}".`,
          'error'
        );
        continue;
      }

      // Generate tempId (existing pattern in extension)
      const tempId = 'upload_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const fileName = file.name || `pasted-${Date.now()}.png`;

      // Persist blob vào IndexedDB (NO TTL) — bulletproof vs 2h pending_uploads TTL
      try {
        await window.PendingUploadStore?.savePasteBlob?.({
          id: tempId,
          blob: file,
          fileName,
          mimeType,
          size_bytes: file.size,
          workflow_id: workflowId,
        });
      } catch (err) {
        console.warn('[Paste] savePasteBlob failed (continuing with memory-only):', err?.message);
      }

      // Register vào MediaRegistry (thumbnail + fileName cache)
      try {
        window.MediaRegistry?.set?.(tempId, dataUrl, fileName);
      } catch (err) {
        console.warn('[Paste] MediaRegistry.set failed:', err?.message);
      }

      // Populate window.pendingUploadFiles để `_renderNodePreviewInner` fallback
      // (line ~11890) tìm được thumbnail khi render node diagram preview.
      try {
        if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
        window.pendingUploadFiles.set(tempId, {
          file,
          thumbnail: dataUrl,
          name: fileName,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.warn('[Paste] pendingUploadFiles.set failed:', err?.message);
      }

      // Populate _tileCache để _renderNodePreviewInner tìm thấy ngay khi node render.
      try {
        this._tileCacheSet?.(tempId, {
          thumbnail: dataUrl,
          file_name: fileName,
          type: 'image',
        });
      } catch (err) {
        console.warn('[Paste] _tileCacheSet failed:', err?.message);
      }

      // Position offset 50px stacked diagonal cho multi-paste (added counter để skip failed entries)
      const posX = basePosX + (added * 50);
      const posY = basePosY + (added * 50);

      // Build node data — image node với ref_file_ids = tempId
      const nodeName = this._generateUniqueNodeName('image');
      const nodeData = {
        ...NodeTemplates.getDefaults('image', afSettings),
        node_name: nodeName,
        node_type: 'image',
        ref_file_ids: tempId,
        ref_thumbnails: { [tempId]: dataUrl },
        ref_file_names: { [tempId]: fileName },
      };
      if (this._isMentionableNodeType('image')) {
        nodeData.slug = this._generateSlug(nodeName);
        nodeData.slug_auto = true;
      }

      // addNode tự check quota (built-in). null trả về nếu quota fail → show upgrade modal automatically
      const nodeId = this.diagramCanvas.addNode('image', posX, posY, nodeData);
      if (!nodeId) {
        // Quota fail → addNode đã show upgrade dialog. Abort remaining.
        // Cleanup tempId đã lưu (avoid orphan blob trong IndexedDB)
        try { await window.PendingUploadStore?.deletePasteBlob?.(tempId); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#onerror', _); }
        try { window.MediaRegistry?.delete?.(tempId); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#onerror', _); }
        break;
      }

      this._hasUnsavedChanges = true;
      added++;

      // Trigger background upload TRƯỚC khi render preview để spinner detect được
      // `ImmediateUploader.isUploading(tempId) === true`. upload() set marker sync
      // (line 102 ImmediateUploader) ngay khi gọi, dù await ensureFlowTabReady async.
      try {
        window.ImmediateUploader?.upload?.(file, null, { key: tempId, name: fileName })
          .then(async (result) => {
            if (result?.success && result?.file_name) {
              // Mark uploaded trong persistent store (schedule cleanup 3 ngày)
              await window.PendingUploadStore?.markPasteBlobUploaded?.(tempId, result.file_name);
            } else if (result && !result.pending) {
              await window.PendingUploadStore?.markPasteBlobFailed?.(tempId, result.error || 'unknown');
            }
          })
          .catch(async (err) => {
            await window.PendingUploadStore?.markPasteBlobFailed?.(tempId, err?.message);
          });
      } catch (err) {
        console.warn('[Paste] ImmediateUploader.upload threw:', err?.message);
      }

      // Render preview NGAY sau upload start (placeholder SVG → dataURL thumb với
      // spinner overlay). Drawflow `addNode` chỉ render placeholder; thumb thực tế
      // render qua `_directRenderNodePreview`. Phải gọi SAU `upload()` để
      // `isUploading(tempId)` đã `true` → spinner class apply.
      try {
        this._directRenderNodePreview(nodeData.node_id || nodeId, [tempId]);
      } catch (err) {
        console.warn('[Paste] initial preview render failed:', err?.message);
      }
    }

    if (added > 0) {
      // Refresh UI sau khi thêm nodes (parity với palette drop)
      try { this._scheduleRefreshNodeWarningBadges(); } catch (err) { globalThis.SEOSONA_swallow?.('WorkflowEditor#onerror', err); }
      requestAnimationFrame(() => {
        try { this._updatePortEmptyState(); } catch (err) { globalThis.SEOSONA_swallow?.('WorkflowEditor#onerror', err); }
        try { this._bindInlineSettingPills(); } catch (err) { globalThis.SEOSONA_swallow?.('WorkflowEditor#onerror', err); }
      });

      // Toast summary nếu multi-paste
      if (files.length > 1) {
        const msg = (window.I18n?.t?.('workflow.pasteImage.addedMulti', { count: added, total: files.length }))
          || `Đã thêm ${added}/${files.length} ảnh vào workflow.`;
        window.showNotification?.(msg, 'success');
      }
    }
  }

  // Mở media picker (album/upload/flow) → tạo 1 node Image cho mỗi ảnh đã chọn.
  _openMediaModalAndAddImageNodes(opts = {}) {
    if (!this.getPermissions().canEdit) return;
    if (this.isTemplateMode) {
      window.showNotification?.(
        window.I18n?.t?.('workflow.pasteImageBlockedTemplate') || 'Template không hỗ trợ thêm ảnh trực tiếp.',
        'warning', 4000
      );
      return;
    }
    if (!window.imagePickerModal || typeof window.imagePickerModal.open !== 'function') {
      console.error('[WorkflowEditor] imagePickerModal không tồn tại');
      return;
    }
    const rect = this.overlay?.querySelector('#diagramContainer')?.getBoundingClientRect();
    const baseX = opts.canvasX ?? this._lastMouseCanvasPos?.x ?? (rect ? rect.width / 2 : 200);
    const baseY = opts.canvasY ?? this._lastMouseCanvasPos?.y ?? (rect ? rect.height / 2 : 200);
    window.imagePickerModal.open({
      mediaFilter: 'image',
      onConfirm: async (images) => {
        const list = Array.isArray(images) ? images : [];
        if (!list.length) return;
        const refs = []; // { key, thumbnail, file_name, file? }
        for (const img of list) {
          try {
            if (img.source === 'album') {
              const prepared = await ImagePickerModal.prepareAlbumImageForRef(img);
              if (!prepared) continue;
              refs.push({ key: prepared.key, thumbnail: img.thumbnail, file_name: prepared.file_name || '' });
            } else if (img.source === 'upload' && img.file) {
              const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
              window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });
              refs.push({ key, thumbnail: img.thumbnail, file_name: img.file_name || img.file.name || '', file: img.file });
            } else { // flow / existing → đã có file_id trên Flow
              if (!img.fileId) continue;
              refs.push({ key: img.fileId, thumbnail: img.thumbnail, file_name: img.file_name || '' });
            }
          } catch (err) {
            console.error('[MediaModal] chuẩn bị ảnh thất bại:', err);
          }
        }
        if (refs.length) await this._addImageNodesFromRefs(refs, baseX, baseY);
      }
    });
  }

  /** Tạo 1 node Image cho mỗi ref (từ ImagePickerModal). Album prepared/local → upload nền; Flow → dùng luôn. */
  async _addImageNodesFromRefs(refs, baseX, baseY) {
    if (!Array.isArray(refs) || !refs.length || !this.diagramCanvas) return;
    const afSettings = await new Promise(resolve => {
      chrome.storage.local.get(['af_settings'], r => resolve(r.af_settings || {}));
    });
    let added = 0;
    for (const ref of refs) {
      const key = ref.key;
      if (!key) continue;
      try { this._tileCacheSet?.(key, { thumbnail: ref.thumbnail, file_name: ref.file_name || '', type: 'image' }); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_addImageNodesFromRefs', _); }

      const posX = baseX + (added * 50);
      const posY = baseY + (added * 50);
      const nodeName = this._generateUniqueNodeName('image');
      const nodeData = {
        ...NodeTemplates.getDefaults('image', afSettings),
        node_name: nodeName,
        node_type: 'image',
        ref_file_ids: key,
        ref_thumbnails: { [key]: ref.thumbnail },
        ref_file_names: { [key]: ref.file_name || '' },
      };
      if (this._isMentionableNodeType('image')) {
        nodeData.slug = this._generateSlug(nodeName);
        nodeData.slug_auto = true;
      }

      const nodeId = this.diagramCanvas.addNode('image', posX, posY, nodeData);
      if (!nodeId) break; // quota fail → addNode đã show upgrade dialog

      this._hasUnsavedChanges = true;
      added++;

      // Upload nền: local file (ref.file) hoặc album prepared (key upload_ có pendingUploadFiles)
      try {
        const pendingFile = ref.file || window.pendingUploadFiles?.get(key)?.file;
        if (pendingFile && window.ImmediateUploader && (key.startsWith('upload_') || ref.file)) {
          this._formUploadKeys?.add(key);
          ImmediateUploader.upload(pendingFile, ref.thumbnail, { key })
            .catch(e => this._handleUploadError?.(e, 'Media image'));
        }
      } catch (err) {
        console.warn('[MediaModal] upload nền thất bại:', err?.message);
      }

      try { this._directRenderNodePreview(nodeData.node_id || nodeId, [key]); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_addImageNodesFromRefs', _); }
    }

    if (added > 0) {
      try { this._scheduleRefreshNodeWarningBadges(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_addImageNodesFromRefs', _); }
      requestAnimationFrame(() => {
        try { this._updatePortEmptyState(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_addImageNodesFromRefs', _); }
        try { this._bindInlineSettingPills(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_addImageNodesFromRefs', _); }
      });
      if (refs.length > 1) {
        window.showNotification?.(
          (window.I18n?.t?.('workflow.pasteImage.addedMulti', { count: added, total: refs.length }))
            || `Đã thêm ${added}/${refs.length} ảnh vào workflow.`,
          'success'
        );
      }
    }
  }

  /**
   * v1.1 paste image feature: retry uploads cho paste blobs còn pending/failed.
   * Gọi khi workflow editor open — handle case browser restart hoặc upload fail trước đó.
   * Chỉ retry blobs có tempId còn xuất hiện trong workflow nodes (avoid orphan retries).
   */
  async _retryPendingPasteUploads() {
    const workflowId = this.workflow?.wf_id;
    if (!workflowId || !window.PendingUploadStore?.getPendingPasteBlobs) return;

    const pending = await window.PendingUploadStore.getPendingPasteBlobs(workflowId);
    if (!pending || pending.length === 0) return;

    // Build set tempId đang dùng trong workflow (qua ref_file_ids của các nodes)
    const usedTempIds = new Set();
    const nodes = this.workflow?.nodes || [];
    for (const node of nodes) {
      const refIds = node?.data?.ref_file_ids;
      if (typeof refIds === 'string' && refIds.includes('upload_')) {
        refIds.split(',').map(s => s.trim()).filter(s => s.startsWith('upload_')).forEach(id => usedTempIds.add(id));
      }
    }

    let retried = 0;
    for (const entry of pending) {
      if (!usedTempIds.has(entry.id)) {
        // Orphan blob — node đã bị xóa nhưng blob còn → cleanup
        try { await window.PendingUploadStore.deletePasteBlob(entry.id); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_retryPendingPasteUploads', _); }
        continue;
      }

      // Skip nếu retry quá nhiều lần (>5 attempts) → user phải manual remove/re-add
      if ((entry.upload_attempts || 0) >= 5) continue;

      // Re-register MediaRegistry (RAM cache có thể đã evict sau browser restart)
      if (entry.blob) {
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(entry.blob);
          });
          window.MediaRegistry?.set?.(entry.id, dataUrl, entry.fileName);
        } catch (_) { /* thumbnail re-gen fail không block retry upload */ }

        // Retry upload (background)
        window.ImmediateUploader?.upload?.(entry.blob, null, { key: entry.id, name: entry.fileName })
          .then(async (result) => {
            if (result?.success && result?.file_name) {
              await window.PendingUploadStore?.markPasteBlobUploaded?.(entry.id, result.file_name);
            } else if (result && !result.pending) {
              await window.PendingUploadStore?.markPasteBlobFailed?.(entry.id, result.error || 'unknown');
            }
          })
          .catch(async (err) => {
            await window.PendingUploadStore?.markPasteBlobFailed?.(entry.id, err?.message);
          });
        retried++;
      }
    }

    if (retried > 0) {
      console.log(`[WorkflowEditor] Retried ${retried} pending paste uploads for workflow ${workflowId}`);
    }
  }

  /**
   * Lấy danh sách nodes đang kết nối input vào node hiện tại
   */
  _getConnectedSourceNodes(nodeId) {
    if (!this.diagramCanvas?.editor) return [];

    const exportData = this.diagramCanvas.editor.export();
    const homeData = exportData.drawflow?.Home?.data || {};
    const sources = [];

    Object.entries(homeData).forEach(([id, nodeData]) => {
      Object.values(nodeData.outputs || {}).forEach(output => {
        (output.connections || []).forEach(conn => {
          if (String(conn.node) === String(nodeId)) {
            sources.push({
              drawflowId: id,
              node_id: nodeData.data?.node_id || `node_${id}`,
              node_name: nodeData.data?.node_name || nodeData.class || `Node ${id}`,
              input_handle: conn.output // input_1, input_2...
            });
          }
        });
      });
    });

    return sources;
  }

  /**
   * Phase CG-8: Render radio "Prompt source" cho generate/chatgpt/grok.
   * Cho phép user chọn dùng prompt từ textbox (default) hay từ upstream Prompt node.
   * @param {Object} data - Node data
   * @param {string} nodeId - Drawflow node ID
   * @returns {string} HTML
   */
  _renderPromptSourceRadio(data, nodeId) {
    // Tìm upstream Prompt node từ tất cả input connections
    let upstreamPromptNode = null;
    let hasUpstreamConnection = false;
    if (this.diagramCanvas?.editor && nodeId) {
      try {
        // nodeId có thể là drawflow ID (số) hoặc custom node_id (string).
        // Thử getNodeFromId trước, nếu không có thì dùng _findDrawflowId.
        let node = this.diagramCanvas.editor.getNodeFromId(nodeId);
        if (!node && this._findDrawflowId) {
          const dfId = this._findDrawflowId(nodeId);
          if (dfId) node = this.diagramCanvas.editor.getNodeFromId(dfId);
        }
        if (node) {
          // Check tất cả inputs để tìm upstream text-source node (prompt/text/text_extract)
          const allInputKeys = Object.keys(node.inputs || {});
          for (const inputKey of allInputKeys) {
            const conns = node.inputs?.[inputKey]?.connections || [];
            for (const conn of conns) {
              const srcNode = this.diagramCanvas.editor.getNodeFromId(conn.node);
              const srcType = srcNode?.data?.node_type || srcNode?.class;
              // 2026-05-31: thêm text_extract — node output text feed downstream prompt.
              if (['prompt', 'text', 'text_extract', 'text_template', 'random_pick', 'prompt_sequence', 'variant_expand', 'loop'].includes(srcType)) {
                upstreamPromptNode = srcNode;
                hasUpstreamConnection = true;
                break;
              }
            }
            if (upstreamPromptNode) break;
          }
        }
      } catch (e) { /* ignore */ }
    }
    // Auto-detect prompt_source từ connections nếu chưa được set
    let promptSource = data.prompt_source;
    if (promptSource === undefined || promptSource === null) {
      promptSource = hasUpstreamConnection ? 'upstream_node' : 'textbox';
    }
    const useOwnPrompt = promptSource === 'textbox';
    const upstreamName = upstreamPromptNode?.data?.node_name || upstreamPromptNode?.data?.prompt?.substring(0, 30) || '';
    const promptSourceIcon = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.17 3.646a.5.5 0 0 1 .707 0l5.477 5.477a.5.5 0 0 1 0 .707l-1.366 1.366a4.373 4.373 0 1 1-6.184-6.184L6.17 3.646Zm.353 1.061L5.508 5.723 5.5 5.73a3.373 3.373 0 1 0 4.77 4.77l.006-.008 1.016-1.015-4.77-4.77Z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M5.354 10.646a.5.5 0 0 1 0 .707L3.02 13.688a.5.5 0 1 1-.707-.707l2.334-2.334a.5.5 0 0 1 .707 0ZM10.354 2.313a.5.5 0 0 1 0 .707L8.02 5.354a.5.5 0 0 1-.707-.708l2.334-2.333a.5.5 0 0 1 .707 0ZM13.687 5.646a.5.5 0 0 1 0 .708l-2.333 2.333a.5.5 0 1 1-.707-.707l2.333-2.334a.5.5 0 0 1 .707 0Z" fill="currentColor"></path></svg>';

    // Inline indicator hiển thị bên phải toggle khi đang dùng upstream Prompt
    const inlineIndicator = !useOwnPrompt && upstreamPromptNode
      ? `<span class="prompt-source-inline-indicator" title="${this.escapeAttr(upstreamName)}">
          ${promptSourceIcon}
          <span>${this.escapeHtml(upstreamName.length > 15 ? upstreamName.substring(0, 15) + '…' : upstreamName)}</span>
        </span>`
      : (!useOwnPrompt
        ? `<span class="prompt-source-inline-warning" title="${window.I18n?.t('workflow.noUpstreamPrompt') || 'Chưa connect upstream Prompt node'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </span>`
        : '');

    return `
      <div class="form-group prompt-source-group">
        <div class="prompt-source-row">
          <label class="toolbar-toggle" for="promptSourceToggle">
            <input type="checkbox" id="promptSourceToggle" ${useOwnPrompt ? 'checked' : ''} class="prompt-source-toggle" />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
            <span class="toggle-label">${window.I18n?.t('workflow.promptSourceOwn') || 'Sử dụng Prompt riêng'}</span>
          </label>
          ${inlineIndicator}
        </div>
      </div>`;
  }

  /**
   * AI Agent rename + i18n (2026-05-30) — Help tab content cho prompt node, localized.
   * Render đúng locale user qua I18n.t key. Fallback VI (default tổ chức).
   * @param {Object} icons - { icoPencil, icoSpark, icoWarn, icoFilm, mentionGuide }
   * @returns {string} HTML
   */
  _getPromptHelpHtml(icons) {
    const { icoPencil, icoSpark, icoWarn, icoFilm, mentionGuide } = icons;
    const t = (key, fallback) => window.I18n?.t?.(key) || fallback;

    // Section 1: Overview + features list
    const title = t('node.promptHelp.title', 'AI Agent Node');
    const overview = t('node.promptHelp.overview',
      'Node trung gian text — viết prompt + tùy chọn <strong>Use AI</strong> qua ChatGPT/Gemini để xử lý multi-purpose (enhance prompt, analyze ảnh, compose, summarize, translate, brainstorm).');
    const featPrompt = t('node.promptHelp.featPrompt',
      '<strong>Prompt text</strong>: prompt gốc. Có thể dùng <code>@mention</code> tham chiếu node khác (xem Mention section).');
    const featToggle = t('node.promptHelp.featToggle', '<strong>Use AI toggle</strong>:');
    const featOff = t('node.promptHelp.featOff',
      '<strong>OFF (Plain mode)</strong>: pass-through text giống Text node → downstream nhận text gốc (đã resolve @mention nếu prompt_mode=\'mention\').');
    const featOn = t('node.promptHelp.featOn',
      '<strong>ON (AI mode)</strong>: submit lên ChatGPT/Gemini → AI process → downstream nhận result.');
    const featProvider = t('node.promptHelp.featProvider',
      '<strong>Provider</strong> (khi Use AI ON): <code>ChatGPT</code> (default) hoặc <code>Gemini</code> (Google — phân tích image refs tốt + multimodal).');
    const featTimeout = t('node.promptHelp.featTimeout',
      '<strong>Timeout</strong>: 30-180s, mặc định 60s. Timeout → fallback plain text (auto) hoặc fail workflow (tùy <code>ai_fallback</code>).');
    const featRef = t('node.promptHelp.featRef',
      '<strong>Ref images</strong> (khi Use AI ON): upload ảnh để AI analyze + tạo prompt từ visual (vd "Mô tả ảnh này thành prompt sản phẩm").');
    const featDelete = t('node.promptHelp.featDelete',
      '<strong>Delete after AI run</strong>: tự xoá conversation trên ChatGPT/Gemini sau khi run — tránh history rác.');
    const noteMention = t('node.promptHelp.noteMention',
      '<strong>Mention resolve cho AI Agent</strong>: <code>@chu_de</code> sẽ được resolve thành nội dung node tương ứng trước khi submit lên LLM — đồng bộ với Generate/ChatGPT/Grok nodes.');
    const noteRequire = t('node.promptHelp.noteRequire',
      '<em>Yêu cầu Use AI</em>: feature gate <code>ai_agent_enabled</code> ON (gói trả phí). Free plan tự fallback plain + notification.');

    // Section 2: Common workflow pattern with Text Extract
    const section2Title = t('node.promptHelp.section2Title', 'Workflow phổ biến với AI Agent + Text Extract');
    const section2Intro = t('node.promptHelp.section2Intro', 'Tạo nhiều prompts cùng lúc từ 1 chủ đề:');
    const section2Code = t('node.promptHelp.section2Code', `[Text: chủ đề]
  ↓
[AI Agent — Use AI ON]
"Tạo 5 prompt tạo ảnh storyboard cho chủ đề @text.
Format CHÍNH XÁC:
[image_prompt_1]: &lt;nội dung 1&gt;
[image_prompt_2]: &lt;nội dung 2&gt;
...
[image_prompt_5]: &lt;nội dung 5&gt;"
  ↓
[Text Extract] x 5 (mỗi cái marker=image_prompt_N)
  ↓
[Flow Generate] x 5 (mỗi node nhận 1 prompt)`);
    const section2Why = t('node.promptHelp.section2Why',
      '<strong>Lý do dùng Text Extract</strong>: 1 AI call thay vì 5-6 (tiết kiệm token + thời gian).');

    return `
      <div class="help-section">
        <h4>${icoPencil}<span>${title}</span></h4>
        <p>${overview}</p>
        <ol>
          <li>${featPrompt}</li>
          <li>${featToggle}
            <ul>
              <li>${featOff}</li>
              <li>${featOn}</li>
            </ul>
          </li>
          <li>${featProvider}</li>
          <li>${featTimeout}</li>
          <li>${featRef}</li>
          <li>${featDelete}</li>
        </ol>
        <p>${icoSpark}${noteMention}</p>
        <p>${icoWarn}${noteRequire}</p>
      </div>
      ${mentionGuide}
      <div class="help-section">
        <h4>${icoFilm}<span>${section2Title}</span></h4>
        <p>${section2Intro}</p>
        <pre>${section2Code}</pre>
        <p>${section2Why}</p>
      </div>
    `;
  }

  /**
   * Phase WK-1.5.1: Hint nhỏ thay UI radio prompt_source — explain typed port "text".
   * Chỉ áp dụng cho generate/chatgpt/grok.
   * @returns {string} HTML
   */
  _renderUpstreamPromptHint() {
    const hintText = window.I18n?.t('workflow.upstreamPromptHint') ||
      'Prompt từ upstream Prompt node (kéo edge vào port "text" để dùng).';
    return `
      <div class="form-group" style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted-foreground);padding:6px 0;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
          <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        <span>${hintText}</span>
      </div>`;
  }

  /**
   * Render provider status indicator + open button cho ChatGPT/Grok nodes
   * @param {string} provider - 'chatgpt' | 'grok'
   * @returns {string} HTML
   */
  _renderProviderLoginReminder(provider) {
    const providerLabel = window.ProviderMeta?.getName?.(provider) || provider;
    const openText = window.I18n?.t('workflow.openProvider') || 'Open';
    const notReadyText = `${openText} ${providerLabel}`;
    const readyText = window.I18n?.t('workflow.providerReady') || 'Ready';
    const tooltipNotReady = window.I18n?.t('workflow.providerNotReady', { provider: providerLabel }) || `${providerLabel} chưa sẵn sàng`;
    const tooltipReady = window.I18n?.t('workflow.providerReadyTooltip', { provider: providerLabel }) || `${providerLabel} đã sẵn sàng`;
    return `
      <button type="button" class="provider-reminder-btn" data-action="openProvider" data-provider="${provider}"
        data-tooltip-ready="${tooltipReady}"
        data-tooltip-not-ready="${tooltipNotReady}">
        <span class="provider-status-dot"></span>
        <span class="provider-btn-text" data-ready-text="${readyText}" data-not-ready-text="${notReadyText}">${notReadyText}</span>
        <span class="provider-status-tooltip"></span>
      </button>`;
  }

  /**
   * Check and update provider status indicator in brand header or prompt node
   * @param {string} provider - 'chatgpt' | 'grok' | 'gemini'
   */
  async _updateProviderStatusIndicator(provider) {
    // For ChatGPT/Grok brand header: target the button directly
    const buttons = this.overlay?.querySelectorAll(`.provider-reminder-btn[data-provider="${provider}"]`);
    // For Prompt node: target the span indicators
    const indicators = this.overlay?.querySelectorAll(`.provider-status-indicator[data-provider="${provider}"]`);

    if (!buttons?.length && !indicators?.length) return;

    try {
      let isReady = false;
      if (provider === 'chatgpt') {
        if (window.ChatGPTSession?.ensureReady) {
          // [Bug 62 fix 2026-05-24] silent: true cho tooltip status check
          const result = await window.ChatGPTSession.ensureReady({ createIfMissing: false, activate: false, silent: true }).catch(() => ({ ready: false }));
          isReady = result?.ready === true;
        }
      } else if (provider === 'grok') {
        if (window.GrokSession?.ensureReady) {
          // [Bug 62 fix 2026-05-24] silent: true cho tooltip status check
          const result = await window.GrokSession.ensureReady({ createIfMissing: false, activate: false, silent: true }).catch(() => ({ ready: false }));
          isReady = result?.ready === true;
        }
      } else if (provider === 'gemini') {
        if (window.GeminiSession?.ensureReady) {
          const result = await window.GeminiSession.ensureReady({ createIfMissing: false, activate: false }).catch(() => ({ ready: false }));
          isReady = result?.ready === true;
        }
      }

      const providerLabel = window.ProviderMeta?.getName?.(provider) || provider;
      const title = isReady
        ? (window.I18n?.t('workflow.providerReady') || 'Ready')
        : (window.I18n?.t('workflow.providerNotReady', { provider: providerLabel }) || `${providerLabel} not ready`);

      // Update brand header buttons (ChatGPT/Grok nodes)
      buttons?.forEach(btn => {
        btn.classList.toggle('ready', isReady);
        btn.classList.toggle('not-ready', !isReady);
        btn.title = title;
        const textEl = btn.querySelector('.provider-btn-text');
        if (textEl) {
          textEl.textContent = isReady ? textEl.dataset.readyText : textEl.dataset.notReadyText;
        }
        const tooltipEl = btn.querySelector('.provider-status-tooltip');
        if (tooltipEl) {
          tooltipEl.textContent = isReady ? btn.dataset.tooltipReady : btn.dataset.tooltipNotReady;
        }
      });

      // Update Prompt node indicators
      indicators?.forEach(indicator => {
        indicator.classList.toggle('ready', isReady);
        indicator.classList.toggle('not-ready', !isReady);
        indicator.title = title;
      });
    } catch (e) {
      buttons?.forEach(btn => {
        btn.classList.remove('ready');
        btn.classList.add('not-ready');
      });
      indicators?.forEach(indicator => {
        indicator.classList.remove('ready');
        indicator.classList.add('not-ready');
      });
    }
  }

  /**
   * Poll provider status until ready or max attempts reached
   * @param {string} provider - 'chatgpt' | 'grok' | 'gemini'
   * @param {number} maxAttempts - Maximum number of polling attempts
   * @param {number} interval - Interval between polls in ms
   */
  async _pollProviderStatus(provider, maxAttempts = 15, interval = 2000) {
    // Clear any existing poll for this provider
    if (this._providerPollTimers?.[provider]) {
      clearTimeout(this._providerPollTimers[provider]);
    }
    if (!this._providerPollTimers) this._providerPollTimers = {};

    let attempts = 0;
    const poll = async () => {
      // Guard: stop polling if form panel is hidden or overlay is gone
      const formPanel = this.overlay?.querySelector('#nodeFormPanel');
      if (!formPanel || formPanel.classList.contains('hidden')) {
        console.log(`[WorkflowEditor] ${provider} polling stopped - form closed`);
        delete this._providerPollTimers[provider];
        return;
      }

      attempts++;
      await this._updateProviderStatusIndicator(provider);

      // Check if now ready
      const btn = this.overlay?.querySelector(`.provider-reminder-btn[data-provider="${provider}"]`);
      const isReady = btn?.classList.contains('ready');

      if (isReady) {
        console.log(`[WorkflowEditor] ${provider} is now ready after ${attempts} attempts`);
        delete this._providerPollTimers[provider];
        return;
      }

      if (attempts < maxAttempts) {
        this._providerPollTimers[provider] = setTimeout(poll, interval);
      } else {
        console.log(`[WorkflowEditor] ${provider} polling stopped after ${maxAttempts} attempts`);
        delete this._providerPollTimers[provider];
      }
    };

    // Start polling
    poll();
  }

  /**
   * Count incoming connections for a node
   * @param {string|number} drawflowId - Drawflow internal ID
   * @returns {number} Number of incoming connections
   */
  _getIncomingConnectionCount(drawflowId) {
    if (!this.diagramCanvas?.editor || !drawflowId) return 0;
    try {
      const node = this.diagramCanvas.editor.getNodeFromId(drawflowId);
      if (!node?.inputs) return 0;
      let count = 0;
      for (const inputKey of Object.keys(node.inputs)) {
        count += node.inputs[inputKey]?.connections?.length || 0;
      }
      return count;
    } catch (e) {
      return 0;
    }
  }

  /**
   * DEPRECATED: UI dropdowns đã bỏ, mode auto-detect từ prompt.
   * Giữ function để không break existing callers.
   */
  _updateRefModeVisibility() {
    // No-op: prompt_mode/ref_mode auto-detect từ prompt content khi save
  }

  /**
   * EWT-9.2: Render ref images field cho template mode
   * Khi isTemplateMode = true, hiển thị UI upload ảnh lên server thay vì chọn từ Flow
   * @param {Object} data - Node data
   * @param {string} previewId - ID của container preview (VD: 'imageNodeRefPreview')
   * @param {string} inputId - ID của hidden input (VD: 'nodeRefFileIds')
   * @param {string} btnId - ID của nút thêm ảnh (VD: 'imageNodePickBtn')
   * @param {number} maxImages - Số lượng ảnh tối đa (mặc định 10)
   * @returns {string} HTML string
   */
  _renderRefImagesFieldForTemplate(data, previewId, inputId, btnId, maxImages = 10) {
    const refImgUrls = data.ref_img_urls || [];
    console.log('[WorkflowEditor] _renderRefImagesFieldForTemplate - data.ref_img_urls:', refImgUrls);
    const refImgUrlsJson = JSON.stringify(refImgUrls);
    const maxLabel = maxImages < 10 ? ` (${window.I18n?.t('workflow.maxImages', { max: maxImages }) || `tối đa ${maxImages}`})` : '';

    return `
      <div class="form-group template-ref-images-group" id="${previewId}Group">
        <label>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          ${window.I18n?.t('workflow.refImages') || 'Reference images'}${maxLabel}
          <span class="template-mode-badge" title="${window.I18n?.t('workflow.templateModeHint') || 'Editing template - images will be uploaded to server'}">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Server
          </span>
        </label>
        <div class="template-ref-images-grid" id="${previewId}">
          <!-- Preview images được render bởi JS -->
        </div>
        <button class="node-ref-btn template-ref-add-btn" id="${btnId}" type="button">
          <svg class="node-ref-btn__icon ref-btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8h.01"></path><path d="M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5"></path><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l3.5 3.5"></path><path d="M14 14l1 -1c.679 -.653 1.473 -.829 2.214 -.526"></path><path d="M19 22v-6"></path><path d="M22 19l-3 -3l-3 3"></path></svg>
          <span class="node-ref-btn__text">${window.I18n?.t('workflow.addRefImage') || 'Thêm ảnh'}</span>
        </button>
        <!-- Hidden input lưu ref_img_urls (array JSON) cho template mode -->
        <input type="hidden" id="${inputId}" value="${this.escapeAttr(refImgUrlsJson)}" data-template-mode="true" />
      </div>`;
  }

  /**
   * EWT-9.5: Render preview ảnh tham chiếu cho template mode (từ URLs)
   * @param {string[]} urls - Mảng URLs ảnh
   * @param {string} containerSelector - Selector của container preview
   */
  _renderTemplateRefImagesPreview(urls, containerSelector) {
    const container = this.overlay?.querySelector(containerSelector);
    if (!container) return;

    if (!urls || urls.length === 0) {
      container.innerHTML = `
        <div class="template-ref-empty">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <span>${window.I18n?.t('workflow.noRefImages') || 'Chưa có ảnh tham chiếu'}</span>
        </div>`;
      return;
    }

    container.innerHTML = urls.map((url, index) => `
      <div class="template-ref-thumb" data-ref-url="${this.escapeAttr(url)}" data-index="${index}">
        <img src="${this.escapeAttr(url)}" alt="${this.escapeAttr(window.I18n?.t('workflow.refImageAlt', { index: index + 1 }) || `Ảnh tham chiếu ${index + 1}`)}" loading="lazy" />
        <button class="template-ref-thumb-remove" type="button" title="${window.I18n?.t('workflow.removeThisImage') || 'Xóa ảnh này'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `).join('');
  }

  /**
   * EWT-9.3 & EWT-9.4: Bind events cho ref images trong template mode
   * @param {string} btnId - ID của nút thêm ảnh
   * @param {string} inputId - ID của hidden input chứa URLs
   * @param {string} previewId - ID của container preview
   * @param {number} maxImages - Số lượng ảnh tối đa
   */
  _bindTemplateRefImagesEvents(btnId, inputId, previewId, maxImages = 10) {
    const addBtn = this.overlay?.querySelector(`#${btnId}`);
    const hiddenInput = this.overlay?.querySelector(`#${inputId}`);
    const previewContainer = this.overlay?.querySelector(`#${previewId}`);

    if (!addBtn || !hiddenInput) return;

    // Parse URLs từ hidden input
    const getUrls = () => {
      try {
        return JSON.parse(hiddenInput.value || '[]');
      } catch (e) {
        return [];
      }
    };

    // Save URLs vào hidden input
    const saveUrls = (urls) => {
      hiddenInput.value = JSON.stringify(urls);
      // Đánh dấu nếu user đã xóa hết ảnh (để _applyNodeFormData biết)
      if (urls.length === 0) {
        hiddenInput.dataset.cleared = 'true';
      } else {
        delete hiddenInput.dataset.cleared;
      }
      this._renderTemplateRefImagesPreview(urls, `#${previewId}`);
    };

    // Click thêm ảnh → mở WorkflowMediaModal
    addBtn.addEventListener('click', () => {
      const currentUrls = getUrls();
      const remaining = maxImages - currentUrls.length;

      if (remaining <= 0) {
        window.customDialog?.alert(
          window.I18n?.t('workflow.maxRefImagesReached', { max: maxImages }) || `Reached limit of ${maxImages} reference images.`,
          { title: window.I18n?.t('workflow.limitReached') || 'Limit reached', type: 'warning' }
        );
        return;
      }

      // EWT-9.3: Mở WorkflowMediaModal
      if (typeof WorkflowMediaModal !== 'undefined') {
        const currentUrls = getUrls();
        WorkflowMediaModal.show({
          type: 'ref_image',
          multiple: true,
          preselected: currentUrls,
          uploadEndpoint: this.isCreatorTemplate ? 'creator-templates/media' : undefined,
          listEndpoint: this.isCreatorTemplate ? 'creator-templates/media/list' : undefined,
          onSelect: (urls) => {
            // urls đã bao gồm preselected, không cần merge với currentUrls
            const selectedUrls = Array.isArray(urls) ? urls : [urls];
            // Giới hạn số lượng
            saveUrls(selectedUrls.slice(0, maxImages));
            this._hasUnsavedChanges = true;
          }
        });
      } else {
        console.error('[WorkflowEditor] WorkflowMediaModal không tồn tại');
      }
    });

    // EWT-9.6: Click xóa ảnh (event delegation)
    if (previewContainer && !previewContainer._templateRefDelegated) {
      previewContainer._templateRefDelegated = true;
      previewContainer.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.template-ref-thumb-remove');
        if (!removeBtn) return;

        e.stopPropagation();
        e.preventDefault();

        const thumb = removeBtn.closest('.template-ref-thumb');
        const urlToRemove = thumb?.dataset.refUrl;

        if (urlToRemove) {
          const currentUrls = getUrls();
          const filteredUrls = currentUrls.filter(u => u !== urlToRemove);
          saveUrls(filteredUrls);
          this._hasUnsavedChanges = true;
        }
      });
    }

    // Render preview ban đầu
    const initialUrls = getUrls();
    console.log('[WorkflowEditor] _bindTemplateRefImagesEvents - initialUrls:', initialUrls, 'previewId:', previewId);
    this._renderTemplateRefImagesPreview(initialUrls, `#${previewId}`);
  }

  /**
   * EWT-12.1: Render field result image cho template mode
   * Cho phép admin upload ảnh kết quả mẫu cho node
   * @param {Object} data - Node data
   * @param {string} previewId - ID của container preview
   * @param {string} inputId - ID của hidden input chứa URL
   * @param {string} btnId - ID của nút chọn ảnh
   */
  _renderResultImageFieldForTemplate(data, previewId, inputId, btnId) {
    const resultImgUrl = data.result_img_url || '';

    return `
      <div class="form-group template-result-image-group" id="${previewId}Group">
        <label>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          ${window.I18n?.t('workflow.resultPreviewImage') || 'Sample result image'}
          <span class="template-mode-badge optional-badge" title="${window.I18n?.t('workflow.resultPreviewHint') || 'Sample result image for user preview'}">
            ${window.I18n?.t('common.optional') || 'Tùy chọn'}
          </span>
        </label>
        <div class="template-result-image-preview" id="${previewId}">
          <!-- Preview image được render bởi JS -->
        </div>
        <button class="node-ref-btn template-result-select-btn" id="${btnId}" type="button">
          <svg class="node-ref-btn__icon ref-btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8h.01"></path><path d="M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5"></path><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l3.5 3.5"></path><path d="M14 14l1 -1c.679 -.653 1.473 -.829 2.214 -.526"></path><path d="M19 22v-6"></path><path d="M22 19l-3 -3l-3 3"></path></svg>
          <span class="node-ref-btn__text">${window.I18n?.t('workflow.selectResultImage') || 'Chọn ảnh kết quả'}</span>
        </button>
        <input type="hidden" id="${inputId}" value="${this.escapeAttr(resultImgUrl)}" data-template-mode="true" />
      </div>`;
  }

  /**
   * EWT-12.2: Render preview ảnh kết quả mẫu cho template mode
   * @param {string} url - URL ảnh kết quả
   * @param {string} containerSelector - Selector của container preview
   * @param {string} ratio - Ratio của node (16:9, 4:3, 1:1, 3:4, 9:16, story, portrait, square, landscape, widescreen)
   */
  _renderTemplateResultImagePreview(url, containerSelector, ratio = '16:9') {
    const container = this.overlay?.querySelector(containerSelector);
    if (!container) return;

    // Map ratio to CSS class
    const ratioClass = this._getRatioClass(ratio);

    if (!url) {
      container.innerHTML = `
        <div class="template-result-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span>${window.I18n?.t('workflow.noResultImage') || 'Chưa có ảnh kết quả mẫu'}</span>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="template-result-thumb ${ratioClass}" data-result-url="${this.escapeAttr(url)}" data-ratio="${this.escapeAttr(ratio)}">
        <img src="${this.escapeAttr(url)}" alt="${window.I18n?.t('workflow.resultPreviewImage') || 'Sample result image'}" loading="lazy" />
        <button class="template-result-thumb-remove" type="button" title="${window.I18n?.t('workflow.removeResultImage') || 'Xóa ảnh kết quả'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>`;
  }

  /**
   * Get CSS class for ratio
   */
  _getRatioClass(ratio) {
    const ratioMap = {
      '16:9': 'ratio-16-9',
      '4:3': 'ratio-4-3',
      '1:1': 'ratio-1-1',
      '3:4': 'ratio-3-4',
      '9:16': 'ratio-9-16',
      'widescreen': 'ratio-16-9',
      'landscape': 'ratio-4-3',
      'square': 'ratio-1-1',
      'portrait': 'ratio-3-4',
      'story': 'ratio-9-16',
      'Ngang': 'ratio-16-9',
      'Dọc': 'ratio-9-16'
    };
    return ratioMap[ratio] || 'ratio-16-9';
  }

  /**
   * EWT-12.3: Bind events cho result image trong template mode
   * @param {string} btnId - ID của nút chọn ảnh
   * @param {string} inputId - ID của hidden input chứa URL
   * @param {string} previewId - ID của container preview
   * @param {string} ratioSelector - Selector của ratio input (optional)
   */
  _bindTemplateResultImageEvents(btnId, inputId, previewId, ratioSelector = null) {
    const selectBtn = this.overlay?.querySelector(`#${btnId}`);
    const hiddenInput = this.overlay?.querySelector(`#${inputId}`);
    const previewContainer = this.overlay?.querySelector(`#${previewId}`);

    if (!selectBtn || !hiddenInput) return;

    // Helper to get current ratio
    const getCurrentRatio = () => {
      if (ratioSelector) {
        const ratioEl = this.overlay?.querySelector(ratioSelector);
        // Handle both select and active pill
        if (ratioEl?.tagName === 'SELECT') {
          return ratioEl.value || '16:9';
        } else if (ratioEl) {
          const activePill = ratioEl.querySelector('.ratio-pill.active');
          return activePill?.dataset?.ratio || '16:9';
        }
      }
      return '16:9';
    };

    // Click chọn ảnh → mở WorkflowMediaModal
    selectBtn.addEventListener('click', () => {
      if (typeof WorkflowMediaModal !== 'undefined') {
        const currentUrl = hiddenInput.value || '';
        WorkflowMediaModal.show({
          type: 'result_image',
          multiple: false,
          preselected: currentUrl ? [currentUrl] : [],
          uploadEndpoint: this.isCreatorTemplate ? 'creator-templates/media' : undefined,
          listEndpoint: this.isCreatorTemplate ? 'creator-templates/media/list' : undefined,
          onSelect: (url) => {
            const resultUrl = Array.isArray(url) ? url[0] : url;
            hiddenInput.value = resultUrl || '';
            this._renderTemplateResultImagePreview(resultUrl, `#${previewId}`, getCurrentRatio());
            this._hasUnsavedChanges = true;
          }
        });
      } else {
        console.error('[WorkflowEditor] WorkflowMediaModal không tồn tại');
      }
    });

    // Click xóa ảnh (event delegation)
    if (previewContainer && !previewContainer._templateResultDelegated) {
      previewContainer._templateResultDelegated = true;
      previewContainer.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.template-result-thumb-remove');
        if (!removeBtn) return;

        e.stopPropagation();
        e.preventDefault();

        hiddenInput.value = '';
        hiddenInput.dataset.cleared = 'true';
        this._renderTemplateResultImagePreview('', `#${previewId}`, getCurrentRatio());
        this._hasUnsavedChanges = true;
      });
    }

    // Listen for ratio changes to update preview
    if (ratioSelector) {
      const ratioEl = this.overlay?.querySelector(ratioSelector);
      if (ratioEl?.tagName === 'SELECT') {
        ratioEl.addEventListener('change', () => {
          const url = hiddenInput.value;
          if (url) {
            this._renderTemplateResultImagePreview(url, `#${previewId}`, getCurrentRatio());
          }
        });
      } else if (ratioEl) {
        // For ratio pills container, use event delegation
        ratioEl.addEventListener('click', (e) => {
          const pill = e.target.closest('.ratio-pill');
          if (pill) {
            setTimeout(() => {
              const url = hiddenInput.value;
              if (url) {
                this._renderTemplateResultImagePreview(url, `#${previewId}`, getCurrentRatio());
              }
            }, 50);
          }
        });
      }
    }

    // Render preview ban đầu
    this._renderTemplateResultImagePreview(hiddenInput.value, `#${previewId}`, getCurrentRatio());
  }

  /**
   * Render form HTML theo node type
   */

  /**
   * Map ratio string (đa định dạng cross-provider) → CSS class cho aspect-ratio.
   * Hỗ trợ:
   *   - Flow VN: 'Dọc', 'Ngang', 'Vuông'
   *   - Numeric: '9:16', '3:4', '1:1', '4:3', '16:9', '2:3', '3:2'
   *   - ChatGPT/Grok keys: 'story', 'portrait', 'square', 'landscape', 'widescreen'
   * Fallback: 'ratio-1-1' (square — an toàn nếu ratio undefined).
   */
  _resolveRatioClass(ratio) {
    const r = String(ratio || '').trim().toLowerCase();
    if (r === '9:16' || r === 'dọc' || r === 'doc' || r === 'story') return 'ratio-9-16';
    if (r === '3:4' || r === 'portrait') return 'ratio-3-4';
    if (r === '2:3') return 'ratio-2-3';
    if (r === '1:1' || r === 'vuông' || r === 'vuong' || r === 'square') return 'ratio-1-1';
    if (r === '4:3' || r === 'landscape') return 'ratio-4-3';
    if (r === '3:2') return 'ratio-3-2';
    if (r === '16:9' || r === 'ngang' || r === 'widescreen') return 'ratio-16-9';
    return 'ratio-1-1';
  }

  /**
   * Render tab "Hướng dẫn" cho node (2026-05-30) — guide trực quan per-node-type.
   * Cover: generate / chatgpt / grok / prompt / text_extract.
   * Đặc biệt nhấn mạnh: mention mode (@slug) + Text Extract prompt template.
   */
  _renderNodeHelpTab(nodeType) {
    // SVG icon helpers — KHÔNG dùng emoji
    const icoPin = '<svg class="help-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>';
    const icoPalette = '<svg class="help-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z"/></svg>';
    const icoChat = '<svg class="help-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    const icoSpark = '<svg class="help-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';
    const icoPencil = '<svg class="help-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
    const icoFilm = '<svg class="help-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>';
    const icoScissors = '<svg class="help-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>';
    const icoList = '<svg class="help-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
    const icoCog = '<svg class="help-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    const icoLamp = '<svg class="help-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>';
    const icoLink = '<svg class="help-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    const icoWarn = '<svg class="help-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning,#f59e0b)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

    // Common section: @mention guide (apply cho generate/chatgpt/grok/prompt)
    const mentionGuide = `
      <div class="help-section">
        <h4>${icoPin}<span>@mention (tham chiếu node khác)</span></h4>
        <p>Dùng <code>@slug_node</code> trong prompt để chèn output của node khác. Mention CHỈ hoạt động khi node đó đã được nối dây edge (gốc → node hiện tại).</p>
        <p><strong>Prompt mode — 3 lựa chọn:</strong></p>
        <ul>
          <li><strong><code>auto</code></strong> (mặc định): Tự detect khi save — nếu prompt CÓ <code>@xxx</code> → behave như <code>mention</code>, nếu không có → behave như <code>all</code>.</li>
          <li><strong><code>all</code></strong>: GIỮ NGUYÊN prompt, KHÔNG substitute <code>@slug</code> (LLM thấy literal text "@chu_de"). Vẫn concat text từ upstream port "text" nếu có nối dây.</li>
          <li><strong><code>mention</code></strong>: SUBSTITUTE <code>@text_slug</code> / <code>@prompt_slug</code> bằng nội dung node tương ứng trước khi gửi LLM. Đồng thời strip <code>@image_*</code> / <code>@gen_*</code> literal (ảnh xử lý qua ref_mode).</li>
        </ul>
        <p><strong>Ref mode — 3 lựa chọn (ảnh tham chiếu):</strong></p>
        <ul>
          <li><strong><code>auto</code></strong>: Tự detect khi save (đồng bộ với prompt_mode auto detect).</li>
          <li><strong><code>all</code></strong>: Dùng TẤT CẢ ref images từ upstream + node hiện tại.</li>
          <li><strong><code>mention</code></strong>: CHỈ dùng ref images của nodes được <code>@mention</code> trong prompt.</li>
        </ul>
        <p><strong>Ví dụ — <code>auto</code> + có mention:</strong></p>
        <pre>Text node "chu_de" = "ChatGPT"
Prompt: "Hãy phân tích @chu_de và đề xuất 3 use case"
→ Submit LLM: "Hãy phân tích ChatGPT và đề xuất 3 use case"</pre>
        <p>${icoWarn}<em>Chỉ work nếu Text node có <strong>nối edge</strong> tới node hiện tại. Mention KHÔNG tự tìm node trong workflow nếu chưa nối dây.</em></p>
      </div>
    `;

    let body = '';
    if (nodeType === 'generate') {
      body = `
        <div class="help-section">
          <h4>${icoPalette}<span>Flow - Generate (ảnh/video)</span></h4>
          <p>Submit prompt đến Google Flow, gen ảnh hoặc video qua tab labs.google/fx/tools/flow.</p>
          <ol>
            <li><strong>Media Type</strong>: Image / Video.</li>
            <li><strong>Model</strong>: Image (Nano Banana Pro/2) hoặc Video (Veo 3.1 Fast/Lite/Quality, Omni Flash). Mỗi model có config riêng (duration_tier, max_ref_images, supports_voice).</li>
            <li><strong>Voice</strong> (chỉ video models có audio: Veo 3.1, Omni Flash): chọn giọng đọc cho video — picker ngay bên phải video model select. Click → modal full-screen + search + custom voice.</li>
            <li><strong>Ratio</strong>: Image 5 ratios (16:9, 4:3, 1:1, 3:4, 9:16). Video 2 ratios (16:9, 9:16 — Google constraint).</li>
            <li><strong>Duration</strong> (video): 4s/6s/8s (Veo) hoặc 4s/6s/8s/10s (Omni Flash). Một số combo bị ép cố định (vd Veo Lite + Ingredients + ref → bắt buộc 8s).</li>
            <li><strong>Prompt</strong>: nhập text mô tả. Có thể dùng <code>@mention</code> để chèn output node khác.</li>
            <li><strong>Video Input Type</strong> (video): <code>Frames</code> (cần frame_1 + frame_2 ảnh đầu/cuối nối qua port) hoặc <code>Ingredients</code> (dùng ref_images bag).</li>
            <li><strong>Ref images</strong>: cap theo model — Nano Banana 7-10, Veo 3-5, Omni 7. Vượt cap → strip + báo warning.</li>
            <li><strong>Quantity</strong>: số ảnh gen mỗi lần 1-4 (Image only). Video luôn = 1.</li>
            <li><strong>Auto-download</strong>: tự tải kết quả về máy (yêu cầu feature gate <code>auto_download</code>).</li>
          </ol>
          <p>${icoWarn}<em>Veo 3.1 Quality + Ingredients</em>: model KHÔNG support ref images → ref bị strip automatic + banner warn trong picker.</p>
        </div>
        ${mentionGuide}
        <div class="help-section">
          <h4>${icoLink}<span>Kết hợp với Text Extract</span></h4>
          <p>Nếu prompt từ <strong>Prompt enhance node</strong> trả về nhiều prompts, dùng <strong>Text Extract</strong> trung gian để tách từng prompt → mỗi Generate node nhận 1 prompt riêng. Tiết kiệm AI call (1 enhance thay vì N).</p>
        </div>
      `;
    } else if (nodeType === 'chatgpt') {
      body = `
        <div class="help-section">
          <h4>${icoChat}<span>ChatGPT - Image Generate</span></h4>
          <p>Submit prompt đến ChatGPT (tab chatgpt.com), dùng image generation tool built-in (DALL-E / GPT image).</p>
          <ol>
            <li><strong>Model</strong>: <code>Instant</code> (GPT-5.5 nhanh, default) hoặc <code>Thinking</code> (suy luận sâu, chậm hơn, chất lượng cao).</li>
            <li><strong>Ratio</strong>: <code>story</code> (9:16) / <code>portrait</code> (3:4) / <code>square</code> (1:1) / <code>landscape</code> (4:3) / <code>widescreen</code> (16:9).</li>
            <li><strong>Prompt</strong>: tiếng Việt hoặc Anh đều OK. Có thể dùng <code>@mention</code> tham chiếu upstream nodes.</li>
            <li><strong>Ref images</strong>: nối từ Image node hoặc paste — ChatGPT analyze + gen variant (cap 10 ảnh per turn).</li>
            <li><strong>Use fallback prefix</strong>: <code>auto</code> (default — prepend "create image:" khi cần) / <code>always</code> / <code>never</code>.</li>
            <li><strong>Auto-close tab</strong>: cấu hình qua <code>/admin/default-settings</code> — tự đóng tab ChatGPT sau khi gen xong.</li>
          </ol>
          <p>${icoWarn}<em>Yêu cầu</em>: tab ChatGPT đang mở + đã login. Nếu chưa login → workflow pause + hiện modal "Cần login ChatGPT".</p>
          <p>${icoWarn}<em>Quota</em>: trừ cả <code>chatgpt_run_max</code> + <code>workflows_run_max</code>. Free plan giới hạn vài lần/ngày.</p>
        </div>
        ${mentionGuide}
      `;
    } else if (nodeType === 'grok') {
      body = `
        <div class="help-section">
          <h4>${icoSpark}<span>Grok - Image/Video Generate</span></h4>
          <p>Submit prompt đến Grok Imagine (grok.com/imagine), gen ảnh/video bằng Aurora model.</p>
          <ol>
            <li><strong>Mode</strong>: <code>Image</code> (Aurora image gen) hoặc <code>Video</code> (yêu cầu Grok Premium subscription).</li>
            <li><strong>Ratio</strong>: 5 ratios (story 9:16 / portrait 2:3 / square 1:1 / landscape 3:2 / widescreen 16:9).</li>
            <li><strong>Duration</strong> (video only): <code>6s</code> / <code>10s</code>.</li>
            <li><strong>Resolution</strong> (video only): <code>480p</code> / <code>720p</code>.</li>
            <li><strong>Image quality</strong> (image only): <code>Speed</code> (vài giây) / <code>Quality</code> (chậm hơn, kết quả tốt hơn).</li>
            <li><strong>Ref images</strong>: cap 5 ảnh — Grok dùng làm context (cả Image + Video).</li>
            <li><strong>Auto-close tab</strong>: tự đóng tab Grok sau khi gen (config /admin/default-settings).</li>
          </ol>
          <p>${icoWarn}<em>Yêu cầu video mode</em>: <strong>Grok Premium</strong> ($30/tháng). Nếu không có → modal "Premium required" hiển thị.</p>
          <p>${icoWarn}<em>Age verification</em>: Grok hỏi tuổi cho user mới — extension auto chọn 1990. Phải > 18 mới truy cập Imagine.</p>
          <p>${icoWarn}<em>Cloudflare challenge</em>: thỉnh thoảng Grok hiện Turnstile verification — user cần click thủ công, extension chờ xong tự tiếp tục.</p>
        </div>
        ${mentionGuide}
      `;
    } else if (nodeType === 'prompt') {
      // AI Agent rename + i18n (2026-05-30) — helper trả về HTML localized theo locale user.
      // Default fallback: VI. Locales en/ja/th có version translation riêng.
      body = this._getPromptHelpHtml({ icoPencil, icoSpark, icoWarn, icoFilm, mentionGuide });
    } else if (nodeType === 'text_extract') {
      body = `
        <div class="help-section">
          <h4>${icoScissors}<span>Text Extract Node</span></h4>
          <p>Tách 1 phần text từ upstream output theo marker / JSON key / regex.</p>
          <p><strong>KHÔNG call AI</strong> — pure regex/JSON parse, instant.</p>
        </div>

        <div class="help-section">
          <h4>${icoList}<span>3 chế độ</span></h4>
          <p><strong>1. Marker mode (recommend)</strong>: match <code>[name]: value</code>.</p>
          <pre>Upstream: "[image_prompt_1]: A red apple
[image_prompt_2]: A blue sky"

marker = image_prompt_1
→ Output: "A red apple"</pre>

          <p><strong>2. JSON mode</strong>: parse JSON + lookup key.</p>
          <pre>Upstream: {"img1": "red apple", "img2": "blue sky"}

marker = img1
→ Output: "red apple"</pre>

          <p><strong>3. Regex mode</strong>: custom pattern, group 1 = output.</p>
        </div>

        <div class="help-section">
          <h4>${icoCog}<span>Config quan trọng</span></h4>
          <ul>
            <li><strong>Strict mode</strong>: ON = exact match. OFF (default) = case-insensitive + tolerant whitespace/dash.</li>
            <li><strong>Multi-match</strong>: nếu marker xuất hiện 2+ lần — chọn First / Last / Concat / Error.</li>
            <li><strong>On fail</strong>:
              <ul>
                <li><code>skip_downstream</code> (default): nodes phía sau bị bỏ qua, workflow vẫn chạy tiếp.</li>
                <li><code>empty</code>: pass text rỗng — downstream tự fail nếu cần text.</li>
                <li><code>fail_workflow</code>: fail toàn workflow ngay.</li>
              </ul>
            </li>
          </ul>
        </div>

        <div class="help-section">
          <h4>${icoFilm}<span>Cách prompt Prompt node TRƯỚC để output đúng format</span></h4>
          <p><strong>Mẫu Prompt enhance khuyên dùng:</strong></p>
          <pre>Hãy research chủ đề @text_slug và tạo:
- 5 prompt tạo ảnh storyboard nội dung nối tiếp
- 5 prompt tạo video từ ảnh storyboard

QUAN TRỌNG — FORMAT CHÍNH XÁC:
[image_prompt_1]: &lt;nội dung ảnh 1&gt;
[image_prompt_2]: &lt;nội dung ảnh 2&gt;
[image_prompt_3]: &lt;nội dung ảnh 3&gt;
[image_prompt_4]: &lt;nội dung ảnh 4&gt;
[image_prompt_5]: &lt;nội dung ảnh 5&gt;
[video_prompt_1]: &lt;video từ ảnh 1&gt;
[video_prompt_2]: &lt;video từ ảnh 2&gt;
...
[video_prompt_5]: &lt;video từ ảnh 5&gt;

QUY TẮC:
- Mỗi prompt 1 đoạn, KHÔNG dùng markdown ** hoặc backtick.
- KHÔNG ghi gì ngoài 10 dòng trên.
- Ảnh storyboard có ghi rõ "Frame N" trên ảnh.</pre>
          <p>Sau đó tạo 10 node Text Extract: marker = <code>image_prompt_1</code>, <code>image_prompt_2</code>, ..., <code>video_prompt_5</code>.</p>
        </div>

        <div class="help-section">
          <h4>${icoLamp}<span>Tips</span></h4>
          <ul>
            <li>Để AI luôn output format đúng → instruct rõ "FORMAT CHÍNH XÁC" + "KHÔNG dùng markdown".</li>
            <li>Nếu Text Extract fail → mở tab <strong>Kết quả</strong> upstream để xem text raw → điều chỉnh prompt template.</li>
            <li>Test marker bằng regex tester online (vd regex101) trước khi save workflow lớn.</li>
          </ul>
        </div>
      `;
    }
    return `<div class="node-help-content" style="padding: 12px 14px; font-size: 13px; line-height: 1.5; color: var(--foreground);">
      <style>
        .node-help-content h4 { font-size: 13px; font-weight: 600; margin: 8px 0 6px 0; color: var(--foreground); display: flex; align-items: center; gap: 6px; }
        .node-help-content h4 .help-ico { flex-shrink: 0; color: var(--primary, #3d6ff5); }
        .node-help-content .help-section { margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--border, #1e3050); }
        .node-help-content .help-section:last-child { border-bottom: none; }
        .node-help-content p { margin: 4px 0; color: var(--muted-foreground, #999); }
        .node-help-content p .help-ico { vertical-align: -2px; margin-right: 4px; }
        .node-help-content ul, .node-help-content ol { margin: 4px 0 6px 18px; padding: 0; color: var(--muted-foreground, #999); }
        .node-help-content li { margin: 3px 0; }
        .node-help-content code { background: var(--surface, #1e1e1e); padding: 1px 5px; border-radius: 3px; font-size: 11px; color: var(--primary, #3d6ff5); font-family: monospace; }
        .node-help-content pre { background: var(--surface, #1e1e1e); padding: 8px; border-radius: 4px; font-size: 11px; line-height: 1.5; overflow-x: auto; color: var(--foreground); white-space: pre-wrap; word-wrap: break-word; margin: 6px 0; }
        .node-help-content strong { color: var(--foreground); }
        .node-help-content em { color: var(--muted-foreground, #999); }
      </style>
      ${body}
    </div>`;
  }

  /**
   * Render tab "Kết quả" cho node
   */
  _renderNodeResultTab(data) {
    const status = data.status || 'pending';
    const fileIds = (data.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    const errorMsg = data.error_message || '';

    const statusLabels = {
      pending: window.I18n?.t('workflow.statusPending') || 'Pending',
      running: window.I18n?.t('workflow.statusRunning') || 'Running',
      completed: window.I18n?.t('workflow.statusCompleted') || 'Completed',
      failed: window.I18n?.t('workflow.statusFailed') || 'Failed',
      skipped: window.I18n?.t('workflow.statusSkipped') || 'Skipped'
    };
    const statusColors = {
      pending: 'var(--muted-foreground)',
      running: 'var(--warning)',
      completed: 'var(--success)',
      failed: 'var(--destructive)',
      skipped: 'var(--muted-foreground)'
    };

    let html = `
      <div class="form-group">
        <label>${window.I18n?.t('workflow.status') || 'Trạng thái'}</label>
        <div style="display: flex; align-items: center; gap: 8px; padding: 6px 0;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColors[status] || statusColors.pending}; flex-shrink: 0;"></span>
          <span style="font-size: 13px; color: ${statusColors[status] || statusColors.pending}; font-weight: 500;">
            ${statusLabels[status] || status}
          </span>
        </div>
      </div>`;

    if (status === 'completed' && fileIds.length > 0) {
      const ratio = data.ratio || '';
      // Map đầy đủ 5 aspect ratio cross-provider (Flow VN / numeric / ChatGPT / Grok keys).
      // Helper static `_resolveRatioClass` trả CSS class 'ratio-9-16' / 'ratio-3-4' / 'ratio-1-1' / 'ratio-4-3' / 'ratio-16-9'.
      // Trước fix: chỉ 2 class (ratio-portrait/landscape) → Grok keys 'story/widescreen' miss → default 1:1 SAI.
      const ratioClass = this._resolveRatioClass(ratio);
      const galleryClass = fileIds.length === 1 ? 'single-result' : '';

      // Dual URL — badge "Original" cho tile có provider URL gốc (Grok/ChatGPT) → user biết
      // download sẽ lấy chất lượng 100% provider thay vì Flow re-encoded.
      const providerUrls = data.result_provider_urls || {};
      const providerCount = fileIds.filter(id => providerUrls[id]?.url).length;

      const renderThumb = (id) => {
        const provider = providerUrls[id]?.provider || '';
        const hasOrig = !!providerUrls[id]?.url;
        const badgeHtml = hasOrig
          ? `<span class="result-thumb-original-badge" data-provider="${provider}" title="${window.I18n?.t('workflow.downloadOriginal') || 'Download original'} (${provider})">${provider.toUpperCase()}</span>`
          : '';
        return `<div class="node-result-thumb ${ratioClass}${hasOrig ? ' has-provider-url' : ''}" data-file-id="${this.escapeAttr(id)}" data-provider="${provider}"><div class="seosonaflow-loading-spinner" style="width:16px;height:16px;"></div>${badgeHtml}</div>`;
      };

      // 2 button download riêng — user chọn explicit source thay vì auto-route:
      //   - Original: chỉ download tiles có provider URL gốc (Grok/ChatGPT chất lượng 100%)
      //   - Flow: download qua Flow tile (re-encoded, có chọn 1k/2k cho image, 720p/1080p cho video)
      // Original button chỉ hiện khi có >=1 tile có provider URL.
      const downloadIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      const flowDlLabel = window.I18n?.t('workflow.downloadViaFlow', { count: fileIds.length }) || `Download ${fileIds.length} files via Flow`;
      const origDlLabel = window.I18n?.t('workflow.downloadOriginalCount', { count: providerCount }) || `Download original (${providerCount})`;
      const origDlTitle = window.I18n?.t('workflow.downloadOriginalTitle') || '100% provider quality, no re-encode';
      const flowDlTitle = window.I18n?.t('workflow.downloadViaFlowTitle') || 'Download via Google Flow (choose 1k/2k/720p/1080p)';
      const origBtnHtml = providerCount > 0
        ? `<button class="node-result-download-btn node-result-download-btn--original" id="resultDownloadOriginalBtn" title="${origDlTitle}">
            ${downloadIcon}<span>${origDlLabel}</span>
          </button>`
        : '';

      html += `
        <div class="form-group">
          <label>${window.I18n?.t('workflow.resultCount', { count: fileIds.length }) || `Results (${fileIds.length} files)`}</label>
          <div class="node-result-gallery ${galleryClass}" id="nodeResultGallery">
            ${fileIds.map(id => renderThumb(id)).join('')}
          </div>
          <div class="node-result-download-actions">
            ${origBtnHtml}
            <button class="node-result-download-btn" id="resultDownloadFlowBtn" title="${flowDlTitle}">
              ${downloadIcon}<span>${flowDlLabel}</span>
            </button>
          </div>
        </div>`;
    } else if (status === 'pending') {
      html += `
        <div class="form-group">
          <p style="font-size: 12px; color: var(--muted-foreground); font-style: italic;">${window.I18n?.t('workflow.nodeNotRun') || 'Node chưa được chạy.'}</p>
        </div>`;
    } else if (status === 'running') {
      html += `
        <div class="form-group">
          <div style="display: flex; align-items: center; gap: 8px; padding: 8px 0;">
            <div class="seosonaflow-loading-spinner" style="width:16px;height:16px;"></div>
            <span style="font-size: 12px; color: var(--warning);">${window.I18n?.t('workflow.processing') || 'Processing...'}</span>
          </div>
        </div>`;
    }

    if (status === 'failed' && errorMsg) {
      html += `
        <div class="form-group">
          <label>${window.I18n?.t('workflow.errorLog') || 'Log lỗi'}</label>
          <div style="font-size: 12px; color: var(--destructive); background: hsla(0, 84%, 60%, 0.08); padding: 8px 10px; border-radius: 6px; border: 1px solid hsla(0, 84%, 60%, 0.2); white-space: pre-wrap; max-height: 120px; overflow-y: auto;">
            ${this.escapeHtml(errorMsg)}
          </div>
        </div>`;
    }

    // 2026-05-31 fix: hiển thị result_text cho cả prompt + text_extract nodes (đều output text).
    // Trước fix: chỉ check 'prompt' → text_extract run xong, result_text persist OK nhưng KHÔNG
    // hiển thị trên Result tab → user click Run không thấy kết quả gì.
    const TEXT_RESULT_NODE_TYPES = ['prompt', 'text_extract'];
    // 2026-05-31 defensive: normalize whitespace tại display (cleanup leading + trailing per line,
    // collapse 3+ newlines → 2). Mirror logic WorkflowExecutor._normalizeExtractedText — old
    // result_text stored trước normalize fix sẽ hiển thị clean. CSS .prompt-result-text có
    // white-space:pre-wrap nên leading whitespace/blank lines SẼ show nếu không clean.
    const _normalizeDisplay = (txt) => (typeof txt === 'string' ? txt : '')
      .replace(/\r\n/g, '\n')
      .replace(/ /g, ' ')           // NBSP → space
      .replace(/[​-‍﻿]/g, '')         // zero-width chars
      .split('\n').map(l => l.trim()).join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const displayResultText = _normalizeDisplay(data.result_text);
    if (displayResultText && TEXT_RESULT_NODE_TYPES.includes(data.node_type)) {
      const sourceLabel = data.result_source === 'plain_fallback'
        ? (window.I18n?.t('workflow.promptSourceFallback') || 'Plain text (fallback)')
        : data.result_source === 'plain'
          ? (window.I18n?.t('workflow.promptSourcePlain') || 'Plain text')
          : data.result_source === 'chatgpt'
            ? (window.ProviderMeta?.getName?.('chatgpt') || 'ChatGPT')
            : data.result_source === 'gemini'
              ? (window.ProviderMeta?.getName?.('gemini') || 'Gemini')
              : data.result_source === 'extract'
                ? (window.I18n?.t('workflow.extractResultSource') || 'Text Extract')
                : (data.result_source || 'Unknown');
      const sourceClass = data.result_source === 'plain_fallback' ? 'warning' : 'success';
      const labelText = data.node_type === 'text_extract'
        ? (window.I18n?.t('workflow.extractResult') || 'Text trích xuất')
        : (window.I18n?.t('workflow.promptResult') || 'Prompt kết quả');
      html += `
        <div class="form-group">
          <label class="prompt-result-label">
            ${labelText}
            <span class="prompt-result-source-badge ${sourceClass}">${sourceLabel}</span>
          </label>
          <div id="promptResultText" class="prompt-result-text">${this.escapeHtml(displayResultText)}</div>
          <button class="copy-prompt-result-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span class="copy-btn-text">${window.I18n?.t('common.copy') || 'Copy'}</span>
          </button>
        </div>`;
    }

    // Load thumbnails + bind 2 download buttons (Original vs Flow) after render
    if (status === 'completed' && fileIds.length > 0) {
      requestAnimationFrame(() => {
        this._loadResultGalleryThumbnails(fileIds, data.result_file_names);
        const origBtn = this.overlay?.querySelector('#resultDownloadOriginalBtn');
        origBtn?.addEventListener('click', () => this._downloadNodeFiles({ source: 'original' }));
        const flowBtn = this.overlay?.querySelector('#resultDownloadFlowBtn');
        flowBtn?.addEventListener('click', () => this._downloadNodeFiles({ source: 'flow' }));
        // Per-item click-to-download (like TaskModal)
        this._bindResultItemDownloads(fileIds, data);
      });
    }

    // Bind copy button cho prompt + text_extract result text (parity với render condition trên).
    if (displayResultText && TEXT_RESULT_NODE_TYPES.includes(data.node_type)) {
      requestAnimationFrame(() => {
        const copyBtn = this.overlay?.querySelector('.copy-prompt-result-btn');
        copyBtn?.addEventListener('click', async () => {
          try {
            // Copy normalized text (consistent với display) — old data trước normalize fix
            // sẽ copy bản clean thay vì raw whitespace.
            await navigator.clipboard.writeText(displayResultText);
            // Visual feedback - change button text và style
            const btnText = copyBtn.querySelector('.copy-btn-text');
            const originalText = btnText?.textContent;
            if (btnText) {
              btnText.textContent = window.I18n?.t('common.copied') || 'Copied!';
              copyBtn.classList.add('copied');
            }
            // Reset sau 1.5s
            setTimeout(() => {
              if (btnText) {
                btnText.textContent = originalText;
                copyBtn.classList.remove('copied');
              }
            }, 1500);
          } catch (e) {
            console.error('[WorkflowEditor] Copy prompt result failed:', e);
          }
        });
      });
    }

    return html;
  }

  _loadResultGalleryThumbnails(fileIds, resultFileNames = null) {
    const gallery = this.overlay?.querySelector('#nodeResultGallery');
    if (!gallery) return;

    const thumbEls = gallery.querySelectorAll('.node-result-thumb');

    // Cross-project warning icon SVG
    const crossProjectIconSvg = `
      <svg class="cross-project-icon" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--destructive,#dc2626);opacity:0.7;z-index:1;" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>`;
    const mismatchLabel = '<div style="position:absolute;bottom:0;left:0;right:0;background:var(--destructive,#dc2626);color:#fff;font-size:6px;text-align:center;line-height:1.4;border-radius:0 0 6px 6px;z-index:5;">Sai project</div>';

    for (let i = 0; i < fileIds.length && i < thumbEls.length; i++) {
      const tileId = fileIds[i];
      const thumbEl = thumbEls[i];
      let mediaSrc = '';
      let isVideo = false;
      let isCrossProject = false;
      const expectedFileName = resultFileNames?.[tileId] || null;

      // Try DOM
      const tile = document.querySelector(`[data-tile-id="${tileId}"]`);
      if (tile) {
        const domFileName = this._extractFileNameFromTile(tile);

        // Cross-project check: compare DOM file_name with expected
        if (expectedFileName && domFileName && domFileName !== expectedFileName) {
          console.warn(`[WorkflowEditor] Cross-project result collision: tile_id=${tileId}, expected=${expectedFileName}, actual=${domFileName}`);
          isCrossProject = true;
        }

        if (!isCrossProject) {
          // Ưu tiên <video> trước (video tiles có cả <img> ref lẫn <video> result)
          const videoEl = tile.querySelector('video');
          if (videoEl?.src) {
            mediaSrc = videoEl.src;
            isVideo = true;
          } else {
            const imgEl = tile.querySelector('img');
            if (imgEl?.src) {
              mediaSrc = imgEl.src;
              isVideo = false;
            }
          }
        }
      }

      // Fallback to cache (check cross-project)
      // Bug 51 fix: Track video_url separately for video playback
      let videoUrl = null;
      if (!mediaSrc && this._tileCache.has(tileId)) {
        const cached = this._tileCache.get(tileId);

        // Cross-project check: compare cached file_name with expected
        if (expectedFileName && cached?.file_name && cached.file_name !== expectedFileName) {
          console.warn(`[WorkflowEditor] Cross-project result collision (cached): tile_id=${tileId}, expected=${expectedFileName}, cached=${cached.file_name}`);
          isCrossProject = true;
        }

        if (!isCrossProject) {
          mediaSrc = cached.thumbnail;
          isVideo = cached.type === 'video';
          videoUrl = cached.video_url || null;
        }
      }

      // Render based on cross-project status
      if (isCrossProject) {
        thumbEl.classList.add('node-result-thumb-cross-project');
        thumbEl.style.borderColor = 'var(--destructive,#dc2626)';
        thumbEl.innerHTML = crossProjectIconSvg + mismatchLabel;
      } else if (mediaSrc) {
        // Bug 51 fix: Use video_url for video playback, fallback to mediaSrc (thumbnail)
        thumbEl.innerHTML = isVideo
          ? `<video src="${this._safeMediaSrc(videoUrl || mediaSrc)}" muted loop autoplay playsinline style="width:100%;height:100%;object-fit:cover;border-radius:6px;"></video>`
          : `<img src="${this._safeMediaSrc(mediaSrc)}" alt="result" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">`;
      } else {
        thumbEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
      }
    }

    // If no DOM tiles found, try MessageBridge with targeted lookup
    const hasAny = Array.from(thumbEls).some(el => el.querySelector('img, video'));
    if (!hasAny && typeof MessageBridge !== 'undefined') {
      const missingIds = fileIds.filter(id => !this._tileCache.has(id) && !id.startsWith('upload_'));
      if (missingIds.length > 0) {
        MessageBridge.getThumbnailsByIds(missingIds).then(result => {
          const results = result?.results || {};
          for (const [fid, info] of Object.entries(results)) {
            if (info?.thumbnail) {
              // Bug 51 fix: Include video_url for video playback
              this._tileCacheSet(fid, { thumbnail: info.thumbnail, type: info.type || 'image', file_name: info.file_name, ...(info.video_url && { video_url: info.video_url }) });
            }
          }
          // Re-render thumbnails with cross-project check
          for (let i = 0; i < fileIds.length && i < thumbEls.length; i++) {
            const tileId = fileIds[i];
            const cached = this._tileCache.get(tileId);
            const expectedFileName = resultFileNames?.[tileId] || null;

            if (cached) {
              // Cross-project check for MessageBridge results
              const isCrossProject = expectedFileName && cached.file_name && cached.file_name !== expectedFileName;

              if (isCrossProject) {
                console.warn(`[WorkflowEditor] Cross-project result collision (MessageBridge): tile_id=${tileId}, expected=${expectedFileName}, actual=${cached.file_name}`);
                thumbEls[i].classList.add('node-result-thumb-cross-project');
                thumbEls[i].style.borderColor = 'var(--destructive,#dc2626)';
                thumbEls[i].innerHTML = crossProjectIconSvg + mismatchLabel;
              } else {
                const isVid = cached.type === 'video';
                // Bug 51 fix: Use video_url for video playback
                const vidSrc = cached.video_url || cached.thumbnail;
                thumbEls[i].innerHTML = isVid
                  ? `<video src="${this._safeMediaSrc(vidSrc)}" muted loop autoplay playsinline style="width:100%;height:100%;object-fit:cover;border-radius:6px;"></video>`
                  : `<img src="${this._safeMediaSrc(cached.thumbnail)}" alt="result" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">`;
              }
            }
          }
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_applyNodeVoicePickerVisibility', _e); });
      }
    }
  }

  /**
   * Bind per-item click-to-download on result thumbnails (like TaskModal)
   */
  _bindResultItemDownloads(fileIds, data) {
    const gallery = this.overlay?.querySelector('#nodeResultGallery');
    if (!gallery) return;
    const fileNames = data.result_file_names || {};
    const isVideoNode = data.media_type === 'Video' || data.gen_type === 'Video';
    const label = data.prompt || data.node_name || 'flow';

    const thumbEls = gallery.querySelectorAll('.node-result-thumb');
    for (let i = 0; i < fileIds.length && i < thumbEls.length; i++) {
      const fileId = fileIds[i];
      const thumbEl = thumbEls[i];
      thumbEl.style.cursor = 'pointer';
      thumbEl.title = window.I18n?.t('workflow.clickToDownload') || 'Click để tải';
      thumbEl.addEventListener('click', () => {
        const fileName = fileNames[fileId] || null;
        const isVideo = isVideoNode || this._isTileVideo(fileId);
        if (typeof DownloadHelper !== 'undefined') {
          DownloadHelper.showModal({
            tileId: fileId,
            fileName: fileName,
            promptText: label,
            index: i + 1,
            mediaType: isVideo ? 'video' : 'image'
          });
        } else if (typeof MessageBridge !== 'undefined') {
          const resolution = isVideo
            ? (data.video_download_resolution || '720p')
            : (data.download_resolution || '1k');
          MessageBridge.downloadTileMedia(fileId, label, this.workflow?.wf_name || null, fileName, resolution);
        }
      });
    }
  }

  _refreshResultTabIfSelected(nodeId, status, fileIds, errorMsg) {
    if (!this.selectedNodeId || !nodeId) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (String(drawflowId) !== String(this.selectedNodeId)) return;
    const resultBody = this.overlay?.querySelector('#nodeResultBody');
    if (!resultBody) return;

    // Get ratio from drawflow node data for proper preview sizing
    const nodeData = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    const ratio = nodeData?.data?.ratio || '';

    // Update in-memory workflow node data
    if (this.workflow?.nodes) {
      const wfNode = this.workflow.nodes.find(n => n.node_id === nodeId);
      if (wfNode) {
        wfNode.status = status;
        if (fileIds) wfNode.result_file_ids = fileIds.join(',');
        if (errorMsg) wfNode.error_message = errorMsg;
      }
    }

    const dfData = nodeData?.data || {};
    const data = {
      ...dfData,
      status,
      ratio,
      result_file_ids: fileIds ? fileIds.join(',') : '',
      error_message: errorMsg || ''
    };
    resultBody.innerHTML = this._renderNodeResultTab(data);
  }

  /**
   * Mở upgrade modal cross-context. Sidebar context có window.openUpgradeModal sẵn;
   * popup window context (workflow-editor.html) thì gửi message đến background.js để
   * relay tới sidePanel (handler 'openUpgradeModal' → broadcast 'showUpgradeModal').
   */
  /**
   * Safe wrapper cho featureGate.checkQuotaAsync — popup window context có thể fail
   * khi token expired (refresh() throws). Fallback sang sync checkQuota (cached) để không
   * bị silent click play.
   */
  async _safeCheckQuotaAsync(featureKey) {
    if (!window.featureGate) return { allowed: true, limit: 'unknown', used: 0, remaining: 'unknown' };
    try {
      return await window.featureGate.checkQuotaAsync(featureKey);
    } catch (err) {
      console.warn('[WorkflowEditor] checkQuotaAsync(' + featureKey + ') failed — fallback sync cached:', err?.message);
      try {
        return window.featureGate.checkQuota(featureKey);
      } catch (e2) {
        // Last resort: cho phép run, server-side ExecutionGate sẽ enforce thật.
        return { allowed: true, limit: 'unknown', used: 0, remaining: 'unknown' };
      }
    }
  }

  _openUpgradeModal() {
    /* upgrade removed — local-first */
  }

  /**
   * Flow Voice Selector — show/hide voice picker theo media_type + model.config.supports_voice.
   * Reset value khi switch sang model không support voice.
   */
  _applyNodeVoicePickerVisibility() {
    const group = this.overlay?.querySelector('#nodeVoicePickerGroup');
    if (!group) return;

    const mediaType = this.overlay?.querySelector('#nodeMediaType')?.value || 'Image';
    if (mediaType !== 'Video') {
      group.classList.add('hidden');
      return;
    }

    const modelValue = this.overlay?.querySelector('#nodeVideoModel')?.value || '';
    const modelObj = window.ModelRegistry?.findModel?.('flow', modelValue);
    const supportsVoice = !!(modelObj?.config?.supports_voice === true);

    if (supportsVoice) {
      group.classList.remove('hidden');
    } else {
      group.classList.add('hidden');
      // Reset voice fields khi model không support
      const slugInput = this.overlay?.querySelector('#nodeVoiceSlug');
      const searchInput = this.overlay?.querySelector('#nodeVoiceSearchValue');
      if (slugInput?.value || searchInput?.value) {
        if (slugInput) slugInput.value = '';
        if (searchInput) searchInput.value = '';
        if (this._nodeVoicePicker) this._nodeVoicePicker._updateTrigger();
      }
    }
  }

  /**
   * Lazy init VoicePicker cho node form. Cleanup old picker khi switch node.
   * Uses VoiceSelectModal (full-screen overlay) thay vì inline popup.
   */
  _initNodeVoicePicker(data) {
    if (this._nodeVoicePicker) {
      try { this._nodeVoicePicker.destroy(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_initNodeVoicePicker', _); }
      this._nodeVoicePicker = null;
    }

    if (!window.VoicePicker) return;

    const triggerEl = this.overlay?.querySelector('#nodeVoiceTrigger');
    if (!triggerEl) return;

    this._nodeVoicePicker = new window.VoicePicker({
      triggerEl,
      thumbEl: this.overlay?.querySelector('#nodeVoiceTriggerThumb'),
      labelEl: this.overlay?.querySelector('#nodeVoiceLabel'),
      hiddenSelectEl: this.overlay?.querySelector('#nodeVoiceSlug'),
      providerSlug: 'flow',
      getSelected: () => this.overlay?.querySelector('#nodeVoiceSlug')?.value || '',
      onChange: (slug, voiceObj) => {
        const slugInput = this.overlay?.querySelector('#nodeVoiceSlug');
        const searchInput = this.overlay?.querySelector('#nodeVoiceSearchValue');
        if (slugInput) slugInput.value = slug || '';
        if (searchInput) searchInput.value = voiceObj?.search_value || '';
      },
    });
    this._nodeVoicePicker.init();

    this._applyNodeVoicePickerVisibility();
  }

  /** Flow Character — show/hide theo supports_character (cả image+video, KHÔNG gate media). */
  _applyNodeCharacterPickerVisibility() {
    const group = this.overlay?.querySelector('#nodeCharacterPickerGroup');
    if (!group) return;

    const mediaType = this.overlay?.querySelector('#nodeMediaType')?.value || 'Image';
    const modelValue = mediaType === 'Video'
      ? (this.overlay?.querySelector('#nodeVideoModel')?.value || '')
      : (this.overlay?.querySelector('#nodeModel')?.value || '');
    const modelObj = window.ModelRegistry?.findModel?.('flow', modelValue);
    const supportsChar = !!(modelObj?.config?.supports_character === true);

    if (supportsChar) {
      group.classList.remove('hidden');
    } else {
      group.classList.add('hidden');
      // Bug fix 2026-06-25: CHỈ clear khi model TÌM THẤY + config có + chắc chắn KHÔNG support.
      // Trước: modelObj null (config/models chưa load kịp lúc mở workflow — race) → supportsChar
      // false → xoá character vừa load → save lại = MẤT. Giờ giữ nguyên khi chưa chắc.
      // Save gate (10845) đã null character cho model không support → clear ở đây chỉ dọn UI.
      const definitelyUnsupported = !!modelObj && !!modelObj.config && modelObj.config.supports_character !== true;
      if (definitelyUnsupported) {
        const slugInput = this.overlay?.querySelector('#nodeCharacterSlug');
        const searchInput = this.overlay?.querySelector('#nodeCharacterSearchValue');
        if (slugInput?.value || searchInput?.value) {
          if (slugInput) slugInput.value = '';
          if (searchInput) searchInput.value = '';
          if (this._nodeCharacterPicker) this._nodeCharacterPicker._updateTrigger();
        }
      }
    }
  }

  /** Lazy init CharacterPicker cho node form. Cleanup old picker khi switch node. */
  _initNodeCharacterPicker(data) {
    if (this._nodeCharacterPicker) {
      try { this._nodeCharacterPicker.destroy(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_initNodeCharacterPicker', _); }
      this._nodeCharacterPicker = null;
    }
    if (!window.CharacterPicker) return;

    const triggerEl = this.overlay?.querySelector('#nodeCharacterTrigger');
    if (!triggerEl) return;

    this._nodeCharacterPicker = new window.CharacterPicker({
      triggerEl,
      thumbEl: this.overlay?.querySelector('#nodeCharacterTriggerThumb'),
      labelEl: this.overlay?.querySelector('#nodeCharacterLabel'),
      hiddenSelectEl: this.overlay?.querySelector('#nodeCharacterSlug'),
      getSelected: () => this.overlay?.querySelector('#nodeCharacterSlug')?.value || '',
      onChange: (slug, charObj) => {
        const slugInput = this.overlay?.querySelector('#nodeCharacterSlug');
        const searchInput = this.overlay?.querySelector('#nodeCharacterSearchValue');
        if (slugInput) slugInput.value = slug || '';
        if (searchInput) searchInput.value = charObj?.search_value || '';
      },
    });
    this._nodeCharacterPicker.init();

    this._applyNodeCharacterPickerVisibility();
  }

  /** Render badge count/limit (đặt ngay sau textarea prompt trong sidebar node setting). */
  _promptCharCountHtml(text) {
    const len = (text || '').length;
    const max = window.ValidationRules?.safeGetInt?.('prompt_max_length', 5000) ?? 5000;
    const fmt = (n) => String(n >>> 0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `<span class="df-form-char-count${len > max ? ' df-over-limit' : ''}" data-prompt-char-count>${fmt(len)}/${fmt(max)}</span>`;
  }

  /** Cập nhật live badge count khi user gõ trong textarea prompt. */
  _updatePromptCharCount(ta) {
    if (!ta) return;
    let counter = ta.nextElementSibling;
    if (!(counter && counter.classList?.contains('df-form-char-count'))) {
      counter = ta.parentElement?.querySelector('.df-form-char-count') || null;
    }
    if (!counter) return;
    const len = (ta.value || '').length;
    const max = window.ValidationRules?.safeGetInt?.('prompt_max_length', 5000) ?? 5000;
    const fmt = (n) => String(n >>> 0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    counter.textContent = `${fmt(len)}/${fmt(max)}`;
    counter.classList.toggle('df-over-limit', len > max);
  }

  /**
   * Bind form events theo node type
   */

  // Dirty check helpers
  _captureFormSnapshot() {
    if (!this.overlay) return null;
    const fields = ['nodeName', 'nodePrompt', 'nodeMediaType', 'nodeModel', 'nodeVideoModel',
      'nodeRatio', 'nodeQuantity', 'nodeVideoInputType', 'nodeRefFileIds',
      'frame1Source', 'frame1FileId', 'frame2Source', 'frame2FileId', 'nodeEnabled', 'nodeAutoDownload',
      'nodeNoteText', 'nodeNoteColor', 'nodeNoteFontSize', 'nodeDelaySeconds',
      'anglePresetId', 'angleRotation', 'angleTilt', 'angleZoom',
      'downloadFolder', 'downloadFileTemplate', 'downloadResolution', 'downloadVideoResolution', 'downloadCollectAll',
      'chatgptNodePrompt', 'chatgptImageRatio', 'chatgptImageRefFileIds', 'chatgptImageMode',
      'chatgptImageTimeout', 'chatgptImageAutoDownload',
      'grokNodePrompt', 'grokNodeMode', 'grokNodeRatio', 'grokNodeDuration', 'grokNodeResolution',
      'grokNodeImageQuality',
      'grokNodeRefFileIds', 'grokNodeAutoDownload', 'grokNodeTimeout',
      // AI Agent node (Phase CG-8 + rename 2026-05-30) — thiếu trước fix → dirty check không detect toggle
      // → _isFormDirty=false → click save không trigger confirm + có thể stuck.
      // Audit fix 2026-05-30: thêm promptNodeFallback + promptNodeDeleteAfter — 2 toggles này
      // user có thể change nhưng KHÔNG được snapshot → dirty check miss.
      'promptNodeText', 'promptNodeUseAi', 'promptNodeProvider', 'promptNodeTimeout',
      'promptNodeFallback', 'promptNodeDeleteAfter', 'promptNodeRefFileIds'];
    const snapshot = {};
    fields.forEach(id => {
      const el = this.overlay.querySelector(`#${id}`);
      if (!el) return;
      snapshot[id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return snapshot;
  }

  _isFormDirty() {
    if (!this._formSnapshot) return false;
    const current = this._captureFormSnapshot();
    if (!current) return false;
    return Object.keys(this._formSnapshot).some(k => this._formSnapshot[k] !== current[k]);
  }

  async _handleNodeSelected(nodeId) {
    if (this._dialogPending) return;

    // Check uploads đang chạy TRƯỚC dirty check
    const activeUploads = this._countActiveFormUploads();
    if (activeUploads > 0 && this.selectedNodeId) {
      this._dialogPending = true;
      try {
        await new Promise(r => setTimeout(r, 50));
        const ok = await window.customDialog?.confirm(
          window.I18n?.t('workflow.uploadSwitchNodeWarn', { count: activeUploads }) || `Uploading ${activeUploads} reference images. Switching node will cancel upload and lose unsaved data.`,
          { title: window.I18n?.t('workflow.uploadInProgress') || 'Images uploading', type: 'warning', confirmText: window.I18n?.t('workflow.switchAndCancel') || 'Switch and cancel', cancelText: window.I18n?.t('workflow.continueUpload') || 'Continue upload' }
        );
        if (!ok) {
          this._reselectNode(this.selectedNodeId);
          return;
        }
      } finally {
        this._dialogPending = false;
      }
      // [Gap H 2026-06-05] User chọn "Switch and cancel" → discard intent → skip force save
      await this.hideNodeForm({ skipUploadCheck: true, skipDirtySave: true });
      this.showNodeForm(nodeId);
      return;
    }

    // Bug fix: Dùng _formNodeId (node có form đang mở) thay vì selectedNodeId (có thể đã là node mới)
    // Khi user click node B rồi click gear, selectedNodeId = B nhưng form vẫn là của node A
    const formOpenNodeId = this._formNodeId || this.selectedNodeId;
    if (formOpenNodeId && this._isFormDirty()) {
      this._dialogPending = true;
      try {
        await new Promise(r => setTimeout(r, 50));
        const ok = await window.customDialog.confirm(
          window.I18n?.t('workflow.unsavedChanges') || 'Form node đang có thay đổi chưa lưu. Bạn muốn bỏ thay đổi?',
          { title: window.I18n?.t('workflow.notSaved') || 'Chưa lưu', confirmText: window.I18n?.t('workflow.discardChanges') || 'Bỏ thay đổi', cancelText: window.I18n?.t('common.back') || 'Quay lại' }
        );
        if (!ok) {
          // Reselect node CŨ (node có form đang mở), không phải node mới
          this._reselectNode(formOpenNodeId);
          return;
        }
      } finally {
        this._dialogPending = false;
      }
    }
    this.showNodeForm(nodeId);
  }

  async _handleNodeUnselected() {
    // UI 2026-05-27: bỏ highlight connection khi không còn node nào được select.
    try { this._setNodeConnectionsSelected(null); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_handleNodeUnselected', e); }
    if (this._dialogPending) return;

    // Dùng _formNodeId để đảm bảo consistency với node có form đang mở
    const formOpenNodeId = this._formNodeId || this.selectedNodeId;

    // Check if node still exists - if deleted, bypass dialog and just close form
    if (formOpenNodeId) {
      const nodeExists = this.diagramCanvas?.editor?.getNodeFromId(formOpenNodeId);
      if (!nodeExists) {
        // Node was deleted, just close form without dialog
        // [Gap H 2026-06-05] Node đã xóa → KHÔNG có gì để save → skipDirtySave (defense)
        this._formUploadKeys?.clear();
        await this.hideNodeForm({ skipUploadCheck: true, skipDirtySave: true });
        return;
      }
    }

    // Check uploads đang chạy TRƯỚC dirty check — ưu tiên cảnh báo upload
    const activeUploads = this._countActiveFormUploads();
    if (activeUploads > 0 && formOpenNodeId) {
      this._dialogPending = true;
      try {
        await new Promise(r => setTimeout(r, 50));
        const ok = await window.customDialog?.confirm(
          window.I18n?.t('workflow.uploadCloseFormWarn', { count: activeUploads }) || `Uploading ${activeUploads} reference images. Closing form will cancel upload and lose unsaved data.`,
          { title: window.I18n?.t('workflow.uploadInProgress') || 'Images uploading', type: 'warning', confirmText: window.I18n?.t('workflow.closeAndCancel') || 'Close and cancel', cancelText: window.I18n?.t('workflow.continueUpload') || 'Continue upload' }
        );
        if (!ok) {
          this._reselectNode(formOpenNodeId);
          return;
        }
      } finally {
        this._dialogPending = false;
      }
      // User confirmed close — skip hideNodeForm's upload check (đã confirm rồi)
      // [Gap H 2026-06-05] "Close and cancel" = discard intent → skipDirtySave
      await this.hideNodeForm({ skipUploadCheck: true, skipDirtySave: true });
      return;
    }

    if (formOpenNodeId && this._isFormDirty()) {
      this._dialogPending = true;
      try {
        await new Promise(r => setTimeout(r, 50));
        const ok = await window.customDialog.confirm(
          window.I18n?.t('workflow.unsavedChanges') || 'Form node đang có thay đổi chưa lưu. Bạn muốn bỏ thay đổi?',
          { title: window.I18n?.t('workflow.notSaved') || 'Chưa lưu', confirmText: window.I18n?.t('workflow.discardChanges') || 'Bỏ thay đổi', cancelText: window.I18n?.t('common.back') || 'Quay lại' }
        );
        if (!ok) {
          this._reselectNode(formOpenNodeId);
          return;
        }
      } finally {
        this._dialogPending = false;
      }
    }
    // [Gap H 2026-06-05] Reach line này nghĩa: (1) form clean → save skip anyway HOẶC
    // (2) form dirty + user chọn "Bỏ thay đổi" → explicit discard intent → skipDirtySave.
    await this.hideNodeForm({ skipDirtySave: true });
  }

  _reselectNode(nodeId) {
    if (!this.diagramCanvas?.editor || !nodeId) return;
    try {
      const editor = this.diagramCanvas.editor;

      // Force-cancel any in-progress Drawflow drag by dispatching a synthetic mouseup
      const canvas = this.overlay?.querySelector('#drawflowCanvas');
      if (canvas) {
        canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }

      // Reset Drawflow internal drag state
      editor.drag = false;
      editor.drag_point = false;
      editor.editor_selected = false;
      editor.node_selected = null;
      editor.ele_selected = null;

      canvas?.querySelectorAll('.drawflow-node.selected').forEach(el => el.classList.remove('selected'));
      const nodeEl = canvas?.querySelector(`#node-${nodeId}`);
      if (nodeEl) {
        nodeEl.classList.add('selected');
        editor.node_selected = nodeEl;
      }
    } catch (e) {
      console.warn('[SEOSONA Flow] Re-select node failed:', e);
    }
  }

  /**
   * Phase: Sync visual của toggle enabled icon button trong node-form-header
   * theo state của #nodeEnabled checkbox (hidden input).
   */
  _syncEnabledToggleVisual() {
    const btn = this.overlay?.querySelector('#toggleEnabledBtn');
    const checkbox = this.overlay?.querySelector('#nodeEnabled');
    if (!btn || !checkbox) return;
    const enabled = !!checkbox.checked;
    btn.dataset.enabled = enabled ? 'true' : 'false';
    btn.classList.toggle('node-form-toggle-enabled--on', enabled);
    btn.classList.toggle('node-form-toggle-enabled--off', !enabled);
    btn.title = enabled
      ? (window.I18n?.t('workflow.disableNode') || 'Tắt node')
      : (window.I18n?.t('workflow.enableNode') || 'Bật node');
  }

  showNodeForm(nodeId) {
    // Template preview: ẩn sidebar hoàn toàn để user tò mò → clone workflow
    if (this.workflow?._is_template_preview) {
      return;
    }

    this.selectedNodeId = nodeId;
    this._missingRefWarned = false;

    // 2026-05-31 Rescan Tier 1 enhancement: trigger auto-rescan khi user mở node sidebar.
    // force=true bypass throttle 3s — user intent rõ ràng (click setting node), worth
    // immediate fresh scan. _autoRescanBrokenThumbs có internal early return khi không có
    // broken refs nên cost gần như zero khi không cần rescan.
    setTimeout(() => { this._autoRescanBrokenThumbs?.({ force: true }); }, 200);
    // Reset stale upload tracking từ session trước (vd ref refresh trong workflow run
    // có thể để stale key trong _formUploadKeys → _countActiveFormUploads sai → save
    // button stuck disabled). Clear trước khi mở form mới.
    if (this._formUploadKeys?.size > 0) {
      this._formUploadKeys.clear();
    }
    const panel = this.overlay?.querySelector('#nodeFormPanel');
    const body = this.overlay?.querySelector('#nodeFormBody');
    const resultBody = this.overlay?.querySelector('#nodeResultBody');

    if (panel && body && this.diagramCanvas?.editor) {
      const node = this.diagramCanvas.editor.getNodeFromId(nodeId);
      if (!node) return;

      const data = node.data || {};
      // Bug fix: Ưu tiên data.node_type (original) over node.class (có thể bị corrupt)
      const nodeType = data.node_type || node.class || 'generate';

      // Store node type for upload handlers (they need correct container selector)
      this._currentFormNodeType = nodeType;
      // Track which node has form open (for syncing data before run/save)
      this._formNodeId = nodeId;

      // Type-specific form rendering
      body.innerHTML = this._renderNodeFormByType(nodeType, data, nodeId);

      // Render result tab
      if (resultBody) resultBody.innerHTML = this._renderNodeResultTab(data);

      // Render help tab (only for supported node types)
      const helpBody = this.overlay.querySelector('#nodeHelpBody');
      const helpTab = this.overlay.querySelector('#nodeFormHelpTab');
      const HELP_SUPPORTED_TYPES = ['generate', 'chatgpt', 'grok', 'prompt', 'text_extract'];
      if (HELP_SUPPORTED_TYPES.includes(nodeType)) {
        if (helpBody) helpBody.innerHTML = this._renderNodeHelpTab(nodeType);
        helpTab?.classList.remove('hidden');
      } else {
        helpTab?.classList.add('hidden');
      }

      // Reset to config tab — CHỈ main tabs (#nodeFormTabs), KHÔNG đụng name/slug sub-tabs
      // (chúng cũng có class .node-form-tab nhưng dùng data-nstab → query toàn cục sẽ gỡ active
      // tab "Tên" mặc định). 2026-06-25.
      const tabs = this.overlay.querySelector('#nodeFormTabs')?.querySelectorAll('.node-form-tab') || [];
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'config'));
      body.classList.remove('hidden');
      resultBody?.classList.add('hidden');
      helpBody?.classList.add('hidden');
      this.overlay.querySelector('#nodeFormFooter')?.classList.remove('hidden');

      panel.classList.remove('hidden');

      // [Admin/Shared preview] Disable all form inputs when read-only
      if (this.isReadOnly()) {
        panel.classList.add('wf-form-readonly');
        // Disable all inputs in body
        body.querySelectorAll('input, select, textarea').forEach(el => {
          el.disabled = true;
          el.setAttribute('readonly', 'readonly');
        });
        // Disable ALL buttons in panel (including header buttons) except close
        panel.querySelectorAll('button').forEach(btn => {
          if (btn.id !== 'closeNodeFormBtn') {
            btn.disabled = true;
          }
        });
      } else {
        panel.classList.remove('wf-form-readonly');
      }

      // Phase: sync visual của toggle enabled icon button trong node-form-header
      this._syncEnabledToggleVisual();

      // Render prompt source banner ở đầu form khi port "text" có upstream connection
      try { this._refreshAllPromptSourceBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#showNodeForm', e); }

      // --- Bind events based on node type ---
      this._bindNodeFormEvents(nodeType, data, nodeId);

      // Update provider status indicator for ChatGPT/Grok nodes
      if (nodeType === 'chatgpt' || nodeType === 'grok') {
        this._updateProviderStatusIndicator(nodeType);
      }

      // Flow Voice Selector — init voice picker cho flow_generate node (lazy init)
      if (nodeType === 'flow_generate' || nodeType === 'generate') {
        try { this._initNodeVoicePicker(data); } catch (e) { console.warn('[WorkflowEditor] voice picker init failed', e); }
        try { this._initNodeCharacterPicker(data); } catch (e) { console.warn('[WorkflowEditor] character picker init failed', e); }
      }

      // Track form edits to warn on unsaved changes (beforeunload)
      // Using { once: true } so it only fires once — first edit sets the flag
      body.addEventListener('input', () => { this._hasUnsavedChanges = true; }, { once: true });
      body.addEventListener('change', () => { this._hasUnsavedChanges = true; }, { once: true });

      // S2.5: Listen for upload events trong node form
      if (this._uploadStartedHandler) {
        window.eventBus?.off('upload:started', this._uploadStartedHandler);
      }
      this._uploadStartedHandler = (uploadData) => {
        const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds');
        if (fileIdsInput?.value) this._renderNodeRefPreview(fileIdsInput.value, this._getRefPreviewSelector());
        this._updateFormButtonState();
        // 2026-05-25 Option B: live-sync tempId vào Drawflow node.data → diagram
        // hiện loading thumbnail ngay (parity với paste image UX). Auto-save sau khi
        // upload completed (xem `_wfUploadCompletedHandler`).
        if (uploadData?.key) {
          try { this._syncFormUploadToDrawflowNode(uploadData.key); } catch (e) { /* ignore */ }
        }
      };
      window.eventBus?.on('upload:started', this._uploadStartedHandler);

      if (this._uploadCompletedHandler) {
        window.eventBus?.off('upload:completed', this._uploadCompletedHandler);
      }
      this._uploadCompletedHandler = (uploadData) => {
        const containerSel = this._getRefPreviewSelector();
        if (!uploadData?.key || !uploadData?.tile_id) {
          // Vẫn re-render để xóa CSS uploading (isUploading đã false)
          const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds');
          if (fileIdsInput?.value) this._renderNodeRefPreview(fileIdsInput.value, containerSel);
          this._updateFormButtonState();
          return;
        }
        // Bug fix: LUÔN sync node data trong Drawflow editor VÀ DOM input.
        // Trước fix: user switch form → _formUploadKeys cleared → upload xong nhưng không sync
        // → node.data vẫn giữ upload_xxx key → Local badge vẫn hiện.
        try {
          this._syncUploadKeyToAllNodes(uploadData);
        } catch (err) {
          console.error('[WorkflowEditor] _syncUploadKeyToAllNodes error:', err);
        }
        // LUÔN sync DOM input nếu form đang mở và input chứa upload key
        try {
          this._syncUploadKeyToTileId(uploadData);
        } catch (err) {
          console.error('[WorkflowEditor] _syncUploadKeyToTileId error:', err);
        }
        // Fallback: Sync DOM input từ Drawflow data nếu form đang mở
        // (đảm bảo DOM và Drawflow data đồng bộ)
        if (this._formNodeId && this.diagramCanvas?.editor) {
          const nodeObj = this.diagramCanvas.editor.getNodeFromId(this._formNodeId);
          const drawflowRefIds = nodeObj?.data?.ref_file_ids;
          const inputMap = {
            '#nodeRefImagesPreview': '#nodeRefFileIds',
            '#chatgptImageRefPreview': '#chatgptImageRefFileIds',
            '#grokNodeRefPreview': '#grokNodeRefFileIds',
            '#promptNodeRefPreview': '#promptNodeRefFileIds',
            '#imageNodeRefPreview': '#nodeRefFileIds',
          };
          const inputSelector = inputMap[containerSel] || '#nodeRefFileIds';
          const fileIdsInput = this.overlay?.querySelector(inputSelector);

          // Bug fix: Chỉ sync nếu Drawflow có ref_file_ids và chứa tile_id mới
          // Nếu Drawflow vẫn chưa có data (node mới, chưa save) → KHÔNG ghi đè DOM input
          if (fileIdsInput && drawflowRefIds && drawflowRefIds.includes(uploadData.tile_id)) {
            fileIdsInput.value = drawflowRefIds;
            this._renderNodeRefPreview(drawflowRefIds, containerSel);
          } else if (fileIdsInput?.value) {
            // Re-render với DOM input hiện tại thay vì ghi đè
            this._renderNodeRefPreview(fileIdsInput.value, containerSel);
          }
        }
        this._updateFormButtonState();
      };
      window.eventBus?.on('upload:completed', this._uploadCompletedHandler);

      if (this._uploadFailedHandler) {
        window.eventBus?.off('upload:failed', this._uploadFailedHandler);
      }
      this._uploadFailedHandler = (uploadData) => {
        console.log('[WorkflowEditor] upload:failed received:', uploadData?.key?.substring(0, 15), 'tracked:', this._formUploadKeys?.has(uploadData?.key));
        // Luôn re-render để xóa CSS uploading (isUploading đã false sau finally block)
        const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds');
        if (fileIdsInput?.value) this._renderNodeRefPreview(fileIdsInput.value, this._getRefPreviewSelector());
        // Re-render frame previews nếu upload key là frame
        for (const fNum of [1, 2]) {
          const frameInput = this.overlay?.querySelector(`#frame${fNum}FileId`);
          const fid = frameInput?.value?.trim();
          if (fid && fid.startsWith('upload_')) {
            this._renderFramePreview(fNum, fid);
          }
        }
        this._updateFormButtonState();
      };
      window.eventBus?.on('upload:failed', this._uploadFailedHandler);

      // Capture initial form snapshot for dirty check
      this._formSnapshot = this._captureFormSnapshot();

      // Reset header buttons visibility (undo hidden state from previous node)
      this.overlay.querySelector('#deleteNodeBtn')?.classList.remove('hidden');

      // Run button: only show if node has content AND has been saved
      // Bug fix: Grok/ChatGPT/Generate có upstream Prompt node qua port `text` →
      // node.prompt rỗng vẫn run được (runtime override từ upstream).
      let hasContent;
      if (nodeType === 'delay') hasContent = data.enabled !== false;
      else if (['note', 'image'].includes(nodeType)) hasContent = false;
      else {
        const hasOwnPrompt = !!(data.prompt && data.prompt.trim());
        if (hasOwnPrompt) {
          hasContent = true;
        } else {
          // Check upstream Prompt node qua port text/default
          const edges = this.workflow?.edges || [];
          const inputEdges = edges.filter((e) => e.target_node_id === data.node_id);
          hasContent = inputEdges.some((e) => {
            if (e.target_port && e.target_port !== 'text' && e.target_port !== 'default') return false;
            const src = this.workflow?.nodes?.find((n) => n.node_id === e.source_node_id);
            return src?.node_type === 'prompt';
          });
        }
      }
      const isNodeSaved = !!(data.node_id && this.workflow?.nodes?.some(n => n.node_id === data.node_id));
      const canRunNode = hasContent && isNodeSaved;
      const runBtn = this.overlay.querySelector('#runSingleNodeBtn');
      if (runBtn) {
        runBtn.classList.toggle('hidden', !canRunNode);
      }

      // Disable form if this node or workflow is currently running
      const isNodeRunning = data.status === 'running';
      const isWfRunning = window.workflowExecutor?.isRunning;
      if (isNodeRunning || isWfRunning) {
        this._setNodeFormDisabled(true);
      }

      // If node or workflow is running, hide run, reset & delete buttons
      if (isNodeRunning || isWfRunning) {
        this.overlay.querySelector('#runSingleNodeBtn')?.classList.add('hidden');
        this.overlay.querySelector('#resetSingleNodeBtn')?.classList.add('hidden');
        this.overlay.querySelector('#deleteNodeBtn')?.classList.add('hidden');
      }
      if (isNodeRunning) {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'result'));
        body.classList.add('hidden');
        resultBody?.classList.remove('hidden');
        this.overlay.querySelector('#nodeFormFooter')?.classList.add('hidden');
      }

      // Show/hide download button based on result files
      this._updateDownloadButton();

      // Show/hide reset single node button (show when node has results or non-pending status)
      this._updateResetSingleNodeButton();

      // Force re-eval save button state — đảm bảo enabled khi không còn upload active
      // (defensive: tránh stale state từ session trước khi user open form sau run).
      this._updateFormButtonState();

      // Show ref_mode group only when >= 2 incoming sources connected
      this._updateRefModeVisibility();
    }
  }

  /**
   * Bind events cho frame source selector (frame 1 hoặc 2)
   */
  _bindFrameSourceEvents(frameNum, data) {
    const select = this.overlay?.querySelector(`#frame${frameNum}Source`);
    const manualDiv = this.overlay?.querySelector(`#frame${frameNum}Manual`);
    const nodeInfoDiv = this.overlay?.querySelector(`#frame${frameNum}NodeInfo`);
    const pickBtn = this.overlay?.querySelector(`#frame${frameNum}PickBtn`);

    select?.addEventListener('change', () => {
      const val = select.value;
      if (val === 'manual') {
        manualDiv?.classList.remove('hidden');
        nodeInfoDiv?.classList.add('hidden');
      } else if (val) {
        manualDiv?.classList.add('hidden');
        nodeInfoDiv?.classList.remove('hidden');
      } else {
        manualDiv?.classList.add('hidden');
        nodeInfoDiv?.classList.add('hidden');
      }
      // WK-1.7.frame-sync: form dropdown change → sync edge vào port frame_X
      // Dùng flag _suppressFrameSyncEdge để tránh loop khi change event do edge sync programmatic dispatch
      if (!select._suppressFrameSyncEdge) {
        try { this._syncEdgeFromFrameDropdown(frameNum, val); } catch (e) {
          console.warn('[WorkflowEditor] frame dropdown → edge sync failed:', e);
        }
      }
    });

    pickBtn?.addEventListener('click', () => this._openNodeFramePicker(frameNum));
  }

  /**
   * WK-1.7.frame-sync: dropdown frame_X_source thay đổi → đồng bộ edge vào port frame_X.
   * - newValue = node_id (uuid): xóa edge cũ, tạo edge mới từ port `media` của node đó.
   * - newValue = 'manual' hoặc '': xóa edge cũ (giữ frame_X_file_id để user dùng).
   */
  _syncEdgeFromFrameDropdown(frameNum, newValue) {
    const editor = this.diagramCanvas?.editor;
    if (!editor || !this.selectedNodeId) return;
    const targetDrawflowId = this.selectedNodeId;
    const targetNode = editor.getNodeFromId(targetDrawflowId);
    if (!targetNode) return;

    const targetPortName = `frame_${frameNum}`;
    const portMap = targetNode.data?._port_map || {};
    const inputClassEntry = Object.entries(portMap).find(
      ([k, v]) => v === targetPortName && k.startsWith('input_')
    );
    if (!inputClassEntry) return; // port không tồn tại (không phải Video+Frames mode)
    const inputClass = inputClassEntry[0];

    const sourceField = `frame_${frameNum}_source`;
    const fileIdField = `frame_${frameNum}_file_id`;
    const isNodeId = newValue && newValue !== 'manual' && newValue !== '';

    // Cập nhật node.data TRƯỚC khi thao tác edge → connectionCreated handler sẽ thấy
    // frame_X_source đã match → KHÔNG fire confirm dialog (đã xử lý từ dropdown).
    const currentData = targetNode.data || {};
    const newData = { ...currentData };
    if (isNodeId) {
      newData[sourceField] = newValue;
      newData[fileIdField] = ''; // edge override manual file
    } else if (newValue === 'manual') {
      newData[sourceField] = 'manual';
      // KHÔNG clear fileIdField — user có thể đã upload trước đó
    } else {
      newData[sourceField] = '';
      // KHÔNG clear fileIdField (giữ làm backup)
    }
    try {
      editor.updateNodeDataFromId(targetDrawflowId, newData);
    } catch (e) { /* ignore */ }

    // Đồng bộ hidden input để form save đọc đúng giá trị
    const fileIdInput = this.overlay?.querySelector(`#frame${frameNum}FileId`);
    if (fileIdInput) fileIdInput.value = newData[fileIdField] || '';

    // Xóa edge hiện tại vào port frame_X (nếu có)
    const existingConns = targetNode.inputs?.[inputClass]?.connections || [];
    for (const conn of existingConns.slice()) {
      try {
        // conn = { node: source_drawflow_id, input: output_class }
        editor.removeSingleConnection(conn.node, targetDrawflowId, conn.input, inputClass);
      } catch (e) { /* ignore */ }
    }

    // Nếu không pick node_id → dừng (manual hoặc rỗng đều không cần edge)
    if (!isNodeId) return;

    // Tạo edge mới từ port `media` của source node
    const sourceDrawflowId = this._findDrawflowId(newValue);
    if (!sourceDrawflowId) {
      console.warn('[WorkflowEditor] _syncEdgeFromFrameDropdown: source node not found:', newValue);
      return;
    }
    const sourceNode = editor.getNodeFromId(sourceDrawflowId);
    if (!sourceNode) return;

    // Tìm output port có name = 'media' (hoặc fallback output đầu tiên cho legacy nodes)
    const sourcePortMap = sourceNode.data?._port_map || {};
    let outputClass = Object.entries(sourcePortMap).find(
      ([k, v]) => v === 'media' && k.startsWith('output_')
    )?.[0];
    if (!outputClass) {
      // Fallback: pick output_1 (port đầu tiên) cho legacy nodes
      const firstOutput = Object.keys(sourceNode.outputs || {})[0];
      outputClass = firstOutput || 'output_1';
    }

    try {
      editor.addConnection(sourceDrawflowId, targetDrawflowId, outputClass, inputClass);
    } catch (e) {
      console.warn('[WorkflowEditor] addConnection failed:', e);
    }
  }

  /**
   * WK-1.7.frame-sync: Re-render dropdown frame_X_source khi DiagramCanvas đã update
   * node.data từ edge connect/disconnect. Chỉ apply nếu form đang mở cho node đó.
   */
  _refreshFrameDropdownsForNode(drawflowId, changedFields) {
    if (!drawflowId || !this.overlay) return;
    if (String(this.selectedNodeId) !== String(drawflowId)) return;
    const formPanel = this.overlay.querySelector('#nodeFormPanel');
    if (!formPanel || formPanel.classList.contains('hidden')) return;

    const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    if (!node?.data) return;
    const data = node.data;

    const fields = Array.isArray(changedFields) ? changedFields : ['frame_1_source', 'frame_2_source', 'frame_1_file_id', 'frame_2_file_id'];
    [1, 2].forEach((n) => {
      const sourceField = `frame_${n}_source`;
      const fileIdField = `frame_${n}_file_id`;
      if (!fields.includes(sourceField) && !fields.includes(fileIdField)) return;

      const select = this.overlay.querySelector(`#frame${n}Source`);
      if (select && select.value !== (data[sourceField] || '')) {
        // Suppress edge sync để tránh loop (data đã do canvas sync set)
        select._suppressFrameSyncEdge = true;
        try {
          select.value = data[sourceField] || '';
          select.dispatchEvent(new Event('change'));
        } finally {
          select._suppressFrameSyncEdge = false;
        }
      }
      const fileIdInput = this.overlay.querySelector(`#frame${n}FileId`);
      if (fileIdInput && fileIdInput.value !== (data[fileIdField] || '')) {
        fileIdInput.value = data[fileIdField] || '';
        // Re-render preview thumbnail (clear nếu file_id rỗng)
        this._renderFramePreview(n, data[fileIdField] || '', '');
      }
    });
  }

  _openNodeFramePicker(frameNum) {
    const fileIdInput = this.overlay?.querySelector(`#frame${frameNum}FileId`);
    const existingIds = (fileIdInput?.value || '').split(',').filter(Boolean);
    if (this._ensureImagePickerReady()) {
      window.imagePickerModal.open({
        existingFileIds: existingIds,
        singleSelect: true,
        mediaFilter: 'image',
        onConfirm: async (images) => {
          if (images.length > 0) {
            const img = images[0];
            if (img.source === 'upload' && img.file) {
              const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
              if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
              window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });
              this._tileCacheSet(key, { thumbnail: img.thumbnail, file_name: '', type: 'image' });
              if (window.ImmediateUploader) {
                ImmediateUploader.upload(img.file, img.thumbnail, { key }).catch(e => this._handleUploadError(e, 'Frame'));
              } else if (window.PendingUploadStore) {
                PendingUploadStore.saveLightweight(key, { thumbnail: img.thumbnail, fileName: img.file.name, fileSize: img.file.size, fileType: img.file.type });
              }
              img.fileId = key;
              this._formUploadKeys?.add(key);
            } else if (img.source === 'album' && window.ImagePickerModal?.prepareAlbumImageForRef) {
              // Album image: xử lý qua prepareAlbumImageForRef
              try {
                const prepared = await window.ImagePickerModal.prepareAlbumImageForRef(img);
                if (prepared) {
                  const key = prepared.key;

                  // Cache thumbnail
                  let thumb = img.thumbnail;
                  if (img.thumbnail_url) {
                    thumb = img.thumbnail_url;
                  } else if (img.album_image_id && window.ImageStore) {
                    try {
                      const blobUrl = await window.ImageStore.getThumbnail(img.album_image_id);
                      if (blobUrl) thumb = blobUrl;
                    } catch (e) { /* ignore */ }
                  }
                  this._tileCacheSet(key, { thumbnail: thumb, file_name: prepared.file_name || '', type: 'image' });

                  // Upload ngay nếu là STALE image
                  if (key.startsWith('upload_')) {
                    const pendingFile = window.pendingUploadFiles?.get(key)?.file;
                    if (pendingFile && window.ImmediateUploader) {
                      ImmediateUploader.upload(pendingFile, img.thumbnail, { key }).catch(e => this._handleUploadError(e, 'Frame album'));
                    }
                    this._formUploadKeys?.add(key);
                  }

                  img.fileId = key;
                  img.thumbnail = thumb;
                }
              } catch (err) {
                console.error('[WorkflowEditor] Lỗi chuẩn bị ảnh album cho frame:', err);
              }
            } else if (img.fileId && img.thumbnail) {
              this._tileCacheSet(img.fileId, { thumbnail: img.thumbnail, file_name: img.file_name || '', type: img.type || 'image' });
            }
            if (fileIdInput) fileIdInput.value = img.fileId || '';
            this._renderFramePreview(frameNum, img.fileId, img.thumbnail);
          }
        }
      });
    }
  }

  _renderFramePreview(frameNum, fileId, thumbnail) {
    const body = this.overlay?.querySelector(`#frame${frameNum}Body`);
    const fileIdInput = this.overlay?.querySelector(`#frame${frameNum}FileId`);
    const slot = this.overlay?.querySelector(`#nodeFrame${frameNum}Slot`);
    if (!body) return;

    if (!fileId) {
      slot?.classList.remove('has-image');
      body.innerHTML = `
        <div class="frame-dropzone" id="frame${frameNum}PickBtn">
          <svg class="frame-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
          <span class="frame-dropzone-text">${window.I18n?.t('gen.addFrame') || 'Add'}</span>
        </div>
      `;
      // Re-bind click on dropzone
      const dropzone = body.querySelector('.frame-dropzone');
      if (dropzone) {
        dropzone.addEventListener('click', () => this._openNodeFramePicker(frameNum));
      }
      return;
    }

    // Tìm thumbnail từ cache hoặc pending
    if (!thumbnail) {
      const cached = this._tileCache.get(fileId);
      if (cached?.thumbnail) {
        thumbnail = cached.thumbnail;
      } else {
        const pending = window.pendingUploadFiles?.get(fileId);
        if (pending?.thumbnail) {
          thumbnail = pending.thumbnail;
        }
      }
    }

    const isPending = fileId.startsWith('upload_');
    const isUploading = isPending && window.ImmediateUploader?.isUploading(fileId);

    slot?.classList.add('has-image');
    body.innerHTML = `
      <div class="frame-thumb-wrap ${isUploading ? 'uploading' : ''}" data-file-id="${this.escapeAttr(fileId)}">
        ${thumbnail ? `<img src="${this._safeMediaSrc(thumbnail)}" alt="Frame ${this.escapeAttr(String(frameNum))}" />` : `<div class="frame-thumb-fallback">${this.escapeHtml(fileId.substring(0, 12))}</div>`}
        <div class="ref-thumb-remove" title="${window.I18n?.t('common.delete') || 'Xóa'}"
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </div>
      </div>
    `;

    // Bind remove button
    body.querySelector('.ref-thumb-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isPending && window.ImmediateUploader) {
        ImmediateUploader.cancel(fileId);
      }
      this._formUploadKeys?.delete(fileId);
      if (fileIdInput) fileIdInput.value = '';
      this._renderFramePreview(frameNum, '', '');
    });

    // Click thumbnail to re-pick
    const thumbWrap = body.querySelector('.frame-thumb-wrap');
    if (thumbWrap && !isUploading) {
      thumbWrap.addEventListener('click', (e) => {
        if (e.target.closest('.ref-thumb-remove')) return;
        this._openNodeFramePicker(frameNum);
      });
    }
  }

  async handleNodeImagePickerConfirm(images) {
    const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds');
    if (!fileIdsInput) return;

    const existingIds = fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);

    // Tách ảnh Flow (đã có tile ID) và ảnh upload (cache file, chờ run mới upload)
    const flowImages = images.filter(img => img.source === 'flow' || img.source === 'existing');
    const uploadImages = images.filter(img => img.source === 'upload' && img.file);

    const newIds = flowImages.map(img => img.fileId).filter(Boolean);

    // Cache thumbnail cho Flow images vào _tileCache.
    // 2026-05-31: video tile có thể KHÔNG có thumbnail (no poster) nhưng có video_url →
    // vẫn cache để render layer dùng <video> element. Trước: skip nếu !thumbnail → mất tile.
    console.log('[WorkflowEditor] handleNodeImagePickerConfirm: caching', flowImages.length, 'flow images', flowImages.map(i => ({ id: i.fileId, type: i.type, hasThumb: !!i.thumbnail, hasVideoUrl: !!i.video_url })));
    for (const img of flowImages) {
      if (!img.fileId) continue;
      if (!img.thumbnail && !img.video_url) {
        console.warn('[WorkflowEditor] SKIP cache for', img.fileId, '- no thumbnail or video_url');
        continue;
      }
      this._tileCacheSet(img.fileId, {
        thumbnail: img.thumbnail || '',
        file_name: img.file_name || '',
        type: img.type || 'image',
        ...(img.video_url && { video_url: img.video_url }),
      });
    }

    // Xử lý ảnh album (ALIVE/STALE)
    const albumImages = images.filter(img => img.source === 'album');
    if (albumImages.length > 0) {
      for (const img of albumImages) {
        try {
          const prepared = await ImagePickerModal.prepareAlbumImageForRef(img);
          if (!prepared) continue;
          const key = prepared.key;
          // Cache thumbnail vào _tileCache
          this._tileCacheSet(key, {
            thumbnail: img.thumbnail,
            file_name: prepared.file_name || '',
            type: 'image'
          });
          newIds.push(key);
          // STALE: fire ImmediateUploader
          if (key.startsWith('upload_')) {
            const pendingFile = window.pendingUploadFiles?.get(key)?.file;
            if (pendingFile && window.ImmediateUploader) {
              ImmediateUploader.upload(pendingFile, img.thumbnail, { key }).catch(e => this._handleUploadError(e, 'Generate ref album'));
            }
            this._formUploadKeys?.add(key);
          }
        } catch (err) {
          console.error('[WorkflowEditor] Lỗi chuẩn bị ảnh album:', err);
        }
      }
    }

    // Cache ảnh upload local (IndexedDB + memory)
    if (uploadImages.length > 0) {
      if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
      for (const img of uploadImages) {
        const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        // Set memory ngay lập tức
        window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });
        // Cache thumbnail vào _tileCache (persistent qua upload lifecycle)
        this._tileCacheSet(key, { thumbnail: img.thumbnail, file_name: '', type: 'image' });
        // S2: Upload ngay nếu Flow tab mở, hoặc lưu lightweight pending
        if (window.ImmediateUploader) {
          ImmediateUploader.upload(img.file, img.thumbnail, { key }).catch(e => this._handleUploadError(e, 'Generate ref'));
        } else if (window.PendingUploadStore) {
          PendingUploadStore.saveLightweight(key, { thumbnail: img.thumbnail, fileName: img.file.name, fileSize: img.file.size, fileType: img.file.type });
        }
        newIds.push(key);
        this._formUploadKeys?.add(key);
      }
    }

    const mergedIds = [...new Set([...existingIds, ...newIds])];
    fileIdsInput.value = mergedIds.join(', ');

    this._renderNodeRefPreview(fileIdsInput.value, this._getRefPreviewSelector());

    // 2026-05-31 REVERTED: bỏ _syncDrawflowNodeData + _showNodeRefPreview ở đây vì gây
    // regression — updateNodeDataFromId trigger node re-render → mất result_thumbnail DOM,
    // mất các refs hiện có (regenerate from cache state nhưng cache stale). Node card sẽ
    // update khi user save node form qua flow chuẩn.
  }

  /**
   * Update ratio options based on media type
   * Bug 42d fix (2026-05-13): Source from PCM (admin tweak realtime via SSE) thay vì hardcoded.
   * Trước fix: hàm này override `<select id="nodeRatio">` template với hardcoded 5/2 options →
   * mọi update từ admin (thêm/xóa ratio) bị wipe sau khi user đổi media_type.
   */
  _updateNodeRatioOptions() {
    const ratioSelect = this.overlay?.querySelector('#nodeRatio');
    const mediaTypeSelect = this.overlay?.querySelector('#nodeMediaType');
    if (!ratioSelect) return;

    const isVideo = mediaTypeSelect?.value === 'Video';
    const currentValue = ratioSelect.value;

    // Source of truth: ProviderConfigManager.getRatiosSync('flow', mode) — admin tweakable.
    const mode = isVideo ? 'video' : 'image';
    const fallback = isVideo ? ['16:9', '9:16'] : ['16:9', '4:3', '1:1', '3:4', '9:16'];
    const ratios = (window.ProviderConfigManager?.safeGetRatiosSync?.('flow', mode)) || fallback;

    const _icon = (v) => {
      const s = String(v || '').trim();
      if (s === '16:9') return '▬';
      if (s === '4:3' || s === '3:2') return '▭';
      if (s === '1:1') return '□';
      if (s === '3:4' || s === '2:3') return '▯';
      if (s === '9:16') return '▮';
      return '◇';
    };

    const options = ratios.map(r => {
      const value = typeof r === 'string' ? r : r.value;
      return { value, label: `${_icon(value)} ${value}` };
    });
    ratioSelect.innerHTML = options.map(opt =>
      `<option value="${opt.value}">${opt.label}</option>`
    ).join('');

    // Restore value if valid, else fallback to default ratio from settings
    const validValues = options.map(o => o.value);
    if (validValues.includes(currentValue)) {
      ratioSelect.value = currentValue;
    } else {
      // Fallback to default ratio from settings
      chrome.storage.local.get(['af_settings'], (res) => {
        const settings = res.af_settings || {};

        // Ưu tiên key numeric mới (Settings popup), fallback legacy VN key
        const vnToNumeric = { 'Dọc': '9:16', 'Ngang': '16:9', 'Vuông': '1:1' };
        const legacyRatio = vnToNumeric[settings.defaultRatio] || settings.defaultRatio;
        const userDefault = isVideo
          ? (settings.defaultVideoRatio || legacyRatio)
          : (settings.defaultImageRatio || legacyRatio);

        // Cap về validValues nếu user setting không tương thích
        const defaultRatio = validValues.includes(userDefault) ? userDefault : '16:9';
        ratioSelect.value = defaultRatio;
      });
    }
  }

  /**
   * Render ref image preview thumbnails
   * @param {string} refFileIds - Comma-separated tile IDs
   * @param {string|number|object} containerSelectorOrOptions - Container selector, retry count, or options object
   * @param {number} retryCount - Retry count for missing thumbnails
   *
   * Options object: { containerSelector, retryCount, refFileNames }
   */
  _renderNodeRefPreview(refFileIds, containerSelectorOrOptions = '#nodeRefImagesPreview', retryCount = 0) {
    // Parse arguments - support multiple call patterns
    let containerSelector = '#nodeRefImagesPreview';
    let refFileNames = null;

    if (typeof containerSelectorOrOptions === 'number') {
      // Old pattern: _renderNodeRefPreview(fileIds, retryCount)
      retryCount = containerSelectorOrOptions;
    } else if (typeof containerSelectorOrOptions === 'object' && containerSelectorOrOptions !== null) {
      // New pattern: _renderNodeRefPreview(fileIds, { containerSelector, retryCount, refFileNames })
      containerSelector = containerSelectorOrOptions.containerSelector || '#nodeRefImagesPreview';
      retryCount = containerSelectorOrOptions.retryCount || 0;
      refFileNames = containerSelectorOrOptions.refFileNames || null;
    } else if (typeof containerSelectorOrOptions === 'string') {
      containerSelector = containerSelectorOrOptions;
    }

    const previewEl = this.overlay?.querySelector(containerSelector);
    // Bug fix: trước hardcode '#nodeRefFileIds' → ChatGPT/Grok/Prompt node dùng ID khác
    // (#chatgptImageRefFileIds, #grokNodeRefFileIds, #promptNodeRefFileIds) → fileIdsInput=null
    // → click remove ref_img silent no-op. Map theo containerSelector để resolve đúng input.
    const fileIdsInputMap = {
      '#nodeRefImagesPreview': '#nodeRefFileIds',
      '#chatgptImageRefPreview': '#chatgptImageRefFileIds',
      '#grokNodeRefPreview': '#grokNodeRefFileIds',
      '#promptNodeRefPreview': '#promptNodeRefFileIds',
      '#imageNodeRefPreview': '#nodeRefFileIds',
    };
    const fileIdsInputSelector = fileIdsInputMap[containerSelector] || '#nodeRefFileIds';
    const fileIdsInput = this.overlay?.querySelector(fileIdsInputSelector);
    if (!previewEl) return;

    const ids = (refFileIds || '').split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      previewEl.innerHTML = '';
      return;
    }

    // Check if we need remote scan for cross-project validation
    // ALWAYS fetch from content script if:
    // 1. Tiles not in local DOM (popup window can't access Flow DOM directly)
    // 2. Cached entries without file_name (need file_name for cross-project validation)
    // 3. No ref_file_names in workflow (old workflow - need to get current file_names for comparison)
    const hasRefFileNames = refFileNames && Object.keys(refFileNames).length > 0;
    const needsRemoteScan = ids.some(id => {
      if (id.startsWith('upload_')) return false;
      const cached = this._tileCache.get(id);
      // Need remote if: no cache, or cache has no file_name, or workflow has no ref_file_names (old workflow)
      if (!cached || !cached.file_name || !hasRefFileNames) return true;
      return false;
    });

    if (needsRemoteScan && typeof MessageBridge !== 'undefined' && retryCount === 0) {
      // Fetch ALL non-upload ids to get current file_names/thumbnails from Flow DOM
      const remoteIds = ids.filter(id => !id.startsWith('upload_'));

      // Render ngay với cache hiện tại (tránh gradient sweep kẹt khi chờ MessageBridge)
      this._renderNodeRefPreviewInner(ids, previewEl, fileIdsInput, 0, containerSelector, refFileNames);

      // Save OLD cache state BEFORE MessageBridge updates it (for comparison)
      const oldCacheState = {};
      for (const id of remoteIds) {
        const cached = this._tileCache.get(id);
        if (cached) {
          oldCacheState[id] = { ...cached };
        }
      }

      MessageBridge.getThumbnailsByIds(remoteIds).then(result => {
        const results = result?.results || {};

        // Detect cross-project by comparing old cache vs new results
        // CHỈ check cross-project khi workflow ĐÃ có ref_file_names (baseline từ lần save trước)
        // Workflow mới hoặc ảnh vừa upload chưa có file_name → skip để tránh false positive
        const crossProjectIds = [];
        for (const [fid, info] of Object.entries(results)) {
          const oldCache = oldCacheState[fid];

          // Cross-project detection: CHỈ dùng file_name (UUID, persistent, chính xác)
          // KHÔNG dùng thumbnail URL (khác params giữa upload result vs DOM → false positive)
          let isCrossProject = false;
          if (oldCache && hasRefFileNames) {
            const oldFileName = oldCache.file_name;
            const newFileName = info?.file_name;

            // Flag khi CẢ HAI đều có file_name và KHÁC nhau
            if (oldFileName && newFileName && oldFileName !== newFileName) {
              console.warn(`[WorkflowEditor] Cross-project collision: ${fid}, old=${oldFileName}, new=${newFileName}`);
              crossProjectIds.push(fid);
              isCrossProject = true;
            }
            // HOẶC khi có oldFileName (saved) nhưng DOM scan trả về tile KHÔNG có file_name
            // → tile có thể đang processing hoặc là tile sai → KHÔNG ghi đè
            else if (oldFileName && !newFileName) {
              console.warn(`[WorkflowEditor] Suspicious tile: ${fid}, saved=${oldFileName}, DOM has no file_name`);
              isCrossProject = true;
            }
          }

          // CRITICAL: Khi cross-project detected, KHÔNG ghi đè cache
          // Giữ thumbnail cũ (đúng) từ ref_thumbnails đã save
          if (isCrossProject) {
            const cached = this._tileCache.get(fid);
            if (cached) {
              cached._crossProject = true;
              this._tileCacheSet(fid, cached);
            } else {
              this._tileCacheSet(fid, { _crossProject: true });
            }
          } else {
            // 2026-05-31 fix: PRESERVE existing cache fields nếu info từ MessageBridge thiếu data.
            // Bug: MessageBridge return `info = {}` khi tile không trong Flow DOM → overwrite cache
            // với thumbnail=undefined → wipe data từ handleNodeImagePickerConfirm vừa pick → render broken.
            // Fix: merge với existing cache, chỉ overwrite field nào info có giá trị.
            const existing = this._tileCache.get(fid) || {};
            this._tileCacheSet(fid, {
              ...existing,
              ...(info?.thumbnail && { thumbnail: info.thumbnail }),
              ...(info?.type && { type: info.type }),
              ...(info?.file_name && { file_name: info.file_name }),
              ...(info?.video_url && { video_url: info.video_url }),
              _crossProject: false,
            });
          }
        }

        // Store cross-project IDs for render
        this._crossProjectRefIds = crossProjectIds;
        this._renderNodeRefPreviewInner(ids, previewEl, fileIdsInput, 0, containerSelector, refFileNames);
      }).catch((err) => {
        console.warn('[WorkflowEditor] MessageBridge error:', err);
        this._renderNodeRefPreviewInner(ids, previewEl, fileIdsInput, 0, containerSelector, refFileNames);
      });
      return;
    }

    this._renderNodeRefPreviewInner(ids, previewEl, fileIdsInput, retryCount, containerSelector, refFileNames);
  }

  /**
   * Extract file_name (UUID) from tile's redirect URL
   * Same logic as content.js extractFileName() for consistency
   * @param {Element} tile - Tile element
   * @returns {string|null} file_name UUID or null
   */
  _extractFileNameFromTile(tile) {
    if (!tile) return null;
    const _p = window._getMediaUrlPattern?.() || 'getMediaUrlRedirect';
    const candidates = [
      ...tile.querySelectorAll(`img[src*="${_p}"]`),
      ...tile.querySelectorAll(`a[href*="${_p}"]`),
      ...tile.querySelectorAll(`[src*="${_p}"]`)
    ];
    if (candidates.length === 0) {
      const img = tile.querySelector('img');
      if (img?.src?.includes(_p)) candidates.push(img);
    }

    for (const el of candidates) {
      const url = el.src || el.href;
      if (!url) continue;
      const fileName = this._extractFileNameFromUrl(url);
      if (fileName) return fileName;
    }
    return null;
  }

  /**
   * 2026-05-31: Detect tile loại video (URL Flow `?name=UUID` không có extension nên
   * filename-based regex fail). Check presence của `<video>` element trong tile DOM
   * (xem data/dom/flow-video-tile-file-dom.md). Cached.type='video' từ ImagePickerModal
   * cũng là source khác — caller check cả 2.
   */
  _isVideoTile(tile) {
    return !!(tile && tile.querySelector && tile.querySelector('video'));
  }

  _extractFileNameFromUrl(url) {
    const _p = window._getMediaUrlPattern?.() || 'getMediaUrlRedirect';
    if (!url || !url.includes(_p)) return null;
    try {
      const urlObj = new URL(url, window.location.origin);
      // Pattern 1: ?name=UUID (simple)
      const name = urlObj.searchParams.get('name');
      if (name && /^[a-f0-9-]{8,}$/i.test(name)) return name;
      // Pattern 2: tRPC ?input={"json":{"name":"UUID"}} or ?input={"0":{"json":{"name":"UUID"}}}
      const input = urlObj.searchParams.get('input');
      if (input) {
        const parsed = JSON.parse(decodeURIComponent(input));
        const json = parsed?.json || parsed?.['0']?.json || parsed;
        if (json?.name && /^[a-f0-9-]{8,}$/i.test(json.name)) return json.name;
      }
    } catch (e) { /* ignore parsing errors */ }
    return null;
  }

  /**
   * Map containerSelector → provider slug.
   * Post-audit fix: phân biệt node type để dùng đúng provider capability.
   */
  _resolveNodeProvider(containerSelector) {
    const map = {
      '#chatgptImageRefPreview': 'chatgpt',
      '#grokNodeRefPreview': 'grok',
      '#promptNodeRefPreview': 'flow',     // prompt node là Flow pass-through
      '#imageNodeRefPreview': 'flow',
      '#nodeRefImagesPreview': 'flow',     // generate node default
    };
    return map[containerSelector] || 'flow';
  }

  _getNodeRefLimit(containerSelector = '#nodeRefImagesPreview') {
    const mediaType = this.overlay?.querySelector('#nodeMediaType')?.value || 'Image';
    const videoInputType = this.overlay?.querySelector('#nodeVideoInputType')?.value || 'Frames';
    const isVideo = mediaType === 'Video';
    const isFrames = isVideo && videoInputType === 'Frames';

    // Post-audit fix: resolve theo provider của node thay vì luôn Flow.
    const provider = this._resolveNodeProvider(containerSelector);
    let resolvedMode = isVideo ? 'video' : 'image';
    if (provider === 'grok') {
      // Grok node có toggle riêng grok_mode (image/video)
      const grokMode = this.overlay?.querySelector('#grokNodeMode')?.value;
      if (grokMode) resolvedMode = grokMode.toLowerCase();
    }

    // 2026-05-22: pass modelValue + duration để detect rule conditional (vd Lite/Fast + duration<8s).
    const _wnrModelValue = this.overlay?.querySelector('#nodeVideoModel')?.value
      || this.overlay?.querySelector('#nodeImageModel')?.value
      || '';
    const _wnrDuration = this.overlay?.querySelector('#nodeVideoDuration')?.value || undefined;
    const resolved = (typeof ImagePickerModal !== 'undefined' && ImagePickerModal.resolveMaxSelections)
      ? ImagePickerModal.resolveMaxSelections({ provider, mode: resolvedMode, isFrames, modelValue: _wnrModelValue, duration: _wnrDuration })
      : null;
    // 0 = model không hỗ trợ ref → return 0 (caller hiển thị "0/0" disable picker hint).
    if (resolved === 0) return 0;
    if (typeof resolved === 'number' && resolved > 0) return resolved;

    // Post-audit fix: fallback PER-PROVIDER thay vì luôn Flow constants.
    // Bug trước: ProviderRegistry chưa bootstrap → resolved=null → fallback Flow 10 →
    // ChatGPT/Grok 5 ref images < 10 → isExceeded=false → KHÔNG có ref-thumb-exceeded class.
    if (provider === 'chatgpt' || provider === 'grok' || provider === 'gemini') {
      return 4; // ChatGPT/Grok/Gemini: 4 ref images max (match adapter capabilities)
    }
    // Flow fallback (legacy constants)
    if (isVideo && !isFrames) return WorkflowEditor.REF_LIMIT_VIDEO;
    return WorkflowEditor.REF_LIMIT_IMAGE;
  }

  // Bug #1A: dựng lại ref_thumbnails CHỈ chứa đúng các ref_file_ids hiện tại (xoá key stale của ref
  // đã đổi/bỏ). Ưu tiên thumbnail đang có đúng id; fallback _tileCache (ảnh user vừa pick). ID là nguồn
  // chân lý — tránh executor remap-theo-vị-trí gán nhầm thumbnail CŨ cho ID mới → gửi ảnh ref cũ.
  _rebuildRefThumbnails(refFileIdsStr, existingThumbs = {}) {
    const ids = (refFileIdsStr || '').split(',').map(s => s.trim()).filter(Boolean);
    const out = {};
    for (const id of ids) {
      if (existingThumbs && existingThumbs[id]) {
        out[id] = existingThumbs[id];
      } else {
        const cached = this._tileCache?.get?.(id);
        if (cached?.thumbnail) out[id] = cached.thumbnail;
      }
    }
    return out;
  }

  _truncateRefFileIds(fileIdsStr, containerSelector) {
    if (!fileIdsStr) return fileIdsStr;
    const refLimit = this._getNodeRefLimit(containerSelector);
    const ids = fileIdsStr.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length > refLimit) {
      // Giữ MỚI NHẤT (slice cuối) — ảnh user vừa thêm thắng, không kẹt ref cũ.
      console.log(`[WorkflowEditor] Ref images vượt giới hạn (${ids.length}/${refLimit}), giữ ${refLimit} ảnh mới nhất`);
      return ids.slice(-refLimit).join(', ');
    }
    return fileIdsStr;
  }

  _renderNodeRefPreviewInner(ids, previewEl, fileIdsInput, retryCount, containerSelector, refFileNames = null) {
    let hasMissing = false;
    let crossProjectMismatch = false;
    const refLimit = this._getNodeRefLimit(containerSelector);

    previewEl.innerHTML = ids.map((id, index) => {
      let thumbSrc = '';
      let isMismatch = false;
      const isPending = id.startsWith('upload_');
      const pending = window.pendingUploadFiles?.get(id);
      const expectedFileName = refFileNames?.[id] || null;
      const cached = this._tileCache.get(id);

      // Skip cross-project check for import keys — they're pending uploads from CDN, not cross-project refs
      const isImportKey = id.startsWith('upload_import_');
      const isCrossProjectFromBridge = !isImportKey && (this._crossProjectRefIds?.includes(id) || cached?._crossProject);

      if (pending?.thumbnail) {
        thumbSrc = pending.thumbnail;
      } else if (isImportKey) {
        // Import keys: get thumbnail from cache (populated from ref_thumbnails during import)
        // Skip DOM check and cross-project validation — these are pending uploads from CDN
        thumbSrc = cached?.thumbnail;
      } else if (isCrossProjectFromBridge) {
        // Already detected as cross-project by MessageBridge thumbnail/file_name comparison
        console.warn(`[WorkflowEditor] Cross-project from bridge check: ${id}`);
        isMismatch = true;
        crossProjectMismatch = true;
        // Still show the NEW thumbnail (from current project) but with warning
        thumbSrc = cached?.thumbnail;
      } else {
        // Check DOM (won't find anything in popup, but keep for sidebar context).
        // 2026-05-31 v3: pattern parity với _loadResultGalleryThumbnails — ưu tiên <video>
        // trước (video tile có thể có cả <img> + <video>, lấy video src để render <video>
        // element thay vì placeholder static).
        const tiles = document.querySelectorAll(`[data-tile-id="${id}"]`);
        let domFileName = null;
        let domThumbSrc = null;
        let domIsVideo = false;
        let domVideoSrc = null;

        for (const tile of tiles) {
          domFileName = this._extractFileNameFromTile(tile);
          // Check <video> FIRST — Flow video tile có src direct dùng được trong <video>
          const videoEl = tile.querySelector('video');
          if (videoEl?.src) {
            domVideoSrc = videoEl.src;
            domIsVideo = true;
            break;
          }
          const imgEl = tile.querySelector('img');
          if (imgEl?.src) {
            domThumbSrc = imgEl.src;
            domIsVideo = false;
            break;
          }
          // Fallback: tile có <video> element không src → đánh marker để render placeholder
          if (this._isVideoTile(tile)) {
            domIsVideo = true;
          }
        }
        // Cập nhật cache type='video' + video_url để lần render sau (workflow reload) có sẵn signal
        if (domIsVideo && cached && (cached.type !== 'video' || (domVideoSrc && !cached.video_url))) {
          this._tileCacheSet(id, { ...cached, type: 'video', ...(domVideoSrc && { video_url: domVideoSrc }) });
        }

        // Cross-project detection for new workflows with ref_file_names
        // Skip for import keys — they're pending uploads from CDN, not cross-project refs
        if (expectedFileName && !isImportKey) {
          if (domFileName && domFileName !== expectedFileName) {
            console.warn(`[WorkflowEditor] Cross-project collision (expected): tile_id=${id}, expected=${expectedFileName}, actual=${domFileName}`);
            isMismatch = true;
            crossProjectMismatch = true;
          } else if (cached?.file_name && cached.file_name !== expectedFileName) {
            console.warn(`[WorkflowEditor] Cross-project collision (cached): tile_id=${id}, expected=${expectedFileName}, cached=${cached.file_name}`);
            isMismatch = true;
            crossProjectMismatch = true;
          }
        }

        // Use DOM thumbnail if available and not mismatch, else fallback to cache
        if (!isMismatch) {
          if (domThumbSrc) {
            thumbSrc = domThumbSrc;
          } else if (cached?.thumbnail) {
            thumbSrc = cached.thumbnail;
          }
        } else {
          // Show NEW thumbnail with warning
          thumbSrc = cached?.thumbnail;
        }
      }

      if ((!thumbSrc && !isPending) || isMismatch) hasMissing = true;

      // Show warning indicator for cross-project mismatch
      // S2.5: Check upload trạng thái
      const isUploading = isPending && window.ImmediateUploader?.isUploading(id);
      const isExceeded = index >= refLimit;

      // Border color theo state:
      //   - mismatch (cross-project): destructive (đỏ)
      //   - uploading: primary brand (đồng bộ với spinner uploading)
      //   - pending import key: primary blue
      //   - pending local (chưa upload): warning amber
      //   - default: border subtle
      const borderColor = isMismatch
        ? 'var(--destructive,#dc2626)'
        : (isUploading
            ? 'var(--primary,#3d6ff5)'
            : (isPending
                ? (isImportKey ? 'var(--primary,#3b82f6)' : 'var(--warning,#f59e0b)')
                : 'var(--border,#1e3050)'));
      const mismatchLabel = isMismatch ? '<div style="position:absolute;bottom:0;left:0;right:0;background:var(--destructive,#dc2626);color:#fff;font-size:6px;text-align:center;line-height:1.4;border-radius:0 0 6px 6px;z-index:5;">Sai project</div>' : '';

      // Cross-project: show gradient sweep animation with warning icon (don't show cached thumbnail)
      const crossProjectIcon = isMismatch ? `
        <svg class="cross-project-icon" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--destructive,#dc2626);opacity:0.7;z-index:1;" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>` : '';

      const exceededTitle = isExceeded ? ` title="${window.I18n?.t('workflow.refExceededTitle', { limit: refLimit }) || `Vượt giới hạn (tối đa ${refLimit} ảnh) — sẽ không được gửi kèm prompt`}"` : '';
      const uploadingLabel = window.I18n?.t('workflow.uploading') || 'Uploading';
      const uploadingDataAttr = isUploading ? ` data-upload-label="${this.escapeAttr(uploadingLabel)}" title="${this.escapeAttr(uploadingLabel + '...')}"` : '';
      // 2026-05-31 v4: detect video tile — KHÔNG còn yêu cầu !thumbSrc (trước: nếu cache có
      // thumbnail = Flow API video URL → isVideoFile=false → render <img> broken).
      // 3 signals video (any match → video tile):
      //   1. file_name có extension .mp4/.webm/.mov/.m4v
      //   2. cached.type === 'video' (ImagePickerModal/scan set khi pick từ Flow)
      //   3. DOM tile có <video> element (workflow loaded từ DB)
      const fileName = expectedFileName || cached?.file_name || '';
      // 2026-05-31 v5: detect video CHỈ qua type='video' / extension / DOM <video> element.
      // BỎ thumbIsVideoUrl detect — Flow `getMediaUrlRedirect` URL dùng chung image + video → ambiguous!
      const isVideoTile = (
        /\.(mp4|webm|mov|m4v)$/i.test(fileName) ||
        cached?.type === 'video' ||
        (typeof domIsVideo !== 'undefined' && domIsVideo)
      );
      // Best video URL nguồn: DOM <video src> > cached.video_url
      const videoSrcForRender = (typeof domVideoSrc !== 'undefined' && domVideoSrc)
        || cached?.video_url
        || '';
      // useVideoElement: chỉ render <video> nếu là video tile + có URL hợp lệ.
      const useVideoElement = isVideoTile && !!videoSrcForRender;
      // useImgElement: image tile có thumbnail. Bao gồm video tile có poster image.
      const useImgElement = !useVideoElement && thumbSrc;
      const videoMediaHtml = useVideoElement
        ? `<video src="${this._safeMediaSrc(videoSrcForRender)}" muted loop autoplay playsinline style="width:100%;height:100%;object-fit:cover;display:block;"></video>`
        : (isVideoTile
          ? `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(99,102,241,0.08);color:var(--primary,#6366f1);">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>`
          : '');
      // 2026-05-31 Rescan Tier 2: broken state — chỉ khi KHÔNG render được gì (no img, no video).
      const isBroken = !useImgElement && !useVideoElement && !isVideoTile && !isPending && !isMismatch;
      const isPermanentlyBroken = isBroken && cached?._permanently_broken;
      const brokenContent = isBroken ? (isPermanentlyBroken ? `
        <div class="ref-thumb-broken" title="${this.escapeAttr(window.I18n?.t('workflow.thumbDeletedWarning') || 'Tile đã bị xóa khỏi Flow')}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--destructive,#dc2626)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span class="ref-thumb-broken-id">${id.substring(0, 8)}</span>
        </div>` : `
        <div class="ref-thumb-broken">
          <svg class="ref-thumb-broken-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span class="ref-thumb-broken-id">${id.substring(0, 8)}</span>
          <button class="ref-thumb-rescan-btn" data-ref-rescan-id="${this.escapeAttr(id)}" title="${this.escapeAttr(window.I18n?.t('workflow.thumbBrokenRescan') || 'Rescan từ Flow')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
        </div>`) : '';
      return `
        <div class="ref-thumb ${isPending ? 'ref-thumb-pending' : ''} ${isUploading ? 'ref-thumb-uploading' : ''} ${isMismatch ? 'ref-thumb-cross-project' : ''} ${isExceeded ? 'ref-thumb-exceeded' : ''}" data-ref-id="${this.escapeAttr(id)}"${uploadingDataAttr}${exceededTitle}>
          <div style="width:100%;height:100%;border-radius:6px;overflow:hidden;border:2px solid ${borderColor};position:relative;">
            ${isMismatch ? '' : (useVideoElement ? videoMediaHtml : (useImgElement ? `<img src="${this._safeMediaSrc(thumbSrc)}" alt="ref" style="width:100%;height:100%;object-fit:cover;display:block;" />` : (isVideoTile ? videoMediaHtml : brokenContent)))}
            ${crossProjectIcon}
            ${isPending ? `<div class="ref-thumb-badge" style="position:absolute;bottom:0;left:0;right:0;background:${isImportKey ? 'var(--primary,#3b82f6)' : 'var(--warning,#f59e0b)'};color:#000;font-size:7px;text-align:center;line-height:1.4;border-radius:0 0 4px 4px;z-index:5;">${isImportKey ? 'Import' : 'Local'}</div>` : ''}
            ${mismatchLabel}
          </div>
          <button class="ref-thumb-remove" title="${window.I18n?.t('workflow.removeThisImage') || 'Xóa ảnh này'}" style="position:absolute;top:-4px;right:-4px;width:18px;height:18px;border-radius:50%;background:var(--destructive,#dc2626);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;line-height:1;z-index:10;border:none;padding:0;">×</button>
        </div>`;
    }).join('');

    // 2026-05-31 Rescan Tier 2: bind click handler cho rescan buttons (sau khi innerHTML set)
    previewEl.querySelectorAll('[data-ref-rescan-id]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const refId = btn.dataset.refRescanId;
        if (!refId) return;
        await this._rescanRefThumbnail(refId, btn);
      });
    });

    // Reactive video detect: <img> load fail = URL trả mp4 bytes (video tile) →
    // swap sang <video> + heal cache để render sau dùng <video> trực tiếp.
    previewEl.querySelectorAll('.ref-thumb img').forEach(img => {
      if (img._errBound) return;
      img._errBound = true;
      img.addEventListener('error', () => {
        const refThumb = img.closest('[data-ref-id]');
        const tileId = refThumb?.dataset.refId;
        const url = img.src;
        if (!tileId || !url) return;
        const video = document.createElement('video');
        video.src = url;
        video.muted = true; video.playsInline = true; video.preload = 'metadata';
        video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;background:#0c1320;';
        video.addEventListener('loadedmetadata', () => { try { video.currentTime = 0.1; } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_renderNodeRefPreviewInner', _); } }, { once: true });
        img.parentNode?.replaceChild(video, img);
        this._tileCacheSet(tileId, { ...(this._tileCache.get(tileId) || {}), type: 'video', video_url: url });
      }, { once: true });
    });

    // Retry nếu tile chưa có thumbnail (vừa upload xong)
    if (hasMissing && retryCount < 3) {
      setTimeout(() => {
        const currentValue = fileIdsInput?.value || '';
        if (currentValue) this._renderNodeRefPreview(currentValue, { containerSelector, retryCount: retryCount + 1, refFileNames });
      }, 1500);
    } else if (hasMissing && retryCount >= 3 && !this._missingRefWarned && !this.isReadOnly()) {
      // Skip warning cho admin preview / shared preview - chỉ xem, không cần cảnh báo
      this._missingRefWarned = true;
      const missingCount = ids.filter(id => {
        if (id.startsWith('upload_')) return false;
        if (this._tileCache.has(id)) return false;
        const tiles = document.querySelectorAll(`[data-tile-id="${id}"]`);
        return tiles.length === 0;
      }).length;

      if (crossProjectMismatch && !this._crossProjectWarned) {
        this._crossProjectWarned = true;
        window.customDialog?.alert(
          window.I18n?.t('workflow.crossProjectRefDetected') || 'Phát hiện ảnh tham chiếu từ project khác. Tile ID trùng nhưng file khác. Hãy chọn lại ảnh từ project hiện tại.',
          { title: window.I18n?.t('workflow.wrongProject') || 'Sai project', type: 'error' }
        );
      } else if (missingCount > 0) {
        window.customDialog?.alert(
          window.I18n?.t('workflow.missingRefImages', { count: missingCount }) || `${missingCount} reference images not found on Flow. Images may have been deleted or session changed. Check and reselect if needed.`,
          { title: window.I18n?.t('workflow.missingRefTitle') || 'Missing reference images', type: 'warning' }
        );
      }
    }

    // Event delegation: bind 1 lần duy nhất trên container, không bị mất khi retry re-render
    if (!previewEl._refRemoveDelegated) {
      previewEl._refRemoveDelegated = true;
      previewEl.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.ref-thumb-remove');
        if (!removeBtn) return;
        e.stopPropagation();
        e.preventDefault();
        const thumb = removeBtn.closest('.ref-thumb');
        const removeId = thumb?.dataset.refId;
        if (removeId && fileIdsInput) {
          const currentIds = fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
          const filtered = currentIds.filter(id => id !== removeId);
          fileIdsInput.value = filtered.join(', ');
          if (removeId.startsWith('upload_')) {
            if (window.ImmediateUploader) ImmediateUploader.cancel(removeId);
            else window.pendingUploadFiles?.delete(removeId);
            this._formUploadKeys?.delete(removeId);
          }
          this._renderNodeRefPreview(fileIdsInput.value, containerSelector);
        }
      });
    }
  }

  /**
   * S2.5: Sync upload_xxx key → real tile_id sau khi ImmediateUploader upload xong
   * @param {Object} data - {key, tile_id, file_name, thumbnail_url}
   */
  _syncUploadKeyToTileId(data) {
    const { key, tile_id, file_name, thumbnail_url } = data;

    // Bug fix: Trước đây chỉ check #nodeRefFileIds (generate node) → ChatGPT/Grok/Prompt
    // node có riêng input ID (#chatgptImageRefFileIds, #grokNodeRefFileIds, #promptNodeRefFileIds)
    // → upload xong nhưng input value vẫn chứa upload_xxx key → ref preview render gradient sweep forever.
    // Sửa: scan TẤT CẢ ref input candidates, update bất kỳ input nào chứa upload key.
    const refInputSelectors = [
      '#nodeRefFileIds',
      '#chatgptImageRefFileIds',
      '#grokNodeRefFileIds',
      '#promptNodeRefFileIds',
    ];
    let fileIdsInput = null;
    for (const sel of refInputSelectors) {
      const inp = this.overlay?.querySelector(sel);
      if (!inp) continue;
      const ids = inp.value.split(',').map(s => s.trim()).filter(Boolean);
      const idx = ids.indexOf(key);
      if (idx !== -1) {
        ids[idx] = tile_id;
        inp.value = ids.join(', ');
        fileIdsInput = inp;
      }
    }
    // Remove from tracking
    this._formUploadKeys.delete(key);
    // Transfer thumbnail cache: upload_key → tile_id (giống GenTab pattern)
    const oldCache = this._tileCache.get(key);
    if (oldCache) {
      this._tileCacheSet(tile_id, oldCache);
      this._tileCache.delete(key);
    }
    // Override bằng thumbnail_url từ Flow nếu có
    if (thumbnail_url) {
      this._tileCacheSet(tile_id, { thumbnail: thumbnail_url, file_name: file_name || '', type: 'image' });
    }
    // Đảm bảo file_name được cập nhật
    if (file_name) {
      const cached = this._tileCache.get(tile_id);
      if (cached) cached.file_name = file_name;
    }
    // Cleanup pendingUploadFiles
    window.pendingUploadFiles?.delete(key);
    // Cleanup ImmediateUploader results (tránh memory leak)
    if (window.ImmediateUploader) {
      ImmediateUploader._results.delete(key);
      ImmediateUploader._fileRefs.delete(key);
    }
    // Cache trong TileCache
    if (window.TileCache) {
      if (file_name) window.TileCache.set(file_name, tile_id);
      if (thumbnail_url) window.TileCache.set(thumbnail_url, tile_id);
    }
    // Sync frame file ID inputs nếu upload key match
    for (const fNum of [1, 2]) {
      const frameInput = this.overlay?.querySelector(`#frame${fNum}FileId`);
      if (frameInput && frameInput.value === key) {
        frameInput.value = tile_id;
        const thumb = thumbnail_url || this._tileCache.get(tile_id)?.thumbnail || '';
        this._renderFramePreview(fNum, tile_id, thumb);
      }
    }
    // CRITICAL: Update node.data.ref_file_ids trong Drawflow editor (không chỉ DOM input)
    // Trước fix: chỉ update DOM input → node.data vẫn giữ upload_xxx key → re-render
    // hoặc save node sẽ dùng lại key cũ → Local badge vẫn hiện sau upload xong.
    // Bug fix: Dùng _formNodeId (node có form đang mở) thay vì _currentEditNodeId (không tồn tại).
    if (this._formNodeId && this.diagramCanvas?.editor) {
      const drawflowId = this._formNodeId;
      const nodeObj = this.diagramCanvas.editor.getNodeFromId(drawflowId);
      if (nodeObj?.data?.ref_file_ids) {
        const dataIds = nodeObj.data.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean);
        const dataIdx = dataIds.indexOf(key);
        if (dataIdx !== -1) {
          dataIds[dataIdx] = tile_id;
          nodeObj.data.ref_file_ids = dataIds.join(', ');
        }
      }
    }

    // Re-render node ref preview (dùng đúng container cho node type hiện tại)
    this._renderNodeRefPreview(fileIdsInput?.value || '', this._getRefPreviewSelector());

    // CRITICAL: Re-persist ref_file_names vào node data sau khi ImmediateUploader hoàn thành
    // Nếu không, file_names từ upload mới sẽ bị mất khi save workflow
    if (this._formNodeId && this.diagramCanvas?.editor) {
      const drawflowId = this._formNodeId;
      const nodeObj = this.diagramCanvas.editor.getNodeFromId(drawflowId);
      if (nodeObj?.data) {
        this._persistRefThumbnails(drawflowId, nodeObj.data);
        this._deferredThumbnailSave();
      }
    }

    console.log(`[WorkflowEditor] Synced upload key → tile_id: ${key.substring(0, 15)}... → ${tile_id.substring(0, 15)}...`);
  }

  /**
   * Sync upload_xxx → tile_id cho TẤT CẢ nodes trong workflow (không phụ thuộc form state).
   * Bug fix: Trước đây chỉ sync khi form đang mở và key trong _formUploadKeys.
   * Nếu user switch form trước khi upload xong → _formUploadKeys cleared → không sync.
   * @param {Object} data - {key, tile_id, file_name, thumbnail_url}
   */
  _syncUploadKeyToAllNodes(data) {
    const { key, tile_id, file_name, thumbnail_url } = data;
    if (!key || !tile_id || !this.diagramCanvas?.editor) return;

    // CRITICAL: Drawflow's `getNodeFromId` AND `export()` ĐỀU return DEEP CLONE
    // (JSON.parse(JSON.stringify(...))). Mutation trực tiếp KHÔNG persist vào live state.
    // Phải dùng `editor.updateNodeDataFromId(drawflowId, newData)` để persist.
    // Trước fix: paste image upload xong nhưng node data vẫn giữ upload_xxx →
    // node loading mãi vì preview re-render đọc state cũ + ref preview vẫn label Local.
    const editor = this.diagramCanvas.editor;
    const homeData = editor.drawflow?.drawflow?.Home?.data || {};
    let updatedCount = 0;

    for (const [drawflowId, nodeInfo] of Object.entries(homeData)) {
      const currentData = nodeInfo?.data;
      if (!currentData?.ref_file_ids) continue;

      const ids = currentData.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean);
      const idx = ids.indexOf(key);
      if (idx === -1) continue;

      // Build new data (shallow clone + replace key)
      ids[idx] = tile_id;
      const newRefIds = ids.join(', ');

      const newRefThumbnails = { ...(currentData.ref_thumbnails || {}) };
      // Giữ thumbnail dataURL local nếu server không trả thumbnail_url
      const existingThumb = newRefThumbnails[key];
      newRefThumbnails[tile_id] = thumbnail_url || existingThumb;
      delete newRefThumbnails[key];

      const newRefFileNames = { ...(currentData.ref_file_names || {}) };
      if (file_name) {
        newRefFileNames[tile_id] = file_name;
      } else if (newRefFileNames[key]) {
        newRefFileNames[tile_id] = newRefFileNames[key];
      }
      delete newRefFileNames[key];

      const newData = {
        ...currentData,
        ref_file_ids: newRefIds,
        ref_thumbnails: newRefThumbnails,
        ref_file_names: newRefFileNames,
      };

      // Persist qua Drawflow API (mutate live state)
      try {
        editor.updateNodeDataFromId(drawflowId, newData);
      } catch (err) {
        console.warn('[WorkflowEditor] updateNodeDataFromId failed:', err?.message);
        continue;
      }

      // Update _tileCache
      this._tileCacheSet(tile_id, {
        thumbnail: thumbnail_url || this._tileCache.get(key)?.thumbnail || existingThumb || '',
        file_name: file_name || this._tileCache.get(key)?.file_name || '',
        type: 'image'
      });

      updatedCount++;
      console.log(`[WorkflowEditor] _syncUploadKeyToAllNodes: updated node ${drawflowId}, key=${key.substring(0, 15)}... → tile_id=${tile_id.substring(0, 15)}...`);
    }

    // Cleanup old key from caches
    if (updatedCount > 0) {
      this._tileCache.delete(key);
      window.pendingUploadFiles?.delete(key);
      if (window.ImmediateUploader) {
        ImmediateUploader._results?.delete(key);
        ImmediateUploader._fileRefs?.delete(key);
      }
    }
  }

  /**
   * Trả về container selector cho ref preview dựa trên node type hiện tại.
   * Mỗi provider có riêng container ID:
   *   - generate (default) / image  → #nodeRefImagesPreview / #imageNodeRefPreview
   *   - chatgpt                      → #chatgptImageRefPreview
   *   - grok                         → #grokNodeRefPreview
   *   - prompt                       → #promptNodeRefPreview
   */
  _getRefPreviewSelector() {
    const t = this._currentFormNodeType;
    if (t === 'image') return '#imageNodeRefPreview';
    if (t === 'chatgpt') return '#chatgptImageRefPreview';
    if (t === 'grok') return '#grokNodeRefPreview';
    if (t === 'prompt') return '#promptNodeRefPreview';
    return '#nodeRefImagesPreview';
  }

  /**
   * Check nếu có upload đang chạy trong form
   * @returns {number} Số lượng uploads đang active
   */
  _countActiveFormUploads() {
    if (!this._formUploadKeys?.size || !window.ImmediateUploader) return 0;
    let count = 0;
    for (const key of this._formUploadKeys) {
      if (ImmediateUploader.isUploading(key)) count++;
    }
    return count;
  }

  /**
   * Disable/enable nút Lưu và Đóng khi đang upload ảnh
   */
  _updateFormButtonState() {
    // Read-only mode: keep all buttons disabled
    if (this.isReadOnly()) return;

    const isUploading = this._countActiveFormUploads() > 0;
    const saveBtn = this.overlay?.querySelector('#saveNodeBtn');
    const closeBtn = this.overlay?.querySelector('#closeNodeFormBtn2');
    if (saveBtn) {
      saveBtn.disabled = isUploading;
      saveBtn.title = isUploading ? (window.I18n?.t('workflow.uploadingRefImages') || 'Uploading reference images...') : '';
      saveBtn.textContent = isUploading
        ? (window.I18n?.t('workflow.uploading') || 'Uploading...')
        : (window.I18n?.t('workflow.saveNode') || 'Lưu Node');
    }
    if (closeBtn) {
      closeBtn.disabled = isUploading;
      closeBtn.title = isUploading ? (window.I18n?.t('workflow.uploadingRefImages') || 'Uploading reference images...') : '';
    }
  }

  async hideNodeForm({ skipUploadCheck = false, skipDirtySave = false } = {}) {
    // 2026-06-03: Clear pending auto-save timer khi form đóng — tránh save sau khi
    // selectedNodeId đã thay đổi (timer fire → _applyNodeFormData ghi nhầm node khác).
    if (this._formAutoSaveTimer) {
      clearTimeout(this._formAutoSaveTimer);
      this._formAutoSaveTimer = null;
    }
    // S2.5: Check uploads đang chạy → confirm trước khi đóng
    if (!skipUploadCheck) {
      const activeCount = this._countActiveFormUploads();
      if (activeCount > 0) {
        const confirmed = await window.customDialog?.confirm(
          window.I18n?.t('workflow.uploadCloseConfirm', { count: activeCount }) || `Uploading ${activeCount} reference images. Closing form will cancel upload. Continue?`,
          { title: window.I18n?.t('workflow.uploadInProgress') || 'Images uploading', type: 'warning', confirmText: window.I18n?.t('workflow.closeAndCancel') || 'Close and cancel', cancelText: window.I18n?.t('workflow.continueUpload') || 'Continue upload' }
        );
        if (!confirmed) return;
      }
    }

    // S2.5: Cleanup upload event listeners
    if (this._uploadStartedHandler) {
      window.eventBus?.off('upload:started', this._uploadStartedHandler);
      this._uploadStartedHandler = null;
    }
    if (this._uploadCompletedHandler) {
      window.eventBus?.off('upload:completed', this._uploadCompletedHandler);
      this._uploadCompletedHandler = null;
    }
    if (this._uploadFailedHandler) {
      window.eventBus?.off('upload:failed', this._uploadFailedHandler);
      this._uploadFailedHandler = null;
    }

    // Clear provider polling timers
    if (this._providerPollTimers) {
      for (const provider of Object.keys(this._providerPollTimers)) {
        clearTimeout(this._providerPollTimers[provider]);
      }
      this._providerPollTimers = {};
    }

    // S2.5: Cancel uploads chưa được lưu khi đóng form
    if (this._formUploadKeys?.size > 0) {
      // Lấy IDs đang trong form — nếu đã save thì không cancel
      const formInput = this.overlay?.querySelector('#nodeRefFileIds');
      const savedIds = new Set((formInput?.value || '').split(',').map(s => s.trim()).filter(Boolean));
      for (const key of this._formUploadKeys) {
        if (!savedIds.has(key)) {
          // Key không còn trong form (đã bị remove) — cancel
          if (window.ImmediateUploader) ImmediateUploader.cancel(key);
          else window.pendingUploadFiles?.delete(key);
        }
      }
      this._formUploadKeys.clear();
    }

    const panel = this.overlay?.querySelector('#nodeFormPanel');

    // Apply form data trước khi đóng để tránh mất changes
    // (vd user chỉnh resolution rồi đóng form → changes bị mất nếu không apply)
    // CHỈ apply nếu form panel đang visible - tránh overwrite inline pill changes
    // khi user chỉ click ra ngoài mà không mở form
    // Bug fix: KHÔNG apply trong read-only mode (template preview) - không có gì cần save
    // Bug fix 2: Dùng _formNodeId (node có form đang mở) thay vì selectedNodeId (node được select cuối)
    // Bug fix 3: KHÔNG apply khi node đang bị xóa (node không còn trong Drawflow)
    const applyToNodeId = this._formNodeId || this.selectedNodeId;
    if (applyToNodeId && panel && !panel.classList.contains('hidden') && !this.isReadOnly() && !this._nodeBeingDeleted) {
      // Verify node still exists before applying
      const dfId = this._findDrawflowId(applyToNodeId);
      // Bug fix 2026-05-27: CHỈ apply (→ re-render node → rescan thumbnail) khi form THỰC SỰ đổi.
      // Trước: apply mỗi lần đóng → node gen/chatgpt/grok re-render + rescan thumbnail vô ích dù
      // user không sửa gì (chỉ mở rồi đóng).
      // BUG FIX 2026-06-05 (Option 2 + Gap H): skipDirtySave param — KHÔNG persist khi caller
      // báo user EXPLICIT DISCARD (vd confirm "Bỏ thay đổi" / "Switch and cancel"). Default
      // false → force save (apply + saveWorkflow đồng bộ) để tránh race condition với reset
      // `_formNodeId=null` cuối method. Discard callers (line 8192/8234/8257/8277) pass
      // skipDirtySave: true để respect user intent.
      if (dfId && this.diagramCanvas?.editor?.getNodeFromId(dfId) && this._isFormDirty() && !skipDirtySave) {
        try {
          await this._persistOpenNodeFormIfDirty();
        } catch (e) {
          // _persistOpenNodeFormIfDirty không throw (catch internal line 10720+) nhưng
          // defense thêm — log warn, fallback apply in-memory để giữ behavior cũ.
          console.warn('[WorkflowEditor] hideNodeForm force-save failed:', e?.message);
          this._applyNodeFormData(applyToNodeId);
        }
      }
    }
    if (panel) {
      panel.classList.add('hidden');
    }
    this.selectedNodeId = null;
    this._formSnapshot = null;
    this._currentFormNodeType = null;
    this._formNodeId = null;
  }

  /**
   * Apply node form data to Drawflow (without closing form or saving workflow)
   * @param {string} [targetNodeId] - Optional: apply to specific node instead of selectedNodeId
   */

  /**
   * Re-render node previews after updateNodeData() replaces DOM.
   * updateNodeData → NodeTemplates.createNodeHTML → element.innerHTML = html
   * This destroys dynamic preview thumbnails rendered by _renderNodePreviewInner.
   * Uses _skipDeferredSave flag to avoid triggering another save cycle.
   */
  _restoreNodePreviewAfterUpdate(nodeId, nodeType) {
    const drawflowId = this._findDrawflowId(nodeId) || nodeId;
    const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    if (!node?.data) return;
    const data = node.data;

    // Restore status dot (updateNodeData regenerates template HTML → status dot loses class)
    if (data.status) {
      this._updateNodeStatusUI(data.node_id || nodeId, data.status);
    }

    // Re-inject corner gear button — element.innerHTML = html xóa nút gear đã append
    try { this._ensureNodeCornerGears(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_restoreNodePreviewAfterUpdate', e); }

    // Skip deferred save to avoid infinite save loop
    this._skipDeferredSave = true;

    try {
      // Result preview for completed nodes
      if (data.status === 'completed' && data.result_file_ids) {
        const fileIds = data.result_file_ids.split(',').map(s => s.trim()).filter(Boolean);
        if (fileIds.length > 0 && fileIds.some(id => this._tileCache.has(id))) {
          this._directRenderNodePreview(data.node_id || nodeId, fileIds);
        }
      }

      // Template mode hoặc template preview: render/clear result_img_url preview
      const isTemplateCtx = this.isTemplateMode || this.workflow?._is_template_preview || this.workflow?._isPreview;
      if (isTemplateCtx) {
        if (data.result_img_url) {
          // Có ảnh → render
          this._renderTemplateResultOnNode(data.node_id || nodeId, data.result_img_url);
        } else if (data.result_img_url === '') {
          // User đã xóa ảnh (empty string) → clear preview
          this._clearTemplateResultOnNode(data.node_id || nodeId);
        }
        // Nếu undefined → giữ nguyên placeholder từ NodeTemplates (không làm gì)

        // Template mode/preview: render ref images từ ref_img_urls
        if (data.ref_img_urls?.length > 0 || (data.ref_thumbnails && Object.keys(data.ref_thumbnails).length > 0)) {
          const refUrls = data.ref_img_urls || Object.values(data.ref_thumbnails || {});
          if (refUrls.length > 0) {
            this._renderTemplateRefOnNode(data.node_id || nodeId, refUrls);
          }
        }
      }

      // Image node: ref images as main preview (normal mode only)
      if (!isTemplateCtx && nodeType === 'image' && data.ref_file_ids) {
        const refIds = data.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean);
        if (refIds.length > 0) {
          this._directRenderNodePreview(data.node_id || nodeId, refIds);
        }
      }

      // Ref thumbnail at bottom of node card — render ngay sau apply form data.
      // Bug fix: trước chỉ 'generate' → ChatGPT/Grok/Prompt save ref images xong nhưng
      // footer node trên canvas KHÔNG hiện thumbnails (trống dưới prompt). Phải refresh khi
      // user edit ref qua form panel cho TẤT CẢ types accept image_ref.
      if (['generate', 'chatgpt', 'grok', 'prompt'].includes(nodeType) && data.ref_file_ids) {
        const refIds = data.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean);
        if (refIds.length > 0 && refIds.some(id => this._tileCache.has(id))) {
          this._directRenderNodeRefFromCache(data.node_id || nodeId, refIds);
        }
      }
    } finally {
      this._skipDeferredSave = false;
    }
    // Task 5.1: Emit để undo history schedule snapshot (debounced 400ms)
    // Bug fix: Use nodeId param instead of this.selectedNodeId for correct tracking
    try { window.eventBus?.emit('node:data_changed', { nodeId }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_restoreNodePreviewAfterUpdate', e); }
  }

  async saveNode() {
    // Read-only mode: không cho phép save
    if (this.isReadOnly()) return;

    try {
      // Capture node info before hiding form
      const savedNodeId = this.selectedNodeId;
      const node = savedNodeId ? this.diagramCanvas?.editor?.getNodeFromId(savedNodeId) : null;
      // Bug fix: Ưu tiên node.data.node_type (original) over node.class (có thể bị corrupt)
      const nodeType = node?.data?.node_type || node?.class || 'generate';

      // Snapshot port count BEFORE apply để detect dynamic visibility change (Issue #71-1)
      const oldPortsBefore = (typeof window.NodeTemplates?.getNodePorts === 'function')
        ? window.NodeTemplates.getNodePorts(nodeType, node?.data || {})
        : { in: [], out: [] };
      const oldInCount = (oldPortsBefore.in || []).length;
      const oldOutCount = (oldPortsBefore.out || []).length;

      // Save node data and update canvas
      this._applyNodeFormData();
      // S2.5: Uploads đã được lưu vào node — không cancel khi đóng form
      this._formUploadKeys?.clear();
      await this.hideNodeForm();

      // Auto-save workflow to persist node changes
      // Template mode: KHÔNG auto-save vì workflow chưa tồn tại trong DB, chỉ cập nhật Drawflow data
      if (!this.isTemplateMode) {
        // Wait for any concurrent save to finish
        if (this._isSaving) {
          const waitStart = Date.now();
          while (this._isSaving && Date.now() - waitStart < 5000) {
            await new Promise(r => setTimeout(r, 100));
          }
        }
        await this.saveWorkflow();
      } else {
        // Template mode: đánh dấu có thay đổi để user biết cần nhấn Save để lưu template
        this._hasUnsavedChanges = true;
        console.log('[WorkflowEditor] saveNode() - Template mode: skipped saveWorkflow(), marked unsaved');
      }

      // Re-fetch node data after save (updateNodeData may replace data reference)
      const updatedNode = savedNodeId ? this.diagramCanvas?.editor?.getNodeFromId(savedNodeId) : null;
      const nodeData = updatedNode?.data || node?.data;

      // Issue #71-1 (HIGH) RESOLVED: Dynamic visibility — auto resize port count runtime
      // qua Drawflow API addNodeInput/removeNodeInput, không cần re-create node.
      try {
        const newPorts = (typeof window.NodeTemplates?.getNodePorts === 'function')
          ? window.NodeTemplates.getNodePorts(nodeType, nodeData || {})
          : { in: [], out: [] };
        if (savedNodeId && this.diagramCanvas?._resizeNodePorts) {
          this.diagramCanvas._resizeNodePorts(savedNodeId, newPorts);
        }
        // Re-inject port attrs (data-port-type/required mới nhất)
        if (this.diagramCanvas?._injectPortAttributes && savedNodeId) {
          requestAnimationFrame(() => {
            this.diagramCanvas._injectPortAttributes(savedNodeId, newPorts);
            try { this._updatePortEmptyState(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#saveNode', e); }
            try { this._scheduleRefreshNodeWarningBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#saveNode', e); }
        try { this._refreshAllPromptSourceBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#saveNode', e); }
          });
        }

        // Re-validate edges sau khi save form — user có thể đổi mediaType từ form, cần gỡ edges incompat.
        // Idempotent + state-driven: chỉ gỡ edges thực sự incompat tại thời điểm gọi.
        if (savedNodeId) {
          try {
            const removedCount = this._revalidateNodeEdges(savedNodeId);
            if (removedCount > 0) {
              const msg = window.I18n?.t('workflow.edgesRemovedOnTypeChange', { count: removedCount })
                || `Đã gỡ ${removedCount} kết nối không tương thích sau khi đổi loại media`;
              if (typeof window.showNotification === 'function') {
                window.showNotification(msg, 'warning', 2500);
              }
              try { this.diagramCanvas?._recolorAllEdges?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#saveNode', e); }
            }
          } catch (e) {
            console.warn('[WorkflowEditor] Re-validate edges in saveNode failed:', e);
          }
        }

        // Connection paths phải recompute sau khi save form: ratio đổi → preview area resize,
        // mediaType=Video+Frames → thêm 2 frame ports, prompt enhance toggle → image_ref port hiện/ẩn.
        // Tất cả đều thay đổi tọa độ port DOM → edges bị lệch nếu không update.
        // Defer 2 frames cho CSS aspect-ratio + reflow settle (cùng pattern với inline pill change).
        try {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              try { this.diagramCanvas?._forceUpdateAllConnections?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#saveNode', e); }
            });
          });
        } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#saveNode', e); }
      } catch (e) {
        console.warn('[WorkflowEditor] Port resize failed:', e.message);
      }

      // Update image node preview on canvas after save
      if (nodeType === 'image' && nodeData) {
        if (this.isTemplateMode) {
          // Template mode: render từ ref_img_urls hoặc ref_thumbnails
          const refUrls = nodeData.ref_img_urls || Object.values(nodeData.ref_thumbnails || {});
          if (refUrls.length > 0) {
            this._showNodeRefPreviewFromUrls(nodeData.node_id, refUrls);
          } else {
            this._clearNodeRefPreview(nodeData.node_id);
          }
        } else {
          // Normal mode: render từ ref_file_ids
          const refIds = (nodeData.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          if (refIds.length > 0) {
            this._showNodePreview(nodeData.node_id, refIds);
          } else {
            this._clearNodePreview(nodeData.node_id);
          }
        }
      }

      // Update ref image thumbnails cho các node accept image_ref input.
      // Bug fix: trước fix chỉ 'generate' → ChatGPT/Grok add ref images không hiện preview
      // trên node card diagram. Giờ apply cho TẤT CẢ node types có image_ref input port.
      // Bug fix 2: Template mode dùng ref_img_urls/ref_thumbnails thay vì ref_file_ids
      if (['generate', 'chatgpt', 'grok'].includes(nodeType) && nodeData) {
        if (this.isTemplateMode) {
          // Template mode: render từ ref_img_urls hoặc ref_thumbnails
          const refUrls = nodeData.ref_img_urls || Object.values(nodeData.ref_thumbnails || {});
          if (refUrls.length > 0) {
            this._showNodeRefPreviewFromUrls(nodeData.node_id, refUrls);
          } else {
            this._clearNodeRefPreview(nodeData.node_id);
          }
        } else {
          // Normal mode: render từ ref_file_ids
          const refIds = (nodeData.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          this._showNodeRefPreview(nodeData.node_id, refIds);
        }
      }

      // Persist ref image thumbnails for all node types that have ref_file_ids
      if (nodeData?.ref_file_ids && savedNodeId) {
        this._persistRefThumbnails(savedNodeId, nodeData);
        // Deferred save to persist ref_thumbnails (set after initial saveWorkflow)
        this._deferredThumbnailSave();
      }

      // Fire-and-forget: proactive cache ref image blobs cho node vua save
      if (nodeData?.ref_file_ids) {
        this._cacheNodeRefImageBlobs(nodeData).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#handleEdgeCreated', _e); });
      }
    } catch (error) {
      console.error('[SEOSONA Flow] saveNode failed:', error);

      // Quota error modal already shown by ApiStorage._handleQuotaError
      if (error.code !== 'QUOTA_EXCEEDED' && !error.message?.includes('giới hạn')) {
        window.customDialog?.alert((window.I18n?.t('workflow.saveNodeError') || 'Lỗi khi lưu node') + ': ' + error.message, { type: 'error' });
      }
    }
  }

  /**
   * 2026-06-03: Persist form values mở hiện tại vào drawflow + DB MÀ KHÔNG đóng form.
   * Khác `saveNode()` (full save + hide form) — method này dùng cho 2 use cases:
   *  1. Auto-save on input event (Option A) — silent, debounced
   *  2. Pre-run save (Option B) — gọi trước `_runSingleNode` để đảm bảo data fresh
   *
   * Bug fix: trước đó user edit prompt textarea + click Run mà chưa click "Lưu Node"
   * → drawflow không có giá trị mới → DB lưu prompt cũ → run dùng prompt cũ.
   *
   * Skip nếu: form không mở, read-only, template mode.
   * Concurrent save: wait nếu có save khác đang chạy (giống saveNode).
   *
   * @returns {Promise<boolean>} true nếu đã persist, false nếu skip
   */
  /**
   * 2026-06-03: Persist pending changes vào DB TRƯỚC khi run.
   *
   * @param {string|null} [runningDrawflowId] - Drawflow ID của node user đang run (null = không phải pre-run context)
   *
   * Bug fix 2026-06-03: Trước đó helper luôn `_applyNodeFormData()` khi `selectedNodeId` truthy.
   * Nhưng nếu form đang mở là node KHÁC node user run → helper apply form của node sai →
   * validation có thể throw (vd slug conflict) → catch nuốt → saveWorkflow SKIP → DB stale.
   * Fix: chỉ `_applyNodeFormData` khi form đang mở CHO CHÍNH node user run.
   * Trong các trường hợp khác (form khác node + inline edit pending) → chỉ saveWorkflow.
   */
  async _persistOpenNodeFormIfDirty(runningDrawflowId = null) {
    if (this.isReadOnly() || this.isTemplateMode) return false;
    if (!this.diagramCanvas?.editor) return false;
    // Bug fix 2026-06-03: dùng _formNodeId (track chính xác form open) + check panel visibility,
    // KHÔNG dùng !!selectedNodeId. Lý do: Drawflow set selectedNodeId khi user right-click
    // highlight node (kể cả form đã đóng) → false positive hasFormOpen → _applyNodeFormData
    // đọc stale DOM input (vd #grokNodeMode='image' còn lưu từ session cũ) → overwrite
    // inline pill changes (vd user vừa đổi inline grokMode='video' → bị reset 'image').
    const formPanel = this.overlay?.querySelector('#nodeFormPanel');
    const isPanelVisible = !!formPanel && !formPanel.classList.contains('hidden');
    const formOpenNodeId = this._formNodeId;
    const hasFormOpen = isPanelVisible && !!formOpenNodeId;
    const hasInlinePending = !!this._inlinePromptSaveTimer;
    const hasFormPending = !!this._formAutoSaveTimer;
    if (!hasFormOpen && !hasInlinePending && !hasFormPending) return false;

    // Cancel pending debouncers — sẽ persist ngay
    if (this._inlinePromptSaveTimer) {
      clearTimeout(this._inlinePromptSaveTimer);
      this._inlinePromptSaveTimer = null;
    }
    if (this._formAutoSaveTimer) {
      clearTimeout(this._formAutoSaveTimer);
      this._formAutoSaveTimer = null;
    }

    // Apply form data logic:
    //   - Form auto-save context (runningDrawflowId=null): ALWAYS apply form khi mở
    //     → Option A debounce auto-sync form values vào drawflow
    //   - Pre-run context (runningDrawflowId truthy):
    //     - Cùng node form-open: apply (user save trước khi chạy node này)
    //     - Khác node: SKIP apply (tránh validation throw cho node user không chạy)
    const shouldApplyForm = hasFormOpen && (
      !runningDrawflowId
      || String(formOpenNodeId) === String(runningDrawflowId)
    );
    console.log('[WorkflowEditor] _persistOpenNodeFormIfDirty:', {
      runningDrawflowId,
      formOpenNodeId,
      selectedNodeId: this.selectedNodeId,
      isPanelVisible,
      hasFormOpen,
      hasInlinePending,
      hasFormPending,
      shouldApplyForm,
    });
    if (shouldApplyForm) {
      try {
        // Pass explicit target — KHÔNG fallback selectedNodeId (có thể là node khác do
        // right-click highlight). _formNodeId mới chính xác trỏ node có form đang mở.
        this._applyNodeFormData(formOpenNodeId);
      } catch (applyErr) {
        // _applyNodeFormData throw khi validation fail (vd slug conflict).
        // Log warning + tiếp tục saveWorkflow (drawflow vẫn có inline edits cần persist).
        console.warn('[WorkflowEditor] _applyNodeFormData failed during pre-run sync:', applyErr?.message);
      }
    }

    try {
      // Wait concurrent save (pattern same as saveNode line 10441-10445)
      if (this._isSaving) {
        const waitStart = Date.now();
        while (this._isSaving && Date.now() - waitStart < 5000) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
      await this.saveWorkflow();
      return true;
    } catch (e) {
      console.warn('[WorkflowEditor] _persistOpenNodeFormIfDirty saveWorkflow failed:', e?.message);
      return false;
    }
  }

  async deleteNode() {
    if (!this.selectedNodeId || !this.diagramCanvas) return;
    if (this.isReadOnly()) return;

    const ok = await window.customDialog.confirm(window.I18n?.t('workflow.deleteNodeConfirm') || 'Bạn có chắc muốn xóa node này?', { title: window.I18n?.t('workflow.deleteNode') || 'Xóa node' });
    if (ok) {
      this.diagramCanvas.removeNode(this.selectedNodeId);
      // Xóa node → force close form (không cần confirm upload)
      // [Gap H 2026-06-05] Node deleted → skipDirtySave defense
      this._formUploadKeys?.clear();
      await this.hideNodeForm({ skipDirtySave: true });
    }
  }

  handleEdgeCreated(connection, sourcePort, targetPort) {
    // Phase WK-1.3.5: cache port names theo cặp (output_id, output_class, input_id, input_class)
    // exportWorkflow đọc cache này để gắn source_port/target_port vào edge data khi save
    if (!this._edgePortCache) this._edgePortCache = new Map();
    if (connection && sourcePort && targetPort) {
      const key = `${connection.output_id}:${connection.output_class}->${connection.input_id}:${connection.input_class}`;
      this._edgePortCache.set(key, { sourcePort, targetPort });
    }

    // Bug fix 2026-05-20: auto-switch prompt_source='textbox' → 'upstream_node' khi user
    // connect Prompt/Text node vào port "text" của generate/chatgpt/grok node với textbox rỗng.
    // Trước fix: prompt_source giữ default 'textbox' → save persist stale → runtime
    // submit empty prompt → Flow redirect homepage / ChatGPT silent. Fix gốc tại UI để
    // KHÔNG tạo stale data, các layer downstream (runtime/bulk-save/migration) là safety net.
    try {
      if (!connection || !targetPort || (targetPort !== 'text' && targetPort !== 'default')) return;
      const editor = this.diagramCanvas?.editor;
      if (!editor) return;
      const targetNode = editor.getNodeFromId(connection.input_id);
      const sourceNode = editor.getNodeFromId(connection.output_id);
      if (!targetNode?.data || !sourceNode?.data) return;
      const targetType = targetNode.data.node_type || targetNode.class;
      const sourceType = sourceNode.data.node_type || sourceNode.class;
      if (!['generate', 'chatgpt', 'grok'].includes(targetType)) return;
      // 2026-05-31: thêm text_extract làm valid upstream — node này output text result cho
      // downstream gen/chatgpt/grok dùng làm prompt (parity với prompt/text nodes).
      if (!['prompt', 'text', 'text_extract', 'text_template', 'random_pick', 'prompt_sequence', 'variant_expand', 'loop'].includes(sourceType)) return;
      if (targetNode.data.prompt_source !== 'textbox') return;
      if ((targetNode.data.prompt || '').trim()) return;
      // Skip nếu form đang mở cho chính target node — tránh phá state user đang edit
      if (this.selectedNodeId && String(this.selectedNodeId) === String(connection.input_id)) {
        console.warn(`[WorkflowEditor] Skip auto-switch prompt_source: form đang mở cho node "${targetNode.data.node_name}" (user tắt toggle "Use own prompt" thủ công nếu muốn)`);
        return;
      }
      // All conditions match → switch
      editor.updateNodeDataFromId(connection.input_id, {
        ...targetNode.data,
        prompt_source: 'upstream_node',
      });
      console.log(`[WorkflowEditor] Auto-switch prompt_source: 'textbox' → 'upstream_node' cho node "${targetNode.data.node_name}" (connected Prompt/Text vào port text)`);
    } catch (e) {
      console.warn('[WorkflowEditor] Auto-switch prompt_source failed:', e?.message);
    }
  }

  handleEdgeRemoved(connection) {
    if (this._edgePortCache && connection) {
      const key = `${connection.output_id}:${connection.output_class}->${connection.input_id}:${connection.input_class}`;
      this._edgePortCache.delete(key);
    }
  }

  handleNodeRemoved(nodeId) {
    if (String(this.selectedNodeId) === String(nodeId)) {
      // Node bị xóa → force close form (bypass unsaved changes dialog)
      // Note: _handleNodeUnselected may have already closed the form if it fired first
      // [Gap H 2026-06-05] Node deleted → KHÔNG có gì để save → skipDirtySave defense
      this._formUploadKeys?.clear();
      this.hideNodeForm({ skipUploadCheck: true, skipDirtySave: true });
    }
  }

  /**
   * Sync server-side mutations từ bulk-save response về lại editor.
   *
   * Backend có thể mutate các fields (rename slug, heal prompt_source, clear garbage).
   * Generic whitelist patch + cập nhật UI affected:
   *   - drawflow node data (editor.updateNodeDataFromId)
   *   - local nodes array (cho saveWorkflow lần sau dùng đúng)
   *   - form đang mở (toggle/input DOM nếu node bị patch là node đang select)
   *   - mention chips trong downstream prompts (regex replace @old_slug → @new_slug)
   *   - badges + inline pills (re-render)
   *   - Toast user
   *
   * @param {object} _saveResult Response từ saveWorkflowFull (đã unwrap data)
   * @param {array} nodes Local nodes array (sẽ được patch in-place)
   */
  _syncServerNodesIntoEditor(_saveResult, nodes) {
    const serverNodes = Array.isArray(_saveResult?.nodes) ? _saveResult.nodes : [];
    if (serverNodes.length === 0 || !this.diagramCanvas?.editor) return;

    // Fields server có thể mutate (generic whitelist — dùng hasOwnProperty để
    // phân biệt explicit null vs missing field)
    const SERVER_MUTABLE_FIELDS = [
      'slug', 'slug_auto', 'prompt_source',
      'prompt_mode', 'ref_mode',
      'video_duration', 'delay_seconds',
      'provider', // cross-field validate có thể fix
    ];

    const editor = this.diagramCanvas.editor;
    const moduleData = editor.drawflow?.drawflow?.Home?.data || {};
    const renamed = [];           // slug rename history (cho mention chips update)
    const promptSourceFixed = [];
    const otherFieldsFixed = [];

    for (const srv of serverNodes) {
      if (!srv?.node_id) continue;
      const localNode = nodes.find(n => n.node_id === srv.node_id);
      if (!localNode) continue;

      const patches = {};
      for (const field of SERVER_MUTABLE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(srv, field)) continue;
        // Strict equality fail false-positive cho cosmetic mismatch:
        //  - extension export `video_duration: ''` vs server DB `null`
        //  - `delay_seconds: undefined` vs `0`
        // Dùng _valuesEquivalent để bỏ qua trường hợp empty/null/undefined coi như nhau.
        if (this._valuesEquivalent(localNode[field], srv[field])) continue;

        // Track special diffs cho toast + mention update
        if (field === 'slug' && srv.slug) {
          renamed.push({ name: localNode.node_name, from: localNode.slug, to: srv.slug });
        } else if (field === 'prompt_source' && srv.prompt_source) {
          promptSourceFixed.push({ name: localNode.node_name, from: localNode.prompt_source, to: srv.prompt_source });
        } else if (field !== 'slug_auto') {
          otherFieldsFixed.push({ name: localNode.node_name, field, from: localNode[field], to: srv[field] });
        }

        // Apply patch
        patches[field] = srv[field];
        localNode[field] = srv[field];
      }

      if (Object.keys(patches).length === 0) continue;

      // Update drawflow data
      for (const [drawflowId, dfNode] of Object.entries(moduleData)) {
        if (dfNode?.data?.node_id === srv.node_id) {
          editor.updateNodeDataFromId(drawflowId, { ...dfNode.data, ...patches });

          // Form đang mở cho node này → update DOM trực tiếp (tránh phá state user đang edit)
          if (this.selectedNodeId && String(this.selectedNodeId) === String(drawflowId)) {
            this._syncFormDomAfterServerPatch(patches);
          }
          break;
        }
      }
    }

    // === Update mention chips downstream nếu slug đổi ===
    // Server rename `foo` → `foo_2` → các node downstream có prompt chứa @foo cần update thành @foo_2.
    // Strategy: extension-side regex replace để extension cũ cũng hưởng lợi (server không phải lo).
    if (renamed.length > 0) {
      this._updateMentionChipsAfterSlugRename(renamed, nodes);
    }

    // === Refresh node card UI + badges sau khi có thay đổi ===
    if (renamed.length > 0 || promptSourceFixed.length > 0 || otherFieldsFixed.length > 0) {
      try { this._scheduleRefreshNodeWarningBadges?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_syncServerNodesIntoEditor', e); }
      try { this._refreshAllPromptSourceBadges?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_syncServerNodesIntoEditor', e); }
      try { this._bindInlineSettingPills?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_syncServerNodesIntoEditor', e); }
      try { this._updatePortEmptyState?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_syncServerNodesIntoEditor', e); }
    }

    // === Toast cho user ===
    if (renamed.length > 0) {
      console.warn('[WorkflowEditor] Server-side slug rename detected:', renamed);
      const summary = renamed.map(r => `"${r.from}" → "${r.to}"`).join(', ');
      const msg = (window.I18n?.t('workflow.slugAutoRenamed') || 'Slug bị trùng đã được tự đổi:') + ' ' + summary;
      window.showNotification?.(msg, 'info', 6000);
    }
    if (promptSourceFixed.length > 0) {
      console.warn('[WorkflowEditor] Server auto-heal prompt_source:', promptSourceFixed);
      const names = promptSourceFixed.map(p => `"${p.name}"`).join(', ');
      const msg = (window.I18n?.t('workflow.promptSourceAutoHealed') || 'Đã tự chuyển sang dùng prompt từ upstream cho:') + ' ' + names;
      window.showNotification?.(msg, 'info', 6000);
    }
    if (otherFieldsFixed.length > 0) {
      console.warn('[WorkflowEditor] Server-side other field cleanup:', otherFieldsFixed);
    }
  }

  /**
   * So sánh 2 giá trị có "tương đương" về mặt logic không.
   * Tránh false-positive khi sync ngược: extension exports `''` cho field optional,
   * server normalize `null` → strict `===` báo khác → patch không cần thiết.
   *
   * Coi tương đương:
   *  - null === undefined === '' === [] === {} (all empty)
   *  - 0 === '0' (numeric)
   *  - true === 1 (boolean coerce)
   */
  _valuesEquivalent(a, b) {
    // Strict equal — trường hợp đơn giản nhất
    if (a === b) return true;
    // Cả 2 đều "empty" coi như nhau (null, undefined, '', 0)
    const isEmpty = (v) => v === null || v === undefined || v === '' || v === 0 || v === false;
    if (isEmpty(a) && isEmpty(b)) return true;
    // Loose equal cho number/string coercion (vd "5" == 5)
    /* eslint-disable eqeqeq */
    if (a == b) return true;
    /* eslint-enable eqeqeq */
    return false;
  }

  /**
   * Update DOM của form đang mở khi server patch fields của node đó.
   * Avoid full re-render để giữ state user đang edit (uploads, scrolling, ...).
   */
  _syncFormDomAfterServerPatch(patches) {
    try {
      if (Object.prototype.hasOwnProperty.call(patches, 'prompt_source')) {
        const toggle = this.overlay?.querySelector('#promptSourceToggle');
        if (toggle) toggle.checked = patches.prompt_source === 'textbox';
      }
      if (Object.prototype.hasOwnProperty.call(patches, 'slug')) {
        const slugInput = this.overlay?.querySelector('#nodeSlug');
        if (slugInput) slugInput.value = patches.slug;
      }
      // Các fields khác (prompt_mode, ref_mode, video_duration) thường ít khi server mutate
      // → khi nào trigger thì xử lý — hiện tại skip.
    } catch (e) {
      console.warn('[WorkflowEditor] _syncFormDomAfterServerPatch failed:', e?.message);
    }
  }

  /**
   * Update mention chips trong downstream nodes khi server rename slug.
   *
   * Regex replace `@old_slug` → `@new_slug` trong prompt của các node có mention.
   * Patch cả local nodes array, drawflow data, và DOM textarea (nếu form đang mở).
   *
   * @param {Array<{name, from, to}>} renamedList List slug đã đổi
   * @param {Array} nodes Local nodes array (mutate)
   */
  _updateMentionChipsAfterSlugRename(renamedList, nodes) {
    if (!Array.isArray(renamedList) || renamedList.length === 0) return;
    const editor = this.diagramCanvas?.editor;
    if (!editor) return;
    const moduleData = editor.drawflow?.drawflow?.Home?.data || {};

    let updatedCount = 0;
    for (const { from, to } of renamedList) {
      if (!from || !to || from === to) continue;
      // Escape regex special chars trong slug (slug pattern là [a-z][a-z0-9_]* nên không có special, nhưng safe)
      const escapedSlug = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match `@slug` với word boundary để không nhầm với @foo_bar khi rename @foo
      const mentionRegex = new RegExp(`@${escapedSlug}(?![a-z0-9_])`, 'g');

      for (const localNode of nodes) {
        if (!localNode || typeof localNode.prompt !== 'string') continue;
        if (!mentionRegex.test(localNode.prompt)) continue;
        const newPrompt = localNode.prompt.replace(mentionRegex, `@${to}`);
        if (newPrompt === localNode.prompt) continue;
        localNode.prompt = newPrompt;
        updatedCount++;

        // Update drawflow data
        for (const [drawflowId, dfNode] of Object.entries(moduleData)) {
          if (dfNode?.data?.node_id === localNode.node_id) {
            editor.updateNodeDataFromId(drawflowId, { ...dfNode.data, prompt: newPrompt });
            // Update DOM textarea nếu form đang mở cho node này
            if (this.selectedNodeId && String(this.selectedNodeId) === String(drawflowId)) {
              // Form prompt textarea IDs khác nhau tùy node type (verified với code thực tế):
              // generate: #nodePrompt, chatgpt: #chatgptNodePrompt, grok: #grokNodePrompt, prompt: #promptNodeText
              const promptTextarea = this.overlay?.querySelector('#nodePrompt')
                || this.overlay?.querySelector('#chatgptNodePrompt')
                || this.overlay?.querySelector('#grokNodePrompt')
                || this.overlay?.querySelector('#promptNodeText');
              if (promptTextarea && promptTextarea.value !== newPrompt) {
                promptTextarea.value = newPrompt;
              }
            }
            break;
          }
        }
      }
    }

    if (updatedCount > 0) {
      console.warn(`[WorkflowEditor] Updated ${updatedCount} mention occurrences sau khi server rename slug`);
    }
  }

  // Phase 3 cleanup: _isChatGPTOnlyWorkflow() helper đã removed.
  // Workflow giờ luôn gắn với Flow project (Phase 1 migration).

  async saveWorkflow(opts = {}) {
    if (!this.diagramCanvas) return false;
    // [Audit Bug 8 fix 2026-06-22] opts.snapshot = { nodes, edges, wfName } captured khi queue.
    // Khi follow-up save fire qua setTimeout, dùng snapshot này thay vì re-read DOM (tránh lost edit).
    const _snapshot = opts.snapshot || null;

    // Read-only mode: không cho phép save
    if (this.isReadOnly()) {
      console.log('[WorkflowEditor] saveWorkflow() blocked - read-only mode');
      return false;
    }

    // Template mode: không gọi saveWorkflow() - dùng _updateTemplate() hoặc _createTemplate() thay thế
    if (this.isTemplateMode) {
      console.log('[WorkflowEditor] saveWorkflow() skipped in template mode');
      return false;
    }

    // Block save khi workflow đang chạy (local hoặc cross-context)
    // Tránh race condition giữa save và executor update status
    if (window.workflowExecutor?.isRunning) {
      // 2026-05-31: silently skip save khi workflow đang chạy. Trước có toast warning
      // "Không thể lưu..." nhưng user feedback: misleading (tưởng có lỗi). Workflow
      // executor đã tự sync node state khi done → user KHÔNG cần biết save bị skip.
      // Giữ console.log cho dev debug.
      console.log('[WorkflowEditor] saveWorkflow() silently skipped - workflow executing');
      return false;
    }

    // [API SPAM FIX 2026-06] skipIfClean: dùng cho các save "đảm bảo persist trước khi run"
    // (run single node / run workflow). Nếu KHÔNG có thay đổi chưa lưu → server đã current →
    // bỏ full bulk-save thừa. Tránh spam 429 khi user bấm Run → cancel preflight → Run lại.
    // CHỈ skip khi opt bật + clean (edit path bình thường luôn _hasUnsavedChanges=true).
    if (opts.skipIfClean && !this._hasUnsavedChanges) {
      console.log('[WorkflowEditor] saveWorkflow() skipped — no unsaved changes (skipIfClean)');
      return true;
    }

    // Option A3 — Version-aware grandfather logic cho workflows_nodes_max.
    // Cho phép legacy workflow over-quota EDIT/GIẢM nodes, chỉ block khi TĂNG count
    // vượt limit. Đồng bộ với backend grandfather logic.
    //
    // Logic:
    //   - newCount > limit AND newCount > existingCount → reject (đang TĂNG)
    //   - newCount > limit AND newCount <= existingCount → allow (giữ nguyên/giảm)
    //   - newCount <= limit → allow
    if (window.featureGate) {
      try {
        const exportedNodes = this.diagramCanvas.exportWorkflow().nodes || [];
        const newCount = exportedNodes.length;
        const existingCount = (this.workflow?.nodes || []).length;
        const nodeQuota = window.featureGate.checkQuota('workflows_nodes_max');
        const limit = nodeQuota?.limit;

        if (limit !== 'unlimited' && limit !== '-1' && limit > 0 && newCount > limit) {
          // Grandfather: cho phép nếu đang giữ nguyên hoặc giảm count
          if (newCount > existingCount) {
            const dialog = window.customDialog || window.CustomDialog;
            const isLegacy = existingCount > limit;
            const message = isLegacy
              ? (window.I18n?.t('workflow.nodeQuotaCannotAdd', { existing: existingCount, limit })
                || `Workflow đang có ${existingCount} node (vượt giới hạn ${limit} của gói). Bạn có thể chỉnh sửa hoặc xóa bớt, nhưng KHÔNG thể thêm node mới. Nâng cấp gói để mở rộng.`)
              : (window.I18n?.t('workflow.nodeQuotaExceeded', { count: newCount, limit })
                || `Workflow has ${newCount} nodes but current plan limits to ${limit}. Please delete nodes or upgrade.`);
            const confirmed = await dialog?.confirm(message, {
              title: window.I18n?.t('workflow.limitReached') || 'Node limit exceeded',
              type: 'warning',
              confirmText: window.I18n?.t('common.upgrade') || 'Upgrade',
              cancelText: window.I18n?.t('common.later') || 'Later',
            });
            if (confirmed) {
              chrome.runtime.sendMessage({ action: 'openSettings' });
            }
            return;
          }
          // Grandfather case: log info để dev biết save đang allow legacy
          console.info('[WorkflowEditor] Grandfather save: legacy workflow over-quota (' +
            newCount + '/' + limit + '), allow vì không tăng count (existing=' + existingCount + ')');
        }
      } catch (e) {
        console.warn('[WorkflowEditor] Quota check error (non-fatal):', e.message);
      }
    }

    // Check workflow limit (only on create mode)
    // Luôn fetch async từ server để có entitlements mới nhất theo user plan
    if (this.mode === 'create' && window.featureGate) {
      const canCreate = await window.featureGate.canCreateWorkflowAsync();
      if (!canCreate) {
        const isLoggedIn = window.authManager?.isLoggedIn();
        if (!isLoggedIn) {
          window.featureGate.showLoginPrompt(
            window.I18n?.t('workflow.requireLoginToCreate') || 'Tạo workflow yêu cầu đăng nhập'
          );
        } else {
          const quota = window.featureGate.checkQuota('workflows_max');
          console.log('[SEOSONA Flow] Workflow quota exceeded:', quota);
          const dialog = window.customDialog || window.CustomDialog;
          const confirmed = await dialog?.confirm(
            window.I18n?.t('workflow.quotaExceeded', { limit: quota.limit, used: quota.used }) || `Your plan limits to ${quota.limit} workflows. You have ${quota.used}. Upgrade Premium for unlimited.`,
            { title: window.I18n?.t('workflow.limitReached') || 'Limit reached', type: 'warning', confirmText: window.I18n?.t('common.upgrade') || 'Upgrade', cancelText: window.I18n?.t('common.later') || 'Later' }
          );
          if (confirmed) {
            chrome.runtime.sendMessage({ action: 'openSettings' });
          }
        }
        return;
      }
    }

    // Prevent concurrent saves — queue instead of silent skip
    // Bug fix: Trước đây `return` ngay → caller không biết save bị skip → status không persist
    // [Audit Bug 8 fix 2026-06-22] Snapshot DOM state ngay trước khi queue → follow-up save
    // không re-read DOM (tránh lost edit nếu user navigate away sau khi click Save lần 2).
    if (this._isSaving) {
      this._pendingSaveRequest = true;
      // Snapshot toàn bộ workflow data tại thời điểm này. Follow-up save sẽ dùng snapshot này
      // thay vì re-read DOM. Mỗi click Save mới sẽ overwrite snapshot trước (latest wins).
      try {
        const { nodes, edges } = this.diagramCanvas?.exportWorkflow?.() || { nodes: [], edges: [] };
        const wfName = this.overlay?.querySelector('#workflowName')?.value?.trim() || '';
        this._pendingSaveSnapshot = { nodes, edges, wfName, capturedAt: Date.now() };
      } catch (_) { /* snapshot best-effort, follow-up sẽ fallback re-read DOM */ }
      console.log('[WorkflowEditor] saveWorkflow() queued — another save in progress (snapshot captured)');
      return false; // Return false - caller should wait or retry
    }
    this._isSaving = true;
    this._pendingSaveRequest = false;

    // CRITICAL: Pre-try block phải nằm trong try/finally — bug fix `_isSaving stuck`.
    // Trước fix: code 5645-5672 (apply form, querySelector DOM, set disabled, innerHTML)
    // chạy NGOÀI try/catch. Nếu BẤT KỲ throw nào (vd `_applyNodeFormData` exception, DOM
    // null ref, innerHTML XSS error) → finally KHÔNG chạy → `_isSaving=true` stuck forever
    // → mọi save tiếp theo `if (this._isSaving) return;` ngắt → save button + play button
    // disabled mãi mãi cho đến reload extension.
    let saveBtn, resetBtn, closeBtn, deleteNodeBtn, saveBtnOrigText;
    try {
      // CRITICAL: Chỉ apply form data khi sidebar form ĐANG MỞ.
      // Drawflow set selectedNodeId khi user chỉ click highlight node (chưa mở form).
      // Nếu apply form data trong trường hợp này → đọc form fields rỗng/stale →
      // GHI ĐÈ quick-edit pill changes vừa update vào Drawflow data.
      // SKIP khi inline save đang chạy — inline handler đã update node data trực tiếp,
      // apply form data có thể ghi đè với data cũ từ sidebar form của node khác.
      if (this.selectedNodeId && !this._inlineSaveInProgress) {
        const formPanel = this.overlay?.querySelector('#nodeFormPanel');
        const isPanelOpen = formPanel && !formPanel.classList.contains('hidden');
        if (isPanelOpen) {
          this._applyNodeFormData();
        }
      }

      saveBtn = this.overlay?.querySelector('#saveWorkflowBtn');
      resetBtn = this.overlay?.querySelector('#resetWorkflowInEditorBtn');
      closeBtn = this.overlay?.querySelector('#closeEditorBtn');
      saveBtnOrigText = saveBtn?.textContent;
      deleteNodeBtn = this.overlay?.querySelector('#deleteNodeBtn');

      // Disable save, reset, close, run, delete buttons & show loading
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<span class="seosonaflow-loading-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:-2px;margin-right:4px;"></span>${window.I18n?.t('common.saving') || 'Saving...'}`;
      }
      if (resetBtn) resetBtn.disabled = true;
      if (closeBtn) closeBtn.disabled = true;
      if (deleteNodeBtn) deleteNodeBtn.disabled = true;
      // Disable play buttons via centralized method (also checks deferred save state)
      this._updatePlayButtonState();
      // [Audit Bug 8 fix 2026-06-22] Use snapshot nếu có (queued follow-up), else read DOM hiện tại.
      const workflowName = _snapshot?.wfName ?? this.overlay?.querySelector('#workflowName')?.value?.trim();
      const { nodes, edges } = _snapshot
        ? { nodes: _snapshot.nodes, edges: _snapshot.edges }
        : this.diagramCanvas.exportWorkflow();

      // Debug: log ChatGPT node data before save
      const chatgptNodes = nodes.filter(n => n.node_type === 'chatgpt');
      if (chatgptNodes.length > 0) {
        console.log('[WorkflowEditor] saveWorkflow - ChatGPT nodes data:', chatgptNodes.map(n => ({
          node_id: n.node_id,
          status: n.status,
          result_file_ids: n.result_file_ids?.substring(0, 50),
          has_result_thumbnails: !!(n.result_thumbnails && Object.keys(n.result_thumbnails).length > 0),
        })));
      }

      // Build workflow metadata (without nodes/edges - they're saved separately)
      const { nodes: _n, edges: _e, ...workflowBase } = (this.workflow || {});
      // Phase 1 (Flow-centric model): MỌI workflow gắn với Flow project.
      // - Edit: preserve project_id cũ (kể cả null cho legacy items chưa migrate)
      // - Create: gán current project. Nếu null (extension chưa truy cập Flow tab) →
      //   _showProjectSelectOverlay() đã enforce ở app.js init flow → user không thể save
      //   workflow ở state này. Save fallback null là defensive.
      // Bỏ heuristic _isChatGPTOnlyWorkflow → ChatGPT-only workflow cũng gắn project,
      // do auto-download path build từ workflow.wf_name + Flow output folder context.
      const preservedProjectId = workflowBase.project_id !== undefined
        ? workflowBase.project_id
        : (window._currentProjectId || null);
      // Auto-migrate: workflow legacy (project_id=null) → khi user save lại trên project
      // hiện tại → gán project_id current để thoát "Legacy" group.
      const isLegacyShared = preservedProjectId === null;
      const computedProjectId = isLegacyShared
        ? (window._currentProjectId || null)  // migrate khi có current project
        : preservedProjectId;
      const workflowData = {
        ...workflowBase,
        wf_name: workflowName || (window.I18n?.t('workflow.untitled') || 'Workflow không tên'),
        progress_total: nodes.length,
        project_id: computedProjectId,
        platform: 'flow',
      };
      if (!window.storageManager) {
        console.error('[SEOSONA Flow] storageManager chưa khởi tạo');
        window.customDialog?.alert(window.I18n?.t('workflow.storageNotReady') || 'Lỗi: Storage chưa sẵn sàng. Hãy thử lại.', { type: 'error' });
        return;
      }

      // Empty-nodes guard: nếu save với 0 nodes mà cached workflow đã có nodes
      // → có thể là race bug (load chưa xong) hoặc user clear all chủ ý.
      // Show modal yêu cầu user xác nhận. Nếu confirm → set flag `confirmed_clear: true`
      // để backend cho phép wipe. Race bug → user không confirm → backend reject 422 → bảo vệ data.
      const cachedNodeCount = (this.workflow?.nodes?.length) || 0;
      if (nodes.length === 0 && cachedNodeCount > 0 && this.mode === 'edit') {
        const I = window.I18n;
        const confirmed = await window.customDialog?.confirm(
          I?.t('workflow.confirmClearAllMsg', { count: cachedNodeCount })
            || `Bạn sắp xóa hết ${cachedNodeCount} nodes hiện có trên server. Hành động này không thể hoàn tác. Tiếp tục?`,
          {
            title: I?.t('workflow.confirmClearAllTitle') || 'Xác nhận xóa hết nodes',
            type: 'warning',
            confirmText: I?.t('workflow.confirmClearAllConfirm') || 'Xóa hết',
            cancelText: I?.t('common.cancel') || 'Hủy',
          }
        );
        if (!confirmed) {
          // User hủy → abort save, giữ state hiện tại
          this._isSaving = false;
          this._pendingSaveRequest = false;
          // Re-enable buttons
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveBtnOrigText || 'Save'; }
          if (resetBtn) resetBtn.disabled = false;
          if (closeBtn) closeBtn.disabled = false;
          if (deleteNodeBtn) deleteNodeBtn.disabled = false;
          this._updatePlayButtonState();
          return;
        }
        // User confirm → đính flag để backend cho phép wipe
        workflowData.confirmed_clear = true;
        console.log('[WorkflowEditor] User confirmed clear all nodes (was', cachedNodeCount, 'nodes)');
      }

      // Strip base64 data URLs từ node thumbnails trước khi save
      // AND replace upload_xxx keys với real tile_ids từ ImmediateUploader
      const cleanNodes = nodes.map(n => {
        const cleaned = { ...n };
        // Replace upload_xxx in ref_file_ids (STRING) with real tile_ids
        if (cleaned.ref_file_ids && typeof cleaned.ref_file_ids === 'string') {
          const ids = cleaned.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean);
          const fixedIds = ids.map(id => {
            if (id.startsWith('upload_')) {
              const realTileId = window.ImmediateUploader?.getResult?.(id);
              if (realTileId && typeof realTileId === 'string' && !realTileId.startsWith('upload_')) {
                console.log('[SEOSONA Flow] saveWorkflow: replaced upload key', id, '->', realTileId);
                return realTileId;
              }
            }
            return id;
          });
          cleaned.ref_file_ids = fixedIds.join(', ');
        }
        // Also fix ref_thumbnails keys (OBJECT)
        if (cleaned.ref_thumbnails && typeof cleaned.ref_thumbnails === 'object') {
          const fixedThumbs = {};
          for (const [k, v] of Object.entries(cleaned.ref_thumbnails)) {
            if (k.startsWith('upload_')) {
              const realTileId = window.ImmediateUploader?.getResult?.(k);
              if (realTileId && typeof realTileId === 'string' && !realTileId.startsWith('upload_')) {
                fixedThumbs[realTileId] = v;
              } else {
                fixedThumbs[k] = v;
              }
            } else {
              fixedThumbs[k] = v;
            }
          }
          cleaned.ref_thumbnails = fixedThumbs;
        }
        for (const field of ['ref_thumbnails', 'result_thumbnails']) {
          if (cleaned[field] && typeof cleaned[field] === 'object') {
            const trimmed = {};
            for (const [k, v] of Object.entries(cleaned[field])) {
              if (typeof v === 'string' && v.startsWith('data:') && v.length > 500) continue;
              if (typeof v === 'object' && v?.thumbnail?.startsWith?.('data:') && v.thumbnail.length > 500) {
                trimmed[k] = { ...v, thumbnail: '' };
              } else {
                trimmed[k] = v;
              }
            }
            cleaned[field] = Object.keys(trimmed).length > 0 ? trimmed : null;
          }
        }
        return cleaned;
      });
      // [DEBUG SAVE] Log save start
      console.log('[SAVE_DEBUG] >>> Calling saveWorkflowFull', {
        wf_id: workflowData.wf_id,
        mode_before: this.mode,
        editorMode_before: this.editorMode,
        nodes_count: cleanNodes.length,
        edges_count: edges.length,
      });

      const _saveResult = await window.storageManager.saveWorkflowFull(workflowData, cleanNodes, edges);

      // [DEBUG SAVE] Log server response shape
      console.log('[SAVE_DEBUG] <<< Server response received', {
        wf_id: _saveResult?.wf_id || '(missing)',
        nodes_returned: Array.isArray(_saveResult?.nodes) ? _saveResult.nodes.length : 'NOT ARRAY',
        edges_returned: Array.isArray(_saveResult?.edges) ? _saveResult.edges.length : 'NOT ARRAY',
        has_data: !!_saveResult,
        keys: _saveResult ? Object.keys(_saveResult).slice(0, 10) : [],
      });

      // Sync server-side mutations back vào editor (backend auto-rename duplicate slug
      // + auto-heal stale prompt_source + cross-field cleanup trong BulkSaveWorkflowRequest
      // → response chứa data đã sửa). Generic whitelist patch để future-proof khi backend
      // mutate thêm fields.
      try {
        this._syncServerNodesIntoEditor(_saveResult, nodes);
      } catch (e) {
        console.warn('[WorkflowEditor] Sync server response failed:', e?.message);
      }

      // Update this.workflow reference to match saved data (preserve nodes/edges for background scan)
      this.workflow = { ...workflowData, wf_name: workflowName || (window.I18n?.t('workflow.untitled') || 'Workflow không tên'), nodes, edges };

      // Show save success toast
      this._showSaveToast();
      this._hasUnsavedChanges = false;
      // Phase: sync UI để hiển thị/ẩn play button đúng trạng thái save
      this._syncExecutionUI();

      // Emit event to update workflow list in extension sidebar
      window.eventBus?.emit('storage:workflow_saved', { wfId: workflowData.wf_id });
      // Notify other contexts (popup editor window ↔ sidePanel)
      try {
        chrome.runtime.sendMessage({ action: 'workflowSaved', wfId: workflowData.wf_id });
      } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#saveWorkflow', e); }

      // Fire-and-forget: cache ref image blobs cho tat ca nodes
      const allNodeData = this._getAllNodeData?.() || [];
      for (const nd of allNodeData) {
        if (nd.ref_file_ids) this._cacheNodeRefImageBlobs(nd).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_resolveFieldLabel', _e); });
      }

      // After first save, switch to edit mode and show play/stop buttons
      if (this.mode === 'create') {
        // [DEBUG SAVE] Log mode switch
        console.log('[SAVE_DEBUG] === Switching mode: create → edit', {
          wf_id: workflowData.wf_id,
          editorMode_before: this.editorMode,
          editorMode_after: 'workflow_edit',
          canRun_before: this.canRun(),
        });
        this.mode = 'edit';
        // Bug fix CRITICAL: ALSO update editorMode → getPermissions() returns WORKFLOW_EDIT perms.
        // Trước fix: chỉ set this.mode='edit', editorMode vẫn WORKFLOW_CREATE → canRun=false →
        // click Run button bị block silent (chỉ console gọi _runWorkflowFromEditor() direct mới chạy).
        this.editorMode = EditorMode.WORKFLOW_EDIT;
        console.log('[SAVE_DEBUG] === Mode switched, canRun now:', this.canRun());
        // Update editingWorkflowId in background.js (was null when opened in create mode)
        try { chrome.runtime.sendMessage({ action: 'updateEditingWorkflowId', wfId: workflowData.wf_id }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#saveWorkflow', e); }
        // Trial gate: ghi nhận tạo workflow (chỉ cho not-logged-in users)
        // IMPORTANT: Must await to ensure usage is recorded before next action
        if (window.featureGate && !window.authManager?.isLoggedIn()) {
          await window.featureGate.recordWorkflowCreated();
        }
        // Refresh featureGate to update workflow count for next create
        if (window.featureGate) {
          window.featureGate.refresh({ force: true }).catch(e => console.warn('[WorkflowEditor] FeatureGate refresh failed:', e));
        }
        // Show toolbar play and export buttons (were hidden in create mode)
        this.overlay?.querySelector('.seosonaflow-wf-tool-btn[data-action="run-workflow"]')?.classList.remove('hidden');
        // Export nằm trong zoom toolbar (.canvas-control-btn) sau refactor → query class-agnostic.
        this.overlay?.querySelectorAll('[data-action="export-workflow"]').forEach(b => b.classList.remove('hidden'));
        // Show reset button (was hidden in create mode)
        this.overlay?.querySelector('#resetWorkflowInEditorBtn')?.classList.remove('hidden');

        // Show "Save as Template" button nếu admin (was hidden vì chưa có workflowId)
        if (window.featureGate?.canManageWorkflowTemplates() && !this.isTemplateMode) {
          const closeBtn = this.overlay?.querySelector('#closeEditorBtn');
          if (closeBtn && !this.overlay?.querySelector('#wfSaveAsTemplateBtn')) {
            const saveAsBtn = document.createElement('button');
            saveAsBtn.className = 'btn btn-secondary btn-save-template';
            saveAsBtn.id = 'wfSaveAsTemplateBtn';
            saveAsBtn.title = window.I18n?.t('workflow.saveAsTemplate') || 'Lưu thành Template';
            saveAsBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              <span>${window.I18n?.t('workflow.saveAsTemplate') || 'Lưu thành'}</span>
            `;
            saveAsBtn.addEventListener('click', () => this._saveAsTemplate());
            closeBtn.parentNode.insertBefore(saveAsBtn, closeBtn);
          }
        }
      }
      return true; // Save succeeded
    } catch (error) {
      console.error('[SEOSONA Flow] Save FAILED:', error);

      // Quota error modal already shown by ApiStorage._handleQuotaError
      if (error.code === 'QUOTA_EXCEEDED' || error.message?.includes('giới hạn')) {
        return false;
      }

      // REQUIRES_LOGIN error - show login prompt (defensive, normally caught by canCreateWorkflowAsync)
      if (error.message === 'REQUIRES_LOGIN') {
        window.featureGate?.showLoginPrompt(
          window.I18n?.t('workflow.requireLoginToCreate') || 'Tạo workflow yêu cầu đăng nhập'
        );
        return false;
      }

      // 2026-06-02: Show field-specific validation errors thay vì generic "Validation failed".
      // [2026-06-13] Resolve `nodes.{idx}.{field}` → tên node để user thấy node nào lỗi thay vì STT.
      const _resolveFieldLabel = (field) => {
        const m = /^nodes\.(\d+)\.(.+)$/.exec(field);
        if (!m) return field;
        const idx = parseInt(m[1], 10);
        const subField = m[2];
        const node = Array.isArray(this.workflow?.nodes) ? this.workflow.nodes[idx] : null;
        const nodeName = node?.node_name || node?.node_type || `Node #${idx + 1}`;
        return `"${nodeName}" → ${subField}`;
      };
      let detailLines = [];
      if (error.code === 'VALIDATION_ERROR' && error.details && typeof error.details === 'object') {
        for (const [field, errs] of Object.entries(error.details)) {
          const msgs = Array.isArray(errs) ? errs.join('; ') : String(errs);
          detailLines.push(`• ${_resolveFieldLabel(field)}: ${msgs}`);
        }
      }
      const baseMsg = (window.I18n?.t('workflow.saveWorkflowError') || 'Không thể lưu workflow') + ': ' + error.message;
      const fullMsg = detailLines.length > 0
        ? baseMsg + '\n\nField errors:\n' + detailLines.slice(0, 10).join('\n') + (detailLines.length > 10 ? `\n... (${detailLines.length - 10} more)` : '')
        : baseMsg;
      window.customDialog?.alert(fullMsg, { type: 'error' });
      return false; // Save failed
    } finally {
      this._isSaving = false;
      // Re-enable buttons
      if (saveBtn) {
        saveBtn.disabled = false;
        // Sau khi save create mode thành công, đổi button text thành "Lưu"
        // Nếu đang ở edit mode (bao gồm vừa chuyển từ create), dùng text "Lưu"
        const newBtnText = this.mode === 'edit'
          ? (window.I18n?.t('workflow.saveBtn') || 'Lưu')
          : (saveBtnOrigText || (window.I18n?.t('common.save') || 'Lưu'));
        saveBtn.textContent = newBtnText;
      }
      if (resetBtn) resetBtn.disabled = false;
      if (closeBtn) closeBtn.disabled = false;
      if (deleteNodeBtn) deleteNodeBtn.disabled = false;
      // Re-enable play buttons via centralized method (checks if deferred save still pending)
      this._updatePlayButtonState();

      // Process pending save request (queued while this save was running)
      // Bug fix: Trước đây saveWorkflow() return ngay khi _isSaving=true → changes bị mất
      // [Audit Bug 8 fix 2026-06-22] Pass snapshot (đã capture lúc queue) vào saveWorkflow
      // để tránh re-read DOM khi follow-up fire (DOM có thể đã change nếu user click sang node khác).
      if (this._pendingSaveRequest) {
        this._pendingSaveRequest = false;
        const snapshot = this._pendingSaveSnapshot;
        this._pendingSaveSnapshot = null;
        console.log('[WorkflowEditor] Processing queued save request' + (snapshot ? ' (using snapshot)' : ''));
        // Use setTimeout to avoid stack overflow và cho UI update
        setTimeout(() => this.saveWorkflow({ snapshot }).catch(e => console.warn('[WorkflowEditor] Queued save failed:', e)), 50);
      }
    }
  }

  // === Save as Template Methods (EWT-5) ===

  /**
   * Mở modal lưu workflow thành template (admin only)
   * EWT-5.1: Chỉ hiển thị cho admin users
   */
  /**
   * Capture diagram canvas → upload PNG làm preview public template.
   * Chỉ admin + template_edit mode. File cũ tự xóa qua diagram_path ở backend.
   */
  /**
   * Inline toast cho capture flow — không phụ thuộc window.showNotification
   * (template editor window không load app.js).
   */
  _showCaptureToast(message, type = 'info', sticky = false) {
    let toast = document.getElementById('seosonaflow-capture-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'seosonaflow-capture-toast';
      toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 999999;
        padding: 12px 18px; border-radius: 10px; font-size: 14px; font-weight: 500;
        color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        display: flex; align-items: center; gap: 10px;
        max-width: 360px; transition: opacity 0.2s, transform 0.2s;
      `;
      document.body.appendChild(toast);
    }
    const colors = {
      info: 'background: linear-gradient(135deg, #6366f1, #4f46e5);',
      success: 'background: linear-gradient(135deg, #19d07b, #059669);',
      error: 'background: linear-gradient(135deg, #ef4444, #dc2626);',
    };
    const icons = {
      info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
      success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
      error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    };
    const spinnerIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
    toast.style.cssText += colors[type] || colors.info;
    toast.innerHTML = `${type === 'info' && sticky ? spinnerIcon : icons[type]}<span>${message}</span>`;

    if (!document.getElementById('seosonaflow-capture-toast-style')) {
      const s = document.createElement('style');
      s.id = 'seosonaflow-capture-toast-style';
      s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }

    if (!sticky) {
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 250);
      }, 3000);
    }
    return toast;
  }

  _hideCaptureToast() {
    const toast = document.getElementById('seosonaflow-capture-toast');
    if (toast) {
      clearTimeout(toast._timer);
      toast.remove();
    }
  }

  /**
   * Update button state cho capture flow (loading / idle).
   */
  _setCaptureBtnLoading(loading) {
    const btn = this.overlay?.querySelector('#wfCaptureDiagramBtn');
    if (!btn) return;
    if (loading) {
      btn._originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.style.cursor = 'wait';
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        <span>Đang chụp...</span>
      `;
    } else {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = '';
      if (btn._originalHtml) {
        btn.innerHTML = btn._originalHtml;
        btn._originalHtml = null;
      }
    }
  }

  async _captureDiagramAndUpload() {
    console.log('[WorkflowEditor] _captureDiagramAndUpload clicked', {
      isTemplateMode: this.isTemplateMode,
      templateId: this.templateId,
      isAdmin: window.featureGate?.canManageWorkflowTemplates(),
      hasHtml2canvas: typeof html2canvas,
    });
    if (!this.isCreatorTemplate && !window.featureGate?.canManageWorkflowTemplates()) {
      console.warn('[WorkflowEditor] Capture blocked: not admin/creator');
      window.showNotification?.(window.I18n?.t('workflow.adminRequired') || 'Cần quyền admin', 'error');
      return;
    }
    if (!this.templateId) {
      console.warn('[WorkflowEditor] Capture blocked: no templateId');
      window.showNotification?.(window.I18n?.t('workflowNotify.templateIdMissing') || 'Chưa có templateId', 'error');
      return;
    }
    if (typeof html2canvas !== 'function') {
      console.error('[WorkflowEditor] Capture blocked: html2canvas not loaded. Check sidebar.html includes <script src="lib/html2canvas.min.js">');
      window.showNotification?.(window.I18n?.t('workflowNotify.html2canvasNotLoaded') || 'html2canvas chưa load — kiểm tra console', 'error');
      return;
    }

    const captureBtn = this.overlay?.querySelector('#wfCaptureDiagramBtn');
    const targetEl = this.overlay?.querySelector('.diagram-container') || this.overlay?.querySelector('.diagram-canvas');
    console.log('[WorkflowEditor] Capture target:', targetEl);
    if (!targetEl) {
      console.warn('[WorkflowEditor] Capture blocked: diagram container not found');
      window.showNotification?.(window.I18n?.t('workflowNotify.diagramContainerNotFound') || 'Không tìm thấy diagram container', 'error');
      return;
    }

    // Hide control overlays (zoom controls, recenter, brand zone) trước khi capture để ảnh sạch.
    const hiddenEls = Array.from(targetEl.querySelectorAll(
      '.canvas-controls, .diagram-recenter-btn, .canvas-brand-zone, .workflow-progress, .df-select-box'
    ));
    const prevVisibility = hiddenEls.map(el => el.style.visibility);
    hiddenEls.forEach(el => (el.style.visibility = 'hidden'));

    // Inject styles + sửa SVG attrs TRỰC TIẾP trên live DOM (onclone không đáng tin cho html2canvas
    // với SVG transform). Restore trong finally. User có thể thấy flash 1-2 frame.
    const tempStyle = document.createElement('style');
    tempStyle.id = 'seosonaflow-capture-temp-style';
    tempStyle.textContent = `
      /* Match diagram-container bg solid + bỏ dot grid (cleaner capture, không có pattern) */
      .diagram-container {
        background: #111111 !important;
        background-image: none !important;
      }
      /* Connections — broader selector + thicker stroke */
      svg.connection, [class*="connection"] svg, .drawflow svg {
        overflow: visible !important;
        shape-rendering: geometricPrecision !important;
      }
      svg.connection path,
      .drawflow svg path.main-path,
      .drawflow .connection path,
      [class*="connection"] path {
        fill: none !important;
        stroke: #818cf8 !important;
        stroke-width: 7px !important;
        stroke-linecap: round !important;
        stroke-linejoin: round !important;
        stroke-dasharray: none !important;
        stroke-miterlimit: 10 !important;
        vector-effect: non-scaling-stroke !important;
        opacity: 1 !important;
      }
      .drawflow .point, .drawflow .point.selected {
        fill: #818cf8 !important;
        stroke: #ffffff !important;
        stroke-width: 2px !important;
      }
      /* Brighten port circles (12px) — light bg + visible border để contrast với node */
      .drawflow .drawflow-node .input,
      .drawflow .drawflow-node .output {
        background: #d4d4d8 !important;
        border: 2px solid #ffffff !important;
        box-shadow: 0 0 0 1px rgba(0,0,0,0.3) !important;
      }
      /* Typed ports giữ màu theo type nhưng brightening */
      .drawflow .drawflow-node[data-port-type="image"] .input,
      .drawflow .drawflow-node[data-port-type="image"] .output,
      .drawflow .drawflow-node .input[data-port-type="image"],
      .drawflow .drawflow-node .output[data-port-type="image"] { background: #60a5fa !important; }
      .drawflow .drawflow-node[data-port-type="video"] .input,
      .drawflow .drawflow-node[data-port-type="video"] .output,
      .drawflow .drawflow-node .input[data-port-type="video"],
      .drawflow .drawflow-node .output[data-port-type="video"] { background: #c084fc !important; }
      .drawflow .drawflow-node[data-port-type="text"] .input,
      .drawflow .drawflow-node[data-port-type="text"] .output,
      .drawflow .drawflow-node .input[data-port-type="text"],
      .drawflow .drawflow-node .output[data-port-type="text"] { background: #4be3a0 !important; }
      .df-port-icon { opacity: 1 !important; visibility: visible !important; }
      .df-port-icon img, .df-port-icon svg {
        width: 18px !important; height: 18px !important;
        display: block !important; opacity: 1 !important;
      }
    `;
    document.head.appendChild(tempStyle);

    // Convert SVG port icons → IMG data URL (html2canvas render <img> tin cậy hơn inline SVG nhỏ
    // trong absolute positioned + transformed parent). Trước khi serialize, replace currentColor → #fff.
    const svgReplacements = [];
    const allSvgs = targetEl.querySelectorAll('.df-port-icon svg');
    for (const svg of allSvgs) {
      try {
        // Clone để mutate fill/stroke không động vào DOM thật
        const clone = svg.cloneNode(true);
        clone.setAttribute('width', '18');
        clone.setAttribute('height', '18');
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.querySelectorAll('[fill="currentColor"]').forEach(el => el.setAttribute('fill', '#ffffff'));
        clone.querySelectorAll('[stroke="currentColor"]').forEach(el => el.setAttribute('stroke', '#ffffff'));
        // Default stroke = #fff nếu element không có stroke attr (inherit qua CSS color)
        if (!clone.getAttribute('stroke') && !clone.getAttribute('fill')) {
          clone.setAttribute('stroke', '#ffffff');
        }

        const svgStr = new XMLSerializer().serializeToString(clone);
        const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);

        // Wait for img to load (sync rendering trong capture)
        const img = await new Promise((resolve) => {
          const i = new Image();
          i.width = 18;
          i.height = 18;
          i.style.width = '18px';
          i.style.height = '18px';
          i.style.display = 'block';
          i.onload = () => resolve(i);
          i.onerror = () => resolve(i); // resolve even on error để không hang
          i.src = dataUrl;
        });

        const parent = svg.parentNode;
        parent.replaceChild(img, svg);
        svgReplacements.push({ img, svg, parent });
      } catch (err) {
        console.warn('[WorkflowEditor] SVG → IMG convert failed for one icon:', err);
      }
    }
    console.log(`[WorkflowEditor] Replaced ${svgReplacements.length}/${allSvgs.length} port SVGs with IMG for capture`);

    // Đợi 2 frames để browser load images + apply styles
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    this._setCaptureBtnLoading(true);
    this._showCaptureToast('Đang chụp diagram, vui lòng chờ...', 'info', true);

    const t0 = performance.now();
    try {
      // Đợi 2 frames để diagram (SVG connections) flush layout ổn định trước capture.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      // Tính bbox thực tế của nodes + connections để CROP.
      const containerRect = targetEl.getBoundingClientRect();
      const nodeEls = targetEl.querySelectorAll('.drawflow-node');
      const connEls = targetEl.querySelectorAll('.connection, svg.connection');

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const collect = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        minX = Math.min(minX, r.left);
        minY = Math.min(minY, r.top);
        maxX = Math.max(maxX, r.right);
        maxY = Math.max(maxY, r.bottom);
      };
      nodeEls.forEach(collect);
      connEls.forEach(collect);

      const PADDING = 24; // padding gọn hơn để giảm khoảng trắng dư
      const cropOptions = {};
      if (isFinite(minX)) {
        const x = Math.max(0, Math.floor(minX - containerRect.left - PADDING));
        const y = Math.max(0, Math.floor(minY - containerRect.top - PADDING));
        const w = Math.min(containerRect.width - x, Math.ceil(maxX - minX + 2 * PADDING));
        const h = Math.min(containerRect.height - y, Math.ceil(maxY - minY + 2 * PADDING));
        cropOptions.x = x;
        cropOptions.y = y;
        cropOptions.width = w;
        cropOptions.height = h;
        cropOptions.windowWidth = containerRect.width;
        cropOptions.windowHeight = containerRect.height;
        console.log('[WorkflowEditor] Crop bbox:', cropOptions, 'from', nodeEls.length, 'nodes +', connEls.length, 'connections');
      } else {
        console.warn('[WorkflowEditor] No nodes found, capture full container');
      }

      console.log('[WorkflowEditor] Step 1/4: html2canvas() rendering...', { w: targetEl.offsetWidth, h: targetEl.offsetHeight });

      // Default rendering — live DOM đã được patch sẵn (tempStyle + svg attrs).
      // backgroundColor match exact với .diagram-container (#111111) để vùng html2canvas-painted
      // ngoài container không lệch tone (tránh "dải đen khác màu" ở dưới ảnh).
      const canvas = await html2canvas(targetEl, {
        backgroundColor: '#111111',
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        ...cropOptions,
      });
      console.log(`[WorkflowEditor] Step 1/4 done in ${Math.round(performance.now() - t0)}ms`, { canvasW: canvas.width, canvasH: canvas.height });

      console.log('[WorkflowEditor] Step 2/4: canvas → blob');
      const t1 = performance.now();
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob null'))), 'image/png', 0.95);
      });
      console.log(`[WorkflowEditor] Step 2/4 done in ${Math.round(performance.now() - t1)}ms`, { blobSize: blob.size, sizeMB: (blob.size / 1024 / 1024).toFixed(2) });

      // Bug fix 2026-06-09: pre-check size trước khi upload — backend limit 20 MB.
      // PNG scale=2 cho diagram lớn (>30 nodes) có thể vượt limit → fail tốn time + bandwidth.
      // Hiện size to → báo clear error cho admin biết cần thu nhỏ diagram hoặc tắt nodes ngoài viewport.
      const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB match backend max:20480
      if (blob.size > MAX_SIZE_BYTES) {
        const sizeMb = (blob.size / 1024 / 1024).toFixed(1);
        throw new Error(window.I18n?.t('workflowNotify.diagramTooLarge', { size: sizeMb }) || `Ảnh quá lớn (${sizeMb} MB > 20 MB). Vui lòng thu nhỏ diagram hoặc chỉ chọn vùng có nodes (crop).`);
      }

      console.log('[WorkflowEditor] Step 3/4: blob → base64');
      const t2 = performance.now();
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });
      console.log(`[WorkflowEditor] Step 3/4 done in ${Math.round(performance.now() - t2)}ms`, { base64Len: base64.length });

      console.log('[WorkflowEditor] Step 4/4: upload via background.js');
      const t3 = performance.now();
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'apiRequest',
          method: 'POST',
          endpoint: this.isCreatorTemplate
            ? `creator-templates/${this.templateId}/diagram`
            : `admin/workflow-templates/${this.templateId}/diagram`,
          token: window.authManager?.token,
          isFormData: true,
          formDataFields: {
            file: {
              name: `diagram_${Date.now()}.png`,
              type: 'image/png',
              base64,
            },
          },
        }, resp => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          console.log('[WorkflowEditor] Upload response:', resp);
          if (resp?.success) resolve(resp.data);
          else reject(new Error(resp?.error?.message || 'Upload failed'));
        });
      });
      console.log(`[WorkflowEditor] Step 4/4 done in ${Math.round(performance.now() - t3)}ms`, { response });

      if (this.templateData) {
        this.templateData.diagram_url = response?.diagram_url || this.templateData.diagram_url;
      }
      const totalMs = Math.round(performance.now() - t0);
      this._showCaptureToast(`Capture hoàn tất (${totalMs}ms)`, 'success');
    } catch (e) {
      console.error('[WorkflowEditor] Capture diagram failed:', e);
      this._showCaptureToast('Capture thất bại: ' + e.message, 'error');
    } finally {
      hiddenEls.forEach((el, i) => (el.style.visibility = prevVisibility[i] || ''));
      // Restore live DOM: replace IMG → original SVG + remove temp style
      const tempStyleEl = document.getElementById('seosonaflow-capture-temp-style');
      if (tempStyleEl) tempStyleEl.remove();
      if (typeof svgReplacements !== 'undefined') {
        svgReplacements.forEach(({ img, svg, parent }) => {
          try {
            if (img.parentNode === parent) parent.replaceChild(svg, img);
          } catch (e) { /* ignore */ }
        });
      }
      this._setCaptureBtnLoading(false);
    }
  }

  /**
   * [Affiliate Creator Page] Xuất bản workflow hiện tại thành community template (gửi duyệt).
   * Reuse builder workflowData của _saveAsTemplate; gate authoritative nằm trong CreatorTemplatePublish.
   */
  async _publishCommunityTemplate() {
    if (!window.CreatorTemplatePublish) {
      window.showNotification?.(window.I18n?.t('creator.publish.moduleNotReady') || 'Module xuất bản chưa sẵn sàng', 'error');
      return;
    }
    if (!this.diagramCanvas) {
      window.showNotification?.(window.I18n?.t('workflow.noWorkflowData') || 'Không có dữ liệu workflow', 'error');
      return;
    }
    try {
      const { nodes, edges } = this.diagramCanvas.exportWorkflow();
      const workflowName = this.overlay?.querySelector('#workflowName')?.value?.trim() || this.workflow?.wf_name || 'Workflow Template';
      const workflowData = {
        wf_name: workflowName,
        description: this.workflow?.description || '',
        nodes, edges,
        settings: this.workflow?.settings || {},
      };
      await window.CreatorTemplatePublish.show(workflowData);
    } catch (error) {
      console.error('[WorkflowEditor] Lỗi khi xuất bản template:', error);
      window.showNotification?.((window.I18n?.t('creator.publish.error') || 'Không thể xuất bản template') + ': ' + error.message, 'error');
    }
  }

  async _saveAsTemplate() {
    // LOCAL mode: "Lưu thành Template" → lưu vào KHO USER (af_user_templates), không server.
    // (SaveTemplateModal là luồng community/online → bỏ qua ở local.)
    if (self.SEOSONA_LOCAL_MODE !== false && window.UserTemplateStore) {
      return this._saveAsUserTemplateLocal();
    }

    // Kiểm tra quyền admin
    if (!window.featureGate?.canManageWorkflowTemplates()) {
      window.showNotification?.(
        window.I18n?.t('workflow.adminRequired') || 'Bạn cần quyền admin để lưu template',
        'error'
      );
      return;
    }

    // Kiểm tra SaveTemplateModal đã load chưa
    if (!window.SaveTemplateModal) {
      console.error('[WorkflowEditor] SaveTemplateModal chưa được load');
      window.showNotification?.(
        window.I18n?.t('workflow.saveTemplateModuleNotReady') || 'Module SaveTemplateModal chưa sẵn sàng',
        'error'
      );
      return;
    }

    // Lấy dữ liệu workflow hiện tại từ Drawflow live state
    if (!this.diagramCanvas) {
      window.showNotification?.(
        window.I18n?.t('workflow.noWorkflowData') || 'Không có dữ liệu workflow',
        'error'
      );
      return;
    }

    try {
      // Export nodes và edges từ Drawflow
      const { nodes, edges } = this.diagramCanvas.exportWorkflow();
      const workflowName = this.overlay?.querySelector('#workflowName')?.value?.trim() || this.workflow?.wf_name || 'Workflow Template';

      // Tạo workflow data object để truyền vào SaveTemplateModal
      const workflowData = {
        wf_name: workflowName,
        description: this.workflow?.description || '',
        nodes: nodes,
        edges: edges,
        settings: this.workflow?.settings || {}
      };

      // Mở modal SaveTemplateModal
      const result = await window.SaveTemplateModal.show(workflowData);

      if (result?.success) {
        console.log('[WorkflowEditor] Template đã được lưu:', result.template);
        // Success notification đã hiển thị trong SaveTemplateModal
      }
    } catch (error) {
      console.error('[WorkflowEditor] Lỗi khi lưu template:', error);
      window.showNotification?.(
        (window.I18n?.t('workflow.cannotSaveTemplate') || 'Không thể lưu template') + ': ' + error.message,
        'error'
      );
    }
  }

  /**
   * LOCAL: "Lưu thành Template" → tạo bản MỚI trong kho user (af_user_templates). Không server.
   * Hỏi tên nhanh, chuyển nodes/edges sang shape template (nested) để tương thích gallery + clone.
   */
  async _saveAsUserTemplateLocal() {
    const t = (k, f) => window.I18n?.t(k) || f;
    if (!this.diagramCanvas) {
      window.showNotification?.(t('workflow.noWorkflowData', 'Không có dữ liệu workflow'), 'error');
      return;
    }
    const { nodes, edges } = this.diagramCanvas.exportWorkflow();
    if (!nodes || nodes.length === 0) {
      window.showNotification?.(t('workflow.emptyWorkflow', 'Workflow trống — không thể lưu template'), 'warning');
      return;
    }
    const defaultName = this.overlay?.querySelector('#workflowName')?.value?.trim()
      || this.workflow?.wf_name || t('workflow.myTemplateDefault', 'Template của tôi');

    let name = defaultName;
    if (window.customDialog?.prompt) {
      name = await window.customDialog.prompt(
        t('workflow.templateNamePrompt', 'Đặt tên cho template của bạn:'),
        { title: t('workflow.saveAsTemplate', 'Lưu thành Template'), defaultValue: defaultName }
      );
      if (name === null) return; // user hủy
      name = (name || '').trim() || defaultName;
    }

    try {
      const rec = await window.UserTemplateStore.saveNew({
        name,
        description: this.workflow?.description || this.workflow?.wf_desc || '',
        nodes: this._convertNodesToTemplateFormat(nodes),
        edges: this._convertEdgesToTemplateFormat(edges),
      });
      window.showNotification?.(t('workflow.saveTemplateLocalSuccess', 'Đã lưu vào kho template của bạn'), 'success');
      try { chrome.runtime.sendMessage({ action: 'templateUpdated', templateId: rec.id }); } catch (e) { /* ignore */ }
    } catch (err) {
      console.error('[WorkflowEditor] Lưu template user thất bại:', err);
      window.showNotification?.((t('common.error', 'Lỗi')) + ': ' + err.message, 'error');
    }
  }

  /**
   * [Creator Page] Cập nhật NỘI DUNG community template (affiliate) → PUT creator-templates/{id}.
   * Reuse CreatorTemplatePublish: upload ảnh local/provider → creator-templates/media, convert format,
   * submit update. Backend đổi nodes → tự re-review (pending + ẩn tới khi admin duyệt lại).
   */
  async _updateCreatorTemplate() {
    const CTP = window.CreatorTemplatePublish;
    if (!CTP) {
      window.showNotification?.(window.I18n?.t('creator.publish.moduleNotReady') || 'Module xuất bản chưa sẵn sàng', 'error');
      return;
    }
    if (this._isSaving) { this._pendingSaveRequest = true; return; }
    this._isSaving = true;
    this._pendingSaveRequest = false;

    const saveBtn = this.overlay?.querySelector('#saveWorkflowBtn');
    const saveBtnOrigText = saveBtn?.textContent;
    try {
      if (this.selectedNodeId && !this._inlineSaveInProgress) {
        const formPanel = this.overlay?.querySelector('#nodeFormPanel');
        if (formPanel && !formPanel.classList.contains('hidden')) this._applyNodeFormData();
      }
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<span class="seosonaflow-loading-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:-2px;margin-right:4px;"></span>${window.I18n?.t('common.saving') || 'Saving...'}`;
      }

      const templateName = this.overlay?.querySelector('#workflowName')?.value?.trim() || this.templateData?.name || 'Template';
      const { nodes, edges } = this.diagramCanvas.exportWorkflow();
      const workflowData = { wf_name: templateName, description: this.templateData?.description || '', nodes, edges, settings: this.workflow?.settings || {} };

      const { urlMapping, failed } = await CTP._uploadImages(workflowData, () => {});
      if (failed > 0) {
        const msg = (window.I18n?.t('creator.publish.uploadFailedConfirm') || '{n} ảnh tải lên thất bại — template sẽ thiếu ảnh tham chiếu. Vẫn tiếp tục?').replace('{n}', failed);
        if (!confirm(msg)) {
          this._isSaving = false;
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveBtnOrigText || (window.I18n?.t('workflow.updateTemplate') || 'Cập nhật Template'); }
          return;
        }
      }
      const templateData = CTP._convertToTemplateFormat(workflowData, {
        name: templateName,
        description: this.templateData?.description || '',
        thumbnail_url: this.templateData?.thumbnail_url || null,
      }, urlMapping);

      await CTP._submitUpdate(this.templateId, templateData);
      this._hasUnsavedChanges = false;
      // Đổi nodes → backend re-review → cập nhật badge header về 'Chờ duyệt'.
      if (this.templateData) { this.templateData.review_status = 'pending'; this.templateData.is_public = false; this.templateData.reject_reason = null; }
      const badge = this.overlay?.querySelector('.wf-creator-status');
      if (badge) {
        badge.className = 'wf-creator-status wf-creator-status--pending';
        badge.textContent = window.I18n?.t('creator.status.pending') || 'Chờ duyệt';
        badge.removeAttribute('data-tooltip');
      }
      this._showEditorToast(window.I18n?.t('creator.edit.successReview') || 'Đã cập nhật. Template sẽ được duyệt lại trước khi hiển thị công khai.', 'success');
      window.eventBus?.emit('creator:template-updated', { templateId: this.templateId });
      try { chrome.runtime.sendMessage({ action: 'creatorTemplateUpdated', templateId: this.templateId }); } catch (e) { /* ignore */ }
    } catch (error) {
      console.error('[WorkflowEditor] Cập nhật community template thất bại:', error);
      this._showEditorToast((window.I18n?.t('creator.edit.error') || 'Không thể cập nhật template') + ': ' + (error.message || ''), 'error');
    } finally {
      this._isSaving = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = saveBtnOrigText || (window.I18n?.t('workflow.updateTemplate') || 'Cập nhật Template');
      }
      if (this._pendingSaveRequest) {
        this._pendingSaveRequest = false;
        setTimeout(() => this._updateCreatorTemplate().catch(e => console.warn('[WorkflowEditor] Queued creator update failed:', e)), 50);
      }
    }
  }

  /**
   * EWT-6.3: Cập nhật template đã tồn tại lên server
   * Gọi PUT /admin/workflow-templates/{id}
   */
  async _updateTemplate() {
    if (!this.isTemplateMode || !this.templateId) {
      console.error('[WorkflowEditor] _updateTemplate: không ở template mode');
      return;
    }

    if (!this.diagramCanvas) {
      console.error('[WorkflowEditor] _updateTemplate: diagramCanvas chưa khởi tạo');
      return;
    }

    // [Creator Page] Community template của affiliate → route sang creator update (re-review),
    // KHÔNG cần quyền admin. Reuse CreatorTemplatePublish (upload creator-media + convert + PUT).
    if (this.isCreatorTemplate) {
      return this._updateCreatorTemplate();
    }

    // Kiểm tra quyền admin
    if (!window.featureGate?.canManageWorkflowTemplates()) {
      window.showNotification?.(
        window.I18n?.t('workflow.adminRequired') || 'Bạn cần quyền admin để cập nhật template',
        'error'
      );
      return;
    }

    // Prevent concurrent saves — queue instead of silent skip (consistency với saveWorkflow)
    if (this._isSaving) {
      this._pendingSaveRequest = true;
      console.log('[WorkflowEditor] _updateTemplate() queued — another save in progress');
      return;
    }
    this._isSaving = true;
    this._pendingSaveRequest = false;

    let saveBtn, resetBtn, closeBtn, saveBtnOrigText;
    try {
      // Apply form data nếu đang mở (skip khi inline save đang chạy)
      if (this.selectedNodeId && !this._inlineSaveInProgress) {
        const formPanel = this.overlay?.querySelector('#nodeFormPanel');
        const isPanelOpen = formPanel && !formPanel.classList.contains('hidden');
        if (isPanelOpen) {
          this._applyNodeFormData();
        }
      }

      saveBtn = this.overlay?.querySelector('#saveWorkflowBtn');
      resetBtn = this.overlay?.querySelector('#resetWorkflowInEditorBtn');
      closeBtn = this.overlay?.querySelector('#closeEditorBtn');
      saveBtnOrigText = saveBtn?.textContent;

      // Disable buttons & show loading
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<span class="seosonaflow-loading-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:-2px;margin-right:4px;"></span>${window.I18n?.t('common.saving') || 'Saving...'}`;
      }
      if (resetBtn) resetBtn.disabled = true;
      if (closeBtn) closeBtn.disabled = true;

      // Lấy dữ liệu từ editor
      const templateName = this.overlay?.querySelector('#workflowName')?.value?.trim() || this.templateData?.name || 'Template';
      const { nodes, edges } = this.diagramCanvas.exportWorkflow();

      // Chuyển đổi nodes sang template format
      const templateNodes = this._convertNodesToTemplateFormat(nodes);
      const templateEdges = this._convertEdgesToTemplateFormat(edges);

      // Build template data để gửi lên server
      const templatePayload = {
        name: templateName,
        description: this.templateData?.description || '',
        category_id: this.templateData?.category_id || null,
        thumbnail_url: this.templateData?.thumbnail_url || null,
        video_url: this.templateData?.video_url || null,
        is_premium: this.templateData?.is_premium || false,
        is_featured: this.templateData?.is_featured || false,
        // Backend uses is_active (not is_published)
        is_active: this.templateData?.is_published !== false,
        nodes: templateNodes,
        edges: templateEdges,
        settings: this.workflow?.settings || {},
      };

      console.log('[WorkflowEditor] Đang cập nhật template:', this.templateId, templatePayload);

      // LOCAL mode (không backend): lưu vào KHO USER (af_user_templates) thay vì server.
      // Bản mặc định gốc KHÔNG bao giờ bị đụng — chỉ template user (id utpl_) mới lưu được ở đây;
      // template mặc định đã được fork thành bản user TRƯỚC khi mở editor (_openTemplateForEdit).
      if (!window.authManager?._apiCall) {
        const UTS = window.UserTemplateStore;
        if (UTS && UTS.isUserTemplateId(this.templateId)) {
          const patch = { name: templateName, nodes: templateNodes, edges: templateEdges };
          const td = this.templateData || {};
          if (td.description != null) patch.description = td.description;
          if (td.category_name != null || td.category != null) patch.category_name = td.category_name || td.category;
          if (Array.isArray(td.tags)) patch.tags = td.tags;
          if (td.media_type != null) patch.media_type = td.media_type;
          if (td.thumbnail_url || td.thumbnail) patch.thumbnail = td.thumbnail_url || td.thumbnail;
          const saved = await UTS.update(this.templateId, patch);
          if (!saved) throw new Error(window.I18n?.t('workflow.userTemplateNotFound') || 'Không tìm thấy template trong kho của bạn để lưu.');
          console.log('[WorkflowEditor] Đã lưu template user (local):', this.templateId);
          this._showEditorToast(window.I18n?.t('workflow.templateSavedLocal') || 'Đã lưu template của bạn', 'success');
          try { chrome.runtime.sendMessage({ action: 'templateUpdated', templateId: this.templateId }); } catch (e) { /* ignore */ }
          return; // xong — KHÔNG rơi vào nhánh server phía dưới
        }
        // Không phải template user (vd id bundled lọt vào) → chặn + hướng dẫn (lưới an toàn).
        const _localErr = new Error(window.I18n?.t('workflow.localNoTemplateUpdate')
          || 'Local mode: không sửa được template gốc. Hãy bấm "Chỉnh sửa" từ gallery để tạo bản của bạn, hoặc "Lưu thành Template".');
        _localErr._localExpected = true; // không phải bug → log nhẹ, chỉ toast hướng dẫn
        throw _localErr;
      }

      // Gọi API cập nhật template
      const response = await window.authManager._apiCall(
        'PUT',
        `admin/workflow-templates/${this.templateId}`,
        templatePayload
      );

      console.log('[WorkflowEditor] Template đã cập nhật thành công:', response);

      // Cập nhật local state nếu server trả về data mới
      if (response?.template) {
        this.templateData = {
          ...this.templateData,
          name: response.template.name,
          description: response.template.description,
        };
      }

      // Hiển thị thông báo thành công trong editor overlay
      const successMsg = window.I18n?.t('workflow.templateUpdated') || 'Template updated successfully';
      this._showEditorToast(successMsg, 'success');
      console.log('[WorkflowEditor] ✓ Template updated:', this.templateId);

      this._hasUnsavedChanges = false;

      // Emit event để refresh template list nếu cần
      if (window.eventBus) {
        window.eventBus.emit('template:updated', { templateId: this.templateId });
      }
      // Relay to sidebar (popup has separate eventBus instance)
      try {
        chrome.runtime.sendMessage({ action: 'templateUpdated', templateId: this.templateId });
      } catch (e) { /* ignore */ }

    } catch (error) {
      // Local mode "không sửa được template gốc" là kỳ vọng (không có backend) → log nhẹ, không đỏ panel.
      if (error?._localExpected) {
        console.log('[WorkflowEditor] Bỏ qua cập nhật template ở local mode:', error.message);
      } else {
        console.error('[WorkflowEditor] Cập nhật template thất bại:', error);
      }

      let errorMessage = error.message || (window.I18n?.t('workflow.updateTemplateFailed') || 'Không thể cập nhật template');

      // Xử lý các loại lỗi cụ thể
      if (error.httpStatus === 401 || error.code === 'UNAUTHENTICATED') {
        errorMessage = window.I18n?.t('auth.sessionExpired') || 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
      } else if (error.httpStatus === 403) {
        errorMessage = window.I18n?.t('workflow.noPermission') || 'Bạn không có quyền cập nhật template này';
      } else if (error.httpStatus === 404) {
        errorMessage = window.I18n?.t('workflow.templateNotFound') || 'Template không tồn tại hoặc đã bị xóa';
      } else if (error.httpStatus >= 500) {
        errorMessage = window.I18n?.t('common.serverError') || 'Lỗi máy chủ. Vui lòng thử lại sau.';
      }

      this._showEditorToast(errorMessage, 'error');

    } finally {
      this._isSaving = false;
      // Re-enable buttons
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = saveBtnOrigText || (window.I18n?.t('workflow.updateTemplate') || 'Cập nhật Template');
      }
      if (resetBtn) resetBtn.disabled = false;
      if (closeBtn) closeBtn.disabled = false;

      // Process pending save request (consistency với saveWorkflow)
      if (this._pendingSaveRequest) {
        this._pendingSaveRequest = false;
        console.log('[WorkflowEditor] Processing queued template update');
        setTimeout(() => this._updateTemplate().catch(e => console.warn('[WorkflowEditor] Queued template update failed:', e)), 50);
      }
    }
  }

  /**
   * EWT-10: Tạo template mới (khi isTemplateMode=true và templateId=null)
   * Mở SaveTemplateModal để nhập metadata và lưu lên server
   */
  async _createTemplate() {
    // Kiểm tra quyền admin
    if (!window.featureGate?.canManageWorkflowTemplates()) {
      window.showNotification?.(
        window.I18n?.t('workflow.adminRequired') || 'Bạn cần quyền admin để tạo template',
        'error'
      );
      return;
    }

    // Kiểm tra SaveTemplateModal đã load chưa
    if (!window.SaveTemplateModal) {
      console.error('[WorkflowEditor] SaveTemplateModal chưa được load');
      window.showNotification?.(
        window.I18n?.t('workflow.saveTemplateModuleNotReady') || 'Module SaveTemplateModal chưa sẵn sàng',
        'error'
      );
      return;
    }

    // Kiểm tra diagramCanvas
    if (!this.diagramCanvas) {
      window.showNotification?.(
        window.I18n?.t('workflow.noWorkflowData') || 'Không có dữ liệu workflow',
        'error'
      );
      return;
    }

    try {
      // Export nodes và edges từ Drawflow
      const { nodes, edges } = this.diagramCanvas.exportWorkflow();

      // Kiểm tra có nodes không
      if (!nodes || nodes.length === 0) {
        window.showNotification?.(
          window.I18n?.t('workflow.templateNeedsNodes') || 'Template cần có ít nhất một node',
          'warning'
        );
        return;
      }

      const templateName = this.overlay?.querySelector('#workflowName')?.value?.trim() ||
                           this.templateData?.name ||
                           (window.I18n?.t('workflow.newTemplateName') || 'Template mới');

      // Tạo workflow data object để truyền vào SaveTemplateModal
      const workflowData = {
        wf_name: templateName,
        description: this.templateData?.description || '',
        nodes: nodes,
        edges: edges,
        settings: this.workflow?.settings || {}
      };

      console.log('[WorkflowEditor] Mở SaveTemplateModal để tạo template mới:', workflowData);

      // Mở modal SaveTemplateModal
      const result = await window.SaveTemplateModal.show(workflowData);

      if (result?.success && result?.template) {
        console.log('[WorkflowEditor] Template đã được tạo:', result.template);

        // Cập nhật state để chuyển sang edit mode cho template đã tạo
        this.templateId = result.template.id;
        this.templateData = {
          name: result.template.name,
          description: result.template.description || '',
          category_id: result.template.category_id,
          thumbnail_url: result.template.thumbnail_url || result.template.thumbnail,
          video_url: result.template.video_url || null,
          is_premium: result.template.is_premium || false,
          is_featured: result.template.is_featured || false,
          // Backend returns is_active, frontend uses is_published internally
          is_published: (result.template.is_active !== undefined ? result.template.is_active : result.template.is_published) !== false,
        };

        // Cập nhật UI
        this._hasUnsavedChanges = false;

        // Re-render header để cập nhật button text từ "Lưu Template" → "Cập nhật Template"
        const saveBtn = this.overlay?.querySelector('#saveWorkflowBtn');
        if (saveBtn) {
          saveBtn.textContent = window.I18n?.t('workflow.updateTemplate') || 'Cập nhật Template';
        }

        // Emit event để refresh template list
        if (window.eventBus) {
          window.eventBus.emit('template:created', { templateId: this.templateId });
        }
        // Relay to sidebar (popup has separate eventBus instance)
        try {
          chrome.runtime.sendMessage({ action: 'templateCreated', templateId: this.templateId });
        } catch (e) { /* ignore */ }
      }
    } catch (error) {
      console.error('[WorkflowEditor] Lỗi khi tạo template:', error);
      window.showNotification?.(
        (window.I18n?.t('workflow.createTemplateFailed') || 'Không thể tạo template') + ': ' + error.message,
        'error'
      );
    }
  }

  /**
   * Chuyển đổi nodes từ workflow format sang template format
   * Đồng bộ với SaveTemplateModal._extractNodeData để đảm bảo không mất dữ liệu
   * @param {Array} nodes - Nodes từ DiagramCanvas
   * @returns {Array} Template nodes
   */
  _convertNodesToTemplateFormat(nodes) {
    return nodes.map(node => {
      // Ưu tiên ref_img_urls có sẵn (template mode lưu trực tiếp), fallback sang convert từ ref_thumbnails
      let refImgUrls = [];
      if (Array.isArray(node.ref_img_urls) && node.ref_img_urls.length > 0) {
        refImgUrls = node.ref_img_urls;
        console.log('[WorkflowEditor] _convertNodesToTemplateFormat - node has ref_img_urls:', node.node_id, refImgUrls);
      } else if (node.ref_thumbnails && typeof node.ref_thumbnails === 'object') {
        for (const [key, value] of Object.entries(node.ref_thumbnails)) {
          const url = typeof value === 'string' ? value : value?.thumbnail;
          if (url && !url.startsWith('data:')) {
            refImgUrls.push(url);
          }
        }
      }

      // Build data object với tất cả fields cần thiết (sync với SaveTemplateModal._extractNodeData)
      const data = {
        // Core fields
        node_name: node.node_name || '',
        label: node.node_name || node.node_type || '',
        prompt: node.prompt || '',
        model: node.model || '',
        ratio: node.ratio || '1:1',
        quantity: node.quantity || 1,
        enabled: node.enabled !== false,
        media_type: node.media_type || 'Image',
        gen_type: node.gen_type || 'flow',
        // Ref images
        ref_img_urls: refImgUrls,
        // EWT-12: Template result preview image
        result_img_url: node.result_img_url || '',
      };

      // Copy các field bổ sung nếu có giá trị (sync với SaveTemplateModal._extractNodeData)
      const copyFields = [
        // Core settings
        'auto_download', 'retry_on_fail', 'style_weight', 'quality',
        'negative_prompt', 'seed', 'cfg_scale', 'steps',
        'video_duration', 'video_fps', 'aspect_ratio', 'node_zoom',
        'system_prompt', 'temperature', 'max_tokens',
        // Phase 1 — Node Reference System: slug + mention modes
        'slug', 'slug_auto', 'prompt_mode', 'ref_mode',
        // Ref file names
        'ref_file_names',
        // Angle preset fields
        'angle_preset_id', 'angle_preset_name', 'angle_preset_json',
        'angle_rotation', 'angle_tilt', 'angle_zoom', 'angle_ratio', 'angle_built_prompt',
        // Download settings
        'download_resolution', 'video_download_resolution', 'download_folder',
        'download_file_template', 'download_collect_all', 'delay_seconds', 'note_text', 'note_color', 'note_font_size', 'note_width', 'note_height',
        // Telegram settings
        'telegram_chat_id', 'telegram_send_mode', 'telegram_message', 'telegram_caption',
        // Provider settings (ChatGPT/Grok)
        'provider', 'prompt_source', 'multi_prompt', 'enhance', 'enhance_model',
        'timeout_sec', 'timeout_ms', 'use_fallback_prefix', 'max_ref_images',
        // Grok specific
        'grok_mode', 'grok_duration', 'grok_resolution', 'grok_image_quality',
        // Video specific
        'video_input_type', 'frame_1_source', 'frame_1_file_name', 'frame_1_thumbnail',
        'frame_2_source', 'frame_2_file_name', 'frame_2_thumbnail',
        // Prompts JSON (for multi-prompt nodes)
        'prompts_json'
      ];

      copyFields.forEach(field => {
        if (node[field] !== undefined) {
          data[field] = node[field];
        }
      });

      return {
        id: node.node_id,
        type: node.node_type,
        name: node.node_name || node.node_type,
        position: {
          x: node.pos_x || 100,
          y: node.pos_y || 100,
        },
        enabled: node.enabled !== false,
        data,
      };
    });
  }

  /**
   * Chuyển đổi edges từ workflow format sang template format
   * @param {Array} edges - Edges từ DiagramCanvas
   * @returns {Array} Template edges
   */
  _convertEdgesToTemplateFormat(edges) {
    return edges
      .map(edge => ({
        // Backend requires edge id
        id: edge.edge_id || (window.IdGenerator ? window.IdGenerator.next('edge') : `edge_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`),
        // Backend expects source/target for node IDs
        source: edge.source_node_id || edge.source_node || edge.source,
        target: edge.target_node_id || edge.target_node || edge.target,
        // Backend expects sourceHandle/targetHandle (camelCase), NOT output_class/input_class
        sourceHandle: edge.source_handle || edge.output_class || 'output_1',
        targetHandle: edge.target_handle || edge.input_class || 'input_1',
        // GAP BUG #3 FIX: Backend also expects sourcePort/targetPort (human-readable port names)
        // These are used in cloneToWorkflow to populate Edge.source_port/target_port columns
        sourcePort: edge.source_port || null,
        targetPort: edge.target_port || null,
        // Include data_type for edge typing
        dataType: edge.data_type || 'image',
      }))
      .filter(edge => edge.source && edge.target); // Filter out invalid edges
  }

  // === Export Workflow Methods ===

  /**
   * Export workflow as JSON file.
   * Path live Drawflow — đọc nodes/edges từ DiagramCanvas in-memory state.
   * Logic format chia sẻ với WorkflowList.exportWorkflow qua WorkflowExportHelper.
   */
  async exportWorkflow() {
    // Feature gate check — show upgrade dialog (consistent với _shareWorkflow pattern).
    // Bug 30 fix (2026-05-19): trước fix dùng toast "Premium" — UX không cho user
    // path nâng cấp. Sau fix: dùng showModuleBlockedDialog để hiện upgrade button.
    if (window.featureGate && !window.featureGate.canUse('workflow_export')) {
      if (typeof window.featureGate.showModuleBlockedDialog === 'function') {
        window.featureGate.showModuleBlockedDialog('workflow_export');
      } else {
        const label = window.featureGate.getCrownLabel?.('workflow_export') || 'Premium';
        window.showNotification?.(
          window.I18n?.t('workflow.exportLocked') || `Export workflow: ${label}`,
          'warning'
        );
      }
      return;
    }

    if (!this.workflow || !this.diagramCanvas) {
      const dialog = window.customDialog || window.CustomDialog;
      dialog?.alert(window.I18n?.t('workflow.noWorkflowToExport') || 'Chưa có workflow để xuất', { type: 'warning' });
      return;
    }

    try {
      // Get current workflow data từ Drawflow live state
      const { nodes, edges } = this.diagramCanvas.exportWorkflow();
      const workflowName = this.overlay?.querySelector('#workflowName')?.value?.trim() || this.workflow.wf_name;

      // Build + download via shared helper (đồng nhất với WorkflowList.exportWorkflow path)
      const exportData = window.WorkflowExportHelper.buildExportData(
        workflowName,
        this.workflow.description,
        this.workflow,
        nodes,
        edges
      );
      const filename = window.WorkflowExportHelper.buildExportFilename(workflowName);
      window.WorkflowExportHelper.downloadJson(exportData, filename);

      console.log('[SEOSONA Flow] Workflow exported:', filename);
    } catch (error) {
      console.error('[SEOSONA Flow] Export failed:', error);
      const dialog = window.customDialog || window.CustomDialog;
      dialog?.alert((window.I18n?.t('workflow.exportFailed') || 'Xuất workflow thất bại') + ': ' + error.message, { type: 'error' });
    }
  }

  // _buildExportData, _convertNodesToExport, _buildExportFilename, _downloadJson đã chuyển sang
  // src/shared/WorkflowExportHelper.js — shared với WorkflowList.exportWorkflow để tránh logic skew.

  /**
   * Mở modal chia sẻ workflow.
   * Chỉ cho phép khi workflow đã được save và không phải read-only.
   */
  _shareWorkflow() {
    if (this.isReadOnly()) {
      console.log('[WorkflowEditor] _shareWorkflow() blocked - read-only mode');
      return;
    }
    if (!this.workflow?.wf_id) {
      window.customDialog?.alert(
        window.I18n?.t('workflow.saveBeforeShare') || 'Vui lòng lưu workflow trước khi chia sẻ.',
        { type: 'warning' }
      );
      return;
    }
    // Check feature gate
    if (window.featureGate && !window.featureGate.canUse('workflow_share_enabled')) {
      window.featureGate.showModuleBlockedDialog('workflow_share');
      return;
    }
    // Gọi ShareWorkflowModal nếu có
    if (window.ShareWorkflowModal?.show) {
      window.ShareWorkflowModal.show(this.workflow.wf_id);
    } else {
      console.warn('[WorkflowEditor] ShareWorkflowModal not found');
      window.customDialog?.alert(
        window.I18n?.t('workflow.shareNotAvailable') || 'Chức năng chia sẻ chưa sẵn sàng.',
        { type: 'info' }
      );
    }
  }

  /**
   * 2026-05-27: Gắn nút zoom (giữa thumb) — hover hiện, click mở media viewer.
   * Phần thumb ngoài nút vẫn drag node được (chỉ nút có pointer-events). Idempotent.
   * @param {HTMLElement} thumb - .df-preview-thumb element (đã set data-media-src)
   */
  _attachThumbZoom(thumb) {
    if (!thumb || thumb.querySelector('.df-preview-zoom')) return;
    // Video → icon play; image → icon kính lúp (zoom) như cũ.
    const isVideo = thumb.dataset.mediaType === 'video' || !!thumb.querySelector('video');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'df-preview-zoom nodrag';
    btn.title = window.I18n?.t('workflow.viewMedia') || 'Xem';
    btn.innerHTML = isVideo
      ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>';
    thumb.appendChild(btn);
  }

  /**
   * 2026-05-25: Media viewer modal — hiển thị image/video full screen khi user click thumb.
   * Video có controls (play/pause/sound/seek) + autoplay với sound (user-initiated).
   * Image hiển thị fit screen với max constraints.
   *
   * @param {Object} opts
   * @param {string} opts.src - URL của media (image src hoặc video stream URL)
   * @param {string} opts.type - 'image' | 'video'
   * @param {string} [opts.poster] - Poster thumbnail URL cho video (optional)
   */
  _showMediaViewer({ src, type, poster } = {}) {
    if (!src) return;

    // Cleanup any existing viewer (defensive — tránh duplicate khi user click nhanh)
    document.querySelectorAll('.wf-media-viewer-overlay').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'wf-media-viewer-overlay';

    let mediaEl;
    if (type === 'video') {
      mediaEl = document.createElement('video');
      mediaEl.src = src;
      mediaEl.controls = true;
      mediaEl.autoplay = true;
      mediaEl.playsInline = true;
      // KHÔNG muted — user expects sound khi click vào video result
      mediaEl.muted = false;
      if (poster) mediaEl.poster = poster;
    } else {
      mediaEl = document.createElement('img');
      mediaEl.src = src;
      mediaEl.alt = 'preview';
    }
    mediaEl.className = 'wf-media-viewer-content';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'wf-media-viewer-close';
    closeBtn.setAttribute('aria-label', window.I18n?.t?.('common.close') || 'Close');
    closeBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    overlay.appendChild(mediaEl);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);

    // Cleanup function — unbind listeners + remove DOM
    const cleanup = () => {
      try {
        // Pause video trước khi remove để tránh sound playing trong background
        if (mediaEl.tagName === 'VIDEO') {
          mediaEl.pause();
          mediaEl.src = '';
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#cleanup', _); }
      document.removeEventListener('keydown', escHandler);
      overlay.remove();
    };

    // ESC key đóng
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
      }
    };
    document.addEventListener('keydown', escHandler);

    // Click overlay (outside media) đóng
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup();
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cleanup();
    });

    // Prevent click on media element from bubbling to overlay (đóng modal)
    mediaEl.addEventListener('click', (e) => e.stopPropagation());
  }

  /**
   * Mở admin template editor để chỉnh sửa template (admin only).
   * Đóng preview window hiện tại + uỷ quyền cho WorkflowTemplateList ở sidebar
   * mở admin template editor (workflow-template-editor.html).
   */
  _editTemplateFromPreview() {
    const tplId = this.workflow?._template_id;
    if (!tplId) return;

    if (window.workflowTemplateList?._openTemplateForEdit) {
      // Sidebar context — gọi trực tiếp
      try { this._forceClose(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_editTemplateFromPreview', e); }
      window.workflowTemplateList._openTemplateForEdit(tplId);
    } else {
      // Popup window context — gửi message tới sidebar VÀ ĐỢI ack rồi mới đóng window.
      // Race: nếu window.close() chạy trước khi message deliver → sidebar không nhận → action mất.
      this._sendMessageThenClose({ action: 'editWorkflowTemplate', templateId: tplId });
    }
  }

  /**
   * Đóng popup window nếu đang chạy trong popup, ngược lại đóng overlay.
   * Tránh trường hợp overlay bị xóa nhưng popup window vẫn mở → màn hình trống đen.
   */
  _closePopupWindowOrOverlay() {
    const isPopup = !!(window.location?.pathname?.endsWith('workflow-editor.html'));
    if (isPopup) {
      try { window.close(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_closePopupWindowOrOverlay', e); }
    } else {
      try { this._forceClose(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_closePopupWindowOrOverlay', e); }
    }
  }

  /**
   * Send message qua chrome.runtime.sendMessage, ĐỢI callback (ack) rồi mới đóng window.
   * Tránh race: window.close() chạy trước khi MV3 service worker deliver message → mất action.
   * Có timeout 1s phòng SW không response, fallback close ngay.
   */
  _sendMessageThenClose(payload) {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      this._closePopupWindowOrOverlay();
    };
    try {
      chrome.runtime.sendMessage(payload, () => {
        // Ignore lastError; chỉ cần callback fire = message đã được deliver/handle
        close();
      });
      // Fallback: nếu callback không fire trong 1s thì close anyway
      setTimeout(close, 1000);
    } catch (e) {
      console.warn('[WorkflowEditor] sendMessage failed:', e?.message);
      close();
    }
  }

  /**
   * Router cho action duplicate ở read-only mode.
   * - Template preview → clone template qua WorkflowTemplateList._copyTemplateToWorkflow
   * - Shared workflow  → cloneFromShared
   */
  _handleReadOnlyDuplicate() {
    if (this.workflow?._is_template_preview && this.workflow._template_id) {
      // Clone template — uỷ quyền cho WorkflowTemplateList nếu có (sidebar context)
      const tplId = this.workflow._template_id;
      console.log('[CloneDebug] _handleReadOnlyDuplicate: tplId=', tplId, 'hasWTL=', !!window.workflowTemplateList?._copyTemplateToWorkflow, 'community=', !!this.workflow?._is_community_template, 'hasOrigTpl=', !!this.workflow?._original_template);
      if (window.workflowTemplateList?._copyTemplateToWorkflow) {
        // Đóng editor preview trước rồi clone (sidebar)
        this._forceClose();
        window.workflowTemplateList._copyTemplateToWorkflow(tplId, this.workflow?._original_template || null);
      } else {
        // Popup window context (official + community): gửi cloneWorkflowTemplate cho sidebar (LUÔN mở) →
        // _copyTemplateToWorkflow hiện modal "Use" + clone đầy đủ, rồi ĐÓNG popup (đợi ack tránh race deliver).
        // Truyền template (community KHÔNG nằm trong sidebar this.templates → find fail; official thì null
        // → sidebar tự find trong this.templates).
        this._sendMessageThenClose({
          action: 'cloneWorkflowTemplate',
          templateId: tplId,
          template: this.workflow?._original_template || null,
        });
      }
      return;
    }

    // Shared workflow → clone
    return this.cloneFromShared();
  }

  /**
   * Clone workflow từ shared view về thành workflow riêng của user.
   * POST /v1/shared-workflows/{wf_id}/clone
   */
  async cloneFromShared() {
    if (!this.workflow?.wf_id) {
      console.error('[WorkflowEditor] cloneFromShared: no wf_id');
      return;
    }

    try {
      const baseUrl = window.ApiBaseConfig.get();
      const token = await window.authManager?.getToken?.();
      if (!token) {
        window.customDialog?.alert(
          window.I18n?.t('workflow.loginRequired') || 'Vui lòng đăng nhập để sử dụng tính năng này.',
          { type: 'warning' }
        );
        return;
      }

      const response = await fetch(`${baseUrl}/shared-workflows/${this.workflow.wf_id}/clone`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Extension-Id': chrome.runtime.id,
        }
      });

      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Backend trả shape: { success: false, error: { code, message, data } }
        const errCode = json?.error?.code || json?.code;
        const errMsg = json?.error?.message || json?.message || `HTTP ${response.status}`;
        const errData = json?.error?.data || json?.data || {};

        // QUOTA_EXCEEDED, FEATURE_DISABLED → show modal có nút Upgrade
        if (errCode === 'QUOTA_EXCEEDED' || errCode === 'FEATURE_DISABLED') {
          const upgrade = await window.customDialog?.confirm(errMsg, {
            title: window.I18n?.t('workflow.quotaReached') || 'Limit reached',
            type: 'warning',
            confirmText: window.I18n?.t('common.upgrade') || 'Upgrade',
            cancelText: window.I18n?.t('common.later') || 'Later',
          });
          if (upgrade) {
            // Fallback: gửi message tới sidebar (app.js handle 'showUpgradeModal').
            try {
              chrome.runtime.sendMessage({ action: 'showUpgradeModal' });
            } catch (e) {
              console.warn('[WorkflowEditor] Cannot open upgrade modal:', e);
            }
          }
          return;
        }

        // Lỗi khác — alert đơn giản với message từ backend
        window.customDialog?.alert(errMsg, { type: 'error' });
        return;
      }

      const data = json.data || json;
      const newWorkflow = data.workflow || data;

      // Hiển thị thông báo thành công
      window.showNotification?.(
        window.I18n?.t('workflow.duplicateSuccess') || 'Workflow duplicated successfully!',
        'success'
      );

      // Sidebar context: refresh workflow list + mở workflow mới ngay tại sidebar editor.
      // Popup window context: gửi message để sidebar refresh + mở workflow, rồi đóng popup.
      const isPopup = !!(window.location?.pathname?.endsWith('workflow-editor.html'));
      if (isPopup) {
        // Notify sidebar to refresh and open new workflow
        try {
          chrome.runtime.sendMessage({
            action: 'workflowClonedFromShared',
            workflow: newWorkflow,
          });
        } catch (e) { /* ignore */ }
        try { window.close(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#cloneFromShared', e); }
      } else {
        this._forceClose();
        if (window.workflowEditor && newWorkflow.wf_id) {
          if (window.workflowList?.loadWorkflows) {
            await window.workflowList.loadWorkflows();
          }
          // Refresh featureGate để update quota
          if (window.featureGate) {
            window.featureGate.refresh({ force: true }).catch(e => console.warn('[WorkflowEditor] FeatureGate refresh failed:', e));
          }
          window.workflowEditor.open('edit', newWorkflow);
        }
      }

      console.log('[WorkflowEditor] Duplicated shared workflow:', newWorkflow.wf_id);
    } catch (error) {
      console.error('[WorkflowEditor] Duplicate from shared failed:', error);
      window.customDialog?.alert(
        (window.I18n?.t('workflow.duplicateFailed') || 'Không thể tạo bản sao workflow') + ': ' + error.message,
        { type: 'error' }
      );
    }
  }


  /**
   * Clear _tileCache entries that came from node results (keep ref image entries)
   */
  _clearResultTileCache() {
    if (!this.workflow?.nodes) return;
    const refIds = new Set();
    for (const node of this.workflow.nodes) {
      if (node.ref_file_ids) {
        node.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean).forEach(id => refIds.add(id));
      }
    }
    // Remove entries not in any ref_file_ids
    for (const [key] of this._tileCache) {
      if (!refIds.has(key)) {
        this._tileCache.delete(key);
      }
    }
  }

  _updateNodeStatusUI(nodeId, status) {
    if (!this.overlay || !nodeId) return;

    // Find drawflow node ID from node_id
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) {
      console.warn(`[WorkflowEditor] _updateNodeStatusUI: drawflowId not found for nodeId=${nodeId}`);
      return;
    }

    const nodeEl = this.overlay.querySelector(`#node-${drawflowId}`);
    if (!nodeEl) {
      console.warn(`[WorkflowEditor] _updateNodeStatusUI: nodeEl not found for drawflowId=${drawflowId}`);
      return;
    }

    // Debug log for node status update
    const nodeType = nodeEl.querySelector('.df-node')?.dataset?.nodeType || 'unknown';
    console.log(`[WorkflowEditor] _updateNodeStatusUI: nodeId=${nodeId}, status=${status}, nodeType=${nodeType}, drawflowId=${drawflowId}`);

    // Update status dot
    const statusDot = nodeEl.querySelector('.df-node-status');
    if (statusDot) {
      statusDot.className = `df-node-status ${status}`;
    }

    // Add/remove running highlight on the whole node
    nodeEl.classList.remove('node-running', 'node-completed', 'node-failed', 'node-skipped');
    // Remove loading overlay nếu có
    const existingLoader = nodeEl.querySelector('.df-node-loading');
    if (existingLoader) {
      existingLoader.remove();
      // Bug fix 2026-05-30: Loader removal đổi node height → connection lines lệch port.
      // Schedule refresh để Drawflow recompute edge paths sau next paint.
      this._scheduleConnectionRefresh?.();
    }

    // Toggle connection active animation (dashed flow) trên outbound edges từ node này
    // → user thấy data "đang truyền" sang downstream nodes (matching screenshot).
    this._setNodeConnectionsActive(drawflowId, status === 'running');

    if (status === 'running') {
      nodeEl.classList.add('node-running');
      // Image node: GIỮ NGUYÊN ref preview — KHÔNG replace bằng shimmer, KHÔNG
      // append loading pill. Tín hiệu running thuần qua:
      //   1. Glow border node-running + pulse (background)
      //   2. CSS gradient overlay ::after lên .df-node-preview (foreground sweep)
      //      → user thấy ảnh ref vẫn rõ + lớp gradient "đang xử lý" chạy ngang.
      const isImageNode = nodeEl.querySelector('.df-node[data-node-type="image"]') !== null;
      if (isImageNode) {
        // Skip mọi loading UI replace — CSS .node-running .df-node-preview::after
        // tự render gradient overlay (xem workflow.css). KHÔNG cần thêm DOM.
      } else {
        // Other node types (generate/prompt/download/grok/chatgpt/etc.): replace preview với shimmer
        const previewEl = nodeEl.querySelector('.df-node-preview');
        if (previewEl) {
          // Lock height TRƯỚC khi swap placeholder/thumbs → shimmer.
          // Tránh node co lại trong transition (shimmer chưa fill aspect-ratio class height).
          this._lockPreviewHeight?.(previewEl);
          previewEl.classList.remove('hidden', 'image-ref');
          previewEl.innerHTML = `
            <div class="df-node-loading-shimmer">
              <span class="df-node-loading-text">${window.I18n?.t('workflow.processing') || 'Processing...'}</span>
            </div>`;
          // Bug fix 2026-05-27: shimmer (không có height nội tại) → aspect-ratio class áp lại → box có
          // thể resize so với thumbnail cũ (ratio khác) → edges lệch. Reposition connections sau resize.
          this._scheduleConnectionRefresh?.();
        } else {
          // Fallback: append loading pill cuối node body
          const loader = document.createElement('div');
          loader.className = 'df-node-loading';
          loader.innerHTML = `
            <div class="df-node-loading-spinner"></div>
            <span class="df-node-loading-text">${window.I18n?.t('workflow.processing') || 'Processing...'}</span>
          `;
          const contentNode = nodeEl.querySelector('.drawflow_content_node');
          if (contentNode) {
            contentNode.appendChild(loader);
            // Bug fix 2026-05-30: append loader làm node cao hơn → port out shift xuống → connection lệch.
            // Schedule refresh sau next paint để Drawflow recompute edge paths.
            this._scheduleConnectionRefresh?.();
          }
        }
      }
    } else if (status === 'completed') {
      nodeEl.classList.add('node-completed');
    } else if (status === 'failed') {
      nodeEl.classList.add('node-failed');
    } else if (status === 'skipped') {
      nodeEl.classList.add('node-skipped');
    } else if (status === 'pending') {
      // Clear result preview khi reset (giữ ref preview)
      const previewEl = nodeEl.querySelector('.df-node-preview');
      if (previewEl && !previewEl.classList.contains('image-ref')) {
        // Restore placeholder SVG (giống NodeTemplates gốc)
        previewEl.innerHTML = `<div class="df-node-preview-placeholder">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
        </div>`;
        previewEl.classList.remove('hidden');
      }
    }

    // Log
    // Log chi tiết đã emit qua execution:log từ WorkflowExecutor
  }

  /**
   * Toggle `.connection-active` class on tất cả INCOMING connections vào node `drawflowId`.
   * Drawflow generates SVG với class pattern: `connection node_in_node-<targetId> node_out_node-<sourceId>`.
   * Animate incoming edges = "đang truyền data vào node running" (đúng logic execution flow:
   * upstream node đã completed → data đang chảy đến node hiện tại đang xử lý).
   * Outbound edges KHÔNG animate vì chưa có output (chỉ active khi downstream nhận data sau).
   */
  _setNodeConnectionsActive(drawflowId, active) {
    if (!this.overlay || !drawflowId) return;
    try {
      const selector = `svg.connection.node_in_node-${drawflowId}`;
      const connections = this.overlay.querySelectorAll(selector);
      connections.forEach((conn) => {
        conn.classList.toggle('connection-active', active);
      });
    } catch (e) {
      console.warn('[WorkflowEditor] _setNodeConnectionsActive error:', e?.message);
    }
  }

  /**
   * UI 2026-05-27: highlight (đổi màu bright) TẤT CẢ connection chạm tới node đang select
   * (cả incoming `node_in` lẫn outgoing `node_out`). Clear selection cũ trước khi set mới.
   * Class `conn-node-selected` — tách biệt với `.selected` (click chọn edge) và
   * `.connection-active` (running). Truyền `drawflowId=null` để chỉ clear.
   */
  _setNodeConnectionsSelected(drawflowId) {
    if (!this.overlay) return;
    try {
      // Clear highlight cũ
      this.overlay.querySelectorAll('svg.connection.conn-node-selected')
        .forEach((conn) => conn.classList.remove('conn-node-selected'));
      if (!drawflowId) return;
      this.overlay
        .querySelectorAll(`svg.connection.node_in_node-${drawflowId}, svg.connection.node_out_node-${drawflowId}`)
        .forEach((conn) => conn.classList.add('conn-node-selected'));
    } catch (e) {
      console.warn('[WorkflowEditor] _setNodeConnectionsSelected error:', e?.message);
    }
  }

  /**
   * Defensive helper — re-scan tất cả nodes đang `.node-running` và đảm bảo incoming
   * connections của chúng có class `.connection-active`. Gọi từ `node:moved` event
   * để chống mất animation khi user drag node trong lúc workflow đang chạy.
   * Idempotent — gọi nhiều lần không gây side effect.
   */
  _reapplyRunningConnections() {
    if (!this.overlay) return;
    // Clear all active classes trước, rồi re-apply theo node-running hiện tại
    // (tránh stale class trên connection nếu node đã unstaged khỏi running).
    this.overlay.querySelectorAll('svg.connection.connection-active')
      .forEach((conn) => conn.classList.remove('connection-active'));
    const runningNodes = this.overlay.querySelectorAll('.drawflow-node.node-running');
    runningNodes.forEach((nodeEl) => {
      const drawflowId = nodeEl.id?.replace('node-', '');
      if (drawflowId) this._setNodeConnectionsActive(drawflowId, true);
    });
  }

  _updateNodeLoadingText(nodeId, text) {
    if (!this.overlay || !nodeId) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;
    const nodeEl = this.overlay.querySelector(`#node-${drawflowId}`);
    const loadingText = nodeEl?.querySelector('.df-node-loading-text');
    if (loadingText) loadingText.textContent = text;
  }

  /**
   * 2026-05-30: Update AI Output section trong prompt node sau AI run complete.
   * Drawflow.updateNodeDataFromId() update internal data nhưng KHÔNG re-render HTML template
   * → AI Output container trong template (NodeTemplates) chỉ render lúc tạo node.
   * Function này manually update/create AI Output container DOM với fresh result_text.
   *
   * REPLACE legacy `.df-node-prompt-result` element bằng `.df-ai-output-container` mới.
   */
  _updatePromptNodeResultPreview(nodeId, data) {
    if (!this.overlay || !nodeId) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;

    const resultText = data?.result_text || '';
    const promptText = data?.prompt || '';
    const provider = data?.provider || 'chatgpt';
    const useAi = !!data?.use_ai;
    // Skip nếu no result OR result same prompt (plain mode) OR use_ai OFF.
    const shouldShow = useAi && resultText && resultText.trim() !== promptText.trim();

    const nodeEl = this.overlay.querySelector(`#node-${drawflowId}`);
    const nodeBody = nodeEl?.querySelector('.df-node-body');
    if (!nodeBody) return;

    // Cleanup legacy element nếu render cũ còn tồn tại
    const legacyEl = nodeBody.querySelector('.df-node-prompt-result');
    if (legacyEl) legacyEl.remove();

    let aiOutputEl = nodeBody.querySelector('.df-ai-output-container');

    if (!shouldShow) {
      // Remove AI Output section nếu condition KHÔNG match (vd plain mode hoặc empty)
      if (aiOutputEl) {
        aiOutputEl.remove();
        this._scheduleConnectionRefresh();
      }
      return;
    }

    const providerLabel = provider === 'gemini' ? 'Gemini' : 'ChatGPT';
    const aiOutputLabel = window.I18n?.t?.('node.aiOutputLabel') || 'AI Output';
    const formatted = window.NodeTemplates?.formatPromptWithMentions
      ? window.NodeTemplates.formatPromptWithMentions(resultText)
      : this.escapeHtml(resultText);

    if (!aiOutputEl) {
      // CREATE new container — match template structure (NodeTemplates.js line ~530)
      aiOutputEl = document.createElement('div');
      aiOutputEl.className = 'df-ai-output-container nodrag';
      aiOutputEl.innerHTML = `
        <div class="df-ai-output-label">
          <svg class="df-ai-output-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/>
          </svg>
          <span class="df-ai-output-label-text">${this.escapeHtml(aiOutputLabel)}</span>
          <span class="df-ai-output-provider">${this.escapeHtml(providerLabel)}</span>
        </div>
        <div class="df-ai-output-text"></div>
      `;
      // Insert BEFORE settings bar (template order: AI Output → settings bar → ref preview)
      const settingsBar = nodeBody.querySelector('.df-node-settings-bar');
      if (settingsBar) {
        nodeBody.insertBefore(aiOutputEl, settingsBar);
      } else {
        nodeBody.appendChild(aiOutputEl);
      }
    } else {
      // UPDATE provider label nếu đã có (vd user đổi provider giữa runs)
      const providerEl = aiOutputEl.querySelector('.df-ai-output-provider');
      if (providerEl) providerEl.textContent = providerLabel;
    }

    // Update text content (innerHTML để support @mention formatting)
    const textEl = aiOutputEl.querySelector('.df-ai-output-text');
    if (textEl) textEl.innerHTML = formatted;

    this._scheduleConnectionRefresh();
  }

  /**
   * 2026-05-31: Update extracted text section trên text_extract node sau khi run.
   * Mirror pattern _updatePromptNodeResultPreview nhưng không có provider label (text_extract
   * pure regex/JSON, không gọi AI). Selector data-extract-output để phân biệt với prompt AI.
   */
  _updateExtractNodeResultPreview(nodeId, data) {
    if (!this.overlay || !nodeId) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;

    const resultText = (data?.result_text || '').trim();
    const nodeEl = this.overlay.querySelector(`#node-${drawflowId}`);
    const nodeBody = nodeEl?.querySelector('.df-node-body');
    if (!nodeBody) return;

    let outputEl = nodeBody.querySelector('[data-extract-output]');

    if (!resultText) {
      // Remove section khi không có result (vd reset node hoặc extract fail)
      if (outputEl) {
        outputEl.remove();
        this._scheduleConnectionRefresh();
      }
      return;
    }

    const outputLabel = window.I18n?.t?.('node.extractOutputLabel') || 'Extracted';

    if (!outputEl) {
      // CREATE — match template structure (NodeTemplates.js text_extract block)
      outputEl = document.createElement('div');
      outputEl.className = 'df-ai-output-container nodrag';
      outputEl.setAttribute('data-extract-output', '');
      outputEl.innerHTML = `
        <div class="df-ai-output-label">
          <svg class="df-ai-output-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="8" width="10" height="8" rx="1"/>
          </svg>
          <span class="df-ai-output-label-text">${this.escapeHtml(outputLabel)}</span>
        </div>
        <div class="df-ai-output-text"></div>
      `;
      nodeBody.appendChild(outputEl);
    }

    const textEl = outputEl.querySelector('.df-ai-output-text');
    if (textEl) textEl.textContent = resultText;

    this._scheduleConnectionRefresh();
  }

  /**
   * Clear AI Output section + result data (when re-running or resetting).
   */
  _clearPromptNodeResultPreview(nodeId) {
    if (!this.overlay || !nodeId) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (drawflowId) {
      const nodeEl = this.overlay.querySelector(`#node-${drawflowId}`);
      // Remove cả legacy element + new AI Output container
      const legacyEl = nodeEl?.querySelector('.df-node-prompt-result');
      if (legacyEl) legacyEl.remove();
      const aiOutputEl = nodeEl?.querySelector('.df-ai-output-container');
      if (aiOutputEl) aiOutputEl.remove();
      if (legacyEl || aiOutputEl) this._scheduleConnectionRefresh();
    }
    // Clear from drawflow data
    this._syncDrawflowNodeData(nodeId, { result_text: '', result_source: '' });
  }

  /**
   * Schedule connection paths re-render sau khi DOM của node card thay đổi kích thước
   * (preview area resize do ratio đổi, ref preview append/remove, port count đổi).
   * Defer 2 rAF cho CSS aspect-ratio + reflow settle. Throttle để gộp nhiều caller cùng frame.
   */
  _scheduleConnectionRefresh() {
    if (this._connectionRefreshScheduled) return;
    this._connectionRefreshScheduled = true;
    try {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this._connectionRefreshScheduled = false;
          try { this.diagramCanvas?._forceUpdateAllConnections?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_scheduleConnectionRefresh', e); }
        });
      });
    } catch (e) { this._connectionRefreshScheduled = false; }
  }

  /**
   * Attach ResizeObserver vào image node card → tự re-route connections mỗi khi
   * node thay đổi kích thước (image load, replace ref, reset, CSS transition).
   * Tránh stale SVG paths khi node fit-content shrink/grow.
   *
   * Drawflow positioning dùng port DOM rect → khi node resize, port positions
   * thay đổi nhưng connections KHÔNG tự update. Phải gọi updateConnectionNodes
   * (qua _scheduleConnectionRefresh) để re-compute paths.
   *
   * Idempotent: KHÔNG attach lần 2 nếu đã có observer trên element.
   */
  _attachImageNodeResizeObserver(drawflowId) {
    if (!drawflowId || typeof ResizeObserver === 'undefined') return;
    const nodeEl = this.overlay?.querySelector(`#node-${drawflowId}`);
    if (!nodeEl) return;
    // 2026-05-28: observe MỌI node có preview media co giãn (image + generate/chatgpt/grok) — node
    // resize khi: image/VIDEO result load, ref render, reset, đổi ratio. Trước: chỉ image node →
    // generate/grok/chatgpt gen xong (đặc biệt VIDEO) box resize nhưng connection KHÔNG re-route →
    // link lệch port. Node khác (delay/note/download/prompt/text) size cố định → skip.
    const nodeType = nodeEl.querySelector('.df-node')?.dataset?.nodeType;
    if (!['image', 'generate', 'chatgpt', 'grok'].includes(nodeType)) return;
    if (nodeEl._imgResizeObserver) return; // đã attach

    if (!this._nodeResizeObservers) this._nodeResizeObservers = new Set();
    const observer = new ResizeObserver(() => {
      this._scheduleConnectionRefresh();
    });
    observer.observe(nodeEl);
    nodeEl._imgResizeObserver = observer;
    this._nodeResizeObservers.add(observer);
  }

  /**
   * Cleanup tất cả ResizeObservers (gọi trong _forceClose để tránh leak khi reload editor).
   */
  _cleanupNodeResizeObservers() {
    if (!this._nodeResizeObservers) return;
    for (const obs of this._nodeResizeObservers) {
      try { obs.disconnect(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_cleanupNodeResizeObservers', e); }
    }
    this._nodeResizeObservers.clear();
  }

  _clearNodePreview(nodeId) {
    if (!this.overlay || !nodeId) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;
    const nodeEl = this.overlay.querySelector(`#node-${drawflowId}`);
    const previewContainer = nodeEl?.querySelector('.df-node-preview');
    if (!previewContainer) return;

    // Bug fix: Image source node — `ref_file_ids` là SOURCE DATA của node (user upload),
    // không phải result. Reset node chỉ xóa result_*, giữ ref_* để node "image" tiếp tục
    // serve ảnh source cho downstream. Trước fix: reset xóa ref preview → user phải re-upload.
    const dfNode = this.diagramCanvas?.editor?.getNodeFromId?.(drawflowId);
    const nodeType = dfNode?.data?.node_type || dfNode?.class;
    const refFileIds = dfNode?.data?.ref_file_ids;
    if (nodeType === 'image' && refFileIds) {
      const ids = String(refFileIds).split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length > 0) {
        // Re-render preview từ ref_file_ids (giữ ảnh source)
        this._showNodePreview(nodeId, ids);
        return;
      }
    }

    // Bug fix 2026-05-27: reset từ result grid (multi-result) làm mất/đè class ratio → placeholder
    // sai khung tỷ lệ (vd node 9:16 nhưng placeholder hiển thị rộng). Xóa class result + restore
    // class ratio theo data.ratio (đồng bộ cgRatioClass/genRatioClass của NodeTemplates).
    previewContainer.classList.remove('image-ref', 'hidden', 'multi-result',
      'ratio-9-16', 'ratio-3-4', 'ratio-2-3', 'ratio-1-1', 'ratio-4-3', 'ratio-3-2', 'ratio-16-9');
    const nodeRatio = dfNode?.data?.ratio;
    if (nodeRatio) {
      const rc = this._resolveRatioClass(nodeRatio);
      if (rc) previewContainer.classList.add(rc);
    }
    // Restore placeholder SVG cho MỌI node type khác (đồng bộ với NodeTemplates default render).
    previewContainer.innerHTML = `<div class="df-node-preview-placeholder">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    </div>`;
    this._scheduleConnectionRefresh();
  }

  _showNodePreview(nodeId, fileIds) {
    if (!this.overlay || !nodeId || !fileIds?.length) return;

    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;

    const nodeEl = this.overlay.querySelector(`#node-${drawflowId}`);
    const previewContainer = nodeEl?.querySelector('.df-node-preview');
    if (!previewContainer) return;

    // Image node: hiển thị ảnh đúng ratio (contain thay vì cover)
    const isImageNode = nodeEl.querySelector('.df-node[data-node-type="image"]') !== null;
    previewContainer.classList.toggle('image-ref', isImageNode);

    // Dedup file IDs
    const uniqueIds = [...new Set(fileIds)];

    // Cancel retry trước đó nếu có
    if (previewContainer._retryTimer) {
      clearTimeout(previewContainer._retryTimer);
      previewContainer._retryTimer = null;
    }

    // Tag container with nodeId for thumbnail persistence
    previewContainer._nodeId = nodeId;

    // Retry vài lần vì tiles có thể chưa render xong media
    this._renderNodePreviewWithRetry(previewContainer, uniqueIds, 0);

    // Preview area class change (image-ref toggles aspect-ratio) + image load → height có thể đổi
    this._scheduleConnectionRefresh();
  }

  /**
   * Render ref image thumbnails ở dưới cùng của generate nodes
   * Includes cross-project validation using ref_file_names
   */
  _showNodeRefPreview(nodeId, refIds) {
    if (!this.overlay || !nodeId) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;
    const nodeEl = this.overlay.querySelector(`#node-${drawflowId}`);
    let refContainer = nodeEl?.querySelector('.df-node-ref-preview');

    // Get ref_file_names from node data for cross-project validation
    const nodeData = this.diagramCanvas?.editor?.getNodeFromId(drawflowId)?.data;
    const refFileNames = nodeData?.ref_file_names || null;

    // Tạo container nếu chưa có
    if (!refContainer && refIds?.length > 0) {
      const body = nodeEl?.querySelector('.df-node-body');
      if (!body) return;
      refContainer = document.createElement('div');
      refContainer.className = 'df-node-ref-preview';
      refContainer.setAttribute('data-ref-preview', '');
      body.appendChild(refContainer);
    }
    if (!refContainer) return;

    if (!refIds || refIds.length === 0) {
      refContainer.remove();
      this._scheduleConnectionRefresh();
      return;
    }

    refContainer.innerHTML = '';
    const uniqueIds = [...new Set(refIds)];

    // Append/show ref preview row → node card height tăng → connections cần update
    this._scheduleConnectionRefresh();

    const renderThumbs = () => {
      refContainer.innerHTML = '';
      for (const tileId of uniqueIds.slice(0, 6)) {
        let mediaSrc = '';
        let isMismatch = false;
        const expectedFileName = refFileNames?.[tileId] || null;
        const cached = this._tileCache.get(tileId);

        // ALWAYS check DOM first to detect cross-project collision.
        // 2026-05-31 v3: ưu tiên <video> trước (parity với _loadResultGalleryThumbnails)
        // để có domVideoSrc → render <video> element thay vì placeholder static.
        const tile = document.querySelector(`[data-tile-id="${tileId}"]`);
        let domFileName = null;
        let domThumbSrc = null;
        let domIsVideo = false;
        let domVideoSrc = null;

        if (tile) {
          domFileName = this._extractFileNameFromTile(tile);
          // Check <video> trước
          const videoEl = tile.querySelector('video');
          if (videoEl?.src) {
            domVideoSrc = videoEl.src;
            domIsVideo = true;
          } else {
            const img = tile.querySelector('img');
            if (img?.src) domThumbSrc = img.src;
            if (!domThumbSrc && this._isVideoTile(tile)) {
              domIsVideo = true;
            }
          }
          // Update cache với type + video_url để render lần sau (reload workflow) có signal
          if (domIsVideo && cached && (cached.type !== 'video' || (domVideoSrc && !cached.video_url))) {
            this._tileCacheSet(tileId, { ...cached, type: 'video', ...(domVideoSrc && { video_url: domVideoSrc }) });
          }
        }

        // Cross-project detection (same logic as edit panel):
        // 1. If we have expectedFileName (new workflow) → validate against it
        // 2. If no expectedFileName but have cached file_name → compare with DOM file_name
        if (expectedFileName) {
          if (domFileName && domFileName !== expectedFileName) {
            console.warn(`[WorkflowEditor] Canvas cross-project collision (expected): tile_id=${tileId}, expected=${expectedFileName}, actual=${domFileName}`);
            isMismatch = true;
          } else if (cached?.file_name && cached.file_name !== expectedFileName) {
            isMismatch = true;
          }
        } else if (domFileName && cached?.file_name && domFileName !== cached.file_name) {
          // Old workflow: compare DOM vs cache
          console.warn(`[WorkflowEditor] Canvas cross-project collision (cache vs DOM): tile_id=${tileId}, cached=${cached.file_name}, dom=${domFileName}`);
          isMismatch = true;
        } else if (domFileName && cached?.thumbnail && !cached?.file_name) {
          // Update cache with current file_name
          this._tileCacheSet(tileId, { ...cached, file_name: domFileName });
        }

        // Use DOM thumbnail if available and not mismatch
        if (!isMismatch) {
          if (domThumbSrc) {
            mediaSrc = domThumbSrc;
          } else if (cached?.thumbnail) {
            mediaSrc = cached.thumbnail;
          }
        }

        if (!mediaSrc && window.pendingUploadFiles?.has(tileId)) {
          const pending = window.pendingUploadFiles.get(tileId);
          if (pending?.thumbnail) mediaSrc = pending.thumbnail;
        }
        if (!mediaSrc && window._uploadedThumbnailCache?.has(tileId)) {
          mediaSrc = window._uploadedThumbnailCache.get(tileId);
        }
        // 2026-05-31 v7: detect video CHỈ qua type='video' / extension / DOM <video> element.
        // BỎ mediaSrcIsVideoUrl — Flow `getMediaUrlRedirect` URL dùng chung image + video → ambiguous!
        const isVideoCandidate = (
          cached?.type === 'video' ||
          /\.(mp4|webm|mov|m4v)$/i.test(cached?.file_name || domFileName || '') ||
          domIsVideo
        );
        const videoUrl = domVideoSrc || cached?.video_url || '';
        const useVideo = isVideoCandidate && !!videoUrl;
        const useImg = !useVideo && mediaSrc;
        // KHÔNG còn `continue` skip — luôn render placeholder để user thấy ref slot.

        const thumb = document.createElement('div');
        thumb.className = 'df-ref-thumb';
        if (isMismatch) {
          thumb.classList.add('df-ref-thumb-mismatch');
          thumb.style.cssText = 'border:2px solid var(--destructive,#dc2626);position:relative;';
          thumb.title = window.I18n?.t('workflow.crossProjectNeedReselect') || 'Image from another project - please reselect';
        }
        if (isMismatch) {
          thumb.innerHTML = '<span style="font-size:8px;color:var(--destructive);">X</span>';
        } else if (useImg) {
          const img = document.createElement('img');
          img.src = mediaSrc;
          img.alt = 'ref';
          // Reactive: nếu URL trả mp4 bytes → <img> fail → swap sang <video> + heal cache.
          img.addEventListener('error', () => {
            const video = document.createElement('video');
            video.src = mediaSrc;
            video.muted = true; video.playsInline = true; video.preload = 'metadata';
            video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;background:#0c1320;';
            video.addEventListener('loadedmetadata', () => { try { video.currentTime = 0.1; } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#renderThumbs', _); } }, { once: true });
            img.parentNode?.replaceChild(video, img);
            this._tileCacheSet(tileId, { ...(this._tileCache.get(tileId) || {}), type: 'video', video_url: mediaSrc });
          }, { once: true });
          thumb.appendChild(img);
        } else if (useVideo) {
          // Video URL hợp lệ → render <video> (preload metadata để show first frame stable)
          thumb.innerHTML = `<video src="${this._safeMediaSrc(videoUrl)}" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block;background:#0c1320;"></video>`;
          // Seek to first frame on metadata load
          const vEl = thumb.querySelector('video');
          if (vEl) vEl.addEventListener('loadedmetadata', () => { try { vEl.currentTime = 0.1; } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#renderThumbs', _); } }, { once: true });
        } else if (isVideoCandidate) {
          // Video tile thiếu URL → placeholder play icon
          thumb.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(99,102,241,0.10);color:var(--primary,#6366f1);" title="Video"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg></div>';
        } else {
          // Image ref thiếu thumbnail → placeholder broken-image icon
          thumb.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(245,158,11,0.06);color:var(--muted-foreground);" title="${this.escapeAttr(tileId.substring(0, 12))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;
        }
        refContainer.appendChild(thumb);
      }
      if (uniqueIds.length > 6) {
        const more = document.createElement('div');
        more.className = 'df-ref-thumb';
        more.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--muted-foreground)';
        more.textContent = `+${uniqueIds.length - 6}`;
        refContainer.appendChild(more);
      }
    };

    // Try render, if no DOM tiles fetch trực tiếp theo file IDs
    const hasDom = uniqueIds.some(id => document.querySelector(`[data-tile-id="${id}"]`));
    const allCached = uniqueIds.every(id => this._tileCache.has(id) || window.pendingUploadFiles?.has(id) || window._uploadedThumbnailCache?.has(id));
    if (!hasDom && !allCached && typeof MessageBridge !== 'undefined') {
      const uncachedIds = uniqueIds.filter(id => !this._tileCache.has(id) && !window.pendingUploadFiles?.has(id) && !window._uploadedThumbnailCache?.has(id));
      // Show gradient sweep loading for each ref
      refContainer.innerHTML = uncachedIds.slice(0, 6).map(() =>
        '<div class="df-ref-thumb"><div class="df-ref-shimmer"></div></div>'
      ).join('');
      MessageBridge.getThumbnailsByIds(uncachedIds).then(result => {
        for (const [fid, info] of Object.entries(result?.results || {})) {
          if (!info?.thumbnail) continue;
          // Cross-project safety: validate file_name before overwriting cache
          const existingCache = this._tileCache.get(fid);
          const savedFn = existingCache?.file_name;
          const newFn = info?.file_name;
          if (savedFn && newFn && savedFn !== newFn) {
            console.warn(`[WorkflowEditor] Ref preview: cross-project skip ${fid}`);
            continue; // Giữ cache cũ
          }
          // Bug 51 fix: Include video_url for video playback
          this._tileCacheSet(fid, { thumbnail: info.thumbnail, type: info.type || 'image', ...(newFn && { file_name: newFn }), ...(info.video_url && { video_url: info.video_url }) });
        }
        renderThumbs();
      }).catch(() => renderThumbs());
    } else {
      renderThumbs();
    }
  }

  /**
   * Show ref image preview từ URLs (cho template mode)
   * Không cần lookup từ tile cache, render trực tiếp từ URLs
   */
  _showNodeRefPreviewFromUrls(nodeId, refUrls) {
    if (!this.overlay || !nodeId || !refUrls?.length) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;
    const nodeEl = this.overlay.querySelector(`#node-${drawflowId}`);
    let refContainer = nodeEl?.querySelector('.df-node-ref-preview');

    // Tạo container nếu chưa có
    if (!refContainer) {
      const body = nodeEl?.querySelector('.df-node-body');
      if (!body) return;
      refContainer = document.createElement('div');
      refContainer.className = 'df-node-ref-preview';
      refContainer.setAttribute('data-ref-preview', '');
      body.appendChild(refContainer);
    }

    refContainer.innerHTML = '';
    const uniqueUrls = [...new Set(refUrls)].filter(Boolean);

    for (const url of uniqueUrls.slice(0, 6)) {
      const thumb = document.createElement('div');
      thumb.className = 'df-ref-thumb';
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'ref';
      img.onerror = () => { thumb.innerHTML = '<span style="font-size:8px;color:var(--destructive);">!</span>'; };
      thumb.appendChild(img);
      refContainer.appendChild(thumb);
    }

    if (uniqueUrls.length > 6) {
      const more = document.createElement('div');
      more.className = 'df-ref-thumb';
      more.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--muted-foreground)';
      more.textContent = `+${uniqueUrls.length - 6}`;
      refContainer.appendChild(more);
    }

    this._scheduleConnectionRefresh();
  }

  /**
   * Clear ref image preview cho node
   */
  _clearNodeRefPreview(nodeId) {
    if (!this.overlay || !nodeId) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;
    const nodeEl = this.overlay.querySelector(`#node-${drawflowId}`);
    const refContainer = nodeEl?.querySelector('.df-node-ref-preview');
    if (refContainer) {
      refContainer.remove();
      this._scheduleConnectionRefresh();
    }
  }

  /**
   * Show toast notification trong editor overlay
   * Fallback khi window.showNotification không khả dụng
   */
  _showEditorToast(message, type = 'success', duration = 3000) {
    if (!this.overlay) return;

    // Remove existing toast
    const existing = this.overlay.querySelector('.wf-editor-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `wf-editor-toast wf-editor-toast--${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 10px 20px;
      border-radius: 8px;
      background: ${type === 'success' ? 'var(--success, #19d07b)' : type === 'error' ? 'var(--destructive, #ef4444)' : 'var(--primary, #3b82f6)'};
      color: white;
      font-size: 14px;
      z-index: 100000;
      animation: wf-toast-in 0.3s ease;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;

    this.overlay.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'wf-toast-out 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * Lock preview container height BEFORE clearing innerHTML để tránh node bị collapse
   * trong transition placeholder/shimmer → thumb (khi <img> chưa load, .df-preview-thumb
   * override aspect-ratio → height=auto → ~0 → node co lại → image load → expand lại).
   * Caller phải gọi _unlockPreviewHeight() sau khi media đã load (hoặc khi cần re-render).
   */
  _lockPreviewHeight(previewContainer) {
    if (!previewContainer) return;
    const h = previewContainer.offsetHeight;
    if (h > 0) {
      previewContainer.style.minHeight = `${h}px`;
    }
  }
  _unlockPreviewHeight(previewContainer) {
    if (!previewContainer) return;
    previewContainer.style.minHeight = '';
  }
  /**
   * Sau khi inject thumbs có <img>/<video>, đợi tất cả load xong rồi release lock height.
   * Nếu media đã cached (complete=true) → release ngay.
   */
  _releaseLockWhenMediaReady(previewContainer) {
    if (!previewContainer) return;
    const mediaEls = previewContainer.querySelectorAll('img, video');
    if (mediaEls.length === 0) {
      this._unlockPreviewHeight(previewContainer);
      return;
    }
    let pending = mediaEls.length;
    const release = () => {
      pending--;
      if (pending <= 0) {
        // requestAnimationFrame để browser flush layout với image natural size TRƯỚC khi unlock
        // → tránh frame flash khi minHeight=0 nhưng image chưa render dimension xong.
        requestAnimationFrame(() => this._unlockPreviewHeight(previewContainer));
      }
    };
    mediaEls.forEach(el => {
      const isComplete = el.tagName === 'IMG'
        ? el.complete && el.naturalHeight > 0
        : (el.readyState >= 1); // HAVE_METADATA cho video
      if (isComplete) {
        release();
      } else {
        const onDone = () => {
          el.removeEventListener('load', onDone);
          el.removeEventListener('error', onDone);
          el.removeEventListener('loadedmetadata', onDone);
          release();
        };
        el.addEventListener('load', onDone, { once: true });
        el.addEventListener('error', onDone, { once: true });
        el.addEventListener('loadedmetadata', onDone, { once: true });
      }
    });
    // Safety timeout 5s — nếu media stuck loading, release để tránh node lock vĩnh viễn.
    setTimeout(() => {
      if (pending > 0) {
        pending = 0;
        this._unlockPreviewHeight(previewContainer);
      }
    }, 5000);
  }

  _renderNodePreviewWithRetry(previewContainer, fileIds, attempt) {
    const maxAttempts = 5;
    const delay = 1000;

    // In standalone window, tiles aren't in DOM — fetch trực tiếp theo file IDs
    const hasDomTiles = fileIds.some(id => document.querySelector(`[data-tile-id="${id}"]`));
    const allCached = !hasDomTiles && fileIds.every(id => this._tileCache.has(id) || window.pendingUploadFiles?.has(id) || window._uploadedThumbnailCache?.has(id));
    if (!hasDomTiles && !allCached && typeof MessageBridge !== 'undefined') {
      const uncachedIds = fileIds.filter(id => !this._tileCache.has(id) && !window.pendingUploadFiles?.has(id) && !window._uploadedThumbnailCache?.has(id));
      // Show loading shimmer while fetching
      if (!previewContainer.querySelector('img, video')) {
        // Lock height trước khi swap placeholder/thumbs → shimmer (giữ node size)
        this._lockPreviewHeight(previewContainer);
        previewContainer.classList.remove('hidden');
        previewContainer.innerHTML = `<div class="df-node-loading-shimmer"><span class="df-node-loading-text">${window.I18n?.t('workflow.loadingImages') || 'Loading images...'}</span></div>`;
      }
      MessageBridge.getThumbnailsByIds(uncachedIds).then(result => {
        const results = result?.results || {};
        for (const [fid, info] of Object.entries(results)) {
          if (!info?.thumbnail) continue;
          // Cross-project safety: validate file_name before overwriting cache
          const existingCache = this._tileCache.get(fid);
          const savedFn = existingCache?.file_name;
          const newFn = info?.file_name;
          if (savedFn && newFn && savedFn !== newFn) {
            console.warn(`[WorkflowEditor] Result preview: cross-project skip ${fid}`);
            continue;
          }
          // Bug 51 fix: Include video_url for video playback
          this._tileCacheSet(fid, { thumbnail: info.thumbnail, type: info.type || 'image', ...(newFn && { file_name: newFn }), ...(info.video_url && { video_url: info.video_url }) });
        }
        this._renderNodePreviewInner(previewContainer, fileIds, attempt);
      }).catch(() => {
        this._renderNodePreviewInner(previewContainer, fileIds, attempt);
      });
      return;
    }

    this._renderNodePreviewInner(previewContainer, fileIds, attempt);
  }

  _renderNodePreviewInner(previewContainer, fileIds, attempt) {
    const maxAttempts = 5;
    const delay = 1000;

    // Lock height TRƯỚC clear → tránh node collapse trong transition.
    // (Khi clear innerHTML + chèn .df-preview-thumb → CSS :has() bỏ aspect-ratio →
    // height=auto → ~0 cho đến khi <img> load → node co rồi expand lại.)
    this._lockPreviewHeight(previewContainer);

    previewContainer.innerHTML = '';
    previewContainer.classList.remove('hidden');
    // Single result: full-size display; multiple: grid thumbnails
    previewContainer.classList.toggle('multi-result', fileIds.length > 1);

    let foundCount = 0;
    let lastThumb = null; // ref tới thumb cuối — gắn overlay "+N" khi tổng > 6 ảnh
    const foundThumbs = {}; // fileId -> thumbnailUrl (for persistence)

    // Hiển thị tối đa 6 ảnh (2 hàng × 3). Ảnh thứ 6 sẽ có overlay "+N" nếu còn dư.
    for (const tileId of fileIds.slice(0, 6)) {
      let mediaSrc = '';
      let isVideo = false;

      // Try DOM first — ưu tiên <video> trước (video tiles có cả <img> ref lẫn <video> result)
      const tile = document.querySelector(`[data-tile-id="${tileId}"]`);
      if (tile) {
        const videoEl = tile.querySelector('video');
        if (videoEl?.src) {
          mediaSrc = videoEl.src;
          isVideo = true;
        } else {
          const imgEl = tile.querySelector('img');
          if (imgEl?.src) {
            mediaSrc = imgEl.src;
            isVideo = false;
          }
        }
      }

      // Fallback to cache — track video_url separately (Bug 51 fix)
      let videoUrl = null;
      if (!mediaSrc && this._tileCache.has(tileId)) {
        const cached = this._tileCache.get(tileId);
        mediaSrc = cached.thumbnail;
        isVideo = cached.type === 'video';
        videoUrl = cached.video_url || null;
      }

      // Fallback to pendingUploadFiles (local uploads chưa gửi lên Flow)
      if (!mediaSrc && window.pendingUploadFiles?.has(tileId)) {
        const pending = window.pendingUploadFiles.get(tileId);
        if (pending?.thumbnail) mediaSrc = pending.thumbnail;
      }

      // Fallback to uploaded thumbnail cache (thumbnail transferred after upload_xxx → fe_xxx)
      if (!mediaSrc && window._uploadedThumbnailCache?.has(tileId)) {
        mediaSrc = window._uploadedThumbnailCache.get(tileId);
      }

      if (!mediaSrc) continue;

      foundCount++;
      // 2026-05-25: persist FULL metadata cho video tiles (type + video_url) — không chỉ URL string.
      // Trước fix: foundThumbs[id] = URL → next load cache type='image' (fallback) → render <img> thay vì <video>
      // → user thấy ảnh tĩnh thay vì video play → onerror chưa fire (img URL hợp lệ) → ko rescan.
      // Sau fix: video tiles save dạng {thumbnail, type:'video', video_url} → next load render đúng video.
      foundThumbs[tileId] = isVideo
        ? { thumbnail: mediaSrc, type: 'video', ...(videoUrl && { video_url: videoUrl }) }
        : mediaSrc;
      const thumb = document.createElement('div');
      thumb.className = 'df-preview-thumb';
      // 2026-05-25: Metadata cho click → mở media viewer modal (event delegation handler).
      thumb.dataset.mediaType = isVideo ? 'video' : 'image';
      thumb.dataset.mediaSrc = isVideo ? (videoUrl || mediaSrc) : mediaSrc;
      if (isVideo && mediaSrc && videoUrl && videoUrl !== mediaSrc) {
        thumb.dataset.mediaPoster = mediaSrc;
      }

      // v1.1 paste image feature: spinner overlay khi tileId là tempId đang upload.
      // ImmediateUploader._uploading có entry khi upload chạy → isUploading=true.
      // Khi upload xong, eventBus.emit('upload:completed') sẽ trigger re-render
      // node preview (xem `_bindWorkflowUploadListeners`) → spinner biến mất + thay
      // ID upload_xxx → flow_xxx.
      if (typeof tileId === 'string' && tileId.startsWith('upload_')) {
        if (window.ImmediateUploader?.isUploading?.(tileId)) {
          thumb.classList.add('df-preview-thumb--uploading');
        } else if (this._failedPasteUploadKeys?.has(tileId)) {
          thumb.classList.add('df-preview-thumb--upload-failed');
        }
      }

      if (isVideo) {
        const vid = document.createElement('video');
        // Bug 51 fix: Use video_url for playback, fallback to mediaSrc (thumbnail) if not available
        vid.src = videoUrl || mediaSrc;
        vid.muted = true;
        vid.loop = true;
        vid.autoplay = true;
        vid.playsInline = true;
        // 2026-05-25: video element cũng cần onerror để trigger CDN rescan khi expired
        // (mirror logic <img> bên dưới). Trước fix: video silent fail → preview blank,
        // user nghĩ "ko scan". Sau fix: video error → activate Flow tab → rescan URL mới.
        vid.onerror = () => {
          if (previewContainer._expiredRefreshed) return;
          previewContainer._expiredRefreshed = true;
          this._tileCache.delete(tileId);
          this._refreshExpiredNodeThumbnail(previewContainer, fileIds);
        };
        // Thêm poster fallback (thumbnail) khi video chưa load — UX tốt hơn blank
        if (videoUrl && mediaSrc && videoUrl !== mediaSrc) {
          vid.poster = mediaSrc;
        }
        // Bug fix 2026-05-28: video load → kích thước box đổi (aspect video) → port di chuyển.
        // Reposition connections (mirror img.onload bên dưới). Trước: video chỉ có onerror → node
        // gen video xong, box resize nhưng link KHÔNG correct lại port (lệch). loadedmetadata = đã
        // biết dimensions; loadeddata = frame đầu render.
        vid.onloadedmetadata = () => { this._scheduleConnectionRefresh(); };
        vid.onloadeddata = () => { this._scheduleConnectionRefresh(); };
        thumb.appendChild(vid);
      } else {
        const img = document.createElement('img');
        img.src = mediaSrc;
        img.alt = 'result';
        // Detect expired thumbnail URL → re-scan Flow (max 1 lần per preview)
        img.onerror = () => {
          if (previewContainer._expiredRefreshed) return;
          previewContainer._expiredRefreshed = true;
          this._tileCache.delete(tileId);
          this._refreshExpiredNodeThumbnail(previewContainer, fileIds);
        };
        // Image load → node size có thể đổi (image node fit content). Schedule
        // connection refresh để Drawflow re-route SVG paths → port end-points
        // không bị lệch (đặc biệt image node ratio portrait/landscape khác nhau).
        img.onload = () => {
          this._scheduleConnectionRefresh();
        };
        thumb.appendChild(img);
      }

      this._attachThumbZoom(thumb);
      previewContainer.appendChild(thumb);
      lastThumb = thumb;
    }

    // Overlay "+N" gắn TRỰC TIẾP lên ảnh thứ 6 (thumb cuối) khi tổng > 6 ảnh —
    // thay vì box rỗng riêng. Đẹp + gọn hơn: vẫn thấy ảnh thứ 6 mờ dưới badge "+N".
    if (fileIds.length > 6 && lastThumb) {
      const moreOverlay = document.createElement('div');
      moreOverlay.className = 'df-preview-more-overlay';
      moreOverlay.textContent = `+${fileIds.length - 6}`;
      lastThumb.appendChild(moreOverlay);
    }

    // Persist thumbnail URLs into Drawflow node data for restore after reload
    if (foundCount > 0 && previewContainer._nodeId) {
      this._persistNodeThumbnails(previewContainer._nodeId, foundThumbs);
      // Sync rendered preview HTML back into Drawflow internal data
      this._syncNodeHTMLToDrawflow(previewContainer._nodeId);
      // Deferred auto-save: thumbnails were persisted AFTER the initial saveWorkflow()
      this._deferredThumbnailSave();
    }

    // Retry nếu chưa tìm thấy media nào (tiles chưa render xong)
    if (foundCount === 0 && attempt < maxAttempts) {
      previewContainer._retryTimer = setTimeout(() => {
        previewContainer._retryTimer = null;
        this._renderNodePreviewWithRetry(previewContainer, fileIds, attempt + 1);
      }, delay);
    } else {
      // Release lock height khi tất cả media đã load (hoặc nếu foundCount=0 + hết retry).
      this._releaseLockWhenMediaReady(previewContainer);
    }
  }

  /**
   * Persist thumbnail URLs into Drawflow node data for restore after reload
   */
  _persistNodeThumbnails(nodeId, thumbMap) {
    if (!nodeId || !thumbMap || Object.keys(thumbMap).length === 0) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;
    const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    if (!node?.data) return;
    // Merge with existing thumbnails
    const existing = node.data.result_thumbnails || {};
    node.data.result_thumbnails = { ...existing, ...thumbMap };
    this.diagramCanvas.editor.updateNodeDataFromId(drawflowId, node.data);
  }

  /**
   * Persist file_names (persistent UUIDs from getMediaUrlRedirect) into Drawflow node data
   */
  _persistNodeFileNames(nodeId, fileNameMap) {
    if (!nodeId || !fileNameMap || Object.keys(fileNameMap).length === 0) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;
    const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    if (!node?.data) return;
    const existing = node.data.result_file_names || {};
    node.data.result_file_names = { ...existing, ...fileNameMap };
    this.diagramCanvas.editor.updateNodeDataFromId(drawflowId, node.data);
  }

  /**
   * Persist single file_name vào Drawflow node data (dùng bởi _backgroundThumbnailScan)
   */
  _persistSingleFileName(fileId, fileName) {
    if (!fileId || !fileName || !this.workflow?.nodes) return;
    for (const node of this.workflow.nodes) {
      const resultIds = (node.result_file_ids || '').split(',').filter(Boolean);
      if (resultIds.includes(fileId)) {
        this._persistNodeFileNames(node.node_id, { [fileId]: fileName });
        return;
      }
    }
  }

  /**
   * Persist ref thumbnail URLs into Drawflow node data (separate from result thumbnails)
   */
  _persistRefThumbnailsMap(nodeId, thumbMap) {
    if (!nodeId || !thumbMap || Object.keys(thumbMap).length === 0) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;
    const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    if (!node?.data) return;
    const existing = node.data.ref_thumbnails || {};
    node.data.ref_thumbnails = { ...existing, ...thumbMap };
    this.diagramCanvas.editor.updateNodeDataFromId(drawflowId, node.data);
  }

  /**
   * Deferred auto-save: thumbnails are persisted async (after Flow scan),
   * so the initial saveWorkflow() in node:completed handler may miss them.
   * Debounce 2s to batch multiple thumbnail persists into one save.
   */
  _deferredThumbnailSave() {
    if (this._skipDeferredSave) return;
    // Template mode: KHÔNG deferred save vì workflow chưa tồn tại trong DB
    if (this.isTemplateMode) {
      this._hasUnsavedChanges = true;
      return;
    }
    if (this._deferredSaveTimer) clearTimeout(this._deferredSaveTimer);
    this._deferredSaveTimer = setTimeout(() => {
      this._deferredSaveTimer = null;
      this.saveWorkflow()
        .catch(err => console.warn('[SEOSONA Flow] Deferred thumbnail save failed:', err))
        .finally(() => this._updatePlayButtonState());
    }, 2000);
    // Disable play button while deferred save is pending
    this._updatePlayButtonState();
  }

  /**
   * Persist ref image thumbnails AND file_names (UUIDs) into node data so they survive browser reload
   * Phase R fix: ref_file_names enables 5-tier correction for ref images (same as result images)
   */
  _persistRefThumbnails(drawflowId, nodeData) {
    if (!nodeData?.ref_file_ids || !this.diagramCanvas?.editor) return;
    const refIds = nodeData.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean);
    if (refIds.length === 0) return;

    const thumbMap = {};
    const fileNameMap = {}; // NEW: capture UUIDs for 5-tier correction

    for (const fileId of refIds) {
      // Try DOM tiles — Flow phân biệt video/image qua ELEMENT (<video> vs <img>),
      // URL `getMediaUrlRedirect` giống nhau cả 2. Check <video> TRƯỚC để detect type.
      const tile = document.querySelector(`[data-tile-id="${fileId}"]`);
      if (tile) {
        const video = tile.querySelector('video');
        const img = tile.querySelector('img');
        if (video?.src) {
          // Video tile → save object {thumbnail, type:'video', video_url} cho reload restore
          thumbMap[fileId] = {
            thumbnail: video.poster || img?.src || video.src,
            type: 'video',
            video_url: video.src,
          };
        } else if (img?.src) {
          thumbMap[fileId] = img.src; // Image: plain URL (backward compat)
        }
      }
      // Try _tileCache (may have file_name + type + video_url từ scan trước)
      if (this._tileCache.has(fileId)) {
        const cached = this._tileCache.get(fileId);
        if (!thumbMap[fileId]) {
          if (cached.type === 'video' && (cached.thumbnail || cached.video_url)) {
            thumbMap[fileId] = {
              thumbnail: cached.thumbnail || '',
              type: 'video',
              ...(cached.video_url && { video_url: cached.video_url }),
            };
          } else if (cached.thumbnail) {
            thumbMap[fileId] = cached.thumbnail;
          }
        }
        if (cached.file_name) fileNameMap[fileId] = cached.file_name;
      }
      // Try pendingUploadFiles
      if (window.pendingUploadFiles?.has(fileId)) {
        const pending = window.pendingUploadFiles.get(fileId);
        if (pending?.thumbnail && !thumbMap[fileId]) thumbMap[fileId] = pending.thumbnail;
      }
      // Try uploaded thumbnail cache (after upload_xxx → fe_xxx conversion)
      if (window._uploadedThumbnailCache?.has(fileId) && !thumbMap[fileId]) {
        thumbMap[fileId] = window._uploadedThumbnailCache.get(fileId);
      }
    }

    const node = this.diagramCanvas.editor.getNodeFromId(drawflowId);
    if (!node?.data) return;

    // Persist thumbnails — REPLACE (chỉ giữ entries khớp ref_file_ids hiện tại)
    // Merge old entries CHỈ cho IDs vẫn còn trong refIds, xóa stale entries
    const refIdSet = new Set(refIds);
    const cleanedThumbs = {};
    const cleanedFileNames = {};
    // Keep existing entries CHỈ cho IDs còn trong ref_file_ids
    for (const [id, url] of Object.entries(node.data.ref_thumbnails || {})) {
      if (refIdSet.has(id)) cleanedThumbs[id] = url;
    }
    for (const [id, fn] of Object.entries(node.data.ref_file_names || {})) {
      if (refIdSet.has(id)) cleanedFileNames[id] = fn;
    }
    // Override with new data
    node.data.ref_thumbnails = { ...cleanedThumbs, ...thumbMap };
    node.data.ref_file_names = { ...cleanedFileNames, ...fileNameMap };

    this.diagramCanvas.editor.updateNodeDataFromId(drawflowId, node.data);

    // Also cache for current session — preserve type/video_url khi value là object
    for (const [fid, val] of Object.entries(thumbMap)) {
      if (this._tileCache.has(fid)) continue;
      if (val && typeof val === 'object') {
        this._tileCacheSet(fid, {
          thumbnail: val.thumbnail || '',
          type: val.type || 'image',
          ...(val.video_url && { video_url: val.video_url }),
        });
      } else {
        this._tileCacheSet(fid, { thumbnail: val, type: 'image' });
      }
    }

    // Async: scan for file_names via MessageBridge if not already cached
    this._scanRefFileNames(refIds, drawflowId);
  }

  /**
   * Scan ref images for file_names (UUIDs) via MessageBridge
   * This enables Tầng 1 correction (file_name → new tile_id)
   */
  async _scanRefFileNames(refIds, drawflowId) {
    if (!refIds?.length || !drawflowId) return;
    const idsToScan = refIds.filter(id => {
      if (id.startsWith('upload_')) return false;
      const cached = this._tileCache.get(id);
      return !cached?.file_name; // Only scan if file_name not cached
    });
    if (idsToScan.length === 0) return;

    try {
      if (typeof MessageBridge === 'undefined') return;
      const scanResult = await MessageBridge.getThumbnailsByIds(idsToScan);
      const results = scanResult?.results || {};
      const fileNameMap = {};

      for (const [fid, info] of Object.entries(results)) {
        if (info?.file_name) {
          fileNameMap[fid] = info.file_name;
          // Update cache
          const cached = this._tileCache.get(fid) || {};
          this._tileCacheSet(fid, { ...cached, file_name: info.file_name });
        }
      }

      if (Object.keys(fileNameMap).length > 0) {
        this._persistRefFileNames(drawflowId, fileNameMap);
        this._deferredThumbnailSave();
      }
    } catch (e) {
      console.warn('[SEOSONA Flow] _scanRefFileNames error:', e);
    }
  }

  /**
   * Persist ref_file_names (UUIDs) into Drawflow node data
   */
  _persistRefFileNames(drawflowId, fileNameMap) {
    if (!drawflowId || !fileNameMap || Object.keys(fileNameMap).length === 0) return;
    const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    if (!node?.data) return;
    node.data.ref_file_names = { ...(node.data.ref_file_names || {}), ...fileNameMap };
    this.diagramCanvas.editor.updateNodeDataFromId(drawflowId, node.data);
  }

  /**
   * Proactive blob caching cho workflow nodes — fetch ref image blobs
   * và cache vào PendingUploadStore để reuploadMissingFiles Tầng 1-2
   * có thể recover khi image bị xóa khỏi Flow.
   * Fire-and-forget, không block UI.
   */
  async _cacheNodeRefImageBlobs(nodeData) {
    if (!window.PendingUploadStore || !nodeData?.ref_file_ids) return;
    const refIds = (nodeData.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (refIds.length === 0) return;

    const thumbs = nodeData.ref_thumbnails || {};
    for (const id of refIds) {
      // Skip nếu đã có trong uploadedFileCache (đã cache từ upload gần đây)
      if (window.uploadedFileCache?.has(id)) continue;
      // Skip upload_ keys (chưa upload xong)
      if (id.startsWith('upload_')) continue;

      const thumbUrl = thumbs[id] || this._tileCache?.get(id)?.thumbnail || window.MediaRegistry?.getThumb(id);
      if (!thumbUrl || typeof thumbUrl !== 'string' || !thumbUrl.startsWith('http')) continue;

      try {
        const fetchUrl = thumbUrl.includes('lh3.') || thumbUrl.includes('googleusercontent.com')
          ? thumbUrl.split('=')[0]
          : thumbUrl;

        let resp;
        const _mp = window._getMediaUrlPattern?.() || 'getMediaUrlRedirect';
        if (fetchUrl.includes(_mp)) {
          resp = await window.MessageBridge?.sendToContentScript('fetchImageAsBase64', { url: fetchUrl });
          if (!resp?.success) {
            resp = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ action: 'fetchBlob', url: fetchUrl, expectImage: true }, (r) => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                resolve(r);
              });
            });
          }
        } else {
          resp = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'fetchBlob', url: fetchUrl, expectImage: true }, (r) => {
              if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
              resolve(r);
            });
          });
        }

        if (resp?.success && resp.base64) {
          const binary = atob(resp.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const contentType = resp.contentType || 'image/png';
          const blob = new Blob([bytes], { type: contentType });
          const file = new File([blob], `ref_${id.substring(0, 8)}.png`, { type: contentType });
          await PendingUploadStore.cacheUploaded(id, file);
          console.log(`[SEOSONA Flow] Proactive cached blob cho ref ${id.substring(0, 8)}`);
        }
      } catch (e) {
        // Không block — fire-and-forget
        console.warn(`[SEOSONA Flow] Failed to cache blob cho ref ${id.substring(0, 8)}:`, e.message);
      }
    }
  }

  /**
   * Sync current DOM of a node back into Drawflow's internal HTML
   * so that the visual state persists without needing to reload the editor
   */
  _syncNodeHTMLToDrawflow(nodeId) {
    if (!nodeId || !this.diagramCanvas?.editor) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;
    const nodeEl = this.overlay?.querySelector(`#node-${drawflowId} .drawflow_content_node`);
    if (!nodeEl) return;
    const homeData = this.diagramCanvas.editor.drawflow?.drawflow?.Home?.data;
    if (homeData?.[drawflowId]) {
      homeData[drawflowId].html = nodeEl.innerHTML;
    }
  }

  /**
   * Re-scan Flow khi thumbnail URL expired (onerror)
   * Debounce để gộp nhiều expired thành 1 lần scan
   */
  /**
   * Refresh thumbnails khi img.onerror fires (CDN URL expired — signature TTL).
   * Flow:
   *   1. Activate Flow tab (browser focus) → background tab có thể bị suspend lazy images
   *   2. prepareFlowForScan → ensureFlowTilesLoaded trên content script
   *   3. getThumbnailsByIds → fetch URL mới (signature fresh)
   *   4. Re-render preview với URLs mới
   * Debounce 500ms để gộp multiple img.onerror cùng node.
   */
  _refreshExpiredNodeThumbnail(previewContainer, fileIds) {
    if (this._expiredNodeTimer) clearTimeout(this._expiredNodeTimer);
    this._expiredNodeTimer = setTimeout(async () => {
      if (typeof MessageBridge === 'undefined') return;
      const expiredIds = fileIds.filter(id => !id.startsWith('upload_'));
      if (expiredIds.length === 0) return;

      try {
        // 1. Activate Flow tab — chỉ thực hiện 1 lần per editor session (tránh steal focus liên tục)
        if (!this._flowTabActivatedForScan) {
          this._flowTabActivatedForScan = true;
          try {
            await new Promise((resolve) => {
              chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => resolve());
            });
          } catch (e) { /* best-effort */ }
        }
        // 2. Ensure tiles loaded trên Flow DOM
        if (MessageBridge.prepareFlowForScan) {
          await MessageBridge.prepareFlowForScan().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_checkRefFilesExist', _e); });
        }
        // 3. Rescan thumbnails
        const result = await MessageBridge.getThumbnailsByIds(expiredIds);
        const results = result?.results || {};
        let refreshed = 0;
        for (const [fid, info] of Object.entries(results)) {
          if (info?.thumbnail) {
            // 2026-05-25: preserve video_url để video element render đúng src (không fallback về thumbnail).
            // Trước fix: drop video_url → cache type='video' nhưng videoUrl=null → vid.src = thumbnail (image URL)
            // → video không play được → render blank.
            this._tileCacheSet(fid, {
              thumbnail: info.thumbnail,
              type: info.type || 'image',
              ...(info.video_url && { video_url: info.video_url }),
              ...(info.file_name && { file_name: info.file_name }),
            });
            refreshed++;
          }
        }
        if (refreshed > 0) {
          console.log('[WorkflowEditor] Refreshed', refreshed, 'expired thumbnails via Flow tab activation');
          // 4. Re-render preview với URLs mới
          this._renderNodePreviewInner(previewContainer, fileIds, 0);
          // Persist thumbnails về backend để lần sau load không expire
          this._deferredThumbnailSave?.();
        }
      } catch (err) {
        console.warn('[WorkflowEditor] _refreshExpiredNodeThumbnail failed:', err?.message);
      }
    }, 500);
  }

  /**
   * Sync execution status/results back into Drawflow node data
   * so that showNodeForm reads up-to-date data
   */
  _syncDrawflowNodeData(nodeId, updates) {
    if (!nodeId || !this.diagramCanvas?.editor) {
      console.warn(`[WorkflowEditor] _syncDrawflowNodeData: early return - nodeId=${nodeId}, editor=${!!this.diagramCanvas?.editor}`);
      return;
    }
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) {
      console.warn(`[WorkflowEditor] _syncDrawflowNodeData: drawflowId not found for nodeId=${nodeId}`);
      return;
    }
    const node = this.diagramCanvas.editor.getNodeFromId(drawflowId);
    if (!node?.data) {
      console.warn(`[WorkflowEditor] _syncDrawflowNodeData: node.data not found for drawflowId=${drawflowId}`);
      return;
    }
    console.log(`[WorkflowEditor] _syncDrawflowNodeData: nodeId=${nodeId}, updates=`, Object.keys(updates));
    Object.assign(node.data, updates);
    this.diagramCanvas.editor.updateNodeDataFromId(drawflowId, node.data);
  }

  /**
   * Show/hide download button in hover toolbar for a node
   */
  _updateHoverToolbarDownload(nodeId, fileIds) {
    if (!nodeId || !fileIds?.length) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return;
    const nodeEl = this.overlay?.querySelector(`#node-${drawflowId}`);
    if (!nodeEl) return;
    // Add download button to hover toolbar if not present
    const toolbar = nodeEl.querySelector('.df-hover-toolbar');
    if (!toolbar || toolbar.querySelector('[data-action="download-node"]')) return;
    const dlBtn = document.createElement('button');
    dlBtn.className = 'df-hover-btn';
    dlBtn.dataset.action = 'download-node';
    const dlLabel = window.I18n?.t('workflow.downloadResults') || 'Tải kết quả';
    dlBtn.title = dlLabel;
    dlBtn.dataset.tooltip = dlLabel;
    dlBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    // Insert before delete button
    const deleteBtn = toolbar.querySelector('[data-action="delete-node"]');
    if (deleteBtn) {
      toolbar.insertBefore(dlBtn, deleteBtn);
    } else {
      toolbar.appendChild(dlBtn);
    }
  }

  _findDrawflowId(nodeId) {
    if (!this.diagramCanvas?.editor) return null;
    if (!nodeId) return null;
    const homeData = this.diagramCanvas.editor.drawflow?.drawflow?.Home?.data || {};

    // If nodeId is already a drawflowId (exists as key), return it directly
    const nodeIdStr = String(nodeId);
    if (homeData[nodeIdStr]) return nodeIdStr;

    // Otherwise search by node_id field
    for (const [id, node] of Object.entries(homeData)) {
      if (node.data?.node_id === nodeId) return id;
    }
    return null;
  }

  /**
   * Check node có prompt để chạy không.
   * Nếu có upstream Prompt node connected thì ok (executor sẽ lấy prompt từ đó).
   * Nếu không có upstream thì check prompt trong node data.
   * @returns {{ ok: boolean, message?: string }}
   */
  _checkNodeHasPrompt(drawflowId, nodeData) {
    const data = nodeData?.data || {};
    const nodeName = data.node_name || 'Node';

    // 2026-05-31 fix: bug "Node X has no prompt" khi gen/chatgpt/grok có upstream là text_extract
    // (hoặc text). Trước fix: chỉ chấp nhận upstream type='prompt' → text_extract/text bị skip
    // → validation report no prompt dù chain hợp lệ (text_extract output = prompt source).
    //
    // Text-producing nodes (đều có thể serve as prompt source qua mention/auto-detect):
    //   - prompt (AI Agent): result_text từ ChatGPT/Gemini hoặc plain
    //   - text: static text content
    //   - text_extract: regex/JSON parse output từ upstream text
    //   - chatgpt/grok: result_text (AI response) — đôi khi user output text rồi feed gen
    const TEXT_SOURCE_TYPES = ['prompt', 'text', 'text_extract', 'text_template', 'random_pick', 'prompt_sequence', 'variant_expand', 'loop', 'chatgpt', 'grok'];
    let hasUpstreamTextSource = false;
    const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    if (node) {
      const allInputKeys = Object.keys(node.inputs || {});
      for (const inputKey of allInputKeys) {
        const conns = node.inputs?.[inputKey]?.connections || [];
        for (const conn of conns) {
          const srcNode = this.diagramCanvas.editor.getNodeFromId(conn.node);
          const srcType = srcNode?.data?.node_type || srcNode?.class;
          if (TEXT_SOURCE_TYPES.includes(srcType)) {
            hasUpstreamTextSource = true;
            break;
          }
        }
        if (hasUpstreamTextSource) break;
      }
    }

    // Có upstream text source thì ok (executor sẽ resolve text từ upstream)
    if (hasUpstreamTextSource) {
      return { ok: true };
    }

    // Không có upstream: check prompt trong node data
    const prompt = data.prompt;
    if (!prompt || !prompt.trim()) {
      const msg = window.I18n?.t('workflow.nodeNoPrompt', { name: nodeName })
        || `Node "${nodeName}" chưa có prompt.`;
      return { ok: false, message: msg };
    }
    return { ok: true };
  }

  _getNodeNameById(nodeId) {
    if (!nodeId) return '';
    const drawflowId = this._findDrawflowId(nodeId);
    if (!drawflowId) return '';
    const nodeEl = this.overlay?.querySelector(`#node-${drawflowId}`);
    return nodeEl?.querySelector('.df-node-title')?.textContent || '';
  }

  _getAllNodeData() {
    if (!this.diagramCanvas?.editor) return [];
    const homeData = this.diagramCanvas.editor.drawflow?.drawflow?.Home?.data || {};
    return Object.values(homeData).map(n => n.data).filter(Boolean);
  }

  async _checkRefFilesExist(nodeDataList) {
    if (!nodeDataList?.length || typeof MessageBridge === 'undefined') return null;

    // Collect all ref_file_ids from enabled nodes
    const nodesWithRefs = [];
    for (const data of nodeDataList) {
      if (!data || data.enabled === false) continue;
      const refStr = data.ref_file_ids || '';
      if (!refStr) continue;
      const ids = refStr.split(',').map(s => s.trim()).filter(s => s && !s.startsWith('upload_'));
      if (ids.length > 0) {
        nodesWithRefs.push({ data, ids });
      }
    }

    if (nodesWithRefs.length === 0) return null;

    const allRefIds = [];
    const nodeNames = {};
    for (const { data, ids } of nodesWithRefs) {
      for (const id of ids) {
        allRefIds.push(id);
        nodeNames[id] = data.node_name || data.node_type || '';
      }
    }

    try {
      const result = await MessageBridge.checkTilesExist([...new Set(allRefIds)]);
      const missing = result?.missing || [];
      if (missing.length === 0) return null;

      // Thử reupload missing files trước khi báo lỗi
      // (giống logic Tier 5 trong WorkflowExecutor)
      if (typeof window.reuploadMissingFiles === 'function') {
        console.log(`[WorkflowEditor] ${missing.length} ref(s) missing, attempting reupload...`);

        for (const { data } of nodesWithRefs) {
          const refStr = data.ref_file_ids || '';
          if (!refStr) continue;

          // Build thumbnail map trực tiếp từ node data — không phụ thuộc GenTab
          const thumbMap = data.ref_thumbnails || {};
          console.log('[WorkflowEditor] ref_thumbnails for reupload:', JSON.stringify(thumbMap));

          // CRITICAL: Truyền file_names map để reuploadMissingFiles có thể check file_name trước (tránh reupload không cần thiết)
          const fileNamesMap = data.ref_file_names || {};

          const oldIds = refStr.split(',').map(s => s.trim()).filter(Boolean);
          const updated = await window.reuploadMissingFiles(refStr, thumbMap, null, fileNamesMap);
          const updatedIds = (updated || '').split(',').map(s => s.trim()).filter(Boolean);
          console.log('[WorkflowEditor] reuploadMissingFiles result:', updated, 'updatedIds:', updatedIds, 'changed:', updated !== refStr);
          if (updated !== refStr && updatedIds.length > 0) {
            console.log(`[WorkflowEditor] Reupload success for node "${data.node_name || data.node_type}": ${updated.substring(0, 60)}...`);
            data.ref_file_ids = updated;

            // Cập nhật ref_thumbnails + ref_file_names + _tileCache với NEW data
            const newIds = updated.split(',').map(s => s.trim()).filter(Boolean);
            if (!data.ref_thumbnails) data.ref_thumbnails = {};
            if (!data.ref_file_names) data.ref_file_names = {};
            for (let i = 0; i < oldIds.length && i < newIds.length; i++) {
              if (oldIds[i] !== newIds[i]) {
                // Transfer old thumbnails/file_names sang new key
                if (data.ref_thumbnails[oldIds[i]]) {
                  data.ref_thumbnails[newIds[i]] = data.ref_thumbnails[oldIds[i]];
                  delete data.ref_thumbnails[oldIds[i]];
                }
                if (data.ref_file_names?.[oldIds[i]]) {
                  data.ref_file_names[newIds[i]] = data.ref_file_names[oldIds[i]];
                  delete data.ref_file_names[oldIds[i]];
                }
                // Cập nhật với NEW data từ reupload tileDetails hoặc GenTab fallback
                const reupDetails = window._lastReuploadTileDetails || {};
                const newThumb = reupDetails[newIds[i]]?.thumbnailUrl || MediaRegistry.getThumb(newIds[i]);
                if (newThumb) {
                  data.ref_thumbnails[newIds[i]] = newThumb;
                  const newFnForCache = reupDetails[newIds[i]]?.file_name || MediaRegistry.getFileName(newIds[i]) || null;
                  this._tileCacheSet(newIds[i], {
                    thumbnail: newThumb,
                    file_name: newFnForCache,
                    type: 'image',
                    _crossProject: false
                  });
                }
                const newFn = reupDetails[newIds[i]]?.file_name || MediaRegistry.getFileName(newIds[i]);
                if (newFn) data.ref_file_names[newIds[i]] = newFn;
              }
            }
          }
        }

        // Check lại sau reupload
        const updatedAllIds = [];
        for (const { data } of nodesWithRefs) {
          const ids = (data.ref_file_ids || '').split(',').map(s => s.trim()).filter(s => s && !s.startsWith('upload_'));
          for (const id of ids) {
            updatedAllIds.push(id);
            // Cập nhật nodeNames cho IDs mới
            if (!nodeNames[id]) nodeNames[id] = data.node_name || data.node_type || '';
          }
        }

        if (updatedAllIds.length > 0) {
          const recheck = await MessageBridge.checkTilesExist([...new Set(updatedAllIds)]);
          const stillMissing = recheck?.missing || [];
          if (stillMissing.length === 0) {
            console.log('[WorkflowEditor] All missing refs reuploaded successfully');
            return null; // Reupload thành công, cho phép chạy
          }

          // Vẫn còn missing sau reupload → báo lỗi
          const missingNodes = [...new Set(stillMissing.map(id => nodeNames[id]).filter(Boolean))];
          const nodeInfo = missingNodes.length > 0 ? ` (${missingNodes.join(', ')})` : '';
          return window.I18n?.t('workflow.refNotExist', { count: stillMissing.length, nodes: nodeInfo }) || `${stillMissing.length} ảnh tham chiếu không còn tồn tại trên Google Flow${nodeInfo}. Vui lòng kiểm tra và cập nhật lại ảnh.`;
        }

        return null;
      }

      // Không có reuploadMissingFiles → báo lỗi như cũ
      const missingNodes = [...new Set(missing.map(id => nodeNames[id]).filter(Boolean))];
      const nodeInfo = missingNodes.length > 0 ? ` (${missingNodes.join(', ')})` : '';
      return window.I18n?.t('workflow.refNotExist', { count: missing.length, nodes: nodeInfo }) || `${missing.length} ảnh tham chiếu không còn tồn tại trên Google Flow${nodeInfo}. Vui lòng kiểm tra và cập nhật lại ảnh.`;
    } catch (e) {
      console.warn('[SEOSONA Flow] Check tiles exist failed:', e.message);
      return null;
    }
  }

  _updateProgressUI(data) {
    if (!this.overlay) return;
    const { total, completed } = data;
    const text = this.overlay.querySelector('#editorProgressText');
    const fill = this.overlay.querySelector('#editorProgressFill');
    if (text) text.textContent = `${completed} / ${total}`;
    if (fill) fill.style.width = `${total > 0 ? (completed / total) * 100 : 0}%`;

    // Also update DiagramCanvas progress
    this.diagramCanvas?.showProgress(completed, total);
  }

  _onExecutionStarted() {
    if (!this.overlay) return;

    // Add executing class để disable node palette và các nút copy/branch
    this.overlay.classList.add('wf-executing');

    const resetBtn = this.overlay.querySelector('#resetWorkflowInEditorBtn');
    const logPanel = this.overlay.querySelector('#executionLogPanel');

    resetBtn?.classList.add('hidden');
    // Phase: Default ẨN log panel khi workflow chạy — user click toggle button để mở khi cần xem.
    // Trước đây auto-show → chiếm không gian editor không cần thiết.
    logPanel?.classList.add('hidden');

    // Toggle toolbar play/stop buttons
    const toolbarPlayBtn = this.overlay.querySelector('.seosonaflow-wf-tool-btn[data-action="run-workflow"]');
    const toolbarStopBtn = this.overlay.querySelector('.seosonaflow-wf-tool-btn[data-action="stop-workflow"]');
    toolbarPlayBtn?.classList.add('hidden');
    toolbarStopBtn?.classList.remove('hidden');

    // Hide run & delete node buttons in sidebar during execution
    this.overlay.querySelector('#runSingleNodeBtn')?.classList.add('hidden');
    this.overlay.querySelector('#deleteNodeBtn')?.classList.add('hidden');

    // Hide hover toolbar run buttons on all nodes
    this.overlay.querySelectorAll('.df-hover-btn[data-action="run-node"]').forEach(b => b.classList.add('hidden'));
    this.overlay.querySelectorAll('.df-hover-btn[data-action="delete-node"]').forEach(b => b.classList.add('hidden'));

    // Disable save button during execution to prevent race conditions
    const saveBtn = this.overlay.querySelector('#saveWorkflowBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.classList.add('is-executing-locked');
    }

    // Clear old log
    const logBody = this.overlay.querySelector('#executionLogBody');
    if (logBody) logBody.innerHTML = '';

    // Disable node form inputs during execution (viewable but not editable)
    this._setNodeFormDisabled(true);

    // Notify other extension contexts
    try { chrome.runtime.sendMessage({ action: 'executionStatusUpdate', status: 'started' }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_onExecutionStarted', e); }
  }

  async _onExecutionCompleted(data) {
    if (!this.overlay) return;

    // Remove executing class để enable node palette và các nút copy/branch
    this.overlay.classList.remove('wf-executing');

    this.diagramCanvas?.hideProgress();

    // Clear tất cả connection-active animations — đảm bảo không còn flowing dashed
    // sau khi execution end (kể cả khi stop abrupt, workflow error trước final status).
    try {
      this.overlay.querySelectorAll('svg.connection.connection-active')
        .forEach((conn) => conn.classList.remove('connection-active'));
    } catch (e) { /* ignore */ }

    if (data?.singleNode) {
      // Single node execution: always show Run button
      if (data?.error) {
        this._addLogEntry(window.I18n?.t('workflow.errorPrefix', { message: data.error.message }) || `Lỗi: ${data.error.message}`, 'error');
      } else {
        // Record usage for single node execution (success case)
        if (window.featureGate) {
          await window.featureGate.recordPendingWorkflowRun();
        }
      }
      this._showRunButton();
    } else if (data?.error) {
      this._addLogEntry(window.I18n?.t('workflow.errorPrefix', { message: data.error.message }) || `Lỗi: ${data.error.message}`, 'error');
      // Error: hiện cả Play + Reset (user có thể retry hoặc reset)
      this._showRunButton();
      this.overlay.querySelector('#resetWorkflowInEditorBtn')?.classList.remove('hidden');
    } else if (data?.stopped) {
      this._addLogEntry(window.I18n?.t('workflow.workflowStopped') || 'Workflow đã bị dừng.', 'warn');
      this._checkAndToggleRunResetButton();
    } else {
      // Record trial run usage AFTER workflow completes successfully
      if (window.featureGate) {
        await window.featureGate.recordPendingWorkflowRun();
      }
      this._addLogEntry(window.I18n?.t('workflow.workflowCompleted') || 'Workflow hoàn thành!', 'success');
      this._showResetButton();
    }

    // Re-enable node form inputs after execution
    this._setNodeFormDisabled(false);

    // Show run & delete node buttons again
    this.overlay.querySelector('#runSingleNodeBtn')?.classList.remove('hidden');
    this.overlay.querySelector('#deleteNodeBtn')?.classList.remove('hidden');
    this._updateResetSingleNodeButton();

    // Show hover toolbar run & delete buttons on all nodes
    this.overlay.querySelectorAll('.df-hover-btn[data-action="run-node"]').forEach(b => b.classList.remove('hidden'));
    this.overlay.querySelectorAll('.df-hover-btn[data-action="delete-node"]').forEach(b => b.classList.remove('hidden'));

    // Toggle toolbar play/stop buttons
    const toolbarPlayBtn = this.overlay.querySelector('.seosonaflow-wf-tool-btn[data-action="run-workflow"]');
    const toolbarStopBtn = this.overlay.querySelector('.seosonaflow-wf-tool-btn[data-action="stop-workflow"]');
    toolbarPlayBtn?.classList.remove('hidden');
    toolbarStopBtn?.classList.add('hidden');

    // Re-enable save button after execution
    const saveBtn = this.overlay.querySelector('#saveWorkflowBtn');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove('is-executing-locked');
    }

    // Update quota display after execution
    this._updateQuotaDisplay();

    // Notify other extension contexts
    try { chrome.runtime.sendMessage({ action: 'executionStatusUpdate', status: 'completed' }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_onExecutionCompleted', e); }
  }

  _setNodeFormDisabled(disabled) {
    const body = this.overlay?.querySelector('#nodeFormBody');
    const footer = this.overlay?.querySelector('#nodeFormFooter');
    if (!body && !footer) return;
    // BUG FIX 2026-06-05: Idempotent save/restore wasDisabled state.
    // Trước: dataset.wasDisabled BỊ OVERWRITE khi disable gọi 2 lần liên tiếp
    // (_onExecutionStarted + node:started cùng disable cùng node) → wasDisabled="true"
    // → restore lần đầu (node:completed) → disabled=true → kẹt disabled sau run → user
    // KHÔNG edit được textarea.
    // Sau: chỉ save wasDisabled NẾU CHƯA save (idempotent). Chỉ restore NẾU có dataset.
    // Per-element state → an toàn với nested disable calls cùng node + cross-form lifecycle.
    const containers = [body, footer].filter(Boolean);
    containers.forEach(c => {
      c.querySelectorAll('input, select, textarea, button').forEach(el => {
        if (disabled) {
          // Save original state CHỈ KHI chưa save (idempotent)
          if (el.dataset.wasDisabled === undefined) {
            el.dataset.wasDisabled = el.disabled ? 'true' : 'false';
          }
          el.disabled = true;
        } else {
          // Restore CHỈ KHI có state đã save (idempotent — lần 2 no-op)
          if (el.dataset.wasDisabled !== undefined) {
            el.disabled = el.dataset.wasDisabled === 'true';
            delete el.dataset.wasDisabled;
          }
        }
      });
    });
  }

  /**
   * Disable/enable form khi node đang running được chọn
   */
  _disableFormIfSelectedNode(nodeId, disabled) {
    if (!this.selectedNodeId || !nodeId) return;
    const drawflowId = this._findDrawflowId(nodeId);
    if (String(drawflowId) !== String(this.selectedNodeId)) return;
    this._setNodeFormDisabled(disabled);
  }

  /**
   * Force stop thực thi (workflow đầy đủ HOẶC single node) — đồng bộ với ExecutionTracker._handleStop.
   * Bug fix 2026-05-27: stop() graceful chờ submitted node → single-node gen không dừng từ toolbar.
   * Force: cancel TẤT CẢ token + gửi stopExecution VÔ ĐIỀU KIỆN (break Flow waitForNewTiles) +
   * isRunning=false + clear cross-context. Sau đó reset UI toolbar về idle (phòng executor await stuck).
   */
  _forceStopExecution() {
    const exec = window.workflowExecutor;
    // K.14 (2026-05-29): Capture wfId TRƯỚC khi reset exec state — sau line `exec.isRunning=false`
    // currentWorkflow có thể bị clear → mất context cho broadcast cross-context.
    const stopWfId = exec?.currentWorkflow?.wf_id || this.workflow?.wf_id || null;
    try {
      // Graceful parts trước (PromptQueue stopJob, per-token cancel, Grok abort) khi isRunning còn true.
      if (exec?.isRunning) { try { exec.stop(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_forceStopExecution', _); } }
      // Force parts.
      if (exec) {
        exec.shouldStop = true;
        exec.isRunning = false;
      }
      window.ExecutionGate?.cancelAll?.().catch?.(() => {});
      window.MessageBridge?.stopExecution?.().catch?.(() => {}); // vô điều kiện → break content script wait
      window.WorkflowExecutor?.clearCrossContextRunning?.();
      window.eventBus?.emit('execution:force_stopped');
      // K.14 (2026-05-29): ALWAYS broadcast cross-context execution:stop (regardless of isRunning).
      // Bug: trước fix chỉ rely on `exec.stop()` để broadcast (line 2267 WorkflowExecutor). Nếu
      // race condition khiến `exec.isRunning=false` khi click stop → skip exec.stop() → KHÔNG
      // broadcast → sidebar không update card running state.
      if (stopWfId) {
        try {
          chrome.runtime.sendMessage({
            action: 'workflowExecutionEvent',
            event: 'execution:stop',
            data: { wf_id: stopWfId },
          }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_downloadProviderTile', _e); });
        } catch (_) { /* ignore */ }
      }
    } catch (e) {
      console.warn('[WorkflowEditor] _forceStopExecution error:', e?.message);
    }
    // Reset toolbar UI về idle (nếu executor await stuck → finally chưa chạy kịp).
    try {
      this.overlay?.querySelector('.seosonaflow-wf-tool-btn[data-action="run-workflow"]')?.classList.remove('hidden');
      this.overlay?.querySelector('.seosonaflow-wf-tool-btn[data-action="stop-workflow"]')?.classList.add('hidden');
      this.overlay?.querySelector('#runSingleNodeBtn')?.classList.remove('hidden');
      this.overlay?.querySelectorAll('.df-hover-btn[data-action="run-node"]').forEach(b => b.classList.remove('hidden'));
      this._setRunSingleNodeButton('run');
      this._addLogEntry?.(window.I18n?.t('workflow.forceStopped') || 'Đã dừng thực thi (force stop).', 'warn');
    } catch (_) { /* noop */ }
  }

  _setRunSingleNodeButton(mode) {
    const btn = this.overlay?.querySelector('#runSingleNodeBtn');
    if (!btn) return;
    if (mode === 'stop') {
      btn.title = window.I18n?.t('common.stop') || 'Dừng';
      btn.style.color = 'var(--destructive, #ef4444)';
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"></rect></svg>`;
    } else {
      btn.title = window.I18n?.t('workflow.runThisNode') || 'Chạy node này';
      btn.style.color = 'var(--success, #19d07b)';
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    }
  }

  /**
   * Download node files. User chọn source explicit qua 2 button:
   *   - source='original': chỉ download tiles có provider URL gốc (Grok/ChatGPT chất lượng 100%)
   *   - source='flow': download qua Flow tile (DownloadHelper modal cho single, loop cho multi)
   * Fallback: tile original fail (URL expired) → tự fallback Flow path trong `_downloadProviderTile`.
   */
  async _downloadNodeFiles({ source = 'original', nodeId = null } = {}) {
    // nodeId optional — hover toolbar truyền node cụ thể (không cần selected); form panel
    // không truyền → fallback selectedNodeId (node đang mở).
    const targetNodeId = nodeId || this.selectedNodeId;
    if (!targetNodeId || !this.diagramCanvas?.editor) return;
    const dfNode = this.diagramCanvas.editor.getNodeFromId(targetNodeId);
    const data = dfNode?.data;
    if (!data?.result_file_ids) return;
    const fileIds = data.result_file_ids.split(',').map(s => s.trim()).filter(Boolean);
    if (fileIds.length === 0) return;
    const label = data.prompt || data.node_name || 'flow';
    const fileNames = data.result_file_names || {};
    const providerUrls = data.result_provider_urls || {};

    // Detect video node → dùng video resolution
    const isVideo = data.media_type === 'Video' || data.gen_type === 'Video'
      || this._isNodeVideoFromCache(fileIds);
    const resolution = isVideo
      ? (data.video_download_resolution || '720p')
      : (data.download_resolution || '1k');

    if (source === 'original') {
      // Tải tiles có provider URL gốc (chatgpt/grok — chất lượng 100%, không re-encode).
      const providerTiles = fileIds.filter(id => providerUrls[id]?.url);
      if (providerTiles.length > 0) {
        const providers = [...new Set(providerTiles.map(id => providerUrls[id]?.provider).filter(Boolean))];
        const providerLabel = providers.join('/').toUpperCase();
        window.showNotification?.(window.I18n?.t('workflowNotify.downloadOriginalProgress', { count: providerTiles.length, provider: providerLabel }) || `Đang tải ${providerTiles.length} bản gốc từ ${providerLabel}...`, 'info', 2000);
        console.log('[SEOSONA Flow] Manual download (Original) — tiles:', providerTiles.length, providers);

        for (const fileId of providerTiles) {
          try {
            await this._downloadProviderTile(fileId, providerUrls[fileId], label, fileIds.indexOf(fileId) + 1, data, fileNames[fileId]);
          } catch (e) {
            console.warn('[SEOSONA Flow] Provider download failed:', fileId, e);
          }
        }
        return;
      }
      // 2026-05-26 FIX (chatgpt "click không thấy download"): không có URL gốc provider khả dụng
      // (URL chưa lưu / hết hạn TTL / key lệch sau correct) → KHÔNG return im lặng nữa mà FALLBACK
      // xuống Flow tile download bên dưới. Ảnh chatgpt/grok đã bridge sang Flow tile → tải được
      // qua Flow menu. Trước fix: return → người dùng bấm không thấy gì.
      console.log('[SEOSONA Flow] Manual download: no usable provider original → fallback Flow tile download');
    }

    // source='flow' HOẶC original-fallback — download qua Flow context menu / modal.
    window.showNotification?.(window.I18n?.t('workflowNotify.downloadFlowProgress', { count: fileIds.length }) || `Đang tải ${fileIds.length} file qua Google Flow...`, 'info', 2000);
    console.log('[SEOSONA Flow] Manual download (Flow) — tiles:', fileIds.length);

    const wfName = this.workflow?.wf_name || null;

    // Single Flow file → show DownloadHelper modal cho user chọn resolution
    if (fileIds.length === 1 && typeof DownloadHelper !== 'undefined') {
      const fileId = fileIds[0];
      const fileName = fileNames[fileId] || null;
      const mediaType = isVideo || this._isTileVideo(fileId) ? 'video' : 'image';
      DownloadHelper.showModal({
        tileId: fileId,
        fileName: fileName,
        promptText: label,
        taskName: wfName,
        mediaType: mediaType
      });
      return;
    }

    // Nhiều Flow files → batch modal cho user chọn resolution 1 lần (áp cho tất cả).
    // 2026-05-26: manual download KHÔNG dựa download_resolution (chỉ tồn tại khi auto_download
    // bật) → LUÔN hỏi user qua modal, giống result tab single-file. Trước fix: loop dùng
    // download_resolution (unset → 1k) → không hỏi user.
    if (typeof DownloadHelper !== 'undefined' && DownloadHelper.showBatchModal) {
      DownloadHelper.showBatchModal({
        tileIds: fileIds,
        fileNames,
        promptText: label,
        taskName: wfName,
        mediaType: isVideo ? 'video' : 'image',
      });
      return;
    }

    // Fallback (DownloadHelper chưa load): tải theo resolution node config / global default
    for (const fileId of fileIds) {
      try {
        const fileName = fileNames[fileId] || null;
        if (typeof MessageBridge !== 'undefined') {
          await MessageBridge.downloadTileMedia(fileId, label, wfName, fileName, resolution);
        } else if (typeof downloadTileMedia === 'function') {
          await downloadTileMedia(fileId, label, wfName, fileName, resolution);
        }
      } catch (e) {
        console.warn('[SEOSONA Flow] Download failed:', fileId, e);
      }
    }
  }

  /**
   * Tải tile từ URL provider gốc (Grok/ChatGPT) — chất lượng 100%, không re-encode.
   * 2026-05-26: tải TRỰC TIẾP CDN URL qua chrome.downloads — KHÔNG fetch qua tab provider.
   * Lý do: chrome.downloads.download bỏ qua CORS + tự dùng cookie jar / signed URL → KHÔNG
   * cần tab grok/chatgpt mở (tab_id lưu kèm bị stale sau reload — chính là lý do grok video
   * không tải được). Đặc biệt grok video = synthetic id (không có tile Flow) → đây là đường
   * tải DUY NHẤT. (Cũ: fetch qua tab → base64 → blob → vì dùng fetch() bị CORS nên phải chạy
   * trong tab; chrome.downloads không bị CORS nên bỏ được hết.)
   */
  async _downloadProviderTile(fileId, providerData, promptText, index, nodeData, fileName) {
    const { url, provider, media_type } = providerData;
    if (!url) {
      console.warn('[SEOSONA Flow] _downloadProviderTile: missing url', { fileId, provider });
      return;
    }
    const ext = media_type === 'video' ? 'mp4' : 'png';

    try {
      // Build filename theo template settings (giống auto-download).
      // Single source of truth qua DownloadHelper.getSettings().
      const _dlSet = await window.DownloadHelper.getSettings();
      const folder = _dlSet.folder;
      const template = _dlSet.template;

      let filename = window.GenTab?._buildChatGPTFilename?.(
        template,
        window._currentProjectName || 'flow',
        promptText || '',
        1, index, '',
        this.workflow?.wf_name || null,
        folder
      ) || `${folder}/${(window.DownloadHelper?.toAscii?.(this.workflow?.wf_name) || this.workflow?.wf_name || 'workflow').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30)}/${provider}-${Date.now()}-${index}.${ext}`;
      if (ext !== 'png' && filename.endsWith('.png')) {
        filename = filename.replace(/\.png$/i, `.${ext}`);
      }

      // Tải thẳng CDN URL — chrome.downloads tự xử lý cookie/signed URL, không cần tab.
      const _dlUrl = await (window.scrubbedDownloadUrl?.(url) ?? url);
      const dlResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'chromeDownload', url: _dlUrl, filename }, (r) => resolve(r));
      });

      if (!dlResp?.success) {
        console.warn(`[SEOSONA Flow] ${provider} direct download fail:`, dlResp?.error);
      } else {
        console.log(`[SEOSONA Flow] ${provider} direct download OK:`, filename);
      }
    } catch (err) {
      console.error('[SEOSONA Flow] _downloadProviderTile exception:', err);
    }
  }

  /** Check if any fileId in cache is video */
  _isNodeVideoFromCache(fileIds) {
    for (const fid of fileIds) {
      if (this._tileCache.has(fid) && this._tileCache.get(fid).type === 'video') return true;
    }
    return false;
  }

  /** Check single tile is video from cache */
  _isTileVideo(fileId) {
    return this._tileCache.has(fileId) && this._tileCache.get(fileId).type === 'video';
  }

  _updateDownloadButton() {
    const btn = this.overlay?.querySelector('#downloadNodeBtn');
    if (!btn) return;
    if (!this.selectedNodeId || !this.diagramCanvas?.editor) { btn.classList.add('hidden'); return; }
    // Get data from drawflow node (selectedNodeId is drawflow numeric ID)
    const dfNode = this.diagramCanvas.editor.getNodeFromId(this.selectedNodeId);
    const fileIds = (dfNode?.data?.result_file_ids || '').split(',').filter(Boolean);
    btn.classList.toggle('hidden', fileIds.length === 0);
  }

  _updateResetSingleNodeButton() {
    const headerBtn = this.overlay?.querySelector('#resetSingleNodeBtn');
    const footerBtn = this.overlay?.querySelector('#resetNodeFooterBtn');

    const hideAll = () => {
      headerBtn?.classList.add('hidden');
      footerBtn?.classList.add('hidden');
    };

    if (!this.selectedNodeId || !this.diagramCanvas?.editor) { hideAll(); return; }

    // Get data from Drawflow node (selectedNodeId is Drawflow numeric ID)
    const dfNode = this.diagramCanvas.editor.getNodeFromId(this.selectedNodeId);
    if (!dfNode?.data) { hideAll(); return; }

    const data = dfNode.data;
    const hasResults = (data.result_file_ids || '').split(',').filter(Boolean).length > 0;
    const hasResultText = !!data.result_text;
    const isNonPending = data.status && data.status !== 'pending';
    // Bug fix: cho phép reset BẤT KỂ executor running. Lý do:
    //   - Node prompt running mà gặp lỗi → status vẫn 'running' (callback failed không fire) → user
    //     không reset được vì button bị ẩn → workflow stuck mãi.
    //   - Reset chỉ clear data của node, không stop workflow. Nếu workflow vẫn chạy node khác,
    //     reset tiếp tục an toàn (next iteration sẽ thấy status='pending' và execute lại nếu cần).
    // Reset bị block CHỈ khi node hoàn toàn pending + chưa có kết quả gì (không có gì để reset).
    const shouldHide = !hasResults && !hasResultText && !isNonPending;
    headerBtn?.classList.toggle('hidden', shouldHide);
    footerBtn?.classList.toggle('hidden', shouldHide);
  }

  async _resetSingleNode(drawflowId) {
    // Template mode: không cho reset vì workflow chưa tồn tại trong DB
    if (this.isTemplateMode) return;
    // Read-only mode: không cho phép reset
    if (this.isReadOnly()) return;
    if (!this.workflow?.wf_id || !drawflowId || !this.diagramCanvas?.editor) return;

    // Get node data from Drawflow (drawflowId is numeric Drawflow ID)
    const dfNode = this.diagramCanvas.editor.getNodeFromId(drawflowId);
    if (!dfNode?.data) return;

    const actualNodeId = dfNode.data.node_id;
    const nodeName = dfNode.data.node_name || dfNode.data.node_type || 'Node';

    // Find node in workflow.nodes using actual node_id (UUID)
    const node = this.workflow.nodes?.find(n => String(n.node_id) === String(actualNodeId));

    // Bug fix: bỏ block executor.isRunning. Nếu node đang chạy thực sự + workflow vẫn active
    // → confirm dialog cảnh báo cho user biết. Reset vẫn proceed vì stuck state cần lối thoát.
    const isRunningNow = window.workflowExecutor?.isRunning;
    const confirmMsg = isRunningNow
      ? (window.I18n?.t('workflow.resetNodeWhileRunningConfirm', { name: nodeName })
        || `Workflow đang chạy. Reset "${nodeName}" sẽ xóa kết quả + trạng thái node này (tiếp tục các node khác). Tiếp tục?`)
      : (window.I18n?.t('workflow.resetNodeConfirm', { name: nodeName })
        || `Reset "${nodeName}" sẽ xóa kết quả và trạng thái của node này. Bạn có chắc chắn?`);
    const confirmed = await window.customDialog.confirm(confirmMsg, {
      type: 'warning',
      confirmText: 'Reset',
      cancelText: window.I18n?.t('common.cancel') || 'Hủy',
    });
    if (!confirmed) return;

    // Cancel deferred save timer
    if (this._deferredSaveTimer) {
      clearTimeout(this._deferredSaveTimer);
      this._deferredSaveTimer = null;
      this._updatePlayButtonState();
    }

    // Clear result entries from _tileCache BEFORE clearing node data
    const oldResultIds = (dfNode.data.result_file_ids || '').split(',').filter(Boolean);
    for (const id of oldResultIds) {
      this._tileCache.delete(id);
    }

    // Clear Drawflow node data
    dfNode.data.status = 'pending';
    dfNode.data.result_file_ids = '';
    dfNode.data.result_thumbnails = null;
    dfNode.data.result_file_names = null;
    dfNode.data.error_message = '';
    dfNode.data.executed_at = null;
    // 2026-05-31: prompt + text_extract đều có result_text output cần clear khi reset.
    if (dfNode.data.node_type === 'prompt' || dfNode.data.node_type === 'text_extract') {
      dfNode.data.result_text = '';
      dfNode.data.result_source = '';
      // Clear _extract_failed flag — re-run sau reset sẽ tự set lại nếu cần
      delete dfNode.data._extract_failed;
      delete dfNode.data._extract_reason;
    }

    // CRITICAL: Commit changes to Drawflow internal state
    // Without this, exportWorkflow() will export stale data (status still 'completed')
    this.diagramCanvas.editor.updateNodeDataFromId(drawflowId, dfNode.data);

    // Also update workflow.nodes if found
    if (node) {
      node.status = 'pending';
      node.result_file_ids = '';
      node.result_thumbnails = null;
      node.result_file_names = null;
      node.error_message = '';
      node.executed_at = null;
      if (node.node_type === 'prompt' || node.node_type === 'text_extract') {
        node.result_text = '';
        node.result_source = '';
        delete node._extract_failed;
        delete node._extract_reason;
      }
    }

    // Update node status UI on canvas
    this._updateNodeStatusUI(actualNodeId, 'pending');

    // Clear node preview on canvas
    this._clearNodePreview(actualNodeId);

    // 2026-05-31: prompt + text_extract — remove result preview (helper xử lý cả 2 selectors).
    if (dfNode.data.node_type === 'prompt' || dfNode.data.node_type === 'text_extract') {
      this._clearPromptNodeResultPreview(actualNodeId);
    }

    // Wait for any concurrent save to finish before starting our save
    if (this._isSaving) {
      const waitStart = Date.now();
      while (this._isSaving && Date.now() - waitStart < 5000) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Save workflow
    await this.saveWorkflow();

    // Refresh result tab if this node's form is open (compare Drawflow IDs)
    if (String(this.selectedNodeId) === String(drawflowId)) {
      const resultBody = this.overlay?.querySelector('#nodeResultBody');
      if (resultBody) {
        resultBody.innerHTML = this._renderNodeResultTab(dfNode.data);
      }
      this._updateDownloadButton();
      this._updateResetSingleNodeButton();
    }

    // Check if workflow needs run/reset button toggle
    this._checkAndToggleRunResetButton();

    this._addLogEntry(window.I18n?.t('workflow.nodeResetSuccess', { name: nodeName }) || `Node "${nodeName}" đã được reset.`, 'info');
    window.eventBus?.emit('storage:workflow_saved', { wfId: this.workflow.wf_id });
    try { chrome.runtime.sendMessage({ action: 'workflowSaved', wfId: this.workflow.wf_id }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_resetSingleNode', e); }

    // Defensive: đảm bảo save/reset button enabled lại sau single node reset.
    this._isSaving = false;
    const saveBtnAfter = this.overlay?.querySelector('#saveWorkflowBtn');
    const resetBtnAfter = this.overlay?.querySelector('#resetWorkflowInEditorBtn');
    if (saveBtnAfter) saveBtnAfter.disabled = false;
    if (resetBtnAfter) resetBtnAfter.disabled = false;
    this._updatePlayButtonState();
  }

  async _checkAndToggleRunResetButton() {
    const fullWorkflow = await window.storageManager?.getWorkflow(this.workflow?.wf_id);
    const nodes = fullWorkflow?.nodes || [];
    const allCompleted = nodes.length > 0 && nodes.every(n => n.status === 'completed');
    if (allCompleted) {
      this._showResetButton();
    } else {
      this._showRunButton();
    }
  }

  _addLogEntry(message, type = 'info') {
    const logBody = this.overlay?.querySelector('#executionLogBody');
    if (!logBody) return;

    const entry = document.createElement('div');
    entry.className = `execution-log-entry log-${type}`;
    const time = window.I18n?.formatTime?.(new Date()) || new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="log-time">${time}</span> <span class="log-msg">${this.escapeHtml(message)}</span>`;
    logBody.appendChild(entry);
    logBody.scrollTop = logBody.scrollHeight;
  }

  _showSaveToast() {
    // Remove existing toast
    this.overlay?.querySelector('.save-toast')?.remove();

    const toast = document.createElement('div');
    toast.className = 'save-toast';
    toast.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <span>Workflow saved</span>
    `;
    this.overlay?.appendChild(toast);

    // Auto remove after animation
    setTimeout(() => toast.remove(), 2500);
  }

  // === Node Picker Popup ===

  /**
   * Phase WK-1.2 enhancement: Hỗ trợ portContext để filter compatible nodes khi click empty port.
   *   portContext = { side: 'in'|'out', portType: 'image'|'text'|..., sourceNodeDrawflowId, portName }
   * Khi side='in' (click input port empty) → suggest nodes có output type tương thích.
   * Khi side='out' (click output port empty) → suggest nodes có input type tương thích.
   */

  /**
   * Phase WK-1.2 enhancement: Auto-connect new node với port đã trigger picker.
   * portContext = { side, portType, portName, sourceNodeDrawflowId }
   * - side='in' → new node có output tương thích với portType → connect new.output → existing.input
   * - side='out' → new node có input tương thích → connect existing.output → new.input
   */
  /**
   * Auto-layout: sắp xếp lại tất cả node theo BFS levels từ start node (hoặc roots không có upstream).
   * Cùng level (depth) → cùng cột. Khoảng cách 380px ngang × 240px dọc, đảm bảo connection rõ.
   */
  _autoLayoutNodes() {
    const editor = this.diagramCanvas?.editor;
    if (!editor) return;
    const exportData = editor.export();
    const nodes = exportData?.drawflow?.Home?.data || {};
    const ids = Object.keys(nodes);
    if (ids.length === 0) return;

    // Build adjacency: parents[id] = set của upstream node ids
    const parents = {};
    const children = {};
    ids.forEach(id => { parents[id] = new Set(); children[id] = new Set(); });
    for (const [id, n] of Object.entries(nodes)) {
      const inputs = n.inputs || {};
      for (const inp of Object.values(inputs)) {
        for (const c of (inp.connections || [])) {
          const src = String(c.node);
          parents[id].add(src);
          if (children[src]) children[src].add(id);
        }
      }
    }

    // Roots: node không có parent (in-degree = 0). Ưu tiên type='start' nếu có.
    const roots = ids.filter(id => parents[id].size === 0);
    if (roots.length === 0) {
      // Có cycle hoặc tất cả nodes có parent → fallback: dùng node có ít parent nhất
      roots.push(ids[0]);
    }

    // BFS để gán depth (level) cho mỗi node
    const depth = {};
    const queue = [];
    roots.forEach(r => { depth[r] = 0; queue.push(r); });
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const ch of children[cur]) {
        const newDepth = depth[cur] + 1;
        if (depth[ch] === undefined || newDepth > depth[ch]) {
          depth[ch] = newDepth;
          queue.push(ch);
        }
      }
    }
    // Nodes không reach từ roots (orphan) → gán depth = 0
    ids.forEach(id => { if (depth[id] === undefined) depth[id] = 0; });

    // Group theo depth
    const levels = {};
    for (const id of ids) {
      const d = depth[id];
      if (!levels[d]) levels[d] = [];
      levels[d].push(id);
    }

    // Layout: x = depth * STEP_X + START_X. Y dùng cumulative offset theo offsetHeight thực tế
    // của mỗi node để tránh overlap khi có node cao (image/prompt với preview lớn).
    const START_X = 80;
    const START_Y = 80;
    const STEP_X = 480;  // node width ~340 + gap 140 cho connection lines rõ ràng
    const VERT_GAP = 100; // khoảng cách dọc lớn hơn để lines không chồng chéo
    const FALLBACK_HEIGHT = 220;

    // Pre-compute node heights để tính toán Y position chính xác hơn
    const nodeHeights = {};
    ids.forEach(id => {
      const el = document.getElementById(`node-${id}`);
      nodeHeights[id] = el?.offsetHeight || FALLBACK_HEIGHT;
    });

    // Two-pass layout: pass 1 đặt vị trí sơ bộ, pass 2 căn chỉnh theo connections
    // Pass 1: Sort nodes trong mỗi level theo weighted avg của parent + child Y positions
    const tempPositions = {};

    Object.entries(levels).forEach(([d, levelIds]) => {
      const dNum = parseInt(d, 10);

      // Sort nodes theo avg Y của cả parents VÀ children (nếu có) để minimize crossings
      levelIds.sort((a, b) => {
        const getWeightedY = (nodeId) => {
          const parentIds = [...parents[nodeId]];
          const childIds = [...children[nodeId]];
          let totalWeight = 0;
          let weightedSum = 0;

          // Parents có weight cao hơn (flow từ trái sang phải)
          for (const pid of parentIds) {
            const py = tempPositions[pid]?.y ?? nodes[pid]?.pos_y ?? 0;
            weightedSum += py * 2;
            totalWeight += 2;
          }
          // Children có weight thấp hơn nhưng vẫn tính
          for (const cid of childIds) {
            const cy = nodes[cid]?.pos_y ?? 0;
            weightedSum += cy;
            totalWeight += 1;
          }

          return totalWeight > 0 ? weightedSum / totalWeight : parseInt(nodeId, 10) * 100;
        };

        return getWeightedY(a) - getWeightedY(b);
      });

      const x = START_X + dNum * STEP_X;
      let cursorY = START_Y;

      levelIds.forEach((id) => {
        tempPositions[id] = { x, y: cursorY };
        cursorY += nodeHeights[id] + VERT_GAP;
      });
    });

    // Pass 2: Điều chỉnh Y để căn giữa với parent connections (giảm đường chéo dài)
    Object.entries(levels).forEach(([d, levelIds]) => {
      const dNum = parseInt(d, 10);
      if (dNum === 0) return; // Level 0 (roots) giữ nguyên

      levelIds.forEach((id) => {
        const parentIds = [...parents[id]];
        if (parentIds.length === 0) return;

        // Tính trung bình Y của các parent nodes
        let parentYSum = 0;
        parentIds.forEach(pid => {
          const ph = nodeHeights[pid] || FALLBACK_HEIGHT;
          parentYSum += (tempPositions[pid]?.y ?? 0) + ph / 2; // center of parent
        });
        const avgParentCenterY = parentYSum / parentIds.length;

        // Điều chỉnh Y của node này để center gần với avg parent center
        // Nhưng không được overlap với nodes khác trong cùng level
        const currentY = tempPositions[id].y;
        const nodeH = nodeHeights[id];
        const targetY = avgParentCenterY - nodeH / 2;

        // Chỉ shift nếu không gây overlap và không đi quá xa
        const maxShift = VERT_GAP * 0.6;
        const shift = Math.max(-maxShift, Math.min(maxShift, targetY - currentY));
        tempPositions[id].y = currentY + shift;
      });
    });

    // Pass 3: Resolve overlaps trong mỗi level (sort by Y rồi đảm bảo min gap)
    Object.entries(levels).forEach(([d, levelIds]) => {
      // Sort by current Y position
      levelIds.sort((a, b) => tempPositions[a].y - tempPositions[b].y);

      // Ensure minimum gap between consecutive nodes
      const minGap = VERT_GAP * 0.5;
      for (let i = 1; i < levelIds.length; i++) {
        const prevId = levelIds[i - 1];
        const currId = levelIds[i];
        const prevBottom = tempPositions[prevId].y + nodeHeights[prevId];
        const currTop = tempPositions[currId].y;
        if (currTop < prevBottom + minGap) {
          tempPositions[currId].y = prevBottom + minGap;
        }
      }
    });

    // Apply final positions
    ids.forEach(id => {
      const pos = tempPositions[id];
      if (pos) this._moveNodeTo(id, pos.x, pos.y);
    });

    // Smart zoom sau khi sắp xếp xong (defer để DOM update offsetWidth)
    requestAnimationFrame(() => {
      try { this.diagramCanvas?.fitToScreen?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#getWeightedY', e); }
    });

    // Toast
    if (typeof window.showNotification === 'function') {
      window.showNotification(
        window.I18n?.t('workflow.autoLayoutDone') || 'Nodes rearranged by flow',
        'success', 1500
      );
    }
    this._hasUnsavedChanges = true;
  }

  /**
   * Di chuyển 1 node tới (x, y) trong canvas coords + update Drawflow data + redraw connections.
   */
  _moveNodeTo(drawflowId, x, y) {
    const editor = this.diagramCanvas?.editor;
    if (!editor) return;
    const moduleData = editor.drawflow?.drawflow?.Home?.data;
    if (!moduleData || !moduleData[drawflowId]) return;
    moduleData[drawflowId].pos_x = x;
    moduleData[drawflowId].pos_y = y;
    const nodeEl = document.getElementById(`node-${drawflowId}`);
    if (nodeEl) {
      nodeEl.style.top = `${y}px`;
      nodeEl.style.left = `${x}px`;
    }
    try { editor.updateConnectionNodes(`node-${drawflowId}`); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_moveNodeTo', e); }
  }

  /**
   * Smart placement cho new node tạo từ empty port.
   * - portContext.side === 'in'  → new node ở BÊN TRÁI existing (sẽ feed vào input)
   * - portContext.side === 'out' → new node ở BÊN PHẢI existing
   * Y-align với existing, dồn xuống khi có overlap với node khác.
   * @returns {{x, y}|null} canvas coords cho Drawflow.addNode
   */
  _calculateSpawnPosition(portContext, _newType) {
    const editor = this.diagramCanvas?.editor;
    if (!editor || !portContext?.sourceNodeDrawflowId) return null;

    const existing = editor.getNodeFromId(portContext.sourceNodeDrawflowId);
    if (!existing) return null;

    const existingX = existing.pos_x || 0;
    const existingY = existing.pos_y || 0;

    // Lấy width thực tế từ DOM (offsetWidth = un-transformed CSS px, đúng cho canvas coord)
    const nodeEl = this.overlay?.querySelector(`#node-${portContext.sourceNodeDrawflowId}`);
    const existingWidth = nodeEl?.offsetWidth || 340;

    const NEW_NODE_WIDTH = 340;  // ~min-width của card
    const HORIZ_GAP = 60;
    const VERT_GAP = 40;
    const ESTIMATED_HEIGHT = 200;

    // Vị trí ngang theo direction
    let targetX;
    if (portContext.side === 'in') {
      // New node ở bên TRÁI: existing.left - newWidth - gap
      targetX = existingX - NEW_NODE_WIDTH - HORIZ_GAP;
    } else {
      // New node ở bên PHẢI: existing.right + gap
      targetX = existingX + existingWidth + HORIZ_GAP;
    }
    let targetY = existingY;

    // Tránh overlap: scan các node hiện có trong khoảng X target
    const exportData = editor.export();
    const allNodes = exportData?.drawflow?.Home?.data || {};
    const collides = (x, y) => Object.entries(allNodes).some(([id, n]) => {
      if (id == portContext.sourceNodeDrawflowId) return false;
      const nx = n.pos_x || 0;
      const ny = n.pos_y || 0;
      const overlapX = Math.abs(nx - x) < (NEW_NODE_WIDTH - 20);
      const overlapY = Math.abs(ny - y) < (ESTIMATED_HEIGHT + VERT_GAP);
      return overlapX && overlapY;
    });

    // Try lần lượt: targetY → targetY+220 → targetY-220 → targetY+440 → ...
    let attempts = 0;
    while (collides(targetX, targetY) && attempts < 6) {
      attempts++;
      const dir = attempts % 2 === 1 ? 1 : -1;
      const step = Math.ceil(attempts / 2) * (ESTIMATED_HEIGHT + VERT_GAP);
      targetY = existingY + dir * step;
    }
    return { x: targetX, y: targetY };
  }


  /**
   * Phase enhancement: Bind click trên inline editable pill (.df-node-tag-editable) → mở mini dropdown
   * → user chọn value → update node data + re-render card + auto saveWorkflow.
   */
  /**
   * 2026-05-25 click-to-edit inline prompt UX.
   * - Default view mode: read-only text + pencil edit icon
   * - Click edit icon → switch to edit mode (textarea focus)
   * - Blur textarea → save + back to view mode + "Đã lưu" badge 1.5s
   * - Esc → cancel (revert + back to view)
   * - mousedown.stopPropagation → tránh Drawflow trigger node drag
   * - 2-way sync với form panel textarea nếu đang mở
   */
  _bindInlinePromptEdit() {
    if (!this.overlay) return;
    if (this.isReadOnly()) return;
    const containers = this.overlay.querySelectorAll('.df-inline-prompt-container');
    containers.forEach((container) => {
      if (container._inlinePromptBound) return;
      container._inlinePromptBound = true;

      const ta = container.querySelector('.df-inline-prompt-edit');
      if (!ta) return;

      const stopProp = (e) => e.stopPropagation();

      // Always-edit variant (prompt redesign): textarea LUÔN editable, save on blur → flash
      // saved badge ở header. Interaction: CLICK (không move) = focus/edit inline; CLICK+DRAG = kéo
      // node (Drawflow). Khi ĐANG edit → thao tác bình thường (đặt cursor), không kéo.
      if (container.classList.contains('df-prompt-always-edit')) {
        ta.addEventListener('mousedown', (e) => {
          if (document.activeElement === ta) {
            // Đang edit → để textarea xử lý (đặt cursor/select), chặn Drawflow kéo node
            e.stopPropagation();
            return;
          }
          // Chưa edit: chặn auto-focus, phân biệt click vs drag. KHÔNG stopProp → Drawflow nhận
          // mousedown để kéo node nếu user drag.
          e.preventDefault();
          const sx = e.clientX, sy = e.clientY;
          let moved = false;
          const onMove = (me) => {
            if (Math.abs(me.clientX - sx) > 4 || Math.abs(me.clientY - sy) > 4) { moved = true; cleanup(); }
          };
          const onUp = () => { cleanup(); if (!moved) ta.focus(); }; // click không move → edit
          const cleanup = () => {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
          };
          document.addEventListener('mousemove', onMove, true);
          document.addEventListener('mouseup', onUp, true);
        });
        ta.addEventListener('dblclick', stopProp);
        ta.addEventListener('input', () => this._updateNodePromptCharCount(ta));
        ta.addEventListener('blur', () => {
          const changed = this._savePromptInline(ta);
          if (changed) this._flashSavedBadge(container);
        });
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            ta.value = this._getCurrentPromptForNode(container); // revert
            this._updateNodePromptCharCount(ta);
            ta.blur();
          } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            ta.blur(); // save via blur
          }
          // Enter = newline (multi-line prompt). Save xảy ra ở blur.
        });
        return;
      }

      const editBtn = container.querySelector('.df-inline-prompt-edit-btn');
      const viewEl = container.querySelector('.df-inline-prompt-view');
      const textEl = container.querySelector('.df-inline-prompt-text');
      if (!editBtn || !viewEl || !textEl) return;

      // Stop Drawflow drag/dblclick trên cả container
      [editBtn, viewEl, ta].forEach((el) => {
        el.addEventListener('mousedown', stopProp);
        el.addEventListener('dblclick', stopProp);
      });

      // Auto-resize textarea
      const autoResize = () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(Math.max(ta.scrollHeight, 60), 160) + 'px';
      };

      // Enter edit mode
      const enterEditMode = () => {
        container.dataset.mode = 'edit';
        container.dataset.saved = 'false'; // hide saved badge nếu visible
        ta.value = this._getCurrentPromptForNode(container);
        autoResize();
        // Focus + place cursor at end
        setTimeout(() => {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }, 0);
      };

      // Exit edit mode + save
      const exitEditMode = (save = true) => {
        if (container.dataset.mode !== 'edit') return;
        container.dataset.mode = 'view';
        if (save) {
          const changed = this._savePromptInline(ta, container);
          if (changed) {
            // Update view text + show saved badge
            this._refreshPromptViewText(container, ta.value);
            this._flashSavedBadge(container);
          }
        }
      };

      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        enterEditMode();
      });

      // Click vào view text cũng enter edit (UX shortcut)
      viewEl.addEventListener('click', (e) => {
        // Tránh trigger nếu click vào edit btn (đã handle riêng)
        if (e.target.closest('.df-inline-prompt-edit-btn')) return;
        e.stopPropagation();
        enterEditMode();
      });

      // Textarea events
      ta.addEventListener('input', autoResize);
      ta.addEventListener('blur', () => exitEditMode(true));
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          ta.value = this._getCurrentPromptForNode(container); // revert
          exitEditMode(false);
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          // Save + exit edit
          e.preventDefault();
          ta.blur();
        }
      });
    });
  }

  /**
   * Get current prompt value từ node data (live state) cho container.
   */
  _getCurrentPromptForNode(container) {
    const nodeEl = container.closest('.drawflow-node');
    if (!nodeEl) return '';
    const drawflowId = nodeEl.id?.replace('node-', '');
    const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    return node?.data?.prompt || '';
  }

  /**
   * Update view text element sau save (sync UI với Drawflow state).
   */
  _refreshPromptViewText(container, value) {
    const textEl = container.querySelector('.df-inline-prompt-text');
    if (!textEl) return;
    const trimmed = (value || '').trim();
    const placeholder = window.I18n?.t?.('node.promptPlaceholder') || 'Nhập prompt...';
    if (trimmed) {
      textEl.textContent = value;
      textEl.classList.remove('df-inline-prompt-empty');
    } else {
      textEl.textContent = placeholder;
      textEl.classList.add('df-inline-prompt-empty');
    }
  }

  /**
   * Flash "Đã lưu" badge 1.5s sau save success.
   */
  _flashSavedBadge(container) {
    // Prompt redesign: saved badge nằm ở HEADER (.df-node-saved-badge), không còn trong container.
    // Set text tại runtime (không bake render-time để locale switch không bị stale).
    const badge = container.closest('.df-node')?.querySelector('.df-node-saved-badge')
      || container.querySelector('.df-inline-prompt-saved-badge'); // fallback legacy view/edit
    if (!badge) return;
    const textEl = badge.querySelector('.df-node-saved-text, .df-inline-prompt-saved-text');
    if (textEl) {
      const fallback = { en: 'Saved', }[window.I18n?.getLocale?.()] || 'Đã lưu';
      textEl.textContent = window.I18n?.t?.('common.saved') || fallback;
    }
    if (badge.classList.contains('df-node-saved-badge')) {
      badge.classList.add('show');
      if (badge._savedTimer) clearTimeout(badge._savedTimer);
      badge._savedTimer = setTimeout(() => { badge.classList.remove('show'); badge._savedTimer = null; }, 1500);
    } else {
      // legacy container badge
      container.dataset.saved = 'true';
      if (container._savedTimer) clearTimeout(container._savedTimer);
      container._savedTimer = setTimeout(() => { container.dataset.saved = 'false'; container._savedTimer = null; }, 1500);
    }
  }

  /** Live update char count badge (.df-node-char-count) ở settings-bar của prompt node. */
  _updateNodePromptCharCount(ta) {
    if (!ta) return;
    const counter = ta.closest('.df-node')?.querySelector('.df-node-char-count');
    if (!counter) return;
    const len = (ta.value || '').length;
    const max = window.ValidationRules?.safeGetInt?.('prompt_max_length', 5000) ?? 5000;
    const fmt = (n) => String(n >>> 0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    counter.textContent = `${fmt(len)}/${fmt(max)}`;
    counter.classList.toggle('df-over-limit', len > max);
  }

  /**
   * Save inline prompt text vào Drawflow data + sync form panel nếu đang mở.
   * @returns {boolean} true nếu data thực sự thay đổi (UI có thể flash saved badge)
   */
  _savePromptInline(ta) {
    if (!ta || !this.diagramCanvas?.editor) return false;
    const nodeEl = ta.closest('.drawflow-node');
    if (!nodeEl) return false;
    const drawflowId = nodeEl.id?.replace('node-', '');
    if (!drawflowId) return false;
    const node = this.diagramCanvas.editor.getNodeFromId(drawflowId);
    if (!node?.data) return false;
    const newPrompt = ta.value;
    if ((node.data.prompt || '') === newPrompt) return false; // no change

    // 2026-06-03: Clear stale result_text/result_source khi prompt thay đổi.
    // Lý do: prompt/text/text_extract nodes có cached `result_text` từ lần execute trước
    // (vd Prompt + use_ai=true → AI Agent enhance → save vào result_text).
    // `_combineUpstreamTexts` ưu tiên `result_text` HƠN `prompt` (line 7570-7574 WorkflowExecutor).
    // Nếu user edit prompt nhưng result_text stale → downstream Gen dùng OLD enhanced text → bug.
    // Fix pattern đồng bộ với _resetNodeStatus line 15602-15609.
    const newData = { ...node.data, prompt: newPrompt };
    if (['prompt', 'text', 'text_extract', 'text_template', 'random_pick', 'prompt_sequence', 'variant_expand', 'loop'].includes(node.data?.node_type)) {
      newData.result_text = '';
      newData.result_source = '';
      delete newData._extract_failed;
      delete newData._extract_reason;
    }
    try {
      this.diagramCanvas.editor.updateNodeDataFromId(drawflowId, newData);
    } catch (err) {
      console.warn('[WorkflowEditor] inline prompt save failed:', err?.message);
      return false;
    }
    this._hasUnsavedChanges = true;

    // Sync form panel textarea nếu form đang mở cho node này (2-way binding)
    if (this.selectedNodeId) {
      const selectedDrawflowId = this._findDrawflowId(this.selectedNodeId);
      if (String(selectedDrawflowId) === String(drawflowId)) {
        const formTa = this.overlay?.querySelector('#promptNodeText, #nodePrompt');
        if (formTa && formTa.value !== newPrompt) {
          formTa.value = newPrompt;
        }
      }
    }

    // 2026-06-03: Bug fix — inline edit chỉ update drawflow local + set unsaved flag,
    // KHÔNG persist DB → run sau đó load workflow từ DB → dùng prompt cũ.
    // Fix: schedule debounced saveWorkflow 300ms sau blur. Debounce tránh spam khi user
    // blur+focus nhiều node liên tiếp (1 save cuối cùng đủ — drawflow đã có data mới nhất).
    if (this._inlinePromptSaveTimer) clearTimeout(this._inlinePromptSaveTimer);
    this._inlinePromptSaveTimer = setTimeout(() => {
      this._inlinePromptSaveTimer = null;
      // Skip nếu đang executing (saveWorkflow auto-skip — xem line 10949 log)
      this.saveWorkflow().catch(err =>
        console.warn('[WorkflowEditor] Inline prompt persist failed:', err?.message));
    }, 300);
    return true;
  }

  /** Bind inline node-card inputs (vd delay_seconds): nodrag (mousedown stopProp) + change→persist. */
  /**
   * Stepper số lượng trên card (− x1 +): đổi quantity ±1 (clamp 1..10), cập nhật span + persist.
   * Dùng pattern inline-edit đã kiểm chứng (updateNodeDataFromId + debounced save), KHÔNG re-render
   * toàn card → an toàn, không mất thumbnail/listener.
   */
  _applyQuantityDelta(btnEl, drawflowId, delta) {
    if (this.isReadOnly()) return;
    const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    if (!node?.data) return;
    const cur = parseInt(node.data.quantity, 10) || 1;
    const next = Math.max(1, Math.min(10, cur + delta));
    if (next === cur) return;
    this.diagramCanvas.editor.updateNodeDataFromId(drawflowId, { ...node.data, quantity: next });
    this._hasUnsavedChanges = true;
    // Cập nhật hiển thị span value (không re-render card).
    const valEl = btnEl.closest('.df-qty-stepper')?.querySelector('.df-qty-value');
    if (valEl) valEl.textContent = `${next}x`;
    // 2-way sync với form panel nếu đang mở cho node này.
    const formInput = this.overlay?.querySelector('#nodeQuantity');
    if (formInput && parseInt(formInput.value, 10) !== next) formInput.value = next;
    this._triggerSaveWorkflowDebounced?.();
  }

  _bindInlineNodeInputs() {
    if (!this.overlay) return;
    if (this.isReadOnly()) return;
    const inputs = this.overlay.querySelectorAll('.df-node-inline-input');
    inputs.forEach((input) => {
      if (input._inlineInputBound) return;
      input._inlineInputBound = true;
      const stopProp = (e) => e.stopPropagation();
      input.addEventListener('mousedown', stopProp);
      input.addEventListener('dblclick', stopProp);
      const commit = () => {
        const nodeEl = input.closest('.drawflow-node');
        if (!nodeEl) return;
        const drawflowId = nodeEl.id?.replace('node-', '');
        const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
        if (!node?.data) return;
        // delay node: delay_seconds (clamp 1-300 — đồng bộ backend rule integer|min:1|max:300)
        if (input.classList.contains('df-delay-seconds')) {
          let v = parseInt(input.value, 10);
          if (isNaN(v) || v < 1) v = 1;
          if (v > 300) v = 300;
          input.value = v;
          if ((parseInt(node.data.delay_seconds, 10) || 3) === v) return; // no change
          this.diagramCanvas.editor.updateNodeDataFromId(drawflowId, { ...node.data, delay_seconds: v });
          this._hasUnsavedChanges = true;
          // 2-way sync: cập nhật form panel nếu đang mở cho node này
          const formInput = this.overlay?.querySelector('#nodeDelaySeconds');
          if (formInput && parseInt(formInput.value, 10) !== v) formInput.value = v;
          this._triggerSaveWorkflowDebounced?.();
        }
      };
      input.addEventListener('change', commit);
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); input.blur(); }
      });
    });
  }

  /** Bind inline slug edit (text/image node slug badge dưới node): click → edit contenteditable. */
  _bindInlineSlugEdit() {
    if (!this.overlay) return;
    if (this.isReadOnly()) return;
    const badges = this.overlay.querySelectorAll('.df-node-slug-badge[data-slug-edit]');
    badges.forEach((badge) => {
      if (badge._slugEditBound) return;
      badge._slugEditBound = true;
      const textEl = badge.querySelector('.df-node-slug-text');
      if (!textEl) return;
      // nodrag: thao tác slug không kéo node
      badge.addEventListener('mousedown', (e) => e.stopPropagation());
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        this._startSlugInlineEdit(badge, textEl);
      });
    });
  }

  /** Inline edit 1 slug badge: contenteditable + validate chống trùng (giống right sidebar). */
  _startSlugInlineEdit(badge, textEl) {
    if (textEl.getAttribute('contenteditable') === 'true') return;
    const nodeEl = badge.closest('.drawflow-node');
    if (!nodeEl) return;
    const drawflowId = nodeEl.id?.replace('node-', '');
    const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    if (!node) return;
    const original = node.data?.slug || '';

    textEl.textContent = original; // edit chỉ phần slug (prefix @ là span riêng)
    textEl.setAttribute('contenteditable', 'true');
    textEl.classList.add('editing');
    textEl.focus();
    try {
      const r = document.createRange(); r.selectNodeContents(textEl);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_startSlugInlineEdit', _); }

    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      textEl.removeEventListener('keydown', onKey);
      textEl.removeEventListener('blur', onBlur);
      textEl.removeAttribute('contenteditable');
      textEl.classList.remove('editing');
      // Sanitize giống form: lowercase, chỉ a-z0-9_, bỏ leading digit/underscore
      let val = (textEl.textContent || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/^[0-9_]+/, '');
      if (!save || !val || val === original) {
        textEl.textContent = original; // revert
        return;
      }
      const validation = this._validateSlug(val, drawflowId);
      if (!validation.valid) {
        if (typeof window.showNotification === 'function') window.showNotification(validation.error, 'warning', 2500);
        textEl.textContent = original; // revert khi trùng/sai format
        return;
      }
      textEl.textContent = val;
      badge.setAttribute('title', '@' + val);
      const fresh = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
      if (fresh) {
        this.diagramCanvas.editor.updateNodeDataFromId(drawflowId, { ...fresh.data, slug: val, slug_auto: false });
        this._hasUnsavedChanges = true;
        // 2-way sync form #nodeSlug nếu đang mở
        const formInput = this.overlay?.querySelector('#nodeSlug');
        if (formInput && formInput.value !== val) formInput.value = val;
        const formAuto = this.overlay?.querySelector('#nodeSlugAuto');
        if (formAuto) formAuto.value = 'false';
        this._triggerSaveWorkflowDebounced?.();
      }
    };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    };
    const onBlur = () => commit(true);
    textEl.addEventListener('keydown', onKey);
    textEl.addEventListener('blur', onBlur);
  }

  _bindInlineSettingPills() {
    // 2-tier binding: (1) document capture (fires sớm nhất, robust) + (2) direct binding per pill.
    // Document handler đảm bảo click LUÔN reach _showInlineSettingDropdown bất kể Drawflow consume.
    const overlay = this.overlay;
    if (!overlay) return;

    // Bind inline prompt edit textarea (prompt nodes only)
    try { this._bindInlinePromptEdit(); } catch (e) { /* ignore */ }

    // Bind inline node-card inputs (vd delay_seconds) — nodrag + change→persist
    try { this._bindInlineNodeInputs(); } catch (e) { /* ignore */ }

    // Bind inline slug edit (text/image node) — click → edit + validate chống trùng
    try { this._bindInlineSlugEdit(); } catch (e) { /* ignore */ }

    // Inject gear icon bottom-right cho TẤT CẢ node types
    this._ensureNodeCornerGears();

    // Tier 1: Document-level capture (one-time, idempotent)
    if (!this._docPillBound) {
      this._docPillBound = true;
      const docMouseDown = (e) => {
        const target = e.target?.closest?.('.df-node-tag-editable, .df-node-settings-btn, .df-node-corner-gear, .df-qty-btn');
        if (!target) return;
        if (!this.overlay?.contains(target)) return;
        e.stopPropagation();
      };
      const docClick = (e) => {
        // Stepper số lượng (− x1 +): +/- thay đổi quantity ngay trên card.
        const qtyBtn = e.target?.closest?.('.df-qty-btn');
        if (qtyBtn && this.overlay?.contains(qtyBtn)) {
          e.stopPropagation();
          e.preventDefault();
          if (this.isReadOnly()) return;
          const nodeEl = qtyBtn.closest('.drawflow-node');
          const drawflowId = nodeEl?.id?.replace('node-', '');
          const delta = parseInt(qtyBtn.dataset.qtyDelta, 10) || 0;
          if (drawflowId && delta) this._applyQuantityDelta(qtyBtn, drawflowId, delta);
          return;
        }
        const gear = e.target?.closest?.('.df-node-settings-btn, .df-node-corner-gear');
        if (gear && this.overlay?.contains(gear)) {
          e.stopPropagation();
          e.preventDefault();
          // Preview mode: chặn click settings (trừ admin preview - cho phép xem read-only)
          if (this.isReadOnly() && !this.workflow?._is_admin_view) return;
          const nodeEl = gear.closest('.drawflow-node');
          const drawflowId = nodeEl?.id?.replace('node-', '');
          if (drawflowId && window.eventBus) {
            window.eventBus.emit('node:open_settings', { nodeId: drawflowId });
          }
          return;
        }
        const pill = e.target?.closest?.('.df-node-tag-editable');
        if (!pill || !this.overlay?.contains(pill)) return;
        e.stopPropagation();
        e.preventDefault();
        // Preview mode: chặn click inline setting pill
        if (this.isReadOnly()) return;
        const setting = pill.dataset?.setting;
        const nodeEl = pill.closest('.drawflow-node');
        const drawflowId = nodeEl?.id?.replace('node-', '');
        if (!drawflowId || !setting) return;
        try {
          this._showInlineSettingDropdown(pill, drawflowId, setting);
        } catch (err) {
          console.error('[WorkflowEditor] Inline pill dropdown failed:', err);
        }
      };
      this._docPillMouseDown = docMouseDown;
      this._docPillClick = docClick;
      document.addEventListener('mousedown', docMouseDown, true);
      document.addEventListener('click', docClick, true);
    }

    // Tier 2 đã bỏ — chỉ dùng document handler (Tier 1) để tránh double-fire khiến
    // dropdown bị tạo 2 lần liên tiếp + outside handler stale đóng nhầm dropdown mới.
    // Document capture đã catch click trước khi Drawflow consume → reliable.
  }

  /**
   * Inject 1 gear icon ở bottom-right corner cho mỗi node card (idempotent).
   * Chạy sau mỗi render để đảm bảo tất cả node types đều có gear consistent UX.
   */
  _ensureNodeCornerGears() {
    if (!this.overlay) return;
    const nodeRoots = this.overlay.querySelectorAll('.drawflow-node .df-node');
    const title = window.I18n?.t('node.settings') || 'Cài đặt';
    const gearSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    nodeRoots.forEach((nodeEl) => {
      if (nodeEl.querySelector('.df-node-corner-gear')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'df-node-corner-gear';
      btn.setAttribute('data-action', 'settings-node');
      // Custom CSS tooltip via ::after pseudo-element + native title fallback (a11y)
      btn.setAttribute('data-tooltip', title);
      btn.title = title;
      btn.innerHTML = gearSVG;
      // UI 2026-05-27: gắn gear vào cuối settings-bar (bên phải hàng pills) nếu có; else corner node.
      const bar = nodeEl.querySelector('.df-node-settings-bar');
      (bar || nodeEl).appendChild(btn);
    });
  }


  _hideInlineSettingDropdown() {
    if (this._inlineDropdown) {
      this._inlineDropdown.remove();
      this._inlineDropdown = null;
    }
  }

  /**
   * Phase WK-1.2 enhancement: Bind click trên empty Drawflow native ports → mở node picker
   * với filter theo port type tương thích. Auto-connect sau khi user chọn node.
   */
  _bindEmptyPortClicks() {
    const container = this.overlay?.querySelector('#diagramContainer');
    if (!container || container._wfEmptyPortBound) return;
    container._wfEmptyPortBound = true;

    // Bug 2 fix: dùng mousedown thay vì click vì Drawflow drag bind mousedown.
    // Nếu không có drag motion → cancel tại mouseup → trigger picker.
    let pressedPortEl = null;
    let pressedAt = null;
    let pressedX = 0, pressedY = 0;

    // Helper: trigger picker từ empty port element.
    // Tách reusable để dùng cho cả mouseup pattern + click fallback.
    const triggerPicker = (portEl, container) => {
      const side = portEl.getAttribute('data-port-side') || (portEl.classList.contains('input') ? 'in' : 'out');
      const portType = portEl.getAttribute('data-port-type');
      const portName = portEl.getAttribute('data-port-name');
      const portLabel = portEl.getAttribute('data-port-label') || portName;

      const nodeEl = portEl.closest('.drawflow-node');
      const drawflowId = nodeEl?.id?.replace('node-', '') || null;
      const classNames = portEl.className.split(/\s+/);
      const portClass = classNames.find(c => /^(input|output)_\d+$/.test(c));
      const portIndex = portClass ? parseInt(portClass.split('_')[1], 10) : 1;
      if (!drawflowId || !portType) return false;

      const rect = portEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const offsetX = side === 'in' ? -280 : 30;
      const posX = rect.left - containerRect.left + offsetX;
      const posY = rect.top - containerRect.top;

      this._showNodePicker(posX, posY, null, {
        side, portType, portName, portLabel, portIndex,
        sourceNodeDrawflowId: drawflowId,
      });
      return true;
    };

    container.addEventListener('mousedown', (e) => {
      const portEl = e.target.closest('.drawflow .input[data-port-type], .drawflow .output[data-port-type]');
      if (!portEl) {
        pressedPortEl = null;
        return;
      }
      // Check empty trực tiếp từ Drawflow node data (không phụ thuộc data-port-empty attribute)
      if (this._isPortEmpty(portEl) === false) {
        pressedPortEl = null;
        return; // Port có connection → để Drawflow xử lý drag
      }
      pressedPortEl = portEl;
      pressedAt = Date.now();
      pressedX = e.clientX;
      pressedY = e.clientY;
    }, true);

    container.addEventListener('mouseup', (e) => {
      if (!pressedPortEl) return;
      const dx = Math.abs(e.clientX - pressedX);
      const dy = Math.abs(e.clientY - pressedY);
      const dt = Date.now() - pressedAt;
      const portEl = pressedPortEl;
      pressedPortEl = null;
      // Drag detected (>8px movement) → để Drawflow xử lý connection
      // Threshold 8px để tránh false positive khi user click thường có jitter pixel
      if (dx > 8 || dy > 8) return;
      if (dt > 500) return; // long press không phải click

      // Bug fix (port click vs Drawflow drag): Khi user mousedown trên empty OUTPUT port,
      // Drawflow đã start `drawConnection` (vẽ ghost link từ port). Giờ mouseup không có movement
      // → cần cancel ghost link để picker hiển thị độc lập, tránh user thấy 2 UI cùng lúc.
      const editor = this.diagramCanvas?.editor;
      if (editor?.connection && editor.connection_ele) {
        try { editor.connection_ele.remove(); } catch (er) { globalThis.SEOSONA_swallow?.('WorkflowEditor#triggerPicker', er); }
        editor.connection_ele = null;
        editor.connection = false;
        editor.ele_selected = null;
      }

      const ok = triggerPicker(portEl, container);
      if (ok) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    // Fallback: click event (bubble phase). Bắt trường hợp mouseup capture missed
    // (vd Drawflow stop propagation trước capture, hoặc port DOM bị re-render giữa down/up).
    container.addEventListener('click', (e) => {
      // Skip nếu mousedown handler đã trigger (pressedPortEl đã clear)
      const portEl = e.target.closest('.drawflow .input[data-port-type], .drawflow .output[data-port-type]');
      if (!portEl) return;
      if (!this._isPortEmpty(portEl)) return;
      // Skip nếu picker vừa mới được mở (trong 100ms qua) — tránh open 2 lần
      if (this._lastPickerOpenAt && Date.now() - this._lastPickerOpenAt < 200) return;
      const editor = this.diagramCanvas?.editor;
      if (editor?.connection && editor.connection_ele) {
        try { editor.connection_ele.remove(); } catch (er) { globalThis.SEOSONA_swallow?.('WorkflowEditor#triggerPicker', er); }
        editor.connection_ele = null;
        editor.connection = false;
        editor.ele_selected = null;
      }
      const ok = triggerPicker(portEl, container);
      if (ok) {
        this._lastPickerOpenAt = Date.now();
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
  }

  /**
   * Phase enhancement: check port có connection không qua Drawflow node data.
   *
   * CRITICAL FIX: Drawflow `removeNodeId(B)` chỉ xóa SVG path + entry of B trong data,
   * KHÔNG cleanup connection refs trong `inputs/outputs[port].connections` của peer nodes.
   * → A.outputs.output_1.connections vẫn chứa dead ref tới B → port hiển thị "có link" nhưng
   * thực tế B đã không tồn tại → picker không mở khi user click.
   *
   * Filter dead refs (target node không còn trong editor) trước khi check empty.
   */
  _isPortEmpty(portEl) {
    if (!portEl) return false;
    const editor = this.diagramCanvas?.editor;
    const nodeEl = portEl.closest('.drawflow-node');
    const drawflowId = nodeEl?.id?.replace('node-', '');
    if (!editor || !drawflowId) return true;
    const node = editor.getNodeFromId(drawflowId);
    if (!node) return true;
    const classNames = portEl.className.split(/\s+/);
    const portClass = classNames.find(c => /^(input|output)_\d+$/.test(c));
    if (!portClass) return true;
    const isInput = portEl.classList.contains('input');
    const portData = isInput ? node.inputs?.[portClass] : node.outputs?.[portClass];
    const rawConns = portData?.connections || [];
    // Filter dead refs: connection trỏ tới node không tồn tại
    const liveConns = rawConns.filter(c => {
      const targetId = c.node;
      if (!targetId) return false;
      try {
        const targetNode = editor.getNodeFromId(targetId);
        return !!targetNode;
      } catch (e) {
        return false;
      }
    });
    return liveConns.length === 0;
  }

  /**
   * Cleanup dead connection refs trong inputs/outputs của ALL remaining nodes
   * sau khi 1 node bị xóa.
   *
   * Drawflow `removeNodeId(B)` chỉ xóa SVG paths + entry of B, KHÔNG xóa references
   * trong `inputs[input_X].connections` / `outputs[output_X].connections` của peer nodes.
   * → A.outputs.output_1.connections vẫn = [{node: B, output: 'input_1'}] dù B không tồn tại.
   *
   * Pass 1 lần qua all nodes, filter ra connections trỏ tới deletedNodeId.
   * Idempotent + safe để gọi nhiều lần.
   */
  _cleanupDeadConnectionRefs(deletedNodeId) {
    const editor = this.diagramCanvas?.editor;
    if (!editor || !deletedNodeId) return;
    const data = editor.drawflow?.drawflow?.Home?.data;
    if (!data) return;
    const targetId = String(deletedNodeId);
    for (const [_id, node] of Object.entries(data)) {
      // Outputs (point tới input của other nodes)
      const outputs = node.outputs || {};
      for (const port of Object.values(outputs)) {
        if (Array.isArray(port.connections)) {
          port.connections = port.connections.filter(c => String(c.node) !== targetId);
        }
      }
      // Inputs (point từ output của other nodes)
      const inputs = node.inputs || {};
      for (const port of Object.values(inputs)) {
        if (Array.isArray(port.connections)) {
          port.connections = port.connections.filter(c => String(c.node) !== targetId);
        }
      }
    }
  }

  /**
   * Phase WK-1.2 enhancement: Update data-port-empty cho mỗi port theo connection state.
   * Gọi sau load + connection created/removed.
   */
  _updatePortEmptyState() {
    const editor = this.diagramCanvas?.editor;
    if (!editor) return;
    try {
      const data = editor.export();
      const nodes = data?.drawflow?.Home?.data || {};
      for (const [drawflowId, nodeInfo] of Object.entries(nodes)) {
        const inputs = nodeInfo.inputs || {};
        const outputs = nodeInfo.outputs || {};
        for (const [inputClass, inputData] of Object.entries(inputs)) {
          const portEl = document.querySelector(`#node-${drawflowId} .input.${inputClass}[data-port-type]`);
          if (portEl) {
            const isEmpty = !(inputData.connections || []).length;
            portEl.setAttribute('data-port-empty', isEmpty ? 'true' : 'false');
          }
        }
        for (const [outputClass, outputData] of Object.entries(outputs)) {
          const portEl = document.querySelector(`#node-${drawflowId} .output.${outputClass}[data-port-type]`);
          if (portEl) {
            const isEmpty = !(outputData.connections || []).length;
            portEl.setAttribute('data-port-empty', isEmpty ? 'true' : 'false');
          }
        }
      }
    } catch (e) { /* swallow */ }
  }


  /**
   * Tạo node mới từ NodePicker.
   *
   * Auto-connect được xử lý qua portContext flow (`_autoConnectFromPortContext`) —
   * KHÔNG còn fallback `addConnection(sourceId, newId, 'output_1', 'input_1')` cứng
   * (cũ: ghép sai port khi source có nhiều outputs hoặc port type khác).
   *
   * sourceNodeId param giữ lại cho backward-compat (legacy callers) — log warning nếu truyền
   * vì giờ nên dùng portContext + _autoConnectFromPortContext.
   */

  // === Node Form Panel Resize ===

  _bindNodeFormResize() {
    const handle = this.overlay?.querySelector('#nodeFormResizeHandle');
    const panel = this.overlay?.querySelector('#nodeFormPanel');
    if (!handle || !panel) return;

    let startX = 0;
    let startWidth = 0;
    let isDragging = false;

    const onMouseDown = (e) => {
      e.preventDefault();
      isDragging = true;
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      // Panel ở bên phải, kéo sang trái = tăng width
      const delta = startX - e.clientX;
      let newWidth = startWidth + delta;
      // Clamp trong min/max
      newWidth = Math.max(260, Math.min(500, newWidth));
      panel.style.width = newWidth + 'px';
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Save width to storage for persistence
      const currentWidth = panel.offsetWidth;
      chrome.storage?.local?.set({ nodeFormPanelWidth: currentWidth });
    };

    handle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Store refs for cleanup
    this._resizeHandlers = { handle, onMouseDown, onMouseMove, onMouseUp };

    // Restore saved width
    chrome.storage?.local?.get(['nodeFormPanelWidth'], (res) => {
      if (res.nodeFormPanelWidth && panel) {
        const savedWidth = Math.max(260, Math.min(500, res.nodeFormPanelWidth));
        panel.style.width = savedWidth + 'px';
      }
    });
  }

  _unbindNodeFormResize() {
    if (this._resizeHandlers) {
      const { handle, onMouseDown, onMouseMove, onMouseUp } = this._resizeHandlers;
      handle?.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      this._resizeHandlers = null;
    }
  }


  /**
   * Ctrl+S save workflow với debounce + concurrency guard.
   * - Trailing debounce 800ms: spam Ctrl+S liên tiếp chỉ trigger 1 save sau lần cuối
   * - Concurrency lock: nếu save đang chạy, skip + retry sau khi xong (set flag pending)
   * - Show toast feedback sau save success/fail
   */
  _triggerSaveWorkflowDebounced() {
    // Concurrency: nếu save đang chạy, mark pending → retry sau khi xong
    if (this._isSaving) {
      this._ctrlSPending = true;
      return;
    }
    // Trailing debounce: spam chỉ trigger save 800ms sau lần cuối
    if (this._ctrlSDebounceTimer) clearTimeout(this._ctrlSDebounceTimer);
    this._ctrlSDebounceTimer = setTimeout(async () => {
      this._ctrlSDebounceTimer = null;
      try {
        let saved = false;
        if (this.isTemplateMode) {
          if (this.templateId) await this._updateTemplate?.();
          else await this._createTemplate?.();
          saved = true; // template path: assume saved (helpers handle errors)
        } else {
          saved = await this.saveWorkflow();
        }
        if (saved) {
          window.showNotification?.(
            window.I18n?.t?.('workflow.saveSuccess') || 'Đã lưu workflow',
            'success', 1500
          );
        }
      } catch (err) {
        console.warn('[WorkflowEditor] Ctrl+S save failed:', err?.message);
      } finally {
        // Process pending save nếu user nhấn Ctrl+S thêm trong khi save chạy
        if (this._ctrlSPending) {
          this._ctrlSPending = false;
          setTimeout(() => this._triggerSaveWorkflowDebounced(), 100);
        }
      }
    }, 800);
  }

  _unbindKeyboardShortcuts() {
    // Clear pending Ctrl+S debounce timer khi editor close
    if (this._ctrlSDebounceTimer) {
      clearTimeout(this._ctrlSDebounceTimer);
      this._ctrlSDebounceTimer = null;
    }
    this._ctrlSPending = false;
    if (this._keyHandler) {
      // Bug fix 2026-06-03: remove phải match capture=true với add (line ~17568)
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
  }

  _showWorkflowSettings() {
    if (!this.workflow) return;

    // EWT-6: Trong template mode, hiển thị Template Settings Modal thay vì Workflow Settings
    if (this.isTemplateMode) {
      this._showTemplateSettingsModal();
      return;
    }

    const settings = this.workflow.settings_json || this.workflow.settings || {};
    const dialog = document.createElement('div');
    dialog.className = 'seosonaflow-wf-settings-overlay';
    dialog.innerHTML = `
      <div class="seosonaflow-wf-settings-dialog">
        <div class="seosonaflow-wf-settings-header">
          <h3>${window.I18n?.t('workflow.settings') || 'Workflow Settings'}</h3>
          <button class="seosonaflow-wf-settings-close" title="${window.I18n?.t('common.close') || 'Close'}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="seosonaflow-wf-settings-body">
          <div class="seosonaflow-wf-settings-group">
            <label>${window.I18n?.t('workflow.workflowName') || 'Tên workflow'}</label>
            <input type="text" id="wfSettingsName" value="${this.escapeAttr(this.workflow.wf_name || '')}" placeholder="${window.I18n?.t('workflow.workflowName') || 'Tên workflow'}">
          </div>
          <div class="seosonaflow-wf-settings-group">
            <label>${window.I18n?.t('workflow.description') || 'Mô tả'}</label>
            <textarea id="wfSettingsDesc" rows="2" placeholder="${window.I18n?.t('workflow.shortDescription') || 'Mô tả ngắn'}">${this.escapeHtml(this.workflow.description || '')}</textarea>
          </div>
          <div class="seosonaflow-wf-settings-divider">${window.I18n?.t('workflow.execution') || 'Thực thi'}</div>
          <div class="seosonaflow-wf-settings-group seosonaflow-wf-settings-row">
            <label>${window.I18n?.t('workflow.delayBetweenNodes') || 'Chờ giữa các node'}</label>
            <div class="seosonaflow-wf-settings-input-group">
              <input type="number" id="wfSettingsDelay" value="${settings.delay_between_nodes || 3}" min="1" max="60"> <span>${window.I18n?.t('workflow.seconds') || 'giây'}</span>
            </div>
          </div>
          <div class="seosonaflow-wf-settings-group seosonaflow-wf-settings-row">
            <label>${window.I18n?.t('workflow.retryOnError') || 'Thử lại khi lỗi'}</label>
            <div class="seosonaflow-wf-settings-input-group">
              <input type="number" id="wfSettingsRetry" value="${settings.max_retries || 2}" min="0" max="5"> <span>${window.I18n?.t('workflow.times') || 'lần'}</span>
            </div>
          </div>
          <div class="seosonaflow-wf-settings-group seosonaflow-wf-settings-row">
            <label>${window.I18n?.t('workflow.timeoutPerNode') || 'Timeout mỗi node'}</label>
            <div class="seosonaflow-wf-settings-input-group">
              <input type="number" id="wfSettingsTimeout" value="${settings.timeout || 180}" min="30" max="600"> <span>${window.I18n?.t('workflow.seconds') || 'giây'}</span>
            </div>
          </div>
          <div class="seosonaflow-wf-settings-group">
            <label class="toolbar-toggle" for="wfSettingsParallel">
              <input type="checkbox" id="wfSettingsParallel" ${settings.parallel_execution ? 'checked' : ''} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">${window.I18n?.t('workflow.parallelExecution') || 'Chạy song song nodes cùng level'}</span>
            </label>
          </div>
          <div class="seosonaflow-wf-settings-group">
            <label class="toolbar-toggle" for="wfSettingsStopOnError">
              <input type="checkbox" id="wfSettingsStopOnError" ${settings.stop_on_error ? 'checked' : ''} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">${window.I18n?.t('workflow.stopOnError') || 'Dừng khi lỗi'}</span>
            </label>
          </div>
        </div>
        <div class="seosonaflow-wf-settings-footer">
          <button class="btn btn-secondary" id="wfSettingsCancel">${window.I18n?.t('common.cancel') || 'Hủy'}</button>
          <button class="btn btn-primary" id="wfSettingsSave">${window.I18n?.t('workflow.saveSettings') || 'Lưu cài đặt'}</button>
        </div>
      </div>
    `;

    this.overlay.appendChild(dialog);

    // Check retry_on_fail feature - disable input nếu không có quyền
    chrome.storage.local.get('af_entitlements', (result) => {
      const entitlements = result.af_entitlements?.entitlements || {};
      const retryFeature = entitlements.retry_on_fail;
      const canUseRetry = retryFeature?.value === '1' || retryFeature?.value === 1;
      const retryInput = dialog.querySelector('#wfSettingsRetry');
      if (retryInput && !canUseRetry) {
        retryInput.disabled = true;
        retryInput.value = '0';
        retryInput.title = window.I18n?.t('workflow.retryUpgradeRequired') || 'Nâng cấp tài khoản để sử dụng tính năng thử lại';
        const group = retryInput.closest('.seosonaflow-wf-settings-group');
        group?.classList.add('feature-disabled');
        // Add crown icon inside label (inline with text, stays next to label in flex row)
        if (group && !group.querySelector('.premium-crown')) {
          const crown = document.createElement('span');
          crown.className = 'premium-crown';
          crown.innerHTML = window.featureGate?.renderCrownHTML?.('retry_on_fail')
            || '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"></path></svg> Premium';
          const lbl = window.featureGate?.getCrownLabel?.('retry_on_fail');
          if (lbl) crown.title = lbl;
          const label = group.querySelector('label');
          if (label) {
            label.appendChild(crown);
          } else {
            group.appendChild(crown);
          }
        }
      }
    });

    dialog.querySelector('.seosonaflow-wf-settings-close')?.addEventListener('click', () => dialog.remove());
    dialog.querySelector('#wfSettingsCancel')?.addEventListener('click', () => dialog.remove());
    dialog.querySelector('#wfSettingsSave')?.addEventListener('click', async () => {
      this.workflow.wf_name = dialog.querySelector('#wfSettingsName')?.value || this.workflow.wf_name;
      this.workflow.description = dialog.querySelector('#wfSettingsDesc')?.value || '';
      this.workflow.settings_json = {
        delay_between_nodes: parseInt(dialog.querySelector('#wfSettingsDelay')?.value) || 3,
        max_retries: parseInt(dialog.querySelector('#wfSettingsRetry')?.value) || 2,
        timeout: parseInt(dialog.querySelector('#wfSettingsTimeout')?.value) || 180,
        stop_on_error: dialog.querySelector('#wfSettingsStopOnError')?.checked || false,
        parallel_execution: dialog.querySelector('#wfSettingsParallel')?.checked || false
      };
      // Update header name input
      const nameInput = this.overlay?.querySelector('#workflowName');
      if (nameInput) nameInput.value = this.workflow.wf_name;
      dialog.remove();
      // Save workflow to storage (including settings changes)
      await this.saveWorkflow();
    });

    // KHÔNG đóng khi click backdrop (tránh mất chỉnh sửa settings) — chỉ đóng qua nút Close/Cancel.
  }

  /**
   * EWT-6: Hiển thị Template Settings Modal
   * Cho phép chỉnh sửa metadata của template: name, description, thumbnail, category, premium, featured
   */
  async _showTemplateSettingsModal() {
    if (!this.templateData) {
      this.templateData = {
        name: this.workflow?.wf_name || '',
        description: this.workflow?.description || '',
        category_id: null,
        thumbnail_url: null,
        video_url: null,
        is_premium: false,
        is_featured: false,
        is_published: true, // Default to published for new templates
      };
    }

    const t = (key, fallback) => window.I18n?.t(key) || fallback;

    // Fetch categories từ API — BỎ QUA ở local mode (không có backend → tránh "Untrusted sender").
    let categories = [];
    if (self.SEOSONA_LOCAL_MODE === false) {
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'apiRequest',
            method: 'GET',
            endpoint: 'workflow-templates/categories'
          }, (resp) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (resp?.success && resp?.data) {
              resolve(resp.data);
            } else {
              reject(new Error(resp?.error?.message || 'Không lấy được danh mục'));
            }
          });
        });
        categories = response.categories || response || [];
      } catch (err) {
        console.warn('[WorkflowEditor] Lỗi fetch categories:', err.message);
      }
    }

    // Build category options
    const categoryOptions = categories.map(cat =>
      `<option value="${cat.id}" ${this.templateData.category_id == cat.id ? 'selected' : ''}>${this.escapeHtml(cat.name)}</option>`
    ).join('');

    const dialog = document.createElement('div');
    dialog.className = 'seosonaflow-wf-settings-overlay template-settings-modal';
    dialog.innerHTML = `
      <div class="seosonaflow-wf-settings-dialog">
        <div class="seosonaflow-wf-settings-header">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; vertical-align: -3px;">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            ${t('workflow.templateSettings', 'Cài đặt Template')}
          </h3>
          <button class="seosonaflow-wf-settings-close" title="${t('common.close', 'Đóng')}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="seosonaflow-wf-settings-body">
          <!-- Tên template -->
          <div class="seosonaflow-wf-settings-group">
            <label for="tplSettingsName">${t('workflow.saveTemplate.nameLabel', 'Tên Template')} <span class="required">*</span></label>
            <input type="text" id="tplSettingsName" value="${this.escapeAttr(this.templateData.name || '')}" placeholder="${t('workflow.saveTemplate.namePlaceholder', 'Nhập tên template...')}" maxlength="100" />
          </div>

          <!-- Mô tả -->
          <div class="seosonaflow-wf-settings-group">
            <label for="tplSettingsDesc">${t('workflow.saveTemplate.descriptionLabel', 'Mô tả')}</label>
            <textarea id="tplSettingsDesc" rows="3" placeholder="${t('workflow.saveTemplate.descriptionPlaceholder', 'Mô tả ngắn về template này...')}" maxlength="500">${this.escapeHtml(this.templateData.description || '')}</textarea>
          </div>

          <!-- Danh mục -->
          <div class="seosonaflow-wf-settings-group">
            <label for="tplSettingsCategory">${t('workflow.saveTemplate.categoryLabel', 'Danh mục')}</label>
            <select id="tplSettingsCategory">
              <option value="">${t('workflow.saveTemplate.selectCategory', '-- Chọn danh mục --')}</option>
              ${categoryOptions}
            </select>
          </div>

          <!-- Thumbnail -->
          <div class="seosonaflow-wf-settings-group">
            <label>${t('workflow.saveTemplate.thumbnailLabel', 'Ảnh Thumbnail')}</label>
            <div class="save-template-thumbnail-picker" id="tplSettingsThumbnailPicker">
              <div class="thumbnail-preview ${this.templateData.thumbnail_url ? 'has-image' : ''}" id="tplSettingsThumbnailPreview">
                ${this.templateData.thumbnail_url
                  ? `<img src="${this.escapeAttr(this.templateData.thumbnail_url)}" alt="Thumbnail" />`
                  : `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span>${t('workflow.saveTemplate.clickToSelect', 'Click để chọn ảnh')}</span>`
                }
              </div>
              <button type="button" class="thumbnail-remove ${this.templateData.thumbnail_url ? '' : 'hidden'}" id="tplSettingsThumbnailRemove" title="${t('workflow.saveTemplate.removeThumbnail', 'Xóa ảnh')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <span class="seosonaflow-wf-settings-hint">${t('workflow.saveTemplate.thumbnailSizeHint', 'Khuyến nghị: 640×360px hoặc 1280×720px (tỉ lệ 16:9)')}</span>
          </div>

          <div class="seosonaflow-wf-settings-divider">${t('workflow.templateOptions', 'Tùy chọn')}</div>

          <!-- Premium toggle -->
          <div class="seosonaflow-wf-settings-group">
            <label class="toolbar-toggle" for="tplSettingsPremium">
              <input type="checkbox" id="tplSettingsPremium" ${this.templateData.is_premium ? 'checked' : ''} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 4px; vertical-align: -2px;">
                  <path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"/>
                </svg>
                ${t('workflow.saveTemplate.premiumTemplate', 'Premium Template')}
              </span>
            </label>
          </div>

          <!-- Featured toggle -->
          <div class="seosonaflow-wf-settings-group">
            <label class="toolbar-toggle" for="tplSettingsFeatured">
              <input type="checkbox" id="tplSettingsFeatured" ${this.templateData.is_featured ? 'checked' : ''} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: -2px;">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
                ${t('workflow.saveTemplate.featured', 'Featured (Nổi bật)')}
              </span>
            </label>
          </div>

          <!-- Published toggle -->
          <div class="seosonaflow-wf-settings-group">
            <label class="toolbar-toggle" for="tplSettingsPublished">
              <input type="checkbox" id="tplSettingsPublished" ${this.templateData.is_published ? 'checked' : ''} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: -2px;">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                ${t('workflow.templatePublished', 'Xuất bản (Công khai)')}
              </span>
            </label>
          </div>

          <!-- Error display -->
          <div class="save-template-error hidden" id="tplSettingsError">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span id="tplSettingsErrorText"></span>
          </div>
        </div>
        <div class="seosonaflow-wf-settings-footer">
          <button class="btn btn-secondary" id="tplSettingsCancel">${t('common.cancel', 'Hủy')}</button>
          <button class="btn btn-primary" id="tplSettingsSave">${t('workflow.saveSettings', 'Lưu cài đặt')}</button>
        </div>
      </div>
    `;

    this.overlay.appendChild(dialog);

    // Store selected thumbnail URL
    let selectedThumbnail = this.templateData.thumbnail_url || null;

    // Close handlers
    dialog.querySelector('.seosonaflow-wf-settings-close')?.addEventListener('click', () => dialog.remove());
    dialog.querySelector('#tplSettingsCancel')?.addEventListener('click', () => dialog.remove());

    // Thumbnail picker
    const thumbnailPicker = dialog.querySelector('#tplSettingsThumbnailPicker');
    const thumbnailPreview = dialog.querySelector('#tplSettingsThumbnailPreview');
    const thumbnailRemove = dialog.querySelector('#tplSettingsThumbnailRemove');

    thumbnailPicker?.addEventListener('click', (e) => {
      if (e.target.closest('.thumbnail-remove')) return;

      if (window.WorkflowMediaModal) {
        window.WorkflowMediaModal.show({
          type: 'thumbnail',
          multiple: false,
          preselected: selectedThumbnail ? [selectedThumbnail] : [],
          onSelect: (url) => {
            selectedThumbnail = url;
            thumbnailPreview.innerHTML = `<img src="${this.escapeAttr(url)}" alt="Thumbnail" />`;
            thumbnailPreview.classList.add('has-image');
            thumbnailRemove?.classList.remove('hidden');
          }
        });
      } else {
        console.warn('[WorkflowEditor] WorkflowMediaModal chưa sẵn sàng');
      }
    });

    thumbnailRemove?.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedThumbnail = null;
      const clickToSelectText = t('workflow.saveTemplate.clickToSelect', 'Click để chọn ảnh');
      thumbnailPreview.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <span>${clickToSelectText}</span>
      `;
      thumbnailPreview.classList.remove('has-image');
      thumbnailRemove?.classList.add('hidden');
    });

    // Save handler
    dialog.querySelector('#tplSettingsSave')?.addEventListener('click', async () => {
      const nameInput = dialog.querySelector('#tplSettingsName');
      const name = nameInput?.value?.trim();

      // Validate
      if (!name) {
        const errorEl = dialog.querySelector('#tplSettingsError');
        const errorText = dialog.querySelector('#tplSettingsErrorText');
        if (errorEl && errorText) {
          errorText.textContent = t('workflow.saveTemplate.nameRequired', 'Vui lòng nhập tên template');
          errorEl.classList.remove('hidden');
          setTimeout(() => errorEl.classList.add('hidden'), 5000);
        }
        nameInput?.focus();
        return;
      }

      // Update templateData
      this.templateData.name = name;
      this.templateData.description = dialog.querySelector('#tplSettingsDesc')?.value?.trim() || '';
      const categoryVal = dialog.querySelector('#tplSettingsCategory')?.value;
      this.templateData.category_id = categoryVal ? parseInt(categoryVal, 10) : null;
      this.templateData.thumbnail_url = selectedThumbnail;
      console.log('[WorkflowEditor] Template settings saved - thumbnail_url:', selectedThumbnail);
      this.templateData.is_premium = dialog.querySelector('#tplSettingsPremium')?.checked || false;
      this.templateData.is_featured = dialog.querySelector('#tplSettingsFeatured')?.checked || false;
      this.templateData.is_published = dialog.querySelector('#tplSettingsPublished')?.checked || false;

      // Update workflow name to sync with template name
      this.workflow.wf_name = name;
      this.workflow.description = this.templateData.description;

      // Update header name input
      const headerNameInput = this.overlay?.querySelector('#workflowName');
      if (headerNameInput) headerNameInput.value = name;

      this._hasUnsavedChanges = true;
      dialog.remove();

      // Notification cho biết cần nhấn Save để lưu vào database
      window.showNotification?.(t('workflow.templateSettingsChanged', 'Đã cập nhật. Nhấn Save để lưu vào database.'), 'info');
    });

    // KHÔNG đóng khi click backdrop (tránh mất chỉnh sửa settings) — chỉ đóng qua nút Close/Cancel.

    // Focus name input
    requestAnimationFrame(() => {
      dialog.querySelector('#tplSettingsName')?.focus();
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  escapeAttr(text) {
    return (text || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Quote-safe media URL for use inside src="..."/background-image:url(...).
   * Validates scheme (http/https/data:image/blob) and drops anything else,
   * then escapes quotes. Data fed by imported JSON / server templates / Flow
   * DOM scraping must pass through here before being interpolated into markup.
   */
  _safeMediaSrc(url) {
    const s = String(url || '');
    if (!/^(https?:|data:image\/|blob:)/i.test(s)) return '';
    return this.escapeAttr(s);
  }

  // ===========================================================================
  // Node naming: unique name generation
  // ===========================================================================

  /**
   * Generate unique node name with sequence number.
   * E.g., "Generate", "Generate 2", "Generate 3" based on existing nodes.
   */
  _generateUniqueNodeName(nodeType) {
    const baseName = NodeTemplates.getType(nodeType)?.name || nodeType;
    if (!this.diagramCanvas?.editor) return baseName;

    const exportData = this.diagramCanvas.editor.export();
    const homeData = exportData?.drawflow?.Home?.data || {};

    // Count nodes of same type
    let maxNum = 0;
    Object.values(homeData).forEach(nodeData => {
      if (nodeData.data?.node_type !== nodeType) return;
      const name = nodeData.data?.node_name || '';
      // Check if name matches "BaseName" or "BaseName N"
      if (name === baseName) {
        maxNum = Math.max(maxNum, 1);
      } else {
        const match = name.match(new RegExp(`^${this._escapeRegex(baseName)}\\s+(\\d+)$`));
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      }
    });

    // First node = "BaseName", subsequent = "BaseName 2", "BaseName 3", ...
    return maxNum === 0 ? baseName : `${baseName} ${maxNum + 1}`;
  }

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ===========================================================================
  // Phase 1 — Node Reference System: Slug helper methods
  // ===========================================================================

  /**
   * Generate slug from node name (Vietnamese-safe normalization).
   * @param {string} name - Node name
   * @returns {string} Normalized slug (lowercase, alphanumeric + underscore)
   */
  _normalizeToSlug(name) {
    if (!name) return 'node';
    let slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
    slug = slug.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    slug = slug.replace(/^[0-9_]+/, '');
    if (!slug) return 'node';
    return slug.substring(0, 25);
  }

  /**
   * Get all existing slugs in current workflow.
   * @param {string|null} excludeNodeId - Exclude this node's slug (for edit validation)
   * @returns {string[]} Array of existing slugs
   */
  _getExistingSlugs(excludeNodeId = null) {
    if (!this.diagramCanvas?.editor) return [];
    const exportData = this.diagramCanvas.editor.export();
    const homeData = exportData?.drawflow?.Home?.data || {};
    const slugs = [];
    Object.entries(homeData).forEach(([id, nodeData]) => {
      if (excludeNodeId && String(id) === String(excludeNodeId)) return;
      const slug = nodeData.data?.slug;
      if (slug) slugs.push(slug);
    });
    return slugs;
  }

  /**
   * Ensure slug is unique within workflow (append _1, _2, ... if needed).
   * @param {string} baseSlug - Base slug to check
   * @param {string[]} existingSlugs - Array of existing slugs
   * @returns {string} Unique slug
   */
  _ensureUniqueSlug(baseSlug, existingSlugs) {
    if (!existingSlugs.includes(baseSlug)) return baseSlug;
    // Cap (root + "_N") ≤ SLUG_MAX_LENGTH để match backend regex /^[a-z][a-z0-9_]{0,29}$/.
    const MAX = WorkflowEditor.SLUG_MAX_LENGTH;
    let counter = 1;
    let candidate = WorkflowEditor._buildSlugCandidate(baseSlug, counter, MAX);
    while (existingSlugs.includes(candidate)) {
      counter++;
      candidate = WorkflowEditor._buildSlugCandidate(baseSlug, counter, MAX);
    }
    return candidate;
  }

  static _buildSlugCandidate(root, counter, maxLen) {
    const suffix = `_${counter}`;
    const maxRootLen = maxLen - suffix.length;
    if (maxRootLen < 1) return `node${suffix}`.substring(0, maxLen);
    let truncated = root.length > maxRootLen ? root.substring(0, maxRootLen) : root;
    truncated = truncated.replace(/_+$/, '');
    if (!truncated) truncated = 'node';
    return truncated + suffix;
  }

  /**
   * Generate a unique slug for a new node.
   * @param {string} name - Node name
   * @param {string|null} excludeNodeId - Exclude this node when checking uniqueness
   * @returns {string} Unique slug
   */
  _generateSlug(name, excludeNodeId = null) {
    let slug = this._normalizeToSlug(name);
    if (WorkflowEditor.RESERVED_SLUGS.includes(slug)) {
      slug = 'node_' + slug;
    }
    const existingSlugs = this._getExistingSlugs(excludeNodeId);
    return this._ensureUniqueSlug(slug, existingSlugs);
  }

  /**
   * Auto-generate slugs for mentionable nodes that don't have one.
   * Called after loadWorkflow to migrate old nodes created before slug system.
   */
  _ensureSlugsForMentionableNodes() {
    const editor = this.diagramCanvas?.editor;
    if (!editor) return;

    const moduleData = editor.drawflow?.drawflow?.Home?.data;
    if (!moduleData) return;

    let updated = false;
    for (const [drawflowId, node] of Object.entries(moduleData)) {
      if (!node?.data) continue;
      const nodeType = node.data.node_type || node.class;

      // Only process mentionable nodes without slugs
      if (!this._isMentionableNodeType(nodeType)) continue;
      if (node.data.slug) continue; // Already has slug

      // Generate slug from node name
      const nodeName = node.data.node_name || nodeType;
      const newSlug = this._generateSlug(nodeName, drawflowId);

      // Update node data
      node.data.slug = newSlug;
      node.data.slug_auto = true;
      updated = true;
      console.log(`[WorkflowEditor] Auto-generated slug "${newSlug}" for node "${nodeName}" (${nodeType})`);
    }

    if (updated) {
      this._hasUnsavedChanges = true;
    }
  }

  /**
   * Validate slug format and uniqueness.
   * @param {string} slug - Slug to validate
   * @param {string|null} excludeNodeId - Exclude this node (for edit validation)
   * @returns {{valid: boolean, error: string|null}}
   */
  _validateSlug(slug, excludeNodeId = null) {
    if (!slug) return { valid: true, error: null };
    if (slug.length > WorkflowEditor.SLUG_MAX_LENGTH) {
      return { valid: false, error: window.I18n?.t('workflow.slugTooLong') || `Slug tối đa ${WorkflowEditor.SLUG_MAX_LENGTH} ký tự` };
    }
    if (!WorkflowEditor.SLUG_PATTERN.test(slug)) {
      return { valid: false, error: window.I18n?.t('workflow.slugInvalidFormat') || 'Slug chỉ chứa a-z, 0-9, _ và bắt đầu bằng chữ cái' };
    }
    if (WorkflowEditor.RESERVED_SLUGS.includes(slug)) {
      return { valid: false, error: window.I18n?.t('workflow.slugReserved') || `"${slug}" là từ khóa không thể dùng làm slug` };
    }
    const existingSlugs = this._getExistingSlugs(excludeNodeId);
    if (existingSlugs.includes(slug)) {
      return { valid: false, error: window.I18n?.t('workflow.slugDuplicate') || `Slug "${slug}" đã tồn tại trong workflow` };
    }
    return { valid: true, error: null };
  }

  /**
   * Check if a node type can have a slug (mentionable).
   * Phase 6: Reads from server config (workflow_node_types.config.ui.supports_slug)
   * @param {string} nodeType - Node type
   * @returns {boolean}
   */
  _isMentionableNodeType(nodeType) {
    const typeConfig = NodeTemplates.getType(nodeType);
    if (typeConfig?.ui?.supports_slug !== undefined) {
      return typeConfig.ui.supports_slug === true;
    }
    // Fallback for cold start
    return WorkflowEditor._FALLBACK_MENTIONABLE_TYPES.includes(nodeType);
  }

  // ========== PHASE 2 — NODE REFERENCE SYSTEM: @MENTION HELPERS ==========

  // Phase 6: Migrated to server config (workflow_node_types.config.ui.supports_mentions)
  // Fallback array for cold start before server config loads
  static _FALLBACK_CAN_USE_MENTIONS = ['generate', 'chatgpt', 'grok', 'prompt'];

  /**
   * Check if a node type can use @mentions in its prompt.
   * Phase 6: Reads from server config (workflow_node_types.config.ui.supports_mentions)
   * @param {string} nodeType - Node type
   * @returns {boolean}
   */
  _canUseMentions(nodeType) {
    const typeConfig = NodeTemplates.getType(nodeType);
    if (typeConfig?.ui?.supports_mentions !== undefined) {
      return typeConfig.ui.supports_mentions === true;
    }
    // Fallback for cold start
    return WorkflowEditor._FALLBACK_CAN_USE_MENTIONS.includes(nodeType);
  }

  /**
   * Parse @mentions từ prompt text.
   * @param {string} prompt - Prompt text với @mentions
   * @returns {string[]} Array of unique mentioned slugs
   */
  _parseMentions(prompt) {
    if (!prompt || typeof prompt !== 'string') return [];
    const mentionRegex = /@([a-z][a-z0-9_]{0,29})(?![a-z0-9@._-])/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(prompt)) !== null) {
      mentions.push(match[1]);
    }
    return [...new Set(mentions)];
  }

  /**
   * Auto-detect prompt_mode/ref_mode từ LOẠI mention — TÁCH RIÊNG, không gán chung 1 autoMode.
   * @text/@prompt/@text_extract → prompt_mode='mention' (substitute text).
   * @image/@generate/@chatgpt/@grok → ref_mode='mention' (lọc ref theo mention).
   * Bug cũ: gán chung → @text vô tình bật ref_mode='mention' → 3 node text không phải ảnh → images:0.
   * @param {string} promptText
   * @returns {{promptAuto: 'mention'|'all', refAuto: 'mention'|'all'}}
   */
  _autoDetectMentionModes(promptText) {
    const mentions = this._parseMentions(promptText);
    if (mentions.length === 0) return { promptAuto: 'all', refAuto: 'all' };
    const slugType = new Map();
    try {
      const moduleData = this.diagramCanvas?.editor?.drawflow?.drawflow?.Home?.data || {};
      for (const node of Object.values(moduleData)) {
        const s = node?.data?.slug;
        if (s) slugType.set(s, node.data.node_type || node.class);
      }
    } catch (_) { /* ignore */ }
    // Không lookup được node (context lạ) → fallback behavior cũ (cả 2 'mention') để không mất tính năng.
    if (slugType.size === 0) return { promptAuto: 'mention', refAuto: 'mention' };
    const TEXT_TYPES = ['text', 'prompt', 'text_extract', 'text_template', 'random_pick', 'prompt_sequence', 'variant_expand', 'loop']; // Fix audit #6: đồng bộ text-source
    const IMAGE_TYPES = ['image', 'generate', 'chatgpt', 'grok'];
    let hasText = false, hasImage = false;
    for (const slug of mentions) {
      const t = slugType.get(slug);
      if (TEXT_TYPES.includes(t)) hasText = true;
      else if (IMAGE_TYPES.includes(t)) hasImage = true;
    }
    return {
      promptAuto: hasText ? 'mention' : 'all',
      refAuto: hasImage ? 'mention' : 'all',
    };
  }

  /**
   * Get danh sách nodes có thể mention từ một node.
   * Dùng cho autocomplete dropdown.
   *
   * @param {string} currentNodeId - ID của node đang edit prompt
   * @returns {Array} Sorted list of mentionable nodes với metadata
   */
  _getAvailableMentionSlugs(currentNodeId) {
    const result = [];
    const editor = this.diagramCanvas?.editor;
    if (!editor) return result;

    const allNodes = [];
    const edgesList = [];

    try {
      const moduleData = editor.drawflow?.drawflow?.Home?.data;
      if (!moduleData) return result;

      for (const [drawflowId, node] of Object.entries(moduleData)) {
        if (!node?.data) continue;
        const idStr = String(drawflowId);
        allNodes.push({
          drawflowId: idStr,
          nodeId: node.data.node_id || idStr,
          nodeType: node.data.node_type || node.class,
          slug: node.data.slug,
          name: node.data.node_name || node.class,
          thumbnail: node.data.ref_thumbnails
            ? Object.values(node.data.ref_thumbnails)[0]
            : (node.data.result_thumbnails ? Object.values(node.data.result_thumbnails)[0] : null),
          outputs: node.outputs || {}
        });

        for (const [outputKey, outputData] of Object.entries(node.outputs || {})) {
          for (const conn of outputData.connections || []) {
            edgesList.push({
              source: idStr,
              target: String(conn.node)
            });
          }
        }
      }
    } catch (e) {
      console.warn('[WorkflowEditor] _getAvailableMentionSlugs error:', e.message);
      return result;
    }

    // Ensure currentNodeId is string for comparison
    // 2026-05-31: currentNodeId có thể là drawflowId (numeric) HOẶC node_id UUID tùy caller.
    // Edges store source/target as drawflowId. Nếu caller pass node_id UUID → resolve về drawflowId.
    let currentDrawflowId = String(currentNodeId);
    if (currentDrawflowId.startsWith('node_')) {
      // UUID passed — find drawflowId via node_id lookup
      const matchedNode = allNodes.find(n => n.nodeId === currentNodeId);
      if (matchedNode) {
        currentDrawflowId = matchedNode.drawflowId;
      } else {
        console.warn(`[Mention] currentNodeId="${currentNodeId}" không tìm thấy drawflowId → filter sẽ skip toàn bộ. Caller phải pass drawflowId.`);
      }
    }
    const connectedNodeIds = new Set();
    const traverseUpstream = (nodeId) => {
      const incomingEdges = edgesList.filter(e => e.target === nodeId);
      for (const edge of incomingEdges) {
        if (!connectedNodeIds.has(edge.source)) {
          connectedNodeIds.add(edge.source);
          traverseUpstream(edge.source);
        }
      }
    };
    traverseUpstream(currentDrawflowId);
    console.log(`[Mention] currentDrawflowId="${currentDrawflowId}" upstream connected: ${[...connectedNodeIds].join(',') || '(none)'} | total nodes: ${allNodes.length} | edges: ${edgesList.length}`);

    const imageNodeTypes = ['image', 'generate', 'chatgpt', 'grok'];
    // 2026-05-31: thêm text_extract — output text result mentionable downstream
    // (cùng pattern fix các nơi khác). Trước fix: autocomplete dropdown không hiện
    // text_extract slugs khi user gõ @ trong prompt downstream.
    const textNodeTypes = ['text', 'prompt', 'text_extract', 'text_template', 'random_pick', 'prompt_sequence', 'variant_expand', 'loop']; // Fix audit #6: đồng bộ @-mention slug

    for (const node of allNodes) {
      if (node.drawflowId === currentDrawflowId) continue;
      if (!node.slug) continue;
      // Only show upstream (connected) nodes - skip downstream and unconnected
      if (!connectedNodeIds.has(node.drawflowId)) continue;

      const isImageProducer = imageNodeTypes.includes(node.nodeType);
      const isTextProducer = textNodeTypes.includes(node.nodeType);
      if (!isImageProducer && !isTextProducer) continue;

      result.push({
        slug: node.slug,
        name: node.name || node.nodeType,
        nodeType: node.nodeType,
        drawflowId: node.drawflowId,
        nodeId: node.nodeId,
        connected: true, // Always true since we filter upstream only
        thumbnail: isImageProducer ? node.thumbnail : null,
        category: isImageProducer ? 'image' : 'text'
      });
    }

    // Sort by category (image first) then name
    result.sort((a, b) => {
      if (a.category !== b.category) return a.category === 'image' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }

  /**
   * Validate all @mentions trong prompt.
   * @param {string} prompt - Prompt text
   * @param {string} currentNodeId - Current node ID
   * @returns {{valid: boolean, errors: string[], warnings: string[]}}
   */
  _validatePromptMentions(prompt, currentNodeId) {
    const errors = [];
    const warnings = [];
    const mentions = this._parseMentions(prompt);

    if (mentions.length === 0) {
      return { valid: true, errors, warnings };
    }

    // Task 2.9: Max mentions limit validation
    const maxMentions = WorkflowEditor.MAX_MENTIONS_PER_PROMPT;
    if (mentions.length > maxMentions) {
      errors.push(window.I18n?.t('workflow.tooManyMentions', { count: mentions.length, max: maxMentions })
        || `Quá nhiều @mentions (${mentions.length}/${maxMentions})`);
    }

    const availableSlugs = this._getAvailableMentionSlugs(currentNodeId);
    const slugSet = new Set(availableSlugs.map(s => s.slug));
    const imageSlugSet = new Set(availableSlugs.filter(s => s.category === 'image').map(s => s.slug));

    for (const slug of mentions) {
      if (!slugSet.has(slug)) {
        errors.push(window.I18n?.t('workflow.mentionNotFound', { slug }) || `@${slug} không tồn tại trong workflow`);
      }
    }

    const hasImageMention = mentions.some(slug => imageSlugSet.has(slug));
    if (!hasImageMention) {
      warnings.push(window.I18n?.t('workflow.noImageMention') || 'Không có @image nào trong prompt. ref_mode=mention sẽ không có reference images.');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // ========== TASK 4.11 — RECENT @MENTIONS ==========

  /**
   * Load recent mentions from chrome.storage.local.
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<string[]>} Array of recent slug strings
   */
  async _loadRecentMentions(workflowId) {
    if (!workflowId) return [];
    try {
      const data = await chrome.storage.local.get('recent_mention_slugs');
      const allRecent = data.recent_mention_slugs || {};
      return Array.isArray(allRecent[workflowId]) ? allRecent[workflowId] : [];
    } catch (e) {
      console.warn('[WorkflowEditor] Failed to load recent mentions:', e.message);
      return [];
    }
  }

  /**
   * Save a slug to recent mentions (most recent first, max 10).
   * @param {string} workflowId - Workflow ID
   * @param {string} slug - Slug to add to recent
   */
  async _saveRecentMention(workflowId, slug) {
    if (!workflowId || !slug) return;
    try {
      const data = await chrome.storage.local.get('recent_mention_slugs');
      const allRecent = data.recent_mention_slugs || {};
      let recent = Array.isArray(allRecent[workflowId]) ? allRecent[workflowId] : [];
      // Remove if already exists, add to front
      recent = recent.filter(s => s !== slug);
      recent.unshift(slug);
      // Max 10 items
      if (recent.length > 10) recent = recent.slice(0, 10);
      allRecent[workflowId] = recent;
      await chrome.storage.local.set({ recent_mention_slugs: allRecent });
    } catch (e) {
      console.warn('[WorkflowEditor] Failed to save recent mention:', e.message);
    }
  }

  /**
   * Remove deleted slugs from recent mentions.
   * Call on workflow load to clean up stale entries.
   * @param {string} workflowId - Workflow ID
   * @param {string[]} validSlugs - Array of currently valid slugs
   */
  async _cleanupRecentMentions(workflowId, validSlugs) {
    if (!workflowId) return;
    try {
      const data = await chrome.storage.local.get('recent_mention_slugs');
      const allRecent = data.recent_mention_slugs || {};
      let recent = Array.isArray(allRecent[workflowId]) ? allRecent[workflowId] : [];
      const validSet = new Set(validSlugs);
      const cleaned = recent.filter(s => validSet.has(s));
      if (cleaned.length !== recent.length) {
        allRecent[workflowId] = cleaned;
        await chrome.storage.local.set({ recent_mention_slugs: allRecent });
      }
    } catch (e) {
      console.warn('[WorkflowEditor] Failed to cleanup recent mentions:', e.message);
    }
  }

  // ========== TASK 4.12 — FIND & REPLACE @SLUG ==========

  /**
   * Find all nodes that reference a given slug in their prompts.
   * @param {string} slug - The slug to search for
   * @param {string} excludeNodeId - Node ID to exclude (the slug's own node)
   * @returns {Array} References: [{ nodeId, nodeName, nodeType, prompt }]
   */
  _findSlugReferences(slug, excludeNodeId = null) {
    const references = [];
    if (!slug || !this.diagramCanvas) return references;

    const allNodeData = this._getAllNodeData();
    const mentionPattern = new RegExp(`@${slug}(?![a-z0-9_])`, 'g');

    for (const node of allNodeData) {
      if (node.node_id === excludeNodeId) continue;
      const prompt = node.prompt || '';
      if (mentionPattern.test(prompt)) {
        references.push({
          nodeId: node.node_id,
          nodeName: node.node_name || node.node_type || node.node_id,
          nodeType: node.node_type,
          prompt: prompt
        });
        mentionPattern.lastIndex = 0; // Reset regex state
      }
    }
    return references;
  }

  /**
   * Replace all occurrences of @oldSlug with @newSlug in all node prompts.
   * @param {string} oldSlug - Original slug
   * @param {string} newSlug - New slug
   * @returns {number} Number of nodes updated
   */
  _replaceSlugInAllNodes(oldSlug, newSlug) {
    if (!oldSlug || !newSlug || !this.diagramCanvas) return 0;

    const allNodeData = this._getAllNodeData();
    const mentionPattern = new RegExp(`@${oldSlug}(?![a-z0-9_])`, 'g');
    let updatedCount = 0;

    for (const node of allNodeData) {
      const prompt = node.prompt || '';
      if (mentionPattern.test(prompt)) {
        mentionPattern.lastIndex = 0;
        const newPrompt = prompt.replace(mentionPattern, `@${newSlug}`);
        // Update node data in Drawflow
        this.diagramCanvas.updateNodeData(node.node_id, { prompt: newPrompt });
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      this._hasUnsavedChanges = true;
    }
    return updatedCount;
  }

  /**
   * Show Find & Replace dialog when a slug is renamed.
   * @param {string} oldSlug - Original slug
   * @param {string} newSlug - New slug
   * @param {Array} references - Nodes referencing oldSlug
   * @returns {Promise<'update'|'skip'>} User choice
   */
  async _showFindReplaceDialog(oldSlug, newSlug, references) {
    const nodeList = references.map(r =>
      `• ${this.escapeHtml(r.nodeName)} (${r.nodeType}): "${this.escapeHtml(r.prompt.substring(0, 50))}${r.prompt.length > 50 ? '...' : ''}"`
    ).join('<br>');

    const slugUsedMsg = window.I18n?.t('workflow.slugUsedInNodes', { oldSlug, count: references.length })
      || `Slug "@${oldSlug}" được dùng trong ${references.length} node(s):`;
    const replaceMsg = window.I18n?.t('workflow.replaceAllQuestion', { oldSlug, newSlug })
      || `Đổi tất cả "@${oldSlug}" → "@${newSlug}"?`;

    const message = `
      <div style="text-align: left; font-size: 13px;">
        <p style="margin-bottom: 12px;">${slugUsedMsg}</p>
        <div style="max-height: 150px; overflow-y: auto; padding: 8px; background: var(--muted); border-radius: 6px; margin-bottom: 12px; font-size: 12px; line-height: 1.6;">
          ${nodeList}
        </div>
        <p>${replaceMsg}</p>
      </div>
    `;

    const result = await window.customDialog?.confirm(message, {
      title: window.I18n?.t('workflow.updateReferences') || 'Update References?',
      type: 'info',
      confirmText: window.I18n?.t('workflow.updateAll') || 'Update All',
      cancelText: window.I18n?.t('workflow.skipUpdate') || 'Skip'
    });

    return result === true ? 'update' : 'skip';
  }

  // ========== TASK 4.8 — PREVIEW RESOLVED PROMPT PANEL ==========

  /**
   * Create preview panel toggle button and panel for prompt textarea.
   * @param {HTMLTextAreaElement} textarea - Prompt textarea element
   * @param {string} nodeId - Current node ID
   */
  _createPreviewPanel(textarea, nodeId) {
    if (!textarea?.parentElement) return null;

    const wrapper = textarea.parentElement;
    // Check if panel already exists
    let panel = wrapper.querySelector('.mention-preview-panel');
    if (panel) return panel;

    // Create inner container for textarea + toggle (for proper absolute positioning)
    let textareaContainer = wrapper.querySelector('.prompt-textarea-inner');
    if (!textareaContainer) {
      textareaContainer = document.createElement('div');
      textareaContainer.className = 'prompt-textarea-inner';
      // Move textarea into the inner container
      wrapper.insertBefore(textareaContainer, textarea);
      textareaContainer.appendChild(textarea);
    }

    // Create toggle button container (positioned inside textarea area)
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'mention-preview-toggle';
    toggleContainer.innerHTML = `
      <button type="button" class="mention-preview-btn" title="${window.I18n?.t('workflow.previewResolvedPrompt') || 'Preview resolved prompt'}">
        <svg class="mention-preview-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        <span class="mention-preview-label">${window.I18n?.t('workflow.preview') || 'Preview'}</span>
      </button>
    `;

    // Create panel (outside textarea container, flows below)
    panel = document.createElement('div');
    panel.className = 'mention-preview-panel hidden';
    panel.innerHTML = `
      <div class="mention-preview-header">
        <span class="mention-preview-title">
          <svg class="mention-preview-header-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
          ${window.I18n?.t('workflow.resolvedPrompt') || 'Resolved Prompt'}
        </span>
        <button type="button" class="mention-preview-close" title="Close">×</button>
      </div>
      <div class="mention-preview-content">
        <div class="mention-preview-prompt"></div>
        <div class="mention-preview-refs">
          <div class="mention-preview-refs-label">
            <svg class="mention-preview-refs-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            ${window.I18n?.t('workflow.refImages') || 'Ref Images'}:
          </div>
          <div class="mention-preview-refs-grid"></div>
        </div>
      </div>
    `;

    // Toggle goes inside textarea container (absolute positioned)
    textareaContainer.appendChild(toggleContainer);
    // Panel goes after textarea container in wrapper (normal flow)
    wrapper.appendChild(panel);

    // Bind toggle button
    const toggleBtn = toggleContainer.querySelector('.mention-preview-btn');
    toggleBtn.addEventListener('click', () => {
      const isHidden = panel.classList.toggle('hidden');
      toggleBtn.classList.toggle('active', !isHidden);
      if (!isHidden) {
        this._updatePreviewPanel(textarea, nodeId);
      }
    });

    // Bind close button
    panel.querySelector('.mention-preview-close').addEventListener('click', () => {
      panel.classList.add('hidden');
      toggleBtn.classList.remove('active');
    });

    return panel;
  }

  /**
   * Update preview panel with resolved prompt.
   * @param {HTMLTextAreaElement} textarea - Prompt textarea element
   * @param {string} nodeId - Current node ID
   */
  _updatePreviewPanel(textarea, nodeId) {
    // Panel is in .prompt-mention-wrapper (parent of .prompt-textarea-inner which contains textarea)
    const wrapper = textarea?.parentElement?.parentElement;
    const panel = wrapper?.querySelector('.mention-preview-panel');
    if (!panel || panel.classList.contains('hidden')) return;

    const prompt = textarea.value || '';
    const mentions = this._parseMentions(prompt);
    const availableSlugs = this._getAvailableMentionSlugs(nodeId);
    const slugMap = new Map(availableSlugs.map(s => [s.slug, s]));

    // Resolve prompt: replace @slug with [slug] or (pending) or (invalid)
    let resolvedPrompt = prompt;
    const refImages = [];

    for (const slug of mentions) {
      const info = slugMap.get(slug);
      const pattern = new RegExp(`@${slug}(?![a-z0-9_])`, 'g');

      if (!info) {
        resolvedPrompt = resolvedPrompt.replace(pattern, `<span class="mention-preview-invalid">@${slug}</span>`);
      } else if (info.category === 'text') {
        resolvedPrompt = resolvedPrompt.replace(pattern, `<span class="mention-preview-text">[@${slug}]</span>`);
      } else {
        if (info.thumbnail) {
          resolvedPrompt = resolvedPrompt.replace(pattern, `<span class="mention-preview-image">[@${slug}]</span>`);
          refImages.push({ slug, thumbnail: info.thumbnail, name: info.name });
        } else {
          resolvedPrompt = resolvedPrompt.replace(pattern, `<span class="mention-preview-pending">[@${slug}] (pending)</span>`);
        }
      }
    }

    // Escape remaining HTML but preserve our spans
    const tempDiv = document.createElement('div');
    tempDiv.textContent = resolvedPrompt;
    let escapedPrompt = tempDiv.innerHTML;
    // Restore our span tags
    escapedPrompt = escapedPrompt
      .replace(/&lt;span class="mention-preview-/g, '<span class="mention-preview-')
      .replace(/&lt;\/span&gt;/g, '</span>')
      .replace(/"&gt;/g, '">');

    // Update DOM
    const promptEl = panel.querySelector('.mention-preview-prompt');
    const refsGrid = panel.querySelector('.mention-preview-refs-grid');
    const refsSection = panel.querySelector('.mention-preview-refs');

    if (promptEl) {
      promptEl.innerHTML = escapedPrompt || `<span class="mention-preview-empty">${window.I18n?.t('workflow.emptyPrompt') || '(empty prompt)'}</span>`;
    }

    if (refsGrid && refsSection) {
      if (refImages.length > 0) {
        refsSection.classList.remove('hidden');
        refsGrid.innerHTML = refImages.map(img => `
          <div class="mention-preview-ref-item" title="@${this.escapeAttr(img.slug)} — ${this.escapeAttr(img.name)}">
            <img src="${this.escapeAttr(img.thumbnail)}" alt="@${this.escapeAttr(img.slug)}" />
            <span class="mention-preview-ref-label">@${this.escapeHtml(img.slug)}</span>
          </div>
        `).join('');
      } else {
        refsSection.classList.add('hidden');
        refsGrid.innerHTML = '';
      }
    }
  }

  /**
   * Bind mention autocomplete cho prompt textarea.
   * Hiển thị dropdown khi user gõ @ và filter theo ký tự tiếp theo.
   *
   * @param {HTMLTextAreaElement} textarea - Prompt textarea element
   * @param {string} nodeId - Current node ID (drawflow ID)
   */

  /**
   * Helper: Get cursor position trong textarea (approximate).
   * Dùng để position autocomplete dropdown.
   */
  _getTextareaCursorPosition(textarea) {
    const text = textarea.value.substring(0, textarea.selectionStart);
    const lines = text.split('\n');
    const currentLine = lines.length;
    const currentCol = lines[lines.length - 1].length;

    const style = getComputedStyle(textarea);
    const lineHeight = parseInt(style.lineHeight) || 20;
    const fontSize = parseInt(style.fontSize) || 14;
    const charWidth = fontSize * 0.6; // Better approximate for monospace-ish fonts

    // Account for scroll position
    const topPos = (currentLine - 1) * lineHeight - textarea.scrollTop;

    return {
      top: Math.max(0, topPos),
      left: Math.min(currentCol * charWidth, textarea.clientWidth - 100)
    };
  }

  /**
   * Phase 2.6 — Create mention chips preview container.
   * Shows parsed mentions as clickable chips below textarea.
   */
  _createMentionChipsPreview(textarea, nodeId) {
    if (!textarea?.parentElement) return null;

    let preview = textarea.parentElement.querySelector('.mention-chips-preview');
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'mention-chips-preview';
      textarea.parentElement.appendChild(preview);
    }

    // Bind click handler for chips
    preview.addEventListener('click', (e) => {
      const chip = e.target.closest('.mention-chips-preview-chip');
      if (!chip) return;

      const slug = chip.dataset.slug;
      const isRemove = e.target.closest('.mention-chips-preview-remove');

      if (isRemove) {
        // Remove mention from textarea
        this._removeMentionFromTextarea(textarea, slug);
        this._updateMentionChipsPreview(textarea, nodeId);
      } else {
        // Highlight source node on canvas
        this._highlightMentionedNode(slug);
      }
    });

    return preview;
  }

  /**
   * Phase 2.6 — Update mention chips preview based on textarea content.
   */
  _updateMentionChipsPreview(textarea, nodeId) {
    const preview = textarea?.parentElement?.querySelector('.mention-chips-preview');
    if (!preview) return;

    const text = textarea.value || '';
    const mentions = this._parseMentions(text);

    if (mentions.length === 0) {
      preview.innerHTML = '';
      return;
    }

    const availableSlugs = this._getAvailableMentionSlugs(nodeId);
    const slugMap = new Map(availableSlugs.map(s => [s.slug, s]));

    const chipsHtml = mentions.map(slug => {
      const info = slugMap.get(slug);
      const isValid = !!info;
      const isTextType = info?.category === 'text';

      let typeClass = isValid ? (isTextType ? 'text-type' : '') : 'invalid';
      let thumbHtml = '';

      if (isValid && info.thumbnail) {
        thumbHtml = `<img class="mention-chips-preview-thumb" src="${this.escapeAttr(info.thumbnail)}" alt="">`;
      } else if (isValid && isTextType) {
        thumbHtml = `<span class="mention-chips-preview-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line></svg></span>`;
      } else if (isValid) {
        thumbHtml = `<span class="mention-chips-preview-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg></span>`;
      } else {
        thumbHtml = `<span class="mention-chips-preview-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></span>`;
      }

      return `
        <span class="mention-chips-preview-chip ${typeClass}" data-slug="${this.escapeAttr(slug)}" title="${isValid ? this.escapeAttr(info.name || slug) : (window.I18n?.t('workflow.mentionNotFound') || 'Node không tồn tại')}">
          ${thumbHtml}
          <span class="mention-chips-preview-slug">${this.escapeHtml(slug)}</span>
          <button type="button" class="mention-chips-preview-remove" title="${window.I18n?.t('workflow.removeMention') || 'Xóa mention'}">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </span>
      `;
    }).join('');

    preview.innerHTML = chipsHtml;
  }

  /**
   * Phase 2.6 — Remove a mention from textarea text.
   */
  _removeMentionFromTextarea(textarea, slug) {
    if (!textarea || !slug) return;

    const text = textarea.value;
    // Replace @slug with empty, also remove extra space if any
    const regex = new RegExp(`@${slug}(?![a-z0-9_])\\s?`, 'gi');
    textarea.value = text.replace(regex, '').replace(/\s{2,}/g, ' ').trim();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Phase 2.7 — Highlight mentioned node on canvas (click to select).
   */
  _highlightMentionedNode(slug) {
    if (!slug || !this.workflow?.nodes) return;

    const node = this.workflow.nodes.find(n => n.slug === slug);
    if (!node?.node_id) return;

    // Find drawflow node ID
    const dfId = this._findDrawflowId(node.node_id);
    if (!dfId) return;

    // Emit select event to highlight on canvas
    if (window.eventBus) {
      window.eventBus.emit('node:selected', { nodeId: dfId });
    }

    // Also scroll to node if possible
    if (this.diagramCanvas?.scrollToNode) {
      this.diagramCanvas.scrollToNode(dfId);
    }
  }

  /**
   * Phase 4 Task 4.1 — Update visual indicators for all mentioned nodes.
   * Adds .being-mentioned class to canvas nodes that are @mentioned in current prompt.
   */
  _updateMentionedNodesIndicator(prompt) {
    // Clear all existing indicators
    const container = this.diagramCanvas?.container || document.querySelector('.drawflow');
    if (!container) return;

    container.querySelectorAll('.drawflow-node.being-mentioned').forEach(el => {
      el.classList.remove('being-mentioned');
    });

    // Parse mentions from prompt
    const mentions = this._parseMentions(prompt);
    if (!mentions.length || !this.workflow?.nodes) return;

    // Find nodes by slug and add indicator
    for (const slug of mentions) {
      const node = this.workflow.nodes.find(n => n.slug === slug);
      if (!node?.node_id) continue;

      const dfId = this._findDrawflowId(node.node_id);
      if (!dfId) continue;

      const nodeEl = container.querySelector(`#node-${dfId}`);
      if (nodeEl) {
        nodeEl.classList.add('being-mentioned');
      }
    }
  }

  /**
   * Phase 4 Task 4.1 — Clear all mention indicators.
   */
  _clearMentionedNodesIndicator() {
    const container = this.diagramCanvas?.container || document.querySelector('.drawflow');
    if (!container) return;

    container.querySelectorAll('.drawflow-node.being-mentioned').forEach(el => {
      el.classList.remove('being-mentioned');
    });
  }

  /**
   * Phase 4 Task 4.2 — Validate all mentions across all nodes before execution.
   * Checks for missing @slugs and ref_mode=mention without image mentions.
   * @param {Array} nodes - All node data
   * @returns {{errors: Array, warnings: Array}}
   */
  _validateAllMentions(nodes) {
    const errors = [];
    const warnings = [];

    if (!nodes || !Array.isArray(nodes)) return { errors, warnings };

    const slugSet = new Set(nodes.filter(n => n.slug).map(n => n.slug));
    const imageNodeTypes = ['image', 'generate', 'chatgpt', 'grok'];
    const imageSlugSet = new Set(nodes.filter(n => n.slug && imageNodeTypes.includes(n.node_type)).map(n => n.slug));

    for (const node of nodes) {
      // Phase 6: Use server config via _canUseMentions
      if (!this._canUseMentions(node.node_type)) continue;
      if (node.enabled === false) continue;

      const prompt = node.prompt || '';
      const mentions = this._parseMentions(prompt);

      if (mentions.length === 0) continue;

      // Task 4.2: Check for missing @slugs
      for (const slug of mentions) {
        if (!slugSet.has(slug)) {
          errors.push({
            nodeId: node.node_id,
            nodeName: node.node_name || node.node_id,
            type: 'missing_mention',
            message: window.I18n?.t('workflow.mentionNotFoundError', { slug }) || `@${slug} không tồn tại`
          });
        }
      }

      // Task 4.3: Warning for ref_mode=mention but no image @mentions.
      // 2026-05-31: BỎ warning preflight — quá nhiều false positive.
      // Lý do:
      //   - Node với prompt_source='upstream_node': prompt resolve runtime → @image có thể xuất hiện
      //   - Node với prompt rỗng + ref_file_ids đã picked: ref vẫn dùng được dù ref_mode='mention'
      //   - User báo: ref_mode='all' trong JSON nhưng warning vẫn fire → data drift / stale check
      // Runtime check ở WorkflowExecutor line 586 đã handle warning chính xác hơn (sau khi
      // prompt được resolve full). Preflight chỉ giữ ERROR validation (missing slug).

      // Check max mentions
      const maxMentions = WorkflowEditor.MAX_MENTIONS_PER_PROMPT;
      if (mentions.length > maxMentions) {
        warnings.push({
          nodeId: node.node_id,
          nodeName: node.node_name || node.node_id,
          type: 'too_many_mentions',
          message: window.I18n?.t('workflow.tooManyMentionsWarning', { count: mentions.length, max: maxMentions }) || `Quá nhiều mentions (${mentions.length}/${maxMentions})`
        });
      }
    }

    return { errors, warnings };
  }

  /**
   * Render avatars của users được share workflow
   * Hiển thị tối đa 3 avatars, nếu >3 thì thêm (+N) avatar
   * @param {Array} shares - Danh sách share records với recipient info
   * @returns {string} HTML avatars hoặc empty string
   */
  _renderSharedUsersAvatars(shares) {
    if (!shares || shares.length === 0) return '';

    const acceptedShares = shares.filter(s => s.status === 'accepted' && s.recipient);
    if (acceptedShares.length === 0) return '';

    const maxShow = 3;
    const displayShares = acceptedShares.slice(0, maxShow);
    const extraCount = acceptedShares.length - maxShow;

    let avatarsHtml = displayShares.map(share => {
      const name = share.recipient.name || share.recipient.email || 'User';
      const initial = name.charAt(0).toUpperCase();
      const email = share.recipient.email || '';
      const tooltip = `${this.escapeHtml(name)}${email ? ` (${this.escapeHtml(email)})` : ''}`;
      return `<span class="wf-share-avatar" title="${tooltip}" data-tooltip="${tooltip}">${initial}</span>`;
    }).join('');

    if (extraCount > 0) {
      const moreLabel = window.I18n?.t('workflow.share.moreUsers', { count: extraCount }) || `+${extraCount} người khác`;
      avatarsHtml += `<span class="wf-share-avatar wf-share-avatar-more" title="${this.escapeAttr(moreLabel)}">+${extraCount}</span>`;
    }

    return `
      <div class="wf-share-avatars wf-share-avatars--editor" title="${window.I18n?.t('workflow.share.manageTitle') || 'Quản lý chia sẻ'}">
        <span class="wf-share-label">${window.I18n?.t('workflow.share.label') || 'Shared'}</span>
        <div class="wf-share-avatar-stack">${avatarsHtml}</div>
      </div>`;
  }

  // ========== UNDO / REDO HISTORY ==========

  /**
   * Bind keyboard + eventBus listeners cho undo system.
   * Listeners đồng bộ với DiagramCanvas events (snapshot mỗi action).
   */
  _bindHistoryEvents() {
    if (!this.history) return;

    // Keyboard: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z hoặc Ctrl+Y = redo
    this._historyKeyHandler = (e) => {
      // Skip nếu đang nhập trong text field (cho phép native undo)
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // Skip nếu workflow editor không mở
      if (!this.overlay || this.overlay.classList.contains('hidden')) return;

      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        this._handleUndo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        e.stopPropagation();
        this._handleRedo();
      }
    };
    document.addEventListener('keydown', this._historyKeyHandler, true);

    // Discrete actions (snapshot ngay)
    const discreteEvents = [
      'node:created', 'node:removed', 'node:duplicated',
      'edge:created', 'edge:removed', 'workflow:edges_migrated',
      'node:toggled',
    ];
    this._historyEventHandlers = {};
    discreteEvents.forEach(evt => {
      const h = () => {
        this.history?.takeSnapshot(evt);
        this._updateUndoRedoButtons();
      };
      this._historyEventHandlers[evt] = h;
      window.eventBus?.on(evt, h);
    });

    // Continuous actions (debounced 400ms)
    const debouncedEvents = ['node:moved', 'node:data_changed'];
    debouncedEvents.forEach(evt => {
      const h = () => {
        this.history?.scheduleSnapshot(evt, 400);
        // Update buttons sau debounce delay (ưu tiên responsiveness — defer tới sau snapshot fire)
        setTimeout(() => this._updateUndoRedoButtons(), 450);
      };
      this._historyEventHandlers[evt] = h;
      window.eventBus?.on(evt, h);
    });
  }

  /**
   * Dispatch toolbar action — dùng chung cho left toolbar click + canvas right-click menu.
   * @param {string} action — vd 'add-node', 'run-workflow', 'undo', 'redo', ...
   * @param {Object} [opts] — { canvasX, canvasY } cho add-node spawn position
   */
  // Nhét nút log/export/share vào zoom toolbar bottom-left có sẵn (.canvas-controls) thay vì tạo toolbar mới.
  _injectCanvasToolButtons(diagramContainer) {
    const controls = (diagramContainer || this.overlay)?.querySelector('.canvas-controls');
    if (!controls || controls.querySelector('[data-action="toggle-log"]')) return; // guard double-inject
    const t = (k, fb) => window.I18n?.t(k) || fb;
    const lockBadge = '<svg class="wf-tool-lock-badge" width="9" height="9" viewBox="0 0 24 24" fill="var(--warning, #f59e0b)" stroke="var(--warning, #f59e0b)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none"></path></svg>';
    const canExport = !!window.featureGate?.canUse('workflow_export');
    const canShare = !!window.featureGate?.canUse('workflow_share_enabled');
    const showLog = !(this.isTemplateMode || this.isReadOnly());
    const showExport = !(this.mode === 'create' || this.isTemplateMode);
    const showShare = !(this.mode === 'create' || this.isTemplateMode || this.isReadOnly());
    const html = `
      <span class="canvas-control-divider" aria-hidden="true"></span>
      <button class="canvas-control-btn ${showLog ? '' : 'hidden'}" data-action="toggle-log" title="${t('workflow.logAndProgress', 'Log & tiến độ')}" data-tooltip="${t('workflow.logAndProgress', 'Log & tiến độ')}" data-tooltip-placement="top">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      </button>
      <button class="canvas-control-btn ${showExport ? '' : 'hidden'} ${canExport ? '' : 'seosonaflow-wf-tool-btn--locked'}" data-action="export-workflow" title="${t('workflow.exportBtn', 'Xuất workflow')}" data-tooltip="${t('workflow.exportBtn', 'Xuất workflow')}" data-tooltip-placement="top">
        <span class="wf-tool-icon-wrap"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${canExport ? '' : lockBadge}</span>
      </button>
      <button class="canvas-control-btn ${showShare ? '' : 'hidden'} ${canShare ? '' : 'seosonaflow-wf-tool-btn--locked'}" data-action="share-workflow" title="${t('workflow.shareBtn', 'Chia sẻ')}" data-tooltip="${t('workflow.shareBtn', 'Chia sẻ')}" data-tooltip-placement="top">
        <span class="wf-tool-icon-wrap"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>${canShare ? '' : lockBadge}</span>
      </button>`;
    controls.insertAdjacentHTML('beforeend', html);
    // Click delegation cho nút action (zoom buttons zoomIn/Out/reset wired riêng bằng id trong DiagramCanvas).
    controls.addEventListener('click', (e) => {
      const btn = e.target.closest('.canvas-control-btn[data-action]');
      if (!btn) return;
      this._dispatchToolbarAction(btn.dataset.action);
    });
  }

  _dispatchToolbarAction(action, opts = {}) {
    // Guard: Check permissions before executing actions
    const perms = this.getPermissions();

    if (action === 'mode-select' || action === 'mode-pan') {
      // Chuyển mode chuột: select (drag node/connect) ↔ pan (kéo = dời canvas).
      const pan = action === 'mode-pan';
      this.diagramCanvas?.setHandMode?.(pan);
      this.overlay?.querySelectorAll('.wf-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.action === action));
      return;
    }
    if (action === 'add-node') {
      if (!perms.canEdit) return; // Guard: read-only mode
      // Smart placement priority:
      //   1. opts.canvasX/Y (explicit from right-click context menu)
      //   2. _lastMouseCanvasPos (tracked from user's mouse on canvas)
      //   3. Center of diagram (fallback)
      const rect = this.overlay.querySelector('#diagramContainer')?.getBoundingClientRect();
      const fallbackX = rect ? rect.width / 2 : 200;
      const fallbackY = rect ? rect.height / 2 : 200;
      const posX = opts.canvasX ?? this._lastMouseCanvasPos?.x ?? fallbackX;
      const posY = opts.canvasY ?? this._lastMouseCanvasPos?.y ?? fallbackY;
      this._showNodePicker(posX, posY);
    } else if (action === 'add-note-node') {
      if (!perms.canEdit) return; // Guard: read-only mode
      // Tạo note frame trực tiếp (không qua picker). Canh giữa điểm spawn (note 1260×840 → offset nửa kích thước).
      const rect = this.overlay.querySelector('#diagramContainer')?.getBoundingClientRect();
      const posX = this._lastMouseCanvasPos?.x ?? (rect ? rect.width / 2 : 200);
      const posY = this._lastMouseCanvasPos?.y ?? (rect ? rect.height / 2 : 200);
      this._createNodeFromPicker('note', posX - 630, posY - 420);
    } else if (action === 'run-workflow') {
      if (!this.canRun()) return; // Guard: permission + featureGate
      this._runWorkflowFromEditor();
    } else if (action === 'stop-workflow') {
      // Force stop (mirror ExecutionTracker._handleStop). Bug fix 2026-05-27: trước đây gọi
      // workflowExecutor.stop() = graceful → khi single-node ĐÃ submit (hasSubmittedNodes) thì
      // KHÔNG gửi stopExecution → Flow content script vẫn chờ tile → "stop không tác dụng".
      this._forceStopExecution();
    } else if (action === 'toggle-log') {
      if (!perms.showLog) return; // Guard: template mode
      const logPanel = this.overlay?.querySelector('#executionLogPanel');
      if (logPanel) logPanel.classList.toggle('hidden');
    } else if (action === 'fit-screen') {
      this.diagramCanvas?.fitToScreen?.();
    } else if (action === 'rescan-thumbnails') {
      this._rescanAllThumbnails();
    } else if (action === 'auto-layout') {
      if (!perms.canEdit) return; // Guard: read-only mode
      this._autoLayoutNodes();
    } else if (action === 'settings') {
      if (!perms.canEdit) return; // Guard: read-only mode
      this._showWorkflowSettings();
    } else if (action === 'export-workflow') {
      if (!perms.canExport) return; // Guard: mode check
      this.exportWorkflow();
    } else if (action === 'share-workflow') {
      if (!this.canShare()) return; // Guard: permission + featureGate
      this._shareWorkflow();
    } else if (action === 'undo') {
      if (!perms.canEdit) return; // Guard: read-only mode
      this._handleUndo();
    } else if (action === 'redo') {
      if (!perms.canEdit) return; // Guard: read-only mode
      this._handleRedo();
    } else if (action === 'paste-image') {
      if (!perms.canEdit) return; // Guard: read-only mode
      this._pasteImageFromClipboard(opts).catch(err => {
        console.warn('[WorkflowEditor] pasteImageFromClipboard failed:', err?.message);
      });
    } else if (action === 'add-media-images') {
      if (!perms.canEdit) return; // Guard: read-only mode
      this._openMediaModalAndAddImageNodes(opts);
    } else if (action === 'paste-node') {
      if (!perms.canEdit) return; // Guard: read-only mode
      const clip = this._nodeClipboard;
      const hasCoord = opts.canvasX != null && opts.canvasY != null;
      if (clip?.nodes?.length) {
        // Multi clipboard: paste cả nhóm tại right-click (anchor giữ layout) hoặc offset +40.
        this._pasteNodesFromClipboard(hasCoord ? { canvasX: opts.canvasX, canvasY: opts.canvasY } : null);
      } else if (clip?.data) {
        // v1.1 single: paste tại right-click coord — fallback cursor/center trong _pasteNodeFromClipboard.
        if (hasCoord) {
          const prevPos = this._lastMouseCanvasPos;
          this._lastMouseCanvasPos = { x: opts.canvasX, y: opts.canvasY };
          try { this._pasteNodeFromClipboard(); } finally { this._lastMouseCanvasPos = prevPos; }
        } else {
          this._pasteNodeFromClipboard();
        }
      }
    }
  }

  /**
   * v1.1 paste image feature: đọc clipboard qua Clipboard API (cần `clipboardRead`
   * permission + user gesture). Gọi từ context menu — Ctrl+V trực tiếp vẫn dùng
   * paste handler ở `_bindCanvasPasteHandler`.
   */
  async _pasteImageFromClipboard(opts = {}) {
    if (!navigator.clipboard?.read) {
      window.showNotification?.(
        window.I18n?.t?.('workflow.pasteImage.clipboardUnavailable')
          || 'Browser không hỗ trợ Clipboard API — dùng Ctrl+V trực tiếp.',
        'warning'
      );
      return;
    }
    let items;
    try {
      items = await navigator.clipboard.read();
    } catch (err) {
      window.showNotification?.(
        window.I18n?.t?.('workflow.pasteImage.clipboardDenied')
          || 'Không thể đọc clipboard — dùng Ctrl+V trực tiếp.',
        'warning'
      );
      return;
    }

    const files = [];
    for (const item of items) {
      const imageType = item.types?.find(t => t.startsWith('image/'));
      if (!imageType) continue;
      try {
        const blob = await item.getType(imageType);
        const ext = imageType.split('/')[1] || 'png';
        const file = new File([blob], `pasted-${Date.now()}.${ext}`, { type: imageType });
        files.push(file);
      } catch (err) {
        console.warn('[WorkflowEditor] clipboard getType failed:', err?.message);
      }
    }

    if (files.length === 0) {
      window.showNotification?.(
        window.I18n?.t?.('workflow.pasteImage.noImageInClipboard')
          || 'Clipboard không có ảnh. Copy ảnh trước rồi thử lại.',
        'info'
      );
      return;
    }

    // Position: ưu tiên context menu coord, fallback center viewport
    const rect = this.overlay?.querySelector('#diagramContainer')?.getBoundingClientRect();
    const fallbackX = rect ? rect.width / 2 : 200;
    const fallbackY = rect ? rect.height / 2 : 200;
    const posX = opts.canvasX ?? this._lastMouseCanvasPos?.x ?? fallbackX;
    const posY = opts.canvasY ?? this._lastMouseCanvasPos?.y ?? fallbackY;
    await this._handlePastedImages(files, posX, posY);
  }

  /**
   * Show right-click context menu trên vùng trống diagram.
   * Items mirror left toolbar (add-node, run, undo, redo, fit-screen, ...).
   * Trước khi execute action: đóng node form (với unsaved/upload check).
   */
  _showCanvasContextMenu(clientX, clientY, canvasX, canvasY) {
    // Preview mode: không cho right-click menu
    if (this.isReadOnly()) {
      return;
    }

    this._hideCanvasContextMenu();
    // Store canvas coords for add-node action
    this._contextMenuCanvasPos = (canvasX != null && canvasY != null) ? { x: canvasX, y: canvasY } : null;

    // Async probe clipboard cho image (right-click = user gesture → clipboard.read OK).
    // Fire-and-forget: render menu ngay (không await), inject paste-image sau nếu có image.
    // Tránh delay menu open + tránh permission prompt mỗi lần right-click.
    this._probeClipboardForImage();

    const t = (key, fallback) => window.I18n?.t?.(key) || fallback;
    const isCreate = this.mode === 'create';
    const isRunning = !!window.workflowExecutor?.isRunning;
    const isTemplate = this.isTemplateMode;
    // Items đồng bộ với toolbar: ẩn run/stop/export theo mode, ẩn execution items trong template mode
    const items = [
      { action: 'add-node', label: t('workflow.addNodeShortcut', 'Thêm node (N)'), iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' },
      (this.isTemplateMode || this.isReadOnly()) ? null : { action: 'add-media-images', label: t('workflow.addMediaImages', 'Thêm ảnh từ thư viện'), iconSvg: '<svg width="16" height="16" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.25 1.5H3.9C3.05992 1.5 2.63988 1.5 2.31901 1.66349C2.03677 1.8073 1.8073 2.03677 1.66349 2.31901C1.5 2.63988 1.5 3.05992 1.5 3.9V8.1C1.5 8.94008 1.5 9.36012 1.66349 9.68099C1.8073 9.96323 2.03677 10.1927 2.31901 10.3365C2.63988 10.5 3.05992 10.5 3.9 10.5H8.5C8.96499 10.5 9.19748 10.5 9.38823 10.4489C9.90587 10.3102 10.3102 9.90587 10.4489 9.38823C10.5 9.19748 10.5 8.96499 10.5 8.5M9.5 4V1M8 2.5H11M5.25 4.25C5.25 4.80228 4.80228 5.25 4.25 5.25C3.69772 5.25 3.25 4.80228 3.25 4.25C3.25 3.69772 3.69772 3.25 4.25 3.25C4.80228 3.25 5.25 3.69772 5.25 4.25ZM7.49502 5.95907L3.26557 9.80402C3.02768 10.0203 2.90873 10.1284 2.89821 10.2221C2.88909 10.3033 2.92023 10.3838 2.98159 10.4378C3.05239 10.5 3.21314 10.5 3.53464 10.5H8.22799C8.94757 10.5 9.30736 10.5 9.58996 10.3791C9.94472 10.2274 10.2274 9.94472 10.3791 9.58996C10.5 9.30736 10.5 8.94757 10.5 8.22799C10.5 7.98587 10.5 7.86482 10.4735 7.75208C10.4403 7.61039 10.3765 7.47768 10.2866 7.3632C10.2151 7.2721 10.1206 7.19647 9.93154 7.04523L8.53291 5.92633C8.34369 5.77495 8.24908 5.69927 8.1449 5.67256C8.05307 5.64901 7.95643 5.65206 7.86627 5.68135C7.76397 5.71457 7.67432 5.79607 7.49502 5.95907Z"/></svg>' },
      // v1.1 Node clipboard: Paste node — hiện khi clipboard có data (single) HOẶC nodes (multi).
      (this._nodeClipboard?.data || this._nodeClipboard?.nodes?.length) ? {
        action: 'paste-node',
        label: this._nodeClipboard?.nodes?.length
          ? ((() => { const c = this._nodeClipboard.nodes.length; const v = window.I18n?.t?.('workflow.pasteNodesMulti', { count: c }); return (v && v !== 'workflow.pasteNodesMulti') ? v : `Dán ${c} node (Ctrl+V)`; })())
          : t('workflow.pasteNodeMenu', 'Dán node (Ctrl+V)'),
        iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
      } : null,
      // v1.1 paste image: chỉ hiện khi `_clipboardHasImage = true` (set bởi `_probeClipboardForImage`).
      // Fast-path: nếu cache TTL còn (probe gần đây) → render sync; else show ban đầu = no, inject sau khi probe done.
      // Template mode: ẩn paste-image (Flow CDN URL signature TTL → ảnh missing sau vài ngày).
      // Admin dùng admin Template Settings cho ref images permanent.
      (this._clipboardHasImage && !this.isTemplateMode) ? { action: 'paste-image', label: t('workflow.pasteImageMenu', 'Dán ảnh (Ctrl+V)'), iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' } : null,
      // Ẩn run/stop trong template mode
      (isCreate || isTemplate) ? null : (isRunning
        ? { action: 'stop-workflow', label: t('workflow.stopBtn', 'Dừng'), iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg>' }
        : { action: 'run-workflow', label: t('workflow.runShortcut', 'Chạy (Ctrl+Enter)'), iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' }
      ),
      { divider: true },
      { action: 'undo', label: t('workflow.undoShortcut', 'Hoàn tác (Ctrl+Z)'), iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>', disabled: !this.history?.canUndo?.() },
      { action: 'redo', label: t('workflow.redoShortcut', 'Làm lại (Ctrl+Shift+Z)'), iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>', disabled: !this.history?.canRedo?.() },
      { divider: true },
      // Ẩn toggle-log trong template mode
      isTemplate ? null : { action: 'toggle-log', label: t('workflow.logAndProgress', 'Log & tiến độ'), iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' },
      { action: 'fit-screen', label: t('workflow.fitScreen', 'Vừa màn hình (F)'), iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>' },
      { action: 'auto-layout', label: t('workflow.autoLayout', 'Sắp xếp lại nodes'), iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><line x1="9" y1="6" x2="15" y2="6"/><line x1="9" y1="18" x2="15" y2="18"/><line x1="6" y1="9" x2="6" y2="15"/><line x1="18" y1="9" x2="18" y2="15"/></svg>' },
      { divider: true },
      // Settings label thay đổi theo mode
      { action: 'settings', label: isTemplate ? t('workflow.templateSettings', 'Cài đặt template') : t('workflow.settingsWorkflow', 'Cài đặt workflow'), iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' },
      // Ẩn export/share trong template mode. Lock badge khi feature bị lock.
      (isCreate || isTemplate) ? null : {
        action: 'export-workflow',
        label: t('workflow.exportBtn', 'Xuất workflow'),
        iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        locked: !window.featureGate?.canUse('workflow_export')
      },
      (isCreate || isTemplate || this.isReadOnly()) ? null : {
        action: 'share-workflow',
        label: t('workflow.shareBtn', 'Chia sẻ'),
        iconSvg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
        locked: !window.featureGate?.canUse('workflow_share_enabled')
      },
    ].filter(Boolean);

    const menu = document.createElement('div');
    menu.className = 'df-canvas-context-menu';
    const lockBadgeSvg = '<svg class="wf-ctx-lock-badge" width="9" height="9" viewBox="0 0 24 24" fill="var(--warning, #f59e0b)" stroke="var(--warning, #f59e0b)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none"></path></svg>';
    menu.innerHTML = items.map(item => {
      if (item.divider) return '<div class="df-canvas-context-divider"></div>';
      const disabledAttr = item.disabled ? ' disabled' : '';
      const disabledClass = item.disabled ? ' df-canvas-context-item--disabled' : '';
      const lockedClass = item.locked ? ' df-canvas-context-item--locked' : '';
      const iconWithBadge = item.locked ? `${item.iconSvg}${lockBadgeSvg}` : item.iconSvg;
      return `<button type="button" class="df-canvas-context-item${disabledClass}${lockedClass}" data-action="${item.action}"${disabledAttr}>
        <span class="df-canvas-context-icon">${iconWithBadge}</span>
        <span class="df-canvas-context-label">${item.label}</span>
      </button>`;
    }).join('');

    // Position — clamp trong viewport
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    menu.style.left = `${Math.max(8, Math.min(clientX, maxX))}px`;
    menu.style.top = `${Math.max(8, Math.min(clientY, maxY))}px`;
    this._canvasContextMenu = menu;

    // Click handler — đóng form (với unsaved/upload check) → execute action
    menu.addEventListener('click', async (e) => {
      const btn = e.target.closest('.df-canvas-context-item');
      if (!btn || btn.disabled) return;
      const action = btn.dataset.action;
      // Bug fix 2026-06-03: Capture canvas pos TRƯỚC khi _hideCanvasContextMenu() — vì hide
      // sẽ clear `this._contextMenuCanvasPos = null` (line 19700). Trước fix: hide chạy trước
      // → đọc lại null → opts={} → node spawn ở fallback (center/last-mouse stale) thay vì
      // tại vị trí right-click.
      const capturedCanvasPos = this._contextMenuCanvasPos
        ? { x: this._contextMenuCanvasPos.x, y: this._contextMenuCanvasPos.y }
        : null;
      this._hideCanvasContextMenu();

      // Đóng node form nếu đang mở (kiểm tra unsaved + upload)
      if (this.selectedNodeId) {
        await this._handleNodeUnselected();
        // Nếu user cancel dialog → form vẫn mở → KHÔNG execute action (tránh mất context)
        if (this.selectedNodeId) return;
      }
      // Pass canvas coords cho add-node / paste-image / paste-node (placement tại right-click position)
      const opts = (action === 'add-node' || action === 'paste-image' || action === 'paste-node' || action === 'add-media-images') && capturedCanvasPos
        ? { canvasX: capturedCanvasPos.x, canvasY: capturedCanvasPos.y }
        : {};
      this._dispatchToolbarAction(action, opts);
    });

    // Click ngoài menu → đóng. setTimeout để bỏ qua right-click event hiện tại.
    setTimeout(() => {
      const closeOnOutsideClick = (e) => {
        if (!menu.contains(e.target)) {
          this._hideCanvasContextMenu();
          document.removeEventListener('click', closeOnOutsideClick, true);
          document.removeEventListener('contextmenu', closeOnOutsideClick, true);
        }
      };
      document.addEventListener('click', closeOnOutsideClick, true);
      document.addEventListener('contextmenu', closeOnOutsideClick, true);
      this._canvasContextMenuCloseHandler = closeOnOutsideClick;
    }, 0);
  }

  _hideCanvasContextMenu() {
    if (this._canvasContextMenu) {
      this._canvasContextMenu.remove();
      this._canvasContextMenu = null;
    }
    if (this._canvasContextMenuCloseHandler) {
      document.removeEventListener('click', this._canvasContextMenuCloseHandler, true);
      document.removeEventListener('contextmenu', this._canvasContextMenuCloseHandler, true);
      this._canvasContextMenuCloseHandler = null;
    }
    this._contextMenuCanvasPos = null;
  }

  /**
   * Probe clipboard cho image content. Right-click = user gesture → clipboard.read OK.
   * Fire-and-forget: update `this._clipboardHasImage` + inject paste-image vào menu hiện tại
   * nếu found. Tránh delay menu open (probe ~10-50ms).
   */
  async _probeClipboardForImage() {
    if (!navigator.clipboard?.read) {
      this._clipboardHasImage = false;
      return;
    }
    let hasImage = false;
    try {
      const items = await navigator.clipboard.read();
      hasImage = items.some(item => item.types?.some(t => t.startsWith('image/')));
    } catch (err) {
      // Permission denied / no clipboard access → giả định không có image (tránh false positive)
      hasImage = false;
    }
    this._clipboardHasImage = hasImage;

    // Template mode: skip inject — paste image bị block (xem `_handlePastedImages` guard).
    if (this.isTemplateMode) return;

    // Inject paste-image menu item nếu probe finished AFTER menu rendered (race common case).
    // Menu vẫn open + chưa có paste-image → tìm vị trí sau paste-node (hoặc sau add-node) → insert.
    if (hasImage && this._canvasContextMenu && !this._canvasContextMenu.querySelector('[data-action="paste-image"]')) {
      try { this._injectPasteImageMenuItem(); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Dynamically inject paste-image menu item vào canvas context menu hiện tại
   * (sau khi async clipboard probe xác định có image).
   */
  _injectPasteImageMenuItem() {
    const menu = this._canvasContextMenu;
    if (!menu) return;
    const t = (key, fallback) => window.I18n?.t?.(key) || fallback;
    const label = t('workflow.pasteImageMenu', 'Dán ảnh (Ctrl+V)');
    const html = `<button type="button" class="df-canvas-context-item" data-action="paste-image">
      <span class="df-canvas-context-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></span>
      <span class="df-canvas-context-label">${label}</span>
    </button>`;
    // Insert sau paste-node nếu có, else sau add-node
    const refItem = menu.querySelector('[data-action="paste-node"]')
      || menu.querySelector('[data-action="add-node"]');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const newBtn = wrapper.firstElementChild;
    if (refItem && refItem.nextSibling) {
      refItem.parentNode.insertBefore(newBtn, refItem.nextSibling);
    } else if (refItem) {
      refItem.parentNode.appendChild(newBtn);
    } else {
      menu.insertBefore(newBtn, menu.firstChild);
    }
  }

  /**
   * Handle Ctrl+Z — restore previous snapshot.
   */
  _handleUndo() {
    if (!this.history) return;
    // Read-only mode: không cho undo
    if (this.isReadOnly()) return;
    if (!this.history.canUndo()) {
      window.showNotification?.(
        window.I18n?.t('workflow.undoEmpty') || 'Không có thao tác để hoàn tác',
        'info', 1500
      );
      return;
    }
    const restored = this.history.undo();
    if (restored) {
      window.showNotification?.(
        window.I18n?.t('workflow.undone') || 'Undone',
        'success', 1200
      );
      this._updateUndoRedoButtons();
    }
  }

  /**
   * Handle Ctrl+Shift+Z / Ctrl+Y — restore next snapshot.
   */
  _handleRedo() {
    if (!this.history) return;
    // Read-only mode: không cho redo
    if (this.isReadOnly()) return;
    if (!this.history.canRedo()) {
      window.showNotification?.(
        window.I18n?.t('workflow.redoEmpty') || 'Nothing to redo',
        'info', 1500
      );
      return;
    }
    const restored = this.history.redo();
    if (restored) {
      window.showNotification?.(
        window.I18n?.t('workflow.redone') || 'Redone',
        'success', 1200
      );
      this._updateUndoRedoButtons();
    }
  }

  /**
   * Update enabled/disabled state cho undo/redo buttons trong toolbar.
   * Gọi sau mỗi snapshot / undo / redo.
   */
  _updateUndoRedoButtons() {
    if (!this.overlay) return;
    const undoBtn = this.overlay.querySelector('#wfUndoBtn');
    const redoBtn = this.overlay.querySelector('#wfRedoBtn');
    if (undoBtn) {
      const canUndo = this.history?.canUndo();
      undoBtn.disabled = !canUndo;
      undoBtn.classList.toggle('seosonaflow-wf-tool-btn--disabled', !canUndo);
    }
    if (redoBtn) {
      const canRedo = this.history?.canRedo();
      redoBtn.disabled = !canRedo;
      redoBtn.classList.toggle('seosonaflow-wf-tool-btn--disabled', !canRedo);
    }
  }

  /**
   * Restore workflow từ snapshot data (called by WorkflowHistory).
   * Re-load nodes + edges qua DiagramCanvas + sync this.workflow state.
   */
  _restoreFromHistorySnapshot(snapshot) {
    if (!this.diagramCanvas || !snapshot) return;
    // Snapshot có format giống exportWorkflow output: { nodes, edges, settings, ... }
    const tempWorkflow = {
      ...this.workflow,
      ...snapshot,
      wf_id: this.workflow?.wf_id, // Preserve wf_id
      nodes: snapshot.nodes || [],
      edges: snapshot.edges || [],
    };
    this.workflow = tempWorkflow;

    // Reload diagram
    try {
      this.diagramCanvas.loadWorkflow(tempWorkflow);
    } catch (e) {
      console.error('[WorkflowEditor] Restore loadWorkflow failed:', e);
      return;
    }

    // Re-bind UI hooks sau load (defer 1 frame để DOM ready)
    requestAnimationFrame(() => {
      try { this._restoreNodeStates(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_restoreFromHistorySnapshot', e); }
      try { this._scheduleRefreshNodeWarningBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_restoreFromHistorySnapshot', e); }
      try { this._updatePortEmptyState(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_restoreFromHistorySnapshot', e); }
      try { this._bindEdgeHoverTooltips(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_restoreFromHistorySnapshot', e); }
    });

    // Mark dirty với debounce 1500ms — collapse multiple undo/redo liên tiếp.
    // Lý do: user thường undo nhiều bước rồi redo lại để so sánh, không nên
    // mark dirty + flash save button mỗi lần. Sau 1.5s idle mới flag dirty.
    if (this._undoRedoDirtyTimer) clearTimeout(this._undoRedoDirtyTimer);
    this._undoRedoDirtyTimer = setTimeout(() => {
      this._hasUnsavedChanges = true;
      this._undoRedoDirtyTimer = null;
    }, 1500);
  }

  /**
   * Take initial snapshot khi workflow load xong (baseline cho undo).
   * Gọi sau diagramCanvas.loadWorkflow.
   */
  _takeInitialHistorySnapshot() {
    if (!this.history) return;
    // Defer 2 frames + 100ms để Drawflow finalize DOM + post-load events
    // (workflow:edges_migrated, edge:created qua Drawflow re-render) settle.
    // Reset stack TRƯỚC khi push baseline → loại bỏ snapshot rác phát sinh
    // trong load flow → vừa mở workflow KHÔNG thể undo (đúng UX expected).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          this.history.reset();
          this.history.takeSnapshot('initial');
          this._updateUndoRedoButtons();
        }, 100);
      });
    });
  }
}

// Export
window.WorkflowEditor = WorkflowEditor;
