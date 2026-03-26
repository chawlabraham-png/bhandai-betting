# Phase 7: Agent Mobile UI - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Make agent.html responsive for mobile screens (375px-428px). Add media queries, touch-friendly controls, card-based layouts for small screens. Mirror client.html mobile-first patterns.

</domain>

<decisions>
## Implementation Decisions

### Mobile Approach (AMOB-01)
- **D-01:** Add CSS media queries to agent.html for screens ≤ 768px. Keep desktop layout untouched for wider screens.
- **D-02:** Add viewport meta matching client.html: `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`
- **D-03:** Bottom navigation bar for mobile (matching client.html pattern) replacing the sidebar nav.
- **D-04:** Single-column layout on mobile — no side-by-side stat cards or multi-column grids.

### P&L Views Mobile (AMOB-02)
- **D-05:** Stat cards stack vertically on mobile (1 column instead of 2x2 grid).
- **D-06:** Tables get horizontal scroll wrapper on mobile with `-webkit-overflow-scrolling: touch`.
- **D-07:** Per-market expandable rows work as-is on mobile (tap to expand).

### Settlement Mobile (AMOB-03)
- **D-08:** Settlement cards single-column on mobile, full width.
- **D-09:** Action buttons (settle, fund) minimum 44px touch target.
- **D-10:** Modal forms full-width on mobile (96vw already handled by existing `.modal` CSS).

### Client Management Mobile (AMOB-04)
- **D-11:** Create/edit client forms stack inputs vertically on mobile.
- **D-12:** Fund transfer form inputs full-width on mobile.
- **D-13:** Client list cards instead of table rows on mobile.

### Claude's Discretion
- Exact breakpoint values (768px recommended)
- Whether to use CSS Grid or Flexbox for responsive layout
- Bottom nav icon selection
- How to handle the sidebar → bottom nav transition

</decisions>

<canonical_refs>
## Canonical References

### Client Mobile Patterns
- `client.html` line 5 — viewport meta to replicate
- `client.html` CSS — mobile-first layout patterns (bottom nav, single column, card-based)

### Agent Code
- `agent.html` line 5 — current viewport (needs update)
- `agent.html` lines 1-180 — CSS section to add media queries to
- `agent.html` lines 180-580 — HTML structure (nav, tabs, forms)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- client.html mobile patterns — bottom nav, card layout, touch-friendly buttons
- Existing agent.html modal CSS already handles max-width: 96vw
- All agent.html elements use CSS classes that can be targeted with media queries

### Integration Points
- agent.html CSS section — add @media queries
- agent.html viewport meta — update to match client.html
- agent.html nav HTML — add bottom nav for mobile, hide sidebar

</code_context>

<specifics>
## Specific Ideas

- This is purely CSS/HTML changes — no JS logic changes needed
- Bottom nav should have same tabs: Dashboard, Clients, Ledger, P&L, Markets, Settlement
- Can't fit all tabs in bottom nav — use scrollable bottom nav or group less-used tabs

</specifics>

<deferred>
## Deferred Ideas

- None — this phase covers all mobile UI requirements

</deferred>

---

*Phase: 07-agent-mobile-ui*
*Context gathered: 2026-03-26*
