import { z } from "zod";
import { normalizeText } from "./text.ts";

/** Versión del formato. Se incrementa ante cualquier cambio incompatible. */
export const SCHEMA_VERSION = 1 as const;

// ── Primitivas ────────────────────────────────────────────────────────────────

/** Color como `#rrggbb` o `#rrggbbaa`, siempre en minúsculas. */
export const HexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/, "debe ser un color #rrggbb o #rrggbbaa en minúsculas");
export type HexColor = z.infer<typeof HexColorSchema>;

/** Rectángulo en píxeles CSS, con origen en la esquina superior izquierda del lienzo. */
export const BoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type Box = z.infer<typeof BoxSchema>;

// ── Estilos ───────────────────────────────────────────────────────────────────

export const BorderSchema = z.object({
  width: z.number().nonnegative(),
  style: z.enum(["solid", "dashed", "dotted", "double"]).optional(),
  color: HexColorSchema,
});

export const ShadowSchema = z.object({
  x: z.number(),
  y: z.number(),
  blur: z.number().nonnegative(),
  spread: z.number(),
  color: HexColorSchema,
  inset: z.boolean().optional(),
});

export const StyleSchema = z.object({
  fontFamily: z.string().min(1).optional(),
  /**
   * Fuente que el navegador pintó de verdad (puede diferir de `fontFamily` si la fuente no cargó).
   * Solo la llena la captura de la página; Figma no la informa.
   */
  renderedFontFamily: z.string().min(1).optional(),
  /** px */
  fontSize: z.number().positive().optional(),
  /** 100–900 */
  fontWeight: z.number().int().min(1).max(1000).optional(),
  /** px; `null` = «normal» (el navegador o Figma lo calcula). */
  lineHeight: z.number().positive().nullable().optional(),
  /** px; 0 = sin espaciado adicional. */
  letterSpacing: z.number().optional(),
  color: HexColorSchema.optional(),
  background: HexColorSchema.optional(),
  border: BorderSchema.optional(),
  /** Un valor para las cuatro esquinas, o [arriba-izq, arriba-der, abajo-der, abajo-izq]. */
  radius: z.union([z.number().nonnegative(), z.tuple([z.number(), z.number(), z.number(), z.number()])]).optional(),
  shadows: z.array(ShadowSchema).optional(),
  /** 0–1 */
  opacity: z.number().min(0).max(1).optional(),
});
export type Style = z.infer<typeof StyleSchema>;

// ── Elementos ─────────────────────────────────────────────────────────────────

export const ClipReasonSchema = z.enum(["overflow", "ellipsis", "line-clamp"]);
export type ClipReason = z.infer<typeof ClipReasonSchema>;

export const TextContentSchema = z.object({
  /** Texto tal como aparece. */
  content: z.string(),
  /** `normalizeText(content)`; es lo que se usa para emparejar. */
  normalized: z.string(),
  /** Presente solo si el texto está cortado o desbordado. */
  clipped: z.object({ reason: ClipReasonSchema }).optional(),
});

export const ImageContentSchema = z.object({
  src: z.string().optional(),
  alt: z.string().optional(),
});

export const ElementSchema = z.object({
  /** Único dentro del snapshot. */
  id: z.string().min(1),
  kind: z.enum(["text", "box", "image"]),
  /** Nombre legible (capa de Figma, o etiqueta/clase del DOM). */
  name: z.string().optional(),
  /** Ruta de origen: selector DOM o ruta de capas de Figma. */
  path: z.string().optional(),
  /** `null` para los elementos de primer nivel. */
  parentId: z.string().min(1).nullable(),
  /** Orden de pintura (mayor = encima). Se usa para el fondo efectivo. */
  z: z.number().int(),
  box: BoxSchema,
  text: TextContentSchema.optional(),
  style: StyleSchema,
  image: ImageContentSchema.optional(),
});
export type SnapshotElement = z.infer<typeof ElementSchema>;

// ── Lienzo, paleta, zonas a ignorar ──────────────────────────────────────────

export const CanvasSchema = z.object({
  /** px CSS. */
  width: z.number().positive(),
  height: z.number().positive(),
  /** Factor de escala de la imagen respecto a los px CSS. */
  scale: z.union([z.literal(1), z.literal(2)]),
  image: z
    .object({
      /** Ruta relativa al snapshot. */
      path: z.string().min(1),
      /** px de la imagen (= width × scale, height × scale). */
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
});

export const PaletteSchema = z.object({
  colors: z.array(z.object({ hex: HexColorSchema, name: z.string().optional() })),
  fonts: z.array(z.object({ family: z.string().min(1), weights: z.array(z.number().int()) })),
});

export const IgnoreZoneSchema = z.union([
  z.object({ selector: z.string().min(1) }),
  z.object({ rect: BoxSchema }),
]);

export type IgnoreZone = z.infer<typeof IgnoreZoneSchema>;

export const MetaSchema = z.object({
  name: z.string().min(1),
  /** ISO 8601. */
  capturedAt: z.iso.datetime(),
  origin: z
    .object({
      figma: z.object({ fileKey: z.string().min(1), nodeId: z.string().min(1) }).optional(),
      url: z.string().min(1).optional(),
    })
    .default({}),
  tool: z.string().optional(),
});

// ── Snapshot ─────────────────────────────────────────────────────────────────

const BaseSnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  source: z.enum(["design", "page"]),
  meta: MetaSchema,
  canvas: CanvasSchema,
  palette: PaletteSchema.optional(),
  ignore: z.array(IgnoreZoneSchema).default([]),
  elements: z.array(ElementSchema),
});

/**
 * Snapshot: la representación común del frame de Figma y de la página construida.
 * Incluye validaciones cruzadas que un esquema por campo no puede expresar.
 */
export const SnapshotSchema = BaseSnapshotSchema.superRefine((snap, ctx) => {
  const byId = new Map<string, number>();

  snap.elements.forEach((el, i) => {
    if (byId.has(el.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["elements", i, "id"],
        message: `el id «${el.id}» está repetido (también en elements[${byId.get(el.id)}])`,
      });
    } else {
      byId.set(el.id, i);
    }
  });

  snap.elements.forEach((el, i) => {
    if (el.parentId !== null) {
      if (el.parentId === el.id) {
        ctx.addIssue({ code: "custom", path: ["elements", i, "parentId"], message: "un elemento no puede ser su propio padre" });
      } else if (!byId.has(el.parentId)) {
        ctx.addIssue({
          code: "custom",
          path: ["elements", i, "parentId"],
          message: `el padre «${el.parentId}» no existe en el snapshot`,
        });
      }
    }

    if (el.kind === "text" && !el.text) {
      ctx.addIssue({ code: "custom", path: ["elements", i, "text"], message: "un elemento de tipo «text» requiere el campo text" });
    }
    if (el.kind !== "text" && el.text) {
      ctx.addIssue({ code: "custom", path: ["elements", i, "text"], message: "solo los elementos de tipo «text» llevan text" });
    }
    if (el.kind !== "image" && el.image) {
      ctx.addIssue({ code: "custom", path: ["elements", i, "image"], message: "solo los elementos de tipo «image» llevan image" });
    }
    if (el.text && el.text.normalized !== normalizeText(el.text.content)) {
      ctx.addIssue({
        code: "custom",
        path: ["elements", i, "text", "normalized"],
        message: `no coincide con el texto normalizado («${normalizeText(el.text.content)}»)`,
      });
    }
  });

  // Ciclos: se recorre la cadena de padres de cada elemento (los padres inexistentes ya se reportaron).
  const parentOf = new Map(snap.elements.map((el) => [el.id, el.parentId] as const));
  snap.elements.forEach((el, i) => {
    const seen = new Set<string>([el.id]);
    let cur = el.parentId;
    while (cur !== null && cur !== undefined) {
      if (seen.has(cur)) {
        ctx.addIssue({ code: "custom", path: ["elements", i, "parentId"], message: "la jerarquía de padres forma un ciclo" });
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  });

  // Imagen del lienzo coherente con la escala.
  const img = snap.canvas.image;
  if (img) {
    const w = Math.round(snap.canvas.width * snap.canvas.scale);
    const h = Math.round(snap.canvas.height * snap.canvas.scale);
    if (img.width !== w || img.height !== h) {
      ctx.addIssue({
        code: "custom",
        path: ["canvas", "image"],
        message: `la imagen mide ${img.width}×${img.height}, pero el lienzo a escala ${snap.canvas.scale} debería medir ${w}×${h}`,
      });
    }
  }

  // Zonas a ignorar por rectángulo: dentro del lienzo.
  snap.ignore.forEach((zone, i) => {
    if ("rect" in zone) {
      const r = zone.rect;
      if (r.x < 0 || r.y < 0 || r.x + r.width > snap.canvas.width || r.y + r.height > snap.canvas.height) {
        ctx.addIssue({ code: "custom", path: ["ignore", i, "rect"], message: "el rectángulo queda fuera del lienzo" });
      }
    }
  });
});

export type Snapshot = z.output<typeof SnapshotSchema>;
export type SnapshotInput = z.input<typeof SnapshotSchema>;
