import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

// Guarda de regresión: una vez `npm test` ignoró todo `apps/*` sin avisar (faltaba en `projects`).
describe("monorepo", () => {
  const rootConfig = readFileSync(join(root, "vitest.config.ts"), "utf8");

  for (const parent of ["packages", "apps"]) {
    const dirs = existsSync(join(root, parent)) ? readdirSync(join(root, parent)) : [];
    for (const dir of dirs) {
      const pkgPath = join(root, parent, dir, "package.json");
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name: string; scripts?: Record<string, string> };
      if (!pkg.scripts?.test) continue;

      it(`${parent}/${dir} entra en \`npm test\` de la raíz`, () => {
        expect(rootConfig, `falta "${parent}/*" en projects de vitest.config.ts`).toContain(`"${parent}/*"`);
        expect(existsSync(join(root, parent, dir, "vitest.config.ts")), "falta vitest.config.ts del paquete").toBe(true);
        const cfg = readFileSync(join(root, parent, dir, "vitest.config.ts"), "utf8");
        expect(cfg, "el nombre del proyecto debe coincidir con el del paquete").toContain(`name: "${pkg.name}"`);
      });
    }
  }
});
