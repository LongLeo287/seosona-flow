/**
 * McpExecutor — Nhận lệnh từ AI agent (MCP) qua SSE event `ai_command`, thực thi trên
 * multi-provider (flow/chatgpt/grok), trả kết quả về backend `/mcp/result`.
 *
 * ⚠️ Q1: ĐỘC LẬP hoàn toàn với TelegramExecutor (copy pattern, KHÔNG import/gọi Telegram).
 * Chỉ dùng INFRA chung generic: ExecutionGate, ExecutionLock, PromptQueue, MessageBridge,
 * ChatGPTSession/GrokSession, workflowExecutor, authManager.
 *
 * Khác Telegram: event ai_command, endpoint mcp/result, command gen_image/gen_video/
 * upload_ref/run_workflow, error_code catalog (§4D.2), leader-guard (G3), run by wf_id (G1).
 */
class McpExecutor {
  static _currentJobId = null;
  static _isExecuting = false;
  static _cancelRequested = false; // set bởi _handleCancel → loop multi-prompt (chatgpt/grok) dừng sớm
  static _wasStopped = false; // set bởi execution:force_stopped (nút Stop UI / stop_all / cancel_all) → execute() báo CANCELLED cho agent
  static _initialized = false;
  static _currentExecutionToken = null;

  static init() {
    if (this._initialized) return;
    this._initialized = true;
    window.eventBus?.on('sse:ai_command', (data) => this._execute(data));
    window.eventBus?.on('sse:ai_cancel', (data) => this._handleCancel(data));
    // User dừng thủ công (nút Stop → stopAll), stop_all hay cancel_all đều emit force_stopped.
    // → đánh dấu job MCP đang chạy để execute() trả CANCELLED (agent biết bị stop, không tưởng completed/GEN_FAILED).
    window.eventBus?.on('execution:force_stopped', () => { if (this._currentJobId) this._wasStopped = true; });
    console.log('[McpExecutor] Đã khởi tạo');
  }

  /** G3: chỉ LEADER xử lý (follower nhận event qua BroadcastChannel forward → skip, tránh double-exec). */
  static _isLeaderContext() {
    const role = window.SseBroadcastManager?._role;
    return !role || role === 'leader';
  }

  static async _execute(data) {
    const { command, args, job_id } = data || {};
    if (!job_id) return;

    // G3 double-exec guard (đa cửa sổ)
    if (!this._isLeaderContext()) {
      console.log('[McpExecutor] follower context → skip', job_id);
      return;
    }

    // Validate shape + command whitelist (§4B.4.5)
    const VALID = ['gen_image', 'gen_video', 'upload_ref', 'run_workflow', 'create_project', 'open_project', 'get_context', 'get_provider_status', 'delete_chat', 'memory_search', 'memory_add', 'list_voices', 'list_models', 'list_capabilities', 'list_workflows', 'export_asset', 'list_projects', 'search_prompts'];
    if (!VALID.includes(command)) {
      await this._sendResult(job_id, 'failed', { errorCode: 'GEN_FAILED', errorMessage: `Lệnh không hỗ trợ: ${command}` });
      return;
    }

    // Read-only discovery (list_*) — FAST PATH: KHÔNG qua lock/quota/busy-gate, để MCP client (vd
    // SEOSONA Video AI V2) introspect năng lực Flow ngay cả khi 1 gen đang chạy. Leader-only (đã guard
    // ở trên). Đây là các lệnh mà error-message gen ("xem list_capabilities / dùng list_voices") trỏ tới.
    const READONLY = ['list_voices', 'list_models', 'list_capabilities', 'list_workflows', 'list_projects', 'search_prompts'];
    if (READONLY.includes(command)) {
      try {
        let r;
        if (command === 'list_voices') r = await this._executeListVoices(args);
        else if (command === 'list_models') r = await this._executeListModels(args);
        else if (command === 'list_capabilities') r = await this._executeListCapabilities(args);
        else if (command === 'list_workflows') r = await this._executeListWorkflows(args);
        else if (command === 'list_projects') r = await this._executeListProjects(args);
        else r = await this._executeSearchPrompts(args);
        // Route qua kênh `data` (không phải thumbnails) — _sendResult chỉ passthrough project/upload/data.
        await this._sendResult(job_id, 'completed', { data: r || {} });
      } catch (err) {
        await this._sendResult(job_id, 'failed', { errorCode: err?.code || 'GEN_FAILED', errorMessage: err?.message || String(err) });
      }
      return;
    }

    // FeatureGate double-check (§4B.4.1) — chỉ reject khi featureGate khẳng định false
    try {
      if (window.featureGate && window.featureGate.canUse && window.featureGate.canUse('mcp_enabled') === false) {
        await this._sendResult(job_id, 'failed', { errorCode: 'FEATURE_NOT_IN_PLAN', errorMessage: 'MCP chưa bật cho plan' });
        return;
      }
    } catch (_) { /* featureGate unavailable → backend đã gate, proceed */ }

    if (this._isExecuting) {
      await this._sendResult(job_id, 'failed', { errorCode: 'EXTENSION_BUSY', errorMessage: 'Extension đang xử lý lệnh MCP khác' });
      return;
    }

    this._currentJobId = job_id;
    this._isExecuting = true;
    this._cancelRequested = false;
    this._wasStopped = false;
    const provider = args?.provider || 'flow';

    try {
      // ExecutionLock — serialize với task/workflow/telegram đang chạy.
      // Fail-fast (không chờ) + báo RÕ đang bận tác vụ gì để Claude/user biết retry sau.
      if (window.ExecutionLock?.isBlockedBy('mcp')) {
        const st = window.ExecutionLock.getState?.() || {};
        const ownerLabels = { prompts: 'Prompt/Gen', task: 'Task', workflow: 'Workflow', angles: 'Angles', effects: 'Effects', queue: 'Queue' };
        const busy = st.label || ownerLabels[st.owner] || st.owner || 'tác vụ khác';
        await this._sendResult(job_id, 'failed', { errorCode: 'EXTENSION_BUSY', errorMessage: `Extension đang bận: ${busy}. Chờ xong rồi thử lại.` });
        return;
      }
      window.ExecutionLock?.acquire('mcp', `MCP: ${command}`);

      // ExecutionGate — trừ quota (extension là nơi DUY NHẤT trừ; upload_ref KHÔNG trừ — A4)
      this._currentExecutionToken = null;
      const execAction = this._mapCommandToAction(command, provider);
      if (execAction && window.ExecutionGate) {
        try {
          // Multi-prompt: quota = số prompt × số ảnh/prompt (gen_image) hoặc số prompt (video).
          const nPrompts = (Array.isArray(args?.prompts) && args.prompts.length) ? args.prompts.length : 1;
          const promptCount = command === 'gen_image'
            ? nPrompts * Math.min(args?.count || 1, 4)
            : command === 'gen_video' ? nPrompts : 1;
          const gate = await ExecutionGate.request(execAction, promptCount, { owner: 'mcp', label: `MCP: ${command}`, provider });
          if (!gate.allowed) {
            await this._sendResult(job_id, 'failed', { errorCode: 'DAILY_QUOTA_EXCEEDED', errorMessage: 'Đã hết lượt sử dụng trong ngày (quota). Chờ reset hoặc nâng plan — không retry ngay.' });
            return;
          }
          this._currentExecutionToken = gate.token;
        } catch (e) {
          if (window.QuotaErrorHandler?.isQuotaError?.(e)) {
            await this._sendResult(job_id, 'failed', { errorCode: 'DAILY_QUOTA_EXCEEDED', errorMessage: 'Đã hết lượt sử dụng trong ngày (quota). Chờ reset hoặc nâng plan — không retry ngay.' });
            return;
          }
          console.warn('[McpExecutor] ExecutionGate request failed, proceeding:', e.message);
        }
      }

      // Progress streaming: theo dõi snapshot queue để phát % cho MCP client (gen dài).
      this._progressUnsub = this._setupGenProgress(command);
      this._emitProgress(0, undefined, 'bắt đầu'); // milestone khởi động

      let result;
      switch (command) {
        case 'gen_image': result = await this._executeGen(args, false); break;
        case 'gen_video': result = await this._executeGen(args, true); break;
        case 'upload_ref': result = await this._executeUploadRef(args); break;
        case 'export_asset': result = await this._executeExportAsset(args); break;
        case 'run_workflow': result = await this._executeWorkflow(args); break;
        case 'create_project': result = await this._executeCreateProject(args); break;
        case 'open_project': result = await this._executeOpenProject(args); break;
        case 'get_context': result = await this._executeGetContext(); break;
        case 'memory_search': result = await this._executeMemorySearch(args); break;
        case 'memory_add': result = await this._executeMemoryAdd(args); break;
        case 'get_provider_status': result = await this._executeGetProviderStatus(args); break;
        case 'delete_chat': result = await this._executeDeleteChat(args); break;
      }

      if (this._wasStopped) {
        // Bị dừng giữa chừng (nút Stop / stop_all / cancel_all) → báo agent CANCELLED, KHÔNG completed.
        await this._sendResult(job_id, 'failed', { errorCode: 'CANCELLED', errorMessage: 'Đã huỷ (dừng thủ công hoặc cancel_all) trước khi hoàn tất.' });
        if (window.ExecutionGate && this._currentExecutionToken) {
          ExecutionGate.complete(this._currentExecutionToken, 'failed', { error: 'cancelled' });
          this._currentExecutionToken = null;
        }
      } else {
        await this._sendResult(job_id, 'completed', result || {});
        if (window.ExecutionGate && this._currentExecutionToken) {
          ExecutionGate.complete(this._currentExecutionToken, 'success');
          this._currentExecutionToken = null;
        }
      }
    } catch (err) {
      // Nếu bị dừng giữa chừng → CANCELLED (rõ ràng cho agent), không phải GEN_FAILED gây hiểu nhầm lỗi gen.
      const stopped = this._wasStopped;
      const code = stopped ? 'CANCELLED' : (err?.code || 'GEN_FAILED');
      const msg = stopped ? 'Đã huỷ (dừng thủ công hoặc cancel_all).' : (err?.message || String(err));
      if (!stopped) console.error('[McpExecutor] Lỗi:', err?.message);
      await this._sendResult(job_id, 'failed', { errorCode: code, errorMessage: msg });
      if (window.ExecutionGate && this._currentExecutionToken) {
        ExecutionGate.complete(this._currentExecutionToken, 'failed', { error: msg });
        this._currentExecutionToken = null;
      }
    } finally {
      if (this._progressUnsub) { try { this._progressUnsub(); } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor', _); } this._progressUnsub = null; }
      window.ExecutionLock?.release('mcp');
      this._currentJobId = null;
      this._isExecuting = false;
    }
  }

  // ─────────────────────────── MEMORY (MCP expose MemoryStore 3-tầng) ───────────────────────────
  static async _executeMemorySearch(args) {
    const MS = (typeof self !== 'undefined' && self.MemoryStore) || window.MemoryStore;
    if (!MS || !MS.search) return { results: [] };
    const q = (args && (args.query || args.q)) || '';
    const hits = await MS.search(q, { limit: (args && Number(args.limit)) || 8 });
    // Wrap trong `data` — _sendResult chỉ passthrough project/upload/data (else → coi là thumbnails, rớt).
    return { data: { results: (hits || []).map((h) => ({ text: h.text, tier: h.tier, score: h._score })) } };
  }

  static async _executeMemoryAdd(args) {
    const MS = (typeof self !== 'undefined' && self.MemoryStore) || window.MemoryStore;
    if (!MS || !MS.remember) return { data: { ok: false, error: 'MemoryStore unavailable' } };
    const text = (args && args.text) || '';
    if (!String(text).trim()) return { data: { ok: false, error: 'empty text' } };
    await MS.remember(String(text), (args && args.tags) || []);
    return { data: { ok: true } };
  }

  // ───────────── EXPORT (handoff: tải asset ra đĩa để V2 mux) ─────────────
  // Ở local mode, ảnh gen trả base64 inline (V2 dùng ngay), nhưng VIDEO chỉ có provider URL (R2 cần
  // backend = tắt) → V2 không fetch được (cần session Google). export_asset để extension tải asset
  // kèm cookie (chromeDownload native) ra Downloads/<folder>/<file_name> → V2 (process local) đọc file.
  static _sanitizeSeg(s) {
    return String(s || '')
      .replace(/[\\/:*?"<>|]+/g, '_')  // path-sep + ký tự cấm Windows
      .replace(/\.\.+/g, '_')          // chặn traversal
      .replace(/^\.+/, '').trim().slice(0, 120);
  }

  static async _executeExportAsset(args) {
    const a = args || {};
    const url = a.video_url || a.url || '';
    if (!url) throw this._err('VALIDATION_ERROR', 'export_asset cần `url` hoặc `video_url` (lấy từ FlowAsset của kết quả gen).');
    if (!/^https?:\/\//i.test(url) && !/^data:/i.test(url)) throw this._err('VALIDATION_ERROR', 'url phải là http(s) hoặc data: URL.');
    const dl = await this._getMcpDownloadSettings();
    const folder = this._sanitizeSeg(a.folder || dl.downloadFolder || 'seosonaflow_mcp');
    let name = this._sanitizeSeg(a.file_name || '');
    if (!name) {
      const isVideo = !!a.video_url || a.kind === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(url);
      name = `asset_${Date.now()}.${isVideo ? 'mp4' : 'png'}`;
    }
    const filename = folder ? `${folder}/${name}` : name;
    const _dlUrl = await (globalThis.scrubbedDownloadUrl?.(url) ?? url);
    const r = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'chromeDownload', url: _dlUrl, filename, waitForComplete: true },
          (resp) => resolve(resp || { success: false, error: 'NO_RESPONSE' }));
      } catch (e) { resolve({ success: false, error: e.message }); }
    });
    if (!r || r.success === false) {
      throw this._err('GEN_FAILED', `Tải asset thất bại: ${r?.error || r?.message || 'lỗi'}. URL phải mở được bằng session Google hiện tại (dùng url/video_url từ kết quả gen gần đây).`);
    }
    // Trả đường dẫn tương đối trong Downloads để V2 đọc file (Chrome không lộ absolute path).
    return { data: { download: { folder, file_name: name, path_hint: `Downloads/${folder ? folder + '/' : ''}${name}`, status: 'completed' } } };
  }

  // ───────────── DISCOVERY (read-only introspection cho MCP client / SEOSONA Video AI V2) ─────────────
  // Cho V2 (hoặc agent) hỏi Flow "làm được gì" TRƯỚC khi gen: giọng nào, model nào (model nào bake voice),
  // tỉ lệ nào, workflow nào chạy được → tránh submit sai model/voice rồi VALIDATION_ERROR giữa chừng.

  static async _executeListVoices(args) {
    const provider = (args && args.provider) || 'flow';
    let list = [];
    try { list = (await window.VoiceRegistry?.getRenderList?.(provider)) || []; } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor', _); }
    return {
      voices: (list || []).map((v) => ({
        slug: v.slug,
        display_name: v.display_name || v.name || v.slug,
        description: v.description || '',
        is_custom: !!v.is_custom,   // giọng custom của tài khoản Google user (scraped) vs base catalog
      })),
    };
  }

  static _mapModelList(arr) {
    return (Array.isArray(arr) ? arr : []).map((m) => ({
      value: m.value,                                   // slug dùng làm arg `model` khi gen
      label: m.name || m.value,
      is_default: !!m.is_default,
      is_premium: !!m.is_premium,
      supports_voice: !!(m.config && m.config.supports_voice), // model bake được voice (Veo)
      config: m.config || null,
    }));
  }

  static async _executeListModels(args) {
    const provider = (args && args.provider) || 'flow';
    let image = [], video = [];
    try { image = await window.ModelRegistry?.getModels?.(provider, 'image'); } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor', _); }
    try { video = await window.ModelRegistry?.getModels?.(provider, 'video'); } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor', _); }
    return { image_models: this._mapModelList(image), video_models: this._mapModelList(video) };
  }

  static async _executeListCapabilities(args) {
    const provider = (args && args.provider) || 'flow';
    const models = await this._executeListModels(args);
    const voices = await this._executeListVoices(args);
    const voiceModels = (models.video_models || []).filter((m) => m.supports_voice).map((m) => m.value);
    return {
      provider,
      ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      image_models: models.image_models,
      video_models: models.video_models,
      voice_supported_video_models: voiceModels,
      voices: voices.voices,
      // Ranh giới scope với SEOSONA Video AI V2: Veo tự BAKE giọng vào video khi chọn voice + model
      // supports_voice. Cho pipeline V2, nên gen video CÂM ở Flow và để V2 làm voiceover → content↔voice khớp.
      note: voiceModels.length
        ? 'Veo bakes voice INTO the generated video when a voice + a voice-capable video model is used. For the Video AI V2 pipeline, prefer generating SILENT b-roll here and let V2 own the voiceover (keeps content↔voice aligned).'
        : 'No voice-capable video model in cache yet (open the Flow tab first, then re-query).',
    };
  }

  static async _executeListWorkflows(args) {
    let res = null;
    try { res = await window.storageManager?.getWorkflows?.(); } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor', _); }
    const arr = Array.isArray(res) ? res : (res && Array.isArray(res.data) ? res.data : []);
    const kind = args && args.flow_kind;   // optional filter, vd 'flow' để chỉ lấy Flows chạy được
    const list = arr
      .filter((w) => !kind || w.flow_kind === kind)
      .map((w) => ({
        wf_id: w.wf_id,
        name: w.name || '(không tên)',
        flow_kind: w.flow_kind || null,
        project_id: w.project_id || (w.project && w.project.project_id) || null,
        node_count: Array.isArray(w.nodes) ? w.nodes.length : undefined,
        updated_at: w.updated_at || null,
      }));
    return { workflows: list, count: list.length };
  }

  // Liệt kê project Flow đã scan (app.js lưu ở storage af_projects: {id → {name,last_accessed}}).
  // Đọc storage (KHÔNG thọc tab → không cướp focus) → V2 tự chọn project cho open_project.
  static async _executeListProjects() {
    let store = {};
    try { store = await new Promise((r) => chrome.storage.local.get('af_projects', (res) => r((res && res.af_projects) || {}))); } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor', _); }
    const projects = Object.entries(store || {}).map(([id, v]) => ({
      project_id: id,
      project_name: (v && (v.name || v.title)) || null,
      last_accessed: (v && v.last_accessed) || 0,
    })).sort((a, b) => (b.last_accessed || 0) - (a.last_accessed || 0));
    return { projects, count: projects.length };
  }

  static _promptDto(p) {
    return {
      id: p.id != null ? p.id : (p.slug || p.title || ''),
      title: p.title || '',
      text: p.content || p.text || p.prompt || '',  // BundledPrompts dùng field `content`
      tags: Array.isArray(p.tags) ? p.tags : [],
      category: p.category || '',
      tier: p.tier || '',
    };
  }

  // Tìm trong kho prompt đóng gói (SEOSONA_BUNDLED_PROMPTS). `id` = tra chính xác (cho MCP GetPrompt).
  static async _executeSearchPrompts(args) {
    const a = args || {};
    const all = ((typeof self !== 'undefined' && self.SEOSONA_BUNDLED_PROMPTS) || window.SEOSONA_BUNDLED_PROMPTS || []);
    const norm = (s) => String(s || '').toLowerCase();
    if (a.id != null) {
      const hit = all.find((p) => String(p.id) === String(a.id));
      return { prompts: hit ? [this._promptDto(hit)] : [], count: hit ? 1 : 0, total: all.length };
    }
    const q = norm(a.query);
    const tags = (Array.isArray(a.tags) ? a.tags : []).map(norm).filter(Boolean);
    const limit = Math.min(Math.max(Number(a.limit) || 15, 1), 50);
    let list = all;
    if (q || tags.length) {
      list = all.filter((p) => {
        const hay = norm(p.title) + ' ' + norm(p.content) + ' ' + norm((p.tags || []).join(' ')) + ' ' + norm(p.category);
        return (!q || hay.includes(q)) && (!tags.length || tags.every((t) => hay.includes(t)));
      });
    }
    return { prompts: list.slice(0, limit).map((p) => this._promptDto(p)), count: Math.min(list.length, limit), total: list.length };
  }

  // ─────────────────────────── GEN ───────────────────────────

  static async _executeGen(args, isVideo) {
    const provider = args.provider || 'flow';
    if (provider === 'chatgpt') return this._executeChatGPTGen(args);
    if (provider === 'grok') return this._executeGrokGen(args, isVideo);
    return this._executeFlowGen(args, isVideo);
  }

  static async _executeFlowGen(args, isVideo) {
    const { prompt, prompts, ratio, model, count, refs, refs_per_prompt, ref_mode, duration, video_input_type, voice, reuse_refs } = args;

    // Multi-prompt: nhiều prompt KHÁC nhau trong 1 job (mỗi prompt 1 ảnh/video). Bypass queue (1 slot).
    const promptList = (Array.isArray(prompts) && prompts.length) ? prompts.filter(Boolean) : (prompt ? [prompt] : []);
    if (!promptList.length) throw this._err('GEN_FAILED', 'Thiếu prompt/prompts.');

    // MCP is an explicit execution request and owns this queue job. The user-facing
    // pipeline toggle only chooses the interactive UI path; it must not disable MCP.
    if (!window.PromptQueue) {
      throw this._err('GEN_FAILED', 'PromptQueue chưa được nạp trong extension.');
    }

    // Pre-check: Flow gen BẮT BUỘC có tab Flow MỞ + đang TRONG 1 project (editor chỉ tồn tại trong project).
    // Nếu chưa → trả lỗi RÕ RÀNG thay vì để gen silent-fail (0 ảnh → GEN_FAILED khó hiểu).
    // Claude có thể tự recover: gọi create_project → retry gen.
    try {
      if (window.ProjectHelper?.isFlowProjectReady) {
        const ready = await window.ProjectHelper.isFlowProjectReady();
        if (!ready) {
          throw this._err('PROVIDER_TAB_NOT_READY', 'Chưa mở Google Flow hoặc chưa vào 1 project. Hãy mở Flow + vào/tạo 1 project (hoặc gọi create_project) rồi thử lại.');
        }
      }
    } catch (e) {
      if (e?.code) throw e; // lỗi pre-check có chủ đích → ném tiếp
      // ProjectHelper lỗi bất ngờ → KHÔNG chặn (để gen thử, fallback GEN_FAILED nếu thật sự không gen được)
    }

    // Activate Flow tab lên FOREGROUND trước gen (giống GenTab → 'activateFlowTabForExecution').
    // Tab nền bị browser throttle timers/DOM → Slate editor có thể không nhận input đúng; đưa tab lên
    // foreground để thao tác editor ổn định. Await + settle nhỏ để tab active trước khi EditorExecutor type.
    try {
      await new Promise((r) => chrome.runtime.sendMessage({ action: 'activateFlowTabForExecution', focusWindow: true }, () => r()));
      await new Promise((r) => setTimeout(r, 400));
    } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#norm', _); }

    // Upload refs (base64/URL) → Flow tileIds. 3 mode:
    //  - refs_per_prompt (array-of-arrays, theo từng prompt) → 'sequential' (vd Frames: [frame1,frame2]/prompt)
    //  - refs (flat) → 'all' (dùng chung mọi prompt — vd giữ 1 nhân vật xuyên suốt)
    //  - ref_mode='none' → bỏ refs
    const refFileIds = [];
    const refFileNames = {};
    let refFileIdsPerPrompt = null;
    let refImageMode = 'none';
    const _uploadOne = async (ref) => {
      const up = await this._uploadRefToFlow(ref);
      if (up?.tileId) { if (up.fileName) refFileNames[up.tileId] = up.fileName; return up.tileId; }
      return null;
    };
    if (ref_mode !== 'none' && Array.isArray(refs_per_prompt) && refs_per_prompt.length) {
      refImageMode = 'sequential';
      refFileIdsPerPrompt = [];
      for (const refSet of refs_per_prompt) {
        const ids = [];
        for (const ref of (Array.isArray(refSet) ? refSet : [])) {
          const id = await _uploadOne(ref); if (id) ids.push(id);
        }
        refFileIdsPerPrompt.push(ids);
      }
    } else if (ref_mode !== 'none' && Array.isArray(refs) && refs.length) {
      refImageMode = 'all';
      for (const ref of refs) { const id = await _uploadOne(ref); if (id) refFileIds.push(id); }
    }

    // reuse_refs: tái dùng kết quả gen trước làm Flow ref (không cần re-emit base64/upload tay).
    //  - provider=flow → resolve file_name/tile_id → tile hiện tại (xử lý reload) qua window.resolveFileIdsString.
    //  - provider=chatgpt/grok → fetch url qua tab provider (cookie) → base64 → upload sang Flow (cross-provider bridge).
    // Toàn hàm tái dùng đã test (resolveFileIdsString / chatGPTFetchImage / grokFetchImage / _uploadRefToFlow).
    if (ref_mode !== 'none' && Array.isArray(reuse_refs) && reuse_refs.length) {
      const reuseTiles = await this._resolveReuseRefs(reuse_refs, refFileNames);
      for (const t of reuseTiles) if (!refFileIds.includes(t)) refFileIds.push(t);
      // 'all' nếu chưa có mode; KHÔNG ghi đè 'sequential' (refs_per_prompt) — combo hiếm, tránh phá mode.
      if (reuseTiles.length && refImageMode !== 'sequential') refImageMode = 'all';
    }

    const genType = isVideo ? 'Video' : 'Image';
    const quantity = isVideo ? 1 : Math.min(count || 1, 4);
    const isFrames = isVideo && (video_input_type !== 'Ingredients'); // default Frames

    // §13 model constraints (mirror GenTab — trước đây MCP BỎ SÓT): Veo Lite/Fast +ref→ép 8s;
    // Veo Quality Ingredients→KHÔNG hỗ trợ ref. Áp duration override + strip ref nếu model không hỗ trợ.
    let flowDuration = isVideo ? (duration || null) : null;
    const inputType = isFrames ? 'Frames' : 'Ingredients';
    const hasRef = refFileIds.length > 0 || (Array.isArray(refFileIdsPerPrompt) && refFileIdsPerPrompt.some(a => a?.length));
    const flowAdapter = window.ProviderRegistry?.get?.('flow');
    if (isVideo && hasRef && model && flowAdapter?.getDurationOverride) {
      try {
        const forced = flowAdapter.getDurationOverride({ modelValue: model, hasRef: true, inputType });
        if (forced && forced !== flowDuration) {
          console.warn(`[McpExecutor] §13 duration ép ${flowDuration} → ${forced} (${model} + ref)`);
          flowDuration = forced;
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#_uploadOne', _); }
    }
    if (hasRef && model && flowAdapter?.supportsRefImages) {
      try {
        const ok = flowAdapter.supportsRefImages(model, {
          inputType: isVideo ? inputType : undefined,
          duration: isVideo ? (flowDuration || undefined) : undefined,
        });
        if (!ok) {
          console.warn(`[McpExecutor] §13 model "${model}" (${inputType}) không hỗ trợ ref → bỏ refs`);
          refFileIds.length = 0;
          refFileIdsPerPrompt = null;
          refImageMode = 'none';
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#_uploadOne', _); }
    }

    // Lưu local (opt-in, mirror Telegram). Mặc định OFF — MCP trả kết quả cho AI là chính.
    // Bật qua setting mcpAutoDownload → tải về đĩa user kèm resolution chọn (giải quyết gap video res).
    const dl = await this._getMcpDownloadSettings();

    // Voice (CHỈ video + model có config.supports_voice). Gate theo provider_models config,
    // resolve slug → {slug, search_value} (VoiceRegistry) để EditorExecutor chọn giọng trong Flow.
    let voicePayload = null;
    if (isVideo && voice) {
      const modelObj = model ? window.ModelRegistry?.findModel?.('flow', model) : null;
      if (!modelObj?.config?.supports_voice) {
        throw this._err('VALIDATION_ERROR', `Model "${model || '(mặc định)'}" không hỗ trợ voice. Chọn model có supports_voice (xem list_capabilities) hoặc bỏ voice.`);
      }
      let vlist = [];
      try { vlist = (await window.VoiceRegistry?.getRenderList?.('flow')) || []; } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#_uploadOne', _); }
      const v = vlist.find(x => x.slug === voice);
      if (!v?.search_value) {
        throw this._err('VALIDATION_ERROR', `Voice "${voice}" không hợp lệ. Dùng list_voices để lấy slug đúng.`);
      }
      voicePayload = { slug: v.slug, search_value: v.search_value };
    }

    const result = await PromptQueue.getInstance().submitJob({
      owner: 'mcp',
      label: isVideo ? 'MCP Video' : 'MCP Generate',
      _executionToken: this._currentExecutionToken, // forward token (không xin mới)
      prompts: promptList,
      voice: voicePayload, // PromptQueue merge vào settings.voice nếu có search_value
      settings: {
        genType,
        ratio: this._mapRatio(ratio) || 'Dọc',
        model: model || null,
        quantity,
        isFrames,
        flowVideoDuration: flowDuration,
      },
      refImageMode,
      refFileIds,
      refFileIdsPerPrompt,
      refFileNames,
      autoDownload: dl.autoDownload, // opt-in lưu local (mcpAutoDownload) — vẫn trả kết quả cho AI song song
      downloadResolution: dl.downloadResolution,
      videoDownloadResolution: dl.videoDownloadResolution,
      taskName: dl.autoDownload ? dl.downloadFolder : null,
    });

    const thumbs = this._collectThumbs(result?.resultThumbnails);
    if (thumbs.length === 0) throw this._err('GEN_FAILED', 'Flow không tạo được kết quả (0 ảnh/video).'); // Bug 52 pattern
    thumbs.forEach((t) => { t.provider = 'flow'; });
    const allRefIds = [...refFileIds, ...(Array.isArray(refFileIdsPerPrompt) ? refFileIdsPerPrompt.flat() : [])];
    await this._saveGenHistory({ promptList, mediaType: isVideo ? 'video' : 'image', model, ratio, quantity, refFileIds: allRefIds, thumbs, resultFileIds: result?.resultTileIds || [], provider: 'flow' });
    // Multi-prompt: trả per-prompt fail detail (PromptQueue có sẵn failedPrompts) → AI retry đúng prompt thiếu.
    return { thumbnails: thumbs, batch: this._buildBatch(promptList.length, result?.failedPrompts, result?.completed) };
  }

  static async _executeChatGPTGen(args) {
    const { prompt, prompts, ratio, model, refs } = args;
    const promptList = (Array.isArray(prompts) && prompts.length) ? prompts.filter(Boolean) : (prompt ? [prompt] : []);
    if (!promptList.length) throw this._err('GEN_FAILED', 'Thiếu prompt/prompts.');
    if (!window.ChatGPTSession) throw this._err('PROVIDER_TAB_NOT_READY', 'Chưa mở tab ChatGPT.');

    const ready = await window.ChatGPTSession.ensureReady({ createIfMissing: true, activate: true, focusWindow: true });
    if (!ready.ready) {
      throw ready.error === 'NOT_LOGGED_IN'
        ? this._err('PROVIDER_NOT_LOGGED_IN', 'Vui lòng đăng nhập ChatGPT.')
        : this._err('PROVIDER_TAB_NOT_READY', `ChatGPT không sẵn sàng: ${ready.error}`);
    }
    if (!window.MessageBridge?.chatGPTSubmitAndWait) throw this._err('PROVIDER_TAB_NOT_READY', 'MessageBridge ChatGPT không khả dụng.');

    const images = await this._resolveRefsToImages(refs);
    const settings = await window.storageSettings?.getSettings();
    const fallbackPrefix = settings?.chatgptFallbackPrefix || 'Generate an image of: ';

    // Multi-prompt: lặp từng prompt (ChatGPT submit tuần tự). Partial-tolerant: 1 prompt fail KHÔNG kill cả batch.
    const thumbs = [];
    const failedPrompts = [];
    let lastErr = null;
    for (let idx = 0; idx < promptList.length; idx++) {
      const p = promptList[idx];
      if (this._cancelRequested) { failedPrompts.push({ index: idx, prompt: p, error: 'Đã huỷ' }); continue; }
      try {
        const result = await window.MessageBridge.chatGPTSubmitAndWait({
          text: p,
          images,
          settings: { imageMode: true, ratio: this._mapRatioToChatGPT(ratio), model: model || null, fallbackPrefix },
          timeout: window.SystemConfig?.getTimeout('chatgpt_timeout_ms') || 120000,
          tabId: ready.tabId,
          taskName: 'MCP ChatGPT',
        });
        if (!result?.success) { lastErr = result?.message || result?.error; failedPrompts.push({ index: idx, prompt: p, error: lastErr }); continue; }
        const before = thumbs.length;
        for (const url of (result.imageUrls || [])) {
          thumbs.push({ url, type: 'image', file_name: `chatgpt_${url.slice(-12)}.png`, provider: 'chatgpt' });
        }
        if (thumbs.length === before) failedPrompts.push({ index: idx, prompt: p, error: 'Không có ảnh trả về' });
      } catch (e) { lastErr = e?.message; failedPrompts.push({ index: idx, prompt: p, error: lastErr }); }
    }
    if (thumbs.length === 0) throw this._err('GEN_FAILED', lastErr || 'ChatGPT không tạo được ảnh.');
    await this._saveGenHistory({ promptList, mediaType: 'image', model, ratio, quantity: 1, refFileIds: [], thumbs, resultFileIds: [], provider: 'chatgpt' });
    return { thumbnails: thumbs, _tabId: ready.tabId, batch: this._buildBatch(promptList.length, failedPrompts) };
  }

  static async _executeGrokGen(args, isVideo) {
    const { prompt, prompts, ratio, refs, duration, resolution } = args;
    const promptList = (Array.isArray(prompts) && prompts.length) ? prompts.filter(Boolean) : (prompt ? [prompt] : []);
    if (!promptList.length) throw this._err('GEN_FAILED', 'Thiếu prompt/prompts.');
    if (!window.GrokSession) throw this._err('PROVIDER_TAB_NOT_READY', 'Chưa mở tab Grok.');

    const ready = await window.GrokSession.ensureReady({ createIfMissing: true, activate: true, focusWindow: true });
    if (!ready.ready) {
      throw ready.error === 'NOT_LOGGED_IN'
        ? this._err('PROVIDER_NOT_LOGGED_IN', 'Vui lòng đăng nhập Grok.')
        : this._err('PROVIDER_TAB_NOT_READY', `Grok không sẵn sàng: ${ready.error}`);
    }
    if (!window.MessageBridge?.grokSubmitAndWait) throw this._err('PROVIDER_TAB_NOT_READY', 'MessageBridge Grok không khả dụng.');

    const mode = isVideo ? 'video' : 'image';
    try { await window.GrokSession.setMode(mode); } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#_uploadOne', _); }
    const images = await this._resolveRefsToImages(refs);

    // Multi-prompt: lặp từng prompt (Grok submit tuần tự). Partial-tolerant.
    const thumbs = [];
    const failedPrompts = [];
    let lastErr = null;
    for (let idx = 0; idx < promptList.length; idx++) {
      const p = promptList[idx];
      if (this._cancelRequested) { failedPrompts.push({ index: idx, prompt: p, error: 'Đã huỷ' }); continue; }
      try {
        const result = await window.MessageBridge.grokSubmitAndWait({
          text: p,
          images,
          settings: {
            mode,
            ratio: this._mapRatioToGrok(ratio),
            duration: duration || '6s',
            resolution: resolution || '720p',
            imageQuality: 'speed',
          },
          timeout: isVideo ? (window.SystemConfig?.getTimeout('video_timeout_ms') || 600000) : (window.SystemConfig?.getTimeout('image_timeout_ms') || 300000),
          tabId: ready.tabId,
          taskName: 'MCP Grok',
        });
        if (!result?.success) { lastErr = result?.message || result?.error; failedPrompts.push({ index: idx, prompt: p, error: lastErr }); continue; }
        const mediaType = result.mediaType || (isVideo ? 'video' : 'image');
        const urls = result.mediaUrls || result.imageUrls || [];
        const before = thumbs.length;
        for (const url of urls) {
          const fetched = result.fetchedMedia?.find(f => f.url === url); // Grok pre-fetched base64 (cookie-protected)
          thumbs.push({
            url,
            type: mediaType,
            file_name: `grok_${url.slice(-12)}.${mediaType === 'video' ? 'mp4' : 'png'}`,
            video_url: mediaType === 'video' ? url : '',
            base64: fetched?.base64 || null,
            provider: 'grok',
          });
        }
        if (thumbs.length === before) failedPrompts.push({ index: idx, prompt: p, error: 'Không có kết quả trả về' });
      } catch (e) { lastErr = e?.message; failedPrompts.push({ index: idx, prompt: p, error: lastErr }); }
    }
    if (thumbs.length === 0) throw this._err('GEN_FAILED', lastErr || 'Grok không tạo được kết quả.');
    await this._saveGenHistory({ promptList, mediaType: isVideo ? 'video' : 'image', model: '', ratio, quantity: 1, refFileIds: [], thumbs, resultFileIds: [], provider: 'grok' });
    return { thumbnails: thumbs, _tabId: ready.tabId, batch: this._buildBatch(promptList.length, failedPrompts) };
  }

  // ─────────────────────────── UPLOAD REF (§4E.7) ───────────────────────────

  static async _executeUploadRef(args) {
    const up = await this._uploadRefToFlow(args.image);
    if (!up?.tileId) throw this._err('UPLOAD_FAILED', 'Upload ảnh tham chiếu thất bại.');
    // Chỉ gửi field non-empty: backend validate thumbnail_url regex ^https → '' sẽ fail 422.
    const upload = { file_id: up.tileId };
    if (up.fileName) upload.file_name = up.fileName;
    if (up.thumbnailUrl && /^https?:\/\//i.test(up.thumbnailUrl)) upload.thumbnail_url = up.thumbnailUrl;
    return { upload };
  }

  /** Upload 1 ref (base64 hoặc http URL) lên Flow → {tileId, fileName, thumbnailUrl}. */
  static async _uploadRefToFlow(ref) {
    if (!ref || typeof ref !== 'string') return null;
    if (!window.MessageBridge?.uploadFilesToFlow) throw this._err('PROVIDER_TAB_NOT_READY', 'MessageBridge upload không khả dụng.');

    // Ensure Flow tab ready
    if (window.ImmediateUploader?._ensureFlowTabReady) {
      try {
        const act = await window.ImmediateUploader._ensureFlowTabReady();
        if (!act?.isOpen) throw this._err('PROVIDER_TAB_NOT_READY', 'Chưa mở tab Google Flow.');
      } catch (e) { if (e?.code) throw e; }
    }

    let base64 = ref;
    if (/^https?:\/\//i.test(ref)) {
      // M7 (SSRF): block private/loopback/link-local ref URLs from agent input.
      if (!this._isSafePublicUrl(ref)) {
        throw this._err('REF_FETCH_FAILED', `URL ref không hợp lệ (chặn địa chỉ nội bộ/loopback): ${ref}. Chỉ dùng URL public http(s).`);
      }
      const resp = await new Promise((resolve, reject) => {
        // expectImage → chặn HTML (trang login CDN trả 200) thay vì upload "ảnh" rác lên Flow.
        chrome.runtime.sendMessage({ action: 'fetchBlob', url: ref, expectImage: true }, (r) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        });
      });
      if (!resp?.success || !resp.base64) {
        throw this._err('REF_FETCH_FAILED', `Không tải được ảnh ref từ URL: ${ref} (${resp?.error || 'lỗi không xác định'}). Dùng URL public mở trực tiếp được (không cần đăng nhập/cookie).`);
      }
      base64 = resp.base64;
    } else if (base64.startsWith('data:')) {
      base64 = base64.split(',')[1] || base64;
    }

    const result = await window.MessageBridge.uploadFilesToFlow([{ name: 'mcp_ref.jpg', type: 'image/jpeg', base64 }]);
    const tileId = result?.orderedTileIds?.[0] || result?.tileIds?.[0] || null;
    if (!tileId) throw this._err('UPLOAD_FAILED', 'Upload xong nhưng không nhận được tile.');
    const fileName = window.MediaRegistry?.getFileName?.(tileId) || window.GenTab?.fileNameCache?.[tileId] || '';
    const thumbnailUrl = window.MediaRegistry?.getThumb?.(tileId) || '';
    return { tileId, fileName, thumbnailUrl };
  }

  // ─────────────────────────── CREATE PROJECT ───────────────────────────

  /**
   * Tạo Flow project MỚI (tái dùng cơ chế UI: clickCreateNewProject — background click nút Flow).
   * Sau đó Flow tab ở project mới → gen_image kế tiếp tự gen trong project này.
   * Trả {project:{project_id, project_name}} (best-effort đọc từ window._currentProjectId).
   */
  static async _executeCreateProject(args) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const oldId = window._currentProjectId || null;

    // 1. Dùng ĐÚNG flow nút "Tạo dự án mới" ở sidebar (app.js _createNewProject — smart: tìm Flow
    //    HOMEPAGE tab → activate; nếu không có → navigate flowHome; rồi clickCreateNewProject).
    //    Nút tạo project CHỈ có ở homepage → flow này lo việc về homepage. Expose qua window._createNewProject.
    if (typeof window._createNewProject === 'function') {
      try { await window._createNewProject(); }
      catch (e) { throw this._err('PROVIDER_TAB_NOT_READY', `Tạo project thất bại: ${e?.message || e}`); }
    } else {
      // Fallback (context không có app.js, vd background/editor): navigate homepage + activate + click.
      try {
        const flowHome = window.ProviderConfigManager?.getBaseUrlSync?.('flow') || 'https://labs.google/fx/tools/flow';
        await new Promise((r) => chrome.runtime.sendMessage({ action: 'navigateToProject', url: flowHome }, () => r()));
        await sleep(1800);
        await new Promise((r) => chrome.runtime.sendMessage({ action: 'activateFlowTabForExecution', focusWindow: true }, () => r()));
        await sleep(300);
      } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#sleep', _); }
      const resp = await new Promise((resolve) => {
        try { chrome.runtime.sendMessage({ action: 'clickCreateNewProject' }, (r) => resolve(r)); }
        catch (e) { resolve({ success: false, error: e?.message }); }
      });
      if (!resp?.success) {
        throw this._err('PROVIDER_TAB_NOT_READY', resp?.error || resp?.result?.error || 'Không tạo được project (không thấy nút Tạo dự án trên Flow).');
      }
    }

    // 3. Poll project mới (sidebar tự cập nhật window._currentProjectId qua background projectContext khi Flow điều hướng)
    let newId = null;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const cur = window._currentProjectId;
      if (cur && cur !== oldId) { newId = cur; break; }
    }

    // Naming qua MCP đã bỏ (synthetic setFlowProjectName → Flow nhận diện bot + không persist).
    // Flow tự đặt tên timestamp; AI dùng project_id để thao tác.
    return {
      project: {
        project_id: newId || window._currentProjectId || null,
        project_name: window._currentProjectName || null,
      },
    };
  }

  /**
   * Mở Flow project ĐÃ CÓ theo project_id (chuyển Flow tab sang project đó).
   * Dùng để recover WRONG_PROJECT trước run_workflow (Claude hỏi user → open_project → run lại).
   * Trả {project:{project_id, project_name}}.
   */
  static async _executeOpenProject(args) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const projectId = args?.project_id;
    if (!projectId) throw this._err('GEN_FAILED', 'Thiếu project_id');
    if (window._currentProjectId === projectId) {
      // Đã ở đúng project rồi → chỉ verify ready
      const ready = await window.ProjectHelper?.isFlowProjectReady?.();
      if (ready === false) throw this._err('PROVIDER_TAB_NOT_READY', `Project ${projectId} đang lỗi hoặc đã bị xoá.`);
      let nm = null; try { nm = await window.ProjectHelper?.getProjectName?.(projectId); } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#sleep', _); }
      return { project: { project_id: projectId, project_name: nm || window._currentProjectName || null } };
    }

    // 1. Đảm bảo có tab Flow (mở Flow home nếu chưa)
    try {
      const ensureResp = await new Promise((r) => chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, (resp) => r(resp)));
      if (!ensureResp?.ok) {
        const flowHome = window.ProviderConfigManager?.getBaseUrlSync?.('flow') || 'https://labs.google/fx/tools/flow';
        await new Promise((r) => chrome.runtime.sendMessage({ action: 'navigateToProject', url: flowHome }, () => r()));
        await sleep(1500);
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#sleep', _); }

    // 2. Navigate Flow tab sang project id (ProjectHelper build URL /project/{id})
    if (window.ProjectHelper?.navigateToProject) {
      window.ProjectHelper.navigateToProject(projectId);
    } else {
      const flowBase = window.ProviderConfigManager?.getBaseUrlSync?.('flow') || 'https://labs.google/fx/tools/flow';
      await new Promise((r) => chrome.runtime.sendMessage({ action: 'navigateToProject', url: `${flowBase}/project/${projectId}`, projectId }, () => r()));
    }

    // 3. Poll tới khi context cập nhật đúng project (tối đa ~30s)
    let ok = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      if (window._currentProjectId === projectId) { ok = true; break; }
    }
    if (!ok) throw this._err('PROVIDER_TAB_NOT_READY', `Không mở được project ${projectId} (timeout). Project có thể đã bị xoá hoặc không thuộc tài khoản này.`);

    // 4. Verify project không lỗi/đã xoá
    try {
      const ready = await window.ProjectHelper?.isFlowProjectReady?.();
      if (ready === false) throw this._err('PROVIDER_TAB_NOT_READY', `Project ${projectId} đang lỗi hoặc đã bị xoá.`);
    } catch (e) { if (e?.code) throw e; }

    let name = null;
    try { name = await window.ProjectHelper?.getProjectName?.(projectId); } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#sleep', _); }
    return { project: { project_id: projectId, project_name: name || window._currentProjectName || null } };
  }

  /**
   * Đọc Flow project hiện đang active (để Claude biết đang ở đâu trước khi run/gen).
   * Trả {project:{project_id, project_name}} — project_id null nếu chưa mở Flow / ở homepage.
   */
  static async _executeGetContext() {
    let ctx = {};
    try {
      ctx = await new Promise((r) => chrome.runtime.sendMessage({ action: 'getFlowProjectContext' }, (resp) => r(resp || {})));
    } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#sleep', _); }
    return {
      project: {
        project_id: ctx.projectId || window._currentProjectId || null,
        project_name: ctx.projectName || window._currentProjectName || null,
      },
    };
  }

  /**
   * Preflight: check MỌI provider SẴN SÀNG (login + tab) trước khi run — giống reconfirm modal
   * (GenTab gen) + _preflightCheck (run workflow UI). Throw lỗi RÕ nếu chưa ready → agent báo user
   * (đăng nhập tab provider) thay vì submit vào trạng thái lỗi / fail giữa chừng.
   * chatgpt/grok: ensureReady (login + activate tab). flow: activate tab + isFlowProjectReady.
   */
  static async _preflightProviders(providers) {
    // Check MỌI provider (KHÔNG fail-fast) → gom tất cả chưa sẵn sàng vào 1 lỗi.
    // Tránh ping-pong: agent chuẩn bị HẾT provider 1 lần rồi run_workflow lại, không retry từng cái.
    // Flow check SAU CÙNG → tab Flow ở foreground khi execute bắt đầu (workflow thường khởi từ generate).
    const order = { chatgpt: 0, grok: 1, flow: 2 };
    const sorted = [...new Set(providers || [])].sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
    const notReady = [];
    for (const p of sorted) {
      if (p === 'chatgpt') {
        const r = await window.ChatGPTSession?.ensureReady?.({ createIfMissing: true, activate: true, focusWindow: true });
        if (r && r.ready === false) notReady.push({ provider: 'chatgpt', reason: r.error === 'NOT_LOGGED_IN' ? 'chưa đăng nhập' : (r.error || 'mở + đăng nhập tab ChatGPT'), login: r.error === 'NOT_LOGGED_IN' });
      } else if (p === 'grok') {
        const r = await window.GrokSession?.ensureReady?.({ createIfMissing: true, activate: true, focusWindow: true });
        if (r && r.ready === false) notReady.push({ provider: 'grok', reason: r.error === 'NOT_LOGGED_IN' ? 'chưa đăng nhập' : (r.error || 'mở + đăng nhập tab Grok'), login: r.error === 'NOT_LOGGED_IN' });
      } else if (p === 'flow') {
        try { await new Promise((res) => chrome.runtime.sendMessage({ action: 'activateFlowTabForExecution', focusWindow: true }, () => res())); } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#sleep', _); }
        const ready = await window.ProjectHelper?.isFlowProjectReady?.();
        if (ready === false) notReady.push({ provider: 'flow', reason: 'chưa mở Flow / chưa vào 1 project', login: false });
      }
    }
    if (notReady.length) {
      const list = notReady.map(x => `${x.provider} (${x.reason})`).join('; ');
      // Code chung: mọi lỗi đều do chưa login → PROVIDER_NOT_LOGGED_IN; còn lại → PROVIDER_TAB_NOT_READY.
      const allLogin = notReady.every(x => x.login);
      throw this._err(allLogin ? 'PROVIDER_NOT_LOGGED_IN' : 'PROVIDER_TAB_NOT_READY',
        `${notReady.length} provider chưa sẵn sàng: ${list}. Chuẩn bị xong TẤT CẢ rồi run_workflow lại.`);
    }
  }

  /**
   * get_provider_status — agent CHỦ ĐỘNG check provider ready TRƯỚC khi gen (proactive), KHÔNG
   * submit/throw. activate=false (chỉ check, không cướp focus). provider bỏ trống → check cả 3.
   * Trả {data:{providers:[{provider, ready, reason}]}} → agent hỏi user login nếu chưa ready.
   */
  static async _executeGetProviderStatus(args) {
    const want = args?.provider ? [args.provider] : ['flow', 'chatgpt', 'grok'];
    const providers = [];
    for (const p of want) {
      let ready = false, reason = 'ok';
      try {
        if (p === 'chatgpt') {
          const r = await window.ChatGPTSession?.ensureReady?.({ createIfMissing: false, activate: false });
          ready = !!r?.ready; reason = ready ? 'ok' : (r?.error || 'not_ready');
        } else if (p === 'grok') {
          const r = await window.GrokSession?.ensureReady?.({ createIfMissing: false, activate: false });
          ready = !!r?.ready; reason = ready ? 'ok' : (r?.error || 'not_ready');
        } else if (p === 'flow') {
          ready = (await window.ProjectHelper?.isFlowProjectReady?.()) === true;
          reason = ready ? 'ok' : 'tab_or_project_not_ready';
        } else { reason = 'unknown_provider'; }
      } catch (e) { reason = e?.message || 'error'; }
      providers.push({ provider: p, ready, reason });
    }
    return { data: { providers } };
  }

  /**
   * delete_chat — xóa conversation ChatGPT hiện tại (dọn chat sau gen). Reuse ChatGPTSession
   * deleteLastMessage (click header conversation-options → Delete → confirm). Cần tab + active.
   */
  static async _executeDeleteChat(args) {
    const provider = args?.provider || 'chatgpt';
    if (provider !== 'chatgpt') throw this._err('VALIDATION_ERROR', `delete_chat chưa hỗ trợ provider "${provider}" (chỉ chatgpt).`);
    if (!window.ChatGPTSession) throw this._err('PROVIDER_TAB_NOT_READY', 'Chưa mở tab ChatGPT.');
    // Cần tab + active để click menu xóa. createIfMissing=false (không có tab → không có gì để xóa).
    const ready = await window.ChatGPTSession.ensureReady({ createIfMissing: false, activate: true, focusWindow: true });
    if (!ready.ready) throw this._err('PROVIDER_TAB_NOT_READY', `ChatGPT không sẵn sàng để xóa chat: ${ready.error || 'mở tab ChatGPT'}.`);
    const r = await window.ChatGPTSession.deleteLastMessage();
    if (!r?.success) throw this._err('GEN_FAILED', `Xóa conversation thất bại${r?.error ? ': ' + r.error : ''}.`);
    return { data: { deleted: true, provider } };
  }

  // ─────────────────────────── WORKFLOW (G1) ───────────────────────────

  static async _executeWorkflow(args) {
    const wfId = args.wf_id;
    if (!wfId) throw this._err('GEN_FAILED', 'Thiếu wf_id');
    if (!window.workflowExecutor) throw this._err('GEN_FAILED', 'WorkflowExecutor chưa khởi tạo.');

    // Gate project: chỉ chạy khi Flow đang ở ĐÚNG project của workflow (đồng bộ UI single run).
    // Tránh chạy nhầm vào project khác / project đã xoá → báo lỗi rõ cho Claude/user tự mở đúng project.
    try {
      const wfMeta = await window.storageManager?.getWorkflow?.(wfId);
      if (wfMeta && window.ProjectHelper?.checkWorkflowProjectGate) {
        const gate = await window.ProjectHelper.checkWorkflowProjectGate(wfMeta);
        if (!gate.ok) {
          if (gate.code === 'WRONG_PROJECT') {
            const where = gate.expectedName ? `"${gate.expectedName}" (id: ${gate.expectedProjectId})` : `project ${gate.expectedProjectId}`;
            throw this._err('WRONG_PROJECT', `Workflow thuộc ${where}. HỎI user có muốn mở project này không; nếu đồng ý gọi open_project("${gate.expectedProjectId}") rồi run_workflow lại.`);
          }
          throw this._err('PROVIDER_TAB_NOT_READY', 'Project của workflow đang lỗi hoặc đã xoá. Hãy mở/chọn lại project hợp lệ rồi thử lại.');
        }
      }
    } catch (e) {
      if (e?.code) throw e; // lỗi gate có chủ đích → ném tiếp
      // getWorkflow/ProjectHelper lỗi bất ngờ → KHÔNG chặn (fail-open, để execute thử)
    }

    // Preflight provider ready (giống WorkflowList._preflightCheck của UI run) — check MỌI provider
    // dùng trong nodes SẴN SÀNG (login + tab) TRƯỚC execute → báo lỗi sớm thay vì fail giữa workflow.
    try {
      const wfNodes = (await window.storageManager?.getWorkflow?.(wfId))?.nodes || [];
      const providers = new Set();
      for (const n of wfNodes) {
        const t = n.node_type;
        if (t === 'generate') providers.add('flow');
        else if (t === 'chatgpt') providers.add('chatgpt');
        else if (t === 'grok') providers.add('grok');
      }
      await this._preflightProviders([...providers]);
    } catch (e) {
      if (e?.code) throw e; // lỗi preflight có chủ đích (PROVIDER_NOT_LOGGED_IN/...) → ném
      // lỗi đọc workflow bất ngờ → KHÔNG chặn (fail-open, execute tự xử per-node)
    }

    // G1: chạy bằng wf_id TRỰC TIẾP → execute → getWorkflow(wf_id) fetch server (không cần local list)
    const collected = [];
    let _nodeDone = 0;
    const onNode = (d) => {
      this._emitProgress(++_nodeDone, undefined, `node ${_nodeDone} xong`); // progress workflow (per-node)
      if (d?.result?.thumbnails) {
        for (const info of Object.values(d.result.thumbnails)) {
          if (info.thumbnail || info.thumbnailUrl) {
            collected.push({ url: info.thumbnail || info.thumbnailUrl, type: info.type || 'image', file_name: info.file_name || '', video_url: info.video_url || '' });
          }
        }
      }
    };
    window.eventBus?.on('node:completed', onNode);
    try {
      const ok = await window.workflowExecutor.execute(wfId);
      if (!ok) throw this._err('GEN_FAILED', 'Workflow thực thi thất bại.');

      // Fallback: thu từ cached result_thumbnails của generate nodes
      if (collected.length === 0) {
        const wf = await window.storageManager?.getWorkflow?.(wfId);
        for (const node of (wf?.nodes || [])) {
          if (node.node_type !== 'generate' || !node.result_thumbnails) continue;
          for (const [tid, info] of Object.entries(node.result_thumbnails)) {
            const u = typeof info === 'string' ? info : (info.thumbnail || info.thumbnailUrl);
            if (u && typeof u === 'string' && u.startsWith('http')) {
              collected.push({ url: u, type: info?.type || 'image', file_name: node.result_file_names?.[tid] || info?.file_name || '', video_url: info?.video_url || '' });
            }
          }
        }
      }
      if (collected.length === 0) throw this._err('GEN_FAILED', 'Workflow hoàn thành nhưng không có ảnh. Reset workflow rồi chạy lại.');
      return { thumbnails: collected };
    } finally {
      window.eventBus?.off('node:completed', onNode);
    }
  }

  // ─────────────────────────── RESULT → /mcp/result ───────────────────────────

  // ───────────── PROGRESS (stream % cho MCP client / Video AI V2) ─────────────
  // Phát tiến độ job hiện tại → bridge (mcp:local_progress) → server → MCP notifications/progress.
  // Best-effort: bọc try/catch, KHÔNG bao giờ làm hỏng gen nếu thiếu eventBus/job.
  static _emitProgress(progress, total, message) {
    try {
      if (((typeof self !== 'undefined') ? self : window).SEOSONA_LOCAL_MODE === false) return; // chỉ local mode
      if (!this._currentJobId) return;
      const body = { job_id: this._currentJobId, progress: Number(progress) || 0 };
      if (total != null) body.total = Number(total);
      if (message) body.message = String(message).slice(0, 200);
      window.eventBus?.emit('mcp:local_progress', body);
    } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#onNode', _); }
  }

  // Gen (image/video): map snapshot queue (job owner='mcp') → progress = (done+failed)/totalExpected.
  // Trả hàm unsub (eventBus.on trả sẵn). null nếu không phải gen.
  static _setupGenProgress(command) {
    if (command !== 'gen_image' && command !== 'gen_video') return null;
    try {
      const onSnap = (snap) => {
        try {
          const job = (snap?.jobs || []).find((j) => j.owner === 'mcp' && j.totalExpected > 0);
          if (job) this._emitProgress((job.completedCount || 0) + (job.failedCount || 0), job.totalExpected, job.label || 'generating');
        } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#onSnap', _); }
      };
      return window.eventBus?.on?.('queue:state_changed', onSnap) || null;
    } catch (_) { return null; }
  }

  static async _sendResult(jobId, status, payload = {}) {
    try {
      const body = { job_id: jobId, status };
      if (status === 'completed') {
        if (payload.project) {
          body.project = payload.project;
        } else if (payload.upload) {
          body.upload = payload.upload;
        } else if (payload.data) {
          body.data = payload.data; // status payload generic (get_provider_status, delete_chat)
        } else {
          const thumbs = await this._convertForMcp(payload.thumbnails || [], payload._tabId);
          body.thumbnails = thumbs;
          body.result_count = thumbs.length;
          if (payload.batch) body.batch = payload.batch; // multi-prompt per-prompt fail detail
        }
      } else {
        if (payload.errorCode) body.error_code = payload.errorCode;
        if (payload.errorMessage) body.error_message = String(payload.errorMessage).slice(0, 1000);
      }
      // LOCAL MODE: không có backend — trả kết quả cho Local MCP bridge (WebSocket) thay vì POST /mcp/result.
      // Reversible: xóa block này để quay lại hành vi online thuần backend.
      try {
        if ((typeof self !== 'undefined' ? self : window).SEOSONA_LOCAL_MODE !== false) {
          window.eventBus?.emit('mcp:local_result', body);
          return;
        }
      } catch (_) { /* fall through to backend */ }
      await ApiClient.request('POST', 'mcp/result', body);
    } catch (err) {
      console.error('[McpExecutor] _sendResult lỗi:', err?.message);
    }
  }

  /**
   * Convert kết quả cho MCP: ảnh → base64 inline (+ url); video → video_url.
   * (Phase 5 R2 presigned sẽ thay base64 video bằng URL R2 + poster — ngoài Phase 2.)
   */
  static async _convertForMcp(thumbnails, tabId) {
    const out = [];
    for (const t of thumbnails) {
      try {
        const type = t.type || 'image';
        if (type === 'video') {
          // Phase 5: upload video THẲNG lên R2 (presigned) → URL ổn định + poster frame.
          // Graceful: lấy blob (base64 pre-fetch hoặc fetch signed URL) → R2; fail → provider URL.
          const vurl = t.video_url || t.url;
          let blob = null;
          try {
            if (t.base64) blob = await (await fetch(`data:video/mp4;base64,${t.base64}`)).blob();
            else if (vurl) { const r = await this._fetchTO(vurl, {}, 30000); if (r?.ok) blob = await r.blob(); }
          } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#onSnap', _); }
          let finalUrl = vurl || '';
          let poster = null;
          if (blob) {
            const r2 = await this._uploadVideoToR2(blob);
            if (r2) finalUrl = r2;
            poster = await this._videoPoster(blob);
          }
          if (finalUrl || poster) {
            const v = { type: 'video', provider: t.provider || null, tile_id: t.tile_id || null, video_url: finalUrl, file_name: t.file_name || '' };
            if (poster) v.poster = poster;
            out.push(v);
          }
          continue;
        }
        // image: ưu tiên base64 pre-fetched, else fetch+convert; luôn kèm url
        let base64 = t.base64 || null;
        if (!base64 && t.url) {
          base64 = await this._fetchImageAsBase64(t.url, tabId);
        }
        const item = { type: 'image', provider: t.provider || null, tile_id: t.tile_id || null, file_name: t.file_name || '' };
        if (t.url) item.url = t.url;
        if (base64) item.base64 = base64;
        if (item.url || item.base64) out.push(item);
      } catch (e) {
        console.warn('[McpExecutor] convert thumb lỗi:', e?.message);
      }
    }
    return out;
  }

  static async _fetchImageAsBase64(url, tabId) {
    try {
      if (window.MessageBridge?.chatGPTFetchImage && tabId) {
        const r = await window.MessageBridge.chatGPTFetchImage(url, tabId);
        if (r?.success && r?.base64) return r.base64;
      }
      // M7: reuse _fetchTO so a hung CDN doesn't wedge the critical section.
      const resp = await this._fetchTO(url, {}, 30000);
      if (!resp || !resp.ok) return null;
      return await this._blobToBase64(await resp.blob());
    } catch (_) { return null; }
  }

  /** Phase 5: xin presigned PUT → upload video blob THẲNG lên R2 → trả public URL. null nếu R2 off/fail. */
  static async _uploadVideoToR2(blob) {
    try {
      const ct = blob.type || 'video/mp4';
      const ext = ct.includes('webm') ? 'webm' : 'mp4';
      const resp = await ApiClient.request('POST', 'mcp/media/upload-url', { ext, content_type: ct });
      // _apiCall trả response.data → {enabled, upload_url, headers, public_url} | {enabled:false}
      const p = (resp && resp.enabled !== undefined) ? resp : (resp?.data || {});
      if (!p?.enabled || !p.upload_url) return null;
      const put = await this._fetchTO(p.upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': ct, ...(p.headers || {}) } }, 60000);
      if (!put?.ok) { console.warn('[McpExecutor] R2 PUT fail', put?.status); return null; }
      return p.public_url || null;
    } catch (e) { console.warn('[McpExecutor] R2 upload lỗi:', e?.message); return null; }
  }

  /**
   * M7 (SSRF): validate an agent-supplied ref URL before fetching it.
   * Agent prompts can be injected, so a ref like http://192.168.1.1/… or
   * http://169.254.169.254/… must not be fetched from the user's network.
   * Only http(s) to public hosts is allowed; loopback / link-local / RFC1918 /
   * cloud-metadata / *.local hosts are rejected.
   * @param {string} url
   * @returns {boolean}
   */
  static _isSafePublicUrl(url) {
    let u;
    try { u = new URL(url); } catch (_) { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = (u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return false;
    // Block obvious local names.
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    // IPv6 loopback / link-local / unique-local.
    if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false;
    // IPv4 literal ranges.
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
      if (a === 10) return false;                    // 10.0.0.0/8
      if (a === 127) return false;                   // loopback
      if (a === 0) return false;                     // 0.0.0.0/8
      if (a === 169 && b === 254) return false;      // link-local + cloud metadata
      if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
      if (a === 192 && b === 168) return false;      // 192.168.0.0/16
      if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64.0.0/10
      if (a >= 224) return false;                    // multicast / reserved
    }
    return true;
  }

  /** fetch có timeout (AbortController) — chống hang giữ ExecutionLock/_isExecuting vô thời hạn. */
  static async _fetchTO(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (_) {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  /** Phase 5: trích poster frame (frame đầu) từ video blob → base64 PNG. Best-effort, null nếu fail. */
  static _videoPoster(blob) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        const url = URL.createObjectURL(blob);
        const cleanup = () => { try { URL.revokeObjectURL(url); } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#cleanup', _); } };
        const video = document.createElement('video');
        video.muted = true; video.preload = 'metadata'; video.playsInline = true; video.src = url;
        video.onloadeddata = () => { try { video.currentTime = Math.min(0.1, video.duration || 0.1); } catch (_) { cleanup(); finish(null); } };
        video.onseeked = () => {
          try {
            const c = document.createElement('canvas');
            c.width = video.videoWidth || 360; c.height = video.videoHeight || 640;
            c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
            finish((c.toDataURL('image/png').split(',')[1]) || null);
          } catch (_) { finish(null); }
          cleanup();
        };
        video.onerror = () => { cleanup(); finish(null); };
        setTimeout(() => { cleanup(); finish(null); }, 8000);
      } catch (_) { finish(null); }
    });
  }

  static _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ─────────────────────────── CANCEL ───────────────────────────

  static _handleCancel(data) {
    if (!this._isLeaderContext()) return;
    // cancel_all (data.all=true) → dừng job đang chạy bất kể job_id (clear toàn bộ hàng đợi).
    const cancelAll = data?.all === true;
    if (this._currentJobId && (cancelAll || data?.job_id === this._currentJobId)) {
      this._cancelRequested = true; // dừng loop multi-prompt chatgpt/grok sớm
      if (window.ExecutionGate && this._currentExecutionToken) {
        ExecutionGate.cancel(this._currentExecutionToken);
        this._currentExecutionToken = null;
      }
      if (window.ExecutionLock?.stopCurrent) window.ExecutionLock.stopCurrent();
      // Force-stop PromptQueue (Flow multi-prompt batch): token cancel KHÔNG xoá _itemQueue
      // — chỉ stopJob/stopAll mới clear items còn lại (PromptQueue L341/455). Không stop →
      // các prompt còn lại vẫn gen tiếp trong browser. stop_all OK: ExecutionLock serialize
      // (không thể vừa gen tay vừa gen MCP — tranh chấp editor), cancel_all = full flush.
      window.eventBus?.emit('queue:stop_all');
    }
  }

  // ─────────────────────────── HELPERS ───────────────────────────

  /**
   * Setting lưu local cho MCP gen (mirror Telegram telegram*). Đọc af_settings.
   * Mặc định OFF (MCP trả AI là chính; user opt-in bật mcpAutoDownload để lưu đĩa).
   * Gate feature 'auto_download' (như Telegram). Keys: mcpAutoDownload / mcpDownloadResolution
   * / mcpVideoDownloadResolution / mcpDownloadFolder.
   */
  static async _getMcpDownloadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['af_settings'], (res) => {
          const s = res?.af_settings || {};
          const on = s.mcpAutoDownload === true || s.mcpAutoDownload === '1' || s.mcpAutoDownload === 1;
          const canDl = window.featureGate ? window.featureGate.canUse('auto_download') : true;
          resolve({
            autoDownload: on && canDl,
            downloadResolution: s.mcpDownloadResolution || '1k',
            videoDownloadResolution: s.mcpVideoDownloadResolution || '720p',
            downloadFolder: s.mcpDownloadFolder || 'seosonaflow_mcp',
          });
        });
      } catch (_) {
        resolve({ autoDownload: false, downloadResolution: '1k', videoDownloadResolution: '720p', downloadFolder: 'seosonaflow_mcp' });
      }
    });
  }

  static _err(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  /**
   * Build batch summary (multi-prompt) → {succeeded, failed, failed_prompts:[{index,prompt,error}]}.
   * Chỉ trả khi multi-prompt (>1) hoặc có fail — single prompt trả null (gọn).
   * @param {number} total - số prompt submit
   * @param {Array} failedList - [{index, prompt, error}] (Flow: từ PromptQueue.failedPrompts; chatgpt/grok: tự track)
   * @param {number} [completed] - số thành công (Flow report); thiếu → total - failed
   */
  static _buildBatch(total, failedList, completed) {
    const failed = Array.isArray(failedList) ? failedList : [];
    if (total <= 1 && failed.length === 0) return null;
    return {
      succeeded: typeof completed === 'number' ? completed : Math.max(0, total - failed.length),
      failed: failed.length,
      failed_prompts: failed.map(f => ({
        index: typeof f.index === 'number' ? f.index : null,
        prompt: String(f.prompt || '').slice(0, 500),
        error: String(f.error || '').slice(0, 300),
      })),
    };
  }

  static _mapCommandToAction(command, provider) {
    if (command === 'gen_image' || command === 'gen_video') {
      return provider === 'grok' ? 'grok_run' : provider === 'chatgpt' ? 'chatgpt_run' : 'generate';
    }
    // run_workflow → null: WorkflowExecutor.execute TỰ gọi ExecutionGate.request('workflow_run')
    // (WorkflowExecutor.js:1257) → request ở đây nữa = double-deduct. upload_ref → null (A4).
    return null;
  }

  /**
   * Resolve refs (base64 hoặc URL public) → image objects base64 cho ChatGPT/Grok.
   * URL → fetchBlob (background, bypass CORS) → base64. Bug fix 2026-06-21: trước drop URL
   * (filter !http) → ref URL bị bỏ âm thầm dù tool nói "URL public OK".
   */
  // Resolve reuse_refs (metadata kết quả gen trước) → Flow tile_ids để dùng làm ref. TARGET = Flow.
  // refFileNames: out-param, map tile_id → file_name (để PromptQueue dùng tên ổn định).
  static async _resolveReuseRefs(reuseRefs, refFileNames = {}) {
    const out = [];
    for (const r of (Array.isArray(reuseRefs) ? reuseRefs : []).slice(0, 4)) {
      if (!r || typeof r !== 'object') continue;
      const provider = r.provider || 'flow';
      try {
        if (provider === 'flow') {
          // Flow→Flow: resolve file_name/tile_id → tile hiện tại (battle-tested, xử lý reload).
          // resolveFileIdsString cũng trigger lazy-load DOM (ensureFlowTilesLoaded) cho tiles chưa render.
          const tid = (r.tile_id || '').toString().trim();
          if (!tid) continue;
          let id = tid;
          if (window.resolveFileIdsString) {
            const fnMap = r.file_name ? { [tid]: r.file_name } : {};
            const thMap = r.url ? { [tid]: r.url } : {};
            const resolved = await window.resolveFileIdsString(tid, thMap, fnMap);
            id = (resolved || tid).split(',')[0].trim() || tid;
          }
          // VERIFY tồn tại trong project ĐANG MỞ. resolveFileIdsString trả lại tid CŨ khi không resolve
          // được (đổi project / ảnh đã xóa) → nếu không verify sẽ push ref STALE → gen âm thầm THIẾU ref.
          // checkFilesExist query DOM (đã lazy-load ở trên) → file_name không có = báo lỗi RÕ thay vì âm thầm.
          if (r.file_name && window.MessageBridge?.checkFilesExist) {
            let chk = null;
            try { chk = await window.MessageBridge.checkFilesExist([r.file_name]); } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#onloadend', _); }
            if (chk && Array.isArray(chk.missing) && chk.missing.includes(r.file_name)) {
              throw this._err('REF_FETCH_FAILED', `Ảnh "${r.file_name}" không có trong Flow project đang mở (đổi project hoặc đã xóa?). Mở đúng project chứa ảnh rồi thử lại.`);
            }
          }
          if (id) { out.push(id); if (r.file_name) refFileNames[id] = r.file_name; }
        } else if (provider === 'chatgpt' || provider === 'grok') {
          // Cross-provider bridge: fetch url qua tab provider (cookie) → base64 → upload Flow.
          if (!r.url) throw this._err('REF_FETCH_FAILED', `reuse_ref ${provider} thiếu url để bridge sang Flow.`);
          // SECURITY: chỉ fetch url thuộc CDN provider. fetchImage chạy với credentials:'include' (cookie user)
          // → chống agent (bị prompt-inject) ép tab provider fetch url tùy ý bằng session đăng nhập của user.
          const CDN = provider === 'chatgpt'
            ? /(^|\.)chatgpt\.com$|(^|\.)oaiusercontent\.com$/i
            : /(^|\.)grok\.com$|(^|\.)x\.ai$/i;
          let host = ''; try { host = new URL(r.url).hostname; } catch (_) { globalThis.SEOSONA_swallow?.('McpExecutor#onloadend', _); }
          if (!host || !CDN.test(host)) throw this._err('REF_FETCH_FAILED', `reuse_ref url phải là CDN ${provider} (host nhận: ${host || 'invalid'}). Chỉ dùng url ảnh KẾT QUẢ từ ${provider}.`);
          const session = provider === 'chatgpt' ? window.ChatGPTSession : window.GrokSession;
          // activate:false → fetch qua content script tab, KHÔNG cướp focus (Flow gen vẫn foreground).
          const ready = await session?.ensureReady?.({ createIfMissing: false, activate: false });
          if (!ready?.ready) throw this._err('PROVIDER_TAB_NOT_READY', `Tab ${provider} chưa sẵn sàng để lấy ảnh bridge sang Flow (mở + đăng nhập ${provider}).`);
          const fetchFn = provider === 'chatgpt' ? window.MessageBridge?.chatGPTFetchImage : window.MessageBridge?.grokFetchImage;
          const fr = await fetchFn?.(r.url, ready.tabId);
          if (!fr?.success || !fr.base64) throw this._err('REF_FETCH_FAILED', `Không lấy được ảnh ${provider} từ url (${fr?.error || 'lỗi'}) để bridge sang Flow.`);
          // fr.base64 ĐÃ là data URL (readAsDataURL) → truyền THẲNG, KHÔNG prepend (tránh double-prefix hỏng base64).
          const up = await this._uploadRefToFlow(fr.base64);
          if (up?.tileId) { out.push(up.tileId); if (up.fileName) refFileNames[up.tileId] = up.fileName; }
        }
      } catch (e) {
        if (e?.code) throw e;
        throw this._err('REF_FETCH_FAILED', `reuse_ref (${provider}) lỗi: ${e?.message || e}`);
      }
    }
    return out;
  }

  static async _resolveRefsToImages(refs) {
    if (!Array.isArray(refs) || !refs.length) return [];
    const out = [];
    for (let i = 0; i < Math.min(refs.length, 4); i++) {
      const ref = refs[i];
      if (typeof ref !== 'string' || !ref) continue;
      let base64 = ref;
      if (/^https?:\/\//i.test(ref)) {
        // M7 (SSRF): block private/loopback/link-local ref URLs from agent input.
        if (!this._isSafePublicUrl(ref)) {
          throw this._err('REF_FETCH_FAILED', `URL ref không hợp lệ (chặn địa chỉ nội bộ/loopback): ${ref}. Chỉ dùng URL public http(s).`);
        }
        try {
          const resp = await new Promise((resolve, reject) => {
            // expectImage → background chặn HTML (trang login CDN trả 200) thay vì nuốt làm "ảnh" rác.
            chrome.runtime.sendMessage({ action: 'fetchBlob', url: ref, expectImage: true }, (r) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve(r);
            });
          });
          // Fail (401/403/404/login-page) → THROW báo agent biết ref nào hỏng, KHÔNG gen thiếu ref âm thầm.
          if (!resp?.success || !resp.base64) {
            throw this._err('REF_FETCH_FAILED', `Không tải được ảnh ref từ URL: ${ref} (${resp?.error || 'lỗi không xác định'}). Dùng URL public mở trực tiếp được (không cần đăng nhập/cookie).`);
          }
          base64 = resp.base64;
        } catch (e) {
          if (e?.code) throw e; // REF_FETCH_FAILED có chủ đích → ném tiếp
          throw this._err('REF_FETCH_FAILED', `Lỗi tải ref URL ${ref}: ${e?.message || e}`);
        }
      } else if (ref.startsWith('data:')) {
        base64 = ref.split(',')[1] || ref;
      }
      if (base64) out.push({ base64, name: `mcp_ref_${i}.jpg`, type: 'image/jpeg' });
    }
    return out;
  }

  // Lưu lịch sử gen MCP vào GenerationHistory (giống GenTab) → hiện ở History tab + /admin/generations
  // (source='mcp'). Đi qua saveRecord → POST /history → backend TỰ enforce history_max (rolling window
  // xóa record cũ nhất). KHÔNG bypass path này. Lỗi history KHÔNG được làm fail gen → nuốt + warn.
  static async _saveGenHistory({ promptList, mediaType, model, ratio, quantity, refFileIds, thumbs, resultFileIds, provider }) {
    try {
      // CHÚ Ý: window.generationHistory (chữ THƯỜNG) = INSTANCE có saveRecord + _buffer.
      // window.GenerationHistory (HOA) = class → saveRecord undefined → KHÔNG dùng.
      if (!window.generationHistory?.saveRecord) return;
      const result_thumbnails = (thumbs || []).map(t => ({
        thumbnail: t.url || '', file_name: t.file_name || '', type: t.type || 'image', video_url: t.video_url || '',
      }));
      await window.generationHistory.saveRecord({
        prompt: (promptList || []).join('\n\n'),
        media_type: mediaType || 'image',
        model: model || '',
        ratio: ratio || '',
        prompt_count: (promptList || []).length || 1,
        quantity: quantity || 1,
        ref_file_ids: (refFileIds || []).filter(Boolean).join(', '),
        result_file_ids: (resultFileIds || []).filter(Boolean).join(', '),
        result_thumbnails,
        source: 'mcp',
        provider: provider || 'flow',
        project_id: window._currentProjectId || null,
        auto_download: false,
      });
    } catch (e) {
      console.warn('[McpExecutor] _saveGenHistory lỗi (bỏ qua, không fail gen):', e?.message);
    }
  }

  static _collectThumbs(resultThumbnails) {
    const thumbs = [];
    if (resultThumbnails) {
      // Object.entries giữ KEY = tile_id (Flow). file_name ỔN ĐỊNH hơn tile_id (tile_id đổi sau reload).
      for (const [tileId, info] of Object.entries(resultThumbnails)) {
        if (info.thumbnail || info.video_url) {
          thumbs.push({ url: info.thumbnail || '', file_name: info.file_name || '', type: info.type || 'image', video_url: info.video_url || '', tile_id: tileId });
        }
      }
    }
    return thumbs;
  }

  static _reverseRatioMap(uiMap) {
    if (!uiMap || typeof uiMap !== 'object') return {};
    const r = {};
    for (const [k, v] of Object.entries(uiMap)) r[v] = k;
    return r;
  }

  static _mapRatio(ratio) {
    if (!ratio) return null;
    const r = String(ratio).toLowerCase().trim();
    const map = {
      '16:9': 'Ngang', '4:3': '4:3', '1:1': 'Vuông', '3:4': '3:4', '9:16': 'Dọc',
      'ngang': 'Ngang', 'doc': 'Dọc', 'dọc': 'Dọc', 'vuong': 'Vuông', 'vuông': 'Vuông',
      'landscape': 'Ngang', 'portrait': 'Dọc', 'square': 'Vuông', 'wide': 'Ngang', 'tall': 'Dọc',
    };
    return map[r] || null;
  }

  static _mapRatioToChatGPT(ratio) {
    if (!ratio) return 'widescreen';
    const r = String(ratio).toLowerCase().trim();
    const uiMap = window.ProviderConfigManager?.getRatioUiMapSync?.('chatgpt') || {};
    const valueToUi = { '16:9': 'widescreen', '9:16': 'story', '1:1': 'square', '4:3': 'landscape', '3:4': 'portrait', ...this._reverseRatioMap(uiMap) };
    const vn = { 'ngang': 'widescreen', 'dọc': 'story', 'doc': 'story', 'vuông': 'square', 'vuong': 'square' };
    if (vn[r]) return vn[r];
    if (valueToUi[r]) return valueToUi[r];
    if (uiMap[r]) return r;
    return 'widescreen';
  }

  static _mapRatioToGrok(ratio) {
    if (!ratio) return 'widescreen';
    const r = String(ratio).toLowerCase().trim();
    const uiMap = window.ProviderConfigManager?.getRatioUiMapSync?.('grok') || {};
    const valueToUi = { '16:9': 'widescreen', '9:16': 'story', '1:1': 'square', '3:2': 'landscape', '2:3': 'portrait', '4:3': 'landscape', '3:4': 'portrait', ...this._reverseRatioMap(uiMap) };
    const vn = { 'ngang': 'widescreen', 'dọc': 'story', 'doc': 'story', 'vuông': 'square', 'vuong': 'square' };
    if (vn[r]) return vn[r];
    if (valueToUi[r]) return valueToUi[r];
    if (uiMap[r]) return r;
    return 'widescreen';
  }
}

window.McpExecutor = McpExecutor;
