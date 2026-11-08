import { Command, CommanderError } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AiClient } from "@paridad/ai";
import { capturePage, writeCapture } from "@paridad/capture";
import { DiskCache, FigmaClient, fetchDesignSnapshot, type FetchLike } from "@paridad/figma";
import { runCi } from "./ci.ts";
import { runCompare, type CompareOptions } from "./compare.ts";
import { readReport, toSummaryJson, toSummaryText } from "./summary.ts";
import { openInBrowser, startReportServer, untilInterrupted, type ReportEntryInput } from "./serve.ts";
import { loadEnvLocal } from "./env.ts";
import { buildIgnoreZones, parsePositiveInt, parseScale } from "./options.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const defaultIo: Io = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
};

/** Dependencias sustituibles en pruebas (red, entorno, carpeta de trabajo). */
export interface Deps {
  /** Sustituye a «levantar el servidor y abrir el navegador» (en las pruebas): recibe las carpetas de los reportes. */
  open?: (entries: ReportEntryInput[]) => Promise<void>;
  /** Sustituye al modelo de la IA en las pruebas. */
  aiClient?: AiClient;
  fetch?: FetchLike;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

export function buildProgram(io: Io = defaultIo, deps: Deps = {}): Command {
  const program = new Command("paridad")
    .description("Compara un frame de Figma con la página construida y reporta lo que no coincide.")
    .helpOption("-h, --help", "Muestra la ayuda")
    .configureOutput({ writeOut: io.out, writeErr: io.err })
    .exitOverride();

  program
    .command("capture")
    .description("Captura una página que usted indica y genera snapshot.json y screenshot.png.")
    .option("--page <url>", "URL de la página (http://localhost:3000, https://… o file://…)")
    .option("--width <px>", "ancho de la ventana en px; use el del frame de Figma")
    .option("--height <px>", "alto de la ventana en px (la captura es de página completa)", "900")
    .option("--scale <1|2>", "escala de la imagen", "1")
    .option("--out <carpeta>", "carpeta de salida", "out/capture")
    .option("--name <texto>", "nombre para el reporte (por defecto, el título de la página)")
    .option("--ignore-selector <css>", "zona a ignorar por selector CSS (se puede repetir)", collect)
    .option("--ignore-rect <x,y,ancho,alto>", "zona a ignorar por rectángulo en px de página (se puede repetir)", collect)
    .action(async (opts: Record<string, string | string[] | undefined>) => {
      if (!opts.page || typeof opts.page !== "string") throw new Error("Falta --page con la URL de la página que desea capturar.");
      const width = parsePositiveInt("--width", opts.width as string | undefined);
      const height = parsePositiveInt("--height", opts.height as string | undefined, 900);
      const scale = parseScale(opts.scale as string | undefined);
      const ignore = buildIgnoreZones(opts.ignoreSelector as string[] | undefined, opts.ignoreRect as string[] | undefined);

      io.out(`Capturando ${opts.page} a ${width} px, escala ${scale}…\n`);
      const result = await capturePage({
        url: opts.page,
        width,
        height,
        scale,
        ignore,
        ...(typeof opts.name === "string" ? { name: opts.name } : {}),
      });
      const { snapshotPath, screenshotPath } = writeCapture(result, String(opts.out));
      const { canvas, elements } = result.snapshot;
      io.out(`Listo: ${elements.length} elementos · lienzo ${canvas.width}×${canvas.height} px · escala ${canvas.scale}\n`);
      io.out(`  snapshot:  ${snapshotPath}\n  imagen:    ${screenshotPath}\n`);

      const root = elements.find((e) => e.parentId === null);
      if (root && root.box.width > canvas.width) {
        io.err(`Aviso: la página se desborda horizontalmente (${root.box.width} px frente a una ventana de ${canvas.width} px).\n`);
      }
      const fallback = elements.filter((e) => e.style.renderedFontFamily && e.style.fontFamily && e.style.renderedFontFamily !== e.style.fontFamily);
      if (fallback.length) {
        const families = [...new Set(fallback.map((e) => `${e.style.fontFamily} → ${e.style.renderedFontFamily}`))];
        io.err(`Aviso: ${fallback.length} textos no usan la fuente que piden (${families.join("; ")}). ¿La fuente cargó?\n`);
      }
    });

  program
    .command("figma")
    .description("Lee un frame de Figma (API REST, solo lectura) y genera el snapshot de diseño y su imagen.")
    .option("--url <url>", "enlace del frame (figma.com/design/<clave>/…?node-id=1-2)")
    .option("--out <carpeta>", "carpeta de salida", "out/design")
    .option("--scale <1|2>", "escala de la imagen exportada", "2")
    .option("--no-image", "no pedir la imagen del frame")
    .option("--refresh", "ignorar la caché y volver a pedir a Figma")
    .action(async (opts: Record<string, string | boolean | undefined>) => {
      if (!opts.url || typeof opts.url !== "string") throw new Error("Falta --url con el enlace del frame de Figma.");
      const cwd = deps.cwd ?? process.cwd();
      const env = deps.env ?? loadEnvLocal(cwd);
      const token = env.FIGMA_TOKEN;
      if (!token) {
        throw new Error("Falta el token de Figma. Cree uno personal (Settings → Security → Personal access tokens, con permiso de solo lectura de archivos), cópielo en .env.local como FIGMA_TOKEN=… (vea .env.example) y vuelva a intentar.");
      }
      const scale = parseScale(opts.scale as string | undefined);
      const client = new FigmaClient({
        token,
        cache: new DiskCache(join(cwd, ".paridad-cache", "figma")),
        refresh: opts.refresh === true,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
      io.out(`Leyendo el frame de Figma…\n`);
      const result = await fetchDesignSnapshot({ url: opts.url, client, scale, image: opts.image !== false });

      const outDir = String(opts.out);
      mkdirSync(outDir, { recursive: true });
      const snapshotPath = join(outDir, "snapshot.json");
      writeFileSync(snapshotPath, JSON.stringify(result.snapshot, null, 2) + "\n");
      let imagePath: string | undefined;
      if (result.image && result.snapshot.canvas.image) {
        imagePath = join(outDir, result.snapshot.canvas.image.path);
        writeFileSync(imagePath, result.image);
      }
      const { canvas, elements, palette } = result.snapshot;
      io.out(`Listo: ${elements.length} elementos · lienzo ${canvas.width}×${canvas.height} px · ${palette?.colors.length ?? 0} colores · ${palette?.fonts.length ?? 0} familias\n`);
      io.out(`  snapshot:  ${snapshotPath}\n${imagePath ? `  imagen:    ${imagePath}\n` : ""}`);
      for (const w of result.warnings) io.err(`Aviso: ${w}\n`);
    });

  program
    .command("compare")
    .description("Compara el diseño con la página y escribe report.json con los hallazgos y el puntaje de paridad.")
    .option("--design <snapshot.json>", "snapshot del diseño (modo archivos)")
    .option("--figma <url>", "enlace del frame de Figma (modo completo: lee Figma y captura la página)")
    .option("--page <snapshot.json|url>", "snapshot de la página (con --design) o su URL (con --figma)")
    .option("--out <carpeta>", "carpeta de salida", "out/compare")
    .option("--config <archivo>", "configuración (por defecto paridad.config.ts si existe)")
    .option("--width <px>", "ancho de la ventana (por defecto, el del frame)")
    .option("--height <px>", "alto de la ventana", "900")
    .option("--scale <1|2>", "escala de las imágenes", "1")
    .option("--refresh", "ignorar la caché de Figma")
    .option("--no-visual", "no hacer la diferencia por píxeles")
    .option("--ai", "capa de IA con Claude: agrupa hallazgos, descarta ruido evidente y redacta (apagada por defecto; requiere ANTHROPIC_API_KEY)")
    .option("--ai-simulated", "prueba la tubería de la IA sin llamar a ningún modelo (no mide a Claude)")
    .option("--ai-model <id>", "modelo de la IA (por defecto claude-haiku-5-5, el más económico)")
    .option("--ai-max-cost <usd>", "tope de costo de la IA en dólares por corrida (por defecto 0.05)")
    .option("--no-ai-images", "no enviar imágenes recortadas a la IA")
    .option("--open", "al terminar, abre el reporte en el navegador (Ctrl+C para cerrar el servidor)")
    .option("--fail-under <puntaje>", "salir con código 2 si el puntaje es menor (útil en CI)")
    .option("--name <texto>", "nombre de la página en el reporte")
    .option("--ignore-selector <css>", "zona a ignorar por selector CSS (se puede repetir)", collect)
    .option("--ignore-rect <x,y,ancho,alto>", "zona a ignorar por rectángulo (se puede repetir)", collect)
    .action(async (opts: CompareOptions) => {
      const code = await runCompare(opts, io, deps);
      if (code !== 0) throw new ExitCode(code);
      if (opts.open) await openReports([{ dir: opts.out ?? "out/compare" }], io, deps);
    });

  program
    .command("summary")
    .description("Resume un reporte ya generado: puntaje, conteo y los hallazgos críticos y altos con su evidencia.")
    .option("--dir <carpeta>", "carpeta del reporte (la que tiene report.json)", "out/compare")
    .option("--severity <lista>", "severidades a listar, separadas por comas (critical,high,medium,low)", "critical,high")
    .option("--json", "imprimir JSON estable en lugar de texto")
    .action((opts: { dir: string; severity: string; json?: boolean }) => {
      const valid = ["critical", "high", "medium", "low"];
      const severities = opts.severity.split(",").map((x) => x.trim()).filter(Boolean);
      const bad = severities.filter((x) => !valid.includes(x));
      if (bad.length) throw new Error(`Severidad desconocida: ${bad.join(", ")}. Use: ${valid.join(", ")}.`);
      const report = readReport(opts.dir);
      const o = { severities: severities as ("critical" | "high" | "medium" | "low")[] };
      io.out(opts.json ? JSON.stringify(toSummaryJson(report, o), null, 2) + "\n" : toSummaryText(report, o));
    });

  program
    .command("ci")
    .description("Compara varias pantallas (paridad.screens.json) y deja un comentario listo para el pull request.")
    .option("--screens <archivo>", "lista de pantallas (JSON)", "paridad.screens.json")
    .option("--out <carpeta>", "carpeta de salida", "out/ci")
    .option("--fail-under <puntaje>", "puntaje mínimo; si una pantalla queda por debajo, sale con código 2")
    .action(async (opts: { screens: string; out: string; failUnder?: string }) => {
      const code = await runCi(opts, io, deps);
      if (code !== 0) throw new ExitCode(code);
    });

  program
    .command("report")
    .description("Abre en el navegador un reporte que ya generó (una carpeta con report.json). Con varias --dir, una pestaña por tamaño.")
    .option("--dir <carpeta>", "carpeta del reporte (se puede repetir: escritorio, móvil…)", collect)
    .option("--label <texto>", "texto de la pestaña, en el mismo orden que --dir (se puede repetir)", collect)
    .action(async (opts: { dir?: string[]; label?: string[] }) => {
      if (!opts.dir?.length) throw new Error("Falta --dir con la carpeta del reporte (la que tiene report.json), p. ej. --dir out/compare.");
      const labels = opts.label ?? [];
      if (labels.length > opts.dir.length) throw new Error("Hay más --label que --dir.");
      await openReports(opts.dir.map((dir, i) => ({ dir, ...(labels[i] ? { label: labels[i] } : {}) })), io, deps);
    });

  return program;
}

/** Levanta la app del reporte, abre el navegador y espera a Ctrl+C. */
async function openReports(entries: ReportEntryInput[], io: Io, deps: Deps): Promise<void> {
  if (deps.open) return deps.open(entries);
  io.out("\nAbriendo el reporte…\n");
  const server = await startReportServer(entries);
  io.out(`Reporte en ${server.url}${server.mode === "dev" ? "  (modo desarrollo: ejecute «npm run build -w @paridad/report» para que abra más rápido)" : ""}\n`);
  if (!openInBrowser(server.url)) io.out("No pude abrir el navegador; abra esa dirección a mano.\n");
  io.out("Presione Ctrl+C para cerrar.\n");
  await untilInterrupted();
  await server.close();
}

class ExitCode extends Error {
  constructor(readonly code: number) {
    super(`salida ${code}`);
  }
}

/** Ejecuta el CLI y devuelve el código de salida (0 = bien). */
export async function run(argv: string[], io: Io = defaultIo, deps: Deps = {}): Promise<number> {
  const program = buildProgram(io, deps);
  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help y --version salen con código 0; el resto son errores de uso.
      return error.exitCode;
    }
    if (error instanceof ExitCode) return error.code;
    io.err(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
