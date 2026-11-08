import { describe, expect, it } from "vitest";
import { ReportSchema, attachVisual, compare, type RawVisual } from "../index.ts";
import { byName, byText, designSnapshot, pageSnapshot, shift } from "./helpers.test-util.ts";

const raw = (regions: RawVisual["regions"], over: Partial<RawVisual> = {}): RawVisual => ({
  aligned: { width: 1440, height: 927, scale: 1 },
  diffPixels: regions.reduce((n, r) => n + r.diffPixels, 0),
  totalPixels: 1440 * 927,
  ignoredPixels: 0,
  diffRatio: 0.001,
  widthMismatch: false,
  regions,
  ...over,
});
const region = (id: string, x: number, y: number, w: number, h: number) => ({ id, box: { x, y, width: w, height: h }, diffPixels: Math.round(w * h * 0.4), ratio: 0.4 });

function setup(mutate: (page: ReturnType<typeof pageSnapshot>) => void) {
  const design = designSnapshot();
  const page = pageSnapshot();
  mutate(page);
  return { design, page, report: compare(design, page) };
}

describe("attachVisual", () => {
  it("sin regiones: el reporte no cambia, solo gana la sección visual", () => {
    const { design, page, report } = setup(() => {});
    const r = attachVisual(report, raw([], { diffPixels: 0, diffRatio: 0, heatmapPath: "heatmap.png" }), { design, page });
    expect(r.findings).toEqual(report.findings);
    expect(r.score.value).toBe(100);
    expect(r.visual).toMatchObject({ heatmapPath: "heatmap.png", regions: [] });
  });

  it("una región dentro de la caja de un hallazgo queda explicada por él", () => {
    const { design, page, report } = setup((p) => (byText(p, "Cerámica hecha con calma").style.color = "#2b2f36"));
    const f = report.findings.find((x) => x.rule === "color-text")!;
    const b = f.page!.box;
    const r = attachVisual(report, raw([region("r1", b.x + 4, b.y + 10, b.width - 8, b.height - 20)]), { design, page });
    expect(r.visual!.regions[0]).toMatchObject({ classified: true, findingIds: [f.id] });
    expect(r.findings.some((x) => x.rule === "visual-unclassified")).toBe(false);
    expect(r.score.value).toBe(report.score.value);
  });

  it("una región que ninguna regla explica se agrega como «diferencia visual sin clasificar» y baja el puntaje", () => {
    const { design, page, report } = setup(() => {});
    const r = attachVisual(report, raw([region("r1", 1000, 100, 300, 200)]), { design, page });
    const f = r.findings.filter((x) => x.rule === "visual-unclassified");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ category: "visual", severity: "high", region: { id: "r1", box: { x: 1000, y: 100, width: 300, height: 200 } } });
    expect(f[0]!.title).toContain("sin clasificar");
    expect(r.visual!.regions[0]).toMatchObject({ classified: false, findingIds: [] });
    expect(r.summary).toMatchObject({ total: 1, bySeverity: { high: 1 }, byCategory: { visual: 1 } });
    expect(r.score.value).toBe(94);
  });

  it("la severidad de una región sin clasificar depende de cuánto del lienzo ocupa", () => {
    const { design, page, report } = setup(() => {});
    const sev = (w: number, h: number) => attachVisual(report, raw([region("r1", 1000, 100, w, h)]), { design, page }).findings[0]!.severity;
    expect(sev(300, 200)).toBe("high"); // 4.5 %
    expect(sev(100, 60)).toBe("medium"); // 0.45 %
    expect(sev(20, 20)).toBe("low");
  });

  it("si se mueve un bloque, las regiones de sus hijos quedan explicadas por el hallazgo del bloque", () => {
    const { design, page, report } = setup((p) => shift(p, byName(p, "article.card", 0).id, 0, 20));
    const f = report.findings.find((x) => x.rule === "spacing")!;
    const title = byText(page, "Piezas hechas a mano").box; // un hijo, en su posición nueva
    const old = designSnapshot().elements.find((e) => e.id === "tarjeta-1-titulo")!.box;
    const r = attachVisual(report, raw([region("r1", old.x, old.y, title.width, title.height + 20)]), { design, page });
    expect(r.visual!.regions[0]).toMatchObject({ classified: true, findingIds: [f.id] });
  });

  it("una región que cubre la posición vieja y la nueva de un elemento movido también se explica", () => {
    const { design, page, report } = setup((p) => shift(p, byText(p, "Casa Nube").id, 6, 0));
    const f = report.findings.find((x) => x.rule === "position")!;
    const d = f.design!.box;
    const r = attachVisual(report, raw([region("r1", d.x, d.y, d.width + 6, d.height)]), { design, page });
    expect(r.visual!.regions[0]!.findingIds).toEqual([f.id]);
  });

  it("un hallazgo que solo afecta a su elemento no explica diferencias en otros elementos de dentro de la caja", () => {
    const { design, page, report } = setup((p) => (byName(p, "article.card", 0).style.radius = 8));
    const radius = report.findings.find((x) => x.rule === "radius")!;
    const c = designSnapshot().elements.find((e) => e.id === "tarjeta-1")!.box;
    const r = attachVisual(report, raw([region("r1", c.x + 120, c.y + 70, 120, 40)]), { design, page }); // centro de la tarjeta
    expect(r.visual!.regions[0]!.findingIds).not.toContain(radius.id);
    expect(r.visual!.regions[0]!.classified).toBe(false);
  });

  it("un cambio de radio explica regiones en las esquinas, no en el interior", () => {
    const { design, page, report } = setup((p) => (byName(p, "article.card", 0).style.radius = 8));
    const radius = report.findings.find((x) => x.rule === "radius")!;
    const c = designSnapshot().elements.find((e) => e.id === "tarjeta-1")!.box;
    const corner = attachVisual(report, raw([region("r1", c.x, c.y, 12, 12)]), { design, page });
    expect(corner.visual!.regions[0]!.findingIds).toEqual([radius.id]);
  });

  it("un cambio de fondo explica una región que cubre la caja, no un detalle pequeño dentro", () => {
    const { design, page, report } = setup((p) => (byName(p, "a.btn.btn-primary").style.background = "#0e1116"));
    const f = report.findings.find((x) => x.rule === "color-background")!;
    const b = f.page!.box;
    const whole = attachVisual(report, raw([region("r1", b.x, b.y, b.width, b.height)]), { design, page });
    expect(whole.visual!.regions[0]!.findingIds).toEqual([f.id]);
    const detail = attachVisual(report, raw([region("r1", b.x + 70, b.y + 20, 20, 10)]), { design, page });
    expect(detail.visual!.regions[0]!.classified).toBe(false);
  });

  it("la regla se puede apagar", () => {
    const { design, page, report } = setup(() => {});
    const r = attachVisual(report, raw([region("r1", 1000, 100, 300, 200)]), { design, page, config: { disabledRules: ["visual-unclassified"] } });
    expect(r.findings).toEqual([]);
    expect(r.visual!.regions[0]!.classified).toBe(false);
  });

  it("el resultado sigue siendo un reporte válido", () => {
    const { design, page, report } = setup(() => {});
    const r = attachVisual(report, raw([region("r1", 1000, 100, 300, 200)]), { design, page });
    expect(ReportSchema.safeParse(JSON.parse(JSON.stringify(r))).success).toBe(true);
  });
});
