# Architecture Patterns

**Domain:** Betting exchange commission/P&L system + vanilla JS modularization
**Researched:** 2026-03-25

## Current Architecture Summary

The system is a multi-role static web app: three monolithic HTML files (`admin.html` at 3955 lines, `client.html` at 2086 lines, `agent.html` at 1801 lines) with all CSS and JS inline. A single shared file `auth.js` (242 lines) handles authentication. Supabase provides database, auth, and realtime subscriptions. Deployment is static hosting on Hostinger with no server-side processing or build step.

Settlement currently runs entirely in `admin.html` client-side JavaScript. Commission fields (`match_commission`, `fancy_commission`, `partnership_share`) exist on `betting_users` but are unused at settlement time -- the TODO placeholder `const commission = 0;` sits in `settleFancyMarket()`, and `settleMatchMarket()` has no commission logic at all.

---

## Recommended Architecture

### High-Level Component Map

```
auth.js                  (existing, shared)
  |
  +-- lib/utils.js       (new: sanitize, fmt, timeAgo, showToast, closeModal, openModal)
  +-- lib/supabase.js    (new: db helpers, transaction insertion, balance update)
  +-- lib/commission.js  (new: commission calculation engine)
  +-- lib/pnl.js         (new: P&L aggregation for agent hierarchy)
  |
  +-- admin/
  |     admin-core.js    (init, refreshData, switchTab, global state)
  |     admin-users.js   (user CRUD, rendering)
  |     admin-markets.js (market creation, simulation)
  |     admin-settle.js  (settlement orchestration -- calls commission.js + pnl.js)
  |     admin-ledger.js  (ledger, betlog, audit, CSV exports)
  |     admin-agents.js  (agent settlement cards, recording)
  |     admin.css        (extracted from inline styles)
  |
  +-- client/
  |     client-core.js   (init, refreshData, realtime, global state)
  |     client-markets.js(market rendering, bet slip)
  |     client-portfolio.js (positions, live P&L, exits)
  |     client-history.js(history tab, account tab)
  |     client.css       (extracted from inline styles)
  |
  +-- agent/
        agent-core.js    (init, refreshData, global state)
        agent-clients.js (client management, create/edit)
        agent-pnl.js     (P&L view -- calls lib/pnl.js)
        agent-settle.js  (settlement view, outstanding calc)
        agent.css        (extracted from inline styles)
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `auth.js` | Session, login/logout, role redirect, session timeout | All pages (loaded first) |
| `lib/utils.js` | Pure utility functions: `sanitize`, `fmt`, `timeAgo`, `showToast`, `openModal`, `closeModal` | All pages |
| `lib/supabase.js` | DB read/write helpers: `updateBalance(userId, delta)`, `insertTransaction(...)`, `fetchUserWithParent(id)` | Settlement, funds, P&L |
| `lib/commission.js` | Commission calculation: `calcMatchCommission(userOrders, commRate)`, `calcFancyCommission(userOrders, commRate)` | Settlement (admin), bet slip preview (client) |
| `lib/pnl.js` | Agent P&L aggregation: `calcAgentPnL(agentId, settledEvents, orders, transactions)` | Agent dashboard, admin agent-settlement |
| `admin/admin-settle.js` | Settlement orchestration: fetch orders, call commission engine, create SETTLEMENT + COMMISSION transactions, update balances, calculate agent P&L | `lib/commission.js`, `lib/pnl.js`, `lib/supabase.js` |
| `admin/admin-*.js` | Feature modules scoped to admin role | `admin-core.js` for shared state |
| `client/client-*.js` | Feature modules scoped to client role | `client-core.js` for shared state |
| `agent/agent-pnl.js` | Read-only P&L view using shared calculation | `lib/pnl.js` |

---

## Commission Calculation Engine (`lib/commission.js`)

### Data Flow: Commission at Settlement

```
Admin clicks "Settle Market"
  |
  v
admin-settle.js: settleMatchMarket() / settleFancyMarket()
  |
  +-- Fetch all OPEN orders for event
  +-- Group orders by user_id
  |
  +-- For each user:
  |     |
  |     +-- Fetch user's commission rates from betting_users
  |     |     (match_commission, fancy_commission)
  |     |
  |     +-- Calculate gross P&L (existing exposure model)
  |     |     MATCH: netPnl = favTeamWon ? fw : fl
  |     |     FANCY: isWin ? stake * bp : 0
  |     |
  |     +-- Calculate commission:
  |     |     MATCH: commission = max(0, -netPnl) * (match_commission / 100)
  |     |            (% on LOSSES only -- netPnl negative = client lost)
  |     |     FANCY: commission = totalVolume * (fancy_commission / 100)
  |     |            (% on total volume played, regardless of win/loss)
  |     |
  |     +-- Settlement amount = exposure + netPnl (unchanged)
  |     +-- Insert SETTLEMENT credit_transaction (full payout)
  |     +-- Insert COMMISSION credit_transaction (separate, negative amount)
  |     +-- Update balance: += settleAmt - commissionAmt
  |     |
  |     +-- Build per-user settlement record for agent P&L
  |
  +-- For each agent (via parent_id lookup):
        |
        +-- Aggregate all client results in this market
        +-- Calculate agent P&L share (partnership_share %)
        +-- Store/display agent P&L per market
```

### Commission Calculation Functions

```javascript
// lib/commission.js

/**
 * MATCH commission: percentage on client LOSSES only.
 * If client won (netPnl > 0), commission is zero.
 * If client lost (netPnl < 0), commission = |netPnl| * rate.
 */
function calcMatchCommission(netPnl, commissionRate) {
  if (netPnl >= 0) return 0;
  return Math.abs(netPnl) * (commissionRate / 100);
}

/**
 * FANCY commission: percentage on total volume (sum of stakes).
 * Applied regardless of win/loss outcome.
 */
function calcFancyCommission(totalVolume, commissionRate) {
  return totalVolume * (commissionRate / 100);
}
```

### Commission as Separate Ledger Entry

The PROJECT.md decision is clear: commission is NOT deducted from payout. It is a separate `COMMISSION` transaction. This means:

1. `SETTLEMENT` transaction: full payout amount (exposure + netPnl)
2. `COMMISSION` transaction: negative amount (deducted from balance)
3. Client sees both entries in their ledger for transparency

This requires adding `'COMMISSION'` to the `credit_transactions.transaction_type` enum. The existing CHECK constraint on transaction_type (if any) or display logic must be updated. Currently the type column is `VARCHAR(50)` with no CHECK constraint, so new types can be inserted freely.

---

## Agent P&L Hierarchy (`lib/pnl.js`)

### Data Flow: Agent P&L Calculation

```
Market settles (per user results computed above)
  |
  v
For each settled user, look up parent_id (agent)
  |
  v
Group results by agent_id:
  +-- client_wins: sum of positive netPnl across clients
  +-- client_losses: sum of negative netPnl across clients (absolute value)
  +-- commission_earned: sum of all client commissions in this market
  +-- agent_commission_cost: commission_earned * (agent.partnership_share / 100)
  |     (Agent bears their share % of commission cost)
  |
  v
Agent net P&L per market:
  agent_pnl = -(client_net_pnl) * (partnership_share / 100)
            - agent_commission_cost
  |
  (If clients net won, agent owes upward. Agent can go negative.)
  |
  v
Display in agent dashboard: summary + per-market expandable rows
```

### Key Insight: Agent as Counter-Party

The agent is effectively the counter-party to their clients. When clients win, the agent loses (proportional to partnership_share). When clients lose, the agent profits. Commission is an additional cost the agent bears at their share percentage.

```javascript
// lib/pnl.js

/**
 * Calculate agent P&L for a single settled market.
 *
 * @param {Object[]} clientResults - Array of { userId, netPnl, commission }
 * @param {number} partnershipShare - Agent's share % (0-100)
 * @returns {Object} { grossPnl, commissionCost, netPnl, clientBreakdown }
 */
function calcAgentMarketPnL(clientResults, partnershipShare) {
  const shareRate = partnershipShare / 100;

  let totalClientPnl = 0;
  let totalCommission = 0;

  const breakdown = clientResults.map(cr => {
    totalClientPnl += cr.netPnl;
    totalCommission += cr.commission;
    return {
      userId: cr.userId,
      clientPnl: cr.netPnl,
      agentShare: -(cr.netPnl) * shareRate,
      commissionCost: cr.commission * shareRate,
    };
  });

  // Agent P&L is inverse of client P&L, scaled by share
  const grossPnl = -(totalClientPnl) * shareRate;
  const commissionCost = totalCommission * shareRate;
  const netPnl = grossPnl - commissionCost;

  return { grossPnl, commissionCost, netPnl, clientBreakdown: breakdown };
}
```

### Where Agent P&L Gets Stored/Displayed

Two options, recommend Option A:

**Option A: Compute at display time (recommended).** Agent P&L is derived from existing data (orders, credit_transactions, betting_users). No new table needed. The `lib/pnl.js` functions query settled orders grouped by `parent_id`, compute on the fly. This is consistent with the current pattern where all balances and stats are computed from raw transactions.

Rationale: The data volume is small (dozens of agents, hundreds of clients, thousands of orders at most). Client-side computation is fast. Adding a denormalized table creates sync risk.

**Option B: Persist at settlement time.** Create an `agent_market_pnl` table, insert a row per agent per settled market. Faster reads, but adds write complexity and another table to maintain.

Avoid Option B unless performance becomes an issue, which is unlikely at this scale.

---

## Vanilla JS Modularization Strategy

### Constraint: No Build Step

The project deploys to Hostinger static hosting. There is no bundler, no Node.js server, no transpilation. All modularization must work with plain `<script>` tags loaded by the browser.

### Approach: Script-Tag Modules with Namespace Convention

Do NOT use ES modules (`<script type="module">`) because:

1. ES modules enforce CORS -- loading `file:///` during local dev would break without a dev server.
2. ES modules are `defer` by default and have different scoping rules that would require rewriting all global state access patterns.
3. The existing Supabase CDN script and `auth.js` use classic script loading. Mixing module/non-module scripts creates ordering complexity.

Instead, use **classic `<script>` tags** with a **namespace convention**:

```html
<!-- admin.html -->
<head>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="auth.js"></script>
  <link rel="stylesheet" href="admin/admin.css">
</head>
<body>
  <!-- HTML structure stays in admin.html, but drastically reduced -->

  <!-- Shared libs first -->
  <script src="lib/utils.js"></script>
  <script src="lib/supabase.js"></script>
  <script src="lib/commission.js"></script>
  <script src="lib/pnl.js"></script>

  <!-- Role-specific modules -->
  <script src="admin/admin-core.js"></script>
  <script src="admin/admin-users.js"></script>
  <script src="admin/admin-markets.js"></script>
  <script src="admin/admin-settle.js"></script>
  <script src="admin/admin-ledger.js"></script>
  <script src="admin/admin-agents.js"></script>
</body>
```

### Namespace Convention

Each module attaches to a shared namespace to avoid global pollution while staying accessible:

```javascript
// lib/utils.js
window.BX = window.BX || {};
BX.sanitize = function(str) { /* ... */ };
BX.fmt = function(n, d) { /* ... */ };
BX.showToast = function(msg, type) { /* ... */ };

// admin/admin-core.js
window.Admin = window.Admin || {};
Admin.state = { allEvents: [], allOutcomes: [], allTransactions: [], allUsers: [] };
Admin.refreshData = async function() { /* ... */ };
Admin.switchTab = function(tabId) { /* ... */ };
```

### What Stays in HTML

The HTML files retain:
- `<head>` with CDN scripts, auth.js, CSS links
- All `<body>` markup (headers, sidebars, tabs, modals)
- `<script>` tags at bottom loading the JS modules
- An `init()` call: `<script>document.addEventListener('DOMContentLoaded', Admin.init);</script>`

What gets extracted:
- ALL `<style>` blocks --> `role/role.css`
- ALL `<script>` logic --> `role/role-*.js` + `lib/*.js`

### Extraction Order (Safe Incremental Path)

Modularization must be done incrementally to avoid a big-bang rewrite:

1. **Extract shared utilities first** (`lib/utils.js`): Functions that exist identically in all three HTML files -- `sanitize`, `fmt`, `timeAgo`, `showToast`, `openModal`, `closeModal`. Zero behavioral change. Remove duplicates from HTML files, add `<script src="lib/utils.js">`.

2. **Extract CSS second** (`role/role.css`): Cut the entire `<style>` block from each HTML file into a corresponding CSS file. Add `<link rel="stylesheet">`. Zero behavioral change.

3. **Extract commission/P&L libs** (`lib/commission.js`, `lib/pnl.js`): These are new code, so they start as standalone files from day one. No extraction needed, just write them fresh.

4. **Extract role JS tab-by-tab**: Each tab's render function + helpers become a separate file. Start with the least-coupled tabs (e.g., `admin-ledger.js` has minimal state dependencies) and work toward the most-coupled (e.g., `admin-settle.js` touches many global vars).

---

## Data Flow: Full Settlement with Commission + Agent P&L

This is the complete flow showing all new components interacting:

```
1. Admin clicks "Settle Market" for event E
   |
2. admin-settle.js: submitSettle(eventId)
   |
3. Fetch event, outcomes, all OPEN orders for event
   |
4. Mark event as SETTLED, mark winning outcome
   |
5. FOR EACH USER with orders:
   |  a. Compute netPnl via existing exposure model
   |  b. Fetch user's betting_users row (match_commission, fancy_commission, parent_id)
   |  c. Call lib/commission.js:
   |     - MATCH: calcMatchCommission(netPnl, user.match_commission)
   |     - FANCY: calcFancyCommission(totalVolume, user.fancy_commission)
   |  d. Update balance: += exposure + netPnl - commission
   |  e. Insert SETTLEMENT transaction (amount = exposure + netPnl)
   |  f. Insert COMMISSION transaction (amount = -commission, if commission > 0)
   |  g. Mark orders SETTLED
   |  h. Collect { userId, parentId, netPnl, commission } for agent P&L
   |
6. GROUP settlement results by parentId (agent):
   |  a. For each agent, call lib/pnl.js: calcAgentMarketPnL(clientResults, agent.partnership_share)
   |  b. Display summary in settle confirmation toast/modal
   |  c. Agent P&L data is now queryable from existing tables for agent dashboard
   |
7. Audit log entry with commission totals
   |
8. refreshData() -> all dashboards update via Supabase Realtime
```

### Data Flow: Agent Views Their P&L

```
1. Agent opens P&L tab
   |
2. agent-pnl.js: renderPnL()
   |
3. Fetch all settled events
   |
4. For each settled event:
   |  a. Fetch orders where user_id IN (agent's client IDs)
   |  b. Fetch SETTLEMENT + COMMISSION transactions for those users
   |  c. Call lib/pnl.js: calcAgentMarketPnL(clientResults, agent.partnership_share)
   |  d. Render summary row (expandable to per-client detail)
   |
5. Aggregate all markets for total P&L
   |
6. Display: total wins, total losses, total commission cost, net P&L
```

---

## Suggested Build Order

Dependencies flow bottom-up. Build in this order:

```
Phase/Step 1: lib/utils.js
  (Extract from all 3 HTML files. Unblocks everything.)
  Depends on: nothing
  Blocks: everything else

Phase/Step 2: lib/commission.js
  (Pure calculation functions. No DB access. Fully testable.)
  Depends on: nothing
  Blocks: admin-settle.js changes, client bet slip preview fix

Phase/Step 3: admin-settle.js commission integration
  (Wire commission into settleMatchMarket + settleFancyMarket)
  Depends on: lib/commission.js
  Blocks: agent P&L (needs real commission data)

Phase/Step 4: lib/pnl.js + agent-pnl.js
  (Agent P&L calculation + rendering)
  Depends on: commission working at settlement
  Blocks: nothing (end-of-chain)

Phase/Step 5: CSS extraction
  (Can happen in parallel with steps 2-4)
  Depends on: nothing
  Blocks: nothing (cosmetic)

Phase/Step 6: Remaining JS extraction (admin, client, agent modules)
  (Big refactor, do after commission/P&L are stable)
  Depends on: lib/utils.js extracted, commission/P&L settled
  Blocks: nothing (cleanup/maintainability)
```

### Critical Path

```
lib/utils.js --> lib/commission.js --> admin-settle.js --> lib/pnl.js + agent-pnl.js
```

CSS extraction and remaining JS modularization are parallel tracks that do not block commission/P&L functionality.

---

## Patterns to Follow

### Pattern 1: Namespace Module

Every extracted JS file follows this pattern:

```javascript
// lib/commission.js
(function() {
  'use strict';
  window.BX = window.BX || {};

  BX.calcMatchCommission = function(netPnl, commissionRate) {
    if (netPnl >= 0) return 0;
    return Math.abs(netPnl) * (commissionRate / 100);
  };

  BX.calcFancyCommission = function(totalVolume, commissionRate) {
    return totalVolume * (commissionRate / 100);
  };
})();
```

IIFE prevents accidental globals. Attaching to `window.BX` (or `window.Admin`, `window.Agent`, `window.Client`) makes functions accessible across scripts. This is the same pattern `auth.js` already uses with `window.AuthSystem`.

### Pattern 2: Separate Transaction per Concern

Settlement and commission are separate `credit_transactions` rows:

```javascript
// SETTLEMENT: full payout (what client earned/recovered)
await sb.from('credit_transactions').insert({
  sender_id: adminId, receiver_id: userId,
  amount: settleAmt,
  transaction_type: 'SETTLEMENT',
  notes: `Match settled: ${winner} won in ${title}`
});

// COMMISSION: separate deduction (transparency)
if (commission > 0.001) {
  await sb.from('credit_transactions').insert({
    sender_id: userId, receiver_id: adminId,
    amount: commission,
    transaction_type: 'COMMISSION',
    notes: `Match commission: ${commRate}% on loss of ${Math.abs(netPnl)}`
  });
}
```

This matches the project decision: client sees their full payout, then sees the commission as a distinct line item. The `sender_id` on COMMISSION is the client (money flows out), `receiver_id` is admin.

### Pattern 3: Shared State via Core Module

Each role's `*-core.js` owns the global state and exposes it:

```javascript
// admin/admin-core.js
window.Admin = window.Admin || {};
Admin.state = {
  allEvents: [],
  allOutcomes: [],
  allUsers: [],
  allTransactions: [],
  allOrders: [],
  currentUser: null,
};

Admin.refreshData = async function() {
  // Parallel fetch all tables
  const [evRes, ocRes, usRes, txRes, ordRes] = await Promise.all([
    sb.from('events').select('*'),
    sb.from('outcomes').select('*'),
    sb.from('betting_users').select('*'),
    sb.from('credit_transactions').select('*'),
    sb.from('orders').select('*'),
  ]);
  Admin.state.allEvents = evRes.data || [];
  // ... etc
  Admin.renderActiveTab();
};
```

Other admin modules reference `Admin.state.allEvents` instead of a bare `allEvents` global. This is the key migration: bare globals become namespaced properties. This can be done file-by-file without breaking anything -- during migration, you can alias: `const allEvents = Admin.state.allEvents;` at the top of each extracted module for backward compatibility.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: ES Modules on Static Hosting
**What:** Using `<script type="module">` with `import`/`export` syntax.
**Why bad:** Requires CORS headers for local dev, adds `file://` problems, creates hard dependency on serving from HTTP. The existing Supabase CDN and `auth.js` use classic scripts. Mixing module and classic script contexts creates ordering bugs where module code executes after classic code that depends on it.
**Instead:** Use classic `<script>` tags with namespace convention (`window.BX`, `window.Admin`, etc.).

### Anti-Pattern 2: Introducing a Build Step "Just for Modules"
**What:** Adding webpack/vite/esbuild to bundle ES modules.
**Why bad:** Violates the project constraint (no build tools). Adds developer setup complexity. Makes deployment more complex. Creates a dependency on Node.js for builds that Hostinger does not provide.
**Instead:** Stay with classic scripts. The modularization benefit comes from file separation and reduced cognitive load, not from import/export syntax.

### Anti-Pattern 3: Commission Deducted Inside Payout Amount
**What:** `netPayout = grossPayout * (1 - commission / 100)` and inserting one SETTLEMENT transaction.
**Why bad:** Client cannot see their gross payout vs. commission. Breaks the "separate COMMISSION ledger entry" decision. Makes agent P&L calculation harder because commission is hidden inside payout amounts.
**Instead:** Always insert two transactions: SETTLEMENT (full amount) and COMMISSION (separate deduction).

### Anti-Pattern 4: Persisting Agent P&L in a Separate Table
**What:** Creating an `agent_market_pnl` table and writing rows at settlement time.
**Why bad at this scale:** Adds a table to maintain, creates sync risk if settlement is re-run or voided, duplicates data already derivable from orders + credit_transactions + betting_users.
**Instead:** Compute agent P&L on-the-fly from existing data. The computation is O(orders) which is trivially fast for the expected data volume (< 10,000 orders).

### Anti-Pattern 5: Big-Bang Refactor
**What:** Extracting all JS/CSS from all three HTML files in one pass.
**Why bad:** High risk of regressions. Impossible to test incrementally. Every function reference could break.
**Instead:** Extract incrementally: shared utils first, then CSS, then one module at a time. Each extraction is a testable, deployable step.

---

## Scalability Considerations

| Concern | Current (< 50 users) | At 500 users | At 5,000 users |
|---------|----------------------|--------------|----------------|
| Settlement speed | Client-side loop, < 1s | Still fine: ~500 orders max per market | Consider Supabase Edge Function for batch settlement |
| Agent P&L computation | On-the-fly, instant | Fine: derived from < 5K orders | May need server-side aggregation or materialized view |
| Commission accuracy | Float math with toFixed(4) | Adequate | Consider NUMERIC in DB (already DECIMAL(15,2)) |
| File loading | 8 script tags per page | 12-15 script tags | Still fine; concatenation script if needed |
| Realtime updates | Supabase channels | Fine up to ~100 concurrent | May need channel partitioning |

At the current and near-future scale (< 500 users), all computations can run client-side without issue. The architecture supports moving settlement logic to a Supabase Edge Function later if needed, because the commission and P&L calculation functions are isolated in `lib/` and do not depend on DOM.

---

## Database Changes Required

### New Transaction Type

Add `COMMISSION` to the set of known transaction types. No schema migration needed -- `transaction_type` is `VARCHAR(50)` with no CHECK constraint.

However, all code that filters/displays transactions needs updating:

| Location | Current | Change Needed |
|----------|---------|---------------|
| `admin.html` ledger filter dropdown | Lists SETTLEMENT, AGENT_SETTLEMENT, etc. | Add COMMISSION option |
| `admin.html` renderLedger() color map | Maps types to colors | Add COMMISSION color (e.g., `#f59e0b` amber) |
| `client.html` history rendering | `_settlementType()` function | Handle COMMISSION transactions |
| `agent.html` ledger rendering | Shows DEPOSIT, WITHDRAWAL, etc. | Add COMMISSION display |
| `client.html` account stats | `totalWon - totalStaked` | Factor in commission deductions |

### No New Tables Required

Agent P&L is computed from existing data:
- `orders` (who bet what, settled status)
- `credit_transactions` (SETTLEMENT + COMMISSION amounts)
- `betting_users` (parent_id for hierarchy, partnership_share for agent's cut)

---

## File Structure After Modularization

```
/tmp/bhandai-rebuild/
  index.html                  # Login page (unchanged)
  auth.js                     # Shared auth (unchanged)
  admin.html                  # Admin -- HTML/markup only (~800 lines after extraction)
  client.html                 # Client -- HTML/markup only (~500 lines)
  agent.html                  # Agent -- HTML/markup only (~400 lines)
  |
  lib/
    utils.js                  # sanitize, fmt, timeAgo, showToast, modal helpers
    supabase.js               # DB helper wrappers (updateBalance, insertTx)
    commission.js              # Commission calculation (pure functions)
    pnl.js                    # Agent P&L calculation (pure functions)
  |
  admin/
    admin.css                 # Extracted admin styles
    admin-core.js             # State, init, refreshData, switchTab
    admin-users.js            # User CRUD, rendering
    admin-markets.js          # Market creation, sim
    admin-settle.js           # Settlement with commission
    admin-ledger.js           # Ledger, betlog, audit, exports
    admin-agents.js           # Agent settlement cards
  |
  client/
    client.css                # Extracted client styles
    client-core.js            # State, init, refreshData, realtime
    client-markets.js         # Market rendering, bet slip, commission preview
    client-portfolio.js       # Positions, live P&L, exits
    client-history.js         # History, account
  |
  agent/
    agent.css                 # Extracted agent styles
    agent-core.js             # State, init, refreshData
    agent-clients.js          # Client management
    agent-pnl.js              # P&L dashboard (per-market, per-client)
    agent-settle.js           # Settlement view, outstanding calc
  |
  schema.sql                  # Base schema (unchanged)
  *.sql                       # Migrations (unchanged)
```

Estimated line counts after extraction: HTML files shrink by ~75% (markup only), JS modules are 100-400 lines each (cognitively manageable), CSS files are 200-500 lines each.

---

## Sources

- Direct codebase analysis of `admin.html` (3955 lines), `client.html` (2086 lines), `agent.html` (1801 lines), `auth.js` (242 lines)
- Schema from `schema.sql`, `update_commissions.sql`, `admin_schema_update.sql`
- Settlement logic examined at `admin.html:2827-2952` (settleMatchMarket + settleFancyMarket)
- Commission TODO at `admin.html:2921` (`const commission = 0;`)
- Agent P&L rendering at `agent.html:1183-1248` (current volume-based estimate)
- Commission validation at `admin.html:2285-2294`, `agent.html:1503-1506`
- Confidence: HIGH (based entirely on codebase analysis, no external sources needed for architecture)
