// SEOSONA Flow — Workflow Store (Phase 4 / P4.T5, AUD-012).
// Headless facade over workflow persistence, built on an injected StorageService.
// DOM-free: the workflow list/CRUD logic is testable without a browser.
(function (global) {
  'use strict';

  var KEY = 'af_workflows';

  function create(storageService) {
    if (!storageService || typeof storageService.get !== 'function') {
      throw new Error('WorkflowStore requires a StorageService');
    }

    function list() { return storageService.get(KEY, []); }

    function save(workflow) {
      if (!workflow || !workflow.id) return Promise.reject(new Error('workflow.id required'));
      return list().then(function (all) {
        var idx = all.findIndex(function (w) { return w.id === workflow.id; });
        if (idx >= 0) all[idx] = workflow; else all.push(workflow);
        return storageService.set(KEY, all).then(function () { return workflow; });
      });
    }

    function remove(id) {
      return list().then(function (all) {
        var next = all.filter(function (w) { return w.id !== id; });
        return storageService.set(KEY, next).then(function () { return all.length - next.length; });
      });
    }

    function getById(id) {
      return list().then(function (all) { return all.find(function (w) { return w.id === id; }) || null; });
    }

    return { list: list, save: save, remove: remove, getById: getById, KEY: KEY };
  }

  global.SEOSONA_WorkflowStore = { create: create };
})(typeof self !== 'undefined' ? self : this);
