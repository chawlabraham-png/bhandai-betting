# Phase 5: Agent P&L Core - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Calculate and persist agent profit/loss at market settlement time. Agent P&L = partnership_share% of net client P&L per market, minus partnership_share% of commission paid to clients. Results stored in settlement_results table for reporting (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Agent P&L Formula
- **D-01:** Agent P&L per market = partnership_share% x (sum of all client net P&L for that market). If clients net lost 1000 coins, agent's share of P&L = partnership_share% x 1000 (positive = agent earns).
- **D-02:** Agent commission cost per market = partnership_share% x (sum of all commission paid to their clients for that market). Agent bears their share of the commission incentive.
- **D-03:** Agent net P&L per market = D-01 minus D-02. Agent earns from client losses but pays their share of commission given back to clients.
- **D-04:** Agent P&L can go negative — no floor at zero. If clients net win, agent owes upward (APNL-04).
- **D-05:** P&L is calculated per-market at settlement time, NOT retroactively. Rate changes after settlement don't affect past P&L (APNL-05).

### Settlement Results Table (APNL-06)
- **D-06:** New `settlement_results` table stores per-agent-per-market P&L snapshots. Schema should include: event_id, agent_id, total_client_pnl, total_commission_paid, agent_pnl_share, agent_commission_share, agent_net_pnl, partnership_share_at_settlement, settled_at.
- **D-07:** settlement_results is INSERT-only (append-only audit table). Never updated after creation.
- **D-08:** settlement_results is populated inside the settle_match_market and settle_fancy_market RPCs (extend existing RPCs, don't create new ones).

### Integration with Existing RPCs
- **D-09:** Extend settle_match_market RPC to calculate and insert agent P&L after the user settlement loop. For each agent with clients who had orders: sum their clients' net P&L and commission, apply partnership_share%, insert into settlement_results.
- **D-10:** Extend settle_fancy_market RPC identically.
- **D-11:** The agent P&L calculation loop runs AFTER the user settlement loop (Section 4 of current RPCs). It's a new Section 4b that reads the results already computed in Section 4.
- **D-12:** RPC return JSONB should be extended to include agent_results: [{agent_id, net_pnl, commission_cost}] for downstream display.

### Clients Without Agents
- **D-13:** Clients directly under admin (parent_id IS NULL or parent is admin) have no agent P&L — admin absorbs 100% of their P&L and commission cost directly.
- **D-14:** Only clients with a parent_id pointing to an AGENT role user generate agent P&L entries.

### Rounding
- **D-15:** Agent P&L uses same FLOOR rounding as commission — round in favor of admin/platform (carried from Phase 2 D-10).

### Claude's Discretion
- settlement_results table exact column types and constraints
- Whether to add indexes on settlement_results (event_id, agent_id)
- How to handle the edge case of agent with 0% partnership_share (skip or insert with zeros)
- Whether agent_results array in RPC return is flat or grouped

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### RPCs to Extend
- `sql/003_settle_match_market_rpc.sql` — Match settlement RPC (add agent P&L section after user loop)
- `sql/004_settle_fancy_market_rpc.sql` — Fancy settlement RPC (add agent P&L section after user loop)

### Schema
- `admin_schema_update.sql` — partnership_share field definition (DECIMAL(5,2) DEFAULT 0.00)
- `schema.sql` — Base schema for reference
- `setup_complete.sql` — Full schema with all fields

### Agent Code
- `admin.html` lines 950-951, 1043, 1655 — partnership_share display and edit
- `admin.html` lines 2341-2342 — partnership_share set on agent creation
- `agent.html` — Agent dashboard (downstream Phase 6 display, but useful for understanding data flow)

### Prior Phase Context
- `.planning/phases/02-match-commission/02-CONTEXT.md` — Commission model, cost split (D-20/D-21)
- `.planning/phases/03-fancy-commission/03-CONTEXT.md` — Fancy commission model
- `.planning/PROJECT.md` — Agent hierarchy, partnership share model

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `partnership_share` field on betting_users — already exists, DECIMAL(5,2) DEFAULT 0.00
- settle_match_market / settle_fancy_market RPCs — proven 5-section structure to extend
- Parent-child relationship: `parent_id` on betting_users links client to agent
- Commission already calculated per-user in RPCs — just need to aggregate per-agent

### Established Patterns
- RPC structure: validate → lock → update status → per-user loop → return JSONB
- SECURITY INVOKER for all RPCs
- FLOOR rounding for financial calculations
- credit_transactions for audit trail (though settlement_results is a new table pattern)

### Integration Points
- settle_match_market RPC — extend with agent P&L loop (Section 4b)
- settle_fancy_market RPC — extend identically
- settlement_results table — new table, queried by Phase 6 views
- RPC return shape — extend with agent_results array

</code_context>

<specifics>
## Specific Ideas

- Agent P&L aggregation: after processing all users in Section 4, loop through distinct agents (via parent_id) and sum their clients' net_pnl and commission
- No balance changes for agents in this phase — P&L is recorded but not settled to agent balance (that's a separate "agent cash settlement" which is manual/physical)
- settlement_results is the bridge between Phase 5 (calculation) and Phase 6 (display)

</specifics>

<deferred>
## Deferred Ideas

- Agent P&L views/dashboard — Phase 6
- Agent self-service settlement requests — v2 (APNL-V2-01)
- Historical P&L trending — v2 (APNL-V2-02)
- Sub-agent hierarchy — v2 (APNL-V2-03)

</deferred>

---

*Phase: 05-agent-p-l-core*
*Context gathered: 2026-03-25*
