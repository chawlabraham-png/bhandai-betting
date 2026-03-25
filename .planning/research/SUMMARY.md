# Research Summary

**Project:** Bhandai Betting Exchange -- Commission, Agent P&L, and Code Modularization
**Synthesized:** 2026-03-25

---

## Executive Summary

This project adds financial commission logic, agent profit-and-loss hierarchy, and code modularization to an existing vanilla JS + Supabase betting exchange. The codebase consists of three monolithic HTML files (admin at ~3955 lines, client at ~2086, agent at ~1801) with all JS and CSS inline. Supabase provides PostgreSQL, auth, and realtime. There are no frameworks, no build tools, and deployment is static hosting on Hostinger. The commission fields already exist in the database schema (`match_commission`, `fancy_commission`, `partnership_share` on `betting_users`) but are currently hardcoded to zero at settlement time.

The recommended approach is to move settlement logic from client-side JavaScript into PostgreSQL RPC functions (SECURITY DEFINER), which provides transactional atomicity for balance mutations that currently have dangerous race conditions. Commission is implemented as a separate `COMMISSION` ledger entry (not netted into payouts), with match commission applying to client losses only and fancy commission applying to total volume. Agent P&L uses the `partnership_share` field to compute the agent's proportional exposure to client outcomes -- agents are counter-parties to their clients, bearing risk in proportion to their share percentage. Code modularization uses classic `<script>` tags with a namespace convention (`window.BX`, `window.Admin`, etc.) rather than ES modules, preserving compatibility with the existing `auth.js` global pattern and static hosting constraints.

The primary risks are: (1) non-atomic balance updates during settlement causing financial corruption -- this is an existing bug that commission work will amplify if not fixed first; (2) applying the wrong commission formula (volume-based instead of losses-only for match bets), since the existing agent P&L display already makes this mistake; (3) confusing agent "partnership share" as a commission split rather than a full P&L exposure share; and (4) attempting code restructure concurrently with commission feature work, which guarantees merge conflicts and regressions. All four research files converge on the same phasing: fix atomicity first, build commission, build agent P&L, make agent mobile, then restructure code.

---

## Key Findings

### From STACK.md

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Settlement logic | PostgreSQL RPC functions (PL/pgSQL) | Current client-side settlement does 60+ sequential network calls with no transaction boundary. A single `settle_match_market()` RPC wraps everything in BEGIN...COMMIT. |
| Code modularization | ES Modules via `<script type="module">` | Native browser standard since 2018, no bundler needed, works on static hosting. |
| Agent P&L storage | `settlement_results` table populated at settlement time | Current estimated P&L is wrong (uses volume-based commission). Real numbers must be snapshot at settlement. |
| New transaction type | `COMMISSION` in `credit_transactions` | `transaction_type` is VARCHAR(50), no schema migration needed. Just insert rows with the new type. |
| CSS approach | Shared CSS files extracted from inline `<style>` blocks | CSS custom properties already in use. No preprocessor needed. |
| No new dependencies | Zero new libraries or tools | Everything uses native platform capabilities: PostgreSQL, ES modules, browser CSS. |

**Critical version requirement:** Supabase JS SDK v2 is already loaded via CDN. PostgreSQL functions are built into Supabase managed PostgreSQL. No version upgrades needed.

### From FEATURES.md

**Table Stakes (must-have for correct economics):**
1. Match commission on losses only (industry standard for Indian bookmaking)
2. Fancy commission on total volume (separate formula from match)
3. Commission as separate ledger entry (transparency, not netted into payout)
4. Per-user commission rates (already in schema, just need to be read at settlement)
5. Agent share % of full client P&L (not just commission -- this IS the business model)
6. Agent bears proportional share of commission cost
7. Agent P&L computed per-market at settlement time (snapshot, not retroactive)
8. Agent P&L summary and per-market detail views

**Should-have (differentiators):**
- Real-time agent P&L updates (live exposure tracking during open markets)
- Commission audit trail (rich notes linking commission to specific market/loss)
- Multi-level commission waterfall visibility for admin
- Commission rate change history
- Void market commission reversal

**Defer to v2+:**
- Agent self-service settlement requests (explicitly out of scope per PROJECT.md)
- Historical P&L trending (no value until commission data exists)
- Sub-agent hierarchy (Admin -> Agent -> Sub-Agent -> Client adds exponential complexity)
- Per-bet commission (commission is a settlement-time concept only)

**Anti-features (deliberately do NOT build):**
- Commission deducted from payout (wrong -- it is a separate credit)
- Retroactive commission recalculation (frozen at settlement rate)
- Agent-to-agent transfers (breaks accounting)
- Client-visible commission rate (clients see amounts, not percentages)
- Negative commission / penalties (commission is always >= 0)

### From ARCHITECTURE.md

**Major components and responsibilities:**

| Component | Purpose |
|-----------|---------|
| `lib/utils.js` | Shared pure utilities: sanitize, fmt, timeAgo, showToast, modal helpers |
| `lib/commission.js` | Commission calculation engine: `calcMatchCommission(netPnl, rate)`, `calcFancyCommission(volume, rate)` |
| `lib/pnl.js` | Agent P&L aggregation: `calcAgentMarketPnL(clientResults, partnershipShare)` |
| `admin/admin-settle.js` | Settlement orchestration calling commission + P&L modules |
| `agent/agent-pnl.js` | Agent P&L dashboard reading settlement data |
| `{role}/{role}-core.js` | Per-role state management, init, refreshData, tab switching |

**Key architectural patterns:**
1. **Namespace convention** -- `window.BX` for shared libs, `window.Admin`/`window.Agent`/`window.Client` for role-specific state. IIFE wrapping to prevent accidental globals.
2. **Separate transaction per concern** -- SETTLEMENT and COMMISSION are always distinct `credit_transactions` rows.
3. **Shared state via core module** -- Each role's `*-core.js` owns a `state` object that replaces bare globals during incremental extraction.

**Key architectural decision -- Agent P&L storage:** ARCHITECTURE.md recommends computing agent P&L on-the-fly from existing data (Option A), arguing the data volume is small. STACK.md and PITFALLS.md both recommend a `settlement_results` or `agent_market_settlements` table populated at settlement time (Option B). **I recommend Option B (persist at settlement).** The formulas are non-trivial, the numbers must be auditable, and having a single source of truth for "what happened at settlement" prevents future drift between admin and agent views. The storage cost is negligible.

### From PITFALLS.md

**Top 5 pitfalls with prevention strategies:**

| # | Pitfall | Severity | Prevention |
|---|---------|----------|------------|
| 1 | Non-atomic balance updates corrupt balances during settlement | CRITICAL | Create `adjust_balance(user_id, delta)` RPC that does `SET balance = balance + delta`. Use for ALL balance mutations. Must fix BEFORE adding commission. |
| 2 | Commission baked into payout instead of separate ledger entry | CRITICAL | Always insert two transactions: SETTLEMENT (full amount) + COMMISSION (separate deduction). If no COMMISSION rows exist after settlement, the implementation is wrong. |
| 3 | Match commission applied to volume instead of losses only | CRITICAL | `if (netPnl >= 0) return 0;` -- commission is zero for winning clients on match bets. The existing agent P&L estimate already makes this mistake (`estComm = totalVol * mComm`). |
| 4 | Agent share applied only to commission, not to full client P&L | CRITICAL | Agent bears `partnership_share%` of client NET P&L (win or lose) AND `partnership_share%` of commission cost. These are two separate calculations. |
| 5 | Modularization breaks shared mutable state | CRITICAL | Do NOT restructure code while actively building commission features. Extract state module first, use namespace convention, keep `auth.js` as classic script. |

**Additional moderate pitfalls:** Sequential DB calls creating 250+ HTTP requests per settlement (#6), split logic bugs between match/fancy commission formulas (#7), agent P&L computed from chip flows instead of bet outcomes (#8), two source directories causing code divergence (#14).

---

## Implications for Roadmap

### Recommended Phase Structure

All four research files independently converge on the same ordering. The critical path is: atomicity fix -> commission -> agent P&L -> mobile -> restructure. Commission and code restructure must NOT happen concurrently.

**Phase 0: Prerequisites**
- Consolidate to single working directory (Pitfall #14)
- Create `adjust_balance(user_id, delta)` atomic RPC (Pitfall #1)
- Verify `notes` column exists on `credit_transactions`
- **Rationale:** These are blockers. Adding commission on top of the race condition bug multiplies the damage. Consolidating directories prevents financial logic divergence.
- **Delivers:** Safe foundation for balance mutations
- **Features:** None user-facing; infrastructure only
- **Pitfalls to avoid:** #1 (non-atomic updates), #14 (divergent directories)

**Phase 1: Commission at Settlement**
- Create `settle_match_market()` PostgreSQL RPC with match commission (losses only)
- Create `settle_fancy_market()` PostgreSQL RPC with fancy commission (total volume)
- Create `settlement_results` table for audit/reporting
- Add COMMISSION transaction type to ledger displays (admin, client, agent)
- Replace client-side settlement loops with single `.rpc()` calls
- **Rationale:** Highest business value. The platform's economics are currently wrong -- every settlement ignores commission. Moving to RPCs fixes atomicity (Pitfall #1) and sequential call performance (Pitfall #6) as a byproduct.
- **Delivers:** Correct financial settlement with commission, audit trail, transactional safety
- **Features from FEATURES.md:** Match commission on losses, fancy commission on volume, commission as separate ledger entry, per-user commission rates, commission rate hierarchy enforcement
- **Pitfalls to avoid:** #2 (netting commission into payout), #3 (match commission on volume), #6 (sequential DB calls), #7 (split formula bugs), #11 (rate change timing -- decide snapshot vs. live policy)

**Phase 2: Agent P&L Hierarchy**
- Implement agent share of full client P&L (not just commission)
- Implement agent share of commission cost
- Create agent P&L summary view with real settlement data
- Create per-market and per-client detail views
- Update admin agent settlement cards with share-adjusted numbers
- **Rationale:** Depends on commission data existing. Completes the economic model -- without this, agents cannot know what they owe or are owed.
- **Delivers:** Accurate agent P&L reflecting Indian bookmaking partnership economics
- **Features from FEATURES.md:** Agent share % of client P&L, agent bears share of commission cost, agent P&L per-market detail, agent P&L per-client detail, agent P&L summary view
- **Pitfalls to avoid:** #4 (share on commission only, not full P&L), #8 (P&L from chip flows instead of bet outcomes), #13 (building mobile before data is stable)

**Phase 3: Agent Mobile UI**
- Make agent dashboard mobile-responsive
- Mobile-friendly settlement view
- Mobile-friendly P&L tables (card-based layout on small screens)
- **Rationale:** Agents operate from phones in the field. This is a blocker for real usage. But it MUST come after P&L logic is correct, or the layout will be built around wrong numbers.
- **Delivers:** Usable agent experience on mobile devices
- **Features from FEATURES.md:** Agent dashboard mobile-responsive, mobile-friendly settlement view, mobile-friendly P&L view
- **Pitfalls to avoid:** #13 (mobile before P&L is stable)

**Phase 4: Code Restructure**
- Extract shared utilities (`lib/utils.js`)
- Extract role-specific JS into module files using namespace convention
- Extract inline CSS into shared and role-specific files
- Migrate from bare globals to namespaced state objects
- **Rationale:** Do this AFTER all feature work is stable. Restructuring active code guarantees regressions. The monolith is painful but functional -- adding commission/P&L first is the pragmatic choice.
- **Delivers:** Maintainable codebase with ~100-400 line modules instead of 2000-4000 line monoliths
- **Features from FEATURES.md:** Extract inline JS, extract inline CSS, shared component library
- **Pitfalls to avoid:** #5 (shared state breaks extraction), #9 (CSS extraction creating false progress), #10 (ES modules breaking Supabase sharing)

### Research Flags

| Phase | Needs `/gsd:research-phase`? | Reason |
|-------|------------------------------|--------|
| Phase 0 (Prerequisites) | No | Standard Supabase RPC creation. Well-documented pattern. |
| Phase 1 (Commission) | YES | Commission formulas need validation against real Indian bookmaking rules. The match-on-losses vs. fancy-on-volume distinction is confirmed but edge cases (hedged LAGAI+KHAI positions, partial exits before settlement) need exploration during implementation. PL/pgSQL function authoring may need reference patterns. |
| Phase 2 (Agent P&L) | YES | Agent share math has subtlety -- negative P&L, commission cost as separate line, sign conventions. The `settlement_results` table schema needs precise definition during planning. |
| Phase 3 (Agent Mobile) | No | Proven responsive patterns exist in `client.html`. Replicate approach. |
| Phase 4 (Code Restructure) | No | Well-documented vanilla JS modularization. The namespace pattern is established. Incremental extraction is mechanical. |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. PostgreSQL RPCs and ES modules are platform standards. All recommendations use technologies already in or compatible with the existing stack. |
| Features | HIGH | Feature landscape is well-defined by PROJECT.md. Table stakes are clear. Anti-features are documented. The only uncertainty is commission formula edge cases (hedged positions). |
| Architecture | HIGH | Derived entirely from codebase analysis. Component boundaries align with existing page/role structure. Both namespace (ARCHITECTURE.md) and ES module (STACK.md) approaches are viable. |
| Pitfalls | HIGH | All pitfalls backed by specific line-number evidence in the codebase. The non-atomic balance update (#1) and wrong commission formula (#3) are provably present in current code. |

**Overall: HIGH** -- This is a well-scoped milestone on a known codebase with clear business rules. The domain (Indian bookmaking commission) has established conventions. The main uncertainties are implementation-level details (exact PL/pgSQL function structure, hedged position edge cases), not architectural.

### Gaps to Address During Planning

1. **Commission on hedged positions:** A client with both LAGAI and KHAI orders on the same match has a hedged position. What is their "net P&L" for commission purposes? The exposure model handles this for settlement, but the commission implication (losses on one side offset by wins on the other) needs explicit definition.

2. **Void market commission reversal:** If a market is voided after settlement, how are COMMISSION entries reversed? VOID_REFUND exists for bets but no COMMISSION_REVERSAL type exists. Decide whether to build this in Phase 1 or defer.

3. **ES Modules vs. Classic Script Tags disagreement:** STACK.md recommends ES modules (`<script type="module">`). ARCHITECTURE.md explicitly recommends against ES modules, citing CORS issues and scope mismatches. **Resolution for roadmapper:** Use classic `<script>` tags with namespace convention for Phase 4 restructure. This is the safer path given the existing `auth.js` global pattern and static hosting. ES modules can be adopted later if a dev server is introduced.

4. **Agent P&L storage disagreement:** ARCHITECTURE.md says compute on-the-fly (no new table). STACK.md and PITFALLS.md say persist in a `settlement_results` table. **Resolution for roadmapper:** Persist at settlement time. The marginal cost of a table is near zero and the auditability benefit is high for financial data.

5. **Commission rate snapshot timing:** Pitfall #11 raises whether commission rates should be captured at bet-placement time or read at settlement time. PROJECT.md does not specify. This is a business decision that needs resolution before Phase 1 implementation.

---

## Sources

Aggregated from all research files:

- **Codebase analysis (primary source):**
  - `admin.html` (3955 lines) -- settlement logic at lines 2827-2952, agent settlement at 3244-3264, commission TODO at 2921
  - `agent.html` (1801 lines) -- P&L rendering at lines 1183-1248, incorrect commission estimate at 1186
  - `client.html` (2086 lines) -- commission rate display at 1402-1404
  - `auth.js` (242 lines) -- global pattern with `window.supabaseClient`, `window.AuthSystem`
  - `schema.sql`, `update_commissions.sql`, `admin_schema_update.sql` -- database schema with commission fields

- **Project documentation:**
  - `.planning/PROJECT.md` -- commission rules, agent hierarchy, business constraints, key decisions
  - `.planning/codebase/STRUCTURE.md` -- DB table definitions
  - `.planning/codebase/CONCERNS.md` -- known technical debt, two-directory problem

- **External references:**
  - MDN Web Docs: JavaScript Modules Guide (ES module browser support, import maps)
  - Supabase documentation: Database Functions (SECURITY DEFINER RPCs)
  - Indian bookmaking domain conventions (match commission on losses, fancy on volume, agent share hierarchy)
