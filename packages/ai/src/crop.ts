import type { Box, Finding } from "@paridad/core";
import { decodePng, encodePng, type Raster } from "@paridad/visual";

export interface Crop {
  base64: string;
  width: number;
  height: number;
  /** Región recortada, en px CSS. */
  region: Box;
}

const WEIGHT = { critical: 8, high: 4, medium: 2, low: 1 } as const;

const unionBox = (a: Box, b: Box): Box => {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, width: Math.max(a.x + a.width, b.x + b.width) - x0, height: Math.max(a.y + a.height, b.y + b.height) - y0 };
};

/** Caja de un hallazgo en la imagen: la unión de sus cajas en diseño y página (o su región visual). */
export function boxOf(f: Finding): Box | undefined {
  const boxes = [f.design?.box, f.page?.box, f.region?.box].filter((b): b is Box => b !== undefined);
  return boxes.reduce<Box | undefined>((acc, b) => (acc ? unionBox(acc, b) : b), undefined);
}

/**
 * Las regiones que vale la pena mostrarle al modelo: se juntan las cajas de los hallazgos que están cerca en vertical
 * y se eligen las que más pesan (por severidad), hasta `max`. Así se envía una fracción de la imagen y no toda.
 */
export function pickRegions(findings: Finding[], canvas: { width: number; height: number }, opts: { max?: number; pad?: number; mergeGap?: number } = {}): Box[] {
  const max = opts.max ?? 3;
  const pad = opts.pad ?? 16;
  const gap = opts.mergeGap ?? 120;
  const items = findings.flatMap((f) => {
    const b = boxOf(f);
    return b ? [{ box: b, weight: WEIGHT[f.severity] }] : [];
  });
  items.sort((a, b) => a.box.y - b.box.y);

  const clusters: { box: Box; weight: number }[] = [];
  for (const it of items) {
    const last = clusters[clusters.length - 1];
    if (last && it.box.y <= last.box.y + last.box.height + gap) {
      last.box = unionBox(last.box, it.box);
      last.weight += it.weight;
    } else clusters.push({ box: it.box, weight: it.weight });
  }
  return clusters
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .map(({ box }) => {
      const x = Math.max(0, box.x - pad);
      const y = Math.max(0, box.y - pad);
      return { x, y, width: Math.min(canvas.width - x, box.width + 2 * pad), height: Math.min(canvas.height - y, box.height + 2 * pad) };
    })
    .filter((b) => b.width > 0 && b.height > 0)
    .sort((a, b) => a.y - b.y);
}

/** Interpolación bilineal para reducir una imagen a un tamaño menor. */
function resize(src: Raster, width: number, height: number): Raster {
  const out = new Uint8Array(width * height * 4);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(src.height - 1, (y + 0.5) * sy - 0.5);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const ty = Math.max(0, fy - y0);
    for (let x = 0; x < width; x++) {
      const fx = Math.min(src.width - 1, (x + 0.5) * sx - 0.5);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const tx = Math.max(0, fx - x0);
      for (let c = 0; c < 4; c++) {
        const p = (yy: number, xx: number) => src.data[(yy * src.width + xx) * 4 + c]!;
        const top = p(y0, x0) * (1 - tx) + p(y0, x1) * tx;
        const bottom = p(y1, x0) * (1 - tx) + p(y1, x1) * tx;
        out[(y * width + x) * 4 + c] = Math.round(top * (1 - ty) + bottom * ty);
      }
    }
  }
  return { width, height, data: out };
}

/** Recorta una región (en px CSS) de una imagen PNG y la reduce para que su lado mayor no pase de `maxSide` px. */
export function cropRegion(png: Uint8Array, scale: number, region: Box, maxSide = 900): Crop {
  const img = decodePng(png);
  const x0 = Math.max(0, Math.floor(region.x * scale));
  const y0 = Math.max(0, Math.floor(region.y * scale));
  const w = Math.max(1, Math.min(img.width - x0, Math.ceil(region.width * scale)));
  const h = Math.max(1, Math.min(img.height - y0, Math.ceil(region.height * scale)));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  let out: Raster = { width: w, height: h, data };
  const longest = Math.max(w, h);
  if (longest > maxSide) {
    const k = maxSide / longest;
    out = resize(out, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  }
  return { base64: encodePng(out).toString("base64"), width: out.width, height: out.height, region };
}
