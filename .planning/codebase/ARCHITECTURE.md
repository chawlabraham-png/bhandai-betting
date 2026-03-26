# ARCHITECTURE.md — System Architecture

## Pattern
Multi-role static web app with server-side auth via Supabase. No SPA router — each role gets its own HTML page. Navigation between roles is handled by redirects.

## Role Hierarchy
```
ADMIN
  └── AGENT (created by admin, manages clients)
        └── CLIENT (end user, places bets)
```

## Entry Points
- `index.html` — login page, redirects by role after auth
- `admin.html` — ADMIN dashboard (desktop)
- `agent.html` — AGENT dashboard
- `client.html` — CLIENT panel (mobile-first)
- `auth.js` — shared auth logic loaded by all pages via `<script src="auth.js">`

## Auth Flow
1. User logs in at `index.html` with login_id + password
2. `AuthSystem.login()` in `auth.js` calls Supabase Auth with synthesized email (`{id}@bhandai.com`)
3. On success, fetches role from `betting_users` table
4. Redirects to role-appropriate page
5. Each dashboard calls `AuthSystem.requireRole(role)` on load — redirects if mismatch

## Session Management
- `sessionStorage` (not localStorage) — each browser tab has independent session
- 30-min idle timeout with 2-min warning banner
- Status polling every 60s — auto-logout if account suspended
- `window.supabaseClient` — global Supabase client instance

## Data Flow (Client Betting)
```
Client places bet → confirmBet()
  → exposure calc (max possible loss)
  → balance deducted (exposure delta only)
  → order inserted (orders table)
  → portfolio_positions upserted

Admin settles market → settleMatchMarket() / settleFancyMarket()
  → per-user net P&L calculated (exposure model)
  → balance updated per user
  → credit_transaction inserted (SETTLEMENT type)
  → orders marked SETTLED
```

## Key Global State (client.html)
- `allEvents`, `allOutcomes` — loaded on init, updated via Realtime
- `myOrders` — current user's orders
- `currentUser`, `currentProfile` — auth session + betting_users row
- `bsState` — bet slip state (eventId, side, rate, etc.)
- `expandedMatchId` — which match group is expanded in markets tab

## Market Types
- **MATCH** — two-team market with lagai_rate; LAGAI (back fav) + KHAI (lay fav)
- **FANCY** — session/player bet with line_value; YES (≥ line) + NO (< line)

## Accounting Model (Exposure-Based)
- Admin mints coins on deposit (ADMIN_MINT transaction)
- Clients only lock their max possible loss, not full stake
- Settlement = exposure_locked + net_pnl for the settled scenario
- No admin balance — coins created on demand
