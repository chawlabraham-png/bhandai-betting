# Phase 6: Agent P&L Views - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace estimated P&L in agent dashboard with actual settlement_results data. Add per-market expandable detail, per-client detail, live exposure tracking, and share-adjusted admin settlement cards.

</domain>

<decisions>
## Implementation Decisions

### Agent P&L Summary (APNL-07)
- **D-01:** Replace existing renderPnL() estimates with actual data from settlement_results table. Query settlement_results WHERE agent_id = currentUser.id.
- **D-02:** Summary stats: total client volume (from orders), total commission given (sum of agent_commission_share from settlement_results), agent share of P&L (sum of agent_pnl_share), net position (sum of agent_net_pnl).
- **D-03:** Keep existing HTML structure (pnlVolume, pnlComm, pnlNetReceived, pnlPosition elements) — just change the data source from estimates to actuals.

### Per-Market Detail (APNL-08)
- **D-04:** Settled markets table should show actual agent net P&L per market from settlement_results. Expandable row showing: event title, winner/result, client wins, client losses, commission paid, agent net.
- **D-05:** Data comes from settlement_results joined with events — one row per settled market for this agent.

### Per-Client Detail (APNL-09)
- **D-06:** Per-client table should show each client's total P&L across all settled markets, total commission received, and agent's net exposure per client.
- **D-07:** Data requires aggregating settlement-level data per client. Since settlement_results is per-agent-per-market (not per-client), the per-client view needs to use orders + credit_transactions data, grouped by client, similar to current approach but with actual settled amounts.

### Live Exposure (APNL-10)
- **D-08:** During open markets, show estimated exposure using the same fw/fl model from settlement — but computed client-side from open orders. This is an estimate (not settlement_results).
- **D-09:** Use existing realtime subscriptions for orders to update live exposure when orders change.
- **D-10:** Clearly label live P&L as "Estimated" vs settled P&L as "Settled" to avoid confusion.

### Admin Settlement Cards (APNL-11)
- **D-11:** Admin agent settlement cards in admin.html should show share-adjusted P&L from settlement_results instead of raw chip flow.
- **D-12:** Query settlement_results grouped by agent_id, show: total agent_pnl_share, total agent_commission_share, total agent_net_pnl.
- **D-13:** Keep existing settlement card layout (sc-agent, sc-name, sc-row pattern) — add new rows for share-adjusted figures.

### Claude's Discretion
- How to load settlement_results in agent.html (separate Supabase query or piggyback on existing data load)
- Expandable row implementation for per-market detail
- Color-coding for positive/negative P&L values
- Whether to show both estimated and settled P&L or just settled

</decisions>

<canonical_refs>
## Canonical References

### Agent Code
- `agent.html` lines 439-477 — P&L tab HTML structure
- `agent.html` lines 1186-1251 — Current renderPnL() function to replace
- `agent.html` lines 860-870 — Data loading (add settlement_results query)
- `agent.html` lines 1283+ — Settlement tab for reference

### Admin Code
- `admin.html` lines 210-218 — Settlement card CSS
- `admin.html` lines 527-555 — Agent Settlement tab HTML
- `admin.html` lines 1640-1700 — Agent settlement card rendering

### Data Source
- `sql/005_settlement_results_table.sql` — settlement_results schema (Phase 5)
- `.planning/phases/05-agent-p-l-core/05-CONTEXT.md` — Agent P&L model decisions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- P&L tab HTML already exists with stat cards and two tables (pnlClientTable, pnlMarketsTable)
- renderPnL() function exists — needs data source replacement, not full rewrite
- settlement_results table deployed in Phase 5 with all needed columns
- Agent data loading already fetches orders, transactions, events — add settlement_results query
- Admin settlement card CSS and rendering pattern exists

### Established Patterns
- Agent tab rendering: switchTab() → render function (renderPnL, renderLedger, etc.)
- Supabase query pattern: sb.from('table').select('*').eq('field', value)
- Stat cards: `.stat-value` elements with IDs for dynamic content
- Table rendering: tbody.innerHTML = items.map(item => `<tr>...</tr>`).join('')

### Integration Points
- agent.html refreshData() — add settlement_results query
- agent.html renderPnL() — replace estimates with actuals
- admin.html renderAgentSettlement() — add share-adjusted P&L from settlement_results

</code_context>

<specifics>
## Specific Ideas

- Existing pnlVolume/pnlComm/pnlNetReceived/pnlPosition elements map well to the new data
- Per-market table can replace current "settled markets" table which only shows volume and estimated commission
- Live exposure should be clearly separated from settled P&L
- Purple color (#a78bfa) for partnership share figures, consistent with commission

</specifics>

<deferred>
## Deferred Ideas

- Historical P&L trending charts — v2 (APNL-V2-02)
- Agent self-service settlement requests — v2 (APNL-V2-01)
- Sub-agent P&L cascade — v2 (APNL-V2-03)

</deferred>

---

*Phase: 06-agent-p-l-views*
*Context gathered: 2026-03-25*
