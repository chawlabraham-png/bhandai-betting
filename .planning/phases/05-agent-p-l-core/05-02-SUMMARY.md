---
phase: 05-agent-p-l-core
plan: 02
status: complete
completed: 2026-03-25
---

# Plan 05-02 Summary — Fancy RPC Agent P&L + Deployment

## What was done

Extended settle_fancy_market RPC with agent P&L calculation (mirroring match RPC pattern) and deployed all 3 Phase 5 SQL files to Supabase.

## Changes

### Task 1: Extend settle_fancy_market RPC with agent P&L
- Extended sql/004_settle_fancy_market_rpc.sql with JSONB accumulator and agent P&L section
- Merged parent lookup (Pitfall #5 fix): single query fetches fancy_commission, role, partnership_share
- Fancy net P&L computed as v_total_payout_user - v_total_volume (Pitfall #3)
- Sign negation: agent earns when clients lose (agent_pnl = -total_client_pnl * share%)
- FLOOR rounding on both agent_pnl and agent_commission
- settlement_results INSERT with all 11 columns
- agent_results array in JSONB return

### Task 2: Deploy to Supabase
- User deployed all 3 SQL files in order:
  1. 005_settlement_results_table.sql (table + indexes)
  2. 003_settle_match_market_rpc.sql (match RPC with agent P&L)
  3. 004_settle_fancy_market_rpc.sql (fancy RPC with agent P&L)

## Verification
- settlement_results table exists: YES (user confirmed)
- settle_fancy_market contains settlement_results INSERT: YES
- settle_fancy_market contains agent_results in return: YES
- All 3 SQL files deployed: YES (user confirmed)
