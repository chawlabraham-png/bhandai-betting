# Phase 5: Agent P&L Core - Research

**Researched:** 2026-03-25
**Domain:** PostgreSQL PL/pgSQL RPC extension, financial aggregation, settlement_results table design
**Confidence:** HIGH

## Summary

Phase 5 extends two existing settlement RPCs (settle_match_market and settle_fancy_market) to calculate and persist per-agent P&L at market settlement time. The core technical challenge is accumulating per-user net_pnl and commission during the existing user loop, then aggregating by agent (via parent_id) in a new post-loop section. A new `settlement_results` table stores these snapshots as an append-only audit trail.

The implementation is well-constrained: both RPCs already select `parent_id` in their user loop queries, per-user `v_net_pnl` and `v_commission` are already computed, and `partnership_share` exists on `betting_users`. The work is purely additive -- extending existing RPCs with a new section and creating one new table. No balance mutations occur for agents (P&L is recorded, not settled to agent balance).

**Primary recommendation:** Use PL/pgSQL temporary storage (hstore or jsonb accumulator variables) within each RPC to accumulate per-agent totals during the user loop, then insert into settlement_results in a single post-loop section. This avoids a second query pass over orders.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Agent P&L per market = partnership_share% x (sum of all client net P&L for that market). If clients net lost 1000 coins, agent's share of P&L = partnership_share% x 1000 (positive = agent earns).
- **D-02:** Agent commission cost per market = partnership_share% x (sum of all commission paid to their clients for that market). Agent bears their share of the commission incentive.
- **D-03:** Agent net P&L per market = D-01 minus D-02. Agent earns from client losses but pays their share of commission given back to clients.
- **D-04:** Agent P&L can go negative -- no floor at zero. If clients net win, agent owes upward (APNL-04).
- **D-05:** P&L is calculated per-market at settlement time, NOT retroactively. Rate changes after settlement don't affect past P&L (APNL-05).
- **D-06:** New `settlement_results` table stores per-agent-per-market P&L snapshots. Schema should include: event_id, agent_id, total_client_pnl, total_commission_paid, agent_pnl_share, agent_commission_share, agent_net_pnl, partnership_share_at_settlement, settled_at.
- **D-07:** settlement_results is INSERT-only (append-only audit table). Never updated after creation.
- **D-08:** settlement_results is populated inside the settle_match_market and settle_fancy_market RPCs (extend existing RPCs, don't create new ones).
- **D-09:** Extend settle_match_market RPC to calculate and insert agent P&L after the user settlement loop.
- **D-10:** Extend settle_fancy_market RPC identically.
- **D-11:** The agent P&L calculation loop runs AFTER the user settlement loop (Section 4 of current RPCs). It's a new Section 4b that reads the results already computed in Section 4.
- **D-12:** RPC return JSONB should be extended to include agent_results: [{agent_id, net_pnl, commission_cost}] for downstream display.
- **D-13:** Clients directly under admin (parent_id IS NULL or parent is admin) have no agent P&L -- admin absorbs 100% of their P&L and commission cost directly.
- **D-14:** Only clients with a parent_id pointing to an AGENT role user generate agent P&L entries.
- **D-15:** Agent P&L uses same FLOOR rounding as commission -- round in favor of admin/platform (carried from Phase 2 D-10).

### Claude's Discretion
- settlement_results table exact column types and constraints
- Whether to add indexes on settlement_results (event_id, agent_id)
- How to handle the edge case of agent with 0% partnership_share (skip or insert with zeros)
- Whether agent_results array in RPC return is flat or grouped

### Deferred Ideas (OUT OF SCOPE)
- Agent P&L views/dashboard -- Phase 6
- Agent self-service settlement requests -- v2 (APNL-V2-01)
- Historical P&L trending -- v2 (APNL-V2-02)
- Sub-agent hierarchy -- v2 (APNL-V2-03)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| APNL-01 | Agent P&L = partnership_share% of client net P&L per settled market | Accumulator pattern in user loop collects per-agent client_pnl sum; partnership_share read from betting_users |
| APNL-02 | Agent commission cost = partnership_share% of total commission paid to clients per market | Same accumulator tracks per-agent commission sum; partnership_share applied in agent loop |
| APNL-03 | Agent net P&L per market = agent share of client P&L minus agent share of commission cost | Computed as (client_pnl_sum * share/100) - (commission_sum * share/100) in agent loop |
| APNL-04 | Agent can go negative -- no floor at zero (owes upward if clients net win) | No GREATEST(0,...) clamp on agent_net_pnl; NUMERIC type supports negative values |
| APNL-05 | Agent P&L calculated and persisted at market settlement time (snapshot, not retroactive) | partnership_share_at_settlement column captures the rate at insert time |
| APNL-06 | Settlement results stored in settlement_results table for audit/reporting | New table with INSERT-only policy; populated inside both RPCs |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| PL/pgSQL | PostgreSQL 15+ (Supabase) | RPC implementation language | Already used by settle_match_market and settle_fancy_market |
| JSONB | PostgreSQL native | Accumulator for per-agent totals during user loop | Avoids temp tables, works within single function scope |
| NUMERIC(15,2) | PostgreSQL native | Financial precision for P&L amounts | Matches existing credit_transactions.amount and betting_users.balance types |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| FLOOR() | PostgreSQL native | Rounding in favor of admin | Required by D-15 for agent P&L share calculations |
| jsonb_build_object / jsonb_agg | PostgreSQL native | Building agent_results array in RPC return | D-12 requires agent_results in return JSONB |

No external dependencies. This phase is entirely PostgreSQL/PL/pgSQL.

## Architecture Patterns

### Recommended Approach: JSONB Accumulator

Instead of making a second pass over orders after the user loop, accumulate per-agent totals in a JSONB variable during the existing user loop. Then iterate the accumulated JSONB to compute agent shares and insert into settlement_results.

```
settle_match_market (extended):
  Section 1: Validate and lock event           (existing)
  Section 2: Determine if favored team won     (existing)
  Section 3: Mark event settled                (existing)
  Section 4: Process each user (settlement)    (existing -- add accumulation)
  Section 4b: Process agent P&L               (NEW)
  Section 5: Build and return result summary   (existing -- extend return)

settle_fancy_market (extended):
  Section 1: Validate and lock event           (existing)
  Section 2: Mark event settled                (existing)
  Section 3: Process each user (settlement)    (existing -- add accumulation)
  Section 3b: Process agent P&L               (NEW)
  Section 4: Build and return result summary   (existing -- extend return)
```

### Pattern 1: Per-Agent Accumulation During User Loop

**What:** During the existing user loop, after computing v_net_pnl and v_commission for each user, check if the user's parent_id points to an AGENT. If yes, accumulate into a JSONB object keyed by agent_id.

**When to use:** Both RPCs use this same pattern.

**Example (Match RPC context):**
```sql
-- New variables at top of function
v_agent_accum   JSONB := '{}'::JSONB;  -- {agent_id: {pnl: N, comm: N}}
v_agent_key     TEXT;
v_agent_rec     RECORD;
v_agent_pnl     NUMERIC;
v_agent_comm    NUMERIC;
v_agent_net     NUMERIC;
v_agent_share   NUMERIC;
v_agent_results JSONB := '[]'::JSONB;

-- Inside user loop, after computing v_net_pnl and v_commission:
IF v_user.parent_id IS NOT NULL THEN
  -- Check if parent is an AGENT (not admin)
  SELECT role INTO v_parent_role
    FROM public.betting_users
   WHERE id = v_user.parent_id;

  IF v_parent_role = 'AGENT' THEN
    v_agent_key := v_user.parent_id::TEXT;
    IF v_agent_accum ? v_agent_key THEN
      v_agent_accum := jsonb_set(
        v_agent_accum,
        ARRAY[v_agent_key, 'pnl'],
        to_jsonb((v_agent_accum->v_agent_key->>'pnl')::NUMERIC + v_net_pnl)
      );
      v_agent_accum := jsonb_set(
        v_agent_accum,
        ARRAY[v_agent_key, 'comm'],
        to_jsonb((v_agent_accum->v_agent_key->>'comm')::NUMERIC + v_commission)
      );
    ELSE
      v_agent_accum := jsonb_set(
        v_agent_accum,
        ARRAY[v_agent_key],
        jsonb_build_object('pnl', v_net_pnl, 'comm', v_commission)
      );
    END IF;
  END IF;
END IF;
```

### Pattern 2: Agent P&L Computation (New Section)

**What:** After the user loop, iterate the accumulated JSONB, look up each agent's partnership_share, compute shares using FLOOR rounding, insert into settlement_results.

**Example:**
```sql
-- Section 4b: Agent P&L (after user loop ends)
FOR v_agent_rec IN
  SELECT key AS agent_id,
         (value->>'pnl')::NUMERIC AS total_client_pnl,
         (value->>'comm')::NUMERIC AS total_commission
    FROM jsonb_each(v_agent_accum)
LOOP
  SELECT partnership_share INTO v_agent_share
    FROM public.betting_users
   WHERE id = v_agent_rec.agent_id::UUID;

  v_agent_share := COALESCE(v_agent_share, 0);

  -- D-15: FLOOR rounding, favor admin
  -- Agent earns share of client losses (positive pnl = clients lost)
  -- Note: total_client_pnl is from client perspective (negative = client lost)
  -- Agent P&L sign: if clients lost (pnl < 0), agent earns (positive for agent)
  -- So agent_pnl_share = -(client_pnl) * share / 100, then FLOOR
  -- Actually: D-01 says "partnership_share% x sum of client net P&L"
  -- If clients net lost 1000, client_pnl = -1000
  -- Agent share = share% * (-(-1000)) = share% * 1000? No.
  -- Re-read D-01: "If clients net lost 1000 coins, agent's share of P&L = partnership_share% x 1000 (positive = agent earns)"
  -- So the formula negates client P&L: agent_pnl_share = share% * ABS(client_loss)
  -- But D-04 says agent can go negative if clients net win
  -- So: agent_pnl_share = share% * (-total_client_pnl) = -share% * total_client_pnl
  -- When clients lose (pnl < 0): agent earns (positive)
  -- When clients win (pnl > 0): agent owes (negative)

  v_agent_pnl := FLOOR((-v_agent_rec.total_client_pnl) * v_agent_share / 100.0 * 100.0) / 100.0;
  v_agent_comm := FLOOR(v_agent_rec.total_commission * v_agent_share / 100.0 * 100.0) / 100.0;
  v_agent_net := v_agent_pnl - v_agent_comm;

  INSERT INTO public.settlement_results (
    event_id, agent_id, total_client_pnl, total_commission_paid,
    agent_pnl_share, agent_commission_share, agent_net_pnl,
    partnership_share_at_settlement, settled_at
  ) VALUES (
    p_event_id, v_agent_rec.agent_id::UUID, v_agent_rec.total_client_pnl,
    v_agent_rec.total_commission, v_agent_pnl, v_agent_comm, v_agent_net,
    v_agent_share, NOW()
  );

  -- Build return array
  v_agent_results := v_agent_results || jsonb_build_object(
    'agent_id', v_agent_rec.agent_id,
    'net_pnl', v_agent_net,
    'commission_cost', v_agent_comm
  );
END LOOP;
```

### Pattern 3: settlement_results Table Design

**What:** Append-only audit table storing per-agent-per-market settlement snapshots.

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS public.settlement_results (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id                    UUID NOT NULL REFERENCES public.events(id),
    agent_id                    UUID NOT NULL REFERENCES public.betting_users(id),
    total_client_pnl            NUMERIC(15,2) NOT NULL,  -- sum of client net P&L (client perspective)
    total_commission_paid       NUMERIC(15,2) NOT NULL,  -- sum of commission credited to clients
    agent_pnl_share             NUMERIC(15,2) NOT NULL,  -- partnership_share% of negated client P&L
    agent_commission_share      NUMERIC(15,2) NOT NULL,  -- partnership_share% of commission paid
    agent_net_pnl               NUMERIC(15,2) NOT NULL,  -- agent_pnl_share - agent_commission_share
    partnership_share_at_settlement DECIMAL(5,2) NOT NULL, -- snapshot of share rate
    settled_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc', now()),
    created_at                  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Indexes for Phase 6 queries
CREATE INDEX IF NOT EXISTS idx_settlement_results_event_id
  ON public.settlement_results(event_id);
CREATE INDEX IF NOT EXISTS idx_settlement_results_agent_id
  ON public.settlement_results(agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_results_event_agent
  ON public.settlement_results(event_id, agent_id);
```

### Anti-Patterns to Avoid
- **Computing agent P&L on-the-fly from orders:** Violates D-05 (snapshot requirement). If rates change after settlement, stored values must remain frozen.
- **Updating settlement_results rows:** Violates D-07 (INSERT-only). If a void/reversal is needed later (v2), it would be a new row, not an UPDATE.
- **Using temp tables for accumulation:** Unnecessary complexity. JSONB accumulator within the function is simpler and runs in the same transaction.
- **Querying parent's role in every user iteration for AGENT check:** The parent_id lookup already happens for commission capping. Combine the role check with the existing parent lookup to avoid redundant queries.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-agent accumulation | Nested loops or second query pass | JSONB accumulator in single pass | Single pass is O(n) vs O(n*m); JSONB handles variable agent count |
| Financial rounding | Custom rounding logic | FLOOR(x * 100.0) / 100.0 | Established pattern from Phase 2, proven correct |
| Agent role check | Inline string comparison | Single SELECT with role filter | Parent might be ADMIN, not AGENT -- must verify |
| Unique constraint protection | Application-level check | UNIQUE INDEX on (event_id, agent_id) | Database enforces idempotency -- prevents double-settlement bugs |

## Common Pitfalls

### Pitfall 1: Agent P&L Sign Convention
**What goes wrong:** Confusing client P&L sign with agent P&L sign. Client P&L is from client perspective (negative = lost). Agent earns when clients lose, so agent P&L is the NEGATION of client P&L sum.
**Why it happens:** D-01 says "partnership_share% x (sum of client net P&L)" but the example clarifies "clients net lost 1000 coins, agent's share = partnership_share% x 1000 (positive)." This means agent_pnl_share = -1 * total_client_pnl * share / 100.
**How to avoid:** Always negate total_client_pnl before applying share percentage. Write a comment explaining the sign convention.
**Warning signs:** Agent P&L is always negative when clients lose (should be positive).

### Pitfall 2: FLOOR Rounding on Negative Values
**What goes wrong:** FLOOR(-1.234) = -2, not -1.23. The FLOOR function rounds toward negative infinity, which for negative agent P&L (clients won) means the agent owes MORE -- this actually favors the admin, which is correct per D-15. But the multiplication pattern `FLOOR(x * 100) / 100` must be applied carefully.
**Why it happens:** FLOOR behaves differently for negative numbers than for positive.
**How to avoid:** The FLOOR(x * 100.0) / 100.0 pattern works correctly for both positive and negative values when the goal is "round in favor of admin." For agent_pnl_share (agent earns): FLOOR gives less to agent. For agent_commission_share (agent pays): FLOOR gives less cost to agent but this is offset by the net calculation. Apply FLOOR to the final net_pnl if needed, or apply to components consistently.
**Warning signs:** Off-by-one-cent errors in edge cases with negative agent P&L.

### Pitfall 3: Fancy Net P&L Calculation
**What goes wrong:** The fancy RPC does not compute a single `v_net_pnl` variable like the match RPC. It computes `v_total_payout_user` (winnings) and `v_total_volume` (total staked). Client net P&L for fancy = v_total_payout_user - v_total_volume.
**Why it happens:** Different settlement models -- match uses exposure model (fw/fl/net_pnl), fancy uses volume model (payout - cost).
**How to avoid:** Explicitly compute `v_fancy_net_pnl := v_total_payout_user - v_total_volume` inside the fancy user loop before accumulating into the agent accumulator.
**Warning signs:** Agent P&L from fancy markets is always zero or always positive (missing the subtraction).

### Pitfall 4: Admin-Parented Clients
**What goes wrong:** Including clients whose parent_id points to the ADMIN user in agent P&L calculations.
**Why it happens:** The admin user has a parent_id that IS NOT NULL but their role is ADMIN, not AGENT.
**How to avoid:** Per D-13/D-14, check the ROLE of the parent. Only accumulate for clients whose parent is role='AGENT'. The commission cap logic already fetches the parent row -- extend that query to also fetch role.
**Warning signs:** An agent P&L entry appears for the admin user.

### Pitfall 5: Parent Role Lookup Redundancy
**What goes wrong:** Making a separate query to check parent role when the parent is already queried for commission rate capping.
**Why it happens:** The existing code does `SELECT match_commission INTO v_parent_rate FROM betting_users WHERE id = v_user.parent_id` -- it only fetches one column.
**How to avoid:** Extend the existing parent lookup to also fetch `role` and `partnership_share` in a single query: `SELECT match_commission, role, partnership_share INTO v_parent_rate, v_parent_role, v_parent_share FROM ...`. This eliminates a redundant round-trip.
**Warning signs:** N+1 query pattern inside the user loop.

### Pitfall 6: Zero Partnership Share Agents
**What goes wrong:** Inserting settlement_results rows with all-zero values for agents with 0% partnership_share, cluttering the audit table.
**Why it happens:** Agent exists with clients but has 0% share (maybe a new/unactivated agent).
**How to avoid:** Skip insertion when partnership_share = 0. The agent has no economic stake, so no P&L entry is meaningful. If an entry IS inserted, it should show zeros -- but skipping is cleaner. Recommendation: skip and document the decision in SQL comments.
**Warning signs:** settlement_results has rows with agent_net_pnl = 0 for agents with 0% share.

## Code Examples

### Match RPC: Extended User Loop Query
```sql
-- Current query (Section 4):
SELECT DISTINCT o.user_id, bu.match_commission, bu.parent_id
  FROM public.orders o
  JOIN public.betting_users bu ON bu.id = o.user_id
 WHERE o.outcome_id IN (SELECT id FROM public.outcomes WHERE event_id = p_event_id)
   AND o.status = 'OPEN'
 GROUP BY o.user_id, bu.match_commission, bu.parent_id

-- No change needed -- parent_id is already selected.
-- The parent role/share lookup happens inside the loop body.
```

### Match RPC: Extended Parent Lookup (Combine Commission Cap + Agent Info)
```sql
-- Current (commission cap only):
IF v_user.parent_id IS NOT NULL THEN
  SELECT match_commission INTO v_parent_rate
    FROM public.betting_users
   WHERE id = v_user.parent_id;
END IF;

-- Extended (commission cap + agent role + partnership_share):
IF v_user.parent_id IS NOT NULL THEN
  SELECT match_commission, role, partnership_share
    INTO v_parent_rate, v_parent_role, v_parent_share
    FROM public.betting_users
   WHERE id = v_user.parent_id;
END IF;
```

### FLOOR Rounding Pattern (Consistent with Phase 2)
```sql
-- FLOOR(amount * 100) / 100 truncates to 2 decimal places
-- For positive values: rounds down (agent gets less)
-- For negative values: rounds toward -infinity (agent owes more)
-- Both favor admin/platform per D-15

v_agent_pnl := FLOOR((-v_total_client_pnl) * v_share / 100.0 * 100.0) / 100.0;
v_agent_comm := FLOOR(v_total_commission * v_share / 100.0 * 100.0) / 100.0;
```

### settlement_results RLS Policy
```sql
-- Match existing project pattern: authenticated users can read all
ALTER TABLE public.settlement_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read/write settlement_results"
  ON public.settlement_results
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
```

### Extended RPC Return (D-12)
```sql
-- Add agent_results to the return JSONB
v_result := jsonb_build_object(
  'event_id', p_event_id,
  'winning_outcome_id', p_winning_outcome_id,
  'winning_title', v_winning_title,
  'users_settled', v_users_settled,
  'total_payout', v_total_payout,
  'total_commission', v_total_commission,
  'agent_results', v_agent_results  -- NEW: array of {agent_id, net_pnl, commission_cost}
);
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual SQL verification (no automated test framework -- per REQUIREMENTS.md Out of Scope) |
| Config file | none |
| Quick run command | `psql` or Supabase SQL Editor -- run settlement RPC with test data |
| Full suite command | Manual: create test agents/clients, place bets, settle, verify settlement_results |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| APNL-01 | Agent P&L = share% of client net P&L | manual | Settle match market, query settlement_results, verify math | N/A |
| APNL-02 | Agent commission cost = share% of commission paid | manual | Settle market, verify agent_commission_share column | N/A |
| APNL-03 | Net P&L = pnl_share - commission_share | manual | Verify agent_net_pnl = agent_pnl_share - agent_commission_share | N/A |
| APNL-04 | Agent can go negative | manual | Create scenario where clients net win, verify negative agent_net_pnl | N/A |
| APNL-05 | P&L persisted at settlement time | manual | Change partnership_share after settlement, verify settlement_results unchanged | N/A |
| APNL-06 | Results in settlement_results table | manual | Query settlement_results after settlement, verify rows exist | N/A |

### Sampling Rate
- **Per task commit:** Run settle_match_market with test data, query settlement_results
- **Per wave merge:** Settle both match and fancy markets, verify both produce correct settlement_results
- **Phase gate:** Verify all 6 requirements manually with at least 2 agents, 3+ clients each

### Wave 0 Gaps
- [ ] Test data: need seed data with agents (with partnership_share > 0) having clients with bets
- [ ] Verification query: `SELECT * FROM settlement_results WHERE event_id = '[test_id]'` to check results

## Discretion Recommendations

### Column Types and Constraints (Claude's Discretion)
**Recommendation:** Use NUMERIC(15,2) for all monetary columns (matches existing credit_transactions pattern). Use DECIMAL(5,2) for partnership_share_at_settlement (matches betting_users.partnership_share). Add NOT NULL on all columns since all values are computed at insert time. Add UNIQUE constraint on (event_id, agent_id) to prevent duplicate entries from double-settlement.

### Indexes (Claude's Discretion)
**Recommendation:** YES, add indexes. Phase 6 will query settlement_results by event_id (per-market detail view) and by agent_id (agent summary view). Adding indexes now avoids a migration later. Cost is negligible on an append-only table.

### Zero Partnership Share Agents (Claude's Discretion)
**Recommendation:** SKIP agents with 0% partnership_share. Rationale: (1) all computed values would be zero, providing no information; (2) reduces noise in Phase 6 views; (3) if business needs change, a future phase can easily remove the skip. Add a SQL comment documenting this decision.

### Agent Results Array Format (Claude's Discretion)
**Recommendation:** Flat array of objects: `[{agent_id, login_id, net_pnl, commission_cost, pnl_share}]`. Include login_id for display convenience in toast/log messages. Flat is simpler and matches how the admin UI would consume it.

## Open Questions

1. **Fancy net P&L variable**
   - What we know: Match RPC has explicit `v_net_pnl`. Fancy RPC does not -- it tracks `v_total_payout_user` and `v_total_volume` separately.
   - What's unclear: Whether to add a `v_fancy_net_pnl` variable or compute inline.
   - Recommendation: Add explicit variable `v_fancy_net_pnl := v_total_payout_user - v_total_volume` for clarity. Same sign convention as match (negative = client lost).

2. **Parent lookup query change**
   - What we know: The existing parent lookup in both RPCs only fetches the commission rate column.
   - What's unclear: Whether extending the SELECT to add role + partnership_share could break anything.
   - Recommendation: Safe to extend -- adding columns to a SELECT INTO with additional target variables is purely additive. No existing behavior changes.

## Sources

### Primary (HIGH confidence)
- `sql/003_settle_match_market_rpc.sql` -- current match settlement RPC (228 lines)
- `sql/004_settle_fancy_market_rpc.sql` -- current fancy settlement RPC (221 lines)
- `setup_complete.sql` -- full schema with betting_users, credit_transactions, orders tables
- `admin_schema_update.sql` -- partnership_share field definition DECIMAL(5,2)
- `admin.html` lines 2829-2896 -- JS consumption of RPC return values
- `.planning/phases/05-agent-p-l-core/05-CONTEXT.md` -- all 15 locked decisions

### Secondary (MEDIUM confidence)
- `.planning/phases/02-match-commission/02-CONTEXT.md` -- commission model, cost split (D-20/D-21)
- `.planning/PROJECT.md` -- agent hierarchy, partnership share model
- `migration_v7.sql` -- orders table extensions (bet_side, status, line_at_bet)
- `migration_v8.sql` -- events table extensions (lagai_rate, rate_team)

## Project Constraints (from CLAUDE.md)

- **Vanilla JS only** -- no frameworks, no build tools, no TypeScript
- **Supabase only** -- no additional backend services; all logic in PL/pgSQL RPCs
- **Static hosting** -- no server-side rendering
- **SECURITY INVOKER** for all RPCs (Supabase default)
- **sanitize()** on all user-supplied content before innerHTML
- **FLOOR rounding** for financial calculations (favor admin)
- **Established SQL migration convention:** numbered files in sql/ directory (001_, 002_, etc.)
- **RPC return format:** JSONB object consumed by admin.html via `sb.rpc()` call
- **Append-only audit patterns** for financial records (credit_transactions precedent)
- **Automated tests explicitly out of scope** -- manual verification only

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - purely PostgreSQL PL/pgSQL, same technology as existing RPCs
- Architecture: HIGH - extending proven RPC pattern with a well-defined accumulator approach; both RPCs already have the data needed
- Pitfalls: HIGH - sign convention and FLOOR rounding on negatives are the main risks, both well-understood from analysis

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable -- no external dependencies, all PostgreSQL-native)
