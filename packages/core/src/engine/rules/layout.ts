import type { SnapshotElement } from "../../snapshot/schema.ts";
import type { Finding } from "../findings.ts";
import { bottom, overlapFraction, right, round2 } from "../geometry.ts";
import type { Pair } from "../match.ts";
import { severityForPx } from "../severity.ts";
import { finding, fmt, label, px, type Ctx } from "./context.ts";

const ORIGIN = { x: 0, y: 0 } as const;

/**
 * Origen respecto al cual se mide un elemento: el interior de su contenedor (sin el borde), si es pareja;
 * si no, la página. Así la separación medida es el padding, que es lo que el desarrollador escribe en CSS.
 */
function origins(ctx: Ctx, pair: Pair): { d: { x: number; y: number }; p: { x: number; y: number }; relative: boolean } {
  const dPar = ctx.design.parent(pair.design);
  const pPar = ctx.page.parent(pair.page);
  if (dPar && pPar && !ctx.design.isRoot(dPar)) {
    const parentPair = ctx.match.byDesign.get(dPar.id);
    if (parentPair && parentPair.page.id === pPar.id) {
      const inner = (el: SnapshotElement) => ({ x: el.box.x + (el.style.border?.width ?? 0), y: el.box.y + (el.style.border?.width ?? 0) });
      return { d: inner(dPar), p: inner(pPar), relative: true };
    }
  }
  return { d: ORIGIN, p: ORIGIN, relative: false };
}

interface Delta {
  /** Desplazamiento local en x/y (código − diseño), en px. */
  dx: number;
  dy: number;
  ex: number; // esperado (diseño), local
  ey: number;
  ax: number; // obtenido (código), local
  ay: number;
  relative: boolean;
}

function localDelta(ctx: Ctx, pair: Pair): Delta {
  const o = origins(ctx, pair);
  const ex = pair.design.box.x - o.d.x;
  const ey = pair.design.box.y - o.d.y;
  const ax = pair.page.box.x - o.p.x;
  const ay = pair.page.box.y - o.p.y;
  return { dx: ax - ex, dy: ay - ey, ex, ey, ax, ay, relative: o.relative };
}

interface Neighbor {
  /** El vecino de la izquierda (o de arriba) más cercano, en el diseño. */
  a: Pair;
  b: Pair;
  /** Separación en el diseño y en el código. */
  gapD: number;
  gapP: number;
}

/** Para cada elemento, su vecino anterior más cercano en un eje, entre hermanos (mismo contenedor). */
function neighbors(ctx: Ctx, axis: "h" | "v"): Neighbor[] {
  const groups = new Map<string, Pair[]>();
  for (const pair of ctx.match.pairs) {
    const key = pair.design.parentId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), pair]);
  }
  const out: Neighbor[] = [];
  for (const group of groups.values()) {
    for (const b of group) {
      let best: { a: Pair; gap: number } | undefined;
      for (const a of group) {
        if (a === b) continue;
        const A = a.design.box;
        const B = b.design.box;
        const gap = axis === "h" ? B.x - right(A) : B.y - bottom(A);
        if (gap < -0.5 || gap > ctx.cfg.matching.maxNeighborGap) continue; // solapados o demasiado lejos: no son vecinos de flujo
        const overlap = axis === "h" ? overlapFraction(A.y, bottom(A), B.y, bottom(B)) : overlapFraction(A.x, right(A), B.x, right(B));
        if (overlap < 0.5) continue;
        if (!best || gap < best.gap) best = { a, gap };
      }
      if (best) {
        const A = best.a.page.box;
        const B = b.page.box;
        out.push({ a: best.a, b, gapD: best.gap, gapP: axis === "h" ? B.x - right(A) : B.y - bottom(A) });
      }
    }
  }
  return out;
}

const lines = (el: SnapshotElement): number => {
  const lh = el.style.lineHeight ?? (el.style.fontSize ? el.style.fontSize * 1.2 : 0);
  return lh > 0 ? Math.max(1, Math.round(el.box.height / lh)) : 1;
};

/**
 * Posición, espaciado, tamaño y forma (radio, borde, sombra, opacidad).
 *
 * La posición se mide respecto al contenedor, no a la página: si una tarjeta baja 4 px, sus hijos no se
 * reportan uno por uno. Y si el corrimiento de un elemento se explica por su vecino (cambió el espaciado o
 * el tamaño del vecino), se reporta una sola vez en la causa.
 */
export function layoutFindings(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  const t = ctx.cfg.tolerances;
  const deltas = new Map<string, Delta>(); // por id de pareja (diseño)
  for (const pair of ctx.match.pairs) deltas.set(pair.design.id, localDelta(ctx, pair));

  // El texto centrado o alineado a la derecha se corre en x si su ancho cambia: eso lo cubre tipografía.
  const skipX = (pair: Pair) => pair.design.kind === "text" && Math.abs(pair.page.box.width - pair.design.box.width) > t.size;

  // ── Espaciado entre vecinos (se calcula antes que la posición, que depende de él) ──────────────────
  const explainedX = new Set<string>();
  const explainedY = new Set<string>();
  for (const axis of ["h", "v"] as const) {
    for (const n of neighbors(ctx, axis)) {
      const gapDelta = n.gapP - n.gapD;
      const dA = deltas.get(n.a.design.id)!;
      const sizeDeltaA = axis === "h" ? n.a.page.box.width - n.a.design.box.width : n.a.page.box.height - n.a.design.box.height;
      const textChanged = (p: Pair) => p.design.kind === "text" && Math.abs(axis === "h" ? p.page.box.width - p.design.box.width : p.page.box.height - p.design.box.height) > t.size;
      const dB = deltas.get(n.b.design.id)!;
      const shiftB = axis === "h" ? dB.dx : dB.dy;
      // El hueco cambió por culpa de B: B está fuera de su sitio y el tamaño de A no lo explica.
      // (Si B está donde debe, el culpable es A —se corrió o cambió de tamaño— y el hallazgo está en A.)
      const emitted = Math.abs(gapDelta) > t.spacing && Math.abs(shiftB) > t.position && Math.abs(sizeDeltaA) <= t.size && !textChanged(n.a);
      if (emitted) {
        out.push(
          finding({
            rule: "spacing",
            severity: severityForPx(gapDelta, ctx.cfg),
            title: `Separación ${axis === "h" ? "horizontal" : "vertical"} entre ${label(n.a.design)} y ${label(n.b.design)}: diseño ${px(n.gapD)} · código ${px(n.gapP)}`,
            design: n.b.design,
            page: n.b.page,
            evidence: { property: `separación ${axis === "h" ? "horizontal" : "vertical"}`, expected: round2(n.gapD), actual: round2(n.gapP), delta: round2(gapDelta), unit: "px", extra: { vecino: n.a.design.id } },
            suffix: `${axis}:${n.a.design.id}`,
          }),
        );
      }
      // El corrimiento de B en este eje es suyo solo si no lo explican su vecino A (se corrió o cambió de tamaño
      // y B lo siguió) ni el espaciado ya reportado: en esos casos el hallazgo está en la causa.
      const followsA = Math.abs(shiftB - ((axis === "h" ? dA.dx : dA.dy) + sizeDeltaA)) <= t.position;
      const aDeviates = Math.abs(axis === "h" ? dA.dx : dA.dy) > t.position || Math.abs(sizeDeltaA) > t.size;
      if (emitted || (aDeviates && followsA)) (axis === "h" ? explainedX : explainedY).add(n.b.design.id);
    }
  }

  // ── Posición respecto al contenedor ───────────────────────────────────────
  for (const pair of ctx.match.pairs) {
    const d = deltas.get(pair.design.id)!;
    const dx = skipX(pair) || explainedX.has(pair.design.id) ? 0 : d.dx;
    const dy = explainedY.has(pair.design.id) ? 0 : d.dy;
    const worst = Math.max(Math.abs(dx), Math.abs(dy));
    if (worst <= t.position) continue;

    const parts: string[] = [];
    if (Math.abs(dx) > t.position) parts.push(d.relative ? `Padding izquierdo: diseño ${px(d.ex)} · código ${px(d.ax)}` : `Posición horizontal: diseño ${px(d.ex)} · código ${px(d.ax)}`);
    if (Math.abs(dy) > t.position) parts.push(d.relative ? `Padding superior: diseño ${px(d.ey)} · código ${px(d.ay)}` : `Posición vertical: diseño ${px(d.ey)} · código ${px(d.ay)}`);
    out.push(
      finding({
        rule: "position",
        severity: severityForPx(worst, ctx.cfg),
        title: `${label(pair.design)}: ${parts.join("; ")}`,
        design: pair.design,
        page: pair.page,
        evidence: {
          property: d.relative ? "separación interna respecto al contenedor (padding)" : "posición en la página",
          expected: { x: round2(d.ex), y: round2(d.ey) },
          actual: { x: round2(d.ax), y: round2(d.ay) },
          delta: round2(worst),
          unit: "px",
          extra: { dx: round2(dx), dy: round2(dy) },
        },
      }),
    );
  }

  // ── Tamaño ────────────────────────────────────────────────────────────────
  const textLineDelta = new Map<string, number>(); // id de página del texto → alto extra por líneas
  for (const pair of ctx.match.pairs) {
    const { design: d, page: p } = pair;
    if (d.kind === "text") {
      const ld = lines(d);
      const lp = lines(p);
      if (ld !== lp) {
        textLineDelta.set(p.id, p.box.height - d.box.height);
        out.push(
          finding({
            rule: "text-lines",
            severity: Math.abs(lp - ld) >= 2 ? "high" : "medium",
            title: `Líneas de ${label(d)}: diseño ${ld} · código ${lp}`,
            design: d,
            page: p,
            evidence: { property: "líneas de texto", expected: ld, actual: lp, delta: lp - ld },
          }),
        );
      }
    }
  }
  // Las cajas que crecen porque su texto ocupa más líneas no se reportan aparte.
  const grownByText = new Map<string, number>();
  for (const [pageId, extra] of textLineDelta) {
    for (let cur = ctx.page.byId.get(pageId); cur?.parentId; ) {
      const parent = ctx.page.byId.get(cur.parentId);
      if (!parent) break;
      grownByText.set(parent.id, (grownByText.get(parent.id) ?? 0) + extra);
      cur = parent;
    }
  }
  for (const pair of ctx.match.pairs) {
    const { design: d, page: p } = pair;
    if (d.kind === "text") continue;
    const dw = p.box.width - d.box.width;
    let dh = p.box.height - d.box.height;
    const explained = grownByText.get(p.id);
    if (explained !== undefined && Math.abs(dh) <= Math.abs(explained) + t.size) dh = 0;
    if (Math.abs(dw) <= t.size && Math.abs(dh) <= t.size) continue;
    const worst = Math.max(Math.abs(dw), Math.abs(dh));
    out.push(
      finding({
        rule: "size",
        severity: severityForPx(worst, ctx.cfg),
        title: `Tamaño de ${label(d)}: diseño ${fmt(d.box.width)}×${fmt(d.box.height)} px · código ${fmt(p.box.width)}×${fmt(p.box.height)} px`,
        design: d,
        page: p,
        evidence: { property: "tamaño", expected: { width: d.box.width, height: d.box.height }, actual: { width: p.box.width, height: p.box.height }, delta: round2(worst), unit: "px", extra: { dw: round2(dw), dh: round2(dh) } },
      }),
    );
  }

  // ── Forma: radio, borde, sombra, opacidad ─────────────────────────────────
  for (const pair of ctx.match.pairs) {
    const { design: d, page: p } = pair;
    if (d.kind === "text") continue;
    out.push(...shapeFindings(ctx, d, p));
  }
  return out;
}

/** Radio efectivo por esquina: un radio mayor que la mitad del lado menor se pinta igual que esa mitad. */
function effectiveRadii(el: SnapshotElement): [number, number, number, number] {
  const cap = Math.min(el.box.width, el.box.height) / 2;
  const r = el.style.radius;
  const four: [number, number, number, number] = r === undefined ? [0, 0, 0, 0] : typeof r === "number" ? [r, r, r, r] : r;
  return four.map((v) => Math.min(v, cap)) as [number, number, number, number];
}

const shadowText = (s: NonNullable<SnapshotElement["style"]["shadows"]>[number]): string => `${s.inset ? "inset " : ""}${fmt(s.x)} ${fmt(s.y)} ${fmt(s.blur)} ${fmt(s.spread)} ${s.color}`;

function shapeFindings(ctx: Ctx, d: SnapshotElement, p: SnapshotElement): Finding[] {
  const out: Finding[] = [];
  const t = ctx.cfg.tolerances;

  const rd = effectiveRadii(d);
  const rp = effectiveRadii(p);
  const radiusDelta = Math.max(...rd.map((v, i) => Math.abs(v - rp[i]!)));
  if (radiusDelta > t.radius) {
    out.push(
      finding({
        rule: "radius",
        severity: severityForPx(radiusDelta, ctx.cfg),
        title: `Radio de esquina de ${label(d)}: diseño ${px(Math.max(...rd))} · código ${px(Math.max(...rp))}`,
        design: d,
        page: p,
        evidence: { property: "radio de esquina", expected: rd, actual: rp, delta: round2(radiusDelta), unit: "px" },
      }),
    );
  }

  const bd = d.style.border?.width ?? 0;
  const bp = p.style.border?.width ?? 0;
  if (Math.abs(bd - bp) > t.border) {
    out.push(
      finding({
        rule: "border",
        severity: bd === 0 || bp === 0 ? "medium" : severityForPx(bd - bp, ctx.cfg),
        title: `Borde de ${label(d)}: diseño ${bd ? px(bd) : "sin borde"} · código ${bp ? px(bp) : "sin borde"}`,
        design: d,
        page: p,
        evidence: { property: "grosor del borde", expected: bd, actual: bp, delta: round2(bp - bd), unit: "px" },
      }),
    );
  }

  const sd = d.style.shadows ?? [];
  const sp = p.style.shadows ?? [];
  const same = sd.length === sp.length && sd.every((s, i) => {
    const o = sp[i]!;
    return Math.abs(s.x - o.x) <= t.shadow && Math.abs(s.y - o.y) <= t.shadow && Math.abs(s.blur - o.blur) <= t.shadow && Math.abs(s.spread - o.spread) <= t.shadow && s.color === o.color && Boolean(s.inset) === Boolean(o.inset);
  });
  if (!same) {
    out.push(
      finding({
        rule: "shadow",
        severity: sd.length !== sp.length ? "medium" : "low",
        title: `Sombra de ${label(d)}: diseño ${sd.length ? sd.map(shadowText).join(", ") : "ninguna"} · código ${sp.length ? sp.map(shadowText).join(", ") : "ninguna"}`,
        design: d,
        page: p,
        evidence: { property: "sombra", expected: sd, actual: sp },
      }),
    );
  }

  const od = d.style.opacity ?? 1;
  const op = p.style.opacity ?? 1;
  if (Math.abs(od - op) > t.opacity) {
    const delta = Math.abs(od - op);
    out.push(
      finding({
        rule: "opacity",
        severity: delta <= 0.15 ? "low" : delta <= 0.4 ? "medium" : "high",
        title: `Opacidad de ${label(d)}: diseño ${fmt(od)} · código ${fmt(op)}`,
        design: d,
        page: p,
        evidence: { property: "opacidad", expected: od, actual: op, delta: round2(op - od) },
      }),
    );
  }
  return out;
}

