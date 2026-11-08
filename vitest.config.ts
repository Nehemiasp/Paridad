import { defineConfig } from "vitest/config";

// Un proyecto por paquete: permite correr todo (`npm test`) o solo el paquete
// que se editó (`npm test -w packages/core`), que es lo que usa el hook.
export default defineConfig({
  test: {
    projects: ["packages/*", "scripts"],
  },
});
