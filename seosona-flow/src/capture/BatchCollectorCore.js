// SEOSONA Flow — batch collector core.
// Pure helpers for drag-select collection of links, images and cards.
(function (global) {
  'use strict';

  var API = {};

  function validRect(rect) {
    return rect && Number(rect.width) > 0 && Number(rect.height) > 0;
  }

  function normRect(rect) {
    return {
      x: Number(rect.x) || 0,
      y: Number(rect.y) || 0,
      width: Number(rect.width) || 0,
      height: Number(rect.height) || 0,
    };
  }

  function intersects(a, b) {
    a = normRect(a);
    b = normRect(b);
    return a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;
  }

  function modeAllows(mode, item) {
    if (!mode || mode === 'mixed') return true;
    if (mode === 'links') return item.kind === 'link';
    if (mode === 'images') return item.kind === 'image';
    if (mode === 'cards') return item.kind === 'card';
    return true;
  }

  function itemKey(item) {
    return String(item.url || item.href || item.src || item.selector || item.text || '').trim();
  }

  function cleanItem(item) {
    var rect = normRect(item.rect);
    return {
      kind: item.kind || 'item',
      url: item.url || item.href || '',
      href: item.href || item.url || '',
      src: item.src || '',
      text: item.text || '',
      selector: item.selector || '',
      rect: rect,
      signature: item.signature || '',
    };
  }

  function collect(candidates, opts) {
    opts = opts || {};
    var dragRect = opts.rect;
    if (!validRect(dragRect)) return { ok: false, error: 'INVALID_RECT', items: [], truncated: false };
    var mode = opts.mode || 'mixed';
    var maxItems = Number(opts.maxItems);
    if (!Number.isFinite(maxItems) || maxItems <= 0) maxItems = 100;
    var seen = {};
    var items = [];
    var list = Array.isArray(candidates) ? candidates : [];
    for (var i = 0; i < list.length; i++) {
      var item = cleanItem(list[i] || {});
      if (!validRect(item.rect)) continue;
      if (!modeAllows(mode, item)) continue;
      if (!intersects(item.rect, dragRect)) continue;
      var key = itemKey(item);
      if (key && seen[key]) continue;
      if (key) seen[key] = true;
      items.push(item);
    }
    items.sort(function (a, b) {
      var dy = a.rect.y - b.rect.y;
      if (Math.abs(dy) > 4) return dy;
      return a.rect.x - b.rect.x;
    });
    var truncated = items.length > maxItems;
    if (truncated) items = items.slice(0, maxItems);
    return { ok: true, items: items, count: items.length, truncated: truncated };
  }

  async function handleMessage(message, opts) {
    opts = opts || {};
    if (opts.trusted === false) return { ok: false, error: 'UNTRUSTED_SENDER', items: [] };
    if (!message || message.action !== 'batchCollector:collect') return { ok: false, error: 'UNKNOWN_ACTION', items: [] };
    return collect(message.candidates || [], {
      rect: message.rect,
      mode: message.mode,
      maxItems: message.maxItems,
    });
  }

  API.collect = collect;
  API.intersects = intersects;
  API.handleMessage = handleMessage;

  Object.defineProperty(global, 'SEOSONA_BatchCollectorCore', {
    value: API,
    configurable: true,
    writable: true,
  });
})(typeof self !== 'undefined' ? self : this);
