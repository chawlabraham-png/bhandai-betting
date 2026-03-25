-- Phase 2: COMM-01..05, Phase 5: APNL-01..06
-- Atomic match market settlement with commission and agent P&L.
-- Replaces the client-side settlement loop in admin.html (lines 2827-2892)
-- with a single atomic PostgreSQL function.
--
-- Commission model (per Phase 2 CONTEXT.md D-01/D-04):
--   Commission IS a coin credit to clients (rebate/incentive).
--   Calculated as match_commission% of net loss per market.
--   Zero if client wins or has match_commission = 0.
--   Rate capped at parent agent's rate (D-12).
--   FLOOR-rounded to favor admin (D-10).
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
--
-- Uses SECURITY INVOKER (Supabase default) -- runs with caller's
-- permissions, respecting RLS. No elevated privileges needed.

CREATE OR REPLACE FUNCTION public.settle_match_market(
  p_event_id         UUID,
  p_winning_outcome_id UUID,
  p_settled_by       UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_event         RECORD;
  v_winning_title TEXT;
  v_rate_team_oc  RECORD;
  v_fav_team_won  BOOLEAN;
  v_user          RECORD;
  v_order         RECORD;
  v_fw            NUMERIC;
  v_fl            NUMERIC;
  v_exposure      NUMERIC;
  v_net_pnl       NUMERIC;
  v_settle_amt    NUMERIC;
  v_comm_rate     NUMERIC;
  v_parent_rate   NUMERIC;
  v_effective_rate NUMERIC;
  v_commission    NUMERIC;
  v_total_payout  NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_users_settled INTEGER := 0;
  v_result        JSONB;

  -- Phase 5: Agent P&L variables (JSONB accumulator pattern)
  v_agent_accum   JSONB := '{}'::JSONB;   -- {agent_id: {pnl: N, comm: N}}
  v_agent_key     TEXT;
  v_agent_rec     RECORD;
  v_agent_pnl     NUMERIC;
  v_agent_comm    NUMERIC;
  v_agent_net     NUMERIC;
  v_agent_share   NUMERIC;
  v_parent_role   TEXT;                    -- to check if parent is AGENT (D-14)
  v_agent_results JSONB := '[]'::JSONB;   -- return value (D-12)
  v_agent_login_id TEXT;                   -- for display convenience in return array
BEGIN

  -- ═══════════════════════════════════════════════════════════════════
  -- Section 1: Validate and lock event
  -- ═══════════════════════════════════════════════════════════════════

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

  SELECT title INTO v_winning_title
    FROM public.outcomes
   WHERE id = p_winning_outcome_id;

  IF v_winning_title IS NULL THEN
    RAISE EXCEPTION 'Winning outcome not found: %', p_winning_outcome_id;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- Section 2: Determine if favored team won
  -- ═══════════════════════════════════════════════════════════════════

  SELECT * INTO v_rate_team_oc
    FROM public.outcomes
   WHERE event_id = p_event_id
     AND title = v_event.rate_team
   LIMIT 1;

  v_fav_team_won := (v_rate_team_oc.id = p_winning_outcome_id);

  -- ═══════════════════════════════════════════════════════════════════
  -- Section 3: Mark event settled
  -- ═══════════════════════════════════════════════════════════════════

  UPDATE public.events
     SET status = 'SETTLED',
         is_resolved = true,
         winning_outcome = v_winning_title
   WHERE id = p_event_id;

  UPDATE public.outcomes
     SET is_winner = true
   WHERE id = p_winning_outcome_id;

  -- ═══════════════════════════════════════════════════════════════════
  -- Section 4: Process each user with orders (core settlement loop)
  -- ═══════════════════════════════════════════════════════════════════

  FOR v_user IN
    SELECT DISTINCT o.user_id, bu.match_commission, bu.parent_id
      FROM public.orders o
      JOIN public.betting_users bu ON bu.id = o.user_id
     WHERE o.outcome_id IN (SELECT id FROM public.outcomes WHERE event_id = p_event_id)
       AND o.status = 'OPEN'
     GROUP BY o.user_id, bu.match_commission, bu.parent_id
  LOOP

    -- ─────────────────────────────────────────────────────────────────
    -- 4a: Compute net P&L using exposure model
    --     Hedged positions handled by aggregating all orders (D-14)
    -- ─────────────────────────────────────────────────────────────────

    v_fw := 0;
    v_fl := 0;

    FOR v_order IN
      SELECT * FROM public.orders
       WHERE user_id = v_user.user_id
         AND outcome_id IN (SELECT id FROM public.outcomes WHERE event_id = p_event_id)
         AND status = 'OPEN'
    LOOP
      IF v_order.bet_side = 'LAGAI' THEN
        v_fw := v_fw + v_order.total_cost * v_order.price_per_share;
        v_fl := v_fl - v_order.total_cost;
      ELSIF v_order.bet_side = 'KHAI' THEN
        v_fw := v_fw - v_order.total_cost;
        v_fl := v_fl + v_order.total_cost / v_order.price_per_share;
      END IF;

      -- Mark order settled
      UPDATE public.orders SET status = 'SETTLED' WHERE id = v_order.id;
    END LOOP;

    v_exposure := GREATEST(0, -LEAST(v_fw, v_fl));
    v_net_pnl := CASE WHEN v_fav_team_won THEN v_fw ELSE v_fl END;
    v_settle_amt := ROUND(v_exposure + v_net_pnl, 2);

    -- ─────────────────────────────────────────────────────────────────
    -- 4b: Look up parent info (combined for commission cap + agent P&L)
    --     Single query per user avoids N+1 redundancy (Pitfall #5).
    --     Fetches match_commission (for cap), role (for D-14 AGENT check),
    --     and partnership_share (for agent P&L accumulation).
    -- ─────────────────────────────────────────────────────────────────

    v_parent_rate := NULL;
    v_parent_role := NULL;
    v_agent_share := NULL;

    IF v_user.parent_id IS NOT NULL THEN
      SELECT match_commission, role, partnership_share
        INTO v_parent_rate, v_parent_role, v_agent_share
        FROM public.betting_users
       WHERE id = v_user.parent_id;
    END IF;

    -- ─────────────────────────────────────────────────────────────────
    -- 4c: Compute commission (D-01/D-02/D-05/D-06-NEW/D-10/D-12)
    --     Commission only when: client lost (net_pnl < 0) AND rate > 0
    -- ─────────────────────────────────────────────────────────────────

    v_commission := 0;

    IF v_net_pnl < 0 THEN
      v_comm_rate := COALESCE(v_user.match_commission, 0);

      -- D-06-NEW: skip if rate is 0
      IF v_comm_rate > 0 THEN
        -- D-12: cap at parent agent's rate
        IF v_parent_rate IS NOT NULL AND v_comm_rate > v_parent_rate THEN
          v_comm_rate := v_parent_rate;
        END IF;

        -- D-10: FLOOR to favor admin (commission is credit TO client, less = admin favor)
        v_commission := FLOOR(ABS(v_net_pnl) * v_comm_rate / 100.0 * 100.0) / 100.0;
      END IF;
    END IF;

    -- ─────────────────────────────────────────────────────────────────
    -- 4d: Credit settlement amount (exposure refund + P&L)
    -- ─────────────────────────────────────────────────────────────────

    IF v_settle_amt > 0 THEN
      UPDATE public.betting_users
         SET balance = balance + v_settle_amt
       WHERE id = v_user.user_id;

      INSERT INTO public.credit_transactions
        (sender_id, receiver_id, amount, transaction_type, notes)
      VALUES (
        p_settled_by, v_user.user_id, v_settle_amt, 'SETTLEMENT',
        format('Match settled: %s won in %s', v_winning_title, v_event.title)
      );

      v_total_payout := v_total_payout + v_settle_amt;
    END IF;

    -- ─────────────────────────────────────────────────────────────────
    -- 4e: Credit commission (independent of settle_amt -- Pitfall #6)
    --     A pure loser with settle_amt=0 still gets commission.
    --     Sender = admin (p_settled_by), receiver = client (coin credit)
    -- ─────────────────────────────────────────────────────────────────

    IF v_commission > 0 THEN
      UPDATE public.betting_users
         SET balance = balance + v_commission
       WHERE id = v_user.user_id;

      INSERT INTO public.credit_transactions
        (sender_id, receiver_id, amount, transaction_type, notes)
      VALUES (
        p_settled_by, v_user.user_id, v_commission, 'COMMISSION',
        format('Match commission: %s%% on loss of %s in %s',
          v_comm_rate, ROUND(ABS(v_net_pnl), 2), v_event.title)
      );

      v_total_commission := v_total_commission + v_commission;
    END IF;

    -- ─────────────────────────────────────────────────────────────────
    -- 4f: Accumulate agent P&L (per D-09, D-11)
    --     Runs for ALL users, not just losers.
    --     Only accumulates for clients whose parent is role='AGENT' (D-14)
    --     and has partnership_share > 0 (discretion: skip 0% agents).
    --     Uses parent info already fetched in 4b (no extra query).
    --
    --     Sign convention (Pitfall #1): v_net_pnl is from CLIENT
    --     perspective (negative = client lost). The negation to get
    --     agent perspective happens in Section 5 (agent loop), NOT here.
    --     v_commission is always >= 0 (credit to client). Accumulate as-is.
    -- ─────────────────────────────────────────────────────────────────

    IF v_user.parent_id IS NOT NULL
       AND v_parent_role = 'AGENT'
       AND COALESCE(v_agent_share, 0) > 0
    THEN
      v_agent_key := v_user.parent_id::TEXT;
      IF v_agent_accum ? v_agent_key THEN
        v_agent_accum := jsonb_set(
          v_agent_accum,
          ARRAY[v_agent_key, 'pnl'],
          to_jsonb((v_agent_accum->v_agent_key->>'pnl')::NUMERIC + v_net_pnl)
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
          jsonb_build_object('pnl', v_net_pnl, 'comm', v_commission)
        );
      END IF;
    END IF;

    v_users_settled := v_users_settled + 1;

  END LOOP;

  -- ═══════════════════════════════════════════════════════════════════
  -- Section 5: Agent P&L -- compute shares and persist (D-09, D-11)
  --   For each agent accumulated in Section 4f:
  --   - Look up partnership_share from betting_users (snapshot at settlement)
  --   - agent_pnl_share = FLOOR((-total_client_pnl) * share / 100 * 100) / 100
  --     (negate client P&L: if clients lost, agent earns -- D-01, Pitfall #1)
  --   - agent_commission_share = FLOOR(total_commission * share / 100 * 100) / 100
  --     (agent bears their share of commission cost -- D-02)
  --   - agent_net_pnl = agent_pnl_share - agent_commission_share (D-03)
  --   - No floor at zero -- agent can go negative (D-04)
  --   - FLOOR rounding favors admin (D-15)
  -- ═══════════════════════════════════════════════════════════════════

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

  -- ═══════════════════════════════════════════════════════════════════
  -- Section 6: Build and return result summary
  -- ═══════════════════════════════════════════════════════════════════

  v_result := jsonb_build_object(
    'event_id', p_event_id,
    'winning_outcome_id', p_winning_outcome_id,
    'winning_title', v_winning_title,
    'users_settled', v_users_settled,
    'total_payout', v_total_payout,
    'total_commission', v_total_commission,
    'agent_results', v_agent_results
  );

  RETURN v_result;

END;
$$;
