---
phase: 06-agent-p-l-views
plan: 02
subsystem: ui
tags: [agent-dashboard, admin-dashboard, live-exposure, settlement-results, pnl, vanilla-js]

# Dependency graph
requires:
  - "settlement_results table and allSettlementResults pattern (Phase 6, Plan 01)"
provides:
  - "Live P&L exposure section in agent P&L tab with ESTIMATED badge"
  - "Share-adjusted P&L rows in admin settlement cards from settlement_results"
  - "allSettlementResults global in admin.html with settlement_results query"
affects: [07-agent-mobile-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [live-exposure-from-open-orders, admin-settlement-results-integration, estimated-vs-actual-visual-separation]

key-files:
  created: []
  modified: [agent.html, admin.html]

key-decisions:
  - "Live exposure uses sum of shares (potential payout) from open orders, not total_cost"
  - "Agent live exposure = total exposure * partnership_share / 100"
  - "Admin settlement cards conditionally show P&L rows only when settlement_results exist for agent"
  - "Average partnership share displayed in admin cards when agent has multiple settlements at different rates"

patterns-established:
  - "ESTIMATED vs ACTUAL visual separation: amber badge for live estimates, green badge for settled actuals"
  - "Admin allSettlementResults pattern: unfiltered query in refreshData(), per-agent filtering in render functions"
  - "Conditional P&L rows: agentSR.length > 0 guard prevents empty zeros before any markets settle"

requirements-completed: [APNL-10, APNL-11]

# Metrics
duration: 18min
completed: 2026-03-26
---

# Phase 06 Plan 02: Live Exposure & Admin Settlement P&L Summary

**Live P&L exposure tracking for agents during open markets (ESTIMATED badge) and share-adjusted P&L rows in admin settlement cards from settlement_results (purple-themed)**

## Performance

- **Duration:** 18 min
- **Started:** 2026-03-26T09:27:29Z
- **Completed:** 2026-03-26T09:45:41Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Agent P&L tab now shows live exposure section with three stat cards (Open Market Exposure, Est. Agent Exposure at partnership %, Open Markets count) above settled data
- Clear visual separation between ESTIMATED (amber) live data and ACTUAL (green) settled data
- Live section auto-hides when no open markets have client bets, auto-refreshes via existing 30s polling
- Admin settlement cards now show three purple P&L rows (P&L Share with %, Commission Cost, Agent Net P&L) from settlement_results
- Admin refreshData() queries settlement_results table alongside existing data sources

## Task Commits

Each task was committed atomically:

1. **Task 1: Add live P&L exposure section to agent P&L tab** - `5cf0c44` (feat)
2. **Task 2: Add share-adjusted P&L to admin settlement cards** - `0f76706` (feat)

## Files Created/Modified

- `agent.html` - Added Live Exposure card with ESTIMATED badge, three stat cards, live exposure computation in renderPnL(), Settled P&L header with ACTUAL badge
- `admin.html` - Added allSettlementResults global, settlement_results query in refreshData(), share-adjusted P&L computation and purple-themed rows in renderSettlement(), settled count in card headers

## Decisions Made

- **Shares (potential payout) for exposure metric:** Used sum of `o.shares` (not `o.total_cost`) for open market exposure since shares represent the potential payout if orders win -- this is the true exposure risk.
- **Conditional P&L row rendering:** Admin settlement card P&L rows only render when `agentSR.length > 0`, preventing confusing zero values for agents who haven't had any markets settle yet.
- **Average partnership share in admin cards:** When an agent has multiple settlements at different partnership rates, the admin card displays the average share percentage. Each individual settlement used the snapshot rate; the average gives a meaningful summary.
- **display:none default for live section:** The pnlLiveSection starts hidden (`display:none`) and is shown only when `openMarketsWithBets > 0`, avoiding a flash of empty content on initial render.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None -- all data sources are wired to live orders/events (for exposure) and settlement_results (for admin P&L) with no placeholder values.

## Next Plan Readiness

- Phase 06 is now complete (both plans executed)
- All APNL requirements (07-11) addressed across Plans 01 and 02
- Admin allSettlementResults pattern available for any future admin reporting enhancements
- Live exposure pattern can be extended for more granular per-market live breakdowns if needed

## Self-Check: PASSED

- [x] agent.html exists and contains pnlLiveSection, ESTIMATED badge, live exposure computation
- [x] admin.html exists and contains allSettlementResults, settlement_results query, P&L Share rows
- [x] Task 1 commit 5cf0c44 verified in git log
- [x] Task 2 commit 0f76706 verified in git log

---
*Phase: 06-agent-p-l-views*
*Completed: 2026-03-26*
