import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ReportSchema, type Report } from "@paridad/core";
import { sizeLabel } from "./labels.ts";

export interface ReportEntry {
  id: string;
  /** Texto de la pestaña. */
  label: string;
  dir: string;
}

export interface LoadedReport {
  entry: ReportEntry;
  report: Report | undefined;
  /** Por qué no se pudo cargar (en español). */
  error: string | undefined;
}

/** `PARIDAD_REPORTS` = JSON `[{ "dir": "…", "label": "…"? }]`. Lo define `paridad … --open`. */
export function parseEntries(env: string | undefined): ReportEntry[] {
  if (!env) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(env);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, i) => {
    if (!item || typeof item !== "object" || typeof (item as { dir?: unknown }).dir !== "string") return [];
    const { dir, label } = item as { dir: string; label?: unknown };
    return [{ id: String(i), label: typeof label === "string" && label ? label : "", dir: resolve(dir) }];
  });
}

/** Lee y valida `report.json` de una carpeta. Un reporte dañado se informa, no tira la página. */
export function loadReport(entry: ReportEntry): LoadedReport {
  const file = join(entry.dir, "report.json");
  if (!existsSync(file)) return { entry, report: undefined, error: `No hay report.json en ${entry.dir}. Genere uno con «paridad compare».` };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { entry, report: undefined, error: `${file} no es un JSON válido.` };
  }
  const parsed = ReportSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { entry, report: undefined, error: `${file} no tiene el formato de un reporte de Paridad (${first?.path.join(".") ?? "raíz"}: ${first?.message ?? "inválido"}). ¿Es de otra versión?` };
  }
  const report = parsed.data;
  return { entry: { ...entry, label: entry.label || sizeLabel(report.page.canvas.width) }, report, error: undefined };
}

export function loadAll(env: string | undefined = process.env.PARIDAD_REPORTS): LoadedReport[] {
  return parseEntries(env).map(loadReport);
}
