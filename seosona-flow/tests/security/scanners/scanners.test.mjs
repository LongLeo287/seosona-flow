// P3.T8 tests — security scanners (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRoot } from '../../../scripts/audit/lib/repo.mjs';
import {
  scanSecrets,
  scanSecretsInFiles,
  permissionSnapshot,
  vendoredSnapshot,
  diffSnapshot,
} from '../../../scripts/security/lib/scanners.mjs';

const root = repoRoot();

test('positive: tracked source contains no validated secret', () => {
  assert.deepEqual(scanSecrets(root), []);
});

test('negative: a planted fake secret is detected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seosona-secret-'));
  const file = join(dir, 'leak.js');
  writeFileSync(file, 'const k = "AKIA' + 'ABCDEFGHIJKLMNOP' + '"; // aws\n');
  const findings = scanSecretsInFiles([file]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].pattern, 'aws-access-key');
});

test('marker: secret-scan:allow chỉ miễn ĐÚNG dòng được đánh dấu', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seosona-allow-'));
  const KEY = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const file = join(dir, 'vec.js');
  writeFileSync(file, [
    'const a = "' + KEY + '"; // secret-scan:allow vector kiểm tra',   // miễn: cùng dòng
    '// secret-scan:allow vector kiểm tra',
    'const b = "' + KEY + '";',                                        // miễn: dòng ngay trên
    'const c = "' + KEY + '";',                                        // KHÔNG miễn -> phải bắt
    '',
  ].join('\n'));
  const findings = scanSecretsInFiles([file]);
  assert.equal(findings.length, 1, 'chỉ dòng không đánh dấu bị bắt');
  assert.equal(findings[0].line, 4);
});

test('marker: KHÔNG miễn trừ cả cây tests/ — secret thật trong test vẫn bị bắt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seosona-tests-'));
  const file = join(dir, 'something.test.mjs');
  writeFileSync(file, 'const leaked = "AKIA' + 'ABCDEFGHIJKLMNOP' + '";\n');
  assert.equal(scanSecretsInFiles([file]).length, 1);
});

test('boundary: permission snapshot reflects the manifest', () => {
  const snap = permissionSnapshot(root);
  assert.ok(snap.permissions.includes('storage'));
  // <all_urls> was moved to optional in P3.T7 (least-privilege).
  assert.ok(snap.optional_host_permissions.includes('<all_urls>'));
  assert.ok(!snap.host_permissions.includes('<all_urls>'));
  // sorted + deduped
  assert.deepEqual(snap.permissions, [...snap.permissions].sort());
});

test('negative: diffSnapshot flags an added permission', () => {
  const base = permissionSnapshot(root);
  const current = { ...base, permissions: [...base.permissions, 'debugger'].sort() };
  const b = base.permissions.map((p) => ({ path: p }));
  const c = current.permissions.map((p) => ({ path: p }));
  const d = diffSnapshot(b, c);
  assert.ok(d.added.includes('debugger'));
});

test('boundary: vendored snapshot hashes lib/ files', () => {
  const snap = vendoredSnapshot(root);
  assert.ok(snap.length >= 1);
  for (const f of snap) {
    assert.ok(f.path.startsWith('lib/'));
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
  }
});

test('regression: vendored diff detects a changed hash', () => {
  const base = vendoredSnapshot(root);
  const mutated = base.map((f, i) => (i === 0 ? { ...f, sha256: 'deadbeef' } : f));
  const d = diffSnapshot(base, mutated);
  assert.equal(d.changed.length, 1);
});
