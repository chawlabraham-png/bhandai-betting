# STRUCTURE.md — Directory Structure

## File Layout
```
/tmp/bhandai-rebuild/
├── index.html          # Login page
├── admin.html          # Admin dashboard (~3000 lines, all-in-one)
├── agent.html          # Agent dashboard
├── client.html         # Client panel (~2100 lines, mobile-first)
├── auth.js             # Shared auth logic (window.AuthSystem)
├── exchange.html       # Legacy/unused
├── seed_admin.html     # One-time admin seeder
├── schema.sql          # Full DB schema
├── admin_schema_update.sql
├── update_commissions.sql
├── migration_v3-v8.sql # Sequential migrations
├── seed.mjs            # Node seeder script
├── test_login.mjs      # Auth test
├── fix_a12345.mjs      # One-off fix script
├── package.json        # Node deps (for scripts only)
└── .planning/          # GSD planning docs (this folder)
    └── codebase/       # Codebase maps
```

## Key Naming Conventions
- Supabase client: `const sb = window.supabaseClient` (admin/agent), `const db = window.supabaseClient` (client)
- **NEVER** `const supabase = ...` — conflicts with CDN global
- Global state vars: camelCase (`allEvents`, `myOrders`, `currentUser`)
- DOM IDs: camelCase (`headerBalance`, `bsStakeInput`, `portNetPnl`)
- CSS classes: kebab-case (`.match-group`, `.lk-td`, `.bs-confirm-btn`)
- DB tables: snake_case (`betting_users`, `credit_transactions`)

## HTML File Structure Pattern (each dashboard)
```html
<head>
  CDN scripts (Supabase, fonts)
  <script src="auth.js">
  <style> ... all CSS inline ... </style>
</head>
<body>
  #authGate overlay (hidden after auth check)
  #session-warning-banner
  <header>
  <main> tabs/sections </main>
  <script> ... all JS inline ... </script>
</body>
```

## DB Tables
- `betting_users` — id, login_id, role, name, phone, balance, credit_limit, parent_id, status, match_commission, fancy_commission, partnership_share, notes, last_seen_at
- `events` — id, title, category, sub_category, market_type, status, lagai_rate, rate_team, fancy_type, line_value, result_value, winning_outcome, is_resolved
- `outcomes` — id, event_id, title, back_price, is_winner, is_yes_outcome
- `orders` — id, event_id, outcome_id, user_id, bet_side, shares, price_per_share, total_cost, status, line_at_bet
- `portfolio_positions` — user_id, outcome_id, event_id, shares_owned
- `credit_transactions` — sender_id, receiver_id, amount, transaction_type, notes
  - Types: DEPOSIT, WITHDRAWAL, AGENT_SETTLEMENT, ADMIN_MINT, SETTLEMENT, VOID_REFUND
- `platform_announcements` — message, is_active
- `platform_config` — key, value
- `audit_logs` — actor_id, action, target_id, details (JSONB), amount
