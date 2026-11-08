import type { SnapshotElement } from "../../snapshot/schema.ts";
import type { Finding } from "../findings.ts";
import { round2 } from "../geometry.ts";
import type { Severity } from "../config.ts";
import { severityForPx } from "../severity.ts";
import { finding, fmt, label, px, type Ctx } from "./context.ts";

const same = (a: string | undefined, b: string | undefined): boolean => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** La fuente que de verdad se pintó (si se sabe) y no la que pide el CSS. */
const rendered = (el: SnapshotElement): string | undefined => el.style.renderedFontFamily ?? el.style.fontFamily;

/** ¿El navegador pintó otra fuente distinta de la que el CSS pide? */
const notLoaded = (el: SnapshotElement): boolean => Boolean(el.style.fontFamily && el.style.renderedFontFamily && !same(el.style.fontFamily, el.style.renderedFontFamily));

/**
 * Tipografía: familia, tamaño, peso, interlineado y espaciado entre letras.
 *
 * Si la fuente no cargó en la página (el CSS la pide pero se pintó otra), eso es UN hallazgo crítico por
 * fuente y no uno por cada texto; y no se repiten los de familia ni peso de esos textos, que son consecuencia.
 */
export function typographyFindings(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  const t = ctx.cfg.tolerances;
  const s = ctx.cfg.severity;

  // Fuentes que no cargaron: un hallazgo por (pedida → pintada), con todos los textos afectados.
  const failed = new Map<string, SnapshotElement[]>();
  for (const el of ctx.page.comparable()) {
    if (el.kind === "text" && notLoaded(el)) {
      const key = `${el.style.fontFamily}→${el.style.renderedFontFamily}`;
      failed.set(key, [...(failed.get(key) ?? []), el]);
    }
  }
  for (const [key, els] of failed) {
    const [wanted, got] = key.split("→") as [string, string];
    const first = els[0]!;
    out.push(
      finding({
        rule: "font-not-loaded",
        severity: "critical",
        title: `La fuente «${wanted}» no cargó en la página: se pintó «${got}» en ${els.length} texto${els.length === 1 ? "" : "s"}`,
        page: first,
        evidence: { property: "fuente cargada", expected: wanted, actual: got, extra: { textos: els.length } },
        related: els.map((e) => e.id),
        suffix: key,
      }),
    );
  }

  for (const { design: d, page: p } of ctx.match.pairs) {
    if (d.kind !== "text") continue;
    const ds = d.style;
    const ps = p.style;

    if (!notLoaded(p) && ds.fontFamily && rendered(p) && !same(ds.fontFamily, rendered(p))) {
      out.push(
        finding({
          rule: "font-family",
          severity: "high",
          title: `Fuente de ${label(d)}: diseño ${ds.fontFamily} · código ${rendered(p)}`,
          design: d,
          page: p,
          evidence: { property: "familia tipográfica", expected: ds.fontFamily, actual: rendered(p) },
        }),
      );
    }

    if (ds.fontSize !== undefined && ps.fontSize !== undefined && Math.abs(ps.fontSize - ds.fontSize) > t.fontSize) {
      const delta = ps.fontSize - ds.fontSize;
      const sev: Severity = Math.abs(delta) <= s.fontSizeMedium ? "low" : Math.abs(delta) <= s.fontSizeHigh ? "medium" : "high";
      out.push(
        finding({
          rule: "font-size",
          severity: sev,
          title: `Tamaño de letra de ${label(d)}: diseño ${px(ds.fontSize)} · código ${px(ps.fontSize)}`,
          design: d,
          page: p,
          evidence: { property: "tamaño de letra", expected: ds.fontSize, actual: ps.fontSize, delta: round2(delta), unit: "px" },
        }),
      );
    }

    if (!notLoaded(p) && ds.fontWeight !== undefined && ps.fontWeight !== undefined && ds.fontWeight !== ps.fontWeight) {
      const delta = ps.fontWeight - ds.fontWeight;
      out.push(
        finding({
          rule: "font-weight",
          severity: Math.abs(delta) >= 200 ? "high" : "medium",
          title: `Peso de ${label(d)}: diseño ${ds.fontWeight} · código ${ps.fontWeight}`,
          design: d,
          page: p,
          evidence: { property: "peso tipográfico", expected: ds.fontWeight, actual: ps.fontWeight, delta },
        }),
      );
    }

    if (typeof ds.lineHeight === "number" && typeof ps.lineHeight === "number" && Math.abs(ps.lineHeight - ds.lineHeight) > t.lineHeight) {
      const delta = ps.lineHeight - ds.lineHeight;
      out.push(
        finding({
          rule: "line-height",
          severity: severityForPx(delta, ctx.cfg),
          title: `Interlineado de ${label(d)}: diseño ${px(ds.lineHeight)} · código ${px(ps.lineHeight)}`,
          design: d,
          page: p,
          evidence: { property: "interlineado", expected: ds.lineHeight, actual: ps.lineHeight, delta: round2(delta), unit: "px" },
        }),
      );
    }

    if (ds.letterSpacing !== undefined && ps.letterSpacing !== undefined && Math.abs(ps.letterSpacing - ds.letterSpacing) > t.letterSpacing) {
      const delta = ps.letterSpacing - ds.letterSpacing;
      out.push(
        finding({
          rule: "letter-spacing",
          severity: Math.abs(delta) <= 0.5 ? "low" : Math.abs(delta) <= 1.5 ? "medium" : "high",
          title: `Espaciado entre letras de ${label(d)}: diseño ${fmt(ds.letterSpacing)} px · código ${fmt(ps.letterSpacing)} px`,
          design: d,
          page: p,
          evidence: { property: "espaciado entre letras", expected: ds.letterSpacing, actual: ps.letterSpacing, delta: round2(delta), unit: "px" },
        }),
      );
    }
  }
  return out;
}
