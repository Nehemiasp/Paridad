import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Caché en disco de las respuestas de la API, para no pedir lo mismo una y otra vez.
 * La clave es el hash de la petición (ruta + parámetros); nunca incluye el token.
 */
export class DiskCache {
  constructor(
    readonly dir: string,
    private readonly ttlMs: number = 24 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  private file(key: string, ext: string): string {
    return join(this.dir, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.${ext}`);
  }

  private fresh(path: string): boolean {
    try {
      return this.now() - statSync(path).mtimeMs < this.ttlMs;
    } catch {
      return false;
    }
  }

  getJson<T>(key: string): T | undefined {
    const path = this.file(key, "json");
    if (!this.fresh(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
      return undefined; // caché corrupta: se vuelve a pedir
    }
  }

  setJson(key: string, value: unknown): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file(key, "json"), JSON.stringify(value));
  }

  getBinary(key: string): Buffer | undefined {
    const path = this.file(key, "bin");
    if (!this.fresh(path)) return undefined;
    try {
      return readFileSync(path);
    } catch {
      return undefined;
    }
  }

  setBinary(key: string, value: Uint8Array): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file(key, "bin"), value);
  }
}
