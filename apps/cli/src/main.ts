import { Command, CommanderError } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capturePage, writeCapture } from "@paridad/capture";
import { DiskCache, FigmaClient, fetchDesignSnapshot, type FetchLike } from "@paridad/figma";
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

  return program;
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
    io.err(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
