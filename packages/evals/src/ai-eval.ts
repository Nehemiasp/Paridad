import { AnswerCache, explainReport, type AiClient } from "@paridad/ai";
import type { Report } from "@paridad/core";
import { computeMetrics, evaluateMutation, pct, type Metrics, type MutationResult } from "./metrics.ts";
import type { Mutation } from "./mutation.ts";
import type { MutationRun } from "./run.ts";

export interface AiEvalOptions {
  client: AiClient;
  mode: "claude" | "simulado";
  model?: string;
  /** Tope de costo de TODA la evaluación en USD; al alcanzarlo, el resto corre sin IA. */
  maxTotalCostUsd?: number;
  cache?: AnswerCache;
}

export interface AiMutationStats {
  id: string;
  findingsBefore: number;
  /** Elementos que lee una persona: grupos + hallazgos sueltos que no se descartaron. */
  itemsAfter: number;
  groups: number;
  /** Descartes de hallazgos que eran falsos positivos o efectos colaterales legítimos (bien hechos). */
  usefulDiscards: number;
  /** Descartes de hallazgos que eran aciertos: la IA habría ocultado un error real (grave). */
  harmfulDiscards: number;
  rejected: number;
  costUsd: number;
  skipped: boolean;
}

export interface AiEvalResult {
  /** Resultados con la IA aplicada (sin los hallazgos que descartó). */
  results: MutationResult[];
  stats: AiMutationStats[];
  metrics: Metrics;
  totals: { findingsBefore: number; itemsAfter: number; usefulDiscards: number; harmfulDiscards: number; rejected: number; groups: number; costUsd: number; skipped: number };
  mode: "claude" | "simulado";
  model: string;
}

/**
 * Corre las métricas de la Fase 5 con la IA aplicada: el reporte sin los hallazgos que la IA descarta como ruido.
 * Que descarte algo es una apuesta: si era un falso positivo, la precisión sube; si era un acierto, se pierde detección.
 * La claridad se mide como cuántos elementos tiene que leer una persona (grupos + hallazgos sueltos) frente a la lista original.
 */
export async function runAiEval(runs: { mutation: Mutation; run: MutationRun }[], options: AiEvalOptions): Promise<AiEvalResult> {
  const model = options.model ?? "claude-haiku-5-5";
  const cap = options.maxTotalCostUsd ?? 0.5;
  let spent = 0;
  const results: MutationResult[] = [];
  const stats: AiMutationStats[] = [];

  for (const { mutation, run } of runs) {
    const { report, page, result: base } = run;
    const classOf = new Map(base.findings.map((f) => [f.id, f.class]));
    const remaining = cap - spent;
    const capReached = remaining <= 0;
    const ai = capReached
      ? undefined
      : await explainReport(report, { client: options.client, model, mode: options.mode, maxCostUsd: remaining, ...(options.cache ? { cache: options.cache } : {}) });

    // «Sin IA por tope»: se alcanzó el tope total, o la estimación previa de esta llamada ya lo superaba.
    const skipped = capReached || (ai?.warnings.some((w) => w.includes("Se omitió la IA")) ?? false);
    const discarded = new Set(ai?.discarded.map((d) => d.findingId) ?? []);
    const grouped = new Set(ai?.groups.flatMap((g) => g.findingIds) ?? []);
    const kept = report.findings.filter((f) => !discarded.has(f.id));
    const filtered: Report = { ...report, findings: kept };
    results.push(evaluateMutation(mutation, filtered, page, base.comparedElements));

    spent += ai?.costUsd ?? 0;
    stats.push({
      id: mutation.id,
      findingsBefore: report.findings.length,
      itemsAfter: kept.filter((f) => !grouped.has(f.id)).length + (ai?.groups.length ?? 0),
      groups: ai?.groups.length ?? 0,
      usefulDiscards: [...discarded].filter((id) => classOf.get(id) !== "acierto").length,
      harmfulDiscards: [...discarded].filter((id) => classOf.get(id) === "acierto").length,
      rejected: ai?.rejected.length ?? 0,
      costUsd: ai?.costUsd ?? 0,
      skipped,
    });
  }

  const sum = (f: (s: AiMutationStats) => number) => stats.reduce((n, s) => n + f(s), 0);
  return {
    results,
    stats,
    metrics: computeMetrics(results),
    totals: { findingsBefore: sum((s) => s.findingsBefore), itemsAfter: sum((s) => s.itemsAfter), usefulDiscards: sum((s) => s.usefulDiscards), harmfulDiscards: sum((s) => s.harmfulDiscards), rejected: sum((s) => s.rejected), groups: sum((s) => s.groups), costUsd: sum((s) => s.costUsd), skipped: stats.filter((s) => s.skipped).length },
    mode: options.mode,
    model,
  };
}

export interface AiDecision {
  /** ¿Conviene encender la IA por defecto? */
  enableByDefault: boolean;
  reasons: string[];
}

/** Mejora mínima de precisión (puntos) o de claridad (fracción menos de elementos) para que la IA «valga la pena». */
export const MIN_PRECISION_GAIN = 0.02;
export const MIN_CLARITY_GAIN = 0.2;
/** Fracción máxima de lo que devuelve el modelo que puede rechazarse por no apoyarse en la evidencia. */
export const MAX_REJECTED_RATE = 0.2;

/**
 * Regla de la especificación: «si la IA no mejora ni la precisión ni la claridad, queda apagada por defecto».
 * Además exige: que haya sido un modelo real (no el simulado), que no pierda detección, que no oculte ningún error real
 * y que no tenga que rechazársele demasiado por inventar.
 */
export function decideAiDefault(without: Metrics, withAi: AiEvalResult): AiDecision {
  const reasons: string[] = [];
  if (withAi.mode !== "claude") return { enableByDefault: false, reasons: ["La evaluación fue con el modelo simulado: solo prueba la tubería y no mide a Claude. Corra `npm run evals -- --ai` con una clave para decidir."] };

  const detLoss = (without.overall.detection ?? 1) - (withAi.metrics.overall.detection ?? 1);
  const precGain = (withAi.metrics.overall.precision ?? 1) - (without.overall.precision ?? 1);
  const clarityGain = withAi.totals.findingsBefore === 0 ? 0 : 1 - withAi.totals.itemsAfter / withAi.totals.findingsBefore;
  const returned = withAi.totals.groups + withAi.totals.usefulDiscards + withAi.totals.harmfulDiscards + withAi.totals.rejected;
  const rejectedRate = returned === 0 ? 0 : withAi.totals.rejected / returned;

  const blockers: string[] = [];
  if (detLoss > 0.0001) blockers.push(`pierde detección (−${pct(detLoss)})`);
  if (withAi.totals.harmfulDiscards > 0) blockers.push(`ocultó ${withAi.totals.harmfulDiscards} errores reales al descartarlos como ruido`);
  if (rejectedRate > MAX_REJECTED_RATE) blockers.push(`se le rechazó ${pct(rejectedRate)} de lo que devolvió por no apoyarse en la evidencia`);
  const improves = precGain >= MIN_PRECISION_GAIN || clarityGain >= MIN_CLARITY_GAIN;

  reasons.push(`Precisión ${pct(without.overall.precision)} → ${pct(withAi.metrics.overall.precision)} (${precGain >= 0 ? "+" : ""}${Math.round(precGain * 1000) / 10} pts; mínimo +${MIN_PRECISION_GAIN * 100}).`);
  reasons.push(`Claridad: ${withAi.totals.findingsBefore} hallazgos → ${withAi.totals.itemsAfter} elementos por leer (${pct(clarityGain)} menos; mínimo ${pct(MIN_CLARITY_GAIN)}).`);
  if (!improves) blockers.push("no mejora la precisión ni la claridad lo suficiente");
  reasons.push(...blockers.map((b) => `✗ ${b}.`));
  return { enableByDefault: blockers.length === 0, reasons };
}

/** Tabla «con IA frente a sin IA». */
export function formatAiComparison(without: Metrics, withAi: AiEvalResult, decision: AiDecision): string {
  const row = (label: string, a: string, b: string) => `${label.padEnd(22)}${a.padStart(14)}${b.padStart(14)}`;
  const t = withAi.totals;
  return [
    `Con IA frente a sin IA (${withAi.mode === "simulado" ? "modelo SIMULADO: no mide a Claude" : withAi.model})`,
    row("", "Sin IA", "Con IA"),
    row("Detección", pct(without.overall.detection), pct(withAi.metrics.overall.detection)),
    row("Precisión", pct(without.overall.precision), pct(withAi.metrics.overall.precision)),
    row("Severidad", pct(without.overall.severityAccuracy), pct(withAi.metrics.overall.severityAccuracy)),
    row("Falsos pos. control", pct(without.control.falsePositiveRate), pct(withAi.metrics.control.falsePositiveRate)),
    row("Elementos por leer", String(t.findingsBefore), String(t.itemsAfter)),
    "",
    `  Grupos: ${t.groups} · descartes útiles: ${t.usefulDiscards} · descartes dañinos: ${t.harmfulDiscards} · rechazados: ${t.rejected} · sin IA por tope de costo: ${t.skipped}`,
    `  Costo: US$ ${t.costUsd.toFixed(4)}`,
    "",
    `Decisión: la IA ${decision.enableByDefault ? "SE ENCIENDE por defecto" : "QUEDA APAGADA por defecto"}.`,
    ...decision.reasons.map((r) => `  ${r}`),
  ].join("\n") + "\n";
}
