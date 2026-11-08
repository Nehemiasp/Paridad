import { describe, expect, it } from "vitest";
import { createRaster, decodePng, encodePng, visualDiff, type Raster } from "../src/index.ts";

const WHITE = [255, 255, 255, 255] as const;

/** Pinta un rectángulo sólido. */
function rect(r: Raster, x: number, y: number, w: number, h: number, color: readonly [number, number, number, number]): Raster {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) r.data.set(color, (yy * r.width + xx) * 4);
  return r;
}
const page = (w = 200, h = 100) => createRaster(w, h, WHITE);
const png = (r: Raster) => encodePng(r);
const diff = (d: Raster, p: Raster, extra: Partial<Parameters<typeof visualDiff>[0]> = {}) =>
  visualDiff({ design: { png: png(d), scale: 1 }, page: { png: png(p), scale: 1 }, ...extra });

describe("visualDiff", () => {
  it("imágenes iguales: cero diferencias y ninguna región", () => {
    const r = diff(rect(page(), 10, 10, 50, 20, [4, 53, 101, 255]), rect(page(), 10, 10, 50, 20, [4, 53, 101, 255]));
    expect(r.diffPixels).toBe(0);
    expect(r.regions).toEqual([]);
    expect(r.diffRatio).toBe(0);
    expect(r.aligned).toEqual({ width: 200, height: 100, scale: 1 });
  });

  it("un rectángulo distinto es una región con su caja exacta", () => {
    const r = diff(page(), rect(page(), 40, 30, 60, 20, [200, 30, 30, 255]));
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]).toMatchObject({ id: "r1", box: { x: 40, y: 30, width: 60, height: 20 }, diffPixels: 1200, ratio: 1 });
    expect(r.diffPixels).toBe(1200);
    expect(r.diffRatio).toBeCloseTo(1200 / 20000, 6);
  });

  it("dos diferencias lejanas son dos regiones, ordenadas de mayor a menor", () => {
    const p = rect(rect(page(400, 200), 10, 10, 20, 20, [0, 0, 0, 255]), 300, 150, 50, 30, [0, 0, 0, 255]);
    const r = diff(page(400, 200), p);
    expect(r.regions.map((x) => [x.id, x.diffPixels])).toEqual([["r1", 1500], ["r2", 400]]);
  });

  it("diferencias muy cercanas se agrupan en una sola región", () => {
    const p = rect(rect(page(), 20, 20, 10, 10, [0, 0, 0, 255]), 36, 20, 10, 10, [0, 0, 0, 255]); // 6 px de hueco
    const r = diff(page(), p);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.box).toEqual({ x: 20, y: 20, width: 26, height: 10 });
  });

  it("el ruido (unos pocos píxeles) no genera región", () => {
    const p = rect(page(), 50, 50, 2, 2, [0, 0, 0, 255]); // 4 píxeles
    const r = diff(page(), p);
    expect(r.diffPixels).toBe(4);
    expect(r.regions).toEqual([]);
  });

  it("una diferencia de color que el ojo no distingue no cuenta (umbral)", () => {
    const d = rect(page(), 10, 10, 50, 50, [4, 53, 101, 255]);
    const p = rect(page(), 10, 10, 50, 50, [5, 54, 102, 255]);
    expect(diff(d, p).diffPixels).toBe(0);
    expect(diff(d, p, { threshold: 0 }).diffPixels).toBeGreaterThan(0); // con umbral 0 sí
  });

  it("las zonas a ignorar se excluyen de la comparación", () => {
    const p = rect(page(), 40, 30, 60, 20, [200, 30, 30, 255]);
    const r = diff(page(), p, { ignoreRects: [{ x: 30, y: 20, width: 90, height: 40 }] });
    expect(r.diffPixels).toBe(0);
    expect(r.regions).toEqual([]);
    expect(r.ignoredPixels).toBe(90 * 40);
  });

  it("una zona a ignorar solo oculta lo que cubre", () => {
    const p = rect(page(), 40, 30, 60, 20, [200, 30, 30, 255]);
    const r = diff(page(), p, { ignoreRects: [{ x: 40, y: 30, width: 30, height: 20 }] });
    expect(r.diffPixels).toBe(30 * 20);
    expect(r.regions[0]!.box).toEqual({ x: 70, y: 30, width: 30, height: 20 });
  });

  it("alinea escalas: una imagen @2x contra otra @1x con el mismo contenido no difiere", () => {
    const d1 = rect(page(200, 100), 20, 10, 40, 30, [4, 53, 101, 255]);
    const d2 = rect(page(400, 200), 40, 20, 80, 60, [4, 53, 101, 255]);
    const r = visualDiff({ design: { png: png(d1), scale: 1 }, page: { png: png(d2), scale: 2 } });
    expect(r.aligned).toEqual({ width: 200, height: 100, scale: 1 });
    expect(r.diffPixels).toBe(0);
  });

  it("al comparar @2x contra @2x se conserva la escala y las regiones salen en px CSS", () => {
    const d = page(400, 200);
    const p = rect(page(400, 200), 100, 60, 80, 40, [0, 0, 0, 255]);
    const r = visualDiff({ design: { png: png(d), scale: 2 }, page: { png: png(p), scale: 2 } });
    expect(r.aligned).toEqual({ width: 200, height: 100, scale: 2 });
    expect(r.regions[0]!.box).toEqual({ x: 50, y: 30, width: 40, height: 20 });
  });

  it("si la página es más alta, la parte que el diseño no tiene es una región", () => {
    const r = diff(page(200, 100), page(200, 160));
    expect(r.aligned.height).toBe(160);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.box).toEqual({ x: 0, y: 100, width: 200, height: 60 });
  });

  it("si los anchos no coinciden, compara la parte común y lo avisa", () => {
    const r = diff(page(200, 100), page(220, 100));
    expect(r.widthMismatch).toBe(true);
    expect(r.aligned.width).toBe(200);
    expect(r.diffPixels).toBe(0);
  });

  it("el mapa de calor es un PNG del tamaño alineado y marca la región", () => {
    const r = diff(page(), rect(page(), 40, 30, 60, 20, [200, 30, 30, 255]));
    const heat = decodePng(r.heatmap);
    expect([heat.width, heat.height]).toEqual([200, 100]);
    const at = (x: number, y: number) => [...heat.data.subarray((y * heat.width + x) * 4, (y * heat.width + x) * 4 + 3)];
    expect(at(60, 40)).toEqual([200, 0, 0]); // dentro de la diferencia: rojo
    expect(at(5, 5)).toEqual([255, 255, 255]); // lejos: blanco atenuado
    expect(at(38, 40)).toEqual([4, 53, 101]); // el recuadro de la región, en azul de marca
  });

  it("falla con claridad si la escala no es un múltiplo entero", () => {
    expect(() => visualDiff({ design: { png: png(page()), scale: 2 }, page: { png: png(page()), scale: 1.5 } })).toThrow(/entero/);
  });
});
