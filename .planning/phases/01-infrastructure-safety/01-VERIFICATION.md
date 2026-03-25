---
phase: 01-infrastructure-safety
verified: 2026-03-25T12:30:00Z
status: human_needed
score: 6/6 must-haves verified (automated); 2 items require human confirmation
re_verification: false
human_verification:
  - test: "Confirm adjust_balance RPC exists in Supabase"
    expected: "information_schema.routines returns one row: routine_name='adjust_balance', data_type='numeric'"
    why_human: "Cannot query live Supabase PostgreSQL from this verification context. SUMMARY records user deployed and verified, but this is a claim, not a code artifact."
  - test: "Confirm notes column exists on credit_transactions in Supabase"
    expected: "information_schema.columns returns one row: column_name='notes', data_type='text', is_nullable='YES'"
    why_human: "Schema state lives in Supabase, not in files. sql/001_notes_column.sql is correctly written and the SUMMARY records user ran it successfully, but live schema cannot be confirmed programmatically."
---

# Phase 1: Infrastructure Safety — Verification Report

**Phase Goal:** Balance mutations during settlement are atomic and the codebase has a single source of truth
**Verified:** 2026-03-25T12:30:00Z
**Status:** human_needed — all code artifacts verified; 2 Supabase live-schema items need human confirmation
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Balance updates during settlement use a PostgreSQL RPC performing atomic `SET balance = balance + delta` (no client-side read-modify-write) | VERIFIED (code) / ? HUMAN (deployment) | `sql/002_adjust_balance_rpc.sql` contains correct function; admin.html has exactly 4 `sb.rpc('adjust_balance', ...)` calls at all 4 settlement sites; zero `select('balance')` or `update({ balance: newBal })` patterns remain in settlement code |
| 2 | All source code lives in a single working directory (no copy workflow between directories) | VERIFIED | `/tmp/bhandai-betting` does not exist; `/tmp/bhandai-betting-ARCHIVED` exists with old files; `/tmp/bhandai-rebuild` is sole active directory |
| 3 | The `notes` column on `credit_transactions` accepts arbitrary text for audit trail data | VERIFIED (code) / ? HUMAN (schema) | `sql/001_notes_column.sql` is correctly written with `ADD COLUMN IF NOT EXISTS notes TEXT`; SUMMARY records user ran this in Supabase and confirmed column exists |

**Score:** 6/6 code-level truths verified; 2 require live-database confirmation (Supabase deployment)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `migration_v3.sql` | Migration file preserved from old directory | VERIFIED | Exists, 7 lines, committed in 3ef1bbc |
| `migration_v4.sql` | Migration file preserved from old directory | VERIFIED | Exists, 94 lines, committed in 3ef1bbc |
| `migration_v5.sql` | Migration file preserved from old directory | VERIFIED | Exists, 33 lines, committed in 3ef1bbc |
| `migration_v6.sql` | Migration file preserved from old directory | VERIFIED | Exists, 46 lines, committed in 3ef1bbc |
| `migration_v7.sql` | Migration file preserved from old directory | VERIFIED | Exists, 100 lines, committed in 3ef1bbc |
| `migration_v8.sql` | Migration file preserved from old directory | VERIFIED | Exists, 15 lines, committed in 3ef1bbc |
| `sql/001_notes_column.sql` | Idempotent migration ensuring notes TEXT column | VERIFIED | Contains `ALTER TABLE public.credit_transactions`, `ADD COLUMN IF NOT EXISTS notes TEXT`, verification query in comments; committed in e3b2e05 |
| `sql/002_adjust_balance_rpc.sql` | PostgreSQL RPC function definition for atomic balance adjustment | VERIFIED | Contains `CREATE OR REPLACE FUNCTION public.adjust_balance`, `p_user_id UUID`, `p_delta NUMERIC`, `RETURNS NUMERIC`, `balance = balance + p_delta`, `RAISE EXCEPTION 'User not found: %'`, `LANGUAGE plpgsql`; no `SECURITY DEFINER`; no balance floor; committed in 7a16044 |
| `admin.html` | Settlement code migrated to use adjust_balance RPC | VERIFIED | 3,951 lines (well above 3,500 min); exactly 4 `sb.rpc('adjust_balance', ...)` calls at lines 2873, 2929, 3070, 3579; committed in 2555fe9 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `admin.html` settleMatchMarket() | `adjust_balance` PostgreSQL RPC | `sb.rpc('adjust_balance', { p_user_id: userId, p_delta: settleAmt })` | WIRED | Line 2873; error handling on line 2874; credit_transactions insert intact on line 2875 |
| `admin.html` settleFancyMarket() | `adjust_balance` PostgreSQL RPC | `sb.rpc('adjust_balance', { p_user_id: ord.user_id, p_delta: netPayout })` | WIRED | Line 2929; error handling on line 2930; credit_transactions insert intact on line 2931 |
| `admin.html` match result declaration | `adjust_balance` PostgreSQL RPC | `sb.rpc('adjust_balance', { p_user_id: ord.user_id, p_delta: payout })` | WIRED | Line 3070; error handling on line 3071; credit_transactions insert intact on line 3072 |
| `admin.html` voidMarket() | `adjust_balance` PostgreSQL RPC | `sb.rpc('adjust_balance', { p_user_id: pos.user_id, p_delta: refund })` | WIRED | Line 3579; error handling on line 3580; credit_transactions insert intact on line 3581 |

### Data-Flow Trace (Level 4)

SQL files and migration scripts are not components that render dynamic data. Level 4 data-flow trace does not apply to this phase's artifacts. The RPC function definition in `sql/002_adjust_balance_rpc.sql` is a schema artifact — its "data flow" is verified by checking the SQL logic directly (Level 1-2) and the call sites in admin.html (Level 3 key links above).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| RPC SQL file contains atomic update | `grep "balance = balance + p_delta" sql/002_adjust_balance_rpc.sql` | 1 match at line 29 | PASS |
| RPC SQL has no SECURITY DEFINER | `grep "SECURITY DEFINER" sql/002_adjust_balance_rpc.sql` | 0 matches | PASS |
| admin.html has exactly 4 RPC calls | `grep -c "sb.rpc('adjust_balance'" admin.html` | 4 | PASS |
| Zero old read-modify-write in admin.html | `grep "select('balance')" admin.html` | 0 matches | PASS |
| Zero old update pattern in admin.html | `grep "update({ balance: newBal })" admin.html` | 0 matches | PASS |
| All 4 RPC calls have error handling | `grep -n "if (balErr) throw" admin.html` | 4 settlement throws at lines 2874, 2930, 3071, 3580 | PASS |
| notes migration is idempotent | `grep "IF NOT EXISTS" sql/001_notes_column.sql` | 1 match | PASS |
| Archived directory exists | `ls /tmp/bhandai-betting-ARCHIVED/` | Lists admin.html, agent.html, auth.js, client.html + more | PASS |
| Original directory removed | `ls /tmp/bhandai-betting/` | No such file or directory | PASS |

Note: line 3207 in admin.html contains `update({ balance: 0 })` — this is the platform reset function (sets ALL balances to zero for a full data wipe), which is explicitly out of scope for this phase and is not a race-condition-prone settlement mutation.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| INFRA-01 | 01-02-PLAN.md | Settlement balance mutations use atomic PostgreSQL RPC (`adjust_balance`) instead of client-side read-modify-write | SATISFIED | `sql/002_adjust_balance_rpc.sql` correct; 4 RPC call sites in admin.html verified; zero old pattern remaining; all 4 have error handling |
| INFRA-02 | 01-01-PLAN.md | Source directories consolidated to single working directory (eliminate copy workflow) | SATISFIED | `/tmp/bhandai-betting` absent; `/tmp/bhandai-betting-ARCHIVED` exists; `/tmp/bhandai-rebuild` is sole active directory |
| INFRA-03 | 01-01-PLAN.md | `notes` column verified on `credit_transactions` for audit trail data | SATISFIED (code); NEEDS HUMAN (live schema) | `sql/001_notes_column.sql` correct and idempotent; SUMMARY records user ran migration and confirmed column; live schema check requires human |

No orphaned requirements — all three Phase 1 requirement IDs (INFRA-01, INFRA-02, INFRA-03) appear in plan frontmatter and are accounted for.

### Commit Integrity

| Commit | Hash | Description | Verified |
|--------|------|-------------|----------|
| Task 1-01: Copy migration files | 3ef1bbc | chore(01-01): copy migration files and archive old directory | FOUND — 7 files, correct content |
| Task 1-02: Notes column migration SQL | e3b2e05 | feat(01-01): create idempotent notes column migration SQL | FOUND — sql/001_notes_column.sql |
| Task 2-01: adjust_balance RPC SQL | 7a16044 | feat(01-02): create atomic adjust_balance PostgreSQL RPC function | FOUND — sql/002_adjust_balance_rpc.sql |
| Task 2-03: Migrate 4 settlement sites | 2555fe9 | feat(01-02): migrate 4 settlement balance mutations to atomic adjust_balance RPC | FOUND — admin.html, +8/-12 lines |

Note: SUMMARY-02 listed Task 3 commit as `PENDING`. The actual commit is `2555fe9` which exists in the repo — it was committed under the correct message. The PENDING flag in SUMMARY was a documentation artifact, not a gap.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No anti-patterns found. The `update({ balance: 0 })` at admin.html:3207 is a deliberate platform reset, not a race-condition-prone mutation, and is explicitly excluded from Phase 1 scope.

### Human Verification Required

#### 1. adjust_balance RPC deployed in Supabase

**Test:** Open Supabase Dashboard > SQL Editor and run:
```sql
SELECT routine_name, data_type
FROM information_schema.routines
WHERE routine_name = 'adjust_balance' AND routine_schema = 'public';
```
**Expected:** One row with `routine_name='adjust_balance'`, `data_type='numeric'`
**Why human:** The RPC function definition exists correctly in `sql/002_adjust_balance_rpc.sql` and the SUMMARY records that the user deployed and tested it (delta=0 test returned correct balance). However, live Supabase schema state cannot be confirmed from this verification context — the SQL file could have been created without being deployed.

#### 2. notes column exists on credit_transactions in Supabase

**Test:** Open Supabase Dashboard > SQL Editor and run:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'credit_transactions' AND column_name = 'notes';
```
**Expected:** One row with `column_name='notes'`, `data_type='text'`, `is_nullable='YES'`
**Why human:** The migration SQL is correct and idempotent. The SUMMARY records user ran it and confirmed the column. But live Supabase schema cannot be confirmed from file inspection alone.

### Gaps Summary

No gaps found. All code artifacts exist, are substantive, and are correctly wired. The two human verification items are not gaps — they are inherent to this phase's architecture (Supabase schema changes require manual deployment via dashboard). The SUMMARY records both were performed and verified by the user. The human verification items here are confirmation checks, not remediation items.

---

_Verified: 2026-03-25T12:30:00Z_
_Verifier: Claude (gsd-verifier)_
