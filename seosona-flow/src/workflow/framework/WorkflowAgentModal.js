/**
 * SEOSONA Flow — WorkflowAgentModal (UI)
 * ------------------------------------------------------------------
 * Modal: gõ mô tả → WorkflowAgent.generate → xem kết quả (node/validate/graph) → Áp dụng vào editor.
 * Tự chèn nút "✨ Tạo bằng AI" cạnh #createWorkflowBtn. Tự chứa DOM + style (không phụ thuộc CSS ngoài).
 * Áp dụng = LocalStorage.saveWorkflowFull + workflowList._openWorkflow (đúng path _copyTemplateToWorkflow).
 */
(function (root) {
  'use strict';
  const A = root.WorkflowAgent;
  if (!A) { console.warn('[WorkflowAgentModal] thiếu WorkflowAgent'); }

  const CSS = `
  .wfa-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:100000;display:flex;align-items:center;justify-content:center;font-family:'Be Vietnam Pro',system-ui,sans-serif}
  .wfa-modal{background:#161821;color:#e8eaf0;width:min(680px,94vw);max-height:90vh;overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.08);box-shadow:0 24px 80px rgba(0,0,0,.5)}
  .wfa-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.07)}
  .wfa-head h3{margin:0;font-size:16px;font-weight:700}
  .wfa-x{background:none;border:none;color:#9aa0b4;font-size:20px;cursor:pointer;line-height:1}
  .wfa-body{padding:18px 20px;display:flex;flex-direction:column;gap:12px}
  .wfa-body textarea{width:100%;min-height:88px;resize:vertical;background:#0f1017;border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#e8eaf0;padding:10px 12px;font-size:14px;font-family:inherit}
  .wfa-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .wfa-row label{font-size:12px;color:#9aa0b4}
  .wfa-row select{background:#0f1017;border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#e8eaf0;padding:7px 10px;font-size:13px}
  .wfa-btn{border:none;border-radius:999px;padding:9px 18px;font-size:14px;font-weight:600;cursor:pointer}
  .wfa-btn.primary{background:linear-gradient(135deg,#3d6ff5,#0e4099);color:#fff}
  .wfa-btn.ghost{background:rgba(255,255,255,.08);color:#e8eaf0}
  .wfa-btn:disabled{opacity:.5;cursor:default}
  .wfa-status{font-size:13px;color:#9aa0b4;min-height:18px}
  .wfa-result{background:#0f1017;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;font-size:13px;display:none}
  .wfa-result.show{display:block}
  .wfa-ok{color:#19d07b}.wfa-err{color:#ff6b6b}.wfa-warn{color:#f5b74a}
  .wfa-graph{white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;color:#c8cee0;background:#0b0c12;border-radius:8px;padding:10px;margin-top:8px;max-height:180px;overflow:auto}
  .wfa-ex{font-size:12px;color:#6b7189}
  .wfa-ex b{color:#9aa0b4;cursor:pointer;text-decoration:underline}
  .wfa-foot{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid rgba(255,255,255,.07)}
  `;

  let _last = null; // template gần nhất để áp dụng

  function injectStyle() {
    if (document.getElementById('wfa-style')) return;
    const s = document.createElement('style'); s.id = 'wfa-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  function textGraph(tpl) {
    // levels theo topo đơn giản để hiển thị
    const byId = new Map(tpl.nodes.map(n => [n.id, n]));
    const indeg = new Map(); tpl.nodes.forEach(n => indeg.set(n.id, 0));
    tpl.edges.forEach(e => { if (indeg.has(e.target)) indeg.set(e.target, indeg.get(e.target) + 1); });
    const adj = new Map(); tpl.nodes.forEach(n => adj.set(n.id, []));
    tpl.edges.forEach(e => { if (adj.has(e.source)) adj.get(e.source).push(e.target); });
    let fr = tpl.nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id); const seen = new Set(); const out = [];
    let lv = 0;
    while (fr.length && lv <= tpl.nodes.length) {
      out.push('L' + lv + ': ' + fr.map(id => { const n = byId.get(id); return (n.data.node_name || n.type) + '[' + n.type + ']'; }).join('  •  '));
      fr.forEach(id => seen.add(id)); const nx = [];
      for (const id of fr) for (const t of adj.get(id)) { indeg.set(t, indeg.get(t) - 1); if (indeg.get(t) === 0) nx.push(t); }
      fr = nx; lv++;
    }
    return out.join('\n');
  }

  function open() {
    injectStyle();
    const ov = document.createElement('div'); ov.className = 'wfa-overlay';
    ov.innerHTML = `
      <div class="wfa-modal">
        <div class="wfa-head"><h3>✨ Tạo workflow bằng AI</h3><button class="wfa-x" data-x>×</button></div>
        <div class="wfa-body">
          <div class="wfa-ex">Mô tả bằng lời, ví dụ: <b data-ex>Từ 1 ảnh sản phẩm tạo 3 góc chụp studio rồi tải về</b></div>
          <textarea placeholder="Mô tả workflow bạn muốn tạo…"></textarea>
          <div class="wfa-row">
            <label>Provider</label>
            <select data-prov>
              <option value="chatgpt">ChatGPT</option>
              <option value="claude">Claude</option>
              <option value="grok">Grok</option>
              <option value="gemini">Gemini</option>
            </select>
            <button class="wfa-btn primary" data-gen>Tạo workflow</button>
            <span class="wfa-status" data-status></span>
          </div>
          <div class="wfa-result" data-result></div>
        </div>
        <div class="wfa-foot">
          <button class="wfa-btn ghost" data-x>Đóng</button>
          <button class="wfa-btn primary" data-apply disabled>Áp dụng vào editor</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const $ = (s) => ov.querySelector(s);
    const ta = $('textarea'), status = $('[data-status]'), result = $('[data-result]'), applyBtn = $('[data-apply]'), genBtn = $('[data-gen]');
    const close = () => ov.remove();
    ov.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close));
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    $('[data-ex]').addEventListener('click', () => { ta.value = $('[data-ex]').textContent; });

    genBtn.addEventListener('click', async () => {
      const nl = ta.value.trim();
      if (!nl) { status.textContent = 'Nhập mô tả trước.'; return; }
      if (!root.WorkflowAgent) { status.textContent = 'Thiếu WorkflowAgent.'; return; }
      genBtn.disabled = true; applyBtn.disabled = true; result.classList.remove('show'); _last = null;
      const r = await root.WorkflowAgent.generate(nl, { provider: $('[data-prov]').value, onStep: s => { status.textContent = s; } });
      genBtn.disabled = false;
      if (!r.ok && !r.template) {
        status.textContent = '';
        result.classList.add('show');
        result.innerHTML = `<span class="wfa-err">❌ Không tạo được: ${esc(r.error)}</span>` +
          (r.raw ? `<div class="wfa-graph">${esc(String(r.raw).slice(0, 400))}</div>` : '');
        return;
      }
      _last = r.template;
      const v = r.validation;
      status.textContent = '';
      result.classList.add('show');
      const warnHtml = v.warnings.length ? `<div class="wfa-warn">⚠️ ${v.warnings.length} cảnh báo: ${esc(v.warnings.slice(0, 3).map(w => w.msg).join(' · '))}</div>` : '';
      const errHtml = v.errors.length ? `<div class="wfa-err">❌ ${v.errors.length} lỗi: ${esc(v.errors.slice(0, 3).map(e => e.msg).join(' · '))}</div>` : '';
      result.innerHTML =
        `<div class="${v.ok ? 'wfa-ok' : 'wfa-err'}"><b>${esc(r.template.name)}</b> — ${v.stats.nodes} node, ${v.stats.levels} tầng ${v.ok ? '✓ hợp lệ' : ''}</div>` +
        errHtml + warnHtml +
        `<div class="wfa-graph">${esc(textGraph(r.template))}</div>`;
      applyBtn.disabled = !v.ok;   // chỉ cho áp dụng khi 0 lỗi
    });

    applyBtn.addEventListener('click', async () => {
      if (!_last) return;
      applyBtn.disabled = true; status.textContent = 'Đang lưu + mở editor…';
      try {
        const LS = root.LocalStorage; if (!LS) throw new Error('LocalStorage không có');
        const wf_id = 'wf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
        const wf = { wf_id, wf_name: _last.name || 'Workflow AI', wf_desc: _last.description || '',
          project_id: root._currentProjectId || null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          status: 'idle', platform: 'flow' };
        // FLATTEN canvas-shape → DB-shape TRƯỚC khi lưu (mirror WorkflowTemplateList.js:1854). Nếu không,
        // WorkflowExecutor._buildLocalPlan đọc node_id/source_node_id = undefined → run-from-list báo
        // CYCLE_DETECTED giả cho tới khi user mở editor lưu lại. (Editor tự heal khi mở, nhưng Run thì không.)
        const _ts = Date.now();
        const _nodes = (_last.nodes || []).map((n, i) => Object.assign({}, n.data || {}, {
          node_id: n.node_id || n.id || `node_${_ts}_${i}`,
          node_type: n.node_type || n.type,
          node_name: n.node_name || (n.data && n.data.node_name) || n.type,
          pos_x: n.pos_x ?? (n.position && n.position.x) ?? 100,
          pos_y: n.pos_y ?? (n.position && n.position.y) ?? 100,
        }));
        const _edges = (_last.edges || []).map((e, i) => ({
          edge_id: e.edge_id || e.id || `edge_${_ts}_${i}`,
          source_node_id: e.source_node_id || e.source,
          target_node_id: e.target_node_id || e.target,
          source_handle: e.source_handle || e.sourceHandle || 'output_1',
          target_handle: e.target_handle || e.targetHandle || 'input_1',
          source_port: e.source_port || 'default', target_port: e.target_port || 'default',
        }));
        await new LS().saveWorkflowFull(wf, _nodes, _edges);
        // WorkflowList KHÔNG expose ở window → lấy instance qua tab element (mirror app.js:8017).
        const _wl = root.workflowList
          || document.getElementById('tab-spaces')?.__seosonaflowTab?.workflowList;
        if (_wl?.loadWorkflows) await _wl.loadWorkflows();
        close();
        setTimeout(() => { if (_wl?._openWorkflow) _wl._openWorkflow(wf_id); else root.eventBus?.emit('workflow:open_editor', { mode: 'edit', workflow: wf }); }, 250);
        root.showNotification?.('Đã tạo workflow "' + wf.wf_name + '"', 'success');
      } catch (e) {
        status.textContent = 'Lỗi lưu: ' + e.message; applyBtn.disabled = false;
      }
    });
  }

  // Tự chèn / gắn event mở modal AI từ menu Dropdown "Tạo mới".
  function tryInjectButton(tries) {
    const aiOpt = document.getElementById('optCreateAi');
    if (aiOpt && !aiOpt._bound) {
      aiOpt._bound = true;
      aiOpt.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('wfCreateDropdown')?.classList.add('hidden');
        open();
      });
      return;
    }
    const createBtn = document.getElementById('createWorkflowBtn');
    if (!createBtn) { if ((tries || 0) < 20) return void setTimeout(() => tryInjectButton((tries || 0) + 1), 500); return; }
  }

  root.WorkflowAgentModal = { open };
  if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') tryInjectButton(0);
    else document.addEventListener('DOMContentLoaded', () => tryInjectButton(0));
  }
})(typeof self !== 'undefined' ? self : this);
