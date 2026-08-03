// SEOSONA Flow — visual picker core.
// Classic script with pure helpers used by future page overlays and workflow
// node builders. No provider or third-party extension coupling.
(function (global) {
  'use strict';

  var API = {};
  var STATE_CLASSES = {
    active: true,
    selected: true,
    hover: true,
    focus: true,
    disabled: true,
    hidden: true,
  };

  function asTag(tagName) {
    var tag = String(tagName || 'div').trim().toLowerCase();
    return /^[a-z][a-z0-9-]*$/.test(tag) ? tag : 'div';
  }

  function cssEscape(value) {
    var s = String(value || '');
    return s.replace(/[^a-zA-Z0-9_-]/g, function (ch) {
      return '\\' + ch.charCodeAt(0).toString(16) + ' ';
    });
  }

  function isSafeId(id) {
    return /^[A-Za-z][A-Za-z0-9_-]{0,80}$/.test(String(id || ''));
  }

  function cleanClasses(classes) {
    var out = [];
    var seen = {};
    var list = Array.isArray(classes) ? classes : [];
    for (var i = 0; i < list.length; i++) {
      var c = String(list[i] || '').trim();
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,48}$/.test(c)) continue;
      if (STATE_CLASSES[c]) continue;
      if (seen[c]) continue;
      seen[c] = true;
      out.push(c);
      if (out.length >= 2) break;
    }
    return out;
  }

  function buildCssSelector(meta) {
    meta = meta || {};
    if (isSafeId(meta.id)) return '#' + cssEscape(meta.id);
    var selector = asTag(meta.tagName);
    var classes = cleanClasses(meta.classes);
    for (var i = 0; i < classes.length; i++) selector += '.' + cssEscape(classes[i]);
    var nth = Number(meta.nthOfType);
    if (Number.isFinite(nth) && nth > 1) selector += ':nth-of-type(' + Math.floor(nth) + ')';
    return selector;
  }

  function normalizeMatch(match) {
    match = match || {};
    return {
      tagName: asTag(match.tagName),
      text: String(match.text || '').trim().slice(0, 500),
      href: match.href || '',
      src: match.src || '',
      alt: match.alt || '',
    };
  }

  function buildProbeReceipt(input) {
    input = input || {};
    var matches = Array.isArray(input.matches) ? input.matches.map(normalizeMatch) : [];
    var count = matches.length;
    var status = count === 0 ? 'missing' : (count === 1 ? 'unique' : 'ambiguous');
    return {
      ok: true,
      selector: input.selector || '',
      selectorType: input.selectorType || 'css',
      status: status,
      matchCount: count,
      sample: count ? matches[0] : null,
      matches: matches.slice(0, 20),
    };
  }

  function toWorkflowNodeDraft(profile) {
    profile = profile || {};
    var type = profile.extractionType || 'text';
    var nodeType = type === 'image' ? 'extract_image' : (type === 'link' ? 'extract_link' : 'extract_text');
    var sample = profile.sample || {};
    return {
      node_type: nodeType,
      selector: profile.selector || '',
      selector_type: profile.selectorType || 'css',
      extraction_type: type,
      preview: sample.text || sample.href || sample.src || '',
      status: 'ready',
    };
  }

  async function handleMessage(message, opts) {
    opts = opts || {};
    if (opts.trusted === false) return { ok: false, error: 'UNTRUSTED_SENDER' };
    if (!message || message.action !== 'visualPicker:buildNode') return { ok: false, error: 'UNKNOWN_ACTION' };
    return { ok: true, node: toWorkflowNodeDraft(message.profile || message) };
  }

  API.buildCssSelector = buildCssSelector;
  API.buildProbeReceipt = buildProbeReceipt;
  API.toWorkflowNodeDraft = toWorkflowNodeDraft;
  API.handleMessage = handleMessage;
  API.cssEscape = cssEscape;

  Object.defineProperty(global, 'SEOSONA_VisualPickerCore', {
    value: API,
    configurable: true,
    writable: true,
  });
})(typeof self !== 'undefined' ? self : this);
