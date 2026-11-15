# Whole-system inspection

Historical note: this report describes the extension before the standalone migration. Current operation is documented in [README.md](README.md) and [ARCHITECTURE.md](ARCHITECTURE.md). Some findings are addressed in the new runtime; the retained legacy extension is not represented as fully repaired.

Inspection date: 2026-11-16. Scope: application architecture, popup flows, worker orchestration, content bridge, adapters, algorithms, persistence, dependencies, build, tests and development scaffolding.

The code provides a working build and a substantial extension scaffold. Its current success messages do not establish that requested seats are available or held. Real booking reliability is the main issue to address before adding features.

## Verification baseline

| Check | Result |
| --- | --- |
| `npm.cmd run build` | Passed: TypeScript checking, Vite production bundle and postbuild completed |
| `npm.cmd test -- --run` | 45 passed, 2 failed across 5 files; both failures are live Star Cineplex tests, with `fetch failed` / `connect EACCES` under restricted network access |
| `npm.cmd run lint` | Failed: ESLint configuration file missing |
| `npm.cmd run test:e2e -- --list` | Failed: Playwright discovers Vitest suites, throws on their `describe` calls, then reports zero E2E tests |
| `npm.cmd ls --depth=0` | Passed; installed direct dependencies resolved |
| GSD `scripts/validate-all.ps1` | Passed: 27 workflows, 12 skills, 5 agent definitions, 24 templates and 8 PowerShell scripts; 17 nonfatal template warnings |
| Generated content bridge parsed with Node `vm.Script` | Passed as a classic script; no module syntax packaging failure observed |
| Targeted diagnostics against source with mocked I/O | Reproduced zero-inventory, fail-open recheck, adjacency, center scoring, insufficient fulfillment and stop-during-check issues below |

The two live test failures do not establish that the external service is down. No live Chrome extension loading, authenticated booking, browser worker suspension test or payment flow was performed. Build success is compilation evidence, not end-to-end booking evidence.

## Findings, ordered by impact

### 1. High: live per-seat availability is synthesized

Locations: `extension/src/adapters/star-cineplex/adapter.ts:335`, `:392`, `:516`.

`parseApiSeatMap` reads physical layout and aggregate show counts, then invents occupied seat IDs using seeded clusters. It deliberately occupies back rows before B-F. This cannot determine which particular seats are free. A layout request failure or missing map ID produces a synthetic 160-seat map with every seat marked available. The `availableSeats || totalCapacity` expression also converts zero to full availability.

Mocked diagnostic: a real-adapter input with `totalSeats: 4`, `availableSeats: 0` and a four-seat layout produced `availableSeats: 4` and available labels `B1,B2,B3,B4`.

Repair direction: obtain authoritative per-show seat status through a supported data source or verified live page state; represent unknown status explicitly and exclude it from reservable results. Keep simulated maps inside an explicit demo mode.

### 2. High: reservation and booked states precede verification

Locations: `extension/src/adapters/star-cineplex/adapter.ts:581`; `extension/src/background/service-worker.ts:246`, `:354`; `extension/src/services/sniper-engine.ts:413`, `:526`; `extension/src/content/bridge.ts:167`, `:277`.

Availability rechecking returns available on HTTP errors, missing shows or fetch failures. Mocking HTTP 503 returned `{available:true,remainingSeats:2}` for a two-seat request.

The worker returns `success: true` after scheduling a tab handoff, including when tab creation fails or there is no booking URL. It does not await or validate the content script's response. Sniper marks `booked` and sends a secured-seats notification before DOM selection completes. Adapter selection/cart/checkout methods are success stubs.

The bridge counts clicks without checking whether the site accepted selection. It proceeds if any seat was clicked and returns success for a nonzero count, even if the requested count was not met. The modal also completes its initial availability step after a delay before receiving a backend result.

Repair direction: track distinct candidate, selecting, selection-verified, hold-verified and payment/confirmation states. Fail or return unknown on unavailable verification. Report success only with the exact accepted seat set and a verified booking-page outcome.

### 3. High: stop/reset and pending reservations can cause later unintended actions

Locations: `extension/src/services/sniper-engine.ts:156`, `:197`, `:233`; `extension/src/background/service-worker.ts:432`, `:640`; `extension/src/content/bridge.ts:52`.

Stopping the engine clears its timer and active flag, but an already-running check still calls `handleSeatFound` when it resolves. A deferred-check diagnostic that called stop before returning a match ended with `status: 'booked'`, `active: false`.

Instant discovery checks its operation ID after discovery, but does not guard every later reservation side effect. Reset and popout cleanup remove `pendingReservation` but leave the newer `pendingReservations` map. The content bridge may consume the legacy singleton on a different show's seat page without matching its `showId`. Reading and rewriting the whole map in separate tabs can also lose updates.

Repair direction: use an operation generation/token and cancellation at every async boundary before navigation, storage or DOM actions. Bind commands to show, tab and operation IDs; clear both pending forms on reset and acknowledge consumption atomically through the worker.

### 4. High: seating fallbacks violate advertised continuity and row constraints

Locations: `extension/src/algorithms/seat-block/index.ts:144`, `:237`; `extension/src/background/service-worker.ts:207`; `extension/src/services/sniper-engine.ts:339`, `:389`; `extension/src/content/bridge.ts:249`.

Numeric adjacency is accepted even when explicit adjacency lists do not contain the neighbor. Section boundaries and `aisle` flags are not checked by `isContiguous`. The Star adapter constructs adjacency from numbers while discarding layout columns as physical-gap evidence.

Discovery, sniper and DOM fallbacks expand beyond selected rows and combine independent blocks. These can still be described as continuous seats. Fulfillment may return fewer seats than requested; callers accept a nonempty result rather than requiring the full count. A composite receives a fixed center score of `0.88`.

Diagnostics: seats B1 and B2 with explicit empty adjacency lists formed a capacity-two block. Requesting three seats from two single-seat blocks returned two, with `meetsRequirement: false`; discovery/sniper fallback callers only check that the selection is nonempty.

Repair direction: distinguish hard constraints from preferences and require explicit user choice for split seating or other rows. Respect known adjacency/sections/aisles, and reject incomplete groups before checkout.

### 5. High: the instant-search date is ignored and other preferences silently relax

Locations: `extension/src/popup/components/SearchForm.tsx:41`, `:73`, `:296`; `extension/src/popup/App.tsx:22`, `:263`; `extension/src/background/service-worker.ts:125`.

The form renders a Specific Date field and updates local state, but its submit type and payload contain no date. `SearchParams` and `DiscoveryRequest` also omit it. Instant search can therefore reserve another date.

Branch/time narrowing falls back to all candidates when no matches exist. Row constraints similarly relax later. This is especially consequential because the normal submit path automatically reserves results. Sniper date matching is implemented, but it only searches `movies[0]`, and category preference also falls back when no category matches.

Repair direction: carry date end to end; define which selections are mandatory and reject mismatches before reservation. Make relaxation visible and selectable.

### 6. Medium: sniper state updates and audio are incomplete

Locations: `extension/src/services/sniper-engine.ts:54`; `extension/src/popup/App.tsx:228`; `extension/src/content/bridge.ts:38`, `:544`; `extension/src/utils/audio.ts:8`.

The engine exposes state-change listeners, and popup/content code listens for `SNIPER_STATE_CHANGED`, but no caller subscribes to `onStateChange` and broadcasts that message. The popup reads initial state only, so counters and completion can remain stale while it stays open. A content page that loads before activation also lacks a wired state push to start its HUD/heartbeat.

The worker calls a sound helper that accesses `window.AudioContext`. The source diagnostic logged `ReferenceError: window is not defined`; the helper catches the error. A worker-capable audio path or a document-side alert is needed. Alarm cadence and worker resume behavior remain unverified in Chrome.

Repair direction: wire state delivery to popup and matching tabs, synchronize storage readiness, and play audio from a suitable extension document.

### 7. Medium: center and default price ranking are mathematically misleading

Locations: `extension/src/types/seat.ts:85`; `extension/src/algorithms/ranking/scorer.ts:154`, `:254`.

`createSeatBlock` uses the block's seat count as if it were the full row width, while comparing it to absolute seat numbers. Diagnostic scores were `1` for B1-B2 and `-3` for B9-B10. The helper lacks full-row geometry, so true row centering cannot be calculated from its inputs. Negative values propagate into ranking.

Without a supplied maximum price, every positive show price gets the same price score: `(2p-p)/(2p-0.5p) = 2/3`. This factor cannot distinguish cheap and expensive shows by default. Sniper takes the first eligible show/block rather than applying the weighted ranker.

Repair direction: score against actual row bounds/geometry, keep scores in range and compare prices against a common result-set or configured reference.

### 8. Medium: demo fallback can masquerade as a completed live handoff

Locations: `extension/src/background/service-worker.ts:70`, `:122`, `:354`; `extension/src/adapters/demo/adapter.ts:57`.

Demo is enabled during ordinary worker startup. If live results are missing, demo results remain eligible. Its shows have a fixed date `2026-09-10`, aggregate availability zero and no booking URL. Discovery falls back even when aggregate counts are insufficient, then uses a generated map. The reservation handler can report success with an empty URL, leading to an auto-booked view with no usable booking tab. Demo cinema names do identify themselves as demo, but they do not prevent the success path.

Repair direction: make demo an explicit mode and exclude simulated results from live reservation actions.

### 9. Medium: checks and repository hygiene need a reliable baseline

Locations: root `package.json`; `extension/vitest.config.ts`; `node_modules/`; `tests/`; `.github/workflows/`.

Lint has no configuration. E2E discovery is not isolated from Vitest. Live network tests run with ordinary unit tests, so an offline or restricted environment cannot pass the full command. Unit suites do not verify DOM selection, worker messaging, pending-reservation consumption, event broadcasts or cancellation during a check.

`git ls-files` lists 8,031 tracked files under root `node_modules`. Running tests modifies a tracked Vitest cache. There is no root `.gitignore`. Zustand and the Chrome-extension Vite plugin are installed but unused in source/configuration. The build emits Vite/plugin deprecation warnings, although it succeeds.

Repair direction: separate deterministic unit tests, opt-in live integration tests and an actual extension browser suite. Configure lint and CI. Track dependency manifests/lockfile and remove generated dependency/cache content from source control through a deliberate cleanup.

### 10. Low: planning state and documentation overstate completion

Locations: `README.md`, `IMPLEMENTATION_SUMMARY.md`, `PROJECT_RULES.md`, `.gsd/`.

Documentation claims a production-grade complete MVP, backend-confirmed availability, continuous seats and successful reservation beyond what the implementation verifies. The implementation summary still reports 19 tests; inspection found 47. The roadmap lists the seat inspector as pending even though its component is implemented. GSD requires a finalized project spec before implementation, but only template/example artifacts exist; project SPEC, ROADMAP and STATE files are absent.

Repair direction: establish the product requirements and acceptance criteria, then align documentation with demonstrated capabilities.

## Recommended repair sequence

1. Establish authoritative seat state and remove optimistic success/fail-open behavior. Add meaningful regression coverage for these failures.
2. Implement a verified booking state machine with cancellation and show/tab-bound reservation commands.
3. Enforce the selected date, seat count, continuity, rows and other mandatory constraints throughout UI, worker and DOM paths.
4. Wire sniper status delivery and validate scheduling, restart/resume, notifications and document-side sound in Chrome.
5. Correct ranking inputs, isolate demo mode, configure lint/E2E/CI and clean tracked generated files.

Acceptance evidence should include exact accepted seats on a supported page, a verified hold or clear manual handoff, no actions after stop/reset, preserved constraints, and an extension browser test covering the full path. Payment completion stays under user control.

## Inspection artifacts

- [ARCHITECTURE.md](ARCHITECTURE.md): components, messages, state and data flow.
- [STACK.md](STACK.md): local versions, dependencies, integrations and commands.
- This report: defects, observed evidence, limitations and repair order.

This inspection adds documentation only. It does not repair the application defects listed above.
