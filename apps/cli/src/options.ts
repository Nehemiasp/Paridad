import type { IgnoreZone } from "@paridad/core";

/** `"x,y,ancho,alto"` → rectángulo. Lanza un error en español si el formato no es válido. */
export function parseRect(text: string): { x: number; y: number; width: number; height: number } {
  const parts = text.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`El rectángulo «${text}» no es válido. Use x,y,ancho,alto; por ejemplo 0,0,200,80.`);
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0 || x < 0 || y < 0) {
    throw new Error(`El rectángulo «${text}» debe tener ancho y alto positivos y quedar dentro de la página (x e y ≥ 0).`);
  }
  return { x, y, width, height };
}

export function parsePositiveInt(name: string, text: string | undefined, fallback?: number): number {
  if (text === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Falta ${name}.`);
  }
  const n = Number(text);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} debe ser un número entero positivo (recibí «${text}»).`);
  return n;
}

export function parseScale(text: string | undefined): 1 | 2 {
  if (text === undefined || text === "1") return 1;
  if (text === "2") return 2;
  throw new Error(`--scale debe ser 1 o 2 (recibí «${text}»).`);
}

export function buildIgnoreZones(selectors: string[] = [], rects: string[] = []): IgnoreZone[] {
  return [...selectors.map((selector) => ({ selector })), ...rects.map((r) => ({ rect: parseRect(r) }))];
}
