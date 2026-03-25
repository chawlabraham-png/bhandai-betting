---
phase: 2
slug: match-commission
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual verification via Supabase SQL Editor + browser console |
| **Config file** | none — no automated test framework in this project |
| **Quick run command** | `grep -c "sb.rpc('settle_match_market'" admin.html` |
| **Full suite command** | Manual: settle a test match market and verify commission entries |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Verify SQL/code via grep
- **After every plan wave:** Settle a test market end-to-end with commission
- **Before `/gsd:verify-work`:** Full manual verification
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | COMM-01,02,03,04,05 | manual | `grep -q "settle_match_market" sql/003_settle_match_market_rpc.sql` | N/A | pending |
| 2-01-02 | 01 | 1 | COMM-04 | manual | Supabase SQL: deploy and test RPC | N/A | pending |
| 2-02-01 | 02 | 2 | COMM-01,04 | manual | `grep -c "sb.rpc('settle_match_market'" admin.html` | N/A | pending |
| 2-02-02 | 02 | 2 | COMM-04 | manual | `grep -q "COMMISSION" admin.html` | N/A | pending |

*Status: pending*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No test framework needed — automated tests explicitly out of scope.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Commission credited to losing client | COMM-01,05 | Requires live Supabase settlement | 1. Create test match market 2. Place LAGAI bet for test client 3. Settle with opposing outcome 4. Verify COMMISSION row in credit_transactions 5. Verify client balance increased |
| Zero commission for winner | COMM-02 | Requires live settlement | 1. Verify winning client has no COMMISSION entry |
| Rate hierarchy enforcement | COMM-03 | Requires specific user setup | 1. Set client rate > agent rate 2. Settle 3. Verify LEAST() was applied |

---

## Validation Sign-Off

- [ ] All tasks have verification commands
- [ ] Manual test scenarios defined
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
