import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parseSnapshot } from "@paridad/core";
import { landing, readFigmaImagesResponse, readFigmaNodesResponse } from "@paridad/fixtures";
import type { FetchLike } from "@paridad/figma";
import { loadEnvLocal } from "./env.ts";
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
      [["compare", "--design", designFile, "--page", "http://localhost:3000"], /debe ser un snapshot/],
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
});
