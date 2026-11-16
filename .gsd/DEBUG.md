---
status: resolved
trigger: "i tried but its not working, bot isnot taking any seats"
---

## Follow-up: API route not found (resolved)

- The production bot on port 4317 was still PID 34316, started at 01:56, before the current build at 02:31. The dashboard was served from the new build while the server kept the older routes in memory.
- A POST to `/api/tasks/00000000-0000-0000-0000-000000000000/update` reproduced `API route not found.` without changing a real mission.
- Confirmed both saved missions were idle (`awaiting_user`), backed up tasks to `.bot-data/tasks.before-api-restart.json`, and restarted only the identified bot process using the current compiled entry point.
- Verified health, dashboard HTML, both original task IDs, and the update route. The same nonexistent-ID probe now returns `Task not found.`, confirming it reaches the registered handler. No live reservation was triggered.

## Expected and observed

Expected: a matching live mission reaches the cinema browser and selects the requested seats.
Observed: both saved user missions have no discovery results, no browser handoffs and generic no-matching-seats warnings.

## Evidence

- Task for Avengers Endgame: Encore pins show `2e1439fa-f33f-478f-baa0-5ea5a719828e`, a Military Museum 11:00 show with 180 reported available seats, but filters for Bashundhara.
- Resident Evil task pins show `49b1c5c0-63ca-40dd-bb03-60193bee4ae2`, an 11:45 show at Shimanto Shambhar with 253 reported available seats, but filters for afternoon.
- TaskForm clears a pin on movie/date/source edits but retains it on branch and time edits. Discovery requires both the exact show ID and all filters, producing no matches for these combinations.

## Hypotheses

1. Confirmed configuration conflict prevents the browser path from being reached.
2. Need to check whether corrected criteria produce viable blocks with the actual public layout.
3. Need to check real booking-page seat representation and selection-state semantics; prior smoke only checked live listings and demo discovery.

## Reproduction and fixes

- Read-only discovery using the saved inputs returned zero results for both missions. Removing only the conflicting show pin returned five options for each: Bashundhara 11:45 / F08-F09 for Avengers, and Shimanto Shambhar 14:30 / E13-E14 for Resident Evil. No reservation was performed.
- A browser regression failed before the fix because branch edits still submitted `targetShowId: show-open`. Scope-changing branch/time/strategy edits now unpin the old show.
- Existing missions can be edited and retried in place with Adjust search. The pin shows its actual branch/time and has an explicit Unpin show control. Backend discovery explains conflicting pin/branch/time criteria instead of returning a generic empty result.
- A second browser regression reproduced failure on right-to-left numbering. Physical adjacency now accepts increasing or decreasing consecutive labels. Opaque provider IDs no longer override the accessible seat label.
- The public page redirects to `starcineplex.com`; its shipped client uses gridcell `aria-selected`, generic-button `aria-pressed`, `data-seat-state`, opaque `data-seat-id`, and incremental row hydration. The adapter now accepts these selected-state signals, respects explicit read-only/disabled markers, and waits for requested rows to render.
- Four targeted browser regressions pass, including editing an existing conflicting mission and keeping its ID. The production build, 76 unit/API tests and all 11 browser tests pass. A real paid reservation was not executed; the user's next retry remains the end-to-end confirmation with their cinema session.

## Next actions

Reproduce the discovery conflict without reservations, add regression coverage, clear pins when show-defining preferences change, provide actionable conflict feedback/recovery, and verify the selection adapter against observed markup through local fixtures.
