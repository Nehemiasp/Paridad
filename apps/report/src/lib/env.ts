import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";

// Esta app solo corre en la máquina de la persona y lee carpetas que ella indica: el rastreo del proyecto entero
// que advierte Turbopack (pensado para despliegues) no aplica, por eso se silencia en estas rutas dinámicas.
/** Raíz del repositorio: donde viven `.env.local`, `fixtures/` y el CLI. La define `paridad app`; si no, dos carpetas arriba de la app. */
export const repoRoot = (): string => resolve(/*turbopackIgnore: true*/ process.env.PARIDAD_ROOT ?? join(process.cwd(), "..", ".."));

/** Variables de `.env.local` sobre el entorno, igual que el CLI. */
function readEnv(root: string = repoRoot()): Record<string, string | undefined> {
  const file = join(root, ".env.local");
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  return { ...fromFile, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== "")) };
}

export interface EnvStatus {
  /** ¿Hay token de Figma? Nunca se devuelve su valor. */
  figma: boolean;
  /** ¿Hay clave de Anthropic para la capa de IA? */
  ai: boolean;
  /** ¿Está instalado Chromium para capturar páginas? */
  chromium: boolean;
}

export async function envStatus(root: string = repoRoot()): Promise<EnvStatus> {
  const env = readEnv(root);
  let chromium = false;
  try {
    const pw = await import("playwright");
    chromium = existsSync(pw.chromium.executablePath());
  } catch {
    chromium = false;
  }
  return { figma: Boolean(env.FIGMA_TOKEN), ai: Boolean(env.ANTHROPIC_API_KEY), chromium };
}

/** Valores secretos que no deben aparecer en ningún texto que llegue al navegador. */
export function secretValues(root: string = repoRoot()): string[] {
  const env = readEnv(root);
  return [env.FIGMA_TOKEN, env.ANTHROPIC_API_KEY].filter((v): v is string => typeof v === "string" && v.length >= 6);
}

/** Reemplaza por `***` cualquier secreto (y cualquier cosa con forma de token conocido) que aparezca en un texto. */
export function maskSecrets(line: string, secrets: string[]): string {
  let out = line;
  for (const s of secrets) out = out.split(s).join("***");
  return out.replace(/\b(figd_[A-Za-z0-9_-]{10,}|sk-ant-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, "***");
}
