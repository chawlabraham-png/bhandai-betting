# STACK.md — Technology Stack

## Runtime & Language
- **Vanilla HTML/CSS/JavaScript** — no framework, no build step
- Static site served via `python3 -m http.server 3000` locally
- Deployed to **Hostinger** (static hosting)

## Frontend
- **Inter** + **JetBrains Mono** fonts (Google Fonts CDN)
- **Supabase JS SDK v2** via CDN: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`
- No bundler, no transpiler, no TypeScript — plain ES2020+ JS in `<script>` tags

## Backend / Database
- **Supabase** (PostgreSQL + Auth + Realtime)
  - Project: `vtxuzrkwnyhxciohwjjx.supabase.co`
  - Auth: email/password via `supabase.auth.signInWithPassword`
  - Realtime: `postgres_changes` subscriptions on `outcomes` and `events` tables
  - RLS: Row Level Security enabled; some operations use SECURITY DEFINER RPCs

## Key Dependencies (`package.json`)
- `@supabase/supabase-js` — backend SDK (also loaded via CDN in HTML)
- Node scripts (`seed.mjs`, `test_login.mjs`, etc.) for seeding/testing only — not part of production app

## Configuration
- Supabase URL + anon key hardcoded in `auth.js` (publishable key — intentional for client-side app)
- No `.env` files — credentials are public anon keys only
- No CI/CD pipeline configured

## Browser Support
- Mobile-first (`client.html`) — targets modern iOS/Android Safari + Chrome
- Admin (`admin.html`) — desktop only, modern Chrome/Firefox
- No IE/legacy support needed
