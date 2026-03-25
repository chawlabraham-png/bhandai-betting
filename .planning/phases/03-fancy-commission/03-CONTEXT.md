# Phase 3: Fancy Commission - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Fancy bet settlement correctly applies commission as a percentage of total betting volume per market per client, regardless of win/loss. Uses `fancy_commission` rate from betting_users. Same atomic RPC pattern as Phase 2 match commission.

</domain>

<decisions>
## Implementation Decisions

### Commission Model (Fancy — differs from Match)
- **D-01:** Fancy commission IS a coin credit to clients, same as match commission (carried from Phase 2 D-01).
- **D-02:** Fancy commission = fancy_commission% x total_volume. Total volume = sum of `total_cost` for ALL orders by that user on that market. Applies regardless of win or loss (COMM-06, COMM-10).
- **D-03:** Commission is calculated per-market settlement, NOT per individual bet. All orders for a user on a market are summed to get total volume, then commission applied once (consistent with match approach).
- **D-04:** Commission is recorded as a COMMISSION transaction in credit_transactions AND credits the client's balance (carried from Phase 2 D-04). Notes should indicate "Fancy commission" and include volume amount.
- **D-05:** Unlike match commission, fancy commission is paid to ALL clients with orders — winners AND losers get commission on their volume.
- **D-06:** If client's fancy_commission is 0% → no commission paid to that client (same gating as Phase 2 D-06-NEW).

### Rate Handling
- **D-07:** Fancy commission rate read at settlement time from betting_users.fancy_commission (COMM-07).
- **D-08:** Client's effective fancy rate capped at parent agent's fancy_commission rate at settlement (COMM-08, carried from Phase 2 D-12 pattern).

### Rounding
- **D-09:** FLOOR rounding for fancy commission, same as match — less to client, favors admin (carried from Phase 2 D-10).

### Settlement Approach
- **D-10:** Fancy settlement should execute as a single PostgreSQL RPC (`settle_fancy_market`) for atomicity (COMM-09, matches Phase 2 D-13 pattern).
- **D-11:** New RPC, NOT an extension of settle_match_market. Separate function with same structural pattern — keeps match/fancy formulas cleanly separated (per roadmap: "Split match and fancy commission into separate phases to prevent formula confusion").
- **D-12:** Fancy settlement RPC handles: event status update, outcome resolution (YES/NO by result_value vs line), per-order settlement, per-user commission calculation and crediting, all atomically.

### Fancy-Specific Settlement Logic
- **D-13:** Winning determination: YES wins if result_value >= line_at_bet; NO wins if result_value < line_at_bet. This is per-ORDER (each order has its own line_at_bet snapshot).
- **D-14:** Winner payout: stake x back_price (stored as price_per_share on order). Losers get 0 (their stake was already locked as exposure).
- **D-15:** Commission is independent of winning — a client who bet 1000 volume gets commission on 1000 whether they won or lost.

### Claude's Discretion
- PL/pgSQL function structure and error handling (follow settle_match_market pattern)
- How to handle edge case: client with orders on same fancy market with different line_at_bet values (treat each order independently for win/loss, but sum all total_cost for volume)
- Whether to return per-user commission breakdown in RPC result or just totals

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Settlement Code
- `admin.html` lines 2863-2919 — Current settleFancyMarket() function (client-side loop to replace)
- `sql/003_settle_match_market_rpc.sql` — settle_match_market RPC pattern to mirror for fancy
- `sql/002_adjust_balance_rpc.sql` — Atomic balance adjustment pattern

### Schema
- `admin_schema_update.sql` — credit_transactions table structure, betting_users fields
- `schema.sql` — Base schema with orders, events, outcomes tables
- `update_commissions.sql` — fancy_commission column definition (DECIMAL(5,2) DEFAULT 0.00)

### Prior Phase Context
- `.planning/phases/02-match-commission/02-CONTEXT.md` — Match commission decisions (many carry forward)
- `.planning/phases/02-match-commission/02-01-SUMMARY.md` — RPC implementation approach summary
- `.planning/phases/02-match-commission/02-02-SUMMARY.md` — Admin UI integration approach summary

### Research
- `.planning/research/SUMMARY.md` — Commission formulas, pitfalls
- `.planning/research/PITFALLS.md` — Pitfall #3 (match on volume not losses) — fancy DOES use volume, so this is correct for fancy
- `.planning/research/ARCHITECTURE.md` — Component boundaries

### Project Context
- `.planning/PROJECT.md` — Indian bookmaking model, agent hierarchy

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `settle_match_market` RPC — structural template for settle_fancy_market (same commission crediting pattern)
- `adjust_balance` RPC — available for individual balance mutations (but RPC should handle internally like match did)
- `fancy_commission` field on betting_users — already exists, DECIMAL(5,2) DEFAULT 0.00
- Agent UI enforces fancy_commission rate hierarchy on create/edit (agent.html lines 1472-1617)
- COMMISSION transaction type — already recognized in reconciliation, ledger filter, activity feed (Phase 2 Wave 2)

### Established Patterns
- Settlement RPC: SECURITY INVOKER, FOR UPDATE lock on event, per-user loop, JSONB return summary
- Commission gating: check rate > 0 before calculating (Phase 2 Pitfall #6 — independent of settle_amt)
- FLOOR rounding: `FLOOR(amount * rate / 100.0 * 100.0) / 100.0`
- Rate capping: `IF v_comm_rate > v_parent_rate THEN v_comm_rate := v_parent_rate`

### Integration Points
- settleFancyMarket() in admin.html — primary integration point (replace with RPC call, same as match)
- credit_transactions table — COMMISSION entries (already handled by Phase 2 UI updates)
- Reconciliation, ledger, activity feed — already handle COMMISSION type from Phase 2 Wave 2

</code_context>

<specifics>
## Specific Ideas

- Current fancy code has `const commission = 0; // TODO: apply user commission when client is built` — this is the exact line being replaced
- Fancy win payout formula: `grossPayout = stake * bp` where bp = price_per_share (back price ~1.90)
- Each order has its own `line_at_bet` — line value snapshotted at bet placement time, NOT the current live line
- Commission on volume means even if client bets both YES and NO on same market, they get commission on total volume of both sides

</specifics>

<deferred>
## Deferred Ideas

- Commission visibility in client/agent views — Phase 4
- Agent P&L calculation including fancy commission cost split — Phase 5
- Commission rate change audit trail — v2 scope (COMM-V2-02)
- Void market commission reversal — v2 scope (COMM-V2-01)

</deferred>

---

*Phase: 03-fancy-commission*
*Context gathered: 2026-03-25*
