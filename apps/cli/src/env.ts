import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

/**
 * Lee `.env.local` (donde va el token de Figma; nunca se sube al repositorio).
 * Lo que ya está definido en el entorno manda sobre el archivo.
 */
export function loadEnvLocal(cwd: string, base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const file = join(cwd, ".env.local");
  if (!existsSync(file)) return base;
  const fromFile = parseEnv(readFileSync(file, "utf8"));
  return { ...fromFile, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined && v !== "")) };
}
