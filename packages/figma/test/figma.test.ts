import { mkdtempSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { assertSnapshot, type Snapshot } from "@paridad/core";
import { landing, readFigmaImagesResponse, readFigmaNodesResponse, readLandingDesignSnapshot } from "@paridad/fixtures";
import { DiskCache, FigmaApiError, FigmaClient, fetchDesignSnapshot, figmaNodeToSnapshot, parseFigmaUrl, type FetchLike } from "../src/index.ts";

const png = readFileSync(landing.designImage);
const nodes = readFigmaNodesResponse() as { nodes: Record<string, { document: Record<string, unknown> }> };
const design = assertSnapshot(readLandingDesignSnapshot());

/** `fetch` falso: sirve las respuestas guardadas y cuenta las llamadas. Sin red. */
function fakeFetch(overrides: Record<string, () => Partial<Awaited<ReturnType<FetchLike>>>> = {}) {
  const calls: { url: string; token: string | undefined }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, token: init?.headers?.["X-Figma-Token"] });
    for (const [needle, make] of Object.entries(overrides)) {
      if (url.includes(needle)) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), ...make() };
    }
    const body = (data: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => data, arrayBuffer: async () => new ArrayBuffer(0) });
    if (url.includes("/v1/files/") && url.includes("/nodes")) return body(nodes);
    if (url.includes("/v1/images/")) return body(readFigmaImagesResponse());
    if (url.startsWith("https://figma-alpha-api")) return { ...body({}), arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer };
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fn, calls };
}

describe("parseFigmaUrl", () => {
  it("convierte node-id de URL (1-2) al de la API (1:2)", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/AbC123/Mi-archivo?node-id=1-2&t=xyz")).toEqual({ fileKey: "AbC123", nodeId: "1:2" });
  });
  it("acepta /file/, node-id con %3A y nodos de instancia", () => {
    expect(parseFigmaUrl("https://figma.com/file/K1/x?node-id=12%3A34")).toEqual({ fileKey: "K1", nodeId: "12:34" });
    expect(parseFigmaUrl("https://figma.com/design/K1/x?node-id=I5-6;7-8").nodeId).toBe("I5:6;7:8");
  });
  it("en una rama usa la clave de la rama", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/MAIN1/branch/BR2/Nombre?node-id=3-4")).toEqual({ fileKey: "BR2", nodeId: "3:4" });
  });
  it("rechaza lo que no sirve, con mensajes en español", () => {
    expect(() => parseFigmaUrl("hola")).toThrow(/no es una URL válida/);
    expect(() => parseFigmaUrl("https://ejemplo.com/design/K/x?node-id=1-2")).toThrow(/no es un dominio de Figma/);
    expect(() => parseFigmaUrl("https://figma.com/board/K/x?node-id=1-2")).toThrow(/archivos de diseño/);
    expect(() => parseFigmaUrl("https://figma.com/design/K/x")).toThrow(/no indica un frame/);
    expect(() => parseFigmaUrl("https://figma.com/design/K/x?node-id=abc")).toThrow(/formato/);
    expect(() => parseFigmaUrl("https://evilfigma.com/design/K/x?node-id=1-2")).toThrow(/dominio de Figma/);
  });
});

describe("FigmaClient", () => {
  const tmp = () => new DiskCache(mkdtempSync(join(tmpdir(), "paridad-cache-")));

  it("envía el token solo a api.figma.com, nunca a la URL del PNG", async () => {
    const { fn, calls } = fakeFetch();
    const client = new FigmaClient({ token: "TOKEN-SECRETO", fetch: fn });
    await client.getNode("AbCdEf123456", "1:2");
    await client.getImage("AbCdEf123456", "1:2", 2);
    expect(calls.filter((c) => c.url.startsWith("https://api.figma.com")).every((c) => c.token === "TOKEN-SECRETO")).toBe(true);
    expect(calls.find((c) => c.url.startsWith("https://figma-alpha-api"))?.token).toBeUndefined();
  });

  it("usa la caché: la segunda vez no llama a la API", async () => {
    const { fn, calls } = fakeFetch();
    const cache = tmp();
    const a = new FigmaClient({ token: "t", fetch: fn, cache });
    await a.getNode("K", "1:2");
    await a.getImage("K", "1:2", 2);
    const n = calls.length;
    const b = new FigmaClient({ token: "t", fetch: fn, cache });
    await b.getNode("K", "1:2");
    await b.getImage("K", "1:2", 2);
    expect(calls.length).toBe(n);
  });

  it("la caché no guarda el token y `refresh` la ignora", async () => {
    const { fn, calls } = fakeFetch();
    const cache = tmp();
    await new FigmaClient({ token: "TOKEN-SECRETO", fetch: fn, cache }).getNode("K", "1:2");
    for (const f of readdirSync(cache.dir)) expect(readFileSync(join(cache.dir, f), "utf8")).not.toContain("TOKEN-SECRETO");
    const n = calls.length;
    await new FigmaClient({ token: "t", fetch: fn, cache, refresh: true }).getNode("K", "1:2");
    expect(calls.length).toBe(n + 1);
  });

  it("la caché vence con el tiempo (TTL)", async () => {
    const { fn, calls } = fakeFetch();
    const dir = mkdtempSync(join(tmpdir(), "paridad-cache-"));
    const ahora = Date.now();
    const cache = new DiskCache(dir, 1000, () => ahora);
    await new FigmaClient({ token: "t", fetch: fn, cache }).getNode("K", "1:2");
    const n = calls.length;
    for (const f of readdirSync(dir)) utimesSync(join(dir, f), new Date(ahora - 5000), new Date(ahora - 5000));
    await new FigmaClient({ token: "t", fetch: fn, cache }).getNode("K", "1:2");
    expect(calls.length).toBe(n + 1);
  });

  it("traduce los errores de la API a mensajes en español", async () => {
    const make = (status: number, retry?: string) => fakeFetch({ "/nodes": () => ({ ok: false, status, headers: { get: (h: string) => (h === "retry-after" ? (retry ?? null) : null) } }) }).fn;
    await expect(new FigmaClient({ token: "t", fetch: make(403) }).getNode("K", "1:2")).rejects.toThrow(/rechazó el token/);
    await expect(new FigmaClient({ token: "t", fetch: make(404) }).getNode("K", "1:2")).rejects.toThrow(/no encontró el archivo/);
    await expect(new FigmaClient({ token: "t", fetch: make(429, "30") }).getNode("K", "1:2")).rejects.toThrow(/en 30 s/);
    await expect(new FigmaClient({ token: "t", fetch: make(500) }).getNode("K", "1:2")).rejects.toThrow(/error 500/);
  });

  it("falla con claridad si falta el token o el nodo no existe, y no filtra el token en errores de red", async () => {
    expect(() => new FigmaClient({ token: "" })).toThrow(/Falta el token/);
    const vacio = fakeFetch({ "/nodes": () => ({ json: async () => ({ nodes: { "1:2": null } }) }) }).fn;
    await expect(new FigmaClient({ token: "t", fetch: vacio }).getNode("K", "1:2")).rejects.toThrow(/no existe en el archivo/);
    const caido: FetchLike = async () => {
      throw new Error("fallo de red con TOKEN-SECRETO dentro");
    };
    const err = await new FigmaClient({ token: "TOKEN-SECRETO", fetch: caido }).getNode("K", "1:2").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FigmaApiError);
    expect((err as Error).message).not.toContain("TOKEN-SECRETO");
  });

  it("las variables (solo Enterprise) fallan en silencio", async () => {
    const { fn } = fakeFetch({ "/variables/local": () => ({ ok: false, status: 403 }) });
    expect(await new FigmaClient({ token: "t", fetch: fn }).getLocalVariables("K")).toBeUndefined();
  });
});

describe("figmaNodeToSnapshot · datos de la página de ejemplo", () => {
  const root = nodes.nodes["1:2"]!.document;
  const run = () => figmaNodeToSnapshot(root, { fileKey: "AbCdEf123456", nodeId: "1:2", scale: 2, now: () => new Date("2026-11-08T00:00:00Z") });

  it("produce un snapshot válido de tipo «design» con el origen de Figma", () => {
    const { snapshot, warnings } = run();
    expect(snapshot.source).toBe("design");
    expect(snapshot.meta.origin.figma).toEqual({ fileKey: "AbCdEf123456", nodeId: "1:2" });
    expect(snapshot.canvas).toMatchObject({ width: 1440, height: 927, scale: 2 });
    expect(warnings).toEqual([]);
  });

  it("las posiciones son relativas al frame (aunque el frame esté en x=1200, y=640)", () => {
    const { snapshot } = run();
    expect(snapshot.elements.find((e) => e.text?.normalized === "Casa Nube")!.box).toMatchObject({ x: 84, y: 23.5 });
    expect(snapshot.elements[0]).toMatchObject({ id: "page", box: { x: 0, y: 0, width: 1440, height: 927 } });
  });

  it("ignora las capas ocultas", () => {
    const { snapshot } = run();
    expect(snapshot.elements.some((e) => e.name?.includes("oculta"))).toBe(false);
    expect(snapshot.palette!.colors.map((c) => c.hex)).not.toContain("#ff00aa");
  });

  it("para el texto usa el ancho real (glifos) y la altura de la capa", () => {
    const { snapshot } = run();
    const h1 = snapshot.elements.find((e) => e.text?.normalized === "Cerámica hecha con calma")!;
    expect(h1.box.width).toBeCloseTo(619.47, 1); // la capa mide 760
    expect(h1.box.height).toBe(136);
    expect(h1.style).toMatchObject({ fontFamily: "Bricolage Grotesque", fontSize: 64, fontWeight: 800, lineHeight: 68, letterSpacing: -1.28, color: "#0e1116" });
  });

  it("reproduce el snapshot de diseño escrito a mano (mismos textos, cajas y estilos)", () => {
    const { snapshot } = run();
    const byText = (s: Snapshot, t: string) => s.elements.find((e) => e.text?.normalized === t)!;
    for (const d of design.elements.filter((e) => e.text)) {
      const f = byText(snapshot, d.text!.normalized);
      expect(f, d.id).toBeDefined();
      for (const k of ["x", "y", "width", "height"] as const) expect(Math.abs(f.box[k] - d.box[k]), `${d.id}.${k}`).toBeLessThan(0.5);
      expect(f.style).toEqual(d.style);
    }
    for (const id of ["page", "tarjeta-1", "tarjeta-2", "tarjeta-3", "btn-primario", "btn-secundario", "tarjeta-1-icono"]) {
      const d = design.elements.find((e) => e.id === id)!;
      const f = snapshot.elements.find((e) => e.box.x === d.box.x && e.box.y === d.box.y && e.box.width === d.box.width && e.box.height === d.box.height && e.kind === "box")!;
      expect(f, id).toBeDefined();
      expect(f.style, id).toEqual(d.style);
    }
    expect(snapshot.elements.length).toBe(design.elements.length);
  });

  it("la paleta sale de los colores usados y trae las familias con sus pesos", () => {
    const { snapshot } = run();
    expect(snapshot.palette!.colors.map((c) => c.hex).sort()).toEqual(design.palette!.colors.map((c) => c.hex).sort());
    expect(snapshot.palette!.fonts).toEqual([
      { family: "Instrument Sans", weights: [400, 500, 600] },
      { family: "Bricolage Grotesque", weights: [800] },
    ].sort((a, b) => snapshot.palette!.fonts.findIndex((f) => f.family === a.family) - snapshot.palette!.fonts.findIndex((f) => f.family === b.family)));
  });

  it("nombra los colores con estilos del archivo y con variables (extra)", () => {
    const r = figmaNodeToSnapshot(root, {
      fileKey: "K", nodeId: "1:2", scale: 1,
      variables: { "VariableID:1:1": { name: "Marca/Azul", resolvedType: "COLOR", valuesByMode: { m: { r: 4 / 255, g: 53 / 255, b: 101 / 255, a: 1 } } } },
    });
    expect(r.snapshot.palette!.colors.find((c) => c.hex === "#043565")?.name).toBe("Marca/Azul");
  });
});

describe("figmaNodeToSnapshot · casos del formato", () => {
  const frame = (children: unknown[], extra: Record<string, unknown> = {}) => ({
    id: "9:1", name: "F", type: "FRAME", absoluteBoundingBox: { x: 100, y: 200, width: 400, height: 300 }, fills: [], children, ...extra,
  });
  const translate = (children: unknown[], extra?: Record<string, unknown>) => figmaNodeToSnapshot(frame(children, extra), { fileKey: "K", nodeId: "9:1", scale: 1 });
  const rect = (over: Record<string, unknown> = {}) => ({ id: "9:2", name: "R", type: "RECTANGLE", absoluteBoundingBox: { x: 110, y: 210, width: 50, height: 40 }, fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }], ...over });
  const text = (over: Record<string, unknown> = {}) => ({ id: "9:3", name: "T", type: "TEXT", characters: "Hola", absoluteBoundingBox: { x: 110, y: 260, width: 100, height: 20 }, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }], style: { fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeightPx: 20, lineHeightUnit: "PIXELS", letterSpacing: 0 }, ...over });

  it("aplica la opacidad del relleno al color y la del nodo al estilo", () => {
    const { snapshot } = translate([rect({ fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 0.5 }], opacity: 0.8 })]);
    expect(snapshot.elements[1]!.style).toMatchObject({ background: "#00000080", opacity: 0.8 });
  });

  it("usa el relleno visible de más arriba y avisa de degradados", () => {
    const { snapshot, warnings } = translate([
      rect({ fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }, { type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }, { type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 }, visible: false }] }),
      rect({ id: "9:4", name: "Degradado", fills: [{ type: "GRADIENT_LINEAR" }] }),
    ]);
    expect(snapshot.elements[1]!.style.background).toBe("#0000ff");
    expect(snapshot.elements.some((e) => e.id === "9:4")).toBe(false);
    expect(warnings.join()).toMatch(/Degradado.*degradado/);
  });

  it("traduce bordes, radios por esquina, elipses y sombras", () => {
    const { snapshot } = translate([
      rect({ strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }], strokeWeight: 2, strokeAlign: "INSIDE", rectangleCornerRadii: [4, 8, 4, 8],
        effects: [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.2 }, offset: { x: 0, y: 2 }, radius: 4, spread: 1 }, { type: "INNER_SHADOW", color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 0 }, radius: 1 }, { type: "LAYER_BLUR", radius: 9 }, { type: "DROP_SHADOW", visible: false, color: { r: 1, g: 1, b: 1 }, offset: { x: 1, y: 1 }, radius: 1 }] }),
      rect({ id: "9:5", name: "Círculo", type: "ELLIPSE", absoluteBoundingBox: { x: 200, y: 210, width: 40, height: 40 } }),
    ]);
    expect(snapshot.elements[1]!.style).toMatchObject({ border: { width: 2, style: "solid", color: "#000000" }, radius: [4, 8, 4, 8] });
    expect(snapshot.elements[1]!.style.shadows).toEqual([
      { x: 0, y: 2, blur: 4, spread: 1, color: "#00000033" },
      { x: 0, y: 0, blur: 1, spread: 0, color: "#000000", inset: true },
    ]);
    expect(snapshot.elements[2]!.style.radius).toBe(20);
  });

  it("avisa de trazos exteriores, bordes desiguales y rotación en lugar de ocultarlo", () => {
    const { warnings } = translate([
      rect({ strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }], strokeAlign: "OUTSIDE" }),
      rect({ id: "9:6", name: "Desigual", strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }], individualStrokeWeights: { top: 0, right: 0, bottom: 2, left: 0 } }),
      rect({ id: "9:7", name: "Girada", rotation: 0.5 }),
    ]);
    expect(warnings.join("\n")).toMatch(/exterior/);
    expect(warnings.join("\n")).toMatch(/Desigual.*bordes distintos/);
    expect(warnings.join("\n")).toMatch(/Girada.*rotada/);
  });

  it("aplica textCase y avisa de estilos mezclados; interlineado automático = null", () => {
    const { snapshot, warnings } = translate([
      text({ characters: "hola mundo", style: { fontFamily: "Inter", fontSize: 16, fontWeight: 400, textCase: "UPPER", lineHeightUnit: "INTRINSIC_%", lineHeightPx: 19.4, letterSpacing: 0.5 } }),
      text({ id: "9:8", name: "Mixto", characters: "ab", characterStyleOverrides: [0, 1] }),
    ]);
    expect(snapshot.elements[1]!.text!.normalized).toBe("HOLA MUNDO");
    expect(snapshot.elements[1]!.style).toMatchObject({ lineHeight: null, letterSpacing: 0.5 });
    expect(warnings.join()).toMatch(/Mixto.*mezcla estilos/);
  });

  it("omite textos vacíos, nodos ocultos y de opacidad 0; avisa de tipos desconocidos", () => {
    const { snapshot, warnings } = translate([text({ characters: "   " }), rect({ visible: false }), rect({ id: "9:9", opacity: 0 }), { id: "9:10", name: "Pegatina", type: "STICKY" }]);
    expect(snapshot.elements).toHaveLength(1);
    expect(warnings.join()).toMatch(/STICKY/);
  });

  it("los vectores e imágenes de relleno son elementos de tipo image, y cuelgan de su contenedor", () => {
    const { snapshot } = translate([
      { id: "9:11", name: "Tarjeta", type: "FRAME", absoluteBoundingBox: { x: 100, y: 200, width: 200, height: 100 }, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }], children: [
        { id: "9:12", name: "Icono", type: "VECTOR", absoluteBoundingBox: { x: 110, y: 210, width: 24, height: 24 }, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] },
        rect({ id: "9:13", name: "Foto", fills: [{ type: "IMAGE" }] }),
      ] },
    ]);
    expect(snapshot.elements.find((e) => e.id === "9:12")).toMatchObject({ kind: "image", parentId: "9:11" });
    expect(snapshot.elements.find((e) => e.id === "9:13")).toMatchObject({ kind: "image", parentId: "9:11" });
  });

  it("falla con claridad si el nodo no tiene dimensiones", () => {
    expect(() => figmaNodeToSnapshot({ id: "1:1", type: "DOCUMENT" }, { fileKey: "K", nodeId: "1:1", scale: 1 })).toThrow(/absoluteBoundingBox/);
  });
});

describe("fetchDesignSnapshot (de la URL al snapshot, sin red)", () => {
  it("baja el frame y la imagen, y deja la imagen coherente con el lienzo", async () => {
    const { fn } = fakeFetch();
    const client = new FigmaClient({ token: "t", fetch: fn });
    const r = await fetchDesignSnapshot({ url: landing.figmaUrl, client, scale: 1, now: () => new Date("2026-11-08T00:00:00Z") });
    expect(r.image).toBeDefined();
    expect(r.snapshot.canvas.image).toEqual({ path: "design.png", width: 1440, height: 927 });
    expect(r.snapshot.meta.origin.figma).toEqual({ fileKey: "AbCdEf123456", nodeId: "1:2" });
  });

  it("con image:false no pide la imagen", async () => {
    const { fn, calls } = fakeFetch();
    const r = await fetchDesignSnapshot({ url: landing.figmaUrl, client: new FigmaClient({ token: "t", fetch: fn }), image: false });
    expect(r.image).toBeUndefined();
    expect(r.snapshot.canvas.image).toBeUndefined();
    expect(calls.some((c) => c.url.includes("/v1/images/"))).toBe(false);
  });

  it("no pide nada a la API si la URL es inválida", async () => {
    const { fn, calls } = fakeFetch();
    await expect(fetchDesignSnapshot({ url: "https://figma.com/design/K/x", client: new FigmaClient({ token: "t", fetch: fn }) })).rejects.toThrow(/no indica un frame/);
    expect(calls).toHaveLength(0);
    vi.restoreAllMocks();
  });
});
