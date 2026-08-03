/**
 * chat-content-claude.js — SEOSONA Flow content script cho claude.ai.
 * Hỗ trợ action `provider:textTask` (dùng bởi Prompt Assistant + i2p): mở chat mới → gõ prompt →
 * gửi → chờ Claude trả lời xong → đọc text → trả { success, text }.
 * Claude dùng editor ProseMirror (giống ChatGPT) → chèn text bằng paste event + execCommand fallback.
 * Self-contained: selector cứng nhiều-fallback (không phụ thuộc server config), robust với đổi DOM.
 */
(function () {
  'use strict';
  if (window.__seosonaClaudeInjected) { return; }
  window.__seosonaClaudeInjected = true;

  const PROVIDER = 'claude';

  // Nuốt "Extension context invalidated" khi extension reload (content cũ vẫn chạy async chain — vô hại).
  window.addEventListener('error', (e) => {
    const m = (e && e.message) || '';
    if (m.includes('Extension context invalidated') || m.includes('message channel closed')) { try { e.preventDefault(); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-claude', _); } }
  }, true);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };

  // ── Selectors (cứng, nhiều fallback) ──────────────────────────────────────
  const SEL = {
    composer: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"][translate="no"]', '[contenteditable="true"].ProseMirror', 'fieldset div[contenteditable="true"]', 'div[contenteditable="true"]'],
    submit:   ['button[aria-label="Send message"]', 'button[aria-label*="Send"]', 'fieldset button[type="submit"]', 'button[type="submit"]'],
    stop:     ['button[aria-label="Stop response"]', 'button[aria-label*="Stop"]'],
    newChat:  ['a[href="/new"]', 'a[aria-label*="New chat"]', 'button[aria-label*="New chat"]'],
    response: ['div.font-claude-message', '[data-testid="message-content"]', '.font-claude-message'],
  };
  const q = (arr, scope) => { const s = scope || document; for (const sel of arr) { try { const el = s.querySelector(sel); if (el) return el; } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-claude#q', _); } } return null; };
  const qa = (arr, scope) => { const s = scope || document; for (const sel of arr) { try { const els = s.querySelectorAll(sel); if (els.length) return els; } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-claude#qa', _); } } return []; };

  // ── Self-healing element finders ─────────────────────────────────────────
  // Selector cố định dễ vỡ khi claude.ai đổi DOM. Nếu selector không khớp → tìm bằng heuristic cấu trúc
  // (contenteditable/textarea hiển thị, nút có aria-label/text kiểu "send"). Giúp tự phục hồi khi DOM đổi.
  const _visible = (el) => {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  function findComposer() {
    const bySel = q(SEL.composer);
    if (bySel && _visible(bySel)) return bySel;
    // Heuristic: ô soạn thảo hiển thị lớn nhất, ưu tiên gần đáy màn hình (composer thường ở dưới).
    const cands = [...document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]')]
      .filter(_visible)
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 120 && r.height > 16; });
    if (!cands.length) return bySel || null;
    cands.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    return cands[0];
  }
  const _SEND_RE = /send|submit|gửi|gửi/i;
  function findSubmit(composer) {
    const bySel = q(SEL.submit);
    if (bySel && _visible(bySel)) return bySel;
    const comp = composer || findComposer();
    const scope = (comp && comp.closest('form, fieldset, [class*="composer" i], [class*="input" i]')) || document;
    // (1) nút có aria-label/title kiểu "send".
    const byAria = [...scope.querySelectorAll('button')].filter(_visible)
      .find((b) => _SEND_RE.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')));
    if (byAria) return byAria;
    // (2) nút submit trong form của composer.
    const bySubmit = [...scope.querySelectorAll('button[type="submit"]')].filter(_visible)[0];
    if (bySubmit) return bySubmit;
    // (3) nút enabled cuối cùng cạnh composer (thường là nút gửi).
    const btns = [...scope.querySelectorAll('button:not([disabled])')].filter(_visible);
    return btns.length ? btns[btns.length - 1] : (bySel || null);
  }

  // ── Overlay chặn user can thiệp khi đang tự chat ─────────────────────────
  const ExecutionBlocker = {
    _el: null,
    show() {
      if (this._el || !document.body) return;
      const d = document.createElement('div');
      d.id = 'seosona-claude-blocker';
      d.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.06);cursor:progress;';
      d.title = 'SEOSONA Flow đang tạo prompt…';
      document.body.appendChild(d);
      this._el = d;
    },
    hide() { try { if (this._el) this._el.remove(); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-claude#hide', _); } this._el = null; },
  };

  // ── Chờ trang sẵn sàng (composer xuất hiện) ──────────────────────────────
  async function waitProviderReady(timeout = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (findComposer()) return true;
      await sleep(250);
    }
    return !!findComposer();
  }

  // ── Mở chat mới (SPA click; fallback điều hướng /new) ─────────────────────
  async function tryNewChat() {
    const link = q(SEL.newChat);
    if (link) {
      try { link.click(); } catch (_) { try { link.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-claude#tryNewChat', _); } }
      await sleep(600);
      if (await waitProviderReady(5000)) return true;
    }
    return false;
  }

  // ── Chèn text vào ProseMirror ────────────────────────────────────────────
  async function insertText(text) {
    const editor = findComposer();
    if (!editor) return false;
    editor.focus();
    await sleep(60);
    // Xoá nội dung cũ (nếu có).
    try { document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-claude#insertText', _); }
    // Tier 1: paste event (ProseMirror xử lý tốt nhất, giữ xuống dòng).
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(160);
      if ((editor.innerText || '').trim().length > 0) return true;
    } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-claude#insertText', _); }
    // Tier 2: execCommand insertText.
    try { editor.focus(); document.execCommand('insertText', false, text); await sleep(120); if ((editor.innerText || '').trim().length > 0) return true; } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-claude#insertText', _); }
    // Tier 3: gán textContent + input event.
    try { editor.textContent = text; editor.dispatchEvent(new InputEvent('input', { bubbles: true })); await sleep(80); return (editor.innerText || '').trim().length > 0; } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-claude#insertText', _); }
    return false;
  }

  // ── Bấm gửi (retry chờ nút enable; fallback Enter) ───────────────────────
  async function clickSubmit() {
    for (let i = 0; i < 24; i++) {
      const btn = findSubmit();
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
        try { btn.click(); return true; } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-claude#clickSubmit', _); }
      }
      await sleep(250);
    }
    const editor = findComposer();
    if (editor) {
      editor.focus();
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      return true;
    }
    return false;
  }

  const isGenerating = () => !!q(SEL.stop);
  const responseCount = () => qa(SEL.response).length;
  function lastResponseText() {
    const msgs = qa(SEL.response);
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    return last ? (last.innerText || '').trim() : '';
  }

  // ── Chờ Claude trả lời xong + đọc text ───────────────────────────────────
  async function waitForTextResult(baselineCount, timeout = 90000) {
    const start = Date.now();
    let sawStart = false;
    let lastText = '';
    let stableSince = 0;
    // Chờ bắt đầu (message mới HOẶC đang generating) — tối đa 20s.
    while (Date.now() - start < Math.min(20000, timeout)) {
      if (isGenerating() || responseCount() > baselineCount) { sawStart = true; break; }
      await sleep(400);
    }
    // Chờ xong: hết generating + text ổn định.
    while (Date.now() - start < timeout) {
      await sleep(500);
      const gen = isGenerating();
      const text = lastResponseText();
      if (text && !gen) {
        if (text === lastText) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince > 1300) return { success: true, text };
        } else { stableSince = 0; }
      } else {
        stableSince = 0;
      }
      lastText = text;
    }
    const finalText = lastResponseText();
    if (finalText) return { success: true, text: finalText };
    return { success: false, error: sawStart ? 'RESULT_TIMEOUT' : 'NO_RESPONSE' };
  }

  // ── Message listener ─────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return false;

    if (message.action === 'provider:textTask') {
      ExecutionBlocker.show();
      (async () => {
        try {
          const ready = await waitProviderReady();
          if (!ready) { sendResponse({ success: false, error: 'PROVIDER_NOT_READY' }); return; }
          let isolated = !!message.tabFreshlyCreated;
          if (message.newChat && !isolated) { try { isolated = await tryNewChat(); } catch (_) { globalThis.SEOSONA_swallow?.('chat-content-claude#waitForTextResult', _); } }
          const baseline = responseCount();
          // Ảnh tham chiếu: bản Claude v1 chưa hỗ trợ upload → chạy text-only (PA chủ yếu dùng text).
          const inserted = await insertText(message.text || '');
          if (!inserted) { sendResponse({ success: false, error: 'INSERT_FAILED' }); return; }
          await sleep(300);
          const submitted = await clickSubmit();
          if (!submitted) { sendResponse({ success: false, error: 'SEND_BUTTON_NOT_FOUND' }); return; }
          const result = await waitForTextResult(baseline, message.timeout || 90000);
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, error: 'EXCEPTION', message: (err && err.message) || String(err) });
        } finally {
          ExecutionBlocker.hide();
        }
      })();
      return true; // async sendResponse
    }

    // Readiness / login check (background i2p:checkProviders có thể executeScript riêng, nhưng để phòng).
    if (message.action === 'claude:checkLogin' || message.action === 'claude:checkStatus' || message.action === 'claude:ping') {
      sendResponse({ ok: true, ready: !!findComposer(), loggedIn: !!findComposer() });
      return true;
    }

    // Cleanup sau text task (ClaudeSession.deleteCurrentConversation). Claude v1 text-only:
    // không tự động menu-delete (rủi ro xoá nhầm) — thay vào đó mở chat mới để isolate
    // conversation kế tiếp. Trả success để caller không treo ở "No response".
    if (message.action === 'claude:deleteCurrentConversation') {
      (async () => {
        try {
          const ok = await tryNewChat();
          sendResponse({ success: true, reset: !!ok });
        } catch (err) {
          sendResponse({ success: false, error: (err && err.message) || String(err) });
        }
      })();
      return true; // async sendResponse
    }

    return false;
  });

  console.log('[ChatAI] Content script Claude đã được inject (SEOSONA Flow)');
})();
