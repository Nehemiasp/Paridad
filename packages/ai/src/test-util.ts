import { readFileSync } from "node:fs";
import { assertSnapshot, compare, type Report, type Snapshot } from "@paridad/core";
import { landing } from "@paridad/fixtures";

const load = (p: string): Snapshot => assertSnapshot(JSON.parse(readFileSync(p, "utf8")));
export const designSnapshot = (): Snapshot => structuredClone(load(landing.designSnapshot));
export const pageSnapshot = (): Snapshot => structuredClone(load(`${landing.dir}/page.snapshot.json`));

/** Un reporte real con varios hallazgos relacionados: el padding de las tres tarjetas pasa de 16 a 20 px. */
export function paddingReport(): Report {
  const design = designSnapshot();
  const page = pageSnapshot();
  const cards = page.elements.filter((e) => e.name === "article.card");
  for (const card of cards) for (const e of page.elements) if (e.parentId === card.id) (e.box.x += 4, (e.box.y += 4));
  return compare(design, page, { now: () => new Date("2026-11-08T00:00:00Z") });
}

export const png = (): Buffer => readFileSync(landing.designImage);
