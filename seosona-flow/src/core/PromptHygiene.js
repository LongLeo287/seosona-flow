// SEOSONA Flow — vệ sinh prompt + sửa media_id hỏng (Đòn 7).
//
// Hai việc nhỏ nhưng gặp hằng ngày:
//
// 1. Veo mặc định hay tự thêm NHẠC NỀN vào video. Với hướng "Flow gen video câm để
//    SEOSONA Video AI V2 lồng tiếng", nhạc nền là rác — phải đè giọng đọc lên, hoặc
//    phải bỏ cả clip. Một câu chèn vào cuối prompt là xong.
//
// 2. media_id đôi khi về dạng "CAMS…" thay vì UUID. Node hạ lưu dùng chuỗi đó làm ref
//    sẽ nhận "Requested entity was not found" — lỗi khó hiểu, không ai đoán được là do
//    định dạng id.
//
// Classic script, thuần → test trực tiếp.
(function (global) {
  'use strict';

  // Câu chốt âm thanh. Giữ tiếng Anh vì model bám tiếng Anh chắc hơn cho chỉ dẫn kỹ thuật.
  var AUDIO_CLAUSE = 'no background music, keep natural sound effects';

  // Dấu hiệu người dùng ĐÃ tự nói về nhạc/âm thanh → tôn trọng, không chèn đè.
  var AUDIO_MENTION = /(background music|nhạc nền|soundtrack|no music|không nhạc|sound effect|hiệu ứng âm thanh|voiceover|lồng tiếng)/i;

  /**
   * Chèn câu chuẩn hoá âm thanh vào prompt video.
   * KHÔNG chèn khi: prompt rỗng, đã có câu này, hoặc người dùng đã tự nói về âm thanh.
   */
  function normalizeVideoAudio(prompt, opts) {
    opts = opts || {};
    var clause = opts.clause || AUDIO_CLAUSE;
    var text = String(prompt == null ? '' : prompt);
    if (!text.trim()) return text;
    if (text.toLowerCase().indexOf(clause.toLowerCase()) !== -1) return text;
    if (!opts.force && AUDIO_MENTION.test(text)) return text;
    var sep = /[.\n]\s*$/.test(text) ? ' ' : '. ';
    return text.replace(/\s+$/, '') + sep + clause + '.';
  }

  var UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  function isUuid(id) {
    var s = String(id == null ? '' : id);
    return UUID_RE.test(s) && s.replace(/^\s+|\s+$/g, '').length === 36;
  }

  /**
   * Rút UUID ra khỏi media_id lộn xộn (vd "CAMS_xxx/<uuid>", "CAMS…<uuid>…").
   * Không tìm thấy UUID thì trả null — CỐ TÌNH không trả lại chuỗi gốc, để nơi gọi
   * buộc phải xử lý thay vì lặng lẽ truyền tiếp một id hỏng.
   */
  function extractUuid(id) {
    var s = String(id == null ? '' : id);
    var m = s.match(UUID_RE);
    return m ? m[0].toLowerCase() : null;
  }

  /** @returns {{ok:boolean, id:string|null, fixed:boolean, reason:string|null}} */
  function repairMediaId(id) {
    var s = String(id == null ? '' : id).trim();
    if (!s) return { ok: false, id: null, fixed: false, reason: 'EMPTY' };
    if (isUuid(s)) return { ok: true, id: s.toLowerCase(), fixed: false, reason: null };
    var u = extractUuid(s);
    if (u) return { ok: true, id: u, fixed: true, reason: 'EXTRACTED_FROM_' + (s.slice(0, 4).toUpperCase() || 'RAW') };
    return { ok: false, id: null, fixed: false, reason: 'NO_UUID_FOUND' };
  }

  /** Sửa cả loạt; trả kèm danh sách hỏng để báo đích danh thay vì im lặng bỏ. */
  function repairMany(ids) {
    var out = { ids: [], fixed: 0, broken: [] };
    (ids || []).forEach(function (raw) {
      var r = repairMediaId(raw);
      if (r.ok) { out.ids.push(r.id); if (r.fixed) out.fixed += 1; }
      else out.broken.push(String(raw == null ? '' : raw));
    });
    return out;
  }

  global.PromptHygiene = {
    AUDIO_CLAUSE: AUDIO_CLAUSE,
    normalizeVideoAudio: normalizeVideoAudio,
    isUuid: isUuid,
    extractUuid: extractUuid,
    repairMediaId: repairMediaId,
    repairMany: repairMany,
  };
})(typeof self !== 'undefined' ? self : this);
