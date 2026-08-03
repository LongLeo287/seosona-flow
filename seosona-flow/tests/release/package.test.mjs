// P9.T6 tests — deterministic package.
// positive/negative/boundary/regression across: tracked allowlist, resources,
// secrets, backups, order, and reproducibility.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build } from '../../scripts/release/package.mjs';

const ROOT = repoRoot();

test('positive: package includes runtime files (manifest, background, pages)', () => {
  const m = build();
  const paths = m.files.map((f) => f.path);
  assert.ok(paths.includes('manifest.json'));
  assert.ok(paths.includes('background.js'));
  assert.ok(paths.some((p) => p.startsWith('pages/')));
  assert.ok(m.fileCount >= 50);
});

test('negative: no secret/backup/test files are packaged', () => {
  const m = build();
  assert.deepEqual([...m.forbidden], []);
  for (const f of m.files) {
    assert.ok(!/\.test\.mjs$|\.spec\.mjs$|\/tests\/|\/scripts\/|\.md$/.test(f.path), `leaked: ${f.path}`);
    // Khớp theo TÊN FILE dữ liệu chứa bí mật (.env, secrets.json, *.pem, id_rsa...), KHÔNG quét
    // substring đường dẫn — nếu không sẽ bắt nhầm module nguồn hợp lệ như src/core/SecretVault.js.
    assert.ok(
      !/\.env(\.|$)|(^|[/_.-])(secrets?|credentials?|tokens?)\.(json|ya?ml|txt|ini|cfg|env)$|private[_-]?key|\.(pem|p12|pfx|keystore|jks)$|id_(rsa|dsa|ecdsa|ed25519)$/i.test(f.path),
      `secret-ish: ${f.path}`,
    );
  }
});

test('boundary: reproducibility — two builds yield the identical hash', () => {
  const a = build();
  const b = build();
  assert.equal(a.reproHash, b.reproHash);
  assert.match(a.reproHash, /^[0-9a-f]{64}$/);
});

test('regression: package manifest reconciles with the committed artifact', () => {
  const m = build();
  const onDisk = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/release/phase-09/package-manifest.json'), 'utf8'));
  assert.equal(m.reproHash, onDisk.reproHash);
  assert.equal(m.fileCount, onDisk.fileCount);
});
