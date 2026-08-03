#!/usr/bin/env node
// Gate ĐỘC LẬP — chặn việc "học hỏi" trượt thành sao chép.
//
// Bối cảnh: hai sản phẩm cùng ngách (một bộ "bridge" đi kèm) đạt tốc độ bằng cách:
// bắt OAuth bearer từ header người dùng, GIẢ Origin/Referer để endpoint riêng của
// Google chấp nhận request, và tự thực thi reCAPTCHA trong trang. Chúng nhanh hơn,
// nhưng đổi lại người dùng bị gắn cờ phiên — và đó là thứ không sửa được bằng code.
//
// SEOSONA chọn lái giao diện. Gate này giữ cho lựa chọn đó không bị xói mòn dần:
// một lần "tạm thêm cho nhanh" là mất luôn ranh giới.
//
// Quét PRODUCT SOURCE (không quét tests/docs/scripts — nơi được phép mô tả để phân tích).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, trackedFiles } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const EXT = 'seosona-flow/';

// Chỉ mã CHẠY THẬT. tests/ và scripts/ được phép nhắc tên pattern để kiểm tra chính gate này.
function productFiles() {
  return trackedFiles(ROOT)
    .filter((p) => p.startsWith(EXT))
    .filter((p) => /\.(js|json|html)$/.test(p))
    .filter((p) => !p.startsWith(`${EXT}lib/`))
    .filter((p) => !p.startsWith(`${EXT}tests/`))
    .filter((p) => !p.startsWith(`${EXT}scripts/`))
    .filter((p) => !p.startsWith(`${EXT}docs/`))
    .filter((p) => !p.startsWith(`${EXT}artifacts/`))
    .filter((p) => !/gwr-bundle\.js$|watermark-alpha-data\.js$|\.min\.js$/.test(p));
}

export const RULES = [
  {
    id: 'bearer-interception',
    re: /onBeforeSendHeaders|onSendHeaders/,
    why: 'Đọc header request để lấy OAuth bearer của người dùng. Đây là ranh giới tin cậy '
       + 'không được vượt: token đó thuộc phiên Google của họ, không thuộc extension.',
  },
  {
    id: 'origin-spoof',
    // Khoá xuất hiện theo THỨ TỰ NÀO CŨNG ĐƯỢC trong rule DNR, nên khớp hai chiều.
    re: /"?(Referer|Origin)"?[\s\S]{0,120}?"?operation"?\s*:\s*"set"|"?operation"?\s*:\s*"set"[\s\S]{0,120}?"?(Referer|Origin)"?/i,
    why: 'Ghi đè Origin/Referer bằng declarativeNetRequest. Việc này chỉ có một mục đích: '
       + 'làm endpoint riêng tin rằng request đến từ trang gốc — tức là qua mặt một kiểm tra '
       + 'nguồn gốc do bên kia dựng lên có chủ đích.',
  },
  {
    id: 'captcha-solving',
    re: /grecaptcha[\s.]*(enterprise)?[\s.]*execute|\bsolve_?captcha\b/i,
    why: 'Tự thực thi reCAPTCHA thay người dùng. Đây là bước kiểm tra "có phải người thật" '
       + 'mà nhà cung cấp đặt ra; tự động vượt nó là lý do trực tiếp khiến phiên bị gắn cờ.',
  },
  {
    id: 'private-gen-endpoint',
    // Đọc số dư thì được (chỉ GET, không tạo gì). Gọi endpoint SINH nội dung thì không.
    re: /aisandbox-pa\.googleapis\.com[^"'\s]*(batchGenerate|batchAsyncGenerate|upsample|uploadImage)/i,
    why: 'Gọi thẳng endpoint sinh nội dung riêng của Google. SEOSONA sinh qua giao diện; '
       + 'endpoint riêng đổi lúc nào cũng được và đi kèm rủi ro gắn cờ tài khoản.',
  },
  {
    id: 'comparator-extension-id',
    // ID extension của bộ comparator (đọc từ manifest của họ). Ghép từ mảnh — cùng quy ước
    // với tests/governance/product-independence.test.mjs, vốn CẤM chính các literal này xuất
    // hiện trong cây sản phẩm. Viết thẳng vào đây là gate kia bắn ngay file này.
    re: new RegExp([
      ['iicjfgdnngmpfocf', 'anpiammedafmomin'].join(''),
      ['ifpnmgjefjpmmojo', 'jhgblffocmgmbgoc'].join(''),
      ['glfaecbodhpckdmd', 'cdkofgobccfejifp'].join(''),
    ].join('|')),
    why: 'Nhúng ID extension của sản phẩm khác = tạo phụ thuộc vào thứ mình không kiểm soát, '
       + 'và biến SEOSONA thành phần phụ của một sản phẩm có thể biến mất bất cứ lúc nào.',
  },
  {
    id: 'comparator-protocol',
    re: new RegExp(['TOBY', 'BRIDGE_[A-Z_]+'].join('') + '|' + ['TOBY', 'FLOW_[A-Z_]+'].join('')),
    why: 'Dùng tên sự kiện/protocol của sản phẩm khác — ràng buộc ngầm vào thứ họ đổi lúc nào cũng được.',
  },
];

export function scan(root = ROOT) {
  const hits = [];
  for (const rel of productFiles()) {
    let text;
    try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    for (const rule of RULES) {
      lines.forEach((line, i) => {
        if (line.includes('independence-scan:allow')) return;
        // Dòng CHÚ THÍCH thuần không gọi được endpoint nào. Mô tả một endpoint để giải
        // thích vì sao ta chỉ QUAN SÁT nó (vd interceptor read-only đọc lỗi 403) là việc
        // đáng làm — chặn cả chú thích thì người ta sẽ xoá lời giải thích chứ không xoá code.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (rule.re.test(line)) hits.push({ file: rel.slice(EXT.length), line: i + 1, rule: rule.id, why: rule.why });
      });
    }
  }
  return hits;
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const hits = scan();
  if (hits.length) {
    console.error(`[independence] ${hits.length} vi phạm nguyên tắc độc lập:`);
    for (const h of hits) console.error(`  - ${h.file}:${h.line} [${h.rule}]\n      ${h.why}`);
    process.exit(1);
  }
  console.log(`[independence] OK — ${RULES.length} luật, 0 vi phạm trong mã sản phẩm.`);
}
