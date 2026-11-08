import type { Box, Snapshot } from "../snapshot/schema.ts";
import { resolveConfig, SEVERITIES, type Category, type ParidadConfig, type ResolvedConfig, type RuleId, type Severity } from "./config.ts";
import { CATEGORY_OF_RULE, type Finding } from "./findings.ts";
import { area, bottom, intersectionArea, right, round2, SnapshotIndex } from "./geometry.ts";
import type { Report, Visual } from "./report.ts";
import { ReportSchema } from "./report.ts";
import { computeScore } from "./score.ts";

/** Lo que entrega el paquete `visual`: regiones sin clasificar todavía. */
export interface RawVisual {
  heatmapPath?: string;
  aligned: { width: number; height: number; scale: number };
  diffPixels: number;
  totalPixels: number;
  ignoredPixels: number;
  diffRatio: number;
  widthMismatch: boolean;
  regions: { id: string; box: Box; diffPixels: number; ratio: number }[];
}

/** Reglas cuyo elemento arrastra consigo a sus hijos (si se mueve o crece, los hijos se ven distintos). */
const MOVES_CHILDREN: ReadonlySet<RuleId> = new Set(["position", "spacing", "size", "missing", "extra", "text-lines"]);

/** Qué fracción de la región debe caer dentro de la zona de un hallazgo para decir que la explica. */
const EXPLAINED_FRACTION = 0.6;

/** Reglas cuyo efecto visible es un anillo junto al borde de la caja (esquinas, borde, sombra), no su interior. */
const RING_RULES: ReadonlySet<RuleId> = new Set(["radius", "border", "shadow", "color-border"]);
/** Reglas que pintan toda la caja: la región debe cubrir una parte importante de ella. */
const FILL_RULES: ReadonlySet<RuleId> = new Set(["color-background", "opacity"]);
/** px: ancho del anillo junto al borde donde se notan el radio, el borde y la sombra. */
const RING_BAND = 24;
/** Fracción mínima de la caja que debe cubrir una región para explicarse por un cambio de relleno. */
const FILL_COVERAGE = 0.25;

const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by });

/** ¿Explica este hallazgo (por su regla y su zona) una región con diferencias? */
function explains(rule: RuleId, zone: Box, region: Box): boolean {
  const a = area(region);
  if (a <= 0) return false;
  const inside = (z: Box) => intersectionArea(region, z) / a;
  if (RING_RULES.has(rule)) {
    // Dentro de la zona ampliada (la sombra sale de la caja) pero no por completo en su interior.
    const innerWidth = zone.width - 2 * RING_BAND;
    const innerHeight = zone.height - 2 * RING_BAND;
    const onlyInterior = innerWidth > 0 && innerHeight > 0 && inside({ x: zone.x + RING_BAND, y: zone.y + RING_BAND, width: innerWidth, height: innerHeight }) >= 0.99;
    return inside(grow(zone, RING_BAND)) >= EXPLAINED_FRACTION && !onlyInterior;
  }
  if (FILL_RULES.has(rule)) return inside(zone) >= EXPLAINED_FRACTION && intersectionArea(region, zone) / area(zone) >= FILL_COVERAGE;
  return inside(zone) >= EXPLAINED_FRACTION;
}

function union(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map(right));
  const y1 = Math.max(...boxes.map(bottom));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Zona de un hallazgo en la imagen: sus cajas en ambos lados (y las de sus hijos, si la regla los arrastra). */
function zoneOf(f: Finding, design: SnapshotIndex, page: SnapshotIndex): Box | undefined {
  const boxes: Box[] = [];
  const add = (idx: SnapshotIndex, id: string | undefined) => {
    if (!id) return;
    const el = idx.byId.get(id);
    if (!el) return;
    boxes.push(el.box);
    if (MOVES_CHILDREN.has(f.rule)) for (const d of idx.descendants(id)) boxes.push(d.box);
  };
  add(design, f.design?.elementId);
  add(page, f.page?.elementId);
  // Las fuentes caídas afectan a todos los textos que lista el hallazgo.
  if (f.rule === "font-not-loaded") for (const id of f.related ?? []) add(page, id);
  return union(boxes);
}

/**
 * Cruza las regiones con diferencias de píxeles con los hallazgos de las reglas.
 * Una región explicada lleva los ids de los hallazgos que la explican; la que ninguna regla explica se
 * agrega como hallazgo «diferencia visual sin clasificar». Recalcula resumen y puntaje.
 */
export function attachVisual(report: Report, raw: RawVisual, ctx: { design: Snapshot; page: Snapshot; config?: ResolvedConfig | Partial<ParidadConfig> }): Report {
  const cfg: ResolvedConfig = ctx.config && "tolerances" in ctx.config && "disabledRules" in ctx.config ? (ctx.config as ResolvedConfig) : resolveConfig((ctx.config ?? {}) as Parameters<typeof resolveConfig>[0]);
  const dIdx = new SnapshotIndex(ctx.design);
  const pIdx = new SnapshotIndex(ctx.page);

  const zones = report.findings.flatMap((f) => {
    const z = zoneOf(f, dIdx, pIdx);
    return z ? [{ id: f.id, rule: f.rule, zone: z }] : [];
  });

  const regions: Visual["regions"] = raw.regions.map((r) => {
    const findingIds = zones.filter(({ rule, zone }) => explains(rule, zone, r.box)).map((z) => z.id);
    return { ...r, findingIds, classified: findingIds.length > 0 };
  });

  const canvasArea = raw.aligned.width * raw.aligned.height;
  const added: Finding[] = [];
  if (!cfg.disabledRules.includes("visual-unclassified")) {
    for (const r of regions.filter((x) => !x.classified)) {
      const fraction = canvasArea > 0 ? area(r.box) / canvasArea : 0;
      const severity: Severity = fraction >= cfg.severity.regionRatioHigh ? "high" : fraction >= cfg.severity.regionRatioMedium ? "medium" : "low";
      added.push({
        id: `visual-unclassified:${r.id}`,
        rule: "visual-unclassified",
        category: CATEGORY_OF_RULE["visual-unclassified"],
        severity,
        title: `Diferencia visual sin clasificar en (${round2(r.box.x)}, ${round2(r.box.y)}), de ${round2(r.box.width)}×${round2(r.box.height)} px: ${Math.round(r.ratio * 100)} % de sus píxeles cambió y ninguna regla la explica`,
        region: { id: r.id, box: r.box },
        evidence: { property: "píxeles distintos", expected: 0, actual: r.diffPixels, unit: "px", extra: { proporcionDeLaRegion: round2(r.ratio), proporcionDelLienzo: Math.round(fraction * 10000) / 10000 } },
      });
    }
  }

  const findings = [...report.findings, ...added].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || (a.design?.box.y ?? a.page?.box.y ?? a.region?.box.y ?? 0) - (b.design?.box.y ?? b.page?.box.y ?? b.region?.box.y ?? 0) || a.id.localeCompare(b.id));
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  const byCategory: Partial<Record<Category, number>> = {};
  for (const f of findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;

  return ReportSchema.parse({
    ...report,
    score: computeScore(findings, cfg),
    summary: { total: findings.length, bySeverity, byCategory },
    findings,
    visual: { ...(raw.heatmapPath ? { heatmapPath: raw.heatmapPath } : {}), aligned: raw.aligned, diffPixels: raw.diffPixels, totalPixels: raw.totalPixels, ignoredPixels: raw.ignoredPixels, diffRatio: raw.diffRatio, widthMismatch: raw.widthMismatch, regions },
  });
}
