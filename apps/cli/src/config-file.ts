import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveConfig, type ResolvedConfig } from "@paridad/core";

const CANDIDATES = ["paridad.config.ts", "paridad.config.mts", "paridad.config.js", "paridad.config.mjs"];

/**
 * Carga `paridad.config.ts` (o la ruta de `--config`). Sin archivo, usa los valores por defecto.
 * El archivo exporta por defecto `defineConfig({...})`; lo que falte se completa.
 */
export async function loadConfigFile(cwd: string, explicit?: string): Promise<{ config: ResolvedConfig; path: string | undefined }> {
  const path = explicit ? resolve(cwd, explicit) : CANDIDATES.map((c) => resolve(cwd, c)).find((p) => existsSync(p));
  if (explicit && !existsSync(path!)) throw new Error(`No existe el archivo de configuración «${explicit}».`);
  if (!path) return { config: resolveConfig(), path: undefined };

  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
  } catch (cause) {
    throw new Error(`No se pudo cargar ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!mod.default || typeof mod.default !== "object") {
    throw new Error(`${path} debe exportar por defecto la configuración: export default defineConfig({ … }).`);
  }
  return { config: resolveConfig(mod.default as Parameters<typeof resolveConfig>[0]), path };
}
