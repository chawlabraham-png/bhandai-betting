-- Phase 3: COMM-06..10 -- Atomic fancy market settlement with commission
-- Replaces the client-side settlement loop in admin.html (lines 2863-2919)
-- with a single atomic PostgreSQL function.
--
-- Commission model (per CONTEXT.md D-01/D-02/D-04/D-05):
--   Commission IS a coin credit to clients (rebate/incentive).
--   Calculated as fancy_commission% of total volume (SUM of total_cost).
--   Paid regardless of win or loss (unlike match which is losses only).
--   Rate capped at parent agent's rate (D-08).
--   FLOOR-rounded to favor admin (D-09).
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

      -- Per-order win determination (per D-13 -- uses order's line_at_bet, NOT event line_value)
      v_is_win := (v_order.bet_side = 'YES' AND p_result_value >= v_order.line_at_bet)
               OR (v_order.bet_side = 'NO'  AND p_result_value < v_order.line_at_bet);

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
    -- 3c: Compute and credit commission (per D-02, D-05, D-06, D-08, D-09)
    --     CRITICAL: NOT gated by win/loss (Pitfall #1 from research).
    --     Commission applies to ALL users with volume, regardless of outcome.
    -- -----------------------------------------------------------------

    v_commission := 0;
    v_comm_rate := COALESCE(v_user.fancy_commission, 0);

    -- D-06: skip if rate is 0
    IF v_comm_rate > 0 THEN
      -- D-08: cap at parent agent's rate
      IF v_user.parent_id IS NOT NULL THEN
        SELECT fancy_commission INTO v_parent_rate
          FROM public.betting_users
         WHERE id = v_user.parent_id;

        IF v_parent_rate IS NOT NULL AND v_comm_rate > v_parent_rate THEN
          v_comm_rate := v_parent_rate;
        END IF;
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

    v_users_settled := v_users_settled + 1;

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
    'losers_count', v_losers_count
  );

  RETURN v_result;

END;
$$;
