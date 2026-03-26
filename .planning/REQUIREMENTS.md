# Requirements: Bhandai Betting Exchange -- Commission & P&L Milestone

**Defined:** 2026-03-25
**Core Value:** Accurate commission deduction and P&L reporting across the agent-client hierarchy

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Prerequisites

- [x] **INFRA-01**: Settlement balance mutations use atomic PostgreSQL RPC (`adjust_balance`) instead of client-side read-modify-write
- [x] **INFRA-02**: Source directories consolidated to single working directory (eliminate copy workflow)
- [x] **INFRA-03**: `notes` column verified on `credit_transactions` for audit trail data

### Commission -- Match

- [x] **COMM-01**: Match commission calculated as % of client's net loss per market (zero if client wins)
- [x] **COMM-02**: Match commission uses client's `match_commission` rate from `betting_users` at settlement time
- [x] **COMM-03**: Match commission enforces hierarchy -- client rate capped at parent agent's rate at settlement
- [x] **COMM-04**: Match commission inserted as separate COMMISSION transaction in `credit_transactions` (not netted into SETTLEMENT payout)
- [x] **COMM-05**: Match commission credits client balance (positive entry -- rebate, not fee)

### Commission -- Fancy

- [ ] **COMM-06**: Fancy commission calculated as % of client's total volume (sum of `total_cost` on all orders) per market
- [ ] **COMM-07**: Fancy commission uses client's `fancy_commission` rate from `betting_users` at settlement time
- [ ] **COMM-08**: Fancy commission enforces hierarchy -- client rate capped at parent agent's rate at settlement
- [ ] **COMM-09**: Fancy commission inserted as separate COMMISSION transaction in `credit_transactions`
- [ ] **COMM-10**: Fancy commission credits client balance regardless of win/loss

### Commission -- Visibility

- [x] **COMM-11**: COMMISSION transactions visible in admin master ledger with filtering
- [x] **COMM-12**: COMMISSION transactions visible in client history/ledger
- [x] **COMM-13**: COMMISSION transactions visible in agent client ledger view
- [x] **COMM-14**: Commission audit trail -- each COMMISSION entry includes rich notes linking to market and loss/volume amount
- [x] **COMM-15**: Client bet slip commission preview shows correct formula (match: on losses, fancy: on volume)

### Agent P&L -- Core

- [x] **APNL-01**: Agent P&L = partnership_share% of client net P&L per settled market
- [x] **APNL-02**: Agent commission cost = partnership_share% of total commission paid to clients per market
- [x] **APNL-03**: Agent net P&L per market = agent share of client P&L minus agent share of commission cost
- [x] **APNL-04**: Agent can go negative -- no floor at zero (owes upward if clients net win)
- [x] **APNL-05**: Agent P&L calculated and persisted at market settlement time (snapshot, not retroactive)
- [x] **APNL-06**: Settlement results stored in `settlement_results` table for audit/reporting

### Agent P&L -- Views

- [x] **APNL-07**: Agent P&L summary view -- total client volume, wins, losses, commission given, agent share, net position
- [x] **APNL-08**: Agent P&L per-market expandable detail -- client wins, losses, commission, agent net per market
- [x] **APNL-09**: Agent P&L per-client detail -- each client's total P&L, commission, agent's net per client
- [x] **APNL-10**: Real-time agent P&L -- live exposure tracking during open markets via realtime subscriptions
- [x] **APNL-11**: Admin agent settlement cards show share-adjusted P&L (not just chip flow)

### Agent Mobile UI

- [x] **AMOB-01**: Agent dashboard responsive -- works on mobile screens (replicate client.html mobile-first patterns)
- [x] **AMOB-02**: Agent P&L views mobile-friendly -- card-based layout on small screens, scrollable tables
- [ ] **AMOB-03**: Agent settlement view mobile-friendly -- single-column cards, touch-friendly actions
- [ ] **AMOB-04**: Agent client management mobile-friendly -- create/edit/fund forms usable on mobile

### Code Restructure

- [x] **CODE-01**: Shared utilities extracted to `lib/utils.js` (sanitize, fmt, timeAgo, showToast, modal helpers)
- [x] **CODE-02**: Commission calculation extracted to `lib/commission.js` (pure functions, no side effects)
- [x] **CODE-03**: Agent P&L calculation extracted to `lib/pnl.js`
- [x] **CODE-04**: Role-specific JS extracted from inline `<script>` into separate files per role
- [x] **CODE-05**: Inline CSS extracted to shared (`shared.css`) and role-specific CSS files
- [x] **CODE-06**: Namespace convention applied -- `window.BX` for shared, `window.Admin`/`window.Agent`/`window.Client` for role-specific
- [x] **CODE-07**: HTML files reduced to markup + `<script src>` / `<link>` references only

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Commission Enhancements

- **COMM-V2-01**: Void market commission reversal (COMMISSION_REVERSAL transaction type)
- **COMM-V2-02**: Commission rate change history tracked in audit log
- **COMM-V2-03**: Multi-level commission waterfall visibility for admin (client -> agent -> platform)

### Agent Enhancements

- **APNL-V2-01**: Agent self-service settlement requests
- **APNL-V2-02**: Historical P&L trending (daily/weekly/monthly charts)
- **APNL-V2-03**: Sub-agent hierarchy support (Admin -> Agent -> Sub-Agent -> Client)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Commission deducted from payout | Wrong model -- commission is a separate credit TO client, not a deduction |
| Retroactive commission recalculation | Snapshot at settlement time, rate changes only affect future |
| Agent-to-agent transfers | Breaks accounting -- all money flows through admin |
| Automated agent settlement | Cash settlements are physical, cannot be automated |
| Client-visible commission rate | Clients see amounts, not percentages -- prevents negotiation pressure |
| Per-bet commission | Commission is settlement-time only, not per-bet |
| Negative commission / penalties | Commission is always >= 0, never a debit |
| OTP login | Deferred, not critical |
| Mobile app | Web-first |
| Automated tests | Deferred |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1: Infrastructure Safety | Pending |
| INFRA-02 | Phase 1: Infrastructure Safety | Complete |
| INFRA-03 | Phase 1: Infrastructure Safety | Complete |
| COMM-01 | Phase 2: Match Commission | Complete |
| COMM-02 | Phase 2: Match Commission | Complete |
| COMM-03 | Phase 2: Match Commission | Complete |
| COMM-04 | Phase 2: Match Commission | Complete |
| COMM-05 | Phase 2: Match Commission | Complete |
| COMM-06 | Phase 3: Fancy Commission | Pending |
| COMM-07 | Phase 3: Fancy Commission | Pending |
| COMM-08 | Phase 3: Fancy Commission | Pending |
| COMM-09 | Phase 3: Fancy Commission | Pending |
| COMM-10 | Phase 3: Fancy Commission | Pending |
| COMM-11 | Phase 4: Commission Visibility | Complete |
| COMM-12 | Phase 4: Commission Visibility | Complete |
| COMM-13 | Phase 4: Commission Visibility | Complete |
| COMM-14 | Phase 4: Commission Visibility | Complete |
| COMM-15 | Phase 4: Commission Visibility | Complete |
| APNL-01 | Phase 5: Agent P&L Core | Complete |
| APNL-02 | Phase 5: Agent P&L Core | Complete |
| APNL-03 | Phase 5: Agent P&L Core | Complete |
| APNL-04 | Phase 5: Agent P&L Core | Complete |
| APNL-05 | Phase 5: Agent P&L Core | Complete |
| APNL-06 | Phase 5: Agent P&L Core | Complete |
| APNL-07 | Phase 6: Agent P&L Views | Complete |
| APNL-08 | Phase 6: Agent P&L Views | Complete |
| APNL-09 | Phase 6: Agent P&L Views | Complete |
| APNL-10 | Phase 6: Agent P&L Views | Complete |
| APNL-11 | Phase 6: Agent P&L Views | Complete |
| AMOB-01 | Phase 7: Agent Mobile UI | Complete |
| AMOB-02 | Phase 7: Agent Mobile UI | Complete |
| AMOB-03 | Phase 7: Agent Mobile UI | Pending |
| AMOB-04 | Phase 7: Agent Mobile UI | Pending |
| CODE-01 | Phase 8: Code Modularization | Complete |
| CODE-02 | Phase 8: Code Modularization | Complete |
| CODE-03 | Phase 8: Code Modularization | Complete |
| CODE-04 | Phase 8: Code Modularization | Complete |
| CODE-05 | Phase 8: Code Modularization | Complete |
| CODE-06 | Phase 8: Code Modularization | Complete |
| CODE-07 | Phase 8: Code Modularization | Complete |

**Coverage:**
- v1 requirements: 40 total
- Mapped to phases: 40
- Unmapped: 0

---
*Requirements defined: 2026-03-25*
*Last updated: 2026-03-25 after roadmap creation*
