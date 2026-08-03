#!/usr/bin/env node
// P3.T8 — secret scanner over tracked product/text files.
import { repoRoot } from '../audit/lib/repo.mjs';
import { scanSecrets } from './lib/scanners.mjs';

const findings = scanSecrets(repoRoot());
if (findings.length > 0) {
  console.error(`[security:secrets] ${findings.length} potential secret(s):`);
  for (const f of findings) console.error(`  - ${f.file}:${f.line} [${f.pattern}]`);
  process.exit(1);
}
console.log('[security:secrets] OK no validated secret pattern in tracked source.');
