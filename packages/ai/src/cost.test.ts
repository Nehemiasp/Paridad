import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AnswerCache } from "./cache.ts";
import { costOf, DEFAULT_MODEL, estimateCost, imageTokens, priceOf } from "./cost.ts";

describe("costo", () => {
  it("el modelo por defecto es el más económico (Haiku)", () => {
    expect(DEFAULT_MODEL).toBe("claude-haiku-5-5");
    expect(priceOf("claude-haiku-5-5")).toEqual({ input: 0.1, output: 0.5 });
  });
  it("calcula el costo a partir del uso real; las lecturas de caché valen una décima parte", () => {
    expect(costOf({ inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0 }, "claude-haiku-5-5")).toBeCloseTo(0.00035, 8);
    expect(costOf({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 10_000 }, "claude-haiku-5-5")).toBeCloseTo(0.0001, 8);
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }, "claude-opus-5-5")).toBe(4);
  });
  it("un modelo sin precio conocido falla con claridad, y se pueden pasar precios", () => {
    expect(() => costOf({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, "otro-modelo")).toThrow(/precio del modelo «otro-modelo»/);
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }, "otro-modelo", { "otro-modelo": { input: 3, output: 9 } })).toBe(3);
  });
  it("las imágenes cuestan ancho × alto / 750 tokens, y la estimación las suma", () => {
    expect(imageTokens(900, 600)).toBe(720);
    const e = estimateCost({ textChars: 3000, images: [{ width: 900, height: 600 }], maxOutputTokens: 1000, model: "claude-haiku-5-5" });
    expect(e.inputTokens).toBe(1000 + 720);
    expect(e.usd).toBeCloseTo((1720 * 0.1 + 1000 * 0.5) / 1_000_000, 8);
  });
});

describe("AnswerCache", () => {
  it("guarda y devuelve; la clave depende de todo el contenido", () => {
    const cache = new AnswerCache(mkdtempSync(join(tmpdir(), "ai-cache-")));
    const k = AnswerCache.key({ a: 1 });
    expect(cache.get(k)).toBeUndefined();
    cache.set(k, { output: { x: 1 }, usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0 }, model: "m" });
    expect(cache.get(k)).toMatchObject({ output: { x: 1 }, model: "m" });
    expect(AnswerCache.key({ a: 1 })).toBe(k);
    expect(AnswerCache.key({ a: 2 })).not.toBe(k);
  });
  it("una entrada corrupta se ignora (se vuelve a preguntar)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-cache-"));
    const cache = new AnswerCache(dir);
    const k = AnswerCache.key("x");
    writeFileSync(join(dir, `${k}.json`), "{ roto");
    expect(cache.get(k)).toBeUndefined();
  });
});
