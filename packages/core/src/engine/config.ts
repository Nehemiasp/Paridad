import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;
export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];

export const CategorySchema = z.enum(["presencia", "posición", "tamaño", "tipografía", "color", "texto", "contraste", "página", "visual"]);
export type Category = z.infer<typeof CategorySchema>;

export const RuleIdSchema = z.enum([
  "missing", "extra",
  "position", "spacing", "size", "text-lines",
  "font-family", "font-not-loaded", "font-size", "font-weight", "line-height", "letter-spacing",
  "color-text", "color-background", "color-border", "palette",
  "border", "radius", "shadow", "opacity",
  "text-content", "text-clipped", "contrast",
  "canvas-size", "page-overflow", "page-height",
  "visual-unclassified",
]);
export type RuleId = z.infer<typeof RuleIdSchema>;

const px = (n: number) => z.number().nonnegative().default(n);

/**
 * Tolerancias y criterios, todos configurables en `paridad.config.ts`.
 * Cada valor por debajo de su tolerancia se considera ruido y no se reporta.
 */
export const ConfigSchema = z.object({
  /** Diferencias por debajo de estos valores son ruido (subpíxeles, redondeos). */
  tolerances: z
    .object({
      /** px: desplazamiento de un elemento respecto a su contenedor. */
      position: px(1),
      /** px: diferencia de separación entre vecinos. */
      spacing: px(1),
      /** px: ancho o alto de cajas e imágenes. */
      size: px(1),
      /** px */
      fontSize: px(0.5),
      /** px */
      lineHeight: px(1),
      /** px */
      letterSpacing: px(0.25),
      /** ΔE2000 por debajo del cual dos colores se consideran el mismo (≈ lo que el ojo no distingue). */
      colorDeltaE: px(2),
      /** ΔE2000 máximo para decir que un color «está» en la paleta del diseño. */
      paletteDeltaE: px(2),
      /** px: grosor de borde. */
      border: px(0.5),
      /** px: radio de esquina (después de recortarlo a la mitad del lado menor). */
      radius: px(1),
      /** px: desplazamiento y desenfoque de sombras. */
      shadow: px(1),
      /** 0–1 */
      opacity: px(0.05),
      /** px: alto total de la página. */
      pageHeight: px(2),
    })
    .prefault({}),

  /** Cómo se emparejan los elementos del diseño con los del código. */
  matching: z
    .object({
      /** 0–1: similitud mínima de textos (sin distinguir mayúsculas) para considerarlos el mismo. */
      minTextSimilarity: z.number().min(0).max(1).default(0.8),
      /** px: distancia máxima entre centros para emparejar dos textos que solo se parecen (≥ 95 % de similitud no tiene límite). */
      maxDistance: px(400),
      /** px: separación máxima para considerar vecinos a dos elementos hermanos al medir el espaciado. */
      maxNeighborGap: px(200),
      /** Puntaje mínimo (IoU + bonos de jerarquía y de texto interior) para emparejar dos cajas. */
      minBoxScore: z.number().min(0).max(2).default(0.5),
    })
    .prefault({}),

  /** Umbrales que convierten una diferencia en severidad (ver la tabla en CLAUDE.md). */
  severity: z
    .object({
      /** px: hasta aquí «baja». */
      pxMedium: px(4),
      /** px: hasta aquí «media»; más allá, «alta». */
      pxHigh: px(12),
      /** ΔE: hasta aquí «baja». */
      deltaEMedium: px(4),
      /** ΔE: hasta aquí «media»; más allá, «alta». */
      deltaEHigh: px(10),
      /** px de tamaño de fuente. */
      fontSizeMedium: px(1),
      fontSizeHigh: px(3),
      /** Fracción del lienzo que ocupa una diferencia visual sin explicar para ser «alta». */
      regionRatioHigh: px(0.02),
      /** Fracción del lienzo desde la que es «media»; por debajo, «baja». */
      regionRatioMedium: px(0.002),
    })
    .prefault({}),

  contrast: z
    .object({
      /** Relación mínima WCAG AA para texto normal. */
      normal: z.number().positive().default(4.5),
      /** Relación mínima WCAG AA para texto grande. */
      large: z.number().positive().default(3),
      /** px: tamaño desde el que un texto es «grande». */
      largeTextPx: px(24),
      /** px: tamaño desde el que un texto en negrita (≥700) es «grande». */
      largeBoldPx: px(18.66),
    })
    .prefault({}),

  score: z
    .object({
      /** Puntos que resta cada hallazgo, según su severidad. */
      points: z.object({ critical: px(15), high: px(6), medium: px(2), low: px(0.5) }).prefault({}),
      /** Tope de puntos que puede restar una sola categoría. */
      categoryCap: px(40),
    })
    .prefault({}),

  /** Reglas apagadas. */
  disabledRules: z.array(RuleIdSchema).default([]),
});

export type ParidadConfig = z.input<typeof ConfigSchema>;
export type ResolvedConfig = z.output<typeof ConfigSchema>;

/** Para `paridad.config.ts`: `export default defineConfig({ tolerances: { position: 2 } })`. */
export function defineConfig(config: DeepPartial<ParidadConfig>): DeepPartial<ParidadConfig> {
  return config;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Completa lo que falte con los valores por defecto y valida (con mensajes en español). */
export function resolveConfig(partial: DeepPartial<ParidadConfig> = {}): ResolvedConfig {
  const r = ConfigSchema.safeParse(partial, { error: z.locales.es().localeError });
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  - ${i.path.join(".") || "(raíz)"}: ${i.message}`).join("\n");
  throw new Error(`La configuración de Paridad no es válida:\n${lines}`);
}
