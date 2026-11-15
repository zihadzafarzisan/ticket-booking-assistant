---
phase: 1
plan: migration
wave: 1
depends_on: []
autonomous: true
---

# Standalone conversion

## Task 1: Domain and execution

Files: `packages/core/src/**`, legacy extension re-export modules, `bot/src/**`, `bot/package.json`.
Action: share pure domain code, implement validated local API and durable task runner, adapt DOM seat selection to Playwright, preserve a persistent browser profile and cancellation.
Verify: domain, scheduler, persistence and API tests; bot production build.
Done: jobs operate without extension APIs, persist and stop reliably, and hand off to a visible cinema browser.

## Task 2: Dashboard

Files: `dashboard/**`.
Action: implement connected overview, create/search/monitor forms, result and seat views, job controls, logs/history and session settings.
Verify: typecheck/build and local browser interaction tests with screenshots.
Done: all principal extension flows are available in the dashboard and status survives reconnects.

## Task 3: Integration

Files: root npm scripts/configuration, `scripts/start*`, tests and documentation.
Action: make standalone app the default, retain an explicit legacy extension command, document setup/limits and verify the complete local path.
Verify: root build/test, HTTP requests, browser fixture flow, screenshots.
Done: the user can start the bot and dashboard with one command and requires no extension.
