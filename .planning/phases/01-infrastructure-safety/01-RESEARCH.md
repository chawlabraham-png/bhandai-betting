# Phase 1: Infrastructure Safety - Research

**Researched:** 2026-03-25
**Domain:** PostgreSQL RPC atomic balance mutations, source directory consolidation, schema verification
**Confidence:** HIGH

## Summary

Phase 1 addresses three foundational prerequisites before commission work begins: (1) replacing the dangerous client-side read-modify-write balance pattern with an atomic PostgreSQL RPC, (2) eliminating the two-directory workflow that risks code divergence, and (3) verifying the `notes` column on `credit_transactions` is present and accepts arbitrary text for the audit trail that commission entries will rely on.

The most critical item is INFRA-01 (atomic balance). The codebase contains **14 separate balance mutation sites** across `admin.html`, `client.html`, and `agent.html`, all following the same unsafe pattern: `SELECT balance`, compute `newBal = balance + delta` in JavaScript, then `UPDATE balance = newBal`. This is a textbook race condition -- if two operations overlap (concurrent settlement, deposit during settlement, two browser tabs), the second write silently overwrites the first. The fix is a PostgreSQL RPC `adjust_balance(p_user_id, p_delta)` that performs `SET balance = balance + p_delta` atomically in the database. Every balance mutation site must be migrated to call this RPC.

For this phase, the scope is limited to: creating the `adjust_balance` RPC, migrating **settlement balance mutations only** (the 4 sites in `settleMatchMarket`, `settleFancyMarket`, match result declaration, and void refunds in `admin.html`), verifying the `notes` column, and consolidating source directories. Non-settlement balance mutations (deposits, withdrawals, bet placement, exits) are deferred -- they share the same race condition but have lower risk because they are user-initiated single operations, not batch loops processing dozens of users.

**Primary recommendation:** Create a simple `adjust_balance(p_user_id UUID, p_delta NUMERIC)` SECURITY INVOKER RPC that does `UPDATE betting_users SET balance = balance + p_delta WHERE id = p_user_id RETURNING balance`, then replace the settlement read-modify-write pattern in `admin.html` to call `sb.rpc('adjust_balance', {...})`. Verify `notes` column exists. Consolidate to single working directory.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | Settlement balance mutations use atomic PostgreSQL RPC (`adjust_balance`) instead of client-side read-modify-write | 14 balance mutation sites identified across 3 HTML files; 4 settlement-specific sites in admin.html at lines 2875, 2932, 3074, 3584. PL/pgSQL RPC pattern verified via Supabase docs. PostgREST wraps RPC calls in transactions automatically. |
| INFRA-02 | Source directories consolidated to single working directory (eliminate copy workflow) | Two directories confirmed: `/private/tmp/bhandai-betting/` (with git) and `/private/tmp/bhandai-rebuild/` (with git). Files currently identical but divergence is structurally inevitable. Rebuild directory is primary (more recent git history, GSD planning artifacts). |
| INFRA-03 | `notes` column verified on `credit_transactions` for audit trail data | Column is NOT in the `admin_schema_update.sql` CREATE TABLE, but IS actively used in code (admin.html lines 2347, 2425, 2879; agent.html lines 1682, 1694). Column exists in production but needs explicit verification/migration SQL as safety net. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack**: Vanilla JS only -- no frameworks, no build tools, no TypeScript
- **Deployment**: Static hosting on Hostinger -- no server-side rendering
- **Database**: Supabase only -- no additional backend services
- **Naming**: Supabase client must be `const sb = window.supabaseClient` (admin/agent) or `const db = window.supabaseClient` (client). NEVER `const supabase = ...`
- **Security**: `sanitize(str)` for all user-supplied content, `auditLog()` for admin actions
- **GSD Workflow**: Do not make direct repo edits outside a GSD workflow unless user explicitly asks
- **Modularization approach**: Classic `<script>` tags with namespace convention (`window.BX`), NOT ES modules (locked decision from STATE.md)
- **Agent P&L storage**: Persist in `settlement_results` table at settlement time (locked decision from STATE.md)

## Standard Stack

### Core

No new libraries or dependencies are introduced in this phase. Everything uses existing platform capabilities.

| Technology | Version | Purpose | Why Standard |
|------------|---------|---------|--------------|
| PostgreSQL PL/pgSQL | Built into Supabase (PG 15+) | `adjust_balance` atomic RPC function | Native database function language. All Supabase managed PostgreSQL instances include PL/pgSQL. No installation needed. |
| Supabase JS SDK v2 | Already loaded via CDN | Calling `.rpc('adjust_balance', {...})` from frontend | Already in use. The `.rpc()` method is part of the existing SDK. No new dependency. |
| Supabase SQL Editor | Web UI | Creating/deploying the RPC function | Standard Supabase workflow for DDL. Migrations run manually in dashboard (documented in CONCERNS.md). |

### Supporting

None. This phase requires zero new packages.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Simple `adjust_balance` RPC | Full `settle_market` RPC wrapping entire settlement | Full RPC is Phase 2/3 scope. Phase 1 only fixes the atomic balance piece -- a smaller, safer change that can be verified independently. |
| SECURITY INVOKER (default) | SECURITY DEFINER | INVOKER is the Supabase-recommended default. DEFINER would bypass RLS which is unnecessary -- balance updates already pass through authenticated user context. |
| PL/pgSQL function | Raw SQL function (`LANGUAGE sql`) | PL/pgSQL allows `RETURNING` clause handling and future extensibility (e.g., adding balance floor checks). SQL-language functions cannot use control flow. |

**Installation:**
```bash
# No installation needed. RPC created via Supabase SQL Editor.
# Frontend already has supabase-js v2 loaded via CDN.
```

## Architecture Patterns

### INFRA-01: Atomic Balance RPC

#### Current Unsafe Pattern (14 sites)

All balance mutations follow this pattern:

```javascript
// UNSAFE: read-modify-write race condition
const { data: userRow } = await sb.from('betting_users').select('balance').eq('id', userId).single();
const newBal = parseFloat(userRow?.balance || 0) + amount;
await sb.from('betting_users').update({ balance: newBal }).eq('id', userId);
```

If two operations overlap, the second `update` overwrites the first's result. The window is small for single-user operations but wide open during settlement (which loops through dozens of users sequentially).

#### Complete Inventory of Balance Mutation Sites

**Settlement (admin.html) -- MUST fix in Phase 1:**

| Line | Context | Pattern |
|------|---------|---------|
| 2873-2875 | `settleMatchMarket()` -- match settlement payout | read balance, add settleAmt, write |
| 2930-2932 | `settleFancyMarket()` -- fancy settlement payout | read balance, add netPayout, write |
| 3072-3074 | Match result declaration -- alternative settlement path | read balance, add payout, write |
| 3582-3584 | `voidMarket()` -- void refund | read balance, add refund, write |

**Admin deposits/withdrawals (admin.html) -- defer to later:**

| Line | Context | Pattern |
|------|---------|---------|
| 2351 | User creation -- agent funds client (deduct agent) | read funder balance, subtract, write |
| 2427 | Admin deposit to user | read balance, add amount, write |
| 2437 | Admin withdrawal from user | read balance, subtract amount, write |
| 3210 | Platform reset -- set all balances to 0 | Direct `update({ balance: 0 })` -- no race risk, intentionally destructive |

**Agent deposits/withdrawals (agent.html) -- defer to later:**

| Line | Context | Pattern |
|------|---------|---------|
| 1543 | Client creation -- deduct agent balance | read balance, subtract, write |
| 1684 | Deposit to client -- deduct agent balance | read balance, subtract, write |
| 1685 | Deposit to client -- add client balance | read balance, add, write |
| 1696 | Withdrawal from client -- deduct client balance | read balance, subtract, write |

**Client betting (client.html) -- defer to later:**

| Line | Context | Pattern |
|------|---------|---------|
| 1423 | `confirmBet()` -- deduct stake from balance | Direct compute `bal - effectiveDeduction`, write (no re-read, uses local `bal`) |
| 1479 | `confirmBet()` rollback -- restore balance | Write original `bal` back (best-effort rollback) |
| 1847-1849 | `exitPosition()` -- add exit value | read balance, add exitVal, write |

#### Target Pattern: PostgreSQL RPC

```sql
-- Create in Supabase SQL Editor
CREATE OR REPLACE FUNCTION public.adjust_balance(
  p_user_id UUID,
  p_delta NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE public.betting_users
  SET balance = balance + p_delta
  WHERE id = p_user_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  RETURN v_new_balance;
END;
$$;
```

**Key design decisions:**
- **SECURITY INVOKER** (default) -- function runs with caller's permissions, respecting RLS. Supabase docs recommend this as best practice.
- **No `search_path`** override needed since using fully-qualified `public.` references.
- **Returns NUMERIC** -- the new balance, so the caller can update the UI without a separate SELECT.
- **RAISES EXCEPTION** if user not found -- prevents silent failures.
- **No balance floor** -- balances can go negative (this is intentional per the accounting model where admin mints on demand and agents can have negative running balances).

#### Frontend Migration Pattern

```javascript
// BEFORE (unsafe):
const { data: userRow } = await sb.from('betting_users').select('balance').eq('id', userId).single();
const newBal = parseFloat(userRow?.balance || 0) + settleAmt;
await sb.from('betting_users').update({ balance: newBal }).eq('id', userId);

// AFTER (atomic):
const { data: newBalance, error } = await sb.rpc('adjust_balance', {
  p_user_id: userId,
  p_delta: settleAmt
});
if (error) throw new Error(error.message);
// newBalance is the updated balance (returned by the function)
```

### INFRA-02: Directory Consolidation

**Current state:**
- `/private/tmp/bhandai-betting/` -- original working directory, has its own `.git` repo, contains migration files (v3-v8)
- `/private/tmp/bhandai-rebuild/` -- the git repo used for this project, has GSD planning artifacts, more recent timestamps

**Files currently identical** between directories (verified via `diff` -- exit code 0 for all three HTML files and auth.js). But the workflow is fragile: edits in one directory must be manually copied to the other.

**The bhandai-betting directory has migration files NOT in bhandai-rebuild:**
- `migration_v3.sql` through `migration_v8.sql`
- These should be copied to bhandai-rebuild for completeness

**Consolidation strategy:**
1. Copy any unique files from `bhandai-betting` to `bhandai-rebuild` (migration SQL files)
2. Verify no divergent edits exist (confirmed: files identical)
3. All future work happens exclusively in `/private/tmp/bhandai-rebuild/`
4. Document this in a prominent location so the developer does not revert to the old workflow
5. Optionally rename or archive `bhandai-betting` to prevent accidental use

### INFRA-03: Notes Column Verification

**Current state:** The `notes` column is actively used in the codebase:
- `admin.html:2347` -- `notes: 'Capital deployment to new ${role}...'`
- `admin.html:2425` -- `notes: note || null` (deposit)
- `admin.html:2879` -- `notes: 'Match settled: ${winningOutcome.title}...'`
- `agent.html:1682` -- `notes: note||null` (deposit)
- `agent.html:1694` -- `notes: note||null` (withdrawal)

**But the column is NOT in the CREATE TABLE DDL** (`admin_schema_update.sql`). It was likely added via a migration or directly in the Supabase dashboard.

**Safety migration SQL:**
```sql
-- Idempotent: ADD COLUMN IF NOT EXISTS ensures no error if already present
ALTER TABLE public.credit_transactions
ADD COLUMN IF NOT EXISTS notes TEXT;
```

This should be run as a verification step. If the column already exists (which it does, given the code works in production), the statement is a no-op.

### Anti-Patterns to Avoid

- **DO NOT create a full `settle_market` RPC in this phase.** Phase 1 scope is only the atomic balance primitive. Full settlement RPCs are Phase 2/3. Trying to do everything at once increases risk.
- **DO NOT add balance floor validation in the RPC.** Balances can go negative by design (exposure-based accounting, agent running balances). Adding a `CHECK (balance >= 0)` would break the existing model.
- **DO NOT use SECURITY DEFINER.** The function does not need elevated privileges. Balance updates go through the authenticated user's RLS context. DEFINER creates unnecessary security surface.
- **DO NOT migrate ALL 14 balance mutation sites at once.** Phase 1 focuses on the 4 settlement sites in `admin.html`. Non-settlement sites have lower race-condition risk and can be migrated incrementally.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic balance update | Client-side locking, retry loops, or optimistic concurrency in JS | PostgreSQL `SET balance = balance + delta` in an RPC | The database IS the concurrency control. Any JS-level solution is fundamentally broken because it still relies on the network round-trip window. |
| Transaction atomicity | `try/catch` with manual rollback in JS | PostgreSQL function (auto-wrapped in transaction by PostgREST) | PostgREST automatically wraps RPC calls in a transaction. If the function raises an exception, everything rolls back. JS-level rollback is best-effort and incomplete. |
| Idempotent schema migration | Manual column checks in code | `ADD COLUMN IF NOT EXISTS` | PostgreSQL handles idempotency natively. No need for application-level schema detection. |

## Common Pitfalls

### Pitfall 1: Forgetting to Handle the `.rpc()` Error Response

**What goes wrong:** Supabase `.rpc()` returns `{ data, error }`. If the developer destructures only `data` and ignores `error`, a failed RPC call (e.g., user not found) silently returns `null` and the settlement continues with a missing balance update.

**Why it happens:** The existing codebase inconsistently checks errors -- some calls use `if (error) throw`, others ignore the error entirely.

**How to avoid:** Every `.rpc('adjust_balance', {...})` call MUST check `error` and throw if non-null. Pattern:
```javascript
const { data: newBal, error } = await sb.rpc('adjust_balance', { p_user_id: userId, p_delta: amount });
if (error) throw new Error(`Balance update failed: ${error.message}`);
```

**Warning signs:** Settlement completes "successfully" but balances don't change.

### Pitfall 2: Using `parseFloat` on the RPC Return Value

**What goes wrong:** The RPC returns a NUMERIC PostgreSQL type. Supabase JS SDK may return this as a string (for precision preservation) or as a number depending on the value. If the developer assumes it's always a number and uses it directly in UI, it might display incorrectly.

**Why it happens:** PostgreSQL NUMERIC has arbitrary precision. JS numbers are IEEE 754 doubles. The SDK sometimes returns strings for NUMERIC types.

**How to avoid:** Always `parseFloat()` the returned balance before display or comparison. This is consistent with the existing codebase pattern.

**Warning signs:** Balance displays as "NaN" or a string instead of a number after settlement.

### Pitfall 3: RPC Function Not Found After Creation

**What goes wrong:** The developer creates the function in the Supabase SQL Editor, but calling `.rpc('adjust_balance', {...})` returns a 404 or "function not found" error.

**Why it happens:** PostgREST caches the schema. After creating a new function, PostgREST may need a schema cache refresh. Supabase handles this automatically on most deployments, but there can be a brief delay (up to 60 seconds).

**How to avoid:** After creating the function in SQL Editor, wait a minute before testing. If still not found, trigger a schema cache refresh via the Supabase dashboard (Settings > API > Reload schema cache) or by calling `NOTIFY pgrst, 'reload schema'` in SQL Editor.

**Warning signs:** Function works in SQL Editor (`SELECT adjust_balance(...)`) but fails from the frontend.

### Pitfall 4: Negative Delta Sign Convention Confusion

**What goes wrong:** The developer passes a positive number for withdrawals/deductions, expecting the function to subtract it. But the function does `balance + p_delta`, so a positive delta always increases the balance.

**Why it happens:** The existing code uses different patterns -- sometimes computing `newBal = balance - amount`, sometimes `newBal = balance + settleAmt` where `settleAmt` is already negative for losses.

**How to avoid:** Establish a clear convention: `p_delta` is ALWAYS the signed amount. Positive = increase (payouts, deposits). Negative = decrease (deductions, withdrawals). The caller is responsible for the sign. Document this in a code comment at the function definition.

**Warning signs:** Balances going up when they should go down, or vice versa.

### Pitfall 5: Two-Directory Habit Persistence

**What goes wrong:** After consolidation, the developer continues editing in `/private/tmp/bhandai-betting/` out of muscle memory. Changes made there are never committed and eventually lost.

**Why it happens:** Habit. The original directory was the working directory for months.

**How to avoid:** Rename or archive `bhandai-betting` after consolidation (e.g., `mv bhandai-betting bhandai-betting-ARCHIVED`). This causes an immediate, obvious error if the developer tries to use it.

**Warning signs:** `bhandai-betting` directory has newer file timestamps than `bhandai-rebuild`.

## Code Examples

### Example 1: The `adjust_balance` PostgreSQL Function

```sql
-- Source: Supabase docs pattern + project requirements
-- Run in Supabase SQL Editor

CREATE OR REPLACE FUNCTION public.adjust_balance(
  p_user_id UUID,
  p_delta NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE public.betting_users
  SET balance = balance + p_delta
  WHERE id = p_user_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  RETURN v_new_balance;
END;
$$;
```

### Example 2: Migrating settleMatchMarket Balance Update

```javascript
// BEFORE (admin.html ~line 2872-2875):
if (settleAmt > 0.001) {
  const { data: userRow } = await sb.from('betting_users').select('balance').eq('id', userId).single();
  const newBal = parseFloat(userRow?.balance || 0) + settleAmt;
  await sb.from('betting_users').update({ balance: newBal }).eq('id', userId);
  // ... insert credit_transaction
}

// AFTER:
if (settleAmt > 0.001) {
  const { data: newBal, error: balErr } = await sb.rpc('adjust_balance', {
    p_user_id: userId,
    p_delta: settleAmt
  });
  if (balErr) throw new Error(`Balance update failed for ${userId}: ${balErr.message}`);
  // ... insert credit_transaction (unchanged)
}
```

### Example 3: Migrating settleFancyMarket Balance Update

```javascript
// BEFORE (admin.html ~line 2930-2932):
if (isWin) {
  const grossPayout = stake * bp;
  const netPayout = grossPayout * (1 - commission / 100); // commission is 0 currently
  const { data: userRow } = await sb.from('betting_users').select('balance').eq('id', ord.user_id).single();
  const newBal = parseFloat(userRow?.balance || 0) + netPayout;
  await sb.from('betting_users').update({ balance: newBal }).eq('id', ord.user_id);
  // ...
}

// AFTER:
if (isWin) {
  const grossPayout = stake * bp;
  const netPayout = grossPayout * (1 - commission / 100); // commission is 0 currently
  const { data: newBal, error: balErr } = await sb.rpc('adjust_balance', {
    p_user_id: ord.user_id,
    p_delta: netPayout
  });
  if (balErr) throw new Error(`Balance update failed for ${ord.user_id}: ${balErr.message}`);
  // ...
}
```

### Example 4: Migrating voidMarket Balance Update

```javascript
// BEFORE (admin.html ~line 3582-3584):
const { data: userRow } = await sb.from('betting_users').select('balance').eq('id', pos.user_id).single();
const newBal = parseFloat(userRow?.balance || 0) + refund;
await sb.from('betting_users').update({ balance: newBal }).eq('id', pos.user_id);

// AFTER:
const { data: newBal, error: balErr } = await sb.rpc('adjust_balance', {
  p_user_id: pos.user_id,
  p_delta: refund
});
if (balErr) throw new Error(`Void refund balance update failed for ${pos.user_id}: ${balErr.message}`);
```

### Example 5: Notes Column Safety Migration

```sql
-- Run in Supabase SQL Editor (idempotent)
ALTER TABLE public.credit_transactions
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Verify:
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'credit_transactions' AND column_name = 'notes';
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side read-modify-write for all DB mutations | PostgreSQL RPC for atomic operations | Standard practice; Supabase has supported since v1 | Eliminates race conditions in concurrent operations |
| Manual file copy between directories | Single git repo as source of truth | Industry standard | Prevents code divergence |

**Deprecated/outdated:**
- The pattern `SELECT balance` then `UPDATE balance = newVal` is a known anti-pattern for any concurrent system. PostgreSQL's `SET balance = balance + delta` is the standard solution.

## Open Questions

1. **Should `adjust_balance` enforce a minimum balance (floor)?**
   - What we know: The current system allows negative balances implicitly (admin mints on demand, no floor logic). PROJECT.md says "Agent can go negative."
   - What's unclear: Should clients ever have negative balances? The bet placement code checks `bal < effectiveDeduction` before placing, but settlement can produce negative results.
   - Recommendation: Do NOT add a floor constraint in Phase 1. Keep the RPC simple. If a floor is needed, it can be added as a CHECK constraint or function logic later.

2. **Should non-settlement balance mutations also be migrated in Phase 1?**
   - What we know: 10 additional mutation sites exist outside settlement. They share the same race condition vulnerability.
   - What's unclear: Whether the user wants all 14 sites fixed now or just the 4 settlement sites.
   - Recommendation: Fix only the 4 settlement sites in Phase 1 (matching the requirement "Settlement balance mutations use atomic PostgreSQL RPC"). The other 10 sites can be migrated in a follow-up or as part of Phase 2/3 when settlement moves to a full RPC. Document the remaining sites for future reference.

3. **What about the match result declaration path (admin.html:3060-3089)?**
   - What we know: There appear to be TWO paths to settle a match market -- `settleMatchMarket()` (line 2827) and the match result declaration flow (line 3060). Both have balance mutations.
   - What's unclear: Whether these are duplicate code paths or serve different purposes (e.g., one for exposure-model settlement, one for simple share-based settlement).
   - Recommendation: Migrate both paths to use `adjust_balance`. Investigate whether they can be consolidated in a future phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase SQL Editor | Creating adjust_balance RPC | Via web (supabase.com dashboard) | N/A | Use Supabase CLI locally |
| Node.js | Running local dev server | Yes | v22.16.0 | python3 -m http.server |
| Python3 | Local dev server (`python3 -m http.server 3000`) | Yes | 3.9.6 | Node http-server |
| psql | Direct DB access (optional) | No | -- | Use Supabase SQL Editor web UI |
| Git | Version control | Yes | (repo exists) | -- |

**Missing dependencies with no fallback:**
- None. All required tools are available.

**Missing dependencies with fallback:**
- `psql` not installed locally -- use Supabase SQL Editor (web UI) for all DDL operations. This is the standard workflow documented in CONCERNS.md.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None -- no test framework installed. Automated tests explicitly out of scope (REQUIREMENTS.md). |
| Config file | None |
| Quick run command | Manual verification via browser + Supabase SQL Editor |
| Full suite command | N/A |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | `adjust_balance` RPC exists and performs atomic `balance + delta` | manual | `SELECT adjust_balance('some-user-id', 100.00);` in SQL Editor | N/A |
| INFRA-01 | Settlement code calls `.rpc('adjust_balance', ...)` instead of read-modify-write | manual (code review) | grep for `\.rpc\('adjust_balance'` in admin.html | N/A |
| INFRA-01 | No remaining `select('balance')...update({ balance: newBal })` pattern in settlement code | manual (code review) | grep for `update({ balance:` in settlement functions | N/A |
| INFRA-02 | Only `/tmp/bhandai-rebuild/` is the active working directory | manual | Verify `bhandai-betting` renamed/archived | N/A |
| INFRA-02 | Migration files from old directory are preserved | manual | Verify `migration_v*.sql` files exist in rebuild directory | N/A |
| INFRA-03 | `notes` column exists on `credit_transactions` | manual | `SELECT column_name FROM information_schema.columns WHERE table_name='credit_transactions' AND column_name='notes';` | N/A |
| INFRA-03 | `notes` column accepts arbitrary text (TEXT type, not VARCHAR with length limit) | manual | Check column data_type in information_schema | N/A |

### Sampling Rate
- **Per task commit:** Manual verification (run settlement on test data, verify balance updated atomically)
- **Per wave merge:** Full manual test: settle a match market, settle a fancy market, void a market -- verify all balances correct
- **Phase gate:** All 3 success criteria verified before `/gsd:verify-work`

### Wave 0 Gaps
- No test framework and none will be added (automated tests explicitly deferred per REQUIREMENTS.md Out of Scope)
- Verification is entirely manual: code review + SQL Editor queries + browser testing
- This is acceptable for Phase 1 given the small scope (one RPC function + 4 code site migrations)

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** -- direct inspection of all 14 balance mutation sites across admin.html, client.html, agent.html
- **Supabase Database Functions docs** (https://supabase.com/docs/guides/database/functions) -- RPC creation syntax, SECURITY INVOKER recommendation, parameter passing
- **PostgREST transaction behavior** (https://dev.to/voboda/gotcha-supabase-postgrest-rpc-with-transactions-45a7) -- confirmed: PostgREST wraps RPC calls in transactions automatically; tested with constraint violations causing full rollback
- **schema.sql, admin_schema_update.sql, update_commissions.sql** -- database schema analysis

### Secondary (MEDIUM confidence)
- **Prior research** (.planning/research/PITFALLS.md, STACK.md, SUMMARY.md, ARCHITECTURE.md) -- pitfall identification, recommended approach convergence across all 4 research files

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, using built-in PostgreSQL PL/pgSQL + existing Supabase SDK
- Architecture: HIGH -- the `adjust_balance` RPC pattern is a textbook solution verified via Supabase docs and PostgREST transaction behavior
- Pitfalls: HIGH -- all pitfalls derived from direct codebase analysis of 14 specific mutation sites with line numbers

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable -- PL/pgSQL and Supabase RPC are mature, unchanging APIs)
