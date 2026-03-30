-- ============================================================
-- Migration 008: Admin Wallet + User Financial Tracking
-- ============================================================
--
-- Section 1: admin_wallet
--   A single-row table tracking the admin's physical cash reserve
--   and total coins in circulation. Used to reconcile how much
--   real money backs the platform's coin economy.
--   reserve_cash  — physical INR held by admin
--   coins_stock   — total coins minted and available to distribute
--   updated_at    — last time either value was changed
--
-- Section 2: betting_users additions
--   Per-user financial columns for agent/client ledger tracking:
--   coins_issued  — total coins given to this user by admin/agent
--   cash_paid     — real cash actually received from this user
--   credit_limit  — maximum coins this user can hold on credit
-- ============================================================


-- ── SECTION 1: admin_wallet ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_wallet (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    reserve_cash  NUMERIC(15, 2) NOT NULL DEFAULT 0,
    coins_stock   NUMERIC(15, 2) NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the single default row (safe to re-run — does nothing if row exists)
INSERT INTO public.admin_wallet (reserve_cash, coins_stock)
SELECT 0, 0
WHERE NOT EXISTS (SELECT 1 FROM public.admin_wallet);

-- Enable RLS (admin-only access enforced at app layer via service role key)
ALTER TABLE public.admin_wallet ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to wallet"
  ON public.admin_wallet FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ── SECTION 2: betting_users — financial tracking columns ────

ALTER TABLE public.betting_users
  ADD COLUMN IF NOT EXISTS coins_issued  NUMERIC(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_paid     NUMERIC(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit  NUMERIC(15, 2) DEFAULT 0;
