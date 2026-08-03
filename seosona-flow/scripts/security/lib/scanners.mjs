// Security scanner helpers (P3.T8). Deterministic; tracked-scope only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, trackedFiles, sha256 } from '../../audit/lib/repo.mjs';

const EXT_PREFIX = 'seosona-flow/';

// Specific credential patterns (low false-positive), each with a stable id.
export const SECRET_PATTERNS = [
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { id: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { id: 'slack-token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { id: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{36}/ },
  { id: 'stripe-secret', re: /sk_live_[0-9a-zA-Z]{24,}/ },
  { id: 'jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

function scannableText(root) {
  return trackedFiles(root)
    .filter((p) => p.startsWith(EXT_PREFIX))
    .filter((p) => /\.(js|mjs|json|html|css|md)$/.test(p))
    .filter((p) => !p.startsWith(`${EXT_PREFIX}lib/`))
    .filter((p) => !/gwr-bundle\.js$|watermark-alpha-data\.js$|\.min\.js$/.test(p));
}

// Miễn trừ CÓ CHỦ Ý, theo TỪNG DÒNG. Đặt trên chính dòng đó hoặc dòng ngay trước.
// Cố tình KHÔNG loại trừ cả thư mục tests/: test bảo mật buộc phải chứa chuỗi giống
// thật (vector kiểm tra bộ che log), nhưng nếu miễn cả cây thì một secret rò rỉ thật
// nằm trong test sẽ không ai bắt được. Marker bắt người viết khai báo từng chỗ.
export const ALLOW_MARKER = 'secret-scan:allow';

export function scanSecretsInFiles(absFiles) {
  const findings = [];
  for (const abs of absFiles) {
    let text;
    try { text = readFileSync(abs, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (line.includes(ALLOW_MARKER) || (i > 0 && lines[i - 1].includes(ALLOW_MARKER))) return;
      for (const p of SECRET_PATTERNS) {
        if (p.re.test(line)) findings.push({ file: abs, line: i + 1, pattern: p.id });
      }
    });
  }
  return findings.sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line));
}

export function scanSecrets(root = repoRoot()) {
  const files = scannableText(root).map((p) => join(root, p));
  return scanSecretsInFiles(files);
}

export function permissionSnapshot(root = repoRoot()) {
  const manifest = JSON.parse(readFileSync(join(root, EXT_PREFIX, 'manifest.json'), 'utf8'));
  return {
    permissions: [...(manifest.permissions || [])].sort(),
    optional_permissions: [...(manifest.optional_permissions || [])].sort(),
    host_permissions: [...(manifest.host_permissions || [])].sort(),
    optional_host_permissions: [...(manifest.optional_host_permissions || [])].sort(),
  };
}

export function vendoredSnapshot(root = repoRoot()) {
  const files = trackedFiles(root)
    .filter((p) => p.startsWith(`${EXT_PREFIX}lib/`))
    .sort();
  return files.map((p) => ({
    path: p.slice(EXT_PREFIX.length),
    sha256: sha256(readFileSync(join(root, p))),
  }));
}

/** Compare a snapshot to a baseline; returns {added, removed, changed}. */
export function diffSnapshot(baseline, current, key = 'path') {
  const bMap = new Map((Array.isArray(baseline) ? baseline : []).map((x) => [x[key], x]));
  const cMap = new Map((Array.isArray(current) ? current : []).map((x) => [x[key], x]));
  const added = [...cMap.keys()].filter((k) => !bMap.has(k));
  const removed = [...bMap.keys()].filter((k) => !cMap.has(k));
  const changed = [...cMap.keys()].filter((k) => bMap.has(k) && JSON.stringify(bMap.get(k)) !== JSON.stringify(cMap.get(k)));
  return { added, removed, changed };
}
