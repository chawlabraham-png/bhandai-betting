# Phase 3: Fancy Commission - Research

**Researched:** 2026-03-25
**Domain:** PL/pgSQL RPC for fancy market settlement with volume-based commission + admin.html integration
**Confidence:** HIGH

## Summary

Phase 3 replaces the current client-side `settleFancyMarket()` function (admin.html lines 2863-2919) with a single atomic PostgreSQL RPC (`settle_fancy_market`) that handles fancy market settlement with commission. This mirrors the Phase 2 pattern exactly -- same structural approach, different formulas. The key difference: fancy commission is calculated on **total volume** (sum of `total_cost` for all orders by a user on a market) regardless of win/loss outcome, whereas match commission was on net losses only.

The existing fancy settlement code already contains the correct win/loss determination logic (`YES wins if result_value >= line_at_bet`, `NO wins if result_value < line_at_bet`) and the correct winner payout formula (`stake * back_price`). The commission line is literally `const commission = 0; // TODO` -- this is what Phase 3 fills in, but inside an atomic PostgreSQL RPC rather than in client-side JavaScript.

All infrastructure from Phase 2 carries forward: the COMMISSION transaction type is already recognized in reconciliation, ledger filtering, and activity feed. The `fancy_commission` field already exists on `betting_users` (DECIMAL(5,2) DEFAULT 0.00). Agent UI already enforces fancy_commission rate hierarchy on client create/edit. The planner can focus entirely on the RPC function itself and the admin.html integration call.

**Primary recommendation:** Create `settle_fancy_market(p_event_id, p_result_value, p_settled_by)` PL/pgSQL function following the 5-section structure of `settle_match_market`, then replace the admin.html `settleFancyMarket()` body with a single `sb.rpc()` call. Two plans, same as Phase 2.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Fancy commission IS a coin credit to clients, same as match commission (carried from Phase 2 D-01).
- **D-02:** Fancy commission = fancy_commission% x total_volume. Total volume = sum of `total_cost` for ALL orders by that user on that market. Applies regardless of win or loss (COMM-06, COMM-10).
- **D-03:** Commission is calculated per-market settlement, NOT per individual bet. All orders for a user on a market are summed to get total volume, then commission applied once (consistent with match approach).
- **D-04:** Commission is recorded as a COMMISSION transaction in credit_transactions AND credits the client's balance (carried from Phase 2 D-04). Notes should indicate "Fancy commission" and include volume amount.
- **D-05:** Unlike match commission, fancy commission is paid to ALL clients with orders -- winners AND losers get commission on their volume.
- **D-06:** If client's fancy_commission is 0% then no commission paid to that client (same gating as Phase 2 D-06-NEW).
- **D-07:** Fancy commission rate read at settlement time from betting_users.fancy_commission (COMM-07).
- **D-08:** Client's effective fancy rate capped at parent agent's fancy_commission rate at settlement (COMM-08, carried from Phase 2 D-12 pattern).
- **D-09:** FLOOR rounding for fancy commission, same as match -- less to client, favors admin (carried from Phase 2 D-10).
- **D-10:** Fancy settlement should execute as a single PostgreSQL RPC (`settle_fancy_market`) for atomicity (COMM-09, matches Phase 2 D-13 pattern).
- **D-11:** New RPC, NOT an extension of settle_match_market. Separate function with same structural pattern -- keeps match/fancy formulas cleanly separated (per roadmap: "Split match and fancy commission into separate phases to prevent formula confusion").
- **D-12:** Fancy settlement RPC handles: event status update, outcome resolution (YES/NO by result_value vs line), per-order settlement, per-user commission calculation and crediting, all atomically.
- **D-13:** Winning determination: YES wins if result_value >= line_at_bet; NO wins if result_value < line_at_bet. This is per-ORDER (each order has its own line_at_bet snapshot).
- **D-14:** Winner payout: stake x back_price (stored as price_per_share on order). Losers get 0 (their stake was already locked as exposure).
- **D-15:** Commission is independent of winning -- a client who bet 1000 volume gets commission on 1000 whether they won or lost.

### Claude's Discretion
- PL/pgSQL function structure and error handling (follow settle_match_market pattern)
- How to handle edge case: client with orders on same fancy market with different line_at_bet values (treat each order independently for win/loss, but sum all total_cost for volume)
- Whether to return per-user commission breakdown in RPC result or just totals

### Deferred Ideas (OUT OF SCOPE)
- Commission visibility in client/agent views -- Phase 4
- Agent P&L calculation including fancy commission cost split -- Phase 5
- Commission rate change audit trail -- v2 scope (COMM-V2-02)
- Void market commission reversal -- v2 scope (COMM-V2-01)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMM-06 | Fancy commission calculated as % of client's total volume (sum of `total_cost` on all orders) per market | Volume = SUM(total_cost) computed per-user in user loop; commission = FLOOR(volume * rate / 100 * 100) / 100; verified against existing fancy_bet_results view in migration_v7.sql |
| COMM-07 | Fancy commission uses client's `fancy_commission` rate from `betting_users` at settlement time | Rate fetched via JOIN on betting_users in the user loop query, same pattern as settle_match_market line 101-106 |
| COMM-08 | Fancy commission enforces hierarchy -- client rate capped at parent agent's rate at settlement | Parent rate cap pattern established in settle_match_market lines 152-159; same logic applies with fancy_commission field |
| COMM-09 | Fancy commission inserted as separate COMMISSION transaction in `credit_transactions` | COMMISSION type already recognized by reconciliation, ledger, and activity feed (Phase 2 Wave 2); same INSERT pattern as settle_match_market lines 199-205 |
| COMM-10 | Fancy commission credits client balance regardless of win/loss | Commission block is NOT gated by net_pnl < 0 (unlike match); placed after order processing loop, applies to all users with volume > 0 and rate > 0 |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack:** Vanilla JS only -- no frameworks, no build tools, no TypeScript
- **Database:** Supabase (PostgreSQL) -- RPC functions are PL/pgSQL
- **Deployment:** Static hosting on Hostinger -- no server-side rendering
- **Security:** SECURITY INVOKER (Supabase default) for all RPC functions
- **Error handling:** All async functions wrapped in try/catch, showToast for user feedback
- **Patterns:** `sanitize()` for XSS, `auditLog()` for admin actions, typed market name confirmation before settle
- **Commission model:** Commission is a credit TO client (rebate), not a deduction FROM payout. Separate COMMISSION transaction row.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| PostgreSQL (Supabase managed) | 15.x | PL/pgSQL RPC function for atomic settlement | Already in use; settle_match_market establishes the pattern |
| Supabase JS SDK | v2 (CDN) | `sb.rpc('settle_fancy_market', ...)` call from admin.html | Already loaded; Phase 2 integration proves the pattern |

### Supporting
No new libraries needed. All infrastructure exists from Phase 1 and Phase 2.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| PostgreSQL RPC | Client-side JS loop (current) | Current approach has no atomicity, 150+ sequential HTTP calls, partial failure risk; RPC is strictly superior |
| Separate settle_fancy_market | Combined settle_market with type parameter | Locked decision D-11 mandates separate function; keeps formulas cleanly isolated |

## Architecture Patterns

### RPC Function Structure (5-Section Pattern)

The `settle_fancy_market` RPC follows the same 5-section structure as `settle_match_market`:

```
settle_fancy_market(p_event_id, p_result_value, p_settled_by)
  |
  Section 1: Validate and lock event
  |  SELECT * FROM events WHERE id = p_event_id FOR UPDATE
  |  Guard: NOT FOUND, already SETTLED
  |  Validate: p_result_value is not null
  |
  Section 2: Store result value on event
  |  UPDATE events SET status='SETTLED', is_resolved=true,
  |    result_value=p_result_value
  |
  Section 3: Process each user with orders
  |  FOR v_user IN (SELECT DISTINCT user_id, fancy_commission, parent_id ...)
  |    3a: Sum total_volume = SUM(total_cost) for this user's orders
  |    3b: For each order: determine win/loss, compute payout, mark SETTLED
  |    3c: Credit settlement (total payout for winning orders)
  |    3d: Compute commission on total_volume (not gated by win/loss)
  |    3e: Credit commission (if > 0)
  |
  Section 4: Build and return JSONB result summary
```

### Key Differences from settle_match_market

| Aspect | Match | Fancy |
|--------|-------|-------|
| Input parameter | p_winning_outcome_id (UUID) | p_result_value (NUMERIC) |
| Win determination | Based on which outcome is the winner | Per-order: YES wins if result >= line_at_bet, NO wins if result < line_at_bet |
| P&L model | Exposure-based (fw/fl aggregation, hedged positions) | Per-order: winner gets stake * price_per_share, loser gets 0 |
| Settlement amount | exposure + net_pnl (can be complex with hedging) | Simple sum of winning order payouts |
| Commission base | ABS(net_pnl) -- losses only, zero for winners | total_volume (SUM of total_cost) -- regardless of win/loss |
| Commission gating | net_pnl < 0 AND rate > 0 | rate > 0 only (no win/loss gate) |

### Fancy Settlement P&L Model (Per User)

Unlike match settlement which uses the complex exposure model (fw/fl aggregation for hedged positions), fancy settlement is simpler:

```
For each order:
  line = order.line_at_bet
  stake = order.total_cost
  bp = order.price_per_share

  isWin = (bet_side='YES' AND result >= line) OR (bet_side='NO' AND result < line)

  if isWin: payout += stake * bp
  // losers: exposure already locked, no refund
  // (stake was deducted from balance at bet placement)

total_volume = SUM(total_cost) across ALL orders (winners + losers)
commission = FLOOR(total_volume * rate / 100 * 100) / 100
```

This is confirmed by the existing `fancy_bet_results` view in migration_v7.sql (lines 72-100) which uses the same win/loss determination and payout formula.

### Admin.html Integration Pattern

The admin.html integration follows the exact same pattern as Phase 2:

```javascript
// BEFORE (current, 57 lines of client-side loop):
async function settleFancyMarket(ev, errEl) {
  // ... manual loops, individual DB calls, no commission
}

// AFTER (single RPC call):
async function settleFancyMarket(ev, errEl) {
  const resultVal = parseFloat(document.getElementById('fancyResultValue').value);
  const resultNotes = document.getElementById('fancyResultNotes').value.trim();
  if (isNaN(resultVal) || resultVal < 0) { errEl.textContent = 'Enter a valid result value.'; return; }

  const { data: result, error: settleErr } = await sb.rpc('settle_fancy_market', {
    p_event_id: ev.id,
    p_result_value: resultVal,
    p_settled_by: currentUser.id
  });
  if (settleErr) throw new Error(settleErr.message);

  // auditLog, showToast, closeModal, refreshData (same pattern as match)
}
```

### Anti-Patterns to Avoid
- **Gating fancy commission on win/loss:** Unlike match, fancy commission is on ALL volume. Do NOT add a `net_pnl < 0` check before commission calculation.
- **Using the match exposure model for fancy:** Fancy P&L is per-order (win gets stake*bp, lose gets 0), NOT the fw/fl aggregation model. Do not import match P&L logic.
- **Combining match and fancy into one RPC:** Locked decision D-11 mandates separation. The formulas are fundamentally different.
- **Computing commission per-order:** Commission is per-user-per-market (D-03). Sum all total_cost first, then apply commission once.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic settlement | Client-side JS settlement loop | PostgreSQL RPC function | Race conditions, partial failure, 150+ HTTP calls |
| Commission rounding | Custom rounding in JS | `FLOOR(amount * rate / 100.0 * 100.0) / 100.0` in PL/pgSQL | Consistent with match; PG numeric avoids JS float drift |
| Rate hierarchy | Manual parent lookup per order | Single JOIN in user query + IF cap | Established pattern from settle_match_market |

## Common Pitfalls

### Pitfall 1: Commission Gated by Win/Loss (Match Pattern Leak)
**What goes wrong:** Developer copies the match commission block and keeps the `IF v_net_pnl < 0 THEN` gate. Fancy commission should apply to ALL users regardless of outcome.
**Why it happens:** settle_match_market has `IF v_net_pnl < 0 THEN` before commission. The fancy version must NOT have this gate.
**How to avoid:** Commission block for fancy uses `IF v_comm_rate > 0 THEN` as the only gate. No win/loss condition.
**Warning signs:** Winning clients on fancy markets receive no commission entries.

### Pitfall 2: Using Net P&L as Commission Base Instead of Volume
**What goes wrong:** Developer computes `ABS(net_pnl) * rate` (match formula) instead of `total_volume * rate` (fancy formula).
**Why it happens:** Copy-paste from settle_match_market.
**How to avoid:** Track `v_total_volume` as `SUM(total_cost)` in a separate accumulator during the order loop. Use this as the commission base.
**Warning signs:** Commission amounts that correlate with win/loss outcomes instead of being proportional to total stakes.

### Pitfall 3: Settlement Amount Missing for Losing Users
**What goes wrong:** In fancy, losing users get 0 payout -- their stake was already deducted at bet placement. But they still need a commission credit. If the settlement loop skips users with 0 payout, losers miss commission.
**Why it happens:** The order loop only processes winners for payouts. Commission must process ALL users.
**How to avoid:** The user loop processes ALL users with orders. Settlement (payout) happens only for winners. Commission happens for ALL users with volume > 0 and rate > 0.
**Warning signs:** Only winning clients on fancy markets have COMMISSION rows in credit_transactions.

### Pitfall 4: Different line_at_bet Values Confusing Commission Volume
**What goes wrong:** A client places multiple orders on the same fancy market at different lines (line moved between bets). Each order has its own line_at_bet. If the developer tries to aggregate by line instead of by user, some orders get missed.
**Why it happens:** Fancy markets have moving lines, so different orders on the same market can have different line_at_bet values.
**How to avoid:** Win/loss is determined per-ORDER (using that order's line_at_bet). Volume is summed per-USER across ALL orders regardless of line. Commission is computed on the per-user total.
**Warning signs:** Users with multiple orders getting partial commission.

### Pitfall 5: Missing result_value and result_notes Storage on Event
**What goes wrong:** Match settlement stores winning_outcome. Fancy settlement must store result_value and result_notes on the event row.
**Why it happens:** Match uses `winning_outcome` text field; fancy uses `result_value` numeric field. Different columns.
**How to avoid:** The RPC UPDATE must include: `result_value = p_result_value`. The result_notes should be passed as an optional parameter or handled in the admin.html call.
**Warning signs:** Event shows as settled but has NULL result_value. Client-side fancy result display breaks.

### Pitfall 6: Missing Outcome is_winner Updates for Fancy
**What goes wrong:** Match settlement marks the winning outcome with `is_winner = true`. Fancy has YES/NO outcomes, and the "winner" depends on the result_value vs line_value. But `is_winner` on outcomes is used by client views.
**Why it happens:** In fancy, whether YES or NO "won" depends on result_value vs the event's line_value (not per-order line_at_bet). The event-level line_value determines the "official" winning outcome.
**How to avoid:** After setting result_value, update the YES outcome's `is_winner = (result_value >= line_value)` and NO outcome's `is_winner = (result_value < line_value)` using the event's `line_value`. This is cosmetic for display; actual per-order settlement uses `line_at_bet`.
**Warning signs:** Client fancy positions not showing correct win/loss styling after settlement.

## Code Examples

### Fancy Settlement RPC Signature

```sql
-- Source: Derived from settle_match_market pattern (sql/003_settle_match_market_rpc.sql)
CREATE OR REPLACE FUNCTION public.settle_fancy_market(
  p_event_id      UUID,
  p_result_value  NUMERIC,
  p_settled_by    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
```

### Per-Order Win/Loss Determination (Verified from migration_v7.sql view)

```sql
-- Source: migration_v7.sql lines 84-88 (fancy_bet_results view)
v_is_win := (v_order.bet_side = 'YES' AND p_result_value >= v_order.line_at_bet)
         OR (v_order.bet_side = 'NO'  AND p_result_value <  v_order.line_at_bet);
```

### Winner Payout Formula (Verified from admin.html:2896)

```sql
-- Source: admin.html line 2896 and migration_v7.sql lines 91-92
IF v_is_win THEN
  v_payout := v_order.total_cost * v_order.price_per_share;
END IF;
-- Losers get 0 (exposure already locked at bet time)
```

### Fancy Commission Calculation (Per-User, After Order Loop)

```sql
-- Source: Derived from CONTEXT.md D-02, D-05, D-09
-- Unlike match: no net_pnl < 0 gate. Commission on ALL volume.
v_commission := 0;
v_comm_rate := COALESCE(v_user.fancy_commission, 0);

IF v_comm_rate > 0 THEN
  -- D-08: cap at parent agent's rate
  IF v_user.parent_id IS NOT NULL THEN
    SELECT fancy_commission INTO v_parent_rate
      FROM public.betting_users
     WHERE id = v_user.parent_id;
    IF v_parent_rate IS NOT NULL AND v_comm_rate > v_parent_rate THEN
      v_comm_rate := v_parent_rate;
    END IF;
  END IF;

  -- D-09: FLOOR rounding (same as match)
  v_commission := FLOOR(v_total_volume * v_comm_rate / 100.0 * 100.0) / 100.0;
END IF;
```

### Commission Credit (Independent of Payout)

```sql
-- Source: settle_match_market lines 192-206 (same pattern)
IF v_commission > 0 THEN
  UPDATE public.betting_users
     SET balance = balance + v_commission
   WHERE id = v_user.user_id;

  INSERT INTO public.credit_transactions
    (sender_id, receiver_id, amount, transaction_type, notes)
  VALUES (
    p_settled_by, v_user.user_id, v_commission, 'COMMISSION',
    format('Fancy commission: %s%% on volume of %s in %s',
      v_comm_rate, ROUND(v_total_volume, 2), v_event.title)
  );
END IF;
```

### Admin.html RPC Call Pattern (Verified from settleMatchMarket)

```javascript
// Source: admin.html lines 2835-2840 (match RPC call pattern)
const { data: result, error: settleErr } = await sb.rpc('settle_fancy_market', {
  p_event_id: ev.id,
  p_result_value: resultVal,
  p_settled_by: currentUser.id
});
if (settleErr) throw new Error(settleErr.message);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side settlement loop (57 lines, no commission) | Single atomic RPC with commission | Phase 2 established for match | Fancy follows same migration pattern |
| `const commission = 0; // TODO` | Volume-based commission in RPC | Phase 3 (this phase) | Fills the TODO, adds actual commission calculation |
| Individual `adjust_balance` calls per user | Inline `balance = balance + amt` in RPC | Phase 2 decision | Already established, fancy RPC does the same |

**Deprecated/outdated:**
- Current `settleFancyMarket()` in admin.html (lines 2863-2919): Will be replaced entirely with RPC call

## Discretion Recommendations

### Edge Case: Multiple Orders with Different line_at_bet Values

**Recommendation:** Treat each order independently for win/loss determination, but sum all `total_cost` for volume calculation.

Rationale: A client places 3 orders on the same fancy market at lines 45, 47, 49. Result is 46. Order 1 (YES@45) wins, Order 2 (YES@47) loses, Order 3 (NO@49) wins. Total volume = sum of all 3 stakes. Commission applies to total volume. This is the natural behavior when iterating orders in a loop while accumulating volume in a per-user variable.

### RPC Return Value: Include Per-User Breakdown?

**Recommendation:** Return totals only (same as match), not per-user breakdown.

Return: `{ event_id, result_value, users_settled, total_payout, total_commission, winners_count, losers_count }`

Rationale: The admin.html toast only needs totals. Per-user data is already in credit_transactions for audit. Adding per-user detail to the return value increases complexity for no immediate consumer. If Phase 5 (Agent P&L) needs per-user data, it will read from credit_transactions/orders directly.

### result_notes Parameter

**Recommendation:** Pass `p_result_notes` as an optional TEXT parameter to the RPC and store on the event. The admin UI already has a result notes input field (fancyResultNotes). This is cheap to add and useful for audit.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual testing via Supabase SQL Editor + admin UI |
| Config file | none (no automated tests per CLAUDE.md) |
| Quick run command | Run RPC directly: `SELECT settle_fancy_market('event-uuid', 46, 'admin-uuid');` |
| Full suite command | Manual: settle a fancy market via admin UI, verify credit_transactions |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMM-06 | Commission = fancy_commission% of SUM(total_cost) | manual | SQL Editor: verify COMMISSION amount after settle | N/A |
| COMM-07 | Rate from betting_users.fancy_commission at settlement time | manual | Change rate before settlement, verify commission uses new rate | N/A |
| COMM-08 | Client rate capped at parent agent rate | manual | Set client rate > agent rate, verify cap applied | N/A |
| COMM-09 | COMMISSION row in credit_transactions | manual | Query credit_transactions WHERE transaction_type='COMMISSION' after settle | N/A |
| COMM-10 | Commission regardless of win/loss | manual | Verify both winners and losers have COMMISSION rows | N/A |

### Sampling Rate
- **Per task commit:** Review SQL function manually; run via SQL Editor against test data
- **Per wave merge:** Full fancy settlement via admin UI with multiple users (winners + losers)
- **Phase gate:** Verify all 5 COMM requirements manually via admin settlement

### Wave 0 Gaps
None -- no automated test infrastructure exists or is required per project constraints (CLAUDE.md: "Automated tests -- Deferred").

## Open Questions

1. **result_notes in RPC vs admin.html**
   - What we know: The admin UI has a `fancyResultNotes` text input. The current JS code stores it on the event.
   - What's unclear: Should the RPC accept result_notes as a parameter, or should admin.html update the event notes separately?
   - Recommendation: Pass as optional RPC parameter. Keeps the operation atomic -- no separate update needed.

2. **Outcome is_winner for fancy markets**
   - What we know: Match settlement sets `is_winner = true` on the winning outcome. For fancy, YES/NO winning depends on result vs line.
   - What's unclear: Should the RPC update outcome is_winner based on event-level line_value (cosmetic), or leave it unset?
   - Recommendation: Set it based on event's `line_value` (not per-order `line_at_bet`). This is for display purposes -- the per-order settlement uses `line_at_bet`. Both YES and NO outcomes should be updated.

## Sources

### Primary (HIGH confidence)
- `sql/003_settle_match_market_rpc.sql` -- Complete match settlement RPC (229 lines), structural template for fancy
- `admin.html` lines 2863-2919 -- Current settleFancyMarket() showing exact logic to replace
- `admin.html` lines 2829-2861 -- settleMatchMarket() showing RPC integration pattern
- `migration_v7.sql` lines 72-100 -- fancy_bet_results view confirming win/loss determination and payout formula
- `.planning/phases/02-match-commission/02-01-SUMMARY.md` -- Phase 2 RPC patterns, decisions, verification approach
- `.planning/phases/02-match-commission/02-02-SUMMARY.md` -- Phase 2 admin UI integration approach
- `.planning/phases/03-fancy-commission/03-CONTEXT.md` -- All locked decisions D-01 through D-15
- `update_commissions.sql` -- fancy_commission column definition (DECIMAL(5,2) DEFAULT 0.00)

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` -- Pitfall #7 (split formula bugs between match/fancy) directly relevant
- `.planning/research/ARCHITECTURE.md` -- Commission data flow diagrams, anti-patterns
- `.planning/research/SUMMARY.md` -- Commission formula definitions and phase ordering rationale

### Tertiary (LOW confidence)
None -- all findings are derived from direct codebase analysis and locked decisions. No external sources needed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, identical pattern to Phase 2
- Architecture: HIGH -- 5-section RPC pattern proven in Phase 2, fancy formulas verified against migration_v7.sql view and existing admin.html logic
- Pitfalls: HIGH -- all pitfalls derived from direct comparison of match vs fancy formulas and known copy-paste risks

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable -- no external dependency changes expected)
