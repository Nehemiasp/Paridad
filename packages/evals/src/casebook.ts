import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser } from "playwright";
import type { Box, Finding, Report, Severity } from "@paridad/core";
import { landing } from "@paridad/fixtures";
import type { MutationResult } from "./metrics.ts";
import type { Mutation } from "./mutation.ts";
import type { MutationRun } from "./run.ts";

const FONTS = new URL("../../../apps/report/src/fonts/", import.meta.url);
const SEVERITY_LABEL: Record<Severity, string> = { critical: "Crítica", high: "Alta", medium: "Media", low: "Baja" };
const SEVERITY_SHAPE: Record<Severity, string> = { critical: "■", high: "▲", medium: "◆", low: "●" };
const SEVERITY_COLORS: Record<Severity, [string, string]> = { critical: ["#8a0f1f", "#fdecee"], high: ["#8a3a00", "#fff1e0"], medium: ["#5c4a00", "#fff8d6"], low: ["#1f4b8a", "#e6effb"] };
const ORDER: Severity[] = ["critical", "high", "medium", "low"];

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function union(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  return { x: x0, y: y0, width: Math.max(...boxes.map((b) => b.x + b.width)) - x0, height: Math.max(...boxes.map((b) => b.y + b.height)) - y0 };
}

/**
 * La región que cuenta la historia: donde están los hallazgos (o, si no hay, las diferencias de píxeles), con margen y un
 * tamaño mínimo para que se entienda el contexto. Si abarcaría casi toda la página, se muestra la página entera.
 */
export function storyRegion(report: Report, canvas: { width: number; height: number }, opts: { pad?: number; minWidth?: number; minHeight?: number } = {}): Box {
  const pad = opts.pad ?? 32;
  const full: Box = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const fromFindings = report.findings.flatMap((f) => [f.design?.box, f.page?.box, f.region?.box].filter((b): b is Box => b !== undefined));
  const fromPixels = report.visual?.regions.map((r) => r.box) ?? [];
  const base = union(fromFindings.length ? fromFindings : fromPixels);
  if (!base) return full;

  const w = Math.min(canvas.width, Math.max(opts.minWidth ?? 480, base.width + 2 * pad));
  const h = Math.min(canvas.height, Math.max(opts.minHeight ?? 180, base.height + 2 * pad));
  const cx = base.x + base.width / 2;
  const cy = base.y + base.height / 2;
  const x = Math.max(0, Math.min(canvas.width - w, cx - w / 2));
  const y = Math.max(0, Math.min(canvas.height - h, cy - h / 2));
  const region = { x, y, width: w, height: h };
  return region.width * region.height > 0.55 * canvas.width * canvas.height ? full : region;
}

/** Los hallazgos que se dibujan y se listan: primero los más graves. */
export function topFindings(report: Report, max = 6): Finding[] {
  return [...report.findings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity)).slice(0, max);
}

/** Un `diff` legible de lo que se cambió en el código para sembrar el error. */
export function editsAsDiff(mutation: Mutation): string {
  if (mutation.edits.length === 0) return "(sin cambios: es la página tal como se diseñó)";
  const lines = (t: string) => t.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  return mutation.edits.map((e) => [`# ${e.file}`, ...lines(e.find).map((l) => `- ${l}`), ...lines(e.replace).map((l) => `+ ${l}`)].join("\n")).join("\n\n");
}

export interface CardInput {
  mutation: Mutation;
  result: MutationResult;
  run: MutationRun;
  designPng: Buffer;
}

const PANEL = 520;
const MAX_PANEL_HEIGHT = 520;
/** Ancho útil de la tarjeta (1700 menos márgenes) para los paneles apilados. */
const STACK_WIDTH = 1600;
const STACK_MAX_HEIGHT = 380;

function panel(title: string, png: Buffer, region: Box, canvas: { width: number; height: number }, k: number, boxes: { box: Box; style: "dashed" | "solid" }[]): string {
  const w = region.width * k;
  const h = region.height * k;
  const boxHtml = boxes.map(({ box, style }) => `<div class="hl ${style}" style="left:${(box.x - region.x) * k}px;top:${(box.y - region.y) * k}px;width:${box.width * k}px;height:${box.height * k}px"></div>`).join("");
  return `<figure><figcaption>${esc(title)}</figcaption><div class="frame" style="width:${w}px;height:${h}px"><img src="data:image/png;base64,${png.toString("base64")}" style="left:${-region.x * k}px;top:${-region.y * k}px;width:${canvas.width * k}px">${boxHtml}</div></figure>`;
}

/** HTML de la tarjeta de caso (autocontenido salvo las fuentes, que se cargan de archivos locales). */
export function cardHtml(input: CardInput): string {
  const { mutation, result, run } = input;
  const report = run.report;
  const canvas = { width: Math.max(report.design.canvas.width, report.page.canvas.width), height: Math.max(report.design.canvas.height, report.page.canvas.height) };
  const region = storyRegion(report, canvas);
  // Una región muy ancha (varias tarjetas en fila) se ve diminuta en tres columnas: se apilan los tres paneles a todo el ancho.
  const stacked = region.width / region.height > 2;
  const k = stacked ? Math.min(STACK_WIDTH / region.width, STACK_MAX_HEIGHT / region.height) : Math.min(PANEL / region.width, MAX_PANEL_HEIGHT / region.height);
  const top = topFindings(report);
  const designBoxes = top.flatMap((f) => (f.design ? [{ box: f.design.box, style: "dashed" as const }] : []));
  const pageBoxes = top.flatMap((f) => (f.page ? [{ box: f.page.box, style: "solid" as const }] : f.region ? [{ box: f.region.box, style: "solid" as const }] : []));
  const heatBoxes = (report.visual?.regions ?? []).map((r) => ({ box: r.box, style: "solid" as const }));

  const ok = result.passed;
  const verdict = mutation.expected.length === 0 ? (result.findings.length === 0 ? "Paridad no reportó nada, como debía (era ruido)." : `Paridad reportó ${result.findings.length} hallazgos donde no debía.`) : ok ? "Paridad encontró lo que se sembró, con la severidad esperada." : "Paridad no acertó del todo en este caso.";
  const counts = ORDER.map((s) => ({ s, n: report.summary.bySeverity[s] ?? 0 })).filter((x) => x.n > 0);
  const font = (file: string) => pathToFileURL(new URL(file, FONTS).pathname).href;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
@font-face{font-family:"Bricolage";font-weight:800;src:url("${font("bricolage-grotesque-latin-800-normal.woff2")}")}
@font-face{font-family:"Instrument";font-weight:400;src:url("${font("instrument-sans-latin-400-normal.woff2")}")}
@font-face{font-family:"Instrument";font-weight:600;src:url("${font("instrument-sans-latin-600-normal.woff2")}")}
*{box-sizing:border-box}body{margin:0;background:#fafaf8;color:#2b2f36;font:400 18px/1.45 Instrument,sans-serif}
.card{width:1700px;padding:44px 48px 40px}
.top{display:flex;align-items:center;gap:14px;margin-bottom:10px}
.pill{background:#043565;color:#fff;font:800 16px Bricolage;padding:5px 16px;border-radius:999px}
.type{color:#6a707a;font-weight:600;text-transform:uppercase;letter-spacing:.06em;font-size:14px}
h1{font:800 44px/1.08 Bricolage;color:#0e1116;margin:6px 0 8px;letter-spacing:-.01em;max-width:1500px}
.score{font:800 64px/1 Bricolage;color:#0e1116;white-space:nowrap;flex-shrink:0}.score small{font-size:24px;color:#6a707a}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:32px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.sev{display:inline-flex;gap:6px;border:1.5px solid;border-radius:999px;padding:2px 14px;font-weight:600;font-size:16px;white-space:nowrap;flex-shrink:0;align-self:flex-start}
.panels{display:flex;gap:20px;margin:26px 0 22px;align-items:flex-start}.panels.stacked{flex-direction:column;gap:16px}
figure{margin:0}figcaption{font-weight:600;color:#0e1116;margin-bottom:8px;font-size:17px}
.frame{position:relative;overflow:hidden;border:1px solid #dadde2;border-radius:10px;background:#ecedef}
.frame img{position:absolute;display:block}
.hl{position:absolute;border:3px solid #043565;background:rgba(4,53,101,.10)}.hl.dashed{border-style:dashed}
.cols{display:grid;grid-template-columns:1.25fr 1fr;gap:28px}
h2{font:800 22px Bricolage;color:#0e1116;margin:0 0 10px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
li{display:flex;gap:10px;align-items:baseline}
li .t{overflow-wrap:anywhere}
pre{margin:0;background:#0e1116;color:#e8eaee;border-radius:10px;padding:14px 16px;font:14px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.verdict{margin-top:20px;border:1.5px solid ${ok ? "#043565" : "#8a0f1f"};border-radius:12px;padding:12px 16px;font-weight:600;color:${ok ? "#043565" : "#8a0f1f"}}
.foot{margin-top:16px;color:#6a707a;font-size:14px}
</style></head><body><div class="card">
<div class="top"><span class="pill">Paridad</span><span class="type">${esc(mutation.errorType.replace(/-/g, " "))}</span></div>
<div class="head"><div><h1>${esc(mutation.description)}</h1>
<div class="chips">${counts.map(({ s, n }) => `<span class="sev" style="color:${SEVERITY_COLORS[s][0]};background:${SEVERITY_COLORS[s][1]};border-color:${SEVERITY_COLORS[s][0]}">${SEVERITY_SHAPE[s]} ${n} ${SEVERITY_LABEL[s].toLowerCase()}${n === 1 ? "" : "s"}</span>`).join("") || '<span class="sev" style="color:#1f4b8a;background:#e6effb;border-color:#1f4b8a">Sin hallazgos</span>'}</div></div>
<div class="score" aria-label="Puntaje">${report.score.value}<small> / 100</small></div></div>
<div class="panels${stacked ? " stacked" : ""}">${panel("Diseño (Figma)", input.designPng, region, canvas, k, designBoxes)}${panel("Código (lo que se construyó)", run.screenshot, region, canvas, k, pageBoxes)}${panel("Diferencia de píxeles", run.heatmap, region, canvas, k, heatBoxes)}</div>
<div class="cols"><div><h2>Qué encontró Paridad</h2>${
    top.length
      ? `<ul>${top.map((f) => `<li><span class="sev" style="color:${SEVERITY_COLORS[f.severity][0]};background:${SEVERITY_COLORS[f.severity][1]};border-color:${SEVERITY_COLORS[f.severity][0]}">${SEVERITY_SHAPE[f.severity]} ${SEVERITY_LABEL[f.severity]}</span><span class="t">${esc(f.title)}</span></li>`).join("")}</ul>${report.findings.length > top.length ? `<p class="foot">…y ${report.findings.length - top.length} hallazgos más.</p>` : ""}`
      : "<p>Nada: el código coincide con el diseño dentro de las tolerancias.</p>"
  }</div><div><h2>Qué se cambió en el código</h2><pre>${esc(editsAsDiff(mutation))}</pre></div></div>
<div class="verdict">${esc(verdict)}</div>
<p class="foot">Página de ejemplo ficticia («Casa Nube»). Cada hallazgo es una medición: valor esperado frente a valor obtenido.</p>
</div></body></html>`;
}

/** Renderiza la tarjeta a JPEG (1.5x: nítida para una persona sin pesar de más en el repositorio). */
export async function renderCard(browser: Browser, input: CardInput, htmlPath: string): Promise<Buffer> {
  writeFileSync(htmlPath, cardHtml(input));
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 900 }, deviceScaleFactor: 1.5 });
  try {
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    // JPEG de calidad alta: una tarjeta con capturas y texto pesa ~3 veces menos que en PNG y sirve igual para el portafolio.
    return await page.locator(".card").screenshot({ type: "jpeg", quality: 84 });
  } finally {
    await ctx.close();
  }
}

export function caseMarkdown(input: CardInput): string {
  const { mutation, result, run } = input;
  const report = run.report;
  const lines = [
    `# ${mutation.description}`,
    "",
    `![Historia del caso](historia.jpg)`,
    "",
    `- **Tipo de error:** ${mutation.errorType}`,
    `- **Puntaje de paridad:** ${report.score.value} / 100`,
    `- **Hallazgos:** ${ORDER.map((s) => `${report.summary.bySeverity[s] ?? 0} ${SEVERITY_LABEL[s].toLowerCase()}s`).join(" · ")}`,
    `- **Resultado de la evaluación:** ${result.passed ? "✅ acertó" : "❌ no acertó del todo"}${mutation.hard ? " (caso difícil)" : ""}`,
    "",
    "## Lo que se cambió en el código",
    "",
    "```diff",
    editsAsDiff(mutation),
    "```",
    "",
    "## Lo que Paridad encontró",
    "",
    ...(report.findings.length ? topFindings(report, 12).map((f) => `- **${SEVERITY_LABEL[f.severity]}** · ${f.title}\n  - ${f.evidence.property}: diseño \`${JSON.stringify(f.evidence.expected)}\` · código \`${JSON.stringify(f.evidence.actual)}\``) : ["Nada."]),
    ...(report.findings.length > 12 ? ["", `…y ${report.findings.length - 12} más.`] : []),
  ];
  const wrong = result.expectations.filter((x) => !x.detected || x.severityOk === false);
  const fps = result.findings.filter((f) => f.class === "falso-positivo");
  if (wrong.length || fps.length) {
    lines.push("", "## Dónde falló Paridad", "");
    for (const x of wrong) lines.push(`- Esperaba «${x.expectation.rule}» sobre ${x.expectation.designId ?? x.expectation.designIdPattern ?? "cualquier elemento"}: ${x.detected ? "se encontró con otra severidad" : "no se encontró"}.`);
    for (const f of fps) lines.push(`- Falso positivo [${f.severity}] ${f.rule}: ${f.title}`);
  }
  lines.push("", "> Pasos para un caso de portafolio: la imagen es la historia visual; el `diff` es la causa; los hallazgos son la evidencia. Sin nombres de empresas ni de clientes.", "");
  return lines.join("\n");
}

export interface SavedCase {
  id: string;
  dir: string;
  passed: boolean;
  title: string;
  errorType: string;
  score: number;
}

/** Guarda un caso: `historia.jpg` (la tarjeta, que ya trae diseño, código y diferencia) y `caso.md`. */
export async function saveCase(browser: Browser, outDir: string, input: CardInput): Promise<SavedCase> {
  const dir = join(outDir, input.mutation.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "historia.jpg"), await renderCard(browser, input, join(dir, ".tarjeta.html")));
  writeFileSync(join(dir, "caso.md"), caseMarkdown(input));
  // La tarjeta temporal no es un entregable.
  rmSync(join(dir, ".tarjeta.html"), { force: true });
  return { id: input.mutation.id, dir, passed: input.result.passed, title: input.mutation.description, errorType: input.mutation.errorType, score: input.run.report.score.value };
}

/** `README.md` del cuaderno de casos: un índice agrupado por tipo de error, con sus miniaturas. */
export function indexMarkdown(cases: SavedCase[], outDir: string): string {
  const byType = new Map<string, SavedCase[]>();
  for (const c of cases) byType.set(c.errorType, [...(byType.get(c.errorType) ?? []), c]);
  const lines = ["# Casos para el portafolio", "", "Cada carpeta es una historia: un error de implementación conocido sobre la página de ejemplo (ficticia), lo que Paridad encontró y cómo se ve. `historia.jpg` es la tarjeta lista para publicar; `caso.md` trae la causa y la evidencia. Se regeneran con `npm run casos`. En el repositorio solo se guardan las historias elegidas para el portafolio (las demás se regeneran con ese comando); aquí aparecen todas.", "", `Casos: **${cases.length}** · acertados: **${cases.filter((c) => c.passed).length}** · con fallos: **${cases.filter((c) => !c.passed).length}**`, ""];
  for (const [type, list] of [...byType].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${type.replace(/-/g, " ")}`, "");
    for (const c of list) lines.push(`- ${c.passed ? "✅" : "❌"} [${c.title}](${relative(outDir, c.dir)}/caso.md) · puntaje ${c.score}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function readDesignPng(): Buffer {
  return readFileSync(landing.designImage);
}
