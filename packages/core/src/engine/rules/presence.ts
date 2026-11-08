import { finding, label, type Ctx } from "./context.ts";
import type { Finding } from "../findings.ts";

/** Elementos que faltan (en el diseño y no en el código) y que sobran. Se reporta la raíz de cada subárbol. */
export function presenceFindings(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  const where = (n: number) => (n > 0 ? ` (con ${n} elemento${n === 1 ? "" : "s"} dentro)` : "");

  for (const { element, descendants } of ctx.match.missing) {
    out.push(
      finding({
        rule: "missing",
        severity: "critical",
        title: `Falta en el código: ${element.kind === "text" ? "texto" : element.kind === "image" ? "imagen" : "caja"} ${label(element)}${where(descendants.length)}`,
        design: element,
        evidence: { property: "presencia", expected: "presente", actual: "ausente" },
        related: descendants.map((d) => d.id),
      }),
    );
  }
  for (const { element, descendants } of ctx.match.extra) {
    out.push(
      finding({
        rule: "extra",
        severity: "high",
        title: `Sobra en el código: ${element.kind === "text" ? "texto" : element.kind === "image" ? "imagen" : "caja"} ${label(element)}${where(descendants.length)}`,
        page: element,
        evidence: { property: "presencia", expected: "ausente", actual: "presente" },
        related: descendants.map((d) => d.id),
      }),
    );
  }
  return out;
}
