// Deterministic controllable clock for unit/integration tests (P2.T3).
export function createFakeClock(start = 0) {
  let now = start;
  let seq = 0;
  const timers = new Map();

  function schedule(type, fn, delay, args) {
    const id = ++seq;
    timers.set(id, { id, type, fn, args, delay: Math.max(0, delay | 0), due: now + Math.max(0, delay | 0) });
    return id;
  }

  return {
    now: () => now,
    setTimeout: (fn, delay = 0, ...args) => schedule('timeout', fn, delay, args),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay = 0, ...args) => schedule('interval', fn, delay, args),
    clearInterval: (id) => timers.delete(id),

    /** Advance time by ms, firing due timers in (due, id) order. */
    tick(ms) {
      const target = now + ms;
      // guard against runaway intervals
      let fired = 0;
      for (;;) {
        let next = null;
        for (const t of timers.values()) {
          if (t.due <= target && (next === null || t.due < next.due || (t.due === next.due && t.id < next.id))) {
            next = t;
          }
        }
        if (!next) break;
        now = next.due;
        if (next.type === 'interval') next.due = now + Math.max(1, next.delay);
        else timers.delete(next.id);
        next.fn(...next.args);
        if (++fired > 100000) throw new Error('fake-clock: runaway timers');
      }
      now = target;
      return fired;
    },

    pending: () => timers.size,
    reset() {
      timers.clear();
      now = start;
      seq = 0;
    },
  };
}
