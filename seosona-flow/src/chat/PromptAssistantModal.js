/**
 * PromptAssistantModal (2026-06-15, đổi tên từ ChatAIModal)
 * Trợ lý viết prompt: user nhập ý tưởng + settings (A→E) → build meta-prompt server-driven →
 * submit ChatGPT/Gemini (account user) → đọc N prompt về → đổ vào tab Gen.
 * Server-Only: template + default settings từ background (pa:getConfig). Tái dùng infra i2p.
 * i18n: self-contained _L map 4 locale (chạy ngay, không phụ thuộc DB sync) — pattern như i2p-content.
 * Giữ alias window.ChatAIModal (entry cũ) + window.PromptAssistantModal.
 */
(function () {
  'use strict';

  function locale() {
    return (window.I18n && (window.I18n.getLocale?.() || window.I18n._currentLocale)) || 'vi';
  }

  // ---- i18n labels (self-contained, 4 locale) ----
  const _L = {
    vi: {
      title: 'Prompt Assistant', close: 'Đóng', provider: 'Tạo bằng:',
      ideaPlaceholder: 'Nhập ý tưởng/chủ đề, HOẶC dán kịch bản, HOẶC dán phụ đề SRT (mỗi câu = 1 ảnh)...\nVD: 5 lợi ích của chạy bộ',
      mediaType: 'Loại', image: 'Ảnh', video: 'Video', pair: 'Cặp ảnh→video',
      count: 'Số lượng', language: 'Ngôn ngữ', langSource: 'Theo input',
      detail: 'Độ chi tiết', concise: 'Ngắn gọn', detailed: 'Chi tiết', cinematic: 'Cinematic',
      style: 'Style', aspect: 'Tỷ lệ', lighting: 'Ánh sáng', camera: 'Góc máy', auto: 'Auto',
      golden_hour: 'Giờ vàng', neon: 'Neon', dramatic: 'Kịch tính', soft: 'Dịu',
      close_up: 'Cận cảnh', wide: 'Toàn cảnh', lens35: '35mm',
      clipDuration: 'Thời lượng clip', totalDuration: 'Tổng (giây)', secPerImage: 'Giây/ảnh', cameraMotion: 'Chuyển động',
      pan: 'Lia (pan)', zoom: 'Zoom', staticMot: 'Tĩnh', tone: 'Tông/thể loại', voice: 'Giọng đọc', voicePh: 'vd: giọng nam trầm, ấm, chậm',
      blueHour: 'Giờ xanh', rim: 'Viền/ngược sáng', lowKey: 'Low-key (tối)', highKey: 'High-key (sáng)', volumetric: 'Tia sáng (god rays)', medium: 'Trung cảnh', aerial: 'Trên cao/drone', lowAngle: 'Góc thấp', highAngle: 'Góc cao', macro: 'Macro (đặc tả)', lens85: '85mm', dolly: 'Đẩy máy (dolly)', tracking: 'Bám theo', orbit: 'Vòng quanh', tilt: 'Ngả máy (tilt)', crane: 'Cần cẩu (crane)', handheld: 'Cầm tay', audioMusic: 'Nhạc nền',
      sequential: 'Nối tiếp (storyboard)', consistency: 'Giữ nhất quán', numbered: 'Đánh số', autoFill: 'Tự đổ vào SEOSONA Flow',
      autoScript: 'Tự viết kịch bản + phụ đề', renderSub: 'Chèn phụ đề lên ảnh/video', srtDetected: 'Đã nhận SRT: {n} câu · {dur}s',
      negative: 'Tránh: ... (negative, tuỳ chọn)', addRef: 'Ảnh tham chiếu', refHint: 'tối đa {max}', removeImg: 'Xoá ảnh',
      format: 'Định dạng', formatNone: 'Tự do', formatOther: 'Khác', advanced: 'Nâng cao', audio: 'Âm thanh', audioNone: 'Không', audioAmbient: 'Tiếng nền', audioSfx: 'Hiệu ứng (SFX)', audioDialogue: 'Lời thoại', audioFull: 'Đầy đủ', refSelectDrag: 'Chọn ảnh / Kéo thả', fillImages: 'Đưa ảnh vào SEOSONA Flow', fillVideos: 'Đưa video vào SEOSONA Flow',
      notLogged: 'chưa đăng nhập', noTab: 'chưa mở tab', openTab: 'Mở tab',
      generate: 'Tạo prompt', generating: 'Đang tạo prompt...', cancel: 'Hủy',
      confirmGenTitle: 'Tạo prompt với {provider}', confirmGenMsg: 'Sẽ mở tab {provider} và gửi yêu cầu tạo prompt tự động. Tiếp tục?',
      countCapped: 'Tối đa {max} prompt mỗi lần — đã tự giảm còn {max}.',
      resultCount: 'Đã tạo', resultUnit: 'prompt', empty: 'Không có prompt nào.',
      fillGen: 'Đưa vào SEOSONA Flow', copy: 'Copy', copied: 'Đã copy', back: 'Quay lại', copySrt: 'Copy phụ đề (SRT)',
      errConfig: 'Chưa tải được cấu hình từ server.', errProvider: 'Provider chưa sẵn sàng / lỗi.', errFill: 'Không đổ được vào SEOSONA Flow (chưa sẵn sàng).',
      toastFilled: 'Đã đưa {n} prompt vào SEOSONA Flow',
      premiumNeed: 'Cần nâng cấp gói Premium để dùng format này',
    },
    en: {
      title: 'Prompt Assistant', close: 'Close', provider: 'Generate with:',
      ideaPlaceholder: 'Enter an idea/topic, OR paste a script, OR paste SRT subtitles (each cue = 1 image)...\nE.g. 5 benefits of running',
      mediaType: 'Type', image: 'Image', video: 'Video', pair: 'Image→video pair',
      count: 'Count', language: 'Language', langSource: 'Same as input',
      detail: 'Detail', concise: 'Concise', detailed: 'Detailed', cinematic: 'Cinematic',
      style: 'Style', aspect: 'Aspect', lighting: 'Lighting', camera: 'Camera', auto: 'Auto',
      golden_hour: 'Golden hour', neon: 'Neon', dramatic: 'Dramatic', soft: 'Soft',
      close_up: 'Close-up', wide: 'Wide', lens35: '35mm',
      clipDuration: 'Clip duration', totalDuration: 'Total (sec)', secPerImage: 'Sec/image', cameraMotion: 'Motion',
      pan: 'Pan', zoom: 'Zoom', staticMot: 'Static', tone: 'Tone/genre', voice: 'Voice', voicePh: 'e.g. deep warm male narrator, slow',
      blueHour: 'Blue hour', rim: 'Rim/backlit', lowKey: 'Low-key', highKey: 'High-key', volumetric: 'Volumetric', medium: 'Medium', aerial: 'Aerial/drone', lowAngle: 'Low-angle', highAngle: 'High-angle', macro: 'Macro', lens85: '85mm', dolly: 'Dolly-in', tracking: 'Tracking', orbit: 'Orbit', tilt: 'Tilt', crane: 'Crane', handheld: 'Handheld', audioMusic: 'Music',
      sequential: 'Sequential (storyboard)', consistency: 'Keep consistent', numbered: 'Numbered', autoFill: 'Auto-fill SEOSONA Flow',
      autoScript: 'Auto-write script + subs', renderSub: 'Burn subtitle on image/video', srtDetected: 'SRT detected: {n} cues · {dur}s',
      negative: 'Avoid: ... (negative, optional)', addRef: 'Reference images', refHint: 'max {max}', removeImg: 'Remove',
      format: 'Format', formatNone: 'Free', formatOther: 'Other', advanced: 'Advanced', audio: 'Audio', audioNone: 'None', audioAmbient: 'Ambient', audioSfx: 'SFX', audioDialogue: 'Dialogue', audioFull: 'Full', refSelectDrag: 'Select / Drag image', fillImages: 'Send images to SEOSONA Flow', fillVideos: 'Send videos to SEOSONA Flow',
      notLogged: 'not signed in', noTab: 'no tab open', openTab: 'Open tab',
      generate: 'Generate prompts', generating: 'Generating prompts...', cancel: 'Cancel',
      confirmGenTitle: 'Generate with {provider}', confirmGenMsg: 'This will open the {provider} tab and auto-send a request to generate prompts. Continue?',
      countCapped: 'Max {max} prompts per run — capped to {max}.',
      resultCount: 'Generated', resultUnit: 'prompts', empty: 'No prompts.',
      fillGen: 'Send to SEOSONA Flow', copy: 'Copy', copied: 'Copied', back: 'Back', copySrt: 'Copy subtitles (SRT)',
      errConfig: 'Could not load server config.', errProvider: 'Provider not ready / error.', errFill: 'Could not fill SEOSONA Flow (not ready).',
      toastFilled: '{n} prompts added to SEOSONA Flow',
      premiumNeed: 'Upgrade to Premium to use this format',
    },


  };
  // Ưu tiên i18n trung tâm (server-managed, key `pa.*`). _L inline = fallback cold-start / key chưa seed.
  function L(k) { const l = locale(); return (window.I18n && window.I18n.t && window.I18n.t('pa.' + k)) || (_L[l] && _L[l][k]) || _L.en[k] || _L.vi[k] || k; }

  // Tooltip ngắn cho từng field setting (hover label). i18n: ưu tiên I18n trung tâm `pa.tip_*`, fallback _TIP.
  const _TIP = {
    type:     { vi: 'Loại đầu ra: Ảnh, Video, hoặc Cặp ảnh→video', en: 'Output type: Image, Video, or Image→video pair', },
    count:    { vi: 'Số prompt mỗi lần (auto = AI tự chọn); vượt giới hạn sẽ tự giảm', en: 'Prompts per run (auto = AI decides); over the limit is auto-capped', },
    language: { vi: 'Ngôn ngữ của prompt + chữ hiển thị trên ảnh', en: 'Language of prompts + on-image text', },
    detail:   { vi: 'Độ dài/chi tiết mỗi prompt', en: 'Length/detail of each prompt', },
    style:    { vi: 'Phong cách/chất liệu hình (vd cinematic, anime)', en: 'Visual style/medium (e.g. cinematic, anime)', },
    aspect:   { vi: 'Tỷ lệ khung hình', en: 'Aspect ratio', },
    lighting: { vi: 'Kiểu ánh sáng/tông màu của cảnh', en: 'Lighting style/mood of the scene', },
    camera:   { vi: 'Góc máy / ống kính / cỡ cảnh', en: 'Camera angle / lens / shot size', },
    clip:     { vi: 'Thời lượng mỗi clip video', en: 'Duration of each video clip', },
    total:    { vi: 'Tổng thời lượng (video) hoặc tổng slideshow (ảnh)', en: 'Total duration (video) or total slideshow (image)', },
    secimg:   { vi: 'Giây giữ mỗi ảnh — slideshow tự tính số ảnh', en: 'Seconds per image — slideshow auto-computes count', },
    motion:   { vi: 'Chuyển động camera trong video', en: 'Camera movement in video', },
    audio:    { vi: 'Âm thanh kèm video (Veo sinh từ prompt)', en: 'Audio for video (Veo generates from prompt)', },
    tone:     { vi: 'Tông/thể loại nội dung (vd vui, kịch tính)', en: 'Tone/genre of content (e.g. fun, dramatic)', },
    voice:    { vi: 'Chất giọng đọc khi video tự sinh âm thanh (chỉ áp khi Âm thanh = Lời thoại/Đầy đủ)', en: 'Narrator voice when the video model generates audio (only when Audio = Dialogue/Full)', },
  };
  function TIP(k) { const l = locale(); return (window.I18n && window.I18n.t && window.I18n.t('pa.tip_' + k)) || (_TIP[k] && (_TIP[k][l] || _TIP[k].en)) || ''; }

  // Tên hiển thị provider. PA hỗ trợ cả 4: ChatGPT/Gemini/Claude/Grok — grok text-mode ĐÃ nối
  // end-to-end (pa:generate → provider:textTask → chat-content-grok:2950). Bộ đọc response Grok
  // (.message-bubble) là best-effort cần verify live; nhưng KHÔNG còn là WIP/unsupported.
  const _PROV_NAMES = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', grok: 'Grok' };
  function provName(p) { return _PROV_NAMES[p] || 'ChatGPT'; }

  class PromptAssistantModal {
    static _overlay = null;
    static _state = null;
    static _MAX_IMAGES = 5;

    // ─── Public API ───────────────────────────────────────────
    static open() {
      // Feature gate: chưa login → dialog login; login nhưng plan ko có quyền → dialog upgrade.
      // showModuleBlockedDialog tự xử 2 nhánh (login overlay / openUpgradeModal).
      const fg = window.featureGate;
      if (fg && typeof fg.canUse === 'function' && !fg.canUse('prompt_assistant_enabled')) {
        fg.showModuleBlockedDialog('Prompt Assistant');
        return;
      }
      if (PromptAssistantModal._overlay) PromptAssistantModal.close();
      PromptAssistantModal._state = {
        provider: 'chatgpt', idea: '', images: [], sending: false,
        view: 'form', config: null, status: null, result: null,
        formats: [], formatKey: null, formatCategory: null, advancedOpen: false,
        settings: PromptAssistantModal._fallbackSettings(),
      };
      PromptAssistantModal._render();
      PromptAssistantModal._loadConfigAndStatus();
      PromptAssistantModal._subscribeSse();
    }

    // SSE: admin sửa format (gồm is_premium) → reload; user đổi quyền premium → re-render locked.
    static _subscribeSse() {
      if (!window.eventBus) return;
      // Audit fix (memory leak): unbind any previously-registered handlers before
      // re-binding so repeated open() calls can't stack duplicate eventBus listeners.
      if (PromptAssistantModal._onFormatsUpdated) window.eventBus.off?.('pa:formats_updated', PromptAssistantModal._onFormatsUpdated);
      if (PromptAssistantModal._onEntitlements) window.eventBus.off?.('sse:entitlements_changed', PromptAssistantModal._onEntitlements);
      PromptAssistantModal._onFormatsUpdated = () => PromptAssistantModal._reloadFormats();
      window.eventBus.on('pa:formats_updated', PromptAssistantModal._onFormatsUpdated);
      PromptAssistantModal._onEntitlements = () => {
        // featureGate.refresh() + pa:invalidateFormats đã chạy ở SseClient. Đợi xong → RELOAD formats
        // (server trả structure_prompt mới theo quyền) + re-render (canPremium tính lại → mở/khóa).
        setTimeout(() => { if (PromptAssistantModal._state) PromptAssistantModal._reloadFormats(); }, 800);
      };
      window.eventBus.on('sse:entitlements_changed', PromptAssistantModal._onEntitlements);
    }

    static async _reloadFormats() {
      const r = await PromptAssistantModal._bg({ action: 'pa:getFormats' });
      const s = PromptAssistantModal._state;
      if (!s) return;
      if (r?.ok && Array.isArray(r.formats)) {
        s.formats = r.formats;
        if (s.view === 'form') PromptAssistantModal._render();
      }
    }

    static close() {
      PromptAssistantModal._cleanup();
      if (PromptAssistantModal._overlay) { PromptAssistantModal._overlay.remove(); PromptAssistantModal._overlay = null; }
    }

    static _fallbackSettings() {
      return {
        media_type: 'image', count: 'auto', language: 'en', numbered: true,
        clip_duration: 'auto', total_duration: '', seconds_per_image: '', sequential: true, camera_motion: 'auto',
        style: 'cinematic', aspect_ratio: '16:9', lighting: 'auto', camera: 'auto', detail_level: 'concise',
        consistency: true, negative: '', tone: 'auto', audio: 'auto',
        delete_after: false,
        auto_script: false, render_sub: false,
      };
    }

    static _bg(msg) {
      return new Promise((resolve) => {
        try { chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? null : r)); }
        catch (_) { resolve(null); }
      });
    }

    static async _loadConfigAndStatus() {
      const [cfgR, stR, fmtR] = await Promise.all([
        PromptAssistantModal._bg({ action: 'pa:getConfig' }),
        PromptAssistantModal._bg({ action: 'i2p:checkProviders' }), // shared provider-status helper
        PromptAssistantModal._bg({ action: 'pa:getFormats' }),
      ]);
      const s = PromptAssistantModal._state;
      if (!s) return;
      if (cfgR?.ok && cfgR.config) {
        s.config = cfgR.config;
        s.provider = cfgR.config.defaultProvider || 'chatgpt';
        s.settings.delete_after = !!cfgR.config.deleteAfter;
        const d = cfgR.config.defaults || {};
        Object.keys(d).forEach((k) => { if (d[k] !== undefined && d[k] !== null && d[k] !== '') s.settings[k] = d[k]; });
      }
      // Baseline = fallback + server defaults → chọn "Tự do" sẽ reset settings về đây.
      s.baselineSettings = { ...s.settings };
      s.status = stR?.ok ? stR.providers : { chatgpt: { tabOpen: false }, gemini: { tabOpen: false } };
      s.formats = (fmtR?.ok && Array.isArray(fmtR.formats)) ? fmtR.formats : [];
      // Pre-select format đầu (cho structure_prompt + highlight) NHƯNG KHÔNG áp defaults của nó
      // → tôn trọng server default (media_type...). Defaults format chỉ áp khi user BẤM chọn.
      // KHÔNG auto-select format đầu — mặc định "Tự do" (không format) để user chủ động chọn.
      PromptAssistantModal._render();
      PromptAssistantModal._startStatusPoll(); // poll realtime status chatgpt/gemini khi modal mở
    }

    // Chọn 1 content format → áp defaults của loại lên settings (override key có trong defaults).
    // key rỗng = "Tự do" (None) → bỏ chọn format, KHÔNG áp defaults.
    static _applyFormat(key, skipRender) {
      const s = PromptAssistantModal._state;
      if (!key) {
        // "Tự do" → reset toàn bộ settings về baseline (fallback + server defaults),
        // bỏ mọi thứ format trước đã áp lẫn user chỉnh tay.
        s.formatKey = '';
        s.settings = { ...(s.baselineSettings || PromptAssistantModal._fallbackSettings()) };
        if (!skipRender) PromptAssistantModal._render();
        return;
      }
      const fmt = s.formats.find((f) => f.key === key);
      if (!fmt) return;
      s.formatKey = key;
      const d = fmt.defaults || {};
      Object.keys(d).forEach((k) => { if (d[k] !== undefined && d[k] !== null && d[k] !== '') s.settings[k] = d[k]; });
      if (!skipRender) PromptAssistantModal._render();
    }

    // ─── Meta-prompt builder ─────────────────────────────────
    static _buildMetaPrompt() {
      const s = PromptAssistantModal._state, st = s.settings;
      const tpl = (s.config?.promptTemplate || '').trim();
      if (!tpl) return null;

      const mt = st.media_type === 'video' ? 'video' : st.media_type === 'pair' ? 'image and video' : 'image';
      const lang = st.language === 'vi' ? 'Vietnamese' : st.language === 'source' ? 'the same language as the user idea' : 'English';
      const detailRule = st.detail_level === 'detailed' ? 'each prompt 50–80 words'
        : st.detail_level === 'cinematic' ? 'each prompt with full cinematic detail'
        : 'each prompt 20–50 words, concise and precise';

      const C = [];
      const cnt = parseInt(st.count, 10);
      // Pair mode → đếm theo CẢNH (mỗi cảnh = 2 dòng: ảnh + chuyển động) để count rõ ràng.
      const unit = st.media_type === 'pair' ? 'scenes' : 'prompts';
      const isVideo = st.media_type === 'video' || st.media_type === 'pair';
      // Slideshow ảnh tĩnh: total_duration + seconds_per_image → TỰ TÍNH số ảnh (clamp ≤50 — trần 1 response).
      const _perImg = parseInt(st.seconds_per_image, 10);
      const _slideTotal = parseInt(st.total_duration, 10);
      const slideCount = (st.media_type === 'image' && _slideTotal > 0 && _perImg > 0)
        ? Math.max(1, Math.min(PromptAssistantModal._maxCount(), Math.round(_slideTotal / _perImg))) : 0;
      const srt = PromptAssistantModal._parseSrt(s.idea); // auto-detect SRT trong ô Idea
      if (srt) {
        // SRT mode: mỗi cue = 1 cảnh, count = số cue, clip-duration theo timecode.
        C.push(`The USER IDEA is an SRT subtitle script with ${srt.cues.length} cues. Create EXACTLY ${srt.cues.length} ${unit} — ONE per cue, IN ORDER. Each prompt must VISUALIZE the meaning of its cue (not just restate the words); keep each cue's wording unchanged if you reference it.`);
        if (isVideo) C.push("Set each clip's duration close to its cue duration (round to the nearest of 4s/6s/8s/10s).");
        // Native voice + SRT: cue CHÍNH LÀ lời đọc → append VOICEOVER = đúng text cue (giống auto_script)
        // → _splitSub trích ra + _promptsText nối lại cho Veo đọc. render_sub bật thì sub đã burn lên hình
        // nên không cần (native voice tự lấy sub từ chữ on-screen).
        if (isVideo && (st.audio === 'dialogue' || st.audio === 'full') && !st.render_sub) {
          C.push('At the END of EACH prompt block, on a NEW line within the SAME block (no --- before it, never numbered), append: VOICEOVER: "<that cue\'s exact subtitle text>". This line is spoken aloud as the clip\'s voiceover audio.');
        }
      } else if (st.auto_script) {
        // Auto-script: model tự viết kịch bản + sub từ idea, rồi mỗi câu sub → 1 prompt.
        const durHint = (isVideo && st.total_duration) ? ` to fit about ${st.total_duration}s total`
          : slideCount ? ` for a slideshow of ${slideCount} images (~${_perImg}s on screen each)` : '';
        C.push(`SCRIPT MODE: First silently write a coherent ${lang} voice-over script broken into scenes${durHint} — one short spoken line per scene, paced to be read aloud within that scene. Then turn EACH line into one ${unit} that visualizes it.`);
        C.push(slideCount ? `Use EXACTLY ${slideCount} ${unit}.` : (st.count && st.count !== 'auto' && cnt > 0) ? `Use EXACTLY ${cnt} ${unit}.` : `Choose an appropriate number of ${unit}.`);
        // Không burn lên ảnh → đưa lời dẫn xuống CUỐI block dạng VOICEOVER (không bị đánh số, dễ tách).
        // Nếu render_sub bật, lời dẫn đã thành "On-screen subtitle: ..." trong prompt nên không cần VOICEOVER.
        if (!st.render_sub) C.push('At the END of EACH prompt block, on a NEW line within the SAME block (no --- before it, never numbered), append that scene\'s narration as: VOICEOVER: "<exact spoken line>". This is metadata for the user, NOT part of the image description.');
      } else {
        C.push(slideCount ? `Write EXACTLY ${slideCount} ${unit}.`
          : (st.count && st.count !== 'auto' && cnt > 0) ? `Write EXACTLY ${cnt} ${unit}.`
          : `Write an appropriate number of ${unit} for the idea.`);
      }
      // Slideshow ảnh: nêu pacing để model canh nội dung + lời dẫn theo mỗi ảnh (tổng đạt được = count × giây/ảnh).
      if (slideCount) C.push(`This is a SLIDESHOW of still images: produce ${slideCount} images, each held ~${_perImg}s on screen (~${slideCount * _perImg}s total). Pace any narration to ~${_perImg}s per image.`);
      // Chống trùng ý cho list topic ("N lợi ích/cách/lý do") — ép mỗi mục thuộc 1 nhóm khác hẳn.
      C.push('If the idea is a list (e.g. "N benefits/tips/reasons/ways"), each item MUST belong to a CLEARLY DIFFERENT category — never repeat or lightly rephrase the same point.');
      if (st.sequential) C.push('The prompts must form ONE continuous storyboard — each scene flows into the next.');
      if (st.media_type === 'video' || st.media_type === 'pair') {
        if (st.clip_duration && st.clip_duration !== 'auto') C.push(`Each clip lasts about ${st.clip_duration}.`);
        if (st.total_duration) C.push(`Total duration about ${st.total_duration}s — split into clips accordingly.`);
        if (st.camera_motion && st.camera_motion !== 'auto') C.push(`Camera motion: ${st.camera_motion}.`);
        // Audio (Veo 3 sinh âm thanh native từ prompt): mô tả tiếng nền/SFX/lời thoại.
        const audioMap = {
          ambient: 'Include ambient background sound that matches each scene.',
          sfx: 'Include specific sound effects (write as "SFX: ...").',
          music: 'Include background music/score that matches the scene mood (write as "MUSIC: ...").',
          dialogue: 'Include short spoken dialogue in quotes for characters where natural.',
          full: 'Include a full soundscape: ambient noise, sound effects (SFX: ...), and short dialogue in quotes where natural.',
          none: 'No audio — purely visual.',
        };
        // Native voice (audio nói + có narration: auto_script HOẶC SRT): VOICEOVER/cue chính LÀ giọng đọc
        // → đừng yêu cầu thêm thoại nhân vật rời rạc; audio chỉ bổ sung ambient/SFX. (Câu thoại được
        // _promptsText nối lại vào prompt khi forGen — xem fix gap ở _promptsText.)
        const _nativeVoice = (st.audio === 'dialogue' || st.audio === 'full');
        if (_nativeVoice && (st.auto_script || srt) && !st.render_sub) {
          C.push("The scene's VOICEOVER line is spoken aloud as the clip's voiceover (the only speech); also add matching ambient sound and subtle SFX. Do not invent extra unrelated dialogue.");
        } else if (st.audio && audioMap[st.audio]) {
          C.push(audioMap[st.audio]);
        }
        // Chất lượng video: trạng thái đầu/cuối + 1 chuyển động + camera + chống morphing/biến dạng.
        C.push('For every video/motion prompt: state a clear START pose and END pose, ONE controlled main movement, and one subtle or locked camera move; keep the face, body proportions, hands/fingers, costume and background STABLE — no morphing, no extra limbs, no finger or face deformation, no background warping, no scene cut inside a clip.');
      }
      if (st.media_type === 'pair') C.push('For EACH scene output TWO separate prompts (separated by --- like every prompt): first the still IMAGE prompt, then the MOTION/animation prompt for that image. So N scenes = 2N prompts.');
      if (st.style) C.push(`Visual style/medium: ${st.style}.`);
      if (st.aspect_ratio) C.push(`Aspect ratio: ${st.aspect_ratio}.`);
      if (st.lighting && st.lighting !== 'auto') C.push(`Lighting/mood: ${st.lighting}.`);
      if (st.camera && st.camera !== 'auto') C.push(`Camera/lens/framing: ${st.camera}.`);
      C.push(`Length: ${detailRule}.`);
      // Chữ HIỂN THỊ TRONG ẢNH dễ bị image model TỰ DỊCH sang tiếng Anh (model ưu tiên hiểu nghĩa hơn render chữ).
      // Format mạnh (thực nghiệm): nêu NGÔN NGỮ trước + "Exact <lang> text:" + IN HOA + nhiều negative tách rõ
      // → nâng tỉ lệ render đúng tiếng Việt ~20-50% lên ~50-70%. (Muốn 100% phải chèn chữ ở editor — xem Copy SRT.)
      const _subLang = st.language === 'vi' ? 'Vietnamese' : st.language === 'source' ? "the user idea's language" : 'English';
      // English KHÔNG có dấu → bỏ clause "diacritics" + ví dụ tiếng Việt (tránh chỉ dẫn vô nghĩa/nhiễu).
      const _isEnText = _subLang === 'English';
      const _diacritics = _isEnText ? '' : ' render every character with correct diacritics;';
      const _egText = _isEnText ? '' : ' — e.g. Exact Vietnamese text: "BỮA SÁNG ĐẦY ĐỦ"';
      const _strongTextRule = (what) => `For ${what}, write it in the prompt as — Exact ${_subLang} text: "<THE WORDS IN UPPERCASE>"${_egText}. Then add these rules verbatim: ${_subLang} language only; do not translate; do not rewrite; do not paraphrase;${_diacritics} keep the rest of the scene uncluttered so the text stays legible.`;
      if (st.language !== 'en') {
        // Tách ngôn ngữ: mô tả HÌNH luôn English (image/video model chuẩn hơn); CHỈ voiceover + chữ
        // on-screen dùng ngôn ngữ đích. ({language} trong template đã đổi sang English bên dưới.)
        C.push(`Write the VISUAL scene description in ENGLISH for best image/video-model accuracy. ONLY the voiceover/narration and any on-screen text are in ${lang}.`);
        C.push('Whenever the image shows text (signs, labels, titles, posters, UI): ' + _strongTextRule('that text'));
      }
      // render_sub: chèn chính chuỗi phụ đề LÊN ảnh — subtitle band lớn ở đáy khung + format mạnh.
      if (st.render_sub) {
        const _what = srt ? 'the cue subtitle' : (st.auto_script ? 'the narration line' : 'the caption');
        C.push(`Render ${_what} as a LARGE subtitle band at the BOTTOM of the frame. ` + _strongTextRule('that subtitle'));
      }
      if (st.consistency) C.push('Keep the SAME character(s), wardrobe and setting consistent across all prompts.');
      if (st.tone && st.tone !== 'auto') C.push(`Tone/genre: ${st.tone}.`);
      if (st.negative && st.negative.trim()) C.push(`Avoid: ${st.negative.trim()}.`);
      // PA LUÔN cần TEXT prompts — chống ChatGPT/Gemini tự kích hoạt image-gen tool (kể cả khi KHÔNG có ref,
      // nhất là media_type=image → model dễ hiểu là "tạo ảnh" rồi gen luôn thay vì viết prompt).
      C.push('Respond with TEXT prompts ONLY. DO NOT generate, create, draw, render or edit any actual image or video — you are WRITING prompts for the user to paste into a separate image/video tool.');
      // CHỈ nói "có ảnh tham chiếu" khi provider THẬT SỰ upload được ảnh (chatgpt/gemini). Claude/Grok
      // text-only bỏ ảnh âm thầm → nếu vẫn bảo model "dùng ảnh đính kèm" nó sẽ nói dựa ảnh không hề nhận.
      if (s.images.length && (s.provider === 'chatgpt' || s.provider === 'gemini')) C.push('The attached image(s) are REFERENCE ONLY — analyze them to guide character/style/composition; do not reproduce or edit them.');
      C.push(st.numbered ? 'Prefix each prompt with its number (1., 2., 3., ...).' : 'Do NOT number the prompts.');
      // Bắt buộc 1 prompt = 1 block + tách bằng '---'. Tránh model copy anchor đa dòng rồi đánh số TỪNG dòng
      // → parser fallback tách theo \n → vỡ thành nhiều prompt giả (xem _parsePrompts).
      C.push('Separate each prompt with a line containing ONLY --- (three dashes). Write each complete prompt as ONE continuous block on a single line; NEVER break one prompt across multiple lines, and never put a number on anything except the start of a prompt.');

      // Cấu trúc kịch bản từ content format đã chọn (server-driven). Free/none → hướng dẫn tối thiểu.
      const fmt = s.formats.find((f) => f.key === s.formatKey);
      const formatStructure = (fmt?.structure_prompt || '').trim()
        || 'Create a coherent sequence; if the idea implies a story, give it a clear beginning, middle and end.';

      // SRT mode: thay raw SRT bằng danh sách cue gọn (index | giây | text) cho model dễ map 1:1.
      const userInput = srt
        ? 'SRT CUES (index | seconds | text):\n' + srt.cues.map((c, i) => `${i + 1} | ${Math.round(c.dur)}s | ${c.text}`).join('\n')
        : s.idea.trim();
      let out = tpl
        .replace(/\{media_type\}/g, mt)
        .replace(/\{language\}/g, 'English') // visual prompt luôn English; voice/text dùng lang qua constraints
        .replace(/\{format_structure\}/g, formatStructure)
        .replace(/\{constraints\}/g, C.map((x) => `- ${x}`).join('\n'))
        .replace(/\{user_input\}/g, userInput);

      // ChatGPT/Gemini dễ tự kích hoạt tool TẠO ẢNH thay vì viết prompt (đặc biệt media_type=image) →
      // directive cứng ĐẦU message. LUÔN prepend (không chỉ khi có ref) vì PA luôn cần TEXT prompts trả về.
      const _refNote = (s.images.length && (s.provider === 'chatgpt' || s.provider === 'gemini')) ? ' The attached image(s) are REFERENCE material to ANALYZE only.' : '';
      out = `IMPORTANT: Your entire reply must be TEXT prompts as specified below. DO NOT generate, create, draw, render or edit any actual image or video — you are WRITING prompts, NOT producing media.${_refNote}\n\n` + out;
      return out;
    }

    // ─── Parse kết quả ───────────────────────────────────────
    // Ưu tiên tách theo dòng phân cách '---' (cho phép prompt nhiều dòng/phức tạp).
    // Fallback: model quên '---' → tách theo dòng (prompt đơn giản vẫn chạy).
    static _parsePrompts(raw) {
      let text = (raw || '').replace(/^```(?:json|text|markdown)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      let blocks = text.split(/^[ \t]*-{3,}[ \t]*$/m).map((b) => b.trim()).filter(Boolean);
      if (blocks.length <= 1) {
        // Model quên '---'. Nếu output có đánh số prompt (1. 2. 3.) → tách theo ranh giới số
        // (giữ prompt nhiều dòng nguyên khối). Chỉ khi ≥2 mốc số mới áp, tránh false-split.
        const numbered = text.match(/^[ \t]*\d+[.)]\s+/gm);
        if (numbered && numbered.length >= 2) {
          // Giữ newline NỘI BỘ block (để _splitSub còn tách được dòng VOICEOVER) — chỉ trim 2 đầu.
          blocks = text.split(/\n(?=[ \t]*\d+[.)]\s+)/).map((b) => b.trim()).filter(Boolean);
        } else {
          blocks = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        }
      }
      return blocks;
    }

    static _stripNumbering(line) {
      return line.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim();
    }

    // Parse SRT trong ô Idea → {cues:[{start,end,dur,text}], totalDur} hoặc null nếu không phải SRT.
    // Auto-detect: phải có ÍT NHẤT 1 timecode "00:00:00,000 --> 00:00:03,500".
    static _parseSrt(text) {
      const t = (text || '').trim();
      if (!/\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}/.test(t)) return null;
      const tc = (x) => { const m = String(x).match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : 0; };
      const cues = [];
      for (const b of t.split(/\r?\n\s*\r?\n/)) {
        const lines = b.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const ti = lines.findIndex((l) => /-->/.test(l));
        if (ti < 0) continue;
        const [a, c] = lines[ti].split('-->');
        const start = tc(a), end = tc(c);
        const txt = lines.slice(ti + 1).join(' ').trim();
        if (!txt) continue;
        cues.push({ start, end, dur: Math.max(0, end - start), text: txt });
      }
      if (!cues.length) return null;
      // Độ dài video = mốc kết thúc cue cuối (tính cả khoảng lặng); fallback tổng dur nếu end=0.
      return { cues, totalDur: cues[cues.length - 1].end || cues.reduce((s, x) => s + x.dur, 0) };
    }

    // Tách phụ đề/lời dẫn khỏi prompt hình để (a) hiển thị label, (b) đổ Gen đúng phần hình.
    // - VOICEOVER ở CUỐI block (auto_script không burn) → tách RA khỏi body (không đổ vào Gen).
    // - On-screen subtitle / Phụ đề (render_sub) → GIỮ trong body (thuộc ảnh), chỉ trích để hiển thị.
    static _splitSub(block) {
      let body = (block || '').trim();
      let sub = null;
      const vo = body.match(/(?:^|\n)[ \t]*(?:VOICEOVER|VO|Narration|Lời dẫn)[ \t]*[:：][ \t]*["“]?(.+?)["”]?[ \t]*(?=\n|$)/i);
      if (vo) { sub = vo[1].trim(); body = (body.slice(0, vo.index) + body.slice(vo.index + vo[0].length)).trim(); }
      if (!sub) {
        // Hỗ trợ format mạnh mới "Exact <lang> text: ..." + format cũ "On-screen subtitle/Phụ đề: ...".
        const os = body.match(/(?:On-screen subtitle|Subtitle reads|Phụ đề|Exact [\w' ]+ text)[ \t]*[:：][ \t]*["“](.+?)["”]/i);
        if (os) sub = os[1].trim();
      }
      return { sub, body };
    }

    // Gộp block CHỈ-CÓ-SUB (model tách VOICEOVER thành block riêng) vào prompt liền TRƯỚC.
    // Tránh hiểu nhầm count (vd 100 = 50 prompt + 50 sub). Block có nội dung ảnh thì giữ nguyên.
    static _mergeSubBlocks(arr) {
      const out = [];
      for (const block of (arr || [])) {
        const sp = PromptAssistantModal._splitSub(block);
        // body rỗng SAU khi bỏ số thứ tự đầu (vd "98." ) + có sub → đây là block sub-only.
        const bodyEmpty = !((sp.body || '').replace(/^\s*\d+[.)]?\s*/, '').trim());
        if (bodyEmpty && sp.sub && out.length) {
          out[out.length - 1] = out[out.length - 1].replace(/\s*$/, '') + `\nVOICEOVER: "${sp.sub}"`;
        } else {
          out.push(block);
        }
      }
      return out;
    }

    // Text cuối cùng để đổ vào Gen / copy: mỗi prompt strip số đầu + bỏ dòng trống NỘI BỘ
    // (giữ prompt nhiều dòng nguyên khối), các prompt cách nhau dòng trống → GenTab tách đúng N.
    // kind: undefined (tất cả) | 'image' (block chẵn) | 'video' (block lẻ) — cho pair mode.
    // numbered ON → đánh số lại tuần tự "N. " vào trước mỗi prompt. CHỈ áp cho COPY (user đọc);
    // KHÔNG áp khi forGen=true vì GenTab gửi nguyên block vào image model → "1. " sẽ lọt vào prompt ảnh.
    static _promptsText(kind, forGen) {
      const st0 = PromptAssistantModal._state?.settings || {};
      // Native voice: video + audio nói → Veo PHẢI đọc narration. Trước đây VOICEOVER bị strip vô điều kiện
      // (kể cả khi audio=dialogue/full) → Veo câm = GAP. Giờ khi forGen + native voice, nối câu thoại lại
      // vào prompt dạng directive âm thanh (không hiện chữ). SRT vẫn build từ s.result.prompts gốc.
      const nativeVoice = (st0.media_type === 'video' || st0.media_type === 'pair')
        && (st0.audio === 'dialogue' || st0.audio === 'full');
      const langWord = st0.language === 'vi' ? 'Vietnamese' : st0.language === 'source' ? 'the source language' : 'English';
      // Persona giọng đọc native voice từ field `voice` của format (vd "energetic male coach"). Không set → generic.
      const _voice = (st0.voice || '').trim();
      const _voiceArt = /^[aeiou]/i.test(_voice) ? 'an' : 'a'; // a/an theo nguyên âm (vd "energetic" → an)
      const _voiceIn = _voice ? `in ${_voiceArt} ${_voice} voice ` : '';
      let arr = (PromptAssistantModal._state?.result?.prompts || []).slice();
      if (kind === 'image') arr = arr.filter((_, i) => i % 2 === 0);
      else if (kind === 'video') arr = arr.filter((_, i) => i % 2 === 1);
      // Tách dòng VOICEOVER/sub khỏi prompt hình. forGen + native voice → nối lại dạng spoken directive.
      arr = arr.map((p) => {
        const { sub, body } = PromptAssistantModal._splitSub(p);
        let out = PromptAssistantModal._stripNumbering(body).replace(/\n[ \t]*\n+/g, '\n').trim();
        // Chỉ nối voice vào prompt VIDEO. Pair gọi kind='image' (keyframe ảnh) → bỏ qua (ảnh không có audio).
        if (forGen && nativeVoice && sub && kind !== 'image') {
          out += ` Spoken voiceover ${_voiceIn}(${langWord}, audio only — do NOT render as on-screen text): "${sub}".`;
        }
        return out;
      }).filter(Boolean);
      // Đánh số "N. " cho cả copy LẪN gen fill (user bật numbered muốn THẤY số). "1." lọt vào image model
      // là negligible (model bỏ qua) — chấp nhận để giữ trải nghiệm nhất quán với result view.
      if (PromptAssistantModal._state?.settings?.numbered) arr = arr.map((p, i) => `${i + 1}. ${p}`);
      return arr.join('\n\n');
    }

    // Xuất phụ đề dạng SRT (nối auto_script ↔ SRT mode + nạp TTS). Trả null nếu không có sub.
    // - Nguồn đã là SRT → trả lại chính SRT đó.
    // - auto_script → dựng SRT từ sub trích được, ước lượng timecode (chia đều theo total, hoặc theo số từ).
    static _buildSrt() {
      const s = PromptAssistantModal._state;
      if (!s) return null;
      if (PromptAssistantModal._parseSrt(s.idea)) return s.idea.trim();
      const subs = (s.result?.prompts || []).map((p) => PromptAssistantModal._splitSub(p).sub).filter(Boolean);
      if (!subs.length) return null;
      const st = s.settings || {};
      const isVid = st.media_type === 'video' || st.media_type === 'pair';
      // Video có clip_duration cố định → mỗi cue = 1 clip → dùng clip_duration để SRT khớp đúng clip khi ghép.
      const clipSec = isVid ? (parseFloat(st.clip_duration) || 0) : 0; // "6s" → 6 · "auto"/null → 0
      const total = parseFloat(st.total_duration) || 0;
      const pad = (n, w) => String(n).padStart(w, '0');
      const fmt = (sec) => `${pad(Math.floor(sec / 3600), 2)}:${pad(Math.floor((sec % 3600) / 60), 2)}:${pad(Math.floor(sec % 60), 2)},${pad(Math.round((sec - Math.floor(sec)) * 1000), 3)}`;
      let cur = 0;
      return subs.map((text, i) => {
        // Ưu tiên clip_duration (video) → total/N → ước theo số từ (~2.6 từ/giây, tối thiểu 1.8s).
        const dur = clipSec > 0 ? clipSec
          : total > 0 ? total / subs.length
          : Math.max(1.8, text.split(/\s+/).filter(Boolean).length / 2.6);
        const start = cur; cur += dur;
        return `${i + 1}\n${fmt(start)} --> ${fmt(cur)}\n${text}`;
      }).join('\n\n');
    }

    // ─── Render ──────────────────────────────────────────────
    static _render() {
      const exist = PromptAssistantModal._overlay;
      const scrollTop = exist ? exist.querySelector('.pa-body')?.scrollTop : 0;
      // Giữ scroll ngang dải format (click chọn format → re-render không bị cuộn về trái).
      const fmtScrollLeft = exist ? (exist.querySelector('.pa-formats')?.scrollLeft || 0) : 0;
      if (exist) exist.remove();

      const overlay = document.createElement('div');
      overlay.className = 'pa-overlay';
      const s = PromptAssistantModal._state;
      overlay.innerHTML = `
        <div class="pa-modal">
          <div class="pa-header">
            <div class="pa-title"><svg class="pa-title-ic" width="24" height="24" viewBox="0 0 18 18" fill="none" role="img" aria-label="Prompt Assistant"><path d="M3.47158 3.7689C4.43604 4.12493 5.19375 4.88096 5.55044 5.84302C5.64791 6.10611 5.89926 6.28072 6.18038 6.28072C6.46138 6.28072 6.71273 6.10611 6.81033 5.84328C7.16715 4.88096 7.92499 4.12493 8.88932 3.7689C9.15287 3.67152 9.32787 3.42073 9.32787 3.14036C9.32787 2.85999 9.15287 2.6092 8.88932 2.51182C7.92499 2.15579 7.16728 1.39976 6.81033 0.437441C6.71273 0.17461 6.46138 0 6.18038 0C5.89926 0 5.64804 0.17461 5.55044 0.437703C5.19362 1.39976 4.43591 2.15579 3.47158 2.51182C3.20803 2.6092 3.03303 2.85999 3.03303 3.14036C3.03303 3.42073 3.20803 3.67152 3.47158 3.7689ZM6.18038 2.07621C6.4783 2.48407 6.83814 2.84324 7.24704 3.14036C6.83801 3.43748 6.4783 3.79639 6.18038 4.20451C5.8826 3.79639 5.52289 3.43748 5.11386 3.14036C5.52276 2.84324 5.8826 2.48407 6.18038 2.07621ZM14.9858 15.163C14.4549 14.967 14.0377 14.5507 13.8412 14.0209C13.7436 13.7578 13.4923 13.5832 13.2113 13.5832C12.9302 13.5832 12.6788 13.7578 12.5813 14.0209C12.385 14.5507 11.9678 14.967 11.4368 15.163C11.1731 15.2604 10.9981 15.5112 10.9981 15.7916C10.9981 16.072 11.1731 16.3228 11.4368 16.4201C11.9678 16.6162 12.385 17.0324 12.5813 17.5623C12.6788 17.8254 12.9302 18 13.2113 18C13.4923 18 13.7436 17.8254 13.8412 17.5623C14.0377 17.0324 14.4549 16.6162 14.9858 16.4201C15.2495 16.3228 15.4245 16.072 15.4245 15.7916C15.4245 15.5112 15.2495 15.2604 14.9858 15.163ZM13.2113 16.0521C13.1293 15.9604 13.0422 15.8735 12.9502 15.7916C13.0422 15.7097 13.1293 15.6227 13.2113 15.5311C13.2934 15.6227 13.3805 15.7097 13.4723 15.7916C13.3805 15.8735 13.2934 15.9604 13.2113 16.0521ZM13.6885 9.89753L15.3237 8.25012C15.8941 7.67524 15.8918 6.74224 15.3186 6.17025L13.5778 4.43331C13.2988 4.15477 12.9277 4.00137 12.5329 4.00137C12.1382 4.00137 11.7671 4.15477 11.4882 4.43331L9.83338 6.08445C9.83292 6.08491 9.83233 6.08523 9.83187 6.08569C9.83145 6.08608 9.83122 6.08661 9.83076 6.08707L2.44678 13.4546C2.32071 13.5803 2.25 13.7507 2.25 13.9285V16.8463C2.25 17.2165 2.55067 17.5165 2.92166 17.5165H5.846C6.02519 17.5165 6.19704 17.445 6.32324 17.3178L13.6885 9.89753ZM12.4381 5.38097C12.5033 5.31578 12.5631 5.31631 12.6279 5.38097L14.3687 7.1179C14.4208 7.17 14.4209 7.25482 14.3691 7.30717L13.2069 8.47813L11.2613 6.55513L12.4381 5.38097ZM5.56592 16.1762H3.59332V14.206L10.3113 7.50299L12.2616 9.4305L5.56592 16.1762Z" fill="currentColor"></path></svg><span>${L('title')}</span></div>
            <button class="pa-close" title="${L('close')}">✕</button>
          </div>
          <div class="pa-body">${s.view === 'result' ? PromptAssistantModal._formResult() : PromptAssistantModal._formInput()}</div>
          <div class="pa-footer">${PromptAssistantModal._footer()}</div>
        </div>`;
      document.body.appendChild(overlay);
      PromptAssistantModal._overlay = overlay;
      PromptAssistantModal._bind();
      const body = overlay.querySelector('.pa-body');
      if (body && scrollTop) body.scrollTop = scrollTop;
      const fmts = overlay.querySelector('.pa-formats');
      if (fmts && fmtScrollLeft) fmts.scrollLeft = fmtScrollLeft;
      if (s.view === 'form') PromptAssistantModal._renderImages();
    }

    static _opt(val, cur, label) { return `<option value="${val}"${val === cur ? ' selected' : ''}>${label}</option>`; }
    static _esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    // Icon SVG do admin nhập → render innerHTML trong sidebar (privileged). Strip script + on* handlers
    // + javascript: href (defense-in-depth dù admin-trusted).
    static _sanitizeSvg(svg) {
      return String(svg || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<\/?(foreignObject|iframe|use)\b[^>]*>/gi, '')
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/(?:href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
    }

    // Fallback thumbnail: gradient màu suy ra deterministic từ tên format (mỗi style một sắc riêng)
    // → thẻ trông "đầy" & phân biệt khi không có ảnh server (offline). Chỉ trả CSS inline (an toàn CSP).
    static _fmtGradient(seed) {
      const str = String(seed || 'x');
      // FNV-1a 32-bit + xorshift avalanche → hue phân tán đều dù tên gần giống nhau.
      let h = 0x811c9dc5 >>> 0;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = h >>> 0;
      const h1 = h % 360;
      const h2 = (h1 + 40 + ((h >>> 9) % 80)) % 360;
      return `background:linear-gradient(135deg,hsl(${h1}, 60%, 44%),hsl(${h2}, 58%, 27%))`;
    }

    static _formInput() {
      const s = PromptAssistantModal._state, st = s.settings;
      const isVideo = st.media_type === 'video' || st.media_type === 'pair';
      const E = PromptAssistantModal._esc, O = PromptAssistantModal._opt;
      const dot = (p) => { const x = s.status?.[p]; return x?.ready ? 'on' : (x?.tabOpen ? 'warn' : ''); };
      const pv = (p, name) => `<div class="pa-pv${s.provider === p ? ' sel' : ''}" data-prov="${p}"><span class="pa-dot ${dot(p)}"></span>${name}</div>`;
      const lightOpt = [['auto', L('auto')], ['golden_hour', L('golden_hour')], ['blue hour', L('blueHour')], ['rim light', L('rim')], ['low-key', L('lowKey')], ['high-key', L('highKey')], ['volumetric', L('volumetric')], ['neon', L('neon')], ['dramatic', L('dramatic')], ['soft', L('soft')]];
      const camOpt = [['auto', L('auto')], ['close_up', L('close_up')], ['medium shot', L('medium')], ['wide', L('wide')], ['aerial drone', L('aerial')], ['low angle', L('lowAngle')], ['high angle', L('highAngle')], ['macro', L('macro')], ['35mm', L('lens35')], ['85mm', L('lens85')]];
      const motOpt = [['auto', L('auto')], ['dolly in', L('dolly')], ['tracking', L('tracking')], ['orbit', L('orbit')], ['pan', L('pan')], ['tilt', L('tilt')], ['zoom', L('zoom')], ['crane', L('crane')], ['handheld', L('handheld')], ['static', L('staticMot')]];
      const audioOpt = [['auto', L('auto')], ['none', L('audioNone')], ['ambient', L('audioAmbient')], ['sfx', L('audioSfx')], ['music', L('audioMusic')], ['dialogue', L('audioDialogue')], ['full', L('audioFull')]];
      const dfltFmtSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z"/></svg>';
      const noneIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.63605 5.63603L18.364 18.364M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"/></svg>';
      // Tabs theo category (gom format). __other__ = format chưa set category.
      // Sort theo SỐ LƯỢNG format giảm dần (category nhiều format đứng đầu); tie → first-appearance.
      const fmtCatCount = {};
      s.formats.forEach((f) => { if (f.category) fmtCatCount[f.category] = (fmtCatCount[f.category] || 0) + 1; });
      const fmtCats = [...new Set(s.formats.map((f) => f.category).filter(Boolean))]
        .sort((a, b) => fmtCatCount[b] - fmtCatCount[a]);
      const fmtHasUncat = s.formats.some((f) => !f.category);
      const fmtTabs = fmtCats.slice();
      if (fmtHasUncat && fmtCats.length) fmtTabs.push('__other__'); // __other__ luôn cuối
      const curCat = s.formatCategory || fmtTabs[0] || null;
      const fmtTabsHtml = fmtTabs.length
        ? `<div class="pa-fmt-tabs-wrap">
            <div class="pa-fmt-tabs">${fmtTabs.map((c) => `<button class="pa-fmt-tab${curCat === c ? ' sel' : ''}" data-cat="${E(c)}">${c === '__other__' ? E(L('formatOther')) : E(c)}</button>`).join('')}</div>
            <button class="pa-fmt-tabs-more" type="button" aria-label="More" hidden>⋯</button>
          </div>`
        : '';
      const visFormats = fmtTabs.length
        ? s.formats.filter((f) => (curCat === '__other__' ? !f.category : f.category === curCat))
        : s.formats;
      // Card "Tự do" (None) ở đầu — CHỈ icon (không tên), giống thiết kế.
      const noneCard = `<button class="pa-fmt pa-fmt--none${!s.formatKey ? ' sel' : ''}" data-fmt="" data-tooltip="${E(L('formatNone'))}" data-tooltip-placement="bottom"><span class="pa-fmt-thumb pa-fmt-thumb--icon"><span class="pa-fmt-ic">${noneIcon}</span></span></button>`;
      // Premium gating: format is_premium mà user KHÔNG có quyền premium_templates → khóa (disabled + crown vàng).
      // CỐ Ý dùng canUse('premium_templates') THUẦN (không qua canAccessPremiumTemplates) → ADMIN cũng bị gate
      // nếu thiếu entitlement (khác workflow template có admin bypass). Chỉ áp riêng cho PA format.
      const canPremium = window.featureGate?.canUse?.('premium_templates') || false;
      const crownSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"/></svg>';
      // Card format dọc: thumbnail (hoặc fallback icon) + tên overlay dưới đáy.
      const fmtCard = (f) => {
        const thumb = f.thumbnail || '';
        const locked = !!f.is_premium && !canPremium;
        const body = thumb
          ? `<span class="pa-fmt-thumb" style="background-image:url('${E(thumb)}')"></span>`
          : `<span class="pa-fmt-thumb pa-fmt-thumb--auto" style="${PromptAssistantModal._fmtGradient(f.name || f.key || '')}"><span class="pa-fmt-ic">${PromptAssistantModal._sanitizeSvg(f.icon) || dfltFmtSvg}</span></span>`;
        const crown = f.is_premium ? `<span class="pa-fmt-crown" title="${E(locked ? L('premiumNeed') : 'Premium')}">${crownSvg}</span>` : '';
        return `<button class="pa-fmt${s.formatKey === f.key ? ' sel' : ''}${locked ? ' pa-fmt--locked' : ''}" data-fmt="${E(f.key)}" data-thumb="${E(thumb)}" data-video="${E(f.preview_video || '')}" data-tooltip="${E(f.name)}" data-tooltip-placement="bottom" data-locked="${locked ? '1' : ''}">${crown}${body}<span class="pa-fmt-nm">${E(f.name)}</span></button>`;
      };
      const fmtChips = noneCard + visFormats.map(fmtCard).join('');

      return `
        <div class="pa-row pa-provs">
          <span class="pa-lbl">${L('provider')}</span>
          ${pv('chatgpt', 'ChatGPT')}${pv('gemini', 'Gemini')}${pv('claude', 'Claude')}${pv('grok', 'Grok')}
        </div>
        <textarea class="pa-idea" rows="3" placeholder="${E(L('ideaPlaceholder'))}">${E(s.idea || '')}</textarea>
        ${(() => { const srt = PromptAssistantModal._parseSrt(s.idea); return srt ? `<div class="pa-srt-badge">${L('srtDetected').replace('{n}', srt.cues.length).replace('{dur}', Math.round(srt.totalDur))}</div>` : ''; })()}
        <div class="pa-idea-tools">
          <button class="pa-skillbtn" type="button">${locale() === 'en' ? '+ Skill' : '+ Skill'}</button>
          <button class="pa-presetbtn" type="button" title="${locale() === 'en' ? 'Article → storyboard mode' : 'Chế độ Bài viết → storyboard'}">${locale() === 'en' ? 'Article → storyboard' : 'Bài viết → storyboard'}</button>
          <div class="pa-skillmenu" hidden></div>
        </div>

        ${s.formats.length ? `<div class="pa-fmtwrap">
          ${fmtTabsHtml}
          <div class="pa-formats">${fmtChips}</div>
        </div>` : ''}

        <div class="pa-grid pa-primary">
          ${PromptAssistantModal._field(L('mediaType'), `<select data-set="media_type">
            ${O('image', st.media_type, L('image'))}${O('video', st.media_type, L('video'))}${O('pair', st.media_type, L('pair'))}
          </select>`, 'media', false, TIP('type'))}
          ${PromptAssistantModal._field(L('count'), `<input type="text" data-set="count" value="${E(st.count)}" placeholder="auto · ≤${PromptAssistantModal._maxCount()}">`, 'count', false, TIP('count'))}
        </div>

        ${PromptAssistantModal._refSection()}

        <button class="pa-adv-toggle" type="button">${s.advancedOpen ? '▾' : '▸'} ${L('advanced')}</button>

        <div class="pa-adv" style="display:${s.advancedOpen ? 'block' : 'none'}">
          <div class="pa-grid">
            ${PromptAssistantModal._field(L('language'), `<select data-set="language">
              ${O('en', st.language, 'English')}${O('vi', st.language, 'Tiếng Việt')}${O('source', st.language, L('langSource'))}
            </select>`, 'language', false, TIP('language'))}
            ${PromptAssistantModal._field(L('detail'), `<select data-set="detail_level">
              ${O('concise', st.detail_level, L('concise'))}${O('detailed', st.detail_level, L('detailed'))}${O('cinematic', st.detail_level, L('cinematic'))}
            </select>`, 'detail', false, TIP('detail'))}
            ${PromptAssistantModal._field(L('style'), `<input type="text" data-set="style" value="${E(st.style)}">`, 'style', false, TIP('style'))}
            ${PromptAssistantModal._field(L('aspect'), `<div class="pa-aspect">
              ${['16:9', '9:16', '1:1', '4:3', '3:4'].map((r) => `<button type="button" class="pa-ar${st.aspect_ratio === r ? ' sel' : ''}" data-aspect="${r}" title="${r}">${PromptAssistantModal._ratioSvg(r)}<span>${r}</span></button>`).join('')}
            </div>`, 'aspect', true, TIP('aspect'))}
            ${PromptAssistantModal._field(L('lighting'), `<select data-set="lighting">${lightOpt.map(([v, l]) => O(v, st.lighting, l)).join('')}</select>`, 'lighting', false, TIP('lighting'))}
            ${PromptAssistantModal._field(L('camera'), `<select data-set="camera">${camOpt.map(([v, l]) => O(v, st.camera, l)).join('')}</select>`, 'camera', false, TIP('camera'))}
            ${isVideo ? PromptAssistantModal._field(L('clipDuration'), `<select data-set="clip_duration">
              ${['auto', '4s', '6s', '8s', '10s'].map((r) => O(r, st.clip_duration, r === 'auto' ? L('auto') : r)).join('')}
            </select>`, 'clock', false, TIP('clip')) : ''}
            ${isVideo ? PromptAssistantModal._field(L('totalDuration'), `<input type="text" data-set="total_duration" value="${E(st.total_duration)}" placeholder="30">`, 'clock', false, TIP('total')) : ''}
            ${isVideo ? PromptAssistantModal._field(L('cameraMotion'), `<select data-set="camera_motion">${motOpt.map(([v, l]) => O(v, st.camera_motion, l)).join('')}</select>`, 'motion', false, TIP('motion')) : ''}
            ${isVideo ? PromptAssistantModal._field(L('audio'), `<select data-set="audio">${audioOpt.map(([v, l]) => O(v, st.audio, l)).join('')}</select>`, 'audio', false, TIP('audio')) : ''}
            ${(isVideo && (st.audio === 'dialogue' || st.audio === 'full')) ? PromptAssistantModal._field(L('voice'), `<input type="text" data-set="voice" value="${E(st.voice || '')}" placeholder="${E(L('voicePh'))}">`, 'voice', false, TIP('voice')) : ''}
            ${st.media_type === 'image' ? PromptAssistantModal._field(L('totalDuration'), `<input type="text" data-set="total_duration" value="${E(st.total_duration)}" placeholder="60">`, 'clock', false, TIP('total')) : ''}
            ${st.media_type === 'image' ? PromptAssistantModal._field(L('secPerImage'), `<input type="text" data-set="seconds_per_image" value="${E(st.seconds_per_image)}" placeholder="5">`, 'clock', false, TIP('secimg')) : ''}
            ${PromptAssistantModal._field(L('tone'), `<input type="text" data-set="tone" value="${E(st.tone === 'auto' ? '' : st.tone)}" placeholder="auto">`, 'tone', false, TIP('tone'))}
          </div>

          <div class="pa-toggles">
            ${PromptAssistantModal._toggle('sequential', st.sequential, L('sequential'))}
            ${PromptAssistantModal._toggle('consistency', st.consistency, L('consistency'))}
            ${PromptAssistantModal._toggle('numbered', st.numbered, L('numbered'))}
            ${PromptAssistantModal._toggle('auto_script', st.auto_script, L('autoScript'))}
            ${PromptAssistantModal._toggle('render_sub', st.render_sub, L('renderSub'))}
          </div>

          <div class="pa-row pa-negwrap">
            <input type="text" class="pa-neg" data-set="negative" value="${E(st.negative || '')}" placeholder="${E(L('negative'))}">
          </div>
        </div>

        ${PromptAssistantModal._statusHint()}`;
    }

    // Block chọn/kéo thả ảnh tham chiếu — tách riêng để đặt NGOÀI Advanced (phía trên toggle).
    static _refSection() {
      const s = PromptAssistantModal._state;
      const E = PromptAssistantModal._esc;
      return `
        <div class="pa-refsec">
          <div class="pa-reflabel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><path d="M9 5.62a2.38 2.38 0 1 1 0 4.76 2.38 2.38 0 0 1 0-4.76"></path><path fill-rule="evenodd" d="M16.19 2C19.83 2 22 4.17 22 7.81v8.38c0 3.64-2.17 5.81-5.81 5.81H7.81c-2.39 0-4.157-.94-5.078-2.623l-.172-.347a5 5 0 0 1-.171-.422l-.022-.062C2.126 17.855 2 17.069 2 16.19V7.81C2 4.17 4.17 2 7.81 2zM7.81 3.5C4.99 3.5 3.5 4.99 3.5 7.81v8.38c0 .76.13 1.41.35 1.97l3.74-2.51c.8-.54 1.93-.48 2.64.14l.34.28c.78.67 2.04.67 2.82 0l4.16-3.57c.78-.67 2.04-.67 2.82 0l.13.11v-4.8c0-2.82-1.49-4.31-4.31-4.31z" clip-rule="evenodd"></path></g></svg>
            <span>${L('addRef')}</span>
          </div>
          <div class="pa-refhead">
            <button class="pa-imgbtn pa-imgbtn--wide" title="${E(L('refSelectDrag'))}">
              <svg class="pa-imgbtn-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8h.01"/><path d="M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5"/><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l3.5 3.5"/><path d="M14 14l1 -1c.679 -.653 1.473 -.829 2.214 -.526"/><path d="M19 22v-6"/><path d="M22 19l-3 -3l-3 3"/></svg>
              <span>${L('refSelectDrag')}</span>
            </button>
            <span class="pa-refcount">${s.images.length}/${PromptAssistantModal._MAX_IMAGES}</span>
          </div>
          <div class="pa-imglist"></div>
        </div>`;
    }

    // Footer (nút action) — tách khỏi body cuộn để không đè field (real footer flex-shrink:0).
    static _footer() {
      const s = PromptAssistantModal._state;
      if (s.view === 'result') {
        const has = (s.result?.prompts || []).length;
        // Pair: ảnh + video xen kẽ → 2 nút riêng (set genType + tách chẵn/lẻ). Khác: 1 nút.
        // Icon sparkle trắng (fill=currentColor → trắng theo color:#fff của .pa-fill).
        const fillIc = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z"></path><path d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z"></path></svg>';
        const fillBtns = s.settings.media_type === 'pair'
          ? `<button class="pa-fill" data-kind="image" ${has ? '' : 'disabled'}>${fillIc}${L('fillImages')}</button>
          <button class="pa-fill" data-kind="video" ${has ? '' : 'disabled'}>${fillIc}${L('fillVideos')}</button>`
          : `<button class="pa-fill" ${has ? '' : 'disabled'}>${fillIc}${L('fillGen')}</button>`;
        // Nút Copy SRT: chỉ hiện khi có phụ đề (auto_script sinh sub HOẶC nguồn là SRT).
        const hasSub = !!PromptAssistantModal._buildSrt();
        return `${fillBtns}
          <button class="pa-copy" ${has ? '' : 'disabled'}>${L('copy')}</button>
          ${hasSub ? `<button class="pa-copysrt">${L('copySrt')}</button>` : ''}
          <button class="pa-back">${L('back')}</button>`;
      }
      const sparkle = '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z"></path><path d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z"></path></svg>';
      return `<button class="pa-generate" ${s.sending || !s.idea.trim() ? 'disabled' : ''}>
          ${s.sending ? `<span class="pa-spinner"></span> ${L('generating')}` : `${sparkle}${L('generate')}`}
        </button>
        ${s.sending ? `<button class="pa-cancel-gen">${L('cancel')}</button>` : ''}`;
    }

    static _statusHint() {
      const s = PromptAssistantModal._state;
      const cur = s.status?.[s.provider];
      if (!s.status || cur?.ready) return '';
      const name = provName(s.provider);
      const msg = cur?.tabOpen ? L('notLogged') : L('noTab');
      return `<div class="pa-hint">${name} ${msg} · <button class="pa-openlogin">${L('openTab')}</button></div>`;
    }

    static _formResult() {
      const s = PromptAssistantModal._state;
      const list = s.result?.prompts || [];
      const numbered = s.settings.numbered;
      return `
        <div class="pa-result-head">${L('resultCount')} ${list.length} ${L('resultUnit')}</div>
        <div class="pa-result-list">
          ${list.map((p, i) => { const sp = PromptAssistantModal._splitSub(p); return `<div class="pa-result-item">${numbered ? `<span class="pa-num">${i + 1}.</span>` : ''}<div class="pa-pcol">${sp.sub ? `<div class="pa-sub">${PromptAssistantModal._esc(sp.sub)}</div>` : ''}<span class="pa-ptext">${PromptAssistantModal._esc(PromptAssistantModal._stripNumbering(sp.body))}</span></div></div>`; }).join('') || `<div class="pa-hint">${L('empty')}</div>`}
        </div>`;
    }

    // Số prompt tối đa/lần — server-driven (config.maxCount từ default-settings), fallback 50.
    static _maxCount() {
      const m = parseInt(PromptAssistantModal._state?.config?.maxCount, 10);
      return (m && m > 0) ? m : 50;
    }
    // count: 'auto' | số nguyên 1..maxCount (rỗng/không hợp lệ → 'auto').
    static _sanitizeCount(v) {
      v = String(v == null ? '' : v).trim().toLowerCase();
      if (v === '' || v === 'auto') return 'auto';
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) return 'auto';
      return String(Math.min(n, PromptAssistantModal._maxCount()));
    }
    // total_duration (giây): '' | số nguyên 1..600 (rỗng/không hợp lệ → '').
    static _sanitizeDuration(v) {
      v = String(v == null ? '' : v).trim();
      if (v === '') return '';
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) return '';
      return String(Math.min(n, 600));
    }
    // seconds_per_image (giây giữ mỗi ảnh): '' | số nguyên 1..60 (rỗng/không hợp lệ → '').
    static _sanitizeSecPerImage(v) {
      v = String(v == null ? '' : v).trim();
      if (v === '') return '';
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) return '';
      return String(Math.min(n, 60));
    }

    static _field(label, control, iconName, full, tip) {
      const ic = iconName ? PromptAssistantModal._fieldIcon(iconName) : '';
      // Dùng SmartTooltip sẵn có của extension ([data-tooltip] — dark + smart edge detection).
      // align="auto" → tooltip canh trái/phải theo vị trí field (field cột trái → canh trái, cột phải → canh phải).
      const t = tip ? ` data-tooltip="${PromptAssistantModal._esc(tip)}" data-tooltip-align="auto"` : '';
      return `<div class="pa-f${full ? ' pa-f--full' : ''}"><label${t}>${ic}<span>${label}</span></label>${control}</div>`;
    }
    static _toggle(key, on, label) { return `<label class="pa-tg"><input type="checkbox" data-toggle="${key}"${on ? ' checked' : ''}><span>${label}</span></label>`; }

    // Icon SVG nhỏ bên trái label field (stroke currentColor, 13px). Map theo chức năng.
    static _fieldIcon(name) {
      const P = {
        media: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 21"/>',
        count: '<line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/>',
        language: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>',
        detail: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="9" y2="18"/>',
        style: '<path d="M2 12a10 10 0 1 0 10-10c5 0 8 3.6 8 8 0 3.3-2.7 6-6 6h-2a1.6 1.6 0 0 0-1.6 1.6c0 .5.2.8.4 1.1.3.3.4.7.4 1.1A1.6 1.6 0 0 1 12 22"/><circle cx="8.5" cy="8" r="1"/><circle cx="13.5" cy="6.5" r="1"/><circle cx="16.5" cy="11" r="1"/>',
        aspect: '<rect x="3" y="5" width="18" height="14" rx="2"/>',
        lighting: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
        camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        motion: '<polygon points="6 4 20 12 6 20 6 4"/>',
        audio: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/>',
        tone: '<path d="M3 11h3l2-7 4 14 2-7h4"/>',
        voice: '<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/>',
      };
      const d = P[name];
      return d ? `<svg class="pa-f-ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>` : '';
    }

    // SVG hình chữ nhật đúng tỉ lệ cho từng item Aspect (vẽ rect scale theo a:b trong viewBox 24).
    static _ratioSvg(r) {
      const [a, b] = String(r).split(':').map(Number);
      const max = 18; let w, h;
      if (!a || !b) { w = h = 16; } else if (a >= b) { w = max; h = max * b / a; } else { h = max; w = max * a / b; }
      const x = (24 - w) / 2, y = (24 - h) / 2;
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"/></svg>`;
    }

    // ─── Bind ────────────────────────────────────────────────
    static _bind() {
      const ov = PromptAssistantModal._overlay; if (!ov) return;
      const s = PromptAssistantModal._state;

      // KHÔNG đóng khi click backdrop (tránh mất dữ liệu form) — chỉ đóng qua nút X hoặc Esc.
      ov.querySelector('.pa-close')?.addEventListener('click', () => PromptAssistantModal.close());
      // _bind chạy mỗi _render → gỡ listener cũ trước khi gắn mới (tránh leak document keydown).
      if (PromptAssistantModal._esc2) document.removeEventListener('keydown', PromptAssistantModal._esc2);
      PromptAssistantModal._esc2 = (e) => { if (e.key === 'Escape') PromptAssistantModal.close(); };
      document.addEventListener('keydown', PromptAssistantModal._esc2);

      ov.querySelector('.pa-idea')?.addEventListener('input', (e) => {
        s.idea = e.target.value;
        const g = ov.querySelector('.pa-generate'); if (g) g.disabled = s.sending || !s.idea.trim();
        // Live badge nhận diện SRT (không full re-render để giữ con trỏ).
        const srt = PromptAssistantModal._parseSrt(s.idea);
        let badge = ov.querySelector('.pa-srt-badge');
        if (srt) {
          if (!badge) { badge = document.createElement('div'); badge.className = 'pa-srt-badge'; e.target.insertAdjacentElement('afterend', badge); }
          badge.textContent = L('srtDetected').replace('{n}', srt.cues.length).replace('{dur}', Math.round(srt.totalDur));
        } else if (badge) { badge.remove(); }
      });

      // Skill picker: mở menu skill từ kho prompt (bundled + user), click → chèn content vào ô ý tưởng.
      const skillBtn = ov.querySelector('.pa-skillbtn');
      const skillMenu = ov.querySelector('.pa-skillmenu');
      if (skillBtn && skillMenu) {
        skillBtn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (!skillMenu.hidden) { skillMenu.hidden = true; return; }
          try { const mgr = window.userPromptsManager; if (mgr && (!mgr.prompts || !mgr.prompts.length)) await mgr.loadPrompts(); } catch (_) { globalThis.SEOSONA_swallow?.('PromptAssistantModal#_esc2', _); }
          const all = (window.userPromptsManager && window.userPromptsManager.prompts) || [];
          const E = PromptAssistantModal._esc;
          if (!all.length) { skillMenu.innerHTML = `<div class="pa-skillmenu-empty">${locale() === 'en' ? 'Library empty' : 'Kho skill trống'}</div>`; skillMenu.hidden = false; return; }
          const byCat = {};
          all.forEach((p) => { const c = p.category || (locale() === 'en' ? 'Other' : 'Khác'); (byCat[c] = byCat[c] || []).push(p); });
          let html = '';
          Object.keys(byCat).forEach((cat) => {
            html += `<div class="pa-skillmenu-cat">${E(cat)}</div>`;
            byCat[cat].forEach((p) => { html += `<button class="pa-skillmenu-item" type="button" data-id="${E(String(p.id))}" title="${E(String(p.content || '').slice(0, 160))}">${E(p.title || String(p.id))}</button>`; });
          });
          skillMenu.innerHTML = html;
          skillMenu.hidden = false;
          skillMenu.querySelectorAll('.pa-skillmenu-item').forEach((it) => it.addEventListener('click', (e2) => {
            e2.stopPropagation();
            const p = all.find((x) => String(x.id) === it.dataset.id);
            if (!p) return;
            const cur = (PromptAssistantModal._state.idea || '').trim();
            PromptAssistantModal._state.idea = cur ? (cur + '\n\n' + (p.content || '')) : (p.content || '');
            skillMenu.hidden = true;
            PromptAssistantModal._render();
            const ni = PromptAssistantModal._overlay && PromptAssistantModal._overlay.querySelector('.pa-idea');
            if (ni) { ni.focus(); try { ni.setSelectionRange(ni.value.length, ni.value.length); } catch (_) { globalThis.SEOSONA_swallow?.('PromptAssistantModal#_esc2', _); } }
          }));
        });
        skillMenu.addEventListener('click', (e) => e.stopPropagation());
        // Đóng menu khi click ra ngoài. Remove-before-add (closure mới mỗi render) → không rò rỉ listener.
        if (PromptAssistantModal._closeSkillHandler) document.removeEventListener('click', PromptAssistantModal._closeSkillHandler);
        PromptAssistantModal._closeSkillHandler = (e) => { const m = PromptAssistantModal._overlay && PromptAssistantModal._overlay.querySelector('.pa-skillmenu'); const b = PromptAssistantModal._overlay && PromptAssistantModal._overlay.querySelector('.pa-skillbtn'); if (m && !m.hidden && !m.contains(e.target) && e.target !== b) m.hidden = true; };
        document.addEventListener('click', PromptAssistantModal._closeSkillHandler);
      }

      // Preset "Bài viết → storyboard": bật auto_script + sequential + mở Nâng cao.
      ov.querySelector('.pa-presetbtn')?.addEventListener('click', () => {
        const st = PromptAssistantModal._state.settings;
        st.auto_script = true; st.sequential = true;
        PromptAssistantModal._state.advancedOpen = true;
        PromptAssistantModal._render();
        window.showNotification?.((locale() === 'en'
          ? 'Article → storyboard mode on — paste your article, then Generate'
          : 'Đã bật chế độ Bài viết → storyboard — dán bài viết vào ô ý tưởng rồi bấm Tạo prompt'), 'info', 3800);
      });

      ov.querySelectorAll('.pa-pv').forEach((el) => el.addEventListener('click', () => {
        s.provider = el.dataset.prov; PromptAssistantModal._render(); PromptAssistantModal._refreshStatus();
      }));

      ov.querySelectorAll('[data-set]').forEach((el) => el.addEventListener('change', () => {
        const k = el.dataset.set;
        let v = el.value;
        // Validate numeric: count ('auto'|1..50), total_duration (''|1..600s) — chặn chữ/âm/0.
        if (k === 'count') {
          const _before = String(v).trim();
          v = PromptAssistantModal._sanitizeCount(v); el.value = v;
          const _max = PromptAssistantModal._maxCount();
          if (/^\d+$/.test(_before) && parseInt(_before, 10) > _max) {
            window.showNotification?.(L('countCapped').replace(/\{max\}/g, _max), 'warning', 2800);
          }
        }
        else if (k === 'total_duration') { v = PromptAssistantModal._sanitizeDuration(v); el.value = v; }
        else if (k === 'seconds_per_image') { v = PromptAssistantModal._sanitizeSecPerImage(v); el.value = v; }
        s.settings[k] = v;
        // media_type / audio đổi → re-render (audio=dialogue/full mới hiện field Giọng đọc).
        if (k === 'media_type' || k === 'audio') PromptAssistantModal._render();
      }));
      ov.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('change', () => {
        s.settings[el.dataset.toggle] = el.checked;
      }));
      // Aspect ratio chips (icon tỉ lệ) → set + toggle sel (không re-render để giữ con trỏ/scroll).
      ov.querySelectorAll('.pa-ar').forEach((b) => b.addEventListener('click', () => {
        s.settings.aspect_ratio = b.dataset.aspect;
        ov.querySelectorAll('.pa-ar').forEach((x) => x.classList.toggle('sel', x === b));
      }));

      // Tab category → click chọn + drag-to-scroll + nút "more" khi tràn width.
      const tabsWrap = ov.querySelector('.pa-fmt-tabs-wrap');
      const tabsEl = ov.querySelector('.pa-fmt-tabs');
      const moreBtn = ov.querySelector('.pa-fmt-tabs-more');
      const selectCat = (cat) => { s.formatCategory = cat; PromptAssistantModal._render(); };

      ov.querySelectorAll('.pa-fmt-tab').forEach((el) => el.addEventListener('click', () => {
        if (tabsEl?.classList.contains('pa-just-dragged')) return; // vừa kéo → bỏ click
        selectCat(el.dataset.cat);
      }));

      if (tabsEl) {
        // Drag-to-scroll (chuột); touch dùng native momentum scroll.
        let down = false, sx = 0, sl = 0, moved = false;
        tabsEl.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'touch') return;
          down = true; moved = false; sx = e.clientX; sl = tabsEl.scrollLeft;
        });
        tabsEl.addEventListener('pointermove', (e) => {
          if (!down) return; const dx = e.clientX - sx;
          if (!moved && Math.abs(dx) > 4) { moved = true; tabsEl.classList.add('dragging'); }
          if (moved) tabsEl.scrollLeft = sl - dx;
        });
        const endDrag = () => {
          if (!down) return; down = false; tabsEl.classList.remove('dragging');
          if (moved) { tabsEl.classList.add('pa-just-dragged'); setTimeout(() => tabsEl.classList.remove('pa-just-dragged'), 50); }
        };
        tabsEl.addEventListener('pointerup', endDrag);
        tabsEl.addEventListener('pointerleave', endDrag);

        // Overflow → hiện nút "more" + fade mép phải.
        const overflow = tabsEl.scrollWidth - tabsEl.clientWidth > 2;
        if (moreBtn) moreBtn.hidden = !overflow;
        tabsWrap?.classList.toggle('overflow', overflow);
      }

      // Nút "more" → dropdown chọn category (gồm cả tab bị ẩn ngoài view).
      if (moreBtn) moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const old = ov.querySelector('.pa-fmt-tabs-menu');
        if (old) { old.remove(); return; } // toggle đóng
        const menu = document.createElement('div');
        menu.className = 'pa-fmt-tabs-menu';
        const cats = [...ov.querySelectorAll('.pa-fmt-tab')].map((t) => ({ cat: t.dataset.cat, label: t.textContent, sel: t.classList.contains('sel') }));
        menu.innerHTML = cats.map((c) => `<button class="pa-fmt-tabs-menu-item${c.sel ? ' sel' : ''}" data-cat="${PromptAssistantModal._esc(c.cat)}">${PromptAssistantModal._esc(c.label)}</button>`).join('');
        ov.appendChild(menu);
        const r = moreBtn.getBoundingClientRect();
        menu.style.top = (r.bottom + 4) + 'px';
        menu.style.right = (window.innerWidth - r.right) + 'px';
        menu.querySelectorAll('.pa-fmt-tabs-menu-item').forEach((it) => it.addEventListener('click', () => { menu.remove(); selectCat(it.dataset.cat); }));
        const closeMenu = (ev) => { if (!menu.contains(ev.target) && ev.target !== moreBtn) { menu.remove(); document.removeEventListener('click', closeMenu, true); } };
        setTimeout(() => document.addEventListener('click', closeMenu, true), 0);
      });
      ov.querySelectorAll('.pa-fmt').forEach((el) => el.addEventListener('click', () => {
        // Format premium bị khóa → KHÔNG select, mở upgrade modal (giải thích cần nâng cấp).
        if (el.dataset.locked === '1') {
          PromptAssistantModal._err(L('premiumNeed'));
          return;
        }
        PromptAssistantModal._applyFormat(el.dataset.fmt);
      }));
      // VIDEO preview tooltip — hiện phía TRÊN card khi có preview_video. (Name do SmartTooltip hiện
      // DƯỚI card qua data-tooltip + data-tooltip-placement="bottom".) Append vào BODY: .pa-overlay có
      // backdrop-filter → tạo containing block cho position:fixed → nếu append vào overlay sẽ bị clip/
      // dồn dọc khi gần mép. Body-append + clamp viewport → hiển thị đúng.
      let tip = document.body.querySelector('.pa-fmt-tip');
      if (!tip) { tip = document.createElement('div'); tip.className = 'pa-fmt-tip'; tip.innerHTML = '<video muted loop playsinline preload="none"></video>'; document.body.appendChild(tip); }
      PromptAssistantModal._fmtTip = tip;
      const tipVid = tip.querySelector('video');
      const hideTip = () => {
        tip.classList.remove('show');
        try { tipVid.pause(); tipVid.removeAttribute('src'); tipVid.load(); } catch (_) { globalThis.SEOSONA_swallow?.('PromptAssistantModal#hideTip', _); }
      };
      const showTip = (chip) => {
        const vurl = chip.dataset.video;
        if (!vurl) { hideTip(); return; } // không có video → chỉ SmartTooltip name (dưới), không custom tip
        if (tipVid.src !== vurl) tipVid.src = vurl;
        tipVid.poster = chip.dataset.thumb || ''; // ảnh thumbnail làm poster trong lúc buffer
        try { tipVid.currentTime = 0; const p = tipVid.play(); if (p && p.catch) p.catch(function (_e) { globalThis.SEOSONA_swallow?.('PromptAssistantModal#showTip', _e); }); } catch (_) { globalThis.SEOSONA_swallow?.('PromptAssistantModal#showTip', _); }
        tip.classList.add('show'); // show trước để đo offsetWidth
        const r = chip.getBoundingClientRect();
        const halfW = (tip.offsetWidth || 100) / 2;
        // clamp tâm tooltip trong viewport (tip dùng translateX(-50%)) → không tràn mép.
        const cx = Math.max(halfW + 6, Math.min(r.left + r.width / 2, window.innerWidth - halfW - 6));
        tip.style.left = cx + 'px';
        tip.style.top = r.top + 'px';
      };
      ov.querySelectorAll('.pa-fmt').forEach((el) => {
        el.addEventListener('mouseenter', () => showTip(el));
        el.addEventListener('mouseleave', hideTip);
      });
      // Drag-to-slide cho dải format (scroll-x nhỏ khó kéo). Touch dùng native scroll.
      // KHÔNG setPointerCapture (sẽ chặn click chọn chip); chỉ kích hoạt 'dragging' khi kéo >4px.
      const fmts = ov.querySelector('.pa-formats');
      if (fmts) {
        let down = false, startX = 0, startScroll = 0, moved = false;
        fmts.addEventListener('scroll', hideTip);
        // Wheel dọc khi hover → cuộn NGANG dải format (chỉ khi còn tràn). deltaX (trackpad ngang) cũng cộng.
        fmts.addEventListener('wheel', (e) => {
          if (fmts.scrollWidth - fmts.clientWidth <= 1) return; // không tràn → để page scroll bình thường
          const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
          if (!delta) return;
          e.preventDefault();
          fmts.scrollLeft += delta;
          hideTip();
        }, { passive: false });
        fmts.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'touch') return; // touch → native momentum scroll
          down = true; moved = false; startX = e.clientX; startScroll = fmts.scrollLeft; hideTip();
        });
        fmts.addEventListener('pointermove', (e) => {
          if (!down) return; const dx = e.clientX - startX;
          if (!moved && Math.abs(dx) > 4) { moved = true; fmts.classList.add('dragging'); }
          if (moved) fmts.scrollLeft = startScroll - dx;
        });
        const end = () => { if (!down) return; down = false; fmts.classList.remove('dragging'); };
        fmts.addEventListener('pointerup', end);
        fmts.addEventListener('pointerleave', end);
        // Chỉ chặn click chọn format KHI vừa kéo (capture phase, trước handler chip). Click thường → cho qua.
        fmts.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
      }
      ov.querySelector('.pa-adv-toggle')?.addEventListener('click', () => {
        s.advancedOpen = !s.advancedOpen; PromptAssistantModal._render();
      });

      ov.querySelector('.pa-imgbtn')?.addEventListener('click', () => PromptAssistantModal._onSelectImage());
      // Drag-drop ảnh vào vùng ref (giống GenTab).
      const refsec = ov.querySelector('.pa-refsec');
      if (refsec) {
        refsec.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); refsec.classList.add('drag-over'); });
        refsec.addEventListener('dragleave', (e) => { if (!refsec.contains(e.relatedTarget)) refsec.classList.remove('drag-over'); });
        refsec.addEventListener('drop', (e) => {
          e.preventDefault(); e.stopPropagation(); refsec.classList.remove('drag-over');
          PromptAssistantModal._addLocalFiles(Array.from(e.dataTransfer?.files || []));
        });
      }
      ov.querySelector('.pa-openlogin')?.addEventListener('click', async () => {
        await PromptAssistantModal._bg({ action: 'i2p:openProviderLogin', provider: s.provider });
        setTimeout(() => PromptAssistantModal._refreshStatus(), 1500);
      });

      ov.querySelector('.pa-generate')?.addEventListener('click', () => PromptAssistantModal._onGenerate());
      ov.querySelector('.pa-cancel-gen')?.addEventListener('click', () => { PromptAssistantModal._bg({ action: 'i2p:cancel', provider: s.provider }); s.sending = false; PromptAssistantModal._render(); });

      ov.querySelectorAll('.pa-fill').forEach((b) => b.addEventListener('click', () => PromptAssistantModal._fillGen(false, b.dataset.kind || undefined)));
      ov.querySelector('.pa-copy')?.addEventListener('click', (e) => {
        const txt = PromptAssistantModal._promptsText();
        try { navigator.clipboard.writeText(txt); } catch (_) { globalThis.SEOSONA_swallow?.('PromptAssistantModal#end', _); }
        e.target.textContent = L('copied');
        setTimeout(() => { if (e.target.isConnected) e.target.textContent = L('copy'); }, 1500);
      });
      ov.querySelector('.pa-copysrt')?.addEventListener('click', (e) => {
        const srt = PromptAssistantModal._buildSrt();
        if (!srt) return;
        try { navigator.clipboard.writeText(srt); } catch (_) { globalThis.SEOSONA_swallow?.('PromptAssistantModal#end', _); }
        e.target.textContent = L('copied');
        setTimeout(() => { if (e.target.isConnected) e.target.textContent = L('copySrt'); }, 1500);
      });
      ov.querySelector('.pa-back')?.addEventListener('click', () => { s.view = 'form'; PromptAssistantModal._render(); });
    }

    static async _refreshStatus() {
      const r = await PromptAssistantModal._bg({ action: 'i2p:checkProviders' });
      const s = PromptAssistantModal._state;
      if (!s || !r?.ok) return;
      // Chỉ re-render khi status THẬT SỰ đổi → tránh nháy/ngắt khi đang gõ + poll mỗi vài giây.
      const changed = JSON.stringify(s.status || {}) !== JSON.stringify(r.providers || {});
      s.status = r.providers;
      if (changed && s.view === 'form') PromptAssistantModal._renderPreserveIdea();
    }

    // Re-render giữ focus + vị trí con trỏ ô idea (không ngắt khi user đang gõ lúc poll status đổi).
    static _renderPreserveIdea() {
      const ov = PromptAssistantModal._overlay;
      const idea = ov && ov.querySelector('.pa-idea');
      const focused = !!idea && document.activeElement === idea;
      const ss = idea ? idea.selectionStart : null, se = idea ? idea.selectionEnd : null;
      PromptAssistantModal._render();
      if (focused) {
        const ni = PromptAssistantModal._overlay && PromptAssistantModal._overlay.querySelector('.pa-idea');
        if (ni) { ni.focus(); try { ni.setSelectionRange(ss == null ? ni.value.length : ss, se == null ? ni.value.length : se); } catch (_) { globalThis.SEOSONA_swallow?.('PromptAssistantModal#end', _); } }
      }
    }

    // Poll realtime status chatgpt/gemini khi modal đang mở (form view). Dừng khi đóng/đang gửi/result.
    static _startStatusPoll() {
      PromptAssistantModal._stopStatusPoll();
      PromptAssistantModal._statusTimer = setInterval(() => {
        const s = PromptAssistantModal._state;
        if (!s || s.view !== 'form' || s.sending) return;
        PromptAssistantModal._refreshStatus();
      }, 3500);
      // Refresh NGAY khi sidebar lấy lại focus (vd user vừa login provider ở tab khác xong quay lại).
      PromptAssistantModal._focusHandler = () => {
        const s = PromptAssistantModal._state;
        if (s && s.view === 'form' && !s.sending) PromptAssistantModal._refreshStatus();
      };
      window.addEventListener('focus', PromptAssistantModal._focusHandler);
    }

    static _stopStatusPoll() {
      if (PromptAssistantModal._statusTimer) { clearInterval(PromptAssistantModal._statusTimer); PromptAssistantModal._statusTimer = null; }
      if (PromptAssistantModal._focusHandler) { window.removeEventListener('focus', PromptAssistantModal._focusHandler); PromptAssistantModal._focusHandler = null; }
    }

    // ─── Image picker (reuse ImagePickerModal) ───────────────
    static _onSelectImage() {
      const s = PromptAssistantModal._state;
      if (s.images.length >= PromptAssistantModal._MAX_IMAGES) return;
      if (window.ImagePickerModal || window.imagePickerModal) {
        const picker = window.imagePickerModal || new window.ImagePickerModal();
        // Truyền limit còn lại để picker hiển thị/giới hạn đúng (tránh chọn quá rồi _addImages bỏ âm thầm).
        const remaining = PromptAssistantModal._MAX_IMAGES - s.images.length;
        picker.open({ singleSelect: false, maxSelections: remaining, existingFileIds: [], onConfirm: (sel) => PromptAssistantModal._addImages(sel) });
        return;
      }
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        PromptAssistantModal._addLocalFiles(Array.from(input.files || [])); input.remove();
      });
      input.click();
    }

    // Thêm File local (từ file input HOẶC drag-drop) vào ref images.
    static _addLocalFiles(files) {
      const s = PromptAssistantModal._state; if (!s) return;
      (files || []).forEach((file) => {
        if (s.images.length >= PromptAssistantModal._MAX_IMAGES) return;
        if (!file.type || !file.type.startsWith('image/')) return;
        const url = URL.createObjectURL(file);
        s.images.push({ blob: file, blobUrl: url, thumbnail: url, name: file.name, type: file.type, source: 'local' });
      });
      PromptAssistantModal._renderImages();
    }

    static _addImages(sel) {
      const s = PromptAssistantModal._state;
      (sel || []).forEach((img) => {
        if (s.images.length >= PromptAssistantModal._MAX_IMAGES) return;
        const entry = { blob: img.blob || null, blobUrl: img.thumbnail || '', thumbnail: img.thumbnail || '', name: img.fileId || img.name || 'image', type: img.type || 'image/png', source: img.source || 'flow' };
        if (!entry.blob && entry.thumbnail) {
          PromptAssistantModal._fetchBlob(entry.thumbnail).then((b) => { if (b) { entry.blob = b; entry.type = b.type || 'image/png'; } });
        }
        s.images.push(entry);
      });
      PromptAssistantModal._renderImages();
    }

    static async _fetchBlob(url) { try { const r = await fetch(url); if (r.ok) return await r.blob(); } catch (_) { globalThis.SEOSONA_swallow?.('PromptAssistantModal#onConfirm', _); } return null; }

    static _renderImages() {
      const ov = PromptAssistantModal._overlay; if (!ov) return;
      const list = ov.querySelector('.pa-imglist'); if (!list) return;
      const imgs = PromptAssistantModal._state.images;
      const cnt = ov.querySelector('.pa-refcount'); if (cnt) cnt.textContent = `${imgs.length}/${PromptAssistantModal._MAX_IMAGES}`;
      list.innerHTML = imgs.map((img, i) => `
        <div class="pa-thumb" title="${PromptAssistantModal._esc(img.name || '')}">
          <img src="${PromptAssistantModal._esc(img.thumbnail || img.blobUrl || '')}" alt="">
          <button class="pa-thumb-x" data-i="${i}" title="${PromptAssistantModal._esc(L('removeImg'))}">✕</button>
        </div>`).join('');
      // CSP-safe: gắn error listener thay vì onerror inline (MV3 chặn inline handler).
      list.querySelectorAll('.pa-thumb img').forEach((im) => im.addEventListener('error', () => {
        im.style.display = 'none'; im.parentElement.classList.add('broken');
      }));
      list.querySelectorAll('.pa-thumb-x').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(b.dataset.i, 10); const rm = PromptAssistantModal._state.images.splice(i, 1);
        if (rm[0]?.blobUrl && rm[0].source === 'local') URL.revokeObjectURL(rm[0].blobUrl);
        PromptAssistantModal._renderImages();
      }));
    }

    static _blobToB64(blob) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve((r.result.split(',')[1]) || r.result);
        r.onerror = reject; r.readAsDataURL(blob);
      });
    }

    // ─── Generate ────────────────────────────────────────────
    static async _onGenerate() {
      const s = PromptAssistantModal._state;
      if (s.sending || !s.idea.trim()) return;
      const meta = PromptAssistantModal._buildMetaPrompt();
      if (!meta) { PromptAssistantModal._err(L('errConfig')); return; }

      // Reconfirm + active tab provider tương ứng (giống GenTab): activate tab fire-and-forget
      // SONG SONG với modal → confirm xong tab đã sẵn sàng.
      const provNameStr = provName(s.provider);
      try { PromptAssistantModal._bg({ action: 'pa:activateTab', provider: s.provider }); } catch (_) { globalThis.SEOSONA_swallow?.('PromptAssistantModal#onloadend', _); }
      if (window.customDialog?.confirm) {
        const ok = await window.customDialog.confirm(
          L('confirmGenMsg').replace('{provider}', provNameStr),
          { title: L('confirmGenTitle').replace('{provider}', provNameStr), type: 'info', confirmText: L('generate'), cancelText: L('cancel') }
        );
        if (!ok || !PromptAssistantModal._state) return;
      }

      s.sending = true; PromptAssistantModal._render();
      try {
        const images = [];
        for (const img of s.images) {
          if (img.blob) images.push({ base64: await PromptAssistantModal._blobToB64(img.blob), name: img.name || 'ref', type: img.type || 'image/png' });
        }
        window.UsageSync?.trackEvent('pa_generate', { provider: s.provider });
        const resp = await PromptAssistantModal._bg({
          action: 'pa:generate', provider: s.provider, metaPrompt: meta, images,
          // 600s: PA meta-prompt bắt model viết cả loạt prompt dài (thinking + stream lâu) — timeout ngắn bị hủy oan.
          // Page-side còn gia hạn thêm khi stream signal sống (cap timeout + 300s) → tối đa 15'.
          deleteAfter: !!s.settings.delete_after, timeout: 600000,
        });
        if (!PromptAssistantModal._state) return;
        s.sending = false;
        if (!resp || !resp.success) {
          PromptAssistantModal._render();
          PromptAssistantModal._err(`${L('errProvider')}${resp?.error ? ` (${resp.error})` : ''}`);
          return;
        }
        const prompts = PromptAssistantModal._mergeSubBlocks(PromptAssistantModal._parsePrompts(resp.text || ''));
        if (!prompts.length) { PromptAssistantModal._render(); PromptAssistantModal._err(L('empty')); return; }
        s.result = { raw: resp.text, prompts };
        s.view = 'result';
        PromptAssistantModal._render();
        // Tự lưu prompt vừa tạo vào kho (af_user_prompts) — non-blocking, best-effort.
        PromptAssistantModal._autoSaveToLibrary(prompts).then((n) => {
          if (n) window.showNotification?.((locale() === 'en' ? `Saved ${n} prompt(s) to library` : `Đã lưu ${n} prompt vào kho`), 'success', 2500);
        });
        // Auto-fill ĐÃ BỎ: gây duplicate ref khi user bấm "Send to SEOSONA Flow" (push ref 2 lần). User tự bấm.
      } catch (e) {
        if (!PromptAssistantModal._state) return;
        s.sending = false; PromptAssistantModal._render();
        PromptAssistantModal._err(e.message || 'Error');
      }
    }

    // Tự lưu các prompt vừa tạo vào kho prompt (UserPromptsManager → af_user_prompts).
    // Tiêu đề = ý tưởng rút gọn + số thứ tự; category = style/format đang chọn; tags = loại/provider/style.
    static async _autoSaveToLibrary(prompts) {
      const mgr = window.userPromptsManager;
      if (!mgr || typeof mgr.savePrompt !== 'function' || !Array.isArray(prompts) || !prompts.length) return 0;
      const s = PromptAssistantModal._state; if (!s) return 0;
      const st = s.settings || {};
      const ideaTitle = (s.idea || '').replace(/\s+/g, ' ').trim().slice(0, 48) || 'Prompt Assistant';
      const fmt = (s.formats || []).find((f) => f.key === s.formatKey);
      const category = fmt?.name || st.style || 'Prompt Assistant';
      const tags = [st.media_type, s.provider, st.style].filter(Boolean);
      let saved = 0;
      for (let i = 0; i < prompts.length; i++) {
        const { body } = PromptAssistantModal._splitSub(prompts[i]);
        const content = PromptAssistantModal._stripNumbering(body).trim();
        if (!content) continue;
        try { await mgr.savePrompt({ title: `${ideaTitle} #${i + 1}`, content, category, tags }); saved++; }
        catch (_) { /* bỏ qua lỗi lưu từng prompt */ }
      }
      return saved;
    }

    static async _fillGen(silent, kind) {
      const s = PromptAssistantModal._state;
      // _promptsText: mỗi prompt 1 khối (giữ multi-line), cách nhau dòng trống → GenTab tách đúng N.
      // forGen=true → KHÔNG chèn số "N." (tránh lọt vào prompt ảnh khi GenTab submit).
      const text = PromptAssistantModal._promptsText(kind, true);
      if (!text) return;
      // Pair: đặt genType (Image/Video) trước khi đổ — tránh prompt video chạy nhầm loại ảnh & ngược lại.
      if (kind === 'image' || kind === 'video') {
        try {
          const gt = document.getElementById('genType');
          if (gt) { gt.value = kind === 'video' ? 'Video' : 'Image'; gt.dispatchEvent(new Event('change', { bubbles: true })); }
        } catch (_) { globalThis.SEOSONA_swallow?.('PromptAssistantModal#onloadend', _); }
      }
      const r = window._setGenPromptInternal?.(text);
      if (r?.success) {
        // Chuyển ref images sang Tab Gen → nhân vật nhất quán cả HÌNH. Bỏ qua khi fill VIDEO của pair
        // (tránh nhân đôi ref; bước video dùng keyframe ảnh vừa gen làm ref).
        let added = 0;
        if (kind !== 'video' && s.images?.length && window.GenTab?.addUploadRefImages) {
          try {
            const items = await PromptAssistantModal._refImagesForGen();
            if (!PromptAssistantModal._state) return; // card đã đóng giữa chừng
            added = window.GenTab.addUploadRefImages(items) || 0;
          } catch (_) { globalThis.SEOSONA_swallow?.('PromptAssistantModal#onloadend', _); }
        }
        const n = text.split(/\n\s*\n/).filter(Boolean).length;
        const base = L('toastFilled').replace('{n}', n);
        const msg = added ? `${base} + ${added} ${L('addRef').toLowerCase()}` : base;
        window.showNotification?.(msg, 'success', 3000);
        if (!silent) PromptAssistantModal.close();
      } else if (!silent) {
        PromptAssistantModal._err(L('errFill'));
      }
    }

    // Chuẩn hoá ref images của modal → [{file, thumbnail, type}] cho GenTab.addUploadRefImages.
    // Đảm bảo có File blob (local có sẵn; flow/URL → fetch).
    static async _refImagesForGen() {
      const s = PromptAssistantModal._state;
      const out = [];
      for (const img of (s.images || [])) {
        let file = img.blob || null;
        if (file && !(file instanceof File)) file = new File([file], img.name || 'ref.png', { type: img.type || 'image/png' });
        if (!file && (img.thumbnail || img.blobUrl)) {
          const b = await PromptAssistantModal._fetchBlob(img.thumbnail || img.blobUrl);
          if (b) file = new File([b], img.name || 'ref.png', { type: b.type || img.type || 'image/png' });
        }
        if (file) out.push({ file, thumbnail: img.thumbnail || img.blobUrl || '', type: img.type || 'image/png' });
      }
      return out;
    }

    static _err(msg) {
      if (window.customDialog) window.customDialog.alert(L('title'), msg);
      else alert(msg);
    }

    static _cleanup() {
      PromptAssistantModal._stopStatusPoll();
      const s = PromptAssistantModal._state;
      if (s) { for (const img of s.images) { if (img.blobUrl && img.source === 'local') URL.revokeObjectURL(img.blobUrl); } }
      if (PromptAssistantModal._esc2) { document.removeEventListener('keydown', PromptAssistantModal._esc2); PromptAssistantModal._esc2 = null; }
      // Gỡ SSE listeners.
      if (window.eventBus) {
        if (PromptAssistantModal._onFormatsUpdated) window.eventBus.off?.('pa:formats_updated', PromptAssistantModal._onFormatsUpdated);
        if (PromptAssistantModal._onEntitlements) window.eventBus.off?.('sse:entitlements_changed', PromptAssistantModal._onEntitlements);
      }
      PromptAssistantModal._onFormatsUpdated = null;
      PromptAssistantModal._onEntitlements = null;
      // Gỡ video preview tooltip đã append vào body.
      if (PromptAssistantModal._fmtTip) { PromptAssistantModal._fmtTip.remove(); PromptAssistantModal._fmtTip = null; }
      PromptAssistantModal._state = null;
    }
  }

  window.PromptAssistantModal = PromptAssistantModal;
  window.ChatAIModal = PromptAssistantModal; // alias backward-compat (entry GenTab cũ)
})();
