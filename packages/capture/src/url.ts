/**
 * Paridad solo captura páginas que el usuario indica de forma explícita (localhost o una URL
 * que pasa a mano). Nunca sigue enlaces ni rastrea. Aquí además se limita el protocolo.
 */
const ALLOWED = new Set(["http:", "https:", "file:"]);

export function assertAllowedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`«${raw}» no es una URL válida. Use una dirección completa, por ejemplo http://localhost:3000.`);
  }
  if (!ALLOWED.has(url.protocol)) {
    throw new Error(`No se admite el protocolo «${url.protocol}». Use http://, https:// o file://.`);
  }
  return url;
}
