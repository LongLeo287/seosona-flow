// SEOSONA regression coverage — DiagramCanvas edge-restore guard.
// When loadWorkflow restores saved edges, Drawflow's addConnection fires
// 'connectionCreated' synchronously. The validation handler must NOT delete a
// persisted edge during restore (else the next Save loses real data). The
// _restoringEdges flag makes _rejectConnection keep the edge during restore and
// only delete it for genuine user drags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';

const notifications = [];
const ctx = loadClassic('src/workflow/DiagramCanvas.js', {
  window: { showNotification: (m) => notifications.push(m), I18n: null, eventBus: null },
  requestAnimationFrame: (fn) => fn(),
});
const DiagramCanvas = ctx.window.DiagramCanvas;

function fakeCanvas(restoring) {
  const removed = [];
  const self = {
    _restoringEdges: restoring,
    editor: { removeSingleConnection: (...a) => removed.push(a) },
    _removed: removed,
  };
  return self;
}
const CONN = { output_id: '1', input_id: '2', output_class: 'output_1', input_class: 'input_1' };

test('user drag: rejects and DELETES the invalid connection', () => {
  const self = fakeCanvas(false);
  const rejected = DiagramCanvas.prototype._rejectConnection.call(self, CONN, 'bad', 'type mismatch');
  assert.equal(rejected, true, 'signals caller to return');
  assert.equal(self._removed.length, 1, 'the invalid edge is removed');
});

test('restore: KEEPS the persisted edge (no deletion, caller falls through)', () => {
  const self = fakeCanvas(true);
  const rejected = DiagramCanvas.prototype._rejectConnection.call(self, CONN, 'bad', 'type mismatch');
  assert.equal(rejected, false, 'caller does NOT return → edge kept');
  assert.equal(self._removed.length, 0, 'no persisted edge deleted during restore');
});

test('regression: loadWorkflow wraps edge restore in the _restoringEdges flag', () => {
  const src = readFileSync(join(repoRoot(), 'seosona-flow/src/workflow/DiagramCanvas.js'), 'utf8');
  // flag initialized in the constructor
  assert.match(src, /this\._restoringEdges = false;/);
  // set true immediately before the edge loop, released in finally
  assert.match(src, /this\._restoringEdges = true;\s*\n\s*try\s*\{\s*\n\s*edges\.forEach/);
  assert.match(src, /\}\s*finally\s*\{\s*\n\s*this\._restoringEdges = false;\s*\n\s*\}/);
});

test('regression: all three reject sites route through _rejectConnection', () => {
  const src = readFileSync(join(repoRoot(), 'seosona-flow/src/workflow/DiagramCanvas.js'), 'utf8');
  assert.match(src, /_rejectConnection\(connection, msg, 'type mismatch'\)/);
  assert.match(src, /_rejectConnection\(connection, msg, 'acceptFromNodeTypes mismatch'\)/);
  assert.match(src, /_rejectConnection\(connection, msg, 'multiple=false'\)/);
});
