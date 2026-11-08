import type { Finding } from "../findings.ts";
import { textSimilarity } from "../similarity.ts";
import { finding, label, type Ctx } from "./context.ts";

const REASONS = { overflow: "desbordado", ellipsis: "cortado con puntos suspensivos", "line-clamp": "cortado por límite de líneas" } as const;

/** Contenido del texto y textos cortados o desbordados. */
export function textFindings(ctx: Ctx): Finding[] {
  const out: Finding[] = [];

  for (const { design: d, page: p } of ctx.match.pairs) {
    if (d.kind !== "text" || !d.text || !p.text) continue;

    if (d.text.normalized !== p.text.normalized) {
      const caseOnly = d.text.normalized.toLowerCase() === p.text.normalized.toLowerCase();
      const sim = textSimilarity(d.text.normalized, p.text.normalized);
      out.push(
        finding({
          rule: "text-content",
          severity: caseOnly ? "low" : sim < 0.9 ? "high" : "medium",
          title: `Texto: diseño «${d.text.normalized}» · código «${p.text.normalized}»${caseOnly ? " (solo cambian las mayúsculas)" : ""}`,
          design: d,
          page: p,
          evidence: { property: "texto", expected: d.text.normalized, actual: p.text.normalized, extra: { similitud: Math.round(sim * 100) / 100 } },
        }),
      );
    }

    if (p.text.clipped && !(d.text.clipped && d.text.clipped.reason === p.text.clipped.reason)) {
      out.push(
        finding({
          rule: "text-clipped",
          severity: "high",
          title: `Texto ${REASONS[p.text.clipped.reason]}: ${label(p)}`,
          design: d,
          page: p,
          evidence: { property: "texto cortado", expected: "completo", actual: p.text.clipped.reason },
        }),
      );
    }
  }
  return out;
}
