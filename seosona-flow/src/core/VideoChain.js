// SEOSONA Flow — Nối cảnh (video chaining).
//
// Ý tưởng: cảnh N dùng ảnh của chính nó làm khung ĐẦU và ảnh của cảnh N+1 làm khung
// CUỐI. Khung cuối của video N khớp khung đầu của video N+1 → ghép lại thấy liền mạch,
// không giật cảnh.
//
// CÁI GIÁ, phải nói trước: chỗ nối bị 10–16 KHUNG TĨNH TRÙNG (~0,4–0,7s) vì hai video
// cùng đi qua một khung. Nối tất tần tật thì video thành ra giật cục đều đặn. Cho nên:
//   - ĐỔI BỐI CẢNH thì để ROOT (cắt cứng) — cắt cứng ở chỗ đổi cảnh là ngôn ngữ điện
//     ảnh bình thường, người xem không thấy sai.
//   - Chỉ nối trong cùng một bối cảnh, và cắt bớt phần chồng khi ghép.
//
// Classic script, thuần, không DOM/không mạng → test trực tiếp.
(function (global) {
  'use strict';

  var ROOT = 'ROOT';            // cắt cứng, không nối với cảnh trước
  var CONTINUATION = 'CONTINUATION'; // nối tiếp cảnh trước

  // Đo từ thực tế của flowkit; dùng để cảnh báo và để tính lượng cần cắt khi ghép.
  var OVERLAP_FRAMES = { min: 10, max: 16 };
  var FPS = 24;

  function overlapSeconds(fps) {
    var f = fps || FPS;
    return { min: +(OVERLAP_FRAMES.min / f).toFixed(2), max: +(OVERLAP_FRAMES.max / f).toFixed(2) };
  }

  function chainTypeOf(scene) {
    var t = String((scene && scene.chain_type) || ROOT).toUpperCase();
    return t === CONTINUATION ? CONTINUATION : ROOT;
  }

  /**
   * Dựng kế hoạch nối từ danh sách cảnh THEO THỨ TỰ.
   * Cảnh CONTINUATION lấy ảnh của cảnh KẾ TIẾP làm khung cuối. Cảnh cuối cùng của một
   * đoạn nối không có cảnh sau → tự động thành cắt cứng (không có gì để nối tới).
   *
   * @param {Array<{id,image,chain_type,location}>} scenes
   * @returns {{steps:Array, warnings:Array<string>, chains:number}}
   */
  function plan(scenes) {
    var list = Array.isArray(scenes) ? scenes : [];
    var steps = [];
    var warnings = [];
    var chains = 0;

    for (var i = 0; i < list.length; i++) {
      var s = list[i] || {};
      var next = list[i + 1];
      var type = chainTypeOf(s);
      var step = {
        id: s.id, index: i, mode: 'single',
        startImage: s.image || null, endImage: null,
      };

      if (type === CONTINUATION) {
        if (!next) {
          // Cảnh cuối không có gì để nối tới — hạ về cắt cứng thay vì lỗi.
          warnings.push('Cảnh cuối "' + (s.id || i) + '" đặt CONTINUATION nhưng không có cảnh sau → dùng cắt cứng.');
        } else if (!next.image) {
          warnings.push('Cảnh "' + (s.id || i) + '" không nối được: cảnh sau chưa có ảnh.');
        } else if (!s.image) {
          warnings.push('Cảnh "' + (s.id || i) + '" không nối được: chính nó chưa có ảnh.');
        } else {
          step.mode = 'chain';
          step.endImage = next.image;
          chains += 1;
          // Cảnh báo đúng chỗ đau: nối qua ranh giới bối cảnh thì khung trùng lộ rõ.
          if (s.location && next.location && s.location !== next.location) {
            warnings.push('Cảnh "' + (s.id || i) + '" nối sang bối cảnh khác ("' + s.location
              + '" → "' + next.location + '"). Đổi bối cảnh nên để ROOT (cắt cứng).');
          }
        }
      }
      steps.push(step);
    }

    if (chains > 0) {
      var ov = overlapSeconds();
      warnings.push('Có ' + chains + ' chỗ nối: mỗi chỗ dôi ' + OVERLAP_FRAMES.min + '–' + OVERLAP_FRAMES.max
        + ' khung tĩnh trùng (~' + ov.min + '–' + ov.max + 's). Cắt bớt phần chồng khi ghép.');
    }
    return { steps: steps, warnings: warnings, chains: chains };
  }

  /** Tổng thời lượng dôi ra do khung trùng — dùng để trừ khi khớp video với giọng đọc. */
  function totalOverlapSeconds(chainCount, fps) {
    var ov = overlapSeconds(fps);
    var n = Math.max(0, Number(chainCount) || 0);
    return { min: +(ov.min * n).toFixed(2), max: +(ov.max * n).toFixed(2) };
  }

  global.VideoChain = {
    ROOT: ROOT,
    CONTINUATION: CONTINUATION,
    OVERLAP_FRAMES: OVERLAP_FRAMES,
    FPS: FPS,
    chainTypeOf: chainTypeOf,
    overlapSeconds: overlapSeconds,
    plan: plan,
    totalOverlapSeconds: totalOverlapSeconds,
  };
})(typeof self !== 'undefined' ? self : this);
