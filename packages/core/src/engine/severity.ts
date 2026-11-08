import type { ResolvedConfig, Severity } from "./config.ts";
import { SEVERITIES } from "./config.ts";

/** Diferencia en px → severidad (la tolerancia ya la filtró): baja ≤ pxMedium < media ≤ pxHigh < alta. */
export function severityForPx(delta: number, cfg: ResolvedConfig): Severity {
  const d = Math.abs(delta);
  if (d <= cfg.severity.pxMedium) return "low";
  return d <= cfg.severity.pxHigh ? "medium" : "high";
}

/** ΔE2000 → severidad: baja ≤ deltaEMedium < media ≤ deltaEHigh < alta. */
export function severityForDeltaE(de: number, cfg: ResolvedConfig): Severity {
  if (de <= cfg.severity.deltaEMedium) return "low";
  return de <= cfg.severity.deltaEHigh ? "medium" : "high";
}

/** Baja un nivel (el problema existe pero tiene atenuante); «baja» se queda en «baja». */
export function lowered(s: Severity): Severity {
  const i = SEVERITIES.indexOf(s);
  return SEVERITIES[Math.min(SEVERITIES.length - 1, i + 1)]!;
}

/** Sube la severidad hasta, como mínimo, `min`. */
export function atLeast(s: Severity, min: Severity): Severity {
  return SEVERITIES.indexOf(s) <= SEVERITIES.indexOf(min) ? s : min;
}
