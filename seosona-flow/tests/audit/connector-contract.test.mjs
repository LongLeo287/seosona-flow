// P1.T6 tests — connector truthfulness (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';

const root = repoRoot();
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

const rootConn = readJson('seosona.project.json');
const nestedConn = readJson('seosona-flow/seosona.project.json');
const nestedPkg = readJson('seosona-flow/package.json');

function scriptNameFrom(cmd) {
  // "npm run X" or "npm --prefix seosona-flow run X" -> X
  const m = cmd.match(/npm(?:\s+--prefix\s+\S+)?\s+run\s+(\S+)/);
  return m ? m[1] : null;
}

test('positive: nested connector declares the real stack', () => {
  assert.ok(nestedConn.stack.includes('browser-extension'));
  assert.ok(nestedConn.stack.includes('javascript'));
});

test('negative: no connector declares an unknown stack', () => {
  assert.ok(!rootConn.stack.includes('unknown'), 'root stack must be truthful');
  assert.ok(!nestedConn.stack.includes('unknown'));
});

test('positive: every declared command maps to an existing npm script', () => {
  const nestedScripts = nestedPkg.scripts || {};
  for (const [name, cmd] of Object.entries(nestedConn.commands || {})) {
    const script = scriptNameFrom(cmd);
    assert.ok(script, `nested command ${name} is an npm run command`);
    assert.ok(script in nestedScripts, `nested npm script exists: ${script}`);
  }
  // Root commands delegate into the nested project; the target script must exist.
  for (const [name, cmd] of Object.entries(rootConn.commands || {})) {
    const script = scriptNameFrom(cmd);
    assert.ok(script, `root command ${name} resolves to an npm script`);
    assert.ok(script in nestedScripts, `root delegates to existing nested script: ${script}`);
    assert.ok(/--prefix\s+seosona-flow/.test(cmd), `root command ${name} runs against the nested project`);
  }
});

test('positive: nested connector exposes at least one engineering command', () => {
  assert.ok(Object.keys(nestedConn.commands || {}).length >= 1, 'nested has engineering commands');
});

test('boundary: portable OS anchor, not a machine path', () => {
  for (const conn of [rootConn, nestedConn]) {
    assert.equal(conn.osRoot, '~/.seosona');
    assert.ok(!/^[A-Za-z]:\\|^\/(?:home|Users)\//.test(conn.osRoot));
  }
});

test('boundary: both connectors carry a memory namespace', () => {
  assert.ok(rootConn.memoryNamespace && rootConn.memoryNamespace.length > 0);
  assert.ok(nestedConn.memoryNamespace && nestedConn.memoryNamespace.length > 0);
});

test('regression: autonomy still gates os_core_patch, git_publish, deploy', () => {
  for (const conn of [rootConn, nestedConn]) {
    const req = conn.autonomy?.requiresExplicitApproval || [];
    for (const g of ['os_core_patch', 'git_publish', 'deploy']) assert.ok(req.includes(g));
  }
});
