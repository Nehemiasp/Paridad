/**
 * Genera las capturas y el video corto del reporte para el README y el caso de estudio (docs/media/).
 * Es reproducible: aplica errores conocidos a la página de ejemplo, la sirve en localhost, la compara con el diseño y
 * graba el uso del reporte. Uso: `npm run media`.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { landing } from "@paridad/fixtures";
import { capturePage, writeCapture } from "@paridad/capture";
import { run } from "../apps/cli/src/main.ts";
import { startReportServer } from "../apps/cli/src/serve.ts";
import { serveDir } from "../packages/capture/test/helpers.ts";

const outDir = join(import.meta.dirname, "..", "docs", "media");
mkdirSync(outDir, { recursive: true });

// 1. Una página con errores de implementación realistas (los que un desarrollador cometería).
const work = mkdtempSync(join(tmpdir(), "paridad-media-"));
const page = join(work, "page");
cpSync(landing.pageDir, page, { recursive: true });
let css = readFileSync(join(page, "styles.css"), "utf8");
const edit = (a: string, b: string) => {
  if (css.split(a).length !== 2) throw new Error(`la edición ya no aplica: ${a}`);
  css = css.replace(a, b);
};
edit("  padding: 16px;\n  background: var(--white);", "  padding: 20px;\n  background: var(--white);"); // padding de las tarjetas 16 → 20
edit("  background: var(--blue);\n  color: var(--white);", "  background: #073d72;\n  color: var(--white);"); // un azul parecido pero distinto
edit(".card p { margin: 0; color: var(--muted); }", ".card p { margin: 0; color: #9aa0aa; }"); // texto con poco contraste
edit("  letter-spacing: -1.28px;", "  letter-spacing: 0;"); // se perdió el espaciado entre letras del título
writeFileSync(join(page, "styles.css"), css);

// 2. Se sirve en localhost, se captura y se compara con el diseño.
const server = await serveDir(page);
const browser = await chromium.launch();
const captured = await capturePage({ url: server.url, width: 1440, imageName: "page.png", name: "Casa Nube · landing (en desarrollo)" }, browser);
await server.close();
const input = join(work, "captura");
writeCapture(captured, input);

const report = join(work, "reporte");
const io = { out: () => undefined, err: (t: string) => process.stderr.write(t) };
const code = await run(["compare", "--design", landing.designSnapshot, "--page", join(input, "snapshot.json"), "--out", report], io, { cwd: work });
if (code !== 0) throw new Error(`compare terminó con código ${code}`);

// 3. Capturas (a 2x, porque las verá una persona) y video del flujo.
const app = await startReportServer([{ dir: report, label: "Escritorio 1440 px" }]);
const shot = async (name: string, f: (p: import("playwright").Page) => Promise<void>, opts: { fullPage?: boolean; width?: number; height?: number } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1280, height: opts.height ?? 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(app.url, { waitUntil: "networkidle" });
  await f(p);
  await p.screenshot({ path: join(outDir, `${name}.png`), fullPage: opts.fullPage ?? false });
  await ctx.close();
};
await shot("reporte-resumen", async () => undefined);
await shot("reporte-hallazgo", async (p) => {
  await p.getByTestId("hallazgo").nth(1).click();
  await p.getByRole("tab", { name: "Superpuesta" }).click();
  await p.getByLabel(/divisor/).fill("55");
}, { fullPage: true });
await shot("reporte-mapa-de-calor", async (p) => {
  await p.getByRole("tab", { name: "Mapa de calor" }).click();
});
await shot("reporte-movil", async () => undefined, { width: 390, height: 844, fullPage: false });

const videoDir = mkdtempSync(join(tmpdir(), "paridad-video-"));
const vctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } } });
const v = await vctx.newPage();
await v.goto(app.url, { waitUntil: "networkidle" });
const pause = (ms: number) => v.waitForTimeout(ms);
await pause(1200);
await v.getByTestId("hallazgo").first().click();
await pause(1500);
await v.getByRole("tab", { name: "Superpuesta" }).click();
for (const n of [20, 40, 60, 80, 55]) {
  await v.getByLabel(/divisor/).fill(String(n));
  await pause(350);
}
await v.getByRole("tab", { name: "Transparencia" }).click();
for (const n of [20, 70, 50]) {
  await v.getByLabel(/Opacidad del código/).fill(String(n));
  await pause(350);
}
await v.getByRole("tab", { name: "Mapa de calor" }).click();
await pause(1200);
await v.getByRole("tab", { name: "Lado a lado" }).click();
await v.getByRole("button", { name: /^Baja \(\d+\)$/ }).click();
await pause(900);
await v.getByRole("button", { name: "Copiar Markdown" }).click();
await pause(1500);
await vctx.close();
const webm = readdirSync(videoDir).find((f) => f.endsWith(".webm"))!;
renameSync(join(videoDir, webm), join(outDir, "flujo-del-reporte.webm"));

writeFileSync(join(outDir, "reporte-demo.json"), JSON.stringify({ score: JSON.parse(readFileSync(join(report, "report.json"), "utf8")).score.value }, null, 2) + "\n");
await browser.close();
await app.close();
// El reporte de demostración se conserva para poder abrirlo: `npm run paridad -- report --dir out/demo-reporte`.
rmSync(join(import.meta.dirname, "..", "out", "demo-reporte"), { recursive: true, force: true });
cpSync(report, join(import.meta.dirname, "..", "out", "demo-reporte"), { recursive: true });
rmSync(work, { recursive: true, force: true });
console.log(`Listo: ${outDir}`);
