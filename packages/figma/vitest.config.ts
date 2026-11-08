import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "@paridad/figma", include: ["src/**/*.test.ts", "test/**/*.test.ts"] },
});
