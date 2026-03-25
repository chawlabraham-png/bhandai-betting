-- Phase 1: INFRA-01 -- Atomic balance adjustment RPC
-- Replaces the unsafe client-side read-modify-write pattern:
--   SELECT balance -> compute newBal in JS -> UPDATE balance = newBal
-- with atomic: SET balance = balance + p_delta
--
-- Convention: p_delta is ALWAYS the signed amount.
--   Positive = increase (payouts, deposits, refunds)
--   Negative = decrease (deductions, withdrawals)
-- The caller is responsible for the correct sign.
--
-- Uses SECURITY INVOKER (Supabase default) -- runs with caller's
-- permissions, respecting RLS. No elevated privileges needed.
--
-- No balance floor -- balances can go negative by design
-- (exposure-based accounting, agent running balances).

CREATE OR REPLACE FUNCTION public.adjust_balance(
  p_user_id UUID,
  p_delta NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE public.betting_users
  SET balance = balance + p_delta
  WHERE id = p_user_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  RETURN v_new_balance;
END;
$$;
