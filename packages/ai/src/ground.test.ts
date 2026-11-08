import { describe, expect, it } from "vitest";
import type { Finding } from "@paridad/core";
import { ground, hexesIn, numbersIn, ungrounded, type ModelOutput } from "./ground.ts";

const f = (id: string, over: Partial<Finding> = {}): Finding => ({
  id,
  rule: "position",
  category: "posición",
  severity: "low",
  title: "Padding izquierdo: diseño 16 px · código 20 px",
  evidence: { property: "padding", expected: 16, actual: 20, delta: 4, unit: "px" },
  design: { elementId: "d", box: { x: 101, y: 645, width: 239.27, height: 28 } },
  ...over,
});
const out = (over: Partial<ModelOutput> = {}): ModelOutput => ({ groups: [], discarded: [], ...over });
const group = (ids: string[], over: Partial<ModelOutput["groups"][number]> = {}) => ({ title: "Padding de las tarjetas", explanation: "El padding es de 20 px y debería ser de 16 px.", finding_ids: ids, css_fix: "padding: 16px;", ...over });

describe("números y colores", () => {
  it("extrae números (con coma o punto) sin contar los de dentro de colores", () => {
    expect([...numbersIn("de 16 px a 20,5 px, color #043565 y -3")].sort()).toEqual(["-3", "16", "20.5"]);
    expect([...hexesIn("usa #043565 y #FFF")].sort()).toEqual(["#043565", "#fff"]);
  });
  it("una cifra es válida si sale de la evidencia, de la diferencia entre dos cifras de ella, o del conteo del grupo", () => {
    const cited = [f("a"), f("b")];
    expect(ungrounded("de 16 px a 20 px, 4 px de diferencia, 2 hallazgos", cited)).toEqual({ numbers: [], colors: [] });
    expect(ungrounded("son 37 px", cited).numbers).toEqual(["37"]);
  });
  it("un color debe aparecer en la evidencia", () => {
    const cited = [f("a", { evidence: { property: "color", expected: "#043565", actual: "#073d72" } })];
    expect(ungrounded("de #043565 a #073d72", cited).colors).toEqual([]);
    expect(ungrounded("use #ff0000", cited).colors).toEqual(["#ff0000"]);
  });
});

describe("ground: grupos", () => {
  const findings = [f("a"), f("b"), f("c")];
  it("acepta un grupo que cita hallazgos reales y usa solo sus cifras", () => {
    const r = ground(out({ groups: [group(["a", "b"])] }), findings);
    expect(r.rejected).toEqual([]);
    expect(r.groups).toEqual([{ title: "Padding de las tarjetas", explanation: "El padding es de 20 px y debería ser de 16 px.", findingIds: ["a", "b"], cssFix: "padding: 16px;" }]);
  });
  it("rechaza un grupo que cita un hallazgo que no existe (la IA no inventa hallazgos)", () => {
    const r = ground(out({ groups: [group(["a", "zzz"])] }), findings);
    expect(r.groups).toEqual([]);
    expect(r.rejected[0]).toMatchObject({ reason: expect.stringContaining("no existen: zzz") });
  });
  it("rechaza hallazgos repetidos, dentro del grupo o entre grupos", () => {
    expect(ground(out({ groups: [group(["a", "a"])] }), findings).rejected[0]!.reason).toContain("repite");
    const r = ground(out({ groups: [group(["a", "b"]), group(["b", "c"])] }), findings);
    expect(r.groups).toHaveLength(1);
    expect(r.rejected[0]!.reason).toContain("repite");
  });
  it("un grupo necesita al menos 2 hallazgos y título y explicación", () => {
    expect(ground(out({ groups: [group(["a"])] }), findings).rejected[0]!.reason).toContain("al menos 2");
    expect(ground(out({ groups: [group(["a", "b"], { explanation: " " })] }), findings).rejected[0]!.reason).toContain("falta");
  });
  it("rechaza cifras que no están en la evidencia (p. ej. un «37 px» inventado)", () => {
    const r = ground(out({ groups: [group(["a", "b"], { explanation: "El padding está 37 px más abajo." })] }), findings);
    expect(r.groups).toEqual([]);
    expect(r.rejected[0]!.reason).toContain("la cifra 37");
  });
  it("rechaza una corrección CSS con valores que la evidencia no respalda", () => {
    const r = ground(out({ groups: [group(["a", "b"], { css_fix: "padding: 24px;" })] }), findings);
    expect(r.rejected[0]!.reason).toContain("la cifra 24");
  });
  it("rechaza colores inventados", () => {
    const r = ground(out({ groups: [group(["a", "b"], { css_fix: "color: #ff00aa;" })] }), findings);
    expect(r.rejected[0]!.reason).toContain("el color #ff00aa");
  });
  it("un grupo rechazado no se lleva a los demás", () => {
    const r = ground(out({ groups: [group(["a", "zzz"]), group(["b", "c"])] }), findings);
    expect(r.groups.map((g) => g.findingIds)).toEqual([["b", "c"]]);
  });
});

describe("ground: descartes", () => {
  const findings = [f("a"), f("b"), f("c"), f("d"), f("e", { rule: "missing", severity: "critical" }), f("g", { rule: "font-not-loaded", severity: "high" })];
  it("acepta descartar ruido con motivo", () => {
    const r = ground(out({ discarded: [{ finding_id: "a", reason: "Es consecuencia del cambio de padding." }] }), findings);
    expect(r.discarded).toEqual([{ findingId: "a", reason: "Es consecuencia del cambio de padding." }]);
  });
  it("nunca se descartan críticos, faltantes ni fuentes caídas", () => {
    const r = ground(out({ discarded: [{ finding_id: "e", reason: "x" }, { finding_id: "g", reason: "x" }] }), findings);
    expect(r.discarded).toEqual([]);
    expect(r.rejected.map((x) => x.reason).join()).toContain("críticos");
    expect(r.rejected.map((x) => x.reason).join()).toContain("font-not-loaded");
  });
  it("rechaza descartes de hallazgos inexistentes, repetidos, sin motivo o ya agrupados", () => {
    const r = ground(out({ groups: [group(["a", "b"])], discarded: [{ finding_id: "zzz", reason: "x" }, { finding_id: "c", reason: "motivo" }, { finding_id: "c", reason: "motivo" }, { finding_id: "d", reason: " " }, { finding_id: "a", reason: "ya agrupado" }] }), findings);
    expect(r.discarded.map((d) => d.findingId)).toEqual(["c"]);
    expect(r.rejected).toHaveLength(4);
  });
  it("si descarta más de la mitad, se desconfía de todos sus descartes", () => {
    const r = ground(out({ discarded: ["a", "b", "c", "d"].map((id) => ({ finding_id: id, reason: "ruido" })) }), findings);
    expect(r.discarded).toEqual([]);
    expect(r.rejected.at(-1)!.reason).toContain("más de la mitad");
  });
});
