/**
 * WorkflowExecutor - Engine thực thi workflows
 * Chạy nodes theo thứ tự topological sort
 */

(function() {
  'use strict';

  const DEBUG = false;

  function log(...args) {
    if (DEBUG) console.log('[WorkflowExecutor]', ...args);
  }

  /**
   * Extract Flow file_name (UUID) from thumbnail URL.
   * Flow URLs contain: getMediaUrlRedirect?name=UUID or ?input={"json":{"name":"UUID"}}
   * BUG FIX 2026-05-11: Khi bridge ChatGPT/Grok → Flow, tileDetails.file_name có thể bị empty
   * → dùng thumbnail URL để extract file_name, tránh reupload sau reload page.
   */
  function extractFileNameFromUrl(url) {
    const _pat = window._getMediaUrlPattern?.() || 'getMediaUrlRedirect';
    if (!url || !url.includes(_pat)) return '';
    try {
      const urlObj = new URL(url, 'https://aitestkitchen.withgoogle.com');
      // Pattern 1: ?name=UUID (simple)
      const name = urlObj.searchParams.get('name');
      if (name && /^[a-f0-9-]{8,}$/i.test(name)) return name;
      // Pattern 2: tRPC ?input={"json":{"name":"UUID"}}
      const input = urlObj.searchParams.get('input');
      if (input) {
        const parsed = JSON.parse(decodeURIComponent(input));
        const json = parsed?.json || parsed?.['0']?.json || parsed;
        if (json?.name && /^[a-f0-9-]{8,}$/i.test(json.name)) return json.name;
      }
    } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#extractFileNameFromUrl', e); }
    return '';
  }

  // [P2.2] Thumbnail cache decoupled: ưu tiên window.tileCache (shared, TileCache.js) —
  // fallback editor instance cho context chưa load module. Run-host headless không cần editor.
  function getThumbCache() {
    if (window.tileCache instanceof Map) return window.tileCache;
    return window.workflowEditor?._tileCache || null;
  }

  // Relay key execution events to other extension contexts (popup editor window)
  function broadcastEvent(event, data) {
    try {
      chrome.runtime.sendMessage({
        action: 'workflowExecutionEvent',
        event,
        data: JSON.parse(JSON.stringify(data || {})) // serialize to avoid cloning errors
      }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#broadcastEvent', _e); });
    } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#broadcastEvent', e); }
  }

  // 2026-05-25: emit node phase event để UI hiện text trực quan
  // (vd: "Đang gửi prompt..." → "Đang gen ảnh/video..." → "Đang tải kết quả...")
  // Chỉ áp dụng generate/chatgpt/grok nodes (longest waits). Image/prompt/download skip.
  function emitNodePhase(nodeId, phase) {
    if (!nodeId || !phase) return;
    try {
      window.eventBus?.emit('node:phase', { nodeId, phase });
      broadcastEvent('node:phase', { nodeId, phase });
    } catch (e) { /* ignore */ }
  }

  // ===== Cross-context running flag (af_running_workflow) =====
  // Heartbeat-based liveness check (thay vì TTL từ started_at):
  //   - Executor đang chạy → pulse heartbeat mỗi 60s (update last_heartbeat_at)
  //   - Reader check: nếu không có heartbeat trong 5 phút → coi context đã chết
  //     (crash/SW hibernate) → auto-clear để un-stuck check tiếp theo.
  // Lý do dùng heartbeat thay TTL cố định: workflow có thể chạy >30 phút (10
  // nodes × 2 phút + retry, mixed providers sequential, v.v.). TTL cố định sẽ
  // clear nhầm flag của workflow đang chạy thật → 2 contexts cùng claim → song song.
  const HEARTBEAT_INTERVAL_MS = 60 * 1000;  // Pulse mỗi 60s
  const HEARTBEAT_TTL_MS = 5 * 60 * 1000;   // Coi stale nếu không heartbeat trong 5 phút

  // Read af_running_workflow, auto-clear nếu heartbeat stale. Returns null nếu free.
  async function readRunningFlag() {
    try {
      const data = await new Promise(resolve => {
        chrome.storage.local.get(['af_running_workflow'], r => resolve(r));
      });
      const flag = data.af_running_workflow;
      if (!flag?.wf_id) return null;
      // Backward compat: flag set bởi version cũ chưa có last_heartbeat_at →
      // fallback dùng started_at với cùng TTL (5 phút). Flag cũ chỉ tồn tại trong
      // session đang chạy upgrade → sẽ tự reset chu kỳ tiếp theo.
      const lastBeat = flag.last_heartbeat_at || flag.started_at;
      if (lastBeat && Date.now() - lastBeat > HEARTBEAT_TTL_MS) {
        try {
          await new Promise(resolve => chrome.storage.local.remove('af_running_workflow', resolve));
      } catch (e) { console.warn('[WorkflowExecutor] Khong xoa duoc co af_running_workflow qua han -> lan chay sau co the bi chan "workflow dang chay":', e?.message); }
        console.warn('[WorkflowExecutor] Auto-cleared stale af_running_workflow:', flag.wf_id,
          'last heartbeat age(ms):', Date.now() - lastBeat);
        return null;
      }
      return flag;
    } catch (e) {
      return null;
    }
  }

  // [Audit Bug 3 fix 2026-06-22] Atomic claim qua Web Locks API.
  // Trước fix: chrome.storage không có compare-and-set → 2 contexts (sidebar + popup)
  // cùng click Run trong cùng tick → cả 2 pass readRunningFlag() rồi cùng set → double run.
  // Sau fix: navigator.locks.request('af_running_workflow', {ifAvailable: true}) đảm bảo chỉ
  // 1 context grab lock thành công. Lock auto-release khi callback resolve (KHÔNG persist).
  // Fallback: nếu navigator.locks không available (rất hiếm, chỉ Service Worker context cũ) →
  // dùng pattern cũ (best-effort, có race window microseconds).
  async function claimRunningFlag(wfId, wfName, ctx) {
    const doClaim = async () => {
      const existing = await readRunningFlag();
      if (existing?.wf_id) {
        return { ok: false, runningWfName: existing.wf_name || 'Workflow', runningWfId: existing.wf_id };
      }
      const now = Date.now();
      await new Promise(resolve => {
        chrome.storage.local.set({
          af_running_workflow: {
            wf_id: wfId,
            wf_name: wfName || 'Workflow',
            started_at: now,
            last_heartbeat_at: now,
            executor_context: ctx
          }
        }, resolve);
      });
      return { ok: true };
    };

    // Web Locks API: atomic acquire-or-fail. `ifAvailable: true` → callback nhận null
    // nếu lock đã bị giữ bởi context khác (không block, không queue).
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      try {
        return await navigator.locks.request(
          'af_running_workflow_claim',
          { ifAvailable: true, mode: 'exclusive' },
          async (lock) => {
            if (!lock) {
              // Lock đã bị context khác giữ — đọc flag để trả tên workflow conflict.
              const existing = await readRunningFlag();
              return {
                ok: false,
                runningWfName: existing?.wf_name || 'Workflow',
                runningWfId: existing?.wf_id || null,
                reason: 'lock_held_by_other_context',
              };
            }
            return await doClaim();
          }
        );
      } catch (e) {
        console.warn('[WorkflowExecutor] Web Locks API failed, fallback to TOCTOU pattern:', e.message);
      }
    }
    // Fallback (legacy): TOCTOU pattern. Race window ~microseconds — chấp nhận.
    return await doClaim();
  }

  // Heartbeat pulse: update last_heartbeat_at để các reader biết context vẫn còn sống.
  // Nếu flag bị clear hoặc claim bởi context khác → bỏ qua (tránh stomp).
  async function pulseHeartbeat(wfId) {
    try {
      const data = await new Promise(resolve => {
        chrome.storage.local.get(['af_running_workflow'], r => resolve(r));
      });
      const flag = data.af_running_workflow;
      if (!flag || flag.wf_id !== wfId) return;
      await new Promise(resolve => {
        chrome.storage.local.set({
          af_running_workflow: { ...flag, last_heartbeat_at: Date.now() }
        }, resolve);
      });
      } catch (e) { console.warn('[WorkflowExecutor] pulseHeartbeat that bai -> co bi coi la qua han sau 5 phut:', e?.message); }
  }

  // Update wf_name sau khi load workflow (claim ban đầu chỉ có wfId)
  async function updateRunningFlagName(wfId, wfName) {
    try {
      const data = await new Promise(resolve => {
        chrome.storage.local.get(['af_running_workflow'], r => resolve(r));
      });
      const flag = data.af_running_workflow;
      if (flag?.wf_id !== wfId) return;
      await new Promise(resolve => {
        chrome.storage.local.set({
          af_running_workflow: { ...flag, wf_name: wfName || flag.wf_name }
        }, resolve);
      });
    } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#updateRunningFlagName', e); }
  }

  // Clear flag chỉ khi match wf_id (tránh stomping context khác đã claim sau)
  async function clearRunningFlag(wfId) {
    try {
      const data = await new Promise(resolve => {
        chrome.storage.local.get(['af_running_workflow'], r => resolve(r));
      });
      const flag = data.af_running_workflow;
      if (!flag) return;
      // Nếu wfId provided thì chỉ clear khi match. Nếu không provided → unconditional clear (legacy)
      if (wfId && flag.wf_id !== wfId) return;
      await new Promise(resolve => chrome.storage.local.remove('af_running_workflow', resolve));
      } catch (e) { console.warn('[WorkflowExecutor] KHONG XOA duoc co af_running_workflow -> lan chay sau se bi chan. Xoa tay key nay neu ket:', e?.message); }
  }

  // Update current_node_id trong af_running_workflow (fix: editor mở sau khi workflow chạy không biết node đang run)
  async function updateCurrentNode(wfId, nodeId) {
    try {
      const data = await new Promise(resolve => {
        chrome.storage.local.get(['af_running_workflow'], r => resolve(r));
      });
      const flag = data.af_running_workflow;
      if (!flag || flag.wf_id !== wfId) return;
      await new Promise(resolve => {
        chrome.storage.local.set({
          af_running_workflow: { ...flag, current_node_id: nodeId }
        }, resolve);
      });
    } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#updateCurrentNode', e); }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 2b: Server-side execution tracking
  // Mirrors local af_running_workflow to server for admin monitoring
  // ═══════════════════════════════════════════════════════════

  let _serverExecutionId = null;

  /**
   * Start server-side execution tracking.
   * Non-blocking - if server fails, local tracking continues.
   */
  async function startServerTracking(wfId, wfName, totalNodes, ctx) {
    try {
      // Offline: bỏ hẳn server-tracking (không có backend) — tránh 1 console.warn LOCAL_MODE mỗi lần
      // chạy workflow. Local execution không cần tracking server. (Thay dead-stub if(false?._apiCall).)
      if (self.SEOSONA_LOCAL_MODE !== false) return null;
      const resp = await ApiClient.request('POST', 'executions/start', {
        wf_id: wfId,
        wf_name: wfName,
        total_nodes: totalNodes,
        executor_context: ctx || 'sidebar',
      });
      if (resp?.success && resp?.data?.execution_id) {
        _serverExecutionId = resp.data.execution_id;
        console.log('[WorkflowExecutor] Server tracking started:', _serverExecutionId);

        // Phase 3.5 Bug C.5: persist execution_id vào af_running_workflow để background.js
        // có thể release token trong chrome.runtime.onSuspend.
        try {
          const data = await new Promise(r => chrome.storage.local.get(['af_running_workflow'], r));
          if (data.af_running_workflow?.wf_id === wfId) {
            await new Promise(r => chrome.storage.local.set({
              af_running_workflow: { ...data.af_running_workflow, execution_id: _serverExecutionId }
            }, r));
          }
        } catch (_) { /* best effort */ }

        return _serverExecutionId;
      }
    } catch (e) {
      console.warn('[WorkflowExecutor] Server tracking start failed:', e.message);
    }
    return null;
  }

  /**
   * Pulse heartbeat to server.
   * Called alongside local pulseHeartbeat.
   */
  async function heartbeatServer(currentNodeId, completedNodes, nodeStates = null) {
    if (!_serverExecutionId) return;
    try {
      const payload = {
        current_node_id: currentNodeId,
        completed_nodes: completedNodes,
      };
      // [P2.7 Kênh 2] node_states {nodeId: status} — chỉ đính khi caller báo có thay đổi.
      if (nodeStates && Object.keys(nodeStates).length > 0) payload.node_states = nodeStates;
      await ApiClient.request('PATCH', `executions/${_serverExecutionId}/heartbeat`, payload);
    } catch (e) {
      // Silent fail - heartbeat is best-effort
    }
  }

  /**
   * Complete server-side execution tracking.
   */
  async function completeServerTracking(status, summary, completedNodes) {
    if (!_serverExecutionId) return;
    try {
      await ApiClient.request('POST', `executions/${_serverExecutionId}/complete`, {
        status,
        summary,
        completed_nodes: completedNodes,
      });
      console.log('[WorkflowExecutor] Server tracking completed:', status);
    } catch (e) {
      console.warn('[WorkflowExecutor] Server tracking complete failed:', e.message);
    }
    _serverExecutionId = null;
  }

  // Helper: emit execution:log to local eventBus ONLY (không broadcast để tránh duplicate)
  // Broadcast sẽ gây re-emit từ workflow-editor-init.js → log hiển thị 2 lần
  function emitLog(data) {
    window.eventBus.emit('execution:log', data);
  }

  // Helper: emit execution:progress to local eventBus ONLY (không broadcast để tránh duplicate)
  // [Phase 1] Gắn wfId (workflow đang chạy — chỉ 1 tại 1 thời điểm do isRunning guard) để listener
  // My Spaces & Flows route đúng card, không phụ thuộc _lastUpdatedWfId mutable.
  function emitProgress(data) {
    try { if (data && data.wfId == null) data.wfId = window.workflowExecutor?.currentWorkflow?.wf_id || null; } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#emitProgress', _); }
    window.eventBus.emit('execution:progress', data);
  }

  // ========== NODE REFERENCE SYSTEM (Phase 2) ==========
  // @slug mention parsing and resolution for workflow prompts

  /**
   * Node types có thể được @mention (có slug)
   * = Nodes produce data (text hoặc image) mà nodes khác có thể reference
   */
  // Text Extract Node (2026-05-29) added — text_extract output text có thể @reference từ downstream.
  const MENTIONABLE_NODE_TYPES = ['image', 'text', 'text_extract', 'generate', 'chatgpt', 'grok', 'prompt'];

  /**
   * Node types có thể sử dụng @mention trong prompt field
   * = Nodes có prompt textarea và support prompt_mode/ref_mode
   */
  const NODES_CAN_USE_MENTIONS = ['generate', 'chatgpt', 'grok', 'prompt'];

  /**
   * Parse @mentions từ prompt text
   * Regex: @[a-z][a-z0-9_]{0,29} với negative lookahead để ignore email patterns
   *
   * @param {string} prompt - Prompt text với @mentions
   * @returns {string[]} Array of unique mentioned slugs
   */
  function parseMentions(prompt) {
    if (!prompt || typeof prompt !== 'string') return [];

    // Regex với negative lookahead để ignore email/handle patterns:
    // - (?<!\\) - không match nếu preceded by backslash (escape)
    // - @([a-z][a-z0-9_]{0,29}) - match @slug format
    // - (?![a-z0-9@._-]) - không match nếu followed by email chars
    const mentionRegex = /@([a-z][a-z0-9_]{0,29})(?![a-z0-9@._-])/g;

    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(prompt)) !== null) {
      mentions.push(match[1]);
    }

    return [...new Set(mentions)]; // Unique
  }

  /**
   * Build nodesBySlug map từ workflow nodes
   * @param {Array} nodes - All nodes in workflow
   * @returns {Map<string, Object>} Map slug → node
   */
  // Tên folder download từ workflow name: transliterate tiếng Việt → ASCII (đ→d, bỏ dấu) TRƯỚC khi
  // thay ký tự không hợp lệ → '_'. Trước fix fallback ăn luôn ký tự có dấu: "Mỹ phẩm" → "M__Ph_m".
  // (Đồng bộ DownloadHelper._toAscii / GenTab.toAscii — dùng cho fallback khi GenTab không load ở
  // context editor window.)
  function _wfFolderName(name) {
    return (String(name || 'workflow')
      .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 30)) || 'workflow';
  }

  function buildNodesBySlug(nodes) {
    const map = new Map();
    for (const node of nodes || []) {
      if (node.slug) {
        map.set(node.slug, node);
      }
    }
    return map;
  }

  /**
   * Resolve prompt với @mentions thành final text
   *
   * Khi prompt_mode = 'mention':
   * - @text_slug → replace bằng text node content
   * - @prompt_slug → replace bằng prompt node result_text
   * - @image_slug → giữ nguyên (sẽ xử lý bởi ref_mode)
   *
   * @param {Object} node - Node đang execute (có prompt field)
   * @param {Map<string, Object>} nodesBySlug - Map slug → node
   * @returns {string} Resolved prompt
   */
  function resolvePromptMentions(node, nodesBySlug) {
    let prompt = node.prompt || '';
    const promptMode = node.prompt_mode || 'all';
    const refMode = node.ref_mode || 'all';

    // doSubstitute: thay @text/@prompt bằng nội dung node → CHỈ khi prompt_mode='mention'.
    // doStripRef: xóa @image/@gen/@chatgpt/@grok (ref selector) khỏi prompt text → khi
    //   prompt_mode='mention' HOẶC ref_mode='mention'. Gap B fix 2026-05-27: tránh leak literal
    //   "@image_2" khi prompt_mode='all' + ref_mode='mention' (mode chỉ điều khiển substitute
    //   @text/@prompt, không nên để @image lọt vào prompt gửi provider — ref selector không phải text).
    const doSubstitute = promptMode === 'mention';
    const doStripRef = promptMode === 'mention' || refMode === 'mention';

    // 'all' + 'all': giữ nguyên prompt (legacy behavior).
    if (!doSubstitute && !doStripRef) return prompt;

    const mentions = parseMentions(prompt);

    for (const slug of mentions) {
      const sourceNode = nodesBySlug.get(slug);
      if (!sourceNode) continue;

      const re = new RegExp(`@${slug}(?![a-z0-9_])`, 'g');

      if (sourceNode.node_type === 'text') {
        if (!doSubstitute) continue; // prompt_mode='all': giữ @text literal
        // Gap C fix: BỎ guard `if(rep)` — rep='' strip @text_X thay vì leak literal khi text rỗng.
        prompt = prompt.replace(re, (sourceNode.prompt || '').trim());
      } else if (sourceNode.node_type === 'prompt') {
        if (!doSubstitute) continue;
        // Bug fix 2026-05-27 (A): fallback `prompt` gốc khi result_text rỗng (single-node run →
        // prompt node upstream CHƯA execute). Gap C: BỎ guard `if(rep)` — rep='' strip thay vì leak.
        prompt = prompt.replace(re, (sourceNode.result_text || sourceNode.prompt || '').trim());
      } else if (sourceNode.node_type === 'text_extract') {
        // 2026-05-31: text_extract output text qua result_text (no .prompt fallback —
        // text_extract không có prompt field, chỉ extract config). Substitute @slug bằng
        // extracted text giống pattern @prompt_slug.
        if (!doSubstitute) continue;
        prompt = prompt.replace(re, (sourceNode.result_text || '').trim());
      } else if (doStripRef) {
        // Image-producing nodes (image, generate, chatgpt, grok): @slug = REF → strip khỏi prompt
        // text (ảnh xử lý bởi ref_mode), tránh gửi literal "@image_2" tới LLM.
        prompt = prompt.replace(re, '');
      }
    }

    // Dọn khoảng trắng dư sau khi strip/substitute.
    prompt = prompt.replace(/[ \t]{2,}/g, ' ').trim();

    return prompt;
  }

  /**
   * Resolve ref images với @mentions
   *
   * Khi ref_mode = 'mention':
   * - Chỉ trả về images từ nodes được @mention trong prompt
   * - Loại bỏ text nodes (text, prompt) vì không có image output
   *
   * @param {Object} node - Node đang execute
   * @param {Map<string, Object>} nodesBySlug - Map slug → node
   * @returns {Array<{fileId: string, thumbnail?: string, fileName?: string}>} Array of ref image data
   */
  function resolveMentionedRefImages(node, nodesBySlug) {
    const mode = node.ref_mode || 'all';
    const prompt = node.prompt || '';

    // ref_mode='all': không filter, sử dụng existing flow (collect từ edges)
    if (mode !== 'mention') {
      return null; // Null = use default behavior
    }

    // ref_mode='mention': chỉ lấy images từ nodes được @mention
    const mentions = parseMentions(prompt);
    const refImages = [];

    console.log(`[resolveMentionedRefImages] mentions=${mentions.join(',') || '(none)'} nodesBySlug.size=${nodesBySlug.size}`);

    for (const slug of mentions) {
      const sourceNode = nodesBySlug.get(slug);
      if (!sourceNode) {
        console.log(`[resolveMentionedRefImages] slug="${slug}" → NOT FOUND in nodesBySlug`);
        continue;
      }

      console.log(`[resolveMentionedRefImages] slug="${slug}" → node_type=${sourceNode.node_type} ref_file_ids="${sourceNode.ref_file_ids || ''}" result_file_ids="${sourceNode.result_file_ids || ''}"`);

      // Chỉ lấy từ image-producing nodes
      const imageNodeTypes = ['image', 'generate', 'chatgpt', 'grok'];
      if (!imageNodeTypes.includes(sourceNode.node_type)) {
        console.log(`[resolveMentionedRefImages] slug="${slug}" skipped (node_type=${sourceNode.node_type} not in imageNodeTypes)`);
        continue;
      }

      // Image source node: dùng ref_file_ids (uploaded image), lọc upload_xxx keys
      // Generate/ChatGPT/Grok node: dùng result_file_ids (generated output)
      let fileIds = [];
      let rawThumbs = {};
      let fileNames = {};

      if (sourceNode.node_type === 'image') {
        fileIds = (sourceNode.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean).filter(id => !id.startsWith('upload_'));
        rawThumbs = sourceNode.ref_thumbnails || {};
        fileNames = sourceNode.ref_file_names || {};
        // Web image node (server media /app/spaces): ref_file_ids RỖNG nhưng ref_thumbnails có key
        // `template_ref_*` → dùng keys làm fileIds (parity _getNodeOutputForPort:3614). Gated prefix
        // → extension (image node luôn có ref_file_ids) KHÔNG bị ảnh hưởng.
        if (!fileIds.length && rawThumbs && typeof rawThumbs === 'object' && !Array.isArray(rawThumbs)) {
          const webKeys = Object.keys(rawThumbs).filter(k => k.startsWith('template_ref_'));
          if (webKeys.length) fileIds = webKeys;
        }
      } else {
        fileIds = (sourceNode.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
        rawThumbs = sourceNode.result_thumbnails || {};
        fileNames = sourceNode.result_file_names || {};
      }

      // Per-fid thumbnail resolve ROBUST (Bug 2026-05-27: ref_thumbnails keys desync với
      // ref_file_ids — vd ref_file_ids="fe_id_7d0a" nhưng ref_thumbnails keyed "fe_id_050c" sau
      // stale-id correction/reupload → thumbnails[fid]=undefined → mention ref thumbnail=null →
      // grok/chatgpt submit skip "không có ảnh mention"). Thử: direct key → _tileCache →
      // GenTab.thumbnailCache → MediaRegistry → positional (key desync nhưng count khớp).
      const thumbVals = Object.values(rawThumbs)
        .map(v => (typeof v === 'string' ? v : v?.thumbnail))
        .filter(Boolean);
      const resolveThumb = (fid, idx) => {
        let t = rawThumbs[fid];
        t = (typeof t === 'string') ? t : t?.thumbnail;
        if (!t) t = getThumbCache()?.get(fid)?.thumbnail;
        if (!t && window.GenTab?.thumbnailCache?.[fid]) t = window.GenTab.thumbnailCache[fid];
        if (!t && typeof MediaRegistry !== 'undefined' && MediaRegistry.getThumb) t = MediaRegistry.getThumb(fid);
        if (!t && thumbVals.length === fileIds.length) t = thumbVals[idx]; // positional desync fallback
        return t || null;
      };

      fileIds.forEach((fid, idx) => {
        const thumb = resolveThumb(fid, idx);
        if (!thumb) console.warn(`[resolveMentionedRefImages] slug="${slug}" fid=${fid.substring(0, 14)} → KHÔNG resolve được thumbnail (raw keys=${Object.keys(rawThumbs).join(',') || 'none'})`);
        refImages.push({
          fileId: fid,
          thumbnail: thumb,
          fileName: fileNames[fid] || null,
          sourceSlug: slug,
          sourceNodeType: sourceNode.node_type
        });
      });
    }

    console.log(`[resolveMentionedRefImages] RESULT: ${refImages.length} ref images`);
    if (refImages.length > 0) {
      console.log(`[resolveMentionedRefImages] First ref: fileId=${refImages[0].fileId}, thumbnail=${refImages[0].thumbnail ? 'YES' : 'NULL'}, fileName=${refImages[0].fileName || 'null'}`);
    }
    return refImages;
  }

  /**
   * Validate mentions trong prompt trước execution
   *
   * @param {Object} node - Node sắp execute
   * @param {Map<string, Object>} nodesBySlug - Map slug → node
   * @returns {{warnings: Array, errors: Array}} Validation results
   */
  function validateMentions(node, nodesBySlug) {
    const warnings = [];
    const errors = [];
    const prompt = node.prompt || '';
    const mentions = parseMentions(prompt);

    if (mentions.length === 0) {
      // ref_mode=mention nhưng không có @image nào
      if (node.ref_mode === 'mention') {
        warnings.push({
          type: 'no_image_mention',
          message: 'ref_mode=mention nhưng không có @image trong prompt. Sẽ không có reference images.'
        });
      }
      return { warnings, errors };
    }

    const imageNodeTypes = ['image', 'generate', 'chatgpt', 'grok'];
    let hasImageMention = false;

    for (const slug of mentions) {
      const sourceNode = nodesBySlug.get(slug);

      if (!sourceNode) {
        errors.push({
          type: 'slug_not_found',
          slug,
          message: `@${slug} không tồn tại trong workflow.`
        });
        continue;
      }

      // Check image mention
      if (imageNodeTypes.includes(sourceNode.node_type)) {
        hasImageMention = true;

        // Check pending result
        const hasResult = sourceNode.node_type === 'image'
          ? (sourceNode.ref_file_ids || '').trim().length > 0
          : (sourceNode.result_file_ids || '').trim().length > 0;

        if (!hasResult && sourceNode.status !== 'completed') {
          // Warning only - execution order should handle this
          warnings.push({
            type: 'pending_result',
            slug,
            message: `@${slug} chưa có output. Sẽ chờ node này execute trước.`
          });
        }
      }
    }

    // Warning: ref_mode=mention nhưng không có image @
    if (node.ref_mode === 'mention' && !hasImageMention) {
      warnings.push({
        type: 'no_image_mention',
        message: 'ref_mode=mention nhưng không có @image trong prompt. Sẽ không có reference images.'
      });
    }

    return { warnings, errors };
  }

  class WorkflowExecutor {
    constructor() {
      this.isRunning = false;
      this.shouldStop = false;
      this.currentWorkflow = null;
      this.currentNode = null;
      this._heartbeatTimer = null; // Heartbeat interval handle (Gap 2 fix)
      this.settings = {
        delayBetweenNodes: 3000,
        retryOnFail: true,
        maxRetries: 2,
        retryDelay: 5000,
        // Phase L: Use centralized timeout from SystemConfig with hardcoded fallback
        // Phase 3 fix: Use safeGetTimeout to avoid ConfigRequiredError during init
        tileTimeout: window.SystemConfig?.safeGetTimeout?.('tile_completion_timeout_ms') || 30000,
        timeout: window.SystemConfig?.safeGetTimeout?.('api_timeout_ms') || 60000,
        stopOnError: false
      };

      // Editor mutex: serialize TOÀN BỘ chuỗi editor operations giữa parallel nodes
      // Flow chỉ có 1 editor → phải serialize: settings → clear → add ref → insert text → submit → wait tile
      // Nếu không: node_02 clear editor XÓA text/ref của node_01 đang chờ submit
      this._submitMutexQueue = Promise.resolve();

      // [FLOW_RECAPTCHA_403 Phase 3] reCAPTCHA khi chạy workflow → HALT (shouldStop) thay vì tiếp node
      // kế (cũng sẽ 403 = spam). Node OK trước đó giữ; user giải + rerun-resume node lỗi.
      // LƯU Ý: KHÔNG bind ở constructor — module-scope `new WorkflowExecutor()` chạy TRƯỚC khi
      // window.eventBus được tạo (init/DOMContentLoaded) → listener sẽ bị skip. Bind LAZY ở execute().
      this._flowCaptchaBound = false;

      // [API SPAM FIX — Phase 5] Local-first execution buffer
      // Thay vì PATCH node status từng node (N calls), buffer in-memory và flush 1 lần cuối
      this._nodeStateBuffer = new Map(); // nodeId → latest state {status, result_file_ids, ...}
      this._executionInProgress = false;
      // [P2.7 Kênh 2] Live node states cho heartbeat enrich (KHÔNG thêm API call — nhồi vào
      // PATCH executions/{id}/heartbeat sẵn có). Map nodeId → status string. Dirty flag =
      // on-change throttle: heartbeat chỉ gửi node_states khi có thay đổi từ lần gửi trước.
      this._nodeStatesLive = {};
      this._nodeStatesDirty = false;
      // [API SPAM FIX — Phase 5.10] Crash recovery checkpoint
      this._bufferCheckpointTimer = null;

      // Phase 1 Migration: Server execution plan
      // Topological sort + mixed provider detection moved to server
      this._serverPlan = null;
      // [Audit Bug 1 fix 2026-06-22] _serverExecutionToken removed — backend không cấp token
      // qua /workflows/{id}/execute nữa (avoid double-deduct). Token duy nhất từ ExecutionGate.request.
    }

    /** Map node_type → tên provider hiển thị (cho thông báo lỗi gen). */
    _providerDisplayName(node) {
      const m = { generate: 'Google Flow', chatgpt: 'ChatGPT', grok: 'Grok', gemini: 'Gemini' };
      return m[node?.node_type] || 'Provider';
    }

    /**
     * 2026-05-28: Báo cho user khi ref image bị bỏ vì KHÔNG upload được lên Flow (vd file video).
     * Non-blocking toast (không cản trở workflow đang chạy), context-aware (sidebar/editor), i18n.
     */
    _notifyRefUploadDropped(node, droppedCount, keptCount) {
      const nodeName = node?.node_name || 'Node';
      const msg = window.I18n?.t('workflow.refUploadDropped', { count: droppedCount, kept: keptCount, node: nodeName })
        || `"${nodeName}": ${droppedCount} ảnh tham chiếu không upload được lên Flow (vd file video) nên đã bị bỏ qua. Tạo tiếp với ${keptCount} ảnh hợp lệ.`;
      this._showWorkflowToast(msg, 'warning');
    }

    /**
     * 2026-05-28: Gen node fail HẲN sau hết retry → báo user RÕ là lỗi từ PROVIDER (không phải
     * extension) + hướng dẫn kiểm tra tab provider. Non-blocking + context-aware + i18n. Dedup/run.
     */
    /**
     * Phân loại lỗi khi chạy node: USER-ACTIONABLE (user cần xử lý — mở Flow, login, nạp input,
     * chọn model…) vs bug extension thật. User-actionable → chỉ báo toast thân thiện + hướng dẫn,
     * KHÔNG đổ raw error đỏ vào trang "Lỗi" (panel đó chỉ để bug extension). Trả { user, hint }.
     */
    _classifyRunError(error) {
      const s = String(error?.message || error?.name || error || '').toLowerCase();
      if (!s) return { user: false };
      if (/submit button not found|disabled after|arrow_forward|nút.*không tìm/.test(s))
        return { user: true, hint: 'Không thấy nút Tạo trên trang Flow — mở tab Flow & đăng nhập rồi chạy lại.' };
      if (/không có file kết quả|no result|chưa hoàn thành|thiếu.*input|no input file|nguồn.*chưa/.test(s))
        return { user: true, hint: 'Node nguồn chưa có ảnh — nạp ảnh vào node input rồi chạy lại.' };
      if (/timeout|quá thời gian|after \d+s|hết thời gian/.test(s))
        return { user: true, hint: 'Trang Flow phản hồi chậm/timeout — kiểm tra tab Flow & kết nối mạng.' };
      if (/login|đăng nhập|logged out|unauthor|401|403/.test(s))
        return { user: true, hint: 'Chưa đăng nhập provider — mở tab provider & đăng nhập rồi chạy lại.' };
      if (/config_required|model.*(missing|not found)|no model|data_missing/.test(s))
        return { user: true, hint: 'Chưa cấu hình model — kiểm tra Settings hoặc chọn model khác cho node.' };
      if (/message channel closed|listener indicated an async|receiving end does not exist/.test(s))
        return { user: true, hint: 'Kết nối với tab Flow bị gián đoạn — mở lại tab Flow rồi thử lại (tránh reload extension khi đang chạy).' };
      return { user: false };
    }

    _notifyGenFailed(node, attempts, error) {
      try {
        if (node._genFailNotified) return; // dedup trong 1 lần run
        node._genFailNotified = true;
        const provider = this._providerDisplayName(node);
        const n = attempts || ((this.settings?.retryOnFail ? (this.settings?.maxRetries || 0) : 0) + 1);
        // Thêm hint cụ thể (submit-not-found → mở Flow/login; timeout → chậm…) để user biết làm gì.
        const cls = this._classifyRunError(error);
        const base = window.I18n?.t('workflow.genFailedAfterRetries', { count: n, provider, node: node?.node_name || '' })
          || `${provider} thất bại sau ${n} lần thử.`;
        const msg = cls.hint ? `${base}\n${cls.hint}` : `${base} Mở tab ${provider} để xem chi tiết.`;
        // 'warning' (amber) — đây là vấn đề khi tạo, không phải extension crash → đỡ đáng sợ hơn 'error'.
        this._showWorkflowToast(msg, 'warning', 9000);
      } catch (_) { /* notify best-effort */ }
    }

    /**
     * Toast NON-BLOCKING dùng chung cho workflow notifications. Sidebar có window.showNotification
     * (toast sẵn) → dùng. Workflow-editor KHÔNG có toast system → tự render toast góc phải (fixed,
     * auto-dismiss, click để đóng) — KHÔNG dùng modal/alert (blocking) để không cản trở workflow.
     */
    _showWorkflowToast(message, type = 'error', duration = 8000) {
      try {
        if (typeof window.showNotification === 'function') {
          window.showNotification(message, type, duration);
          return;
        }
        // Editor: self-contained toast.
        if (!document.getElementById('seosonaflow-wf-toast-styles')) {
          const st = document.createElement('style');
          st.id = 'seosonaflow-wf-toast-styles';
          st.textContent = `
            #seosonaflow-wf-toast-container{position:fixed;top:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;max-width:380px;pointer-events:none}
            .seosonaflow-wf-toast{pointer-events:auto;cursor:pointer;padding:12px 14px;border-radius:10px;font-size:13px;line-height:1.45;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.35);opacity:0;transform:translateX(20px);transition:opacity .25s,transform .25s;white-space:pre-wrap;word-break:break-word}
            .seosonaflow-wf-toast.show{opacity:1;transform:translateX(0)}
            .seosonaflow-wf-toast-error{background:#3a1418;border:1px solid #ef4444}
            .seosonaflow-wf-toast-warning{background:#3a2e10;border:1px solid #f59e0b}
            .seosonaflow-wf-toast-success{background:#10291a;border:1px solid #19d07b}`;
          document.head.appendChild(st);
        }
        let container = document.getElementById('seosonaflow-wf-toast-container');
        if (!container) {
          container = document.createElement('div');
          container.id = 'seosonaflow-wf-toast-container';
          document.body.appendChild(container);
        }
        const el = document.createElement('div');
        el.className = 'seosonaflow-wf-toast seosonaflow-wf-toast-' + type;
        el.textContent = message;
        const dismiss = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
        el.addEventListener('click', dismiss);
        container.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(dismiss, duration);
      } catch (_) { /* toast best-effort */ }
    }

    /**
     * Preflight provider tab — poll status cho đến khi ready (giống GenTab reconfirm modal).
     * Pattern: activate tab → poll status mỗi 500ms → return khi ready hoặc timeout.
     * @param {string} providerKey - 'chatgpt' | 'grok'
     * @param {Function} emitLog - logging function
     * @param {number} maxWaitMs - max wait time (default 8000ms)
     * @returns {Promise<{ready: boolean, tabId: number|null, error: string|null}>}
     */
    async _preflightProviderTab(providerKey, emitLog, maxWaitMs = 8000) {
      const Session = providerKey === 'chatgpt' ? window.ChatGPTSession
                    : providerKey === 'grok' ? window.GrokSession : null;
      const adapter = window.ProviderRegistry?.get(providerKey);

      if (!Session || !adapter) {
        return { ready: false, tabId: null, error: 'SESSION_NOT_FOUND' };
      }

      // Step 1: Fire activate (createIfMissing: true) + navigate về homepage
      // GenTab pattern: ensureReady → ensureTabActive (navigateToHome) → poll status
      emitLog(`[Preflight] ${providerKey}: Activating tab + navigate homepage...`);
      let tabId = null;
      try {
        const initial = await adapter.ensureReady({ createIfMissing: true, activate: true });
        tabId = initial?.tabId || null;
        // Navigate về homepage ngay (fix image mode bug) — giống GenTab _ensureProviderTab
        // forceRefresh: true để luôn refresh ngay cả khi đã ở homepage (fix stale React state từ gen trước)
        if (Session.ensureTabActive) {
          // focusWindow:false — workflow-editor run KHÔNG cướp focus sang tab provider (grok dùng;
          // chatgpt đã false sẵn; gemini ignore arg giữ nguyên). Chỉ Cloudflare mới focus + trả về.
          await Session.ensureTabActive({ forceRefresh: true, focusWindow: false });
          // Invalidate cache sau homepage navigation — content script cần re-inject (Bug 45)
          // Nếu không invalidate, ensureReady sẽ cache hit → không verify content script thực sự
          Session._ready = false;
          Session._lastCheck = 0;
          emitLog(`[Preflight] ${providerKey}: Homepage navigation triggered (forceRefresh), cache invalidated`);
        }
      } catch (e) {
        emitLog(`[Preflight] ${providerKey}: ensureReady failed: ${e.message}`, 'warn');
      }

      // Step 2: Poll status until ready (giống GenTab modal poll mỗi 3s, ở đây poll nhanh hơn 500ms)
      const start = Date.now();
      let lastStatus = null;

      while ((Date.now() - start) < maxWaitMs) {
        try {
          let isReady = false;
          let statusInfo = {};

          if (providerKey === 'grok' && Session.checkStatus) {
            const status = await Session.checkStatus();
            statusInfo = status;
            isReady = status.loggedIn && !status.cloudflareChallenge;
            if (status.cloudflareChallenge) {
              emitLog(`[Preflight] ${providerKey}: Cloudflare challenge detected, waiting...`, 'warn');
            }
          } else if (Session.ensureReady) {
            const result = await Session.ensureReady({ createIfMissing: false, activate: false });
            statusInfo = result || {};
            isReady = result?.ready === true;
            tabId = result?.tabId || tabId;
          }

          if (isReady) {
            emitLog(`[Preflight] ${providerKey}: Ready after ${Date.now() - start}ms`);
            return { ready: true, tabId, error: null };
          }

          // Log status change
          const statusKey = JSON.stringify(statusInfo);
          if (statusKey !== lastStatus) {
            lastStatus = statusKey;
            emitLog(`[Preflight] ${providerKey}: Waiting... (loggedIn=${statusInfo.loggedIn}, ready=${statusInfo.ready})`);
          }
        } catch (e) {
          emitLog(`[Preflight] ${providerKey}: Poll error: ${e.message}`, 'warn');
        }

        await new Promise(r => setTimeout(r, 500));
      }

      // Timeout - return với warning
      emitLog(`[Preflight] ${providerKey}: Timeout after ${maxWaitMs}ms, proceeding anyway...`, 'warn');
      return { ready: false, tabId, error: 'PREFLIGHT_TIMEOUT' };
    }

    /**
     * Phase 3.5 Bug J: Refresh `this.settings` từ ExecutionConfig (system_settings server-side).
     *
     * Constructor init hardcoded defaults vì ExecutionConfig cache chưa load lúc instance tạo.
     * Method này gọi ở đầu mỗi execute() — lúc này user đã mở UI → cache thường đã ready.
     * Nếu cache empty (edge case: cold execute trước khi pre-fetch xong) → hardcoded defaults stay.
     *
     * Priority order: workflow.settings_json > system_settings (ExecutionConfig) > hardcoded defaults
     *
     * Mapping system_settings (snake_case) → this.settings (camelCase):
     *   exec_delay_nodes_sec → delayBetweenNodes (ms)
     *   exec_max_retries     → maxRetries
     *   exec_timeout_sec     → tileTimeout (ms)
     *   exec_on_error        → stopOnError (bool)
     *   (no equivalent)      → retryDelay stays hardcoded 5000ms
     */
    _refreshSettingsFromExecutionConfig() {
      const wfCfg = window.ExecutionConfig?.safeGetWorkflowConfig?.() || {};
      if (typeof wfCfg.delay_nodes_sec === 'number') {
        this.settings.delayBetweenNodes = wfCfg.delay_nodes_sec * 1000;
      }
      if (typeof wfCfg.max_retries === 'number') {
        this.settings.maxRetries = wfCfg.max_retries;
      }
      if (typeof wfCfg.timeout_sec === 'number') {
        this.settings.tileTimeout = wfCfg.timeout_sec * 1000;
      }
      if (wfCfg.on_error === 'stop' || wfCfg.on_error === 'continue') {
        this.settings.stopOnError = wfCfg.on_error === 'stop';
      }
      console.log('[WorkflowExecutor] Refreshed settings from ExecutionConfig:', {
        delayBetweenNodes: this.settings.delayBetweenNodes,
        maxRetries: this.settings.maxRetries,
        tileTimeout: this.settings.tileTimeout,
        stopOnError: this.settings.stopOnError,
        source: Object.keys(wfCfg).length > 0 ? 'system_settings' : 'hardcoded_defaults',
      });
    }

    /**
     * Phase 1 Migration: Fetch execution plan from server.
     * Server performs Kahn's algorithm (topological sort) - algorithm hidden server-side.
     * Returns plan with steps[], is_mixed_providers, prompt_count.
     *
     * [Audit Bug 1 fix 2026-06-22] Endpoint KHÔNG cấp token nữa — token chỉ cấp 1 lần qua
     * ExecutionGate.request('workflow_run') ở execute() để tránh double-deduct quota.
     *
     * Phase 3.5 Bug C.4: gửi settings_override để server áp dụng user preferences
     *                    (parallel_execution, stop_on_error, max_retries).
     *
     * @param {string} wfId - Workflow ID
     * @param {object} settingsOverride - User preferences from workflow.settings_json
     * @returns {Promise<{success: boolean, plan?: object, prompt_count?: number, error?: string}>}
     */
    async _fetchServerPlan(wfId, settingsOverride = {}, workflow = null) {
      // ── LOCAL/OFFLINE MODE ─────────────────────────────────────────────────
      // Fork chạy 100% offline: endpoint POST /workflows/{id}/execute không tồn tại
      // (ApiClient.request throw LOCAL_MODE). Server trước đây chạy Kahn topo-sort để
      // trả execution plan; ở đây ta dựng LẠI plan y hệt shape ngay trên client từ
      // nodes+edges của workflow. Không có bước này, workflow đa-node bị chặn cứng offline.
      if (self.SEOSONA_LOCAL_MODE !== false) {
        return this._buildLocalPlan(wfId, settingsOverride, workflow);
      }
      try {
        if (false?._apiCall) {
          console.warn('[WorkflowExecutor] authManager not available');
          return { success: false, error: 'AUTH_NOT_READY' };
        }

        // NOTE: _apiCall đã unwrap response 2 lần (background apiRequest handler + _apiCall
        // line 655 `resolve(response.data)`), nên `response` đã là object {plan, prompt_count}
        // trực tiếp, KHÔNG có .success/.data wrapper. Cùng bug pattern với ExecutionConfig._fetchFromServer.
        const response = await ApiClient.request('POST', `workflows/${wfId}/execute`, {
          settings_override: settingsOverride,
        });

        if (!response?.plan) {
          console.warn('[WorkflowExecutor] Server plan fetch failed — invalid response shape:', response);
          return { success: false, error: 'PLAN_FETCH_FAILED' };
        }

        // Phase 3.5 Bug C.2: server detected cycle → block execution
        if (response.plan.cycle_detected) {
          console.error('[WorkflowExecutor] Server detected cycle, unreachable nodes:',
            response.plan.unreachable_node_ids);
          return {
            success: false,
            error: 'CYCLE_DETECTED',
            unreachable: response.plan.unreachable_node_ids,
          };
        }

        console.log('[WorkflowExecutor] Server plan received:', {
          execution_id: response.plan.execution_id,
          total_steps: response.plan.total_steps,
          is_mixed_providers: response.plan.is_mixed_providers,
          level_count: response.plan.level_count,
          applied_settings: response.plan.applied_settings,
        });

        // [Audit Bug 1 fix 2026-06-22] Endpoint /workflows/{id}/execute không còn cấp token
        // (đã xoá để tránh double-deduct với ExecutionGate.request('workflow_run')).
        // Giữ field token=null + quota=undefined để backward-compat caller, không gây regression.
        return {
          success: true,
          plan: response.plan,
          prompt_count: response.prompt_count ?? null,
        };
      } catch (e) {
        // Surface full error context: HTTP status, Laravel exception class, validation details
        const ctx = {
          message: e.message,
          httpStatus: e.httpStatus,
          code: e.code,
          exception: e.exception,
          details: e.details,
        };
        console.warn('[WorkflowExecutor] Server plan fetch error:', ctx);
        return {
          success: false,
          error: e.message,
          httpStatus: e.httpStatus,
          exception: e.exception,
        };
      }
    }

    /**
     * LOCAL execution-plan builder (offline fork).
     * Kahn topological sort trên nodes+edges của workflow → flat steps[] với
     * { node_id, level_index, parallel_allowed } — ĐÚNG shape mà
     * _convertServerPlanToLevels (đọc steps[].level_index) và _acquireLockForNodeType
     * (đọc _serverStep.parallel_allowed) tiêu thụ. Thay cho lời gọi server đã bị xoá.
     *
     * parallel_allowed per-level: chỉ true khi user bật parallel_execution VÀ level
     * chỉ chứa node cùng-provider Flow (không ChatGPT/Grok/AI-prompt). Thiếu/false =
     * _acquireLockForNodeType giữ lock → tuần tự an toàn (mirror hành vi server).
     *
     * @returns {{success:boolean, plan?:object, prompt_count?:number, error?:string, unreachable?:string[]}}
     */
    _buildLocalPlan(wfId, settingsOverride = {}, workflow = null) {
      try {
        const allNodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
        const allEdges = Array.isArray(workflow?.edges) ? workflow.edges : [];
        // Chỉ node enabled tham gia (mirror enabledLocalNodes ở validate plan completeness).
        const nodes = allNodes.filter(n => n && n.enabled !== false);
        if (!nodes.length) return { success: false, error: 'EMPTY_WORKFLOW' };

        const idset = new Set(nodes.map(n => n.node_id));
        const nodeById = new Map(nodes.map(n => [n.node_id, n]));
        const indeg = new Map(), adj = new Map();
        nodes.forEach(n => { indeg.set(n.node_id, 0); adj.set(n.node_id, []); });
        for (const e of allEdges) {
          const s = e && e.source_node_id, t = e && e.target_node_id;
          // Bỏ self-loop + edge trỏ tới node disabled/không tồn tại.
          if (idset.has(s) && idset.has(t) && s !== t) {
            adj.get(s).push(t);
            indeg.set(t, indeg.get(t) + 1);
          }
        }

        // node → provider surface (mirror _acquireLockForNodeType). null = không cần tab-lock.
        const providerOf = (n) => {
          const ty = n.node_type || n.type;
          if (['generate', 'download', 'image', 'telegram', 'delay'].includes(ty)) return 'flow';
          if (ty === 'chatgpt') return 'chatgpt';
          if (ty === 'grok') return 'grok';
          if (ty === 'prompt' && n.use_ai === true) return n.provider || 'chatgpt';
          return null; // note / text / text_extract
        };

        const userParallel = settingsOverride.parallel_execution === true;
        const steps = [];
        const done = new Set();
        let frontier = nodes.filter(n => indeg.get(n.node_id) === 0).map(n => n.node_id);
        let level = 0;
        // Guard vòng lặp vô hạn: tối đa (số node) level.
        while (frontier.length && level <= nodes.length) {
          const levelProviders = new Set(frontier.map(id => providerOf(nodeById.get(id))).filter(Boolean));
          // Level chạy song song CHỈ khi: user bật parallel, >1 node, và toàn Flow (không external).
          const levelParallel = userParallel
            && frontier.length > 1
            && levelProviders.size <= 1
            && !levelProviders.has('chatgpt')
            && !levelProviders.has('grok');
          for (const id of frontier) {
            steps.push({ node_id: id, level_index: level, parallel_allowed: levelParallel });
            done.add(id);
          }
          const next = [];
          for (const id of frontier) {
            for (const t of adj.get(id)) {
              indeg.set(t, indeg.get(t) - 1);
              if (indeg.get(t) === 0) next.push(t);
            }
          }
          frontier = next;
          level++;
        }

        // Cycle detection: node không bao giờ đạt indeg 0 → nằm trong vòng lặp.
        if (done.size !== nodes.length) {
          const unreachable = nodes.filter(n => !done.has(n.node_id)).map(n => n.node_id);
          console.error('[WorkflowExecutor] LOCAL plan: cycle detected, unreachable nodes:', unreachable);
          return { success: false, error: 'CYCLE_DETECTED', unreachable };
        }

        const allProviders = new Set(nodes.map(providerOf).filter(Boolean));
        const plan = {
          execution_id: 'local_' + wfId + '_' + nodes.length + 'n' + level + 'L',
          total_steps: nodes.length,
          level_count: level,
          is_mixed_providers: allProviders.size > 1,
          applied_settings: settingsOverride,
          cycle_detected: false,
          unreachable_node_ids: [],
          steps,
        };
        console.log('[WorkflowExecutor] LOCAL execution plan built:', {
          total_steps: plan.total_steps,
          level_count: plan.level_count,
          is_mixed_providers: plan.is_mixed_providers,
        });
        return { success: true, plan, prompt_count: null };
      } catch (e) {
        console.error('[WorkflowExecutor] LOCAL plan build error:', e);
        return { success: false, error: e.message || 'LOCAL_PLAN_FAILED', exception: String(e) };
      }
    }

    /**
     * Phase 1 Migration: Convert server plan steps to execution levels.
     * Server returns flat steps[] with level_index, convert to nested array for local execution.
     */
    _convertServerPlanToLevels(serverPlan, localNodes) {
      if (!serverPlan?.steps?.length) return [];

      // Group steps by level_index
      const levelMap = new Map();
      for (const step of serverPlan.steps) {
        const levelIdx = step.level_index ?? 0;
        if (!levelMap.has(levelIdx)) levelMap.set(levelIdx, []);

        // Map step to local node (server only has node_id, need full node data)
        const localNode = localNodes.find(n => n.node_id === step.node_id);
        if (localNode) {
          // Merge server step metadata with local node
          levelMap.get(levelIdx).push({
            ...localNode,
            _serverStep: step, // Keep server metadata for reference
          });
        }
      }

      // Convert to array sorted by level_index
      const levels = [];
      const sortedKeys = [...levelMap.keys()].sort((a, b) => a - b);
      for (const key of sortedKeys) {
        levels.push(levelMap.get(key));
      }

      return levels;
    }

    /**
     * Heartbeat: pulse last_heartbeat_at vào af_running_workflow mỗi 60s.
     * Reader (context khác) dùng để phân biệt workflow đang chạy thật vs context đã chết.
     * Phase 2b: Also pulses to server for admin monitoring.
     */
    _startHeartbeat(wfId) {
      this._stopHeartbeat();
      if (!wfId) return;
      this._heartbeatWfId = wfId;
      this._heartbeatTimer = setInterval(() => {
        pulseHeartbeat(wfId);
        // Phase 2b: Also pulse to server (best-effort, non-blocking)
        // [P2.7 Kênh 2] Enrich node_states CHỈ khi có thay đổi (on-change throttle — Bug 62/63
        // rate-limit friendly). Web reload/đa thiết bị đọc executions active → thấy đúng state.
        const states = this._nodeStatesDirty ? { ...this._nodeStatesLive } : null;
        this._nodeStatesDirty = false;
        heartbeatServer(this.currentNode?.node_id, this._completedNodesCount || 0, states);
      }, HEARTBEAT_INTERVAL_MS);
    }

    _stopHeartbeat() {
      if (this._heartbeatTimer) {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
      }
    }

    /**
     * [API SPAM FIX — Phase 5.10] Crash recovery: persist buffer vào chrome.storage.local mỗi 10s.
     * Nếu browser crash giữa execution → reload → recovery từ checkpoint.
     */
    _startBufferCheckpoint(wfId) {
      this._stopBufferCheckpoint();
      if (!wfId) return;
      this._bufferCheckpointTimer = setInterval(() => {
        this._persistBufferCheckpoint(wfId);
      }, 10000); // 10s checkpoint
    }

    _stopBufferCheckpoint() {
      if (this._bufferCheckpointTimer) {
        clearInterval(this._bufferCheckpointTimer);
        this._bufferCheckpointTimer = null;
      }
    }

    async _persistBufferCheckpoint(wfId) {
      if (this._nodeStateBuffer.size === 0) return;
      try {
        await new Promise(resolve => {
          chrome.storage.local.set({
            [`af_workflow_buffer_${wfId}`]: {
              nodes: Object.fromEntries(this._nodeStateBuffer),
              timestamp: Date.now(),
            }
          }, resolve);
        });
        log('Buffer checkpoint saved:', this._nodeStateBuffer.size, 'nodes');
      } catch (e) {
        console.warn('[WorkflowExecutor] Buffer checkpoint failed:', e);
      }
    }

    async _clearBufferCheckpoint(wfId) {
      if (!wfId) return;
      try {
        await new Promise(resolve => {
          chrome.storage.local.remove([`af_workflow_buffer_${wfId}`], resolve);
        });
      } catch (e) { /* ignore */ }
    }

    /**
     * Acquire editor mutex — serialize toàn bộ editor operations giữa parallel nodes
     * Critical section: apply settings → clear editor → add ref images → insert text → submit → chờ tile placeholder
     * Flow chỉ có 1 prompt editor → parallel nodes PHẢI chờ nhau hoàn thành toàn bộ chuỗi
     */
    _acquireSubmitMutex() {
      let release;
      const acquired = new Promise(resolve => { release = resolve; });
      const prev = this._submitMutexQueue;
      this._submitMutexQueue = prev.then(() => acquired);
      // Chờ promise trước hoàn thành rồi mới return release function
      return prev.then(() => release);
    }

    /**
     * Get generation defaults from user settings (async, reads chrome.storage)
     */
    async _getGenDefaults() {
      if (this._genDefaults) return this._genDefaults;
      // Strict Server-Only: ModelRegistry async fetch từ backend provider_models (is_default flag).
      // Cache miss → null + Tier3 warn, caller xử lý null.
      const _defImg = await (window.ModelRegistry?.getDefaultAsync('flow', 'image')) || null;
      const _defVid = await (window.ModelRegistry?.getDefaultAsync('flow', 'video')) || null;
      if (!_defImg) console.debug('[Tier3] WorkflowExecutor._getGenDefaults: flow.image default model cache miss');
      if (!_defVid) console.debug('[Tier3] WorkflowExecutor._getGenDefaults: flow.video default model cache miss');
      try {
        const result = await new Promise(resolve => {
          chrome.storage.local.get(['af_settings'], r => resolve(r.af_settings || {}));
        });
        this._genDefaults = {
          genType: result.defaultGenType || 'Image',
          ratio: result.defaultRatio || '9:16',
          imageModel: result.defaultImageModel || _defImg,
          videoModel: result.defaultVideoModel || _defVid
        };
      } catch (e) {
        this._genDefaults = {
          genType: 'Image', ratio: 'Dọc',
          imageModel: _defImg, videoModel: _defVid
        };
      }
      return this._genDefaults;
    }

    /**
     * Detect if running inside content script context (has direct DOM functions)
     */
    _isContentScriptContext() {
      return typeof getEditor === 'function' && typeof getSubmitButton === 'function';
    }

    /**
     * Chạy workflow
     */
    // [FLOW_RECAPTCHA_403] Bind lazy listener halt-on-captcha (eventBus đã sẵn lúc execute).
    _ensureFlowCaptchaListener() {
      if (this._flowCaptchaBound || !window.eventBus) return;
      this._flowCaptchaBound = true;
      window.eventBus.on('flow:error_classified', (data) => {
        // Ghi lại loại lỗi gần nhất để _noteGenFailure phân loại được: category đi qua
        // eventBus chứ KHÔNG gắn vào Error ném lên _executeNode. Kèm mốc thời gian để
        // _lastFlowErrCategory không "dính" sang node hỏng vì lý do khác sau đó.
        if (data?.category) {
          this._lastFlowErrCategory = data.category;
          this._lastFlowErrAt = Date.now();
        }
        if (this.isRunning && data?.category === 'captcha') {
          console.warn('[WorkflowExecutor] reCAPTCHA phát hiện → halt workflow (rerun-resume node lỗi).');
          this._captchaHalted = true;
          this._captchaText = data?.text || data?.message || null; // Port 1.1.58: lưu lý do hiện ở modal
          this.shouldStop = true;
        }
      });
    }

    // Port 1.1.58: captcha halt workflow (giữa 2 level) → hỏi user continue/stop. Timeout 60s → 'stop'
    // (an toàn, tránh spam 403). customDialog N/A → 'stop'.
    async _handleCaptchaDecision() {
      const I = window.I18n;
      const title = I?.t('workflow.captchaModalTitle') || 'Google Flow tạm chặn (captcha)';
      const base = I?.t('workflow.captchaModalMsg') || 'Một node bị Google Flow chặn tạm thời do hoạt động bất thường. Các node đang chạy đã hoàn tất.\n\nTiếp tục chạy các node còn lại? (Có thể tiếp tục bị chặn — nên chờ 1–2 phút rồi thử lại.)';
      const msg = this._captchaText ? `${this._captchaText}\n\n${base}` : base;
      const continueText = I?.t('workflow.captchaContinue') || 'Tiếp tục';
      const stopText = I?.t('workflow.captchaStop') || 'Dừng workflow';
      if (!window.customDialog?.confirm) {
        console.warn('[WorkflowExecutor] customDialog N/A → default STOP on captcha.');
        return 'stop';
      }
      let timer = null;
      const confirmP = window.customDialog.confirm(msg, { title, type: 'warning', confirmText: continueText, cancelText: stopText })
        .then(ok => { if (timer) clearTimeout(timer); return ok ? 'continue' : 'stop'; });
      const timeoutP = new Promise(resolve => {
        timer = setTimeout(() => { try { window.customDialog._close?.(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#_handleCaptchaDecision', _); } resolve('stop'); }, 60000);
      });
      return Promise.race([confirmP, timeoutP]);
    }

    async execute(workflowId, opts = {}) {
      console.log('[WorkflowExecutor] execute() called with:', workflowId, 'isRunning:', this.isRunning);
      this._ensureFlowCaptchaListener();
      if (this.isRunning) {
        log('Already running a workflow');
        return false;
      }

      // Bug fix 2026-05-22: check duplicate provider tabs TRƯỚC khi execute.
      // Multi-tab cùng provider URL → session manager confused (dùng tabs[0]) → tab thừa
      // stale + RAM waste. Fire-and-forget modal nếu detect (user có thể ignore + tiếp tục).
      if (window.GenTab?._checkDuplicateProviderTabs) {
        try {
          const wf = await window.storageManager?.getWorkflow?.(workflowId);
          const nodes = wf?.nodes || [];
          const providers = new Set();
          for (const n of nodes) {
            if (n.enabled === false) continue;
            const t = n.node_type;
            if (t === 'image' || t === 'generate') providers.add('flow');
            else if (t === 'chatgpt') providers.add('chatgpt');
            else if (t === 'grok') providers.add('grok');
          }
          for (const p of providers) {
            window.GenTab._checkDuplicateProviderTabs(p, { interactive: true });
          }
        } catch (e) {
          console.warn('[WorkflowExecutor] duplicate tab check failed:', e?.message || e);
        }
      }

      // Cảnh báo tín dụng Flow (2026-07-27) — nói TRƯỚC khi chạy nếu workflow vượt số dư.
      // CỐ Ý chỉ cảnh báo, KHÔNG chặn: bảng giá có thể lỗi thời khi Google đổi giá, và chặn oan
      // (không cho chạy dù thực ra vẫn đủ) tệ hơn là để user chạy rồi Flow tự báo thiếu.
      try {
        if (window.CreditsPanel?.warningFor) {
          const wf = await window.storageManager?.getWorkflow?.(workflowId);
          const msg = window.CreditsPanel.warningFor((wf?.nodes || []).filter((n) => n.enabled !== false));
          if (msg) {
            console.warn('[WorkflowExecutor] credits:', msg);
            (window.showToast || window.Toast?.show)?.(msg, 'warning');
          }
        }
      } catch (e) {
        console.warn('[WorkflowExecutor] credit check failed:', e?.message || e);
      }

      // Clear cached generation defaults so fresh settings are loaded
      this._genDefaults = null;

      // ExecutionLock: kiểm tra trước khi chạy
      const isBlockedByLock = window.ExecutionLock && ExecutionLock.isBlockedBy('workflow');
      console.log('[WorkflowExecutor] ExecutionLock check:', isBlockedByLock);
      if (isBlockedByLock) {
        const shouldStop = await ExecutionLock.showBlockedDialog('workflow');
        console.log('[WorkflowExecutor] ExecutionLock dialog result:', shouldStop);
        if (!shouldStop) return false;
        await ExecutionLock.stopCurrent();
      }

      // Gap 1+2 fix: atomic claim cross-context running flag NGAY trước mọi await dài.
      // Cũ: af_running_workflow set ở line ~282 sau load+ExecutionGate (~vài giây) → race
      // 2 contexts cùng pass check rồi cùng chạy.
      const isPopupCtxEarly = window.location?.pathname?.includes('workflow-editor') ||
                              window.location?.pathname?.includes('popup');
      console.log('[WorkflowExecutor] Claiming running flag, ctx:', isPopupCtxEarly ? 'popup' : 'sidebar');
      const claim = await claimRunningFlag(workflowId, null, isPopupCtxEarly ? 'popup' : 'sidebar');
      console.log('[WorkflowExecutor] Claim result:', claim);
      if (!claim.ok) {
        log('Cross-context running flag held by:', claim.runningWfId);
        const err = new Error(`"${claim.runningWfName}" đang chạy ở cửa sổ khác`);
        err.code = 'CROSS_CONTEXT_RUNNING';
        throw err;
      }

      try {
        // Gap 2 fix: start heartbeat NGAY trong try (đảm bảo finally _stopHeartbeat
        // bao phủ mọi exception path). Heartbeat track liveness suốt execute().
        this._startHeartbeat(workflowId);
        this.isRunning = true;
        this.shouldStop = false;
        this._skippedInputNodes = []; // gom node bị bỏ qua do thiếu input → báo tóm tắt cuối run
        this._captchaHalted = false; this._captchaDecided = false; this._captchaText = null; // Port 1.1.58: reset captcha state mỗi run
        // Cầu chì reset theo TỪNG LẦN CHẠY: lỗi liên tiếp của lần chạy trước không nên
        // khiến lần chạy mới (user đã sửa prompt / đã chờ) bị nghỉ oan ngay từ node đầu.
        this._circuitBreaker = null;
        this._lastFlowErrCategory = null; this._lastFlowErrAt = 0;
        this._skippedNodeIds = new Set(); // Build: reset condition-skip set mỗi run
        // Phase 5 (Manual Submit): set từ PARAM opts (KHÔNG pre-set instance var từ caller) → mỗi run
        // set tươi trong try. Tránh leak: execute early-return trước try (isRunning/lock/cross-context)
        // không để lại flag stale; automated trigger (Telegram/MCP/Batch/RunAll) không truyền opts → false.
        this._manualSubmitMode = opts?.manualSubmitMode === true;
        // Phase 2b: Start server tracking (will be completed in finally block)
        this._serverTrackingWfId = workflowId;
        // Phase 5.2: per-node submitted tracking thay vì global _nodeSubmitted
        this._submittedNodes = new Set();
        this._currentExecutionToken = null;
        // Reset download dedup cho workflow session mới
        this._downloadedTileIds = new Set();
        // Reset submit mutex cho workflow mới (tránh stale promise)
        this._submitMutexQueue = Promise.resolve();
        // [API SPAM FIX — Phase 5] Clear buffer + enable buffering mode
        this._nodeStateBuffer.clear();
        this._nodeStatesLive = {};
        this._nodeStatesDirty = false;
        this._executionInProgress = true;
        // [API SPAM FIX — Phase 5.10] Start buffer checkpoint (persist mỗi 10s cho crash recovery)
        this._startBufferCheckpoint(workflowId);

        // Load workflow đầy đủ TRƯỚC ExecutionGate để tính prompt count
        let workflow;
        try {
          workflow = await window.storageManager.getWorkflow(workflowId);
        } catch (loadErr) {
          // Friendly error message for connection errors
          if (loadErr.code === 'CONNECTION_ERROR') {
            throw new Error(loadErr.message || 'Không thể tải workflow do lỗi kết nối');
          }
          throw loadErr;
        }
        if (!workflow) {
          throw new Error('Workflow không tồn tại hoặc đã bị xóa');
        }

        // Ensure nodes/edges are arrays (ApiStorage may not populate them)
        if (!Array.isArray(workflow.nodes)) workflow.nodes = [];
        if (!Array.isArray(workflow.edges)) workflow.edges = [];

        // Debug: log node_ids from fetched workflow
        console.log('[WorkflowExecutor] execute: Loaded workflow nodes:', workflow.nodes.map(n => ({ node_id: n.node_id, node_type: n.node_type, node_name: n.node_name })));
        // Debug ref_thumbnails for Image nodes
        for (const n of workflow.nodes) {
          if (n.node_type === 'image') {
            console.log(`[WorkflowExecutor] Image node "${n.node_name}": ref_file_ids="${n.ref_file_ids || ''}", ref_thumbnails keys=${Object.keys(n.ref_thumbnails || {}).join(',') || '(none)'}`);
          }
        }

        // Fix flicker zoom 2026-06-22: full workflow → arm zoom session 0.3 MỘT LẦN ở đầu run (refcount
        // baseline), spanning mọi node generate → ref-prep từng node in-session 0.3, restore 1 lần ở finally.
        // PHẢI await (tránh race với ref-scan node đầu). Chỉ arm khi có ≥1 generate node (Flow).
        if (window.MessageBridge && workflow.nodes.some(n => n.node_type === 'generate')) {
          try { await window.MessageBridge.sendToContentScript('beginFlowZoomSession', { factor: 0.3, hold: true }); } catch (e) { /* non-blocking */ }
        }

        // Option A3: KHÔNG block run legacy workflow over-quota.
        // Backend chỉ enforce trên SAVE (grandfather logic), allow run với legacy count.
        // → Frontend run cũng không block, chỉ log warning để dev biết.
        if (window.featureGate && workflow.nodes.length > 0) {
          try {
            const nodeQuota = window.featureGate.checkQuota('workflows_nodes_max');
            const limit = nodeQuota?.limit;
            if (limit !== 'unlimited' && limit !== '-1' && limit > 0 && workflow.nodes.length > limit) {
              console.info('[WorkflowExecutor] Run legacy workflow over-quota: ' +
                workflow.nodes.length + ' nodes / ' + limit + ' limit. Run vẫn được nhưng không thể thêm node mới.');
            }
          } catch (e) { /* ignore */ }
        }

        this.currentWorkflow = workflow;

        // Acquire ExecutionLock
        if (window.ExecutionLock) ExecutionLock.acquire('workflow', `Workflow: ${workflow.wf_name}`);

        // Activate Flow tab when execution starts
        try {
          chrome.runtime.sendMessage({ action: 'activateFlowTabForExecution' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#execute', _e); });
        } catch (e) {
          log('Error activating Flow tab:', e);
        }

        // GP-7.4: Tính promptCount từ các generate nodes
        // Mỗi node submit 1 lần
        // Server cần biết tổng số lần submit prompt thực tế
        let promptCount = 0;
        // Track per-provider prompt count for usage tracking
        let flowPromptCount = 0;
        let chatgptPromptCount = 0;
        let grokPromptCount = 0;
        if (Array.isArray(workflow.nodes)) {
          for (const node of workflow.nodes) {
            if (node.enabled === false) continue; // Bỏ qua node đã tắt
            if (node.node_type === 'generate') {
              // Generate node: 1 prompt submission (Flow provider)
              promptCount += 1;
              flowPromptCount += 1;
            } else if (node.node_type === 'chatgpt') {
              // ChatGPT node: 1 prompt submission (qua provider ChatGPT).
              promptCount += 1;
              chatgptPromptCount += 1;
            } else if (node.node_type === 'grok') {
              // Phase G-6: Grok node: 1 prompt submission (qua provider Grok)
              promptCount += 1;
              grokPromptCount += 1;
            } else if (node.node_type === 'prompt' && node.use_ai === true) {
              // AI Agent rename (2026-05-30): AI Agent node ON = 1 prompt submission cho global quota.
              // OFF = pass-through, KHÔNG tốn prompt quota.
              // AI Agent chỉ có 2 option: chatgpt/gemini (cả 2 → chatgpt bucket)
              promptCount += 1;
              chatgptPromptCount += 1;
            }
            // Các node khác (download, delay, telegram, prompt OFF) không submit prompt
          }
        }
        // Fallback: ít nhất 1 prompt nếu không tìm thấy generate nodes
        if (promptCount === 0) {
          promptCount = 1;
          flowPromptCount = 1;
        }
        // Store for tracking after completion
        this._workflowPromptCounts = { total: promptCount, flow: flowPromptCount, chatgpt: chatgptPromptCount, grok: grokPromptCount };
        log('Calculated prompt count for workflow:', promptCount, '(flow:', flowPromptCount, ', chatgpt:', chatgptPromptCount, ', grok:', grokPromptCount, ')');

        // Bug 1 fix (workflow path 2026-05-17): track ACTUAL successful prompts thay vì plan count.
        // Khi user stop giữa chừng, recordPromptSubmit dùng actual count để khớp với usage thực tế.
        // Increment sau mỗi node success ở loop chính (dựa vào node_type provider mapping).
        this._workflowSuccessCounts = { total: 0, flow: 0, chatgpt: 0, grok: 0 };

        // SP-2.5: ExecutionGate - xin phep server truoc khi chay workflow
        // GP-7.4: Truyền promptCount chính xác thay vì hardcode 1
        console.log('[WorkflowExecutor] Requesting ExecutionGate, promptCount:', promptCount);
        if (window.ExecutionGate) {
          try {
            const gate = await ExecutionGate.request('workflow_run', promptCount, { owner: 'workflow', label: workflowId });
            console.log('[WorkflowExecutor] ExecutionGate response:', gate);
            if (!gate.allowed) {
              ExecutionGate.showDeniedDialog(gate, 'Workflow');
              this.isRunning = false;
              if (window.ExecutionLock) ExecutionLock.release('workflow');
              return false;
            }
            this._currentExecutionToken = gate.token;
            // [Audit Bug 9 fix 2026-06-22] Token NULL khi fallback mode (offline cache OK nhưng server unreachable).
            // Trước fix: code "proceeding without token" → quota không track → user vượt giới hạn thật.
            // Sau fix: nếu token null sau request thành công (fallback OFFLINE_FALLBACK) → vẫn cho phép
            // nhưng log warning để monitor. Strict Server-Only thực sự đã ép TTL 60s ở _fallbackCheck.
            if (!this._currentExecutionToken && gate.reason === 'OFFLINE_FALLBACK') {
              console.warn('[WorkflowExecutor] Running with offline fallback (no server token) — quota may drift');
            }
          } catch (e) {
            if (window.QuotaErrorHandler?.handleIfQuotaError(e, 'Workflow')) {
              console.warn('[WorkflowExecutor] ExecutionGate denied:', e.code || e.reason);
              this.isRunning = false;
              if (window.ExecutionLock) ExecutionLock.release('workflow');
              return false;
            }
            // [Audit Bug 9 fix 2026-06-22] Server-Only spec: abort thay vì proceed without token.
            // Trước fix: log "proceeding" rồi chạy → quota không deduct → drift nghiêm trọng.
            // Sau fix: emit log lỗi + dừng workflow, user retry khi server lại.
            console.error('[WorkflowExecutor] ExecutionGate request failed, ABORTING (Server-Only spec):', e.message);
            emitLog({
              message: `❌ Không thể xin phép server chạy workflow: ${e.message || 'unknown'}. Vui lòng kiểm tra kết nối và thử lại.`,
              type: 'error'
            });
            this.isRunning = false;
            if (window.ExecutionLock) ExecutionLock.release('workflow');
            return false;
          }
        }
        console.log('[WorkflowExecutor] Starting workflow:', workflow.wf_name);

        // Phase 3.5 Bug J: Refresh settings từ ExecutionConfig (system_settings server-side)
        // TRƯỚC khi apply workflow-specific override.
        // Priority: workflow.settings_json > system_settings (ExecutionConfig) > hardcoded defaults
        this._refreshSettingsFromExecutionConfig();

        // Global user preference (footer/Settings toggle) — af_settings.retryOnFail/maxRetries.
        // Priority: workflow.settings_json > af_settings (user global) > system_settings > defaults.
        try {
          const af = await new Promise(r => chrome.storage.local.get(['af_settings'], x => r(x.af_settings || {})));
          if (af.retryOnFail !== undefined) this.settings.retryOnFail = af.retryOnFail !== false;
          if (af.maxRetries !== undefined && af.maxRetries !== null) this.settings.maxRetries = Number(af.maxRetries) || 0;
        } catch (_) { /* storage read fail → giữ default */ }

        // Apply workflow settings (per-workflow override — ưu tiên cao nhất)
        const wfSettings = workflow.settings_json || {};
        if (wfSettings.delay_between_nodes) this.settings.delayBetweenNodes = wfSettings.delay_between_nodes * 1000;
        if (wfSettings.max_retries !== undefined) this.settings.maxRetries = wfSettings.max_retries;
        if (wfSettings.timeout) this.settings.tileTimeout = wfSettings.timeout * 1000;
        if (wfSettings.stop_on_error !== undefined) this.settings.stopOnError = wfSettings.stop_on_error;
        let parallelExecution = wfSettings.parallel_execution ?? true;

        // Phase 3.5 Bug C.1: Force save workflow lên server trước khi fetch plan.
        // Lý do: server gen plan từ DB. Nếu local có node mới chưa save → plan thiếu node mới
        // → silent miss. Force save đảm bảo DB current.
        try {
          if (window.storageManager?.saveWorkflowFull) {
            emitLog({ message: 'Đang đồng bộ workflow lên server...', type: 'info' });
            await window.storageManager.saveWorkflowFull(
              workflow,
              workflow.nodes || [],
              workflow.edges || []
            );
            log('Pre-execute save complete, workflow synced to server');
          }
        } catch (saveErr) {
          // Log full error including validation details (AuthManager attach err.details cho 422)
          if (saveErr.details && typeof saveErr.details === 'object') {
            console.error('[WorkflowExecutor] Pre-execute save failed:', saveErr.message, '— field errors:', saveErr.details);
          } else {
            console.error('[WorkflowExecutor] Pre-execute save failed:', saveErr);
          }
          // Build user-facing message: nếu validation error, show first field error để user biết field nào fix.
          let userMsg = `❌ Không thể đồng bộ workflow lên server: ${saveErr.message || 'unknown error'}.`;
          if (saveErr.code === 'VALIDATION_ERROR' && saveErr.details && typeof saveErr.details === 'object') {
            const fields = Object.keys(saveErr.details);
            if (fields.length > 0) {
              const firstField = fields[0];
              const firstMsgs = saveErr.details[firstField];
              const firstMsg = Array.isArray(firstMsgs) ? firstMsgs[0] : String(firstMsgs);
              userMsg += ` Field "${firstField}": ${firstMsg}`;
              if (fields.length > 1) userMsg += ` (+${fields.length - 1} field khác — xem console).`;
            }
          } else {
            userMsg += ' Vui lòng kiểm tra kết nối và thử lại.';
          }
          emitLog({ message: userMsg, type: 'error' });
          this.isRunning = false;
          if (window.ExecutionLock) ExecutionLock.release('workflow');
          return false;
        }

        // Phase 1 Migration: Fetch execution plan from server (topological sort server-side)
        // Server performs Kahn's algorithm - algorithm hidden for IP protection
        // Phase 3.5 Bug C.4: pass settings_override để server áp dụng user preferences
        let executionLevels;
        let isMixedProviders = false;
        const serverPlanResult = await this._fetchServerPlan(workflowId, {
          parallel_execution: parallelExecution,
          stop_on_error: this.settings.stopOnError ?? false,
          max_retries: this.settings.maxRetries,
        }, workflow);

        if (serverPlanResult.success && serverPlanResult.plan) {
          // Use server plan
          this._serverPlan = serverPlanResult.plan;
          // [Audit Bug 1 fix] _serverExecutionToken removed — token chỉ cấp 1 lần qua ExecutionGate.request
          // ở line 1104 → _currentExecutionToken. Endpoint /workflows/{id}/execute không cấp token nữa.
          isMixedProviders = serverPlanResult.plan.is_mixed_providers ?? false;
          executionLevels = this._convertServerPlanToLevels(serverPlanResult.plan, workflow.nodes);

          // Phase 3.5 Bug C.3: validate plan completeness
          const enabledLocalNodes = (workflow.nodes || []).filter(n => n.enabled !== false);
          if (serverPlanResult.plan.total_steps !== enabledLocalNodes.length) {
            console.warn(`[WorkflowExecutor] Plan mismatch: server=${serverPlanResult.plan.total_steps} steps, local=${enabledLocalNodes.length} enabled nodes — workflow có thể chưa sync server`);
            emitLog({
              message: `⚠️ Workflow chưa sync hoàn toàn lên server (${serverPlanResult.plan.total_steps}/${enabledLocalNodes.length} nodes). Vui lòng lưu workflow rồi thử lại.`,
              type: 'warn'
            });
          }
          console.log('[WorkflowExecutor] Using server execution plan, levels:', executionLevels.length);
        } else {
          // Phase 3.5 Bug C.2/C.3: handle specific server errors
          if (serverPlanResult.error === 'CYCLE_DETECTED') {
            emitLog({
              message: `❌ Workflow có cycle (vòng lặp), không thể chạy. Nodes unreachable: ${(serverPlanResult.unreachable || []).join(', ')}`,
              type: 'error'
            });
            this.isRunning = false;
            return false;
          }
          if (serverPlanResult.error === 'EMPTY_WORKFLOW') {
            emitLog({ message: '❌ Workflow trống — hãy thêm node trước khi chạy', type: 'error' });
            this.isRunning = false;
            return false;
          }
          // Phase 3.5 Bug C.6: NO MORE LOCAL FALLBACK (Server-Only architecture).
          // Server unavailable / network error → block execution với ConfigErrorHandler overlay.
          // Cron `execution:cleanup` every 10 min sẽ rollback quota nếu token đã cấp.
          console.error('[WorkflowExecutor] Server plan unavailable, blocking execution:', {
            error: serverPlanResult.error,
            httpStatus: serverPlanResult.httpStatus,
            exception: serverPlanResult.exception,
          });

          // Phân biệt overlay context:
          // - HTTP 429 → rate limited, KHÔNG phải lỗi request. Hiện message riêng + retry hint.
          // - HTTP 5xx / Laravel exception / FE detect invalid response → server có thể đang hoạt động
          //   nhưng endpoint fail. KHÔNG show "config.required/offline" overlay (wording sai).
          //   Chỉ emit log trong sidebar để user thấy error cụ thể + retry workflow.
          // - HTTP 4xx (trừ 429) → client error. KHÔNG show overlay (đây là bug request, không phải config missing).
          // - Network error / no response (truly offline) → server unreachable → show ConfigErrorHandler overlay.
          const isRateLimited = serverPlanResult.httpStatus === 429;
          const isHttp5xx = serverPlanResult.httpStatus >= 500 && serverPlanResult.httpStatus < 600;
          const isServerException = !!serverPlanResult.exception;
          const isHttp4xx = !isRateLimited && serverPlanResult.httpStatus >= 400 && serverPlanResult.httpStatus < 500;
          // PLAN_FETCH_FAILED = FE detect response shape invalid (server returned 2xx nhưng data thiếu plan).
          // CYCLE_DETECTED = server detect cycle trong workflow graph. Cả 2 không phải offline state.
          const isFeShapeError = serverPlanResult.error === 'PLAN_FETCH_FAILED'
            || serverPlanResult.error === 'CYCLE_DETECTED';

          let userMsg;
          if (isRateLimited) {
            userMsg = `⏳ Server đang bận, vui lòng đợi vài giây rồi thử lại. (Rate limited)`;
          } else if (isHttp5xx || isServerException) {
            userMsg = `❌ Lỗi server tạm thời khi tải execution plan (${serverPlanResult.error || 'HTTP ' + serverPlanResult.httpStatus}). Vui lòng thử lại sau ít phút.`;
          } else if (isHttp4xx) {
            userMsg = `❌ Yêu cầu không hợp lệ: ${serverPlanResult.error || 'HTTP ' + serverPlanResult.httpStatus}. Vui lòng kiểm tra workflow và thử lại.`;
          } else if (isFeShapeError) {
            userMsg = `❌ Phản hồi từ server không hợp lệ (${serverPlanResult.error}). Vui lòng reload extension và thử lại.`;
          } else {
            userMsg = `❌ Không thể tải execution plan từ server (${serverPlanResult.error || 'unknown'}). Vui lòng kiểm tra kết nối và thử lại.`;
          }
          emitLog({ message: userMsg, type: 'error' });

          // Chỉ show ConfigErrorHandler overlay khi truly offline (no HTTP status + no FE shape error).
          // HTTP 4xx/5xx / Server exception / FE shape error → emit log đủ, không cần fullscreen overlay.
          const shouldShowOverlay = !isHttp4xx && !isHttp5xx && !isServerException && !isFeShapeError;
          if (shouldShowOverlay && window.ConfigErrorHandler?.handle && window.ConfigRequiredError) {
            try {
              window.ConfigErrorHandler.handle(
                new window.ConfigRequiredError('workflow_plan', serverPlanResult.error || 'fetch_failed'),
                'WorkflowExecutor.execute'
              );
            } catch (_) { /* best effort */ }
          }
          this.isRunning = false;
          if (window.ExecutionLock) ExecutionLock.release('workflow');
          return false;
        }

        // K.10 (2026-05-29): KHÔNG force GLOBAL sequential khi mixed providers.
        // Server đã handle per-level via plan.steps[].parallel_allowed (per-level mixed check).
        // Level chỉ Flow → parallel_allowed=true → parallel work; Level chứa ChatGPT/Grok hoặc
        // mixed cross-provider → parallel_allowed=false → sequential.
        // Client trust server per-level decision, không cần override global.
        // Log informational vẫn emit khi mixed (cho user biết workflow có cross-provider).
        if (isMixedProviders) {
          emitLog({
            message: 'Workflow có nhiều provider — level chỉ chứa Flow sẽ chạy song song, level chứa ChatGPT/Grok/mixed sẽ tuần tự',
            type: 'info'
          });
        }
        this._effectiveParallel = parallelExecution;

        // Check retry_on_fail feature - override maxRetries = 0 nếu không có quyền.
        // [Phase 5] Local mode (KHÔNG có featureGate) → retry là tính năng local miễn phí → TÔN TRỌNG
        // setting user (af_settings.retryOnFail, load ở ~1514). Trước đây `?? false` ép off khi featureGate
        // vắng → user bật retry vẫn không chạy. Chỉ gate khi featureGate CÓ và từ chối (online plan).
        try {
          const canUseRetry = window.featureGate ? !!window.featureGate.canUse('retry_on_fail') : true;
          if (!canUseRetry) {
            this.settings.maxRetries = 0;
            this.settings.retryOnFail = false;
            log('Retry feature disabled by plan');
          }
        } catch (e) {
          log('Error checking retry feature:', e);
        }

        // Update workflow status
        await this._updateWorkflowStatus('running');

        // Emit start event
        window.eventBus.emit('execution:started', { workflow });
        broadcastEvent('execution:started', { workflow: { wf_id: workflow.wf_id, wf_name: workflow.wf_name } });

        // UA-3.4: Theo doi bat dau workflow
        window.UsageSync?.trackEvent('workflow_start', { workflow_id: workflow.wf_id, node_count: workflow.nodes?.length || 0 });

        // WS-6: af_running_workflow đã được claim ở đầu execute() — chỉ update wf_name
        // sau khi load xong workflow (ban đầu claim với null name vì chưa có data).
        await updateRunningFlagName(workflow.wf_id, workflow.wf_name);

        // Port 1.1.58 NOTE_GROUP_RUN: subset execution — chạy nhóm note chỉ chạy node trong
        // opts.onlyNodeIds. Filter SAU build levels (giữ topo order nội bộ). Ref collection vẫn đọc
        // full workflow.nodes → upstream ngoài group dùng result_file_ids đã lưu. Guard length →
        // full-run KHÔNG đổi hành vi.
        if (opts.onlyNodeIds && opts.onlyNodeIds.length) {
          const _runSet = new Set(opts.onlyNodeIds.map(String));
          executionLevels = executionLevels
            .map(level => level.filter(n => _runSet.has(String(n.node_id))))
            .filter(level => level.length > 0);
          if (executionLevels.length === 0) {
            emitLog({ message: 'Nhóm note không chứa node chạy được', type: 'warn' });
            this.isRunning = false;
            return false;
          }
          log('[NoteGroupRun] subset levels:', executionLevels.map(l => l.map(n => n.node_name)));
        }

        // Execution levels built above (server or local). MUST declare TRƯỚC `totalNodes`
        // và `startServerTracking` để tránh ReferenceError TDZ (`const` block-scoped).
        const executionOrder = executionLevels.flat();

        // Phase 2b: Start server-side execution tracking
        // Non-blocking - if server fails, local tracking continues
        const totalNodes = executionOrder?.length || workflow.nodes?.length || 0;
        startServerTracking(workflow.wf_id, workflow.wf_name, totalNodes, 'sidebar');

        // Tracker broadcast (cross-window → sidePanel ExecutionTracker)
        // Skip khi pipeline ON — PromptQueue đã gửi pq:trackerUpdate riêng
        if (window.ExecutionLock && !(window.PromptQueue?.isEnabled?.())) {
          ExecutionLock.broadcastTracker({
            owner: 'workflow', label: `Workflow: ${workflow.wf_name}`,
            phase: 'started', current: 0, total: executionOrder.length
          });
        }
        log('Execution order:', executionOrder.map(n => n.node_name));
        // Debug: log chi tiết từng level với node_id và type
        console.log('[WorkflowExecutor] All nodes:', (workflow.nodes || []).map(n =>
          `${n.node_name} (${n.node_type}, id=${n.node_id?.substring(0,8)}, enabled=${n.enabled})`
        ));
        console.log('[WorkflowExecutor] All edges:', (workflow.edges || []).map(e =>
          `${e.source_node_id?.substring(0,8)} → ${e.target_node_id?.substring(0,8)} (${e.source_port || 'default'} → ${e.target_port || 'default'})`
        ));
        console.log('[WorkflowExecutor] Execution levels detail:');
        executionLevels.forEach((level, idx) => {
          console.log(`  Level ${idx}:`, level.map(n => `${n.node_name} (${n.node_type}, id=${n.node_id?.substring(0,8)})`));
        });
        if (parallelExecution) log('Parallel mode enabled, levels:', executionLevels.map(l => l.map(n => n.node_name)));

        // Phase S2.6.3: Batch pre-resolve ref images (scan DOM 1 lần)
        await this._batchPreResolveRefImages(executionOrder);

        // Suppress auto-reload trong suốt workflow execution
        // Workflow submit nodes tuần tự → giữa các nodes queue rỗng
        // nhưng workflow chưa xong → reload sẽ mất tiles → node sau fail
        if (window.PromptQueue?.isEnabled?.()) {
          PromptQueue.getInstance().suppressReload();
        }

        const total = executionOrder.length;
        let completed = 0;

        // Log thứ tự chạy
        const enabledNodes = executionOrder.filter(n => n.enabled !== false);
        emitLog( {
          message: `Workflow "${workflow.wf_name}" - ${enabledNodes.length}/${total} nodes sẽ chạy${parallelExecution ? ' (song song)' : ''}`,
          type: 'info'
        });
        emitLog( {
          message: `Thứ tự: ${enabledNodes.map(n => n.node_name).join(' → ')}`,
          type: 'info'
        });

        // Execute nodes level by level
        for (let levelIdx = 0; levelIdx < executionLevels.length; levelIdx++) {
          // Port 1.1.58: captcha halt giữa 2 level → HỎI user tiếp tục/dừng (thay vì dừng im lặng).
          // 'continue' → clear halt + chạy tiếp; else giữ shouldStop → break dưới. Decide 1 lần/run.
          if (this.shouldStop && this._captchaHalted && !this._captchaDecided) {
            this._captchaDecided = true;
            const decision = await this._handleCaptchaDecision();
            if (decision === 'continue') {
              this._captchaHalted = false;
              this.shouldStop = false;
              emitLog({ message: 'Captcha: user chọn tiếp tục các node còn lại', type: 'info' });
            }
          }
          if (this.shouldStop) break;

          // Refresh node data từ storage trước mỗi level
          // Đảm bảo ref_file_ids mới nhất từ server
          // (đặc biệt quan trọng khi chạy từ popup editor — in-memory có thể stale)
          // [API SPAM FIX — Phase 5.11] QUAN TRỌNG: Bảo vệ local state khỏi stale server data
          // Vì buffer chưa flush → server có thể trả về status='pending' cho nodes đã completed local
          if (levelIdx > 0) {
            try {
              const freshNodes = await window.storageManager?.getNodes?.(workflow.wf_id);
              if (freshNodes?.length > 0) {
                for (const fn of freshNodes) {
                  const existing = workflow.nodes.find(n => n.node_id === fn.node_id);
                  if (existing) {
                    // Preserve local execution state - server data có thể stale do buffer
                    const preserveEnabled = existing.enabled;
                    const preserveStatus = existing.status;
                    const preserveResultFileIds = existing.result_file_ids;
                    const preserveResultThumbnails = existing.result_thumbnails;
                    const preserveResultFileNames = existing.result_file_names;
                    const preserveResultText = existing.result_text;

                    // Merge fresh data (chủ yếu lấy ref_file_ids mới)
                    Object.assign(existing, fn);

                    // Restore local execution state nếu đã có (tránh server stale overwrite)
                    if (preserveEnabled !== undefined) {
                      existing.enabled = preserveEnabled;
                    }
                    // CRITICAL: Nếu local đã completed/running/failed/skipped, giữ nguyên - server chưa biết.
                    // [Audit Bug 6 fix 2026-06-22] Thêm failed + skipped vào preserve list:
                    // - failed: downstream dependency check phải biết để mark skipped đúng (không retry)
                    // - skipped: tránh re-execute node đã skip do upstream fail (server vẫn 'pending')
                    if (['completed', 'running', 'failed', 'skipped'].includes(preserveStatus)) {
                      existing.status = preserveStatus;
                    }
                    // Giữ result data nếu local đã có
                    if (preserveResultFileIds) {
                      existing.result_file_ids = preserveResultFileIds;
                    }
                    if (preserveResultThumbnails) {
                      existing.result_thumbnails = preserveResultThumbnails;
                    }
                    if (preserveResultFileNames) {
                      existing.result_file_names = preserveResultFileNames;
                    }
                    if (preserveResultText) {
                      existing.result_text = preserveResultText;
                    }
                  }
                }
              }
            } catch (e) { /* ignore */ }
          }

          const levelNodes = executionLevels[levelIdx];

          // Phase 1 Migration: Trust server's parallel_allowed flag per step.
          // Server (WorkflowExecutionService::levelRequiresSequential) already computed:
          // - ChatGPT/Grok nodes → sequential (1 tab/1 editor)
          // - Prompt with enhance → sequential
          // - Mixed providers → sequential
          // - User's parallel_execution setting
          // All nodes in same level have same parallel_allowed value.
          const serverParallelAllowed = levelNodes[0]?._serverStep?.parallel_allowed ?? false;
          const useParallelThisLevel = serverParallelAllowed && levelNodes.length > 1;

          // Log when user wanted parallel but server forced sequential
          if (parallelExecution && !serverParallelAllowed && levelNodes.length > 1) {
            emitLog({
              message: `Level ${levelIdx + 1}: chạy tuần tự theo plan server (ChatGPT/Grok/mixed providers)`,
              type: 'info'
            });
          }

          if (useParallelThisLevel) {
            // Parallel: run same-level nodes concurrently
            const runnableNodes = levelNodes.filter(n => n.enabled !== false && n.status !== 'completed' && !this._skippedNodeIds?.has(n.node_id));
            const skipNodes = levelNodes.filter(n => n.enabled === false || n.status === 'completed' || this._skippedNodeIds?.has(n.node_id));

            // Log skipped nodes
            for (const node of skipNodes) {
              const _condSkip = this._skippedNodeIds?.has(node.node_id); // Build: condition branch skip
              const reason = _condSkip ? 'nhánh condition không chọn' : (node.enabled === false ? 'đã tắt' : 'đã hoàn thành');
              emitLog( { nodeId: node.node_id, message: `Bỏ qua (${reason})`, type: 'info' });
              if (_condSkip) { try { await this._updateNodeStatus(node.node_id, 'skipped'); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#execute', _); } }
              completed++;
              emitProgress( { total, completed, current: node });
            }

            if (runnableNodes.length > 0) {
              emitLog( { message: `--- Level ${levelIdx + 1}: chạy song song ${runnableNodes.length} nodes ---`, type: 'info' });

              // Staggered start: delay 2s giữa mỗi node để tránh race condition khi capture preTileIds
              // Node sau bắt đầu sau node trước đã có thời gian render tiles (processing)
              const STAGGER_DELAY_MS = 2000;
              const nodePromises = [];
              for (let i = 0; i < runnableNodes.length; i++) {
                if (i > 0) await this._sleep(STAGGER_DELAY_MS);
                nodePromises.push(this._executeSingleNode(runnableNodes[i], workflow, completed, total));
              }
              const results = await Promise.allSettled(nodePromises);

              for (let i = 0; i < results.length; i++) {
                completed++;
                emitProgress( { total, completed, current: runnableNodes[i] });
                await this._updateWorkflowProgress(completed, total, runnableNodes[i].node_id);

                if (results[i].status === 'rejected' && this.settings.stopOnError) {
                  this.shouldStop = true;
                  break;
                }
              }
            }
          } else {
            // Sequential: run nodes one by one (current behavior)
            for (const node of levelNodes) {
              if (this.shouldStop) {
                log('Execution stopped by user');
                emitLog( { message: 'Workflow bị dừng bởi người dùng', type: 'warn' });
                break;
              }

              this.currentNode = node;
              updateCurrentNode(workflow.wf_id, node.node_id);

              // Skip disabled node
              if (node.enabled === false) {
                emitLog( { nodeId: node.node_id, message: `Bỏ qua (đã tắt)`, type: 'info' });
                completed++;
                emitProgress( { total, completed, current: node });
                continue;
              }

              // Build: skip node nằm sau nhánh condition KHÔNG chọn.
              if (this._skippedNodeIds?.has(node.node_id)) {
                emitLog( { nodeId: node.node_id, message: `Bỏ qua (nhánh condition không chọn)`, type: 'info' });
                try { await this._updateNodeStatus(node.node_id, 'skipped'); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#execute', _); }
                completed++;
                emitProgress( { total, completed, current: node });
                continue;
              }

              // Skip node đã completed (resume mode)
              if (node.status === 'completed') {
                emitLog( { nodeId: node.node_id, message: `Bỏ qua (đã hoàn thành)`, type: 'info' });
                completed++;
                emitProgress( { total, completed, current: node });
                continue;
              }

              try {
                await this._executeSingleNode(node, workflow, completed, total);
              } catch (nodeError) {
                // Node failed - check if we should stop or continue with next nodes
                if (this.settings.stopOnError) {
                  this.shouldStop = true;
                  break;
                }
                // Continue with next node - dependency check will skip nodes that depend on this failed node
                log('Node failed, continuing with next nodes:', node.node_name, nodeError.message);
              }
              completed++;
              emitProgress( { total, completed, current: node });
              // Tracker progress broadcast (cross-window) — skip khi pipeline ON
              if (window.ExecutionLock && !(window.PromptQueue?.isEnabled?.())) {
                ExecutionLock.broadcastTracker({
                  owner: 'workflow', label: `Workflow: ${workflow.wf_name}`,
                  phase: 'prompt_submitting', current: completed, total,
                  promptText: node.node_name
                });
              }
              await this._updateWorkflowProgress(completed, total, node.node_id);
            }
          }

          // Delay between levels
          if (levelIdx < executionLevels.length - 1 && !this.shouldStop) {
            const delaySec = Math.round(this.settings.delayBetweenNodes / 1000);
            emitLog( {
              message: `Chờ ${delaySec}s trước level tiếp theo...`,
              type: 'info'
            });
            await this._sleep(this.settings.delayBetweenNodes);
          }
        }

        // [API SPAM FIX — Phase 5] Flush buffered node states TRƯỚC khi update workflow status
        // 1 PUT workflow_full thay vì N PATCH calls (giảm ~70% API calls)
        await this._flushNodeStateBuffer();

        // Complete workflow. [rebuild] finalStatus phản ánh CẢNH BÁO: có node bị bỏ qua (thiếu input)
        // → 'warning' (viền card CAM, persist tới khi chạy lại/reset — đúng mức độ như noti cảnh báo).
        // _skippedInputNodes còn nguyên ở đây (reset ở ~2035 sau toast); dùng lại _hadSkips ở emit dưới.
        const _hadSkips = !!(this._skippedInputNodes && this._skippedInputNodes.length);
        const finalStatus = this.shouldStop ? 'paused' : (_hadSkips ? 'warning' : 'completed');
        // BUG FIX 2026-06-05 (F3): KHÔNG fail workflow khi 429 từ save status.
        // Trước: 429 throw lên catch chính → mark workflow error → UI báo failed
        // dù gen tiles đã success.
        // Sau: catch 429 → log warn + giữ status local "completed" (server sẽ sync sau).
        try {
          await this._updateWorkflowStatus(finalStatus);
        } catch (statusErr) {
          const isRateLimit = statusErr?.code === 'RATE_LIMITED' || statusErr?.httpStatus === 429;
          if (isRateLimit) {
            console.warn(`[WorkflowExecutor] _updateWorkflowStatus(${finalStatus}) rate-limited (429) — giữ status local, sync sau`);
            if (this.currentWorkflow) this.currentWorkflow.status = finalStatus;
          } else {
            throw statusErr; // Non-429: throw để catch chính xử lý workflow error
          }
        }
        emitLog( {
          message: (finalStatus === 'completed' || finalStatus === 'warning')
            ? `Workflow "${workflow.wf_name}" hoàn thành${finalStatus === 'warning' ? ' (có cảnh báo — bỏ qua node)' : ''}! (${completed}/${total} nodes)`
            : `Workflow "${workflow.wf_name}" đã dừng (${completed}/${total} nodes)`,
          type: finalStatus === 'completed' ? 'success' : 'warn'
        });

        // Báo TÓM TẮT thân thiện nếu có node bị bỏ qua vì node nguồn chưa có ảnh/kết quả
        // (thay vì để từng dòng DEP_SKIP kỹ thuật ở trang "Lỗi" — user chỉ cần biết cần nạp input).
        if (this._skippedInputNodes && this._skippedInputNodes.length) {
          const _names = [...new Set(this._skippedInputNodes)];
          const _shown = _names.slice(0, 3).join(', ') + (_names.length > 3 ? `, +${_names.length - 3}` : '');
          this._showWorkflowToast(`Đã bỏ qua ${_names.length} node (${_shown}) vì node nguồn chưa có ảnh/kết quả. Nạp ảnh vào node input rồi chạy lại.`, 'warning', 8000);
          this._skippedInputNodes = [];
        }

        // SP-2.5: ExecutionGate complete - gọi TRƯỚC khi broadcast events
        // Đảm bảo server xác nhận hoàn thành trước khi các listeners nhận được sự kiện
        // [Audit Bug 5 fix 2026-06-22] Pass successful_count khi partial để backend
        // refund đúng global quota (prompt_submit_max). Trước fix: backend ExecutionService.php:394
        // chỉ refund khi isset($resultData['successful_count']) → user stop giữa chừng → 0 refund.
        if (window.ExecutionGate && this._currentExecutionToken) {
          try {
            const finalStatus = this.shouldStop ? 'partial' : 'success';
            const resultData = {};
            if (finalStatus === 'partial' && this._workflowSuccessCounts) {
              resultData.successful_count = this._workflowSuccessCounts.total || 0;
            }
            await ExecutionGate.complete(this._currentExecutionToken, finalStatus, resultData);
          } catch (err) {
            console.error('[WorkflowExecutor] ExecutionGate.complete failed:', err);
          }
          this._currentExecutionToken = null;
        }

        // Track usage: per-provider quotas + global prompt_submit_max + workflow_run
        // Bug 1 fix (workflow path 2026-05-17): dùng ACTUAL success counts thay vì plan counts.
        // Khi user stop giữa chừng (vd: stop sau ChatGPT node thành công, trước generate node),
        // actual.total < plan.total → record đúng số thực tế thay vì over-count plan.
        if (window.featureGate && this._workflowPromptCounts) {
          const counts = this._workflowSuccessCounts || this._workflowPromptCounts;
          // Track workflow_run_max: 1 per workflow execution (BUG FIX: was missing)
          window.featureGate.recordWorkflowRun();
          // Track per-provider quota
          if (counts.flow > 0) window.featureGate.recordGenRun();
          if (counts.chatgpt > 0) window.featureGate.recordChatGPTRun(counts.chatgpt);
          if (counts.grok > 0) window.featureGate.recordGrokRun(counts.grok);
          // Track global prompt_submit_max
          if (counts.total > 0) window.featureGate.recordPromptSubmit(counts.total, 'workflow');
          // BUG FIX: Track *_prompt_total for UsageSync analytics (was missing)
          if (counts.flow > 0) window.featureGate._incrementDailyStat('flow_prompt_total', counts.flow);
          if (counts.chatgpt > 0) window.featureGate._incrementDailyStat('chatgpt_prompt_total', counts.chatgpt);
          if (counts.grok > 0) window.featureGate._incrementDailyStat('grok_prompt_total', counts.grok);
          this._workflowPromptCounts = null;
          this._workflowSuccessCounts = null;
        }

        // Phase CG-8b: Reset ProviderTabLock sau khi workflow xong
        try { window.ProviderTabLock?.reset(); } catch (e) { /* ignore */ }

        // Broadcast events SAU khi server đã xác nhận
        window.eventBus.emit('execution:completed', {
          workflow: this.currentWorkflow,
          stopped: this.shouldStop,
          warning: _hadSkips
        });
        broadcastEvent('execution:completed', { stopped: this.shouldStop, warning: _hadSkips });

        // UA-3.4: Theo dõi hoàn thành workflow
        window.UsageSync?.trackEvent('workflow_complete', { workflow_id: workflow.wf_id, success: !this.shouldStop });

        // Emit workflow:complete for NotificationManager (only if not stopped)
        if (!this.shouldStop) {
          window.eventBus.emit('workflow:complete', {
            workflowId: workflow.wf_id,
            workflowName: workflow.wf_name,
            completedCount: completed,
            totalCount: total
          });
        }

        // Tracker broadcast completed (cross-window) — skip khi pipeline ON
        if (window.ExecutionLock && !(window.PromptQueue?.isEnabled?.())) {
          ExecutionLock.broadcastTracker({
            owner: 'workflow', phase: 'completed',
            current: completed, total
          });
        }

        // [Phase 2] Thông báo hoàn tất đi QUA MỘT nguồn duy nhất: event `workflow:complete` →
        // NotificationManager (i18n + webhook + telegram, đã emit ở trên). Gỡ notifyCompletion()
        // (Web Notification content-script) — trùng path, dễ gây noti kép nếu cả 2 cùng reachable.

        // Phase 2b: Track success for server tracking
        this._executionSuccess = true;
        this._completedNodesCount = completed;
        this._executionSummary = { completed_count: completed, total_count: total };

        log('Workflow execution finished');
        return true;

      } catch (error) {
        // Critical error path — LUÔN console.error (không qua log() vì DEBUG=false sẽ suppress).
        // Show full stack + error.code/details để dev/user debug được root cause.
        console.error('[WorkflowExecutor] Workflow execution error:', {
          message: error?.message,
          name: error?.name,
          code: error?.code,
          httpStatus: error?.httpStatus,
          exception: error?.exception,
          details: error?.details,
          stack: error?.stack,
        });
        // emitLog tới sidebar UI panel để user thấy error.
        // Nếu CHÍNH việc báo lỗi cũng lỗi thì user mất luôn thông báo → phải còn dấu vết ở console.
        try { emitLog({ message: `❌ Workflow execution error: ${error?.message || 'unknown'}`, type: 'error' }); }
        catch (logErr) { console.error('[WorkflowExecutor] emitLog thất bại, lỗi gốc:', error?.message, '| lỗi khi log:', logErr?.message); }
        // [API SPAM FIX — Phase 5] Flush partial state để không mất progress đã có
        try { await this._flushNodeStateBuffer(); } catch (e) { /* ignore flush error */ }
        // SP-2.5: ExecutionGate complete (failed) - gọi TRƯỚC khi broadcast events
        if (window.ExecutionGate && this._currentExecutionToken) {
          try {
            await ExecutionGate.complete(this._currentExecutionToken, 'failed', { error: error.message });
          } catch (err) {
            console.error('[WorkflowExecutor] ExecutionGate.complete failed:', err);
          }
          this._currentExecutionToken = null;
        }
        // Tracker broadcast error (cross-window) — skip khi pipeline ON
        if (window.ExecutionLock && !(window.PromptQueue?.isEnabled?.())) {
          ExecutionLock.broadcastTracker({
            owner: 'workflow', phase: 'error'
          });
        }
        // M10 fix: guard _updateWorkflowStatus('error') like the success path (~1750).
        // Trước fix: nếu saveWorkflow throw (vd 429 khi lưu status), catch abort TRƯỚC khi emit
        // 'execution:completed' (~1897) → sidebar kẹt "running". Nuốt lỗi save để đảm bảo completion emit.
        try {
          await this._updateWorkflowStatus('error');
        } catch (statusErr) {
          console.warn('[WorkflowExecutor] _updateWorkflowStatus(error) failed (non-blocking):', statusErr?.message || statusErr);
        }
        // UA-3.4: Theo dõi workflow thất bại.
        // Bug fix: `let workflow` declared trong try block (line 626) — scope-bound, KHÔNG visible
        // trong catch. Dùng `workflowId` (function param) hoặc `this.currentWorkflow` (đã set ở
        // line 627). Trước fix: ReferenceError: workflow is not defined → crash error handler.
        window.UsageSync?.trackEvent('workflow_complete', {
          workflow_id: this.currentWorkflow?.wf_id || workflowId,
          success: false,
        });
        // Phase 2b: Track failure for server tracking
        this._executionSuccess = false;
        this._executionSummary = { error: error.message };

        // Broadcast events SAU khi server đã xác nhận
        window.eventBus.emit('execution:completed', {
          workflow: this.currentWorkflow,
          error
        });
        broadcastEvent('execution:completed', { error: { message: error.message } });
        return false;

      } finally {
        this.isRunning = false;
        this.currentWorkflow = null;
        this.currentNode = null;
        this._manualSubmitMode = false; // Phase 5: reset manual mode sau mỗi run (caller set lại trước run kế)
        // [API SPAM FIX — Phase 5] Clear buffering mode + buffer (đã flush trước đó)
        this._executionInProgress = false;
        this._nodeStateBuffer.clear();
        // M15 fix: clear per-node accumulator map (never cleared before → grows unbounded across runs).
        if (this._nodeAccumMap) this._nodeAccumMap.clear();
        // [P2.7 Kênh 2] Reset live node states giữa các lần chạy.
        this._nodeStatesLive = {};
        this._nodeStatesDirty = false;
        // [API SPAM FIX — Phase 5.10] Stop checkpoint + clear storage (đã flush thành công)
        this._stopBufferCheckpoint();
        this._clearBufferCheckpoint(workflowId);
        if (window.ExecutionLock) ExecutionLock.release('workflow');
        // Fix flicker zoom 2026-06-22: end zoom session sau khi CẢ workflow xong (mọi node) → restore
        // zoom 1 lần. Idempotent. _executeSingleNode arm per-node (idempotent no-op) → end 1 lần ở đây.
        if (window.MessageBridge) window.MessageBridge.sendToContentScript('endFlowZoomSession', { force: true }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#execute', _e); });
        // Phase CG-8b: Reset ProviderTabLock (clear tất cả locks + currentActiveTab)
        try { window.ProviderTabLock?.reset(); } catch (e) { /* ignore */ }
        // Unsuppress auto-reload khi workflow kết thúc
        if (window.PromptQueue?.isEnabled?.()) {
          try { PromptQueue.getInstance().unsuppressReload(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#execute', e); }
        }
        // WS-6: Clear running state for cross-window sync
        // Gap 1 fix: clear chỉ khi match wfId (tránh stomp claim của context khác sau crash recovery)
        // Gap 2 fix: stop heartbeat NGAY trước clear flag (tránh race pulse → re-set flag sau clear)
        this._stopHeartbeat();
        await clearRunningFlag(workflowId);

        // Phase 2b: Complete server-side execution tracking
        // Determine final status based on execution result
        const finalStatus = this.shouldStop ? 'stopped' : (this._executionSuccess ? 'completed' : 'failed');
        completeServerTracking(finalStatus, this._executionSummary || null, this._completedNodesCount || 0);
      }
    }

    /**
     * Chạy 1 node riêng lẻ (manual re-run)
     */
    async executeSingleNode(workflowId, nodeId, opts = {}) {
      this._ensureFlowCaptchaListener();
      if (this.isRunning) {
        throw new Error('Đang có workflow khác đang chạy');
      }

      // Gap 1 fix: atomic claim cross-context flag NGAY (cũ chỉ check, không set
      // → race 2 contexts cùng pass check). Comment cũ ("set our running flag immediately")
      // không khớp với implementation cũ — giờ implement đúng.
      const isPopupCtxEarly = window.location?.pathname?.includes('workflow-editor') ||
                              window.location?.pathname?.includes('popup');
      const claim = await claimRunningFlag(workflowId, null, isPopupCtxEarly ? 'popup' : 'sidebar');
      if (!claim.ok) {
        const err = new Error(`"${claim.runningWfName}" đang chạy ở cửa sổ khác`);
        err.code = 'CROSS_CONTEXT_RUNNING';
        throw err;
      }

      try {
        // Gap 2 fix: start heartbeat trong try (đảm bảo finally _stopHeartbeat bao
        // phủ mọi exception path). Single node thường nhanh nhưng retry/timeout có
        // thể đẩy duration > 5 phút TTL → cần heartbeat.
        this._startHeartbeat(workflowId);
        this.isRunning = true;
        this.shouldStop = false;
        this._skippedInputNodes = []; // gom node bị bỏ qua do thiếu input → báo tóm tắt cuối run
        // Phase 5 (Manual Submit): set từ PARAM opts trong try (xem execute() cho lý do chống leak).
        this._manualSubmitMode = opts?.manualSubmitMode === true;
        // Phase 5.2: per-node submitted tracking thay vì global _nodeSubmitted
        this._submittedNodes = new Set();
        this._currentExecutionToken = null;

        // Load workflow + node TRƯỚC ExecutionGate để tính prompt count chính xác
        let workflow;
        try {
          workflow = await window.storageManager.getWorkflow(workflowId);
        } catch (loadErr) {
          if (loadErr.code === 'CONNECTION_ERROR') {
            throw new Error(loadErr.message || 'Không thể tải workflow do lỗi kết nối');
          }
          throw loadErr;
        }
        if (!workflow) throw new Error('Workflow không tồn tại hoặc đã bị xóa');

        // Ensure nodes/edges are arrays (ApiStorage may not populate them)
        if (!Array.isArray(workflow.nodes)) workflow.nodes = [];
        if (!Array.isArray(workflow.edges)) workflow.edges = [];

        // Option A3: KHÔNG block single-node run của legacy workflow over-quota.
        // (Logic giống execute() — backend cho phép run, chỉ block save tăng count.)
        if (window.featureGate && workflow.nodes.length > 0) {
          try {
            const nodeQuota = window.featureGate.checkQuota('workflows_nodes_max');
            const limit = nodeQuota?.limit;
            if (limit !== 'unlimited' && limit !== '-1' && limit > 0 && workflow.nodes.length > limit) {
              console.info('[WorkflowExecutor] Single-run legacy workflow over-quota: ' +
                workflow.nodes.length + '/' + limit);
            }
          } catch (e) { /* ignore */ }
        }

        this.currentWorkflow = workflow;
        const node = workflow.nodes.find(n => n.node_id === nodeId);
        if (!node) throw new Error('Node not found');
        console.log('[WorkflowExecutor] executeSingleNode loaded node:', 'node_id=' + node.node_id, 'node_type=' + node.node_type, 'prompt_mode=' + (node.prompt_mode || 'all(default)'), 'ref_mode=' + (node.ref_mode || 'all(default)'));

        // Gap 1 fix: update wf_name vào running flag (claim ban đầu chỉ có wfId)
        await updateRunningFlagName(workflow.wf_id, workflow.wf_name);

        // GP-7.4: Tính promptCount dựa trên node type
        let promptCount = 0;
        if (node.node_type === 'generate') {
          promptCount = 1;
        } else if (node.node_type === 'chatgpt') {
          promptCount = 1;
        } else if (node.node_type === 'grok') {
          // Phase G-6: Grok node single-node run = 1 prompt submission
          promptCount = 1;
        }
        // Các node khác (download, delay, telegram) không submit prompt → promptCount = 0
        // Nhưng vẫn cần tính ít nhất 1 để server track workflow_run quota
        if (promptCount === 0) promptCount = 1;

        // Acquire ExecutionLock
        if (window.ExecutionLock) ExecutionLock.acquire('workflow', '');

        // SP: ExecutionGate - track single node run on server
        // GP-7.4: Truyền promptCount chính xác thay vì hardcode 1
        if (window.ExecutionGate) {
          try {
            const gate = await ExecutionGate.request('workflow_run', promptCount, { owner: 'workflow', label: `single_node:${nodeId}` });
            if (!gate.allowed) {
              ExecutionGate.showDeniedDialog(gate, 'Workflow');
              this.isRunning = false;
              if (window.ExecutionLock) ExecutionLock.release('workflow');
              throw new Error(gate.reason === 'QUOTA_EXCEEDED' ? 'Đã hết lượt chạy Workflow hôm nay' : 'Không được phép chạy Workflow');
            }
            this._currentExecutionToken = gate.token;
            console.log('[WorkflowExecutor] executeSingleNode ExecutionGate token:', gate.token, 'promptCount:', promptCount);
          } catch (e) {
            if (window.QuotaErrorHandler?.isQuotaError(e)) {
              this.isRunning = false;
              if (window.ExecutionLock) ExecutionLock.release('workflow');
              throw e;
            }
            // [Audit Bug 9 fix 2026-06-22] Server-Only: abort thay vì proceed without token.
            console.error('[WorkflowExecutor] executeSingleNode ExecutionGate failed, ABORTING (Server-Only):', e.message);
            this.isRunning = false;
            if (window.ExecutionLock) ExecutionLock.release('workflow');
            throw new Error(`Không thể xin phép server chạy node: ${e.message || 'unknown'}. Vui lòng kiểm tra kết nối và thử lại.`);
          }
        }

        this.currentNode = node;
        updateCurrentNode(workflow.wf_id, node.node_id);
        if (window.ExecutionLock) ExecutionLock.acquire('workflow', `Node: ${node.node_name}`);
        log(`Running single node: "${node.node_name}"`);

        // Tracker broadcast (cross-window) — skip khi pipeline ON
        if (window.ExecutionLock && !(window.PromptQueue?.isEnabled?.())) {
          ExecutionLock.broadcastTracker({
            owner: 'workflow', label: `Node: ${node.node_name}`,
            phase: 'started', current: 0, total: 1,
            promptText: node.prompt?.substring(0, 60) || node.node_name
          });
        }

        // Emit execution:started so UI can toggle play→stop, disable form
        window.eventBus.emit('execution:started', { workflow, singleNode: true });
        broadcastEvent('execution:started', { workflow: { wf_id: workflow.wf_id, wf_name: workflow.wf_name }, singleNode: true });

        // Emit events
        window.eventBus.emit('node:started', { node });
        broadcastEvent('node:started', { node: { node_id: node.node_id, node_name: node.node_name } });
        await this._updateNodeStatus(node.node_id, 'running');

        // Fix flicker zoom 2026-06-22: arm zoom session 0.3 TRƯỚC ref-scan/reupload (nằm trong _executeNode).
        // PHẢI AWAIT — nếu fire-and-forget, reupload scan chạy trước khi armed → vẫn multi-pass + restore
        // per-call (flicker). Await → session armed trước, mọi ensureFlowTilesLoaded in-session 0.3, restore
        // 1 lần ở finally (refcount). Chỉ generate (Flow); chatgpt/grok không zoom Flow.
        if (node.node_type === 'generate' && window.MessageBridge) {
          try { await window.MessageBridge.sendToContentScript('beginFlowZoomSession', { factor: 0.3, hold: true }); } catch (e) { /* non-blocking */ }
        }

        const result = await this._executeNode(node, workflow);

        // Bug 52 fix: Generate nodes (generate/chatgpt/grok) trả về 0 files = FAIL, không phải "completed"
        const genProducingTypes = ['generate', 'chatgpt', 'grok'];
        if (genProducingTypes.includes(node.node_type) && (!result.fileIds || result.fileIds.length === 0)) {
          // Manual mode Option C: user Skip → node 'skipped' (không fail/throw/log/notify).
          if (result?._userSkipped === true) {
            const reason = window.I18n?.t?.('workflow.userSkippedNode') || 'User bỏ qua submit thủ công';
            console.log('[WorkflowExecutor] executeSingleNode SKIPPED (manual):', node.node_id, reason);
            await this._updateNodeStatus(node.node_id, 'skipped', null, reason);
            window.eventBus?.emit('node:warning', { node, message: reason });
            return;
          }
          throw new Error('Tất cả gen đều thất bại (0 kết quả)');
        }

        // Persist thumbnails + file_names trên node object TRƯỚC khi gọi _updateNodeStatus
        // để có thể forward qua PATCH endpoint (bug fix ChatGPT/Grok synthetic IDs).
        if (result.thumbnails && Object.keys(result.thumbnails).length > 0) {
          node.result_thumbnails = { ...(node.result_thumbnails || {}), ...result.thumbnails };
        }
        if (result.fileNames && Object.keys(result.fileNames).length > 0) {
          node.result_file_names = { ...(node.result_file_names || {}), ...result.fileNames };
        }
        // Port 1.1.58 VIDEO_NODE_LAST_FRAME: node video → trích frame cuối + upload Flow (nếu có
        // downstream edge port `frame`) → set result_frame_* trước khi persist. Gated, best-effort.
        await this._maybeExtractLastFrame(node, result, this.currentWorkflow);
        await this._updateNodeStatus(node.node_id, 'completed', result.fileIds, null, {
          result_thumbnails: node.result_thumbnails,
          result_file_names: node.result_file_names,
          result_frame_file_ids: node.result_frame_file_ids, // Port 1.1.58: persist frame cuối
          result_frame_thumbnails: node.result_frame_thumbnails,
          // Dual URL — provider URL gốc cho manual download chất lượng 100%
          result_provider_urls: node.result_provider_urls,
          // Phase CG-8 — Prompt node text output (mọi node khác result_text=undefined → bỏ qua)
          result_text: node.result_text,
          result_source: node.result_source,
        });
        window.eventBus.emit('node:completed', { node, result });
        broadcastEvent('node:completed', { node: { node_id: node.node_id, node_name: node.node_name }, result: { fileIds: result.fileIds, duration: result.duration, thumbnails: result.thumbnails } });

        // Run single node: emit prompt:completed → GenerationHistory lưu record (admin/generations).
        // Mirror _executeSingleNode (full-workflow path) — executeSingleNode trước đây KHÔNG emit → mất record.
        const promptProducingTypes = ['generate', 'chatgpt', 'grok'];
        if (promptProducingTypes.includes(node.node_type) && (result.fileIds?.length > 0)) {
          const nodeProvider = node.node_type === 'chatgpt' ? 'chatgpt'
            : node.node_type === 'grok' ? 'grok'
            : 'flow';
          const isVideoNode = node.media_type === 'Video' ||
            (node.node_type === 'grok' && node.grok_mode === 'video');
          const wfThumbs = (result.fileIds || []).map(fid => {
            const t = result.thumbnails?.[fid];
            if (!t) return null;
            return {
              thumbnail: typeof t === 'string' ? t : t.thumbnail,
              type: typeof t === 'object' && t.type ? t.type : (isVideoNode ? 'video' : 'image'),
              file_name: typeof t === 'object' ? (t.file_name || '') : '',
            };
          }).filter(Boolean);
          window.eventBus.emit('prompt:completed', {
            prompt: node.prompt || '',
            media_type: isVideoNode ? 'Video' : (node.media_type || 'image'),
            // Grok không dùng Flow model — node.model có thể là model Flow leaked (legacy/export chưa
            // heal) → record 'grok' thay vì "nanobanana". Chatgpt/Flow giữ node.model (đúng model).
            model: nodeProvider === 'grok' ? nodeProvider : (node.model || nodeProvider),
            ratio: node.ratio || '',
            prompt_count: 1,
            quantity: parseInt(node.quantity) || 1,
            ref_file_ids: (Array.isArray(result.refFileIdsUsed) && result.refFileIdsUsed.length)
              ? result.refFileIdsUsed.join(', ')
              : (node.ref_file_ids || ''),
            result_file_ids: (result.fileIds || []).join(', '),
            result_thumbnails: wfThumbs,
            result_file_names: result.fileNames || node.result_file_names || {},
            source: 'workflow',
            source_id: workflow?.wf_id || '',
            provider: nodeProvider,
            project_id: workflow?.project_id || null,
            auto_download: !!node.auto_download,
            // Phase 5: manual submit CHỈ áp cho generate (Flow) node; chatgpt/grok luôn auto.
            submit_mode: (node.node_type === 'generate' && this._manualSubmitMode === true) ? 'manual' : 'auto',
          });
        }

        // Auto-download — CHỈ khi pipeline mode OFF + có quyền auto_download
        // Khi pipeline ON, PromptQueue._onTilesReady() đã xử lý download rồi.
        // Bug fix: ChatGPT/Grok image node TỰ XỬ LÝ download nội bộ (fetch CDN URL trước khi
        // bridge sang Flow vì signature TTL ngắn). Skip outer download để tránh DOUBLE download.
        const isPipelineNode = window.PromptQueue?.isEnabled() &&
          (node.node_type === 'generate');
        const isExternalProviderNode = node.node_type === 'chatgpt' || node.node_type === 'grok';
        const canUseAutoDownload = window.featureGate?.canUse('auto_download') ?? false;
        if (canUseAutoDownload && node.auto_download && result.fileIds?.length > 0 && !isPipelineNode && !isExternalProviderNode) {
          // Video download resolution: 720p/1080p (vs image 1k/2k)
          // Detect Grok video qua grok_mode (Grok không có media_type field)
          const isVideo = node.media_type === 'Video' ||
            (node.node_type === 'grok' && node.grok_mode === 'video');
          const res = isVideo
            ? (node.video_download_resolution || (globalThis.DownloadPrefs?.DEFAULTS.video || '720p'))
            : (node.download_resolution || (globalThis.DownloadPrefs?.DEFAULTS.image || '1k'));
          // Bug fix: truyền workflow name làm subfolder để download theo cấu trúc folder setting
          const taskName = node.download_folder || workflow?.wf_name || this.currentWorkflow?.wf_name || null;
          await this._downloadTiles(result.fileIds, node.prompt || node.node_name, res, result.fileNames, taskName);
        }

        log(`Single node "${node.node_name}" completed`);

        // SP: ExecutionGate complete (success) - gọi TRƯỚC khi broadcast events
        // Đảm bảo server xác nhận hoàn thành trước khi các listeners nhận được sự kiện
        if (window.ExecutionGate && this._currentExecutionToken) {
          try {
            await ExecutionGate.complete(this._currentExecutionToken, 'success');
          } catch (err) {
            console.error('[WorkflowExecutor] ExecutionGate.complete failed:', err);
          }
          this._currentExecutionToken = null;
        }

        // Track usage for single node execution (BUG FIX: was missing)
        if (window.featureGate) {
          window.featureGate.recordWorkflowRun();
          if (node.node_type === 'generate') {
            window.featureGate.recordGenRun();
            window.featureGate.recordPromptSubmit(1, 'workflow');
            window.featureGate._incrementDailyStat('flow_prompt_total', 1);
          } else if (node.node_type === 'chatgpt') {
            window.featureGate.recordChatGPTRun(1);
            window.featureGate.recordPromptSubmit(1, 'workflow');
            window.featureGate._incrementDailyStat('chatgpt_prompt_total', 1);
          } else if (node.node_type === 'grok') {
            window.featureGate.recordGrokRun(1);
            window.featureGate.recordPromptSubmit(1, 'workflow');
            window.featureGate._incrementDailyStat('grok_prompt_total', 1);
          }
        }

        // Tracker broadcast completed (cross-window) — skip khi pipeline ON
        if (window.ExecutionLock && !(window.PromptQueue?.isEnabled?.())) {
          ExecutionLock.broadcastTracker({
            owner: 'workflow', phase: 'completed', current: 1, total: 1
          });
        }

        // Emit execution:completed SAU khi server đã xác nhận
        window.eventBus.emit('execution:completed', { workflow, singleNode: true });
        broadcastEvent('execution:completed', { singleNode: true });

        return result;

      } catch (error) {
        // Critical error — luôn console.error (không qua log() vì DEBUG=false suppress).
        console.error('[WorkflowExecutor] Single node execution failed:', {
          message: error?.message,
          name: error?.name,
          code: error?.code,
          stack: error?.stack,
        });

        // SP: ExecutionGate complete (failed) - gọi TRƯỚC khi broadcast events
        // Rollback quota và đảm bảo server xác nhận trước khi các listeners nhận được sự kiện
        if (window.ExecutionGate && this._currentExecutionToken) {
          try {
            await ExecutionGate.complete(this._currentExecutionToken, 'failed');
          } catch (err) {
            console.error('[WorkflowExecutor] ExecutionGate.complete failed:', err);
          }
          this._currentExecutionToken = null;
        }

        // Tracker broadcast error (cross-window) — skip khi pipeline ON
        if (window.ExecutionLock && !(window.PromptQueue?.isEnabled?.())) {
          ExecutionLock.broadcastTracker({
            owner: 'workflow', phase: 'error'
          });
        }
        if (this.currentNode) {
          await this._updateNodeStatus(this.currentNode.node_id, 'failed', null, error.message);
          window.eventBus.emit('node:failed', { node: this.currentNode, error });
          broadcastEvent('node:failed', { node: { node_id: this.currentNode.node_id, node_name: this.currentNode.node_name }, error: { message: error.message } });
          // Safety net: gen node fail (kể cả case return 0 file không throw qua onFail) → báo user
          // rõ provider fail + kiểm tra tab. Dedup (_genFailNotified) tránh double với onFail.
          if (['generate', 'chatgpt', 'grok'].includes(this.currentNode.node_type)) {
            this._notifyGenFailed(this.currentNode);
            // Log FAIL vào GenerationHistory (admin/generations) — outer catch. Dedup với inner catch.
            if (!this.currentNode._genFailLogged) {
              this.currentNode._genFailLogged = true;
              const _n = this.currentNode;
              const _fp = _n.node_type === 'chatgpt' ? 'chatgpt' : _n.node_type === 'grok' ? 'grok' : 'flow';
              const _iv = _n.media_type === 'Video' || (_n.node_type === 'grok' && _n.grok_mode === 'video');
              window.eventBus?.emit?.('prompt:completed', {
                prompt: _n.prompt || '',
                media_type: _iv ? 'Video' : (_n.media_type || 'image'),
                model: _fp === 'grok' ? _fp : (_n.model || _fp),
                ratio: _n.ratio || '', prompt_count: 1, quantity: parseInt(_n.quantity) || 1,
                ref_file_ids: _n.ref_file_ids || '', result_file_ids: '', result_thumbnails: [],
                source: 'workflow', source_id: this.currentWorkflow?.wf_id || '', provider: _fp,
                status: 'failed', error_reason: error?.message || 'Gen thất bại',
                project_id: this.currentWorkflow?.project_id || null, auto_download: !!_n.auto_download,
                // Phase 5: manual submit CHỈ áp generate (Flow); chatgpt/grok luôn auto.
                submit_mode: (_n.node_type === 'generate' && this._manualSubmitMode === true) ? 'manual' : 'auto',
              });
            }
          }
        }
        // Emit execution:completed with error SAU khi server đã xác nhận
        window.eventBus.emit('execution:completed', {
          workflow: this.currentWorkflow,
          singleNode: true,
          error
        });
        broadcastEvent('execution:completed', { singleNode: true, error: { message: error.message } });

        throw error;

      } finally {
        this.isRunning = false;
        this.currentWorkflow = null;
        this.currentNode = null;
        this._manualSubmitMode = false; // Phase 5: reset manual mode sau single-node run
        if (window.ExecutionLock) ExecutionLock.release('workflow');
        // Gap 1 fix: clear cross-context flag (executeSingleNode trước đây không clear → flag stuck)
        // Gap 2 fix: stop heartbeat trước khi clear flag
        this._stopHeartbeat();
        await clearRunningFlag(workflowId);
        // Fix flicker zoom 2026-06-22: end zoom session (restore zoom 1 lần) — backstop dù PromptQueue
        // _checkAllDone có fire hay không. Idempotent (no-op nếu không có session).
        if (window.MessageBridge) window.MessageBridge.sendToContentScript('endFlowZoomSession', { force: true }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#stop', _e); });
      }
    }

    /**
     * Dừng workflow đang chạy
     * @param {boolean} broadcast - Broadcast stop event to other contexts (default: true)
     */
    stop(broadcast = true) {
      if (this.isRunning) {
        log('Stopping workflow...');
        this.shouldStop = true;

        // Fix flicker zoom 2026-06-22: force-stop → restore zoom NGAY (force=true bỏ qua refcount; tile đã
        // submit thì không cần zoom để scan nữa). Sau đó các end (PQ/finally) = no-op vì session đã null.
        if (window.MessageBridge) window.MessageBridge.sendToContentScript('endFlowZoomSession', { force: true }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#stop', _e); });

        // SP-2.8: ExecutionGate cancel on workflow stop
        if (window.ExecutionGate && this._currentExecutionToken) {
          ExecutionGate.cancel(this._currentExecutionToken);
          this._currentExecutionToken = null;
        }

        // Pipeline mode: stop jobs by owner 'workflow'
        if (window.PromptQueue && PromptQueue.isEnabled()) {
          const queue = PromptQueue.getInstance();
          const wfJobs = queue.getJobsByOwner('workflow') || [];
          for (const job of wfJobs) {
            queue.stopJob(job.id);
          }
        }

        // Phase 5.2: Check per-node submitted tracking
        const hasSubmittedNodes = this._submittedNodes && this._submittedNodes.size > 0;
        if (hasSubmittedNodes) {
          // Đã có node submit prompt → chờ tile xong rồi dừng
          // KHÔNG gửi stopExecution để content.js waitForNewTiles tiếp tục chờ tile
          log(`${this._submittedNodes.size} node(s) đã submit, sẽ chờ kết quả trước khi dừng...`);
        } else {
          // Chưa submit → dừng ngay
          log('Chưa có node nào submit, dừng ngay...');
          // Gửi stopExecution để break content.js runAutoPrompt/insertText
          if (window.MessageBridge) {
            window.MessageBridge.stopExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#stop', _e); });
          }
        }

        // Abort Grok session nếu đang chạy
        if (window.GrokSession?.getTabInfo) {
          window.GrokSession.getTabInfo().then(grokInfo => {
            if (grokInfo?.tabId) {
              window.MessageBridge?.grokAbort(grokInfo.tabId).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#stop', _e); });
            }
          }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#stop', _e); });
        }

        // Abort ChatGPT session nếu đang chạy
        if (window.ChatGPTSession?.getTabInfo) {
          window.ChatGPTSession.getTabInfo().then(chatgptInfo => {
            if (chatgptInfo?.tabId) {
              window.MessageBridge?.chatgptAbort(chatgptInfo.tabId).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#stop', _e); });
            }
          }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#stop', _e); });
        }

        // Broadcast stop to other contexts (popup ↔ sidePanel)
        if (broadcast) {
          broadcastEvent('execution:stop', { wf_id: this.currentWorkflow?.wf_id });
        }

        // Local signal (thống nhất với PromptQueue.stopAll): mọi đường stop workflow đều phát.
        // → McpExecutor._wasStopped bắt được khi workflow do MCP run_workflow chạy bị user/cancel dừng
        //   → agent nhận CANCELLED thay vì GEN_FAILED. Listener khác chỉ hide UI (idempotent).
        window.eventBus?.emit('execution:force_stopped');
      }
    }

    /**
     * Handle stop broadcast from other context
     * Called when another context (popup/sidebar) stops the workflow
     */
    handleRemoteStop() {
      if (this.isRunning || this._runningOtherWfId) {
        log('Remote stop received, stopping local execution...');
        this.shouldStop = true;
        // CRITICAL FIX: Chỉ clear state cho remote workflow (chạy ở context khác)
        // Nếu local đang chạy (isRunning=true), để main execute() loop tự cleanup
        // Trước fix: clear currentWorkflow ngay → _updateWorkflowStatus skip → server không update status
        if (this._runningOtherWfId && !this.isRunning) {
          const stoppedWfId = this._runningOtherWfId;
          this._runningOtherWfId = null;
          this.currentWorkflow = null;
          // M13 fix: clear af_running_workflow ONLY if it still matches the wf we were tracking.
          // Unconditional remove could stomp a flag another context just claimed for a different wf
          // → 2 workflows run concurrently. clearRunningFlag(wfId) matches wf_id like clearRunningFlag.
          try {
            clearRunningFlag(stoppedWfId);
          } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#handleRemoteStop', e); }
        }
        // Nếu local đang chạy, chỉ set shouldStop - finally block sẽ cleanup
      }
    }

    /**
     * Reset workflow - đưa tất cả nodes về pending
     */
    async reset(workflowId) {
      log('Resetting workflow:', workflowId);
      await window.storageManager.resetWorkflow(workflowId);
      // Gap 8 fix: reset() từ caller (vd WorkflowTab "Chạy lại") trước đây không clear
      // af_running_workflow → nếu flag stuck (vd context cũ crash) thì reset xong vẫn
      // không thể chạy lại. Clear unconditional vì user đã consent reset.
      await clearRunningFlag(workflowId);
      window.eventBus.emit('workflow:reset', { workflowId });
      // Broadcast to other contexts (popup ↔ sidePanel sync)
      broadcastEvent('workflow:reset', { workflowId });
    }

    /**
     * Execute a single node with full error handling and events
     */
    async _executeSingleNode(node, workflow, completed, total) {
      this.currentNode = node;

      // Check dependencies
      const depCheck = this._checkDependencies(node, workflow.nodes, workflow.edges);
      if (!depCheck.ok) {
        // DEP_SKIP = node nguồn chưa có kết quả (thường do thiếu ảnh input) — KHÔNG phải bug extension.
        // Hạ console.debug (không đổ trang "Lỗi") + gom lại để báo TÓM TẮT thân thiện cuối run.
        console.debug(`[WorkflowExecutor] DEP_SKIP: "${node.node_name}" (${node.node_type}) → ${depCheck.reason}`);
        if (!this._skippedInputNodes) this._skippedInputNodes = [];
        this._skippedInputNodes.push(node.node_name);
        log('Skipping node (dependency failed):', node.node_name, depCheck.reason);
        // Thêm emitLog để user thấy node bị skip do dependency fail
        emitLog({
          nodeId: node.node_id,
          message: `Bỏ qua "${node.node_name}" (dependency lỗi: ${depCheck.reason})`,
          type: 'warn'
        });
        await this._updateNodeStatus(node.node_id, 'skipped');
        window.eventBus.emit('node:warning', { node, message: depCheck.reason });
        return;
      }

      try {
        emitLog( {
          nodeId: node.node_id,
          message: `--- Bắt đầu node [${completed + 1}/${total}]: "${node.node_name}" ---`,
          type: 'info'
        });
        window.eventBus.emit('node:started', { node });
        broadcastEvent('node:started', { node: { node_id: node.node_id, node_name: node.node_name } });
        await this._updateNodeStatus(node.node_id, 'running');

        // Zoom session: KHÔNG arm per-node (full workflow) — execute() đã arm 1 lần ở đầu run (refcount
        // baseline), spanning mọi node → tránh restore giữa các node. Ref-prep mỗi node vẫn in-session 0.3.

        const result = await this._executeNode(node, workflow);

        // Bug 52 fix: Generate nodes (generate/chatgpt/grok) trả về 0 files = FAIL, không phải "completed"
        // Trước fix: Pipeline fail 2 lần → resultTileIds=[] → vẫn đánh dấu "completed" → UI báo 6/6 thành công
        const genProducingTypes = ['generate', 'chatgpt', 'grok'];
        if (genProducingTypes.includes(node.node_type) && (!result.fileIds || result.fileIds.length === 0)) {
          // Manual mode Option C: user Skip → node 'skipped' (không fail/throw/log/notify) → downstream bỏ qua.
          if (result?._userSkipped === true) {
            const reason = window.I18n?.t?.('workflow.userSkippedNode') || 'User bỏ qua submit thủ công';
            // Cascade flag: _checkDependencies đọc sourceNode từ currentWorkflow.nodes (ORIGINAL), còn
            // `node` ở đây là COPY từ _convertServerPlanToLevels (spread {...localNode}). _updateNodeStatus
            // chỉ write-back `status`, KHÔNG write flag → phải set _userSkipped trên ORIGINAL để downstream
            // check (:2945) thấy được. Set cả 2 cho chắc.
            node._userSkipped = true;
            const _origNode = this.currentWorkflow?.nodes?.find(n => n.node_id === node.node_id);
            if (_origNode) _origNode._userSkipped = true;
            emitLog({
              nodeId: node.node_id,
              message: `"${node.node_name}" SKIPPED: ${reason} → downstream nodes bỏ qua`,
              type: 'warn',
            });
            await this._updateNodeStatus(node.node_id, 'skipped', null, reason);
            window.eventBus.emit('node:warning', { node, message: reason });
            return;
          }
          throw new Error('Tất cả gen đều thất bại (0 kết quả)');
        }

        // 2026-05-31: Text Extract node với _extract_failed=true (marker không match) +
        // on_fail=skip_downstream → mark status='skipped' thay vì 'completed' để UI rõ ràng.
        // Trước: status='completed' nhưng downstream skip → user confuse "tại sao completed mà ko chạy tiếp".
        // Lý do extract fail xuất hiện trong emitLog (warn) đã có ở _handleExtractFail.
        if (node.node_type === 'text_extract' && result?._extract_failed === true) {
          const reason = result._extract_reason || 'marker không match';
          emitLog({
            nodeId: node.node_id,
            message: `Text Extract "${node.node_name}" SKIPPED: ${reason} → downstream nodes bỏ qua`,
            type: 'warn',
          });
          await this._updateNodeStatus(node.node_id, 'skipped', null, reason);
          window.eventBus.emit('node:warning', { node, message: reason });
          return;
        }

        // Persist thumbnails + file_names trên node object TRƯỚC khi gọi _updateNodeStatus
        // để forward qua PATCH endpoint. Bug fix ChatGPT/Grok image node: synthetic IDs
        // (cg_xxx, grok_xxx) không có thumbnail trong DOM Flow → reload workflow gallery trống.
        // Đồng thời downstream nodes (download, upscale) cần local data cho _buildFileNameLookup.
        if (result.thumbnails && Object.keys(result.thumbnails).length > 0) {
          node.result_thumbnails = { ...(node.result_thumbnails || {}), ...result.thumbnails };
        }
        if (result.fileNames && Object.keys(result.fileNames).length > 0) {
          node.result_file_names = { ...(node.result_file_names || {}), ...result.fileNames };
        }
        // Port 1.1.58 VIDEO_NODE_LAST_FRAME: node video → trích frame cuối + upload Flow (nếu có
        // downstream edge port `frame`) → set result_frame_* trước khi persist. Gated, best-effort.
        await this._maybeExtractLastFrame(node, result, this.currentWorkflow);
        await this._updateNodeStatus(node.node_id, 'completed', result.fileIds, null, {
          result_thumbnails: node.result_thumbnails,
          result_file_names: node.result_file_names,
          result_frame_file_ids: node.result_frame_file_ids, // Port 1.1.58: persist frame cuối
          result_frame_thumbnails: node.result_frame_thumbnails,
          // Dual URL — provider URL gốc cho manual download chất lượng 100%
          result_provider_urls: node.result_provider_urls,
          // Phase CG-8 — Prompt node text output
          result_text: node.result_text,
          result_source: node.result_source,
        });

        // Bug 1 fix (workflow path): increment actual success counters dựa vào node provider.
        // Match plan count logic ở line 684-701 (generate/chatgpt/grok/prompt-enhance).
        if (this._workflowSuccessCounts) {
          const succ = this._workflowSuccessCounts;
          if (node.node_type === 'generate') { succ.total++; succ.flow++; }
          else if (node.node_type === 'chatgpt') { succ.total++; succ.chatgpt++; }
          else if (node.node_type === 'grok') { succ.total++; succ.grok++; }
          // AI Agent rename (2026-05-30): AI Agent chỉ có 2 option: chatgpt/gemini (cả 2 → chatgpt bucket)
          else if (node.node_type === 'prompt' && node.use_ai === true) {
            succ.total++;
            succ.chatgpt++;
          }
        }

        window.eventBus.emit('node:completed', { node, result });
        broadcastEvent('node:completed', { node: { node_id: node.node_id, node_name: node.node_name }, result: { fileIds: result.fileIds, duration: result.duration, thumbnails: result.thumbnails } });

        // SS-Phase G (Layer 3 fix): Emit prompt:completed cho prompt-producing nodes →
        // GenerationHistory.saveRecord() lưu row với provider chính xác. Trước fix workflow
        // KHÔNG save history → analytics group by provider thiếu data từ workflow path.
        const promptProducingTypes = ['generate', 'chatgpt', 'grok'];
        if (promptProducingTypes.includes(node.node_type) && (result.fileIds?.length > 0)) {
          const nodeProvider = node.node_type === 'chatgpt' ? 'chatgpt'
            : node.node_type === 'grok' ? 'grok'
            : 'flow';
          const isVideoNode = node.media_type === 'Video' ||
            (node.node_type === 'grok' && node.grok_mode === 'video');
          const wfThumbs = (result.fileIds || []).map(fid => {
            const t = result.thumbnails?.[fid];
            if (!t) return null;
            return {
              thumbnail: typeof t === 'string' ? t : t.thumbnail,
              type: typeof t === 'object' && t.type ? t.type : (isVideoNode ? 'video' : 'image'),
              file_name: typeof t === 'object' ? (t.file_name || '') : '',
            };
          }).filter(Boolean);
          window.eventBus.emit('prompt:completed', {
            prompt: node.prompt || '',
            media_type: isVideoNode ? 'Video' : (node.media_type || 'image'),
            // Grok không dùng Flow model — node.model có thể là model Flow leaked (legacy/export chưa
            // heal) → record 'grok' thay vì "nanobanana". Chatgpt/Flow giữ node.model (đúng model).
            model: nodeProvider === 'grok' ? nodeProvider : (node.model || nodeProvider),
            ratio: node.ratio || '',
            // Phase Analytics-3: Mỗi workflow node = 1 prompt × node.quantity ảnh
            prompt_count: 1,
            quantity: parseInt(node.quantity) || 1,
            // ref_img: ưu tiên refs THỰC dùng (upstream + node pick, từ result.refFileIdsUsed) —
            // node.ref_file_ids rỗng khi node nhận ref từ upstream qua edge → admin log thiếu ref.
            ref_file_ids: (Array.isArray(result.refFileIdsUsed) && result.refFileIdsUsed.length)
              ? result.refFileIdsUsed.join(', ')
              : (node.ref_file_ids || ''),
            result_file_ids: (result.fileIds || []).join(', '),
            result_thumbnails: wfThumbs,
            result_file_names: result.fileNames || node.result_file_names || {},
            source: 'workflow',
            source_id: workflow?.wf_id || '',
            provider: nodeProvider,
            project_id: workflow?.project_id || null,
            auto_download: !!node.auto_download,
            // Phase 5: manual submit CHỈ áp cho generate (Flow) node; chatgpt/grok luôn auto.
            submit_mode: (node.node_type === 'generate' && this._manualSubmitMode === true) ? 'manual' : 'auto',
          });
        }

        emitLog( {
          nodeId: node.node_id,
          message: `"${node.node_name}" hoàn thành - ${result.fileIds?.length || 0} file, ${Math.round(result.duration / 1000)}s`,
          type: 'success'
        });

        // Auto-download — CHỈ khi pipeline mode OFF + có quyền auto_download
        // Khi pipeline ON, PromptQueue._onTilesReady() đã xử lý download rồi.
        // Bug fix: ChatGPT/Grok image node tự xử lý download nội bộ → skip outer để tránh DOUBLE.
        const isPipelineNode = window.PromptQueue?.isEnabled() &&
          (node.node_type === 'generate');
        const isExternalProviderNode = node.node_type === 'chatgpt' || node.node_type === 'grok';
        const canUseAutoDownload = window.featureGate?.canUse('auto_download') ?? false;
        if (canUseAutoDownload && node.auto_download && result.fileIds?.length > 0 && !isPipelineNode && !isExternalProviderNode) {
          // Video download resolution: 720p/1080p (vs image 1k/2k)
          // Grok không có media_type → check grok_mode
          const isVideo = node.media_type === 'Video' ||
            (node.node_type === 'grok' && node.grok_mode === 'video');
          const res = isVideo
            ? (node.video_download_resolution || (globalThis.DownloadPrefs?.DEFAULTS.video || '720p'))
            : (node.download_resolution || (globalThis.DownloadPrefs?.DEFAULTS.image || '1k'));
          // Bug fix: truyền workflow name làm subfolder để download theo cấu trúc folder setting
          const taskName = node.download_folder || workflow?.wf_name || this.currentWorkflow?.wf_name || null;
          emitLog( { nodeId: node.node_id, message: `Tải ${result.fileIds.length} file [${res.toUpperCase()}]...`, type: 'info' });
          await this._downloadTiles(result.fileIds, node.prompt || node.node_name, res, result.fileNames, taskName);
        }
      } catch (error) {
        // Phân loại: lỗi USER-ACTIONABLE (Flow chưa login, thiếu input, submit không thấy…) →
        // chỉ console.debug (KHÔNG đổ vào trang "Lỗi"); user đã được báo qua toast _notifyGenFailed.
        // Lỗi UNKNOWN (bug extension thật) → giữ console.error để hiện panel debug.
        const _uf = this._classifyRunError(error);
        const _emsg = error?.message || error?.name || String(error);
        if (_uf.user) {
          console.debug('[WorkflowExecutor] Node run issue (user-actionable):', node.node_name, '—', _emsg);
        } else {
          console.error('[WorkflowExecutor] Node failed:', node.node_name, '—', _emsg, error);
        }
        await this._updateNodeStatus(node.node_id, 'failed', null, error.message);
        window.eventBus.emit('node:failed', { node, error });
        broadcastEvent('node:failed', { node: { node_id: node.node_id, node_name: node.node_name }, error: { message: error.message } });
        // 2026-05-28: Notification gen-fail → _notifyGenFailed (rõ ràng: PROVIDER fail, không phải
        // extension + kiểm tra tab provider). NON-BLOCKING (toast, không cản trở workflow đang chạy),
        // context-aware (sidebar/editor), i18n, dedup (_genFailNotified — tránh double với onFail).
        // Chi tiết lý do vẫn ở execution log (emitLog dưới). Thay _notifyNodeError cũ (blocking modal).
        if (['generate', 'chatgpt', 'grok'].includes(node.node_type) && !node._genFailLogged) {
          node._genFailLogged = true; // dedup: inner catch re-throw (:2670) → outer catch cũng fire → tránh double record
          this._notifyGenFailed(node, null, error);
          // Log FAIL vào GenerationHistory (admin/generations). Trước fix: emit prompt:completed CHỈ ở
          // success path (gated result.fileIds>0) → gen FAIL không có record. Giờ log cả fail (status='failed').
          const _failProvider = node.node_type === 'chatgpt' ? 'chatgpt' : node.node_type === 'grok' ? 'grok' : 'flow';
          const _isVideoFail = node.media_type === 'Video' || (node.node_type === 'grok' && node.grok_mode === 'video');
          window.eventBus?.emit?.('prompt:completed', {
            prompt: node.prompt || '',
            media_type: _isVideoFail ? 'Video' : (node.media_type || 'image'),
            model: _failProvider === 'grok' ? _failProvider : (node.model || _failProvider),
            ratio: node.ratio || '',
            prompt_count: 1,
            quantity: parseInt(node.quantity) || 1,
            ref_file_ids: node.ref_file_ids || '',
            result_file_ids: '',
            result_thumbnails: [],
            source: 'workflow',
            source_id: workflow?.wf_id || '',
            provider: _failProvider,
            status: 'failed',
            error_reason: error?.message || 'Gen thất bại',
            project_id: workflow?.project_id || null,
            auto_download: !!node.auto_download,
            // Phase 5: manual submit CHỈ áp generate (Flow); chatgpt/grok luôn auto.
            submit_mode: (node.node_type === 'generate' && this._manualSubmitMode === true) ? 'manual' : 'auto',
          });
        }
        emitLog( {
          nodeId: node.node_id,
          message: `"${node.node_name}" thất bại: ${error.message}`,
          type: 'error'
        });

        if (this.settings.stopOnError) {
          emitLog( { message: 'Dừng workflow do cài đặt "Dừng khi lỗi"', type: 'error' });
          this.shouldStop = true;
        }
        throw error;
      }
    }

    /**
     * 2026-05-27: Notification trực quan khi node gen/chatgpt/grok lỗi (gồm lỗi error_patterns
     * provider: rate limit, content blocked, not logged in, upload blocked...). Hiển thị ĐÚNG context:
     *   • Sidebar (app.js): window.showNotification / showToast
     *   • Workflow editor (window riêng, không có toast system): window.customDialog.alert
     * Gọi từ _executeNodeInternal catch (chạy trong context đang run) → không double do broadcast.
     */
    _notifyNodeError(node, error) {
      try {
        const nodeType = node?.node_type || node?.type;
        if (!['generate', 'chatgpt', 'grok'].includes(nodeType)) return;
        const reason = (error?.message || 'Lỗi không xác định').toString();
        // Dedup theo lý do trong 6s → nhiều node lỗi cùng nguyên nhân chỉ báo 1 lần (tránh spam modal).
        const now = Date.now();
        if (this._lastErrNotify && this._lastErrNotify.reason === reason && (now - this._lastErrNotify.t) < 6000) return;
        this._lastErrNotify = { reason, t: now };
        const title = `${node?.node_name || 'Node'} lỗi`;
        if (typeof window.showNotification === 'function') {
          window.showNotification(`${title}: ${reason}`, 'error', 7000);
        } else if (typeof window.showToast === 'function') {
          window.showToast(`${title}: ${reason}`);
        } else if (window.customDialog && typeof window.customDialog.alert === 'function') {
          window.customDialog.alert(reason, { type: 'error', title });
        }
      } catch (_) { /* notification best-effort */ }
    }

    /**
     * Phase S2.6.3: Batch pre-resolve ref images cho tất cả nodes
     * Scan DOM 1 lần để resolve file_name/thumbnail_url → tile_id
     */
    async _batchPreResolveRefImages(nodes) {
      // [Audit 2026-07-06] Heal drift TRƯỚC — node drifted map key cũ sẽ miss lookup theo id mới
      // → imagesToResolve rỗng → mọi bước sau (kể cả heal cuối) không chạy.
      for (const n of nodes || []) {
        if (n?.node_type === 'image') this._syncRefMapKeysByPosition(n);
      }
      if (!window.TileResolver || !nodes || nodes.length === 0) return;

      // Collect all images cần resolve từ tất cả nodes
      const imagesToResolve = [];
      const seenKeys = new Set();

      for (const node of nodes) {
        if (!node.ref_file_ids) continue;

        const refIds = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
        const thumbMap = node.ref_thumbnails || {};
        const fnMap = node.result_file_names || {};

        for (const fileId of refIds) {
          if (fileId.startsWith('upload_')) continue;  // Skip pending uploads
          if (seenKeys.has(fileId)) continue;
          seenKeys.add(fileId);

          const fileName = fnMap[fileId] || null;
          const thumbnailUrl = thumbMap[fileId] || null;

          if (fileName || thumbnailUrl) {
            imagesToResolve.push({
              id: fileId,
              file_name: fileName,
              thumbnail_url: thumbnailUrl
            });
          }
        }
      }

      if (imagesToResolve.length === 0) return;

      log(`[S2.6.3] Batch pre-resolving ${imagesToResolve.length} ref images...`);

      // Use TileResolver.batchResolve
      const { results, unresolved } = window.TileResolver.batchResolve(imagesToResolve);

      // Handle unresolved - try lazy load + retry
      // Fix D2 2026-06-05: MessageBridge KHÔNG có method ensureFlowTilesLoaded direct,
      // phải gọi qua sendToContentScript (handler trong content.js).
      if (unresolved.length > 0 && window.MessageBridge?.sendToContentScript) {
        log(`[S2.6.3] ${unresolved.length} images unresolved, triggering lazy load...`);
        try {
          await window.MessageBridge.sendToContentScript('ensureFlowTilesLoaded');
          window.TileCache?.clearFailed();
          const retry = window.TileResolver.batchResolve(unresolved);
          for (const [id, tileId] of retry.results) {
            results.set(id, tileId);
          }
        } catch (e) {
          log('[S2.6.3] Lazy load failed:', e.message);
        }
      }

      // Update node.ref_file_ids với corrected IDs
      if (results.size > 0) {
        for (const node of nodes) {
          if (!node.ref_file_ids) continue;

          const refIds = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          let changed = false;

          const correctedIds = refIds.map(id => {
            if (results.has(id)) {
              changed = true;
              return results.get(id);
            }
            return id;
          });

          if (changed) {
            node.ref_file_ids = correctedIds.join(', ');
            // [Drift fix 2026-07-06] Remap key ref_thumbnails/ref_file_names theo old→new (results).
            // Trước: chỉ đổi ref_file_ids → map giữ key cũ → mọi consumer tra map theo id = 0 match
            // (web /app/spaces sidebar trống — verified data wf_1783180308654).
            for (const field of ['ref_thumbnails', 'ref_file_names']) {
              const map = node[field];
              if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
              const remapped = {};
              for (const [k, v] of Object.entries(map)) {
                remapped[results.has(k) ? results.get(k) : k] = v;
              }
              node[field] = remapped;
            }
            log(`[S2.6.3] Node "${node.node_name}" ref_file_ids updated`);
          }
          // Data cũ đã lệch từ trước (key ∉ results) → re-key theo vị trí (0-match + count khớp).
          if (node.node_type === 'image') this._syncRefMapKeysByPosition(node);
        }
      }

      log(`[S2.6.3] Batch pre-resolve complete: ${results.size} resolved`);
    }

    /**
     * [Drift fix] Sync key ref_thumbnails/ref_file_names theo ref_file_ids khi lệch HOÀN TOÀN
     * (0-match) — remap theo vị trí, chỉ khi count khớp (guard chống gán nhầm, cùng điều kiện
     * pattern grok remap-by-position). Map heal độc lập từng field. Fallback cuối cho các đường
     * update ids không có mapping old→new tường minh.
     */
    _syncRefMapKeysByPosition(node, emitLog = null) {
      const ids = String(node?.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!ids.length) return false;
      let healed = false;
      for (const field of ['ref_thumbnails', 'ref_file_names']) {
        const map = node[field];
        if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
        const keys = Object.keys(map);
        if (keys.length !== ids.length) continue;
        if (ids.some(id => Object.prototype.hasOwnProperty.call(map, id))) continue; // có match → không đoán
        const remapped = {};
        ids.forEach((id, i) => { remapped[id] = map[keys[i]]; });
        node[field] = remapped;
        healed = true;
      }
      if (healed && emitLog) emitLog(`[Drift fix] "${node.node_name}": re-key ref map theo vị trí (${ids.length})`, 'warn');
      return healed;
    }

    // Phase 3.5 Bug C.6: _detectMixedProviders REMOVED — algorithm moved to server (WorkflowExecutionService::detectMixedProviders).
    // Server trả về is_mixed_providers trong execution plan response.
    // IP protection: provider detection rules ẩn server-side.

    /**
     * Phase CG-8b: Acquire ProviderTabLock cho node theo type. Trả release function
     * (hoặc null nếu không cần lock — vd: note node, hoặc PromptQueue đang OFF).
     */
    async _acquireLockForNodeType(node) {
      const t = node.node_type || node.type;
      if (!t || t === 'note') return null;

      let provider = null;
      if (['generate', 'download', 'image', 'telegram', 'delay'].includes(t)) {
        provider = 'flow';
      } else if (t === 'chatgpt') {
        provider = 'chatgpt';
      } else if (t === 'grok') {
        provider = 'grok';
      } else if (t === 'prompt' && node.use_ai === true) {
        // AI Agent rename (2026-05-30)
        provider = node.provider || 'chatgpt';
      }
      if (!provider) return null;

      // K.13 + K.10 (2026-05-29): Skip lock khi server cho phép parallel cho LEVEL của node này.
      // Trước K.10: check global `_serverPlan.is_mixed_providers` → workflow mixed → lock active
      // CHO MỌI node (kể cả node trong level chỉ-Flow). Sau K.10: server tính parallel_allowed
      // per-level → trust per-step decision.
      //
      // Lý do skip: server đã verified level same-provider + safe parallel → lock chỉ block
      // parallel submit vô ích. Flow editor singleton vẫn được serialize qua PromptQueue +
      // EditorExecutor (1 item 1 lúc).
      //
      // Giữ lock khi:
      //   - Server `parallel_allowed=false` (level mixed / ChatGPT/Grok / user toggle parallel=false):
      //     lock đảm bảo tab activation đúng provider trước operation.
      //   - Node KHÔNG có `_serverStep` (legacy/error path): defensive lock để safe.
      if (node._serverStep?.parallel_allowed === true) {
        return null;
      }

      // Image/delay không thực sự tương tác DOM tab Flow nhưng vẫn giữ lock 'flow'
      // để serialize với generate/upscale (đảm bảo upstream correctFileIds chạy đúng tab).

      if (!window.ProviderTabLock) return null; // graceful fallback nếu chưa load

      try {
        return await window.ProviderTabLock.acquire(provider, `node ${node.node_name || node.node_id}`);
      } catch (err) {
        console.warn('[WorkflowExecutor] ProviderTabLock.acquire failed:', err.message);
        return null;
      }
    }

    // Phase 3.5 Bug C.6: _buildExecutionLevels + _buildExecutionOrder REMOVED.
    // Kahn's algorithm + topological sort moved to server (WorkflowExecutionService).
    // IP protection: ~140 LOC algorithm hidden server-side.
    // Server return execution_levels (via plan.steps[].level_index) — client only converts to nested array.

    /**
     * Kiểm tra dependencies của node
     * Video+Frames: phải đủ cả 2 frame sources mới chạy
     */
    _checkDependencies(node, nodes, edges) {
      // Guard: return ok if nodes undefined
      if (!nodes || !Array.isArray(nodes)) return { ok: true };

      // Check edge-based dependencies
      const inputEdges = (edges || []).filter(e => e.target_node_id === node.node_id);

      for (const edge of inputEdges) {
        const sourceNode = nodes.find(n => n.node_id === edge.source_node_id);
        if (!sourceNode) continue;

        // Bug fix: Nếu source node disabled → bỏ qua edge đó, không fail toàn bộ.
        // Node downstream vẫn có thể chạy với các inputs khác (vd: Grok output → Flow,
        // dù Prompt ChatGPT → Flow bị disabled). Chỉ skip node nếu TẤT CẢ sources disabled.
        if (sourceNode.enabled === false) {
          continue; // Skip edge từ disabled node
        }
        // Manual mode Option C: upstream generate node user bỏ qua (_userSkipped) → downstream cascade skip.
        // Giống text_extract _extract_failed: 'skipped' status đơn thuần chỉ `continue` (không block), nên cần flag riêng.
        if (sourceNode._userSkipped === true) {
          return { ok: false, reason: `Node nguồn "${sourceNode.node_name}" đã bị bỏ qua (manual submit)` };
        }
        if (sourceNode.status === 'failed' || sourceNode.status === 'skipped') {
          continue; // Skip edge từ failed/skipped node
        }
        if (sourceNode.status !== 'completed') {
          return { ok: false, reason: `Node nguồn "${sourceNode.node_name}" chưa hoàn thành` };
        }
        // Text Extract Node (2026-05-29): nếu upstream extract failed với mode=skip_downstream
        // → mark downstream skipped (KHÔNG fail workflow).
        if (sourceNode.node_type === 'text_extract' && sourceNode._extract_failed
            && (sourceNode.extract_on_fail || 'skip_downstream') === 'skip_downstream') {
          return { ok: false, reason: `Upstream extract failed: ${sourceNode._extract_reason || 'no match'}` };
        }
        // Bug fix: Prompt node KHÔNG tạo result_file_ids (chỉ result_text/node.prompt khi Plain).
        // Trước: skip Grok/ChatGPT vì check result_file_ids rỗng → Grok bao giờ chạy được khi chỉ có Prompt upstream.
        // Giờ: detect output type theo node_type — Prompt validate result_text/prompt, others validate result_file_ids.
        // Bug fix #2: Cho phép fallback về node.prompt cho MỌI trường hợp (cả enhance=ON).
        // Trước: chỉ check node.prompt khi enhance=false → upstream enhance=true mà chưa execute fail validation sớm.
        // Bug fix #3: Text node cũng chỉ output result_text (không có result_file_ids).
        // Text Extract Node (2026-05-29): cùng pattern text/prompt — chỉ check result_text.
        if (['prompt', 'text', 'text_extract', 'text_template', 'random_pick', 'prompt_sequence', 'variant_expand', 'loop', 'style_anchor'].includes(sourceNode.node_type)) {
          const hasText = (sourceNode.result_text && sourceNode.result_text.trim()) ||
            (sourceNode.prompt && sourceNode.prompt.trim());
          if (!hasText) {
            // 2026-05-31 diagnostic: log srcNode state để debug missing result_text race
            console.warn(`[WorkflowExecutor] DEP_CHECK no text: src="${sourceNode.node_name}" (${sourceNode.node_type}) result_text=${JSON.stringify((sourceNode.result_text || '').substring(0, 80))} prompt=${JSON.stringify((sourceNode.prompt || '').substring(0, 80))}`);
            return { ok: false, reason: `Node nguồn "${sourceNode.node_name}" không có text output` };
          }
        } else if (!['delay', 'note'].includes(sourceNode.node_type)) {
          // Validate source node actually has output data (file-based outputs)
          if (!sourceNode.result_file_ids || sourceNode.result_file_ids.trim() === '') {
            return { ok: false, reason: `Node nguồn "${sourceNode.node_name}" không có file kết quả` };
          }
        }
      }

      // Video+Frames: check frame source nodes are completed with data
      if (node.media_type === 'Video' && node.video_input_type === 'Frames') {
        // Dùng CẢ 2 khung = đang nối cảnh. Cảnh báo cái giá phải trả, vì nó không hiện
        // ra lúc gen mà chỉ lộ khi ghép: hai video cùng đi qua một khung nên chỗ nối dôi
        // 10–16 khung tĩnh trùng (~0,4–0,7s). Không nói thì người dùng ghép xong mới thấy
        // video giật đều đặn và không hiểu vì đâu.
        if (node.frame_1_source && node.frame_2_source && !node._chainWarned) {
          node._chainWarned = true;
          const VC = window.VideoChain;
          if (VC) {
            const ov = VC.overlapSeconds();
            console.warn(`[WorkflowExecutor] Node "${node.node_name}" nối 2 khung → chỗ nối dôi `
              + `${VC.OVERLAP_FRAMES.min}–${VC.OVERLAP_FRAMES.max} khung trùng (~${ov.min}–${ov.max}s). `
              + 'Cắt bớt phần chồng khi ghép; đổi bối cảnh thì nên cắt cứng thay vì nối.');
          }
        }
        const frameSources = [
          { source: node.frame_1_source, fileId: node.frame_1_file_id, label: 'Frame 1' },
          { source: node.frame_2_source, fileId: node.frame_2_file_id, label: 'Frame 2' }
        ];

        for (const frame of frameSources) {
          if (!frame.source || frame.source === '') continue;

          if (frame.source === 'manual') {
            if (!frame.fileId) {
              return { ok: false, reason: `${frame.label} chưa chọn ảnh` };
            }
          } else {
            const sourceNode = nodes.find(n => n.node_id === frame.source);
            if (!sourceNode) {
              return { ok: false, reason: `${frame.label}: node nguồn không tồn tại` };
            }
            if (sourceNode.status !== 'completed') {
              return { ok: false, reason: `${frame.label}: node "${sourceNode.node_name}" chưa hoàn thành` };
            }
            if (!sourceNode.result_file_ids || sourceNode.result_file_ids.trim() === '') {
              return { ok: false, reason: `${frame.label}: node "${sourceNode.node_name}" không có file kết quả` };
            }
          }
        }
      }

      // Delay, download, note, telegram, prompt, text_extract: không cần check node.prompt
      // (prompt node chính nó đã có text trong .prompt textbox; downstream được port-text override.
      // text_extract chỉ cần upstream text, không có prompt field.)
      if (['delay', 'download', 'note', 'image', 'telegram', 'prompt', 'text_extract', 'text_template', 'random_pick', 'prompt_sequence', 'variant_expand', 'loop'].includes(node.node_type)) {
        return { ok: true, reason: null };
      }

      // Bug fix: cho phép node.prompt rỗng nếu có upstream Prompt/Text/TextExtract node qua port `text`
      // (runtime sẽ override node.prompt từ result_text/prompt của upstream).
      // 2026-05-31: thêm 'text' + 'text_extract' — cùng pattern e336319 (text_extract = valid text source).
      // Trước fix: workflow text_extract → generate luôn skip "chưa có prompt" dù extract có text.
      const hasPromptUpstream = inputEdges.some((e) => {
        if (e.target_port && e.target_port !== 'text' && e.target_port !== 'default') return false;
        const src = nodes.find((n) => n.node_id === e.source_node_id);
        return src && ['prompt', 'text', 'text_extract', 'text_template', 'random_pick', 'prompt_sequence', 'variant_expand', 'loop', 'style_anchor'].includes(src.node_type);
      });

      // Validate node itself has prompt (skip nếu có Prompt upstream)
      if (!node.prompt || node.prompt.trim() === '') {
        if (!hasPromptUpstream) {
          return { ok: false, reason: `Node "${node.node_name}" chưa có prompt` };
        }
      }

      return { ok: true, reason: null };
    }

    /**
     * Collect input file IDs từ nodes trước
     */
    /**
     * Collect input file IDs cho node.
     *
     * Video+Frames: Trả về {frame1: fileId, frame2: fileId} - THỨ TỰ QUAN TRỌNG
     * Các loại khác: Trả về mảng fileIds gộp từ edges + ref
     */
    /**
     * Correct stale tile IDs trên upstream nodes (result_file_ids từ node trước).
     * Khi Flow reload, result_file_ids của node đã chạy xong trở thành stale.
     * Cần correct trước khi _collectInputFileIds lấy chúng.
     */
    /**
     * Recovery: re-upload missing ChatGPT/Grok tiles từ provider URL.
     * Khi bridge fail tạo synthetic tile (chatgpt_xxx / grok_xxx) hoặc tile thật
     * bị mất khỏi Flow canvas (user reload Flow tab), lookup result_provider_urls,
     * fetch URL gốc qua provider tab session → upload lại sang Flow → tile_id mới.
     *
     * Skip cases (return false không recover):
     * - Không có result_provider_urls
     * - MessageBridge undefined
     * - Tile DOM check fail (assume present để tránh false positive)
     * - Video tile (Flow không support upload video)
     * - Provider URL hết hạn (fetch fail)
     * - Provider tab đã đóng
     *
     * Khi recover thành công: update sourceNode.result_file_ids/thumbnails/file_names/provider_urls
     * với tile_id mới. Trả true để caller biết.
     */
    async _recoverProviderTiles(sourceNode, emitLog) {
      if (!sourceNode?.result_provider_urls) {
        emitLog(`[Recovery] Skip: no result_provider_urls for node ${sourceNode?.node_id?.substring(0, 16) || 'unknown'}`);
        emitLog(`[Recovery] sourceNode keys: ${Object.keys(sourceNode || {}).filter(k => k.startsWith('result_')).join(', ') || '(no result_* keys)'}`);
        return false;
      }
      if (!window.MessageBridge) {
        emitLog(`[Recovery] Skip: no MessageBridge`);
        return false;
      }

      const ids = (sourceNode.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length === 0) {
        emitLog(`[Recovery] Skip: no result_file_ids`);
        return false;
      }

      emitLog(`[Recovery] Checking ${ids.length} tile(s): ${ids.map(id => id.substring(0, 16)).join(', ')}`);
      emitLog(`[Recovery] provider_urls keys: ${Object.keys(sourceNode.result_provider_urls || {}).map(k => k.substring(0, 16)).join(', ')}`);

      // Check tile DOM existence — chỉ recover những tile thực sự missing
      let missing = [];
      try {
        const check = await window.MessageBridge.checkTilesExist(ids);
        emitLog(`[Recovery] checkTilesExist result: existing=${check?.existing?.length || 0}, missing=${check?.missing?.length || 0}`);
        missing = check?.missing || [];
      } catch (e) {
        // Check fail → assume all present (safer than false positive triggering re-upload spam)
        emitLog(`[Recovery] checkTilesExist fail: ${e.message} — skip recovery`, 'warn');
        return false;
      }

      if (missing.length === 0) {
        emitLog(`[Recovery] All tiles exist on Flow DOM, skip recovery`);
        return false;
      }

      emitLog(`[Recovery] ${missing.length}/${ids.length} tile(s) missing trên Flow → re-upload từ provider URL`, 'info');

      const corrections = {}; // oldId → { newId, file_name, thumbnail }
      for (const oldId of missing) {
        const providerData = sourceNode.result_provider_urls[oldId];
        if (!providerData?.url) {
          emitLog(`[Recovery] ${oldId.substring(0, 16)}: không có provider URL — skip`, 'warn');
          continue;
        }

        // Flow không accept video upload → skip (Download node vẫn work qua provider URL trực tiếp)
        if (providerData.media_type === 'video') {
          emitLog(`[Recovery] ${oldId.substring(0, 16)}: video — Flow không support upload, skip`, 'warn');
          continue;
        }

        const bridgeFn = providerData.provider === 'chatgpt'
          ? window.MessageBridge.chatGPTBridgeToFlow
          : providerData.provider === 'grok'
            ? window.MessageBridge.grokBridgeToFlow
            : null;
        if (!bridgeFn) {
          emitLog(`[Recovery] ${oldId.substring(0, 16)}: provider "${providerData.provider}" không hỗ trợ`, 'warn');
          continue;
        }

        try {
          const fileName = `${providerData.provider}-recovered-${Date.now()}.png`;
          const bridgeResp = await bridgeFn.call(window.MessageBridge, providerData.url, providerData.tab_id, fileName);

          // ChatGPT schema: { success, tileDetails: [{id, file_name, thumbnailUrl}] }
          // Grok schema:    { success, tileId, fileName, thumbnailUrl } (flat)
          let newTileId = null;
          let newFileName = null;
          let newThumbnail = null;
          if (bridgeResp?.success) {
            if (providerData.provider === 'chatgpt') {
              const td = Array.isArray(bridgeResp.tileDetails)
                ? bridgeResp.tileDetails[0]
                : (bridgeResp.tileDetails || null);
              newTileId = td?.id || td?.tile_id || td?.tileId;
              newFileName = td?.file_name;
              newThumbnail = td?.thumbnailUrl || td?.thumbnail_url;
            } else {
              newTileId = bridgeResp.tileId;
              newFileName = bridgeResp.fileName;
              newThumbnail = bridgeResp.thumbnailUrl;
            }
          }

          if (newTileId) {
            corrections[oldId] = { newId: newTileId, file_name: newFileName, thumbnail: newThumbnail };
            emitLog(`[Recovery] ${oldId.substring(0, 16)} → ${newTileId.substring(0, 16)}`, 'success');
          } else {
            emitLog(`[Recovery] ${oldId.substring(0, 16)} fail: ${bridgeResp?.error || 'NO_TILE_ID'}`, 'warn');
          }
        } catch (err) {
          emitLog(`[Recovery] ${oldId.substring(0, 16)} exception: ${err.message}`, 'warn');
        }
      }

      if (Object.keys(corrections).length === 0) return false;

      // Apply corrections: update result_file_ids + re-key thumbnails/file_names/provider_urls
      const newIdsArr = ids.map(id => corrections[id]?.newId || id);
      sourceNode.result_file_ids = newIdsArr.join(', ');

      if (!sourceNode.result_thumbnails || Array.isArray(sourceNode.result_thumbnails)) sourceNode.result_thumbnails = {};
      if (!sourceNode.result_file_names || Array.isArray(sourceNode.result_file_names)) sourceNode.result_file_names = {};
      if (!sourceNode.result_provider_urls || Array.isArray(sourceNode.result_provider_urls)) sourceNode.result_provider_urls = {};

      for (const [oldId, info] of Object.entries(corrections)) {
        const newId = info.newId;
        // Move/update thumbnail
        const oldThumb = sourceNode.result_thumbnails[oldId];
        if (oldThumb) {
          // Preserve format (object {thumbnail, type, file_name} hoặc string)
          if (typeof oldThumb === 'object') {
            sourceNode.result_thumbnails[newId] = {
              ...oldThumb,
              thumbnail: info.thumbnail || oldThumb.thumbnail,
              file_name: info.file_name || oldThumb.file_name,
            };
          } else {
            sourceNode.result_thumbnails[newId] = info.thumbnail || oldThumb;
          }
          delete sourceNode.result_thumbnails[oldId];
        } else if (info.thumbnail) {
          sourceNode.result_thumbnails[newId] = info.thumbnail;
        }
        // Move file_name
        if (sourceNode.result_file_names[oldId]) {
          sourceNode.result_file_names[newId] = info.file_name || sourceNode.result_file_names[oldId];
          delete sourceNode.result_file_names[oldId];
        } else if (info.file_name) {
          sourceNode.result_file_names[newId] = info.file_name;
        }
        // Move provider URL (preserve để future recovery vẫn work nếu user reload Flow lại)
        if (sourceNode.result_provider_urls[oldId]) {
          sourceNode.result_provider_urls[newId] = sourceNode.result_provider_urls[oldId];
          delete sourceNode.result_provider_urls[oldId];
        }
        // Sync MediaRegistry
        if (typeof MediaRegistry !== 'undefined') {
          if (info.thumbnail) MediaRegistry.setThumb?.(newId, info.thumbnail);
          if (info.file_name) MediaRegistry.setFileName?.(newId, info.file_name);
        }
      }

      return true;
    }

    async _correctUpstreamNodeIds(node, workflow, emitLog) {
      // Port 1.1.58 VIDEO_NODE_LAST_FRAME (lazy): video node nối vào qua port `frame` đã trích frame
      // cuối chưa (cho video gen SẴN, run single-node không re-gen) → downstream đọc result_frame_file_ids.
      // Nuốt im ở đây → node video downstream thiếu frame ref mà báo nguyên nhân khác → phải log.
      try { await this._ensureFrameRefsExtracted(node, workflow); }
      catch (e) { console.warn('[WorkflowExecutor] Trích frame ref thất bại cho node', node?.node_name, '→ downstream có thể thiếu frame:', e?.message); }
      if (typeof window.correctFileIds !== 'function') return;
      if (!workflow?.nodes || !Array.isArray(workflow.nodes)) return;

      const edges = workflow.edges || [];
      const inputEdges = edges.filter(e => e.target_node_id === node.node_id);
      if (inputEdges.length === 0) return;

      // CRITICAL FIX 2026-06-05 (Fix D): ensure Flow tiles loaded vào DOM TRƯỚC Tầng 1-5a.
      // Bug: ProviderTabLock switch tab Flow → ngay lập tức gọi _correctUpstreamNodeIds →
      // checkFilesExist query DOM trống → tất cả upstream tiles "missing" → reupload toàn bộ.
      // Fix 4 (line 4290) chỉ cover own ref correction, KHÔNG cover upstream → reupload 3 Image
      // nodes mỗi lần switch tab. Fix D: gọi ensureFlowTilesLoaded MỘT LẦN trước loop.
      // Fix D2: MessageBridge KHÔNG có method ensureFlowTilesLoaded — dùng sendToContentScript
      // ('ensureFlowTilesLoaded' handler mới add vào content.js).
      try {
        if (window.MessageBridge?.sendToContentScript) {
          console.log(`[REUPLOAD_AUDIT] Fix D2 — sendToContentScript('ensureFlowTilesLoaded') TRƯỚC _correctUpstreamNodeIds loop (${inputEdges.length} upstream edges)`);
          emitLog(`[Tile Load] ensureFlowTilesLoaded TRƯỚC Tầng 1-5a (upstream check)`);
          const _r = await window.MessageBridge.sendToContentScript('ensureFlowTilesLoaded');
          console.log(`[REUPLOAD_AUDIT] Fix D2 — ensureFlowTilesLoaded DONE: ${JSON.stringify(_r)}`);
        } else {
          console.warn(`[REUPLOAD_AUDIT] Fix D2 — MessageBridge.sendToContentScript không tồn tại!`);
        }
      } catch (e) {
        console.warn(`[REUPLOAD_AUDIT] Fix D2 failed: ${e.message}`);
        emitLog(`[Tile Load] ensureFlowTilesLoaded failed (upstream): ${e.message}`, 'warn');
      }

      // REVERTED 2026-06-05: Fix E + Fix E v2 (propagate corrections to caller node.ref_file_ids)
      // không fire trong tests (gate condition fail) — không gây regression nhưng cũng không cần.
      // Removed để giữ code path đơn giản giống bản gốc.

      for (const edge of inputEdges) {
        const sourceNode = workflow.nodes.find(n => n.node_id === edge.source_node_id);
        if (!sourceNode) continue;
        // GAP #1 fix 2026-06-22: image node passthrough — output là ref_file_ids khi CHƯA execute
        // (result_file_ids rỗng). _collectInputFileIds:3218 dùng ref_file_ids nhưng correct/reupload
        // gate bằng result_file_ids → ref stale KHÔNG được correct → gen attach id cũ → addRefImages fail.
        // Đồng bộ: coi ref như result (giống node.result_file_ids=node.ref_file_ids khi image execute :5841).
        // Lọc upload_ keys cho khớp _collectInputFileIds:3220 (tránh đẩy upload_ vào path result không-filter).
        if (!sourceNode.result_file_ids && sourceNode.node_type === 'image' && sourceNode.ref_file_ids) {
          const cleanRef = (sourceNode.ref_file_ids || '').split(',').map(s => s.trim())
            .filter(Boolean).filter(id => !id.startsWith('upload_')).join(', ');
          if (cleanRef) sourceNode.result_file_ids = cleanRef;
        }
        if (!sourceNode.result_file_ids) continue;

        const srcType = sourceNode.node_type || sourceNode.type;
        const isProviderSource = srcType === 'chatgpt' || srcType === 'grok';

        // Lưu original IDs trước correctFileIds để reupload cache lookup đúng key
        const originalIds = sourceNode.result_file_ids;

        // Build thumbnail map + file_name map từ source node
        // Image node: result = ref pass-through, nên cần cả ref_thumbnails + ref_file_names
        const thumbMap = { ...(sourceNode.ref_thumbnails || {}), ...(sourceNode.result_thumbnails || {}) };
        const fileNameMap = { ...(sourceNode.ref_file_names || {}), ...(sourceNode.result_file_names || {}) };
        const hasMap = Object.keys(thumbMap).length > 0 || Object.keys(fileNameMap).length > 0;

        // TẦNG 1-4: correctFileIds qua file_name > data-tile-id > thumbnail_url > ensureFlowTilesLoaded.
        // Áp dụng cho cả Flow generate VÀ ChatGPT/Grok upstream: bridge happy path tạo ra
        // fe_id_xxx Flow thật + file_name UUID Flow → file_name lookup recover được khi Flow reload,
        // tiết kiệm round trip re-upload qua CDN provider (Bug fix: trước đây skip cho chatgpt/grok
        // gây re-upload không cần thiết kể cả khi ảnh vẫn ở Flow media library).
        // Synthetic IDs `chatgpt_xxx`/`grok_xxx` không có file_name UUID Flow → correctFileIds
        // không match được, giữ nguyên ID (an toàn) → tầng 5b sẽ xử lý qua provider URL.
        if (hasMap) {
          emitLog(`[Upstream] Kiểm tra result IDs từ "${sourceNode.node_name}": ${originalIds.substring(0, 60)}...`);
          const { correctedIds, changed } = await window.correctFileIds(originalIds, thumbMap, fileNameMap);
          if (changed) {
            sourceNode.result_file_ids = correctedIds;
            // Cập nhật thumbnail + file_name + provider_urls keys
            const corrections = {};
            const oldArr = (originalIds || '').split(',').map(s => s.trim()).filter(Boolean);
            const newArr = (correctedIds || '').split(',').map(s => s.trim()).filter(Boolean);
            for (let i = 0; i < oldArr.length; i++) {
              if (oldArr[i] !== newArr[i]) corrections[oldArr[i]] = newArr[i];
            }
            // Guard array: backend JSON column có thể serialize {} → [] khi rỗng. Nếu source
            // truyền vào là array (lỗi format), Object.entries iterate index "0","1"... →
            // updated thành object keys không phải tile_id → corrupt. Skip re-key, reset {}.
            if (sourceNode.result_thumbnails && typeof sourceNode.result_thumbnails === 'object'
                && !Array.isArray(sourceNode.result_thumbnails)) {
              const updated = {};
              for (const [oldId, url] of Object.entries(sourceNode.result_thumbnails)) {
                updated[corrections[oldId] || oldId] = url;
              }
              sourceNode.result_thumbnails = updated;
            }
            if (sourceNode.result_file_names && typeof sourceNode.result_file_names === 'object'
                && !Array.isArray(sourceNode.result_file_names)) {
              const updated = {};
              for (const [oldId, fn] of Object.entries(sourceNode.result_file_names)) {
                updated[corrections[oldId] || oldId] = fn;
              }
              sourceNode.result_file_names = updated;
            }
            // Re-key provider_urls để future recovery vẫn lookup được nếu tile mất lần nữa
            if (sourceNode.result_provider_urls && typeof sourceNode.result_provider_urls === 'object'
                && !Array.isArray(sourceNode.result_provider_urls)) {
              const updated = {};
              for (const [oldId, pu] of Object.entries(sourceNode.result_provider_urls)) {
                updated[corrections[oldId] || oldId] = pu;
              }
              sourceNode.result_provider_urls = updated;
            }
            emitLog(`[Upstream] Đã correct result IDs từ "${sourceNode.node_name}": ${correctedIds.substring(0, 60)}...`);
          } else {
            emitLog(`[Upstream] Result IDs từ "${sourceNode.node_name}" vẫn hợp lệ`);
          }
        } else if (!isProviderSource) {
          emitLog(`[Upstream] Node "${sourceNode.node_name}": không có thumbnail/file_name map, bỏ qua correct`);
          continue;
        }

        if (isProviderSource) {
          // TẦNG 5b — ChatGPT/Grok upstream: provider URL recovery cho synthetic IDs hoặc fe_id_xxx
          // vẫn missing sau tầng 1-4. _recoverProviderTiles tự checkTilesExist → skip nhanh nếu tile OK.
          try {
            const recovered = await this._recoverProviderTiles(sourceNode, emitLog);
            if (!recovered) {
              emitLog(`[Upstream] Node "${sourceNode.node_name}" (${srcType}): provider recovery skipped (tiles OK hoặc không recover được)`);
            }
          } catch (recErr) {
            emitLog(`[Recovery] error cho "${sourceNode.node_name}": ${recErr.message}`, 'warn');
          }
        } else if (typeof window.reuploadMissingFiles === 'function'
            && !((node.node_type === 'grok' || node.node_type === 'chatgpt') && this._sourceRefsHaveThumbnail(sourceNode))) {
          // TẦNG 5a — Flow upstream: reuploadMissingFiles từ uploadedFileCache.
          // KHÔNG áp dụng cho chatgpt/grok upstream vì cache là Flow refs (ảnh user upload),
          // không phải ảnh ChatGPT/Grok sinh ra → cache miss chắc chắn. Provider URL recovery (5b)
          // mới là path đúng.
          // Skip khi target grok/chatgpt + source refs đều có thumbnail: 2 provider này submit bằng
          // base64 từ thumbnail → không cần tile Flow sống. Correction Tầng 1-4 vẫn đã chạy ở trên.
          // Tránh false-missing (tile ngoài DOM đang load) → reupload trùng + delay (bug node mới vs reopen).
          const beforeUpstream = (sourceNode.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          const upstreamThumbMap = { ...(sourceNode.result_thumbnails || {}), ...(sourceNode.ref_thumbnails || {}) };
          // CRITICAL: Truyền file_names map để check file_name trước (tránh reupload không cần thiết)
          const upstreamFileNamesMap = { ...(sourceNode.result_file_names || {}), ...(sourceNode.ref_file_names || {}) };
          emitLog(`[REUPLOAD_AUDIT] >>> Upstream Tầng 5a FIRE — node "${sourceNode.node_name || sourceNode.node_id}" (${srcType}), result_ids: ${beforeUpstream.map(id => id.substring(0, 18)).join(', ')}`, 'warn');
          emitLog(`[REUPLOAD_AUDIT] Upstream file_names: ${JSON.stringify(upstreamFileNamesMap)}`);
          emitLog(`[REUPLOAD_AUDIT] Upstream thumb keys: ${Object.keys(upstreamThumbMap).map(k => k.substring(0, 18)).join(', ')}`);
          const updated = await window.reuploadMissingFiles(sourceNode.result_file_ids, upstreamThumbMap, originalIds, upstreamFileNamesMap);
          if (updated !== sourceNode.result_file_ids) {
            emitLog(`[REUPLOAD_AUDIT] !!! UPSTREAM REUPLOAD HAPPENED — "${sourceNode.node_name}": ${sourceNode.result_file_ids.substring(0, 60)} → ${updated.substring(0, 60)}`, 'warn');
            emitLog(`[Upstream Tầng 5] Re-upload result từ "${sourceNode.node_name}": ${updated.substring(0, 60)}...`);
            const oldIdArr = beforeUpstream;
            const newIdArr = (updated || '').split(',').map(s => s.trim()).filter(Boolean);
            sourceNode.result_file_ids = updated;

            // Update result_file_names và result_thumbnails với new keys từ MediaRegistry
            if (!sourceNode.result_file_names || Array.isArray(sourceNode.result_file_names)) sourceNode.result_file_names = {};
            if (!sourceNode.result_thumbnails || Array.isArray(sourceNode.result_thumbnails)) sourceNode.result_thumbnails = {};
            // GAP #2 fix 2026-06-22: ưu tiên MediaRegistry (đúng theo newId, không phụ thuộc index).
            // CHỈ index-pair old→new khi 2 mảng KHỚP độ dài (reupload không drop/reorder) — lệch độ dài
            // → oldId=null → KHÔNG đoán theo index (tránh gán nhầm file_name của ref khác cho newId).
            const _idsAligned = oldIdArr.length === newIdArr.length;
            for (let i = 0; i < newIdArr.length; i++) {
              const newId = newIdArr[i];
              if (!newId) continue;
              const oldId = _idsAligned ? oldIdArr[i] : null;
              if (oldId === newId) continue; // không đổi → giữ nguyên
              const newFileName = MediaRegistry.getFileName(newId) || (oldId ? sourceNode.result_file_names[oldId] : null);
              if (newFileName) sourceNode.result_file_names[newId] = newFileName;
              const newThumb = MediaRegistry.getThumb(newId) || (oldId ? sourceNode.result_thumbnails[oldId] : null);
              if (newThumb) sourceNode.result_thumbnails[newId] = newThumb;
              if (oldId) {
                delete sourceNode.result_file_names[oldId];
                delete sourceNode.result_thumbnails[oldId];
              }
            }

            // CRITICAL FIX 2026-06-05: Persist upstream node's new IDs xuống DB.
            // Trước fix: chỉ mutate in-memory → next run reload từ DB → vẫn old IDs →
            // tile check fail → reupload lặp lại → Flow polluted với duplicate uploads.
            // Sau fix: persist xuống DB → next run dùng IDs hợp lệ → check pass → KHÔNG reupload.
            try {
              const persistPayload = {
                result_file_ids: sourceNode.result_file_ids,
                result_thumbnails: sourceNode.result_thumbnails,
                result_file_names: sourceNode.result_file_names,
              };
              if (sourceNode.node_type === 'image') {
                // [Audit 2026-07-06] Heal map drifted TRƯỚC remap old→new bên dưới — rebuild whitelist
                // theo oldIdArr sẽ DROP key lạ (map drifted bị xóa thành {} rồi persist rỗng).
                // Heal lúc này ref_file_ids còn là OLD ids → re-key về oldIdArr → remap pair hoạt động.
                this._syncRefMapKeysByPosition(sourceNode, emitLog);
                sourceNode.ref_file_ids = sourceNode.result_file_ids;
                if (sourceNode.ref_thumbnails && typeof sourceNode.ref_thumbnails === 'object'
                    && !Array.isArray(sourceNode.ref_thumbnails)) {
                  const updatedRefThumbs = {};
                  for (let i = 0; i < oldIdArr.length; i++) {
                    const oldId = oldIdArr[i];
                    const newId = newIdArr[i];
                    if (oldId && newId && sourceNode.ref_thumbnails[oldId]) {
                      updatedRefThumbs[newId] = sourceNode.ref_thumbnails[oldId];
                    } else if (oldId && sourceNode.ref_thumbnails[oldId]) {
                      updatedRefThumbs[oldId] = sourceNode.ref_thumbnails[oldId];
                    }
                  }
                  sourceNode.ref_thumbnails = updatedRefThumbs;
                }
                if (sourceNode.ref_file_names && typeof sourceNode.ref_file_names === 'object'
                    && !Array.isArray(sourceNode.ref_file_names)) {
                  const updatedRefNames = {};
                  for (let i = 0; i < oldIdArr.length; i++) {
                    const oldId = oldIdArr[i];
                    const newId = newIdArr[i];
                    if (oldId && newId && sourceNode.ref_file_names[oldId]) {
                      updatedRefNames[newId] = sourceNode.ref_file_names[oldId];
                    } else if (oldId && sourceNode.ref_file_names[oldId]) {
                      updatedRefNames[oldId] = sourceNode.ref_file_names[oldId];
                    }
                  }
                  sourceNode.ref_file_names = updatedRefNames;
                }
                persistPayload.ref_file_ids = sourceNode.ref_file_ids;
                persistPayload.ref_thumbnails = sourceNode.ref_thumbnails;
                persistPayload.ref_file_names = sourceNode.ref_file_names;
              }
              await window.storageManager?.updateNodeStatus(
                this.currentWorkflow?.wf_id || workflow.wf_id,
                sourceNode.node_id,
                persistPayload
              );
              emitLog(`[Persist] Upstream "${sourceNode.node_name}" new IDs đã lưu DB → tránh reupload lặp`);
            } catch (e) {
              emitLog(`[Persist] Failed to save upstream "${sourceNode.node_name}": ${e.message}`, 'warn');
            }

            // Fix recurring-reupload 2026-06-22: sync correction vào canvas editor qua node:ref_replaced.
            // updateNodeStatus chỉ PATCH DB; canvas (drawflow) vẫn giữ id cũ → saveWorkflowFull (đọc canvas)
            // revert → reupload lặp mỗi run. Emit để _syncDrawflowNodeData cập nhật canvas (result_* + ref_*).
            try {
              const isImageSrc = sourceNode.node_type === 'image';
              window.eventBus?.emit('node:ref_replaced', {
                nodeId: sourceNode.node_id,
                oldRefIds: oldIdArr.join(', '),
                newRefIds: isImageSrc ? sourceNode.ref_file_ids : undefined,
                refFileNames: isImageSrc ? sourceNode.ref_file_names : undefined,
                refThumbnails: isImageSrc ? sourceNode.ref_thumbnails : undefined,
                resultFileIds: sourceNode.result_file_ids,
                resultFileNames: sourceNode.result_file_names,
                resultThumbnails: sourceNode.result_thumbnails,
              });
            } catch (e) { /* non-blocking — UI sync best-effort */ }
          }
          const afterUpstream = (updated || '').split(',').map(s => s.trim()).filter(Boolean);
          const droppedUpstream = beforeUpstream.length - afterUpstream.length;
          if (droppedUpstream > 0) {
            emitLog(`[Node ${sourceNode.node_name}] ${droppedUpstream} ảnh kết quả không tìm thấy, đã bị bỏ qua`, 'warn');
            if (afterUpstream.length === 0 && beforeUpstream.length > 0) {
              emitLog(`[Node ${sourceNode.node_name}] Tất cả ảnh kết quả đã mất. Node tiếp theo chạy không có input.`, 'error');
            }
          }
        }
      }

    }

    _collectInputFileIds(node, nodes, edges) {
      // Guard: return empty if nodes undefined
      if (!nodes || !Array.isArray(nodes)) {
        return [];
      }

      // Video+Frames: collect từng frame riêng biệt
      // Chỉ dùng Frames mode khi node có configure frame source cụ thể
      if (node.media_type === 'Video' && node.video_input_type === 'Frames'
          && (node.frame_1_source || node.frame_2_source)) {
        return this._collectFrameFileIds(node, nodes);
      }

      const fileIds = [];

      // 1. Từ các node trước (qua edges), traverse qua pass-through nodes
      // 2026-06-02: Server control — backend WorkflowController->show() sort edges theo
      // pos_y/pos_x của source node TRƯỚC khi trả response. Frontend trust order as-is.
      // Fix audit #3: thêm 'condition' — condition là node gate pass-through (in:any→out:any) nhưng
      // KHÔNG set result_file_ids → trước fix, Generate→Condition→Download tải rỗng. Cho collector
      // traverse NGƯỢC qua condition tới upstream có file thật.
      const PASSTHROUGH_TYPES = ['delay', 'note', 'condition', 'switch'];
      const inputEdges = (edges || []).filter(e => e.target_node_id === node.node_id);
      for (const edge of inputEdges) {
        const sourceNode = nodes.find(n => n.node_id === edge.source_node_id);
        if (!sourceNode) continue;

        // Port 1.1.58 VIDEO_NODE_LAST_FRAME: edge từ output port 'frame' → dùng result_frame_file_ids
        // (frame CUỐI đã upload thành 1 ảnh Flow) thay result_file_ids (= VIDEO tile → upload nhầm video).
        if (edge.source_port === 'frame') {
          const frameIds = (sourceNode.result_frame_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          if (frameIds.length) fileIds.push(...frameIds);
          continue;
        }

        if (sourceNode.result_file_ids) {
          const ids = (sourceNode.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          fileIds.push(...ids);
        } else if (sourceNode.node_type === 'image' && sourceNode.ref_file_ids) {
          // Image node: output = ref_file_ids (khi chưa execute), lọc bỏ upload_xxx keys
          const ids = (sourceNode.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean).filter(id => !id.startsWith('upload_'));
          fileIds.push(...ids);
        } else if (PASSTHROUGH_TYPES.includes(sourceNode.node_type)) {
          // Pass-through node (delay, note): traverse ngược lên tìm upstream data
          const visited = new Set([node.node_id, sourceNode.node_id]);
          const queue = [sourceNode.node_id];
          while (queue.length > 0) {
            const currentId = queue.shift();
            const upstreamEdges = (edges || []).filter(e => e.target_node_id === currentId);
            for (const ue of upstreamEdges) {
              const upNode = nodes.find(n => n.node_id === ue.source_node_id);
              if (!upNode || visited.has(upNode.node_id)) continue;
              visited.add(upNode.node_id);
              if (upNode.result_file_ids) {
                const ids = (upNode.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
                fileIds.push(...ids);
              } else if (upNode.node_type === 'image' && upNode.ref_file_ids) {
                // Image node: output = ref_file_ids (khi chưa execute), lọc bỏ upload_xxx keys
                const ids = (upNode.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean).filter(id => !id.startsWith('upload_'));
                fileIds.push(...ids);
              } else if (PASSTHROUGH_TYPES.includes(upNode.node_type)) {
                queue.push(upNode.node_id);
              }
            }
          }
        }
      }

      // 2. Từ ảnh tham chiếu riêng của node (chọn qua image picker)
      if (node.ref_file_ids) {
        const refIds = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
        if (refIds.length > 0) {
          log('Node ref_file_ids:', refIds);
        }
        fileIds.push(...refIds);
      }

      // BUG FIX 2026-06-05: dedup theo file_name UUID (content fingerprint), KHÔNG chỉ theo ID string.
      // Scenario: workflow clone từ template — Image nodes + Generate node refs cùng files (upload_import_X).
      // First run upload riêng từng node → 2 sets of Flow IDs cho SAME files → 6 IDs cho 3 files.
      // Trước fix: Set dedup theo string ID → giữ cả 6 → Flow nhận 6 refs cho 3 files duy nhất.
      // Sau fix: dedup theo file_name (UUID stable, không đổi qua reupload) → match → 3 unique files.
      const buildFileNameLookup = () => {
        const map = new Map();
        if (node.ref_file_names) {
          for (const [id, fn] of Object.entries(node.ref_file_names)) if (fn) map.set(id, fn);
        }
        for (const edge of inputEdges) {
          const src = nodes.find(n => n.node_id === edge.source_node_id);
          if (!src) continue;
          if (src.result_file_names) {
            for (const [id, fn] of Object.entries(src.result_file_names)) if (fn) map.set(id, fn);
          }
          if (src.ref_file_names) {
            for (const [id, fn] of Object.entries(src.ref_file_names)) if (fn) map.set(id, fn);
          }
        }
        return map;
      };
      const fnLookup = buildFileNameLookup();
      const seenFileNames = new Set();
      const seenIds = new Set();
      const dedupedFileIds = [];
      for (const id of fileIds) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const fn = fnLookup.get(id);
        if (fn) {
          if (seenFileNames.has(fn)) {
            log(`[Dedup file_name] Skip duplicate ID ${id.substring(0, 16)}... (cùng file_name với ID đã chọn)`);
            continue;
          }
          seenFileNames.add(fn);
        }
        dedupedFileIds.push(id);
      }
      return dedupedFileIds;
    }

    /**
     * Phase WK-1.4.1: Thu thập input theo từng port name (typed port system).
     * Đọc edges có target_port khớp portName, query upstream output qua source_port.
     * Backward-compat (WK-1.4.8): edge cũ không có port → map sang port[0] của node.
     *
     * @param {Object} node - Node hiện tại
     * @param {String} portName - Tên input port (vd 'image_ref', 'text', 'frame_1')
     * @param {Array} nodes - Tất cả nodes của workflow
     * @param {Array} edges - Tất cả edges của workflow
     * @returns {Array} Mảng giá trị input (string IDs hoặc text)
     */
    _collectPortInputs(node, portName, nodes, edges) {
      if (!Array.isArray(edges) || !Array.isArray(nodes)) return [];
      const NodeTpl = window.NodeTemplates;

      // Lookup port[0].name của node (cho backward-compat fallback 'default')
      const getFirstInPort = (n) => {
        if (!n || !NodeTpl?.getNodePorts) return null;
        const type = n.node_type || n.type;
        const ports = NodeTpl.getNodePorts(type, n) || { in: [] };
        return ports.in?.[0]?.name || null;
      };
      const getFirstOutPort = (n) => {
        if (!n || !NodeTpl?.getNodePorts) return null;
        const type = n.node_type || n.type;
        const ports = NodeTpl.getNodePorts(type, n) || { out: [] };
        return ports.out?.[0]?.name || null;
      };

      // Filter edges trỏ vào port `portName` của node hiện tại
      // 2026-06-02: Server-Only — backend sort edges theo pos_y/pos_x source node, frontend trust as-is.
      const portEdges = edges.filter((e) => {
        if (e.target_node_id !== node.node_id) return false;
        const tgtPort = e.target_port;
        if (!tgtPort || tgtPort === 'default') {
          // Edge cũ → default map sang port đầu tiên của node hiện tại
          const firstPort = getFirstInPort(node);
          return firstPort === portName;
        }
        return tgtPort === portName;
      });

      const result = [];
      for (const edge of portEdges) {
        const upstream = nodes.find((n) => n.node_id === edge.source_node_id);
        if (!upstream) continue;

        // Resolve source port: edge cũ → port out đầu tiên của upstream
        let sourcePortName = edge.source_port;
        if (!sourcePortName || sourcePortName === 'default') {
          sourcePortName = getFirstOutPort(upstream) || 'default';
        }

        const data = this._getNodeOutputForPort(upstream, sourcePortName);
        if (data === null || data === undefined) continue;

        if (Array.isArray(data)) {
          result.push(...data);
        } else if (typeof data === 'string') {
          // Text port → giữ nguyên cả khi rỗng (caller tự filter)
          if (data.trim()) result.push(data.trim());
          else result.push(data);
        }
      }
      return result;
    }

    /**
     * Phase WK-1.4.2: Lấy output của 1 node theo source port name.
     * Trả mảng tile IDs (cho image/video/media), string text (cho text), hoặc null.
     *
     * @param {Object} node - Node upstream
     * @param {String} portName - Tên output port của upstream
     * @returns {Array|String|null}
     */
    _getNodeOutputForPort(node, portName) {
      if (!node) return null;
      const splitIds = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
      // Bug fix: Lọc bỏ upload_xxx keys (local files chưa upload) khỏi ref_file_ids
      // để không truyền sang downstream nodes khi run single node.
      const filterUploadKeys = (ids) => ids.filter((id) => !id.startsWith('upload_'));

      // 2026-05-27 fix: Image node = ref-source thuần → output LUÔN là ref_file_ids (ảnh user
      // đang chọn/vừa thêm). result_file_ids của image node chỉ là legacy mirror (= ref đầu tiên cũ),
      // KHÔNG cập nhật khi add ảnh → nếu ưu tiên nó sẽ BỎ SÓT ảnh mới (downstream chatgpt/grok/generate
      // chỉ nhận ref cũ). Áp cho mọi port (trừ 'text'). Fallback result_file_ids nếu ref rỗng.
      if ((node.node_type || node.type) === 'image' && portName !== 'text') {
        const thumbs = node.ref_thumbnails || {};
        const refIds = filterUploadKeys(splitIds(node.ref_file_ids));
        // Bug fix 2026-05-27: ref_file_ids có thể LỆCH key ref_thumbnails (stale tile-ID correction
        // cập nhật không đồng bộ — vd ref_file_ids=fe_id_A nhưng thumbnail keyed fe_id_B). Downstream
        // grok/chatgpt resolve thumbnail THEO id → miss → "ref skip" → 0 ref upload. Fix: ưu tiên id
        // CÓ thumbnail (ảnh thật, upload được); nếu KHÔNG id nào có thumbnail nhưng node có thumbnail
        // keys → ref_file_ids stale → dùng thumbnail keys. Giữ cả upload_xxx có thumbnail (ảnh mới
        // local — downstream uploadPendingFiles xử lý). [[reference: id ≠ thumbnail key mismatch]]
        if (refIds.some((id) => thumbs[id])) return refIds;
        const thumbKeys = Object.keys(thumbs);
        // Bug fix (double ref): thumbnail keys CHỈ thay refIds khi SỐ LƯỢNG KHỚP — cùng số ảnh, chỉ
        // lệch key do stale tile-ID correction. Nếu thumbKeys NHIỀU/ÍT hơn refIds (vd image node 1 ref
        // nhưng 2 thumbnail key leftover sau reload) → trả thumbKeys sẽ NHÂN ĐÔI ảnh downstream.
        // refIds = nguồn canonical (số ảnh user chọn) → ưu tiên giữ đúng số lượng. Thumbnail cho
        // refIds được merge từ src.result_thumbnails ở port-merge (line ~4068) + fallback MediaRegistry.
        if (refIds.length > 0) {
          return thumbKeys.length === refIds.length ? thumbKeys : refIds;
        }
        if (thumbKeys.length > 0) return thumbKeys;
        return splitIds(node.result_file_ids);
      }

      // Issue #69-7 fix: 'default' fallback — lookup port[0] type của node để biết text vs media.
      // Trước: trả luôn result_file_ids → prompt node text bị mất.
      if (!portName || portName === 'default') {
        const nodeType = node.node_type || node.type;
        const portsCfg = (typeof window.NodeTemplates?.getNodePorts === 'function')
          ? window.NodeTemplates.getNodePorts(nodeType, node) : null;
        const firstOut = portsCfg?.out?.[0];
        if (firstOut?.type === 'text') return node.result_text || '';
        // Default OR media-like → file_ids
        const ids = splitIds(node.result_file_ids);
        if (ids.length === 0 && nodeType === 'image' && node.ref_file_ids) {
          return filterUploadKeys(splitIds(node.ref_file_ids));
        }
        return ids;
      }

      // Image/video/media outputs → result_file_ids
      if (['media', 'image_out', 'pass', 'any_out', 'video_out', 'frame_out'].includes(portName)) {
        const ids = splitIds(node.result_file_ids);
        // Image source node chưa execute → fallback ref_file_ids (lọc bỏ local upload keys)
        if (ids.length === 0 && node.node_type === 'image' && node.ref_file_ids) {
          return filterUploadKeys(splitIds(node.ref_file_ids));
        }
        return ids;
      }

      // Text output (Prompt node) → result_text
      if (portName === 'text') {
        // Bug fix: khi user run single node, upstream Prompt node chưa execute → result_text rỗng.
        // Fallback về node.prompt gốc cho MỌI trường hợp (cả enhance=ON và OFF).
        // Trước: chỉ fallback khi enhance=false → upstream enhance=true mà chưa execute → downstream nhận empty.
        if (!node.result_text && node.node_type === 'prompt') {
          return (node.prompt || '').trim();
        }
        return node.result_text || '';
      }

      // Image source node truyền ref_file_ids khi chưa có result (lọc bỏ local upload keys)
      if (node.node_type === 'image') {
        const r = splitIds(node.result_file_ids);
        if (r.length > 0) return r;
        return filterUploadKeys(splitIds(node.ref_file_ids));
      }

      // Fallback: trả result_file_ids
      return splitIds(node.result_file_ids);
    }

    /**
     * Build file_name lookup map cho addFileToPrompt fallback.
     * Gom result_file_names từ node hiện tại + tất cả upstream nodes.
     * @returns {Object} { fileId: fileName }
     */
    _buildFileNameLookup(node, workflow) {
      const lookup = {};
      if (!workflow?.nodes) return lookup;
      const currentId = node?.node_id;
      // Từ tất cả nodes trong workflow (upstream + current)
      for (const n of workflow.nodes) {
        if (n.result_file_names) {
          Object.assign(lookup, n.result_file_names);
        }
        if (n.result_frame_thumbnails && typeof n.result_frame_thumbnails === 'object') {
          for (const [fileId, metadata] of Object.entries(n.result_frame_thumbnails)) {
            if (metadata?.file_name) lookup[fileId] = metadata.file_name;
          }
        }
        // Image nodes keep user-selected media names in ref_file_names. Skip the
        // current node because its cached keys may already be stale after re-upload.
        if (n.ref_file_names && n.node_id !== currentId) {
          Object.assign(lookup, n.ref_file_names);
        }
      }
      return lookup;
    }

    /**
     * Build the media-name map sent to the generation pipeline.
     * Direct image sources are applied last so their canonical names win over stale
     * names cached on the current node.
     */
    _buildPipelineRefNames(node, workflow) {
      const refNames = { ...(node?.ref_file_names || {}) };
      const nodes = workflow?.nodes || [];

      for (const sourceNode of nodes) {
        if (sourceNode?.result_file_names && typeof sourceNode.result_file_names === 'object') {
          Object.assign(refNames, sourceNode.result_file_names);
        }
      }

      for (const edge of (workflow?.edges || []).filter(edge => edge.target_node_id === node?.node_id)) {
        const sourceNode = nodes.find(candidate => candidate.node_id === edge.source_node_id);
        if (sourceNode?.ref_file_names && typeof sourceNode.ref_file_names === 'object') {
          Object.assign(refNames, sourceNode.ref_file_names);
        }
      }

      return refNames;
    }

    /**
     * Collect frame 1 & frame 2 file IDs cho Video+Frames node
     * Mỗi frame có thể từ: node source (lấy output) hoặc manual (file_id cố định)
     */
    _collectFrameFileIds(node, nodes) {
      const result = { frame1: null, frame2: null };

      // Guard: return empty if nodes undefined
      if (!nodes || !Array.isArray(nodes)) {
        return result;
      }

      // Frame 1
      if (node.frame_1_source === 'manual') {
        result.frame1 = node.frame_1_file_id || null;
      } else if (node.frame_1_source) {
        const sourceNode = nodes.find(n => n.node_id === node.frame_1_source);
        if (sourceNode?.result_file_ids) {
          const ids = (sourceNode.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          result.frame1 = this._cleanMediaId(ids[0]); // Lấy ảnh đầu tiên từ output
        }
      }

      // Frame 2
      if (node.frame_2_source === 'manual') {
        result.frame2 = node.frame_2_file_id || null;
      } else if (node.frame_2_source) {
        const sourceNode = nodes.find(n => n.node_id === node.frame_2_source);
        if (sourceNode?.result_file_ids) {
          const ids = (sourceNode.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          result.frame2 = this._cleanMediaId(ids[0]);
        }
      }

      log('Frame file IDs:', result);
      return result;
    }

    /**
     * Chuẩn hoá 1 media_id trước khi dùng làm khung/ref.
     * Flow đôi khi trả dạng "CAMS…" bọc quanh UUID; đưa nguyên chuỗi đó đi tiếp thì
     * nhận lại "Requested entity was not found" — lỗi không ai đoán được là do định dạng.
     * Rút được UUID thì dùng UUID; không rút được thì giữ NGUYÊN chuỗi gốc (để hành vi
     * cũ không đổi) nhưng ghi log để còn lần ra.
     */
    _cleanMediaId(id) {
      if (!id) return null;
      const PH = window.PromptHygiene;
      if (!PH?.repairMediaId) return id;
      const r = PH.repairMediaId(id);
      if (r.ok) {
        if (r.fixed) console.warn('[WorkflowExecutor] media_id không chuẩn, đã rút UUID:', id, '→', r.id);
        return r.id;
      }
      console.warn('[WorkflowExecutor] media_id không chứa UUID (' + r.reason + '):', id);
      return id;
    }

    /**
     * Execute single node với retry logic (via RetryHelper)
     */
    /**
     * Dọn metadata riêng tư TRƯỚC khi file rời máy... thực ra là trước khi nó vào thư mục
     * Downloads, nơi bạn sẽ kéo thẳng lên mạng xã hội. Gỡ GPS, số sê-ri máy, tên chủ sở
     * hữu, đường dẫn máy, và PROMPT mà nhiều công cụ AI nhét kèm ảnh.
     *
     * Trả về URL để dùng thay chỗ cũ. Hỏng bất kỳ khâu nào → trả URL GỐC: người dùng bấm
     * tải là muốn có FILE, thà nhận file còn metadata còn hơn không nhận gì.
     * Tắt được ở Settings (af_settings.scrubMetadata = false).
     */
    async _scrubForDownload(url, log) {
      return await (window.scrubbedDownloadUrl?.(url, log) ?? url);
    }

    /**
     * Lọc ô hỏng, và THỬ CỨU trước khi bỏ.
     *
     * Cách cứu là bấm NÚT THỬ LẠI CỦA CHÍNH FLOW trên ô đó, không phải gửi lại prompt: gửi
     * lại prompt tốn thêm credit, mà nếu bị chặn vì nội dung thì lần nào cũng chặn.
     *
     * Ô nào cứu không được thì LOẠI khỏi danh sách trả về — để nó lọt xuống node Download là
     * sinh file .htm rác. Nhưng phải BÁO RÕ số ô mất, đừng lặng lẽ trả ít hơn: người dùng đặt
     * 6 ảnh mà nhận 5 thì cần biết vì sao.
     *
     * @returns {Promise<string[]>} chỉ những ô có media thật
     */
    async _rescueFailedTiles(tileIds, log) {
      const ids = (tileIds || []).filter(Boolean);
      if (!ids.length || !window.MessageBridge?.sendToContentScript) return ids;
      const status = async (id) => {
        try {
          const r = await window.MessageBridge.sendToContentScript('detectTileStatus', { tileId: id });
          return r?.status || 'failed';
        } catch (_e) { return 'success'; }   // hỏi không được → coi như ổn, đừng vứt ô có thể tốt
      };
      const good = [], bad = [];
      for (const id of ids) ((await status(id)) === 'failed' ? bad : good).push(id);
      if (!bad.length) return good;

      log?.(`${bad.length} ô gen hỏng — thử lại bằng nút của Flow…`, 'warn');
      let saved = [];
      try {
        const r = await window.MessageBridge.sendToContentScript('retryFailedTilesViaButton', {
          failedTileIds: bad, timeout: this.settings?.tileTimeout || 120000,
        });
        saved = (r && r.succeeded) || [];
      } catch (e) {
        log?.(`Không thử lại được: ${e?.message || e}`, 'warn');
      }
      const lost = bad.length - saved.length;
      if (lost > 0) {
        log?.(`${lost} ô vẫn hỏng sau khi thử lại — bỏ qua, KHÔNG tải. Nếu Flow báo vi phạm chính sách thì phải sửa prompt, thử lại bao nhiêu lần cũng vậy.`, 'warn');
      }
      return good.concat(saved);
    }

    /** Giới hạn tốc độ lấy từ config (api_rate_limits) — có mặc định an toàn nếu thiếu. */
    _rateLimits() {
      return window.ProviderConfigManager?.getRateLimitsSync?.('flow') || {};
    }

    /** Cầu chì dùng chung cho cả lần chạy. Tạo trễ để lấy đúng config lúc chạy. */
    _circuit() {
      if (!this._circuitBreaker && window.SEOSONA_RetryPolicy?.createCircuitBreaker) {
        this._circuitBreaker = window.SEOSONA_RetryPolicy.createCircuitBreaker(this._rateLimits());
      }
      return this._circuitBreaker || null;
    }

    /**
     * Mạch đang mở → nghỉ cho hết chu kỳ trước khi gửi request tiếp.
     * Nghỉ theo lát 500ms để nút Dừng vẫn ngắt được ngay.
     */
    async _awaitCircuitBreaker(nodeLog) {
      const cb = this._circuit();
      if (!cb) return;
      let left = cb.isOpen(Date.now()) ? cb.remainingMs(Date.now()) : 0;
      if (left <= 0) return;
      nodeLog?.(`Tạm nghỉ ${Math.ceil(left / 1000)}s — quá nhiều lỗi liên tiếp, gửi tiếp sẽ càng bị chặn.`, 'warn');
      while (left > 0 && !this.shouldStop) {
        await new Promise((r) => setTimeout(r, Math.min(500, left)));
        left = cb.isOpen(Date.now()) ? cb.remainingMs(Date.now()) : 0;
      }
    }

    /**
     * Ghi nhận 1 lần gen hỏng: phân loại lỗi, đánh dấu noRetry cho loại thử lại vô ích
     * (RetryHelper đọc cờ này để thoát sớm), và cộng vào cầu chì.
     */
    _noteGenFailure(err, nodeLog) {
      const RP = window.SEOSONA_RetryPolicy;
      // Chỉ tin phân loại từ eventBus nếu nó vừa xảy ra (≤90s) và dùng MỘT LẦN — giống
      // cách content.js xử _lastFlowGenError. Giữ mãi thì một lần captcha ở node #3 sẽ
      // gắn nhầm cho node #7 hỏng vì lý do khác, rồi chặn oan cả workflow.
      let recent = null;
      if (this._lastFlowErrCategory && (Date.now() - (this._lastFlowErrAt || 0)) <= 90000) {
        recent = this._lastFlowErrCategory;
      }
      this._lastFlowErrCategory = null;
      const cat = err?.category || err?.reason || err?.code || recent || null;
      const verdict = RP?.classifyFailure ? RP.classifyFailure(cat) : { action: 'retry', counts: true };
      err.errorCategory = verdict.category;
      if (verdict.action === 'terminal' || verdict.action === 'halt') {
        // Hết quota / sai tầng / bị chặn nội dung / bị gắn cờ — thử lại không đổi kết quả.
        err.noRetry = true;
        nodeLog?.(`Không thử lại (${verdict.category}): thử lại cũng ra cùng kết quả.`, 'warn');
      }
      // 'requeue' (ref hết hạn, rớt kết nối) KHÔNG tính vào cầu chì: đó là sự cố vận
      // chuyển, không phải dấu hiệu Google đang chặn.
      if (verdict.action !== 'requeue') {
        const cb = this._circuit();
        if (cb?.recordFailure(Date.now())) {
          nodeLog?.('Đã ' + cb.stats().threshold + ' lỗi liên tiếp — tạm ngưng gửi để tránh bị gắn cờ.', 'warn');
        }
      }
    }

    async _executeNode(node, workflow) {
      // Reset cờ dedup thông báo gen-fail cho lần run mới (cho phép báo lại nếu chạy lại node).
      delete node._genFailNotified;
      // Per-node accumulators — tránh cross-contamination khi parallel execution
      const nodeAccum = { thumbnails: {}, fileNames: {} };
      // Store in per-node Map (parallel-safe) + legacy shared fallback
      if (!this._nodeAccumMap) this._nodeAccumMap = new Map();
      this._nodeAccumMap.set(node.node_id, nodeAccum);
      this._currentNodeAccum = nodeAccum;
      // Legacy fallback (sequential mode vẫn dùng shared)
      this._lastTileThumbnails = {};
      this._lastTileFileNames = {};
      const nodeLog = (message, type = 'info') => {
        emitLog({ nodeId: node.node_id, message, type });
      };

      const GEN_TYPES = ['generate', 'chatgpt', 'grok'];
      const isGen = GEN_TYPES.includes(node.node_type);
      const limits = this._rateLimits();

      return window.RetryHelper.execute(
        async ({ attempt, totalAttempts }) => {
          if (attempt > 1) {
            nodeLog(`Thử lại lần ${attempt}/${totalAttempts}...`, 'warn');
          }
          // Cầu chì: nhiều lỗi liên tiếp = Google đang chặn. Gửi tiếp chỉ làm nặng thêm,
          // nên nghỉ hết chu kỳ rồi mới đi tiếp (nghỉ được ngắt bằng nút Dừng).
          if (isGen) await this._awaitCircuitBreaker(nodeLog);
          log(`Executing node "${node.node_name}" (attempt ${attempt}/${totalAttempts})`);
          try {
            const out = await this._executeNodeInternal(node, workflow, nodeAccum);
            if (isGen) this._circuit()?.recordSuccess();
            return out;
          } catch (err) {
            if (isGen) this._noteGenFailure(err, nodeLog);
            throw err;
          }
        },
        {
          label: `Node "${node.node_name}"`,
          maxRetries: this.settings.retryOnFail ? this.settings.maxRetries : 0,
          // Gen node dùng backoff theo api_rate_limits (10s→300s) thay vì retryDelay
          // mặc định của UI: chạy gấp là đường ngắn nhất tới UNUSUAL_ACTIVITY.
          retryDelay: isGen ? (limits.baseBackoffMs || 10000) : this.settings.retryDelay,
          // Phase 5.2: Check per-node submitted tracking
          shouldStop: () => this.shouldStop && !(this._submittedNodes && this._submittedNodes.has(node.node_id)),
          onRetry: (attempt, maxRetries, error) => {
            nodeLog(`Lỗi: ${error.message}`, 'error');
            const waitSec = Math.round(this.settings.retryDelay / 1000);
            nodeLog(`Chờ ${waitSec}s trước khi thử lại...`, 'warn');
          },
          onFail: (error, attempts) => {
            nodeLog(`Thất bại sau ${attempts} lần thử`, 'error');
            // Gen node fail HẲN sau hết retry → báo user rõ là PROVIDER gen fail (không phải lỗi
            // extension) + kiểm tra tab provider. Non-blocking, context-aware (sidebar/editor), i18n.
            if (['generate', 'chatgpt', 'grok'].includes(node.node_type)) {
              this._notifyGenFailed(node, attempts);
            }
          }
        }
      );
    }

    /**
     * Internal node execution - tương tác với Google Flow UI
     */
    async _executeNodeInternal(node, workflow, nodeAccum = null) {
      const startTime = Date.now();
      const quantity = node.quantity || 1;
      const allNewTileIds = [];

      // Helper emit log cho UI
      const nodeLog = (message, type = 'info') => {
        emitLog({ nodeId: node.node_id, message, type });
      };

      // === NOTE NODE (no-op) — không cần ProviderTabLock ===
      if (node.node_type === 'note') {
        return { fileIds: [], duration: 0 };
      }

      // Phase CG-8b: Acquire tab lock theo provider của node trước khi tương tác DOM.
      // Mixed-provider workflow (Flow + ChatGPT) tự serialize qua lock này.
      const tabRelease = await this._acquireLockForNodeType(node);

      // Per-node Flow ExecutionBlocker: chỉ show khi node 'generate' (Flow) chạy.
      // ChatGPT/Grok content scripts tự show blocker inline trên tab của họ.
      // Skip khi PromptQueue ON (PQ tự gửi pq:showBlocker/hideBlocker — tránh double).
      // Hide debounced 300ms ở content.js → 2 generate node liên tiếp không flicker.
      const shouldBlockFlow = node.node_type === 'generate'
        && !window.PromptQueue?.isEnabled?.()
        && !!window.MessageBridge;
      if (shouldBlockFlow) {
        window.MessageBridge.sendToContentScript('pq:showBlocker', {}).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#nodeLog', _e); });
      }

      try {
        return await this._executeNodeDispatch(node, workflow, nodeAccum, nodeLog, startTime);
      } finally {
        if (shouldBlockFlow) {
          window.MessageBridge.sendToContentScript('pq:hideBlocker', {}).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#nodeLog', _e); });
        }
        if (tabRelease) {
          try { tabRelease(); } catch (e) { /* swallow */ }
        }
        // Bug fix: Restore original ref state để KHÔNG persist port-merged values xuống storage.
        // Port-merged values chứa data của source nodes — chỉ valid runtime, không phải user-input.
        if (node._original_ref_state) {
          node.ref_file_ids = node._original_ref_state.ref_file_ids;
          node.ref_thumbnails = node._original_ref_state.ref_thumbnails;
          node.ref_file_names = node._original_ref_state.ref_file_names;
          delete node._original_ref_state;
        }
        // Defensive: dù _original_ref_state có/không, LUÔN strip port-merged refs khỏi ref_file_ids
        // (phòng path không set _original_ref_state) → tuyệt đối không leak ref upstream vào node.
        if (node._portMergedRefIds && node._portMergedRefIds.size > 0 && typeof node.ref_file_ids === 'string') {
          node.ref_file_ids = node.ref_file_ids.split(',').map(s => s.trim())
            .filter(id => id && !node._portMergedRefIds.has(id)).join(', ');
        }
        delete node._portMergedRefIds;
      }
    }

    /**
     * Phase CG-8b: Tách dispatch logic ra method riêng để wrap trong tab lock.
     * Body method này GIỮ NGUYÊN dispatch cũ (note đã return ở caller).
     */
    async _executeNodeDispatch(node, workflow, nodeAccum, nodeLog, startTime) {
      const quantity = node.quantity || 1;
      const allNewTileIds = [];

      // === PROMPT NODE (Phase CG-8) — chứa text + tuỳ chọn enhance qua LLM ===
      // Đặt trước correctUpstream vì prompt node KHÔNG cần ref images / file_ids upstream.
      if (node.node_type === 'prompt') {
        return this._executePromptNode(node, workflow, nodeLog);
      }

      // === TEXT EXTRACT NODE (2026-05-29) — pure regex/JSON parse, no AI call ===
      // Đặt trước correctUpstream vì text_extract chỉ cần text upstream (không cần file_ids).
      if (node.node_type === 'text_extract') {
        return this._executeTextExtractNode(node, workflow, nodeLog, startTime);
      }

      // === TEXT TEMPLATE NODE — ghép text upstream vào mẫu {{input}}/{{inputN}} (pure string, no AI).
      // Đặt sớm như text_extract: chỉ cần text upstream, bypass toàn bộ logic generate/prompt_source.
      if (node.node_type === 'text_template') {
        return this._executeTextTemplateNode(node, workflow, nodeLog);
      }

      // === RANDOM PICK NODE — chọn ngẫu nhiên 1 text upstream (pure data, đặt sớm như text_template).
      if (node.node_type === 'random_pick') {
        return this._executeRandomPickNode(node, workflow, nodeLog);
      }

      // === PROMPT SEQUENCE NODE — tách blob nhiều scene → danh sách prompt (pure string, no AI).
      if (node.node_type === 'prompt_sequence') {
        return this._executePromptSequenceNode(node, workflow, nodeLog);
      }

      // === VARIANT EXPAND NODE — 1 prompt gốc × danh sách modifier → N biến thể (pure string, no AI).
      if (node.node_type === 'variant_expand') {
        return this._executeVariantExpandNode(node, workflow, nodeLog);
      }

      // === LOOP / BATCH NODE — nhận danh sách (scene/prompt) → lưu result_items[] + đếm (pure data).
      if (node.node_type === 'loop') {
        return this._executeLoopNode(node, workflow, nodeLog);
      }

      // === CONDITION NODE — đánh giá điều kiện → chọn nhánh + skip nhánh không chọn (gated).
      if (node.node_type === 'condition') {
        return this._executeConditionNode(node, workflow, nodeLog);
      }

      // === SWITCH NODE — khớp giá trị → chọn 1 trong 4 port (case1/2/3/else) + skip nhánh khác (gated).
      if (node.node_type === 'switch') {
        return this._executeSwitchNode(node, workflow, nodeLog);
      }

      // === MERGE NODE — gộp text + file từ nhiều input → PASS-THROUGH (KHÔNG submit generation).
      // Trước fix: merge không có case → rơi vào generate path → bắn 1 prompt RỖNG (lãng phí + sai).
      if (node.node_type === 'merge') {
        return this._executeMergeNode(node, workflow, nodeLog);
      }

      // === TEXT OVERLAY — overlay chữ vector deterministic lên ảnh upstream (diệt rớt-chữ). ===
      if (node.node_type === 'text_overlay') {
        return this._executeTextOverlayNode(node, workflow, nodeLog);
      }

      // === TEXT QA — OCR ảnh upstream + đối chiếu chuỗi mong đợi → verdict (pass-through ảnh). ===
      if (node.node_type === 'text_qa') {
        return this._executeTextQaNode(node, workflow, nodeLog);
      }

      // === STYLE ANCHOR — chèn khối phong cách vào MỌI prompt upstream để loạt ảnh nhất quán. ===
      if (node.node_type === 'style_anchor') {
        return this._executeStyleAnchorNode(node, workflow, nodeLog);
      }

      // === Correct upstream result_file_ids cho tất cả node types cần input (kể cả delay pass-through) ===
      const needsInput = ['generate', 'download', 'telegram', 'image', 'delay', 'chatgpt', 'grok'];
      if (needsInput.includes(node.node_type)) {
        // Correct upstream nodes (result_file_ids từ node trước)
        await this._correctUpstreamNodeIds(node, workflow, nodeLog);
      }

      // === SAVE ORIGINAL PROMPT FOR MENTION RESOLUTION ===
      // Khi prompt_mode='mention', cần giữ prompt gốc của node để tìm @mentions
      // trước khi bị override bởi upstream prompt.
      const originalNodePrompt = node.prompt || '';

      // === AUTO-DETECT prompt_source (Bug fix: UI auto-detect không persist) ===
      // Khi user tạo node mới + connect Prompt node nhưng không touch toggle
      // → prompt_source vẫn undefined → execution không pull upstream prompt.
      // Fix: auto-detect giống UI logic.
      // Bug fix 2: handle CẢ null (sau DB save → Eloquent trả null) lẫn undefined.
      // Trước fix: extension export prompt_source undefined → backend save null → DB null →
      // reload null → auto-detect (=== undefined) skip → port-based override (=== 'upstream_node')
      // skip → auto-override (=== 'textbox') skip → submit empty prompt → bug "no prompt".
      if (['generate', 'chatgpt', 'grok'].includes(node.node_type) &&
          (node.prompt_source === undefined || node.prompt_source === null)) {
        const hasUpstreamPromptNode = (workflow.edges || []).some(e => {
          if (e.target_node_id !== node.node_id) return false;
          const srcNode = workflow.nodes.find(n => n.node_id === e.source_node_id);
          // 2026-05-31: thêm text_extract — node này output text result để feed downstream.
          return srcNode && ['prompt', 'text', 'text_extract', 'text_template', 'random_pick', 'prompt_sequence', 'variant_expand', 'loop', 'style_anchor'].includes(srcNode.node_type);
        });
        // Bug fix 2026-06-22: guard own-prompt — đồng bộ với healer/editor auto-switch.
        // Trước: chỉ cần có edge prompt → flip 'upstream_node', BỎ QUA own prompt.
        // → node có prompt riêng (non-empty) + connected prompt node = vẫn bị lấy upstream
        //   dù user bật "use own prompt" (prompt_source null vì toggle không persist / MCP-created).
        // Nay: own prompt non-empty → ưu tiên 'textbox'; chỉ flip 'upstream_node' khi textbox RỖNG.
        const hasOwnPrompt = !!(node.prompt || '').trim();
        if (hasUpstreamPromptNode && !hasOwnPrompt) {
          node.prompt_source = 'upstream_node';
          nodeLog('Auto-detect prompt_source = upstream_node (textbox rỗng + có Prompt/Text/TextExtract connected)');
        } else {
          node.prompt_source = 'textbox';
          if (hasUpstreamPromptNode) {
            nodeLog('Auto-detect prompt_source = textbox (node có prompt riêng → ưu tiên own prompt dù có upstream connected)');
          }
        }
      }

      // === AUTO-OVERRIDE prompt_source khi stale (Bug fix 2026-05-20) ===
      // Case: user tạo node mới (default prompt_source='textbox') → save → sau đó
      // connect Prompt node vào port "text" nhưng KHÔNG vào form edit + tắt toggle
      // "Use own prompt" → prompt_source vẫn persist 'textbox' với textbox rỗng.
      // → Runtime resolution skip upstream → submit prompt rỗng → Flow navigate
      // về homepage / ChatGPT submit silent.
      // Fix: nếu prompt_source='textbox' + textbox RỖNG + có upstream Prompt/Text
      // connected vào port hợp lệ (null/default/text) → override 'upstream_node'.
      // Toggle UI sẽ tự động update next render (load đọc node.prompt_source mới).
      if (
        ['generate', 'chatgpt', 'grok'].includes(node.node_type) &&
        node.prompt_source === 'textbox' &&
        !(node.prompt || '').trim()
      ) {
        const hasUpstreamTextEdge = (workflow.edges || []).some(e => {
          if (e.target_node_id !== node.node_id) return false;
          const tgtPort = e.target_port;
          if (tgtPort && tgtPort !== 'default' && tgtPort !== 'text') return false;
          const srcNode = workflow.nodes.find(n => n.node_id === e.source_node_id);
          // 2026-05-31: thêm text_extract — node output text result.
          if (!srcNode || !['prompt', 'text', 'text_extract', 'text_template', 'random_pick', 'prompt_sequence', 'variant_expand', 'loop', 'style_anchor'].includes(srcNode.node_type)) return false;
          const text = (srcNode.result_text || srcNode.prompt || '').trim();
          return text.length > 0;
        });
        if (hasUpstreamTextEdge) {
          nodeLog(
            `Auto-override prompt_source: "textbox" → "upstream_node" cho node "${node.node_name}" ` +
            `(textbox rỗng + có upstream Prompt connected vào port "text")`,
            'warn'
          );
          node.prompt_source = 'upstream_node';
        }
      }

      // === PORT-BASED PROMPT OVERRIDE (Phase WK-1.4.3) ===
      // Ưu tiên port `text` edge từ upstream nodes.
      // Gộp TẤT CẢ upstream text inputs: prompt nodes ở trên, text nodes ở dưới.
      // CHỈ override khi prompt_source = 'upstream_node' (user turn off "use own prompt")
      let portTextOverridden = false;
      if (['generate', 'chatgpt', 'grok'].includes(node.node_type) && node.prompt_source === 'upstream_node') {
        try {
          // Dùng helper _combineUpstreamTexts (đồng bộ với prompt node) — gộp tất cả upstream
          // text, sort prompt-first, truncate maxLen.
          const combinedResult = this._combineUpstreamTexts(node, workflow);
          if (combinedResult) {
            node.prompt = combinedResult.text;
            node._effective_prompt = combinedResult.text;
            nodeLog(`Prompt từ ${combinedResult.sources.length} upstream(s): ${combinedResult.sources.map(u => u.nodeName).join(', ')}`);
            portTextOverridden = true;
          }
        } catch (err) {
          nodeLog('Lỗi collect port "text": ' + err.message, 'warn');
        }
      }

      // === PROMPT SOURCE OVERRIDE (Phase CG-8 — legacy fallback) ===
      // Chỉ chạy nếu PORT-BASED chưa override (workflow cũ không có port edge).
      if (
        !portTextOverridden &&
        ['generate', 'chatgpt', 'grok'].includes(node.node_type) &&
        node.prompt_source === 'upstream_node'
      ) {
        try {
          const { text: effectivePrompt, source } = this._resolveEffectivePrompt(node, workflow);
          node._effective_prompt = effectivePrompt;
          if (effectivePrompt) {
            nodeLog(`Prompt source (legacy field): ${source} (len=${effectivePrompt.length})`);
            node.prompt = effectivePrompt;
          } else if (source === 'textbox_fallback') {
            nodeLog('Upstream prompt không có — fallback sang textbox prompt', 'warn');
          }
        } catch (err) {
          nodeLog('Resolve upstream prompt lỗi: ' + err.message, 'error');
          throw err;
        }
      }

      // === GUARD: prompt rỗng khi user expect upstream ===
      // Nếu prompt_source='upstream_node' nhưng resolution không tìm thấy text
      // (edge thiếu, srcNode result_text rỗng, port type mismatch) → fail fast với
      // error rõ ràng. Tránh: Flow submit prompt rỗng → navigate về homepage →
      // content script unload → 0 tile (user thấy "đứng im" hoặc "redirect").
      // Cùng pattern cho ChatGPT (silent submit empty editor) + Grok.
      if (
        ['generate', 'chatgpt', 'grok'].includes(node.node_type) &&
        node.prompt_source === 'upstream_node' &&
        !portTextOverridden &&
        !(node.prompt || '').trim()
      ) {
        nodeLog(
          `Prompt rỗng: node "${node.node_name}" cấu hình lấy prompt từ upstream nhưng không tìm thấy text. ` +
          `Kiểm tra: (1) đã connect Prompt/Text node vào port "text" chưa, (2) upstream node có nội dung không.`,
          'error'
        );
        const err = new Error('EMPTY_UPSTREAM_PROMPT: ' + (node.node_name || node.node_id));
        err.code = 'EMPTY_UPSTREAM_PROMPT';
        err.noRetry = true;
        node.last_error = 'EMPTY_UPSTREAM_PROMPT';
        throw err;
      }

      // === @MENTION RESOLUTION (Phase 2 Node Reference System) ===
      // Resolve @slug mentions trong prompt nếu prompt_mode='mention'
      // CHỈ chạy khi user "use own prompt" (textbox) — skip nếu dùng upstream/port input
      const useOwnPrompt = node.prompt_source !== 'upstream_node' && !portTextOverridden;
      // Gap B fix: chạy pass mention cả khi prompt_mode='all' NHƯNG ref_mode='mention' — để strip
      // literal "@image_2" khỏi prompt text (resolvePromptMentions tự quyết substitute vs strip).
      const needPromptMentionPass = node.prompt_mode === 'mention' || node.ref_mode === 'mention';
      if (NODES_CAN_USE_MENTIONS.includes(node.node_type) && needPromptMentionPass && useOwnPrompt) {
        try {
          const nodesBySlug = buildNodesBySlug(workflow.nodes);
          console.log(`[Mention prompt_mode] originalNodePrompt (first 200 chars): ${originalNodePrompt.substring(0, 200)}`);
          console.log(`[Mention prompt_mode] effective prompt (overridden): ${(node.prompt || '').substring(0, 200)}`);
          console.log(`[Mention prompt_mode] nodesBySlug keys: ${[...nodesBySlug.keys()].join(', ') || '(none)'}`);

          // Tạm set node.prompt về original để functions dùng đúng prompt
          const effectivePrompt = node.prompt;
          node.prompt = originalNodePrompt;

          // Validate mentions trước
          const { warnings, errors } = validateMentions(node, nodesBySlug);
          for (const w of warnings) {
            nodeLog(`[Mention] Warning: ${w.message}`, 'warn');
          }
          for (const e of errors) {
            nodeLog(`[Mention] Error: ${e.message}`, 'error');
          }

          // Resolve @text_slug và @prompt_slug thành actual text
          const resolvedPrompt = resolvePromptMentions(node, nodesBySlug);
          console.log(`[Mention prompt_mode] resolvedPrompt (first 200 chars): ${resolvedPrompt.substring(0, 200)}`);

          // Lưu original prompt với @mentions để ref_mode resolution dùng
          node._original_prompt_with_mentions = originalNodePrompt;

          if (resolvedPrompt !== originalNodePrompt) {
            nodeLog(`[Mention] Resolved prompt: ${resolvedPrompt.substring(0, 100)}${resolvedPrompt.length > 100 ? '...' : ''}`);
            node.prompt = resolvedPrompt;
            node._effective_prompt = resolvedPrompt;
          } else {
            // Không có @text/@prompt mentions → giữ effective prompt từ upstream
            node.prompt = effectivePrompt;
          }
        } catch (err) {
          nodeLog('[Mention] Lỗi resolve prompt mentions: ' + err.message, 'warn');
        }
      }

      // === @MENTION REF_MODE RESOLUTION (Phase 2 Node Reference System) ===
      // Nếu ref_mode='mention', chỉ lấy ref images từ @mentioned nodes.
      // CHỈ chạy khi user "use own prompt" — skip nếu dùng upstream/port input
      let mentionRefOverride = null;
      // Gap D fix 2026-05-27: BỎ điều kiện useOwnPrompt — ref_mode='mention' phải resolve @image
      // refs NGAY CẢ khi prompt_source='upstream_node' (user vừa @mention vừa nối edge prompt node →
      // auto-detect flip 'upstream_node' → trước đây skip → @image ref bị mất silent). @image mentions
      // nằm trong textbox gốc (originalNodePrompt), độc lập với nguồn prompt text.
      if (NODES_CAN_USE_MENTIONS.includes(node.node_type) && node.ref_mode === 'mention') {
        try {
          const nodesBySlug = buildNodesBySlug(workflow.nodes);
          if (!useOwnPrompt) {
            nodeLog('[Mention ref_mode] prompt_source=upstream_node — vẫn resolve @image refs từ textbox gốc (Gap D)', 'warn');
          }
          // Dùng _original_prompt_with_mentions (prompt_mode đã resolve), fallback originalNodePrompt
          // (Gap D: khi prompt_mode block skip → node.prompt đã bị upstream override, @image chỉ còn ở textbox gốc).
          const promptForMentions = node._original_prompt_with_mentions || originalNodePrompt || node.prompt || '';
          console.log(`[Mention ref_mode] promptForMentions (first 200 chars): ${promptForMentions.substring(0, 200)}`);
          console.log(`[Mention ref_mode] nodesBySlug keys: ${[...nodesBySlug.keys()].join(', ') || '(none)'}`);
          const foundMentions = parseMentions(promptForMentions);
          console.log(`[Mention ref_mode] parseMentions found: ${foundMentions.length > 0 ? foundMentions.join(', ') : '(none)'}`);

          // Tạm set prompt về original để parseMentions lấy đúng @slugs
          const currentPrompt = node.prompt;
          node.prompt = promptForMentions;

          mentionRefOverride = resolveMentionedRefImages(node, nodesBySlug);

          // Restore prompt
          node.prompt = currentPrompt;

          // DEBUG: verify mentionRefOverride
          console.log(`[Mention ref_mode] mentionRefOverride returned:`, mentionRefOverride);
          console.log(`[Mention ref_mode] mentionRefOverride is array: ${Array.isArray(mentionRefOverride)}, length: ${mentionRefOverride?.length}`);

          if (mentionRefOverride && mentionRefOverride.length > 0) {
            console.log(`[Mention ref_mode] ENTERING IF BLOCK — ${mentionRefOverride.length} ref image(s)`);
            nodeLog(`[Mention ref_mode] Chỉ sử dụng ${mentionRefOverride.length} ref image(s) từ @mentions`);

            // Lưu original ref state nếu chưa có
            if (!node._original_ref_state) {
              node._original_ref_state = {
                ref_file_ids: node.ref_file_ids || '',
                ref_thumbnails: { ...(node.ref_thumbnails || {}) },
                ref_file_names: { ...(node.ref_file_names || {}) },
              };
            }

            // Override ref_file_ids với mentioned refs
            const mentionFileIds = mentionRefOverride.map(r => r.fileId);
            node.ref_file_ids = mentionFileIds.join(', ');
            console.log(`[Mention ref_mode] SET node.ref_file_ids = "${node.ref_file_ids}"`);
            console.log(`[Mention ref_mode] mentionRefOverride details:`, mentionRefOverride.map(r => ({ fileId: r.fileId, hasThumbnail: !!r.thumbnail, hasFileName: !!r.fileName })));

            // Build thumbnails và file_names từ mentionRefOverride
            if (!node.ref_thumbnails || Array.isArray(node.ref_thumbnails)) node.ref_thumbnails = {};
            if (!node.ref_file_names || Array.isArray(node.ref_file_names)) node.ref_file_names = {};

            for (const ref of mentionRefOverride) {
              if (ref.thumbnail) node.ref_thumbnails[ref.fileId] = ref.thumbnail;
              if (ref.fileName) node.ref_file_names[ref.fileId] = ref.fileName;
            }

            // Bug 47 fix: Track source nodes cho từng ref để update sau reupload
            node._mentionRefSources = {};
            for (const ref of mentionRefOverride) {
              node._mentionRefSources[ref.fileId] = {
                sourceSlug: ref.sourceSlug,
                sourceNodeType: ref.sourceNodeType
              };
            }

            nodeLog(`[Mention ref_mode] ref_file_ids set to: ${node.ref_file_ids}`);
          } else if (mentionRefOverride && mentionRefOverride.length === 0) {
            nodeLog('[Mention ref_mode] Không có @image trong prompt — refs sẽ trống', 'warn');
            // Clear refs nếu ref_mode=mention nhưng không có @image
            if (!node._original_ref_state) {
              node._original_ref_state = {
                ref_file_ids: node.ref_file_ids || '',
                ref_thumbnails: { ...(node.ref_thumbnails || {}) },
                ref_file_names: { ...(node.ref_file_names || {}) },
              };
            }
            node.ref_file_ids = '';
            node.ref_thumbnails = {};
            node.ref_file_names = {};
          }
        } catch (err) {
          nodeLog('[Mention ref_mode] Lỗi resolve ref images: ' + err.message, 'warn');
        }
      }

      // === PORT-BASED IMAGE_REF MERGE (Phase WK-1.4.3-6) ===
      // Cho generate/chatgpt/grok/prompt: gộp tile IDs từ port `image_ref` vào node.ref_file_ids.
      // Workflow cũ (1 ref input) sẽ không có port edge → skip, dùng node.ref_file_ids hiện có.
      // Bug fix: Lưu original ref_file_ids/thumbnails/file_names vào _original_ref_state để restore
      // sau dispatch. Trước fix: mutate node.ref_file_ids → exportWorkflow persist port-merged value.
      // Bug fix 2: KHÔNG chỉ merge ref_file_ids mà phải merge ref_thumbnails + ref_file_names từ
      // source nodes (Image source). Trước: tile_id port-merged không có thumbnail → resolveRefs
      // base64 fail → Grok submit không có ref image dù log "merge: +1 ảnh".
      // Bug 1 fix (audit 2026-05): TRƯỚC ĐÂY filter loại bỏ edges từ Image source → Image →
      // ChatGPT/Grok edge silent fail (refs từ Image bị bỏ). Generate node lại nhận Image qua
      // `_collectInputFileIds` (line ~1692) → inconsistency. Giờ allow Image source để 3 provider
      // nhất quán: Image → Generate/ChatGPT/Grok đều work. Restore _original_ref_state ở finally
      // (line ~1990) đảm bảo port-merged values không persist xuống storage.
      // Phase 2: Skip nếu ref_mode='mention' đã override refs (mentionRefOverride !== null)
      if (['generate', 'chatgpt', 'grok', 'prompt'].includes(node.node_type) && mentionRefOverride === null) {
        try {
          // Filter edges vào image_ref/video_ref port (cho phép cả Image, Generate, ChatGPT, Grok source)
          // Bug fix: Thêm backward-compat cho edge cũ không có target_port - infer từ source node type
          // 2026-06-06: thêm `video_ref` cho Flow generate Video Ingredients (Omni Flash model
          // support ref video). Flow API mixed image+video refs vào cùng ref_file_ids batch — runtime
          // detect video qua `_hasRefVideo` check (line ~4859). Merge cùng path đơn giản nhất.
          const explicitImageRefEdges = (workflow.edges || []).filter((e) => {
            if (e.target_node_id !== node.node_id) return false;

            const sourceNode = workflow.nodes.find(n => n.node_id === e.source_node_id);

            // Direct match: explicit image_ref hoặc video_ref port
            if (e.target_port === 'image_ref' || e.target_port === 'video_ref') {
              return true;
            }

            // Backward-compat: edge cũ không có target_port → infer từ source node type.
            // Image/Generate/ChatGPT/Grok nodes produce image output → treat as image_ref.
            if (!e.target_port || e.target_port === 'default' || e.target_port === null) {
              if (['image', 'generate', 'chatgpt', 'grok'].includes(sourceNode?.node_type)) {
                nodeLog(`[Port-merge] Legacy edge từ ${sourceNode.node_type} → treating as image_ref`);
                return true;
              }
              // Prompt node has text output → don't treat as image_ref
            }

            return false;
          });
          // Collect refs từ filtered edges (Image / Generate / ChatGPT / Grok sources).
          // 2026-06-06: `_collectPortInputs` filter strict theo `target_port === portName` (line
          // 3333) → cần gọi 2 lần: 'image_ref' + 'video_ref' rồi gộp. Edge legacy (target_port=null/
          // 'default') được match qua `getFirstInPort` fallback — chỉ match port[0] hiện tại
          // (thường là image_ref) → KHÔNG duplicate khi gọi video_ref pass.
          const portImageRefsImg = explicitImageRefEdges.length > 0
            ? this._collectPortInputs(node, 'image_ref', workflow.nodes, explicitImageRefEdges)
            : [];
          const portImageRefsVid = explicitImageRefEdges.length > 0
            ? this._collectPortInputs(node, 'video_ref', workflow.nodes, explicitImageRefEdges)
            : [];
          const portImageRefs = [...portImageRefsImg, ...portImageRefsVid];
          if (portImageRefs.length > 0) {
            const refsToMerge = portImageRefs;
            // Bug fix 2026-05-27: LUÔN giữ ref sidebar của node (existing) + union với port refs.
            // Trước: `useOwnPrompt ? existing : []` → khi tắt "use own prompt" (prompt_source=
            // 'upstream_node' do connect Prompt node) → existing=[] → MẤT ref sidebar-only (ref user
            // thêm tay không qua port edge). useOwnPrompt là nguồn PROMPT TEXT, ĐỘC LẬP với ref images
            // — ref ở sidebar là explicit choice của user → phải giữ. Dedup tránh trùng port refs.
            const existing = (node.ref_file_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
            const combined = [...new Set([...existing, ...refsToMerge])];
            // Lưu snapshot original để restore trong _executeNodeInternal finally (KHÔNG persist port-merged)
            if (!node._original_ref_state) {
              node._original_ref_state = {
                ref_file_ids: node.ref_file_ids || '',
                ref_thumbnails: { ...(node.ref_thumbnails || {}) },
                ref_file_names: { ...(node.ref_file_names || {}) },
              };
            }
            node.ref_file_ids = combined.join(', ');
            // Bug fix 2026-05-28: track ID port-merged (refs từ upstream node, KHÔNG phải ref riêng
            // của node) → để loại khi PERSIST (tránh leak vào ref_file_ids khi save → reload thấy
            // ref của upstream trong node setting). Merge vào set có sẵn (nhiều block port-merge).
            if (!node._portMergedRefIds) node._portMergedRefIds = new Set();
            for (const id of refsToMerge) {
              if (!existing.includes(id)) node._portMergedRefIds.add(id);
            }

            // Merge thumbnails + file_names từ source nodes (Image/Generate/ChatGPT/Grok)
            // để _executeGrokImageNode/_executeChatGPTImageNode có URL thumbnail → fetch base64.
            // BUG FIX: ref_thumbnails/ref_file_names có thể là array từ backend JSON → force object
            if (!node.ref_thumbnails || Array.isArray(node.ref_thumbnails)) node.ref_thumbnails = {};
            if (!node.ref_file_names || Array.isArray(node.ref_file_names)) node.ref_file_names = {};
            // Chỉ lấy edges explicit target 'image_ref' (đã filter ở trên)
            for (const edge of explicitImageRefEdges) {
              const src = workflow.nodes.find((n) => n.node_id === edge.source_node_id);
              if (!src) continue;
              // Merge cả ref_* (Image source node) lẫn result_* (Generate/ChatGPT/Grok output)
              const srcThumbs = { ...(src.ref_thumbnails || {}), ...(src.result_thumbnails || {}) };
              const srcFileNames = { ...(src.ref_file_names || {}), ...(src.result_file_names || {}) };
              // 1) Gán theo KEY khớp (trường hợp thường).
              for (const [fid, thumb] of Object.entries(srcThumbs)) {
                if (!node.ref_thumbnails[fid]) node.ref_thumbnails[fid] = thumb;
              }
              for (const [fid, fname] of Object.entries(srcFileNames)) {
                if (!node.ref_file_names[fid]) node.ref_file_names[fid] = fname;
              }
              // 2) Fix run-single-node: source image node ref_file_ids đã correct sang tile ID MỚI
              // nhưng ref_thumbnails/ref_file_names còn key CŨ → ID merge vào node không có thumbnail
              // → resolveRefs base64 SKIP → chỉ 1/N ảnh tới Grok/ChatGPT. Align THEO VỊ TRÍ (cùng
              // source, count khớp — correction re-key theo old[i]→new[i] nên values giữ thứ tự).
              const srcIsImg = src.node_type === 'image';
              const srcIds = ((srcIsImg ? src.ref_file_ids : src.result_file_ids) || '')
                .split(',').map((s) => s.trim()).filter(Boolean);
              const thumbVals = Object.values(srcThumbs);
              const nameVals = Object.values(srcFileNames);
              if (srcIds.length > 0 && thumbVals.length === srcIds.length) {
                srcIds.forEach((sid, i) => {
                  if (!node.ref_thumbnails[sid] && thumbVals[i]) node.ref_thumbnails[sid] = thumbVals[i];
                });
              }
              if (srcIds.length > 0 && nameVals.length === srcIds.length) {
                srcIds.forEach((sid, i) => {
                  if (!node.ref_file_names[sid] && nameVals[i]) node.ref_file_names[sid] = nameVals[i];
                });
              }
            }

            // Fallback: lookup MediaRegistry cho IDs được merge mà chưa có thumbnail
            for (const fid of refsToMerge) {
              if (!node.ref_thumbnails[fid]) {
                const mrThumb = typeof MediaRegistry !== 'undefined' && MediaRegistry.getThumb?.(fid);
                if (mrThumb) {
                  node.ref_thumbnails[fid] = mrThumb;
                  nodeLog(`[Port-merge] Fallback MediaRegistry thumb cho ${fid.substring(0, 12)}`);
                }
              }
              if (!node.ref_file_names[fid]) {
                const mrName = typeof MediaRegistry !== 'undefined' && MediaRegistry.getFileName?.(fid);
                if (mrName) {
                  node.ref_file_names[fid] = mrName;
                }
              }
            }

            nodeLog(`Port "image_ref" merge: +${refsToMerge.length} ảnh (tổng ${combined.length})`);
            nodeLog(`[Port-merge] ref_file_names after merge: ${JSON.stringify(node.ref_file_names)}`);
          }
        } catch (err) {
          nodeLog('Lỗi collect port "image_ref": ' + err.message, 'warn');
        }
      }

      // === PORT-BASED FRAMES (Phase WK-1.4.3) ===
      // Generate node + Video Frames mode: lấy frame_1/frame_2 từ port edges (nếu có).
      if (
        node.node_type === 'generate' &&
        node.media_type === 'Video' &&
        node.video_input_type === 'Frames'
      ) {
        try {
          const f1 = this._collectPortInputs(node, 'frame_1', workflow.nodes, workflow.edges);
          if (f1.length > 0 && !node.frame_1_file_id) {
            node.frame_1_file_id = f1[0];
            nodeLog(`Frame 1 từ port: ${node.frame_1_file_id.substring(0, 16)}...`);
          }
          const f2 = this._collectPortInputs(node, 'frame_2', workflow.nodes, workflow.edges);
          if (f2.length > 0 && !node.frame_2_file_id) {
            node.frame_2_file_id = f2[0];
            nodeLog(`Frame 2 từ port: ${node.frame_2_file_id.substring(0, 16)}...`);
          }
        } catch (err) {
          nodeLog('Lỗi collect port frame: ' + err.message, 'warn');
        }
      }

      // === DELAY NODE (pass-through, upstream đã correct ở trên) ===
      if (node.node_type === 'delay') {
        return this._executeDelayNode(node, nodeLog);
      }

      // === IMAGE NODE (pass-through ref_file_ids) ===
      if (node.node_type === 'image') {
        return this._executeImageNode(node, nodeLog);
      }

      // === TEXT NODE (pass-through, chỉ cung cấp text cho downstream) ===
      if (node.node_type === 'text') {
        nodeLog('Text node pass-through: ' + (node.prompt || '').substring(0, 100));
        node.result_text = node.prompt || '';
        return { success: true, text: node.result_text };
      }

      // === NOTE NODE (pass-through, không execute gì) ===
      if (node.node_type === 'note') {
        nodeLog('Note node skipped (visual only)');
        return { success: true };
      }

      // === TELEGRAM NODE ===
      if (node.node_type === 'telegram') {
        return this._executeTelegramNode(node, workflow, nodeLog);
      }

      // === DOWNLOAD NODE ===
      if (node.node_type === 'download') {
        return this._executeDownloadNode(node, workflow, nodeLog);
      }

      // === TEXT EXPORT — ghi text upstream ra FILE (manifest/kịch bản/danh sách prompt) ===
      if (node.node_type === 'text_export') {
        return this._executeTextExportNode(node, workflow, nodeLog);
      }

      if (node.node_type === 'image_composite') {
        return this._executeImageCompositeNode(node, workflow, nodeLog);
      }

      if (node.node_type === 'quality_gate') {
        return this._executeQualityGateNode(node, workflow, nodeLog);
      }

      if (node.node_type === 'entity_ref') {
        return this._executeEntityRefNode(node, workflow, nodeLog);
      }

      // === CHATGPT NODE ===
      if (node.node_type === 'chatgpt') {
        return this._executeChatGPTImageNode(node, workflow, nodeLog, nodeAccum);
      }

      // === GROK NODE === (Phase G-6.4)
      // Note: method name `_executeGrokImageNode` giữ nguyên (internal name, không ảnh hưởng node type external)
      if (node.node_type === 'grok') {
        return this._executeGrokImageNode(node, workflow, nodeLog, nodeAccum);
      }

      // Chốt chặn: node type LẠ không được lặng lẽ rơi xuống nhánh GENERATE bên dưới.
      // Trước đây `output` và `transform` (khai trong NodeTemplates nhưng chưa có dispatch)
      // bị gửi đi như node gen với prompt rỗng — tốn credit, kết quả vô nghĩa, và log
      // không hề nói là do sai loại node. Workflow nhập từ ngoài cũng có thể mang type lạ.
      // `generate` là loại DUY NHẤT được phép xuống dưới; thiếu type thì coi như generate
      // để giữ tương thích với workflow cũ chưa ghi node_type.
      if (node.node_type && node.node_type !== 'generate') {
        const err = new Error(`UNSUPPORTED_NODE_TYPE: loại node "${node.node_type}" chưa được cài đặt. `
          + 'Xoá node này hoặc thay bằng loại khác.');
        err.code = 'UNSUPPORTED_NODE_TYPE'; err.noRetry = true;
        node.last_error = 'UNSUPPORTED_NODE_TYPE';
        throw err;
      }

      // === GENERATE NODE (existing logic) ===

      // 0. Smart Clone: reconstruct ref_file_ids từ metadata khi clone cross-project
      if (!node.ref_file_ids && node.ref_file_names && Object.keys(node.ref_file_names).length > 0) {
        node.ref_file_ids = Object.keys(node.ref_file_names).join(', ');
        nodeLog('Smart Clone: reconstructed ref_file_ids from ref_file_names: ' + node.ref_file_ids);
      } else if (!node.ref_file_ids && node.ref_thumbnails && Object.keys(node.ref_thumbnails).length > 0) {
        node.ref_file_ids = Object.keys(node.ref_thumbnails).join(', ');
        nodeLog('Smart Clone: reconstructed ref_file_ids from ref_thumbnails: ' + node.ref_file_ids);
      }

      // 0a. Upload pending local files nếu có
      if (node.ref_file_ids && node.ref_file_ids.includes('upload_') && typeof window.uploadPendingFiles === 'function') {
        const oldRefIds = node.ref_file_ids;
        nodeLog(window.I18n?.t('workflow.uploadingLocalImages') || 'Uploading local images to Flow...', 'info');
        node.ref_file_ids = await window.uploadPendingFiles(node.ref_file_ids);
        if (node.ref_file_ids !== oldRefIds) {
          // CRITICAL: Capture ref_file_names từ GenTab.fileNameCache (populated by FileUploader)
          const oldIdArr = (oldRefIds || '').split(',').map(s => s.trim()).filter(Boolean);
          const newIdArr = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          if (!node.ref_file_names) node.ref_file_names = {};
          for (let i = 0; i < newIdArr.length; i++) {
            const newId = newIdArr[i];
            if (MediaRegistry.getFileName(newId)) {
              node.ref_file_names[newId] = MediaRegistry.getFileName(newId);
            }
            // Transfer thumbnails nếu có
            if (MediaRegistry.getThumb(newId) && node.ref_thumbnails) {
              node.ref_thumbnails[newId] = MediaRegistry.getThumb(newId);
            }
          }
          // Cleanup old upload_xxx keys
          for (const oldId of oldIdArr) {
            if (oldId.startsWith('upload_')) {
              delete node.ref_file_names[oldId];
              if (node.ref_thumbnails) delete node.ref_thumbnails[oldId];
            }
          }

          // CRITICAL FIX: Filter chỉ giữ original refs (không bao gồm port-merged upstream)
          let persistRefIds = node.ref_file_ids;
          let persistRefThumbs = node.ref_thumbnails;
          let persistRefNames = node.ref_file_names;
          if (node._original_ref_state) {
            const origKeySet = new Set(
              (node._original_ref_state.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean)
            );
            for (const nid of newIdArr) origKeySet.add(nid);
            // Bug fix 2026-05-28: LOẠI port-merged refs (từ upstream node) khỏi persist — chúng được
            // add vào origKeySet qua newIdArr (passthrough uploadPendingFiles) nhưng KHÔNG phải ref
            // riêng của node → nếu persist sẽ leak vào ref_file_ids → reload thấy ref của upstream.
            const filteredIds = (node.ref_file_ids || '').split(',').map(s => s.trim())
              .filter(id => origKeySet.has(id) && !(node._portMergedRefIds && node._portMergedRefIds.has(id)));
            persistRefIds = filteredIds.join(', ');
            persistRefThumbs = {};
            persistRefNames = {};
            for (const fid of filteredIds) {
              if (node.ref_thumbnails?.[fid]) persistRefThumbs[fid] = node.ref_thumbnails[fid];
              if (node.ref_file_names?.[fid]) persistRefNames[fid] = node.ref_file_names[fid];
            }
          }

          window.eventBus?.emit('node:ref_replaced', {
            nodeId: node.node_id,
            oldRefIds,
            newRefIds: persistRefIds,
            refFileNames: persistRefNames,
            refThumbnails: persistRefThumbs
          });

          // CRITICAL: Persist ONLY original refs sau khi upload local files
          nodeLog('[Upload] Persisting ref data (filtered) after local file upload');
          try {
            await window.storageManager?.updateNodeStatus(
              this.currentWorkflow.wf_id,
              node.node_id,
              { ref_file_ids: persistRefIds, ref_thumbnails: persistRefThumbs, ref_file_names: persistRefNames }
            );
            // CRITICAL FIX: Update _original_ref_state với persisted values
            if (node._original_ref_state) {
              node._original_ref_state.ref_file_ids = persistRefIds;
              node._original_ref_state.ref_thumbnails = { ...persistRefThumbs };
              node._original_ref_state.ref_file_names = { ...persistRefNames };
              nodeLog('[Upload] Updated _original_ref_state with persisted values');
            }
          } catch (e) {
            log('Failed to persist ref update:', e.message);
          }
        }
      }

      // Bug fix 2026-05-28: ref còn 'upload_' SAU uploadPendingFiles = upload THẤT BẠI (vd ref là
      // VIDEO không upload được lên Flow image-input). Giữ lại → addRefImages fail → ABORT cả node
      // ("stop workflow"). Filter bỏ ref local-fail + warn → gen tiếp với ref hợp lệ (graceful).
      if (node.ref_file_ids && node.ref_file_ids.includes('upload_')) {
        const beforeRefs = node.ref_file_ids.split(',').map(s => s.trim()).filter(Boolean);
        const keptRefs = beforeRefs.filter(id => !id.startsWith('upload_'));
        const droppedRefs = beforeRefs.length - keptRefs.length;
        if (droppedRefs > 0) {
          node.ref_file_ids = keptRefs.join(', ');
          if (node._original_ref_state && typeof node._original_ref_state.ref_file_ids === 'string') {
            node._original_ref_state.ref_file_ids = (node._original_ref_state.ref_file_ids || '')
              .split(',').map(s => s.trim()).filter(id => id && !id.startsWith('upload_')).join(', ');
          }
          nodeLog(`[Upload] ${droppedRefs} ảnh ref local KHÔNG upload được (vd video ref) → bỏ qua, gen tiếp với ${keptRefs.length} ref hợp lệ`, 'warn');
          // User-visible: báo modal (workflow-editor) hoặc toast (sidebar) cho user biết ref bị bỏ.
          this._notifyRefUploadDropped(node, droppedRefs, keptRefs.length);
        }
      }

      // Smart Clone frames: reconstruct frame_file_id từ metadata
      if (!node.frame_1_file_id && node.frame_1_file_name) {
        node.frame_1_file_id = node.frame_1_file_name;
        nodeLog('Smart Clone: reconstructed frame_1_file_id from file_name: ' + node.frame_1_file_name);
      }
      if (!node.frame_2_file_id && node.frame_2_file_name) {
        node.frame_2_file_id = node.frame_2_file_name;
        nodeLog('Smart Clone: reconstructed frame_2_file_id from file_name: ' + node.frame_2_file_name);
      }

      if (node.frame_1_file_id && node.frame_1_file_id.startsWith('upload_') && typeof window.uploadPendingFiles === 'function') {
        node.frame_1_file_id = await window.uploadPendingFiles(node.frame_1_file_id);
      }
      if (node.frame_2_file_id && node.frame_2_file_id.startsWith('upload_') && typeof window.uploadPendingFiles === 'function') {
        node.frame_2_file_id = await window.uploadPendingFiles(node.frame_2_file_id);
      }

      // Frame import keys (upload_import_*): fetch CDN URL → upload Flow → tile_id mới
      // Frame thumbnails lưu ở node.frame_1_thumbnail / frame_2_thumbnail (không phải ref_thumbnails)
      for (const slot of [1, 2]) {
        const fid = node[`frame_${slot}_file_id`];
        if (fid && fid.startsWith('upload_import_') && typeof window.reuploadMissingFiles === 'function') {
          const thumbUrl = node[`frame_${slot}_thumbnail`];
          if (thumbUrl) {
            const fakeMap = { [fid]: thumbUrl };
            const reuploaded = await window.reuploadMissingFiles(fid, fakeMap, null, null);
            if (reuploaded && reuploaded !== fid) {
              nodeLog(`[Frame ${slot}] Import: ${fid} → ${reuploaded}`);
              node[`frame_${slot}_file_id`] = reuploaded;
              // Capture file_name + thumbnail từ MediaRegistry
              if (typeof MediaRegistry !== 'undefined') {
                if (MediaRegistry.getFileName(reuploaded)) {
                  node[`frame_${slot}_file_name`] = MediaRegistry.getFileName(reuploaded);
                }
                if (MediaRegistry.getThumb(reuploaded)) {
                  node[`frame_${slot}_thumbnail`] = MediaRegistry.getThumb(reuploaded);
                }
              }
            }
          }
        }
      }

      // 0b. Handle import keys (upload_import_*) - fetch từ CDN và upload lên Flow
      // uploadPendingFiles chỉ xử lý local files trong pendingUploadFiles Map
      // Import keys có CDN URLs trong ref_thumbnails, cần reuploadMissingFiles Tầng 3
      const hasImportKeys = node.ref_file_ids && node.ref_file_ids.includes('upload_import_');
      let importKeysJustUploaded = false; // Flag để skip Tầng 5 reupload nếu vừa upload xong
      if (hasImportKeys && typeof window.reuploadMissingFiles === 'function') {
        const importThumbMap = node.ref_thumbnails || {};
        nodeLog(`[Import] Xử lý ${Object.keys(importThumbMap).length} import keys từ CDN...`);
        const uploadedImport = await window.reuploadMissingFiles(node.ref_file_ids, importThumbMap, null, null);
        if (uploadedImport !== node.ref_file_ids) {
          nodeLog(`[Import] Upload thành công: ${uploadedImport.substring(0, 60)}...`);
          node.ref_file_ids = uploadedImport;
          importKeysJustUploaded = true; // Skip Tầng 5 reupload vì vừa upload xong
          // Capture file_names từ MediaRegistry (populated by reuploadMissingFiles)
          const newIdArr = (uploadedImport || '').split(',').map(s => s.trim()).filter(Boolean);
          if (!node.ref_file_names) node.ref_file_names = {};
          if (!node.ref_thumbnails) node.ref_thumbnails = {};
          for (const newId of newIdArr) {
            if (MediaRegistry.getFileName(newId)) {
              node.ref_file_names[newId] = MediaRegistry.getFileName(newId);
            }
            if (MediaRegistry.getThumb(newId)) {
              node.ref_thumbnails[newId] = MediaRegistry.getThumb(newId);
            }
          }
          // Cleanup old upload_import_xxx keys
          for (const key of Object.keys(importThumbMap)) {
            if (key.startsWith('upload_import_')) {
              delete node.ref_file_names[key];
              delete node.ref_thumbnails[key];
            }
          }

          // CRITICAL FIX: Chỉ emit/persist ORIGINAL refs (không bao gồm port-merged upstream refs).
          // Port-merge adds upstream refs vào node.ref_* tạm thời cho runtime, KHÔNG nên persist.
          // Nếu có _original_ref_state, filter chỉ giữ refs thuộc về node này (new upload IDs thay thế import keys).
          let persistRefIds = node.ref_file_ids;
          let persistRefThumbs = node.ref_thumbnails;
          let persistRefNames = node.ref_file_names;
          if (node._original_ref_state) {
            // Get original keys (trước port-merge) - đây là refs thực sự thuộc về node
            const origKeySet = new Set(
              (node._original_ref_state.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean)
            );
            // newIdArr chứa IDs mới (thay thế import keys), cần giữ lại
            for (const nid of newIdArr) {
              origKeySet.add(nid);
            }
            // Filter chỉ giữ refs thuộc origKeySet + LOẠI port-merged upstream (2026-05-28: newIdArr
            // passthrough có thể chứa port-merged → phải loại bằng _portMergedRefIds, tránh leak).
            const filteredIds = (node.ref_file_ids || '').split(',').map(s => s.trim())
              .filter(id => origKeySet.has(id) && !(node._portMergedRefIds && node._portMergedRefIds.has(id)));
            persistRefIds = filteredIds.join(', ');
            persistRefThumbs = {};
            persistRefNames = {};
            for (const fid of filteredIds) {
              if (node.ref_thumbnails?.[fid]) persistRefThumbs[fid] = node.ref_thumbnails[fid];
              if (node.ref_file_names?.[fid]) persistRefNames[fid] = node.ref_file_names[fid];
            }
            nodeLog(`[Import] Filtered refs: ${filteredIds.length} original + new IDs (excluded port-merged)`);
          }

          window.eventBus?.emit('node:ref_replaced', {
            nodeId: node.node_id,
            oldRefIds: Object.keys(importThumbMap).join(', '),
            newRefIds: persistRefIds,
            refFileNames: persistRefNames,
            refThumbnails: persistRefThumbs
          });

          // CRITICAL: Persist ONLY original refs (không bao gồm port-merged) để lần chạy sau không cần reupload
          try {
            await window.storageManager?.updateNodeStatus(
              this.currentWorkflow.wf_id,
              node.node_id,
              { ref_file_ids: persistRefIds, ref_thumbnails: persistRefThumbs, ref_file_names: persistRefNames }
            );
            nodeLog('[Import] Đã lưu ref data (filtered) vào storage');
            // CRITICAL FIX: Update _original_ref_state với persisted values
            if (node._original_ref_state) {
              node._original_ref_state.ref_file_ids = persistRefIds;
              node._original_ref_state.ref_thumbnails = { ...persistRefThumbs };
              node._original_ref_state.ref_file_names = { ...persistRefNames };
              nodeLog('[Import] Updated _original_ref_state with persisted values');
            }
          } catch (e) {
            log('[Import] Failed to persist ref update:', e.message);
          }
        } else {
          nodeLog('[Import] Không có import key nào được upload (có thể CDN URL đã hết hạn)', 'warn');
        }
      }

      // BUG FIX 2026-06-05 (Fix F): Pre-replace own stale IDs với upstream's CURRENT IDs khi
      // có content-link xác thực qua Image source's ref_file_names map.
      //
      // Scenario: workflow clone từ template — Generate node pinned own ref_file_ids = same stale
      // IDs với Image upstream's HISTORICAL keys (ref_file_names). Tầng 5 file_name check fail
      // (Flow assigned UUID khác per session) → reupload 3 files duplicate content với upstream.
      //
      // Safe link check: chỉ replace khi Image source.ref_file_names STORED EXACTLY same key.
      // User pick image khác manually → không có overlap → skip → Tầng 1-5 chạy normal.
      if (node.ref_file_ids && !node.ref_file_ids.includes('upload_') && !importKeysJustUploaded
          && node.ref_file_names && Object.keys(node.ref_file_names).length > 0) {
        const _ownIdsArr = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
        const _inputEdgesForLink = (workflow.edges || []).filter(e => e.target_node_id === node.node_id);
        const _linkReplacements = []; // [{oldId, newId, srcName, srcFn}]
        const _imageUpstreams = [];
        for (const edge of _inputEdgesForLink) {
          const src = (workflow.nodes || []).find(n => n.node_id === edge.source_node_id);
          if (!src || (src.node_type !== 'image' && src.type !== 'image')) continue;
          _imageUpstreams.push(src);
        }
        for (const ownId of _ownIdsArr) {
          // Tìm Image source nào có ownId trong ref_file_names (HISTORICAL key match)
          for (const src of _imageUpstreams) {
            const srcRefFns = src.ref_file_names || {};
            if (srcRefFns[ownId]) {
              // Content-link confirmed → Generate's own pinned tới Image's content.
              // Replace ownId với Image's CURRENT result_file_ids (single ID per Image usually).
              const srcResultIds = (src.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
              if (srcResultIds.length > 0 && srcResultIds[0] !== ownId) {
                _linkReplacements.push({
                  oldId: ownId,
                  newId: srcResultIds[0],
                  srcName: src.node_name || src.node_id,
                  srcResultFn: (src.result_file_names || {})[srcResultIds[0]],
                });
              }
              break;
            }
          }
        }
        if (_linkReplacements.length > 0) {
          console.log(`[REUPLOAD_AUDIT] Fix F — ${_linkReplacements.length} content-link replacement(s): ${_linkReplacements.map(r => `${r.oldId.substring(0, 14)}→${r.newId.substring(0, 14)} (${r.srcName})`).join(', ')}`);
          nodeLog(`[Fix F] Replace ${_linkReplacements.length} own refs với upstream's current IDs`);
          // Build map cho easy lookup
          const replaceMap = new Map(_linkReplacements.map(r => [r.oldId, r.newId]));
          const fnMap = new Map(_linkReplacements.map(r => [r.newId, r.srcResultFn]));
          // Apply replacement to ref_file_ids
          node.ref_file_ids = _ownIdsArr.map(id => replaceMap.get(id) || id).join(', ');
          // Update ref_file_names: re-key + use upstream's CURRENT file_name (Flow's session UUID)
          if (node.ref_file_names && typeof node.ref_file_names === 'object'
              && !Array.isArray(node.ref_file_names)) {
            const updatedFns = {};
            for (const [oldId, fn] of Object.entries(node.ref_file_names)) {
              const newId = replaceMap.get(oldId) || oldId;
              updatedFns[newId] = fnMap.get(newId) || fn;
            }
            node.ref_file_names = updatedFns;
          }
          // Update ref_thumbnails: re-key. Use upstream's CURRENT thumb if available.
          if (node.ref_thumbnails && typeof node.ref_thumbnails === 'object'
              && !Array.isArray(node.ref_thumbnails)) {
            const updatedThumbs = {};
            for (const [oldId, thumb] of Object.entries(node.ref_thumbnails)) {
              const newId = replaceMap.get(oldId) || oldId;
              // Tìm thumb từ upstream Image's result_thumbnails
              let upstreamThumb = thumb;
              for (const src of _imageUpstreams) {
                if (src.result_thumbnails && src.result_thumbnails[newId]) {
                  upstreamThumb = src.result_thumbnails[newId];
                  break;
                }
              }
              updatedThumbs[newId] = upstreamThumb;
            }
            node.ref_thumbnails = updatedThumbs;
          }
        }
      }

      // 0c. Correct stale tile IDs trên node.ref_file_ids (5-tầng)
      // Skip nếu vừa upload import keys xong (tránh duplicate upload + zoom)
      if (node.ref_file_ids && !node.ref_file_ids.includes('upload_') && !importKeysJustUploaded) {
        // CRITICAL FIX 2026-06-05: ensure Flow tiles loaded vào DOM TRƯỚC checkFilesExist.
        // checkFilesExist (content.js:9582-9593) query DOM — nếu Flow tab vừa switch/reload,
        // DOM trống → file_name miss → trigger reupload không cần thiết → duplicate uploads.
        // Fix D2 2026-06-05: gọi qua sendToContentScript thay vì method direct (không tồn tại).
        try {
          if (window.MessageBridge?.sendToContentScript) {
            console.log(`[REUPLOAD_AUDIT] Fix 4 (D2) — sendToContentScript('ensureFlowTilesLoaded') TRƯỚC own ref check`);
            await window.MessageBridge.sendToContentScript('ensureFlowTilesLoaded');
          }
        } catch (e) {
          nodeLog(`[Tile Load] ensureFlowTilesLoaded failed: ${e.message}`, 'warn');
        }

        // Lưu original IDs trước correctFileIds để reupload cache lookup đúng key
        const originalNodeRefIds = node.ref_file_ids;
        let refCorrectionChanged = false;
        const thumbMap = { ...(node.ref_thumbnails || {}), ...(node.result_thumbnails || {}) };
        // BUGFIX: Dùng ref_file_names (không phải result_file_names) cho ref correction
        const fnMap = { ...(node.ref_file_names || {}), ...(node.result_file_names || {}) };
        if (typeof window.correctFileIds === 'function' && (Object.keys(thumbMap).length > 0 || Object.keys(fnMap).length > 0)) {
          nodeLog(`[Tầng 1-3] Kiểm tra ref IDs: ${node.ref_file_ids.substring(0, 60)}...`);
          const { correctedIds, changed } = await window.correctFileIds(node.ref_file_ids, thumbMap, fnMap);
          if (changed) {
            nodeLog(`[Tầng 1-4] Ref IDs đã correct: ${correctedIds.substring(0, 60)}...`);
            node.ref_file_ids = correctedIds;
            refCorrectionChanged = true;
          } else {
            nodeLog('[Tầng 1-3] Ref IDs vẫn hợp lệ');
          }
        }
        if (typeof window.reuploadMissingFiles === 'function') {
          const beforeRef = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          const refThumbMap = { ...(node.ref_thumbnails || {}), ...(node.result_thumbnails || {}) };
          // CRITICAL: Truyền file_names map để check file_name trước (tránh reupload không cần thiết)
          const refFileNamesMap = { ...(node.ref_file_names || {}), ...(node.result_file_names || {}) };
          nodeLog(`[REUPLOAD_AUDIT] >>> Tầng 5 FIRE — node: ${node.title || node.node_id}, type: ${node.node_type}`, 'warn');
          nodeLog(`[Tầng 5] Checking refs: ${node.ref_file_ids.substring(0, 60)}`);
          nodeLog(`[Tầng 5] file_names map: ${JSON.stringify(refFileNamesMap)}`);
          nodeLog(`[Tầng 5] thumb map keys: ${Object.keys(refThumbMap).map(k => k.substring(0, 18)).join(', ')}`);
          // Emit upload phase nếu có ID dạng upload_ hoặc CDN URL cần reupload
          const _needsUploadHint = beforeRef.some(id => id.startsWith('upload_') || id.startsWith('upload_import_'));
          if (_needsUploadHint) emitNodePhase(node.node_id, 'uploading');
          const updated = await window.reuploadMissingFiles(node.ref_file_ids, refThumbMap, originalNodeRefIds, refFileNamesMap);
          if (updated !== node.ref_file_ids) {
            nodeLog(`[REUPLOAD_AUDIT] !!! REUPLOAD HAPPENED — before: ${node.ref_file_ids.substring(0, 60)} → after: ${updated.substring(0, 60)}`, 'warn');
            nodeLog(`[Tầng 5] Re-upload ref images: ${updated.substring(0, 60)}...`);
            const oldIdArr = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
            const newIdArr = (updated || '').split(',').map(s => s.trim()).filter(Boolean);
            node.ref_file_ids = updated;
            refCorrectionChanged = true;

            // BUG FIX: Update ref_file_names và ref_thumbnails với new keys từ MediaRegistry
            // reuploadMissingFiles đã populate MediaRegistry với newId → file_name/thumbnail
            // CRITICAL: Không dùng index-based matching vì reuploadMissingFiles có thể filter bỏ missing IDs
            // Dùng ID-based: check xem ID có thay đổi không, update metadata theo
            if (!node.ref_file_names) node.ref_file_names = {};
            if (!node.ref_thumbnails) node.ref_thumbnails = {};

            // Build set of new IDs để kiểm tra
            const newIdSet = new Set(newIdArr);
            const oldIdSet = new Set(oldIdArr);

            // Tìm các IDs đã thay đổi (có trong old nhưng không có trong new → bị thay thế)
            // và IDs mới (có trong new nhưng không có trong old → ID thay thế)
            const replacedOldIds = oldIdArr.filter(id => !newIdSet.has(id));
            const newlyAddedIds = newIdArr.filter(id => !oldIdSet.has(id));

            // Nếu số lượng bằng nhau, có thể map 1-1 theo thứ tự
            // (reuploadMissingFiles giữ nguyên thứ tự, replaced ID ở vị trí của old ID)
            if (replacedOldIds.length === newlyAddedIds.length) {
              for (let i = 0; i < replacedOldIds.length; i++) {
                const oldId = replacedOldIds[i];
                const newId = newlyAddedIds[i];

                // Lấy từ MediaRegistry (đã được reuploadMissingFiles populate)
                const newFileName = MediaRegistry.getFileName(newId);
                const newThumb = MediaRegistry.getThumb(newId);
                if (newFileName) {
                  node.ref_file_names[newId] = newFileName;
                } else if (node.ref_file_names[oldId]) {
                  // Fallback: transfer từ old key
                  node.ref_file_names[newId] = node.ref_file_names[oldId];
                }
                if (newThumb) {
                  node.ref_thumbnails[newId] = newThumb;
                } else if (node.ref_thumbnails[oldId]) {
                  node.ref_thumbnails[newId] = node.ref_thumbnails[oldId];
                }
                // Cleanup old keys
                delete node.ref_file_names[oldId];
                delete node.ref_thumbnails[oldId];
                nodeLog(`[Tầng 5] Transferred metadata: ${oldId.substring(0, 20)} → ${newId.substring(0, 20)}`);
              }
            } else {
              nodeLog(`[Tầng 5] WARN: ID count mismatch - replaced=${replacedOldIds.length}, new=${newlyAddedIds.length}`, 'warn');
              // Fallback: populate từ MediaRegistry cho tất cả new IDs
              for (const newId of newlyAddedIds) {
                const newFileName = MediaRegistry.getFileName(newId);
                const newThumb = MediaRegistry.getThumb(newId);
                if (newFileName) node.ref_file_names[newId] = newFileName;
                if (newThumb) node.ref_thumbnails[newId] = newThumb;
              }
            }

            // Cleanup: xóa các keys không còn trong newIdArr
            for (const key of Object.keys(node.ref_file_names)) {
              if (!newIdSet.has(key)) {
                delete node.ref_file_names[key];
              }
            }
            for (const key of Object.keys(node.ref_thumbnails)) {
              if (!newIdSet.has(key)) {
                delete node.ref_thumbnails[key];
              }
            }
            nodeLog(`[Tầng 5] Updated ref_file_names/thumbnails with new keys`);
          } else {
            nodeLog(`[REUPLOAD_AUDIT] Tầng 5 NO-CHANGE — refs vẫn nguyên ${beforeRef.length} IDs (file_name match hoặc tile tồn tại)`);
          }
          const afterRef = (updated || '').split(',').map(s => s.trim()).filter(Boolean);
          const droppedRef = beforeRef.length - afterRef.length;
          if (droppedRef > 0) {
            nodeLog(`[Node ${node.node_name || node.node_id}] ${droppedRef} ảnh tham chiếu không tìm thấy, đã bị bỏ qua`, 'warn');
            if (afterRef.length === 0 && beforeRef.length > 0) {
              nodeLog(`[Node ${node.node_name || node.node_id}] Tất cả ảnh tham chiếu đã mất. Node chạy không có ref.`, 'error');
            }
          }
        }

        // CRITICAL: Persist updated ref data sau khi correctFileIds + reuploadMissingFiles
        if (refCorrectionChanged) {
          nodeLog('[Tầng 1-5] Persisting corrected ref data to storage');
          try {
            await window.storageManager?.updateNodeStatus(
              this.currentWorkflow.wf_id,
              node.node_id,
              { ref_file_ids: node.ref_file_ids, ref_thumbnails: node.ref_thumbnails, ref_file_names: node.ref_file_names }
            );
            // CRITICAL FIX: Update _original_ref_state với new values để finally restore đúng
            // Nếu không update, finally sẽ restore giá trị cũ (trước reupload), ghi đè data đã persist
            if (node._original_ref_state) {
              node._original_ref_state.ref_file_ids = node.ref_file_ids;
              node._original_ref_state.ref_thumbnails = { ...node.ref_thumbnails };
              node._original_ref_state.ref_file_names = { ...node.ref_file_names };
              nodeLog('[Tầng 1-5] Updated _original_ref_state with persisted values');
            }
          } catch (e) {
            log('Failed to persist ref update:', e.message);
          }

          // Bug 47 fix: Update SOURCE image nodes nếu refs từ mention mode bị reupload
          if (node._mentionRefSources && Object.keys(node._mentionRefSources).length > 0) {
            // H2 fix: `beforeReupload` was undeclared in this scope (only exists in _executeImageNode)
            // → ReferenceError crash. `originalNodeRefIds` (declared ~4599) holds ref_file_ids captured
            // BEFORE correctFileIds + reupload — exactly the pre-reupload ids this diff needs.
            const beforeArr = (originalNodeRefIds || '').split(',').map(s => s.trim()).filter(Boolean);
            const afterArr = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
            const sourceUpdates = {}; // sourceSlug → { oldIds: [], newIds: [], thumbnails: {}, fileNames: {} }

            // Build map of changes per source node
            for (let i = 0; i < beforeArr.length && i < afterArr.length; i++) {
              const oldId = beforeArr[i];
              const newId = afterArr[i];
              if (oldId === newId) continue;

              const source = node._mentionRefSources[oldId];
              if (!source || source.sourceNodeType !== 'image') continue;

              if (!sourceUpdates[source.sourceSlug]) {
                sourceUpdates[source.sourceSlug] = { oldIds: [], newIds: [], thumbnails: {}, fileNames: {} };
              }
              sourceUpdates[source.sourceSlug].oldIds.push(oldId);
              sourceUpdates[source.sourceSlug].newIds.push(newId);
              if (node.ref_thumbnails?.[newId]) {
                sourceUpdates[source.sourceSlug].thumbnails[newId] = node.ref_thumbnails[newId];
              }
              if (node.ref_file_names?.[newId]) {
                sourceUpdates[source.sourceSlug].fileNames[newId] = node.ref_file_names[newId];
              }
            }

            // Apply updates to source image nodes
            for (const [slug, updates] of Object.entries(sourceUpdates)) {
              const sourceNode = workflow.nodes.find(n => n.slug === slug);
              if (!sourceNode || sourceNode.node_type !== 'image') continue;

              nodeLog(`[Bug 47] Updating source image node "${slug}" with reuploaded IDs`);

              // Update ref_file_ids
              let srcIds = (sourceNode.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
              for (let i = 0; i < updates.oldIds.length; i++) {
                const idx = srcIds.indexOf(updates.oldIds[i]);
                if (idx !== -1) {
                  srcIds[idx] = updates.newIds[i];
                }
              }
              sourceNode.ref_file_ids = srcIds.join(', ');

              // Update thumbnails and file_names
              if (!sourceNode.ref_thumbnails) sourceNode.ref_thumbnails = {};
              if (!sourceNode.ref_file_names) sourceNode.ref_file_names = {};
              for (const [newId, thumb] of Object.entries(updates.thumbnails)) {
                sourceNode.ref_thumbnails[newId] = thumb;
              }
              for (const [newId, fn] of Object.entries(updates.fileNames)) {
                sourceNode.ref_file_names[newId] = fn;
              }
              // Cleanup old keys
              for (const oldId of updates.oldIds) {
                delete sourceNode.ref_thumbnails[oldId];
                delete sourceNode.ref_file_names[oldId];
              }

              // Persist source node
              try {
                await window.storageManager?.updateNodeStatus(
                  this.currentWorkflow.wf_id,
                  sourceNode.node_id,
                  { ref_file_ids: sourceNode.ref_file_ids, ref_thumbnails: sourceNode.ref_thumbnails, ref_file_names: sourceNode.ref_file_names }
                );
                nodeLog(`[Bug 47] Source node "${slug}" persisted: ${sourceNode.ref_file_ids}`);

                // Emit event để UI update
                window.eventBus?.emit('node:ref_replaced', {
                  nodeId: sourceNode.node_id,
                  oldRefIds: updates.oldIds.join(', '),
                  newRefIds: updates.newIds.join(', '),
                  refFileNames: sourceNode.ref_file_names,
                  refThumbnails: sourceNode.ref_thumbnails
                });
              } catch (e) {
                nodeLog(`[Bug 47] Failed to persist source node "${slug}": ${e.message}`, 'error');
              }
            }
          }
        }
      }

      // 1. Collect input file IDs (upstream đã correct ở trên)
      // Frames mode trả object {frame1, frame2}, normal mode trả array
      const rawInputFileIds = this._collectInputFileIds(node, workflow.nodes, workflow.edges);
      const isFramesResult = !Array.isArray(rawInputFileIds) && rawInputFileIds?.frame1 !== undefined;
      let inputFileIds = isFramesResult
        ? [rawInputFileIds.frame1, rawInputFileIds.frame2].filter(Boolean)
        : (Array.isArray(rawInputFileIds) ? rawInputFileIds : []);
      nodeLog(`[Tầng 1] Input file IDs: ${inputFileIds.length} ảnh — ${inputFileIds.map(id => id.substring(0, 20)).join(', ')}`);
      // [DEBUG_REF] Trace upstream resolve để diagnose video gen missing ref bug (2026-05-21)
      console.log(`[DEBUG_REF] Node "${node.node_name}" (${node.node_type}, ${node.media_type || 'Image'}):`, {
        upstreamRaw: rawInputFileIds,
        inputFileIds,
        nodeOwnRefIds: node.ref_file_ids,
        upstreamResultFromImageGen: workflow.edges
          .filter(e => e.target_node_id === node.node_id)
          .map(e => {
            const src = workflow.nodes.find(n => n.node_id === e.source_node_id);
            return { srcNodeName: src?.node_name, srcType: src?.node_type, srcResultIds: src?.result_file_ids, tgtPort: e.target_port };
          }),
      });

      // Cap runtime cho Video Ingredients (Flow limit = 3 ảnh)
      // Image limit = 10 (Flow generous, không cần cap nghiêm)
      // Frames mode KHÔNG cap (đã có flow riêng frame_1/frame_2)
      // inputFileIds thứ tự: [upstream..., refAttach...] → slice(0, 3) ưu tiên upstream
      //
      // Post-audit fix: dùng FlowAdapter.getMaxRefImages({mode, isFrames}) per-mode
      // thay vì hardcoded — đồng nhất pattern với ImagePickerModal.resolveMaxSelections.
      // Fallback hardcoded 3 nếu adapter chưa load (race condition).
      const isVideoIngredients = node.media_type === 'Video' && node.video_input_type !== 'Frames';
      if (!isFramesResult && isVideoIngredients) {
        const flowAdapter = window.ProviderRegistry?.get?.('flow');
        // 2026-05-28: pass modelValue → per-model max_ref_images override (vd Veo Lite=3, Omni Flash=7)
        const refLimit = (typeof flowAdapter?.getMaxRefImages === 'function')
          ? flowAdapter.getMaxRefImages({ mode: 'video', isFrames: false, modelValue: node.model })
          : 3;
        if (Array.isArray(inputFileIds) && inputFileIds.length > refLimit) {
          const dropped = inputFileIds.length - refLimit;
          nodeLog(`Video Ingredients giới hạn ${refLimit} ảnh — bỏ qua ${dropped} ảnh thừa (ưu tiên ảnh từ port edge)`, 'warn');
          inputFileIds = inputFileIds.slice(0, refLimit);
        }
      }

      // Filter synthetic IDs (chatgpt_xxx, grok_xxx) — không có tile trên Flow DOM (bridge timeout).
      // Apply cho cả PIPELINE và DIRECT paths để tránh addRefImages/addFileToPrompt fail.
      const syntheticIdPattern = /^(chatgpt_|grok_|grok_video_)/;
      const originalInputCount = inputFileIds.length;
      inputFileIds = inputFileIds.filter(id => !syntheticIdPattern.test(id));
      if (inputFileIds.length < originalInputCount) {
        const droppedSynthetic = originalInputCount - inputFileIds.length;
        nodeLog(`Loại bỏ ${droppedSynthetic} synthetic ID từ upstream (chatgpt/grok bridge timeout)`, 'warn');
      }

      // Model constraint: strip ref images nếu model không hỗ trợ.
      // Schema: supports_ref_images=false (global) hoặc ref_support_overrides (conditional
      //   per input_type / duration / duration_in).
      // inputFileIds đã chứa cả upstream + node.ref_file_ids (xem _collectInputFileIds line 2847).
      if (inputFileIds.length > 0) {
        const _flowAdapter = window.ProviderRegistry?.get?.('flow');
        if (_flowAdapter?.supportsRefImages) {
          const _isVidStrip = node.media_type === 'Video';
          const _inputTypeStrip = _isVidStrip ? (node.video_input_type || 'Ingredients') : undefined;
          const _durationStrip = _isVidStrip ? (node.video_duration || undefined) : undefined;
          if (!_flowAdapter.supportsRefImages(node.model, { inputType: _inputTypeStrip, duration: _durationStrip })) {
            const _ctxStr = _inputTypeStrip ? ` (${_inputTypeStrip}${_durationStrip ? ', ' + _durationStrip : ''})` : '';
            nodeLog(`[Model Constraint] Model "${node.model}"${_ctxStr} KHÔNG hỗ trợ ref images — bỏ qua ${inputFileIds.length} ref (upstream + node pick)`, 'warn');
            inputFileIds = [];
          }
        }
      }

      // Build file_name lookup map cho addFileToPrompt fallback
      const fnLookup = this._buildFileNameLookup(node, workflow);

      // Chuyển sang pipeline PromptQueue nếu bật (SAU khi upstream đã correct + inputFileIds đã collect)
      const pqExists = !!window.PromptQueue;
      const pqEnabled = pqExists && PromptQueue.isEnabled();
      console.log(`[WorkflowExecutor] >>> NODE GENERATE DISPATCH — Pipeline Check: exists=${pqExists}, enabled=${pqEnabled}, settings.queueEnabled=${window.storageSettings?.getSettings?.()?.queueEnabled}`);
      console.log(`[WorkflowExecutor] >>> Will use ${pqExists && pqEnabled ? 'PIPELINE (PromptQueue)' : 'DIRECT (applySettings → ... → _waitForNewTiles)'} path`);
      nodeLog(`[Pipeline Check] PromptQueue exists: ${pqExists}, isEnabled: ${pqEnabled}, settings.queueEnabled: ${window.storageSettings?.getSettings?.()?.queueEnabled}`);
      if (pqExists && pqEnabled) {
        // Chờ download queue empty trước khi submit node mới
        // Tránh tranh chấp context menu giữa download và submit
        const pq = PromptQueue.getInstance();
        const downloadsCleared = await pq.waitForDownloadsEmpty(30000);
        if (!downloadsCleared) {
          nodeLog('[Pipeline] Timeout chờ downloads, tiếp tục submit...', 'warn');
        }

        const gd = await this._getGenDefaults();
        const isVid = (node.media_type || gd.genType) === 'Video';
        const nodeRefIds = node.ref_file_ids
          ? (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean)
          : [];
        // BUG FIX 2026-06-05: inputFileIds (từ _collectInputFileIds) đã dedup theo file_name.
        // Spread nodeRefIds raw lại sẽ ADD BACK duplicates. Áp dụng same content-dedup pattern.
        const _fnMap = new Map();
        if (node.ref_file_names) {
          for (const [id, fn] of Object.entries(node.ref_file_names)) if (fn) _fnMap.set(id, fn);
        }
        for (const e of (workflow.edges || []).filter(e => e.target_node_id === node.node_id)) {
          const src = workflow.nodes.find(n => n.node_id === e.source_node_id);
          if (src?.result_file_names) {
            for (const [id, fn] of Object.entries(src.result_file_names)) if (fn) _fnMap.set(id, fn);
          }
          if (src?.ref_file_names) {
            for (const [id, fn] of Object.entries(src.ref_file_names)) if (fn) _fnMap.set(id, fn);
          }
        }
        const _seenFn = new Set();
        const _seenId = new Set();
        const combinedRefIds = [];
        const _dropLog = [];
        for (const id of [...inputFileIds, ...nodeRefIds]) {
          if (_seenId.has(id)) { _dropLog.push(`${id.substring(0, 14)}(id-dup)`); continue; }
          _seenId.add(id);
          const fn = _fnMap.get(id);
          if (fn) {
            if (_seenFn.has(fn)) { _dropLog.push(`${id.substring(0, 14)}(fn-dup:${fn.substring(0, 8)})`); continue; }
            _seenFn.add(fn);
          }
          combinedRefIds.push(id);
        }
        console.log(`[REUPLOAD_AUDIT] DEDUP — inputFileIds: ${inputFileIds.length}, nodeRefIds: ${nodeRefIds.length}, _fnMap size: ${_fnMap.size}`);
        console.log(`[REUPLOAD_AUDIT] DEDUP — _fnMap entries: ${JSON.stringify([..._fnMap.entries()].map(([k, v]) => `${k.substring(0, 14)}→${v?.substring(0, 8)}`))}`);
        console.log(`[REUPLOAD_AUDIT] DEDUP — inputFileIds: ${JSON.stringify(inputFileIds.map(id => id.substring(0, 14)))}`);
        console.log(`[REUPLOAD_AUDIT] DEDUP — nodeRefIds: ${JSON.stringify(nodeRefIds.map(id => id.substring(0, 14)))}`);
        console.log(`[REUPLOAD_AUDIT] DEDUP — combinedRefIds: ${combinedRefIds.length}, dropped: ${_dropLog.length} [${_dropLog.join(', ')}]`);

        // Cap runtime cho Video Ingredients (Flow limit = 3 ảnh)
        // Image limit = 10 (Flow generous, không cần cap nghiêm)
        // Priority: giữ port edge refs trước (intent rõ ràng), cắt form attach sau
        //
        // Post-audit fix: dùng FlowAdapter.getMaxRefImages per-mode.
        const isVideoIngredientsPq = node.media_type === 'Video' && node.video_input_type !== 'Frames';
        const flowAdapterPq = window.ProviderRegistry?.get?.('flow');
        // 2026-05-28: pass modelValue → per-model max_ref_images override
        const refLimitPq = (typeof flowAdapterPq?.getMaxRefImages === 'function')
          ? flowAdapterPq.getMaxRefImages({ mode: isVideoIngredientsPq ? 'video' : 'image', isFrames: false, modelValue: node.model })
          : (isVideoIngredientsPq ? 3 : 10);
        let cappedRefIds = combinedRefIds;
        if (combinedRefIds.length > refLimitPq) {
          const portRefs = inputFileIds || [];   // upstream từ port edges (đã cap ở trên cho Video Ingredients)
          const formRefs = nodeRefIds || [];      // user pick qua image picker
          // Lấy tất cả portRefs trước (capped), bù từ formRefs cho đủ refLimit
          const portCap = portRefs.slice(0, refLimitPq);
          const formCap = formRefs.slice(0, Math.max(0, refLimitPq - portCap.length));
          cappedRefIds = [...new Set([...portCap, ...formCap])];
          const dropped = combinedRefIds.length - cappedRefIds.length;
          if (dropped > 0) {
            nodeLog(`Video Ingredients giới hạn ${refLimitPq} ảnh — bỏ qua ${dropped} ảnh thừa (ưu tiên giữ ảnh từ port edge)`, 'warn');
          }
        }

        // Filter synthetic IDs (chatgpt_xxx, grok_xxx, grok_video_xxx) — không dùng được làm
        // ref image cho Flow Generate vì chúng không có tile trên Flow DOM (bridge timeout).
        // Synthetic IDs chỉ có ý nghĩa cho Download node (có result_provider_urls).
        const syntheticPattern = /^(chatgpt_|grok_|grok_video_)/;
        const validFlowRefIds = cappedRefIds.filter(id => !syntheticPattern.test(id));
        if (validFlowRefIds.length < cappedRefIds.length) {
          const droppedSynthetic = cappedRefIds.length - validFlowRefIds.length;
          nodeLog(`Loại bỏ ${droppedSynthetic} synthetic ID (chatgpt/grok bridge timeout) — không có tile trên Flow DOM`, 'warn');
        }
        cappedRefIds = validFlowRefIds;

        // Model constraint: strip cappedRefIds nếu model không hỗ trợ.
        // Pipeline path re-extracts node.ref_file_ids at line 4155 → strip ở inputFileIds (line 4117)
        // không cover hết. Phải strip cappedRefIds ở đây để chặn refs cuối cùng pass vào submitJob.
        // Note: duration sau khi auto-bump ở flowVideoDuration (rule duration_overrides) — strip dùng node.video_duration gốc.
        if (cappedRefIds.length > 0 && flowAdapterPq?.supportsRefImages) {
          const _pipeInputType = isVid ? (node.video_input_type || 'Ingredients') : undefined;
          const _pipeDuration = isVid ? (node.video_duration || undefined) : undefined;
          if (!flowAdapterPq.supportsRefImages(node.model, { inputType: _pipeInputType, duration: _pipeDuration })) {
            const _ctxStr = _pipeInputType ? ` (${_pipeInputType}${_pipeDuration ? ', ' + _pipeDuration : ''})` : '';
            nodeLog(`[Model Constraint] Model "${node.model}"${_ctxStr} KHÔNG hỗ trợ ref images — bỏ qua ${cappedRefIds.length} ref (pipeline)`, 'warn');
            cappedRefIds = [];
          }
        }

        // Lớp 1 fix (2026-05-26): forward refFileNames cho pipeline → EditorExecutor có
        // file_name fallback (content.js addFileToPrompt) khi tile_id stale/đổi sau reload.
        // Gồm node.ref_file_names (ref user pick) + result_file_names của upstream nodes
        // (ref từ port edge = output node thượng nguồn). Trước fix: sót → fallback bị skip
        // → reload xong addRefImages fail (không cứu được).
        const pipelineRefNames = this._buildPipelineRefNames(node, workflow);

        emitNodePhase(node.node_id, 'generating');
        // [Phase 5 — D1 batch] Nếu upstream (prompt_sequence/variant_expand/loop) đã tách danh sách
        // scene/item → submit N prompt (mỗi item = 1 lần sinh) thay vì 1 mega-prompt gộp. Hạ tầng
        // PromptQueue.submitJob đã hỗ trợ mảng prompts (mỗi phần tử = 1 QueueItem = 1 generation).
        // Cap an toàn để tránh sinh quá nhiều ngoài ý muốn.
        const _batchPrompts = this._collectUpstreamBatchPrompts(node, workflow);
        let _promptsToSubmit = [node.prompt || ''];
        if (_batchPrompts && _batchPrompts.length >= 2) {
          const BATCH_CAP = 24;
          _promptsToSubmit = _batchPrompts.slice(0, BATCH_CAP);
          if (_batchPrompts.length > BATCH_CAP) nodeLog(`Batch: ${_batchPrompts.length} scene → giới hạn ${BATCH_CAP} lần sinh (cap an toàn).`, 'warn');
          else nodeLog(`Batch: sinh ${_promptsToSubmit.length} ảnh (mỗi scene 1 lần) từ danh sách upstream.`, 'info');
        }
        const pipelineResult = await pq.submitJob({
          owner: 'workflow',
          label: `Node: ${node.node_name || 'Generate'}`,
          prompts: _promptsToSubmit,
          settings: {
            genType: node.media_type || gd.genType,
            ratio: node.ratio || gd.ratio,
            model: node.model || (isVid ? gd.videoModel : gd.imageModel),
            isFrames: node.media_type === 'Video' && node.video_input_type === 'Frames',
            quantity: quantity,
            // Manual Submit mode (Phase 5): user tự nhấn Enter/click Submit cho node Flow này.
            manualSubmitMode: this._manualSubmitMode === true,
            flowVideoDuration: (() => {
              // Bug fix: fallback '6s' khi video node không có video_duration (legacy workflow từ server)
              let dur = isVid ? (node.video_duration || '6s') : null;
              // Model constraint override (2026-05-22): vd Veo 3.1 Lite/Fast Ingredients + ref → ép 8s.
              // Schema: provider_models.config.duration_overrides[]. Admin tune qua /admin/provider-models.
              if (isVid && cappedRefIds.length > 0) {
                // 2026-05-27: detect ref VIDEO (vd Omni Flash + ref video → force 10s).
                const _hasRefVideo = cappedRefIds.some(id => {
                  const tc = getThumbCache()?.get(id);
                  if (tc?.type === 'video') return true;
                  const rt = node.ref_thumbnails?.[id];
                  return !!(rt && typeof rt === 'object' && rt.type === 'video');
                });
                const forced = flowAdapterPq?.getDurationOverride?.({
                  modelValue: node.model,
                  hasRef: true,
                  hasRefVideo: _hasRefVideo,
                  inputType: node.video_input_type || 'Ingredients',
                });
                if (forced && forced !== dur) {
                  nodeLog(`[Model Constraint] Override duration ${dur} → ${forced} (${node.model} + ref image)`, 'warn');
                  dur = forced;
                }
              }
              console.log(`[WorkflowExecutor] Pipeline flowVideoDuration: node.video_duration="${node.video_duration}", isVid=${isVid}, hasRef=${cappedRefIds.length > 0}, result="${dur}"`);
              return dur;
            })(),
          },
          refFileIds: cappedRefIds,
          refFileNames: pipelineRefNames,
          // Đọc từ node settings — user có thể bật auto-download nếu không dùng Download node
          // Check feature gate: nếu không có quyền, force autoDownload = false
          autoDownload: (window.featureGate?.canUse('auto_download') ?? false) &&
            (node.auto_download === true || node.auto_download === '1' || node.auto_download === 1),
          // Forward resolution từ node config xuống pipeline.
          // Trước fix: bỏ qua → PromptQueue fallback DOM settings → user config 1080p nhưng download 720p.
          downloadResolution: node.download_resolution || null,
          videoDownloadResolution: node.video_download_resolution || null,
          taskName: workflow?.wf_name || null,
          // Bug 54 fix: Reuse execution token từ WorkflowExecutor, không request lại
          _executionToken: this._currentExecutionToken || null,
          // Flow Voice Selector — chỉ pass khi video + có voice configured
          voice: (isVid && node.voice_slug && node.voice_search_value)
            ? { slug: node.voice_slug, search_value: node.voice_search_value }
            : null,
          // Flow Character Selector — cả image+video (KHÔNG gate isVid)
          character: (node.character_slug && node.character_search_value)
            ? { slug: node.character_slug, search_value: node.character_search_value }
            : null,
        });

        // Extract result data từ pipeline
        const resultTileIds = pipelineResult.resultTileIds || [];
        console.log(`[WorkflowExecutor] >>> PIPELINE returned ${resultTileIds.length} tiles:`, resultTileIds.slice(0, 5));
        nodeLog(`Pipeline trả về ${resultTileIds.length} tile`, 'info');

        // GAP #3 fix 2026-06-22: pipeline báo FAIL (item FAILED, vd addRefImages không gắn được ref vừa
        // reupload) → resultTileIds rỗng nhưng KHÔNG throw → RetryHelper coi là success → maxRetries bị
        // bỏ qua → fail 1-attempt dù bật retry. Throw NGAY ĐÂY (trong scope RetryHelper) để node được
        // retry (re-reupload + re-addRefImages). Bug-52 check ở executeSingleNode chỉ là safety net NGOÀI retry.
        if (!pipelineResult.stopped && resultTileIds.length === 0 && (pipelineResult.failed || 0) > 0) {
          throw new Error(`Pipeline gen thất bại: 0 tile / ${pipelineResult.failed} prompt fail`);
        }

        if (resultTileIds.length > 0) emitNodePhase(node.node_id, 'downloading');

        // Track tiles đã download bởi pipeline (để Download node không download lại)
        // autoDownload = true nghĩa là PromptQueue đã download tiles này
        const canUseAutoDownload = window.featureGate?.canUse('auto_download') ?? false;
        const nodeAutoDownload = canUseAutoDownload &&
          (node.auto_download === true || node.auto_download === '1' || node.auto_download === 1);
        if (nodeAutoDownload && resultTileIds.length > 0) {
          if (!this._downloadedTileIds) this._downloadedTileIds = new Set();
          for (const tid of resultTileIds) {
            this._downloadedTileIds.add(tid);
          }
        }
        // Build thumbnails ở format tương thích với WorkflowEditor node:completed handler
        // Format: { tileId: { thumbnail, type, file_name } } (object, KHÔNG phải flat string)
        const resultThumbnails = {};
        const resultFileNames = {};
        if (pipelineResult.resultThumbnails) {
          for (const [tid, info] of Object.entries(pipelineResult.resultThumbnails)) {
            if (info?.thumbnail) {
              resultThumbnails[tid] = {
                thumbnail: info.thumbnail,
                type: info.type || 'image',
                file_name: info.file_name || '',
                ...(info.video_url && { video_url: info.video_url })  // Preserve video_url for video tiles
              };
              if (info.file_name) resultFileNames[tid] = info.file_name;
            }
          }
        }

        // Scan thêm từ DOM nếu thumbnails còn thiếu
        if (resultTileIds.length > 0 && window.MessageBridge) {
          const missingTiles = resultTileIds.filter(id => !resultThumbnails[id]);
          if (missingTiles.length > 0) {
            try {
              const scanResult = await MessageBridge.getThumbnailsByIds(missingTiles);
              const results = scanResult?.results || {};
              for (const tid of missingTiles) {
                if (results[tid]?.thumbnail) {
                  resultThumbnails[tid] = {
                    thumbnail: results[tid].thumbnail,
                    type: results[tid].type || 'image',
                    file_name: results[tid].file_name || '',
                    ...(results[tid].video_url && { video_url: results[tid].video_url })  // Preserve video_url for video tiles
                  };
                  if (results[tid].file_name) resultFileNames[tid] = results[tid].file_name;
                }
              }
            } catch (e) {
              console.warn('[WorkflowExecutor] Scan pipeline result thumbnails failed:', e.message);
            }
          }
        }

        return {
          fileIds: resultTileIds,
          duration: 0,
          thumbnails: resultThumbnails,
          fileNames: resultFileNames,
          pipelineResult,
          // Manual mode Option C: user bấm Skip → item CANCELLED (cancelledCount>0) + 0 result + 0 completed
          // → node đánh dấu 'skipped' (KHÔNG fail/throw). Bug 52 check dùng flag này bỏ qua throw.
          _userSkipped: (pipelineResult.cancelledCount || 0) > 0 &&
            resultTileIds.length === 0 && (pipelineResult.completed || 0) === 0,
          // Refs THỰC dùng (upstream + node pick, đã cap/dedup) — cho GenerationHistory log đúng
          // ref_img (node.ref_file_ids rỗng khi upstream-fed). 2026-06-25.
          refFileIdsUsed: Array.isArray(cappedRefIds) ? cappedRefIds : [],
        };
      }

      // 2. Apply settings (media type, ratio, model) — only once
      const gd = await this._getGenDefaults();
      const isVid = (node.media_type || gd.genType) === 'Video';
      nodeLog(`Cài đặt: ${node.media_type || gd.genType} / ${node.ratio || gd.ratio} / ${node.model || (isVid ? gd.videoModel : gd.imageModel)}`);

      // Quantity đã được set qua _applySettings (click x1/x2/x3/x4)
      // Mỗi node chỉ submit 1 lần, Flow sẽ tạo quantity ảnh

      if (this.shouldStop) throw new Error('Execution stopped by user');

      // Phase 5.2: Ensure node is NOT marked as submitted at start
      this._submittedNodes?.delete(node.node_id);

      // CRITICAL SECTION (editor mutex): serialize TOÀN BỘ chuỗi editor operations
      // Flow chỉ có 1 editor → parallel nodes PHẢI chờ nhau hoàn thành:
      // apply settings → clear editor → add ref → insert text → submit → chờ tile placeholder
      // Nếu không serialize: node_02 clear editor XÓA text của node_01 đang chờ submit
      const accum = nodeAccum || this._currentNodeAccum || { thumbnails: {}, fileNames: {} };
      let preTileIds, preFileNames;
      const releaseSubmitMutex = await this._acquireSubmitMutex();
      try {
        // 2026-06-02: Step 0 — đóng chat panel + Agent OFF + wait editor ready TRƯỚC mọi action.
        // Tránh removeRefs/addRefs khi panel/Agent UI vẫn chiếm composer area → ref add sai chỗ.
        if (window.MessageBridge?.prepareFlowForGen) {
          try {
            log('Step 0: prepareFlowForGen (close chat panel + Agent OFF + wait editor)');
            const prep = await window.MessageBridge.prepareFlowForGen();
            if (prep?.actioned) {
              log(`Step 0 actioned (editor ready in ${prep.editorReadyMs || 0}ms)`);
            }
          } catch (e) {
            log('Step 0 prepareFlowForGen failed (non-blocking):', e.message);
          }
        }

        // 2026-05-30 REORDER bug fix: applySettings PHẢI chạy SAU khi add ref images.
        // Lý do: Flow render duration option dựa trên ref type (vd ref=video → KHÔNG có
        // duration dropdown → applySettings(duration=...) fail).
        // ORDER MỚI: prepareFlowForGen → removeRefs → clearEditor → addRefs → applySettings → insertText → submit.
        // applySettings idempotent (skip nếu match) → cost per iter ~100ms acceptable.

        // [Bug fix] 2b. Xóa ref images cũ TRƯỚC khi clear text + add ref mới.
        // clearEditor() chỉ xóa text Slate, KHÔNG xóa ref image thumbnails (chúng ở ngoài Slate area).
        // Nếu skip bước này → ref images từ run trước còn lại → submit kèm ảnh sai.
        // Sync với EditorExecutor.processItem() pattern.
        await this._removeExistingRefImages();
        await this._sleep(200); // Settle delay sau khi xóa refs

        // 2c. Clear editor (chỉ xóa text Slate, refs đã xóa ở bước 2b)
        await this._clearEditor();
        await this._sleep(this._getClearEditorDelay());

        // 2d. Flow Voice + Character Selector (direct path — sync pipeline/EditorExecutor).
        // Order clear(2b) → voice → character → addRef(3). Voice chỉ video; character cả image+video.
        // removeExistingRefImages (2b) đã clear chip cũ → add fresh. selectFlow* tự đóng menu sau.
        {
          const _voicePayload = (isVid && node.voice_slug && node.voice_search_value)
            ? { slug: node.voice_slug, search_value: node.voice_search_value } : null;
          const _charPayload = (node.character_slug && node.character_search_value)
            ? { slug: node.character_slug, search_value: node.character_search_value } : null;
          if (_voicePayload && window.MessageBridge?.selectFlowVoice) {
            try {
              nodeLog(`Chọn giọng đọc: ${_voicePayload.search_value}`);
              await window.MessageBridge.selectFlowVoice(_voicePayload);
            } catch (e) { log('selectFlowVoice failed (non-blocking):', e.message); }
          }
          if (_charPayload && window.MessageBridge?.selectFlowCharacter) {
            try {
              nodeLog(`Chọn nhân vật: ${_charPayload.search_value}`);
              await window.MessageBridge.selectFlowCharacter(_charPayload);
            } catch (e) { log('selectFlowCharacter failed (non-blocking):', e.message); }
          }
        }

        // 3. Add reference images / frames (với file_name fallback)
        if (isFramesResult && node.media_type === 'Video' && node.video_input_type === 'Frames') {
          // Frames mode: rawInputFileIds = {frame1, frame2}
          // Filter synthetic IDs (hiếm khi xảy ra nhưng để an toàn)
          const frame1Valid = rawInputFileIds.frame1 && !syntheticIdPattern.test(rawInputFileIds.frame1);
          const frame2Valid = rawInputFileIds.frame2 && !syntheticIdPattern.test(rawInputFileIds.frame2);
          if (frame1Valid) {
            nodeLog(`Thêm Frame 1: ${rawInputFileIds.frame1.substring(0, 20)}...`);
            await this._addFileToPrompt(rawInputFileIds.frame1, fnLookup[rawInputFileIds.frame1]);
            await this._sleep(500);
          } else if (rawInputFileIds.frame1) {
            nodeLog('Frame 1 là synthetic ID — bỏ qua', 'warn');
          }
          if (frame2Valid) {
            nodeLog(`Thêm Frame 2: ${rawInputFileIds.frame2.substring(0, 20)}...`);
            await this._addFileToPrompt(rawInputFileIds.frame2, fnLookup[rawInputFileIds.frame2]);
            await this._sleep(500);
          } else if (rawInputFileIds.frame2) {
            nodeLog('Frame 2 là synthetic ID — bỏ qua', 'warn');
          }
        } else {
          if (inputFileIds.length > 0) {
            nodeLog(`Thêm ${inputFileIds.length} ảnh tham chiếu`);
            log(`Adding ${inputFileIds.length} ref images:`, inputFileIds);
          }
          for (const fileId of inputFileIds) {
            log('Adding ref image:', fileId);
            await this._addFileToPrompt(fileId, fnLookup[fileId]);
            await this._sleep(800);
          }
        }

        // Check stop trước khi submit (chưa submit thì dừng ngay)
        if (this.shouldStop) throw new Error('Execution stopped by user');

        // 4.5: 2026-05-30 REORDER — applySettings SAU khi add refs (TRƯỚC insertText).
        // Lý do: Flow render UI duration option dựa trên ref type. Vd ref=video → KHÔNG có
        // duration dropdown → applySettings(duration) fail nếu chạy trước add ref.
        // Pass hasRef=true để duration override (vd Veo Fast/Lite + ref → 8s) work đúng.
        const _hasRefForSettings = Array.isArray(inputFileIds) ? inputFileIds.length > 0 : false;
        await this._applySettings(node, _hasRefForSettings);

        // 5. Insert prompt
        nodeLog(`Nhập prompt: "${(node.prompt || '').substring(0, 40)}..."`);
        await this._insertPrompt(this._hygienicPrompt(node, isVid, nodeLog));

        // 6. Chờ Slate editor xử lý xong (derived: inputTimeout × 0.5)
        await this._sleep(this._getSubmitDelay());

        // Check stop trước submit lần cuối
        if (this.shouldStop) throw new Error('Execution stopped by user');

        // 7. Capture tile IDs NGAY TRƯỚC submit (trong mutex → thấy tiles từ nodes trước)
        preTileIds = await this._getCurrentTileIds(accum);
        console.log(`[WorkflowExecutor] preTileIds captured: ${preTileIds.length} tiles`, preTileIds.slice(0, 5));
        nodeLog(`Snapshot ${preTileIds.length} tile có sẵn TRƯỚC submit (baseline)`, 'info');

        // 8. Click submit
        emitNodePhase(node.node_id, 'submitting');
        await this._clickSubmit();
        // Phase 5.2: Mark this specific node as submitted
        this._submittedNodes?.add(node.node_id);
        log('Prompt submitted, waiting for result...');
        nodeLog(`Đã submit (x${quantity}), chờ kết quả...`, 'info');
        window.eventBus.emit('node:submitted', { node });
        emitNodePhase(node.node_id, 'generating');

        // Chờ tile placeholder xuất hiện trong DOM (Google Flow tạo gần như ngay lập tức)
        // Sau khi tile xuất hiện, node tiếp theo sẽ thấy nó trong preTileIds
        await this._sleep(1500);
      } finally {
        releaseSubmitMutex();
      }

      // 9. Monitor tiles (concurrent — không cần mutex)
      // CRITICAL: KHÔNG fallback `?? this._lastPreFileNames` — instance singleton bị overwrite
      // bởi parallel node sau, gây Node A lấy snapshot Node B → 15s grace timer accept tile cũ.
      // Per-node accum.preFileNames đã set chính xác trong _getCurrentTileIds (line ~4085).
      preFileNames = accum.preFileNames || null;
      console.log(`[WorkflowExecutor] CALLING _waitForNewTiles (timeout=${this.settings.tileTimeout}ms, expected quantity=${quantity})`);
      nodeLog(`Đang chờ ${quantity} tile mới (timeout ${Math.round(this.settings.tileTimeout/1000)}s)...`, 'info');
      // H3 fix: try/finally so the node is removed from _submittedNodes on failure/timeout too.
      // Trước fix: chỉ delete khi success → nếu _waitForNewTiles throw (timeout), node kẹt trong
      // _submittedNodes → shouldStop bị vô hiệu (line ~3661) → retry re-submit đốt quota bất chấp Stop.
      let newTileIds;
      try {
        newTileIds = await this._waitForNewTiles(preTileIds, this.settings.tileTimeout, preFileNames, accum, quantity);
      } finally {
        // Phase 5.2: Remove node from submitted tracking on completion OR failure/timeout
        this._submittedNodes?.delete(node.node_id);
      }
      console.log(`[WorkflowExecutor] _waitForNewTiles RETURNED ${newTileIds.length} tiles:`, newTileIds.slice(0, 5));
      // PHÂN LOẠI rồi CỨU ô hỏng — trước đây workflow bỏ hẳn bước này. Toàn bộ máy móc đã có
      // sẵn trong content.js và TileMonitor dùng nó cho tab Gen, nhưng WorkflowExecutor gọi
      // ĐÚNG 0 LẦN. Hệ quả: ô bị Flow chặn vẫn đi thẳng xuống node Download, Flow trả trang
      // HTML lỗi, và ta lưu thành file .htm mở không được.
      newTileIds = await this._rescueFailedTiles(newTileIds, nodeLog);
      allNewTileIds.push(...newTileIds);
      nodeLog(`Nhận ${newTileIds.length} kết quả mới`, 'success');
      if (newTileIds.length > 0) emitNodePhase(node.node_id, 'downloading');

      const duration = Date.now() - startTime;
      log(`Node "${node.node_name}" completed in ${duration}ms, got ${allNewTileIds.length} tiles`);

      return {
        fileIds: allNewTileIds,
        duration,
        thumbnails: accum.thumbnails,
        fileNames: accum.fileNames,
        // Refs THỰC dùng (upstream + node pick) cho GenerationHistory log ref_img. 2026-06-25.
        refFileIdsUsed: Array.isArray(inputFileIds) ? inputFileIds : [],
      };
    }

    /**
     * Execute Download node - tải kết quả
     */
    async _executeDownloadNode(node, workflow, emitLog) {
      const startTime = Date.now();
      console.log(`[WorkflowExecutor] >>> DOWNLOAD NODE START "${node.node_name || node.node_id}", collectAll=${node.download_collect_all}`);

      // Check auto_download feature gate — Download node cũng cần quyền
      const canUseAutoDownload = window.featureGate?.canUse('auto_download') ?? false;
      if (!canUseAutoDownload) {
        emitLog('Gói hiện tại không hỗ trợ tải xuống tự động. Vui lòng nâng cấp.', 'warn');
        return { fileIds: [], duration: Date.now() - startTime };
      }

      const collectAll = node.download_collect_all === true || node.download_collect_all === '1' || node.download_collect_all === 1;

      let inputFileIds;
      if (collectAll) {
        // Thu thap tat ca result_file_ids tu moi node trong workflow
        inputFileIds = this._collectAllWorkflowFileIds(workflow.nodes);
        console.log(`[WorkflowExecutor] >>> DOWNLOAD collectAll=TRUE → collected ${inputFileIds.length} tiles từ TẤT CẢ workflow nodes (kể cả nodes chưa hoàn thành!)`);
      } else {
        // Phase WK-1.4.7: Ưu tiên port `media_in`, fallback legacy collect (workflow cũ)
        inputFileIds = this._collectPortInputs(node, 'media_in', workflow.nodes, workflow.edges);
        if (!inputFileIds || inputFileIds.length === 0) {
          inputFileIds = this._collectInputFileIds(node, workflow.nodes, workflow.edges);
        }
        console.log(`[WorkflowExecutor] >>> DOWNLOAD via port/upstream → collected ${inputFileIds?.length || 0} tiles:`, inputFileIds?.slice(0, 5));
      }

      if (!Array.isArray(inputFileIds) || inputFileIds.length === 0) {
        throw new Error('Không có file để tải');
      }

      // Build file_name lookup for cross-project validation
      const fnLookup = this._buildFileNameLookup(node, workflow);
      // Dual URL — build provider URL lookup từ TẤT CẢ upstream nodes có result_provider_urls.
      // Tile có entry → download URL gốc Grok/ChatGPT (chất lượng 100%) thay vì Flow re-encoded.
      const providerUrlLookup = this._buildProviderUrlLookup(workflow.nodes);

      // Detect video: check upstream node media_type hoặc node config
      const hasVideoUpstream = this._hasVideoUpstreamNode(node, workflow);
      const resolution = hasVideoUpstream
        ? (node.video_download_resolution || (globalThis.DownloadPrefs?.DEFAULTS.video || '720p'))
        : (node.download_resolution || (globalThis.DownloadPrefs?.DEFAULTS.image || '1k'));

      emitLog(`Tải ${inputFileIds.length} file (${resolution.toUpperCase()})...`);
      let downloaded = 0;
      let skippedCrossProject = 0;

      // Ensure dedup set exists (để tránh Download node khác download lại cùng tile)
      if (!this._downloadedTileIds) this._downloadedTileIds = new Set();

      for (const fileId of inputFileIds) {
        if (this.shouldStop) break;

        // NOTE: Dedup chỉ áp dụng giữa nhiều Download nodes (tránh download cùng tile 2 lần).

        // Cross-project validation: verify file_name before download
        const expectedFileName = fnLookup[fileId];
        if (expectedFileName && this._isContentScriptContext()) {
          const tile = document.querySelector(`[data-tile-id="${fileId}"]`);
          if (tile) {
            const currentFileName = this._extractFileNameFromTile(tile);
            if (currentFileName && currentFileName !== expectedFileName) {
              emitLog(`Tile ${fileId.substring(0, 16)} thuộc project khác, bỏ qua`, 'warn');
              skippedCrossProject++;
              continue;
            }
          }
        }

        // Bug fix 2026-06-03: Lookup upstream source node (node có result_file_ids chứa fileId này)
        // để pass prompt thật xuống template. Trước fix: `{prompt}` template lookup `node.content`
        // (KHÔNG tồn tại trên Download node) → resolve 'untitled' → filename "Download_untitled".
        const sourceNode = (workflow.nodes || []).find(n => {
          if (!n || n.node_id === node.node_id) return false;
          const ids = (n.result_file_ids || '').split(',').map(s => s.trim());
          return ids.includes(fileId);
        });

        // Build ten file tu template
        const promptText = this._buildDownloadFileName(node, workflow, downloaded, sourceNode);
        const fileName = fnLookup[fileId] || null;
        // Subfolder: ưu tiên node.download_folder, để trống = dùng workflow name (undefined)
        const subfolder = node.download_folder ? node.download_folder : undefined;

        try {
          // Dual URL: tile có URL provider gốc → fetch direct (chất lượng 100%).
          // Fallback Flow context menu nếu fetch fail (URL provider có thể đã expire TTL).
          const providerData = providerUrlLookup[fileId];
          if (providerData?.url) {
            const ok = await this._downloadProviderTileDirect(fileId, providerData, promptText, downloaded + 1, subfolder, fileName);
            if (!ok) {
              await this._downloadSingleTile(fileId, promptText, resolution, fileName, null, subfolder);
            }
          } else {
            await this._downloadSingleTile(fileId, promptText, resolution, fileName, null, subfolder);
          }
          this._downloadedTileIds.add(fileId);
          downloaded++;
          emitLog(`Đã tải ${downloaded}/${inputFileIds.length}`, 'success');
        } catch (err) {
          emitLog(`Lỗi tải file ${fileId}: ${err.message}`, 'warn');
        }

        await this._sleep(500);
      }

      if (skippedCrossProject > 0) {
        emitLog(`Bỏ qua ${skippedCrossProject} file thuộc project khác`, 'warn');
      }

      return { fileIds: [], duration: Date.now() - startTime };
    }

    /**
     * Check if any upstream node (connected input) is video type
     */
    _hasVideoUpstreamNode(node, workflow) {
      if (!workflow?.edges || !workflow?.nodes) return false;
      const inputEdges = workflow.edges.filter(e => e.target_node_id === node.node_id);
      for (const edge of inputEdges) {
        const sourceNode = workflow.nodes.find(n => n.node_id === edge.source_node_id);
        if (!sourceNode) continue;
        // Flow generate node convention
        if (sourceNode.media_type === 'Video') return true;
        // Phase G-6 bug fix: Grok node lưu mode trong `grok_mode` (image/video), KHÔNG có media_type.
        // Trước fix: Grok video upstream → Download node default '1k' (image res) thay vì '720p' (video).
        const nodeType = sourceNode.node_type || sourceNode.type;
        if (nodeType === 'grok' && sourceNode.grok_mode === 'video') return true;
        // Result thumbnails với type='video' → upstream đã produce video tile (vd Grok bridge MP4 sang Flow)
        const thumbs = sourceNode.result_thumbnails || {};
        for (const key of Object.keys(thumbs)) {
          const t = thumbs[key];
          if (t && typeof t === 'object' && t.type === 'video') return true;
        }
      }
      return false;
    }

    /**
     * Collect ALL result_file_ids from every node in the workflow
     */
    _collectAllWorkflowFileIds(nodes) {
      const fileIds = [];
      for (const n of (nodes || [])) {
        if (n.node_type === 'download') continue;
        if (n.result_file_ids) {
          const ids = (n.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          fileIds.push(...ids);
        }
      }
      return [...new Set(fileIds)];
    }

    /**
     * Build download file name from template variables.
     * @param {Object} node - Download node
     * @param {Object} workflow
     * @param {number} index
     * @param {Object} [sourceNode] - Upstream gen node đã tạo tile này (tuỳ chọn). Dùng cho
     *   template variable `{prompt}` — prompt thật của node tạo tile (Bug fix 2026-06-03).
     */
    _buildDownloadFileName(node, workflow, index, sourceNode = null) {
      // 2026-06-03: fallback default template cho node cũ (saved với template empty trước khi
      // default được set ở NodeTemplates.getDefaults). Giữ logic empty=default consistent.
      const DEFAULT_TEMPLATE = '{node}_{prompt}_{date}_{time}_{index}';
      const template = node.download_file_template || DEFAULT_TEMPLATE;

      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const time = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

      // Sanitize: remove path separators + invalid filename chars (Windows/Mac/Linux compat).
      // Áp dụng cho values TỪ user data, KHÔNG cho whole template (template do user define, có thể có / cố ý).
      const sanitize = (val) => String(val || '').replace(/[\/\\:*?"<>|]/g, '_').trim() || 'untitled';

      // Bug fix 2026-06-03: `{prompt}` resolve qua existing `_resolveEffectivePrompt` (line 7559)
      // để cover ChatGPT/Grok node với prompt_source='upstream_node' (node.prompt empty ở server
      // snapshot — runtime combine upstream KHÔNG persist). Trước: dùng `node.content` (KHÔNG
      // tồn tại trên Download node) → luôn 'untitled'.
      // _resolveEffectivePrompt return `{text, source}` object — destructure + null guard.
      // Truncate 60 chars để filename không quá dài (filesystem limit ~255 chars).
      let rawPrompt = '';
      if (sourceNode) {
        try {
          const resolved = this._resolveEffectivePrompt(sourceNode, workflow);
          rawPrompt = String(resolved?.text || '');
        } catch (_) { /* fallback empty */ }
      }
      const promptValue = sanitize(rawPrompt.substring(0, 60));

      return template
        .replace(/\{workflow\}/g, sanitize(workflow.name || 'workflow'))
        .replace(/\{node\}/g, sanitize(node.node_name || 'download'))
        .replace(/\{index\}/g, String(index + 1))
        .replace(/\{date\}/g, date)
        .replace(/\{time\}/g, time)
        .replace(/\{prompt\}/g, promptValue);
    }

    /**
     * Execute Telegram node - gửi ảnh qua Telegram API
     * Pass-through: trả về input fileIds cho downstream nodes
     */
    async _executeTelegramNode(node, workflow, emitLog) {
      const startTime = Date.now();

      // [FIX 2026-07-09] Local/offline: gửi Telegram cần server (bot token nằm server-side; node chỉ
      // có chat_id/message). Offline KHÔNG gửi được. Trước đây ApiClient.request throw LOCAL_MODE bị
      // catch → node báo "hoàn thành" giả (không gửi gì). Gate rõ ràng: pass-through media + log rõ.
      if (self.SEOSONA_LOCAL_MODE !== false) {
        emitLog('Telegram gửi ảnh cần server — KHÔNG khả dụng ở chế độ offline. Bỏ qua node, chuyển tiếp media.', 'warn');
        let ids = this._collectPortInputs(node, 'media_in', workflow.nodes, workflow.edges);
        if (!ids || ids.length === 0) ids = this._collectInputFileIds(node, workflow.nodes, workflow.edges);
        return { fileIds: ids, duration: Date.now() - startTime };
      }

      // Feature gate check
      const canUseTelegram = (window.featureGate?.canUse('telegram_enabled') ?? false) &&
        (window.featureGate?.canUse('telegram_workflow') ?? false);
      if (!canUseTelegram) {
        emitLog('Tính năng Telegram bị khóa trong gói hiện tại. Vui lòng nâng cấp.', 'warn');
        // Pass-through: return input files anyway (port-aware, fallback legacy)
        let inputFileIds = this._collectPortInputs(node, 'media_in', workflow.nodes, workflow.edges);
        if (!inputFileIds || inputFileIds.length === 0) {
          inputFileIds = this._collectInputFileIds(node, workflow.nodes, workflow.edges);
        }
        return { fileIds: inputFileIds, duration: Date.now() - startTime };
      }

      // Validate chat_id
      const chatId = node.telegram_chat_id;
      if (!chatId) {
        throw new Error('Chưa nhập Telegram Chat ID');
      }

      // Collect input tiles — Phase WK-1.4.7: ưu tiên port `media_in`, fallback legacy
      let inputFileIds = this._collectPortInputs(node, 'media_in', workflow.nodes, workflow.edges);
      if (!inputFileIds || inputFileIds.length === 0) {
        inputFileIds = this._collectInputFileIds(node, workflow.nodes, workflow.edges);
      }
      if (!Array.isArray(inputFileIds) || inputFileIds.length === 0) {
        throw new Error('Không có ảnh để gửi qua Telegram');
      }

      // Build file_name lookup for cross-project validation
      const fnLookup = this._buildFileNameLookup(node, workflow);

      // Extract CDN URLs from tiles
      const images = [];
      let skippedCrossProject = 0;

      for (const fileId of inputFileIds) {
        if (this.shouldStop) break;

        // Cross-project validation
        const expectedFileName = fnLookup[fileId];
        if (expectedFileName && this._isContentScriptContext()) {
          const tile = document.querySelector(`[data-tile-id="${fileId}"]`);
          if (tile) {
            const currentFileName = this._extractFileNameFromTile(tile);
            if (currentFileName && currentFileName !== expectedFileName) {
              emitLog(`Tile ${fileId.substring(0, 16)} thuộc project khác, bỏ qua`, 'warn');
              skippedCrossProject++;
              continue;
            }
          }
        }

        // Extract media URL and type
        let mediaUrl = null;
        let mediaType = 'image';

        // 1. Try result_thumbnails cache from upstream nodes
        for (const n of (workflow.nodes || [])) {
          if (n.result_thumbnails && n.result_thumbnails[fileId]) {
            const thumb = n.result_thumbnails[fileId];
            if (typeof thumb === 'object') {
              // Check for video
              if (thumb.type === 'video' && thumb.video_url) {
                mediaUrl = thumb.video_url;
                mediaType = 'video';
              } else if (thumb.thumbnail && thumb.thumbnail.startsWith('https://')) {
                mediaUrl = thumb.thumbnail;
                mediaType = thumb.type || 'image';
              }
            } else if (thumb && thumb.startsWith('https://')) {
              mediaUrl = thumb;
            }
            if (mediaUrl) break;
          }
        }

        // 2. Fallback: DOM query
        if (!mediaUrl && this._isContentScriptContext()) {
          const tile = document.querySelector(`[data-tile-id="${fileId}"]`);
          if (tile) {
            // Check video first
            const video = tile.querySelector('video[src]');
            if (video && video.src && video.src.startsWith('https://')) {
              mediaUrl = video.src;
              mediaType = 'video';
            } else {
              const img = tile.querySelector('img[src*="googleusercontent.com"], img[src*="google.com"]');
              if (img && img.src && img.src.startsWith('https://')) {
                mediaUrl = img.src;
                mediaType = 'image';
              }
            }
          }
        }

        if (mediaUrl) {
          images.push({ url: mediaUrl, type: mediaType, file_id: fileId });
        }
      }

      if (skippedCrossProject > 0) {
        emitLog(`Bỏ qua ${skippedCrossProject} file thuộc project khác`, 'warn');
      }

      if (images.length === 0) {
        throw new Error('Không tìm thấy URL ảnh hợp lệ để gửi');
      }

      // Convert to base64 (giống TelegramExecutor)
      emitLog(`Đang tải ${images.length} file để gửi qua Telegram...`);
      const mediaItems = await this._convertMediaToBase64ForTelegram(images);

      if (mediaItems.length === 0) {
        throw new Error('Không thể tải file để gửi qua Telegram');
      }

      // Send via API
      const sendMode = node.telegram_send_mode || 'single';
      const message = node.telegram_message || '';

      emitLog(`Gửi ${mediaItems.length} file qua Telegram...`);

      try {
        const response = await ApiClient.request('POST', 'telegram/send-workflow-images', {
          chat_id: chatId,
          images: mediaItems,
          message: message,
          send_mode: sendMode,
        });

        const sentCount = response?.sent_count || response?.data?.sent_count || 0;
        emitLog(`Đã gửi ${sentCount} ảnh qua Telegram`, 'success');
      } catch (err) {
        emitLog(`Lỗi gửi Telegram: ${err.message}`, 'warn');
        // Don't throw - allow workflow to continue (pass-through)
      }

      // Pass-through: return input file IDs for downstream nodes
      return {
        fileIds: inputFileIds,
        duration: Date.now() - startTime,
      };
    }

    /**
     * Convert media (images/videos) sang base64 để gửi qua Telegram.
     * Giống logic TelegramExecutor._convertThumbnailsToBase64()
     * @param {Array} mediaItems - Array of { url, type, file_id }
     * @returns {Array} Array of { base64, type, mime_type }
     */
    async _convertMediaToBase64ForTelegram(mediaItems) {
      const results = [];
      for (const item of mediaItems) {
        if (this.shouldStop) break;
        try {
          const mediaType = item.type || 'image';
          const url = item.url;
          if (!url) continue;

          // Fetch media từ Flow với timeout 30s. KHÔNG credentials: 'include' vì
          // Flow CDN trả Allow-Origin: '*' → CORS block. Signed URL đã đủ authenticate.
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          let response;
          try {
            response = await fetch(url, { signal: controller.signal });
          } finally {
            clearTimeout(timeoutId);
          }
          if (!response.ok) {
            console.warn('[WorkflowExecutor] Failed to fetch media:', url, response.status);
            continue;
          }

          const blob = await response.blob();

          // Video quá lớn (>50MB) thì skip (Telegram limit)
          if (mediaType === 'video' && blob.size > 50 * 1024 * 1024) {
            console.warn('[WorkflowExecutor] Video too large for Telegram:', blob.size);
            continue;
          }

          // Convert blob sang base64
          const base64 = await this._blobToBase64(blob);

          results.push({
            type: mediaType,
            base64: base64,
            mime_type: blob.type || (mediaType === 'video' ? 'video/mp4' : 'image/png'),
          });
        } catch (err) {
          console.warn('[WorkflowExecutor] Error converting media to base64:', item.url, err.message);
        }
      }
      return results;
    }

    /**
     * Convert Blob sang base64 string (không có prefix data:...)
     */
    _blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          // Loại bỏ prefix "data:image/png;base64,"
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    /**
     * Execute Delay node - chờ X giây
     */
    async _executeDelayNode(node, emitLog) {
      const seconds = node.delay_seconds || 3;
      emitLog(`Chờ ${seconds} giây...`);

      // Time-based với poll 200ms để stop signal phản hồi nhanh hơn (trễ tối đa 200ms thay vì 1s)
      const startTime = Date.now();
      const targetMs = seconds * 1000;
      while (Date.now() - startTime < targetMs) {
        if (this.shouldStop) break;
        const remaining = targetMs - (Date.now() - startTime);
        await this._sleep(Math.min(200, remaining));
      }

      // Pass through input file IDs — ưu tiên port `any_in`, fallback legacy collect
      let inputFileIds = this._collectPortInputs(node, 'any_in', this.currentWorkflow.nodes, this.currentWorkflow.edges);
      if (!inputFileIds || inputFileIds.length === 0) {
        inputFileIds = this._collectInputFileIds(node, this.currentWorkflow.nodes, this.currentWorkflow.edges);
      }

      return {
        fileIds: Array.isArray(inputFileIds) ? inputFileIds : [],
        duration: seconds * 1000
      };
    }

    /**
     * Image node: pass ref_file_ids as output (no generation)
     */
    async _executeImageNode(node, emitLog) {
      emitLog(`[IMAGE] Start: ref_file_ids=${node.ref_file_ids?.substring(0, 40)}`);
      emitLog(`[IMAGE] ref_file_names=${JSON.stringify(node.ref_file_names || {})}`);

      const refIds = node.ref_file_ids
        ? (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean)
        : [];

      if (refIds.length === 0) {
        emitLog('Node hình ảnh không có file tham chiếu', 'warning');
        return { fileIds: [], duration: 0 };
      }

      // BUG FIX: Sync ref_thumbnails/ref_file_names với ref_file_ids
      // Image node có thể bị mismatch (ref_file_ids có ID mà ref_thumbnails/ref_file_names không có)
      if (!node.ref_thumbnails || Array.isArray(node.ref_thumbnails)) node.ref_thumbnails = {};
      if (!node.ref_file_names || Array.isArray(node.ref_file_names)) node.ref_file_names = {};

      // Tìm IDs thiếu thumbnail
      const missingThumbIds = refIds.filter(fid => !node.ref_thumbnails[fid]);

      // Bước 1: Thử MediaRegistry trước
      for (const fid of missingThumbIds) {
        if (typeof MediaRegistry !== 'undefined') {
          const mrThumb = MediaRegistry.getThumb?.(fid);
          if (mrThumb) {
            node.ref_thumbnails[fid] = mrThumb;
            emitLog(`[IMAGE] Sync thumb từ MediaRegistry: ${fid.substring(0, 12)}`);
          }
          const mrName = MediaRegistry.getFileName?.(fid);
          if (mrName && !node.ref_file_names[fid]) {
            node.ref_file_names[fid] = mrName;
          }
        }
      }

      // Bước 2: DOM scan cho IDs vẫn còn thiếu thumbnail
      const stillMissing = refIds.filter(fid => !node.ref_thumbnails[fid]);
      if (stillMissing.length > 0 && window.MessageBridge?.getThumbnailsByIds) {
        emitLog(`[IMAGE] DOM scan cho ${stillMissing.length} IDs thiếu thumbnail...`);
        try {
          const scanResult = await window.MessageBridge.getThumbnailsByIds(stillMissing);
          const results = scanResult?.results || {};
          for (const [fileId, info] of Object.entries(results)) {
            if (info?.thumbnail) {
              node.ref_thumbnails[fileId] = info.thumbnail;
              emitLog(`[IMAGE] DOM scan found thumb: ${fileId.substring(0, 12)}`);
            }
            if (info?.file_name && !node.ref_file_names[fileId]) {
              node.ref_file_names[fileId] = info.file_name;
            }
          }
        } catch (scanErr) {
          emitLog(`[IMAGE] DOM scan failed: ${scanErr.message}`, 'warn');
        }
      }

      emitLog(`[IMAGE] ref_thumbnails keys after sync: ${Object.keys(node.ref_thumbnails).join(', ') || '(empty)'}`);

      // Upload pending local files nếu có
      const oldRefIds = node.ref_file_ids;
      if (node.ref_file_ids.includes('upload_') && typeof window.uploadPendingFiles === 'function') {
        emitLog(window.I18n?.t('workflow.uploadingLocalImages') || 'Uploading local images to Flow...', 'info');
        node.ref_file_ids = await window.uploadPendingFiles(node.ref_file_ids);
        // Sync ref_file_ids mới vào Drawflow data
        if (node.ref_file_ids !== oldRefIds) {
          // Capture ref_file_names từ GenTab.fileNameCache
          const newIdArr = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          if (!node.ref_file_names) node.ref_file_names = {};
          for (const newId of newIdArr) {
            if (MediaRegistry.getFileName(newId)) {
              node.ref_file_names[newId] = MediaRegistry.getFileName(newId);
            }
          }
          window.eventBus?.emit('node:ref_replaced', {
            nodeId: node.node_id,
            oldRefIds,
            newRefIds: node.ref_file_ids,
            refFileNames: node.ref_file_names,
            refThumbnails: node.ref_thumbnails
          });

          // Persist updated ref data after local file upload
          emitLog('[Upload] Persisting ref data after local file upload');
          try {
            await window.storageManager?.updateNodeStatus(
              this.currentWorkflow.wf_id,
              node.node_id,
              { ref_file_ids: node.ref_file_ids, ref_thumbnails: node.ref_thumbnails, ref_file_names: node.ref_file_names }
            );
          } catch (e) {
            log('Failed to persist ref update:', e.message);
          }
        }
      }

      // Handle import keys (upload_import_*) - fetch từ CDN và upload lên Flow
      const hasImageImportKeys = node.ref_file_ids && node.ref_file_ids.includes('upload_import_');
      if (hasImageImportKeys && typeof window.reuploadMissingFiles === 'function') {
        const imageImportThumbMap = node.ref_thumbnails || {};
        emitLog(`[Import] Xử lý ${Object.keys(imageImportThumbMap).length} import keys từ CDN...`);
        const uploadedImageImport = await window.reuploadMissingFiles(node.ref_file_ids, imageImportThumbMap, null, null);
        if (uploadedImageImport !== node.ref_file_ids) {
          emitLog(`[Import] Upload thành công: ${uploadedImageImport.substring(0, 60)}...`);
          node.ref_file_ids = uploadedImageImport;
          const newImageIdArr = (uploadedImageImport || '').split(',').map(s => s.trim()).filter(Boolean);
          if (!node.ref_file_names) node.ref_file_names = {};
          if (!node.ref_thumbnails) node.ref_thumbnails = {};
          // Bug fix: Ưu tiên _lastReuploadTileDetails (có thumbnail mới từ Flow)
          // Fallback MediaRegistry nếu không có
          const reuploadDetails = window._lastReuploadTileDetails || {};
          for (const newId of newImageIdArr) {
            const detail = reuploadDetails[newId];
            if (detail?.file_name) {
              node.ref_file_names[newId] = detail.file_name;
            } else if (MediaRegistry.getFileName(newId)) {
              node.ref_file_names[newId] = MediaRegistry.getFileName(newId);
            }
            if (detail?.thumbnailUrl) {
              node.ref_thumbnails[newId] = detail.thumbnailUrl;
            } else if (MediaRegistry.getThumb(newId)) {
              node.ref_thumbnails[newId] = MediaRegistry.getThumb(newId);
            }
          }
          for (const key of Object.keys(imageImportThumbMap)) {
            if (key.startsWith('upload_import_')) {
              delete node.ref_file_names[key];
              delete node.ref_thumbnails[key];
            }
          }
          window.eventBus?.emit('node:ref_replaced', {
            nodeId: node.node_id,
            oldRefIds: Object.keys(imageImportThumbMap).join(', '),
            newRefIds: node.ref_file_ids,
            refFileNames: node.ref_file_names,
            refThumbnails: node.ref_thumbnails
          });
          // CRITICAL: Persist updated ref data để lần chạy sau không cần reupload import keys
          try {
            await window.storageManager?.updateNodeStatus(
              this.currentWorkflow.wf_id,
              node.node_id,
              { ref_file_ids: node.ref_file_ids, ref_thumbnails: node.ref_thumbnails, ref_file_names: node.ref_file_names }
            );
            emitLog('[Import] Đã lưu ref data vào storage');
          } catch (e) {
            log('[Import] Failed to persist ref update:', e.message);
          }
        }
      }

      // Correct stale tile IDs (5-tầng)
      if (node.ref_file_ids && !node.ref_file_ids.includes('upload_')) {
        // Lưu original IDs trước correctFileIds để reupload cache lookup đúng key
        const originalImageRefIds = node.ref_file_ids;
        const thumbMap = { ...(node.ref_thumbnails || {}), ...(node.result_thumbnails || {}) };
        // BUGFIX: Dùng ref_file_names cho ref correction
        const fnMap = { ...(node.ref_file_names || {}), ...(node.result_file_names || {}) };
        if (typeof window.correctFileIds === 'function' && (Object.keys(thumbMap).length > 0 || Object.keys(fnMap).length > 0)) {
          const { correctedIds, changed } = await window.correctFileIds(node.ref_file_ids, thumbMap, fnMap);
          if (changed) {
            emitLog('Đã cập nhật ref image IDs (tile ID thay đổi sau reload)');
            node.ref_file_ids = correctedIds;
          }
        }

        // Tầng 5: Re-upload nếu vẫn còn missing
        // Truyền thumbnail map trực tiếp — không phụ thuộc GenTab (popup window không có)
        if (typeof window.reuploadMissingFiles === 'function') {
          const beforeReupload = node.ref_file_ids;
          const thumbMap2 = { ...(node.ref_thumbnails || {}), ...(node.result_thumbnails || {}) };
          // CRITICAL: Truyền file_names map để check file_name trước (tránh reupload không cần thiết)
          const imageRefFileNamesMap = { ...(node.ref_file_names || {}), ...(node.result_file_names || {}) };
          const updated = await window.reuploadMissingFiles(node.ref_file_ids, thumbMap2, originalImageRefIds, imageRefFileNamesMap);
          if (updated !== beforeReupload) {
            emitLog('Đã re-upload ảnh tham chiếu bị thiếu trên Flow');
            node.ref_file_ids = updated;

            // Cập nhật ref_thumbnails + ref_file_names với new IDs từ reupload
            const oldArr = (beforeReupload || '').split(',').map(s => s.trim()).filter(Boolean);
            const newArr = (updated || '').split(',').map(s => s.trim()).filter(Boolean);
            if (!node.ref_thumbnails) node.ref_thumbnails = {};
            if (!node.ref_file_names) node.ref_file_names = {};
            for (let i = 0; i < oldArr.length && i < newArr.length; i++) {
              if (oldArr[i] !== newArr[i]) {
                // Transfer old data sang new key
                if (node.ref_thumbnails[oldArr[i]]) {
                  node.ref_thumbnails[newArr[i]] = node.ref_thumbnails[oldArr[i]];
                  delete node.ref_thumbnails[oldArr[i]];
                }
                if (node.ref_file_names?.[oldArr[i]]) {
                  node.ref_file_names[newArr[i]] = node.ref_file_names[oldArr[i]];
                  delete node.ref_file_names[oldArr[i]];
                }
                // Cập nhật với NEW data từ reupload tileDetails hoặc GenTab fallback
                const reupDetails = window._lastReuploadTileDetails || {};
                const newThumb = reupDetails[newArr[i]]?.thumbnailUrl || MediaRegistry.getThumb(newArr[i]);
                const newFileName = reupDetails[newArr[i]]?.file_name || MediaRegistry.getFileName(newArr[i]);
                emitLog(`[Reupload] ${oldArr[i]} → ${newArr[i]}, file_name=${newFileName || 'NULL'}`);
                if (newThumb) {
                  node.ref_thumbnails[newArr[i]] = newThumb;
                }
                if (newFileName) {
                  node.ref_file_names[newArr[i]] = newFileName;
                } else {
                  emitLog(`[Reupload] WARNING: No file_name for ${newArr[i]} - may reupload again next run`, 'warning');
                }
              }
            }

            // Persist updated ref data vào workflow storage để lần chạy sau không reupload lại
            emitLog(`[Persist] Saving ref data: ids=${node.ref_file_ids}, names=${JSON.stringify(node.ref_file_names)}`);
            try {
              await window.storageManager?.updateNodeStatus(
                this.currentWorkflow.wf_id,
                node.node_id,
                { ref_file_ids: node.ref_file_ids, ref_thumbnails: node.ref_thumbnails, ref_file_names: node.ref_file_names }
              );
              emitLog('[Persist] Ref data saved successfully');
            } catch (e) {
              emitLog('[Persist] FAILED to save ref data: ' + e.message, 'error');
            }

            window.eventBus?.emit('node:ref_replaced', {
              nodeId: node.node_id,
              oldRefIds: beforeReupload,
              newRefIds: node.ref_file_ids,
              refFileNames: node.ref_file_names,
              refThumbnails: node.ref_thumbnails
            });
          }
        }
      }

      const finalIds = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      if (finalIds.length === 0) {
        emitLog('Không thể tìm lại ảnh tham chiếu trên Flow', 'warning');
      } else {
        emitLog(`Truyền ${finalIds.length} hình tham chiếu cho node tiếp theo`);
      }

      // CRITICAL FIX: Copy ref_* sang result_* để downstream nodes (ChatGPT/Grok) có thể merge thumbnails
      // Port merge tại _prepareNode kiểm tra src.result_thumbnails — nếu không set thì downstream không nhận thumbnails
      node.result_file_ids = node.ref_file_ids;
      node.result_thumbnails = { ...(node.ref_thumbnails || {}) };
      node.result_file_names = { ...(node.ref_file_names || {}) };

      // Trả fileNames từ node để downstream có thể dùng file_name correction
      // BUGFIX: Image node dùng ref_file_names (không phải result_file_names)
      const imageFileNames = { ...(node.ref_file_names || {}), ...(node.result_file_names || {}) };
      return { fileIds: finalIds, fileNames: imageFileNames, duration: 0 };
    }

    /**
     * Resolve thumbnail URL cho 1 ref ID — 4 nguồn, đồng bộ với section 6 resolvedRefs loop
     * của _executeChatGPTImageNode/_executeGrokImageNode.
     */
    _resolveRefThumb(node, fid) {
      const rt = node.ref_thumbnails?.[fid];
      if (typeof rt === 'string' && rt) return rt;
      if (rt?.thumbnail) return rt.thumbnail;
      if (window.GenTab?.thumbnailCache?.[fid]) return window.GenTab.thumbnailCache[fid];
      if (typeof MediaRegistry !== 'undefined' && MediaRegistry.getThumb?.(fid)) return MediaRegistry.getThumb(fid);
      { const _tcThumb = getThumbCache()?.get(fid)?.thumbnail; if (_tcThumb) return _tcThumb; }
      return '';
    }

    /**
     * True nếu MỌI ref của node đã có thumbnail resolve base64 được → grok/chatgpt submit dùng
     * base64 từ thumbnail, KHÔNG cần tile Flow sống → skip correctFileIds + reuploadMissingFiles.
     * Tránh false-missing (tile không nằm trong DOM đang load) → reupload trùng + delay 23s+13s.
     * Chỉ áp dụng grok/chatgpt (submit base64); generate/Flow node KHÔNG dùng (cần tile Flow thật).
     */
    _allRefsResolvableFromThumbnail(node) {
      const ids = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length === 0) return false;
      return ids.every(fid => !!this._resolveRefThumb(node, fid));
    }

    /**
     * True nếu MỌI result ref của source node upstream đã có thumbnail → target grok/chatgpt
     * resolve base64 được mà không cần tile Flow sống → skip upstream reupload (Tầng 5a).
     * Tránh false-missing (tile không trong DOM đang load) → reupload trùng + delay.
     */
    _sourceRefsHaveThumbnail(sourceNode) {
      const ids = (sourceNode.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length === 0) return false;
      const thumbs = { ...(sourceNode.result_thumbnails || {}), ...(sourceNode.ref_thumbnails || {}) };
      return ids.every(id => !!thumbs[id]);
    }

    /**
     * Execute ChatGPT Image node — sinh ảnh qua ChatGPT provider rồi bridge sang Flow.
     * Flow:
     *   1. Feature gate check (chatgpt_enabled).
     *   2. Get adapter qua ProviderRegistry.
     *   3. ensureReady → emit chatgpt:login_required nếu fail.
     *   4. Smart Clone reconstruction + upload pending refs + resolve refs sang base64.
     *   5. ExecutionGate request token (chatgpt_run quota).
     *   6. adapter.submit({...}) → nhận imageUrls + tabId.
     *   7. Cross-provider bridge: mỗi imageUrl → MessageBridge.chatGPTBridgeToFlow → tileId trên Flow.
     *   8. Persist result_file_ids/thumbnails/file_names theo format object {tileId: {thumbnail, type, file_name}}.
     *   9. Auto-download nếu node.auto_download (skip nếu PromptQueue.isEnabled() — pipeline đã handle).
     *   10. ExecutionGate.complete + emit node:completed.
     */
    async _executeChatGPTImageNode(node, workflow, emitLog, nodeAccum = null) {
      const startTime = Date.now();

      // 1. Feature gate
      if (!window.featureGate || !window.featureGate.canUse('chatgpt_enabled')) {
        const err = new Error('Tính năng ChatGPT chưa được kích hoạt cho gói hiện tại');
        err.code = 'FEATURE_LOCKED';
        node.last_error = 'FEATURE_LOCKED';
        throw err;
      }

      // 2. Lấy adapter
      if (!window.ProviderRegistry) {
        throw new Error('ProviderRegistry chưa sẵn sàng');
      }
      const adapter = window.ProviderRegistry.get('chatgpt');
      if (!adapter) {
        throw new Error('ChatGPT adapter chưa được đăng ký');
      }

      // 3. Preflight — poll status cho đến khi tab ready (giống GenTab reconfirm modal)
      const preflight = await this._preflightProviderTab('chatgpt', emitLog);
      const tabId = preflight.tabId;

      if (!preflight.ready && preflight.error !== 'PREFLIGHT_TIMEOUT') {
        if (window.eventBus) {
          window.eventBus.emit('chatgpt:login_required', { error: preflight.error || 'NOT_LOGGED_IN' });
        }
        const err = new Error('ChatGPT chưa sẵn sàng: ' + (preflight.error || 'NOT_LOGGED_IN'));
        err.code = preflight.error || 'NOT_LOGGED_IN';
        node.last_error = err.code;
        throw err;
      }

      // 4. Smart Clone reconstruction
      if (!node.ref_file_ids && node.ref_file_names && Object.keys(node.ref_file_names).length > 0) {
        node.ref_file_ids = Object.keys(node.ref_file_names).join(', ');
        emitLog('Smart Clone: reconstructed ref_file_ids from ref_file_names: ' + node.ref_file_ids);
      } else if (!node.ref_file_ids && node.ref_thumbnails && Object.keys(node.ref_thumbnails).length > 0) {
        node.ref_file_ids = Object.keys(node.ref_thumbnails).join(', ');
        emitLog('Smart Clone: reconstructed ref_file_ids from ref_thumbnails: ' + node.ref_file_ids);
      }

      // 5. Upload pending refs (upload_xxx) qua uploadPendingFiles để có tileId Flow
      if (node.ref_file_ids && node.ref_file_ids.includes('upload_') && typeof window.uploadPendingFiles === 'function') {
        const oldRefIds = node.ref_file_ids;
        emitLog('Upload ảnh ref local lên Flow trước khi submit ChatGPT...', 'info');
        node.ref_file_ids = await window.uploadPendingFiles(node.ref_file_ids);
        if (node.ref_file_ids !== oldRefIds) {
          // Capture file_names + thumbnails MỚI từ MediaRegistry
          const newIdArr = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          if (!node.ref_file_names) node.ref_file_names = {};
          if (!node.ref_thumbnails) node.ref_thumbnails = {};
          for (const newId of newIdArr) {
            if (typeof MediaRegistry !== 'undefined') {
              if (MediaRegistry.getFileName?.(newId)) node.ref_file_names[newId] = MediaRegistry.getFileName(newId);
              if (MediaRegistry.getThumb?.(newId)) node.ref_thumbnails[newId] = MediaRegistry.getThumb(newId);
            }
          }
          // Cleanup keys cũ
          const oldIdArr = (oldRefIds || '').split(',').map(s => s.trim()).filter(Boolean);
          for (const oldId of oldIdArr) {
            if (oldId.startsWith('upload_')) {
              delete node.ref_file_names[oldId];
              if (node.ref_thumbnails) delete node.ref_thumbnails[oldId];
            }
          }
        }
      }

      // 5b. Correct stale tile IDs (5-tier) + reupload nếu missing (sync với generate node logic).
      // Skip khi MỌI ref đã resolve thumbnail được (submit dùng base64 → không cần tile Flow sống)
      // → tránh false-missing → reupload trùng + delay. Ref thiếu thumbnail vẫn chạy correct/reupload.
      if (node.ref_file_ids && !node.ref_file_ids.includes('upload_') && !this._allRefsResolvableFromThumbnail(node)) {
        const originalChatGPTRefIds = node.ref_file_ids;
        const cgThumbMap = { ...(node.ref_thumbnails || {}) };
        const cgFnMap = { ...(node.ref_file_names || {}) };

        // Tier 1-4: correctFileIds
        if (typeof window.correctFileIds === 'function' && (Object.keys(cgThumbMap).length > 0 || Object.keys(cgFnMap).length > 0)) {
          const { correctedIds, changed } = await window.correctFileIds(node.ref_file_ids, cgThumbMap, cgFnMap);
          if (changed) {
            emitLog('ChatGPT: Đã cập nhật ref IDs (tile ID thay đổi sau reload)');
            node.ref_file_ids = correctedIds;
          }
        }

        // Tier 5: reuploadMissingFiles
        if (typeof window.reuploadMissingFiles === 'function') {
          const beforeChatGPTReupload = node.ref_file_ids;
          const refThumbMap2 = { ...(node.ref_thumbnails || {}) };
          const refFileNamesMap2 = { ...(node.ref_file_names || {}) };
          const updated = await window.reuploadMissingFiles(node.ref_file_ids, refThumbMap2, originalChatGPTRefIds, refFileNamesMap2);
          if (updated !== beforeChatGPTReupload) {
            emitLog('ChatGPT: Đã re-upload ảnh tham chiếu bị thiếu trên Flow');
            node.ref_file_ids = updated;

            // Update thumbnails + file_names với new IDs
            const oldArr = (beforeChatGPTReupload || '').split(',').map(s => s.trim()).filter(Boolean);
            const newArr = (updated || '').split(',').map(s => s.trim()).filter(Boolean);
            if (!node.ref_thumbnails) node.ref_thumbnails = {};
            if (!node.ref_file_names) node.ref_file_names = {};
            for (let i = 0; i < oldArr.length && i < newArr.length; i++) {
              if (oldArr[i] !== newArr[i]) {
                // Transfer old data
                if (node.ref_thumbnails[oldArr[i]]) {
                  node.ref_thumbnails[newArr[i]] = node.ref_thumbnails[oldArr[i]];
                  delete node.ref_thumbnails[oldArr[i]];
                }
                if (node.ref_file_names?.[oldArr[i]]) {
                  node.ref_file_names[newArr[i]] = node.ref_file_names[oldArr[i]];
                  delete node.ref_file_names[oldArr[i]];
                }
                // Update với NEW data từ reupload
                const reupDetails = window._lastReuploadTileDetails || {};
                const newThumb = reupDetails[newArr[i]]?.thumbnailUrl || MediaRegistry.getThumb(newArr[i]);
                const newFileName = reupDetails[newArr[i]]?.file_name || MediaRegistry.getFileName(newArr[i]);
                if (newThumb) node.ref_thumbnails[newArr[i]] = newThumb;
                if (newFileName) node.ref_file_names[newArr[i]] = newFileName;
              }
            }

            // Persist updated refs
            try {
              await window.storageManager?.updateNodeStatus(
                this.currentWorkflow?.wf_id || workflow?.wf_id,
                node.node_id,
                { ref_file_ids: node.ref_file_ids, ref_thumbnails: node.ref_thumbnails, ref_file_names: node.ref_file_names }
              );
            } catch (e) {
              console.warn('[ChatGPT] Failed to persist ref update:', e.message);
            }

            // Bug 47 fix: Update SOURCE image nodes nếu refs từ mention mode bị reupload
            if (node._mentionRefSources && Object.keys(node._mentionRefSources).length > 0) {
              const sourceUpdates = {};
              for (let i = 0; i < oldArr.length && i < newArr.length; i++) {
                const oldId = oldArr[i];
                const newId = newArr[i];
                if (oldId === newId) continue;
                const source = node._mentionRefSources[oldId];
                if (!source || source.sourceNodeType !== 'image') continue;
                if (!sourceUpdates[source.sourceSlug]) {
                  sourceUpdates[source.sourceSlug] = { oldIds: [], newIds: [], thumbnails: {}, fileNames: {} };
                }
                sourceUpdates[source.sourceSlug].oldIds.push(oldId);
                sourceUpdates[source.sourceSlug].newIds.push(newId);
                if (node.ref_thumbnails?.[newId]) sourceUpdates[source.sourceSlug].thumbnails[newId] = node.ref_thumbnails[newId];
                if (node.ref_file_names?.[newId]) sourceUpdates[source.sourceSlug].fileNames[newId] = node.ref_file_names[newId];
              }

              for (const [slug, updates] of Object.entries(sourceUpdates)) {
                const sourceNode = workflow.nodes.find(n => n.slug === slug);
                if (!sourceNode || sourceNode.node_type !== 'image') continue;
                emitLog(`[Bug 47] ChatGPT: Updating source image node "${slug}" with reuploaded IDs`);
                let srcIds = (sourceNode.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
                for (let j = 0; j < updates.oldIds.length; j++) {
                  const idx = srcIds.indexOf(updates.oldIds[j]);
                  if (idx !== -1) srcIds[idx] = updates.newIds[j];
                }
                sourceNode.ref_file_ids = srcIds.join(', ');
                if (!sourceNode.ref_thumbnails) sourceNode.ref_thumbnails = {};
                if (!sourceNode.ref_file_names) sourceNode.ref_file_names = {};
                for (const [newId, thumb] of Object.entries(updates.thumbnails)) sourceNode.ref_thumbnails[newId] = thumb;
                for (const [newId, fn] of Object.entries(updates.fileNames)) sourceNode.ref_file_names[newId] = fn;
                for (const oldId of updates.oldIds) {
                  delete sourceNode.ref_thumbnails[oldId];
                  delete sourceNode.ref_file_names[oldId];
                }
                try {
                  await window.storageManager?.updateNodeStatus(
                    this.currentWorkflow?.wf_id || workflow?.wf_id,
                    sourceNode.node_id,
                    { ref_file_ids: sourceNode.ref_file_ids, ref_thumbnails: sourceNode.ref_thumbnails, ref_file_names: sourceNode.ref_file_names }
                  );
                  window.eventBus?.emit('node:ref_replaced', {
                    nodeId: sourceNode.node_id,
                    oldRefIds: updates.oldIds.join(', '),
                    newRefIds: updates.newIds.join(', '),
                    refFileNames: sourceNode.ref_file_names,
                    refThumbnails: sourceNode.ref_thumbnails
                  });
                } catch (e) {
                  console.warn(`[Bug 47] ChatGPT: Failed to persist source node "${slug}":`, e.message);
                }
              }
            }
          }
        }
      }

      // 6. Resolve refs từ tile IDs → fetch base64 (cap maxRefImages = 4)
      const refIdArr = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      // Web ref (server media /app/spaces): ref_file_ids RỖNG nhưng ref_thumbnails có key
      // `template_ref_*` (URL). ChatGPT đọc ref theo id → fallback dùng chính thumbnail keys làm id
      // (thumb resolve qua ref_thumbnails[key] → fetchBlob). Gated prefix → extension KHÔNG ảnh hưởng.
      if (!refIdArr.length && node.ref_thumbnails && typeof node.ref_thumbnails === 'object') {
        const webKeys = Object.keys(node.ref_thumbnails).filter(k => k.startsWith('template_ref_'));
        if (webKeys.length) { refIdArr.push(...webKeys); emitLog(`ChatGPT: dùng ${webKeys.length} ref web (template_ref) từ ref_thumbnails`); }
      }
      console.log(`[_executeChatGPTImageNode] ref_file_ids="${node.ref_file_ids || ''}", ref_thumbnails keys=${Object.keys(node.ref_thumbnails || {}).join(',') || '(none)'}`);
      // Defensive (id ≠ thumbnail key mismatch): xem _executeGrokImageNode — remap thumbnail theo vị
      // trí khi KHÔNG ref id nào có thumbnail nhưng count khớp (ref ngay trên node bị stale ID).
      if (node.ref_thumbnails && typeof node.ref_thumbnails === 'object') {
        const tKeys = Object.keys(node.ref_thumbnails);
        // Bug #1B: CHỈ remap-theo-vị-trí khi KHÔNG id mới nào resolve được từ nguồn TRỰC TIẾP
        // (ref_thumbnails đúng key / _tileCache / MediaRegistry). Nếu user đổi ref, _tileCache có ảnh
        // MỚI → bỏ remap để khỏi gán nhầm thumbnail CŨ theo vị trí. Remap chỉ dành cho stale-ID re-key
        // (cùng ảnh, chỉ lệch key — lúc đó không nguồn nào có id mới nên remap là cứu cánh duy nhất).
        const _hasDirectThumb = (id) =>
          !!node.ref_thumbnails[id]
          || !!getThumbCache()?.get(id)?.thumbnail
          || (typeof MediaRegistry !== 'undefined' && !!MediaRegistry.getThumb?.(id));
        if (refIdArr.length > 0 && tKeys.length === refIdArr.length
            && !refIdArr.some((id) => _hasDirectThumb(id))) {
          const remap = { ...node.ref_thumbnails };
          refIdArr.forEach((id, i) => { remap[id] = node.ref_thumbnails[tKeys[i]]; });
          node.ref_thumbnails = remap;
          emitLog(`ChatGPT: remap ${refIdArr.length} thumbnail theo vị trí (ref ID lệch thumbnail key)`, 'warn');
        }
      }
      const maxRef = adapter.capabilities?.maxRefImages || 4;
      const refIdsCapped = refIdArr.slice(0, maxRef);
      if (refIdArr.length > maxRef) {
        emitLog(`ChatGPT: vượt giới hạn ${maxRef} ảnh ref — chỉ gửi ${maxRef} ảnh đầu`, 'warn');
      }
      const resolvedRefs = [];
      for (const fid of refIdsCapped) {
        // Lấy thumbnail URL (ưu tiên ref_thumbnails của node, fallback caches)
        let thumb = '';
        const refThumb = node.ref_thumbnails?.[fid];
        if (typeof refThumb === 'string') thumb = refThumb;
        else if (refThumb?.thumbnail) thumb = refThumb.thumbnail;
        // Fallback 1: GenTab.thumbnailCache
        if (!thumb && window.GenTab?.thumbnailCache?.[fid]) thumb = window.GenTab.thumbnailCache[fid];
        // Fallback 2: MediaRegistry
        if (!thumb && typeof MediaRegistry !== 'undefined' && MediaRegistry.getThumb?.(fid)) thumb = MediaRegistry.getThumb(fid);
        // Fallback 3: WorkflowEditor._tileCache (pre-populated from server data)
        if (!thumb && getThumbCache()?.get(fid)?.thumbnail) {
          thumb = getThumbCache().get(fid).thumbnail;
        }
        if (!thumb) {
          emitLog(`ChatGPT ref skip: không có thumbnail URL cho ${fid.substring(0, 12)}`, 'warn');
          continue;
        }
        const fileName = node.ref_file_names?.[fid] || (typeof MediaRegistry !== 'undefined' && MediaRegistry.getFileName?.(fid)) || `${fid}.png`;
        try {
          const fetchResp = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'fetchBlob', url: thumb }, (r) => resolve(r));
          });
          if (fetchResp?.success && fetchResp.base64) {
            const m = fetchResp.base64.match(/^data:(.+?);base64,(.+)$/);
            if (m) {
              resolvedRefs.push({ base64: m[2], name: fileName, type: m[1] });
            } else {
              resolvedRefs.push({ base64: fetchResp.base64, name: fileName, type: 'image/png' });
            }
          } else {
            emitLog(`ChatGPT ref fetch fail: ${fid.substring(0, 12)} (${fetchResp?.error || 'unknown'})`, 'warn');
          }
        } catch (err) {
          emitLog(`ChatGPT ref fetch error: ${fid.substring(0, 12)} - ${err.message}`, 'warn');
        }
      }
      emitLog(`ChatGPT refs resolved: ${resolvedRefs.length}/${refIdsCapped.length}`);

      // 7. ExecutionGate request token
      let cgToken = null;
      if (window.ExecutionGate) {
        try {
          const gate = await window.ExecutionGate.request('chatgpt_run', 1, {
            owner: 'workflow',
            label: workflow?.wf_name || 'chatgpt_node'
          });
          if (!gate?.allowed) {
            window.ExecutionGate.showDeniedDialog?.(gate, 'ChatGPT');
            const err = new Error(gate?.reason === 'QUOTA_EXCEEDED' ? 'Đã hết lượt ChatGPT hôm nay' : 'Không được phép chạy ChatGPT');
            err.code = gate?.reason || 'QUOTA_EXCEEDED';
            node.last_error = 'RATE_LIMIT';
            throw err;
          }
          cgToken = gate.token;
        } catch (e) {
          if (window.QuotaErrorHandler?.isQuotaError(e)) {
            node.last_error = e.code === 'FEATURE_LOCKED' ? 'FEATURE_LOCKED' : 'RATE_LIMIT';
            throw e;
          }
          // [Audit Bug 9 fix 2026-06-22] Server-Only: abort thay vì proceed without token.
          console.error('[WorkflowExecutor] ChatGPT ExecutionGate failed, ABORTING node (Server-Only):', e.message);
          node.last_error = 'GATE_REQUEST_FAILED';
          throw new Error(`Không thể xin phép server chạy ChatGPT node: ${e.message || 'unknown'}`);
        }
      }

      try {
        // 8. Submit qua adapter
        emitLog(`ChatGPT submit: ratio=${node.ratio || 'story'}, mode=${node.use_fallback_prefix || 'auto'}, refs=${resolvedRefs.length}`);

        // Tracker update để show UI running khi ChatGPT gen (mirror prompt_enhancing pattern)
        if (window.eventBus) {
          window.eventBus.emit('execution:tracker_update', {
            owner: 'workflow',
            phase: 'chatgpt_generating',
            promptText: 'ChatGPT generating...',
            genMode: 'image',
          });
        }
        // Đồng bộ với GenTab + Task pattern: truyền explicit fallbackPrefix từ user settings.
        // ChatGPTAdapter Option B ưu tiên giá trị này; nếu undefined → tự đọc storage qua _getFallbackPrefix().
        const _wfSettings = window.storageSettings?.getSettings?.() || {};
        emitNodePhase(node.node_id, 'generating');
        const result = await adapter.submit({
          prompt: node.prompt || '',
          refFileIds: resolvedRefs,
          settings: {
            ratio: node.ratio || 'story',
            model: node.model || null, // Instant | Thinking (GPT-5.5 variant) — content script chọn qua switcher
            // Phase L: Centralized timeout — node override or SystemConfig fallback.
            // Bug fix 2026-05-27: fallback 120s → 300s (khớp backend chatgpt_timeout_ms=300000).
            // Gen nhiều ref + prompt dài rất chậm (2-5 phút) → 120s timeout-oan dù gen thành công.
            timeout: node.timeout_ms || window.SystemConfig?.getTimeout('chatgpt_timeout_ms') || 300000,
            useFallbackPrefix: node.use_fallback_prefix || 'auto',
            fallbackPrefix: _wfSettings.chatgptFallbackPrefix || 'Generate an image of: ',
          },
          taskName: workflow?.wf_name || null,
        });
        if (result?.success) emitNodePhase(node.node_id, 'downloading');

        if (!result || !result.success) {
          // Map error code
          const errCode = result?.error || 'IMAGE_GEN_FAILED';
          node.last_error = errCode;
          // Persist last_error vào storage
          try {
            await window.storageManager?.updateNodeStatus(
              this.currentWorkflow?.wf_id || workflow?.wf_id,
              node.node_id,
              { last_error: errCode }
            );
          } catch (e) { /* ignore */ }

          // Notification gen-fail dời sang _notifyGenFailed (gọi ở onFail SAU hết retry) — tránh
          // báo per-attempt (spam + gây hiểu lầm khi retry sau đó thành công). Chỉ giữ persist + log.

          // ExecutionGate complete và clear token ngay — catch block sẽ skip nếu cgToken=null
          if (cgToken && window.ExecutionGate) {
            await window.ExecutionGate.complete(cgToken, 'failed').catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#_hasDirectThumb', _e); });
            cgToken = null; // Prevent double-complete in catch block
          }
          // CONTENT_BLOCKED: retry 1 lần (false positive), sau đó fail
          // Track retry count trên node để giới hạn
          if (errCode === 'CONTENT_BLOCKED') {
            node._contentBlockedRetries = (node._contentBlockedRetries || 0) + 1;
            if (node._contentBlockedRetries > 1) {
              const err = new Error('ChatGPT: Prompt bị từ chối (vi phạm content policy)');
              err.code = 'CONTENT_BLOCKED';
              err.noRetry = true;
              throw err;
            }
            emitLog('ChatGPT content policy warning — thử lại 1 lần...', 'warn');
          }
          // Bug 60 fix (2026-05-13): TIMEOUT với hasPendingImage=true → noRetry.
          // ChatGPT đang gen ảnh ở backend (UI có image marker) — retry sẽ submit prompt LẦN 2 →
          // user thấy 2-3 ảnh gen liên tiếp. Mark noRetry để workflow fail gracefully thay vì spam.
          //
          // SUBSCRIPTION_REQUIRED / LIMIT_ALERT / FEATURE_LOCKED cũng không retry vì retry không giúp.
          const err = new Error('ChatGPT submit thất bại: ' + (result?.message || errCode));
          err.code = errCode;
          if (errCode === 'TIMEOUT' && result?.hasPendingImage) {
            err.noRetry = true;
            emitLog('ChatGPT TIMEOUT nhưng image đang gen ở backend — bỏ qua retry để tránh resubmit', 'warn');
          } else if (['SUBSCRIPTION_REQUIRED', 'LIMIT_ALERT', 'FEATURE_LOCKED', 'CHALLENGE_TIMEOUT'].includes(errCode)) {
            err.noRetry = true;
          }
          throw err;
        }

        // 9. Persist last_mode_used
        node.last_mode_used = result.imageModeUsed ? 'image_mode' : 'fallback_prefix';
        node.last_error = null;
        emitLog(`ChatGPT mode used: ${node.last_mode_used}`);

        const imageUrls = result.imageUrls || [];
        if (imageUrls.length === 0) {
          throw new Error('ChatGPT không trả về URL ảnh nào');
        }
        emitLog(`ChatGPT trả về ${imageUrls.length} ảnh — bridge sang Flow...`);

        // 10. Cross-provider bridge: mỗi imageUrl → upload sang Flow → tileId.
        // Bug 2 fix (audit 2026-05): apply Grok pattern với 3 fallback paths + 30s timeout.
        // Trước fix: bridge fail → break loop → uploadedTiles=[] → result_file_ids="" → result_provider_urls={}
        // → user mất hoàn toàn kết quả + quota đã consume. Giờ mỗi fail push synthetic
        // tile_id `chatgpt_xxx` + giữ provider URL gốc → Download node vẫn tải được qua
        // result_provider_urls. Synthetic ID không tìm trên Flow DOM —
        // _correctUpstreamNodeIds tier 1-4 sẽ "không match" (giữ nguyên) rồi tier 5b
        // _recoverProviderTiles reupload từ provider URL gốc thành fe_id_xxx Flow thật.
        const uploadedTiles = [];
        const cgTabId = result.tabId || tabId;
        const BRIDGE_TIMEOUT_MS = 60000; // 60s/url — tăng từ 30s để tránh timeout sớm + re-upload

        const bridgeWithTimeout = (url, tabId, fileName) => {
          return Promise.race([
            window.MessageBridge.chatGPTBridgeToFlow(url, tabId, fileName),
            new Promise((resolve) => setTimeout(() => resolve({ _timeout: true }), BRIDGE_TIMEOUT_MS)),
          ]);
        };

        emitLog(`[ChatGPT Bridge] Starting bridge for ${imageUrls.length} image(s), timeout: ${BRIDGE_TIMEOUT_MS}ms`);
        // Tên file upload chuẩn hoá: {provider}-{node_id}-{runStamp}-{index} (đồng nhất grok).
        // runStamp unique/run + node_id → truy được node + re-run không trùng → tile-match đúng.
        const _uploadRunStamp = Date.now();
        for (let i = 0; i < imageUrls.length; i++) {
          const url = imageUrls[i];
          const fileName = `chatgpt-${node.node_id}-${_uploadRunStamp}-${i + 1}.png`;
          const bridgeStartTime = Date.now();
          try {
            if (!window.MessageBridge?.chatGPTBridgeToFlow) {
              emitLog('MessageBridge.chatGPTBridgeToFlow không tồn tại — fallback synthetic tile', 'warn');
              uploadedTiles.push({
                tileId: `chatgpt_${Date.now()}_${i}`,
                thumbnail: url,
                file_name: fileName,
              });
              continue;
            }
            emitLog(`[ChatGPT Bridge] ${i + 1}/${imageUrls.length}: Starting upload...`);
            const bridgeResp = await bridgeWithTimeout(url, cgTabId, fileName);
            const bridgeDuration = Date.now() - bridgeStartTime;
            emitLog(`[ChatGPT Bridge] ${i + 1}/${imageUrls.length}: Completed in ${bridgeDuration}ms`);
            // bridgeResp có thể có dạng { success, tileDetails } hoặc array tileDetails trực tiếp
            const tileDetails = Array.isArray(bridgeResp) ? bridgeResp : (bridgeResp?.tileDetails || []);
            const isTimeout = bridgeResp?._timeout === true;
            if (tileDetails && tileDetails.length > 0) {
              const td = tileDetails[0];
              const tileId = td.id || td.tile_id || td.tileId;
              if (tileId) {
                const thumbUrl = td.thumbnailUrl || td.thumbnail_url || url;
                // BUG FIX: Extract file_name từ thumbnailUrl nếu td.file_name rỗng
                // Tránh reupload sau reload page do file_names mapping sai
                const flowFileName = td.file_name || extractFileNameFromUrl(thumbUrl);
                uploadedTiles.push({
                  tileId,
                  thumbnail: thumbUrl,
                  file_name: flowFileName,
                });
                emitLog(`Bridge ${i + 1}/${imageUrls.length}: tileId=${tileId.substring(0, 16)}` +
                        (flowFileName ? `, file_name=${flowFileName.substring(0, 16)}` : ''));
              } else {
                emitLog(`Bridge ${i + 1}/${imageUrls.length}: tileDetails không có tileId — fallback synthetic`, 'warn');
                uploadedTiles.push({
                  tileId: `chatgpt_${Date.now()}_${i}`,
                  thumbnail: url,
                  file_name: fileName,
                });
              }
            } else {
              const reason = isTimeout ? 'TIMEOUT' : 'tileDetails rỗng';
              emitLog(`Bridge ${i + 1}/${imageUrls.length}: ${reason} — fallback synthetic`, 'warn');
              uploadedTiles.push({
                tileId: `chatgpt_${Date.now()}_${i}`,
                thumbnail: url,
                file_name: fileName,
              });
            }
          } catch (bErr) {
            emitLog(`Bridge ${i + 1} exception: ${bErr.message} → fallback synthetic`, 'warn');
            uploadedTiles.push({
              tileId: `chatgpt_${Date.now()}_${i}_err`,
              thumbnail: url,
              file_name: fileName,
            });
          }
        }

        // Note: với fix Bug 2, uploadedTiles luôn === imageUrls.length (mọi fail đều push
        // synthetic). Block dưới giữ làm safety net cho future regression.
        if (uploadedTiles.length === 0) {
          emitLog('Cảnh báo: ChatGPT có ảnh nhưng không bridge được sang Flow', 'warn');
        }

        // 11. Persist result trên node (format object {tileId: {thumbnail, type, file_name}})
        node.result_file_ids = uploadedTiles.map(t => t.tileId).join(', ');
        node.result_thumbnails = uploadedTiles.reduce((acc, t) => {
          acc[t.tileId] = {
            thumbnail: t.thumbnail,
            type: 'image',
            file_name: t.file_name || '',
          };
          return acc;
        }, {});
        node.result_file_names = uploadedTiles.reduce((acc, t) => {
          if (t.file_name) acc[t.tileId] = t.file_name;
          return acc;
        }, {});

        // Phase: Dual URL — lưu URL provider gốc song song với Flow tileId.
        // Manual download sẽ ưu tiên URL gốc (chất lượng 100% provider) thay vì Flow (re-encoded).
        // Note: URL gốc có signature TTL ~vài giờ → fetch sớm trước khi expire.
        node.result_provider_urls = uploadedTiles.reduce((acc, t, idx) => {
          const url = imageUrls?.[idx];
          if (t.tileId && url) {
            acc[t.tileId] = {
              url,
              provider: 'chatgpt',
              media_type: 'image',
              tab_id: cgTabId,
              captured_at: Date.now(),
            };
          }
          return acc;
        }, {});

        // DEBUG: Log result_provider_urls để verify đã set đúng
        emitLog(`[ChatGPT] result_provider_urls keys: ${Object.keys(node.result_provider_urls || {}).join(', ') || '(empty)'}`);

        // Cập nhật MediaRegistry để các node downstream + UI tham chiếu đúng
        if (typeof MediaRegistry !== 'undefined') {
          for (const t of uploadedTiles) {
            if (t.thumbnail) MediaRegistry.setThumb?.(t.tileId, t.thumbnail);
            if (t.file_name) MediaRegistry.setFileName?.(t.tileId, t.file_name);
          }
        }

        // 12. Auto-download (fire-and-forget background — không block emit node:completed).
        // Bug fix 2026-05-26: GỠ điều kiện !isPipelineActive. ChatGPT node LUÔN execute trực tiếp
        // (không qua PromptQueue) + ảnh ChatGPT là CDN, KHÔNG phải Flow tile → pipeline KHÔNG bao
        // giờ download chúng. Trước fix: bật pipeline → auto_download mất âm thầm (outer cũng skip
        // external provider). Internal download là path DUY NHẤT cho ChatGPT.
        const canUseAutoDownload = window.featureGate?.canUse('auto_download') ?? false;
        const nodeAutoDownload = canUseAutoDownload &&
          (node.auto_download === true || node.auto_download === '1' || node.auto_download === 1);
        if (nodeAutoDownload && imageUrls.length > 0 && cgTabId) {
          emitLog(`Auto-download ${imageUrls.length} ảnh ChatGPT (background)...`);
          // Fire-and-forget: download xảy ra song song, executor return ngay sau bridge.
          (async () => {
            try {
              const _wfCgDl = await window.DownloadHelper.getSettings();
              const _wfCgDownloadFolder = _wfCgDl.folder;
              const _wfCgDownloadTemplate = _wfCgDl.template;

              for (let urlIdx = 0; urlIdx < imageUrls.length; urlIdx++) {
                const url = imageUrls[urlIdx];
                try {
                  const fetchResp = await window.MessageBridge?.chatGPTFetchImage?.(url, cgTabId);
                  if (fetchResp?.success && fetchResp.base64) {
                    const blob = await (await fetch(fetchResp.base64)).blob();
                    const blobUrl = URL.createObjectURL(blob);

                    const filename = window.GenTab?._buildChatGPTFilename?.(
                      _wfCgDownloadTemplate,
                      window._currentProjectName || 'flow',
                      node.prompt || '',
                      1, urlIdx + 1, '',
                      workflow?.wf_name || null,
                      _wfCgDownloadFolder
                    ) || `${_wfCgDownloadFolder}/${_wfFolderName(workflow?.wf_name)}/chatgpt-${Date.now()}-${urlIdx + 1}.png`;

                    const dlUrl = await this._scrubForDownload(blobUrl, log);
                    const dlResp = await new Promise((resolve) => {
                      chrome.runtime.sendMessage(
                        { action: 'chromeDownload', url: dlUrl, filename },
                        (r) => resolve(r)
                      );
                    });
                    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
                    if (!dlResp?.success) emitLog(`ChatGPT download fail: ${dlResp?.error || 'unknown'}`, 'warn');
                  } else {
                    emitLog(`ChatGPT fetchImage fail: ${fetchResp?.error || 'unknown'}`, 'warn');
                  }
                } catch (dlErr) {
                  emitLog(`ChatGPT auto-download lỗi: ${dlErr.message}`, 'warn');
                }
              }
              emitLog(`Auto-download ChatGPT hoàn tất`, 'success');
            } catch (e) {
              emitLog(`Auto-download ChatGPT bg error: ${e.message}`, 'error');
            }
          })().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#bridgeWithTimeout', _e); });
        }

        // 13. ExecutionGate complete success
        if (cgToken && window.ExecutionGate) {
          await window.ExecutionGate.complete(cgToken, 'success').catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#bridgeWithTimeout', _e); });
        }

        // Bug fix: KHÔNG emit node:completed ở đây. Outer caller emit sau finally restore.
        const fileIds = uploadedTiles.map(t => t.tileId);

        const duration = Date.now() - startTime;
        emitLog(`ChatGPT Image node hoàn tất: ${fileIds.length} ảnh trong ${duration}ms`, 'success');

        return {
          fileIds,
          duration,
          thumbnails: node.result_thumbnails,
          fileNames: node.result_file_names,
          // Refs THỰC dùng cho GenerationHistory ref_img — node.ref_file_ids bị restore về rỗng
          // (port-merge từ upstream) nên emit phải dùng giá trị này (giống generate/grok node).
          refFileIdsUsed: Array.isArray(refIdsCapped) ? refIdsCapped : [],
        };

      } catch (err) {
        // ExecutionGate complete failed (rollback quota)
        if (cgToken && window.ExecutionGate) {
          await window.ExecutionGate.complete(cgToken, 'failed').catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#bridgeWithTimeout', _e); });
        }
        // Set last_error nếu chưa có
        if (!node.last_error) {
          node.last_error = err?.code || 'IMAGE_GEN_FAILED';
        }
        // Persist last_error
        try {
          await window.storageManager?.updateNodeStatus(
            this.currentWorkflow?.wf_id || workflow?.wf_id,
            node.node_id,
            { last_error: node.last_error, last_mode_used: node.last_mode_used }
          );
        } catch (e) { /* ignore */ }
        throw err;
      }
    }

    /**
     * Phase G-6: Execute Grok Image node — sinh ảnh/video qua Grok provider rồi bridge sang Flow.
     * Mirror _executeChatGPTImageNode pattern.
     *
     * Flow:
     *   1. Feature gate check (grok_enabled).
     *   2. Get adapter qua ProviderRegistry.
     *   3. ensureReady → emit grok:login_required nếu fail.
     *   4. Smart Clone reconstruction + upload pending refs + resolve refs sang base64.
     *   5. ExecutionGate request token (grok_run quota).
     *   6. adapter.submit({...}) → nhận mediaUrls + tabId.
     *   7. Cross-provider bridge: mỗi mediaUrl → MessageBridge.grokBridgeToFlow → tileId trên Flow.
     *   8. Persist result_file_ids/thumbnails/file_names theo format object {tileId: {thumbnail, type, file_name}}.
     *   9. Auto-download nếu node.auto_download (skip nếu PromptQueue.isEnabled() — pipeline Flow-only).
     *   10. ExecutionGate.complete + emit node:completed.
     */
    async _executeGrokImageNode(node, workflow, emitLog, nodeAccum = null) {
      const startTime = Date.now();

      // 1. Feature gate
      if (!window.featureGate || !window.featureGate.canUse('grok_enabled')) {
        const err = new Error('Tính năng Grok chưa được kích hoạt cho gói hiện tại');
        err.code = 'FEATURE_LOCKED';
        node.last_error = 'FEATURE_LOCKED';
        throw err;
      }

      // 2. Lấy adapter
      if (!window.ProviderRegistry) {
        throw new Error('ProviderRegistry chưa sẵn sàng');
      }
      const adapter = window.ProviderRegistry.get('grok');
      if (!adapter) {
        throw new Error('Grok adapter chưa được đăng ký');
      }

      // 3. Preflight — poll status cho đến khi tab ready (giống GenTab reconfirm modal)
      const preflight = await this._preflightProviderTab('grok', emitLog);
      const tabId = preflight.tabId;

      if (!preflight.ready && preflight.error !== 'PREFLIGHT_TIMEOUT') {
        if (window.eventBus) {
          window.eventBus.emit('grok:login_required', { error: preflight.error || 'NOT_LOGGED_IN' });
        }
        const err = new Error('Grok chưa sẵn sàng: ' + (preflight.error || 'NOT_LOGGED_IN'));
        err.code = preflight.error || 'NOT_LOGGED_IN';
        node.last_error = err.code;
        throw err;
      }

      // 4. Smart Clone: reconstruct ref_file_ids từ ref_file_names (cross-project clone)
      if (!node.ref_file_ids && node.ref_file_names && Object.keys(node.ref_file_names).length > 0) {
        node.ref_file_ids = Object.keys(node.ref_file_names).join(', ');
        emitLog('Smart Clone: reconstructed ref_file_ids from ref_file_names: ' + node.ref_file_ids);
      } else if (!node.ref_file_ids && node.ref_thumbnails && Object.keys(node.ref_thumbnails).length > 0) {
        node.ref_file_ids = Object.keys(node.ref_thumbnails).join(', ');
        emitLog('Smart Clone: reconstructed ref_file_ids from ref_thumbnails: ' + node.ref_file_ids);
      }

      // 5. Upload pending refs (upload_xxx → real fileIds)
      if (node.ref_file_ids && node.ref_file_ids.includes('upload_') && typeof window.uploadPendingFiles === 'function') {
        const oldRefIds = node.ref_file_ids;
        emitLog('Upload ảnh ref local lên Flow trước khi submit Grok...', 'info');
        node.ref_file_ids = await window.uploadPendingFiles(node.ref_file_ids);
        if (node.ref_file_ids !== oldRefIds) {
          const newIdArr = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
          if (!node.ref_file_names) node.ref_file_names = {};
          if (!node.ref_thumbnails) node.ref_thumbnails = {};
          for (const newId of newIdArr) {
            if (typeof MediaRegistry !== 'undefined') {
              if (MediaRegistry.getFileName?.(newId)) node.ref_file_names[newId] = MediaRegistry.getFileName(newId);
              if (MediaRegistry.getThumb?.(newId)) node.ref_thumbnails[newId] = MediaRegistry.getThumb(newId);
            }
          }
          // Cleanup keys cũ
          const oldIdArr = (oldRefIds || '').split(',').map(s => s.trim()).filter(Boolean);
          for (const oldId of oldIdArr) {
            if (oldId.startsWith('upload_')) {
              delete node.ref_file_names[oldId];
              if (node.ref_thumbnails) delete node.ref_thumbnails[oldId];
            }
          }
        }
      }

      // 5b. Correct stale tile IDs (5-tier) + reupload nếu missing (sync với generate node logic).
      // Skip khi MỌI ref đã resolve thumbnail được (submit dùng base64 → không cần tile Flow sống)
      // → tránh false-missing → reupload trùng + delay. Ref thiếu thumbnail vẫn chạy correct/reupload.
      if (node.ref_file_ids && !node.ref_file_ids.includes('upload_') && !this._allRefsResolvableFromThumbnail(node)) {
        const originalGrokRefIds = node.ref_file_ids;
        const gkThumbMap = { ...(node.ref_thumbnails || {}) };
        const gkFnMap = { ...(node.ref_file_names || {}) };

        // Tier 1-4: correctFileIds
        if (typeof window.correctFileIds === 'function' && (Object.keys(gkThumbMap).length > 0 || Object.keys(gkFnMap).length > 0)) {
          const { correctedIds, changed } = await window.correctFileIds(node.ref_file_ids, gkThumbMap, gkFnMap);
          if (changed) {
            emitLog('Grok: Đã cập nhật ref IDs (tile ID thay đổi sau reload)');
            node.ref_file_ids = correctedIds;
          }
        }

        // Tier 5: reuploadMissingFiles
        if (typeof window.reuploadMissingFiles === 'function') {
          const beforeGrokReupload = node.ref_file_ids;
          const refThumbMap2 = { ...(node.ref_thumbnails || {}) };
          const refFileNamesMap2 = { ...(node.ref_file_names || {}) };
          const updated = await window.reuploadMissingFiles(node.ref_file_ids, refThumbMap2, originalGrokRefIds, refFileNamesMap2);
          if (updated !== beforeGrokReupload) {
            emitLog('Grok: Đã re-upload ảnh tham chiếu bị thiếu trên Flow');
            node.ref_file_ids = updated;

            // Update thumbnails + file_names với new IDs
            const oldArr = (beforeGrokReupload || '').split(',').map(s => s.trim()).filter(Boolean);
            const newArr = (updated || '').split(',').map(s => s.trim()).filter(Boolean);
            if (!node.ref_thumbnails) node.ref_thumbnails = {};
            if (!node.ref_file_names) node.ref_file_names = {};
            for (let i = 0; i < oldArr.length && i < newArr.length; i++) {
              if (oldArr[i] !== newArr[i]) {
                // Transfer old data
                if (node.ref_thumbnails[oldArr[i]]) {
                  node.ref_thumbnails[newArr[i]] = node.ref_thumbnails[oldArr[i]];
                  delete node.ref_thumbnails[oldArr[i]];
                }
                if (node.ref_file_names?.[oldArr[i]]) {
                  node.ref_file_names[newArr[i]] = node.ref_file_names[oldArr[i]];
                  delete node.ref_file_names[oldArr[i]];
                }
                // Update với NEW data từ reupload
                const reupDetails = window._lastReuploadTileDetails || {};
                const newThumb = reupDetails[newArr[i]]?.thumbnailUrl || MediaRegistry.getThumb(newArr[i]);
                const newFileName = reupDetails[newArr[i]]?.file_name || MediaRegistry.getFileName(newArr[i]);
                if (newThumb) node.ref_thumbnails[newArr[i]] = newThumb;
                if (newFileName) node.ref_file_names[newArr[i]] = newFileName;
              }
            }

            // Persist updated refs
            try {
              await window.storageManager?.updateNodeStatus(
                this.currentWorkflow?.wf_id || workflow?.wf_id,
                node.node_id,
                { ref_file_ids: node.ref_file_ids, ref_thumbnails: node.ref_thumbnails, ref_file_names: node.ref_file_names }
              );
            } catch (e) {
              console.warn('[Grok] Failed to persist ref update:', e.message);
            }

            // Bug 47 fix: Update SOURCE image nodes nếu refs từ mention mode bị reupload
            if (node._mentionRefSources && Object.keys(node._mentionRefSources).length > 0) {
              const sourceUpdates = {};
              for (let i = 0; i < oldArr.length && i < newArr.length; i++) {
                const oldId = oldArr[i];
                const newId = newArr[i];
                if (oldId === newId) continue;
                const source = node._mentionRefSources[oldId];
                if (!source || source.sourceNodeType !== 'image') continue;
                if (!sourceUpdates[source.sourceSlug]) {
                  sourceUpdates[source.sourceSlug] = { oldIds: [], newIds: [], thumbnails: {}, fileNames: {} };
                }
                sourceUpdates[source.sourceSlug].oldIds.push(oldId);
                sourceUpdates[source.sourceSlug].newIds.push(newId);
                if (node.ref_thumbnails?.[newId]) sourceUpdates[source.sourceSlug].thumbnails[newId] = node.ref_thumbnails[newId];
                if (node.ref_file_names?.[newId]) sourceUpdates[source.sourceSlug].fileNames[newId] = node.ref_file_names[newId];
              }

              for (const [slug, updates] of Object.entries(sourceUpdates)) {
                const sourceNode = workflow.nodes.find(n => n.slug === slug);
                if (!sourceNode || sourceNode.node_type !== 'image') continue;
                emitLog(`[Bug 47] Grok: Updating source image node "${slug}" with reuploaded IDs`);
                let srcIds = (sourceNode.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
                for (let j = 0; j < updates.oldIds.length; j++) {
                  const idx = srcIds.indexOf(updates.oldIds[j]);
                  if (idx !== -1) srcIds[idx] = updates.newIds[j];
                }
                sourceNode.ref_file_ids = srcIds.join(', ');
                if (!sourceNode.ref_thumbnails) sourceNode.ref_thumbnails = {};
                if (!sourceNode.ref_file_names) sourceNode.ref_file_names = {};
                for (const [newId, thumb] of Object.entries(updates.thumbnails)) sourceNode.ref_thumbnails[newId] = thumb;
                for (const [newId, fn] of Object.entries(updates.fileNames)) sourceNode.ref_file_names[newId] = fn;
                for (const oldId of updates.oldIds) {
                  delete sourceNode.ref_thumbnails[oldId];
                  delete sourceNode.ref_file_names[oldId];
                }
                try {
                  await window.storageManager?.updateNodeStatus(
                    this.currentWorkflow?.wf_id || workflow?.wf_id,
                    sourceNode.node_id,
                    { ref_file_ids: sourceNode.ref_file_ids, ref_thumbnails: sourceNode.ref_thumbnails, ref_file_names: sourceNode.ref_file_names }
                  );
                  window.eventBus?.emit('node:ref_replaced', {
                    nodeId: sourceNode.node_id,
                    oldRefIds: updates.oldIds.join(', '),
                    newRefIds: updates.newIds.join(', '),
                    refFileNames: sourceNode.ref_file_names,
                    refThumbnails: sourceNode.ref_thumbnails
                  });
                } catch (e) {
                  console.warn(`[Bug 47] Grok: Failed to persist source node "${slug}":`, e.message);
                }
              }
            }
          }
        }
      }

      // 6. Resolve refs base64 (cap maxRefImages=4)
      const refIdArr = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      // Web ref (server media /app/spaces): ref_file_ids RỖNG nhưng ref_thumbnails có key
      // `template_ref_*` (URL). Grok đọc ref theo id → fallback dùng chính thumbnail keys làm id
      // (thumb resolve qua ref_thumbnails[key] → fetchBlob). Gated prefix → extension (ref_file_ids
      // luôn có) KHÔNG bị ảnh hưởng.
      if (!refIdArr.length && node.ref_thumbnails && typeof node.ref_thumbnails === 'object') {
        const webKeys = Object.keys(node.ref_thumbnails).filter(k => k.startsWith('template_ref_'));
        if (webKeys.length) { refIdArr.push(...webKeys); emitLog(`Grok: dùng ${webKeys.length} ref web (template_ref) từ ref_thumbnails`); }
      }
      // Defensive (id ≠ thumbnail key mismatch): nếu KHÔNG ref id nào có thumbnail nhưng node CÓ
      // thumbnail keys + count khớp → remap theo vị trí (ref ngay trên grok node bị stale ID).
      if (node.ref_thumbnails && typeof node.ref_thumbnails === 'object') {
        const tKeys = Object.keys(node.ref_thumbnails);
        // Bug #1B (Grok): CHỈ remap-theo-vị-trí khi KHÔNG id mới nào resolve được từ nguồn TRỰC TIẾP
        // (ref_thumbnails đúng key / _tileCache / MediaRegistry). User đổi ref → nguồn fresh có ảnh MỚI
        // → bỏ remap để khỏi gán nhầm thumbnail CŨ. Remap chỉ dành cho stale-ID re-key (cùng ảnh).
        const _hasDirectThumb = (id) =>
          !!node.ref_thumbnails[id]
          || !!getThumbCache()?.get(id)?.thumbnail
          || (typeof MediaRegistry !== 'undefined' && !!MediaRegistry.getThumb?.(id));
        if (refIdArr.length > 0 && tKeys.length === refIdArr.length
            && !refIdArr.some((id) => _hasDirectThumb(id))) {
          const remap = { ...node.ref_thumbnails };
          refIdArr.forEach((id, i) => { remap[id] = node.ref_thumbnails[tKeys[i]]; });
          node.ref_thumbnails = remap;
          emitLog(`Grok: remap ${refIdArr.length} thumbnail theo vị trí (ref ID lệch thumbnail key)`, 'warn');
        }
      }
      const maxRef = adapter.capabilities?.maxRefImages || 4;
      const refIdsCapped = refIdArr.slice(0, maxRef);
      if (refIdArr.length > maxRef) {
        emitLog(`Grok: vượt giới hạn ${maxRef} ảnh ref — chỉ gửi ${maxRef} ảnh đầu`, 'warn');
      }

      const resolvedRefs = [];
      for (const fid of refIdsCapped) {
        let thumb = '';
        const refThumb = node.ref_thumbnails?.[fid];
        if (typeof refThumb === 'string') thumb = refThumb;
        else if (refThumb?.thumbnail) thumb = refThumb.thumbnail;
        if (!thumb && window.GenTab?.thumbnailCache?.[fid]) thumb = window.GenTab.thumbnailCache[fid];
        if (!thumb && typeof MediaRegistry !== 'undefined' && MediaRegistry.getThumb?.(fid)) thumb = MediaRegistry.getThumb(fid);
        // Fallback _tileCache (đồng bộ ChatGPT) — ảnh user vừa pick nằm ở đây; cần để khớp _hasDirectThumb.
        if (!thumb && getThumbCache()?.get(fid)?.thumbnail) {
          thumb = getThumbCache().get(fid).thumbnail;
        }
        if (!thumb) {
          emitLog(`Grok ref skip: không có thumbnail URL cho ${fid.substring(0, 12)}`, 'warn');
          continue;
        }
        const fileName = node.ref_file_names?.[fid] || (typeof MediaRegistry !== 'undefined' && MediaRegistry.getFileName?.(fid)) || `${fid}.png`;
        try {
          const fetchResp = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'fetchBlob', url: thumb }, (r) => resolve(r));
          });
          if (fetchResp?.success && fetchResp.base64) {
            const m = fetchResp.base64.match(/^data:(.+?);base64,(.+)$/);
            if (m) {
              resolvedRefs.push({ base64: m[2], name: fileName, type: m[1] });
            } else {
              resolvedRefs.push({ base64: fetchResp.base64, name: fileName, type: 'image/png' });
            }
          } else {
            emitLog(`Grok ref fetch fail: ${fid.substring(0, 12)} (${fetchResp?.error || 'unknown'})`, 'warn');
          }
        } catch (err) {
          emitLog(`Grok ref fetch error: ${fid.substring(0, 12)} - ${err.message}`, 'warn');
        }
      }
      emitLog(`Grok refs resolved: ${resolvedRefs.length}/${refIdsCapped.length}`);

      // 7. ExecutionGate request token (action: grok_run)
      let grokToken = null;
      if (window.ExecutionGate) {
        try {
          const gate = await window.ExecutionGate.request('grok_run', 1, {
            owner: 'workflow',
            label: workflow?.wf_name || 'grok_node'
          });
          if (!gate?.allowed) {
            window.ExecutionGate.showDeniedDialog?.(gate, 'Grok');
            const err = new Error(gate?.reason === 'QUOTA_EXCEEDED' ? 'Đã hết lượt Grok hôm nay' : 'Không được phép chạy Grok');
            err.code = gate?.reason || 'QUOTA_EXCEEDED';
            node.last_error = 'RATE_LIMIT';
            throw err;
          }
          grokToken = gate.token;
        } catch (e) {
          if (window.QuotaErrorHandler?.isQuotaError(e)) {
            node.last_error = e.code === 'FEATURE_LOCKED' ? 'FEATURE_LOCKED' : 'RATE_LIMIT';
            throw e;
          }
          // [Audit Bug 9 fix 2026-06-22] Server-Only: abort thay vì proceed without token.
          console.error('[WorkflowExecutor] Grok ExecutionGate failed, ABORTING node (Server-Only):', e.message);
          node.last_error = 'GATE_REQUEST_FAILED';
          throw new Error(`Không thể xin phép server chạy Grok node: ${e.message || 'unknown'}`);
        }
      }

      try {
        // 8. Submit qua adapter
        const grokMode = node.grok_mode || 'image';
        const grokRatio = node.ratio || 'widescreen';
        const grokDuration = node.grok_duration || '6s';
        const grokResolution = node.grok_resolution || '720p';
        // Image quality (Grok update 2026-04): 'speed' | 'quality'
        const grokImageQuality = node.grok_image_quality || 'speed';
        // Phase L: Centralized timeout — video needs longer timeout than image
        const defaultTimeout = grokMode === 'video'
          ? (window.SystemConfig?.getTimeout('video_timeout_ms') || 600000)
          : (window.SystemConfig?.getTimeout('image_timeout_ms') || 300000);
        const grokTimeout = node.timeout_ms || defaultTimeout;
        emitLog(`Grok submit: mode=${grokMode}, ratio=${grokRatio}, refs=${resolvedRefs.length}`);

        // Tracker update để show UI running khi Grok gen (mirror prompt_enhancing pattern)
        if (window.eventBus) {
          window.eventBus.emit('execution:tracker_update', {
            owner: 'workflow',
            phase: 'grok_generating',
            promptText: `Grok generating ${grokMode}...`,
            genMode: grokMode,
          });
        }

        emitNodePhase(node.node_id, 'generating');
        const result = await adapter.submit({
          prompt: node.prompt || '',
          refFileIds: resolvedRefs,
          settings: {
            mode: grokMode,
            ratio: grokRatio,
            duration: grokDuration,
            resolution: grokResolution,
            imageQuality: grokImageQuality,
            timeout: grokTimeout,
          },
          taskName: workflow?.wf_name || null,
        });
        if (result?.success) emitNodePhase(node.node_id, 'downloading');

        if (!result || !result.success) {
          const errCode = result?.error || 'IMAGE_GEN_FAILED';
          node.last_error = errCode;
          try {
            await window.storageManager?.updateNodeStatus(
              this.currentWorkflow?.wf_id || workflow?.wf_id,
              node.node_id,
              { last_error: errCode }
            );
          } catch (e) { /* ignore */ }

          // Notification gen-fail dời sang _notifyGenFailed (gọi ở onFail SAU hết retry) — tránh
          // báo per-attempt (spam + gây hiểu lầm khi retry sau đó thành công). Chỉ giữ persist + log.

          // ExecutionGate complete và clear token ngay — catch block sẽ skip nếu grokToken=null
          if (grokToken && window.ExecutionGate) {
            await window.ExecutionGate.complete(grokToken, 'failed').catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#_hasDirectThumb', _e); });
            grokToken = null; // Prevent double-complete in catch block
          }
          // SUBSCRIPTION_REQUIRED: emit event
          if (errCode === 'SUBSCRIPTION_REQUIRED') {
            if (window.eventBus) {
              window.eventBus.emit('grok:subscription_required', { error: errCode, message: result?.message });
            }
          }
          throw new Error('Grok submit thất bại: ' + (result?.message || errCode));
        }

        node.last_error = null;
        const mediaType = result.mediaType || (grokMode === 'video' ? 'video' : 'image');
        node.last_mode_used = mediaType;
        emitLog(`Grok ${mediaType}: ${result.mediaUrls?.length || 0} kết quả`, 'success');

        const mediaUrls = Array.isArray(result.mediaUrls) ? result.mediaUrls : [];
        if (mediaUrls.length === 0) {
          throw new Error('Grok không trả về URL media nào');
        }

        // 9. Cross-provider bridge: mỗi mediaUrl → Flow tile.
        //
        // VIDEO: Skip bridge vì không có node nào cần video trên Flow canvas.
        // Download node dùng provider URL path (fetch trực tiếp từ Grok CDN).
        // Tạo synthetic tile_id để UI render thumbnail + Download node có provider URL.
        //
        // IMAGE: Bridge sang Flow vì các node khác (Generate, Upscale) có thể cần.
        // Timeout 30s/bridge call. Nếu timeout/fail → fallback synthetic tile_id.
        const uploadedTiles = [];
        const grokTabId = result.tabId || tabId;
        const BRIDGE_TIMEOUT_MS = 60000; // 60s/url — tăng từ 30s để tránh timeout sớm + re-upload

        const bridgeWithTimeout = (url, tabId, fileName) => {
          return Promise.race([
            window.MessageBridge.grokBridgeToFlow(url, tabId, fileName),
            new Promise((resolve) => setTimeout(() => resolve({ success: false, error: 'BRIDGE_TIMEOUT' }), BRIDGE_TIMEOUT_MS)),
          ]);
        };

        // Tên file upload chuẩn hoá: {provider}-{node_id}-{runStamp}-{index}. runStamp unique/run
        // → re-run cùng node KHÔNG trùng tên → tile-match sau upload (uploadFilesToFlow) chọn đúng
        // tile MỚI nhất, không lấy nhầm tile cũ cùng node. Đồng nhất với chatgpt.
        const _uploadRunStamp = Date.now();
        for (let i = 0; i < mediaUrls.length; i++) {
          const url = mediaUrls[i];
          const ext = mediaType === 'video' ? 'mp4' : 'png';
          const fileName = `grok-${node.node_id}-${_uploadRunStamp}-${i + 1}.${ext}`;

          // VIDEO: Skip bridge, tạo synthetic tile ngay (Download node dùng provider URL)
          if (mediaType === 'video') {
            const syntheticTileId = `grok_video_${Date.now()}_${i}`;
            uploadedTiles.push({
              tileId: syntheticTileId,
              thumbnail: url,
              file_name: fileName,
              type: 'video',
            });
            emitLog(`Video ${i + 1}/${mediaUrls.length}: skip bridge, dùng provider URL để download`);
            continue;
          }

          // IMAGE: Bridge sang Flow
          const bridgeStartTime = Date.now();
          try {
            if (!window.MessageBridge?.grokBridgeToFlow) {
              emitLog('MessageBridge.grokBridgeToFlow không tồn tại — fallback synthetic tile', 'warn');
              const syntheticTileId = `grok_${Date.now()}_${i}`;
              uploadedTiles.push({
                tileId: syntheticTileId,
                thumbnail: url,
                file_name: fileName,
                type: mediaType,
              });
              continue;
            }
            emitLog(`[Grok Bridge] ${i + 1}/${mediaUrls.length}: Starting upload...`);
            const bridgeResp = await bridgeWithTimeout(url, grokTabId, fileName);
            const bridgeDuration = Date.now() - bridgeStartTime;
            emitLog(`[Grok Bridge] ${i + 1}/${mediaUrls.length}: Completed in ${bridgeDuration}ms`);
            if (bridgeResp?.success && bridgeResp.tileId) {
              const thumbUrl = bridgeResp.thumbnailUrl || url;
              // BUG FIX: Extract file_name từ thumbnailUrl nếu bridgeResp.fileName rỗng
              // Tránh reupload sau reload page do file_names mapping sai
              const flowFileName = bridgeResp.fileName || extractFileNameFromUrl(thumbUrl);
              uploadedTiles.push({
                tileId: bridgeResp.tileId,
                thumbnail: thumbUrl,
                file_name: flowFileName,
                type: mediaType,
              });
              emitLog(`Bridge ${i + 1}/${mediaUrls.length}: tileId=${bridgeResp.tileId.substring(0, 16)}` +
                      (flowFileName ? `, file_name=${flowFileName.substring(0, 16)}` : ''));
            } else {
              // Fallback: synthetic tile_id + Grok URL trực tiếp (UI vẫn render được)
              const errReason = bridgeResp?.error || 'unknown';
              emitLog(`Grok bridge ${errReason} → fallback synthetic tile (${i + 1}/${mediaUrls.length})`, 'warn');
              const syntheticTileId = `grok_${Date.now()}_${i}`;
              uploadedTiles.push({
                tileId: syntheticTileId,
                thumbnail: url,
                file_name: fileName,
                type: mediaType,
              });
            }
          } catch (bErr) {
            emitLog(`Grok bridge exception: ${bErr.message} → fallback synthetic`, 'warn');
            const syntheticTileId = `grok_${Date.now()}_${i}_err`;
            uploadedTiles.push({
              tileId: syntheticTileId,
              thumbnail: url,
              file_name: fileName,
              type: mediaType,
            });
          }
        }

        // 10. Persist result trên node (format object {tileId: {thumbnail, type, file_name}})
        node.result_file_ids = uploadedTiles.map(t => t.tileId).join(', ');
        node.result_thumbnails = uploadedTiles.reduce((acc, t) => {
          acc[t.tileId] = {
            thumbnail: t.thumbnail,
            type: t.type || 'image',
            file_name: t.file_name || '',
          };
          return acc;
        }, {});
        node.result_file_names = uploadedTiles.reduce((acc, t) => {
          if (t.file_name) acc[t.tileId] = t.file_name;
          return acc;
        }, {});

        // Phase: Dual URL — lưu URL provider gốc Grok (assets.grok.com / grok.x.ai).
        // Manual download ưu tiên URL gốc (chất lượng 100%, video nguyên codec/audio).
        node.result_provider_urls = uploadedTiles.reduce((acc, t, idx) => {
          const url = mediaUrls?.[idx];
          if (t.tileId && url) {
            acc[t.tileId] = {
              url,
              provider: 'grok',
              media_type: t.type || mediaType || 'image',
              tab_id: grokTabId,
              captured_at: Date.now(),
            };
          }
          return acc;
        }, {});

        // Cập nhật MediaRegistry để các node downstream + UI tham chiếu đúng
        if (typeof MediaRegistry !== 'undefined') {
          for (const t of uploadedTiles) {
            if (t.thumbnail) MediaRegistry.setThumb?.(t.tileId, t.thumbnail);
            if (t.file_name) MediaRegistry.setFileName?.(t.tileId, t.file_name);
          }
        }

        // 11. Auto-download (fire-and-forget background — không block emit node:completed).
        // Bug fix 2026-05-26: GỠ điều kiện !isPipelineActive. Grok node LUÔN execute trực tiếp
        // (không qua PromptQueue) + synthetic ID (grok_/grok_video_) bị filter khỏi pipeline →
        // PromptQueue KHÔNG bao giờ download CDN media của Grok (kể cả video). Trước fix: bật
        // pipeline → auto_download mất âm thầm (outer cũng skip external provider). Internal
        // download là path DUY NHẤT cho Grok (image + video CDN-only).
        // Dùng GenTab._buildChatGPTFilename helper với downloadFolder + downloadTemplate từ settings.
        const canUseAutoDownload = window.featureGate?.canUse('auto_download') ?? false;
        const nodeAutoDownload = canUseAutoDownload &&
          (node.auto_download === true || node.auto_download === '1' || node.auto_download === 1);
        if (nodeAutoDownload && mediaUrls.length > 0 && grokTabId) {
          emitLog(`Auto-download ${mediaUrls.length} media Grok (background)...`);
          // Fire-and-forget: download xảy ra song song với việc executor return + emit node:completed.
          // CDN URL Grok có signature TTL ~vài giờ → download trong background OK, không gấp.
          (async () => {
            try {
              const _wfGrokDl = await window.DownloadHelper.getSettings();
              const _wfGrokDownloadFolder = _wfGrokDl.folder;
              const _wfGrokDownloadTemplate = _wfGrokDl.template;

              for (let urlIdx = 0; urlIdx < mediaUrls.length; urlIdx++) {
                const url = mediaUrls[urlIdx];
                try {
                  // Filename build TRƯỚC fetch — dùng chung cho cả blob-download (Tier 1/2) lẫn
                  // direct-URL-download (Tier 3), không phụ thuộc kết quả fetch.
                  const ext = mediaType === 'video' ? 'mp4' : 'png';
                  let filename = window.GenTab?._buildChatGPTFilename?.(
                    _wfGrokDownloadTemplate,
                    window._currentProjectName || 'flow',
                    node.prompt || '',
                    1, urlIdx + 1, '',
                    workflow?.wf_name || null,
                    _wfGrokDownloadFolder
                  ) || `${_wfGrokDownloadFolder}/${_wfFolderName(workflow?.wf_name)}/grok-${Date.now()}-${urlIdx + 1}.${ext}`;
                  if (ext !== 'png' && filename.endsWith('.png')) {
                    filename = filename.replace(/\.png$/i, `.${ext}`);
                  }

                  // 3-tier download (helper chung): blob (prefetch/grokFetchImage) → direct URL (Tier 3).
                  const _pre = result.fetchedMedia?.find(f => f.url === url)?.base64 || null;
                  const dl = (await window.MessageBridge?.grokDownloadMedia?.(url, grokTabId, filename, _pre))
                    || { success: false, tier: 0, error: 'MessageBridge unavailable' };
                  if (!dl.success) emitLog(`Grok download fail (Tier ${dl.tier}): ${dl.error || 'unknown'}`, 'warn');
                  else if (dl.tier === 3) emitLog(`Grok download OK (Tier 3 direct URL)`, 'success');
                } catch (dlErr) {
                  emitLog(`Grok auto-download lỗi: ${dlErr.message}`, 'warn');
                }
              }
              emitLog(`Auto-download Grok hoàn tất`, 'success');
            } catch (e) {
              emitLog(`Auto-download Grok bg error: ${e.message}`, 'error');
            }
          })().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#bridgeWithTimeout', _e); });
        }

        // 12. ExecutionGate complete success
        if (grokToken && window.ExecutionGate) {
          await window.ExecutionGate.complete(grokToken, 'success').catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#bridgeWithTimeout', _e); });
        }

        // Bug fix: KHÔNG emit node:completed ở đây. Outer caller (executeSingleNode/_executeSingleNode)
        // sẽ emit SAU khi _executeNodeInternal finally restore _original_ref_state. Emit ở đây
        // chạy SYNC handler saveWorkflow() đọc Drawflow data TRƯỚC restore → persist port-merged
        // ref_file_ids xuống storage → reload mất ref_img.
        const fileIds = uploadedTiles.map(t => t.tileId);

        const duration = Date.now() - startTime;
        emitLog(`Grok Image node hoàn tất: ${fileIds.length} media trong ${duration}ms`, 'success');

        return {
          fileIds: fileIds.length > 0 ? fileIds : mediaUrls,
          duration,
          thumbnails: node.result_thumbnails,
          fileNames: node.result_file_names,
          grokResult: result,
          // Refs THỰC dùng cho GenerationHistory ref_img — node.ref_file_ids bị restore về rỗng
          // (port-merge từ upstream) nên emit phải dùng giá trị này (giống generate node).
          refFileIdsUsed: Array.isArray(refIdsCapped) ? refIdsCapped : [],
        };

      } catch (err) {
        // ExecutionGate complete failed (rollback quota)
        if (grokToken && window.ExecutionGate) {
          await window.ExecutionGate.complete(grokToken, 'failed').catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#bridgeWithTimeout', _e); });
        }
        if (!node.last_error) {
          node.last_error = err?.code || 'IMAGE_GEN_FAILED';
        }
        try {
          await window.storageManager?.updateNodeStatus(
            this.currentWorkflow?.wf_id || workflow?.wf_id,
            node.node_id,
            { last_error: node.last_error, last_mode_used: node.last_mode_used }
          );
        } catch (e) { /* ignore */ }
        throw err;
      }
    }

    /**
     * Phase CG-8: Execute Prompt/AI Agent node — chứa text + tuỳ chọn AI process qua LLM.
     *
     * AI Agent rename (2026-05-30):
     *   - node.enhance → node.use_ai (extension v1.1.6+ chỉ dùng key mới)
     *   - Feature gate dynamic từ workflow_node_types.config.ai_feature_key (Option C)
     *   - Backend Node observer mirror enhance↔use_ai cho v1.1.3 client backward compat (KHÔNG ở extension code)
     *
     * Flow:
     *  - Feature gate `prompt_node_enabled` → throw nếu false.
     *  - Branch 1 (use_ai OFF): pass-through, result_text = prompt nguyên văn.
     *  - Branch 2 (use_ai ON):
     *      + Feature gate dynamic (Option C: NodeTemplates.getType('prompt').config.ai_feature_key,
     *        default 'ai_agent_enabled') → soft fallback to plain với log warning.
     *      + Get adapter ChatGPT/Gemini từ ProviderRegistry.
     *      + ExecutionGate.request(`${provider}_run`, 1).
     *      + adapter.ensureReady() → throw nếu fail.
     *      + adapter.submitText({ prompt, timeout }) → result.text.
     *      + Empty result → fallback plain với warning.
     *      + ExecutionGate.complete.
     */
    async _executePromptNode(node, workflow, emitLog) {
      const startTime = Date.now();

      // AI Agent rename (2026-05-30): chỉ đọc node.use_ai. Backend dual-mirror enhance↔use_ai
      // qua Node observer + NodeTemplates.normalizeNodeData heal stale chrome.storage từ v1.1.5.
      const useAi = node.use_ai === true;

      console.log(`[PromptNode] START: nodeId=${node.node_id}, use_ai=${useAi}, provider=${node.provider}, hasFeatureGate=${!!window.featureGate}`);

      // 1. Feature gate cơ bản — cho phép dùng Prompt node nói chung (cả OFF + ON).
      if (window.featureGate && !window.featureGate.canUse('prompt_node_enabled')) {
        console.warn(`[PromptNode] FEATURE_LOCKED: prompt_node_enabled = false`);
        const err = new Error('Prompt node chưa được kích hoạt cho gói hiện tại');
        err.code = 'FEATURE_LOCKED';
        node.last_error = 'FEATURE_LOCKED';
        throw err;
      }

      const originalNodePrompt = node.prompt || '';

      // === AUTO MODE DETECTION (Bug fix 2026-05-30) ===
      // Prompt mode mapping:
      //   - 'auto' (default): inline substitute nếu prompt có @mention, ngược lại port-based combine
      //   - 'all': giữ literal @tag, port-based combine
      //   - 'mention': explicit inline substitute (cũng skip port combine)
      // User bug: prompt "Hãy tìm kiếm @chu_de..." với @chu_de connect via port → port-based combine
      // OVERRIDE prompt thành chu_de content, MẤT phần "Hãy tìm kiếm... để phân tích".
      // Fix: detect @mention trong original prompt → ưu tiên inline substitute, skip port combine.
      const promptHasMention = typeof parseMentions === 'function'
        ? parseMentions(originalNodePrompt).length > 0
        : /@[a-z][a-z0-9_]{0,29}/i.test(originalNodePrompt);
      const promptMode = node.prompt_mode || 'auto';
      const refMode = node.ref_mode || 'auto';
      // Substitute @mention inline nếu: explicit mention mode HOẶC auto + có @mention trong prompt
      const shouldSubstituteInline = (promptMode === 'mention')
        || (promptMode === 'auto' && promptHasMention)
        || (refMode === 'mention');

      // === PORT-BASED TEXT INPUT (Phase WK-1.4.6) ===
      // Chained prompt: gộp TẤT CẢ upstream text qua port `text` → override node.prompt.
      // SKIP nếu shouldSubstituteInline=true (giữ original prompt cho @mention inline substitute).
      let portTextOverridden = false;
      if (!shouldSubstituteInline) {
        try {
          const combinedResult = this._combineUpstreamTexts(node, workflow);
          if (combinedResult) {
            node.prompt = combinedResult.text;
            portTextOverridden = true;
            emitLog(`Prompt node nhận text từ ${combinedResult.sources.length} upstream(s): len=${combinedResult.text.length}`);
          }
        } catch (err) {
          emitLog('Lỗi collect port "text" prompt node: ' + err.message, 'warn');
        }
      } else {
        console.log(`[PromptNode] SKIP port-based combine — prompt có @mention (mode=${promptMode}) → inline substitute thay vì override`);
      }

      // === @MENTION RESOLUTION ===
      // Trigger khi shouldSubstituteInline (có @mention explicit / mention mode) + port CHƯA override.
      // KHÔNG phụ thuộc prompt_source: wiring text→prompt node khiến UI auto-detect set
      // prompt_source='upstream_node', nhưng @mention trong body là intent rõ ràng của user → phải
      // substitute, không để literal @tag leak xuống provider (grok strip @ giữ tên → sai). Port-combine
      // đã skip khi có @mention (line ~7346) nên !portTextOverridden luôn true ở đây (giữ defensive).
      if (shouldSubstituteInline && !portTextOverridden) {
        try {
          const nodesBySlug = buildNodesBySlug(workflow.nodes || []);
          const { warnings, errors } = validateMentions(node, nodesBySlug);
          for (const w of warnings) emitLog(`[Mention] Warning: ${w.message}`, 'warn');
          for (const e of errors) emitLog(`[Mention] Error: ${e.message}`, 'error');

          // Auto mode tạm set prompt_mode='mention' để resolvePromptMentions trigger substitute
          // (resolvePromptMentions check `promptMode === 'mention'` strict).
          const savedMode = node.prompt_mode;
          if (promptMode === 'auto') node.prompt_mode = 'mention';
          const resolvedPrompt = resolvePromptMentions(node, nodesBySlug);
          node.prompt_mode = savedMode; // restore

          if (resolvedPrompt !== originalNodePrompt) {
            console.log(`[PromptNode][Mention] Resolved: "${originalNodePrompt.substring(0, 100)}..." → "${resolvedPrompt.substring(0, 100)}..."`);
            node.prompt = resolvedPrompt;
            emitLog(`Prompt mention resolved (mode=${promptMode}): ${originalNodePrompt.length} → ${resolvedPrompt.length} chars`);
          }
        } catch (err) {
          emitLog('Mention resolve error: ' + err.message, 'warn');
          console.warn('[PromptNode] Mention resolve failed:', err);
        }
      }

      const promptText = (node.prompt || '').trim();
      if (!promptText) {
        const err = new Error('Prompt node: nội dung prompt rỗng');
        err.code = 'EMPTY_PROMPT';
        node.last_error = 'EMPTY_PROMPT';
        throw err;
      }

      // === PORT-BASED IMAGE_REF (Phase WK-1.4.6) — chỉ khi use_ai=ON ===
      // Gộp tile IDs từ port `image_ref` vào node.ref_file_ids để _resolveRefImagesForLLM xử lý.
      if (useAi) {
        try {
          const portImageRefs = this._collectPortInputs(node, 'image_ref', workflow.nodes, workflow.edges);
          if (portImageRefs.length > 0) {
            const existing = (node.ref_file_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
            const combined = [...new Set([...existing, ...portImageRefs])];
            node.ref_file_ids = combined.join(', ');

            // Bug fix 2026-05-26: chỉ merge ID là chưa đủ — phải merge cả ref_thumbnails +
            // ref_file_names từ source node để _resolveRefImagesForLLM có URL → fetch base64.
            // (Mirror generate node port-merge :3599-3629.)
            if (!node.ref_thumbnails || Array.isArray(node.ref_thumbnails)) node.ref_thumbnails = {};
            if (!node.ref_file_names || Array.isArray(node.ref_file_names)) node.ref_file_names = {};
            const imageRefEdges = (workflow.edges || []).filter((e) =>
              e.target_node_id === node.node_id &&
              (e.target_port === 'image_ref' || !e.target_port || e.target_port === 'default'));
            for (const edge of imageRefEdges) {
              const src = workflow.nodes.find((n) => n.node_id === edge.source_node_id);
              if (!src) continue;
              const srcThumbs = { ...(src.ref_thumbnails || {}), ...(src.result_thumbnails || {}) };
              const srcNames = { ...(src.ref_file_names || {}), ...(src.result_file_names || {}) };
              for (const [fid, thumb] of Object.entries(srcThumbs)) {
                if (!node.ref_thumbnails[fid]) node.ref_thumbnails[fid] = thumb;
              }
              for (const [fid, fname] of Object.entries(srcNames)) {
                if (!node.ref_file_names[fid]) node.ref_file_names[fid] = fname;
              }
            }
            // Fallback MediaRegistry cho IDs port-merged chưa có thumbnail.
            for (const fid of portImageRefs) {
              if (!node.ref_thumbnails[fid] && typeof MediaRegistry !== 'undefined' && MediaRegistry.getThumb?.(fid)) {
                node.ref_thumbnails[fid] = MediaRegistry.getThumb(fid);
              }
            }
            emitLog(`Prompt node port "image_ref" merge: +${portImageRefs.length} ảnh (tổng ${combined.length})`);
          }
        } catch (err) {
          emitLog('Lỗi collect port "image_ref" prompt node: ' + err.message, 'warn');
        }
      }

      // 2. BRANCH 1: AI Agent OFF (pass-through plain text)
      if (!useAi) {
        console.log(`[PromptNode] BRANCH 1: use_ai=false → plain pass-through (len=${promptText.length})`);
        // 2026-05-31: normalize cả plain pass-through để consistent với AI branch.
        node.result_text = this._normalizeExtractedText(promptText);
        node.result_source = 'plain';
        node.last_error = null;
        emitLog(`AI Agent node: pass-through plain text (len=${node.result_text.length})`);
        // 2026-05-30: Restore original prompt (xem comment ở success branch ~line 7050).
        if (originalNodePrompt !== node.prompt) {
          node.prompt = originalNodePrompt;
        }
        const duration = Date.now() - startTime;
        // Bug fix: KHÔNG emit node:completed ở đây — outer caller emit sau finally restore.
        return { fileIds: [], duration, resultText: promptText };
      }

      // AI Agent rename (2026-05-30) — Option C: feature key dynamic từ server config.
      // Fallback safe: 'ai_agent_enabled' nếu Migration A2 chưa run (cold start).
      const _nodeTypeCfg = window.NodeTemplates?.getType?.('prompt')?.config || {};
      const _aiFeatureKey = _nodeTypeCfg.ai_feature_key || 'ai_agent_enabled';
      console.log(`[PromptNode] BRANCH 2: use_ai=true, checking feature gate '${_aiFeatureKey}'...`);

      // 3. BRANCH 2: AI Agent ON
      // 3.1. Feature gate AI — fallback to plain nếu không có quyền (không throw).
      if (window.featureGate && !window.featureGate.canUse(_aiFeatureKey)) {
        console.warn(`[PromptNode] ${_aiFeatureKey} = false → fallback plain. Plan: ${window.featureGate?._currentPlan || 'unknown'}`);
        emitLog(`${_aiFeatureKey} = false → fallback sang plain text`, 'warn');
        // 2026-05-31: normalize plain_fallback text
        node.result_text = this._normalizeExtractedText(promptText);
        node.result_source = 'plain_fallback';
        node.last_error = null;
        // SHOW notification để user biết rõ lý do tab switch nhưng không AI process.
        // 2026-05-31 i18n fix: dùng key workflow.aiAgentNoPermFallback thay vì hardcode VN —
        // EN/JA/TH user trước đây thấy VN. Wording mới có CTA upgrade Premium.
        if (typeof window.showNotification === 'function') {
          const _nodeName = node.node_name || (window.I18n?.t?.('node.aiAgentNodeDefault') || 'AI Agent');
          const _msg = (window.I18n?.t?.('workflow.aiAgentNoPermFallback', { node: _nodeName })
              || `${_nodeName}: gói hiện tại không có quyền AI Agent — đã dùng plain text. Nâng cấp Premium để mở khóa.`)
            .replace('{node}', _nodeName); // safety nếu I18n.t không replace placeholder
          window.showNotification(_msg, 'warning', 5000);
        }
        // 2026-05-30: Restore original prompt.
        if (originalNodePrompt !== node.prompt) {
          node.prompt = originalNodePrompt;
        }
        const duration = Date.now() - startTime;
        return { fileIds: [], duration, resultText: promptText };
      }

      console.log(`[PromptNode] Feature gate OK. Getting adapter for provider=${node.provider}...`);

      // 3.2. Get adapter
      const providerKey = node.provider || 'chatgpt';
      if (!window.ProviderRegistry) {
        console.error(`[PromptNode] ProviderRegistry KHÔNG sẵn sàng`);
        throw new Error('ProviderRegistry chưa sẵn sàng');
      }
      const adapter = window.ProviderRegistry.get(providerKey);
      if (!adapter) {
        console.error(`[PromptNode] Adapter ${providerKey} KHÔNG khả dụng`);
        throw new Error(`Provider ${providerKey} không khả dụng`);
      }
      if (typeof adapter.submitText !== 'function') {
        console.error(`[PromptNode] Adapter ${providerKey} không có submitText method`);
        throw new Error(`Adapter ${providerKey} không hỗ trợ submitText()`);
      }
      console.log(`[PromptNode] Adapter ${providerKey} OK. Requesting ExecutionGate...`);

      // 3.3. ExecutionGate request — trừ quota của provider tương ứng.
      // BUG FIX 2026-06-05: per-provider action key thay vì hard-code 'chatgpt_run'.
      // Trước: action='chatgpt_run' cho TẤT CẢ providers → Gemini submit trừ nhầm
      // chatgpt_run_max quota + check chatgpt_enabled gate (KHÔNG check gemini_enabled).
      // Sau: action='{provider}_run' dynamic. Backend ExecutionService.php:40-42 đã support
      // 3 actions: chatgpt_run, gemini_run, grok_run với từng quota + feature key riêng.
      // Defense: whitelist 3 providers — fallback chatgpt_run nếu provider lạ (an toàn).
      const _allowedProviders = new Set(['chatgpt', 'gemini', 'grok']);
      const action = _allowedProviders.has(providerKey) ? `${providerKey}_run` : 'chatgpt_run';
      let token = null;
      if (window.ExecutionGate) {
        try {
          const gate = await window.ExecutionGate.request(action, 1, {
            owner: 'workflow',
            label: `Prompt enhance (${providerKey})`,
          });
          if (!gate?.allowed) {
            window.ExecutionGate.showDeniedDialog?.(gate, 'Prompt enhance');
            const err = new Error(gate?.reason === 'QUOTA_EXCEEDED' ? `Đã hết lượt ${providerKey} hôm nay` : `Không được phép chạy ${providerKey}`);
            err.code = gate?.reason || 'QUOTA_EXCEEDED';
            node.last_error = 'RATE_LIMIT';
            throw err;
          }
          token = gate.token;
        } catch (e) {
          if (window.QuotaErrorHandler?.isQuotaError(e)) {
            node.last_error = e.code === 'FEATURE_LOCKED' ? 'FEATURE_LOCKED' : 'RATE_LIMIT';
            throw e;
          }
          // M11 fix: Server-Only — abort thay vì proceed với token=null (mirror chatgpt/grok handlers).
          // Trước fix: gate lỗi → submit không có token quota → backend không trừ/không track đúng.
          console.error('[WorkflowExecutor] Prompt enhance ExecutionGate failed, ABORTING node (Server-Only):', e.message);
          node.last_error = 'GATE_REQUEST_FAILED';
          throw new Error(`Không thể xin phép server chạy ${providerKey} node: ${e.message || 'unknown'}`);
        }
      }

      try {
        // 3.4. ensureReady
        console.log(`[PromptNode] Calling adapter.ensureReady() for ${providerKey}...`);
        const ready = await adapter.ensureReady();
        console.log(`[PromptNode] ensureReady result:`, ready);
        if (!ready || !ready.ready) {
          if (window.eventBus && providerKey === 'chatgpt') {
            window.eventBus.emit('chatgpt:login_required', { error: ready?.error || 'NOT_LOGGED_IN' });
          } else if (window.eventBus && providerKey === 'gemini') {
            window.eventBus.emit('gemini:login_required', { error: ready?.error || 'NOT_LOGGED_IN' });
          }
          const err = new Error(`${providerKey} chưa sẵn sàng: ${ready?.error || 'NOT_LOGGED_IN'}`);
          err.code = ready?.error || 'NOT_READY';
          node.last_error = err.code;
          throw err;
        }

        // 3.4b. ensureTabActive — luôn activate tab trước DOM interaction
        if (providerKey === 'chatgpt' && window.ChatGPTSession?.ensureTabActive) {
          await window.ChatGPTSession.ensureTabActive();
        } else if (providerKey === 'grok' && window.GrokSession?.ensureTabActive) {
          await window.GrokSession.ensureTabActive({ focusWindow: false }); // workflow-editor: không cướp focus
        } else if (providerKey === 'gemini' && window.GeminiSession?.ensureTabActive) {
          await window.GeminiSession.ensureTabActive();
        }

        // 3.5. Phase CG-8 ext: Resolve ref images (cho phép user gửi prompt kèm ảnh)
        //  - Smart Clone: reconstruct ref_file_ids nếu chỉ có ref_file_names
        //  - Upload pending local files (upload_xxx keys) qua window.uploadPendingFiles
        //  - Convert tile thumbnails → base64 qua background fetchBlob
        if (!node.ref_file_ids && node.ref_file_names && Object.keys(node.ref_file_names).length > 0) {
          node.ref_file_ids = Object.keys(node.ref_file_names).join(', ');
          emitLog('Smart Clone: reconstructed ref_file_ids cho prompt node');
        }

        if (node.ref_file_ids && node.ref_file_ids.includes('upload_') && typeof window.uploadPendingFiles === 'function') {
          const oldRefIds = node.ref_file_ids;
          emitLog('Upload pending refs cho prompt node...');
          node.ref_file_ids = await window.uploadPendingFiles(node.ref_file_ids);
          if (node.ref_file_ids !== oldRefIds) {
            const newIdArr = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
            if (!node.ref_file_names) node.ref_file_names = {};
            for (const newId of newIdArr) {
              if (typeof MediaRegistry !== 'undefined' && MediaRegistry.getFileName?.(newId)) {
                node.ref_file_names[newId] = MediaRegistry.getFileName(newId);
              }
            }
          }
        }

        const resolvedRefs = await this._resolveRefImagesForLLM(node, adapter);
        if (resolvedRefs.length > 0) {
          emitLog(`Đã resolve ${resolvedRefs.length} ref image(s) cho prompt enhance`);
        }

        // 3.6. Submit text — KHÔNG modify, KHÔNG prepend prefix
        // BUG FIX 2026-06-05: Adaptive timeout based on prompt length.
        // Trước: timeout = node.timeout_sec || 60s flat. Long prompt (vd 7000+ chars) Gemini
        // stream response 60s+ → TIMEOUT → fallback plain text dù Gemini ACTUAL SUCCESS.
        // User báo: "Gemini không phản hồi" lần 2 (conversation context lớn hơn).
        // Sau: base + bonus theo prompt length (+1s per 100 chars, cap +120s).
        // Vd: prompt 1000 chars → 70s. 5000 chars → 110s. 10000+ chars → 180s (cap).
        const baseTimeoutSec = parseInt(node.timeout_sec, 10) || 60;
        const lengthBonusSec = Math.min(120, Math.floor((promptText?.length || 0) / 100));
        const totalTimeoutSec = baseTimeoutSec + lengthBonusSec;
        const timeoutMs = totalTimeoutSec * 1000;
        emitLog(`Prompt enhance via ${providerKey} (timeout ${totalTimeoutSec}s = base ${baseTimeoutSec}s + ${lengthBonusSec}s adaptive cho prompt ${promptText?.length || 0} chars)...`);

        // Tracker update để show UI running khi enhance prompt
        if (window.eventBus) {
          window.eventBus.emit('execution:tracker_update', {
            owner: 'workflow',
            phase: 'prompt_enhancing',
            promptText: `Enhancing via ${providerKey}...`,
            genMode: 'text',
          });
        }

        // Wrap submitText với try-catch riêng để có thể fallback khi timeout/error
        let enhanceResult = null;
        let enhanceError = null;
        try {
          console.log(`[PromptNode] Calling adapter.submitText for ${providerKey}, timeout=${timeoutMs}ms...`);
          enhanceResult = await adapter.submitText({
            prompt: promptText,
            refFileIds: resolvedRefs,
            timeout: timeoutMs,
          });
          console.log(`[PromptNode] submitText returned:`, {
            success: enhanceResult?.success,
            textLen: enhanceResult?.text?.length || 0,
            error: enhanceResult?.error,
          });
        } catch (submitErr) {
          enhanceError = submitErr;
          const errCode = submitErr?.code || submitErr?.message || 'UNKNOWN';
          console.error(`[PromptNode] submitText THREW:`, submitErr);
          emitLog(`Enhance error: ${errCode}`, 'warn');
        }

        const enhancedText = (enhanceResult?.text || '').trim();

        // Xử lý kết quả enhance hoặc fallback
        if (enhanceError || !enhancedText) {
          // AI Agent rename (2026-05-30): chỉ đọc node.ai_fallback (extension v1.1.6+ field).
          // Default true (chỉ false nếu user explicit set false).
          const canFallback = node.ai_fallback !== false;

          if (canFallback) {
            // Fallback về plain text với warning
            const errCode = enhanceError?.code || enhanceError?.message || '';
            const reason = enhanceError ? errCode : 'empty response';
            emitLog(`${providerKey} ${reason} — fallback sang plain text`, 'warn');
            // 2026-05-31: normalize fallback text
            node.result_text = this._normalizeExtractedText(promptText);
            node.result_source = 'plain_fallback';
            node.last_error = null;

            // Show notification với message cụ thể theo error type
            if (typeof window.showNotification === 'function') {
              let notifMsg = `${node.node_name || 'Prompt'}: ${providerKey} không phản hồi, đã dùng plain text.`;

              // IMAGE_GENERATION_DETECTED: Gemini tạo ảnh thay vì trả prompt text
              if (errCode === 'IMAGE_GENERATION_DETECTED') {
                notifMsg = `${node.node_name || 'Prompt'}: ${providerKey} tạo ảnh thay vì trả prompt text — đã dùng plain text.`;
              }

              window.showNotification(notifMsg, 'warning', 5000);
            }
          } else {
            // Không cho phép fallback → throw error
            if (token && window.ExecutionGate) {
              await window.ExecutionGate.complete(token, 'failed').catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#_executePromptNode', _e); });
            }
            const err = enhanceError || new Error(`${providerKey} trả về empty text`);
            err.code = err.code || 'ENHANCE_FAILED';
            node.last_error = err.code;
            throw err;
          }
        } else {
          // Enhance thành công.
          // 2026-05-31: normalize AI response — bỏ leading/trailing blank lines + trailing
          // whitespace per line + collapse multi-blank. Non-compact mode để preserve indent
          // markdown/code/list AI có thể trả về có ý nghĩa. NBSP/zero-width chars cleanup luôn.
          node.result_text = this._normalizeExtractedText(enhancedText);
          node.result_source = providerKey;
          node.last_error = null;
          emitLog(`Prompt enhance hoàn tất: len=${node.result_text.length}`);
        }

        // 3.6b. Delete conversation sau khi AI run (2026-05-29) — nếu setting bật.
        // Chỉ trigger khi run SUCCESS (KHÔNG delete khi fallback plain text vì có thể chưa submit gì).
        // Best-effort: lỗi delete không break flow (log warn rồi tiếp tục).
        // AI Agent rename (2026-05-30): chỉ đọc node.ai_delete_after_run (extension v1.1.6+ field).
        // 2026-05-30 diagnostic log: in điều kiện check để dễ debug khi user báo delete không click.
        console.log('[PromptNode] Delete conversation check:', {
          ai_delete_after_run: node.ai_delete_after_run,
          result_source: node.result_source,
          providerKey,
          conditionMatch: (node.ai_delete_after_run === true && node.result_source === providerKey),
        });
        if (node.ai_delete_after_run === true && node.result_source === providerKey) {
          try {
            emitLog(`Delete ${providerKey} conversation sau enhance...`);
            let delResult = null;
            if (providerKey === 'chatgpt' && window.ChatGPTSession?.deleteLastMessage) {
              delResult = await window.ChatGPTSession.deleteLastMessage();
            } else if (providerKey === 'gemini' && window.GeminiSession?.deleteCurrentConversation) {
              delResult = await window.GeminiSession.deleteCurrentConversation();
            }
            if (delResult?.success) {
              emitLog(`✓ Đã xóa ${providerKey} conversation`);
            } else {
              emitLog(`⚠ Delete ${providerKey} conversation thất bại: ${delResult?.error || 'unknown'}`, 'warn');
            }
          } catch (delErr) {
            emitLog(`⚠ Delete ${providerKey} exception: ${delErr.message}`, 'warn');
          }
        }

        // 3.7. ExecutionGate complete success
        if (token && window.ExecutionGate) {
          await window.ExecutionGate.complete(token, 'success').catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#_executePromptNode', _e); });
        }

        // 2026-05-30 Bug fix: Restore node.prompt về ORIGINAL (trước mention resolve + port override).
        // Mutation ở step 2 (port-based combine) + step 2.5 (mention resolve) đã ghi đè node.prompt
        // thành resolved text. Nếu KHÔNG restore → Section 1 trên UI hiển thị resolved (vd "Hãy tìm
        // kiếm thông tin về <chu_de content>...") thay vì @chu_de tag → user mất context original.
        // Plus sync drawflow sẽ persist resolved text vào storage → mất prompt template gốc.
        if (originalNodePrompt !== node.prompt) {
          node.prompt = originalNodePrompt;
          console.log('[PromptNode] Restored node.prompt về original sau AI submit');
        }

        const duration = Date.now() - startTime;
        // Bug fix: KHÔNG emit node:completed ở đây — outer caller emit sau finally restore.
        return { fileIds: [], duration, resultText: node.result_text };

      } catch (err) {
        // ExecutionGate complete failed (rollback quota)
        if (token && window.ExecutionGate) {
          await window.ExecutionGate.complete(token, 'failed').catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#_executePromptNode', _e); });
        }
        // Restore prompt khi error path cũng — tránh leak resolved text vào next retry
        if (typeof originalNodePrompt === 'string' && originalNodePrompt !== node.prompt) {
          node.prompt = originalNodePrompt;
        }
        if (!node.last_error) {
          node.last_error = err?.code || err?.message || 'PROMPT_FAILED';
        }
        throw err;
      }
    }

    /**
     * Text Extract Node execution (2026-05-29) — pure JS regex/JSON parse, KHÔNG call AI.
     *
     * Workflow: tách output từ upstream prompt enhance theo marker/JSON/regex config.
     * Output: result_text đẩy xuống downstream qua port 'text'.
     *
     * Modes:
     *   - marker: match `[name]: value` (flexible whitespace + case-insensitive khi !strict)
     *   - json: parse upstream JSON + lookup key (tolerant markdown code block fence)
     *   - regex: custom regex pattern, group 1 hoặc group cuối = output
     *
     * On-fail:
     *   - empty: pass text rỗng → downstream node fail
     *   - skip_downstream: mark node._extract_failed → _checkDependencies skip downstream
     *   - fail_workflow: throw error → workflow fail
     */
    // Text Template Node — ghép text upstream vào mẫu (node.prompt). Placeholder:
    //   {{input}}        → gộp toàn bộ text upstream (join '\n\n', theo thứ tự _combineUpstreamTexts)
    //   {{input1}}, {{input2}}… → từng node upstream theo thứ tự (1-based); thiếu nguồn → ''
    // Không có mẫu → output = nối toàn bộ upstream (acts như merge-text). Pure string, no AI/backend.
    // Build (n8n-style): Condition/Switch — đánh giá điều kiện trên input → chọn nhánh TRUE/FALSE,
    // SKIP các node CHỈ nằm sau nhánh không chọn (reachable-only-via-inactive-port). Gated: chỉ node
    // condition mới thêm vào this._skippedNodeIds → workflow không có condition KHÔNG bị ảnh hưởng.
    /**
     * Skip toàn bộ hạ lưu của cổng KHÔNG được chọn. Trích từ _executeConditionNode để
     * quality_gate dùng chung — quan trọng là dùng chung luôn cả GUARD "còn input sống
     * thì không skip", nếu viết lại thì sớm muộn cũng lệch nhau.
     *
     * Guard đó xử đúng ca Merge: node nhận nhánh-trượt + một node luôn-chạy vẫn còn
     * đường sống → không được skip, nếu không workflow đứng giữa chừng.
     * @returns {number} số node bị skip
     */
    _skipInactiveBranch(node, workflow, activePort, inactivePort) {
      const edges = (workflow && workflow.edges) || this.currentWorkflow?.edges || [];
      const reachFrom = (port) => {
        const roots = edges.filter((e) => e.source_node_id === node.node_id && (e.source_port || 'default') === port).map((e) => e.target_node_id);
        const seen = new Set(); const queue = [...roots];
        while (queue.length) {
          const id = queue.shift();
          if (!id || seen.has(id)) continue; seen.add(id);
          edges.filter((e) => e.source_node_id === id).forEach((e) => { if (!seen.has(e.target_node_id)) queue.push(e.target_node_id); });
        }
        return seen;
      };
      const inactiveReach = reachFrom(inactivePort);
      const activeReach = reachFrom(activePort);
      if (!this._skippedNodeIds) this._skippedNodeIds = new Set();
      let skipped = 0;
      for (const id of inactiveReach) {
        if (activeReach.has(id)) continue;              // nằm ở cả 2 nhánh → vẫn chạy
        const inEdges = edges.filter((e) => e.target_node_id === id);
        const hasLiveInput = inEdges.some((e) => {
          const s = e.source_node_id;
          if (s === node.node_id) return (e.source_port || 'default') === activePort;
          return !inactiveReach.has(s) && !this._skippedNodeIds.has(s);
        });
        if (hasLiveInput) continue;
        this._skippedNodeIds.add(id); skipped++;
      }
      return skipped;
    }

    _executeConditionNode(node, workflow, emitLog) {
      const log = (msg, type = 'info') => emitLog(msg, type);
      const edges = (workflow && workflow.edges) || this.currentWorkflow?.edges || [];
      const nodes = (workflow && workflow.nodes) || this.currentWorkflow?.nodes || [];
      const op = node.condition_op || 'has_text';
      const val = node.condition_value || '';
      let text = '';
      // Nuốt im 2 chỗ này → condition thấy text/file RỖNG rồi rẽ nhánh SAI, mà log lại báo
      // "không có text upstream" thay vì lỗi thật → rất khó truy. Phải để lại dấu vết.
      try { const c = this._combineUpstreamTexts(node, workflow); if (c) text = (c.text || '').trim(); }
      catch (e) { console.warn('[WorkflowExecutor] condition: gom text upstream lỗi →', e?.message); }
      let hasFile = false;
      try { const ids = this._collectInputFileIds(node, nodes, edges); hasFile = Array.isArray(ids) && ids.length > 0; }
      catch (e) { console.warn('[WorkflowExecutor] condition: gom file upstream lỗi →', e?.message); }
      let condTrue;
      switch (op) {
        case 'no_text': condTrue = !text; break;
        case 'contains': condTrue = !!val && text.toLowerCase().includes(val.toLowerCase()); break;
        case 'regex': try { condTrue = !!val && new RegExp(val, 'i').test(text); } catch (_) { condTrue = false; } break;
        case 'has_result': condTrue = hasFile; break;
        case 'has_text': default: condTrue = !!text || hasFile; break;
      }
      const activePort = condTrue ? 'true' : 'false';
      const inactivePort = condTrue ? 'false' : 'true';
      node._active_branch = activePort;
      node.result_active_branch = activePort;
      node.result_text = text; // pass-through input cho nhánh active
      // Dùng chung helper với quality_gate — gồm cả guard merge-skip (chỉ skip khi MỌI
      // input đến từ nhánh inactive/đã-skip; còn ≥1 input sống thì giữ, vd Merge nhận
      // nhánh-false cộng 1 node luôn-chạy).
      const skipCount = this._skipInactiveBranch(node, workflow, activePort, inactivePort);
      log(`Condition: ${op}${(op === 'contains' || op === 'regex') ? ` "${val}"` : ''} → ${condTrue ? 'TRUE' : 'FALSE'} (skip ${skipCount} node nhánh ${inactivePort})`);
      return { success: true, text };
    }

    // Build (n8n-style): Switch — khớp giá trị input với case1/2/3 (lần lượt) → chọn 1 trong 4 port
    // (case1/case2/case3/else). SKIP các nhánh KHÔNG chọn (gated, cùng cơ chế + live-input guard như
    // condition). workflow không có switch → KHÔNG bị ảnh hưởng.
    _executeSwitchNode(node, workflow, emitLog) {
      const log = (msg, type = 'info') => emitLog(msg, type);
      const edges = (workflow && workflow.edges) || this.currentWorkflow?.edges || [];
      const nodes = (workflow && workflow.nodes) || this.currentWorkflow?.nodes || [];
      const mode = node.switch_mode || 'contains';
      let text = '';
      // Nuot im -> switch re nhanh SAI vi tuong text rong.
      try { const c = this._combineUpstreamTexts(node, workflow); if (c) text = (c.text || '').trim(); }
      catch (e) { console.warn('[WorkflowExecutor] switch: gom text upstream loi ->', e?.message); }
      const cases = [['case1', node.switch_case1 || ''], ['case2', node.switch_case2 || ''], ['case3', node.switch_case3 || '']];
      const matches = (val) => {
        if (!val) return false;
        if (mode === 'equals') return text.toLowerCase() === val.toLowerCase();
        if (mode === 'regex') { try { return new RegExp(val, 'i').test(text); } catch (_) { return false; } }
        return text.toLowerCase().includes(val.toLowerCase()); // contains (mặc định)
      };
      let activePort = 'else';
      for (const [port, val] of cases) { if (matches(val)) { activePort = port; break; } }
      node._active_branch = activePort;
      node.result_active_branch = activePort;
      node.result_text = text; // pass-through cho nhánh active
      const allPorts = ['case1', 'case2', 'case3', 'else'];
      const reachFrom = (port) => {
        const roots = edges.filter(e => e.source_node_id === node.node_id && (e.source_port || 'default') === port).map(e => e.target_node_id);
        const seen = new Set(); const queue = [...roots];
        while (queue.length) {
          const id = queue.shift();
          if (seen.has(id)) continue; seen.add(id);
          edges.filter(e => e.source_node_id === id).forEach(e => { if (!seen.has(e.target_node_id)) queue.push(e.target_node_id); });
        }
        return seen;
      };
      const activeReach = reachFrom(activePort);
      const inactiveReach = new Set();
      allPorts.filter(p => p !== activePort).forEach(p => reachFrom(p).forEach(id => inactiveReach.add(id)));
      if (!this._skippedNodeIds) this._skippedNodeIds = new Set();
      let skipCount = 0;
      for (const id of inactiveReach) {
        if (activeReach.has(id)) continue; // ở nhánh active khác → không skip
        const inEdges = edges.filter(e => e.target_node_id === id);
        const hasLiveInput = inEdges.some(e => {
          const s = e.source_node_id;
          if (s === node.node_id) return (e.source_port || 'default') === activePort;
          return !inactiveReach.has(s) && !this._skippedNodeIds.has(s);
        });
        if (hasLiveInput) continue;
        this._skippedNodeIds.add(id); skipCount++;
      }
      log(`Switch: ${mode} → nhánh ${activePort} (skip ${skipCount} node)`);
      return { success: true, text };
    }

    // Build (n8n-style): Random Pick — chọn NGẪU NHIÊN 1 text trong các upstream → output. Đa dạng
    // hoá prompt/style khi gen loạt. Pure data (không đụng DAG). result_text = source ngẫu nhiên.
    _executeRandomPickNode(node, workflow, emitLog) {
      const log = (msg, type = 'info') => emitLog(msg, type);
      let combined = null;
      try { combined = this._combineUpstreamTexts(node, workflow); }
      catch (e) { log('Lỗi gom text upstream: ' + e.message, 'warn'); }
      const sources = (combined && combined.sources) || [];
      if (!sources.length) {
        const err = new Error('RANDOM_PICK_EMPTY: không có text upstream — connect ≥1 node text/prompt.');
        err.code = 'EMPTY_UPSTREAM'; err.noRetry = true; node.last_error = 'RANDOM_PICK_EMPTY';
        throw err;
      }
      const idx = Math.floor(Math.random() * sources.length);
      const picked = sources[idx].text;
      node.result_text = picked;
      node.result_source = 'random_pick';
      log(`Random Pick: chọn #${idx + 1}/${sources.length} → ${picked.length} chars`);
      return { success: true, text: picked };
    }

    // MERGE NODE — gộp nhiều input thành 1: nối TEXT upstream (result_text) + gộp FILE ids upstream
    // (result_file_ids, khử trùng). Pure pass-through: KHÔNG gọi AI/provider (khác generate). Downstream
    // đọc merged text/file như 1 node nguồn bình thường. Sửa D2: trước đây merge không có handler → rơi
    // vào generate → submit prompt rỗng (tốn 1 lần sinh vô ích).
    _executeMergeNode(node, workflow, emitLog) {
      const log = (msg, type = 'info') => emitLog(msg, type);
      let text = '';
      try { const c = this._combineUpstreamTexts(node, workflow); text = (c && c.text) || ''; }
      catch (e) { log('Merge: lỗi gom text upstream: ' + e.message, 'warn'); }

      const inEdges = (workflow?.edges || []).filter((e) => e.target_node_id === node.node_id);
      const fileIds = [];
      const pushId = (id) => { const s = String(id).trim(); if (s && !fileIds.includes(s)) fileIds.push(s); };
      for (const e of inEdges) {
        const src = (workflow?.nodes || []).find((n) => n.node_id === e.source_node_id);
        const raw = src?.result_file_ids;
        if (typeof raw === 'string' && raw.trim()) raw.split(',').forEach(pushId);
        else if (Array.isArray(raw)) raw.forEach(pushId);
      }

      node.result_text = text;
      node.result_file_ids = fileIds.join(', ');
      node.result_source = 'merge';
      log(`Merge: gộp ${inEdges.length} input → ${text.length} chars text + ${fileIds.length} file (pass-through, KHÔNG sinh ảnh).`);
      return { success: true, text };
    }

    // [Phase 5 — D1 batch] Gom danh sách scene/item từ upstream của 1 node generate: đọc
    // result_scenes[] (prompt_sequence) hoặc result_items[] (variant_expand/loop) của các node nguồn
    // nối vào (port text/default/in). Trả mảng string prompt để submit N lần sinh; null nếu < 2 item
    // (khi đó generate chạy bình thường với node.prompt gộp). Pure read — không mutate.
    _collectUpstreamBatchPrompts(node, workflow) {
      try {
        const edges = (workflow?.edges || []).filter((e) => {
          if (e.target_node_id !== node.node_id) return false;
          const p = e.target_port;
          return !p || p === 'default' || p === 'text' || p === 'in';
        });
        const items = [];
        for (const e of edges) {
          const src = (workflow?.nodes || []).find((n) => n.node_id === e.source_node_id);
          if (!src) continue;
          const arr = (Array.isArray(src.result_scenes) && src.result_scenes.length) ? src.result_scenes
            : ((Array.isArray(src.result_items) && src.result_items.length) ? src.result_items : null);
          if (!arr) continue;
          for (const it of arr) {
            const s = (typeof it === 'string' ? it : (it && (it.text || it.prompt || it.content) || '')).trim();
            if (s) items.push(s);
          }
        }
        return items.length >= 2 ? items : null;
      } catch (_) { return null; }
    }

    // TEXT QA NODE — OCR ảnh upstream qua vision provider (pa:generate) + đối chiếu chuỗi mong đợi bằng
    // TextIntegrity → verdict pass/warn/fail. Pass-through ảnh cho downstream. Cần TextIntegrity (sidebar).
    /**
     * Cổng chất lượng: chấm ảnh/video upstream rồi rẽ nhánh đạt/trượt.
     *
     * Trình tự cố tình như vậy để KHÔNG tốn model một cách vô ích:
     *   1) bộ lọc rẻ bằng JS (file hỏng/kích thước bất thường) — chặn được thì dừng luôn;
     *   2) hỏi vision model, ép trả JSON;
     *   3) QualityGate.judge() ra phán quyết (lỗi CRITICAL trượt bất kể điểm).
     * Model không trả được JSON → KHÔNG tự cho qua mà cũng không tự đánh trượt: coi là
     * "không chấm được" và cho đi tiếp nhánh đạt, vì chặn oan còn tệ hơn — nhưng ghi log rõ.
     */
    /**
     * Ghép ảnh: dán ảnh GỐC đè lên ảnh đã outpaint.
     * Đây là bước làm cho yêu cầu "giữ nguyên 100% vùng tâm" trở thành sự thật — bằng
     * code, chứ không bằng cách viết thêm lệnh cấm vào prompt.
     * Hai cổng vào phân biệt rõ vai trò: `base` = ảnh đã mở rộng, `overlay` = ảnh gốc.
     */
    async _executeImageCompositeNode(node, workflow, emitLog) {
      const log = (m, t = 'info') => { try { emitLog(m, t); } catch (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#_executeImageCompositeNode', _e); } };
      const IC = window.ImageComposite;
      if (!IC) {
        const err = new Error('IMAGE_COMPOSITE_UNAVAILABLE: thiếu src/core/ImageComposite.js.');
        err.code = 'IMAGE_COMPOSITE_UNAVAILABLE'; err.noRetry = true;
        throw err;
      }
      const pick = (port) => this._resolveUpstreamThumb(node, workflow, port);
      const baseUrl = pick('base') || pick('input_1');
      const overUrl = pick('overlay') || pick('input_2');
      if (!baseUrl || !overUrl) {
        const err = new Error('IMAGE_COMPOSITE_NEED_TWO: cần ĐỦ 2 ảnh — cổng "Ảnh nền" (đã mở rộng) và "Ảnh gốc".');
        err.code = 'IMAGE_COMPOSITE_NEED_TWO'; err.noRetry = true; node.last_error = 'IMAGE_COMPOSITE_NEED_TWO';
        throw err;
      }
      const out = await IC.paste(baseUrl, overUrl, {
        mode: node.composite_mode === 'center-scale' ? 'center-scale' : 'center',
        feather: Number(node.composite_feather) || 0,
      });
      // check() cần kích thước thật nên chỉ chạy được sau khi ảnh đã tải; paste() đã tải
      // rồi nên ở đây chỉ báo lại phần người dùng cần biết.
      log('Đã dán ảnh gốc đè lên vùng tâm — pixel vùng tâm giữ nguyên.', 'info');
      node.result_composite = out;
      return { dataUrl: out, text: 'Ghép ảnh: xong' };
    }

    async _executeQualityGateNode(node, workflow, emitLog) {
      const log = (m, t = 'info') => { try { emitLog(m, t); } catch (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#_executeQualityGateNode', _e); } };
      const QG = window.QualityGate;
      if (!QG) {
        const err = new Error('QUALITY_GATE_UNAVAILABLE: thiếu src/core/QualityGate.js — kiểm tra script của trang.');
        err.code = 'QUALITY_GATE_UNAVAILABLE'; err.noRetry = true;
        throw err;
      }
      const baseUrl = this._resolveUpstreamThumb(node, workflow);
      if (!baseUrl) {
        const err = new Error('QUALITY_GATE_NO_INPUT: chưa có ảnh/video upstream để chấm.');
        err.code = 'QUALITY_GATE_NO_INPUT'; err.noRetry = true; node.last_error = 'QUALITY_GATE_NO_INPUT';
        throw err;
      }
      this._passThroughUpstreamImage(node, workflow);

      const threshold = typeof node.qa_threshold === 'number' ? node.qa_threshold : 7.5;
      let verdict = QG.cheapPreFilter({ fileSize: node.qa_file_size, width: node.qa_width, height: node.qa_height });

      if (!verdict) {
        const dims = QG.DIMENSIONS.map((d) => `"${d.key}": <0-10>`).join(', ');
        const focus = String(node.qa_focus || '').trim();
        const meta = 'You are a strict quality judge for AI-generated media. Return ONLY minified JSON, no prose:'
          + `{"scores":{${dims}},"issues":[{"severity":"CRITICAL|HIGH|MINOR","note":"..."}]}`
          + ' Use CRITICAL only for defects that make the asset unusable (extra fingers, warped faces, garbled text, wrong subject).'
          + (focus ? ' Pay extra attention to: ' + focus : '');
        let raw = '';
        try {
          const resp = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage({
                action: 'pa:generate', provider: node.qa_provider || 'chatgpt',
                metaPrompt: meta, images: [baseUrl], timeout: node.qa_timeout || 120000,
              }, (r) => { void chrome.runtime.lastError; resolve(r || {}); });
            } catch (_e) { resolve({}); }
          });
          raw = String((resp && (resp.text || resp.result || resp.response)) || '').trim();
        } catch (e) { log('Cổng chất lượng: gọi model lỗi — ' + (e && e.message), 'warn'); }

        let parsed = null;
        try {
          // Model hay bọc JSON trong ```json … ``` → cắt lấy phần trong ngoặc nhọn.
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) parsed = JSON.parse(m[0]);
        } catch (e) { log('Cổng chất lượng: không đọc được JSON từ model — ' + (e && e.message), 'warn'); }

        if (!parsed) {
          log('Cổng chất lượng: KHÔNG chấm được (model không trả JSON) → cho đi tiếp nhánh Đạt.', 'warn');
          verdict = { pass: true, score: null, verdict: 'unjudged', action: 'accept', label: 'Không chấm được', critical: [], reasons: [] };
        } else {
          verdict = QG.judge(parsed.scores, parsed.issues, { threshold });
        }
      }

      node.qa_score = verdict.score;
      node.qa_verdict = verdict.verdict;
      node.qa_action = verdict.action;
      node.result_text = `Cổng chất lượng: ${verdict.pass ? 'ĐẠT' : 'TRƯỢT'}`
        + (verdict.score != null ? ` (${verdict.score}/10)` : '') + ` — ${verdict.label}`
        + (verdict.critical.length ? ' · nghiêm trọng: ' + verdict.critical.join('; ') : '');
      node.result_source = 'quality_gate';
      log(node.result_text, verdict.pass ? 'info' : 'warn');
      if (!verdict.pass) log('Đề xuất: ' + verdict.action, 'warn');

      // Rẽ nhánh: skip toàn bộ hạ lưu của cổng KHÔNG được chọn (dùng chung cơ chế condition).
      this._skipInactiveBranch(node, workflow, verdict.pass ? 'pass' : 'fail', verdict.pass ? 'fail' : 'pass');
      node._active_branch = verdict.pass ? 'pass' : 'fail';
      node.result_active_branch = node._active_branch;
      return { text: node.result_text, activeBranch: node._active_branch };
    }

    async _executeTextQaNode(node, workflow, emitLog) {
      const log = (m, t = 'info') => emitLog(m, t);
      const baseUrl = this._resolveUpstreamThumb(node, workflow);
      if (!baseUrl) { log('Text QA: thiếu ảnh upstream — nối 1 node ảnh vào.', 'warn'); throw new Error('TEXT_QA_NO_IMAGE'); }
      this._passThroughUpstreamImage(node, workflow); // ảnh đi tiếp xuống download/downstream

      const expected = String(node.expected_text || node.text || '').trim();
      const provider = node.qa_provider || 'chatgpt';
      const ocrPrompt = 'Read ALL text visible in this image and return ONLY the text verbatim (exact characters, keep line breaks). If there is no text, return nothing. No explanation.';
      let ocr = '';
      try {
        const resp = await new Promise((resolve) => {
          try { chrome.runtime.sendMessage({ action: 'pa:generate', provider, metaPrompt: ocrPrompt, images: [baseUrl], timeout: node.qa_timeout || 120000 }, (r) => { void chrome.runtime.lastError; resolve(r || {}); }); }
          catch (_) { resolve({}); }
        });
        ocr = String((resp && (resp.text || resp.result || resp.response)) || '').trim();
      } catch (e) { log('Text QA: gọi OCR lỗi: ' + (e && e.message), 'warn'); }

      const TI = (typeof self !== 'undefined' && self.TextIntegrity) || (typeof window !== 'undefined' && window.TextIntegrity);
      let verdict = 'info', summary;
      if (expected && TI && TI.compare) {
        const r = TI.compare(expected, ocr, { expectNoDiacritics: node.qa_no_diacritics === true });
        verdict = r.verdict; summary = TI.summary ? TI.summary(r) : verdict; node.qa_issues = r.issues;
      } else {
        summary = ocr ? ('OCR: "' + ocr.slice(0, 40) + '"') : 'không đọc được chữ (hoặc chưa nhập expected_text)';
      }
      // Lint tự nhiên tiếng Việt trên chữ đọc được (bổ sung compare chính tả) — additive, guarded.
      try {
        const VL = (typeof self !== 'undefined' && self.VietnameseLint) || (typeof window !== 'undefined' && window.VietnameseLint);
        if (VL && VL.check && ocr) {
          const lint = VL.check(ocr);
          if (lint.length) { node.qa_vn_lint = lint; summary += ' · VN: ' + VL.summary(lint); }
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#log', _); }
      node.qa_verdict = verdict; node.qa_ocr = ocr;
      node.result_text = 'Text QA: ' + verdict.toUpperCase() + ' — ' + summary;
      node.result_source = 'text_qa';
      log('Text QA: ' + verdict.toUpperCase() + ' — ' + summary, verdict === 'fail' ? 'warn' : 'info');
      return { success: true };
    }

    // STYLE ANCHOR NODE — chèn 1 khối "phong cách" (palette/chất liệu/ánh sáng) vào MỌI prompt đi qua,
    // để loạt ảnh nhiều cảnh không bị "trôi" phong cách. Trước đây chỉ có trang xem rời, người dùng
    // phải tự copy-dán từng prompt; giờ workflow tự áp cho cả batch.
    /**
     * Text Export — gom text upstream rồi ghi ra FILE qua chrome.downloads (background 'chromeDownload').
     * Bù cho node `download` vốn chỉ nhận media. Dùng để lưu script_manifest / asset list / kịch bản.
     */
    /**
     * Bảng thực thể. Nhận ảnh gốc từ upstream, ghép theo THỨ TỰ vào danh sách thực thể,
     * rồi trả về: ảnh (pass-through cho cổng ref của node gen) + khối CAST (text cho
     * node prompt). Thiếu ảnh gốc thì DỪNG — gen tiếp chỉ ra sai nhân vật và tốn credit.
     */
    async _executeEntityRefNode(node, workflow, emitLog) {
      const log = (m, t = 'info') => { try { emitLog(m, t); } catch (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#_executeEntityRefNode', _e); } };
      const ES = window.EntitySheet;
      if (!ES) {
        const err = new Error('ENTITY_SHEET_UNAVAILABLE: thiếu src/core/EntitySheet.js — kiểm tra script của trang.');
        err.code = 'ENTITY_SHEET_UNAVAILABLE'; err.noRetry = true;
        throw err;
      }

      const entities = ES.parse(node.entities);
      if (!entities.length) {
        const err = new Error('ENTITY_REF_EMPTY: chưa khai thực thể nào. Mỗi dòng: Tên | loại | mô tả.');
        err.code = 'ENTITY_REF_EMPTY'; err.noRetry = true; node.last_error = 'ENTITY_REF_EMPTY';
        throw err;
      }
      const dup = ES.duplicateNames(entities);
      if (dup.length) {
        // Trùng tên thì prompt gọi tên trở nên nhập nhằng — không tự đổi tên hộ.
        const err = new Error('ENTITY_REF_DUPLICATE: trùng tên thực thể (' + dup.join(', ') + '). Đặt tên khác nhau.');
        err.code = 'ENTITY_REF_DUPLICATE'; err.noRetry = true; node.last_error = 'ENTITY_REF_DUPLICATE';
        throw err;
      }

      let fileIds = [];
      try { fileIds = this._collectInputFileIds(node, workflow) || []; }
      catch (e) { console.warn('[WorkflowExecutor] entity_ref: gom ảnh upstream lỗi →', e?.message); }

      const cov = ES.checkCoverage(entities, fileIds.length);
      if (!cov.ok) {
        const err = new Error('ENTITY_REF_INCOMPLETE: thiếu ảnh gốc cho ' + cov.missing.join(', ')
          + ' (' + cov.covered + '/' + cov.total + '). Gen đủ ảnh gốc rồi mới chạy cảnh.');
        err.code = 'ENTITY_REF_INCOMPLETE'; err.noRetry = true; node.last_error = 'ENTITY_REF_INCOMPLETE';
        throw err;
      }

      const bound = ES.bind(entities, fileIds);
      const cast = ES.castBlock(entities, { label: node.entity_label || 'CAST' });
      log(`Bảng thực thể: ${cov.total} thực thể, đủ ảnh gốc.`, 'info');
      bound.forEach((b) => log(`• ${b.name} (${b.type})`, 'info'));

      // Ảnh đi tiếp nguyên vẹn để nối vào cổng ref; khối CAST đi qua result_text.
      node.entity_bound = bound;
      return { fileIds, text: cast, entities: bound };
    }

    async _executeTextExportNode(node, workflow, emitLog) {
      const log = (m, t = 'info') => { try { emitLog(m, t); } catch (_) { /* emitLog chữ ký khác nhau giữa các nhánh gọi */ } };

      let combined = null;
      try { combined = this._combineUpstreamTexts(node, workflow); }
      catch (e) { console.warn('[WorkflowExecutor] text_export: gom text upstream lỗi →', e?.message); }
      const text = String((combined && combined.text) || '').trim();
      if (!text) {
        const err = new Error('TEXT_EXPORT_EMPTY: không có text upstream — nối 1 node AI Agent/Text phía trước.');
        err.code = 'EMPTY_UPSTREAM'; err.noRetry = true; node.last_error = 'TEXT_EXPORT_EMPTY';
        throw err;
      }

      // Tên file: field của node → mặc định theo tên node. Chỉ giữ ký tự an toàn.
      const rawName = String(node.export_file_name || node.node_name || 'export').trim();
      let base = rawName.replace(/[\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 80) || 'export';
      const ext = String(node.export_format || 'json').toLowerCase();
      const okExt = ['json', 'txt', 'md', 'csv'].includes(ext) ? ext : 'json';
      if (!base.toLowerCase().endsWith('.' + okExt)) base += '.' + okExt;

      // JSON: cố gắng format cho dễ đọc; không parse được thì ghi nguyên văn (KHÔNG nuốt lỗi im lặng).
      let body = text;
      if (okExt === 'json') {
        try { body = JSON.stringify(JSON.parse(text), null, 2); }
        catch (e) { log(`Text Export: nội dung không phải JSON hợp lệ (${e?.message}) → ghi nguyên văn.`, 'warn'); }
      }

      const dataUrl = 'data:application/octet-stream;base64,' + btoa(unescape(encodeURIComponent(body)));
      const filename = `SEOSONA Flow/${base}`;

      const resp = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ action: 'chromeDownload', url: dataUrl, filename }, (r) => {
            if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
            else resolve(r || { ok: false, error: 'NO_RESPONSE' });
          });
        } catch (e) { resolve({ ok: false, error: e?.message }); }
      });
      if (!resp || resp.ok === false) {
        const err = new Error('TEXT_EXPORT_FAILED: ' + (resp?.error || 'không tải được file'));
        err.code = 'TEXT_EXPORT_FAILED'; node.last_error = err.message;
        throw err;
      }

      node.result_text = text;
      node.result_source = 'text_export';
      log(`Text Export: đã ghi ${body.length.toLocaleString('vi-VN')} ký tự → ${filename}`);
      return { success: true };
    }

    async _executeStyleAnchorNode(node, workflow, emitLog) {
      const log = (m, t = 'info') => emitLog(m, t);
      const SA = (typeof self !== 'undefined' && self.StyleAnchor) || (typeof window !== 'undefined' && window.StyleAnchor);
      if (!SA || !SA.inject) { log('Style Anchor: module chưa load.', 'warn'); throw new Error('STYLE_ANCHOR_UNAVAILABLE'); }

      const block = String(node.anchor_block || node.text || '').trim();
      if (!block) { log('Style Anchor: chưa nhập khối phong cách (anchor_block).', 'warn'); throw new Error('STYLE_ANCHOR_NO_BLOCK'); }

      const label = String(node.anchor_label || 'STYLE').trim() || 'STYLE';
      const position = node.anchor_position === 'append' ? 'append' : 'prepend';

      // Gom prompt từ upstream (cùng helper mà các node text khác dùng).
      let combined = null;
      // Nuốt im → báo "không có prompt upstream" trong khi lỗi thật nằm ở khâu gom text.
      try { combined = this._combineUpstreamTexts(node, workflow); }
      catch (e) { console.warn('[WorkflowExecutor] style_anchor: gom text upstream lỗi →', e?.message); }
      const raw = String((combined && combined.text) || '').trim();
      if (!raw) { log('Style Anchor: không có prompt upstream — nối 1 node Prompt/Text vào.', 'warn'); throw new Error('STYLE_ANCHOR_NO_INPUT'); }

      // Nhiều prompt cách nhau bằng dòng trống → áp anchor cho TỪNG prompt (đúng ý "cả loạt nhất quán").
      const parts = raw.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
      const out = (SA.applyToMany ? SA.applyToMany(parts, block, { label, position })
        : parts.map((p) => SA.inject(p, block, { label, position })));

      node.result_text = out.join('\n\n');
      node._effective_prompt = node.result_text;
      node.result_source = 'style_anchor';
      node.anchor_applied = out.length;

      // Tự kiểm: khối anchor phải thật sự có mặt trong kết quả (bắt lỗi im lặng).
      let coverage = 1;
      try { if (SA.check) coverage = (SA.check(out[0] || '', block) || {}).coverage ?? 1; } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#log', _); }
      log(`Style Anchor: áp khối "${label}" cho ${out.length} prompt` + (coverage < 1 ? ` (cảnh báo: chỉ khớp ${Math.round(coverage * 100)}% dòng)` : ''), coverage < 1 ? 'warn' : 'info');
      return { success: true };
    }

    // Pass-through ảnh kết quả từ node ảnh upstream sang node hiện tại (cho download/downstream tiêu thụ).
    _passThroughUpstreamImage(node, workflow) {
      const edges = (workflow?.edges || []).filter((e) => e.target_node_id === node.node_id);
      for (const e of edges) {
        const src = (workflow?.nodes || []).find((n) => n.node_id === e.source_node_id);
        if (src && src.result_thumbnails && Object.keys(src.result_thumbnails).length) {
          node.result_thumbnails = { ...src.result_thumbnails };
          node.result_file_ids = src.result_file_ids;
          if (src.result_provider_urls) node.result_provider_urls = { ...src.result_provider_urls };
          return;
        }
      }
    }

    // TEXT OVERLAY NODE — overlay chữ VECTOR (TextOverlay, deterministic) lên ảnh upstream → xuất ảnh
    // mới (result_thumbnails) + tự lưu file. Chữ do code dựng (font) nên chính tả/dấu/ngắt-dòng luôn
    // đúng (diệt "rớt chữ/rớt dòng" của image model). Chạy trong context có TextOverlay (sidebar).
    async _executeTextOverlayNode(node, workflow, emitLog) {
      const log = (msg, type = 'info') => emitLog(msg, type);
      const TO = (typeof self !== 'undefined' && self.TextOverlay) || (typeof window !== 'undefined' && window.TextOverlay);
      if (!TO || !TO.render) { log('Text Overlay: module TextOverlay chưa load (chỉ chạy ở sidebar)', 'warn'); throw new Error('TEXT_OVERLAY_UNAVAILABLE'); }
      const baseUrl = this._resolveUpstreamThumb(node, workflow);
      if (!baseUrl) { log('Text Overlay: thiếu ảnh nền — nối 1 node generate/image vào port "Ảnh nền"', 'warn'); throw new Error('TEXT_OVERLAY_NO_IMAGE'); }
      let text = String(node.overlay_text || node.text || '').trim();
      // Nuot im -> text_overlay im lang khong ve chu, khong ai biet vi sao.
      if (!text) {
        try { const c = this._combineUpstreamTexts(node, workflow); text = String((c && c.text) || '').trim(); }
        catch (e) { console.warn('[WorkflowExecutor] text_overlay: gom text upstream loi ->', e?.message); }
      }
      if (!text) { log('Text Overlay: thiếu chữ — nối 1 node Text hoặc nhập overlay_text', 'warn'); throw new Error('TEXT_OVERLAY_NO_TEXT'); }

      const dim = await this._imageDims(baseUrl);
      const pos = node.overlay_pos || 'center';
      const pad = dim.w * 0.08;
      const zone = pos === 'top' ? { x: pad, y: dim.h * 0.05, w: dim.w - pad * 2, h: dim.h * 0.25 }
        : pos === 'bottom' ? { x: pad, y: dim.h * 0.70, w: dim.w - pad * 2, h: dim.h * 0.25 }
          : { x: pad, y: dim.h * 0.35, w: dim.w - pad * 2, h: dim.h * 0.30 };
      const item = {
        text, zone, mode: node.overlay_mode || 'heading', align: node.overlay_align || 'center',
        color: node.overlay_color || '#ffffff', size: parseInt(node.overlay_size, 10) || Math.round(dim.h * 0.12),
        valign: 'middle', pairs: node.overlay_pairs,
      };
      let dataUrl;
      try { dataUrl = await TO.render(baseUrl, [item], {}); }
      catch (e) { log('Text Overlay: render lỗi: ' + (e && e.message), 'warn'); throw e; }

      // Nhúng SPEC vào PNG (tái lập — pattern ComfyUI): ảnh export tự mô tả. Best-effort, guarded.
      try {
        const spec = JSON.stringify({ app: 'seosona-flow', tool: 'text_overlay', text: text, overlay: { pos: pos, mode: item.mode, align: item.align, color: item.color, size: item.size }, dim: dim });
        const withMeta = this._embedPngSpec(dataUrl, spec);
        if (withMeta) dataUrl = withMeta;
      } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#log', _); }

      const fid = 'txo_' + ((window.IdGenerator && window.IdGenerator.next && window.IdGenerator.next('img')) || Date.now());
      node.result_thumbnails = { ...(node.result_thumbnails || {}), [fid]: { url: dataUrl, type: 'image' } };
      node.result_file_ids = fid;
      node.result_source = 'text_overlay';

      if (node.overlay_download !== false) {
        try { await this._downloadLocalDataUrl(dataUrl, this._sanitizeName(node.node_name || 'text-overlay') + '.png'); }
        catch (e) { log('Text Overlay: lưu file lỗi (kết quả vẫn có trong node): ' + (e && e.message), 'warn'); }
      }
      log(`Text Overlay: overlay "${text.slice(0, 24)}" lên ảnh → xong (${dim.w}×${dim.h}).`, 'info');
      return { success: true };
    }

    // Nhúng chuỗi spec JSON vào PNG dataURL (PngText tEXt chunk) → trả dataURL mới. null nếu lỗi/không phải PNG.
    _embedPngSpec(dataUrl, specJson) {
      try {
        const PNGT = (typeof self !== 'undefined' && self.PngText) || (typeof window !== 'undefined' && window.PngText);
        if (!PNGT || !PNGT.insertText || typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/png') !== 0) return null;
        const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const out = PNGT.insertText(bytes, PNGT.SPEC_KEY, specJson);
        if (out === bytes) return null;
        let s = ''; for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
        return 'data:image/png;base64,' + btoa(s);
      } catch (_) { return null; }
    }

    // Lấy 1 ảnh dataURL/blob từ node ảnh upstream (nối vào) qua result_thumbnails (same-origin, composite được).
    /**
     * @param {string} [port] chỉ nhận ảnh vào ĐÚNG cổng này. Bỏ trống = bất kỳ cổng nào
     *   (hành vi cũ, mọi nơi đang gọi đều giữ nguyên). Node 2 cổng vào như image_composite
     *   BẮT BUỘC phân biệt: lấy nhầm cổng thì dán ngược, ảnh gốc thành nền.
     */
    _resolveUpstreamThumb(node, workflow, port) {
      let edges = (workflow?.edges || []).filter((e) => e.target_node_id === node.node_id);
      if (port) edges = edges.filter((e) => (e.target_port || 'input_1') === port);
      for (const e of edges) {
        const src = (workflow?.nodes || []).find((n) => n.node_id === e.source_node_id);
        const th = src && src.result_thumbnails;
        if (th && typeof th === 'object') {
          for (const k of Object.keys(th)) {
            const v = th[k]; const u = (v && (v.url || v.thumbnail)) || (typeof v === 'string' ? v : null);
            if (typeof u === 'string' && (u.startsWith('data:') || u.startsWith('blob:'))) return u;
          }
        }
      }
      return null;
    }

    _imageDims(url) {
      return new Promise((resolve) => {
        try { const im = new Image(); im.onload = () => resolve({ w: im.width || 1024, h: im.height || 1024 }); im.onerror = () => resolve({ w: 1024, h: 1024 }); im.src = url; }
        catch (_) { resolve({ w: 1024, h: 1024 }); }
      });
    }

    _sanitizeName(s) { return String(s || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60); }

    // Lưu 1 dataURL ra file: dataURL → blob → blob-URL → background 'chromeDownload' (reject dataURL nên phải blob).
    async _downloadLocalDataUrl(dataUrl, filename) {
      const blob = await (await fetch(dataUrl)).blob();
      const objUrl = (window.BlobUrlManager && window.BlobUrlManager.create) ? window.BlobUrlManager.create(blob) : URL.createObjectURL(blob);
      const dlUrl = await this._scrubForDownload(objUrl);
      await new Promise((resolve) => {
        try { chrome.runtime.sendMessage({ action: 'chromeDownload', url: dlUrl, filename }, () => { void chrome.runtime.lastError; resolve(); }); }
        catch (_) { resolve(); }
      });
    }

    // Phase 3 (n8n pipeline): Prompt Sequence / Scene Splitter — tách 1 blob nhiều scene (từ AI Agent
    // hoặc paste) thành DANH SÁCH scene-prompt đánh số. Pure string (KHÔNG gọi AI/backend). Lưu
    // node.result_scenes[] (cho node loop/batch tương lai) + node.result_text (numbered join, feed
    // downstream text ngay). Tự phát hiện "visual bible" preamble → prepend vào MỌI scene (nhất quán).
    _executePromptSequenceNode(node, workflow, emitLog) {
      const log = (msg, type = 'info') => emitLog(msg, type);
      let combined = null;
      try { combined = this._combineUpstreamTexts(node, workflow); }
      catch (e) { log('Lỗi gom text upstream: ' + e.message, 'warn'); }
      const raw = ((combined && combined.text) || '').trim();
      if (!raw) {
        const err = new Error('PROMPT_SEQUENCE_EMPTY: không có text upstream — nối 1 node AI Agent/Text phía trước.');
        err.code = 'EMPTY_UPSTREAM'; err.noRetry = true; node.last_error = 'PROMPT_SEQUENCE_EMPTY';
        throw err;
      }
      const mode = node.split_mode || 'auto';
      const sep = node.split_separator || '---';
      const maxScenes = parseInt(node.max_scenes, 10) || 0;
      const prefix = node.scene_prefix || '';
      const suffix = node.scene_suffix || '';

      const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isLabeled = (s) => /^\s*(?:\[?\s*(?:scene|panel|shot|c[ảa]nh|khung)\s*\d+|\d{1,3}\s*[.)\]:–-])/i.test(s);
      const stripLabel = (s) => String(s || '').replace(/^\s*(?:\[?\s*(?:scene|panel|shot|c[ảa]nh|khung)\s*\d+\s*\]?\s*[:.)–-]?\s*|\d{1,3}\s*[.)\]:–-]\s*)/i, '');
      const bySep = (txt, s) => txt.split(new RegExp('\\n?\\s*' + escRe(s) + '\\s*\\n?', 'g'));
      const byNumbered = (txt) => txt.split(/\n(?=\s*(?:\[?\s*(?:scene|panel|shot|c[ảa]nh|khung)\s*\d+|\d{1,3}\s*[.)\]:–-])\s*)/i);
      const byLines = (txt) => txt.split(/\n+/);

      let parts;
      if (mode === 'separator') parts = bySep(raw, sep || '---');
      else if (mode === 'lines') parts = byLines(raw);
      else if (mode === 'numbered') parts = byNumbered(raw);
      else { // auto: separator '---' → numbered → blank-line paragraph → lines
        parts = raw.indexOf('---') >= 0 ? bySep(raw, '---') : [raw];
        if (parts.length < 2) { const n = byNumbered(raw); if (n.length >= 2) parts = n; }
        if (parts.length < 2) { const p = raw.split(/\n\s*\n+/); if (p.length >= 2) parts = p; }
        if (parts.length < 2) parts = byLines(raw);
      }
      parts = parts.map((s) => s.trim()).filter(Boolean);

      // Preamble (visual bible): part đầu KHÔNG có label nhưng các part sau CÓ → dùng chung cho mọi scene.
      let preamble = '';
      if ((mode === 'numbered' || mode === 'auto') && parts.length >= 2 &&
          !isLabeled(parts[0]) && parts.slice(1).some(isLabeled)) {
        preamble = parts.shift();
        log('Prompt Sequence: phát hiện visual-bible preamble → áp vào mọi scene (nhất quán).');
      }

      let scenes = parts.map((s) => stripLabel(s).trim()).filter(Boolean);
      if (maxScenes > 0 && scenes.length > maxScenes) scenes = scenes.slice(0, maxScenes);
      scenes = scenes.map((body) =>
        (prefix + (preamble ? preamble + '\n' : '') + body + suffix).trim()
      );

      if (!scenes.length) {
        const err = new Error('PROMPT_SEQUENCE_NO_SCENE: không tách được scene nào từ input.');
        err.code = 'EMPTY_UPSTREAM'; err.noRetry = true; node.last_error = 'PROMPT_SEQUENCE_NO_SCENE';
        throw err;
      }
      node.result_scenes = scenes;
      node.result_text = scenes.map((s, i) => (i + 1) + '. ' + s).join('\n\n');
      node.result_source = 'prompt_sequence';
      log(`Prompt Sequence: tách ${scenes.length} scene (mode=${mode}).`);
      return { success: true, text: node.result_text, scenes: scenes };
    }

    // Variant Expand — nhân 1 prompt gốc × danh sách modifier → N biến thể prompt (pure string, KHÔNG gọi AI).
    // Modifier từ node.variants (mỗi dòng/dấu phẩy 1 cái) HOẶC preset node.variant_preset
    // (ratios/styles/angles/lighting). Lưu result_scenes[]/result_items[] (loop→batch generate tiêu thụ như
    // prompt_sequence) + result_text (numbered join, feed downstream text ngay). Dùng để "1 concept → N ratio/style/góc".
    _executeVariantExpandNode(node, workflow, emitLog) {
      const log = (msg, type = 'info') => emitLog(msg, type);
      let combined = null;
      try { combined = this._combineUpstreamTexts(node, workflow); }
      catch (e) { log('Lỗi gom text upstream: ' + e.message, 'warn'); }
      // Clear stale ngay đầu: node fail (throw dưới) KHÔNG để downstream loop đọc biến thể của lần chạy trước.
      node.result_scenes = []; node.result_items = []; node.result_text = ''; node.result_source = '';
      const base = ((combined && combined.text) || node.prompt || '').trim();
      if (!base) {
        const err = new Error('VARIANT_EXPAND_EMPTY: không có prompt gốc — nối 1 node Prompt/Text phía trước hoặc nhập prompt.');
        err.code = 'EMPTY_UPSTREAM'; err.noRetry = true; node.last_error = 'VARIANT_EXPAND_EMPTY';
        throw err;
      }
      const PRESETS = {
        ratios: ['aspect ratio 1:1', 'aspect ratio 4:5', 'aspect ratio 9:16', 'aspect ratio 16:9'],
        styles: ['photorealistic', 'cinematic film still', 'minimalist studio', 'vibrant editorial illustration'],
        angles: ['front three-quarter view', 'side profile view', 'top-down flat lay', 'close-up macro detail'],
        lighting: ['soft natural daylight', 'dramatic rim light', 'warm golden-hour light', 'high-key studio light'],
      };
      let mods = [];
      const raw = (node.variants || '').trim();
      // Newline-primary: nếu nhập nhiều dòng → tách theo dòng (giữ nguyên dấu phẩy TRONG 1 modifier như
      // "warm, soft light"); chỉ khi input 1 dòng mới tách theo dấu phẩy (tiện gõ nhanh "a, b, c").
      if (raw) mods = (raw.indexOf('\n') >= 0 ? raw.split(/\r?\n+/) : raw.split(',')).map((s) => s.trim()).filter(Boolean);
      else if (node.variant_preset && PRESETS[node.variant_preset]) mods = PRESETS[node.variant_preset].slice();
      if (!mods.length) {
        const err = new Error('VARIANT_EXPAND_NO_MODIFIER: chưa có danh sách biến thể — nhập "variants" (mỗi dòng 1 cái) hoặc chọn preset (ratios/styles/angles/lighting).');
        err.code = 'EMPTY_UPSTREAM'; err.noRetry = true; node.last_error = 'VARIANT_EXPAND_NO_MODIFIER';
        throw err;
      }
      const maxV = parseInt(node.max_variants, 10) || 0;
      if (maxV > 0 && mods.length > maxV) mods = mods.slice(0, maxV);
      // joiner rỗng '' → dùng default ', ' (tránh dính prompt+modifier khi user lỡ xoá trắng ô).
      const joiner = (typeof node.variant_joiner === 'string' && node.variant_joiner !== '') ? node.variant_joiner : ', ';
      const variants = mods.map((m) => (base + joiner + m).trim());
      node.result_scenes = variants;
      node.result_items = variants;
      node.result_text = variants.map((s, i) => (i + 1) + '. ' + s).join('\n\n');
      node.result_source = 'variant_expand';
      log(`Variant Expand: ${variants.length} biến thể từ prompt gốc (${base.length} chars).`);
      return { success: true, text: node.result_text, scenes: variants, items: variants };
    }

    // Loop / Batch — chuẩn bị danh sách item để batch generate. Ưu tiên đọc result_scenes[]/result_items[]
    // từ upstream (vd prompt_sequence); fallback tách text upstream. Lưu result_items[] + loop_count.
    // Pure-data: phần "chạy gen N lần" do executor batch xử lý (kích hoạt khi gen sống); node này chuẩn bị.
    _executeLoopNode(node, workflow, emitLog) {
      const log = (msg, type = 'info') => emitLog(msg, type);
      const nodes = (workflow && workflow.nodes) || this.currentWorkflow?.nodes || [];
      const edges = (workflow && workflow.edges) || this.currentWorkflow?.edges || [];
      let items = [];
      // 1) Ưu tiên: đọc mảng đã tách từ upstream (Prompt Sequence lưu result_scenes[]).
      const inEdges = (edges || []).filter(e => e.target_node_id === node.node_id);
      for (const e of inEdges) {
        const src = nodes.find(n => n.node_id === e.source_node_id);
        if (!src) continue;
        if (Array.isArray(src.result_scenes) && src.result_scenes.length) items = items.concat(src.result_scenes);
        else if (Array.isArray(src.result_items) && src.result_items.length) items = items.concat(src.result_items);
      }
      // 2) Fallback: tách text upstream (theo dòng đánh số "1." hoặc theo dòng).
      if (!items.length) {
        let raw = '';
        // Nuốt im → node Loop ném LOOP_EMPTY ("không có item") che mất lỗi gom text thật.
        try { const c = this._combineUpstreamTexts(node, workflow); if (c) raw = (c.text || '').trim(); }
        catch (e) { console.warn('[WorkflowExecutor] loop: gom text upstream lỗi →', e?.message); }
        if (raw) {
          const byNum = raw.split(/\n(?=\s*\d{1,3}\s*[.)\]:–-])/);
          items = (byNum.length >= 2 ? byNum : raw.split(/\n+/))
            .map(s => s.replace(/^\s*\d{1,3}\s*[.)\]:–-]\s*/, '').trim())
            .filter(Boolean);
        }
      }
      const maxItems = parseInt(node.max_items, 10) || 0;
      if (maxItems > 0 && items.length > maxItems) items = items.slice(0, maxItems);
      if (!items.length) {
        const err = new Error('LOOP_EMPTY: không có item — nối 1 node Prompt Sequence hoặc danh sách text phía trước.');
        err.code = 'EMPTY_UPSTREAM'; err.noRetry = true; node.last_error = 'LOOP_EMPTY';
        throw err;
      }
      node.result_items = items;
      node.loop_count = items.length;
      node.result_text = items.map((s, i) => (i + 1) + '. ' + s).join('\n\n');
      node.result_source = 'loop';
      log(`Loop: ${items.length} item sẵn sàng batch generate.`);
      return { success: true, text: node.result_text, items: items };
    }

    _executeTextTemplateNode(node, workflow, emitLog) {
      const log = (msg, type = 'info') => emitLog(msg, type);
      const template = (node.prompt || '').trim();

      let combined = null;
      try { combined = this._combineUpstreamTexts(node, workflow); }
      catch (e) { log('Lỗi gom text upstream: ' + e.message, 'warn'); }
      const sources = (combined && combined.sources) || [];
      const allText = (combined && combined.text) || '';

      // Không có mẫu → nối toàn bộ upstream (merge-text). Rỗng cả hai → fail rõ ràng.
      if (!template) {
        if (!allText) {
          const err = new Error('TEXT_TEMPLATE_EMPTY: không có mẫu và không có text upstream — connect ít nhất 1 node text/prompt vào input.');
          err.code = 'EMPTY_UPSTREAM';
          err.noRetry = true;
          node.last_error = 'TEXT_TEMPLATE_EMPTY';
          throw err;
        }
        node.result_text = allText;
        node.result_source = 'text_template';
        log(`Text Template: không có mẫu → nối ${sources.length} upstream (${allText.length} chars)`);
        return { success: true, text: allText };
      }

      // Interpolate. {{inputN}} và {{input}} disjoint (input\d+ vs input) → thứ tự replace không ảnh hưởng.
      let out = template.replace(/\{\{\s*input(\d+)\s*\}\}/gi, (m, n) => {
        const idx = parseInt(n, 10) - 1;
        return (idx >= 0 && idx < sources.length) ? sources[idx].text : '';
      });
      out = out.replace(/\{\{\s*input\s*\}\}/gi, allText);

      node.result_text = out;
      node.result_source = 'text_template';
      log(`Text Template: mẫu ${template.length} chars + ${sources.length} upstream → ${out.length} chars output`);
      return { success: true, text: out };
    }

    async _executeTextExtractNode(node, workflow, emitLog, startTime) {
      const _now = startTime || Date.now();
      const log = (msg, type = 'info') => emitLog(msg, type);

      // 1. Collect upstream text qua port 'text' (gộp nhiều upstream nếu có)
      let upstreamText = '';
      try {
        const combined = this._combineUpstreamTexts(node, workflow);
        if (combined && combined.text) {
          upstreamText = combined.text;
          log(`Text Extract: nhận ${combined.text.length} chars text từ ${combined.sources.length} upstream(s)`);
          // 2026-05-31 diagnostic: log SAMPLE upstream text để debug truncation issues
          // (vd: AI response captured incomplete → text_extract sees less than expected).
          console.log(`[TextExtract] "${node.node_name}" upstream text len=${combined.text.length} | first 200: ${JSON.stringify(combined.text.substring(0, 200))} | last 200: ${JSON.stringify(combined.text.substring(combined.text.length - 200))}`);
        }
      } catch (e) {
        log(`Lỗi collect upstream text: ${e.message}`, 'warn');
      }

      if (!upstreamText) {
        // Fallback: thử lấy result_text trực tiếp từ upstream edges (nếu _combineUpstreamTexts miss)
        // 2026-06-02: Server control — backend sort edges theo pos_y/pos_x, frontend trust order.
        const inputEdges = (workflow.edges || []).filter(e => e.target_node_id === node.node_id);
        for (const edge of inputEdges) {
          const src = (workflow.nodes || []).find(n => n.node_id === edge.source_node_id);
          if (src?.result_text) {
            upstreamText += (upstreamText ? '\n' : '') + src.result_text;
          } else if (src?.prompt) {
            upstreamText += (upstreamText ? '\n' : '') + src.prompt;
          }
        }
      }

      if (!upstreamText) {
        const err = new Error('Text Extract: upstream text rỗng — chưa connect text input hoặc upstream chưa execute');
        err.code = 'EMPTY_UPSTREAM';
        throw err;
      }

      // 2. Đọc config (fallback safe defaults)
      const mode = node.extract_mode || 'marker';
      const marker = (node.extract_marker || '').trim();
      const customRegex = (node.extract_regex || '').trim();
      const strict = node.extract_strict === true;
      const multiMatch = node.extract_multi_match || 'first';
      const onFail = node.extract_on_fail || 'skip_downstream';

      // 3. Execute theo mode
      try {
        let extractedText = null;

        if (mode === 'json') {
          // JSON parse + key lookup. Tolerant: strip markdown code block fence ```json ```
          if (!marker) {
            throw new Error('JSON key (extract_marker) rỗng');
          }
          let parsed;
          try {
            const cleaned = upstreamText.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
            parsed = JSON.parse(cleaned);
          } catch (e) {
            throw new Error(`Upstream không phải JSON hợp lệ: ${e.message}`);
          }
          const value = parsed && parsed[marker];
          if (value === undefined || value === null) {
            return this._handleExtractFail(node, `JSON key '${marker}' không tồn tại trong upstream`, onFail, _now, log);
          }
          extractedText = typeof value === 'string' ? value : JSON.stringify(value);
          log(`Text Extract JSON key '${marker}' → ${extractedText.length} chars`);
        } else {
          // marker hoặc regex mode: build RegExp
          let regex;
          if (mode === 'regex') {
            if (!customRegex) throw new Error('Custom regex (extract_regex) rỗng');
            try {
              regex = new RegExp(customRegex, strict ? 'g' : 'gi');
            } catch (e) {
              throw new Error(`Regex pattern invalid: ${e.message}`);
            }
          } else { // marker
            if (!marker) throw new Error('Marker name (extract_marker) rỗng');
            // Escape regex special chars trong marker user-input
            const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Non-strict: tolerate _, space, dash giữa words (image_prompt_1 = image-prompt-1 = image prompt 1)
            const flexibleMarker = strict ? escapedMarker : escapedMarker.replace(/[_\s\\-]/g, '[_\\s-]*');
            // Match `[marker]:value` hoặc `[marker] value` lazy → next `\n[word` hoặc end-of-string
            const pattern = `\\[${flexibleMarker}\\]\\s*:?\\s*([\\s\\S]+?)(?=\\n\\s*\\[\\w|$)`;
            regex = new RegExp(pattern, strict ? 'g' : 'gi');
          }

          const matches = [...upstreamText.matchAll(regex)];
          if (matches.length === 0) {
            return this._handleExtractFail(node, `Không tìm thấy marker '${marker || customRegex}' trong upstream output`, onFail, _now, log);
          }

          // Multi-match handling
          if (matches.length > 1 && multiMatch === 'error') {
            throw new Error(`Text Extract: tìm thấy ${matches.length} matches cho '${marker || 'regex'}' — mode 'error'`);
          }
          const extractGroup = (m) => ((m && (m[1] || m[m.length - 1] || m[0])) || '').trim();
          if (multiMatch === 'last') {
            extractedText = extractGroup(matches[matches.length - 1]);
          } else if (multiMatch === 'concat') {
            extractedText = matches.map(extractGroup).join('\n\n');
          } else { // first (default)
            extractedText = extractGroup(matches[0]);
          }
          log(`Text Extract '${marker}' → ${extractedText.length} chars (${matches.length} match${matches.length > 1 ? 'es' : ''}, mode=${multiMatch})`);
        }

        // 2026-05-31: normalize extracted text — compact mode (strip cả leading per line)
        // vì output text_extract dùng làm prompt cho downstream, không cần preserve indent.
        extractedText = this._normalizeExtractedText(extractedText, { compact: true });

        // 2026-05-31: matches.length > 0 nhưng capture group RỖNG (vd AI viết
        // `[image_prompt_1]\n[image_prompt_2]` — marker liền nhau, content rỗng)
        // → treat as extract failure để downstream skip rõ ràng thay vì throw EMPTY_UPSTREAM_PROMPT.
        if (!extractedText || !extractedText.trim()) {
          return this._handleExtractFail(node, `Marker '${marker || customRegex}' match được nhưng content RỖNG (AI có thể viết marker liền nhau không có nội dung)`, onFail, _now, log);
        }

        // 4. Build result — set node.result_text + result_source cho mention resolution downstream
        node.result_text = extractedText;
        node.result_source = 'extract';
        // Clear extract_failed nếu trước đó có (re-run sau khi fix upstream)
        delete node._extract_failed;
        delete node._extract_reason;

        return {
          fileIds: [],
          duration: Date.now() - _now,
          thumbnails: {},
          fileNames: {},
          result_text: extractedText,
          result_source: 'extract',
        };
      } catch (err) {
        // Config error / regex parse fail → propagate (workflow fail)
        if (err.code !== 'EXTRACT_HANDLED') {
          throw err;
        }
        return this._handleExtractFail(node, err.message, onFail, _now, log);
      }
    }

    /**
     * 2026-05-31: Normalize text extracted để output gọn gàng (compact mode).
     *  - Trim leading + trailing whitespace mỗi dòng (KHÔNG giữ indent — AI thường thêm
     *    indent dư khi format multi-line, user muốn gọn)
     *  - Collapse 3+ newlines liên tiếp về 2 (max 1 blank line giữa các đoạn)
     *  - Trim leading/trailing blank lines + whitespace overall
     *  - Handle NBSP ( ) + zero-width characters cũng
     *
     * Note: per-line leading whitespace strip phá indent code/markdown — chấp nhận trade-off
     * cho text_extract use case (output dùng làm prompt cho downstream, không cần format).
     */
    _normalizeExtractedText(text, opts = {}) {
      if (typeof text !== 'string' || !text) return text || '';
      const compact = opts.compact === true;
      return text
        // Normalize line endings CRLF → LF
        .replace(/\r\n/g, '\n')
        // Normalize NBSP → space (AI/copy-paste thường chèn)
        .replace(/ /g, ' ')
        // Remove zero-width chars (BOM, ZWSP, ZWNJ, ZWJ)
        .replace(/[​-‍﻿]/g, '')
        // Trim per line: compact=true strip cả leading+trailing (text_extract — gọn),
        // compact=false chỉ strip trailing (prompt AI — giữ indent markdown/code/list)
        .split('\n').map(line => compact ? line.trim() : line.replace(/[ \t]+$/, '')).join('\n')
        // Collapse 3+ \n consecutive → 2 \n (= max 1 blank line between paragraphs)
        .replace(/\n{3,}/g, '\n\n')
        // Trim leading + trailing whitespace/newlines overall
        .trim();
    }

    /**
     * Helper: handle extract failure theo on_fail mode.
     */
    _handleExtractFail(node, reason, onFail, startTime, log) {
      log(`Text Extract fail: ${reason}`, 'warn');
      // 2026-05-31: NON-BLOCKING toast notification để user biết extract fail.
      // Trước: chỉ log internal → user thấy downstream skip mà không rõ reason.
      try {
        this._emitToast(
          `Text Extract "${node.node_name || node.node_type}" lỗi: ${reason}`,
          onFail === 'fail_workflow' ? 'error' : 'warning',
          onFail === 'fail_workflow' ? 10000 : 7000
        );
      } catch (_) { /* notify best-effort */ }
      if (onFail === 'fail_workflow') {
        const err = new Error(`Text Extract fail: ${reason}`);
        err.code = 'EXTRACT_FAIL';
        throw err;
      }
      // empty hoặc skip_downstream: trả empty result + set flag để downstream check
      node.result_text = '';
      node.result_source = 'extract';
      node._extract_failed = true;
      node._extract_reason = reason;
      return {
        fileIds: [],
        duration: Date.now() - startTime,
        thumbnails: {},
        fileNames: {},
        result_text: '',
        result_source: 'extract',
        _extract_failed: true,
        _extract_reason: reason,
      };
    }

    /**
     * Phase CG-8 ext: Resolve refs cho Prompt node (enhance=ON).
     * Convert tile_id → base64 (qua background fetchBlob) → [{base64, name, type}].
     * Cap maxRefImages từ adapter capabilities (mặc định 4).
     */
    async _resolveRefImagesForLLM(node, adapter) {
      const idsRaw = node.ref_file_ids || '';
      if (!idsRaw) return [];
      const fileIds = idsRaw.split(',').map(s => s.trim()).filter(Boolean);
      if (fileIds.length === 0) return [];

      // Post-audit fix: ưu tiên adapter.getMaxRefImages per-mode (Flow), fallback capabilities.maxRefImages
      // (ChatGPT/Grok/Gemini). Đồng nhất pattern với ImagePickerModal.resolveMaxSelections.
      let maxRefs;
      if (typeof adapter?.getMaxRefImages === 'function') {
        const mode = (node.media_type || 'Image').toLowerCase();
        const isFrames = mode === 'video' && node.video_input_type === 'Frames';
        maxRefs = adapter.getMaxRefImages({ mode, isFrames });
      }
      if (typeof maxRefs !== 'number' || maxRefs <= 0) {
        maxRefs = adapter?.capabilities?.maxRefImages || 4;
      }
      const capped = fileIds.slice(0, maxRefs);

      const refThumbs = node.ref_thumbnails || {};
      const results = [];
      for (const fid of capped) {
        let thumbUrl = null;
        // Format có thể là string URL hoặc object {thumbnail, type, file_name}
        const cached = refThumbs[fid];
        if (typeof cached === 'string') thumbUrl = cached;
        else if (cached && typeof cached === 'object') thumbUrl = cached.thumbnail || cached.thumbnail_url;
        // Fallback 1: GenTab.thumbnailCache (session memory)
        if (!thumbUrl && window.GenTab?.thumbnailCache?.[fid]) {
          thumbUrl = window.GenTab.thumbnailCache[fid];
        }
        // Fallback 2: WorkflowEditor._tileCache — picker + port nguồn ghi thumbnail vào đây.
        // Bug fix 2026-05-26: prompt node thiếu fallback này (khác ChatGPT/Generate resolve) →
        // ref images không bao giờ resolve được URL → submit rỗng → KHÔNG upload ảnh.
        if (!thumbUrl && getThumbCache()) {
          const tc = getThumbCache().get(fid);
          if (tc?.thumbnail) thumbUrl = tc.thumbnail;
        }
        // Fallback 3: MediaRegistry (registered khi pick/upload)
        if (!thumbUrl && typeof MediaRegistry !== 'undefined' && MediaRegistry.getThumb) {
          thumbUrl = MediaRegistry.getThumb(fid) || null;
        }
        if (!thumbUrl) {
          console.warn('[WorkflowExecutor] Prompt ref thumbnail missing for', fid);
          continue;
        }
        try {
          const resp = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'fetchBlob', url: thumbUrl }, (r) => resolve(r));
          });
          // Bug fix 2026-05-26: fetchBlob handler trả { success, base64, contentType } — KHÔNG
          // có field `dataUrl`. Trước đây đọc resp.dataUrl (luôn undefined) → results LUÔN rỗng
          // → KHÔNG upload ảnh dù thumbnail có sẵn. Mirror ChatGPT resolver (:5463): đọc resp.base64,
          // handle cả raw base64 lẫn data URL.
          if (resp?.success && resp.base64) {
            const name = `prompt_ref_${fid.substring(0, 12)}.png`;
            const m = resp.base64.match(/^data:(.+?);base64,(.+)$/);
            if (m) {
              results.push({ base64: m[2], name, type: m[1] });
            } else {
              results.push({ base64: resp.base64, name, type: resp.contentType || 'image/png' });
            }
          }
        } catch (err) {
          console.warn('[WorkflowExecutor] fetchBlob ref failed:', fid, err.message);
        }
      }
      return results;
    }

    /**
     * Phase CG-8: Resolve effective prompt cho generate/chatgpt/grok
     * khi prompt_source = 'upstream_node'. Trả { text, source }.
     * Gộp TẤT CẢ upstream text sources: prompt nodes trước, text nodes sau.
     *
     * source: 'textbox' | 'upstream_node' | 'textbox_fallback'
     */
    _resolveEffectivePrompt(node, workflow) {
      if (node.prompt_source !== 'upstream_node') {
        return { text: node.prompt || '', source: 'textbox' };
      }
      const upstreamTexts = this._getAllUpstreamTextSources(node, workflow);
      if (upstreamTexts.length === 0) {
        return { text: node.prompt || '', source: 'textbox_fallback' };
      }
      // Sort: prompt nodes trước (by posY), sau đó các node khác (by posY)
      upstreamTexts.sort((a, b) => {
        const aIsPrompt = a.nodeType === 'prompt' ? 0 : 1;
        const bIsPrompt = b.nodeType === 'prompt' ? 0 : 1;
        if (aIsPrompt !== bIsPrompt) return aIsPrompt - bIsPrompt;
        return a.posY - b.posY;
      });
      // Join với newline separator
      let text = upstreamTexts.map(u => u.text).join('\n\n');
      const maxLen = window.ValidationRules?.safeGetInt?.('prompt_max_length', 5000) ?? 5000;
      if (text.length > maxLen) {
        console.warn(`[WorkflowExecutor] Combined upstream prompts > ${maxLen} chars — truncating`);
        text = text.substring(0, maxLen);
      }
      return { text, source: 'upstream_node' };
    }

    /**
     * Tìm TẤT CẢ upstream nodes có text output từ edges.
     * Trả về array { text, nodeType, posY, nodeName }.
     */
    _getAllUpstreamTextSources(node, workflow) {
      const edges = workflow?.edges || [];
      const nodes = workflow?.nodes || [];
      const results = [];
      for (const edge of edges) {
        if (edge.target_node_id !== node.node_id) continue;
        const src = nodes.find(n => n.node_id === edge.source_node_id);
        if (!src?.result_text?.trim()) continue;
        results.push({
          text: src.result_text.trim(),
          nodeType: src.node_type,
          posY: src.pos_y ?? src.position?.y ?? 0,
          nodeName: src.node_name || src.node_id
        });
      }
      return results;
    }

    /**
     * Gộp TẤT CẢ upstream text inputs qua port `text` của node.
     * Helper DÙNG CHUNG cho generate/chatgpt/grok (prompt_source=upstream_node) + prompt node
     * (chained) để ĐỒNG BỘ logic: result_text → fallback prompt (text/prompt chưa execute),
     * sort prompt-first by posY, join '\n\n', truncate maxLen.
     * @returns {{text: string, sources: Array}|null} null nếu không có upstream text.
     */
    _combineUpstreamTexts(node, workflow) {
      const textEdges = (workflow?.edges || []).filter((e) => {
        if (e.target_node_id !== node.node_id) return false;
        const tgtPort = e.target_port;
        // Fix audit: 'in' = port input của node condition (type any) — trước đây bị loại → condition
        // KHÔNG đọc được text upstream → has_text/contains/regex luôn sai. 'in' chỉ có ở condition.
        return !tgtPort || tgtPort === 'default' || tgtPort === 'text' || tgtPort === 'in';
      });
      const sources = [];
      for (const edge of textEdges) {
        const srcNode = (workflow?.nodes || []).find((n) => n.node_id === edge.source_node_id);
        if (!srcNode) continue;
        // Ưu tiên result_text (đã execute), fallback prompt (text/prompt node chưa execute)
        let text = srcNode.result_text?.trim();
        if (!text && (srcNode.node_type === 'text' || srcNode.node_type === 'prompt')) {
          text = srcNode.prompt?.trim();
        }
        // Fix audit A: node pass-through (delay/note) KHÔNG set result_text → trước fix Text→Delay→
        // Generate mất prompt (EMPTY_UPSTREAM_PROMPT). Traverse NGƯỢC qua passthrough tìm text upstream.
        if (!text && ['delay', 'note', 'condition', 'switch'].includes(srcNode.node_type)) {
          text = this._resolvePassthroughText(srcNode, workflow);
        }
        // Resolve @mention của prompt node nguồn: single-node run (prompt node CHƯA execute → dùng
        // .prompt thô) hoặc mode='all' → text còn literal @tag. Không resolve → @tag leak xuống
        // provider (grok strip @ → giữ tên thay vì content). resolvePromptMentions tự bỏ @tag không
        // khớp node slug → an toàn. Nếu result_text đã substitute (không còn @tag) → regex miss → skip.
        if (text && srcNode.node_type === 'prompt' && /@[a-z][a-z0-9_]{0,29}/i.test(text)) {
          try {
            const nbs = buildNodesBySlug(workflow?.nodes || []);
            const resolved = resolvePromptMentions(
              { prompt: text, prompt_mode: 'mention', ref_mode: 'mention' },
              nbs
            );
            if (resolved && resolved.trim()) text = resolved.trim();
          } catch (_) { /* giữ text thô nếu resolve lỗi */ }
        }
        if (text) {
          sources.push({
            text,
            nodeType: srcNode.node_type,
            posY: srcNode.pos_y ?? srcNode.position?.y ?? 0,
            nodeName: srcNode.node_name || srcNode.node_id,
          });
        }
      }
      if (sources.length === 0) return null;
      // Sort: prompt nodes trước (by posY), sau đó các node khác (by posY)
      sources.sort((a, b) => {
        const aP = a.nodeType === 'prompt' ? 0 : 1;
        const bP = b.nodeType === 'prompt' ? 0 : 1;
        if (aP !== bP) return aP - bP;
        return a.posY - b.posY;
      });
      let text = sources.map((u) => u.text).join('\n\n');
      // 2026-05-31: text_extract BYPASS truncation. prompt_max_length là giới hạn PROMPT SUBMIT
      // tới AI provider (Flow/ChatGPT/Grok), KHÔNG phải cho downstream parser. text_extract
      // cần FULL AI response để find markers — truncate ở 5000-7000 chars sẽ mất markers cuối
      // → extract fail cascade (vd 21K chars response chỉ thấy 7K → image_prompt_3,4 + video_prompt_2,3,4 fail).
      if (node.node_type !== 'text_extract') {
        const maxLen = window.ValidationRules?.safeGetInt?.('prompt_max_length', 5000) ?? 5000;
        if (text.length > maxLen) {
          const originalLen = text.length;
          text = text.substring(0, maxLen);
          // 2026-05-31: NON-BLOCKING toast — user biết prompt bị truncate (mất content cuối)
          try {
            this._emitToast(
              `Prompt cho "${node.node_name || node.node_type}" bị cắt ${originalLen.toLocaleString()}→${maxLen.toLocaleString()} chars (vượt prompt_max_length). Nội dung cuối bị mất.`,
              'warning',
              8000
            );
          } catch (_) { /* notify best-effort */ }
        }
      }
      return { text, sources };
    }

    // Fix audit A: BFS ngược qua node pass-through (delay/note/condition — không tự set result_text)
    // để tìm text upstream thật. Trả chuỗi text nối bằng \n\n (rỗng nếu không có). Guard vòng lặp bằng visited.
    _resolvePassthroughText(startNode, workflow) {
      const PASS = ['delay', 'note', 'condition', 'switch'];
      const nodes = workflow?.nodes || [];
      const edges = workflow?.edges || [];
      const visited = new Set([startNode.node_id]);
      const queue = [startNode.node_id];
      const found = [];
      let guard = 0;
      while (queue.length && guard++ < 500) {
        const curId = queue.shift();
        const inEdges = edges.filter((e) => e.target_node_id === curId);
        for (const e of inEdges) {
          const src = nodes.find((n) => n.node_id === e.source_node_id);
          if (!src || visited.has(src.node_id)) continue;
          visited.add(src.node_id);
          let t = src.result_text?.trim();
          if (!t && (src.node_type === 'text' || src.node_type === 'prompt')) t = src.prompt?.trim();
          if (t) found.push(t);
          else if (PASS.includes(src.node_type)) queue.push(src.node_id);
        }
      }
      return found.join('\n\n');
    }

    /**
     * Lấy tất cả tile IDs hiện tại trên Google Flow
     */
    async _getCurrentTileIds(nodeAccum = null) {
      if (this._isContentScriptContext()) {
        // Strict Server-Only: tile selector từ content.js helper (window._getTileSelectorString).
        const tileSelector = window._getTileSelectorString?.() || '[data-tile-id]';
        const tiles = document.querySelectorAll(tileSelector);
        return [...new Set(Array.from(tiles).map(t => t.dataset.tileId).filter(Boolean))];
      } else if (window.MessageBridge) {
        const result = await window.MessageBridge.getCurrentTileIds();
        // Cache fileNames cho _waitForNewTiles sử dụng (per-node khi có accumulator)
        const preFileNames = result?.fileNames ? new Set(result.fileNames) : null;
        this._lastPreFileNames = preFileNames;
        // Store preFileNames trên per-node accumulator (parallel-safe)
        const accum = nodeAccum || this._currentNodeAccum;
        if (accum) {
          accum.preFileNames = preFileNames;
        }
        return result?.tileIds || [];
      }
      log('Warning: No method available to get tile IDs');
      return [];
    }

    /**
     * Apply settings: media type, ratio, model, quantity, video_duration
     * @param {object} node
     * @param {boolean} [hasRef=false] — caller pass true nếu node có ref images.
     *   Dùng để apply duration override (vd Veo Lite/Fast + ref → ép 8s).
     */
    async _applySettings(node, hasRef = false) {
      const isVideo = node.media_type === 'Video';
      const isVideoFrames = isVideo && node.video_input_type === 'Frames';
      const quantity = node.quantity || 1;
      let videoDuration = isVideo ? (node.video_duration || '6s') : null;
      // Model constraint override (2026-05-22) — apply cho direct path giống pipeline path.
      if (isVideo && hasRef && videoDuration) {
        const flowAdapter = window.ProviderRegistry?.get?.('flow');
        // 2026-05-27: detect ref VIDEO (vd Omni Flash + ref video → force 10s).
        const _refIdsForVid = (node.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
        const _hasRefVideo = _refIdsForVid.some(id => {
          const tc = getThumbCache()?.get(id);
          if (tc?.type === 'video') return true;
          const rt = node.ref_thumbnails?.[id];
          return !!(rt && typeof rt === 'object' && rt.type === 'video');
        });
        const forced = flowAdapter?.getDurationOverride?.({
          modelValue: node.model,
          hasRef: true,
          hasRefVideo: _hasRefVideo,
          inputType: node.video_input_type || 'Ingredients',
        });
        if (forced && forced !== videoDuration) {
          log(`[Model Constraint] Override duration ${videoDuration} → ${forced} (${node.model} + ref image)`);
          videoDuration = forced;
        }
      }

      log('Applying settings:', {
        mediaType: node.media_type,
        ratio: node.ratio,
        model: node.model,
        videoInputType: node.video_input_type,
        isVideoFrames,
        quantity,
        videoDuration
      });

      // applySettings(genType, aspectRatio, modelName, isFrames, quantity, flowVideoDuration)
      // isFrames=true → click tab Frames; isFrames=false → click tab Ingredients
      // quantity param clicks x1/x2/x3/x4 in Flow menu
      // flowVideoDuration param selects duration tab (4s/6s/8s/10s) for video mode
      const defaults = await this._getGenDefaults();
      const genType = node.media_type || defaults.genType;
      const ratio = node.ratio || defaults.ratio;
      const model = isVideo ? (node.model || defaults.videoModel) : (node.model || defaults.imageModel);

      if (typeof applySettings === 'function') {
        log('Using direct applySettings');
        await applySettings(genType, ratio, model, isVideoFrames, quantity, videoDuration);
      } else if (window.MessageBridge) {
        log('Using MessageBridge for applySettings');
        await window.MessageBridge.applySettings(genType, ratio, model, isVideoFrames, quantity, videoDuration);
      } else {
        log('Warning: applySettings function not available');
        await this._sleep(500);
      }
    }

    /**
     * Clear editor content - delegate to content.js
     */
    async _clearEditor() {
      if (typeof getEditor === 'function' && typeof clearEditor === 'function') {
        const editor = getEditor();
        if (editor) {
          clearEditor(editor);
          log('Editor cleared (direct)');
        }
      } else if (window.MessageBridge) {
        log('Using MessageBridge for clearEditor');
        await window.MessageBridge.clearEditor();
      } else {
        log('Warning: clearEditor not available');
      }
    }

    /**
     * [Bug fix] Xóa ref images cũ trong prompt area - delegate to content.js
     * KHÔNG dùng clearEditor (chỉ xóa text Slate, không xóa ref image thumbnails).
     */
    async _removeExistingRefImages() {
      if (typeof removeExistingRefImages === 'function') {
        const removed = await removeExistingRefImages();
        if (removed > 0) log(`Đã xóa ${removed} ref images cũ (direct)`);
      } else if (window.MessageBridge) {
        log('Using MessageBridge for removeExistingRefImages');
        await window.MessageBridge.removeExistingRefImages();
      } else {
        log('Warning: removeExistingRefImages not available');
      }
    }

    /**
     * Lấy inputTimeout setting (ms), fallback 1200ms
     */
    _getInputTimeoutMs() {
      if (typeof getInputTimeoutMs === 'function') {
        return getInputTimeoutMs();
      }
      const s = window.storageSettings?.getSettings() || {};
      return s.inputTimeout || 1200;
    }

    // Derived — không cần settings riêng
    _getClearEditorDelay() {
      return Math.round(this._getInputTimeoutMs() * 0.4);
    }

    _getSubmitDelay() {
      return Math.round(this._getInputTimeoutMs() * 0.5);
    }

    _getAfterSubmitDelay() {
      return Math.round(this._getInputTimeoutMs() * 0.8);
    }

    _getDelayBetweenPromptsMs() {
      // Phase 2c+: Server-Only — ExecutionConfig source of truth.
      const delayBetweenSec = window.ExecutionConfig?.safeGetDelayBetweenPromptsSec?.() ?? 5;
      return delayBetweenSec * 1000;
    }

    _getRandomDelay() {
      const s = window.storageSettings?.getSettings() || {};
      const min = (s.randomDelayMin || 3) * 1000;
      const max = (s.randomDelayMax || 10) * 1000;
      return min + Math.random() * (max - min);
    }

    /**
     * Strict Server-Only: get icon_element CSS selectors từ provider_configs.dom_selector.
     * Sidebar context: dùng PCM cache.
     * Content script context: dùng window._getDynamicSelector (helper từ content.js).
     * Cache miss → empty string + Tier3 warn → caller graceful skip detection.
     */
    _getIconElementSelector() {
      // Content script context (Flow tab): _getDynamicSelector từ content.js
      if (typeof window._getDynamicSelector === 'function') {
        const cfg = window._getDynamicSelector('icon_element');
        if (cfg?.selectors?.length) return cfg.selectors.join(', ');
      }
      // Sidebar context: ProviderConfigManager cache
      const pcm = window.ProviderConfigManager;
      const selectors = pcm?._cache?.data?.flow?.dom_selectors?.icon_element?.selectors;
      if (Array.isArray(selectors) && selectors.length) {
        return selectors.join(', ');
      }
      console.debug('[Tier3] WorkflowExecutor._getIconElementSelector: icon_element cache miss — warning detection degraded');
      return '';
    }

    /**
     * Extract file_name (UUID) from a tile element for cross-project validation
     * Looks for getMediaUrlRedirect?name=UUID in img src, a href, or data attributes
     * @param {Element} tile - DOM element with data-tile-id
     * @returns {string|null} - UUID if found, null otherwise
     */
    _extractFileNameFromTile(tile) {
      if (!tile) return null;
      const _p = window._getMediaUrlPattern?.() || 'getMediaUrlRedirect';
      const candidates = [
        ...tile.querySelectorAll(`img[src*="${_p}"]`),
        ...tile.querySelectorAll(`a[href*="${_p}"]`),
      ];
      for (const el of candidates) {
        const url = el.src || el.href;
        const fileName = this._extractFileNameFromUrl(url);
        if (fileName) return fileName;
      }
      // Check data-redirect-url attribute
      const redirectUrl = tile.dataset?.redirectUrl || tile.getAttribute('data-redirect-url');
      if (redirectUrl) {
        const fileName = this._extractFileNameFromUrl(redirectUrl);
        if (fileName) return fileName;
      }
      return null;
    }

    /**
     * Extract file_name (UUID) from a URL containing getMediaUrlRedirect?name=UUID
     * @param {string} url
     * @returns {string|null}
     */
    _extractFileNameFromUrl(url) {
      if (!url) return null;
      try {
        const urlObj = new URL(url, window.location.origin);
        const name = urlObj.searchParams.get('name');
        if (name && /^[a-f0-9-]{8,}$/i.test(name)) return name;
        // Also handle tRPC input format
        const input = urlObj.searchParams.get('input');
        if (input) {
          const inputObj = JSON.parse(decodeURIComponent(input));
          if (inputObj?.name && /^[a-f0-9-]{8,}$/i.test(inputObj.name)) return inputObj.name;
        }
      } catch (e) { /* ignore */ }
      return null;
    }

    /**
     * Insert prompt vào editor - delegate to content.js
     */
    /**
     * Prompt trước khi gõ vào Flow.
     *
     * Video: Veo mặc định hay tự thêm NHẠC NỀN. Với hướng "Flow gen video câm để
     * Video AI V2 lồng tiếng", nhạc nền là rác — đè lên giọng đọc, hoặc phải bỏ cả clip.
     * Chèn một câu chốt là xong. TÔN TRỌNG người dùng: ai đã tự nói về nhạc/âm thanh
     * trong prompt thì không chèn đè (trừ khi node bật ép video câm).
     * Ảnh: không đụng.
     */
    _hygienicPrompt(node, isVideo, nodeLog) {
      let raw = node?.prompt || '';
      if (!isVideo) return raw;

      // Giọng của nhân vật: nếu Bảng thực thể đã khai `voice` cho nhân vật xuất hiện
      // trong prompt thì nhắc lại ở đây. Veo dựng giọng theo mô tả trong prompt, nên
      // không nhắc thì mỗi cảnh ra một chất giọng khác nhau.
      try {
        const bound = this._entityVoiceHints(node);
        if (bound && raw && !/giọng|voice/i.test(raw)) raw = raw + ' ' + bound;
      } catch (_e) { globalThis.SEOSONA_swallow?.('WorkflowExecutor#_hygienicPrompt', _e); }

      const PH = window.PromptHygiene;
      if (!PH?.normalizeVideoAudio) return raw;
      if (node.audio_normalize === false) return raw;   // tắt tường minh ở cấu hình node
      const out = PH.normalizeVideoAudio(raw, { force: node.force_silent === true });
      if (out !== raw) nodeLog?.('Đã chèn "no background music" để video câm cho khâu lồng tiếng.');
      return out;
    }

    /**
     * Gom mô tả giọng của các thực thể ĐƯỢC NHẮC TÊN trong prompt node này.
     * Chỉ lấy thực thể có tên xuất hiện trong prompt — nhét cả dàn vào thì prompt phình
     * ra và model bị nhiễu bởi nhân vật không có mặt trong cảnh.
     */
    _entityVoiceHints(node) {
      const wf = this.currentWorkflow;
      if (!wf?.nodes) return null;
      const prompt = String(node?.prompt || '').toLowerCase();
      if (!prompt) return null;
      const hints = [];
      for (const n of wf.nodes) {
        if (n.node_type !== 'entity_ref' || !Array.isArray(n.entity_bound)) continue;
        for (const e of n.entity_bound) {
          if (!e.voice) continue;
          if (prompt.includes(String(e.name || '').toLowerCase())) hints.push(`${e.name}: ${e.voice}`);
        }
      }
      return hints.length ? ('Giọng — ' + hints.join('; ') + '.') : null;
    }

    async _insertPrompt(prompt) {
      if (typeof getEditor === 'function' && typeof insertText === 'function') {
        const editor = getEditor();
        if (editor) {
          await insertText(editor, prompt);
          log('Prompt inserted (direct):', prompt.substring(0, 50) + '...');
        }
      } else if (window.MessageBridge) {
        log('Using MessageBridge for insertText');
        await window.MessageBridge.insertText(prompt);
      } else {
        log('Warning: insertText not available');
      }
    }

    /**
     * Add file ID to prompt as reference - delegate to content.js
     * @param {string} fileId - data-tile-id
     * @param {string} [fileName] - persistent UUID from getMediaUrlRedirect (Tầng 1 fallback)
     * @param {string} [flowFileId] - persistent file_id from /edit/{file_id} (Phase U)
     */
    async _addFileToPrompt(fileId, fileName, flowFileId) {
      if (typeof addFileToPrompt === 'function') {
        // Content script context - can check DOM directly
        const tileExists = !!document.querySelector(`[data-tile-id="${fileId}"]`);
        if (!tileExists) {
          log('WARNING: Tile not found on page for fileId:', fileId, '- trying file_name fallback');
        }
        log('Using direct addFileToPrompt');
        await addFileToPrompt(fileId, fileName, flowFileId || null);
      } else if (window.MessageBridge) {
        log('Using MessageBridge for addFileToPrompt:', fileId, fileName ? `(file_name: ${fileName.substring(0, 20)}...)` : '');
        await window.MessageBridge.addFileToPrompt(fileId, fileName, flowFileId || null);
      } else {
        log('Warning: addFileToPrompt not available');
      }
    }

    /**
     * Click submit button - delegate to content.js
     * Chờ button xuất hiện và enabled trước khi click
     */
    async _clickSubmit() {
      if (this._isContentScriptContext()) {
        // 2026-05-30: Pre-submit check Flow credit limit alert. Khi limit hit, submit button
        // bị replace bằng alert icon → poll waste 10s + fail. Detect sớm → throw rõ error code.
        if (typeof _checkFlowCreditLimit === 'function' && _checkFlowCreditLimit()) {
          const localizedMsg = window.I18n?.t?.('flow.creditLimitHit')
            || 'Tài khoản Google Flow đã hết credit — KHÔNG thể submit';
          const err = new Error(localizedMsg);
          err.code = 'FLOW_CREDIT_LIMIT';
          throw err;
        }

        // Direct DOM access - poll for submit button
        const maxWait = 10000; // 10s max wait for submit button
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          const btn = getSubmitButton();

          if (btn) {
            if (btn.disabled) {
              log('Submit button found but disabled, waiting...');
              await this._sleep(500);
              continue;
            }
            // Dùng simulateClick: dispatch đủ chuỗi pointer/mouse events để React onClick handler của
            // button trigger (el.click() đơn không đủ với 1 số React component cần pointer sequence).
            if (typeof simulateClick === 'function') {
              simulateClick(btn);
            } else {
              btn.click();
            }
            log('Submit clicked (direct)');
            await this._sleep(this._getAfterSubmitDelay());
            return;
          }

          log('Submit button not found yet, waiting...');
          await this._sleep(500);
        }

        throw new Error('Submit button not found or disabled after 10s');
      } else if (window.MessageBridge) {
        // Retry via MessageBridge - content.js returns { success: bool }
        const maxWait = 10000;
        const startTime = Date.now();
        while (Date.now() - startTime < maxWait) {
          const result = await window.MessageBridge.clickSubmit();
          if (result?.success) {
            log('Submit clicked (MessageBridge)');
            await this._sleep(this._getAfterSubmitDelay());
            return;
          }
          log('Submit not ready via MessageBridge, retrying...');
          await this._sleep(500);
        }
        throw new Error('Submit button not found or disabled after 10s');
      } else {
        throw new Error('clickSubmit not available - no content script or MessageBridge');
      }
    }

    /**
     * Wait for new tiles to appear and complete
     */
    async _waitForNewTiles(preTileIds, timeout, preFileNames = null, nodeAccum = null, quantity = 0) {
      // When not in content script, delegate entirely to content script's polling logic
      if (!this._isContentScriptContext() && window.MessageBridge) {
        log('Using MessageBridge for waitForNewTiles');
        const opts = preFileNames
          ? { preFileNames: Array.from(preFileNames), maxQuantity: quantity }
          : { captureFileNames: true, maxQuantity: quantity };
        const result = await window.MessageBridge.waitForNewTiles(preTileIds, timeout, opts);
        // content.js returns { tiles: [...], failed: bool, thumbnails: {...} }
        if (result?.failed) {
          throw new Error('Google Flow trả về lỗi khi tạo nội dung');
        }
        // Merge thumbnails + file_names vào per-node accumulator (hoặc fallback shared)
        if (result?.thumbnails) {
          const thumbTarget = nodeAccum?.thumbnails ?? this._lastTileThumbnails;
          const fnTarget = nodeAccum?.fileNames ?? this._lastTileFileNames;
          Object.assign(thumbTarget, result.thumbnails);
          // Extract file_names from thumbnail data
          for (const [tid, info] of Object.entries(result.thumbnails)) {
            if (info?.file_name) {
              fnTarget[tid] = info.file_name;
            }
          }
        }
        return result?.tiles || [];
      }

      // Direct DOM polling in content script context
      const startTime = Date.now();
      const preSet = new Set(preTileIds);
      const MIN_FAIL_DETECT_MS = 15000; // Chờ 15s trước khi detect fail (tránh false positive)

      while (Date.now() - startTime < timeout) {
        // Phase 5.2: Check per-node submitted tracking (any node submitted = don't abort)
        const hasSubmittedNodes = this._submittedNodes && this._submittedNodes.size > 0;
        if (this.shouldStop && !hasSubmittedNodes) {
          throw new Error('Execution stopped by user');
        }

        await new Promise(r => setTimeout(r, 2000));

        const currentTileIds = await this._getCurrentTileIds();
        const newTiles = currentTileIds.filter(id => !preSet.has(id));

        if (newTiles.length > 0) {
          const elapsed = Date.now() - startTime;
          let allComplete = true;
          let hasError = false;
          for (const tileId of newTiles) {
            const tile = document.querySelector(`[data-tile-id="${tileId}"]`);
            if (!tile) continue;

            // Chỉ check fail sau 15s (tile vừa render có thể flash warning icon tạm thời)
            if (elapsed >= MIN_FAIL_DETECT_MS) {
              // Strict Server-Only: icon selector từ provider_configs.dom_selector.icon_element.
              // Context có thể là content script (window._getDynamicSelector) hoặc sidebar (PCM cache).
              const iconSelector = this._getIconElementSelector();
              if (!iconSelector) {
                // Cache miss: skip warning detection (degraded mode) — log đã warn ở _getIconElementSelector
                continue;
              }
              const warningIcons = tile.querySelectorAll(iconSelector);
              let tileIsFailed = false;
              for (const icon of warningIcons) {
                if (icon.textContent.trim() !== 'warning') continue;
                let parent = icon.parentElement;
                let isHidden = false;
                while (parent && parent !== tile) {
                  if (parent.style && parent.style.opacity === '0') {
                    isHidden = true;
                    break;
                  }
                  parent = parent.parentElement;
                }
                if (!isHidden) { tileIsFailed = true; break; }
              }
              if (tileIsFailed) {
                hasError = true;
                break;
              }
            }

            // Check for media content (success = has img/video with real src)
            // Ưu tiên <video> trước — video tiles có cả <img> (ref) lẫn <video> (result)
            const media = tile.querySelector('video') || tile.querySelector('img');
            if (!media || !media.src || media.src.startsWith('data:')) {
              allComplete = false;
              break;
            }
          }

          if (hasError) {
            throw new Error('Google Flow trả về lỗi khi tạo nội dung');
          }

          if (allComplete) {
            log('New tiles completed:', newTiles);
            return newTiles;
          }
        }
      }

      throw new Error('Timeout waiting for generation');
    }

    /**
     * Dual URL — build lookup `{ tileId: { url, provider, media_type, tab_id, captured_at } }`
     * từ tất cả upstream nodes có `result_provider_urls`. Download node sử dụng để route
     * tile sang download path provider gốc (chất lượng 100%) thay vì Flow re-encoded.
     */
    _buildProviderUrlLookup(nodes) {
      const lookup = {};
      if (!Array.isArray(nodes)) return lookup;
      for (const n of nodes) {
        const map = n?.result_provider_urls;
        if (!map || typeof map !== 'object') continue;
        for (const [tileId, data] of Object.entries(map)) {
          if (data?.url && !lookup[tileId]) lookup[tileId] = data;
        }
      }
      return lookup;
    }

    /**
     * Dual URL — fetch URL provider gốc qua cookie session tab + download via chrome.downloads.
     * Trả `true` nếu thành công, `false` nếu fail (caller fallback sang Flow context menu).
     */
    async _downloadProviderTileDirect(fileId, providerData, promptText, index, subfolder, fileName) {
      const { url, provider, media_type, tab_id } = providerData;
      if (!url || !window.MessageBridge) return false;

      try {
        const fetchFn = provider === 'chatgpt'
          ? window.MessageBridge.chatGPTFetchImage
          : provider === 'grok'
            ? window.MessageBridge.grokFetchImage
            : null;
        if (!fetchFn) return false;

        const fetchResp = await fetchFn(url, tab_id);
        if (!fetchResp?.success || !fetchResp.base64) {
          console.warn('[WorkflowExecutor] Provider fetch fail:', provider, fetchResp?.error);
          return false; // Caller fallback Flow path (provider URL có thể expired)
        }

        const blob = await (await fetch(fetchResp.base64)).blob();
        const blobUrl = URL.createObjectURL(blob);
        const ext = media_type === 'video' ? 'mp4' : 'png';

        const _dlSet = await window.DownloadHelper.getSettings();
        const folder = _dlSet.folder;
        const wfName = subfolder || this.currentWorkflow?.wf_name || null;

        // Bug fix 2026-06-03: `promptText` ở đây là filename basename ĐÃ build theo Download
        // node template (`{node}_{prompt}` syntax) qua `_buildDownloadFileName` ở caller line
        // 4933. Trước fix: feed `promptText` vào `GenTab._buildChatGPTFilename` (settings template
        // `[Date]_[Prompt]_[Index]` syntax) → re-template → mất Download node template.
        // Giờ: dùng promptText trực tiếp làm basename. Path = {folder}/{subfolder}/{promptText}.{ext}.
        const sanitize = (s) => String(s || '').replace(/[\/\\:*?"<>|]/g, '_').trim();
        const safeBase = sanitize(promptText) || `${provider}-${Date.now()}-${index}`;
        // Cùng hằng số với mọi đường tải khác (trước đây riêng chỗ này dự phòng 'flow-output').
        const safeFolder = sanitize(folder) || (globalThis.FilenameBuilder?.DEFAULT_FOLDER || 'seosonaflow_output');
        const safeWfName = wfName ? sanitize(wfName).substring(0, 60) : '';
        const filename = safeWfName
          ? `${safeFolder}/${safeWfName}/${safeBase}.${ext}`
          : `${safeFolder}/${safeBase}.${ext}`;

        const dlUrl = await this._scrubForDownload(blobUrl);
        const dlResp = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'chromeDownload', url: dlUrl, filename }, (r) => resolve(r));
        });
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

        return !!dlResp?.success;
      } catch (err) {
        console.error('[WorkflowExecutor] _downloadProviderTileDirect exception:', err);
        return false;
      }
    }

    /**
     * Download single tile via content script or MessageBridge
     * @param {string} fileId - tile_id (session-specific)
     * @param {string} promptText - for filename generation
     * @param {string} [resolution] - '1k' | '2k'
     * @param {string} [fileName] - file_name UUID (persistent)
     * @param {string} [flowFileId] - persistent file_id from /edit/{file_id} (Phase U)
     * @param {string} [taskName] - Subfolder name (từ node.download_folder hoặc workflow name)
     */
    async _downloadSingleTile(fileId, promptText, resolution, fileName, flowFileId, taskName) {
      // taskName ưu tiên: param truyền vào > workflow name > null
      const folderName = taskName !== undefined ? taskName : (this.currentWorkflow?.wf_name || null);
      if (this._isContentScriptContext() && typeof downloadTileMedia === 'function') {
        await downloadTileMedia(fileId, promptText, folderName, fileName || null, resolution, flowFileId || null);
      } else if (window.MessageBridge) {
        await window.MessageBridge.downloadTileMedia(fileId, promptText, folderName, fileName || null, resolution, flowFileId || null);
      }
    }

    /**
     * Download multiple tiles with delay between each
     * @param {string[]} fileIds - tile IDs
     * @param {string} promptText - for filename generation
     * @param {string} [resolution] - '1k' | '2k'
     * @param {Object} [fileNameMap] - { tileId: fileName } for cross-project safety
     * @param {string} [taskName] - Subfolder name (null = dùng workflow name)
     */
    async _downloadTiles(fileIds, promptText, resolution, fileNameMap, taskName) {
      // Dedup: tránh download trùng giữa các nodes trong cùng workflow
      // (VD: node generate có auto_download=true + node Download cuối cùng)
      if (!this._downloadedTileIds) this._downloadedTileIds = new Set();

      for (const tid of fileIds) {
        // Skip nếu tile đã được download trong workflow session này
        if (this._downloadedTileIds.has(tid)) {
          log(`Skip tile đã download: ${tid.substring(0, 20)}`);
          continue;
        }

        const fn = fileNameMap?.[tid] || null;
        await this._downloadSingleTile(tid, promptText, resolution, fn, null, taskName);
        this._downloadedTileIds.add(tid);
        await this._sleep(300);
      }
    }

    // ===== Port 1.1.58 VIDEO_NODE_LAST_FRAME_OUTPUT =====
    // Node video (Flow generate media_type=Video / grok grok_mode=video) → trích frame CUỐI → upload
    // Flow như 1 ảnh → set node.result_frame_file_ids/thumbnails cho output port `frame`. Downstream
    // node ảnh chain tiếp từ frame cuối video. Gate qua edge port `frame` → không upload thừa.
    async _maybeExtractLastFrame(node, result, workflow) {
      try {
        if (!node) return;
        const isVideoNode = (node.node_type === 'generate' && (node.media_type || 'Image') === 'Video')
          || (node.node_type === 'grok' && (node.grok_mode || 'image') === 'video');
        if (!isVideoNode) return;
        const edges = Array.isArray(workflow?.edges) ? workflow.edges
          : (Array.isArray(this.currentWorkflow?.edges) ? this.currentWorkflow.edges : []);
        const hasFrameEdge = edges.some(e => e.source_node_id === node.node_id && e.source_port === 'frame');
        if (!hasFrameEdge) return; // không có downstream frame edge → khỏi trích
        await this._extractFrameForNode(node, result);
      } catch (e) {
        console.warn('[LastFrame] eager extract error (bỏ qua, video vẫn completed):', e?.message || e);
      }
    }

    // LAZY: trước khi node downstream thu ref, đảm bảo các video node nối vào qua port `frame` đã trích
    // frame (dùng cho video gen SẴN, run single-node không re-gen video).
    async _ensureFrameRefsExtracted(node, workflow) {
      try {
        if (!node) return;
        const edges = Array.isArray(workflow?.edges) ? workflow.edges
          : (Array.isArray(this.currentWorkflow?.edges) ? this.currentWorkflow.edges : []);
        const frameEdges = edges.filter(e => e.target_node_id === node.node_id && e.source_port === 'frame');
        if (!frameEdges.length) return;
        const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes
          : (Array.isArray(this.currentWorkflow?.nodes) ? this.currentWorkflow.nodes : []);
        for (const edge of frameEdges) {
          const src = nodes.find(n => n.node_id === edge.source_node_id);
          if (!src) continue;
          if ((src.result_frame_file_ids || '').trim()) continue; // đã có frame → skip
          await this._extractFrameForNode(src, null); // null result → dùng data đã lưu của src
        }
      } catch (e) {
        console.warn('[LastFrame] lazy ensure error (bỏ qua):', e?.message || e);
      }
    }

    // CORE: trích frame CUỐI 1 video node → upload Flow → set videoNode.result_frame_*.
    async _extractFrameForNode(videoNode, result = null) {
      if (!videoNode) return false;
      const isFlowVideo = videoNode.node_type === 'generate' && (videoNode.media_type || 'Image') === 'Video';
      const isGrokVideo = videoNode.node_type === 'grok' && (videoNode.grok_mode || 'image') === 'video';
      if (!isFlowVideo && !isGrokVideo) return false;
      const provider = isGrokVideo ? 'grok' : 'flow';
      const flog = (message, type = 'info') => emitLog({ nodeId: videoNode.node_id, message: `[Frame cuối] ${message}`, type });

      if (!window.VideoFrameExtractor?.extractLastFrame) { flog('VideoFrameExtractor chưa load → bỏ qua', 'warn'); return false; }

      const splitIds = (s) => (s || '').split(',').map(x => x.trim()).filter(Boolean);
      const fileIds = (Array.isArray(result?.fileIds) && result.fileIds.length)
        ? result.fileIds : splitIds(videoNode.result_file_ids);
      if (!fileIds.length) { flog('node video chưa có result_file_ids → bỏ qua', 'warn'); return false; }

      let srcFid = null;
      for (const fid of fileIds) {
        const t = result?.thumbnails?.[fid] || videoNode.result_thumbnails?.[fid];
        if (t && typeof t === 'object' && (t.type === 'video' || t.video_url)) { srcFid = fid; break; }
      }
      if (!srcFid) srcFid = fileIds[0];

      let videoUrl = null;
      const t0 = result?.thumbnails?.[srcFid] || videoNode.result_thumbnails?.[srcFid];
      if (t0 && typeof t0 === 'object' && t0.video_url) videoUrl = t0.video_url;
      if (!videoUrl && videoNode.result_provider_urls?.[srcFid]?.url) videoUrl = videoNode.result_provider_urls[srcFid].url;
      if (!videoUrl && provider === 'grok' && t0 && typeof t0 === 'object' && t0.thumbnail) videoUrl = t0.thumbnail;
      if (!videoUrl && provider === 'flow' && window.MessageBridge?.getThumbnailsByIds) {
        try {
          const scan = await window.MessageBridge.getThumbnailsByIds([srcFid]);
          videoUrl = scan?.results?.[srcFid]?.video_url || null;
        } catch (_) { /* scan fail */ }
      }
      if (!videoUrl) { flog('không tìm được URL video của tile → bỏ qua', 'warn'); return false; }

      flog(`đang trích frame cuối video (${provider})...`);
      const grokTabId = provider === 'grok' ? (videoNode.result_provider_urls?.[srcFid]?.tab_id || null) : null;
      const frame = await window.VideoFrameExtractor.extractLastFrame(videoUrl, { provider, tabId: grokTabId });
      if (!frame?.base64) { flog('trích frame thất bại → bỏ qua', 'warn'); return false; }

      const up = await this._uploadFrameToFlow(frame.base64, `frame-${videoNode.node_id}-${Date.now()}.jpg`);
      if (!up?.ok || !up.file_id) { flog('upload frame lên Flow thất bại: ' + (up?.error || 'unknown'), 'warn'); return false; }

      videoNode.result_frame_file_ids = up.file_id;
      videoNode.result_frame_thumbnails = {
        [up.file_id]: { thumbnail: up.thumbnail || '', type: 'image', file_name: up.file_name || '' },
      };
      flog(`✓ đã trích + upload frame cuối → tile ${String(up.file_id).substring(0, 12)}`, 'success');
      try {
        await this._updateNodeStatus(videoNode.node_id, videoNode.status || 'completed', null, null, {
          result_frame_file_ids: videoNode.result_frame_file_ids,
          result_frame_thumbnails: videoNode.result_frame_thumbnails,
        });
      } catch (_) { /* best-effort */ }
      return true;
    }

    // Upload 1 ảnh base64 lên Flow qua background uploadToFlow. Retry khi BUSY (guard _uploadToFlowBusy).
    async _uploadFrameToFlow(base64, name) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const resp = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(
              { type: 'uploadToFlow', base64, name, mime: 'image/jpeg' },
              (r) => { void chrome.runtime.lastError; resolve(r || null); }
            );
          } catch (_) { resolve(null); }
        });
        if (resp?.ok) return resp;
        if (resp?.error === 'BUSY' && attempt < 2) { await this._sleep(1500 * (attempt + 1)); continue; }
        return resp;
      }
      return null;
    }

    /**
     * Update node status in storage
     */
    // ── Vô hiệu hoá dây chuyền ────────────────────────────────────────────────
    // Mọi trường kết quả một node có thể mang. Gom vào một chỗ để khi thêm loại
    // kết quả mới mà quên cập nhật đây thì chỉ hỏng một nơi, không rải rác.
    static get RESULT_FIELDS() {
      return ['result_file_ids', 'result_thumbnails', 'result_file_names',
        'result_provider_urls', 'result_text', 'result_source',
        'error_message', 'executed_at'];
    }

    /** BFS xuôi theo cạnh: mọi node nằm SAU nodeId (không gồm chính nó). */
    _collectDownstreamIds(workflow, nodeId) {
      const edges = workflow?.edges || [];
      const out = new Set();
      const queue = edges.filter((e) => e.source_node_id === nodeId).map((e) => e.target_node_id);
      while (queue.length) {
        const id = queue.shift();
        if (!id || out.has(id)) continue;   // `out` chặn luôn vòng lặp nếu đồ thị có chu trình
        out.add(id);
        edges.filter((e) => e.source_node_id === id).forEach((e) => queue.push(e.target_node_id));
      }
      out.delete(nodeId);
      return out;
    }

    /**
     * Chạy lại một node thì kết quả của MỌI node phía sau không còn đúng nữa.
     *
     * Không có bước này thì workflow báo "xong" trong khi video vẫn là bản dựng từ
     * ảnh cũ — sai âm thầm, tốn credit, và người dùng chỉ phát hiện khi xem lại.
     * Chế độ resume (bỏ qua node status='completed') làm lỗi này chắc chắn xảy ra
     * chứ không phải ngẫu nhiên.
     *
     * @returns {string[]} id các node đã bị xoá kết quả
     */
    invalidateDownstream(nodeId, workflow = null) {
      const wf = workflow || this.currentWorkflow;
      if (!wf?.nodes) return [];
      const ids = this._collectDownstreamIds(wf, nodeId);
      const cleared = [];
      for (const node of wf.nodes) {
        if (!ids.has(node.node_id)) continue;
        if (node.status !== 'completed' && node.status !== 'failed') continue;
        node.status = 'pending';
        for (const f of WorkflowExecutor.RESULT_FIELDS) delete node[f];
        this._nodeStatesLive[node.node_id] = 'pending';
        cleared.push(node.node_id);
      }
      if (cleared.length) {
        this._nodeStatesDirty = true;
        console.warn('[WorkflowExecutor] Xoá kết quả ' + cleared.length + ' node phía sau ' + nodeId);
        window.eventBus?.emit?.('workflow:downstream_invalidated', { nodeId, cleared });
      }
      return cleared;
    }

    async _updateNodeStatus(nodeId, status, fileIds = null, errorMessage = null, extra = null) {
      // [P2.7 Kênh 2] Ghi live state cho heartbeat enrich (kể cả 'running' — transient nhưng
      // web /app/spaces cần thấy node đang chạy khi reload giữa chừng).
      if (nodeId && status && this._nodeStatesLive[nodeId] !== status) {
        this._nodeStatesLive[nodeId] = status;
        this._nodeStatesDirty = true;
      }
      const data = { status };
      if (fileIds && (Array.isArray(fileIds) ? fileIds.length > 0 : fileIds)) {
        data.result_file_ids = Array.isArray(fileIds) ? fileIds.join(', ') : fileIds;
      }
      if (errorMessage) {
        data.error_message = errorMessage;
      }
      if (status === 'completed' || status === 'failed') {
        data.executed_at = new Date().toISOString();
      }
      // Bug fix ChatGPT/Grok image node: trước khi forward thumbnails/file_names qua extra,
      // PATCH endpoint chỉ persist result_file_ids → reload workflow → gallery trống vì
      // synthetic IDs (cg_xxx, grok_xxx) không có thumbnail data trong DOM Flow.
      if (extra && typeof extra === 'object') {
        if (extra.result_thumbnails) data.result_thumbnails = extra.result_thumbnails;
        if (extra.result_file_names) data.result_file_names = extra.result_file_names;
        // Dual URL — provider URL gốc (Grok/ChatGPT) cho manual download chất lượng 100%
        if (extra.result_provider_urls) data.result_provider_urls = extra.result_provider_urls;
        // Phase CG-8 — Prompt node: persist enhanced/plain text output cho downstream node.
        // Trước fix, result_text chỉ tồn tại trong memory → reload là mất → upstream_node fail.
        if (typeof extra.result_text === 'string') data.result_text = extra.result_text;
        if (typeof extra.result_source === 'string') data.result_source = extra.result_source;
      }

      // [API SPAM FIX — Phase 1.1] Update local workflow object TRƯỚC, để cả 2 path
      // (skip 'running' và persist 'completed'/'failed') đều giữ in-memory state.
      const node = this.currentWorkflow?.nodes?.find(n => n.node_id === nodeId);
      if (node) {
        Object.assign(node, data);
      }

      // [API SPAM FIX — Phase 1.1] Skip API call cho status='running' — transient state,
      // không cần persist DB. UI vẫn nhận update qua node:started event broadcast trong
      // _executeSingleNode (line ~921, 935) → workflow-editor-init listener cập nhật node UI.
      // Khi reload extension giữa workflow run: status node về 'pending' (không phải 'running'
      // giả) — acceptable vì af_running_workflow flag đã clear ở finally block của execute().
      // Reduces ~5 PATCH calls per 5-node workflow.
      if (status === 'running') {
        return;
      }

      // [API SPAM FIX — Phase 5] Buffer node state trong execution, flush 1 lần cuối
      // Thay vì N PATCH calls (mỗi node completed = 1 PATCH), buffer in-memory và
      // _flushNodeStateBuffer() gọi saveWorkflowFull() = 1 PUT toàn workflow.
      // Ngoài execution (vd manual single-node re-run) → call API ngay như cũ.
      if (this._executionInProgress) {
        const existing = this._nodeStateBuffer.get(nodeId) || {};
        this._nodeStateBuffer.set(nodeId, { ...existing, ...data });
        return;
      }

      await window.storageManager.updateNodeStatus(
        this.currentWorkflow.wf_id,
        nodeId,
        data
      );
    }

    /**
     * [API SPAM FIX — Phase 5] Flush buffered node states lên server = 1 PUT workflow_full.
     * Gọi cuối execute() (success hoặc error) để persist tất cả node final states.
     * Thay N PATCH calls (mỗi node) = 1 PUT toàn workflow → giảm ~70% API calls.
     */
    async _flushNodeStateBuffer() {
      if (this._nodeStateBuffer.size === 0) return;
      if (!this.currentWorkflow?.wf_id) {
        console.warn('[WorkflowExecutor] Cannot flush buffer: no current workflow');
        return;
      }

      // Merge buffer vào workflow.nodes để tạo snapshot đầy đủ
      const updatedNodes = (this.currentWorkflow.nodes || []).map(n => {
        const buffered = this._nodeStateBuffer.get(n.node_id);
        return buffered ? { ...n, ...buffered } : n;
      });

      try {
        // saveWorkflowFull = 1 PUT với workflow + nodes + edges
        await window.storageManager.saveWorkflowFull(
          this.currentWorkflow,
          updatedNodes,
          this.currentWorkflow?.edges || []
        );
        log('Flushed node state buffer:', this._nodeStateBuffer.size, 'nodes');
      } catch (e) {
        // BUG FIX 2026-06-05 (F1): KHÔNG fallback PATCH per-node khi 429 — amplify rate limit.
        // Trước: bulk fail 429 → fallback gọi N PATCH calls → cả N đều fail 429 → log spam errors.
        // Sau: check rate limit → skip fallback + log warn (state sẽ flush lần execute tiếp).
        const isRateLimit = e?.code === 'RATE_LIMITED' || e?.httpStatus === 429;
        if (isRateLimit) {
          console.warn('[WorkflowExecutor] Flush buffer rate-limited (429) — skip fallback PATCH per-node (sẽ retry lần execute tiếp)');
          return;
        }
        console.error('[WorkflowExecutor] Flush buffer failed, fallback PATCH từng node:', e);
        // Fallback: PATCH từng node 1 (đảm bảo không mất data)
        // Guard: kiểm tra lại vì saveWorkflowFull là async
        if (!this.currentWorkflow?.wf_id) return;
        for (const [nodeId, data] of this._nodeStateBuffer) {
          try {
            await window.storageManager.updateNodeStatus(
              this.currentWorkflow.wf_id, nodeId, data
            );
          } catch (err) {
            // Inner 429: stop loop để không amplify (per-node fallback after non-429 bulk fail)
            if (err?.code === 'RATE_LIMITED' || err?.httpStatus === 429) {
              console.warn('[WorkflowExecutor] Per-node PATCH rate-limited (429) — stop fallback loop');
              return;
            }
            console.error('[WorkflowExecutor] Fallback PATCH failed for node:', nodeId, err);
          }
        }
      }
    }

    /**
     * Update workflow status
     */
    async _updateWorkflowStatus(status) {
      // Guard: nếu workflow đã bị stop/clear thì skip
      if (!this.currentWorkflow?.wf_id) {
        console.warn('[WorkflowExecutor] _updateWorkflowStatus skipped - no current workflow');
        return;
      }
      const now = new Date().toISOString();
      const data = {
        wf_id: this.currentWorkflow.wf_id,
        status,
        updated_at: now
      };
      // Track last run time when starting
      if (status === 'running') {
        data.last_run_at = now;
      }
      console.log('[WorkflowExecutor] _updateWorkflowStatus:', status, 'wfId:', data.wf_id);
      await window.storageManager.saveWorkflow(data);
      console.log('[WorkflowExecutor] _updateWorkflowStatus done');
      // Guard: kiểm tra lại vì saveWorkflow là async
      if (!this.currentWorkflow) return;
      this.currentWorkflow.status = status;
      if (status === 'running') {
        this.currentWorkflow.last_run_at = now;
      }
    }

    /**
     * Update workflow progress.
     *
     * [API SPAM FIX — Phase 1.2] Trước fix: gọi PUT toàn workflow chỉ để update 4 field
     * (progress_completed, progress_total, current_node_id, updated_at) → mỗi node = 1 PUT
     * dư thừa. Reduces ~5 PUT calls per 5-node workflow.
     *
     * Sau fix: chỉ update in-memory + emit event. UI listeners (ExecutionTracker,
     * WorkflowList progress card) đã subscribe execution:progress nên vẫn nhận update
     * realtime. Backend dashboard nhận progress=N/N qua _updateWorkflowStatus('completed')
     * cuối execution — acceptable vì realtime backend dashboard không critical.
     */
    async _updateWorkflowProgress(completed, total, currentNodeId) {
      if (this.currentWorkflow) {
        this.currentWorkflow.progress_completed = completed;
        this.currentWorkflow.progress_total = total;
        this.currentWorkflow.current_node_id = currentNodeId;
      }
      // emitProgress() đã được caller gọi trước (line ~539, 595) → UI tự cập nhật.
      // Không cần API call.
    }

    /**
     * Sleep utility — breaks into 500ms chunks to allow stop checking
     */
    async _sleep(ms) {
      const chunks = Math.ceil(ms / 500);
      for (let i = 0; i < chunks; i++) {
        if (this.shouldStop) return;
        await new Promise(resolve => setTimeout(resolve, Math.min(500, ms - i * 500)));
      }
    }
  }

  // Export as singleton
  window.WorkflowExecutor = WorkflowExecutor;
  window.workflowExecutor = new WorkflowExecutor();

  // Gap 2 fix: expose TTL-aware running flag check để callers (WorkflowEditor,
  // WorkflowTab) dùng thay vì đọc trực tiếp af_running_workflow → tự động xử
  // lý stale flag (>30 phút auto-clear).
  WorkflowExecutor.getCrossContextRunning = readRunningFlag;
  WorkflowExecutor.clearCrossContextRunning = clearRunningFlag;

  /**
   * [API SPAM FIX — Phase 5.10] Recover buffered node states từ crash checkpoint.
   * Gọi khi load workflow trong editor để flush pending states nếu browser crash giữa execution.
   * @param {string} wfId - workflow ID
   * @returns {Promise<boolean>} - true nếu có buffer recovered, false nếu không
   */
  WorkflowExecutor.recoverBufferCheckpoint = async function(wfId) {
    if (!wfId) return false;
    try {
      const storageKey = `af_workflow_buffer_${wfId}`;
      const data = await new Promise(resolve => {
        chrome.storage.local.get([storageKey], r => resolve(r));
      });
      const buffer = data[storageKey];
      if (!buffer?.nodes || Object.keys(buffer.nodes).length === 0) return false;

      // Stale check: nếu buffer > 30 phút → ignore (workflow đã xong lâu rồi)
      const BUFFER_TTL_MS = 30 * 60 * 1000;
      if (buffer.timestamp && Date.now() - buffer.timestamp > BUFFER_TTL_MS) {
        console.info('[WorkflowExecutor] Discarding stale buffer checkpoint (>', BUFFER_TTL_MS/60000, 'min old)');
        chrome.storage.local.remove([storageKey]);
        return false;
      }

      // Flush stale buffer lên server từng node
      console.info('[WorkflowExecutor] Recovering buffer checkpoint:', Object.keys(buffer.nodes).length, 'nodes');
      for (const [nodeId, nodeData] of Object.entries(buffer.nodes)) {
        try {
          await window.storageManager?.updateNodeStatus(wfId, nodeId, nodeData);
        } catch (e) {
          console.warn('[WorkflowExecutor] Recovery PATCH failed for node:', nodeId, e);
        }
      }

      // Clear checkpoint sau recovery thành công
      chrome.storage.local.remove([storageKey]);
      console.info('[WorkflowExecutor] Buffer checkpoint recovered and cleared');
      return true;
    } catch (e) {
      console.error('[WorkflowExecutor] Buffer recovery error:', e);
      return false;
    }
  };

})();
