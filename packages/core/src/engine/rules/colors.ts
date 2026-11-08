import type { SnapshotElement } from "../../snapshot/schema.ts";
import { deltaE2000 } from "../color.ts";
import type { Finding } from "../findings.ts";
import { round2 } from "../geometry.ts";
import type { Severity } from "../config.ts";
import { atLeast, severityForDeltaE } from "../severity.ts";
import { finding, label, type Ctx } from "./context.ts";

/** Color más cercano de la paleta del diseño. */
export function makePaletteNearest(palette: string[]): Ctx["paletteNearest"] {
  return (hex) => {
    let best: { hex: string; deltaE: number } | undefined;
    for (const c of palette) {
      const de = deltaE2000(hex, c);
      if (!best || de < best.deltaE) best = { hex: c, deltaE: de };
    }
    return best;
  };
}

/** Colores del diseño: los de su paleta declarada y los realmente usados por sus elementos. */
export function designPalette(ctx: { design: Ctx["design"] }): string[] {
  const set = new Set<string>(ctx.design.snapshot.palette?.colors.map((c) => c.hex) ?? []);
  for (const e of ctx.design.snapshot.elements) {
    for (const c of [e.style.color, e.style.background, e.style.border?.color]) if (c) set.add(c);
  }
  return [...set];
}

interface ColorCheck {
  rule: "color-text" | "color-background" | "color-border";
  what: string;
  expected: string | undefined;
  actual: string | undefined;
}

/**
 * Color: diferencia perceptual (ΔE2000) entre cada par, y si el color usado en el código está fuera de la
 * paleta del diseño. Un color fuera de la paleta nunca baja de severidad «media».
 */
export function colorFindings(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  const tol = ctx.cfg.tolerances.colorDeltaE;

  const checks = (d: SnapshotElement, p: SnapshotElement): ColorCheck[] => {
    const list: ColorCheck[] = [];
    if (d.kind === "text") list.push({ rule: "color-text", what: "color del texto", expected: d.style.color, actual: p.style.color });
    else {
      list.push({ rule: "color-background", what: "color de fondo", expected: d.style.background, actual: p.style.background });
      if (d.style.border && p.style.border) list.push({ rule: "color-border", what: "color del borde", expected: d.style.border.color, actual: p.style.border.color });
    }
    return list;
  };

  for (const { design: d, page: p } of ctx.match.pairs) {
    for (const c of checks(d, p)) {
      if (c.expected === undefined && c.actual === undefined) continue;
      if (c.expected === undefined || c.actual === undefined) {
        // Uno tiene color y el otro no: el fondo o el texto desapareció o apareció.
        out.push(
          finding({
            rule: c.rule,
            severity: "high",
            title: `${cap(c.what)} de ${label(d)}: diseño ${c.expected ?? "ninguno"} · código ${c.actual ?? "ninguno"}`,
            design: d,
            page: p,
            evidence: { property: c.what, expected: c.expected ?? null, actual: c.actual ?? null },
          }),
        );
        continue;
      }
      const de = deltaE2000(c.expected, c.actual);
      if (de <= tol) continue;
      const nearest = ctx.paletteNearest(c.actual);
      const inPalette = nearest !== undefined && nearest.deltaE <= ctx.cfg.tolerances.paletteDeltaE;
      let severity: Severity = severityForDeltaE(de, ctx.cfg);
      if (!inPalette) severity = atLeast(severity, "medium");
      out.push(
        finding({
          rule: c.rule,
          severity,
          title: `${cap(c.what)} de ${label(d)}: diseño ${c.expected} · código ${c.actual}${inPalette ? "" : " (fuera de la paleta)"}`,
          design: d,
          page: p,
          evidence: {
            property: c.what,
            expected: c.expected,
            actual: c.actual,
            delta: round2(de),
            unit: "ΔE",
            extra: { fueraDePaleta: !inPalette, ...(nearest ? { masCercanoDeLaPaleta: nearest.hex, deltaEPaleta: round2(nearest.deltaE) } : {}) },
          },
        }),
      );
    }
  }

  // Colores fuera de la paleta en elementos que sobran (sin pareja en el diseño): uno por color.
  const byColor = new Map<string, SnapshotElement[]>();
  for (const { element, descendants } of ctx.match.extra) {
    for (const el of [element, ...descendants]) {
      for (const c of [el.style.color, el.style.background, el.style.border?.color]) {
        if (!c) continue;
        const nearest = ctx.paletteNearest(c);
        if (!nearest || nearest.deltaE > ctx.cfg.tolerances.paletteDeltaE) byColor.set(c, [...(byColor.get(c) ?? []), el]);
      }
    }
  }
  for (const [hex, els] of byColor) {
    const nearest = ctx.paletteNearest(hex);
    const unique = [...new Map(els.map((e) => [e.id, e])).values()];
    out.push(
      finding({
        rule: "palette",
        severity: "medium",
        title: `Color fuera de la paleta del diseño: ${hex} (en ${unique.length} elemento${unique.length === 1 ? "" : "s"} que sobra${unique.length === 1 ? "" : "n"})`,
        page: unique[0]!,
        evidence: { property: "color", expected: "un color de la paleta", actual: hex, ...(nearest ? { extra: { masCercanoDeLaPaleta: nearest.hex, deltaEPaleta: round2(nearest.deltaE) } } : {}) },
        related: unique.map((e) => e.id),
        suffix: hex,
      }),
    );
  }
  return out;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
