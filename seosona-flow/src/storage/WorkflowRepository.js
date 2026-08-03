// SEOSONA Flow — Workflow Repository (Phase 5 / P5.T4, AUD-016).
// Classic script. Atomic, revision-checked workflow persistence so concurrent
// writers (two contexts / two tabs) cannot silently overwrite each other. Uses
// navigator.locks when available, otherwise a same-context promise-chain mutex.
(function (global) {
  'use strict';

  var LIST_KEY = 'af_workflows';
  var REV_KEY = 'af_workflows_rev';

  function create(storageArea, opts) {
    opts = opts || {};
    if (!storageArea || typeof storageArea.get !== 'function') {
      throw new Error('WorkflowRepository requires a storage area');
    }
    var lockName = opts.lockName || 'seosona-workflow-repo';
    var chain = Promise.resolve();

    function raw(cb) {
      // Serialize read-modify-write within this context.
      var run = function () { return Promise.resolve().then(cb); };
      var locks = global.navigator && global.navigator.locks;
      if (locks && typeof locks.request === 'function') {
        return locks.request(lockName, run);
      }
      var next = chain.then(run, run);
      chain = next.catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowRepository#run', _e); });
      return next;
    }

    function readInner() {
      return Promise.resolve(storageArea.get([LIST_KEY, REV_KEY])).then(function (res) {
        return { list: (res && res[LIST_KEY]) || [], revision: (res && res[REV_KEY]) || 0 };
      });
    }

    function load() { return raw(readInner); }

    // save(list, expectedRevision) -> { ok, revision } | { ok:false, conflict:true, revision }
    function save(list, expectedRevision) {
      return raw(function () {
        return readInner().then(function (cur) {
          if (expectedRevision != null && expectedRevision !== cur.revision) {
            return { ok: false, conflict: true, revision: cur.revision };
          }
          var nextRev = cur.revision + 1;
          var patch = {};
          patch[LIST_KEY] = list;
          patch[REV_KEY] = nextRev;
          return Promise.resolve(storageArea.set(patch)).then(function () {
            return { ok: true, revision: nextRev };
          });
        });
      });
    }

    // Convenience: upsert one workflow with optimistic concurrency + retry once.
    function upsert(workflow) {
      if (!workflow || !workflow.id) return Promise.reject(new Error('workflow.id required'));
      return load().then(function (cur) {
        var list = cur.list.slice();
        var idx = list.findIndex(function (w) { return w.id === workflow.id; });
        if (idx >= 0) list[idx] = workflow; else list.push(workflow);
        return save(list, cur.revision);
      });
    }

    return { load: load, save: save, upsert: upsert, LIST_KEY: LIST_KEY, REV_KEY: REV_KEY };
  }

  global.SEOSONA_WorkflowRepository = { create: create };
})(typeof self !== 'undefined' ? self : this);
