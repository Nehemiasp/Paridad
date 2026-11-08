/** Precios por millón de tokens en USD (entrada, salida), de la tabla de modelos del SDK; configurables. */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-fable-5-1": { input: 10, output: 50 },
};

/** Modelo por defecto: el más económico (decisión de la Fase 6); se cambia con `--ai-model`. */
export const DEFAULT_MODEL = "claude-haiku-5-5";

export function priceOf(model: string, overrides: Record<string, { input: number; output: number }> = {}): { input: number; output: number } {
  const p = overrides[model] ?? PRICES[model];
  if (!p) throw new Error(`No conozco el precio del modelo «${model}». Agréguelo en PRICES o pase sus precios (USD por millón de tokens).`);
  return p;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** Costo real de una llamada a partir de lo que informó la API. Las lecturas de caché valen una décima parte. */
export function costOf(usage: Usage, model: string, overrides?: Record<string, { input: number; output: number }>): number {
  const p = priceOf(model, overrides);
  return (usage.inputTokens * p.input + usage.cacheReadTokens * p.input * 0.1 + usage.outputTokens * p.output) / 1_000_000;
}

/** Tokens de una imagen según la fórmula de la documentación: ancho × alto / 750. */
export const imageTokens = (width: number, height: number): number => Math.ceil((width * height) / 750);

/** Estimación previa (por defecto algo pesimista) para decidir si se cabe en el tope de costo antes de llamar. */
export function estimateCost(opts: { textChars: number; images: { width: number; height: number }[]; maxOutputTokens: number; model: string; prices?: Record<string, { input: number; output: number }> }): { inputTokens: number; outputTokens: number; usd: number } {
  const inputTokens = Math.ceil(opts.textChars / 3) + opts.images.reduce((n, i) => n + imageTokens(i.width, i.height), 0);
  const outputTokens = opts.maxOutputTokens;
  return { inputTokens, outputTokens, usd: costOf({ inputTokens, outputTokens, cacheReadTokens: 0 }, opts.model, opts.prices) };
}
