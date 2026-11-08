import type { SnapshotElement } from "../snapshot/schema.ts";
import type { ResolvedConfig } from "./config.ts";
import { PAGE_ROOT_ID, SnapshotIndex, centerDistance, iou } from "./geometry.ts";
import { deltaE2000 } from "./color.ts";
import { textSimilarity } from "./similarity.ts";

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
      if (dist > cfg.matching.maxDistance) continue;
      textCandidates.push({ d, p, sim, rank: sim - 0.5 * Math.min(1, dist / cfg.matching.maxDistance) });
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

  // Cajas que contienen un texto ya emparejado: anclas para sus padres.
  const anchorPairs = new Set<string>();
  for (const t of pairs) {
    if (t.design.parentId && t.page.parentId) anchorPairs.add(`${t.design.parentId}|${t.page.parentId}`);
  }

  const levels = [...new Set(dBoxes.map((e) => dIdx.depth(e)))].sort((a, b) => a - b);
  for (const level of levels) {
    const cands: { d: SnapshotElement; p: SnapshotElement; score: number }[] = [];
    for (const d of dBoxes.filter((e) => dIdx.depth(e) === level && !byDesign.has(e.id))) {
      for (const p of pBoxes) {
        if (byPage.has(p.id) || p.kind !== d.kind) continue;
        const overlap = iou(d.box, p.box);
        const anchor = anchorPairs.has(`${d.id}|${p.id}`) ? 0.3 : 0;
        if (overlap < 0.05 && anchor === 0) continue;
        const parentMatched = d.parentId !== null && p.parentId !== null && (d.parentId === PAGE_ROOT_ID ? p.parentId === PAGE_ROOT_ID : byDesign.get(d.parentId)?.page.id === p.parentId);
        const parentBonus = parentMatched ? 0.25 : 0;
        const styleBonus = d.style.background && p.style.background && deltaE2000(d.style.background, p.style.background) < cfg.tolerances.colorDeltaE ? 0.1 : 0;
        const score = overlap + anchor + parentBonus + styleBonus;
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
