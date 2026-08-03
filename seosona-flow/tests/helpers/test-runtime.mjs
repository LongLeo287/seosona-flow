// Assembles a deterministic runtime for unit/integration tests (P2.T3):
// chrome mock + fake clock + programmable fetch, installed on globalThis with
// clean teardown (leak-free).
import { createChromeMock } from './chrome-mock.mjs';
import { createFakeClock } from './fake-clock.mjs';

/** Programmable fetch that matches URL substrings to canned responses and
 *  records every request. Unmatched requests are BLOCKED by default so a test
 *  can prove local-mode makes no unexpected network call. */
export function createFetchMock({ routes = [], blockUnmatched = true } = {}) {
  const requests = [];
  const fn = async (url, options = {}) => {
    const u = typeof url === 'string' ? url : (url && url.url) || String(url);
    requests.push({ url: u, options });
    const route = routes.find((r) => (r.match instanceof RegExp ? r.match.test(u) : u.includes(r.match)));
    if (!route) {
      if (blockUnmatched) throw new Error(`fetch blocked (no route): ${u}`);
      return makeResponse({ status: 204, body: '' });
    }
    return makeResponse(route.response || {});
  };
  fn.requests = requests;
  fn.reset = () => { requests.length = 0; };
  return fn;
}

function makeResponse({ status = 200, body = '', headers = {}, json = undefined } = {}) {
  const payload = json !== undefined ? JSON.stringify(json) : body;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h.toLowerCase()] ?? headers[h] ?? null },
    async text() { return payload; },
    async json() { return json !== undefined ? json : JSON.parse(payload || 'null'); },
    async arrayBuffer() { return new TextEncoder().encode(payload).buffer; },
    async blob() { return { size: payload.length, type: headers['content-type'] || '' }; },
  };
}

export function installRuntime({ fetch: fetchOpts } = {}) {
  const chrome = createChromeMock();
  const clock = createFakeClock();
  const fetchMock = createFetchMock(fetchOpts || {});

  const saved = {
    chrome: globalThis.chrome,
    fetch: globalThis.fetch,
    hasChrome: 'chrome' in globalThis,
    hasFetch: 'fetch' in globalThis,
  };
  globalThis.chrome = chrome;
  globalThis.fetch = fetchMock;

  return {
    chrome,
    clock,
    fetch: fetchMock,
    effects: chrome._effects,
    restore() {
      if (saved.hasChrome) globalThis.chrome = saved.chrome; else delete globalThis.chrome;
      if (saved.hasFetch) globalThis.fetch = saved.fetch; else delete globalThis.fetch;
      clock.reset();
    },
  };
}
