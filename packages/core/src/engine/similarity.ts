import { distance } from "fastest-levenshtein";

/**
 * Parecido entre dos textos, de 0 a 1, según la distancia de Levenshtein.
 * No distingue mayúsculas: una diferencia solo de mayúsculas se reporta aparte como hallazgo de texto.
 */
export function textSimilarity(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 1;
  return 1 - distance(x, y) / longest;
}
