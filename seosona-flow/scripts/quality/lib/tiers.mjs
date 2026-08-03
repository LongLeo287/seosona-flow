// Single source of truth for verification tiers, shared by verify.mjs (runner)
// and ci-summary.mjs (CI/local graph reconciliation). P2.T8.
export const VERIFY_TIERS = [
  { id: 'static', cmd: 'npm run check:static' },
  { id: 'budgets', cmd: 'npm run check:budgets' },
  { id: 'lint', cmd: 'npm run lint' },
  { id: 'security', cmd: 'npm run security:verify' },
  { id: 'audit', cmd: 'npm run audit:phase-01:check' },
  { id: 'architecture', cmd: 'npm run check:architecture' },
  { id: 'workflows', cmd: 'npm run check:workflows' },
  { id: 'providers', cmd: 'npm run check:providers' },
  { id: 'privacy', cmd: 'npm run check:privacy' },
  { id: 'ux', cmd: 'npm run check:ux' },
  { id: 'release', cmd: 'npm run check:release' },
  { id: 'readiness', cmd: 'npm run check:readiness' },
  { id: 'test:audit', cmd: 'npm run test:audit' },
  { id: 'test:unit', cmd: 'npm run test:unit' },
  { id: 'test:integration', cmd: 'npm run test:integration' },
];

// E2E runs separately in CI (needs a browser) but is part of the full graph.
export const E2E_TIER = { id: 'test:e2e', cmd: 'npm run test:e2e' };

export const ALL_TIERS = [...VERIFY_TIERS, E2E_TIER];
