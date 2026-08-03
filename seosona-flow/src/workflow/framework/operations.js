/**
 * SEOSONA Flow — Workflow Framework · OPERATIONS
 * ------------------------------------------------------------------
 * Tạo / clone / điều chỉnh / quản lý workflow (shape canvas import-được vào extension).
 * Mọi op MUTATE bản sao (không đụng input) và trả { template, validation }.
 *
 * ID theo đúng format thật của extension:  node_<ms>_<hex8>  ·  edge_<hex>
 * Auto-layout: xếp node theo level topo (x = level*320, y = thứ tự*160).
 */
(function (root, factory) {
  const S = (typeof require !== 'undefined') ? require('./schema.js') : root.WFSchema;
  const V = (typeof require !== 'undefined') ? require('./validate.js') : root.WFValidate;
  const mod = factory(S, V);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.WFOps = mod;
})(typeof self !== 'undefined' ? self : this, function (S, V) {
  'use strict';

  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ── ID generator (deterministic-friendly: counter + optional seed) ──
  let _c = 0;
  function _hex(n) { // hex giả từ counter+seed, ổn định trong 1 tiến trình
    let x = (_c * 2654435761 + n * 40503) >>> 0;
    return ('00000000' + x.toString(16)).slice(-8);
  }
  function newNodeId() { _c++; return 'node_' + (1780000000000 + _c) + '_' + _hex(_c); }
  function newEdgeId(si, sh, ti, th) { return 'edge_' + si.slice(-4) + '_' + sh + '_' + ti.slice(-4) + '_' + th; }

  // Default data cho 1 node type (từ catalog + mặc định an toàn cho gen).
  function defaultData(type, over) {
    const cat = S.NODE_CATALOG[type] || {};
    const base = { node_name: cat.name || type, label: cat.name || type, enabled: true, slug: type, slug_auto: true };
    if (['generate', 'chatgpt', 'grok'].includes(type)) {
      Object.assign(base, { prompt: '', media_type: 'Image', model: type === 'generate' ? 'Nano Banana 2' : undefined,
        ratio: 'Ngang', quantity: 1, gen_type: type === 'generate' ? 'flow' : (type === 'chatgpt' ? 'openai' : 'grok'), auto_download: false });
    }
    if (type === 'prompt') Object.assign(base, { prompt: '', use_ai: false });
    if (type === 'delay') base.delay_seconds = 3;
    return Object.assign(base, over || {});
  }

  function nodeSkeleton(type, data, pos) {
    return { id: newNodeId(), type, position: { x: pos ? pos.x : 0, y: pos ? pos.y : 0 }, data: defaultData(type, data) };
  }

  // Xếp lại vị trí theo level topo (đọc đồ thị hiện tại).
  function autoLayout(tpl) {
    const nodes = tpl.nodes, edges = tpl.edges;
    const indeg = new Map(), adj = new Map();
    nodes.forEach(n => { indeg.set(n.id, 0); adj.set(n.id, []); });
    edges.forEach(e => { if (indeg.has(e.target) && adj.has(e.source) && e.source !== e.target) { adj.get(e.source).push(e.target); indeg.set(e.target, indeg.get(e.target) + 1); } });
    let frontier = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id);
    const seen = new Set(); let lv = 0;
    const byId = new Map(nodes.map(n => [n.id, n]));
    while (frontier.length && lv <= nodes.length) {
      frontier.forEach((id, i) => { const n = byId.get(id); if (n) n.position = { x: lv * 320 + 80, y: i * 160 + 80 }; seen.add(id); });
      const next = [];
      for (const id of frontier) for (const t of adj.get(id)) { indeg.set(t, indeg.get(t) - 1); if (indeg.get(t) === 0) next.push(t); }
      frontier = next; lv++;
    }
    // node còn lại (cycle/cô lập) xếp hàng cuối
    let k = 0; nodes.forEach(n => { if (!seen.has(n.id)) n.position = { x: lv * 320 + 80, y: (k++) * 160 + 80 }; });
    return tpl;
  }

  function ret(tpl) { autoLayout(tpl); tpl.node_count = (tpl.nodes || []).length; return { template: tpl, validation: V.validateWorkflow(tpl) }; }

  // ══════════════════ CREATE ══════════════════
  // spec = { name, description?, category_id?, nodes:[{type, data?}], edges:[[fromIdx, fromPortIdx, toIdx, toPortIdx]] }
  // fromPortIdx/toPortIdx 1-based (mặc định 1). Trả template hoàn chỉnh + validation.
  function createWorkflow(spec) {
    if (!spec || !Array.isArray(spec.nodes)) throw new Error('createWorkflow: spec.nodes phải là array');
    const nodes = spec.nodes.map(ns => nodeSkeleton(ns.type, ns.data, ns.position));
    const idx = (i) => { if (i < 0 || i >= nodes.length) throw new Error('edge trỏ node index ' + i + ' ngoài phạm vi'); return nodes[i].id; };
    const edges = (spec.edges || []).map(([fi, fp, ti, tp]) => {
      const si = idx(fi), ti_ = idx(ti); const sh = S.makeHandle('output', fp || 1), th = S.makeHandle('input', tp || 1);
      return { id: newEdgeId(si, sh, ti_, th), source: si, target: ti_, sourceHandle: sh, targetHandle: th };
    });
    const name = spec.name || 'Workflow mới';
    const tpl = {
      id: spec.id || (900000 + (_c % 100000)),
      name, slug: slugify(name),
      description: spec.description || '',
      thumbnail_url: spec.thumbnail_url || null, video_url: spec.video_url || null,
      category_id: spec.category_id || 1,
      nodes, edges, settings: spec.settings || {},
      node_count: nodes.length, is_active: true, visibility: 'private', is_public: false,
    };
    return ret(tpl);
  }

  // ══════════════════ CLONE ══════════════════
  // Nhân bản template: SINH LẠI toàn bộ id (node+edge), remap cạnh, áp overrides.
  // overrides = { name?, description?, category_id?, applyToNodes?: (data,node)=>patch, nodePatch?: {model,ratio,quantity,...} }
  function cloneTemplate(src, overrides) {
    overrides = overrides || {};
    const t = clone(src);
    const map = new Map();
    for (const n of t.nodes) { const nid = newNodeId(); map.set(n.id, nid); n.id = nid; }
    for (const e of t.edges) {
      e.source = map.get(e.source) || e.source;
      e.target = map.get(e.target) || e.target;
      e.id = newEdgeId(e.source, e.sourceHandle || 'output_1', e.target, e.targetHandle || 'input_1');
    }
    // đổi meta
    if (overrides.name) { t.name = overrides.name; t.slug = slugify(overrides.name); }
    if (overrides.description != null) t.description = overrides.description;
    if (overrides.category_id != null) t.category_id = overrides.category_id;
    t.id = overrides.id || (900000 + (_c % 100000));
    t.visibility = 'private'; t.is_public = false; t.use_count = 0; t.rating_avg = 0; t.rating_count = 0;
    // patch node data
    if (overrides.nodePatch || overrides.applyToNodes) {
      for (const n of t.nodes) {
        if (overrides.nodePatch && ['generate', 'chatgpt', 'grok', 'prompt'].includes(n.type)) Object.assign(n.data, overrides.nodePatch);
        if (typeof overrides.applyToNodes === 'function') { const p = overrides.applyToNodes(n.data, n); if (p) Object.assign(n.data, p); }
      }
    }
    return ret(t);
  }

  // ══════════════════ ADJUST (node-level) ══════════════════
  function adjustNode(tpl, nodeId, patch) {
    const t = clone(tpl); const n = t.nodes.find(x => x.id === nodeId);
    if (!n) throw new Error('adjustNode: không thấy node ' + nodeId);
    Object.assign(n.data, patch || {});
    return ret(t);
  }
  function addNode(tpl, opt) { // opt = { type, data?, connectFrom?: {nodeId, fromPort?, toPort?} }
    const t = clone(tpl); const n = nodeSkeleton(opt.type, opt.data);
    t.nodes.push(n);
    if (opt.connectFrom && opt.connectFrom.nodeId) {
      const sh = S.makeHandle('output', opt.connectFrom.fromPort || 1), th = S.makeHandle('input', opt.connectFrom.toPort || 1);
      t.edges.push({ id: newEdgeId(opt.connectFrom.nodeId, sh, n.id, th), source: opt.connectFrom.nodeId, target: n.id, sourceHandle: sh, targetHandle: th });
    }
    return ret(t);
  }
  function removeNode(tpl, nodeId) {
    const t = clone(tpl);
    t.nodes = t.nodes.filter(n => n.id !== nodeId);
    t.edges = t.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
    return ret(t);
  }
  function connect(tpl, fromId, toId, fromPort, toPort) {
    const t = clone(tpl);
    const sh = S.makeHandle('output', fromPort || 1), th = S.makeHandle('input', toPort || 1);
    t.edges.push({ id: newEdgeId(fromId, sh, toId, th), source: fromId, target: toId, sourceHandle: sh, targetHandle: th });
    return ret(t);
  }

  // ══════════════════ MANAGE (library) ══════════════════
  function listNodeTypes() {
    return Object.entries(S.NODE_CATALOG).map(([type, c]) => ({
      type, name: c.name, group: groupOf(type),
      inputs: Math.max((c.ports_in || []).length, c.inputs || 0),
      outputs: Math.max((c.ports_out || []).length, c.outputs || 0),
      ports_in: (c.ports_in || []).map(p => `${p.name}(${p.type}${p.multiple ? '*' : ''})`),
      ports_out: (c.ports_out || []).map(p => p.name),
    }));
  }
  function describeNodeType(type) {
    const c = S.NODE_CATALOG[type]; if (!c) return null;
    return { type, name: c.name, group: groupOf(type), color: c.color, portType: c.portType,
      ports_in: c.ports_in, ports_out: c.ports_out, default_data_keys: c.default_data_keys };
  }
  function groupOf(type) { for (const [g, list] of Object.entries(S.NODE_GROUPS)) if (list.includes(type)) return g; return 'misc'; }

  // Quản lý bộ template: dedupe theo slug, gắn node_count, sort theo category.
  function organizeLibrary(templates) {
    const seen = new Set(); const out = [];
    for (const t of templates) {
      const key = t.slug || slugify(t.name || '') || String(t.id);
      if (seen.has(key)) continue; seen.add(key);
      t.node_count = (t.nodes || []).length;
      out.push(t);
    }
    out.sort((a, b) => (a.category_id || 0) - (b.category_id || 0) || (a.sort_order || 0) - (b.sort_order || 0));
    return out;
  }

  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }

  // reset counter (cho test tất định)
  function _resetIds(seed) { _c = seed || 0; }

  return {
    createWorkflow, cloneTemplate,
    adjustNode, addNode, removeNode, connect,
    listNodeTypes, describeNodeType, organizeLibrary,
    autoLayout, defaultData, slugify, _resetIds,
  };
});
