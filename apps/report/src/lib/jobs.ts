import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { maskSecrets, repoRoot, secretValues, type EnvStatus } from "./env.ts";
import { store } from "./store.ts";
import type { JobInput } from "./validate.ts";
import { folderName, isFolderName, workspaceDir, workspaceId } from "./workspace.ts";

export type JobState = "corriendo" | "listo" | "error";

export interface Job {
  id: string;
  state: JobState;
  /** Texto de lo que se comparó, para mostrar en el avance. */
  summary: string;
  /** Comparación del ejemplo (sin Figma). */
  demo: boolean;
  folder: string;
  /** Salida del CLI, ya sin secretos. */
  lines: string[];
  error: string | undefined;
  /** Id del reporte (`c:<carpeta>`) cuando terminó bien. */
  reportId: string | undefined;
  startedAt: number;
  finishedAt: number | undefined;
}

export type StartResult = { ok: true; job: Job } | { ok: false; status: number; error: string };

export interface StartOptions {
  root?: string;
  workspace?: string;
  status: EnvStatus;
  /** Sustituible en pruebas. */
  spawn?: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Pick<ChildProcess, "stdout" | "stderr" | "on" | "kill">;
  timeoutMs?: number;
  now?: () => Date;
  secrets?: string[];
}

export const MAX_LINES = 200;
export const DEFAULT_TIMEOUT_MS = 3 * 60_000;

export const NO_FIGMA_TOKEN =
  "Falta el token de Figma. Cree uno en Figma (Settings → Security → Personal access tokens, con permiso de lectura de archivos) y guárdelo en el archivo .env.local de la carpeta del proyecto como FIGMA_TOKEN=… (vea .env.example). Después reinicie «npm run app». Mientras tanto puede probar con el ejemplo, que no lo necesita.";
export const NO_AI_KEY = "Falta la clave de Anthropic para la capa de IA. Guárdela en .env.local como ANTHROPIC_API_KEY=… (vea .env.example) y reinicie la app, o apague la IA.";
export const NO_CHROMIUM = "No encuentro Chromium para capturar la página. Instálelo con «npx playwright install chromium» y vuelva a intentar.";
export const BUSY = "Ya hay una comparación en curso. Espere a que termine para iniciar otra.";

/** Argumentos del CLI para un trabajo. Cada valor va pegado a su opción con «=» para que nunca se lea como otra opción; y no hay shell. */
export function buildArgs(input: JobInput, out: string, root: string): string[] {
  const args = ["compare", `--out=${out}`, `--scale=${input.scale}`];
  if (input.demo) {
    args.push(`--design=${join(root, "fixtures", "landing", "design.snapshot.json")}`, `--page=${pathToFileURL(join(root, "fixtures", "landing", "page", "index.html")).href}`);
  } else {
    args.push(`--figma=${input.figmaUrl}`, `--page=${input.pageUrl}`);
  }
  if (input.width !== undefined) args.push(`--width=${input.width}`);
  for (const sel of input.ignore) args.push(`--ignore-selector=${sel}`);
  if (input.ai) args.push("--ai", `--ai-max-cost=${input.aiMaxCost}`);
  return args;
}

const describe = (input: JobInput): string => {
  if (input.demo) return "Ejemplo «Casa Nube»: diseño guardado y página de ejemplo";
  let host = input.pageUrl ?? "";
  try {
    const u = new URL(input.pageUrl ?? "");
    host = u.protocol === "file:" ? u.pathname : u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    /* se muestra tal cual */
  }
  return host;
};

/** Pasos del avance a partir de lo que ya imprimió el CLI. */
export interface Step {
  id: "diseno" | "captura" | "comparacion" | "visual";
  label: string;
  status: "pendiente" | "en curso" | "hecho";
}

export function stepsOf(job: Pick<Job, "state" | "lines" | "demo">): Step[] {
  const demo = job.demo;
  const seen = (re: RegExp) => job.lines.some((l) => re.test(l));
  const done = job.state === "listo";
  const sawCapture = seen(/^Capturando /);
  const sawCompare = seen(/^Comparando /);
  const sawVisual = seen(/^Calculando la diferencia visual/);
  const sawScore = seen(/^Puntaje de paridad/);
  const order: [Step["id"], string, boolean][] = [
    ["diseno", demo ? "Usar el diseño guardado" : "Leer el frame de Figma", demo || sawCapture || sawCompare || sawVisual || sawScore || done],
    ["captura", "Capturar la página", sawCompare || sawVisual || sawScore || done],
    ["comparacion", "Comparar elementos", sawVisual || sawScore || done],
    ["visual", "Calcular la diferencia visual", sawScore || done],
  ];
  let active = false;
  return order.map(([id, label, finished]) => {
    if (finished) return { id, label, status: "hecho" };
    if (!active && job.state === "corriendo") {
      active = true;
      return { id, label, status: "en curso" };
    }
    return { id, label, status: "pendiente" };
  });
}

/** Hay como máximo una comparación a la vez: Chromium y la red ya son suficiente carga para una máquina personal. */
export const runningJob = (): Job | undefined => {
  const id = store().running;
  return id ? store().jobs.get(id) : undefined;
};
export const getJob = (id: string): Job | undefined => store().jobs.get(id);

export function startJob(input: JobInput, options: StartOptions): StartResult {
  const s = store();
  if (runningJob()?.state === "corriendo") return { ok: false, status: 409, error: BUSY };
  // Estas comprobaciones van antes de lanzar nada: sin token no se arranca ningún proceso.
  if (!input.demo && !options.status.figma) return { ok: false, status: 422, error: NO_FIGMA_TOKEN };
  if (input.ai && !options.status.ai) return { ok: false, status: 422, error: NO_AI_KEY };
  if (!options.status.chromium) return { ok: false, status: 422, error: NO_CHROMIUM };

  const root = options.root ?? repoRoot();
  const workspace = options.workspace ?? workspaceDir();
  const now = (options.now ?? (() => new Date()))();
  const base = folderName(now, input.demo ? "ejemplo" : describeHint(input));
  let folder = base;
  for (let n = 2; existsSync(join(workspace, folder)) || [...s.jobs.values()].some((j) => j.folder === folder); n++) folder = `${base}-${n}`;
  if (!isFolderName(folder)) return { ok: false, status: 500, error: "No se pudo crear la carpeta del reporte." };
  const out = join(workspace, folder);
  mkdirSync(workspace, { recursive: true });

  const job: Job = { id: folder, state: "corriendo", summary: describe(input), demo: input.demo, folder, lines: [], error: undefined, reportId: undefined, startedAt: now.getTime(), finishedAt: undefined };
  s.jobs.set(job.id, job);
  s.running = job.id;

  const secrets = options.secrets ?? secretValues(root);
  const stderrLines: string[] = [];
  const push = (chunk: Buffer | string, err: boolean) => {
    for (const raw of String(chunk).split(/\r?\n/)) {
      const line = maskSecrets(raw, secrets).trimEnd();
      if (!line) continue;
      job.lines.push(line);
      if (err) stderrLines.push(line);
    }
    if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
  };

  const spawnFn = options.spawn ?? ((cmd, args, o) => nodeSpawn(cmd, args, { ...o, stdio: ["ignore", "pipe", "pipe"], shell: false }));
  let child: ReturnType<NonNullable<StartOptions["spawn"]>>;
  const finish = (state: JobState, error?: string) => {
    if (job.state !== "corriendo") return;
    job.state = state;
    job.error = error;
    job.finishedAt = Date.now();
    if (state === "listo") job.reportId = workspaceId(folder);
    if (s.running === job.id) s.running = undefined;
    clearTimeout(timer);
  };
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => {
    child?.kill("SIGKILL");
    finish("error", `La comparación tardó más de ${Math.round(timeoutMs / 60_000) || 1} min y se detuvo. Revise que la página responda y vuelva a intentar.`);
  }, timeoutMs);
  timer.unref?.();

  try {
    child = spawnFn(process.execPath, [join(root, "apps", "cli", "bin", "paridad.mjs"), ...buildArgs(input, out, root)], { cwd: root, env: { ...process.env, NO_COLOR: "1" } });
  } catch (e) {
    finish("error", `No se pudo iniciar la comparación: ${maskSecrets(e instanceof Error ? e.message : String(e), secrets)}`);
    return { ok: true, job };
  }
  child.stdout?.on("data", (d) => push(d, false));
  child.stderr?.on("data", (d) => push(d, true));
  child.on("error", (e: Error) => finish("error", `No se pudo iniciar la comparación: ${maskSecrets(e.message, secrets)}`));
  child.on("close", (code: number | null) => {
    if (code === 0 && existsSync(join(out, "report.json"))) return finish("listo");
    const last = [...stderrLines].reverse().find((l) => l.startsWith("Error:"));
    finish("error", last ? last.replace(/^Error:\s*/, "") : `La comparación terminó con un error (código ${code ?? "desconocido"}).`);
  });
  return { ok: true, job };
}

function describeHint(input: JobInput): string {
  try {
    const u = new URL(input.pageUrl ?? "");
    return u.protocol === "file:" ? u.pathname.split("/").filter(Boolean).slice(-2, -1)[0] ?? "pagina" : u.hostname + u.pathname;
  } catch {
    return "pagina";
  }
}
