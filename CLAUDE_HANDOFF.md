# Bhandai Exchange - Developer Handoff & Architecture Guide

This project is currently being built by two developers simultaneously using AI assistance (Claude). 

We are building a demo betting exchange inspired by the UI/UX of Money247, powered by simplified "Polymarket" style share-price mechanics.

## Current Project State (Baseline)
*   **Authentication (`auth.js`):** Custom Alphanumeric Login IDs (e.g., A10001, C98765) are mapped to proxy emails (`c98765@bhandai.com`) to bypass Supabase's email requirement. **Do not break this.**
*   **Database:** Supabase Auth + Database. Tables exist for `betting_users` (with hierarchy roles Admin -> Agent -> Client) and `credit_transactions` (the immutable ledger for coin flow).
*   **Frontend UI:** High-fidelity Money247-style layouts are built for `admin.html` and `agent.html`.

---

# 🚀 Track 1: Finishing the Admin & Agent Control Centers
**Developer:** The Platform Owner

Your objective is to take the static, high-fidelity UI structures built in `admin.html` and `agent.html` and wire them completely to the backend database.

**Your Mission (Sprint 1 & 2 Completion):**
1.  **The Master Ledger:** Wire the Ledger tab to accurately reflect real-time agent/client balances and the total chip flow using the `credit_transactions` table.
2.  **Match Control:** Build the Supabase schemas for `events` and `outcomes`. Wire the UI so Admins can create matches, pause betting, and manually settle markets.
3.  **Risk Management Matrix:** Once the order book exists, wire the Risk Matrix to calculate "Worst Case Scenario" liability by reading the `orders` and `portfolio_positions` tables.
4.  **Agent Dashboard:** Complete the downline client management and settlement logic in `agent.html`.

---

# 🚀 Track 2: Building the Client Exchange 
**Developer:** The Collaborative Partner

Your singular objective is to build Sprint 3: The Client Dashboard and Trading Exchange (`client.html` and `exchange.html`) in isolation. 

**Your Mission (Sprint 3 Creation):**
1.  **The Order Book UI:** Build a 3-column Money247 style layout (Sidebar, Center Order Book, Right Bet Slip). The center console must have Blue columns (BACK/Buy Yes) and Pink columns (LAY/Buy No).
2.  **The Trading Schema:** Design and implement the SQL schemas for `orders` and `portfolio_positions`.
3.  **Polymarket Mechanics:** Implement the math. Prices range from 0.01 to 0.99. Cost = Stake. Potential Payout = Stake / Price.
4.  **Square Off (Cash Out):** This is the critical feature. Allow users to sell positions back into the order book at current market prices to lock in profit or cut losses before the match settles.

## Important rules for Track 2:
*   **Do not modify** `admin.html`, `agent.html`, or `auth.js`. The credit hierarchy and ledgers on the Admin side are handled by Track 1. Focus exclusively on the frontend Client Trading experience.
*   Assume the `balance` field in the `betting_users` table is the absolute source of truth for funds. Deduct from it when a bet is placed.

---

## Technical Configuration
*   **Repository:** `https://github.com/chawlabraham-png/bhandai-betting.git`
*   **Supabase URL:** `https://vtxuzrkwnyhxciohwjjx.supabase.co`
*   **Supabase Anon Key:** `sb_publishable_c2TzMQIXnpvxbf5UIOmrYw_tABpS3yR`
