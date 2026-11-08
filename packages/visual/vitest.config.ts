import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "@paridad/visual", include: ["src/**/*.test.ts", "test/**/*.test.ts"] },
});
