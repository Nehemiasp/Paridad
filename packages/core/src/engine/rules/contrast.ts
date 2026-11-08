import { contrastRatio, effectiveBackground, textColorOver } from "../color.ts";
import type { Finding } from "../findings.ts";
import { round2, type SnapshotIndex } from "../geometry.ts";
import type { SnapshotElement } from "../../snapshot/schema.ts";
import type { ResolvedConfig, Severity } from "../config.ts";
import { lowered } from "../severity.ts";
import { finding, label, type Ctx } from "./context.ts";

/** WCAG: «texto grande» es ≥ 24 px, o ≥ 18.66 px en negrita (≥ 700). */
export function isLargeText(el: SnapshotElement, cfg: ResolvedConfig): boolean {
  const size = el.style.fontSize ?? 0;
  return size >= cfg.contrast.largeTextPx || (size >= cfg.contrast.largeBoldPx && (el.style.fontWeight ?? 400) >= 700);
}

/** Relación de contraste de un texto contra su fondo efectivo; `undefined` si no se puede saber. */
export function textContrast(el: SnapshotElement, index: SnapshotIndex, cfg: ResolvedConfig): { ratio: number; required: number; large: boolean } | undefined {
  if (el.kind !== "text" || !el.style.color) return undefined;
  const bg = effectiveBackground(el, index);
  if (!bg.certain) return undefined;
  const fg = textColorOver(el, bg.color);
  if (!fg) return undefined;
  const large = isLargeText(el, cfg);
  return { ratio: contrastRatio(fg, bg.color), required: large ? cfg.contrast.large : cfg.contrast.normal, large };
}

/**
 * Contraste WCAG AA de cada texto de la página contra su fondo.
 * Si el diseño tiene el mismo problema en ese texto, el hallazgo baja un nivel: el código hizo lo que se le pidió.
 */
export function contrastFindings(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const p of ctx.page.comparable()) {
    const c = textContrast(p, ctx.page, ctx.cfg);
    if (!c || c.ratio >= c.required) continue;

    const pair = ctx.match.byPage.get(p.id);
    const inDesign = pair ? textContrast(pair.design, ctx.design, ctx.cfg) : undefined;
    const designAlsoFails = inDesign !== undefined && inDesign.ratio < inDesign.required;
    let severity: Severity = c.ratio < 3 ? "high" : "medium";
    if (designAlsoFails) severity = lowered(severity);

    out.push(
      finding({
        rule: "contrast",
        severity,
        title: `Contraste insuficiente en ${label(p)}: ${round2(c.ratio)}:1 (mínimo ${c.required}:1${c.large ? ", texto grande" : ""})${designAlsoFails ? ". El diseño ya tiene el mismo problema" : ""}`,
        ...(pair ? { design: pair.design } : {}),
        page: p,
        evidence: {
          property: "contraste WCAG AA",
          expected: `≥ ${c.required}:1`,
          actual: `${round2(c.ratio)}:1`,
          delta: round2(c.ratio - c.required),
          extra: { requerido: c.required, textoGrande: c.large, ...(inDesign ? { enDiseño: round2(inDesign.ratio) } : {}) },
        },
      }),
    );
  }
  return out;
}
