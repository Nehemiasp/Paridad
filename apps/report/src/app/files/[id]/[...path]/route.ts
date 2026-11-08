import { readFile } from "node:fs/promises";
import { safeResolve } from "../../../../lib/files.ts";
import { parseEntries } from "../../../../lib/load.ts";

export const dynamic = "force-dynamic";

/** Sirve las imágenes de un reporte (diseño, página, mapa de calor) y nada más: ver `safeResolve`. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = await params;
  const entry = parseEntries(process.env.PARIDAD_REPORTS).find((e) => e.id === id);
  const file = entry ? safeResolve(entry.dir, path) : undefined;
  if (!file) return new Response("No encontrado", { status: 404 });
  try {
    const body = await readFile(file.path);
    return new Response(new Uint8Array(body), { headers: { "content-type": file.contentType, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
