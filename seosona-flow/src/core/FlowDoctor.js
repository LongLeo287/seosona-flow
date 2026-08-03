// SEOSONA Flow — Bác sĩ: tra lỗi Flow ra QUY TRÌNH KHÔI PHỤC (Đòn 6).
//
// Trước đây ta phân loại được 6 mã lỗi Flow rồi đổ ra toast — tức mới dừng ở BÁO.
// Người dùng đọc "Google phát hiện hoạt động bất thường" xong vẫn không biết làm gì,
// và thường phản xạ sai nhất: bấm chạy lại ngay, khiến bị gắn cờ nặng hơn.
//
// PHẠM VI: đây là hướng dẫn KHÔI PHỤC phiên hợp lệ (đăng nhập lại, chạy chậm lại,
// đổi hướng nội dung cho hợp chính sách). KHÔNG bao gồm kỹ thuật né phát hiện hay
// lách bộ lọc an toàn.
//
// Classic script, thuần → test trực tiếp.
(function (global) {
  'use strict';

  // severity: 'stop' = ngưng gửi ngay | 'wait' = chờ rồi tự hết | 'fix' = sửa rồi chạy lại
  var BOOK = {
    bot_detected: {
      title: 'Google tạm chặn phiên (hoạt động bất thường)',
      severity: 'stop',
      cause: 'Google đánh dấu phiên là tự động: gửi quá dày, IP dùng chung/VPN, hoặc phiên đăng nhập đã cũ.',
      steps: [
        'Dừng mọi thứ đang chạy — gửi tiếp chỉ làm bị gắn cờ nặng thêm.',
        'Chrome → Cài đặt → Quyền riêng tư → Cookie → tìm "google.com" và "labs.google", xoá cookie của cả hai.',
        'Mở lại labs.google/fx/tools/flow và đăng nhập THỦ CÔNG, tự giải captcha nếu có.',
        'Chạy lại chậm hơn — phần giới hạn tốc độ đã tự ép giãn cách, đừng chỉnh xuống.',
        'Vẫn bị chặn → đổi mạng (tắt VPN / dùng 4G) hoặc nghỉ 1–6 giờ.',
      ],
      prevent: 'Đừng mở nhiều tab Flow cùng gửi. Chạy lô lớn thì để giãn cách mặc định.',
    },
    captcha: {
      title: 'Cần xác minh captcha',
      severity: 'stop',
      cause: 'Flow yêu cầu xác minh trước khi tạo tiếp.',
      steps: [
        'Mở tab Flow, giải captcha bằng tay.',
        'Quay lại và bấm tiếp — hàng đợi đã TẠM DỪNG chứ không xoá, các việc còn lại vẫn còn.',
      ],
      prevent: 'Giữ một tab Flow mở sẵn và đã đăng nhập trong lúc chạy.',
    },
    captcha_failed: {
      title: 'Giải captcha không thành',
      severity: 'stop',
      cause: 'Không có tab Flow để xác minh, hoặc phiên đã hết hạn.',
      steps: [
        'Mở một tab labs.google/fx/tools/flow trong CÙNG cửa sổ Chrome đang dùng.',
        'Đăng nhập nếu bị hỏi, rồi chạy lại.',
      ],
      prevent: null,
    },
    quota_exceeded: {
      title: 'Hết hạn mức trong ngày',
      severity: 'wait',
      cause: 'Đã dùng hết credit của gói trong ngày.',
      steps: [
        'Xem số dư ở thanh credit trên sidebar.',
        'Chờ reset theo ngày, hoặc nâng gói.',
        'Trong lúc chờ: hạ model xuống bản nhẹ để tốn ít credit hơn.',
      ],
      prevent: 'Chạy lô lớn thì để ý số dư trước khi bắt đầu.',
    },
    tier_restricted: {
      title: 'Gói hiện tại không dùng được model/tính năng này',
      severity: 'fix',
      cause: 'Model hoặc thao tác (vd nâng cấp 4K) yêu cầu gói cao hơn.',
      steps: [
        'Đổi sang model mà gói đang có.',
        'Nâng cấp 4K cần gói cao — bỏ bước đó hoặc nâng gói.',
      ],
      prevent: null,
    },
    content_blocked: {
      title: 'Nội dung bị chính sách an toàn từ chối',
      severity: 'fix',
      cause: 'Prompt hoặc ảnh chạm chính sách an toàn của Google (thường là người có thật, thương hiệu, nội dung nhạy cảm).',
      steps: [
        'Đổi sang nhân vật TỰ NGHĨ thay vì người có thật — mô tả đặc điểm bạn muốn thay vì gọi tên ai đó.',
        'Bỏ tên thương hiệu, logo, khẩu hiệu có bản quyền khỏi prompt.',
        'Nếu là ảnh đầu vào bị chặn: đổi ảnh khác.',
        'Viết lại phần bị chặn theo hướng trung tính hơn rồi chạy lại.',
      ],
      prevent: 'Dựng nhân vật riêng bằng Bảng thực thể — vừa hợp chính sách vừa giữ nhận diện xuyên suốt.',
    },
    media_expired: {
      title: 'Ảnh tham chiếu đã hết hạn',
      severity: 'fix',
      cause: 'Link ảnh của Google có hạn (khoảng 1 giờ). Workflow chạy lâu thì ref cũ hết hiệu lực.',
      steps: [
        'Chạy lại node tạo ảnh gốc để có ref mới.',
        'Với workflow dài: gen ảnh gốc rồi chạy cảnh ngay, đừng để cách nhau hàng giờ.',
      ],
      prevent: 'Chia workflow dài thành nhiều lượt ngắn.',
    },
    rate_limit: {
      title: 'Gửi quá nhanh',
      severity: 'wait',
      cause: 'Vượt tốc độ cho phép trong thời gian ngắn.',
      steps: [
        'Không cần làm gì — hệ thống tự giãn dần (10s → 20s → 40s…) rồi chạy tiếp.',
        'Nếu lặp lại nhiều: giảm số việc chạy song song.',
      ],
      prevent: null,
    },
  };

  // Bí danh: tên trong phân loại nội bộ ↔ tên theo mã API.
  var ALIAS = { policy: 'content_blocked', quota: 'quota_exceeded', entity_not_found: 'media_expired' };

  function lookup(category) {
    var k = String(category || '').toLowerCase();
    k = ALIAS[k] || k;
    var e = BOOK[k];
    if (!e) return null;
    return {
      key: k, title: e.title, severity: e.severity, cause: e.cause,
      steps: e.steps.slice(), prevent: e.prevent,
    };
  }

  function categories() { return Object.keys(BOOK).sort(); }

  /**
   * Tự kiểm: bốn thứ hay hỏng nhất, kèm cách sửa cho từng cái.
   * Nhận hàm dò từ bên ngoài để module này vẫn thuần (test không cần chrome).
   * @param {{flowTab:Function, loggedIn:Function, contentScript:Function, credits:Function}} probes
   */
  async function selfCheck(probes) {
    probes = probes || {};
    var checks = [
      { id: 'flowTab', label: 'Có tab Google Flow đang mở', fix: 'Mở labs.google/fx/tools/flow' },
      { id: 'loggedIn', label: 'Đã đăng nhập Google', fix: 'Đăng nhập trong tab Flow' },
      { id: 'contentScript', label: 'Tiện ích kết nối được với tab Flow', fix: 'Nhấn F5 trên tab Flow (sau khi tải lại tiện ích, tab cũ mất kết nối)' },
      { id: 'credits', label: 'Còn credit', fix: 'Chờ reset theo ngày hoặc nâng gói' },
    ];
    var out = [];
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i];
      var ok = false, detail = null;
      try {
        var r = probes[c.id] ? await probes[c.id]() : null;
        if (r && typeof r === 'object') { ok = !!r.ok; detail = r.detail || null; }
        else ok = !!r;
      } catch (e) { ok = false; detail = (e && e.message) || 'không kiểm được'; }
      out.push({ id: c.id, label: c.label, ok: ok, detail: detail, fix: ok ? null : c.fix });
    }
    return { ok: out.every(function (c) { return c.ok; }), checks: out };
  }

  global.FlowDoctor = { BOOK: BOOK, ALIAS: ALIAS, lookup: lookup, categories: categories, selfCheck: selfCheck };
})(typeof self !== 'undefined' ? self : this);
