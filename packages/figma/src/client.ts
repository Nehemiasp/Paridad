import { z } from "zod";
import { DiskCache } from "./cache.ts";

const API = "https://api.figma.com";

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Solo valida lo imprescindible del sobre de la respuesta; el árbol de nodos se lee con tolerancia. */
const NodesResponseSchema = z.object({
  name: z.string().optional(),
  lastModified: z.string().optional(),
  version: z.string().optional(),
  nodes: z.record(z.string(), z.object({ document: z.record(z.string(), z.unknown()), styles: z.record(z.string(), z.unknown()).optional() }).nullable()),
});
export type NodesResponse = z.infer<typeof NodesResponseSchema>;

const ImagesResponseSchema = z.object({
  err: z.string().nullable().optional(),
  images: z.record(z.string(), z.string().nullable()),
});

export class FigmaApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FigmaApiError";
  }
}

export interface FigmaClientOptions {
  /** Token personal (solo lectura). Nunca se escribe en errores ni en la caché. */
  token: string;
  cache?: DiskCache;
  /** Para pruebas: reemplaza `fetch`. */
  fetch?: FetchLike;
  /** Ignora la caché y vuelve a pedir. */
  refresh?: boolean;
}

export class FigmaClient {
  private readonly token: string;
  private readonly cache: DiskCache | undefined;
  private readonly doFetch: FetchLike;
  private readonly refresh: boolean;

  constructor(options: FigmaClientOptions) {
    if (!options.token) throw new FigmaApiError("Falta el token de Figma. Defina FIGMA_TOKEN en .env.local (vea .env.example).");
    this.token = options.token;
    this.cache = options.cache;
    this.doFetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.refresh = options.refresh ?? false;
  }

  private async request(url: string, authenticated: boolean): Promise<Awaited<ReturnType<FetchLike>>> {
    let res;
    try {
      res = await this.doFetch(url, authenticated ? { headers: { "X-Figma-Token": this.token } } : {});
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      throw new FigmaApiError(`No se pudo conectar con Figma: ${text.split(this.token).join("***")}`);
    }
    if (res.ok) return res;
    switch (res.status) {
      case 401:
      case 403:
        throw new FigmaApiError("Figma rechazó el token (403). Revise que sea válido, que no haya vencido y que tenga permiso de lectura de archivos (File content: Read-only) y acceso a este archivo.", res.status);
      case 404:
        throw new FigmaApiError("Figma no encontró el archivo o el frame (404). Revise la URL y que su cuenta tenga acceso.", res.status);
      case 429: {
        const wait = res.headers.get("retry-after");
        throw new FigmaApiError(`Figma limitó las peticiones (429). Intente de nuevo${wait ? ` en ${wait} s` : " en unos minutos"}.`, res.status);
      }
      default:
        throw new FigmaApiError(`Figma respondió con el error ${res.status}.`, res.status);
    }
  }

  private async cachedJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const key = `GET ${path}`;
    if (!this.refresh) {
      const hit = this.cache?.getJson<unknown>(key);
      if (hit !== undefined) {
        const parsed = schema.safeParse(hit);
        if (parsed.success) return parsed.data;
      }
    }
    const res = await this.request(`${API}${path}`, true);
    const body = await res.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new FigmaApiError("La respuesta de Figma no tiene la forma esperada; ¿cambió la API?");
    this.cache?.setJson(key, body);
    return parsed.data;
  }

  /** `GET /v1/files/:key/nodes?ids=…` — el nodo del frame con todo su árbol. */
  async getNode(fileKey: string, nodeId: string): Promise<{ response: NodesResponse; document: Record<string, unknown> }> {
    const response = await this.cachedJson(`/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`, NodesResponseSchema);
    const entry = response.nodes[nodeId];
    if (!entry) throw new FigmaApiError(`El nodo ${nodeId} no existe en el archivo. ¿Se borró o cambió el frame?`, 404);
    return { response, document: entry.document };
  }

  /** `GET /v1/images/:key?ids=…&scale=…` y descarga del PNG (la URL del PNG no lleva token). */
  async getImage(fileKey: string, nodeId: string, scale: 1 | 2): Promise<Buffer> {
    const path = `/v1/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(nodeId)}&scale=${scale}&format=png`;
    const meta = await this.cachedJson(path, ImagesResponseSchema);
    if (meta.err) throw new FigmaApiError(`Figma no pudo exportar la imagen: ${meta.err}`);
    const url = meta.images[nodeId];
    if (!url) throw new FigmaApiError(`Figma no devolvió imagen para el nodo ${nodeId}.`);

    const key = `IMG ${fileKey} ${nodeId} ${scale} ${url.split("?")[0]}`;
    if (!this.refresh) {
      const hit = this.cache?.getBinary(key);
      if (hit) return hit;
    }
    const res = await this.request(url, false);
    const buf = Buffer.from(await res.arrayBuffer());
    this.cache?.setBinary(key, buf);
    return buf;
  }

  /**
   * Extra opcional: variables locales. La API REST de variables solo existe en planes Enterprise,
   * así que cualquier fallo (403, 404, forma inesperada) devuelve `undefined` y nunca rompe nada.
   */
  async getLocalVariables(fileKey: string): Promise<Record<string, unknown> | undefined> {
    try {
      const schema = z.object({ meta: z.object({ variables: z.record(z.string(), z.unknown()) }) });
      const r = await this.cachedJson(`/v1/files/${encodeURIComponent(fileKey)}/variables/local`, schema);
      return r.meta.variables;
    } catch {
      return undefined;
    }
  }
}
