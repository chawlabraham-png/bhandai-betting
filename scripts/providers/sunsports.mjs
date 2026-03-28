/**
 * scripts/providers/sunsports.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Sun Sports API provider stub.
 *
 * To activate:
 *   1. Set RATE_PROVIDER=sunsports
 *   2. Set SUN_SPORTS_API_TOKEN=<your token>
 *   3. Fill in the real endpoint URL and response mapping below.
 *
 * Contract: export { init, fetchRates }
 *   init(events)      — called once with active events; build any ID mapping here
 *   fetchRates()      — called each tick, returns [{ eventId, laagaiRate }]
 *
 * Sun Sports API response shape (typical):
 * {
 *   "status": "ok",
 *   "data": [
 *     { "match_id": "...", "team1": "India", "team2": "Australia",
 *       "lagai": 1.75, "khai": 1.80, "status": "active" },
 *     ...
 *   ]
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

const API_TOKEN   = process.env.SUN_SPORTS_API_TOKEN;
const API_ENDPOINT = 'https://api.sunsports.example.com/v1/live-rates'; // TODO: replace with real URL

// Map Sun Sports match_id → Supabase events.id
// Populated in init() so fetchRates() can translate IDs cheaply.
let matchIdMap = {}; // { [sunSportsMatchId]: supabaseEventId }

export function init(events) {
  if (!API_TOKEN) {
    console.error('[provider:sunsports] ERROR: SUN_SPORTS_API_TOKEN env var is not set.');
    process.exit(1);
  }

  // TODO: build matchIdMap by matching Sun Sports match_id to your events.
  // How you map depends on whether Sun Sports returns an ID you store in DB,
  // or whether you match by title. Example (match by stored external_id column):
  //
  // events.forEach(function (ev) {
  //   if (ev.external_id) matchIdMap[ev.external_id] = ev.id;
  // });

  console.log('[provider:sunsports] Initialised with', events.length, 'event(s).');
  console.warn('[provider:sunsports] STUB: matchIdMap is empty — fill in init() mapping first.');
}

export async function fetchRates() {
  const res = await fetch(API_ENDPOINT, {
    headers: { 'Authorization': `Bearer ${API_TOKEN}` },
  });

  if (!res.ok) {
    throw new Error(`Sun Sports API returned HTTP ${res.status}`);
  }

  const json = await res.json();

  // TODO: adjust field names to match actual API response
  return (json.data || [])
    .filter(function (match) { return matchIdMap[match.match_id]; })
    .map(function (match) {
      return {
        eventId:    matchIdMap[match.match_id],
        laagaiRate: parseFloat(match.lagai),
      };
    });
}
