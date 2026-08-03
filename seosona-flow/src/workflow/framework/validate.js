/**
 * SEOSONA Flow — Workflow Framework · VALIDATOR
 * ------------------------------------------------------------------
 * Kiểm 1 workflow/template (shape canvas) chống schema thật + đồ thị + port + ngữ nghĩa.
 * Deterministic, không network. Trả { ok, errors[], warnings[], stats }.
 *
 * Mỗi issue: { level:'error'|'warn', code, msg, node?/edge? }
 *   error = sẽ vỡ canvas / không import / không chạy được.
 *   warn  = chạy được nhưng đáng ngờ (thiếu prompt, model lạ, node cô lập…).
 */
(function (root, factory) {
  const S = (typeof require !== 'undefined') ? require('./schema.js') : root.WFSchema;
  const mod = factory(S);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.WFValidate = mod;
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  function validateWorkflow(tpl) {
    const errors = [], warnings = [];
    let levels = []; // gán ở mục 3 (Kahn); done() đọc — khai báo sớm để early-return an toàn.
    const E = (code, msg, extra) => errors.push(Object.assign({ level: 'error', code, msg }, extra || {}));
    const W = (code, msg, extra) => warnings.push(Object.assign({ level: 'warn', code, msg }, extra || {}));

    // ---- 0. Envelope ----
    if (!tpl || typeof tpl !== 'object') { E('E_ENVELOPE', 'Template không phải object'); return done(); }
    for (const f of S.TEMPLATE_REQUIRED_FIELDS) {
      if (tpl[f] === undefined || tpl[f] === null) E('E_FIELD_MISSING', `Thiếu field bắt buộc: ${f}`);
    }
    const nodes = Array.isArray(tpl.nodes) ? tpl.nodes : [];
    const edges = Array.isArray(tpl.edges) ? tpl.edges : [];
    if (!Array.isArray(tpl.nodes)) E('E_NODES_TYPE', 'nodes phải là array');
    if (!Array.isArray(tpl.edges)) E('E_EDGES_TYPE', 'edges phải là array');
    if (!nodes.length) { W('W_EMPTY', 'Workflow rỗng (0 node)'); return done(); }

    // ---- 1. Structural: từng node ----
    const idSet = new Set();
    for (const n of nodes) {
      const tag = n && (n.id || '(no-id)');
      if (!n || typeof n !== 'object') { E('E_NODE_SHAPE', 'Node không phải object', { node: tag }); continue; }
      if (!n.id) E('E_NODE_ID', 'Node thiếu id', { node: tag });
      else if (idSet.has(n.id)) E('E_NODE_DUP_ID', `Trùng node id: ${n.id}`, { node: n.id });
      else idSet.add(n.id);
      if (!n.type) E('E_NODE_TYPE_MISSING', `Node ${tag} thiếu type`, { node: tag });
      else if (!S.isKnownType(n.type)) E('E_NODE_TYPE_UNKNOWN', `Node ${tag}: type "${n.type}" không có trong catalog`, { node: tag });
      if (!n.position || typeof n.position.x !== 'number' || typeof n.position.y !== 'number')
        W('W_NODE_POS', `Node ${tag} thiếu position{x,y} hợp lệ (canvas sẽ đặt 0,0)`, { node: tag });
      if (n.data == null || typeof n.data !== 'object') E('E_NODE_DATA', `Node ${tag} thiếu data{}`, { node: tag });
    }

    // ---- 2. Referential + port hợp lệ: từng edge ----
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const edgeIds = new Set();
    const inDegPortUsed = new Map();  // "nodeId:input_k" → count (phát hiện nối trùng cổng non-multiple)
    for (const e of edges) {
      const tag = e && (e.id || `${e && e.source}→${e && e.target}`);
      if (!e || typeof e !== 'object') { E('E_EDGE_SHAPE', 'Edge không phải object', { edge: tag }); continue; }
      if (e.id) { if (edgeIds.has(e.id)) W('W_EDGE_DUP_ID', `Trùng edge id: ${e.id}`, { edge: tag }); else edgeIds.add(e.id); }
      const src = nodeById.get(e.source), tgt = nodeById.get(e.target);
      if (!src) { E('E_EDGE_SRC', `Edge ${tag}: source "${e.source}" không tồn tại`, { edge: tag }); continue; }
      if (!tgt) { E('E_EDGE_TGT', `Edge ${tag}: target "${e.target}" không tồn tại`, { edge: tag }); continue; }
      if (e.source === e.target) E('E_EDGE_SELF', `Edge ${tag}: self-loop`, { edge: tag });

      const sh = S.parseHandle(e.sourceHandle), th = S.parseHandle(e.targetHandle);
      if (!sh || sh.dir !== 'output') E('E_EDGE_SRC_HANDLE', `Edge ${tag}: sourceHandle "${e.sourceHandle}" không hợp lệ`, { edge: tag });
      if (!th || th.dir !== 'input') E('E_EDGE_TGT_HANDLE', `Edge ${tag}: targetHandle "${e.targetHandle}" không hợp lệ`, { edge: tag });

      // Số handle khả dụng = max(số port ngữ nghĩa, scalar drawflow). Field inputs/outputs của
      // catalog là connector drawflow (legacy), ports_in/out mới là port thật (generate có 5 port_in
      // dù inputs=1). Node như merge có ports rỗng nhưng inputs=2 → dùng scalar.
      const sCat = S.NODE_CATALOG[src.type], tCat = S.NODE_CATALOG[tgt.type];
      const outCap = sCat ? Math.max((sCat.ports_out || []).length, sCat.outputs || 0) : 0;
      const inCap = tCat ? Math.max((tCat.ports_in || []).length, tCat.inputs || 0) : 0;
      if (sCat && sh && sh.dir === 'output' && sh.index > outCap)
        E('E_PORT_OUT_RANGE', `Edge ${tag}: ${src.type} chỉ có ${outCap} output port, dùng output_${sh.index}`, { edge: tag });
      if (tCat && th && th.dir === 'input' && th.index > inCap)
        E('E_PORT_IN_RANGE', `Edge ${tag}: ${tgt.type} chỉ có ${inCap} input port, dùng input_${th.index}`, { edge: tag });

      // Port TYPE compatibility (theo ports_out/ports_in trong catalog)
      const sp = S.portByHandle(src.type, e.sourceHandle);
      const tp = S.portByHandle(tgt.type, e.targetHandle);
      if (sp && tp) {
        const compat = S.PORT_TYPE_COMPAT[sp.type];
        if (compat && !compat.has(tp.type))
          E('E_PORT_TYPE', `Edge ${tag}: port type không khớp — ${src.type}.${sp.name}(${sp.type}) → ${tgt.type}.${tp.name}(${tp.type})`, { edge: tag });
        if (tp.acceptFromNodeTypes && !tp.acceptFromNodeTypes.includes(src.type))
          E('E_PORT_ACCEPT', `Edge ${tag}: ${tgt.type}.${tp.name} chỉ nhận từ [${tp.acceptFromNodeTypes.join(',')}], không nhận ${src.type}`, { edge: tag });
        // cổng non-multiple bị nối nhiều lần
        if (tp && tp.multiple === false) {
          const key = e.target + ':' + e.targetHandle;
          inDegPortUsed.set(key, (inDegPortUsed.get(key) || 0) + 1);
        }
      }
    }
    for (const [key, cnt] of inDegPortUsed) if (cnt > 1)
      W('W_PORT_MULTI', `Cổng ${key} (multiple:false) bị nối ${cnt} lần — chỉ 1 input được dùng`, {});

    // ---- 3. Graph: cycle + reachability (Kahn, mirror _buildLocalPlan) ----
    const indeg = new Map(), adj = new Map();
    nodes.forEach(n => { indeg.set(n.id, 0); adj.set(n.id, []); });
    for (const e of edges) {
      if (nodeById.has(e.source) && nodeById.has(e.target) && e.source !== e.target) {
        adj.get(e.source).push(e.target);
        indeg.set(e.target, indeg.get(e.target) + 1);
      }
    }
    let frontier = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id);
    const done_ = new Set(); let level = 0;
    while (frontier.length && level <= nodes.length) {
      levels.push(frontier.slice());
      frontier.forEach(id => done_.add(id));
      const next = [];
      for (const id of frontier) for (const t of adj.get(id)) {
        indeg.set(t, indeg.get(t) - 1);
        if (indeg.get(t) === 0) next.push(t);
      }
      frontier = next; level++;
    }
    if (done_.size !== nodes.length) {
      const stuck = nodes.filter(n => !done_.has(n.id)).map(n => n.id);
      E('E_CYCLE', `Workflow có cycle (vòng lặp) — node kẹt: ${stuck.join(', ')}`, { nodes: stuck });
    }

    // ---- 4. Semantic: theo từng node ----
    const gens = ['generate', 'chatgpt', 'grok'];
    for (const n of nodes) {
      if (!n || !n.type || !S.isKnownType(n.type)) continue;
      const d = n.data || {};
      const cat = S.NODE_CATALOG[n.type];
      const tag = n.id;

      // node sink (download/telegram/output/note) không cần prompt
      const isGen = gens.includes(n.type);
      const isVideo = d.media_type === 'Video' || (n.type === 'grok' && d.grok_mode === 'video');

      if (isGen || n.type === 'prompt') {
        // prompt rỗng + không có cổng text nối vào → không có gì để tạo
        const hasTextEdge = edges.some(e => e.target === n.id && /^input_/.test(e.targetHandle || '') &&
          (S.portByHandle(n.type, e.targetHandle) || {}).type === 'text');
        if ((d.prompt == null || String(d.prompt).trim() === '') && !hasTextEdge)
          W('W_NO_PROMPT', `Node ${tag} (${n.type}): prompt rỗng và không có cổng text nối vào`, { node: tag });
      }

      // model hợp lệ theo media_type (chỉ với generate/flow)
      if (n.type === 'generate' && d.model) {
        const pool = isVideo ? S.ENUMS.videoModels : S.ENUMS.imageModels;
        if (!pool.includes(d.model))
          W('W_MODEL', `Node ${tag}: model "${d.model}" không thuộc danh sách ${isVideo ? 'video' : 'image'} đã biết`, { node: tag });
      }
      // ratio hợp lệ — CHỈ với generate (Flow). chatgpt/grok có bộ ratio riêng ("story"…) không kiểm.
      if (n.type === 'generate' && d.ratio != null) {
        const r = S.normalizeRatio(d.ratio);
        const pool = isVideo ? S.ENUMS.videoRatios : S.ENUMS.imageRatios;
        if (!pool.includes(r))
          W('W_RATIO', `Node ${tag}: ratio "${d.ratio}"→"${r}" không thuộc ${isVideo ? 'video' : 'image'} [${pool.join(',')}]`, { node: tag });
      }
      // media_type hợp lệ
      if (d.media_type != null && !S.ENUMS.mediaTypes.includes(d.media_type))
        W('W_MEDIA_TYPE', `Node ${tag}: media_type "${d.media_type}" lạ (chờ Image|Video)`, { node: tag });

      // condition node phải có nhánh true/false nối ra
      if (n.type === 'condition') {
        const outs = new Set(edges.filter(e => e.source === n.id).map(e => e.sourceHandle));
        if (!outs.size) W('W_COND_NOOUT', `Condition ${tag} không có nhánh nào nối ra (true/false)`, { node: tag });
      }

      // node cô lập (không cạnh nào) — trừ note
      if (n.type !== 'note') {
        const touched = edges.some(e => e.source === n.id || e.target === n.id);
        if (!touched && nodes.length > 1) W('W_ISOLATED', `Node ${tag} (${n.type}) cô lập — không nối cạnh nào`, { node: tag });
      }

      // node yêu cầu input bắt buộc nhưng không có cạnh vào (sink cần media_in)
      const reqIn = (cat.ports_in || []).filter(p => p.required);
      if (reqIn.length) {
        const hasIn = edges.some(e => e.target === n.id);
        if (!hasIn) W('W_REQ_INPUT', `Node ${tag} (${n.type}) cần input bắt buộc [${reqIn.map(p => p.name).join(',')}] nhưng không có cạnh vào`, { node: tag });
      }
    }

    // ---- 5. node_count khớp (chỉ khi >0; template bundled để 0 = "chưa set", bỏ qua) ----
    if (typeof tpl.node_count === 'number' && tpl.node_count > 0 && tpl.node_count !== nodes.length)
      W('W_NODE_COUNT', `node_count=${tpl.node_count} nhưng thực có ${nodes.length} node`, {});

    function done() {
      const provs = new Set(nodes.map(S.providerOf).filter(Boolean));
      return {
        ok: errors.length === 0,
        errors, warnings,
        stats: {
          nodes: nodes.length, edges: edges.length,
          levels: levels.length,
          is_mixed_providers: provs.size > 1,
          providers: [...provs],
          errorCount: errors.length, warnCount: warnings.length,
        },
      };
    }
    return done();
  }

  return { validateWorkflow };
});
