import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const docs = ["README.md", "CLAUDE.md", "docs/snapshot.md", "docs/github-action.md", "docs/caso-de-estudio.md", "fixtures/landing/README.md", "fixtures/landing/figma/README.md"];

describe("documentación", () => {
  it.each(docs)("%s: todos los enlaces a archivos del repositorio apuntan a algo que existe", (doc) => {
    const text = readFileSync(join(root, doc), "utf8");
    const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((l) => !/^(https?:|mailto:|#)/.test(l));
    for (const link of links) {
      const path = resolve(dirname(join(root, doc)), link.split("#")[0]!);
      expect(existsSync(path), `${doc} → ${link}`).toBe(true);
    }
  });

  it("las capturas y el video del reporte existen y no están vacíos", () => {
    for (const f of ["reporte-resumen.png", "reporte-hallazgo.png", "reporte-mapa-de-calor.png", "reporte-movil.png", "flujo-del-reporte.webm"]) {
      expect(statSync(join(root, "docs/media", f)).size, f).toBeGreaterThan(10_000);
    }
  });

  it("el repositorio no contiene tokens ni claves (Figma, Anthropic, GitHub)", () => {
    const skip = new Set(["node_modules", ".git", ".next", "out", ".paridad-cache"]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (st.size < 2_000_000 && /\.(ts|tsx|js|mjs|json|md|yml|yaml|css|html|txt|example)$|\.env/.test(name)) {
          if (/figd_[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/.test(readFileSync(p, "utf8"))) hits.push(p);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });

  it(".env.local no existe en el repositorio y .env.example no trae valores", () => {
    expect(existsSync(join(root, ".env.local"))).toBe(false);
    const example = readFileSync(join(root, ".env.example"), "utf8");
    for (const line of example.split("\n").filter((l) => /^[A-Z_]+=/.test(l))) expect(line, line).toMatch(/=$/);
  });

  it("ningún archivo versionado menciona empresas o clientes reales (regla del proyecto: solo datos propios y ficticios)", () => {
    const text = ["README.md", "docs/caso-de-estudio.md", "fixtures/landing/README.md"].map((f) => readFileSync(join(root, f), "utf8")).join("\n").toLowerCase();
    expect(text).not.toContain("lumacode");
  });
});
