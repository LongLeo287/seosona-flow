// Static resource check helpers (P2.T2). Tracked-scope-only, stable errors.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, trackedFiles } from '../../audit/lib/repo.mjs';
import { buildArchitectureGraph } from '../../audit/lib/graph.mjs';

const EXT_PREFIX = 'seosona-flow/';

// Test fixtures under tests/fixtures/ are deliberately crafted inputs — some are
// intentionally malformed (bad-syntax.js, bad.json) to exercise the negative-path
// tests. They must never be subject to the syntax/parse gates, else committing them
// breaks check:syntax / check:json. Negative tests still target them by explicit path.
const FIXTURE_PREFIX = `${EXT_PREFIX}tests/fixtures/`;

export function trackedExtFiles(root, exts) {
  return trackedFiles(root)
    .filter((p) => p.startsWith(EXT_PREFIX) && !p.startsWith(FIXTURE_PREFIX) && exts.some((e) => p.endsWith(e)))
    .map((p) => join(root, p));
}

/** Syntax-check a list of JS files with `node --check`, bounded concurrency. */
export async function checkSyntax(files, concurrency = 8) {
  const failures = [];
  let i = 0;
  async function worker() {
    while (i < files.length) {
      const file = files[i++];
      const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (res.status !== 0) {
        failures.push({ path: file, error: (res.stderr || '').split('\n')[0] || 'syntax error' });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length || 1) }, worker));
  return failures.sort((a, b) => a.path.localeCompare(b.path));
}

/** Parse-check a list of JSON files. */
export function checkJson(files) {
  const failures = [];
  for (const file of files) {
    try {
      JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      failures.push({ path: file, error: err.message });
    }
  }
  return failures.sort((a, b) => a.path.localeCompare(b.path));
}

/** Verify every declared HTML/manifest resource resolves in tracked scope. */
export function checkHtmlResources(root = repoRoot()) {
  const graph = buildArchitectureGraph(root);
  const failures = graph.missingResources.map((m) => ({
    path: m.page || m.rel,
    error: `missing declared resource: ${JSON.stringify(m)}`,
  }));
  // Manifest icons must exist too.
  const manifest = JSON.parse(readFileSync(join(root, EXT_PREFIX, 'manifest.json'), 'utf8'));
  const tracked = new Set(
    trackedFiles(root).filter((p) => p.startsWith(EXT_PREFIX)).map((p) => p.slice(EXT_PREFIX.length)),
  );
  for (const icon of Object.values(manifest.icons || {})) {
    if (!tracked.has(icon)) failures.push({ path: 'manifest.json', error: `missing icon: ${icon}` });
  }
  return failures.sort((a, b) => a.path.localeCompare(b.path));
}
