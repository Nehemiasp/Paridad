import { finding, px, type Ctx } from "./context.ts";
import { severityForPx } from "../severity.ts";
import type { Finding } from "../findings.ts";

/** Reglas de la página completa: tamaño de ventana, desborde horizontal y alto total. */
export function pageFindings(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  const d = ctx.design.snapshot.canvas;
  const p = ctx.page.snapshot.canvas;

  if (d.width !== p.width) {
    out.push(
      finding({
        rule: "canvas-size",
        severity: "critical",
        title: `El frame mide ${px(d.width)} de ancho y la página se capturó a ${px(p.width)}: no son comparables`,
        evidence: { property: "ancho del lienzo", expected: d.width, actual: p.width, delta: p.width - d.width, unit: "px" },
      }),
    );
  }

  const root = ctx.page.root;
  if (root && root.box.width > p.width + 1) {
    out.push(
      finding({
        rule: "page-overflow",
        severity: "high",
        title: `La página se desborda horizontalmente: mide ${px(root.box.width)} en una ventana de ${px(p.width)}`,
        page: root,
        evidence: { property: "ancho de la página", expected: p.width, actual: root.box.width, delta: root.box.width - p.width, unit: "px" },
      }),
    );
  }

  const dh = p.height - d.height;
  if (Math.abs(dh) > ctx.cfg.tolerances.pageHeight) {
    out.push(
      finding({
        rule: "page-height",
        severity: severityForPx(dh, ctx.cfg),
        title: `Alto de la página: diseño ${px(d.height)} · código ${px(p.height)}`,
        evidence: { property: "alto de la página", expected: d.height, actual: p.height, delta: dh, unit: "px" },
      }),
    );
  }
  return out;
}
