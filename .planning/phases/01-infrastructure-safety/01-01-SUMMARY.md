---
phase: 01-infrastructure-safety
plan: 01
subsystem: infra
tags: [sql, migration, supabase, directory-consolidation]

# Dependency graph
requires:
  - phase: none
    provides: "First plan - no prior dependencies"
provides:
  - "Single working directory with all migration SQL files"
  - "notes TEXT column on credit_transactions for audit trail"
  - "sql/ directory pattern for future migration files"
affects: [01-02-PLAN, phase-2-match-commission, phase-4-commission-visibility]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "sql/ directory for numbered migration files (001_, 002_, etc.)"
    - "Idempotent migrations using IF NOT EXISTS"

key-files:
  created:
    - sql/001_notes_column.sql
    - migration_v3.sql
    - migration_v4.sql
    - migration_v5.sql
    - migration_v6.sql
    - migration_v7.sql
    - migration_v8.sql
    - setup_complete.sql
  modified: []

key-decisions:
  - "Used ADD COLUMN IF NOT EXISTS for idempotent migration safety"
  - "Archived old directory with -ARCHIVED suffix rather than deleting"
  - "Established sql/ directory convention for numbered migration files"

patterns-established:
  - "Migration naming: sql/NNN_description.sql (zero-padded sequence)"
  - "Idempotent SQL: always use IF NOT EXISTS or equivalent"
  - "Directory archival: rename with -ARCHIVED suffix, never delete"

requirements-completed: [INFRA-02, INFRA-03]

# Metrics
duration: ~15min
completed: 2026-03-25
---

# Phase 1 Plan 01: Directory Consolidation and Notes Column Summary

**Consolidated migration SQL files into single working directory and verified notes TEXT column on credit_transactions via Supabase deployment**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-25T16:30:00Z (approx)
- **Completed:** 2026-03-25T11:49:10Z
- **Tasks:** 3
- **Files created:** 8

## Accomplishments
- Copied 6 migration files (v3-v8) plus setup_complete.sql from old bhandai-betting directory into the rebuild directory
- Verified all shared files (admin.html, agent.html, client.html, auth.js) were identical before archival
- Archived old /private/tmp/bhandai-betting as bhandai-betting-ARCHIVED to prevent accidental use
- Created idempotent sql/001_notes_column.sql migration with ADD COLUMN IF NOT EXISTS
- User deployed notes column migration to Supabase and verified column exists as TEXT type

## Task Commits

Each task was committed atomically:

1. **Task 1: Copy migration files and archive old directory** - `3ef1bbc` (chore)
2. **Task 2: Create notes column migration SQL** - `e3b2e05` (feat)
3. **Task 3: Run notes column migration in Supabase** - checkpoint (human-verify, resolved: user deployed SQL and confirmed notes column exists as TEXT)

## Files Created/Modified
- `migration_v3.sql` - Migration file preserved from old directory
- `migration_v4.sql` - Migration file preserved from old directory
- `migration_v5.sql` - Migration file preserved from old directory
- `migration_v6.sql` - Migration file preserved from old directory
- `migration_v7.sql` - Migration file preserved from old directory
- `migration_v8.sql` - Migration file preserved from old directory
- `setup_complete.sql` - Complete schema setup preserved from old directory
- `sql/001_notes_column.sql` - Idempotent migration ensuring notes TEXT column on credit_transactions

## Decisions Made
- Used `ADD COLUMN IF NOT EXISTS` for idempotent migration safety -- safe to re-run without error
- Archived old directory with `-ARCHIVED` suffix rather than deleting -- preserves history while preventing accidental use
- Established `sql/` directory convention with numbered files (001_, 002_) for future migration organization

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None - this plan created SQL migration files and consolidated directories. No application code with data bindings was modified.

## User Setup Required

None - the Supabase migration was deployed by the user during Task 3 checkpoint and verified successfully.

## Next Phase Readiness
- Single working directory established at /private/tmp/bhandai-rebuild (INFRA-02 satisfied)
- notes column confirmed on credit_transactions in Supabase (INFRA-03 satisfied)
- Ready for Plan 01-02 (atomic adjust_balance RPC) which completes the remaining INFRA-01 requirement
- sql/ directory ready to receive future migration files from Plan 01-02

## Self-Check: PASSED

- FOUND: sql/001_notes_column.sql
- FOUND: migration_v3.sql through migration_v8.sql
- FOUND: 01-01-SUMMARY.md
- FOUND: commit 3ef1bbc (Task 1)
- FOUND: commit e3b2e05 (Task 2)

---
*Phase: 01-infrastructure-safety*
*Completed: 2026-03-25*
