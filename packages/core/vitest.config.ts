import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "@paridad/core", include: ["src/**/*.test.ts"] },
});
