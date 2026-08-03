import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../helpers/load-classic.mjs';

function loadEvents() {
  try {
    return loadClassic('src/core/RunEventCenter.js').SEOSONA_RunEventCenter || null;
  } catch (_) {
    return null;
  }
}

test('positive: event center records unread workflow events in newest-first order', async () => {
  const E = loadEvents();
  assert.ok(E, 'RunEventCenter module is available');
  const store = E.createMemoryStore();

  await E.recordEvent({ type: 'run_completed', title: 'A done' }, { id: 'evt_1', now: 1000, store });
  await E.recordEvent({ type: 'run_failed', title: 'B failed' }, { id: 'evt_2', now: 2000, store });
  const list = await E.listEvents({ store });

  assert.equal(list.ok, true);
  assert.equal(list.events[0].id, 'evt_2');
  assert.equal(list.events[1].id, 'evt_1');
  assert.equal(list.unreadCount, 2);
});

test('positive: markRead clears unread status idempotently', async () => {
  const E = loadEvents();
  assert.ok(E, 'RunEventCenter module is available');
  const store = E.createMemoryStore();

  await E.recordEvent({ type: 'asset_ready', title: 'Download ready' }, { id: 'evt_1', now: 1000, store });
  await E.markRead('evt_1', { store });
  await E.markRead('evt_1', { store });
  const list = await E.listEvents({ store });

  assert.equal(list.unreadCount, 0);
  assert.equal(list.events[0].read, true);
});

test('boundary: event center caps stored events and reports dropped count', async () => {
  const E = loadEvents();
  assert.ok(E, 'RunEventCenter module is available');
  const store = E.createMemoryStore();

  for (let i = 0; i < 5; i++) {
    await E.recordEvent({ type: 'run_completed', title: `Event ${i}` }, { id: `evt_${i}`, now: i, store, maxEvents: 3 });
  }
  const list = await E.listEvents({ store });

  assert.equal(list.events.length, 3);
  assert.equal(list.droppedCount, 2);
});

test('negative: message handler rejects untrusted event writes', async () => {
  const E = loadEvents();
  assert.ok(E, 'RunEventCenter module is available');

  const response = await E.handleMessage({
    action: 'runEvents:record',
    event: { type: 'run_completed', title: 'Done' },
  }, { trusted: false, store: E.createMemoryStore() });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'UNTRUSTED_SENDER');
});
