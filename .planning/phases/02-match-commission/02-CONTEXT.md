# Phase 2: Match Commission - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Match bet settlement correctly deducts commission as a percentage of client losses, with per-user rates and hierarchy enforcement. Commission IS coins credited to clients as an incentive — calculated per market, not per bet.

</domain>

<decisions>
## Implementation Decisions

### Commission Model (CORRECTED — final version)
- **D-01:** Commission IS a coin credit to clients. It is an incentive/rebate added to client balance AFTER match settles (not per bet).
- **D-02:** Commission = match_commission% × net_loss_amount. Only applies when client's net P&L is negative (losses only). Zero if client wins.
- **D-03:** Commission is calculated per-market settlement, NOT per individual bet. All orders for a user on a market are netted first, then commission applied to the net loss.
- **D-04:** Commission is recorded as a COMMISSION transaction in credit_transactions AND credits the client's balance.
- **D-05:** Clients who won on a match market receive zero commission (commission is on losses only).
- **D-06-NEW:** If client's match_commission is 0% → no commission is paid to that client. Only clients with commission rate > 0 receive the rebate.

### Commission Cost Split
- **D-20:** The cost of commission paid to a client is split between agent and admin based on partnership_share:
  - Agent pays: commission × (partnership_share / 100)
  - Admin pays: commission × (1 - partnership_share / 100)
- **D-21:** If agent's partnership_share is 0% → admin bears 100% of the commission cost.
- **D-22:** Some clients know about commission (negotiated rate > 0), some don't (rate = 0). This is by design — agents set rates per client.

### Accounting Hierarchy (CRITICAL — affects all fund flows)
- **D-06:** Strict hierarchy: Admin → Agent → Client. ALL transactions for a client under an agent flow through the agent.
- **D-07:** If admin adds coins directly to an agent's client, the agent's "owes admin" balance increases by that amount. There is NO direct admin↔client ledger entry.
- **D-08:** Exception: clients directly under admin (no agent parent) have direct admin↔client relationship.
- **D-09:** When admin or agent adds/withdraws coins from a client, the same action must reflect in the full P&L chain upward.

### Rounding
- **D-10:** All commission calculations and accounting round in favor of admin (the house). Round down on payouts, round up on deductions.

### Rate Handling
- **D-11:** Commission rate read at settlement time from betting_users.match_commission
- **D-12:** Client's effective rate capped at parent agent's rate at settlement (defensive check)

### Settlement Approach
- **D-13:** Match settlement should execute as a single PostgreSQL RPC for atomicity (success criterion #5)
- **D-14:** Hedged positions: commission applies to NET P&L per user per market (not per-order). If client has both LAGAI and KHAI and nets to zero loss, commission is zero.

### Claude's Discretion
- PL/pgSQL function structure and error handling
- How to store commission audit trail in notes field
- Whether to create a new settlement_results table now or defer to Phase 5

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Settlement Code
- `admin.html` lines 2820-2960 — Current settleMatchMarket() function (already uses adjust_balance RPC from Phase 1)
- `sql/002_adjust_balance_rpc.sql` — Atomic balance adjustment pattern to follow

### Schema
- `admin_schema_update.sql` — credit_transactions table structure, betting_users fields
- `schema.sql` — Base schema with orders, events, outcomes tables

### Research
- `.planning/research/SUMMARY.md` — Commission formulas, pitfalls, architecture recommendations
- `.planning/research/PITFALLS.md` — Pitfall #2 (commission into payout), #3 (match on volume not losses)
- `.planning/research/ARCHITECTURE.md` — Component boundaries for commission module

### Project Context
- `.planning/PROJECT.md` — Indian bookmaking model, commission as incentive, agent hierarchy

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `adjust_balance` RPC — atomic balance mutations, deployed in Phase 1
- Commission fields on betting_users — match_commission, fancy_commission already exist
- Commission rate hierarchy enforcement — already in UI (create/edit forms), needs settlement-time check

### Established Patterns
- Settlement loop: iterates users with orders, calculates per-user net P&L, updates balance, inserts credit_transaction
- Supabase RPC pattern: `sb.rpc('function_name', { params })` with error handling
- Credit transaction types: SETTLEMENT, DEPOSIT, WITHDRAWAL, ADMIN_MINT, VOID_REFUND — adding COMMISSION

### Integration Points
- settleMatchMarket() in admin.html — primary integration point
- credit_transactions table — new COMMISSION type entries
- Agent P&L calculation — downstream in Phase 5, but commission data must be available

</code_context>

<specifics>
## Specific Ideas

- Commission should be invisible to clients as a coin movement — it's an internal accounting factor
- Agent's net earnings from a client's loss = (loss × partnership_share%) - (commission × partnership_share%)
- When admin deposits coins to agent's client, agent owes admin that amount — strict hierarchy

</specifics>

<deferred>
## Deferred Ideas

- Full accounting hierarchy refactor (admin deposits flowing through agent) — this is broader than Phase 2, may need its own phase
- Agent P&L views showing commission impact — Phase 6
- Commission visibility in ledger views — Phase 4

</deferred>

---

*Phase: 02-match-commission*
*Context gathered: 2026-03-25*
