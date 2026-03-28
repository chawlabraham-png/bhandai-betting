/**
 * scripts/rate-poller.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Mock rate poller — simulates a Sun Sports API feed and pushes lagai_rate
 * updates to the Supabase `events` table every second.
 *
 * Usage:
 *   node scripts/rate-poller.mjs
 *
 * When you have the real API token, replace fetchMockRates() with a real
 * fetch() call to the Sun Sports endpoint and map its response shape to
 * the same { eventId, laagaiRate } format.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vtxuzrkwnyhxciohwjjx.supabase.co';

// The anon key is read-only for most tables due to RLS.
// This script needs the service role key to write to `events`.
// Get it from: Supabase Dashboard → Project Settings → API → service_role key
// Run as: SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/rate-poller.mjs
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) {
  console.error('[poller] ERROR: SUPABASE_SERVICE_ROLE_KEY env var is required.');
  console.error('         Get it from: Supabase Dashboard → Project Settings → API → service_role');
  console.error('         Run as: SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/rate-poller.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }, // server script — no session needed
});

// ── CONFIGURATION ────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 1000;   // 1 second
const RATE_DRIFT_MAX   = 0.03;   // max random drift per tick (simulates live movement)
const RATE_MIN         = 1.05;
const RATE_MAX         = 2.50;

// ── MOCK API STATE ───────────────────────────────────────────────────────────
// Mirrors the shape a Sun Sports API response would have after mapping.
// Each entry represents one active match event.
//
// Real Sun Sports API response (typical shape) looks like:
// {
//   "status": "ok",
//   "data": [
//     { "match_id": "...", "team1": "India", "team2": "Australia",
//       "lagai": 1.75, "khai": 1.80, "status": "active" },
//     ...
//   ]
// }
//
// fetchMockRates() returns the same normalised shape:
// [{ eventId: <supabase events.id>, laagaiRate: <number> }]
//
// When wiring up the real API, replace fetchMockRates() body only —
// the rest of the loop stays the same.

let mockState = null; // loaded once from DB, then drifted each tick

async function loadActiveEvents() {
  const { data, error } = await supabase
    .from('events')
    .select('id, title, lagai_rate, status')
    .not('status', 'eq', 'VOID')
    .not('status', 'eq', 'SETTLED')
    .neq('market_type', 'FANCY');

  if (error) {
    console.error('[poller] Failed to load events:', error.message);
    return [];
  }
  return data || [];
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function randomDrift() {
  // Returns a small ± float to simulate live rate movement
  return (Math.random() - 0.5) * 2 * RATE_DRIFT_MAX;
}

// Simulates a Sun Sports API response for active match events.
// Returns: [{ eventId, laagaiRate }]
function fetchMockRates() {
  return mockState.map(function (ev) {
    const drift = randomDrift();
    const newRate = clamp(
      parseFloat((ev.currentRate + drift).toFixed(2)),
      RATE_MIN,
      RATE_MAX
    );
    ev.currentRate = newRate; // persist drift across ticks
    return { eventId: ev.id, laagaiRate: newRate };
  });
}

// ── SWAP THIS FUNCTION FOR REAL API ─────────────────────────────────────────
// async function fetchLiveRates(apiToken) {
//   const res = await fetch('https://api.sunsports.example.com/v1/live-rates', {
//     headers: { 'Authorization': `Bearer ${apiToken}` }
//   });
//   const json = await res.json();
//   return json.data.map(match => ({
//     eventId: match.match_id,    // adjust key to match your events.id foreign key
//     laagaiRate: match.lagai,
//   }));
// }
// ────────────────────────────────────────────────────────────────────────────

// ── PUSH TO SUPABASE ─────────────────────────────────────────────────────────
async function pushRates(rates) {
  if (!rates.length) return;

  // Update each event individually — plain .update() so only lagai_rate is
  // written and no NOT NULL columns (title, etc.) need to be present.
  const results = await Promise.all(rates.map(function (r) {
    return supabase
      .from('events')
      .update({ lagai_rate: r.laagaiRate })
      .eq('id', r.eventId);
  }));

  results.forEach(function (res, i) {
    if (res.error) {
      console.error('[poller] Update failed for event', rates[i].eventId, ':', res.error.message);
    }
  });
}

// ── MAIN LOOP ────────────────────────────────────────────────────────────────
let tickCount = 0;
let consecutiveErrors = 0;
const MAX_ERRORS = 10;

async function tick() {
  tickCount++;
  try {
    const rates = fetchMockRates(); // replace with await fetchLiveRates(API_TOKEN) later

    // Log a sample every 10 ticks to avoid console spam
    if (tickCount % 10 === 0) {
      const sample = rates.slice(0, 3).map(function (r) {
        return r.laagaiRate.toFixed(2);
      }).join(', ');
      console.log(`[poller] tick=${tickCount}  events=${rates.length}  sample=[${sample}...]`);
    }

    await pushRates(rates);
    consecutiveErrors = 0;
  } catch (err) {
    consecutiveErrors++;
    console.error(`[poller] tick error (${consecutiveErrors}/${MAX_ERRORS}):`, err.message);
    if (consecutiveErrors >= MAX_ERRORS) {
      console.error('[poller] Too many consecutive errors. Stopping.');
      process.exit(1);
    }
  }
}

async function main() {
  console.log('[poller] Starting rate poller — interval:', POLL_INTERVAL_MS, 'ms');
  console.log('[poller] Loading active match events from Supabase...');

  const events = await loadActiveEvents();

  if (!events.length) {
    console.warn('[poller] No active non-fancy events found. Nothing to poll.');
    console.warn('[poller] Open at least one MATCH event in the admin panel, then restart.');
    process.exit(0);
  }

  console.log(`[poller] Tracking ${events.length} event(s):`);
  events.forEach(function (ev) {
    console.log(`         • ${ev.id.slice(0, 8)}… "${ev.title}" (current lagai_rate: ${ev.lagai_rate})`);
  });

  // Seed mock state from DB's current rates so there's no jump on first tick
  mockState = events.map(function (ev) {
    return {
      id: ev.id,
      title: ev.title,
      currentRate: parseFloat(ev.lagai_rate != null ? ev.lagai_rate : 1.50),
    };
  });

  console.log('[poller] Running. Press Ctrl+C to stop.\n');

  // Run first tick immediately, then on interval
  await tick();
  const intervalId = setInterval(tick, POLL_INTERVAL_MS);

  // Graceful shutdown
  process.on('SIGINT', function () {
    clearInterval(intervalId);
    console.log('\n[poller] Stopped.');
    process.exit(0);
  });
  process.on('SIGTERM', function () {
    clearInterval(intervalId);
    process.exit(0);
  });
}

main();
