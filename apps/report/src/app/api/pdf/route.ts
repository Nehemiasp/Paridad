import { isLocalHost } from "../../../lib/local.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PDF del reporte: abre la vista de impresión de esta misma app en Chromium (Playwright) y la imprime.
 * Solo se acepta un origen local: la ruta no debe servir para que el servidor visite otras direcciones.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!isLocalHost(url.hostname)) return Response.json({ error: "El PDF solo se genera desde localhost." }, { status: 400 });
  const tab = url.searchParams.get("tab") ?? "0";
  if (!/^\d{1,3}$/.test(tab)) return Response.json({ error: "Pestaña inválida." }, { status: 400 });

  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${url.origin}/?tab=${tab}&print=1`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" } });
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="paridad-reporte-${tab}.pdf"`, "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: `No se pudo generar el PDF: ${error instanceof Error ? error.message : String(error)}. Puede usar «Imprimir» y guardar como PDF desde el navegador.` }, { status: 500 });
  } finally {
    await browser?.close();
  }
}
