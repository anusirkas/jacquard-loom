import { defineConfig } from "vitest/config";

export default defineConfig({
  // unit tests live next to the code; Playwright specs in e2e/ run separately
  test: { include: ["src/**/*.test.ts"] },
});
