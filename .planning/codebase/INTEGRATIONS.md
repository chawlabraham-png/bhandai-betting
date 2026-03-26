# INTEGRATIONS.md — External Integrations

## Supabase (Primary Backend)
- **URL**: `https://vtxuzrkwnyhxciohwjjx.supabase.co`
- **Key**: publishable anon key in `auth.js`
- **Auth**: `supabase.auth.signInWithPassword` — email synthesized as `{loginId}@bhandai.com`
- **Database**: PostgreSQL via JS client (`sb.from(...)`, `db.from(...)`)
- **Realtime**: channel subscriptions on `events` and `outcomes` tables for live rate updates
- **RLS**: Policies enforce role-based access; `audit_logs` is INSERT-only for clients
- **RPCs**: `platform_reset()` — SECURITY DEFINER function for admin data wipe

## Google Fonts (CDN)
- `Inter` and `JetBrains Mono` loaded from `fonts.googleapis.com`
- No fallback if CDN unavailable (minor UX impact only)

## No Other External Services
- No payment gateway
- No SMS/OTP provider (planned but not implemented)
- No email service
- No analytics
- No error tracking (Sentry etc.)
- No push notifications
