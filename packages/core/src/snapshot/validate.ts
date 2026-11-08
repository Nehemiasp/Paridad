import { z } from "zod";
import { SnapshotSchema, type Snapshot } from "./schema.ts";

export interface SnapshotIssue {
  /** Ruta al campo, p. ej. `elements[3].parentId`. */
  path: string;
  message: string;
}

export type ParseResult = { ok: true; snapshot: Snapshot } | { ok: false; issues: SnapshotIssue[] };

function formatPath(path: PropertyKey[]): string {
  return (
    path
      .map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
      .join("") || "(raíz)"
  );
}

/** Valida datos desconocidos (p. ej. un JSON leído de disco) y devuelve errores legibles en español. */
export function parseSnapshot(data: unknown): ParseResult {
  const result = SnapshotSchema.safeParse(data, { error: z.locales.es().localeError });
  if (result.success) return { ok: true, snapshot: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })),
  };
}

/** Como `parseSnapshot`, pero lanza un error con todos los problemas listados. */
export function assertSnapshot(data: unknown, label = "snapshot"): Snapshot {
  const r = parseSnapshot(data);
  if (r.ok) return r.snapshot;
  const lines = r.issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
  throw new Error(`El ${label} no es válido:\n${lines}`);
}
