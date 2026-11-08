export interface FigmaTarget {
  /** Clave del archivo (o de la rama, si la URL apunta a una). */
  fileKey: string;
  /** Id del nodo con dos puntos, como lo pide la API (`1:2`). */
  nodeId: string;
}

/**
 * Convierte una URL de Figma (`figma.com/design/<key>/…?node-id=1-2`) en clave de archivo e id de nodo.
 * Acepta `/design/`, `/file/` y ramas (`/design/<key>/branch/<branchKey>/…`, donde manda la rama).
 */
export function parseFigmaUrl(raw: string): FigmaTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`«${raw}» no es una URL válida. Copie el enlace del frame desde Figma (clic derecho → Copy link to selection).`);
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) {
    throw new Error(`«${url.hostname}» no es un dominio de Figma.`);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const kind = parts[0];
  if (kind !== "design" && kind !== "file") {
    throw new Error(`Solo se admiten URL de archivos de diseño (figma.com/design/…), no «${kind ?? ""}».`);
  }
  const branchAt = parts.indexOf("branch");
  const fileKey = branchAt === 2 ? parts[3] : parts[1];
  if (!fileKey) throw new Error("La URL no incluye la clave del archivo.");

  const rawNode = url.searchParams.get("node-id");
  if (!rawNode) {
    throw new Error("La URL no indica un frame. Seleccione el frame en Figma y copie el enlace de la selección (debe incluir node-id=…).");
  }
  // `1-2` es la forma de la URL; la API usa `1:2`. También llegan `1%3A2` y las instancias `I1:2;3:4`.
  const nodeId = decodeURIComponent(rawNode).replace(/-/g, ":");
  if (!/^[A-Za-z]?\d+:\d+(;\d+:\d+)*$/.test(nodeId)) throw new Error(`El node-id «${rawNode}» no tiene un formato válido.`);
  return { fileKey, nodeId };
}
