---
phase: 1
slug: infrastructure-safety
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual verification via Supabase SQL Editor + browser console |
| **Config file** | none — no automated test framework in this project |
| **Quick run command** | `node -e "..."` (Supabase RPC call test) |
| **Full suite command** | Manual: settle a test market and verify balance atomicity |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Verify RPC exists via Supabase SQL
- **After every plan wave:** Settle a test market end-to-end
- **Before `/gsd:verify-work`:** Full manual verification
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | INFRA-01 | manual | Supabase SQL: `SELECT adjust_balance(uuid, 100)` | N/A | ⬜ pending |
| 1-01-02 | 01 | 1 | INFRA-01 | manual | Check admin.html settlement uses `.rpc('adjust_balance')` | N/A | ⬜ pending |
| 1-02-01 | 02 | 1 | INFRA-02 | manual | `ls /private/tmp/bhandai-betting` should not exist or be deprecated | N/A | ⬜ pending |
| 1-03-01 | 03 | 1 | INFRA-03 | manual | Supabase SQL: `SELECT column_name FROM information_schema.columns WHERE table_name='credit_transactions' AND column_name='notes'` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No test framework needed for infrastructure-only phase.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Atomic balance update under concurrent settlement | INFRA-01 | Requires Supabase SQL editor to verify RPC exists and works | 1. Run `SELECT adjust_balance(test_user_id, 100)` 2. Verify balance incremented by exactly 100 3. Run twice concurrently, verify no race |
| Single source directory | INFRA-02 | Filesystem check | Verify only `/private/tmp/bhandai-rebuild` is used |
| Notes column exists | INFRA-03 | Schema check | Run column query in Supabase SQL editor |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
