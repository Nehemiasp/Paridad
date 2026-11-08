import type { Finding, Report, Severity, Snapshot } from "@paridad/core";
import type { Acceptable, Expectation, Mutation } from "./mutation.ts";

export type FindingClass = "acierto" | "aceptable" | "falso-positivo";

export interface ExpectationResult {
  expectation: Expectation;
  detected: boolean;
  /** Si la expectativa pedía severidad: ¿alguno de los hallazgos que la cumplen la tiene? */
  severityOk: boolean | undefined;
  matchedFindingIds: string[];
  /** Severidades con las que se encontró (para explicar los fallos). */
  foundSeverities: Severity[];
}

export interface FindingResult {
  id: string;
  rule: string;
  severity: Severity;
  title: string;
  class: FindingClass;
}

export interface MutationResult {
  id: string;
  errorType: string;
  description: string;
  hard: boolean;
  /** Pasó (todo detectado, sin falsos positivos) y por qué no, si no. */
  passed: boolean;
  expectations: ExpectationResult[];
  findings: FindingResult[];
  /** Elementos distintos con algún hallazgo y elementos comparados (para la tasa de la página de control). */
  flaggedElements: number;
  comparedElements: number;
  score: number;
  visualRegions: number;
  unclassifiedRegions: number;
}

/** ¿Este hallazgo corresponde a esta expectativa (o efecto colateral aceptable)? */
export function matches(f: Finding, e: Acceptable | Expectation, page: Snapshot): boolean {
  if (f.rule !== e.rule) return false;
  const designId = f.design?.elementId;
  if (e.designId !== undefined && designId !== e.designId) return false;
  if (e.designIdPattern !== undefined && !(designId !== undefined && new RegExp(e.designIdPattern).test(designId))) return false;
  if (e.pageText !== undefined) {
    const el = f.page ? page.elements.find((x) => x.id === f.page!.elementId) : undefined;
    if (el?.text?.normalized !== e.pageText) return false;
  }
  return true;
}

const asArray = (s: Severity | Severity[] | undefined): Severity[] | undefined => (s === undefined ? undefined : Array.isArray(s) ? s : [s]);

/** Evalúa el reporte de una mutación contra lo que se esperaba. */
export function evaluateMutation(mutation: Mutation, report: Report, page: Snapshot, comparedElements: number): MutationResult {
  const expectations: ExpectationResult[] = mutation.expected.map((expectation) => {
    const found = report.findings.filter((f) => matches(f, expectation, page));
    const wanted = asArray(expectation.severity);
    return {
      expectation,
      detected: found.length > 0,
      severityOk: wanted === undefined || found.length === 0 ? undefined : found.some((f) => wanted.includes(f.severity)),
      matchedFindingIds: found.map((f) => f.id),
      foundSeverities: found.map((f) => f.severity),
    };
  });

  const findings: FindingResult[] = report.findings.map((f) => {
    const cls: FindingClass = mutation.expected.some((e) => matches(f, e, page)) ? "acierto" : mutation.acceptable.some((a) => matches(f, a, page)) ? "aceptable" : "falso-positivo";
    return { id: f.id, rule: f.rule, severity: f.severity, title: f.title, class: cls };
  });

  const flagged = new Set<string>();
  for (const f of report.findings) {
    if (f.design) flagged.add(`d:${f.design.elementId}`);
    else if (f.page) flagged.add(`p:${f.page.elementId}`);
  }

  const unclassified = report.visual?.regions.filter((r) => !r.classified).length ?? 0;
  return {
    id: mutation.id,
    errorType: mutation.errorType,
    description: mutation.description,
    hard: mutation.hard,
    passed: expectations.every((x) => x.detected && x.severityOk !== false) && !findings.some((f) => f.class === "falso-positivo"),
    expectations,
    findings,
    flaggedElements: flagged.size,
    comparedElements,
    score: report.score.value,
    visualRegions: report.visual?.regions.length ?? 0,
    unclassifiedRegions: unclassified,
  };
}

export interface TypeMetrics {
  errorType: string;
  mutations: number;
  expectations: number;
  detected: number;
  /** Detectados / esperados (null si no había nada que detectar). */
  detection: number | null;
  /** Hallazgos que son aciertos y falsos positivos (los aceptables no cuentan). */
  hits: number;
  falsePositives: number;
  /** Aciertos / (aciertos + falsos positivos). */
  precision: number | null;
  severityChecked: number;
  severityOk: number;
  severityAccuracy: number | null;
}

const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);

function aggregate(errorType: string, results: MutationResult[]): TypeMetrics {
  const exps = results.flatMap((r) => r.expectations);
  const detected = exps.filter((e) => e.detected).length;
  const hits = results.flatMap((r) => r.findings).filter((f) => f.class === "acierto").length;
  const fps = results.flatMap((r) => r.findings).filter((f) => f.class === "falso-positivo").length;
  const checked = exps.filter((e) => e.severityOk !== undefined);
  const ok = checked.filter((e) => e.severityOk).length;
  return {
    errorType,
    mutations: results.length,
    expectations: exps.length,
    detected,
    detection: ratio(detected, exps.length),
    hits,
    falsePositives: fps,
    precision: ratio(hits, hits + fps),
    severityChecked: checked.length,
    severityOk: ok,
    severityAccuracy: ratio(ok, checked.length),
  };
}

export interface ControlMetrics {
  /** Corridas de control: la página intacta y los cambios que no deben reportarse. */
  runs: number;
  findings: number;
  flaggedElements: number;
  comparedElements: number;
  /** Elementos con algún hallazgo / elementos comparados. Meta: ≤ 10 %. */
  falsePositiveRate: number;
  /** Regiones de píxeles distintas que ninguna regla explica, en las corridas de control. */
  unclassifiedRegions: number;
}

export interface Metrics {
  byType: TypeMetrics[];
  overall: TypeMetrics;
  control: ControlMetrics;
}

export const CONTROL_TYPE = "ruido";
export const CONTROL_ID = "control";

/** Métricas por tipo de error, globales y de la página de control. */
export function computeMetrics(results: MutationResult[]): Metrics {
  const control = results.filter((r) => r.errorType === CONTROL_TYPE || r.id === CONTROL_ID);
  const errors = results.filter((r) => !control.includes(r));
  const types = [...new Set(errors.map((r) => r.errorType))].sort();
  const flagged = control.reduce((n, r) => n + r.flaggedElements, 0);
  const compared = control.reduce((n, r) => n + r.comparedElements, 0);
  return {
    byType: types.map((t) => aggregate(t, errors.filter((r) => r.errorType === t))),
    overall: aggregate("todos", errors),
    control: {
      runs: control.length,
      findings: control.reduce((n, r) => n + r.findings.length, 0),
      flaggedElements: flagged,
      comparedElements: compared,
      falsePositiveRate: compared === 0 ? 0 : flagged / compared,
      unclassifiedRegions: control.reduce((n, r) => n + r.unclassifiedRegions, 0),
    },
  };
}

export interface Goals {
  /** Detección mínima global. Meta inicial: 90 %. */
  minDetection: number;
  /** Máximo de falsos positivos en la página de control. Meta inicial: 10 %. */
  maxControlFalsePositive: number;
}
export const DEFAULT_GOALS: Goals = { minDetection: 0.9, maxControlFalsePositive: 0.1 };

export function checkGoals(m: Metrics, goals: Goals = DEFAULT_GOALS): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const det = m.overall.detection ?? 1;
  if (det < goals.minDetection) failures.push(`Detección ${pct(det)} < meta ${pct(goals.minDetection)}`);
  if (m.control.falsePositiveRate > goals.maxControlFalsePositive) failures.push(`Falsos positivos en control ${pct(m.control.falsePositiveRate)} > meta ${pct(goals.maxControlFalsePositive)}`);
  return { ok: failures.length === 0, failures };
}

export const pct = (n: number | null): string => (n === null ? "—" : `${Math.round(n * 1000) / 10} %`);
