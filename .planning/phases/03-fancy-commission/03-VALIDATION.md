---
phase: 3
slug: fancy-commission
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual verification via Supabase SQL Editor + browser console |
| **Config file** | none — no automated test framework in this project |
| **Quick run command** | `grep -c "sb.rpc('settle_fancy_market'" admin.html` |
| **Full suite command** | Manual: settle a test fancy market and verify commission entries |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Verify SQL/code via grep
- **After every plan wave:** Settle a test fancy market end-to-end with commission
- **Before `/gsd:verify-work`:** Full manual verification
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | COMM-06,07,08,09,10 | manual | `grep -q "settle_fancy_market" sql/004_settle_fancy_market_rpc.sql` | N/A | pending |
| 3-02-01 | 02 | 2 | COMM-06,09 | manual | `grep -c "sb.rpc('settle_fancy_market'" admin.html` | N/A | pending |

*Status: pending*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No test framework needed — automated tests explicitly out of scope.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Commission credited to all clients with orders | COMM-06,10 | Requires live Supabase settlement | 1. Create test fancy market 2. Place YES/NO bets for test clients 3. Settle with result value 4. Verify COMMISSION row in credit_transactions for ALL clients (winners and losers) 5. Verify client balances increased |
| Volume-based calculation | COMM-06 | Requires live settlement | 1. Client bets 1000 total volume 2. Fancy commission = 2% 3. Verify COMMISSION amount = 20 |
| Rate hierarchy enforcement | COMM-08 | Requires specific user setup | 1. Set client fancy rate > agent fancy rate 2. Settle 3. Verify capped rate was applied |

---

## Validation Sign-Off

- [ ] All tasks have verification commands
- [ ] Manual test scenarios defined
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
