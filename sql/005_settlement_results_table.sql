-- Phase 5: APNL-06 -- settlement_results table for per-agent-per-market P&L snapshots
--
-- This table is INSERT-only (append-only audit trail, per D-07).
-- Never UPDATE or DELETE rows after creation.
--
-- Populated inside settle_match_market and settle_fancy_market RPCs
-- at settlement time (D-05, D-08). Each row captures the agent's
-- partnership share at the moment of settlement, so rate changes
-- after settlement don't affect recorded P&L.
--
-- One row per agent per settled event. The UNIQUE constraint on
-- (event_id, agent_id) prevents double-settlement bugs.

CREATE TABLE IF NOT EXISTS public.settlement_results (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id                        UUID NOT NULL REFERENCES public.events(id),
    agent_id                        UUID NOT NULL REFERENCES public.betting_users(id),
    total_client_pnl                NUMERIC(15,2) NOT NULL,
    total_commission_paid           NUMERIC(15,2) NOT NULL,
    agent_pnl_share                 NUMERIC(15,2) NOT NULL,
    agent_commission_share          NUMERIC(15,2) NOT NULL,
    agent_net_pnl                   NUMERIC(15,2) NOT NULL,
    partnership_share_at_settlement DECIMAL(5,2) NOT NULL,
    settled_at                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc', now()),
    created_at                      TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Indexes for Phase 6 query performance
CREATE INDEX IF NOT EXISTS idx_settlement_results_event_id
  ON public.settlement_results(event_id);

CREATE INDEX IF NOT EXISTS idx_settlement_results_agent_id
  ON public.settlement_results(agent_id);

-- Unique constraint prevents double-settlement for same agent + event
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_results_event_agent
  ON public.settlement_results(event_id, agent_id);

-- RLS: match existing project pattern (authenticated users can read/write)
ALTER TABLE public.settlement_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read/write settlement_results" ON public.settlement_results;
CREATE POLICY "Allow authenticated read/write settlement_results"
  ON public.settlement_results
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
