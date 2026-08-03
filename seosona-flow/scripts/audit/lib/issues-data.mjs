// P1.T7 — canonical issue registry source of truth.
// Transcribed from docs/audits/2026-07-15-seosona-flow-project-audit.md (Issue
// Registry table) and the sealed security report (FIND-001..018).
// Kinds are separated: facts, findings (AUD/SEC), inferences, unknowns.

// Primary owner model per phase, from the roadmap.
export const PHASE_OWNER = {
  1: 'Orchestrator Model',
  2: 'Test Harness Model',
  3: 'Security Model',
  4: 'Extension Runtime Model',
  5: 'Workflow Engine Model',
  6: 'Provider Adapter Model',
  7: 'Data Privacy Model',
  8: 'UX and Accessibility Model',
  9: 'Release Model',
  10: 'Orchestrator Model',
};

// Baseline facts — reproduced by Phase 1 artifacts, not opinions.
export const FACTS = [
  { id: 'FACT-001', statement: '232 files tracked; 227 under seosona-flow/; 167 javascript-typed.', evidence: 'artifacts/audit/phase-01/repository-inventory.json' },
  { id: 'FACT-002', statement: '8 extension pages; sidebar.html loads 141 scripts; 461 page-script edges; every declared resource exists.', evidence: 'artifacts/audit/phase-01/architecture-graph.json' },
  { id: 'FACT-003', statement: '312 message actions inventoried; 231 handled; 201 privileged; 13 externally reachable.', evidence: 'artifacts/audit/phase-01/message-contracts.json' },
  { id: 'FACT-004', statement: 'Storage keys inventoried across local/session areas with owner+lifecycle; sensitive credential keys flagged.', evidence: 'artifacts/audit/phase-01/storage-inventory.json' },
  { id: 'FACT-005', statement: 'Baseline history is classified into source imports, fixes, features, identity cleanup, and bootstrap changes.', evidence: 'artifacts/audit/phase-01/history-report.json' },
  { id: 'FACT-006', statement: 'Manifest version 1.1.37; requests <all_urls> plus tabs/scripting/downloads/unlimitedStorage/clipboardWrite.', evidence: 'seosona-flow/manifest.json' },
  { id: 'FACT-007', statement: 'No automated unit/integration/E2E/CI and no lockfile/SBOM/license inventory at baseline.', evidence: 'docs/audits/2026-07-15-seosona-flow-project-audit.md' },
];

// AUD findings — transcribed severity/family/evidence/phase.
export const AUD = [
  { id: 'AUD-001', severity: 'High', family: 'Scope and connector truth', evidence: 'Root connector declares an unknown stack and unavailable root commands; root package and memory namespace are absent.', phase: 1 },
  { id: 'AUD-002', severity: 'High', family: 'Missing architecture and evidence baseline', evidence: 'No versioned inventory, dependency graph, or issue registry exists.', phase: 1 },
  { id: 'AUD-003', severity: 'High', family: 'Missing privileged-message contract inventory', evidence: 'A large service-worker router has no machine-readable action, sender, schema, and sink registry.', phase: 1 },
  { id: 'AUD-004', severity: 'High', family: 'Missing storage and data inventory', evidence: 'Many multi-context storage keys have no complete sensitivity, retention, export, or deletion map.', phase: 1 },
  { id: 'AUD-005', severity: 'High', family: 'Historical change evidence gap', evidence: 'Import-heavy history, version drift, and no tags made change attribution difficult.', phase: 1 },
  { id: 'AUD-006', severity: 'Critical', family: 'No package quality gates', evidence: 'No lint, typecheck, build, test, static resource, or reproducible install gate.', phase: 2 },
  { id: 'AUD-007', severity: 'High', family: 'No deterministic unit environment', evidence: 'Chrome APIs, timers, fetch, crypto, and storage have no repeatable mocks.', phase: 2 },
  { id: 'AUD-008', severity: 'Critical', family: 'No integration, E2E, or CI', evidence: 'The extension has no automated page, service-worker, browser, merge, or artifact gate.', phase: 2 },
  { id: 'AUD-009', severity: 'High', family: 'Privileged action authorization is decentralized', evidence: 'Guards are handler-specific; there is no default-deny capability registry.', phase: 3 },
  { id: 'AUD-010', severity: 'High', family: 'Online origin and secret lifecycle controls are incomplete', evidence: 'Remote cleartext is warned rather than rejected; multiple credential classes lack unified lifecycle proof.', phase: 3 },
  { id: 'AUD-011', severity: 'High', family: 'Permission and security regression governance is absent', evidence: 'Broad permissions lack a tested matrix; security scanners are not CI gates.', phase: 3 },
  { id: 'AUD-012', severity: 'High', family: 'Global and monolithic runtime coupling', evidence: 'Many globals and very large modules make behavior preservation difficult.', phase: 4 },
  { id: 'AUD-013', severity: 'High', family: 'Background, message, and network responsibilities are coupled', evidence: 'background.js combines lifecycle, routing, fetch, downloads, tabs, config, and provider actions.', phase: 4 },
  { id: 'AUD-014', severity: 'High', family: 'Error debt and generated artifacts are not reproducible', evidence: '759 empty catches; generated prompt and localization chains are incomplete.', phase: 4 },
  { id: 'AUD-015', severity: 'High', family: 'Workflow schema and migration contracts are implicit', evidence: 'Imports and stored workflow shapes lack one strict versioned validator and migration corpus.', phase: 5 },
  { id: 'AUD-016', severity: 'High', family: 'Workflow state, concurrency, and cancellation need proof', evidence: 'Cross-context race limitations acknowledged; cancellation and cleanup lack system-level gates.', phase: 5 },
  { id: 'AUD-017', severity: 'High', family: 'Workflow retries and resource limits are implicit', evidence: 'Idempotency, recursion, node, media, timeout, and replay limits are not centrally testable.', phase: 5 },
  { id: 'AUD-018', severity: 'High', family: 'Provider adapters lack one contract and safe fixture corpus', evidence: 'Provider behavior is spread across large content and session modules.', phase: 6 },
  { id: 'AUD-019', severity: 'High', family: 'Selector, bridge, and session resilience is inconsistent', evidence: 'Provider selectors, MAIN-world communication, tabs, and stale-session behavior need bounded contracts.', phase: 6 },
  { id: 'AUD-020', severity: 'High', family: 'Provider media and error behavior lacks a complete matrix', evidence: 'Media extraction, download, error normalization, and smoke coverage are provider-specific.', phase: 6 },
  { id: 'AUD-021', severity: 'High', family: 'Privacy claims are not fully executable', evidence: 'Local mode is documented as completely offline, but startup background paths bypass the central API local-mode guard.', phase: 7 },
  { id: 'AUD-022', severity: 'High', family: 'Data lifecycle and export policy are incomplete', evidence: 'No comprehensive tested export, deletion, retention, and secret-exclusion contract exists.', phase: 7 },
  { id: 'AUD-023', severity: 'Medium', family: 'Accessibility baseline is absent', evidence: 'Critical flows lack automated and manual semantic, keyboard, focus, and screen-reader evidence.', phase: 8 },
  { id: 'AUD-024', severity: 'Medium', family: 'CSS and visual governance is absent', evidence: 'Large stylesheets, no token source of truth, and no visual regression matrix.', phase: 8 },
  { id: 'AUD-025', severity: 'High', family: 'Performance budgets are absent', evidence: 'Large script graphs, pages, canvas, media, and classic scripts have no reference budgets.', phase: 8 },
  { id: 'AUD-026', severity: 'High', family: 'Historical source provenance was informal', evidence: 'Legacy imported changes lacked a product-owned evidence trail.', phase: 9 },
  { id: 'AUD-027', severity: 'High', family: 'Port packet and version governance are absent', evidence: 'No test-gated port workflow or single product version source.', phase: 9 },
  { id: 'AUD-028', severity: 'High', family: 'Supply-chain inventory is incomplete', evidence: 'Vendored libraries exist without a complete lockfile, SBOM, license, and update chain.', phase: 9 },
  { id: 'AUD-029', severity: 'High', family: 'Release packaging and rollback are manual', evidence: 'No tag, changelog, deterministic package, upgrade/downgrade test, or rollback drill.', phase: 9 },
  { id: 'AUD-030', severity: 'Medium', family: 'Observability is noisy and unstructured', evidence: '3,605 console calls, no structured privacy-safe diagnostics or health surface.', phase: 10 },
  { id: 'AUD-031', severity: 'Medium', family: 'Operational and developer documentation is incomplete', evidence: 'README is useful but no complete runbook, architecture, testing, security, privacy, or release set exists.', phase: 10 },
  { id: 'AUD-032', severity: 'High', family: 'Production readiness and continuous Data First governance are absent', evidence: 'No reliability drill, independent release-candidate audit, or plan-contract gate.', phase: 10 },
];

// SEC findings — validated security issues from the sealed report.
export const SEC = [
  { id: 'SEC-001', severity: 'High', family: 'Message and page-control authenticity (confused deputy)', evidence: 'Page-visible controls and channels lack consistent authenticity and current-user-intent binding; sender capability checks are decentralized.', phase: 3, relatedFindings: ['FIND-006', 'FIND-018'] },
  { id: 'SEC-002', severity: 'High', family: 'Redirect and DNS-safe privileged network policy', evidence: 'Privileged fetch paths lack uniform DNS, redirect, final-destination, and exact-host controls.', phase: 3, relatedFindings: ['FIND-001', 'FIND-003', 'FIND-017'] },
  { id: 'SEC-003', severity: 'Medium', family: 'Local-mode startup network suppression', evidence: 'Default local mode does not suppress every background backend request; SSE/enrollment/config prefetch can bypass the central guard.', phase: 3, relatedFindings: ['FIND-002', 'FIND-007', 'FIND-009'] },
  { id: 'SEC-004', severity: 'High', family: 'Local image disclosure to host page', evidence: 'Open all-page image card exposes selected local-image data to the host page.', phase: 3, relatedFindings: ['FIND-004', 'FIND-005'] },
];

// Unknowns — sealed report "needs follow-up" groups with unproven impact.
export const UNKNOWNS = [
  { id: 'UNK-001', relatedFinding: 'FIND-005', question: 'Can response MIME reach an unescaped image-card attribute context with real browser impact?', phase: 6 },
  { id: 'UNK-002', relatedFinding: 'FIND-008', question: 'Is the server-controlled polling interval clampable, and what is its security impact?', phase: 10 },
  { id: 'UNK-003', relatedFinding: 'FIND-013', question: 'Does remote delete_chat have live object-binding and authorization proof?', phase: 5 },
  { id: 'UNK-004', relatedFinding: 'FIND-014', question: 'Do Telegram stop events bind strictly to the current queue?', phase: 5 },
  { id: 'UNK-005', relatedFinding: 'FIND-017', question: 'Do template video links get runtime scheme and provider-host validation?', phase: 6 },
];
