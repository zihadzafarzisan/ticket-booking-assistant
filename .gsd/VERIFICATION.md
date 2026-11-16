# Standalone migration verification

Seat-selection repair: saved live tasks reproduced zero results because pinned show IDs conflicted with branch/time filters. Read-only unpinned searches returned five options each. New regression tests reproduced stale-pin submission and reversed-numbering selection failures before repair. Branch/time edits now clear pins, existing tasks can be adjusted in place, and the browser understands provider selection attributes, opaque IDs and delayed rows. Current build, 76 unit/API tests and 11 browser tests pass. `test-results/adjusted-mission.png` was visually reviewed. No real reservation was made during verification.

Smoke test added: `npm.cmd run test:smoke` builds and checks the production app with deterministic inventory. `npm.cmd run test:smoke:live` runs the same checks against the real provider. Both passed; the live run observed 43 movies, 294 published shows and 26 halls. Five checks cover startup/APIs, inventory, dashboard rendering, refresh delivery and isolated demo-task cleanup. A blocked-network run correctly failed and replaced the prior report with failed status; the subsequent authorized-network rerun passed. Results and screenshots are under `test-results/smoke/`.

Updated: 2026-11-16

| Requirement | Evidence |
| --- | --- |
| Runs without extension | Built Node entrypoint serves dashboard with HTTP 200; shared core has no extension runtime dependency |
| Instant discovery and preferences | Unit tests verify explicit date, time and row constraints, branch mismatch rejection and complete seat groups |
| Scheduled monitoring | Unit and browser tests verify schedules do not check early, errors keep monitors alive, saved monitors restore and stop works |
| Durable local state | Store tests cover persistence, readable serialized writes and restoration; dashboard browser test verifies reconnect |
| Verified browser handoff | Intercepted cinema fixture tests cover selected seats → checkout, rejected clicks, already-cancelled operations and preselected extra tickets |
| Dashboard workflows | E2E creates demo mission, inspects block, reconnects, marks complete and removes fixture task |
| Responsive dashboard | Mobile flow passes at 390px with no document horizontal overflow; screenshot reviewed |
| Compatibility | Legacy extension production build passes using shared core |

Checks: standalone production build passed; 74 deterministic tests passed; seven E2E tests passed. Production API and dashboard respond successfully. No real tickets were reserved or purchased.

Actual read-only provider/API verification returned 43 catalog movies, nine branches, 294 published shows and 26 named halls at `2026-11-15T19:38:30Z`. Tests also cover sold-out zero counts, cutoff/channel handling, stale-data failure/recovery, newly opened sales, public hall-name fallbacks and exact-show targeting. The connected live-inventory UI passes desktop/mobile filtering, hall views and targeted task submission. Counts are observations and will change.

The in-app browser preview host was unavailable. Visual QA used screenshots from the repository's Playwright tests instead. Authenticated cinema checkout remains an integration check requiring the user's real browser session.
# Browser and login verification — 2026-11-16

- `npm.cmd run build`: passed.
- `npm.cmd test`: 82 tests passed across 8 suites, including credential API authorization/redaction, endpoint validation, active-search protection, browser routes and real Windows DPAPI storage round trip.
- `npm.cmd run test:e2e`: 19 tests passed, including actual regular-context CDP attachment, browser launch/reuse, shared session cookies, disconnect preserving tabs, login before seats/at checkout, missing/rejected credentials, external form refusal and OTP handoff.
- `npm.cmd run test:smoke -- --skip-build`: five production fixture checks passed. No live reservation or payment was made.
- Inspected `test-results/cineplex-settings.png` and `test-results/cineplex-settings-mobile.png`: forms are readable, no horizontal overflow, saved passwords are not displayed.
- Inspected the public Cineplex sign-in redirect and rendered form read-only: `/api/auth/sign-in` leads to `/login`, with email/password fields and a Sign in button. Actual account login remains dependent on the user's credentials and provider availability.
# Chrome approval connection repair — 2026-11-16

- Production build, 86 unit/API tests and all 21 browser tests passed. Four new regressions reproduced the failure before the fix.
- Browser fixture verifies actual CDP transport behind an HTTP-404 discovery server and delayed WebSocket handshake; concurrent requests create one connection attempt. Dashboard fixture verifies visible Chrome approval guidance while awaiting connection. Inspected `test-results/chrome-approval-guidance.png`.
- Five production fixture smoke checks passed.
- Installed-session proof: after the user's Chrome approval, production `POST /api/browser/connect` returned HTTP 200 in three seconds, with `connected: true`, `pages: 2`, `headless: false`, `mode: regular`. Subsequent `/api/state` confirmed the connection remained active and all three saved missions remained present. No real reservation/payment was executed.
# Movie-first booking verification — 2026-11-17

- Build passed, 90 unit/API tests passed, 29 browser tests passed and five production smoke checks passed. Evidence and screenshots are recorded in `.gsd/JOURNAL.md`.
- Catalog movie selection now retains the exact movie ID; selected-date availability uses date/count/location filters, differentiates unpublished schedules from sold out and does not authorize booking from stale inventory.
- Published opening metadata display and unavailable-date monitoring payloads are tested. No opening timestamp is inferred when the current public feed omits it.
- Actual test-browser transport verifies same-tab and popup gateway redirects after exact seat selection, stops at the hosted gateway, leaves ambiguous charge controls manual and preserves checkout selection on retry. Real reservations/payments were not performed.
