#!/usr/bin/env node
// P2.T2 — HTML/manifest resource-existence gate over tracked scope.
import { repoRoot } from '../audit/lib/repo.mjs';
import { checkHtmlResources } from './lib/static-checks.mjs';

const root = repoRoot();
const failures = checkHtmlResources(root);
if (failures.length > 0) {
  console.error(`[check:html] ${failures.length} missing resource(s):`);
  for (const f of failures) console.error(`  - ${f.path}: ${f.error}`);
  process.exit(1);
}
console.log('[check:html] OK every declared HTML/manifest resource exists in tracked scope.');
