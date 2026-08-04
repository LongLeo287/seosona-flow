/**
 * BundledWorkflowsExtra — workflow mẫu do SEOSONA Flow tự soạn (100% local, KHÔNG URL/asset ngoài).
 * Append vào window.BUNDLED_TEMPLATES (đọc bởi WorkflowTemplateList). Đúng scope Flow:
 * prompt → generate → capture → download. Mỗi template là 1 scaffold n8n user clone rồi chỉnh.
 * Load SAU BundledTemplates.js (xem pages/sidebar.html). Idempotent: guard trùng id.
 *
 * Node data field (khớp WorkflowExecutor):
 *  - text / text_template / note: nội dung ở data.prompt (text_template dùng {{input}},{{input1}}...)
 *  - condition: data.condition_op (has_text/no_text/contains/regex/has_result) + data.condition_value
 *  - generate/chatgpt/grok: data.prompt=null + prompt_source:'upstream_node' → lấy text từ upstream
 * Handle: text→gen dùng input_2 (port text), image→gen input_1; source luôn output_1;
 *         condition true=output_1 / false=output_2.
 */
(function (root) {
  var COL = [120, 480, 840, 1200]; // x các cột trái→phải

  function textNode(id, x, y, name, text) {
    return { id: id, type: 'text', position: { x: x, y: y }, data: {
      node_name: name, label: name, prompt: text, enabled: true,
      node_zoom: 1, slug: 'text', slug_auto: true } };
  }
  function aiNode(id, x, y, name, instruction) {
    return { id: id, type: 'prompt', position: { x: x, y: y }, data: {
      node_name: name, label: name, prompt: instruction, model: 'Nano Banana 2',
      ratio: 'Ngang', quantity: 1, enabled: true, media_type: 'Image', gen_type: 'flow',
      ref_img_urls: [], result_img_url: null, auto_download: false, node_zoom: 1,
      slug: 'prompt_assistant', slug_auto: true, ref_file_names: [], timeout_sec: 60,
      max_ref_images: 4 } };
  }
  function ttNode(id, x, y, name, template) {
    return { id: id, type: 'text_template', position: { x: x, y: y }, data: {
      node_name: name, label: name, prompt: template, enabled: true,
      node_zoom: 1, slug: 'text_template', slug_auto: true } };
  }
  function pickNode(id, x, y, name) {
    return { id: id, type: 'random_pick', position: { x: x, y: y }, data: {
      node_name: name, label: name, enabled: true, node_zoom: 1,
      slug: 'random_pick', slug_auto: true } };
  }
  function seqNode(id, x, y, name, opts) {
    opts = opts || {};
    return { id: id, type: 'prompt_sequence', position: { x: x, y: y }, data: {
      node_name: name, label: name, split_mode: opts.split_mode || 'auto',
      split_separator: opts.split_separator || '---', max_scenes: opts.max_scenes || 0,
      scene_prefix: opts.scene_prefix || '', scene_suffix: opts.scene_suffix || '',
      enabled: true, node_zoom: 1, slug: 'prompt_sequence', slug_auto: true } };
  }
  function condNode(id, x, y, name, op, value) {
    return { id: id, type: 'condition', position: { x: x, y: y }, data: {
      node_name: name, label: name, condition_op: op, condition_value: value || '',
      enabled: true, node_zoom: 1, slug: 'condition', slug_auto: true } };
  }
  function noteNode(id, x, y, text) {
    return { id: id, type: 'note', position: { x: x, y: y }, data: {
      node_name: 'Note', label: 'Note', prompt: text, enabled: true,
      node_zoom: 1, slug: 'note', slug_auto: true } };
  }
  function genNode(id, x, y, name, opts) {
    opts = opts || {};
    var isVideo = opts.media_type === 'Video';
    return { id: id, type: opts.type || 'generate', position: { x: x, y: y }, data: {
      node_name: name, label: name, prompt: null,
      // ĐÚNG ĐỊNH DẠNG: Video → model video "Omni Flash" + video_duration hợp lệ (4s/6s/10s).
      // Ảnh → "Nano Banana 2". (Trước: video template lỡ dùng model ảnh + duration '5s' không hợp lệ.)
      model: opts.model || (isVideo ? 'Omni Flash' : 'Nano Banana 2'),
      ratio: opts.ratio || (isVideo ? '9:16' : '1:1'),
      quantity: opts.quantity || 1, enabled: true,
      media_type: opts.media_type || 'Image', gen_type: 'flow',
      ref_img_urls: [], result_img_url: null, auto_download: false,
      video_duration: isVideo ? (opts.video_duration || '6s') : null, node_zoom: 1,
      slug: opts.slug || 'flow_image_video_generate', slug_auto: true,
      prompt_mode: 'all', ref_mode: 'all', ref_file_names: [],
      download_resolution: '1k', video_download_resolution: '720p',
      prompt_source: 'upstream_node', provider: opts.provider || undefined,
      video_input_type: null, frame_1_source: null, frame_2_source: null } };
  }
  // Node ẢNH THAM CHIẾU (placeholder — user thả ảnh của mình vào). slug cố định để AI Agent @mention.
  function imgRefNode(id, x, y, name, slug) {
    return { id: id, type: 'image', position: { x: x, y: y }, data: {
      node_name: name, label: name, prompt: null, model: 'Nano Banana 2', ratio: 'Ngang',
      quantity: 1, enabled: true, media_type: 'Image', gen_type: 'flow',
      ref_img_urls: [], result_img_url: null, auto_download: false, node_zoom: 1,
      slug: slug, slug_auto: false, ref_file_names: [], max_ref_images: 1,
      video_input_type: null, frame_1_source: null, frame_2_source: null } };
  }
  function dlNode(id, x, y) {
    return { id: id, type: 'download', position: { x: x, y: y }, data: {
      node_name: 'Download', label: 'Download', enabled: true,
      node_zoom: 1, slug: 'download', slug_auto: true,
      // Config chuẩn node download. Bỏ 'auto_download' (field của node GEN, không dùng ở download →
      // gây hiển thị sai). Runtime tự nhận upstream là video hay ảnh → chọn video_download_resolution
      // (720p) cho video / download_resolution (1k) cho ảnh. download_collect_all=true: gom mọi kết quả.
      download_folder: '', download_file_template: '',
      download_resolution: '1k', video_download_resolution: '720p',
      download_collect_all: true } };
  }
  // edge: sh=sourceHandle, th=targetHandle
  function E(src, tgt, sh, th) {
    return { id: 'e_' + src + '_' + (sh || 'output_1') + '_' + tgt + '_' + (th || 'input_1'),
      source: src, target: tgt, sourceHandle: sh || 'output_1', targetHandle: th || 'input_1' };
  }
  function tpl(id, name, slug, desc, nodes, edges) {
    return { id: id, name: name, slug: slug, description: desc,
      thumbnail_url: "../../assets/templates/thumb_" + id + ".png", video_url: null, category_id: 2, nodes: nodes, edges: edges };
  }

  // Pipeline NHẤT QUÁN 2 TẦNG (dùng cho template nhân vật/sản phẩm/ý tưởng chỉ có input text): tạo 1
  // ẢNH BASE gốc trước (character sheet / hero / style keyframe) → dùng làm REF cho gen series (giữ
  // nhận diện xuyên suốt). text(seed) → AI(base) → Gen(base) →[ref]→ Gen(series) ← AI(series)→seq.
  function seriesTpl(id, name, slug, desc, seedLabel, seedText, baseInstr, seriesInstr, opts) {
    var p = id + '_';
    var nSeed = textNode(p + 'seed', 120, 200, seedLabel, seedText);
    var nAiB = aiNode(p + 'aib', 470, 200, 'AI: Tạo base gốc', baseInstr);
    var nGb = genNode(p + 'gb', 830, 200, 'Gen: Base gốc', opts);
    var nAiS = aiNode(p + 'ais', 830, 500, 'AI: Sinh series', seriesInstr);
    var nSeq = seqNode(p + 'seq', 1200, 500, 'Tách', { split_mode: 'auto' });
    var nGs = genNode(p + 'gs', 1560, 380, 'Gen: Series (giữ base)', opts);
    var nDl = dlNode(p + 'dl', 1920, 380);
    T.push(tpl(id, name, slug, desc,
      [nSeed, nAiB, nGb, nAiS, nSeq, nGs, nDl],
      [E(nSeed.id, nAiB.id, 'output_1', 'input_1'), E(nAiB.id, nGb.id, 'output_1', 'input_2'),
       E(nGb.id, nGs.id, 'output_1', 'input_1'), // base → series (image_ref) giữ nhất quán
       E(nSeed.id, nAiS.id, 'output_1', 'input_1'), E(nAiS.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGs.id, 'output_1', 'input_2'), E(nGs.id, nDl.id, 'output_1', 'input_1')]));
  }

  var T = [];

  // 1001 — ⭐ Ý tưởng → base keyframe → chuỗi scene giữ style (flagship pipeline 2 tầng)
  seriesTpl(1001, '⭐ Ý tưởng → base keyframe → chuỗi scene nhất quán',
    'y-tuong-base-chuoi-scene-batch',
    'Pipeline lõi 2 tầng: Tầng 1 tạo 1 KEYFRAME base (chốt nhân vật/phong cách/tông màu). Tầng 2 dùng keyframe làm ref → sinh chuỗi scene GIỮ y hệt style → generate hàng loạt → tải về.',
    'Ý tưởng', 'Một cô gái áo dài trắng dạo phố cổ Hà Nội buổi sáng, phong cách điện ảnh ấm áp.',
    'Từ ý tưởng, viết 1 VISUAL BIBLE (nhân vật, trang phục, phong cách, tông màu) rồi tạo 1 prompt KEYFRAME đại diện đẹp nhất — ảnh base chốt phong cách để tái dùng làm tham chiếu.',
    'Dựa trên ảnh keyframe base (tham chiếu), tạo 6 SCENE prompt đánh số — cùng nhân vật/trang phục/tông màu như base, chỉ đổi hành động/góc máy/bối cảnh. Giữ nhất quán tuyệt đối.',
    { ratio: '9:16', quantity: 1 });

  // 1002 — Storyboard 8-panel → batch generate
  (function () {
    var id = 1002, p = id + '_';
    var nBrief = textNode(p + 'brief', COL[0], 200, 'Brief', 'Quảng cáo cà phê phin SEOSONA, ấm cúng, tông nâu vàng, đối tượng dân văn phòng.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh storyboard', 'Từ brief trên, tạo storyboard 8 panel. Mỗi panel: 1 prompt ảnh chi tiết (giữ nhân vật + phong cách + palette nhất quán), 1 dòng mô tả nhịp/cảm xúc. Đánh số 1-8, sẵn sàng generate hàng loạt.');
    var nGen = genNode(p + 'gen', COL[2], 200, 'Flow — Generate', { ratio: '16:9', quantity: 1 });
    var nDl = dlNode(p + 'dl', COL[3], 200);
    T.push(tpl(id, 'Storyboard 8-panel → batch generate',
      'storyboard-8-panel-batch-generate',
      'Brief → storyboard 8 khung nhất quán → generate từng khung trên Flow → tải về. Đổi số panel/tỉ lệ tuỳ nhu cầu.',
      [nBrief, nAI, nGen, nDl],
      [E(nBrief.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1003 — Character board KOC (2 tầng): tạo character sheet base → 6 pose giữ base
  seriesTpl(1003, 'Character board KOC (2 tầng): sheet base → 6 pose nhất quán',
    'character-board-koc-2-tang',
    'Giải bài toán nhân vật nhất quán bằng 2 tầng: Tầng 1 tạo CHARACTER SHEET base (chốt gương mặt/trang phục). Tầng 2 dùng sheet làm ref → 6 pose cùng người GIỮ y hệt (no morphing) → tải về.',
    'Nhân vật (block)', 'KOC nữ 25 tuổi, tóc đen dài, áo blazer be, phong cách tối giản hiện đại, tông màu ấm.',
    'Từ block nhân vật, tạo 1 prompt CHARACTER SHEET base: chân dung rõ mặt + turnaround, chốt danh tính (gương mặt, tóc, trang phục, palette) để tái dùng làm tham chiếu.',
    'Dựa trên character sheet base (tham chiếu), tạo 6 prompt cùng 1 nhân vật ở 6 pose/bối cảnh khác nhau. GIỮ khuôn mặt/tỉ lệ/trang phục y hệt (no morphing), chỉ đổi pose/góc/bối cảnh. Đánh số 1-6.',
    { ratio: '3:4', quantity: 1 });

  // 1004 — 1 prompt → so sánh 3 model (Flow / ChatGPT / Grok)
  (function () {
    var id = 1004, p = id + '_';
    var nPrompt = textNode(p + 'prompt', COL[0], 260, 'Prompt', 'Ảnh hero tai nghe không dây trên nền gradient tối, ánh viền, chất liệu cao cấp, quảng cáo công nghệ, tỉ lệ vuông.');
    var nFlow = genNode(p + 'flow', COL[1], 80, 'Flow', { ratio: '1:1' });
    var nGpt = genNode(p + 'gpt', COL[1], 260, 'ChatGPT', { type: 'chatgpt', slug: 'chatgpt_image_generate', provider: 'chatgpt', ratio: 'square' });
    var nGrok = genNode(p + 'grok', COL[1], 440, 'Grok', { type: 'grok', slug: 'grok_image_generate', provider: 'grok', ratio: '1:1' });
    var nDl = dlNode(p + 'dl', COL[2], 260);
    T.push(tpl(id, '1 prompt → so sánh 3 model (Flow/ChatGPT/Grok)',
      '1-prompt-so-sanh-3-model',
      'Cùng 1 prompt gen song song trên 3 provider → gom kết quả cạnh nhau để so sánh chất lượng. Node Download gom cả 3.',
      [nPrompt, nFlow, nGpt, nGrok, nDl],
      [E(nPrompt.id, nFlow.id, 'output_1', 'input_2'),
       E(nPrompt.id, nGpt.id, 'output_1', 'input_2'),
       E(nPrompt.id, nGrok.id, 'output_1', 'input_2'),
       E(nFlow.id, nDl.id, 'output_1', 'input_1'),
       E(nGpt.id, nDl.id, 'output_1', 'input_1'),
       E(nGrok.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1005 — Random style → đa dạng hoá gen (random_pick + text_template)
  (function () {
    var id = 1005, p = id + '_';
    var nBase = textNode(p + 'base', COL[0], 120, 'Chủ thể', 'a hero product shot of a luxury watch on a marble surface');
    var nS1 = textNode(p + 's1', COL[0], 280, 'Style A', 'cinematic dramatic side light, dark moody background');
    var nS2 = textNode(p + 's2', COL[0], 400, 'Style B', 'bright minimal studio, soft shadows, clean white background');
    var nS3 = textNode(p + 's3', COL[0], 520, 'Style C', 'warm golden-hour glow, bokeh, editorial magazine look');
    var nPick = pickNode(p + 'pick', COL[1], 400, 'Random Style');
    var nTT = ttNode(p + 'tt', COL[2], 260, 'Ghép prompt', '{{input1}}, {{input2}}, high detail, commercial quality, aspect ratio 1:1');
    var nGen = genNode(p + 'gen', COL[3], 260, 'Flow — Generate', { ratio: '1:1', quantity: 4 });
    var nDl = dlNode(p + 'dl', COL[3] + 360, 260);
    T.push(tpl(id, 'Random style → đa dạng hoá gen',
      'random-style-da-dang-gen',
      'Mỗi lần chạy random 1 style rồi ghép với chủ thể → gen 4 biến thể đa dạng. Thêm/bớt node Style tuỳ ý.',
      [nBase, nS1, nS2, nS3, nPick, nTT, nGen, nDl],
      [E(nS1.id, nPick.id, 'output_1', 'input_1'),
       E(nS2.id, nPick.id, 'output_1', 'input_1'),
       E(nS3.id, nPick.id, 'output_1', 'input_1'),
       E(nBase.id, nTT.id, 'output_1', 'input_1'),
       E(nPick.id, nTT.id, 'output_1', 'input_1'),
       E(nTT.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1006 — Text Template: ghép brand + sản phẩm → prompt động
  (function () {
    var id = 1006, p = id + '_';
    var nBrand = textNode(p + 'brand', COL[0], 140, 'Brand', 'SEOSONA');
    var nProduct = textNode(p + 'product', COL[0], 300, 'Sản phẩm', 'tai nghe không dây');
    var nTT = ttNode(p + 'tt', COL[1], 220, 'Prompt động',
      'Ảnh packshot {{input2}} thương hiệu {{input1}} trên nền trắng, ánh sáng studio, góc 3/4, sắc nét, chất lượng thương mại, tỉ lệ 1:1');
    var nGen = genNode(p + 'gen', COL[2], 220, 'Flow — Generate', { ratio: '1:1', quantity: 2 });
    var nDl = dlNode(p + 'dl', COL[3], 220);
    T.push(tpl(id, 'Text Template: brand + sản phẩm → prompt động',
      'text-template-brand-san-pham',
      'Điền brand + sản phẩm → node Text Template ghép thành prompt hoàn chỉnh {{input1}}/{{input2}} → generate. Tái dùng cho cả catalog.',
      [nBrand, nProduct, nTT, nGen, nDl],
      [E(nBrand.id, nTT.id, 'output_1', 'input_1'),
       E(nProduct.id, nTT.id, 'output_1', 'input_1'),
       E(nTT.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1007 — Condition: rẽ nhánh theo prompt (demo node điều kiện)
  (function () {
    var id = 1007, p = id + '_';
    var nPrompt = textNode(p + 'prompt', COL[0], 240, 'Prompt', 'a serene mountain lake at sunrise, mist, reflections, cinematic');
    var nCond = condNode(p + 'cond', COL[1], 240, 'Có prompt?', 'has_text', '');
    var nGen = genNode(p + 'gen', COL[2], 120, 'Flow — Generate', { ratio: '16:9' });
    var nDl = dlNode(p + 'dl', COL[3], 120);
    // Note: node 'note' KHÔNG có input port → để làm annotation NỔI (không nối edge). Nhánh FALSE
    // (output_2) bỏ trống = dừng, đúng cho demo. (Fix audit #5.)
    var nNote = noteNode(p + 'note', COL[2], 400, 'Nhánh FALSE (prompt rỗng) → dừng, không generate. Có prompt → nhánh TRUE chạy generate + download.');
    T.push(tpl(id, 'Condition: rẽ nhánh theo prompt',
      'condition-re-nhanh-theo-prompt',
      'Node Condition: nếu có prompt → nhánh TRUE (generate + download), nếu rỗng → nhánh FALSE (dừng). Mẫu học cách rẽ nhánh n8n.',
      [nPrompt, nCond, nGen, nDl, nNote],
      [E(nPrompt.id, nCond.id, 'output_1', 'input_1'),
       E(nPrompt.id, nGen.id, 'output_1', 'input_2'),
       E(nCond.id, nGen.id, 'output_1', 'input_1'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1008 — Sản phẩm → 4 góc nhất quán
  (function () {
    var id = 1008, p = id + '_';
    var nProd = textNode(p + 'prod', COL[0], 200, 'Sản phẩm', 'chai nước hoa thuỷ tinh trong, nắp vàng gold, nhãn tối giản.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh 4 góc', 'Cho sản phẩm trên, tạo 4 prompt ảnh: chính diện, góc 3/4, cạnh bên, và macro chi tiết. Giữ y hệt sản phẩm, nền trắng, ánh sáng studio, phong cách. Đánh số 1-4.');
    var nGen = genNode(p + 'gen', COL[2], 200, 'Flow — Generate', { ratio: '1:1', quantity: 1 });
    var nDl = dlNode(p + 'dl', COL[3], 200);
    T.push(tpl(id, 'Sản phẩm → bộ 4 góc nhất quán',
      'san-pham-4-goc-nhat-quan',
      'E-commerce: 1 sản phẩm → 4 góc chụp nhất quán (chính diện/3-4/cạnh/macro) → generate → tải về.',
      [nProd, nAI, nGen, nDl],
      [E(nProd.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1009 — Sản phẩm → listing Shopee (2 tầng): hero base → bộ ảnh giữ sản phẩm
  seriesTpl(1009, 'Sản phẩm → listing Shopee (2 tầng: hero → 6 ảnh)',
    'san-pham-listing-shopee-2-tang',
    'E-com VN 2 tầng: Tầng 1 tạo ảnh HERO nền trắng chuẩn (chốt sản phẩm). Tầng 2 dùng hero làm ref → bộ 6 ảnh listing (main/lifestyle/infographic/size/macro/flatlay) GIỮ y hệt sản phẩm → tải về.',
    'Sản phẩm', 'bình giữ nhiệt inox 500ml, nắp gỗ, thương hiệu SEOSONA.',
    'Từ mô tả sản phẩm, tạo 1 prompt ảnh HERO nền trắng chính diện chuẩn marketplace — sắc nét, đúng màu/logo, ánh sáng studio. Đây là ảnh base chốt sản phẩm để tái dùng.',
    'Dựa trên ảnh hero base (tham chiếu), tạo bộ 6 ảnh listing đánh số: (1) main nền trắng, (2) lifestyle đang dùng, (3) infographic tính năng có callout, (4) minh hoạ kích thước, (5) macro chi tiết, (6) flat-lay trọn bộ. GIỮ y hệt sản phẩm như hero qua mọi ảnh.',
    { ratio: '1:1', quantity: 1 });

  // 1010 — Quán ăn → bộ ảnh menu đồng bộ
  (function () {
    var id = 1010, p = id + '_';
    var nDishes = textNode(p + 'dishes', COL[0], 200, 'Danh sách món', 'phở bò, bún chả, cà phê sữa đá, chè khúc bạch.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh bộ menu', 'Cho danh sách món trên, mỗi món tạo 1 prompt ảnh menu hấp dẫn, TẤT CẢ cùng góc chụp, phong cách ánh sáng, bộ đạo cụ và nền để menu đồng bộ như 1 buổi chụp. Đánh số theo món.');
    var nGen = genNode(p + 'gen', COL[2], 200, 'Flow — Generate', { ratio: '4:5', quantity: 1 });
    var nDl = dlNode(p + 'dl', COL[3], 200);
    T.push(tpl(id, 'Quán ăn → bộ ảnh menu đồng bộ',
      'quan-an-bo-anh-menu-dong-bo',
      'F&B: danh sách món → bộ ảnh menu cùng phong cách → generate → tải về. Đồng bộ như một buổi chụp chuyên nghiệp.',
      [nDishes, nAI, nGen, nDl],
      [E(nDishes.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1011 — UGC/KOL quảng cáo (prompt → gen, ghi chú dán ảnh ref)
  (function () {
    var id = 1011, p = id + '_';
    var nPrompt = textNode(p + 'prompt', COL[0], 200, 'Prompt UGC', 'Một KOC nữ cầm sản phẩm serum dưỡng da, biểu cảm thân thiện, bối cảnh phòng ngủ ấm cúng, ánh sáng tự nhiên, cảm giác review chân thực, tỉ lệ 4:5.');
    var nNote = noteNode(p + 'note', COL[0], 400, 'Mẹo: dán ảnh gương mặt KOC vào node Generate (ref image) để khoá nhận diện qua nhiều lần gen.');
    var nGen = genNode(p + 'gen', COL[1], 200, 'Flow — Generate', { ratio: '4:5', quantity: 3 });
    var nDl = dlNode(p + 'dl', COL[2], 200);
    T.push(tpl(id, 'UGC / KOL quảng cáo sản phẩm',
      'ugc-kol-quang-cao-san-pham',
      'Ảnh review UGC chân thực cho social commerce: 1 prompt → 3 biến thể → tải về. Dán ảnh KOC làm ref để nhất quán gương mặt.',
      [nPrompt, nNote, nGen, nDl],
      [E(nPrompt.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1012 — Thương hiệu → bộ visual đồng bộ (brand kit)
  (function () {
    var id = 1012, p = id + '_';
    var nBrand = textNode(p + 'brand', COL[0], 200, 'Brand brief', 'SEOSONA — công cụ AI marketing, tông xanh #3d6ff5, hiện đại tối giản, đáng tin cậy.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh brand kit', 'Cho brand brief trên, tạo bộ visual khởi đầu đồng bộ đánh số: logo mark, avatar profile, hero banner, ảnh showcase sản phẩm/dịch vụ, và nền story/post. Giữ màu, phong cách, cảm xúc y hệt qua tất cả.');
    var nGen = genNode(p + 'gen', COL[2], 200, 'Flow — Generate', { ratio: '1:1', quantity: 1 });
    var nDl = dlNode(p + 'dl', COL[3], 200);
    T.push(tpl(id, 'Thương hiệu → bộ visual đồng bộ (brand kit)',
      'thuong-hieu-bo-visual-dong-bo',
      'Brand brief → bộ visual khởi đầu nhất quán (logo/avatar/banner/showcase/background) → generate → tải về.',
      [nBrand, nAI, nGen, nDl],
      [E(nBrand.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1013 — Chủ đề → carousel nhiều slide
  (function () {
    var id = 1013, p = id + '_';
    var nTopic = textNode(p + 'topic', COL[0], 200, 'Chủ đề', '5 mẹo tiết kiệm thời gian khi làm content bằng AI.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh carousel', 'Cho chủ đề trên, thiết kế carousel 6 slide đánh số: slide 1 cover hook, các slide giữa mỗi slide 1 ý, slide cuối CTA. Giữ 1 layout, bảng màu và phong cách đồng nhất, chừa khoảng trống cho chữ tiếng Việt ngắn.');
    var nGen = genNode(p + 'gen', COL[2], 200, 'Flow — Generate', { ratio: '4:5', quantity: 1 });
    var nDl = dlNode(p + 'dl', COL[3], 200);
    T.push(tpl(id, 'Chủ đề → carousel nhiều slide',
      // Trùng slug với template 34 trong BundledTemplates.js. Slug dùng để tra cứu nên trùng là
      // một trong hai bản không bao giờ được chọn tới. Đổi bản này (id 1013) vì nó là bản thêm sau.
      'chu-de-carousel-nhieu-slide-v2',
      'Social: 1 chủ đề → carousel 6 slide đồng bộ (cover→ý→CTA) → generate → tải về. Chừa chỗ cho caption tiếng Việt.',
      [nTopic, nAI, nGen, nDl],
      [E(nTopic.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1014 — Sản phẩm → chiến dịch theo mùa/lễ (Tết)
  (function () {
    var id = 1014, p = id + '_';
    var nSeed = textNode(p + 'seed', COL[0], 200, 'Sản phẩm + dịp', 'Giỏ quà Tết SEOSONA, dịp Tết Nguyên Đán, tông đỏ vàng may mắn.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh campaign', 'Cho sản phẩm và dịp lễ trên, tạo bộ ảnh chiến dịch theo mùa đánh số: hero visual, post social, banner, và story — tất cả cùng hoạ tiết lễ hội, màu thương hiệu và phong cách nhất quán. Chừa chỗ cho lời chúc tiếng Việt.');
    var nGen = genNode(p + 'gen', COL[2], 200, 'Flow — Generate', { ratio: '1:1', quantity: 1 });
    var nDl = dlNode(p + 'dl', COL[3], 200);
    T.push(tpl(id, 'Sản phẩm → chiến dịch theo mùa/lễ (Tết)',
      'san-pham-chien-dich-theo-mua-tet',
      'Marketing mùa vụ: sản phẩm + dịp (Tết/Noel/back-to-school) → bộ ảnh campaign đồng bộ → generate → tải về.',
      [nSeed, nAI, nGen, nDl],
      [E(nSeed.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1015 — Ý tưởng tiếng Việt → prompt tiếng Anh chuẩn → generate
  (function () {
    var id = 1015, p = id + '_';
    var nIdea = textNode(p + 'idea', COL[0], 200, 'Ý tưởng (VI)', 'ảnh một chú mèo tam thể ngồi bên cửa sổ mưa, buổi tối ấm cúng, phong cách điện ảnh.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Dịch → prompt EN', 'Dịch và chuyển ý tưởng tiếng Việt ở trên thành 1 prompt tiếng Anh chuẩn cho AI gen ảnh: cụ thể, trực quan, bổ sung mặc định hợp lý cho ánh sáng/bố cục/phong cách nếu thiếu, tỉ lệ 3:2. Chỉ xuất prompt tiếng Anh.');
    var nGen = genNode(p + 'gen', COL[2], 200, 'Flow — Generate', { ratio: '3:2', quantity: 2 });
    var nDl = dlNode(p + 'dl', COL[3], 200);
    T.push(tpl(id, 'Ý tưởng tiếng Việt → prompt EN chuẩn → generate',
      'y-tuong-viet-prompt-en-generate',
      'Gõ ý tưởng tiếng Việt → node AI dịch sang prompt tiếng Anh tối ưu → generate → tải về. Khỏi tự dịch thủ công.',
      [nIdea, nAI, nGen, nDl],
      [E(nIdea.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1016 — ⭐ Phase 3: Ý tưởng → AI sinh scene → PROMPT SEQUENCE tách → batch generate
  (function () {
    var id = 1016, p = id + '_';
    var nIdea = textNode(p + 'idea', COL[0], 200, 'Ý tưởng', 'Hành trình một hạt cà phê: từ nông trại → rang xay → ly cà phê sáng. Phong cách điện ảnh ấm.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'AI sinh scene', 'Viết 1 VISUAL BIBLE (phong cách, tông màu, chất liệu để nhất quán), rồi tạo 6 SCENE đánh số "1." "2."… — mỗi scene 1 prompt ảnh chi tiết. Đặt visual bible ở đầu, trước Scene 1.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách scene', { split_mode: 'auto', scene_suffix: ', cinematic, high detail' });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '16:9', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, '⭐ Ý tưởng → AI scene → Prompt Sequence → batch gen',
      'y-tuong-ai-scene-prompt-sequence-batch',
      'Phase 3: node Prompt Sequence tự tách khối nhiều scene (từ AI Agent) thành danh sách prompt đánh số + tự áp visual-bible vào mọi scene → generate hàng loạt nhất quán → tải về.',
      [nIdea, nAI, nSeq, nGen, nDl],
      [E(nIdea.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1017 — Công thức → bộ ảnh từng bước (recipe steps)
  (function () {
    var id = 1017, p = id + '_';
    var nRecipe = textNode(p + 'recipe', COL[0], 200, 'Công thức', 'Cách làm bánh flan caramel: đánh trứng, nấu caramel, hấp, làm lạnh, úp ra đĩa.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh bước', 'Cho công thức trên, mỗi bước tạo 1 prompt ảnh: góc từ trên xuống nhất quán, cùng bối cảnh bếp, ánh sáng và phong cách, thể hiện rõ hành động/kết quả của bước đó. Đánh số các bước.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách bước', { split_mode: 'auto' });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '1:1', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, 'Công thức → bộ ảnh từng bước',
      'cong-thuc-bo-anh-tung-buoc',
      'Recipe/tutorial: công thức → AI chia bước → Prompt Sequence tách → generate bộ ảnh minh hoạ đồng bộ → tải về.',
      [nRecipe, nAI, nSeq, nGen, nDl],
      [E(nRecipe.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1018 — Bộ sưu tập → lookbook nhất quán
  (function () {
    var id = 1018, p = id + '_';
    var nColl = textNode(p + 'coll', COL[0], 200, 'Bộ sưu tập', 'BST thu-đông SEOSONA: 5 outfit tối giản tông trung tính, chất liệu len và da.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh lookbook', 'Cho bộ sưu tập trên, tạo 5 prompt ảnh lookbook — cùng phong cách người mẫu, ánh sáng, vibe bối cảnh và tông màu, mỗi ảnh 1 outfit khác. Đánh số. Giữ nhận diện editorial đồng nhất.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách look', { split_mode: 'auto' });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '3:4', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, 'Bộ sưu tập → lookbook nhất quán',
      'bo-suu-tap-lookbook-nhat-quan',
      'Thời trang: BST → AI sinh look → tách → generate lookbook đồng bộ → tải về.',
      [nColl, nAI, nSeq, nGen, nDl],
      [E(nColl.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1019 — Điểm đến → chuỗi ảnh du lịch
  (function () {
    var id = 1019, p = id + '_';
    var nDest = textNode(p + 'dest', COL[0], 200, 'Điểm đến', 'Hội An về đêm: phố cổ đèn lồng, sông Hoài, thuyền hoa đăng, quán cà phê.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh chuỗi', 'Cho điểm đến trên, tạo 6 prompt ảnh du lịch các góc/khoảnh khắc khác nhau, cùng tông màu, thời điểm và phong cách để thành 1 series liền mạch. Đánh số 1-6.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách cảnh', { split_mode: 'auto', scene_suffix: ', travel photography, vibrant' });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '3:2', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, 'Điểm đến → chuỗi ảnh du lịch',
      'diem-den-chuoi-anh-du-lich',
      'Du lịch VN: điểm đến → AI sinh 6 góc → tách → generate series đồng bộ → tải về.',
      [nDest, nAI, nSeq, nGen, nDl],
      [E(nDest.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1020 — 12 con giáp → bộ ảnh đồng bộ
  (function () {
    var id = 1020, p = id + '_';
    var nStyle = textNode(p + 'style', COL[0], 200, 'Phong cách', 'Bộ 12 con giáp phong cách chibi dễ thương, màu pastel, viền đậm, nền tối giản — dùng cho lịch/sticker.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh 12 giáp', 'Định nghĩa phong cách 1 lần, rồi tạo 12 prompt ảnh — mỗi con giáp (Tý Sửu Dần...) cùng art style, palette và khung để thành bộ đồng nhất. Đánh số 1-12.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách 12 giáp', { split_mode: 'auto', max_scenes: 12 });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '1:1', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, '12 con giáp → bộ ảnh đồng bộ',
      '12-con-giap-bo-anh-dong-bo',
      'Văn hoá VN: sinh bộ 12 con giáp cùng phong cách → tách (max 12) → generate → tải về. Dùng cho lịch/sticker Tết.',
      [nStyle, nAI, nSeq, nGen, nDl],
      [E(nStyle.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1021 — Nhân vật → bộ emoji/reaction sticker
  (function () {
    var id = 1021, p = id + '_';
    var nChar = textNode(p + 'char', COL[0], 200, 'Nhân vật', 'Chú mèo cam mập, mắt to, phong cách chibi 2D, viền trắng die-cut.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh reaction', 'Dùng nhân vật trên, tạo 8 prompt sticker emoji cùng nhân vật với 8 reaction khác nhau (vui, buồn, giận, yêu, ngạc nhiên, ngủ, cười, khóc), cùng style, viền đậm die-cut, thiết kế đồng nhất. Đánh số 1-8.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách sticker', { split_mode: 'auto', max_scenes: 8 });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '1:1', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, 'Nhân vật → bộ emoji/reaction sticker',
      'nhan-vat-bo-emoji-reaction-sticker',
      'Sticker: 1 nhân vật → 8 reaction đồng nhất → tách → generate bộ sticker → tải về. Cho Zalo/Telegram.',
      [nChar, nAI, nSeq, nGen, nDl],
      [E(nChar.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1022 — Kênh YouTube → bộ nhận diện (banner + avatar + thumbnail)
  (function () {
    var id = 1022, p = id + '_';
    var nCh = textNode(p + 'ch', COL[0], 200, 'Kênh', 'Kênh review công nghệ "SEOSONA Tech", tông xanh dương, hiện đại, đáng tin.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh nhận diện', 'Cho kênh trên, tạo bộ nhận diện đánh số: (1) banner 16:9, (2) avatar tròn, (3) 3 mẫu thumbnail CTR cao. Giữ màu, phong cách, cảm xúc đồng nhất. Chừa chỗ cho chữ.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách asset', { split_mode: 'auto' });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '16:9', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, 'Kênh YouTube → bộ nhận diện',
      'kenh-youtube-bo-nhan-dien',
      'Creator: brief kênh → bộ banner + avatar + thumbnail đồng bộ → tách → generate → tải về.',
      [nCh, nAI, nSeq, nGen, nDl],
      [E(nCh.id, nAI.id, 'output_1', 'input_1'),
       E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1023 — Ngành dọc → bộ ảnh marketing đồng bộ
  (function () {
    var id = 1023, p = id + '_';
    var nBiz = textNode(p + 'biz', COL[0], 200, 'Doanh nghiệp', 'Phòng khám nha khoa SEOSONA Dental, tông xanh trắng sạch, chuyên nghiệp đáng tin.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh bộ marketing', 'Cho doanh nghiệp trên, tạo bộ ảnh marketing đồng bộ đánh số: hero thương hiệu, showcase dịch vụ, post social, banner khuyến mãi, ảnh lifestyle/testimonial. Giữ phong cách, palette, cảm xúc y hệt. Chừa chỗ chữ tiếng Việt.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách ảnh', { split_mode: 'auto' });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '4:5', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, 'Ngành dọc → bộ ảnh marketing đồng bộ',
      'nganh-doc-bo-anh-marketing',
      'Doanh nghiệp bất kỳ (nha khoa/salon/luật/gym...) → bộ ảnh marketing nhất quán → tách → generate → tải về.',
      [nBiz, nAI, nSeq, nGen, nDl],
      [E(nBiz.id, nAI.id, 'output_1', 'input_1'), E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'), E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1024 — Chủ đề cưới → bộ ảnh concept
  (function () {
    var id = 1024, p = id + '_';
    var nTheme = textNode(p + 'theme', COL[0], 200, 'Chủ đề cưới', 'Cưới phong cách vintage sân vườn, tông pastel, ánh nắng chiều, lãng mạn.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh concept', 'Cho chủ đề cưới trên, tạo 6 prompt ảnh cưới điện ảnh các khoảnh khắc/pose khác nhau, cùng 1 color grade, ánh sáng và phong cách lãng mạn để thành album đồng bộ. Đánh số 1-6.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách cảnh', { split_mode: 'auto', scene_suffix: ', cinematic, romantic' });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '3:2', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, 'Chủ đề cưới → bộ ảnh concept',
      'chu-de-cuoi-bo-anh-concept',
      'Cưới: chủ đề → AI sinh 6 concept đồng bộ → tách → generate album → tải về.',
      [nTheme, nAI, nSeq, nGen, nDl],
      [E(nTheme.id, nAI.id, 'output_1', 'input_1'), E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'), E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1025 — Bất động sản → bộ ảnh các phòng
  (function () {
    var id = 1025, p = id + '_';
    var nProp = textNode(p + 'prop', COL[0], 200, 'Bất động sản', 'Căn hộ 2PN 65m2 phong cách Scandinavian: phòng khách, bếp, 2 phòng ngủ, ban công.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh các phòng', 'Cho căn hộ trên, mỗi phòng tạo 1 prompt ảnh nội thất, cùng ánh sáng, phong cách staging và color grade để thành tour listing đồng bộ. Đánh số theo phòng.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách phòng', { split_mode: 'auto' });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '3:2', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, 'Bất động sản → bộ ảnh các phòng',
      'bat-dong-san-bo-anh-cac-phong',
      'BĐS: căn hộ → AI sinh ảnh từng phòng đồng bộ → tách → generate tour listing → tải về.',
      [nProp, nAI, nSeq, nGen, nDl],
      [E(nProp.id, nAI.id, 'output_1', 'input_1'), E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'), E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1026 — Sản phẩm → chuỗi ảnh kể chuyện quảng cáo
  (function () {
    var id = 1026, p = id + '_';
    var nProd = textNode(p + 'prod', COL[0], 200, 'Sản phẩm', 'Máy lọc nước SEOSONA — giải quyết lo ngại nước bẩn cho gia đình.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh story ad', 'Cho sản phẩm trên, tạo chuỗi 5 ảnh quảng cáo kể chuyện: (1) vấn đề, (2) sản phẩm, (3) lợi ích, (4) kết quả hạnh phúc, (5) CTA. Mỗi ảnh 1 prompt, cùng phong cách thương hiệu, palette và cảm xúc. Đánh số 1-5.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách story', { split_mode: 'auto', max_scenes: 5 });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '4:5', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, 'Sản phẩm → chuỗi ảnh kể chuyện quảng cáo',
      'san-pham-chuoi-anh-ke-chuyen-quang-cao',
      'Ad storytelling: sản phẩm → 5 ảnh (vấn đề→sản phẩm→lợi ích→kết quả→CTA) đồng bộ → tách → generate → tải về.',
      [nProd, nAI, nSeq, nGen, nDl],
      [E(nProd.id, nAI.id, 'output_1', 'input_1'), E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'), E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1027 — Sản phẩm → bộ ảnh xoay 360
  (function () {
    var id = 1027, p = id + '_';
    var nProd = textNode(p + 'prod', COL[0], 200, 'Sản phẩm', 'giày sneaker trắng, nền xám studio, ánh sáng đều.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh góc xoay', 'Cho sản phẩm trên, tạo bộ 8 góc xoay (mỗi 45 độ: trước, trước-phải, phải, sau-phải, sau...), mỗi góc 1 prompt, GIỮ y hệt sản phẩm, ánh sáng, nền và phong cách — chỉ đổi góc nhìn. Đánh số 1-8.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách góc', { split_mode: 'auto', max_scenes: 8 });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '1:1', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, 'Sản phẩm → bộ ảnh xoay 360',
      'san-pham-bo-anh-xoay-360',
      'E-com: sản phẩm → 8 góc xoay nhất quán → tách → generate → tải về (ghép thành 360 spin).',
      [nProd, nAI, nSeq, nGen, nDl],
      [E(nProd.id, nAI.id, 'output_1', 'input_1'), E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'), E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1028 — 1 thiết kế → nhiều tỉ lệ đa nền tảng
  (function () {
    var id = 1028, p = id + '_';
    var nConcept = textNode(p + 'concept', COL[0], 200, 'Concept', 'Poster khuyến mãi Black Friday SEOSONA, tông đen-vàng, mạnh mẽ.');
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh đa tỉ lệ', 'Cho concept trên, tạo cùng 1 visual thích ứng nhiều tỉ lệ đánh số: 1:1 (post), 9:16 (story/reel), 16:9 (banner), 4:5 (feed). Giữ chủ thể, phong cách, thương hiệu y hệt; chỉ đổi bố cục cho vừa từng tỉ lệ.');
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách bản', { split_mode: 'auto' });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', { ratio: '1:1', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, '1 thiết kế → nhiều tỉ lệ (đa nền tảng)',
      '1-thiet-ke-nhieu-ti-le-da-nen-tang',
      'Marketing: 1 concept → bản 1:1/9:16/16:9/4:5 đồng bộ → tách → generate → tải về. Đăng mọi nền tảng.',
      [nConcept, nAI, nSeq, nGen, nDl],
      [E(nConcept.id, nAI.id, 'output_1', 'input_1'), E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'), E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1029 — Nhân vật → chuỗi "một ngày" (2 tầng: character base → 6 khoảnh khắc)
  seriesTpl(1029, 'Nhân vật → "một ngày" (2 tầng: base → 6 khoảnh khắc)',
    'nhan-vat-mot-ngay-2-tang',
    'Storytelling 2 tầng: Tầng 1 tạo nhân vật base (chốt nhận diện). Tầng 2 dùng base làm ref → 6 khoảnh khắc "một ngày" GIỮ y hệt nhân vật → tải về.',
    'Nhân vật', 'Cô nhân viên văn phòng trẻ, tóc buộc, áo sơ mi trắng, phong cách minh hoạ phẳng ấm.',
    'Từ mô tả nhân vật, tạo 1 prompt ảnh base chốt nhận diện (gương mặt, trang phục, phong cách minh hoạ, palette) để tái dùng làm tham chiếu.',
    'Dựa trên nhân vật base (tham chiếu), tạo 6 prompt chuỗi "một ngày" (sáng dậy → đi làm → họp → trưa → chiều → tối), GIỮ y hệt nhân vật/phong cách/palette, mỗi ảnh 1 khoảnh khắc. Đánh số theo thời gian.',
    { ratio: '4:5', quantity: 1 });

  // ===== Concept video-gen phổ biến — bản GỐC SEOSONA (không copy gallery bên thứ ba) =====
  function conceptTpl(id, name, slug, desc, idea, aiInstruction, genOpts) {
    var p = id + '_';
    var nIdea = textNode(p + 'idea', COL[0], 200, 'Ý tưởng', idea);
    var nAI = aiNode(p + 'ai', COL[1], 200, 'Sinh chuỗi cảnh', aiInstruction);
    var nSeq = seqNode(p + 'seq', COL[2], 200, 'Tách cảnh', { split_mode: 'auto' });
    var nGen = genNode(p + 'gen', COL[3], 200, 'Flow — Generate', genOpts);
    var nDl = dlNode(p + 'dl', 1560, 200);
    T.push(tpl(id, name, slug, desc, [nIdea, nAI, nSeq, nGen, nDl],
      [E(nIdea.id, nAI.id, 'output_1', 'input_1'), E(nAI.id, nSeq.id, 'output_1', 'input_1'),
       E(nSeq.id, nGen.id, 'output_1', 'input_2'), E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  }

  conceptTpl(1030, 'POV thiên nhiên → chuỗi cảnh video', 'pov-thien-nhien-chuoi-canh',
    'Video góc nhìn thứ nhất khám phá thiên nhiên (ong/chim/thú) → chuỗi cảnh liền mạch → generate → tải về.',
    'Video POV một chú ong bay qua vườn hoa mùa xuân: cận hoa, hút mật, bay lên nhìn toàn cảnh, đáp xuống tổ. Ánh sáng ấm, điện ảnh.',
    'Viết VISUAL BIBLE (phong cách POV, tông màu, chất liệu) rồi tạo 5 SCENE đánh số, mỗi scene 1 prompt VIDEO ngắn: 1 chuyển động máy rõ + 1 hành động, ~5s, POV nhất quán. Đặt visual bible trước Scene 1.',
    { media_type: 'Video', ratio: '16:9', video_duration: '6s' });

  conceptTpl(1031, 'Timelapse tư liệu → chuỗi khung', 'timelapse-tu-lieu-chuoi-khung',
    'Video timelapse kể chuyện (dọn dẹp/xây dựng/thiên nhiên đổi mùa) → chuỗi khung đồng bộ → generate → tải về.',
    'Timelapse một nhóm tình nguyện dọn sạch bãi biển đầy rác thành bãi sạch đẹp, từ sáng tới hoàng hôn.',
    'VISUAL BIBLE (bối cảnh, tông màu, khung máy khoá) + 5 SCENE timelapse đánh số, mỗi scene 1 prompt VIDEO: chuyển động timelapse mượt, khung tĩnh, đổi ánh sáng, ~5s. Kể tiến trình trước→sau.',
    { media_type: 'Video', ratio: '16:9', video_duration: '6s' });

  conceptTpl(1032, 'Nhân vật 2D nhất quán → series cảnh', 'nhan-vat-2d-nhat-quan-series',
    'Nhân vật hoạt hình 2D gốc (bạn tự thiết kế) giữ nhất quán qua nhiều cảnh → generate → tải về. KHÔNG dùng nhân vật có bản quyền.',
    'Một chú mèo hoạt hình 2D vui nhộn (thiết kế gốc): thức dậy, tập thể dục, đi làm, về nhà. Phong cách cel-shading màu ấm.',
    'Định nghĩa CHARACTER BLOCK (ngoại hình, trang phục, style) 1 lần, rồi tạo 6 SCENE đánh số — cùng nhân vật/style/palette, chỉ đổi hành động/bối cảnh. Ghi "no morphing, keep identity". Nhân vật GỐC, không sao chép nhân vật có bản quyền.',
    { media_type: 'Image', ratio: '16:9' });

  conceptTpl(1033, 'Nhân vật đất nặn 3D → series', 'nhan-vat-dat-nan-3d-series',
    'Nhân vật phong cách claymation (đất nặn) gốc, nhất quán qua nhiều cảnh → generate → tải về.',
    'Một nhân vật người tuyết đất nặn dễ thương (thiết kế gốc): trong 5 khoảnh khắc phiêu lưu mùa đông.',
    'CHARACTER BLOCK claymation (chất liệu đất matte, hình tròn mềm, ánh sáng studio) + 5 SCENE đánh số cùng nhân vật/style. Vật liệu đất nặn nhất quán, nhân vật gốc.',
    { media_type: 'Image', ratio: '1:1' });

  conceptTpl(1034, 'Quảng cáo sản phẩm điện ảnh → chuỗi shot', 'quang-cao-san-pham-dien-anh',
    'Video quảng cáo sản phẩm phong cách điện ảnh → chuỗi shot (hero/detail/lifestyle/logo) → generate → tải về.',
    'Quảng cáo điện ảnh cho một chiếc xe thể thao: hero xoay chậm, cận chi tiết đèn/bánh, lái trên đường ven biển hoàng hôn, chốt logo.',
    'VISUAL BIBLE (grade điện ảnh teal-orange, ánh sáng, mood) + 5 SHOT đánh số, mỗi shot 1 prompt VIDEO: 1 camera move + 1 action, ~5s. Giữ grade/mood nhất quán, quảng cáo cao cấp.',
    { media_type: 'Video', ratio: '16:9', video_duration: '6s' });

  conceptTpl(1035, 'Sản phẩm bay bổng trong bong bóng → hero', 'san-pham-bay-bong-bong-bong-hero',
    'Ảnh/video sản phẩm bay lơ lửng trong bong bóng nước/thuỷ tinh, nền trời — hero bắt mắt → generate → tải về.',
    'Trái sầu riêng (hoặc sản phẩm bất kỳ) lơ lửng trong bong bóng xà phòng trong suốt, nền trời xanh mây trắng, ánh sáng mềm mộng mơ.',
    'VISUAL BIBLE (bong bóng trong, nền trời, ánh sáng mềm, phản chiếu) + 4 SCENE đánh số góc/bố cục khác nhau, cùng style bay-bổng, sản phẩm sắc nét trong bong bóng.',
    { media_type: 'Image', ratio: '1:1' });

  conceptTpl(1036, 'Showcase giày đa góc điện ảnh', 'showcase-giay-da-goc-dien-anh',
    'Bộ ảnh/video showcase giày sneaker nhiều góc, ánh sáng drop-hype → generate → tải về.',
    'Đôi sneaker trắng cao cấp: hero 3/4, cận đế, cận chất liệu, lơ lửng ánh viền, nền tối studio.',
    'VISUAL BIBLE (nền tối, rim light, chất liệu sắc nét, hype sneaker-drop) + 5 SCENE đánh số các góc/khoảnh khắc, cùng ánh sáng/style. Giữ đôi giày y hệt qua mọi cảnh.',
    { media_type: 'Image', ratio: '1:1' });

  conceptTpl(1037, 'Tư liệu động vật hoang dã → chuỗi cảnh', 'tu-lieu-dong-vat-hoang-da',
    'Video tư liệu thiên nhiên về động vật hoang dã → chuỗi cảnh điện ảnh → generate → tải về.',
    'Tư liệu về một con hổ trong rừng nhiệt đới: rình mồi, uống nước bên suối, đi trong sương sớm, gầm vang.',
    'VISUAL BIBLE (grade tư liệu tự nhiên, ánh sáng, mood) + 5 SCENE đánh số, mỗi scene 1 prompt VIDEO: 1 camera move + 1 hành động động vật, ~5s. Điện ảnh, chân thực.',
    { media_type: 'Video', ratio: '16:9', video_duration: '6s' });

  // ===== Ref-based product/model — PIPELINE NHIỀU TẦNG (rút từ pattern workflow thương mại) =====
  // Kỹ thuật lõi: tạo MODEL/SẢN PHẨM GỐC nhất quán trước → dùng nó làm ref cho tầng sau (mặc đồ / ghép
  // sản phẩm / đa góc / chiến dịch). Gen output nối vào gen sau (image_ref) → giữ nhận diện xuyên suốt.
  // Ảnh REF là placeholder rỗng — user thả ảnh của mình vào. 0 nội dung bên thứ ba.

  // 1038 — Sportswear model (2 TẦNG): tạo model gốc → mặc trang phục/giày/phụ kiện full-body
  (function () {
    var id = 1038, p = id + '_';
    var nRef = imgRefNode(p + 'ref', 120, 90, 'Ref Model (ref)', 'ref_model');
    var nReq = textNode(p + 'req', 120, 270, 'Yêu cầu gương mặt', 'Nữ ~20 tuổi, mặt thon gọn, da sáng, tóc đen dài búi đuôi ngựa, trang điểm tự nhiên; phong cách casting studio chân thực.');
    var nCast = aiNode(p + 'cast', 470, 170, 'AI: Casting model', 'Tạo chân dung cận cảnh siêu thực một model nữ dựa trên ảnh ref (@ref_model) và yêu cầu gương mặt. Giữ nhận diện tự nhiên, da có texture thật, ánh sáng studio, nền trắng-xám. Đây là MODEL GỐC để tái dùng.');
    var nGm = genNode(p + 'gm', 830, 170, 'Gen: Model gốc', { ratio: '3:4' });
    var nCostume = imgRefNode(p + 'costume', 120, 470, 'Trang phục (ref)', 'costume');
    var nShoes = imgRefNode(p + 'shoes', 120, 590, 'Giày (ref)', 'shoes');
    var nVisor = imgRefNode(p + 'visor', 120, 710, 'Nón/phụ kiện (ref)', 'visor');
    var nPaddle = imgRefNode(p + 'paddle', 120, 830, 'Vợt/đạo cụ (ref)', 'paddle');
    var nDress = aiNode(p + 'dress', 830, 560, 'AI: Mặc full-body', 'Tạo ảnh FULL-BODY, GIỮ NGUYÊN gương mặt model từ ảnh tham chiếu (model gốc), mặc trang phục @costume, đi giày @shoes, đội @visor, cầm @paddle. Nền studio sạch, ánh sáng đều, lookbook thể thao. Giữ y hệt chi tiết từng sản phẩm (màu/logo/chất liệu), không méo, chân thực.');
    var nGf = genNode(p + 'gf', 1200, 470, 'Gen: Full-body', { ratio: '3:4' });
    var nDl = dlNode(p + 'dl', 1560, 470);
    T.push(tpl(id, 'Model thể thao (2 tầng): tạo model gốc → mặc đồ full-body',
      'model-the-thao-2-tang',
      'Tầng 1: tạo model gốc nhất quán từ ảnh ref + yêu cầu. Tầng 2: giữ nguyên gương mặt, mặc trang phục/giày/phụ kiện (ref) → full-body lookbook → tải về. Thả ảnh của bạn vào từng node ref.',
      [nRef, nReq, nCast, nGm, nCostume, nShoes, nVisor, nPaddle, nDress, nGf, nDl],
      [E(nRef.id, nGm.id, 'output_1', 'input_1'), E(nReq.id, nCast.id, 'output_1', 'input_1'), E(nCast.id, nGm.id, 'output_1', 'input_2'),
       E(nGm.id, nGf.id, 'output_1', 'input_1'), E(nCostume.id, nGf.id, 'output_1', 'input_1'), E(nShoes.id, nGf.id, 'output_1', 'input_1'),
       E(nVisor.id, nGf.id, 'output_1', 'input_1'), E(nPaddle.id, nGf.id, 'output_1', 'input_1'),
       E(nDress.id, nGf.id, 'output_1', 'input_2'), E(nGf.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1039 — Sản phẩm cao cấp (2 TẦNG): gen chính diện → đa góc dùng ảnh trước làm ref (watch/luxury)
  (function () {
    var id = 1039, p = id + '_';
    var nProd = imgRefNode(p + 'prod', 120, 260, 'Sản phẩm (ref)', 'product');
    var nAiFront = aiNode(p + 'front', 470, 170, 'AI: Prompt chính diện', 'Từ ảnh sản phẩm @product, viết 1 prompt ảnh quảng cáo CHÍNH DIỆN cao cấp: giữ y hệt sản phẩm (hình dáng, chất liệu, logo, màu), nền trắng-xám, ánh sáng studio, phản chiếu tinh tế, tiêu chuẩn quảng cáo.');
    var nGfront = genNode(p + 'gfront', 830, 170, 'Gen: Chính diện', { ratio: '1:1' });
    var nAiAng = aiNode(p + 'ang', 830, 470, 'AI: Prompt đa góc', 'Dựa trên ảnh sản phẩm chính diện (tham chiếu), viết 4 prompt đa góc đánh số: 3/4, cạnh bên, macro chi tiết, góc thấp anh hùng. GIỮ Y HỆT sản phẩm như ảnh tham chiếu, cùng nền + ánh sáng cao cấp.');
    var nSeq = seqNode(p + 'seq', 1200, 470, 'Tách góc', { split_mode: 'auto' });
    var nGang = genNode(p + 'gang', 1560, 380, 'Gen: Đa góc', { ratio: '1:1' });
    var nDl = dlNode(p + 'dl', 1920, 380);
    T.push(tpl(id, 'Sản phẩm cao cấp (2 tầng): chính diện → đa góc nhất quán',
      'san-pham-cao-cap-2-tang',
      'Tầng 1: ảnh ref → gen ảnh chính diện chuẩn. Tầng 2: dùng ảnh chính diện làm ref → gen bộ đa góc GIỮ y hệt sản phẩm → tải về. Cho đồng hồ/nước hoa/trang sức.',
      [nProd, nAiFront, nGfront, nAiAng, nSeq, nGang, nDl],
      [E(nProd.id, nGfront.id, 'output_1', 'input_1'), E(nAiFront.id, nGfront.id, 'output_1', 'input_2'),
       E(nGfront.id, nGang.id, 'output_1', 'input_1'), E(nProd.id, nGang.id, 'output_1', 'input_1'),
       E(nAiAng.id, nSeq.id, 'output_1', 'input_1'), E(nSeq.id, nGang.id, 'output_1', 'input_2'),
       E(nGang.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1040 — Model cầm sản phẩm (2 TẦNG): tạo model mặc đồ → cầm sản phẩm quảng cáo (sunscreen)
  (function () {
    var id = 1040, p = id + '_';
    var nModel = imgRefNode(p + 'model', 120, 110, 'Model (ref)', 'model');
    var nCostume = imgRefNode(p + 'costume', 120, 260, 'Trang phục (ref)', 'costume');
    var nShoes = imgRefNode(p + 'shoes', 120, 410, 'Giày (ref)', 'shoes');
    var nAiM = aiNode(p + 'aim', 470, 210, 'AI: Model mặc đồ', 'Tạo ảnh full-body model @model mặc @costume, đi @shoes, nền studio trắng sạch, ánh sáng đều. Giữ nguyên gương mặt + chi tiết trang phục. Đây là MODEL GỐC.');
    var nGm = genNode(p + 'gm', 830, 210, 'Gen: Model mặc đồ', { ratio: '3:4' });
    var nProd = imgRefNode(p + 'prod', 120, 620, 'Sản phẩm (ref)', 'product');
    var nAiH = aiNode(p + 'aih', 830, 520, 'AI: Cầm sản phẩm', 'Từ model gốc (ảnh tham chiếu), tạo ảnh nửa người model tay cầm sản phẩm @product hướng về camera, TẬP TRUNG vào sản phẩm (sắc nét, nhãn rõ). Giữ nguyên gương mặt + trang phục. Ánh sáng quảng cáo, nền tối giản, thương mại chân thực.');
    var nGh = genNode(p + 'gh', 1200, 420, 'Gen: Model + sản phẩm', { ratio: '4:5' });
    var nDl = dlNode(p + 'dl', 1560, 420);
    T.push(tpl(id, 'Model cầm sản phẩm (2 tầng): tạo model → ghép sản phẩm',
      'model-cam-san-pham-2-tang',
      'Tầng 1: tạo model mặc trang phục nhất quán (ref). Tầng 2: giữ model đó, cầm sản phẩm (ref) hướng camera → ảnh quảng cáo → tải về. Cho mỹ phẩm/đồ uống.',
      [nModel, nCostume, nShoes, nAiM, nGm, nProd, nAiH, nGh, nDl],
      [E(nModel.id, nGm.id, 'output_1', 'input_1'), E(nCostume.id, nGm.id, 'output_1', 'input_1'), E(nShoes.id, nGm.id, 'output_1', 'input_1'),
       E(nAiM.id, nGm.id, 'output_1', 'input_2'), E(nGm.id, nGh.id, 'output_1', 'input_1'), E(nProd.id, nGh.id, 'output_1', 'input_1'),
       E(nAiH.id, nGh.id, 'output_1', 'input_2'), E(nGh.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1041 — Sản phẩm → storyboard video (2 TẦNG: phân tích/kịch bản → storyboard grid) (Vinacafe)
  (function () {
    var id = 1041, p = id + '_';
    var nProd = imgRefNode(p + 'prod', 120, 150, 'Sản phẩm (ref)', 'product');
    var nBrief = textNode(p + 'brief', 120, 330, 'Brief', 'Video quảng cáo 15s dọc 9:16, 9 phân cảnh, phong cách điện ảnh sạch, tông ấm, kể chuyện từ nguyên liệu → sản phẩm hoàn thiện.');
    var nScript = aiNode(p + 'script', 470, 240, 'AI: Kịch bản', 'Từ sản phẩm @product và brief, phân tích + viết KỊCH BẢN video 15s 9:16 gồm 9 phân cảnh: mỗi phân cảnh có bối cảnh, chuyển động máy, thời lượng. Điện ảnh, sạch, tông ấm.');
    var nBoard = aiNode(p + 'board', 830, 240, 'AI: Storyboard grid', 'Từ kịch bản trên, viết 1 prompt tạo STORYBOARD GRID 3x3 (9 panel = 9 phân cảnh). Mỗi panel 1 keyframe điện ảnh, tông màu + ánh sáng + phong cách NHẤT QUÁN. Mô tả chi tiết từng panel trong 1 prompt.');
    var nGen = genNode(p + 'gen', 1200, 240, 'Gen: Storyboard grid', { ratio: '9:16', quantity: 1 });
    var nDl = dlNode(p + 'dl', 1560, 240);
    T.push(tpl(id, 'Sản phẩm → storyboard video (2 tầng: kịch bản → grid 3x3)',
      'san-pham-storyboard-video-2-tang',
      'Tầng 1: sản phẩm + brief → AI viết kịch bản 9 phân cảnh. Tầng 2: kịch bản → prompt storyboard grid 3x3 → generate 1 ảnh grid keyframe → tải về. Tiền-kỳ dựng video.',
      [nProd, nBrief, nScript, nBoard, nGen, nDl],
      [E(nBrief.id, nScript.id, 'output_1', 'input_1'), E(nScript.id, nBoard.id, 'output_1', 'input_1'),
       E(nProd.id, nGen.id, 'output_1', 'input_1'), E(nBoard.id, nGen.id, 'output_1', 'input_2'),
       E(nGen.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // 1044 — Mở rộng khung ảnh (outpaint) rồi DÁN LẠI ảnh gốc. Đây là cách duy nhất giữ được
  // 100% pixel vùng tâm: prompt không khoá được pixel, code thì khoá được.
  (function () {
    var id = 1044, p = id + '_';
    var nSrc = imgRefNode(p + 'src', 120, 200, 'Ảnh gốc', 'source_image');
    var nAi = aiNode(p + 'ai', 470, 200, 'AI: Prompt mở rộng',
      'Nhìn ảnh @source_image và viết MỘT prompt outpaint gọn (dưới 160 từ) để nới ảnh sang trái và phải cho đầy khung 16:9. Chỉ tả phần RÌA cần bịa thêm: tiếp tục tường, sàn, đường cửa sổ, khung cảnh ngoài cửa. Yêu cầu khớp phối cảnh, độ cao máy, ống kính, độ sâu trường ảnh, phơi sáng, cân bằng trắng và tông màu của ảnh gốc. Cấm tối đa 5 thứ. KHÔNG viết mục NEGATIVE PROMPT, KHÔNG ghi 8K.');
    var nGen = genNode(p + 'gen', 830, 200, 'Gen: Ảnh đã mở rộng', { ratio: '16:9' });
    var nComp = { id: p + 'comp', type: 'image_composite', position: { x: 1190, y: 200 }, data: {
      node_name: 'Ghép ảnh', label: 'Ghép ảnh', enabled: true, node_zoom: 1,
      slug: 'image_composite', slug_auto: true, composite_mode: 'center', composite_feather: 0 } };
    var nDl = dlNode(p + 'dl', 1550, 200);
    T.push(tpl(id, 'Mở rộng khung ảnh (outpaint) + giữ nguyên tâm ảnh',
      'mo-rong-khung-giu-nguyen-tam',
      'Nới ảnh sang hai bên cho đầy 16:9, rồi DÁN LẠI ảnh gốc lên vùng tâm để phần gốc giữ nguyên từng pixel. Không có bước dán này thì mọi câu lệnh giữ nguyên ảnh gốc đều vô nghĩa — model khuếch tán luôn tái sinh toàn khung.',
      [nSrc, nAi, nGen, nComp, nDl],
      [
        E(p + 'src', p + 'ai'),
        E(p + 'ai', p + 'gen', 'output_1', 'input_2'),
        E(p + 'src', p + 'gen'),
        E(p + 'gen', p + 'comp', 'output_1', 'base'),
        E(p + 'src', p + 'comp', 'output_1', 'overlay'),
        E(p + 'comp', p + 'dl'),
      ]));
    T[T.length - 1].thumbnail_url = null;
  })();
  // 1043 — Bảng thực thể → loạt cảnh nhất quán → cổng chất lượng.
  // Template MẪU cho 2 node mới. Dạy đúng cách dùng: gen ảnh gốc TRƯỚC, gom vào Bảng
  // thực thể, rồi mọi cảnh mới lấy ref từ đó — thay vì @mention ref thủ công từng node.
  (function () {
    var id = 1043, p = id + '_';
    var nCast = textNode(p + 'cast', 120, 120, 'Khai dàn nhân vật',
      'Pippip | character | mèo vàng, tạp dề xanh, mắt to tròn\nChợ Cá | location | bến cảng lúc sớm, sương mờ, thuyền gỗ');
    var nAiRef = aiNode(p + 'airef', 470, 120, 'AI: Prompt ảnh gốc',
      'Với MỖI dòng thực thể ở trên, viết 1 prompt tạo ảnh tham chiếu nhân dạng. Nhân vật: toàn thân chính diện, nền trơn. Bối cảnh: cảnh thiết lập, KHÔNG có nhân vật. Không chữ, không watermark. Mỗi prompt cách nhau bằng dòng ---');
    var nSeqRef = seqNode(p + 'seqref', 830, 120, 'Tách prompt ảnh gốc', { split_mode: 'separator', max_scenes: 8 });
    var nGenRef = genNode(p + 'genref', 1190, 120, 'Gen: Ảnh gốc', { ratio: '3:4' });
    // Bảng thực thể: nhận ảnh gốc, xuất ref + khối CAST cho mọi cảnh phía sau.
    var nEnt = { id: p + 'ent', type: 'entity_ref', position: { x: 1550, y: 120 }, data: {
      node_name: 'Bảng thực thể', label: 'Bảng thực thể', enabled: true, node_zoom: 1,
      slug: 'entity_ref', slug_auto: true,
      entities: 'Pippip | character | mèo vàng, tạp dề xanh, mắt to tròn\nChợ Cá | location | bến cảng lúc sớm, sương mờ, thuyền gỗ',
      entity_label: 'CAST' } };
    var nAiSc = aiNode(p + 'aisc', 1550, 380, 'AI: Viết 6 cảnh',
      'Viết 6 cảnh đánh số cho câu chuyện. CHỈ gọi thực thể BẰNG TÊN và tả HÀNH ĐỘNG — TUYỆT ĐỐI không tả lại ngoại hình (ảnh tham chiếu đã quy định phần đó, tả lại sẽ làm nhân vật trôi). Mỗi cảnh 1 prompt, cách nhau bằng dòng ---');
    var nSeqSc = seqNode(p + 'seqsc', 1910, 380, 'Tách cảnh', { split_mode: 'separator', max_scenes: 6 });
    var nGenSc = genNode(p + 'gensc', 2270, 380, 'Gen: Cảnh', { ratio: '16:9' });
    // Cổng chất lượng: đạt → tải; trượt → quay lại gen cảnh.
    var nQa = { id: p + 'qa', type: 'quality_gate', position: { x: 2630, y: 380 }, data: {
      node_name: 'Cổng chất lượng', label: 'Cổng chất lượng', enabled: true, node_zoom: 1,
      slug: 'quality_gate', slug_auto: true,
      qa_threshold: 7.5, qa_sampling: 'light', qa_focus: 'nhất quán nhân vật giữa các cảnh, bàn tay, chữ trong ảnh' } };
    var nDl = dlNode(p + 'dl', 2990, 280);
    T.push(tpl(id, 'Dàn nhân vật nhất quán → 6 cảnh → cổng chất lượng',
      'dan-nhan-vat-nhat-quan-qa',
      'Cách chuẩn để loạt ảnh KHÔNG trôi nhận diện: gen ảnh gốc cho từng nhân vật/bối cảnh trước, gom vào Bảng thực thể, rồi mọi cảnh đều lấy ref từ đó. Cảnh chỉ gọi TÊN và tả HÀNH ĐỘNG. Cuối luồng có cổng chấm chất lượng, trượt thì tự quay lại gen.',
      [nCast, nAiRef, nSeqRef, nGenRef, nEnt, nAiSc, nSeqSc, nGenSc, nQa, nDl],
      [
        E(p + 'cast', p + 'airef', 'output_1', 'input_2'),
        E(p + 'airef', p + 'seqref'),
        E(p + 'seqref', p + 'genref', 'output_1', 'input_2'),
        E(p + 'genref', p + 'ent'),
        E(p + 'ent', p + 'aisc', 'output_1', 'input_2'),
        E(p + 'aisc', p + 'seqsc'),
        E(p + 'seqsc', p + 'gensc', 'output_1', 'input_2'),
        E(p + 'ent', p + 'gensc'),          // ref thực thể vào cổng ảnh của node gen cảnh
        E(p + 'gensc', p + 'qa'),
        E(p + 'qa', p + 'dl', 'pass'),       // đạt → tải
        E(p + 'qa', p + 'gensc', 'fail'),    // trượt → gen lại cảnh
      ]));
    // tpl() tự đặt thumbnail_url = thumb_<id>.png. Template này CHƯA có ảnh bìa nên trỏ
    // vào file không tồn tại → bìa vỡ. Để null thì WorkflowTemplateList tự dựng bìa từ
    // tên + tag (_renderGeneratedCover). Có ảnh thật thì bỏ dòng này đi.
    T[T.length - 1].thumbnail_url = null;
  })();

  // 1042 — Nhóm model + sản phẩm → chiến dịch (2 TẦNG: tạo nhóm model → cảnh chiến dịch) (Coca-Cola)
  (function () {
    var id = 1042, p = id + '_';
    var nRefM = imgRefNode(p + 'refm', 120, 130, 'Ref nhóm model', 'ref_models');
    var nReq = textNode(p + 'req', 120, 310, 'Mô tả nhóm', 'Nhóm 4-5 bạn nữ trẻ Á Đông, phong cách trẻ trung năng động, trang phục màu tươi phối nhau, cảm giác nhóm bạn thân.');
    var nAiM = aiNode(p + 'aim', 470, 210, 'AI: Tạo nhóm model', 'Tạo ảnh nhóm model từ ảnh ref (@ref_models) và mô tả. Giữ nhóm nhận diện nhất quán, phong cách trẻ trung, nền studio. Đây là NHÓM GỐC để tái dùng.');
    var nGm = genNode(p + 'gm', 830, 210, 'Gen: Nhóm model', { ratio: '4:5' });
    var nProd = imgRefNode(p + 'prod', 120, 520, 'Sản phẩm (ref)', 'product');
    var nAiC = aiNode(p + 'aic', 830, 510, 'AI: Cảnh chiến dịch', 'Từ nhóm model gốc (ảnh tham chiếu) và sản phẩm @product, viết 6 cảnh chiến dịch quảng cáo đánh số: nhóm vui vẻ ngoài trời dùng @product (cười, khoe nhãn, uống/dùng, cheers, cận sản phẩm, toàn cảnh). GIỮ nhóm model + sản phẩm NHẤT QUÁN. Mỗi cảnh 1 prompt.');
    var nSeq = seqNode(p + 'seq', 1200, 510, 'Tách cảnh', { split_mode: 'auto', max_scenes: 6 });
    var nGc = genNode(p + 'gc', 1560, 400, 'Gen: Cảnh chiến dịch', { ratio: '4:5' });
    var nDl = dlNode(p + 'dl', 1920, 400);
    T.push(tpl(id, 'Nhóm model + sản phẩm → chiến dịch (2 tầng)',
      'nhom-model-chien-dich-2-tang',
      'Tầng 1: tạo nhóm model gốc nhất quán (ref + mô tả). Tầng 2: nhóm đó + sản phẩm → AI dựng 6 cảnh chiến dịch → tách → generate → tải về. Cho campaign FMCG nhiều người.',
      [nRefM, nReq, nAiM, nGm, nProd, nAiC, nSeq, nGc, nDl],
      [E(nRefM.id, nGm.id, 'output_1', 'input_1'), E(nReq.id, nAiM.id, 'output_1', 'input_1'), E(nAiM.id, nGm.id, 'output_1', 'input_2'),
       E(nGm.id, nGc.id, 'output_1', 'input_1'), E(nProd.id, nGc.id, 'output_1', 'input_1'),
       E(nAiC.id, nSeq.id, 'output_1', 'input_1'), E(nSeq.id, nGc.id, 'output_1', 'input_2'),
       E(nGc.id, nDl.id, 'output_1', 'input_1')]));
  })();

  // Metadata per-template: category + tags khớp ĐÚNG tên/chức năng từng cái (card hiện category;
  // tags cho tìm kiếm). media_type tự suy từ node gen (Video nếu có node media_type Video, else Image).
  var META = {
    1001: ['Pipeline sinh ảnh', ['pipeline', 'scene', 'batch', 'nhất quán']],
    1002: ['Storyboard', ['storyboard', 'batch', 'kể chuyện', '8-panel']],
    1003: ['Nhân vật', ['nhân vật', 'koc', 'nhất quán', 'pose']],
    1004: ['Đa provider', ['so sánh', 'multi-model', 'flow', 'chatgpt', 'grok']],
    1005: ['Đa dạng hoá', ['random', 'style', 'biến thể']],
    1006: ['Prompt động', ['text-template', 'brand', 'sản phẩm']],
    1007: ['Điều khiển luồng', ['condition', 'rẽ nhánh', 'logic']],
    1008: ['Sản phẩm', ['sản phẩm', 'góc', 'e-commerce']],
    1009: ['E-commerce', ['shopee', 'listing', 'e-commerce', 'sản phẩm']],
    1010: ['F&B', ['menu', 'món ăn', 'nhà hàng']],
    1011: ['UGC / KOL', ['ugc', 'koc', 'review', 'social']],
    1012: ['Thương hiệu', ['brand', 'kit', 'nhận diện']],
    1013: ['Social', ['carousel', 'social', 'slide']],
    1014: ['Marketing mùa vụ', ['tết', 'campaign', 'seasonal']],
    1015: ['Tiện ích prompt', ['dịch prompt', 'tiếng Việt', 'prompt AI']],
    1016: ['Pipeline sinh ảnh', ['pipeline', 'chuỗi prompt', 'batch', 'nhất quán']],
    1017: ['Tutorial', ['recipe', 'tutorial', 'bước', 'food']],
    1018: ['Thời trang', ['lookbook', 'fashion', 'nhất quán']],
    1019: ['Du lịch', ['travel', 'series', 'du lịch']],
    1020: ['Văn hoá VN', ['con giáp', 'tết', 'bộ', 'lịch']],
    1021: ['Sticker', ['emoji', 'sticker', 'nhân vật']],
    1022: ['Creator', ['youtube', 'banner', 'thumbnail', 'nhận diện']],
    1023: ['Marketing', ['ngành dọc', 'marketing', 'brand']],
    1024: ['Cưới', ['cưới', 'wedding', 'album']],
    1025: ['Bất động sản', ['bất động sản', 'nội thất', 'tour']],
    1026: ['Quảng cáo', ['ad', 'story', 'kể chuyện']],
    1027: ['Sản phẩm', ['360', 'sản phẩm', 'đa góc']],
    1028: ['Đa nền tảng', ['ratio', 'đa nền tảng', 'adapt']],
    1029: ['Nhân vật', ['day-in-life', 'nhân vật', 'story']],
    1030: ['Video — Thiên nhiên', ['pov', 'video', 'thiên nhiên']],
    1031: ['Video — Timelapse', ['timelapse', 'video', 'tư liệu']],
    1032: ['Nhân vật', ['nhân vật', '2d', 'series']],
    1033: ['Nhân vật', ['clay', '3d', 'nhân vật']],
    1034: ['Video — Quảng cáo', ['video', 'quảng cáo', 'điện ảnh']],
    1035: ['Sản phẩm', ['bubble', 'hero', 'sản phẩm']],
    1036: ['Sản phẩm', ['sneaker', 'giày', 'showcase']],
    1037: ['Video — Tư liệu', ['video', 'động vật', 'tư liệu']],
    1038: ['Model + sản phẩm (ref)', ['model', 'trang phục', 'lookbook', 'nhất quán', 'ref']],
    1039: ['Sản phẩm cao cấp (ref)', ['sản phẩm', 'đa góc', 'showcase', 'ref', 'cao cấp']],
    1040: ['Model + sản phẩm (ref)', ['model', 'cầm sản phẩm', 'quảng cáo', 'ref']],
    1041: ['Storyboard video (ref)', ['storyboard', 'video', 'grid', 'sản phẩm', 'ref']],
    1044: ['Mở rộng khung', ['outpaint', 'mở rộng', '16:9', 'giữ pixel']],
    1043: ['Nhân vật nhất quán', ['nhân vật', 'nhất quán', 'ref', 'QA', 'chất lượng']],
    1042: ['Chiến dịch nhóm (ref)', ['campaign', 'nhóm model', 'sản phẩm', 'ref']],
  };
  var CATEGORY_GROUPS = {
    1: { id: 1, name: 'Ảnh & Visual', slug: 'image-visual', icon: 'image' },
    2: { id: 2, name: 'Video & Motion', slug: 'video-motion', icon: 'video' },
    3: { id: 3, name: 'Sản phẩm & TMĐT', slug: 'product-ecommerce', icon: 'shopping-bag' },
    4: { id: 4, name: 'Thời trang & Nhân vật', slug: 'fashion-character', icon: 'user' },
    5: { id: 5, name: 'Marketing & Social', slug: 'marketing-social', icon: 'megaphone' },
    6: { id: 6, name: 'Prompt & Tiện ích', slug: 'prompt-utility', icon: 'sparkles' }
  };
  var EXTRA_CATEGORY_ID = {
    1001: 1, 1002: 6, 1003: 4, 1004: 6, 1005: 6, 1006: 6, 1007: 6, 1008: 3,
    1009: 3, 1010: 3, 1011: 5, 1012: 5, 1013: 5, 1014: 5, 1015: 6, 1016: 1,
    1017: 6, 1018: 4, 1019: 1, 1020: 1, 1021: 4, 1022: 5, 1023: 5, 1024: 5,
    1025: 3, 1026: 5, 1027: 3, 1028: 5, 1029: 4, 1030: 2, 1031: 2, 1032: 4,
    1033: 4, 1034: 2, 1035: 3, 1036: 3, 1037: 2, 1038: 4, 1039: 3, 1040: 3,
    1041: 6, 1042: 5
  };
  var EXTRA_DESC = {
    1035: 'Tạo ảnh hero sản phẩm bay trong bong bóng nước hoặc thuỷ tinh trên nền trời. Workflow xuất bộ ảnh sản phẩm, có thể dùng làm keyframe để dựng video sau.',
    1036: 'Tạo bộ ảnh showcase giày sneaker nhiều góc với ánh sáng điện ảnh, giữ nhận diện đôi giày nhất quán và phù hợp cho chiến dịch ra mắt sản phẩm.',
    1041: 'Workflow tiền kỳ video: ảnh sản phẩm + brief → kịch bản 9 phân cảnh → storyboard grid 3x3 để dùng làm nền dựng video.'
  };
  function uniqueTags(tags) {
    var aliases = {
      'ref': 'ảnh ref',
      'multi-model': 'so sánh model',
      'random': 'ngẫu nhiên',
      'style': 'phong cách',
      'text-template': 'prompt động',
      'condition': 'rẽ nhánh',
      'campaign': 'chiến dịch',
      'seasonal': 'mùa vụ',
      'recipe': 'công thức',
      'food': 'ẩm thực',
      'fashion': 'thời trang',
      'travel': 'du lịch',
      'wedding': 'cưới',
      'ad': 'quảng cáo',
      'story': 'kể chuyện',
      'adapt': 'đa nền tảng',
      'day-in-life': 'một ngày',
      'clay': 'đất sét',
      'bubble': 'bubble hero',
      'brand': 'thương hiệu',
      'grid': 'storyboard grid'
    };
    var out = [], seen = {};
    (tags || []).forEach(function (tag) {
      tag = String(tag || '').trim();
      tag = aliases[tag.toLowerCase()] || tag;
      if (!tag || seen[tag]) return;
      seen[tag] = 1; out.push(tag);
    });
    return out;
  }
  T.forEach(function (t) {
    var m = META[t.id];
    var hasVideo = (t.nodes || []).some(function (n) { return n.data && n.data.media_type === 'Video'; });
    var mediaType = hasVideo ? 'Video' : 'Image';
    var categoryId = EXTRA_CATEGORY_ID[t.id] || (hasVideo ? 2 : 1);
    var group = CATEGORY_GROUPS[categoryId] || CATEGORY_GROUPS[1];
    var sourceCategory = m ? m[0] : 'Workflow';

    t.media_type = mediaType;
    t.category_id = group.id;
    var prefix = categoryId === 6 ? 'Tiện ích — ' : (mediaType === 'Video' ? 'Video — ' : 'Ảnh — ');
    // Vài mục trong META đã tự mang sẵn tiền tố (vd 'Video — Thiên nhiên'), nên nối thẳng sẽ ra
    // 'Video — Video — Thiên nhiên'. Đã xảy ra ở 1030/1031/1034/1037. Cắt tiền tố trùng trước khi nối
    // thay vì sửa tay từng mục — sửa tay thì mục thêm sau lại lặp lại lỗi này.
    var bare = String(sourceCategory || '');
    if (bare.indexOf(prefix) === 0) bare = bare.slice(prefix.length);
    t.category_name = prefix + bare;
    t.category = { id: group.id, name: t.category_name, slug: group.slug, icon: group.icon };
    t.tags = uniqueTags([mediaType === 'Video' ? 'video' : 'ảnh'].concat(m ? m[1] : []));
    t.node_count = (t.nodes || []).length;
    if (EXTRA_DESC[t.id]) t.description = EXTRA_DESC[t.id];
  });

  // Append idempotent vào BUNDLED_TEMPLATES (guard trùng id)
  try {
    if (!Array.isArray(root.BUNDLED_TEMPLATES)) root.BUNDLED_TEMPLATES = [];
    var have = {};
    root.BUNDLED_TEMPLATES.forEach(function (t) { if (t && t.id != null) have[String(t.id)] = 1; });
    var added = 0;
    T.forEach(function (t) { if (!have[String(t.id)]) { root.BUNDLED_TEMPLATES.push(t); added++; } });
    if (typeof console !== 'undefined') console.log('[BundledWorkflowsExtra] Appended ' + added + ' SEOSONA workflow template(s).');
  } catch (e) { if (typeof console !== 'undefined') console.warn('[BundledWorkflowsExtra] append failed', e); }
})(typeof window !== 'undefined' ? window : this);
