import type { Category, Severity } from "@paridad/core";

export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Crítica", high: "Alta", medium: "Media", low: "Baja" };
/** Cada severidad lleva una forma distinta además del color: el significado no depende solo del color. */
export const SEVERITY_SHAPE: Record<Severity, string> = { critical: "■", high: "▲", medium: "◆", low: "●" };
export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low"];

export const CATEGORY_LABEL: Record<Category, string> = {
  presencia: "Presencia",
  posición: "Posición",
  tamaño: "Tamaño",
  tipografía: "Tipografía",
  color: "Color",
  texto: "Texto",
  contraste: "Contraste",
  página: "Página",
  visual: "Visual",
};
export const CATEGORIES: readonly Category[] = ["presencia", "posición", "tamaño", "tipografía", "color", "texto", "contraste", "página", "visual"];

/** Colores de las severidades: texto sobre fondo claro, ambos con contraste ≥ 4.5:1 (lo verifica una prueba). */
export const SEVERITY_COLORS: Record<Severity, { fg: string; bg: string; border: string }> = {
  critical: { fg: "#8a0f1f", bg: "#fdecee", border: "#8a0f1f" },
  high: { fg: "#8a3a00", bg: "#fff1e0", border: "#8a3a00" },
  medium: { fg: "#5c4a00", bg: "#fff8d6", border: "#5c4a00" },
  low: { fg: "#1f4b8a", bg: "#e6effb", border: "#1f4b8a" },
};

/** «Escritorio 1440 px», «Tableta 820 px», «Móvil 390 px». */
export function sizeLabel(width: number): string {
  const w = Math.round(width);
  return `${w >= 1000 ? "Escritorio" : w >= 600 ? "Tableta" : "Móvil"} ${w} px`;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «8 de noviembre de 2026, 12:00 UTC». A mano, sin `Intl`: el resultado no debe depender de los datos regionales del sistema. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}
