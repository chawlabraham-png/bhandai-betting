# Feature Landscape

**Domain:** Betting exchange commission deduction and agent P&L hierarchy (Indian bookmaking model)
**Researched:** 2026-03-25
**Confidence:** HIGH (domain rules are well-defined in PROJECT.md; implementation patterns derived from codebase analysis and established Indian bookmaking conventions)

## Table Stakes

Features users expect. Missing = product feels incomplete or financially incorrect.

### Commission System

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Match commission on losses only | Standard Indian bookmaking practice. Commission is a rebate/incentive to the losing client, not a fee on winners. Every satta platform works this way. | Medium | At settlement time, identify losing users per match market. Apply `match_commission` % to the absolute value of each user's net loss. Credit as separate COMMISSION ledger entry. |
| Fancy commission on total volume | Industry standard for session/fancy bets. Unlike match bets, fancy commission applies to the full volume (stake) regardless of win/loss, because fancy bets are short-duration, high-frequency. | Medium | At fancy settlement, sum all `total_cost` for the user's orders on that market. Apply `fancy_commission` %. Create COMMISSION ledger entry. |
| Commission as separate ledger entry | Transparency requirement. Clients see their full payout (or full loss), then a separate COMMISSION credit. Not netted into payout. PROJECT.md explicitly requires this. | Low | New `transaction_type: 'COMMISSION'` in `credit_transactions`. Must appear in both client and agent ledger views. Commission credits add to client balance, not reduce settlement payout. |
| Per-user commission rates | Already in schema (`match_commission`, `fancy_commission` on `betting_users`). Clients expect their negotiated rate, not a flat platform rate. Different clients have different relationships with their agent. | Low | Fields exist. Just need to read them at settlement time instead of hardcoded `0`. |
| Commission rate hierarchy enforcement | Client's commission rate cannot exceed their parent agent's rate. Already enforced in UI (caps in create/edit forms). Must also be enforced at settlement if rates change between bet and settle. | Low | UI enforcement exists. Add a `Math.min(clientRate, agentRate)` guard at settlement time as defensive check. |
| Default commission rates configurable | Admin sets platform-wide defaults. Agent can customize per-client within their own limits. Already partially built (admin settings panel has default commission save). | Low | `platform_config` table stores defaults. Already wired in admin settings. |

### Agent P&L Hierarchy

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Agent share % of client P&L | Core economics. Agent with 80% `partnership_share` bears 80% of their downline's net P&L. If clients win net 1000, agent owes 800 upward. If clients lose net 1000, agent earns 800. This IS the business model. | High | Calculated per-market at settlement. Schema field `partnership_share` exists but unused. Must flow into agent settlement calculations. |
| Agent bears share % of commission cost | If agent share is 80%, agent pays 80% of commission given to clients. Commission is a cost to the house -- agent absorbs their share of that cost. | Medium | At settlement: `agent_commission_cost = sum(client_commissions) * (partnership_share / 100)`. Deducted from agent's P&L. |
| Agent can go negative (owes upward) | Real bookmaking economics. Agent is not floored at zero. If clients win big, agent owes admin real money. This distinguishes a real book from a game. | Medium | Agent settlement already tracks "Agent Owes Admin" / "Admin Owes Agent" states. Need to extend this with the share-adjusted market P&L so the settlement card reflects actual economics, not just chip flow. |
| Agent P&L calculated per-market at settlement | When a market settles, compute the agent's share of client wins/losses and commission costs for that market. Not recalculated retroactively -- snapshot at settle time. | High | At `settleMatchMarket()`/`settleFancyMarket()`, after settling all clients, compute per-agent rollup. Store or derive: `{ agent_id, event_id, client_pnl, commission_given, agent_share_pnl, agent_share_commission, net_agent_pnl }`. |
| Agent P&L summary view | Agent needs a dashboard showing: total client volume, total client wins, total client losses, total commission given, their share of P&L, their net position. This is the agent's "scorecard." | Medium | `agent.html` already has a P&L tab with volume/commission/position stats. Needs to be reworked to use actual settlement data (currently estimates from order volume). |
| Agent P&L per-market detail | Expandable per-market breakdown: which clients won/lost how much, commission per client, agent's share. Agents need to audit individual markets. | Medium | Settled markets table exists in agent P&L tab. Needs per-client drill-down rows with commission and share columns. |
| Agent P&L per-client detail | Agent sees each client's total P&L across all markets, commission given, agent's net position per client. Essential for managing client relationships. | Low | Client table exists in agent P&L tab. Add commission and net P&L columns (currently shows volume and estimated commission). |

### Mobile Agent UI

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Agent dashboard mobile-responsive | Agents operate from phones in the field. They need to check client activity, balances, and P&L on mobile. Desktop-only agent UI is a blocker for real usage. | Medium | `client.html` already has a proven mobile-first approach. Replicate its responsive patterns (nav drawer, stacked layouts, touch targets) for `agent.html`. |
| Mobile-friendly settlement view | The settlement tab with its cards and calculations must work on small screens. This is where agents check what they owe or are owed. | Medium | Settlement cards currently use a 3-column grid. Switch to single-column on mobile. Ensure touch-friendly settle button. |
| Mobile-friendly P&L view | P&L tables with per-client and per-market breakdowns must be scrollable/readable on mobile. | Medium | Use horizontal scroll for tables or switch to card-based layout on small screens. |

### Code Restructure

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Extract inline JS into separate files | `admin.html` is ~3000+ lines of inline JS+HTML+CSS. Adding commission logic to this monolith is unsustainable. This is a prerequisite for maintainable feature work. | High | Create `admin.js`, `agent.js`, `client.js` (or modular pieces). Keep `auth.js` as shared. Load via `<script src>`. No build step needed -- just file separation. |
| Extract inline CSS into separate files | Same rationale. CSS is duplicated across pages with subtle variations. | Medium | Create `shared.css`, `admin.css`, `agent.css`, `client.css`. Deduplicate common styles (cards, badges, tables, modals). |
| Shared component library | Common UI patterns (modals, toasts, tables, badges, nav) are copy-pasted across all three HTML files. Commission/P&L features add more shared UI. | Medium | Extract into `components.js` with helper functions. Not a framework -- just shared functions that generate HTML strings. |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Real-time agent P&L updates | Agent sees P&L move live as clients place/exit bets on open markets, not just after settlement. Uses existing Supabase realtime channels. | Medium | Existing realtime infrastructure handles rate updates. Extending to order updates for live P&L projection is straightforward but adds a dimension of "how much am I exposed right now." |
| Commission audit trail | Full traceability: every commission entry links back to the specific market settlement and the client's loss/volume that generated it. Admin and agent can verify any commission. | Low | Achieved by rich `notes` field on COMMISSION transaction: `"Match commission 2% on loss of 500 in CSK vs MI"`. Already the pattern used for SETTLEMENT transactions. |
| Multi-level commission waterfall visibility | Admin sees: client commission, agent's share of commission cost, net platform commission cost. All three levels visible in one view. | Medium | Admin settlement/P&L view shows the full waterfall: client received X commission, agent absorbed Y%, platform absorbed Z%. |
| Agent self-service settlement request | Agent initiates a settlement request that admin approves, rather than admin-only settlement. Reduces admin burden. | Low | Currently out of scope per PROJECT.md ("Agent-initiated settlements -- admin-only is sufficient for now"). Good future feature. Do not build now. |
| Historical P&L trending | Charts showing agent P&L over time (daily/weekly/monthly). Helps agents see patterns. | Medium | Requires aggregating settlement data over time. Deferred -- not critical for initial commission rollout. |
| Commission rate change history | Track when commission rates were changed, by whom, effective from when. Prevents disputes. | Low | Add to audit_log on rate change. Already logged for other user edits. Just ensure commission-specific entries. |
| Void market commission handling | When a market is voided, any commission already booked must be reversed. Clean accounting. | Medium | VOID_REFUND transaction type exists for bet refunds. Add COMMISSION_REVERSAL for voided markets. Must handle partial voids if they exist. |

## Anti-Features

Features to deliberately NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Commission deducted from payout | This is NOT how Indian bookmaking works. Commission is a separate credit TO the client, not a deduction FROM winnings. Netting into payout hides the incentive and confuses clients. | Always: separate COMMISSION ledger entry that adds to client balance. Client sees full settlement, then commission as a separate positive line. |
| Retroactive commission recalculation | If commission rates change after a market settles, do NOT recalculate old settlements. Snapshot at settle time. Retroactive changes create accounting nightmares and disputes. | Commission is frozen at the rate active when settlement runs. Rate changes only affect future settlements. |
| Agent-to-agent transfers | Agents should not transfer funds between each other. This creates circular flows that break accounting. All money flows through admin. | Maintain strict hierarchy: Admin -> Agent -> Client. No lateral transfers. |
| Automated agent settlement | Auto-settling based on P&L thresholds. Cash settlements are physical (cash exchanged in person). Cannot be automated. | Keep settlement as explicit admin action (AGENT_SETTLEMENT transaction). |
| Client-visible commission rate | Clients should NOT see their exact commission percentage. They see the commission amount they receive, not the rate. Rate visibility creates comparison and negotiation pressure. | Show commission amounts in ledger, not rates. Rate only visible to agent and admin. |
| Sub-agent hierarchy | Admin -> Agent -> Sub-Agent -> Client. Adds exponential complexity to P&L rollup. Not needed for v1. | Stick to 3-tier hierarchy (Admin -> Agent -> Client). If needed later, it's a separate milestone. |
| Per-bet commission | Calculating and booking commission on each individual bet placement. Commission is a settlement-time concept, not bet-time. | Commission calculated and booked only at market settlement. No commission entries during live trading. |
| Negative commission (penalty) | Charging clients for winning. This is not how the incentive model works. | Commission is always >= 0. It is a credit to the client, never a debit. |

## Feature Dependencies

```
Code Restructure (extract JS/CSS)
  --> Commission at Settlement (modifying settlement functions)
    --> Commission Ledger Entries (new transaction type)
    --> Agent Share of Commission Cost (depends on commission amounts)
  --> Agent P&L per-market (modifying settlement functions)
    --> Agent P&L Summary View (depends on per-market data)
    --> Agent P&L per-client View (depends on per-market data)

Commission Rate Hierarchy Enforcement (UI exists)
  --> Commission at Settlement (rates must be read correctly)

Mobile Agent UI (independent of commission logic)
  --> Code Restructure (easier to adapt responsive design with separated files)

Agent Share of P&L (partnership_share field exists)
  --> Agent P&L per-market (calculated at settlement)
  --> Agent Settlement Card Update (reflect share-adjusted P&L)
```

**Critical path:** Code restructure should come FIRST or IN PARALLEL with commission, because modifying the 3000-line inline JS for commission logic will compound the tech debt problem. However, if speed matters more than maintainability, commission can be added to the monolith and restructured afterward.

**Recommended ordering:**
1. Commission at settlement (match + fancy) -- highest business value, directly enables correct economics
2. Commission ledger entries -- immediate visibility for users
3. Agent share of P&L + commission cost -- completes the economic model
4. Agent P&L views (summary + per-market + per-client) -- agents can now see real numbers
5. Mobile agent UI -- agents can use the system from phones
6. Code restructure -- can happen before, during, or after, but the longer it waits the harder it gets

## MVP Recommendation

Prioritize:
1. **Commission deduction at settlement** (both match and fancy) -- this is the #1 stated requirement. Without it, the platform's economics are wrong. Every settlement currently ignores commission.
2. **Commission as separate ledger entries** -- clients and agents must see commission flow. Transparency is the whole point.
3. **Agent share % of P&L and commission** -- without this, agent settlement cards show chip flow, not actual economics. Agents cannot know what they owe or are owed.
4. **Agent P&L view rework** -- connect the existing P&L tab to real settlement data instead of estimated calculations.
5. **Mobile agent UI** -- agents cannot use the system without this; currently desktop-only.

Defer:
- **Code restructure**: High value but not user-facing. Can be done as a preparatory step or deferred until after commission is proven correct. Recommend doing it first if schedule allows, but do not block commission delivery on it.
- **Real-time agent P&L**: Nice differentiator but settlement-time P&L is sufficient for launch.
- **Agent self-service settlement**: Explicitly out of scope per PROJECT.md.
- **Historical P&L trending**: No value until commission data exists.

## Complexity Budget

| Feature Group | Estimated Complexity | Risk |
|---------------|---------------------|------|
| Match commission at settlement | Medium | Low -- logic is straightforward, identify losers, apply %. Main risk is getting the "loss" calculation right for hedged LAGAI+KHAI positions. |
| Fancy commission at settlement | Medium | Low -- simpler than match (flat volume-based). |
| Commission ledger entries | Low | Very low -- insert a row with a new transaction type. |
| Agent share of P&L | High | Medium -- must aggregate per-agent across all clients for each market. Must handle the case where agent has 0% share (admin absorbs all). |
| Agent share of commission cost | Medium | Low -- simple multiplication once commission amounts are known. |
| Agent P&L views | Medium | Low -- mostly UI work reading existing data differently. |
| Mobile agent UI | Medium | Low -- proven patterns from client.html. |
| Code restructure | High | Medium -- risk of breaking existing functionality when splitting files. Must be done carefully with manual testing (no automated tests). |

## Sources

- `/private/tmp/bhandai-rebuild/.planning/PROJECT.md` -- commission rules, agent hierarchy, business constraints
- `/private/tmp/bhandai-rebuild/admin.html` lines 2827-2945 -- existing settlement logic with commission TODO
- `/private/tmp/bhandai-rebuild/agent.html` lines 1183-1240 -- existing agent P&L rendering
- `/private/tmp/bhandai-rebuild/schema.sql` -- database schema with commission fields
- `/private/tmp/bhandai-rebuild/.planning/codebase/STRUCTURE.md` -- DB table definitions including `match_commission`, `fancy_commission`, `partnership_share`
- `/private/tmp/bhandai-rebuild/.planning/codebase/CONCERNS.md` -- confirmed commission is incomplete (0% applied)
- Domain knowledge: Indian bookmaking commission conventions (match on losses, fancy on volume, commission as rebate not fee, agent share hierarchy)
