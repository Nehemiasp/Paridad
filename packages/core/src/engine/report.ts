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
  /** Hallazgos de las reglas que explican esta región. */
  findingIds: z.array(z.string()),
  classified: z.boolean(),
  /**
   * Cómo se explicó: una regla, el alto de la página, un desplazamiento (el contenido del diseño pero corrido: consecuencia
   * de un cambio de layout) o la tolerancia (un elemento emparejado sin hallazgos: ruido de render). Ausente = sin clasificar.
   */
  explainedBy: z.enum(["regla", "alto-de-pagina", "desplazamiento", "tolerancia"]).optional(),
  /** px CSS, si se explicó por desplazamiento. */
  shift: z.object({ dx: z.number(), dy: z.number() }).optional(),
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

const AiGroupSchema = z.object({
  id: z.string(),
  /** Título corto del grupo, p. ej. «Las tarjetas están 4 px más abajo». */
  title: z.string(),
  /** Explicación en lenguaje claro para el desarrollador; solo usa cifras de los hallazgos que cita. */
  explanation: z.string(),
  /** Hallazgos del motor que resume este grupo (siempre existen en `findings`). */
  findingIds: z.array(z.string()).min(2),
  /** Sugerencia de corrección en CSS; vacía si la evidencia no basta para una exacta. */
  cssFix: z.string(),
});

/** Salida de la capa de IA: solo reordena y redacta lo que midió el motor; no agrega ni quita hallazgos de `findings`. */
export const AiSectionSchema = z.object({
  model: z.string(),
  /** `claude` = llamada real; `simulado` = prueba de la tubería sin modelo (no mide a Claude). */
  mode: z.enum(["claude", "simulado"]),
  groups: z.array(AiGroupSchema),
  /** Hallazgos que la IA propone tratar como ruido (siguen en `findings`; el reporte los pliega). */
  discarded: z.array(z.object({ findingId: z.string(), reason: z.string() })),
  /** Cosas que la IA devolvió y se rechazaron por no apoyarse en un hallazgo con su evidencia. */
  rejected: z.array(z.object({ what: z.string(), reason: z.string() })),
  usage: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int(), cacheReadTokens: z.number().int() }),
  /** USD de esta corrida (0 si salió de la caché local). */
  costUsd: z.number(),
  cacheHit: z.boolean(),
  /** Imágenes recortadas que se enviaron. */
  imagesSent: z.number().int(),
  warnings: z.array(z.string()),
});
export type AiSection = z.infer<typeof AiSectionSchema>;

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
    /** Qué elemento del diseño se emparejó con cuál de la página (para resaltar y para clasificar diferencias visuales). */
    pairList: z.array(z.object({ designId: z.string(), pageId: z.string() })),
    missing: z.number().int(),
    extra: z.number().int(),
    ignoredInDesign: z.number().int(),
    ignoredInPage: z.number().int(),
  }),
  findings: z.array(FindingSchema),
  /** Presente si se comparó también por píxeles (Fase 4). */
  visual: VisualSchema.optional(),
  /** Presente solo con `--ai` (Fase 6). */
  ai: AiSectionSchema.optional(),
});
export type Report = z.infer<typeof ReportSchema>;
