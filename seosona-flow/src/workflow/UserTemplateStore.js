// SEOSONA Flow — User Template Store (kho template RIÊNG của user, tách khỏi bản mặc định).
//
// Thiết kế (docs/PLAN-local-template-edit.md §CHỐT THIẾT KẾ):
//  - BUNDLED_TEMPLATES (trong code) = MẶC ĐỊNH, read-only, runtime KHÔNG bao giờ chạm.
//  - af_user_templates (chrome.storage.local) = kho của user. Bấm "Lưu"/"Chỉnh sửa" →
//    lưu thành bản RIÊNG ở đây, KHÔNG ảnh hưởng bản gốc. Sửa gốc = chỉ khi user bảo sửa code.
//  - Chỉnh sửa template mặc định → forkFromBundled() tạo bản sao vào kho user.
//
// Classic script, dependency-injected (area + getBundled + now + genId) nên unit-test được.
(function (global) {
  'use strict';

  var KEY = 'af_user_templates';
  var PREFIX = 'utpl_'; // id kho user luôn có prefix này → phân biệt với id bundled (số)

  function isUserTemplateId(id) {
    return typeof id === 'string' && id.indexOf(PREFIX) === 0;
  }

  function create(cfg) {
    cfg = cfg || {};
    var area = cfg.area;
    if (!area || typeof area.get !== 'function') throw new Error('UserTemplateStore requires a storage area');
    // BUNDLED_TEMPLATES nay nạp THEO YÊU CẦU (1,4 MB, xem ensureBundledTemplates). Nếu ai đó
    // đọc trước lúc nạp xong thì mảng chưa có — kích nạp rồi trả về những gì đang có, để lần
    // đọc sau đã đủ. Trả rỗng mà im lặng thì người dùng thấy kho mẫu trống rỗng không hiểu vì sao.
    var getBundled = typeof cfg.getBundled === 'function' ? cfg.getBundled
      : function () {
        var arr = (typeof window !== 'undefined' && window.BUNDLED_TEMPLATES) || [];
        if (!arr.length && typeof window !== 'undefined' && window.WorkflowTemplateList) {
          try { window.WorkflowTemplateList.ensureBundledTemplates(); } catch (_e) { /* nạp sau */ }
        }
        return arr;
      };
    var now = typeof cfg.now === 'function' ? cfg.now : function () { return new Date().toISOString(); };
    var _seq = 0;
    var genId = typeof cfg.genId === 'function' ? cfg.genId
      : function () { return PREFIX + Date.now() + '_' + (Math.random().toString(36).slice(2, 8)) + (_seq++); };

    function readAll() {
      return Promise.resolve(area.get(KEY)).then(function (r) {
        var a = r && r[KEY];
        return Array.isArray(a) ? a : [];
      });
    }
    function writeAll(list) {
      var patch = {}; patch[KEY] = list;
      return Promise.resolve(area.set(patch)).then(function () { return list; });
    }

    function list() { return readAll(); }
    function get(id) {
      var s = String(id);
      return readAll().then(function (l) {
        return l.find(function (t) { return String(t.id) === s; }) || null;
      });
    }

    // Chuẩn hóa record template user (đủ field cho gallery + editor).
    function normalize(tpl, keepId, keepCreated) {
      tpl = tpl || {};
      var id = keepId && isUserTemplateId(tpl.id) ? tpl.id : genId();
      return {
        id: id,
        name: tpl.name || 'Template của tôi',
        description: tpl.description || '',
        category_name: tpl.category_name || tpl.category || '',
        tags: Array.isArray(tpl.tags) ? tpl.tags : [],
        media_type: tpl.media_type || '',
        nodes: Array.isArray(tpl.nodes) ? tpl.nodes : [],
        edges: Array.isArray(tpl.edges) ? tpl.edges : [],
        thumbnail: tpl.thumbnail || tpl.thumbnail_url || '',
        _userTemplate: true,
        _forkedFrom: tpl._forkedFrom != null ? tpl._forkedFrom : null,
        created_at: keepCreated && tpl.created_at ? tpl.created_at : now(),
        updated_at: now()
      };
    }

    function saveNew(tpl) {
      var rec = normalize(tpl, false, false); // luôn cấp id mới
      return readAll().then(function (l) {
        var next = l.slice(); next.push(rec);
        return writeAll(next).then(function () { return rec; });
      });
    }

    function update(id, patch) {
      var s = String(id);
      return readAll().then(function (l) {
        var idx = l.findIndex(function (t) { return String(t.id) === s; });
        if (idx === -1) return null;
        var merged = normalize(Object.assign({}, l[idx], patch || {}, { id: l[idx].id }), true, true);
        merged.created_at = l[idx].created_at || merged.created_at;
        var next = l.slice(); next[idx] = merged;
        return writeAll(next).then(function () { return merged; });
      });
    }

    function remove(id) {
      var s = String(id);
      return readAll().then(function (l) {
        var next = l.filter(function (t) { return String(t.id) !== s; });
        if (next.length === l.length) return false;
        return writeAll(next).then(function () { return true; });
      });
    }

    // Tạo bản sao từ 1 template MẶC ĐỊNH (bundled) vào kho user. Bản gốc giữ nguyên.
    function forkFromBundled(bundledId) {
      var b = (getBundled() || []).find(function (t) { return String(t.id) === String(bundledId); });
      if (!b) return Promise.reject(new Error('Không tìm thấy template gốc id ' + bundledId));
      var clone = JSON.parse(JSON.stringify(b));
      clone.id = undefined;              // sẽ được cấp utpl_ mới
      clone._forkedFrom = b.id;
      clone.name = (b.name || 'Template') + ' (bản của tôi)';
      return saveNew(clone);
    }

    return {
      KEY: KEY, PREFIX: PREFIX,
      list: list, get: get, saveNew: saveNew, update: update, remove: remove,
      forkFromBundled: forkFromBundled, isUserTemplateId: isUserTemplateId
    };
  }

  // Adapter chrome.storage.local (callback) → area promise-based.
  function browserArea() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return null;
    var L = chrome.storage.local;
    function wrap(fn) {
      return function (arg) {
        return new Promise(function (res, rej) {
          try {
            fn.call(L, arg, function (r) {
              var e = (chrome.runtime && chrome.runtime.lastError);
              if (e) rej(new Error(e.message)); else res(r);
            });
          } catch (err) { rej(err); }
        });
      };
    }
    return { get: wrap(L.get), set: wrap(L.set), remove: wrap(L.remove) };
  }

  global.SEOSONA_UserTemplateStore = { KEY: KEY, PREFIX: PREFIX, create: create, isUserTemplateId: isUserTemplateId };

  // Instance mặc định gắn chrome.storage.local (dùng trong extension).
  var _area = browserArea();
  if (_area) global.UserTemplateStore = create({ area: _area });
})(typeof self !== 'undefined' ? self : this);
