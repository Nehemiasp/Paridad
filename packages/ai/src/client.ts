import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ModelOutputSchema } from "./ground.ts";
import type { Usage } from "./cost.ts";

export type AiContent = { type: "text"; text: string } | { type: "image"; base64: string; mediaType: "image/png" };

export interface AiRequest {
  model: string;
  system: string;
  content: AiContent[];
  maxTokens: number;
}

export interface AiResponse {
  /** JSON ya validado por el esquema de salida (`ModelOutputSchema`). */
  output: unknown;
  usage: Usage;
  model: string;
}

/** Lo único que la capa de IA necesita de un modelo; se sustituye por uno falso en las pruebas. */
export interface AiClient {
  complete(request: AiRequest): Promise<AiResponse>;
}

/** El modelo declinó responder (clasificadores de seguridad). */
export class AiRefusalError extends Error {}
/** Falló la llamada: clave inválida, límite de peticiones, red… El mensaje nunca incluye la clave. */
export class AiApiError extends Error {}

/** Parte del SDK que se usa; permite inyectar un doble en las pruebas. */
export interface SdkLike {
  messages: {
    parse(params: never): Promise<{
      parsed_output: unknown;
      stop_reason: string | null;
      stop_details?: { category?: string | null } | null;
      usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null };
      model: string;
    }>;
  };
}

/**
 * Cliente real: Claude con salidas estructuradas (el JSON llega validado contra el esquema).
 * No se fija `temperature` ni `thinking`: los modelos actuales rechazan valores distintos del predeterminado.
 */
export function createAnthropicClient(options: { apiKey?: string; sdk?: SdkLike } = {}): AiClient {
  const sdk: SdkLike = options.sdk ?? (new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {}) as unknown as SdkLike);
  return {
    async complete(req) {
      const content = req.content.map((c) => (c.type === "text" ? { type: "text" as const, text: c.text } : { type: "image" as const, source: { type: "base64" as const, media_type: c.mediaType, data: c.base64 } }));
      let res;
      try {
        res = await sdk.messages.parse({
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: "user", content }],
          output_config: { format: zodOutputFormat(ModelOutputSchema) },
        } as never);
      } catch (error) {
        throw toApiError(error, options.apiKey);
      }
      if (res.stop_reason === "refusal") {
        throw new AiRefusalError(`El modelo declinó responder${res.stop_details?.category ? ` (categoría ${res.stop_details.category})` : ""}.`);
      }
      if (res.stop_reason === "max_tokens") throw new AiApiError("La respuesta del modelo se cortó por el límite de tokens; el JSON está incompleto.");
      if (res.parsed_output === null || res.parsed_output === undefined) throw new AiApiError("El modelo no devolvió un JSON que cumpla el esquema.");
      return {
        output: res.parsed_output,
        model: res.model,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, cacheReadTokens: res.usage.cache_read_input_tokens ?? 0 },
      };
    },
  };
}

function toApiError(error: unknown, key?: string): AiApiError {
  const scrub = (s: string) => (key ? s.split(key).join("***") : s);
  if (error instanceof Anthropic.AuthenticationError) return new AiApiError("La API rechazó la clave (ANTHROPIC_API_KEY). Revise que sea válida y no haya vencido.");
  if (error instanceof Anthropic.RateLimitError) return new AiApiError("La API limitó las peticiones (429). Intente de nuevo en unos minutos.");
  if (error instanceof Anthropic.BadRequestError) return new AiApiError(`La API rechazó la petición: ${scrub(error.message)}`);
  if (error instanceof Anthropic.APIError) return new AiApiError(`Error de la API (${error.status ?? "sin estado"}): ${scrub(error.message)}`);
  return new AiApiError(`No se pudo llamar a la API: ${scrub(error instanceof Error ? error.message : String(error))}`);
}
