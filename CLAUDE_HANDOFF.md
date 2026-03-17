# Bhandai Exchange - Developer Handoff (Client Dashboard Phase)

**To the Developer/AI (Claude):**
You are picking up Sprint 3 of the Bhandai Exchange platform. We are building a demo betting exchange inspired by the UI/UX of Money247, but powered by simplified "Polymarket" style share-price mechanics.

The Admin and Agent dashboards, alongside the core N-Tier hierarchy and credit flow, are **completely finished and working**. 

Your singular focus is to build the **Client Dashboard & Trading Exchange (`exchange.html` and `client.html`)**.

## 1. Project Architecture & State
*   **Tech Stack:** Vanilla HTML, CSS (`styles.css`), Vanilla JavaScript, Supabase (Auth + Database).
*   **Authentication (`auth.js`):** We use custom Alphanumeric Login IDs (e.g., `C12345` for clients). In the background, `auth.js` maps these to proxy emails (e.g., `c12345@bhandai.com`) to bypass Supabase's email-only requirement. Do not break `auth.js`.
*   **Credit System:** We do not use credit cards. Admins mint coins, deposit them to Agents, who deposit them to Clients. The `balance` field in `betting_users` is the absolute source of truth for funds.

## 2. Supabase Configuration
*   **URL:** `https://vtxuzrkwnyhxciohwjjx.supabase.co`
*   **Anon Key:** `sb_publishable_c2TzMQIXnpvxbf5UIOmrYw_tABpS3yR`

## 3. Database Schema (Relevant Tables)

**Table: `betting_users`**
*   `id` (uuid, primary key, matches auth.users.id)
*   `login_id` (varchar, unique, e.g., 'C98765')
*   `role` (varchar: 'ADMIN', 'AGENT', 'CLIENT')
*   `parent_id` (uuid, links Client to Agent)
*   `balance` (decimal, current spendable coins)
*   `partnership_share` (decimal, % of risk the Agent holds)
*   `match_commission` / `fancy_commission` (decimals)

**FUTURE Tables You Must Architect for the Exchange:**
You will need to design and implement SQL schemas in Supabase for:
1.  `events` / `matches` (e.g., "India vs Australia")
2.  `outcomes` (e.g., "India to Win")
3.  `orders` (The Order Book: Back vs Lay, Price, Volume)
4.  `portfolio_positions` (Tracking a user's open bets and average entry prices).

## 4. Your Mission: The Client Exchange

Your goal is to build out `exchange.html`. 

### A. The UI Layout (Money247 Style)
It must be a 3-column layout:
1.  **Left Sidebar:** Match Selector (Cricket, Tennis, Soccer lists).
2.  **Center Console (The Order Book):** This is the core interface. It must look identical to Money247. 
    *   Blue columns for **BACK** (Buy Yes).
    *   Pink columns for **LAY** (Buy No / Sell Yes).
    *   Prices should range from 0.01 to 0.99 (Polymarket probability math).
3.  **Right Sidebar:** The Bet Slip. When a user clicks a Blue or Pink box, it populates the Bet Slip where they enter their "Stake" (Coins).

### B. The Math (Polymarket Mechanics)
If a user Backs "India" at 0.60 price for 1,000 coins:
*   They are buying shares that pay out 1 coin if India wins.
*   Cost = 1,000 coins.
*   Potential Payout = 1,000 / 0.60 = 1,666.66 coins.
*   Profit = 666.66 coins.

### C. The Core Features
1.  **Placing Bets:** Deduct balance from `betting_users` and write to the `orders` / `portfolio_positions` tables.
2.  **The Portfolio View (`portfolio.html`):** A page where the Client can see their "Active Bets" and their current liability.
3.  **Square Off (Cash Out):** The *most important feature*. Allow users to "Sell" their position back into the order book at current market prices to lock in profit or cut their losses before the match ends.

## 5. How to start
1. Clone this repository: `git clone https://github.com/chawlabraham-png/bhandai-betting.git`
2. Start a local server (e.g., `npx http-server -p 8080`).
3. Log in using a Client credential (or use the Admin dashboard to create a new Agent, login as the Agent, and create a test Client for yourself).
4. Begin building `exchange.html` and its required CSS/JS modules.
