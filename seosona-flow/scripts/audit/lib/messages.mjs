// Privileged message-contract inventory helpers (P1.T3).
// Deterministic scan of tracked JS for message handlers, sources, senders,
// and the privileged sinks reachable from each listener block.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, trackedFiles, sha256 } from './repo.mjs';

const EXT_PREFIX = 'seosona-flow/';
const ACTION_RE = /\.(?:action|type|cmd|command)\s*===?\s*(['"])([A-Za-z0-9_:.-]+)\1/g;
const KEY_RE = /\b(?:action|type|cmd|command)\s*:\s*(['"])([A-Za-z0-9_:.-]+)\1/g;
const LISTENER_RE = /chrome\.runtime\.(onMessage|onMessageExternal)\.addListener/g;

// Privileged capability families we care about when classifying a handler block.
const SINK_PATTERNS = {
  tabs: /chrome\.tabs\./,
  windows: /chrome\.windows\./,
  scripting: /chrome\.scripting\./,
  downloads: /chrome\.downloads\./,
  cookies: /chrome\.cookies\./,
  webRequest: /chrome\.webRequest\./,
  fetch: /(?<![\w.])fetch\s*\(/,
  storage: /chrome\.storage\./,
};

function extJsFiles(root) {
  return trackedFiles(root)
    // `lib/` là mã BÊN NGOÀI đã vendor — nó không có handler message nào của extension, mà
    // quét vào thì các chuỗi so-sánh-trường bên trong bị nhầm thành action và làm phình
    // allowlist bảo mật (đo được: 262 → 270 khi mediabunny đổi đuôi thành .js). Nới allowlist
    // vì mã bên ngoài là mở cửa vô cớ.
    .filter((p) => p.startsWith(EXT_PREFIX) && (p.endsWith('.js') || p.endsWith('.mjs'))
      && !p.startsWith(EXT_PREFIX + 'lib/'))
    .map((p) => p.slice(EXT_PREFIX.length));
}

function lineIndex(text) {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) offsets.push(i + 1);
  return (pos) => {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Listener blocks in a file, each spanning to the next listener (or EOF). */
function listenerBlocks(text) {
  const toLine = lineIndex(text);
  const hits = [];
  let m;
  LISTENER_RE.lastIndex = 0;
  while ((m = LISTENER_RE.exec(text)) !== null) {
    hits.push({ kind: m[1] === 'onMessageExternal' ? 'external' : 'internal', start: m.index, startLine: toLine(m.index) });
  }
  return hits.map((h, i) => ({
    ...h,
    end: i + 1 < hits.length ? hits[i + 1].start : text.length,
  }));
}

function sinksInRange(text, start, end) {
  const slice = text.slice(start, end);
  const families = [];
  for (const [name, re] of Object.entries(SINK_PATTERNS)) {
    if (re.test(slice)) families.push(name);
  }
  return families;
}

export function buildMessageContracts(root = repoRoot()) {
  const files = extJsFiles(root);

  // Registry keyed by action.
  const registry = new Map();
  const ensure = (action) => {
    if (!registry.has(action)) {
      registry.set(action, {
        action,
        handled: false,
        sources: new Set(), // 'internal' | 'external'
        privilegedSinks: new Set(),
        handlerFiles: new Set(),
        senderCount: 0,
      });
    }
    return registry.get(action);
  };

  let listenerCount = 0;
  let externalListenerCount = 0;

  for (const rel of files) {
    const text = readFileSync(join(root, EXT_PREFIX, rel), 'utf8');
    const blocks = listenerBlocks(text);
    listenerCount += blocks.length;
    externalListenerCount += blocks.filter((b) => b.kind === 'external').length;

    // Handled actions (compared inside listener blocks get a source context).
    let a;
    ACTION_RE.lastIndex = 0;
    while ((a = ACTION_RE.exec(text)) !== null) {
      const action = a[2];
      const pos = a.index;
      const row = ensure(action);
      row.handled = true;
      row.handlerFiles.add(rel);
      const block = blocks.find((b) => pos >= b.start && pos < b.end);
      if (block) {
        row.sources.add(block.kind);
        for (const s of sinksInRange(text, block.start, block.end)) row.privilegedSinks.add(s);
      } else {
        row.sources.add('module');
      }
    }

    // Sender occurrences (action/type object-literal values).
    let k;
    KEY_RE.lastIndex = 0;
    while ((k = KEY_RE.exec(text)) !== null) {
      const action = k[2];
      ensure(action).senderCount += 1;
    }
  }

  const rows = [...registry.values()]
    .map((r) => ({
      action: r.action,
      handled: r.handled,
      sources: [...r.sources].sort(),
      externallyReachable: r.sources.has('external'),
      privileged: r.privilegedSinks.size > 0,
      privilegedSinks: [...r.privilegedSinks].sort(),
      handlerFiles: [...r.handlerFiles].sort(),
      senderCount: r.senderCount,
    }))
    .sort((x, y) => x.action.localeCompare(y.action));

  const handled = rows.filter((r) => r.handled);
  const summary = {
    totalActions: rows.length,
    handledActions: handled.length,
    unhandledSenderOnly: rows.filter((r) => !r.handled && r.senderCount > 0).length,
    externallyReachable: rows.filter((r) => r.externallyReachable).map((r) => r.action),
    privilegedActions: handled.filter((r) => r.privileged).length,
    listeners: listenerCount,
    externalListeners: externalListenerCount,
  };

  const registryHash = sha256(rows.map((r) => `${r.action}:${r.handled}:${r.sources.join('+')}`).join('\n'));

  return {
    schema: 'seosona.audit.message-contracts.v1',
    note: 'Listener blocks span from each addListener to the next; source/sink attribution is block-granular and over-approximates.',
    summary,
    registry: rows,
    registryHash,
  };
}
