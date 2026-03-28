/**
 * scripts/rate-poller.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Provider-agnostic rate poller. Fetches lagai_rate values from a configured
 * provider and writes them to the Supabase `events` table every second.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/rate-poller.mjs
 *
 * Provider selection (defaults to mock):
 *   RATE_PROVIDER=mock       — random drift from current DB rates (default)
 *   RATE_PROVIDER=sunsports  — live Sun Sports API (also needs SUN_SPORTS_API_TOKEN)
 *
 * Each provider in scripts/providers/ must export:
 *   init(events)   — called once with active events from DB
 *   fetchRates()   — called each tick, returns [{ eventId, laagaiRate }]
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';

// ── SUPABASE ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://vtxuzrkwnyhxciohwjjx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error('[poller] ERROR: SUPABASE_SERVICE_ROLE_KEY env var is required.');
  console.error('         Get it from: Supabase Dashboard → Project Settings → API → service_role');
  console.error('         Run as: SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/rate-poller.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ── PROVIDER LOADING ─────────────────────────────────────────────────────────
const PROVIDER_NAME = process.env.RATE_PROVIDER || 'mock';
const PROVIDER_MAP  = { mock: './providers/mock.mjs', sunsports: './providers/sunsports.mjs' };

if (!PROVIDER_MAP[PROVIDER_NAME]) {
  console.error(`[poller] ERROR: Unknown RATE_PROVIDER "${PROVIDER_NAME}". Valid: ${Object.keys(PROVIDER_MAP).join(', ')}`);
  process.exit(1);
}

const provider = await import(PROVIDER_MAP[PROVIDER_NAME]);

// ── CONFIGURATION ─────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 1000;
const MAX_ERRORS       = 10;

// ── HELPERS ───────────────────────────────────────────────────────────────────
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

async function pushRates(rates) {
  if (!rates.length) return;

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

// ── MAIN LOOP ─────────────────────────────────────────────────────────────────
let tickCount         = 0;
let consecutiveErrors = 0;

async function tick() {
  tickCount++;
  try {
    const rates = await provider.fetchRates();

    if (tickCount % 10 === 0) {
      const sample = rates.slice(0, 3).map(function (r) { return r.laagaiRate.toFixed(2); }).join(', ');
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
  console.log(`[poller] Starting — provider: ${PROVIDER_NAME}, interval: ${POLL_INTERVAL_MS}ms`);
  console.log('[poller] Loading active match events from Supabase...');

  const events = await loadActiveEvents();

  if (!events.length) {
    console.warn('[poller] No active non-fancy events found. Nothing to poll.');
    console.warn('[poller] Open at least one MATCH event in the admin panel, then restart.');
    process.exit(0);
  }

  console.log(`[poller] Tracking ${events.length} event(s):`);
  events.forEach(function (ev) {
    console.log(`         • ${ev.id.slice(0, 8)}… "${ev.title}" (lagai_rate: ${ev.lagai_rate})`);
  });

  await provider.init(events);

  console.log('[poller] Running. Press Ctrl+C to stop.\n');

  await tick();
  const intervalId = setInterval(tick, POLL_INTERVAL_MS);

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
