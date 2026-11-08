import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Datos de prueba compartidos. No depende de ningún otro paquete (así `core` puede usarlo
 * en sus pruebas sin ciclos). Solo expone rutas y lectura de JSON sin validar; la validación
 * la hace quien lo consume (`parseSnapshot` de `@paridad/core`).
 */
const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

export const landing = {
  /** Carpeta de la página de ejemplo. */
  dir: here("./landing"),
  /** Carpeta servible de la página (HTML + CSS + fuentes). */
  pageDir: here("./landing/page"),
  pageIndex: here("./landing/page/index.html"),
  pageStyles: here("./landing/page/styles.css"),
  designSnapshot: here("./landing/design.snapshot.json"),
  designImage: here("./landing/design.png"),
  /** Tamaño de ventana con el que se diseñó y se mide la página. */
  viewport: { width: 1440, height: 900 },
} as const;

/** Lee `design.snapshot.json` tal cual (sin validar). */
export function readLandingDesignSnapshot(): unknown {
  return JSON.parse(readFileSync(landing.designSnapshot, "utf8"));
}
