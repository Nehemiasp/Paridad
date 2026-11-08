import { randomBytes } from "node:crypto";
import type { Job } from "./jobs.ts";

/**
 * Estado del proceso del servidor (token de sesión y trabajo en curso). Next puede cargar un módulo más de una vez
 * (una copia por ruta), así que se guarda en `globalThis`: todas las rutas ven el mismo token y el mismo trabajo.
 */
interface Store {
  token: string;
  jobs: Map<string, Job>;
  running: string | undefined;
}
const KEY = Symbol.for("paridad.store");
type G = typeof globalThis & { [KEY]?: Store };

export function store(): Store {
  const g = globalThis as G;
  return (g[KEY] ??= { token: randomBytes(16).toString("hex"), jobs: new Map(), running: undefined });
}
