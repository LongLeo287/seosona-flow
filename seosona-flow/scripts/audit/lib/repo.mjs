// Shared repository-evidence helpers for Phase 1 audit tooling.
// Deterministic, tracked-scope-only, and refuses to follow links outside the repo.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { join, sep, posix } from 'node:path';

const TEXT_EXTS = new Set([
  'js', 'mjs', 'cjs', 'css', 'html', 'htm', 'json', 'md', 'txt',
  'svg', 'yml', 'yaml', 'LICENSE',
]);

/** Absolute repository top level (works from any nested cwd). */
export function repoRoot() {
  const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  return realpathSync(out);
}

/** NUL-safe list of git-tracked paths, POSIX-normalized and sorted. */
export function trackedFiles(root = repoRoot()) {
  const raw = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return raw
    .split('\0')
    .filter(Boolean)
    .map((p) => p.split(sep).join(posix.sep))
    .sort();
}

/** sha256 hex of a buffer or string. */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function extOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1);
}

/** Coarse type from extension — deterministic and closed. */
export function fileType(path) {
  const ext = extOf(path);
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'javascript';
  if (ext === 'css') return 'css';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'markdown';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' ||
      ext === 'ico' || ext === 'webp' || ext === 'woff' || ext === 'woff2') {
    return 'binary';
  }
  if (ext === 'svg') return 'image';
  if (ext === 'LICENSE' || path.endsWith('.LICENSE')) return 'license';
  return 'other';
}

/** Scope bucket: repo-root file vs. the nested extension project. */
export function scopeOf(path) {
  return path.startsWith('seosona-flow/') ? 'seosona-flow' : 'root';
}

/** Second-level area within seosona-flow (e.g. src/core, content_scripts). */
export function areaOf(path) {
  if (!path.startsWith('seosona-flow/')) return 'root';
  const rest = path.slice('seosona-flow/'.length);
  const parts = rest.split('/');
  if (parts.length === 1) return 'seosona-flow/(top)';
  if (parts[0] === 'src' && parts.length > 2) return `seosona-flow/src/${parts[1]}`;
  return `seosona-flow/${parts[0]}`;
}

function isTextPath(path) {
  const ext = extOf(path);
  return TEXT_EXTS.has(ext);
}

/** Deterministic per-file record. Refuses paths escaping the repo via links. */
export function describeFile(path, root = repoRoot()) {
  const abs = join(root, path);
  // Guard: a tracked path must never resolve outside the repo root.
  const real = realpathSync(abs);
  const rootReal = realpathSync(root);
  if (real !== rootReal && !real.startsWith(rootReal + sep)) {
    throw new Error(`external-link traversal refused: ${path} -> ${real}`);
  }
  const lst = lstatSync(abs);
  if (lst.isSymbolicLink()) {
    throw new Error(`external-link traversal refused: ${path} is a symlink`);
  }
  const buf = readFileSync(abs);
  const type = fileType(path);
  const text = isTextPath(path);
  let lines = null;
  if (text) {
    const str = buf.toString('utf8');
    if (str.length === 0) {
      lines = 0;
    } else {
      let n = 0;
      for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) === 10) n++;
      lines = str.endsWith('\n') ? n : n + 1;
    }
  }
  return {
    path,
    scope: scopeOf(path),
    area: areaOf(path),
    type,
    bytes: buf.length,
    lines,
    sha256: sha256(buf),
  };
}

/** Full deterministic inventory over all tracked files. */
export function buildInventory(root = repoRoot()) {
  const files = trackedFiles(root).map((p) => describeFile(p, root));
  const byType = {};
  const byScope = {};
  const byArea = {};
  let totalBytes = 0;
  let totalLines = 0;
  for (const f of files) {
    byType[f.type] = (byType[f.type] || 0) + 1;
    byScope[f.scope] = (byScope[f.scope] || 0) + 1;
    byArea[f.area] = (byArea[f.area] || 0) + 1;
    totalBytes += f.bytes;
    if (f.lines != null) totalLines += f.lines;
  }
  const sortObj = (o) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const scopeHash = sha256(
    files.map((f) => `${f.path}:${f.bytes}:${f.sha256}`).join('\n'),
  );
  return {
    schema: 'seosona.audit.inventory.v1',
    totals: {
      files: files.length,
      bytes: totalBytes,
      textLines: totalLines,
    },
    byType: sortObj(byType),
    byScope: sortObj(byScope),
    byArea: sortObj(byArea),
    scopeHash,
    files,
  };
}

/** Stable JSON serialization used for artifacts and --check comparison. */
export function stableJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}
