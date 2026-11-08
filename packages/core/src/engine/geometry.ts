import type { Box, Snapshot, SnapshotElement } from "../snapshot/schema.ts";

export const PAGE_ROOT_ID = "page";

export const area = (b: Box): number => b.width * b.height;
export const right = (b: Box): number => b.x + b.width;
export const bottom = (b: Box): number => b.y + b.height;
export const center = (b: Box): { x: number; y: number } => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

export function centerDistance(a: Box, b: Box): number {
  const ca = center(a);
  const cb = center(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

export function intersectionArea(a: Box, b: Box): number {
  const w = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function iou(a: Box, b: Box): number {
  const inter = intersectionArea(a, b);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** Cuánto se solapan dos intervalos, como fracción del más corto (0–1). */
export function overlapFraction(a0: number, a1: number, b0: number, b1: number): number {
  const o = Math.min(a1, b1) - Math.max(a0, b0);
  const shortest = Math.min(a1 - a0, b1 - b0);
  return o > 0 && shortest > 0 ? o / shortest : 0;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Índice de un snapshot para consultar padres y profundidad. */
export class SnapshotIndex {
  readonly byId = new Map<string, SnapshotElement>();
  readonly ignoreRects: Box[];
  private readonly depths = new Map<string, number>();

  /**
   * `extraIgnoreRects`: zonas a ignorar del otro lado de la comparación. Un fecha dinámica en la página
   * tiene un marcador en el diseño en el mismo lugar; hay que ignorar ambos.
   */
  constructor(
    readonly snapshot: Snapshot,
    extraIgnoreRects: Box[] = [],
  ) {
    for (const e of snapshot.elements) this.byId.set(e.id, e);
    this.ignoreRects = [...snapshot.ignore.flatMap((z) => ("rect" in z ? [z.rect] : [])), ...extraIgnoreRects];
  }

  get root(): SnapshotElement | undefined {
    return this.byId.get(PAGE_ROOT_ID) ?? this.snapshot.elements.find((e) => e.parentId === null);
  }

  parent(e: SnapshotElement): SnapshotElement | undefined {
    return e.parentId === null ? undefined : this.byId.get(e.parentId);
  }

  depth(e: SnapshotElement): number {
    const hit = this.depths.get(e.id);
    if (hit !== undefined) return hit;
    const p = this.parent(e);
    const d = p ? this.depth(p) + 1 : 0;
    this.depths.set(e.id, d);
    return d;
  }

  isRoot(e: SnapshotElement): boolean {
    return e.id === this.root?.id;
  }

  /** ¿Cae por completo dentro de una zona a ignorar? */
  isIgnored(e: SnapshotElement): boolean {
    return this.ignoreRects.some(
      (z) => e.box.x >= z.x - 0.5 && e.box.y >= z.y - 0.5 && right(e.box) <= right(z) + 0.5 && bottom(e.box) <= bottom(z) + 0.5,
    );
  }

  /** Elementos que se comparan: todos menos la raíz y los ignorados. */
  comparable(): SnapshotElement[] {
    return this.snapshot.elements.filter((e) => !this.isRoot(e) && !this.isIgnored(e));
  }

  /** Descendientes (directos e indirectos) de un elemento. */
  descendants(id: string): SnapshotElement[] {
    const out: SnapshotElement[] = [];
    const kids = new Map<string, SnapshotElement[]>();
    for (const e of this.snapshot.elements) {
      if (e.parentId) kids.set(e.parentId, [...(kids.get(e.parentId) ?? []), e]);
    }
    const stack = [...(kids.get(id) ?? [])];
    while (stack.length) {
      const e = stack.pop()!;
      out.push(e);
      stack.push(...(kids.get(e.id) ?? []));
    }
    return out;
  }
}
