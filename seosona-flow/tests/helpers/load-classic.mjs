// Loads classic worker scripts (src/core/*.js) into an isolated vm context so
// their `self.SEOSONA_*` globals can be unit-tested without a browser.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';

export function loadClassic(relPaths, extraGlobals = {}) {
  const sandbox = {
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    crypto: globalThis.crypto,
    AbortController,
    structuredClone,
    ...extraGlobals,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('globalThis.self = globalThis;', ctx);
  const root = repoRoot();
  for (const rel of [].concat(relPaths)) {
    const code = readFileSync(join(root, 'seosona-flow', rel), 'utf8');
    new vm.Script(code, { filename: rel }).runInContext(ctx);
  }
  return ctx;
}
