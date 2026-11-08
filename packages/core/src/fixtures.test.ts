import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { landing, readLandingDesignSnapshot } from "@paridad/fixtures";
import { assertSnapshot, normalizeText } from "./index.ts";

/** Texto visible aproximado del HTML: sin etiquetas, con entidades básicas resueltas. */
function visibleText(html: string): string {
  return normalizeText(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " "),
  );
}

describe("fixtures/landing", () => {
  const snapshot = assertSnapshot(readLandingDesignSnapshot(), "snapshot de diseño de landing");
  const html = readFileSync(landing.pageIndex, "utf8");
  const css = readFileSync(landing.pageStyles, "utf8");

  it("el snapshot de diseño es válido y de tipo «design»", () => {
    expect(snapshot.source).toBe("design");
    expect(snapshot.canvas.width).toBe(landing.viewport.width);
    expect(snapshot.elements.length).toBeGreaterThan(20);
  });

  it("tiene encabezado, hero, tres tarjetas y botón", () => {
    const ids = new Set(snapshot.elements.map((e) => e.id));
    for (const id of ["logo", "hero-titulo", "btn-primario", "tarjeta-1", "tarjeta-2", "tarjeta-3", "pie-texto"]) {
      expect(ids.has(id), `falta el elemento «${id}»`).toBe(true);
    }
  });

  it("todos los textos del snapshot aparecen en el HTML", () => {
    const page = visibleText(html);
    for (const el of snapshot.elements.filter((e) => e.text)) {
      expect(page, `texto de «${el.id}»`).toContain(el.text!.normalized);
    }
  });

  it("los colores y fuentes usados están en la paleta declarada", () => {
    const palette = new Set(snapshot.palette!.colors.map((c) => c.hex));
    const families = new Map(snapshot.palette!.fonts.map((f) => [f.family, new Set(f.weights)] as const));
    for (const el of snapshot.elements) {
      for (const c of [el.style.color, el.style.background, el.style.border?.color]) {
        if (c) expect(palette.has(c), `color ${c} de «${el.id}» fuera de la paleta`).toBe(true);
      }
      if (el.style.fontFamily) {
        expect(families.get(el.style.fontFamily)?.has(el.style.fontWeight ?? 400), `fuente de «${el.id}»`).toBe(true);
      }
    }
  });

  it("design.png existe y mide lo que dice el snapshot", () => {
    expect(existsSync(landing.designImage)).toBe(true);
    const png = readFileSync(landing.designImage);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    const { width, height } = snapshot.canvas.image!;
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
  });

  it("las fuentes que referencia el CSS existen en disco", () => {
    const files = [...css.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) expect(existsSync(`${landing.pageDir}/${f}`), f).toBe(true);
  });
});
