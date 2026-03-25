# Phase 4: Commission Visibility - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Make COMMISSION transactions visible across all three user roles (admin, agent, client) with correct filtering, color-coding, and contextual information. Add commission preview to client bet slip.

</domain>

<decisions>
## Implementation Decisions

### Admin Visibility (COMM-11) — ALREADY DONE
- **D-01:** Admin master ledger already shows COMMISSION transactions (Phase 2 Wave 2):
  - COMMISSION in txTypeFilter dropdown
  - COMMISSION in isCredit array (green display)
  - COMMISSION in reconciliation formula (totalSettlements)
  - COMMISSION in activity feed (purple #a78bfa with coin icon)
- **D-02:** No additional admin work needed for COMM-11. Verify existing implementation satisfies the requirement.

### Client Visibility (COMM-12)
- **D-03:** Client history tab currently only shows orders (myOrders). COMMISSION entries live in credit_transactions. Need to add a "Commission" section or integrate commission entries into the history view.
- **D-04:** Show commission entries as a distinct card/row in client history, styled with purple accent (consistent with admin activity feed). Include: amount credited, market name (from notes), formula type (match/fancy — parseable from notes prefix).
- **D-05:** Add a "Commissions" filter option to client history tab filter row (alongside OPEN, SETTLED, CLOSED, MATCH, FANCY).
- **D-06:** Client sees commission amounts but NOT commission rate percentages (per Out of Scope: "Clients see amounts, not percentages — prevents negotiation pressure").

### Agent Visibility (COMM-13)
- **D-07:** Agent ledger (agent.html) currently filters by SETTLEMENT/DEPOSIT/WITHDRAWAL for isDeposit color. Add COMMISSION to the credit array so commission entries show as green/positive.
- **D-08:** Agent activity feed (agent.html line ~965) needs COMMISSION added to isDeposit array.
- **D-09:** Agent should see commission entries for their clients in the client-specific ledger view.

### Commission Audit Trail (COMM-14)
- **D-10:** ALREADY IMPLEMENTED in RPCs. Match RPC notes: `"Match commission: 2% on loss of 500.00 in IND vs AUS"`. Fancy RPC notes: `"Fancy commission: 3% on volume of 1000.00 in Virat Runs"`. Both contain market name, formula type (losses-only vs volume), and base amount.
- **D-11:** Phase 4 work: ensure these notes are displayed in all ledger views (admin already shows notes column; client and agent views need to display the notes field).

### Bet Slip Commission Preview (COMM-15)
- **D-12:** CSS class `.bs-comm-note` already exists in client.html (line 343-344) with placeholder styling.
- **D-13:** Show commission preview below the stake input in the bet slip. For match markets: "Commission: X% on losses". For fancy markets: "Commission: X% on volume". Only show if client's rate > 0 for that market type.
- **D-14:** Commission preview uses the client's rate from currentProfile (match_commission or fancy_commission). Do NOT show the actual rate number to client — show only the formula description: "You earn commission on losses" or "You earn commission on volume". The exact rate is hidden per D-06.
- **D-15:** Actually, revisiting D-14: the requirement COMM-15 says "X% on losses" which implies showing the rate. But the Out of Scope table says "Clients see amounts, not percentages". Resolution: show the formula type only, not the percentage. Display: "Commission applies on losses" (match) or "Commission applies on volume" (fancy). Only when rate > 0.

### Claude's Discretion
- How to fetch and display credit_transactions for client history (separate query or piggyback on existing load)
- Whether to use a sub-tab, filter button, or inline section for client commission entries
- Exact card/row layout for commission entries in client view
- How to parse match vs fancy from notes string (substring check on "Match commission" vs "Fancy commission")

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Admin (already done)
- `admin.html` lines 509-511 — txTypeFilter with COMMISSION option
- `admin.html` line 1538 — Activity feed COMMISSION color
- `admin.html` line 1805 — Reconciliation includes COMMISSION
- `admin.html` line 1883 — isCredit includes COMMISSION

### Client
- `client.html` lines 343-344 — `.bs-comm-note` CSS class (placeholder)
- `client.html` lines 466-477 — History tab HTML structure
- `client.html` lines 603-666 — History filter and tab logic
- `client.html` lines 1880-1910 — renderHistoryTab function
- `client.html` lines 1094-1156 — Bet slip open functions (bsState setup)

### Agent
- `agent.html` lines 860-870 — credit_transactions fetch
- `agent.html` lines 960-970 — Activity feed with isDeposit array
- `agent.html` lines 1039+ — renderLedger function

### RPCs (notes format)
- `sql/003_settle_match_market_rpc.sql` lines 197-203 — Match COMMISSION notes format
- `sql/004_settle_fancy_market_rpc.sql` lines 189-195 — Fancy COMMISSION notes format

### Prior Phase Context
- `.planning/phases/02-match-commission/02-CONTEXT.md` — Commission model decisions
- `.planning/phases/03-fancy-commission/03-CONTEXT.md` — Fancy commission decisions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- COMMISSION type already handled in admin: filter, color, reconciliation, isCredit (Phase 2 Wave 2)
- `.bs-comm-note` CSS class in client.html — ready for commission preview
- `currentProfile` in client.html — has match_commission and fancy_commission fields
- Agent credit_transactions fetch already loads all transactions for agent's clients

### Established Patterns
- Client history renders from myOrders with filter buttons (OPEN, SETTLED, CLOSED, MATCH, FANCY)
- Agent ledger uses isDeposit array for color-coding: `['DEPOSIT','SETTLEMENT','VOID_REFUND']`
- Agent activity feed uses same pattern
- Notes field displayed in admin ledger table already

### Integration Points
- client.html renderHistoryTab() — add commission entries
- client.html bet slip open functions — add commission preview
- agent.html renderLedger() — add COMMISSION to credit types
- agent.html activity feed — add COMMISSION to isDeposit

</code_context>

<specifics>
## Specific Ideas

- Admin COMM-11 is already satisfied from Phase 2 Wave 2 — just needs verification
- Commission notes are already rich (market name, formula, base amount) from the RPCs
- Client should NOT see commission rate percentage — only that commission applies
- Purple color (#a78bfa) established for COMMISSION in admin — use consistently across all views

</specifics>

<deferred>
## Deferred Ideas

- Commission rate change audit trail — v2 scope (COMM-V2-02)
- Multi-level commission waterfall visibility — v2 scope (COMM-V2-03)
- Agent P&L showing commission impact — Phase 5/6

</deferred>

---

*Phase: 04-commission-visibility*
*Context gathered: 2026-03-25*
