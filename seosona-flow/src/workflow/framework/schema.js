/**
 * SEOSONA Flow — Workflow Framework · SCHEMA CORE
 * ------------------------------------------------------------------
 * Nền tảng dùng chung cho: validator, operations (create/clone/adjust),
 * Skill authoring, và (phase 2) agent runtime trong extension.
 *
 * Trích 100% từ code THẬT của extension:
 *   - node catalog: src/workflow/NodeTemplates.js  (getter `types` + getDefaultData)
 *   - model/ratio : src/core/ProviderConfigManager._LOCAL_API_CONFIGS.flow.configs
 *   - shape node/edge/template: src/workflow/BundledTemplates.js (14 template thật)
 *   - execution   : src/core/WorkflowExecutor._buildLocalPlan
 *
 * KHÔNG phụ thuộc network/OS. Chạy được trong Node (authoring/CLI) và browser (extension).
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;      // Node / CLI
  else root.WFSchema = mod;                                                        // browser global
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── NODE CATALOG (18 type) — nạp từ node-catalog.json khi ở Node, hoặc global khi ở browser ──
  let NODE_CATALOG;
  try {
    // eslint-disable-next-line global-require
    NODE_CATALOG = require('./node-catalog.json');
  } catch (_) {
    NODE_CATALOG = (typeof self !== 'undefined' && self.WF_NODE_CATALOG) || {};
  }

  // ── ENUM giá trị hợp lệ (từ _LOCAL_API_CONFIGS.flow.configs) ──
  const ENUMS = {
    imageModels: ['Nano Banana 2', 'Nano Banana Pro', 'nano-banana-2', 'nano-banana-pro'],
    videoModels: ['Omni Flash', 'Veo 3.1 - Fast', 'Veo 3.1 - Lite', 'Veo 3.1 - Quality',
      'omni-flash', 'veo-3.1-fast', 'veo-3.1-lite', 'veo-3.1-quality'],
    imageRatios: ['16:9', '4:3', '1:1', '3:4', '9:16'],
    videoRatios: ['16:9', '9:16'],
    // Template thật lưu ratio dạng nhãn tiếng Việt → map (NodeTemplates.js:1029)
    ratioLabels: { 'Ngang': '16:9', 'Dọc': '9:16', 'Vuông': '1:1' },
    mediaTypes: ['Image', 'Video'],
    genTypes: ['flow', 'openai', 'grok'],         // gen_type: engine tạo media
    chatProviders: ['chatgpt', 'grok', 'gemini', 'claude'],
  };

  // ── PORT TYPE compatibility: sourcePortType → tập targetPortType chấp nhận ──
  // 'any' nhận & cho mọi loại; 'none' (note) không nối. frame/video là con của image-flow.
  const PORT_TYPE_COMPAT = {
    image: new Set(['image', 'any', 'frame', 'video']),
    text: new Set(['text', 'any']),
    frame: new Set(['frame', 'image', 'any']),
    video: new Set(['video', 'any']),
    any: new Set(['image', 'text', 'frame', 'video', 'any']),
    none: new Set([]),
  };

  // Nhóm chức năng — dùng để phân loại + gợi ý khi tạo/quản lý.
  const NODE_GROUPS = {
    input: ['image', 'text'],
    generator: ['generate', 'chatgpt', 'grok'],
    text_processing: ['prompt', 'text_template', 'text_extract', 'random_pick', 'prompt_sequence', 'variant_expand'],
    logic: ['condition', 'merge', 'delay'],
    sink: ['download', 'telegram', 'output'],
    annotation: ['note'],
    misc: ['transform'],
  };

  // ── Handle drawflow ↔ chỉ số port ──
  // Edge dùng handle vị trí: 'output_1' = out-port thứ 1, 'input_2' = in-port thứ 2 (1-based).
  function parseHandle(h) {
    const m = /^(input|output)_(\d+)$/.exec(String(h || ''));
    if (!m) return null;
    return { dir: m[1], index: parseInt(m[2], 10) }; // index 1-based
  }
  function makeHandle(dir, index1) { return dir + '_' + index1; }

  // Lấy định nghĩa port (từ catalog) theo handle vị trí.
  function portByHandle(type, handle) {
    const cat = NODE_CATALOG[type];
    if (!cat) return null;
    const p = parseHandle(handle);
    if (!p) return null;
    const list = p.dir === 'output' ? cat.ports_out : cat.ports_in;
    return list && list[p.index - 1] ? list[p.index - 1] : null;
  }

  // ── Mapping CANVAS (drawflow) → EXECUTION (WorkflowExecutor) ──
  // Executor đọc: node_id, node_type, node_name, use_ai, provider, enabled + data fields phẳng.
  // Canvas node: {id, type, position, data:{...}}. Mapping gần 1:1 (rename + phẳng data).
  function toExecutorNode(canvasNode) {
    const d = canvasNode.data || {};
    const type = canvasNode.type;
    const ex = Object.assign({}, d, {
      node_id: canvasNode.id,
      node_type: type,
      node_name: d.node_name || canvasNode.type,
      enabled: d.enabled !== false,
    });
    // 'prompt' node dùng AI (use_ai) khi provider đặt; generate/image/... theo gen_type.
    if (type === 'prompt') ex.use_ai = d.use_ai === true || !!d.provider;
    return ex;
  }
  function toExecutorEdge(canvasEdge) {
    const si = parseHandle(canvasEdge.sourceHandle);
    const ti = parseHandle(canvasEdge.targetHandle);
    return {
      source_node_id: canvasEdge.source,
      target_node_id: canvasEdge.target,
      source_port: si ? si.index : 1,
      target_port: ti ? ti.index : 1,
    };
  }

  // node_type → provider (mirror WorkflowExecutor._acquireLockForNodeType) — dùng cho is_mixed + lock.
  function providerOf(node) {
    const ty = node.type || node.node_type;
    const d = node.data || node;
    if (['generate', 'download', 'image', 'telegram', 'delay'].includes(ty)) return 'flow';
    if (ty === 'chatgpt') return 'chatgpt';
    if (ty === 'grok') return 'grok';
    if (ty === 'prompt' && (d.use_ai === true || !!d.provider)) return d.provider || 'chatgpt';
    return null;
  }

  // Chuẩn hoá ratio (nhãn VN → aspect) để so enum.
  function normalizeRatio(r) {
    if (r == null) return null;
    return ENUMS.ratioLabels[r] || r;
  }

  function isKnownType(type) { return Object.prototype.hasOwnProperty.call(NODE_CATALOG, type); }

  return {
    NODE_CATALOG, ENUMS, PORT_TYPE_COMPAT, NODE_GROUPS,
    parseHandle, makeHandle, portByHandle,
    toExecutorNode, toExecutorEdge, providerOf, normalizeRatio, isKnownType,
    // template envelope: field bắt buộc tối thiểu để import được vào extension
    TEMPLATE_REQUIRED_FIELDS: ['id', 'name', 'nodes', 'edges'],
    TEMPLATE_RECOMMENDED_FIELDS: ['slug', 'description', 'category_id', 'node_count', 'thumbnail_url'],
  };
});
