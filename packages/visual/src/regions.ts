import type { Box } from "@paridad/core";

export interface RawRegion {
  /** Caja que contiene todos los píxeles distintos de la región, en px de la imagen alineada. */
  box: Box;
  diffPixels: number;
  /** Píxeles distintos / área de la caja. */
  ratio: number;
}

interface Acc {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
}

/**
 * Agrupa los píxeles distintos en rectángulos.
 *
 * 1. Se divide la imagen en celdas y se marcan las que tienen alguna diferencia.
 * 2. Las celdas marcadas que se tocan (también en diagonal) o están a una celda de distancia forman una región.
 * 3. Cada región se mide con sus píxeles reales (caja ajustada) y se descartan las que tienen pocos píxeles (ruido).
 * 4. Las cajas que se solapan se fusionan.
 */
export function findRegions(mask: Uint8Array, width: number, height: number, opts: { cell: number; minPixels: number }): RawRegion[] {
  const { cell, minPixels } = opts;
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  const active = new Uint8Array(gw * gh);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (mask[y * width + x]) active[Math.floor(y / cell) * gw + Math.floor(x / cell)] = 1;
  }

  // Componentes conexas sobre la rejilla, con una celda de tolerancia (se unen diferencias cercanas).
  const label = new Int32Array(gw * gh).fill(-1);
  let labels = 0;
  const stack: number[] = [];
  for (let start = 0; start < active.length; start++) {
    if (!active[start] || label[start] !== -1) continue;
    label[start] = labels;
    stack.push(start);
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % gw;
      const cy = Math.floor(c / gw);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const n = ny * gw + nx;
          if (active[n] && label[n] === -1) {
            label[n] = labels;
            stack.push(n);
          }
        }
      }
    }
    labels++;
  }

  const acc: Acc[] = Array.from({ length: labels }, () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0 }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const a = acc[label[Math.floor(y / cell) * gw + Math.floor(x / cell)]!]!;
      a.x0 = Math.min(a.x0, x);
      a.y0 = Math.min(a.y0, y);
      a.x1 = Math.max(a.x1, x + 1);
      a.y1 = Math.max(a.y1, y + 1);
      a.n++;
    }
  }

  let regions = acc.filter((a) => a.n >= minPixels);
  // Fusionar cajas que se solapan, hasta que ya no haya ninguna.
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const a = regions[i]!;
        const b = regions[j]!;
        if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
          regions[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), n: a.n + b.n };
          regions.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  return regions
    .map((a) => {
      const box = { x: a.x0, y: a.y0, width: a.x1 - a.x0, height: a.y1 - a.y0 };
      return { box, diffPixels: a.n, ratio: a.n / (box.width * box.height) };
    })
    .sort((a, b) => b.diffPixels - a.diffPixels);
}
