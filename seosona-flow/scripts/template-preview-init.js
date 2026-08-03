/**
 * template-preview-init.js — Render preview workflow template READ-ONLY trong cửa sổ SIÊU NHẸ.
 * Dùng CHUNG cho community + official. KHÔNG load WorkflowEditor/execution/SSE/providers (82 script)
 * → chỉ DiagramCanvas + NodeTemplates + I18n → tránh GPU/memory tích lũy khi mở preview nhiều lần.
 *
 * Input: chrome.storage.local._pendingTemplatePreview = { template, timestamp }.
 * Hỗ trợ message 'loadTemplatePreview' để swap template khác mà KHÔNG reload (reuse cửa sổ).
 */
(function () {
  'use strict';

  // Stub: DiagramCanvas gọi window.showNotification(...) KHÔNG dùng ?. ở vài chỗ → undefined sẽ throw.
  // Lite preview không cần toast → no-op log (tránh crash render).
  if (typeof window.showNotification !== 'function') {
    window.showNotification = (msg, type) => { console.log('[TemplatePreview][notify]', type || 'info', msg); };
  }

  let diagram = null;
  let currentTemplate = null;
  let previewKind = 'template'; // 'template' | 'shared'

  // Re-route connection sau khi media (ref/result) chèn vào node làm node cao lên → port dịch.
  // loadWorkflow chỉ update connection ở rAF/200/600ms, nhưng ảnh load async (mạng chậm) đổi
  // chiều cao SAU đó → connection trỏ sai port. Debounce gom nhiều ảnh load gần nhau.
  let _connRefreshTimer = null;
  function scheduleConnRefresh(delay = 90) {
    clearTimeout(_connRefreshTimer);
    _connRefreshTimer = setTimeout(() => {
      try { diagram?._forceUpdateAllConnections?.(); } catch (_) { globalThis.SEOSONA_swallow?.('template-preview-init#scheduleConnRefresh', _); }
    }, delay);
  }

  // I18n.t trả về KEY khi thiếu → check v !== k để fallback đúng (key mới chưa sync DB).
  const t = (k, f) => { const v = window.I18n && window.I18n.t && window.I18n.t(k); return (v && v !== k) ? v : f; };

  // Loading overlay (giống workflow-editor) — fade out + remove sau khi diagram render xong.
  let _loadingHidden = false;
  function hideLoading() {
    if (_loadingHidden) return;
    _loadingHidden = true;
    const el = document.getElementById('tpLoading');
    if (!el) return;
    el.classList.add('tp-loading-out');
    setTimeout(() => el.remove(), 350);
  }

  // Convert template (nested {data,position} HOẶC flat) → workflow FLAT cho DiagramCanvas. KHỚP
  // WorkflowTemplateList._convertTemplateToWorkflowFormat + workflow-editor-init inline.
  function adaptTemplate(tpl) {
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
        node_zoom: [1.5, 2].includes(Number(node.node_zoom ?? data.node_zoom)) ? Number(node.node_zoom ?? data.node_zoom) : 1,
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
      source_handle: edge.source_handle || edge.output_class || edge.sourceHandle || 'output_1',
      target_handle: edge.target_handle || edge.input_class || edge.targetHandle || 'input_1',
      source_port: edge.source_port || edge.sourcePort || 'default',
      target_port: edge.target_port || edge.targetPort || 'default',
    }));
    return { wf_id: `preview_${tpl.id || tpl.wf_id || 'tpl'}`, wf_name: tpl.name || tpl.wf_name || 'Template', nodes, edges };
  }

  // --- Render ảnh ref/result lên node (port từ WorkflowEditor, dùng container thay overlay) ---
  function findDrawflowId(nodeId) {
    const home = diagram?.editor?.drawflow?.drawflow?.Home?.data || {};
    if (home[String(nodeId)]) return String(nodeId);
    for (const [id, n] of Object.entries(home)) {
      if (n.data?.node_id === nodeId) return id;
    }
    return null;
  }

  function mkThumb(cls, url) {
    const thumb = document.createElement('div');
    thumb.className = cls;
    thumb.dataset.mediaSrc = url; // lightbox đọc khi click
    thumb.dataset.mediaType = 'image';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = 'preview';
    // Lazy shimmer: gỡ class .tp-thumb-loading ở container .df-node-preview khi ảnh load xong
    // (server chậm) → img fade-in (CSS tie opacity theo container, KHÔNG fade div wrapper).
    let _markTries = 0;
    const markLoaded = () => {
      const preview = img.closest('.df-node-preview');
      if (preview) { preview.classList.remove('tp-thumb-loading'); scheduleConnRefresh(); return; }
      // Ảnh cached: markLoaded chạy sync TRƯỚC khi img attach DOM → closest null → retry 1 frame.
      if (_markTries++ < 10) requestAnimationFrame(markLoaded);
    };
    img.addEventListener('load', markLoaded);
    img.addEventListener('error', markLoaded); // lỗi ảnh: vẫn gỡ shimmer (tránh kẹt)
    img.src = url;
    if (img.complete && img.naturalWidth) markLoaded(); // ảnh cached: load không bắn
    thumb.appendChild(img);
    // Nút zoom kính lúp GIỮA thumb (giống editor _attachThumbZoom — hover hiện via CSS .df-preview-zoom).
    // Chỉ cho preview chính (.df-preview-thumb); .df-ref-thumb (generate node) nhỏ → vẫn click mở dc.
    if (cls === 'df-preview-thumb') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'df-preview-zoom nodrag';
      btn.title = t('workflow.viewMedia', 'Xem');
      btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>';
      thumb.appendChild(btn);
    }
    return thumb;
  }

  // Result image (output mẫu) → .df-node-preview (mọi node). Retry nếu DOM node chưa sẵn.
  function renderResultOnNode(nodeId, url, retry = 0) {
    if (!url) return;
    const dfId = findDrawflowId(nodeId);
    const nodeEl = dfId && document.querySelector(`#node-${dfId}`);
    if (!nodeEl) { if (retry < 5) setTimeout(() => renderResultOnNode(nodeId, url, retry + 1), 120 * (retry + 1)); return; }
    const c = nodeEl.querySelector('.df-node-preview');
    if (!c) return;
    c.innerHTML = '';
    c.classList.remove('hidden', 'multi-result');
    c.classList.add('template-result-preview', 'tp-thumb-loading');
    const thumb = mkThumb('df-preview-thumb', url);
    thumb.querySelector('img').onerror = () => c.classList.add('hidden');
    c.appendChild(thumb);
  }

  // Ref images → image node: .df-node-preview ; generate/chatgpt/grok/prompt: .df-node-ref-preview
  // (port _renderTemplateRefOnNode). Retry nếu DOM chưa sẵn.
  function renderRefOnNode(nodeId, refUrls, nodeType, retry = 0) {
    if (!refUrls || !refUrls.length) return;
    const dfId = findDrawflowId(nodeId);
    const nodeEl = dfId && document.querySelector(`#node-${dfId}`);
    if (!nodeEl) { if (retry < 5) setTimeout(() => renderRefOnNode(nodeId, refUrls, nodeType, retry + 1), 120 * (retry + 1)); return; }
    if (nodeType === 'image') {
      const c = nodeEl.querySelector('.df-node-preview');
      if (!c) return;
      c.innerHTML = '';
      c.classList.remove('hidden');
      c.classList.add('template-ref-preview', 'image-ref', 'tp-thumb-loading');
      c.classList.toggle('multi-result', refUrls.length > 1);
      refUrls.forEach(url => { if (url) c.appendChild(mkThumb('df-preview-thumb', url)); });
    } else {
      let c = nodeEl.querySelector('.df-node-ref-preview');
      if (!c) {
        const body = nodeEl.querySelector('.df-node-body');
        if (!body) return;
        c = document.createElement('div');
        c.className = 'df-node-ref-preview';
        c.setAttribute('data-ref-preview', '');
        body.appendChild(c);
      }
      c.innerHTML = '';
      refUrls.slice(0, 6).forEach(url => { if (url) c.appendChild(mkThumb('df-ref-thumb', url)); });
    }
  }

  function renderNodeMedia(adapted) {
    for (const node of adapted.nodes) {
      // Result trước (ưu tiên hiện output mẫu nếu có), else ref.
      const resultUrls = node.result_thumbnails
        ? Object.values(node.result_thumbnails).map(v => typeof v === 'string' ? v : (v?.thumbnail || '')).filter(Boolean)
        : [];
      if (resultUrls.length) { renderResultOnNode(node.node_id, resultUrls[0]); continue; }
      const refUrls = (node.ref_img_urls && node.ref_img_urls.length)
        ? node.ref_img_urls
        : Object.values(node.ref_thumbnails || {});
      if (refUrls.length) renderRefOnNode(node.node_id, refUrls, node.node_type);
    }
  }

  // app_name từ server config — áp vào title + brand zone (.seosonaflow-header-title do DiagramCanvas render).
  let _appName = '';
  function applyBrand() {
    if (!_appName) return;
    document.title = `${_appName} · Template Preview`;
    document.querySelectorAll('.seosonaflow-header-title').forEach(el => { el.textContent = _appName; });
    document.querySelectorAll('.seosonaflow-header-logo img, .seosonaflow-header-logo-img').forEach(el => { el.alt = _appName; });
    const titleEl = document.getElementById('tpTitle');
    if (titleEl && (!titleEl.textContent || titleEl.textContent === 'Template')) titleEl.textContent = _appName;
  }

  async function render(tpl, kind = 'template') {
    if (!tpl) return;
    currentTemplate = tpl;
    previewKind = kind === 'shared' ? 'shared' : 'template';
    document.getElementById('tpTitle').textContent = tpl.name || tpl.wf_name || 'Template';
    document.getElementById('tpUseLabel').textContent = previewKind === 'shared'
      ? t('workflow.cloneShared', 'Dùng workflow')
      : t('workflow.copyTemplateBtn', 'Dùng template');
    const adapted = adaptTemplate(tpl);
    // Đếm từ node THỰC render (official có node_count=0 stale → ?? ko fallback vì 0 ko phải nullish).
    const nodeCount = adapted.nodes.length || tpl.node_count || 0;
    const nodeIcon = '<svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="none"><path fill="currentColor" fill-rule="evenodd" d="M4 6.25A2.25 2.25 0 016.25 4h3a2.25 2.25 0 012.25 2.25V7h3.25a.75.75 0 010 1.5H11.5v.75a2.25 2.25 0 01-2.25 2.25h-3A2.25 2.25 0 014 9.25V8.5H.75a.75.75 0 010-1.5H4v-.75zm6 0a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75v3c0 .414.336.75.75.75h3a.75.75 0 00.75-.75v-3z" clip-rule="evenodd"></path></svg>';
    const metaEl = document.getElementById('tpMeta');
    metaEl.innerHTML = nodeIcon; // icon trái
    metaEl.appendChild(document.createTextNode(` ${nodeCount} ${t('workflow.nodes', 'nodes')}`));
    const container = document.getElementById('diagramContainer');

    // Re-init DiagramCanvas mỗi lần render (clear cũ). Read-only.
    if (diagram?.destroy) { try { diagram.destroy(); } catch (_) { globalThis.SEOSONA_swallow?.('template-preview-init#render', _); } }
    container.innerHTML = '';
    diagram = new window.DiagramCanvas(container, { isReadOnly: true });
    diagram.loadWorkflow(adapted);
    applyBrand(); // brand zone .seosonaflow-header-title vừa render → áp app_name

    // Render ảnh + fit sau khi DOM node sẵn sàng.
    setTimeout(() => {
      try { renderNodeMedia(adapted); } catch (e) { console.warn('[TemplatePreview] renderNodeMedia:', e?.message); }
      try { diagram.fitToScreen?.(); } catch (_) { globalThis.SEOSONA_swallow?.('template-preview-init#render', _); }
      scheduleConnRefresh(0); // re-route sau khi chèn media (ảnh cached load sync)
      applyBrand(); // re-apply phòng brand zone render trễ
      hideLoading(); // diagram + node skeleton đã render → gỡ overlay (ảnh thumbnail tự shimmer riêng)
    }, 250);
    setTimeout(() => { try { diagram.fitToScreen?.(); } catch (_) { globalThis.SEOSONA_swallow?.('template-preview-init#render', _); } scheduleConnRefresh(0); }, 650);

    console.log('[TemplatePreview] rendered template', tpl.id, 'nodes=', adapted.nodes.length);
  }

  // --- Nút "Use" → clone qua sidebar (đã LUÔN mở). KHÔNG mở side panel từ đây. ---
  let _using = false;
  function onUse() {
    if (_using || !currentTemplate) return;
    _using = true;
    const btn = document.getElementById('tpUseBtn');
    if (btn) btn.disabled = true;
    let closed = false;
    const close = () => { if (closed) return; closed = true; try { window.close(); } catch (_) { globalThis.SEOSONA_swallow?.('template-preview-init#close', _); } };
    // shared → cloneSharedWorkflow (sidebar handleDuplicateFromShared, endpoint shared-workflows/{id}/clone).
    // template → cloneWorkflowTemplate (sidebar _runCopyTemplate, endpoint workflow-templates/{id}/clone).
    const msg = previewKind === 'shared'
      ? { action: 'cloneSharedWorkflow', wfId: currentTemplate.wf_id, workflow: currentTemplate }
      : { action: 'cloneWorkflowTemplate', templateId: currentTemplate.id, template: currentTemplate };
    try {
      chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; close(); });
      setTimeout(close, 1200); // fallback nếu callback ko fire
    } catch (e) { console.warn('[TemplatePreview] use sendMessage failed:', e?.message); close(); }
  }

  async function init() {
    document.getElementById('tpUseBtn')?.addEventListener('click', onUse);
    document.getElementById('tpCloseBtn')?.addEventListener('click', () => { try { window.close(); } catch (_) { globalThis.SEOSONA_swallow?.('template-preview-init#init', _); } });
    // Loading text i18n (key dùng chung với workflow-editor).
    const _lt = document.getElementById('tpLoadingText');
    if (_lt) _lt.textContent = t('workflow.loadingEditor', 'Loading workflow…');
    // Fallback: gỡ overlay sau 8s phòng render lỗi (tránh kẹt loading vĩnh viễn).
    setTimeout(hideLoading, 8000);

    // Brand: hiển thị app_name (server config af_system_settings) thay hardcode "SEOSONA Flow".
    try {
      const ss = await new Promise(r => chrome.storage.local.get(['af_system_settings'], res => r(res.af_system_settings)));
      _appName = ss?.app_name || ss?.data?.app_name || '';
      applyBrand();
    } catch (_) { globalThis.SEOSONA_swallow?.('template-preview-init#init', _); }

    // Lightbox: click thumb ảnh node (ref/result) → xem phóng to (parity media viewer của editor).
    const lb = document.getElementById('tpLightbox');
    const lbImg = document.getElementById('tpLightboxImg');
    const closeLb = () => { lb?.classList.remove('show'); if (lbImg) lbImg.src = ''; };
    document.getElementById('diagramContainer')?.addEventListener('click', (e) => {
      // CHỈ nút zoom mở modal — click vùng ảnh khác = pan diagram (thumb pointer-events:none).
      const zoomBtn = e.target?.closest?.('.df-preview-zoom');
      if (!zoomBtn) return;
      const thumb = zoomBtn.closest('.df-preview-thumb, .df-ref-thumb');
      const src = thumb?.dataset?.mediaSrc || thumb?.querySelector('img')?.src;
      if (src && lb && lbImg) { e.preventDefault(); e.stopPropagation(); lbImg.src = src; lb.classList.add('show'); }
    });
    lb?.addEventListener('click', (e) => { if (e.target === lb || e.target.id === 'tpLightboxClose') closeLb(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLb(); });

    // I18n best-effort (có fallback inline từ src/i18n/*.js đã load).
    try { await window.I18n?.init?.(); } catch (_) { globalThis.SEOSONA_swallow?.('template-preview-init#closeLb', _); }
    // Re-localize loading text SAU init (trước init _currentLocale='vi' → text bị kẹt VI).
    if (_lt) _lt.textContent = t('workflow.loadingEditor', 'Loading workflow…');
    // NodeTemplates: cần node types để DiagramCanvas render. Đọc cache → fetch nếu cần.
    try { await window.NodeTemplates?.fetchFromServer?.(); } catch (e) { console.warn('[TemplatePreview] NodeTemplates:', e?.message); }
    // ValidationRules: charCountBadge cần prompt_max_length dynamic → ensure cache trước render (không fallback 5000).
    try { await window.ValidationRules?.fetch?.(); } catch (e) { console.warn('[TemplatePreview] ValidationRules:', e?.message); }

    // Đọc pending preview.
    let pending = null;
    try {
      pending = await new Promise(r => chrome.storage.local.get(['_pendingTemplatePreview'], res => r(res._pendingTemplatePreview)));
    } catch (_) { globalThis.SEOSONA_swallow?.('template-preview-init#closeLb', _); }
    if (pending?.template) {
      chrome.storage.local.remove('_pendingTemplatePreview');
      await render(pending.template, pending.kind || 'template');
    } else {
      document.getElementById('tpTitle').textContent = t('workflow.templateNotFound', 'Không tìm thấy template');
    }

    // Swap nội dung khác mà KHÔNG reload (reuse cửa sổ — background broadcast runtime.sendMessage).
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.action === 'loadTemplatePreview' && msg.template) {
        render(msg.template, msg.kind || 'template');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
