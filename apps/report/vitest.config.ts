import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "@paridad/report", include: ["src/**/*.test.ts"], testTimeout: 240_000, hookTimeout: 240_000, fileParallelism: false },
});
