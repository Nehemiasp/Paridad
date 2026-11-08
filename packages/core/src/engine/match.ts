import type { Box, SnapshotElement } from "../snapshot/schema.ts";
import type { ResolvedConfig } from "./config.ts";
import { PAGE_ROOT_ID, SnapshotIndex, centerDistance, iou } from "./geometry.ts";
import { deltaE2000 } from "./color.ts";
import { textSimilarity } from "./similarity.ts";

/** Desde esta similitud un texto se considera «el mismo» sin importar dónde esté. */
const NEAR_EXACT = 0.95;

export interface Pair {
  design: SnapshotElement;
  page: SnapshotElement;
  /** 0–1 para textos (similitud); puntaje de caja para el resto. */
  score: number;
}

export interface UnmatchedRoot {
  element: SnapshotElement;
  /** Descendientes que también quedaron sin pareja y se resumen en este hallazgo. */
  descendants: SnapshotElement[];
}

export interface MatchResult {
  pairs: Pair[];
  /** design id → page element */
  byDesign: Map<string, Pair>;
  /** page id → design element */
  byPage: Map<string, Pair>;
  /** En el diseño y no en el código (solo las raíces de cada subárbol). */
  missing: UnmatchedRoot[];
  /** En el código y no en el diseño (solo las raíces de cada subárbol). */
  extra: UnmatchedRoot[];
  /** Todos los sin pareja, incluidos los descendientes (para reglas que los necesitan). */
  unmatchedDesign: SnapshotElement[];
  unmatchedPage: SnapshotElement[];
}

/**
 * Empareja los elementos del diseño con los del código.
 *
 * 1. Textos: por contenido (similitud de Levenshtein sin mayúsculas) y cercanía de posición; asignación
 *    voraz del mejor puntaje, de modo que los textos repetidos se resuelven por posición.
 * 2. Cajas e imágenes: por IoU de sus rectángulos, más bonos si sus padres son pareja o si contienen
 *    textos que ya son pareja; de arriba hacia abajo en la jerarquía del diseño.
 */
export function matchElements(dIdx: SnapshotIndex, pIdx: SnapshotIndex, cfg: ResolvedConfig): MatchResult {
  const dEls = dIdx.comparable();
  const pEls = pIdx.comparable();
  const byDesign = new Map<string, Pair>();
  const byPage = new Map<string, Pair>();
  const pairs: Pair[] = [];

  const link = (design: SnapshotElement, page: SnapshotElement, score: number) => {
    const pair = { design, page, score };
    pairs.push(pair);
    byDesign.set(design.id, pair);
    byPage.set(page.id, pair);
  };

  // ── 1. Textos ─────────────────────────────────────────────────────────────
  const dText = dEls.filter((e) => e.kind === "text" && e.text);
  const pText = pEls.filter((e) => e.kind === "text" && e.text);
  const textCandidates: { d: SnapshotElement; p: SnapshotElement; sim: number; rank: number }[] = [];
  for (const d of dText) {
    for (const p of pText) {
      const sim = textSimilarity(d.text!.normalized, p.text!.normalized);
      if (sim < cfg.matching.minTextSimilarity) continue;
      const dist = centerDistance(d.box, p.box);
      // Un texto casi idéntico se empareja a cualquier distancia (una tarjeta que se reacomoda sigue siendo
      // la misma tarjeta); uno solo parecido debe estar cerca, para no emparejar textos distintos al azar.
      if (sim < NEAR_EXACT && dist > cfg.matching.maxDistance) continue;
      textCandidates.push({ d, p, sim, rank: sim - 0.5 * Math.min(1, dist / Math.max(cfg.matching.maxDistance, 1)) });
    }
  }
  const order = (a: SnapshotElement, b: SnapshotElement) => a.z - b.z;
  textCandidates.sort((a, b) => b.rank - a.rank || order(a.d, b.d) || order(a.p, b.p));
  for (const c of textCandidates) {
    if (byDesign.has(c.d.id) || byPage.has(c.p.id)) continue;
    link(c.d, c.p, c.sim);
  }

  // ── 2. Cajas e imágenes, de arriba hacia abajo ────────────────────────────
  const dBoxes = dEls.filter((e) => e.kind !== "text").sort((a, b) => dIdx.depth(a) - dIdx.depth(b) || order(a, b));
  const pBoxes = pEls.filter((e) => e.kind !== "text");

  // Anclas: una caja que contiene textos ya emparejados «pertenece» a la caja que contiene a sus parejas.
  // textPartners(d): ids de las cajas de la página que contienen las parejas de los textos de d.
  // textOrigins(p): ids de las cajas del diseño que contienen las parejas de los textos de p.
  const textPartners = new Map<string, Set<string>>();
  const textOrigins = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => m.set(k, (m.get(k) ?? new Set<string>()).add(v));
  for (const t of pairs) {
    if (t.design.parentId && t.page.parentId) {
      add(textPartners, t.design.parentId, t.page.parentId);
      add(textOrigins, t.page.parentId, t.design.parentId);
    }
  }

  /** Posición de un elemento respecto al interior de su padre, si el padre existe y no es la raíz. */
  const local = (el: SnapshotElement, idx: SnapshotIndex): Box | undefined => {
    const par = idx.parent(el);
    return par && !idx.isRoot(par) ? { x: el.box.x - par.box.x, y: el.box.y - par.box.y, width: el.box.width, height: el.box.height } : undefined;
  };

  const levels = [...new Set(dBoxes.map((e) => dIdx.depth(e)))].sort((a, b) => a - b);
  for (const level of levels) {
    const cands: { d: SnapshotElement; p: SnapshotElement; score: number }[] = [];
    for (const d of dBoxes.filter((e) => dIdx.depth(e) === level && !byDesign.has(e.id))) {
      for (const p of pBoxes) {
        if (byPage.has(p.id) || p.kind !== d.kind) continue;
        const parentMatched = d.parentId !== null && p.parentId !== null && (d.parentId === PAGE_ROOT_ID ? p.parentId === PAGE_ROOT_ID : byDesign.get(d.parentId)?.page.id === p.parentId);

        // Superposición global; y, si los padres son pareja, también la local (dentro del padre): así una caja que se
        // movió más que su propio tamaño porque su contenedor se movió sigue emparejándose con su gemela.
        let overlap = iou(d.box, p.box);
        if (parentMatched) {
          const ld = local(d, dIdx);
          const lp = local(p, pIdx);
          if (ld && lp) overlap = Math.max(overlap, iou(ld, lp));
        }

        const partners = textPartners.get(d.id);
        const origins = textOrigins.get(p.id);
        const anchored = partners?.has(p.id) === true;
        // Los textos que ya son pareja pesan más que la geometría: si p contiene textos que vienen de otra caja del
        // diseño (o d tiene textos que están en otra caja de la página), no son la misma caja aunque se solapen.
        const conflict = (partners && partners.size > 0 && !anchored) || (origins && origins.size > 0 && !origins.has(d.id));
        if (overlap < 0.05 && !anchored) continue;

        const parentBonus = parentMatched ? 0.25 : 0;
        const styleBonus = d.style.background && p.style.background && deltaE2000(d.style.background, p.style.background) < cfg.tolerances.colorDeltaE ? 0.1 : 0;
        const score = overlap + (anchored ? 0.6 : 0) - (conflict ? 0.6 : 0) + parentBonus + styleBonus;
        if (score >= cfg.matching.minBoxScore) cands.push({ d, p, score });
      }
    }
    cands.sort((a, b) => b.score - a.score || order(a.d, b.d) || order(a.p, b.p));
    for (const c of cands) {
      if (byDesign.has(c.d.id) || byPage.has(c.p.id)) continue;
      link(c.d, c.p, c.score);
    }
  }

  // ── 3. Sin pareja: solo se reporta la raíz de cada subárbol ───────────────
  const unmatchedDesign = dEls.filter((e) => !byDesign.has(e.id));
  const unmatchedPage = pEls.filter((e) => !byPage.has(e.id));

  const rollup = (unmatched: SnapshotElement[], idx: SnapshotIndex): UnmatchedRoot[] => {
    const ids = new Set(unmatched.map((e) => e.id));
    const roots = unmatched.filter((e) => e.parentId === null || !ids.has(e.parentId));
    return roots.map((element) => ({ element, descendants: idx.descendants(element.id).filter((d) => ids.has(d.id)) }));
  };

  return {
    pairs,
    byDesign,
    byPage,
    missing: rollup(unmatchedDesign, dIdx),
    extra: rollup(unmatchedPage, pIdx),
    unmatchedDesign,
    unmatchedPage,
  };
}
