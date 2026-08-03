// SEOSONA Flow — Diagnostics Panel view-model (Phase 10 / P10.T2, AUD-030).
// Classic script, pure. Turns a diagnostics preview/bundle into a render-ready
// view-model that ALWAYS shows the "local export only, never uploaded" contract.
(function (global) {
  'use strict';
  function toViewModel(preview) {
    preview = preview || { sections: [], bytes: 0, checksum: '' };
    return {
      sections: preview.sections || [],
      sizeLabel: (Math.round((preview.bytes || 0) / 102.4) / 10) + ' KB',
      checksum: preview.checksum || '',
      uploadNotice: 'This bundle is saved locally and is never uploaded automatically.',
      canExport: (preview.sections || []).length > 0,
    };
  }
  global.SEOSONA_DiagnosticsPanel = { toViewModel: toViewModel };
})(typeof self !== 'undefined' ? self : this);
