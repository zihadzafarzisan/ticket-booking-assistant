import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const node = process.execPath;
const commands = [
  [
    resolve("node_modules/typescript/bin/tsc"),
    "-p",
    "bot/tsconfig.json",
    "--noEmit",
  ],
  [
    resolve("node_modules/typescript/bin/tsc"),
    "-p",
    "dashboard/tsconfig.json",
    "--noEmit",
  ],
  [
    resolve("node_modules/vite/bin/vite.js"),
    "build",
    "--config",
    "bot/vite.config.ts",
  ],
  [
    resolve("node_modules/vite/bin/vite.js"),
    "build",
    "--config",
    "dashboard/vite.config.ts",
  ],
];
for (const command of commands) {
  const result = spawnSync(node, command, {
    stdio: "inherit",
    cwd: resolve("."),
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
