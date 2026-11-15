import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["extension/src/adapters/star-cineplex/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
