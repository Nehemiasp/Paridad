import { differenceCiede2000, parse } from "culori";
import type { HexColor, SnapshotElement } from "../snapshot/schema.ts";
import type { SnapshotIndex } from "./geometry.ts";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

export function hexToRgba(hex: HexColor): Rgba {
  const h = hex.slice(1);
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

/** Pinta `top` (con su transparencia) sobre `under` (opaco). */
export function composite(top: Rgba, under: Rgba): Rgba {
  const a = top.a;
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
}

const deltaE = differenceCiede2000();

/** Diferencia perceptual ΔE2000 entre dos colores (se ignora la transparencia). */
export function deltaE2000(a: HexColor, b: HexColor): number {
  const ca = parse(a.slice(0, 7));
  const cb = parse(b.slice(0, 7));
  if (!ca || !cb) return Number.POSITIVE_INFINITY;
  return deltaE(ca, cb);
}

/** Luminancia relativa WCAG 2.x (0–1). */
export function relativeLuminance({ r, g, b }: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Relación de contraste WCAG entre dos colores opacos (1–21). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

export interface EffectiveBackground {
  color: Rgba;
  /** `false` si hay una imagen debajo: el fondo real no se puede conocer a partir del snapshot. */
  certain: boolean;
}

/**
 * Fondo sobre el que se pinta un elemento: recorre los ancestros, de cerca a lejos, componiendo los fondos
 * con transparencia. Si no hay ninguno, el lienzo es blanco. Una imagen en la cadena vuelve el resultado incierto.
 */
export function effectiveBackground(el: SnapshotElement, index: SnapshotIndex): EffectiveBackground {
  const layers: Rgba[] = [];
  let certain = true;
  for (let cur = index.parent(el); cur; cur = index.parent(cur)) {
    if (cur.kind === "image") certain = false;
    if (cur.style.background) {
      const c = hexToRgba(cur.style.background);
      const opacity = cur.style.opacity ?? 1;
      layers.push({ ...c, a: c.a * opacity });
      if (c.a * opacity >= 0.999) break;
    }
  }
  let base = WHITE;
  for (const layer of layers.reverse()) base = composite(layer, base);
  return { color: base, certain };
}

/** Color del texto ya compuesto sobre su fondo (para texto con transparencia). */
export function textColorOver(el: SnapshotElement, bg: Rgba): Rgba | undefined {
  if (!el.style.color) return undefined;
  const c = hexToRgba(el.style.color);
  return composite({ ...c, a: c.a * (el.style.opacity ?? 1) }, bg);
}
