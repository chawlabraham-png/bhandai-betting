# TESTING.md — Testing & Development

## Local Development
```bash
cd /tmp/bhandai-rebuild
python3 -m http.server 3000
# Open http://localhost:3000
```

## Test Scripts (Node)
- `test_login.mjs` — tests Supabase auth login
- `seed.mjs` — seeds test data
- `fix_a12345.mjs` — one-off data fix script

## No Automated Tests
- No unit tests, no integration tests, no e2e framework
- Testing is manual via browser

## Deployment
- Static files pushed to GitHub (`chawlabraham-png/bhandai-betting`, main branch)
- Deployed to Hostinger (static hosting) — manual upload or git sync
- Source edits in `/private/tmp/bhandai-betting/`, copied to `/tmp/bhandai-rebuild/` before git push
