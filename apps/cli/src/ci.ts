import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { runCompare, type CompareDeps } from "./compare.ts";
import { readReport } from "./summary.ts";

/** Marca oculta del comentario: permite actualizarlo en lugar de crear uno nuevo en cada ejecución. */
export const COMMENT_MARKER = "<!-- paridad-ci -->";

export const ScreensSchema = z.object({
  screens: z
    .array(
      z.object({
        name: z.string().min(1),
        /** Enlace del frame de Figma. */
        figma: z.string().min(1),
        /** URL de la pantalla (p. ej. http://localhost:3000/precios). */
        page: z.string().min(1),
        /** Ancho de la ventana; por defecto el del frame. */
        width: z.number().int().positive().optional(),
        ignoreSelectors: z.array(z.string()).optional(),
        ignoreRects: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  /** Puntaje mínimo; por debajo, la comprobación falla. */
  failUnder: z.number().min(0).max(100).optional(),
});
export type Screens = z.infer<typeof ScreensSchema>;

const slug = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pantalla";

export interface ScreenResult {
  name: string;
  dir: string;
  score: number | null;
  counts: { critical: number; high: number; medium: number; low: number } | null;
  topFindings: string[];
  error: string | null;
}

export function loadScreens(path: string): Screens {
  if (!existsSync(path)) throw new Error(`No existe ${path}. Cree un archivo con la lista de pantallas (vea el README).`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} no es un JSON válido.`);
  }
  const r = ScreensSchema.safeParse(data, { error: z.locales.es().localeError });
  if (!r.success) throw new Error(`${path} no es válido:\n${r.error.issues.map((i) => `  - ${i.path.join(".") || "(raíz)"}: ${i.message}`).join("\n")}`);
  const names = r.data.screens.map((s) => slug(s.name));
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`Dos pantallas se llaman parecido («${dup}»): sus carpetas de salida se pisarían. Use nombres distintos.`);
  return r.data;
}

/** Comentario de pull request en Markdown: una tabla con el puntaje por pantalla y los críticos y altos de cada una. */
export function toComment(results: ScreenResult[], failUnder: number | undefined): string {
  const row = (r: ScreenResult) => (r.score === null ? `| ${r.name} | ⚠ error | | | | |` : `| ${r.name} | **${r.score}** ${failUnder !== undefined ? (r.score >= failUnder ? "✅" : "❌") : ""} | ${r.counts!.critical} | ${r.counts!.high} | ${r.counts!.medium} | ${r.counts!.low} |`);
  const lines = [COMMENT_MARKER, "## Paridad · diseño frente a código", "", "| Pantalla | Puntaje | Críticas | Altas | Medias | Bajas |", "|---|---|---|---|---|---|", ...results.map(row)];
  if (failUnder !== undefined) lines.push("", `Puntaje mínimo exigido: **${failUnder}**.`);
  for (const r of results) {
    if (r.error) lines.push("", `**${r.name}:** no se pudo comparar. ${r.error}`);
    else if (r.topFindings.length) lines.push("", `<details><summary>${r.name}: críticas y altas (${r.topFindings.length})</summary>`, "", ...r.topFindings.map((t) => `- ${t.replace(/\|/g, "\\|").replace(/</g, "&lt;")}`), "", "</details>");
  }
  lines.push("", "_Cada hallazgo es una medición con su valor esperado y el obtenido. Reporte completo en los artefactos de la ejecución._");
  return lines.join("\n") + "\n";
}

export interface CiOptions {
  screens: string;
  out?: string;
  failUnder?: string;
}

/** `paridad ci`: compara cada pantalla del archivo, escribe un reporte por pantalla y el comentario del pull request. */
export async function runCi(opts: CiOptions, log: { out: (t: string) => void; err: (t: string) => void }, deps: CompareDeps = {}): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  const config = loadScreens(resolve(cwd, opts.screens));
  const failUnder = opts.failUnder !== undefined ? Number(opts.failUnder) : config.failUnder;
  if (failUnder !== undefined && (!Number.isFinite(failUnder) || failUnder < 0 || failUnder > 100)) throw new Error(`--fail-under debe ser un número de 0 a 100 (recibí «${opts.failUnder}»).`);

  const outRoot = resolve(cwd, opts.out ?? "out/ci");
  mkdirSync(outRoot, { recursive: true });
  const results: ScreenResult[] = [];
  const silent = { out: () => undefined, err: () => undefined };

  for (const s of config.screens) {
    const dir = join(outRoot, slug(s.name));
    log.out(`• ${s.name}…\n`);
    try {
      const code = await runCompare({ figma: s.figma, page: s.page, out: dir, ...(s.width ? { width: String(s.width) } : {}), ...(s.ignoreSelectors ? { ignoreSelector: s.ignoreSelectors } : {}), ...(s.ignoreRects ? { ignoreRect: s.ignoreRects } : {}) }, silent, deps);
      void code;
      const report = readReport(dir);
      const counts = { critical: report.summary.bySeverity.critical ?? 0, high: report.summary.bySeverity.high ?? 0, medium: report.summary.bySeverity.medium ?? 0, low: report.summary.bySeverity.low ?? 0 };
      results.push({ name: s.name, dir, score: report.score.value, counts, topFindings: report.findings.filter((f) => f.severity === "critical" || f.severity === "high").map((f) => f.title), error: null });
      log.out(`  puntaje ${report.score.value}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name: s.name, dir, score: null, counts: null, topFindings: [], error: message });
      log.err(`  error: ${message}\n`);
    }
  }

  const comment = toComment(results, failUnder);
  writeFileSync(join(outRoot, "comment.md"), comment);
  writeFileSync(join(outRoot, "results.json"), JSON.stringify({ failUnder: failUnder ?? null, results }, null, 2) + "\n");
  log.out(`\nComentario: ${join(outRoot, "comment.md")}\n`);

  if (results.some((r) => r.error)) return 1;
  if (failUnder !== undefined && results.some((r) => (r.score ?? 0) < failUnder)) {
    log.err(`Al menos una pantalla quedó por debajo del puntaje mínimo (${failUnder}).\n`);
    return 2;
  }
  return 0;
}
