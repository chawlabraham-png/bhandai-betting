# Technology Stack

**Project:** Bhandai Betting Exchange -- Commission, Agent P&L, and Code Modularization
**Researched:** 2026-03-25

## Recommended Stack

This is an additive milestone on an existing vanilla JS + Supabase app. The constraint is explicit: no frameworks, no build tools, no TypeScript. Recommendations here are scoped to what is needed for commission calculation, agent P&L hierarchy, and modularizing the existing monolith.

### Core (Unchanged -- Existing Stack)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vanilla HTML/CSS/JS | ES2020+ | Frontend | Project constraint -- no framework |
| Supabase JS SDK | v2 (CDN) | Backend client | Already in use, loaded via jsDelivr |
| Supabase PostgreSQL | Latest (managed) | Database + RPC | Already in use, commission fields already exist |
| Hostinger | N/A | Static hosting | Already deployed here |

### New: Server-Side Commission Logic via Supabase RPCs

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| PostgreSQL PL/pgSQL functions | Built into Supabase | Settlement + commission calculation | **CRITICAL.** Commission deduction and balance mutation MUST be atomic. The current settlement code does sequential client-side `update` calls -- a network failure mid-settlement leaves the database in an inconsistent state. Moving settlement to a SECURITY DEFINER RPC wraps everything in a single database transaction. |
| `supabase.rpc()` | v2 SDK (already loaded) | Calling server-side functions | The JS client already supports `.rpc('function_name', { params })`. No new dependency needed. The existing codebase mentions `platform_reset()` as a SECURITY DEFINER RPC but never actually calls `.rpc()` in the frontend code -- this pattern needs to be established. |

**Confidence: HIGH** -- Supabase RPCs are well-documented, the pattern exists in the codebase (mentioned in INTEGRATIONS.md), and transactional settlement is a standard database pattern.

#### Why RPCs for Settlement (Not Client-Side JS)

The current settlement code in `admin.html` (lines 2827-2952) does this:

1. Fetches all open orders (1 query)
2. Marks event settled (1 update)
3. **For each user**: calculates P&L, updates balance, inserts credit_transaction (3+ sequential updates per user)

With 20 users having positions, that is 60+ sequential network round-trips with no transaction boundary. If the browser tab closes at step 40, the database is corrupt -- some users settled, some not, balances inconsistent.

A PostgreSQL function wraps this in a single `BEGIN...COMMIT` block. The client calls `supabase.rpc('settle_match_market', { p_event_id, p_winning_outcome_id })` and gets back a result or an error. No partial state.

### New: ES Modules for Code Modularization

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| ES Modules (`<script type="module">`) | Native browser | Extract inline JS into separate files | Universal browser support (Chrome 61+, Firefox 67+, Safari 10.1+). No bundler needed. The `type="module"` attribute gives strict mode, module scoping, and `import`/`export` syntax for free. Works on static hosting. |
| Import Maps (`<script type="importmap">`) | Native browser | Map bare module specifiers | Allows `import { settle } from 'settlement'` instead of relative paths. Supported in all modern browsers. Optional but improves DX. |

**Confidence: HIGH** -- ES modules are a browser standard since 2018. MDN confirms universal support. No polyfills needed for the target browsers (modern mobile Safari/Chrome, desktop Chrome/Firefox).

#### Why ES Modules (Not Other Approaches)

| Alternative | Why Not |
|------------|---------|
| Bundler (Vite, esbuild) | Violates "no build tools" constraint |
| IIFE pattern (`<script>` tags with load order) | Already outgrown -- 4000-line admin.html proves this. No dependency tracking, no explicit imports, everything on `window`. |
| AMD/RequireJS | Dead technology, ES modules replaced it |
| Web Components | Overkill for extraction -- the goal is code splitting, not component encapsulation. Could be used later for shared UI widgets but not the right tool for breaking apart settlement logic. |

### New: CSS Extraction (Shared Styles)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Shared CSS files | N/A | Extract inline `<style>` blocks | Each HTML file has 500+ lines of duplicated CSS for cards, badges, tables, modals. Extract to shared files loaded via `<link>` tags. No preprocessor needed -- CSS custom properties (already used in `styles.css`) handle theming. |
| CSS `@import` | Native | Compose CSS modules | The existing `styles.css` (login page styles) already uses CSS custom properties. Extend this pattern to `components.css`, `layout.css`, etc. |

**Confidence: HIGH** -- Standard CSS, no tooling needed.

### New: Agent P&L Data Model

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| New `settlement_results` table | PostgreSQL | Store per-user, per-market settlement breakdown | The current system calculates P&L at settlement time but only records a single `credit_transactions` row with the net amount. For agent P&L reporting, we need the breakdown: gross P&L, commission amount, net payout, per market, per user. Without this, agents can only see estimated commission (current `renderPnL()` multiplies total volume by commission rate -- inaccurate for match commission which is losses-only). |
| `agent_settlements` view or materialized view | PostgreSQL | Aggregate client settlements per agent | Agents need: "For market X, client C1 lost 500, commission was 25, client C2 won 300, commission was 0. My share of total P&L is..." This is a read query, not a write -- a database view keeps reporting logic in SQL instead of duplicating it in JS. |

**Confidence: MEDIUM** -- The data model is straightforward, but the exact commission formulas need validation against real bookmaking rules. The schema is my recommendation; the business rules are confirmed in PROJECT.md.

## Detailed Technology Decisions

### 1. Commission Calculation: PostgreSQL Function, Not Client-Side JS

**Decision:** Implement `settle_match_market()` and `settle_fancy_market()` as PL/pgSQL functions.

**Match commission formula** (from PROJECT.md):
- Commission applies to client **losses only**
- Commission % stored on `betting_users.match_commission`
- Commission is a separate ledger entry (COMMISSION type), not deducted from payout
- Agent bears `partnership_share`% of commission cost

```sql
-- Pseudocode for match settlement commission:
-- For each user in the market:
--   net_pnl = exposure_model_calculation(orders)
--   IF net_pnl < 0 (client lost):
--     loss_amount = ABS(net_pnl)
--     commission = loss_amount * (user.match_commission / 100)
--     INSERT credit_transaction(type='COMMISSION', amount=commission)
--   Payout = exposure_locked + net_pnl (unchanged from current logic)
```

**Fancy commission formula** (from PROJECT.md):
- Commission applies to **total volume played** (win or lose)
- Commission % stored on `betting_users.fancy_commission`

```sql
-- Pseudocode for fancy settlement commission:
-- For each order in the market:
--   volume = order.total_cost
--   commission = volume * (user.fancy_commission / 100)
--   INSERT credit_transaction(type='COMMISSION', amount=commission)
--   IF order is winner: payout = gross_payout (commission is separate, not deducted)
```

**Agent share formula:**
- Agent's `partnership_share` (e.g., 80%) means agent bears 80% of client P&L
- If clients net lose 10,000 coins in a market, agent's share = 8,000 (agent profits)
- If clients net win 10,000 coins, agent's share = -8,000 (agent owes upward)
- Agent also bears `partnership_share`% of commission cost
- Agent can go negative -- no floor at zero

**Why server-side:**
1. Atomicity -- all balance updates in one transaction
2. Security -- commission rates read from DB, not sent from client (prevents manipulation)
3. Auditability -- settlement logic in one place, not split across admin.html functions
4. Performance -- one round-trip instead of N*3 round-trips

**Confidence: HIGH** for the approach. MEDIUM for exact formula details -- will need validation during implementation.

### 2. Code Modularization Strategy: Incremental ES Module Extraction

**Decision:** Convert inline `<script>` blocks to ES modules loaded via `<script type="module">`.

**Current state:**
- `admin.html`: ~5700 lines, ~77 functions, all inline
- `agent.html`: ~1800 lines, ~33 functions, all inline
- `client.html`: ~2800 lines, ~56 functions, all inline
- `auth.js`: Only shared file (243 lines)
- `styles.css`: Only shared CSS (login page only)

**Target module structure:**

```
js/
  auth.js            (existing, becomes ES module)
  supabase.js        (Supabase client init, shared)
  utils.js           (sanitize, timeAgo, fmt, showToast -- duplicated across all 3 pages)
  settlement.js      (settlement logic -- extracted from admin.html, calls RPCs)
  commission.js      (commission calculation helpers, display formatting)
  ui/
    modal.js         (openModal, closeModal -- duplicated across pages)
    tabs.js          (switchTab, renderActiveTab pattern -- duplicated)
    toast.js         (showToast -- duplicated)
  admin/
    markets.js       (market CRUD, simulation)
    users.js         (user management)
    ledger.js        (ledger rendering)
    risk.js          (risk matrix)
    settings.js      (platform config)
  agent/
    dashboard.js     (agent dashboard rendering)
    clients.js       (agent client management)
    pnl.js           (agent P&L report -- NEW, replacing placeholder)
  client/
    betting.js       (bet placement, bet slip)
    positions.js     (portfolio, exits)
    markets.js       (market browsing)
css/
  shared.css         (cards, badges, tables, modals, buttons, forms)
  admin.css          (admin-specific layout)
  agent.css          (agent-specific layout)
  client.css         (client-specific mobile layout)
```

**Migration approach: Incremental, not big-bang.**

Phase 1 (with commission work): Extract `settlement.js`, `commission.js`, `utils.js`, `supabase.js`. These are needed for the commission feature and are the highest-value extractions.

Phase 2 (with agent P&L work): Extract `agent/pnl.js`, `agent/dashboard.js`. These are being rewritten anyway.

Phase 3 (dedicated restructure): Extract remaining modules. CSS extraction. This is the "full code restructure" from PROJECT.md.

**Key migration pattern:**

```html
<!-- Before: everything inline -->
<script>
  const sb = window.supabaseClient;
  function settleMatchMarket(ev, errEl) { /* 70 lines */ }
</script>

<!-- After: ES module -->
<script type="module">
  import { settleMatchMarket } from './js/settlement.js';
  // settlement.js handles its own Supabase client import
</script>
```

**Critical detail:** Functions currently attached to `window` or called via `onclick="..."` in HTML need special handling. ES modules are scoped -- not on `window`. Two approaches:

1. **Preferred:** Replace `onclick="fn()"` with `addEventListener` in the module
2. **Pragmatic:** Explicitly expose to window: `window.settleMatchMarket = settleMatchMarket;` in the module entry point

Use approach 2 during migration (minimal HTML changes), refactor to approach 1 later.

**Confidence: HIGH** -- ES modules work on all target browsers and on static hosting. The incremental approach avoids a risky big-bang rewrite.

### 3. Agent P&L: Server-Computed, Client-Displayed

**Decision:** Agent P&L data is computed at settlement time (in the PostgreSQL function) and stored in a `settlement_results` table. The agent dashboard reads from this table.

**Why not compute P&L client-side (like the current `renderPnL()`):**
- Current `renderPnL()` calculates "estimated commission" as `totalVolume * matchCommRate` -- this is wrong for match commission (should be losses only)
- Client-side calculation requires fetching all orders + all transactions + all users -- expensive and fragile
- Settlement time is the only correct time to calculate P&L (rates are locked, positions are final)
- Agent should see actual settled numbers, not estimates

**New table: `settlement_results`**

```sql
CREATE TABLE public.settlement_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id),
  user_id UUID REFERENCES betting_users(id),
  gross_pnl NUMERIC(15,2) NOT NULL,          -- raw P&L before commission
  commission_amount NUMERIC(15,2) DEFAULT 0,  -- commission charged
  net_payout NUMERIC(15,2) NOT NULL,          -- what was actually paid/deducted
  exposure_locked NUMERIC(15,2) NOT NULL,     -- how much was locked
  market_type VARCHAR(10) NOT NULL,           -- 'MATCH' or 'FANCY'
  settled_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, user_id)
);
```

**Agent P&L query pattern:**

```sql
-- Agent sees: for each market, each client's P&L, commission, and their share
SELECT
  sr.event_id, e.title, sr.user_id, bu.login_id,
  sr.gross_pnl, sr.commission_amount, sr.net_payout,
  -- Agent's share of this client's result
  sr.gross_pnl * (agent.partnership_share / 100) AS agent_share_pnl,
  sr.commission_amount * (agent.partnership_share / 100) AS agent_share_commission
FROM settlement_results sr
JOIN events e ON e.id = sr.event_id
JOIN betting_users bu ON bu.id = sr.user_id
JOIN betting_users agent ON agent.id = bu.parent_id
WHERE agent.id = :agent_id
ORDER BY sr.settled_at DESC;
```

**Confidence: HIGH** for the approach. The data model is standard for financial reporting.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Commission logic location | PostgreSQL RPC | Client-side JS (current) | No transaction safety, manipulable, 60+ network round-trips per settlement |
| Commission logic location | PostgreSQL RPC | Supabase Edge Functions (Deno) | Adds a new runtime, new deployment concern, and still needs DB transactions (would call the same SQL). Over-engineering for this use case. |
| Code modularization | ES Modules (native) | Vite/esbuild bundler | Violates "no build tools" constraint. Would improve DX but adds complexity the team does not want. |
| Code modularization | ES Modules (native) | Web Components | Overkill -- we need file splitting, not component encapsulation. Web Components add shadow DOM complexity for no benefit here. |
| Agent P&L storage | `settlement_results` table | Compute on-the-fly from orders | Inaccurate (current renderPnL is already wrong), expensive (N+1 queries), and cannot show historical commission breakdown. |
| Agent P&L storage | `settlement_results` table | Supabase materialized view | Views cannot be incrementally updated without `REFRESH MATERIALIZED VIEW` which requires superuser or scheduled jobs. A table populated at settlement time is simpler and more predictable. |
| CSS extraction | Shared CSS files | CSS-in-JS | No framework, no build tools. Plain CSS files loaded via `<link>` tags are the only viable approach. |
| CSS extraction | Shared CSS files | Tailwind CSS (CDN) | Introduces a framework dependency and changes the entire styling approach. The existing CSS is well-structured with custom properties. Not worth the churn. |

## New Database Objects Required

### Tables

```sql
-- Settlement breakdown for reporting
CREATE TABLE public.settlement_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES betting_users(id),
  gross_pnl NUMERIC(15,2) NOT NULL,
  commission_amount NUMERIC(15,2) DEFAULT 0,
  net_payout NUMERIC(15,2) NOT NULL,
  exposure_locked NUMERIC(15,2) NOT NULL,
  market_type VARCHAR(10) NOT NULL CHECK (market_type IN ('MATCH', 'FANCY')),
  settled_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, user_id)
);

ALTER TABLE public.settlement_results ENABLE ROW LEVEL SECURITY;

-- Agents can see their clients' results; admins can see all
CREATE POLICY "agent_sees_client_settlements" ON public.settlement_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM betting_users bu
      WHERE bu.id = settlement_results.user_id
      AND (bu.parent_id = auth.uid() OR auth.uid() = settlement_results.user_id)
    )
    OR EXISTS (
      SELECT 1 FROM betting_users admin WHERE admin.id = auth.uid() AND admin.role = 'ADMIN'
    )
  );
```

### Transaction Type Addition

The `credit_transactions.transaction_type` currently supports: `DEPOSIT`, `WITHDRAWAL`, `SETTLEMENT`, `ADMIN_MINT`.

Add: `COMMISSION` -- for commission ledger entries that are separate from settlement payouts.

```sql
-- No schema change needed -- transaction_type is VARCHAR(50), not an enum.
-- Just use 'COMMISSION' as the type value in INSERT statements.
```

### PostgreSQL Functions (RPCs)

Two SECURITY DEFINER functions to replace the client-side settlement code:

1. `settle_match_market(p_event_id UUID, p_winning_outcome_id UUID)` -- returns JSON summary
2. `settle_fancy_market(p_event_id UUID, p_result_value NUMERIC)` -- returns JSON summary

These functions will:
- Run inside a single transaction (automatic in PL/pgSQL)
- Read commission rates from `betting_users` (not from client parameters)
- Calculate per-user P&L using the existing exposure model
- Insert `SETTLEMENT` credit_transactions (payout)
- Insert `COMMISSION` credit_transactions (separate entry)
- Insert `settlement_results` rows (for reporting)
- Update user balances atomically
- Return a JSON summary for the admin UI to display

### Notes Column on credit_transactions

Already exists: the `notes` column is used in current settlement code (`notes: 'Match settled: ...'`). The schema in `admin_schema_update.sql` does not show it, but the code writes to it. Verify this column exists in production; if not:

```sql
ALTER TABLE public.credit_transactions
ADD COLUMN IF NOT EXISTS notes TEXT;
```

## Supporting Libraries

None required. The entire milestone can be implemented with:

1. **PostgreSQL PL/pgSQL** -- built into Supabase, no installation
2. **ES Modules** -- built into browsers, no installation
3. **Supabase JS SDK v2** -- already loaded via CDN
4. **CSS custom properties** -- already in use

This is intentional. The project constraint is "no frameworks, no build tools." Every recommendation uses native platform capabilities.

## Installation

```bash
# No new packages needed for production.
# The existing setup works:
# - Frontend: static HTML/CSS/JS served from Hostinger
# - Backend: Supabase (managed PostgreSQL + Auth + Realtime)
# - Local dev: python3 -m http.server 3000

# Database changes are applied via Supabase SQL Editor:
# 1. Create settlement_results table
# 2. Create settle_match_market() function
# 3. Create settle_fancy_market() function
# 4. Add RLS policies
```

## Migration Path: auth.js to ES Module

The existing `auth.js` is loaded via `<script src="auth.js">` (classic script). Converting it to an ES module requires:

1. Add `export` to AuthSystem
2. Change `<script src="auth.js">` to `<script type="module" src="js/auth.js">`
3. Other modules `import { AuthSystem } from './auth.js'`

**BUT:** The existing HTML pages reference `window.AuthSystem` and `window.supabaseClient` extensively. A gradual migration keeps these on `window` while also exporting them:

```javascript
// js/supabase.js (new)
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { /* ... */ });
window.supabaseClient = sb; // backward compat
export { sb };

// js/auth.js (migrated)
import { sb } from './supabase.js';
export const AuthSystem = { /* ... */ };
window.AuthSystem = AuthSystem; // backward compat
```

This allows new modules to use clean imports while existing inline code continues to work via `window.*`.

**Confidence: HIGH** -- This is a standard migration pattern for going from global scripts to ES modules.

## Sources

- MDN Web Docs: JavaScript Modules Guide (verified via WebFetch) -- ES module syntax, browser support, import maps
- Supabase documentation: Database Functions (SECURITY DEFINER RPCs) -- referenced in existing codebase (INTEGRATIONS.md mentions `platform_reset()`)
- Existing codebase analysis: admin.html settlement code (lines 2827-2952), agent.html P&L code (lines 1183-1243), schema.sql, update_commissions.sql, admin_schema_update.sql
- PROJECT.md: Commission rules (match: losses only, fancy: total volume, agent shares cost)

## Confidence Summary

| Decision | Confidence | Basis |
|----------|------------|-------|
| PostgreSQL RPCs for settlement | HIGH | Standard pattern, already referenced in codebase, transactional safety is non-negotiable for financial ops |
| ES Modules for code splitting | HIGH | MDN-verified universal browser support, no build tools needed, works on static hosting |
| `settlement_results` table for P&L | HIGH | Standard financial reporting pattern, solves the current "estimated commission" inaccuracy |
| Incremental migration (not big-bang) | HIGH | Lower risk, allows feature work and restructuring to happen in parallel |
| Commission formulas (match losses-only, fancy total volume) | MEDIUM | Confirmed in PROJECT.md but need real-world validation during implementation |
| Agent share calculation (can go negative) | MEDIUM | Confirmed in PROJECT.md, standard bookmaking economics, but edge cases need testing |
| Import maps for bare specifiers | LOW | Nice-to-have, not essential. Basic relative imports work fine without them. |
