import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSnapshot, compare } from "@paridad/core";
import { landing } from "@paridad/fixtures";
import { guardWrite, HEADER, sessionToken } from "./guard.ts";
import { buildArgs, BUSY, getJob, NO_AI_KEY, NO_CHROMIUM, NO_FIGMA_TOKEN, startJob, stepsOf, type StartOptions } from "./jobs.ts";
import { maskSecrets } from "./env.ts";
import { store } from "./store.ts";
import { LIMITS, validateInput, type JobInput } from "./validate.ts";
import { entryById, folderName, isFolderName, listComparisons } from "./workspace.ts";

const FIGMA = "https://www.figma.com/design/AbCdEf123/Casa-Nube?node-id=1-2";
const ok = (raw: Parameters<typeof validateInput>[0]): JobInput => {
  const v = validateInput(raw);
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return v.value;
};
const errors = (raw: Parameters<typeof validateInput>[0]) => {
  const v = validateInput(raw);
  if (v.ok) throw new Error("debía fallar");
  return v.errors;
};

describe("validar el formulario (en el servidor)", () => {
  it("el modo ejemplo no necesita enlaces", () => {
    expect(ok({ demo: true })).toMatchObject({ demo: true, scale: 1, ignore: [], ai: false, aiMaxCost: LIMITS.defaultCost });
  });
  it("un formulario completo se normaliza", () => {
    const v = ok({ figmaUrl: ` ${FIGMA} `, pageUrl: "http://localhost:3000", width: "1440", scale: "2", ignore: ".fecha\n\n  #reloj  \r\n", ai: "on", aiMaxCost: "0,10" });
    expect(v).toEqual({ demo: false, figmaUrl: FIGMA, pageUrl: "http://localhost:3000", width: 1440, scale: 2, ignore: [".fecha", "#reloj"], ai: true, aiMaxCost: 0.1 });
  });
  it("vacío: dice qué falta, en español, junto a cada campo", () => {
    const e = errors({});
    expect(e.figmaUrl).toMatch(/Pegue el enlace del frame/);
    expect(e.pageUrl).toMatch(/dirección de la página/);
  });
  it("enlaces de Figma inválidos", () => {
    expect(errors({ figmaUrl: "hola", pageUrl: "http://localhost:3000" }).figmaUrl).toMatch(/no es una URL válida/);
    expect(errors({ figmaUrl: "https://example.com/design/a/b?node-id=1-2", pageUrl: "http://localhost:3000" }).figmaUrl).toMatch(/no es un dominio de Figma/);
    expect(errors({ figmaUrl: "https://www.figma.com/design/AbCdEf123/Casa-Nube", pageUrl: "http://localhost:3000" }).figmaUrl).toMatch(/node-id/);
  });
  it.each(["ftp://x.com/a", "javascript:alert(1)", "data:text/html,<b>", "no es una url", "http://usuario:clave@localhost:3000", "http://localhost\n:3000"])("página prohibida o inválida: %s", (pageUrl) => {
    expect(errors({ figmaUrl: FIGMA, pageUrl }).pageUrl).toBeTruthy();
  });
  it("acepta http, https y file", () => {
    for (const pageUrl of ["http://localhost:3000", "https://ejemplo.com/a?b=1", "file:///tmp/x/index.html"]) expect(ok({ figmaUrl: FIGMA, pageUrl }).pageUrl).toBe(pageUrl);
  });
  it.each(["199", "4001", "-5", "12.5", "1e3", "abc", "0x20"])("ancho inválido: %s", (width) => {
    expect(errors({ demo: true, width }).width).toMatch(/entero entre 200 y 4000/);
  });
  it("los límites del ancho son inclusivos", () => {
    expect(ok({ demo: true, width: "200" }).width).toBe(200);
    expect(ok({ demo: true, width: 4000 }).width).toBe(4000);
  });
  it("escala solo 1 o 2", () => {
    expect(errors({ demo: true, scale: "3" }).scale).toBeTruthy();
    expect(ok({ demo: true, scale: "1" }).scale).toBe(1);
  });
  it("selectores: máximo 20, de hasta 200 caracteres, sin caracteres de control", () => {
    expect(errors({ demo: true, ignore: Array.from({ length: 21 }, (_, i) => `.a${i}`).join("\n") }).ignore).toMatch(/hasta 20/);
    expect(errors({ demo: true, ignore: "x".repeat(201) }).ignore).toMatch(/200 caracteres/);
    expect(errors({ demo: true, ignore: [".ok", "a\u0000b"] }).ignore).toMatch(/control/);
    expect(ok({ demo: true, ignore: Array.from({ length: 20 }, (_, i) => `.a${i}`).join("\n") }).ignore).toHaveLength(20);
  });
  it("tope de costo de la IA", () => {
    for (const aiMaxCost of ["0", "-1", "2", "mucho"]) expect(errors({ demo: true, ai: true, aiMaxCost }).aiMaxCost).toBeTruthy();
  });
});

describe("argumentos del CLI: sin shell y sin que un valor se lea como opción", () => {
  const root = "/repo";
  it("cada valor va pegado a su opción con «=»", () => {
    const evil = "--out=/etc; rm -rf / $(id) `x`";
    const args = buildArgs(ok({ figmaUrl: FIGMA, pageUrl: "http://localhost:3000", ignore: evil }), "/ws/a", root);
    expect(args).toContain(`--ignore-selector=${evil}`);
    expect(args.filter((a) => a.startsWith("--out"))).toEqual(["--out=/ws/a"]);
    expect(args.every((a) => a === "compare" || a.startsWith("--"))).toBe(true);
    expect(args).toContain(`--figma=${FIGMA}`);
  });
  it("el modo ejemplo usa el diseño y la página guardados, nunca los del formulario", () => {
    const args = buildArgs(ok({ demo: true, figmaUrl: "https://otra.com", pageUrl: "http://otra.com" }), "/ws/a", root);
    expect(args).toContain("--design=/repo/fixtures/landing/design.snapshot.json");
    expect(args).toContain("--page=file:///repo/fixtures/landing/page/index.html");
    expect(args.join(" ")).not.toContain("otra.com");
  });
  it("la IA solo se pide si se marcó, con su tope", () => {
    expect(buildArgs(ok({ demo: true }), "/o", root)).not.toContain("--ai");
    expect(buildArgs(ok({ demo: true, ai: true, aiMaxCost: "0.2" }), "/o", root)).toEqual(expect.arrayContaining(["--ai", "--ai-max-cost=0.2"]));
  });
});

describe("guardas de las rutas que ejecutan cosas", () => {
  const req = (headers: Record<string, string>) => new Request("http://127.0.0.1:3000/api/comparaciones", { method: "POST", headers });
  const good = { host: "127.0.0.1:3000", [HEADER]: sessionToken() };
  it("con host local, sin Origin y con el token, pasa", () => {
    expect(guardWrite(req(good))).toBeUndefined();
    expect(guardWrite(req({ ...good, origin: "http://127.0.0.1:3000" }))).toBeUndefined();
    expect(guardWrite(req({ ...good, host: "localhost:3000", origin: "http://localhost:3000" }))).toBeUndefined();
  });
  it("sin la cabecera propia, o con un token equivocado: 403", async () => {
    for (const headers of [{ host: "127.0.0.1:3000" }, { ...good, [HEADER]: "otro" }, { ...good, [HEADER]: "" }]) {
      expect(guardWrite(req(headers))?.status).toBe(403);
    }
  });
  it("origen ajeno (CSRF) o host ajeno (DNS rebinding): 403", () => {
    expect(guardWrite(req({ ...good, origin: "https://malo.example" }))?.status).toBe(403);
    expect(guardWrite(req({ ...good, origin: "http://localhost:3000" }))?.status).toBe(403); // otro host, aunque sea local
    expect(guardWrite(req({ ...good, host: "malo.example" }))?.status).toBe(403);
    expect(guardWrite(req({ ...good, origin: "null" }))?.status).toBe(403);
  });
  it("el token cambia entre sesiones del servidor (es aleatorio y largo)", () => {
    expect(sessionToken()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("secretos", () => {
  it("se reemplazan los valores conocidos y las formas de token", () => {
    expect(maskSecrets("token figd_abcdefghij123456 y miSecreto123", ["miSecreto123"])).toBe("token *** y ***");
    expect(maskSecrets("sk-ant-api03-AAAAAAAAAAAA", [])).toBe("***");
  });
});

// ── Gestor de trabajos con un proceso falso ───────────────────────────────────
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() {
    this.killed = true;
    return true;
  }
}
const READY = { figma: true, ai: true, chromium: true };

describe("trabajos", () => {
  let ws: string;
  let spawned: { args: string[]; child: FakeChild }[];
  const options = (extra: Partial<StartOptions> = {}): StartOptions => ({
    root: "/repo",
    workspace: ws,
    status: READY,
    secrets: ["TOKEN-SECRETO"],
    spawn: (_cmd, args) => {
      const child = new FakeChild();
      spawned.push({ args, child });
      return child as never;
    },
    ...extra,
  });
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "paridad-ws-"));
    spawned = [];
    store().jobs.clear();
    store().running = undefined;
  });
  afterEach(() => {
    store().jobs.clear();
    store().running = undefined;
  });

  it("sin token de Figma no lanza ningún proceso y explica qué hacer", () => {
    const r = startJob(ok({ figmaUrl: FIGMA, pageUrl: "http://localhost:3000" }), options({ status: { ...READY, figma: false } }));
    expect(r).toMatchObject({ ok: false, status: 422, error: NO_FIGMA_TOKEN });
    expect(NO_FIGMA_TOKEN).toMatch(/\.env\.local/);
    expect(spawned).toHaveLength(0);
    expect(store().running).toBeUndefined();
  });
  it("el modo ejemplo no necesita token", () => {
    expect(startJob(ok({ demo: true }), options({ status: { ...READY, figma: false } })).ok).toBe(true);
    expect(spawned).toHaveLength(1);
  });
  it("IA sin clave y Chromium ausente tampoco lanzan nada", () => {
    expect(startJob(ok({ demo: true, ai: true }), options({ status: { ...READY, ai: false } }))).toMatchObject({ ok: false, error: NO_AI_KEY });
    expect(startJob(ok({ demo: true }), options({ status: { ...READY, chromium: false } }))).toMatchObject({ ok: false, error: NO_CHROMIUM });
    expect(spawned).toHaveLength(0);
  });
  it("un solo trabajo a la vez; al terminar se puede iniciar otro", () => {
    const first = startJob(ok({ demo: true }), options());
    expect(first.ok).toBe(true);
    expect(startJob(ok({ demo: true }), options())).toMatchObject({ ok: false, status: 409, error: BUSY });
    expect(spawned).toHaveLength(1);
    spawned[0]!.child.emit("close", 1);
    expect(startJob(ok({ demo: true }), options()).ok).toBe(true);
    expect(spawned).toHaveLength(2);
  });
  it("las carpetas no se pisan aunque sean del mismo segundo", () => {
    const now = () => new Date("2026-11-08T12:00:00Z");
    const a = startJob(ok({ demo: true }), options({ now }));
    spawned[0]!.child.emit("close", 1);
    const b = startJob(ok({ demo: true }), options({ now }));
    if (!a.ok || !b.ok) throw new Error("debían iniciar");
    expect(a.job.folder).toBe("20261108-120000-ejemplo");
    expect(b.job.folder).toBe("20261108-120000-ejemplo-2");
  });
  it("la salida se guarda sin secretos y los pasos avanzan con lo que imprime el CLI", () => {
    const r = startJob(ok({ figmaUrl: FIGMA, pageUrl: "http://localhost:3000" }), options());
    if (!r.ok) throw new Error("debía iniciar");
    const { child } = spawned[0]!;
    const status = () => stepsOf(r.job).map((s) => s.status);
    expect(status()).toEqual(["en curso", "pendiente", "pendiente", "pendiente"]);
    child.stdout.emit("data", Buffer.from("Leyendo el frame de Figma…\nCapturando http://localhost:3000 a 1440 px (el ancho del frame)…\n"));
    expect(status()).toEqual(["hecho", "en curso", "pendiente", "pendiente"]);
    child.stdout.emit("data", "Comparando el diseño con la página…\n");
    child.stderr.emit("data", "Aviso con TOKEN-SECRETO dentro\n");
    expect(status()).toEqual(["hecho", "hecho", "en curso", "pendiente"]);
    child.stdout.emit("data", "Calculando la diferencia visual…\n");
    expect(status()).toEqual(["hecho", "hecho", "hecho", "en curso"]);
    expect(r.job.lines.join("\n")).not.toContain("TOKEN-SECRETO");
    expect(r.job.lines.join("\n")).toContain("Aviso con *** dentro");
  });
  it("el modo ejemplo marca el primer paso como hecho desde el inicio", () => {
    const r = startJob(ok({ demo: true }), options());
    if (!r.ok) throw new Error();
    expect(stepsOf(r.job)[0]).toMatchObject({ label: "Usar el diseño guardado", status: "hecho" });
  });
  it("termina bien solo si el CLI sale con 0 y hay report.json", () => {
    const r = startJob(ok({ demo: true }), options());
    if (!r.ok) throw new Error();
    mkdirSync(join(ws, r.job.folder), { recursive: true });
    writeFileSync(join(ws, r.job.folder, "report.json"), "{}");
    spawned[0]!.child.emit("close", 0);
    expect(r.job).toMatchObject({ state: "listo", reportId: `c:${r.job.folder}`, error: undefined });
    expect(stepsOf(r.job).every((s) => s.status === "hecho")).toBe(true);
    expect(store().running).toBeUndefined();
  });
  it("salir con 0 sin reporte es un error", () => {
    const r = startJob(ok({ demo: true }), options());
    if (!r.ok) throw new Error();
    spawned[0]!.child.emit("close", 0);
    expect(r.job.state).toBe("error");
  });
  it("un error del CLI llega al navegador con su mensaje en español", () => {
    const r = startJob(ok({ figmaUrl: FIGMA, pageUrl: "http://localhost:3000" }), options());
    if (!r.ok) throw new Error();
    spawned[0]!.child.stderr.emit("data", "Error: Figma rechazó el token (403). Revise TOKEN-SECRETO\n");
    spawned[0]!.child.emit("close", 1);
    expect(r.job).toMatchObject({ state: "error", error: "Figma rechazó el token (403). Revise ***" });
  });
  it("tiempo máximo: mata el proceso y lo informa", async () => {
    const r = startJob(ok({ demo: true }), options({ timeoutMs: 20 }));
    if (!r.ok) throw new Error();
    await new Promise((res) => setTimeout(res, 80));
    expect(spawned[0]!.child.killed).toBe(true);
    expect(r.job.state).toBe("error");
    expect(r.job.error).toMatch(/tardó más de/);
    expect(store().running).toBeUndefined();
    // Un cierre tardío del proceso no cambia el resultado.
    spawned[0]!.child.emit("close", 0);
    expect(r.job.state).toBe("error");
  });
  it("si el proceso no arranca, se informa sin dejar el trabajo «corriendo»", () => {
    const r = startJob(ok({ demo: true }), options({ spawn: () => { throw new Error("ENOENT con TOKEN-SECRETO"); } }));
    if (!r.ok) throw new Error();
    expect(r.job.state).toBe("error");
    expect(r.job.error).toContain("***");
    expect(store().running).toBeUndefined();
    expect(getJob(r.job.id)).toBe(r.job);
  });
  it("solo se guardan las últimas líneas", () => {
    const r = startJob(ok({ demo: true }), options());
    if (!r.ok) throw new Error();
    spawned[0]!.child.stdout.emit("data", Array.from({ length: 500 }, (_, i) => `línea ${i}`).join("\n"));
    expect(r.job.lines).toHaveLength(200);
    expect(r.job.lines.at(-1)).toBe("línea 499");
  });
});

// ── Espacio de trabajo (historial) ────────────────────────────────────────────
describe("espacio de trabajo", () => {
  let ws: string;
  const saveReport = (folder: string, date: string) => {
    const design = assertSnapshot(JSON.parse(readFileSync(landing.designSnapshot, "utf8")));
    const page = assertSnapshot(JSON.parse(readFileSync(join(landing.dir, "page.snapshot.json"), "utf8")));
    mkdirSync(join(ws, folder), { recursive: true });
    writeFileSync(join(ws, folder, "report.json"), JSON.stringify(compare(design, page, { now: () => new Date(date) })));
  };
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "paridad-hist-"));
    process.env.PARIDAD_WORKSPACE = ws;
  });
  afterEach(() => {
    delete process.env.PARIDAD_WORKSPACE;
  });

  it("nombres de carpeta: fecha UTC y nombre sin acentos ni símbolos", () => {
    expect(folderName(new Date("2026-03-15T14:25:30Z"), "Casa Nube — Inicio/ñandú")).toBe("20260315-142530-casa-nube-inicio-nandu");
    expect(folderName(new Date("2026-03-15T14:25:30Z"), "***")).toBe("20260315-142530");
    expect(isFolderName("20260315-142530-casa")).toBe(true);
    for (const bad of ["", "..", "../x", "a/b", "A", "-a", "a b", "a".repeat(101)]) expect(isFolderName(bad), bad).toBe(false);
  });
  it("entryById: carpetas del espacio de trabajo y de --open; nada que salga de ellas", () => {
    saveReport("20260101-000000-a", "2026-01-01T00:00:00Z");
    expect(entryById("c:20260101-000000-a")?.dir).toBe(join(ws, "20260101-000000-a"));
    for (const id of ["c:..", "c:../x", "c:", "c:no-existe", "c:A/b", "../x"]) expect(entryById(id), id).toBeUndefined();
    expect(entryById("1", JSON.stringify([{ dir: "/a" }, { dir: "/b" }]))?.dir).toBe("/b");
  });
  it("el historial ordena por fecha, e ignora carpetas sin reporte, dañadas o de otro tipo", () => {
    saveReport("20260101-000000-vieja", "2026-01-01T00:00:00Z");
    saveReport("20260301-000000-nueva", "2026-03-01T00:00:00Z");
    mkdirSync(join(ws, "20260201-sin-reporte"), { recursive: true });
    mkdirSync(join(ws, "20260202-danado"), { recursive: true });
    writeFileSync(join(ws, "20260202-danado", "report.json"), "{ no es json");
    mkdirSync(join(ws, "Carpeta Rara"), { recursive: true });
    writeFileSync(join(ws, "suelto.txt"), "x");
    const items = listComparisons();
    expect(items.map((i) => i.folder)).toEqual(["20260301-000000-nueva", "20260101-000000-vieja"]);
    expect(items[0]).toMatchObject({ id: "c:20260301-000000-nueva", score: 100, total: 0 });
    expect(existsSync(ws)).toBe(true);
  });
  it("sin carpeta de trabajo, el historial está vacío", () => {
    process.env.PARIDAD_WORKSPACE = join(ws, "no-existe");
    expect(listComparisons()).toEqual([]);
  });
});
