---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Ready to plan
stopped_at: Completed 06-02-PLAN.md (live exposure and admin settlement P&L)
last_updated: "2026-03-26T10:07:20.144Z"
progress:
  total_phases: 8
  completed_phases: 6
  total_plans: 12
  completed_plans: 12
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-25)

**Core value:** Accurate commission deduction and P&L reporting across the agent-client hierarchy
**Current focus:** Phase 06 — agent-p-l-views

## Current Position

Phase: 7
Plan: Not started

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 15min | 3 tasks | 8 files |
| Phase 01 P02 | 12min | 3 tasks | 2 files |
| Phase 02 P01 | 15min | 2 tasks | 1 files |
| Phase 04 P01 | 4min | 2 tasks | 1 files |
| Phase 04 P02 | 3min | 2 tasks | 2 files |
| Phase 05 P01 | 3min | 2 tasks | 2 files |
| Phase 06 P01 | 8min | 2 tasks | 1 files |
| Phase 06 P02 | 18min | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Persist agent P&L in `settlement_results` table at settlement time (not computed on-the-fly)
- [Roadmap]: Use classic `<script>` tags with namespace convention, not ES modules (safer with existing auth.js globals and static hosting)
- [Roadmap]: Split match and fancy commission into separate phases to prevent formula confusion (pitfall #3, #7)
- [Roadmap]: Code restructure is last phase -- never concurrent with feature work (pitfall #5)
- [Phase 01]: Used ADD COLUMN IF NOT EXISTS for idempotent migration safety
- [Phase 01]: Archived old directory with -ARCHIVED suffix rather than deleting
- [Phase 01]: Established sql/ directory convention with numbered migration files (001_, 002_)
- [Phase 01]: SECURITY INVOKER (default) for adjust_balance RPC -- no privilege escalation needed
- [Phase 01]: No balance floor constraint -- negative balances valid in exposure-based accounting
- [Phase 01]: Used balErr variable name to avoid shadowing outer error variables in settlement try/catch
- [Phase 02]: SECURITY INVOKER for settle_match_market RPC -- consistent with Phase 1 adjust_balance pattern
- [Phase 02]: Inline balance updates inside PL/pgSQL instead of nested adjust_balance RPC call
- [Phase 02]: FLOOR rounding for commission credits -- gives less to client, favoring admin
- [Phase 02]: Commission gating independent of settle_amt -- pure losers still get commission (Pitfall #6)
- [Phase 04]: Used sanitize() on all parsed notes values in commission cards per CLAUDE.md XSS convention
- [Phase 04]: Extracted _renderCommissionCard, _renderOrderCard, _buildSummaryBar helpers for cleaner renderHistoryTab
- [Phase 04]: COMMISSION uses purple (#a78bfa) for badge/amount, green dot for credit classification -- consistent across admin and agent
- [Phase 04]: Admin COMMISSION UI support was missing from Phase 2 -- added in 04-02 as Rule 3 auto-fix
- [Phase 05]: Combined parent lookup (match_commission + role + partnership_share) in one query to avoid N+1 (Pitfall #5)
- [Phase 05]: Moved parent lookup outside v_net_pnl < 0 block so agent P&L accumulates for winners too (not just losers)
- [Phase 05]: Skip agents with 0% partnership_share from settlement_results (discretion: reduces noise)
- [Phase 05]: Section numbering shifted in settle_match_market: parent lookup 4b, commission 4c, settlement credit 4d, commission credit 4e, agent accum 4f, agent loop Section 5, return Section 6
- [Phase 06]: Replaced all estimated P&L with actual settlement_results data for agent summary stats
- [Phase 06]: Per-client P&L computed from orders + winning_outcome since settlement_results is per-agent-per-market not per-client
- [Phase 06]: Commission matching for per-market detail uses notes field text search on event title
- [Phase 06]: Live exposure uses shares (potential payout) not total_cost for open order risk
- [Phase 06]: Admin settlement cards conditionally show P&L rows only when settlement_results exist for agent

### Pending Todos

None yet.

### Blockers/Concerns

- Commission on hedged positions (LAGAI+KHAI on same match) needs explicit definition during Phase 2 planning
- Commission rate snapshot timing (bet-placement vs settlement-time) needs business decision before Phase 2

## Session Continuity

Last session: 2026-03-26T10:06:28.844Z
Stopped at: Completed 06-02-PLAN.md (live exposure and admin settlement P&L)
Resume file: None
