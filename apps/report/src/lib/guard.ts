import { timingSafeEqual } from "node:crypto";
import { isLocalHost } from "./local.ts";
import { store } from "./store.ts";

/** Cabecera propia que el formulario añade a sus peticiones: una página de otro sitio no puede ponerla sin permiso de CORS. */
export const HEADER = "x-paridad";

/** Token de esta sesión del servidor: se incrusta en la página al servirla y las rutas de escritura lo exigen. */
export const sessionToken = (): string => store().token;

const hostOf = (value: string | null): string | undefined => {
  if (!value) return undefined;
  try {
    // `Host` trae «127.0.0.1:43559»; `Origin` trae «http://127.0.0.1:43559».
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return undefined;
  }
};

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const denyResponse = (error: string) => Response.json({ error }, { status: 403 });

/** Para lecturas: solo exige que la petición venga dirigida a localhost (frena el DNS rebinding). */
export function guardHost(req: Request): Response | undefined {
  const host = hostOf(req.headers.get("host"));
  return host && isLocalHost(host) ? undefined : denyResponse("Esta acción solo se acepta desde localhost.");
}

/**
 * Defensa de las rutas que ejecutan cosas (CSRF y DNS rebinding): `Host` local, `Origin` local (si lo trae)
 * y el token de sesión en la cabecera propia. Devuelve la respuesta de rechazo, o `undefined` si todo está en orden.
 */
export function guardWrite(req: Request, token: string = sessionToken()): Response | undefined {
  const deny = denyResponse;
  const hostDenied = guardHost(req);
  if (hostDenied) return hostDenied;
  const host = hostOf(req.headers.get("host"))!;
  const origin = req.headers.get("origin");
  if (origin !== null) {
    const o = hostOf(origin);
    if (!o || !isLocalHost(o) || o !== host) return deny("Origen no permitido.");
  }
  const sent = req.headers.get(HEADER);
  if (!sent || !same(sent, token)) return deny("Falta la credencial de la sesión: recargue la página de Paridad e inténtelo de nuevo.");
  return undefined;
}
