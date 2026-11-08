import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { landing } from "@paridad/fixtures";
import { run } from "../../cli/src/main.ts";
import { reportAppDir, startReportServer, type RunningReport } from "../../cli/src/serve.ts";

const require_ = createRequire(import.meta.url);
const REPO = join(reportAppDir(), "..", "..");
// Si quien corre las pruebas ya tiene el token de Figma, la prueba de «sin token» no aplica (la unitaria de `startJob` sí cubre ese caso).
const hasFigmaToken = Boolean(process.env.FIGMA_TOKEN) || (existsSync(join(REPO, ".env.local")) && Boolean(parseEnv(readFileSync(join(REPO, ".env.local"), "utf8")).FIGMA_TOKEN));

let browser: Browser;
let context: BrowserContext;
let server: RunningReport;
let workspace: string;
const seeded = "20260101-120000-semilla";
const winFolder = "20260103-120000-windows";

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "e2e-ws-"));
  // Una comparación previa (sin navegador: archivos contra archivos) para probar el historial y las pestañas.
  const io = { out: () => undefined, err: () => undefined };
  const code = await run(["compare", "--design", landing.designSnapshot, "--page", join(landing.dir, "page.snapshot.json"), "--out", join(workspace, seeded)], io, { cwd: workspace, env: {} });
  if (code !== 0) throw new Error("no se pudo sembrar la comparación de prueba");

  // Un reporte como el que genera Windows: las rutas de las imágenes llevan «\\» (path.relative) en vez de «/».
  cpSync(join(workspace, seeded), join(workspace, winFolder), { recursive: true });
  const winDir = join(workspace, winFolder);
  mkdirSync(join(winDir, "sub"), { recursive: true });
  const win = JSON.parse(readFileSync(join(winDir, "report.json"), "utf8")) as { design: { imagePath: string }; page: { imagePath: string } };
  renameSync(join(winDir, win.design.imagePath), join(winDir, "sub", "design.png"));
  renameSync(join(winDir, win.page.imagePath), join(winDir, "sub", "page.png"));
  win.design.imagePath = "sub\\design.png";
  win.page.imagePath = "sub\\page.png";
  writeFileSync(join(winDir, "report.json"), JSON.stringify(win));

  const nextBin = require_.resolve("next/dist/bin/next", { paths: [reportAppDir()] });
  execFileSync(process.execPath, [nextBin, "build"], { cwd: reportAppDir(), env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: "pipe" });
  server = await startReportServer([], { workspace });

  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function open(path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(server.url + path, { waitUntil: "networkidle" });
  return page;
}

async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: readFileSync(require_.resolve("axe-core/axe.min.js"), "utf8") });
  const result = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    return (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] })).violations;
  });
  return result.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
}

const textOf = (l: Locator) => async () => (await l.textContent()) ?? "";

/** POST con Node (el navegador no deja falsear `Host` ni `Origin`). */
function post(path: string, headers: Record<string, string>, body = "{}"): Promise<{ status: number; body: string }> {
  const u = new URL(server.url);
  return new Promise((ok, fail) => {
    const req = httpRequest({ host: u.hostname, port: u.port, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", fail);
    req.end(body);
  });
}

describe("pantalla «Nueva comparación»", () => {
  it("muestra el formulario, el estado del entorno (sin valores) y el historial; sin violaciones de axe", async () => {
    const page = await open("/nueva");
    await page.getByRole("heading", { name: "Nueva comparación", level: 2 }).waitFor({ state: "visible" });
    for (const name of ["Enlace del frame de Figma", "Dirección de la página", "Ancho de la ventana (px) (opcional)", "Escala de la imagen", "Zonas a ignorar (opcional)"]) {
      await page.getByLabel(name, { exact: true }).waitFor({ state: "visible" });
    }
    const env = await page.locator("#entorno").locator("xpath=..").innerText();
    expect(env).toMatch(/Figma:/);
    expect(env).toMatch(/Chromium: listo/);
    // Nunca se muestran valores de secretos.
    expect(await page.content()).not.toMatch(/figd_|sk-ant-/);
    await expect.poll(() => page.locator(".history-item").count()).toBe(2);
    expect(await axeViolations(page)).toEqual([]);
    await page.close();
  });

  it("enviar vacío da errores en español junto a cada campo, marca aria-invalid y lleva el foco al primero; axe sin violaciones", async () => {
    const page = await open("/nueva");
    await page.getByRole("button", { name: "Comparar" }).click();
    await page.waitForSelector(".field-error");
    const errors = await page.locator(".field-error").allTextContents();
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/Pegue el enlace del frame de Figma/);
    expect(errors[1]).toMatch(/dirección de la página/);
    await expect.poll(() => page.locator("#figmaUrl").getAttribute("aria-invalid")).toBe("true");
    expect(await page.locator("#figmaUrl").getAttribute("aria-describedby")).toContain("figmaUrl-error");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("name"))).toBe("figmaUrl");
    expect(await axeViolations(page)).toEqual([]);
    await page.close();
  });

  it("el servidor rechaza lo que el formulario no revisó (ancho absurdo, protocolo prohibido)", async () => {
    const page = await open("/nueva");
    await page.getByLabel("Enlace del frame de Figma").fill("https://www.figma.com/design/AbCdEf123/Casa?node-id=1-2");
    await page.getByLabel("Dirección de la página").fill("ftp://example.com/a");
    await page.getByLabel(/Ancho de la ventana/).fill("99999");
    await page.getByRole("button", { name: "Comparar" }).click();
    await page.waitForSelector(".field-error");
    const text = (await page.locator(".field-error").allTextContents()).join(" | ");
    expect(text).toMatch(/No se admite el protocolo/);
    expect(text).toMatch(/entre 200 y 4000/);
    await page.close();
  });

  it.skipIf(hasFigmaToken)("Figma sin token: mensaje claro con los pasos y no se crea ninguna carpeta ni proceso", async () => {
    const before = readdirSync(workspace);
    const page = await open("/nueva");
    await page.getByLabel("Enlace del frame de Figma").fill("https://www.figma.com/design/AbCdEf123/Casa?node-id=1-2");
    await page.getByLabel("Dirección de la página").fill("http://localhost:3000");
    await page.getByRole("button", { name: "Comparar" }).click();
    const alert = page.locator("form .alert");
    await expect.poll(textOf(alert)).toContain("Falta el token de Figma");
    await expect.poll(textOf(alert)).toContain(".env.local");
    expect(page.url()).toMatch(/\/nueva$/);
    expect(readdirSync(workspace)).toEqual(before);
    // Lo escrito se conserva.
    expect(await page.getByLabel("Dirección de la página").inputValue()).toBe("http://localhost:3000");
    await page.close();
  });

  it("sin la cabecera de sesión, con un token falso o con un Origin ajeno, las peticiones se rechazan (403)", async () => {
    const u = new URL(server.url);
    const host = `${u.hostname}:${u.port}`;
    expect((await post("/api/comparaciones", { host })).status).toBe(403);
    expect((await post("/api/comparaciones", { host, "x-paridad": "0".repeat(32) })).status).toBe(403);
    expect((await post("/api/comparaciones", { host, origin: "https://malo.example", "x-paridad": "0".repeat(32) })).status).toBe(403);
    expect((await post("/api/comparaciones", { host: "malo.example" })).status).toBe(403);
    expect(readdirSync(workspace).sort()).toEqual([seeded, winFolder]);
  });

  it("modo ejemplo completo: avance, un solo trabajo a la vez, reporte con puntaje 100 y aparece en el historial", async () => {
    const page = await open("/nueva");
    let token = "";
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/comparaciones")) token = r.headers()["x-paridad"] ?? "";
    });
    await page.getByLabel(/Probar con el ejemplo/).check();
    expect(await page.getByLabel("Enlace del frame de Figma").isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Comparar" }).click();
    await page.waitForURL(/\/comparaciones\/[^/]+$/);
    expect(token).toMatch(/^[0-9a-f]{32}$/);

    // Mientras corre, otra petición válida se rechaza.
    const second = await page.evaluate(async (t) => {
      const res = await fetch("/api/comparaciones", { method: "POST", headers: { "content-type": "application/json", "x-paridad": t }, body: JSON.stringify({ demo: true }) });
      return { status: res.status, body: (await res.json()) as { error?: string } };
    }, token);
    // Si el primero ya terminó (máquina muy rápida) se aceptaría; lo normal es 409.
    if (second.status !== 201) {
      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/Ya hay una comparación en curso/);
    }

    await page.waitForURL(/\/reporte$/, { timeout: 120_000 });
    await expect.poll(textOf(page.locator(".score-number"))).toBe("100");
    // Las imágenes del reporte se sirven desde la carpeta de la comparación.
    const imgs = await page.locator(".stage img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).currentSrc));
    expect(imgs.length).toBeGreaterThan(0);
    for (const src of imgs) expect((await page.request.get(src)).status()).toBe(200);
    await page.goto(`${server.url}/nueva`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll(".history-item").length >= 3);
    await page.close();
  });

  it("el avance muestra los pasos (con aria-live) y el error con «Volver al formulario»; axe sin violaciones", async () => {
    const page = await context.newPage();
    const steps = (state: string) => ({
      state,
      summary: "Ejemplo",
      demo: false,
      steps: [
        { id: "diseno", label: "Leer el frame de Figma", status: "hecho" },
        { id: "captura", label: "Capturar la página", status: state === "error" ? "pendiente" : "en curso" },
        { id: "comparacion", label: "Comparar elementos", status: "pendiente" },
        { id: "visual", label: "Calcular la diferencia visual", status: "pendiente" },
      ],
      lines: ["Leyendo el frame de Figma…", "Error: La página no respondió"],
      error: state === "error" ? "La página no respondió en 30 s." : null,
      reportId: null,
      elapsedMs: 4000,
    });
    // Se simula la respuesta del estado para auditar cada situación sin depender de tiempos.
    await page.route("**/api/comparaciones/20260101-000000-prueba", (route) => route.fulfill({ json: steps("corriendo") }));
    await page.goto(`${server.url}/comparaciones/20260101-000000-prueba`, { waitUntil: "networkidle" });
    await expect.poll(() => page.getByRole("list", { name: "Pasos de la comparación" }).locator("li").count()).toBe(4);
    await expect.poll(textOf(page.locator("[aria-live=polite]").first())).toContain("En curso: Capturar la página.");
    expect(await axeViolations(page)).toEqual([]);

    await page.unroute("**/api/comparaciones/20260101-000000-prueba");
    await page.route("**/api/comparaciones/20260101-000000-prueba", (route) => route.fulfill({ json: steps("error") }));
    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(textOf(page.locator(".alert"))).toContain("La página no respondió en 30 s.");
    await expect.poll(() => page.getByRole("link", { name: "Volver al formulario" }).getAttribute("href")).toBe("/nueva");
    expect(await axeViolations(page)).toEqual([]);
    await page.close();
  });

  it("una comparación que la app no conoce (se reinició) da un mensaje claro, no una pantalla rota", async () => {
    const page = await open("/comparaciones/20260102-000000-no-existe");
    await expect.poll(textOf(page.locator(".alert"))).toContain("No encuentro esa comparación");
    await page.close();
    expect((await context.request.get(`${server.url}/comparaciones/..%2Fetc/reporte`)).status()).toBe(404);
  });

  it("el historial abre una comparación, y varias juntas como pestañas por tamaño", async () => {
    const page = await open("/nueva");
    const boxes = page.locator(".history-item input[type=checkbox]");
    expect(await boxes.count()).toBeGreaterThanOrEqual(2);
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByRole("link", { name: /Abrir 2 juntas/ }).click();
    await page.waitForURL(/\/comparaciones\/abrir\?/);
    await expect.poll(() => page.getByRole("tablist", { name: "Tamaño de ventana" }).getByRole("tab").count()).toBe(2);
    expect(await axeViolations(page)).toEqual([]);

    await page.goto(`${server.url}/nueva`, { waitUntil: "networkidle" });
    await page.locator(".history-link", { hasText: "100" }).first().click();
    await page.waitForURL(/\/reporte$/);
    await page.locator(".score-number").waitFor({ state: "visible" });
    // No hay forma de borrar datos desde la app.
    await page.goto(`${server.url}/nueva`, { waitUntil: "networkidle" });
    await expect.poll(() => page.getByRole("button", { name: /borrar|eliminar/i }).count()).toBe(0);
    await page.close();
  });

  it("los ids de carpeta no dejan salir del espacio de trabajo (imágenes, reporte y PDF)", async () => {
    for (const path of ["/files/c%3A..%2F..%2Fetc/passwd.png", "/files/c%3A..%2F../x.png", `/files/c%3A${seeded}/report.json`, `/files/c%3A${seeded}/..%2F..%2Fx.png`, "/comparaciones/abrir?c=..%2F..", "/api/pdf?c=..%2Fx", "/api/pdf?c=20250101-000000-no-existe"]) {
      const res = await context.request.get(server.url + path);
      expect(res.status(), path).toBe(404);
    }
  });

  it("un reporte con rutas de Windows (con «\\») muestra sus imágenes", async () => {
    const page = await open(`/comparaciones/${winFolder}/reporte`);
    await page.waitForSelector(".stage img");
    const loaded = await page.locator(".stage img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0));
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.every(Boolean)).toBe(true);
    await page.close();
  });

  it("PDF de una comparación del espacio de trabajo", async () => {
    const res = await context.request.get(`${server.url}/api/pdf?c=${seeded}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("en móvil no hay desplazamiento horizontal y axe sigue limpio", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await mobile.newPage();
    await page.goto(`${server.url}/nueva`, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await axeViolations(page)).toEqual([]);
    await mobile.close();
  });
});
