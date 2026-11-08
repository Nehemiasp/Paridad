/**
 * Normaliza un texto para poder compararlo entre Figma y el DOM:
 * NFKC (unifica ligaduras y caracteres de ancho completo), todos los tipos de
 * espacio (incluido el espacio duro) colapsados a uno solo, y sin espacios en los extremos.
 * No cambia mayúsculas: «Comprar» y «COMPRAR» pueden ser un error real de copia.
 */
export function normalizeText(content: string): string {
  return content.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
