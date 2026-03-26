# Bhandai Betting Exchange — Project Handoff

> Paste this entire file into Claude to continue from where we left off.

## Project Overview

**Bhandai** is a 3-tier betting exchange (ADMIN > AGENT > CLIENT) for cricket/sports betting with Indian bookmaking mechanics (LAGAI/KHAI). Built on Supabase with vanilla HTML/CSS/JS.

- **Live URL:** Deployed on Hostinger (static hosting)
- **Local dev:** `cd /private/tmp/bhandai-rebuild && python3 -m http.server 3000`
- **Database:** Supabase project `vtxuzrkwnyhxciohwjjx.supabase.co`

## Git Repository

```bash
cd /private/tmp/bhandai-rebuild
git log --oneline -20  # see recent work
```

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS — no frameworks, no build tools, no TypeScript
- **Backend:** Supabase (PostgreSQL + Auth + Realtime)
- **Hosting:** Hostinger (static files)
- **Supabase SDK:** v2 via CDN (`@supabase/supabase-js@2`)
- **Auth:** Supabase Auth, anon key in `auth.js`

## File Structure (After Modularization)

```
├── index.html          # Login page
├── admin.html          # Admin dashboard (markup only)
├── agent.html          # Agent dashboard (markup only)
├── client.html         # Client panel (markup only)
├── auth.js             # Shared auth logic
├── lib/
│   ├── utils.js        # Shared utilities (window.BX namespace)
│   ├── commission.js   # Commission calc functions (window.BX)
│   └── pnl.js          # P&L display helpers (window.BX)
├── js/
│   ├── admin.js        # Admin logic (window.Admin namespace)
│   ├── agent.js        # Agent logic (window.Agent namespace)
│   └── client.js       # Client logic (window.Client namespace)
├── css/
│   ├── shared.css      # Common styles (reset, fonts, toast, modal)
│   ├── admin.css       # Admin-specific styles
│   ├── agent.css       # Agent-specific styles
│   └── client.css      # Client-specific (mobile-first)
├── sql/
│   ├── 001_notes_column.sql
│   ├── 002_adjust_balance_rpc.sql       # Atomic balance adjustment
│   ├── 003_settle_match_market_rpc.sql  # Match settlement + commission + agent P&L
│   ├── 004_settle_fancy_market_rpc.sql  # Fancy settlement + commission + agent P&L
│   └── 005_settlement_results_table.sql # Per-agent-per-market P&L snapshots
└── .planning/           # GSD planning artifacts (roadmap, phases, context)
```

## What Has Been Built (v1.0 Complete — 8/8 Phases)

### Phase 1: Infrastructure Safety
- `adjust_balance` RPC for atomic balance mutations
- Notes column on credit_transactions

### Phase 2: Match Commission
- `settle_match_market` PostgreSQL RPC — atomic settlement with commission
- Commission = match_commission% x net loss, FLOOR rounding, rate capped at parent agent
- COMMISSION transaction type in credit_transactions
- Admin UI: COMMISSION in ledger filter, reconciliation, activity feed

### Phase 3: Fancy Commission
- `settle_fancy_market` PostgreSQL RPC — atomic settlement with volume-based commission
- Commission = fancy_commission% x total volume (paid to ALL clients, winners and losers)
- Same FLOOR rounding, parent rate cap

### Phase 4: Commission Visibility
- Client: commission history cards (purple), "Commission" filter, bet slip preview
- Agent: COMMISSION in ledger, activity feed, filter dropdown
- Admin: already handled in Phase 2

### Phase 5: Agent P&L Core
- `settlement_results` table — per-agent-per-market P&L snapshots
- Both RPCs extended: accumulate client P&L per agent, apply partnership_share%, insert results
- Agent P&L = partnership_share% x (-client_net_pnl) minus partnership_share% x commission

### Phase 6: Agent P&L Views
- Agent P&L tab: actual settled data from settlement_results (not estimates)
- Per-market expandable detail with per-client breakdown
- Live exposure section with ESTIMATED badge
- Admin settlement cards with share-adjusted P&L rows

### Phase 7: Agent Mobile UI
- Responsive CSS for screens ≤ 768px
- Bottom nav with 5 tabs + "More" slide-up menu
- Stat cards stack vertically, tables scroll horizontally
- Touch-friendly buttons (44px min), full-width modals

### Phase 8: Code Modularization
- Extracted inline JS/CSS into separate files
- `window.BX` namespace for shared utils
- `window.Admin`, `window.Agent`, `window.Client` for role-specific code
- HTML files are now markup-only (~70% line reduction)

## Key Business Rules

### Commission Model
- **Match commission:** % of net loss per market (losers only), coin credit to client
- **Fancy commission:** % of total volume per market (ALL clients), coin credit to client
- **Rate source:** `betting_users.match_commission` / `betting_users.fancy_commission`
- **Rate cap:** Client rate capped at parent agent's rate at settlement time
- **Rounding:** FLOOR — always favors admin/house

### Agent P&L
- Agent P&L = partnership_share% of client net P&L minus commission cost
- Can go negative (when clients win)
- Stored in `settlement_results` at settlement time (snapshot, immutable)
- No balance changes for agents — P&L is recorded, not settled to balance

### Hierarchy
- Admin → Agent → Client (strict fund flow)
- Admin funding agent's client reflects in agent's "owes admin" balance
- Clients directly under admin have no agent P&L entries

### Market Types
- **MATCH:** Two-team, LAGAI (back fav) + KHAI (lay fav), rate-based
- **FANCY:** Session/player bets, YES/NO, line_value based

## Database (Supabase)

### Key Tables
- `betting_users` — users with role, balance, match_commission, fancy_commission, partnership_share, parent_id
- `events` — markets (MATCH/FANCY)
- `outcomes` — market outcomes
- `orders` — bets placed
- `credit_transactions` — all money movements (SETTLEMENT, COMMISSION, DEPOSIT, WITHDRAWAL, ADMIN_MINT, VOID_REFUND)
- `settlement_results` — per-agent-per-market P&L snapshots

### Key RPCs (PostgreSQL functions)
- `adjust_balance(p_user_id, p_delta)` — atomic balance change
- `settle_match_market(p_event_id, p_winning_outcome_id, p_settled_by)` — atomic match settlement + commission + agent P&L
- `settle_fancy_market(p_event_id, p_result_value, p_settled_by)` — atomic fancy settlement + commission + agent P&L

## GSD Workflow

This project uses the GSD (Get Shit Done) workflow system for planning and execution. All planning artifacts are in `.planning/`.

Key commands:
- `/gsd:progress` — see current state
- `/gsd:plan-phase N` — plan a phase
- `/gsd:execute-phase N` — execute a phase
- `/gsd:discuss-phase N` — discuss decisions before planning

## Installed Tools

- **GSD** — Get Shit Done workflow system (in `$HOME/.claude/get-shit-done/`)
- **Ruflo** v3.5.48 — AI agent orchestration (30 skills, 98 agents, 10 commands in `.claude/`)

## What's Next (Potential v2 Work)

These were deferred during v1:
- Commission rate change audit trail (COMM-V2-02)
- Void market commission reversal (COMM-V2-01)
- Multi-level commission waterfall visibility (COMM-V2-03)
- Agent self-service settlement requests (APNL-V2-01)
- Historical P&L trending charts (APNL-V2-02)
- Sub-agent hierarchy (APNL-V2-03)
- Full accounting hierarchy refactor (admin deposits flowing through agent)

## Important Conventions

- `sanitize(str)` wraps ALL user content before innerHTML (XSS prevention)
- `auditLog(action, {targetId, extra, amount})` logs every admin action
- `showToast(msg, type)` for user feedback
- FLOOR rounding on all financial calculations (favors admin)
- Session storage (not localStorage) — each tab independent
- 30-min idle timeout with 2-min warning

## To Get Started

```bash
cd /private/tmp/bhandai-rebuild
python3 -m http.server 3000
# Open http://localhost:3000
```

For Supabase access, use the SQL Editor in the dashboard to run any `.sql` files.
