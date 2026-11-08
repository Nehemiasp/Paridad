import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "@paridad/ai", include: ["src/**/*.test.ts"] },
});
