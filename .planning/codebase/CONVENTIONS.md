# CONVENTIONS.md — Code Conventions

## Security Patterns
- `sanitize(str)` — XSS helper, wraps all user-supplied content before innerHTML
- `auditLog(action, {targetId, targetLoginId, extra, amount})` — logs every admin action
- Typed market name confirmation before settle/void
- Cascading suspension (suspending agent suspends all their clients)

## Error Handling
- All async functions wrapped in try/catch
- `showToast(msg, 'error'|'success')` for user feedback
- Balance rollback on failed order insert
- Non-blocking DB updates use `.then(()=>{}).catch(()=>{})`

## UI Patterns
- `fmt(n, decimals)` — number formatter (JetBrains Mono display)
- `timeAgo(date)` — relative time helper
- Modal pattern: `openModal('modalId')` / `closeModal('modalId')`
- Toast notifications: `showToast(message, type)`
- Auth gate: `#authGate` overlay visible until `requireRole()` resolves

## Bet Slip State (`bsState`)
```js
{ eventId, outcomeId, side, backPrice, isFancy, isLK, line, oddsAtOpen, favTeam }
```

## Rate Model
- `back_price` stored in outcomes (decimal, e.g. 1.40)
- `lay_price = back_price - 0.05` (computed, not stored)
- LAGAI rate = `ev.lagai_rate`; KHAI rate = `lagai_rate + 0.05`
- Exit formula: LAGAI `exitVal = stake × (entry/curKhai)`; KHAI `exitVal = stake / curKhai`
