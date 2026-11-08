import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiClient } from "@paridad/ai";
import { createSimulatedClient } from "@paridad/ai";
import { decideAiDefault, formatAiComparison, runAiEval, type AiEvalResult } from "./ai-eval.ts";
import { BUILTIN_MUTATIONS } from "./builtin.ts";
import { main } from "./cli.ts";
import { computeMetrics, type Metrics, type MutationResult } from "./metrics.ts";
import { loadMutationsFromDir } from "./mutation.ts";
import { runAllDetailed } from "./run.ts";

let browser: Browser;
let detailed: Awaited<ReturnType<typeof runAllDetailed>>;
let base: Metrics;

beforeAll(async () => {
  browser = await chromium.launch();
  const proposed = loadMutationsFromDir(new URL("../mutations", import.meta.url).pathname).mutations;
  // El control, un caso limpio con muchos hallazgos relacionados, y uno que tiene un falso positivo real.
  const pick = [BUILTIN_MUTATIONS.find((m) => m.id === "padding-tarjetas-20")!, proposed.find((m) => m.id === "enlace-extra-navegacion")!];
  detailed = await runAllDetailed(pick, { browser });
  base = computeMetrics(detailed.map((d) => d.run.result));
});
afterAll(async () => {
  await browser.close();
});

/** Un «modelo» a la medida de cada prueba: recibe los hallazgos que se le enviaron y decide qué agrupar o descartar. */
function model(decide: (findings: { id: string; regla: string; severidad: string }[]) => { groups?: { ids: string[]; text?: string }[]; discard?: string[] }): AiClient {
  return {
    async complete(req) {
      const first = req.content[0] as { text: string };
      const findings = (JSON.parse(first.text.slice(first.text.indexOf("{"))) as { hallazgos: { id: string; regla: string; severidad: string }[] }).hallazgos;
      const d = decide(findings);
      return {
        model: req.model,
        usage: { inputTokens: 3000, outputTokens: 300, cacheReadTokens: 0 },
        output: {
          groups: (d.groups ?? []).map((g) => ({ title: "Grupo", explanation: g.text ?? "Hallazgos con una causa común.", finding_ids: g.ids, css_fix: "" })),
          discarded: (d.discard ?? []).map((id) => ({ finding_id: id, reason: "Es ruido evidente." })),
        },
      };
    },
  };
}

describe("runAiEval", () => {
  it("un modelo que no hace nada deja las métricas exactamente como estaban", async () => {
    const r = await runAiEval(detailed, { client: model(() => ({})), mode: "claude" });
    expect(r.metrics.overall).toEqual(base.overall);
    expect(r.totals).toMatchObject({ groups: 0, usefulDiscards: 0, harmfulDiscards: 0, rejected: 0 });
    expect(r.totals.itemsAfter).toBe(r.totals.findingsBefore);
  });

  it("agrupar reduce lo que hay que leer sin cambiar detección ni precisión", async () => {
    const r = await runAiEval(detailed, { client: model((fs) => ({ groups: [{ ids: fs.filter((f) => f.regla === "position").map((f) => f.id) }] })), mode: "claude" });
    expect(r.totals.groups).toBe(1);
    expect(r.totals.itemsAfter).toBeLessThan(r.totals.findingsBefore - 5);
    expect(r.metrics.overall.detection).toBe(base.overall.detection);
    expect(r.metrics.overall.precision).toBe(base.overall.precision);
  });

  it("descartar un falso positivo real sube la precisión; es un descarte útil", async () => {
    expect(base.overall.precision).toBeLessThan(1); // enlace-extra-navegacion trae un falso positivo
    const r = await runAiEval(detailed, { client: model((fs) => ({ discard: fs.filter((f) => f.regla === "visual-unclassified").map((f) => f.id) })), mode: "claude" });
    expect(r.totals.usefulDiscards).toBeGreaterThan(0);
    expect(r.totals.harmfulDiscards).toBe(0);
    expect(r.metrics.overall.precision).toBe(1);
    expect(r.metrics.overall.detection).toBe(base.overall.detection);
  });

  it("descartar un hallazgo que era un acierto es un descarte dañino y se pierde detección", async () => {
    const r = await runAiEval(detailed, { client: model((fs) => ({ discard: [fs.find((f) => f.regla === "position")!.id] })), mode: "claude" });
    expect(r.totals.harmfulDiscards).toBe(1);
    expect(r.metrics.overall.detection).toBeLessThan(base.overall.detection!);
  });

  it("lo que la IA inventa se rechaza y se cuenta", async () => {
    const r = await runAiEval(detailed, { client: model(() => ({ groups: [{ ids: ["no-existe:1", "no-existe:2"] }] })), mode: "claude" });
    expect(r.totals.rejected).toBeGreaterThan(0);
    expect(r.totals.groups).toBe(0);
    expect(r.metrics.overall).toEqual(base.overall);
  });

  it("al alcanzar el tope de costo, el resto corre sin IA", async () => {
    const r = await runAiEval(detailed, { client: model(() => ({})), mode: "claude", maxTotalCostUsd: 0.0001 });
    expect(r.totals.skipped).toBeGreaterThan(0);
    expect(r.totals.costUsd).toBeLessThan(0.001);
  });

  it("el costo sale del uso real y el modo simulado cuesta cero", async () => {
    const real = await runAiEval(detailed, { client: model((fs) => ({ groups: [{ ids: fs.slice(0, 2).map((f) => f.id), text: "Hay hallazgos." }] })), mode: "claude" });
    expect(real.totals.costUsd).toBeGreaterThan(0);
    const sim = await runAiEval(detailed, { client: createSimulatedClient(), mode: "simulado" });
    expect(sim.totals.costUsd).toBe(0);
  });
});

describe("decideAiDefault: «si la IA no mejora, queda apagada»", () => {
  const withAi = (over: Partial<AiEvalResult["totals"]> & { precision?: number; detection?: number; mode?: "claude" | "simulado" }): AiEvalResult => {
    const { precision, detection, mode, ...totals } = over;
    const metrics = { ...base, overall: { ...base.overall, precision: precision ?? base.overall.precision, detection: detection ?? base.overall.detection } } as Metrics;
    return { results: [] as MutationResult[], stats: [], metrics, mode: mode ?? "claude", model: "claude-haiku-5-5", totals: { findingsBefore: 100, itemsAfter: 100, usefulDiscards: 0, harmfulDiscards: 0, rejected: 0, groups: 0, costUsd: 0.1, skipped: 0, ...totals } };
  };

  it("sin mejora ni de precisión ni de claridad, queda apagada", () => {
    const d = decideAiDefault(base, withAi({}));
    expect(d.enableByDefault).toBe(false);
    expect(d.reasons.join()).toContain("no mejora la precisión ni la claridad");
  });
  it("se enciende si mejora la claridad sin perder nada ni ocultar errores", () => {
    const d = decideAiDefault(base, withAi({ itemsAfter: 60, groups: 10 }));
    expect(d.enableByDefault).toBe(true);
  });
  it("se enciende si mejora la precisión", () => {
    expect(decideAiDefault(base, withAi({ precision: 1, usefulDiscards: 1 })).enableByDefault).toBe(true);
  });
  it("aunque mejore, se apaga si pierde detección, oculta un error real o se le rechaza demasiado", () => {
    expect(decideAiDefault(base, withAi({ itemsAfter: 50, detection: 0.5 })).reasons.join()).toContain("pierde detección");
    expect(decideAiDefault(base, withAi({ itemsAfter: 50, harmfulDiscards: 1 })).reasons.join()).toContain("ocultó 1 errores reales");
    const rej = decideAiDefault(base, withAi({ itemsAfter: 50, groups: 2, rejected: 5 }));
    expect(rej.enableByDefault).toBe(false);
    expect(rej.reasons.join()).toContain("se le rechazó");
  });
  it("con el modelo simulado nunca decide: no mide a Claude", () => {
    const d = decideAiDefault(base, withAi({ itemsAfter: 10, mode: "simulado" }));
    expect(d.enableByDefault).toBe(false);
    expect(d.reasons[0]).toContain("no mide a Claude");
  });
  it("la tabla compara con y sin IA y dice la decisión", () => {
    const r = withAi({ itemsAfter: 60 });
    const text = formatAiComparison(base, r, decideAiDefault(base, r));
    expect(text).toContain("Sin IA");
    expect(text).toContain("Elementos por leer");
    expect(text).toContain("SE ENCIENDE por defecto");
  });
});

describe("npm run evals -- --ai", () => {
  const capture = async (argv: string[]) => {
    let stdout = "";
    let stderr = "";
    const code = await main(argv, (t) => void (stdout += t), (t) => void (stderr += t));
    return { code, stdout, stderr };
  };
  it("sin clave pide ANTHROPIC_API_KEY y ofrece el modo simulado", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await capture(["--only", "radio-tarjetas-8", "--no-proposed", "--ai"]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("ANTHROPIC_API_KEY");
      expect(r.stderr).toContain("--ai-simulated");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
  it("--ai-simulated imprime la comparación y deja la IA apagada porque no mide a Claude", async () => {
    const r = await capture(["--only", "radio-tarjetas-8", "--no-proposed", "--ai-simulated"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Con IA frente a sin IA (modelo SIMULADO: no mide a Claude)");
    expect(r.stdout).toContain("QUEDA APAGADA por defecto");
  });
  it("un tope de costo inválido da un error claro", async () => {
    const r = await capture(["--only", "radio-tarjetas-8", "--no-proposed", "--ai-simulated", "--ai-max-cost", "-3"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--ai-max-cost");
  });
});
