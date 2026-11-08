import { describe, expect, it } from "vitest";
import { SnapshotIndex, computeScore, contrastRatio, deltaE2000, effectiveBackground, hexToRgba, resolveConfig, textSimilarity, type Finding, type Severity } from "../index.ts";
import { pageSnapshot, byName } from "./helpers.test-util.ts";

describe("contraste WCAG", () => {
  const ratio = (a: string, b: string) => contrastRatio(hexToRgba(a as never), hexToRgba(b as never));
  it("coincide con los valores de referencia", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(ratio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(ratio("#777777", "#ffffff")).toBeCloseTo(4.48, 2); // el gris más claro que casi pasa AA
    expect(ratio("#767676", "#ffffff")).toBeCloseTo(4.54, 2); // y el que pasa
  });
  it("es simétrico", () => {
    expect(ratio("#043565", "#fafaf8")).toBeCloseTo(ratio("#fafaf8", "#043565"), 10);
  });
});

describe("ΔE2000", () => {
  it("0 para el mismo color, y el valor de referencia de Sharma para un par conocido", () => {
    expect(deltaE2000("#336699", "#336699")).toBe(0);
    expect(deltaE2000("#000000", "#ffffff")).toBeCloseTo(100, 0);
  });
  it("ignora la transparencia", () => {
    expect(deltaE2000("#04356580", "#043565")).toBe(0);
  });
});

describe("fondo efectivo", () => {
  const idx = (mutate?: (p: ReturnType<typeof pageSnapshot>) => void) => {
    const p = pageSnapshot();
    mutate?.(p);
    return { p, index: new SnapshotIndex(p) };
  };
  it("sin fondos opacos arriba, es el de la raíz; sin nada, blanco", () => {
    const { p, index } = idx();
    const text = p.elements.find((e) => e.text?.normalized === "Casa Nube")!;
    expect(effectiveBackground(text, index)).toEqual({ color: { r: 250, g: 250, b: 248, a: 1 }, certain: true });
    const sinRaiz = idx((s) => delete s.elements[0]!.style.background);
    const t2 = sinRaiz.p.elements.find((e) => e.text?.normalized === "Casa Nube")!;
    expect(effectiveBackground(t2, sinRaiz.index).color).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });
  it("compone fondos con transparencia sobre el de abajo", () => {
    const { p, index } = idx((s) => (byName(s, "article.card", 0).style.background = "#00000080"));
    const card = byName(p, "article.card", 0);
    const title = p.elements.find((e) => e.parentId === card.id && e.kind === "text")!;
    const bg = effectiveBackground(title, index).color;
    expect(bg.r).toBeCloseTo(250 * (1 - 128 / 255), 5); // 50 % negro (0x80) sobre #fafaf8
  });
  it("una imagen en la cadena vuelve el resultado incierto", () => {
    const { p, index } = idx((s) => (byName(s, "article.card", 0).kind = "image"));
    const card = byName(p, "article.card", 0);
    const title = p.elements.find((e) => e.parentId === card.id && e.kind === "text")!;
    expect(effectiveBackground(title, index).certain).toBe(false);
  });
});

describe("textSimilarity", () => {
  it("1 para iguales (sin distinguir mayúsculas), 0 para totalmente distintos", () => {
    expect(textSimilarity("Hola", "hOLA")).toBe(1);
    expect(textSimilarity("abc", "xyz")).toBe(0);
    expect(textSimilarity("", "")).toBe(1);
    expect(textSimilarity("Comprar ahora", "Comprar ahor")).toBeGreaterThan(0.9);
  });
});

describe("puntaje", () => {
  const f = (category: Finding["category"], severity: Severity, n = 1): Finding[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${category}${severity}${i}`, rule: "position", category, severity, title: "", evidence: { property: "", expected: 0, actual: 0 } }));
  const cfg = resolveConfig();

  it("sin hallazgos es 100", () => {
    expect(computeScore([], cfg)).toMatchObject({ value: 100, breakdown: [] });
  });
  it("resta por severidad: crítica 15, alta 6, media 2, baja 0.5", () => {
    const s = computeScore([...f("presencia", "critical"), ...f("tipografía", "high"), ...f("color", "medium"), ...f("posición", "low")], cfg);
    expect(s.value).toBe(100 - 15 - 6 - 2 - 0.5);
    expect(s.breakdown.map((b) => [b.category, b.points])).toEqual([["presencia", 15], ["tipografía", 6], ["color", 2], ["posición", 0.5]]);
  });
  it("una categoría no resta más de su tope (40) y se explica", () => {
    const s = computeScore(f("posición", "high", 20), cfg); // 120 puntos crudos
    expect(s.value).toBe(60);
    expect(s.breakdown[0]).toMatchObject({ count: 20, rawPoints: 120, points: 40, capped: true });
  });
  it("nunca baja de 0", () => {
    const all = (["presencia", "posición", "tamaño", "tipografía", "color", "texto", "contraste", "página"] as const).flatMap((c) => f(c, "critical", 5));
    expect(computeScore(all, cfg).value).toBe(0);
  });
  it("los puntos son configurables", () => {
    const s = computeScore(f("color", "medium", 2), resolveConfig({ score: { points: { medium: 5 } } }));
    expect(s.value).toBe(90);
  });
});
