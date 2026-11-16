# Migration state

Updated: 2026-11-17

## Movie-first booking

- Catalog posters/titles/actions open a dedicated movie booking dialog. Date, seat count and location choices drive immediate availability, published showtimes and upcoming date previews. Unpublished schedules are distinguished from sold out and stale inventory disables booking.
- Exact catalog movie ID is carried through validation/discovery. New bookings have no hidden row/time exclusions, auto-select live seats and explicitly request gateway handoff. Watch selected date monitors the same exact choices at 30-second intervals.
- Only explicit `onlineSalesOpenAt` metadata becomes a ticket-opening announcement; the current public feed has no opening field. Unknown opening times are stated clearly. Release/show/cutoff dates are not used as opening estimates.
- Browser follows explicit merchant gateway controls to recognized hosted SSLCOMMERZ pages (same tab or popup), never confirms a charge and returns manual handoffs for missing details/ambiguous controls. Retry preserves the verified selection and current checkout page.
- Verification: production build, 90 unit/API tests, 29 browser tests and five production smoke checks passed. Desktop/mobile screenshots inspected. Activated the current build on port 4317: health and new movie dialog assets verified, all four saved missions and encrypted Cineplex login preserved. No real booking/payment was triggered. Evidence: `.gsd/JOURNAL.md`.

## Chrome approval connection repair

- Diagnosed the user's installed Chrome on port 9222: HTTP discovery returns 404 while the local DevToolsActivePort file exposes an approval-based browser WebSocket.
- Added matching-port local endpoint discovery, explicit local browser WebSockets, a two-minute consent wait, single concurrent attachment and clear permission guidance. Failed approval/occupied ports no longer trigger another browser launch.
- Four regressions failed before the fix. Unit/API suite now passes 86 tests; actual Chromium regression covers 404 discovery, delayed approval handshake and shared connection attempts. Dashboard waiting guidance screenshot inspected.
- Activated the update in the local bot and confirmed `/api/browser/connect` HTTP 200: existing regular Chrome connected, two tabs, three missions preserved. The user approved Chrome's browser prompt. No reservation or payment was performed.

## Browser and Cineplex login update

- Implemented regular default-context CDP attachment to existing local Chrome/Edge, normal persistent-browser setup when needed, cinema-tab/session reuse and disconnect without closing attached browser tabs. Ordinary browsers need debugging access enabled; setup and limitations are explained in Settings and README.
- Added Cineplex email/password Settings, session-only storage and optional Windows DPAPI persistence. Passwords are not returned by settings/state APIs or included in tasks/events/logs. Saved login can be replaced or removed.
- Login handling covers recognized allowed-origin forms before seats and at checkout, one submission per handoff, rejected credentials, external form refusal and manual OTP/CAPTCHA/payment handoff. Public Cineplex sign-in endpoint and form field/button names were inspected read-only.
- Verification: production build, 82 unit/API tests, 19 browser tests and five fixture smoke checks passed. Browser tests launch/connect an actual regular test browser, confirm shared cookies/default context, reuse tabs and leave tabs open on disconnect. Settings screenshots were inspected on desktop and mobile. Windows DPAPI round trip passed. Real credentials/reservations/payments were not used.
- User requested commit/push after completion; include earlier authorized seat-selection recovery and smoke test work with this delivery.

Standalone bot/dashboard migration implemented and verified locally.

## Delivered

- Shared pure core extracted; legacy extension consumes re-exports and still builds.
- Node local API, persistent task storage, event stream, scheduling, restart recovery and cancellation.
- Playwright persistent visible browser with live seat reading, verified exact seat set and manual login/payment handoff.
- Responsive React overview, mission creation/list/detail, candidate seat inspector, activity, history and settings.
- Explicit demo mode, instant/scheduled flow, date/time/branch/row/tier preferences and multiple-branch strategy.
- Default standalone build/start/development scripts, Windows launcher, separate deterministic/live test configurations and operator documentation.

## Evidence

- Seat-selection failure diagnosed from saved user tasks: a pinned Military Museum show conflicted with Bashundhara, and a pinned 11:45 show conflicted with afternoon. Removing the pins in a read-only search returned five viable options for each.
- Fixed scope edits retaining stale show pins, added Adjust search / Unpin show with in-place task updates and explicit backend conflict messages. Fixed browser handling of reversed numbering, opaque provider IDs, delayed requested rows and aria-pressed/data-seat-state selection markers.
- Current verification: production build passed; 76 unit/API tests and 11 browser tests passed. Both the stale-pin and reversed-numbering regressions failed before the fixes. User jobs/profile were preserved and no real seats were reserved. Details: `.gsd/DEBUG.md`.

- `npm.cmd run test:smoke`: production build and five smoke checks passed using deterministic inventory.
- `npm.cmd run test:smoke:live -- --skip-build`: five smoke checks passed against the real public API; 43 movies, 294 published shows and 26 halls observed. Health/config/state, dashboard, inventory refresh and isolated demo lifecycle all passed.
- Smoke failure path verified under blocked network access: exit code 1 and a fresh `status: failed` report; subsequent network-enabled rerun passed. No stale success report or fixture fallback was used.
- Smoke artifacts: `test-results/smoke/summary.json`, `dashboard.png`, `live-inventory.png`. Owned smoke services shut down; user storage and cinema login were not used.

- `npm.cmd run build`: passed, bot and dashboard bundles emitted; strict typechecks passed.
- `npm.cmd test`: 74 tests passed across seven suites, including inventory normalization, stale/error handling, zero-seat states, cutoff transitions, hall metadata, live API/SSE and exact-show targeting.
- `npm.cmd run test:e2e`: seven browser tests passed, including dashboard/mobile flows, live inventory browsing and live-DOM fixture handoffs.
- `npm.cmd run extension:build`: passed with existing legacy Vite plugin warnings.
- Production root HTTP request: 200, dashboard title found.
- Production state response: version 0.2.0, zero saved user tasks, visible-browser mode enabled.
- Screenshots reviewed: `test-results/dashboard-overview.png`, `dashboard-mission.png`, `dashboard-mobile.png`.

## Limits and operation

Live Cineplex now reads the public catalog, venue and show endpoints, resolves hall names, refreshes every 30 seconds, and powers live bot discovery. A real read-only check at `2026-11-15T19:38:30Z` returned HTTP 200 with 43 catalog movies, 9 branches, 294 published shows and 26 named halls. Those were observed values, not fixed expectations. No real reservation was made. Screenshots: `test-results/live-cineplex.png` and `live-cineplex-mobile.png`.

Real cinema authentication and a live reservation/payment were not exercised. Browser tests use intercepted local fixtures and make no purchases. The inherited discovery adapter supplies candidate estimates; the new browser flow checks real seat elements before selection. Site changes can require selector updates.

Start with `start-bot.cmd` or `npm.cmd start`, then open `http://127.0.0.1:4317`. Runtime state/profile are ignored under `.bot-data`. Local preview servers are stopped after QA. Closing the dashboard is safe; closing the bot process or sleeping the computer suspends execution.

The migration is ready for version control. Runtime profiles, saved user jobs, dependency installs and test output are excluded from the migration commit.
