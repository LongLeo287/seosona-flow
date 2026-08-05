/**
 * Badminton_SourcePreserving_Edit_8K — workflow tham chiếu của chương 11.
 *
 * File này là ĐỊNH NGHĨA workflow, không phải bộ chạy. Nó khai báo 13 bước theo đúng thứ tự đặc
 * tả, nói rõ mỗi bước cần gì, trả gì, và — quan trọng nhất — bước nào CHẠY ĐƯỢC NGAY còn bước nào
 * đang chờ engine.
 *
 * Vì sao tách ra thay vì nhét thẳng vào BundledTemplates: workflow này có bước chưa chạy được.
 * Nhét vào kho mẫu chung là mời người dùng bấm Chạy rồi nhận lỗi giữa chừng. Ở đây nó là bản
 * thiết kế đọc được, kiểm được bằng test, và `runnablePrefix()` cho biết chạy tới đâu là dừng.
 *
 * Module thuần: không DOM, không mạng.
 */
(function (root) {
  'use strict';

  // engine: 'none'  → toán thuần, chạy trong trình duyệt
  //         'flow'  → nhờ tài khoản AI của người dùng qua Flow
  //         'local' → cần engine ảnh cục bộ (ComfyUI hoặc tương đương) — CHƯA CÓ
  var STEPS = [
    {
      id: 'src', node: 'image_input', engine: 'none', ready: true,
      role: 'Ảnh gốc — authority của cả workflow',
      out: ['image.asset'],
      impl: null,
    },
    {
      id: 'lock', node: 'source_lock', engine: 'none', ready: true,
      role: 'Băm ảnh gốc + chốt chính sách. Mọi bước sau đối chiếu với biên nhận này.',
      needs: ['src'],
      out: ['locked.image', 'sourceLock'],
      impl: 'SEOSONA_SourceLock.lock',
      params: { preserveOutsideMask: true, lockIdentity: true },
    },
    {
      id: 'preset', node: 'sport_preset', engine: 'none', ready: true,
      role: 'Nạp badminton.v1: ngưỡng, bố cục, lớp mask, prompt lớp B.',
      out: ['preset.config', 'prompt.layers'],
      impl: 'SEOSONA_SportPreset.resolve',
      params: { preset: 'badminton.v1' },
    },
    {
      id: 'reframe', node: 'canvas_reframe', engine: 'none', ready: true,
      role: 'Cắt/giãn về dọc 9:16 theo quy tắc bố cục §11. Sinh mask.border cho vùng mở rộng.',
      needs: ['lock', 'preset'],
      out: ['image.asset', 'mask.border'],
      impl: 'SEOSONA_CanvasReframe.plan',
      note: 'Chỉ TÍNH hình học và trả mask viền — không bịa pixel. Phần mở rộng là vùng DUY NHẤT '
        + 'được phép outpaint, và cũng là vùng duy nhất compare_diff được loại trừ khi đo trôi.',
    },
    {
      id: 'ref', node: 'image_reference', engine: 'none', ready: true,
      role: 'Ảnh tham chiếu cây vợt, role=equipment.',
      out: ['reference.asset[]'],
      impl: 'node entity_ref (đã có ROLES identity/motion/environment)',
      params: { referenceRole: 'equipment', applyReferenceOnlyInsideMask: true },
    },
    {
      id: 'mask', node: 'mask_editor', engine: 'local', ready: false,
      role: 'Vẽ mask theo lớp: face, hair, hand, racket, shuttle, border.',
      needs: ['reframe'],
      out: ['mask.asset'],
      impl: null,
      note: 'Vẽ tay thì canvas làm được; auto-select cần model phân vùng.',
    },
    {
      id: 'bind', node: 'object_region_bind', engine: 'local', ready: false,
      role: 'Ràng ảnh vợt tham chiếu VÀO đúng mask vợt, không ảnh hưởng ra ngoài.',
      needs: ['mask', 'ref'],
      out: ['conditioning.object'],
      impl: null,
    },
    {
      id: 'inpaint', node: 'localized_inpaint', engine: 'local', ready: false,
      role: 'Sửa TRONG mask. Đây là giá trị lõi của cả workflow.',
      needs: ['reframe', 'mask', 'bind', 'preset'],
      out: ['image.asset', 'receipt'],
      impl: null,
      params: { denoise: [0.18, 0.25], denoiseOverrideAbove: 0.35 },
      note: 'Flow KHÔNG nhận mask từ ngoài — không lách được bằng prompt.',
    },
    {
      id: 'face', node: 'face_cleanup', engine: 'local', ready: false,
      role: 'Retouch không đổi cấu trúc khuôn mặt.',
      needs: ['inpaint'],
      out: ['image.asset', 'receipt'],
      impl: null,
    },
    {
      id: 'finish', node: 'photo_finish', engine: 'none', ready: true,
      role: 'Grade không-sinh-ảnh: phơi sáng, tương phản, bão hoà, nét.',
      needs: ['face'],
      out: ['image.asset'],
      impl: 'SEOSONA_PhotoFinish.apply',
      params: { preset: 'indoor_sport' },
    },
    {
      id: 'upscale', node: 'upscale', engine: 'local', ready: false,
      role: 'Lên 4320x7680.',
      needs: ['finish'],
      out: ['image.asset'],
      impl: null,
      note: 'KHÔNG mượn Flow: trên Flow phóng to là thao tác bất đồng bộ và TỐN TÍN DỤNG. '
        + 'Chạy lại workflow là tiêu tiền mỗi lần. Phải dùng model upscale cục bộ.',
    },
    {
      id: 'diff', node: 'compare_diff', engine: 'none', ready: true,
      role: 'Đo trôi pixel + tính toàn vẹn mask, đối chiếu với bản đã khoá.',
      needs: ['lock', 'upscale', 'mask'],
      out: ['diff.report'],
      impl: 'SEOSONA_CompareDiff.evaluate',
    },
    {
      id: 'validate', node: 'sports_validator', engine: 'none', ready: true,
      role: 'Phán xét hợp lý về thể thao. Gate PASS/WARN/FAIL.',
      needs: ['diff'],
      out: ['validator.report'],
      impl: 'SEOSONA_SportsValidator.validate',
      params: { validator: 'badminton.v1' },
    },
  ];

  // §11: "Fail ngay" — các ca hỏng là hỏng, không thương lượng.
  var HARD_FAILS = [
    'thay mặt người khác',
    'tạo thêm vợt hoặc cầu',
    'đổi giày, áo hoặc sân',
    'đưa quả cầu xuống gần chân',
    'xuất full-frame không theo quy tắc bố cục',
  ];

  function steps() { return STEPS.map(function (s) { return s; }); }

  /** Các bước chạy được NGAY, tính từ đầu, dừng ở bước đầu tiên chưa sẵn sàng. */
  function runnablePrefix() {
    var out = [];
    for (var i = 0; i < STEPS.length; i++) {
      if (!STEPS[i].ready) break;
      out.push(STEPS[i].id);
    }
    return out;
  }

  /** Bước nào đang chờ engine cục bộ. */
  function blockedByEngine() {
    return STEPS.filter(function (s) { return s.engine === 'local' && !s.ready; })
      .map(function (s) { return s.id; });
  }

  /** Bước làm được ngay mà CHƯA viết — đây là việc còn lại của Lát 1. */
  function todoNoEngine() {
    return STEPS.filter(function (s) { return s.engine === 'none' && !s.ready; })
      .map(function (s) { return s.id; });
  }

  /** Kiểm phụ thuộc: mọi `needs` phải trỏ tới bước có thật và đứng TRƯỚC. */
  function validateGraph() {
    var seen = {};
    var problems = [];
    for (var i = 0; i < STEPS.length; i++) {
      var s = STEPS[i];
      var needs = s.needs || [];
      for (var j = 0; j < needs.length; j++) {
        if (!seen[needs[j]]) problems.push(s.id + ' cần ' + needs[j] + ' nhưng bước đó chưa chạy');
      }
      seen[s.id] = true;
    }
    return { ok: problems.length === 0, problems: problems };
  }

  root.SEOSONA_BadmintonWorkflow = {
    name: 'Badminton_SourcePreserving_Edit_8K',
    STEPS: STEPS,
    HARD_FAILS: HARD_FAILS,
    steps: steps,
    runnablePrefix: runnablePrefix,
    blockedByEngine: blockedByEngine,
    todoNoEngine: todoNoEngine,
    validateGraph: validateGraph,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
