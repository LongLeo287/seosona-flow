// SEOSONA Flow — Ghép ảnh: dán ảnh GỐC đè lên kết quả outpaint.
//
// VÌ SAO CẦN: prompt kiểu "absolutely do not modify the original center image" là bất khả
// thi. Model khuếch tán tái sinh TOÀN khung — không câu chữ nào khoá được pixel. Viết
// thêm 80 lệnh cấm cũng không đổi được điều đó, chỉ làm loãng attention.
//
// Cách đúng là tách làm hai việc:
//   1. để model làm cái nó làm được — bịa phần RÌA chưa có;
//   2. để code làm cái nó làm chắc — dán lại phần TÂM nguyên bản, pixel y hệt.
//
// Phần toán (tính khung dán, kiểm tỉ lệ) thuần → test trực tiếp.
// Phần vẽ cần Canvas nên chỉ chạy trong trang.
(function (root) {
  'use strict';

  /**
   * Khung dán ảnh gốc vào giữa ảnh đã mở rộng.
   * Giữ NGUYÊN chiều cao gốc và chỉ căn ngang khi hai bên cùng tỉ lệ chiều cao —
   * nếu scale theo chiều cao thì tâm ảnh bị nội suy, tức là đã đổi pixel, hỏng mục đích.
   *
   * @param {{w:number,h:number}} base   ảnh đã outpaint
   * @param {{w:number,h:number}} orig   ảnh gốc
   * @param {{mode?:string}} opts        'center' (mặc định) | 'center-scale'
   * @returns {{x:number,y:number,w:number,h:number,scaled:boolean}|null}
   */
  function centerRect(base, orig, opts) {
    opts = opts || {};
    if (!base || !orig || !(base.w > 0) || !(base.h > 0) || !(orig.w > 0) || !(orig.h > 0)) return null;
    // Ảnh gốc to hơn khung nền ở chiều nào → không phải bài toán outpaint nữa.
    if (orig.w > base.w || orig.h > base.h) {
      if (opts.mode !== 'center-scale') return null;
      var k = Math.min(base.w / orig.w, base.h / orig.h);
      var sw = Math.round(orig.w * k), sh = Math.round(orig.h * k);
      return { x: Math.round((base.w - sw) / 2), y: Math.round((base.h - sh) / 2), w: sw, h: sh, scaled: true };
    }
    return {
      x: Math.round((base.w - orig.w) / 2),
      y: Math.round((base.h - orig.h) / 2),
      w: orig.w, h: orig.h, scaled: false,
    };
  }

  /**
   * Cảnh báo TRƯỚC khi ghép. Trả danh sách vấn đề để nêu ra thay vì ghép bừa rồi
   * người dùng tự phát hiện ảnh lệch.
   */
  function check(base, orig, opts) {
    var out = [];
    if (!base || !orig) return ['Thiếu ảnh nền hoặc ảnh gốc.'];
    var r = centerRect(base, orig, opts);
    if (!r) return ['Ảnh gốc lớn hơn ảnh nền — đây không phải outpaint. Kiểm tra lại thứ tự 2 đầu vào.'];
    if (r.scaled) out.push('Ảnh gốc bị thu nhỏ để vừa khung — tâm ảnh KHÔNG còn nguyên pixel.');
    if (Math.abs(base.h - orig.h) > 2) {
      out.push('Chiều cao lệch ' + Math.abs(base.h - orig.h) + 'px: outpaint đã đụng cả trên/dưới, không chỉ hai bên.');
    }
    if (base.w === orig.w) out.push('Ảnh nền không rộng hơn ảnh gốc — chưa mở rộng được gì.');
    // Lệch lẻ 1px thì mép dán rơi vào nửa pixel → viền mảnh. Nêu ra để còn chỉnh.
    if ((base.w - orig.w) % 2 !== 0) out.push('Chênh bề rộng lẻ (' + (base.w - orig.w) + 'px) — mép dán sẽ lệch nửa pixel một bên.');
    return out;
  }

  /**
   * Dán ảnh gốc đè lên ảnh nền. `feather` làm mềm MÉP DÁN vài pixel để hết đường chỉ,
   * nhưng mặc định = 0: mục đích của bước này là giữ pixel gốc, làm mềm là đã đổi.
   */
  async function paste(baseSrc, origSrc, opts) {
    opts = opts || {};
    if (typeof document === 'undefined') throw new Error('ImageComposite.paste cần môi trường browser (Canvas).');
    var base = await _load(baseSrc);
    var orig = await _load(origSrc);
    var rect = centerRect({ w: base.width, h: base.height }, { w: orig.width, h: orig.height }, opts);
    if (!rect) throw new Error('COMPOSITE_SIZE_MISMATCH: ảnh gốc lớn hơn ảnh nền.');

    var canvas = document.createElement('canvas');
    canvas.width = base.width; canvas.height = base.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(base, 0, 0);

    var feather = Math.max(0, Number(opts.feather) || 0);
    if (!feather) {
      ctx.drawImage(orig, rect.x, rect.y, rect.w, rect.h);
    } else {
      // Vẽ ảnh gốc qua một lớp mask mờ mép: giữ nguyên lõi, chỉ chuyển tiếp ở rìa.
      var tmp = document.createElement('canvas');
      tmp.width = rect.w; tmp.height = rect.h;
      var tctx = tmp.getContext('2d');
      tctx.drawImage(orig, 0, 0, rect.w, rect.h);
      tctx.globalCompositeOperation = 'destination-in';
      var g = tctx.createLinearGradient(0, 0, rect.w, 0);
      var f = Math.min(0.49, feather / rect.w);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(f, 'rgba(0,0,0,1)');
      g.addColorStop(1 - f, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      tctx.fillStyle = g; tctx.fillRect(0, 0, rect.w, rect.h);
      ctx.drawImage(tmp, rect.x, rect.y);
    }
    return canvas.toDataURL(opts.type || 'image/png');
  }

  function _load(src) {
    return new Promise(function (resolve, reject) {
      if (src && src.width && src.getContext) { resolve(src); return; }
      if (typeof Image === 'undefined') { reject(new Error('no-Image')); return; }
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('img-load-failed')); };
      img.src = src;
    });
  }

  root.ImageComposite = { centerRect: centerRect, check: check, paste: paste };
})(typeof window !== 'undefined' ? window : this);
