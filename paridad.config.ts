import { defineConfig } from "@paridad/core";

/**
 * Tolerancias y criterios de Paridad. Todo lo que no se escriba aquí toma el valor por defecto
 * (ver `ConfigSchema` en packages/core/src/engine/config.ts y la sección «Severidad» de CLAUDE.md).
 */
export default defineConfig({
  tolerances: {
    // Diferencias menores a estos px (o ΔE) son ruido y no se reportan.
    position: 1,
    spacing: 1,
    size: 1,
    colorDeltaE: 2,
  },
  // disabledRules: ["opacity"],
});
