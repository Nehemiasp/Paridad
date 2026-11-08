import { describe, expect, it } from "vitest";
import { normalizeText, parseSnapshot, type SnapshotInput } from "../index.ts";

function make(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    schemaVersion: 1,
    source: "page",
    meta: { name: "prueba", capturedAt: "2026-11-08T00:00:00.000Z", origin: {} },
    canvas: { width: 100, height: 50, scale: 1 },
    ignore: [],
    elements: [
      { id: "raiz", kind: "box", parentId: null, z: 0, box: { x: 0, y: 0, width: 100, height: 50 }, style: { background: "#ffffff" } },
      {
        id: "t1",
        kind: "text",
        parentId: "raiz",
        z: 1,
        box: { x: 10, y: 10, width: 40, height: 20 },
        text: { content: "Hola  mundo", normalized: "Hola mundo" },
        style: { color: "#0e1116", fontSize: 16, fontWeight: 400, lineHeight: null },
      },
    ],
    ...overrides,
  };
}

function issuesOf(data: unknown): string[] {
  const r = parseSnapshot(data);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
}

describe("normalizeText", () => {
  it("colapsa espacios, incluidos los duros, y recorta", () => {
    expect(normalizeText("  Hola  \n mundo  ")).toBe("Hola mundo");
  });
  it("aplica NFKC pero no cambia mayúsculas", () => {
    expect(normalizeText("ﬁn")).toBe("fin");
    expect(normalizeText("Comprar")).not.toBe(normalizeText("COMPRAR"));
  });
});

describe("parseSnapshot", () => {
  it("acepta un snapshot mínimo válido y aplica valores por defecto", () => {
    const { ignore: _ignore, ...sinIgnore } = make();
    const r = parseSnapshot(sinIgnore);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot.ignore).toEqual([]);
  });

  it("rechaza colores que no son #rrggbb o #rrggbbaa en minúsculas", () => {
    const snap = make();
    snap.elements[0]!.style = { background: "#FFFFFF" };
    expect(issuesOf(snap).join("\n")).toContain("elements[0].style.background");
    snap.elements[0]!.style = { background: "red" };
    expect(parseSnapshot(snap).ok).toBe(false);
    snap.elements[0]!.style = { background: "#ffffff80" };
    expect(parseSnapshot(snap).ok).toBe(true);
  });

  it("rechaza un parentId inexistente, con mensaje en español", () => {
    const snap = make();
    snap.elements[1]!.parentId = "fantasma";
    const issues = issuesOf(snap);
    expect(issues).toContain("elements[1].parentId: el padre «fantasma» no existe en el snapshot");
  });

  it("rechaza ids repetidos", () => {
    const snap = make();
    snap.elements[1]!.id = "raiz";
    expect(issuesOf(snap).join("\n")).toMatch(/elements\[1\]\.id: el id «raiz» está repetido/);
  });

  it("rechaza ciclos y elementos que son su propio padre", () => {
    const snap = make();
    snap.elements[0]!.parentId = "t1"; // raiz → t1 → raiz
    expect(issuesOf(snap).join("\n")).toContain("ciclo");
    const solo = make();
    solo.elements[1]!.parentId = "t1";
    expect(issuesOf(solo).join("\n")).toContain("propio padre");
  });

  it("exige text en los elementos de texto y lo prohíbe en los demás", () => {
    const snap = make();
    delete snap.elements[1]!.text;
    expect(issuesOf(snap).join("\n")).toContain("requiere el campo text");
    const box = make();
    box.elements[0]!.text = { content: "x", normalized: "x" };
    expect(issuesOf(box).join("\n")).toContain("solo los elementos de tipo «text»");
  });

  it("exige que normalized coincida con el texto normalizado", () => {
    const snap = make();
    snap.elements[1]!.text = { content: "Hola  mundo", normalized: "Hola  mundo" };
    expect(issuesOf(snap).join("\n")).toContain("no coincide con el texto normalizado");
  });

  it("rechaza tamaños negativos y números no finitos", () => {
    const snap = make();
    snap.elements[0]!.box = { x: 0, y: 0, width: -1, height: 50 };
    expect(parseSnapshot(snap).ok).toBe(false);
    snap.elements[0]!.box = { x: Number.NaN, y: 0, width: 1, height: 1 };
    expect(parseSnapshot(snap).ok).toBe(false);
  });

  it("valida que la imagen del lienzo coincida con la escala", () => {
    const ok = make({ canvas: { width: 100, height: 50, scale: 2, image: { path: "a.png", width: 200, height: 100 } } });
    expect(parseSnapshot(ok).ok).toBe(true);
    const mal = make({ canvas: { width: 100, height: 50, scale: 2, image: { path: "a.png", width: 100, height: 50 } } });
    expect(issuesOf(mal).join("\n")).toContain("debería medir 200×100");
  });

  it("rechaza zonas a ignorar fuera del lienzo", () => {
    const snap = make({ ignore: [{ rect: { x: 90, y: 0, width: 20, height: 10 } }, { selector: ".fecha" }] });
    const issues = issuesOf(snap);
    expect(issues).toEqual(["ignore[0].rect: el rectángulo queda fuera del lienzo"]);
  });

  it("rechaza otra versión de esquema y otro origen", () => {
    expect(parseSnapshot({ ...make(), schemaVersion: 2 }).ok).toBe(false);
    expect(parseSnapshot({ ...make(), source: "figma" }).ok).toBe(false);
  });

  it("acepta radio por esquina y sombras", () => {
    const snap = make();
    snap.elements[0]!.style = {
      radius: [4, 8, 4, 8],
      shadows: [{ x: 0, y: 2, blur: 4, spread: 0, color: "#0e111626" }],
      border: { width: 1, color: "#dadde2", style: "solid" },
    };
    expect(parseSnapshot(snap).ok).toBe(true);
  });

  it("informa la ruta del error con índices", () => {
    const issues = issuesOf({ ...make(), elements: [{ id: "a" }] });
    expect(issues.some((i) => i.startsWith("elements[0]."))).toBe(true);
  });
});
