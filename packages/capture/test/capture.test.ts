import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSnapshot, parseSnapshot } from "@paridad/core";
import { landing, readLandingDesignSnapshot } from "@paridad/fixtures";
import { assertAllowedUrl, canonicalRenderedFont, capturePage, pngSize, writeCapture, type CaptureResult } from "../src/index.ts";
import { fileUrl, serveDir } from "./helpers.ts";

const pages = fileURLToPath(new URL("./pages/", import.meta.url));
const design = assertSnapshot(readLandingDesignSnapshot());

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

const textOf = (r: CaptureResult, pred: (t: string) => boolean) =>
  r.snapshot.elements.find((e) => e.text && pred(e.text.normalized));

describe("assertAllowedUrl", () => {
  it("admite http, https y file", () => {
    for (const u of ["http://localhost:3000", "https://ejemplo.com/a", "file:///tmp/x.html"]) {
      expect(() => assertAllowedUrl(u)).not.toThrow();
    }
  });
  it("rechaza otros protocolos y textos que no son URL, con mensaje en español", () => {
    expect(() => assertAllowedUrl("javascript:alert(1)")).toThrow(/No se admite el protocolo/);
    expect(() => assertAllowedUrl("ftp://x.com")).toThrow(/No se admite el protocolo/);
    expect(() => assertAllowedUrl("localhost:3000/ruta")).toThrow(/protocolo|URL válida/);
    expect(() => assertAllowedUrl("no es una url")).toThrow(/no es una URL válida/);
  });
});

describe("capturePage · página de ejemplo (landing)", () => {
  let r1: CaptureResult;
  beforeAll(async () => {
    r1 = await capturePage({ url: fileUrl(landing.pageIndex), width: 1440 }, browser);
  });

  it("genera un snapshot válido de tipo «page» con la imagen del tamaño correcto", () => {
    expect(parseSnapshot(r1.snapshot).ok).toBe(true);
    expect(r1.snapshot.source).toBe("page");
    expect(r1.snapshot.canvas).toMatchObject({ width: 1440, height: 927, scale: 1 });
    expect(pngSize(r1.screenshot)).toEqual({ width: 1440, height: 927 });
    expect(r1.snapshot.meta.origin.url).toMatch(/^file:\/\//);
  });

  it("encuentra los mismos textos que el diseño, y solo esos", () => {
    const page = r1.snapshot.elements.filter((e) => e.text).map((e) => e.text!.normalized).sort();
    const want = design.elements.filter((e) => e.text).map((e) => e.text!.normalized).sort();
    expect(page).toEqual(want);
  });

  it("las cajas de las tarjetas coinciden con el diseño (±0.5 px)", () => {
    const cards = r1.snapshot.elements.filter((e) => e.kind === "box" && e.style.radius === 16);
    const want = design.elements.filter((e) => /^tarjeta-\d$/.test(e.id));
    expect(cards).toHaveLength(3);
    cards.forEach((c, i) => {
      for (const k of ["x", "y", "width", "height"] as const) expect(c.box[k]).toBeCloseTo(want[i]!.box[k], 0);
    });
  });

  it("los textos coinciden con el diseño en posición, tamaño y estilo", () => {
    for (const d of design.elements.filter((e) => e.text)) {
      const p = textOf(r1, (t) => t === d.text!.normalized)!;
      expect(p, `falta «${d.text!.normalized}»`).toBeDefined();
      for (const k of ["x", "y", "width", "height"] as const) expect(Math.abs(p.box[k] - d.box[k]), `${d.id}.${k}`).toBeLessThan(0.5);
      expect(p.style).toMatchObject({
        fontFamily: d.style.fontFamily,
        fontSize: d.style.fontSize,
        fontWeight: d.style.fontWeight,
        lineHeight: d.style.lineHeight,
        color: d.style.color,
      });
      expect(p.style.letterSpacing).toBeCloseTo(d.style.letterSpacing ?? 0, 2);
    }
  });

  it("registra la fuente que se pintó de verdad y coincide con la declarada", () => {
    const withFont = r1.snapshot.elements.filter((e) => e.text);
    expect(withFont.length).toBeGreaterThan(10);
    for (const e of withFont) expect(e.style.renderedFontFamily, e.id).toBe(e.style.fontFamily);
  });

  it("resuelve la jerarquía: el texto del botón cuelga del botón", () => {
    const label = textOf(r1, (t) => t === "Ver la colección")!;
    const parent = r1.snapshot.elements.find((e) => e.id === label.parentId)!;
    expect(parent.style.background).toBe("#043565");
    expect(parent.parentId).toBe("page");
  });

  it("es determinista: dos capturas dan los mismos elementos", async () => {
    const r2 = await capturePage({ url: fileUrl(landing.pageIndex), width: 1440 }, browser);
    expect(r2.snapshot.elements).toEqual(r1.snapshot.elements);
    expect(r2.screenshot.equals(r1.screenshot)).toBe(true);
  });

  it("escala 2: imagen al doble, cajas en px CSS", async () => {
    const r = await capturePage({ url: fileUrl(landing.pageIndex), width: 1440, scale: 2 }, browser);
    expect(pngSize(r.screenshot)).toEqual({ width: 2880, height: 1854 });
    expect(r.snapshot.canvas).toMatchObject({ width: 1440, height: 927, scale: 2 });
    expect(r.snapshot.elements).toEqual(r1.snapshot.elements);
  });

  it("la paleta usada incluye el azul del botón y las fuentes de la marca", () => {
    expect(r1.snapshot.palette!.colors.map((c) => c.hex)).toContain("#043565");
    expect(r1.snapshot.palette!.fonts.map((f) => f.family).sort()).toEqual(["Bricolage Grotesque", "Instrument Sans"]);
  });

  it("también funciona contra una URL http de localhost", async () => {
    const server = await serveDir(landing.pageDir);
    try {
      const r = await capturePage({ url: server.url, width: 1440 }, browser);
      expect(r.snapshot.meta.origin.url).toBe(server.url);
      expect(r.snapshot.elements).toEqual(r1.snapshot.elements);
    } finally {
      await server.close();
    }
  });

  it("fixtures/landing/page.snapshot.json sigue igual a una captura fresca (si falla, regenérelo a propósito)", () => {
    const committed = assertSnapshot(JSON.parse(readFileSync(`${landing.dir}/page.snapshot.json`, "utf8")));
    expect(r1.snapshot.elements).toEqual(committed.elements);
    expect(r1.snapshot.canvas).toEqual({ ...committed.canvas, image: { ...committed.canvas.image!, path: "screenshot.png" } });
    expect(r1.snapshot.palette).toEqual(committed.palette);
  });

  it("a otro ancho, la página se reacomoda (un snapshot por tamaño)", async () => {
    const r = await capturePage({ url: fileUrl(landing.pageIndex), width: 390, height: 844 }, browser);
    expect(r.snapshot.canvas.width).toBe(390);
    expect(pngSize(r.screenshot).width).toBe(390);
    expect(r.snapshot.canvas.height).toBeGreaterThan(927);
  });

  it("si la página se desborda horizontalmente, la raíz queda más ancha que el lienzo (la imagen no)", async () => {
    // La página de ejemplo no es responsiva: a 390 px su encabezado no cabe.
    const r = await capturePage({ url: fileUrl(landing.pageIndex), width: 390, height: 844 }, browser);
    const root = r.snapshot.elements.find((e) => e.id === "page")!;
    expect(root.box.width).toBeGreaterThan(r.snapshot.canvas.width);
  });

  it("escribe snapshot.json y screenshot.png que se pueden volver a leer", () => {
    const dir = mkdtempSync(join(tmpdir(), "paridad-"));
    const { snapshotPath, screenshotPath } = writeCapture(r1, dir);
    expect(existsSync(screenshotPath)).toBe(true);
    expect(parseSnapshot(JSON.parse(readFileSync(snapshotPath, "utf8"))).ok).toBe(true);
    expect(pngSize(readFileSync(screenshotPath)).width).toBe(1440);
  });
});

describe("capturePage · textos cortados", () => {
  it("detecta ellipsis, line-clamp y overflow, y no marca el texto que cabe", async () => {
    const r = await capturePage({ url: fileUrl(`${pages}clipped.html`), width: 400 }, browser);
    const reason = (start: string) => textOf(r, (t) => t.startsWith(start))?.text?.clipped?.reason;
    expect(reason("Un texto bastante largo")).toBe("ellipsis");
    expect(reason("Un párrafo largo")).toBe("line-clamp");
    expect(reason("Primera línea")).toBe("overflow");
    expect(reason("Texto que cabe")).toBeUndefined();
  });
});

describe("capturePage · qué se incluye y cómo", () => {
  it("omite elementos ocultos o sin tamaño, y aplica text-transform", async () => {
    const r = await capturePage({ url: fileUrl(`${pages}hidden.html`), width: 400 }, browser);
    const texts = r.snapshot.elements.filter((e) => e.text).map((e) => e.text!.normalized);
    expect(texts).toContain("Visible");
    for (const t of ["Con display none", "Con visibility hidden", "Con opacidad cero"]) expect(texts).not.toContain(t);
    expect(texts).toContain("TEXTO EN MAYÚSCULAS");
    expect(r.snapshot.elements.some((e) => e.style.background === "#ff0000")).toBe(false);
  });

  it("convierte colores modernos (oklch), borde, radio y sombra", async () => {
    const r = await capturePage({ url: fileUrl(`${pages}hidden.html`), width: 400 }, browser);
    const box = r.snapshot.elements.find((e) => e.kind === "box" && e.style.border?.width === 2)!;
    expect(box.style.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(box.style.border).toEqual({ width: 2, style: "solid", color: "#333333" });
    expect(box.style.radius).toBe(8);
    expect(box.style.shadows).toEqual([{ x: 0, y: 2, blur: 4, spread: 0, color: "#00000033" }]);
  });

  it("zonas a ignorar por selector: quita el elemento y deja el rectángulo resuelto", async () => {
    const r = await capturePage({ url: fileUrl(`${pages}hidden.html`), width: 400, ignore: [{ selector: "#fecha" }] }, browser);
    expect(r.snapshot.elements.some((e) => e.text?.normalized.startsWith("Actualizado"))).toBe(false);
    expect(r.snapshot.ignore).toContainEqual({ selector: "#fecha" });
    expect(r.snapshot.ignore.some((z) => "rect" in z && z.rect.height > 20)).toBe(true);
  });

  it("zonas a ignorar por rectángulo: quita los elementos que quedan dentro", async () => {
    const base = await capturePage({ url: fileUrl(`${pages}hidden.html`), width: 400 }, browser);
    const f = base.snapshot.elements.find((e) => e.text?.normalized.startsWith("Actualizado"))!;
    const rect = { x: f.box.x - 4, y: f.box.y - 4, width: f.box.width + 8, height: f.box.height + 8 };
    const r = await capturePage({ url: fileUrl(`${pages}hidden.html`), width: 400, ignore: [{ rect }] }, browser);
    expect(r.snapshot.elements.some((e) => e.text?.normalized.startsWith("Actualizado"))).toBe(false);
    expect(r.snapshot.ignore).toContainEqual({ rect });
  });

  it("detecta que la fuente pedida no cargó: renderedFontFamily ≠ fontFamily", async () => {
    const r = await capturePage({ url: fileUrl(`${pages}fonts.html`), width: 400 }, browser);
    const p = textOf(r, (t) => t.startsWith("Este texto"))!;
    expect(p.style.fontFamily).toBe("Fuente Que No Existe");
    expect(p.style.renderedFontFamily).toBeTruthy();
    expect(p.style.renderedFontFamily).not.toBe("Fuente Que No Existe");
  });

  it("rechaza una URL no permitida antes de abrir el navegador", async () => {
    await expect(capturePage({ url: "ftp://ejemplo.com", width: 1440 })).rejects.toThrow(/protocolo/);
  });
});

describe("capturePage · sitios reales que nunca se quedan quietos", () => {
  // Dos cosas que una página real hace y las de prueba no: una imagen diferida oculta (el menú móvil) que nunca carga, y una
  // petición que nunca termina (píxeles de analítica o anuncios). Antes, `img.decode()` esperaba para siempre.
  it("termina aunque haya una imagen diferida que no carga y una petición colgada", async () => {
    const sockets = new Set<import("node:net").Socket>();
    const server = createServer((req, res) => {
      if (req.url === "/colgada.gif") return; // no responde nunca
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
        `<!doctype html><title>Colgada</title><body style="margin:0;font:16px sans-serif">
         <h1>Página con cabos sueltos</h1><p>Texto visible.</p>
         <script>addEventListener("load", () => setTimeout(() => { new Image().src = "/colgada.gif"; }, 50));</script>
         <div style="display:none"><img loading="lazy" src="/menu-movil.png" width="24" height="24" alt=""></div></body>`,
      );
    });
    server.on("connection", (s) => (sockets.add(s), s.on("close", () => sockets.delete(s))));
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as { port: number }).port;
    try {
      const started = Date.now();
      const r = await capturePage({ url: `http://127.0.0.1:${port}/`, width: 800, idleTimeoutMs: 300, timeoutMs: 20_000 }, browser);
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(textOf(r, (t) => t === "Texto visible.")).toBeDefined();
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  });
});

describe("capturePage · páginas con política de seguridad (CSP)", () => {
  it("captura una página cuya CSP prohíbe estilos y scripts en línea", async () => {
    const server = createServer((_req, res) => {
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'" })
        .end("<!doctype html><title>Con CSP</title><body style=\"margin:0\"><h1>Página protegida</h1><p>Texto bajo CSP.</p></body>");
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as { port: number }).port;
    try {
      const r = await capturePage({ url: `http://127.0.0.1:${port}/`, width: 800, idleTimeoutMs: 300, timeoutMs: 15_000 }, browser);
      expect(textOf(r, (t) => t === "Texto bajo CSP.")).toBeDefined();
    } finally {
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  });
});

describe("canonicalRenderedFont", () => {
  it("trata como la misma fuente el nombre interno que empieza con la familia declarada", () => {
    expect(canonicalRenderedFont("Bricolage Grotesque", "Bricolage Grotesque 96pt ExtraBold ExtraBold")).toBe("Bricolage Grotesque");
    expect(canonicalRenderedFont("Instrument Sans", "instrument sans")).toBe("Instrument Sans");
  });
  it("deja el nombre real cuando se usó otra fuente", () => {
    expect(canonicalRenderedFont("Instrument Sans", "DejaVu Sans")).toBe("DejaVu Sans");
    expect(canonicalRenderedFont("Inter", "Interstate")).toBe("Interstate");
    expect(canonicalRenderedFont(undefined, "Arial")).toBe("Arial");
  });
});
