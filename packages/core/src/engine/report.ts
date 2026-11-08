import { z } from "zod";
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
});
export type Report = z.infer<typeof ReportSchema>;
