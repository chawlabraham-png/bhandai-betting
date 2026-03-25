---
phase: 02-match-commission
plan: 01
subsystem: database
tags: [postgres, rpc, settlement, commission, supabase, atomic-operations]

# Dependency graph
requires:
  - "Atomic adjust_balance PostgreSQL RPC (Phase 1, plan 02)"
provides:
  - "Atomic settle_match_market PostgreSQL RPC with commission calculation"
  - "SETTLEMENT and COMMISSION credit_transactions rows per user per market"
  - "Commission rate hierarchy enforcement (client capped at parent agent rate)"
affects: [02-02-admin-integration, 03-fancy-commission, 05-agent-pnl-core]

# Tech tracking
tech-stack:
  added: [settle_match_market PostgreSQL RPC]
  patterns: [atomic-settlement-with-commission, floor-rounding-admin-favor, exposure-based-pnl-in-sql, parent-rate-cap]

key-files:
  created: [sql/003_settle_match_market_rpc.sql]
  modified: []

key-decisions:
  - "SECURITY INVOKER (Supabase default) -- no privilege escalation, consistent with Phase 1 adjust_balance pattern"
  - "Inline balance updates (balance = balance + amt) instead of calling adjust_balance RPC -- already inside PL/pgSQL transaction, no need for nested RPC"
  - "FLOOR rounding for commission to favor admin -- gives less credit to client (commission is a rebate TO client)"
  - "Commission gating independent of settle_amt -- a pure loser with settle_amt=0 still gets commission (Pitfall #6)"
  - "FOR UPDATE row lock on events table to prevent concurrent settlement race conditions"
  - "Commission sender_id = p_settled_by (admin), receiver_id = user_id -- coins flow from admin to client as rebate"

patterns-established:
  - "Atomic settlement RPC pattern: single function handles event lock, P&L calc, commission, balance credits, and transaction logging"
  - "Commission calculation: FLOOR(ABS(v_net_pnl) * rate / 100.0 * 100.0) / 100.0"
  - "Parent rate cap: IF client_rate > parent_rate THEN use parent_rate"
  - "Dual transaction pattern: SETTLEMENT row + independent COMMISSION row per user"

requirements-completed: [COMM-01, COMM-02, COMM-03, COMM-04, COMM-05]

# Metrics
duration: ~15min
completed: 2026-03-25
---

# Phase 02 Plan 01: Atomic settle_match_market RPC with Commission Summary

**Atomic PostgreSQL RPC that settles all match market users in one transaction, computing FLOOR-rounded commission on losses capped at parent agent rate, crediting both SETTLEMENT and COMMISSION as separate balance updates and credit_transactions rows**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-03-25
- **Tasks:** 2
- **Files created:** 1

## Accomplishments

- Created settle_match_market PostgreSQL RPC function (229 lines) that atomically handles the entire match market settlement
- RPC validates event state (not-found guard, already-settled idempotency guard) with FOR UPDATE row locking
- Computes net P&L per user using the exposure model (LAGAI/KHAI aggregation handles hedged positions per D-14)
- Commission calculated only when client lost (net_pnl < 0) AND match_commission > 0 (D-06-NEW)
- Commission rate capped at parent agent's rate at settlement time (D-12)
- Commission FLOOR-rounded to favor admin (D-10) -- since commission is credit TO client, less = admin favor
- Both SETTLEMENT and COMMISSION credit client balance via atomic inline UPDATE
- Both SETTLEMENT and COMMISSION insert separate credit_transactions rows with descriptive notes
- Commission gating is independent of settle_amt threshold (Pitfall #6 -- pure losers still get commission)
- Returns JSONB summary: event_id, winning_outcome_id, winning_title, users_settled, total_payout, total_commission
- Successfully deployed to Supabase production (user-verified via SQL Editor)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create settle_match_market PostgreSQL RPC** - `71d6707` (feat)
2. **Task 2: Deploy settle_match_market RPC to Supabase** - checkpoint resolved (user ran SQL in Supabase SQL Editor, success)

## Files Created

- `sql/003_settle_match_market_rpc.sql` - Complete atomic settlement RPC with commission (229 lines)

## RPC Function Details

### Signature
```sql
public.settle_match_market(p_event_id UUID, p_winning_outcome_id UUID, p_settled_by UUID) RETURNS JSONB
```

### 5-Section Structure

| Section | Purpose |
|---------|---------|
| 1. Validate & lock | SELECT FOR UPDATE on event, idempotency guard, winning outcome lookup |
| 2. Fav team check | Compare rate_team outcome to winning outcome to determine v_fav_team_won |
| 3. Mark settled | UPDATE events SET status='SETTLED', UPDATE outcomes SET is_winner=true |
| 4. User loop | For each user: compute P&L, commission, credit balance, insert transactions |
| 5. Return summary | JSONB with event_id, users_settled, total_payout, total_commission |

### Commission Logic (Section 4b)

```
IF net_pnl < 0 (client lost):
  rate = client.match_commission (default 0)
  IF rate > 0:
    IF parent exists AND client_rate > parent_rate:
      rate = parent_rate  (cap at parent, D-12)
    commission = FLOOR(ABS(net_pnl) * rate / 100 * 100) / 100  (D-10)
```

### P&L Model (Section 4a)

```
LAGAI: fw += stake * rate;  fl -= stake
KHAI:  fw -= stake;         fl += stake / rate
exposure = MAX(0, -MIN(fw, fl))
net_pnl = fav_team_won ? fw : fl
settle_amt = ROUND(exposure + net_pnl, 2)
```

## Verification Results

- `sql/003_settle_match_market_rpc.sql` exists with complete function (229 lines)
- Contains `CREATE OR REPLACE FUNCTION public.settle_match_market` -- confirmed
- Contains `RETURNS JSONB` and `LANGUAGE plpgsql` -- confirmed
- Contains TWO `balance = balance +` lines (one for SETTLEMENT, one for COMMISSION) -- confirmed
- Contains `FLOOR` for commission rounding (not CEIL) -- confirmed
- Contains `'COMMISSION'` transaction type insert -- confirmed
- Contains `'SETTLEMENT'` transaction type insert -- confirmed
- Contains `v_net_pnl < 0` check before commission -- confirmed
- Contains `v_comm_rate > 0` check (D-06-NEW) -- confirmed
- Contains parent_id rate cap logic -- confirmed
- Contains `FOR UPDATE` on event select (row lock) -- confirmed
- Contains `status = 'SETTLED'` idempotency check -- confirmed
- SETTLEMENT: sender_id = p_settled_by, receiver_id = v_user.user_id -- confirmed
- COMMISSION: sender_id = p_settled_by, receiver_id = v_user.user_id -- confirmed
- Commission INSERT is OUTSIDE the settle_amt > 0 gate (independent gating) -- confirmed
- RPC deployed to Supabase and verified by user -- confirmed

## Decisions Made

- Used SECURITY INVOKER (Supabase default) -- consistent with Phase 1 convention, no privilege escalation needed
- Used inline `balance = balance + amt` instead of calling adjust_balance RPC -- already inside PL/pgSQL transaction boundary, nested RPC call would be redundant overhead
- FLOOR rounding for commission -- since commission is a credit TO the client (rebate), rounding down gives less to client and favors admin
- Commission gating independent of settle_amt -- per Pitfall #6 from research, a pure loser (all LAGAI bets on losing team) has settle_amt=0 but still deserves commission on their loss
- FOR UPDATE row lock on events prevents two concurrent admin sessions from double-settling the same event
- Winning outcome validation added (RAISE EXCEPTION if p_winning_outcome_id not found) -- not in original plan but prevents silent failures (Rule 2: missing input validation)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Validation] Added winning outcome NOT FOUND guard**
- **Found during:** Task 1
- **Issue:** Plan did not specify validation for p_winning_outcome_id -- if a bad UUID was passed, v_winning_title would be NULL and settlement would silently produce bad data
- **Fix:** Added `IF v_winning_title IS NULL THEN RAISE EXCEPTION 'Winning outcome not found: %', p_winning_outcome_id;`
- **Files modified:** sql/003_settle_match_market_rpc.sql
- **Commit:** 71d6707

## Issues Encountered

None.

## User Setup Required

**External services required manual configuration.** The settle_match_market RPC was deployed via:
- Supabase Dashboard > SQL Editor > ran `sql/003_settle_match_market_rpc.sql`
- User confirmed deployment was successful

## Known Stubs

None -- the RPC is a fully self-contained PostgreSQL function with no stub logic or placeholder data.

## Next Plan Readiness

- Plan 02-02 (admin.html integration) can now call `sb.rpc('settle_match_market', { p_event_id, p_winning_outcome_id, p_settled_by })` to replace the current JS settlement loop
- The JSONB return value provides all data needed for the reconciliation UI (users_settled, total_payout, total_commission)
- COMMISSION transactions will appear in credit_transactions for future visibility work (Phase 4)

## Self-Check: PASSED

- [x] sql/003_settle_match_market_rpc.sql exists (229 lines)
- [x] Task 1 commit 71d6707 verified in git log
- [x] Task 2 checkpoint resolved (user confirmed deployment)
- [x] SUMMARY.md created at `.planning/phases/02-match-commission/02-01-SUMMARY.md`

---
*Phase: 02-match-commission*
*Completed: 2026-03-25*
