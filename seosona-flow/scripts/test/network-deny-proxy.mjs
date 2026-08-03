// SEOSONA Flow — Network deny proxy for local-mode proof (Phase 7 / P7.T2, SEC-003).
// Installs a Playwright route handler that ABORTS every off-extension network
// request and records it. In local mode, opening pages and running the sidebar
// must produce ZERO recorded attempts — the trace is the proof. Provider traffic
// (user-directed) is only expected AFTER an explicit user action, so callers can
// opt to allow specific provider origins once that action occurs.
//
// Classification mirrors scripts/audit/network-inventory.mjs.
const BACKEND_HOSTS = /seosona|supabase|firebase|mercure|\/enroll|license|telemetry|analytics|api\.seosona|localhost:8080|\/api\/v\d/i;
const PROVIDER_HOSTS = /labs\.google|chatgpt\.com|openai\.com|gemini\.google|grok\.com|x\.ai|claude\.ai|anthropic|aisandbox|googleusercontent|storage\.googleapis/i;

/**
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{allowProviders?: boolean}} [opts]
 * @returns {{backend: string[], provider: string[], other: string[], all: string[]}}
 */
export async function installDenyProxy(context, opts = {}) {
  const rec = { backend: [], provider: [], other: [], all: [] };
  // Only intercept real network (http/https). Extension/local schemes are never
  // routed, so page navigation and asset loads are unaffected.
  await context.route((url) => url.protocol === 'http:' || url.protocol === 'https:', (route) => {
    const req = route.request();
    const url = req.url();
    rec.all.push(url);
    if (BACKEND_HOSTS.test(url)) { rec.backend.push(url); return route.abort('blockedbyclient'); }
    if (PROVIDER_HOSTS.test(url)) {
      rec.provider.push(url);
      return opts.allowProviders ? route.continue() : route.abort('blockedbyclient');
    }
    rec.other.push(url);
    return route.abort('blockedbyclient');
  });
  return rec;
}
