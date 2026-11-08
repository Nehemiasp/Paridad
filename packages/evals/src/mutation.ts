import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { RuleIdSchema, SeveritySchema } from "@paridad/core";

/** Qué debe encontrar Paridad. Se compara contra los hallazgos por regla y, opcionalmente, por elemento y severidad. */
export const ExpectationSchema = z.object({
  rule: RuleIdSchema,
  /** Id del elemento en el DISEÑO (p. ej. `tarjeta-1-titulo`). */
  designId: z.string().optional(),
  /** Expresión regular sobre el id del diseño (p. ej. `^tarjeta-\\d$`). */
  designIdPattern: z.string().optional(),
  /** Texto normalizado del elemento de la PÁGINA (para lo que no existe en el diseño). */
  pageText: z.string().optional(),
  /** Severidad que debe tener según el criterio de CLAUDE.md; una o varias aceptables. */
  severity: z.union([SeveritySchema, z.array(SeveritySchema).min(1)]).optional(),
  note: z.string().optional(),
});
export type Expectation = z.infer<typeof ExpectationSchema>;

/** Efecto colateral legítimo: un hallazgo así NO cuenta como falso positivo (la severidad no se evalúa). */
export const AcceptableSchema = ExpectationSchema.omit({ severity: true, note: true });
export type Acceptable = z.infer<typeof AcceptableSchema>;

export const EditSchema = z.object({
  file: z.enum(["styles.css", "index.html"]),
  /** Texto exacto que debe aparecer UNA sola vez en el archivo. */
  find: z.string().min(1),
  replace: z.string(),
});
export type Edit = z.infer<typeof EditSchema>;

/**
 * Una mutación: errores controlados y conocidos sobre la página de ejemplo.
 * Es solo datos (ediciones de buscar y reemplazar): así un subagente puede proponerlas sin ejecutar código.
 */
export const MutationSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use minúsculas y guiones, p. ej. padding-tarjetas-20"),
  description: z.string().min(10),
  /** Tipo de error; las métricas se agrupan por él. `ruido` = cambio que NO debe reportarse. */
  errorType: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  edits: z.array(EditSchema),
  expected: z.array(ExpectationSchema),
  acceptable: z.array(AcceptableSchema).default([]),
  /** Caso difícil: se espera que a veces falle y se documenta por qué. */
  hard: z.boolean().default(false),
});
export type Mutation = z.infer<typeof MutationSchema>;
export type MutationInput = z.input<typeof MutationSchema>;

export class MutationError extends Error {}

/** Copia la página a una carpeta temporal y le aplica las ediciones. Devuelve la carpeta. */
export function materialize(pageDir: string, mutation: Mutation): string {
  const dir = mkdtempSync(join(tmpdir(), `paridad-mut-${mutation.id}-`));
  cpSync(pageDir, dir, { recursive: true });
  const cache = new Map<string, string>();
  for (const [i, edit] of mutation.edits.entries()) {
    const path = join(dir, edit.file);
    if (!existsSync(path)) throw new MutationError(`${mutation.id}: no existe ${edit.file}.`);
    const text = cache.get(edit.file) ?? readFileSync(path, "utf8");
    const count = text.split(edit.find).length - 1;
    if (count !== 1) {
      throw new MutationError(`${mutation.id}: la edición ${i + 1} busca un texto que aparece ${count} veces en ${edit.file} (debe ser exactamente 1): «${edit.find.slice(0, 60)}»`);
    }
    cache.set(edit.file, text.replace(edit.find, () => edit.replace));
  }
  for (const [file, text] of cache) writeFileSync(join(dir, file), text);
  return dir;
}

export interface LoadedMutations {
  mutations: Mutation[];
  /** Archivos o entradas que no pasaron la validación (con el motivo), para no ocultarlos. */
  rejected: { source: string; reason: string }[];
}

/** Carga las mutaciones propuestas (`*.json`, una o un arreglo por archivo) y las valida. */
export function loadMutationsFromDir(dir: string): LoadedMutations {
  const out: LoadedMutations = { mutations: [], rejected: [] };
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      out.rejected.push({ source: file, reason: "no es un JSON válido" });
      continue;
    }
    for (const [i, item] of (Array.isArray(data) ? data : [data]).entries()) {
      const r = MutationSchema.safeParse(item, { error: z.locales.es().localeError });
      const source = Array.isArray(data) ? `${file}[${i}]` : file;
      if (r.success) out.mutations.push(r.data);
      else out.rejected.push({ source, reason: r.error.issues.map((x) => `${x.path.join(".") || "(raíz)"}: ${x.message}`).join("; ") });
    }
  }
  return out;
}
