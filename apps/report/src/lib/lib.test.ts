import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compare, contrastRatio, hexToRgba, type Finding, type HexColor, type Report, type Severity } from "@paridad/core";
import { landing } from "@paridad/fixtures";
import { readFileSync } from "node:fs";
import { assertSnapshot } from "@paridad/core";
import { filterFindings, NO_FILTERS, toggle } from "./filters.ts";
import { safeResolve } from "./files.ts";
import { boxStyle, fileUrl, fmtValue, highlightsFor, stageSize } from "./geometry.ts";
import { SEVERITY_COLORS, SEVERITY_ORDER, SEVERITY_SHAPE, formatDate, sizeLabel } from "./labels.ts";
import { isLocalHost } from "./local.ts";
import { loadReport, parseEntries } from "./load.ts";
import { toMarkdown } from "./markdown.ts";

const load = (p: string) => assertSnapshot(JSON.parse(readFileSync(p, "utf8")));
function sampleReport(): Report {
  const design = load(landing.designSnapshot);
  const page = structuredClone(load(`${landing.dir}/page.snapshot.json`));
  const cards = page.elements.filter((e) => e.name === "article.card").map((e) => e.id);
  for (const e of page.elements) if (e.parentId && cards.includes(e.parentId)) ((e.box.x += 4), (e.box.y += 4));
  const t = page.elements.find((e) => e.text?.normalized === "Casa Nube")!;
  t.text = { content: "Casa | Nube <b>", normalized: "Casa | Nube <b>" }; // un texto con caracteres que rompen Markdown
  return compare(design, page, { now: () => new Date("2026-11-08T12:00:00Z"), paths: { design: { image: "design.png" }, page: { image: "page.png" } } });
}
const report = sampleReport();

describe("colores de la propia app (WCAG AA)", () => {
  const ratio = (a: string, b: string) => contrastRatio(hexToRgba(a as HexColor), hexToRgba(b as HexColor));
  it.each(SEVERITY_ORDER.map((s) => [s]))("la severidad %s: texto sobre su fondo ≥ 4.5:1", (s) => {
    const c = SEVERITY_COLORS[s as Severity];
    expect(ratio(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("los pares de la marca sobre fondo claro", () => {
    expect(ratio("#2b2f36", "#fafaf8")).toBeGreaterThanOrEqual(7); // texto
    expect(ratio("#6a707a", "#fafaf8")).toBeGreaterThanOrEqual(4.5); // apagado
    expect(ratio("#6a707a", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#043565", "#ffffff")).toBeGreaterThanOrEqual(7); // azul sobre blanco
    expect(ratio("#ffffff", "#043565")).toBeGreaterThanOrEqual(7); // texto blanco sobre azul
    expect(ratio("#6a707a", "#ecedef")).toBeGreaterThanOrEqual(4.2); // apagado sobre «suave» solo en textos grandes/secundarios
  });
  it("cada severidad tiene su propia forma además del color", () => {
    expect(new Set(Object.values(SEVERITY_SHAPE)).size).toBe(4);
  });
});

describe("safeResolve: la única puerta del servidor al disco", () => {
  const dir = mkdtempSync(join(tmpdir(), "rep-"));
  mkdirSync(join(dir, "design"));
  it("sirve imágenes dentro de la carpeta, también en subcarpetas", () => {
    expect(safeResolve(dir, ["heatmap.png"])?.contentType).toBe("image/png");
    expect(safeResolve(dir, ["design", "design.png"])?.path).toBe(join(dir, "design", "design.png"));
    expect(safeResolve(dir, ["a.JPG"])?.contentType).toBe("image/jpeg");
  });
  it("rechaza todo lo que no es una imagen (el JSON del reporte, scripts…)", () => {
    for (const f of ["report.json", "snapshot.json", "x.html", "x.js", "x", ".env"]) expect(safeResolve(dir, [f]), f).toBeUndefined();
  });
  it("rechaza salirse de la carpeta de cualquier forma", () => {
    for (const segs of [["..", "x.png"], ["design", "..", "..", "x.png"], ["%2e%2e", "x.png"], ["..%2fx.png"], ["/etc/passwd.png"], ["a/../../b.png"], ["a\\..\\b.png"], ["x.png\0"], ["%00.png"], [""], ["."]]) {
      expect(safeResolve(dir, segs), JSON.stringify(segs)).toBeUndefined();
    }
  });
  it("una codificación inválida se rechaza sin lanzar", () => {
    expect(safeResolve(dir, ["%E0%A4%A.png"])).toBeUndefined();
  });
});

describe("carga de reportes", () => {
  it("PARIDAD_REPORTS: lista de carpetas con etiqueta opcional; lo inválido se ignora", () => {
    const e = parseEntries(JSON.stringify([{ dir: "/tmp/a", label: "Móvil" }, { dir: "/tmp/b" }, { sin: "dir" }, 5]));
    expect(e.map((x) => [x.id, x.label, x.dir])).toEqual([["0", "Móvil", "/tmp/a"], ["1", "", "/tmp/b"]]);
    expect(parseEntries(undefined)).toEqual([]);
    expect(parseEntries("no es json")).toEqual([]);
    expect(parseEntries('{"dir":"x"}')).toEqual([]);
  });
  it("un reporte válido se carga y la etiqueta sale del ancho", () => {
    const dir = mkdtempSync(join(tmpdir(), "rep-"));
    writeFileSync(join(dir, "report.json"), JSON.stringify(report));
    const l = loadReport({ id: "0", label: "", dir });
    expect(l.error).toBeUndefined();
    expect(l.entry.label).toBe("Escritorio 1440 px");
    expect(l.report?.score.value).toBe(report.score.value);
  });
  it("falta el archivo, JSON roto o formato ajeno: error claro en español, sin lanzar", () => {
    const dir = mkdtempSync(join(tmpdir(), "rep-"));
    expect(loadReport({ id: "0", label: "", dir }).error).toContain("No hay report.json");
    writeFileSync(join(dir, "report.json"), "{ roto");
    expect(loadReport({ id: "0", label: "", dir }).error).toContain("no es un JSON válido");
    writeFileSync(join(dir, "report.json"), JSON.stringify({ hola: 1 }));
    expect(loadReport({ id: "0", label: "", dir }).error).toContain("no tiene el formato de un reporte de Paridad");
  });
});

describe("filtros", () => {
  const f = report.findings;
  it("sin filtros se ve todo (menos el posible ruido)", () => {
    expect(filterFindings(f, NO_FILTERS)).toHaveLength(f.length);
    expect(filterFindings(f, NO_FILTERS, new Set([f[0]!.id]))).toHaveLength(f.length - 1);
    expect(filterFindings(f, { ...NO_FILTERS, showDiscarded: true }, new Set([f[0]!.id]))).toHaveLength(f.length);
  });
  it("por severidad y por tipo, combinados", () => {
    const low = filterFindings(f, { ...NO_FILTERS, severities: new Set<Severity>(["low"]) });
    expect(low.length).toBeGreaterThan(0);
    expect(low.every((x) => x.severity === "low")).toBe(true);
    const pos = filterFindings(f, { ...NO_FILTERS, categories: new Set(["posición" as const]) });
    expect(pos.every((x) => x.category === "posición")).toBe(true);
    expect(filterFindings(f, { severities: new Set<Severity>(["critical"]), categories: new Set(["posición" as const]), showDiscarded: false })).toEqual([]);
  });
  it("toggle agrega y quita sin mutar", () => {
    const a = new Set(["x"]);
    expect([...toggle(a, "y")].sort()).toEqual(["x", "y"]);
    expect([...toggle(a, "x")]).toEqual([]);
    expect([...a]).toEqual(["x"]);
  });
});

describe("geometría del visor", () => {
  it("el escenario mide el lienzo más grande, y las cajas se expresan en porcentajes", () => {
    const stage = stageSize({ ...report, page: { ...report.page, canvas: { ...report.page.canvas, height: 2000 } } });
    expect(stage).toEqual({ width: 1440, height: 2000 });
    expect(boxStyle({ x: 144, y: 200, width: 720, height: 100 }, stage)).toEqual({ left: "10%", top: "10%", width: "50%", height: "5%" });
  });
  it("resalta las cajas de diseño, de código y de región de los hallazgos", () => {
    const f: Finding[] = [report.findings[0]!, { ...report.findings[0]!, id: "v", rule: "visual-unclassified", category: "visual", design: undefined, page: undefined, region: { id: "r1", box: { x: 1, y: 2, width: 3, height: 4 } } } as Finding];
    const h = highlightsFor(f);
    expect(h[0]!.design ?? h[0]!.page).toBeDefined();
    expect(h[1]!.region).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(highlightsFor([{ ...report.findings[0]!, design: undefined, page: undefined } as Finding])).toEqual([]);
  });
  it("las URL de archivos codifican cada tramo y los valores se muestran legibles", () => {
    expect(fileUrl("0", "design/mi diseño.png")).toBe("/files/0/design/mi%20dise%C3%B1o.png");
    // Un reporte hecho en Windows trae «\\» en las rutas: se sirve igual.
    expect(fileUrl("c:20260101-a", "design\\design.png")).toBe("/files/c%3A20260101-a/design/design.png");
    expect(fmtValue({ x: 16, y: 16 })).toBe("x: 16, y: 16");
    expect(fmtValue(null)).toBe("—");
    expect(fmtValue([1, 2])).toBe("1, 2");
  });
});

describe("etiquetas", () => {
  it("tamaños y fechas en español", () => {
    expect(sizeLabel(1440)).toBe("Escritorio 1440 px");
    expect(sizeLabel(820)).toBe("Tableta 820 px");
    expect(sizeLabel(390)).toBe("Móvil 390 px");
    expect(formatDate("2026-11-08T12:00:00Z")).toBe("8 de noviembre de 2026, 12:00 UTC");
    expect(formatDate("no-fecha")).toBe("no-fecha");
  });
});

describe("toMarkdown (para pegar en un issue de GitHub)", () => {
  const md = toMarkdown(report, { label: "Escritorio 1440 px" });
  it("trae título, puntaje, tabla de contexto y los hallazgos como lista de tareas por severidad", () => {
    expect(md).toContain("## Paridad entre diseño y código · Escritorio 1440 px");
    expect(md).toContain(`**Puntaje de paridad: ${report.score.value} / 100**`);
    expect(md).toContain("| Lienzo | 1440 × 927 px (escala 1) |");
    expect(md).toMatch(/### Baja \(\d+\)/);
    expect(md).toMatch(/- \[ \] \*\*[^\n]*Padding izquierdo: diseño 16 px/);
    expect(md).toContain("diseño `x: 16, y: 16` · código `x: 20, y: 20`");
    expect(md.endsWith("\n")).toBe(true);
  });
  it("escapa lo que rompería Markdown o inyectaría HTML (los textos de la página pueden traer cualquier cosa)", () => {
    expect(md).not.toContain("<b>");
    expect(md).toContain("&lt;b&gt;");
    expect(md).toContain("Casa \\| Nube");
  });
  it("respeta los hallazgos que se le pasan (los filtrados en pantalla)", () => {
    const only = toMarkdown(report, { findings: report.findings.filter((f) => f.severity === "low").slice(0, 1) });
    expect((only.match(/- \[ \]/g) ?? []).length).toBe(1);
    expect(only).not.toContain("### Alta");
  });
  it("sin hallazgos dice que no hay diferencias", () => {
    expect(toMarkdown({ ...report, findings: [] }, { findings: [] })).toContain("No se encontraron diferencias");
  });
  it("incluye el resumen de la IA marcando si es simulado", () => {
    const withAi: Report = { ...report, ai: { model: "m", mode: "simulado", groups: [{ id: "g1", title: "Padding", explanation: "Hay 20 px.", findingIds: ["a", "b"], cssFix: "padding: 16px;" }], discarded: [], rejected: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, costUsd: 0, cacheHit: false, imagesSent: 0, warnings: [] } };
    const text = toMarkdown(withAi);
    expect(text).toContain("### Resumen agrupado");
    expect(text).toContain("**simulado**");
    expect(text).toContain("padding: 16px;");
  });
});

describe("isLocalHost (guarda del PDF)", () => {
  it("solo acepta esta misma máquina", () => {
    for (const h of ["localhost", "LOCALHOST", "127.0.0.1", "[::1]"]) expect(isLocalHost(h), h).toBe(true);
    for (const h of ["evil.example.com", "localhost.evil.com", "127.0.0.1.nip.io", "10.0.0.5", "0.0.0.0", ""]) expect(isLocalHost(h), h).toBe(false);
  });
});
