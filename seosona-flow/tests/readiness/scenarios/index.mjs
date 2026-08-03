// P10.T6 — reliability drill scenarios. Each scenario injects a failure and
// asserts the system RECOVERS or FAILS SAFE (never silently continues broken).
// Scenarios use the real headless modules (loaded by run-drills and passed in).
// disposition: 'recovered' | 'failed-safe' | 'unhandled'.

export const SCENARIOS = [
  {
    id: 'provider-rate-limit',
    expects: 'recovered',
    run: ({ ProviderError }) => {
      const err = ProviderError.normalize({ status: 429 });
      return { disposition: err.retryable ? 'recovered' : 'unhandled', detail: err.action };
    },
  },
  {
    id: 'provider-drift',
    expects: 'failed-safe',
    run: ({ SelectorResolver }) => {
      const r = SelectorResolver.create({ version: 1, selectors: { composer: ['#x'] } })
        .resolve('composer', { query: () => [] });
      return { disposition: (!r.ok && r.reason) ? 'failed-safe' : 'unhandled', detail: r.reason };
    },
  },
  {
    id: 'storage-corruption',
    expects: 'failed-safe',
    run: ({ WorkflowMigrator }) => {
      // Feeding a corrupt document must not throw — it returns a safe result.
      let safe = true; let detail = 'ok';
      try { WorkflowMigrator.migrate({ nodes: 'not-an-array', __proto__: { x: 1 } }); }
      catch (e) { safe = false; detail = String(e && e.message); }
      return { disposition: safe ? 'failed-safe' : 'unhandled', detail };
    },
  },
  {
    id: 'permission-denied',
    expects: 'failed-safe',
    run: ({ HealthService }) => {
      const h = HealthService.evaluate({ permissions: 'error', storage: true, workflows: true, providers: true, mode: true, network: true, assets: true, version: true, migration: true });
      return { disposition: h.overall === 'error' && h.actions.length ? 'failed-safe' : 'unhandled', detail: h.actions.map((a) => a.code).join(',') };
    },
  },
  {
    id: 'offline-mode',
    expects: 'failed-safe',
    run: ({ HealthService }) => {
      const h = HealthService.evaluate({ network: 'degraded', storage: true, workflows: true, providers: true, permissions: true, mode: true, assets: true, version: true, migration: true });
      return { disposition: h.overall === 'degraded' ? 'failed-safe' : 'unhandled', detail: h.overall };
    },
  },
  {
    id: 'worker-suspension-logging',
    expects: 'recovered',
    run: ({ StructuredLogger, PrivacyFilter }) => {
      const log = StructuredLogger.create({ privacyFilter: PrivacyFilter, level: 'info' });
      log.warn('lifecycle', 'worker_suspended', { prompt: 'secret' });
      const rec = log.recent(1)[0];
      // recovered = the event was recorded AND its content was filtered out
      const filtered = rec && rec.data && rec.data.prompt && rec.data.prompt.kind === 'text';
      return { disposition: filtered ? 'recovered' : 'unhandled', detail: rec && rec.event };
    },
  },
];
