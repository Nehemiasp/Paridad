import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ReportEntryInput {
  /** Carpeta con `report.json` (y sus imágenes). */
  dir: string;
  /** Texto de la pestaña; por defecto, se deduce del ancho («Escritorio 1440 px»). */
  label?: string;
}

export interface RunningReport {
  url: string;
  /** `build` = servidor de producción; `dev` = servidor de desarrollo (más lento al arrancar). */
  mode: "build" | "dev";
  close: () => Promise<void>;
}

export const reportAppDir = (): string => resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "report");

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

async function waitUntilReady(url: string, child: ChildProcess, timeoutMs: number, log: () => string): Promise<void> {
  const start = Date.now();
  let exited: number | null | undefined;
  child.once("exit", (code) => (exited = code));
  while (Date.now() - start < timeoutMs) {
    if (exited !== undefined) throw new Error(`El servidor del reporte se cerró (código ${exited}).\n${log().slice(-1500)}`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* todavía no escucha */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`El servidor del reporte no respondió en ${Math.round(timeoutMs / 1000)} s.\n${log().slice(-1500)}`);
}

/**
 * Levanta la app del reporte (Next.js) en localhost, en un puerto libre, apuntando a las carpetas indicadas.
 * Escucha solo en 127.0.0.1 y sin telemetría. Si la app está compilada usa `next start`; si no, `next dev`.
 */
export async function startReportServer(entries: ReportEntryInput[], options: { timeoutMs?: number; workspace?: string } = {}): Promise<RunningReport> {
  // Con `workspace` (la app de comparaciones) el servidor puede arrancar sin ningún reporte: se crean desde la pantalla.
  if (entries.length === 0 && !options.workspace) throw new Error("No hay reportes que abrir.");
  for (const e of entries) {
    if (!existsSync(join(e.dir, "report.json"))) throw new Error(`No hay report.json en ${resolve(e.dir)}. Genérelo con «paridad compare».`);
  }
  const appDir = reportAppDir();
  const nextBin = createRequire(join(appDir, "package.json")).resolve("next/dist/bin/next");
  const built = existsSync(join(appDir, ".next", "BUILD_ID"));
  const port = await freePort();

  const child = spawn(process.execPath, [nextBin, built ? "start" : "dev", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: appDir,
    env: {
      ...process.env,
      PARIDAD_REPORTS: JSON.stringify(entries.map((e) => ({ dir: resolve(e.dir), ...(e.label ? { label: e.label } : {}) }))),
      PARIDAD_ROOT: resolve(appDir, "..", ".."),
      ...(options.workspace ? { PARIDAD_WORKSPACE: resolve(options.workspace) } : {}),
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (d: Buffer) => (log += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (log += d.toString()));

  const url = `http://127.0.0.1:${port}`;
  const close = async () => {
    if (child.exitCode !== null || child.killed) return;
    await new Promise<void>((done) => {
      child.once("exit", () => done());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 4000).unref();
    });
  };
  try {
    await waitUntilReady(url, child, options.timeoutMs ?? (built ? 30_000 : 90_000), () => log);
  } catch (error) {
    await close();
    throw error;
  }
  return { url, mode: built ? "build" : "dev", close };
}

/** Abre una URL en el navegador predeterminado. Devuelve `false` si no se pudo (p. ej. un servidor sin pantalla). */
export function openInBrowser(url: string): boolean {
  const [cmd, args]: [string, string[]] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Espera a Ctrl+C (o a que se termine el proceso). */
export function untilInterrupted(): Promise<void> {
  return new Promise((ok) => {
    const done = () => ok();
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}
