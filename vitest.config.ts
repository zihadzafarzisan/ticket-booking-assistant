import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["bot/src/**/*.test.ts", "extension/src/**/*.test.ts"],
    exclude: ["extension/src/adapters/star-cineplex/**"],
    testTimeout: 10_000,
  },
});
