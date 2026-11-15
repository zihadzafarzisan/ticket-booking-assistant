# Migration state

Updated: 2026-11-16

Standalone bot/dashboard migration implemented and verified locally.

## Delivered

- Shared pure core extracted; legacy extension consumes re-exports and still builds.
- Node local API, persistent task storage, event stream, scheduling, restart recovery and cancellation.
- Playwright persistent visible browser with live seat reading, verified exact seat set and manual login/payment handoff.
- Responsive React overview, mission creation/list/detail, candidate seat inspector, activity, history and settings.
- Explicit demo mode, instant/scheduled flow, date/time/branch/row/tier preferences and multiple-branch strategy.
- Default standalone build/start/development scripts, Windows launcher, separate deterministic/live test configurations and operator documentation.

## Evidence

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
