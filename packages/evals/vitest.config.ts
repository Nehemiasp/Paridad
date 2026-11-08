import { defineConfig } from "vitest/config";

// Estas pruebas abren Chromium de verdad; la evaluación completa de mutaciones tarda decenas de segundos.
export default defineConfig({
  test: { name: "@paridad/evals", include: ["src/**/*.test.ts"], testTimeout: 240_000, hookTimeout: 120_000, fileParallelism: false },
});
