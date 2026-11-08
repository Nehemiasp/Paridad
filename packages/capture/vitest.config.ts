import { defineConfig } from "vitest/config";

export default defineConfig({
  // Estas pruebas abren Chromium de verdad: tiempos más holgados y un archivo a la vez.
  test: { name: "@paridad/capture", include: ["src/**/*.test.ts", "test/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});
