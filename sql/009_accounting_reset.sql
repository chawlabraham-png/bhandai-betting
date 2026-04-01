-- ============================================================
-- Migration 009: Accounting / Balance Reset
-- ============================================================
--
-- Resets all financial/balance data to zero for a clean slate.
-- Users and events are preserved — only accounting rows are wiped.
--
-- Safe to run multiple times (idempotent via UPDATE, not DELETE
-- for user rows).
--
-- Sections:
--   1. Zero out all non-admin user balances and financial columns
--   2. Delete all credit transactions
--   3. Reset admin_wallet to zero
--   4. Delete all bet orders
--   5. Delete all settlement results
-- ============================================================


-- ── SECTION 1: Zero user balances and financial tracking columns ──

UPDATE public.betting_users
SET
  balance      = 0,
  coins_issued = 0,
  cash_paid    = 0
WHERE role != 'ADMIN';


-- ── SECTION 2: Delete all credit transactions ─────────────────────

DELETE FROM public.credit_transactions;


-- ── SECTION 3: Reset admin_wallet ────────────────────────────────

UPDATE public.admin_wallet
SET
  reserve_cash = 0,
  coins_stock  = 0,
  updated_at   = now();


-- ── SECTION 4: Delete all bet orders ─────────────────────────────

DELETE FROM public.orders;


-- ── SECTION 5: Delete settlement results (if table exists) ───────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'settlement_results'
  ) THEN
    DELETE FROM public.settlement_results;
  END IF;
END $$;
