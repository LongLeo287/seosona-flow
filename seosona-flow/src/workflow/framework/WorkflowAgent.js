/**
 * SEOSONA Flow — WorkflowAgent (runtime, in-extension)
 * ------------------------------------------------------------------
 * Agent: mô tả tiếng Việt/Anh → workflow node+edge hợp lệ, chèn được lên canvas.
 * Luồng: NL → meta-prompt (nhúng catalog) → gửi provider tab (ChatGPT/Claude qua pa:generate)
 *        → nhận JSON spec → WFOps.createWorkflow → WFValidate → (auto-repair nếu lỗi) → template.
 *
 * Phụ thuộc globals (load TRƯỚC): catalog.js → schema.js → validate.js → operations.js.
 * KHÔNG network trực tiếp — chỉ dùng automation trình duyệt có sẵn (local-first).
 */
(function (root) {
  'use strict';
  const S = root.WFSchema, V = root.WFValidate, O = root.WFOps;
  if (!S || !V || !O) { console.error('[WorkflowAgent] thiếu framework core (WFSchema/WFValidate/WFOps)'); return; }

  // Tóm tắt catalog gọn cho meta-prompt (18 type + port + nhóm).
  function catalogSummary() {
    const lines = [];
    for (const [t, c] of Object.entries(S.NODE_CATALOG)) {
      const pin = (c.ports_in || []).map((p, i) => `input_${i + 1}=${p.name}(${p.type})`).join(',') || '—';
      const pout = (c.ports_out || []).map((p, i) => `output_${i + 1}=${p.name}`).join(',') || '—';
      lines.push(`- ${t}: in[${pin}] out[${pout}]`);
    }
    return lines.join('\n');
  }

  // Quy ước khai thác từ BUNDLED_TEMPLATES (nếu module có mặt). Guarded: thiếu → chuỗi rỗng,
  // prompt vẫn chạy bằng mô tả tay bên dưới.
  function conventions() {
    try {
      var C = root.WorkflowConventions;
      return (C && C.summary) ? (C.summary() || '') : '';
    } catch (_) { return ''; }
  }

  function metaPrompt(nl) {
    return [
      'You are a node-graph workflow architect for the SEOSONA Flow browser extension (local AI image/video generation).',
      'Task: convert the USER REQUEST into one workflow. Return ONLY a single JSON object matching the SPEC below — no explanation, no markdown fence.',
      '',
      'SPEC (structure is mandatory):',
      '{',
      '  "name": "<short name, written in the SAME language as the user request>",',
      '  "category_id": 1,',
      '  "nodes": [ { "type": "<node type>", "data": { "prompt": "...", "media_type": "Image|Video", "model": "...", "ratio": "Ngang|Dọc|Vuông", "quantity": 1 } } ],',
      '  "edges": [ [fromNodeIndex, fromPort, toNodeIndex, toPort] ]   // node index is 0-based; port numbers are 1-based',
      '}',
      '',
      'IMPORTANT — these enum values are literal keys of the app and MUST be written exactly as shown, do NOT translate them:',
      '  ratio: "Ngang" (landscape 16:9) | "Dọc" (portrait 9:16) | "Vuông" (square 1:1)',
      '  media_type: "Image" | "Video"',
      '',
      'VALID NODE TYPES (use only these, with the exact ports shown):',
      catalogSummary(),
      '',
      // Quy ước khai thác từ workflow THẬT — thắng mọi mô tả tay bên dưới nếu có mâu thuẫn.
      // Tự cập nhật khi template đổi, nên không bị lỗi thời như prompt viết tay.
      conventions(),
      '',
      'RULES:',
      '- Reference images connect to input_1 (image_ref); text prompts from a "text" node connect to input_2 of generate.',
      '- Generators: "generate" (Google Flow — image models: Nano Banana 2 / Nano Banana Pro; video models: Veo 3.1 - Quality / Omni Flash), "chatgpt", "grok".',
      '- End the graph with a "download" node to save results. Never create a cycle.',
      '- If media_type is "Video", the model must be a video model and ratio must be "Ngang" or "Dọc".',
      '- One responsibility per node. Use only fields that exist in data. NEVER invent node types or model names.',
      '',
      'PROMPT CRAFT (apply to data.prompt of prompt/generate nodes for higher quality output):',
      '- VIDEO: write only what is VISIBLE (observable action, no abstract words). Use POSITIVE phrasing only (avoid "no"/"without"). Structure the description as SUBJECT+ACTION / SETTING / LIGHTING / COLOR / CAMERA / MOTION. Express lens as field-of-view in degrees rather than millimetres, and quantify motion.',
      '- IMAGE→VIDEO: use two layers — a first-frame image prompt (SUBJECT / EMOTION / SETTING / DEPTH / CAMERA), then a motion prompt (STARTING STATE / PRIMARY MOTION / REACTION / ENVIRONMENT MOTION / CAMERA / END FRAME). Connect the image node into input_1 of the video node, and the text prompt into input_2 of both.',
      '- ADS: three beats — 0-3s hook, 3-18s body, 18-25s close. End on brand or emotion, not a platform-specific call to action.',
      '- E-COMMERCE: lock product identity (keep SKU, label and logo intact); a full PDP set runs hero → detail → spec.',
      '- Replace abstract concepts with drawable symbols (e.g. "security" → a padlock, "system" → gears).',
      '- TEXT INSIDE IMAGES (posters/banners/logos that need correct wording): USE THE "text_overlay" NODE — connect the image into input_1 and the text into input_2. That node draws real vector text, so spelling and diacritics are always correct. The image prompt should ask the model to LEAVE A CLEAN EMPTY AREA for that text. Only bake text into the image when overlay is impossible: then keep it to 3 words or fewer, UPPERCASE, and without diacritics.',
      '- CHARACTER / STYLE CONSISTENCY: USE THE "style_anchor" NODE placed BEFORE the generate node. Put the style block in data.anchor_block (one trait per line: material, palette, lighting, lens). That node injects the block into every prompt passing through, so a multi-scene set never drifts. Do not copy the block manually into each node.',
      '- TEXT VERIFICATION: if wording inside an image must be exact, add a "text_qa" node after the image node to OCR and compare it.',
      '- MANY SCENES FROM ONE SCRIPT: use the "prompt_sequence" node to split a script into scenes instead of hand-writing many prompt nodes.',
      '- COST: merge variants/scenes into a single generate node by raising quantity rather than duplicating nodes; avoid redundant generations.',
      '',
      'Write data.prompt in English (image and video models follow English best), EXCEPT text that must literally appear in the artwork, and culturally specific proper nouns (for example "áo dài", "Tết"), which must be kept verbatim.',
      '',
      'USER REQUEST:',
      nl,
      '',
      'Return the JSON spec (JSON only):',
    ].join('\n');
  }

  function repairPrompt(spec, errors) {
    return [
      'The workflow JSON spec below failed validation. Fix it and return ONLY the corrected JSON spec (no explanation).',
      'Keep every part that is already correct — change only what the errors point at.',
      'Errors:',
      ...errors.map(e => `- [${e.code}] ${e.msg}`),
      '',
      'Spec to fix:',
      JSON.stringify(spec, null, 1),
    ].join('\n');
  }

  // Bóc JSON object đầu tiên trong text (chịu được markdown fence / lời dẫn).
  function extractJson(text) {
    if (!text) return null;
    let t = String(text).replace(/```json/gi, '```').trim();
    const fence = t.match(/```\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    const i = t.indexOf('{'); if (i < 0) return null;
    // cân ngoặc để lấy object đầy đủ
    let d = 0, inStr = false, esc = false, q = '';
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) inStr = false; }
      else { if (c === '"' || c === "'") { inStr = true; q = c; } else if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { try { return JSON.parse(t.slice(i, j + 1)); } catch (_) { return null; } } } }
    }
    return null;
  }

  function callProvider(provider, prompt, timeout) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'pa:generate', provider: provider || 'chatgpt', metaPrompt: prompt, images: [], timeout: timeout || 300000 },
          (resp) => { void chrome.runtime.lastError; resolve(resp || { success: false, error: 'NO_RESPONSE' }); });
      } catch (e) { resolve({ success: false, error: 'SEND_FAIL', message: e.message }); }
    });
  }

  /**
   * Sinh workflow từ mô tả NL.
   * @param {string} nl - mô tả ("bài viết → 5 ảnh 9:16 → ghép video")
   * @param {{provider?:string, autoRepair?:boolean, onStep?:function}} opt
   * @returns {Promise<{ok, template?, validation?, spec?, raw?, error?}>}
   */
  async function generate(nl, opt) {
    opt = opt || {};
    const provider = opt.provider || 'chatgpt';
    const step = opt.onStep || (() => {});
    if (!nl || !nl.trim()) return { ok: false, error: 'EMPTY_REQUEST' };

    // [Memory 3-tầng] Nạp ngữ cảnh liên quan (profile brand/prefs + workflow đã tạo) — GUARDED:
    // no-op nếu MemoryStore chưa load. rank-then-load top-5 → nhất quán với các lần trước.
    let memCtx = '';
    try {
      if (self.MemoryStore && self.MemoryStore.search) {
        try { if (self.MemoryStore.seedDefaults) await self.MemoryStore.seedDefaults(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowAgent#generate', _); }
        const hits = await self.MemoryStore.search(nl, { limit: 5 });
        if (hits && hits.length) memCtx = '\n\nNGỮ CẢNH ĐÃ BIẾT (tham khảo để nhất quán với trước đây):\n' + hits.map((h) => '- ' + (h.text || '')).join('\n');
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowAgent#generate', _); }

    step('Gửi yêu cầu tới ' + provider + '…');
    let resp = await callProvider(provider, metaPrompt(nl + memCtx), opt.timeout);
    if (!resp || resp.success === false) return { ok: false, error: resp && resp.error || 'PROVIDER_FAIL', raw: resp };
    const text = resp.text || resp.result || resp.response || '';
    let spec = extractJson(text);
    if (!spec) return { ok: false, error: 'PARSE_FAIL', raw: text };

    step('Dựng + kiểm tra workflow…');
    let built;
    try { built = O.createWorkflow(spec); }
    catch (e) { return { ok: false, error: 'BUILD_FAIL', message: e.message, spec, raw: text }; }

    // Auto-repair 1 vòng nếu có error CẤU TRÚC
    if (!built.validation.ok && opt.autoRepair !== false) {
      step('Workflow có lỗi — yêu cầu ' + provider + ' sửa…');
      const rr = await callProvider(provider, repairPrompt(spec, built.validation.errors), opt.timeout);
      const rtext = rr && (rr.text || rr.result) || '';
      const rspec = extractJson(rtext);
      if (rspec) { try { const rebuilt = O.createWorkflow(rspec); if (rebuilt.validation.ok || rebuilt.validation.errors.length < built.validation.errors.length) { built = rebuilt; spec = rspec; } } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowAgent#generate', _); } }
    }

    // === KIỂM ĐÚNG Ý (không chỉ đúng cấu trúc) ===
    // Validate ở trên chỉ hỏi "node có thật không, port khớp không" — một workflow hợp lệ vẫn có thể
    // SAI HOÀN TOÀN Ý user (xin 5 ảnh dọc mà ra 1 ảnh ngang). Ở đây rút ràng buộc kiểm-được từ yêu
    // cầu rồi đối chiếu; lệch thì gửi chính chỗ lệch cho AI sửa (kênh phản hồi khác lỗi cấu trúc).
    let intent = null, intentCheck = null;
    try {
      const WI = root.WorkflowIntent;
      if (WI && built.validation.ok) {
        intent = WI.extract(nl);
        intentCheck = WI.verify(built.template, intent);
        if (!intentCheck.ok && opt.autoRepair !== false) {
          step('Workflow chưa khớp yêu cầu — yêu cầu ' + provider + ' chỉnh…');
          const fb = WI.feedback(intentCheck.mismatches) + '\n\nSpec hiện tại:\n' + JSON.stringify(spec, null, 1);
          const ir = await callProvider(provider, fb, opt.timeout);
          const ispec = extractJson((ir && (ir.text || ir.result)) || '');
          if (ispec) {
            try {
              const irebuilt = O.createWorkflow(ispec);
              const icheck = irebuilt.validation.ok ? WI.verify(irebuilt.template, intent) : null;
              // Chỉ nhận bản sửa nếu VẪN hợp lệ cấu trúc VÀ lệch ít hơn — không đánh đổi cái đang đúng.
              if (icheck && icheck.mismatches.length < intentCheck.mismatches.length) {
                built = irebuilt; spec = ispec; intentCheck = icheck;
              }
            } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowAgent#generate', _); }
          }
        }
      }
    } catch (_) { /* kiểm ý không bao giờ được làm hỏng luồng tạo */ }

    // [Memory] Ghi lại workflow vừa tạo (episodic) để lần sau nhất quán — GUARDED.
    try {
      if (self.MemoryStore && self.MemoryStore.remember && built.validation.ok) {
        const nm = (built.template && (built.template.wf_name || built.template.name)) || nl.slice(0, 80);
        self.MemoryStore.remember('Đã tạo workflow "' + nm + '" từ: ' + nl.slice(0, 120), ['workflow', 'agent']);
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowAgent#generate', _); }

    // ok = đúng CẤU TRÚC. intentOk = đúng Ý. Tách riêng để UI nói rõ workflow chạy được nhưng
    // còn lệch chỗ nào, thay vì im lặng giao một workflow sai ý.
    return {
      ok: built.validation.ok, template: built.template, validation: built.validation, spec, raw: text,
      intent, intentOk: intentCheck ? intentCheck.ok : null, mismatches: intentCheck ? intentCheck.mismatches : [],
    };
  }

  root.WorkflowAgent = { generate, metaPrompt, extractJson, catalogSummary };
})(typeof self !== 'undefined' ? self : this);
