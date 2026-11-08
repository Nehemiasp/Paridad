import { z } from "zod";
import { CategorySchema, SEVERITIES, type Category, type ResolvedConfig, type Severity } from "./config.ts";
import type { Finding } from "./findings.ts";

export const ScoreSchema = z.object({
  /** 0–100, un decimal. 100 = paridad perfecta. */
  value: z.number().min(0).max(100),
  /** Cómo se llegó al número: qué restó cada categoría. */
  breakdown: z.array(
    z.object({
      category: CategorySchema,
      count: z.number().int(),
      bySeverity: z.record(z.string(), z.number().int()),
      /** Puntos que restaron los hallazgos de esta categoría, antes del tope. */
      rawPoints: z.number(),
      /** Puntos que restó de verdad, después del tope por categoría. */
      points: z.number(),
      capped: z.boolean(),
    }),
  ),
  /** La fórmula, en palabras, para que el reporte la explique. */
  formula: z.string(),
});
export type Score = z.infer<typeof ScoreSchema>;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Puntaje de paridad: 100 menos los puntos de cada hallazgo (según su severidad), con un tope por categoría
 * para que cien diferencias de 1 px no oculten un elemento que falta. Nunca baja de 0.
 */
export function computeScore(findings: Finding[], cfg: ResolvedConfig): Score {
  const points = cfg.score.points;
  const cap = cfg.score.categoryCap;
  const cats = new Map<Category, { count: number; bySeverity: Record<Severity, number>; raw: number }>();

  for (const f of findings) {
    const entry = cats.get(f.category) ?? { count: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, raw: 0 };
    entry.count++;
    entry.bySeverity[f.severity]++;
    entry.raw += points[f.severity];
    cats.set(f.category, entry);
  }

  const breakdown = [...cats]
    .map(([category, e]) => ({
      category,
      count: e.count,
      bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, e.bySeverity[s]])),
      rawPoints: round1(e.raw),
      points: round1(Math.min(e.raw, cap)),
      capped: e.raw > cap,
    }))
    .sort((a, b) => b.points - a.points);

  const total = breakdown.reduce((sum, b) => sum + b.points, 0);
  return {
    value: round1(Math.max(0, 100 - total)),
    breakdown,
    formula: `100 − puntos de los hallazgos (crítica ${points.critical}, alta ${points.high}, media ${points.medium}, baja ${points.low}), con un tope de ${cap} puntos por categoría.`,
  };
}
