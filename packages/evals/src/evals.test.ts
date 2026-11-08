import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILTIN_MUTATIONS } from "./builtin.ts";
import { main } from "./cli.ts";
import { checkGoals, computeMetrics, DEFAULT_GOALS } from "./metrics.ts";
import { loadMutationsFromDir } from "./mutation.ts";
import { CONTROL, runAll, runMutation } from "./run.ts";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

const capture = async (argv: string[]) => {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, (t) => void (stdout += t), (t) => void (stderr += t));
  return { code, stdout, stderr };
};

describe("la página de control", () => {
  it("la página intacta no produce ningún hallazgo y da 100", async () => {
    const { result, report } = await runMutation(CONTROL, browser);
    expect(report.findings).toEqual([]);
    expect(result).toMatchObject({ passed: true, score: 100, unclassifiedRegions: 0, flaggedElements: 0 });
    expect(result.comparedElements).toBeGreaterThan(20);
  });
});

describe("una mutación de punta a punta", () => {
  it("el padding de 16 a 20 px se detecta con la severidad esperada y sin falsos positivos", async () => {
    const m = BUILTIN_MUTATIONS.find((x) => x.id === "padding-tarjetas-20")!;
    const { result, report } = await runMutation(m, browser);
    expect(result.passed).toBe(true);
    const titulo = report.findings.find((f) => f.rule === "position" && f.design?.elementId === "tarjeta-1-titulo")!;
    expect(titulo.title).toContain("Padding izquierdo: diseño 16 px · código 20 px");
    expect(report.visual!.regions.every((r) => r.classified)).toBe(true);
  });

  it("un cambio por debajo de la tolerancia no se reporta aunque cambien píxeles (ruido)", async () => {
    const m = BUILTIN_MUTATIONS.find((x) => x.id === "ruido-padding-tarjetas-16-4")!;
    const { result, report } = await runMutation(m, browser);
    expect(report.findings).toEqual([]);
    expect(result.passed).toBe(true);
    expect(report.visual!.regions.length).toBeGreaterThan(0); // los píxeles sí cambiaron…
    expect(report.visual!.regions.every((r) => r.classified && r.explainedBy !== "regla")).toBe(true); // …y se explica como ruido o desplazamiento, no como un error
  });

  it("una mutación que no aplica a la página falla con un error claro en lugar de pasar en silencio", async () => {
    const rota = { ...BUILTIN_MUTATIONS[0]!, id: "rota", edits: [{ file: "styles.css" as const, find: "no existe", replace: "x" }] };
    await expect(runMutation(rota, browser)).rejects.toThrow(/aparece 0 veces/);
  });
});

describe("metas de las evaluaciones (guarda de regresión)", () => {
  it("las mutaciones incorporadas pasan todas; con las propuestas se cumplen las metas iniciales", async () => {
    const proposed = loadMutationsFromDir(new URL("../mutations", import.meta.url).pathname);
    expect(proposed.rejected).toEqual([]);
    const results = await runAll([...BUILTIN_MUTATIONS, ...proposed.mutations], { browser });

    const builtinIds = new Set(BUILTIN_MUTATIONS.map((m) => m.id));
    const failingBuiltin = results.filter((r) => builtinIds.has(r.id) && !r.passed).map((r) => r.id);
    expect(failingBuiltin, `fallan las incorporadas: ${failingBuiltin.join(", ")}`).toEqual([]);

    const metrics = computeMetrics(results);
    expect(checkGoals(metrics, DEFAULT_GOALS)).toEqual({ ok: true, failures: [] });
    expect(metrics.control.falsePositiveRate).toBe(0);
    expect(metrics.overall.severityAccuracy).toBe(1);
  });
});

describe("npm run evals (CLI)", () => {
  it("--help y argumentos inválidos", async () => {
    expect((await capture(["--help"])).stdout).toContain("Mide si Paridad acierta");
    const bad = await capture(["--min-detection", "2"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("--min-detection debe ser un número entre 0 y 1");
    const unknown = await capture(["--only", "no-existe", "--no-proposed", "--no-save"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("no existe la mutación no-existe");
  });

  it("--validate comprueba las propuestas sin abrir el navegador", async () => {
    const r = await capture(["--validate"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/\d+ propuestas válidas, 0 rechazadas/);
  });

  it("una corrida parcial (--only) imprime la tabla pero no pisa la corrida completa guardada", async () => {
    const out = mkdtempSync(join(tmpdir(), "evals-"));
    const r = await capture(["--only", "radio-tarjetas-8", "--no-proposed", "--out", out]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Tipo de error");
    expect(r.stdout).toContain("Sin corrida anterior");
    expect(existsSync(join(out, "latest.json"))).toBe(false);
  });

  it("--json imprime un resultado válido, con el veredicto de las metas", async () => {
    const r = await capture(["--only", "radio-tarjetas-8", "--no-proposed", "--json"]);
    const data = JSON.parse(r.stdout);
    expect(data.verdict).toEqual({ ok: true, failures: [] });
    expect(data.results.map((x: { id: string }) => x.id)).toEqual(["control", "radio-tarjetas-8"]);
  });

  it("los casos que fallan se guardan solos como tarjetas, y --casos guarda todos con su índice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muts-"));
    const { writeFileSync, readFileSync, existsSync: exists } = await import("node:fs");
    writeFileSync(join(dir, "imposible.json"), JSON.stringify({ id: "imposible", description: "Espera un hallazgo que no puede aparecer.", errorType: "imposible", edits: [], expected: [{ rule: "missing", designId: "logo", severity: "critical" }] }));
    const out = mkdtempSync(join(tmpdir(), "evals-out-"));
    const casos = mkdtempSync(join(tmpdir(), "evals-casos-"));
    const r = await capture(["--only", "imposible,radio-tarjetas-8", "--proposed", dir, "--no-save", "--out", out, "--casos", casos]);
    expect(r.stdout).toContain("Casos que fallaron, guardados como tarjetas");
    expect(exists(join(out, "fallos", "imposible", "historia.jpg"))).toBe(true);
    expect(exists(join(out, "fallos", "radio-tarjetas-8"))).toBe(false); // solo los que fallan
    for (const id of ["imposible", "radio-tarjetas-8"]) expect(exists(join(casos, id, "caso.md")), id).toBe(true);
    expect(exists(join(casos, "control"))).toBe(false); // el control no cuenta una historia
    const index = readFileSync(join(casos, "README.md"), "utf8");
    expect(index).toContain("Casos: **2** · acertados: **1** · con fallos: **1**");
    expect(readFileSync(join(casos, "imposible", "caso.md"), "utf8")).toContain("Dónde falló Paridad");
  });

  it("sale con código 1 si no se cumple la meta de detección", async () => {
    // El control no tiene nada que detectar; con una mutación que falla a propósito la meta se rompe.
    const dir = mkdtempSync(join(tmpdir(), "muts-"));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(dir, "imposible.json"),
      JSON.stringify({ id: "imposible", description: "Espera un hallazgo que no puede aparecer.", errorType: "imposible", edits: [], expected: [{ rule: "missing", designId: "logo", severity: "critical" }] }),
    );
    const r = await capture(["--only", "imposible", "--proposed", dir, "--no-save"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("NO SE CUMPLEN");
    expect(r.stdout).toContain("No se detectó: «missing» sobre logo");
  });
});
