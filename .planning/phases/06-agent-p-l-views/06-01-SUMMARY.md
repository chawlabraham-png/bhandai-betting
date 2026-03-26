---
phase: 06-agent-p-l-views
plan: 01
subsystem: ui
tags: [agent-dashboard, settlement-results, pnl, expandable-rows, vanilla-js]

# Dependency graph
requires:
  - "settlement_results table and settle_match_market agent P&L extension (Phase 5, plan 01)"
provides:
  - "Agent P&L summary from actual settlement_results data (not client-side estimates)"
  - "Per-market expandable detail rows with per-client breakdown"
  - "Per-client aggregated settled P&L with commission and agent net"
  - "toggleMarketDetail() expand/collapse function for detail rows"
affects: [06-02-live-exposure, 07-agent-mobile-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [settlement-results-driven-pnl, expandable-detail-row-with-toggle, per-client-settled-aggregation]

key-files:
  created: []
  modified: [agent.html]

key-decisions:
  - "Replaced all estimated P&L computations with actual settlement_results data for summary stats"
  - "Per-client settled P&L computed by iterating settled event orders and matching winning_outcome"
  - "Agent net per client uses current partnership_share since it aggregates across markets"
  - "Commission matching for per-market client detail uses notes field text search on event title"

patterns-established:
  - "Settlement-results-driven P&L: allSettlementResults.reduce() pattern for summary stats from authoritative settlement data"
  - "Expandable detail row: main <tr> + hidden pnl-detail-row <tr> with toggleMarketDetail() onclick"
  - "Color convention: green (#10b981) positive, red (#ef4444) negative, purple (#a78bfa) commission throughout P&L tab"

requirements-completed: [APNL-07, APNL-08, APNL-09]

# Metrics
duration: 8min
completed: 2026-03-26
---

# Phase 06 Plan 01: Agent P&L Views Summary

**Agent P&L tab rewritten from estimated to actual settlement_results data with per-market expandable drill-down showing client breakdowns and per-client aggregated settled P&L with agent net computation**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-25T17:26:03Z
- **Completed:** 2026-03-26T09:22:41Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Replaced all estimated P&L summary stats with actual settlement_results data (total_client_pnl, agent_commission_share, agent_pnl_share, agent_net_pnl)
- Per-market table shows each settlement result with expandable per-client breakdown (staked, shares, P&L, commission)
- Per-client table aggregates settled P&L across all settled markets with commission received and agent net per client
- Color-coded throughout: green positive, red negative, purple commission -- consistent with established COMMISSION UI pattern

## Task Commits

Each task was committed atomically:

1. **Task 1: Load settlement_results in refreshData and rewrite P&L summary stats** - `566ce54` (feat)
2. **Task 2: Per-market expandable detail and per-client aggregated detail** - `b69f06e` (feat)

## Files Created/Modified

- `agent.html` - Added allSettlementResults global, settlement_results query in refreshData(), rewrote renderPnL() with settlement-driven summary stats, per-market expandable detail rows with per-client breakdown, per-client aggregated settled P&L table, toggleMarketDetail() function, and pnl-detail-row CSS

## Decisions Made

- **Settlement_results as sole data source for summary stats:** All four stat cards now compute from allSettlementResults.reduce() instead of estimates from allOrders. This ensures agents see authoritative settled figures matching what the RPCs computed at settlement time.
- **Per-client settled P&L from orders + winning_outcome:** Since settlement_results is per-agent-per-market (not per-client), the per-client view iterates settled event orders and computes P&L by matching outcome title to winning_outcome. This follows D-07 from context.
- **Commission matching via notes text search:** Per-market client commission lookup filters allTransactions by COMMISSION type and notes containing the event title. This leverages the notes field populated by settlement RPCs in Phases 2-3.
- **Current partnership_share for per-client aggregation:** Per-client agent net uses the agent's current partnership_share (not per-market snapshot) since it aggregates across multiple markets where the snapshot rate may have differed. The per-market table uses partnership_share_at_settlement for accuracy.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

- **Missing .git/HEAD file:** The git repository's HEAD file was missing (likely removed by a worktree cleanup). Recreated with `ref: refs/heads/main` to restore git functionality. No impact on code changes.

## Known Stubs

None -- all data sources are wired to settlement_results and orders tables with no placeholder values.

## Next Plan Readiness

- Plan 06-02 (live exposure tracking and admin settlement cards) can build on the allSettlementResults pattern established here
- The toggleMarketDetail() expand/collapse pattern can be reused for live exposure detail if needed
- Per-client computation pattern (iterating settled events, matching winning_outcome) can inform live P&L estimates

## Self-Check: PASSED

- [x] agent.html exists
- [x] 06-01-SUMMARY.md exists
- [x] Task 1 commit 566ce54 verified in git log
- [x] Task 2 commit b69f06e verified in git log

---
*Phase: 06-agent-p-l-views*
*Completed: 2026-03-26*
