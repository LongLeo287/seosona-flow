/**
 * DiagramCanvas - Wrapper cho Drawflow library
 */

// K.6 (2026-05-29): Strip tempid 'upload_xxx' khỏi ref_file_ids / frame_X_file_id trước khi
// gửi backend. Race condition: _deferredThumbnailSave (debounce 2s) thường fire TRƯỚC khi
// ImmediateUploader.upload (5-10s Flow page processing) hoàn thành. Nếu upload:completed
// handler không kịp gọi save thứ 2 (executor running, 429, user close) → backend persist
// tempid mãi mãi → load lần sau warning ⚠️ + execution fail addRefImages.
// Strip ở export = hard barrier ngăn corruption.
// 2026-05-31: Loại trừ 'upload_import_' — đây là sentinel template clone (WorkflowTemplateList +
// AdminWorkflowTemplateController). Executor _executeImageNode dùng prefix này để trigger
// reuploadMissingFiles fetch CDN → upload Flow → ID mới. Strip ở đây sẽ làm ref ảnh template
// rỗng → image node "completed" nhưng fileIds=[] → tất cả generate downstream DEP_SKIP.
function _isTempId(id) {
  if (typeof id !== 'string') return false;
  if (id.startsWith('upload_import_')) return false;
  return id.startsWith('upload_');
}
function _stripTempIds(refFileIds) {
  if (typeof refFileIds !== 'string' || !refFileIds) return '';
  return refFileIds
    .split(',')
    .map(s => s.trim())
    .filter(id => id && !_isTempId(id))
    .join(',');
}
function _stripTempIdKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!_isTempId(key)) cleaned[key] = value;
  }
  return cleaned;
}

class DiagramCanvas {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.editor = null;
    this.workflowId = null;
    this.zoom = 1.0; // Default zoom 100% cho create mode
    // EWT-11: Flag để ẩn các UI execution-related trong template mode
    this.isTemplateMode = options.isTemplateMode || false;
    // Preview mode: ẩn hover toolbar và quick action buttons
    this.isReadOnly = options.isReadOnly || false;
    // Admin preview: read-only nhưng cho phép xem chi tiết node
    this.isAdminPreview = options.isAdminPreview || false;
    // SEOSONA edge restore guard: true khi loadWorkflow đang restore edges → guard connection
    // KHÔNG xoá edge đã lưu (addConnection cũng dispatch 'connectionCreated').
    this._restoringEdges = false;

    this.init();
  }

  init() {
    this.render();
    this.initDrawflow();
    this.bindEvents();
    // Apply read-only mode nếu được set từ constructor
    if (this.isReadOnly) {
      this.setReadOnly(true);
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="diagram-container">
        <div class="diagram-canvas">
          <div id="drawflowCanvas"></div>
        </div>
        <div class="canvas-controls">
          <button class="canvas-control-btn" id="zoomInBtn" title="${window.I18n?.t('common.zoomIn') || 'Phóng to'}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="11" y1="8" x2="11" y2="14"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </button>
          <span class="canvas-zoom-level" id="zoomLevel">100%</span>
          <button class="canvas-control-btn" id="zoomOutBtn" title="${window.I18n?.t('common.zoomOut') || 'Thu nhỏ'}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </button>
          <button class="canvas-control-btn" id="resetZoomBtn" title="${window.I18n?.t('common.resetZoom') || 'Reset zoom'}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"></polyline>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
            </svg>
          </button>
        </div>
        <button class="diagram-recenter-btn" id="recenterBtn" title="${window.I18n?.t('workflow.recenter') || 'Căn giữa'}">
          <svg width="15" height="15" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M64,496H184V464H64a16.019,16.019,0,0,1-16-16V328H16V448A48.054,48.054,0,0,0,64,496Z"></path><path fill="currentColor" d="M48,64A16.019,16.019,0,0,1,64,48H184V16H64A48.054,48.054,0,0,0,16,64V184H48Z"></path><path fill="currentColor" d="M448,16H328V48H448a16.019,16.019,0,0,1,16,16V184h32V64A48.054,48.054,0,0,0,448,16Z"></path><path fill="currentColor" d="M464,448a16.019,16.019,0,0,1-16,16H328v32H448a48.054,48.054,0,0,0,48-48V328H464Z"></path><path fill="currentColor" d="M400,256c0-79.4-64.6-144-144-144S112,176.6,112,256s64.6,144,144,144S400,335.4,400,256ZM256,368A112,112,0,1,1,368,256,112.127,112.127,0,0,1,256,368Z"></path></svg>
          <span>${window.I18n?.t('workflow.recenter') || 'Recenter'}</span>
        </button>
        <div class="df-select-box hidden" id="dfSelectBox"></div>
        <div class="workflow-progress hidden" id="workflowProgress">
          <span class="workflow-progress-text" id="progressText">0 / 0</span>
          <div class="workflow-progress-bar">
            <div class="workflow-progress-bar-fill" id="progressFill" style="width: 0%"></div>
          </div>
        </div>
        <div class="canvas-brand-zone">
          <div class="seosonaflow-header-brand">
            <div class="seosonaflow-header-logo">
              <img src="../icons/icon-32.png" alt="SEOSONA Flow">
            </div>
            <span class="seosonaflow-header-title">SEOSONA Flow</span>
            <span class="seosonaflow-user-plan-badge hidden" id="canvasPlanBadge" data-plan="free" title="${window.I18n?.t('settings.planBadgeTooltip') || 'Gói & quota'}">Free</span>
          </div>
        </div>
      </div>
    `;
  }

  initDrawflow() {
    const canvas = this.container.querySelector('#drawflowCanvas');
    if (!canvas || typeof Drawflow === 'undefined') {
      console.error('[DiagramCanvas] Drawflow not loaded');
      return;
    }

    this.editor = new Drawflow(canvas);

    // Configure
    this.editor.reroute = true;
    this.editor.curvature = 0.5;
    this.editor.reroute_curvature_start_end = 0.5;
    this.editor.reroute_curvature = 0.5;
    this.editor.force_first_input = false;
    this.editor.line_path = 5;
    this.editor.editor_mode = 'edit';

    this.editor.start();

    // Set default zoom to 100% cho create mode (empty canvas)
    // Smart zoom (fitToScreen) chỉ apply khi edit workflow có nodes
    this.zoom = 1.0;
    this.editor.zoom = this.zoom;
    this.editor.zoom_refresh();
    this.updateZoomDisplay();

    // Build: minimap (n8n/ComfyUI-style) — tổng quan canvas góc dưới-phải + click để pan.
    try { this._initMinimap(); } catch (e) { console.warn('[DiagramCanvas] minimap init fail:', e?.message); }

    // Register node types
    Object.keys(NodeTemplates.types).forEach(type => {
      this.editor.registerNode(type, {}, () => {}, () => {});
    });
  }

  bindEvents() {
    // Zoom controls
    const zoomInBtn = this.container.querySelector('#zoomInBtn');
    const zoomOutBtn = this.container.querySelector('#zoomOutBtn');
    const resetZoomBtn = this.container.querySelector('#resetZoomBtn');

    zoomInBtn?.addEventListener('click', () => this.zoomIn());
    zoomOutBtn?.addEventListener('click', () => this.zoomOut());
    resetZoomBtn?.addEventListener('click', () => this.resetZoom());
    this.container.querySelector('#recenterBtn')?.addEventListener('click', () => this.recenter());

    // Drawflow events
    if (this.editor) {
      this.editor.on('nodeSelected', (id) => {
        if (window.eventBus) window.eventBus.emit('node:selected', { nodeId: id });
      });

      this.editor.on('nodeUnselected', () => {
        if (window.eventBus) window.eventBus.emit('node:unselected');
      });

      // Phase WK-1.3.3-1.3.6: typed-port validation + auto-coerce + edge color
      this.editor.on('connectionCreated', (connection) => {
        try {
          this._handleConnectionCreated(connection);
        } catch (err) {
          console.error('[DiagramCanvas] connectionCreated error:', err);
        }
      });

      this.editor.on('connectionRemoved', (connection) => {
        // WK-1.7.frame-sync: clear frame_X_source khi edge vào port frame_1/frame_2 bị xóa
        try { this._syncFrameSourceOnDisconnect(connection); } catch (e) {
          console.warn('[DiagramCanvas] frame source disconnect sync failed:', e);
        }
        if (window.eventBus) window.eventBus.emit('edge:removed', { connection });
        // Cập nhật badge required-port khi user bỏ kết nối
        try { this._validateRequiredPorts(); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#bindEvents', e); }
      });

      this.editor.on('nodeRemoved', (id) => {
        if (window.eventBus) window.eventBus.emit('node:removed', { nodeId: id });
      });

      // Fire khi Drawflow tạo xong DOM cho node mới — reliable hook để inject gear icon,
      // bind inline pills, etc. Tránh race condition với rAF.
      this.editor.on('nodeCreated', (id) => {
        if (window.eventBus) window.eventBus.emit('node:created', { drawflowId: String(id) });
      });

      this.editor.on('nodeMoved', (id) => {
        const node = this.editor.getNodeFromId(id);
        if (window.eventBus) window.eventBus.emit('node:moved', { nodeId: id, pos_x: node.pos_x, pos_y: node.pos_y });
      });

      // Track selected connection for deletion
      this._selectedConnection = null;
      this.editor.on('connectionSelected', (id) => {
        this._selectedConnection = id;
        this._showConnectionDeleteBtn(id);
      });
      this.editor.on('connectionUnselected', () => {
        this._selectedConnection = null;
        this._removeConnectionDeleteBtn();
        // Gỡ active visual — right-click add svg.connection.selected (Drawflow không tự xoá).
        try { this.container.querySelectorAll('svg.connection.selected').forEach(s => s.classList.remove('selected')); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#bindEvents', _); }
      });
    }

    // Note frame: resize (8 handle) + group-drag (kéo note = di chuyển node bên trong). Parity web.
    this._initNoteInteractions();

    // Thước đo / căn lề (học Magnific): đường guide đỏ khi kéo node trùng cạnh/tâm node khác.
    // Visual-only (KHÔNG snap ép vị trí) + observational (không preventDefault) → không phá drag Drawflow.
    try { this._initAlignmentGuides(); } catch (e) { console.warn('[DiagramCanvas] alignment guides init failed:', e?.message); }

    // Click on empty canvas → close node form (emit node:unselected)
    // Drawflow doesn't always emit nodeUnselected when clicking empty space
    const drawflowEl = this.container.querySelector('.drawflow');
    if (drawflowEl) {
      drawflowEl.addEventListener('click', (e) => {
        // Only handle clicks directly on canvas background (not on nodes, connections, etc)
        const clickedNode = e.target?.closest?.('.drawflow-node');
        const clickedConnection = e.target?.closest?.('.connection');
        const clickedPoint = e.target?.closest?.('.point');
        // Click KHÔNG trúng connection (canvas trống / node) → bỏ active mọi connection.
        // Right-click add `svg.connection.selected`, left-click add `.main-path.selected` — Drawflow
        // KHÔNG tự xoá khi click ra ngoài → glow kẹt lại. Clear cả 2 + ẩn nút xoá để về ban đầu.
        if (!clickedConnection) {
          try {
            this.container.querySelectorAll('svg.connection.selected, svg.connection .main-path.selected')
              .forEach(el => el.classList.remove('selected'));
          } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#bindEvents', _); }
          if (this._selectedConnection) {
            this._selectedConnection = null;
            try { this._removeConnectionDeleteBtn(); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#bindEvents', _); }
          }
        }
        if (!clickedNode && !clickedConnection && !clickedPoint && window.eventBus) {
          window.eventBus.emit('node:unselected');
        }
      });
    }

    // Multi-select: Shift+drag box-select + Shift+click toggle + drag nhóm node.
    try { this._initMultiSelect(); } catch (e) { console.warn('[DiagramCanvas] multiSelect init failed:', e); }

    // Space + drag (hoặc Pan mode) → pan toàn canvas.
    try { this._initSpacePan(); } catch (e) { console.warn('[DiagramCanvas] spacePan init failed:', e); }

    // Keyboard: Delete/Backspace to remove selected connection
    this._handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete when typing in input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        // Read-only mode: không cho xóa
        if (this.isReadOnly) return;
        if (this._selectedConnection && this.editor) {
          const conn = this._selectedConnection;
          this.editor.removeSingleConnection(conn.output_id, conn.input_id, conn.output_class, conn.input_class);
          this._selectedConnection = null;
          e.preventDefault();
        }
      }
    };
    document.addEventListener('keydown', this._handleKeyDown);

    // === Wheel pan & zoom (Freepik/Figma-style) ===
    // Trackpad pinch (event.ctrlKey=true) → zoom; trackpad 2-finger swipe (ctrlKey=false) → pan canvas.
    // Mouse wheel scroll: deltaY only → zoom in/out (giữ behavior cũ cho mouse user).
    const canvasContainer = this.container.querySelector('.diagram-container') || this.container;
    canvasContainer.addEventListener('wheel', (e) => {
      if (!this.editor) return;
      // Ignore khi đang scroll trong dropdown / input / textarea bên trong canvas
      if (e.target.closest('input, textarea, select, .df-node-inline-dropdown, .seosonaflow-node-picker')) return;
      e.preventDefault();
      e.stopPropagation();

      const isPinch = e.ctrlKey || e.metaKey;
      // Heuristic: deltaX != 0 hoặc trackpad nhỏ (deltaMode=0, |deltaY|<50) → trackpad swipe
      const isTrackpadSwipe = !isPinch && (Math.abs(e.deltaX) > 0 || (e.deltaMode === 0 && Math.abs(e.deltaY) < 50));

      if (isPinch) {
        // Zoom centered on cursor
        const rect = canvasContainer.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const oldZoom = this.zoom || this.editor.zoom || 1;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const newZoom = Math.max(0.1, Math.min(2.0, oldZoom * factor));
        // Giữ điểm dưới cursor cố định: world_x = (cx - canvas_x) / zoom
        // Sau zoom mới: canvas_x' = cx - world_x * newZoom
        const canvasX = (this.editor.canvas_x || 0);
        const canvasY = (this.editor.canvas_y || 0);
        const worldX = (cx - canvasX) / oldZoom;
        const worldY = (cy - canvasY) / oldZoom;
        const newCanvasX = cx - worldX * newZoom;
        const newCanvasY = cy - worldY * newZoom;
        this._applyZoomAndPan(newZoom, newCanvasX, newCanvasY);
      } else if (isTrackpadSwipe || Math.abs(e.deltaX) > 0) {
        // Pan: shift canvas_x/y by negate delta (natural scroll direction)
        const canvasX = (this.editor.canvas_x || 0) - e.deltaX;
        const canvasY = (this.editor.canvas_y || 0) - e.deltaY;
        this._applyZoomAndPan(this.zoom || this.editor.zoom || 1, canvasX, canvasY);
      } else {
        // Mouse wheel (deltaMode=1 or large deltaY) → zoom centered on cursor
        const rect = canvasContainer.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const oldZoom = this.zoom || this.editor.zoom || 1;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const newZoom = Math.max(0.1, Math.min(2.0, oldZoom * factor));
        const canvasX = (this.editor.canvas_x || 0);
        const canvasY = (this.editor.canvas_y || 0);
        const worldX = (cx - canvasX) / oldZoom;
        const worldY = (cy - canvasY) / oldZoom;
        const newCanvasX = cx - worldX * newZoom;
        const newCanvasY = cy - worldY * newZoom;
        this._applyZoomAndPan(newZoom, newCanvasX, newCanvasY);
      }
    }, { passive: false });

    // === Context menu (right-click) ===
    // Trên node → df-hover-toolbar items + Reset
    // Empty area → emit event 'canvas:contextmenu' cho WorkflowEditor render
    //   menu chứa toolbar actions (add-node, run, undo, redo, fit, ...)
    canvasContainer.addEventListener('contextmenu', (e) => {
      // Read-only mode: chặn tất cả context menu
      if (this.isReadOnly) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const nodeEl = e.target.closest('.drawflow-node');
      if (nodeEl) {
        e.preventDefault();
        e.stopPropagation();
        const nodeId = nodeEl.id.replace('node-', '');
        this._showNodeContextMenu(e.clientX, e.clientY, nodeId);
        return;
      }
      // Right-click trên connection path → select + show delete button (parity với left-click).
      // Drawflow internal contextmenu fires NHƯNG chỉ create native `.drawflow-delete` div
      // (đã bị ẩn qua CSS). Cần manually trigger custom button hiển thị.
      const pathEl = e.target.closest('svg.connection .main-path');
      if (pathEl) {
        e.preventDefault();
        e.stopPropagation();
        const svgConn = pathEl.closest('svg.connection');
        if (svgConn) {
          // Resolve connection metadata từ SVG class (Drawflow render `.node_in_node-{id}.node_out_node-{id}.{out_class}.{in_class}`)
          const classes = Array.from(svgConn.classList);
          const inMatch = classes.find(c => c.startsWith('node_in_node-'));
          const outMatch = classes.find(c => c.startsWith('node_out_node-'));
          const outClass = classes.find(c => /^output_\d+$/.test(c));
          const inClass = classes.find(c => /^input_\d+$/.test(c));
          if (inMatch && outMatch && outClass && inClass) {
            const conn = {
              input_id: inMatch.replace('node_in_node-', ''),
              output_id: outMatch.replace('node_out_node-', ''),
              output_class: outClass,
              input_class: inClass,
            };
            // Mark SVG as selected (CSS .selected applies thicker stroke)
            this.container.querySelectorAll('svg.connection.selected').forEach(s => s.classList.remove('selected'));
            svgConn.classList.add('selected');
            this._selectedConnection = conn;
            // Port 1.1.49: right-click → context menu "Xóa kết nối" (chặn menu browser). Left-click
            // vẫn hiện nút delete nổi gần connection (handler riêng ở click listener).
            e.preventDefault();
            e.stopPropagation();
            this._showConnectionContextMenu(e.clientX, e.clientY, conn);
          }
        }
        return;
      }
      // Empty area: chặn default browser menu + emit event cho WorkflowEditor
      e.preventDefault();
      e.stopPropagation();
      // Convert pixel coords → canvas coords for node placement
      const rect = canvasContainer.getBoundingClientRect();
      const zoom = this.zoom || this.editor?.zoom || 1;
      const panX = this.editor?.canvas_x || 0;
      const panY = this.editor?.canvas_y || 0;
      const pixelX = e.clientX - rect.left;
      const pixelY = e.clientY - rect.top;
      window.eventBus?.emit('canvas:contextmenu', {
        clientX: e.clientX,
        clientY: e.clientY,
        canvasX: (pixelX - panX) / zoom,
        canvasY: (pixelY - panY) / zoom,
      });
    });

    // Click outside → close context menu
    // Named bound handler stored on `this` so destroy() can removeEventListener it.
    this._onDocumentClick = this._onDocumentClick || (() => this._hideNodeContextMenu());
    document.addEventListener('click', this._onDocumentClick);

    // Event delegation on canvas for toggle, qty, hover toolbar
    const canvas = this.container.querySelector('#drawflowCanvas');
    if (canvas) {
      canvas.addEventListener('click', (e) => {
        // Read-only mode: block all edit actions
        if (this.isReadOnly) return;

        // Hover toolbar actions + nút Run góc (df-node-run-corner) — delegate to _dispatchNodeAction.
        const hoverBtn = e.target.closest('.df-hover-btn, .df-node-run-corner');
        if (hoverBtn) {
          e.stopPropagation();
          const action = hoverBtn.dataset.action;
          const nodeEl = hoverBtn.closest('.drawflow-node');
          if (!nodeEl) return;
          const nodeId = nodeEl.id.replace('node-', '');
          this._dispatchNodeAction(action, nodeId);
          return;
        }

        // Inline rename: pencil ở header thumbnail-node → edit .df-node-title-text tại chỗ
        const renameBtn = e.target.closest('.df-node-rename-btn');
        if (renameBtn) {
          e.stopPropagation();
          e.preventDefault();
          const nodeEl = renameBtn.closest('.drawflow-node');
          if (nodeEl) this._startNodeRename(nodeEl);
          return;
        }

        // Click vào cả vùng header name → inline rename (không cần bấm pencil). Bắt trên .df-node-header
        // vì thumb node đặt title flex:0 1 auto (chỉ rộng bằng text) → vùng phải sau text vẫn là header.
        // Loại các nút/slug/icon. Bỏ qua khi đang edit (contenteditable).
        const headerZone = e.target.closest('.df-node-header');
        if (headerZone && !this.isReadOnly &&
            !e.target.closest('.df-node-rename-btn, .df-node-toggle, .df-node-slug-badge, .df-node-icon, .df-node-zoom-toggle, .df-node-provider-pill, .df-node-saved-badge, .df-hover-toolbar')) {
          const titleTextEl = headerZone.querySelector('.df-node-title-text');
          if (titleTextEl && titleTextEl.getAttribute('contenteditable') !== 'true') {
            const nodeEl = headerZone.closest('.drawflow-node');
            if (nodeEl) {
              e.stopPropagation();
              e.preventDefault();
              this._startNodeRename(nodeEl);
              return;
            }
          }
        }

        // Zoom node 1.5× (image/generate/chatgpt/grok)
        const zoomBtn = e.target.closest('.df-node-zoom-toggle');
        if (zoomBtn) {
          e.stopPropagation();
          e.preventDefault();
          const nodeEl = zoomBtn.closest('.drawflow-node');
          if (nodeEl) this._toggleNodeZoom(nodeEl);
          return;
        }

        // Toggle enabled/disabled on node
        const toggleBtn = e.target.closest('.df-node-toggle');
        if (!toggleBtn) return;

        e.stopPropagation();
        e.preventDefault();

        const nodeEl = toggleBtn.closest('.drawflow-node');
        if (!nodeEl) return;

        const nodeId = nodeEl.id.replace('node-', '');
        const node = this.editor.getNodeFromId(nodeId);
        if (!node) return;

        const newEnabled = node.data.enabled === false;
        node.data.enabled = newEnabled;
        this.editor.updateNodeDataFromId(nodeId, node.data);

        // Update visual
        const dfNode = nodeEl.querySelector('.df-node');
        if (dfNode) {
          dfNode.classList.toggle('df-node-disabled', !newEnabled);
          dfNode.dataset.enabled = String(newEnabled);
        }
        toggleBtn.classList.toggle('on', newEnabled);
        toggleBtn.classList.toggle('off', !newEnabled);
        toggleBtn.title = newEnabled ? (window.I18n?.t('node.disableNode') || 'Tắt node') : (window.I18n?.t('node.enableNode') || 'Bật node');

        if (window.eventBus) {
          window.eventBus.emit('node:toggled', { nodeId, enabled: newEnabled });
        }
      });

      // Task 5.4: Alt+Click node → insert @slug vào textarea đang focus
      canvas.addEventListener('click', (e) => {
        // Only handle Alt+click
        if (!e.altKey) return;
        // Skip in read-only mode
        if (this.isReadOnly) return;

        const nodeEl = e.target.closest('.drawflow-node');
        if (!nodeEl) return;

        const nodeId = nodeEl.id.replace('node-', '');
        const node = this.editor?.getNodeFromId(nodeId);
        const slug = node?.data?.slug;

        if (!slug) {
          // Node không có slug
          return;
        }

        // Tìm textarea đang focus (prompt textarea trong node form)
        const activeTextarea = document.activeElement;
        if (!activeTextarea || activeTextarea.tagName !== 'TEXTAREA') {
          // Không có textarea focus → copy @slug to clipboard
          const atSlug = `@${slug}`;
          navigator.clipboard?.writeText(atSlug).then(() => {
            console.log(`[DiagramCanvas] Alt+Click: Copied ${atSlug} to clipboard`);
            // Show toast nếu có
            if (window.eventBus) {
              window.eventBus.emit('toast:show', {
                message: window.I18n?.t('workflow.slugCopied', { slug: atSlug }) || `${atSlug} copied`,
                type: 'success'
              });
            }
          });
          return;
        }

        // Insert @slug tại cursor position
        e.preventDefault();
        e.stopPropagation();

        const atSlug = `@${slug} `;
        const cursorPos = activeTextarea.selectionStart;
        const text = activeTextarea.value;
        const newText = text.substring(0, cursorPos) + atSlug + text.substring(cursorPos);
        activeTextarea.value = newText;
        activeTextarea.selectionStart = activeTextarea.selectionEnd = cursorPos + atSlug.length;
        activeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        activeTextarea.focus();

        console.log(`[DiagramCanvas] Alt+Click: Inserted ${atSlug.trim()} at position ${cursorPos}`);
      }, true); // Capture phase để chặn trước các handlers khác
    }
  }

  // Add node to canvas
  // options.skipQuotaCheck = true: bỏ qua kiểm tra giới hạn node (dùng khi loadWorkflow
  //   load existing data — KHÔNG được mất node của user dù plan hiện tại không đủ quota
  //   để add MỚI). Quota chỉ enforce cho user-initiated action (drag palette, paste,
  //   duplicate, import).
  addNode(type, posX = 100, posY = 100, data = {}, options = {}) {
    if (!this.editor) return null;

    // Skip quota check khi load existing → bảo toàn data user
    // (vd downgrade plan: user có 10 node sẵn → load đủ 10, chỉ block thêm node mới)
    if (!options.skipQuotaCheck) {
      // Check node limit
      const exportData = this.editor.export();
      const currentNodeCount = Object.keys(exportData.drawflow?.Home?.data || {}).length;

      // Check node quota (sync vì canAddNode là sync method, data đã được fetch khi mở workflow)
      if (window.featureGate && !window.featureGate.canAddNode(currentNodeCount)) {
        const isLoggedIn = window.authManager?.isLoggedIn();
        if (!isLoggedIn) {
          // Anonymous + plan không cho phép → show login prompt
          window.featureGate.showLoginPrompt(
            window.I18n?.t('node.trialNodeLimit', { limit: window.featureGate.getConfig().workflows_max_node }) ||
            `Bản dùng thử giới hạn tối đa ${window.featureGate.getConfig().workflows_max_node} node mỗi workflow.`
          );
        } else {
          // Logged-in + hết quota → show upgrade dialog
          const quota = window.featureGate.checkQuota('workflows_nodes_max');
          const dialog = window.customDialog || window.CustomDialog;
          if (dialog) {
            dialog.confirm(
              window.I18n?.t('node.nodeQuotaExhausted', { limit: quota.limit }) ||
              `Your plan is limited to ${quota.limit} nodes per workflow. Upgrade to Premium for unlimited nodes.`,
              {
                title: window.I18n?.t('workflow.quotaReached') || 'Limit reached',
                type: 'warning',
                confirmText: window.I18n?.t('common.upgrade') || 'Upgrade',
                cancelText: window.I18n?.t('common.cancel') || 'Cancel'
              }
            ).then((shouldUpgrade) => {
              if (shouldUpgrade) {
                chrome.runtime.sendMessage({ action: 'showUpgradeModal' });
              }
            });
          }
        }
        return null;
      }
    }

    // BUG FIX: Dùng getType() để merge server config, không chỉ local hardcode
    const config = NodeTemplates.getType(type) || NodeTemplates.types.generate;

    // Ensure node_id is always set
    if (!data.node_id) {
      data.node_id = window.IdGenerator ? window.IdGenerator.next('node') : `node_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    }

    // Phase WK-1.3.1+1.3.2: lấy port count thực tế từ getNodePorts + lưu _port_map
    // Legacy types (transform/condition/merge/output) không có ports → fallback config.inputs/outputs
    const ports = (typeof NodeTemplates.getNodePorts === 'function')
      ? NodeTemplates.getNodePorts(type, data)
      : { in: [], out: [] };
    const inputs  = ports.in.length  || (config.inputs  ?? 0);
    const outputs = ports.out.length || (config.outputs ?? 0);

    // Mapping Drawflow class (input_1, output_2, ...) → tên port logic (image_ref, text, ...)
    // Lưu vào node.data để executor + connection handler resolve port name
    const portMap = { ...(data._port_map || {}) };
    ports.in.forEach((p, idx) => { portMap[`input_${idx + 1}`] = p.name; });
    ports.out.forEach((p, idx) => { portMap[`output_${idx + 1}`] = p.name; });
    // Bug fix: Luôn set node_type trong data để đảm bảo type được persist qua save/load
    // Tránh bug node bị mất type khi data.node_type undefined → fallback node.class sai
    const dataWithPortMap = { ...data, _port_map: portMap, node_type: data.node_type || type };

    const html = NodeTemplates.createNodeHTML(type, dataWithPortMap);

    const drawflowId = this.editor.addNode(
      type,
      inputs,
      outputs,
      posX,
      posY,
      type,
      dataWithPortMap,
      html
    );

    if (drawflowId == null) {
      console.error('[DiagramCanvas] addNode failed for', data.node_id);
      return null;
    }

    // Store mapping: drawflow internal ID -> node_id
    if (!this._idMap) this._idMap = new Map();
    this._idMap.set(String(drawflowId), data.node_id);

    // Phase WK-1.2 (bug fix): Inject port type/name/required attributes vào Drawflow native ports
    // Defer 1 frame để Drawflow render xong DOM trước khi query
    requestAnimationFrame(() => {
      try { this._injectPortAttributes(drawflowId, ports); } catch (e) {
        console.warn('[DiagramCanvas] _injectPortAttributes failed:', e.message);
      }
    });

    return drawflowId;
  }

  // Update node data
  updateNodeData(nodeId, data) {
    if (!this.editor) return;

    const node = this.editor.getNodeFromId(nodeId);
    if (node) {
      const mergedData = { ...node.data, ...data };
      this.editor.updateNodeDataFromId(nodeId, mergedData);

      // Update visual
      // Bug fix: Ưu tiên mergedData.node_type (original) over node.class để render đúng node type
      const renderType = mergedData.node_type || node.class;
      const html = NodeTemplates.createNodeHTML(renderType, mergedData);
      this.editor.drawflow.drawflow.Home.data[nodeId].html = html;

      const element = document.querySelector(`#node-${nodeId} .drawflow_content_node`);
      if (element) {
        element.innerHTML = html;
      }
    }
  }

  // Remove node
  removeNode(nodeId) {
    if (!this.editor) return;
    this.editor.removeNodeId(`node-${nodeId}`);
  }

  /**
   * Thước đo / căn lề (smart alignment guides) — vẽ đường đỏ đứt khi kéo 1 node trùng cạnh/tâm
   * (left/center/right, top/middle/bottom) với node khác. Tính bằng screen coords rồi quy về pixel
   * container → không phụ thuộc zoom/pan. Visual-only (không snap), observational (không chặn drag).
   */
  _initAlignmentGuides() {
    const container = this.container;
    if (!container) return;

    let layer = container.querySelector('.wf-align-guides');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'wf-align-guides';
      container.appendChild(layer);
    }

    const THRESH = 6; // px screen — ngưỡng coi là "thẳng hàng" (khớp SNAP để hít đúng chỗ thấy line)

    // mousedown per-container (auto-clean khi container bị bỏ) → set drag state tĩnh dùng chung.
    if (!container._alignMouseDownBound) {
      container._alignMouseDownBound = true;
      container.addEventListener('mousedown', (e) => {
        const nodeEl = e.target?.closest?.('.drawflow-node');
        if (!nodeEl || e.target.closest('.nodrag, .input, .output, .df-note-resize, textarea, input, select, button')) {
          DiagramCanvas._alignDrag = null;
          return;
        }
        DiagramCanvas._alignDrag = { container, layer, dragEl: nodeEl, thresh: THRESH, raf: null, instance: this };
      }, true);
    }

    // Document listeners gắn 1 LẦN cho toàn class (tránh leak khi mở/đóng editor nhiều lần).
    if (!DiagramCanvas._alignDocBound) {
      DiagramCanvas._alignDocBound = true;
      const drawStatic = () => {
        const st = DiagramCanvas._alignDrag;
        if (st) st.raf = null;
        if (!st || !st.dragEl?.isConnected) { if (st) st.layer.textContent = ''; return; }
        const cRect = st.container.getBoundingClientRect();
        const a = st.dragEl.getBoundingClientRect();
        const aX = { left: a.left, center: a.left + a.width / 2, right: a.right };
        const aY = { top: a.top, middle: a.top + a.height / 2, bottom: a.bottom };
        let bestV = null, bestH = null;
        for (const n of st.container.querySelectorAll('.drawflow-node')) {
          if (n === st.dragEl) continue;
          const b = n.getBoundingClientRect();
          const bX = { left: b.left, center: b.left + b.width / 2, right: b.right };
          const bY = { top: b.top, middle: b.top + b.height / 2, bottom: b.bottom };
          for (const ak in aX) for (const bk in bX) {
            const d = Math.abs(aX[ak] - bX[bk]);
            if (d <= st.thresh && (!bestV || d < bestV.d)) {
              bestV = { d, x: bX[bk], top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
            }
          }
          for (const ak in aY) for (const bk in bY) {
            const d = Math.abs(aY[ak] - bY[bk]);
            if (d <= st.thresh && (!bestH || d < bestH.d)) {
              bestH = { d, y: bY[bk], left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) };
            }
          }
        }
        st.layer.textContent = '';
        if (bestV) {
          const el = document.createElement('div');
          el.className = 'wf-align-line wf-align-line-v';
          el.style.left = `${bestV.x - cRect.left}px`;
          el.style.top = `${bestV.top - cRect.top - 24}px`;
          el.style.height = `${(bestV.bottom - bestV.top) + 48}px`;
          st.layer.appendChild(el);
        }
        if (bestH) {
          const el = document.createElement('div');
          el.className = 'wf-align-line wf-align-line-h';
          el.style.top = `${bestH.y - cRect.top}px`;
          el.style.left = `${bestH.left - cRect.left - 24}px`;
          el.style.width = `${(bestH.right - bestH.left) + 48}px`;
          st.layer.appendChild(el);
        }
      };
      document.addEventListener('mousemove', () => {
        const st = DiagramCanvas._alignDrag;
        if (!st) return;
        st.moved = true; // đánh dấu đã kéo thật (phân biệt với click) → chỉ snap khi có kéo
        if (!st.raf) st.raf = requestAnimationFrame(drawStatic);
      });
      document.addEventListener('mouseup', () => {
        const st = DiagramCanvas._alignDrag;
        DiagramCanvas._alignDrag = null;
        if (!st) return;
        if (st.raf) cancelAnimationFrame(st.raf);
        st.layer.textContent = '';
        // Snap (hít): CHỈ khi đã kéo thật. Defer 1 tick để chạy SAU khi drawflow finalize pos cuối cùng
        // (không phụ thuộc thứ tự listener) → ghi đè an toàn về vị trí căn.
        if (st.moved) {
          setTimeout(() => { try { st.instance?._snapNodeOnRelease?.(st); } catch (e) { console.warn('[DiagramCanvas] snap failed:', e?.message); } }, 0);
        }
      });
    }
  }

  /**
   * Snap-on-release: khi thả node gần thẳng hàng (SNAP px) với node khác → dời node về đúng vị trí căn
   * (left/center/right, top/middle/bottom). Dùng API reposition chuẩn của Drawflow (style + pos_x/pos_y
   * + updateConnectionNodes) như multi-drag. Chỉ dời 1 lần khi thả → KHÔNG đánh nhau với drag per-frame.
   */
  _snapNodeOnRelease(st) {
    const dragEl = st?.dragEl;
    if (!dragEl?.isConnected || !this.editor) return;
    const dfId = dragEl.id.replace('node-', '');
    const mod = this.editor.module || 'Home';
    const nd = this.editor.drawflow?.drawflow?.[mod]?.data?.[dfId];
    if (!nd) return;
    const zoom = this.zoom || this.editor.zoom || 1;
    const SNAP = 6; // px screen — bằng ngưỡng vẽ line → hít đúng chỗ đã thấy đường đỏ

    const a = dragEl.getBoundingClientRect();
    const aX = { left: a.left, center: a.left + a.width / 2, right: a.right };
    const aY = { top: a.top, middle: a.top + a.height / 2, bottom: a.bottom };
    let bV = null, bH = null;
    for (const n of st.container.querySelectorAll('.drawflow-node')) {
      if (n === dragEl) continue;
      const b = n.getBoundingClientRect();
      const bX = { left: b.left, center: b.left + b.width / 2, right: b.right };
      const bY = { top: b.top, middle: b.top + b.height / 2, bottom: b.bottom };
      for (const ak in aX) for (const bk in bX) {
        const d = Math.abs(aX[ak] - bX[bk]);
        if (d <= SNAP && (!bV || d < bV.d)) bV = { d, shift: bX[bk] - aX[ak] };
      }
      for (const ak in aY) for (const bk in bY) {
        const d = Math.abs(aY[ak] - bY[bk]);
        if (d <= SNAP && (!bH || d < bH.d)) bH = { d, shift: bY[bk] - aY[ak] };
      }
    }
    if (!bV && !bH) return;
    const dxC = bV ? bV.shift / zoom : 0;
    const dyC = bH ? bH.shift / zoom : 0;
    if (!dxC && !dyC) return;
    const nx = (parseFloat(dragEl.style.left) || nd.pos_x || 0) + dxC;
    const ny = (parseFloat(dragEl.style.top) || nd.pos_y || 0) + dyC;
    dragEl.style.left = nx + 'px';
    dragEl.style.top = ny + 'px';
    nd.pos_x = nx;
    nd.pos_y = ny;
    try { this.editor.updateConnectionNodes(`node-${dfId}`); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_snapNodeOnRelease', _); }
    if (window.eventBus) window.eventBus.emit('node:moved', { nodeId: dfId, pos_x: nx, pos_y: ny });
  }

  /**
   * 2026-06-03: Batch delete multi-selected nodes (Shift+drag zone).
   * Skip 'start' node type (không xóa được). Edges tự cleanup qua drawflow removeNodeId.
   * @param {string[]} nodeIds - mảng drawflow node IDs cần xóa
   * @returns {{deleted: number, skippedStart: number}}
   */
  removeMultipleNodes(nodeIds) {
    if (!this.editor || !Array.isArray(nodeIds) || nodeIds.length === 0) {
      return { deleted: 0, skippedStart: 0 };
    }
    const mod = this.editor.module || 'Home';
    let deleted = 0;
    let skippedStart = 0;
    for (const id of nodeIds) {
      try {
        const nd = this.editor.drawflow?.drawflow?.[mod]?.data?.[id];
        // Protect start node (Drawflow root, không xóa được)
        if (nd?.data?.node_type === 'start' || nd?.class === 'start') {
          skippedStart++;
          continue;
        }
        this.editor.removeNodeId(`node-${id}`);
        deleted++;
      } catch (err) {
        console.warn('[DiagramCanvas] removeMultipleNodes: skip id', id, err?.message);
      }
    }
    // Clear multi-select state + CSS class trên các node còn lại (nếu có)
    try { this._clearMultiSelect(); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#removeMultipleNodes', _); }
    return { deleted, skippedStart };
  }

  // Clear canvas
  clear() {
    if (!this.editor) return;
    // Clear idMap to prevent stale mappings from previous workflow
    if (this._idMap) this._idMap.clear();
    this.editor.clear();
  }

  // Load workflow data
  loadWorkflow(workflow) {
    if (!this.editor) return;

    // Cancel any pending edge operations from previous load
    this._loadCancelToken = (this._loadCancelToken || 0) + 1;
    const currentToken = this._loadCancelToken;

    this.clear();
    this.workflowId = workflow.wf_id;

    // SELF-HEAL (2026-07-14): workflow cũ được clone/lưu bằng build TRƯỚC fix flatten có thể còn
    // shape LỒNG ({id,type,position:{x,y},data:{...}}) trong storage. loadWorkflow đọc field PHẲNG
    // (node_type/pos_x/node_id) → toàn undefined → node biến mất / counter 0. Normalize idempotent
    // ngay tại biên render: node đã phẳng đi qua nguyên vẹn, node lồng được flatten on-read.
    // → workflow hỏng-sẵn tự chạy lại sau reload, KHÔNG cần clone lại. Mirror flatten ở
    // WorkflowTemplateList._copyTemplateToWorkflow + workflow-editor-init.js.
    const _healNode = (n, i) => {
      if (!n || typeof n !== 'object') return n;
      const needsHeal = (n.node_type == null && n.type != null)
        || (n.pos_x == null && n.position && n.position.x != null)
        || (n.node_id == null && n.id != null)
        || (n.data && typeof n.data === 'object' && n.node_name == null && n.data.node_name != null);
      if (!needsHeal) return n;
      return {
        ...(n.data && typeof n.data === 'object' ? n.data : {}),
        ...n,
        node_id: n.node_id || n.id || `node_${this.workflowId || 'wf'}_${i}`,
        node_type: n.node_type || n.type,
        node_name: n.node_name || (n.data && n.data.node_name) || n.name || n.type,
        pos_x: n.pos_x ?? (n.position && n.position.x) ?? 100,
        pos_y: n.pos_y ?? (n.position && n.position.y) ?? 100,
      };
    };
    const _healEdge = (e, i) => {
      if (!e || typeof e !== 'object') return e;
      if (e.source_node_id != null || e.target_node_id != null) return e;
      if (e.source == null && e.target == null) return e;
      return {
        ...e,
        edge_id: e.edge_id || e.id || `edge_${this.workflowId || 'wf'}_${i}`,
        source_node_id: e.source_node_id || e.source,
        target_node_id: e.target_node_id || e.target,
        source_handle: e.source_handle || e.sourceHandle || 'output_1',
        target_handle: e.target_handle || e.targetHandle || 'input_1',
      };
    };
    const nodes = (workflow.nodes || []).map(_healNode);
    const edges = (workflow.edges || []).map(_healEdge);

    // Auto-layout if all nodes have same default position (not saved properly)
    const allSamePos = nodes.length > 1 && nodes.every(n =>
      (n.pos_x ?? 100) === (nodes[0].pos_x ?? 100) && (n.pos_y ?? 100) === (nodes[0].pos_y ?? 100)
    );

    // Add nodes - batch to avoid UI freeze for large workflows
    const nodeIdMap = new Map();
    const BATCH_SIZE = 20; // Process 20 nodes per frame for large workflows

    const addNodesSync = () => {
      // Debug: log all node_ids being loaded
      console.log('[DiagramCanvas] loadWorkflow: Loading nodes with IDs:', nodes.map(n => ({ node_id: n.node_id, node_type: n.node_type, node_name: n.node_name })));

      nodes.forEach((node, index) => {
        let posX = node.pos_x ?? 100;
        let posY = node.pos_y ?? 100;

        // Spread nodes if all stacked at same position
        if (allSamePos) {
          posX = 100 + (index % 3) * 350;
          posY = 100 + Math.floor(index / 3) * 250;
        }

        // skipQuotaCheck: true → bảo toàn data user khi plan downgrade.
        // Vd user có 10 node, downgrade Free (limit 5): load đủ 10 node, KHÔNG truncate.
        // Quota chỉ enforce khi user thêm node mới (drag/paste/duplicate/import).
        // Bug fix: Log warning khi node_type missing để phát hiện data corruption sớm.
        // Fallback 'generate' có thể gây cascade bug (node đổi tên/type sai sau save).
        let nodeType = node.node_type;
        if (!nodeType) {
          console.warn(`[DiagramCanvas] loadWorkflow: Node ${node.node_id} (name: "${node.node_name}") missing node_type, fallback to 'generate'. This may indicate data corruption.`);
          nodeType = 'generate';
        }
        // Bug fix: Đảm bảo node_type được set trong data để tránh mất type sau save
        // Nếu node.node_type bị undefined, set lại để các thao tác sau dùng đúng type
        const nodeDataWithType = { ...node, node_type: nodeType };
        // 2026-05-25: Normalize required defaults via shared helper (5 rules: media_type,
        // video_input_type, video_duration, use_fallback_prefix, grok_mode).
        // Bắt cùng pattern bug ở duplicateNode + copyNode + pasteNode + load → 1 source of truth.
        try { NodeTemplates.normalizeNodeData?.(nodeDataWithType); } catch (_) { /* ignore */ }
        const drawflowId = this.addNode(
          nodeType,
          posX,
          posY,
          nodeDataWithType,
          { skipQuotaCheck: true }
        );
        nodeIdMap.set(node.node_id, drawflowId);
        console.log(`[DiagramCanvas] loadWorkflow: Added node ${node.node_id} (${nodeType}) as drawflowId=${drawflowId}`);
      });
    };

    // For small workflows (<50 nodes), add synchronously for speed
    // For larger workflows, we still add sync but log a warning
    if (nodes.length > 100) {
      console.warn(`[DiagramCanvas] Large workflow with ${nodes.length} nodes - consider performance impact`);
    }
    addNodesSync();

    // Build: cập nhật minimap sau khi node render vào DOM (offsetWidth/Height sẵn sàng).
    try { requestAnimationFrame(() => requestAnimationFrame(() => { try { this._updateMinimap(); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#addNodesSync', _); } })); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#addNodesSync', _); }

    // Add edges - delay slightly to ensure nodes are rendered in DOM
    // Phase WK-1.6.2: restore connections với port name → class lookup (typed ports)
    // Phase WK-1.6.3: tự động migrate edges cũ không có port info dựa trên node types
    let migratedCount = 0;

    const addEdges = () => {
      // Check if this load operation was cancelled by a newer loadWorkflow call
      if (this._loadCancelToken !== currentToken) {
        console.log('[DiagramCanvas] Edge loading cancelled - newer workflow loading');
        return;
      }

      // SEOSONA edge restore guard: đánh dấu restore quanh addConnection. Drawflow dispatch
      // 'connectionCreated' ĐỒNG BỘ → _handleConnectionCreated đọc _restoringEdges để KHÔNG
      // removeSingleConnection edge đã persisted (nếu không, Save sau đó mất data thật). finally
      // luôn nhả cờ; nếu throw, retry qua rAF sẽ set lại.
      this._restoringEdges = true;
      try {
      edges.forEach(edge => {
        const sourceId = nodeIdMap.get(edge.source_node_id);
        const targetId = nodeIdMap.get(edge.target_node_id);

        if (!sourceId || !targetId) {
          console.warn('[DiagramCanvas] Edge skipped - node not found:', edge.edge_id,
            'source:', edge.source_node_id, '->', sourceId,
            'target:', edge.target_node_id, '->', targetId);
          return;
        }

        // Phase WK-1.6.3: migrate edge cũ — infer port names từ node types nếu thiếu
        const sourceNodeData = nodes.find(n => n.node_id === edge.source_node_id);
        const targetNodeData = nodes.find(n => n.node_id === edge.target_node_id);
        const wasLegacy = !edge.source_port || edge.source_port === 'default'
          || !edge.target_port || edge.target_port === 'default';
        if (wasLegacy) {
          const inferred = this._inferEdgePortsFromLegacy(edge, sourceNodeData, targetNodeData);
          if (inferred && (inferred.source_port !== edge.source_port || inferred.target_port !== edge.target_port)) {
            edge.source_port = inferred.source_port;
            edge.target_port = inferred.target_port;
            if (inferred.source_port && inferred.source_port !== 'default') migratedCount++;
          }
        }

        // Phase WK-1.6.2: resolve port name → Drawflow class qua _port_map reverse lookup
        let outputClass = edge.source_handle || 'output_1';
        let inputClass = edge.target_handle || 'input_1';

        const sourceNode = this.editor.getNodeFromId(sourceId);
        const targetNode = this.editor.getNodeFromId(targetId);
        const sourcePortName = edge.source_port || 'default';
        const targetPortName = edge.target_port || 'default';

        if (sourceNode?.data?._port_map && sourcePortName !== 'default') {
          const entry = Object.entries(sourceNode.data._port_map).find(
            ([k, v]) => v === sourcePortName && k.startsWith('output_')
          );
          if (entry) outputClass = entry[0];
        }
        if (targetNode?.data?._port_map && targetPortName !== 'default') {
          const entry = Object.entries(targetNode.data._port_map).find(
            ([k, v]) => v === targetPortName && k.startsWith('input_')
          );
          if (entry) inputClass = entry[0];
        }

        // Validate port tồn tại trên node trước khi addConnection — tránh Drawflow throw
        // "Cannot read 'connections' of undefined" khi edge cũ ref port không còn tồn tại
        // (vd: node thay đổi mode → port count đổi sau khi edge đã save).
        if (!sourceNode?.outputs?.[outputClass]) {
          console.warn('[DiagramCanvas] Skip edge — source output missing:', edge.edge_id,
            `node=${sourceId}`, `port=${outputClass}`,
            `available=${Object.keys(sourceNode?.outputs || {}).join(',') || '(none)'}`);
          return;
        }
        if (!targetNode?.inputs?.[inputClass]) {
          console.warn('[DiagramCanvas] Skip edge — target input missing:', edge.edge_id,
            `node=${targetId}`, `port=${inputClass}`,
            `available=${Object.keys(targetNode?.inputs || {}).join(',') || '(none)'}`);
          return;
        }

        try {
          this.editor.addConnection(sourceId, targetId, outputClass, inputClass);
        } catch (e) {
          console.warn('[DiagramCanvas] Connection failed:', edge.edge_id, e.message || e);
        }
      });
      } finally {
        this._restoringEdges = false;
      }

      if (migratedCount > 0) {
        console.log(`[DiagramCanvas] Auto-migrated ${migratedCount} legacy edges to typed ports`);
        // Notify WorkflowEditor để mark hasUnsavedChanges → user save sẽ persist port info
        try {
          window.eventBus?.emit('workflow:edges_migrated', { count: migratedCount });
        } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#addEdges', e); }
      }
    };

    // Try immediately, retry after frame if any fail
    try {
      addEdges();
    } catch (e) {
      console.warn('[DiagramCanvas] Retrying edges after frame...');
      requestAnimationFrame(addEdges);
    }

    // WK-1.3.6: re-color saved edges theo source port type
    // WK-1.3.7: validate required ports sau load (defer 1 frame để Drawflow render xong)
    // WK-1.2 (bug fix): re-inject port attributes vào tất cả nodes đã load (Drawflow ports cần data-*)
    requestAnimationFrame(() => {
      try { this._reinjectAllPortAttributes(); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#addEdges', e); }
      try { this._recolorAllEdges(); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#addEdges', e); }
      try { this._validateRequiredPorts(); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#addEdges', e); }

      // CRITICAL fix: Workflow nhiều node bị lệch về phải khi mở vì fitToScreen
      // chạy quá sớm (offsetWidth/Height chưa final, viewport vpW chưa correct).
      // Phải defer tới khi DOM/CSS hoàn toàn settle.
      // Step 1: ngay sau rAF — connections re-route (tránh ghost paths)
      this._forceUpdateAllConnections();
      // Step 2: delay 200ms — fit + center (đợi node DOM render full + viewport stable)
      setTimeout(() => {
        try { this.fitToScreen(); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#addEdges', e); }
        // Re-route connections lần nữa sau khi viewport zoom/pan đã apply
        this._forceUpdateAllConnections();
      }, 200);
      // Step 3: backup fit — đề phòng trường hợp popup window vẫn đang resize
      setTimeout(() => {
        try { this.fitToScreen(); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#addEdges', e); }
        this._forceUpdateAllConnections();
        // Re-apply read-only mode sau khi tất cả nodes đã render
        if (this.isReadOnly) {
          this.setReadOnly(true);
        }
      }, 600);
    });
  }

  /**
   * Bug fix: Connection paths bị lệch ports khi mới load workflow vì Drawflow
   * tính path bằng DOM rect TRƯỚC khi CSS port size/position kịp apply.
   * Force re-update connections để Drawflow query lại DOM rect mới.
   * User di chuyển node thì Drawflow auto-recalculate → paths đúng. Ta force pre-emptively.
   */
  _forceUpdateAllConnections() {
    if (!this.editor) return;
    try {
      const data = this.editor.drawflow?.drawflow?.[this.editor.module || 'Home']?.data || {};
      Object.keys(data).forEach((id) => {
        try { this.editor.updateConnectionNodes(`node-${id}`); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_forceUpdateAllConnections', e); }
      });
    } catch (e) { /* ignore */ }
  }

  /**
   * Phase WK-1.2 (bug fix): Re-inject port attributes cho TẤT CẢ nodes hiện tại.
   * Gọi sau load workflow → Drawflow đã render DOM → query + set data-* attrs.
   */
  _reinjectAllPortAttributes() {
    if (!this.editor) return;
    const data = this.editor.export();
    const nodes = data?.drawflow?.Home?.data || {};
    for (const [drawflowId, nodeInfo] of Object.entries(nodes)) {
      const type = nodeInfo.class;
      const ports = window.NodeTemplates?.getNodePorts?.(type, nodeInfo.data) || { in: [], out: [] };
      this._injectPortAttributes(drawflowId, ports);
    }
  }

  // Phase WK-1.6.3: suy luận port names cho edge cũ (workflow lưu trước WK-1)
  // Logic: nếu edge thiếu source_port/target_port hoặc bằng 'default' → lấy port[0]
  // mỗi side dựa trên node type qua NodeTemplates.getNodePorts.
  // Idempotent: edge đã có port name (port_v2) sẽ skip — re-load nhiều lần không tạo state lặp.
  //
  // Option A (chốt): Edge legacy migrate sang port[0] (image_ref cho generate, etc).
  // KHÔNG smart-migrate vào frame_1/frame_2 dù target là Video+Frames — predictable + giữ hành vi runtime ext cũ.
  _inferEdgePortsFromLegacy(edge, sourceNode, targetNode) {
    if (!edge) return null;
    const hasSourcePort = edge.source_port && edge.source_port !== 'default';
    const hasTargetPort = edge.target_port && edge.target_port !== 'default';
    if (hasSourcePort && hasTargetPort) return null; // đã typed, no-op

    // Issue #69-8 fix: null check sourceNode/targetNode (workflow corrupted hoặc node bị xóa)
    if (!sourceNode || !targetNode) {
      return { source_port: 'default', target_port: 'default' };
    }

    const sourceType = sourceNode?.node_type || sourceNode?.type;
    const targetType = targetNode?.node_type || targetNode?.type;
    const getPorts = (typeof NodeTemplates !== 'undefined' && typeof NodeTemplates.getNodePorts === 'function')
      ? NodeTemplates.getNodePorts.bind(NodeTemplates)
      : null;
    if (!getPorts) return null;

    const sourcePorts = sourceType ? (getPorts(sourceType, sourceNode) || { in: [], out: [] }) : { in: [], out: [] };
    const targetPorts = targetType ? (getPorts(targetType, targetNode) || { in: [], out: [] }) : { in: [], out: [] };

    // Fix audit #4: TÔN TRỌNG source_handle/target_handle (output_N/input_N) khi suy port cho edge
    // legacy. Trước fix: luôn lấy out[0] → node nhiều output (vd condition true/false) bị gộp mọi
    // nhánh về output_1 → clone template condition rẽ nhánh SAI. output_2 → out[1], input_2 → in[1]...
    const _handleIdx = (h) => { const m = /^(?:output|input)_(\d+)$/.exec(String(h || '')); return m ? (parseInt(m[1], 10) - 1) : 0; };
    const sIdx = _handleIdx(edge.source_handle);
    // Source port: dùng handle index nếu hợp lệ, fallback out[0].
    const newSourcePort = hasSourcePort ? edge.source_port
      : ((sourcePorts.out && sourcePorts.out[sIdx] && sourcePorts.out[sIdx].name)
        || sourcePorts.out?.[0]?.name || 'default');

    // Target port: nếu target_handle chỉ rõ input_N (N>0) và node có port đó → dùng luôn; nếu không,
    // match by TYPE (text→text, image→image) thay vì port[0] mặc định.
    // Trước fix: edge từ Prompt (text out) → Grok node infer target_port='image_ref' (in[0])
    // → _collectPortInputs(grok, 'text') không match → prompt từ upstream KHÔNG được dùng.
    let newTargetPort = hasTargetPort ? edge.target_port : null;
    const tIdx = _handleIdx(edge.target_handle);
    if (!newTargetPort && tIdx > 0 && targetPorts.in && targetPorts.in[tIdx]) {
      newTargetPort = targetPorts.in[tIdx].name;
    }
    if (!newTargetPort) {
      const sourcePortObj = sourcePorts.out?.find((p) => p.name === newSourcePort) || sourcePorts.out?.[0];
      const sourceType_ = sourcePortObj?.type;
      if (sourceType_ && targetPorts.in?.length > 0) {
        // Match by type — fallback to port[0] nếu không có type match
        const typeMatched = targetPorts.in.find((p) => p.type === sourceType_);
        newTargetPort = typeMatched?.name || targetPorts.in[0].name;
      } else {
        newTargetPort = targetPorts.in?.[0]?.name || 'default';
      }
    }

    return { source_port: newSourcePort, target_port: newTargetPort };
  }

  /**
   * Phase enhancement (Bug 1 fix): Resize port count runtime khi data đổi (vd: Generate
   * media_type=Image → Video+Frames → cần thêm 2 frame ports).
   *
   * Drawflow API: editor.addNodeInput(drawflowId), editor.removeNodeInput(drawflowId, input_class)
   * Tương tự cho output. Drawflow tự cleanup connections khi remove input/output.
   */
  _resizeNodePorts(drawflowId, newPorts) {
    if (!this.editor || !drawflowId || !newPorts) return;
    const node = this.editor.getNodeFromId(drawflowId);
    if (!node) return;

    const targetIn = (newPorts.in || []).length;
    const targetOut = (newPorts.out || []).length;
    let currentIn = Object.keys(node.inputs || {}).length;
    let currentOut = Object.keys(node.outputs || {}).length;

    // Issue 1 fix: Toggle media_type wipe frame_X_source
    // Drawflow internal removeNodeInput/Output → fire connectionRemoved → _syncFrameSourceOnDisconnect
    // sẽ clear frame_X_source. Spec yêu cầu toggle CHỈ ẩn UI, KHÔNG xóa data.
    // Set flag để disconnect handler skip trong khi resize.
    this._suppressFrameSyncOnResize = true;
    try {
      // Add inputs to match (Drawflow tự render DOM mới)
      while (currentIn < targetIn) {
        this.editor.addNodeInput(drawflowId);
        currentIn++;
      }
      // Remove inputs (cuối → đầu, Drawflow tự cleanup connections)
      while (currentIn > targetIn) {
        this.editor.removeNodeInput(drawflowId, `input_${currentIn}`);
        currentIn--;
      }
      while (currentOut < targetOut) {
        this.editor.addNodeOutput(drawflowId);
        currentOut++;
      }
      while (currentOut > targetOut) {
        this.editor.removeNodeOutput(drawflowId, `output_${currentOut}`);
        currentOut--;
      }

      // Update _port_map với mapping mới (port name → input_X / output_X)
      const portMap = {};
      (newPorts.in || []).forEach((p, idx) => { portMap[`input_${idx + 1}`] = p.name; });
      (newPorts.out || []).forEach((p, idx) => { portMap[`output_${idx + 1}`] = p.name; });
      const newData = { ...(node.data || {}), _port_map: portMap };
      this.editor.updateNodeDataFromId(drawflowId, newData);

      // Drawflow add/removeNodeInput/Output không tự re-render path tọa độ cho các port còn lại.
      // Force update connection cho node vừa resize để edges bám đúng vị trí port mới.
      try { this.editor.updateConnectionNodes(`node-${drawflowId}`); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_resizeNodePorts', e); }
    } catch (err) {
      console.warn('[DiagramCanvas] _resizeNodePorts failed:', err.message);
    } finally {
      // Đảm bảo reset kể cả khi exception
      this._suppressFrameSyncOnResize = false;
    }
  }

  /**
   * Phase WK-1.2 (REFACTORED — bug fix): Inject port type/name/required attributes vào
   * Drawflow native ports để CSS color theo type + tooltip rõ ràng + Drawflow drag/drop work nguyên vẹn.
   *
   * Thay vì overlay rails (bị che native ports → user không kéo edge được), set data-* attributes
   * trực tiếp lên `.input.input_X` / `.output.output_X` element của Drawflow.
   */
  _injectPortAttributes(drawflowId, ports) {
    if (!ports || (!ports.in?.length && !ports.out?.length)) return;
    const nodeEl = document.querySelector(`#node-${drawflowId}`);
    if (!nodeEl) return;

    // SVG icons theo port type (compact 12px, fit trong port 22px) — thiết kế trực quan
    // text:  chữ T in hoa
    // image: khung ảnh + núi
    // video: play triangle trong rounded rect (giống nút Play YouTube — rõ là video)
    // frame: film strip với sprocket holes 2 bên (1 khung cinema)
    // any:   dot solid
    const PORT_ICONS = {
      text:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
      image: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.25 1.5H3.9C3.05992 1.5 2.63988 1.5 2.31901 1.66349C2.03677 1.8073 1.8073 2.03677 1.66349 2.31901C1.5 2.63988 1.5 3.05992 1.5 3.9V8.1C1.5 8.94008 1.5 9.36012 1.66349 9.68099C1.8073 9.96323 2.03677 10.1927 2.31901 10.3365C2.63988 10.5 3.05992 10.5 3.9 10.5H8.5C8.96499 10.5 9.19748 10.5 9.38823 10.4489C9.90587 10.3102 10.3102 9.90587 10.4489 9.38823C10.5 9.19748 10.5 8.96499 10.5 8.5M9.5 4V1M8 2.5H11M5.25 4.25C5.25 4.80228 4.80228 5.25 4.25 5.25C3.69772 5.25 3.25 4.80228 3.25 4.25C3.25 3.69772 3.69772 3.25 4.25 3.25C4.80228 3.25 5.25 3.69772 5.25 4.25ZM7.49502 5.95907L3.26557 9.80402C3.02768 10.0203 2.90873 10.1284 2.89821 10.2221C2.88909 10.3033 2.92023 10.3838 2.98159 10.4378C3.05239 10.5 3.21314 10.5 3.53464 10.5H8.22799C8.94757 10.5 9.30736 10.5 9.58996 10.3791C9.94472 10.2274 10.2274 9.94472 10.3791 9.58996C10.5 9.30736 10.5 8.94757 10.5 8.22799C10.5 7.98587 10.5 7.86482 10.4735 7.75208C10.4403 7.61039 10.3765 7.47768 10.2866 7.3632C10.2151 7.2721 10.1206 7.19647 9.93154 7.04523L8.53291 5.92633C8.34369 5.77495 8.24908 5.69927 8.1449 5.67256C8.05307 5.64901 7.95643 5.65206 7.86627 5.68135C7.76397 5.71457 7.67432 5.79607 7.49502 5.95907Z"/></svg>',
      video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>',
      frame: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3 3h18a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v2h2V5H4zm0 4v2h2V9H4zm0 4v2h2v-2H4zm0 4v2h2v-2H4zm14-12v2h2V5h-2zm0 4v2h2V9h-2zm0 4v2h2v-2h-2zm0 4v2h2v-2h-2zM7 6v12h10V6H7z"/></svg>',
      // frame_1 / frame_2: bracket-style frame indicators (khác nhau cho start/end port)
      frame_1: '<svg viewBox="0 0 11 10" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5L8.9 7.5C9.46005 7.5 9.74008 7.5 9.95399 7.39101C10.1422 7.29513 10.2951 7.14215 10.391 6.95399C10.5 6.74008 10.5 6.46005 10.5 5.9V4.1C10.5 3.53995 10.5 3.25992 10.391 3.04601C10.2951 2.85785 10.1422 2.70487 9.95399 2.60899C9.74008 2.5 9.46005 2.5 8.9 2.5L5 2.5M3 7.5H2.1C1.53995 7.5 1.25992 7.5 1.04601 7.39101C0.857847 7.29513 0.704867 7.14215 0.608994 6.95399C0.5 6.74008 0.5 6.46005 0.5 5.9V4.1C0.5 3.53995 0.5 3.25992 0.608994 3.04601C0.704867 2.85785 0.857847 2.70487 1.04601 2.60899C1.25992 2.5 1.53995 2.5 2.1 2.5H3M3 0.5L3 9.5M1.75 9.5L4.25 9.5M1.75 0.499996L4.25 0.5"/></svg>',
      frame_2: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5H2.6C2.03995 3.5 1.75992 3.5 1.54601 3.60899C1.35785 3.70487 1.20487 3.85785 1.10899 4.04601C1 4.25992 1 4.53995 1 5.1V6.9C1 7.46005 1 7.74008 1.10899 7.95399C1.20487 8.14215 1.35785 8.29513 1.54601 8.39101C1.75992 8.5 2.03995 8.5 2.6 8.5H6.5M8.5 3.5H9.4C9.96005 3.5 10.2401 3.5 10.454 3.60899C10.6422 3.70487 10.7951 3.85785 10.891 4.04601C11 4.25992 11 4.53995 11 5.1V6.9C11 7.46005 11 7.74008 10.891 7.95399C10.7951 8.14215 10.6422 8.29513 10.454 8.39101C10.2401 8.5 9.96005 8.5 9.4 8.5H8.5M8.5 10.5L8.5 1.5M9.75 1.5L7.25 1.5M9.75 10.5L7.25 10.5"/></svg>',
      any:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
    };

    const applyPort = (portEl, port, side) => {
      if (!portEl) return;
      portEl.setAttribute('data-port-type', port.type);
      portEl.setAttribute('data-port-name', port.name);
      portEl.setAttribute('data-port-side', side);
      if (port.required) portEl.setAttribute('data-port-required', 'true');
      // Native browser tooltip (fallback)
      if (port.label) portEl.setAttribute('title', `${port.label} (${port.type})`);

      // Inject SVG icon (Drawflow drag handler bind on parent — child SVG không break drag)
      // frame ports phân biệt theo name (frame_1/frame_2) — icon riêng cho start/end
      let iconKey = (port.type === 'frame' && PORT_ICONS[port.name]) ? port.name : port.type;
      // Port 1.1.58: frame out-port (last frame video) dùng icon bracket frame_2 → phân biệt với media out.
      if (port.type === 'image' && side === 'out' && port.name === 'frame') iconKey = 'frame_2';
      const iconHtml = PORT_ICONS[iconKey] || PORT_ICONS.any;
      // Idempotent + dynamic update: tạo wrap nếu chưa có, REPLACE icon khi key đổi
      // (vd Generate toggle Image→Video → output port type đổi → SVG cần update theo dynamicType)
      let wrap = portEl.querySelector('.df-port-icon');
      if (!wrap) {
        wrap = document.createElement('span');
        wrap.className = 'df-port-icon';
        wrap.style.pointerEvents = 'none'; // không chặn drag
        portEl.appendChild(wrap);
      }
      if (wrap.dataset.iconType !== iconKey) {
        wrap.innerHTML = iconHtml;
        wrap.dataset.iconType = iconKey;
      }

      // Inject custom tooltip label (CSS positioned)
      portEl.setAttribute('data-port-label', port.label || port.name);
    };

    (ports.in || []).forEach((port, idx) => {
      const inputEl = nodeEl.querySelector(`.input.input_${idx + 1}`);
      applyPort(inputEl, port, 'in');
    });

    (ports.out || []).forEach((port, idx) => {
      const outputEl = nodeEl.querySelector(`.output.output_${idx + 1}`);
      applyPort(outputEl, port, 'out');
    });
  }

  // Phase WK-1.3.6: re-color tất cả edges đã load theo source port type
  _recolorAllEdges() {
    if (!this.editor) return;
    const data = this.editor.export();
    const nodes = data?.drawflow?.Home?.data || {};
    for (const [drawflowId, nodeInfo] of Object.entries(nodes)) {
      const outputs = nodeInfo.outputs || {};
      const sourceType = nodeInfo.class;
      const sourcePorts = (typeof NodeTemplates?.getNodePorts === 'function')
        ? NodeTemplates.getNodePorts(sourceType, nodeInfo.data) : { out: [] };
      Object.entries(outputs).forEach(([outputClass, outInfo]) => {
        const portMap = nodeInfo.data?._port_map || {};
        const portName = portMap[outputClass];
        const portInfo = portName ? sourcePorts.out.find(p => p.name === portName) : null;
        if (!portInfo) return;
        (outInfo.connections || []).forEach(conn => {
          this._colorEdgeByType({
            output_id: drawflowId,
            input_id: conn.node,
            output_class: outputClass,
            input_class: conn.output, // Drawflow lưu input_class trong .output (semantics ngược)
          }, portInfo.type);
        });
      });
    }
  }

  // Export workflow data
  exportWorkflow() {
    if (!this.editor) return { nodes: [], edges: [] };

    const data = this.editor.export();
    const homeData = data.drawflow?.Home?.data || {};

    const nodes = [];
    const edges = [];

    Object.entries(homeData).forEach(([id, node]) => {
      const d = node.data || {};
      // Bug fix: Ưu tiên d.node_type over node.class để tránh bug khi node.class bị corrupt.
      // Dùng actualNodeType cho tất cả type-dependent logic trong exportWorkflow.
      const actualNodeType = d.node_type || node.class;
      // Fallback chain cho node_name khi data rỗng:
      //   1. d.node_name (saved value)
      //   2. NodeTemplates.getType(actualNodeType).name — display name merged với server config
      //   3. actualNodeType — last resort (lowercase 'grok' — chỉ khi NodeTemplates miss type)
      // Bug fix: Dùng getType() để lấy name từ server config (admin có thể đổi tên node type)
      const fallbackName = (window.NodeTemplates?.getType?.(actualNodeType)?.name) || actualNodeType;
      // Bug fix: Ưu tiên d.node_type (original data từ backend/storage) over node.class.
      // node.class có thể bị corrupt do fallback 'generate' trong loadWorkflow khi node_type missing.
      // Giữ original node_type để tránh cascade bug (node download → generate → sai tên).
      const nodeData = {
        node_id: d.node_id || `node_${id}`,
        node_type: d.node_type || node.class,
        node_name: d.node_name || fallbackName,
        pos_x: node.pos_x,
        pos_y: node.pos_y,
        prompt: d.prompt || '',
        media_type: d.media_type || 'Image',
        // Strict Server-Only: ModelRegistry server-driven, cache miss → null (caller xử lý).
        // Bug fix 2026-05-27: ChatGPT node dùng model riêng (Instant/Thinking) — KHÔNG fallback flow
        // default ('Nano Banana 2') cho node chatgpt (sai model → pill hiện sai + selectChatGPTModel miss).
        model: d.model || (actualNodeType === 'chatgpt'
          ? (window.ModelRegistry?.safeGetDefault('chatgpt', 'image') || 'Instant')
          : (window.ModelRegistry?.safeGetDefault('flow', 'image') || null)),
        ratio: d.ratio || 'Ngang',
        quantity: d.quantity || 1,
        node_zoom: [1.5, 2].includes(Number(d.node_zoom)) ? Number(d.node_zoom) : 1,
        video_input_type: d.video_input_type || '',
        video_duration: d.video_duration || '',
        // Flow Voice Selector — null nếu không có voice (Random voice / model không support)
        voice_slug: d.voice_slug || null,
        voice_search_value: d.voice_search_value || null,
        // Flow Character Selector — null nếu không chọn / model không support. Bug fix 2026-06-25:
        // serializer bulk-save thiếu 2 field này → character không vào payload → mất khi reopen.
        character_slug: d.character_slug || null,
        character_search_value: d.character_search_value || null,
        // K.6 (2026-05-29): strip tempid 'upload_xxx' khỏi ref_file_ids trước khi gửi backend.
        // Race condition: _deferredThumbnailSave (debounce 2s) thường fire TRƯỚC khi
        // ImmediateUploader.upload (5-10s) hoàn thành → backend persist tempid mãi mãi nếu
        // upload:completed handler không kịp gọi save thứ 2. Strip ở export = hard barrier.
        ref_file_ids: _stripTempIds(d.ref_file_ids),
        frame_1_source: d.frame_1_source || '',
        frame_1_file_id: _isTempId(d.frame_1_file_id) ? '' : (d.frame_1_file_id || ''),
        frame_2_source: d.frame_2_source || '',
        frame_2_file_id: _isTempId(d.frame_2_file_id) ? '' : (d.frame_2_file_id || ''),
        auto_download: d.auto_download || false,
        enabled: d.enabled !== false,
        status: d.status || 'pending',
        result_file_ids: d.result_file_ids || '',
        error_message: d.error_message || '',
        executed_at: d.executed_at || null
      };
      // Download node fields — always include for download nodes to avoid data loss
      if (d.download_folder !== undefined) nodeData.download_folder = d.download_folder;
      if (d.download_file_template !== undefined) nodeData.download_file_template = d.download_file_template;
      if (d.download_resolution !== undefined) nodeData.download_resolution = d.download_resolution;
      if (d.video_download_resolution !== undefined) nodeData.video_download_resolution = d.video_download_resolution;
      if (d.download_collect_all !== undefined) nodeData.download_collect_all = d.download_collect_all;
      // Video frames cross-project metadata — file_name (UUID) + thumbnail (CDN URL)
      // Tương tự pattern ref_file_names + ref_thumbnails: file_id session-specific, file_name persistent.
      if (d.frame_1_file_name) nodeData.frame_1_file_name = d.frame_1_file_name;
      if (d.frame_2_file_name) nodeData.frame_2_file_name = d.frame_2_file_name;
      if (d.frame_1_thumbnail) nodeData.frame_1_thumbnail = d.frame_1_thumbnail;
      if (d.frame_2_thumbnail) nodeData.frame_2_thumbnail = d.frame_2_thumbnail;
      // Only include new fields when they have values
      if (d.prompts_json?.length) nodeData.prompts_json = d.prompts_json;
      if (d.delay_seconds !== undefined) nodeData.delay_seconds = d.delay_seconds;
      if (d.note_text) nodeData.note_text = d.note_text;
      // Note frame fields — thiếu → resize width/height + màu/cỡ chữ KHÔNG lưu khi save.
      if (d.note_color) nodeData.note_color = d.note_color;
      if (d.note_font_size !== undefined && d.note_font_size !== null) nodeData.note_font_size = d.note_font_size;
      if (d.note_width !== undefined && d.note_width !== null) nodeData.note_width = d.note_width;
      if (d.note_height !== undefined && d.note_height !== null) nodeData.note_height = d.note_height;
      if (d.result_thumbnails) nodeData.result_thumbnails = d.result_thumbnails;
      if (d.result_file_names) nodeData.result_file_names = d.result_file_names;
      // Bug fix: CHỈ export ref_thumbnails/ref_file_names khi ref_file_ids có giá trị.
      // Trước: user xóa ref_file_ids → ref_thumbnails/ref_file_names vẫn được export →
      // WorkflowExecutor Smart Clone reconstruct ref_file_ids từ chúng → ref ảnh cũ bị dùng lại.
      // Bug fix 2: Khi ref_file_ids rỗng, GỬI {} (empty object) để backend xóa dữ liệu cũ.
      // Nếu chỉ omit field, backend có thể giữ lại giá trị cũ.
      // K.6 (2026-05-29): hasRefFileIds dùng giá trị ĐÃ STRIP tempid (nodeData.ref_file_ids)
      // KHÔNG phải d.ref_file_ids gốc — nếu pure tempid bị strip thành '' thì thumbnails/names = {}.
      const hasRefFileIds = (nodeData.ref_file_ids || '').trim().length > 0;
      if (hasRefFileIds) {
        // Strip orphan keys 'upload_xxx' khỏi thumbnails/file_names (đồng bộ với ref_file_ids strip).
        if (d.ref_thumbnails) nodeData.ref_thumbnails = _stripTempIdKeys(d.ref_thumbnails);
        if (d.ref_file_names) nodeData.ref_file_names = _stripTempIdKeys(d.ref_file_names);
      } else {
        // Explicitly clear to tell backend to delete old values
        nodeData.ref_thumbnails = {};
        nodeData.ref_file_names = {};
      }
      // Dual URL — URL provider gốc (Grok/ChatGPT) cho manual download chất lượng 100%
      if (d.result_provider_urls) nodeData.result_provider_urls = d.result_provider_urls;
      // Telegram node — chỉ export telegram fields cho 'telegram' type (tránh leak vào image/generate)
      // Bug fix: Dùng actualNodeType thay vì node.class để đảm bảo export đúng fields khi node.class bị corrupt
      if (actualNodeType === 'telegram') {
        nodeData.telegram_chat_id = d.telegram_chat_id || '';
        nodeData.telegram_send_mode = d.telegram_send_mode || 'single';
        nodeData.telegram_message = d.telegram_message || '';
      }
      // Phase CG/G — Provider routing + ChatGPT/Grok/Prompt node fields.
      // Force runtime config defaults theo actualNodeType cho legacy nodes (tạo trước khi defaults
      // được implement → data trong storage có thể thiếu provider/grok_mode/etc dù user save nhiều lần).
      if (actualNodeType === 'grok') {
        nodeData.provider = d.provider || 'grok';
        nodeData.grok_mode = d.grok_mode || 'image';
        nodeData.grok_duration = d.grok_duration || '6s';
        nodeData.grok_resolution = d.grok_resolution || '720p';
        if (d.grok_image_quality) nodeData.grok_image_quality = d.grok_image_quality;
      } else if (actualNodeType === 'chatgpt') {
        nodeData.provider = d.provider || 'chatgpt';
        if (d.use_fallback_prefix) nodeData.use_fallback_prefix = d.use_fallback_prefix;
      } else if (actualNodeType === 'prompt') {
        // AI Agent rename (2026-05-30) — extension v1.1.6+ chỉ ghi keys mới (use_ai/ai_fallback/ai_delete_after_run).
        // Backend Node observer mirror sang legacy fields cho v1.1.3 backward compat.
        // BUG FIX 2026-05-30: trước đây thiếu export delete_after_enhance → setting reset sau reload.
        if (d.use_ai !== undefined) nodeData.use_ai = d.use_ai;
        if (d.use_ai && d.provider) nodeData.provider = d.provider;
        if (d.timeout_sec) nodeData.timeout_sec = d.timeout_sec;
        if (d.ai_fallback !== undefined) nodeData.ai_fallback = d.ai_fallback;
        if (d.ai_delete_after_run !== undefined) nodeData.ai_delete_after_run = d.ai_delete_after_run;
      } else if (actualNodeType === 'text_extract') {
        // Text Extract Node (2026-05-29): pure regex/JSON parse — export 6 extract_* fields.
        nodeData.extract_mode = d.extract_mode || 'marker';
        if (d.extract_marker) nodeData.extract_marker = d.extract_marker;
        if (d.extract_regex) nodeData.extract_regex = d.extract_regex;
        nodeData.extract_strict = d.extract_strict === true;
        nodeData.extract_multi_match = d.extract_multi_match || 'first';
        nodeData.extract_on_fail = d.extract_on_fail || 'skip_downstream';
      } else {
        // Generate / etc — preserve provider nếu user explicit set
        if (d.provider) nodeData.provider = d.provider;
      }
      if (d.prompt_source) nodeData.prompt_source = d.prompt_source;
      if (d.multi_prompt !== undefined) nodeData.multi_prompt = d.multi_prompt;
      if (d.timeout_ms) nodeData.timeout_ms = d.timeout_ms;
      if (d.max_ref_images) nodeData.max_ref_images = d.max_ref_images;
      // Phase 2 — Node Reference System: slug + mention modes
      if (d.slug) nodeData.slug = d.slug;
      if (d.slug_auto !== undefined) nodeData.slug_auto = d.slug_auto;
      // Bug fix: Export 'all' mode too - user may explicit set 'all' to override auto-detect
      if (d.prompt_mode) nodeData.prompt_mode = d.prompt_mode;
      if (d.ref_mode) nodeData.ref_mode = d.ref_mode;
      if (actualNodeType === 'chatgpt' || actualNodeType === 'grok') {
        console.log('[DiagramCanvas] exportWorkflow mention modes:', 'node_id=' + nodeData.node_id, 'type=' + actualNodeType, 'd.prompt_mode=' + (d.prompt_mode || 'undefined'), 'd.ref_mode=' + (d.ref_mode || 'undefined'), 'exported_prompt_mode=' + (nodeData.prompt_mode || 'none'), 'exported_ref_mode=' + (nodeData.ref_mode || 'none'));
      }
      // GAP FIX: Export result_text, result_source cho prompt/text_extract node text output.
      // 2026-05-31: dùng `!== undefined` thay vì truthy check — cho phép export empty string
      // (reset workflow clear result_text='' phải sync về backend, không skip silent).
      if (d.result_text !== undefined) nodeData.result_text = d.result_text || null;
      if (d.result_source !== undefined) nodeData.result_source = d.result_source || null;
      // EWT-12: Template result preview image
      if (d.result_img_url) nodeData.result_img_url = d.result_img_url;
      // EWT-9.4 FIX: Export ref_img_urls cho template mode (image/chatgpt/grok/prompt nodes)
      if (d.ref_img_urls?.length) {
        nodeData.ref_img_urls = d.ref_img_urls;
        console.log('[DiagramCanvas] exportWorkflow - node has ref_img_urls:', nodeData.node_id, d.ref_img_urls);
      }
      nodes.push(nodeData);

      // Extract edges from outputs
      Object.entries(node.outputs || {}).forEach(([outputKey, output]) => {
        (output.connections || []).forEach(conn => {
          const targetNode = homeData[conn.node];
          // Phase WK-1.3.5: resolve port names từ _port_map của 2 đầu node
          const sourcePort = node.data?._port_map?.[outputKey] || null;
          const targetPort = targetNode?.data?._port_map?.[conn.output] || null;
          edges.push({
            // Bug fix (data loss): include port info để multi-port edges giữa cùng 2 nodes
            // không bị overwrite. Trước fix: format `edge_${sourceId}_${targetId}` → 2 edges
            // cùng (source, target) khác port → backend updateOrCreate upsert 1 record → MẤT edge thứ 2.
            edge_id: `edge_${id}_${outputKey}_${conn.node}_${conn.output}`,
            source_node_id: node.data?.node_id || `node_${id}`,
            source_handle: outputKey,
            source_port: sourcePort,
            target_node_id: targetNode?.data?.node_id || `node_${conn.node}`,
            target_handle: conn.output,
            target_port: targetPort,
            data_type: 'image'
          });
        });
      });
    });

    return { nodes, edges };
  }

  // Zoom functions
  zoomIn() {
    if (!this.editor) return;
    this.zoom = Math.min(this.zoom + 0.1, 2);
    this.editor.zoom = this.zoom;
    this.editor.zoom_refresh();
    this.updateZoomDisplay();
  }

  zoomOut() {
    if (!this.editor) return;
    this.zoom = Math.max(this.zoom - 0.1, 0.1);
    this.editor.zoom = this.zoom;
    this.editor.zoom_refresh();
    this.updateZoomDisplay();
  }

  resetZoom() {
    if (!this.editor) return;
    this.zoom = 1;
    this.editor.zoom = this.zoom;
    this.editor.zoom_refresh();
    this.updateZoomDisplay();
  }

  // Recenter: fit + center toàn bộ node vào viewport (tái dùng fitToScreen).
  recenter() {
    if (!this.editor) return;
    try { this.fitToScreen(); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#recenter', e); }
    try { this._forceUpdateAllConnections(); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#recenter', e); }
  }

  // ════════════════════════════════════════════════════════════════
  // Pan mode (nút bàn tay toolbar): giữ để kéo pan ở bất kỳ đâu, không drag node.
  setHandMode(on) {
    this._handMode = !!on;
    if (this.container) this.container.classList.toggle('wf-hand-mode', this._handMode);
  }

  // Space + drag → pan toàn diagram. Giữ Space (con trỏ grab) rồi kéo ở BẤT KỲ đâu (kể cả trên node)
  // → dời canvas (không drag node/connect/select). Chặn Drawflow bằng capture-phase mousedown.
  _initSpacePan() {
    if (this._spacePanBound || !this.container) return;
    this._spacePanBound = true;
    this._spaceDown = false;
    this._spacePan = null;

    const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

    const onMove = (e) => {
      if (!this._spacePan) return;
      const p = this._spacePan;
      const nx = p.cx + (e.clientX - p.mx);
      const ny = p.cy + (e.clientY - p.my);
      this._applyZoomAndPan(this.zoom || this.editor?.zoom || 1, nx, ny);
    };
    const endPan = () => {
      if (this._spacePan) {
        this._spacePan = null;
        this.container.classList.remove('wf-space-panning');
      }
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', endPan, true);
    };
    this._endSpacePan = endPan;

    const onKeyDown = (e) => {
      if (e.code !== 'Space') return;
      if (this.isReadOnly || isTyping(e.target)) return;
      if (!this.container.offsetParent) return; // editor đang ẩn → không chặn Space
      if (!this._spaceDown) {
        this._spaceDown = true;
        this.container.classList.add('wf-space-pan');
      }
      e.preventDefault(); // chặn trang scroll khi giữ Space
    };
    const onKeyUp = (e) => {
      if (e.code !== 'Space') return;
      this._spaceDown = false;
      this.container.classList.remove('wf-space-pan');
      endPan();
    };
    const onMouseDown = (e) => {
      // Pan khi: giữ Space (tạm thời) HOẶC đang ở Pan mode (nút bàn tay toolbar).
      if (!(this._spaceDown || this._handMode) || e.button !== 0) return;
      if (this.isReadOnly || !this.container.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation(); // chặn Drawflow node drag / connection / select
      this.container.classList.add('wf-space-panning');
      this._spacePan = { mx: e.clientX, my: e.clientY, cx: this.editor?.canvas_x || 0, cy: this.editor?.canvas_y || 0 };
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', endPan, true);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    this.container.addEventListener('mousedown', onMouseDown, true); // capture → fire trước Drawflow
    this._spacePanCleanup = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      this.container.removeEventListener('mousedown', onMouseDown, true);
    };
  }

  // Multi-select (2026-05-27): Shift+drag box-select / Shift+click toggle / drag nhóm node
  // ════════════════════════════════════════════════════════════════
  _initMultiSelect() {
    this._multiSelected = new Set();
    // Bind trên this.container (#diagramContainer) — chắc chắn nhận MỌI mousedown vùng canvas
    // (capture, trước bubble drawflow → chặn pan). Trước đây bind #drawflowCanvas/.drawflow có thể
    // MISS vì precanvas transformed / parent-drawflow.
    if (!this.container) { console.warn('[DiagramCanvas] multiSelect init SKIP — no container'); return; }
    // Box select: lấy từ render, tạo mới nếu thiếu. Đặt trong document.body (position:fixed không bị
    // lệch bởi ancestor transform của canvas/zoom).
    let box = this.container.querySelector('#dfSelectBox') || document.getElementById('dfSelectBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'dfSelectBox';
      box.className = 'df-select-box hidden';
    }
    try { document.body.appendChild(box); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_initMultiSelect', e); }
    this._selectBoxEl = box;
    console.log('[DiagramCanvas] multiSelect init OK (Shift/Cmd + kéo nền canvas để chọn vùng)');

    // Box-select move/up dùng viewport coords (box = position:fixed) → không cần offset math.
    this._onBoxMove = (e) => {
      const sb = this._selectBox;
      if (!sb) return;
      const x = Math.min(sb.startX, e.clientX), y = Math.min(sb.startY, e.clientY);
      box.style.left = x + 'px';
      box.style.top = y + 'px';
      box.style.width = Math.abs(e.clientX - sb.startX) + 'px';
      box.style.height = Math.abs(e.clientY - sb.startY) + 'px';
    };
    this._onBoxUp = (e) => {
      document.removeEventListener('mousemove', this._onBoxMove, true);
      document.removeEventListener('mouseup', this._onBoxUp, true);
      const sb = this._selectBox;
      this._selectBox = null;
      box.classList.add('hidden');
      if (!sb) return;
      const sel = {
        left: Math.min(sb.startX, e.clientX), top: Math.min(sb.startY, e.clientY),
        right: Math.max(sb.startX, e.clientX), bottom: Math.max(sb.startY, e.clientY),
      };
      // Drag quá nhỏ → coi như click nền → clear
      if (sel.right - sel.left < 5 && sel.bottom - sel.top < 5) { this._clearMultiSelect(); return; }
      this._clearMultiSelect();
      this.container.querySelectorAll('.drawflow-node').forEach((nodeEl) => {
        const r = nodeEl.getBoundingClientRect();
        const hit = !(r.right < sel.left || r.left > sel.right || r.bottom < sel.top || r.top > sel.bottom);
        if (hit) {
          this._multiSelected.add(nodeEl.id.replace('node-', ''));
          nodeEl.classList.add('df-multi-selected');
        }
      });
    };

    // Drag nhóm: mirror delta chuột / zoom sang các node selected khác (drawflow tự kéo node grabbed).
    this._onMultiDragMove = (e) => {
      const md = this._multiDrag;
      if (!md) return;
      const zoom = this.zoom || this.editor?.zoom || 1;
      const dx = (e.clientX - md.mouseStartX) / zoom;
      const dy = (e.clientY - md.mouseStartY) / zoom;
      md.starts.forEach((s, id) => {
        if (id === md.grabbedId) return;
        s.el.style.left = (s.left + dx) + 'px';
        s.el.style.top = (s.top + dy) + 'px';
        try { this.editor.updateConnectionNodes(`node-${id}`); } catch (err) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_onMultiDragMove', err); }
      });
    };
    this._onMultiDragUp = () => {
      document.removeEventListener('mousemove', this._onMultiDragMove, true);
      document.removeEventListener('mouseup', this._onMultiDragUp, true);
      const md = this._multiDrag;
      this._multiDrag = null;
      if (!md) return;
      const mod = this.editor.module || 'Home';
      md.starts.forEach((s, id) => {
        if (id === md.grabbedId) return; // drawflow đã persist + emit nodeMoved cho grabbed
        const left = parseFloat(s.el.style.left) || 0;
        const top = parseFloat(s.el.style.top) || 0;
        try {
          const nd = this.editor.drawflow?.drawflow?.[mod]?.data?.[id];
          if (nd) { nd.pos_x = left; nd.pos_y = top; }
        } catch (err) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_onMultiDragUp', err); }
        try { this.editor.updateConnectionNodes(`node-${id}`); } catch (err) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_onMultiDragUp', err); }
        if (window.eventBus) window.eventBus.emit('node:moved', { nodeId: id, pos_x: left, pos_y: top });
      });
    };

    // Mousedown trên DOCUMENT (capture) — fire trước MỌI listener (kể cả drawflow bubble) → chặn pan
    // chắc chắn + không bị element trung gian nuốt event. Guard: chỉ xử lý trong vùng canvas editor này.
    // Named bound handler stored on `this` so destroy() can removeEventListener it.
    this._onDocumentMouseDown = (e) => {
      if (e.button !== 0) return;
      if (this.isReadOnly) return;
      if (!this.container || !this.container.contains(e.target)) return;
      const nodeEl = e.target?.closest?.('.drawflow-node');
      // Bỏ qua khi click trên controls nổi (toolbar/zoom/legend/recenter/settings-bar/hover-toolbar).
      const onControl = e.target?.closest?.('.seosonaflow-wf-toolbar, .canvas-controls, .wf-port-legend, .diagram-recenter-btn, .df-node-settings-bar, .df-hover-toolbar, .canvas-brand-zone, .node-form-panel');
      // Shift (mọi OS) HOẶC Cmd/⌘ (macOS metaKey) → multi-select / box-select.
      if (e.shiftKey || e.metaKey) {
        if (onControl) return;
        e.preventDefault();
        e.stopPropagation(); // chặn drawflow pan/drag/select khi giữ phím modifier
        if (nodeEl) { this._toggleNodeSelect(nodeEl); return; }
        // Shift + nền → bắt đầu box-select (viewport coords)
        this._selectBox = { startX: e.clientX, startY: e.clientY };
        box.style.left = e.clientX + 'px';
        box.style.top = e.clientY + 'px';
        box.style.width = '0px';
        box.style.height = '0px';
        box.classList.remove('hidden');
        document.addEventListener('mousemove', this._onBoxMove, true);
        document.addEventListener('mouseup', this._onBoxUp, true);
        return;
      }
      // Không Shift
      if (nodeEl) {
        const id = nodeEl.id.replace('node-', '');
        if (this._multiSelected.size > 1 && this._multiSelected.has(id)) {
          this._startMultiDrag(e, nodeEl); // kéo cả nhóm (KHÔNG stopPropagation → drawflow kéo node grabbed)
        } else if (this._multiSelected.size > 0 && !this._multiSelected.has(id)) {
          this._clearMultiSelect();
        }
      } else if (this._multiSelected.size > 0) {
        this._clearMultiSelect();
      }
    };
    document.addEventListener('mousedown', this._onDocumentMouseDown, true);
  }

  _toggleNodeSelect(nodeEl) {
    const id = nodeEl.id.replace('node-', '');
    if (this._multiSelected.has(id)) { this._multiSelected.delete(id); nodeEl.classList.remove('df-multi-selected'); }
    else { this._multiSelected.add(id); nodeEl.classList.add('df-multi-selected'); }
  }

  _clearMultiSelect() {
    if (!this._multiSelected) return;
    this._multiSelected.forEach((id) => {
      this.container.querySelector(`#node-${id}`)?.classList.remove('df-multi-selected');
    });
    this._multiSelected.clear();
  }

  _startMultiDrag(e, grabbedEl) {
    const grabbedId = grabbedEl.id.replace('node-', '');
    const starts = new Map();
    this._multiSelected.forEach((id) => {
      const el = this.container.querySelector(`#node-${id}`);
      if (el) starts.set(id, { el, left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0 });
    });
    this._multiDrag = { grabbedId, starts, mouseStartX: e.clientX, mouseStartY: e.clientY };
    document.addEventListener('mousemove', this._onMultiDragMove, true);
    document.addEventListener('mouseup', this._onMultiDragUp, true);
  }

  updateZoomDisplay() {
    const zoomLevel = this.container.querySelector('#zoomLevel');
    if (zoomLevel) {
      zoomLevel.textContent = `${Math.round(this.zoom * 100)}%`;
    }
    // Port 1.1.49: expose zoom cho CSS → hover-toolbar counter-scale (1/zoom) giữ kích thước cố định,
    // không phóng/thu theo diagram (to xấu khi zoom in, nhỏ khó bấm khi zoom out).
    try { this.container.style.setProperty('--wf-zoom', String(this.zoom || 1)); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#updateZoomDisplay', _); }
    try { this._updateMinimap(); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#updateZoomDisplay', _); }
  }

  // ===== Build: MINIMAP (n8n/ComfyUI-style) =====
  // Canvas overview góc dưới-phải: vẽ mọi node thu nhỏ + khung viewport hiện tại. Click/kéo → pan tới.
  // Tự-chứa, không đụng executor. Update từ updateZoomDisplay + node:moved + loadWorkflow.
  _initMinimap() {
    if (this._minimapCanvas || !this.container) return;
    const MW = 200, MH = 140;
    const cv = document.createElement('canvas');
    cv.className = 'df-minimap';
    cv.width = MW; cv.height = MH;
    this.container.appendChild(cv);
    this._minimapCanvas = cv;
    this._minimapW = MW; this._minimapH = MH;
    this._minimapTransform = null; // {scale, ox, oy} set khi vẽ → dùng cho click→world

    const panTo = (ev) => {
      const t = this._minimapTransform;
      if (!t || !this.editor) return;
      const r = cv.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      // minimap → world: world = (m - o) / scale
      const worldX = (mx - t.ox) / t.scale;
      const worldY = (my - t.oy) / t.scale;
      // center viewport tại (worldX, worldY): canvas_x = -worldX*zoom + containerW/2
      const z = this.zoom || this.editor.zoom || 1;
      const cw = this.container.clientWidth, ch = this.container.clientHeight;
      this._applyZoomAndPan(z, -worldX * z + cw / 2, -worldY * z + ch / 2);
    };
    cv.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); this._minimapDragging = true;
      try { cv.setPointerCapture(e.pointerId); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#panTo', _); }
      panTo(e);
    });
    cv.addEventListener('pointermove', (e) => { if (this._minimapDragging) { e.stopPropagation(); panTo(e); } });
    const endDrag = (e) => { this._minimapDragging = false; try { cv.releasePointerCapture(e.pointerId); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#endDrag', _); } };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    // Update khi node di chuyển (kéo). Fix audit #2: eventBus là singleton toàn cục sống lâu hơn
    // instance này → phải LƯU hàm unsubscribe + gọi trong destroy(), nếu không mỗi lần mở/đóng editor
    // hay template-preview sẽ rò 1 listener + pin cả DiagramCanvas cũ (leak tích luỹ).
    if (window.eventBus && !this._minimapOffMoved) {
      this._minimapOffMoved = window.eventBus.on('node:moved', () => { try { this._updateMinimap(); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#endDrag', _); } });
    }
    this._updateMinimap();
  }

  _updateMinimap() {
    const cv = this._minimapCanvas;
    if (!cv || !this.editor?.drawflow?.drawflow?.Home?.data) return;
    const ctx = cv.getContext('2d');
    const MW = this._minimapW, MH = this._minimapH, PAD = 10;
    ctx.clearRect(0, 0, MW, MH);
    const data = this.editor.drawflow.drawflow.Home.data;
    const ids = Object.keys(data);
    if (!ids.length) { cv.style.display = 'none'; return; }
    cv.style.display = '';
    // Bounding box world của mọi node (kèm size từ DOM, fallback default)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const rects = [];
    for (const id of ids) {
      const n = data[id];
      const x = Number(n.pos_x) || 0, y = Number(n.pos_y) || 0;
      const el = document.querySelector(`#node-${id}`);
      const w = el ? el.offsetWidth : 200, h = el ? el.offsetHeight : 110;
      const isNote = !!el?.querySelector('.df-node-note-frame');
      rects.push({ x, y, w, h, isNote, status: n.data?.status });
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    }
    // include viewport để luôn thấy khung ngay cả khi pan ra ngoài cụm node
    const z = this.zoom || this.editor.zoom || 1;
    const vpX = -(this.editor.canvas_x || 0) / z, vpY = -(this.editor.canvas_y || 0) / z;
    const vpW = this.container.clientWidth / z, vpH = this.container.clientHeight / z;
    minX = Math.min(minX, vpX); minY = Math.min(minY, vpY);
    maxX = Math.max(maxX, vpX + vpW); maxY = Math.max(maxY, vpY + vpH);
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const scale = Math.min((MW - PAD * 2) / bw, (MH - PAD * 2) / bh);
    const ox = PAD - minX * scale + (MW - PAD * 2 - bw * scale) / 2;
    const oy = PAD - minY * scale + (MH - PAD * 2 - bh * scale) / 2;
    this._minimapTransform = { scale, ox, oy };
    // Vẽ node
    for (const r of rects) {
      const mx = r.x * scale + ox, my = r.y * scale + oy;
      const mw = Math.max(2, r.w * scale), mh = Math.max(2, r.h * scale);
      if (r.isNote) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(mx, my, mw, mh); ctx.strokeRect(mx, my, mw, mh); continue; }
      ctx.fillStyle = r.status === 'completed' ? '#19d07b' : r.status === 'error' ? '#ef4444' : r.status === 'running' ? '#3d6ff5' : '#8a8f98';
      ctx.fillRect(mx, my, mw, mh);
    }
    // Vẽ khung viewport
    ctx.strokeStyle = '#3d6ff5'; ctx.lineWidth = 1.5;
    ctx.strokeRect(vpX * scale + ox, vpY * scale + oy, vpW * scale, vpH * scale);
    ctx.fillStyle = 'rgba(61,111,245,0.10)';
    ctx.fillRect(vpX * scale + ox, vpY * scale + oy, vpW * scale, vpH * scale);
  }

  // Progress display
  showProgress(current, total) {
    const progress = this.container.querySelector('#workflowProgress');
    const text = this.container.querySelector('#progressText');
    const fill = this.container.querySelector('#progressFill');

    if (progress) progress.classList.remove('hidden');
    if (text) text.textContent = `${current} / ${total}`;
    if (fill) fill.style.width = `${total > 0 ? (current / total) * 100 : 0}%`;
  }

  hideProgress() {
    const progress = this.container.querySelector('#workflowProgress');
    if (progress) progress.classList.add('hidden');
  }

  // Duplicate a node with offset
  duplicateNode(nodeId) {
    const node = this.editor?.getNodeFromId(nodeId);
    if (!node) return null;
    // Bug fix: Ưu tiên node.data.node_type (original) over node.class (có thể bị corrupt)
    const nodeType = node.data?.node_type || node.class;
    const baseName = (node.data.node_name || nodeType) + ' ' + (window.I18n?.t('common.copySuffix') || '(copy)');
    const newData = {
      ...node.data,
      node_id: window.IdGenerator ? window.IdGenerator.next('node') : `node_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      // Bug fix: node_name không unique — clone "X (bản sao)" 2 lần → trùng tên.
      // Append " 2", " 3" cho clone lặp lại để user dễ phân biệt.
      node_name: this._uniquifyNodeName(baseName),
      node_type: nodeType  // Ensure node_type is preserved in copy
    };
    // 2026-05-25: Normalize required defaults — nếu source có video_input_type=null (vd
    // template-cloned legacy data), clone sẽ propagate bug. Normalize bắt empty → 'Frames'/etc.
    try { NodeTemplates.normalizeNodeData?.(newData); } catch (_) { /* ignore */ }
    delete newData.status;
    delete newData.result_file_ids;
    delete newData.result_file_names;
    delete newData.result_thumbnails;
    // Bug fix: slug trùng khi clone — append _2/_3/... cho đến khi không trùng với slug nào đang có.
    // Backend BulkSaveWorkflowRequest reject duplicate slug → must regenerate ở client trước khi save.
    if (node.data?.slug) {
      newData.slug = this._uniquifySlug(node.data.slug);
      newData.slug_auto = true;
    }
    return this.addNode(nodeType, node.pos_x + 40, node.pos_y + 40, newData);
  }

  /**
   * Tìm node_name unique trong workflow: append " 2", " 3"... cho đến khi không trùng.
   * Nếu baseName đã có suffix " N" → tăng N lên.
   * Clone nhiều lần "X (bản sao)" → "X (bản sao) 2", "X (bản sao) 3"...
   */
  _uniquifyNodeName(baseName) {
    if (!this.editor || !baseName) return baseName;
    const moduleData = this.editor.drawflow?.drawflow?.Home?.data || {};
    const existing = new Set();
    Object.values(moduleData).forEach(n => {
      const name = n?.data?.node_name;
      if (name) existing.add(name);
    });
    if (!existing.has(baseName)) return baseName;
    // Strip trailing " N" để tính counter tiếp
    const m = baseName.match(/^(.+?)\s+(\d+)$/);
    const root = m ? m[1] : baseName;
    let counter = m ? (parseInt(m[2], 10) + 1) : 2;
    let candidate = `${root} ${counter}`;
    while (existing.has(candidate)) {
      counter++;
      candidate = `${root} ${counter}`;
    }
    return candidate;
  }

  /**
   * Tìm slug unique trong workflow: append _2/_3/... cho đến khi không trùng.
   * Base slug đã có suffix _N → tăng N lên cho đến khi unique.
   */
  _uniquifySlug(baseSlug) {
    if (!this.editor || !baseSlug) return baseSlug;
    const moduleData = this.editor.drawflow?.drawflow?.Home?.data || {};
    const existing = new Set();
    Object.values(moduleData).forEach(n => {
      const s = n?.data?.slug;
      if (s) existing.add(s);
    });
    if (!existing.has(baseSlug)) return baseSlug;
    // Strip trailing _N nếu có để tính counter tiếp
    const m = baseSlug.match(/^(.+?)_(\d+)$/);
    const root = m ? m[1] : baseSlug;
    let counter = m ? (parseInt(m[2], 10) + 1) : 2;
    // Cap 30 ký tự để match backend regex /^[a-z][a-z0-9_]{0,29}$/.
    const MAX = 30;
    const build = (n) => {
      const suffix = `_${n}`;
      const maxRoot = MAX - suffix.length;
      if (maxRoot < 1) return `node${suffix}`.substring(0, MAX);
      let trimmed = root.length > maxRoot ? root.substring(0, maxRoot) : root;
      trimmed = trimmed.replace(/_+$/, '');
      if (!trimmed) trimmed = 'node';
      return trimmed + suffix;
    };
    let candidate = build(counter);
    while (existing.has(candidate)) {
      counter++;
      candidate = build(counter);
    }
    return candidate;
  }

  /**
   * Smart fit: compute bounding box của tất cả nodes → tính zoom phù hợp để vừa viewport.
   * - Nhiều node spread ra → zoom out (min 50%)
   * - Ít node hoặc cluster nhỏ → zoom 100% (không phóng to quá)
   * Đồng thời center canvas tới giữa bounding box.
   */
  fitToScreen() {
    if (!this.editor) return;
    const moduleData = this.editor.drawflow?.drawflow?.Home?.data || {};
    const nodeIds = Object.keys(moduleData);

    // Empty workflow / chỉ có 1 Start node (workflow mới tạo) → zoom 100% center.
    // Logic fit content cho workflow nhiều node, không cần áp cho create-mode/empty.
    const onlyStartNode = nodeIds.length === 1 &&
      (moduleData[nodeIds[0]]?.class === 'start' || moduleData[nodeIds[0]]?.data?.node_type === 'start');
    if (nodeIds.length === 0 || onlyStartNode) {
      this._applyZoomAndPan(1, 0, 0);
      return;
    }

    // Compute bounding box từ pos_x/pos_y + size DOM
    const FALLBACK_W = 340;
    const FALLBACK_H = 220;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of nodeIds) {
      const n = moduleData[id];
      const x = n.pos_x || 0;
      const y = n.pos_y || 0;
      const el = document.getElementById(`node-${id}`);
      // node_zoom: transform scale KHÔNG đổi offsetWidth → nhân thủ công để bbox tính đúng (node
      // mở rộng từ pos_x/pos_y vì transform-origin top-left) → fitToScreen không cắt node zoom.
      const _nz = Number(n.data?.node_zoom);
      const zoom = _nz === 1.5 ? 1.5 : (_nz === 2 ? 2 : 1);
      const w = (el?.offsetWidth || FALLBACK_W) * zoom;
      const h = (el?.offsetHeight || FALLBACK_H) * zoom;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    }
    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);

    // Viewport: dùng #diagramContainer (this.container) thay vì #drawflowCanvas.
    // Lý do: `#drawflowCanvas` là parent của Drawflow precanvas — precanvas có thể overflow
    // (content lớn hơn viewport) → clientWidth của canvas có thể không reflect visible viewport.
    // `#diagramContainer` có `flex: 1` + `overflow: hidden` → đo đúng visible area.
    // Dùng getBoundingClientRect.width (chính xác hơn clientWidth trong popup window context).
    const cvElForSize = this.container || this.container.querySelector('#drawflowCanvas');
    const cvRectForSize = cvElForSize?.getBoundingClientRect?.();
    const vpW = Math.round(cvRectForSize?.width || this.container?.clientWidth || 800);
    const vpH = Math.round(cvRectForSize?.height || this.container?.clientHeight || 600);
    const PADDING = 80;

    // ==== Detect overlay insets (toolbar trái, form panel phải) ====
    // Workspace HTML:
    //   .workflow-editor-center { position:relative }
    //     ├── .seosonaflow-wf-toolbar { position:absolute, left:8 }   ← overlay đè lên canvas
    //     └── #diagramContainer (this.container)
    // → toolbar che ~64px bên trái của canvas dù #diagramContainer.clientWidth = full.
    // Cần trừ inset để center bbox vào visible content area.
    const cvRect = cvRectForSize || this.container.getBoundingClientRect();
    let leftInset = 0;
    let rightInset = 0;
    let toolbarFound = false;
    try {
      const searchRoot = this.container.closest('.workflow-editor-center')
        || this.container.parentElement
        || document;
      const toolbar = searchRoot.querySelector?.('.seosonaflow-wf-toolbar');
      if (toolbar) {
        toolbarFound = true;
        const tbRect = toolbar.getBoundingClientRect();
        // Skip nếu toolbar bị ẩn (rect 0x0)
        if (tbRect.width > 0 && tbRect.height > 0) {
          // Simplified detection: toolbar luôn ở trái với position:absolute, left:8px
          // Inset = toolbar width + padding từ left edge
          leftInset = Math.max(0, tbRect.right - cvRect.left + 12);
        }
      }
      // Fallback: CHỈ khi toolbar TỒN TẠI nhưng không đo được (DOM chưa sẵn / hidden)
      // Nếu không có toolbar trong DOM → không shift
      if (toolbarFound && leftInset === 0) {
        leftInset = 64; // toolbar width 48 + left 8 + buffer 8
      }
    } catch (e) { /* ignore measurement fail */ }

    // === Tính fit zoom dựa trên VISIBLE viewport (đã trừ toolbar) ===
    const effectiveVpW = Math.max(200, vpW - leftInset - rightInset);
    const fitZoom = Math.min(
      (effectiveVpW - PADDING * 2) / bboxW,
      (vpH - PADDING * 2) / bboxH,
      1.0
    );
    // MIN_ZOOM = 0.1 để workflow CỰC lớn vẫn fit được (đồng bộ min zoom wheel/nút = 10%)
    const zoom = Math.max(0.1, Math.min(1.0, fitZoom));

    // === Center bbox vào VISIBLE area (sau toolbar) ===
    // Formula: viewport_pos = bbox_pos * zoom + canvas_translate
    // → canvas_translate = visible_center - bbox_center * zoom
    // visible_center: tính theo cvRect-relative (luôn coords container, không viewport).
    const bboxCenterX = (minX + maxX) / 2;
    const bboxCenterY = (minY + maxY) / 2;
    const visibleCenterX = leftInset + (effectiveVpW / 2);
    const canvasX = visibleCenterX - bboxCenterX * zoom;
    const canvasY = (vpH / 2) - bboxCenterY * zoom;

    // Debug log — bật để troubleshoot fitToScreen issues
    console.log(`[DiagramCanvas] fitToScreen: nodes=${nodeIds.length} bbox=(${minX},${minY})→(${maxX},${maxY}) size=${bboxW}x${bboxH} center=(${bboxCenterX.toFixed(0)},${bboxCenterY.toFixed(0)})`);
    console.log(`[DiagramCanvas] fitToScreen: viewport=${vpW}x${vpH} leftInset=${leftInset} toolbarFound=${toolbarFound} effectiveVpW=${effectiveVpW}`);
    console.log(`[DiagramCanvas] fitToScreen: visibleCenterX=${visibleCenterX.toFixed(0)} fitZoom=${fitZoom.toFixed(3)} zoom=${zoom.toFixed(3)} canvasX=${canvasX.toFixed(0)} canvasY=${canvasY.toFixed(0)}`);

    this._applyZoomAndPan(zoom, canvasX, canvasY);
  }

  /**
   * Helper: apply zoom + canvas translate đồng bộ với Drawflow internal state.
   *
   * CRITICAL: Drawflow `zoom_refresh()` (drawflow.min.js) recompute canvas_x/y theo
   * công thức `canvas_x = canvas_x / zoom_last_value * zoom`. Nếu set
   * `zoom_last_value = zoom` TRƯỚC khi user zoom in/out lần sau → ratio = 1 → canvas_x
   * giữ nguyên (đúng). Nhưng nếu set sai thứ tự → canvas_x bị scale sai → bbox dịch lệch.
   *
   * Pattern an toàn: set zoom_last_value = zoom CUỐI CÙNG (sau khi đã write canvas_x/y).
   * Drawflow sẽ dùng zoom_last_value này làm baseline cho zoom_refresh tiếp theo.
   */
  _applyZoomAndPan(zoom, canvasX, canvasY) {
    if (!this.editor) return;
    this.zoom = zoom;
    this.editor.zoom = zoom;
    // Set canvas_x/y TRƯỚC zoom_last_value để consistent với Drawflow internal expectation.
    this.editor.canvas_x = canvasX;
    this.editor.canvas_y = canvasY;
    this.editor.zoom_last_value = zoom;

    const precanvas = this.editor.precanvas
      || this.container.querySelector('.parent-drawflow .drawflow')
      || this.container.querySelector('.drawflow');
    if (precanvas) {
      // CRITICAL: transform-origin must be 0 0 for our translate/scale formula to work correctly.
      // CSS default is 50% 50% (center), which causes fitToScreen centering to be off.
      precanvas.style.transformOrigin = '0 0';
      precanvas.style.transform = `translate(${canvasX}px, ${canvasY}px) scale(${zoom})`;
    }
    // Trigger Drawflow reposition + dispatch
    try { this.editor.dispatch && this.editor.dispatch('zoom', zoom); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_applyZoomAndPan', e); }
    this.updateZoomDisplay();
  }

  // SEOSONA edge restore guard chỉ áp cho USER kéo dây. Lúc loadWorkflow restore,
  // Drawflow addConnection cũng dispatch 'connectionCreated' → removeSingleConnection sẽ XOÁ edge
  // đã persisted; user bấm Save sau đó là mất data thật. Restore phải trung thực với dữ liệu đã lưu
  // — edge lệch config cứ hiện, badge _validateRequiredPorts lo báo.
  // Trả true nếu đã reject (caller return), false nếu giữ lại vì đang restore.
  _rejectConnection(connection, msg, reason) {
    if (this._restoringEdges) {
      console.warn(`[DiagramCanvas] Giữ edge đã lưu khi restore (${reason}):`, msg);
      return false;
    }
    try {
      this.editor.removeSingleConnection(connection.output_id, connection.input_id, connection.output_class, connection.input_class);
    } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_rejectConnection', e); }
    if (typeof window.showNotification === 'function') window.showNotification(msg, 'error');
    console.warn(`[DiagramCanvas] Reject connection (${reason}):`, msg);
    return true;
  }

  // Phase WK-1.3.3-1.3.6: validate type compat + multiple=false + emit edge event + color edge
  // connection: { output_id, output_class, input_id, input_class }
  _handleConnectionCreated(connection) {
    if (!this.editor || !connection) return;

    const sourceNode = this.editor.getNodeFromId(connection.output_id);
    const targetNode = this.editor.getNodeFromId(connection.input_id);
    if (!sourceNode || !targetNode) return;

    let sourcePortName = sourceNode.data?._port_map?.[connection.output_class];
    let targetPortName = targetNode.data?._port_map?.[connection.input_class];

    // Lookup port info từ NodeTemplates
    const sourceType = sourceNode.class || sourceNode.data?.node_type;
    const targetType = targetNode.class || targetNode.data?.node_type;
    const sourcePorts = (typeof NodeTemplates?.getNodePorts === 'function')
      ? NodeTemplates.getNodePorts(sourceType, sourceNode.data) : { in: [], out: [] };
    const targetPorts = (typeof NodeTemplates?.getNodePorts === 'function')
      ? NodeTemplates.getNodePorts(targetType, targetNode.data) : { in: [], out: [] };

    // Bug 43 fix (2026-05-13): Fallback resolve port theo class index khi _port_map thiếu —
    // tránh legacy edges (vd workflow saved trước WK-1.3) bypass validation và cho phép
    // generate video output nối vào image input. Trước fix: missing _port_map → accept all.
    if (!sourcePortName) {
      const outIdx = parseInt(String(connection.output_class || '').replace('output_', ''), 10) - 1;
      sourcePortName = sourcePorts.out?.[outIdx]?.name || null;
    }
    if (!targetPortName) {
      const inIdx = parseInt(String(connection.input_class || '').replace('input_', ''), 10) - 1;
      targetPortName = targetPorts.in?.[inIdx]?.name || null;
    }

    // Vẫn không resolve được (vd legacy types transform/condition/merge/output không khai báo ports)
    // → skip validation, accept như cũ.
    if (!sourcePortName || !targetPortName) {
      if (window.eventBus) window.eventBus.emit('edge:created', { connection });
      try { this._validateRequiredPorts(); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_handleConnectionCreated', e); }
      return;
    }

    const sourcePort = sourcePorts.out.find(p => p.name === sourcePortName);
    const targetPort = targetPorts.in.find(p => p.name === targetPortName);
    if (!sourcePort || !targetPort) {
      // Không tìm thấy port (data lỗi) → fallback accept
      if (window.eventBus) window.eventBus.emit('edge:created', { connection, sourcePort: sourcePortName, targetPort: targetPortName });
      try { this._validateRequiredPorts(); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_handleConnectionCreated', e); }
      return;
    }

    // WK-1.3.3: Validate type compatibility (PORT_COMPAT matrix)
    const compat = (NodeTemplates?.PORT_COMPAT || {})[sourcePort.type] || [];
    if (!compat.includes(targetPort.type)) {
      const msg = window.I18n?.t('workflow.portIncompatible', { source: sourcePort.type, target: targetPort.type })
        || `Port không tương thích: ${sourcePort.type} → ${targetPort.type}`;
      if (this._rejectConnection(connection, msg, 'type mismatch')) return;
    }

    // 2026-06-06: Validate `acceptFromNodeTypes` whitelist — port-level provider restriction.
    // Vd: port video_ref ở Flow generate node chỉ nhận từ node generate (chặn Grok/ChatGPT video
    // output vì các provider khác KHÔNG hỗ trợ cross-provider ref video transfer).
    // Format port metadata: { acceptFromNodeTypes: ['generate', 'image', ...] }
    // Server-Only: field này lưu trong workflow_node_types.config.ports.in (admin tune qua admin UI).
    if (Array.isArray(targetPort.acceptFromNodeTypes) && targetPort.acceptFromNodeTypes.length > 0) {
      if (!targetPort.acceptFromNodeTypes.includes(sourceType)) {
        // Map nodeType slug → user-friendly display name (server config name từ workflow_node_types.name,
        // fallback i18n `node.{type}Name`, cuối cùng slug raw).
        const friendlyName = (nodeType) => {
          if (!nodeType) return nodeType;
          const cfg = typeof NodeTemplates?.getType === 'function' ? NodeTemplates.getType(nodeType) : null;
          return cfg?.name || nodeType;
        };
        const acceptedFriendly = targetPort.acceptFromNodeTypes.map(friendlyName).join(', ');
        const sourceFriendly = friendlyName(sourceType);
        const portLabel = targetPort.label || targetPort.name;
        const i18n = window.I18n;
        const msg = i18n?.t?.('workflow.portRejectAcceptFrom', {
          port: portLabel,
          accepted: acceptedFriendly,
          source: sourceFriendly,
        }) || `Port "${portLabel}" chỉ nhận từ: ${acceptedFriendly} (source: ${sourceFriendly})`;
        if (this._rejectConnection(connection, msg, 'acceptFromNodeTypes mismatch')) return;
      }
    }

    // WK-1.3.3: Validate multiple=false — target port không cho nhiều incoming edge
    if (targetPort.multiple === false) {
      const inputData = targetNode.inputs?.[connection.input_class];
      const connCount = (inputData?.connections || []).length;
      if (connCount > 1) {
        const msg = window.I18n?.t('workflow.portSingleConnection', { port: targetPort.label || targetPort.name })
          || `Port "${targetPort.label || targetPort.name}" chỉ chấp nhận 1 connection`;
        if (this._rejectConnection(connection, msg, 'multiple=false')) return;
      }
    }

    // WK-1.3.4: Auto-coerce nếu type khác nhau nhưng vẫn pass compat (vd image → frame)
    if (sourcePort.type !== targetPort.type) {
      console.log(`[DiagramCanvas] Auto-coerce: ${sourcePort.type} → ${targetPort.type} (${sourcePortName} → ${targetPortName})`);
    }

    // WK-1.3.6: Color edge theo source port type (override Drawflow default)
    try { this._colorEdgeByType(connection, sourcePort.type); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#friendlyName', e); }

    // WK-1.3.5: Emit event với port names → WorkflowEditor lưu vào edge data
    if (window.eventBus) {
      window.eventBus.emit('edge:created', {
        connection,
        sourcePort: sourcePortName,
        targetPort: targetPortName,
      });
    }

    // WK-1.3.7: Cập nhật badge required-port sau khi connect
    try { this._validateRequiredPorts(); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#friendlyName', e); }

    // WK-1.7.frame-sync: nếu edge vào port frame_1/frame_2 → đồng bộ frame_X_source vào node.data
    if (targetPortName === 'frame_1' || targetPortName === 'frame_2') {
      this._syncFrameSourceOnConnect(connection, sourceNode, targetNode, targetPortName)
        .catch(err => console.warn('[DiagramCanvas] frame source connect sync failed:', err));
    }
  }

  // WK-1.7.frame-sync: edge mới vào frame_X port → set frame_X_source = source_node_id
  // Nếu đang có frame_X_file_id thủ công → CustomDialog.confirm hỏi user trước khi override.
  // User Cancel → revert edge. OK → clear frame_X_file_id, persist, emit node:data_changed.
  async _syncFrameSourceOnConnect(connection, sourceNode, targetNode, targetPortName) {
    if (!sourceNode || !targetNode || !this.editor) return;
    const frameNum = targetPortName === 'frame_1' ? 1 : 2;
    const sourceField = `frame_${frameNum}_source`;
    const fileIdField = `frame_${frameNum}_file_id`;
    const tgtData = targetNode.data || {};
    const sourceLogicalId = sourceNode.data?.node_id || `node_${connection.output_id}`;
    const sourceNodeName = sourceNode.data?.node_name || sourceNode.class || sourceLogicalId;

    // Idempotent: nếu source đã match (vd: dropdown đã set trước, hoặc reload workflow) → skip
    if (tgtData[sourceField] === sourceLogicalId) return;

    // Conflict: đang dùng manual upload + có file_id → confirm trước khi thay
    const isManualWithFile = tgtData[sourceField] === 'manual' && tgtData[fileIdField];
    if (isManualWithFile) {
      const dialog = window.CustomDialog || window.customDialog;
      let confirmed = true;
      if (dialog?.confirm) {
        try {
          const I = window.I18n;
          confirmed = await dialog.confirm(
            I?.t?.('workflow.frameSourceConfirm', { frame: frameNum, node: sourceNodeName })
              || `Frame ${frameNum} đang dùng ảnh upload thủ công. Thay bằng output từ node "${sourceNodeName}"?`,
            {
              title: I?.t?.('workflow.frameSourceConfirmTitle') || 'Xác nhận thay đổi nguồn frame',
              okText: I?.t?.('common.ok') || 'Đồng ý',
              cancelText: I?.t?.('common.cancel') || 'Hủy',
              confirmText: I?.t?.('common.ok') || 'Đồng ý',
            }
          );
        } catch (e) {
          confirmed = false;
        }
      }
      if (!confirmed) {
        // Revert edge
        try {
          this.editor.removeSingleConnection(
            connection.output_id, connection.input_id,
            connection.output_class, connection.input_class
          );
        } catch (e) { /* ignore */ }
        return;
      }
    }

    // Apply: source = upstream node_id, clear file_id (đã confirm)
    const newData = { ...tgtData, [sourceField]: sourceLogicalId, [fileIdField]: '' };
    try {
      this.editor.updateNodeDataFromId(connection.input_id, newData);
    } catch (e) {
      console.warn('[DiagramCanvas] updateNodeDataFromId failed:', e);
      return;
    }

    if (window.eventBus) {
      window.eventBus.emit('node:data_changed', {
        drawflowId: String(connection.input_id),
        nodeId: tgtData.node_id,
        changedFields: [sourceField, fileIdField],
      });

      // Issue 3 fix: yêu cầu WorkflowEditor persist ngay (auto-save) để không lost data
      // khi user đóng editor mà chưa click Save.
      window.eventBus.emit('frame:sync_persist_request', {
        nodeId: tgtData.node_id,
        frameData: {
          [sourceField]: sourceLogicalId,
          [fileIdField]: '',
          // include cả 2 frame để snapshot đầy đủ
          frame_1_source: newData.frame_1_source,
          frame_2_source: newData.frame_2_source,
          frame_1_file_id: newData.frame_1_file_id,
          frame_2_file_id: newData.frame_2_file_id,
        },
      });
    }
  }

  // WK-1.7.frame-sync: edge khỏi frame_X port bị xóa → clear frame_X_source.
  // KHÔNG clear frame_X_file_id (giữ làm backup, user có thể đã upload trước đó).
  _syncFrameSourceOnDisconnect(connection) {
    if (!connection || !this.editor) return;

    // Issue 1 fix: skip khi đang resize ports do toggle media_type
    // (Drawflow tự xóa connections → không phải user disconnect thực sự)
    if (this._suppressFrameSyncOnResize) return;

    const targetNode = this.editor.getNodeFromId(connection.input_id);
    if (!targetNode) return;
    const targetPortName = targetNode.data?._port_map?.[connection.input_class];
    if (targetPortName !== 'frame_1' && targetPortName !== 'frame_2') return;

    const frameNum = targetPortName === 'frame_1' ? 1 : 2;
    const sourceField = `frame_${frameNum}_source`;
    const tgtData = targetNode.data || {};

    // Chỉ clear nếu source đang là node_id (không phải 'manual' hoặc rỗng)
    if (!tgtData[sourceField] || tgtData[sourceField] === 'manual') return;

    // Issue 2 fix (Option A): so sánh source trước khi clear.
    // Lý do: rejected duplicate edge (multi=false) sẽ gọi removeSingleConnection →
    // fire connectionRemoved → trigger handler này, dù edge gốc vẫn còn.
    // Resolve drawflow output_id → logical node_id để so sánh với tgtData[sourceField].
    try {
      const upstreamNode = this.editor.getNodeFromId(connection.output_id);
      const upstreamLogicalId = upstreamNode?.data?.node_id || `node_${connection.output_id}`;
      // Nếu source hiện tại không phải upstream của edge bị xóa → đây là edge khác (vd: rejected duplicate)
      // → KHÔNG clear, giữ nguyên field
      if (tgtData[sourceField] !== upstreamLogicalId) {
        return;
      }
    } catch (e) {
      // Nếu không resolve được upstream (edge case) → fall through clear như cũ để không break logic gốc
    }

    const newData = { ...tgtData, [sourceField]: '' };
    try {
      this.editor.updateNodeDataFromId(connection.input_id, newData);
    } catch (e) {
      console.warn('[DiagramCanvas] updateNodeDataFromId failed (disconnect):', e);
      return;
    }

    if (window.eventBus) {
      window.eventBus.emit('node:data_changed', {
        drawflowId: String(connection.input_id),
        nodeId: tgtData.node_id,
        changedFields: [sourceField],
      });

      // Issue 3 fix: yêu cầu WorkflowEditor persist ngay (auto-save) để không lost data
      // khi user đóng editor mà chưa click Save.
      window.eventBus.emit('frame:sync_persist_request', {
        nodeId: tgtData.node_id,
        frameData: {
          frame_1_source: tgtData.frame_1_source,
          frame_2_source: tgtData.frame_2_source,
          frame_1_file_id: tgtData.frame_1_file_id,
          frame_2_file_id: tgtData.frame_2_file_id,
          // include cleared field
          [sourceField]: '',
        },
      });
    }
  }

  // WK-1.3.6: Color SVG path theo port type + inject overlay path cho rope-style look
  _colorEdgeByType(connection, portType) {
    if (!connection) return;
    // UI 2026-05-27: màu connection do CSS điều khiển theo class `conn-type-*` + state
    // (.connection-active running / .conn-node-selected node selected) — KHÔNG set stroke inline
    // nữa (inline thắng CSS → không đổi màu theo state được).
    // Màu theo TARGET input port ("connection nối to X port"): frame port nhận từ image output
    // → phải XANH GREEN (frame), không phải xanh dương (image). Resolve target type từ DOM attr
    // data-port-type (đã inject trước _recolorAllEdges); fallback portType (source) nếu thiếu.
    let edgeType = portType;
    try {
      const tEl = this.container.querySelector(`#node-${connection.input_id} .${connection.input_class}[data-port-type]`);
      const t = tEl?.getAttribute('data-port-type');
      if (t) edgeType = t;
    } catch (e) { /* fallback portType */ }
    if (!edgeType) return;
    // Map port type → nhóm màu: frame + video → green; text → violet; image → blue; còn lại → any.
    const connTypeClass = ({
      frame: 'conn-type-frame',
      video: 'conn-type-frame',
      text: 'conn-type-text',
      image: 'conn-type-image',
    })[edgeType] || 'conn-type-any';
    // Drawflow render path với class: connection node_in_node-{input_id} node_out_node-{output_id} {output_class} {input_class}
    const sel = `.connection.node_in_node-${connection.input_id}.node_out_node-${connection.output_id}.${connection.output_class}.${connection.input_class} path`;
    let svgPath = this.container.querySelector(sel);
    // Fallback selector (khác thứ tự class)
    if (!svgPath) {
      svgPath = this.container.querySelector(`.connection.node_in_node-${connection.input_id}.node_out_node-${connection.output_id} path`);
    }
    if (svgPath) {
      const svgEl = svgPath.parentElement;
      // Gắn class type lên <svg.connection> để CSS tô màu main-path + overlay theo state.
      if (svgEl) {
        svgEl.classList.remove('conn-type-frame', 'conn-type-text', 'conn-type-image', 'conn-type-any');
        svgEl.classList.add(connTypeClass);
      }
      // Inject overlay path để có rope-style look (port color outer + dashed inner).
      this._addConnectionOverlay(svgPath);
    }
  }

  /**
   * Inject sibling SVG path on top of main-path → white dashed inner line creates
   * "rope/candy-cane" look. Outer main-path = port-type color (solid), inner overlay
   * = white dashed (animated when running).
   * MutationObserver syncs `d` attribute khi Drawflow update path (node moved).
   */
  _addConnectionOverlay(mainPath) {
    if (!mainPath) return;
    const svgEl = mainPath.parentElement;
    if (!svgEl || svgEl.querySelector('.main-path-overlay')) return; // idempotent

    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    overlay.setAttribute('class', 'main-path-overlay');
    overlay.setAttribute('d', mainPath.getAttribute('d') || '');
    overlay.setAttribute('fill', 'none');
    // Append AFTER main-path → renders ON TOP
    svgEl.appendChild(overlay);

    // Sync d-attribute: Drawflow updates main-path 'd' khi node move → mirror to overlay.
    // MutationObserver lifecycle tied to svgEl — khi connection removed, svgEl gone,
    // observer auto-disconnect by GC. Browser xử lý cleanup.
    const observer = new MutationObserver(() => {
      const d = mainPath.getAttribute('d');
      if (d) overlay.setAttribute('d', d);
    });
    observer.observe(mainPath, { attributes: true, attributeFilter: ['d'] });
  }

  // WK-1.3.7 (REFACTORED — bug fix): Selector cũ `.df-node-port[data-port-name]` đã DELETE cùng port rails.
  // Sau bug fix WK-1.2: warning class apply trên Drawflow native port `.input.input_X`.
  _validateRequiredPorts() {
    if (!this.editor) return;
    const data = this.editor.export();
    const nodes = data?.drawflow?.Home?.data || {};
    for (const [drawflowId, nodeInfo] of Object.entries(nodes)) {
      const type = nodeInfo.class;
      const ports = (typeof NodeTemplates?.getNodePorts === 'function')
        ? NodeTemplates.getNodePorts(type, nodeInfo.data) : null;
      if (!ports || !ports.in || ports.in.length === 0) continue;

      ports.in.forEach((port, idx) => {
        if (!port.required) return;
        const inputClass = `input_${idx + 1}`;
        const conns = nodeInfo.inputs?.[inputClass]?.connections || [];
        const hasConnection = conns.length > 0;

        // Drawflow native port element: `#node-X .input.input_N`
        const portEl = document.querySelector(`#node-${drawflowId} .input.${inputClass}`);
        if (portEl) {
          portEl.classList.toggle('df-port-warning', !hasConnection);
        }
      });
    }
  }

  /**
   * EWT-7.1: Chế độ xem read-only cho template preview
   * Khi readOnly = true:
   * - Chuyển Drawflow sang chế độ 'view' (không cho kéo/drop connection)
   * - Thêm CSS class để ẩn các control chỉnh sửa
   * - Disable node interactions (không click được vào node)
   * @param {boolean} readOnly - true để bật chế độ read-only
   */
  setReadOnly(readOnly) {
    this.isReadOnly = readOnly;

    if (readOnly) {
      // Chuyển Drawflow sang chế độ view (chỉ xem, không edit)
      if (this.editor) {
        this.editor.editor_mode = 'view';
      }

      // Thêm CSS class để style read-only
      this.container.classList.add('wf-canvas-readonly');

      // Ẩn các control chỉnh sửa: nút xóa node, nút thêm connection
      this.container.querySelectorAll('.node-delete, .add-connection-btn, .drawflow-delete, .df-hover-toolbar')
        .forEach(el => el.style.display = 'none');

      // Disable node interactions - không cho click vào node
      // Admin preview: vẫn cho phép click node để chọn và xem
      if (!this.isAdminPreview) {
        this.container.querySelectorAll('.drawflow-node')
          .forEach(node => node.style.pointerEvents = 'none');
      }

      // Disable toggle, quantity controls
      // Admin preview: cho phép gear icon để xem chi tiết node (read-only)
      this.container.querySelectorAll('.df-node-toggle, .df-qty-btn, .df-inline-pill')
        .forEach(el => el.style.pointerEvents = 'none');

      if (!this.isAdminPreview) {
        this.container.querySelectorAll('.df-node-gear')
          .forEach(el => el.style.pointerEvents = 'none');
      }

      // Disable keyboard delete
      if (this._handleKeyDown) {
        document.removeEventListener('keydown', this._handleKeyDown);
      }

    } else {
      // Khôi phục chế độ edit
      if (this.editor) {
        this.editor.editor_mode = 'edit';
      }

      // Bỏ CSS class read-only
      this.container.classList.remove('wf-canvas-readonly');

      // Hiển thị lại các control
      this.container.querySelectorAll('.node-delete, .add-connection-btn, .drawflow-delete, .df-hover-toolbar')
        .forEach(el => el.style.display = '');

      // Enable node interactions
      this.container.querySelectorAll('.drawflow-node')
        .forEach(node => node.style.pointerEvents = '');

      // Enable toggle, gear icon, quantity controls
      this.container.querySelectorAll('.df-node-toggle, .df-node-gear, .df-qty-btn, .df-inline-pill')
        .forEach(el => el.style.pointerEvents = '');

      // Re-bind keyboard delete
      if (this._handleKeyDown) {
        document.addEventListener('keydown', this._handleKeyDown);
      }
    }
  }

  destroy() {
    try { this._spacePanCleanup?.(); this._spacePanCleanup = null; this._spacePanBound = false; } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#destroy', _); }
    try { if (this._minimapOffMoved) { this._minimapOffMoved(); this._minimapOffMoved = null; } } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#destroy', _); } // Fix audit #2: gỡ eventBus node:moved
    try { if (this._minimapCanvas) { this._minimapCanvas.remove(); this._minimapCanvas = null; } } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#destroy', _); } // Build: gỡ minimap
    try { this._hideConnectionContextMenu(); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#destroy', _); } // Port 1.1.49: gỡ menu + 2 document listener
    if (this._handleKeyDown) {
      document.removeEventListener('keydown', this._handleKeyDown);
      this._handleKeyDown = null;
    }
    if (this._onDocumentClick) {
      document.removeEventListener('click', this._onDocumentClick);
      this._onDocumentClick = null;
    }
    if (this._onDocumentMouseDown) {
      // registered with capture:true — must remove with the same phase flag
      document.removeEventListener('mousedown', this._onDocumentMouseDown, true);
      this._onDocumentMouseDown = null;
    }
    if (this.editor) {
      this.editor.clear();
      this.editor = null;
    }
    this.container.innerHTML = '';
    this.zoom = 1;
    this.workflowId = null;
    this._selectedConnection = null;
    this._removeConnectionDeleteBtn();
  }

  // Port 1.1.49: context menu right-click connection → "Xóa kết nối" (reuse style .df-canvas-context-menu
  // của node menu). Close-on-outside-click/contextmenu, handler lưu ở _connCtxCloseHandler để destroy() gỡ.
  _showConnectionContextMenu(clientX, clientY, conn) {
    if (this.isReadOnly) return;
    this._hideConnectionContextMenu();
    try { this._hideNodeContextMenu?.(); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_showConnectionContextMenu', _); }
    const t = (k, f) => window.I18n?.t?.(k) || f;
    const menu = document.createElement('div');
    menu.className = 'df-canvas-context-menu df-connection-context-menu';
    menu.innerHTML =
      '<button type="button" class="df-canvas-context-item" data-action="delete-connection">' +
      '<span class="df-canvas-context-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></span>' +
      '<span class="df-canvas-context-label">' + t('workflow.deleteConnection', 'Xóa kết nối') + '</span>' +
      '</button>';
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - rect.height - 8))}px`;
    this._connectionContextMenu = menu;

    menu.querySelector('[data-action="delete-connection"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.editor && conn) {
        this.editor.removeSingleConnection(conn.output_id, conn.input_id, conn.output_class, conn.input_class);
        this._selectedConnection = null;
        try { this._removeConnectionDeleteBtn(); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#t', _); }
      }
      this._hideConnectionContextMenu();
    });

    setTimeout(() => {
      const close = (ev) => {
        if (!menu.contains(ev.target)) this._hideConnectionContextMenu();
      };
      this._connCtxCloseHandler = close;
      document.addEventListener('click', close, true);
      document.addEventListener('contextmenu', close, true);
    }, 0);
  }

  _hideConnectionContextMenu() {
    if (this._connectionContextMenu) {
      this._connectionContextMenu.remove();
      this._connectionContextMenu = null;
    }
    if (this._connCtxCloseHandler) {
      document.removeEventListener('click', this._connCtxCloseHandler, true);
      document.removeEventListener('contextmenu', this._connCtxCloseHandler, true);
      this._connCtxCloseHandler = null;
    }
  }

  _showConnectionDeleteBtn(conn) {
    this._removeConnectionDeleteBtn();
    // Read-only mode: không show delete button
    if (this.isReadOnly) return;
    const svg = this.container.querySelector('.drawflow svg.connection.selected');
    if (!svg) return;
    const path = svg.querySelector('.main-path');
    if (!path) return;

    const pathLen = path.getTotalLength();
    const midPt = path.getPointAtLength(pathLen / 2);

    // SVG group tại midpoint: circle bg + cross "×" lines centered.
    // Radius 14 (vừa tay click), cross stroke 2px clean look.
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('connection-delete-btn');
    const cx = midPt.x;
    const cy = midPt.y;
    const r = 14;
    const armLen = 5; // half-length của mỗi nét × (cross arm)
    g.innerHTML = `
      <circle class="del-bg" cx="${cx}" cy="${cy}" r="${r}" />
      <line class="del-x" x1="${cx - armLen}" y1="${cy - armLen}" x2="${cx + armLen}" y2="${cy + armLen}" />
      <line class="del-x" x1="${cx + armLen}" y1="${cy - armLen}" x2="${cx - armLen}" y2="${cy + armLen}" />
    `;
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.editor && conn) {
        this.editor.removeSingleConnection(conn.output_id, conn.input_id, conn.output_class, conn.input_class);
        this._selectedConnection = null;
        this._removeConnectionDeleteBtn();
      }
    });
    svg.appendChild(g);
  }

  _removeConnectionDeleteBtn() {
    this.container.querySelectorAll('.connection-delete-btn').forEach(el => el.remove());
  }

  /**
   * Show context menu cho node — đồng bộ với df-hover-toolbar actions + thêm Reset.
   * Position tại mouse coords, auto adjust nếu vượt viewport.
   * EWT-11: Ẩn run-node, reset-node, download-node khi isTemplateMode = true
   */
  _showNodeContextMenu(clientX, clientY, nodeId) {
    // Preview mode (readonly): không cho right-click menu
    if (this.isReadOnly) {
      return;
    }

    this._hideNodeContextMenu();
    if (!this.editor || !nodeId) return;
    const node = this.editor.getNodeFromId(nodeId);
    if (!node?.data) return;

    const data = node.data;
    const t = (key, fb) => window.I18n?.t(key) || fb;
    const isStart = data.node_type === 'start';
    const isNote = data.node_type === 'note';
    const hasResults = (data.result_file_ids || '').split(',').filter(Boolean).length > 0
      || !!data.result_text
      || !!(data.status && data.status !== 'pending');
    const hasPrompt = !!(data.prompt && String(data.prompt).trim());
    // EWT-11: Không hiển thị execution actions trong template mode
    const isTemplateMode = this.isTemplateMode;

    // Multi-select: right-click 1 node TRONG nhóm đang chọn (>1) → menu nhóm (Copy/Delete cả nhóm).
    const multiSel = this._multiSelected;
    const isMultiCtx = multiSel && multiSel.size > 1 && multiSel.has(String(nodeId));
    if (isMultiCtx) {
      const count = multiSel.size;
      const tc = (key, fb) => { const v = window.I18n?.t?.(key, { count }); return (v && v !== key) ? v : fb; };
      const copyIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      const delIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      this._renderContextMenu(clientX, clientY, [
        { action: 'copy-multi', label: tc('node.copyNodesMulti', `Copy ${count} node`), shortcut: '⌘C', icon: copyIcon },
        { action: 'delete-multi', label: tc('node.deleteNodesMulti', `Xóa ${count} node`), shortcut: '⌫', danger: true, icon: delIcon },
      ], nodeId);
      return;
    }

    // Build menu items theo điều kiện hiển thị
    const items = [];
    const isExecuting = !!(window.workflowExecutor?.isRunning);
    // EWT-11: Ẩn run-node khi template mode. Đang chạy → hiện "Force stop" thay "Chạy node".
    if (!isStart && !isNote && !isTemplateMode) {
      if (isExecuting) {
        items.push({ action: 'force-stop-node', label: t('workflow.forceStop', 'Force stop'), danger: true, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg>' });
      } else {
        items.push({ action: 'run-node', label: t('node.runNode', 'Chạy node'), icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' });
      }
    }
    // EWT-11: Ẩn reset-node khi template mode
    if (hasResults && !isNote && !isTemplateMode) {
      items.push({ action: 'reset-node', label: t('node.resetNode', 'Reset node'), icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>' });
    }
    if (hasPrompt) {
      items.push({ action: 'copy-prompt', label: t('node.copyPrompt', 'Copy prompt'), icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' });
    }
    // Phase 4 Task 4.9: Copy @slug context menu
    const hasSlug = !!(data.slug && String(data.slug).trim());
    if (hasSlug) {
      items.push({ action: 'copy-slug', label: t('node.copySlug', 'Copy @slug'), icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><line x1="21.17" y1="8" x2="12" y2="8"/><line x1="3.95" y1="6.06" x2="8.54" y2="14"/><line x1="10.88" y1="21.94" x2="15.46" y2="14"/></svg>' });
    }
    // Port 1.1.58 NOTE_GROUP_RUN: right-click Note → chạy chỉ node bên trong khung note (spatial).
    if (isNote && !isTemplateMode) {
      items.push({ action: 'run-note-group', label: t('workflow.runNoteGroup', 'Chạy nhóm này'), icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' });
      items.push({ separator: true });
    }
    if (!isNote) {
      items.push({ action: 'branch-node', label: t('node.branch', 'Tạo nhánh'), icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 6a9 9 0 0 0 9 9"/></svg>' });
      items.push({ action: 'settings-node', label: t('node.settings', 'Cài đặt'), icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' });
    }
    items.push({ separator: true });
    if (!isStart) {
      // v1.1 Node clipboard: Copy node sang clipboard nội bộ (Ctrl+C) — paste qua Ctrl+V hoặc canvas right-click
      items.push({ action: 'copy-node-clipboard', label: t('node.copyNode', 'Copy node'), shortcut: '⌘C', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' });
      items.push({ action: 'copy-node', label: t('node.duplicate', 'Nhân bản'), shortcut: '⌘D', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>' });
      items.push({ action: 'delete-node', label: t('node.deleteNode', 'Xóa'), shortcut: '⌫', danger: true, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' });
    }

    this._renderContextMenu(clientX, clientY, items, nodeId);
  }

  // Render df-node-context-menu từ mảng items + bind click → _dispatchNodeAction. Dùng chung
  // cho menu single-node lẫn menu nhóm multi-select.
  _renderContextMenu(clientX, clientY, items, nodeId) {
    const menu = document.createElement('div');
    menu.className = 'df-node-context-menu';
    menu.innerHTML = items.map(item => {
      if (item.separator) return '<div class="df-node-context-separator"></div>';
      return `<button class="df-node-context-item${item.danger ? ' df-node-context-item--danger' : ''}" data-action="${item.action}">
        <span class="df-node-context-icon">${item.icon || ''}</span>
        <span class="df-node-context-label">${item.label}</span>
        ${item.shortcut ? `<span class="df-node-context-shortcut">${item.shortcut}</span>` : ''}
      </button>`;
    }).join('');

    // Position — defer to next frame để measure rect
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    document.body.appendChild(menu);
    this._contextMenuEl = menu;

    // Adjust position nếu menu vượt viewport
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      let x = clientX, y = clientY;
      if (rect.right > window.innerWidth - 8) x = window.innerWidth - rect.width - 8;
      if (rect.bottom > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
      menu.style.left = `${Math.max(8, x)}px`;
      menu.style.top = `${Math.max(8, y)}px`;
    });

    // Bind item click
    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('.df-node-context-item');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.action;
      this._hideNodeContextMenu();
      this._dispatchNodeAction(action, nodeId);
    });
  }

  _hideNodeContextMenu() {
    if (this._contextMenuEl) {
      this._contextMenuEl.remove();
      this._contextMenuEl = null;
    }
  }

  /**
   * Dispatch node action — dùng chung logic với hover toolbar click handler.
   * Bao gồm: run-node, reset-node, copy-prompt, branch-node, settings-node, copy-node, delete-node, download-node.
   */
  // Inline rename node_name tại .df-node-title-text (thumbnail-node header).
  // Persist qua eventBus 'node:renamed' → WorkflowEditor debounced full-save (node_name không
  // nằm trong whitelist updateStatus). nodrag tạm thời để Drawflow không drag khi đang gõ.
  // Toggle zoom node 1.5× ↔ 1×. Set data.node_zoom + .df-node[data-zoom] (CSS scale wrapper qua
  // :has) + recompute connections (port đổi vị trí) + persist (full save vì node_zoom không nằm
  // trong updateStatus whitelist).
  _toggleNodeZoom(nodeEl) {
    if (!nodeEl || this.isReadOnly) return;
    const drawflowId = nodeEl.id.replace('node-', '');
    const node = this.editor?.getNodeFromId(drawflowId);
    if (!node) return;
    // Cycle 1 → 1.5 → 2 → 1
    const cur = Number(node.data?.node_zoom);
    const next = cur === 1.5 ? 2 : (cur === 2 ? 1 : 1.5);
    this.editor.updateNodeDataFromId(drawflowId, { ...node.data, node_zoom: next });
    const dfNode = nodeEl.querySelector('.df-node');
    if (dfNode) dfNode.dataset.zoom = next === 1.5 ? '1.5' : (next === 2 ? '2' : '1');
    // Recompute connections sau khi transform settle (port getBoundingClientRect đổi).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { this._forceUpdateAllConnections?.(); } catch (e) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_toggleNodeZoom', e); }
      });
    });
    window.eventBus?.emit('node:request_save', { drawflowId });
  }

  _startNodeRename(nodeEl) {
    if (!nodeEl || this.isReadOnly) return;
    const titleEl = nodeEl.querySelector('.df-node-title-text');
    if (!titleEl || titleEl.getAttribute('contenteditable') === 'true') return;
    const drawflowId = nodeEl.id.replace('node-', '');
    const node = this.editor?.getNodeFromId(drawflowId);
    if (!node) return;
    const original = node.data?.node_name || titleEl.textContent || '';

    titleEl.setAttribute('contenteditable', 'true');
    titleEl.classList.add('nodrag');
    titleEl.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(titleEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#_startNodeRename', _); }

    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      titleEl.removeEventListener('keydown', onKey);
      titleEl.removeEventListener('blur', onBlur);
      titleEl.removeAttribute('contenteditable');
      titleEl.classList.remove('nodrag');
      let newName = (titleEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (newName.length > 60) newName = newName.slice(0, 60);
      if (!save || !newName || newName === original) {
        titleEl.textContent = original; // revert
        return;
      }
      titleEl.textContent = newName;
      const titleWrap = nodeEl.querySelector('.df-node-title');
      if (titleWrap) titleWrap.setAttribute('title', newName);
      const fresh = this.editor?.getNodeFromId(drawflowId);
      if (fresh) {
        this.editor.updateNodeDataFromId(drawflowId, { ...fresh.data, node_name: newName });
        window.eventBus?.emit('node:renamed', { drawflowId, nodeId: fresh.data?.node_id, name: newName });
      }
    };
    const onKey = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
    };
    const onBlur = () => commit(true);
    titleEl.addEventListener('keydown', onKey);
    titleEl.addEventListener('blur', onBlur);
  }

  // ===== Note frame: resize (8 handle) + group-drag (parity web BaseNode) =====
  _initNoteInteractions() {
    if (this._noteInteractionsBound) return;
    const host = this.container?.querySelector('.drawflow') || this.container;
    if (!host) return;
    this._noteInteractionsBound = true;
    host.addEventListener('mousedown', (e) => {
      if (this.isReadOnly) return;
      const noteEl = e.target.closest?.('.df-node-note-frame');
      if (!noteEl) return;
      const dfNodeEl = noteEl.closest('.drawflow-node');
      if (!dfNodeEl) return;
      const nodeId = dfNodeEl.id.replace('node-', '');
      const handle = e.target.closest('.df-note-resize');
      if (handle) {
        // Resize: chặn Drawflow drag note khi kéo handle.
        e.preventDefault(); e.stopPropagation();
        this._startNoteResize(e, nodeId, dfNodeEl, noteEl, handle.dataset.corner || 'se');
        return;
      }
      // Group-drag: KHÔNG chặn (để Drawflow tự kéo note); chỉ theo dõi để dời node bên trong.
      // Bỏ qua click vào hover toolbar / control (không phải drag khung).
      if (e.target.closest('.df-hover-toolbar, .nodrag, button, input, textarea, select')) return;
      this._startNoteGroupDrag(e, nodeId);
    });
  }

  _startNoteResize(e, noteId, dfNodeEl, noteEl, corner) {
    const noteNode = this.editor?.getNodeFromId(noteId);
    if (!noteNode) return;
    const zoom = this.zoom || this.editor?.zoom || 1;
    const data = noteNode.data || {};
    const startW = Math.max(160, parseInt(data.note_width, 10) || 420);
    const startH = Math.max(100, parseInt(data.note_height, 10) || 280);
    const startPX = Number(noteNode.pos_x) || 0;
    const startPY = Number(noteNode.pos_y) || 0;
    const startMX = e.clientX, startMY = e.clientY;
    const west = corner.includes('w'), north = corner.includes('n');
    const affectsW = corner.includes('e') || corner.includes('w');
    const affectsH = corner.includes('n') || corner.includes('s');
    let curW = startW, curH = startH, curPX = startPX, curPY = startPY;
    const onMove = (ev) => {
      const dx = (ev.clientX - startMX) / zoom;
      const dy = (ev.clientY - startMY) / zoom;
      if (affectsW) curW = Math.max(160, Math.round(west ? startW - dx : startW + dx));
      if (affectsH) curH = Math.max(100, Math.round(north ? startH - dy : startH + dy));
      curPX = west ? Math.round(startPX + (startW - curW)) : startPX;
      curPY = north ? Math.round(startPY + (startH - curH)) : startPY;
      // Set trên CẢ frame (.df-node) LẪN wrapper (.drawflow-node) — wrapper auto-fit đôi khi không giãn
      // ngang → set thẳng width/height wrapper đảm bảo resize width hiển thị đúng.
      noteEl.style.width = curW + 'px';
      noteEl.style.height = curH + 'px';
      if (affectsW) dfNodeEl.style.width = curW + 'px';
      if (affectsH) dfNodeEl.style.height = curH + 'px';
      if (west || north) { dfNodeEl.style.left = curPX + 'px'; dfNodeEl.style.top = curPY + 'px'; }
      try { this.editor.updateConnectionNodes(`node-${noteId}`); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#onMove', _); }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Persist vào drawflow data (export đọc pos_x/pos_y + data.note_width/height).
      const nd = this.editor?.drawflow?.drawflow?.Home?.data?.[noteId];
      if (nd) {
        nd.data = { ...nd.data, note_width: curW, note_height: curH };
        nd.pos_x = curPX; nd.pos_y = curPY;
      }
      if (noteNode) { noteNode.data = { ...noteNode.data, note_width: curW, note_height: curH }; noteNode.pos_x = curPX; noteNode.pos_y = curPY; }
      if (window.eventBus) window.eventBus.emit('node:moved', { nodeId: noteId, pos_x: curPX, pos_y: curPY });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _startNoteGroupDrag(e, noteId) {
    const noteNode = this.editor?.getNodeFromId(noteId);
    if (!noteNode) return;
    const zoom = this.zoom || this.editor?.zoom || 1;
    // Bounds dùng KÍCH THƯỚC THỰC TẾ đang render (offsetWidth/Height của note element) thay vì data —
    // tránh data stale (vd width cap cũ) khiến bounds rộng hơn note nhìn thấy → node ngoài bị move nhầm.
    const noteWrapEl = document.querySelector(`#node-${noteId}`);
    const w = noteWrapEl ? noteWrapEl.offsetWidth : Math.max(160, parseInt(noteNode.data?.note_width, 10) || 420);
    const h = noteWrapEl ? noteWrapEl.offsetHeight : Math.max(100, parseInt(noteNode.data?.note_height, 10) || 280);
    const nx = Number(noteNode.pos_x) || 0, ny = Number(noteNode.pos_y) || 0;
    // Node có TÂM nằm trong khung note → theo khung (loại note khác + chính nó).
    const allData = this.editor?.drawflow?.drawflow?.Home?.data || {};
    const contained = [];
    for (const id in allData) {
      if (String(id) === String(noteId)) continue;
      const n = allData[id];
      const el = document.querySelector(`#node-${id}`);
      // Bỏ qua node note khác (khung lớn — không coi là "nằm trong").
      if (el?.querySelector('.df-node-note-frame')) continue;
      const nw = el ? el.offsetWidth : 0;
      const nh = el ? el.offsetHeight : 0;
      const cx = (Number(n.pos_x) || 0) + nw / 2;
      const cy = (Number(n.pos_y) || 0) + nh / 2;
      if (cx >= nx && cx <= nx + w && cy >= ny && cy <= ny + h) {
        contained.push({ id, startX: Number(n.pos_x) || 0, startY: Number(n.pos_y) || 0, el });
      }
    }
    if (!contained.length) return; // không có node bên trong → Drawflow kéo note bình thường
    const startMX = e.clientX, startMY = e.clientY;
    const onMove = (ev) => {
      const dx = (ev.clientX - startMX) / zoom;
      const dy = (ev.clientY - startMY) / zoom;
      for (const c of contained) {
        const px = Math.round(c.startX + dx), py = Math.round(c.startY + dy);
        const nd = allData[c.id];
        if (nd) { nd.pos_x = px; nd.pos_y = py; }
        const live = this.editor?.getNodeFromId(c.id);
        if (live) { live.pos_x = px; live.pos_y = py; }
        if (c.el) { c.el.style.left = px + 'px'; c.el.style.top = py + 'px'; }
        try { this.editor.updateConnectionNodes(`node-${c.id}`); } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#onMove', _); }
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (window.eventBus) window.eventBus.emit('node:moved', { nodeId: noteId });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Port 1.1.58 NOTE_GROUP_RUN: trả actual node_id của các node nằm TRONG khung note (spatial —
  // tâm node lọt trong bounding box note). Bỏ note khác. Executor filter theo node_id thực.
  getNodeIdsInNote(noteId) {
    const noteNode = this.editor?.getNodeFromId(noteId);
    if (!noteNode) return [];
    const wrapEl = document.querySelector(`#node-${noteId}`);
    const w = wrapEl ? wrapEl.offsetWidth  : Math.max(160, parseInt(noteNode.data?.note_width, 10)  || 420);
    const h = wrapEl ? wrapEl.offsetHeight : Math.max(100, parseInt(noteNode.data?.note_height, 10) || 280);
    const nx = Number(noteNode.pos_x) || 0, ny = Number(noteNode.pos_y) || 0;
    const allData = this.editor?.drawflow?.drawflow?.Home?.data || {};
    const ids = [];
    for (const id in allData) {
      if (String(id) === String(noteId)) continue;
      const el = document.querySelector(`#node-${id}`);
      if (el?.querySelector('.df-node-note-frame')) continue; // note khác → bỏ
      const n = allData[id];
      const cx = (Number(n.pos_x) || 0) + (el ? el.offsetWidth : 0) / 2;
      const cy = (Number(n.pos_y) || 0) + (el ? el.offsetHeight : 0) / 2;
      if (cx >= nx && cx <= nx + w && cy >= ny && cy <= ny + h) {
        const actualId = n?.data?.node_id;
        if (actualId) ids.push(String(actualId));
      }
    }
    return ids;
  }

  _dispatchNodeAction(action, nodeId) {
    if (!nodeId || !this.editor) return;
    const node = this.editor.getNodeFromId(nodeId);
    if (!node) return;

    if (action === 'run-node') {
      window.eventBus?.emit('node:run_single', { nodeId });
    } else if (action === 'run-note-group') {
      // Port 1.1.58 NOTE_GROUP_RUN: gom node trong khung note (spatial) → editor _runNoteGroup.
      const nodeIds = this.getNodeIdsInNote(nodeId);
      window.eventBus?.emit('node:run_group', { noteId: nodeId, nodeIds });
    } else if (action === 'force-stop-node') {
      window.eventBus?.emit('node:force_stop', { nodeId });
    } else if (action === 'reset-node') {
      window.eventBus?.emit('node:reset_single', { nodeId });
    } else if (action === 'download-node') {
      window.eventBus?.emit('node:download', { nodeId });
    } else if (action === 'settings-node') {
      window.eventBus?.emit('node:open_settings', { nodeId });
    } else if (action === 'copy-prompt') {
      const promptText = node?.data?.prompt || '';
      if (!promptText) return;
      const showCopiedNotice = () => {
        if (typeof window.showNotification === 'function') {
          window.showNotification(window.I18n?.t('node.promptCopied') || 'Prompt copied', 'success', 1500);
        }
      };
      (async () => {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(promptText);
            showCopiedNotice();
            return;
          }
          throw new Error('Clipboard API unavailable');
        } catch (_) {
          try {
            const ta = document.createElement('textarea');
            ta.value = promptText;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            showCopiedNotice();
          } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#showCopiedNotice', _); }
        }
      })();
    } else if (action === 'copy-slug') {
      // Phase 4 Task 4.9: Copy @slug to clipboard
      const slug = node?.data?.slug || '';
      if (!slug) return;
      const atSlug = `@${slug}`;
      const showCopiedNotice = () => {
        if (typeof window.showNotification === 'function') {
          window.showNotification(window.I18n?.t('node.slugCopied', { slug: atSlug }) || `${atSlug} copied`, 'success', 1500);
        }
      };
      (async () => {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(atSlug);
            showCopiedNotice();
            return;
          }
          throw new Error('Clipboard API unavailable');
        } catch (_) {
          try {
            const ta = document.createElement('textarea');
            ta.value = atSlug;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            showCopiedNotice();
          } catch (_) { globalThis.SEOSONA_swallow?.('DiagramCanvas#showCopiedNotice', _); }
        }
      })();
    } else if (action === 'copy-node') {
      const newDrawflowId = this.duplicateNode(nodeId);
      if (newDrawflowId) {
        const newNode = this.editor?.getNodeFromId(newDrawflowId);
        if (newNode?.data) {
          window.eventBus?.emit('node:duplicated', { drawflowId: newDrawflowId, data: newNode.data, sourceDrawflowId: nodeId });
        }
      }
    } else if (action === 'copy-node-clipboard') {
      // v1.1 Node clipboard: emit event để WorkflowEditor xử lý (clipboard slot ở editor instance)
      window.eventBus?.emit('node:copy_to_clipboard', { nodeId });
    } else if (action === 'copy-multi') {
      // Multi-select: copy cả nhóm → editor (clipboard slot ở editor instance).
      const ids = this._multiSelected ? [...this._multiSelected].map(String) : [];
      if (ids.length) window.eventBus?.emit('nodes:copy_multi', { ids });
    } else if (action === 'delete-multi') {
      const ids = this._multiSelected ? [...this._multiSelected].map(String) : [];
      if (ids.length) window.eventBus?.emit('nodes:delete_multi', { ids });
    } else if (action === 'delete-node') {
      this.removeNode(nodeId);
    } else if (action === 'branch-node') {
      window.eventBus?.emit('node:branch', { sourceNodeId: nodeId });
    } else if (action === 'quick-add-node') {
      // Quick-add (＋): tái dùng NGUYÊN luồng branch đã test — mở picker từ output port đầu tiên
      // của node, spawn + auto-connect node kế tiếp. Chỉ khác nhãn/affordance (dễ thấy hơn "Tạo nhánh").
      window.eventBus?.emit('node:branch', { sourceNodeId: nodeId });
    }
  }
}

// Export
window.DiagramCanvas = DiagramCanvas;
