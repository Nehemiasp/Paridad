import pixelmatch from "pixelmatch";
import type { Box } from "@paridad/core";
import { createRaster, decodePng, downscale, encodePng, fitTo, type Raster, type Rgba } from "./raster.ts";
import { findRegions, type RawRegion } from "./regions.ts";

/** Color con el que se rellena lo que una de las dos imágenes no tiene (si una página es más alta que la otra). */
const MISSING: Rgba = [255, 0, 255, 255];
const BRAND_BLUE: Rgba = [4, 53, 101, 255];

export interface VisualDiffInput {
  design: { png: Uint8Array; scale: number };
  page: { png: Uint8Array; scale: number };
  /** Zonas a ignorar, en px CSS (coordenadas de lienzo). */
  ignoreRects?: Box[];
  /** 0–1, sensibilidad de pixelmatch: menor = más sensible. Por defecto 0.1. */
  threshold?: number;
  /** px CSS: tamaño de la rejilla con la que se agrupan los píxeles. Por defecto 8. */
  cellPx?: number;
  /** Mínimo de píxeles distintos para que una región cuente (descarta ruido). Por defecto 16. */
  minRegionPixels?: number;
}

export interface VisualRegion extends RawRegion {
  id: string;
}

export interface VisualDiffResult {
  /** PNG: la página atenuada, con el calor de las diferencias y los recuadros de las regiones. */
  heatmap: Buffer;
  /** Tamaño del lienzo alineado, en px CSS, y escala de las imágenes comparadas. */
  aligned: { width: number; height: number; scale: number };
  diffPixels: number;
  totalPixels: number;
  /** Píxeles excluidos por las zonas a ignorar. */
  ignoredPixels: number;
  diffRatio: number;
  /** Regiones con diferencias, en px CSS, de mayor a menor. */
  regions: VisualRegion[];
  /** Los dos lienzos no miden lo mismo de ancho: se comparó la parte común. */
  widthMismatch: boolean;
}

/**
 * Diferencia por píxeles entre la imagen del diseño y la de la página.
 *
 * Alineación: ambas se llevan a la menor de las dos escalas (promediando bloques) y al mismo tamaño; si una
 * es más alta, lo que le falta se rellena con magenta, que cuenta como diferencia y queda marcado como región.
 */
export function visualDiff(input: VisualDiffInput): VisualDiffResult {
  const threshold = input.threshold ?? 0.1;
  const cellPx = input.cellPx ?? 8;
  const minRegionPixels = input.minRegionPixels ?? 16;

  const d0 = decodePng(input.design.png);
  const p0 = decodePng(input.page.png);
  const target = Math.min(input.design.scale, input.page.scale);
  const d1 = downscale(d0, input.design.scale / target);
  const p1 = downscale(p0, input.page.scale / target);

  const width = Math.min(d1.width, p1.width);
  const height = Math.max(d1.height, p1.height);
  const widthMismatch = d1.width !== p1.width;
  const d = fitTo(d1, width, height, MISSING);
  const p = fitTo(p1, width, height, MISSING);

  // Zonas a ignorar → máscara de píxeles.
  const ignore = new Uint8Array(width * height);
  let ignoredPixels = 0;
  for (const z of input.ignoreRects ?? []) {
    const x0 = Math.max(0, Math.floor(z.x * target));
    const y0 = Math.max(0, Math.floor(z.y * target));
    const x1 = Math.min(width, Math.ceil((z.x + z.width) * target));
    const y1 = Math.min(height, Math.ceil((z.y + z.height) * target));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ignore[y * width + x] = 1;
  }
  for (const v of ignore) ignoredPixels += v;

  const out = new Uint8Array(width * height * 4);
  const diffPixels = pixelmatch(d.data, p.data, out, width, height, { threshold, includeAA: false, diffMask: true, diffColor: [255, 0, 0], aaColor: [255, 255, 0], ignoreMask: ignore });

  // Máscara binaria: solo los píxeles realmente distintos (rojo puro), no los de antialiasing (amarillo).
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    mask[i] = out[o + 3]! > 0 && out[o]! > 200 && out[o + 1]! < 60 && out[o + 2]! < 60 ? 1 : 0;
  }

  const cell = Math.max(1, Math.round(cellPx * target));
  const raw = findRegions(mask, width, height, { cell, minPixels: minRegionPixels });
  const regions: VisualRegion[] = raw.map((r, i) => ({
    id: `r${i + 1}`,
    diffPixels: r.diffPixels,
    ratio: r.ratio,
    box: { x: round2(r.box.x / target), y: round2(r.box.y / target), width: round2(r.box.width / target), height: round2(r.box.height / target) },
  }));

  // Los recuadros del mapa de calor se dibujan en píxeles de la imagen alineada, no en px CSS.
  const heat = drawHeatmap(p, mask, width, height, cell, raw.map((r) => r.box), target);

  const total = width * height;
  return {
    heatmap: encodePng(heat),
    aligned: { width: width / target, height: height / target, scale: target },
    diffPixels,
    totalPixels: total,
    ignoredPixels,
    diffRatio: total - ignoredPixels > 0 ? diffPixels / (total - ignoredPixels) : 0,
    regions,
    widthMismatch,
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** La página atenuada y en grises, con calor por celda donde hay diferencias y un recuadro por región. */
function drawHeatmap(base: Raster, mask: Uint8Array, width: number, height: number, cell: number, boxes: Box[], scale: number): Raster {
  const out = createRaster(width, height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const gray = 0.299 * base.data[o]! + 0.587 * base.data[o + 1]! + 0.114 * base.data[o + 2]!;
    const light = 255 - (255 - gray) * 0.4;
    out.data.set([light, light, light, 255], o);
  }

  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      let count = 0;
      const x1 = Math.min(width, (cx + 1) * cell);
      const y1 = Math.min(height, (cy + 1) * cell);
      for (let y = cy * cell; y < y1; y++) for (let x = cx * cell; x < x1; x++) count += mask[y * width + x]!;
      if (!count) continue;
      const heat = Math.min(1, count / (cell * cell * 0.25));
      const color = [255, 210 - 190 * heat, 0] as const; // amarillo → rojo
      const alpha = 0.25 + 0.5 * heat;
      for (let y = cy * cell; y < y1; y++) {
        for (let x = cx * cell; x < x1; x++) {
          const o = (y * width + x) * 4;
          for (let c = 0; c < 3; c++) out.data[o + c] = Math.round(out.data[o + c]! * (1 - alpha) + color[c]! * alpha);
        }
      }
    }
  }
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.data.set([200, 0, 0, 255], i * 4);

  const stroke = Math.max(1, Math.round(scale));
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x) - 2);
    const y0 = Math.max(0, Math.floor(b.y) - 2);
    const x1 = Math.min(width - 1, Math.ceil(b.x + b.width) + 1);
    const y1 = Math.min(height - 1, Math.ceil(b.y + b.height) + 1);
    for (let s = 0; s < stroke; s++) {
      for (let x = x0; x <= x1; x++) {
        out.data.set(BRAND_BLUE, (Math.min(height - 1, y0 + s) * width + x) * 4);
        out.data.set(BRAND_BLUE, (Math.max(0, y1 - s) * width + x) * 4);
      }
      for (let y = y0; y <= y1; y++) {
        out.data.set(BRAND_BLUE, (y * width + Math.min(width - 1, x0 + s)) * 4);
        out.data.set(BRAND_BLUE, (y * width + Math.max(0, x1 - s)) * 4);
      }
    }
  }
  return out;
}
