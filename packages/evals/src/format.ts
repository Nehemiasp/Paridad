import type { AiDecision, AiEvalResult } from "./ai-eval.ts";
import type { Metrics, MutationResult, TypeMetrics } from "./metrics.ts";
import { pct, type Goals } from "./metrics.ts";

export interface EvalRun {
  schemaVersion: 1;
  createdAt: string;
  goals: Goals;
  metrics: Metrics;
  results: MutationResult[];
  /** Mutaciones propuestas que no pasaron la validación (no se corrieron). */
  rejected: { source: string; reason: string }[];
  /** Presente si la corrida incluyó la comparación con IA. */
  ai?: { mode: AiEvalResult["mode"]; model: string; metrics: Metrics; totals: AiEvalResult["totals"]; decision: AiDecision };
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const padL = (s: string, n: number): string => (s.length >= n ? s : " ".repeat(n - s.length) + s);

/** Flecha de cambio respecto a la corrida anterior, en puntos porcentuales. */
function delta(now: number | null, before: number | null | undefined): string {
  if (now === null || before === null || before === undefined) return "";
  const d = Math.round((now - before) * 1000) / 10;
  return d === 0 ? "  =" : d > 0 ? ` ▲${d}` : ` ▼${Math.abs(d)}`;
}

/** Tabla de métricas por tipo de error, con la comparación contra la corrida anterior si la hay. */
export function formatTable(metrics: Metrics, previous?: Metrics): string {
  const prev = new Map(previous?.byType.map((t) => [t.errorType, t]));
  const rows: [string, TypeMetrics, TypeMetrics | undefined][] = [...metrics.byType.map((t): [string, TypeMetrics, TypeMetrics | undefined] => [t.errorType, t, prev.get(t.errorType)]), ["TODOS", metrics.overall, previous?.overall]];
  const w = Math.max(14, ...rows.map(([n]) => n.length));
  const head = `${pad("Tipo de error", w)}  ${padL("Casos", 5)}  ${padL("Detección", 14)}  ${padL("Precisión", 14)}  ${padL("Severidad", 14)}`;
  const line = "─".repeat(head.length);
  const cell = (v: number | null, before: number | null | undefined, n: string) => padL(`${pct(v)}${delta(v, before)}`, 14) + (n ? "" : "");
  const body = rows.map(([name, m, p], i) => {
    const sep = i === rows.length - 1 ? `${line}\n` : "";
    return `${sep}${pad(name, w)}  ${padL(String(m.mutations), 5)}  ${cell(m.detection, p?.detection, "")}  ${cell(m.precision, p?.precision, "")}  ${cell(m.severityAccuracy, p?.severityAccuracy, "")}`;
  });
  const c = metrics.control;
  const cp = previous?.control;
  const control = [
    "",
    `Página de control (${c.runs} corridas: la página intacta y cambios que no deben reportarse)`,
    `  Hallazgos: ${c.findings} · elementos señalados: ${c.flaggedElements} de ${c.comparedElements} · falsos positivos: ${pct(c.falsePositiveRate)}${delta(c.falsePositiveRate, cp?.falsePositiveRate)}`,
    `  Regiones de píxeles que ninguna regla explica: ${c.unclassifiedRegions}`,
  ];
  return [head, line, ...body, ...control].join("\n") + "\n";
}

/** Los casos que fallan, cada uno explicado: qué se esperaba, qué pasó y por qué importa. */
export function formatFailures(results: MutationResult[]): string {
  const failing = results.filter((r) => !r.passed);
  if (failing.length === 0) return "Todos los casos pasan.\n";
  const out: string[] = [`Casos que fallan (${failing.length}):`];
  for (const r of failing) {
    out.push("", `✗ ${r.id}${r.hard ? "  [caso difícil]" : ""}  (${r.errorType})`, `  ${r.description}`);
    for (const x of r.expectations) {
      const target = x.expectation.designId ?? x.expectation.designIdPattern ?? x.expectation.pageText ?? "cualquier elemento";
      const sev = x.expectation.severity ? ` con severidad ${[x.expectation.severity].flat().join(" o ")}` : "";
      if (!x.detected) out.push(`  · No se detectó: «${x.expectation.rule}» sobre ${target}${sev}.`);
      else if (x.severityOk === false) out.push(`  · Se detectó «${x.expectation.rule}» sobre ${target}, pero con severidad ${[...new Set(x.foundSeverities)].join("/")} y se esperaba ${[x.expectation.severity].flat().join(" o ")}.`);
    }
    for (const f of r.findings.filter((x) => x.class === "falso-positivo")) out.push(`  · Falso positivo [${f.severity}] ${f.rule}: ${f.title}`);
  }
  return out.join("\n") + "\n";
}

/** Casos que cambiaron de estado respecto a la corrida anterior (los que empeoraron son lo que hay que mirar). */
export function formatRegressions(now: MutationResult[], before: MutationResult[]): string {
  const was = new Map(before.map((r) => [r.id, r.passed]));
  const worse = now.filter((r) => !r.passed && was.get(r.id) === true).map((r) => r.id);
  const better = now.filter((r) => r.passed && was.get(r.id) === false).map((r) => r.id);
  const added = now.filter((r) => !was.has(r.id)).map((r) => r.id);
  const lines: string[] = [];
  if (worse.length) lines.push(`Empeoraron: ${worse.join(", ")}`);
  if (better.length) lines.push(`Mejoraron: ${better.join(", ")}`);
  if (added.length) lines.push(`Casos nuevos: ${added.length}`);
  return lines.length ? `Cambios respecto a la corrida anterior:\n${lines.map((l) => `  ${l}`).join("\n")}\n` : "Sin cambios de estado respecto a la corrida anterior.\n";
}
