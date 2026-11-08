import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { AnswerCache, createAnthropicClient, createSimulatedClient, DEFAULT_MODEL } from "@paridad/ai";
import { decideAiDefault, formatAiComparison, runAiEval, type AiEvalResult } from "./ai-eval.ts";
import { BUILTIN_MUTATIONS } from "./builtin.ts";
import { formatFailures, formatRegressions, formatTable, type EvalRun } from "./format.ts";
import { loadPrevious, saveRun } from "./history.ts";
import { checkGoals, computeMetrics, DEFAULT_GOALS, pct } from "./metrics.ts";
import { loadMutationsFromDir, materialize, MutationError, type Mutation } from "./mutation.ts";
import { runAllDetailed } from "./run.ts";

const HELP = `Uso: npm run evals -- [opciones]

Mide si Paridad acierta: aplica errores conocidos a la página de ejemplo, la compara con el diseño
y calcula detección, precisión y severidad por tipo de error, más los falsos positivos de la página de control.

  --only <id,id>          correr solo esas mutaciones (el control siempre corre)
  --no-proposed           no cargar las mutaciones propuestas de packages/evals/mutations/
  --proposed <carpeta>    carpeta de mutaciones propuestas (JSON)
  --out <carpeta>         dónde guardar corridas (por defecto out/evals)
  --no-save               no guardar esta corrida
  --min-detection <0-1>   meta de detección (por defecto ${DEFAULT_GOALS.minDetection})
  --max-control-fp <0-1>  meta de falsos positivos en control (por defecto ${DEFAULT_GOALS.maxControlFalsePositive})
  --ai                    repetir la evaluación con la capa de IA (Claude) y comparar con y sin IA; requiere ANTHROPIC_API_KEY
  --ai-simulated          lo mismo con un modelo simulado (solo prueba la tubería; no mide a Claude)
  --ai-model <id>         modelo de la IA (por defecto ${DEFAULT_MODEL})
  --ai-max-cost <usd>     tope de costo de TODA la evaluación con IA (por defecto 0.5)
  --validate              solo validar las mutaciones propuestas (esquema y que sus ediciones apliquen); no abre el navegador
  --json                  imprimir el resultado como JSON
  -h, --help              esta ayuda

Sale con código 1 si no se cumplen las metas.
`;

export async function main(argv: string[], out: (t: string) => void = (t) => process.stdout.write(t), err: (t: string) => void = (t) => process.stderr.write(t)): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        only: { type: "string" },
        "no-proposed": { type: "boolean" },
        proposed: { type: "string" },
        out: { type: "string" },
        "no-save": { type: "boolean" },
        "min-detection": { type: "string" },
        "max-control-fp": { type: "string" },
        validate: { type: "boolean" },
        ai: { type: "boolean" },
        "ai-simulated": { type: "boolean" },
        "ai-model": { type: "string" },
        "ai-max-cost": { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (e) {
    err(`Error: ${e instanceof Error ? e.message : String(e)}\n${HELP}`);
    return 1;
  }
  if (values.help) {
    out(HELP);
    return 0;
  }

  const num = (name: string, v: string | undefined, fallback: number): number => {
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${name} debe ser un número entre 0 y 1 (recibí «${v}»).`);
    return n;
  };
  let goals;
  try {
    goals = {
      minDetection: num("--min-detection", values["min-detection"], DEFAULT_GOALS.minDetection),
      maxControlFalsePositive: num("--max-control-fp", values["max-control-fp"], DEFAULT_GOALS.maxControlFalsePositive),
    };
  } catch (e) {
    err(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const proposedDir = values.proposed ?? fileURLToPath(new URL("../mutations", import.meta.url));
  const proposed = values["no-proposed"] ? { mutations: [] as Mutation[], rejected: [] } : loadMutationsFromDir(proposedDir);
  const ids = new Set<string>();
  let mutations: Mutation[] = [];
  for (const m of [...BUILTIN_MUTATIONS, ...proposed.mutations]) {
    if (ids.has(m.id)) {
      proposed.rejected.push({ source: m.id, reason: "id repetido" });
      continue;
    }
    ids.add(m.id);
    mutations.push(m);
  }
  if (values.only) {
    const wanted = new Set(values.only.split(",").map((s) => s.trim()));
    const unknown = [...wanted].filter((w) => !ids.has(w));
    if (unknown.length) {
      err(`Error: no existe la mutación ${unknown.join(", ")}.\n`);
      return 1;
    }
    mutations = mutations.filter((m) => wanted.has(m.id));
  }

  if (values.validate) {
    // Comprueba que cada propuesta sea válida y que sus ediciones apliquen a la página actual; no corre nada.
    let ok = proposed.rejected.length === 0;
    for (const r of proposed.rejected) err(`✗ ${r.source}: ${r.reason}\n`);
    for (const m of proposed.mutations) {
      try {
        rmSync(materialize(fileURLToPath(new URL("../../../fixtures/landing/page", import.meta.url)), m), { recursive: true, force: true });
        out(`✓ ${m.id} (${m.errorType}): ${m.edits.length} ediciones, ${m.expected.length} expectativas\n`);
      } catch (e) {
        ok = false;
        err(`✗ ${m.id}: ${e instanceof MutationError ? e.message : String(e)}\n`);
      }
    }
    out(`${proposed.mutations.length} propuestas válidas, ${proposed.rejected.length} rechazadas.\n`);
    return ok ? 0 : 1;
  }

  const outDir = values.out ?? "out/evals";
  const previous = loadPrevious(outDir);

  if (!values.json) out(`Corriendo ${mutations.length} mutaciones y el control (${proposed.mutations.length} propuestas)…\n`);
  const browser = await chromium.launch();
  let detailed;
  try {
    detailed = await runAllDetailed(mutations, { browser, onProgress: (r, i, n) => !values.json && out(`  [${String(i).padStart(2)}/${n}] ${r.passed ? "✓" : "✗"} ${r.id}\n`) });
  } finally {
    await browser.close();
  }
  const results = detailed.map((d) => d.run.result);

  const metrics = computeMetrics(results);

  // Con IA (opcional): las mismas mutaciones, con la capa de IA aplicada.
  let aiEval: AiEvalResult | undefined;
  if (values.ai || values["ai-simulated"]) {
    const simulated = values["ai-simulated"] === true;
    const key = process.env.ANTHROPIC_API_KEY;
    if (!simulated && !key) {
      err("Error: --ai necesita ANTHROPIC_API_KEY en el entorno. Use --ai-simulated para probar la tubería sin llamar a ningún modelo.\n");
      return 1;
    }
    const cap = Number(values["ai-max-cost"] ?? "0.5");
    if (!Number.isFinite(cap) || cap < 0) {
      err(`Error: --ai-max-cost debe ser un número de dólares ≥ 0 (recibí «${values["ai-max-cost"]}»).\n`);
      return 1;
    }
    if (!values.json) out(`\nRepitiendo con IA (${simulated ? "simulada" : values["ai-model"] ?? DEFAULT_MODEL}), tope US$ ${cap}…\n`);
    aiEval = await runAiEval(detailed, {
      client: simulated ? createSimulatedClient() : createAnthropicClient({ apiKey: key as string }),
      mode: simulated ? "simulado" : "claude",
      ...(values["ai-model"] ? { model: values["ai-model"] } : {}),
      maxTotalCostUsd: cap,
      cache: new AnswerCache(`${outDir}/ai-cache`),
    });
  }

  const run: EvalRun = { schemaVersion: 1, createdAt: new Date().toISOString(), goals, metrics, results, rejected: proposed.rejected, ...(aiEval ? { ai: { mode: aiEval.mode, model: aiEval.model, metrics: aiEval.metrics, totals: aiEval.totals, decision: decideAiDefault(metrics, aiEval) } } : {}) };
  const verdict = checkGoals(metrics, goals);

  if (values.json) {
    out(JSON.stringify({ ...run, verdict }, null, 2) + "\n");
  } else {
    out("\n" + formatTable(metrics, previous?.metrics));
    if (proposed.rejected.length) {
      out("\nMutaciones propuestas rechazadas (no se corrieron):\n");
      for (const r of proposed.rejected) out(`  ✗ ${r.source}: ${r.reason}\n`);
    }
    out("\n" + formatFailures(results));
    out("\n" + (previous ? formatRegressions(results, previous.results) : "Sin corrida anterior con la que comparar.\n"));
    if (aiEval) out("\n" + formatAiComparison(metrics, aiEval, decideAiDefault(metrics, aiEval)));
    out(`\nMetas: detección ≥ ${pct(goals.minDetection)} y falsos positivos en control ≤ ${pct(goals.maxControlFalsePositive)} → ${verdict.ok ? "SE CUMPLEN" : `NO SE CUMPLEN (${verdict.failures.join("; ")})`}\n`);
  }

  if (!values["no-save"] && !values.only) {
    const file = saveRun(outDir, run);
    if (!values.json) out(`Corrida guardada en ${file}\n`);
  }
  return verdict.ok ? 0 : 1;
}

// Se ejecuta solo si se llama directamente (no al importarlo desde las pruebas).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
