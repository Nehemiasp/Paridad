import { assertSnapshot, normalizeText, type Snapshot, type SnapshotInput } from "@paridad/core";

// ── Forma (parcial y tolerante) de los nodos de la API REST de Figma ───────────
interface Rect { x: number; y: number; width: number; height: number }
interface Rgba { r: number; g: number; b: number; a?: number }
interface Paint { type: string; visible?: boolean; opacity?: number; color?: Rgba }
interface Effect { type: string; visible?: boolean; color?: Rgba; offset?: { x: number; y: number }; radius?: number; spread?: number }
interface TextStyle {
  fontFamily?: string; fontWeight?: number; fontSize?: number; letterSpacing?: number;
  lineHeightPx?: number; lineHeightUnit?: string; textCase?: string;
}
interface FNode {
  id: string; name?: string; type: string; visible?: boolean; opacity?: number; rotation?: number;
  children?: FNode[];
  absoluteBoundingBox?: Rect | null; absoluteRenderBounds?: Rect | null;
  fills?: Paint[]; strokes?: Paint[]; strokeWeight?: number; strokeAlign?: string;
  individualStrokeWeights?: { top: number; right: number; bottom: number; left: number };
  cornerRadius?: number; rectangleCornerRadii?: number[]; effects?: Effect[];
  characters?: string; style?: TextStyle; characterStyleOverrides?: number[]; styleOverrideTable?: Record<string, TextStyle & { fills?: Paint[] }>;
  styles?: Record<string, string>;
}

const CONTAINERS = new Set(["FRAME", "GROUP", "COMPONENT", "COMPONENT_SET", "INSTANCE", "SECTION", "TRANSFORM_GROUP"]);
const BOXES = new Set(["RECTANGLE", "ELLIPSE"]);
const VECTORS = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE"]);

const r2 = (n: number): number => Math.round(n * 100) / 100;
const h2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0");

/** Color de Figma (0–1) × opacidad del relleno → `#rrggbb[aa]`. */
function hex(c: Rgba, paintOpacity = 1): string {
  const a = (c.a ?? 1) * paintOpacity;
  return `#${h2(c.r)}${h2(c.g)}${h2(c.b)}${a < 0.999 ? h2(a) : ""}`;
}

/** El relleno que se ve: el último visible (Figma apila de abajo hacia arriba). */
function topPaint(paints: Paint[] | undefined): Paint | undefined {
  const visible = (paints ?? []).filter((p) => p.visible !== false);
  return visible[visible.length - 1];
}

export interface TranslateOptions {
  fileKey: string;
  nodeId: string;
  /** Escala de la imagen exportada (1 o 2). */
  scale: 1 | 2;
  /** Imagen del frame, si se exportó. */
  image?: { path: string; width: number; height: number };
  /** `styles` de la respuesta (id de estilo → nombre), para nombrar la paleta. */
  styleNames?: Record<string, { name?: string; styleType?: string } | undefined>;
  /** Variables locales (solo Enterprise): se usan solo para nombrar colores. */
  variables?: Record<string, unknown> | undefined;
  /** Reloj inyectable para pruebas. */
  now?: () => Date;
}

export interface TranslateResult {
  snapshot: Snapshot;
  /** Cosas del diseño que el snapshot no puede representar; se muestran al usuario, no se ocultan. */
  warnings: string[];
}

function variableColorNames(variables: Record<string, unknown> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const v of Object.values(variables ?? {})) {
    const variable = v as { name?: string; resolvedType?: string; valuesByMode?: Record<string, Rgba | unknown> };
    if (variable.resolvedType !== "COLOR" || !variable.name) continue;
    const first = Object.values(variable.valuesByMode ?? {})[0] as Rgba | undefined;
    if (first && typeof first === "object" && "r" in first) out.set(hex(first), variable.name);
  }
  return out;
}

/** Traduce el nodo de un frame (respuesta de `GET /v1/files/:key/nodes`) a un snapshot de diseño. */
export function figmaNodeToSnapshot(rootNode: Record<string, unknown>, options: TranslateOptions): TranslateResult {
  const root = rootNode as unknown as FNode;
  const frame = root.absoluteBoundingBox;
  if (!frame) throw new Error(`El nodo ${root.id} no tiene dimensiones (absoluteBoundingBox); elija un frame.`);

  const warnings = new Set<string>();
  const warn = (node: FNode, text: string): void => void warnings.add(`«${node.name ?? node.id}»: ${text}`);
  const elements: SnapshotInput["elements"] = [];
  const colorNames = new Map<string, string>();
  let z = 0;

  const rel = (b: Rect): Rect => ({ x: r2(b.x - frame.x), y: r2(b.y - frame.y), width: r2(b.width), height: r2(b.height) });
  const nameFill = (node: FNode, key: "fill" | "stroke", color: string | undefined): void => {
    const styleId = node.styles?.[key];
    const styleName = styleId ? options.styleNames?.[styleId]?.name : undefined;
    if (color && styleName && !colorNames.has(color)) colorNames.set(color, styleName);
  };

  function paintStyle(node: FNode): SnapshotInput["elements"][number]["style"] {
    const style: SnapshotInput["elements"][number]["style"] = {};
    const fill = topPaint(node.fills);
    if (fill?.type === "SOLID" && fill.color) {
      style.background = hex(fill.color, fill.opacity);
      nameFill(node, "fill", style.background);
    } else if (fill && fill.type.startsWith("GRADIENT")) {
      warn(node, "tiene un degradado; el snapshot no lo representa y se ignora.");
    }

    const stroke = topPaint(node.strokes);
    if (stroke?.type === "SOLID" && stroke.color) {
      const w = node.individualStrokeWeights;
      const uniform = !w || (w.top === w.right && w.right === w.bottom && w.bottom === w.left);
      const weight = w ? w.top : (node.strokeWeight ?? 1);
      if (!uniform) {
        warn(node, "tiene bordes distintos por lado; solo se representan bordes uniformes y se ignora.");
      } else if (weight > 0) {
        style.border = { width: weight, style: "solid", color: hex(stroke.color, stroke.opacity) };
        nameFill(node, "stroke", style.border.color);
        if (node.strokeAlign && node.strokeAlign !== "INSIDE") warn(node, `el trazo es ${node.strokeAlign === "OUTSIDE" ? "exterior" : "centrado"}; en CSS el borde va por dentro, el tamaño puede diferir por el ancho del trazo.`);
      }
    }

    const cb = node.absoluteBoundingBox;
    if (node.type === "ELLIPSE" && cb) {
      style.radius = r2(Math.min(cb.width, cb.height) / 2);
    } else if (node.rectangleCornerRadii?.length === 4) {
      const [a, b, c, d] = node.rectangleCornerRadii as [number, number, number, number];
      if (a || b || c || d) style.radius = a === b && b === c && c === d ? a : [a, b, c, d];
    } else if (node.cornerRadius && node.cornerRadius > 0) {
      style.radius = node.cornerRadius;
    }

    const shadows = (node.effects ?? [])
      .filter((e) => e.visible !== false && (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.color)
      .map((e) => ({ x: e.offset?.x ?? 0, y: e.offset?.y ?? 0, blur: e.radius ?? 0, spread: e.spread ?? 0, color: hex(e.color as Rgba), ...(e.type === "INNER_SHADOW" ? { inset: true } : {}) }));
    if (shadows.length) style.shadows = shadows;

    if (typeof node.opacity === "number" && node.opacity < 1) style.opacity = r2(node.opacity);
    return style;
  }

  function textElement(node: FNode, parentId: string, path: string): void {
    const raw = node.characters ?? "";
    if (raw.trim() === "" || !node.absoluteBoundingBox) return;
    const s = node.style ?? {};
    const bbox = node.absoluteBoundingBox;
    // La capa de texto de Figma suele ser más ancha que el texto (ancho fijo). El ancho real y el inicio
    // salen de los límites de render (glifos); la altura sale de la capa (líneas × interlineado). (D-026)
    const render = node.absoluteRenderBounds;
    const useRender = render && render.x >= bbox.x - 1 && render.x + render.width <= bbox.x + bbox.width + 1;
    const box = rel({ x: useRender ? render.x : bbox.x, y: bbox.y, width: useRender ? render.width : bbox.width, height: bbox.height });

    let content = raw;
    if (s.textCase === "UPPER") content = content.toUpperCase();
    else if (s.textCase === "LOWER") content = content.toLowerCase();
    else if (s.textCase === "TITLE") content = content.replace(/(^|\s)(\S)/gu, (_m, sp: string, c: string) => sp + c.toUpperCase());
    content = content.replace(/\s+/gu, " ").trim();

    const overrides = node.characterStyleOverrides ?? [];
    if (overrides.some((i) => i !== 0)) warn(node, "mezcla estilos dentro del mismo texto; se usa el estilo base de la capa.");

    const style: SnapshotInput["elements"][number]["style"] = {};
    if (s.fontFamily) style.fontFamily = s.fontFamily;
    if (s.fontSize) style.fontSize = s.fontSize;
    if (s.fontWeight) style.fontWeight = s.fontWeight;
    style.lineHeight = s.lineHeightUnit === "INTRINSIC_%" || !s.lineHeightPx ? null : r2(s.lineHeightPx);
    style.letterSpacing = r2(s.letterSpacing ?? 0);
    const fill = topPaint(node.fills);
    if (fill?.type === "SOLID" && fill.color) {
      style.color = hex(fill.color, fill.opacity);
      nameFill(node, "fill", style.color);
    }
    if (typeof node.opacity === "number" && node.opacity < 1) style.opacity = r2(node.opacity);

    elements.push({ id: node.id, kind: "text", name: node.name ?? "Texto", path, parentId, z: z++, box, text: { content, normalized: normalizeText(content) }, style });
  }

  function walk(node: FNode, parentId: string, parentPath: string, isRoot = false): void {
    if (node.visible === false || node.opacity === 0) return;
    const path = parentPath ? `${parentPath} / ${node.name ?? node.id}` : (node.name ?? node.id);
    const bbox = node.absoluteBoundingBox;
    let emitted = parentId;

    if (bbox && node.rotation && Math.abs(node.rotation) > 1e-6 && !isRoot) {
      warn(node, "está rotada; se usa el rectángulo que la contiene, no su forma real.");
    }

    if (node.type === "TEXT") {
      textElement(node, parentId, path);
      return;
    }

    if (!isRoot && bbox && (CONTAINERS.has(node.type) || BOXES.has(node.type) || VECTORS.has(node.type))) {
      const style = paintStyle(node);
      const imageFill = topPaint(node.fills)?.type === "IMAGE";
      const isVector = VECTORS.has(node.type);
      const painted = Object.keys(style).some((k) => k !== "opacity" && k !== "radius") || imageFill || (isVector && (topPaint(node.fills) || topPaint(node.strokes)));
      if (painted && bbox.width > 0 && bbox.height > 0) {
        const kind = imageFill || isVector ? "image" : "box";
        elements.push({ id: node.id, kind, name: node.name ?? node.type, path, parentId, z: z++, box: rel(bbox), style, ...(kind === "image" ? { image: { alt: node.name ?? "" } } : {}) });
        emitted = node.id;
      }
    } else if (!isRoot && !CONTAINERS.has(node.type) && !BOXES.has(node.type) && !VECTORS.has(node.type) && node.type !== "SLICE") {
      warn(node, `el tipo de nodo ${node.type} no se traduce y se ignora.`);
    }

    for (const child of node.children ?? []) walk(child, emitted, path);
  }

  // Raíz: el propio frame.
  const rootStyle = paintStyle(root);
  elements.push({ id: "page", kind: "box", name: root.name ?? "Frame", path: root.name ?? root.id, parentId: null, z: z++, box: { x: 0, y: 0, width: r2(frame.width), height: r2(frame.height) }, style: rootStyle });
  for (const child of root.children ?? []) walk(child, "page", root.name ?? root.id);

  // Paleta: colores realmente usados (por frecuencia) y familias con sus pesos.
  const varNames = variableColorNames(options.variables);
  const counts = new Map<string, number>();
  const fonts = new Map<string, Set<number>>();
  for (const e of elements) {
    for (const c of [e.style.color, e.style.background, e.style.border?.color]) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    if (e.style.fontFamily) {
      const set = fonts.get(e.style.fontFamily) ?? new Set<number>();
      set.add(e.style.fontWeight ?? 400);
      fonts.set(e.style.fontFamily, set);
    }
  }
  const palette = {
    colors: [...counts].sort((a, b) => b[1] - a[1]).map(([h]) => {
      const name = colorNames.get(h) ?? varNames.get(h);
      return name ? { hex: h, name } : { hex: h };
    }),
    fonts: [...fonts].map(([family, w]) => ({ family, weights: [...w].sort((a, b) => a - b) })),
  };

  const input: SnapshotInput = {
    schemaVersion: 1,
    source: "design",
    meta: {
      name: root.name ?? "Frame de Figma",
      capturedAt: (options.now?.() ?? new Date()).toISOString(),
      origin: { figma: { fileKey: options.fileKey, nodeId: options.nodeId } },
      tool: "paridad-figma · API REST de Figma",
    },
    canvas: { width: r2(frame.width), height: r2(frame.height), scale: options.scale, ...(options.image ? { image: options.image } : {}) },
    palette,
    ignore: [],
    elements,
  };
  return { snapshot: assertSnapshot(input, "snapshot de diseño"), warnings: [...warnings] };
}
