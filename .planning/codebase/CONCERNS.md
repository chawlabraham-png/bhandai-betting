# CONCERNS.md — Technical Debt & Concerns

## Known Incomplete Features
- Commission deduction: `match_commission` and `fancy_commission` fields exist but are NOT deducted at settlement (0% applied)
- OTP login: planned, not implemented
- Agent settlement: admin-only action; agents cannot initiate themselves
- `agent.html`: desktop-only, mobile redesign pending
- Re-auth for large fund transfers: not implemented

## Tech Debt
- All code is inline in single HTML files (~2000-3000 lines each) — no modules, no separation of concerns
- `portfolio_positions` table partially redundant with exposure model; still updated for backwards compat but not used for settlement
- Two source directories: edits in `/private/tmp/bhandai-betting/`, manually copied to git repo at `/tmp/bhandai-rebuild/` — fragile workflow
- Migration files (v3–v8) need to be run manually in Supabase dashboard

## Security Notes
- Supabase anon key is public (intentional — it's a publishable key with RLS)
- Admin actions protected by RLS + role check in `requireRole()`
- Credentials (initial_password) stored in `betting_users` table — masked in UI with toggle
- No rate limiting on Supabase side (only client-side 3-fail lockout in auth.js)

## Fragile Areas
- `_getLiveRate()`: both LAGAI and KHAI must return `lagaiRate + 0.05` — easy to regress
- `calcEventBook()`: must use `price_per_share × stake` NOT `shares - stake` (shares gets modified)
- Realtime channel: single channel for all events/outcomes updates — may miss updates under load
- Balance deduction/rollback in `confirmBet`: if order insert fails after balance deducted, rollback is best-effort only
