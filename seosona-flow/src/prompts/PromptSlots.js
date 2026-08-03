/**
 * PromptSlots — với mỗi prompt có {placeholder}, gợi VÍ DỤ ĐIỀN sẵn (pattern "slot + example fill" của
 * Claude prompt-library). Tính LIVE từ content → không phải sửa 364 entry BundledPrompts.
 *
 * API:
 *   PromptSlots.placeholders(content) -> ['subject','ratio',...]   (unique, giữ thứ tự xuất hiện)
 *   PromptSlots.examplesFor(content)  -> [{ name, example }]        (example lấy từ MAP, else gợi ý generic)
 *   PromptSlots.hint(content)         -> 'subject = cô gái 20 tuổi… · ratio = 9:16'  (1 dòng cho UI)
 */
(function (root) {
  'use strict';

  // Ví dụ điền tiếng Việt cho các placeholder hay gặp trong kho prompt ảnh/video.
  var MAP = {
    subject: 'cô gái 20 tuổi, tóc dài, áo dài trắng',
    character: 'chàng trai mặc vest xám, đeo kính',
    product: 'lọ serum dưỡng da, thủy tinh trong',
    scene: 'quán cà phê bên cửa sổ, buổi sáng',
    location: 'phố cổ Hội An, đèn lồng',
    background: 'nền xám seamless',
    bg_color: 'be nhạt',
    color: 'xanh navy',
    palette: 'tông đất ấm (nâu, cam cháy, kem)',
    style: 'ảnh thật 35mm (film)',
    mood: 'ấm áp, hoài niệm',
    emotion: 'vui, tự tin',
    lighting: 'ngược sáng hoàng hôn, rim light viền tóc',
    time: 'giờ vàng chiều',
    action: 'đang cười, tay cầm ly cà phê',
    outfit: 'áo len cáp xám, khăn quàng',
    angle: 'góc ngang tầm mắt',
    camera: 'Canon 85mm',
    lens: '85mm f/1.8',
    ratio: '9:16',
    aspect: '9:16',
    brand: 'SEOSONA',
    text: 'GIẢM 50%',
    topic: 'chăm sóc da mùa hanh khô',
    number: '3',
    n: '3',
    // bổ sung theo tần suất thật trong kho 364 prompt
    colors: 'xanh navy, kem, cam đất',
    seconds: '8',
    language: 'Tiếng Việt',
    setting: 'quán cà phê bên cửa sổ, buổi sáng',
    prompt: 'chân dung studio, ánh sáng mềm',
    theme: 'mùa thu Hà Nội',
    concept: 'tối giản, sang trọng',
    idea: 'ra mắt serum dưỡng mới',
    audience: 'nữ 25–34, quan tâm skincare',
    time_of_day: 'giờ vàng chiều',
    project: 'chiến dịch Tết',
    title: 'GIẢM 50% CUỐI TUẦN',
    platform: 'Instagram Reels',
    thing: 'đàn ong khổng lồ',
    before: 'da xỉn màu, lỗ chân lông to',
    direction: 'trái và phải',
  };

  var RE = /\{([a-z0-9_]+)\}/gi;

  function placeholders(content) {
    var s = String(content == null ? '' : content);
    var seen = {}, out = []; RE.lastIndex = 0; var m;
    while ((m = RE.exec(s)) !== null) {
      var k = m[1].toLowerCase();
      if (!seen[k]) { seen[k] = 1; out.push(k); }
    }
    return out;
  }

  function exampleFor(name) {
    if (MAP[name]) return MAP[name];
    // generic theo hậu tố hay gặp
    if (/color$|_mau$/.test(name)) return 'xanh navy';
    if (/name$|_ten$/.test(name)) return 'Minh';
    if (/count$|num|_so$/.test(name)) return '3';
    return '…'; // chưa có ví dụ → để user tự điền
  }

  function examplesFor(content) {
    return placeholders(content).map(function (n) { return { name: n, example: exampleFor(n) }; });
  }

  function hint(content) {
    var ex = examplesFor(content);
    if (!ex.length) return '';
    return ex.map(function (e) { return e.name + ' = ' + e.example; }).join(' · ');
  }

  root.PromptSlots = { placeholders: placeholders, examplesFor: examplesFor, hint: hint, MAP: MAP };
})(typeof self !== 'undefined' ? self : this);
