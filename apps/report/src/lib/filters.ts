import type { Category, Finding, Severity } from "@paridad/core";

export interface Filters {
  severities: ReadonlySet<Severity>;
  /** Vacío = todas las categorías. */
  categories: ReadonlySet<Category>;
  /** Mostrar también lo que la IA propone tratar como ruido. */
  showDiscarded: boolean;
}

export const NO_FILTERS: Filters = { severities: new Set(), categories: new Set(), showDiscarded: false };

/** Sin severidades marcadas se muestran todas (un filtro vacío no debe dejar la lista en blanco). */
export function filterFindings(findings: Finding[], f: Filters, discarded: ReadonlySet<string> = new Set()): Finding[] {
  return findings.filter((x) => (f.severities.size === 0 || f.severities.has(x.severity)) && (f.categories.size === 0 || f.categories.has(x.category)) && (f.showDiscarded || !discarded.has(x.id)));
}

export function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function countBy<T extends string>(findings: Finding[], pick: (f: Finding) => T): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const f of findings) out[pick(f)] = (out[pick(f)] ?? 0) + 1;
  return out;
}
