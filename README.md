# Cinebot — local movie ticket bot

A standalone movie ticket assistant with a web dashboard and a dedicated browser for cinema login and payment. No Chrome extension installation is required.

Create an instant search or monitor a scheduled ticket drop. Choose the movie, show date, branches, time slots, seat tier and rows. The bot finds candidate seat blocks, checks the live cinema page, selects seats and hands checkout to you.

**Live Cineplex** shows Star Cineplex's current movie catalog, published showtimes, halls and reported ticket availability. The bot uses this same feed for live missions.

## Start

Requires **Node.js 22.12 or newer**, npm and a desktop environment for the visible cinema browser.

```powershell
npm.cmd install
npm.cmd run browser:install
npm.cmd run build
npm.cmd start
```

Open **http://127.0.0.1:4317**. On Windows, after installation you can also double-click **start-bot.cmd**; it builds the app and starts the service.

For development with dashboard live reload, run `npm.cmd run dev`.

Keep the terminal/service and computer running. Closing the dashboard tab does not stop tasks. Sleeping, shutting down or stopping the service suspends execution. Saved monitoring jobs resume when the service restarts; interrupted instant searches need to be restarted from the dashboard.

## Dashboard workflow

Open **Live Cineplex** to browse now-showing or upcoming movies, filter by branch/date and inspect sales states: online sales open, sold out, not yet open, closed or counter-only. The feed refreshes every 30 seconds; **Refresh now** requests an immediate update. Live missions request fresh inventory during their checks.

Hall names come from public metadata for published shows. A hall with “tickets open” has online sales open for at least one listed show; this does not indicate physical opening hours. Ticket counts are provider-reported aggregates, and actual seat selection is verified in the cinema browser.

Use **Find seats** beside a show to create a mission pinned to that exact showtime, or **Monitor movie** for a movie without open online sales. Live movie titles and active branches also populate the mission form. “Ticket sales opened” notices compare successful refreshes; the first load establishes a baseline, which resets when the service restarts.

If the provider becomes unavailable, last-success inventory stays visible with a stale-data warning and live shortcuts are disabled. Failed live requests never substitute demo listings or invent ticket availability.

1. **Settings → Open cinema browser:** sign in on the cinema website. Login remains in the bot's dedicated local browser profile.
2. **New mission:** choose instant search or drop monitoring, enter the movie/date/count and select branches and time slots.
3. Expand **Seating & automation** for allowed rows, seat tier, split seating, row preference, one-show-per-branch selection or discovery without automatic selection.
4. For a monitor, optionally set a start time. The form uses your computer's local time and sends a timezone-aware schedule. Show-date validation uses Bangladesh time.
5. Inspect results and proposed seats. An automatic live task opens the visible bot browser and verifies actual seat selection before advancing.
6. When the task needs attention or is ready for payment, use **Open browser**. Complete login, any required manual step and payment yourself. **Retry selection** resumes the handoff after login. **Mark complete** records your completion; it does not claim payment was detected automatically.

**Demo mode** provides a complete local demonstration with simulated seats. It never opens a live booking or buys tickets. Branch filters still apply; sample shows include Bashundhara data.

Overview, Missions and Activity update through a live event stream and reconnect automatically. Jobs, results and bounded logs are saved in `.bot-data/tasks.json`; cinema login is stored in `.bot-data/browser-profile/`. Keep that directory private. It is excluded from Git.

Stop a mission to cancel future checks. Stopping an active selection closes its automation page; a page already handed over for payment stays open. You can run a task again, mark it complete or remove it when idle.

## Commands

| Command                       | Purpose                                                          |
| ----------------------------- | ---------------------------------------------------------------- |
| `npm.cmd run dev`             | Bot and dashboard on one local port, with dashboard live reload  |
| `npm.cmd run build`           | Typecheck and bundle the standalone app                          |
| `npm.cmd start`               | Start the built app                                              |
| `npm.cmd test`                | Deterministic domain, task, persistence and API tests            |
| `npm.cmd run test:e2e`        | Local dashboard and browser-selection fixture tests; build first |
| `npm.cmd run test:live`       | Opt-in live cinema API tests; network required                   |
| `npm.cmd run browser:install` | Install Playwright Chromium                                      |
| `npm.cmd run extension:build` | Build the retained legacy extension                              |
| `npm.cmd run extension:dev`   | Run legacy extension development                                 |

PowerShell may block the `npm.ps1` shim, so Windows commands explicitly use `npm.cmd`. On other platforms, use `npm`.

## Configuration

The service binds to **127.0.0.1** and serves dashboard/API from the same origin. It is intended for one user on their own computer.

| Environment variable | Default                        | Meaning                                                     |
| -------------------- | ------------------------------ | ----------------------------------------------------------- |
| `BOT_PORT`           | `4317`                         | Local dashboard port                                        |
| `BOT_DATA_DIR`       | `.bot-data` at repository root | Saved jobs and browser profile                              |
| `BOT_HEADLESS`       | unset                          | Set to `1` for tests; leave unset for visible login/payment |

For example, set `$env:BOT_PORT = '4319'` before starting. The app does not automatically load `.env` files.

## Structure

```text
bot/src/                  Node API, durable runner, discovery, Playwright
dashboard/src/            React dashboard and responsive styles
packages/core/src/        Shared adapters, algorithms, types and date helpers
extension/                Legacy extension; domain modules re-export shared core
tests/e2e/                Dashboard and local cinema-page fixtures
scripts/dev.mjs           Combined development server
scripts/build.mjs         Typecheck and production builds
.bot-data/                Local runtime state (ignored)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) and [STACK.md](STACK.md). Previous extension documentation is retained at [extension/README.md](extension/README.md).

## Verification and integration limits

The migration and live inventory are verified with deterministic unit/API tests and local browser fixtures covering cancellation, restoration, mobile layout, sales-state normalization, refresh/recovery and selected-seat verification. The live feed has also been checked read-only against the actual public API. Fixtures do not make real reservations.

The Star Cineplex catalog/layout adapter is reused from the existing system. Discovery layouts remain candidate estimates; the browser reads the live seat DOM before selection. Website/API or DOM changes may require adapter/selector updates. If login, CAPTCHA, unavailable seats or an unrecognized step prevents automation, the task hands the page to you. The dashboard does not collect payment credentials, and payment is never submitted automatically.

Use supported cinema flows where automated interaction is permitted. The bot does not bypass authentication, CAPTCHA, rate limits or security controls.
