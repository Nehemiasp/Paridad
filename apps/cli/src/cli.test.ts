import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parseSnapshot } from "@paridad/core";
import { landing, readFigmaImagesResponse, readFigmaNodesResponse } from "@paridad/fixtures";
import type { FetchLike } from "@paridad/figma";
import { loadEnvLocal } from "./env.ts";
import { cpSync } from "node:fs";
import { COMMENT_MARKER, ScreensSchema, toComment } from "./ci.ts";
import { decodePng, encodePng } from "@paridad/visual";
import type { AiClient, AiRequest } from "@paridad/ai";
import { run, type Io } from "./main.ts";
import { buildIgnoreZones, parsePositiveInt, parseRect, parseScale } from "./options.ts";

function memoryIo(): Io & { stdout: string; stderr: string } {
  const io = {
    stdout: "",
    stderr: "",
    out: (t: string) => void (io.stdout += t),
    err: (t: string) => void (io.stderr += t),
  };
  return io;
}

describe("opciones", () => {
  it("parseRect acepta x,y,ancho,alto y rechaza lo demás con mensajes claros", () => {
    expect(parseRect("0, 10,200,80")).toEqual({ x: 0, y: 10, width: 200, height: 80 });
    expect(() => parseRect("1,2,3")).toThrow(/x,y,ancho,alto/);
    expect(() => parseRect("a,b,c,d")).toThrow(/no es válido/);
    expect(() => parseRect("0,0,0,10")).toThrow(/positivos/);
  });
  it("parsePositiveInt y parseScale validan", () => {
    expect(parsePositiveInt("--width", "1440")).toBe(1440);
    expect(() => parsePositiveInt("--width", "-3")).toThrow(/entero positivo/);
    expect(() => parsePositiveInt("--width", undefined)).toThrow(/Falta --width/);
    expect(parsePositiveInt("--height", undefined, 900)).toBe(900);
    expect(parseScale(undefined)).toBe(1);
    expect(parseScale("2")).toBe(2);
    expect(() => parseScale("3")).toThrow(/1 o 2/);
  });
  it("buildIgnoreZones junta selectores y rectángulos", () => {
    expect(buildIgnoreZones([".fecha"], ["0,0,10,10"])).toEqual([{ selector: ".fecha" }, { rect: { x: 0, y: 0, width: 10, height: 10 } }]);
  });
});

describe("paridad capture", () => {
  it("sin --page falla con un mensaje en español y código 1", async () => {
    const io = memoryIo();
    expect(await run(["capture", "--width", "1440"], io)).toBe(1);
    expect(io.stderr).toContain("Falta --page");
  });

  it("rechaza protocolos no permitidos", async () => {
    const io = memoryIo();
    expect(await run(["capture", "--page", "ftp://x.com", "--width", "1440"], io)).toBe(1);
    expect(io.stderr).toContain("No se admite el protocolo");
  });

  it("captura la página de ejemplo y escribe snapshot.json y screenshot.png", async () => {
    const out = mkdtempSync(join(tmpdir(), "paridad-cli-"));
    const io = memoryIo();
    const code = await run(["capture", "--page", pathToFileURL(landing.pageIndex).href, "--width", "1440", "--out", out], io);
    expect(io.stderr).toBe("");
    expect(code).toBe(0);
    expect(io.stdout).toContain("lienzo 1440×927");
    expect(existsSync(join(out, "screenshot.png"))).toBe(true);
    const snap = parseSnapshot(JSON.parse(readFileSync(join(out, "snapshot.json"), "utf8")));
    expect(snap.ok).toBe(true);
  });

  it("--help sale con código 0", async () => {
    const io = memoryIo();
    expect(await run(["--help"], io)).toBe(0);
    expect(io.stdout).toContain("capture");
  });
});

const nodes = readFigmaNodesResponse();
const images = readFigmaImagesResponse();
const png = readFileSync(landing.designImage);
const ok = (data: unknown, bin?: Buffer) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => data,
  arrayBuffer: async () => (bin ? (bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer) : new ArrayBuffer(0)),
});
const fetchFake: FetchLike = async (url) => {
  if (url.includes("/nodes")) return ok(nodes);
  if (url.includes("/v1/images/")) return ok(images);
  if (url.includes("/variables/")) return { ...ok({}), ok: false, status: 403 };
  return ok({}, png);
};


describe("paridad figma", () => {
  it("sin token explica cómo conseguirlo y no abre la red", async () => {
    const io = memoryIo();
    const fetch = vi.fn(fetchFake);
    expect(await run(["figma", "--url", landing.figmaUrl], io, { env: {}, cwd: mkdtempSync(join(tmpdir(), "p-")), fetch })).toBe(1);
    expect(io.stderr).toContain("FIGMA_TOKEN");
    expect(io.stderr).toContain(".env.local");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("genera snapshot.json y design.png desde la URL del frame", async () => {
    const out = mkdtempSync(join(tmpdir(), "paridad-figma-"));
    const cwd = mkdtempSync(join(tmpdir(), "p-"));
    const io = memoryIo();
    const code = await run(["figma", "--url", landing.figmaUrl, "--out", out, "--scale", "1"], io, { env: { FIGMA_TOKEN: "t" }, cwd, fetch: fetchFake });
    expect(io.stderr).toBe("");
    expect(code).toBe(0);
    expect(io.stdout).toContain("lienzo 1440×927");
    expect(existsSync(join(out, "design.png"))).toBe(true);
    const snap = parseSnapshot(JSON.parse(readFileSync(join(out, "snapshot.json"), "utf8")));
    expect(snap.ok && snap.snapshot.source).toBe("design");
    expect(existsSync(join(cwd, ".paridad-cache", "figma"))).toBe(true);
  });

  it("--no-image no escribe imagen", async () => {
    const out = mkdtempSync(join(tmpdir(), "paridad-figma-"));
    const io = memoryIo();
    expect(await run(["figma", "--url", landing.figmaUrl, "--out", out, "--no-image"], io, { env: { FIGMA_TOKEN: "t" }, cwd: mkdtempSync(join(tmpdir(), "p-")), fetch: fetchFake })).toBe(0);
    expect(existsSync(join(out, "design.png"))).toBe(false);
  });

  it("una URL sin frame da un error claro", async () => {
    const io = memoryIo();
    expect(await run(["figma", "--url", "https://figma.com/design/K/x"], io, { env: { FIGMA_TOKEN: "t" }, cwd: tmpdir(), fetch: fetchFake })).toBe(1);
    expect(io.stderr).toContain("no indica un frame");
  });
});

describe("loadEnvLocal", () => {
  it("lee .env.local y deja que el entorno mande", () => {
    const dir = mkdtempSync(join(tmpdir(), "env-"));
    writeFileSync(join(dir, ".env.local"), "FIGMA_TOKEN=del-archivo\nOTRA=1\n");
    expect(loadEnvLocal(dir, {}).FIGMA_TOKEN).toBe("del-archivo");
    expect(loadEnvLocal(dir, { FIGMA_TOKEN: "del-entorno" }).FIGMA_TOKEN).toBe("del-entorno");
    expect(loadEnvLocal(join(dir, "no-existe"), { X: "1" })).toEqual({ X: "1" });
  });
});

describe("paridad compare", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "paridad-cmp-"));
  const designFile = landing.designSnapshot;
  const pageFile = join(landing.dir, "page.snapshot.json");

  it("modo archivos: compara dos snapshots y escribe report.json (la página de control da 100)", async () => {
    const out = dir();
    const io = memoryIo();
    const code = await run(["compare", "--design", designFile, "--page", pageFile, "--out", out], io, { cwd: dir() });
    expect(io.stderr).toBe("");
    expect(code).toBe(0);
    expect(io.stdout).toContain("Puntaje de paridad: 100 / 100");
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    expect(report.summary.total).toBe(0);
    expect(report.design.imagePath).toMatch(/design\.png$/);
    expect(report.page.imagePath).toMatch(/page\.png$/);
  });

  it("la diferencia visual de la página de control es cero y deja el mapa de calor", async () => {
    const out = dir();
    const io = memoryIo();
    expect(await run(["compare", "--design", designFile, "--page", pageFile, "--out", out], io, { cwd: dir() })).toBe(0);
    expect(io.stdout).toContain("Diferencia visual: 0.00 % de los píxeles · 0 regiones");
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    expect(report.visual).toMatchObject({ diffPixels: 0, heatmapPath: "heatmap.png", regions: [] });
    expect(existsSync(join(out, "heatmap.png"))).toBe(true);
  });

  it("una mancha en la imagen de la página que ninguna regla explica queda como «sin clasificar»", async () => {
    const work = dir();
    const img = decodePng(readFileSync(join(landing.dir, "page.png")));
    for (let y = 150; y < 250; y++) for (let x = 1000; x < 1200; x++) img.data.set([200, 30, 30, 255], (y * img.width + x) * 4); // zona vacía del hero
    writeFileSync(join(work, "page.png"), encodePng(img));
    writeFileSync(join(work, "page.json"), readFileSync(pageFile));
    const out = join(work, "out");
    const io = memoryIo();
    expect(await run(["compare", "--design", designFile, "--page", join(work, "page.json"), "--out", out], io, { cwd: work })).toBe(0);
    expect(io.stdout).toContain("1 región (1 sin clasificar)");
    expect(io.stdout).toContain("1 media"); // 1,5 % del lienzo: «media», no sale en el resumen de críticos y altos
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    expect(report.visual.regions[0]).toMatchObject({ classified: false, box: { x: 1000, y: 150, width: 200, height: 100 } });
    expect(report.findings[0]).toMatchObject({ rule: "visual-unclassified", category: "visual" });
  });

  it("--no-visual la omite", async () => {
    const out = dir();
    const io = memoryIo();
    expect(await run(["compare", "--design", designFile, "--page", pageFile, "--out", out, "--no-visual"], io, { cwd: dir() })).toBe(0);
    expect(JSON.parse(readFileSync(join(out, "report.json"), "utf8")).visual).toBeUndefined();
    expect(existsSync(join(out, "heatmap.png"))).toBe(false);
  });

  it("resume los críticos y altos, y --fail-under sale con código 2", async () => {
    const out = dir();
    const broken = JSON.parse(readFileSync(pageFile, "utf8"));
    broken.elements = broken.elements.filter((e: { name?: string }) => e.name !== "a.btn.btn-primary");
    const bad = join(dir(), "page.json");
    writeFileSync(bad, JSON.stringify(broken));
    const io = memoryIo();
    const code = await run(["compare", "--design", designFile, "--page", bad, "--out", out, "--fail-under", "95"], io, { cwd: dir() });
    expect(code).toBe(2);
    expect(io.stdout).toContain("Críticos y altos:");
    expect(io.stdout).toContain("[crítica] Falta en el código");
    expect(io.stderr).toContain("menor que el mínimo exigido (95)");
  });

  it("lee paridad.config.ts del directorio de trabajo", async () => {
    const cwd = dir();
    writeFileSync(join(cwd, "paridad.config.mjs"), "export default { disabledRules: ['missing'] };\n");
    const broken = JSON.parse(readFileSync(pageFile, "utf8"));
    broken.elements = broken.elements.filter((e: { name?: string }) => e.name !== "a.btn.btn-primary");
    const bad = join(cwd, "page.json");
    writeFileSync(bad, JSON.stringify(broken));
    const io = memoryIo();
    const code = await run(["compare", "--design", designFile, "--page", bad, "--out", join(cwd, "o")], io, { cwd });
    expect(code).toBe(0);
    expect(io.stdout).toContain("Configuración:");
    expect(io.stdout).not.toContain("[crítica]");
  });

  it("errores de uso claros", async () => {
    const cases: [string[], RegExp][] = [
      [["compare"], /Falta --page/],
      [["compare", "--page", pageFile], /Falta el diseño/],
      [["compare", "--design", designFile, "--figma", "x", "--page", pageFile], /no los dos/],
      [["compare", "--design", designFile, "--page", "ftp://x.com/a"], /No se admite el protocolo/],
      [["compare", "--figma", landing.figmaUrl, "--page", pageFile], /debe ser la URL/],
      [["compare", "--design", "no-existe.json", "--page", pageFile], /No existe el archivo/],
      [["compare", "--design", designFile, "--page", pageFile, "--config", "no-hay.ts"], /No existe el archivo de configuración/],
      [["compare", "--design", designFile, "--page", pageFile, "--out", dir(), "--fail-under", "abc"], /de 0 a 100/],
    ];
    for (const [argv, re] of cases) {
      const io = memoryIo();
      expect(await run(argv, io, { cwd: dir(), env: { FIGMA_TOKEN: "t" } }), argv.join(" ")).toBe(1);
      expect(io.stderr, argv.join(" ")).toMatch(re);
    }
  });

  it("modo completo: Figma (sin red) + captura de la página de ejemplo = paridad casi perfecta", async () => {
    const out = dir();
    const io = memoryIo();
    const code = await run(["compare", "--figma", landing.figmaUrl, "--page", pathToFileURL(landing.pageIndex).href, "--out", out], io, { cwd: dir(), env: { FIGMA_TOKEN: "t" }, fetch: fetchFake });
    expect(io.stderr).toBe("");
    expect(code).toBe(0);
    expect(io.stdout).toContain("Puntaje de paridad: 100 / 100");
    for (const f of ["design/snapshot.json", "design/design.png", "page/snapshot.json", "page/screenshot.png", "report.json"]) expect(existsSync(join(out, f)), f).toBe(true);
  });

  it("modo mixto: diseño guardado (sin Figma ni token) + captura de la página en vivo", async () => {
    const out = dir();
    const io = memoryIo();
    const fetchNever: FetchLike = async () => {
      throw new Error("no debe llamar a Figma");
    };
    const code = await run(["compare", "--design", designFile, "--page", pathToFileURL(landing.pageIndex).href, "--out", out], io, { cwd: dir(), env: {}, fetch: fetchNever });
    expect(io.stderr).toBe("");
    expect(code).toBe(0);
    expect(io.stdout).toContain("Puntaje de paridad: 100 / 100");
    // El reporte es autocontenido: la imagen del diseño se copia dentro de la carpeta de salida.
    for (const f of ["design.png", "page/snapshot.json", "page/screenshot.png", "report.json"]) expect(existsSync(join(out, f)), f).toBe(true);
  });
});

describe("paridad app", () => {
  it("levanta la app en la carpeta de trabajo indicada (relativa a donde se escribió el comando)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "paridad-app-"));
    const seen: string[] = [];
    expect(await run(["app", "--workspace", "mis-comparaciones"], memoryIo(), { cwd, openApp: async (w) => void seen.push(w) })).toBe(0);
    expect(seen).toEqual([join(cwd, "mis-comparaciones")]);
  });
  it("por defecto usa out/comparaciones", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "paridad-app-"));
    const seen: string[] = [];
    await run(["app"], memoryIo(), { cwd, openApp: async (w) => void seen.push(w) });
    expect(seen).toEqual([join(cwd, "out", "comparaciones")]);
  });
});

describe("paridad compare --ai", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "paridad-ai-"));
  const designFile = landing.designSnapshot;
  const pageFile = join(landing.dir, "page.snapshot.json");

  /** Una página con varios hallazgos con una causa común: el padding de las tarjetas. */
  function paddingPage(): string {
    const snap = JSON.parse(readFileSync(pageFile, "utf8"));
    const cards = snap.elements.filter((e: { name?: string }) => e.name === "article.card").map((e: { id: string }) => e.id);
    for (const e of snap.elements) if (cards.includes(e.parentId)) ((e.box.x += 4), (e.box.y += 4));
    const work = dir();
    const out = join(work, "page.json");
    writeFileSync(out, JSON.stringify(snap));
    writeFileSync(join(work, "page.png"), readFileSync(join(landing.dir, "page.png"))); // la imagen que nombra el snapshot
    return out;
  }
  const modelThatGroups = (): { client: AiClient; calls: AiRequest[] } => {
    const calls: AiRequest[] = [];
    return {
      calls,
      client: {
        async complete(req) {
          calls.push(req);
          const text = req.content[0]!.type === "text" ? (req.content[0] as { text: string }).text : "";
          const ids = (JSON.parse(text.slice(text.indexOf("{"))) as { hallazgos: { id: string; regla: string }[] }).hallazgos.filter((h) => h.regla === "position").map((h) => h.id);
          return { output: { groups: [{ title: "El padding de las tarjetas es mayor", explanation: "Hay 20 px donde el diseño pide 16 px.", finding_ids: ids, css_fix: "padding: 16px;" }], discarded: [] }, model: req.model, usage: { inputTokens: 3000, outputTokens: 300, cacheReadTokens: 0 } };
        },
      },
    };
  };

  it("por defecto la IA está apagada: no se llama a nadie y el reporte no trae sección ai", async () => {
    const out = dir();
    const { client, calls } = modelThatGroups();
    const io = memoryIo();
    expect(await run(["compare", "--design", designFile, "--page", paddingPage(), "--out", out], io, { cwd: dir(), aiClient: client })).toBe(0);
    expect(calls).toHaveLength(0);
    expect(JSON.parse(readFileSync(join(out, "report.json"), "utf8")).ai).toBeUndefined();
    expect(io.stdout).not.toContain("IA (");
  });

  it("con --ai agrupa, muestra el costo y guarda la sección ai sin tocar los hallazgos", async () => {
    const out = dir();
    const base = dir();
    await run(["compare", "--design", designFile, "--page", paddingPage(), "--out", base], memoryIo(), { cwd: dir() });
    const { client, calls } = modelThatGroups();
    const io = memoryIo();
    const code = await run(["compare", "--design", designFile, "--page", paddingPage(), "--out", out, "--ai"], io, { cwd: dir(), aiClient: client });
    expect(io.stderr).toBe("");
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toBe("claude-haiku-5-5");
    expect(io.stdout).toContain("IA (claude-haiku-5-5): 1 grupos");
    expect(io.stdout).toContain("padding: 16px;");
    const withAi = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    const without = JSON.parse(readFileSync(join(base, "report.json"), "utf8"));
    expect(withAi.ai.groups).toHaveLength(1);
    expect(withAi.ai.costUsd).toBeCloseTo((3000 * 0.1 + 300 * 0.5) / 1_000_000, 8);
    expect(withAi.findings).toEqual(without.findings);
    expect(withAi.score).toEqual(without.score);
  });

  it("envía imágenes recortadas por defecto, y --no-ai-images solo texto", async () => {
    const withImages = modelThatGroups();
    await run(["compare", "--design", designFile, "--page", paddingPage(), "--out", dir(), "--ai"], memoryIo(), { cwd: dir(), aiClient: withImages.client });
    expect(withImages.calls[0]!.content.some((c) => c.type === "image")).toBe(true);
    const textOnly = modelThatGroups();
    await run(["compare", "--design", designFile, "--page", paddingPage(), "--out", dir(), "--ai", "--no-ai-images"], memoryIo(), { cwd: dir(), aiClient: textOnly.client });
    expect(textOnly.calls[0]!.content.every((c) => c.type === "text")).toBe(true);
  });

  it("sin ANTHROPIC_API_KEY explica cómo conseguirla y ofrece el modo simulado", async () => {
    const io = memoryIo();
    expect(await run(["compare", "--design", designFile, "--page", pageFile, "--out", dir(), "--ai"], io, { cwd: dir(), env: {} })).toBe(1);
    expect(io.stderr).toContain("ANTHROPIC_API_KEY");
    expect(io.stderr).toContain("--ai-simulated");
  });

  it("--ai-simulated prueba la tubería sin red y se marca como simulada", async () => {
    const out = dir();
    const io = memoryIo();
    expect(await run(["compare", "--design", designFile, "--page", paddingPage(), "--out", out, "--ai-simulated"], io, { cwd: dir(), env: {} })).toBe(0);
    expect(io.stdout).toContain("SIMULADA, no mide a Claude");
    expect(JSON.parse(readFileSync(join(out, "report.json"), "utf8")).ai).toMatchObject({ mode: "simulado", costUsd: 0 });
  });

  it("un tope de costo muy bajo evita la llamada y el reporte sigue completo", async () => {
    const { client, calls } = modelThatGroups();
    const io = memoryIo();
    expect(await run(["compare", "--design", designFile, "--page", paddingPage(), "--out", dir(), "--ai", "--ai-max-cost", "0.0000001"], io, { cwd: dir(), aiClient: client })).toBe(0);
    expect(calls).toHaveLength(0);
    expect(io.stdout).toContain("supera el tope");
    await expect(run(["compare", "--design", designFile, "--page", pageFile, "--out", dir(), "--ai", "--ai-max-cost", "-1"], memoryIo(), { cwd: dir(), aiClient: client })).resolves.toBe(1);
  });

  it("la segunda corrida con lo mismo sale de la caché local: costo cero", async () => {
    const cwd = dir();
    const page = paddingPage();
    const { client, calls } = modelThatGroups();
    await run(["compare", "--design", designFile, "--page", page, "--out", dir(), "--ai", "--no-ai-images"], memoryIo(), { cwd, aiClient: client });
    const out = dir();
    const io = memoryIo();
    await run(["compare", "--design", designFile, "--page", page, "--out", out, "--ai", "--no-ai-images"], io, { cwd, aiClient: client });
    expect(calls).toHaveLength(1);
    expect(io.stdout).toContain("(caché)");
    expect(JSON.parse(readFileSync(join(out, "report.json"), "utf8")).ai).toMatchObject({ cacheHit: true, costUsd: 0 });
  });
});

describe("paridad report y --open", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "paridad-open-"));
  const designFile = landing.designSnapshot;
  const pageFile = join(landing.dir, "page.snapshot.json");

  it("compare --open pasa la carpeta del reporte a la app (sin abrir un navegador de verdad en la prueba)", async () => {
    const out = dir();
    const opened: { dir: string; label?: string }[][] = [];
    const io = memoryIo();
    const code = await run(["compare", "--design", designFile, "--page", pageFile, "--out", out, "--open"], io, { cwd: dir(), open: async (e) => void opened.push(e) });
    expect(code).toBe(0);
    expect(opened).toEqual([[{ dir: out }]]);
  });

  it("sin --open no se abre nada", async () => {
    const opened: unknown[] = [];
    await run(["compare", "--design", designFile, "--page", pageFile, "--out", dir()], memoryIo(), { cwd: dir(), open: async (e) => void opened.push(e) });
    expect(opened).toEqual([]);
  });

  it("report --dir abre varios reportes, uno por tamaño, con sus etiquetas en orden", async () => {
    const opened: { dir: string; label?: string }[][] = [];
    const code = await run(["report", "--dir", "out/escritorio", "--dir", "out/movil", "--label", "Escritorio", "--label", "Móvil"], memoryIo(), { open: async (e) => void opened.push(e) });
    expect(code).toBe(0);
    expect(opened[0]).toEqual([{ dir: "out/escritorio", label: "Escritorio" }, { dir: "out/movil", label: "Móvil" }]);
    opened.length = 0;
    await run(["report", "--dir", "a", "--dir", "b", "--label", "Solo la primera"], memoryIo(), { open: async (e) => void opened.push(e) });
    expect(opened[0]).toEqual([{ dir: "a", label: "Solo la primera" }, { dir: "b" }]);
  });

  it("report sin --dir, o con más etiquetas que carpetas, da un error claro", async () => {
    const a = memoryIo();
    expect(await run(["report"], a, { open: async () => undefined })).toBe(1);
    expect(a.stderr).toContain("Falta --dir");
    const b = memoryIo();
    expect(await run(["report", "--dir", "x", "--label", "1", "--label", "2"], b, { open: async () => undefined })).toBe(1);
    expect(b.stderr).toContain("más --label que --dir");
  });

  it("si la carpeta no tiene report.json, el servidor real se niega con un mensaje en español", async () => {
    const io = memoryIo();
    expect(await run(["report", "--dir", dir()], io)).toBe(1);
    expect(io.stderr).toContain("No hay report.json");
  });
});

describe("paridad summary", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "paridad-sum-"));
  async function reportDir(mutate: (snap: { elements: { id: string; name?: string; parentId: string | null; box: { x: number; y: number } }[] }) => void): Promise<string> {
    const snap = JSON.parse(readFileSync(join(landing.dir, "page.snapshot.json"), "utf8"));
    mutate(snap);
    const work = dir();
    writeFileSync(join(work, "page.json"), JSON.stringify(snap));
    writeFileSync(join(work, "page.png"), readFileSync(join(landing.dir, "page.png")));
    const out = join(work, "out");
    await run(["compare", "--design", landing.designSnapshot, "--page", join(work, "page.json"), "--out", out, "--no-visual"], memoryIo(), { cwd: work });
    return out;
  }
  const dropButton = (snap: { elements: { id: string; name?: string; parentId: string | null }[] }) => {
    const btn = snap.elements.find((e) => e.name === "a.btn.btn-primary")!;
    snap.elements = snap.elements.filter((e) => e.id !== btn.id && e.parentId !== btn.id);
  };

  it("por defecto lista las críticas y altas con su evidencia", async () => {
    const out = await reportDir(dropButton);
    const io = memoryIo();
    expect(await run(["summary", "--dir", out], io)).toBe(0);
    expect(io.stdout).toContain("Puntaje de paridad: 85 / 100");
    expect(io.stdout).toContain("[crítica] Falta en el código");
    expect(io.stdout).toContain('diseño "presente" · código "ausente"');
  });

  it("--json da una forma estable para otras herramientas", async () => {
    const out = await reportDir(dropButton);
    const io = memoryIo();
    await run(["summary", "--dir", out, "--json"], io);
    const j = JSON.parse(io.stdout);
    expect(j).toMatchObject({ score: 85, counts: { critical: 1, high: 0, medium: 0, low: 0 }, omitted: 0 });
    expect(j.findings[0]).toMatchObject({ severity: "critical", rule: "missing", expected: "presente", actual: "ausente" });
    expect(Object.keys(j.findings[0]).sort()).toEqual(["actual", "category", "delta", "designBox", "expected", "id", "pageBox", "property", "rule", "severity", "title", "unit"]);
  });

  it("--severity pide otras; lo menos grave se cuenta como omitido", async () => {
    const out = await reportDir((snap) => {
      const cards = snap.elements.filter((e) => e.name === "article.card").map((e) => e.id);
      for (const e of snap.elements) if (e.parentId && cards.includes(e.parentId)) e.box.x += 4;
    });
    const solo = memoryIo();
    await run(["summary", "--dir", out], solo);
    expect(solo.stdout).toContain("No hay hallazgos de las severidades pedidas");
    expect(solo.stdout).toContain("hallazgos de menor severidad no se listan");
    const low = memoryIo();
    await run(["summary", "--dir", out, "--severity", "low"], low);
    expect(low.stdout).toContain("[baja]");
  });

  it("errores claros: severidad desconocida y carpeta sin reporte", async () => {
    const a = memoryIo();
    expect(await run(["summary", "--dir", dir(), "--severity", "grave"], a)).toBe(1);
    expect(a.stderr).toContain("Severidad desconocida: grave");
    const b = memoryIo();
    expect(await run(["summary", "--dir", dir()], b)).toBe(1);
    expect(b.stderr).toContain("No hay report.json");
  });
});

describe("paridad ci", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "paridad-ci-"));
  const nodes = readFigmaNodesResponse();
  const images = readFigmaImagesResponse();
  const png = readFileSync(landing.designImage);
  const body = (data: unknown, bin?: Buffer) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => data, arrayBuffer: async () => (bin ? (bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer) : new ArrayBuffer(0)) });
  const fetchFake: FetchLike = async (url) => (url.includes("/nodes") ? body(nodes) : url.includes("/v1/images/") ? body(images) : url.includes("/variables/") ? { ...body({}), ok: false, status: 403 } : body({}, png));

  /** Una copia de la página de ejemplo con el padding de las tarjetas cambiado: un caso con puntaje menor a 100. */
  function mutatedPage(): string {
    const copy = join(dir(), "page");
    cpSync(landing.pageDir, copy, { recursive: true });
    const css = readFileSync(join(copy, "styles.css"), "utf8").replace("padding: 16px;\n  background: var(--white);", "padding: 24px;\n  background: var(--white);");
    writeFileSync(join(copy, "styles.css"), css);
    return pathToFileURL(join(copy, "index.html")).href;
  }
  const screens = (list: object[], extra: object = {}) => {
    const file = join(dir(), "paridad.screens.json");
    writeFileSync(file, JSON.stringify({ screens: list, ...extra }));
    return file;
  };
  const good = { name: "Inicio · escritorio", figma: landing.figmaUrl, page: pathToFileURL(landing.pageIndex).href };

  it("compara cada pantalla y deja un reporte por pantalla y el comentario del pull request", async () => {
    const out = dir();
    const io = memoryIo();
    const code = await run(["ci", "--screens", screens([good]), "--out", out], io, { cwd: dir(), env: { FIGMA_TOKEN: "t" }, fetch: fetchFake });
    expect(io.stderr).toBe("");
    expect(code).toBe(0);
    expect(existsSync(join(out, "inicio-escritorio", "report.json"))).toBe(true);
    const comment = readFileSync(join(out, "comment.md"), "utf8");
    expect(comment.startsWith(COMMENT_MARKER)).toBe(true);
    expect(comment).toContain("| Inicio · escritorio | **100**");
    expect(JSON.parse(readFileSync(join(out, "results.json"), "utf8")).results[0]).toMatchObject({ score: 100, error: null });
  });

  it("una pantalla por debajo del puntaje mínimo hace fallar (código 2) y el comentario lo marca", async () => {
    const out = dir();
    const io = memoryIo();
    const code = await run(["ci", "--screens", screens([{ ...good, page: mutatedPage() }], { failUnder: 99 }), "--out", out], io, { cwd: dir(), env: { FIGMA_TOKEN: "t" }, fetch: fetchFake });
    expect(code).toBe(2);
    expect(io.stderr).toContain("por debajo del puntaje mínimo (99)");
    const comment = readFileSync(join(out, "comment.md"), "utf8");
    expect(comment).toContain("❌");
    expect(comment).toContain("Puntaje mínimo exigido: **99**");
  });

  it("--fail-under de la línea de comandos manda sobre el del archivo", async () => {
    const code = await run(["ci", "--screens", screens([good], { failUnder: 100 }), "--out", dir(), "--fail-under", "50"], memoryIo(), { cwd: dir(), env: { FIGMA_TOKEN: "t" }, fetch: fetchFake });
    expect(code).toBe(0);
  });

  it("si una pantalla falla (p. ej. enlace sin frame) se informa y las demás se comparan igual", async () => {
    const out = dir();
    const io = memoryIo();
    const code = await run(["ci", "--screens", screens([{ ...good, name: "Rota", figma: "https://figma.com/design/K/x" }, good]), "--out", out], io, { cwd: dir(), env: { FIGMA_TOKEN: "t" }, fetch: fetchFake });
    expect(code).toBe(1);
    const comment = readFileSync(join(out, "comment.md"), "utf8");
    expect(comment).toContain("| Rota | ⚠ error");
    expect(comment).toContain("no indica un frame");
    expect(comment).toContain("| Inicio · escritorio | **100**");
  });

  it("valida el archivo de pantallas con mensajes en español", async () => {
    const bad = join(dir(), "s.json");
    writeFileSync(bad, JSON.stringify({ screens: [] }));
    const io = memoryIo();
    expect(await run(["ci", "--screens", bad], io, { cwd: dir() })).toBe(1);
    expect(io.stderr).toContain("no es válido");
    const dup = memoryIo();
    expect(await run(["ci", "--screens", screens([good, { ...good, name: "INICIO — escritorio" }])], dup, { cwd: dir() })).toBe(1);
    expect(dup.stderr).toContain("se llaman parecido");
    const none = memoryIo();
    expect(await run(["ci", "--screens", join(dir(), "no-existe.json")], none, { cwd: dir() })).toBe(1);
    expect(none.stderr).toContain("Cree un archivo");
  });

  it("el comentario escapa lo que viene de la página y funciona sin puntaje mínimo", () => {
    const text = toComment([{ name: "A", dir: "x", score: 90, counts: { critical: 0, high: 1, medium: 0, low: 0 }, topFindings: ["Texto «a | b <script>»"], error: null }], undefined);
    expect(text).toContain("a \\| b &lt;script>");
    expect(text).not.toContain("Puntaje mínimo exigido");
    expect(ScreensSchema.safeParse({ screens: [{ name: "x", figma: "f", page: "p" }] }).success).toBe(true);
  });
});
