import { z } from "zod";
import { BoxSchema } from "../snapshot/schema.ts";
import { CategorySchema, RuleIdSchema, SeveritySchema } from "./config.ts";

const ElementRefSchema = z.object({
  elementId: z.string(),
  name: z.string().optional(),
  /** Caja en la imagen de ese lado (px CSS), para resaltarla en el reporte. */
  box: BoxSchema,
});
export type ElementRef = z.infer<typeof ElementRefSchema>;

/** Qué se esperaba y qué se obtuvo; es la evidencia medible de un hallazgo. */
const EvidenceSchema = z.object({
  /** Propiedad medida, p. ej. «padding izquierdo». */
  property: z.string(),
  expected: z.unknown(),
  actual: z.unknown(),
  /** Diferencia numérica, si aplica. */
  delta: z.number().optional(),
  unit: z.string().optional(),
  /** Datos adicionales (ΔE, relación de contraste, color más cercano de la paleta…). */
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingSchema = z.object({
  /** Estable entre corridas con los mismos datos. */
  id: z.string(),
  rule: RuleIdSchema,
  category: CategorySchema,
  severity: SeveritySchema,
  /** Frase para el desarrollador: «Padding: diseño 16 px · código 20 px». */
  title: z.string(),
  design: ElementRefSchema.optional(),
  page: ElementRefSchema.optional(),
  evidence: EvidenceSchema,
  /** Región de la diferencia visual (para los hallazgos que no corresponden a un elemento). */
  region: z.object({ id: z.string(), box: BoxSchema }).optional(),
  /** Otros elementos afectados (descendientes de algo que falta, textos con la misma fuente caída…). */
  related: z.array(z.string()).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const CATEGORY_OF_RULE: Record<z.infer<typeof RuleIdSchema>, z.infer<typeof CategorySchema>> = {
  missing: "presencia",
  extra: "presencia",
  position: "posición",
  spacing: "posición",
  size: "tamaño",
  "text-lines": "tamaño",
  "font-family": "tipografía",
  "font-not-loaded": "tipografía",
  "font-size": "tipografía",
  "font-weight": "tipografía",
  "line-height": "tipografía",
  "letter-spacing": "tipografía",
  "color-text": "color",
  "color-background": "color",
  "color-border": "color",
  palette: "color",
  border: "color",
  radius: "tamaño",
  shadow: "color",
  opacity: "color",
  "text-content": "texto",
  "text-clipped": "texto",
  contrast: "contraste",
  "canvas-size": "página",
  "page-overflow": "página",
  "page-height": "página",
  "visual-unclassified": "visual",
};
