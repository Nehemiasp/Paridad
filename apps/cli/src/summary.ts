import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ReportSchema, SEVERITIES, type Finding, type Report, type Severity } from "@paridad/core";

export interface SummaryOptions {
  /** Severidades a listar; por defecto crítica y alta. */
  severities?: Severity[];
}

/** Lee y valida el `report.json` de una carpeta, con errores en español. */
export function readReport(dir: string): Report {
  const file = join(dir, "report.json");
  if (!existsSync(file)) throw new Error(`No hay report.json en ${dir}. Genérelo con «paridad compare».`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} no es un JSON válido.`);
  }
  const r = ReportSchema.safeParse(data);
  if (!r.success) throw new Error(`${file} no tiene el formato de un reporte de Paridad (¿es de otra versión?).`);
  return r.data;
}

const LABEL: Record<Severity, string> = { critical: "crítica", high: "alta", medium: "media", low: "baja" };

/** Forma compacta y estable para que otra herramienta (la skill `/paridad`, una Action) la lea sin interpretar texto. */
export function toSummaryJson(report: Report, options: SummaryOptions = {}) {
  const wanted = new Set(options.severities ?? ["critical", "high"]);
  const findings = report.findings.filter((f) => wanted.has(f.severity));
  return {
    score: report.score.value,
    counts: Object.fromEntries(SEVERITIES.map((s) => [s, report.summary.bySeverity[s] ?? 0])) as Record<Severity, number>,
    design: { name: report.design.name, origin: report.design.origin },
    page: { url: report.page.origin.url ?? report.page.name, width: report.page.canvas.width, height: report.page.canvas.height },
    visual: report.visual ? { diffRatio: report.visual.diffRatio, regions: report.visual.regions.length, unclassified: report.visual.regions.filter((r) => !r.classified).length } : null,
    findings: findings.map((f: Finding) => ({
      id: f.id,
      severity: f.severity,
      category: f.category,
      rule: f.rule,
      title: f.title,
      property: f.evidence.property,
      expected: f.evidence.expected ?? null,
      actual: f.evidence.actual ?? null,
      delta: f.evidence.delta ?? null,
      unit: f.evidence.unit ?? null,
      designBox: f.design?.box ?? null,
      pageBox: f.page?.box ?? null,
    })),
    omitted: report.findings.length - findings.length,
  };
}

/** Texto en español: puntaje, conteo y cada hallazgo de las severidades pedidas con su evidencia. */
export function toSummaryText(report: Report, options: SummaryOptions = {}): string {
  const s = toSummaryJson(report, options);
  const lines = [`Puntaje de paridad: ${s.score} / 100`, `Hallazgos: ${SEVERITIES.map((x) => `${s.counts[x]} ${LABEL[x]}${s.counts[x] === 1 ? "" : "s"}`).join(" · ")}`];
  if (s.findings.length === 0) lines.push("", "No hay hallazgos de las severidades pedidas.");
  for (const f of s.findings) {
    const delta = f.delta !== null ? ` (diferencia ${f.delta}${f.unit ? ` ${f.unit}` : ""})` : "";
    lines.push("", `[${LABEL[f.severity]}] ${f.title}`, `   ${f.property}: diseño ${JSON.stringify(f.expected)} · código ${JSON.stringify(f.actual)}${delta}`);
  }
  if (s.omitted > 0) lines.push("", `(${s.omitted} hallazgos de menor severidad no se listan; están en report.json)`);
  return lines.join("\n") + "\n";
}
