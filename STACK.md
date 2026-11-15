# Technology stack

Updated 2026-11-16. Versions describe the installed lockfile, not latest upstream releases.

| Technology        | Version                                 | Role                                        |
| ----------------- | --------------------------------------- | ------------------------------------------- |
| Node.js           | 22.12+ required; 26.6.0 used for checks | Local service, HTTP/SSE and persistence     |
| TypeScript        | 5.9.3                                   | Strict app/domain checking                  |
| React / React DOM | 18.3.1                                  | Dashboard                                   |
| Vite              | 8.2.2                                   | Development and dashboard/bot builds        |
| Playwright        | 1.63.0                                  | Persistent visible browser and E2E fixtures |
| Vitest            | 5.0.0                                   | Domain, runner, store and API checks        |
| `@types/node`     | 22.x                                    | Node API types                              |

The new app uses built-in Node HTTP/filesystem APIs, native EventSource and local JSON persistence. No database, external identity service, hosted dashboard or extension runtime is required. Existing cinema endpoints are defined in the shared Star Cineplex adapter.

Workspaces are `bot`, `dashboard`, `packages/core` and retained `extension`. The shared core contains no Chrome extension or DOM runtime calls. The extension keeps its existing dependencies and build configuration.

Runtime state is stored in `.bot-data/`; browser login is in its `browser-profile/` subdirectory. Bundles are emitted to workspace `dist/` directories. New generated files are ignored by Git. Previously tracked dependencies/build artifacts have not been removed from history.

Configuration and commands are in [README.md](README.md). The standalone build does not use the legacy React Vite plugin, avoiding its Vite 8 deprecation warnings.
