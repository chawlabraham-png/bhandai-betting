/**
 * scripts/providers/mock.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Mock provider — simulates a Sun Sports-style feed by drifting rates
 * from their current DB values. No external network calls.
 *
 * Contract: export { init, fetchRates }
 *   init(events)      — called once with the active events array from DB
 *   fetchRates()      — called each tick, returns [{ eventId, laagaiRate }]
 * ─────────────────────────────────────────────────────────────────────────────
 */

const RATE_DRIFT_MAX = 0.03;
const RATE_MIN       = 1.05;
const RATE_MAX       = 2.50;

let state = []; // [{ id, currentRate }]

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

export function init(events) {
  state = events.map(function (ev) {
    return {
      id: ev.id,
      currentRate: parseFloat(ev.lagai_rate != null ? ev.lagai_rate : 1.50),
    };
  });
  console.log('[provider:mock] Seeded', state.length, 'event(s) from current DB rates.');
}

export function fetchRates() {
  return state.map(function (ev) {
    const drift   = (Math.random() - 0.5) * 2 * RATE_DRIFT_MAX;
    const newRate = clamp(
      parseFloat((ev.currentRate + drift).toFixed(2)),
      RATE_MIN,
      RATE_MAX
    );
    ev.currentRate = newRate;
    return { eventId: ev.id, laagaiRate: newRate };
  });
}
