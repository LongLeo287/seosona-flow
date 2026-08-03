// Architecture / script-load graph helpers (P1.T2).
// Parses manifest + HTML pages into typed nodes and ordered edges over the
// tracked extension scope only.
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { repoRoot, trackedFiles, sha256 } from './repo.mjs';

const EXT_PREFIX = 'seosona-flow/';

/** Set of extension-relative tracked paths (prefix stripped). */
export function extensionTrackedSet(root = repoRoot()) {
  const set = new Set();
  for (const p of trackedFiles(root)) {
    if (p.startsWith(EXT_PREFIX)) set.add(p.slice(EXT_PREFIX.length));
  }
  return set;
}

function readExt(root, rel) {
  return readFileSync(join(root, EXT_PREFIX, rel), 'utf8');
}

function isExternal(src) {
  return /^(?:https?:|chrome-extension:|chrome:|data:|blob:|\/\/)/i.test(src);
}

/** Resolve an HTML src relative to the page directory, POSIX-normalized. */
export function resolveFrom(pageRel, src) {
  const clean = src.split('#')[0].split('?')[0];
  const dir = posix.dirname(pageRel);
  return posix.normalize(posix.join(dir, clean));
}

/** Ordered <script src="..."> list for a page (classic scripts, order kept). */
export function scriptSrcsInOrder(html) {
  const re = /<script\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

/** Build a load receipt for one HTML page. */
function pageReceipt(root, pageRel, tracked) {
  const html = readExt(root, pageRel);
  const srcs = scriptSrcsInOrder(html);
  const scripts = [];
  const seen = new Set();
  const duplicates = [];
  const missing = [];
  const external = [];
  srcs.forEach((src, order) => {
    if (isExternal(src)) {
      external.push(src);
      return;
    }
    const resolved = resolveFrom(pageRel, src);
    if (seen.has(resolved)) duplicates.push(resolved);
    seen.add(resolved);
    const exists = tracked.has(resolved);
    if (!exists) missing.push(resolved);
    scripts.push({ order, src, resolved, exists });
  });
  return {
    page: pageRel,
    scriptCount: scripts.length,
    externalCount: external.length,
    scripts,
    duplicates: [...new Set(duplicates)].sort(),
    missing: [...new Set(missing)].sort(),
  };
}

function manifestGroups(manifest, tracked) {
  const groups = [];
  const missing = [];
  (manifest.content_scripts || []).forEach((cs, i) => {
    const js = cs.js || [];
    const resolved = js.map((rel) => {
      const exists = tracked.has(rel);
      if (!exists) missing.push(rel);
      return { rel, exists };
    });
    groups.push({
      index: i,
      matches: cs.matches || [],
      world: cs.world || 'ISOLATED',
      runAt: cs.run_at || 'document_idle',
      allFrames: cs.all_frames === true,
      scripts: resolved,
    });
  });
  return { groups, missing };
}

export function buildArchitectureGraph(root = repoRoot()) {
  const tracked = extensionTrackedSet(root);
  const manifest = JSON.parse(readExt(root, 'manifest.json'));

  // Background service worker
  const swRel = manifest.background?.service_worker || null;
  const swExists = swRel ? tracked.has(swRel) : false;

  // Content-script groups
  const { groups, missing: csMissing } = manifestGroups(manifest, tracked);

  // Extension pages (tracked HTML under pages/)
  const pageRels = [...tracked].filter((p) => p.startsWith('pages/') && p.endsWith('.html')).sort();
  const pages = pageRels.map((p) => pageReceipt(root, p, tracked));

  const missingResources = [
    ...csMissing.map((rel) => ({ kind: 'content_script', rel })),
    ...(swRel && !swExists ? [{ kind: 'service_worker', rel: swRel }] : []),
    ...pages.flatMap((pg) => pg.missing.map((rel) => ({ kind: 'page_script', page: pg.page, rel }))),
  ];

  const nodes = {
    serviceWorker: { rel: swRel, exists: swExists },
    contentScriptGroups: groups.length,
    pages: pages.length,
  };

  const totals = {
    pageScripts: pages.reduce((n, p) => n + p.scriptCount, 0),
    contentScripts: groups.reduce((n, g) => n + g.scripts.length, 0),
    pagesWithDuplicates: pages.filter((p) => p.duplicates.length > 0).length,
    missingResources: missingResources.length,
  };

  const receiptHash = sha256(
    pages.map((p) => `${p.page}:${p.scripts.map((s) => s.resolved).join(',')}`).join('\n'),
  );

  return {
    schema: 'seosona.audit.architecture-graph.v1',
    nodes,
    contentScriptGroups: groups,
    pages,
    totals,
    missingResources,
    receiptHash,
  };
}
