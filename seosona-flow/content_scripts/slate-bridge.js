/**
 * Slate Bridge — Main World Script
 * Chạy trong main world (có access React internals) để thao tác Slate editor.
 * Giao tiếp với content.js (isolated world) qua window.postMessage.
 */
(function() {
  'use strict';

  if (window.__flowAutoSlateBridgeCleanup) {
    try { window.__flowAutoSlateBridgeCleanup(); } catch (e) { globalThis.SEOSONA_swallow?.('slate-bridge', e); }
  }

  // Strict Server-Only: slateSelector pass từ content.js qua message data.
  // Bridge MAIN world không có chrome.storage access — fallback hardcoded chỉ khi cold start
  // chưa có message từ content.js (line 14 top-level call).
  var _slateSelector = '[data-slate-editor="true"]';

  function findSlateEditor() {
    var el = document.querySelector(_slateSelector);
    if (!el) return null;
    var fiberKey = Object.keys(el).find(function(k) {
      return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$');
    });
    if (!fiberKey) return null;

    var fiber = el[fiberKey];
    while (fiber) {
      // Strategy 1: React Context (fiber.dependencies.firstContext)
      if (fiber.dependencies && fiber.dependencies.firstContext) {
        var ctx = fiber.dependencies.firstContext;
        while (ctx) {
          var ctxVal = ctx.memoizedValue;
          if (ctxVal && typeof ctxVal === 'object' &&
              typeof ctxVal.insertText === 'function' &&
              Array.isArray(ctxVal.children) &&
              typeof ctxVal.apply === 'function') {
            return ctxVal;
          }
          ctx = ctx.next;
        }
      }
      // Strategy 2: memoizedState hooks (fallback)
      var state = fiber.memoizedState;
      while (state) {
        var val = state.memoizedState;
        if (val && typeof val === 'object' && Array.isArray(val.children) &&
            typeof val.apply === 'function' && typeof val.onChange === 'function') {
          return val;
        }
        if (val && typeof val === 'object' && val.current &&
            Array.isArray(val.current.children) && typeof val.current.apply === 'function') {
          return val.current;
        }
        state = state.next;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function getEndPoint(editor) {
    var path = [];
    var node = { children: editor.children };
    while (node.children && node.children.length > 0) {
      var idx = node.children.length - 1;
      path.push(idx);
      node = node.children[idx];
    }
    return { path: path, offset: (node.text || '').length };
  }

  function getAllText(node) {
    if (node.text !== undefined) return node.text;
    if (node.children) return node.children.map(getAllText).join('');
    return '';
  }

  // ============================================================================
  //  INSERT TEXT — fallback chain (3 tier)
  // ============================================================================
  //  Tier 1 'insertText':  editor.insertText(text)                            ✅ verified
  //  Tier 2 'applyOp':     editor.apply({type:'insert_text', path, offset})   ✅ verified
  //  Tier 3 'insertData':  editor.insertData(DataTransfer)                    ✅ verified (chậm 2s, split \n thành paragraphs)
  //
  //  Test isolation: window.__FLOW_INSERT_FORCE_TIER = 'insertText'|'applyOp'|'insertData'
  //  Reset: delete window.__FLOW_INSERT_FORCE_TIER
  // ============================================================================
  var INSERT_TIERS = ['insertText', 'applyOp', 'insertData'];

  function tryInsertText(editor, slateEl, text) {
    var force = window.__FLOW_INSERT_FORCE_TIER || null;

    function verifyModel() {
      var modelText = getAllText({ children: editor.children });
      var sample = text.length > 30 ? text.substring(0, 30) : text;
      return modelText.indexOf(sample) >= 0;
    }

    var impls = {
      insertText: function() {
        if (!editor.selection) {
          var endPt = getEndPoint(editor);
          editor.selection = { anchor: endPt, focus: endPt };
        }
        editor.insertText(text);
        if (typeof editor.onChange === 'function') editor.onChange();
      },
      applyOp: function() {
        var pt = getEndPoint(editor);
        editor.apply({ type: 'insert_text', path: pt.path, offset: pt.offset, text: text });
        if (typeof editor.onChange === 'function') editor.onChange();
      },
      insertData: function() {
        if (typeof editor.insertData !== 'function') {
          console.warn('[FlowAuto Bridge] INSERT[insertData]: editor.insertData unavailable');
          return false;
        }
        var pt = getEndPoint(editor);
        editor.selection = { anchor: pt, focus: pt };
        var dt = new DataTransfer();
        dt.setData('text/plain', text);
        editor.insertData(dt);
        if (typeof editor.onChange === 'function') editor.onChange();
        return true;
      }
    };

    // Forced isolation mode (test only)
    if (force && impls[force]) {
      console.log('[FlowAuto Bridge] INSERT [FORCE=' + force + ']');
      try {
        var ret = impls[force]();
        return (ret !== false && verifyModel()) ? force : null;
      } catch (e) {
        console.warn('[FlowAuto Bridge] INSERT[' + force + '] FORCED failed:', e.message);
        return null;
      }
    }

    // Production chain — try mỗi tier theo thứ tự, return tier đầu tiên work
    for (var i = 0; i < INSERT_TIERS.length; i++) {
      var tierName = INSERT_TIERS[i];
      console.log('[FlowAuto Bridge] INSERT[' + tierName + '] try (length=' + text.length + ')');
      try {
        var result = impls[tierName]();
        if (result === false) continue;
        if (verifyModel()) return tierName;
      } catch (e) {
        console.warn('[FlowAuto Bridge] INSERT[' + tierName + '] error:', e.message);
      }
    }
    return null;
  }

  // ============================================================================
  //  CLEAR EDITOR — fallback chain (3 tier)
  // ============================================================================
  //  Tier 1 'deleteFragment':   selection + editor.deleteFragment()              ✅ verified
  //  Tier 2 'selectAllDelete':  select-all + deleteFragment + cleanup #3605      ✅ verified (selection sau insert ở cuối text)
  //  Tier 3 'replaceChildren':  replace editor.children + reset selection         ✅ verified (preserve id qua UUID mới)
  //
  //  Test isolation: window.__FLOW_CLEAR_FORCE_TIER = 'deleteFragment'|'selectAllDelete'|'replaceChildren'
  //  Reset: delete window.__FLOW_CLEAR_FORCE_TIER
  // ============================================================================
  var CLEAR_TIERS = ['deleteFragment', 'selectAllDelete', 'replaceChildren'];

  function tryClear(editor, slateEl) {
    var force = window.__FLOW_CLEAR_FORCE_TIER || null;

    function verifyEmpty() {
      var text = getAllText({ children: editor.children }).trim();
      return text.length === 0;
    }

    var impls = {
      deleteFragment: function() {
        var endPt = getEndPoint(editor);
        if (endPt.offset > 0 || endPt.path.length > 2 || (endPt.path.length === 2 && endPt.path[0] > 0)) {
          var startPt = { path: [0, 0], offset: 0 };
          editor.selection = { anchor: startPt, focus: endPt };
          editor.deleteFragment();
        }
        if (typeof editor.onChange === 'function') editor.onChange();
      },
      selectAllDelete: function() {
        var endPt = getEndPoint(editor);
        var startPt = { path: [0, 0], offset: 0 };
        editor.selection = { anchor: startPt, focus: endPt };
        editor.deleteFragment();
        // Cleanup leftover empty blocks (Slate issue #3605)
        if (editor.children.length > 1) {
          editor.withoutNormalizing(function() {
            for (var i = editor.children.length - 1; i >= 1; i--) {
              try {
                editor.apply({
                  type: 'remove_node',
                  path: [i],
                  node: JSON.parse(JSON.stringify(editor.children[i]))
                });
              } catch (e) { console.warn('[FlowAuto Bridge] selectAllDelete cleanup remove_node failed:', e.message); }
            }
          });
        }
        if (typeof editor.onChange === 'function') editor.onChange();
      },
      replaceChildren: function() {
        // Clone schema từ block hiện tại (Flow dùng type='PARAGRAPH' với id field)
        function emptyClone(node) {
          if (node.text !== undefined) return { text: '' };
          var clone = {};
          for (var k in node) {
            if (k === 'children') continue;
            if (k === 'id') {
              // Test phát hiện: bỏ id → Slate-React reconciliation thiếu stable key
              // → DOM render lag 2000ms (vs 200ms khi có id). Generate UUID mới để giữ stable key.
              if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                clone.id = crypto.randomUUID();
              }
              continue;
            }
            clone[k] = node[k];
          }
          clone.children = node.children && node.children[0]
            ? [emptyClone(node.children[0])]
            : [{ text: '' }];
          return clone;
        }
        var blueprint = editor.children[0]
          ? emptyClone(editor.children[0])
          : { type: 'PARAGRAPH', children: [{ text: '' }] };
        // Mutation trực tiếp — Slate editor là mutable singleton
        editor.children = [blueprint];
        // CRITICAL: reset selection cùng lúc, nếu không Slate-React throw "Cannot resolve a Slate point"
        editor.selection = {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 0 }
        };
        if (typeof editor.onChange === 'function') editor.onChange();
      }
    };

    // Forced isolation mode (test only)
    if (force && impls[force]) {
      console.log('[FlowAuto Bridge] CLEAR [FORCE=' + force + ']');
      try {
        impls[force]();
        return verifyEmpty() ? force : null;
      } catch (e) {
        console.warn('[FlowAuto Bridge] CLEAR[' + force + '] FORCED failed:', e.message);
        return null;
      }
    }

    // Production chain
    for (var i = 0; i < CLEAR_TIERS.length; i++) {
      var tierName = CLEAR_TIERS[i];
      console.log('[FlowAuto Bridge] CLEAR[' + tierName + '] try');
      try {
        impls[tierName]();
        if (verifyEmpty()) return tierName;
      } catch (e) {
        console.warn('[FlowAuto Bridge] CLEAR[' + tierName + '] error:', e.message);
      }
    }
    return null;
  }

  // ============================================================================
  //  SUBMIT PROMPT — fallback chain (Approach 0: React internal submit methods)
  // ============================================================================
  //  Method 1 'reactPropsClick':    submitBtn.__reactProps.onClick + spoofed event       ✅ verified PRIMARY
  //  Method 2 'fiberOnSubmit':      walk fiber tree từ button, gọi pendingProps.onSubmit ✅ verified FALLBACK
  //  Method 3 'editorContextHooks': walk editor fiber tìm context/hooks state            ❌ verified FAIL (debug)
  //  Method 4 'globalStoreDetect':  detect Redux/Zustand/Redux DevTools                  ❌ verified FAIL (debug only)
  //
  //  Test isolation: window.__FLOW_SUBMIT_FORCE_METHOD = 'reactPropsClick'|'fiberOnSubmit'|'editorContextHooks'|'globalStoreDetect'
  //  Reset: delete window.__FLOW_SUBMIT_FORCE_METHOD
  //
  //  🛡️ Google đã siết trust event check (2026): chặn dispatch event giả không có isTrusted=true.
  //  Chỉ 'reactPropsClick' (cố tình fake isTrusted) và 'fiberOnSubmit' (gọi handler trực tiếp,
  //  bypass event check) còn work tới hiện tại.
  //
  //  'reactPropsClick' đặt làm PRIMARY thay 'fiberOnSubmit' vì:
  //    - Speed: O(1) lookup vs O(50) walk fiber → nhanh ~50x
  //    - Resilience: fake isTrusted=true → qua trust check
  //    - Code path đơn giản, ít phụ thuộc React internals sâu
  // ============================================================================
  var SUBMIT_METHODS = ['reactPropsClick', 'fiberOnSubmit', 'editorContextHooks', 'globalStoreDetect'];

  function trySubmitMethods(submitBtn, slateEl) {
    var force = window.__FLOW_SUBMIT_FORCE_METHOD || null;

    var impls = {
      // ✅ PRIMARY (verified) — fake isTrusted=true qua trust check
      reactPropsClick: function() {
        var propsKey = Object.keys(submitBtn).find(function(k) { return k.startsWith('__reactProps$'); });
        if (!propsKey) return false;
        var props = submitBtn[propsKey];
        if (typeof props.onClick !== 'function') return false;
        console.log('[FlowAuto Bridge] reactPropsClick: Found onClick, calling with spoofed event...');
        var rect = submitBtn.getBoundingClientRect();
        var fakeEvent = {
          preventDefault: function() {},
          stopPropagation: function() {},
          persist: function() {},
          nativeEvent: { isTrusted: true },
          isTrusted: true,
          target: submitBtn,
          currentTarget: submitBtn,
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          eventPhase: 3,
          timeStamp: Date.now(),
          type: 'click',
          button: 0,
          buttons: 1,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        };
        props.onClick(fakeEvent);
        console.log('[FlowAuto Bridge] reactPropsClick: onClick called ✓');
        return true;
      },

      // ✅ FALLBACK (verified) — walk fiber tree từ button up
      // ⚠️ Risk tương lai: pass event KHÔNG có isTrusted — Google siết thêm sẽ break
      fiberOnSubmit: function() {
        var fiberKey = Object.keys(submitBtn).find(function(k) { return k.startsWith('__reactFiber$'); });
        if (!fiberKey) return false;
        var fiber = submitBtn[fiberKey];
        var depth = 0;
        while (fiber && depth < 50) {
          if (fiber.pendingProps && typeof fiber.pendingProps.onSubmit === 'function') {
            console.log('[FlowAuto Bridge] fiberOnSubmit: Found onSubmit at depth', depth);
            fiber.pendingProps.onSubmit({ preventDefault: function(){}, stopPropagation: function(){} });
            return true;
          }
          if (fiber.stateNode && typeof fiber.stateNode.handleSubmit === 'function') {
            console.log('[FlowAuto Bridge] fiberOnSubmit: Found handleSubmit on stateNode at depth', depth);
            fiber.stateNode.handleSubmit();
            return true;
          }
          fiber = fiber.return;
          depth++;
        }
        return false;
      },

      // ❌ DEBUG ONLY (verified fail) — Flow không expose submit qua context/hooks
      editorContextHooks: function() {
        var editorFiberKey = Object.keys(slateEl).find(function(k) { return k.startsWith('__reactFiber$'); });
        if (!editorFiberKey) return false;
        var editorFiber = slateEl[editorFiberKey];
        var edDepth = 0;
        while (editorFiber && edDepth < 50) {
          // Sub-path 1: React context dependencies
          if (editorFiber.dependencies && editorFiber.dependencies.firstContext) {
            var ctx = editorFiber.dependencies.firstContext;
            while (ctx) {
              var ctxVal = ctx.memoizedValue;
              if (ctxVal && typeof ctxVal === 'object') {
                var fn = ctxVal.submit || ctxVal.handleSubmit || ctxVal.onSubmit || ctxVal.sendMessage || ctxVal.generate;
                if (typeof fn === 'function') {
                  console.log('[FlowAuto Bridge] editorContextHooks: context submit fn at fiber depth', edDepth);
                  try { fn(); return true; } catch (e) { console.log('  call failed:', e.message); }
                }
              }
              ctx = ctx.next;
            }
          }
          // Sub-path 2: hooks memoizedState (linked list của useState/useReducer values)
          if (editorFiber.memoizedState) {
            var hook = editorFiber.memoizedState;
            var hookIdx = 0;
            while (hook && hookIdx < 30) {
              var hookVal = hook.memoizedState;
              if (hookVal && typeof hookVal === 'object' && !Array.isArray(hookVal)) {
                var hookFn = hookVal.submit || hookVal.handleSubmit || hookVal.onSubmit || hookVal.sendMessage || hookVal.generate;
                if (typeof hookFn === 'function') {
                  console.log('[FlowAuto Bridge] editorContextHooks: hook submit fn at fiber', edDepth, 'hook', hookIdx);
                  try { hookFn(); return true; } catch (e) { console.log('  call failed:', e.message); }
                }
              }
              hook = hook.next;
              hookIdx++;
            }
          }
          editorFiber = editorFiber.return;
          edDepth++;
        }
        return false;
      },

      // ❌ DEBUG ONLY (verified Flow không có Redux/Zustand) — chỉ log store info
      globalStoreDetect: function() {
        var stores = [];
        if (window.__NEXT_REDUX_STORE__) stores.push({ name: 'Redux', store: window.__NEXT_REDUX_STORE__ });
        if (window.__ZUSTAND_DEVTOOLS_EXTENSION__) stores.push({ name: 'Zustand', store: window.__ZUSTAND_DEVTOOLS_EXTENSION__ });
        if (window.__REDUX_DEVTOOLS_EXTENSION__) stores.push({ name: 'Redux DevTools', store: window.__REDUX_DEVTOOLS_EXTENSION__ });
        if (stores.length > 0) {
          console.log('[FlowAuto Bridge] globalStoreDetect: Found', stores.map(function(s) { return s.name; }).join(', '));
          for (var si = 0; si < stores.length; si++) {
            var s = stores[si];
            try {
              if (s.store.getState && typeof s.store.getState === 'function') {
                var state = s.store.getState();
                var stateKeys = state && typeof state === 'object' ? Object.keys(state).slice(0, 20) : [];
                console.log('[FlowAuto Bridge] globalStoreDetect:', s.name, 'state keys:', stateKeys);
              }
            } catch (e) { console.log('  state read failed:', e.message); }
          }
          console.log('[FlowAuto Bridge] globalStoreDetect: NO action dispatch — chưa biết action type');
        } else {
          console.log('[FlowAuto Bridge] globalStoreDetect: No global state store detected');
        }
        return false; // Debug only, never returns true
      }
    };

    // Forced isolation mode (test only)
    if (force && impls[force]) {
      console.log('[FlowAuto Bridge] SUBMIT [FORCE=' + force + ']');
      try {
        return impls[force]() ? force : null;
      } catch (e) {
        console.warn('[FlowAuto Bridge] SUBMIT[' + force + '] FORCED failed:', e.message);
        return null;
      }
    }

    // Production chain
    for (var i = 0; i < SUBMIT_METHODS.length; i++) {
      var methodName = SUBMIT_METHODS[i];
      try {
        if (impls[methodName]()) return methodName;
      } catch (e) {
        console.warn('[FlowAuto Bridge] SUBMIT[' + methodName + '] error:', e.message);
      }
    }
    return null;
  }

  function _slateBridgeHandler(e) {
    if (e.source !== window) return;
    if (!e.data || e.data.source !== 'flow-auto-slate') return;
    var action = e.data.action;
    var rid = e.data.requestId;
    // FIX gen "không ra kết quả": content.js (H9 hardening) yêu cầu MỌI reply phải mang lại `nonce`
    // khớp (content.js:6549 check `e.data.nonce === nonce`), nhưng bridge trước đây KHÔNG gửi nonce
    // → content.js không bao giờ resolve → mọi _slateBridgeCall timeout 3s → clearEditor/insertText/
    // submit đều fail. Echo lại nonce từ message đến vào TẤT CẢ reply (giữ nguyên lớp hardening).
    var nonce = e.data.nonce;
    console.log('[FlowAuto Bridge] Received:', action, 'rid:', rid);

    // Ready-check: content.js gửi 'ping' để biết bridge (MAIN world) đã nạp + đang lắng nghe chưa.
    // Reply NGAY (không đụng DOM). Dùng cho _ensureSlateBridgeReady tự-chữa khi tab Flow chưa có bridge.
    if (action === 'ping') {
      window.postMessage({ source: 'flow-auto-slate-result', requestId: rid, nonce: nonce, success: true, ping: true }, window.location.origin);
      return;
    }

    // Strict Server-Only: update _slateSelector từ message (content.js đọc backend slate_editor).
    if (e.data.slateSelector && typeof e.data.slateSelector === 'string') {
      _slateSelector = e.data.slateSelector;
    }

    // Phase FAR-1: Silent session refresh — KHÔNG cần Slate editor.
    // Force Next.js re-fetch session data → re-auth Bearer token (giải pháp F5 không reload).
    // Tham khảo plan docs/plans/flow-auto-retry-plan.md Section 3.1.
    if (action === 'refreshSession') {
      try {
        var nextData = window.__NEXT_DATA__;
        if (!nextData || !nextData.buildId) {
          window.postMessage({ source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
            success: false, error: '__NEXT_DATA__ unavailable' }, window.location.origin);
          return;
        }
        var buildId = nextData.buildId;
        var path = window.location.pathname;
        var locale = nextData.locale || 'en';
        // CRITICAL: Flow URLs có format `/fx/{locale}/tools/flow/...`. Phải strip
        // `/fx/{locale}` prefix khỏi path, không chỉ strip locale (vì path bắt đầu
        // bằng `/fx/`). URL data Next.js theo convention `/fx/_next/data/{buildId}/{locale}{pagePath}.json`
        // → pagePath KHÔNG bao gồm `/fx/{locale}/` prefix.
        // Empirical verified: path `/fx/vi/tools/flow/project/{id}` → pagePath `/tools/flow/project/{id}`.
        var dataPath = path.replace(new RegExp('^/fx/' + locale + '(/|$)'), '/') || '/';
        var url = '/fx/_next/data/' + buildId + '/' + locale + dataPath + '.json';

        fetch(url, { credentials: 'include', cache: 'no-store' })
          .then(function (resp) {
            if (resp.ok) {
              window.postMessage({ source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
                success: true, status: resp.status, url: url }, window.location.origin);
            } else {
              window.postMessage({ source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
                success: false, error: 'HTTP ' + resp.status, url: url }, window.location.origin);
            }
          })
          .catch(function (err) {
            window.postMessage({ source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
              success: false, error: err && err.message ? err.message : String(err) },
              window.location.origin);
          });
      } catch (eRef) {
        window.postMessage({ source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
          success: false, error: eRef.message }, window.location.origin);
      }
      return;
    }

    var editor = findSlateEditor();
    if (!editor) {
      // Diagnostic: tại sao không tìm được?
      var el = document.querySelector(_slateSelector);
      var fiberKey = el ? Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$'); }) : null;
      console.warn('[FlowAuto Bridge] Editor NOT found. slateEl:', !!el, 'fiberKey:', !!fiberKey);
      if (el && fiberKey) {
        var fiber = el[fiberKey];
        var depth = 0;
        while (fiber && depth < 20) {
          var hasDeps = !!(fiber.dependencies && fiber.dependencies.firstContext);
          if (hasDeps) {
            console.log('[FlowAuto Bridge] Fiber depth', depth, 'has context deps');
          }
          fiber = fiber.return;
          depth++;
        }
      }
      window.postMessage({ source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
        success: false, error: 'Slate editor not found via fiber' }, window.location.origin);
      return;
    }
    console.log('[FlowAuto Bridge] Editor found, children:', editor.children.length,
      'methods:', typeof editor.insertText, typeof editor.deleteFragment);

    try {
      if (action === 'insert') {
        var slateEl = document.querySelector(_slateSelector);
        if (!slateEl) {
          window.postMessage({ source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
            success: false, error: 'Slate element not found' }, window.location.origin);
          return;
        }

        var text = e.data.text;
        console.log('[FlowAuto Bridge] Insert: text length=' + text.length);

        slateEl.focus();

        // Run fallback chain (primary → A3 → A4) hoặc forced tier nếu set
        var insertTier = tryInsertText(editor, slateEl, text);

        // Move selection to end TRƯỚC blur/focus để tránh race condition
        var newEndPt = getEndPoint(editor);
        editor.selection = { anchor: newEndPt, focus: newEndPt };

        // Force blur/focus cycle để React re-render flush DOM
        setTimeout(function() {
          try {
            slateEl.blur();
            slateEl.focus();
          } catch (e) {
            console.warn('[FlowAuto Bridge] blur/focus error (non-fatal):', e.message);
          }
        }, 0);

        // Verify sau 100ms (chỉ log, không gating success — caller verify lại qua DOM)
        setTimeout(function() {
          var el = document.querySelector(_slateSelector);
          var placeholderGone = el ? !el.querySelector('[data-slate-placeholder]') : false;
          var domText = el ? el.textContent : '';
          console.log('[FlowAuto] Bridge insert verify: tier=' + insertTier + ', placeholderGone=' + placeholderGone + ', domText=' + domText.substring(0, 50));
        }, 100);

        if (insertTier) {
          console.log('[FlowAuto Bridge] ✅ INSERT done via tier:', insertTier);
          window.postMessage({
            source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
            success: true, tier: insertTier
          }, window.location.origin);
        } else {
          console.warn('[FlowAuto Bridge] ❌ INSERT all tiers failed (primary + A3 + A4)');
          window.postMessage({
            source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
            success: false, error: 'All insert tiers failed (primary, A3, A4)'
          }, window.location.origin);
        }

      } else if (action === 'clear') {
        var slateElClear = document.querySelector(_slateSelector);
        var clearTier = tryClear(editor, slateElClear);
        if (clearTier) {
          console.log('[FlowAuto Bridge] ✅ CLEAR done via tier:', clearTier);
          window.postMessage({
            source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
            success: true, tier: clearTier
          }, window.location.origin);
        } else {
          console.warn('[FlowAuto Bridge] ❌ CLEAR all tiers failed (primary + B4 + B2)');
          window.postMessage({
            source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
            success: false, error: 'All clear tiers failed (primary, B4, B2)'
          }, window.location.origin);
        }

      } else if (action === 'focus') {
        // Manual Enter mode: focus editor + đặt caret ở CUỐI text (MAIN world, nơi React/Slate sống)
        // để user nhấn Enter là submit ngay. el.focus() từ isolated world KHÔNG set được editor.selection
        // → caret rỗng → Enter vô tác dụng. Bridge set selection + blur/focus cycle như insert path.
        var slateElFocus = document.querySelector(_slateSelector);
        if (!slateElFocus) {
          window.postMessage({ source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
            success: false, error: 'Slate element not found' }, window.location.origin);
          return;
        }
        // Best-effort: đưa window/document Flow lên focus (browser có thể chặn nếu không có user gesture).
        try { window.focus(); } catch (wf) { globalThis.SEOSONA_swallow?.('slate-bridge#setTimeout', wf); }
        try {
          var fp = getEndPoint(editor);
          editor.selection = { anchor: fp, focus: fp };
        } catch (fe) { /* selection best-effort */ }
        try { slateElFocus.focus(); } catch (e) { globalThis.SEOSONA_swallow?.('slate-bridge#setTimeout', e); }
        // CRITICAL: Slate hiện caret + nhận Enter chỉ khi có DOM Selection range trong editor.
        // editor.selection (model) KHÔNG đủ — phải set DOM Range (window.getSelection) ở CUỐI nội dung.
        try {
          var domSel = window.getSelection();
          if (domSel) {
            var r = document.createRange();
            r.selectNodeContents(slateElFocus);
            r.collapse(false); // collapse về CUỐI
            domSel.removeAllRanges();
            domSel.addRange(r);
          }
        } catch (se) { /* DOM selection best-effort */ }
        // blur/focus cycle để React flush DOM selection (giống insert path :547), rồi set lại range.
        setTimeout(function() {
          try {
            slateElFocus.focus();
            var ds = window.getSelection();
            if (ds && ds.rangeCount === 0) {
              var r2 = document.createRange();
              r2.selectNodeContents(slateElFocus); r2.collapse(false);
              ds.addRange(r2);
            }
          } catch (e) { globalThis.SEOSONA_swallow?.('slate-bridge#setTimeout', e); }
        }, 0);
        var isFocusedNow = document.activeElement === slateElFocus || slateElFocus.contains(document.activeElement);
        window.postMessage({ source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
          success: true, focused: isFocusedNow }, window.location.origin);

      } else if (action === 'submit') {
        // Diagnostic: đọc text từ editor model
        function getAllText(node) {
          if (node.text !== undefined) return node.text;
          if (node.children) return node.children.map(getAllText).join('');
          return '';
        }
        var editorText = getAllText({ children: editor.children });
        var slateEl = document.querySelector(_slateSelector);
        var domText = slateEl ? slateEl.textContent : '';
        var hasPlaceholder = slateEl ? !!slateEl.querySelector('[data-slate-placeholder]') : true;

        console.log('[FlowAuto Bridge] Pre-submit state:',
          'modelText=' + JSON.stringify(editorText.substring(0, 50)),
          'domText=' + JSON.stringify(domText.substring(0, 50)),
          'placeholder=' + hasPlaceholder,
          'selection=' + JSON.stringify(editor.selection),
          'children=' + JSON.stringify(editor.children).substring(0, 200));

        // Validate: check CẢ editorText (Slate model) VÀ domText (DOM)
        // Race condition: DOM có thể có text nhưng Slate model chưa sync
        var trimmedModelText = editorText.trim();
        var trimmedDomText = domText.trim();
        var hasContent = trimmedModelText.length > 0 || (trimmedDomText.length > 0 && !hasPlaceholder);

        if (!hasContent) {
          window.postMessage({
            source: 'flow-auto-slate-result',
            requestId: rid, nonce: nonce,
            success: false,
            error: 'Editor empty, cannot submit'
          }, window.location.origin);
          return;
        }

        // Nếu DOM có text nhưng model chưa sync → log warning và tiếp tục
        // Fallback approaches (button click, Enter key) có thể vẫn hoạt động
        if (trimmedModelText.length === 0 && trimmedDomText.length > 0) {
          console.warn('[FlowAuto Bridge] Model empty but DOM has text - proceeding with fallbacks');
        }

        // Helper: full pointer/mouse event chain (giống ChatGPT/Grok pattern)
        function simulateClick(el) {
          if (!el) return;
          var rect = el.getBoundingClientRect();
          var x = rect.left + rect.width / 2;
          var y = rect.top + rect.height / 2;
          var opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.dispatchEvent(new PointerEvent('pointerup', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
        }

        // Helper: submit via Enter key (fallback khi button không hoạt động)
        function submitViaEnterKey() {
          console.log('[FlowAuto Bridge] Fallback: Submit via Enter key');
          slateEl.focus();
          // Try Enter first
          slateEl.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            bubbles: true, cancelable: true,
          }));
          slateEl.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            bubbles: true,
          }));
        }

        // Helper: submit via Ctrl+Enter (some editors require this)
        function submitViaCtrlEnter() {
          console.log('[FlowAuto Bridge] Fallback: Submit via Ctrl+Enter');
          slateEl.focus();
          slateEl.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            ctrlKey: true, metaKey: false,
            bubbles: true, cancelable: true,
          }));
          slateEl.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            ctrlKey: true, metaKey: false,
            bubbles: true,
          }));
          // Also try Cmd+Enter for Mac
          slateEl.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            ctrlKey: false, metaKey: true,
            bubbles: true, cancelable: true,
          }));
        }

        // Tìm submit button (arrow_forward icon).
        // Strict Server-Only: iconSelector pass từ content.js qua e.data.iconSelector
        // (provider_configs.dom_selector.icon_element.selectors). Bridge KHÔNG có access chrome.storage.
        var iconSelector = e.data.iconSelector || '';
        if (!iconSelector) {
          console.warn('[FlowAuto Bridge] iconSelector missing — caller chưa pass icon_element config');
        }
        // Fix audit gen #2: ligature lấy từ config (content.js pass e.data.submitIconText từ
        // submit_button.icon_text) — trước đây hardcode 'arrow_forward', nếu Flow đổi tên symbol
        // hoặc config khác → find fail → rơi vào Enter-only path. Fallback vẫn 'arrow_forward'.
        var wantIcon = e.data.submitIconText || 'arrow_forward';
        var buttons = document.querySelectorAll('button');
        var submitBtn = null;
        if (iconSelector) {
          for (var i = 0; i < buttons.length; i++) {
            var icon = buttons[i].querySelector(iconSelector);
            if (icon && icon.textContent.trim() === wantIcon) {
              submitBtn = buttons[i];
              break;
            }
          }
        }

        if (!submitBtn) {
          // Fix audit gen #A: KHÔNG tìm thấy button → thử Enter, nhưng post success=FALSE để
          // content.js chạy fallback mạnh hơn (getSubmitButton Tier 0-3 + simulateClick). Trước đây
          // post success=true vô điều kiện → content.js tin đã submit → nếu Enter không ăn (Flow cần
          // trusted click) thì prompt gõ xong mà KHÔNG generate (silent fail). Double-submit tự giới
          // hạn vì Flow disable nút submit khi editor rỗng sau khi đã submit.
          console.log('[FlowAuto Bridge] Submit button not found, Enter fallback + defer to content.js');
          submitViaEnterKey();
          window.postMessage({ source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
            success: false, error: 'submit button not found (icon=' + wantIcon + '); Enter attempted, content.js fallback' }, window.location.origin);
          return;
        }

        console.log('[FlowAuto Bridge] Submit button:', 'disabled=' + submitBtn.disabled,
          'onclick=' + typeof submitBtn.onclick);

        // Check React props on button for onClick handler
        var btnFiber = Object.keys(submitBtn).find(function(k) { return k.startsWith('__reactProps$'); });
        if (btnFiber) {
          var props = submitBtn[btnFiber];
          console.log('[FlowAuto Bridge] Button props:', 'onClick=' + typeof props.onClick,
            'disabled=' + props.disabled, 'type=' + props.type);
        }

        // APPROACH 0: React internal submit (xem trySubmitMethods ở module scope cho chi tiết các method)
        console.log('[FlowAuto Bridge] Approach 0: trying SUBMIT_METHODS chain...');
        var matchedMethod = null;
        try {
          matchedMethod = trySubmitMethods(submitBtn, slateEl);
        } catch (e) {
          console.warn('[FlowAuto Bridge] SUBMIT chain error:', e.message);
        }
        var submitSuccess = !!matchedMethod;

        if (submitSuccess) {
          console.log('[FlowAuto Bridge] ✅ SUBMIT done via method:', matchedMethod);
          window.postMessage({
            source: 'flow-auto-slate-result',
            requestId: rid, nonce: nonce,
            success: true,
            method: matchedMethod
          }, window.location.origin);
          return;
        }

        // CRITICAL: User confirmed Enter works if editor has trusted focus
        var isEditorFocused = document.activeElement === slateEl || slateEl.contains(document.activeElement);
        console.log('[FlowAuto Bridge] Editor focused:', isEditorFocused, 'activeElement:', document.activeElement?.tagName);

        // If editor is focused, dispatch Enter immediately
        if (isEditorFocused) {
          console.log('[FlowAuto Bridge] Editor has focus, trying Enter immediately...');
          slateEl.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            bubbles: true, cancelable: true, composed: true
          }));
          slateEl.dispatchEvent(new KeyboardEvent('keypress', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            bubbles: true, cancelable: true, composed: true
          }));
          slateEl.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            bubbles: true, cancelable: true, composed: true
          }));
        }

        // Focus button
        console.log('[FlowAuto Bridge] Focusing button...');
        submitBtn.focus();

        // Use setTimeout to ensure async execution
        setTimeout(function() {
          // Approach 1: Native button.click()
          console.log('[FlowAuto Bridge] Approach 1: Native button.click()...');
          submitBtn.click();

          setTimeout(function() {
            // Approach 2: simulateClick
            console.log('[FlowAuto Bridge] Approach 2: simulateClick...');
            simulateClick(submitBtn);

            setTimeout(function() {
              // Approach 3: Focus editor and Enter
              if (slateEl) {
                console.log('[FlowAuto Bridge] Approach 3: Focus editor + Enter...');
                slateEl.focus();
                // Wait a bit for focus to settle
                setTimeout(function() {
                  slateEl.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', code: 'Enter', keyCode: 13,
                    bubbles: true, cancelable: true, composed: true
                  }));
                  slateEl.dispatchEvent(new KeyboardEvent('keypress', {
                    key: 'Enter', code: 'Enter', keyCode: 13,
                    bubbles: true, cancelable: true, composed: true
                  }));
                  slateEl.dispatchEvent(new KeyboardEvent('keyup', {
                    key: 'Enter', code: 'Enter', keyCode: 13,
                    bubbles: true, cancelable: true, composed: true
                  }));
                }, 100);
              }

              setTimeout(function() {
                // Approach 4: Ctrl+Enter
                if (slateEl) {
                  console.log('[FlowAuto Bridge] Approach 4: Ctrl+Enter...');
                  slateEl.focus();
                  slateEl.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', code: 'Enter', keyCode: 13,
                    ctrlKey: true, bubbles: true, cancelable: true, composed: true
                  }));
                }
              }, 200);
            }, 50);
          }, 50);
        }, 50);

        // [BUG FIX] Trước đây luôn post success=true bất kể Approach 0 work hay không
        // → caller (content.js) tin "submit OK" rồi không chạy fallback Approach 2/3/4 → silent fail.
        // Giờ post submitSuccess thật từ Approach 0. Nếu false, content.js sẽ fallback đúng cách.
        // (Chuỗi setTimeout Enter/click vẫn chạy fire-and-forget — nếu may mắn trigger thì tốt,
        //  không thì content.js đã có fallback song song.)
        window.postMessage({
          source: 'flow-auto-slate-result',
          requestId: rid, nonce: nonce,
          success: submitSuccess,
          error: submitSuccess ? null : 'All Approach 0 methods failed (M4/M1/M2/M3)'
        }, window.location.origin);

      }
    } catch(err) {
      window.postMessage({ source: 'flow-auto-slate-result', requestId: rid, nonce: nonce,
        success: false, error: err.message }, window.location.origin);
    }
  }

  window.addEventListener('message', _slateBridgeHandler);

  // ─── [FLOW_RECAPTCHA_403] Fetch interceptor — đọc lỗi API gen (reCAPTCHA 403 âm thầm) ─────
  // Gen đi qua aisandbox-pa.googleapis.com/.../flowMedia:batchGenerate* (cross-origin), fail
  // reCAPTCHA trả 403 body {error:{message:"reCAPTCHA evaluation failed", status:"PERMISSION_DENIED",
  // details:[{reason:"PUBLIC_ERROR_UNUSUAL_ACTIVITY"}]}}. Extension KHÔNG thấy response này (chỉ
  // watch tile DOM) → fail âm thầm. Interceptor (MAIN world) READ-ONLY clone response → postMessage
  // về content.js. KHÔNG sửa request/response, KHÔNG bypass — chỉ QUAN SÁT để xử lý đàng hoàng.
  if (!window.__flowGenFetchPatched) {
    window.__flowGenFetchPatched = true;
    var _origFetch = window.fetch;
    // Bắt media: chỉ bật khi MediaCache có mặt. Thiếu module thì interceptor vẫn chạy
    // đúng phần báo lỗi như trước — không để một tính năng mới làm hỏng tính năng cũ.
    var _MC = window.MediaCache || null;
    var _mediaCapEnabled = !!_MC;
    var _mediaCache = _MC ? _MC.create() : null;
    // Rời trang thì trả lại bộ nhớ ngay, không đợi trình duyệt thu gom.
    if (_mediaCache) {
      window.addEventListener('pagehide', function () {
        try { _mediaCache.clear().forEach(function (d) { URL.revokeObjectURL(d.url); }); }
        catch (_e) { globalThis.SEOSONA_swallow?.('slate-bridge#pagehide', _e); }
      });
    }
    // Endpoint gen Flow — match generous: aisandbox + flowMedia:batchGenerate (Images/Videos/...)
    var GEN_URL_RE = /aisandbox[^/]*\.googleapis\.com\/.*flowMedia:batchGenerate/i;
    function _reportGenError(status, body) {
      try {
        var err = (body && body.error) || {};
        var reason = '';
        if (Array.isArray(err.details)) {
          for (var i = 0; i < err.details.length; i++) {
            if (err.details[i] && err.details[i].reason) { reason = String(err.details[i].reason); break; }
          }
        }
        window.postMessage({
          source: 'flow-gen-error',
          httpStatus: status,
          message: String(err.message || ''),
          statusText: String(err.status || ''),
          reason: reason,           // vd PUBLIC_ERROR_UNUSUAL_ACTIVITY
          ts: Date.now()
        }, window.location.origin);
      } catch (_) { globalThis.SEOSONA_swallow?.('slate-bridge#_reportGenError', _); }
    }
    window.fetch = function (input, init) {
      var url = '';
      // input có thể là string / Request (input.url) / URL object (String(input)).
      try {
        if (typeof input === 'string') url = input;
        else if (input && input.url) url = input.url;
        else if (input) url = String(input);
      } catch (_) { globalThis.SEOSONA_swallow?.('slate-bridge#fetch', _); }
      var p = _origFetch.apply(this, arguments);
      if (url && GEN_URL_RE.test(url)) {
        p.then(function (resp) {
          try {
            // Chỉ đọc khi có dấu hiệu lỗi (status >= 400) — không parse mọi response gen thành công.
            if (resp && resp.status >= 400) {
              resp.clone().json().then(function (body) {
                _reportGenError(resp.status, body);
              }).catch(function () {
                _reportGenError(resp.status, null); // body không JSON → vẫn báo status
              });
            }
          } catch (_) { globalThis.SEOSONA_swallow?.('slate-bridge#fetch', _); }
        }).catch(function () { /* network error — không phải lỗi API, bỏ qua */ });
      }
      // ── Bắt BYTES media tại nguồn ─────────────────────────────────────────
      // Link media của Google có chữ ký HẾT HẠN ~1 giờ. Workflow dài hoặc mở lại kết
      // quả cũ là link chết → tải về 403, trong khi ảnh/video đã sinh xong và đã tốn
      // credit. Không có cách nào làm mới link đó từ phía ta.
      // Cách duy nhất còn lại: đừng giữ LINK, giữ BYTES. Trang Flow vừa tải media về
      // để hiển thị — clone lại đúng lúc đó là có bản sao không bao giờ hết hạn.
      // CHỈ ĐỌC: không sửa request, không sửa response, không đụng header.
      else if (url && _mediaCapEnabled && _MC && _MC.isMediaUrl(url)) {
        p.then(function (resp) {
          try {
            if (!resp || !resp.ok) return;
            var id = _MC.idFromUrl(url);
            if (!id || _mediaCache.has(id)) return;   // đã có rồi thì khỏi tốn bộ nhớ lần nữa
            resp.clone().blob().then(function (b) {
              try {
                if (!b || !b.size) return;
                var burl = URL.createObjectURL(b);
                var r = _mediaCache.put(id, burl, b.size, b.type, Date.now());
                if (!r.stored) { URL.revokeObjectURL(burl); return; }
                // Hợp đồng của MediaCache: mọi thứ bị loại PHẢI được revoke, không thì
                // rò bộ nhớ tới khi đóng tab.
                r.dropped.forEach(function (d) { try { URL.revokeObjectURL(d.url); } catch (_e) { /* đã revoke */ } });
                window.postMessage({
                  source: 'flow-media-captured',
                  mediaId: id, blobUrl: burl, size: b.size, type: b.type, ts: Date.now(),
                }, window.location.origin);
              } catch (_e) { globalThis.SEOSONA_swallow?.('slate-bridge#mediaCapture', _e); }
            }).catch(function () { /* body đã bị tiêu thụ hoặc không đọc được — bỏ qua */ });
          } catch (_e) { globalThis.SEOSONA_swallow?.('slate-bridge#mediaCapture', _e); }
        }).catch(function () { /* network error */ });
      }
      return p;
    };
    console.log('[FlowAuto] Gen fetch interceptor installed (read-only: gen error + media capture)');
  }

  window.__flowAutoSlateBridgeCleanup = function() {
    window.removeEventListener('message', _slateBridgeHandler);
  };

  console.log('[FlowAuto] Slate bridge loaded (main world, context search)');
})();
