import { describe, expect, it } from "vitest";
import type { Finding } from "@paridad/core";
import { decodePng } from "@paridad/visual";
import { cropRegion, pickRegions } from "./crop.ts";
import { png } from "./test-util.ts";

const at = (id: string, y: number, severity: Finding["severity"] = "low", h = 20): Finding => ({
  id, rule: "position", category: "posición", severity, title: "t", evidence: { property: "p", expected: 0, actual: 1 },
  page: { elementId: id, box: { x: 100, y, width: 200, height: h } },
});

describe("pickRegions", () => {
  const canvas = { width: 1440, height: 927 };
  it("junta hallazgos cercanos en vertical en una sola región, con margen", () => {
    const r = pickRegions([at("a", 100), at("b", 150), at("c", 200)], canvas, { pad: 10 });
    expect(r).toEqual([{ x: 90, y: 90, width: 220, height: 140 }]);
  });
  it("separa los lejanos y se queda con los que más pesan, en orden de arriba abajo", () => {
    const r = pickRegions([at("a", 50, "low"), at("b", 400, "critical"), at("c", 800, "high")], canvas, { max: 2, pad: 0 });
    expect(r.map((x) => x.y)).toEqual([400, 800]);
  });
  it("no se sale del lienzo y los hallazgos sin caja no cuentan", () => {
    const sin: Finding = { id: "s", rule: "page-height", category: "página", severity: "low", title: "t", evidence: { property: "p", expected: 0, actual: 1 } };
    expect(pickRegions([sin], canvas)).toEqual([]);
    const r = pickRegions([at("a", 5)], canvas, { pad: 50 });
    expect(r[0]!.y).toBe(0);
  });
});

describe("cropRegion", () => {
  it("recorta la región pedida (en px CSS, multiplicada por la escala)", () => {
    const c = cropRegion(png(), 1, { x: 84, y: 436, width: 181, height: 56 });
    expect(decodePng(Buffer.from(c.base64, "base64"))).toMatchObject({ width: 181, height: 56 });
    expect([c.width, c.height]).toEqual([181, 56]);
  });
  it("reduce la imagen para que su lado mayor no pase de maxSide", () => {
    const c = cropRegion(png(), 1, { x: 0, y: 0, width: 800, height: 400 }, 200);
    expect([c.width, c.height]).toEqual([200, 100]);
  });
  it("una región que se sale de la imagen se recorta a lo que hay", () => {
    const c = cropRegion(png(), 1, { x: 1400, y: 900, width: 500, height: 500 });
    expect([c.width, c.height]).toEqual([40, 27]);
  });
});
