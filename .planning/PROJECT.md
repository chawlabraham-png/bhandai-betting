# Bhandai Betting Exchange

## What This Is

A 3-tier betting exchange platform (ADMIN > AGENT > CLIENT) for cricket/sports betting with LAGAI/KHAI market mechanics native to Indian bookmaking. Built on Supabase with vanilla HTML/CSS/JS. Agents manage client networks, clients place bets, admins control markets and settlements.

## Core Value

Accurate commission deduction and P&L reporting across the agent-client hierarchy — the platform's economics must be correct before anything else matters.

## Requirements

### Validated

- ✓ Login with alphanumeric ID + password, role-based redirect — existing
- ✓ Session management with 30-min idle timeout — existing
- ✓ Cascade suspension (agent suspended → all clients suspended) — existing
- ✓ MATCH markets with LAGAI/KHAI rates and rate tables — existing
- ✓ FANCY markets with line values (YES/NO bets) — existing
- ✓ Bet placement with exposure model (lock max loss, hedging refunds) — existing
- ✓ Stale rate detection and market suspension checks — existing
- ✓ Live realtime rate updates via Supabase postgres_changes — existing
- ✓ Position management with live P&L, partial/full exit — existing
- ✓ MATCH settlement (by winning team, per-user exposure + netPnl) — existing
- ✓ FANCY settlement (by result value vs line) — existing
- ✓ Admin user management (create/edit agents & clients) — existing
- ✓ Admin market creation, pause/resume, simulation mode — existing
- ✓ Credit system (ADMIN_MINT, DEPOSIT, WITHDRAWAL, SETTLEMENT) — existing
- ✓ Master ledger with filtering and CSV export — existing
- ✓ Risk matrix (global liability per market) — existing
- ✓ Audit log with action tracking — existing
- ✓ Agent client management and fund transfers — existing
- ✓ Client mobile-first responsive UI — existing

### Active

- [ ] Commission deduction at settlement — match bets: % on client losses only; fancy bets: % on total volume
- [ ] Separate COMMISSION ledger entries (not deducted from payout, separate transaction)
- [ ] Agent bears share % of commission cost (80% share = 80% of commission paid)
- [ ] Agent P&L view — summary + expandable per-market detail (client wins, losses, commission, net)
- [ ] Agent can go negative (owes upward if clients net win)
- [ ] Agent P&L calculated per-market at settlement time
- [ ] Agent dashboard mobile-responsive (match client.html mobile-first approach)
- [ ] Full code restructure — extract inline JS/CSS into separate files, shared components

### Out of Scope

- OTP login — deferred, not critical for v1
- Re-auth for large fund transfers — deferred
- Automated tests — deferred
- Agent-initiated settlements — admin-only is sufficient for now
- Mobile app — web-first

## Context

**Tech stack:** Vanilla HTML/CSS/JS, Supabase (PostgreSQL + Auth + Realtime), no build step, deployed on Hostinger.

**Architecture:** Multi-role static web app. Each role has its own HTML entry point (admin.html ~4K lines, client.html ~2K lines, agent.html ~1.8K lines). All JS/CSS inline. Shared auth via auth.js.

**Database:** 9 tables — betting_users, events, outcomes, orders, portfolio_positions, credit_transactions, platform_announcements, platform_config, audit_logs.

**Commission fields exist but unused:** `match_commission` and `fancy_commission` on betting_users. Settlement logic has `const commission = 0; // TODO`. Agent share % field exists but P&L not calculated.

**Indian bookmaking model:**
- LAGAI = back the favourite (client wins if fav wins)
- KHAI = lay the favourite (client wins if fav loses)
- Commission is an incentive/rebate for playing, not a fee
- Match commission: % on losses only
- Fancy commission: % on total volume played
- Agent hierarchy: admin sets agent share %, agent bears that % of client P&L and commission costs

## Constraints

- **Tech stack**: Vanilla JS only — no frameworks, no build tools, no TypeScript
- **Deployment**: Static hosting on Hostinger — no server-side rendering
- **Database**: Supabase only — no additional backend services
- **Browser**: Mobile-first for client, desktop for admin, both for agent (after mobile UI work)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Commission as separate ledger entry | Transparency — client sees full payout then commission separately | — Pending |
| Match commission on losses only | Standard Indian bookmaking practice — incentive to keep playing | — Pending |
| Fancy commission on total volume | Industry standard for session/fancy bets | — Pending |
| Agent owes upward (no floor at zero) | Real bookmaking economics — agent takes on risk | — Pending |
| Full code restructure | Monolithic HTML files are unmaintainable at ~4K lines | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-25 after initialization*
