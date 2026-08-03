#!/usr/bin/env node
// P2.T2 — JSON parse gate over tracked scope.
import { repoRoot } from '../audit/lib/repo.mjs';
import { trackedExtFiles, checkJson } from './lib/static-checks.mjs';

const root = repoRoot();
const files = trackedExtFiles(root, ['.json']);
const failures = checkJson(files);
if (failures.length > 0) {
  console.error(`[check:json] ${failures.length} file(s) failed:`);
  for (const f of failures) console.error(`  - ${f.path}: ${f.error}`);
  process.exit(1);
}
console.log(`[check:json] OK ${files.length} tracked JSON files parse.`);
