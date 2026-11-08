import { assertAllowedUrl } from "@paridad/capture/url";
import { parseFigmaUrl } from "@paridad/figma/url";

/** Lo que manda el formulario. Todo llega como texto (o casilla) y se valida aquí, en el servidor: el formulario es solo una ayuda. */
export interface RawInput {
  demo?: unknown;
  figmaUrl?: unknown;
  pageUrl?: unknown;
  width?: unknown;
  scale?: unknown;
  /** Selectores CSS a ignorar, uno por línea. */
  ignore?: unknown;
  ai?: unknown;
  aiMaxCost?: unknown;
}

export type Field = "figmaUrl" | "pageUrl" | "width" | "scale" | "ignore" | "aiMaxCost" | "form";

export interface JobInput {
  demo: boolean;
  /** Enlace del frame (no en modo ejemplo). */
  figmaUrl: string | undefined;
  pageUrl: string | undefined;
  width: number | undefined;
  scale: 1 | 2;
  ignore: string[];
  ai: boolean;
  aiMaxCost: number;
}

export type Validation = { ok: true; value: JobInput } | { ok: false; errors: Partial<Record<Field, string>> };

export const LIMITS = { minWidth: 200, maxWidth: 4000, maxSelectors: 20, maxSelectorLength: 200, maxUrlLength: 2000, maxCost: 1, defaultCost: 0.05 } as const;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const truthy = (v: unknown): boolean => v === true || v === "true" || v === "on" || v === "1";
// Caracteres de control (incluidos saltos de línea y NUL) no tienen lugar en una URL ni en un selector.
const hasControl = (s: string): boolean => /[\u0000-\u001f\u007f]/.test(s);

/**
 * Valida y normaliza lo que pide el formulario. Nunca confía en el navegador: la URL de Figma se analiza con `parseFigmaUrl`,
 * la de la página con `assertAllowedUrl` (solo http, https y file), y los números y la lista de selectores tienen límites.
 * Los mensajes van en español y dicen qué hacer.
 */
export function validateInput(raw: RawInput): Validation {
  const errors: Partial<Record<Field, string>> = {};
  const demo = truthy(raw.demo);

  let figmaUrl: string | undefined;
  let pageUrl: string | undefined;

  if (!demo) {
    const f = text(raw.figmaUrl);
    if (!f) errors.figmaUrl = "Pegue el enlace del frame de Figma (en Figma: clic derecho sobre el frame → Copy link to selection).";
    else if (f.length > LIMITS.maxUrlLength || hasControl(f)) errors.figmaUrl = "Ese enlace no es válido.";
    else {
      try {
        parseFigmaUrl(f);
        figmaUrl = f;
      } catch (e) {
        errors.figmaUrl = e instanceof Error ? e.message : "Ese enlace de Figma no es válido.";
      }
    }

    const p = text(raw.pageUrl);
    if (!p) errors.pageUrl = "Escriba la dirección de la página que quiere comparar, por ejemplo http://localhost:3000.";
    else if (p.length > LIMITS.maxUrlLength || hasControl(p)) errors.pageUrl = "Esa dirección no es válida.";
    else {
      try {
        const u = assertAllowedUrl(p);
        if (u.username || u.password) errors.pageUrl = "La dirección no debe llevar usuario ni contraseña.";
        else pageUrl = p;
      } catch (e) {
        errors.pageUrl = e instanceof Error ? e.message : "Esa dirección no es válida.";
      }
    }
  }

  let width: number | undefined;
  const w = text(raw.width);
  if (w) {
    const n = Number(w);
    if (!/^\d+$/.test(w) || !Number.isInteger(n) || n < LIMITS.minWidth || n > LIMITS.maxWidth) {
      errors.width = `El ancho debe ser un número entero entre ${LIMITS.minWidth} y ${LIMITS.maxWidth} px (o déjelo vacío para usar el del frame).`;
    } else width = n;
  }

  let scale: 1 | 2 = 1;
  const s = text(raw.scale);
  if (s && s !== "1" && s !== "2") errors.scale = "La escala debe ser 1 o 2.";
  else if (s === "2") scale = 2;

  const ignore: string[] = [];
  const lines = typeof raw.ignore === "string" ? raw.ignore.split(/\r?\n/) : Array.isArray(raw.ignore) ? raw.ignore.map((x) => (typeof x === "string" ? x : "")) : [];
  for (const line of lines) {
    const sel = line.trim();
    if (!sel) continue;
    if (sel.length > LIMITS.maxSelectorLength) {
      errors.ignore = `Cada selector puede tener hasta ${LIMITS.maxSelectorLength} caracteres.`;
      break;
    }
    if (hasControl(sel)) {
      errors.ignore = "Los selectores no pueden llevar caracteres de control.";
      break;
    }
    ignore.push(sel);
  }
  if (!errors.ignore && ignore.length > LIMITS.maxSelectors) errors.ignore = `Puede ignorar hasta ${LIMITS.maxSelectors} zonas; escribió ${ignore.length}.`;

  const ai = truthy(raw.ai);
  let aiMaxCost: number = LIMITS.defaultCost;
  const c = text(raw.aiMaxCost);
  if (c) {
    const n = Number(c.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0 || n > LIMITS.maxCost) errors.aiMaxCost = `El tope de costo debe ser mayor que 0 y de hasta ${LIMITS.maxCost} USD.`;
    else aiMaxCost = n;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { demo, figmaUrl, pageUrl, width, scale, ignore, ai, aiMaxCost } };
}
