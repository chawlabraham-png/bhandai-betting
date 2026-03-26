---
phase: 08-code-modularization
plan: 01
subsystem: ui
tags: [css, javascript, modularization, namespace, vanilla-js]

# Dependency graph
requires:
  - phase: 07-agent-mobile-responsive
    provides: "Agent mobile responsive CSS that is now in css/agent.css"
provides:
  - "window.BX namespace with shared utility functions (sanitize, fmt, timeAgo, showToast, openModal, closeModal)"
  - "External CSS files (shared.css, admin.css, agent.css, client.css) replacing inline style blocks"
  - "lib/utils.js loaded by all three role pages before role-specific scripts"
affects: [08-02-PLAN, 08-03-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: ["window.BX namespace for shared utilities", "External CSS files per role with shared base", "Global aliases for onclick handler backward compatibility"]

key-files:
  created:
    - "lib/utils.js"
    - "css/shared.css"
    - "css/admin.css"
    - "css/agent.css"
    - "css/client.css"
  modified:
    - "admin.html"
    - "agent.html"
    - "client.html"

key-decisions:
  - "Used IIFE wrapper in utils.js to avoid polluting global scope with intermediate variables"
  - "showToast detects both toast-container (admin/agent) and toastContainer (client) element IDs for cross-page compatibility"
  - "CSS files preserve role-specific sizing differences (e.g., agent uses purple btn-primary vs admin blue) rather than forcing shared values"
  - "fmt() default d=2 as canonical (from agent.html); callers pass d=0 when needed"

patterns-established:
  - "BX namespace: All shared utils under window.BX.* with bare window.* aliases"
  - "CSS architecture: css/shared.css (common) + css/{role}.css (role-specific) loaded via link tags"
  - "Script loading order: Supabase CDN -> auth.js -> lib/utils.js -> inline role script"

requirements-completed: [CODE-01, CODE-05, CODE-06]

# Metrics
duration: 34min
completed: 2026-03-26
---

# Phase 08 Plan 01: Shared Utilities and CSS Extraction Summary

**Extracted 6 shared utility functions into lib/utils.js with window.BX namespace, and moved all inline CSS from 3 HTML files into 5 external CSS files (shared + role-specific)**

## Performance

- **Duration:** 34 min
- **Started:** 2026-03-26T15:43:46Z
- **Completed:** 2026-03-26T16:17:48Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created lib/utils.js with window.BX namespace containing sanitize, fmt, timeAgo, showToast, openModal, closeModal -- plus bare global aliases for onclick handler compatibility
- Extracted all inline CSS from admin.html (243 lines), agent.html (279 lines), and client.html (371 lines) into 5 external CSS files
- Updated all 3 HTML files with link/script references; removed all inline style blocks and duplicate utility function definitions
- Preserved local const fmt inside renderBalanceSheet and fmtAmt locals in admin.html

## Task Commits

Each task was committed atomically:

1. **Task 1: Create lib/utils.js with BX namespace and extract CSS** - `87bf68c` (feat)
2. **Task 2: Update HTML files to use external CSS and lib/utils.js** - `eabdb2e` (refactor)

## Files Created/Modified
- `lib/utils.js` - Shared utility functions under window.BX namespace with global aliases
- `css/shared.css` - Common reset, fonts, toast, modal, buttons, cards, badges, forms, stat cards, animations (authSpin, pulse, slideIn)
- `css/admin.css` - Admin sidebar, dashboard, tables, markets, settlement, settings, balance sheet, payout preview, filter bar, broadcast, reconciliation
- `css/agent.css` - Agent indigo sidebar, clients, P&L detail rows, settlement, account section, mobile responsive with bottom nav and more menu
- `css/client.css` - Client mobile-first layout, header, bottom nav, market cards, LAGAI/KHAI table, fancy cards, bet slip, portfolio, history, account, search, announcements, skeleton loading, pull-to-refresh, event book bar
- `admin.html` - Replaced inline style with external CSS links; removed sanitize, timeAgo, openModal, closeModal, showToast functions
- `agent.html` - Replaced inline style with external CSS links; removed sanitize, timeAgo, fmt, showToast, openModal, closeModal functions
- `client.html` - Replaced inline style with external CSS links; removed sanitize, fmt, showToast functions

## Decisions Made
- Used IIFE wrapper in utils.js to encapsulate the BX object construction and avoid intermediate globals
- showToast function detects both `toast-container` (admin/agent ID) and `toastContainer` (client ID) for cross-page compatibility, and applies both the fade-out animation (admin pattern) and CSS class-based animation (client pattern)
- CSS files preserve role-specific sizing and color differences rather than forcing shared values -- agent btn-primary remains purple (#7c3aed) while admin stays blue (#3b82f6)
- fmt() uses d=2 as default (from agent.html canonical version); client.html callers that previously used minimumFractionDigits:0 can pass d=0

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all functions are fully wired and no placeholder data exists.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- lib/utils.js provides the shared foundation that Plans 02 and 03 depend on for extracting role-specific JS modules
- CSS is cleanly separated and ready for further modularization if needed
- Script loading order (Supabase -> auth.js -> utils.js -> inline) is established and must be maintained in Plans 02 and 03

## Self-Check: PASSED

All 8 files verified present. Both task commits (87bf68c, eabdb2e) confirmed in git log.

---
*Phase: 08-code-modularization*
*Completed: 2026-03-26*
