/**
 * SportsValidator — phán xét HỢP LÝ VỀ THỂ THAO, tách hẳn khỏi đo pixel.
 *
 * Chương 10 của đặc tả nói thẳng vì sao phải tách: "một ảnh có pixel drift thấp vẫn có thể sai
 * hoàn toàn về thể thao". Cầm vợt ngược tay, hai quả cầu trong khung, chân trụ sai — pixel gần
 * như không đổi mà ảnh vẫn vứt đi. Ngược lại một ảnh trôi nhiều vì mở rộng khung vẫn có thể đúng.
 *
 * Module này KHÔNG nhìn ảnh. Nó nhận các quan sát đã đo được (từ compare diff, từ mô hình chấm,
 * hoặc từ chính người dùng đánh dấu) rồi áp luật. Tách như vậy để:
 *   · luật kiểm được bằng test thuần, không cần ảnh thật;
 *   · nguồn quan sát đổi (người → mô hình → pose keypoints) mà luật không phải viết lại.
 *
 * Luật đăng ký theo môn. `badminton.v1` là bộ đầu tiên vì đặc tả lấy cầu lông làm acceptance test.
 */
(function (root) {
  'use strict';

  var SEVERITY = { critical: 3, major: 2, minor: 1 };

  /**
   * Một luật = { id, severity, needs, check(obs) -> true|false|null }
   *   needs : tên các quan sát BẮT BUỘC phải có. Thiếu → SKIP, KHÔNG phải PASS.
   *   check : trả null nghĩa là "không kết luận được" → SKIP.
   *
   * Phân biệt SKIP với PASS là điểm quan trọng nhất của file này: một cổng chất lượng báo PASS
   * cho phép kiểm nó chưa từng chạy là cổng nói dối, và đó đúng là loại "xanh giả" mà báo cáo
   * audit đã bắt ở chỗ khác trong dự án này.
   */
  var RULES = {
    'badminton.v1': [
      {
        id: 'identity_lock', severity: 'critical', needs: ['identityDistance'],
        check: function (o) { return o.identityDistance <= 0.08; },
        detail: 'khuôn mặt phải giữ nhận dạng (khoảng cách <= 0.08)',
      },
      {
        id: 'outside_mask_drift', severity: 'critical', needs: ['outsideDriftRatio'],
        check: function (o) { return o.outsideDriftRatio <= 0.015; },
        detail: 'ngoài vùng mask không được đổi quá 1,5%',
      },
      {
        id: 'mask_integrity', severity: 'critical', needs: ['leakedPixels'],
        check: function (o) { return o.leakedPixels === 0; },
        detail: 'mọi thay đổi phải nằm trong mask',
      },
      {
        id: 'single_racket', severity: 'critical', needs: ['racketCount'],
        check: function (o) { return o.racketCount === 1; },
        detail: 'đúng một cây vợt — mô hình hay vẽ thừa cây thứ hai',
      },
      {
        id: 'single_shuttle', severity: 'critical', needs: ['shuttleCount'],
        check: function (o) { return o.shuttleCount <= 1; },
        detail: 'nhiều nhất một quả cầu trong khung',
      },
      {
        id: 'racket_grip', severity: 'major', needs: ['gripValid'],
        check: function (o) { return o.gripValid === true; },
        detail: 'tay cầm đúng chiều, ngón không xuyên qua cán',
      },
      {
        id: 'string_bed', severity: 'major', needs: ['stringBedIntact'],
        check: function (o) { return o.stringBedIntact === true; },
        detail: 'mặt lưới vợt liền, không rách/không rỗng',
      },
      {
        id: 'no_overlay', severity: 'critical', needs: ['overlayCount'],
        check: function (o) { return o.overlayCount === 0; },
        detail: 'không chữ lạ, watermark hay viền thừa',
      },
      {
        id: 'resolution', severity: 'major', needs: ['width', 'height'],
        check: function (o, cfg) {
          if (!cfg || !cfg.minWidth) return o.width > 0 && o.height > 0;
          return o.width >= cfg.minWidth && o.height >= cfg.minHeight;
        },
        detail: 'đủ độ phân giải theo preset',
      },
      {
        id: 'mechanics', severity: 'major', needs: ['mechanicsPass'],
        check: function (o) { return o.mechanicsPass === true; },
        detail: 'tư thế đánh hợp lý (checklist hoặc pose keypoints)',
      },
    ],
  };

  function listSports() { return Object.keys(RULES); }

  /** Cho phép bổ sung môn khác mà không sửa file này. */
  function register(name, rules) {
    if (!name || !Array.isArray(rules)) throw new Error('SportsValidator: luật không hợp lệ');
    RULES[name] = rules;
  }

  /**
   * @param {string} sport  ví dụ 'badminton.v1'
   * @param {object} obs    các quan sát đã đo được
   * @param {object} [cfg]  ngưỡng theo preset (minWidth/minHeight...)
   */
  function validate(sport, obs, cfg) {
    var rules = RULES[sport];
    if (!rules) {
      return {
        schema: 'seosona.sports.validator.v1',
        validator: sport || null,
        gate: 'FAIL',
        checks: [{ id: 'unknown_sport', status: 'FAIL', detail: 'chưa có bộ luật cho môn này' }],
        summary: { pass: 0, fail: 1, skip: 0 },
      };
    }
    obs = obs || {};
    var checks = [];
    var pass = 0, fail = 0, skip = 0;

    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      var missing = (r.needs || []).filter(function (k) {
        return obs[k] === undefined || obs[k] === null;
      });
      if (missing.length) {
        skip++;
        checks.push({
          id: r.id, severity: r.severity, status: 'SKIP',
          detail: 'thiếu quan sát: ' + missing.join(', '),
        });
        continue;
      }
      var ok;
      try { ok = r.check(obs, cfg); } catch (_) { ok = null; }
      if (ok === null || ok === undefined) {
        skip++;
        checks.push({ id: r.id, severity: r.severity, status: 'SKIP', detail: 'không kết luận được' });
        continue;
      }
      if (ok) { pass++; checks.push({ id: r.id, severity: r.severity, status: 'PASS' }); }
      else { fail++; checks.push({ id: r.id, severity: r.severity, status: 'FAIL', detail: r.detail }); }
    }

    // Cổng: hỏng một luật CRITICAL là FAIL. Hỏng major là WARN. Có SKIP cũng là WARN — vì
    // "chưa kiểm" không được phép trông giống "đã đạt".
    var criticalFail = checks.some(function (c) { return c.status === 'FAIL' && c.severity === 'critical'; });
    var anyFail = fail > 0;
    var gate = criticalFail ? 'FAIL' : (anyFail || skip > 0 ? 'WARN' : 'PASS');

    return {
      schema: 'seosona.sports.validator.v1',
      validator: sport,
      gate: gate,
      checks: checks,
      summary: { pass: pass, fail: fail, skip: skip },
    };
  }

  /** Gộp kết quả compare diff vào bộ quan sát, để hai lớp nối được với nhau. */
  function observationsFromDiff(diff) {
    var out = {};
    if (!diff || !Array.isArray(diff.checks)) return out;
    for (var i = 0; i < diff.checks.length; i++) {
      var c = diff.checks[i];
      if (c.id === 'mask_integrity' && typeof c.leakedPixels === 'number') out.leakedPixels = c.leakedPixels;
      if (c.id === 'outside_mask_drift' && typeof c.score === 'number') out.outsideDriftRatio = c.score;
      if (c.id === 'resolution' && c.width) { out.width = c.width; out.height = c.height; }
    }
    return out;
  }

  root.SEOSONA_SportsValidator = {
    SEVERITY: SEVERITY,
    listSports: listSports,
    register: register,
    validate: validate,
    observationsFromDiff: observationsFromDiff,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
