import type { Box } from "@paridad/core";
import type { Raster, Rgba } from "./raster.ts";

/** Distancia máxima entre canales a partir de la cual dos píxeles se consideran distintos (≈ umbral 0.1 de pixelmatch). */
const CHANNEL_TOLERANCE = 24;
/** Fracción de píxeles de la región que puede no coincidir y aun así llamarla «una copia desplazada». */
const MAX_MISMATCH = 0.015;

/**
 * ¿La región de la página es el contenido del diseño pero corrido unos píxeles?
 *
 * Cuando algo crece 8 px, todo lo de abajo baja 8 px: los píxeles cambian, pero ninguna regla de color, tipo o
 * tamaño los explica, porque no cambió nada de eso: solo se movió. Se prueba cada desplazamiento (vertical y
 * horizontal, de menor a mayor) comparando el recorte de la página con el del diseño corrido; el primero que
 * coincide casi por completo gana. Devuelve el desplazamiento en píxeles de la imagen alineada.
 */
export function findShift(design: Raster, page: Raster, box: Box, maxShift: number, outside: Rgba): { dx: number; dy: number } | undefined {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(page.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(page.height, Math.ceil(box.y + box.height));
  const total = (x1 - x0) * (y1 - y0);
  if (total <= 0) return undefined;
  const allowed = Math.max(2, Math.floor(total * MAX_MISMATCH));

  const matches = (dx: number, dy: number): boolean => {
    let bad = 0;
    for (let y = y0; y < y1; y++) {
      const sy = y - dy;
      for (let x = x0; x < x1; x++) {
        const sx = x - dx;
        const o = (y * page.width + x) * 4;
        // Fuera del diseño no hay nada: se compara contra el color de relleno (así una página más corta, cuyo
        // sobrante ya viene rellenado igual, no cuenta como diferencia).
        const inside = sx >= 0 && sy >= 0 && sx < design.width && sy < design.height;
        const s = (sy * design.width + sx) * 4;
        const d = Math.max(
          Math.abs(page.data[o]! - (inside ? design.data[s]! : outside[0])),
          Math.abs(page.data[o + 1]! - (inside ? design.data[s + 1]! : outside[1])),
          Math.abs(page.data[o + 2]! - (inside ? design.data[s + 2]! : outside[2])),
        );
        if (d > CHANNEL_TOLERANCE && ++bad > allowed) return false;
      }
    }
    return true;
  };

  for (let s = 1; s <= maxShift; s++) {
    for (const [dx, dy] of [[0, s], [0, -s], [s, 0], [-s, 0]] as const) {
      if (matches(dx, dy)) return { dx, dy };
    }
  }
  return undefined;
}
