---
phase: 05-agent-p-l-core
plan: 01
subsystem: database
tags: [postgres, rpc, settlement, agent-pnl, supabase, plpgsql, jsonb-accumulator]

# Dependency graph
requires:
  - "Atomic settle_match_market RPC with commission (Phase 2, plan 01)"
provides:
  - "settlement_results table for per-agent-per-market P&L snapshots"
  - "settle_match_market RPC extended with agent P&L accumulation, persistence, and return"
  - "JSONB accumulator pattern for per-agent aggregation inside settlement RPCs"
affects: [05-02-fancy-settlement, 06-agent-dashboard]

# Tech tracking
tech-stack:
  added: [settlement_results table]
  patterns: [jsonb-accumulator-for-agent-pnl, combined-parent-lookup, floor-rounding-agent-shares, sign-negation-client-to-agent]

key-files:
  created: [sql/005_settlement_results_table.sql]
  modified: [sql/003_settle_match_market_rpc.sql]

key-decisions:
  - "Combined parent lookup (match_commission + role + partnership_share) in one query to avoid N+1 (Pitfall #5)"
  - "Moved parent lookup outside v_net_pnl < 0 block so it runs for ALL users (needed for agent P&L on winners too)"
  - "Skip agents with 0% partnership_share (discretion: reduces noise in settlement_results)"
  - "UNIQUE index on (event_id, agent_id) prevents double-settlement bugs at DB level"
  - "Flat agent_results array with login_id for display convenience (D-12 discretion)"
  - "Section numbering shifted: commission is now 4c, settlement credit 4d, commission credit 4e, agent accumulation 4f, agent P&L loop is Section 5, return is Section 6"

patterns-established:
  - "JSONB accumulator pattern: v_agent_accum := '{}'::JSONB accumulates per-agent totals during user loop, then iterated in post-loop section"
  - "Combined parent lookup: SELECT match_commission, role, partnership_share INTO multiple variables in single query"
  - "Agent P&L sign convention: negate client P&L (FLOOR((-total_client_pnl) * share / 100 * 100) / 100) so agent earns positive when clients lose"
  - "settlement_results as INSERT-only append audit table with partnership_share snapshot frozen at settlement time"

requirements-completed: [APNL-01, APNL-02, APNL-03, APNL-04, APNL-05, APNL-06]

# Metrics
duration: 3min
completed: 2026-03-25
---

# Phase 05 Plan 01: Agent P&L Core Summary

**settlement_results table and settle_match_market RPC extension that accumulates per-agent client P&L/commission via JSONB accumulator during user loop, computes FLOOR-rounded partnership shares with sign negation, and persists frozen snapshots for agent financial reporting**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-25T16:49:36Z
- **Completed:** 2026-03-25T16:53:03Z
- **Tasks:** 2
- **Files created/modified:** 2

## Accomplishments

- Created settlement_results table (sql/005_settlement_results_table.sql) with NUMERIC(15,2) monetary columns, DECIMAL(5,2) partnership share snapshot, UNIQUE index on (event_id, agent_id), and RLS policy
- Extended settle_match_market RPC with JSONB accumulator that collects per-agent client P&L and commission totals during the user loop in a single pass
- Added new Section 5 (agent P&L loop) that computes partnership_share% of negated client P&L and commission, uses FLOOR rounding favoring admin, and INSERTs into settlement_results
- Agent P&L can go negative (no GREATEST(0,...) clamp) per D-04 -- agent owes upward when clients net win
- Extended RPC return JSONB with agent_results array containing agent_id, login_id, pnl_share, commission_cost, net_pnl per D-12
- Combined parent lookup (match_commission + role + partnership_share) in single query per Pitfall #5, eliminating N+1 redundancy

## Task Commits

Each task was committed atomically:

1. **Task 1: Create settlement_results table migration** - `aac08d1` (feat)
2. **Task 2: Extend settle_match_market RPC with agent P&L calculation** - `f5880ce` (feat)

## Files Created/Modified

- `sql/005_settlement_results_table.sql` - New table DDL with indexes, unique constraint, and RLS for per-agent-per-market P&L snapshots
- `sql/003_settle_match_market_rpc.sql` - Extended match settlement RPC with agent P&L accumulation (Section 4f), computation (Section 5), and return (Section 6)

## Decisions Made

- **Combined parent lookup (Pitfall #5 fix):** Moved the parent lookup outside the `v_net_pnl < 0` block and extended it to fetch `match_commission`, `role`, and `partnership_share` in a single SELECT. This avoids a separate query for agent P&L info and ensures parent data is available for all users (winners and losers alike), not just losing clients in the commission block.
- **Skip 0% partnership_share agents:** Agents with 0% partnership_share are excluded from accumulation entirely (checked in Section 4f guard). This keeps settlement_results clean and avoids meaningless zero-value rows.
- **Section renumbering:** The existing Section 4b (commission) became 4c, Section 4c (settlement credit) became 4d, Section 4d (commission credit) became 4e, to accommodate the new Section 4b (parent lookup) and Section 4f (agent accumulation). The old Section 5 (return) became Section 6, with the new Section 5 handling agent P&L computation and persistence.
- **Flat agent_results array with login_id:** Per D-12 discretion, the agent_results array includes login_id for display convenience in admin toast messages and future UI.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Optimization] Combined parent lookup to avoid N+1 queries (Pitfall #5)**
- **Found during:** Task 2 (planning phase, checker warning)
- **Issue:** Plan specified a SEPARATE parent lookup in Section 4e for agent P&L, which would duplicate the existing parent query in the commission block -- an N+1 pattern
- **Fix:** Moved parent lookup BEFORE the commission block (new Section 4b), extended SELECT to fetch match_commission, role, and partnership_share in one query. Both commission capping and agent accumulation use the pre-fetched values.
- **Files modified:** sql/003_settle_match_market_rpc.sql
- **Verification:** grep confirms single SELECT with `match_commission, role, partnership_share`
- **Committed in:** f5880ce (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 optimization per checker warning)
**Impact on plan:** Query optimization improves per-user performance. No behavioral change. Same data, fewer round-trips.

## Issues Encountered

None.

## User Setup Required

**External service requires manual deployment.** The updated RPC and new table must be deployed to Supabase:
1. Run `sql/005_settlement_results_table.sql` in Supabase SQL Editor (creates table)
2. Run `sql/003_settle_match_market_rpc.sql` in Supabase SQL Editor (updates RPC)

## Known Stubs

None -- both files are complete SQL with no placeholder logic, TODO markers, or stub values.

## Next Plan Readiness

- Plan 05-02 (fancy settlement) can reuse the identical JSONB accumulator pattern established here
- The settlement_results table is ready to receive rows from both match and fancy RPCs
- Phase 6 (agent dashboard) will query settlement_results by agent_id for P&L display

## Self-Check: PASSED

- [x] sql/005_settlement_results_table.sql exists
- [x] sql/003_settle_match_market_rpc.sql exists
- [x] 05-01-SUMMARY.md exists
- [x] Task 1 commit aac08d1 verified in git log
- [x] Task 2 commit f5880ce verified in git log

---
*Phase: 05-agent-p-l-core*
*Completed: 2026-03-25*
