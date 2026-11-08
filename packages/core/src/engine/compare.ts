import type { Snapshot } from "../snapshot/schema.ts";
import { SEVERITIES, resolveConfig, type Category, type ParidadConfig, type ResolvedConfig, type Severity } from "./config.ts";
import type { Finding } from "./findings.ts";
import { SnapshotIndex } from "./geometry.ts";
import { matchElements } from "./match.ts";
import { ReportSchema, type Report } from "./report.ts";
import { colorFindings, designPalette, makePaletteNearest } from "./rules/colors.ts";
import type { Ctx } from "./rules/context.ts";
import { contrastFindings } from "./rules/contrast.ts";
import { layoutFindings } from "./rules/layout.ts";
import { pageFindings } from "./rules/page.ts";
import { presenceFindings } from "./rules/presence.ts";
import { textFindings } from "./rules/text.ts";
import { typographyFindings } from "./rules/typography.ts";
import { computeScore } from "./score.ts";

export interface CompareOptions {
  /** Tolerancias y criterios; lo que falte toma el valor por defecto. */
  config?: Parameters<typeof resolveConfig>[0] | ResolvedConfig;
  /** Reloj inyectable para pruebas. */
  now?: () => Date;
  /** Rutas de los archivos de cada lado, para que el reporte los encuentre. */
  paths?: { design?: { snapshot?: string; image?: string }; page?: { snapshot?: string; image?: string } };
}

const severityRank = (s: Severity): number => SEVERITIES.indexOf(s);

/**
 * Compara el snapshot del diseño con el de la página construida y produce el reporte.
 * Es una función pura: sin red, sin disco, sin reloj salvo `createdAt`.
 */
export function compare(design: Snapshot, page: Snapshot, options: CompareOptions = {}): Report {
  const cfg: ResolvedConfig = options.config && isResolved(options.config) ? (options.config as ResolvedConfig) : resolveConfig((options.config ?? {}) as Parameters<typeof resolveConfig>[0]);
  const rects = (s: Snapshot) => s.ignore.flatMap((z) => ("rect" in z ? [z.rect] : []));
  const dIdx = new SnapshotIndex(design, rects(page));
  const pIdx = new SnapshotIndex(page, rects(design));
  const match = matchElements(dIdx, pIdx, cfg);

  const ctx: Ctx = { design: dIdx, page: pIdx, cfg, match, paletteNearest: makePaletteNearest(designPalette({ design: dIdx })) };

  const disabled = new Set(cfg.disabledRules);
  const findings: Finding[] = [
    ...pageFindings(ctx),
    ...presenceFindings(ctx),
    ...layoutFindings(ctx),
    ...typographyFindings(ctx),
    ...colorFindings(ctx),
    ...textFindings(ctx),
    ...contrastFindings(ctx),
  ].filter((f) => !disabled.has(f.rule));

  const y = (f: Finding): number => f.design?.box.y ?? f.page?.box.y ?? 0;
  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || y(a) - y(b) || a.id.localeCompare(b.id));

  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  const byCategory: Partial<Record<Category, number>> = {};
  for (const f of findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;

  const side = (s: Snapshot, p?: { snapshot?: string; image?: string }) => ({
    name: s.meta.name,
    origin: s.meta.origin,
    capturedAt: s.meta.capturedAt,
    canvas: { width: s.canvas.width, height: s.canvas.height, scale: s.canvas.scale },
    ...(p?.snapshot ? { snapshotPath: p.snapshot } : {}),
    ...(p?.image ? { imagePath: p.image } : {}),
  });

  return ReportSchema.parse({
    schemaVersion: 1,
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    design: side(design, options.paths?.design),
    page: side(page, options.paths?.page),
    score: computeScore(findings, cfg),
    summary: { total: findings.length, bySeverity, byCategory },
    matching: {
      pairs: match.pairs.length,
      pairList: match.pairs.map((p) => ({ designId: p.design.id, pageId: p.page.id })),
      missing: match.missing.length,
      extra: match.extra.length,
      ignoredInDesign: design.elements.filter((e) => !dIdx.isRoot(e) && dIdx.isIgnored(e)).length,
      ignoredInPage: page.elements.filter((e) => !pIdx.isRoot(e) && pIdx.isIgnored(e)).length,
    },
    findings,
  });
}

/** ¿Es una configuración ya resuelta (con todos los campos) y no una parcial del usuario? */
function isResolved(c: object): boolean {
  const r = c as Partial<ResolvedConfig>;
  return Boolean(r.tolerances && r.matching && r.severity && r.contrast && r.score && r.disabledRules);
}

export type { ParidadConfig };
