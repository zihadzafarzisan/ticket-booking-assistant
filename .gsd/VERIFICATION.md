# Standalone migration verification

Updated: 2026-11-16

| Requirement | Evidence |
| --- | --- |
| Runs without extension | Built Node entrypoint serves dashboard with HTTP 200; shared core has no extension runtime dependency |
| Instant discovery and preferences | Unit tests verify explicit date, time and row constraints, branch mismatch rejection and complete seat groups |
| Scheduled monitoring | Unit and browser tests verify schedules do not check early, errors keep monitors alive, saved monitors restore and stop works |
| Durable local state | Store tests cover persistence, readable serialized writes and restoration; dashboard browser test verifies reconnect |
| Verified browser handoff | Intercepted cinema fixture tests cover selected seats → checkout, rejected clicks, already-cancelled operations and preselected extra tickets |
| Dashboard workflows | E2E creates demo mission, inspects block, reconnects, marks complete and removes fixture task |
| Responsive dashboard | Mobile flow passes at 390px with no document horizontal overflow; screenshot reviewed |
| Compatibility | Legacy extension production build passes using shared core |

Checks: standalone production build passed; 60 deterministic tests passed; six E2E tests passed. Production API and dashboard respond successfully. No real tickets were reserved or purchased.

The in-app browser preview host was unavailable. Visual QA used screenshots from the repository's Playwright tests instead. Authenticated cinema checkout remains an integration check requiring the user's real browser session.
