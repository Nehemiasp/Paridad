import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Report } from "@paridad/core";
import { BUILTIN_MUTATIONS } from "./builtin.ts";
import { caseMarkdown, cardHtml, editsAsDiff, indexMarkdown, readDesignPng, saveCase, storyRegion, topFindings, type SavedCase } from "./casebook.ts";
import { runMutation, type MutationRun } from "./run.ts";

let browser: Browser;
let run: MutationRun;
const mutation = BUILTIN_MUTATIONS.find((m) => m.id === "padding-tarjetas-20")!;

beforeAll(async () => {
  browser = await chromium.launch();
  run = await runMutation(mutation, browser);
});
afterAll(async () => {
  await browser.close();
});

const canvas = { width: 1440, height: 927 };
const withFindings = (boxes: { x: number; y: number; width: number; height: number }[]): Report =>
  ({ findings: boxes.map((b, i) => ({ id: `f${i}`, severity: "low", page: { elementId: "p", box: b } })), visual: undefined }) as unknown as Report;

describe("storyRegion: dónde está la historia", () => {
  it("rodea los hallazgos con margen y respeta un tamaño mínimo para dar contexto", () => {
    const r = storyRegion(withFindings([{ x: 600, y: 400, width: 100, height: 50 }]), canvas, { pad: 20 });
    expect(r.width).toBeGreaterThanOrEqual(480);
    expect(r.height).toBeGreaterThanOrEqual(180);
    expect(r.height).toBeLessThan(260); // lo justo para dar contexto, sin colar partes ajenas de la página
    expect(r.x).toBeLessThanOrEqual(600);
    expect(r.x + r.width).toBeGreaterThanOrEqual(700);
    expect(r.y + r.height).toBeGreaterThanOrEqual(450);
  });
  it("nunca se sale de la página", () => {
    const r = storyRegion(withFindings([{ x: 0, y: 0, width: 20, height: 20 }]), canvas);
    expect([r.x, r.y]).toEqual([0, 0]);
    const bottom = storyRegion(withFindings([{ x: 1400, y: 900, width: 40, height: 27 }]), canvas);
    expect(bottom.x + bottom.width).toBeLessThanOrEqual(1440);
    expect(bottom.y + bottom.height).toBeLessThanOrEqual(927);
  });
  it("si abarcaría casi toda la página, muestra la página entera; sin hallazgos ni píxeles, también", () => {
    expect(storyRegion(withFindings([{ x: 0, y: 0, width: 1440, height: 800 }]), canvas)).toEqual({ x: 0, y: 0, width: 1440, height: 927 });
    expect(storyRegion(withFindings([]), canvas)).toEqual({ x: 0, y: 0, width: 1440, height: 927 });
  });
  it("sin hallazgos usa las diferencias de píxeles", () => {
    const r = { findings: [], visual: { regions: [{ box: { x: 1000, y: 150, width: 200, height: 100 } }] } } as unknown as Report;
    const region = storyRegion(r, canvas);
    expect(region.x).toBeLessThanOrEqual(1000);
    expect(region.x + region.width).toBeGreaterThanOrEqual(1200);
  });
});

describe("textos del caso", () => {
  it("el diff muestra qué se cambió; el control no cambia nada", () => {
    const diff = editsAsDiff(mutation);
    expect(diff).toContain("# styles.css");
    expect(diff).toContain("-   padding: 16px;");
    expect(diff).toContain("+   padding: 20px;");
    expect(editsAsDiff(BUILTIN_MUTATIONS.find((m) => m.id === "ruido-comentario-y-espacios")!)).toContain("# styles.css");
    expect(editsAsDiff({ ...mutation, edits: [] })).toContain("sin cambios");
  });
  it("los hallazgos que se muestran son los más graves primero", () => {
    const top = topFindings(run.report, 3);
    expect(top).toHaveLength(3);
    expect(top[0]!.severity).toBe("medium");
  });
  it("caso.md trae la imagen, la causa y la evidencia; en un caso que falla explica dónde falló", () => {
    const md = caseMarkdown({ mutation, result: run.result, run, designPng: readDesignPng() });
    expect(md).toContain("![Historia del caso](historia.jpg)");
    expect(md).toContain("```diff");
    expect(md).toContain("Padding izquierdo: diseño 16 px · código 20 px");
    expect(md).toContain("✅ acertó");
    expect(md).not.toContain("Dónde falló");
    const failing = { ...run.result, passed: false, expectations: [{ expectation: { rule: "position" as const, designId: "x" }, detected: false, severityOk: undefined, matchedFindingIds: [], foundSeverities: [] }], findings: [{ id: "i", rule: "radius", severity: "low" as const, title: "Radio raro", class: "falso-positivo" as const }] };
    const bad = caseMarkdown({ mutation, result: failing, run, designPng: readDesignPng() });
    expect(bad).toContain("❌ no acertó del todo");
    expect(bad).toContain("Dónde falló Paridad");
    expect(bad).toContain("Falso positivo [low] radius: Radio raro");
  });
  it("el HTML escapa lo que viene de la página y usa las fuentes de la marca", () => {
    const evil = { ...run, report: { ...run.report, findings: [{ ...run.report.findings[0]!, title: "<script>alert(1)</script> & «x»" }] } };
    const html = cardHtml({ mutation, result: run.result, run: evil, designPng: readDesignPng() });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp;");
    expect(html).toContain("bricolage-grotesque-latin-800-normal.woff2");
  });
  it("el índice agrupa por tipo, marca lo que acertó y lo que no, y avisa que no todo está en el repositorio", () => {
    const cases: SavedCase[] = [
      { id: "a", dir: "/o/a", passed: true, title: "Caso A", errorType: "padding", score: 90 },
      { id: "b", dir: "/o/b", passed: false, title: "Caso B", errorType: "texto-copia", score: 70 },
    ];
    const md = indexMarkdown(cases, "/o");
    expect(md).toContain("## padding");
    expect(md).toContain("- ✅ [Caso A](a/caso.md) · puntaje 90");
    expect(md).toContain("- ❌ [Caso B](b/caso.md) · puntaje 70");
    expect(md).toContain("Casos: **2** · acertados: **1** · con fallos: **1**");
    expect(md).toContain("solo se guardan las historias elegidas");
  });
});

describe("saveCase: la tarjeta de verdad", () => {
  it("renderiza un JPEG nítido y completo junto con caso.md, sin dejar archivos temporales", async () => {
    const out = mkdtempSync(join(tmpdir(), "casos-"));
    const saved = await saveCase(browser, out, { mutation, result: run.result, run, designPng: readDesignPng() });
    expect(saved).toMatchObject({ id: "padding-tarjetas-20", passed: true, errorType: "padding" });
    expect(readdirSync(saved.dir).sort()).toEqual(["caso.md", "historia.jpg"]);
    const jpg = readFileSync(join(saved.dir, "historia.jpg"));
    expect([jpg[0], jpg[1], jpg[2]]).toEqual([0xff, 0xd8, 0xff]);
    // Tamaño: 1700 px de ancho × 1.5 de escala; y no es una imagen vacía.
    const sof = jpg.findIndex((b, i) => b === 0xff && (jpg[i + 1] === 0xc0 || jpg[i + 1] === 0xc2));
    const width = jpg.readUInt16BE(sof + 7);
    expect(width).toBeGreaterThanOrEqual(2500);
    expect(jpg.length).toBeGreaterThan(60_000);
    expect(existsSync(join(saved.dir, ".tarjeta.html"))).toBe(false);
  });
});
