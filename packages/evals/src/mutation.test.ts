import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { landing } from "@paridad/fixtures";
import { BUILTIN_MUTATIONS } from "./builtin.ts";
import { MutationError, MutationSchema, loadMutationsFromDir, materialize } from "./mutation.ts";

const valid = {
  id: "ejemplo-uno",
  description: "Una mutación de ejemplo para las pruebas.",
  errorType: "padding",
  edits: [{ file: "styles.css", find: "padding: 16px;\n  background: var(--white);", replace: "padding: 20px;\n  background: var(--white);" }],
  expected: [{ rule: "position", designId: "tarjeta-1-titulo", severity: "low" }],
};

describe("MutationSchema", () => {
  it("acepta una mutación válida y completa los valores por defecto", () => {
    const m = MutationSchema.parse(valid);
    expect(m.acceptable).toEqual([]);
    expect(m.hard).toBe(false);
  });
  it("rechaza ids que no son minúsculas con guiones, reglas inexistentes y descripciones vacías", () => {
    expect(MutationSchema.safeParse({ ...valid, id: "Mala Id" }).success).toBe(false);
    expect(MutationSchema.safeParse({ ...valid, expected: [{ rule: "inventada" }] }).success).toBe(false);
    expect(MutationSchema.safeParse({ ...valid, description: "corta" }).success).toBe(false);
    expect(MutationSchema.safeParse({ ...valid, edits: [{ file: "otro.js", find: "a", replace: "b" }] }).success).toBe(false);
  });
});

describe("materialize", () => {
  it("copia la página y aplica las ediciones sin tocar la original", () => {
    const dir = materialize(landing.pageDir, MutationSchema.parse(valid));
    expect(readFileSync(join(dir, "styles.css"), "utf8")).toContain("padding: 20px;\n  background: var(--white);");
    expect(readFileSync(landing.pageStyles, "utf8")).toContain("padding: 16px;\n  background: var(--white);");
    expect(readFileSync(join(dir, "fonts", "LICENSE-instrument-sans.txt"), "utf8")).toContain("Instrument Sans");
  });
  it("exige que el texto a buscar aparezca exactamente una vez", () => {
    const none = MutationSchema.parse({ ...valid, edits: [{ file: "styles.css", find: "no existe en el css", replace: "x" }] });
    expect(() => materialize(landing.pageDir, none)).toThrow(/aparece 0 veces/);
    const many = MutationSchema.parse({ ...valid, edits: [{ file: "styles.css", find: "border-radius", replace: "x" }] });
    expect(() => materialize(landing.pageDir, many)).toThrow(MutationError);
  });
  it("aplica varias ediciones al mismo archivo", () => {
    const m = MutationSchema.parse({ ...valid, edits: [valid.edits[0], { file: "styles.css", find: "gap: 24px;", replace: "gap: 28px;" }] });
    const css = readFileSync(join(materialize(landing.pageDir, m), "styles.css"), "utf8");
    expect(css).toContain("padding: 20px;");
    expect(css).toContain("gap: 28px;");
  });
});

describe("loadMutationsFromDir", () => {
  it("carga las válidas y rechaza, con motivo, las inválidas y los JSON rotos", () => {
    const dir = mkdtempSync(join(tmpdir(), "muts-"));
    writeFileSync(join(dir, "a.json"), JSON.stringify(valid));
    writeFileSync(join(dir, "b.json"), JSON.stringify([{ ...valid, id: "dos-ids" }, { ...valid, id: "MAL" }]));
    writeFileSync(join(dir, "c.json"), "{ no es json");
    writeFileSync(join(dir, "ignorado.txt"), "x");
    const r = loadMutationsFromDir(dir);
    expect(r.mutations.map((m) => m.id)).toEqual(["ejemplo-uno", "dos-ids"]);
    expect(r.rejected.map((x) => x.source)).toEqual(["b.json[1]", "c.json"]);
    expect(r.rejected[0]!.reason).toContain("id");
    expect(r.rejected[1]!.reason).toContain("JSON");
  });
  it("una carpeta que no existe da una lista vacía", () => {
    expect(loadMutationsFromDir(join(tmpdir(), "no-existe-xyz"))).toEqual({ mutations: [], rejected: [] });
  });
});

describe("mutaciones incorporadas", () => {
  it("tienen ids únicos y cubren al menos 15 tipos de error más el ruido", () => {
    const ids = BUILTIN_MUTATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(BUILTIN_MUTATIONS.map((m) => m.errorType)).size).toBeGreaterThanOrEqual(16);
    expect(BUILTIN_MUTATIONS.filter((m) => m.errorType === "ruido").length).toBeGreaterThanOrEqual(3);
  });
  it("todas aplican a la página actual (si falla una, la página o la mutación quedó desactualizada)", () => {
    for (const m of BUILTIN_MUTATIONS) expect(() => materialize(landing.pageDir, m), m.id).not.toThrow();
  });
  it("las de ruido no esperan nada; las demás esperan algo", () => {
    for (const m of BUILTIN_MUTATIONS) expect(m.expected.length === 0, m.id).toBe(m.errorType === "ruido");
  });
});
