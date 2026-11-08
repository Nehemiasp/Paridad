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
  /** Respuestas de la API de Figma con su forma (escritas a mano, no grabadas; ver landing/figma/README.md). */
  figmaNodes: here("./landing/figma/nodes.json"),
  figmaImages: here("./landing/figma/images.json"),
  /** Archivo y frame ficticios a los que corresponden esos datos. */
  figmaUrl: "https://www.figma.com/design/AbCdEf123456/Casa-Nube?node-id=1-2",
  /** Tamaño de ventana con el que se diseñó y se mide la página. */
  viewport: { width: 1440, height: 900 },
} as const;

/** Lee `design.snapshot.json` tal cual (sin validar). */
export function readLandingDesignSnapshot(): unknown {
  return JSON.parse(readFileSync(landing.designSnapshot, "utf8"));
}

/** Lee la respuesta grabada de `GET /v1/files/:key/nodes` (sin validar). */
export function readFigmaNodesResponse(): Record<string, unknown> {
  return JSON.parse(readFileSync(landing.figmaNodes, "utf8")) as Record<string, unknown>;
}

/** Lee la respuesta grabada de `GET /v1/images/:key`. */
export function readFigmaImagesResponse(): Record<string, unknown> {
  return JSON.parse(readFileSync(landing.figmaImages, "utf8")) as Record<string, unknown>;
}
