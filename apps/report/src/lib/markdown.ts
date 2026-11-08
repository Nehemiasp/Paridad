import type { Finding, Report, Severity } from "@paridad/core";
import { fmtValue } from "./geometry.ts";
import { CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_ORDER, formatDate } from "./labels.ts";

/** Escapa lo que rompería una celda de tabla o una línea de GitHub (los textos de la página pueden traer cualquier cosa). */
const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function line(f: Finding): string {
  const e = f.evidence;
  const delta = e.delta !== undefined ? ` · diferencia ${e.delta}${e.unit ? ` ${e.unit}` : ""}` : "";
  return `- [ ] **${esc(f.title)}**\n  - ${esc(e.property)}: diseño \`${esc(fmtValue(e.expected))}\` · código \`${esc(fmtValue(e.actual))}\`${delta}`;
}

export interface MarkdownOptions {
  /** Hallazgos a incluir (por ejemplo, los filtrados en pantalla); por defecto, todos. */
  findings?: Finding[];
  /** Etiqueta del tamaño, p. ej. «Escritorio 1440 px». */
  label?: string;
}

/** Reporte en Markdown listo para pegar en un issue de GitHub: puntaje, resumen y una lista de tareas por severidad. */
export function toMarkdown(report: Report, options: MarkdownOptions = {}): string {
  const findings = options.findings ?? report.findings;
  const grouped = new Map<Severity, Finding[]>(SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s)]));
  const origin = report.design.origin.figma ? `Figma \`${report.design.origin.figma.fileKey}\` · nodo \`${report.design.origin.figma.nodeId}\`` : esc(report.design.name);
  const lines: string[] = [
    `## Paridad entre diseño y código${options.label ? ` · ${options.label}` : ""}`,
    "",
    `**Puntaje de paridad: ${report.score.value} / 100**`,
    "",
    `| | |`,
    `|---|---|`,
    `| Diseño | ${origin} |`,
    `| Página | ${esc(report.page.origin.url ?? report.page.name)} |`,
    `| Lienzo | ${report.page.canvas.width} × ${report.page.canvas.height} px (escala ${report.page.canvas.scale}) |`,
    `| Fecha | ${formatDate(report.createdAt)} |`,
    `| Hallazgos | ${SEVERITY_ORDER.map((s) => `${grouped.get(s)!.length} ${SEVERITY_LABEL[s].toLowerCase()}${grouped.get(s)!.length === 1 ? "" : "s"}`).join(" · ")} |`,
  ];
  if (report.visual) lines.push(`| Diferencia visual | ${(report.visual.diffRatio * 100).toFixed(2)} % de los píxeles · ${report.visual.regions.length} región${report.visual.regions.length === 1 ? "" : "es"} |`);

  if (findings.length === 0) lines.push("", "No se encontraron diferencias. ✅");
  for (const s of SEVERITY_ORDER) {
    const list = grouped.get(s)!;
    if (!list.length) continue;
    lines.push("", `### ${SEVERITY_LABEL[s]} (${list.length})`, "");
    // Por categoría dentro de cada severidad, para que un desarrollador vea de un vistazo qué tipo de trabajo es.
    const cats = [...new Set(list.map((f) => f.category))];
    for (const c of cats) {
      lines.push(`**${CATEGORY_LABEL[c]}**`, "", ...list.filter((f) => f.category === c).map(line), "");
    }
    lines.pop();
  }

  if (report.ai && report.ai.groups.length) {
    lines.push("", "### Resumen agrupado", "");
    if (report.ai.mode === "simulado") lines.push("> ⚠ Resumen **simulado** (prueba de la tubería); no lo escribió un modelo.", "");
    for (const g of report.ai.groups) lines.push(`- **${esc(g.title)}** (${g.findingIds.length} hallazgos): ${esc(g.explanation)}${g.cssFix ? `\n  \`\`\`css\n  ${g.cssFix}\n  \`\`\`` : ""}`);
  }

  lines.push("", "---", "_Generado con Paridad. Las cifras son mediciones, no opiniones: cada hallazgo trae su valor esperado y el obtenido._");
  return lines.join("\n") + "\n";
}
