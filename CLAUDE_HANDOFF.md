# Bhandai Exchange - Developer Handoff & Architecture Guide

**To the Developer/AI (Claude):**
You are taking over the comprehensive development of the Bhandai Exchange platform. We are building a demo betting exchange inspired by the UI/UX of Money247, powered by simplified "Polymarket" style share-price mechanics.

**Current Project State:**
*   **Sprint 1 (Auth & Hierarchy):** Complete. Custom ID generation (A12345, C12345), role-based auth routing, and the Supabase `betting_users` schema are established and working securely.
*   **Sprint 2 (Admin/Agent Dashboards):** In Progress. The UI/UX for `admin.html` and `agent.html` is built with high-fidelity Money247-style layouts (Dashboard Overview, User Management, Master Ledger, Risk Management, Match Control). The frontend forms for user creation and the base credit deduction logic are wired.
*   **Sprint 3 (Client Exchange):** Unstarted.

**Your Mission:**
1.  **Complete Sprint 2:** Wire the remaining data into the new UI structures in `admin.html` and `agent.html`. Specifically, make the Master Ledger, Risk Management, and Match Control tabs dynamic by reading/writing to Supabase schemas that you will define.
2.  **Architect & Build Sprint 3:** Design the backend order-matching schema and build the frontend Client Dashboard & Trading Exchange (`exchange.html` and `client.html`).

## 1. Project Architecture & Rules
*   **Tech Stack:** Vanilla HTML, CSS (`styles.css`), Vanilla JavaScript, Supabase (Auth + Database).
*   **Authentication (`auth.js`):** We use custom Alphanumeric Login IDs. `auth.js` maps these to proxy emails (e.g., `c12345@bhandai.com`). **Do not break `auth.js` or the UUID mappings.**
*   **Credit System:** We do not use credit cards. Admins manually mint coins -> deposit to Agents -> deposit to Clients. The `balance` field in `betting_users` is the absolute source of truth. The `credit_transactions` table acts as the immutable ledger.

## 2. Supabase Configuration
*   **URL:** `https://vtxuzrkwnyhxciohwjjx.supabase.co`
*   **Anon Key:** `sb_publishable_c2TzMQIXnpvxbf5UIOmrYw_tABpS3yR`

## 3. Database Schema (Current)
**Table: `betting_users`**
*   `id` (uuid)
*   `login_id` (varchar, e.g., 'C98765')
*   `role` ('ADMIN', 'AGENT', 'CLIENT')
*   `balance`, `credit_limit`, `partnership_share`, `match_commission`, `fancy_commission`
*   `parent_id` (links Client to Agent)

**Table: `credit_transactions`**
*   `id`, `sender_id`, `receiver_id`, `amount`, `transaction_type` ('DEPOSIT', 'WITHDRAWAL'), `created_at`

## 4. Future Schema Requirements (For Sprint 3)
You must design SQL schemas for:
1.  `events` / `matches` (e.g., "India vs Australia")
2.  `outcomes` ("India to Win")
3.  `orders` (The Order Book: Back vs Lay, Price, Volume)
4.  `portfolio_positions` (Tracking user liabilities and payouts)

## 5. The Client Exchange (Sprint 3 specifics)
*   **Layout:** 3-column Money247 style (Sidebar, Center Order Book, Right Bet Slip).
*   **Order Book:** Blue columns (BACK/Buy Yes), Pink columns (LAY/Buy No). Prices 0.01 to 0.99.
*   **Mechanics:** Polymarket probability math. Cost = Stake. Potential Payout = Stake / Price.
*   **Square Off (Cash Out):** Critical feature. Allow users to sell positions back into the order book at current market prices to lock profit or cut losses before match settlement.

## 6. How to Start
1.  Clone this repository: `git clone https://github.com/chawlabraham-png/bhandai-betting.git`
2.  Start a local server: `npx http-server -p 8080`
3.  Review `admin.html` and `agent.html` in the browser to see the high-fidelity UI state we built today for the Master Ledger and Match Control.
4.  Determine your DB schema additions for events/markets, wire up the Admin controls, and then proceed to the Client Exchange.
