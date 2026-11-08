import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSnapshot } from "@paridad/core";
import { landing } from "@paridad/fixtures";
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
