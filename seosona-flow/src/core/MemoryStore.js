/**
 * MemoryStore — bộ nhớ 3 TẦNG cho WorkflowAgent / assistant (100% local, chrome.storage, offline).
 *
 * Học taxonomy MemMachine (KHÔNG lấy Neo4j/Postgres — quá nặng cho MV3): tách 3 tầng + "rank-then-load"
 * (xếp hạng rồi chỉ nạp top-N) thay vì nạp cả kho:
 *   - PROFILE  : fact BỀN của user/brand (brand=blue, provider ưa dùng, phong cách) — key→value, ít, ổn định.
 *   - EPISODIC : ghi chú theo phiên/việc (đã làm gì, quyết định gì) — list, có cap + prune cũ.
 *   - WORKING  : ngữ cảnh phiên hiện tại — in-mem, mất khi reload (ephemeral).
 *
 * API:
 *   MemoryStore.tokens(s) -> string[]
 *   MemoryStore.rank(query, items, {now, limit, tierWeights}) -> ranked[]      // THUẦN, testable
 *   await MemoryStore.add(text, {tier, tags, key, ts}) -> record
 *   await MemoryStore.search(query, {limit, tiers}) -> ranked records          // rank-then-load
 *   await MemoryStore.getProfile() / setProfile(key, value)
 *   MemoryStore.remember(text, tags)  // shortcut episodic
 *
 * Có thể expose search() như MCP tool qua local-mcp-bridge để agent gọi memory.search() lúc chạy.
 */
(function (root) {
  'use strict';

  var K_PROFILE = 'af_memory_profile';   // { key: {value, tags, ts} }
  var K_EPISODIC = 'af_memory_episodic'; // [ {text, tags, ts} ]
  var MAX_EPISODIC = 400;                // cap — prune cũ nhất khi vượt
  var HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 14; // recency half-life ~14 ngày
  var working = [];                      // in-mem ephemeral

  var TIER_W = { profile: 1.4, episodic: 1.0, working: 1.2 };

  // Tách token: chữ/số ≥2 ký tự, hỗ trợ tiếng Việt có dấu.
  function tokens(s) {
    return (String(s == null ? '' : s).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []);
  }

  // Điểm 1 item so với query: overlap từ khoá (tỉ lệ term query khớp) + boost recency (exp decay) + tier weight.
  function scoreItem(qTokens, item, now) {
    if (!qTokens.length) return 0;
    var text = (item && (item.text || item.value || '')) + ' ' + ((item && item.tags) || []).join(' ');
    var t = tokens(text);
    if (!t.length) return 0;
    var set = Object.create(null);
    for (var i = 0; i < t.length; i++) set[t[i]] = 1;
    var hits = 0;
    for (var j = 0; j < qTokens.length; j++) if (set[qTokens[j]]) hits++;
    var overlap = hits / qTokens.length; // 0..1
    if (overlap === 0) return 0;
    var age = Math.max(0, (now || 0) - (item.ts || 0));
    var recency = Math.pow(0.5, age / HALF_LIFE_MS); // 1 → 0.5 sau HALF_LIFE
    var tw = TIER_W[item.tier] != null ? TIER_W[item.tier] : 1;
    return overlap * tw * (0.7 + 0.3 * recency); // overlap chủ đạo, recency phụ
  }

  // Xếp hạng thuần (testable): trả top-N item có score>0, kèm _score.
  function rank(query, items, opts) {
    opts = opts || {};
    var q = tokens(query);
    var now = opts.now || 0;
    var scored = [];
    (items || []).forEach(function (it) {
      var s = scoreItem(q, it, now);
      if (s > 0) scored.push(Object.assign({ _score: s }, it));
    });
    scored.sort(function (a, b) { return b._score - a._score; });
    return typeof opts.limit === 'number' ? scored.slice(0, opts.limit) : scored;
  }

  // ---- Storage wrappers (chrome.storage.local) ----
  function _get(keys) {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) { resolve({}); return; }
        chrome.storage.local.get(keys, function (r) { resolve(r || {}); });
      } catch (e) { resolve({}); }
    });
  }
  function _set(obj) {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) { resolve(false); return; }
        chrome.storage.local.set(obj, function () { resolve(true); });
      } catch (e) { resolve(false); }
    });
  }
  function _now() { try { return Date.now(); } catch (e) { return 0; } }

  async function getProfile() {
    var st = await _get([K_PROFILE]);
    return st[K_PROFILE] && typeof st[K_PROFILE] === 'object' ? st[K_PROFILE] : {};
  }
  async function setProfile(key, value, tags) {
    if (!key) return false;
    var p = await getProfile();
    p[String(key)] = { value: value, tags: tags || [], ts: _now() };
    var o = {}; o[K_PROFILE] = p; return _set(o);
  }
  async function _getEpisodic() {
    var st = await _get([K_EPISODIC]);
    return Array.isArray(st[K_EPISODIC]) ? st[K_EPISODIC] : [];
  }

  // Thêm 1 memory. tier: 'profile' (cần key) | 'episodic' (default) | 'working'.
  async function add(text, opts) {
    opts = opts || {};
    var tier = opts.tier || 'episodic';
    var rec = { text: String(text == null ? '' : text), tags: opts.tags || [], ts: opts.ts || _now(), tier: tier };
    if (tier === 'profile') { await setProfile(opts.key || rec.text.slice(0, 40), text, opts.tags); return rec; }
    if (tier === 'working') { working.push(rec); if (working.length > 200) working.shift(); return rec; }
    // episodic
    var list = await _getEpisodic();
    list.push(rec);
    if (list.length > MAX_EPISODIC) list = list.slice(list.length - MAX_EPISODIC); // prune cũ nhất
    var o = {}; o[K_EPISODIC] = list; await _set(o);
    return rec;
  }
  function remember(text, tags) { return add(text, { tier: 'episodic', tags: tags }); }

  // rank-then-load: gom item từ các tầng, xếp hạng, trả top-N (không nạp cả kho vào prompt).
  async function search(query, opts) {
    opts = opts || {};
    var tiers = opts.tiers || ['profile', 'episodic', 'working'];
    var items = [];
    if (tiers.indexOf('profile') >= 0) {
      var p = await getProfile();
      Object.keys(p).forEach(function (k) {
        var e = p[k]; items.push({ text: k + ': ' + (typeof e.value === 'string' ? e.value : JSON.stringify(e.value)), tags: e.tags || [], ts: e.ts || 0, tier: 'profile', key: k });
      });
    }
    if (tiers.indexOf('episodic') >= 0) { (await _getEpisodic()).forEach(function (r) { items.push(Object.assign({ tier: 'episodic' }, r)); }); }
    if (tiers.indexOf('working') >= 0) { working.forEach(function (r) { items.push(r); }); }
    return rank(query, items, { now: _now(), limit: opts.limit || 8 });
  }

  function clearWorking() { working.length = 0; }

  // Format kết quả search() thành 1 khối ngữ cảnh (bullet) để nhét vào prompt agent. Pure.
  function formatHits(hits) {
    if (!Array.isArray(hits) || !hits.length) return '';
    return hits.map(function (h) { return '- ' + ((h && h.text) || ''); }).filter(function (l) { return l.length > 2; }).join('\n');
  }

  // [Seed] Nạp fact mặc định vào PROFILE 1 lần (idempotent) — để memory.search() trả ngữ cảnh brand/
  // provider/style hữu ích ngay từ đầu (không thì profile rỗng → search vô nghĩa). Guarded.
  async function seedDefaults() {
    try {
      var p = await getProfile();
      if (p && p.brand) return false; // đã seed
      await setProfile('brand', 'Màu chủ đạo SEOSONA blue #3d6ff5, phụ emerald #19d07b; font Be Vietnam Pro', ['brand', 'style', 'color']);
      await setProfile('provider_default', 'Ưu tiên Google Flow (Veo/Nano Banana) cho ảnh/video; ChatGPT/Grok khi cần text/ảnh khác', ['provider']);
      await setProfile('style_pref', 'Phong cách sạch, cinematic, nhất quán nhân vật/style qua các cảnh; chữ trong ảnh dùng overlay (không bake)', ['style', 'consistency']);
      return true;
    } catch (e) { return false; }
  }

  root.MemoryStore = {
    tokens: tokens, scoreItem: scoreItem, rank: rank,
    add: add, remember: remember, search: search, seedDefaults: seedDefaults, formatHits: formatHits,
    getProfile: getProfile, setProfile: setProfile, clearWorking: clearWorking,
    _tiers: { K_PROFILE: K_PROFILE, K_EPISODIC: K_EPISODIC },
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
