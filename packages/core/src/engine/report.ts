import { z } from "zod";
import { BoxSchema } from "../snapshot/schema.ts";
import { CategorySchema, SeveritySchema } from "./config.ts";
import { FindingSchema } from "./findings.ts";
import { ScoreSchema } from "./score.ts";

const SideSchema = z.object({
  name: z.string(),
  origin: z.object({ figma: z.object({ fileKey: z.string(), nodeId: z.string() }).optional(), url: z.string().optional() }),
  capturedAt: z.string(),
  canvas: z.object({ width: z.number(), height: z.number(), scale: z.number() }),
  /** Rutas relativas al reporte, si la corrida guardó los archivos. */
  snapshotPath: z.string().optional(),
  imagePath: z.string().optional(),
});

const VisualRegionSchema = z.object({
  id: z.string(),
  /** px CSS, coordenadas del lienzo alineado. */
  box: BoxSchema,
  diffPixels: z.number().int(),
  /** Píxeles distintos / área de la región. */
  ratio: z.number(),
  /** Hallazgos de las reglas que explican esta región (vacío = sin clasificar). */
  findingIds: z.array(z.string()),
  classified: z.boolean(),
});

/** Resultado de la diferencia por píxeles, cruzado con los hallazgos. */
export const VisualSchema = z.object({
  /** Ruta del mapa de calor, relativa al reporte. */
  heatmapPath: z.string().optional(),
  aligned: z.object({ width: z.number(), height: z.number(), scale: z.number() }),
  diffPixels: z.number().int(),
  totalPixels: z.number().int(),
  ignoredPixels: z.number().int(),
  diffRatio: z.number(),
  widthMismatch: z.boolean(),
  regions: z.array(VisualRegionSchema),
});
export type Visual = z.infer<typeof VisualSchema>;

/** El reporte que produce `compare`: hallazgos con evidencia, puntaje y cómo se emparejó todo. */
export const ReportSchema = z.object({
  schemaVersion: z.literal(1),
  createdAt: z.string(),
  design: SideSchema,
  page: SideSchema,
  score: ScoreSchema,
  summary: z.object({
    total: z.number().int(),
    bySeverity: z.record(SeveritySchema, z.number().int()),
    byCategory: z.partialRecord(CategorySchema, z.number().int()),
  }),
  matching: z.object({
    pairs: z.number().int(),
    missing: z.number().int(),
    extra: z.number().int(),
    ignoredInDesign: z.number().int(),
    ignoredInPage: z.number().int(),
  }),
  findings: z.array(FindingSchema),
  /** Presente si se comparó también por píxeles (Fase 4). */
  visual: VisualSchema.optional(),
});
export type Report = z.infer<typeof ReportSchema>;
