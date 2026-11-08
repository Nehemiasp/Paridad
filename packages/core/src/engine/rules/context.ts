import type { SnapshotElement } from "../../snapshot/schema.ts";
import { CATEGORY_OF_RULE, type ElementRef, type Evidence, type Finding } from "../findings.ts";
import type { ResolvedConfig, RuleId, Severity } from "../config.ts";
import { round2, type SnapshotIndex } from "../geometry.ts";
import type { MatchResult } from "../match.ts";

export interface Ctx {
  design: SnapshotIndex;
  page: SnapshotIndex;
  cfg: ResolvedConfig;
  match: MatchResult;
  /** Color → color más cercano de la paleta del diseño. */
  paletteNearest: (hex: string) => { hex: string; deltaE: number } | undefined;
}

export const ref = (el: SnapshotElement): ElementRef => ({ elementId: el.id, ...(el.name ? { name: el.name } : {}), box: el.box });

export const fmt = (n: number): string => String(round2(n));
export const px = (n: number): string => `${fmt(n)} px`;

/** Nombre corto y legible de un elemento para los títulos: su texto, o su nombre. */
export function label(el: SnapshotElement): string {
  const t = el.text?.normalized;
  if (t) return `«${t.length > 28 ? `${t.slice(0, 27)}…` : t}»`;
  return `«${el.name ?? el.id}»`;
}

export interface FindingInput {
  rule: RuleId;
  severity: Severity;
  title: string;
  design?: SnapshotElement;
  page?: SnapshotElement;
  evidence: Evidence;
  related?: string[];
  /** Para distinguir dos hallazgos de la misma regla sobre el mismo par. */
  suffix?: string;
}

export function finding(input: FindingInput): Finding {
  const id = [input.rule, input.design?.id ?? "-", input.page?.id ?? "-", input.suffix].filter((p) => p !== undefined).join(":");
  return {
    id,
    rule: input.rule,
    category: CATEGORY_OF_RULE[input.rule],
    severity: input.severity,
    title: input.title,
    ...(input.design ? { design: ref(input.design) } : {}),
    ...(input.page ? { page: ref(input.page) } : {}),
    evidence: input.evidence,
    ...(input.related?.length ? { related: input.related } : {}),
  };
}
