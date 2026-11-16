import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
for (const arg of args)
  if (!["--live", "--skip-build"].includes(arg)) {
    console.error(`Unknown smoke option: ${arg}. Use --live or --skip-build.`);
    process.exit(2);
  }
const live = args.has("--live");
const reportDirectory = resolve(root, "test-results/smoke");
const reportFile = resolve(reportDirectory, "summary.json");
mkdirSync(reportDirectory, { recursive: true });
const mode = live ? "live" : "fixture";
writeFileSync(
  reportFile,
  JSON.stringify(
    { status: "running", mode, startedAt: new Date().toISOString() },
    null,
    2,
  ) + "\n",
);
const failed = (message, stage) =>
  writeFileSync(
    reportFile,
    JSON.stringify(
      {
        status: "failed",
        mode,
        checkedAt: new Date().toISOString(),
        stage,
        error: message,
      },
      null,
      2,
    ) + "\n",
  );
console.log(
  `\nCinebot smoke test (${live ? "real Star Cineplex API" : "deterministic inventory fixture"})`,
);
const run = (command, extraEnv = {}) => {
  const result = spawnSync(process.execPath, command, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) {
    console.error(result.error.message);
    failed(result.error.message, command[0]);
    process.exit(1);
  }
  if (result.status !== 0) {
    failed(
      `Smoke command exited with ${result.status ?? result.signal ?? "an error"}. See the console or Playwright failure trace.`,
      command[0],
    );
    process.exit(result.status || 1);
  }
};
if (!args.has("--skip-build")) run([resolve(root, "scripts/build.mjs")]);
run(
  [
    resolve(root, "node_modules/@playwright/test/cli.js"),
    "test",
    "--config",
    resolve(root, "playwright.smoke.config.ts"),
  ],
  { CINEBOT_SMOKE_LIVE: live ? "1" : "0" },
);
