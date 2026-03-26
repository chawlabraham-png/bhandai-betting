-- Phase 3: COMM-06..10, Phase 5: APNL-01..06
-- Atomic fancy market settlement with commission and agent P&L.
-- Replaces the client-side settlement loop in admin.html (lines 2863-2919)
-- with a single atomic PostgreSQL function.
--
-- Commission model (per Phase 3 CONTEXT.md D-01/D-02/D-04/D-05):
--   Commission IS a coin credit to clients (rebate/incentive).
--   Calculated as fancy_commission% of total volume (SUM of total_cost).
--   Paid regardless of win or loss (unlike match which is losses only).
--   Rate capped at parent agent's rate (D-08).
--   FLOOR-rounded to favor admin (D-09).
--
-- Agent P&L model (per Phase 5 CONTEXT.md D-01..D-15):
--   For each agent whose clients had orders in this market:
--   - agent_pnl_share = partnership_share% of negated client P&L sum
--     (clients lose -> agent earns; clients win -> agent owes upward)
--   - agent_commission_share = partnership_share% of commission paid to clients
--   - agent_net_pnl = pnl_share - commission_share (can go negative, D-04)
--   - Results persisted in settlement_results table (INSERT-only, D-07)
--   - partnership_share snapshot frozen at settlement time (D-05)
--   - Only clients with AGENT-role parent generate entries (D-13/D-14)
--   - Agents with 0% partnership_share are skipped (discretion: reduces noise)
--   - FLOOR rounding favors admin (D-15)
--   - PITFALL #3: Fancy net P&L = v_total_payout_user - v_total_volume
--     (no pre-computed v_net_pnl variable like match RPC)
--
-- Uses SECURITY INVOKER (Supabase default).

CREATE OR REPLACE FUNCTION public.settle_fancy_market(
  p_event_id      UUID,
  p_result_value  NUMERIC,
  p_settled_by    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_event             RECORD;
  v_line_value        NUMERIC;       -- event-level line_value for outcome is_winner
  v_user              RECORD;        -- from user loop query
  v_order             RECORD;        -- from order loop
  v_is_win            BOOLEAN;
  v_payout            NUMERIC;       -- per-order payout (stake * bp if win, 0 if loss)
  v_total_payout_user NUMERIC;       -- sum of payouts for one user
  v_total_volume      NUMERIC;       -- sum of total_cost for one user (commission base)
  v_comm_rate         NUMERIC;
  v_parent_rate       NUMERIC;
  v_commission        NUMERIC;
  v_total_payout      NUMERIC := 0;  -- grand total across all users
  v_total_commission  NUMERIC := 0;
  v_users_settled     INTEGER := 0;
  v_winners_count     INTEGER := 0;
  v_losers_count      INTEGER := 0;
  v_result            JSONB;

  -- Phase 5: Agent P&L variables (JSONB accumulator pattern)
  v_agent_accum       JSONB := '{}'::JSONB;   -- {agent_id: {pnl: N, comm: N}}
  v_agent_key         TEXT;
  v_agent_rec         RECORD;
  v_agent_pnl         NUMERIC;
  v_agent_comm        NUMERIC;
  v_agent_net         NUMERIC;
  v_agent_share       NUMERIC;
  v_parent_role       TEXT;                    -- to check if parent is AGENT (D-14)
  v_agent_results     JSONB := '[]'::JSONB;   -- return value (D-12)
  v_agent_login_id    TEXT;                    -- for display convenience in return array
  v_fancy_net_pnl     NUMERIC;                -- Pitfall #3: fancy net P&L = payout - volume
BEGIN

  -- =====================================================================
  -- Section 1: Validate and lock event
  -- =====================================================================

  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found: %', p_event_id;
  END IF;

  IF v_event.status = 'SETTLED' THEN
    RAISE EXCEPTION 'Event already settled: %', p_event_id;
  END IF;

  IF p_result_value IS NULL THEN
    RAISE EXCEPTION 'Result value is required';
  END IF;

  -- Store event-level line_value for cosmetic outcome is_winner update
  v_line_value := v_event.line_value;

  -- =====================================================================
  -- Section 2: Mark event settled and update outcomes
  -- =====================================================================

  UPDATE public.events
     SET status = 'SETTLED',
         is_resolved = true,
         result_value = p_result_value
   WHERE id = p_event_id;

  -- Update outcome is_winner for YES outcome (cosmetic for display,
  -- uses event-level line_value NOT per-order line_at_bet -- per Pitfall #6)
  UPDATE public.outcomes
     SET is_winner = true
   WHERE event_id = p_event_id
     AND UPPER(title) = 'YES'
     AND p_result_value >= v_line_value;

  UPDATE public.outcomes
     SET is_winner = true
   WHERE event_id = p_event_id
     AND UPPER(title) = 'NO'
     AND p_result_value < v_line_value;

  -- =====================================================================
  -- Section 3: Process each user with orders (core settlement loop)
  -- =====================================================================

  FOR v_user IN
    SELECT DISTINCT o.user_id, bu.fancy_commission, bu.parent_id
      FROM public.orders o
      JOIN public.betting_users bu ON bu.id = o.user_id
     WHERE o.outcome_id IN (SELECT id FROM public.outcomes WHERE event_id = p_event_id)
       AND o.status = 'OPEN'
     GROUP BY o.user_id, bu.fancy_commission, bu.parent_id
  LOOP

    -- -----------------------------------------------------------------
    -- 3a: Process orders for this user -- accumulate volume and payout
    -- -----------------------------------------------------------------

    v_total_payout_user := 0;
    v_total_volume := 0;

    FOR v_order IN
      SELECT * FROM public.orders
       WHERE user_id = v_user.user_id
         AND outcome_id IN (SELECT id FROM public.outcomes WHERE event_id = p_event_id)
         AND status = 'OPEN'
    LOOP

      -- Accumulate volume for ALL orders (per D-02, D-15 -- commission base)
      v_total_volume := v_total_volume + v_order.total_cost;

      -- Per-order win determination with gap support:
      -- If line_no_at_bet/line_yes_at_bet set: YES wins if result >= line_yes, NO wins if result <= line_no
      -- House wins if result falls in the gap between line_no and line_yes
      -- Fallback: old logic using line_at_bet for pre-gap orders
      IF v_order.line_no_at_bet IS NOT NULL AND v_order.line_yes_at_bet IS NOT NULL THEN
        v_is_win := (v_order.bet_side = 'YES' AND p_result_value >= v_order.line_yes_at_bet)
                 OR (v_order.bet_side = 'NO'  AND p_result_value <= v_order.line_no_at_bet);
      ELSE
        v_is_win := (v_order.bet_side = 'YES' AND p_result_value >= v_order.line_at_bet)
                 OR (v_order.bet_side = 'NO'  AND p_result_value < v_order.line_at_bet);
      END IF;

      IF v_is_win THEN
        -- Per D-14: winner payout = stake * back_price (stored as price_per_share)
        v_payout := v_order.total_cost * v_order.price_per_share;
        v_total_payout_user := v_total_payout_user + v_payout;
      END IF;

      -- Mark order settled
      UPDATE public.orders SET status = 'SETTLED' WHERE id = v_order.id;

    END LOOP;

    -- -----------------------------------------------------------------
    -- 3b: Credit settlement payout (if any)
    -- -----------------------------------------------------------------

    IF v_total_payout_user > 0 THEN
      UPDATE public.betting_users
         SET balance = balance + v_total_payout_user
       WHERE id = v_user.user_id;

      INSERT INTO public.credit_transactions
        (sender_id, receiver_id, amount, transaction_type, notes)
      VALUES (
        p_settled_by, v_user.user_id, v_total_payout_user, 'SETTLEMENT',
        format('Fancy settled: result %s in %s', p_result_value, v_event.title)
      );

      v_total_payout := v_total_payout + v_total_payout_user;
      v_winners_count := v_winners_count + 1;
    ELSE
      v_losers_count := v_losers_count + 1;
    END IF;

    -- -----------------------------------------------------------------
    -- 3c: Look up parent info (combined for commission cap + agent P&L)
    --     Single query per user avoids N+1 redundancy (Pitfall #5).
    --     Fetches fancy_commission (for cap), role (for D-14 AGENT check),
    --     and partnership_share (for agent P&L accumulation).
    -- -----------------------------------------------------------------

    v_parent_rate := NULL;
    v_parent_role := NULL;
    v_agent_share := NULL;

    IF v_user.parent_id IS NOT NULL THEN
      SELECT fancy_commission, role, partnership_share
        INTO v_parent_rate, v_parent_role, v_agent_share
        FROM public.betting_users
       WHERE id = v_user.parent_id;
    END IF;

    -- -----------------------------------------------------------------
    -- 3d: Compute and credit commission (per D-02, D-05, D-06, D-08, D-09)
    --     CRITICAL: NOT gated by win/loss (Pitfall #1 from research).
    --     Commission applies to ALL users with volume, regardless of outcome.
    -- -----------------------------------------------------------------

    v_commission := 0;
    v_comm_rate := COALESCE(v_user.fancy_commission, 0);

    -- D-06: skip if rate is 0
    IF v_comm_rate > 0 THEN
      -- D-08: cap at parent agent's rate (uses v_parent_rate from 3c)
      IF v_parent_rate IS NOT NULL AND v_comm_rate > v_parent_rate THEN
        v_comm_rate := v_parent_rate;
      END IF;

      -- D-09: FLOOR rounding, same as match (less to client, favors admin)
      -- D-02: Commission base is total_volume (SUM of total_cost), NOT net_pnl
      v_commission := FLOOR(v_total_volume * v_comm_rate / 100.0 * 100.0) / 100.0;
    END IF;

    IF v_commission > 0 THEN
      UPDATE public.betting_users
         SET balance = balance + v_commission
       WHERE id = v_user.user_id;

      INSERT INTO public.credit_transactions
        (sender_id, receiver_id, amount, transaction_type, notes)
      VALUES (
        p_settled_by, v_user.user_id, v_commission, 'COMMISSION',
        format('Fancy commission: %s%% on volume of %s in %s',
          v_comm_rate, ROUND(v_total_volume, 2), v_event.title)
      );

      v_total_commission := v_total_commission + v_commission;
    END IF;

    -- -----------------------------------------------------------------
    -- 3f: Accumulate agent P&L (per D-09, D-11)
    --     Runs for ALL users, not just losers.
    --     Only accumulates for clients whose parent is role='AGENT' (D-14)
    --     and has partnership_share > 0 (discretion: skip 0% agents).
    --     Uses parent info already fetched in 3c (no extra query).
    --
    --     PITFALL #3: Fancy does NOT have a v_net_pnl variable.
    --     Compute v_fancy_net_pnl = v_total_payout_user - v_total_volume.
    --     Same sign convention as match: negative = client lost.
    --
    --     v_commission is always >= 0 (credit to client). Accumulate as-is.
    -- -----------------------------------------------------------------

    v_fancy_net_pnl := v_total_payout_user - v_total_volume;

    IF v_user.parent_id IS NOT NULL
       AND v_parent_role = 'AGENT'
       AND COALESCE(v_agent_share, 0) > 0
    THEN
      v_agent_key := v_user.parent_id::TEXT;
      IF v_agent_accum ? v_agent_key THEN
        v_agent_accum := jsonb_set(
          v_agent_accum,
          ARRAY[v_agent_key, 'pnl'],
          to_jsonb((v_agent_accum->v_agent_key->>'pnl')::NUMERIC + v_fancy_net_pnl)
        );
        v_agent_accum := jsonb_set(
          v_agent_accum,
          ARRAY[v_agent_key, 'comm'],
          to_jsonb((v_agent_accum->v_agent_key->>'comm')::NUMERIC + v_commission)
        );
      ELSE
        v_agent_accum := jsonb_set(
          v_agent_accum,
          ARRAY[v_agent_key],
          jsonb_build_object('pnl', v_fancy_net_pnl, 'comm', v_commission)
        );
      END IF;
    END IF;

    v_users_settled := v_users_settled + 1;

  END LOOP;

  -- =====================================================================
  -- Section 3g: Agent P&L -- compute shares and persist (D-09, D-11)
  --   Same logic as settle_match_market Section 5.
  --   For each agent accumulated in Section 3f:
  --   - Look up partnership_share from betting_users (snapshot at settlement)
  --   - agent_pnl_share = FLOOR((-total_client_pnl) * share / 100 * 100) / 100
  --     (negate client P&L: if clients lost, agent earns -- D-01, Pitfall #1)
  --   - agent_commission_share = FLOOR(total_commission * share / 100 * 100) / 100
  --     (agent bears their share of commission cost -- D-02)
  --   - agent_net_pnl = agent_pnl_share - agent_commission_share (D-03)
  --   - No floor at zero -- agent can go negative (D-04)
  --   - FLOOR rounding favors admin (D-15)
  -- =====================================================================

  FOR v_agent_rec IN
    SELECT key AS agent_id,
           (value->>'pnl')::NUMERIC AS total_client_pnl,
           (value->>'comm')::NUMERIC AS total_commission
      FROM jsonb_each(v_agent_accum)
  LOOP
    -- Read the partnership_share at settlement time (D-05 snapshot)
    SELECT partnership_share, login_id INTO v_agent_share, v_agent_login_id
      FROM public.betting_users
     WHERE id = v_agent_rec.agent_id::UUID;

    v_agent_share := COALESCE(v_agent_share, 0);

    -- D-01: Agent earns when clients lose. Client P&L negative = client lost.
    -- Negate total_client_pnl so agent_pnl_share is positive when clients lost.
    -- D-15: FLOOR rounding favors admin (agent gets less)
    v_agent_pnl := FLOOR((-v_agent_rec.total_client_pnl) * v_agent_share / 100.0 * 100.0) / 100.0;

    -- D-02: Agent bears share of commission cost
    v_agent_comm := FLOOR(v_agent_rec.total_commission * v_agent_share / 100.0 * 100.0) / 100.0;

    -- D-03: Net = P&L share minus commission cost share
    -- D-04: No GREATEST(0,...) -- agent can go negative
    v_agent_net := v_agent_pnl - v_agent_comm;

    -- D-06, D-07: INSERT-only into settlement_results (append-only audit)
    INSERT INTO public.settlement_results (
      event_id, agent_id, total_client_pnl, total_commission_paid,
      agent_pnl_share, agent_commission_share, agent_net_pnl,
      partnership_share_at_settlement, settled_at
    ) VALUES (
      p_event_id, v_agent_rec.agent_id::UUID, v_agent_rec.total_client_pnl,
      v_agent_rec.total_commission, v_agent_pnl, v_agent_comm, v_agent_net,
      v_agent_share, NOW()
    );

    -- D-12: Build agent_results return array
    v_agent_results := v_agent_results || jsonb_build_object(
      'agent_id', v_agent_rec.agent_id,
      'login_id', v_agent_login_id,
      'pnl_share', v_agent_pnl,
      'commission_cost', v_agent_comm,
      'net_pnl', v_agent_net
    );
  END LOOP;

  -- =====================================================================
  -- Section 4: Build and return result summary
  -- =====================================================================

  v_result := jsonb_build_object(
    'event_id', p_event_id,
    'result_value', p_result_value,
    'users_settled', v_users_settled,
    'total_payout', v_total_payout,
    'total_commission', v_total_commission,
    'winners_count', v_winners_count,
    'losers_count', v_losers_count,
    'agent_results', v_agent_results
  );

  RETURN v_result;

END;
$$;
