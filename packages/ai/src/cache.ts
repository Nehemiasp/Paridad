import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Usage } from "./cost.ts";

export interface CachedAnswer {
  output: unknown;
  usage: Usage;
  model: string;
}

/** Caché local de respuestas del modelo: la misma pregunta (modelo, instrucciones, hallazgos, imágenes) no se paga dos veces. */
export class AnswerCache {
  constructor(private readonly dir: string) {}

  static key(parts: unknown): string {
    return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  }

  get(key: string): CachedAnswer | undefined {
    const file = join(this.dir, `${key}.json`);
    if (!existsSync(file)) return undefined;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as CachedAnswer;
    } catch {
      return undefined; // caché corrupta: se vuelve a preguntar
    }
  }

  set(key: string, value: CachedAnswer): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(value));
  }
}
