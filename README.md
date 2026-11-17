# Cinebot — local movie ticket bot

A standalone movie ticket assistant with a web dashboard and regular Chrome/Edge tabs for cinema login and payment. No Chrome extension installation is required.

Click a movie, choose your date, seat count and locations, and let the bot find seats in your connected browser. It verifies the selection and follows clear cinema payment-gateway controls, then hands payment to you. You can also watch a future date for tickets to open.

**Live Cineplex** shows Star Cineplex's current movie catalog, published showtimes, halls and reported ticket availability. The bot uses this same feed for live missions.

## Start

Requires **Node.js 22.12 or newer**, npm, installed Chrome or Edge, and a desktop environment for the visible cinema browser. Playwright Chromium is used for automated tests.

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

The running-movie view requires a future published screening, not only a catalog flag. Movies with no announced screenings remain under **Upcoming & unannounced** or all catalog, with **Shows not published** badges. If a mission cannot reach a seat page, its detail/activity and **Adjust search** explain whether the movie has no schedule, the selected date/location/time excludes shows, or sales/seating are unavailable. A watch task cannot open a seat page until a qualifying show exists.

Hall names come from public metadata for published shows. A hall with “tickets open” has online sales open for at least one listed show; this does not indicate physical opening hours. Ticket counts are provider-reported aggregates, and actual seat selection is verified in the cinema browser.

Click a movie poster, title or **Choose date & seats** to open its booking dialog. Pick any future date, number of seats, rows, preferred time slots and one or more locations. Choose **Any row** or **Any time** to remove those filters; time slots use Dhaka time. Availability follows your selected time slots, and the browser verifies seats in your selected rows. The dialog immediately shows reported availability for those exact choices, showtimes/halls, and buttons for other published dates. The selected catalog movie ID is retained, so another title match cannot be booked accidentally. Aggregate seat counts do not guarantee a consecutive group; the bot verifies the actual map in your browser.

The date view distinguishes available tickets, too few seats, sold out, not open, closed/counter-only, unknown availability and a schedule that has not been published. **Published dates & upcoming shows** lists the cinema's announced dates for that movie and your locations. A published `onlineSalesOpenAt` value is shown in Dhaka time; otherwise the dialog explicitly says the opening time has not been announced. The current public feed does not provide opening timestamps. Show start, release date and sales cutoff are never presented as ticket-opening times.

Use **Find seats** beside an individual show for the existing exact-show shortcut. “Ticket sales opened” notices compare successful refreshes; the first load establishes a baseline, which resets when the service restarts.

If the provider becomes unavailable, last-success inventory stays visible with a stale-data warning and live shortcuts are disabled. Failed live requests never substitute demo listings or invent ticket availability.

1. **Settings → Connect existing browser** to use an open Chrome/Edge session with local debugging enabled, or **Open regular browser** for simple setup. The latter opens a normal window with a persistent cinema profile and reuses it for later bookings. Optionally save your Cineplex email/password in **Settings → Cineplex login**.
2. **Live Cineplex:** click the movie you want, then choose your date, seat count, rows, time slots and locations. Keep seats together is enabled by default. All rows and times are searched until you select a preference.
3. If tickets are available, choose **Get seats & open payment**. The bot searches that exact movie/date, chooses a matching show in your locations and uses the connected regular browser to verify and select seats.
4. If tickets or schedules are not available, choose **Watch selected date**. The saved monitor checks those exact choices every 30 seconds and starts browser selection when a qualifying show opens. It does not guess an opening time or substitute another date/movie.
5. The bot handles saved cinema login and explicit **Continue/Proceed to payment** controls. It follows recognized SSLCOMMERZ hosted-gateway redirects, including a new tab, and stops there. Generic charge-confirmation controls such as Pay now, unrecognized gateways and missing checkout details remain manual handoffs. It never enters card details or confirms a charge. A retry after filling cinema checkout details reuses the verified selection instead of restarting the seat page.
6. Use **Open browser** when a task needs attention. Complete OTP, CAPTCHA, required details and payment yourself. **Retry selection** resumes the handoff. **Mark complete** records your completion; it does not claim payment was detected automatically.

**New mission** also shows row and time-slot choices directly. Its advanced settings cover tiers, split seating, one-show-per-branch or discovery without automatic selection. Drop monitors can also have a scheduled start. Show-date validation uses Bangladesh time.

**Demo mode** provides a complete local demonstration with simulated seats. It never opens a live booking or buys tickets. Branch filters still apply; sample shows include Bashundhara data.

Overview, Missions and Activity update through a live event stream and reconnect automatically. Jobs, results and bounded logs are saved in `.bot-data/tasks.json`. The automatically opened regular browser uses `.bot-data/regular-browser/`; an existing attached browser keeps its own profile. Browser tabs stay open when the bot stops. Keep `.bot-data` private; it is excluded from Git.

### Browser access and saved login

The bot connects to an existing browser's **regular default session**, sharing its cookies and tabs. In Chrome 144+, open `chrome://inspect/#remote-debugging`, enable debugging for that browser instance, enter its displayed local address in Settings and choose **Connect existing browser**. Chrome asks for permission: choose **Allow**. The bot waits up to two minutes for that approval, without repeatedly prompting or launching another window. This mode works even when Chrome's HTTP discovery endpoints return 404. Only local `DevToolsActivePort` endpoint metadata is read; no Chrome profile databases are read. An explicit local `ws://…/devtools/browser/…` address is also accepted. [Chrome's current setup instructions](https://developer.chrome.com/docs/devtools/agents/get-started/configuration/) describe the consent flow.

Older Chrome/Edge debugging servers work with the local HTTP address (default `http://127.0.0.1:9222`). When using command-line debugging flags, modern Chrome requires a non-default profile. A browser with no debugging access cannot be controlled automatically. Connection addresses are restricted to loopback HTTP or browser WebSockets. If the address is occupied by another service or Chrome approval fails, the bot explains the issue instead of trying to start a second browser on the same port.

**Open regular browser** handles that setup with installed Chrome/Edge and a persistent cinema profile. It first checks for an existing browser at the saved address, then launches one only if needed. It never creates an incognito context. If you already use a debugging-enabled browser, enter its address and choose **Connect existing browser**. The bot opens/reuses cinema tabs there and leaves your other tabs intact.

Passwords stay in bot memory by default and are cleared when the service exits. On Windows, **Remember on this Windows account (encrypted)** stores them in `.bot-data/credentials.json` using Windows DPAPI for the current account. The dashboard retrieves only email/saved status, never the saved password. Use **Remove saved login** to clear it. No password is saved in tasks, events or mission logs. Other platforms support session-only credentials. Password submission is limited to recognized HTTPS cinema forms; failed login, OTP and CAPTCHA return a manual handoff. The bot never submits payment.

After updating/building the app, restart the running bot before refreshing the dashboard so the API and dashboard use the same build.

Stop a mission to cancel future checks. Stopping an active selection closes its automation page; a page already handed over for payment stays open. You can run a task again, mark it complete or remove it when idle.

Use **Adjust search** on an idle or failed mission to correct its preferences and retry the same task. A pinned show displays its actual branch/time and has an **Unpin show** control. Changing branch, time-slot or booking-strategy preferences clears that exact-show pin. Older conflicting pins now produce a specific error; choose **Adjust search → Unpin show → Save & find seats** to search the selected branch/time instead.

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

## Smoke tests

```powershell
npm.cmd run test:smoke
npm.cmd run test:smoke:live
```

Both commands build the production app, then check startup, health/config/state APIs, dashboard rendering, inventory rendering/refresh, and a demo task's discovery/stop/removal lifecycle. The default uses deterministic inventory; live mode checks Star Cineplex's real public API and fails on source errors instead of substituting fixtures.

Tests use an ephemeral port and fresh storage under `.bot-test-data`, without touching your saved jobs or cinema login. Their only task is explicitly demo-only with automatic reservation disabled. The owned service shuts down after the run.

Results are saved to `test-results/smoke/summary.json`, with dashboard/inventory screenshots beside it. Failure traces and screenshots are under `test-results/smoke/failures/`. Each run replaces the report status, so an earlier pass cannot mask a new failure.

For a current build, add `-- --skip-build` to either command.

## Configuration

The service binds to **127.0.0.1** and serves dashboard/API from the same origin. It is intended for one user on their own computer.

| Environment variable | Default                        | Meaning                                                     |
| -------------------- | ------------------------------ | ----------------------------------------------------------- |
| `BOT_PORT`           | `4317`                         | Local dashboard port                                        |
| `BOT_DATA_DIR`       | `.bot-data` at repository root | Saved jobs and browser profile                              |
| `BOT_HEADLESS`       | unset                          | Test status flag; production browser setup remains visible |

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
