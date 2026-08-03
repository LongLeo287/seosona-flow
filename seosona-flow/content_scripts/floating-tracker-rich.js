/**
 * floating-tracker-rich.js — Rich FloatingTracker port từ Flow content.js cho ChatGPT/Grok content scripts.
 *
 * Mục đích: hiển thị multi-prompt queue progress giống Flow tracker (jobs list, per-item state badges,
 * pipeline stats row, stop buttons). Trước đây ChatGPT/Grok chỉ có 1 progress bar + 1 status text.
 *
 * Usage trong content script:
 *   const tracker = window.createFloatingTrackerRich({ id: 'seosonaflow-chatgpt-tracker', title: 'ChatGPT' });
 *   tracker.show({ current: 0, total: 1, phase: 'preparing', prompt: '...' });   // legacy mode (1 prompt)
 *   tracker.updateFromQueue(queueData);   // rich mode (multi-prompt từ PromptQueue.sendToContentScript)
 *   tracker.hide();
 *
 * Khác Flow tracker:
 *   - KHÔNG có tile DOM scan auto-refresh (ChatGPT/Grok không có tile)
 *   - KHÔNG có pause/resume per job (sequential model, không pause được giữa chừng)
 *   - KHÔNG có chunk banner / download row (Flow-specific)
 *   - GIỮ: jobs collapsible, per-item state badges, pipeline stats row, stop-all/stop-per-job button
 */
(function () {
  'use strict';

  const STATE_CONFIG = {
    PENDING:      { label: 'Pending',      bg: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' },
    SUBMITTING:   { label: 'Submitting',   bg: 'rgba(59,130,246,0.2)',   color: '#60a5fa' },
    SUBMITTED:    { label: 'Submitted',    bg: 'rgba(59,130,246,0.15)',  color: '#93c5fd' },
    MONITORING:   { label: 'Running',      bg: 'rgba(168,85,247,0.2)',   color: '#c084fc' },
    RETRY_SUBMIT: { label: 'Retry',        bg: 'rgba(249,115,22,0.2)',   color: '#fb923c' },
    COMPLETED:    { label: 'Done',         bg: 'rgba(25, 208, 123,0.2)',    color: '#4be3a0' },
    PARTIAL_FAIL: { label: 'Partial',      bg: 'rgba(234,179,8,0.2)',    color: '#facc15' },
    FAILED:       { label: 'Failed',       bg: 'rgba(239,68,68,0.2)',    color: '#f87171' },
    CANCELLED:    { label: 'Cancelled',    bg: 'rgba(107,114,128,0.2)',  color: '#9ca3af' },
  };

  const OWNER_COLORS = {
    prompts: '#3b82f6',
    task: '#f97316',
    workflow: '#a855f7',
    angles: '#ec4899',
    telegram: '#06b6d4'
  };

  function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatTime(ms) {
    if (!ms || ms < 0) return '00:00';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // [tracker-unified] Provider identity cho header: logo + tên + màu thương hiệu (ProviderMeta).
  // Chữ tự chọn đen/trắng theo độ sáng nền → đọc được cả với provider màu sáng (Grok #e5e7eb).
  const _BOLT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;display:block"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
  function _readableText(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
    if (!m) return '#fff';
    const n = parseInt(m[1], 16);
    const L = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return L > 0.6 ? '#111827' : '#fff';
  }
  function providerBrand(slug) {
    const PM = (typeof ProviderMeta !== 'undefined') ? ProviderMeta
             : (typeof window !== 'undefined' ? window.ProviderMeta : null);
    const s = String(slug || '').toLowerCase();
    const color = (PM && PM.getColor) ? (PM.getColor(s) || '#3d6ff5') : '#3d6ff5';
    const name = (PM && PM.getName && PM.getName(s)) || null;
    const icon = (PM && PM.getIcon && PM.getIcon(s)) || _BOLT_ICON;
    return { color, name, icon, text: _readableText(color) };
  }

  function createFloatingTrackerRich(opts) {
    const id = opts.id;
    const title = opts.title || 'SEOSONA Flow';
    // Provider suy từ opts.provider hoặc title ('ChatGPT'→chatgpt, 'Grok'→grok).
    const _brand = providerBrand(opts.provider || title);
    const _displayTitle = _brand.name || title;

    const tracker = {
      _el: null,
      _hideTimer: null,
      _expandedJobs: new Set(),
      _manuallyCollapsed: new Set(),
      _lastData: null,
      _legacyData: null,
      _startTime: null,
      _elapsedTimer: null,

      _create() {
        if (this._el && document.body.contains(this._el)) return;
        const existing = document.getElementById(id);
        if (existing) existing.remove();
        // Port 1.1.49: gỡ drag listener cũ nếu re-create tracker (tránh leak document listener).
        if (this._dragMove) { document.removeEventListener('mousemove', this._dragMove); this._dragMove = null; }
        if (this._dragUp) { document.removeEventListener('mouseup', this._dragUp); this._dragUp = null; }
        this._el = null;

        const el = document.createElement('div');
        el.id = id;
        el.style.cssText = 'position:fixed;bottom:16px;right:16px;width:340px;background:rgba(18,18,22,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.5);z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;color:#fff;display:none;overflow:hidden;';

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 12px;background:' + _brand.color + ';border-bottom:1px solid rgba(255,255,255,0.15);cursor:grab;user-select:none;color:' + _brand.text + ';';
        header.innerHTML =
          '<span style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:' + _brand.text + '">' + _brand.icon + '</span>' +
          '<span style="flex:1;font-weight:600;font-size:12px;">' + escHtml(_displayTitle) + '</span>' +
          '<span class="seosonaflow-ft-counter" style="font-size:11px;opacity:0.7;font-variant-numeric:tabular-nums;"></span>' +
          '<span class="seosonaflow-ft-elapsed" style="font-size:10px;opacity:0.5;font-variant-numeric:tabular-nums;"></span>' +
          // Port 1.1.49: nút "bỏ chặn tương tác" — dismiss overlay ExecutionBlocker mà automation vẫn
          // chạy nền (hữu ích khi captcha/human-check cần user tương tác trang). Chỉ hiện nếu có onSkipBlocker.
          ((typeof opts.onSkipBlocker === 'function')
            ? '<button class="seosonaflow-ft-skip-blocker" title="Bỏ chặn tương tác (automation vẫn chạy nền)" style="width:22px !important;height:22px !important;min-width:22px !important;padding:0 !important;margin:0 !important;box-sizing:border-box !important;background:rgba(255,255,255,0.18);border:none;border-radius:5px;color:#fff;cursor:pointer;display:flex !important;align-items:center !important;justify-content:center !important;flex-shrink:0;line-height:0 !important;">'
              + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block !important;width:11px !important;height:11px !important;flex-shrink:0"><path d="M7 11V7a5 5 0 0 1 9.9-1"/><rect x="3" y="11" width="18" height="10" rx="2"/></svg>'
              + '</button>'
            : '') +
          '<button class="seosonaflow-ft-stop-all" title="Stop all" style="width:22px !important;height:22px !important;min-width:22px !important;padding:0 !important;margin:0 !important;box-sizing:border-box !important;background:rgba(239,68,68,0.2);border:none;border-radius:5px;color:#ef4444;cursor:pointer;display:flex !important;align-items:center !important;justify-content:center !important;flex-shrink:0;line-height:0 !important;">' +
            '<svg viewBox="0 0 24 24" fill="currentColor" style="display:block !important;width:11px !important;height:11px !important;flex-shrink:0;margin:0 !important;vertical-align:middle !important">' +
            '<rect x="6" y="6" width="12" height="12" rx="1"/></svg>' +
          '</button>';
        el.appendChild(header);

        const self = this;
        header.querySelector('.seosonaflow-ft-stop-all').addEventListener('click', function () {
          self._sendAction('pq:stopAll');
        });
        // Port 1.1.49: wire nút bỏ chặn (nếu có).
        const _skipBtn = header.querySelector('.seosonaflow-ft-skip-blocker');
        if (_skipBtn) _skipBtn.addEventListener('click', function () {
          try { if (typeof opts.onSkipBlocker === 'function') opts.onSkipBlocker(); } catch (_) { globalThis.SEOSONA_swallow?.('floating-tracker-rich#_create', _); }
        });

        // Port 1.1.49: kéo header để di chuyển tracker (neo bottom/right → chuyển sang top/left khi kéo).
        // Listener mousemove/up lưu ở this._dragMove/_dragUp để destroy/hide gỡ (tránh leak).
        (function makeDraggable() {
          let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
          header.addEventListener('mousedown', function (e) {
            if (e.target.closest('button')) return; // bấm nút → không kéo
            const r = el.getBoundingClientRect();
            el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
            el.style.right = 'auto'; el.style.bottom = 'auto';
            dragging = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
            header.style.cursor = 'grabbing';
            e.preventDefault();
          });
          const onMove = function (e) {
            if (!dragging) return;
            let nx = ox + e.clientX - sx, ny = oy + e.clientY - sy;
            nx = Math.max(0, Math.min(nx, window.innerWidth - el.offsetWidth));
            ny = Math.max(0, Math.min(ny, window.innerHeight - 40));
            el.style.left = nx + 'px'; el.style.top = ny + 'px';
          };
          const onUp = function () { if (dragging) { dragging = false; header.style.cursor = 'grab'; } };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          self._dragMove = onMove; self._dragUp = onUp;
        })();

        // Progress bar
        const progress = document.createElement('div');
        progress.style.cssText = 'height:3px;background:rgba(255,255,255,0.08);overflow:hidden;';
        progress.innerHTML = '<div class="seosonaflow-ft-progress-fill" style="height:100%;width:100%;background:linear-gradient(90deg,#3b82f6,#60a5fa,#a78bfa);transform:scaleX(0);transform-origin:left;transition:transform 0.3s ease-out;will-change:transform;"></div>';
        el.appendChild(progress);

        // CSS animations once (shared key — chỉ inject 1 lần per page)
        if (!document.getElementById('seosonaflow-ftr-animations')) {
          const style = document.createElement('style');
          style.id = 'seosonaflow-ftr-animations';
          style.textContent =
            '@keyframes seosonaflow-ftr-pulse{0%,100%{opacity:1}50%{opacity:0.6}}' +
            '@keyframes seosonaflow-ftr-glow{0%,100%{opacity:0.5}50%{opacity:1}}' +
            '.seosonaflow-ft-progress-fill.active{animation:seosonaflow-ftr-glow 1.5s ease-in-out infinite}' +
            '.seosonaflow-ft-dot-pulse{animation:seosonaflow-ftr-pulse 1.5s ease-in-out infinite}';
          document.head.appendChild(style);
        }

        // Pipeline status row
        const pipelineRow = document.createElement('div');
        pipelineRow.className = 'seosonaflow-ft-pipeline';
        pipelineRow.style.cssText = 'display:none;padding:6px 12px;font-size:11px;color:rgba(255,255,255,0.7);border-bottom:1px solid rgba(255,255,255,0.06);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        el.appendChild(pipelineRow);

        // Jobs container
        const jobsWrap = document.createElement('div');
        jobsWrap.className = 'seosonaflow-ft-jobs';
        jobsWrap.style.cssText = 'max-height:320px;overflow-y:auto;overflow-x:hidden;';
        el.appendChild(jobsWrap);

        // Single status line (legacy mode fallback)
        const statusEl = document.createElement('div');
        statusEl.className = 'seosonaflow-ft-status';
        statusEl.style.cssText = 'padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.7);display:none;';
        el.appendChild(statusEl);

        document.body.appendChild(el);
        this._el = el;

        // Event delegation cho stop/expand
        this._setupJobsDelegation(jobsWrap);
      },

      _setupJobsDelegation(container) {
        const self = this;
        container.addEventListener('click', function (e) {
          const actionEl = e.target.closest('[data-action]');
          if (actionEl) {
            e.stopPropagation();
            const action = actionEl.getAttribute('data-action');
            const jobId = actionEl.getAttribute('data-job-id');
            if (action === 'stop') self._sendAction('pq:stopJob', { jobId: jobId });
            else if (action === 'resume') self._sendAction('pq:resumeJob', { jobId: jobId }); // Port 1.1.49
            else if (action === 'pause') self._sendAction('pq:pauseJob', { jobId: jobId }); // Port 1.1.58
            return;
          }
          const headerEl = e.target.closest('[data-job-toggle]');
          if (headerEl) {
            const toggleJobId = headerEl.getAttribute('data-job-toggle');
            if (self._expandedJobs.has(toggleJobId)) {
              self._expandedJobs.delete(toggleJobId);
              self._manuallyCollapsed.add(toggleJobId);
            } else {
              self._expandedJobs.add(toggleJobId);
              self._manuallyCollapsed.delete(toggleJobId);
            }
            if (self._lastData) self._renderJobs(self._lastData.jobs || []);
          }
        });
      },

      _sendAction(action, data) {
        // Relay action lên background.js → sidepanel (PromptQueue).
        // Background.js expect jobId top-level (line 2212: message.jobId) → spread data lên top thay vì nested.
        try {
          const payload = Object.assign({ action: action }, data || {});
          chrome.runtime.sendMessage(payload, function () {
            // Fire-and-forget — swallow lastError (extension reload có thể nhả disconnect)
            if (chrome.runtime.lastError) { /* silent */ }
          });
        } catch (e) {
          console.warn('[FloatingTrackerRich] _sendAction failed:', e.message);
        }
      },

      // Rich mode — full queue data từ PromptQueue
      updateFromQueue(data) {
        this._create();
        if (!data) return;
        this._lastData = data;

        clearTimeout(this._hideTimer);
        const el = this._el;
        const completed = data.completed || 0;
        const total = data.total || 0;
        const isRunning = data.isRunning;
        const jobs = data.jobs || [];

        // Hide single-line status row khi dùng rich mode
        const statusEl = el.querySelector('.seosonaflow-ft-status');
        if (statusEl) statusEl.style.display = 'none';

        // Completion / hide
        if (!isRunning || total === 0) {
          if (completed > 0) {
            el.style.display = 'block';
            el.querySelector('.seosonaflow-ft-counter').textContent = completed + '/' + total + ' done';
            const progressFill = el.querySelector('.seosonaflow-ft-progress-fill');
            progressFill.style.transform = 'scaleX(1)';
            progressFill.classList.remove('active');
            el.querySelector('.seosonaflow-ft-elapsed').textContent = '';
            const stopBtn = el.querySelector('.seosonaflow-ft-stop-all');
            if (stopBtn) stopBtn.style.display = 'none';
            const pRow = el.querySelector('.seosonaflow-ft-pipeline');
            if (pRow) pRow.style.display = 'none';
            el.querySelector('.seosonaflow-ft-jobs').innerHTML = '';
            const self = this;
            this._hideTimer = setTimeout(function () { self.hide(); }, 3000);
          } else {
            this.hide();
          }
          return;
        }

        el.style.display = 'block';

        const stopBtn = el.querySelector('.seosonaflow-ft-stop-all');
        if (stopBtn) stopBtn.style.display = '';

        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        el.querySelector('.seosonaflow-ft-counter').textContent = completed + '/' + total;
        const progressFill = el.querySelector('.seosonaflow-ft-progress-fill');
        progressFill.style.transform = 'scaleX(' + (pct / 100) + ')';
        progressFill.classList.add('active');
        el.querySelector('.seosonaflow-ft-elapsed').textContent = formatTime(data.elapsed);

        this._renderPipelineRow(data.pipeline);
        this._renderJobs(jobs);
      },

      _renderPipelineRow(pipeline) {
        const row = this._el.querySelector('.seosonaflow-ft-pipeline');
        if (!pipeline) { row.style.display = 'none'; return; }

        const sent = (pipeline.editor && pipeline.editor.processedCount) || 0;
        const tm = pipeline.tileMonitor || {};
        const active = tm.activeCount || 0;
        const done = tm.completedCount || 0;
        const failed = tm.failedCount || 0;

        if (sent === 0 && active === 0 && done === 0 && failed === 0) {
          row.style.display = 'none';
          return;
        }

        const sep = '<span style="opacity:0.3;margin:0 5px;">•</span>';
        const failedColor = failed > 0 ? '#f87171' : 'rgba(255,255,255,0.35)';
        const activeColor = active > 0 ? '#c084fc' : 'rgba(255,255,255,0.35)';

        const html =
          '<span style="color:#93c5fd;">▶ ' + sent + ' sent</span>' + sep +
          '<span style="color:' + activeColor + ';">⚡ ' + active + ' active</span>' + sep +
          '<span style="color:#4be3a0;">✓ ' + done + ' done</span>' + sep +
          '<span style="color:' + failedColor + ';">✕ ' + failed + ' failed</span>';

        row.style.display = '';
        row.innerHTML = html;
      },

      _renderJobs(jobs) {
        const jobsEl = this._el.querySelector('.seosonaflow-ft-jobs');
        if (!jobs || jobs.length === 0) { jobsEl.innerHTML = ''; return; }

        const self = this;
        const now = Date.now();
        let html = '';

        for (let i = 0; i < jobs.length; i++) {
          const j = jobs[i];
          const color = OWNER_COLORS[j.owner] || '#6b7280';
          const isDone = j.status === 'completed' || j.status === 'stopped';
          const isActive = j.status === 'running' || j.status === 'paused';
          const jobPct = j.total > 0 ? Math.round((j.completed / j.total) * 100) : 0;
          const jobElapsed = j.startedAt ? formatTime(now - j.startedAt) : '';

          if (isActive && !self._manuallyCollapsed.has(j.id)) {
            self._expandedJobs.add(j.id);
          } else if (isDone) {
            self._expandedJobs.delete(j.id);
            self._manuallyCollapsed.delete(j.id);
          }
          const isExpanded = self._expandedJobs.has(j.id);

          const hasRetrying = isActive && j.items && j.items.some(function (it) { return it.state === 'RETRY_SUBMIT'; });

          let statusBadge = '';
          if (hasRetrying) {
            statusBadge = '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(249,115,22,0.2);color:#fb923c;">retrying</span>';
          } else if (isDone) {
            const doneColor = j.status === 'completed' ? '#4be3a0' : '#f87171';
            const doneBg = j.status === 'completed' ? 'rgba(25, 208, 123,0.2)' : 'rgba(239,68,68,0.2)';
            const doneLabel = j.status === 'completed' ? 'done' : 'stopped';
            statusBadge = '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:' + doneBg + ';color:' + doneColor + ';">' + doneLabel + '</span>';
          } else if (j.status === 'paused') {
            // Port 1.1.49: badge paused (Flow captcha đưa job vào paused) → user biết cần ▶ tiếp tục.
            statusBadge = '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(234,179,8,0.2);color:#facc15;">paused</span>';
          }

          let failBadge = '';
          if (j.failed > 0) {
            failBadge = '<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(239,68,68,0.2);color:#f87171;margin-left:2px;">' + j.failed + ' err</span>';
          }

          let actions = '';
          if (isActive) {
            // Port 1.1.49: nút Resume chỉ khi paused + owner prompts (paused chỉ do Flow captcha →
            // không lọt sang tracker ChatGPT/Grok). Bấm → pq:resumeJob.
            if (j.owner === 'prompts' && j.status === 'paused') {
              actions += '<button data-action="resume" data-job-id="' + escHtml(j.id) + '" title="Tiếp tục" style="width:20px;height:20px;min-width:20px;padding:0;margin:0;box-sizing:border-box;background:rgba(25, 208, 123,0.15);border:none;border-radius:4px;color:#19d07b;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:0;flex-shrink:0;">' +
                '<svg viewBox="0 0 24 24" fill="currentColor" style="display:block;width:10px;height:10px;flex-shrink:0"><path d="M8 5v14l11-7z"/></svg></button>';
            }
            // Port 1.1.58: nút Pause chủ động khi job prompts đang chạy (dừng các prompt CHƯA submit).
            if (j.owner === 'prompts' && j.status === 'running') {
              actions += '<button data-action="pause" data-job-id="' + escHtml(j.id) + '" title="Tạm dừng" style="width:20px;height:20px;min-width:20px;padding:0;margin:0;box-sizing:border-box;background:rgba(234,179,8,0.15);border:none;border-radius:4px;color:#facc15;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:0;flex-shrink:0;">' +
                '<svg viewBox="0 0 24 24" fill="currentColor" style="display:block;width:10px;height:10px;flex-shrink:0"><rect x="7" y="6" width="3" height="12" rx="1"/><rect x="14" y="6" width="3" height="12" rx="1"/></svg></button>';
            }
            actions += '<button data-action="stop" data-job-id="' + escHtml(j.id) + '" title="Stop" style="width:20px;height:20px;min-width:20px;padding:0;margin:0;box-sizing:border-box;background:rgba(239,68,68,0.15);border:none;border-radius:4px;color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:0;flex-shrink:0;">' +
              '<svg viewBox="0 0 24 24" fill="currentColor" style="display:block;width:10px;height:10px;flex-shrink:0"><rect x="7" y="7" width="10" height="10" rx="1"/></svg></button>';
          }

          const jobOpacity = isDone ? 'opacity:0.5;' : '';

          html += '<div style="padding:4px 12px;border-bottom:1px solid rgba(255,255,255,0.05);' + jobOpacity + '">';
          html += '<div class="seosonaflow-ft-job-header" data-job-toggle="' + escHtml(j.id) + '" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:3px 0;">';
          html += '<span class="' + (isActive ? 'seosonaflow-ft-dot-pulse' : '') + '" style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0;"></span>';
          html += '<span style="flex:1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">' + escHtml(j.label || j.owner) + '</span>';
          html += statusBadge + failBadge;
          html += '<span style="font-size:10px;opacity:0.5;font-variant-numeric:tabular-nums;flex-shrink:0;">' + jobElapsed + '</span>';
          html += '<span style="font-size:10px;opacity:0.6;font-variant-numeric:tabular-nums;flex-shrink:0;">' + jobPct + '%</span>';
          html += '<div style="display:flex;gap:2px;flex-shrink:0;">' + actions + '</div>';
          html += '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;transition:transform 0.2s;' + (isExpanded ? 'transform:rotate(180deg);' : '') + '"><polyline points="6 9 12 15 18 9"/></svg>';
          html += '</div>';

          // Job progress bar
          html += '<div style="height:2px;background:rgba(255,255,255,0.08);border-radius:1px;margin:3px 0;overflow:hidden;">';
          html += '<div style="height:100%;width:100%;background:' + color + ';border-radius:1px;transform:scaleX(' + (jobPct / 100) + ');transform-origin:left;transition:transform 0.3s ease-out;will-change:transform;"></div>';
          html += '</div>';

          // Items expand
          if (isExpanded && j.items && j.items.length > 0) {
            html += '<div style="padding:0px;margin-left:4px;">';
            const displayItems = j.items.slice(-12);
            for (let k = 0; k < displayItems.length; k++) {
              const it = displayItems[k];
              const sc = STATE_CONFIG[it.state] || STATE_CONFIG.PENDING;
              const promptShort = it.promptText ? (it.promptText.length > 50 ? it.promptText.substring(0, 50) + '...' : it.promptText) : '';

              let timeInfo = '';
              if (it.completedAt && it.submittedAt) {
                timeInfo = formatTime(it.completedAt - it.submittedAt);
              } else if (it.submittedAt) {
                timeInfo = formatTime(now - it.submittedAt);
              }

              let retryBadge = '';
              if (it.retryCount > 0) {
                retryBadge = '<span style="font-size:8px;padding:0 3px;border-radius:2px;background:rgba(249,115,22,0.2);color:#fb923c;">x' + it.retryCount + '</span>';
              }

              const itemBg = (it.state === 'SUBMITTING' || it.state === 'MONITORING') ? 'background:rgba(255,255,255,0.03);border-radius:4px;' : '';

              html += '<div style="display:flex;align-items:center;gap:5px;padding:4px 4px;font-size:11px;' + itemBg + '">';
              html += '<span style="color:rgba(255,255,255,0.4);font-size:10px;width:18px;flex-shrink:0;font-variant-numeric:tabular-nums;">#' + ((it.promptIndex || 0) + 1) + '</span>';
              html += '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,0.7);" title="' + escHtml(it.promptText || '') + '">' + escHtml(promptShort) + '</span>';
              html += retryBadge;
              if (timeInfo) {
                html += '<span style="font-size:9px;opacity:0.4;font-variant-numeric:tabular-nums;flex-shrink:0;">' + timeInfo + '</span>';
              }
              html += '<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:' + sc.bg + ';color:' + sc.color + ';flex-shrink:0;white-space:nowrap;">' + sc.label + '</span>';
              html += '</div>';
            }
            if (j.items.length > 12) {
              html += '<div style="font-size:10px;opacity:0.4;padding:2px 4px;">... and ' + (j.items.length - 12) + ' more</div>';
            }
            html += '</div>';
          }

          html += '</div>';
        }

        jobsEl.innerHTML = html;
      },

      // Legacy mode — 1-prompt show/update kế thừa từ tracker cũ.
      // GIỮ tương thích pattern: tracker.show({ current, total, phase, prompt })
      show(data) {
        this._create();
        this._el.style.display = 'block';
        this._startTime = Date.now();
        this._startElapsedTimer();
        this.update(data);
      },

      update(data) {
        if (!this._el) return;
        const d = data || {};
        const current = d.current || 0;
        const total = d.total || 1;
        const phase = d.phase || '';
        const prompt = d.prompt || '';
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;

        const counterEl = this._el.querySelector('.seosonaflow-ft-counter');
        const progressFill = this._el.querySelector('.seosonaflow-ft-progress-fill');
        const statusEl = this._el.querySelector('.seosonaflow-ft-status');

        if (counterEl) counterEl.textContent = current + '/' + total;
        if (progressFill) progressFill.style.transform = 'scaleX(' + (pct / 100) + ')';

        let statusText = phase;
        if (prompt) statusText += ': ' + (prompt.length > 40 ? prompt.substring(0, 40) + '...' : prompt);
        if (statusEl) {
          statusEl.textContent = statusText;
          statusEl.style.display = '';
        }

        // Ẩn jobs/pipeline rows trong legacy mode để không clutter UI
        const jobsEl = this._el.querySelector('.seosonaflow-ft-jobs');
        if (jobsEl) jobsEl.innerHTML = '';
        const pipelineRow = this._el.querySelector('.seosonaflow-ft-pipeline');
        if (pipelineRow) pipelineRow.style.display = 'none';
      },

      _startElapsedTimer() {
        this._stopElapsedTimer();
        const elapsedEl = this._el && this._el.querySelector('.seosonaflow-ft-elapsed');
        if (!elapsedEl) return;
        const self = this;
        this._elapsedTimer = setInterval(function () {
          if (!self._startTime) return;
          const elapsed = Date.now() - self._startTime;
          elapsedEl.textContent = formatTime(elapsed);
        }, 1000);
      },

      _stopElapsedTimer() {
        if (this._elapsedTimer) {
          clearInterval(this._elapsedTimer);
          this._elapsedTimer = null;
        }
      },

      hide() {
        this._stopElapsedTimer();
        clearTimeout(this._hideTimer);
        // [fix leak] Gỡ document drag listeners khi ẩn. Trước đây chỉ gỡ ở _create kế tiếp →
        // giữa hide↔create các listener mousemove/mouseup còn dính document (fire mọi lần rê chuột).
        if (this._dragMove) { document.removeEventListener('mousemove', this._dragMove); this._dragMove = null; }
        if (this._dragUp) { document.removeEventListener('mouseup', this._dragUp); this._dragUp = null; }
        if (this._el) this._el.style.display = 'none';
        this._lastData = null;
      }
    };

    return tracker;
  }

  // Expose globally cho content scripts dùng
  window.createFloatingTrackerRich = createFloatingTrackerRich;
})();
