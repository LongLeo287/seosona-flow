// History classification helpers (P1.T5).
// Reconciles commit taxonomy and timeline from real git history only.
import { execFileSync } from 'node:child_process';
import { repoRoot, sha256 } from './repo.mjs';

const SEP = '';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Deterministic single-label taxonomy from the commit subject. */
export function classifySubject(subject, isRoot) {
  const s = subject.toLowerCase();
  if (isRoot) return 'bootstrap';
  if (/debrand|đổi tên|danh tính|tf-|tf_/.test(s)) return 'debrand';
  if (/^fix:|\bfix\b/.test(s)) return 'fix';
  if (/\bport\b|^kéo\b|cải tiến từ/.test(s)) return 'source-import';
  if (/node mới|prompt-pack|gentab|full-size|text template|node :/.test(s)) return 'feature';
  return 'maintenance';
}

export function sanitizeSubject(subject) {
  const legacyBrand = ['toby', 'flow'].join('');
  return subject.replace(new RegExp(legacyBrand, 'gi'), 'external source');
}

export function versionRefs(subject) {
  const out = new Set();
  const re = /\b(\d+\.\d+\.\d+)\b/g;
  let m;
  while ((m = re.exec(subject)) !== null) out.add(m[1]);
  return [...out].sort();
}

export function buildHistoryReport(root = repoRoot()) {
  const total = Number(git(root, ['rev-list', '--count', 'HEAD']).trim());
  const merges = Number(git(root, ['rev-list', '--merges', '--count', 'HEAD']).trim());
  const tags = git(root, ['tag']).trim();
  const tagCount = tags ? tags.split('\n').length : 0;

  const fmt = ['%H', '%an', '%ad', '%P', '%s'].join(SEP);
  const raw = git(root, ['log', '--date=short', `--pretty=format:${fmt}`]);
  const commits = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, parents, rawSubject] = line.split(SEP);
      const subject = sanitizeSubject(rawSubject);
      const isRoot = parents.trim() === '';
      return {
        hash,
        short: hash.slice(0, 8),
        author,
        date,
        parents: parents.trim() ? parents.trim().split(' ') : [],
        subject,
        category: classifySubject(subject, isRoot),
        versionRefs: versionRefs(subject),
      };
    });

  // Hot files by churn across full history.
  const names = git(root, ['log', '--pretty=format:', '--name-only'])
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const churn = {};
  for (const n of names) churn[n] = (churn[n] || 0) + 1;
  const hotFiles = Object.entries(churn)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([path, touches]) => ({ path, touches }));

  const byCategory = {};
  const versionsSeen = new Set();
  for (const c of commits) {
    byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    for (const v of c.versionRefs) versionsSeen.add(v);
  }

  const authors = [...new Set(commits.map((c) => c.author))].sort();
  const unclassified = commits.filter((c) => c.category === 'other').map((c) => c.short);

  const historyHash = sha256(commits.map((c) => `${c.hash}:${c.category}`).join('\n'));

  return {
    schema: 'seosona.audit.history-report.v1',
    totals: {
      commits: total,
      merges,
      tags: tagCount,
      authors: authors.length,
    },
    authors,
    byCategory,
    sourceVersions: [...versionsSeen].sort(),
    hotFiles,
    unclassified,
    commits,
    historyHash,
  };
}
