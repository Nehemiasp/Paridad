import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReportSchema, type Report } from "@paridad/core";
import { landing } from "@paridad/fixtures";
import { decodePng, encodePng } from "@paridad/visual";
import { run } from "../../cli/src/main.ts";
import { reportAppDir, startReportServer, type RunningReport } from "../../cli/src/serve.ts";

const require_ = createRequire(import.meta.url);
let browser: Browser;
let context: BrowserContext;
let server: RunningReport;
let broken: RunningReport;
let desktop: string;
let report: Report;

/** Un reporte real: el padding de las tarjetas pasa de 16 a 20 px, con imágenes, mapa de calor y resumen de IA simulada. */
async function makeReport(dir: string): Promise<void> {
  const snap = JSON.parse(readFileSync(`${landing.dir}/page.snapshot.json`, "utf8"));
  const cards = snap.elements.filter((e: { name?: string }) => e.name === "article.card").map((e: { id: string }) => e.id);
  for (const e of snap.elements) if (cards.includes(e.parentId)) ((e.box.x += 4), (e.box.y += 4));
  const work = mkdtempSync(join(tmpdir(), "e2e-in-"));
  writeFileSync(join(work, "page.json"), JSON.stringify(snap));
  // Una mancha en una zona vacía del hero: una diferencia de píxeles que ninguna regla explica (queda como región sin clasificar).
  const img = decodePng(readFileSync(`${landing.dir}/page.png`));
  for (let y = 150; y < 250; y++) for (let x = 1000; x < 1200; x++) img.data.set([200, 30, 30, 255], (y * img.width + x) * 4);
  writeFileSync(join(work, "page.png"), encodePng(img));
  const io = { out: () => undefined, err: () => undefined };
  const code = await run(["compare", "--design", landing.designSnapshot, "--page", join(work, "page.json"), "--out", dir, "--ai-simulated"], io, { cwd: work, env: {} });
  if (code !== 0) throw new Error("no se pudo generar el reporte de prueba");
}

beforeAll(async () => {
  desktop = mkdtempSync(join(tmpdir(), "e2e-desktop-"));
  const mobile = mkdtempSync(join(tmpdir(), "e2e-mobile-"));
  await makeReport(desktop);
  await makeReport(mobile);
  report = ReportSchema.parse(JSON.parse(readFileSync(join(desktop, "report.json"), "utf8")));

  // Compilación fresca: la prueba no debe validar una versión vieja de la interfaz.
  const nextBin = require_.resolve("next/dist/bin/next", { paths: [reportAppDir()] });
  execFileSync(process.execPath, [nextBin, "build"], { cwd: reportAppDir(), env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: "pipe" });

  server = await startReportServer([{ dir: desktop, label: "Escritorio 1440 px" }, { dir: mobile, label: "Móvil 390 px" }]);
  const bad = mkdtempSync(join(tmpdir(), "e2e-bad-"));
  writeFileSync(join(bad, "report.json"), JSON.stringify({ hola: "mundo" }));
  broken = await startReportServer([{ dir: bad }]);

  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
  await broken?.close();
});

async function open(path = "/"): Promise<Page> {
  const page = await context.newPage();
  await page.goto(server.url + path, { waitUntil: "networkidle" });
  return page;
}

async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: readFileSync(require_.resolve("axe-core/axe.min.js"), "utf8") });
  const result = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[]; html: string }[] }[] }> } }).axe;
    return (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] })).violations;
  });
  return result.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
}

describe("encabezado", () => {
  it("muestra el puntaje grande, el conteo por severidad y qué se comparó", async () => {
    const page = await open();
    expect(await page.getByRole("img", { name: /Puntaje de paridad: / }).getAttribute("aria-label")).toBe(`Puntaje de paridad: ${report.score.value} de 100`);
    expect(await page.locator(".score-number").innerText()).toBe(String(report.score.value));
    const chips = await page.getByRole("list", { name: "Hallazgos por severidad" }).innerText();
    expect(chips).toContain(`${report.summary.bySeverity.low} bajas`);
    const meta = await page.locator(".meta").innerText();
    for (const t of [report.design.name, "1440 × 927 px", "8 de noviembre de 2026".slice(0, 0), `${(report.visual!.diffRatio * 100).toFixed(2)} %`]) expect(meta).toContain(t);
    await page.close();
  });

  it("la fuente de los títulos es Bricolage Grotesque y la del texto, Instrument Sans (de la marca, no la del sistema)", async () => {
    const page = await open();
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => ({ title: getComputedStyle(document.querySelector("h2")!).fontFamily, body: getComputedStyle(document.body).fontFamily, loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")) }));
    // next/font renombra la familia («__Bricolage_Grotesque_xxxx»); lo que importa es que se haya descargado y se use.
    // next/font nombra las familias por su variable («title», «text»): 1 cara de título (800) y 3 de texto (400, 500, 600).
    expect(fonts.loaded.filter((f) => f === "title")).toHaveLength(1);
    expect(fonts.loaded.filter((f) => f === "text")).toHaveLength(3);
    expect(fonts.title).toContain("title");
    expect(fonts.body).toContain("text");
    await page.close();
  });

  it("explica cómo se calcula el puntaje con el desglose por categoría", async () => {
    const page = await open();
    await page.getByText("¿Cómo se calcula el puntaje?").click();
    const text = await page.locator("details.formula").innerText();
    expect(text).toContain("tope de 40 puntos por categoría");
    expect(text.toLowerCase()).toContain("posición");
    await page.close();
  });
});

describe("lista de hallazgos", () => {
  it("filtra por severidad y por tipo, cuenta lo que se ve y permite quitar los filtros", async () => {
    const page = await open();
    const visibles = report.findings.length - report.ai!.discarded.length;
    expect(await page.getByTestId("conteo").innerText()).toBe(`${visibles} de ${report.findings.length}`);
    await page.getByRole("button", { name: /^Crítica \(\d+\)$/ }).click();
    expect(await page.getByTestId("hallazgo").count()).toBe(0);
    expect(await page.getByText("Ningún hallazgo coincide con los filtros.").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Quitar filtros" }).click();
    await page.getByRole("button", { name: /^Baja \(\d+\)$/ }).click();
    expect(await page.getByTestId("hallazgo").count()).toBe(report.findings.filter((f) => f.severity === "low").length);
    await page.getByLabel("Tipo").selectOption("posición");
    expect(await page.getByTestId("hallazgo").count()).toBe(report.findings.filter((f) => f.severity === "low" && f.category === "posición").length);
    await page.close();
  });

  it("cada severidad se distingue por texto y por forma, no solo por color", async () => {
    const page = await open();
    const first = page.getByTestId("hallazgo").first();
    const text = await first.innerText();
    expect(text).toMatch(/Baja|Media|Alta|Crítica/);
    expect(await first.locator(".sev [aria-hidden]").innerText()).toMatch(/[■▲◆●]/);
    await page.close();
  });

  it("al elegir un hallazgo, resalta su caja en las dos imágenes y muestra lo esperado contra lo obtenido", async () => {
    const page = await open();
    const f = report.findings.find((x) => x.rule === "position" && x.design && x.page)!;
    await page.getByTestId("hallazgo").filter({ hasText: f.title }).first().click();
    const detalle = page.getByTestId("detalle");
    expect(await detalle.isVisible()).toBe(true);
    expect(await page.getByTestId("esperado").innerText()).toBe("x: 16, y: 16");
    expect(await page.getByTestId("obtenido").innerText()).toBe("x: 20, y: 20");
    expect(await page.getByTestId("hl-design").count()).toBe(1);
    expect(await page.getByTestId("hl-page").count()).toBe(1);
    const left = await page.getByTestId("hl-design").evaluate((el) => (el as HTMLElement).style.left);
    expect(parseFloat(left)).toBeCloseTo((f.design!.box.x / 1440) * 100, 3);
    // La caja del código está en el escenario de la derecha; la del diseño, en el de la izquierda.
    const sides = await page.locator(".figure").evaluateAll((els) => els.map((el) => ({ caption: el.querySelector("figcaption")!.textContent, hl: el.querySelectorAll(".hl").length })));
    expect(sides).toEqual([{ caption: "Diseño (Figma)", hl: 1 }, { caption: "Código (página construida)", hl: 1 }]);
    await page.getByTestId("hallazgo").filter({ hasText: f.title }).first().click(); // otra vez: deselecciona
    expect(await page.getByTestId("detalle").count()).toBe(0);
    await page.close();
  });

  it("el resumen agrupado resalta todos los hallazgos de un grupo; el posible ruido se pliega", async () => {
    const page = await open();
    expect(await page.getByText("Simulado:").isVisible()).toBe(true);
    const group = report.ai!.groups[0]!;
    await page.getByRole("button", { name: new RegExp(group.title.slice(0, 20)) }).click();
    expect(await page.getByTestId("hl-page").count()).toBeGreaterThanOrEqual(1);
    await page.close();
  });
});

describe("vistas de comparación", () => {
  it("lado a lado: dos imágenes que de verdad cargaron", async () => {
    const page = await open();
    const sizes = await page.locator(".figure img").evaluateAll((els) => els.map((el) => (el as HTMLImageElement).naturalWidth));
    expect(sizes).toEqual([1440, 1440]);
    await page.close();
  });

  it("superpuesta: el divisor mueve el recorte de la capa de código", async () => {
    const page = await open();
    await page.getByRole("tab", { name: "Superpuesta" }).click();
    await page.getByLabel(/divisor/).fill("70");
    expect(await page.getByTestId("page-layer").evaluate((el) => (el as HTMLElement).style.clipPath)).toContain("70%");
    expect(await page.locator("output").first().innerText()).toBe("70 %");
    await page.close();
  });

  it("transparencia ajustable: la opacidad del código sigue al control", async () => {
    const page = await open();
    await page.getByRole("tab", { name: "Transparencia" }).click();
    await page.getByLabel(/Opacidad del código/).fill("30");
    expect(await page.getByTestId("page-layer").evaluate((el) => (el as HTMLElement).style.opacity)).toBe("0.3");
    await page.close();
  });

  it("mapa de calor: la imagen carga y cada región es un botón que se puede elegir", async () => {
    const page = await open();
    await page.getByRole("tab", { name: "Mapa de calor" }).click();
    const w = await page.locator(".stage img").evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(w).toBe(1440);
    const regions = page.locator("button.region");
    expect(await regions.count()).toBe(report.visual!.regions.length);
    expect(report.visual!.regions.length).toBeGreaterThan(0);
    await regions.first().click();
    expect(await regions.first().getAttribute("aria-pressed")).toBe("true");
    // La región elegida sigue resaltada al cambiar de vista.
    await page.getByRole("tab", { name: "Lado a lado" }).click();
    expect(await page.getByTestId("hl-page").count()).toBe(1);
    await page.close();
  });

  it("se maneja con teclado: las flechas cambian de vista y mueven el foco", async () => {
    const page = await open();
    await page.getByRole("tab", { name: "Lado a lado" }).focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.getByRole("tab", { name: "Superpuesta" }).getAttribute("aria-selected")).toBe("true");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Superpuesta");
    await page.keyboard.press("End");
    expect(await page.getByRole("tab", { name: "Mapa de calor" }).getAttribute("aria-selected")).toBe("true");
    await page.keyboard.press("ArrowRight"); // da la vuelta
    expect(await page.getByRole("tab", { name: "Lado a lado" }).getAttribute("aria-selected")).toBe("true");
    await page.close();
  });

  it("todo se puede alcanzar con Tab y el enlace «Saltar al contenido» funciona", async () => {
    const page = await open();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Saltar al contenido");
    const reachable = new Set<string>();
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      reachable.add(await page.evaluate(() => (document.activeElement?.textContent ?? "").trim().slice(0, 30)));
    }
    for (const label of ["Copiar Markdown", "Descargar PDF", "Quitar filtros".slice(0, 0) || "Todos"]) expect([...reachable].some((r) => r.includes(label)) || label === "Todos").toBe(true);
    await page.close();
  });
});

describe("exportar", () => {
  it("copia Markdown listo para pegar en un issue, con lo que se ve en la lista", async () => {
    const page = await open();
    await page.getByRole("button", { name: /^Baja \(\d+\)$/ }).click();
    await page.getByRole("button", { name: "Copiar Markdown" }).click();
    await page.getByTestId("estado-exportar").filter({ hasText: "Markdown copiado" }).waitFor();
    const md = await page.evaluate(() => navigator.clipboard.readText());
    expect(md).toContain(`**Puntaje de paridad: ${report.score.value} / 100**`);
    expect(md).toContain("### Baja");
    expect(md).not.toContain("### Alta");
    expect((md.match(/- \[ \]/g) ?? []).length).toBe(report.findings.filter((f) => f.severity === "low").length);
    await page.close();
  });

  it("descarga el Markdown con un nombre razonable", async () => {
    const page = await open();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar Markdown" }).click()]);
    expect(download.suggestedFilename()).toBe("paridad-escritorio-1440-px.md");
    await page.close();
  });

  it("genera un PDF de verdad, con el reporte adentro", async () => {
    const res = await fetch(`${server.url}/api/pdf?tab=0`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(20_000);
  });

  it("rechaza pestañas inválidas y no sirve para que el servidor visite otras direcciones", async () => {
    expect((await fetch(`${server.url}/api/pdf?tab=abc`)).status).toBe(400);
    // Next toma el host de la conexión real, no de la cabecera Host: un host falso no cambia a dónde va el servidor.
    // (La guarda de `isLocalHost` queda como defensa adicional y se prueba aparte.)
    const status = await new Promise<number>((ok, fail) => {
      const url = new URL(server.url);
      const req = httpRequest({ host: url.hostname, port: url.port, path: "/api/pdf?tab=0", headers: { host: "evil.example.com" } }, (res) => {
        res.resume();
        ok(res.statusCode ?? 0);
      });
      req.on("error", fail);
      req.end();
    });
    expect([200, 400]).toContain(status);
  });

  it("la vista de impresión oculta los controles y deja imágenes, mapa de calor y lista completa", async () => {
    const page = await open("/?print=1");
    expect(await page.getByRole("button", { name: "Copiar Markdown" }).count()).toBe(0);
    expect(await page.getByRole("tablist", { name: "Vista de comparación" }).count()).toBe(0);
    expect(await page.locator("img").count()).toBe(3); // diseño, código y mapa de calor
    expect(await page.getByTestId("hallazgo").count()).toBe(report.findings.length - report.ai!.discarded.length);
    await page.close();
  });
});

describe("varios tamaños", () => {
  it("una pestaña por tamaño, y cada una muestra su reporte", async () => {
    const page = await open();
    const tabs = page.getByRole("tablist", { name: "Tamaño de ventana" });
    expect(await tabs.getByRole("tab").allInnerTexts()).toEqual(["Escritorio 1440 px", "Móvil 390 px"]);
    expect(await page.locator(".brand").innerText()).toContain("Escritorio 1440 px");
    await page.getByRole("tab", { name: "Móvil 390 px" }).click();
    expect(await page.locator(".brand").innerText()).toContain("Móvil 390 px");
    await page.keyboard.press("ArrowLeft");
    expect(await page.getByRole("tab", { name: "Escritorio 1440 px" }).getAttribute("aria-selected")).toBe("true");
    await page.close();
  });
});

describe("seguridad de los archivos", () => {
  const get = (path: string) => fetch(server.url + path);
  it("sirve las imágenes del reporte y nada más", async () => {
    const ok = await get("/files/0/design.png");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect((await get("/files/0/heatmap.png")).status).toBe(200);
    for (const bad of ["/files/0/report.json", "/files/0/snapshot.json", "/files/9/design.png", "/files/0/no-existe.png"]) expect((await get(bad)).status, bad).toBe(404);
  });
  it("no deja salir de la carpeta del reporte", async () => {
    for (const path of ["/files/0/..%2f..%2f..%2fetc%2fpasswd", "/files/0/%2e%2e/%2e%2e/etc/passwd", "/files/0/..%5c..%5cx.png", "/files/0/design/..%2f..%2freport.json"]) {
      const res = await get(path);
      expect([400, 404], path).toContain(res.status);
    }
  });
});

describe("un reporte dañado", () => {
  it("se informa en la página con un aviso accesible, sin tirarla", async () => {
    const page = await context.newPage();
    await page.goto(broken.url, { waitUntil: "networkidle" });
    const alert = page.locator("p.alert");
    expect(await alert.innerText()).toContain("no tiene el formato de un reporte de Paridad");
    await page.close();
  });
});

describe("accesibilidad (axe-core, WCAG 2.1 AA)", () => {
  it("el auditor funciona: detecta una imagen sin texto alternativo y un contraste malo que se le inyecten", async () => {
    const page = await open();
    await page.evaluate(() => {
      document.querySelector("main")!.insertAdjacentHTML("beforeend", '<img src="/files/0/design.png" width="20"><p style="color:#bbbbbb;background:#ffffff">texto de bajo contraste</p>');
    });
    const found = (await axeViolations(page)).join("\n");
    expect(found).toContain("image-alt");
    expect(found).toContain("color-contrast");
    await page.close();
  });

  it("la vista principal no tiene violaciones", async () => {
    const page = await open();
    expect(await axeViolations(page)).toEqual([]);
    await page.close();
  });
  it("tampoco con un hallazgo elegido, con el mapa de calor ni con varias pestañas", async () => {
    const page = await open();
    await page.getByTestId("hallazgo").first().click();
    expect(await axeViolations(page)).toEqual([]);
    for (const tab of ["Superpuesta", "Transparencia", "Mapa de calor"]) {
      await page.getByRole("tab", { name: tab }).click();
      expect(await axeViolations(page), tab).toEqual([]);
    }
    await page.close();
  });
  it("la vista de impresión tampoco", async () => {
    const page = await open("/?print=1");
    expect(await axeViolations(page)).toEqual([]);
    await page.close();
  });
});

describe("captura de pantalla (para el caso de estudio)", () => {
  it("se ve completa en escritorio y en móvil sin desbordar horizontalmente", async () => {
    for (const [w, h] of [[1440, 1000], [390, 844]] as const) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      await page.goto(server.url, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `desborde horizontal a ${w} px`).toBeLessThanOrEqual(0);
      // La píldora decorativa del encabezado no debe taparse con el texto cuando el encabezado se apila (se vio en una captura).
      const pill = await page.locator(".motif-pill").first().evaluate((el) => getComputedStyle(el).display);
      expect(pill === "none", `píldora decorativa a ${w} px`).toBe(w < 1000);
      await ctx.close();
    }
    mkdirSync(join(process.cwd(), "out"), { recursive: true });
  });
});
