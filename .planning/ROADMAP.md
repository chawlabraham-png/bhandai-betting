# Roadmap: Bhandai Betting Exchange -- Commission & P&L Milestone

## Overview

This milestone adds correct financial economics to the Bhandai betting exchange: commission deduction at settlement (match on losses, fancy on volume), agent P&L hierarchy reflecting Indian bookmaking partnership share, mobile-responsive agent experience, and code modularization for maintainability. The critical path is infrastructure safety first, then commission (match before fancy, since different formulas), then agent P&L (calculation before views), then mobile UI, then restructure. Commission and code restructure never overlap.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Infrastructure Safety** - Atomic balance mutations, directory consolidation, audit trail readiness
- [ ] **Phase 2: Match Commission** - Commission on client losses at match settlement via PostgreSQL RPC
- [ ] **Phase 3: Fancy Commission** - Commission on total volume at fancy settlement via PostgreSQL RPC
- [ ] **Phase 4: Commission Visibility** - Commission entries visible across admin, agent, and client views
- [ ] **Phase 5: Agent P&L Core** - Agent share of client P&L and commission cost, calculated and persisted at settlement
- [ ] **Phase 6: Agent P&L Views** - Agent P&L summary, per-market detail, per-client detail, and admin settlement cards
- [ ] **Phase 7: Agent Mobile UI** - Agent dashboard, P&L views, settlement, and client management responsive on mobile
- [ ] **Phase 8: Code Modularization** - Extract inline JS/CSS into separate files with namespace convention

## Phase Details

### Phase 1: Infrastructure Safety
**Goal**: Balance mutations during settlement are atomic and the codebase has a single source of truth
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. Balance updates during settlement use a PostgreSQL RPC that performs atomic `SET balance = balance + delta` (no client-side read-modify-write)
  2. All source code lives in a single working directory (no copy workflow between directories)
  3. The `notes` column on `credit_transactions` accepts arbitrary text for audit trail data
**Plans**: 2 plans

Plans:
- [ ] 01-01-PLAN.md -- Directory consolidation and notes column verification (INFRA-02, INFRA-03)
- [ ] 01-02-PLAN.md -- Atomic adjust_balance RPC and settlement code migration (INFRA-01)

### Phase 2: Match Commission
**Goal**: Match bet settlement correctly deducts commission as a percentage of client losses, with per-user rates and hierarchy enforcement
**Depends on**: Phase 1
**Requirements**: COMM-01, COMM-02, COMM-03, COMM-04, COMM-05
**Success Criteria** (what must be TRUE):
  1. After match market settlement, clients who lost receive a COMMISSION credit equal to their `match_commission` rate applied to their net loss amount
  2. Clients who won on a match market receive zero commission (commission is on losses only)
  3. Each client's effective commission rate is capped at their parent agent's rate at settlement time
  4. COMMISSION appears as a separate row in `credit_transactions` (distinct from the SETTLEMENT row), with notes linking to the market and loss amount
  5. Match settlement executes as a single PostgreSQL RPC call (not sequential client-side mutations)
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: Fancy Commission
**Goal**: Fancy bet settlement correctly deducts commission as a percentage of total volume, regardless of win/loss
**Depends on**: Phase 2
**Requirements**: COMM-06, COMM-07, COMM-08, COMM-09, COMM-10
**Success Criteria** (what must be TRUE):
  1. After fancy market settlement, every client who placed bets receives a COMMISSION credit equal to their `fancy_commission` rate applied to their total order volume (sum of `total_cost`)
  2. Fancy commission is paid regardless of whether the client won or lost
  3. Each client's effective fancy commission rate is capped at their parent agent's rate at settlement time
  4. COMMISSION appears as a separate row in `credit_transactions` with notes linking to the market and volume amount
  5. Fancy settlement executes as a single PostgreSQL RPC call
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: Commission Visibility
**Goal**: All users can see commission transactions in their respective views with correct filtering and contextual information
**Depends on**: Phase 3
**Requirements**: COMM-11, COMM-12, COMM-13, COMM-14, COMM-15
**Success Criteria** (what must be TRUE):
  1. Admin master ledger shows COMMISSION transactions and they can be filtered by type
  2. Client history/ledger shows their COMMISSION entries with the credited amount and linked market
  3. Agent client ledger view shows COMMISSION entries for their clients
  4. Every COMMISSION row in `credit_transactions` has a `notes` field containing the market name, formula used (losses-only or volume-based), and the base amount
  5. Client bet slip shows a commission preview explaining the applicable formula (match: "X% on losses" or fancy: "X% on volume")
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: Agent P&L Core
**Goal**: Agent profit and loss is correctly calculated from partnership share of client outcomes and commission costs, persisted at settlement time
**Depends on**: Phase 4
**Requirements**: APNL-01, APNL-02, APNL-03, APNL-04, APNL-05, APNL-06
**Success Criteria** (what must be TRUE):
  1. At market settlement, each agent's P&L is computed as `partnership_share%` of the net P&L across all their clients for that market
  2. At market settlement, each agent's commission cost is computed as `partnership_share%` of total commission paid to their clients for that market
  3. Agent net P&L per market = agent share of client P&L minus agent share of commission cost (both are separate calculations)
  4. Agent P&L can go negative (if clients net win, agent owes upward -- no floor at zero)
  5. Settlement results are persisted in a `settlement_results` table at settlement time (snapshot, not retroactively computed)
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

### Phase 6: Agent P&L Views
**Goal**: Agents can view their P&L across markets and clients, and admins see share-adjusted settlement cards
**Depends on**: Phase 5
**Requirements**: APNL-07, APNL-08, APNL-09, APNL-10, APNL-11
**Success Criteria** (what must be TRUE):
  1. Agent sees a P&L summary showing total client volume, wins, losses, commission given, agent share, and net position
  2. Agent can expand any settled market to see per-market detail: client wins, losses, commission, and agent net for that market
  3. Agent can view per-client detail showing each client's total P&L, commission received, and the agent's net exposure per client
  4. During open markets, agent sees live P&L exposure updates via realtime subscriptions (not just settled data)
  5. Admin agent settlement cards display share-adjusted P&L figures (reflecting the agent's actual economics, not just raw chip flow)
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Agent Mobile UI
**Goal**: Agents can use the full agent dashboard from mobile devices with a touch-friendly, readable layout
**Depends on**: Phase 6
**Requirements**: AMOB-01, AMOB-02, AMOB-03, AMOB-04
**Success Criteria** (what must be TRUE):
  1. Agent dashboard renders correctly on mobile screens (375px-428px width) using the same mobile-first patterns as client.html
  2. Agent P&L views use card-based layout on small screens with scrollable tables for detail data
  3. Agent settlement view uses single-column cards with touch-friendly action buttons (no tiny desktop-sized controls)
  4. Agent client management forms (create, edit, fund transfer) are usable on mobile without horizontal scrolling or overlapping elements
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

### Phase 8: Code Modularization
**Goal**: Monolithic inline JS/CSS is extracted into maintainable separate files with a consistent namespace convention
**Depends on**: Phase 7
**Requirements**: CODE-01, CODE-02, CODE-03, CODE-04, CODE-05, CODE-06, CODE-07
**Success Criteria** (what must be TRUE):
  1. Shared utilities (sanitize, fmt, timeAgo, showToast, modal helpers) live in `lib/utils.js` and are loaded via `<script src>` by all role pages
  2. Commission calculation is in `lib/commission.js` as pure functions with no side effects -- `calcMatchCommission(netPnl, rate)` and `calcFancyCommission(volume, rate)`
  3. Agent P&L calculation is in `lib/pnl.js` as pure functions
  4. Each role's JS is in separate files (not inline `<script>` blocks) and HTML files contain only markup plus `<script src>` / `<link>` references
  5. All shared code uses `window.BX` namespace; role-specific code uses `window.Admin`, `window.Agent`, or `window.Client` namespaces
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Infrastructure Safety | 0/2 | Planning complete | - |
| 2. Match Commission | 0/0 | Not started | - |
| 3. Fancy Commission | 0/0 | Not started | - |
| 4. Commission Visibility | 0/0 | Not started | - |
| 5. Agent P&L Core | 0/0 | Not started | - |
| 6. Agent P&L Views | 0/0 | Not started | - |
| 7. Agent Mobile UI | 0/0 | Not started | - |
| 8. Code Modularization | 0/0 | Not started | - |
