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
- `npm.cmd test`: 60 tests passed across six suites, including explicit aisle-boundary preservation in standalone discovery.
- `npm.cmd run test:e2e`: six browser tests passed, including dashboard/mobile flows and live-DOM fixture handoffs.
- `npm.cmd run extension:build`: passed with existing legacy Vite plugin warnings.
- Production root HTTP request: 200, dashboard title found.
- Production state response: version 0.2.0, zero saved user tasks, visible-browser mode enabled.
- Screenshots reviewed: `test-results/dashboard-overview.png`, `dashboard-mission.png`, `dashboard-mobile.png`.

## Limits and operation

Real cinema authentication and a live reservation/payment were not exercised. Browser tests use intercepted local fixtures and make no purchases. The inherited discovery adapter supplies candidate estimates; the new browser flow checks real seat elements before selection. Site changes can require selector updates.

Start with `start-bot.cmd` or `npm.cmd start`, then open `http://127.0.0.1:4317`. Runtime state/profile are ignored under `.bot-data`. Local preview servers are stopped after QA. Closing the dashboard is safe; closing the bot process or sleeping the computer suspends execution.

The migration is ready for version control. Runtime profiles, saved user jobs, dependency installs and test output are excluded from the migration commit.
