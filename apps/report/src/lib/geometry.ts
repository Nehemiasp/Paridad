import type { Box, Finding, Report } from "@paridad/core";

export interface Highlight {
  key: string;
  label: string;
  design?: Box;
  page?: Box;
  /** Región de diferencia visual (en el mapa de calor y en la página). */
  region?: Box;
}

/** Cajas que hay que resaltar en las imágenes para un conjunto de hallazgos. */
export function highlightsFor(findings: Finding[]): Highlight[] {
  return findings.flatMap((f) => {
    const h: Highlight = { key: f.id, label: f.design?.name ?? f.page?.name ?? f.title };
    if (f.design) h.design = f.design.box;
    if (f.page) h.page = f.page.box;
    if (f.region) h.region = f.region.box;
    return h.design || h.page || h.region ? [h] : [];
  });
}

/** Tamaño del escenario: el lienzo más alto de los dos (la página puede medir más que el diseño). */
export function stageSize(report: Report): { width: number; height: number } {
  return { width: Math.max(report.design.canvas.width, report.page.canvas.width), height: Math.max(report.design.canvas.height, report.page.canvas.height) };
}

/** Caja → estilo en porcentajes del escenario (así escala con la imagen). */
export function boxStyle(b: Box, stage: { width: number; height: number }): { left: string; top: string; width: string; height: string } {
  return { left: `${(b.x / stage.width) * 100}%`, top: `${(b.y / stage.height) * 100}%`, width: `${(b.width / stage.width) * 100}%`, height: `${(b.height / stage.height) * 100}%` };
}

export function fileUrl(entryId: string, path: string): string {
  return `/files/${encodeURIComponent(entryId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Valor de la evidencia legible: objetos como «x: 16, y: 16». */
export function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.map(fmtValue).join(", ");
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${fmtValue(x)}`).join(", ");
  return String(v);
}
