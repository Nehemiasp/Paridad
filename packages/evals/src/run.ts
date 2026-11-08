import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { assertSnapshot, attachVisual, compare, type Box, type Report, type Snapshot } from "@paridad/core";
import { capturePage } from "@paridad/capture";
import { landing } from "@paridad/fixtures";
import { visualDiff } from "@paridad/visual";
import { evaluateMutation, CONTROL_ID, CONTROL_TYPE, type MutationResult } from "./metrics.ts";
import { materialize, MutationSchema, type Mutation } from "./mutation.ts";

/** La mutación «control»: la página intacta. */
export const CONTROL: Mutation = MutationSchema.parse({
  id: CONTROL_ID,
  description: "La página de ejemplo sin cambios: casi no debería reportarse nada.",
  errorType: CONTROL_TYPE,
  edits: [],
  expected: [],
  acceptable: [],
});

export interface RunOptions {
  /** Navegador reutilizable (más rápido); si no, abre uno. */
  browser?: Browser;
  /** Configuración de Paridad (tolerancias…); por defecto la estándar. */
  config?: Parameters<typeof compare>[2] extends infer O ? (O extends { config?: infer C } ? C : never) : never;
  onProgress?: (result: MutationResult, index: number, total: number) => void;
}

export interface MutationRun {
  result: MutationResult;
  report: Report;
  page: Snapshot;
}

const rects = (s: Snapshot): Box[] => s.ignore.flatMap((z) => ("rect" in z ? [z.rect] : []));

/** Aplica una mutación a la página de ejemplo, la captura, la compara con el diseño y evalúa el resultado. */
export async function runMutation(mutation: Mutation, browser: Browser, config?: RunOptions["config"]): Promise<MutationRun> {
  const design = assertSnapshot(JSON.parse(readFileSync(landing.designSnapshot, "utf8")));
  const designPng = readFileSync(landing.designImage);

  const dir = materialize(landing.pageDir, mutation);
  const captured = await capturePage({ url: pathToFileURL(join(dir, "index.html")).href, width: landing.viewport.width, imageName: "page.png" }, browser);
  writeFileSync(join(dir, "page.png"), captured.screenshot);
  const page = captured.snapshot;

  let report = compare(design, page, { ...(config ? { config } : {}) });
  const v = visualDiff({ design: { png: designPng, scale: design.canvas.scale }, page: { png: captured.screenshot, scale: page.canvas.scale }, ignoreRects: [...rects(design), ...rects(page)] });
  const { heatmap: _heatmap, ...raw } = v;
  report = attachVisual(report, raw, { design, page, ...(config ? { config } : {}) });

  const comparedElements = report.matching.pairs + report.matching.missing + report.matching.extra;
  return { result: evaluateMutation(mutation, report, page, comparedElements), report, page };
}

/** Corre la lista completa (siempre con el control primero) y conserva el reporte y la página de cada una. */
export async function runAllDetailed(mutations: Mutation[], options: RunOptions = {}): Promise<{ mutation: Mutation; run: MutationRun }[]> {
  const own = !options.browser;
  const browser = options.browser ?? (await chromium.launch());
  try {
    const all = [CONTROL, ...mutations.filter((m) => m.id !== CONTROL_ID)];
    const out: { mutation: Mutation; run: MutationRun }[] = [];
    for (const [i, m] of all.entries()) {
      const run = await runMutation(m, browser, options.config);
      out.push({ mutation: m, run });
      options.onProgress?.(run.result, i + 1, all.length);
    }
    return out;
  } finally {
    if (own) await browser.close();
  }
}

/** Corre la lista completa (siempre con el control primero). */
export async function runAll(mutations: Mutation[], options: RunOptions = {}): Promise<MutationResult[]> {
  return (await runAllDetailed(mutations, options)).map((x) => x.run.result);
}
