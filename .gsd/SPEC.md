# Standalone movie ticket bot

Status: FINALIZED

## User requirements

Convert the existing extension into a bot controlled by a web dashboard. Run on the user's computer first. Use a visible browser for cinema login and payment. Preserve movie discovery, branch and time preferences, seat maps, consecutive-seat selection, multiple-branch handoff, scheduled drop monitoring, activity logs and reset/stop controls.

## Delivery

- Local Node service owns tasks, polling, persistent state and Playwright browser automation; no extension installation or chrome.* runtime dependency.
- React dashboard provides overview, instant discovery, scheduled tasks, results/seat inspection, activity/history and browser-session controls.
- Reuse the existing pure cinema adapters and algorithms in a shared core. Preserve the legacy extension as an optional build while making the standalone app the default.
- Persist tasks and browser login locally. Dashboard closure does not stop jobs. Computer/service shutdown does; eligible monitors resume at restart.
- Browser handoff verifies selected seats and leaves payment to the user. Optionally use supplied Cineplex credentials for login; CAPTCHA, OTP and unsuccessful login remain manual handoffs. Demo is explicit and never purchases anything.
- Dates/counts/preferences reach the bot; task cancellation prevents subsequent automated side effects.
- Bind local HTTP service to loopback; do not expose browser credentials or accept arbitrary navigation URLs.

## Verification

Build dashboard and bot; run deterministic domain/API/scheduler tests; exercise dashboard flows and DOM selection on local fixtures; capture dashboard screenshots. Real cinema booking depends on service availability and the user's authenticated browser session and will be reported separately from local verification.

## Existing browser and Cineplex login

- Connect to the default, regular context of an existing local Chrome/Edge debugging session and open/reuse cinema tabs there; never create an incognito context. A dashboard setup action may open a regular installed browser with a persistent bot profile and local debugging, then reuse it. Explain that browsers without debugging enabled cannot be attached automatically.
- Browser endpoint is restricted to loopback HTTP or browser WebSockets, with no embedded credentials. Support Chrome 144+ approval-based debugging when HTTP discovery returns 404, read only the local DevToolsActivePort endpoint metadata, allow time for user approval, and do not launch another browser when connection approval fails. Disconnecting the bot must leave an attached browser and its tabs open.
- Dashboard settings accept Cineplex email and password, show saved status, allow replacement/deletion, and never retrieve the saved password. Keep credentials separate from tasks/events/logs. Offer Windows DPAPI encryption for persistent storage; otherwise keep them only for this bot session.
- Submit credentials only to recognized Cineplex/KiChole login forms on allowed HTTPS origins. Check form actions, detect failures and stop after one submission per handoff; never bypass OTP/CAPTCHA or perform payment.
- Verify regular-context attachment, tab/session reuse and disconnect behavior with a local test browser, plus login before/after seat selection, credential API boundaries/storage and settings screenshots. Commit and push the completed work as requested.

## Live Star Cineplex inventory

Show the provider's current now-showing/coming-soon movies, published showtimes, active branches and halls with published shows. Calculate online ticket-sale state from provider status, availability, channel and effective cutoff in Bangladesh time. Refresh automatically and on demand, display last-success/stale/error state, and identify newly opened sales only after comparing successful snapshots. Never replace failed live inventory with demo or synthesized availability. Reuse the same feed for live bot discovery and allow missions pinned to a selected show. Resolve hall names only through permitted public metadata, with explicit identifier fallbacks. Verify normalization, cutoff/zero-seat states, failure recovery, task targeting and dashboard live views using deterministic fixtures and a read-only real API check.

## Smoke test

Provide a single-command production smoke check with deterministic inventory by default and an explicit real-provider mode. Check startup, health/config/state endpoints, dashboard rendering, inventory rendering/refresh, and an isolated demo task lifecycle. Build before checking by default; permit skipping the build explicitly. Use an ephemeral port and fresh test storage, produce screenshots and a concise machine-readable report, and always shut down owned services. Live mode must fail visibly on provider errors rather than substituting fixtures, and neither mode may reserve or purchase real tickets.

## Movie-first booking and date availability

- Clicking a running/upcoming movie opens a booking dialog for that exact catalog movie. Choose any future date, seat count and locations; show provider-reported availability immediately for those choices, including sold out, insufficient seats, unpublished schedules and stale data.
- Preview upcoming published dates/showtimes for the movie. Show ticket-opening timestamps only when explicitly published by the provider; otherwise say that the opening time has not been announced. Release dates, show start times and sales cutoffs are not ticket-opening times.
- Submit an available selection as a live automatic mission for the selected movie/date/locations without silently pinning a different branch or show. An explicit Watch selected date action monitors unavailable/unpublished dates and books when matching sales open. Warn that adjacent-seat availability is verified in the connected browser.
- The bot reuses the connected regular browser, verifies the requested seats, handles optional saved cinema login and follows recognized merchant controls that explicitly proceed to a payment gateway. Stop at the hosted gateway and let the user pay. Missing checkout details, ambiguous payment controls, login/OTP/CAPTCHA and failed redirects remain clear manual handoffs. Never submit card details or confirm a charge.
- Preserve expert mission editing and exact-show shortcuts. Verify movie/date/location/count payloads, availability states, upcoming/unannounced sales, stale data, browser gateway handoff and manual fallbacks using fixtures and screenshots. Build, test, activate and push as requested.
- Treat catalog now-showing flags as unconfirmed when no future shows are published. Keep such movies under upcoming/unannounced catalog views with an explicit schedule-not-published badge. For empty searches, retain and display the actual blocker (no movie schedule, selected date/location/time, ticket sales or seating preferences) in mission activity and detail, and show the same availability context when adjusting a mission.
