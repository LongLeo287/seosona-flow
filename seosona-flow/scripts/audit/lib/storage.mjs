// Persisted-data / storage-key inventory helpers (P1.T4).
// Extracts chrome.storage keys with area, readers, writers, and required
// owner + lifecycle + sensitivity metadata.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, trackedFiles, sha256 } from './repo.mjs';

const EXT_PREFIX = 'seosona-flow/';
const CALL_RE = /chrome\.storage\.(local|sync|session|managed)\.(get|set|remove)\s*\(/g;

function extJsFiles(root) {
  return trackedFiles(root)
    .filter((p) => p.startsWith(EXT_PREFIX) && (p.endsWith('.js') || p.endsWith('.mjs')))
    .map((p) => p.slice(EXT_PREFIX.length));
}

/** Slice the balanced argument list starting at the '(' index. */
function balancedArg(text, openParen) {
  let depth = 0;
  for (let i = openParen; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return text.slice(openParen + 1, i);
    }
  }
  return text.slice(openParen + 1, Math.min(text.length, openParen + 400));
}

function keysFromSlice(op, slice) {
  const keys = new Set();
  // Direct quoted args / array elements: 'key' or "key"
  const lit = /(['"])([A-Za-z_$][A-Za-z0-9_$:.-]*)\1/g;
  let m;
  while ((m = lit.exec(slice)) !== null) keys.add(m[2]);
  if (op === 'set') {
    // Object property names at the head of the argument (quoted or bare).
    const prop = /[{,]\s*(['"]?)([A-Za-z_$][A-Za-z0-9_$]*)\1\s*:/g;
    let p;
    while ((p = prop.exec(slice)) !== null) keys.add(p[2]);
  }
  return [...keys];
}

// Classification heuristics (documented, deterministic).
function ownerOf(key) {
  if (key.startsWith('af_')) return 'app';
  if (key.startsWith('SEOSONA_')) return 'runtime-mode';
  if (key.startsWith('_')) return 'transient-handoff';
  return 'misc';
}
const SENSITIVE_RE = /(auth|token|secret|bearer|entitlement|fingerprint|session|hmac|signature|credential|password|apikey|api_key)/i;
function sensitivityOf(key) {
  return SENSITIVE_RE.test(key) ? 'sensitive' : 'ordinary';
}
function lifecycleOf(key) {
  if (key.startsWith('_') || /WindowId$/.test(key)) return 'transient';
  if (SENSITIVE_RE.test(key)) return 'sensitive-persistent';
  if (/(cache|last_event|stats|_results$|history|daily)/i.test(key)) return 'derived';
  return 'persistent';
}

export function buildStorageInventory(root = repoRoot()) {
  const files = extJsFiles(root);
  const map = new Map();
  const ensure = (key) => {
    if (!map.has(key)) {
      map.set(key, {
        key,
        areas: new Set(),
        readers: new Set(),
        writers: new Set(),
      });
    }
    return map.get(key);
  };

  let callSites = 0;
  for (const rel of files) {
    const text = readFileSync(join(root, EXT_PREFIX, rel), 'utf8');
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(text)) !== null) {
      callSites++;
      const area = m[1];
      const op = m[2];
      const openParen = m.index + m[0].length - 1;
      const slice = balancedArg(text, openParen);
      for (const key of keysFromSlice(op, slice)) {
        const row = ensure(key);
        row.areas.add(area);
        if (op === 'get') row.readers.add(rel);
        else row.writers.add(rel);
      }
    }
  }

  const rows = [...map.values()]
    .map((r) => ({
      key: r.key,
      areas: [...r.areas].sort(),
      owner: ownerOf(r.key),
      sensitivity: sensitivityOf(r.key),
      lifecycle: lifecycleOf(r.key),
      readers: [...r.readers].sort(),
      writers: [...r.writers].sort(),
      readerCount: r.readers.size,
      writerCount: r.writers.size,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const summary = {
    totalKeys: rows.length,
    callSites,
    byArea: rows.reduce((acc, r) => {
      for (const a of r.areas) acc[a] = (acc[a] || 0) + 1;
      return acc;
    }, {}),
    sensitiveKeys: rows.filter((r) => r.sensitivity === 'sensitive').map((r) => r.key),
    byLifecycle: rows.reduce((acc, r) => {
      acc[r.lifecycle] = (acc[r.lifecycle] || 0) + 1;
      return acc;
    }, {}),
  };

  const keysHash = sha256(rows.map((r) => `${r.key}:${r.areas.join('+')}:${r.owner}:${r.lifecycle}`).join('\n'));

  return {
    schema: 'seosona.audit.storage-inventory.v1',
    note: 'Keys extracted from balanced chrome.storage.<area>.<op>() arguments; set() also yields object property names.',
    summary,
    keys: rows,
    keysHash,
  };
}
