import { AiSectionSchema, ReportSchema, type AiSection, type Report } from "@paridad/core";
import { AnswerCache } from "./cache.ts";
import { AiApiError, AiRefusalError, type AiClient } from "./client.ts";
import { costOf, DEFAULT_MODEL, estimateCost, type Usage } from "./cost.ts";
import { ground, ModelOutputSchema } from "./ground.ts";
import { buildRequest } from "./prompt.ts";

export interface ExplainOptions {
  client: AiClient;
  /** Por defecto `claude-haiku-5-5`, el más económico. */
  model?: string;
  /** `simulado` marca que no hubo modelo real (pruebas de la tubería). */
  mode?: "claude" | "simulado";
  /** Tope de costo de esta corrida en USD (por defecto 0.05). Si la estimación lo supera, no se llama. */
  maxCostUsd?: number;
  cache?: AnswerCache;
  /** Imágenes para enviar recortadas a las regiones relevantes; sin ellas solo se envía texto. */
  images?: { design?: { png: Uint8Array; scale: number }; page?: { png: Uint8Array; scale: number } };
  maxFindings?: number;
  maxOutputTokens?: number;
  prices?: Record<string, { input: number; output: number }>;
}

const empty = (model: string, mode: "claude" | "simulado", warning: string, extra: Partial<AiSection> = {}): AiSection => ({
  model,
  mode,
  groups: [],
  discarded: [],
  rejected: [],
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  costUsd: 0,
  cacheHit: false,
  imagesSent: 0,
  warnings: [warning],
  ...extra,
});

/**
 * Capa de IA: agrupa hallazgos relacionados, propone descartar ruido evidente y redacta cada grupo para el desarrollador.
 *
 * La IA NO inventa hallazgos. Solo ve lo que midió el motor; su respuesta es JSON con esquema y se valida contra los
 * hallazgos reales (`ground`): cada grupo debe citar hallazgos que existen y usar solo cifras y colores de su evidencia.
 * Lo que no pasa se rechaza y los hallazgos quedan tal como los redactó el motor.
 *
 * Control de costo: imágenes recortadas a las regiones relevantes, respuestas en caché local, tope por corrida
 * (se estima antes de llamar) y el costo real queda en el resultado. Si algo falla, el reporte sigue válido y sin IA.
 */
export async function explainReport(report: Report, options: ExplainOptions): Promise<AiSection> {
  const model = options.model ?? DEFAULT_MODEL;
  const mode = options.mode ?? "claude";
  const maxCost = options.maxCostUsd ?? 0.05;
  const maxOutputTokens = options.maxOutputTokens ?? 4096;

  if (report.findings.length === 0) return AiSectionSchema.parse(empty(model, mode, "No hay hallazgos que explicar; no se llamó al modelo."));

  const built = buildRequest(report, { ...(options.maxFindings ? { maxFindings: options.maxFindings } : {}), ...(options.images ? { images: options.images } : {}) });
  const warnings: string[] = [];
  if (built.omitted > 0) warnings.push(`Solo se enviaron los ${built.included.length} hallazgos más graves; ${built.omitted} quedaron fuera de la explicación.`);
  const imagesSent = built.crops.length * 2;

  const est = estimateCost({ textChars: built.textChars, images: built.crops.flatMap((c) => [c.design, c.page]), maxOutputTokens: Math.min(maxOutputTokens, 1500), model, ...(options.prices ? { prices: options.prices } : {}) });
  const key = AnswerCache.key({ v: 1, model, system: built.system, content: built.content.map((c) => (c.type === "text" ? c.text : c.base64.length + c.base64.slice(0, 64) + c.base64.slice(-64))) });

  let answer = options.cache?.get(key);
  let usage: Usage;
  let cacheHit = false;
  let costUsd = 0;

  if (answer) {
    cacheHit = true;
    usage = answer.usage;
  } else {
    if (est.usd > maxCost) {
      return AiSectionSchema.parse(empty(model, mode, `Se omitió la IA: el costo estimado (US$ ${est.usd.toFixed(4)}) supera el tope de la corrida (US$ ${maxCost.toFixed(4)}). Suba el tope con --ai-max-cost o envíe menos imágenes.`, { imagesSent: 0 }));
    }
    try {
      const res = await options.client.complete({ model, system: built.system, content: built.content, maxTokens: maxOutputTokens });
      answer = { output: res.output, usage: res.usage, model: res.model };
      usage = res.usage;
      costUsd = mode === "claude" ? costOf(res.usage, model, options.prices) : 0;
      options.cache?.set(key, answer);
      if (costUsd > maxCost) warnings.push(`El costo real (US$ ${costUsd.toFixed(4)}) superó el tope (US$ ${maxCost.toFixed(4)}).`);
    } catch (error) {
      const what = error instanceof AiRefusalError || error instanceof AiApiError ? error.message : `Falló la llamada al modelo: ${error instanceof Error ? error.message : String(error)}`;
      return AiSectionSchema.parse(empty(model, mode, `La IA no respondió y el reporte queda sin su explicación. ${what}`, { imagesSent }));
    }
  }

  const parsed = ModelOutputSchema.safeParse(answer.output);
  if (!parsed.success) {
    return AiSectionSchema.parse(empty(model, mode, "El modelo devolvió algo que no cumple el esquema; se ignoró su respuesta.", { usage, costUsd, cacheHit, imagesSent }));
  }

  const grounded = ground(parsed.data, report.findings);
  return AiSectionSchema.parse({
    model,
    mode,
    groups: grounded.groups.map((g, i) => ({ id: `g${i + 1}`, ...g })),
    discarded: grounded.discarded,
    rejected: grounded.rejected,
    usage,
    costUsd,
    cacheHit,
    imagesSent,
    warnings,
  });
}

/** Agrega la sección de IA al reporte (el resto queda intacto) y revalida. */
export function attachAi(report: Report, ai: AiSection): Report {
  return ReportSchema.parse({ ...report, ai });
}

/** Resumen en español para la terminal. */
export function summarizeAi(ai: AiSection): string {
  const lines = [`IA (${ai.mode === "simulado" ? "SIMULADA, no mide a Claude" : ai.model}): ${ai.groups.length} grupos · ${ai.discarded.length} descartes propuestos · ${ai.rejected.length} rechazados · costo US$ ${ai.costUsd.toFixed(4)}${ai.cacheHit ? " (caché)" : ""} · ${ai.imagesSent} imágenes`];
  for (const g of ai.groups) lines.push(`  • ${g.title}${g.cssFix ? `  →  ${g.cssFix}` : ""}`);
  for (const r of ai.rejected) lines.push(`  ✗ Rechazado (${r.what}): ${r.reason}`);
  for (const w of ai.warnings) lines.push(`  Aviso: ${w}`);
  return lines.join("\n") + "\n";
}
