# Standalone movie ticket bot

Status: FINALIZED

## User requirements

Convert the existing extension into a bot controlled by a web dashboard. Run on the user's computer first. Use a visible browser for cinema login and payment. Preserve movie discovery, branch and time preferences, seat maps, consecutive-seat selection, multiple-branch handoff, scheduled drop monitoring, activity logs and reset/stop controls.

## Delivery

- Local Node service owns tasks, polling, persistent state and Playwright browser automation; no extension installation or chrome.* runtime dependency.
- React dashboard provides overview, instant discovery, scheduled tasks, results/seat inspection, activity/history and browser-session controls.
- Reuse the existing pure cinema adapters and algorithms in a shared core. Preserve the legacy extension as an optional build while making the standalone app the default.
- Persist tasks and browser login locally. Dashboard closure does not stop jobs. Computer/service shutdown does; eligible monitors resume at restart.
- Browser handoff verifies selected seats and leaves payment/authentication to the user. Demo is explicit and never purchases anything.
- Dates/counts/preferences reach the bot; task cancellation prevents subsequent automated side effects.
- Bind local HTTP service to loopback; do not expose browser credentials or accept arbitrary navigation URLs.

## Verification

Build dashboard and bot; run deterministic domain/API/scheduler tests; exercise dashboard flows and DOM selection on local fixtures; capture dashboard screenshots. Real cinema booking depends on service availability and the user's authenticated browser session and will be reported separately from local verification.

## Live Star Cineplex inventory

Show the provider's current now-showing/coming-soon movies, published showtimes, active branches and halls with published shows. Calculate online ticket-sale state from provider status, availability, channel and effective cutoff in Bangladesh time. Refresh automatically and on demand, display last-success/stale/error state, and identify newly opened sales only after comparing successful snapshots. Never replace failed live inventory with demo or synthesized availability. Reuse the same feed for live bot discovery and allow missions pinned to a selected show. Resolve hall names only through permitted public metadata, with explicit identifier fallbacks. Verify normalization, cutoff/zero-seat states, failure recovery, task targeting and dashboard live views using deterministic fixtures and a read-only real API check.
