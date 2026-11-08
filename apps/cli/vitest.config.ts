import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "@paridad/cli", include: ["src/**/*.test.ts"], testTimeout: 60_000, fileParallelism: false },
});
