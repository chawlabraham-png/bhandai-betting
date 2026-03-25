# Phase 2: Match Commission - Research

**Researched:** 2026-03-25
**Domain:** Match market settlement commission logic, PostgreSQL RPC design, ledger entry patterns
**Confidence:** HIGH

## Summary

Phase 2 adds match commission to the existing `settleMatchMarket()` flow. The core change is: after computing each user's net P&L for a match market, if the user LOST money (netPnl < 0), a COMMISSION credit is applied equal to `|netPnl| * match_commission_rate / 100`. If the user won or broke even, commission is zero. Commission is a SEPARATE credit_transactions entry (type `COMMISSION`) distinct from the SETTLEMENT entry -- it is a rebate to the client, NOT a deduction from payout.

The critical implementation detail is that the existing exposure model in `settleMatchMarket()` already computes net P&L correctly for hedged positions (LAGAI + KHAI on the same match). The `fw`/`fl` variables accumulate across all orders for a user, so `netPnl = favTeamWon ? fw : fl` is already the net after hedging. Commission applies to this net figure. A user who hedged perfectly (netPnl = 0) pays zero commission. A user who hedged partially but still lost on net pays commission only on the net loss.

The success criteria require a single PostgreSQL RPC call for the entire settlement. This means migrating from the current client-side loop (which makes N individual DB calls per user) to a `settle_match_market` RPC that handles everything atomically: marking orders settled, computing P&L per user, computing commission per user, inserting SETTLEMENT and COMMISSION transactions, and updating balances. This RPC replaces the current `settleMatchMarket()` function in admin.html with a single `sb.rpc('settle_match_market', {...})` call.

**Primary recommendation:** Create a `settle_match_market(p_event_id, p_winning_outcome_id, p_admin_id)` PostgreSQL RPC that replicates the existing JS exposure math in PL/pgSQL, adds commission calculation with hierarchy enforcement, and returns a summary JSON. The admin.html `settleMatchMarket()` function becomes a thin wrapper that calls this RPC and handles the UI response.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMM-01 | Match commission calculated as % of client's net loss per market (zero if client wins) | Exposure model at admin.html:2857-2864 already computes `netPnl` per user (handles hedged LAGAI+KHAI). Commission formula: `if (netPnl >= 0) return 0; else return abs(netPnl) * rate / 100`. |
| COMM-02 | Match commission uses client's `match_commission` rate from `betting_users` at settlement time | Field exists: `DECIMAL(5,2) DEFAULT 0` on betting_users (setup_complete.sql:18). Currently unused at settlement. RPC must SELECT from betting_users at settlement time. |
| COMM-03 | Match commission enforces hierarchy -- client rate capped at parent agent's rate at settlement | Hierarchy enforcement already exists at user-creation time (admin.html:2291-2294) and edit time (admin.html:2543-2544). Settlement must re-enforce: `effective_rate = LEAST(client.match_commission, parent_agent.match_commission)`. This catches cases where an agent's rate was lowered after client creation. |
| COMM-04 | Match commission inserted as separate COMMISSION transaction in credit_transactions (not netted into SETTLEMENT) | credit_transactions.transaction_type is VARCHAR(50) with no CHECK constraint -- new COMMISSION type inserts freely. Existing ledger display at admin.html:1881 classifies types as credit/debit by name -- needs COMMISSION added to display logic. |
| COMM-05 | Match commission credits client balance (positive entry -- rebate, not fee) | Commission is a credit TO the client (sender=admin, receiver=client, positive amount). The SETTLEMENT entry returns exposure; COMMISSION is an additional positive entry on top. Net balance change = settleAmt + commissionAmt. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack**: Vanilla JS only -- no frameworks, no build tools, no TypeScript
- **Deployment**: Static hosting on Hostinger -- no server-side rendering
- **Database**: Supabase only -- no additional backend services
- **Naming**: Supabase client must be `const sb = window.supabaseClient` (admin/agent) or `const db = window.supabaseClient` (client). NEVER `const supabase = ...`
- **Security**: `sanitize(str)` for all user-supplied content, `auditLog()` for admin actions
- **GSD Workflow**: Do not make direct repo edits outside a GSD workflow unless user explicitly asks
- **Modularization approach**: Classic `<script>` tags with namespace convention (`window.BX`), NOT ES modules (locked decision from STATE.md)
- **Agent P&L storage**: Persist in `settlement_results` table at settlement time (locked decision from STATE.md)
- **Commission rate snapshot timing**: Use rate at settlement time, not bet time (locked decision from success criteria)

## Standard Stack

### Core

No new libraries or dependencies. Everything uses existing platform capabilities.

| Technology | Version | Purpose | Why Standard |
|------------|---------|---------|--------------|
| PostgreSQL PL/pgSQL | Built into Supabase (PG 15+) | `settle_match_market` RPC function | Native database function. Already proven with `adjust_balance` RPC from Phase 1. |
| Supabase JS SDK v2 | Already loaded via CDN | Calling `.rpc('settle_match_market', {...})` from frontend | Already in use. `.rpc()` method wraps call in transaction automatically. |
| `adjust_balance` RPC | Phase 1 deployed | Atomic balance mutations within the new RPC | Reused inside `settle_match_market` via `PERFORM adjust_balance(...)` or direct SQL. |

### Supporting

None. Zero new packages.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Full PostgreSQL RPC | Keep client-side JS loop, just add commission to it | Violates success criterion #5 (single RPC call). Also, JS loop is non-atomic -- partial settlement failure leaves data inconsistent. |
| `PERFORM adjust_balance(...)` inside RPC | Direct `UPDATE balance = balance + delta` SQL | Direct SQL is simpler within PL/pgSQL. `adjust_balance` adds the NOT FOUND check but inside a transaction this is less critical. Either approach works; direct SQL recommended for simplicity within the RPC. |
| Commission as positive credit to client | Commission as negative deduction from client | REQUIREMENTS explicitly state commission is a credit/rebate (COMM-05). Deduction model violates the spec. |

**Installation:**
```bash
# No installation needed. RPC created via Supabase SQL Editor.
# Frontend already has supabase-js v2 loaded via CDN.
```

## Architecture Patterns

### Current settleMatchMarket Flow (admin.html:2827-2882)

```
Admin clicks "Settle" -> selects winning outcome
  |
  1. Determine favTeamWon from rate_team vs winning outcome
  2. Fetch all OPEN orders for event
  3. Mark event as SETTLED, mark winning outcome
  4. Group orders by user_id
  5. FOR EACH USER:
     a. Compute fw/fl from LAGAI/KHAI orders
     b. exposure = max(0, -min(fw, fl))
     c. netPnl = favTeamWon ? fw : fl
     d. settleAmt = exposure + netPnl
     e. Mark orders SETTLED (individual UPDATE per order)
     f. If settleAmt > 0: adjust_balance + insert SETTLEMENT txn
  6. Audit log + toast + refreshData
```

### Target settle_match_market RPC Flow

```
sb.rpc('settle_match_market', { p_event_id, p_winning_outcome_id, p_admin_id })
  |
  IN POSTGRESQL (single transaction):
  1. Validate event exists, is ACTIVE, has matching outcome
  2. Determine favTeamWon: compare outcome.title with event.rate_team
  3. Fetch all OPEN orders with bet_side, total_cost, price_per_share, user_id
  4. Group by user_id, compute fw/fl/exposure/netPnl per user
  5. For each user:
     a. Fetch user's match_commission rate from betting_users
     b. Fetch parent agent's match_commission rate (via parent_id JOIN)
     c. effective_rate = LEAST(user.match_commission, COALESCE(agent.match_commission, user.match_commission))
     d. commission = CASE WHEN netPnl < 0 THEN ABS(netPnl) * effective_rate / 100 ELSE 0 END
     e. settleAmt = exposure + netPnl
     f. balance_delta = settleAmt + commission  (commission is a credit)
     g. UPDATE balance = balance + balance_delta
     h. INSERT SETTLEMENT transaction (amount = settleAmt)
     i. INSERT COMMISSION transaction IF commission > 0 (amount = commission)
  6. UPDATE all orders to SETTLED
  7. UPDATE event to SETTLED with winning_outcome
  8. RETURN JSON summary: { users_settled, total_payout, total_commission, per_user_results }
```

### Exposure Model Math (Preserved from JS)

The existing JS math must be faithfully replicated in PL/pgSQL:

```sql
-- For each user's orders on this match event:
-- LAGAI orders: fw += stake * rate;  fl -= stake;
-- KHAI orders:  fw -= stake;         fl += stake / rate;
--
-- exposure  = GREATEST(0, -LEAST(fw, fl))
-- netPnl    = CASE WHEN favTeamWon THEN fw ELSE fl END
-- settleAmt = exposure + netPnl
```

Key insight: `fw` = profit/loss if favorite wins. `fl` = profit/loss if favorite loses. For a LAGAI bet (back favorite): you gain `stake * rate` if fav wins, you lose `stake` if fav loses. For KHAI (lay favorite): you lose `stake` if fav wins, you gain `stake / rate` if fav loses.

For hedged positions (both LAGAI and KHAI on same match), `fw` and `fl` accumulate across both sides, producing the NET scenario outcome. The exposure is the worst-case locked amount. This automatically handles hedging -- no special case needed.

### Commission Calculation Pattern

```sql
-- Match commission: % of client losses only
-- If client won or broke even on this market: commission = 0
-- If client lost: commission = |netPnl| * effective_rate / 100
-- Commission is a CREDIT (positive balance adjustment to client)

effective_rate := LEAST(
  v_user.match_commission,
  COALESCE(v_agent.match_commission, v_user.match_commission)
);

IF v_net_pnl < 0 THEN
  v_commission := ABS(v_net_pnl) * effective_rate / 100.0;
ELSE
  v_commission := 0;
END IF;
```

### COMMISSION Transaction Pattern

```sql
-- SETTLEMENT: returns locked exposure (always positive or zero)
INSERT INTO credit_transactions (sender_id, receiver_id, amount, transaction_type, notes)
VALUES (p_admin_id, v_user_id, v_settle_amt, 'SETTLEMENT',
  format('Match settled: %s won in %s', v_winner_title, v_event_title));

-- COMMISSION: separate credit to client (only if commission > 0)
IF v_commission > 0.001 THEN
  INSERT INTO credit_transactions (sender_id, receiver_id, amount, transaction_type, notes)
  VALUES (p_admin_id, v_user_id, v_commission, 'COMMISSION',
    format('Match commission: %s%% on loss of %s in %s',
      v_effective_rate, round(ABS(v_net_pnl), 2), v_event_title));
END IF;

-- Balance update: settleAmt + commission (both are credits)
UPDATE betting_users SET balance = balance + v_settle_amt + v_commission
WHERE id = v_user_id;
```

### Hierarchy Enforcement Logic

The hierarchy cap already exists at user creation (admin.html:2291) and edit time (admin.html:2543). But rates can change between creation and settlement. The RPC must re-enforce at settlement:

```sql
-- Fetch client's parent agent
SELECT bu_agent.match_commission INTO v_agent_match_comm
FROM betting_users bu_agent
WHERE bu_agent.id = v_user.parent_id;

-- Client's effective rate is capped at parent's rate
v_effective_rate := LEAST(v_user.match_commission, COALESCE(v_agent_match_comm, v_user.match_commission));
```

If `parent_id` is the admin (not an agent), or if `parent_id` is NULL, the client's own rate applies uncapped. `COALESCE` handles this gracefully.

### Client-Side Migration

```javascript
// BEFORE (admin.html:2827-2882): 60+ lines of JS with N DB calls
async function settleMatchMarket(ev, errEl) {
  // ... all the loop logic ...
}

// AFTER: single RPC call
async function settleMatchMarket(ev, errEl) {
  const winningOutcomeId = document.getElementById('settleOutcomeSelect').value;
  if (!winningOutcomeId) { errEl.textContent = 'Select a winning outcome.'; return; }

  const { data: result, error } = await sb.rpc('settle_match_market', {
    p_event_id: ev.id,
    p_winning_outcome_id: winningOutcomeId,
    p_admin_id: currentUser.id
  });
  if (error) throw new Error(error.message);

  // result contains: { users_settled, total_payout, total_commission, per_user_results }
  await auditLog('SETTLE_MARKET', {
    targetId: ev.id,
    extra: { event: ev.title, winner: result.winner_title, users: result.users_settled },
    amount: result.total_payout
  });
  showToast(`Market settled! Winner: ${result.winner_title}. ${result.total_payout.toLocaleString(undefined,{maximumFractionDigits:2})} paid out. Commission: ${result.total_commission.toLocaleString(undefined,{maximumFractionDigits:2})}`, 'success');
  closeModal('modalSettle');
  await refreshData();
}
```

### Ledger Display Updates

COMMISSION entries must appear in all three views. The changes are small:

**admin.html:**
- Line 505-509 (filter dropdown): Add `<option value="COMMISSION">Commission</option>`
- Line 1881 (`isCredit` classification): Add `'COMMISSION'` to credit array: `['DEPOSIT', 'SETTLEMENT', 'VOID_REFUND', 'COMMISSION']`
- The existing rendering code at lines 1878-1891 already displays `tx.transaction_type` and `tx.notes` generically -- COMMISSION entries will appear automatically with the correct type badge and notes.

**agent.html:**
- Line 386-392 (type filter): Add `<option value="COMMISSION">Commission</option>`
- Line 965 (isDeposit/credit check): Add `'COMMISSION'` to credit array: `['DEPOSIT','SETTLEMENT','VOID_REFUND','COMMISSION']`
- Line 1106 (ledger isCredit): Same addition.

**client.html:**
- No ledger filter exists on client side (history tab uses order-based rendering, not transaction-based)
- COMMISSION transactions will be visible if/when a transaction-based ledger is added (Phase 4: Commission Visibility)

### Anti-Patterns to Avoid

- **DO NOT net commission into the SETTLEMENT amount.** The existing `settleFancyMarket()` has scaffolding for this wrong pattern: `netPayout = grossPayout * (1 - commission / 100)` at line 2928. Match settlement must NOT follow this pattern. SETTLEMENT is full amount; COMMISSION is separate.
- **DO NOT apply commission to users who won.** `if (netPnl >= 0) commission = 0`. No exceptions.
- **DO NOT skip the hierarchy cap.** Even if the client's rate is set correctly at creation time, re-check at settlement.
- **DO NOT use the volume-based formula.** Match commission is on LOSSES, not volume. The agent.html estimate at line 1186 (`estComm = totalVol * mComm`) is wrong. Do not replicate that pattern.
- **DO NOT insert COMMISSION entries with amount = 0.** Only insert if commission > 0.001 (matching the existing settleAmt threshold).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic multi-user settlement | Client-side loop with individual DB calls | PostgreSQL RPC (single transaction) | PostgREST auto-wraps RPC in transaction. If any step fails, ALL changes roll back. Client-side loop leaves partial state on failure. |
| Floating point commission amounts | Raw JS float multiplication | `NUMERIC(15,2)` in PostgreSQL with `ROUND(..., 2)` | PostgreSQL NUMERIC is arbitrary precision. JS floats have IEEE 754 drift. Let the database do the math. |
| Parent agent lookup per user | Client-side JOIN (fetch all users, filter by parent_id in JS) | SQL JOIN inside the RPC | `JOIN betting_users parent ON parent.id = bu.parent_id` is one operation vs. N+1 queries. |

## Common Pitfalls

### Pitfall 1: Exposure Model Replication Error in PL/pgSQL

**What goes wrong:** The PL/pgSQL version of the fw/fl/exposure/netPnl calculation produces different results than the JS version due to subtle differences in numeric handling, loop ordering, or sign conventions.

**Why it happens:** Translating JS float math to PostgreSQL NUMERIC arithmetic requires care. JS `parseFloat(o.total_cost || 0)` has different null-handling than PostgreSQL `COALESCE(o.total_cost, 0)`. The `toFixed(4)` rounding in JS (`settleAmt = parseFloat((exposure + netPnl).toFixed(4))`) must be replicated.

**How to avoid:**
1. Use `NUMERIC` types throughout the RPC (not `FLOAT` or `DOUBLE PRECISION`)
2. Apply `ROUND(v_settle_amt, 4)` to match the JS `toFixed(4)` behavior
3. Test with known inputs: a pure LAGAI bet, a pure KHAI bet, a hedged bet with both sides, and verify the RPC output matches the JS calculation exactly

**Warning signs:** Settlement amounts that differ by fractions of a coin between the old JS path and the new RPC path.

### Pitfall 2: Commission Applied Before settleAmt Threshold Check

**What goes wrong:** The current code only processes users where `settleAmt > 0.001`. But a user who lost everything (`settleAmt = 0` because `exposure + netPnl = 0`) should still receive commission on their loss. If commission is only computed inside the `if (settleAmt > 0.001)` block, losing users get zero commission.

**Why it happens:** In the current code without commission, a user whose settleAmt is zero has nothing to return. But with commission, they may still be owed a rebate on their loss.

**How to avoid:** Commission calculation must happen for ALL users with orders, not just those with positive settleAmt. The flow should be:
1. Compute settleAmt AND commission for every user
2. Only skip balance adjustment if BOTH settleAmt and commission are negligible
3. A user with settleAmt=0 but commission=50 should still get the commission credit

**Warning signs:** Users who lost their entire stake on a match market receiving zero commission.

### Pitfall 3: COMMISSION Credit Direction Confusion

**What goes wrong:** The developer inserts COMMISSION with `sender_id = client, receiver_id = admin` (modeling it as money flowing FROM client TO admin, i.e., a fee). But COMM-05 says commission is a CREDIT TO the client -- it flows FROM admin TO client.

**Why it happens:** In most systems, "commission" is a charge. In Indian bookmaking, match commission is a rebate/incentive. The naming is counter-intuitive.

**How to avoid:** COMMISSION transaction: `sender_id = admin (p_admin_id), receiver_id = client (v_user_id), amount = v_commission (positive)`. This matches the SETTLEMENT pattern where admin credits the client.

**Warning signs:** Client balance going DOWN after commission is applied, or the ledger showing commission as a debit.

### Pitfall 4: RPC Returning NULL Instead of JSON

**What goes wrong:** The PL/pgSQL function returns a complex type (JSON summary) but the Supabase SDK deserializes it incorrectly, or the function returns NULL because a branch was missed.

**Why it happens:** PL/pgSQL functions that return `JSON` or `JSONB` need explicit construction. If any branch falls through without a RETURN statement, the function returns NULL silently.

**How to avoid:** Always build the return JSON explicitly. Use `RETURN jsonb_build_object(...)` at the end of the function. Test with empty markets (zero orders) to ensure the degenerate case returns a valid JSON, not NULL.

**Warning signs:** `result` is `null` after the RPC call, even though no error was thrown.

### Pitfall 5: Hierarchy Cap When Agent Has No match_commission Set

**What goes wrong:** An agent was created before commission fields were added, so their `match_commission` is the default `0.00`. The hierarchy cap `LEAST(client.match_commission, agent.match_commission)` produces 0 for all clients of this agent, even if the client has a non-zero rate.

**Why it happens:** `DECIMAL(5,2) DEFAULT 0` means old agents legitimately have rate 0. `LEAST(client_rate, 0) = 0` always.

**How to avoid:** Treat agent rate of 0 as "uncapped" (no commission configured for agent, so don't override client's rate). The cap logic should be:
```sql
IF v_agent_match_comm IS NULL OR v_agent_match_comm = 0 THEN
  v_effective_rate := v_user.match_commission;
ELSE
  v_effective_rate := LEAST(v_user.match_commission, v_agent_match_comm);
END IF;
```
Alternatively, if agents with rate=0 genuinely mean "no commission for clients," then LEAST works as-is. This is a business decision. **Recommendation:** Treat agent rate=0 as "use client's own rate" -- an agent who hasn't had commission configured shouldn't block their clients from getting commission.

### Pitfall 6: Settlement Still Works for Markets With Zero Orders

**What goes wrong:** Admin settles a market with no open orders. The RPC should handle this gracefully (no error, just zero results) rather than failing.

**How to avoid:** Early return with empty results if no OPEN orders exist for the event.

## Code Examples

### Example 1: Complete settle_match_market RPC

```sql
CREATE OR REPLACE FUNCTION public.settle_match_market(
  p_event_id UUID,
  p_winning_outcome_id UUID,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_event RECORD;
  v_winning_outcome RECORD;
  v_fav_team_won BOOLEAN;
  v_rate_team_oc RECORD;
  v_user RECORD;
  v_order RECORD;
  v_fw NUMERIC;
  v_fl NUMERIC;
  v_exposure NUMERIC;
  v_net_pnl NUMERIC;
  v_settle_amt NUMERIC;
  v_commission NUMERIC;
  v_effective_rate NUMERIC;
  v_agent_match_comm NUMERIC;
  v_balance_delta NUMERIC;
  v_total_payout NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_users_settled INTEGER := 0;
  v_per_user JSONB := '[]'::JSONB;
BEGIN
  -- 1. Validate event
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found: %', p_event_id; END IF;
  IF v_event.status != 'ACTIVE' THEN RAISE EXCEPTION 'Event is not ACTIVE: %', v_event.status; END IF;

  -- 2. Validate winning outcome
  SELECT * INTO v_winning_outcome FROM outcomes WHERE id = p_winning_outcome_id AND event_id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Outcome not found for this event'; END IF;

  -- 3. Determine if rate_team (favourite) won
  SELECT * INTO v_rate_team_oc FROM outcomes
    WHERE event_id = p_event_id AND title = v_event.rate_team
    LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_rate_team_oc FROM outcomes WHERE event_id = p_event_id LIMIT 1;
  END IF;
  v_fav_team_won := (v_rate_team_oc.id = p_winning_outcome_id);

  -- 4. Mark event settled
  UPDATE events SET status = 'SETTLED', is_resolved = true, winning_outcome = v_winning_outcome.title
    WHERE id = p_event_id;
  UPDATE outcomes SET is_winner = true WHERE id = p_winning_outcome_id;

  -- 5. Process each user with open orders
  FOR v_user IN
    SELECT DISTINCT o.user_id,
           bu.match_commission AS user_match_comm,
           bu.parent_id
    FROM orders o
    JOIN betting_users bu ON bu.id = o.user_id
    WHERE o.outcome_id IN (SELECT id FROM outcomes WHERE event_id = p_event_id)
      AND o.status = 'OPEN'
  LOOP
    -- Compute fw/fl across all user's orders on this event
    v_fw := 0; v_fl := 0;
    FOR v_order IN
      SELECT total_cost, price_per_share, bet_side FROM orders
      WHERE user_id = v_user.user_id
        AND outcome_id IN (SELECT id FROM outcomes WHERE event_id = p_event_id)
        AND status = 'OPEN'
    LOOP
      IF v_order.bet_side = 'LAGAI' THEN
        v_fw := v_fw + COALESCE(v_order.total_cost, 0) * COALESCE(v_order.price_per_share, 1);
        v_fl := v_fl - COALESCE(v_order.total_cost, 0);
      ELSIF v_order.bet_side = 'KHAI' THEN
        v_fw := v_fw - COALESCE(v_order.total_cost, 0);
        v_fl := v_fl + COALESCE(v_order.total_cost, 0) / COALESCE(NULLIF(v_order.price_per_share, 0), 1);
      END IF;
    END LOOP;

    v_exposure := GREATEST(0, -LEAST(v_fw, v_fl));
    v_net_pnl := CASE WHEN v_fav_team_won THEN v_fw ELSE v_fl END;
    v_settle_amt := ROUND(v_exposure + v_net_pnl, 4);

    -- Commission: hierarchy-capped rate, losses only
    v_agent_match_comm := NULL;
    IF v_user.parent_id IS NOT NULL THEN
      SELECT match_commission INTO v_agent_match_comm
      FROM betting_users WHERE id = v_user.parent_id;
    END IF;

    IF v_agent_match_comm IS NOT NULL AND v_agent_match_comm > 0 THEN
      v_effective_rate := LEAST(v_user.user_match_comm, v_agent_match_comm);
    ELSE
      v_effective_rate := v_user.user_match_comm;
    END IF;

    IF v_net_pnl < 0 THEN
      v_commission := ROUND(ABS(v_net_pnl) * v_effective_rate / 100.0, 2);
    ELSE
      v_commission := 0;
    END IF;

    -- Mark orders settled
    UPDATE orders SET status = 'SETTLED'
    WHERE user_id = v_user.user_id
      AND outcome_id IN (SELECT id FROM outcomes WHERE event_id = p_event_id)
      AND status = 'OPEN';

    -- Balance and transactions
    v_balance_delta := v_settle_amt + v_commission;

    IF v_settle_amt > 0.001 THEN
      INSERT INTO credit_transactions (sender_id, receiver_id, amount, transaction_type, notes)
      VALUES (p_admin_id, v_user.user_id, v_settle_amt, 'SETTLEMENT',
        format('Match settled: %s won in %s', v_winning_outcome.title, v_event.title));
      v_total_payout := v_total_payout + v_settle_amt;
    END IF;

    IF v_commission > 0.001 THEN
      INSERT INTO credit_transactions (sender_id, receiver_id, amount, transaction_type, notes)
      VALUES (p_admin_id, v_user.user_id, v_commission, 'COMMISSION',
        format('Match commission: %s%% on loss of %s in %s',
          v_effective_rate, ROUND(ABS(v_net_pnl), 2), v_event.title));
      v_total_commission := v_total_commission + v_commission;
    END IF;

    IF ABS(v_balance_delta) > 0.001 THEN
      UPDATE betting_users SET balance = balance + v_balance_delta WHERE id = v_user.user_id;
    END IF;

    v_users_settled := v_users_settled + 1;
    v_per_user := v_per_user || jsonb_build_object(
      'user_id', v_user.user_id,
      'net_pnl', v_net_pnl,
      'settle_amt', v_settle_amt,
      'commission', v_commission,
      'effective_rate', v_effective_rate
    );
  END LOOP;

  RETURN jsonb_build_object(
    'users_settled', v_users_settled,
    'total_payout', v_total_payout,
    'total_commission', v_total_commission,
    'winner_title', v_winning_outcome.title,
    'per_user_results', v_per_user
  );
END;
$$;
```

### Example 2: Client-Side Replacement

```javascript
// Replaces admin.html:2827-2892
async function settleMatchMarket(ev, errEl) {
  const winningOutcomeId = document.getElementById('settleOutcomeSelect').value;
  const winningOutcome = allOutcomes.find(o => o.id === winningOutcomeId);
  if (!winningOutcome) { errEl.textContent = 'Select a winning outcome.'; return; }

  const { data: result, error } = await sb.rpc('settle_match_market', {
    p_event_id: ev.id,
    p_winning_outcome_id: winningOutcomeId,
    p_admin_id: currentUser.id
  });
  if (error) throw new Error(error.message);

  await auditLog('SETTLE_MARKET', {
    targetId: ev.id,
    extra: {
      event: ev.title,
      winner: result.winner_title,
      users: result.users_settled,
      commission: result.total_commission
    },
    amount: result.total_payout
  });

  const commMsg = result.total_commission > 0
    ? ` Commission: ${result.total_commission.toLocaleString(undefined,{maximumFractionDigits:2})}`
    : '';
  showToast(
    `Market settled! Winner: ${result.winner_title}. `
    + `${result.total_payout.toLocaleString(undefined,{maximumFractionDigits:2})} paid out.${commMsg}`,
    'success'
  );
  closeModal('modalSettle');
  await refreshData();
}
```

### Example 3: Ledger Display Update

```javascript
// admin.html line 1881 -- add COMMISSION to credit types
const isCredit = ['DEPOSIT', 'SETTLEMENT', 'VOID_REFUND', 'COMMISSION'].includes(tx.transaction_type);

// agent.html line 965 -- same pattern
const isDeposit = ['DEPOSIT','SETTLEMENT','VOID_REFUND','COMMISSION'].includes(tx.transaction_type);

// agent.html line 1106 -- same pattern
const isCredit = ['DEPOSIT','SETTLEMENT','VOID_REFUND','COMMISSION'].includes(tx.transaction_type);
```

## Hedged Position Analysis (LAGAI + KHAI on Same Match)

This was flagged as an open question. The answer is: **the existing exposure model already handles hedging correctly, and commission simply applies to the net result.**

**Worked example:**
- User places LAGAI 100 at rate 1.40 (fw += 140, fl -= 100)
- User places KHAI 50 at rate 1.40 (fw -= 50, fl += 50/1.40 = 35.71)
- Net: fw = 90, fl = -64.29
- Exposure = max(0, -min(90, -64.29)) = max(0, 64.29) = 64.29
- If fav wins: netPnl = fw = 90, settleAmt = 64.29 + 90 = 154.29, commission = 0 (user won)
- If fav loses: netPnl = fl = -64.29, settleAmt = 64.29 + (-64.29) = 0, commission = 64.29 * rate%

In the fav-loses case, the user's loss is 64.29 (net after hedging). Commission applies to this net loss. The user gets their exposure back (0 payout) plus commission on the loss. This is correct -- commission on the net position, not on individual legs.

**Key for Pitfall 2:** In the fav-loses case, settleAmt = 0 but commission > 0. The RPC MUST still process this user (insert COMMISSION transaction, update balance).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side settlement loop with N DB calls | PostgreSQL RPC (single atomic transaction) | Phase 2 | Eliminates race conditions, reduces settlement from 150+ HTTP calls to 1 |
| `const commission = 0; // TODO` | Actual commission calculation using `match_commission` field | Phase 2 | Platform economics become correct |
| No hierarchy enforcement at settlement | `LEAST(client_rate, agent_rate)` in RPC | Phase 2 | Prevents clients from having higher rates than their agent |

## Open Questions

1. **Agent rate of 0 meaning**
   - What we know: `match_commission DECIMAL(5,2) DEFAULT 0` means unset agents have rate 0.
   - What's unclear: Does 0 mean "no commission cap" (client uses their own rate) or "zero commission for all clients"?
   - Recommendation: Treat 0 as "uncapped" (use client's own rate). An agent who hasn't been configured shouldn't block client commission. This can be revisited if the business rule differs.

2. **Commission rounding**
   - What we know: Balances use `NUMERIC(15,2)`. Commission rates are `DECIMAL(5,2)` (max 999.99, but really 0-100).
   - What's unclear: Should commission be rounded to 2 decimal places (matching balance precision) or 4 (matching settleAmt precision)?
   - Recommendation: Round commission to 2 decimal places (`ROUND(v_commission, 2)`) since it represents currency and is stored in `credit_transactions.amount` which is `NUMERIC(15,2)`.

3. **Void market with existing COMMISSION entries**
   - What we know: VOID_REFUND exists for undoing settlements. Phase 2 does not include void handling.
   - What's unclear: When a market with commission is voided, should COMMISSION entries be reversed?
   - Recommendation: Defer to v2 (COMM-V2-01 in REQUIREMENTS.md). For Phase 2, void behavior is unchanged -- it only reverses SETTLEMENT entries. COMMISSION reversal is a separate feature.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase SQL Editor | Creating settle_match_market RPC | Via web (supabase.com dashboard) | N/A | Supabase CLI |
| adjust_balance RPC | Phase 1 prerequisite | Deployed (Phase 1 complete) | N/A | -- |
| PostgreSQL PL/pgSQL | RPC function language | Built into Supabase | PG 15+ | -- |
| Git | Version control | Yes | Available | -- |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None. All dependencies available.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None -- no test framework installed. Automated tests explicitly out of scope (REQUIREMENTS.md). |
| Config file | None |
| Quick run command | Manual verification via browser + Supabase SQL Editor |
| Full suite command | N/A |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMM-01 | Client who lost gets commission = rate% of loss; client who won gets 0 | manual | Settle a match with known bets, verify credit_transactions | N/A |
| COMM-01 | Hedged position (LAGAI+KHAI) gets commission on NET loss only | manual | Place opposing bets, settle, verify commission amount matches net loss | N/A |
| COMM-02 | Commission uses `match_commission` from betting_users at settlement time | manual | Change rate between bet and settlement, verify settlement uses current rate | N/A |
| COMM-03 | Client rate capped at parent agent's rate | manual | Set client rate > agent rate, settle, verify effective rate = agent rate | N/A |
| COMM-03 | Agent with rate 0: client uses own rate (uncapped) | manual | Agent rate=0, client rate=2, verify commission = 2% | N/A |
| COMM-04 | COMMISSION appears as separate row in credit_transactions | manual | After settlement, query `SELECT * FROM credit_transactions WHERE transaction_type = 'COMMISSION'` | N/A |
| COMM-04 | COMMISSION notes contain market name and loss amount | manual | Check notes field of COMMISSION entries | N/A |
| COMM-05 | COMMISSION credits balance (positive) | manual | Check client balance increased by settleAmt + commission | N/A |
| ALL | Full settlement via single RPC call (no client-side loop) | manual (code review) | Verify admin.html calls `sb.rpc('settle_match_market', ...)` with no inner loop | N/A |

### Sampling Rate
- **Per task commit:** Manual verification: settle a test match market, inspect credit_transactions and balances in Supabase dashboard
- **Per wave merge:** Settle multiple markets: (1) pure LAGAI winner, (2) pure KHAI loser, (3) hedged user, (4) user with 0 commission rate, (5) market with no orders
- **Phase gate:** All 5 COMM requirements verified before `/gsd:verify-work`

### Wave 0 Gaps
- No test framework and none will be added (automated tests deferred per REQUIREMENTS.md)
- Verification SQL queries should be documented in the plan for manual execution:
  - `SELECT * FROM credit_transactions WHERE event_id = '...' ORDER BY created_at`
  - `SELECT login_id, balance FROM betting_users WHERE id IN (...)`
- Consider adding a verification SQL file (`sql/verify_commission.sql`) with test queries

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** -- direct inspection of `settleMatchMarket()` at admin.html:2827-2882, exposure model math at lines 2857-2865, commission fields in setup_complete.sql:18-20, hierarchy enforcement at admin.html:2291-2294
- **Phase 1 research and implementation** -- `adjust_balance` RPC deployed and working (sql/002_adjust_balance_rpc.sql), PostgREST transaction wrapping confirmed
- **Schema analysis** -- betting_users fields (match_commission DECIMAL(5,2), parent_id UUID), credit_transactions structure (VARCHAR(50) transaction_type, notes TEXT), no CHECK constraints on transaction_type
- **Project research** -- PITFALLS.md pitfalls #1-3 directly relevant, ARCHITECTURE.md commission data flow, SUMMARY.md recommendations

### Secondary (MEDIUM confidence)
- **Supabase PL/pgSQL patterns** -- PostgreSQL function syntax, JSONB return types, FOR..IN..LOOP patterns. Based on training data + Phase 1 verified RPC pattern.

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources (codebase + deployed Phase 1 RPC)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, using the same PL/pgSQL + Supabase pattern proven in Phase 1
- Architecture: HIGH -- exposure model fully understood from codebase analysis, commission formula is simple arithmetic on existing variables
- Pitfalls: HIGH -- all pitfalls derived from specific code evidence (line numbers) and worked examples
- Commission formula: HIGH -- confirmed by PROJECT.md, REQUIREMENTS.md, and Indian bookmaking domain conventions across all research files

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable -- PL/pgSQL and Supabase RPC are mature, unchanging APIs)
