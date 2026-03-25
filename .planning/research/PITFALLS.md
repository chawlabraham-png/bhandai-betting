# Domain Pitfalls

**Domain:** Betting exchange commission/P&L hierarchy + JS monolith modularization
**Researched:** 2026-03-25
**Overall confidence:** HIGH (pitfalls derived from direct codebase analysis + domain expertise)

---

## Critical Pitfalls

Mistakes that cause rewrites, financial errors, or major regressions.

---

### Pitfall 1: Non-Atomic Balance Updates Corrupt Balances During Settlement

**What goes wrong:** Settlement reads a user's balance, computes a new value in JS, then writes it back. If two settlements run concurrently (or an admin deposits while settlement runs), the second write silently overwrites the first. Money appears or vanishes.

**Why it happens:** The current settlement code does `SELECT balance` then `UPDATE balance = newBal` as two separate Supabase calls from the client. There is no transaction, no `UPDATE ... SET balance = balance + amount`, and no server-side function. This is a textbook read-modify-write race condition.

**Evidence in code:**
- `admin.html:2874-2875`: `const newBal = parseFloat(userRow?.balance || 0) + settleAmt;` followed by `await sb.from('betting_users').update({ balance: newBal }).eq('id', userId);`
- Same pattern at lines 2931-2932 (fancy settlement), 3073-3074 (match result declaration), and 3583-3584 (void refunds)
- No Supabase RPC function wrapping these in a transaction

**Consequences:** Corrupted balances. A client could lose payout money or receive double payouts. In a commission system that reads balance state, incorrect balances cascade into wrong commission calculations.

**Prevention:**
1. Create a Supabase RPC function: `adjust_balance(user_id UUID, delta NUMERIC)` that does `UPDATE betting_users SET balance = balance + delta WHERE id = user_id RETURNING balance`
2. Use this RPC for ALL balance mutations: settlement, deposits, withdrawals, commission deductions
3. The commission feature must NOT repeat this pattern -- it must use the same atomic function

**Detection:** Balances that don't reconcile against the credit_transactions ledger sum. Add a reconciliation check: `balance == SUM(credits) - SUM(debits)` from credit_transactions.

**Phase relevance:** Must be fixed BEFORE commission is added. Commission creates more balance mutations, multiplying the race window. Fix in the commission implementation phase.

---

### Pitfall 2: Commission Deducted From Payout Instead of Recorded as Separate Ledger Entry

**What goes wrong:** The natural impulse is to compute `netPayout = grossPayout - commission` and credit only the net amount. PROJECT.md explicitly requires commission as a SEPARATE ledger entry -- the client sees full payout, then a separate commission line item. If commission is baked into the payout amount, there is no audit trail, the agent P&L view cannot distinguish commission from P&L, and the client sees a number that doesn't match their expected winnings.

**Why it happens:** The existing fancy settlement code already has the wrong pattern scaffolded: `const netPayout = grossPayout * (1 - commission / 100)` at line 2929. This computes a net amount and credits only that. When someone fills in the `commission = 0` TODO, they will naturally use this existing pattern -- and it violates the requirement.

**Evidence in code:**
- `admin.html:2921`: `const commission = 0; // TODO: apply user commission when client is built`
- `admin.html:2929`: `const netPayout = grossPayout * (1 - commission / 100);`
- The SETTLEMENT credit_transaction records `netPayout`, not `grossPayout`

**Consequences:** Commission becomes invisible. Agent P&L calculations cannot separate "how much did clients lose" from "how much commission was earned." Disputes with clients become unresolvable because there's no paper trail.

**Prevention:**
1. Settlement credits the FULL payout to the user's balance
2. A separate step deducts commission and creates a `COMMISSION` credit_transaction entry
3. Both operations use the atomic balance RPC
4. The `credit_transactions` table needs a new `transaction_type` value: `'COMMISSION'`
5. Commission entries reference the event_id so they can be traced to a specific market

**Detection:** If `credit_transactions` has no rows with `transaction_type = 'COMMISSION'` after settlement, the implementation is wrong.

**Phase relevance:** Core commission implementation phase. This is the #1 design decision that shapes everything downstream.

---

### Pitfall 3: Match Commission Applied to Gross P&L Instead of Losses Only

**What goes wrong:** Match commission in Indian bookmaking is charged on CLIENT LOSSES ONLY. If a client nets +500 on a match, they owe zero commission. If they net -300, they owe `300 * commission_rate`. A common mistake is applying commission to total volume, total stakes, or the absolute P&L value -- which overcharges winning clients and breaks the business model.

**Why it happens:** The agent.html P&L view already makes this mistake: `const estComm = totalVol * mComm` (line 1186) -- it estimates commission as a percentage of total volume, not of losses. This incorrect calculation will be copied into the real settlement logic if not caught.

**Evidence in code:**
- `agent.html:1186`: `const estComm = totalVol * mComm;` -- wrong, applies to volume not losses
- `agent.html:1211`: `const cComm = cVol * mComm;` -- same mistake per-client
- `agent.html:1244`: `fmt(vol*mComm)` -- same mistake per-market
- Fancy commission IS correctly per-volume per PROJECT.md, but match commission is not

**Consequences:** Clients are overcharged on matches where they won. Trust is destroyed. Agents who understand Indian bookmaking will immediately flag this as broken.

**Prevention:**
1. Match settlement must compute NET P&L per user first (`exposure + netPnl`)
2. If netPnl < 0 (client lost), commission = `|netPnl| * match_commission_rate`
3. If netPnl >= 0 (client won), commission = 0 for match bets
4. Fancy settlement: commission = `total_volume * fancy_commission_rate` (regardless of outcome)
5. Fix the agent.html P&L estimates to use the correct formula even before real commission lands

**Detection:** Any commission ledger entry where the associated user has positive net P&L on that market (for match bets) indicates a bug.

**Phase relevance:** Commission implementation phase. Must be validated with manual test cases before deployment.

---

### Pitfall 4: Agent Share Calculated on Commission Only, Not on Full Client P&L

**What goes wrong:** The agent "partnership share" (stored as `partnership_share` in `betting_users`) means the agent bears X% of the entire client P&L position, not just X% of commission. If Client A loses 1000 and agent has 80% share, the agent absorbs 800 of that loss (house absorbs 200). The commission is a separate calculation on top. A common mistake is treating share % as "agent gets X% of the commission revenue" instead of "agent bears X% of client economics."

**Why it happens:** The field is labeled "Agent's % share of P&L" in the UI (admin.html:950, 1042) which is correct, but the PROJECT.md description says "Agent bears share % of commission cost (80% share = 80% of commission paid)" which conflates the two concepts. Both the P&L share AND commission share need to be calculated.

**Evidence in code:**
- `admin.html:950`: `Agent's % share of P&L -- used in settlement calculations`
- `PROJECT.md:39`: `Agent bears share % of commission cost`
- No settlement code currently uses `partnership_share` at all -- it's display-only
- Agent settlement tab (`renderSettlement`) computes outstanding purely from chip flows, not P&L

**Consequences:** If agent share only applies to commission, the platform loses the core risk-sharing model. The admin absorbs 100% of client wins/losses while agents earn risk-free commission -- completely wrong for Indian bookmaking economics.

**Prevention:**
1. At settlement time, for each market, compute per-agent: `agent_pnl = partnership_share * SUM(client_net_pnl for agent's clients)`
2. Commission calculation: `agent_commission_cost = partnership_share * SUM(client_commission for agent's clients)`
3. Store both values in a new `agent_market_settlements` table (agent_id, event_id, client_pnl_share, commission_share, net)
4. Agent can go negative (PROJECT.md:41 confirms this)

**Detection:** If agent P&L report shows positive numbers when all their clients won big, the share model is wrong.

**Phase relevance:** Agent P&L phase. Must be designed alongside commission, not after.

---

### Pitfall 5: Modularization Breaks Shared Mutable State

**What goes wrong:** The three HTML files (admin.html, client.html, agent.html) have thousands of lines of inline JS that rely on module-level variables: `allOrders`, `allEvents`, `allOutcomes`, `allUsers`, `allTransactions`, `currentUser`, `myClients`. Extracting functions into separate `.js` files breaks because these variables are no longer in the same scope. The refactorer either: (a) makes everything `window.X` globals (worse than before), (b) passes 8+ arguments to every function (unusable), or (c) creates circular import issues.

**Why it happens:** Monolithic inline JS naturally accumulates shared state. When splitting, there's no module system (vanilla JS, no build step) so ES module `import/export` with `<script type="module">` is the only option -- but modules have strict scoping that breaks the implicit global sharing.

**Evidence in code:**
- `admin.html` has `let allUsers = [], allTransactions = [], allOrders = [], allEvents = [], allOutcomes = []` as top-level variables
- Nearly every function reads these directly: `renderDashboard()` reads `allTransactions`, `allOrders`, etc.
- `client.html` similarly has `let myOrders = [], allEvents = [], allOutcomes = []`
- No function takes these as parameters -- they're all closures over shared state

**Consequences:** Naive extraction (copy function to separate file) produces runtime errors because variables are undefined. Developer adds `window.` prefix everywhere, which is technically a regression in code quality. Or the refactoring stalls and commission gets added to the monolith, making future extraction even harder.

**Prevention:**
1. Create a `state.js` module that exports a single state object: `export const appState = { users: [], orders: [], ... }`
2. All extracted modules import from `state.js` and read/write through it
3. Use `<script type="module">` for all new files; keep the monolith as a classic script initially
4. Extract in layers: state first, then utilities (fmt, sanitize), then data-fetching, then rendering, then settlement logic
5. DO NOT extract settlement logic until commission is working -- modularization of code you're actively changing creates merge conflicts with yourself

**Detection:** If any extracted file references a variable not imported or passed as argument, it will fail silently (undefined) rather than throwing an error in sloppy mode.

**Phase relevance:** Code restructure phase. Must happen AFTER commission and agent P&L are working, not concurrently.

---

## Moderate Pitfalls

---

### Pitfall 6: Settlement Processes Every User Sequentially With Individual DB Calls

**What goes wrong:** The current settlement loop does N users x M operations per user, each as a separate Supabase REST call. For 50 clients with 3 operations each (update order status, update balance, insert credit_transaction), that's 150 sequential HTTP calls. With commission added (read commission rate, insert commission entry, update balance again), it becomes 250+ calls. Settlement of a large market could take 30-60 seconds and is vulnerable to partial failure (half the users settled, then a network error leaves the rest unsettled).

**Why it happens:** The code was written for small scale (5-10 users) and each step is a simple await. There's no batching, no server-side function, and no transaction rollback.

**Evidence in code:**
- `admin.html:2856-2883`: `for (const [userId, userOrds] of Object.entries(userMap))` with multiple awaits inside
- Each order status update is individual: `await sb.from('orders').update({ status: 'SETTLED' }).eq('id', o.id);` (line 2869)
- No error handling around the loop -- if it fails midway, some users are settled and others aren't

**Prevention:**
1. Create a Supabase RPC function `settle_market(event_id, winning_outcome_id)` that does ALL settlement in a single PostgreSQL transaction
2. The RPC handles: marking orders settled, computing P&L per user, computing commission per user, creating ledger entries, updating balances -- all atomically
3. If any step fails, the entire settlement rolls back
4. Client-side code just calls `sb.rpc('settle_market', {...})` and handles success/failure

**Detection:** Settlement taking more than 5 seconds for a market, or partial settlement visible in the ledger (some users show SETTLEMENT entries, others don't, for the same event).

**Phase relevance:** Commission implementation phase. When adding commission, move settlement to an RPC instead of adding more client-side loops.

---

### Pitfall 7: Fancy Commission on Volume vs. Match Commission on Losses Creates Split Logic Bugs

**What goes wrong:** Two different commission formulas coexist: match (% of losses) and fancy (% of volume). Code that processes "commission" generically -- without checking market type -- applies the wrong formula. For example, a shared `calculateCommission(user, market)` function that doesn't branch on `market_type` will either overcharge match bettors or undercharge fancy bettors.

**Why it happens:** Developers abstract prematurely. "Commission is a percentage" seems uniform, but the BASE that the percentage applies to is completely different between market types.

**Evidence in code:**
- `client.html:1402-1404` already reads commission rate by market type: `bsState.isFancy ? fancy_commission : match_commission` -- but this is just for display
- Settlement functions are entirely separate: `settleMatchMarket()` and `settleFancyMarket()` -- this separation is actually good and should be preserved
- The agent P&L view (agent.html:1185-1186) uses only `match_commission` for all estimates, ignoring fancy_commission entirely

**Prevention:**
1. Keep match and fancy settlement as separate code paths -- do NOT merge them into a generic function
2. Each path computes its own commission base (losses for match, volume for fancy)
3. The commission entry in credit_transactions should include the market_type in notes so it's auditable
4. Agent P&L calculations must separate match commission earned vs. fancy commission earned

**Detection:** Commission amounts that don't match when manually computed. Unit test: place a winning match bet and verify commission is zero; place any fancy bet and verify commission is always charged.

**Phase relevance:** Commission implementation phase.

---

### Pitfall 8: Agent P&L Computed From Chip Flows Instead of Bet Outcomes

**What goes wrong:** The current agent settlement/P&L view computes "outstanding" from chip deposits, withdrawals, and returns -- essentially a cash-flow reconciliation. This does NOT reflect actual P&L from bet outcomes. An agent whose clients are up 5000 in unrealized wins but have only been deposited 1000 in chips shows as "outstanding: 1000" instead of "underwater by 4000."

**Why it happens:** Before commission and share logic exist, chip flow is the only data available. But extending this approach to commission/P&L creates numbers that have nothing to do with actual betting economics.

**Evidence in code:**
- `admin.html:3244-3264`: `renderSettlement()` computes outstanding purely from DEPOSIT, WITHDRAWAL, AGENT_SETTLEMENT transaction types
- `agent.html:920-936`: Dashboard settled P&L uses `clientStaked - clientPayouts` which is closer to correct but still doesn't incorporate commission or agent share
- No per-market P&L breakdown exists anywhere

**Prevention:**
1. Create a `agent_market_settlements` table that stores per-agent, per-event: total_client_stakes, total_client_payouts, client_net_pnl, commission_earned, agent_share_pnl, agent_share_commission
2. Populate this at settlement time, not derived from transactions
3. Agent P&L view reads from this table, not from filtering credit_transactions
4. Admin's agent settlement view also uses this table for the "agent owes" / "admin owes" calculation

**Detection:** Agent P&L numbers that don't change after a market is settled indicate the view is still reading from chip flows.

**Phase relevance:** Agent P&L phase. The table design should be planned during commission phase.

---

### Pitfall 9: Extracting Inline CSS Before JS Creates a False Sense of Progress

**What goes wrong:** CSS extraction is easy -- copy `<style>` blocks to `.css` files, add `<link>` tags. It feels productive. But it doesn't reduce the cognitive load of the actual problem (3000+ lines of JS logic per file). Teams spend a sprint extracting CSS, declare "restructuring is 50% done," then realize the hard part (JS extraction) is 100% of the remaining work and has none of the easy patterns.

**Why it happens:** CSS has no dependencies on JS state. It's trivially extractable. The bias toward visible progress makes it tempting to do first.

**Prevention:**
1. Extract JS modules first (state, utilities, data layer, then UI rendering)
2. CSS extraction can happen in parallel or after -- it's a cosmetic improvement, not a structural one
3. Measure restructuring progress by "number of functions extracted from monolith" not "number of files created"

**Detection:** A restructuring phase that produces many `.css` files but the `.html` files still have 2000+ lines of `<script>` blocks.

**Phase relevance:** Code restructure phase. Prioritize JS extraction.

---

### Pitfall 10: ES Modules Break Supabase Client Sharing Across Files

**What goes wrong:** Currently `auth.js` creates `window.supabaseClient` and every inline `<script>` block accesses it as a global. When switching to `<script type="module">`, modules have their own scope. If `auth.js` stays as a classic script and new modules try to import from it, there's a mismatch. If `auth.js` becomes a module, existing inline code that references `window.supabaseClient` breaks.

**Why it happens:** The codebase has a single shared auth pattern (`auth.js` sets globals, pages consume them). ES modules have strict scoping that conflicts with this pattern.

**Evidence in code:**
- `auth.js:12`: `window.supabaseClient = window.supabase.createClient(...)` -- sets a window global
- `auth.js:23`: `window._sbConfig = { url: SUPABASE_URL, key: SUPABASE_KEY }` -- another global
- `auth.js:25`: `window.AuthSystem = { ... }` -- the entire auth API is a global
- Every HTML file does `<script src="auth.js"></script>` and then uses `window.supabaseClient` throughout

**Prevention:**
1. Keep `auth.js` as a classic (non-module) script that sets window globals
2. New extracted modules access the Supabase client via `window.supabaseClient` (acceptable -- it's a singleton service, not mutable state)
3. Do NOT try to convert `auth.js` to an ES module until ALL pages are modularized
4. If creating a `db.js` wrapper module, have it simply re-export: `export const sb = window.supabaseClient`

**Detection:** Console errors like `supabaseClient is not defined` or `Cannot use import statement outside a module` after restructuring.

**Phase relevance:** Code restructure phase.

---

## Minor Pitfalls

---

### Pitfall 11: Commission Rate Changes After Bets Are Placed But Before Settlement

**What goes wrong:** Commission rates are stored on the `betting_users` record and read at settlement time. If an admin changes a client's commission rate between when bets are placed and when the market settles, the client is settled at a rate they didn't agree to.

**Prevention:**
1. Store the commission rate at bet-placement time on the order record (`match_commission_at_bet`, `fancy_commission_at_bet`)
2. Settlement reads the rate from the order, not from the user record
3. Alternatively, accept this as a known trade-off and document that commission rate is always applied at settlement time (simpler, and common in Indian bookmaking where rates can be adjusted mid-event)

**Phase relevance:** Commission implementation phase. Decide which approach upfront.

---

### Pitfall 12: DECIMAL(5,2) Truncates High-Volume Commission Calculations

**What goes wrong:** The `match_commission` and `fancy_commission` fields are `DECIMAL(5,2)`, which supports values up to 999.99. This is fine for percentage storage (0-100). But if commission amounts are ever stored in these fields or calculated with intermediate multiplication, precision loss can occur with JS floating point.

**Prevention:**
1. Use `toFixed(2)` and `parseFloat` consistently (the codebase already does this for most amounts)
2. Commission amounts stored in credit_transactions use `DECIMAL(15,2)` which is fine
3. When computing commission: `Math.round(base * rate * 100) / 100` to avoid floating point drift

**Phase relevance:** Commission implementation phase.

---

### Pitfall 13: Agent Dashboard Goes Mobile Before P&L Logic Is Correct

**What goes wrong:** Making agent.html mobile-responsive while the P&L numbers are placeholder calculations (volume-based commission estimates, no real share computation) means the mobile UI is built around wrong numbers. When real P&L lands, the layout assumptions may not hold (negative numbers need different styling, more columns needed, etc.).

**Prevention:**
1. Implement commission and agent P&L calculation FIRST
2. Verify the data model is correct on desktop
3. THEN make it mobile-responsive
4. The client.html mobile UI was done correctly because the data model was stable first

**Phase relevance:** Agent mobile UI phase must come AFTER agent P&L phase.

---

### Pitfall 14: Two Source Directories Cause Commission Code to Diverge

**What goes wrong:** CONCERNS.md documents that edits happen in `/private/tmp/bhandai-betting/` and are manually copied to `/tmp/bhandai-rebuild/`. If commission logic is developed in one directory and not copied, the deployed version diverges from the git version. Financial logic divergence is especially dangerous.

**Prevention:**
1. Before starting commission work, consolidate to a single working directory
2. Use git as the single source of truth
3. Deploy directly from the git repo, not from a separate working copy

**Detection:** Running `diff -r` between the two directories and finding differences in settlement or commission code.

**Phase relevance:** Must be resolved BEFORE any commission work begins. Should be Phase 0 / prerequisite.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Commission deduction | Baking commission into payout instead of separate ledger entry (#2) | Design ledger entry format FIRST, then implement settlement changes |
| Commission deduction | Match commission applied to volume instead of losses (#3) | Write test cases for all scenarios before coding |
| Commission deduction | Non-atomic balance updates (#1) | Create RPC function before modifying settlement logic |
| Commission deduction | Sequential DB calls during settlement (#6) | Move settlement to server-side RPC |
| Agent P&L | Share calculated on commission only, not full P&L (#4) | Define the math formula and get sign-off before implementation |
| Agent P&L | P&L computed from chip flows instead of bet outcomes (#8) | Create agent_market_settlements table |
| Agent mobile UI | Building mobile layout around wrong P&L numbers (#13) | Complete P&L logic before mobile work |
| Code restructure | Shared mutable state breaks extraction (#5) | Extract state module first, then functions |
| Code restructure | CSS extraction creating false progress (#9) | Track JS function extraction, not file count |
| Code restructure | ES modules breaking Supabase sharing (#10) | Keep auth.js as classic script |
| Prerequisite | Two source directories (#14) | Consolidate before any commission work |

---

## Recommended Phase Ordering (Based on Pitfall Analysis)

1. **Prerequisite:** Consolidate source directories, create atomic balance RPC
2. **Commission:** Implement commission with separate ledger entries, correct formulas
3. **Agent P&L:** Agent share calculations, agent_market_settlements table
4. **Agent Mobile:** Responsive agent dashboard (P&L data is stable)
5. **Code Restructure:** Extract JS modules from monoliths (no active feature work in flight)

The key insight: commission and code restructure MUST NOT happen concurrently. Adding financial logic to a codebase you're simultaneously modularizing guarantees merge conflicts and regression bugs. Build the features first, verify they're correct, then restructure.

---

## Sources

- Direct codebase analysis of admin.html (3800+ lines), client.html (2000+ lines), agent.html (1800+ lines)
- Schema analysis: schema.sql, admin_schema_update.sql, update_commissions.sql
- PROJECT.md requirements and key decisions
- CONCERNS.md known technical debt
- Domain knowledge: Indian bookmaking commission models (LAGAI/KHAI, match vs. fancy commission structures)

**Confidence:** HIGH -- all pitfalls derived from direct code evidence and documented requirements. No external web sources were available for verification of industry practices, but the commission model described in PROJECT.md is consistent with standard Indian bookmaking practices from training data.
