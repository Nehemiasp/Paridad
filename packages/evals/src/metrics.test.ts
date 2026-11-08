import { describe, expect, it } from "vitest";
import type { Finding, Report, Snapshot } from "@paridad/core";
import { checkGoals, computeMetrics, evaluateMutation, matches, type MutationResult } from "./metrics.ts";
import { MutationSchema } from "./mutation.ts";
import { formatFailures, formatRegressions, formatTable } from "./format.ts";

const finding = (rule: Finding["rule"], severity: Finding["severity"], designId?: string): Finding => ({
  id: `${rule}:${designId ?? "-"}`,
  rule,
  category: "posición",
  severity,
  title: `${rule} ${designId ?? ""}`,
  ...(designId ? { design: { elementId: designId, box: { x: 0, y: 0, width: 1, height: 1 } } } : {}),
  evidence: { property: "x", expected: 0, actual: 1 },
});
const report = (findings: Finding[]): Report => ({ findings, score: { value: 90 }, matching: { pairs: 10, missing: 0, extra: 0 } }) as unknown as Report;
const page = { elements: [] } as unknown as Snapshot;
const mut = (over: object) =>
  MutationSchema.parse({ id: "m-uno", description: "Mutación de prueba para métricas.", errorType: "padding", edits: [], expected: [], ...over });

describe("matches", () => {
  const f = finding("position", "low", "tarjeta-1-titulo");
  it("por regla, por id y por patrón", () => {
    expect(matches(f, { rule: "position" }, page)).toBe(true);
    expect(matches(f, { rule: "size" }, page)).toBe(false);
    expect(matches(f, { rule: "position", designId: "tarjeta-1-titulo" }, page)).toBe(true);
    expect(matches(f, { rule: "position", designId: "otro" }, page)).toBe(false);
    expect(matches(f, { rule: "position", designIdPattern: "^tarjeta-\\d-titulo$" }, page)).toBe(true);
    expect(matches(finding("extra", "high"), { rule: "extra", designIdPattern: "^x$" }, page)).toBe(false); // sin id de diseño no cumple un patrón
  });
});

describe("evaluateMutation", () => {
  const m = mut({
    expected: [{ rule: "position", designId: "a", severity: "low" }, { rule: "size", designId: "b", severity: ["medium", "high"] }],
    acceptable: [{ rule: "page-height" }],
  });

  it("todo detectado, severidad correcta y sin falsos positivos: pasa", () => {
    const r = evaluateMutation(m, report([finding("position", "low", "a"), finding("size", "high", "b"), finding("page-height", "low")]), page, 10);
    expect(r.passed).toBe(true);
    expect(r.findings.map((x) => x.class)).toEqual(["acierto", "acierto", "aceptable"]);
  });
  it("no detectar algo es fallo; detectarlo con otra severidad también", () => {
    const missing = evaluateMutation(m, report([finding("position", "low", "a")]), page, 10);
    expect(missing.passed).toBe(false);
    expect(missing.expectations[1]).toMatchObject({ detected: false, severityOk: undefined });
    const wrong = evaluateMutation(m, report([finding("position", "high", "a"), finding("size", "high", "b")]), page, 10);
    expect(wrong.passed).toBe(false);
    expect(wrong.expectations[0]).toMatchObject({ detected: true, severityOk: false, foundSeverities: ["high"] });
  });
  it("un hallazgo que no es esperado ni aceptable es falso positivo y hace fallar el caso", () => {
    const r = evaluateMutation(m, report([finding("position", "low", "a"), finding("size", "high", "b"), finding("radius", "low", "z")]), page, 10);
    expect(r.passed).toBe(false);
    expect(r.findings[2]!.class).toBe("falso-positivo");
  });
  it("los elementos señalados se cuentan una vez", () => {
    const r = evaluateMutation(mut({}), report([finding("position", "low", "a"), finding("size", "low", "a"), finding("size", "low", "b")]), page, 10);
    expect(r.flaggedElements).toBe(2);
    expect(r.comparedElements).toBe(10);
  });
});

describe("computeMetrics y metas", () => {
  const result = (over: Partial<MutationResult>): MutationResult => ({ id: "x", errorType: "padding", description: "d", hard: false, passed: true, expectations: [], findings: [], flaggedElements: 0, comparedElements: 20, score: 100, visualRegions: 0, unclassifiedRegions: 0, ...over });
  const exp = (detected: boolean, severityOk?: boolean) => ({ expectation: { rule: "position" as const }, detected, severityOk, matchedFindingIds: [], foundSeverities: [] });
  const fnd = (cls: "acierto" | "aceptable" | "falso-positivo") => ({ id: "f", rule: "position", severity: "low" as const, title: "t", class: cls });

  it("detección, precisión y severidad por tipo; los aceptables no cuentan", () => {
    const m = computeMetrics([
      result({ id: "a", errorType: "padding", expectations: [exp(true, true), exp(true, false), exp(false)], findings: [fnd("acierto"), fnd("acierto"), fnd("aceptable"), fnd("falso-positivo")] }),
      result({ id: "b", errorType: "gap", expectations: [exp(true, true)], findings: [fnd("acierto")] }),
    ]);
    const padding = m.byType.find((t) => t.errorType === "padding")!;
    expect(padding).toMatchObject({ expectations: 3, detected: 2, hits: 2, falsePositives: 1, severityChecked: 2, severityOk: 1 });
    expect(padding.detection).toBeCloseTo(2 / 3);
    expect(padding.precision).toBeCloseTo(2 / 3);
    expect(padding.severityAccuracy).toBe(0.5);
    expect(m.overall).toMatchObject({ expectations: 4, detected: 3, hits: 3, falsePositives: 1 });
  });
  it("el control y el ruido salen aparte: tasa de elementos señalados y regiones sin explicar", () => {
    const m = computeMetrics([
      result({ id: "control", errorType: "ruido", comparedElements: 20 }),
      result({ id: "r1", errorType: "ruido", comparedElements: 20, flaggedElements: 2, findings: [fnd("falso-positivo")], unclassifiedRegions: 1 }),
      result({ id: "m", errorType: "padding", expectations: [exp(true)] }),
    ]);
    expect(m.byType.map((t) => t.errorType)).toEqual(["padding"]);
    expect(m.control).toMatchObject({ runs: 2, findings: 1, flaggedElements: 2, comparedElements: 40, falsePositiveRate: 0.05, unclassifiedRegions: 1 });
  });
  it("las metas fallan si la detección o los falsos positivos no alcanzan", () => {
    const base = computeMetrics([result({ id: "control", errorType: "ruido" }), result({ expectations: [exp(true), exp(true), exp(true), exp(true), exp(true), exp(true), exp(true), exp(true), exp(true), exp(false)] })]);
    expect(checkGoals(base).ok).toBe(true); // 90 % justo
    const low = computeMetrics([result({ id: "control", errorType: "ruido" }), result({ expectations: [exp(true), exp(false)] })]);
    expect(checkGoals(low).failures[0]).toContain("Detección 50 %");
    const noisy = computeMetrics([result({ id: "control", errorType: "ruido", flaggedElements: 5, comparedElements: 20 }), result({ expectations: [exp(true)] })]);
    expect(checkGoals(noisy).failures[0]).toContain("Falsos positivos en control 25 %");
  });
});

describe("formato", () => {
  const m = computeMetrics([]);
  it("la tabla incluye la fila TODOS y el bloque de control", () => {
    const t = formatTable(m);
    expect(t).toContain("Tipo de error");
    expect(t).toContain("TODOS");
    expect(t).toContain("Página de control");
  });
  it("con una corrida anterior muestra la flecha de cambio", () => {
    const now = { ...m, overall: { ...m.overall, detection: 0.9 }, byType: [] };
    const before = { ...m, overall: { ...m.overall, detection: 0.8 }, byType: [] };
    expect(formatTable(now, before)).toContain("▲10");
    expect(formatTable(before, now)).toContain("▼10");
  });
  it("los fallos se explican: qué se esperaba y qué pasó", () => {
    const r: MutationResult = { id: "caso", errorType: "padding", description: "descripción larga del caso", hard: true, passed: false, expectations: [{ expectation: { rule: "position", designId: "a", severity: "low" }, detected: false, severityOk: undefined, matchedFindingIds: [], foundSeverities: [] }], findings: [{ id: "f", rule: "radius", severity: "medium", title: "Radio raro", class: "falso-positivo" }], flaggedElements: 1, comparedElements: 5, score: 80, visualRegions: 0, unclassifiedRegions: 0 };
    const text = formatFailures([r]);
    expect(text).toContain("[caso difícil]");
    expect(text).toContain("No se detectó: «position» sobre a con severidad low");
    expect(text).toContain("Falso positivo [medium] radius: Radio raro");
    expect(formatFailures([{ ...r, passed: true }])).toContain("Todos los casos pasan");
  });
  it("detecta los casos que empeoraron o mejoraron", () => {
    const ok = { id: "a", passed: true } as MutationResult;
    const bad = { id: "a", passed: false } as MutationResult;
    expect(formatRegressions([bad], [ok])).toContain("Empeoraron: a");
    expect(formatRegressions([ok], [bad])).toContain("Mejoraron: a");
    expect(formatRegressions([ok, { id: "n", passed: true } as MutationResult], [ok])).toContain("Casos nuevos: 1");
    expect(formatRegressions([ok], [ok])).toContain("Sin cambios");
  });
});
