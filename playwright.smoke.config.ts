import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/smoke",
  testMatch: "smoke.spec.ts",
  globalSetup: "./tests/smoke/setup.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  outputDir: "test-results/smoke/failures",
  use: {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
