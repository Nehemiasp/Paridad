import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildProgram } from "../apps/cli/src/main.ts";
import { COMMENT_MARKER, ScreensSchema } from "../apps/cli/src/ci.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(`${root}${p}`, "utf8");
const commands = buildProgram().commands.map((c) => c.name());

describe("skill /paridad", () => {
  const text = read(".claude/skills/paridad/SKILL.md");
  const front = parse(/^---\n([\s\S]*?)\n---/.exec(text)![1]!) as Record<string, unknown>;

  it("tiene el nombre y la descripción que Claude Code necesita", () => {
    expect(front.name).toBe("paridad");
    expect(String(front.description).length).toBeGreaterThan(40);
    expect(front["argument-hint"]).toContain("frame");
  });

  it("solo la invoca la persona (llama a Figma y abre un navegador) y recibe los argumentos", () => {
    expect(front["disable-model-invocation"]).toBe(true);
    expect(text).toContain("$ARGUMENTS");
  });

  it("solo puede ejecutar los dos comandos de Paridad que necesita, y leer archivos: nada de Bash libre", () => {
    const tools = String(front["allowed-tools"]);
    const bash = [...tools.matchAll(/Bash\(([^)]*)\)/g)].map((m) => m[1]!);
    expect(bash).toEqual(["npm run paridad -- compare *", "npm run paridad -- summary *"]);
    expect(tools.replace(/Bash\([^)]*\)/g, "")).not.toMatch(/Bash|Write|Edit/);
  });

  it("los comandos que menciona existen en el CLI y respeta las reglas del proyecto", () => {
    const used = [...text.matchAll(/npm run paridad -- (\w+)/g)].map((m) => m[1]!);
    expect(new Set(used)).toEqual(new Set(["compare", "summary", "report"]));
    for (const c of used) expect(commands, `el comando «${c}» no existe`).toContain(c);
    expect(text).toContain("FIGMA_TOKEN");
    expect(text).toContain(".env.local");
    expect(text).toMatch(/[Nn]unca.*(pegue|imprima)/s); // no pedir ni mostrar el token
    expect(text).toContain("Solo se captura lo que la persona indica");
    expect(text).toContain("«usted»");
    expect(text).not.toMatch(/figd_[A-Za-z0-9_-]{10,}|sk-ant-/);
    expect(text.replace("No use `--open`", "")).not.toContain("--open"); // solo se menciona para decir que no se use
  });
});

describe("acción de GitHub", () => {
  const raw = read(".github/actions/paridad/action.yml");
  const action = parse(raw) as { runs: { using: string; steps: Record<string, unknown>[] }; inputs: Record<string, { required?: boolean; default?: unknown }> };

  it("es una acción compuesta con entradas claras; el token de Figma es obligatorio", () => {
    expect(action.runs.using).toBe("composite");
    expect(action.inputs["figma-token"]!.required).toBe(true);
    expect(action.inputs.screens!.default).toBe("paridad.screens.json");
  });

  it("todos los `run` declaran shell (obligatorio en acciones compuestas) y las acciones de terceros están fijadas a una versión mayor", () => {
    for (const step of action.runs.steps) {
      if ("run" in step) expect(step.shell, String(step.name)).toBe("bash");
      if ("uses" in step) expect(String(step.uses)).toMatch(/@v\d+$/);
    }
  });

  it("el token entra por variable de entorno, nunca se escribe en la línea de comandos", () => {
    const step = action.runs.steps.find((s) => s.id === "paridad") as { env: Record<string, string>; run: string };
    expect(step.env.FIGMA_TOKEN).toBe("${{ inputs.figma-token }}");
    expect(step.run).not.toContain("inputs.figma-token");
    expect(step.run).not.toContain("echo $FIGMA_TOKEN");
    // Ningún valor se interpola dentro de un script (`${{ … }}` en `run:` permite inyectar comandos): todo entra por `env:`.
    for (const s of action.runs.steps) if ("run" in s) expect(String(s.run), String(s.name)).not.toContain("${{");
  });

  it("publica el comentario aunque falle el puntaje, lo actualiza en lugar de duplicarlo y devuelve el código de salida al final", () => {
    const names = action.runs.steps.map((s) => String(s.name));
    expect(names.indexOf("Comentar en el pull request")).toBeLessThan(names.indexOf("Aplicar el resultado"));
    const comment = action.runs.steps.find((s) => s.name === "Comentar en el pull request") as { if: string; with: { script: string } };
    expect(comment.if).toContain("always()");
    expect(comment.with.script).toContain(COMMENT_MARKER);
    expect(comment.with.script).toContain("updateComment");
    expect(comment.with.script).toContain("createComment");
    const upload = action.runs.steps.find((s) => String(s.uses).startsWith("actions/upload-artifact")) as { if: string };
    expect(upload.if).toBe("always()");
  });

  it("los comandos que invoca existen en el CLI", () => {
    expect(commands).toContain("ci");
    expect(raw).toContain("npm run paridad -- ci");
  });
});

describe("workflow de ejemplo y archivo de pantallas de ejemplo", () => {
  const wf = parse(read("docs/examples/paridad-pr.yml")) as { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, { steps: { uses?: string; with?: Record<string, string> }[] }> };

  it("corre en pull_request (no en pull_request_target, que expondría secretos a código de forks) con los mínimos permisos", () => {
    expect(Object.keys(wf.on)).toEqual(["pull_request"]);
    expect(wf.permissions).toEqual({ contents: "read", "pull-requests": "write" });
  });
  it("pasa el token desde un secreto del repositorio", () => {
    const step = wf.jobs.paridad!.steps.find((s) => s.uses === "./.github/actions/paridad")!;
    expect(step.with!["figma-token"]).toBe("${{ secrets.FIGMA_TOKEN }}");
  });
  it("paridad.screens.example.json cumple el esquema que lee `paridad ci`", () => {
    const r = ScreensSchema.safeParse(JSON.parse(read("paridad.screens.example.json")));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.screens.length).toBeGreaterThanOrEqual(2);
  });
});
