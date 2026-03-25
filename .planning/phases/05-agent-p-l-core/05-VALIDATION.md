---
phase: 5
slug: agent-p-l-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual verification via Supabase SQL Editor + grep |
| **Config file** | none — no automated test framework in this project |
| **Quick run command** | `grep -c "settlement_results" sql/003_settle_match_market_rpc.sql` |
| **Full suite command** | Manual: settle a test market and verify settlement_results rows |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Verify SQL via grep
- **After every plan wave:** Deploy and settle a test market, verify settlement_results
- **Before `/gsd:verify-work`:** Full manual verification
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 1 | APNL-06 | manual | `grep -q "settlement_results" sql/005_settlement_results_table.sql` | N/A | pending |
| 5-01-02 | 01 | 1 | APNL-01,02,03,04,05 | manual | `grep -c "settlement_results" sql/003_settle_match_market_rpc.sql` | N/A | pending |
| 5-02-01 | 02 | 2 | APNL-01,02,03,04,05 | manual | `grep -c "settlement_results" sql/004_settle_fancy_market_rpc.sql` | N/A | pending |
| 5-02-02 | 02 | 2 | APNL-06 | manual | Deploy all 3 SQL files to Supabase | N/A | pending |

*Status: pending*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No test framework needed — automated tests explicitly out of scope.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent P&L row created at settlement | APNL-05,06 | Requires live Supabase settlement | 1. Create match market with agent's client 2. Settle 3. Query settlement_results 4. Verify row exists with correct agent_id |
| Agent P&L can go negative | APNL-04 | Requires specific bet outcome | 1. Client wins on market 2. Settle 3. Verify agent_net_pnl is negative |
| Partnership share applied correctly | APNL-01 | Requires known partnership_share | 1. Agent with 80% share, client loses 1000 2. Settle 3. Verify agent_pnl_share = 800 |

---

## Validation Sign-Off

- [ ] All tasks have verification commands
- [ ] Manual test scenarios defined
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
