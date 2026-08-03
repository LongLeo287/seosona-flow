// Global dependency graph helpers (P4.T1, AUD-012). Scans window/self/globalThis
// member reads and writes across product scope to make coupling measurable.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, trackedFiles, sha256 } from './repo.mjs';

const EXT_PREFIX = 'seosona-flow/';
// Capture the object (group 1) so we can ignore `self.X` when `self` is a local
// `var self = this` alias (a common pattern) rather than the global `self`.
const WRITE_RE = /\b(window|self|globalThis)\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)/g;
const MEMBER_RE = /\b(window|self|globalThis)\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
// Files that alias `self = this` shadow the global `self`, so their `self.` member
// accesses are instance-property reads/writes, not global coupling.
const SELF_ALIAS_RE = /\b(?:var|let|const)\s+self\s*=\s*this\b/;

function productJsFiles(root) {
  return trackedFiles(root)
    .filter((p) => p.startsWith(EXT_PREFIX) && p.endsWith('.js'))
    .filter((p) => !p.startsWith(`${EXT_PREFIX}lib/`))
    .filter((p) => !/gwr-bundle\.js$|watermark-alpha-data\.js$|\.min\.js$/.test(p))
    .map((p) => p.slice(EXT_PREFIX.length));
}

export function buildGlobalGraph(root = repoRoot()) {
  const files = productJsFiles(root);
  const map = new Map(); // name -> { writers:Set, readers:Set }
  const ensure = (name) => {
    if (!map.has(name)) map.set(name, { writers: new Set(), readers: new Set() });
    return map.get(name);
  };

  for (const rel of files) {
    const text = readFileSync(join(root, EXT_PREFIX, rel), 'utf8');
    const selfIsLocal = SELF_ALIAS_RE.test(text);
    const skip = (obj) => obj === 'self' && selfIsLocal;
    const writes = new Set();
    let m;
    WRITE_RE.lastIndex = 0;
    while ((m = WRITE_RE.exec(text)) !== null) {
      if (skip(m[1])) continue;
      writes.add(m[2]); ensure(m[2]).writers.add(rel);
    }
    MEMBER_RE.lastIndex = 0;
    while ((m = MEMBER_RE.exec(text)) !== null) {
      if (skip(m[1])) continue;
      const name = m[2];
      if (!writes.has(name)) ensure(name).readers.add(rel);
    }
  }

  const rows = [...map.entries()]
    .map(([name, v]) => ({
      name,
      writers: [...v.writers].sort(),
      readers: [...v.readers].sort(),
      writerCount: v.writers.size,
      readerCount: v.readers.size,
      owned: v.writers.size > 0,
      conflicted: v.writers.size > 1,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const owned = rows.filter((r) => r.owned);
  const external = rows.filter((r) => !r.owned); // browser/DOM globals, no in-repo writer
  const summary = {
    fileCount: files.length,
    totalGlobals: rows.length,
    ownedGlobals: owned.length,
    externalGlobals: external.length,
    conflictedGlobals: rows.filter((r) => r.conflicted).length,
  };
  const graphHash = sha256(rows.map((r) => `${r.name}:${r.writers.join('+')}`).join('\n'));

  return {
    schema: 'seosona.architecture.globals.v1',
    summary,
    globals: rows,
    graphHash,
  };
}
