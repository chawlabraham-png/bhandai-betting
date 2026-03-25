# Phase 2: Match Commission - Research

**Researched:** 2026-03-25
**Domain:** Match bet settlement with commission deduction (PL/pgSQL RPC + client-side JS integration)
**Confidence:** HIGH

## Summary

Phase 2 adds match commission calculation to the existing settleMatchMarket() flow. Commission is a percentage of client NET losses per market, calculated at settlement time using the client's `match_commission` rate from `betting_users`. The critical user decision (D-01, overriding COMM-05 from REQUIREMENTS.md) is that commission is NOT a coin credit to clients -- it is recorded as a COMMISSION transaction for audit trail purposes only, without affecting client balance. This makes commission a pure accounting entry that enables downstream agent P&L calculations (Phase 5).

The settlement must move into a PostgreSQL RPC function (`settle_match_market`) for atomicity, following the pattern established by `adjust_balance` in Phase 1. The current client-side loop in admin.html (lines 2856-2882) does 3-5 sequential Supabase calls per user with no transaction boundary. Adding commission would increase this to 5-7 calls per user, amplifying race condition risk. A single RPC wrapping everything in a PostgreSQL transaction is the correct approach per D-13.

The main technical challenges are: (1) computing NET P&L per user per market when users have hedged LAGAI+KHAI positions, (2) enforcing the commission rate hierarchy (client rate capped at parent agent's rate) at settlement time, (3) rounding consistently in admin's favor, and (4) ensuring the reconciliation formula in the admin ledger (line 1810-1811) still works when COMMISSION transactions exist (since they do NOT move coins, they must be excluded from the reconciliation sum).

**Primary recommendation:** Create a `settle_match_market(p_event_id, p_winning_outcome_id, p_settled_by)` PostgreSQL RPC that atomically settles all users, computes commission for losers, inserts both SETTLEMENT and COMMISSION credit_transaction rows, and returns a summary JSON. Replace the client-side loop with a single `sb.rpc()` call.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Commission is NOT a separate coin credit to clients. It is a calculation factor in agent P&L.
- **D-02:** When a client loses on a match market, commission = match_commission% x net_loss_amount. This commission REDUCES the agent's net earnings from that client's loss.
- **D-03:** Commission is calculated per-market settlement, NOT per individual bet.
- **D-04:** Commission is recorded as a COMMISSION transaction for audit trail purposes, but does NOT credit the client's balance.
- **D-05:** Clients who won on a match market receive zero commission (commission is on losses only).
- **D-06:** Strict hierarchy: Admin -> Agent -> Client. ALL transactions for a client under an agent flow through the agent.
- **D-07:** If admin adds coins directly to an agent's client, the agent's "owes admin" balance increases by that amount. There is NO direct admin<->client ledger entry.
- **D-08:** Exception: clients directly under admin (no agent parent) have direct admin<->client relationship.
- **D-09:** When admin or agent adds/withdraws coins from a client, the same action must reflect in the full P&L chain upward.
- **D-10:** All commission calculations and accounting round in favor of admin (the house). Round down on payouts, round up on deductions.
- **D-11:** Commission rate read at settlement time from betting_users.match_commission
- **D-12:** Client's effective rate capped at parent agent's rate at settlement (defensive check)
- **D-13:** Match settlement should execute as a single PostgreSQL RPC for atomicity (success criterion #5)
- **D-14:** Hedged positions: commission applies to NET P&L per user per market (not per-order). If client has both LAGAI and KHAI and nets to zero loss, commission is zero.

### Claude's Discretion
- PL/pgSQL function structure and error handling
- How to store commission audit trail in notes field
- Whether to create a new settlement_results table now or defer to Phase 5

### Deferred Ideas (OUT OF SCOPE)
- Full accounting hierarchy refactor (admin deposits flowing through agent) -- broader than Phase 2, may need its own phase
- Agent P&L views showing commission impact -- Phase 6
- Commission visibility in ledger views -- Phase 4
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMM-01 | Match commission calculated as % of client's net loss per market (zero if client wins) | Existing exposure model computes netPnl per user (lines 2857-2864). Commission = `CEIL(ABS(netPnl) * rate / 100 * 100) / 100` when netPnl < 0, else 0. Hedged positions handled by existing fw/fl aggregation across all user orders. |
| COMM-02 | Match commission uses client's `match_commission` rate from `betting_users` at settlement time | Field exists as DECIMAL(5,2) DEFAULT 0. RPC must SELECT match_commission FROM betting_users WHERE id = user_id for each user with orders. |
| COMM-03 | Match commission enforces hierarchy -- client rate capped at parent agent's rate at settlement | RPC must JOIN betting_users parent ON parent.id = user.parent_id and apply LEAST(user.match_commission, COALESCE(parent.match_commission, user.match_commission)). UI already enforces this at creation/edit time (lines 2291-2294) but settlement needs a defensive check. |
| COMM-04 | Match commission inserted as separate COMMISSION transaction in `credit_transactions` (not netted into SETTLEMENT payout) | COMMISSION row inserted with amount = commission value, separate from SETTLEMENT row. Existing transaction_type is VARCHAR(50) with no CHECK constraint -- 'COMMISSION' can be inserted freely. Notes field stores audit trail. |
| COMM-05 | Match commission credits client balance (positive entry -- rebate, not fee) | **OVERRIDDEN BY CONTEXT.md D-01/D-04**: Commission does NOT credit client balance. It is recorded as an audit-only COMMISSION transaction. The COMMISSION credit_transaction exists for the audit trail but `adjust_balance` is NOT called for it. This is a deliberate override of the original COMM-05 requirement by the user during the discuss phase. |

### CRITICAL: COMM-05 Override

REQUIREMENTS.md states COMM-05 as "credits client balance (positive entry -- rebate, not fee)". CONTEXT.md decisions D-01 and D-04 explicitly override this: "Commission is NOT a separate coin credit to clients" and "does NOT credit the client's balance." CONTEXT.md represents the user's latest, final decisions and takes precedence. The planner MUST implement commission as an audit-only record, not a balance adjustment.
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| PostgreSQL (Supabase) | 15.x (managed) | Settlement RPC with transaction atomicity | Already in use. RPC pattern established by `adjust_balance` in Phase 1. |
| PL/pgSQL | built-in | Stored procedure language for settlement function | Only option for Supabase PostgreSQL functions. Pattern proven in `adjust_balance` and `transfer_chips`. |
| Supabase JS SDK | v2 (CDN) | Client-side RPC invocation | Already loaded. `sb.rpc('function_name', { params })` pattern established. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | - | No new dependencies | Zero new libraries needed for this phase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| PL/pgSQL RPC | Client-side JS loop (current) | Current approach has no transaction boundary; commission adds 2+ more calls per user, amplifying race conditions. RPC is strictly better. |
| SECURITY INVOKER (default) | SECURITY DEFINER | INVOKER respects RLS, safer. DEFINER bypasses RLS but not needed since admin has full access via permissive policies. Keep INVOKER per Phase 1 convention. |

**Installation:** No packages to install. This is a SQL migration + JS code change.

## Architecture Patterns

### Recommended Project Structure
```
sql/
  003_settle_match_market_rpc.sql    # New RPC function
admin.html                           # Modified settleMatchMarket() to call RPC
```

### Pattern 1: Settlement RPC with Commission
**What:** A single PostgreSQL function that handles the entire match market settlement atomically -- marking event settled, computing per-user P&L, computing commission on losses, inserting SETTLEMENT + COMMISSION transactions, and updating balances.
**When to use:** Always for match market settlement (replaces client-side loop).
**Example:**
```sql
-- Source: Phase 1 adjust_balance pattern + transfer_chips pattern from migration_v6.sql
CREATE OR REPLACE FUNCTION public.settle_match_market(
  p_event_id         UUID,
  p_winning_outcome_id UUID,
  p_settled_by       UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_event         RECORD;
  v_rate_team_oc  RECORD;
  v_fav_team_won  BOOLEAN;
  v_user          RECORD;
  v_order         RECORD;
  v_fw            NUMERIC;
  v_fl            NUMERIC;
  v_exposure      NUMERIC;
  v_net_pnl       NUMERIC;
  v_settle_amt    NUMERIC;
  v_comm_rate     NUMERIC;
  v_parent_rate   NUMERIC;
  v_effective_rate NUMERIC;
  v_commission    NUMERIC;
  v_total_payout  NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_users_settled INTEGER := 0;
  v_result        JSONB;
BEGIN
  -- 1. Validate and lock event
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found: %', p_event_id; END IF;
  IF v_event.status = 'SETTLED' THEN RAISE EXCEPTION 'Event already settled'; END IF;

  -- 2. Determine if favored team won
  SELECT * INTO v_rate_team_oc FROM public.outcomes
    WHERE event_id = p_event_id AND title = v_event.rate_team
    LIMIT 1;
  v_fav_team_won := (v_rate_team_oc.id = p_winning_outcome_id);

  -- 3. Mark event settled
  UPDATE public.events SET status = 'SETTLED', is_resolved = true,
    winning_outcome = (SELECT title FROM public.outcomes WHERE id = p_winning_outcome_id)
    WHERE id = p_event_id;
  UPDATE public.outcomes SET is_winner = true WHERE id = p_winning_outcome_id;

  -- 4. Process each user with orders
  FOR v_user IN
    SELECT DISTINCT o.user_id, bu.match_commission, bu.parent_id
    FROM public.orders o
    JOIN public.betting_users bu ON bu.id = o.user_id
    WHERE o.outcome_id IN (SELECT id FROM public.outcomes WHERE event_id = p_event_id)
      AND o.status = 'OPEN'
    GROUP BY o.user_id, bu.match_commission, bu.parent_id
  LOOP
    -- 4a. Compute net P&L using exposure model
    v_fw := 0; v_fl := 0;
    FOR v_order IN
      SELECT * FROM public.orders
      WHERE user_id = v_user.user_id
        AND outcome_id IN (SELECT id FROM public.outcomes WHERE event_id = p_event_id)
        AND status = 'OPEN'
    LOOP
      IF v_order.bet_side = 'LAGAI' THEN
        v_fw := v_fw + v_order.total_cost * v_order.price_per_share;
        v_fl := v_fl - v_order.total_cost;
      ELSIF v_order.bet_side = 'KHAI' THEN
        v_fw := v_fw - v_order.total_cost;
        v_fl := v_fl + v_order.total_cost / v_order.price_per_share;
      END IF;

      -- Mark order settled
      UPDATE public.orders SET status = 'SETTLED' WHERE id = v_order.id;
    END LOOP;

    v_exposure := GREATEST(0, -LEAST(v_fw, v_fl));
    v_net_pnl := CASE WHEN v_fav_team_won THEN v_fw ELSE v_fl END;
    v_settle_amt := ROUND(v_exposure + v_net_pnl, 2);

    -- 4b. Compute commission (on losses only, D-10: round UP for deductions = favor admin)
    v_commission := 0;
    IF v_net_pnl < 0 THEN
      -- Hierarchy enforcement (D-12): cap at parent agent's rate
      v_comm_rate := COALESCE(v_user.match_commission, 0);
      IF v_user.parent_id IS NOT NULL THEN
        SELECT match_commission INTO v_parent_rate
          FROM public.betting_users WHERE id = v_user.parent_id;
        IF v_parent_rate IS NOT NULL AND v_comm_rate > v_parent_rate THEN
          v_comm_rate := v_parent_rate;
        END IF;
      END IF;
      -- Round UP (ceil) to favor admin (D-10)
      v_commission := CEIL(ABS(v_net_pnl) * v_comm_rate / 100.0 * 100.0) / 100.0;
    END IF;

    -- 4c. Credit settlement amount (exposure refund + P&L) to user balance
    IF v_settle_amt > 0 THEN
      UPDATE public.betting_users SET balance = balance + v_settle_amt
        WHERE id = v_user.user_id;
      INSERT INTO public.credit_transactions
        (sender_id, receiver_id, amount, transaction_type, notes)
      VALUES (p_settled_by, v_user.user_id, v_settle_amt, 'SETTLEMENT',
        format('Match settled: %s won', (SELECT title FROM outcomes WHERE id = p_winning_outcome_id)));
      v_total_payout := v_total_payout + v_settle_amt;
    END IF;

    -- 4d. Record commission (audit only -- NO balance adjustment per D-01/D-04)
    IF v_commission > 0 THEN
      INSERT INTO public.credit_transactions
        (sender_id, receiver_id, amount, transaction_type, notes)
      VALUES (v_user.user_id, p_settled_by, v_commission, 'COMMISSION',
        format('Match commission: %s%% on net loss of %s in %s',
          v_comm_rate, ROUND(ABS(v_net_pnl), 2), v_event.title));
      v_total_commission := v_total_commission + v_commission;
    END IF;

    v_users_settled := v_users_settled + 1;
  END LOOP;

  -- 5. Build result summary
  v_result := jsonb_build_object(
    'event_id', p_event_id,
    'winning_outcome_id', p_winning_outcome_id,
    'users_settled', v_users_settled,
    'total_payout', v_total_payout,
    'total_commission', v_total_commission
  );

  RETURN v_result;
END;
$$;
```

### Pattern 2: Client-Side RPC Invocation (replaces settlement loop)
**What:** Replace the entire for-loop in settleMatchMarket() with a single RPC call.
**When to use:** After the RPC is deployed.
**Example:**
```javascript
// Source: Phase 1 adjust_balance invocation pattern in admin.html:2873
const { data: result, error: settleErr } = await sb.rpc('settle_match_market', {
  p_event_id: ev.id,
  p_winning_outcome_id: winningOutcomeId,
  p_settled_by: currentUser.id
});
if (settleErr) throw new Error(settleErr.message);
// result is { event_id, winning_outcome_id, users_settled, total_payout, total_commission }
```

### Pattern 3: COMMISSION Transaction Format
**What:** Commission recorded as a separate credit_transaction row with rich notes for audit trail.
**When to use:** For every client who loses on a match market and has match_commission > 0.
**Example:**
```
credit_transactions row:
  sender_id:        <client_id>     -- money flows FROM client conceptually
  receiver_id:      <admin_id>      -- money flows TO admin/house
  amount:           <commission>    -- the commission amount
  transaction_type: 'COMMISSION'
  notes:            'Match commission: 2.5% on net loss of 1500.00 in IPL Final'
```
Note: This row exists purely for the audit trail. No balance adjustment occurs for COMMISSION transactions (D-01/D-04).

### Anti-Patterns to Avoid
- **Netting commission into payout:** Never compute `settleAmt - commission`. SETTLEMENT amount is always the full exposure + netPnl. Commission is a separate audit entry. (Pitfall #2)
- **Applying commission to winners:** `if (netPnl >= 0) commission = 0` is mandatory for match bets. The agent.html already has the wrong formula (`estComm = totalVol * mComm`). (Pitfall #3)
- **Using adjust_balance for COMMISSION:** Since D-01/D-04 say commission does NOT affect balance, calling `adjust_balance` for commission would be a bug. Only insert the credit_transaction row.
- **Client-side commission calculation:** Commission must be computed inside the RPC, not passed as a parameter from the client. This prevents manipulation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Transaction atomicity | Multiple sequential Supabase calls | Single PL/pgSQL function | Race conditions, partial settlement risk |
| Rounding in admin's favor | Custom JS rounding | PostgreSQL `CEIL()` for deductions, `FLOOR()` for payouts | Consistent, can't be bypassed client-side |
| Commission rate hierarchy | Manual checks in JS | SQL JOIN with LEAST() in RPC | Enforced at data layer, not bypassable |

**Key insight:** Moving settlement to PostgreSQL means all commission logic is server-side and tamper-proof. Client-side code becomes a thin invocation layer.

## Common Pitfalls

### Pitfall 1: Reconciliation Formula Breaks with COMMISSION Transactions
**What goes wrong:** The admin ledger reconciliation (line 1810-1811) computes `netIssued = totalDeposits + totalSettlements - totalWithdrawals - totalCashSettled`. If COMMISSION transactions are counted as part of this formula, the reconciliation will show a drift because COMMISSION rows do NOT correspond to balance movements.
**Why it happens:** Code that filters `credit_transactions` by type may inadvertently include COMMISSION. Since no balance change occurs for COMMISSION (per D-01/D-04), including it in chip-flow calculations creates a phantom imbalance.
**How to avoid:** Explicitly EXCLUDE 'COMMISSION' from all chip-flow reconciliation queries. COMMISSION transactions are informational only. The reconciliation formula should remain: `netIssued = totalDeposits + totalSettlements + totalVoidRefunds - totalWithdrawals - totalCashSettled` (same as now, COMMISSION never enters the sum).
**Warning signs:** Reconciliation banner showing "Chip Drift Detected" after a settlement that included commission.

### Pitfall 2: Hedged Position Edge Case with Zero Net Loss
**What goes wrong:** A client bets LAGAI 1000 at rate 0.50 AND KHAI 500 at rate 0.55 on the same match. Depending on the outcome, their net P&L could be near zero. If the code computes commission per-order instead of per-user net, the client gets charged commission on the losing side while the winning side cancels it out. D-14 requires commission on NET P&L only.
**Why it happens:** The temptation is to iterate orders and compute commission per-order. The existing settlement code correctly aggregates fw/fl across all user orders before computing netPnl, so the net aggregation is already there.
**How to avoid:** Commission is computed AFTER the net P&L aggregation (fw/fl model), not inside the per-order loop. The RPC pattern above does this correctly -- commission is computed on v_net_pnl, which is already the user's net across all orders.
**Warning signs:** COMMISSION entries for users who have both LAGAI and KHAI orders on the same market but net to zero.

### Pitfall 3: SECURITY DEFINER vs SECURITY INVOKER for Settlement RPC
**What goes wrong:** Using SECURITY DEFINER elevates privileges, which could allow RLS bypass. Using SECURITY INVOKER (default) means the function runs with the caller's permissions. Since the current RLS policies are permissive (`USING (true)`), INVOKER works fine. But if RLS is tightened later, the settlement RPC could fail because it needs to read/write data across multiple users.
**Why it happens:** The tension between security and functionality in multi-user operations.
**How to avoid:** Use SECURITY INVOKER (default, matching Phase 1 convention). The current RLS policies allow authenticated users full access. Document that if RLS is tightened, the settlement RPC may need to become SECURITY DEFINER. This is a known trade-off, not a bug.
**Warning signs:** "permission denied" errors during settlement after RLS policy changes.

### Pitfall 4: Floating Point Precision in Commission Calculation
**What goes wrong:** JavaScript floating point: `0.1 + 0.2 = 0.30000000000000004`. If commission is computed client-side and compared with server-side values, they may differ. Even within PostgreSQL, NUMERIC vs FLOAT types behave differently.
**Why it happens:** Mixing NUMERIC (database) with JavaScript Number (client display).
**How to avoid:** All commission math happens in PostgreSQL using NUMERIC type (exact arithmetic). The RPC returns the commission amount already computed. Client-side JS only displays it. For any client-side display rounding, use `toFixed(2)` consistently with the existing codebase pattern.
**Warning signs:** Commission amounts differing by 0.01 between what's stored and what's displayed.

### Pitfall 5: COMM-05 Misimplementation
**What goes wrong:** A developer reads COMM-05 from REQUIREMENTS.md ("credits client balance") and implements a balance credit, contradicting the user's actual decision in CONTEXT.md D-01/D-04.
**Why it happens:** REQUIREMENTS.md was written before the discuss phase. CONTEXT.md represents the user's final decisions and overrides COMM-05.
**How to avoid:** The planner MUST explicitly note in every commission-related task: "COMMISSION transactions are audit-only. Do NOT call adjust_balance for commission. D-01/D-04 override COMM-05."
**Warning signs:** Client balances changing by the commission amount after settlement. `adjust_balance` being called with a commission delta.

### Pitfall 6: settle_amt Threshold Mismatch
**What goes wrong:** The current code uses `if (settleAmt > 0.001)` to skip zero/negligible payouts. The RPC must preserve this behavior -- if a client's exposure + netPnl rounds to zero or negative, no SETTLEMENT or balance update should occur. But a loser with settleAmt = 0 (pure loss, no exposure refund) still needs a COMMISSION entry if they have commission > 0.
**Why it happens:** The settle_amt check gates BOTH balance update and transaction insertion. Commission needs to be gated independently.
**How to avoid:** Separate the gating logic: SETTLEMENT + balance adjustment gated on `v_settle_amt > 0`. COMMISSION gated independently on `v_commission > 0 AND v_net_pnl < 0`. These are independent conditions.
**Warning signs:** Missing COMMISSION entries for users who lost everything (settleAmt = 0 but had a net loss).

## Code Examples

### Current Settlement Code (to be replaced)
```javascript
// Source: admin.html lines 2856-2882
// This entire for-loop is replaced by a single RPC call
for (const [userId, userOrds] of Object.entries(userMap)) {
  let fw = 0, fl = 0;
  userOrds.forEach(o => {
    const s = parseFloat(o.total_cost || 0), r = parseFloat(o.price_per_share || 1);
    if (o.bet_side === 'LAGAI')     { fw += s * r; fl -= s; }
    else if (o.bet_side === 'KHAI') { fw -= s;     fl += s / r; }
  });
  const exposure  = Math.max(0, -Math.min(fw, fl));
  const netPnl    = favTeamWon ? fw : fl;
  const settleAmt = parseFloat((exposure + netPnl).toFixed(4));
  // ... update balance, insert credit_transaction
}
```

### Commission Calculation Logic (inside RPC)
```sql
-- Source: CONTEXT.md D-02, D-05, D-10, D-12, D-14
-- Commission only applies to losers (netPnl < 0)
IF v_net_pnl < 0 THEN
  -- Get effective rate (capped at parent agent's rate)
  v_comm_rate := COALESCE(v_user.match_commission, 0);
  IF v_user.parent_id IS NOT NULL THEN
    SELECT match_commission INTO v_parent_rate
      FROM public.betting_users WHERE id = v_user.parent_id;
    IF v_parent_rate IS NOT NULL AND v_comm_rate > v_parent_rate THEN
      v_comm_rate := v_parent_rate;
    END IF;
  END IF;
  -- CEIL rounds up to favor admin (D-10)
  v_commission := CEIL(ABS(v_net_pnl) * v_comm_rate / 100.0 * 100.0) / 100.0;
END IF;
```

### Replacement settleMatchMarket() in admin.html
```javascript
// Source: Pattern derived from adjust_balance invocation at admin.html:2873
async function settleMatchMarket(ev, errEl) {
  const winningOutcomeId = document.getElementById('settleOutcomeSelect').value;
  const winningOutcome = allOutcomes.find(o => o.id === winningOutcomeId);
  if (!winningOutcome) { errEl.textContent = 'Select a winning outcome.'; return; }

  const { data: result, error: settleErr } = await sb.rpc('settle_match_market', {
    p_event_id: ev.id,
    p_winning_outcome_id: winningOutcomeId,
    p_settled_by: currentUser.id
  });
  if (settleErr) throw new Error(settleErr.message);

  await auditLog('SETTLE_MARKET', {
    targetId: ev.id,
    extra: {
      event: ev.title, winner: winningOutcome.title,
      users: result.users_settled,
      commission: result.total_commission
    },
    amount: result.total_payout
  });
  showToast(
    `Market settled! Winner: ${winningOutcome.title}. ` +
    `${result.total_payout.toLocaleString(undefined, {maximumFractionDigits: 2})} paid out. ` +
    `Commission: ${result.total_commission.toLocaleString(undefined, {maximumFractionDigits: 2})}`,
    'success'
  );
  closeModal('modalSettle');
  await refreshData();
}
```

### Reconciliation Compatibility (no changes needed)
```javascript
// Source: admin.html line 1803
// The existing filter already excludes COMMISSION by only including SETTLEMENT and VOID_REFUND:
const totalSettlements = allTransactions
  .filter(t => t.transaction_type === 'SETTLEMENT' || t.transaction_type === 'VOID_REFUND')
  .reduce((s, t) => s + parseFloat(t.amount || 0), 0);
// COMMISSION is NOT in this whitelist, so reconciliation works as-is.
// However, any NEW code that iterates all transactions must also exclude COMMISSION
// from chip-flow calculations (since COMMISSION does not move coins).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side read-modify-write | `adjust_balance` RPC (Phase 1) | Phase 1 | Balance mutations now atomic |
| `const commission = 0; // TODO` | Full commission RPC | Phase 2 (this phase) | Commission calculated and recorded |
| Per-call settlement loop | Single `settle_match_market` RPC | Phase 2 (this phase) | Entire settlement is one atomic transaction |

**Deprecated/outdated:**
- The `transfer_chips` function in migration_v6.sql uses SECURITY DEFINER. Phase 1 established SECURITY INVOKER as the convention. New RPC should follow INVOKER.

## Discretion Recommendations

### PL/pgSQL Function Structure
**Recommendation:** Single function with RETURNS JSONB. Use `FOR ... LOOP` to iterate users (PostgreSQL cursor pattern). Use `FOR UPDATE` on the event row to prevent concurrent settlement. Return a summary JSON object with payout and commission totals for the UI toast. Error handling via `RAISE EXCEPTION` which auto-rolls back the transaction.

### Commission Audit Trail in Notes Field
**Recommendation:** Use PostgreSQL `format()` for structured notes:
- SETTLEMENT: `format('Match settled: %s won in %s', winner_title, event_title)`
- COMMISSION: `format('Match commission: %s%% on net loss of %s in %s', rate, abs_loss, event_title)`

This provides human-readable audit data. For machine-readable data, consider adding an `event_id` column to credit_transactions (deferred -- can use notes for now and add the column in a later phase if needed).

### settlement_results Table
**Recommendation:** Defer to Phase 5. The RPC already returns commission data as JSONB. COMMISSION credit_transaction rows serve as the audit trail. Agent P&L calculation (Phase 5) can derive data from credit_transactions + orders. Creating the table now adds schema complexity without an immediate consumer.

## Open Questions

1. **What happens when settle_match_market is called on an already-settled event?**
   - What we know: The RPC should check `v_event.status = 'SETTLED'` and raise an exception.
   - What's unclear: Should it be idempotent (no-op if already settled) or error?
   - Recommendation: Error. Settlement should never happen twice. Admin can void and re-settle if needed.

2. **What about event_id on credit_transactions?**
   - What we know: credit_transactions has no event_id column. COMMISSION notes include the event title.
   - What's unclear: Will Phase 5 (Agent P&L) need to efficiently query commission by event?
   - Recommendation: Use notes for now. Add event_id column if Phase 5 needs it (simple ALTER TABLE, no data migration needed since notes contain the info).

3. **Should clients with zero orders be skipped silently?**
   - What we know: The RPC iterates `DISTINCT user_id` from orders, so only users with orders are processed.
   - Recommendation: Correct by construction. No special handling needed.

4. **Should the existing settleMatchMarket pre-checks remain client-side?**
   - What we know: Current code validates winning outcome selection and fetches event data client-side before the loop. The RPC also needs to validate.
   - Recommendation: Keep lightweight UI validation (outcome selected, event exists) client-side for fast user feedback. The RPC performs authoritative validation (event not already settled, outcome belongs to event). Defense in depth.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual testing (no automated test framework -- "Automated tests" is explicitly out of scope) |
| Config file | none |
| Quick run command | Manual: settle a test match market via admin UI |
| Full suite command | Manual: settle markets with various scenarios (all-losers, all-winners, hedged, mixed) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMM-01 | Commission = % of net loss, zero for winners | manual | Settle market, verify credit_transactions | N/A |
| COMM-02 | Rate from betting_users.match_commission | manual | Set rate to 5%, settle, verify 5% applied | N/A |
| COMM-03 | Rate capped at parent agent's rate | manual | Set client rate > agent rate, settle, verify cap | N/A |
| COMM-04 | Separate COMMISSION transaction row | manual | Check credit_transactions for COMMISSION type | N/A |
| COMM-05 (overridden) | Commission does NOT credit balance | manual | Verify client balance unchanged by commission | N/A |

### Sampling Rate
- **Per task commit:** Manually settle one test market and inspect credit_transactions
- **Per wave merge:** Test all 5 scenarios (winner, loser, hedged, zero-commission, hierarchy cap)
- **Phase gate:** Full scenario matrix green before `/gsd:verify-work`

### Wave 0 Gaps
- None -- no automated test infrastructure needed (out of scope per project constraints)

### Manual Test Scenarios
The planner should include these specific test scenarios in verification steps:

1. **Basic loser commission:** Client with match_commission=5% loses 1000. Expected: COMMISSION row with amount=50.00. Client balance NOT affected by commission.
2. **Winner gets zero commission:** Client with match_commission=5% wins 500. Expected: No COMMISSION row for this user.
3. **Hedged position (net zero):** Client has LAGAI 1000 and KHAI 1000, net P&L approximately 0. Expected: No COMMISSION row (or commission=0).
4. **Hedged position (net loss):** Client has LAGAI 1000 and KHAI 500, loses net. Expected: Commission on NET loss only, not on gross losing side.
5. **Hierarchy cap:** Client has match_commission=8%, parent agent has match_commission=5%. Expected: Effective rate = 5%.
6. **No parent (admin-direct client):** Client under admin with match_commission=3%. Expected: Rate = 3%, no parent cap applied.
7. **Zero commission rate:** Client with match_commission=0% loses. Expected: No COMMISSION row.
8. **Rounding favors admin:** Net loss = 33.33, rate = 7%. Raw commission = 2.3331. Expected: CEIL to 2.34 (rounded UP per D-10).
9. **Reconciliation integrity:** After settlement with commission, reconciliation banner shows "Chip Integrity OK" (no drift).
10. **Settle_amt = 0 but commission exists:** Client who loses everything (exposure fully consumed) still gets a COMMISSION audit entry.

## Project Constraints (from CLAUDE.md)

- **Tech stack:** Vanilla JS only -- no frameworks, no build tools, no TypeScript
- **Deployment:** Static hosting on Hostinger -- no server-side rendering
- **Database:** Supabase only -- no additional backend services
- **GSD Workflow:** Use `/gsd:execute-phase` for planned phase work. Do not make direct repo edits outside a GSD workflow unless explicitly asked.
- **No automated tests:** Explicitly out of scope per REQUIREMENTS.md
- **Commit docs:** commit_docs is true in config.json -- planning artifacts should be committed
- **Branching:** branching_strategy is "none" -- commits go directly to main
- **Nyquist validation:** enabled -- include validation architecture section

## Database Schema Reference

### betting_users (relevant columns)
```sql
id              UUID PRIMARY KEY
login_id        VARCHAR(10) UNIQUE NOT NULL
role            VARCHAR(10) NOT NULL  -- 'ADMIN', 'AGENT', 'CLIENT'
parent_id       UUID REFERENCES betting_users(id)  -- NULL for admin, agent_id for clients
balance         NUMERIC(15,2) DEFAULT 0
match_commission DECIMAL(5,2) DEFAULT 0  -- percentage (0-100)
fancy_commission DECIMAL(5,2) DEFAULT 0  -- percentage (0-100)
partnership_share DECIMAL(5,2) DEFAULT 0  -- agent's P&L share (Phase 5)
```

### orders (relevant columns)
```sql
id              UUID PRIMARY KEY
user_id         UUID REFERENCES betting_users(id)
outcome_id      UUID REFERENCES outcomes(id)
bet_side        TEXT          -- 'LAGAI', 'KHAI' (match) or 'YES', 'NO' (fancy)
total_cost      NUMERIC(15,2) -- stake amount
price_per_share NUMERIC(5,2)  -- rate at bet time
status          TEXT DEFAULT 'OPEN'  -- 'OPEN', 'SETTLED', 'VOID'
event_id        UUID REFERENCES events(id)
```

### credit_transactions (target for COMMISSION entries)
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
sender_id        UUID REFERENCES betting_users(id)
receiver_id      UUID REFERENCES betting_users(id)
amount           NUMERIC(15,2) NOT NULL
transaction_type VARCHAR(50) NOT NULL  -- existing: DEPOSIT, WITHDRAWAL, SETTLEMENT,
                                       -- VOID_REFUND, ADMIN_MINT, AGENT_SETTLEMENT
                                       -- new: COMMISSION
notes            TEXT
created_at       TIMESTAMP WITH TIME ZONE
```

### events (relevant columns)
```sql
id              UUID PRIMARY KEY
title           VARCHAR(255)
status          VARCHAR(20)  -- 'ACTIVE', 'SUSPENDED', 'SETTLED', 'VOID'
market_type     TEXT DEFAULT 'MATCH'  -- 'MATCH' or 'FANCY'
rate_team       TEXT  -- favored team name (determines LAGAI/KHAI mapping)
lagai_rate      NUMERIC DEFAULT 0.50
winning_outcome VARCHAR(50)
```

## Sources

### Primary (HIGH confidence)
- `admin.html` lines 2827-2892 -- Current settleMatchMarket() implementation (direct code analysis)
- `admin.html` lines 2285-2294 -- Commission hierarchy validation in UI (direct code analysis)
- `admin.html` lines 1790-1821 -- Reconciliation formula (direct code analysis)
- `sql/002_adjust_balance_rpc.sql` -- Phase 1 RPC pattern (direct code analysis)
- `migration_v6.sql` lines 17-46 -- transfer_chips RPC pattern (direct code analysis)
- `setup_complete.sql` lines 9-79 -- Complete schema with all columns (direct code analysis)
- `.planning/phases/02-match-commission/02-CONTEXT.md` -- User decisions (authoritative)
- `.planning/research/PITFALLS.md` -- Documented pitfalls #1-#7 (prior research)
- `.planning/research/ARCHITECTURE.md` -- Commission calculation patterns (prior research)

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md` -- Research synthesis (prior research, internally consistent)
- `.planning/PROJECT.md` -- Indian bookmaking model, commission rules

### Tertiary (LOW confidence)
- None -- all findings based on direct codebase analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, using existing PostgreSQL + Supabase patterns
- Architecture: HIGH -- settlement RPC pattern proven by adjust_balance and transfer_chips, commission logic directly from CONTEXT.md decisions
- Pitfalls: HIGH -- all pitfalls derived from direct code analysis (line numbers cited) and documented user decisions
- Commission formula: HIGH -- explicitly defined in CONTEXT.md D-02, D-05, D-14
- COMM-05 override: HIGH -- CONTEXT.md D-01/D-04 are unambiguous; they explicitly state "does NOT credit the client's balance"

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable domain, no external dependency drift)
