import { readFileSync } from "node:fs";
import { landing } from "@paridad/fixtures";
import { assertSnapshot, type Snapshot } from "../index.ts";

const load = (path: string): Snapshot => assertSnapshot(JSON.parse(readFileSync(path, "utf8")));

/** Copia profunda para mutar sin tocar los datos compartidos. */
export const clone = <T>(x: T): T => structuredClone(x);

export const designSnapshot = (): Snapshot => clone(load(landing.designSnapshot));
export const pageSnapshot = (): Snapshot => clone(load(`${landing.dir}/page.snapshot.json`));

/** Elemento por id (falla si no existe, para que una prueba mal escrita no pase en silencio). */
export function el(s: Snapshot, id: string) {
  const e = s.elements.find((x) => x.id === id);
  if (!e) throw new Error(`No existe el elemento ${id}`);
  return e;
}

/** En la página capturada los ids son e1, e2…; este atajo busca por texto o por clase de nombre. */
export function byText(s: Snapshot, text: string) {
  const e = s.elements.find((x) => x.text?.normalized === text);
  if (!e) throw new Error(`No hay un texto «${text}»`);
  return e;
}
export function byName(s: Snapshot, name: string, nth = 0) {
  const list = s.elements.filter((x) => x.name === name);
  const e = list[nth];
  if (!e) throw new Error(`No hay un elemento ${name} #${nth}`);
  return e;
}

/** Mueve un elemento y, si se pide, todos sus descendientes. */
export function shift(s: Snapshot, id: string, dx: number, dy: number, withChildren = true): void {
  const ids = new Set([id]);
  if (withChildren) {
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of s.elements) if (e.parentId && ids.has(e.parentId) && !ids.has(e.id)) (ids.add(e.id), (grew = true));
    }
  }
  for (const e of s.elements) if (ids.has(e.id)) ((e.box.x += dx), (e.box.y += dy));
}

export function remove(s: Snapshot, id: string): void {
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of s.elements) if (e.parentId && doomed.has(e.parentId) && !doomed.has(e.id)) (doomed.add(e.id), (grew = true));
  }
  s.elements = s.elements.filter((e) => !doomed.has(e.id));
}
