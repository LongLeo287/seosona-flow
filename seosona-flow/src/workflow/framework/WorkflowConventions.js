/**
 * WorkflowConventions — khai thác QUY ƯỚC THẬT từ các workflow đang chạy (BUNDLED_TEMPLATES),
 * rồi tóm tắt cho agent AI. Học từ ví dụ thật thay vì mô tả tay.
 *
 * Vì sao cần: prompt viết tay của agent từng lệch thực tế ở nhiều điểm — bảo dùng ratio
 * "Ngang/Dọc/Vuông" trong khi template thật dùng "16:9"/"9:16" áp đảo; bảo nối ảnh→video vào
 * input_1 trong khi thật ra là cổng frame_1/frame_2; và không hề nhắc node text_extract dù nó là
 * node phổ biến thứ 5. Mô tả tay sẽ tiếp tục lệch mỗi khi template đổi — khai thác thì tự cập nhật.
 *
 * API:
 *   WorkflowConventions.mine(templates)  -> { nodes, edges, values }
 *   WorkflowConventions.summary(limitEdges) -> string  (chèn vào prompt của agent)
 */
(function (root) {
  'use strict';

  function _templates() {
    return root.BUNDLED_TEMPLATES || root.SEOSONA_BUNDLED_TEMPLATES || [];
  }

  function mine(templates) {
    var T = templates || _templates();
    var nodes = {};   // type -> { count, fields:{f:count} }
    var edges = {};   // "src->dst [sp->tp]" -> count
    var values = { media_type: {}, ratio: {}, modelImage: {}, modelVideo: {} };

    (T || []).forEach(function (t) {
      var byId = {};
      (t.nodes || []).forEach(function (n) { byId[n.id] = n.type; });

      (t.nodes || []).forEach(function (n) {
        var e = nodes[n.type] = nodes[n.type] || { count: 0, fields: {} };
        e.count++;
        var d = n.data || {};
        Object.keys(d).forEach(function (k) {
          if (d[k] === '' || d[k] == null) return;
          // bỏ field khung sườn (mọi node đều có) — không mang thông tin quy ước
          if (/^(slug|slug_auto|node_name|label|enabled|node_type|node_zoom)$/.test(k)) return;
          e.fields[k] = (e.fields[k] || 0) + 1;
        });
        if (n.type === 'generate') {
          if (d.media_type) values.media_type[d.media_type] = (values.media_type[d.media_type] || 0) + 1;
          if (d.ratio) values.ratio[d.ratio] = (values.ratio[d.ratio] || 0) + 1;
          if (d.model) {
            var bucket = d.media_type === 'Video' ? values.modelVideo : values.modelImage;
            bucket[d.model] = (bucket[d.model] || 0) + 1;
          }
        }
      });

      (t.edges || []).forEach(function (e) {
        var s = byId[e.source], dt = byId[e.target];
        if (!s || !dt) return;
        var sp = e.source_port || e.sourceHandle || '?';
        var tp = e.target_port || e.targetHandle || '?';
        var k = s + ' -> ' + dt + ' [' + sp + ' -> ' + tp + ']';
        edges[k] = (edges[k] || 0) + 1;
      });
    });

    return { nodes: nodes, edges: edges, values: values, total: (T || []).length };
  }

  function _top(obj, n) {
    return Object.keys(obj || {}).map(function (k) { return [k, obj[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, n || 6);
  }

  /** Tóm tắt quy ước (tiếng Anh — đây là text gửi cho model). */
  function summary(limitEdges) {
    var m = mine();
    if (!m.total) return '';
    var L = [];

    L.push('LEARNED CONVENTIONS (mined from ' + m.total + ' working workflows in this app — follow these, they are ground truth):');

    var edges = _top(m.edges, limitEdges || 14);
    if (edges.length) {
      L.push('Wiring patterns actually used (source -> target [source_port -> target_port], with usage count):');
      edges.forEach(function (e) { L.push('  ' + e[0] + '   (x' + e[1] + ')'); });
    }

    var nodeLines = _top(m.nodes, 12).map(function (e) {
      var f = _top(e[1].fields, 6).map(function (x) { return x[0]; }).join(', ');
      return '  ' + e[0] + ' (used ' + e[1].count + 'x)' + (f ? ' — data fields: ' + f : '');
    });
    if (nodeLines.length) { L.push('Node types by real usage, with the data fields they actually set:'); L.push.apply(L, nodeLines); }

    var v = m.values;
    var fmt = function (o) { return _top(o, 5).map(function (x) { return '"' + x[0] + '" (' + x[1] + 'x)'; }).join(', '); };
    L.push('Values actually used on generate nodes:');
    L.push('  media_type: ' + fmt(v.media_type));
    L.push('  ratio: ' + fmt(v.ratio) + '  <- prefer the most-used form');
    L.push('  image models: ' + fmt(v.modelImage));
    L.push('  video models: ' + fmt(v.modelVideo));

    return L.join('\n');
  }

  root.WorkflowConventions = { mine: mine, summary: summary };
})(typeof self !== 'undefined' ? self : this);
