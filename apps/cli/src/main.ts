import { Command, CommanderError } from "commander";
import { capturePage, writeCapture } from "@paridad/capture";
import { buildIgnoreZones, parsePositiveInt, parseScale } from "./options.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const defaultIo: Io = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
};

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

export function buildProgram(io: Io = defaultIo): Command {
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

  return program;
}

/** Ejecuta el CLI y devuelve el código de salida (0 = bien). */
export async function run(argv: string[], io: Io = defaultIo): Promise<number> {
  const program = buildProgram(io);
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
