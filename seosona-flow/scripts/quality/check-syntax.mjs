#!/usr/bin/env node
// P2.T2 — JavaScript syntax gate over tracked scope.
import { repoRoot } from '../audit/lib/repo.mjs';
import { trackedExtFiles, checkSyntax } from './lib/static-checks.mjs';

const root = repoRoot();
const files = trackedExtFiles(root, ['.js', '.mjs']);
const failures = await checkSyntax(files);
if (failures.length > 0) {
  console.error(`[check:syntax] ${failures.length} file(s) failed:`);
  for (const f of failures) console.error(`  - ${f.path}: ${f.error}`);
  process.exit(1);
}
console.log(`[check:syntax] OK ${files.length} tracked JS files pass node --check.`);
