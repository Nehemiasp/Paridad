import { describe, expect, it } from "vitest";
import { tail, testTargetForFile } from "./test-edited-package.mjs";

const root = "/repo";

describe("testTargetForFile", () => {
  it("mapea un archivo de un paquete a las pruebas de ese paquete", () => {
    const t = testTargetForFile("/repo/packages/core/src/snapshot/schema.ts", root);
    expect(t?.args).toEqual(["test", "-w", "packages/core", "--if-present"]);
  });
  it("acepta rutas relativas y apps/", () => {
    expect(testTargetForFile("apps/cli/src/main.ts", root)?.args).toContain("apps/cli");
  });
  it("los datos de prueba disparan las pruebas de core", () => {
    expect(testTargetForFile("/repo/fixtures/landing/design.snapshot.json", root)?.args).toContain("packages/core");
  });
  it("scripts/ corre solo su proyecto", () => {
    expect(testTargetForFile("/repo/scripts/test-edited-package.mjs", root)?.args).toEqual(["vitest", "run", "--project", "scripts"]);
  });
  it("no hace nada con docs, CLAUDE.md, raíz ni archivos fuera del repositorio", () => {
    expect(testTargetForFile("/repo/docs/snapshot.md", root)).toBeNull();
    expect(testTargetForFile("/repo/CLAUDE.md", root)).toBeNull();
    expect(testTargetForFile("/repo/package.json", root)).toBeNull();
    expect(testTargetForFile("/repo/packages/package.json", root)).toBeNull();
    expect(testTargetForFile("/otro/lugar/archivo.ts", root)).toBeNull();
  });
});

describe("tail", () => {
  it("deja intacto un texto corto y recorta uno largo", () => {
    expect(tail("a\nb", 5)).toBe("a\nb");
    const largo = Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n");
    const r = tail(largo, 10);
    expect(r).toContain("90 líneas omitidas");
    expect(r.endsWith("l99")).toBe(true);
  });
});
