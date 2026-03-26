# Phase 8: Code Modularization - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract inline JS/CSS from HTML files into separate files. Establish namespace convention. HTML files become markup-only with script/link references.

</domain>

<decisions>
## Implementation Decisions

### Shared Utilities (CODE-01)
- **D-01:** Extract sanitize(), fmt(), timeAgo(), showToast(), openModal(), closeModal() into `lib/utils.js` under `window.BX` namespace.
- **D-02:** All HTML files load `lib/utils.js` via `<script src="lib/utils.js">` before role-specific scripts.

### Commission Functions (CODE-02)
- **D-03:** Extract commission calculation into `lib/commission.js` with pure functions: `window.BX.calcMatchCommission(netPnl, rate)` and `window.BX.calcFancyCommission(volume, rate)`.
- **D-04:** These are reference implementations only — actual commission is calculated server-side in RPCs. Client-side functions are for preview/display.

### Agent P&L Functions (CODE-03)
- **D-05:** Extract P&L display helpers into `lib/pnl.js` under `window.BX` namespace.

### Role-Specific JS (CODE-04)
- **D-06:** Extract inline `<script>` blocks into: `js/admin.js`, `js/agent.js`, `js/client.js`.
- **D-07:** Each role file uses its own namespace: `window.Admin`, `window.Agent`, `window.Client`.
- **D-08:** HTML files keep only markup + `<script src>` and `<link>` references.

### CSS Extraction (CODE-05)
- **D-09:** Extract inline `<style>` blocks into: `css/shared.css`, `css/admin.css`, `css/agent.css`, `css/client.css`.
- **D-10:** Shared CSS (reset, fonts, common components) goes in `shared.css`. Role-specific in role files.

### Namespace Convention (CODE-06)
- **D-11:** `window.BX` for shared utilities (sanitize, fmt, toast, modal, commission, pnl).
- **D-12:** `window.Admin`, `window.Agent`, `window.Client` for role-specific functions and state.

### HTML Reduction (CODE-07)
- **D-13:** Final HTML files contain only: DOCTYPE, head (meta, links, script srcs), body (markup). No inline JS or CSS beyond trivial element-level styles.

### Claude's Discretion
- Exact split between shared.css and role CSS
- Whether to create an intermediate step (extract JS first, then CSS) or do both at once
- How to handle auth.js (already external — just ensure it loads before role scripts)
- How to handle the ~3900-line admin.html (may need multiple extraction passes)

</decisions>

<canonical_refs>
## Canonical References

### Files to Extract From
- `admin.html` (~3900 lines) — largest file, inline JS + CSS
- `agent.html` (~1700 lines) — inline JS + CSS
- `client.html` (~2100 lines) — inline JS + CSS
- `auth.js` — already external, shared auth logic

### Target Structure
- `lib/utils.js` — shared utilities (window.BX)
- `lib/commission.js` — commission display functions (window.BX)
- `lib/pnl.js` — P&L display helpers (window.BX)
- `js/admin.js` — admin role JS (window.Admin)
- `js/agent.js` — agent role JS (window.Agent)
- `js/client.js` — client role JS (window.Client)
- `css/shared.css` — shared styles
- `css/admin.css` — admin-specific styles
- `css/agent.css` — agent-specific styles
- `css/client.css` — client-specific styles

</canonical_refs>

<code_context>
## Existing Code Insights

### Common Functions Across Files
- sanitize() — exists in admin.html, agent.html, client.html (identical)
- showToast() — exists in all three (identical)
- openModal()/closeModal() — exists in admin.html and agent.html
- fmt() — number formatter, slightly different implementations
- timeAgo() — exists in admin.html

### Established Patterns
- All pages load auth.js first via `<script src="auth.js">`
- All pages use `window.supabaseClient` (set by auth.js)
- Supabase SDK loaded via CDN in each HTML file

### Risks
- Large file extraction (admin.html) — easy to break references
- Global variable dependencies between functions
- Event handlers in HTML (onclick="...") reference functions that must be global

</code_context>

<specifics>
## Specific Ideas

- Start with shared utilities extraction (lowest risk, highest reuse)
- Then CSS extraction (visual-only, no logic changes)
- Then role JS extraction (highest risk, most lines)
- Keep onclick handlers working by ensuring extracted functions are on window/namespace

</specifics>

<deferred>
## Deferred Ideas

- ES module migration — explicitly out of scope per CLAUDE.md (classic script tags)
- Build tooling — explicitly excluded
- TypeScript — explicitly excluded

</deferred>

---

*Phase: 08-code-modularization*
*Context gathered: 2026-03-26*
