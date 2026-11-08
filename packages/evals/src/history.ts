import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalRun } from "./format.ts";

/** Lee la última corrida guardada, si hay y es legible. */
export function loadPrevious(dir: string): EvalRun | undefined {
  const file = join(dir, "latest.json");
  if (!existsSync(file)) return undefined;
  try {
    const run = JSON.parse(readFileSync(file, "utf8")) as EvalRun;
    return run.schemaVersion === 1 ? run : undefined;
  } catch {
    return undefined;
  }
}

/** Guarda la corrida como `latest.json` y una copia con fecha en `history/`. */
export function saveRun(dir: string, run: EvalRun): string {
  mkdirSync(join(dir, "history"), { recursive: true });
  const text = JSON.stringify(run, null, 2) + "\n";
  writeFileSync(join(dir, "latest.json"), text);
  writeFileSync(join(dir, "history", `${run.createdAt.replace(/[:.]/g, "-")}.json`), text);
  return join(dir, "latest.json");
}
