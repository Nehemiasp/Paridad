import type { AiClient, AiRequest } from "./client.ts";
import type { ModelOutput } from "./ground.ts";

/**
 * «Modelo» determinista para probar la tubería sin llamar a nadie: agrupa los hallazgos de una misma regla y redacta
 * con las cifras de su evidencia. NO mide a Claude: sus resultados no dicen nada sobre si la IA ayuda.
 */
export function createSimulatedClient(): AiClient {
  return {
    async complete(req: AiRequest) {
      const first = req.content[0];
      const text = first && first.type === "text" ? first.text : "";
      const json = text.slice(text.indexOf("{"));
      const data = JSON.parse(json) as { hallazgos: { id: string; regla: string; titulo: string; esperado: unknown; obtenido: unknown }[] };
      const byRule = new Map<string, typeof data.hallazgos>();
      for (const f of data.hallazgos) byRule.set(f.regla, [...(byRule.get(f.regla) ?? []), f]);
      const output: ModelOutput = { groups: [], discarded: [] };
      for (const [rule, list] of byRule) {
        if (list.length < 2) continue;
        const f = list[0]!;
        output.groups.push({
          title: `${list.length} hallazgos de «${rule}»`,
          explanation: `Hay ${list.length} hallazgos de la regla «${rule}»; por ejemplo: ${f.titulo}`,
          finding_ids: list.map((x) => x.id),
          css_fix: "",
        });
      }
      return { output, model: "simulado", usage: { inputTokens: Math.ceil(text.length / 3), outputTokens: 200, cacheReadTokens: 0 } };
    },
  };
}
