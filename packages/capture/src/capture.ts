import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { assertSnapshot, type IgnoreZone, type Snapshot, type SnapshotInput } from "@paridad/core";
import { pngSize } from "./png.ts";
import { assertAllowedUrl } from "./url.ts";

const EXTRACTOR = readFileSync(new URL("./in-page/extract.js", import.meta.url), "utf8");

/** Se inyecta para que la captura no dependa del instante de una animación. */
const FREEZE_CSS = `*, *::before, *::after {
  animation: none !important; transition: none !important; scroll-behavior: auto !important; caret-color: transparent !important;
}`;

export interface CaptureOptions {
  /** URL que usted indicó (http, https o file). */
  url: string;
  /** Ancho de la ventana en px CSS; debe ser el del frame de Figma. */
  width: number;
  /** Alto de la ventana; no limita la captura (es de página completa). Por defecto 900. */
  height?: number;
  /** Escala de la imagen (1 o 2). Las cajas siempre van en px CSS. */
  scale?: 1 | 2;
  /** Zonas a ignorar: por selector CSS o por rectángulo (px CSS, coordenadas de página). */
  ignore?: IgnoreZone[];
  /** Nombre para el reporte; por defecto, el título de la página. */
  name?: string;
  /** Tiempo máximo de carga en ms. Por defecto 30 000. */
  timeoutMs?: number;
  /** Nombre de archivo de la imagen dentro del snapshot. Por defecto «screenshot.png». */
  imageName?: string;
}

export interface CaptureResult {
  snapshot: Snapshot;
  /** PNG de la página completa. */
  screenshot: Buffer;
}

interface ExtractedElement extends Record<string, unknown> {
  _textIdx?: number;
}
interface Extracted {
  elements: ExtractedElement[];
  ignoredRects: { x: number; y: number; width: number; height: number }[];
  rootBg: string;
  title: string;
  loadedFonts: { family: string; weight: string }[];
  scrollWidth: number;
  scrollHeight: number;
}

/** Espera a que la página esté realmente quieta: red, fuentes, imágenes y carga diferida. */
async function settle(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  // Recorre la página para que se carguen imágenes `loading="lazy"` y vuelve al inicio.
  await page.evaluate(async () => {
    const step = Math.max(200, window.innerHeight * 0.8);
    for (let y = 0, guard = 0; y < document.documentElement.scrollHeight && guard < 60; y += step, guard++) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined)));
  });
}

/** Pide a Chromium qué fuente se pintó de verdad en cada texto (la declarada puede no haber cargado). */
async function renderedFonts(page: Page, count: number): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (count === 0) return out;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const indexes = Array.from({ length: count }, (_, i) => i);
    for (let i = 0; i < indexes.length; i += 40) {
      await Promise.all(
        indexes.slice(i, i + 40).map(async (idx) => {
          try {
            const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-paridad-i="${idx}"]` });
            if (!nodeId) return;
            const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
            const best = [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0];
            if (best?.familyName) out.set(idx, best.familyName);
          } catch {
            /* un nodo que desapareció no debe tirar la captura */
          }
        }),
      );
    }
  } finally {
    await cdp.detach().catch(() => {});
  }
  return out;
}

const canon = (s: string): string => s.toLowerCase().replace(/["']/g, "").replace(/\s+/g, " ").trim();

/**
 * Chromium informa el nombre interno de la fuente («Bricolage Grotesque 96pt ExtraBold»), no el que
 * pide el CSS. Si empieza con la familia declarada se considera la misma; si no, se deja el nombre
 * real para que se vea que se usó otra (fuente de respaldo).
 */
export function canonicalRenderedFont(declared: string | undefined, rendered: string): string {
  if (declared && (canon(rendered) === canon(declared) || canon(rendered).startsWith(`${canon(declared)} `))) return declared;
  return rendered;
}

/** Paleta realmente usada por la página: colores por frecuencia y familias con sus pesos. */
function usedPalette(elements: SnapshotInput["elements"]): NonNullable<SnapshotInput["palette"]> {
  const colors = new Map<string, number>();
  const fonts = new Map<string, Set<number>>();
  for (const e of elements) {
    for (const c of [e.style.color, e.style.background, e.style.border?.color]) if (c) colors.set(c, (colors.get(c) ?? 0) + 1);
    if (e.style.fontFamily) {
      const set = fonts.get(e.style.fontFamily) ?? new Set<number>();
      set.add(e.style.fontWeight ?? 400);
      fonts.set(e.style.fontFamily, set);
    }
  }
  return {
    colors: [...colors].sort((a, b) => b[1] - a[1]).map(([hex]) => ({ hex })),
    fonts: [...fonts].map(([family, w]) => ({ family, weights: [...w].sort((a, b) => a - b) })),
  };
}

/**
 * Captura una página con condiciones fijas y devuelve su snapshot y su imagen.
 * Condiciones: ventana del ancho del frame, escala fija, animaciones y transiciones apagadas,
 * `prefers-reduced-motion`, zona horaria UTC, y espera a red inactiva + `document.fonts.ready`.
 */
export async function capturePage(options: CaptureOptions, browser?: Browser): Promise<CaptureResult> {
  const url = assertAllowedUrl(options.url);
  const scale = options.scale ?? 1;
  const height = options.height ?? 900;
  const timeout = options.timeoutMs ?? 30_000;
  const ignore = options.ignore ?? [];

  const ownBrowser = !browser;
  const b = browser ?? (await chromium.launch());
  try {
    const context = await b.newContext({
      viewport: { width: options.width, height },
      deviceScaleFactor: scale,
      reducedMotion: "reduce",
      colorScheme: "light",
      locale: "es-MX",
      timezoneId: "UTC",
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage();
      await page.goto(url.href, { waitUntil: "load", timeout });
      await page.addStyleTag({ content: FREEZE_CSS });
      await settle(page, timeout);

      // La imagen mide siempre el ancho de la ventana (= el del frame). Si la página se desborda
      // horizontalmente, eso no se recorta del snapshot: la raíz «page» queda más ancha que el lienzo.
      const pageHeight = await page.evaluate(() => Math.max(1, document.documentElement.scrollHeight));
      const screenshot = await page.screenshot({
        fullPage: true,
        clip: { x: 0, y: 0, width: options.width, height: pageHeight },
        animations: "disabled",
        caret: "hide",
        scale: "device",
      });
      const { width: pxW, height: pxH } = pngSize(screenshot);

      await page.evaluate(() => window.scrollTo(0, 0));
      const ignoreSelectors = ignore.flatMap((z) => ("selector" in z ? [z.selector] : []));
      const ignoreRects = ignore.flatMap((z) => ("rect" in z ? [z.rect] : []));
      const extracted = (await page.evaluate(`(${EXTRACTOR})(${JSON.stringify({ ignoreSelectors, ignoreRects })})`)) as Extracted;

      const fontByIdx = await renderedFonts(page, extracted.elements.filter((e) => e._textIdx !== undefined).length);
      await page.evaluate(() => document.querySelectorAll("[data-paridad-i]").forEach((n) => n.removeAttribute("data-paridad-i")));

      const canvasW = Math.round(pxW / scale);
      const canvasH = Math.round(pxH / scale);

      const elements = extracted.elements.map((raw) => {
        const { _textIdx, ...el } = raw;
        const e = el as unknown as SnapshotInput["elements"][number];
        if (_textIdx !== undefined) {
          const rendered = fontByIdx.get(_textIdx);
          if (rendered) e.style = { ...e.style, renderedFontFamily: canonicalRenderedFont(e.style.fontFamily, rendered) };
        }
        return e;
      });

      const root: SnapshotInput["elements"][number] = {
        id: "page",
        kind: "box",
        name: "Página",
        path: "body",
        parentId: null,
        z: -1,
        box: { x: 0, y: 0, width: Math.max(canvasW, extracted.scrollWidth), height: canvasH },
        style: { background: extracted.rootBg },
      };
      const all = [root, ...elements].map((e, i) => ({ ...e, z: i }));

      // Las zonas por selector también se dejan resueltas como rectángulos (para la diferencia visual).
      const clamp = (r: { x: number; y: number; width: number; height: number }) => {
        const x = Math.max(0, r.x);
        const y = Math.max(0, r.y);
        return { x, y, width: Math.min(canvasW - x, r.x + r.width - x), height: Math.min(canvasH - y, r.y + r.height - y) };
      };
      const resolved = extracted.ignoredRects.map(clamp).filter((r) => r.width > 0 && r.height > 0);
      const userRects = ignoreRects.map(clamp).filter((r) => r.width > 0 && r.height > 0);

      const input: SnapshotInput = {
        schemaVersion: 1,
        source: "page",
        meta: {
          name: options.name ?? (extracted.title || url.hostname || "página"),
          capturedAt: new Date().toISOString(),
          origin: { url: url.href },
          tool: `paridad-capture · playwright 1.63.0 · chromium ${b.version()}`,
        },
        canvas: { width: canvasW, height: canvasH, scale, image: { path: options.imageName ?? "screenshot.png", width: pxW, height: pxH } },
        palette: usedPalette(all),
        ignore: [...ignore.filter((z) => "selector" in z), ...[...userRects, ...resolved].map((rect) => ({ rect }))],
        elements: all,
      };
      return { snapshot: assertSnapshot(input, "snapshot capturado"), screenshot };
    } finally {
      await context.close();
    }
  } finally {
    if (ownBrowser) await b.close();
  }
}
