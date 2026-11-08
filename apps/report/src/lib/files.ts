import { resolve, sep, extname } from "node:path";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/**
 * Resuelve un archivo pedido por la web dentro de la carpeta de un reporte, o `undefined` si no se debe servir:
 * sale de la carpeta (`..`, rutas absolutas, enlaces codificados) o no es una imagen. Es la única puerta del servidor al disco.
 */
export function safeResolve(baseDir: string, segments: string[]): { path: string; contentType: string } | undefined {
  const base = resolve(baseDir);
  let decoded: string[];
  try {
    decoded = segments.map((s) => decodeURIComponent(s));
  } catch {
    return undefined;
  }
  if (decoded.some((s) => s === "" || s.includes("\0") || s.includes("/") || s.includes("\\") || s === ".." || s === ".")) return undefined;
  const path = resolve(base, ...decoded);
  if (path !== base && !path.startsWith(base + sep)) return undefined;
  const contentType = TYPES[extname(path).toLowerCase()];
  return contentType ? { path, contentType } : undefined;
}
