/**
 * scripts/seed-test-matches.mjs
 * Inserts 3 IPL MATCH events + 2 linked FANCY events each into Supabase.
 * Authenticates as admin so RLS policies are satisfied.
 *
 * Usage: node scripts/seed-test-matches.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vtxuzrkwnyhxciohwjjx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_c2TzMQIXnpvxbf5UIOmrYw_tABpS3yR';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── MATCH DATA ───────────────────────────────────────────────────────────────
const MATCHES = [
  {
    title: 'Mumbai Indians vs Chennai Super Kings',
    category: 'Cricket', sub_category: 'IPL 2025 · Match 14',
    lagai_rate: 1.85, rate_team: 'Mumbai Indians',
    team1: 'Mumbai Indians', team2: 'Chennai Super Kings',
    fancies: [
      { title: 'MI 6 Overs Runs',      fancy_type: '6_OVER_RUNS',  line_value: 48, back_price: 1.90 },
      { title: 'Rohit Sharma Runs',    fancy_type: 'PLAYER_RUNS',  line_value: 28, back_price: 1.95 },
    ],
  },
  {
    title: 'Royal Challengers Bangalore vs Kolkata Knight Riders',
    category: 'Cricket', sub_category: 'IPL 2025 · Match 15',
    lagai_rate: 1.70, rate_team: 'Royal Challengers Bangalore',
    team1: 'Royal Challengers Bangalore', team2: 'Kolkata Knight Riders',
    fancies: [
      { title: 'RCB 10 Overs Runs',    fancy_type: '10_OVER_RUNS', line_value: 84, back_price: 1.90 },
      { title: 'Virat Kohli Runs',     fancy_type: 'PLAYER_RUNS',  line_value: 36, back_price: 1.95 },
    ],
  },
  {
    title: 'Rajasthan Royals vs Delhi Capitals',
    category: 'Cricket', sub_category: 'IPL 2025 · Match 16',
    lagai_rate: 1.95, rate_team: 'Rajasthan Royals',
    team1: 'Rajasthan Royals', team2: 'Delhi Capitals',
    fancies: [
      { title: 'RR 6 Overs Runs',      fancy_type: '6_OVER_RUNS',  line_value: 44, back_price: 1.90 },
      { title: 'Sanju Samson Runs',    fancy_type: 'PLAYER_RUNS',  line_value: 32, back_price: 1.95 },
    ],
  },
];

// ── AUTH ─────────────────────────────────────────────────────────────────────
async function signInAsAdmin() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'a12345@bhandai.com',
    password: '112233',
  });
  if (error) throw new Error('Admin login failed: ' + error.message);
  console.log('[seed] Signed in as admin:', data.user.email);
}

// ── INSERT ───────────────────────────────────────────────────────────────────
async function insertMatch(match) {
  // 1. Insert MATCH event
  const { data: ev, error: evErr } = await supabase
    .from('events')
    .insert({
      title:           match.title,
      category:        match.category,
      sub_category:    match.sub_category,
      status:          'ACTIVE',
      is_resolved:     false,
      market_type:     'MATCH',
      lagai_rate:      match.lagai_rate,
      rate_team:       match.rate_team,
    })
    .select()
    .single();
  if (evErr) throw new Error('MATCH insert failed: ' + evErr.message);
  console.log(`[seed]   MATCH  "${ev.title}" → ${ev.id.slice(0,8)}…`);

  // 2. Insert 2 MATCH outcomes (team1 + team2)
  const { error: ocErr } = await supabase.from('outcomes').insert([
    { event_id: ev.id, title: match.team1, back_price: match.lagai_rate,                              current_price: 50, total_volume: 0 },
    { event_id: ev.id, title: match.team2, back_price: parseFloat((match.lagai_rate + 0.05).toFixed(2)), current_price: 50, total_volume: 0 },
  ]);
  if (ocErr) throw new Error('MATCH outcomes insert failed: ' + ocErr.message);

  // 3. Insert linked FANCY events
  for (const f of match.fancies) {
    const { data: fev, error: fevErr } = await supabase
      .from('events')
      .insert({
        title:           f.title,
        category:        match.category,
        sub_category:    match.sub_category,
        status:          'ACTIVE',
        is_resolved:     false,
        market_type:     'FANCY',
        fancy_type:      f.fancy_type,
        line_value:      f.line_value,
        base_line:       f.line_value,
        fancy_gap:       1,
        parent_event_id: ev.id,           // ← linked to parent match
      })
      .select()
      .single();
    if (fevErr) throw new Error('FANCY insert failed: ' + fevErr.message);
    console.log(`[seed]     FANCY  "${fev.title}" → ${fev.id.slice(0,8)}… (parent: ${ev.id.slice(0,8)}…)`);

    // 4. Insert YES + NO outcomes for each FANCY
    const { error: focErr } = await supabase.from('outcomes').insert([
      { event_id: fev.id, title: 'Yes', back_price: f.back_price, current_price: Math.round(100 / f.back_price), total_volume: 0, is_yes_outcome: true },
      { event_id: fev.id, title: 'No',  back_price: f.back_price, current_price: Math.round(100 / f.back_price), total_volume: 0, is_yes_outcome: false },
    ]);
    if (focErr) throw new Error('FANCY outcomes insert failed: ' + focErr.message);
  }

  return ev.id;
}

async function main() {
  await signInAsAdmin();
  console.log('[seed] Inserting 3 matches + 6 session bets…\n');

  for (const match of MATCHES) {
    console.log(`[seed] → ${match.title}`);
    await insertMatch(match);
    console.log('');
  }

  console.log('[seed] Done.');
  process.exit(0);
}

main().catch(function (err) {
  console.error('[seed] ERROR:', err.message);
  process.exit(1);
});
