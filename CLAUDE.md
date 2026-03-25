<!-- GSD:project-start source:PROJECT.md -->
## Project

**Bhandai Betting Exchange**

A 3-tier betting exchange platform (ADMIN > AGENT > CLIENT) for cricket/sports betting with LAGAI/KHAI market mechanics native to Indian bookmaking. Built on Supabase with vanilla HTML/CSS/JS. Agents manage client networks, clients place bets, admins control markets and settlements.

**Core Value:** Accurate commission deduction and P&L reporting across the agent-client hierarchy — the platform's economics must be correct before anything else matters.

### Constraints

- **Tech stack**: Vanilla JS only — no frameworks, no build tools, no TypeScript
- **Deployment**: Static hosting on Hostinger — no server-side rendering
- **Database**: Supabase only — no additional backend services
- **Browser**: Mobile-first for client, desktop for admin, both for agent (after mobile UI work)
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Runtime & Language
- **Vanilla HTML/CSS/JavaScript** — no framework, no build step
- Static site served via `python3 -m http.server 3000` locally
- Deployed to **Hostinger** (static hosting)
## Frontend
- **Inter** + **JetBrains Mono** fonts (Google Fonts CDN)
- **Supabase JS SDK v2** via CDN: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`
- No bundler, no transpiler, no TypeScript — plain ES2020+ JS in `<script>` tags
## Backend / Database
- **Supabase** (PostgreSQL + Auth + Realtime)
## Key Dependencies (`package.json`)
- `@supabase/supabase-js` — backend SDK (also loaded via CDN in HTML)
- Node scripts (`seed.mjs`, `test_login.mjs`, etc.) for seeding/testing only — not part of production app
## Configuration
- Supabase URL + anon key hardcoded in `auth.js` (publishable key — intentional for client-side app)
- No `.env` files — credentials are public anon keys only
- No CI/CD pipeline configured
## Browser Support
- Mobile-first (`client.html`) — targets modern iOS/Android Safari + Chrome
- Admin (`admin.html`) — desktop only, modern Chrome/Firefox
- No IE/legacy support needed
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Security Patterns
- `sanitize(str)` — XSS helper, wraps all user-supplied content before innerHTML
- `auditLog(action, {targetId, targetLoginId, extra, amount})` — logs every admin action
- Typed market name confirmation before settle/void
- Cascading suspension (suspending agent suspends all their clients)
## Error Handling
- All async functions wrapped in try/catch
- `showToast(msg, 'error'|'success')` for user feedback
- Balance rollback on failed order insert
- Non-blocking DB updates use `.then(()=>{}).catch(()=>{})`
## UI Patterns
- `fmt(n, decimals)` — number formatter (JetBrains Mono display)
- `timeAgo(date)` — relative time helper
- Modal pattern: `openModal('modalId')` / `closeModal('modalId')`
- Toast notifications: `showToast(message, type)`
- Auth gate: `#authGate` overlay visible until `requireRole()` resolves
## Bet Slip State (`bsState`)
## Rate Model
- `back_price` stored in outcomes (decimal, e.g. 1.40)
- `lay_price = back_price - 0.05` (computed, not stored)
- LAGAI rate = `ev.lagai_rate`; KHAI rate = `lagai_rate + 0.05`
- Exit formula: LAGAI `exitVal = stake × (entry/curKhai)`; KHAI `exitVal = stake / curKhai`
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern
## Role Hierarchy
```
```
## Entry Points
- `index.html` — login page, redirects by role after auth
- `admin.html` — ADMIN dashboard (desktop)
- `agent.html` — AGENT dashboard
- `client.html` — CLIENT panel (mobile-first)
- `auth.js` — shared auth logic loaded by all pages via `<script src="auth.js">`
## Auth Flow
## Session Management
- `sessionStorage` (not localStorage) — each browser tab has independent session
- 30-min idle timeout with 2-min warning banner
- Status polling every 60s — auto-logout if account suspended
- `window.supabaseClient` — global Supabase client instance
## Data Flow (Client Betting)
```
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
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
