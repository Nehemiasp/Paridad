import { PNG } from "pngjs";

/** Imagen RGBA en memoria. */
export interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes por píxel. */
  data: Uint8Array;
}

export type Rgba = readonly [number, number, number, number];

export function decodePng(buf: Uint8Array): Raster {
  const png = PNG.sync.read(Buffer.from(buf));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

export function encodePng(r: Raster): Buffer {
  const png = new PNG({ width: r.width, height: r.height });
  png.data = Buffer.from(r.data);
  return PNG.sync.write(png);
}

export function createRaster(width: number, height: number, fill: Rgba = [0, 0, 0, 0]): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}

/** Reduce una imagen en un factor entero promediando bloques (así una imagen @2x se compara con una @1x sin ruido). */
export function downscale(r: Raster, factor: number): Raster {
  if (factor === 1) return r;
  if (!Number.isInteger(factor) || factor < 1) throw new Error(`El factor de reducción debe ser un entero ≥ 1 (recibí ${factor}).`);
  const w = Math.floor(r.width / factor);
  const h = Math.floor(r.height / factor);
  const out = createRaster(w, h);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * r.width + (x * factor + dx)) * 4;
          for (let c = 0; c < 4; c++) sum[c]! += r.data[i + c]!;
        }
      }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out.data[o + c] = Math.round(sum[c]! / n);
    }
  }
  return out;
}

/** Recorta o rellena (con `fill`) hasta el tamaño pedido, anclando arriba a la izquierda. */
export function fitTo(r: Raster, width: number, height: number, fill: Rgba): Raster {
  if (r.width === width && r.height === height) return r;
  const out = createRaster(width, height, fill);
  const cw = Math.min(width, r.width);
  const ch = Math.min(height, r.height);
  for (let y = 0; y < ch; y++) {
    out.data.set(r.data.subarray(y * r.width * 4, (y * r.width + cw) * 4), y * width * 4);
  }
  return out;
}
