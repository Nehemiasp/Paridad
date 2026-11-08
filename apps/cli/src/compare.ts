import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { capturePage, writeCapture } from "@paridad/capture";
import { assertSnapshot, compare, SEVERITIES, type Report, type Snapshot } from "@paridad/core";
import { DiskCache, FigmaClient, fetchDesignSnapshot, type FetchLike } from "@paridad/figma";
import { loadConfigFile } from "./config-file.ts";
import { loadEnvLocal } from "./env.ts";
import { buildIgnoreZones, parsePositiveInt, parseScale } from "./options.ts";

export interface CompareIo {
  out: (text: string) => void;
  err: (text: string) => void;
}
export interface CompareDeps {
  fetch?: FetchLike;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

const isUrl = (s: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(s);

const SEVERITY_LABEL = { critical: "crítica", high: "alta", medium: "media", low: "baja" } as const;

function readSnapshotFile(path: string, label: string): Snapshot {
  if (!existsSync(path)) throw new Error(`No existe el archivo ${path} (${label}).`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} no es un JSON válido (${label}).`);
  }
  return assertSnapshot(data, `snapshot de ${label} (${path})`);
}

/** Texto para la terminal: puntaje, conteo por severidad y los hallazgos críticos y altos. */
export function summarize(report: Report, limit = 10): string {
  const { bySeverity } = report.summary;
  const lines = [
    `Puntaje de paridad: ${report.score.value} / 100`,
    `Hallazgos: ${report.summary.total}  (${SEVERITIES.map((s) => `${bySeverity[s] ?? 0} ${SEVERITY_LABEL[s]}${(bySeverity[s] ?? 0) === 1 ? "" : "s"}`).join(" · ")})`,
    `Emparejados: ${report.matching.pairs} · faltan: ${report.matching.missing} · sobran: ${report.matching.extra}`,
  ];
  const top = report.findings.filter((f) => f.severity === "critical" || f.severity === "high");
  if (top.length) {
    lines.push("", "Críticos y altos:");
    for (const f of top.slice(0, limit)) lines.push(`  [${SEVERITY_LABEL[f.severity]}] ${f.title}`);
    if (top.length > limit) lines.push(`  … y ${top.length - limit} más en report.json`);
  }
  return lines.join("\n") + "\n";
}

export interface CompareOptions {
  design?: string;
  figma?: string;
  page?: string;
  out?: string;
  config?: string;
  width?: string;
  height?: string;
  scale?: string;
  refresh?: boolean;
  failUnder?: string;
  ignoreSelector?: string[];
  ignoreRect?: string[];
  name?: string;
}

/** `paridad compare`: dos modos, con archivos snapshot o la tubería completa (Figma + página). */
export async function runCompare(opts: CompareOptions, io: CompareIo, deps: CompareDeps = {}): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  if (!opts.page) throw new Error("Falta --page: un snapshot (page.json) o la URL de la página.");
  if (opts.design && opts.figma) throw new Error("Use --design (archivo) o --figma (URL), no los dos.");
  if (!opts.design && !opts.figma) throw new Error("Falta el diseño: --design <snapshot.json> o --figma <URL del frame>.");

  const { config, path: configPath } = await loadConfigFile(cwd, opts.config);
  if (configPath) io.out(`Configuración: ${configPath}\n`);

  const outDir = resolve(cwd, opts.out ?? "out/compare");
  mkdirSync(outDir, { recursive: true });
  const rel = (p: string) => relative(outDir, p);

  let design: Snapshot;
  let page: Snapshot;
  const paths: NonNullable<Parameters<typeof compare>[2]>["paths"] = {};

  if (opts.design) {
    // ── Modo archivos ────────────────────────────────────────────────────
    if (isUrl(opts.page)) throw new Error("Con --design, --page debe ser un snapshot (.json). Para capturar una URL use --figma junto con --page <URL>.");
    const dPath = resolve(cwd, opts.design);
    const pPath = resolve(cwd, opts.page);
    design = readSnapshotFile(dPath, "diseño");
    page = readSnapshotFile(pPath, "página");
    const img = (s: Snapshot, snapPath: string) => (s.canvas.image ? rel(resolve(dirname(snapPath), s.canvas.image.path)) : undefined);
    paths.design = { snapshot: rel(dPath), ...(img(design, dPath) ? { image: img(design, dPath)! } : {}) };
    paths.page = { snapshot: rel(pPath), ...(img(page, pPath) ? { image: img(page, pPath)! } : {}) };
  } else {
    // ── Modo tubería: Figma + captura de la página ────────────────────────
    if (!isUrl(opts.page)) throw new Error("Con --figma, --page debe ser la URL de la página (http://localhost:3000, https://…).");
    const env = deps.env ?? loadEnvLocal(cwd);
    if (!env.FIGMA_TOKEN) throw new Error("Falta el token de Figma. Defina FIGMA_TOKEN en .env.local (vea .env.example).");
    const scale = parseScale(opts.scale);

    io.out("Leyendo el frame de Figma…\n");
    const client = new FigmaClient({ token: env.FIGMA_TOKEN, cache: new DiskCache(join(cwd, ".paridad-cache", "figma")), refresh: opts.refresh === true, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
    const fetched = await fetchDesignSnapshot({ url: opts.figma!, client, scale });
    for (const w of fetched.warnings) io.err(`Aviso (diseño): ${w}\n`);
    design = fetched.snapshot;
    const designDir = join(outDir, "design");
    mkdirSync(designDir, { recursive: true });
    writeFileSync(join(designDir, "snapshot.json"), JSON.stringify(design, null, 2) + "\n");
    if (fetched.image) writeFileSync(join(designDir, design.canvas.image?.path ?? "design.png"), fetched.image);
    paths.design = { snapshot: rel(join(designDir, "snapshot.json")), ...(fetched.image ? { image: rel(join(designDir, design.canvas.image?.path ?? "design.png")) } : {}) };

    const width = opts.width ? parsePositiveInt("--width", opts.width) : Math.round(design.canvas.width);
    io.out(`Capturando ${opts.page} a ${width} px (el ancho del frame)…\n`);
    const captured = await capturePage({
      url: opts.page,
      width,
      height: parsePositiveInt("--height", opts.height, 900),
      scale,
      ignore: buildIgnoreZones(opts.ignoreSelector, opts.ignoreRect),
      ...(opts.name ? { name: opts.name } : {}),
    });
    page = captured.snapshot;
    const pageDir = join(outDir, "page");
    const written = writeCapture(captured, pageDir);
    paths.page = { snapshot: rel(written.snapshotPath), image: rel(written.screenshotPath) };
  }

  const report = compare(design, page, { config, paths });
  const reportPath = join(outDir, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  io.out("\n" + summarize(report));
  io.out(`\nReporte: ${reportPath}\n`);

  if (opts.failUnder !== undefined) {
    const min = Number(opts.failUnder);
    if (!Number.isFinite(min) || min < 0 || min > 100) throw new Error(`--fail-under debe ser un número de 0 a 100 (recibí «${opts.failUnder}»).`);
    if (report.score.value < min) {
      io.err(`El puntaje ${report.score.value} es menor que el mínimo exigido (${min}).\n`);
      return 2;
    }
  }
  return 0;
}

