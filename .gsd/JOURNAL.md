# Verification journal

## 2026-11-17 — Unpublished movie diagnosis

- Traced the user's actual Dune mission: zero published shows for its exact catalog ID on any date. Its initial monitor was changed to instant search by the user. No browser selection was reached.
- `npm.cmd run build`: passed. `npm.cmd test`: `93 passed (93)` across ten suites. `npm.cmd run test:e2e`: `30 passed (36.4s)`. Fixture production smoke: five checks passed.
- Added catalog-flag-without-screening, date/location/time explanations and persisted runner wait-reason coverage. Full browser flow creates an unpublished-movie watch mission and confirms the browser remains disconnected.
- Inspected `test-results/unpublished-mission.png` and `test-results/unpublished-adjust-search.png`: both prominently explain why no seat page can open. No real reservation/payment was performed.

## 2026-11-17 — Movie-first booking, date availability and gateway handoff

- `npm.cmd run build`: bot/dashboard typechecks and production bundles passed.
- `npm.cmd test`: `Test Files 10 passed (10)`, `Tests 90 passed (90)`.
- `npm.cmd run test:e2e`: `29 passed (35.9s)`. Coverage includes exact movie/date/location/count payloads, insufficient/closed/unpublished/stale states, explicit future opening display, date selection, automatic merchant-to-gateway redirects in the same tab and a popup, no payment submission, and checkout-detail retry preserving the verified selection.
- `npm.cmd run test:smoke -- --skip-build`: `Smoke passed (fixture): 5 checks; 2 movies, 5 published shows, 2 halls.`
- Inspected desktop/mobile screenshots: `test-results/movie-booking-desktop.png`, `test-results/movie-booking-mobile.png`; dialog content/controls are readable and horizontal overflow assertion passes. Body scroll preserves the footer action on small screens.
- Read-only public Cineplex API check returned 194 published shows. The response includes online sales cutoff/channel metadata but no ticket-opening timestamp. The UI reports an unannounced opening rather than deriving one from cutoff/show/release dates. Optional explicit opening metadata is normalized and tested independently.
- All booking/gateway checks used intercepted fixtures. No real seats were selected, orders initiated or payments made during verification.
- Activated the production build on the idle local bot. Health returned 200; API state retained all four mission IDs; encrypted login remained configured. Served dashboard assets contain Get seats & open payment, Watch selected date and Published dates & upcoming shows.
