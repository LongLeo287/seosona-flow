/**
 * WorkflowEditorPickers — tách từ WorkflowEditor.js (đợt 2).
 *
 * Cụm UI "chọn/thêm node": node picker, dropdown chỉnh nhanh trên node, autocomplete @mention.
 * Augment prototype nên hành vi KHÔNG đổi. PHẢI nạp SAU WorkflowEditor.js.
 */
(function (root) {
  'use strict';
  var WE = root.WorkflowEditor;
  if (!WE || !WE.prototype) {
    console.error('[WorkflowEditorPickers] WorkflowEditor chưa nạp — phải đặt script này SAU WorkflowEditor.js');
    return;
  }
  Object.assign(WE.prototype, {
  async _showNodePicker(posX, posY, sourceNodeId = null, portContext = null) {
    this._hideNodePicker();

    // Fetch server node types (cached, TTL 5 phút)
    await NodeTemplates.fetchFromServer();
    const nodeTypes = NodeTemplates.getMergedTypes();

    // Hiển thị tất cả node từ merged types (server + local).
    // BUG FIX: Trước đây filter `!!NodeTemplates.types[typeKey]` → loại bỏ server-only types.
    // Permission check (lock/crown badge) dựa hoàn toàn vào feature gates client-side,
    // không cần server required_plan (redundant với feature gate system).
    const isAllowedNode = ([_typeKey, _cfg]) => true;

    // Phase WK-1.2: filter theo port compatibility nếu có portContext
    const PORT_COMPAT = window.NodeTemplates?.PORT_COMPAT || {};
    const isCompatibleNode = ([typeKey, cfg]) => {
      if (!portContext) return true;
      const ports = window.NodeTemplates?.getNodePorts?.(typeKey, {}) || { in: [], out: [] };
      if (portContext.side === 'in') {
        // Terminal sinks (telegram) — không gợi ý làm upstream.
        // Bug 27 fix: đọc từ `ui.terminal_sink` (backend convention) + fallback root
        // `terminalSink` cho backward-compat với template/cache cũ.
        if (cfg?.ui?.terminal_sink || cfg?.terminalSink) return false;
        // Empty input port → cần upstream node có output tương thích
        return (ports.out || []).some(p => (PORT_COMPAT[p.type] || []).includes(portContext.portType));
      }
      if (portContext.side === 'out') {
        // Empty output port → cần downstream node có input tương thích
        return (ports.in || []).some(p => (PORT_COMPAT[portContext.portType] || []).includes(p.type));
      }
      return true;
    };

    const picker = document.createElement('div');
    picker.className = 'seosonaflow-node-picker';
    const closeBtnHtml = `<button type="button" class="seosonaflow-node-picker-close" title="${window.I18n?.t('workflow.kbdClose') || 'Close'}" aria-label="${window.I18n?.t('workflow.kbdClose') || 'Close'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    const headerHtml = portContext ? `
      <div class="seosonaflow-node-picker-context-hint">
        <span class="seosonaflow-node-picker-context-text">${window.I18n?.t('workflow.suggestForPort') || 'Gợi ý cho port'} <span class="seosonaflow-node-picker-port-tag" data-port-type="${portContext.portType}">${this.escapeHtml(portContext.portLabel || portContext.portName)}</span></span>
        ${closeBtnHtml}
      </div>
    ` : `<div class="seosonaflow-node-picker-context-hint seosonaflow-node-picker-context-hint--no-text">${closeBtnHtml}</div>`;
    picker.innerHTML = `
      ${headerHtml}
      <div class="seosonaflow-node-picker-search">
        <input type="text" placeholder="${window.I18n?.t('workflow.searchNode') || 'Tìm node...'}" class="seosonaflow-node-picker-input" autofocus>
      </div>
      <div class="seosonaflow-node-picker-cats" role="tablist">
        <button type="button" class="sf-picker-cat active" data-cat="__all" title="${window.I18n?.t('workflow.catAll') || 'Tất cả'}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button>
        <button type="button" class="sf-picker-cat" data-cat="Tạo ảnh/video" title="Tạo ảnh/video"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></button>
        <button type="button" class="sf-picker-cat" data-cat="Text & Prompt" title="Text &amp; Prompt"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg></button>
        <button type="button" class="sf-picker-cat" data-cat="Điều khiển luồng" title="Điều khiển luồng"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 6a9 9 0 0 0 9 9"/></svg></button>
        <button type="button" class="sf-picker-cat" data-cat="Đầu ra" title="Đầu ra"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
        <button type="button" class="sf-picker-cat" data-cat="Khác" title="${window.I18n?.t('workflow.catOther') || 'Khác'}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button>
      </div>
      <div class="seosonaflow-node-picker-list">
        ${(() => {
          // n8n-style: phân nhóm node trong picker cho gọn & chuyên nghiệp. [label, order].
          const NODE_GROUPS = {
            generate: ['Tạo ảnh/video', 1], chatgpt: ['Tạo ảnh/video', 1], grok: ['Tạo ảnh/video', 1], image: ['Tạo ảnh/video', 1],
            text: ['Text & Prompt', 2], text_template: ['Text & Prompt', 2], text_extract: ['Text & Prompt', 2],
            random_pick: ['Text & Prompt', 2], prompt_sequence: ['Text & Prompt', 2], variant_expand: ['Text & Prompt', 2], prompt: ['Text & Prompt', 2],
            condition: ['Điều khiển luồng', 3], switch: ['Điều khiển luồng', 3], loop: ['Điều khiển luồng', 3], delay: ['Điều khiển luồng', 3],
            download: ['Đầu ra', 4], telegram: ['Đầu ra', 4], text_overlay: ['Đầu ra', 4], text_qa: ['Đầu ra', 4], style_anchor: ['Prompt', 2], entity_ref: ['Ảnh', 1], image_composite: ['Ảnh', 1], merge: ['Logic', 3], quality_gate: ['Đầu ra', 4],
            note: ['Khác', 5],
          };
          const grp = (k) => NODE_GROUPS[k] || ['Khác', 9];
          // UI#2: tag năng lực hiển thị trên mỗi item (echo Magnific capability tags) — xem nhanh node làm gì.
          const NODE_TAGS = {
            generate: ['Ảnh/Video', 'Google Flow'], chatgpt: ['Ảnh', 'ChatGPT'], grok: ['Ảnh/Video', 'Grok'],
            image: ['Đầu vào', 'Ảnh ref'], prompt: ['Text'], text: ['Text'], text_template: ['Text', 'Biến {{ }}'],
            text_extract: ['Text', 'Trích xuất'], random_pick: ['Text', 'Ngẫu nhiên'], prompt_sequence: ['Text', 'Chuỗi'], variant_expand: ['Text', 'Biến thể'],
            condition: ['Rẽ nhánh', 'Điều kiện'], switch: ['Rẽ nhánh', 'Nhiều case'], loop: ['Lặp', 'Batch'],
            delay: ['Chờ'], download: ['Đầu ra', 'Lưu file'], telegram: ['Đầu ra', 'Gửi Telegram'], text_overlay: ['Đầu ra', 'Chữ→ảnh'], text_qa: ['Đầu ra', 'Kiểm chữ'], style_anchor: ['Prompt', 'Neo style', 'nhất quán'], entity_ref: ['Ảnh', 'Bảng thực thể', 'nhân vật', 'nhất quán', 'ref'], image_composite: ['Ảnh', 'Ghép ảnh', 'outpaint', 'dán đè', 'giữ pixel'], merge: ['Logic', 'Gộp', 'hợp nhất', 'nhiều nhánh'], quality_gate: ['Đầu ra', 'Cổng chất lượng', 'QA', 'chấm', 'kiểm'], note: ['Ghi chú'],
          };
          let _lastGroup = null;
          return Object.entries(nodeTypes)
          .filter(([key]) => !['transform', 'merge', 'output'].includes(key))
          .filter(isAllowedNode)
          .filter(isCompatibleNode)
          .sort(([ka, a], [kb, b]) => {
            const ga = grp(ka)[1], gb = grp(kb)[1];
            if (ga !== gb) return ga - gb;
            return (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
          })
          .map(([key, config]) => {
            const isGenerateLocked = key === 'generate' && !(window.featureGate?.canUse('gen_enabled') ?? false);
            const isTelegramLocked = key === 'telegram' && (
              !(window.featureGate?.canUse('telegram_enabled') ?? false) ||
              !(window.featureGate?.canUse('telegram_workflow') ?? false)
            );
            const isChatGPTLocked = key === 'chatgpt' && !(window.featureGate?.canUse('chatgpt_enabled') ?? false);
            const isPromptLocked = key === 'prompt' && !(window.featureGate?.canUse('prompt_node_enabled') ?? false);
            const isGrokLocked = key === 'grok' && !(window.featureGate?.canUse('grok_enabled') ?? false);
            const isLocked = isGenerateLocked || isTelegramLocked || isChatGPTLocked || isPromptLocked || isGrokLocked;
            const premiumBadge = isLocked
              ? ' <svg width="12" height="12" viewBox="0 0 24 24" fill="#eab308" style="margin-left:4px;vertical-align:middle;"><path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"></path></svg>'
              : '';
            // Icon lookup: server config.icon (string key) → NodeTemplates.icons[key], fallback type key.
            // 2026-06-25: node provider (Flow/ChatGPT/Grok) → dùng LOGO BRAND (màu brand thật) thay
            // icon generic. brandFlow tự fill #3186FF; brandOpenAI/brandGrok currentColor → lấy màu
            // container .df-node-icon.{chatgpt|grok} (green #10A37F / purple #a855f7).
            const BRAND_PICKER_ICON = { generate: 'brandFlow', chatgpt: 'brandOpenAI', grok: 'brandGrok' };
            const iconKey = config.icon || key;
            const _brandKey = BRAND_PICKER_ICON[key];
            const iconSvg = (_brandKey && NodeTemplates.icons[_brandKey])
              || NodeTemplates.icons[iconKey] || NodeTemplates.icons[key] || NodeTemplates.icons.generate;
            const _gLabel = grp(key)[0];
            const _hdr = _gLabel !== _lastGroup ? `<div class="seosonaflow-node-picker-group" data-group="${this.escapeAttr(_gLabel)}">${_gLabel}</div>` : '';
            _lastGroup = _gLabel;
            return _hdr + `
            <button class="seosonaflow-node-picker-item ${config.comingSoon ? 'seosonaflow-node-picker-disabled' : ''}" data-type="${key}" data-group="${this.escapeAttr(_gLabel)}" ${config.comingSoon ? 'disabled' : ''}>
              <div class="df-node-icon ${config.color}">${iconSvg}</div>
              <div class="seosonaflow-node-picker-info">
                <div class="seosonaflow-node-picker-name">${config.name}${premiumBadge}${config.comingSoon ? ` <span style="font-size:10px;color:var(--warning,#f59e0b);margin-left:4px;">(${window.I18n?.t('workflow.comingSoon') || 'Sắp ra mắt'})</span>` : ''}</div>
                <div class="seosonaflow-node-picker-desc">${config.description}</div>
                ${(NODE_TAGS[key] && NODE_TAGS[key].length) ? `<div class="seosonaflow-node-picker-tags">${NODE_TAGS[key].map(tg => `<span class="sf-node-tag">${this.escapeHtml(tg)}</span>`).join('')}</div>` : ''}
              </div>
            </button>
          `;}).join('');
        })()}
      </div>
      <div class="seosonaflow-node-picker-footer">
        <kbd>&#8593;&#8595;</kbd> ${window.I18n?.t('workflow.kbdMove') || 'Move'} &nbsp; <kbd>Enter</kbd> ${window.I18n?.t('workflow.kbdSelect') || 'Select'} &nbsp; <kbd>Esc</kbd> ${window.I18n?.t('workflow.kbdClose') || 'Close'}
      </div>
    `;

    // Bug fix 2026-06-03: posX/posY là CANVAS WORLD COORD (đã transform qua zoom/pan ở
    // caller: DiagramCanvas right-click, mousemove tracker). Picker `position: absolute`
    // bên trong diagramContainer cần PIXEL coord (relative to container). Trước fix: dùng
    // posX/posY trực tiếp cho style.left → khi zoom != 1 hoặc panned, picker render lệch
    // (vd canvas coord 1500 → style.left=1500px → tràn ngoài viewport → clamp về góc).
    // Inverse transform: pixelX = canvasX * zoom + panX.
    const editor = this.diagramCanvas?.editor;
    const _zoom = editor?.zoom || 1;
    const _panX = editor?.canvas_x || 0;
    const _panY = editor?.canvas_y || 0;
    const pickerPixelX = posX * _zoom + _panX;
    const pickerPixelY = posY * _zoom + _panY;
    picker.style.left = `${pickerPixelX}px`;
    picker.style.top = `${pickerPixelY}px`;

    const diagramContainer = this.overlay?.querySelector('#diagramContainer');
    if (diagramContainer) {
      diagramContainer.appendChild(picker);
    } else {
      this.overlay?.appendChild(picker);
    }
    this._nodePicker = picker;
    this._nodePickerSource = sourceNodeId;

    // Clamp picker vào trong container — tránh tràn ra ngoài viewport
    requestAnimationFrame(() => {
      if (!this._nodePicker || !diagramContainer) return;
      const pRect = picker.getBoundingClientRect();
      const cRect = diagramContainer.getBoundingClientRect();
      const PADDING = 8;
      let nx = pickerPixelX, ny = pickerPixelY;
      if (pRect.right > cRect.right - PADDING) {
        nx = Math.max(PADDING, pickerPixelX - (pRect.right - cRect.right) - PADDING);
      }
      if (pRect.bottom > cRect.bottom - PADDING) {
        ny = Math.max(PADDING, pickerPixelY - (pRect.bottom - cRect.bottom) - PADDING);
      }
      if (pRect.left < cRect.left + PADDING) nx = PADDING;
      if (pRect.top < cRect.top + PADDING) ny = PADDING;
      if (nx !== pickerPixelX) picker.style.left = `${nx}px`;
      if (ny !== pickerPixelY) picker.style.top = `${ny}px`;
    });

    const input = picker.querySelector('.seosonaflow-node-picker-input');
    setTimeout(() => input?.focus(), 50);

    // UI#3: Filter kết hợp search text + category tab (icon-tab). Gộp 1 hàm dùng chung.
    let activeCat = '__all';
    const applyPickerFilter = () => {
      const query = (input?.value || '').toLowerCase();
      picker.querySelectorAll('.seosonaflow-node-picker-item').forEach(item => {
        const name = item.querySelector('.seosonaflow-node-picker-name')?.textContent.toLowerCase() || '';
        const desc = item.querySelector('.seosonaflow-node-picker-desc')?.textContent.toLowerCase() || '';
        const grp = item.dataset.group || '';
        const matchText = name.includes(query) || desc.includes(query);
        const matchCat = activeCat === '__all' || grp === activeCat;
        item.style.display = (matchText && matchCat) ? 'flex' : 'none';
      });
      // Ẩn header nhóm không còn item nào hiển thị.
      picker.querySelectorAll('.seosonaflow-node-picker-group').forEach(hdr => {
        let anyVisible = false, el = hdr.nextElementSibling;
        while (el && !el.classList.contains('seosonaflow-node-picker-group')) {
          if (el.classList.contains('seosonaflow-node-picker-item') && el.style.display !== 'none') { anyVisible = true; break; }
          el = el.nextElementSibling;
        }
        hdr.style.display = anyVisible ? '' : 'none';
      });
      selectedIdx = 0;
      highlight();
    };
    input?.addEventListener('input', applyPickerFilter);

    // Category tabs (icon-tab) — lọc theo nhóm, kết hợp với search text.
    picker.querySelectorAll('.sf-picker-cat').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        activeCat = btn.dataset.cat || '__all';
        picker.querySelectorAll('.sf-picker-cat').forEach(b => b.classList.toggle('active', b === btn));
        applyPickerFilter();
        input?.focus();
      });
    });

    // Close button (X) ở header → đóng picker
    picker.querySelector('.seosonaflow-node-picker-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._hideNodePicker();
    });

    // Select item
    picker.addEventListener('click', async (e) => {
      const item = e.target.closest('.seosonaflow-node-picker-item');
      if (!item) return;
      const type = item.dataset.type;

      // Smart placement: nếu tạo từ empty port → đặt new node ở vị trí hợp lý
      // theo flow direction (input → trái, output → phải) thay vì tại vị trí picker.
      let spawnX = posX, spawnY = posY;
      if (portContext) {
        const smart = this._calculateSpawnPosition(portContext, type);
        if (smart) { spawnX = smart.x; spawnY = smart.y; }
      }
      const newNodeId = await this._createNodeFromPicker(type, spawnX, spawnY, sourceNodeId);
      // Phase WK-1.2: Nếu mở từ port empty → auto-connect node mới với port đó
      if (portContext && newNodeId && this.diagramCanvas?.editor) {
        try { this._autoConnectFromPortContext(newNodeId, type, portContext); }
        catch (err) { console.warn('[WorkflowEditor] Auto-connect failed:', err.message); }
      }
      this._hideNodePicker();
    });

    // Keyboard nav
    let selectedIdx = 0;
    const items = () => [...picker.querySelectorAll('.seosonaflow-node-picker-item:not([style*="display: none"])')];
    const highlight = () => {
      const its = items();
      its.forEach((it, i) => it.classList.toggle('selected', i === selectedIdx));
      try { its[selectedIdx]?.scrollIntoView({ block: 'nearest' }); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#highlight', _); }
    };

    input?.addEventListener('keydown', (e) => {
      const visibleItems = items();
      if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, visibleItems.length - 1); highlight(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); highlight(); }
      else if (e.key === 'Enter') { e.preventDefault(); const item = visibleItems[selectedIdx]; if (item) item.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); this._hideNodePicker(); }
    });

    // Close picker on outside click — capture phase để chạy TRƯỚC port click handler
    // Identity check: chỉ đóng nếu picker đang xét vẫn là current (tránh đóng nhầm picker mới)
    // Skip khi click vào empty port khác — để port handler tự mở picker mới (tránh flicker)
    const myPicker = picker;
    const outsideHandler = (e) => {
      if (this._nodePicker !== myPicker || !myPicker.isConnected) {
        document.removeEventListener('mousedown', outsideHandler, true);
        return;
      }
      if (myPicker.contains(e.target)) return;
      // Click vào empty port khác → để port handler xử lý (sẽ tự mở picker mới)
      const portEl = e.target.closest?.('.drawflow .input[data-port-type], .drawflow .output[data-port-type]');
      if (portEl && this._isPortEmpty?.(portEl)) {
        document.removeEventListener('mousedown', outsideHandler, true);
        // KHÔNG hide ngay — port handler sẽ gọi _hideNodePicker trong _showNodePicker
        return;
      }
      this._hideNodePicker();
      document.removeEventListener('mousedown', outsideHandler, true);
    };
    setTimeout(() => document.addEventListener('mousedown', outsideHandler, true), 50);
  },

  _autoConnectFromPortContext(newNodeDrawflowId, newType, portContext) {
    const editor = this.diagramCanvas?.editor;
    if (!editor || !newNodeDrawflowId || !portContext) return;
    const PORT_COMPAT = window.NodeTemplates?.PORT_COMPAT || {};
    const newPorts = window.NodeTemplates?.getNodePorts?.(newType, {}) || { in: [], out: [] };

    if (portContext.side === 'in') {
      // Existing node là target. New node phải provide output.
      const matchingOut = (newPorts.out || []).find(p => (PORT_COMPAT[p.type] || []).includes(portContext.portType));
      if (!matchingOut) return;
      const newOutIdx = newPorts.out.indexOf(matchingOut) + 1;
      // portContext.portIndex = input index của existing node
      try {
        editor.addConnection(
          newNodeDrawflowId,
          portContext.sourceNodeDrawflowId,
          `output_${newOutIdx}`,
          `input_${portContext.portIndex}`
        );
      } catch (e) { console.warn('[WorkflowEditor] addConnection in failed:', e.message); }
    } else if (portContext.side === 'out') {
      // Existing node là source. New node phải accept input.
      const matchingIn = (newPorts.in || []).find(p => (PORT_COMPAT[portContext.portType] || []).includes(p.type));
      if (!matchingIn) return;
      const newInIdx = newPorts.in.indexOf(matchingIn) + 1;
      try {
        editor.addConnection(
          portContext.sourceNodeDrawflowId,
          newNodeDrawflowId,
          `output_${portContext.portIndex}`,
          `input_${newInIdx}`
        );
      } catch (e) { console.warn('[WorkflowEditor] addConnection out failed:', e.message); }
    }
  },

  _showInlineSettingDropdown(anchorEl, drawflowId, setting) {
    this._hideInlineSettingDropdown();

    const editor = this.diagramCanvas?.editor;
    const node = editor?.getNodeFromId(drawflowId);
    if (!node) return;
    const data = node.data || {};

    // Options đồng bộ với right sidebar form (single source of truth từ sidebar select).
    // KHÔNG hardcode khác — phải match đúng field render trong _renderNodeFormByType.
    const isVideo = data.media_type === 'Video';
    // Quantity range từ provider_configs.flow.api_config.quantity_range (admin tweak qua
    // /admin/providers/flow → SSE provider:api_config_updated → cache invalidate).
    const _qRange = window.ProviderConfigManager?.safeGetQuantityRangeSync?.('flow');
    const _qMin = _qRange?.min ?? 1;
    const _qMax = _qRange?.max ?? 4;
     const _qty = [];
     for (let i = _qMin; i <= _qMax; i++) _qty.push({ value: i, label: `${i}x` });
    const optionsMap = {
      quantity: _qty,
      mediaType: [
        { value: 'Image', label: window.I18n?.t('workflow.genTypeImage') || 'Image' },
        { value: 'Video', label: window.I18n?.t('workflow.genTypeVideo') || 'Video' },
      ],
      // Video input type (chỉ Video mode): Frames (2 frame ports) / Ingredients (ref_video port).
      // Mirror right sidebar #nodeVideoInputType — model không support Frames → chỉ offer Ingredients.
      videoInputType: (() => {
        if (!isVideo) return [];
        const supportsFrames = window.ProviderRegistry?.get?.('flow')?.supportsFrames?.(data.model) !== false;
        const opts = [];
        if (supportsFrames) opts.push({ value: 'Frames', label: 'Frames' });
        opts.push({ value: 'Ingredients', label: 'Ingredients' });
        return opts;
      })(),
      // Bug 40 fix (2026-05-19): Source from PCM (admin tweak realtime via SSE).
      // Generate ratio: Image hỗ trợ 5 ratios, Video chỉ 16:9 và 9:16 (Google Flow constraint).
      ratio: (() => {
        const _rIcon = (v) => {
          const s = String(v || '').trim();
          if (s === '16:9') return '▬';
          if (s === '4:3' || s === '3:2') return '▭';
          if (s === '1:1') return '□';
          if (s === '3:4' || s === '2:3') return '▯';
          if (s === '9:16') return '▮';
          return '◇';
        };
        const _flowRatios = (window.ProviderConfigManager?.safeGetRatiosSync?.('flow', isVideo ? 'video' : 'image'))
          || (isVideo ? ['16:9', '9:16'] : ['16:9', '4:3', '1:1', '3:4', '9:16']);
        return _flowRatios.map(r => {
          const v = typeof r === 'string' ? r : r.value;
          return { value: v, label: `${_rIcon(v)} ${v}` };
        });
      })(),
      // Generate model: dynamic theo media_type — sync với #nodeModel / #nodeVideoModel
      // Group C: Fetch từ ModelRegistry (server-driven) thay vì hardcode.
      // Pattern label rút gọn "Veo 3.1 - Fast" → "Veo 3.1 Fast" (UI display).
      model: (window.ModelRegistry?.getModelsSync('flow', isVideo ? 'video' : 'image') || []).map(m => ({
        value: m.value,
        label: m.name.replace(/^Veo 3\.1 - /, 'Veo 3.1 '),
      })),
      // Video duration (chỉ video mode) — tier từ model config
      videoDuration: (() => {
        if (!isVideo) return [];
        const currentModel = data.model || '';
        let tier = 'default';
        try {
          const models = window.ModelRegistry?.safeGetModelsSync?.('flow', 'video') || [];
          const modelObj = models.find(m => m.value === currentModel || m.name === currentModel);
          if (modelObj?.config?.duration_tier) tier = modelObj.config.duration_tier;
        } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#videoDuration', _); }
        const durations = window.ProviderConfigManager?.safeGetVideoDurationsSync?.('flow', tier) || ['4s', '6s', '8s'];
        return durations.map(d => ({ value: d, label: d }));
      })(),
      // Bug 40 fix (2026-05-19): ChatGPT ratio inline dropdown — source from
      // ChatGPTAdapter.capabilities (PCM-backed getter). Admin tweak ratios qua
      // /admin/providers/chatgpt/api-configs → SSE → adapter trả fresh.
      chatgptRatio: (() => {
        const _cgIcon = (v) => {
          const s = String(v || '').trim();
          if (s === '16:9') return '▬';
          if (s === '4:3' || s === '3:2') return '▭';
          if (s === '1:1') return '□';
          if (s === '3:4' || s === '2:3') return '▯';
          if (s === '9:16') return '▮';
          return '◇';
        };
        const _cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
        const _adapter = window.ProviderRegistry?.get?.('chatgpt');
        const _supportedRatios = _adapter?.capabilities?.supportedRatios
          || ['story', 'portrait', 'square', 'landscape', 'widescreen'];
        const _uiMap = _adapter?.capabilities?.ratioUiMap
          || { story: '9:16', portrait: '3:4', square: '1:1', landscape: '4:3', widescreen: '16:9' };
        return _supportedRatios.map(key => ({
          value: key,
          label: `${_cgIcon(_uiMap[key])} ${_uiMap[key] || key} — ${_cap(key)}`,
        }));
      })(),
      // ChatGPT_image mode: sync với #chatgptImageMode (use_fallback_prefix)
      chatgptMode: [
        { value: 'auto',   label: 'Auto — Image mode → fallback' },
        { value: 'always', label: 'Always — Luôn dùng prefix' },
        { value: 'never',  label: 'Never — Bắt buộc image mode' },
      ],
      // ChatGPT model (Instant/Thinking — GPT-5.5) từ ModelRegistry('chatgpt','image')
      chatgptModel: (() => {
        const models = window.ModelRegistry?.safeGetModelsSync?.('chatgpt', 'image') || [];
        if (models.length > 0) return models.map(m => ({ value: m.value || m.name, label: m.name || m.value }));
        return [{ value: 'Instant', label: 'Instant' }, { value: 'Thinking', label: 'Thinking' }];
      })(),
      // Grok mode: sync với #grokNodeMode (image | video)
      grokMode: [
        { value: 'image', label: window.I18n?.t('grok.modeImage') || 'Image' },
        { value: 'video', label: window.I18n?.t('grok.modeVideo') || 'Video' },
      ],
      // Bug 40 fix (2026-05-19): Grok ratio inline dropdown — source from
      // GrokAdapter.capabilities (PCM-backed getter). Grok ratios: 2:3/3:2/1:1/9:16/16:9.
      grokRatio: (() => {
        const _grIcon = (v) => {
          const s = String(v || '').trim();
          if (s === '16:9') return '▬';
          if (s === '4:3' || s === '3:2') return '▭';
          if (s === '1:1') return '□';
          if (s === '3:4' || s === '2:3') return '▯';
          if (s === '9:16') return '▮';
          return '◇';
        };
        const _cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
        const _adapter = window.ProviderRegistry?.get?.('grok');
        const _supportedRatios = _adapter?.capabilities?.supportedRatios
          || ['story', 'portrait', 'square', 'landscape', 'widescreen'];
        const _uiMap = _adapter?.capabilities?.ratioUiMap
          || { story: '9:16', portrait: '2:3', square: '1:1', landscape: '3:2', widescreen: '16:9' };
        return _supportedRatios.map(key => ({
          value: key,
          label: `${_grIcon(_uiMap[key])} ${_uiMap[key] || key} — ${_cap(key)}`,
        }));
      })(),
      // Grok video duration (chỉ video mode) — đọc PCM-backed (adapter.capabilities), trước hardcode 6s/10s.
      grokDuration: (() => {
        const _durs = window.ProviderRegistry?.get?.('grok')?.capabilities?.supportedDurations;
        const list = (Array.isArray(_durs) && _durs.length) ? _durs : ['6s', '10s'];
        return list.map(d => ({ value: d, label: d }));
      })(),
      // Grok video resolution (chỉ video mode)
      grokResolution: [
        { value: '480p', label: '480p' },
        { value: '720p', label: '720p' },
      ],
      // Grok image quality (Grok update 2026-04, chỉ image mode): Speed (Nhanh) / Quality (Chậm hơn nhưng đẹp hơn)
      grokImageQuality: [
        { value: 'speed',   label: window.I18n?.t('workflow.grokImageQualitySpeed')   || 'Speed' },
        { value: 'quality', label: window.I18n?.t('workflow.grokImageQualityQuality') || 'Quality' },
      ],
      // Grok KHÔNG hỗ trợ quantity → không có grokQuantity entry
    };
    const options = optionsMap[setting];
    if (!options) return;

    // Map setting key → data field name
    const fieldMap = {
      quantity: 'quantity',
      mediaType: 'media_type',
      videoInputType: 'video_input_type',
      ratio: 'ratio',
      model: 'model',
      videoDuration: 'video_duration',
      chatgptRatio: 'ratio',
      chatgptMode: 'use_fallback_prefix',
      chatgptModel: 'model',
      grokMode: 'grok_mode',
      grokRatio: 'ratio',
      grokDuration: 'grok_duration',
      grokResolution: 'grok_resolution',
      grokImageQuality: 'grok_image_quality',
    };
    const dataField = fieldMap[setting];
    // Bug fix: fallback chain đồng bộ với NodeTemplates getter (line 593: grokMode = data.grok_mode || data.mode).
    // Trước fix: legacy node chỉ có data.mode → pill hiện đúng (qua fallback) nhưng dropdown đọc
    // data.grok_mode = undefined → không match option nào → KHÔNG có check icon ở current mode.
    // Cùng pattern cho chatgptMode (use_fallback_prefix có thể có legacy fallback).
    let currentValue = data[dataField];
    if (setting === 'grokMode' && !currentValue) currentValue = data.mode;
    if (setting === 'chatgptMode' && !currentValue) currentValue = 'auto';
    if (setting === 'mediaType' && !currentValue) currentValue = 'Image';
    if (setting === 'videoInputType' && !currentValue) {
      const _vitDefault = window.storageSettings?.get?.('defaultVideoInputType');
      currentValue = (_vitDefault === 'Ingredients' || _vitDefault === 'Frames') ? _vitDefault : 'Frames';
    }
    if (setting === 'ratio' && !currentValue) currentValue = '16:9';
    if (setting === 'grokRatio' && !currentValue) currentValue = 'widescreen';
    if (setting === 'chatgptRatio' && !currentValue) currentValue = 'story';
    if (setting === 'chatgptModel' && !currentValue) currentValue = 'Instant';
    if (setting === 'videoDuration' && !currentValue) currentValue = '6s';
    if (setting === 'grokDuration' && !currentValue) currentValue = '6s';
    if (setting === 'grokResolution' && !currentValue) currentValue = '720p';
    if (setting === 'grokImageQuality' && !currentValue) currentValue = 'speed';
    if (setting === 'quantity' && !currentValue) currentValue = 1;

    // Build dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'df-node-inline-dropdown';
    dropdown.innerHTML = options.map(opt => {
      const isActive = String(opt.value) === String(currentValue || '');
      return `
        <div class="df-node-inline-dropdown-item ${isActive ? 'active' : ''}" data-value="${this.escapeAttr(String(opt.value))}">
          <span class="check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></span>
          <span>${this.escapeHtml(opt.label)}</span>
        </div>
      `;
    }).join('');

    // Position near anchor
    const rect = anchorEl.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
    document.body.appendChild(dropdown);
    this._inlineDropdown = dropdown;

    // Bind item click
    dropdown.addEventListener('click', async (e) => {
      const item = e.target.closest('.df-node-inline-dropdown-item');
      if (!item) return;
      let newValue = item.dataset.value;
      // Coerce types
      if (setting === 'quantity') newValue = parseInt(newValue, 10) || 1;

      // Skip nếu value không đổi (tiết kiệm save call)
      const currentNorm = String(data[dataField] ?? '');
      const newNorm = String(newValue ?? '');
      if (currentNorm === newNorm) {
        this._hideInlineSettingDropdown();
        return;
      }

      // Loading state: disable interactions + spinner overlay trên node đang save
      const wrapperEl = this.overlay?.querySelector(`#node-${drawflowId}`);
      wrapperEl?.classList.add('df-node-saving');
      // Đóng dropdown ngay để user thấy progress trên card
      this._hideInlineSettingDropdown();

      // Flag để saveWorkflow() skip _applyNodeFormData() — tránh race condition
      // khi sidebar form của node khác đang mở
      this._inlineSaveInProgress = true;

      try {
        // Update node data + smart cascade khi đổi mediaType
        const updated = { ...data, [dataField]: newValue };

        // Cascade: đổi Image ↔ Video → CHỈ reset model nếu hiện tại không tương thích.
        // Tôn trọng deliberate choice của user (vd: chọn Veo 3.1 - Quality → giữ nguyên).
        // Strict Server-Only: model lists từ ModelRegistry, ratios từ PCM. Cache miss → empty array.
        if (setting === 'mediaType') {
          const VIDEO_MODELS = window.ModelRegistry?.getValuesList('flow', 'video') || [];
          const IMAGE_MODELS = window.ModelRegistry?.getValuesList('flow', 'image') || [];
          if (!VIDEO_MODELS.length) console.debug('[Tier3] WorkflowEditor mediaType cascade: flow.video model list empty');
          if (!IMAGE_MODELS.length) console.debug('[Tier3] WorkflowEditor mediaType cascade: flow.image model list empty');
          const rawVideoRatios = window.ProviderConfigManager?.safeGetRatiosSync('flow', 'video') || [];
          const VIDEO_RATIOS = rawVideoRatios.map(r => typeof r === 'string' ? r : (r.value || r));

          if (newValue === 'Video') {
            if (!VIDEO_MODELS.includes(updated.model)) {
              updated.model = window.ModelRegistry?.safeGetDefault('flow', 'video') || null;
            }
            if (!updated.video_input_type) {
              // 2026-05-29: đọc default từ StorageSettings (admin tune qua /admin/default-settings)
              const settingDefault = window.storageSettings?.get?.('defaultVideoInputType');
              updated.video_input_type = (settingDefault === 'Ingredients' || settingDefault === 'Frames')
                ? settingDefault : 'Frames';
            }
            if (!updated.video_duration) updated.video_duration = '6s';
            if (VIDEO_RATIOS.length && !VIDEO_RATIOS.includes(updated.ratio)) {
              updated.ratio = VIDEO_RATIOS[0];
            }
          } else if (newValue === 'Image') {
            if (!IMAGE_MODELS.includes(updated.model)) {
              updated.model = window.ModelRegistry?.safeGetDefault('flow', 'image') || null;
            }
            delete updated.video_input_type;
          }
        }

        editor.updateNodeDataFromId(drawflowId, updated);

        // Resize port count nếu setting ảnh hưởng visibility (mediaType, video_input_type, grokMode)
        // Image: 2 in (image_ref, text), 1 out. Video+Frames: thêm frame_1, frame_2 inputs.
        // grokMode: count không đổi nhưng port type out chuyển image ↔ video → cần re-inject attributes.
        // Bug fix: Ưu tiên updated.node_type (data) over node.class (có thể bị corrupt)
        const nodeType = updated.node_type || node.class || 'generate';
        if ((setting === 'mediaType' || setting === 'videoInputType' || setting === 'grokMode')
            && this.diagramCanvas?._resizeNodePorts
            && window.NodeTemplates?.getNodePorts) {
          const newPorts = window.NodeTemplates.getNodePorts(nodeType, updated);
          this.diagramCanvas._resizeNodePorts(drawflowId, newPorts);
        }

        // Re-validate edges sau khi data đổi — đặc biệt khi toggle mediaType/grokMode làm port out
        // chuyển type (image ↔ video) → edges tới input incompat phải gỡ.
        // Idempotent: chỉ gỡ edges thực sự incompat, edges legacy (không _port_map) skip.
        if (setting === 'mediaType' || setting === 'grokMode' || setting === 'videoInputType') {
          try {
            const removedCount = this._revalidateNodeEdges(drawflowId);
            if (removedCount > 0) {
              const msg = window.I18n?.t('workflow.edgesRemovedOnTypeChange', { count: removedCount })
                || `Đã gỡ ${removedCount} kết nối không tương thích sau khi đổi loại media`;
              if (typeof window.showNotification === 'function') {
                window.showNotification(msg, 'warning', 2500);
              }
              // Re-color edges (vì có thể edge cũ giữ màu cũ; helper tự skip nếu null)
              try { this.diagramCanvas?._recolorAllEdges?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#grokDuration', e); }
            }
          } catch (e) {
            console.warn('[WorkflowEditor] Re-validate edges failed:', e);
          }
        }

        // Re-render node HTML để pill hiển thị value mới
        const nodeEl = this.overlay?.querySelector(`#node-${drawflowId} .drawflow_content_node`);
        if (nodeEl && window.NodeTemplates) {
          nodeEl.innerHTML = window.NodeTemplates.createNodeHTML(nodeType, updated);
          // Re-inject port attributes (giữ Drawflow drag work)
          if (this.diagramCanvas?._injectPortAttributes) {
            const ports = window.NodeTemplates.getNodePorts(nodeType, updated);
            requestAnimationFrame(() => this.diagramCanvas._injectPortAttributes(drawflowId, ports));
          }
          // Re-bind pill click handlers vì innerHTML rebuild xóa hết listeners cũ
          try { this._bindInlineSettingPills(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#grokDuration', e); }
          // Refresh warning badges + port empty state sau khi port count thay đổi
          try { this._scheduleRefreshNodeWarningBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#grokDuration', e); }
          try { this._updatePortEmptyState(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#grokDuration', e); }

          // Connection paths phải recompute sau khi card layout đổi (vd ratio 9:16 ↔ 16:9 → preview area
          // height đổi → port positions đổi). Defer 2 frames cho DOM settle (CSS aspect-ratio + reflow).
          try {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                try { this.diagramCanvas?._forceUpdateAllConnections?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#grokDuration', e); }
              });
            });
          } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#grokDuration', e); }

          // CRITICAL: innerHTML rebuild reset preview placeholder → MẤT thumbnails đã render.
          // Re-render result + ref previews bằng node_id (logic node) thay vì drawflowId.
          const logicNodeId = updated.node_id;
          if (logicNodeId) {
            // Normal mode: result_file_ids, ref_file_ids
            const resultIds = (updated.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
            if (resultIds.length > 0 && typeof this._showNodePreview === 'function') {
              try { this._showNodePreview(logicNodeId, resultIds); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#grokDuration', e); }
            }
            const refIds = (updated.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
            if (refIds.length > 0 && typeof this._showNodeRefPreview === 'function') {
              try { this._showNodeRefPreview(logicNodeId, refIds); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#grokDuration', e); }
            }

            // Template mode: result_img_url, ref_img_urls (URLs thay vì file IDs)
            const isTemplateCtx = this.isTemplateMode || this.workflow?._is_template_preview || this.workflow?._isPreview;
            if (isTemplateCtx) {
              if (updated.result_img_url && typeof this._renderTemplateResultOnNode === 'function') {
                try { this._renderTemplateResultOnNode(logicNodeId, updated.result_img_url); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#grokDuration', e); }
              }
              const refUrls = updated.ref_img_urls || Object.values(updated.ref_thumbnails || {});
              if (refUrls?.length > 0 && typeof this._renderTemplateRefOnNode === 'function') {
                try { this._renderTemplateRefOnNode(logicNodeId, refUrls); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#grokDuration', e); }
              }
            }
          }
        }

        // Chỉ re-render sidebar form nếu panel đang THỰC SỰ mở cho node này.
        // KHÔNG dùng selectedNodeId làm proxy vì Drawflow set nó khi user chỉ click highlight node
        // (chưa mở form). Quick-edit không nên auto-mở sidebar — phá UX.
        const formPanel = this.overlay?.querySelector('#nodeFormPanel');
        const isPanelOpen = formPanel && !formPanel.classList.contains('hidden');
        if (isPanelOpen && String(this.selectedNodeId) === String(drawflowId)) {
          try { this.showNodeForm(drawflowId); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#grokDuration', e); }
        }

        // Auto-save workflow với debounce (800ms) — tránh 429 khi user thay đổi nhanh nhiều settings
        this._hasUnsavedChanges = true;
        // Template mode: KHÔNG auto-save vì workflow chưa tồn tại trong DB
        if (!this.isTemplateMode) {
          // Debounce: cancel pending save, schedule new one after 800ms
          if (this._inlineSaveTimer) clearTimeout(this._inlineSaveTimer);
          this._inlineSaveTimer = setTimeout(async () => {
            this._inlineSaveTimer = null;
            // Wait for any concurrent save to finish
            if (this._isSaving) {
              const waitStart = Date.now();
              while (this._isSaving && Date.now() - waitStart < 5000) {
                await new Promise(r => setTimeout(r, 100));
              }
            }
            try {
              await this.saveWorkflow();
              if (typeof window.showNotification === 'function') {
                window.showNotification(
                  window.I18n?.t('workflow.settingSaved') || 'Setting saved',
                  'success', 1500
                );
              }
            } catch (e) {
              console.error('[WorkflowEditor] Debounced inline save failed:', e);
              if (typeof window.showNotification === 'function') {
                window.showNotification(
                  (window.I18n?.t('workflow.settingSaveFailed') || 'Save failed: ') + e.message,
                  'error'
                );
              }
            }
          }, 800);
        } else {
          // Template mode: chỉ show notification là có thay đổi chưa lưu
          if (typeof window.showNotification === 'function') {
            window.showNotification(
              window.I18n?.t('workflow.templateSettingsChanged') || 'Updated. Press Save to save to database.',
              'info', 2000
            );
          }
        }
      } catch (err) {
        console.error('[WorkflowEditor] Inline setting save failed:', err);
        if (typeof window.showNotification === 'function') {
          window.showNotification(
            (window.I18n?.t('workflow.settingSaveFailed') || 'Lỗi lưu cài đặt: ') + err.message,
            'error'
          );
        }
      } finally {
        // Reset flag — inline save hoàn tất
        this._inlineSaveInProgress = false;
        // Always remove loading class, kể cả khi error — re-query vì wrapperEl có thể stale
        const w = this.overlay?.querySelector(`#node-${drawflowId}`);
        w?.classList.remove('df-node-saving');
      }
    });

    // Close on outside click — Self-cleanup nếu dropdown KHÔNG còn là current
    // (tránh handler stale từ dropdown cũ đóng nhầm dropdown mới khi mở liên tục)
    setTimeout(() => {
      const outsideHandler = (ev) => {
        // Dropdown này không còn active → tự cleanup, không can thiệp dropdown mới
        if (this._inlineDropdown !== dropdown || !dropdown.isConnected) {
          document.removeEventListener('mousedown', outsideHandler);
          return;
        }
        if (!dropdown.contains(ev.target)) {
          this._hideInlineSettingDropdown();
          document.removeEventListener('mousedown', outsideHandler);
        }
      };
      document.addEventListener('mousedown', outsideHandler);
    }, 50);
  },

  _hideNodePicker() {
    if (this._nodePicker) {
      this._nodePicker.remove();
      this._nodePicker = null;
      this._nodePickerSource = null;
    }
  },

  async _createNodeFromPicker(type, posX, posY, sourceNodeId) {
    if (!this.diagramCanvas) return null;

    // Đọc user settings từ storage để áp dụng default model/ratio cho node mới
    const afSettings = await new Promise(resolve => {
      chrome.storage.local.get(['af_settings'], r => resolve(r.af_settings || {}));
    });

    const nodeName = this._generateUniqueNodeName(type);
    const nodeData = {
      ...NodeTemplates.getDefaults(type, afSettings),
      node_name: nodeName,
      node_type: type
    };
    // Phase 1 — Node Reference System: Auto-generate slug for mentionable nodes
    if (this._isMentionableNodeType(type)) {
      nodeData.slug = this._generateSlug(nodeName);
      nodeData.slug_auto = true;
    }
    const newId = this.diagramCanvas.addNode(type, posX, posY, nodeData);
    if (newId) {
      this._hasUnsavedChanges = true;
      // Refresh UI sau khi thêm node
      requestAnimationFrame(() => {
        try { this._scheduleRefreshNodeWarningBadges(); } catch (err) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#_createNodeFromPicker', err); }
        try { this._updatePortEmptyState(); } catch (err) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#_createNodeFromPicker', err); }
        try { this._bindInlineSettingPills(); } catch (err) { globalThis.SEOSONA_swallow?.('WorkflowEditorPickers#_createNodeFromPicker', err); }
      });
    }
    if (sourceNodeId && newId) {
      console.warn('[WorkflowEditor] _createNodeFromPicker received sourceNodeId — auto-connect handled via portContext flow now');
    }
    return newId;
  },

  _bindMentionAutocomplete(textarea, nodeId) {
    if (!textarea) return;

    let dropdown = null;
    let activeIndex = -1;
    let currentQuery = '';
    let filteredSlugs = [];

    const createDropdown = () => {
      if (dropdown) return dropdown;
      dropdown = document.createElement('div');
      dropdown.className = 'mention-autocomplete';
      dropdown.style.display = 'none';
      textarea.parentElement.style.position = 'relative';
      textarea.parentElement.appendChild(dropdown);
      return dropdown;
    };

    const hideDropdown = () => {
      if (dropdown) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
      }
      activeIndex = -1;
      currentQuery = '';
      filteredSlugs = [];
    };

    // Task 4.11: Render single item helper
    const renderItem = (item, idx) => {
      const thumbHtml = item.thumbnail
        ? `<div class="mention-autocomplete-thumb" style="background-image: url('${this.escapeAttr(item.thumbnail)}')"></div>`
        : item.category === 'text'
          ? `<div class="mention-autocomplete-thumb text-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></div>`
          : `<div class="mention-autocomplete-thumb image-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg></div>`;

      return `
        <div class="mention-autocomplete-item${idx === activeIndex ? ' active' : ''}" data-index="${idx}" data-slug="${this.escapeAttr(item.slug)}">
          ${thumbHtml}
          <div class="mention-autocomplete-info">
            <div class="mention-autocomplete-slug">${this.escapeHtml(item.slug)}</div>
            <div class="mention-autocomplete-meta">
              <span class="mention-autocomplete-type">${item.nodeType}</span>
              <span class="mention-autocomplete-name">${this.escapeHtml(item.name)}</span>
            </div>
          </div>
        </div>
      `;
    };

    const renderDropdown = async (slugs, query) => {
      const dd = createDropdown();
      filteredSlugs = slugs;

      if (slugs.length === 0) {
        dd.innerHTML = `<div class="mention-autocomplete-empty">${window.I18n?.t('workflow.noMentionMatch') || 'Không tìm thấy node phù hợp'}</div>`;
        dd.style.display = 'block';
        return;
      }

      let html = '';

      // Task 4.11: Show "Recent" section when query is empty
      if (!query && this.workflow?.id) {
        try {
          const recentSlugs = await this._loadRecentMentions(this.workflow.id);
          if (recentSlugs.length > 0) {
            const slugSet = new Set(slugs.map(s => s.slug));
            const validRecentSlugs = recentSlugs.filter(s => slugSet.has(s));
            if (validRecentSlugs.length > 0) {
              html += `<div class="mention-autocomplete-section">
                <div class="mention-autocomplete-section-header"><svg class="mention-section-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> ${window.I18n?.t('workflow.recentMentions') || 'Recent'}</div>
                <div class="mention-autocomplete-section-items">
                  ${validRecentSlugs.slice(0, 5).map(rs => `<span class="mention-autocomplete-recent" data-slug="${this.escapeAttr(rs)}">@${this.escapeHtml(rs)}</span>`).join('')}
                </div>
              </div>`;
              html += `<div class="mention-autocomplete-divider"></div>`;
              html += `<div class="mention-autocomplete-section-header"><svg class="mention-section-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> ${window.I18n?.t('workflow.allNodes') || 'All nodes'}</div>`;
            }
          }
        } catch (e) {
          // Ignore recent mentions errors
        }
      }

      html += slugs.map((item, idx) => renderItem(item, idx)).join('');
      dd.innerHTML = html;
      dd.style.display = 'block';

      // Position dropdown below cursor line - avoid overlapping text
      const textareaRect = textarea.getBoundingClientRect();
      const parentRect = textarea.parentElement.getBoundingClientRect();
      const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
      const paddingTop = parseInt(getComputedStyle(textarea).paddingTop) || 0;
      const cursorPos = this._getTextareaCursorPosition(textarea);

      // Calculate dropdown position relative to parent
      const dropdownTop = paddingTop + cursorPos.top + lineHeight + 8;
      const dropdownLeft = Math.max(8, Math.min(cursorPos.left, textareaRect.width - 300));

      dd.style.top = `${dropdownTop}px`;
      dd.style.left = `${dropdownLeft}px`;

      // Ensure dropdown doesn't overflow below textarea - if so, position above cursor
      requestAnimationFrame(() => {
        const ddRect = dd.getBoundingClientRect();
        const textareaBottom = textareaRect.bottom;
        if (ddRect.bottom > textareaBottom + 100) {
          // Position above cursor instead
          const aboveTop = paddingTop + cursorPos.top - dd.offsetHeight - 8;
          if (aboveTop > 0) {
            dd.style.top = `${aboveTop}px`;
          }
        }
      });
    };

    const selectItem = (index) => {
      if (index < 0 || index >= filteredSlugs.length) return;
      const item = filteredSlugs[index];

      // Replace @query với @slug
      const text = textarea.value;
      const cursorPos = textarea.selectionStart;
      const beforeCursor = text.substring(0, cursorPos);
      const afterCursor = text.substring(cursorPos);

      // Tìm vị trí @ trước cursor
      const atMatch = beforeCursor.match(/@([a-z0-9_]*)$/i);
      if (atMatch) {
        const atPos = beforeCursor.lastIndexOf('@');
        const newText = beforeCursor.substring(0, atPos) + '@' + item.slug + ' ' + afterCursor;
        textarea.value = newText;
        textarea.selectionStart = textarea.selectionEnd = atPos + item.slug.length + 2;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));

        // Task 4.11: Save to recent mentions
        if (this.workflow?.id) {
          this._saveRecentMention(this.workflow.id, item.slug);
        }
      }

      hideDropdown();
      textarea.focus();
    };

    // Task 4.11: Handle click on recent mention chip
    const handleRecentClick = (slug) => {
      const text = textarea.value;
      const cursorPos = textarea.selectionStart;
      const beforeCursor = text.substring(0, cursorPos);
      const afterCursor = text.substring(cursorPos);

      const atMatch = beforeCursor.match(/@([a-z0-9_]*)$/i);
      if (atMatch) {
        const atPos = beforeCursor.lastIndexOf('@');
        const newText = beforeCursor.substring(0, atPos) + '@' + slug + ' ' + afterCursor;
        textarea.value = newText;
        textarea.selectionStart = textarea.selectionEnd = atPos + slug.length + 2;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));

        if (this.workflow?.id) {
          this._saveRecentMention(this.workflow.id, slug);
        }
      }

      hideDropdown();
      textarea.focus();
    };

    // Click handler cho dropdown items
    const handleDropdownClick = (e) => {
      // Task 4.11: Handle recent mention chip click
      const recentChip = e.target.closest('.mention-autocomplete-recent');
      if (recentChip) {
        const slug = recentChip.dataset.slug;
        if (slug) handleRecentClick(slug);
        return;
      }

      const item = e.target.closest('.mention-autocomplete-item');
      if (item) {
        const index = parseInt(item.dataset.index, 10);
        selectItem(index);
      }
    };

    // Create mention chips preview container
    const chipsPreview = this._createMentionChipsPreview(textarea, nodeId);

    // Task 4.8: Create preview panel
    const previewPanel = this._createPreviewPanel(textarea, nodeId);

    // Task 4.8: Debounced preview panel update
    let previewDebounceTimer = null;
    const debouncedPreviewUpdate = () => {
      if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
      previewDebounceTimer = setTimeout(() => {
        this._updatePreviewPanel(textarea, nodeId);
      }, 300);
    };

    // Input handler để detect @ và filter
    const handleInput = () => {
      const text = textarea.value;
      const cursorPos = textarea.selectionStart;
      const beforeCursor = text.substring(0, cursorPos);

      // Check nếu đang gõ @mention
      const atMatch = beforeCursor.match(/@([a-z0-9_]*)$/i);

      if (atMatch) {
        currentQuery = atMatch[1].toLowerCase();
        const allSlugs = this._getAvailableMentionSlugs(nodeId);

        // Filter theo query
        const filtered = currentQuery
          ? allSlugs.filter(s => s.slug.includes(currentQuery) || s.name.toLowerCase().includes(currentQuery))
          : allSlugs;

        activeIndex = filtered.length > 0 ? 0 : -1;
        renderDropdown(filtered, currentQuery);
      } else {
        hideDropdown();
      }

      // Update chips preview
      this._updateMentionChipsPreview(textarea, nodeId);

      // Phase 4 Task 4.1: Update visual indicators on canvas
      this._updateMentionedNodesIndicator(text);

      // Task 4.8: Update preview panel (debounced)
      debouncedPreviewUpdate();
    };

    // Task 5.6: Insert all connected @slugs helper
    const insertAllConnectedSlugs = () => {
      const allSlugs = this._getAvailableMentionSlugs(nodeId);
      const connectedSlugs = allSlugs.filter(s => s.connected);
      if (connectedSlugs.length === 0) {
        console.log('[WorkflowEditor] No connected nodes with slugs to insert');
        return;
      }

      const mentionText = connectedSlugs.map(s => `@${s.slug}`).join(' ') + ' ';
      const cursorPos = textarea.selectionStart;
      const text = textarea.value;
      const newText = text.substring(0, cursorPos) + mentionText + text.substring(cursorPos);
      textarea.value = newText;
      textarea.selectionStart = textarea.selectionEnd = cursorPos + mentionText.length;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      // Save to recent
      if (this.workflow?.id) {
        for (const s of connectedSlugs) {
          this._saveRecentMention(this.workflow.id, s.slug);
        }
      }

      console.log(`[WorkflowEditor] Inserted ${connectedSlugs.length} connected @mentions`);
    };

    // Keydown handler cho navigation — Task 5.2: Enhanced keyboard shortcuts
    const handleKeydown = (e) => {
      // Task 5.6: Ctrl+Shift+M → Insert all connected @slugs
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        insertAllConnectedSlugs();
        hideDropdown();
        return;
      }

      if (!dropdown || dropdown.style.display === 'none') return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          activeIndex = Math.min(activeIndex + 1, filteredSlugs.length - 1);
          renderDropdown(filteredSlugs, currentQuery);
          break;

        case 'ArrowUp':
          e.preventDefault();
          activeIndex = Math.max(activeIndex - 1, 0);
          renderDropdown(filteredSlugs, currentQuery);
          break;

        case 'Tab':
          if (e.shiftKey) {
            // Shift+Tab: Navigate backwards
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            renderDropdown(filteredSlugs, currentQuery);
          } else if (activeIndex >= 0 && filteredSlugs.length > 0) {
            // Tab: Select item if available
            e.preventDefault();
            selectItem(activeIndex);
          }
          // else: Let Tab behave normally (move focus)
          break;

        case 'Enter':
          if (activeIndex >= 0) {
            e.preventDefault();
            selectItem(activeIndex);
          }
          break;

        case 'Escape':
          e.preventDefault();
          hideDropdown();
          break;
      }
    };

    // Blur handler để ẩn dropdown
    const handleBlur = (e) => {
      // Delay để cho phép click vào dropdown
      setTimeout(() => {
        if (!dropdown?.contains(document.activeElement)) {
          hideDropdown();
        }
      }, 150);
    };

    // Bind events
    textarea.addEventListener('input', handleInput);
    textarea.addEventListener('keydown', handleKeydown);
    textarea.addEventListener('blur', handleBlur);

    // Cleanup khi form đóng (sẽ được gọi bởi hideNodeForm)
    textarea._mentionAutocomplete = {
      cleanup: () => {
        textarea.removeEventListener('input', handleInput);
        textarea.removeEventListener('keydown', handleKeydown);
        textarea.removeEventListener('blur', handleBlur);
        if (dropdown) {
          dropdown.removeEventListener('click', handleDropdownClick);
          dropdown.remove();
        }
        if (chipsPreview) {
          chipsPreview.remove();
        }
        // Phase 4 Task 4.1: Clear indicators when form closes
        this._clearMentionedNodesIndicator();
      }
    };

    // Bind click handler cho dropdown
    createDropdown().addEventListener('click', handleDropdownClick);

    // Initial chips preview update (show existing mentions)
    this._updateMentionChipsPreview(textarea, nodeId);

    // Phase 4 Task 4.1: Initial indicator update
    this._updateMentionedNodesIndicator(textarea.value);
  }
  });
})(typeof window !== 'undefined' ? window : this);
