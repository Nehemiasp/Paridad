import { z } from "zod";
import { SnapshotSchema } from "./schema.ts";

/**
 * JSON Schema del snapshot, generado desde Zod (única fuente de verdad).
 * Las validaciones cruzadas (ids únicos, padres, etc.) no caben en JSON Schema:
 * están descritas en `docs/snapshot.md` y las aplica `parseSnapshot`.
 */
export function snapshotJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SnapshotSchema, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
}
