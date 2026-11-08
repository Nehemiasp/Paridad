import type { Finding } from "@paridad/core";
import { z } from "zod";

/** Lo que se le pide devolver al modelo (esquema simple: las salidas estructuradas no admiten opcionales). */
export const ModelOutputSchema = z.object({
  groups: z.array(
    z.object({
      title: z.string(),
      explanation: z.string(),
      finding_ids: z.array(z.string()),
      /** Vacío si no hay una corrección exacta que la evidencia respalde. */
      css_fix: z.string(),
    }),
  ),
  discarded: z.array(z.object({ finding_id: z.string(), reason: z.string() })),
});
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

export interface GroundedGroup {
  title: string;
  explanation: string;
  findingIds: string[];
  cssFix: string;
}

export interface GroundResult {
  groups: GroundedGroup[];
  discarded: { findingId: string; reason: string }[];
  rejected: { what: string; reason: string }[];
}

/** Reglas que nunca se pueden descartar como ruido: son lo más grave o lo más objetivo. */
const NEVER_DISCARD = new Set(["missing", "extra", "font-not-loaded", "canvas-size", "page-overflow"]);
/** Si la IA descarta más que esta fracción de los hallazgos, se desconfía de todos sus descartes. */
const MAX_DISCARD_FRACTION = 0.5;

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const NUMBER = /-?\d+(?:[.,]\d+)?/g;

const norm = (n: string): string => String(Number(n.replace(",", ".")));

/** Números de un texto, sin contar los de dentro de colores hexadecimales ni de ids. */
export function numbersIn(text: string): Set<string> {
  const cleaned = text.replace(HEX, " ");
  return new Set([...cleaned.matchAll(NUMBER)].map((m) => norm(m[0])));
}

export function hexesIn(text: string): Set<string> {
  return new Set([...text.matchAll(HEX)].map((m) => m[0].toLowerCase()));
}

/** Todo lo que un hallazgo permite decir: su texto y su evidencia (con los números redondeados que se muestran). */
function evidenceText(f: Finding): string {
  const parts = [f.title, f.rule, JSON.stringify(f.evidence)];
  for (const ref of [f.design, f.page]) {
    if (ref) parts.push(ref.name ?? "", String(ref.box.x), String(ref.box.y), String(ref.box.width), String(ref.box.height));
  }
  if (f.region) parts.push(String(f.region.box.x), String(f.region.box.y), String(f.region.box.width), String(f.region.box.height));
  return parts.join(" ");
}

/** Números y colores que el texto del modelo no puede usar porque no salen de los hallazgos que cita. */
export function ungrounded(text: string, cited: Finding[]): { numbers: string[]; colors: string[] } {
  const allowedText = cited.map(evidenceText).join(" ");
  const allowedNums = numbersIn(allowedText);
  // Permitido también: la cantidad de hallazgos que resume el grupo y cuántos hay de cada lado.
  allowedNums.add(String(cited.length));
  for (let i = 0; i <= cited.length; i++) allowedNums.add(String(i));
  const allowedHex = hexesIn(allowedText);
  // Un número también es válido si es la diferencia entre dos cifras de lo ESPERADO y lo OBTENIDO de un mismo hallazgo
  // (p. ej. «4 px» entre 16 y 20). No se admiten diferencias entre cifras cualesquiera: sería demasiado permisivo.
  const diffs = new Set<string>();
  for (const f of cited) {
    const nums = [...numbersIn(JSON.stringify([f.evidence.expected, f.evidence.actual]))].map(Number);
    for (const a of nums) for (const b of nums) diffs.add(String(Math.round(Math.abs(a - b) * 100) / 100));
  }
  return {
    numbers: [...numbersIn(text)].filter((n) => !allowedNums.has(n) && !diffs.has(n)),
    colors: [...hexesIn(text)].filter((c) => !allowedHex.has(c)),
  };
}

/**
 * Valida lo que devolvió el modelo contra los hallazgos reales. La IA no inventa hallazgos: solo agrupa, descarta
 * ruido y redacta, y cada frase debe apoyarse en hallazgos que existen y en cifras de su evidencia.
 *
 * - Un grupo con ids que no existen, repetidos, o con menos de 2 hallazgos válidos, se rechaza.
 * - Un grupo con números o colores que no están en la evidencia de lo que cita, se rechaza.
 * - No se pueden descartar los hallazgos críticos ni los de presencia o fuente caída.
 * - Si descarta demasiado, se rechazan todos sus descartes.
 * Lo rechazado no se pierde: los hallazgos quedan como los redactó el motor.
 */
export function ground(output: ModelOutput, findings: Finding[]): GroundResult {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const result: GroundResult = { groups: [], discarded: [], rejected: [] };
  const used = new Set<string>();

  for (const g of output.groups) {
    const label = `grupo «${g.title.slice(0, 50)}»`;
    const ids = g.finding_ids;
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) {
      result.rejected.push({ what: label, reason: `cita hallazgos que no existen: ${unknown.slice(0, 3).join(", ")}` });
      continue;
    }
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i || used.has(id));
    if (dup.length) {
      result.rejected.push({ what: label, reason: `repite hallazgos que ya están en otro grupo: ${[...new Set(dup)].slice(0, 3).join(", ")}` });
      continue;
    }
    if (ids.length < 2) {
      result.rejected.push({ what: label, reason: "un grupo debe resumir al menos 2 hallazgos" });
      continue;
    }
    if (!g.title.trim() || !g.explanation.trim()) {
      result.rejected.push({ what: label, reason: "falta el título o la explicación" });
      continue;
    }
    const cited = ids.map((id) => byId.get(id)!);
    const bad = ungrounded(`${g.title} ${g.explanation} ${g.css_fix}`, cited);
    if (bad.numbers.length || bad.colors.length) {
      const what = [...bad.numbers.map((n) => `la cifra ${n}`), ...bad.colors.map((c) => `el color ${c}`)].slice(0, 4).join(", ");
      result.rejected.push({ what: label, reason: `usa ${what}, que no está en la evidencia de los hallazgos que cita` });
      continue;
    }
    for (const id of ids) used.add(id);
    result.groups.push({ title: g.title.trim(), explanation: g.explanation.trim(), findingIds: ids, cssFix: g.css_fix.trim() });
  }

  const seen = new Set<string>();
  const candidates: { findingId: string; reason: string }[] = [];
  for (const d of output.discarded) {
    const f = byId.get(d.finding_id);
    if (!f) {
      result.rejected.push({ what: `descarte de ${d.finding_id}`, reason: "ese hallazgo no existe" });
    } else if (seen.has(d.finding_id)) {
      result.rejected.push({ what: `descarte de ${d.finding_id}`, reason: "repetido" });
    } else if (f.severity === "critical" || NEVER_DISCARD.has(f.rule)) {
      result.rejected.push({ what: `descarte de ${d.finding_id}`, reason: `no se pueden descartar hallazgos ${f.severity === "critical" ? "críticos" : `de la regla «${f.rule}»`}` });
    } else if (!d.reason.trim()) {
      result.rejected.push({ what: `descarte de ${d.finding_id}`, reason: "no explica por qué es ruido" });
    } else if (used.has(d.finding_id)) {
      result.rejected.push({ what: `descarte de ${d.finding_id}`, reason: "ya está en un grupo" });
    } else {
      seen.add(d.finding_id);
      candidates.push({ findingId: d.finding_id, reason: d.reason.trim() });
    }
  }
  if (findings.length > 0 && candidates.length / findings.length > MAX_DISCARD_FRACTION) {
    result.rejected.push({ what: `${candidates.length} descartes`, reason: `descarta más de la mitad de los hallazgos (${candidates.length} de ${findings.length}); se desconfía de todos` });
  } else {
    result.discarded = candidates;
  }
  return result;
}
