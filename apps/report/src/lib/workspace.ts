import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Report, Severity } from "@paridad/core";
import { repoRoot } from "./env.ts";
import { loadReport, parseEntries, type LoadedReport, type ReportEntry } from "./load.ts";

/** Carpeta donde se guardan las comparaciones hechas desde la app (`paridad app --workspace`, por defecto `out/comparaciones`). */
export const workspaceDir = (): string => resolve(/*turbopackIgnore: true*/ process.env.PARIDAD_WORKSPACE ?? join(repoRoot(), "out", "comparaciones"));

/** Los nombres de carpeta los crea la app: solo minúsculas, números y guiones. Nada de `..` ni separadores. */
const FOLDER = /^[a-z0-9][a-z0-9-]{0,99}$/;
export const isFolderName = (s: string): boolean => FOLDER.test(s);

export const workspaceId = (folder: string): string => `c:${folder}`;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** `20260315-142530-casa-nube` (UTC): ordena por fecha y se entiende de un vistazo. */
export function folderName(now: Date, hint: string): string {
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const slug = hint
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `${stamp}-${slug}` : stamp;
}

/**
 * Resuelve un id de reporte a su carpeta: `0`, `1`… vienen de `PARIDAD_REPORTS` (el comando `--open`) y `c:<carpeta>`
 * es una comparación del espacio de trabajo. Cualquier otra cosa no existe: así `..` o una ruta no llegan al disco.
 */
export function entryById(id: string, reportsEnv: string | undefined = process.env.PARIDAD_REPORTS): ReportEntry | undefined {
  if (id.startsWith("c:")) {
    const folder = id.slice(2);
    if (!isFolderName(folder)) return undefined;
    const dir = join(workspaceDir(), folder);
    return existsSync(join(dir, "report.json")) ? { id, label: "", dir } : undefined;
  }
  return parseEntries(reportsEnv).find((e) => e.id === id);
}

export interface HistoryItem {
  id: string;
  folder: string;
  /** Texto que se muestra: nombre del frame y tamaño. */
  title: string;
  pageUrl: string | undefined;
  width: number;
  score: number;
  total: number;
  bySeverity: Partial<Record<Severity, number>>;
  createdAt: string;
}

/** Comparaciones guardadas, de la más reciente a la más antigua. Las carpetas sin reporte o con reporte dañado se ignoran. */
export function listComparisons(dir: string = workspaceDir()): HistoryItem[] {
  if (!existsSync(/*turbopackIgnore: true*/ dir)) return [];
  const items: HistoryItem[] = [];
  for (const name of readdirSync(/*turbopackIgnore: true*/ dir)) {
    if (!isFolderName(name)) continue;
    const full = join(dir, name);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    const loaded: LoadedReport = loadReport({ id: workspaceId(name), label: "", dir: full });
    const r = loaded.report;
    if (!r) continue;
    items.push({
      id: workspaceId(name),
      folder: name,
      title: r.design.name,
      pageUrl: r.page.origin.url,
      width: r.page.canvas.width,
      score: r.score.value,
      total: r.summary.total,
      bySeverity: r.summary.bySeverity,
      createdAt: r.createdAt,
    });
  }
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.folder < b.folder ? 1 : -1));
}

/** Una comparación del espacio de trabajo lista para `ReportApp` (una pestaña). */
export function workspaceItem(folder: string): { id: string; label: string; report: Report | null; error: string | null } | undefined {
  const entry = entryById(workspaceId(folder));
  if (!entry) return undefined;
  const loaded = loadReport(entry);
  return { id: entry.id, label: loaded.entry.label, report: loaded.report ?? null, error: loaded.error ?? null };
}
